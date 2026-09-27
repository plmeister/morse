import { isBrowser, readJSON, writeJSON } from './storage';
import type { MorseGroup } from './morse';
import {
	clamp,
	clampTimings,
	MAX_CHAR_GAP_MS,
	MAX_DASH_MS,
	MAX_DOT_MS,
	MAX_WORD_GAP_MS,
	MIN_CHAR_GAP_MS,
	MIN_DASH_MS,
	MIN_DOT_MS,
	MIN_WORD_GAP_MS,
	timingsForWpm,
	wpmForDot,
	type Timings,
} from './timing';

const KEY = 'morse.settings.v1';

export type QuizMode = 'char' | 'word' | 'key';
/** What keying practice asks the user to send. The two ways of being asked. */
export type KeyTargetKind = Exclude<QuizMode, 'key'>;
export type KeyAction = 'none' | 'selectAll' | 'copy' | 'clear' | 'send';

export const DEFAULTS = {
	// 15 WPM PARIS — a common starting point for a beginner.
	...timingsForWpm(15),
	/** Keep dash and the gaps locked to standard ratios while the WPM moves. */
	linkToStandard: true,
	freqHz: 700,
	volume: 0.5,
	/** Silences everything without forgetting the volume the user chose. */
	muted: false,
	sidetone: true,
	showCheatSheet: true,
	/** Which cheat-sheet sections are on the Key tab. */
	cheatGroups: ['letters', 'digits'] as MorseGroup[],
	/** Grey out cheat-sheet cells that cannot match the buffer being keyed. */
	dimDeadEnds: true,
	flashOnDecode: true,
	autoAdvance: true,
	/** Seconds to sit on feedback before the next question. */
	autoAdvanceMs: 1100,
	quizMode: 'char' as QuizMode,
	/** Keying practice sends a character or a whole word. */
	keyTarget: 'char' as KeyTargetKind,
	choices: 4,
	includeDigits: false,
	includePunct: false,
	/** 0 = endless. */
	sessionLength: 0,
	keyAction: 'clear' as KeyAction,
} satisfies SettingsShape;

export type SettingsShape = {
	dotMs: number;
	dashMs: number;
	charGapMs: number;
	wordGapMs: number;
	linkToStandard: boolean;
	freqHz: number;
	volume: number;
	muted: boolean;
	sidetone: boolean;
	showCheatSheet: boolean;
	cheatGroups: MorseGroup[];
	dimDeadEnds: boolean;
	flashOnDecode: boolean;
	autoAdvance: boolean;
	autoAdvanceMs: number;
	quizMode: QuizMode;
	keyTarget: KeyTargetKind;
	choices: number;
	includeDigits: boolean;
	includePunct: boolean;
	sessionLength: number;
	keyAction: KeyAction;
};

function load(): SettingsShape {
	return readJSON<SettingsShape>(KEY, { ...DEFAULTS }, (base, stored) => {
		// Merge so settings added in a later version get their default rather
		// than undefined.
		return { ...base, ...(stored as Partial<SettingsShape>) };
	});
}

/**
 * Persisted app settings. One instance, mutated directly from the UI, and
 * mirrored into localStorage on every change.
 */
export class Settings {
	#data = $state<SettingsShape>(load());

	constructor() {
		if (isBrowser()) {
			$effect.root(() => {
				$effect(() => {
					writeJSON(KEY, $state.snapshot(this.#data));
				});
			});
		}
	}

	get timings(): Timings {
		return {
			dotMs: this.#data.dotMs,
			dashMs: this.#data.dashMs,
			charGapMs: this.#data.charGapMs,
			wordGapMs: this.#data.wordGapMs,
		};
	}

	/** Derived from the dot length, not stored, so the two cannot disagree. */
	get wpm(): number {
		return Math.round(wpmForDot(this.#data.dotMs));
	}

	get dashRatio(): number {
		return this.#data.dotMs > 0 ? this.#data.dashMs / this.#data.dotMs : 0;
	}

	/**
	 * What the tone engine should actually play. Every caller goes through this
	 * so that muting cannot be forgotten at one of the call sites.
	 */
	get effectiveVolume(): number {
		return this.#data.muted ? 0 : this.#data.volume;
	}

	/** Worst relative drift from PARIS, 0 = exact. */
	get offStandard(): number {
		const standard = timingsForWpm(this.wpm);
		const t = this.timings;
		return Math.max(
			Math.abs(t.dashMs - standard.dashMs) / standard.dashMs,
			Math.abs(t.charGapMs - standard.charGapMs) / standard.charGapMs,
			Math.abs(t.wordGapMs - standard.wordGapMs) / standard.wordGapMs,
		);
	}

	get<K extends keyof SettingsShape>(key: K): SettingsShape[K] {
		return this.#data[key];
	}

	set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) {
		this.#data[key] = value;
	}

	/** Move WPM, dragging the gaps along if they are linked to the standard. */
	setWpm(wpm: number) {
		const target = timingsForWpm(clamp(wpm, 5, 40));
		this.#data.dotMs = target.dotMs;
		if (this.#data.linkToStandard) {
			this.#data.dashMs = target.dashMs;
			this.#data.charGapMs = target.charGapMs;
			this.#data.wordGapMs = target.wordGapMs;
		}
	}

	setTiming(key: keyof Timings, value: number) {
		const bounds: Record<keyof Timings, [number, number]> = {
			dotMs: [MIN_DOT_MS, MAX_DOT_MS],
			dashMs: [MIN_DASH_MS, MAX_DASH_MS],
			charGapMs: [MIN_CHAR_GAP_MS, MAX_CHAR_GAP_MS],
			wordGapMs: [MIN_WORD_GAP_MS, MAX_WORD_GAP_MS],
		};
		this.#data[key] = Math.round(clamp(value, ...bounds[key]));
	}

	/** Snap the gaps back to 3:3:7 against the current dot length. */
	resetGapsToStandard() {
		const standard = timingsForWpm(this.wpm);
		this.#data.linkToStandard = true;
		this.#data.dashMs = standard.dashMs;
		this.#data.charGapMs = standard.charGapMs;
		this.#data.wordGapMs = standard.wordGapMs;
	}

	reset() {
		this.#data = { ...DEFAULTS };
	}

	export(): SettingsShape {
		return { ...this.#data };
	}
}

export const settings = new Settings();
