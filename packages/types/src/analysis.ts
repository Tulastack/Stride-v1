// ─── Analysis Contract (PRD v2.2 + v2.2-B addendum) ───────────────────
//
// The anti-chatbot contract. Every analysis result is:
//   • typed and evidence-bound (no free-text coaching field exists here),
//   • confidence-aware (every metric carries a band; nothing is faked solid),
//   • view-invariant (angles are computed in a canonical 3D body frame, so
//     uploads shot from any angle are directly comparable).
//
// Where this conflicts with the v2.1 result shape, this contract wins.
// The real 3D engine (Stages 2–3) lands in the ML/AWS phase; this contract
// is built now so every feature is confidence-aware from day one.

export type Phase = 'acceleration' | 'max_velocity' | 'general';

/** How the 3D body was reconstructed for this result. */
export type ReconstructionMethod = '2d' | '3d-mono' | '3d-multi';

export type Severity = 1 | 2 | 3;

/** A measured value with an uncertainty band. `confidence` is 0..1. */
export interface ConfidenceBand {
  value: number;
  low: number;
  high: number;
  confidence: number; // 0..1
}

/**
 * Per-flaw proof. Angles are read in the canonical (gravity-aligned,
 * pelvis-centric) frame so they are view-invariant. `viewpointPenalty`
 * captures how out-of-plane the measured angle is relative to the camera.
 */
export interface Evidence {
  frameTimestampMs: number;
  jointAngles3D: Record<string, number>; // canonical-frame angles (degrees)
  measured: ConfidenceBand; // the measured metric WITH its band
  normalRange: [number, number];
  viewpointPenalty: number; // 0 (in-plane, ideal) .. 1 (degenerate view)
}

export interface Flaw {
  id: string;
  name: string;
  phase: Phase;
  severity: Severity;
  plainExplanation: string;
  evidence: Evidence;
}

export interface DrillRec {
  flawId: string;
  drillId: string;
  drillName: string;
  cue: string;
  demoAssetId: string; // visual demonstration of correct form (required)
  sets: number;
  reps: number;
  rationale: string;
}

export type MetricTrustStatus = 'trusted' | 'experimental';

/**
 * Always computed in the canonical 3D frame, so it is comparable across
 * filming angles. `comparableAcrossViews` is the literal `true` on purpose:
 * a metric that is not canonical-frame is not a valid Metric.
 *
 * `trustStatus` mirrors the B.2 validation gate for this metric at the
 * capture viewpoint; unknown metrics default to experimental in the UI.
 */
export interface Metric {
  key: string;
  measured: ConfidenceBand;
  unit: string;
  normalRange?: [number, number];
  comparableAcrossViews: true;
  trustStatus?: MetricTrustStatus;
}

/**
 * Capture-quality assessment. We never silently emit a low-confidence metric
 * as if it were solid; instead we surface at most ONE nudge.
 */
export interface CaptureQuality {
  overall: number; // 0..1
  fps: number;
  motionBlur: 'low' | 'med' | 'high';
  framing: 'full' | 'partial';
  perMetricUsable: Record<string, boolean>; // keyed by Metric.key
  primaryNudge?: string; // single most useful capture tip, or undefined if fine
}

export interface AnalysisResult {
  id: string;
  phase: Phase;
  summary: string; // 1–2 plain sentences, no jargon
  flaws: Flaw[];
  recommendations: DrillRec[];
  metrics: Metric[];
  captureQuality: CaptureQuality;
  reconstructionMethod: ReconstructionMethod;
  createdAt: string; // ISO 8601
}

// ─── Capture inputs & athlete context (the seam's request side) ───────

/** Optional camera intrinsics (Stage 0 capture); enables metric scale. */
export interface CameraIntrinsics {
  focalLengthPx: number;
  principalPointPx: [number, number];
  sensorWidthPx: number;
  sensorHeightPx: number;
}

/** What the analysis engine knows about the athlete (drives history + cues). */
export interface AthleteContext {
  userId: string;
  eventSpecialty?: '100m' | '200m' | '400m';
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced';
  personalBestSeconds?: number;
  /** The flaw currently being tracked, for confidence-gated deltas (F.5/F.6). */
  focusFlawId?: string;
}

// ─── Platform / infra types (transport & persistence, not the contract) ──

export type AnalysisStatus = 'pending' | 'processing' | 'completed' | 'failed';

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
  /** Stage 0 capture sidecar (gyro, intrinsics, fps preference). */
  captureManifest?: Record<string, unknown>;
}

export interface FinalizeResponse {
  analysisId: string;
  status: 'pending';
}
