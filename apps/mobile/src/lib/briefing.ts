// Coach Briefing computation (PROMPT F.5) — pure, data-driven, no LLM free-text.
// Also backs the Progress timeline math (PROMPT F.6): deltas, PB detection, and
// confidence-gated comparisons. All copy is templated from structured fields.

import { confidenceTier, metricLabel, type AnalysisResult, type Metric } from '../types/analysis';

export const DELTA_CONFIDENCE_THRESHOLD = 0.6;

export interface MetricPoint {
  uploadId: string;
  createdAt: string;
  metric: Metric;
}

export interface MetricDelta {
  key: string;
  label: string;
  unit: string;
  from: number;
  to: number;
  delta: number;
  direction: 'improve' | 'regress' | 'flat';
  /** False when either endpoint is below the confidence threshold. */
  comparable: boolean;
  reason?: string; // why a delta is not comparable
}

/** Did the metric move toward its normal range (improve) or away (regress)? */
function classify(from: number, to: number, normalRange?: [number, number]): MetricDelta['direction'] {
  if (Math.abs(to - from) < 1e-6) return 'flat';
  if (!normalRange) return to > from ? 'improve' : 'regress';
  const [lo, hi] = normalRange;
  const target = (lo + hi) / 2;
  const before = Math.abs(from - target);
  const after = Math.abs(to - target);
  if (Math.abs(before - after) < 1e-6) return 'flat';
  return after < before ? 'improve' : 'regress';
}

/**
 * Compute the "since last upload" delta for one metric across the two most
 * recent uploads. Only fires when BOTH endpoints clear the confidence threshold
 * (honest deltas only).
 */
export function computeDelta(previous: Metric, current: Metric): MetricDelta {
  const comparable =
    previous.measured.confidence >= DELTA_CONFIDENCE_THRESHOLD &&
    current.measured.confidence >= DELTA_CONFIDENCE_THRESHOLD;
  const from = previous.measured.value;
  const to = current.measured.value;
  return {
    key: current.key,
    label: metricLabel(current.key),
    unit: current.unit,
    from,
    to,
    delta: Math.round((to - from) * 10) / 10,
    direction: classify(from, to, current.normalRange),
    comparable,
    reason: comparable
      ? undefined
      : 'Not enough confidence to compare yet — re-film at 120fps with more light; a slight oblique angle helps confirm.',
  };
}

/** "Since last upload" deltas across the two latest results. */
export function sinceLastUpload(history: AnalysisResult[]): MetricDelta[] {
  if (history.length < 2) return [];
  const [previous, current] = history.slice(-2);
  const prevByKey = new Map(previous.metrics.map((m) => [m.key, m]));
  const deltas: MetricDelta[] = [];
  for (const m of current.metrics) {
    const p = prevByKey.get(m.key);
    if (p) deltas.push(computeDelta(p, m));
  }
  return deltas;
}

/** The single primary flaw to work this week (highest severity in latest upload). */
export function primaryFlaw(history: AnalysisResult[]) {
  const latest = history[history.length - 1];
  if (!latest || latest.flaws.length === 0) return undefined;
  return [...latest.flaws].sort((a, b) => b.severity - a.severity)[0];
}

/** Build a per-metric trend series from the upload history (PROMPT F.6). */
export function trendSeries(history: AnalysisResult[], key: string): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (const result of history) {
    const metric = result.metrics.find((m) => m.key === key);
    if (metric) out.push({ uploadId: result.id, createdAt: result.createdAt, metric });
  }
  return out;
}

/** Personal-best index in a series: the point closest to the normal-range center. */
export function personalBestIndex(series: MetricPoint[]): number {
  if (series.length === 0) return -1;
  const nr = series[0].metric.normalRange;
  if (!nr) {
    // No range: PB = max value.
    let best = 0;
    series.forEach((p, i) => {
      if (p.metric.measured.value > series[best].metric.measured.value) best = i;
    });
    return best;
  }
  const target = (nr[0] + nr[1]) / 2;
  let best = 0;
  series.forEach((p, i) => {
    if (Math.abs(p.metric.measured.value - target) < Math.abs(series[best].metric.measured.value - target)) best = i;
  });
  return best;
}

/** Delta vs the very first (baseline) upload for a focus metric (PROMPT F.6). */
export function deltaVsBaseline(history: AnalysisResult[], key: string): MetricDelta | undefined {
  const series = trendSeries(history, key);
  if (series.length < 2) return undefined;
  return computeDelta(series[0].metric, series[series.length - 1].metric);
}

/** Next-checkpoint prompt after N sessions (PROMPT F.5/F.6 re-test loop). */
export function nextCheckpoint(sessionsSinceBaseline: number, cadence = 3): { due: boolean; sessionsLeft: number } {
  const sessionsLeft = Math.max(0, cadence - (sessionsSinceBaseline % cadence || cadence));
  return { due: sessionsSinceBaseline > 0 && sessionsSinceBaseline % cadence === 0, sessionsLeft };
}

/** Map a flaw id (`flaw-trunk-lean`) to its metric key (`trunk_lean`). */
export function flawIdToMetric(flawId?: string): string | undefined {
  if (!flawId) return undefined;
  return flawId.replace(/^flaw-/, '').replace(/-/g, '_');
}

/**
 * F.5/F.6 task 3 — suggest the best capture angle for the flaw being tracked.
 * Capture-agnostic: handheld while moving is always fine; this nudges oblique
 * only when a sagittal metric needs more in-plane signal.
 */
export function recommendedRetestCapture(flawId?: string, metricKey?: string): string {
  const key = metricKey ?? flawIdToMetric(flawId);
  const tips: Record<string, string> = {
    trunk_lean:
      'Film from roughly 30–45° off your running line so trunk lean is in-plane — handheld while you move is fine.',
    knee_drive:
      'A slight oblique angle (~30°) keeps both knees visible while you hold the phone.',
    hip_extension:
      'Turn about 30° toward side-on so hip extension is visible — handheld while you move is fine.',
    contact_time_ms:
      'Keep full body in frame at 120fps; a side-ish angle helps foot contacts stay visible.',
    cadence_spm:
      'Handheld is fine — keep hips and feet in frame at 120fps for cadence.',
  };
  return (
    tips[key ?? ''] ??
    'Re-film at 120fps with your full stride in frame — any angle works; a slight oblique helps if confidence was low.'
  );
}

export { confidenceTier };
