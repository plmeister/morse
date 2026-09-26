import { isBrowser, readJSON, writeJSON } from './storage';

const KEY = 'morse.stats.v1';

/** Per-character record. Only quiz answers move these, not free keying. */
export type CharStat = {
	/** Times this character has come up. */
	seen: number;
	correct: number;
	/** Consecutive correct answers. */
	streak: number;
	best: number;
	/** Result of the most recent attempt. */
	last: 'right' | 'wrong' | null;
	/** Epoch ms of the most recent attempt, used to spot stale weaknesses. */
	lastSeen: number;
};

export type StatsShape = {
	chars: Record<string, CharStat>;
	/** Lifetime totals across all sessions. */
	answered: number;
	correct: number;
	bestStreak: number;
	sessions: number;
	/** Best accuracy in a single session, 0-1. */
	bestSession: number;
	/** Epoch ms of the last completed session. */
	lastSession: number;
};

function emptyStat(): CharStat {
	return { seen: 0, correct: 0, streak: 0, best: 0, last: null, lastSeen: 0 };
}

const EMPTY: StatsShape = {
	chars: {},
	answered: 0,
	correct: 0,
	bestStreak: 0,
	sessions: 0,
	bestSession: 0,
	lastSession: 0,
};

function load(): StatsShape {
	return readJSON<StatsShape>(KEY, structuredClone(EMPTY), (base, stored) => {
		const parsed = stored as Partial<StatsShape>;
		// A stored record may predate a field, or be missing entirely.
		return { ...base, ...parsed, chars: parsed.chars ?? {} };
	});
}

/** A character needs work if it is wrong often, or wrong most recently. */
export const WEAK_MIN_ATTEMPTS = 3;
export const WEAK_ACCURACY = 0.7;

export function accuracy(stat: CharStat | undefined): number {
	if (!stat || stat.seen === 0) return 0;
	return stat.correct / stat.seen;
}

/**
 * How badly a character needs practice, 0 (none) to 1 (urgent).
 *
 * Blends lifetime accuracy with recency so a character fixed last week ranks
 * below one that was just got wrong three times running.
 */
export function needScore(stat: CharStat | undefined, now: number): number {
	if (!stat || stat.seen === 0) return 0.35;
	const acc = stat.correct / stat.seen;
	let score = 1 - acc;
	if (stat.last === 'wrong') score += 0.25;
	if (stat.streak === 0 && stat.seen >= 2) score += 0.15;
	// Decay toward zero over a fortnight, floor 60% of the score.
	const ageDays = now - stat.lastSeen > 0 ? (now - stat.lastSeen) / 86_400_000 : 0;
	const recency = Math.max(0.6, 1 - ageDays / 14);
	return Math.min(1, score * recency);
}

export class Stats {
	#data = $state<StatsShape>(load());

	constructor() {
		if (isBrowser()) {
			// Detached effect: this store outlives any single component, so the
			// write-back needs its own root rather than a caller's context.
			$effect.root(() => {
				$effect(() => {
					writeJSON(KEY, $state.snapshot(this.#data));
				});
			});
		}
	}

	get raw() {
		return this.#data;
	}

	get accuracy(): number {
		return this.#data.answered === 0 ? 0 : this.#data.correct / this.#data.answered;
	}

	get currentStreakBest(): number {
		return this.#data.bestStreak;
	}

	stat(char: string): CharStat {
		return this.#data.chars[char] ?? emptyStat();
	}

	/** Characters that most need practice, worst first. */
	weakest(limit = 26, now = Date.now()): Array<{ char: string; stat: CharStat; need: number }> {
		return Object.entries(this.#data.chars)
			.map(([char, stat]) => ({ char, stat, need: needScore(stat, now) }))
			.filter((x) => x.stat.seen > 0 && x.need > 0.15)
			.sort((a, b) => b.need - a.need)
			.slice(0, limit);
	}

	/** Characters never seen, for a "what should I learn next" list. */
	unseen(chars: string[]): string[] {
		return chars.filter((c) => !this.#data.chars[c]);
	}

	recordAnswer(char: string, correct: boolean) {
		const stat = this.#data.chars[char] ?? emptyStat();
		stat.seen += 1;
		stat.lastSeen = Date.now();
		if (correct) {
			stat.correct += 1;
			stat.streak += 1;
			stat.best = Math.max(stat.best, stat.streak);
			stat.last = 'right';
		} else {
			stat.streak = 0;
			stat.last = 'wrong';
		}
		this.#data.chars[char] = stat;

		this.#data.answered += 1;
		if (correct) this.#data.correct += 1;
		this.#data.bestStreak = Math.max(this.#data.bestStreak, stat.streak);
	}

	recordSession(correct: number, answered: number) {
		const acc = answered === 0 ? 0 : correct / answered;
		this.#data.sessions += 1;
		this.#data.lastSession = Date.now();
		this.#data.bestSession = Math.max(this.#data.bestSession, acc);
	}

	reset() {
		this.#data = structuredClone(EMPTY);
	}
}

export const stats = new Stats();
