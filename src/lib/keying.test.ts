import { describe, expect, it } from 'vitest';
import { gradeKeying, keyingTarget, targetChars } from './keying';
import { GROUPS } from './morse';
import { WORD_LIST } from './quiz';
import type { StatsShape } from './stats.svelte';

function emptyStats(): StatsShape {
	return { chars: {}, answered: 0, correct: 0, bestStreak: 0, sessions: 0, bestSession: 0, lastSession: 0 };
}

/** Always draws the same value, so a target can be pinned. */
const fixed = (v: number) => () => v;

describe('gradeKeying', () => {
	it('waits while nothing has been sent', () => {
		expect(gradeKeying('K', '')).toEqual({
			marks: ['pending'],
			done: false,
			correct: false,
			wrongAt: -1,
			spacingAt: -1,
		});
	});

	it('marks a partly sent word as it goes', () => {
		const v = gradeKeying('ANT', 'AN');
		expect(v.marks).toEqual(['right', 'right', 'pending']);
		expect(v.done).toBe(false);
	});

	it('passes a target sent in full', () => {
		const v = gradeKeying('ANTENNA', 'ANTENNA');
		expect(v.marks).toEqual(['right', 'right', 'right', 'right', 'right', 'right', 'right']);
		expect(v).toMatchObject({ done: true, correct: true, wrongAt: -1 });
	});

	it('stops at the first character sent wrongly', () => {
		const v = gradeKeying('ANT', 'AXT');
		// Marking the rest of the row would bury the one that needs fixing.
		expect(v.marks).toEqual(['right', 'wrong', 'pending']);
		expect(v).toMatchObject({ done: true, correct: false, wrongAt: 1 });
	});

	it('fails a single character sent as the wrong code', () => {
		expect(gradeKeying('K', 'R')).toMatchObject({ correct: false, wrongAt: 0, done: true });
	});

	it('marks down a word gap inside a target, and still credits the codes around it', () => {
		// The pause is the fault, not the letters, so only the character the gap
		// displaced loses its point.
		const v = gradeKeying('ANT', 'A NT');
		expect(v.marks).toEqual(['right', 'gap', 'right']);
		expect(v).toMatchObject({ done: true, correct: false, wrongAt: -1, spacingAt: 1 });
	});

	it('lets the rest of the word be sent after a gap, since it is still worth the points', () => {
		expect(gradeKeying('ANT', 'A N')).toMatchObject({
			marks: ['right', 'gap', 'pending'],
			done: false,
			spacingAt: 1,
		});
	});

	it('charges only the first gap, since one mistake is the lesson', () => {
		expect(gradeKeying('ANT', 'A N T')).toMatchObject({
			marks: ['right', 'gap', 'right'],
			correct: false,
			spacingAt: 1,
		});
	});

	it('does not mind a pause after the last character, which ends the answer', () => {
		expect(gradeKeying('ET', 'ET ON')).toMatchObject({ correct: true, spacingAt: -1 });
		expect(gradeKeying('K', 'K ')).toMatchObject({ correct: true, spacingAt: -1 });
	});

	it('does not mind more being sent than the target asked for', () => {
		expect(gradeKeying('ET', 'ETON')).toMatchObject({ correct: true, done: true });
	});
});

describe('keyingTarget', () => {
	it('draws characters from the groups that are switched on', () => {
		const t = keyingTarget({ kind: 'char', groups: ['digits'], stats: emptyStats(), random: fixed(0.5) });
		expect(Object.values(GROUPS.digits)).toContain(t);
	});

	it('keeps to a single group when only one is on', () => {
		for (const group of ['letters', 'digits', 'punctuation'] as const) {
			for (let i = 0; i < 20; i++) {
				const t = keyingTarget({ kind: 'char', groups: [group], stats: emptyStats(), random: fixed(i / 20) });
				expect(Object.values(GROUPS[group])).toContain(t);
			}
		}
	});

	it('drills the characters the user is weak on', () => {
		const stats = emptyStats();
		stats.chars.Z = { seen: 20, correct: 0, streak: 0, best: 0, last: null, lastSeen: 0 };
		const seen = new Set<string>();
		for (let i = 0; i < 60; i++) {
			seen.add(keyingTarget({ kind: 'char', groups: ['letters'], stats, random: fixed((i % 10) / 10) }));
		}
		// A weak character is weighted 5x an unknown one, so it turns up in far
		// more than a twenty sixth of the draws.
		expect(seen.has('Z')).toBe(true);
	});

	it('draws single words of letters, never a group or an abbreviation', () => {
		for (let i = 0; i < 200; i++) {
			const t = keyingTarget({ kind: 'word', groups: ['letters'], stats: emptyStats(), random: fixed(i / 200) });
			expect(WORD_LIST).toContain(t);
			// A group like "R R" is for the receiver to hear a word gap, and 73 and
			// 59 are abbreviations, not words. Digits must not turn up in a target
			// on a session that switched them off.
			expect(t, `${t} is not a word of letters`).toMatch(/^[A-Z]+$/);
		}
	});

	it('says so when every word offered is a group or an abbreviation', () => {
		expect(() =>
			keyingTarget({ kind: 'word', groups: ['letters'], words: ['R R', '73'], stats: emptyStats() }),
		).toThrow(/empty/);
	});

	it('takes a word pool it is given', () => {
		const t = keyingTarget({
			kind: 'word',
			groups: ['letters'],
			words: ['SOS', 'CQ'],
			stats: emptyStats(),
			random: fixed(0.9),
		});
		expect(['SOS', 'CQ']).toContain(t);
	});

	it('says so when there is nothing to draw', () => {
		expect(() =>
			keyingTarget({ kind: 'word', groups: ['letters'], words: [], stats: emptyStats() }),
		).toThrow(/empty/);
	});
});

describe('targetChars', () => {
	it('splits a target into the characters the stats are kept against', () => {
		expect(targetChars('ANT').map((c) => c.char)).toEqual(['A', 'N', 'T']);
		expect(targetChars('K').map((c) => c.char)).toEqual(['K']);
		expect(targetChars('')).toEqual([]);
	});
});
