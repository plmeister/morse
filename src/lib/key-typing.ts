/**
 * Keyboard keying, shared by the key tab and the keying quiz.
 *
 * Any key keys, like a straight key: a short press is a dot, a long one a dash,
 * and the time between them is what the decoder turns back into characters. It
 * was written out inside the key tab, where it was the only thing that wanted it;
 * the keying quiz wants exactly the same behaviour on a different tab, so it
 * lives here rather than being copied.
 */

/** The part of the keyer these handlers drive, so a fake can stand in for it. */
export type KeySink = {
	press(): void;
	release(): void;
	clear(): void;
	deleteLast(): void;
};

/** True while the user is typing into a field, where every key is a letter. */
export function isTypingTarget(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	if (!el) return false;
	return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true;
}

const hasModifier = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey;

/**
 * Keys to leave for the browser: the ones that navigate, open developer tools or
 * reload.
 *
 * Escape and Backspace are longer than one character too, so they have to be
 * dealt with before this is consulted. They are the two keys with a job of their
 * own here, and dropping them behind this test loses both of them silently.
 */
const isBrowserKey = (e: KeyboardEvent) => e.key === 'Tab' || e.key.length > 1;

/**
 * Handle a key press. Returns true when the key was consumed, so the caller
 * should stop the browser acting on it too.
 */
export function handleKeyDown(e: KeyboardEvent, keyer: KeySink): boolean {
	if (e.repeat || hasModifier(e) || isTypingTarget(e.target)) return false;
	if (e.key === 'Escape') {
		keyer.clear();
		return false;
	}
	// Backspace drops the last character. It has to be consumed, or the browser
	// walks back through its own history.
	if (e.key === 'Backspace') {
		keyer.deleteLast();
		return true;
	}
	if (isBrowserKey(e)) return false;
	keyer.press();
	return true;
}

/** Handle a key release. Returns true when it ended an element that was sent. */
export function handleKeyUp(e: KeyboardEvent, keyer: KeySink): boolean {
	if (hasModifier(e) || isTypingTarget(e.target)) return false;
	if (e.key === 'Escape' || e.key === 'Backspace' || isBrowserKey(e)) return false;
	keyer.release();
	return true;
}
