// Stage 6 — per-metric confidence + band.
//
// Combine: (a) mean 2D keypoint confidence over the measured frames,
// (b) 3D reconstruction residual, (c) viewpoint geometry penalty (how
// out-of-plane the measured angle is relative to the camera). Emit value + band.
// This is the thing we OWN: never silently emit a low-confidence number.

import type { ConfidenceBand } from '@stride/types';
import type { ComputedMetric, MetricPlane } from './stage5_metrics.js';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * Viewpoint penalty for a metric given the camera azimuth (0 = side-on/ideal,
 * 90 = head-on). Sagittal-plane angles degrade as the camera rotates head-on;
 * temporal metrics (cadence/contact time) are far less view-dependent.
 */
export function viewpointPenalty(plane: MetricPlane, cameraAzimuthDeg: number): number {
  const a = (Math.abs(cameraAzimuthDeg) % 180) * (Math.PI / 180);
  const outOfPlane = Math.sin(a) ** 2; // 0 at side-on, 1 at head-on
  return plane === 'sagittal' ? clamp01(outOfPlane) : clamp01(outOfPlane * 0.25);
}

export interface ConfidenceInputs {
  meanKeypointConfidence: number; // 0..1
  reconResidual: number; // lower is better (~0..1)
  cameraAzimuthDeg: number;
}

export interface MetricConfidence {
  metric: ComputedMetric;
  band: ConfidenceBand;
  viewpointPenalty: number;
}

/** Compute a confidence band for one metric. Lower confidence widens the band. */
export function metricConfidence(metric: ComputedMetric, inputs: ConfidenceInputs): MetricConfidence {
  const vp = viewpointPenalty(metric.plane, inputs.cameraAzimuthDeg);
  const residualScore = clamp01(1 - inputs.reconResidual);
  const confidence = clamp01(inputs.meanKeypointConfidence * residualScore * (1 - vp));

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
  return { metric, band, viewpointPenalty: round(vp) };
}

const round = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
