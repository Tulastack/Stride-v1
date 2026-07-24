import { Router } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import type { Response, NextFunction } from 'express';
import { updateAnalysisStatus, getAnalysisByIdOnly, createDrillSuggestions, createMetricsFromAnalysis } from '../db/queries.js';
import { sseManager, broadcastProgress } from '../lib/sse.js';
import { assembleAnalysisFromFrames } from '../analysis/engine/engine.js';
import { validateAnalysisResult } from '../analysis/validate.js';
import type { ReconstructionMethod } from '@stride/types';

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

  // FAIL CLOSED: /internal/* can forge analysis results for any user. A
  // missing secret must lock these routes, never open them.
  if (!internalSecret) {
    console.error('INTERNAL_API_SECRET is not set — rejecting internal callback. Configure it on both the API and the ML worker.');
    res.status(503).json({ error: 'Internal callbacks are not configured' });
    return;
  }

  const given = Buffer.from(typeof secretHeader === 'string' ? secretHeader : '');
  const expected = Buffer.from(internalSecret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
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

    // Persist the model identity the worker ACTUALLY ran (bug B3): the worker
    // threads a backend-derived model_meta into result_json. Fall back to a
    // 2D-pipeline label rather than the old hardcoded MoveNet "Thunder".
    const modelVersion =
      ((resultJson as any)?.model_meta?.model_version as string | undefined) ?? 'rtmpose-2d';

    // Update database status and metrics
    const updatedAnalysis = await updateAnalysisStatus(analysisId, {
      status,
      overall_score: overallScore,
      result_json: resultJson,
      error_message: errorMessage,
      movenet_version: modelVersion,
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

    // Auto-create metrics timeline rows from result_json
    if (status === 'completed' && resultJson) {
      try {
        const metricsRows = await createMetricsFromAnalysis(updatedAnalysis.user_id, analysisId, resultJson);
        console.log(`[Internal Callback] Created ${metricsRows.length} metric(s) for analysis ${analysisId}`);
      } catch (metricsErr) {
        console.error('[Internal Callback] Failed to create metrics timeline rows:', metricsErr);
      }
    }

    // Auto-create drill suggestions from result_json (no calendar_events)
    if (status === 'completed' && resultJson) {
      try {
        const result = resultJson as any;
        const suggestions: {
          analysis_id: string;
          user_id: string;
          drill_key: string;
          drill_name: string;
          suggested_date: string;
        }[] = [];

        const today = new Date();
        let dayOffset = 1;
        const pushSuggestion = (drillKey: string, drillName: string) => {
          const suggestedDate = new Date(today);
          suggestedDate.setDate(today.getDate() + dayOffset);
          suggestions.push({
            analysis_id: analysisId,
            user_id: updatedAnalysis.user_id,
            drill_key: drillKey,
            drill_name: drillName,
            suggested_date: suggestedDate.toISOString().split('T')[0]!,
          });
          dayOffset++;
        };

        // 2D sagittal pipeline shape: result.recommendations (DrillRec[]).
        for (const rec of (result.recommendations ?? []) as any[]) {
          pushSuggestion(
            rec.drillId ?? rec.drillName?.toLowerCase().replace(/\s+/g, '_') ?? `drill_${dayOffset}`,
            rec.drillName ?? 'Drill',
          );
        }
        // Legacy 3D shape: result.primary_issues[].drills.
        for (const issue of (result.primary_issues ?? []) as any[]) {
          for (const drill of (issue.drills ?? []) as any[]) {
            pushSuggestion(
              drill.key ?? drill.name?.toLowerCase().replace(/\s+/g, '_') ?? `drill_${dayOffset}`,
              drill.name ?? 'Drill',
            );
          }
        }

        if (suggestions.length > 0) {
          await createDrillSuggestions(suggestions);
          console.log(`[Internal Callback] Created ${suggestions.length} drill suggestion(s) for analysis ${analysisId}`);
        }
      } catch (suggErr) {
        console.error('[Internal Callback] Failed to create drill suggestions:', suggErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const progressSchema = z.object({
  analysisId: z.string().uuid(),
  stage: z.enum([
    'queued',
    'downloading',
    'pose_extraction',
    'wham_reconstruction',
    'skeleton_fit',
    'biomechanics_calculation',
    'llm_structuring',
    'finalizing',
    'complete',
    'failed',
  ]),
  pct: z.number().int().min(0).max(100),
  message: z.string().max(500).optional(),
});

/**
 * 2. Stage progress events from the ML worker
 * POST /internal/analysis-progress — body: { analysisId, stage, pct, message? }
 */
router.post('/analysis-progress', verifyInternalSecret, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId, stage, pct, message } = progressSchema.parse(req.body);

    console.log(`[Internal Progress] analysis ${analysisId}: stage=${stage} pct=${pct}`);

    // Look up the analysis to get the userId for broadcasting
    const analysis = await getAnalysisByIdOnly(analysisId);
    if (!analysis) {
      res.status(404).json({ error: `Analysis ${analysisId} not found in DB` });
      return;
    }

    broadcastProgress(analysis.user_id, analysisId, stage, pct, message);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const frame3dSchema = z.object({
  timestampMs: z.number(),
  pose: z.record(z.string(), z.tuple([z.number(), z.number(), z.number()])),
  keypointConfidence: z.number(),
  reconResidual: z.number(),
});

const biomechSchema = z.object({
  analysisId: z.string().uuid(),
  pipeline3d: z.object({
    frames: z.array(frame3dSchema).min(1),
    fps: z.number().positive(),
    cameraAzimuthDeg: z.number(),
    reconstructionMethod: z.enum(['2d', '3d-mono', '3d-multi']).optional(),
    meanKeypointConfidence: z.number().min(0).max(1),
    meanReconResidual: z.number().nonnegative(),
    motionBlur: z.enum(['low', 'med', 'high']).optional(),
    framing: z.enum(['full', 'partial']).optional(),
    stage2Backend: z.string().optional(),
    stage3Backend: z.string().optional(),
  }),
});

/**
 * 3. WHAM + OpenCap pipeline output → PRD v2.2 AnalysisResult (Stages 4–7 on API).
 * POST /internal/analysis-biomech
 *
 * DORMANT IN PRODUCTION, NOT DELETED: only ever called by ml-worker's WHAM
 * branch (apps/ml-worker/src/worker.py, _process_wham_opencap), which only
 * runs when that worker is started with STRIDE_PIPELINE=wham. No deployment
 * config in this repo sets that — every real environment defaults to the 2D
 * path (biomech2d.py), which never calls this route. Kept live and working
 * intentionally so the 3D pipeline stays exercisable without deleting code;
 * flip STRIDE_PIPELINE=wham on the worker to actually activate it.
 */
router.post('/analysis-biomech', verifyInternalSecret, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { analysisId, pipeline3d } = biomechSchema.parse(req.body);
    const analysis = await getAnalysisByIdOnly(analysisId);
    if (!analysis) {
      res.status(404).json({ error: `Analysis ${analysisId} not found in DB` });
      return;
    }

    const clipId = analysisId.slice(0, 8);
    const result = assembleAnalysisFromFrames({
      clipId,
      fps: pipeline3d.fps,
      frames: pipeline3d.frames as unknown as import('../analysis/engine/types.js').Frame3D[],
      cameraAzimuthDeg: pipeline3d.cameraAzimuthDeg,
      motionBlur: pipeline3d.motionBlur ?? 'med',
      framing: pipeline3d.framing ?? 'full',
      meanKeypointConfidence: pipeline3d.meanKeypointConfidence,
      meanReconResidual: pipeline3d.meanReconResidual,
      reconstructionMethod: (pipeline3d.reconstructionMethod ?? '3d-multi') as ReconstructionMethod,
    });

    validateAnalysisResult(result);

    // overall_score = the form score users see (falls back to capture quality
    // only when the engine produced no economyScore).
    const overallScore = Math.round(
      (result as { economyScore?: number }).economyScore ?? result.captureQuality.overall * 100,
    );
    const updatedAnalysis = await updateAnalysisStatus(analysisId, {
      status: 'completed',
      overall_score: overallScore,
      result_json: result as unknown as Record<string, unknown>,
      movenet_version: `wham+opencap/${pipeline3d.stage2Backend ?? 'wham'}`,
    });

    if (!updatedAnalysis) {
      res.status(404).json({ error: `Analysis ${analysisId} not found in DB` });
      return;
    }

    sseManager.sendEvent(updatedAnalysis.user_id, {
      analysisId,
      data: {
        status: 'completed',
        overall_score: overallScore,
        result_json: result as unknown as Record<string, unknown>,
        completed_at: updatedAnalysis.completed_at?.toISOString() ?? null,
      },
    });

    try {
      await createMetricsFromAnalysis(updatedAnalysis.user_id, analysisId, result as unknown as Record<string, unknown>);
    } catch (metricsErr) {
      console.error('[Internal Biomech] metrics timeline failed:', metricsErr);
    }

    try {
      const suggestions = result.recommendations.map((rec, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i + 1);
        return {
          analysis_id: analysisId,
          user_id: updatedAnalysis.user_id,
          drill_key: rec.drillId,
          drill_name: rec.drillName,
          suggested_date: d.toISOString().split('T')[0]!,
        };
      });
      if (suggestions.length) await createDrillSuggestions(suggestions);
    } catch (suggErr) {
      console.error('[Internal Biomech] drill suggestions failed:', suggErr);
    }

    res.json({ success: true, resultId: result.id });
  } catch (err) {
    next(err);
  }
});

export default router;
