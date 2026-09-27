<script lang="ts">
	import { untrack } from 'svelte';
	import Pattern from './Pattern.svelte';
	import QuizKeying from './QuizKeying.svelte';
	import { tone } from '$lib/audio';
	import { keyer } from '$lib/keyer.svelte';
	import {
		keyingTarget,
		passageTarget,
		targetChars,
		type KeyingVerdict,
		type Mark,
	} from '$lib/keying';
	import { encode, encodePhrase, GROUPS, type MorseChar, type MorseGroup } from '$lib/morse';
	import { defaultGroups, nextQuestion, type Question, type QuizKind } from '$lib/quiz';
	import { settings, type QuizMode } from '$lib/settings.svelte';
	import { stats } from '$lib/stats.svelte';
	import { timingsForWpm } from '$lib/timing';

	type Phase = 'idle' | 'asking' | 'answered';

	let phase = $state<Phase>('idle');
	let finished = $state(false);
	let question = $state<Question | null>(null);
	let answer = $state<{ picked: number; correct: boolean } | null>(null);
	let playing = $state(false);

	/** Keying practice asks the user to send this, and to send it themselves. */
	let keying = $state<{ target: string; sent: string; gapAt: number; marks: Mark[] } | null>(null);
	/**
	 * Bumped for every question. The keying view is remounted on this rather than
	 * on the target, because the same target twice in a row is ordinary: keyed
	 * by the target it would keep the previous answer's buffer and its latch, and
	 * the second question could never be marked.
	 */
	let questionId = $state(0);

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
	/** True while the user is sending the answer rather than picking one. */
	const keyingMode = $derived(mode === 'key' || mode === 'passage');
	/** A whole phrase to key in one run, rather than a single target. */
	const passageMode = $derived(mode === 'passage');
	const keyTarget = $derived(settings.get('keyTarget'));
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
		await tone.playText(q.solution, t);

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

		questionId++;

		// Compared against mode rather than the keyingMode flag so that mode
		// narrows to the two modes that build a question to pick from.
		if (keyingMode) {
			// Nothing is played: the whole point is that the answer comes from the
			// user, and hearing it first would hand it over.
			question = null;
			keyer.clear();
			keying = {
				target: passageMode
					? passageTarget({ previous: keying?.target })
					: keyingTarget({ kind: keyTarget, groups, stats: stats.raw }),
				sent: '',
				gapAt: -1,
				marks: [],
			};
			return;
		}

		keying = null;
		question = nextQuestion({ groups, mode: mode as QuizKind, choices, stats: stats.raw });
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

	/** The code for a keying target, which is only ever shown as feedback. */
	const keyPattern = $derived(keying ? encodePhrase(keying.target) : '');
	/** A passage is drawn as a phrase because it asks for word gaps of its own. */
	const keyPatternIsPhrase = $derived(passageMode || keyTarget === 'word');
	const keySent = $derived(keying ? keying.marks.filter((m) => m === 'right').length : 0);
	const keyTotal = $derived(keying ? keying.marks.length : 0);
	/** The character a gap was charged to, so the verdict can name it. */
	/**
	 * True when the only thing wrong was a pause, so the verdict can say exactly that.
	 * A wrong code settles the question on its own in the single target modes, but it can
	 * follow a wrong pause in a passage, and claiming every character was right then would
	 * be a lie.
	 */
	const onlyPausesWrong = $derived(
		keying !== null && keying.gapAt >= 0 && !keying.marks.includes('wrong'),
	);
	const gapLetter = $derived(
		keying && keying.gapAt >= 0 ? (targetChars(keying.target)[keying.gapAt]?.char ?? '') : '',
	);
	/**
	 * The sending modes wait to be told to go on. Their feedback is the whole
	 * point of the question, and it is the one thing a timed beat takes away.
	 */
	const autoAdvance = $derived(settings.get('autoAdvance') && !keyingMode);

	function answerWith(index: number) {
		if (phase !== 'asking' || !question || answer) return;
		applyAnswer(index === question.answerIndex, index, question.chars);
	}

	/** The user keyed the answer to a keying question, correctly or not. */
	function onKeyed(result: { verdict: KeyingVerdict; sent: string }) {
		if (phase !== 'asking' || !keying) return;
		keying = {
			...keying,
			sent: result.sent,
			gapAt: result.verdict.spacingAt,
			marks: result.verdict.marks,
		};
		applyAnswer(result.verdict.correct, -1, targetChars(keying.target), result.verdict.marks);
	}

	function applyAnswer(ok: boolean, picked: number, chars: MorseChar[], marks?: Mark[]) {
		answer = { picked, correct: ok };
		phase = 'answered';
		asked++;
		// Stats are per character, so a group counts once for each character it
		// is made of rather than as one entry keyed by the whole string.
		//
		// Keying a word with a word gap in the middle marks the question down, but
		// the characters either side of the gap were still sent correctly and keep
		// their point. The gap is charged to the one character it displaced, which
		// is the mark rather than a right.
		for (const [i, c] of chars.entries()) {
			stats.recordAnswer(c.char, marks ? marks[i] === 'right' : ok);
		}
		void tone.feedback(ok);

		if (ok) {
			correct++;
			streak++;
			bestStreak = Math.max(bestStreak, streak);
		} else {
			streak = 0;
		}

		if (autoAdvance) {
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
		const signature = `${groups.join(',')}|${mode}|${keyTarget}|${choices}|${sessionLength}`;
		if (untrack(() => phase) === 'idle') return;
		cancelPending();
		phase = 'idle';
		question = null;
		keying = null;
		answer = null;
		finished = false;
		// eslint-disable-next-line no-unused-vars
		void signature;
	});

	// Keyboard shortcuts for the options: 1-6.
	function onKeyDown(e: KeyboardEvent) {
		// In the sending modes every key is a dot or a dash, so the option
		// shortcuts would send the wrong thing entirely. Enter is longer than one
		// character, so the keyer leaves it alone, which makes it free to move on
		// once the answer is settled.
		if (keyingMode) {
			if (phase === 'answered' && e.key === 'Enter') {
				e.preventDefault();
				newQuestion();
			}
			return;
		}
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
				<label class="mode">
					<input
						type="radio"
						name="mode"
						value="key"
						checked={mode === 'key'}
						onchange={() => settings.set('quizMode', 'key')}
					/>
					<span>
						<strong>Key it yourself</strong>
						<em class="hint">You send it. The code is only shown afterwards.</em>
					</span>
				</label>
				<label class="mode">
					<input
						type="radio"
						name="mode"
						value="passage"
						checked={mode === 'passage'}
						onchange={() => settings.set('quizMode', 'passage')}
					/>
					<span>
						<strong>Key from text</strong>
						<em class="hint"
							>Key whole phrases, word gaps and all. A slip does not end it; every character
								is marked.</em
							>
					</span>
				</label>
			</fieldset>

			{#if mode === 'key'}
				<fieldset class="modes">
					<legend class="section-title">Send what</legend>
					<label class="mode">
						<input
							type="radio"
							name="keyTarget"
							value="char"
							checked={keyTarget === 'char'}
							onchange={() => settings.set('keyTarget', 'char')}
						/>
						<span>
							<strong>One character</strong>
							<em class="hint">From the pool below. Start here.</em>
						</span>
					</label>
					<label class="mode">
						<input
							type="radio"
							name="keyTarget"
							value="word"
							checked={keyTarget === 'word'}
							onchange={() => settings.set('keyTarget', 'word')}
						/>
						<span>
							<strong>Whole words</strong>
							<em class="hint">The real test. Groups are on the send tab.</em>
						</span>
					</label>
				</fieldset>
			{/if}

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
				{#if keyingMode}
					{keyTarget === 'char'
						? `${poolSize} characters to send`
						: 'Whole words to send'}
				{:else}
					{poolSize} characters in the pool · {choices} options per question
				{/if}
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
	{:else if question || keying}
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

		{#if !keyingMode}
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
				Replay as often as you like · keys 1–{question?.options.length} to answer
			</p>
		</div>
		{/if}

		{#if keyingMode && keying}
			{#key questionId}
				<QuizKeying
					target={keying.target}
					done={phase === 'answered'}
					grouped={passageMode}
					onresult={onKeyed}
				/>
			{/key}
		{:else if question}
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
						<span class="opt-char">
						{#each option.char.split(/\s+/) as word, w (w)}
							{#if w > 0}<span class="opt-break" title="word gap">/</span>{/if}{word}
						{/each}
					</span>
						{#if phase === 'answered'}
							<Pattern pattern={option.pattern} size="sm" phrase={mode === 'word'} />
						{/if}
					</button>
				</li>
			{/each}
		</ul>
		{/if}

		{#if phase === 'answered' && answer && (question || keying)}
			<div class="verdict" class:good={answer.correct} class:bad={!answer.correct}>
				<div class="verdict-main">
					{#if keyingMode && keying}
						{#if answer.correct}
							Sent correctly
						{:else if onlyPausesWrong}
							<!--
								Said only when the pauses were the whole of it. A passage usually
								has a wrong code as well, and then the score and the marked-up text
								say more than either fault on its own.
							-->
							<span class="muted">Every character right, but the pause before</span>
							<strong>{gapLetter}</strong>
							<span class="muted"
								>{passageMode ? 'does not fall where the text puts it' : 'was long enough to read as the end of the word'}.</span
							>
						{:else if passageMode}
							<span class="muted">You sent</span>
							<strong>{keySent} of {keyTotal}</strong>
							<span class="muted">characters right</span>
						{:else}
							<span class="muted">You sent</span>
							<strong>{keying.sent.trim() || 'nothing'}</strong>
						{/if}
						<Pattern pattern={keyPattern} size="md" phrase={keyPatternIsPhrase} />
					{:else if question}
						{#if answer.correct}
							Correct
						{:else}
							<span class="muted">It was</span><strong>{question.solution}</strong>
						{/if}
						<Pattern
							pattern={question.pattern}
							size="md"
							phrase={mode === 'word'}
						/>
					{/if}
				</div>
				{#if autoAdvance}
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
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 2rem;
		font-weight: 650;
		line-height: 1;
	}

	/* A group is written the way it is sent, with a slash for the word gap, so
	   "R R" cannot be read at a glance as a typo next to "RR". */
	.opt-break {
		font-size: 0.9rem;
		color: var(--faint);
		font-weight: 400;
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
