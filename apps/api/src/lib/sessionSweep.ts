import { sealInactiveSessions } from '../db/queries.js';

let intervalId: NodeJS.Timeout | null = null;

export function startSessionSweepJob(intervalMs = 3_600_000): void {
  if (intervalId) return;

  console.log('[Session Sweep] Starting inactive session sealer...');
  intervalId = setInterval(async () => {
    try {
      const sealedCount = await sealInactiveSessions();
      if (sealedCount > 0) {
        console.log(`[Session Sweep] Sealed ${sealedCount} inactive coach session(s).`);
      }
    } catch (err) {
      console.error('[Session Sweep] Error sealing inactive sessions:', err);
    }
  }, intervalMs);
}

export function stopSessionSweepJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Session Sweep] Stopped.');
  }
}
