<script lang="ts">
	import Pattern from './Pattern.svelte';
	import { settings } from '$lib/settings.svelte';
	import { tone } from '$lib/audio';
	import { PHRASES, PHRASE_CATEGORIES, phrasePattern, phraseUnits, isKeyable } from '$lib/phrases';

	let playing = $state<string | undefined>(undefined);

	async function play(id: string, chars: string) {
		const phrase = PHRASES.find((p) => p.id === id);
		if (!phrase) return;

		tone.setFrequency(settings.get('freqHz'));
		tone.setVolume(settings.effectiveVolume);
		if (!tone.unlock()) return;

		playing = id;
		try {
			const units = phraseUnits(phrase, settings.timings);
			for (const unit of units) {
				// Sequenced by hand so a phrase can be stopped between its parts.
				await tone.playPattern(unit.pattern, settings.timings);
				if (playing !== id) return;
				const gap = unit.gapAfterMs - settings.timings.charGapMs;
				if (gap > 0) await new Promise((r) => setTimeout(r, gap));
			}
		} finally {
			if (playing === id) playing = undefined;
		}
	}

	function stop() {
		playing = undefined;
		tone.stop();
	}
</script>

<div class="phrases">
	{#each PHRASE_CATEGORIES as cat (cat.id)}
		{@const rows = PHRASES.filter((p) => p.category === cat.id && isKeyable(p))}
		{#if rows.length}
			<section>
				<h3 class="section-title">{cat.label}</h3>
				<ul>
					{#each rows as phrase (phrase.id)}
						<li>
							<button
								class="phrase"
								class:playing={playing === phrase.id}
								type="button"
								onclick={() => (playing === phrase.id ? stop() : play(phrase.id, phrase.chars))}
								aria-label="Play {phrase.chars}, {phrase.meaning}"
							>
								<span class="chars">{phrase.chars}</span>
								<span class="meaning">
									{phrase.meaning}
									{#if phrase.joined}<em class="joined">sent as one run</em>{/if}
								</span>
								<Pattern pattern={phrasePattern(phrase)} size="sm" />
								<span class="play" aria-hidden="true">{playing === phrase.id ? '■' : '▶'}</span>
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/each}
</div>

<style>
	.phrases {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	h3 {
		margin: 0 0 0.35rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.phrase {
		width: 100%;
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		grid-template-areas: 'chars meaning pattern play';
		align-items: center;
		gap: 0.6rem;
		padding: 0.45rem 0.6rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		text-align: left;
		min-height: 2.6rem;
	}

	.phrase:hover {
		border-color: var(--border-strong);
	}

	.phrase.playing {
		border-color: var(--accent);
		background: var(--accent-soft);
	}

	.chars {
		grid-area: chars;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.95rem;
		font-weight: 650;
		color: var(--accent);
		min-width: 2.6rem;
	}

	.meaning {
		grid-area: meaning;
		font-size: 0.82rem;
		color: var(--muted);
		min-width: 0;
	}

	/* A long code such as "Interference, often from static" runs to about fifteen
	   elements, which is wider than a phone once the label and the play button are
	   accounted for. Naming the areas lets a narrow screen give the pattern a row
	   of its own instead of letting it push the whole row past the edge. */
	.phrase :global(.pattern) {
		grid-area: pattern;
	}

	.play {
		grid-area: play;
	}

	@media (max-width: 480px) {
		.phrase {
			grid-template-columns: auto 1fr auto;
			grid-template-areas:
				'chars meaning play'
				'pattern pattern pattern';
			row-gap: 0.35rem;
		}
	}

	.joined {
		display: block;
		font-size: 0.7rem;
		color: var(--faint);
		font-style: normal;
	}

	.play {
		font-size: 0.7rem;
		color: var(--faint);
		min-width: 0.8rem;
		text-align: center;
	}

	.phrase.playing .play {
		color: var(--accent);
	}
</style>
