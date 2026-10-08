import type { AnalysisResult, Metric } from '../types/analysis';
import { isExperimentalMetric } from './validationStatus';

export function trustedReading(analysis: AnalysisResult, metric: Metric, threshold = 0.6): boolean {
  return !isExperimentalMetric(metric.key, metric.trustStatus)
    && Number.isFinite(metric.measured.value)
    && Number.isFinite(metric.measured.confidence)
    && metric.measured.confidence >= threshold
    && analysis.captureQuality?.perMetricUsable?.[metric.key] !== false;
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
