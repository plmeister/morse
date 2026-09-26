<script lang="ts">
	import type { Snippet } from 'svelte';
	import Pattern from './Pattern.svelte';
	import { encode, extensions, GROUPS, GROUP_LABELS, type MorseGroup } from '$lib/morse';
	import { needScore, type StatsShape } from '$lib/stats.svelte';
	import { settings } from '$lib/settings.svelte';
	import { tone } from '$lib/audio';
	import { cheatSections, type SectionId } from '$lib/cheat.svelte';

	type Props = {
		/** The code being keyed right now, used to highlight what is still reachable. */
		buffer?: string;
		/** Character most recently decoded, flashed on commit. */
		flash?: string;
		/** Grey out cells that can no longer become the answer. */
		dimDeadEnds?: boolean;
		/** Show a practice marker on characters the user is struggling with. */
		stats?: StatsShape;
		/** Which sections to show. */
		groups?: MorseGroup[];
		/** Extra collapsible section, used for the standard codes. */
		children?: Snippet;
	};

	let {
		buffer = '',
		flash,
		dimDeadEnds = true,
		stats,
		groups = ['letters'],
		children,
	}: Props = $props();

	/**
	 * Cells per row, where the group needs a fixed count rather than whatever
	 * fits. Digits are all five elements and punctuation runs to six, so both are
	 * laid out by how much code a cell has to hold: five across keeps the numbers
	 * scannable as a block, and punctuation gets three because its codes are the
	 * longest in the sheet.
	 */
	const COLUMNS: Partial<Record<MorseGroup, number>> = { digits: 5, punctuation: 3 };

	// Recomputed only when the buffer changes, not on every parent update.
	const live = $derived(buffer ? new Set(extensions(buffer)) : null);

	let playing = $state<string | undefined>(undefined);

	/**
	 * Sound a cell. Pressing the cell that is already sounding stops it, so a
	 * mistake is one press to undo rather than something to sit through.
	 */
	async function play(char: string) {
		if (playing === char) {
			playing = undefined;
			tone.stop();
			return;
		}
		const pattern = encode(char);
		if (!pattern) return;

		tone.setFrequency(settings.get('freqHz'));
		tone.setVolume(settings.effectiveVolume);
		if (!tone.unlock()) return;

		// Cutting the previous code short matters here: a run of cells pressed in
		// quick succession would otherwise queue into a long smear.
		tone.stop();
		playing = char;
		try {
			await tone.playPattern(pattern, settings.timings);
		} finally {
			if (playing === char) playing = undefined;
		}
	}

	/**
	 * A cell tapped with a finger should not keep the focus. Space is this app's
	 * dot key, and a focused button would swallow it, so a tap on a cell would
	 * silently break keying until the user tapped something else. Keyboard users
	 * arrive here by tabbing, and the focus they get is left alone.
	 */
	function releaseFocus(e: Event) {
		(e.currentTarget as HTMLElement).blur();
	}

	const needFor = (char: string) => (stats ? needScore(stats.chars[char], Date.now()) : 0);

	/**
	 * Mirror the <details> toggle into the store. `open` is only bound on first
	 * render: from then on the element owns its own state, and writing the
	 * attribute back on every change would fight the browser's own handling of it.
	 */
	function track(node: HTMLDetailsElement, id: SectionId) {
		node.addEventListener('toggle', () => cheatSections.toggle(id, node.open));
	}

	const columns = (group: MorseGroup) =>
		COLUMNS[group] ? `repeat(${COLUMNS[group]}, minmax(0, 1fr))` : undefined;
</script>

