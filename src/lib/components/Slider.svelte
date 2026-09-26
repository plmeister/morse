<script lang="ts">
	type Props = {
		label: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		unit?: string;
		disabled?: boolean;
		hint?: string;
		onchange: (value: number) => void;
	};

	let {
		label,
		value,
		min,
		max,
		step = 1,
		unit = '',
		disabled = false,
		hint,
		onchange,
	}: Props = $props();

	// Local mirror so dragging stays smooth: the store is only told once the
	// drag ends, not on every input event.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);

	// Adopt a change that came from outside the slider (a reset button, a preset,
	// another control writing the same setting) without fighting the drag in
	// progress. Tracking the last value we saw is what makes the difference:
	// reading `draft` here would re-run the effect on our own input and snap the
	// thumb straight back to where it started, which made every slider inert.
	//
	// `seen` is a plain variable on purpose. It is a baseline to compare against,
	// not state: making it reactive would put it back in the effect's dependency
	// list and reintroduce the very loop being avoided here.
	// svelte-ignore state_referenced_locally
	let seen = value;
	$effect(() => {
		if (value !== seen) {
			seen = value;
			draft = value;
		}
	});

	const display = $derived(`${Math.round(draft)}${unit}`);
</script>

<div class="field">
	<label for="slider-{label}">
		<span>{label}</span>
		<span class="value">{display}</span>
	</label>
	<input
		id="slider-{label}"
		type="range"
		min={min}
		max={max}
		step={step}
		value={draft}
		{disabled}
		oninput={(e) => {
			draft = Number(e.currentTarget.value);
		}}
		onchange={(e) => onchange(Number(e.currentTarget.value))}
	/>
	{#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
	input[type='range']:disabled {
		opacity: 0.4;
	}

	.hint {
		margin: 0 0 0.15rem;
	}
</style>
