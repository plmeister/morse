import { describe, expect, it } from 'vitest';
import { handleKeyDown, handleKeyUp, isTypingTarget, type KeySink } from './key-typing';

/** Records what the keyer was asked to do, so the order of the rules is visible. */
function fakeKeyer() {
	const calls: string[] = [];
	const sink: KeySink = {
		press: () => calls.push('press'),
		release: () => calls.push('release'),
		clear: () => calls.push('clear'),
		deleteLast: () => calls.push('deleteLast'),
	};
	return { sink, calls };
}

/**
 * The handlers only read a handful of fields, so a plain object is enough and
 * there is no need for a DOM to be standing up.
 */
function key(k: string, over: Partial<KeyboardEvent> = {}) {
	return {
		key: k,
		repeat: false,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		target: null,
		...over,
	} as unknown as KeyboardEvent;
}

const field = (over: Partial<KeyboardEvent> = {}) =>
	({ tagName: 'INPUT' } as unknown as HTMLElement) as unknown as EventTarget;

describe('key typing', () => {
	it('sends any single character key as Morse', () => {
		const { sink, calls } = fakeKeyer();
		expect(handleKeyDown(key('k'), sink)).toBe(true);
		expect(handleKeyUp(key('k'), sink)).toBe(true);
		expect(calls).toEqual(['press', 'release']);
	});

	it('clears on Escape, which the browser has no other use for', () => {
		const { sink, calls } = fakeKeyer();
		expect(handleKeyDown(key('Escape'), sink)).toBe(false);
		expect(calls).toEqual(['clear']);
	});

	it('deletes on Backspace, and consumes it so the browser does not go back', () => {
		const { sink, calls } = fakeKeyer();
		expect(handleKeyDown(key('Backspace'), sink)).toBe(true);
		expect(calls).toEqual(['deleteLast']);
	});

	it('leaves the browser its own keys', () => {
		for (const k of ['Tab', 'F5', 'ArrowUp', 'Shift', 'Enter']) {
			const { sink, calls } = fakeKeyer();
			handleKeyDown(key(k), sink);
			handleKeyUp(key(k), sink);
			expect(calls, k).toEqual([]);
		}
	});

	it('ignores a held key repeating, so it cannot run on into a second element', () => {
		const { sink, calls } = fakeKeyer();
		handleKeyDown(key('k', { repeat: true }), sink);
		expect(calls).toEqual([]);
	});

	it('ignores the modifier chords, which mean something else', () => {
		for (const mod of ['metaKey', 'ctrlKey', 'altKey'] as const) {
			const { sink, calls } = fakeKeyer();
			handleKeyDown(key('k', { [mod]: true }), sink);
			handleKeyUp(key('k', { [mod]: true }), sink);
			expect(calls, mod).toEqual([]);
		}
	});

	it('stays out of the way while a field is being typed in', () => {
		const { sink, calls } = fakeKeyer();
		const inField = key('k', { target: field() });
		expect(handleKeyDown(inField, sink)).toBe(false);
		handleKeyUp(inField, sink);
		handleKeyDown(key('Escape', { target: field() }), sink);
		handleKeyDown(key('Backspace', { target: field() }), sink);
		expect(calls).toEqual([]);
	});

	it('knows a field from a div', () => {
		const div = { tagName: 'DIV' } as unknown as HTMLElement;
		expect(isTypingTarget(div)).toBe(false);
		expect(isTypingTarget({ tagName: 'TEXTAREA' } as unknown as HTMLElement)).toBe(true);
		expect(isTypingTarget({ isContentEditable: true } as unknown as HTMLElement)).toBe(true);
		expect(isTypingTarget(null)).toBe(false);
	});
});
