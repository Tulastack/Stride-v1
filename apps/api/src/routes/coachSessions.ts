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

    // ── free_coach or ask_coach chip: call Gemini ──
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not configured');
    }

    const systemInstruction = `You are "Stride Coach", an elite sprint coach and expert biomechanist.
Your goal is to guide solo athletes on improving their sprinting form using structured, biomechanically-driven advice.
Keep your tone encouraging, direct, and authoritative yet supportive. Focus on giving action-oriented feedback.
When discussing drills, specify exactly what cues to keep in mind.`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: content }] }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API request failed:', errText);
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const resJson = (await response.json()) as any;
    const assistantText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!assistantText) {
      throw new Error('No text content returned from Gemini API');
    }

    await touchCoachSession(id);
    res.json({ role: 'assistant', content: assistantText });
  } catch (err) {
    next(err);
  }
});

export default router;
