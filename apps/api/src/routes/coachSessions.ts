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
import { isCalendarRelevant } from '../lib/coach/calendarRelevance.js';
import { routeMessage } from '../lib/coach/router.js';
import { gatherEvidence } from '../lib/coach/workflow.js';
import { finalizeReply } from '../lib/coach/reply.js';
import { CoachRateLimitError } from '../lib/coach/errors.js';
import { permissionsSchema, NO_ACCESS, appActionSchema, actionScope, signProposal, verifyProposal, dateSchema, proposalReply } from '../lib/coach/appActions.js';
import { groundedResult } from '../lib/measurementTrust.js';

const messageSchema = z.object({
  content: z.string().min(1).max(5000),
  permissions: permissionsSchema.optional(),
  today: dateSchema.optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(5000),
  })).max(50).optional(),
  action_chip: z
    .enum(['why_is_this_an_issue', 'mark_understood', 'show_drill', 'ask_coach', 'view_timeline'])
    .optional()
    .nullable(),
  // Settings that live only on the device, so the coach can read them.
  client: z.object({
    appearance: z.enum(['light', 'dark', 'system']).optional(),
    reduceMotion: z.boolean().optional(),
  }).strict().optional(),
});

/**
 * GET /coach-sessions/usage, the athlete's coach message allowance
 */
