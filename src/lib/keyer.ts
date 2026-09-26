/**
 * Turns variable-length key presses into Morse characters.
 *
 * Plain class with injected clock and timers so the whole thing can be driven
 * by fake timers in tests. See `keyer.svelte.ts` for the reactive wrapper.
 */

import { dashThreshold, type Timings } from './timing';
import { decode, type Symbol } from './morse';

export type KeyerSnapshot = {
	/** Elements keyed so far in the character being built, e.g. "-.". */
	buffer: string;
	/** Character the buffer decodes to right now, if it is already complete. */
	live: string | undefined;
	/** Everything decoded so far, including spaces from word gaps. */
	output: string;
	/** The most recently completed character. */
	lastChar: string | undefined;
	/** Pattern of the most recently completed character, for merging back. */
	lastPattern: string | undefined;
	/** True when the last character can still be pulled back into the buffer. */
	canMerge: boolean;
	/** True when there is a committed character to delete. */
	canDelete: boolean;
	pressing: boolean;
};

export type KeyerHooks = {
	/** Current timings; re-read on every press so live edits take effect. */
	timings: () => Timings;
	/** Fired on key down, for the sidetone. */
	onPress?: () => void;
	/** Fired on key up, before the symbol is classified. */
	onRelease?: (heldMs: number) => void;
	/** Fired when an element is appended to the buffer. */
	onSymbol?: (symbol: Symbol, heldMs: number) => void;
	/** Fired when a character is committed, with the raw pattern. */
	onChar?: (char: string | undefined, pattern: string) => void;
	/** Fired on every state change, including whitespace commits. */
	onChange?: (snapshot: KeyerSnapshot) => void;
};

export type TimerHandle = unknown;

export type KeyerOptions = KeyerHooks & {
	now?: () => number;
	setTimer?: (fn: () => void, ms: number) => TimerHandle;
	clearTimer?: (handle: TimerHandle) => void;
};

const noop = () => {};

/**
 * Remove the final character of the output.
 *
 * A word gap can leave a trailing space after the last character, so the
 * whitespace has to go first. Slicing a single code unit without doing that
 * would delete the space and leave the character the user wanted gone.
 */
function trimLastChar(output: string): string {
	return output.replace(/\s+$/, '').slice(0, -1);
}

export class Keyer {
	buffer = '';
	output = '';
	lastChar: string | undefined;
	lastPattern: string | undefined;
	pressing = false;

	#pressStart = 0;
	#charTimer: TimerHandle | undefined;
	/** Armed only after a character is committed, to catch a word gap. */
	#spaceTimer: TimerHandle | undefined;
	#hooks: KeyerOptions;

	constructor(options: KeyerOptions) {
		this.#hooks = options;
	}

