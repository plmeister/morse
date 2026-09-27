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

/**
 * Grade what the keyer decoded against the target.
 *
 * There are two faults here and they are not the same fault.
 *
 * A character sent wrongly ends the question on the spot, because everything
 * after it is meaningless and marking seven more boxes would only bury the one
 * that needs fixing.
 *
 * A word gap inside the target is only a mark down. It does not stop the
 * question, because the rest of the word is still worth sending and the
 * characters either side of it were still sent correctly, so they keep their
 * point. The gap is charged to the character in front of it, since that is the
 * position a character gap was wanted in, and that is the one character to
 * lose. Reading a word gap inside a word as part of the word would mean the
 * grader had to invent a pause nobody asked for, so the pause is read as what
 * it is on the wire: a new word starting early.
 */
export function gradeKeying(target: string, typed: string): KeyingVerdict {
	const want = letters(target);
	const marks: Mark[] = [...want].map(() => 'pending');
	let spacingAt = -1;
	let i = 0;

	for (const c of typed) {
		// Sent more than was asked for. A pause after the last character is the
		// end of the answer rather than a gap inside it.
		if (i >= want.length) break;
		if (/\s/.test(c)) {
			if (spacingAt < 0) {
				spacingAt = i;
				marks[i] = 'gap';
			}
			continue;
		}
		if (c !== want[i]) {
			marks[i] = 'wrong';
			return { marks, done: true, correct: false, wrongAt: i, spacingAt };
		}
		// A mark down for the gap in front of this character stands even though the
		// character itself arrived correctly, so it is not overwritten here.
		if (marks[i] === 'pending') marks[i] = 'right';
		i++;
	}

	if (i < want.length) return { marks, done: false, correct: false, wrongAt: -1, spacingAt };
	return { marks, done: true, correct: spacingAt < 0, wrongAt: -1, spacingAt };
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
