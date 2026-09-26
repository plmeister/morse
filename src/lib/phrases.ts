/**
 * Standard procedure words and the numeric shorthand that stands in for them.
 *
 * Patterns are derived from {@link encode} rather than written out by hand, so a
 * phrase can never drift from the codes it is built from.
 */

import { encode } from './morse';

export type Phrase = {
	/** Stable id, used as the list key. */
	id: string;
	/** The characters that make up the phrase, e.g. "SOS" or "73". */
	chars: string;
	/** What it means. */
	meaning: string;
	/**
	 * Sent as one unbroken run so the parts merge into a single sound. SOS is
	 * the case that matters: `... --- ...` is recognisable precisely because it
	 * is not sent with the character gaps in between.
	 */
	joined?: boolean;
	/** Grouped under this heading in the reference list. */
	category: 'distress' | 'shorthand' | 'prosign';
};

export const PHRASE_CATEGORIES: ReadonlyArray<{ id: Phrase['category']; label: string }> = [
	{ id: 'distress', label: 'Distress' },
	{ id: 'prosign', label: 'Procedure words' },
	{ id: 'shorthand', label: 'Numeric shorthand' },
];

export const PHRASES: readonly Phrase[] = [
	{ id: 'sos', chars: 'SOS', meaning: 'Distress signal', joined: true, category: 'distress' },

	{ id: 'sk', chars: 'SK', meaning: 'Stop, end of transmission', category: 'prosign' },
	{ id: 'kn', chars: 'KN', meaning: 'Go ahead, proceed', category: 'prosign' },
	{ id: 'k', chars: 'K', meaning: 'Over, go ahead', category: 'prosign' },
	{ id: 'r', chars: 'R', meaning: 'Received', category: 'prosign' },
	{ id: 'ar', chars: 'AR', meaning: 'End of message', category: 'prosign' },
	{ id: 'as', chars: 'AS', meaning: 'Waiting', category: 'prosign' },
	{ id: 'bt', chars: 'BT', meaning: 'Break', category: 'prosign' },
	{ id: 'ct', chars: 'CT', meaning: 'Start of counter, time', category: 'prosign' },
	{ id: 'os', chars: 'OS', meaning: 'End of transmission', category: 'prosign' },
	{ id: 'aaa', chars: 'AAA', meaning: 'New line', category: 'prosign' },

	{ id: 'n73', chars: '73', meaning: 'Best regards, good luck', category: 'shorthand' },
	{ id: 'n74', chars: '74', meaning: 'Yes, affirmative', category: 'shorthand' },
	{ id: 'n75', chars: '75', meaning: 'No, negative', category: 'shorthand' },
	{ id: 'n77', chars: '77', meaning: 'Long live', category: 'shorthand' },
	{ id: 'n88', chars: '88', meaning: 'Love and kisses', category: 'shorthand' },
	{ id: 'n89', chars: '89', meaning: 'Happy birthday', category: 'shorthand' },
	{ id: 'n99', chars: '99', meaning: 'Nothing understood; regional use varies', category: 'shorthand' },
	{ id: 'n269', chars: '269', meaning: 'Interference, often from power equipment', category: 'shorthand' },
];

/** True when every character in the phrase has a code we know. */
export function isKeyable(phrase: Phrase): boolean {
	return [...phrase.chars].every((c) => encode(c) !== undefined);
}

/** The codes of a phrase run together, with no separator. */
export function phrasePattern(phrase: Phrase): string {
	return [...phrase.chars].map((c) => encode(c) ?? '').join('');
}

/**
 * How to play a phrase, as one code for a joined phrase and one per character
 * otherwise. A joined phrase must not be split, or SOS stops sounding like SOS.
 */
export function phraseUnits(
	phrase: Phrase,
	t: { charGapMs: number; wordGapMs: number },
): Array<{ pattern: string; gapAfterMs: number }> {
	if (phrase.joined) {
		return [{ pattern: phrasePattern(phrase), gapAfterMs: t.charGapMs }];
	}
	const parts = [...phrase.chars].map((c) => encode(c) ?? '').filter(Boolean);
	return parts.map((pattern, i) => ({
		pattern,
		gapAfterMs: i === parts.length - 1 ? t.wordGapMs : t.charGapMs,
	}));
}
