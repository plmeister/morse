/**
 * Morse timing. Everything is expressed in milliseconds so the keyer can
 * compare raw press durations against raw gaps.
 */

export type Timings = {
	/** Length of a dot. One "unit" — the base of every other measurement. */
	dotMs: number;
	/** Length of a dash. Nominal 3 units. */
	dashMs: number;
	/** Silence that ends a character. Nominal 3 units. */
	charGapMs: number;
	/** Silence that ends a word. Nominal 7 units. */
	wordGapMs: number;
};

/** PARIS: 50 units per word of 50 units, so one dot lasts 1200/WPM ms. */
export const PARIS_UNIT_PER_WPM = 1200;

export function timingsForWpm(wpm: number): Timings {
	const unit = PARIS_UNIT_PER_WPM / wpm;
	return {
		dotMs: Math.round(unit),
		dashMs: Math.round(unit * 3),
		charGapMs: Math.round(unit * 3),
		wordGapMs: Math.round(unit * 7),
	};
}

/** Inverse of {@link timingsForWpm}, from the dot length. */
export function wpmForDot(dotMs: number): number {
	if (dotMs <= 0) return 0;
	return PARIS_UNIT_PER_WPM / dotMs;
}

/**
 * Press duration at or above which a tap is read as a dash.
 *
 * Midpoint between dot and dash, so the boundaries sit at the same relative
 * place no matter how the user has tuned the two lengths.
 */
export function dashThreshold(t: Timings): number {
	return (t.dotMs + t.dashMs) / 2;
}

export const MIN_DOT_MS = 20;
export const MAX_DOT_MS = 300;
export const MIN_DASH_MS = 60;
export const MAX_DASH_MS = 1200;
export const MIN_CHAR_GAP_MS = 40;
export const MAX_CHAR_GAP_MS = 1200;
export const MIN_WORD_GAP_MS = 100;
export const MAX_WORD_GAP_MS = 3000;

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function clampTimings(t: Timings): Timings {
	return {
		dotMs: clamp(Math.round(t.dotMs), MIN_DOT_MS, MAX_DOT_MS),
		dashMs: clamp(Math.round(t.dashMs), MIN_DASH_MS, MAX_DASH_MS),
		charGapMs: clamp(Math.round(t.charGapMs), MIN_CHAR_GAP_MS, MAX_CHAR_GAP_MS),
		wordGapMs: clamp(Math.round(t.wordGapMs), MIN_WORD_GAP_MS, MAX_WORD_GAP_MS),
	};
}

/** Ratio dash:dot. 3 is the standard; below 2 is hard to read. */
export function dashRatio(t: Timings): number {
	return t.dotMs > 0 ? t.dashMs / t.dotMs : 0;
}

/**
 * How far timings drift from the PARIS standard, 0 = perfect.
 * Used to warn when a tuning is unlikely to be decodable by anyone else.
 */
export function deviationFromStandard(t: Timings): number {
	const wpm = wpmForDot(t.dotMs);
	const standard = timingsForWpm(wpm);
	const worst =
		Math.abs(t.dashMs - standard.dashMs) / standard.dashMs ||
		Math.abs(t.charGapMs - standard.charGapMs) / standard.charGapMs ||
		Math.abs(t.wordGapMs - standard.wordGapMs) / standard.wordGapMs;
	return worst;
}
