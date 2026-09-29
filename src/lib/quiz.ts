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

/**
 * The words a word question can be drawn from.
 *
 * Weighted to what a contact actually sounds like rather than to English word
 * frequency. A frequency ranking of written prose is mostly function words and
 * nouns nobody sends, so the Q codes, the procedure words and the gear and
 * signal vocabulary lead, and the English that fills in the rest of a sentence
 * follows. Six entries are sent as one phrase, because a group is a thing you
 * learn as a unit.
 *
 * Kept as data rather than folded into the generator so it can be swapped and
 * tested on its own: a list that cannot be handed to `nextQuestion` cannot be
 * checked for the property the quiz depends on, which is that every word in it
 * can make a fair question.
 *
 * Nothing here is a single character. One letter has no rivals of its own
 * length, so it would be the only thing on the options row of the right size,
 * which is the same flaw as offering MORSE against A. Letters are the char
 * mode's job.
 */
export const WORD_LIST: readonly string[] = [
	// Q codes, which are most of what a contact sounds like.
	'QSL',
	'QRZ',
	'QTH',
	'QRS',
	'QRK',
	'QRL',
	'QRT',
	'QRV',
	'QSY',
	'QSO',
	'QTC',
	'QRM',
	'QRP',
	// Procedure words, and the run-on sentences built out of them.
	'ROGER',
	'WILCO',
	'OVER',
	'BREAK',
	'COPY',
	'AGN',
	'TNX',
	'HPE',
	'SOS',
	'NIL',
	'FB',
	'VY',
	'73',
	'88',
	'59',
	// Who, where, and whose.
	'DE',
	'TO',
	'UR',
	'HR',
	'PSE',
	'OP',
	'CALL',
	'NAME',
	'STATION',
	'TRAFFIC',
	'MESSAGE',
	'BOOK',
	// The rig, the band, and the signal.
	'RADIO',
	'ANTENNA',
	'DIPOLE',
	'BEAM',
	'WIRE',
	'POWER',
	'RIG',
	'BAND',
	'MODE',
	'BEACON',
	'REPEATER',
	'FREQUENCY',
	'ELEVATION',
	'ACTIVITY',
	'SIGNAL',
	'REPORT',
	'NUMBER',
	'WX',
	'SEND',
	// Groups: things that go out as one phrase.
	'R R',
	'KN KN',
	'CQ DE',
	'OK OK',
	'73 73',
	'QTC QTC',
	// The English that fills in the rest of a sentence.
	'THE',
	'AND',
	'FOR',
	'YOU',
	'ARE',
	'WITH',
	'IS',
	'NOT',
	'THAT',
	'THIS',
	'HAVE',
	'FROM',
	'THEY',
	'WILL',
	'WAS',
	'BUT',
	'BE',
	'AT',
	'ONE',
	'ALL',
	'WE',
	'CAN',
	'SO',
	'OR',
	'MY',
	'ME',
	'YOUR',
	'YES',
	'NO',
	'HELP',
	'KNOW',
	'MANY',
	'MORE',
	'SOME',
	'ONLY',
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
/** The two ways of asking a question the user answers by picking. */
/** The modes that build a question to pick from, as opposed to the sending ones. */
export type QuizKind = 'char' | 'word';

export function nextQuestion(opts: {
	groups: MorseGroup[];
	/** Keying practice builds no question at all, so it is not one of these. */
	mode: QuizKind;
	choices: number;
	stats: StatsShape;
	/** Word-mode pool. Defaults to {@link WORD_LIST}. */
	words?: readonly string[];
	random?: () => number;
}): Question {
	const random = opts.random ?? rng;
	const chars = pool(opts.groups);

	// A word question is drawn from the word list, and its options are words too.
	// Offering a group of letters as the alternatives made the answer the only
	// thing on the button of the right length, which is not a question.
	if (opts.mode === 'word') return wordQuestion(opts.words ?? WORD_LIST, opts.choices, random);

	const solution = pickWeighted(chars, opts.stats, random);

	const solutionPattern = encode(solution) ?? '';
	const charsInMessage: MorseChar[] = encodeText(solution)[0]?.chars ?? [];
	const pattern = charsInMessage.map((c) => c.pattern).join(' ');

	// Distractors: the characters whose code is hardest to tell from the answer's,
	// because confusing those is the failure mode actually being trained.
	const rows = Math.max(2, opts.choices);
	const distractors = distractorsFor(solutionPattern, chars.filter((c) => c !== solution), rows - 1, random);
	const chosen = shuffle([...distractors, solution], random);
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

/**
 * The option a typed key names, or `undefined` when it names none or several.
 *
 * Decoding a character and typing it is the obvious thing to try, and a letter is
 * a key the hands already know, so the character itself is a second way to answer
 * beside its number.
 *
 * Exactly one option, or nothing at all. Word mode offers groups, so one letter
 * can sit in two options at once; picking between them would be the app choosing
 * on the user's behalf, and a question two keys could answer is a question the
 * numbers still answer. So an ambiguous key does nothing and leaves the row to be
 * clicked.
 *
 * A digit counts as a character here like any other. The number that picks an
 * option position is the caller's business and comes first; a digit outside that
 * range is free to mean the character it is.
 */
export function optionForKey(options: Option[], key: string): number | undefined {
	// One character only. 'Enter', 'Escape' and 'Tab' are not answers, and a
	// space is not either: the word gaps in a group are stripped before matching.
	if (key.length !== 1) return undefined;
	const wanted = key.toUpperCase();
	const hits: number[] = [];
	for (const [i, option] of options.entries()) {
		if (option.char.replace(/\s/g, '').includes(wanted)) hits.push(i);
	}
	return hits.length === 1 ? hits[0] : undefined;
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
 * How many elements two codes have in common, in the same order.
 *
 * A prefix is the wrong measure for this. K is -.- and L is .-.., which is the
 * confusion a learner is most likely to make, and they share no prefix at all,
 * so comparing left to right scores them as far apart as K and E. Comparing in
 * order rather than from the start sees the two elements they do have in
 * common and the one that has moved.
 */
function commonElements(a: string, b: string): number {
	let row = new Array<number>(b.length + 1).fill(0);
	for (let i = 1; i <= a.length; i++) {
		const next = new Array<number>(b.length + 1).fill(0);
		for (let j = 1; j <= b.length; j++) {
			next[j] = a[i - 1] === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
		}
		row = next;
	}
	return row[b.length];
}

const dashCount = (pattern: string) => pattern.match(/-/g)?.length ?? 0;

/**
 * Rank characters by how easily they could be mistaken for the answer, closest
 * first.
 *
 * Length leads and is not negotiable, which is the lesson word mode already
 * learned the hard way: if the answer is the only option of its length then the
 * question is answered by counting elements rather than by reading code, and an
 * easy question is worse than a hard one. Ranking by length first also means
 * the alternatives are always the same size as the answer, which is what makes
 * them hard to separate by ear in the first place.
 *
 * Within one length, what counts is how much of the code the two have in common
 * in order, then whether they use the same number of dashes. Same length, same
 * dashes, elements moved around: that is the mistake that costs marks, and no
 * prefix comparison can see it. F is ..-. and L is .-.., sharing no prefix at
 * all but the same two dots and one dash. Q is --.- and Y is -.--, Z is --..
 * and B is -... All three pairs are the same length and the same dashes in a
 * different order, which is why they turn up against each other so often.
 */
type Neighbour = { char: string; lengthGap: number; nearness: number; shared: number };

/** Score every candidate against the answer's code, closest first. */
function rankNear(pattern: string, candidates: string[]): Neighbour[] {
	const dashes = dashCount(pattern);
	const scored: Neighbour[] = [];
	for (const c of candidates) {
		const p = encode(c) ?? '';
		if (!p) continue;
		const shared = commonElements(pattern, p);
		scored.push({
			char: c,
			lengthGap: Math.abs(p.length - pattern.length),
			// Elements in common, in order, count double: order is what carries the
			// information, and one dash in the wrong slot is the whole confusion.
			// Same dash count breaks ties between equal overlaps.
			nearness: shared * 2 + (dashCount(p) === dashes ? 1 : 0),
			shared,
		});
	}
	return scored.sort((a, b) => a.lengthGap - b.lengthGap || b.nearness - a.nearness);
}

/**
 * Choose the letters to offer beside an answer.
 *
 * Codes of the answer's own length come first and fill the row whenever there are
 * enough of them. A different length is rejected on sight, so spending a slot on
 * one costs a real rival, and the answer being the only option of its length is
 * the same flaw that once made word mode offer MORSE against A and T.
 *
 * The shortest codes have too few of their own length to fill a row, so the rest
 * is made up of codes sharing at least one element. E and T share nothing at all
 * and are still a genuine question, because both are one element, but a dash
 * code beside a dot code is not a question at all.
 *
 * The shortlist is a wide slice of the plausible set rather than the first few, so
 * the same letter is not always offered against the same three.
 */
function distractorsFor(
	pattern: string,
	candidates: string[],
	wanted: number,
	random: () => number,
): string[] {
	const ranked = rankNear(pattern, candidates);
	const sameLength = ranked.filter((n) => n.lengthGap === 0);
	const band = (
		sameLength.length >= wanted ? sameLength : [...sameLength, ...ranked.filter((n) => n.shared > 0)]
	).slice(0, Math.max(1, wanted) * 3);
	return shuffle(band, random).slice(0, Math.max(1, wanted)).map((n) => n.char);
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

function wordQuestion(words: readonly string[], choices: number, random: () => number): Question {
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
