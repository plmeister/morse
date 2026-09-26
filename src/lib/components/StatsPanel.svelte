<script lang="ts">
	import Pattern from './Pattern.svelte';
	import { GROUPS } from '$lib/morse';
	import { summarise, type SummaryRow } from '$lib/quiz';
	import { settings } from '$lib/settings.svelte';
	import { stats } from '$lib/stats.svelte';

	type Filter = 'weak' | 'all' | 'unseen';

	let filter = $state<Filter>('weak');

	const pool = $derived(
		GROUPS.letters.concat(
			settings.get('includeDigits') ? GROUPS.digits : [],
			settings.get('includePunct') ? GROUPS.punctuation : [],
		),
	);

	// Recomputed when the underlying stats change, not on every render.
	const rows = $derived<SummaryRow[]>(summarise(pool, stats.raw));

	const seen = $derived(rows.filter((r) => r.stat.seen > 0));
	const weak = $derived(seen.filter((r) => r.need > 0.35));
	const unseen = $derived(rows.filter((r) => r.stat.seen === 0));

	const shown = $derived(
		filter === 'weak' ? weak : filter === 'unseen' ? unseen : rows,
	);

	const totalAnswered = $derived(stats.raw.answered);
	const totalCorrect = $derived(stats.raw.correct);
	const lifetime = $derived(totalAnswered === 0 ? 0 : totalCorrect / totalAnswered);

	// A letter only counts as mastered once it has been seen enough to judge.
	const MASTERED_MIN = 8;
	const mastered = $derived(seen.filter((r) => r.need <= 0.2 && r.stat.seen >= MASTERED_MIN).length);

	let confirmReset = $state(false);
</script>

<div class="stack">
	<div class="overview">
		<div class="tile">
			<span class="tile-value">{totalAnswered === 0 ? '—' : `${Math.round(lifetime * 100)}%`}</span>
			<span class="tile-label">lifetime accuracy</span>
		</div>
		<div class="tile">
			<span class="tile-value">{stats.raw.bestStreak}</span>
			<span class="tile-label">best streak</span>
		</div>
		<div class="tile">
			<span class="tile-value">{stats.raw.sessions}</span>
			<span class="tile-label">sessions</span>
		</div>
	</div>

	{#if totalAnswered === 0}
		<div class="card empty">
			<p class="muted">No answers recorded yet.</p>
			<p class="hint">Run a quiz and the per-character breakdown fills in here.</p>
		</div>
	{/if}

	<div class="progress-row">
		<div class="progress">
			<div class="progress-fill" style:width="{(mastered / 26) * 100}%"></div>
		</div>
		<span class="hint">{mastered}/26 letters mastered</span>
	</div>

	<div class="filters">
		{#each [['weak', `Needs work (${weak.length})`], ['all', `All (${rows.length})`], ['unseen', `Unseen (${unseen.length})`]] as const as [key, label] (key)}
			<button
				type="button"
				class="chip"
				class:on={filter === key}
				onclick={() => (filter = key)}
			>
				{label}
			</button>
		{/each}
	</div>

	{#if shown.length === 0}
		<p class="hint pad">
			{filter === 'weak'
				? 'Nothing flagged — either nothing has been missed, or nothing has been tried yet.'
				: filter === 'unseen'
					? 'Every character in the pool has come up at least once.'
					: 'No characters in the pool.'}
		</p>
	{:else}
		<ul class="rows">
			{#each shown as row (row.char)}
				{@const pct = Math.round(row.accuracy * 100)}
				<li>
					<span class="r-char">{row.char}</span>
					<Pattern pattern={row.pattern} size="sm" />
					<span class="r-bar" title="{pct}% correct over {row.stat.seen}">
						<span
							class="r-fill"
							class:hot={row.need > 0.35}
							style:width="{pct}%"
						></span>
					</span>
					<span class="r-nums">
						{#if row.stat.seen === 0}
							<span class="faint">new</span>
						{:else}
							<span class:r-low={pct < 60}>{pct}%</span>
							<span class="faint">/ {row.stat.seen}</span>
						{/if}
					</span>
					{#if row.stat.streak > 1}
						<span class="r-streak" title="Current streak">{row.stat.streak}&times;</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<div class="danger">
		{#if confirmReset}
			<p class="hint">Erase all recorded history? This cannot be undone.</p>
			<div class="row">
				<button class="btn btn-bad" type="button" onclick={() => (stats.reset())}>
					Erase
				</button>
				<button class="btn" type="button" onclick={() => (confirmReset = false)}>Cancel</button>
			</div>
		{:else}
			<button class="btn" type="button" onclick={() => (confirmReset = true)}>
				Reset history
			</button>
		{/if}
	</div>
</div>

<style>
	.overview {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0.7rem 0.75rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.tile-value {
		font-size: 1.5rem;
		font-weight: 650;
		line-height: 1.1;
	}

	.tile-label {
		font-size: 0.72rem;
		color: var(--faint);
	}

	.empty p {
		margin: 0 0 0.3rem;
		font-size: 0.9rem;
	}

	.progress-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.progress {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--good);
		transition: width 0.3s;
	}

	.filters {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.chip {
		min-height: 2.1rem;
		padding: 0 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border-strong);
		background: var(--surface-2);
		font-size: 0.82rem;
		color: var(--muted);
	}

	.chip.on {
		background: var(--accent-soft);
		border-color: var(--accent);
		color: var(--accent);
	}

	.pad {
		padding: 0.5rem 0.1rem;
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.rows li {
		display: grid;
		grid-template-columns: 1.6rem 4.2rem 1fr auto auto;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.5rem;
		border-radius: 8px;
		background: var(--surface);
		font-size: 0.85rem;
	}

	.r-char {
		font-weight: 650;
		text-align: center;
	}

	.r-bar {
		height: 5px;
		border-radius: 3px;
		background: var(--surface-3);
		overflow: hidden;
	}

	.r-fill {
		display: block;
		height: 100%;
		background: var(--good);
	}

	.r-fill.hot {
		background: var(--bad);
	}

	.r-nums {
		display: flex;
		gap: 0.2rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.78rem;
	}

	.r-low {
		color: var(--bad);
	}

	.r-streak {
		font-size: 0.75rem;
		color: var(--good);
		font-weight: 650;
	}

	.danger {
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.danger p {
		margin: 0;
	}
</style>
