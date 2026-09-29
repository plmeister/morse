import { afterEach, describe, expect, it } from 'vitest';
import { envelopeEnd, playEnvelope, unitsForText } from './audio';
import { encodeWav, renderMorseWav, WAV_SAMPLE_RATE, wavFrameCount } from './wav';
import { timingsForWpm } from './timing';

const t = timingsForWpm(15);

type Ramp = { from: number; to: number; at: number; end: number };

/** A stand-in for OfflineAudioContext that records what it was asked to do. */
function install() {
	const made: Array<{
		channels: number;
		frames: number;
		rate: number;
		freq: number;
		ramps: Ramp[];
	}> = [];
	let buffer: Float32Array = new Float32Array(0);

	const params: Ramp[] = [];
	const param = {
		from: 0,
		to: 0,
		at: 0,
		end: 0,
	};

	class Fake {
		started = false;
		constructor(
			public channels: number,
			public frames: number,
			public rate: number,
		) {}
		destination = this;
		createOscillator() {
			const self = this;
			const frequency = { value: 0 };
			return {
				type: '',
				frequency,
				connect: () => this.createGain(),
				start: () => {
					self.started = true;
					made.push({
						channels: self.channels,
						frames: self.frames,
						rate: self.rate,
						freq: frequency.value,
						ramps: params.map((p) => ({ ...p })),
					});
				},
			};
		}
		createGain() {
			return {
				gain: {
					cancelScheduledValues: () => {},
					setValueAtTime: (value: number, at: number) => {
						param.from = value;
						param.at = at;
					},
					linearRampToValueAtTime: (value: number, at: number) => {
						param.to = value;
						param.end = at;
						params.push({ ...param });
					},
				},
				connect: () => this,
			};
		}
		async startRendering() {
			return { getChannelData: () => buffer };
		}
	}

	(globalThis as Record<string, unknown>).OfflineAudioContext = Fake;

	return {
		made,
		setBuffer: (samples: Float32Array) => (buffer = samples),
		restore: () => {
			delete (globalThis as Record<string, unknown>).OfflineAudioContext;
		},
	};
}

afterEach(() => {
	delete (globalThis as Record<string, unknown>).OfflineAudioContext;
});

describe('wavFrameCount', () => {
	it('is nothing for a send with no playable characters', () => {
		expect(wavFrameCount(unitsForText('\u00a3', t), t)).toBe(0);
	});

	it('covers the run and the silence either side of it', () => {
		const units = unitsForText('e', t);
		const frames = wavFrameCount(units, t);
		// The lead in and tail are 180ms. The rest has to be the whole run, or
		// the last release is cut off by the end of the file. A frame of slack
		// because the arithmetic lands on a whole sample either side of it.
		const need = (0.06 + 0.12 + envelopeEnd(units, t)) * WAV_SAMPLE_RATE;
		expect(frames).toBeGreaterThanOrEqual(need - 1);
		expect(frames).toBeLessThanOrEqual(need + 1);
	});

	it('length tracks the envelope, so the padding never scales with the text', () => {
		const one = unitsForText('e', t);
		const ten = unitsForText('eeeeeeeeee', t);
		const frames = (units: ReturnType<typeof unitsForText>) => wavFrameCount(units, t);
		// Both files carry the same 180ms of padding, so the difference between
		// their lengths is the difference between their runs and nothing else.
		expect(frames(ten) - frames(one)).toBeCloseTo(
			(envelopeEnd(ten, t) - envelopeEnd(one, t)) * WAV_SAMPLE_RATE,
			-2,
		);
	});

	it('is a whole number of samples, since a buffer cannot be fractional', () => {
		for (const text of ['e', 'cq cq de morse', 'sos']) {
			expect(Number.isInteger(wavFrameCount(unitsForText(text, t), t))).toBe(true);
		}
	});
});

