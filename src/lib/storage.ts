/**
 * localStorage helpers.
 *
 * Deliberately free of framework imports so the state modules that use these
 * can be loaded outside a SvelteKit context (tests, scripts).
 *
 * `isBrowser` is a function rather than a constant because this module can be
 * imported before hydration, during server-side rendering, where `window` does
 * not exist and must not be touched at module scope.
 */

export function isBrowser(): boolean {
	return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readJSON<T>(key: string, fallback: T, merge: (base: T, stored: unknown) => T): T {
	if (!isBrowser()) return fallback;
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return fallback;
		return merge(fallback, JSON.parse(raw));
	} catch {
		// Corrupt or unavailable storage should never stop the app booting.
		return fallback;
	}
}

export function writeJSON(key: string, value: unknown): void {
	if (!isBrowser()) return;
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Private browsing, or the quota is full. Losing persistence is
		// acceptable; crashing is not.
	}
}

export function removeKey(key: string): void {
	if (!isBrowser()) return;
	try {
		localStorage.removeItem(key);
	} catch {
		// ignore
	}
}
