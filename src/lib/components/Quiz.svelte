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
	import { encode, encodeText, GROUPS, type MorseChar, type MorseGroup } from '$lib/morse';
	import { defaultGroups, nextQuestion, optionForKey, type Question, type QuizKind } from '$lib/quiz';
	import { isTypingTarget } from '$lib/key-typing';
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
	let keying = $state<{
		target: string;
		sent: string;
		gapAt: number;
		marks: Mark[];
		/** What the keyer decoded for each character, to pair with the marks. */
		actual: string[];
	} | null>(null);
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
				actual: [],
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
	 * The answer key for a keyed question: every character of the target with its
	 * own code, marked, and what the keyer decoded in its place where the two
	 * differ.
	 *
	 * A row of dots and dashes on its own is a code the user has to read back to
	 * find the slip in, which is the one thing feedback should not ask of them.
	 * Putting the letter above its own code makes the pair the unit, the way an
	 * option row already does, so a marked box names itself. The decoded
	 * character goes under the box it came from rather than in a line of its own,
	 * because in a passage the same letters appear twice over and a sentence of
	 * what was sent cannot say which was which.
	 */
	const keyAnswer = $derived.by(() => {
		if (!keying) return [];
		type Cell = { gap: true } | { gap: false; char: string; code: string; mark: Mark; sent: string };
		const cells: Cell[] = [];
		let at = 0;
		for (const group of encodeText(keying.target)) {
			// A word the target asked for, drawn between the words rather than
			// charged to a character, since the marks do not cover it.
			if (cells.length > 0) cells.push({ gap: true });
			for (const c of group.chars) {
				cells.push({
					gap: false,
					char: c.char,
					code: c.pattern,
					mark: keying.marks[at] ?? 'pending',
					sent: keying.actual[at] ?? '',
				});
				at++;
			}
		}
		return cells;
	});
	/**
	 * Whether the answered question goes on by itself, which is what decides
	 * between a beat and a button.
	 *
	 * The receiving modes follow the setting. The sending modes follow whether
	 * there is anything to read: a clean run has no slip to find and no code to
	 * look up, so making the user tap Next for it is asking them to acknowledge
	 * nothing. A run with a mistake in it stops and waits, because the answer
	 * key under the verdict is the one thing a timed beat would take away, and a
	 * button the user has to find is what makes them look.
	 */
	const autoAdvance = $derived(
		keyingMode ? answer?.correct === true : settings.get('autoAdvance'),
	);

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
			actual: result.verdict.actual,
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

	// Keyboard shortcuts for the options: 1-6, or the character that was sent.
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
		if (isTypingTarget(e.target)) return;
		const n = Number(e.key);
		if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
			e.preventDefault();
			answerWith(n - 1);
			return;
		}
		// A letter picks the option carrying it, which is the key a user who has
		// just read the code in their head reaches for. Held modifiers are left
		// alone: Ctrl+R and Cmd+R belong to the browser, not to the quiz.
		if (!e.ctrlKey && !e.metaKey && !e.altKey) {
			const index = optionForKey(question.options, e.key);
			if (index !== undefined) {
				e.preventDefault();
				answerWith(index);
				return;
			}
		}
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			replay();
		}
	}
</script>

<svelte:window onkeydown={onKeyDown} onbeforeunload={cancelPending} />

