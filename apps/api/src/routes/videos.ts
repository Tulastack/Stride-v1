import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireConsent } from '../middleware/consent.js';
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
});

// Custom helper for query token authentication in SSE
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
    const { analysisId, uploadId, parts } = finalizeSchema.parse(req.body);
    const userId = req.userId;

    // Verify analysis exists and belongs to the user
    const analysis = await getAnalysis(analysisId, userId);
    if (!analysis) {
      res.status(404).json({ error: 'Analysis not found' });
      return;
    }

    // Complete S3 multipart upload
    await completeMultipartUpload(analysis.s3_key, uploadId, parts);

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
