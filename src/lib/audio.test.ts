import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToneEngine, envelopeEnd, playEnvelope, unitsForText, type EnvelopeSegment } from './audio';
import { timingsForWpm, type Timings } from './timing';

const t: Timings = timingsForWpm(15);

describe('unitsForText', () => {
	it('carries the character each code came from, as the user typed it', () => {
		const units = unitsForText('aB', t);
		expect(units.map((u) => u.char)).toEqual(['a', 'B']);
		expect(units.map((u) => u.pattern)).toEqual(['.-', '-...']);
	});

	it('skips characters with no code, so positions count only what plays', () => {
		// A currency sign has no code, so it must not take up a position. A full
		// stop would not do: it has a code, .-.-.-.
		const units = unitsForText('a\u00a3b', t);
		expect(units.map((u) => u.char)).toEqual(['a', 'b']);
	});

	it('separates words with a word gap and characters with a character gap', () => {
		const units = unitsForText('ab cd', t);
		expect(units.map((u) => u.gapAfterMs)).toEqual([t.charGapMs, t.wordGapMs, t.charGapMs, t.wordGapMs]);
	});

	it('does not add a word gap for a word of nothing but unknown characters', () => {
		const units = unitsForText('a \u00a3\u00a3 b', t);
		expect(units.map((u) => u.char)).toEqual(['a', 'b']);
		expect(units[0].gapAfterMs).toBe(t.wordGapMs);
	});

	it('ignores leading, trailing and repeated whitespace', () => {
		expect(unitsForText('  a  b  ', t).map((u) => u.char)).toEqual(['a', 'b']);
	});

	it('yields nothing for text with no playable characters', () => {
		expect(unitsForText('\u00a3\u00a3', t)).toEqual([]);
		expect(unitsForText('   ', t)).toEqual([]);
	});
});

describe('playback envelope', () => {
	const t = timingsForWpm(15);
	/** The last segment. Every envelope under test has at least one. */
	const lastOf = (segments: EnvelopeSegment[]) => segments[segments.length - 1] as EnvelopeSegment;

	it('starts and ends at silence', () => {
		const env = playEnvelope(unitsForText('SOS', t), t, 0.5, 1);
		expect(env[0].from).toBe(0);
		expect(lastOf(env).to).toBe(0);
	});

	it('never jumps: each segment starts where the last one ended', () => {
		// The click at the edge of every beep came from a release scheduled from
		// the wrong starting level. Continuity is the invariant that rules it out.
		for (const text of ['E', 'T', 'SOS', 'A', '88', 'HELLO WORLD', '?']) {
			const env = playEnvelope(unitsForText(text, t), t, 0.5, 1);
			for (let i = 1; i < env.length; i++) {
				expect(env[i].from).toBeCloseTo(env[i - 1].to, 10);
			}
		}
	});

	it('reaches the full volume on every symbol', () => {
		const env = playEnvelope(unitsForText('E', t), t, 0.5, 1);
		const peaks = env.filter((s) => s.to === 0.5);
		expect(peaks).toHaveLength(1);
		expect(peaks[0].from).toBe(0);
	});

	it('holds a dot and a dash for their real lengths', () => {
		const dotS = t.dotMs / 1000;
		const dashS = t.dashMs / 1000;
		const dot = playEnvelope(unitsForText('E', t), t, 0.5, 0);
		const dash = playEnvelope(unitsForText('T', t), t, 0.5, 0);
		// A symbol is timed from the start of its attack to the start of its
		// release. The release itself is a short fade that may run past the end.
		expect(dot[0].seconds).toBeGreaterThan(0);
		expect(dot[1].at - dot[0].at).toBeCloseTo(dotS, 6);
		expect(dash[1].at - dash[0].at).toBeCloseTo(dashS, 6);
		expect(dashS / dotS).toBeCloseTo(3, 6);
		// The fade is short next to the shortest symbol, so a dot is not overrun.
		expect(dot[1].seconds).toBeLessThanOrEqual(dotS);
	});

	it('falls silent before the trailing gap is over', () => {
		// The gap that follows the last code is silence, not tone, so the sound
		// must already be finished by the time the run is.
		const units = unitsForText('SOS', t);
		const last = lastOf(playEnvelope(units, t, 0.5, 10));
		expect(last.to).toBe(0);
		expect(last.at + last.seconds).toBeLessThanOrEqual(10 + envelopeEnd(units, t) + 0.001);
	});
});

