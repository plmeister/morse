<script lang="ts">
	import Pattern from './Pattern.svelte';
	import { keyer } from '$lib/keyer.svelte';
	import { handleKeyDown, handleKeyUp } from '$lib/key-typing';

	let { onsend }: { onsend?: () => void } = $props();

	const snap = $derived(keyer.snapshot);

	// --- keyboard keying ---------------------------------------------------
	// Any key keys, like a real straight key. The rules live in key-typing so
	// the keying quiz keys the same way on its own tab.
	function onKeyDown(e: KeyboardEvent) {
		if (handleKeyDown(e, keyer)) e.preventDefault();
	}

	function onKeyUp(e: KeyboardEvent) {
		if (handleKeyUp(e, keyer)) e.preventDefault();
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

	<!-- The character just committed, and the one control that takes it back.
	     Always rendered rather than appearing with the first character: this row
	     sits in the docked console, so a conditional row resized the panel under
	     the finger and yanked the page above it every time something was keyed.

	     The delete button is a bare cross because the row already says which
	     character it will remove, and a worded button did not fit beside the
	     label, the character and its code in a narrow console. -->
	<div class="last" class:empty={!snap.lastChar}>
		<span class="last-label">last</span>
		{#if snap.lastChar}
			<span class="last-char">{snap.lastChar}</span>
			{#if snap.lastPattern}
				<Pattern pattern={snap.lastPattern} size="sm" />
			{/if}
		{:else}
			<span class="last-char none">&mdash;</span>
		{/if}
		<span class="spacer"></span>
		<button
			class="btn drop"
			type="button"
			disabled={!snap.canDelete}
			onclick={() => keyer.deleteLast()}
			aria-label="Delete the last character"
			title="Delete it (Backspace)"
		>
			&#10005;
		</button>
	</div>

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
		gap: 0.45rem;
	}

	.output {
		/* Sized so one line of text is no taller than the empty box: this console
		   is docked, and a min-height that a single line overhung made the panel
		   jump the first time a character was committed. */
		min-height: 2.9rem;
		display: flex;
		align-items: center;
		font-size: 1.25rem;
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
		padding: 0.25rem 0.5rem 0.25rem 0.75rem;
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

	.last.empty {
		opacity: 0.5;
	}

	.last-char.none {
		color: var(--faint);
		font-weight: 400;
	}

	.last-char {
		flex: none;
		font-size: 1.05rem;
		font-weight: 650;
		color: var(--text);
		min-width: 0.9rem;
		text-align: center;
	}

	.spacer {
		flex: 1 1 0;
		min-width: 0;
	}

	.btn.drop {
		flex: none;
		display: grid;
		place-items: center;
		width: 2.1rem;
		height: 2.1rem;
		padding: 0;
		font-size: 0.9rem;
		line-height: 1;
	}

	.live {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.3rem 0.6rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.live-char {
		flex: none;
		width: 2.2rem;
		height: 2.2rem;
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

	/* A short screen cannot spare the room. The output's text is sized to fit its
	   own box here too, so the console does not jump when the first character
	   lands. */
	@media (max-height: 700px) {
		.keyer {
			gap: 0.35rem;
		}

		.output {
			min-height: 2.5rem;
			padding: 0.35rem 0.6rem;
			font-size: 1.1rem;
		}

		.last {
			padding: 0.2rem 0.4rem 0.2rem 0.6rem;
		}

		.live {
			padding: 0.25rem 0.5rem;
		}

		.live-char {
			width: 1.95rem;
			height: 1.95rem;
			font-size: 1.15rem;
		}

		.btn.drop {
			width: 1.95rem;
			height: 1.95rem;
		}
	}


</style>
