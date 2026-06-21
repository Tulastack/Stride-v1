// The AnalysisProvider seam.
//
// Every feature depends on this interface, never on AWS. The AWS pipeline can
// be wired later (AwsAnalysisProvider) with zero feature changes. No feature or
// UI file may import S3/SQS clients directly — they go through this seam.

import type {
  AnalysisResult,
  AthleteContext,
  CameraIntrinsics,
} from '@stride/types';

/**
 * Input to a single analysis job. `localVideoUri` + `athlete` are required
 * (base F.1). Capture-agnostic 3D inputs (gyro stream, intrinsics) are optional
 * here and drive `reconstructionMethod` once the real engine lands (addendum
 * Stage 0); fixture mode ignores them.
 */
export interface AnalysisSubmitInput {
  localVideoUri: string;
  athlete: AthleteContext;
  gyroPath?: string;
  intrinsics?: CameraIntrinsics;
}

export type AnalysisJobResult =
  | { status: 'pending' }
  | { status: 'failed'; error: string }
  | { status: 'done'; result: AnalysisResult };

export interface AnalysisProvider {
  submit(input: AnalysisSubmitInput): Promise<{ jobId: string }>;
  getResult(jobId: string): Promise<AnalysisJobResult>;
}