// --- recovery -------------------------------------------------------------
// The engine has to survive a browser suspending or closing the context behind
// its back, which is what happens when its tab goes to the background. These
// drive a fake context so the states that only show up on a real device can be
// tested directly.

type Listener = () => void;

class FakeParam {
	value = 0;
	cancelled = 0;
	/** Every ramp, with the level it was scheduled from, which is the part that matters. */
	ramps: Array<{ from: number; to: number }> = [];
	cancelScheduledValues() {
		this.cancelled++;
		this.ramps = [];
	}
	setValueAtTime(v: number) {
		this.value = v;
	}
	linearRampToValueAtTime(v: number) {
		this.ramps.push({ from: this.value, to: v });
		this.value = v;
	}
	setTargetAtTime(v: number) {
		this.value = v;
	}
}

class FakeNode {
	gain = new FakeParam();
	connect() {
		return this;
	}
}

class FakeAudioContext {
	/** Set false to model a resume that does not take effect straight away. */
	autoResume = true;
	// A context built inside a user gesture starts running, which is the normal
	// case; everything below is about what happens after the browser takes over.
	state: AudioContextState = 'running';
	currentTime = 0;
	destination = new FakeNode();
	resumeCalls = 0;
	/** In creation order: the sidetone stage first, then playback. */
	gains: FakeNode[] = [];
	#listeners: Listener[] = [];

	#fire() {
		for (const fn of this.#listeners) fn();
	}
	/** Drive a change the browser would make on its own. */
	suspend() {
		this.state = 'suspended';
		this.#fire();
	}
	/** The browser taking the context back for good. */
	close() {
		this.state = 'closed';
		this.#fire();
	}
	addEventListener(type: string, fn: Listener) {
		if (type === 'statechange') this.#listeners.push(fn);
	}
	resume() {
		this.resumeCalls++;
		if (this.autoResume) {
			this.state = 'running';
			this.#fire();
		}
		return Promise.resolve();
	}
	createGain() {
		const node = new FakeNode();
		this.gains.push(node);
		return node;
	}
	createOscillator() {
		return { type: 'sine', frequency: new FakeParam(), connect: () => new FakeNode(), start: () => {} };
	}
}

function install() {
	const made: FakeAudioContext[] = [];
	class Ctor extends FakeAudioContext {
		constructor() {
			super();
			made.push(this);
		}
	}
	const documentListeners: Array<{ type: string; fn: Listener }> = [];
	(globalThis as Record<string, unknown>).window = { AudioContext: Ctor };
	(globalThis as Record<string, unknown>).document = {
		hidden: false,
		addEventListener: (type: string, fn: Listener) => documentListeners.push({ type, fn }),
	};
	return {
		made,
		hide: () => {
			(globalThis.document as { hidden: boolean }).hidden = true;
			for (const l of documentListeners) if (l.type === 'visibilitychange') l.fn();
		},
		restore: () => {
			delete (globalThis as Record<string, unknown>).window;
			delete (globalThis as Record<string, unknown>).document;
		},
	};
}

