import { describe, expect, it, vi } from 'vitest';
import { createTestKeyer } from './keyer';
import { timingsForWpm } from './timing';

/** Tap for `ms` of fake time, producing a dot or a dash as the keyer sees it. */
function tap(env: ReturnType<typeof createTestKeyer>, ms: number) {
	env.press();
	env.advance(ms);
	env.release();
}

describe('symbols from press length', () => {
	it('reads a short press as a dot', () => {
		const env = createTestKeyer();
		tap(env, 60);
		expect(env.keyer.snapshot.buffer).toBe('.');
	});

	it('reads a long press as a dash', () => {
		const env = createTestKeyer();
		tap(env, 250);
		expect(env.keyer.snapshot.buffer).toBe('-');
	});

	it('breaks at the midpoint between dot and dash', () => {
		// dot 100 / dash 300 -> threshold 200
		const env = createTestKeyer();
		tap(env, 199);
		expect(env.keyer.snapshot.buffer).toBe('.');
		env.keyer.clear();
		tap(env, 200);
		expect(env.keyer.snapshot.buffer).toBe('-');
	});

	it('follows the timings live, so editing settings mid-key takes effect', () => {
		let timings = timingsForWpm(40); // dot 30 / dash 90 -> threshold 60
		const env = createTestKeyer({ timings: () => timings });
		tap(env, 70);
		expect(env.keyer.snapshot.buffer).toBe('-');
		env.keyer.clear();

		timings = timingsForWpm(8); // dot 150 / dash 450 -> threshold 300
		tap(env, 70);
		expect(env.keyer.snapshot.buffer).toBe('.');
	});
});

describe('characters from gaps', () => {
	it('commits a character after the character gap', () => {
		const env = createTestKeyer();
		tap(env, 60); // .
		tap(env, 60); // ..
		expect(env.keyer.snapshot.output).toBe('');
		env.advance(299);
		expect(env.keyer.snapshot.output).toBe('');
		env.advance(1);
		expect(env.keyer.snapshot.output).toBe('I');
		expect(env.keyer.snapshot.lastChar).toBe('I');
	});

	it('keeps keying within a character if the gap is short enough', () => {
		const env = createTestKeyer();
		tap(env, 60);
		env.advance(299); // just under the 300ms character gap
		tap(env, 250);
		expect(env.keyer.snapshot.buffer).toBe('.-');
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('A');
	});

	it('adds a space after the word gap', () => {
		const env = createTestKeyer();
		tap(env, 250); // -
		env.advance(699);
		expect(env.keyer.snapshot.output).toBe('T');
		env.advance(1);
		expect(env.keyer.snapshot.output).toBe('T ');
	});

	it('does not add a space for an ordinary pause between characters', () => {
		const env = createTestKeyer();
		tap(env, 250);
		env.advance(450); // past 300 (char gap) but short of 700 (word gap)
		tap(env, 250);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('TT');
	});

	it('separates two words with exactly one space', () => {
		const env = createTestKeyer();
		tap(env, 60); // .
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('E');
		tap(env, 250); // -
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('ET');
		env.advance(400); // let the word gap elapse
		expect(env.keyer.snapshot.output).toBe('ET ');
		tap(env, 60); // .
		tap(env, 250); // -
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('ET A');
	});

	it('cancels the pending space when keying resumes', () => {
		const env = createTestKeyer();
		tap(env, 60);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('E');
		env.advance(100); // inside the word gap, but not past it
		tap(env, 60);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('EE');
	});

	it('collapses repeated word gaps into one space', () => {
		const env = createTestKeyer();
		tap(env, 250);
		env.advance(5000);
		expect(env.keyer.snapshot.output).toBe('T ');
	});

	it('assembles a whole word', () => {
		// S O S = ... --- ...
		const env = createTestKeyer();
		for (const ms of [60, 60, 60]) tap(env, ms);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('S');
		for (const ms of [250, 250, 250]) tap(env, ms);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('SO');
		for (const ms of [60, 60, 60]) tap(env, ms);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('SOS');
	});

	it('skips a character that decodes to nothing but keeps the rest', () => {
		// Six dashes is not in the table, so it commits as nothing at all.
		const env = createTestKeyer();
		for (let i = 0; i < 6; i++) tap(env, 250);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('');
		expect(env.keyer.snapshot.lastChar).toBeUndefined();
		for (let i = 0; i < 4; i++) tap(env, 60);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('H');
	});
});

