/**
 * WebAudio tone engine: sidetone for keying, scheduled playback for quiz and
 * text playback, and short feedback earcons.
 *
 * A continuous oscillator feeds the sidetone and playback gains, both gated in
 * real time. A separate short-lived oscillator handles feedback so a right/
 * wrong blip can never disturb the pitch of code that is still scheduled.
 */

import { elements, encode } from './morse';
import type { Timings } from './timing';

const ATTACK_S = 0.008;
const RELEASE_S = 0.012;

export type PlayUnit = {
	pattern: string;
	/** Silence after this code, in ms. */
	gapAfterMs: number;
	/** The character this code came from, when it came from text. */
	char?: string;
};

export class ToneEngine {
	#ctx: AudioContext | null = null;
	#osc: OscillatorNode | null = null;
	#sidetone: GainNode | null = null;
	#play: GainNode | null = null;
	#freq = 700;
	#volume = 0.5;
	#handles = new Map<number, ReturnType<typeof setTimeout>>();
	#sleepers = new Map<number, () => void>();
	/** Pending "this character is sounding now" timers, so a stop can clear them. */
	#progress: ReturnType<typeof setTimeout>[] = [];
	/** Level the sidetone and playback envelopes were last left at. */
	#sidetoneLevel = 0;
	#playLevel = 0;
	#nextSleeper = 1;

	get ready() {
		return this.#ctx !== null;
	}

	get frequency() {
		return this.#freq;
	}

	setFrequency(hz: number) {
		this.#freq = hz;
		if (this.#osc && this.#ctx) {
			this.#osc.frequency.setTargetAtTime(hz, this.#ctx.currentTime, 0.005);
		}
	}

	setVolume(v: number) {
		this.#volume = Math.max(0, Math.min(1, v));
	}

	get volume() {
		return this.#volume;
	}

	/**
	 * Create or resume the AudioContext. Browsers only allow this from a user
	 * gesture, so call it from the first tap or key press.
	 */
	unlock(): boolean {
		try {
			this.#ensure();
			return this.#ctx?.state === 'running';
		} catch {
			return false;
		}
	}

	#ensure(): AudioContext {
		if (!this.#ctx) {
			const Ctor: typeof AudioContext | undefined =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!Ctor) throw new Error('WebAudio unavailable');

			const ctx = new Ctor();
			const osc = ctx.createOscillator();
			osc.type = 'sine';
			osc.frequency.value = this.#freq;

			const sidetone = ctx.createGain();
			sidetone.gain.value = 0;
			const play = ctx.createGain();
			play.gain.value = 0;

			osc.connect(sidetone).connect(ctx.destination);
			osc.connect(play).connect(ctx.destination);
			osc.start();

