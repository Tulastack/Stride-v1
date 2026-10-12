/** Capture usability and validation trust are separate: usable candidates may
 * be shown, but only reliable, explicitly trusted readings may drive faults. */
export function usableReading(result: any, metric: any): boolean {
  return Number.isFinite(metric?.measured?.value)
    && Number.isFinite(metric?.measured?.confidence)
    && metric.measured.confidence >= 0.35
    && result?.captureQuality?.perMetricUsable?.[metric.key] !== false;
}

export function trustedReading(result: any, metric: any): boolean {
  return usableReading(result, metric) && metric.trustStatus === 'trusted'
    && metric.measured.confidence >= 0.5;
}

export function groundedResult(result: any): any {
  if (!result) return null;
  const metrics = result.metrics ?? [];
  const trusted = new Set(metrics.filter((m: any) => trustedReading(result, m)).map((m: any) => m.key));
  const flaws = (result.flaws ?? []).filter((f: any) => {
    const key = f.id?.replace(/^flaw-/, '').replace(/-/g, '_');
    return trusted.has(key) && Number.isFinite(f.evidence?.measured?.value)
      && f.evidence.measured.confidence >= 0.5;
  });
  return { ...result, flaws, recommendations: (result.recommendations ?? []).filter((r: any) => flaws.some((f: any) => f.id === r.flawId)), metrics: metrics.filter((m: any) => usableReading(result, m)),
    focusAreas: (result.focusAreas ?? []).filter((f: any) =>
      metrics.some((m: any) => m.key === f.key && usableReading(result, m))) };
}

/** Re-check stored reports too: fixing the producer does not repair historical
 * experimental flaws. Keep all measured rows so the UI can label/withhold them. */
export function applyReportTrust(result: any): any {
  if (!result || !Array.isArray(result.metrics)) return result;
  const grounded = groundedResult(result);
  const changed = grounded.flaws.length !== (result.flaws ?? []).length;
  return { ...result, flaws: grounded.flaws, recommendations: grounded.recommendations,
    focusAreas: grounded.focusAreas,
    summary: changed ? 'Review the usable measurements and tentative focus areas. Withheld readings do not establish a confirmed fault.' : result.summary };
}
