import {
	encode,
	encodePhrase,
	encodeText,
	GROUPS,
	type MorseChar,
	type MorseGroup,
	type MorseText,
} from './morse';
import { accuracy, needScore, type CharStat, type StatsShape } from './stats.svelte';

export type QuizMode = 'char' | 'word';

export type Option = { char: string; pattern: string };

export type Question = {
	/** Index into the option list of the correct answer. */
	answerIndex: number;
	options: Option[];
	/** The correct answer on its own. */
	solution: string;
	/** Pattern that was transmitted, as drawn: characters spaced, "/" for a word. */
	pattern: string;
	/** For word mode, the whole transmitted string. */
	text?: string;
	/** Every character in the message, flattened, for stats and display. */
	chars: MorseChar[];
	/** The message split into words, so playback can put a word gap in the right place. */
	groups: MorseText;
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
	'OVER',
	'KN KN',
	'SOS SOS',
	'CQ DE',
	'R R',
	'73 73',
	'HAM RADIO',
	'QTC QTC',
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

	// A word question is drawn from the word list, and its options are words too.
	// Offering a group of letters as the alternatives made the answer the only
	// thing on the button of the right length, which is not a question.
	if (opts.mode === 'word') return wordQuestion(WORDS, opts.choices, random);

	const solution = pickWeighted(chars, opts.stats, random);

	const solutionPattern = encode(solution) ?? '';
	const charsInMessage: MorseChar[] = encodeText(solution)[0]?.chars ?? [];
	const pattern = charsInMessage.map((c) => c.pattern).join(' ');

	// Distractors: prefer characters whose code is visually close to the answer,
	// because confusing those is the actual failure mode being trained. Anything
	// left over is filled from the next best scoring rather than at random, so a
	// question never ends up comparing a one element code with a five element one.
	const distractorPool = chars.filter((c) => c !== solution);
	const ranked = rankNear(solutionPattern, distractorPool);
	const wanted0 = Math.max(1, opts.choices - 1);
	const chosen0 = shuffle(ranked.slice(0, Math.min(ranked.length, wanted0 * 3)), random).slice(0, wanted0);
	const distractors = chosen0;

	const wanted = Math.max(2, opts.choices);
	const chosen = shuffle([...distractors.slice(0, wanted - 1), solution], random);
	const options: Option[] = chosen.map((c) => ({ char: c, pattern: encode(c) ?? '' }));

	return {
		answerIndex: options.findIndex((o) => o.char === solution),
		options,
		solution,
		pattern,
		chars: charsInMessage,
		groups: encodeText(solution),
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
 * Rank characters by how easily they could be mistaken for the answer, closest
 * first: a shared code prefix counts for something, a difference in length
 * counts against, since length is the other half of what you hear.
 */
function rankNear(pattern: string, candidates: string[]): string[] {
	const scored: Array<[string, number]> = [];
	for (const c of candidates) {
		const p = encode(c) ?? '';
		if (!p) continue;
		let shared = 0;
		while (shared < Math.min(p.length, pattern.length) && p[shared] === pattern[shared]) shared++;
		scored.push([c, shared - Math.abs(p.length - pattern.length) * 0.5]);
	}
	return scored.sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

/**
 * Rank words by how hard they are to tell apart by ear.
 *
 * Length dominates on purpose. A question offering MORSE against A and T is
 * answered by counting characters, not by reading the code, so the length
 * difference is weighted far heavier than the letters they happen to share.
 */
function scoreWord(solution: string, word: string): number {
	const wantChars = solution.replace(/\s/g, '').length;
	const chars = word.replace(/\s/g, '').length;
	const wantWords = solution.trim().split(/\s+/).length;
	const words = word.trim().split(/\s+/).length;
	let shared = 0;
	while (shared < Math.min(word.length, solution.length) && word[shared] === solution[shared]) shared++;
	// Length dominates on purpose. A question offering MORSE against A and T is
	// answered by counting characters, not by reading the code.
	return -Math.abs(chars - wantChars) * 10 - Math.abs(words - wantWords) * 3 + shared;
}

function rankWords(solution: string, candidates: string[]): string[] {
	return candidates
		.map((w) => [w, scoreWord(solution, w)] as const)
		.sort((a, b) => b[1] - a[1])
		.map(([w]) => w);
}

function wordQuestion(words: string[], choices: number, random: () => number): Question {
	const unique = [...new Set(words)];
	const solution = pick(unique, random);
	const wanted = Math.max(1, choices - 1);
	const ranked = rankWords(solution, unique.filter((w) => w !== solution));

	// Take the alternatives from the band that scores close to the best one, so
	// they are the same size as the answer, then shuffle within it so the same
	// word is not always offered with the same three. A wide band was the wrong
	// shape here: answering HAM RADIO left nothing of the same length, so the
	// band reached all the way down to the shortest words in the list.
	const NEAR = 6;
	const best = ranked.length ? scoreWord(solution, ranked[0]) : 0;
	const band = ranked.filter((w) => scoreWord(solution, w) >= best - NEAR);
	const shortlist = band.length >= wanted ? band : ranked.slice(0, wanted);
	const distractors = shuffle(shortlist, random).slice(0, wanted);
	const options = shuffle([...distractors, solution], random);
	const groups = encodeText(solution);
	return {
		answerIndex: options.indexOf(solution),
		options: options.map((w) => ({ char: w, pattern: encodePhrase(w) })),
		solution,
		pattern: encodePhrase(solution),
		chars: groups.flatMap((w) => w.chars),
		groups,
		text: solution,
	};
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
