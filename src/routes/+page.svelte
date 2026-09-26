<script lang="ts">
	import CheatSheet from '$lib/components/CheatSheet.svelte';
	import Keyer from '$lib/components/Keyer.svelte';
	import KeyPad from '$lib/components/KeyPad.svelte';
	import Pattern from '$lib/components/Pattern.svelte';
	import Phrases from '$lib/components/Phrases.svelte';
	import Quiz from '$lib/components/Quiz.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import StatsPanel from '$lib/components/StatsPanel.svelte';
	import { tone } from '$lib/audio';
	import { keyer } from '$lib/keyer.svelte';
	import { encode, GROUPS } from '$lib/morse';
	import { settings } from '$lib/settings.svelte';
	import { stats } from '$lib/stats.svelte';

	type Tab = 'key' | 'quiz' | 'stats' | 'settings';

	let tab = $state<Tab>('key');
	let showSend = $state(false);
	let message = $state('');
	let sending = $state(false);
	/** Index into the playable characters, i.e. which one is sounding now. */
	let sentIndex = $state(-1);
	let cheatOpen = $state(settings.get('showCheatSheet'));

	const snap = $derived(keyer.snapshot);

	/**
	 * The message laid out word by word, each character with the code it will play
	 * and its position among the characters that can actually be played. Tracking
	 * the position rather than the character itself is what keeps a repeated
	 * letter, like the two S in SOS, from lighting up both at once.
	 */
	const previewWords = $derived.by(() => {
		let played = 0;
		return message
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((word, w) => ({
				key: String(w),
				chars: [...word].map((char, c) => {
					const pattern = encode(char);
					return {
						key: `${w}:${c}`,
						char,
						pattern,
						playIndex: pattern ? played++ : -1,
					};
				}),
			}));
	});
	const previewChars = $derived(previewWords.flatMap((w) => w.chars));
	const currentChar = $derived(
		sentIndex >= 0 ? (previewChars.find((e) => e.playIndex === sentIndex) ?? null) : null,
	);
	const cheatGroups = $derived(settings.get('cheatGroups'));
	const weakCount = $derived(stats.weakest().length);

	// Switch tabs with 1-4, but never while the quiz has those keys bound.
	function onKeyDown(e: KeyboardEvent) {
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
		if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
		if (tab === 'quiz' && e.key !== 'Escape') return;
		const index = Number(e.key);
		if (!Number.isInteger(index) || index < 1 || index > 4) return;
		e.preventDefault();
		tab = (['key', 'quiz', 'stats', 'settings'] as const)[index - 1];
	}

	function toggleCheat() {
		cheatOpen = !cheatOpen;
		settings.set('showCheatSheet', cheatOpen);
	}

	function openSend() {
		message = snap.output;
		showSend = true;
	}

	async function send() {
		const text = message.trim();
		if (!text) return;
		// The dialog stays open so the text stays editable and the caller can watch
		// the message go out character by character.
		sending = true;
		sentIndex = -1;
		tone.setFrequency(settings.get('freqHz'));
		tone.setVolume(settings.effectiveVolume);
		try {
			await tone.playText(text, settings.timings, undefined, (_char, i) => (sentIndex = i));
		} finally {
			sending = false;
			sentIndex = -1;
		}
	}

	function stopSend() {
		tone.stop();
		sending = false;
		sentIndex = -1;
	}

	function closeSend() {
		tone.stop();
		sending = false;
		sentIndex = -1;
		showSend = false;
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="app">
	<header>
		<h1>Morse</h1>
		<nav>
			{#each [['key', 'Key'], ['quiz', 'Quiz'], ['stats', 'Stats'], ['settings', 'Settings']] as const as [id, label] (id)}
				<button
					type="button"
					class="tab"
					class:on={tab === id}
					aria-current={tab === id ? 'page' : undefined}
					onclick={() => (tab = id)}
				>
					{label}
					{#if id === 'stats' && weakCount > 0}
						<span class="badge" title="{weakCount} characters need practice">{weakCount}</span>
					{/if}
				</button>
			{/each}
		</nav>
	</header>

	<main>
		{#if tab === 'key'}
			{#if cheatOpen}
				<section class="cheat-wrap">
					<div class="cheat-head">
						<span class="section-title">Cheat sheet</span>
						<div class="cheat-meta">
							{#if snap.buffer && settings.get('dimDeadEnds')}
								<span class="hint mono">lit = still possible from {snap.buffer}</span>
							{/if}
							<button class="link" type="button" onclick={toggleCheat}>Hide</button>
						</div>
					</div>
				<CheatSheet
					buffer={snap.buffer}
					flash={settings.get('flashOnDecode') ? keyer.flash : undefined}
					dimDeadEnds={settings.get('dimDeadEnds')}
					stats={stats.raw}
					groups={[...cheatGroups]}
				>
					{#snippet children()}
						<p class="hint">
							Procedure words and the numbers that stand in for them. Press one to hear it.
						</p>
						<Phrases />
					{/snippet}
				</CheatSheet>
				</section>
			{/if}

			{#if !cheatOpen}
				<button class="btn cheat-toggle" type="button" onclick={toggleCheat}>
					Show cheat sheet
				</button>
			{/if}
		{:else if tab === 'quiz'}
			<Quiz />
		{:else if tab === 'stats'}
			<StatsPanel />
		{:else}
			<SettingsPanel />
		{/if}
	</main>

	<!-- The console and the key live outside the scrolling pane, so what has been
	     keyed, the buttons that act on it, and the key itself are all still there
	     however far the page above them has been scrolled. -->
	{#if tab === 'key'}
		<div class="side">
			<div class="console-dock">
				<Keyer onsend={openSend} />
			</div>
			<div class="key-dock">
				<KeyPad />
			</div>
		</div>
	{/if}

	{#if showSend}
		<div class="modal-layer">
			<!-- A real button rather than a click handler on a div: it is keyboard
			     reachable and Escape still works via onKeyDown below. -->
			<button class="scrim" type="button" aria-label="Close" onclick={closeSend}
			></button>
			<div class="modal" role="dialog" aria-modal="true" aria-label="Send text as Morse" tabindex="-1">
				<h2>Send text</h2>
				<p class="hint">Played with your current pitch, volume and timing.</p>
				<textarea
					bind:value={message}
					rows="3"
					placeholder="CQ CQ DE MORSE"
					onkeydown={(e) => {
						if (e.key === 'Escape') closeSend();
						if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
					}}
				></textarea>

				{#if previewChars.length}
					<div class="preview">
						<span class="section-title">Code</span>
						<div class="preview-body">
							{#each previewWords as word (word.key)}
								<span class="preview-word">
									{#each word.chars as entry (entry.key)}
										<span
											class="preview-char"
											class:unknown={!entry.pattern}
											class:playing={sending && entry.playIndex === sentIndex}
											aria-current={sending && entry.playIndex === sentIndex
												? 'true'
												: undefined}
										>
											<span class="pc-char">{entry.char}</span>
											<Pattern pattern={entry.pattern ?? ''} size="sm" />
										</span>
									{/each}
								</span>
							{/each}
						</div>
						{#if previewChars.some((e) => !e.pattern)}
							<p class="hint warn">Some characters have no Morse code and will be skipped.</p>
						{/if}
					</div>

					<!-- The character being sent, spelled out with its code. A live
					     region so it is announced as it changes. -->
					<p class="now" class:idle={!sending} aria-live="polite">
						{#if currentChar}
							<span class="now-label">Sending</span>
							<span class="now-char">{currentChar.char}</span>
							<Pattern pattern={currentChar.pattern ?? ''} size="sm" />
						{:else if sending}
							<span class="now-label">Starting…</span>
						{:else}
							<span class="now-label">Ready</span>
						{/if}
					</p>
				{/if}

				<div class="row">
					{#if sending}
						<button class="btn" type="button" onclick={stopSend}>Stop</button>
					{:else}
						<button class="btn" type="button" onclick={closeSend}>Cancel</button>
					{/if}
					<div class="spacer"></div>
					<button class="btn" type="button" onclick={openSend}>Use decoded</button>
					<button
						class="btn btn-primary"
						type="button"
						disabled={!message.trim() || sending}
						onclick={send}
					>
						{sending ? 'Sending…' : 'Send'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* A full height column: the header and the docked key hold their space, and
	   everything between them scrolls. 100dvh rather than 100vh so the mobile
	   browser chrome coming and going does not resize the pane under the finger. */
	.app {
		max-width: 44rem;
		margin: 0 auto;
		padding: 0.75rem 0.85rem 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		height: 100dvh;
		max-height: 100dvh;
		overflow: hidden;
	}

	header {
		flex: 0 0 auto;
	}

	header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	h1 {
		margin: 0;
		font-size: 1.1rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--accent);
		font-weight: 700;
	}

	nav {
		display: flex;
		gap: 0.2rem;
		margin-left: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 999px;
		padding: 0.2rem;
	}

	.tab {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		min-height: 2.1rem;
		padding: 0 0.75rem;
		border-radius: 999px;
		font-size: 0.85rem;
		color: var(--muted);
		transition:
			background 0.12s,
			color 0.12s;
	}

	.tab.on {
		background: var(--surface-3);
		color: var(--text);
		font-weight: 600;
	}

	.badge {
		min-width: 1.15rem;
		height: 1.15rem;
		padding: 0 0.25rem;
		display: grid;
		place-items: center;
		border-radius: 999px;
		background: var(--bad);
		color: #2a0710;
		font-size: 0.65rem;
		font-weight: 700;
	}

	/* The scrolling pane. min-height:0 is what actually lets a flex child scroll
	   instead of stretching its parent. */
	main {
		flex: 1 1 auto;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		-webkit-overflow-scrolling: touch;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding-bottom: 0.5rem;
	}

	/* The console and the key, together. They travel as one block: a bottom bar
	   on a narrow screen, a full height column on a wide one. Either way they sit
	   outside the scroll flow, so the page above cannot scroll them out of reach. */
	.side {
		flex: 0 0 auto;
		display: flex;
		flex-direction: column;
	}

	.console-dock {
		flex: 0 0 auto;
		padding-top: 0.5rem;
		background: var(--bg);
		border-top: 1px solid var(--border);
	}

	.key-dock {
		flex: 0 0 auto;
		padding: 0.5rem 0 0.6rem;
		padding-bottom: max(0.6rem, env(safe-area-inset-bottom));
		background: var(--bg);
	}

	/* Wide enough for a second column. The console and the key move out of a
	   bottom bar and into a full height panel on the right, so the key gets
	   taller as the screen gets wider instead of stretching across it, and the
	   console still sits directly above the key. */
	@media (min-width: 640px) {
		.app {
			display: grid;
			/* One column of scrolling content, one tall column for the console and
			   the key. The side column spans both rows, so the key takes the whole
			   height of the window with the console sitting directly above it. */
			grid-template-columns: minmax(0, 1fr) clamp(13rem, 24vw, 19rem);
			grid-template-rows: auto minmax(0, 1fr);
			grid-template-areas:
				'header side'
				'main   side';
			padding: 0.75rem 0.85rem;
			padding-left: max(0.85rem, env(safe-area-inset-left));
			padding-right: max(0.85rem, env(safe-area-inset-right));
		}

		header {
			grid-area: header;
		}

		main {
			grid-area: main;
		}

		.side {
			grid-area: side;
			/* The column is taller than the console, so the key takes the slack
			   rather than leaving a gap under it. */
			padding-left: 0.85rem;
		}

		.console-dock {
			/* Flush against the key below it, rather than against the page. */
			padding-top: 0.6rem;
			margin-bottom: 0.5rem;
			border-top: none;
		}

		.key-dock {
			flex: 1 1 auto;
			display: grid;
			min-height: 0;
		}
	}

	.cheat-wrap {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.cheat-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.cheat-meta {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}

	.link {
		font-size: 0.78rem;
		color: var(--muted);
		text-decoration: underline;
		text-underline-offset: 2px;
		min-height: 1.6rem;
	}

	.link:hover {
		color: var(--text);
	}

	.cheat-toggle {
		width: 100%;
	}

	/* --- send modal ---------------------------------------------------------- */

	.modal-layer {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 10;
	}

	.scrim {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
	}

	.modal {
		position: relative;
		width: min(34rem, 100%);
		max-height: 85vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		padding: 1rem;
		background: var(--surface);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
	}

	.modal:focus {
		outline: none;
	}

	.modal h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.modal p {
		margin: 0;
	}

	.preview {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.6rem 0.7rem;
		border-radius: var(--radius);
		background: var(--surface-2);
	}

	.preview-body {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.75rem;
	}

	.preview-word {
		display: flex;
		gap: 0.5rem;
		align-items: flex-end;
	}

	.preview-char {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.1rem;
	}

	.preview-char.unknown {
		opacity: 0.4;
	}

	/* The character currently sounding. A filled block rather than a border, so
	   it reads at a glance next to the unhighlighted ones. */
	.preview-char.playing {
		background: var(--accent);
		border-radius: 6px;
		padding: 0.15rem 0.3rem;
		margin: -0.15rem -0.3rem;
	}

	.preview-char.playing .pc-char {
		color: var(--surface);
		font-weight: 700;
	}

	.preview-char.playing :global(.el) {
		background: var(--surface);
	}

	/* The read-out under the preview: which character is going out, and its code. */
	.now {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.6rem 0 0;
		padding: 0.4rem 0.55rem;
		border-radius: 8px;
		background: var(--accent-soft);
		border: 1px solid var(--accent);
		min-height: 2.2rem;
	}

	.now.idle {
		background: var(--surface-2);
		border-color: var(--border);
	}

	.now-label {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	.now-char {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--accent);
		min-width: 1.1rem;
		text-align: center;
	}

	.pc-char {
		font-size: 0.6rem;
		color: var(--faint);
	}

	.warn {
		color: var(--warn);
	}
</style>