router.get('/usage', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { getCoachUsage } = await import('../db/queries.js');
    res.json(await getCoachUsage(req.userId));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /coach-sessions, get all sessions for user
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
 * POST /coach-sessions, create a new coach session
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
 * GET /coach-sessions/:id, get a session
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
 * POST /coach-sessions/:id/message, send a message to the session
 */
router.post('/:id/message', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const userId = req.userId as string;
    const { content, history, action_chip, permissions: granted, today, client } = messageSchema.parse(req.body);
    const permissions = granted ?? NO_ACCESS;

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
      if (['why_is_this_an_issue', 'show_drill', 'ask_coach'].includes(action_chip) && !permissions.analysis) {
        res.status(403).json({ error: 'Enable analysis access for your coach first.' }); return;
      }
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
                    .map((d: any) => `• ${d.name} (${d.volume ?? 'N/A'}), Cue: "${d.cue ?? ''}"`)
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
          // Frontend handles navigation, return nothing meaningful
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
      getAllReferencedrills,
      reserveCoachMessage,
      refundCoachMessage,
      recordCoachTokens,
    } = await import('../db/queries.js');

    // Claim one message from the athlete's allowance before spending tokens.
    const usage = await reserveCoachMessage(userId);
    if (!usage) {
      const { getCoachUsage } = await import('../db/queries.js');
      res.status(429).json({ code: 'COACH_CAP_REACHED', error: 'Coach message limit reached', usage: await getCoachUsage(userId) });
      return;
    }
    let delivered = false;
    let intentLabel = 'unrouted';
    const tokens = { prompt: 0, completion: 0 };
    try {
    const analyses = permissions.analysis ? await getAnalysesByUser(req.userId) : [];
    const grounding = session.analysis_id
      ? analyses.find((a: any) => a.id === session.analysis_id)
      : analyses.find((a: any) => a.status === 'completed' && a.result_json);
    // The agent has get_athlete_metrics, so its grounding block stays short and
    // the numbers arrive once, through the tool. The single-shot fallback below
    // has no tools, so it gets the full block.
    const agentContext = `TODAY: ${today ?? new Date().toISOString().slice(0, 10)}. Access: ${JSON.stringify(permissions)}. ${permissions.profile && req.user?.is_injured ? 'Athlete is injured. Training is paused.' : ''}\n` + buildAnalysisContext((grounding?.result_json as any) ?? null, permissions.profile ? req.user : null, { brief: true });
    const analysisContext = buildAnalysisContext((grounding?.result_json as any) ?? null, permissions.profile ? req.user : null);

    const toolset = buildCoachTools({
      userId: req.userId,
      profile: permissions.profile ? req.user ?? null : null,
      permissions, analysisId: session.analysis_id,
      now: today ? () => new Date(`${today}T12:00:00Z`) : undefined,
      readAppData: async (resource, args) => {
        const db = await import('../db/queries.js');
        if (resource === 'profile') {
          const u = req.user;
          return { display_name: u.display_name, event_specialty: u.event_specialty, experience_level: u.experience_level, personal_best_seconds: u.personal_best_seconds, is_injured: u.is_injured, drill_intensity_cap: u.drill_intensity_cap };
        }
        if (resource === 'coach_sessions') return (await db.getCoachSessionsByUser(userId)).slice(0, 30);
        if (resource === 'settings') return { appearance: client?.appearance ?? 'unknown', reduceMotion: client?.reduceMotion ?? 'unknown', coachAccess: permissions };
        if (resource === 'analysis') {
          const target = z.string().uuid().parse(args.analysisId ?? session.analysis_id ?? analyses[0]?.id);
          const a: any = analyses.find((x: any) => x.id === target);
          if (!a) throw new Error('Analysis not found');
          const r: any = groundedResult(a.result_json);
          return { id: a.id, status: a.status, created_at: a.created_at, error: a.error_message ?? undefined,
            result: r ? { ...r, pose3d: undefined, model_meta: undefined, overlay: undefined } : null };
        }
        if (resource === 'analyses') return analyses.slice(z.number().int().min(0).parse(args.offset ?? 0), z.number().int().min(0).parse(args.offset ?? 0) + z.number().int().min(1).max(20).parse(args.limit ?? 10)).map((a: any) => ({ id: a.id, status: a.status, created_at: a.created_at, result: groundedResult(a.result_json) ? { ...groundedResult(a.result_json), pose3d: undefined, model_meta: undefined } : null }));
        if (resource === 'suggestions') {
          const target = z.string().uuid().parse(args.analysisId ?? session.analysis_id ?? analyses[0]?.id);
          return db.getSuggestionsByAnalysis(target, userId);
        }
        if (resource === 'calendar') {
          const from = dateSchema.parse(args.from ?? today ?? new Date().toISOString().slice(0, 10));
          const to = dateSchema.parse(args.to ?? new Date(new Date(`${from}T12:00:00Z`).getTime() + 30 * 86400000).toISOString().slice(0, 10));
          if (to < from || new Date(to).getTime() - new Date(from).getTime() > 366 * 86400000) throw new Error('Choose a calendar range of at most one year');
          return db.getCalendarEvents(userId, from, to);
        }
        throw new Error('Unknown resource');
      },
      proposeAction: async (raw) => {
        const action = appActionSchema.parse(raw);
        const db = await import('../db/queries.js');
        let before: any;
        if (action.kind === 'update_event' || action.kind === 'delete_event') {
          before = await db.getCalendarEventById(action.eventId, userId);
          if (!before) throw new Error('Calendar event not found');
          if (before.status === 'completed') throw new Error('Completed training cannot be moved or deleted');
        }
        if (action.kind === 'set_event_status') {
          before = await db.getCalendarEventById(action.eventId, userId);
          if (!before) throw new Error('Calendar event not found');
          // The athlete's own date decides whether a session can be completed yet.
          (action as any).today = today ?? new Date().toISOString().slice(0, 10);
        }
        if (action.kind === 'approve_suggestion' || action.kind === 'skip_suggestion') {
          before = await db.getDrillSuggestion(action.suggestionId, userId);
          if (!before) throw new Error('Suggestion not found');
          if (before.status !== 'pending') throw new Error(`That suggestion is already ${before.status}`);
        }
        if (action.kind === 'update_profile') before = Object.fromEntries(Object.keys(action.changes).map((k) => [k, req.user[k]]));
        if (action.kind === 'navigate' && action.analysisId && !await db.getAnalysis(action.analysisId, userId)) throw new Error('Analysis not found');
        if (req.user?.is_injured && ((action.kind === 'create_events' && action.events.some((e) => e.eventType === 'workout' || e.eventType === 'drill')) || (action.kind === 'update_event' && action.changes.eventType && ['workout', 'drill'].includes(action.changes.eventType)) || action.kind === 'approve_suggestion')) throw new Error('Training is paused while injured. Use recovery guidance.');
        return signProposal(userId, id, action, before);
      },
      deps: { getAnalysesByUser, getMetricsTrend, getReferenceDrill, getCalendarEvents, listReferenceDrills: getAllReferencedrills },
    });

    // Route the message, then gather its evidence in parallel before the first
    // model call (see lib/coach/router.ts and workflow.ts).
    const previousUser = [...(history ?? [])].reverse().find((m) => m.role === 'user')?.content ?? null;
    const route = routeMessage(content, previousUser);
    intentLabel = [...route.intents].join('+');
    const latestResult: any = groundedResult((grounding?.result_json as any) ?? null);
    const metrics: any[] = latestResult?.metrics ?? [];
    const flaws: any[] = (latestResult?.flaws ?? []).slice().sort((a: any, b: any) => (b.severity ?? 0) - (a.severity ?? 0)).slice(0, 2);
    // Flaws carry no metric key; the metric reporting the same measurement is theirs.
    const outOfRange = (m: any) => m.normalRange && (m.measured?.value < m.normalRange[0] || m.measured?.value > m.normalRange[1]);
    const flawMetricKeys = [...new Set([
      ...flaws.map((f: any) => metrics.find((m) => m.measured?.value === f.evidence?.measured?.value)?.key),
      ...(latestResult?.focusAreas ?? []).map((f: any) => f.key),
      ...metrics.filter((m) => m.trustStatus === 'trusted' && outOfRange(m)).map((m) => m.key),
    ].filter(Boolean))].slice(0, 2) as string[];
    const plan = await gatherEvidence(route, toolset, {
      message: content,
      flawNames: flaws.map((f: any) => f.name),
      flawMetricKeys,
      metricKeys: [...metrics.filter((m) => m.trustStatus === 'trusted'), ...metrics.filter((m) => m.trustStatus !== 'trusted')].map((m) => m.key),
    });

    let assistantText: string;
    const progress: string[] = [];
    try {
      assistantText = await runTrackCoach({
        userMessage: content,
        analysisContext: agentContext,
        history: history ?? [],
        toolset,
        evidence: plan.block,
        toolNames: plan.toolNames,
        command: route.command,
        onProgress: (ev) => { progress.push(ev.label); },
        onUsage: (u) => { tokens.prompt += u.prompt; tokens.completion += u.completion; },
      });
    } catch (agentErr) {
      const rateLimited = agentErr instanceof CoachRateLimitError;
      if (rateLimited) {
        // The fallback is worth ONE attempt even here. This used to rethrow on
        // the assumption that a rate limit is a quota the fallback would hit
        // too, true of a daily cap, but the limit that actually bites is
        // tokens-per-minute, and the agent is far the more expensive request:
        // it sends the tool schemas and a growing transcript across several
        // rounds, where the fallback is one call with neither. Observed on a
        // real clip: the agent's second round asked for 3,170 tokens against
        // 2,773 remaining, while the single-shot needs roughly a third of that.
        // Giving the athlete a grounded answer beats "your coach is busy"
        // whenever the cheaper path fits.
        console.warn('Coach agent rate-limited; trying the cheaper single-shot path');
      } else {
        console.error('Coach agent failed, falling back to single-shot reply:', agentErr);
      }
      // Preserve real proposals if a later model round fails; never imply they ran.
      progress.push('Drafting your coaching plan');
      try {
        assistantText = await generateCoachReply({
          analysisContext,
          userMessage: content,
          history: history ?? [],
        });
      } catch (fallbackErr) {
        // Out of room on both paths, now the friendly message is the honest
        // answer. Rethrow the ORIGINAL rate-limit error so the caller still
        // sees a 429 rather than a generic 500.
        throw rateLimited ? agentErr : fallbackErr;
      }
    }

    const final = finalizeReply(assistantText, {
      measuredKeys: new Set(metrics.map((m) => String(m.key))),
      evidence: toolset.evidence,
    });
    assistantText = toolset.proposals.length ? proposalReply(toolset.proposals) : final.text;
    await touchCoachSession(id);
    const calendarRelevant = permissions.calendar && toolset.proposals.length === 0 && await isCalendarRelevant(assistantText);
    delivered = true;
    res.json({ role: 'assistant', content: assistantText, progress, calendarRelevant, actions: toolset.proposals,
      sources: final.sources, usage });
    } finally {
      if (!delivered) await refundCoachMessage(userId, usage.period).catch(() => {});
      if (tokens.prompt || tokens.completion) {
        await recordCoachTokens(userId, usage.period, tokens.prompt, tokens.completion).catch(() => {});
        console.info(`coach turn user=${userId.slice(0, 8)} intents=${intentLabel} prompt=${tokens.prompt} completion=${tokens.completion}`);
      }
    }
  } catch (err) {
    next(err);
  }
});

