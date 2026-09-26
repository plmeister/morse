import { describe, expect, it } from 'vitest';
import {
	clamp,
	clampTimings,
	dashRatio,
	dashThreshold,
	deviationFromStandard,
	timingsForWpm,
	wpmForDot,
} from './timing';

describe('PARIS standard', () => {
	it('uses 1200/WPM ms for a dot', () => {
		expect(timingsForWpm(20).dotMs).toBe(60);
		expect(timingsForWpm(15).dotMs).toBe(80);
		expect(timingsForWpm(40).dotMs).toBe(30);
		expect(timingsForWpm(5).dotMs).toBe(240);
	});

	it('keeps the 1:3:3:7 element-to-gap ratios', () => {
		for (const wpm of [5, 8, 12, 15, 20, 25, 30, 40]) {
			const t = timingsForWpm(wpm);
			const unit = 1200 / wpm;
			expect(t.dashMs).toBe(Math.round(unit * 3));
			expect(t.charGapMs).toBe(Math.round(unit * 3));
			expect(t.wordGapMs).toBe(Math.round(unit * 7));
		}
	});

	it('round-trips through wpmForDot', () => {
		for (const wpm of [5, 8, 12, 15, 20, 25, 30, 40]) {
			expect(wpmForDot(timingsForWpm(wpm).dotMs)).toBeCloseTo(wpm, 0);
		}
	});

	it('reports zero wpm for a non-positive dot', () => {
		expect(wpmForDot(0)).toBe(0);
		expect(wpmForDot(-10)).toBe(0);
	});
});

describe('dashThreshold', () => {
	it('sits midway between dot and dash', () => {
		expect(dashThreshold({ dotMs: 60, dashMs: 180, charGapMs: 180, wordGapMs: 420 })).toBe(120);
	});

	it('adapts when the two lengths are tuned independently', () => {
		expect(dashThreshold({ dotMs: 100, dashMs: 200, charGapMs: 300, wordGapMs: 700 })).toBe(150);
		expect(dashThreshold({ dotMs: 100, dashMs: 900, charGapMs: 300, wordGapMs: 700 })).toBe(500);
	});
});

describe('dashRatio', () => {
	it('is 3 for the standard', () => {
		expect(dashRatio(timingsForWpm(20))).toBeCloseTo(3, 2);
	});

	it('is zero for a zero dot', () => {
		expect(dashRatio({ dotMs: 0, dashMs: 300, charGapMs: 300, wordGapMs: 700 })).toBe(0);
	});
});

describe('clamp', () => {
	it('bounds a value', () => {
		expect(clamp(5, 10, 20)).toBe(10);
		expect(clamp(15, 10, 20)).toBe(15);
		expect(clamp(25, 10, 20)).toBe(20);
	});

	it('rounds and bounds every timing', () => {
		const t = clampTimings({ dotMs: 1.4, dashMs: 99999, charGapMs: -5, wordGapMs: 700.6 });
		expect(t).toEqual({ dotMs: 20, dashMs: 1200, charGapMs: 40, wordGapMs: 701 });
	});
});

describe('deviationFromStandard', () => {
	it('is zero for the standard', () => {
		expect(deviationFromStandard(timingsForWpm(15))).toBe(0);
	});

	it('grows as the gaps drift', () => {
		const t = timingsForWpm(15);
		expect(deviationFromStandard({ ...t, wordGapMs: t.wordGapMs * 2 })).toBeCloseTo(1, 5);
	});
});
