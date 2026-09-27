import { describe, expect, it } from 'vitest';
import {
	gradeKeying,
	gradeText,
	isKeyablePassage,
	keyingTarget,
	passageLayout,
	passageTarget,
	PASSAGES,
	targetChars,
} from './keying';
import { GROUPS } from './morse';
import { WORD_LIST } from './quiz';
import type { KeyingVerdict } from './keying';
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

describe('gradeText on a passage', () => {
	// Every letter of a passage, so the marks line up with the word gaps rather
	// than with the characters in the string.
	const marks = (v: KeyingVerdict) => v.marks.join(' ');

	it('waits while nothing has been sent', () => {
		const v = gradeText('ANT', '');
		expect(v.done).toBe(false);
		expect(marks(v)).toBe('pending pending pending');
	});

	it('takes a word gap as sent and calls the question done', () => {
		const v = gradeText('ANT', 'ANT');
		expect(v.done).toBe(true);
		expect(v.correct).toBe(true);
		expect(marks(v)).toBe('right right right');
	});

	it('marks the last character wrong but keeps going, and reports the first', () => {
		const v = gradeText('ANT', 'ANE');
		expect(v.done).toBe(true);
		expect(v.correct).toBe(false);
		expect(marks(v)).toBe('right right wrong');
		expect(v.wrongAt).toBe(2);
	});

	it('keeps sending past a wrong code, which is the point of a passage', () => {
		const v = gradeText('ANT', 'AXT');
		expect(v.done).toBe(true);
		expect(marks(v)).toBe('right wrong right');
		expect(v.wrongAt).toBe(1);
	});

	it('treats the gap inside a word as a pause it did not ask for', () => {
		const v = gradeText('ANT', 'A NT');
		expect(v.done).toBe(true);
		expect(v.spacingAt).toBe(1);
		expect(marks(v)).toBe('right gap right');
	});

	it('reads a missing gap as the words running together, letters and all', () => {
		// GO SO keyed as GOSOXO: the S lands where the gap after GO was wanted, so
		// the pause is charged to the O in front of it and the run carries on. A
		// passage lines the characters up rather than giving up on them, so the two
		// that follow are judged against S and O: the early O against the S it
		// should have waited for, and the X against the O that should have followed.
		const v = gradeText('GO SO', 'GOSOXO');
		expect(v.done).toBe(true);
		expect(v.spacingAt).toBe(1);
		expect(marks(v)).toBe('right gap wrong wrong');
		expect(v.wrongAt).toBe(2);
	});

	it('does not step on for a gap, so the letters either side still line up', () => {
		// The spurious gap is charged to N, and T is then judged against T rather
		// than against the gap.
		const v = gradeText('ANT', 'A  NT');
		expect(v.spacingAt).toBe(1);
		expect(marks(v)).toBe('right gap right');
	});

	it('stops at the first mistake when asked to, as a single target does', () => {
		const v = gradeText('ANT', 'AXT', { stopAtFirst: true });
		expect(v.done).toBe(true);
		expect(marks(v)).toBe('right wrong pending');
	});

	it('ignores a pause after the last character', () => {
		expect(gradeText('K', 'K ').correct).toBe(true);
		expect(gradeText('ANT', 'ANT  ').correct).toBe(true);
	});

	it('ignores a stray keypress after the last character, as a single target does', () => {
		// GO is one word, so there is no gap in it to miss and the third O is past
		// the end of the question rather than in the middle of it.
		expect(gradeText('GO', 'GOO').correct).toBe(true);
		expect(gradeText('GO SO', 'GO SOX').correct).toBe(true);
	});

	it('is not done until the word gaps are sent as well as the letters', () => {
		expect(gradeText('GO SO', 'GO SO').done).toBe(true);
		// Four characters with no pause in them can only ever fill G, the gap, O
		// and the second gap, so the run is still open.
		expect(gradeText('GO SO', 'GOSO').done).toBe(false);
		expect(gradeText('GO SO', 'GO').done).toBe(false);
	});

	it('grades the whole run rather than stopping at the first slip', () => {
		const v = gradeText('GO HOME', 'XO HOME');
		expect(v.done).toBe(true);
		expect(marks(v)).toBe('wrong right right right right right');
		expect(v.wrongAt).toBe(0);
		expect(v.correct).toBe(false);
	});

	it('reports only the first pause fault, since one is worth saying', () => {
		const v = gradeText('ANT', 'A N T');
		expect(v.spacingAt).toBe(1);
	});
});

describe('passageLayout', () => {
	it('says which box each word starts at', () => {
		expect(passageLayout('GO SO')).toEqual([
			{ word: 'GO', offset: 0 },
			{ word: 'SO', offset: 2 },
		]);
	});

	it('copes with a run of spaces and the ends', () => {
		expect(passageLayout('  A   BB ')).toEqual([
			{ word: 'A', offset: 0 },
			{ word: 'BB', offset: 1 },
		]);
		expect(passageLayout('')).toEqual([]);
	});
});

describe('the passage pool', () => {
	it('is nothing but words of letters, so it stays sendable', () => {
		expect(PASSAGES.length).toBeGreaterThan(20);
		for (const p of PASSAGES) {
			expect(isKeyablePassage(p), p).toBe(true);
			expect(p.length).toBeGreaterThan(4);
		}
	});

	it('has no passage twice', () => {
		expect(new Set(PASSAGES).size).toBe(PASSAGES.length);
	});

	it('draws only from the pool', () => {
		expect(PASSAGES).toContain(passageTarget({ random: fixed(0) }));
	});

	it('does not draw the passage just drawn twice running', () => {
		const first = passageTarget({ random: fixed(0) });
		const next = passageTarget({ previous: first, random: fixed(0) });
		expect(next).not.toBe(first);
		expect(PASSAGES).toContain(next);
	});

	it('keeps drawing when the pool is a single passage', () => {
		const only = ['SOS'];
		expect(passageTarget({ passages: only, previous: 'SOS', random: fixed(0) })).toBe('SOS');
	});

	it('refuses an empty pool rather than drawing nothing', () => {
		expect(() => passageTarget({ passages: [] })).toThrow();
		expect(() => passageTarget({ passages: ['123'] })).toThrow();
	});
});
