// Mobile mirror of the @stride/types analysis contract (PRD v2.2 + v2.2-B).
// Kept local so screens/components are self-contained under metro/jest without
// cross-package runtime resolution. Shape MUST match packages/types/src/analysis.ts.

export type Phase = 'acceleration' | 'max_velocity' | 'general';
export type ReconstructionMethod = '2d' | '3d-mono' | '3d-multi';
export type Severity = 1 | 2 | 3;

export interface ConfidenceBand {
  value: number;
  low: number;
  high: number;
  confidence: number; // 0..1
}

export interface Evidence {
  frameTimestampMs: number;
  jointAngles3D: Record<string, number>;
  measured: ConfidenceBand;
  normalRange: [number, number];
  viewpointPenalty: number;
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
  demoAssetId: string;
  sets: number;
  reps: number;
  rationale: string;
}

export type MetricTrustStatus = 'trusted' | 'experimental';

export interface Metric {
  key: string;
  measured: ConfidenceBand;
  unit: string;
  normalRange?: [number, number];
  comparableAcrossViews: true;
  trustStatus?: MetricTrustStatus;
}

export interface CaptureQuality {
  overall: number;
  fps: number;
  motionBlur: 'low' | 'med' | 'high';
  framing: 'full' | 'partial';
  perMetricUsable: Record<string, boolean>;
  primaryNudge?: string;
}

export interface AnalysisResult {
  id: string;
  phase: Phase;
  summary: string;
  flaws: Flaw[];
  recommendations: DrillRec[];
  metrics: Metric[];
  captureQuality: CaptureQuality;
  reconstructionMethod: ReconstructionMethod;
  createdAt: string;
}

/** Confidence tier for UI demotion: low-confidence metrics are muted + labeled. */
export type ConfidenceTier = 'high' | 'med' | 'low';

export function confidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.5) return 'med';
  return 'low';
}

/** Human label for a metric key. */
export const METRIC_LABELS: Record<string, string> = {
  trunk_lean: 'Trunk lean',
  knee_drive: 'Knee drive',
  hip_extension: 'Hip extension',
  contact_time_ms: 'Contact time',
  cadence_spm: 'Cadence',
  shin_angle: 'Shin angle',
};

export function metricLabel(key: string): string {
  return METRIC_LABELS[key] ?? key.replace(/_/g, ' ');
}
