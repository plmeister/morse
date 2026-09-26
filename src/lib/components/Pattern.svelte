<script lang="ts">
	import { elements, phraseSteps, type PhraseStep } from '$lib/morse';

	type Props = {
		pattern: string;
		/** Visual weight. `sm` fits a cheat-sheet cell, `lg` is for a single answer. */
		size?: 'sm' | 'md' | 'lg';
		/** Dim elements that are not part of the pattern, used for a live buffer. */
		dim?: boolean;
		/**
		 * Set when the pattern is a whole phrase from `encodePhrase`, which can
		 * carry a word gap. A single code has no gaps in it to draw, so the plain
		 * splitter is used for everything else.
		 */
		phrase?: boolean;
	};

	let { pattern, size = 'md', dim = false, phrase = false }: Props = $props();

	const steps = $derived<PhraseStep[]>(phrase ? phraseSteps(pattern) : elements(pattern));
</script>

<span class="pattern {size}" class:phrase class:dim aria-label={pattern || 'empty'}>
	{#each steps as symbol, i (i)}
		{#if symbol === 'gap'}
			<span class="word-gap" title="word gap"></span>
		{:else}
			<span class="el {symbol === '-' ? 'dash' : 'dot'}" class:dim-el={dim}></span>
		{/if}
	{/each}
	{#if !pattern}
		<span class="empty">&mdash;</span>
	{/if}
</span>

<style>
	/* Drawn as real boxes rather than glyphs so the width of a symbol is honest:
	   a dot is one unit across, a dash is three, and the silence between them is
	   one unit. That makes the picture match the timing you are being taught,
	   and it is what stops a run of dashes from reading as one long line. */
	.pattern {
		--u: 0.52em;
		display: inline-flex;
		align-items: center;
		gap: var(--u);
		color: var(--accent);
		line-height: 1;
		/* A whole group is far too wide for one line in an answer button, so a
		   phrase wraps between words and the drawing breaks with it. */
		flex-wrap: wrap;
		row-gap: calc(var(--u) * 0.8);
		max-width: 100%;
	}

	.pattern:not(.phrase) {
		white-space: nowrap;
	}

	/* The word gap is drawn rather than left as a gap, so the pause is visible
	   and not confused with the character spacing around it. */
	.word-gap {
		flex: none;
		width: calc(var(--u) * 2.4);
		height: 1px;
		background: currentColor;
		opacity: 0.45;
	}

	.pattern.sm {
		--u: 0.3em;
	}

	.pattern.md {
		--u: 0.5em;
	}

	.pattern.lg {
		--u: 0.95em;
	}

	.pattern.dim {
		opacity: 0.5;
	}

	.el {
		display: block;
		flex: none;
		background: currentColor;
	}

	.el.dot {
		width: var(--u);
		height: var(--u);
		border-radius: 50%;
	}

	.el.dash {
		width: calc(var(--u) * 3);
		height: calc(var(--u) * 0.42);
		border-radius: calc(var(--u) * 0.21);
	}

	.dim-el {
		opacity: 0.25;
	}

	.empty {
		color: var(--faint);
		font-size: 0.8em;
	}
</style>
