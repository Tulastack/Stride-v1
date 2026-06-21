// B.2 validation gate mirrored for mobile UI (matches harness perMetricStatus).
// Regenerate when docs/validation/REPORT.md thresholds change.

import type { MetricTrustStatus } from '../types/analysis';

/** Overall per-metric status: trusted only if every viewpoint passes validation. */
export const METRIC_TRUST: Record<string, MetricTrustStatus> = {
  trunk_lean: 'experimental',
  knee_drive: 'experimental',
  hip_extension: 'experimental',
  contact_time_ms: 'trusted',
  cadence_spm: 'trusted',
};

export function metricTrustStatus(key: string, fromResult?: MetricTrustStatus): MetricTrustStatus {
  if (fromResult) return fromResult;
  return METRIC_TRUST[key] ?? 'experimental';
}

export function isExperimentalMetric(key: string, fromResult?: MetricTrustStatus): boolean {
  return metricTrustStatus(key, fromResult) === 'experimental';
}
