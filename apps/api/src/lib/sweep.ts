import { sweepStuckAnalyses, sweepExpiredSuggestions } from '../db/queries.js';

let analysisIntervalId: NodeJS.Timeout | null = null;
let suggestionsIntervalId: NodeJS.Timeout | null = null;

export function startSweepJob(intervalMs = 60000): void {
  if (analysisIntervalId) return;

  console.log('[Sweep Job] Starting stuck analyses sweep job...');
  analysisIntervalId = setInterval(async () => {
    try {
      const sweptCount = await sweepStuckAnalyses();
      if (sweptCount > 0) {
        console.log(`[Sweep Job] Successfully swept ${sweptCount} stuck analyses.`);
      }
    } catch (err) {
      console.error('[Sweep Job] Error running stuck analyses sweep:', err);
    }
  }, intervalMs);

  console.log('[Sweep Job] Starting expired suggestions sweep job (every 12 hours)...');
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  suggestionsIntervalId = setInterval(async () => {
    try {
      const sweptCount = await sweepExpiredSuggestions();
      if (sweptCount > 0) {
        console.log(`[Sweep Job] Successfully swept ${sweptCount} expired suggestions.`);
      }
    } catch (err) {
      console.error('[Sweep Job] Error running expired suggestions sweep:', err);
    }
  }, twelveHoursMs);
}

export function stopSweepJob(): void {
  if (analysisIntervalId) {
    clearInterval(analysisIntervalId);
    analysisIntervalId = null;
    console.log('[Sweep Job] Stuck analyses sweep stopped.');
  }
  if (suggestionsIntervalId) {
    clearInterval(suggestionsIntervalId);
    suggestionsIntervalId = null;
    console.log('[Sweep Job] Expired suggestions sweep stopped.');
  }
}
