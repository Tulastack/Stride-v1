import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { updateAnalysisStatus, getAnalysisByIdOnly } from '../db/queries.js';
import { sseManager } from '../lib/sse.js';

const router = Router();

const completionSchema = z.object({
  analysisId: z.string().uuid(),
  status: z.enum(['completed', 'failed']),
  overallScore: z.number().int().min(0).max(100).nullable().optional(),
  resultJson: z.record(z.any()).nullable().optional(),
  errorMessage: z.string().max(2000).nullable().optional(),
});

/**
 * Middleware to verify internal token for security
 */
function verifyInternalSecret(req: any, res: Response, next: NextFunction): void {
  const secretHeader = req.headers['x-internal-token'];
  const internalSecret = process.env.INTERNAL_API_SECRET;

  if (!internalSecret) {
    console.warn('WARNING: INTERNAL_API_SECRET is not set. Internal routes are unprotected!');
    next();
    return;
  }

  if (secretHeader !== internalSecret) {
    res.status(403).json({ error: 'Unauthorized internal callback' });
    return;
  }

  next();
}

/**
 * 1. Callback route for ML worker to report analysis completions/failures
 */
router.post('/analysis-completed', verifyInternalSecret, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId, status, overallScore, resultJson, errorMessage } = completionSchema.parse(req.body);

    console.log(`[Internal Callback] Received completion for analysis ${analysisId} (status: ${status})`);

    // Update database status and metrics
    const updatedAnalysis = await updateAnalysisStatus(analysisId, {
      status,
      overall_score: overallScore,
      result_json: resultJson,
      error_message: errorMessage,
      movenet_version: 'Thunder', // default used by worker
    });

    if (!updatedAnalysis) {
      res.status(404).json({ error: `Analysis ${analysisId} not found in DB` });
      return;
    }

    // Broadcast the status update in real-time to the active SSE connections of the user
    const success = sseManager.sendEvent(updatedAnalysis.user_id, {
      analysisId,
      data: {
        status: updatedAnalysis.status,
        overall_score: updatedAnalysis.overall_score,
        result_json: updatedAnalysis.result_json,
        error_message: updatedAnalysis.error_message,
        completed_at: updatedAnalysis.completed_at ? updatedAnalysis.completed_at.toISOString() : null,
      },
    });

    console.log(`[Internal Callback] Dispatched SSE to user ${updatedAnalysis.user_id} (delivered: ${success})`);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