describe('ToneEngine recovery', () => {
	let audio: ReturnType<typeof install>;

	beforeEach(() => {
		audio = install();
	});
	afterEach(() => {
		audio.restore();
	});

	it('is only ready once the context is actually running', () => {
		const engine = new ToneEngine();
		expect(engine.ready).toBe(false);
		// A context the browser suspended still exists but makes no sound, and
		// reporting it as ready is what stopped the app from trying again.
		expect(engine.unlock()).toBe(true);
		expect(engine.ready).toBe(true);

		audio.made[0].suspend();
		expect(engine.ready).toBe(false);
	});

	it('resumes a suspended context on the next press instead of staying silent', () => {
		const engine = new ToneEngine();
		engine.unlock();
		audio.made[0].suspend();

		engine.startSidetone();
		expect(audio.made[0].resumeCalls).toBe(1);
		expect(engine.ready).toBe(true);
	});

	it('keeps trying while a resume has not taken effect', () => {
		const engine = new ToneEngine();
		engine.unlock();
		audio.made[0].suspend();
		audio.made[0].autoResume = false;

		engine.startSidetone();
		expect(engine.ready).toBe(false);

		// The next press tries again, which is the point: a resume that was
		// refused must not leave the engine wedged for the rest of the session.
		engine.startSidetone();
		expect(audio.made[0].resumeCalls).toBe(2);
	});

	it('builds a new context when the old one is closed', () => {
		const engine = new ToneEngine();
		engine.unlock();
		expect(audio.made).toHaveLength(1);

		audio.made[0].close();
		expect(engine.ready).toBe(false);

		// A closed context cannot be resumed, so this is the one failure that
		// used to need a page reload to shake loose.
		engine.startSidetone();
		expect(audio.made).toHaveLength(2);
		expect(audio.made[1].state).toBe('running');
	});

	it('forgets the level when the clock stops, rather than ramping from it later', () => {
		const engine = new ToneEngine();
		engine.unlock();
		engine.setVolume(0.5);
		engine.startSidetone();
		const gain = audio.made[0].gains[0].gain;
		expect(gain.ramps.at(-1)).toEqual({ from: 0, to: 0.5 });

		audio.made[0].suspend();
		engine.startSidetone();

		// The ramp that was in flight never happened, so the level on the books
		// is one the gain never reached. Ramping from it drags the level about
		// and clicks at the edge of the tone.
		expect(gain.ramps.at(-1)).toEqual({ from: 0, to: 0.5 });
	});

	it('silences a stuck gain when the browser brings the context back itself', () => {
		const engine = new ToneEngine();
		engine.unlock();
		engine.setVolume(0.5);
		const ctx = audio.made[0];
		engine.startSidetone();
		const gain = ctx.gains[0].gain;

		// Caught mid-tone: the context stops with the gain up, and the browser
		// resumes it without being asked. The level it froze at is still there,
		// so coming back this way would drone.
		ctx.suspend();
		expect(gain.value).toBe(0.5);
		ctx.resume();

		expect(gain.value).toBe(0);
	});

	it('leaves the ramp alone when the resume was ours', () => {
		const engine = new ToneEngine();
		engine.unlock();
		engine.setVolume(0.5);
		const ctx = audio.made[0];
		ctx.suspend();

		// A press that both resumes and sounds: the state change the resume
		// causes must not wipe out the ramp it has just scheduled.
		engine.startSidetone();

		const gain = ctx.gains[0].gain;
		expect(gain.value).toBe(0.5);
		expect(gain.ramps.at(-1)).toEqual({ from: 0, to: 0.5 });
	});

	it('cuts playback off and silences the gains when the tab is hidden', async () => {
		const engine = new ToneEngine();
		engine.unlock();
		engine.setVolume(0.5);
		engine.startSidetone();
		const ctx = audio.made[0];
		// Something must be listening for the run to be released.
		const running = engine.playText('SOS', t);

		audio.hide();
		// A hidden tab has its timers throttled to about once a second, so a run
		// left going would come back out of step with the code sounding.
		await expect(
			Promise.race([running, new Promise((_, reject) => setTimeout(() => reject(new Error('still running')), 1000))]),
		).resolves.toBeUndefined();
		// Both stages down, not just the one the run was using: the sidetone was
		// still up when the tab went away.
		for (const gain of ctx.gains) expect(gain.gain.value).toBe(0);
	});
});