describe('preview and lifecycle', () => {
	it('previews the character while it is still being keyed', () => {
		const env = createTestKeyer();
		tap(env, 60);
		expect(env.keyer.snapshot.buffer).toBe('.');
		expect(env.keyer.snapshot.live).toBe('E');
		tap(env, 250);
		expect(env.keyer.snapshot.buffer).toBe('.-');
		expect(env.keyer.snapshot.live).toBe('A');
	});

	it('leaves live undefined for a partial code', () => {
		const env = createTestKeyer();
		tap(env, 250);
		tap(env, 250);
		expect(env.keyer.snapshot.buffer).toBe('--');
		expect(env.keyer.snapshot.live).toBe('M');
		tap(env, 250);
		expect(env.keyer.snapshot.buffer).toBe('---');
		expect(env.keyer.snapshot.live).toBe('O');
		tap(env, 250);
		expect(env.keyer.snapshot.buffer).toBe('----');
		expect(env.keyer.snapshot.live).toBeUndefined();
	});

	it('ignores a release with no press', () => {
		const env = createTestKeyer();
		env.release();
		expect(env.keyer.snapshot.buffer).toBe('');
	});

	it('ignores a second press while already down', () => {
		const env = createTestKeyer();
		env.press();
		env.press();
		env.advance(250);
		env.release();
		expect(env.keyer.snapshot.buffer).toBe('-');
	});

	it('tracks the pressing flag', () => {
		const env = createTestKeyer();
		expect(env.keyer.snapshot.pressing).toBe(false);
		env.press();
		expect(env.keyer.snapshot.pressing).toBe(true);
		env.release();
		expect(env.keyer.snapshot.pressing).toBe(false);
	});

	it('flushes on demand', () => {
		const env = createTestKeyer();
		tap(env, 60);
		tap(env, 60);
		env.keyer.flush();
		expect(env.keyer.snapshot.output).toBe('I');
	});

	it('clear wipes buffer, output and last character', () => {
		const env = createTestKeyer();
		tap(env, 60);
		env.advance(300);
		env.keyer.clear();
		expect(env.keyer.snapshot).toMatchObject({ buffer: '', output: '', lastChar: undefined });
	});

	it('cancels the pending commit when clear is called mid-character', () => {
		const env = createTestKeyer();
		tap(env, 60);
		env.keyer.clear();
		env.advance(5000);
		expect(env.keyer.snapshot.output).toBe('');
	});
});

describe('hooks', () => {
	it('reports press and release with the held duration', () => {
		const onPress = vi.fn();
		const onRelease = vi.fn();
		const env = createTestKeyer({ onPress, onRelease });
		env.press();
		env.advance(123);
		env.release();
		expect(onPress).toHaveBeenCalledTimes(1);
		expect(onRelease).toHaveBeenCalledWith(123);
	});

	it('reports each symbol as it is classified', () => {
		const onSymbol = vi.fn();
		const env = createTestKeyer({ onSymbol });
		tap(env, 60);
		tap(env, 250);
		expect(onSymbol.mock.calls).toEqual([
			['.', 60],
			['-', 250],
		]);
	});

	it('reports the raw pattern with each committed character', () => {
		const onChar = vi.fn();
		const env = createTestKeyer({ onChar });
		tap(env, 60);
		tap(env, 60);
		env.advance(300);
		expect(onChar).toHaveBeenCalledWith('I', '..');
	});

	it('emits a change on every state transition', () => {
		const onChange = vi.fn();
		const env = createTestKeyer({ onChange });
		env.press();
		env.release();
		env.advance(300);
		expect(onChange).toHaveBeenCalledTimes(3);
	});
});

