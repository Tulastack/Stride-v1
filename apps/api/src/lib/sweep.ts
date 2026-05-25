import { sweepStuckAnalyses } from '../db/queries.js';

let intervalId: NodeJS.Timeout | null = null;

export function startSweepJob(intervalMs = 60000): void {
  if (intervalId) return;

  console.log('[Sweep Job] Starting stuck analyses sweep job...');
  intervalId = setInterval(async () => {
    try {
      const sweptCount = await sweepStuckAnalyses();
      if (sweptCount > 0) {
        console.log(`[Sweep Job] Successfully swept ${sweptCount} stuck analyses.`);
      }
    } catch (err) {
      console.error('[Sweep Job] Error running stuck analyses sweep:', err);
    }
  }, intervalMs);
}

export function stopSweepJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Sweep Job] Stopped.');
  }
}