describe('encodeWav', () => {
	it('writes a canonical RIFF/WAVE header', () => {
		const bytes = encodeWav(new Float32Array(100), WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer);
		const text = (at: number, len: number) => String.fromCharCode(...bytes.slice(at, at + len));

		expect(text(0, 4)).toBe('RIFF');
		expect(text(8, 4)).toBe('WAVE');
		expect(text(12, 4)).toBe('fmt ');
		expect(text(36, 4)).toBe('data');
		expect(view.getUint32(16, true)).toBe(16);
		expect(view.getUint16(20, true)).toBe(1); // uncompressed PCM
		expect(view.getUint16(22, true)).toBe(1); // mono
		expect(view.getUint32(24, true)).toBe(WAV_SAMPLE_RATE);
		expect(view.getUint16(34, true)).toBe(16);
	});

	it('agrees with itself about the sizes in the header', () => {
		const samples = new Float32Array(1234);
		const bytes = encodeWav(samples, WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer);

		expect(view.getUint32(40, true)).toBe(samples.length * 2);
		expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
		expect(view.getUint32(28, true)).toBe(WAV_SAMPLE_RATE * 2);
		expect(view.getUint16(32, true)).toBe(2);
		expect(bytes.length).toBe(44 + samples.length * 2);
	});

	it('scales samples into signed 16 bit', () => {
		const bytes = encodeWav(new Float32Array([0, 1, -1, 0.5, -0.5]), WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer);
		const at = (i: number) => view.getInt16(44 + i * 2, true);

		expect(at(0)).toBe(0);
		expect(at(1)).toBe(32767);
		expect(at(2)).toBe(-32768);
		expect(at(3)).toBeGreaterThan(16000);
		expect(at(3)).toBeLessThan(17000);
		expect(at(4)).toBeLessThan(-16000);
		expect(at(4)).toBeGreaterThan(-17000);
	});

	it('clamps rather than wrapping, so an overshoot is loud and not noise', () => {
		const bytes = encodeWav(new Float32Array([2, -2]), WAV_SAMPLE_RATE);
		const view = new DataView(bytes.buffer);
		expect(view.getInt16(44, true)).toBe(32767);
		expect(view.getInt16(46, true)).toBe(-32768);
	});

	it('copes with no samples at all', () => {
		expect(encodeWav(new Float32Array(0), WAV_SAMPLE_RATE).length).toBe(44);
	});
});

describe('renderMorseWav', () => {
	it('renders mono at the export sample rate, long enough for the run', async () => {
		const audio = install();
		audio.setBuffer(new Float32Array(wavFrameCount(unitsForText('sos', t), t)));

		const blob = await renderMorseWav('sos', t, 1, 700);
		expect(blob).toBeInstanceOf(Blob);
		expect(audio.made).toHaveLength(1);
		expect(audio.made[0].channels).toBe(1);
		expect(audio.made[0].rate).toBe(WAV_SAMPLE_RATE);
		expect(audio.made[0].frames).toBe(wavFrameCount(unitsForText('sos', t), t));
	});

	it('sends the tone the user asked for', async () => {
		const audio = install();
		audio.setBuffer(new Float32Array(10));
		await renderMorseWav('e', t, 0.8, 900);
		expect(audio.made[0].freq).toBe(900);
	});

	it('applies the same envelope live playback would', async () => {
		const audio = install();
		audio.setBuffer(new Float32Array(10));
		await renderMorseWav('sos', t, 0.8, 700);

		const expected = playEnvelope(unitsForText('sos', t), t, 0.8, 0.06);
		expect(audio.made[0].ramps).toHaveLength(expected.length);
		for (const [i, seg] of expected.entries()) {
			expect(audio.made[0].ramps[i].from).toBeCloseTo(seg.from);
			expect(audio.made[0].ramps[i].to).toBeCloseTo(seg.to);
			expect(audio.made[0].ramps[i].at).toBeCloseTo(seg.at);
			expect(audio.made[0].ramps[i].end).toBeCloseTo(seg.at + seg.seconds);
		}
	});

	it('carries the samples through into the file', async () => {
		const audio = install();
		audio.setBuffer(new Float32Array([0, 1, -1]));
		const blob = await renderMorseWav('e', t, 1, 700);
		expect(new Uint8Array(await blob!.arrayBuffer()).length).toBe(44 + 6);
	});

	it('sends nothing rather than an empty file when there is no code to play', async () => {
		install();
		expect(await renderMorseWav('\u00a3\u00a3', t, 1, 700)).toBeNull();
	});

	it('sends nothing when the browser has no offline audio', async () => {
		expect(await renderMorseWav('e', t, 1, 700)).toBeNull();
	});
});
