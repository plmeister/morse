<script lang="ts">
	import Slider from './Slider.svelte';
	import { tone } from '$lib/audio';
	import { settings } from '$lib/settings.svelte';
	import { stats } from '$lib/stats.svelte';
	import { GROUPS, GROUP_LABELS, type MorseGroup } from '$lib/morse';
	import {
		MAX_CHAR_GAP_MS,
		MAX_DASH_MS,
		MAX_DOT_MS,
		MAX_WORD_GAP_MS,
		MIN_CHAR_GAP_MS,
		MIN_DASH_MS,
		MIN_DOT_MS,
		MIN_WORD_GAP_MS,
		timingsForWpm,
	} from '$lib/timing';

	/**
	 * The device's own delay between a sound being rendered and it being heard.
	 *
	 * Read into state rather than derived, because the engine is a plain class
	 * and nothing here would tell a derived value it had gone stale. The panel
	 * remounts each time it is opened, which is what picks up a changed figure
	 * after, say, a Bluetooth headset arrives and adds its own.
	 */
	let latency = $state(0);
	$effect(() => {
		latency = tone.outputLatencyMs;
		// The context is built at start up, so this is normally settled already;
		// the frame covers the panel being opened before that has happened.
		const id = requestAnimationFrame(() => (latency = tone.outputLatencyMs));
		return () => cancelAnimationFrame(id);
	});
	/** Chrome under-reports it on desktop, where it is never the bottleneck. */
	const latencyFloor = $derived(latency > 0 && latency < 20 ? ' (under-reported here)' : '');

	const SLOW = { ...timingsForWpm(5) };
	const FAST = { ...timingsForWpm(40) };

	const CHEAT_SECTIONS = (Object.keys(GROUPS) as MorseGroup[]).map((id) => ({
		id,
		label: GROUP_LABELS[id],
	}));

	const cheatGroups = $derived(settings.get('cheatGroups'));

	function toggleGroup(id: MorseGroup, on: boolean) {
		const next = on ? [...cheatGroups, id] : cheatGroups.filter((g) => g !== id);
		// An empty cheat sheet helps nobody, so the last section stays put.
		settings.set('cheatGroups', next.length ? [...new Set(next)] : [id]);
	}

	const offStandard = $derived(settings.offStandard);
	const threshold = $derived((settings.get('dotMs') + settings.get('dashMs')) / 2);

	let confirmReset = $state(false);
</script>

