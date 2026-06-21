import { Router } from 'express';
import type { Response, NextFunction } from 'express';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { getUserBySupabaseUid, createUser, getAnalysis } from '../db/queries.js';
import { sseManager } from '../lib/sse.js';

const router = Router();

/**
 * SSE-compatible JWT auth via query token (same pattern as videos.ts /stream)
 */
async function authenticateSSE(req: any, res: Response, next: NextFunction): Promise<void> {
  const token = req.query.token as string;
  if (!token) {
    res.status(401).json({ error: 'Missing token in query parameters' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const jwksUrl = new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  const JWKS = createRemoteJWKSet(jwksUrl);

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `${SUPABASE_URL}/auth/v1`,
      audience: 'authenticated',
    });

    const supabaseUid = payload.sub;
    if (!supabaseUid) {
      res.status(401).json({ error: 'Token missing subject claim' });
      return;
    }

    const email = (payload.email as string) ?? '';
    let user = await getUserBySupabaseUid(supabaseUid);
    if (!user) {
      user = await createUser(supabaseUid, email);
    }

    req.userId = user.id;
    req.supabaseUid = supabaseUid;
    next();
  } catch (err) {
    console.error('SSE JWT verification failed:', err);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * GET /analyses/:analysisId/progress — SSE stream for single analysis progress.
 * If analysis is already completed/failed, sends a terminal event and closes immediately.
 * Otherwise, subscribes the client and removes on disconnect.
 */
router.get('/:analysisId/progress', authenticateSSE, async (req: any, res: Response) => {
  const { analysisId } = req.params;
  const userId = req.userId;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Write initial handshake
  res.write(': connected\n\n');

  // Check current analysis status
  let analysis;
  try {
    analysis = await getAnalysis(analysisId, userId);
  } catch (err) {
    console.error(`[analyses/progress] DB error for analysis ${analysisId}:`, err);
    const errPayload = JSON.stringify({ analysisId, stage: 'failed', pct: 0, message: 'Internal error' });
    res.write(`event: progress\ndata: ${errPayload}\n\n`);
    res.end();
    return;
  }

  if (!analysis) {
    const notFoundPayload = JSON.stringify({ analysisId, stage: 'failed', pct: 0, message: 'Analysis not found' });
    res.write(`event: progress\ndata: ${notFoundPayload}\n\n`);
    res.end();
    return;
  }

  // If already in a terminal state, send terminal event and close
  if (analysis.status === 'completed') {
    const payload = JSON.stringify({ analysisId, stage: 'complete', pct: 100 });
    res.write(`event: progress\ndata: ${payload}\n\n`);
    res.end();
    return;
  }

  if (analysis.status === 'failed') {
    const payload = JSON.stringify({
      analysisId,
      stage: 'failed',
      pct: 0,
      message: analysis.error_message ?? 'Analysis failed',
    });
    res.write(`event: progress\ndata: ${payload}\n\n`);
    res.end();
    return;
  }

  // Still in progress — subscribe client to SSE updates
  sseManager.addConnection(userId, res);
});

export default router;
