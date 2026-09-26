import { isBrowser, readJSON, writeJSON } from './storage';

const KEY = 'morse.cheat.sections.v1';

/** `codes` is the extra section rendered from a snippet, not a character table. */
export type SectionId = 'letters' | 'digits' | 'punctuation' | 'codes';

export type SectionState = Record<SectionId, boolean>;

/**
 * Letters only, to start with. A first visit gets the alphabet in front of them
 * and nothing else: the numbers and the standard codes are a wall of text, and
 * the point of the sheet is to be glanceable.
 */
const DEFAULTS: SectionState = {
	letters: true,
	digits: false,
	punctuation: false,
	codes: false,
};

/** Ignore anything that is not a known section, so a stale key cannot break it. */
function merge(_base: SectionState, stored: unknown): SectionState {
	if (typeof stored !== 'object' || stored === null) return DEFAULTS;
	const out = { ...DEFAULTS };
	for (const id of Object.keys(DEFAULTS) as SectionId[]) {
		const value = (stored as Record<string, unknown>)[id];
		if (typeof value === 'boolean') out[id] = value;
	}
	return out;
}

function load(): SectionState {
	return readJSON(KEY, DEFAULTS, merge);
}

/**
 * Which cheat-sheet sections are unfolded. This is view state rather than a
 * setting: it says nothing about how the trainer behaves, and the default is
 * chosen for someone who has not used it before rather than for whatever the
 * user was last looking at. Kept in localStorage so the sheet comes back the way
 * it was left, including on a reload mid-session.
 */
export class CheatSections {
	#data = $state<SectionState>(load());

	constructor() {
		if (isBrowser()) {
			$effect.root(() => {
				$effect(() => {
					writeJSON(KEY, $state.snapshot(this.#data));
				});
			});
		}
	}

	isOpen(id: SectionId): boolean {
		return this.#data[id];
	}

	/**
	 * Bound open state for a <details> element. Svelte cannot toggle `open`
	 * declaratively without fighting the user's own clicks, so the attribute is
	 * only set on first render and the toggle event is what keeps the store true.
	 */
	initialOpen(id: SectionId): boolean {
		return this.#data[id];
	}

	toggle(id: SectionId, open: boolean) {
		this.#data[id] = open;
	}

	reset() {
		this.#data = { ...DEFAULTS };
	}
}

export const cheatSections = new CheatSections();
