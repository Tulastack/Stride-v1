// Validation trust status for in-app experimental gate (B.2 task 3).
// Grounded in docs/validation/REPORT.md — do not invent confidence.

import {
  runValidation,
  metricStatus,
  type MetricKey,
  type MetricStatus,
  type Viewpoint,
} from './harness.js';
import { buildValidationDataset } from './dataset.js';

let cachedReport: ReturnType<typeof runValidation> | undefined;

function report() {
  if (!cachedReport) cachedReport = runValidation(buildValidationDataset());
  return cachedReport;
}

/** Per-metric overall status from the validation harness (trusted only if all viewpoints pass). */
export function getValidationTrustMap(): Record<MetricKey, MetricStatus> {
  return report().perMetricStatus;
}

/** Trust for a metric at a given viewpoint bucket. */
export function metricTrustStatus(metric: MetricKey, viewpoint: Viewpoint): MetricStatus {
  return metricStatus(report(), metric, viewpoint);
}

export type { MetricStatus };
