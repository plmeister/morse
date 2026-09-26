/**
 * ITU Morse code table and (de)coding.
 *
 * Timing model follows the PARIS standard, in "units":
 *   dot = 1 unit, dash = 3 units
 *   gap between elements of a character = 1 unit
 *   gap between characters = 3 units
 *   gap between words = 7 units
 */

export type MorseGroup = 'letters' | 'digits' | 'punctuation';
export type Symbol = '.' | '-';

const LETTERS: Record<string, string> = {
	A: '.-',
	B: '-...',
	C: '-.-.',
	D: '-..',
	E: '.',
	F: '..-.',
	G: '--.',
	H: '....',
	I: '..',
	J: '.---',
	K: '-.-',
	L: '.-..',
	M: '--',
	N: '-.',
	O: '---',
	P: '.--.',
	Q: '--.-',
	R: '.-.',
	S: '...',
	T: '-',
	U: '..-',
	V: '...-',
	W: '.--',
	X: '-..-',
	Y: '-.--',
	Z: '--..',
};

const DIGITS: Record<string, string> = {
	'0': '-----',
	'1': '.----',
	'2': '..---',
	'3': '...--',
	'4': '....-',
	'5': '.....',
	'6': '-....',
	'7': '--...',
	'8': '---..',
	'9': '----.',
};

const PUNCTUATION: Record<string, string> = {
	'.': '.-.-.-',
	',': '--..--',
	'?': '..--..',
	"'": '.----.',
	'"': '.-..-.',
	'!': '-.-.--',
	'/': '-..-.',
	'(': '-.--.',
	')': '-.--.-',
	'&': '.-...',
	':': '---...',
	';': '-.-.-.',
	'=': '-...-',
	'+': '.-.-.',
	'-': '-....-',
	_: '..--.-',
	$: '...-..-',
	'@': '.--.-.',
};

/** Every character this app can key, play and quiz on. */
export const TABLE: Readonly<Record<string, string>> = { ...LETTERS, ...DIGITS, ...PUNCTUATION };

/** Characters per cheat-sheet section, in display order. */
export const GROUPS: Readonly<Record<MorseGroup, string[]>> = {
	letters: Object.keys(LETTERS),
	digits: Object.keys(DIGITS),
	punctuation: Object.keys(PUNCTUATION),
};

export const GROUP_LABELS: Readonly<Record<MorseGroup, string>> = {
	letters: 'Letters',
	digits: 'Digits',
	punctuation: 'Punctuation',
};

const REVERSE: Readonly<Record<string, string>> = (() => {
	const out: Record<string, string> = {};
	for (const [char, pattern] of Object.entries(TABLE)) {
		// First writer wins: 'O' and '0' are distinct patterns, but be explicit
		// about collisions rather than silently depending on object order.
		if (out[pattern] === undefined) out[pattern] = char;
	}
	return out;
})();

/** Pattern -> character, for every code in the table. */
export const REVERSE_TABLE = REVERSE;

/** Morse pattern for a single character, or undefined if we can't send it. */
export function encode(char: string): string | undefined {
	if (char === ' ') return undefined;
	return TABLE[char.toUpperCase()];
}

/** Character for a complete Morse pattern, or undefined if incomplete/unknown. */
export function decode(pattern: string): string | undefined {
	return REVERSE[pattern];
}

export type MorseChar = { char: string; pattern: string };
export type MorseWord = { word: string; chars: MorseChar[] };
export type MorseText = MorseWord[];

/**
 * Encode a string into a structured Morse message. Whitespace becomes word
 * breaks; characters absent from the table are dropped.
 */
export function encodeText(text: string): MorseText {
	return text
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			const chars: MorseChar[] = [];
			for (const char of word) {
				const pattern = encode(char);
				if (pattern) chars.push({ char: char.toUpperCase(), pattern });
			}
			return { word, chars };
		})
		.filter((w) => w.chars.length > 0);
}

/** Split a single code into its elements. */
export function elements(pattern: string): Symbol[] {
	return pattern.split('') as Symbol[];
}

/**
 * Characters whose code could still become `buffer`.
 *
 * While keying, the buffer is a partial code (e.g. "-." on the way to "N" or
 * "-.-" to "K"). A cheat sheet needs to show which cells are still live so the
 * user does not have to hold the whole table in their head.
 *
 * This includes shorter codes the buffer already contains, because pressing on
 * after a complete code is a real thing people do. For the stricter question
 * — "which cells can still *become* the answer" — see {@link extensions}.
 */
export function candidates(buffer: string): string[] {
	if (!buffer) return Object.keys(TABLE);
	const out: string[] = [];
	for (const [char, pattern] of Object.entries(TABLE)) {
		if (pattern.startsWith(buffer) || buffer.startsWith(pattern)) out.push(char);
	}
	return out;
}

/**
 * Characters whose code extends `buffer`, i.e. the answers still reachable by
 * pressing more elements. Empty means the buffer is a dead end.
 */
export function extensions(buffer: string): string[] {
	if (!buffer) return Object.keys(TABLE);
	const out: string[] = [];
	for (const [char, pattern] of Object.entries(TABLE)) {
		if (pattern.startsWith(buffer)) out.push(char);
	}
	return out;
}

/** True if `buffer` is a complete, decodable code. */
export function isComplete(buffer: string): boolean {
	return buffer.length > 0 && REVERSE[buffer] !== undefined;
}

/**
 * Render a pattern as dot/dash glyphs. Long codes read faster as blocks, and
 * a space between elements keeps the boundary between e.g. "-...B" legible.
 */
export function renderPattern(pattern: string, opts: { glyphs?: boolean; spaced?: boolean } = {}): string {
	const { glyphs = true, spaced = true } = opts;
	if (!pattern) return '';
	const chars = pattern.split('').map((s) => (glyphs ? (s === '.' ? '\u2022' : '\u2014') : s));
	return spaced ? chars.join(' ') : chars.join('');
}
