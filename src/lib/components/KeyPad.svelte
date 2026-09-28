<script lang="ts">
	import { keyer } from '$lib/keyer.svelte';

	/**
	 * Only the pressed state, which is the only part of the snapshot the key shows.
	 * Taking the whole snapshot would re-run this component's template on every
	 * character appended to the buffer, for a key whose face does not change when
	 * a character is appended.
	 */
	const pressing = $derived(keyer.snapshot.pressing);

	/** Pointer id currently holding the key down, so a second finger is ignored. */
	let activePointer: number | null = null;

	function down(e: PointerEvent) {
		// Ignore secondary buttons so right-click does not stick the key down.
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (activePointer !== null) return;
		// A hold is the normal way to send a dash, so the browser must not treat
		// the finger staying put as the start of a drag or a long press. Without
		// this, holding the key on a touchscreen selects the text around it.
		e.preventDefault();
		activePointer = e.pointerId;
		// Capture keeps the release paired with this press even if the finger
		// slides off the button. It throws for a pointer the browser no longer
		// considers active, which must not stop the key from working.
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {
			// Not capturable; the release will still arrive on pointerup.
		}
		keyer.press(e.timeStamp);
	}

	function up(e: PointerEvent) {
		if (activePointer !== e.pointerId) return;
		activePointer = null;
		keyer.release(e.timeStamp);
	}

	// With pointer capture in place, cancel only fires if the browser took the
	// capture away, e.g. a system gesture interrupted the press.
	function cancel(e: PointerEvent) {
		if (activePointer !== e.pointerId) return;
		activePointer = null;
		keyer.release(e.timeStamp);
	}

	// A key held when the page loses focus would never see its keyup, which
	// would leave the sidetone droning and the buffer stuck mid-character.
	function onBlur() {
		if (activePointer !== null) activePointer = null;
		keyer.release();
	}
</script>

<svelte:window onblur={onBlur} />

<!-- The key, docked so it stays reachable however far the page above it has been
     scrolled. A div rather than a button: keying is driven by pointer down/up,
     and a real button would also synthesise a click from the space bar, which
     already keys a dot. -->
<div
	class="key"
	class:down={pressing}
	role="button"
	tabindex="0"
	aria-label="Morse key. Hold to send a dash, tap to send a dot."
	onpointerdown={down}
	onpointerup={up}
	onpointercancel={cancel}
	onlostpointercapture={cancel}
	oncontextmenu={(e) => e.preventDefault()}
	onselectstart={(e) => e.preventDefault()}
	ondragstart={(e) => e.preventDefault()}
>
	<span class="key-label">KEY</span>
</div>

<style>
	/* The one control on the page that is not part of a form, so it gets its own
	   colour instead of the app's amber. A dark ink on a saturated orange is 6:1,
	   which keeps the label readable while still being the brightest thing here. */
	.key {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		/* Big enough to hit without looking, and it grows with the screen rather
		   than sitting at a fixed size that is too small on a tablet and silly on a
		   desktop.

		   Kept modest on a phone held upright: this is a bottom dock, so every
		   pixel here comes straight out of the cheat sheet above, and the button
		   sits under a thumb rather than needing to be aimed at. */
		height: clamp(4.75rem, 16dvh, 8.5rem);
		border-radius: var(--radius-lg);
		border: 1px solid var(--key-edge);
		background: linear-gradient(180deg, var(--key-face), var(--key-face-2));
		box-shadow:
			0 6px 20px var(--key-glow),
			inset 0 1px 0 rgb(255 255 255 / 0.3);
		touch-action: none;
		/* user-select alone is not enough on a touchscreen: the selection can still
		   start on the key and drag out into the readout above it. */
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
		cursor: pointer;
		/*
		 * The press is signalled by the face colour alone, and it is the only
		 * animated property. Moving the key or swapping its shadow as well would
		 * cost a repaint and a layout of the whole dock for a state the colour
		 * already says, and this button is pressed over and over by someone
		 * keying a character at a time.
		 */
		transition: background 0.09s;
	}

	.key.down {
		background: linear-gradient(180deg, var(--key-face-2), var(--key-face-down));
	}

	.key-label {
		font-size: clamp(1.3rem, 5.5vw, 2.6rem);
		font-weight: 800;
		letter-spacing: 0.16em;
		color: var(--key-ink);
		line-height: 1;
	}

	/* A short screen, held upright, has the least to spare: the key is still a
	   comfortable target under a thumb, but it stops competing with the cheat
	   sheet for the height. */
	@media (max-height: 700px) and (orientation: portrait) {
		.key {
			height: clamp(3.75rem, 13dvh, 6rem);
		}
	}

	/* Wide enough for a second column: the page puts the key in a full height
	   panel beside the scrolling content, so the key fills that panel instead of
	   stretching across the bottom. The page owns that layout, and this matches
	   its breakpoint. */
	@media (min-width: 640px) {
		.key {
			height: 100%;
		}
	}
</style>
