import { tone } from './audio';
import { Keyer, type KeyerSnapshot } from './keyer';
import { settings } from './settings.svelte';

type Listener = (snapshot: KeyerSnapshot) => void;

function emptySnapshot(): KeyerSnapshot {
	return {
		buffer: '',
		live: undefined,
		output: '',
		lastChar: undefined,
		lastPattern: undefined,
		canDelete: false,
		pressing: false,
	};
}

/**
 * Reactive wrapper around {@link Keyer}.
 *
 * The keyer itself is a plain class driven by a real clock; this holds a
 * snapshot in runes so components can bind to it, and wires the sidetone to
 * the user's actual press duration.
 */
class ReactiveKeyer {
	#keyer: Keyer;
	#listeners = new Set<Listener>();
	#state = $state<KeyerSnapshot>(emptySnapshot());
	/** Bumped on every decode so the cheat sheet can flash the match. */
	flash = $state<string | undefined>(undefined);
	#flashTimer: ReturnType<typeof setTimeout> | undefined;

	constructor() {
		this.#keyer = new Keyer({
			timings: () => settings.timings,
			onPress: () => this.#onPress(),
			onRelease: () => tone.stopSidetone(),
			onChange: (s) => this.#publish(s),
			onChar: (char) => {
				if (!char) return;
				this.flash = char;
				clearTimeout(this.#flashTimer);
				this.#flashTimer = setTimeout(() => (this.flash = undefined), 700);
			},
		});
	}

	#onPress() {
		if (settings.get('sidetone') && !tone.ready) {
			// First gesture: this is our chance to satisfy autoplay policy.
			tone.unlock();
		}
		tone.setFrequency(settings.get('freqHz'));
		tone.setVolume(settings.effectiveVolume);
		if (settings.get('sidetone')) {
			try {
				tone.startSidetone();
			} catch {
				// No audio available; keying still works silently.
			}
		}
	}

	#publish(snapshot: KeyerSnapshot) {
		this.#state = snapshot;
		for (const listener of this.#listeners) listener(snapshot);
	}

	get snapshot() {
		return this.#state;
	}

	/** Subscribe for imperative callers (e.g. a text field mirroring output). */
	subscribe(listener: Listener) {
		this.#listeners.add(listener);
		listener(this.#state);
		return () => this.#listeners.delete(listener);
	}

	press() {
		this.#keyer.press();
	}

	release() {
		this.#keyer.release();
	}

	/** Send text as Morse on the shared tone engine. */
	async play(text: string) {
		tone.setFrequency(settings.get('freqHz'));
		tone.setVolume(settings.effectiveVolume);
		await tone.playText(text, settings.timings);
	}

	stop() {
		tone.stop();
	}

	flush() {
		this.#keyer.flush();
	}

	deleteLast() {
		this.#keyer.deleteLast();
	}

	clear() {
		this.#keyer.clear();
	}
}

export const keyer = new ReactiveKeyer();
