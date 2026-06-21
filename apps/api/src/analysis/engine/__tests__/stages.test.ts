/**
 * PROMPT B.1 — gait events, confidence model, capture quality (unit).
 */
import { dropLowConfidence, gapFill, lowPass, meanConfidence } from '../stage1_keypoints.js';
import { detectStances, computeMetrics } from '../stage5_metrics.js';
import { metricConfidence, viewpointPenalty } from '../stage6_confidence.js';
import { assessCapture } from '../stage7_capture.js';
import { sideAccelClip, headOnMaxVClip } from '../precomputed.js';

describe('Stage 1 hygiene', () => {
  it('drops keypoints below the 0.5 confidence floor', () => {
    const out = dropLowConfidence([
      { x: 1, y: 1, confidence: 0.9 },
      { x: 2, y: 2, confidence: 0.3 },
    ]);
    expect(out[0]).not.toBeNull();
    expect(out[1]).toBeNull();
  });

  it('gap-fills nulls by interpolation', () => {
    expect(gapFill([0, null, null, 3])).toEqual([0, 1, 2, 3]);
    expect(gapFill([null, 2, null])).toEqual([2, 2, 2]);
  });

  it('low-pass smooths a spike', () => {
    const out = lowPass([0, 0, 9, 0, 0]);
    expect(out[2]).toBeLessThan(9);
  });

  it('mean confidence ignores missing joints', () => {
    expect(meanConfidence({ a: { x: 0, y: 0, confidence: 0.8 }, b: null })).toBeCloseTo(0.8);
  });
});

describe('Stage 5 gait events', () => {
  it('detects alternating stances on a known clip', () => {
    const left = detectStances(sideAccelClip.frames, 'l');
    const right = detectStances(sideAccelClip.frames, 'r');
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    // each stance has strike before toe-off
    for (const s of [...left, ...right]) expect(s.offIdx).toBeGreaterThanOrEqual(s.strikeIdx);
  });

  it('computes a plausible cadence and contact time', () => {
    const { metrics } = computeMetrics(sideAccelClip.frames, sideAccelClip.fps);
    const cadence = metrics.find((m) => m.key === 'cadence_spm')!;
    const contact = metrics.find((m) => m.key === 'contact_time_ms')!;
    expect(cadence.value).toBeGreaterThan(0);
    expect(contact.value).toBeGreaterThan(0);
  });
});

describe('Stage 6 confidence model', () => {
  const metric = { key: 'hip_extension', value: 50, unit: 'deg', normalRange: [35, 55] as [number, number], plane: 'sagittal' as const, evidenceFrame: 0 };

  it('head-on (degenerate) viewpoint penalizes sagittal metrics more than side-on', () => {
    expect(viewpointPenalty('sagittal', 85)).toBeGreaterThan(viewpointPenalty('sagittal', 5));
    expect(viewpointPenalty('temporal', 85)).toBeLessThan(viewpointPenalty('sagittal', 85));
  });

  it('degraded keypoints OR degenerate viewpoint widen the band and drop confidence', () => {
    const good = metricConfidence(metric, { meanKeypointConfidence: 0.9, reconResidual: 0.05, cameraAzimuthDeg: 0 });
    const badView = metricConfidence(metric, { meanKeypointConfidence: 0.9, reconResidual: 0.05, cameraAzimuthDeg: 85 });
    const badKp = metricConfidence(metric, { meanKeypointConfidence: 0.4, reconResidual: 0.05, cameraAzimuthDeg: 0 });

    expect(badView.band.confidence).toBeLessThan(good.band.confidence);
    expect(badKp.band.confidence).toBeLessThan(good.band.confidence);
    const width = (b: { low: number; high: number }) => b.high - b.low;
    expect(width(badView.band)).toBeGreaterThan(width(good.band));
    expect(width(badKp.band)).toBeGreaterThan(width(good.band));
  });
});

describe('Stage 7 capture quality', () => {
  it('high-quality clip: all metrics usable, no nudge', () => {
    const { metrics } = computeMetrics(sideAccelClip.frames, sideAccelClip.fps);
    const withConf = metrics.map((m) =>
      metricConfidence(m, { meanKeypointConfidence: 0.9, reconResidual: 0.06, cameraAzimuthDeg: 0 })
    );
    const cap = assessCapture(withConf, { fps: 120, motionBlur: 'low', framing: 'full' });
    expect(cap.primaryNudge).toBeUndefined();
    expect(Object.values(cap.perMetricUsable).every(Boolean)).toBe(true);
    expect(cap.overall).toBeGreaterThan(0.6);
  });

  it('head-on low-quality clip: sagittal metrics unusable + exactly one nudge', () => {
    const { metrics } = computeMetrics(headOnMaxVClip.frames, headOnMaxVClip.fps);
    const withConf = metrics.map((m) =>
      metricConfidence(m, { meanKeypointConfidence: 0.55, reconResidual: 0.28, cameraAzimuthDeg: 85 })
    );
    const cap = assessCapture(withConf, { fps: 60, motionBlur: 'high', framing: 'partial' });
    expect(cap.perMetricUsable.hip_extension).toBe(false);
    expect(typeof cap.primaryNudge).toBe('string');
    expect(cap.overall).toBeLessThan(0.6);
  });
});