	get #now() {
		return this.#hooks.now ?? Date.now;
	}

	get #setTimer() {
		return this.#hooks.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
	}

	get #clearTimer() {
		return this.#hooks.clearTimer ?? ((h: TimerHandle) => clearTimeout(h as never));
	}

	get snapshot(): KeyerSnapshot {
		return {
			buffer: this.buffer,
			live: this.buffer ? decode(this.buffer) : undefined,
			output: this.output,
			lastChar: this.lastChar,
			lastPattern: this.lastPattern,
			canMerge: this.buffer === '' && this.lastPattern !== undefined,
			canDelete: this.output.length > 0,
			pressing: this.pressing,
		};
	}

	#emit() {
		this.#hooks.onChange?.(this.snapshot);
	}

	press() {
		if (this.pressing) return;
		this.pressing = true;
		this.#pressStart = this.#now();
		// Keying again means the pause was intra-character, not a gap.
		this.#cancelTimers();
		this.#hooks.onPress?.();
		this.#emit();
	}

	release() {
		if (!this.pressing) return;
		const now = this.#now();
		const held = now - this.#pressStart;
		this.pressing = false;
		this.#hooks.onRelease?.(held);

		const threshold = dashThreshold(this.#hooks.timings());
		const symbol: Symbol = held < threshold ? '.' : '-';
		this.buffer += symbol;
		this.#hooks.onSymbol?.(symbol, held);
		this.#emit();

		// Arm the character boundary. A word gap is longer, so it is detected by
		// the silence that remains after this commit, not by a competing timer.
		const t = this.#hooks.timings();
		this.#charTimer = this.#setTimer(() => this.#commitChar(), t.charGapMs);
	}

	#cancelTimers() {
		if (this.#charTimer !== undefined) this.#clearTimer(this.#charTimer);
		if (this.#spaceTimer !== undefined) this.#clearTimer(this.#spaceTimer);
		this.#charTimer = undefined;
		this.#spaceTimer = undefined;
	}

	#commitChar() {
		if (this.#charTimer !== undefined) this.#clearTimer(this.#charTimer);
		this.#charTimer = undefined;
		if (!this.buffer) return;

		const pattern = this.buffer;
		const char = decode(pattern);
		this.buffer = '';
		this.lastChar = char;
		this.lastPattern = char === undefined ? undefined : pattern;
		this.output += char ?? '';
		this.#hooks.onChar?.(char, pattern);
		this.#emit();

		// The character is done, but the user may still be pausing before a new
		// word. Keep watching for the remainder of the word gap.
		const { charGapMs, wordGapMs } = this.#hooks.timings();
		const remaining = Math.max(0, wordGapMs - charGapMs);
		this.#spaceTimer = this.#setTimer(() => this.#commitSpace(), remaining);
	}

	#commitSpace() {
		if (this.#spaceTimer !== undefined) this.#clearTimer(this.#spaceTimer);
		this.#spaceTimer = undefined;
		if (this.buffer) return; // resumed keying; the gap was not a word gap
		// Collapse any run of whitespace so repeated word gaps stay one space.
		this.output = this.output.replace(/\s+$/, '') + ' ';
		this.#emit();
	}

	/** Commit whatever is pending immediately (e.g. on blur or mode change). */
	flush() {
		if (this.buffer) this.#commitChar();
	}

	/**
	 * Pull the last committed character back into the buffer so the next press
	 * continues it.
	 *
	 * Telling a one-unit pause from a three-unit one by hand is genuinely hard,
	 * so keying ".-" slowly commits as "ET" rather than "A". Rather than guess,
	 * the split stays reversible: this puts the user back in control of where the
	 * character boundary belongs.
	 */
	mergeLast() {
		if (this.buffer || this.lastPattern === undefined) return;
		this.#cancelTimers();
		const pattern = this.lastPattern;
		this.buffer = pattern;
		this.lastChar = undefined;
		this.lastPattern = undefined;
		this.output = trimLastChar(this.output);
		this.#emit();
	}

	/** Drop the last committed character entirely. */
	deleteLast() {
		if (!this.output.length) return;
		this.#cancelTimers();
		this.output = trimLastChar(this.output);
		this.lastChar = undefined;
		this.lastPattern = undefined;
		this.#emit();
	}

	clear() {
		this.#cancelTimers();
		this.buffer = '';
		this.output = '';
		this.lastChar = undefined;
		this.lastPattern = undefined;
		this.pressing = false;
		this.#emit();
	}

	destroy() {
		this.#cancelTimers();
		this.pressing = false;
	}

	/** Bind handlers after construction. */
	setHooks(hooks: Partial<KeyerHooks>) {
		this.#hooks = { ...this.#hooks, ...hooks };
	}
}

/** Convenience for tests: a keyer driven by a hand-advanced clock. */
export function createTestKeyer(hooks: Partial<KeyerHooks> = {}) {
	let now = 0;
	const timers: { id: number; at: number; fn: () => void }[] = [];
	let nextId = 1;

	const keyer = new Keyer({
		...hooks,
		// dot 100 / dash 300 / char gap 300 / word gap 700: readable round numbers
		// that keep the threshold at an obvious 200ms.
		timings: hooks.timings ?? (() => ({ dotMs: 100, dashMs: 300, charGapMs: 300, wordGapMs: 700 })),
		now: () => now,
		setTimer: (fn, ms) => {
			const id = nextId++;
			timers.push({ id, at: now + ms, fn });
			return id;
		},
		clearTimer: (h) => {
			const i = timers.findIndex((t) => t.id === h);
			if (i >= 0) timers.splice(i, 1);
		},
	});

	/** Advance the clock, firing any timers that come due. */
	function advance(ms: number) {
		const target = now + ms;
		for (;;) {
			const due = timers
				.filter((t) => t.at <= target)
				.sort((a, b) => a.at - b.at)[0];
			if (!due) break;
			timers.splice(timers.indexOf(due), 1);
			now = due.at;
			due.fn();
		}
		now = target;
	}

	return { keyer, advance, press: () => keyer.press(), release: () => keyer.release() };
}
