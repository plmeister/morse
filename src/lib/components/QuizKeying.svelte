<script lang="ts">
	import KeyPad from './KeyPad.svelte';
	import { keyer } from '$lib/keyer.svelte';
	import { handleKeyDown, handleKeyUp } from '$lib/key-typing';
	import { gradeKeying, type KeyingVerdict } from '$lib/keying';

	let {
		target,
		done = false,
		onresult,
	}: {
		target: string;
		/** Set once the answer is settled: the marks stay, the key does not. */
		done?: boolean;
		onresult: (result: { verdict: KeyingVerdict; sent: string }) => void;
	} = $props();

	const snap = $derived(keyer.snapshot);
	const letters = $derived([...target.replace(/\s/g, '')]);
	const verdict = $derived(gradeKeying(target, snap.output));

	// The keyer is shared with the key tab and still holds the previous answer,
	// which would be graded against this one.
	keyer.clear();

	// Report the outcome once, the moment it is settled.
	let reported = false;
	$effect(() => {
		if (reported || !verdict.done) return;
		reported = true;
		onresult({ verdict, sent: snap.output.trim() });
	});

	// Once the answer is settled the key is taken away, so a stray tap cannot
	// repaint the marks and contradict the verdict.
	function onKeyDown(e: KeyboardEvent) {
		if (done) return;
		if (handleKeyDown(e, keyer)) e.preventDefault();
	}

	function onKeyUp(e: KeyboardEvent) {
		if (done) return;
		if (handleKeyUp(e, keyer)) e.preventDefault();
	}
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<div class="keying">
	<p class="target" aria-live="polite">{target}</p>

	<div class="marks" aria-hidden="true">
		{#each letters as letter, i (i)}
			<span
				class="mark"
				class:right={verdict.marks[i] === 'right'}
				class:wrong={verdict.marks[i] === 'wrong'}
				class:gap={verdict.marks[i] === 'gap'}
			>
				{letter}
			</span>
		{/each}
	</div>

	{#if !done}
		<KeyPad />

		<p class="hint">
		Send it. Any key sends a dot, hold it for a dash, leave a space between characters. Backspace
		removes one, Escape clears.
		</p>
		<p class="hint">
		{#if letters.length > 1}
			Keep the pause between characters short. Long enough and it reads as the end of the word,
			which is marked down even though every character was sent.
		{:else}
			Hold each element to make it a dash, and leave a moment between them.
		{/if}
		</p>
	{/if}
</div>

<style>
	.keying {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.target {
		margin: 0;
		/* Big enough to read at arm's length on a phone, which is how far away the
		   hand keying it is. */
		font-size: clamp(1.9rem, 8vw, 3rem);
		font-weight: 600;
		letter-spacing: 0.06em;
		text-align: center;
		color: var(--accent);
	}

	.marks {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		justify-content: center;
	}

	.mark {
		min-width: 2rem;
		padding: 0.2rem 0.35rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		text-align: center;
		font-weight: 600;
		color: var(--muted);
		background: var(--surface-2);
		transition: background 120ms linear, border-color 120ms linear, color 120ms linear;
	}

	.mark.right {
		border-color: var(--good);
		color: var(--good);
	}

	.mark.wrong {
		border-color: var(--bad);
		color: var(--bad);
	}

	/* The character is right, the pause in front of it was not. */
	.mark.gap {
		border-color: var(--warn);
		color: var(--warn);
		background: var(--surface);
	}

	.hint {
		margin: 0;
	}
</style>
