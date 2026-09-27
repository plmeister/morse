import { encodeText } from './morse';
import { WORD_LIST, pickWeighted, pool } from './quiz';
import type { MorseGroup } from './morse';
import type { StatsShape } from './stats.svelte';
import type { KeyTargetKind } from './settings.svelte';

/**
 * Keying practice: a character or word is shown and the user sends it.
 *
 * Receiving is the easier half of Morse and the app already tests it two ways.
 * This is the other half, and it is the half that needs the keyer, so the
 * grading here is deliberately about the keying rather than about the code: what
 * the keyer decoded is what the user sent, gaps and all.
 */

/**
 * What has become of one character of the target so far.
 *
 * `gap` is not a wrong code. The character was sent correctly and the pause in
 * front of it was too long, so it reads as the start of a new word.
 */
export type Mark = 'pending' | 'right' | 'wrong' | 'gap';

export type KeyingVerdict = {
	/** One mark per character of the target, so a row of boxes can show progress. */
	marks: Mark[];
	/** True once the answer is settled, either way. */
	done: boolean;
	correct: boolean;
	/** Index of the first character sent wrongly, or -1. */
	wrongAt: number;
	/** Index of the first character a word gap was sent in front of, or -1. */
	spacingAt: number;
};

/** The target without the word gaps in it, one entry per character. */
const letters = (s: string) => s.replace(/\s/g, '');

export type GradeOptions = {
	/**
	 * Stop at the first character sent wrongly. Right for a single target, where
	 * everything after a mistake is meaningless. Wrong for a passage, where the
	 * rest is still worth sending and still worth marking.
	 */
	stopAtFirst?: boolean;
};

/** One position in a target: a character to send, or a word gap to send. */
type Slot = { gap: boolean; char: string; /** Which box this fills, or -1 for a gap. */ mark: number };

/**
 * Grade what the keyer decoded against a target that may ask for word gaps itself.
 *
 * Three faults, and they are not the same fault.
 *
 * A character sent wrongly is the plain one. A single target stops there, since
 * the rest of the answer is meaningless and marking seven more boxes would only
 * bury the one that needs fixing. A passage carries on, so that a slip halfway
 * through does not throw away the twenty characters that were fine. Either way
 * the run is misaligned after a wrong code, so the box is marked and both sides
 * step on: the letter that was sent is judged against the letter that was wanted,
 * and the row carries on past it.
 *
 * A pause is judged against the target. A gap the target asked for is what the
 * user should have sent. A gap it did not ask for is a mark down, and it does
 * not step on, because the letters either side still line up: the only thing
 * wrong was the pause. A character sent where a gap was wanted is that same
 * fault the other way round, the words ran together, and it does step on.
 *
 * Either kind of gap is charged to the character in front of it, since that is
 * the position a character gap was wanted in, and that is the one character to
 * lose. Reading a gap as part of the word would mean inventing a break nobody
 * asked for, so the keyer's own decoding is taken at its word: a space is a
 * space.
 */
export function gradeText(
	target: string,
	typed: string,
	opts: GradeOptions = {},
): KeyingVerdict {
	const slots: Slot[] = [];
	const marks: Mark[] = [];
	for (const c of target) {
		if (/\s/.test(c)) {
			slots.push({ gap: true, char: '', mark: -1 });
			continue;
		}
		slots.push({ gap: false, char: c, mark: marks.length });
		marks.push('pending');
	}

	let spacingAt = -1;
	let wrongAt = -1;
	let si = 0;

	/** Charge a pause the target did not ask for to the character it displaced. */
	function faultAhead() {
		if (spacingAt >= 0) return;
		const mark = slots[si]?.mark ?? -1;
		if (mark < 0) return;
		spacingAt = mark;
		marks[mark] = 'gap';
	}

	/** Charge a pause the target asked for and did not get to the character before. */
	function faultBehind() {
		if (spacingAt >= 0) return;
		const mark = slots[si - 1]?.mark ?? -1;
		if (mark < 0) return;
		spacingAt = mark;
		// A character that was sent right still loses its point, so the mark
		// changes; one that was never sent is left pending.
		if (marks[mark] === 'right') marks[mark] = 'gap';
	}

	for (const c of typed) {
		// Sent more than was asked for. A pause after the last position is the end
		// of the answer rather than a gap inside it.
		if (si >= slots.length) break;
		const slot = slots[si];

		if (/\s/.test(c)) {
			if (slot.gap) {
				si++;
				continue;
			}
			faultAhead();
			continue;
		}

		if (slot.gap) {
			faultBehind();
			si++;
			continue;
		}

		if (c === slot.char) {
			// A mark down for the gap in front of this character stands even though
			// the character itself arrived correctly, so it is not overwritten.
			if (marks[slot.mark] === 'pending') marks[slot.mark] = 'right';
		} else {
			marks[slot.mark] = 'wrong';
			if (wrongAt < 0) wrongAt = slot.mark;
			if (opts.stopAtFirst) {
				return { marks, done: true, correct: false, wrongAt, spacingAt };
			}
		}
		si++;
	}

	const done = si >= slots.length;
	return { marks, done, correct: done && wrongAt < 0 && spacingAt < 0, wrongAt, spacingAt };
}

/**
 * Grade a single character or word, which stops at the first mistake.
 *
 * A keying target is one word of letters, so it never asks for a gap of its own;
 * the gap handling above only earns its keep in a passage.
 */
