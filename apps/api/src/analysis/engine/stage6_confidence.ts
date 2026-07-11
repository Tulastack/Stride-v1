// Stage 6 — per-metric confidence + band.
//
// Type-weighted trust (docs/research/angle-agnostic-kinematics.md):
//   Tier 1 temporal — angle-robust, gated on frame rate (no sin² azimuth)
//   Tier 2 sagittal — best side-on, degraded off-axis via sin²(azimuth)
//   Tier 3 / experimental — descriptive (translation-dependent / candidates)
// Combine with mean 2D keypoint confidence and 3D reconstruction residual.
// Never silently emit a low-confidence number.

import type { ConfidenceBand } from '@stride/types';
import type { ComputedMetric, MetricPlane } from './stage5_metrics.js';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Align with biomech2d production path. */
export const METRIC_TIER: Record<string, 1 | 2 | 3> = {
  cadence_spm: 1,
  contact_time_ms: 1,
  vertical_oscillation: 1,
  trunk_lean: 2,
  knee_drive: 2,
  hip_extension: 2,
  knee_flexion: 2,
  arm_swing: 2,
  overstride: 3,
};

/** Sprint contact ~90 ms — below ~120 fps timing error swamps the signal. */
export const FPS_TRUST_GATE = 120;
/** Vertical CoM off-axis error unmeasured on runners (honesty ledger #9). */
export const CANDIDATE_METRICS = new Set(['vertical_oscillation']);

/**
 * Viewpoint penalty for a metric given the camera azimuth (0 = side-on/ideal,
 * 90 = head-on). Tier-aware: temporal metrics get zero azimuth penalty;
 * sagittal degrade with sin²; plane fallback kept for unknown keys.
 */
export function viewpointPenalty(
  plane: MetricPlane,
  cameraAzimuthDeg: number,
  metricKey?: string,
): number {
  const tier = metricKey ? METRIC_TIER[metricKey] : undefined;
  if (tier === 1) return 0;
  const a = (Math.abs(cameraAzimuthDeg) % 180) * (Math.PI / 180);
  const outOfPlane = Math.sin(a) ** 2; // 0 at side-on, 1 at head-on
  if (tier === 3) return clamp01(outOfPlane);
  if (tier === 2 || plane === 'sagittal') return clamp01(outOfPlane);
  return clamp01(outOfPlane * 0.25);
}

export interface ConfidenceInputs {
  meanKeypointConfidence: number; // 0..1
  reconResidual: number; // lower is better (~0..1)
  cameraAzimuthDeg: number;
  /** Capture / keypoint sample rate used for Tier-1 temporal gating. */
  fps?: number;
}

export interface MetricConfidence {
  metric: ComputedMetric;
  band: ConfidenceBand;
  viewpointPenalty: number;
  /** Type-weighted trust suggestion before validation-table AND. */
  trustHint: 'trusted' | 'experimental';
  tier: 1 | 2 | 3;
}

/** Compute a confidence band for one metric. Lower confidence widens the band. */
export function metricConfidence(metric: ComputedMetric, inputs: ConfidenceInputs): MetricConfidence {
  const tier = METRIC_TIER[metric.key] ?? (metric.plane === 'temporal' ? 1 : 2);
  const vp = viewpointPenalty(metric.plane, inputs.cameraAzimuthDeg, metric.key);
  const residualScore = clamp01(1 - inputs.reconResidual);
  // Tier 3 stays descriptive — down-weight confidence even when view is clean.
  const tierScale = tier === 3 ? 0.6 : 1;
  const confidence = clamp01(inputs.meanKeypointConfidence * residualScore * (1 - vp) * tierScale);

  const value = Number.isFinite(metric.value) ? metric.value : 0;
  // Band half-width grows as confidence drops. Floor keeps a minimum honesty band.
  const span = Math.max(Math.abs(value), 1);
  const halfWidth = span * (0.04 + 0.6 * (1 - confidence));
  const band: ConfidenceBand = {
    value,
    low: round(value - halfWidth),
    high: round(value + halfWidth),
    confidence: round(confidence),
  };

  const fps = inputs.fps ?? 0;
  let trustHint: 'trusted' | 'experimental' = 'experimental';
  if (tier === 1) {
    trustHint =
      confidence >= 0.6 && fps >= FPS_TRUST_GATE && !CANDIDATE_METRICS.has(metric.key)
        ? 'trusted'
        : 'experimental';
  } else if (tier === 2) {
    trustHint = confidence >= 0.6 && vp <= 0.5 ? 'trusted' : 'experimental';
  } else {
    trustHint = 'experimental';
  }

  return { metric, band, viewpointPenalty: round(vp), trustHint, tier };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
