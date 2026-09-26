<script lang="ts">
	import Pattern from './Pattern.svelte';
	import { keyer } from '$lib/keyer.svelte';
	import { settings } from '$lib/settings.svelte';
	import { dashThreshold } from '$lib/timing';

	let { onsend }: { onsend?: () => void } = $props();

	const snap = $derived(keyer.snapshot);
	const threshold = $derived(dashThreshold(settings.timings));
	const charGap = $derived(settings.timings.charGapMs);

	// --- keyboard keying ---------------------------------------------------
	// Any key keys, like a real straight key. Suppressed while typing so the
	// send-a-message box is still usable.
	function isTyping(target: EventTarget | null): boolean {
		const el = target as HTMLElement | null;
		if (!el) return false;
		return (
			el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true
		);
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
		if (isTyping(e.target)) return;
		if (e.key === 'Escape') {
			keyer.clear();
			return;
		}
		// Backspace pulls a character back / drops it. Both are longer than one
		// character, so they are handled before the "any key keys" rule below
		// would ignore them anyway.
		if (e.key === 'Backspace') {
			e.preventDefault();
			if (e.shiftKey) keyer.mergeLast();
			else keyer.deleteLast();
			return;
		}
		// Let the browser keep its own shortcuts (tab, devtools, reload).
		if (e.key === 'Tab' || e.key.length > 1) return;
		e.preventDefault();
		keyer.press();
	}

	function onKeyUp(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (isTyping(e.target)) return;
		if (e.key === 'Escape' || e.key === 'Tab' || e.key.length > 1) return;
		keyer.release();
	}

</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<div class="keyer">
	<!-- Decoded output -->
	<div class="output" aria-live="polite" aria-atomic="false">
		{#if snap.output}
			<span>{snap.output}</span>{#if snap.buffer}<span class="cursor">▍</span>{/if}
		{:else if snap.buffer}
			<span class="placeholder">waiting for the first character…</span>
		{/if}
	</div>

	<!-- The character just committed, with the two ways to take it back. A slow
	     pause inside a character splits it in two, and these are how you put it
	     back together. -->
	{#if snap.lastChar}
		<div class="last">
			<span class="last-label">last</span>
			<span class="last-char">{snap.lastChar}</span>
			{#if snap.lastPattern}
				<Pattern pattern={snap.lastPattern} size="sm" />
			{/if}
			<span class="spacer"></span>
			<button
				class="btn tiny"
				type="button"
				disabled={!snap.canMerge}
				onclick={() => keyer.mergeLast()}
				title="Put it back in the buffer and carry on keying (Shift+Backspace)"
			>
				&#8617; Merge
			</button>
			<button
				class="btn tiny"
				type="button"
				disabled={!snap.canDelete}
				onclick={() => keyer.deleteLast()}
				title="Delete it (Backspace)"
			>
				&#10005; Delete
			</button>
		</div>
	{/if}

	<!-- What is being keyed right now -->
	<div class="live">
		<div class="live-char" class:set={snap.live !== undefined}>
			{snap.buffer ? (snap.live ?? '?') : '—'}
		</div>
		<div class="live-detail">
			<Pattern pattern={snap.buffer} size="md" dim={snap.live === undefined && snap.buffer !== ''} />
			<span class="live-hint">
				{#if snap.buffer}
					{#if snap.live}
						decodes to <strong>{snap.live}</strong>
					{:else}
						not a code yet
					{/if}
				{/if}
			</span>
		</div>
	</div>

	<div class="actions">
		<button class="btn" type="button" onclick={() => keyer.clear()}>Clear</button>
		<button class="btn" type="button" onclick={() => keyer.flush()}>Send char</button>
		{#if onsend}
			<button class="btn btn-primary" type="button" onclick={onsend}>Send text…</button>
		{/if}
	</div>

</div>

<style>
	.keyer {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.output {
		min-height: 3.4rem;
		display: flex;
		align-items: center;
		font-size: 1.5rem;
		font-weight: 500;
		line-height: 1.35;
		word-break: break-word;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.placeholder {
		color: var(--faint);
		font-size: 0.95rem;
		font-weight: 400;
	}

	.cursor {
		color: var(--accent);
		animation: blink 1s steps(2, start) infinite;
	}

	@keyframes blink {
		50% {
			opacity: 0;
		}
	}

	.last {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.35rem 0.5rem 0.35rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.last-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--faint);
	}

	.last-char {
		font-size: 1.05rem;
		font-weight: 650;
		color: var(--text);
		min-width: 0.9rem;
		text-align: center;
	}

	.spacer {
		flex: 1;
	}

	.btn.tiny {
		flex: none;
		min-height: 1.9rem;
		padding: 0 0.5rem;
		font-size: 0.78rem;
	}

	.live {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.live-char {
		flex: none;
		width: 2.6rem;
		height: 2.6rem;
		display: grid;
		place-items: center;
		border-radius: 10px;
		background: var(--surface-2);
		font-size: 1.3rem;
		font-weight: 650;
		color: var(--faint);
	}

	.live-char.set {
		background: var(--accent-soft);
		color: var(--accent);
	}

	.live-detail {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		min-width: 0;
	}

	.live-hint {
		font-size: 0.75rem;
		color: var(--muted);
	}

	.live-hint strong {
		color: var(--text);
	}

	.actions {
		display: flex;
		gap: 0.4rem;
	}

	.actions .btn {
		flex: 1;
		font-size: 0.85rem;
		padding: 0 0.4rem;
	}


</style>
