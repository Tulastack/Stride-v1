import { Router } from 'express';
import express from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireConsent } from '../middleware/consent.js';
import { isLocalStorage, writeLocalBlob, writeLocalJson, PUBLIC_API_URL } from '../lib/storage.js';
import type { AuthenticatedRequest } from '../types.js';
import {
  createAnalysis,
  getAnalysis,
  getAnalysesByUser,
} from '../db/queries.js';
import {
  initiateMultipartUpload,
  generatePresignedPartUrls,
  completeMultipartUpload,
  putJsonSidecar,
} from '../lib/s3.js';
import { enqueueAnalysis } from '../lib/sqs.js';
import { sseManager } from '../lib/sse.js';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { getUserBySupabaseUid, createUser } from '../db/queries.js';

const router = Router();

// Zod schemas for validation
const uploadUrlSchema = z.object({
  numParts: z.number().int().min(1).max(100),
});

const finalizeSchema = z.object({
  analysisId: z.string().uuid(),
  uploadId: z.string(),
  parts: z.array(
    z.object({
      partNumber: z.number().int().min(1),
      etag: z.string(),
    })
  ),
  captureManifest: z.record(z.unknown()).optional(),
});

// Token auth from a query param OR Authorization header (used by SSE and the
// local blob-upload endpoint, whose URL carries the token so the client needs
// no extra headers — the same way S3 presigned URLs are self-authenticating).
async function authenticateSSE(req: any, res: Response, next: NextFunction): Promise<void> {
  const headerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = (req.query.token as string) || headerToken;
  if (!token) {
    res.status(401).json({ error: 'Missing token' });
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
 * 1. Request presigned multipart upload URLs
 */
router.post('/upload-url', authenticate, requireConsent, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { numParts } = uploadUrlSchema.parse(req.body);
    const userId = req.userId;

    // First generate a unique analysis ID
    // Key structure: uploads/{userId}/{analysisId}.mp4
    const s3KeyDummy = `uploads/${userId}/temp.mp4`; // we'll update with proper analysis ID
    const analysis = await createAnalysis(userId, s3KeyDummy);
    const analysisId = analysis.id;

    const actualS3Key = `uploads/${userId}/${analysisId}.mp4`;

    // ── Local storage: return a single upload URL pointing back at this API.
    // The URL carries the caller's token so the plain PUT is self-authenticating
    // (mirrors an S3 presigned URL — the mobile client sends no extra headers).
    if (isLocalStorage) {
      const { pool } = await import('../db/queries.js');
      await pool.query('UPDATE analyses SET s3_key = $1 WHERE id = $2', [actualS3Key, analysisId]);
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : '';
      res.json({
        analysisId,
        uploadId: 'local',
        parts: [{
          partNumber: 1,
          url: `${PUBLIC_API_URL}/videos/${analysisId}/blob?token=${encodeURIComponent(bearer)}`,
        }],
      });
      return;
    }
    // We update the analysis key to be the proper path (using a custom direct query or standard behavior,
    // actually our updateAnalysisStatus handles updating fields, let's keep it clean by inserting the correct key
    // immediately if possible, but since we need analysisId first, let's execute a quick query or let's create a custom update key query if we need to).
    // Let's just update the key. Oh, in queries.ts, we don't have a direct "updateAnalysisKey" function, but we can do a direct query.
    const { pool } = await import('../db/queries.js');
    await pool.query('UPDATE analyses SET s3_key = $1 WHERE id = $2', [actualS3Key, analysisId]);

    // Initiate multipart upload in S3
    const uploadId = await initiateMultipartUpload(actualS3Key);

    // Generate part URLs
    const parts = await generatePresignedPartUrls(actualS3Key, uploadId, numParts);

    res.json({
      analysisId,
      uploadId,
      parts,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2. Finalize the multipart upload and enqueue for processing
 */
router.post('/finalize', authenticate, requireConsent, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId, uploadId, parts, captureManifest } = finalizeSchema.parse(req.body);
    const userId = req.userId;

    // Verify analysis exists and belongs to the user
    const analysis = await getAnalysis(analysisId, userId);
    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found' });
      return;
    }

    if (isLocalStorage) {
      // Bytes were already written by PUT /videos/:id/blob. Just drop the
      // capture sidecar next to the video; the worker's DB poller picks it up.
      if (captureManifest) {
        await writeLocalJson(
          analysis.s3_key.replace(/\.[^.]+$/, '') + '.capture.json',
          captureManifest,
        );
      }
      res.json({ ...analysis, status: 'pending' });
      return;
    }

    // Complete S3 multipart upload
    await completeMultipartUpload(analysis.s3_key, uploadId, parts);

    // Stage 0 capture sidecar (gyro + intrinsics) for the biomechanics engine
    if (captureManifest) {
      await putJsonSidecar(analysis.s3_key, '.capture.json', captureManifest);
    }

    // Enqueue to SQS for processing
    await enqueueAnalysis(analysisId, analysis.s3_key);

    res.json({
      ...analysis,
      status: 'pending',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 2b. Local-storage blob upload target (Docker-free dev). The phone PUTs the
 * raw video bytes here; we write them to the shared local dir the worker reads.
 */
router.put(
  '/:analysisId/blob',
  authenticateSSE, // token via ?token= or Authorization header (consent already enforced at upload-url)
  express.raw({ type: '*/*', limit: '500mb' }),
  async (req: any, res: Response, next: NextFunction) => {
    try {
      if (!isLocalStorage) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const { analysisId } = req.params;
      const analysis = await getAnalysis(analysisId, req.userId);
      if (!analysis) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
      }
      const body: Buffer = req.body;
      if (!body || !body.length) {
        res.status(400).json({ error: 'Empty upload body' });
        return;
      }
      await writeLocalBlob(analysis.s3_key, body);
      res.set('ETag', `"local-${analysisId}"`).status(200).json({ ok: true, bytes: body.length });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * 3. SSE stream endpoint
 */
router.get('/stream', authenticateSSE, (req: any, res: Response) => {
  const userId = req.userId;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Write initial handshake
  res.write(': connected\n\n');

  sseManager.addConnection(userId, res);
});

/**
 * 4. List analyses of the user
 */
router.get('/', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    const analyses = await getAnalysesByUser(userId);
    res.json(analyses);
  } catch (err) {
    next(err);
  }
});

/**
 * 5. Get specific analysis details
 */
router.get('/:analysisId', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId } = req.params;
    const userId = req.userId;

    const analysis = await getAnalysis(analysisId, userId);
    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found' });
      return;
    }

    res.json(analysis);
  } catch (err) {
    next(err);
  }
});

export default router;