describe('taking a character back', () => {
	// The scenario from the bug report: a pause longer than the character gap in
	// the middle of ".-" splits it into "E" then "T" instead of "A".
	function slowA() {
		const env = createTestKeyer();
		tap(env, 60); // dot
		env.advance(400); // well past the 300ms character gap
		tap(env, 250); // dash
		env.advance(300);
		return env;
	}

	it('splits a slow .- into two characters', () => {
		const env = slowA();
		expect(env.keyer.snapshot.output).toBe('ET');
	});

	it('merges them back into one character', () => {
		const env = slowA();
		env.keyer.mergeLast();
		expect(env.keyer.snapshot.output).toBe('E');
		expect(env.keyer.snapshot.buffer).toBe('-');
		expect(env.keyer.snapshot.live).toBe('T');
	});

	it('carries on keying after a merge to reach the intended character', () => {
		const env = slowA();
		env.keyer.mergeLast();
		env.keyer.clear();
		// Rebuild ".-" the intended way: dot, dash, no long pause in between.
		const fresh = createTestKeyer();
		tap(fresh, 60);
		tap(fresh, 250);
		fresh.advance(300);
		expect(fresh.keyer.snapshot.output).toBe('A');
		expect(env.keyer.snapshot.canMerge).toBe(false);
	});

	it('refuses to merge while a character is being keyed', () => {
		const env = createTestKeyer();
		tap(env, 60);
		env.advance(300);
		tap(env, 60);
		expect(env.keyer.snapshot.buffer).toBe('.');
		env.keyer.mergeLast();
		expect(env.keyer.snapshot.buffer).toBe('.');
		expect(env.keyer.snapshot.output).toBe('E');
	});

	it('reports when a merge is possible', () => {
		const env = createTestKeyer();
		expect(env.keyer.snapshot.canMerge).toBe(false);
		tap(env, 60);
		env.advance(300);
		expect(env.keyer.snapshot.canMerge).toBe(true);
		expect(env.keyer.snapshot.lastPattern).toBe('.');
	});

	it('deletes the last character outright', () => {
		const env = createTestKeyer();
		tap(env, 60);
		env.advance(300);
		tap(env, 250);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('ET');
		env.keyer.deleteLast();
		expect(env.keyer.snapshot.output).toBe('E');
		expect(env.keyer.snapshot.canDelete).toBe(true);
		env.keyer.deleteLast();
		expect(env.keyer.snapshot.output).toBe('');
		expect(env.keyer.snapshot.canDelete).toBe(false);
	});

	it('does not offer a merge for a pattern that is not a character', () => {
		const env = createTestKeyer();
		// Six dots is not a code, so nothing is committed and there is nothing
		// to pull back into the buffer.
		for (let i = 0; i < 6; i++) tap(env, 60);
		env.advance(300);
		expect(env.keyer.snapshot.output).toBe('');
		expect(env.keyer.snapshot.lastPattern).toBeUndefined();
		expect(env.keyer.snapshot.canMerge).toBe(false);
		expect(env.keyer.snapshot.canDelete).toBe(false);
	});

	it('cancels a pending word gap when merging', () => {
		const env = createTestKeyer();
		tap(env, 250); // T
		env.advance(300);
		env.keyer.mergeLast();
		// Long past where a word gap would have fired.
		env.advance(1000);
		expect(env.keyer.snapshot.output).toBe('');
		expect(env.keyer.snapshot.buffer).toBe('-');
	});
});

describe('merging and deleting after a word gap', () => {
	// A word gap can land a trailing space after the last character. Taking that
	// character back has to remove the character, not the space in front of it.
	function withTrailingSpace() {
		const env = createTestKeyer();
		tap(env, 60); // E
		env.advance(800); // past the 700ms word gap, so a space is typed
		tap(env, 250); // T
		env.advance(800);
		return env;
	}

	it('a word gap leaves a trailing space', () => {
		expect(withTrailingSpace().keyer.snapshot.output).toBe('E T ');
	});

	it('merge removes the character and not the space', () => {
		const env = withTrailingSpace();
		env.keyer.mergeLast();
		// The word gap the user actually made between E and T stays put; only the
		// T is taken back. Before the fix this was "E T", i.e. the space went and
		// the character stayed.
		expect(env.keyer.snapshot.output).toBe('E ');
		expect(env.keyer.snapshot.buffer).toBe('-');
	});

	it('delete removes the character and not the space', () => {
		const env = withTrailingSpace();
		env.keyer.deleteLast();
		expect(env.keyer.snapshot.output).toBe('E ');
	});

	it('a space never stands in for a character when deleting', () => {
		const env = createTestKeyer();
		tap(env, 250); // T
		env.advance(800); // word gap types a space
		expect(env.keyer.snapshot.output).toBe('T ');
		env.keyer.deleteLast();
		expect(env.keyer.snapshot.output).toBe('');
	});
});
