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

import { generateCoachReply, buildAnalysisContext, runTrackCoach, buildCoachTools } from '../lib/coach.js';

const messageSchema = z.object({
  content: z.string().min(1).max(5000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).optional(),
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
    const { content, history, action_chip } = messageSchema.parse(req.body);

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

    // ── free_coach or ask_coach chip: the AGENTIC track coach. It is grounded
    //    in the athlete's latest analysis and can call tools (knowledge base,
    //    metrics, trends, reference drills, current plan) before answering. If
    //    the agent path fails, degrade to the single-shot grounded reply. ──
    const {
      getAnalysesByUser,
      getMetricsTrend,
      getReferenceDrill,
      getCalendarEvents,
    } = await import('../db/queries.js');
    const analyses = await getAnalysesByUser(req.userId);
    const grounding = session.analysis_id
      ? analyses.find((a: any) => a.id === session.analysis_id)
      : analyses.find((a: any) => a.status === 'completed' && a.result_json);
    const analysisContext = buildAnalysisContext(
      (grounding?.result_json as any) ?? null,
      req.user,
    );

    const toolset = buildCoachTools({
      userId: req.userId,
      profile: req.user ?? null,
      deps: { getAnalysesByUser, getMetricsTrend, getReferenceDrill, getCalendarEvents },
    });

    let assistantText: string;
    const progress: string[] = [];
    try {
      assistantText = await runTrackCoach({
        userMessage: content,
        analysisContext,
        history: history ?? [],
        toolset,
        onProgress: (ev) => { progress.push(ev.label); },
      });
    } catch (agentErr) {
      console.error('Coach agent failed, falling back to single-shot reply:', agentErr);
      progress.push('Drafting your coaching plan');
      assistantText = await generateCoachReply({
        analysisContext,
        userMessage: content,
        history: history ?? [],
      });
    }

    await touchCoachSession(id);
    res.json({ role: 'assistant', content: assistantText, progress });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /coach-sessions/:id/add-to-calendar — ask LLM to generate structured
 * calendar events from the conversation, then create them.
 */
router.post('/:id/add-to-calendar', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId as string;
    const { id } = req.params;
    const { history } = req.body || {};

    const session = await getCoachSession(id, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }

    // Build context from the conversation history
    const conversationSummary = (history ?? [])
      .slice(-8)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const planPrompt = `Based on this conversation:\n${conversationSummary}\n\nGenerate a JSON array of workout/drill events for the next 2 weeks.
Each event: {"title": "string", "eventType": "drill" or "workout" or "rest", "scheduledDate": "YYYY-MM-DD", "details": {"volume": "string", "cue": "string"}}
Rules: max 2 hard days in a row, include rest days, start from tomorrow (use realistic dates starting from ${tomorrowStr}).
Output ONLY the raw JSON array. No markdown. No explanation. Just [ ... ]`;

    const { getAnalysesByUser } = await import('../db/queries.js');
    const analyses = await getAnalysesByUser(userId);
    const latest = analyses.find((a: any) => a.status === 'completed' && a.result_json);
    const analysisContext = buildAnalysisContext((latest?.result_json as any) ?? null, req.user);

    const planJson = await generateCoachReply({
      analysisContext,
      userMessage: planPrompt,
      history: history ?? [],
    });

    let events: any[];
    try {
      const cleaned = planJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      events = JSON.parse(cleaned);
      if (!Array.isArray(events)) throw new Error('Not an array');
    } catch {
      res.status(422).json({ error: 'Could not generate calendar plan. Try asking for a specific workout plan first.' });
      return;
    }

    const { createCalendarEvents } = await import('../db/queries.js');
    const dbEvents = events.map((e: any) => ({
      title: e.title || 'Workout',
      event_type: e.eventType || 'drill',
      scheduled_date: e.scheduledDate,
      details: e.details || {},
    }));

    const created = await createCalendarEvents(userId, dbEvents);
    res.json({ created: created.length, events: created });
  } catch (err) {
    next(err);
  }
});

export default router;