/** Explicit approval applies only the server-signed action that was reviewed. */
router.post('/:id/actions/apply', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const { token, permissions } = z.object({ token: z.string().max(50000), permissions: permissionsSchema }).parse(req.body);
    const session = await getCoachSession(req.params.id, req.userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.status === 'closed') { res.status(409).json({ error: 'Session closed' }); return; }
    let proposal;
    try { proposal = verifyProposal(token, req.userId, session.id); }
    catch { res.status(400).json({ error: 'Invalid or expired approval. Ask the coach to review again.' }); return; }
    if (!permissions[actionScope(proposal.action)]) { res.status(403).json({ error: 'Coach access was revoked for this action' }); return; }
    if (req.user?.is_injured && ((proposal.action.kind === 'create_events' && proposal.action.events.some((e) => ['workout', 'drill'].includes(e.eventType))) || (proposal.action.kind === 'update_event' && proposal.action.changes.eventType && ['workout', 'drill'].includes(proposal.action.changes.eventType)))) {
      res.status(409).json({ error: 'Training is paused while injured' }); return;
    }
    const { applyCoachAction } = await import('../db/coachActions.js');
    try { res.json(await applyCoachAction(req.userId, session.id, proposal)); }
    catch (err) {
      if (err instanceof Error && /changed|Completed training/.test(err.message)) { res.status(409).json({ error: err.message }); return; }
      throw err;
    }
  } catch (err) { next(err); }
});

