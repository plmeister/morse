import { describe, expect, it } from 'vitest';
import {
	candidates,
	decode,
	elements,
	encode,
	encodeText,
	extensions,
	GROUPS,
	isComplete,
	renderPattern,
	TABLE,
} from './morse';

describe('table', () => {
	it('covers A-Z and 0-9 exactly once', () => {
		const letters = GROUPS.letters;
		expect(letters).toHaveLength(26);
		expect(new Set(letters).size).toBe(26);
		for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(letters).toContain(ch);

		const digits = GROUPS.digits;
		expect(digits).toHaveLength(10);
		for (const d of '0123456789') expect(digits).toContain(d);
	});

	it('has no code collisions', () => {
		const seen = new Map<string, string>();
		for (const [char, pattern] of Object.entries(TABLE)) {
			const prior = seen.get(pattern);
			expect(prior, `${pattern} used by both ${prior} and ${char}`).toBeUndefined();
			seen.set(pattern, char);
		}
	});

	it('uses only dots and dashes', () => {
		for (const [char, pattern] of Object.entries(TABLE)) {
			expect(pattern, char).toMatch(/^[.-]+$/);
		}
	});

	it('keeps letters and digits to the standard lengths', () => {
		// Letters are at most four elements, digits five; the six-element codes
		// are all punctuation.
		for (const char of GROUPS.letters) {
			const pattern = encode(char)!;
			expect(pattern.length, char).toBeGreaterThanOrEqual(1);
			expect(pattern.length, char).toBeLessThanOrEqual(4);
		}
		for (const char of GROUPS.digits) {
			const pattern = encode(char)!;
			expect(pattern.length, char).toBe(5);
		}
		// Punctuation is the only place the longer codes live: / is five
		// elements and $ (\u0024) is seven.
		for (const char of GROUPS.punctuation) {
			const length = encode(char)!.length;
			expect(length, char).toBeGreaterThanOrEqual(5);
			expect(length, char).toBeLessThanOrEqual(7);
		}
	});

	it('never runs more than five of one element', () => {
		for (const [char, pattern] of Object.entries(TABLE)) {
			const dots = [...pattern].filter((c) => c === '.').length;
			expect(Math.max(dots, pattern.length - dots), char).toBeLessThanOrEqual(5);
		}
	});
});

describe('encode / decode', () => {
	it('round-trips every character', () => {
		for (const char of Object.keys(TABLE)) {
			expect(decode(encode(char)!)).toBe(char);
		}
	});

	it('accepts lowercase', () => {
		expect(encode('s')).toBe('...');
		expect(encode('S')).toBe('...');
	});

	it('returns undefined for spaces and unknowns', () => {
		expect(encode(' ')).toBeUndefined();
		expect(encode('☃')).toBeUndefined();
	});

	it('returns undefined for incomplete codes', () => {
		expect(decode('')).toBeUndefined();
		expect(decode('-')).toBe('T');
		expect(decode('-..-')).toBe('X');
		expect(decode('----')).toBeUndefined();
		// The semicolon code is -.-.-. with a trailing dot.
		expect(decode('-.-.-')).toBeUndefined();
		expect(decode('-.-.-.')).toBe(';');
		expect(decode('.-.-.-')).toBe('.');
	});

	it('is not confused by prefix codes', () => {
		expect(decode('.')).toBe('E');
		expect(decode('..')).toBe('I');
		expect(decode('...')).toBe('S');
		expect(decode('....')).toBe('H');
		expect(decode('.....')).toBe('5');
		expect(decode('-')).toBe('T');
		expect(decode('--')).toBe('M');
		expect(decode('---')).toBe('O');
		expect(decode('----')).toBeUndefined();
		expect(decode('-----')).toBe('0');
	});
});