			this.#ctx = ctx;
			this.#osc = osc;
			this.#sidetone = sidetone;
			this.#play = play;
		}
		if (this.#ctx.state === 'suspended') void this.#ctx.resume();
		return this.#ctx;
	}

	/**
	 * Move one param from a known level to another.
	 *
	 * The starting level is an argument rather than read back from the param.
	 * `param.value` reports the level at the moment of the call, which for a
	 * scheduled envelope is not the level the ramp starts from: it was 0, so every
	 * symbol was dragged back to silence at its peak, which is an audible step and
	 * clicks at the edge of each beep.
	 */
	#ramp(param: AudioParam, from: number, to: number, at: number, seconds: number) {
		param.cancelScheduledValues(at);
		param.setValueAtTime(from, at);
		param.linearRampToValueAtTime(to, at + seconds);
	}

	// --- sidetone ---------------------------------------------------------

	/**
	 * Sound for as long as the key is down, at whatever length the user chose.
	 * This is deliberate: the sidetone should reflect the real rhythm they are
	 * sending, not a normalised dot and dash.
	 */
	startSidetone() {
		const ctx = this.#ensure();
		this.#ramp(this.#sidetone!.gain, this.#sidetoneLevel, this.#volume, ctx.currentTime, ATTACK_S);
		this.#sidetoneLevel = this.#volume;
	}

	stopSidetone() {
		if (!this.#ctx || !this.#sidetone) return;
		this.#ramp(this.#sidetone!.gain, this.#sidetoneLevel, 0, this.#ctx.currentTime, RELEASE_S);
		this.#sidetoneLevel = 0;
	}

	// --- scheduled playback ----------------------------------------------

	/**
	 * Schedule a run of codes at sample accuracy. Returns the total duration so
	 * the caller can pace itself without timing by ear.
	 */
	#schedule(units: PlayUnit[], t: Timings, volume: number, leadInS = 0.06): number {
		const ctx = this.#ensure();
		const gain = this.#play!.gain;
		const start = ctx.currentTime + leadInS;
		gain.cancelScheduledValues(ctx.currentTime);
		gain.setValueAtTime(0, ctx.currentTime);

		for (const seg of playEnvelope(units, t, volume, start)) {
			this.#ramp(gain, seg.from, seg.to, seg.at, seg.seconds);
		}
		this.#playLevel = 0;

		return Math.max(0, (start + envelopeEnd(units, t) - ctx.currentTime) * 1000);
	}

	/** Play a single character's code. Resolves once the tone has finished. */
	async playPattern(pattern: string, t: Timings, volume = this.#volume): Promise<void> {
		if (!pattern) return;
		await this.#sleep(this.#schedule([{ pattern, gapAfterMs: t.charGapMs }], t, volume));
	}

	/**
	 * Play a string as Morse, honouring word gaps. Unknown characters are skipped.
	 *
	 * `onChar` reports each character as its code begins, along with its position
	 * in the run, so a caller can follow along while the tone plays. It is driven
	 * by timers aligned to the same offsets the audio is scheduled on, rather than
	 * by playing one character at a time, which would drift and add gaps between
	 * codes. The position counts only characters that could be played, so it lines
	 * up with the codes rather than with the raw text.
	 */
	async playText(
		text: string,
		t: Timings,
		volume = this.#volume,
		onChar?: (char: string, index: number) => void,
	): Promise<void> {
		const units = unitsForText(text, t);
		if (!units.length) return;
		const duration = this.#schedule(units, t, volume);
		if (onChar) this.#followAlong(units, t, duration, onChar);
		await this.#sleep(duration);
	}

	/**
	 * Call `onChar` at the moment each unit starts sounding. The offsets come
	 * from the same arithmetic as `#schedule`, so the highlight lands with the
	 * tone rather than near it.
	 */
	#followAlong(
		units: PlayUnit[],
		t: Timings,
		duration: number,
		onChar: (char: string, index: number) => void,
	) {
		const LEAD_IN_MS = 60;
		let offset = LEAD_IN_MS;
		let index = 0;
		for (const unit of units) {
			const at = offset;
			if (unit.char !== undefined) {
				const i = index++;
				this.#progress.push(setTimeout(() => onChar(unit.char!, i), at));
			}
			for (const symbol of elements(unit.pattern)) {
				offset += (symbol === '.' ? t.dotMs : t.dashMs) + t.dotMs;
			}
			// The trailing inter-element silence is replaced by the real gap.
			offset += unit.gapAfterMs - t.dotMs;
		}
		// Clear the list once the run is over. The backstop matters when the
		// caller starts another playback without awaiting the previous one.
		this.#progress.push(setTimeout(() => this.#clearProgress(), Math.max(offset, duration)));
	}

	#clearProgress() {
		for (const handle of this.#progress) clearTimeout(handle);
		this.#progress = [];
	}

	/** Play several codes in sequence, e.g. the options of a quiz question. */
	/** Cancel playback: silence at once and release anything awaiting completion. */
	stop() {
		if (this.#ctx && this.#play) {
			const now = this.#ctx.currentTime;
			this.#play.gain.cancelScheduledValues(now);
			this.#ramp(this.#play.gain, this.#playLevel, 0, now, RELEASE_S);
			this.#playLevel = 0;
		}
		for (const release of [...this.#sleepers.values()]) release();
		this.#sleepers.clear();
		this.#clearProgress();
	}

	// --- feedback earcons -------------------------------------------------

	/** Right/wrong sounds, so an answer can be taken without looking. */
	async feedback(ok: boolean): Promise<void> {
		let ctx: AudioContext;
		try {
			ctx = this.#ensure();
		} catch {
			return;
		}

		const osc = ctx.createOscillator();
		osc.type = ok ? 'sine' : 'triangle';
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, ctx.currentTime);
		osc.connect(gain).connect(ctx.destination);

		const now = ctx.currentTime;
		const vol = this.#volume * 0.6;
		const notes: Array<[hz: number, at: number, dur: number]> = ok
			? [
					[880, now, 0.08],
					[1320, now + 0.09, 0.12],
				]
			: [
					[320, now, 0.14],
					[200, now + 0.16, 0.24],
				];

		for (const [hz, at, dur] of notes) {
			osc.frequency.setValueAtTime(hz, at);
			gain.gain.setValueAtTime(vol, at);
			gain.gain.linearRampToValueAtTime(0, at + dur);
		}
		osc.start(now);
		osc.stop(now + 0.45);

		await this.#sleep(ok ? 260 : 420);
	}

	#sleep(ms: number): Promise<void> {
		if (ms <= 0) return Promise.resolve();
		return new Promise((resolve) => {
			const id = this.#nextSleeper++;
			const finish = () => {
				clearTimeout(this.#handles.get(id));
				this.#handles.delete(id);
				this.#sleepers.delete(id);
				resolve();
			};
			this.#sleepers.set(id, finish);
			this.#handles.set(id, setTimeout(finish, ms));
		});
	}
}

