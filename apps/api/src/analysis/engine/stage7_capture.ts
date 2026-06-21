// Stage 7 — capture-quality assessment.
//
// Overall score + per-metric usability + at most ONE nudge. Never nag: a nudge
// appears only when a metric is genuinely low-confidence.

import type { CaptureQuality } from '@stride/types';
import type { MetricConfidence } from './stage6_confidence.js';

export const USABLE_CONFIDENCE_THRESHOLD = 0.5;

export interface CaptureInputs {
  fps: number;
  motionBlur: 'low' | 'med' | 'high';
  framing: 'full' | 'partial';
}

const blurFactor = { low: 1, med: 0.85, high: 0.6 } as const;

export function assessCapture(metrics: MetricConfidence[], inputs: CaptureInputs): CaptureQuality {
  const perMetricUsable: Record<string, boolean> = {};
  for (const m of metrics) {
    perMetricUsable[m.metric.key] = m.band.confidence >= USABLE_CONFIDENCE_THRESHOLD;
  }

  const meanConf = metrics.length
    ? metrics.reduce((a, m) => a + m.band.confidence, 0) / metrics.length
    : 0;
  const fpsFactor = inputs.fps >= 120 ? 1 : inputs.fps >= 90 ? 0.9 : 0.7;
  const framingFactor = inputs.framing === 'full' ? 1 : 0.85;
  const overall = round(meanConf * fpsFactor * framingFactor * blurFactor[inputs.motionBlur]);

  // Single most useful nudge: the unusable metric with the highest viewpoint
  // penalty (i.e. the one a better angle would most help).
  const unusable = metrics
    .filter((m) => !perMetricUsable[m.metric.key])
    .sort((a, b) => b.viewpointPenalty - a.viewpointPenalty);

  let primaryNudge: string | undefined;
  if (unusable.length) {
    const worst = unusable[0];
    primaryNudge =
      worst.viewpointPenalty > 0.4
        ? `${labelFor(worst.metric.key)} is low-confidence from this angle — a slight turn (~30° oblique) usually helps while keeping the phone handheld.`
        : `${labelFor(worst.metric.key)} is low-confidence — re-film at 120fps with more light and less motion blur.`;
  }

  return {
    overall,
    fps: inputs.fps,
    motionBlur: inputs.motionBlur,
    framing: inputs.framing,
    perMetricUsable,
    ...(primaryNudge ? { primaryNudge } : {}),
  };
}

function labelFor(key: string): string {
  return (
    {
      trunk_lean: 'Trunk lean',
      knee_drive: 'Knee drive',
      hip_extension: 'Hip extension',
      contact_time_ms: 'Contact time',
      cadence_spm: 'Cadence',
    }[key] ?? key
  );
}

const round = (x: number) => Math.round(x * 100) / 100;
