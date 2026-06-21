/**
 * PROMPT F.5 / F.6 — briefing + progress math (pure).
 * Deltas compute correctly; deltas are confidence-gated; PB + baseline math.
 */
import {
  sinceLastUpload,
  computeDelta,
  primaryFlaw,
  trendSeries,
  personalBestIndex,
  deltaVsBaseline,
  nextCheckpoint,
  recommendedRetestCapture,
  flawIdToMetric,
  DELTA_CONFIDENCE_THRESHOLD,
} from '../lib/briefing';
import { uploadOne, uploadTwo, historyFixture } from '../fixtures/history';
import type { Metric } from '../types/analysis';

const m = (key: string, value: number, conf: number, normalRange?: [number, number]): Metric => ({
  key,
  measured: { value, low: value - 2, high: value + 2, confidence: conf },
  unit: 'deg',
  normalRange,
  comparableAcrossViews: true,
});

describe('F.5 since-last-upload deltas', () => {
  it('computes the knee_drive improvement (+12) toward the normal range', () => {
    const deltas = sinceLastUpload(historyFixture);
    const knee = deltas.find((d) => d.key === 'knee_drive')!;
    expect(knee.delta).toBeCloseTo(12);
    expect(knee.direction).toBe('improve');
    expect(knee.comparable).toBe(true);
  });

  it('flags trunk_lean regression (moved away from range)', () => {
    const deltas = sinceLastUpload(historyFixture);
    const trunk = deltas.find((d) => d.key === 'trunk_lean')!;
    expect(trunk.direction).toBe('regress');
  });

  it('gates the hip delta as not-comparable when one endpoint is low-confidence', () => {
    const deltas = sinceLastUpload(historyFixture);
    const hip = deltas.find((d) => d.key === 'hip_extension')!;
    expect(hip.comparable).toBe(false);
    expect(hip.reason).toMatch(/not enough confidence/i);
  });

  it('empty when there is only one upload', () => {
    expect(sinceLastUpload([uploadOne])).toEqual([]);
  });
});

describe('F.5 confidence gate threshold', () => {
  it('does not fire a delta if either endpoint is below the threshold', () => {
    const lowPrev = computeDelta(m('x', 10, DELTA_CONFIDENCE_THRESHOLD - 0.01), m('x', 12, 0.9));
    const lowCur = computeDelta(m('x', 10, 0.9), m('x', 12, DELTA_CONFIDENCE_THRESHOLD - 0.01));
    const ok = computeDelta(m('x', 10, 0.9), m('x', 12, 0.9));
    expect(lowPrev.comparable).toBe(false);
    expect(lowCur.comparable).toBe(false);
    expect(ok.comparable).toBe(true);
  });
});

describe('F.5 primary flaw selection', () => {
  it('picks the highest-severity flaw in the latest upload', () => {
    const flaw = primaryFlaw(historyFixture);
    expect(flaw?.id).toBe('flaw-trunk');
  });
});

describe('F.6 trend / PB / baseline', () => {
  it('builds a trend series across uploads for a metric', () => {
    const series = trendSeries(historyFixture, 'knee_drive');
    expect(series.map((p) => p.metric.measured.value)).toEqual([70, 82]);
  });

  it('detects the PB as the point closest to the normal-range center', () => {
    const series = trendSeries(historyFixture, 'knee_drive'); // range [85,100] center 92.5
    expect(personalBestIndex(series)).toBe(1); // 82 is closer to 92.5 than 70
  });

  it('computes delta vs the baseline upload', () => {
    const d = deltaVsBaseline(historyFixture, 'knee_drive');
    expect(d?.delta).toBeCloseTo(12);
  });

  it('next-checkpoint fires every N sessions', () => {
    expect(nextCheckpoint(3, 3).due).toBe(true);
    expect(nextCheckpoint(2, 3).due).toBe(false);
    expect(nextCheckpoint(2, 3).sessionsLeft).toBe(1);
  });
});

describe('F.5/F.6 re-test capture angle', () => {
  it('maps flaw id to metric key', () => {
    expect(flawIdToMetric('flaw-trunk-lean')).toBe('trunk_lean');
  });

  it('suggests oblique capture for sagittal focus flaws', () => {
    const hint = recommendedRetestCapture('flaw-hip-extension', 'hip_extension');
    expect(hint).toMatch(/30/i);
    expect(hint).toMatch(/handheld/i);
  });
});