<div class="cheat">
	{#each groups as group (group)}
		<!-- Each section folds away on its own, so a long sheet can be trimmed to
		     just the part being worked on. Which ones start open is remembered
		     between visits; see cheat.svelte.ts. -->
		<details class="group" open={cheatSections.initialOpen(group)} use:track={group}>
			<summary>
				<span class="section-title">{GROUP_LABELS[group]}</span>
				<span class="count">{GROUPS[group].length}</span>
			</summary>
			<ul data-group={group} style:grid-template-columns={columns(group)}>
				{#each GROUPS[group] as char (char)}
					{@const need = needFor(char)}
					{@const reachable = live === null || live.has(char)}
					<li>
						<button
							type="button"
							class="cell"
							class:live={reachable}
							class:dim={dimDeadEnds && !reachable}
							class:flash={flash === char}
							class:playing={playing === char}
							aria-current={flash === char}
							aria-label="Play {char}"
							onclick={() => play(char)}
							onpointerup={releaseFocus}
						>
							<span class="play" aria-hidden="true">{playing === char ? '■' : '▶'}</span>
							<span class="char">{char}</span>
							<Pattern pattern={encode(char) ?? ''} size="sm" />
							{#if need > 0.35}
								<span
									class="need"
									class:urgent={need > 0.7}
									title="Needs practice: {Math.round(need * 100)}%"
								>
									{need > 0.7 ? '!' : '?'}
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</details>
	{/each}

	{#if children}
		<details
			class="group codes"
			open={cheatSections.initialOpen('codes')}
			use:track={'codes'}
		>
			<summary>
				<span class="section-title">Standard codes</span>
			</summary>
			<div class="group-body">
				{@render children()}
			</div>
		</details>
	{/if}
</div>

<style>
	.cheat {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.group {
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface-2);
		padding: 0.3rem 0.4rem 0.45rem;
	}

	.group > summary {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		list-style: none;
		padding: 0.15rem 0.1rem;
		min-height: 1.8rem;
	}

	/* Hide the default disclosure triangle; the count doubles as the affordance. */
	.group > summary::-webkit-details-marker {
		display: none;
	}

	.group > summary::before {
		content: '▸';
		font-size: 0.7rem;
		color: var(--faint);
		transition: transform 0.14s;
	}

	.group[open] > summary::before {
		transform: rotate(90deg);
	}

	.count {
		font-size: 0.65rem;
		color: var(--faint);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0 0.35rem;
		line-height: 1.5;
	}

	.group-body {
		padding-top: 0.35rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(4.7rem, 1fr));
		gap: 0.3rem;
	}

	/* The pattern unit, chosen against the cell rather than against the text
	   around it. At the sheet's own scale a five element code needs about 91px,
	   which overflowed a five across digit cell by 49px on a 320px phone and read
	   as a smear. Scaling the unit with the viewport keeps the longest code in
	   the sheet inside the tightest cell it has to fit, and lets a wide screen
	   draw it larger. */
	.cell :global(.pattern.sm) {
		--u: clamp(2px, 0.6vw, 3.2px);
	}

	.cell {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		padding: 0.45rem 0.25rem 0.35rem;
		min-height: 3.3rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		transition:
			opacity 0.14s,
			background 0.14s,
			border-color 0.14s;
	}

	/* A cell that can still become the answer stays lit; the rest recede so the
	   eye is pulled to the few options still open. */
	.cell.dim {
		opacity: 0.22;
	}

	.cell.live {
		border-color: var(--border-strong);
	}

	.cell.flash {
		background: var(--accent-soft);
		border-color: var(--accent);
		animation: pop 0.5s ease-out;
	}

	@keyframes pop {
		0% {
			transform: scale(0.9);
		}
		55% {
			transform: scale(1.07);
		}
		100% {
			transform: scale(1);
		}
	}

	.char {
		font-size: 1.05rem;
		font-weight: 600;
		line-height: 1;
	}

	/* The affordance that says a cell is a button. Kept out of the way until the
	   cell is hovered, focused or sounding, since the character is what the eye
	   is actually after. */
	.play {
		position: absolute;
		top: 3px;
		left: 5px;
		font-size: 0.58rem;
		color: var(--faint);
		opacity: 0;
		transition: opacity 0.12s;
	}

	.cell:hover .play,
	.cell:focus-visible .play,
	.cell.playing .play {
		opacity: 1;
	}

	.cell.playing {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.cell.playing .play {
		color: var(--accent);
	}

	.need {
		position: absolute;
		top: 2px;
		right: 5px;
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--warn);
		line-height: 1;
	}

	.need.urgent {
		color: var(--bad);
	}
</style>
