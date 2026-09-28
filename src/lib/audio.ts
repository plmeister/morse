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

/**
 * Sidetone ramps, which are much shorter than the playback ones.
 *
 * A key press is heard the moment it happens, so a fade in is latency the user
 * can feel: at 8ms a dot spends a noticeable part of itself getting going, and
 * on a phone whose audio buffer is already a few tens of milliseconds the two
 * together are what makes the sidetone feel behind the finger. Three
 * milliseconds is still short enough not to click and is below the threshold
 * where the fade is heard as a fade rather than as an onset.
 */
const SIDETONE_ATTACK_S = 0.003;
const SIDETONE_RELEASE_S = 0.006;

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
	#freqSet = Number.NaN;
	#volume = 0.5;
	#handles = new Map<number, ReturnType<typeof setTimeout>>();
	#sleepers = new Map<number, () => void>();
	/** Pending "this character is sounding now" timers, so a stop can clear them. */
	#progress: ReturnType<typeof setTimeout>[] = [];
	/** Level the sidetone and playback envelopes were last left at. */
	#sidetoneLevel = 0;
	#playLevel = 0;
	#nextSleeper = 1;
	/** The context was suspended or interrupted, so the gains are not where the books say. */
	#stale = false;
	/** The last resume was ours, so the state change it causes is expected. */
	#asked = false;

	constructor() {
		if (typeof document === 'undefined') return;
		// A hidden tab has its timers throttled to about once a second, so a run
		// paced by setTimeout comes back a long way out of step with the audio
		// clock, and stops matching the code actually sounding. Cut it off
		// instead of letting it drift.
		document.addEventListener('visibilitychange', () => {
			// A context the browser suspended while another app had audio focus
			// comes back suspended too, and a resume is not free. Ask for it on the
			// way back in rather than on the next press, which is the one that
			// would be heard late.
			if (!document.hidden && !this.ready) this.warm();
			if (!document.hidden) return;
			this.stop();
			// A ramp scheduled now would not run until the clock moved again, and
			// a tone cut off that way comes back as a drone once the context does
			// resume, so the gains are taken to silence outright.
			this.#silence();
		});
	}

	/**
	 * Whether sound can be made right now.
	 *
	 * Only a context that is actually running counts. One the browser suspended
	 * when the tab went to the background still exists but makes no sound, and
	 * counting that as ready meant the unlock below ran once and never again.
	 */
	get ready() {
		return this.#ctx?.state === 'running';
	}

	get frequency() {
		return this.#freq;
	}

	setFrequency(hz: number) {
		if (hz === this.#freqSet) return;
		this.#freq = hz;
		this.#freqSet = hz;
		if (this.#osc && this.#ctx) {
			this.#osc.frequency.setTargetAtTime(hz, this.#ctx.currentTime, 0.005);
		}
	}

	/**
	 * What the device itself costs between a sound being rendered and being
	 * heard, in ms. Nothing in the app can beat this number; it is the floor
	 * under the sidetone, and worth knowing before blaming the code for it.
	 */
	get outputLatencyMs() {
		const l = this.#ctx?.outputLatency as number | undefined;
		return typeof l === 'number' && l > 0 ? Math.round(l * 1000) : 0;
	}

	/**
	 * Get the context ready to sound, without making a sound.
	 *
	 * A context the browser suspended while another app held the audio focus
	 * comes back suspended, and resuming it is not free. Doing that on the way
	 * back into the page keeps it off the first key press, which is the one
	 * where a late tone puts the whole app off.
	 */
	warm() {
		try {
			this.#ensure();
		} catch {
			// No audio here. Keying still works, silently.
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

	/**
	 * A context that will not run is no use, so anything short of running gets a
	 * fresh one. A closed context in particular cannot be resumed, and scheduling
	 * into one is silent for good: that is the failure that used to need a page
	 * reload to shake loose, and it is what the browser leaves behind when it
	 * reclaims a tab it had suspended.
	 */
	#ensure(): AudioContext {
		if (!this.#ctx || this.#ctx.state === 'closed') this.#build();
		const ctx = this.#ctx!;
		if (ctx.state !== 'running') {
			this.#asked = true;
			// Not awaited on purpose. What follows is scheduled on the audio
			// clock, which starts moving again as soon as the resume lands, so
			// waiting on the promise would add latency to the first press to buy
			// nothing.
			void ctx.resume().catch(() => {});
		}
		return ctx;
	}

	/** Build the oscillator and its two gain stages onto a new context. */
	#build() {
		const Ctor: typeof AudioContext | undefined =
			window.AudioContext ??
			(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!Ctor) throw new Error('WebAudio unavailable');

		// Asked for by name rather than left to the default, which is the same
		// value today but is the whole ball game on a device with a large buffer.
		const ctx = new Ctor({ latencyHint: 'interactive' });
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

		ctx.addEventListener('statechange', () => {
			if (ctx.state !== 'running') {
				// The clock has stopped, so a ramp that was in flight has not
				// happened. Forget the levels rather than ramp from them later.
				this.#stale = true;
				this.#sidetoneLevel = 0;
				this.#playLevel = 0;
				return;
			}
			// Back on its own, and not because we asked: whatever the suspension
			// froze the gains at is still there, which for a tone caught mid-sound
			// means a stuck note. Take them to silence before anything ramps.
			if (this.#stale && !this.#asked) this.#silence();
			this.#stale = false;
			this.#asked = false;
		});

		this.#ctx = ctx;
		this.#osc = osc;
		this.#sidetone = sidetone;
		this.#play = play;
		this.#stale = false;
		this.#asked = false;
	}

	/** Both gains to silence now, rather than by a ramp that may not arrive. */
	#silence() {
		for (const gain of [this.#sidetone, this.#play]) {
			if (!gain) continue;
			gain.gain.cancelScheduledValues(0);
			gain.gain.value = 0;
		}
		this.#sidetoneLevel = 0;
		this.#playLevel = 0;
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
	 *
	 * Scheduled at `currentTime`, which is the earliest a tone can start at all.
	 * Anchoring it to the key's own timestamp instead was tried and does not
	 * work: the graph renders ahead of the speaker by the device's output
	 * latency, so the graph position belonging to a press that has already
	 * happened is in the past, and a parameter event in the past starts now
	 * anyway. The delay between a finger and a tone is the device's, and no
	 * amount of scheduling comes out of it.
	 */
	startSidetone() {
		const ctx = this.#ensure();
		this.#ramp(
			this.#sidetone!.gain,
			this.#sidetoneLevel,
			this.#volume,
			ctx.currentTime,
			SIDETONE_ATTACK_S,
		);
		this.#sidetoneLevel = this.#volume;
	}

	stopSidetone() {
		if (!this.#ctx || !this.#sidetone) return;
		this.#ramp(this.#sidetone!.gain, this.#sidetoneLevel, 0, this.#ctx.currentTime, SIDETONE_RELEASE_S);
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

/**
 * Lay a string out as playable codes, so a word reads as characters separated
 * by character gaps and words separated by word gaps.
 */
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