export function gradeKeying(target: string, typed: string): KeyingVerdict {
	return gradeText(target, typed, { stopAtFirst: true });
}

/**
 * The target split into words, each with where its first box sits in the mark
 * row, so the view can group the boxes the way the target is grouped and show
 * where the word gaps belong.
 */
export function passageLayout(
	target: string,
): Array<{ word: string; offset: number }> {
	const out: Array<{ word: string; offset: number }> = [];
	let offset = 0;
	for (const word of target.split(/\s+/).filter(Boolean)) {
		out.push({ word, offset });
		offset += [...word].length;
	}
	return out;
}

/**
 * Choose what to ask the user to send.
 *
 * Characters are drawn the way the receive quiz draws them, weighted towards
 * whatever the user keeps missing, so keying practice lands on the same weak
 * spots. Words are drawn evenly: there is no per word record to weight by, and
 * the per character stats it writes are what the weighting would be standing in
 * for anyway.
 *
 * Only single words of letters are offered. A target like "R R" exists to make
 * the receiver hear a word gap, and grading that here would mean failing someone
 * for a pause rather than for a code. The numerals among the list, 73 and 59,
 * are abbreviations rather than words, and letting one in would put digits in a
 * target on a session that had switched digits off.
 */
export function keyingTarget(opts: {
	kind: KeyTargetKind;
	groups: MorseGroup[];
	/** Word pool. Defaults to the quiz word list. */
	words?: readonly string[];
	stats: StatsShape;
	random?: () => number;
}): string {
	if (opts.kind === 'char') return pickWeighted(pool(opts.groups), opts.stats, opts.random);

	const words = (opts.words ?? WORD_LIST).filter((w) => /^[A-Z]+$/.test(w));
	if (!words.length) throw new Error('empty word pool');
	const random = opts.random ?? Math.random;
	return words[Math.floor(random() * words.length)];
}

/** The characters of a target, for the per character stats both modes record. */
export function targetChars(target: string) {
	return encodeText(target).flatMap((group) => group.chars);
}

/**
 * Phrases to key out in one run.
 *
 * Letters and word gaps only, and for a different reason from the word pool.
 * Letters because everything here has to stay sendable on a session that has
 * digits and punctuation switched off. Word gaps because a passage is the one
 * target where they are wanted rather than forgiven: the pauses are part of what
 * is being sent, and both a missing one and an extra one are marked.
 *
 * The two long ones are the sentences CW practice has always used, kept because
 * they cover the alphabet between them and because anyone who has keyed Morse
 * will recognise them.
 */
export const PASSAGES: readonly string[] = [
	'CQ CQ DE MORSE K',
	'GOOD MORNING ALL',
	'HOW DO YOU HEAR ME',
	'OVER AND OUT',
	'MY NAME IS SAM',
	'NAME SPELLED AS SAM',
	'THE SIGNAL IS STRONG',
	'I HEAR YOU FINE',
	'STAND BY FOR A MOMENT',
	'TRY AGAIN PLEASE',
	'SEND MORE WHEN READY',
	'THE ANTENNA IS UP',
	'THE BAND IS QUIET TONIGHT',
	'THANK YOU VERY MUCH',
	'NICE TO MEET YOU',
	'HAPPY BIRTHDAY TO YOU',
	'GOOD NIGHT AND SLEEP WELL',
	'KEEP THE FREQUENCY CLEAR',
	'THE RIG RUNS TEN WATTS',
	'LOG IN YOUR MINUTES PLEASE',
	'TESTING ONE TWO THREE',
	'COPY THAT CLEARLY',
	'MY ANTENNA IS A DIPOLE',
	'THE BAND IS NOISY HERE',
	'DO YOU COPY MY CALL',
	'I WILL CALL AGAIN SOON',
	'BEAM UP AND ON THE AIR',
	'TAKE CARE AND TALK SOON',
	'THE CONTEST STARTS AT TEN',
	'I WORKED A NEW COUNTRY TODAY',
	'MY RIG IS OLD BUT GOOD',
	'RAIN IS HEAVY BUT THE PATH IS CLEAR',
	'THE LIGHTNING HAS STOPPED',
	'I CAN SEE THE MILES TO GO',
	'THE LAMP IS BURNING BRIGHTLY',
	'PLEASE SEND A REPORT CARD',
	'THE QUIET HOURS BEGIN AT TEN',
	'MY BATTERY IS ALMOST FLAT',
	'ROGER AND THANK YOU',
	'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG',
	'PACK MY BOX WITH FIVE DOZEN LIQUOR JUGS',
];

/** True when a passage is nothing but words of upper case letters. */
export const isKeyablePassage = (p: string) => /^[A-Z]+( [A-Z]+)*$/.test(p);

/**
 * Choose a passage to send.
 *
 * Drawn evenly, like the word pool: there is no per passage record to weight by,
 * and the per character stats a run writes are what the weighting would be
 * standing in for anyway. The passage just drawn is passed back in so the same
 * one does not come round twice, which matters more here than for a single word
 * because a passage takes long enough to notice.
 */
export function passageTarget(
	opts: { passages?: readonly string[]; previous?: string; random?: () => number } = {},
): string {
	const usable = (opts.passages ?? PASSAGES).filter(isKeyablePassage);
	if (!usable.length) throw new Error('empty passage pool');
	const fresh = usable.length > 1 ? usable.filter((p) => p !== opts.previous) : usable;
	const random = opts.random ?? Math.random;
	return fresh[Math.floor(random() * fresh.length)];
}
