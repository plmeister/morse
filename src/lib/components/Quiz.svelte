<script lang="ts">
	import { untrack } from 'svelte';
	import Pattern from './Pattern.svelte';
	import { tone } from '$lib/audio';
	import { encode, GROUPS, type MorseGroup } from '$lib/morse';
	import { defaultGroups, nextQuestion, type Question } from '$lib/quiz';
	import { settings, type QuizMode } from '$lib/settings.svelte';
	import { stats } from '$lib/stats.svelte';
	import { timingsForWpm } from '$lib/timing';

	type Phase = 'idle' | 'asking' | 'answered';

	let phase = $state<Phase>('idle');
	let finished = $state(false);
	let question = $state<Question | null>(null);
	let answer = $state<{ picked: number; correct: boolean } | null>(null);
	let playing = $state(false);

	// Session counters.
	let asked = $state(0);
	let correct = $state(0);
	let streak = $state(0);
	let bestStreak = $state(0);

	/** Bumped on every play and cancel so a stale playback can bail out. */
	let playToken = 0;
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;

	const groups = $derived<MorseGroup[]>(
		defaultGroups(settings.get('includeDigits'), settings.get('includePunct')),
	);
	const mode = $derived<QuizMode>(settings.get('quizMode'));
	const choices = $derived(settings.get('choices'));
	const sessionLength = $derived(settings.get('sessionLength'));
	const poolSize = $derived(groups.reduce((n, g) => n + GROUPS[g].length, 0));
	const progress = $derived(sessionLength > 0 ? Math.min(1, asked / sessionLength) : 0);
	const accuracy = $derived(asked === 0 ? 0 : correct / asked);

	function cancelPending() {
		clearTimeout(advanceTimer);
		advanceTimer = undefined;
		tone.stop();
		playToken++;
		playing = false;
	}

	async function playQuestion(q: Question, slow = false) {
		cancelPending();
		const token = ++playToken;
		playing = true;

		tone.setFrequency(settings.get('freqHz'));
		tone.setVolume(settings.effectiveVolume);
		// Slower replay re-derives the timings from the current WPM rather than
		// reusing the tuned gaps, so it always sounds like standard Morse.
		const t = slow ? timingsForWpm(Math.max(5, settings.wpm - 8)) : settings.timings;
		await tone.playSequence(q.chars, t);

		// A replay or a new question replaced this one mid-transmission.
		if (token !== playToken) return;
		playing = false;
	}

	function newQuestion() {
		cancelPending();
		answer = null;

		if (sessionLength > 0 && asked >= sessionLength) {
			finished = true;
			stats.recordSession(correct, asked);
			return;
		}

		phase = 'asking';
		question = nextQuestion({ groups, mode, choices, stats: stats.raw });
		void playQuestion(question);
	}

	function start() {
		cancelPending();
		asked = 0;
		correct = 0;
		streak = 0;
		bestStreak = 0;
		finished = false;
		newQuestion();
	}

	/** Guards the nullable question so the template can call this freely. */
	function replay(slow = false) {
		if (!question) return;
		void playQuestion(question, slow);
	}

	function answerWith(index: number) {
		if (phase !== 'asking' || !question || answer) return;
		applyAnswer(index === question.answerIndex, index);
	}

	function applyAnswer(ok: boolean, picked: number) {
		if (!question) return;
		answer = { picked, correct: ok };
		phase = 'answered';
		asked++;
		stats.recordAnswer(question.solution, ok);
		void tone.feedback(ok);

		if (ok) {
			correct++;
			streak++;
			bestStreak = Math.max(bestStreak, streak);
		} else {
			streak = 0;
		}

		if (settings.get('autoAdvance')) {
			// Longer beat on a miss so the correct answer can actually be read.
			advanceTimer = setTimeout(
				() => newQuestion(),
				settings.get('autoAdvanceMs') + (ok ? 0 : 1100),
			);
		}
	}

	// Changing the pool or the option count mid-run would make the score
	// meaningless, so drop back to the setup screen.
	$effect(() => {
		const signature = `${groups.join(',')}|${mode}|${choices}|${sessionLength}`;
		if (untrack(() => phase) === 'idle') return;
		cancelPending();
		phase = 'idle';
		question = null;
		answer = null;
		finished = false;
		// eslint-disable-next-line no-unused-vars
		void signature;
	});

	// Keyboard shortcuts for the options: 1-6.
	function onKeyDown(e: KeyboardEvent) {
		if (phase !== 'asking' || !question || answer) return;
		const target = e.target as HTMLElement | null;
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
		const n = Number(e.key);
		if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
			e.preventDefault();
			answerWith(n - 1);
		} else if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			replay();
		}
	}
