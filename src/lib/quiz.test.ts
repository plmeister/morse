import { describe, expect, it } from 'vitest';
import { defaultGroups, nextQuestion, pickWeighted, pool, summarise } from './quiz';
import { GROUPS, encode, type MorseGroup } from './morse';
import type { StatsShape } from './stats.svelte';
import { needScore, type CharStat } from './stats.svelte';

/** Deterministic PRNG so failures are reproducible. */
/**
 * A small deterministic generator, so a failure can be reproduced from its seed.
 *
 * This is mulberry32 rather than a plain LCG because an LCG's first output
 * barely moves with its seed: the old one returned 0.2365 to 0.2380 across
 * seeds 1 to 60, so every seeded question was drawing almost the same word and
 * a loop over sixty seeds was really testing two or three cases.
 */
function seeded(seed: number): () => number {
	let a = (seed + 0x6d2b79f5) >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
	};
}

function emptyStats(): StatsShape {
	return { chars: {}, answered: 0, correct: 0, bestStreak: 0, sessions: 0, bestSession: 0, lastSession: 0 };
}

function statFor(over: Partial<CharStat>): CharStat {
	return { seen: 0, correct: 0, streak: 0, best: 0, last: null, lastSeen: 0, ...over };
}

describe('pool', () => {
	it('includes only the requested groups', () => {
		expect(pool(['letters'])).toHaveLength(26);
		expect(pool(['letters', 'digits'])).toHaveLength(36);
		expect(pool(['letters', 'digits', 'punctuation'])).toHaveLength(Object.keys(GROUPS.letters).length + 10 + Object.keys(GROUPS.punctuation).length);
	});

	it('starts with letters and appends the extras', () => {
		expect(defaultGroups(false, false)).toEqual(['letters']);
		expect(defaultGroups(true, false)).toEqual(['letters', 'digits']);
		expect(defaultGroups(true, true)).toEqual(['letters', 'digits', 'punctuation']);
		expect(defaultGroups(false, true)).toEqual(['letters', 'punctuation']);
	});
});

describe('needScore', () => {
	it('gives a character never seen a mild priority', () => {
		// Not a weakness, but the user has not met it either.
		expect(needScore(undefined, Date.now())).toBeCloseTo(0.35, 5);
		expect(needScore(statFor({}), Date.now())).toBeCloseTo(0.35, 5);
	});

	it('is high for a character that is always wrong', () => {
		const now = Date.now();
		const weak = needScore(statFor({ seen: 6, correct: 0, streak: 0, last: 'wrong', lastSeen: now }), now);
		expect(weak).toBeGreaterThan(0.9);
	});

	it('is low for a character that is always right', () => {
		const now = Date.now();
		const strong = needScore(statFor({ seen: 20, correct: 20, streak: 20, last: 'right', lastSeen: now }), now);
		expect(strong).toBeLessThan(0.05);
	});

	it('ranks a recent miss above a recent success with the same history', () => {
		const now = Date.now();
		const history = { seen: 10, correct: 5, lastSeen: now };
		const wrong = needScore(statFor({ ...history, last: 'wrong' }), now);
		const right = needScore(statFor({ ...history, last: 'right' }), now);
		expect(wrong).toBeGreaterThan(right);
	});

	it('decays toward a floor as the last attempt ages', () => {
		const now = Date.now();
		const recent = needScore(statFor({ seen: 6, correct: 0, last: 'wrong', lastSeen: now }), now);
		const old = needScore(
			statFor({ seen: 6, correct: 0, last: 'wrong', lastSeen: now - 60 * 86_400_000 }),
			now,
		);
		expect(old).toBeLessThan(recent);
		expect(old).toBeGreaterThan(recent * 0.5);
	});

	it('stays within 0..1', () => {
		const now = Date.now();
		for (const s of [
			statFor({ seen: 100, correct: 0, streak: 0, last: 'wrong', lastSeen: now }),
			statFor({ seen: 100, correct: 100, streak: 100, last: 'right', lastSeen: now }),
		]) {
			const n = needScore(s, now);
			expect(n).toBeGreaterThanOrEqual(0);
			expect(n).toBeLessThanOrEqual(1);
		}
	});
});