describe('encodeText', () => {
	it('splits on whitespace and drops unencodable characters', () => {
		const msg = encodeText('Hi ☃ there');
		expect(msg).toHaveLength(2);
		expect(msg[0].word).toBe('Hi');
		expect(msg[0].chars.map((c) => c.char)).toEqual(['H', 'I']);
		expect(msg[1].word).toBe('there');
	});

	it('encodes punctuation', () => {
		const msg = encodeText('a.b');
		expect(msg[0].chars[1].pattern).toBe('.-.-.-');
	});
});

describe('elements', () => {
	it('splits into typed symbols', () => {
		expect(elements('.-')).toEqual(['.', '-']);
	});
});

describe('candidates', () => {
	it('returns everything for an empty buffer', () => {
		expect(candidates('')).toHaveLength(Object.keys(TABLE).length);
	});

	it('only returns characters whose code extends the buffer', () => {
		const c = extensions('..');
		expect(c).toContain('I');
		expect(c).toContain('U');
		expect(c).toContain('V');
		expect(c).toContain('2');
		// Already complete codes are not extensions of a longer buffer.
		expect(c).not.toContain('E');
		expect(c).not.toContain('A');
		// ---.. is a five-element digit, not an extension of two dots.
		expect(c).not.toContain('8');
		// Punctuation with six elements is in scope too.
		expect(c).toContain('?');
	});

	it('includes the character currently being keyed', () => {
		expect(extensions('-.')).toContain('N');
		expect(extensions('-.')).toContain('K');
		expect(extensions('-.')).toContain('D');
		expect(extensions('-')).toContain('T');
	});

	it('includes the exact match', () => {
		expect(extensions('-')).toContain('T');
		expect(extensions('...')).toContain('S');
	});

	it('is empty once the buffer is a dead end', () => {
		// Nothing in the table starts with six dots, and the buffer is longer
		// than every code it contains.
		expect(extensions('......')).toEqual([]);
		expect(extensions('-.-.-.-')).toEqual([]);
		expect(extensions('.-.-.-.-.-')).toEqual([]);

		// Over-keying a code that has a six-element form still leaves live cells
		// only when those longer forms exist.
		expect(extensions('-.-.-.')).toEqual([';']);
		expect(extensions('-..-.')).toEqual(['/']);
	});

	it('keeps every character reachable through each prefix of its code', () => {
		for (const [char, pattern] of Object.entries(TABLE)) {
			for (let i = 0; i <= pattern.length; i++) {
				expect(extensions(pattern.slice(0, i)), `${char} at ${i}`).toContain(char);
			}
		}
	});

	it('reports over-keyed elements as the shorter codes they contain', () => {
		// Six elements cannot begin any code, but several short codes are
		// prefixes of it, so they are still plausible continuations.
		expect(candidates('-.-.-.-').sort()).toEqual([';', 'C', 'K', 'N', 'T']);
	});

	it('treats an empty buffer as no filter', () => {
		expect(candidates('')).toHaveLength(Object.keys(TABLE).length);
		expect(extensions('')).toHaveLength(Object.keys(TABLE).length);
	});

	it('always includes the answer while it is still reachable', () => {
		for (const [char, pattern] of Object.entries(TABLE)) {
			for (let i = 1; i <= pattern.length; i++) {
				expect(candidates(pattern.slice(0, i)), `${char} at ${i}`).toContain(char);
			}
		}
	});
});

describe('isComplete', () => {
	it('is true only for a decodable non-empty code', () => {
		expect(isComplete('.-')).toBe(true);
		expect(isComplete('-')).toBe(true);
		expect(isComplete('----')).toBe(false);
		expect(isComplete('-.-.-.')).toBe(true);
		expect(isComplete('')).toBe(false);
		expect(isComplete('......')).toBe(false);
	});
});

describe('renderPattern', () => {
	it('uses glyphs by default and can fall back to ascii', () => {
		expect(renderPattern('.-')).toBe('\u2022 \u2014');
		expect(renderPattern('.-', { glyphs: false })).toBe('. -');
		expect(renderPattern('.-', { glyphs: false, spaced: false })).toBe('.-');
		expect(renderPattern('')).toBe('');
	});
});
