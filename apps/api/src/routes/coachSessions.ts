import { Router } from 'express';
import { z } from 'zod';
import type { Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  createCoachSession,
  getCoachSession,
  getCoachSessionsByUser,
  touchCoachSession,
  sealCoachSession,
  getAnalysisByIdOnly,
} from '../db/queries.js';

const router = Router();

const createSessionSchema = z.object({
  session_type: z.enum(['analysis_workflow', 'free_coach']),
  analysis_id: z.string().uuid().optional().nullable(),
});

import { generateCoachReply, buildAnalysisContext } from '../lib/coach.js';

const messageSchema = z.object({
  content: z.string().min(1).max(5000),
  action_chip: z
    .enum(['why_is_this_an_issue', 'mark_understood', 'show_drill', 'ask_coach', 'view_timeline'])
    .optional()
    .nullable(),
});

/**
 * GET /coach-sessions — get all sessions for user
 */
router.get('/', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId as string;
    const sessions = await getCoachSessionsByUser(userId);
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /coach-sessions — create a new coach session
 */
router.post('/', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { session_type, analysis_id } = createSessionSchema.parse(req.body);
    const userId = req.userId as string;

    if (analysis_id) {
      const analysis = await getAnalysisByIdOnly(analysis_id);
      if (!analysis || analysis.user_id !== userId) {
        res.status(404).json({ error: 'Analysis not found' });
        return;
      }
    }

    const session = await createCoachSession(userId, session_type, analysis_id ?? null);
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /coach-sessions/:id — get a session
 */
router.get('/:id', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId as string;

    const session = await getCoachSession(id, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(session);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /coach-sessions/:id/message — send a message to the session
 */
router.post('/:id/message', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId as string;
    const { content, action_chip } = messageSchema.parse(req.body);

    const session = await getCoachSession(id, userId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.status === 'closed') {
      res.status(409).json({ code: 'SESSION_CLOSED' });
      return;
    }

    // ── analysis_workflow: handle built-in action chips (no LLM) ──
    if (session.session_type === 'analysis_workflow' && action_chip) {
      switch (action_chip) {
        case 'mark_understood': {
          await sealCoachSession(id);
          res.json({ sealed: true });
          return;
        }

        case 'why_is_this_an_issue': {
          // Pull canned text from result_json
          let responseText = 'No analysis linked to this session.';
          if (session.analysis_id) {
            const analysis = await getAnalysisByIdOnly(session.analysis_id);
            if (analysis?.result_json) {
              const result = analysis.result_json as any;
              const issues = result.primary_issues as any[] | undefined;
              if (issues && issues.length > 0) {
                responseText = issues
                  .map(
                    (issue: any) =>
                      `[${issue.type}] ${issue.plain_english ?? 'No description available.'}`,
                  )
                  .join('\n\n');
              } else {
                responseText = 'No issues found in the analysis.';
              }
            }
          }
          await touchCoachSession(id);
          res.json({ content: responseText, action_chip: 'why_is_this_an_issue' });
          return;
        }

        case 'show_drill': {
          let responseText = 'No analysis linked to this session.';
          if (session.analysis_id) {
            const analysis = await getAnalysisByIdOnly(session.analysis_id);
            if (analysis?.result_json) {
              const result = analysis.result_json as any;
              const issues = result.primary_issues as any[] | undefined;
              if (issues && issues.length > 0) {
                const drills: any[] = [];
                for (const issue of issues) {
                  if (Array.isArray(issue.drills)) {
                    drills.push(...issue.drills);
                  }
                }
                if (drills.length > 0) {
                  responseText = drills
                    .map((d: any) => `• ${d.name} (${d.volume ?? 'N/A'}) — Cue: "${d.cue ?? ''}"`)
                    .join('\n');
                } else {
                  responseText = 'No drills found in the analysis.';
                }
              } else {
                responseText = 'No issues/drills found in the analysis.';
              }
            }
          }
          await touchCoachSession(id);
          res.json({ content: responseText, action_chip: 'show_drill' });
          return;
        }

        case 'view_timeline': {
          // Frontend handles navigation — return nothing meaningful
          await touchCoachSession(id);
          res.json({ action_chip: 'view_timeline' });
          return;
        }

        case 'ask_coach':
          // Falls through to Gemini call below
          break;
      }
    }

    // ── free_coach or ask_coach chip: Groq coach, GROUNDED in the athlete's
    //    latest analysis and scoped to form / training / nutrition / recovery ──
    const { getAnalysesByUser } = await import('../db/queries.js');
    const analyses = await getAnalysesByUser(req.userId);
    const grounding = session.analysis_id
      ? analyses.find((a: any) => a.id === session.analysis_id)
      : analyses.find((a: any) => a.status === 'completed' && a.result_json);
    const analysisContext = buildAnalysisContext(
      (grounding?.result_json as any) ?? null,
      req.user,
    );

    const assistantText = await generateCoachReply({
      analysisContext,
      userMessage: content,
    });

    await touchCoachSession(id);
    res.json({ role: 'assistant', content: assistantText });
  } catch (err) {
    next(err);
  }
});

export default router;