describe('pickWeighted', () => {
	const letters = GROUPS.letters;

	it('returns a member of the pool', () => {
		expect(letters).toContain(pickWeighted(letters, emptyStats(), seeded(1)));
	});

	it('throws on an empty pool', () => {
		expect(() => pickWeighted([], emptyStats(), seeded(1))).toThrow();
	});

	it('picks the only candidate when there is one', () => {
		expect(pickWeighted(['Z'], emptyStats(), seeded(1))).toBe('Z');
	});

	it('favours a character that keeps being got wrong', () => {
		const stats = emptyStats();
		// B has been seen 40 times and answered correctly once.
		stats.chars = { B: statFor({ seen: 40, correct: 1, streak: 0, last: 'wrong', lastSeen: Date.now() }) };

		const random = seeded(7);
		let b = 0;
		const runs = 4000;
		for (let i = 0; i < runs; i++) {
			if (pickWeighted(letters, stats, random) === 'B') b++;
		}
		const share = b / runs;
		// Uniform would be ~1/26 = 3.8%. B is the worst character, weighted 5x,
		// so it should take roughly 5/30 = 16.7% of picks.
		expect(share).toBeGreaterThan(0.13);
		expect(share).toBeLessThan(0.22);
	});

	it('still turns up a character the user has mastered', () => {
		const stats = emptyStats();
		stats.chars = { B: statFor({ seen: 100, correct: 100, streak: 100, last: 'right', lastSeen: Date.now() }) };

		const random = seeded(11);
		let b = 0;
		const runs = 8000;
		for (let i = 0; i < runs; i++) {
			if (pickWeighted(letters, stats, random) === 'B') b++;
		}
		// Floor of 0.25 weight out of ~26.4 total, so roughly 1%.
		expect(b / runs).toBeGreaterThan(0);
		expect(b / runs).toBeLessThan(0.05);
	});

	it('is unbiased when nothing is known yet', () => {
		const random = seeded(3);
		const counts: Record<string, number> = {};
		const runs = 26 * 400;
		for (let i = 0; i < runs; i++) {
			const c = pickWeighted(letters, emptyStats(), random);
			counts[c] = (counts[c] ?? 0) + 1;
		}
		const expected = runs / 26;
		for (const c of letters) {
			// Loose bound: catches a hard bias without being flaky.
			expect(counts[c], c).toBeGreaterThan(expected * 0.8);
			expect(counts[c], c).toBeLessThan(expected * 1.2);
		}
	});
});