/**
 * Lay a string out as playable codes, so a word reads as characters separated
 * by character gaps and words separated by word gaps.
 */
/** One straight move of the gain, from a known level to another. */
export type EnvelopeSegment = {
	/** Seconds, on the AudioContext clock. */
	at: number;
	from: number;
	to: number;
	seconds: number;
};

/** Where a run of codes ends, in seconds from the start of the run. */
export function envelopeEnd(units: PlayUnit[], t: Timings): number {
	let cursor = 0;
	for (const unit of units) {
		for (const symbol of elements(unit.pattern)) {
			cursor += (symbol === '.' ? t.dotMs : t.dashMs) / 1000 + t.dotMs / 1000;
		}
		// The trailing inter-element silence is replaced by the real gap.
		cursor += (unit.gapAfterMs - t.dotMs) / 1000;
	}
	return cursor;
}

/**
 * The gain envelope for a run of codes, as a list of ramps.
 *
 * Every segment starts where the last one ended, so the level is continuous
 * across the whole run. That continuity is the whole point: a jump in level
 * between two samples is a click, and it is what you hear at the edge of every
 * beep if a symbol's release is scheduled from the wrong starting value.
 */
export function playEnvelope(
	units: PlayUnit[],
	t: Timings,
	volume: number,
	startAt: number,
): EnvelopeSegment[] {
	const segments: EnvelopeSegment[] = [];
	let cursor = startAt;
	let level = 0;
	const move = (to: number, at: number, seconds: number) => {
		segments.push({ at, from: level, to, seconds });
		level = to;
	};

	for (const unit of units) {
		for (const symbol of elements(unit.pattern)) {
			const lengthS = (symbol === '.' ? t.dotMs : t.dashMs) / 1000;
			move(volume, cursor, ATTACK_S);
			// The release is scheduled from the peak it is falling from, and
			// finishes before the symbol is over, so a dash is not clipped.
			move(0, Math.min(cursor + lengthS, cursor + ATTACK_S + lengthS), Math.min(RELEASE_S, lengthS));
			// Silence inside a code is always one unit, i.e. a dot. Using the
			// character gap here stretched every code out to three units between
			// its elements and made even a dot and a dash sound like two characters.
			cursor += lengthS + t.dotMs / 1000;
		}
		// Replace the trailing inter-element silence with the gap that actually
		// follows this code.
		cursor += (unit.gapAfterMs - t.dotMs) / 1000;
	}

	// Fade out from wherever the run left the level, so the tail of a run that
	// was cut short does not step.
	if (level !== 0) move(0, Math.max(cursor, startAt), RELEASE_S);
	return segments;
}

export function unitsForText(text: string, t: Timings): PlayUnit[] {
	const units: PlayUnit[] = [];
	for (const word of text.trim().split(/\s+/).filter(Boolean)) {
		const before = units.length;
		for (const char of word) {
			const pattern = encode(char);
			if (!pattern) continue;
			units.push({ pattern, gapAfterMs: t.charGapMs, char });
		}
		// Only lengthen the gap if this word actually contributed codes.
		if (units.length > before) units[units.length - 1].gapAfterMs = t.wordGapMs;
	}
	return units;
}

export const tone = new ToneEngine();
