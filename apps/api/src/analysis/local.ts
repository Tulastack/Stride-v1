// LocalAnalysisProvider — the provider used in all envs except production-aws.
//
// Two modes via ANALYSIS_PROVIDER_MODE:
//   • 'fixture' (default): deterministic AnalysisResult fixtures keyed by video URI
//     for UI/tests — not used in the live upload pipeline.
//   • 'local': runs the real biomechanics engine against on-disk sidecars
//     (.keypoints.json / .frames3d.json from ml-worker).

import type {
  AnalysisProvider,
  AnalysisSubmitInput,
  AnalysisJobResult,
} from './provider.js';
import { pickFixture } from './fixtures.js';
import { validateAnalysisResult } from './validate.js';
import { ReducedBiomechanicsEngine } from './engine/engine.js';

type LocalMode = 'fixture' | 'local';

export class LocalAnalysisProvider implements AnalysisProvider {
  private readonly mode: LocalMode;
  private readonly jobs = new Map<string, AnalysisJobResult>();

  constructor(mode?: LocalMode) {
    this.mode = mode ?? ((process.env.ANALYSIS_PROVIDER_MODE as LocalMode) || 'fixture');
  }

  async submit(input: AnalysisSubmitInput): Promise<{ jobId: string }> {
    // A "fail" marker exercises the failed branch deterministically (both modes).
    if (/\bfail\b|failure/i.test(input.localVideoUri)) {
      const jobId = `local-fail-${this.jobs.size}`;
      this.jobs.set(jobId, { status: 'failed', error: 'Simulated analysis failure' });
      return { jobId };
    }

    if (this.mode === 'local') {
      const result = new ReducedBiomechanicsEngine().analyze(
        input.localVideoUri,
        input.gyroPath,
        input.intrinsics
      );
      validateAnalysisResult(result);
      const jobId = `local-engine-${result.id}`;
      this.jobs.set(jobId, { status: 'done', result });
      return { jobId };
    }

    const fixture = pickFixture(input.localVideoUri);
    // Never emit an invalid result: validate the fixture against the contract.
    validateAnalysisResult(fixture);

    const jobId = `local-${fixture.id}`;
    this.jobs.set(jobId, { status: 'done', result: structuredClone(fixture) });
    return { jobId };
  }

  async getResult(jobId: string): Promise<AnalysisJobResult> {
    return this.jobs.get(jobId) ?? { status: 'failed', error: `Unknown jobId: ${jobId}` };
  }
}