</script>

<svelte:window onkeydown={onKeyDown} onbeforeunload={cancelPending} />

<div class="quiz">
	{#if phase === 'idle'}
		<div class="card intro">
			<h2>Receive practice</h2>
			<p class="muted">
				Morse is sent, you pick what you heard. Characters you keep missing come back more
				often, so the session drifts towards whatever you are worst at.
			</p>

			<fieldset class="modes">
				<legend class="section-title">Send</legend>
				<label class="mode">
					<input
						type="radio"
						name="mode"
						value="char"
						checked={mode === 'char'}
						onchange={() => settings.set('quizMode', 'char')}
					/>
					<span>
						<strong>Single characters</strong>
						<em class="hint">One code at a time. Start here.</em>
					</span>
				</label>
				<label class="mode">
					<input
						type="radio"
						name="mode"
						value="word"
						checked={mode === 'word'}
						onchange={() => settings.set('quizMode', 'word')}
					/>
					<span>
						<strong>Words and groups</strong>
						<em class="hint">Watch the spaces between words.</em>
					</span>
				</label>
			</fieldset>

			<div class="pool">
				<label class="toggle">
					<input
						type="checkbox"
						checked={settings.get('includeDigits')}
						onchange={(e) => settings.set('includeDigits', e.currentTarget.checked)}
					/>
					<span>Digits</span>
				</label>
				<label class="toggle">
					<input
						type="checkbox"
						checked={settings.get('includePunct')}
						onchange={(e) => settings.set('includePunct', e.currentTarget.checked)}
					/>
					<span>Punctuation</span>
				</label>
			</div>

			<p class="hint">
				{poolSize} characters in the pool · {choices} options per question
				{#if sessionLength > 0}· {sessionLength} questions{:else}· endless{/if}
			</p>

			<button class="btn btn-primary btn-lg start" type="button" onclick={start}>Start</button>
		</div>
	{:else if finished}
		<div class="card intro">
			<h2>Session complete</h2>
			<div class="score-big">
				<div>
					<strong>{correct}</strong>
					<span class="muted">/ {asked}</span>
				</div>
				<span class="pct" class:good={accuracy >= 0.8} class:bad={accuracy < 0.6}>
					{Math.round(accuracy * 100)}%
				</span>
			</div>
			<p class="muted">Best streak: {bestStreak}</p>
			<button class="btn btn-primary btn-lg start" type="button" onclick={start}>Again</button>
		</div>
	{:else if question}
		<div class="hud">
			<div class="hud-stats">
				<span><strong>{correct}</strong><span class="faint">/{asked}</span></span>
				<span class="faint">{Math.round(accuracy * 100)}%</span>
				{#if streak > 1}<span class="hud-streak" title="Current streak">{streak}&times;</span>{/if}
			</div>
			{#if sessionLength > 0}
				<div class="bar" role="progressbar" aria-valuenow={asked} aria-valuemax={sessionLength}>
					<div class="bar-fill" style:width="{progress * 100}%"></div>
				</div>
			{/if}
		</div>

		<div class="card transmit">
			<div class="transmit-row">
				<button
					class="btn btn-primary"
					type="button"
					disabled={playing}
					onclick={() => replay(true)}
				>
					Slower
				</button>
				<button
					class="btn"
					type="button"
					disabled={playing}
					onclick={() => replay()}
				>
					{playing ? 'Playing…' : 'Replay'}
				</button>
			</div>
			<p class="hint">
				{mode === 'word' ? 'A whole group, spaces included.' : 'One character.'}
				Replay as often as you like · keys 1–{question.options.length} to answer
			</p>
		</div>

		<ul class="options">
			{#each question.options as option, i (option.char)}
				{@const isPicked = answer?.picked === i}
				{@const isAnswer = i === question.answerIndex}
				<li>
					<button
						type="button"
						class="option"
						class:correct={phase === 'answered' && isAnswer}
						class:wrong={phase === 'answered' && isPicked && !isAnswer}
						class:faded={phase === 'answered' && !isAnswer && !isPicked}
						disabled={phase === 'answered'}
						onclick={() => answerWith(i)}
					>
						<span class="opt-key faint">{i + 1}</span>
						<span class="opt-char">{option.char}</span>
						{#if phase === 'answered'}
							<Pattern pattern={option.pattern} size="sm" />
						{/if}
					</button>
				</li>
			{/each}
		</ul>

		{#if phase === 'answered' && answer && question}
			<div class="verdict" class:good={answer.correct} class:bad={!answer.correct}>
				<div class="verdict-main">
					{#if answer.correct}
						Correct
					{:else}
						<span class="muted">It was</span><strong>{question.solution}</strong>
					{/if}
					<Pattern pattern={encode(question.solution) ?? ''} size="md" />
				</div>
				{#if settings.get('autoAdvance')}
					<p class="hint">Next question shortly…</p>
				{:else}
					<button class="btn btn-primary" type="button" onclick={newQuestion}>Next</button>
				{/if}
			</div>
		{/if}

		<div class="quiz-foot">
			<button
				class="btn"
				type="button"
				onclick={() => {
					cancelPending();
					phase = 'idle';
				}}
			>
				End session
			</button>
		</div>
	{/if}
</div>

<style>
	.quiz {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.intro {
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	.intro h2 {
		margin: 0;
		font-size: 1.2rem;
	}

	.intro p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
	}

	.modes {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.6rem 0.75rem 0.7rem;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.modes legend {
		padding: 0 0.3rem;
	}

	.mode {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.35rem 0;
		cursor: pointer;
	}

	.mode input {
		margin-top: 0.2rem;
		flex: none;
	}

	.mode span {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.mode em {
		font-style: normal;
	}

	.pool {
		display: flex;
		gap: 1.2rem;
		flex-wrap: wrap;
	}

	.start {
		width: 100%;
	}

	.hud {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.hud-stats {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		font-size: 1rem;
	}

	.hud-streak {
		color: var(--good);
		font-weight: 650;
	}

	.bar {
		flex: 1;
		height: 5px;
		border-radius: 3px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.25s;
	}

	.transmit {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.transmit-row {
		display: flex;
		gap: 0.4rem;
	}

	.transmit-row .btn {
		flex: 1;
	}

	.transmit p {
		margin: 0;
	}

	.options {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 0.5rem;
	}

	.option {
		position: relative;
		width: 100%;
		min-height: 4.75rem;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		border-radius: var(--radius);
		border: 2px solid var(--border-strong);
		background: var(--surface-2);
		transition:
			background 0.12s,
			border-color 0.12s,
			transform 0.06s;
	}

	.option:active:not(:disabled) {
		transform: scale(0.98);
	}

	.opt-key {
		position: absolute;
		top: 4px;
		left: 7px;
		font-size: 0.65rem;
		font-weight: 650;
	}

	.opt-char {
		font-size: 2rem;
		font-weight: 650;
		line-height: 1;
	}

	.option.correct {
		border-color: var(--good);
		background: var(--good-soft);
	}

	.option.wrong {
		border-color: var(--bad);
		background: var(--bad-soft);
	}

	.option.faded {
		opacity: 0.4;
	}

	.verdict {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 0.7rem;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background: var(--surface);
	}

	.verdict.good {
		border-color: var(--good);
	}

	.verdict.bad {
		border-color: var(--bad);
	}

	.verdict-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1.05rem;
	}

	.verdict-main strong {
		font-size: 1.3rem;
		color: var(--accent);
	}

	.verdict p {
		margin: 0;
	}

	.quiz-foot {
		display: flex;
		justify-content: center;
	}

	.score-big {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.score-big strong {
		font-size: 2.2rem;
		line-height: 1;
	}

	.pct {
		font-size: 1.2rem;
		font-weight: 650;
	}

	.pct.good {
		color: var(--good);
	}

	.pct.bad {
		color: var(--bad);
	}
</style>
