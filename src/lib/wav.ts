/**
 * Exporting a send as a WAV file.
 *
 * Nothing here records. The envelope that plays through the sidetone is already
 * a pure function of the text and the timings, so an `OfflineAudioContext` can
 * render the identical envelope into a buffer in a fraction of the time it
 * takes to play, and that buffer goes straight into a file. No microphone, no
 * realtime capture, and none of the latency a live recording would add.
 */

import { envelopeEnd, playEnvelope, unitsForText, type PlayUnit } from './audio';
import type { Timings } from './timing';

/**
 * Sample rate for exported files.
 *
 * The pitch tops out at 1200Hz, so anything above 2400Hz carries the tone
 * without loss and the rate is really a question of what plays nicely. 8kHz
 * would be small enough to matter not at all, but messengers that meet an 8kHz
 * attachment often decide it is a telephone recording and re-encode it to
 * something worse. 16kHz is an ordinary rate, still more than five times the
 * highest pitch, and a five second send is about 160KB.
 */
export const WAV_SAMPLE_RATE = 16000;

/** Silence before the first code, matching the lead in live playback uses. */
const LEAD_IN_S = 0.06;
/** Silence after the last code, so the release is not clipped by the file. */
const TAIL_S = 0.12;

const HEADER_BYTES = 44;
const CHANNELS = 1;
const BITS = 16;

/** Length of the rendered file in samples, for a run of codes. */
export function wavFrameCount(
	units: PlayUnit[],
	t: Timings,
	sampleRate = WAV_SAMPLE_RATE,
): number {
	if (!units.length) return 0;
	return Math.ceil((LEAD_IN_S + envelopeEnd(units, t) + TAIL_S) * sampleRate);
}

/**
 * Pack mono float samples into a canonical 44 byte RIFF/WAVE file.
 *
 * The header is the only fiddly part of the format and it is fixed: 16 bit PCM
 * has no extra chunks to negotiate, so every player and every messenger takes
 * the result without asking.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
	const blockAlign = (CHANNELS * BITS) / 8;
	const dataBytes = samples.length * blockAlign;
	const bytes = new Uint8Array(HEADER_BYTES + dataBytes);
	const view = new DataView(bytes.buffer);

	const text = (at: number, value: string) => {
		for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
	};

	text(0, 'RIFF');
	view.setUint32(4, 36 + dataBytes, true);
	text(8, 'WAVE');
	text(12, 'fmt ');
	view.setUint32(16, 16, true); // PCM header size
	view.setUint16(20, 1, true); // format 1 is uncompressed PCM
	view.setUint16(22, CHANNELS, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, BITS, true);
	text(36, 'data');
	view.setUint32(40, dataBytes, true);

	// Samples outside -1..1 are not a thing a player can represent, and a
	// rendered envelope that overshoots is a bug worth hearing as the loudest
	// possible thing rather than as a wrap around into noise.
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(HEADER_BYTES + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}

	return bytes;
}

/**
 * Render text as Morse into a WAV file, at the pitch, volume and timing asked
 * for. Resolves to null when there is nothing playable to send or the browser
 * has no offline audio.
 */
export async function renderMorseWav(
	text: string,
	t: Timings,
	volume: number,
	freqHz: number,
): Promise<Blob | null> {
	const units = unitsForText(text, t);
	const frames = wavFrameCount(units, t);
	if (!frames) return null;

	const Ctor = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
		.OfflineAudioContext;
	if (!Ctor) return null;

	const ctx = new Ctor(CHANNELS, frames, WAV_SAMPLE_RATE);
	const osc = ctx.createOscillator();
	osc.type = 'sine';
	osc.frequency.value = freqHz;
	const gain = ctx.createGain();
	osc.connect(gain).connect(ctx.destination);

	// A fresh GainNode sits at its intrinsic value of one and the oscillator
	// runs from the very first sample, so the lead in would be 60ms of full
	// level tone for the first code to land on top of, turning every message
	// that opens on a dot into one that opens on a dash. Live playback silences
	// its gain before it schedules anything; an export has to do the same.
	gain.gain.setValueAtTime(0, 0);

	// The same ramps live playback makes, applied to a clock that starts at zero
	// instead of at whatever the speaker is currently doing.
	for (const seg of playEnvelope(units, t, volume, LEAD_IN_S)) {
		gain.gain.cancelScheduledValues(seg.at);
		gain.gain.setValueAtTime(seg.from, seg.at);
		gain.gain.linearRampToValueAtTime(seg.to, seg.at + seg.seconds);
	}
	osc.start(0);

	const rendered = await ctx.startRendering();
	const blob = new Blob([encodeWav(rendered.getChannelData(0), WAV_SAMPLE_RATE)], {
		type: 'audio/wav',
	});
	return blob;
}
