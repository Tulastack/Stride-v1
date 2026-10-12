import type { AnalysisResult, Metric } from '../types/analysis';
import { isExperimentalMetric } from './validationStatus';

/** The worker certifies trust against each metric's error budget; the app does
 * not re-gate on a second, stricter confidence line of its own. */
export function trustedReading(analysis: AnalysisResult, metric: Metric, threshold = 0.5): boolean {
  return !isExperimentalMetric(metric.key, metric.trustStatus)
    && Number.isFinite(metric.measured.value)
    && Number.isFinite(metric.measured.confidence)
    && metric.measured.confidence >= threshold
    && analysis.captureQuality?.perMetricUsable?.[metric.key] !== false;
}

/** Readings this view can certify; older reports fall back to every metric. */
export function measurableCount(analysis: AnalysisResult): number {
  const metrics = analysis.metrics ?? [];
  const view = analysis.captureQuality?.viewMeasurable;
  return view ? metrics.filter((m) => view.includes(m.key)).length : metrics.length;
}

export function sameMeasurementContext(first: AnalysisResult, second: AnalysisResult): boolean {
  return !!first.phase && first.phase === second.phase
    && !!first.reconstructionMethod && first.reconstructionMethod === second.reconstructionMethod;
}

/** A session with no measured values has nothing to show in history or comparison. */
export function hasMeasuredSession(analysis: AnalysisResult): boolean {
  const metrics = analysis.metrics ?? [];
  const flaws = analysis.flaws ?? [];
  return metrics.some((metric) => Number.isFinite(metric.measured?.value))
    || flaws.some((flaw) => Number.isFinite(flaw.evidence?.measured?.value));
}

/** Both sessions share at least one trusted reading of the same metric, phase, and pipeline. */
export function sharesTrustedMeasurement(first: AnalysisResult, second: AnalysisResult): boolean {
  if (!first.id || first.id === second.id || !sameMeasurementContext(first, second)) return false;
  return (first.metrics ?? []).some((metric) => {
    const other = (second.metrics ?? []).find((item) => item.key === metric.key && item.unit === metric.unit);
    return !!other && trustedReading(first, metric) && trustedReading(second, other);
  });
}

/** A withheld metric cannot turn a placeholder zero into a grade. */
export function hasUsableScore(analysis: AnalysisResult): boolean {
  return Number.isFinite(analysis.economyScore) && (analysis.metrics ?? []).some((m) =>
    Number.isFinite(m.measured?.value) && Number.isFinite(m.measured?.confidence)
    && m.measured.confidence >= 0.35 && analysis.captureQuality?.perMetricUsable?.[m.key] !== false);
}
