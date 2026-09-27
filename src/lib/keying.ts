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

/** What has become of one character of the target so far. */
export type Mark = 'pending' | 'right' | 'wrong';

export type KeyingVerdict = {
	/** One mark per character of the target, so a row of boxes can show progress. */
	marks: Mark[];
	/** True once the answer is settled, either way. */
	done: boolean;
	correct: boolean;
	/** Index of the first character sent wrongly, or -1. */
	wrongAt: number;
};

/**
 * The characters, ignoring spaces.
 *
 * The keyer writes a space when a word gap was sent, and a target with no word
 * gaps in it can easily pick one up from a hand that hesitated. That is a
 * timing slip rather than a wrong character, so it is forgiven here. Word gaps
 * that the target does ask for are left to the send tab, which is where they are
 * actually practised.
 */
const letters = (s: string) => s.replace(/\s/g, '');

/**
 * Grade what the keyer decoded against the target, stopping at the first
 * character that was sent wrongly. Stopping matters: a wrong third character
 * makes the rest of the answer meaningless, and marking eight more boxes would
 * only bury the one that needs fixing.
 */
export function gradeKeying(target: string, typed: string): KeyingVerdict {
	const want = letters(target);
	const got = letters(typed);
	const marks: Mark[] = [...want].map(() => 'pending');

	for (let i = 0; i < want.length && i < got.length; i++) {
		if (got[i] === want[i]) {
			marks[i] = 'right';
			continue;
		}
		marks[i] = 'wrong';
		return { marks, done: true, correct: false, wrongAt: i };
	}

	if (got.length >= want.length) {
		return { marks: [...want].map(() => 'right'), done: true, correct: true, wrongAt: -1 };
	}
	return { marks, done: false, correct: false, wrongAt: -1 };
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