describe('nextQuestion', () => {
	const base = { groups: ['letters'] as const, choices: 4 };

	it('produces a question with the requested number of options', () => {
		const q = nextQuestion({ ...base, groups: ['letters'], mode: 'char', stats: emptyStats(), random: seeded(5) });
		expect(q.options).toHaveLength(4);
	});

	it('includes the answer exactly once', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const q = nextQuestion({ ...base, groups: ['letters'], mode: 'char', stats: emptyStats(), random: seeded(seed) });
			const matches = q.options.filter((o) => o.char === q.solution);
			expect(matches, `seed ${seed}`).toHaveLength(1);
			expect(q.options[q.answerIndex].char).toBe(q.solution);
		}
	});

	it('has no duplicate options', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const q = nextQuestion({ ...base, groups: ['letters'], mode: 'char', stats: emptyStats(), random: seeded(seed) });
			const chars = q.options.map((o) => o.char);
			expect(new Set(chars).size, `seed ${seed}: ${chars}`).toBe(chars.length);
		}
	});

	it('carries the correct pattern for the answer', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const q = nextQuestion({ ...base, groups: ['letters'], mode: 'char', stats: emptyStats(), random: seeded(seed) });
			expect(q.pattern).toBe(encode(q.solution));
			expect(q.options[q.answerIndex].pattern).toBe(encode(q.solution));
		}
	});

	it('honours a larger option count', () => {
		const q = nextQuestion({ groups: ['letters'], mode: 'char', choices: 6, stats: emptyStats(), random: seeded(9) });
		expect(q.options).toHaveLength(6);
		expect(new Set(q.options.map((o) => o.char)).size).toBe(6);
	});

	it('stays inside the enabled groups', () => {
		const q = nextQuestion({
			groups: ['letters'],
			mode: 'char',
			choices: 4,
			stats: emptyStats(),
			random: seeded(13),
		});
		for (const o of q.options) {
			expect(GROUPS.letters, o.char).toContain(o.char);
		}
	});

	it('builds a word question from a word', () => {
		const q = nextQuestion({ groups: ['letters'], mode: 'word', choices: 4, stats: emptyStats(), random: seeded(17) });
		expect(q.text).toMatch(/^[A-Z0-9]+$/);
		expect(q.solution).toBe(q.text);
		expect(q.chars.length).toBe(q.text!.length);
		expect(q.pattern).toBe(q.chars.map((c) => c.pattern).join(' '));
	});

	it('is reproducible from its seed', () => {
		// Every draw has to come from the injected generator. When the word was
		// picked from the global one, the same seed gave a different question each
		// run, which is what made this suite fail now and then in CI.
		const opts = { groups: ['letters'] as MorseGroup[], mode: 'word' as const, choices: 4, stats: emptyStats() };
		const a = nextQuestion({ ...opts, random: seeded(17) });
		const b = nextQuestion({ ...opts, random: seeded(17) });
		expect(a.solution).toBe(b.solution);
		expect(a.options).toEqual(b.options);
		expect(a.answerIndex).toBe(b.answerIndex);
	});

	it('offers words of much the same length in word mode', () => {
		// The point of the ranking: a group is not identifiable by counting
		// characters, so no alternative may be a wildly different size.
		const bare = (w: string) => w.replace(/\s/g, '').length;
		for (let seed = 1; seed <= 60; seed++) {
			const q = nextQuestion({
				groups: ['letters'],
				mode: 'word',
				choices: 4,
				stats: emptyStats(),
				random: seeded(seed),
			});
			const answer = bare(q.solution);
			for (const o of q.options) {
				expect(
					Math.abs(bare(o.char) - answer),
					`seed ${seed}: ${q.solution} against ${o.char}`,
				).toBeLessThanOrEqual(2);
			}
		}
	});

	it('keeps every word option a real word', () => {
		for (let seed = 1; seed <= 40; seed++) {
			const q = nextQuestion({
				groups: ['letters'],
				mode: 'word',
				choices: 4,
				stats: emptyStats(),
				random: seeded(seed),
			});
			for (const o of q.options) expect(o.char).toMatch(/^[A-Z0-9]+( [A-Z0-9]+)*$/);
		}
	});

	it('draws the whole group for word mode, spaces included', () => {
		let sawGap = false;
		for (let seed = 1; seed <= 60 && !sawGap; seed++) {
			const q = nextQuestion({
				groups: ['letters'],
				mode: 'word',
				choices: 4,
				stats: emptyStats(),
				random: seeded(seed),
			});
			expect(q.text).toBe(q.solution);
			expect(q.chars).toHaveLength(q.solution.replace(/\s/g, '').length);
			expect(q.groups.map((g) => g.word).join(' ')).toBe(q.solution);
			// A group is drawn with a slash where the word gap is.
			if (q.solution.includes(' ')) {
				sawGap = true;
				expect(q.pattern).toContain('/');
				expect(q.options[q.answerIndex].pattern).toBe(q.pattern);
			}
		}
		expect(sawGap, 'a group with a space came up in 60 draws').toBe(true);
	});

	it('includes the word answer exactly once', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const q = nextQuestion({
				groups: ['letters'],
				mode: 'word',
				choices: 4,
				stats: emptyStats(),
				random: seeded(seed),
			});
			expect(q.options.filter((o) => o.char === q.solution), `seed ${seed}`).toHaveLength(1);
			expect(q.options[q.answerIndex].char).toBe(q.solution);
			expect(new Set(q.options.map((o) => o.char)).size).toBe(q.options.length);
		}
	});

	it('only uses digits and punctuation when enabled', () => {
		const q = nextQuestion({
			groups: ['punctuation'],
			mode: 'char',
			choices: 4,
			stats: emptyStats(),
			random: seeded(19),
		});
		expect(GROUPS.punctuation).toContain(q.solution);
	});

	it('does not stall on a single-character pool', () => {
		// One letter means only one possible answer; the question must still be
		// well formed rather than repeating the answer as its own distractor.
		const q = nextQuestion({ groups: ['letters'], mode: 'char', choices: 4, stats: emptyStats(), random: seeded(23) });
		expect(q.options.length).toBeGreaterThanOrEqual(2);
	});
});

describe('summarise', () => {
	it('lists worst characters first', () => {
		const stats = emptyStats();
		stats.chars = {
			A: statFor({ seen: 10, correct: 10, last: 'right', lastSeen: Date.now() }),
			B: statFor({ seen: 10, correct: 0, last: 'wrong', lastSeen: Date.now() }),
		};
		const rows = summarise(GROUPS.letters, stats);
		expect(rows[0].char).toBe('B');
		expect(rows[0].accuracy).toBe(0);
		expect(rows[rows.length - 1].char).toBe('A');
		expect(rows[rows.length - 1].accuracy).toBe(1);
	});

	it('includes characters with no history at zero accuracy', () => {
		const rows = summarise(['A'], emptyStats());
		expect(rows).toHaveLength(1);
		expect(rows[0].stat.seen).toBe(0);
		expect(rows[0].accuracy).toBe(0);
		expect(rows[0].pattern).toBe('.-');
	});
});
