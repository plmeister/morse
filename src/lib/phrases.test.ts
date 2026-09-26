import { describe, expect, it } from 'vitest';
import { encode, TABLE } from './morse';
import {
	PHRASES,
	PHRASE_CATEGORIES,
	phrasePattern,
	phraseUnits,
	isKeyable,
} from './phrases';
import { timingsForWpm } from './timing';

const t = timingsForWpm(15);

describe('phrase patterns', () => {
	it('derives every phrase from codes we actually know', () => {
		for (const phrase of PHRASES) {
			expect(isKeyable(phrase), phrase.id).toBe(true);
		}
	});

	it('runs the characters of a phrase together with no separator', () => {
		const sos = PHRASES.find((p) => p.id === 'sos')!;
		// S O S is ... --- ... and SOS is only recognisable unbroken.
		expect(phrasePattern(sos)).toBe('...---...');
	});

	it('builds a numeric shorthand from the digit codes', () => {
		const n73 = PHRASES.find((p) => p.id === 'n73')!;
		expect(phrasePattern(n73)).toBe(`${TABLE['7']}${TABLE['3']}`);
	});

	it('every phrase pattern is made only of dots and dashes', () => {
		for (const phrase of PHRASES) {
			expect(phrasePattern(phrase), phrase.id).toMatch(/^[.-]+$/);
		}
	});
});

describe('phrase playback', () => {
	it('sends a joined phrase as a single unbroken code', () => {
		const sos = PHRASES.find((p) => p.id === 'sos')!;
		const units = phraseUnits(sos, t);
		expect(units).toHaveLength(1);
		expect(units[0].pattern).toBe('...---...');
	});

	it('separates the letters of an unjoined phrase by a character gap', () => {
		const os = PHRASES.find((p) => p.id === 'os')!;
		const units = phraseUnits(os, t);
		expect(units.map((u) => u.pattern)).toEqual([TABLE['O'], TABLE['S']]);
		// Character gap between the letters, word gap after the last one.
		expect(units[0].gapAfterMs).toBe(t.charGapMs);
		expect(units[1].gapAfterMs).toBe(t.wordGapMs);
	});

	it('sends every letter of a numeric shorthand with a character gap', () => {
		const n269 = PHRASES.find((p) => p.id === 'n269')!;
		const units = phraseUnits(n269, t);
		expect(units).toHaveLength(3);
		expect(units.slice(0, 2).every((u) => u.gapAfterMs === t.charGapMs)).toBe(true);
		expect(units[2].gapAfterMs).toBe(t.wordGapMs);
	});

	it('treats a single-character phrase as one code', () => {
		const k = PHRASES.find((p) => p.id === 'k')!;
		const units = phraseUnits(k, t);
		expect(units).toHaveLength(1);
		expect(units[0].pattern).toBe(encode('K'));
	});
});

describe('phrase list', () => {
	it('has no duplicate ids', () => {
		const ids = PHRASES.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('puts every phrase in a declared category', () => {
		const known = new Set(PHRASE_CATEGORIES.map((c) => c.id));
		for (const phrase of PHRASES) {
			expect(known.has(phrase.category), phrase.id).toBe(true);
		}
	});

	it('only marks SOS as joined', () => {
		// Splitting the others is correct; splitting SOS is the one thing that
		// destroys the signal.
		expect(PHRASES.filter((p) => p.joined).map((p) => p.id)).toEqual(['sos']);
	});

	it('gives every phrase a meaning', () => {
		for (const phrase of PHRASES) {
			expect(phrase.meaning.trim().length, phrase.id).toBeGreaterThan(0);
		}
	});
});
