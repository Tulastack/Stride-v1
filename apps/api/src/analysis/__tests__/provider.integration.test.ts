/**
 * Integration tests for the AnalysisProvider seam (PROMPT F.1 revised).
 *
 * Rider:
 *  • a test walks submit() -> getResult() through LocalAnalysisProvider end to end;
 *  • a low-quality fixture yields perMetricUsable=false for hip + a primaryNudge;
 *  • vision retention: every recommendation references a flaw with 3D evidence + confidence;
 *  • AwsAnalysisProvider remains a throwing stub.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnalysisResult } from '@stride/types';
import { LocalAnalysisProvider } from '../local.js';
import { AwsAnalysisProvider } from '../aws.js';
import { validateAnalysisResult } from '../validate.js';
import { getAnalysisProvider, resetAnalysisProvider } from '../index.js';

const GOLDEN_FIXTURE_VIDEO = join(
  dirname(fileURLToPath(import.meta.url)),
  '../engine/__tests__/fixtures/stride-side.mp4'
);

const athlete = { userId: 'user-test-1', eventSpecialty: '100m' as const };

async function run(uri: string): Promise<AnalysisResult> {
  const provider = new LocalAnalysisProvider('fixture');
  const { jobId } = await provider.submit({ localVideoUri: uri, athlete });
  const res = await provider.getResult(jobId);
  expect(res.status).toBe('done');
  if (res.status !== 'done') throw new Error('expected done');
  return res.result;
}

describe('LocalAnalysisProvider — submit/getResult end to end', () => {
  it('returns a schema-valid result for a side capture', async () => {
    const result = await run('/clips/side-acceleration.mov');
    expect(() => validateAnalysisResult(result)).not.toThrow();
    expect(result.reconstructionMethod).toBe('3d-mono');
  });

  it('high-quality capture shows no nudge and all metrics usable', async () => {
    const result = await run('/clips/side-acceleration.mov');
    expect(result.captureQuality.primaryNudge).toBeUndefined();
    expect(Object.values(result.captureQuality.perMetricUsable).every(Boolean)).toBe(true);
  });

  it('low-quality head-on capture marks hip unusable and emits one nudge', async () => {
    const result = await run('/clips/headon-maxvelocity.mov');
    expect(() => validateAnalysisResult(result)).not.toThrow();

    // perMetricUsable=false for hip
    expect(result.captureQuality.perMetricUsable.hip_extension).toBe(false);
    // a single, present nudge
    expect(typeof result.captureQuality.primaryNudge).toBe('string');
    expect(result.captureQuality.primaryNudge).toMatch(/hip/i);

    // the hip metric is genuinely low-confidence (band widened, confidence dropped)
    const hip = result.metrics.find((m) => m.key.includes('hip'))!;
    expect(hip.measured.confidence).toBeLessThan(0.5);
    expect(hip.measured.high - hip.measured.low).toBeGreaterThan(20);
  });
});

describe('Vision retention — every recommendation is evidence-bound', () => {
  it.each([
    ['/clips/side-acceleration.mov'],
    ['/clips/headon-maxvelocity.mov'],
  ])('result for %s: each rec references a flaw with 3D evidence + confidence', async (uri) => {
    const result = await run(uri);
    const flawById = new Map(result.flaws.map((f) => [f.id, f]));

    expect(result.recommendations.length).toBeGreaterThan(0);
    for (const rec of result.recommendations) {
      const flaw = flawById.get(rec.flawId);
      expect(flaw).toBeDefined();
      expect(rec.demoAssetId.length).toBeGreaterThan(0);
      // 3D canonical evidence + a confidence band on the referenced flaw
      expect(Object.keys(flaw!.evidence.jointAngles3D).length).toBeGreaterThan(0);
      expect(typeof flaw!.evidence.measured.confidence).toBe('number');
    }

    // The contract has no free-text coaching field.
    expect(result).not.toHaveProperty('message');
    expect(result).not.toHaveProperty('conversation');
  });
});

describe('LocalAnalysisProvider — failure & mode handling', () => {
  it('returns failed for an unknown jobId', async () => {
    const provider = new LocalAnalysisProvider('fixture');
    const res = await provider.getResult('no-such-job');
    expect(res.status).toBe('failed');
  });

  it('returns failed when the video URI carries a fail marker', async () => {
    const provider = new LocalAnalysisProvider('fixture');
    const { jobId } = await provider.submit({ localVideoUri: '/clips/fail-clip.mov', athlete });
    const res = await provider.getResult(jobId);
    expect(res.status).toBe('failed');
  });

  it('local mode runs the reduced biomechanics engine on golden sidecar fixtures (B.1)', async () => {
    const provider = new LocalAnalysisProvider('local');
    const { jobId } = await provider.submit({ localVideoUri: GOLDEN_FIXTURE_VIDEO, athlete });
    const res = await provider.getResult(jobId);
    expect(res.status).toBe('done');
    if (res.status === 'done') {
      expect(res.result.reconstructionMethod).toBe('3d-mono');
      expect(res.result.metrics.length).toBeGreaterThan(0);
    }
  });
});

describe('AwsAnalysisProvider — deferred stub', () => {
  it('throws on submit', async () => {
    const aws = new AwsAnalysisProvider();
    await expect(aws.submit({ localVideoUri: 'x', athlete })).rejects.toThrow(/deferred to AWS/i);
  });

  it('throws on getResult', async () => {
    const aws = new AwsAnalysisProvider();
    await expect(aws.getResult('job')).rejects.toThrow(/deferred to AWS/i);
  });
});

describe('getAnalysisProvider — dependency injection', () => {
  afterEach(() => {
    delete process.env.ANALYSIS_PROVIDER;
    resetAnalysisProvider();
  });

  it('returns LocalAnalysisProvider by default', () => {
    resetAnalysisProvider();
    expect(getAnalysisProvider()).toBeInstanceOf(LocalAnalysisProvider);
  });

  it('returns AwsAnalysisProvider only under the production-aws flag', () => {
    process.env.ANALYSIS_PROVIDER = 'production-aws';
    resetAnalysisProvider();
    expect(getAnalysisProvider()).toBeInstanceOf(AwsAnalysisProvider);
  });
});
