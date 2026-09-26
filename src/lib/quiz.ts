import { encode, encodeText, GROUPS, type MorseChar, type MorseGroup } from './morse';
import { accuracy, needScore, type CharStat, type StatsShape } from './stats.svelte';

export type QuizMode = 'char' | 'word';

export type Option = { char: string; pattern: string };

export type Question = {
	/** Index into the option list of the correct answer. */
	answerIndex: number;
	options: Option[];
	/** The correct answer on its own. */
	solution: string;
	/** Pattern that was transmitted. */
	pattern: string;
	/** For word mode, the whole transmitted string. */
	text?: string;
	/** Individual characters, for playback and word mode. */
	chars: MorseChar[];
};

export type QuizState = 'idle' | 'asking' | 'answered';

const WORDS = [
	'SOS',
	'HELP',
	'CQ',
	'OK',
	'YES',
	'NO',
	'R',
	'RR',
	'73',
	'QTH',
	'QSL',
	'ANTENNA',
	'RADIO',
	'MORSE',
	'COPY',
	'KEY',
	'BEACON',
	'RECEIVE',
	'TRANSMIT',
	'GOOD',
	'NIGHT',
	'BUDDY',
	'OM',
	'SK',
	'YES',
];

function rng(): number {
	return Math.random();
}

function pick<T>(items: T[], random: () => number = rng): T {
	return items[Math.floor(random() * items.length)];
}

/** Characters the quiz is allowed to ask about, given the pool toggles. */
export function pool(groups: MorseGroup[]): string[] {
	return groups.flatMap((g) => GROUPS[g]);
}

export function defaultGroups(includeDigits: boolean, includePunct: boolean): MorseGroup[] {
	const groups: MorseGroup[] = ['letters'];
	if (includeDigits) groups.push('digits');
	if (includePunct) groups.push('punctuation');
	return groups;
}

/**
 * Pick the next question, favouring characters the user is weak on.
 *
 * Weighted sampling rather than a strict weak-first queue: a strict queue would
 * grind the same three characters and the user would never meet anything else.
 * A character at maximum need is weighted 5x an unknown one, so a single weak
 * letter takes roughly a sixth of the session — enough to fix it, not enough
 * to crowd out everything else.
 */
export function nextQuestion(opts: {
	groups: MorseGroup[];
	mode: QuizMode;
	choices: number;
	stats: StatsShape;
	random?: () => number;
}): Question {
	const random = opts.random ?? rng;
	const chars = pool(opts.groups);
	const solution = opts.mode === 'char' ? pickWeighted(chars, opts.stats, random) : pick(WORDS, random);

	const solutionPattern = encode(solution) ?? '';
	const charsInMessage: MorseChar[] = encodeText(solution)[0]?.chars ?? [];
	const pattern = charsInMessage.map((c) => c.pattern).join(' ');

	// Distractors: prefer characters whose code is visually close to the answer,
	// because confusing those is the actual failure mode being trained.
	const distractorPool = chars.filter((c) => c !== solution);
	const near = pickNear(solutionPattern, solution, distractorPool, opts.choices - 1, random);
	const filler = distractorPool.filter((c) => c !== solution && !near.includes(c));
	const distractors = [...near, ...shuffle(filler, random).slice(0, Math.max(0, opts.choices - 1 - near.length))];

	const wanted = Math.max(2, opts.choices);
	const chosen = shuffle([...distractors.slice(0, wanted - 1), solution], random);
	const options: Option[] = chosen.map((c) => ({ char: c, pattern: encode(c) ?? '' }));

	return {
		answerIndex: options.findIndex((o) => o.char === solution),
		options,
		solution,
		pattern,
		chars: charsInMessage,
		text: opts.mode === 'word' ? solution : undefined,
	};
}

function shuffle<T>(items: T[], random: () => number = rng): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

export function pickWeighted(
	chars: string[],
	stats: StatsShape,
	random: () => number = rng,
	now = Date.now(),
): string {
	if (!chars.length) throw new Error('empty pool');
	const weights = chars.map((c) => {
		const stat = stats.chars[c];
		if (!stat || stat.seen === 0) return 1;
		// need is 0 for a mastered character, so it falls back to the same
		// weight as an unseen one: still in rotation, just not prioritised.
		return 1 + 4 * needScore(stat, now);
	});
	const total = weights.reduce((a, b) => a + b, 0);
	let roll = random() * total;
	for (let i = 0; i < chars.length; i++) {
		roll -= weights[i];
		if (roll <= 0) return chars[i];
	}
	return chars[chars.length - 1];
}

/**
 * Characters whose code shares a prefix with the answer, e.g. for "N" (-.)
 * suggest "D" (-..) and "K" (-.-), which is where the real mix-ups are.
 */
function pickNear(
	pattern: string,
	solution: string,
	candidates: string[],
	count: number,
	random: () => number,
): string[] {
	if (count <= 0) return [];
	const scores: Array<[string, number]> = [];
	for (const c of candidates) {
		const p = encode(c) ?? '';
		if (!p) continue;
		let shared = 0;
		while (shared < Math.min(p.length, pattern.length) && p[shared] === pattern[shared]) shared++;
		scores.push([c, shared - Math.abs(p.length - pattern.length) * 0.5]);
	}
	return scores
		.sort((a, b) => b[1] - a[1])
		.slice(0, Math.max(1, count))
		.map(([c]) => c)
		.filter((c) => c !== solution);
}

/** Per-character summary rows for the stats view, worst accuracy first. */
export type SummaryRow = {
	char: string;
	pattern: string;
	stat: CharStat;
	accuracy: number;
	need: number;
};

export function summarise(
	chars: string[],
	stats: StatsShape,
	now = Date.now(),
): SummaryRow[] {
	return chars
		.map((char) => {
			const stat = stats.chars[char] ?? { seen: 0, correct: 0, streak: 0, best: 0, last: null, lastSeen: 0 };
			return {
				char,
				pattern: encode(char) ?? '',
				stat,
				accuracy: accuracy(stat),
				need: needScore(stat, now),
			};
		})
		.sort((a, b) => b.need - a.need || a.char.localeCompare(b.char));
}
