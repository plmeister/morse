<script lang="ts">
	import { elements } from '$lib/morse';

	type Props = {
		pattern: string;
		/** Visual weight. `sm` fits a cheat-sheet cell, `lg` is for a single answer. */
		size?: 'sm' | 'md' | 'lg';
		/** Dim elements that are not part of the pattern, used for a live buffer. */
		dim?: boolean;
	};

	let { pattern, size = 'md', dim = false }: Props = $props();
</script>

<span class="pattern {size}" class:dim aria-label={pattern || 'empty'}>
	{#each elements(pattern) as symbol, i (i)}
		<span class="el {symbol === '-' ? 'dash' : 'dot'}" class:dim-el={dim}></span>
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
		white-space: nowrap;
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
