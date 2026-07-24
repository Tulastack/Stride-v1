// Parse live analysis rows from the API — no fixture fallbacks in production code.

import type { AnalysisResult } from '../types/analysis';
import { strideApi } from '../services/api';

export interface AnalysisRow {
  id: string;
  status: 'uploading' | 'pending' | 'processing' | 'completed' | 'failed';
  result_json?: AnalysisResult | null;
  error_message?: string | null;
  created_at?: string;
  overall_score?: number | null;
}

/** Validate the PRD v2.2 contract shape. */
export function isAnalysisResult(data: unknown): data is AnalysisResult {
  if (!data || typeof data !== 'object') return false;
  const d = data as AnalysisResult;
  return (
    Array.isArray(d.flaws) &&
    Array.isArray(d.metrics) &&
    typeof d.summary === 'string' &&
    d.captureQuality != null &&
    typeof d.reconstructionMethod === 'string'
  );
}

/** Extract AnalysisResult from a GET /videos/:id row or a bare result. */
export function parseAnalysisResult(row: unknown): AnalysisResult | null {
  if (isAnalysisResult(row)) return row;
  if (!row || typeof row !== 'object') return null;
  const nested = (row as AnalysisRow).result_json;
  return isAnalysisResult(nested) ? nested : null;
}

/** Fetch completed analyses as AnalysisResult history (newest last). */
export async function fetchAnalysisHistory(): Promise<AnalysisResult[]> {
  const rows = (await strideApi.listAnalyses()) as AnalysisRow[];
  const results: AnalysisResult[] = [];
  for (const row of rows) {
    if (row.status !== 'completed') continue;
    const result = parseAnalysisResult(row);
    if (result) results.push({ ...result, id: result.id || row.id });
  }
  results.sort((a, b) => {
    const ta = a.createdAt ?? '';
    const tb = b.createdAt ?? '';
    return ta.localeCompare(tb);
  });
  return results;
}

/** Thrown when a caller cancels waitForAnalysisResult (e.g. screen unmounted). */
export class CancelledError extends Error {
  constructor() {
    super('Polling cancelled');
    this.name = 'CancelledError';
  }
}

/** Poll until analysis completes or fails. Pass `isCancelled` to stop the loop
 * early (a CancelledError is thrown so callers can bail silently). */
export async function waitForAnalysisResult(
  analysisId: string,
  opts: { intervalMs?: number; timeoutMs?: number; isCancelled?: () => boolean } = {}
): Promise<{ status: AnalysisRow['status']; result?: AnalysisResult; error?: string }> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) throw new CancelledError();
    const row = (await strideApi.getAnalysis(analysisId)) as AnalysisRow;
    if (opts.isCancelled?.()) throw new CancelledError();
    if (row.status === 'failed') {
      return { status: 'failed', error: row.error_message ?? 'Analysis failed' };
    }
    if (row.status === 'completed') {
      const result = parseAnalysisResult(row);
      if (!result) {
        return { status: 'failed', error: 'Completed analysis missing a valid result' };
      }
      return { status: 'completed', result };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: 'pending', error: 'Timed out waiting for analysis' };
}
