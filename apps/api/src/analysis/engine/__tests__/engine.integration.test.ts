/**
 * PROMPT B.1 — full pipeline integration through the reduced engine.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metric } from '@stride/types';
import { ReducedBiomechanicsEngine } from '../engine.js';
import { sideAccelClip, headOnMaxVClip } from '../precomputed.js';
import { validateAnalysisResult } from '../../validate.js';
import { LocalAnalysisProvider } from '../../local.js';

const engine = new ReducedBiomechanicsEngine();
const FIXTURE_VIDEO = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/stride-side.mp4'
);

describe('ReducedBiomechanicsEngine.run (precomputed clips — unit tests only)', () => {
  it('side-on clip yields a schema-valid, trusted result', () => {
    const result = engine.run(sideAccelClip);
    expect(() => validateAnalysisResult(result)).not.toThrow();
    expect(result.phase).toBe('acceleration');
    expect(result.reconstructionMethod).toBe('3d-mono');
    expect(result.metrics.every((m: Metric) => m.comparableAcrossViews === true)).toBe(true);
    expect(result.captureQuality.primaryNudge).toBeUndefined();
  });

  it('head-on clip yields a low-confidence result with a nudge', () => {
    const result = engine.run(headOnMaxVClip);
    expect(() => validateAnalysisResult(result)).not.toThrow();
    expect(result.captureQuality.perMetricUsable.hip_extension).toBe(false);
    expect(typeof result.captureQuality.primaryNudge).toBe('string');
  });
});

describe('ReducedBiomechanicsEngine.analyze (golden fixture sidecars)', () => {
  it('loads .frames3d.json and produces a valid result', () => {
    const result = engine.analyze(FIXTURE_VIDEO);
    expect(() => validateAnalysisResult(result)).not.toThrow();
    expect(result.metrics.some((m: Metric) => m.trustStatus)).toBe(true);
  });
});

describe('LocalAnalysisProvider local mode', () => {
  it('submit/getResult uses golden fixture sidecar path', async () => {
    const provider = new LocalAnalysisProvider('local');
    const { jobId } = await provider.submit({
      localVideoUri: FIXTURE_VIDEO,
      athlete: { userId: 'u1' },
    });
    const res = await provider.getResult(jobId);
    expect(res.status).toBe('done');
    if (res.status === 'done') {
      expect(() => validateAnalysisResult(res.result)).not.toThrow();
    }
  });
});