/**
 * POST /coach-sessions/:id/add-to-calendar, ask LLM to generate structured
 * calendar events from the conversation, then create them.
 */
router.post('/:id/add-to-calendar', authenticate, async (req: any, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId as string;
    const { id } = req.params;
    // Validate the free-form body: a non-array history would crash .map below.
    const { history, permissions = NO_ACCESS } = z.object({
      permissions: permissionsSchema.optional(),
      history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).max(50).optional(),
    }).parse(req.body ?? {});

    const session = await getCoachSession(id, userId);
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    if (session.status === 'closed') { res.status(409).json({ error: 'Session closed' }); return; }

    if (!permissions.calendar) { res.status(403).json({ error: 'Enable calendar access first.' }); return; }
    if (req.user?.is_injured) { res.status(409).json({ error: 'Training is paused while injured' }); return; }

    // Build context from the conversation history
    const conversationSummary = (history ?? [])
      .slice(-8)
      .map((m: any) => `${m.role}: ${m.content}`)
      .join('\n');

    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const planPrompt = `Based on this conversation:\n${conversationSummary}\n\nGenerate a JSON array of events for the next 2 weeks.
Each event: {"title": "string", "eventType": "drill" or "workout" or "rest" or "hydration" or "recovery" or "cross_training", "scheduledDate": "YYYY-MM-DD", "details": {"sets": number (optional), "reps": number (optional), "volume": "string", "cue": "string"}}
Include numeric "sets" and "reps" whenever the event is a countable drill/exercise (e.g. high knee switches). Use "volume" for anything better described as a duration/distance (e.g. "20min tempo run", "400m x 4") instead of sets/reps.
"drill" and "workout" are the primary event types, this plan should be built around those by default. Only include "hydration", "recovery" (e.g. foam rolling, ice bath, mobility work), or "cross_training" (e.g. swimming, cycling, yoga) events if the athlete specifically brought that up in the conversation, don't invent them for a conversation that was only about drills or workouts.
Rules:
- Keep each day manageable, typically 1 main workout and a couple of form drills.
- Include rest days. Athletes need recovery.
- No more than 2 hard days in a row.
- Start from tomorrow (${tomorrowStr}).
Output ONLY the raw JSON array. No markdown. No explanation. Just [ ... ]`;

    const { getAnalysesByUser } = await import('../db/queries.js');
    const analyses = permissions.analysis ? await getAnalysesByUser(userId) : [];
    const latest = analyses.find((a: any) => a.status === 'completed' && a.result_json);
    const analysisContext = buildAnalysisContext((latest?.result_json as any) ?? null, permissions.profile ? req.user : null);

    const planJson = await generateCoachReply({
      analysisContext,
      userMessage: planPrompt,
      history: history ?? [],
      // Two weeks of events as raw JSON, needs room the chat default doesn't give.
      maxTokens: 2500,
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

    // Validate the LLM's output before it reaches SQL: bad event types or
    // malformed dates must 422 with a readable message, not 500 on a pg error.
    const VALID_EVENT_TYPES = new Set(['workout', 'rest', 'competition', 'drill', 'hydration', 'recovery', 'cross_training']);
    const dbEvents = events
      .filter((e: any) => typeof e?.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.scheduledDate))
      .map((e: any) => ({
        title: String(e.title || 'Workout').slice(0, 200),
        event_type: VALID_EVENT_TYPES.has(e.eventType) ? e.eventType : 'workout',
        scheduled_date: e.scheduledDate,
        details: e.details && typeof e.details === 'object' ? e.details : {},
      }));
    if (dbEvents.length === 0) {
      res.status(422).json({ error: 'Could not generate calendar plan. Try asking for a specific workout plan first.' });
      return;
    }

    // 'coach', the athlete did not pick these dates by hand, so the plan is
    // handed to the Plan tab's card reveal rather than appearing silently.
    const action = appActionSchema.parse({ kind: 'create_events', events: dbEvents.map((e) => ({ title: e.title, eventType: e.event_type, scheduledDate: e.scheduled_date, details: e.details })) });
    res.json({ created: 0, events: [], actions: [signProposal(userId, id, action)] });
  } catch (err) {
    next(err);
  }
});

export default router;
