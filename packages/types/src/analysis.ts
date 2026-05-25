// ─── Analysis Types ───────────────────────────────────────────────

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface Drill {
  name: string;
  volume: string;
  cue: string;
}

export interface PrimaryIssue {
  rank: number;
  type: string;
  severity: 'low' | 'medium' | 'high';
  measured_value: string;
  optimal_range: string;
  plain_english: string;
  drills: Drill[];
  timeline: string;
}

export interface AnalysisResult {
  overall_score: number;
  score_label: string;
  movenet_version: string;
  primary_issues: PrimaryIssue[];
}

export interface Analysis {
  id: string;
  user_id: string;
  s3_key: string;
  status: AnalysisStatus;
  movenet_version: string | null;
  overall_score: number | null;
  result_json: AnalysisResult | null;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export type SSEStage = 'movenet' | 'biomechanics' | 'llm';

export interface SSEEvent {
  status: AnalysisStatus | 'connected';
  stage?: SSEStage;
  analysisId?: string;
  error?: string;
}

// ─── Upload Types ─────────────────────────────────────────────────

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface CompletedPart {
  partNumber: number;
  etag: string;
}

export interface UploadUrlResponse {
  analysisId: string;
  uploadId: string;
  parts: PresignedPart[];
}

export interface FinalizeRequest {
  analysisId: string;
  uploadId: string;
  parts: CompletedPart[];
}

export interface FinalizeResponse {
  analysisId: string;
  status: 'pending';
}
