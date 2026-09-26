import { describe, expect, it } from 'vitest';
import { envelopeEnd, playEnvelope, unitsForText, type EnvelopeSegment } from './audio';
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