<div class="stack">
	<!-- ---------------------------------------------------------------- timing -->
	<section class="card">
		<h3 class="section-title">Timing</h3>

		<Slider
			label="Speed"
			value={settings.wpm}
			min={5}
			max={40}
			unit=" WPM"
			hint="PARIS speed: how fast the reference word PARIS would be sent."
			onchange={(v) => settings.setWpm(v)}
		/>

		<div class="divider"></div>

		<label class="toggle">
			<input
				type="checkbox"
				checked={settings.get('linkToStandard')}
				onchange={(e) => settings.set('linkToStandard', e.currentTarget.checked)}
			/>
			<span>Speed also moves the dash and gaps</span>
		</label>
		<p class="hint">
			On: the speed slider sets all four to the standard 3:3:7 ratio. Off: speed only sets the
			dot. Either way the four sliders below are always yours to move.
		</p>

		<div class="divider"></div>

		<Slider
			label="Dot"
			value={settings.get('dotMs')}
			min={MIN_DOT_MS}
			max={MAX_DOT_MS}
			step={5}
			unit=" ms"
			hint="One unit. Everything else is measured against this."
			onchange={(v) => settings.setTiming('dotMs', v)}
		/>
		<Slider
			label="Dash"
			value={settings.get('dashMs')}
			min={MIN_DASH_MS}
			max={MAX_DASH_MS}
			step={5}
			unit=" ms"
			hint="Standard is 3x the dot. Yours is {settings.dashRatio.toFixed(2)}x."
			onchange={(v) => settings.setTiming('dashMs', v)}
		/>
		<Slider
			label="Character gap"
			value={settings.get('charGapMs')}
			min={MIN_CHAR_GAP_MS}
			max={MAX_CHAR_GAP_MS}
			step={5}
			unit=" ms"
			hint="Silence that ends a character. Standard is 3x the dot."
			onchange={(v) => settings.setTiming('charGapMs', v)}
		/>
		<Slider
			label="Word gap"
			value={settings.get('wordGapMs')}
			min={MIN_WORD_GAP_MS}
			max={MAX_WORD_GAP_MS}
			step={10}
			unit=" ms"
			hint="Silence that ends a word and types a space. Standard is 7x the dot."
			onchange={(v) => settings.setTiming('wordGapMs', v)}
		/>

		<div class="readout">
			<div>
				<span class="ro-label">Tapped at up to</span>
				<span class="ro-value">{Math.round(threshold)} ms → dot</span>
			</div>
			<div>
				<span class="ro-label">Held at least</span>
				<span class="ro-value">{Math.round(threshold)} ms → dash</span>
			</div>
		</div>

		{#if offStandard > 0.02}
			<p class="warn">
				These timings are {Math.round(offStandard * 100)}% off the standard ratios. Fine for
				practice, but other operators will struggle to read you.
			</p>
		{/if}

		<div class="presets">
			<button
				class="btn"
				type="button"
				onclick={() => {
					settings.setWpm(5);
					settings.resetGapsToStandard();
				}}
			>
				{settings.wpm <= 6 ? '● ' : ''}Beginner 5 WPM
			</button>
			<button class="btn" type="button" onclick={() => settings.setWpm(15)}>
				{settings.wpm === 15 ? '● ' : ''}Standard 15
			</button>
			<button class="btn" type="button" onclick={() => settings.setWpm(25)}>
				{settings.wpm === 25 ? '● ' : ''}Fast 25
			</button>
			<button class="btn" type="button" onclick={() => settings.resetGapsToStandard()}>
				Reset ratios
			</button>
		</div>
		<p class="hint">
			Range: 5 WPM ({SLOW.dotMs} ms dot) to 40 WPM ({FAST.dotMs} ms dot).
		</p>
	</section>

	<!-- ----------------------------------------------------------------- sound -->
	<section class="card">
		<h3 class="section-title">Sound</h3>

		<label class="toggle">
			<input
				type="checkbox"
				checked={settings.get('sidetone')}
				onchange={(e) => settings.set('sidetone', e.currentTarget.checked)}
			/>
			<span>Sidetone while keying</span>
		</label>
		<p class="hint">
			Plays for exactly as long as you hold the key, so you hear your own rhythm rather than a
			normalised one.
		</p>

		<div class="divider"></div>

		<Slider
			label="Pitch"
			value={settings.get('freqHz')}
			min={400}
			max={1200}
			step={10}
			unit=" Hz"
			onchange={(v) => settings.set('freqHz', v)}
		/>

		<div class="volume">
			<button
				class="btn mute"
				class:on={settings.get('muted')}
				type="button"
				aria-pressed={settings.get('muted')}
				onclick={() => settings.set('muted', !settings.get('muted'))}
			>
				<span aria-hidden="true">{settings.get('muted') ? '🔇' : '🔊'}</span>
				{settings.get('muted') ? 'Muted' : 'Mute'}
			</button>
			<div class="volume-slider">
				<Slider
					label="Volume"
					value={Math.round(settings.get('volume') * 100)}
					min={0}
					max={100}
					step={1}
					unit="%"
					onchange={(v) => settings.set('volume', v / 100)}
				/>
			</div>
		</div>
		<p class="hint">
			Mute keeps your volume, so unmuting puts you back where you were.
		</p>
		<!--
			The device's own answer time, read once the context exists. A phone that
			answers in tens of milliseconds cannot be made to answer sooner by
			anything in the app, and knowing the number stops that being guessed at
			from how the sidetone feels.
		-->
		{#if latency > 0}
			<p class="hint latency">
				Audio answer time: {latency}ms{latencyFloor}
			</p>
		{/if}
	</section>

	<!-- ------------------------------------------------------------------- key -->
	<section class="card">
		<h3 class="section-title">Keying</h3>

		<label class="toggle">
			<input
				type="checkbox"
				checked={settings.get('showCheatSheet')}
				onchange={(e) => settings.set('showCheatSheet', e.currentTarget.checked)}
			/>
			<span>Show the cheat sheet while keying</span>
		</label>
		<label class="toggle">
			<input
				type="checkbox"
				checked={settings.get('dimDeadEnds')}
				onchange={(e) => settings.set('dimDeadEnds', e.currentTarget.checked)}
			/>
			<span>Dim characters the current code rules out</span>
		</label>
		<label class="toggle">
			<input
				type="checkbox"
				checked={settings.get('flashOnDecode')}
				onchange={(e) => settings.set('flashOnDecode', e.currentTarget.checked)}
			/>
			<span>Flash the cheat sheet on each decode</span>
		</label>

		<fieldset class="sections">
			<legend class="section-title">Cheat sheet sections</legend>
			{#each CHEAT_SECTIONS as section (section.id)}
				<label class="toggle">
					<input
						type="checkbox"
						checked={cheatGroups.includes(section.id)}
						onchange={(e) => toggleGroup(section.id, e.currentTarget.checked)}
					/>
					<span>{section.label}</span>
				</label>
			{/each}
			<p class="hint">At least one section stays on, so there is always something to read.</p>
		</fieldset>
	</section>

	<!-- ------------------------------------------------------------------ quiz -->
	<section class="card">
		<h3 class="section-title">Quiz</h3>

		<Slider
			label="Options per question"
			value={settings.get('choices')}
			min={2}
			max={8}
			onchange={(v) => settings.set('choices', v)}
		/>
		<Slider
			label="Questions per session"
			value={settings.get('sessionLength')}
			min={0}
			max={50}
			step={5}
			onchange={(v) => settings.set('sessionLength', v)}
			hint="0 for endless. The session ends on its own above this."
		/>

		<label class="toggle">
			<input
				type="checkbox"
				checked={settings.get('autoAdvance')}
				onchange={(e) => settings.set('autoAdvance', e.currentTarget.checked)}
			/>
			<span>Advance automatically after an answer</span>
		</label>
		{#if settings.get('autoAdvance')}
			<Slider
				label="Delay before the next question"
				value={settings.get('autoAdvanceMs')}
				min={300}
				max={4000}
				step={100}
				unit=" ms"
				onchange={(v) => settings.set('autoAdvanceMs', v)}
			/>
		{/if}
	</section>

	<!-- --------------------------------------------------------------- storage -->
	<section class="card">
		<h3 class="section-title">Data</h3>
		<p class="hint">
			Settings and quiz history live in this browser's local storage only. Nothing is sent
			anywhere. Clearing site data wipes them.
		</p>
		{#if confirmReset}
			<p class="hint">Reset settings and erase all quiz history? This cannot be undone.</p>
			<div class="row">
				<button
					class="btn btn-bad"
					type="button"
					onclick={() => {
						settings.reset();
						stats.reset();
						confirmReset = false;
					}}
				>
					Erase everything
				</button>
				<button class="btn" type="button" onclick={() => (confirmReset = false)}>Cancel</button>
			</div>
		{:else}
			<button class="btn" type="button" onclick={() => (confirmReset = true)}>Reset everything</button>
		{/if}
	</section>
</div>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.sections {
		border: none;
		margin: 0.5rem 0 0;
		padding: 0.5rem 0 0;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.sections > legend {
		padding: 0;
		margin-bottom: 0.2rem;
	}

	.volume {
		display: flex;
		align-items: flex-end;
		gap: 0.6rem;
	}

	.latency {
		font-variant-numeric: tabular-nums;
	}

	.volume-slider {
		flex: 1;
		min-width: 0;
	}

	.btn.mute {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		min-height: 2.1rem;
		padding: 0 0.6rem;
		font-size: 0.85rem;
		white-space: nowrap;
	}

	.btn.mute.on {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	h3 {
		margin: 0 0 0.5rem;
	}

	.divider {
		height: 1px;
		background: var(--border);
		margin: 0.6rem 0;
	}

	.readout {
		display: flex;
		gap: 1.25rem;
		margin: 0.4rem 0 0.2rem;
		padding: 0.55rem 0.65rem;
		border-radius: 10px;
		background: var(--surface-2);
	}

	.readout > div {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.ro-label {
		font-size: 0.7rem;
		color: var(--faint);
	}

	.ro-value {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 0.85rem;
	}

	.warn {
		margin: 0.4rem 0 0;
		font-size: 0.78rem;
		color: var(--warn);
		line-height: 1.45;
	}

	.presets {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.35rem;
		margin-top: 0.5rem;
	}

	.presets .btn {
		font-size: 0.82rem;
		padding: 0 0.4rem;
	}
</style>