<div class="quiz">
	{#if phase === 'idle'}
		<div class="card intro">
			<h2>Practice</h2>
			<p class="muted">
				Morse is sent and you pick what you heard, or you send it yourself. Characters you
				keep missing come back more often, so the session drifts towards whatever you are
				worst at.
			</p>

			<!-- Two kinds of session, and they are not the same test. One asks what
			     you can read, the other what you can send, and only the first has an
			     options row, an answer key read backwards or a replay button. Listing
			     all four as one set of modes called "Send" said they were variations
			     of the same thing. -->
			<fieldset class="modes">
				<legend class="section-title">Hear it</legend>
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

			<fieldset class="modes">
				<legend class="section-title">Send it</legend>
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

			<!-- A follow-up to the sending mode above it rather than a mode of its
			     own, so it sits under it instead of holding a place in the list. -->
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
				{#if passageMode}
					Whole phrases to send
				{:else if keyingMode}
					{keyTarget === 'char' ? `${poolSize} characters to send` : 'Whole words to send'}
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
				Replay as often as you like · keys 1–{question?.options.length}, or the character
				itself, to answer
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
					{:else if question}
						{#if answer.correct}
							Correct
						{:else}
							<span class="muted">It was</span><strong>{question.solution}</strong>
						{/if}
						<Pattern pattern={question.pattern} size="md" phrase={mode === 'word'} />
					{/if}
				</div>
				{#if keyingMode && keying}
					<!--
						The answer key. A row of dots and dashes is a code the user has to
						read back to find the slip in, which is the one thing feedback should
						not ask of them, so every character is drawn over its own code and a
						slipped one says what the keyer decoded in its place.
					-->
					<ul class="keyed">
						{#each keyAnswer as cell, i (i)}
							{#if cell.gap}
								<li class="keyed-gap" aria-hidden="true">/</li>
							{:else}
								<li class="keyed-cell" class:wrong={cell.mark === 'wrong'} class:gap={cell.mark === 'gap'}>
									<span class="keyed-char">{cell.char}</span>
									<Pattern pattern={cell.code} size="sm" />
									{#if cell.mark === 'wrong' && cell.sent && cell.sent !== cell.char}
										<span class="keyed-sent"><span class="muted">sent</span> {cell.sent}</span>
									{/if}
								</li>
							{/if}
						{/each}
					</ul>
				{/if}
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

	/* The answer key: one column per character, the letter over its own code, so
	   the pair is the unit and a marked column names the slip itself.

	   Flex wrap rather than a grid, since a passage is any length and the columns
	   only need to line up from the left. Capped in height and scrolled inside
	   rather than left to grow: the longest passage is over fifty columns and a
	   phone has room for about four rows of them, and a key tall enough to want a
	   scroll of its own is a key that pushes the Next button off the screen. */
	.keyed {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: flex-start;
		gap: 0.2rem 0.15rem;
		list-style: none;
		margin: 0.2rem 0 0;
		padding: 0;
		width: 100%;
		max-width: 34rem;
		/* Capped against the viewport as well as in absolute terms. A fixed cap
		   that suits a tall phone puts the Next button below the bottom of a small
		   one on a long passage, and the page does not scroll to rescue it, which
		   leaves no way on at all. A fifth of the screen is three rows on the
		   smallest phone the layout has to survive and five on a tall one. */
		max-height: min(11rem, 20vh);
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.keyed-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.05rem;
		padding: 0.1rem 0.15rem 0.2rem;
		border-radius: 0.3rem;
		border: 1px solid transparent;
	}

	.keyed-char {
		font-size: 1.05rem;
		font-weight: 650;
		line-height: 1.1;
	}

	/* A character sent with the wrong code, and one that kept its point but lost
	   it to a pause in front, are different faults and are told apart by colour
	   rather than by another line of text. */
	.keyed-cell.wrong {
		border-color: var(--bad);
		background: var(--bad-soft);
	}

	.keyed-cell.wrong .keyed-char {
		color: var(--bad);
	}

	.keyed-cell.gap {
		border-color: var(--warn);
		background: var(--surface);
	}

	.keyed-cell.gap .keyed-char {
		color: var(--warn);
	}

	.keyed-sent {
		font-size: 0.65rem;
		line-height: 1.2;
		color: var(--bad);
		white-space: nowrap;
	}

	/* A word gap the target asked for, drawn between the words. The one that was
	   not asked for is a fault on a character, which is where it is shown. */
	.keyed-gap {
		font-size: 0.9rem;
		color: var(--faint);
		padding-top: 0.2rem;
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
