// AwsAnalysisProvider — DO NOT IMPLEMENT IN THIS PASS.
//
// The S3 presign / SQS enqueue / worker / DLQ / idempotency pipeline is deferred
// to the AWS phase. Every method throws so nothing silently depends on it. When
// the AWS phase lands, this swaps in behind the `production-aws` flag with zero
// feature changes.

import type {
  AnalysisProvider,
  AnalysisSubmitInput,
  AnalysisJobResult,
} from './provider.js';

const DEFERRED = 'AWS pipeline not wired — deferred to AWS phase';

export class AwsAnalysisProvider implements AnalysisProvider {
  // TODO(aws): S3 presign + SQS enqueue, return real jobId.
  async submit(_input: AnalysisSubmitInput): Promise<{ jobId: string }> {
    throw new Error(DEFERRED);
  }

  // TODO(aws): poll job state (SQS/worker/DLQ) and map to AnalysisJobResult.
  async getResult(_jobId: string): Promise<AnalysisJobResult> {
    throw new Error(DEFERRED);
  }
}
