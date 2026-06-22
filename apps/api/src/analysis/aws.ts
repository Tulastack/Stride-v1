// AwsAnalysisProvider — intentionally inert.
//
// ARCHITECTURE NOTE (seam vs. live path): in production, analysis is NOT driven
// through this provider's submit({ localVideoUri }) signature — on AWS the client
// uploads directly to S3 via a presigned multipart URL, so the API server never
// holds a local file. The real production pipeline is the HTTP route flow:
//
//   POST /videos/upload-url  (presign + create analyses row)
//     → client PUTs parts to S3
//   POST /videos/finalize    (complete multipart, write .capture.json sidecar, enqueueAnalysis → SQS)
//     → ml-worker consumes SQS, runs MoveNet → WHAM → OpenCap, writes .frames3d.json
//   POST /internal/analysis-biomech  (engine Stages 4–7 → DB result_json + metrics + suggestions + SSE)
//
// The AnalysisProvider seam is therefore the LOCAL/dev + test contract
// (LocalAnalysisProvider: fixture & reduced-engine modes). This class stays a
// throwing stub so nothing silently routes the live flow through the wrong
// mechanism. A future refactor could unify the two by re-expressing the route
// pipeline as a provider, but the upload model (presign vs. server-side file)
// makes that a deliberate design choice, not a quick swap.

import type {
  AnalysisProvider,
  AnalysisSubmitInput,
  AnalysisJobResult,
} from './provider.js';

const DEFERRED =
  'AWS pipeline not wired through the AnalysisProvider seam (deferred to AWS phase) — ' +
  'production analysis runs via the /videos → SQS → ml-worker → /internal route pipeline (see comment above).';

export class AwsAnalysisProvider implements AnalysisProvider {
  async submit(_input: AnalysisSubmitInput): Promise<{ jobId: string }> {
    throw new Error(DEFERRED);
  }

  async getResult(_jobId: string): Promise<AnalysisJobResult> {
    throw new Error(DEFERRED);
  }
}
