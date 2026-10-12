// Stride Coach, agent tools.
//
// The coach is an AGENT, not a single completion: it can call these tools to
// pull the athlete's real measured data, the vetted knowledge base, and the
// canonical drill library before answering. App changes are server-signed
// proposals; only explicit athlete approval can execute a mutation.
//
// Executors take their DB access via an injected `deps` object so the agent is
// unit-testable without a database.
//
// Every result carries an evidence ID ([A], [K:id], [D:key], [T:metric], [C],
// [P], [S], [SET]) so the reply can name what it used, and identical calls in
// one turn are answered once: repeated searches were the largest single token
// cost measured on the live coach.

import { retrieveKnowledge, gradeEvidence, drillDoc, type EvidenceDoc } from './knowledge.js';
import { groundedResult } from '../measurementTrust.js';
import { appActionSchema, actionScope, NO_ACCESS, type CoachPermissions, type ActionProposal } from './appActions.js';

export interface CoachProfile {
  event_specialty?: string | null;
  experience_level?: string | null;
  personal_best_seconds?: number | null;
  display_name?: string | null;
}

/** DB access the tools need, injected so tests can stub them. */
export interface CoachDeps {
  getAnalysesByUser(userId: string): Promise<any[]>;
  getMetricsTrend(userId: string, metricKey: string, weeks: number): Promise<{ week: string; avg_value: number }[]>;
  getReferenceDrill(key: string): Promise<any | null>;
  getCalendarEvents(userId: string, from: string, to: string): Promise<any[]>;
  /** Whole drill library, for search and metric lookup. Optional for older callers. */
  listReferenceDrills?(): Promise<any[]>;
}

export interface CoachToolContext {
  userId: string;
  profile: CoachProfile | null;
  deps: CoachDeps;
  /** Injectable clock (defaults to real now) so date logic is testable. */
  now?: () => Date;
  permissions?: CoachPermissions;
  analysisId?: string | null;
  readAppData?: (resource: string, args: Record<string, any>) => Promise<unknown>;
  proposeAction?: (action: unknown) => Promise<ActionProposal>;
}

/** OpenAI/Groq-compatible function-tool schema. */
export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// Descriptions are deliberately short: every schema is re-sent on every round.
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'search_track_knowledge',
      description: 'Search the vetted track and field knowledge base and drill library. Use only for a topic EVIDENCE does not already cover.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look up, e.g. "fix overstriding".' },
          event: { type: ['string', 'null'], enum: ['100m', '200m', '400m', 'distance', null] },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_athlete_metrics',
      description: "The athlete's measured metrics, trust status and flaws, for their latest analysis or a given analysisId.",
      parameters: { type: 'object', properties: { analysisId: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_metric_trend',
      description: 'How one metric changed across the athlete\'s analyses, trusted readings marked.',
      parameters: {
        type: 'object',
        properties: {
          metric_key: { type: 'string', description: 'knee_drive, trunk_lean, hip_extension, knee_flexion, contact_time_ms, cadence_spm, overstride, arm_swing, vertical_oscillation, knee_valgus or pelvic_drop.' },
          weeks: { type: ['number', 'null'] },
        },
        required: ['metric_key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reference_drill',
      description: 'Look up library drills by drill_key, by the metric they fix, or by name: cues, cautions and the phased program.',
      parameters: {
        type: 'object',
        properties: { drill_key: { type: 'string' }, metric_key: { type: 'string' }, name: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_plan',
      description: "The athlete's scheduled sessions from today, with event IDs.",
      parameters: { type: 'object', properties: { days: { type: ['number', 'null'] } } },
    },
  },
];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function latestCompleted(analyses: any[]): any | null {
  return analyses.find((a) => a.status === 'completed' && a.result_json) ?? null;
}

/** LLM / legacy aliases → the analysis metric keys. */
const METRIC_ALIASES: Record<string, string> = {
  knee_drive_angle: 'knee_drive', torso_lean: 'trunk_lean', ground_contact_time: 'contact_time_ms',
  contact_time: 'contact_time_ms', arm_angle: 'arm_swing', cadence: 'cadence_spm', stride_rate: 'cadence_spm',
  overstriding: 'overstride', valgus: 'knee_valgus', hip_drop: 'pelvic_drop', bounce: 'vertical_oscillation',
};
/** Analysis keys → the legacy metrics_timeline keys (fallback for old rows). */
const TIMELINE_KEYS: Record<string, string> = {
  knee_drive: 'knee_drive_angle', trunk_lean: 'torso_lean', hip_extension: 'hip_extension',
  contact_time_ms: 'ground_contact_time', arm_swing: 'arm_angle',
};

export function normalizeMetricKey(raw: string): string {
  const k = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return METRIC_ALIASES[k] ?? k;
}

const metricLabel = (key: string) => key.replace(/_(ms|spm)$/, '').replace(/_/g, ' ');
const fmtNum = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));

let drillCache: { at: number; rows: any[] } | null = null;
const DRILL_CACHE_MS = 10 * 60_000;

/**
 * Build the tool executor bound to a specific athlete. `execute` returns a
 * plain string (the tool result the model reads) and never throws, failures
 * come back as a readable message so the agent can recover.
 */
export function buildCoachTools(ctx: CoachToolContext) {
  const clock = ctx.now ?? (() => new Date());
  const permissions = ctx.permissions ?? NO_ACCESS;
  const proposals: ActionProposal[] = [];
  /** Evidence shown to the model this turn: id → short title. */
  const evidence = new Map<string, string>();
  const seenDocs = new Set<string>();
  const callResults = new Map<string, string>();
  let searches = 0;

  const toolScopes: Record<string, keyof CoachPermissions> = {
    get_athlete_metrics: 'analysis', get_metric_trend: 'analysis', get_current_plan: 'calendar',
  };
  const RESOURCES = ['profile', 'analyses', 'analysis', 'suggestions', 'coach_sessions', 'calendar', 'drills', 'settings'];
  const resourceScope = (r: string): keyof CoachPermissions | null =>
    r === 'drills' ? null : r === 'profile' ? 'profile' : r === 'calendar' ? 'calendar'
      : r === 'coach_sessions' || r === 'settings' ? 'app' : 'analysis';
  const appSchemas: ToolSchema[] = [
    { type: 'function', function: { name: 'read_app_data', description: 'Read any app data the athlete shared: profile (injury, intensity cap), analyses (list), analysis (one, by analysisId, with capture quality), suggestions (pending drills, by analysisId), coach_sessions, calendar (from/to YYYY-MM-DD, with IDs), drills (library), settings (appearance, reduce motion). Use for anything EVIDENCE lacks.', parameters: { type: 'object', properties: { resource: { type: 'string', enum: RESOURCES }, from: { type: 'string' }, to: { type: 'string' }, analysisId: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 20 } }, required: ['resource'] } } },
    { type: 'function', function: { name: 'propose_app_action', description: 'Prepare a change for the athlete to approve; nothing runs until they do. Kinds: create_events {events:[{title,eventType,scheduledDate,details}]}; update_event {eventId,changes}; delete_event {eventId}; set_event_status {eventId,status:completed|skipped|scheduled}; approve_suggestion / skip_suggestion {suggestionId}; update_profile {changes:{display_name,event_specialty,experience_level,personal_best_seconds}}; navigate {screen:capture|progress|analysis|coach|calendar|settings, analysisId?}; appearance {value:light|dark|system}; reduce_motion {value:boolean}. Use exact IDs from the calendar or suggestions. One action per event. Never alter completed training.', parameters: { type: 'object', properties: { action: { type: 'object', properties: { kind: { type: 'string', enum: ['create_events', 'update_event', 'delete_event', 'set_event_status', 'approve_suggestion', 'skip_suggestion', 'update_profile', 'navigate', 'appearance', 'reduce_motion'] }, events: { type: 'array', items: { type: 'object' } }, eventId: { type: 'string' }, suggestionId: { type: 'string' }, status: { type: 'string' }, changes: { type: 'object' }, screen: { type: 'string' }, analysisId: { type: 'string' }, value: {} }, required: ['kind'] } }, required: ['action'] } } },
  ];
  const allSchemas = [...TOOL_SCHEMAS.filter((t) => !toolScopes[t.function.name] || permissions[toolScopes[t.function.name]]), ...appSchemas];

  async function libraryDrills(): Promise<any[]> {
    if (!ctx.deps.listReferenceDrills) return [];
    if (drillCache && Date.now() - drillCache.at < DRILL_CACHE_MS) return drillCache.rows;
    const rows = await ctx.deps.listReferenceDrills();
    drillCache = { at: Date.now(), rows };
    return rows;
  }

  function describeDrill(d: any): string {
    const list = (v: unknown) => (Array.isArray(v) ? v.map(String).join('; ') : String(v ?? ''));
    const cues = Array.isArray(d.cues) && d.cues.length ? list(d.cues) : 'n/a';
    const contra = Array.isArray(d.contraindications) && d.contraindications.length
      ? list(d.contraindications) : d.contraindications && !Array.isArray(d.contraindications) ? String(d.contraindications) : 'none listed';
    const phases = Array.isArray(d.recovery_phases) && d.recovery_phases.length
      ? `\nProgram: ${d.recovery_phases.map((p: any) => `phase ${p.phase} ${p.name}, ${p.durationWeeksMin}-${p.durationWeeksMax} wk, ${p.daysPerWeek}x/wk (${(p.exercises ?? []).slice(0, 2).map((e: any) => `${e.name} ${e.sets}x${e.reps}`).join(', ')})`).join('; ')}.`
      : '';
    const targets = Array.isArray(d.target_metrics) && d.target_metrics.length ? ` Fixes: ${d.target_metrics.join(', ')}.` : '';
    evidence.set(`D:${d.key}`, d.name);
    return `[D:${d.key}] ${d.name} (key ${d.key}).${targets}\nCue: ${cues}.\nContraindications/warnings: ${contra}.${phases}`;
  }

  function analysisSummary(a: any): string {
    const r = groundedResult(a.result_json) ?? {};
    const metrics: any[] = r.metrics ?? [];
    const flaws: any[] = r.flaws ?? [];
    const usable: Record<string, boolean> = r.captureQuality?.perMetricUsable ?? {};
    const metricLines = metrics.length
      ? metrics.map((m) => {
        const key = String(m.key ?? '');
        const val = typeof m.measured?.value === 'number' ? m.measured.value : (m.measured ?? 'n/a');
        const conf = typeof m.measured?.confidence === 'number' ? m.measured.confidence : null;
        const [lo, hi] = m.normalRange ?? [];
        const range = lo != null && hi != null ? ` (normal ${fmtNum(lo)}-${fmtNum(hi)}${m.unit ?? ''})` : '';
        const trust = m.trustStatus === 'trusted' ? ' [trusted]' : ' [experimental, hedge; do not treat as definitive]';
        const confStr = conf != null ? ` conf=${conf.toFixed(2)}` : '';
        const gated = usable[key] === false || (conf != null && conf < 0.35) ? ' [NOT USABLE, do not cite as fact; ask them to re-film]' : '';
        return `- ${metricLabel(key)} (${key}): ${fmtNum(val)}${m.unit ?? ''}${range}${confStr}${trust}${gated}`;
      }).join('\n')
      : '- (no per-metric values)';
    const flawLines = flaws.length
      ? flaws.slice().sort((x, y) => (y.severity ?? 0) - (x.severity ?? 0)).slice(0, 4)
        .map((f) => `- ${f.name}${f.plainExplanation ? `: ${f.plainExplanation}` : ''}`).join('\n')
      : '- none flagged';
    const econ = r.economyScore != null ? `Form score: ${r.economyScore}/100.\n` : '';
    const nudge = r.captureQuality?.primaryNudge ? `Capture note: ${r.captureQuality.primaryNudge}\n` : '';
    const view = Array.isArray(r.captureQuality?.viewMeasurable)
      ? `Measurable from this camera angle: ${r.captureQuality.viewMeasurable.join(', ')}.\n` : '';
    const focus = (r.focusAreas ?? []).map((f: any) => `- ${f.name}: ${f.plainExplanation} [${f.kind}, not a confirmed fault]`).join('\n');
    const method = r.reconstructionMethod ? `Method: ${r.reconstructionMethod}.\n` : '';
    evidence.set('A', 'Your analysis');
    return `[A] Analysis ${a.id ?? ''} (${a.completed_at ?? a.created_at ?? 'recent'}):\n${method}${econ}${nudge}${view}Metrics:\n${metricLines}\nTop flaws (worst first):\n${flawLines}\nTentative focus areas:\n${focus || 'none'}`;
  }

  async function run(name: string, args: Record<string, any>): Promise<string> {
    if (toolScopes[name] && !permissions[toolScopes[name]]) return 'Access denied. Ask the athlete to enable this data category in Coach access.';
    switch (name) {
      case 'read_app_data': {
        const resource = String(args.resource ?? '');
        if (!RESOURCES.includes(resource)) return `Unknown resource "${resource}". Use one of: ${RESOURCES.join(', ')}.`;
        const scope = resourceScope(resource);
        if (scope && !permissions[scope]) return 'Access denied. Ask the athlete to enable this category in Coach access.';
        if (resource === 'drills') return (await libraryDrills()).map(describeDrill).join('\n\n') || 'The drill library is empty.';
        if (!ctx.readAppData) return 'Resource unavailable.';
        const tag = ({ profile: 'P', calendar: 'C', suggestions: 'S', settings: 'SET', analyses: 'AL', analysis: 'A', coach_sessions: 'CS' } as Record<string, string>)[resource];
        evidence.set(tag, ({ P: 'Your profile', C: 'Your calendar', S: 'Drill suggestions', SET: 'App settings', AL: 'Your analyses', A: 'Your analysis', CS: 'Coach sessions' } as Record<string, string>)[tag]);
        return `[${tag}] ${JSON.stringify(await ctx.readAppData(resource, args))}`;
      }
      case 'propose_app_action': {
        const action = appActionSchema.parse(args.action);
        if (!permissions[actionScope(action)]) return 'Access denied. Ask the athlete to enable this category in Coach access.';
        if (!ctx.proposeAction) return 'App actions unavailable.';
        if (proposals.length >= 40) return 'Too many proposed actions. Finish these changes first.';
        const existing = proposals.find((p) => JSON.stringify(p.action) === JSON.stringify(action));
        const proposal = existing ?? await ctx.proposeAction(action);
        if (!existing) proposals.push(proposal);
        return JSON.stringify({ proposed: true, label: proposal.label, action: proposal.action, before: proposal.before, instruction: 'Awaiting athlete approval. Do not claim this was applied.' });
      }
      case 'search_track_knowledge': {
        searches += 1;
        if (searches > 3) return 'Search limit reached for this reply. Answer from the evidence already provided.';
        const query = String(args.query ?? '');
        const event = args.event ?? ctx.profile?.event_specialty ?? null;
        const extra: EvidenceDoc[] = (await libraryDrills()).map(drillDoc);
        const raw = retrieveKnowledge(query, { topK: 3, event, extra, exclude: seenDocs });
        // Keep only entries close to the best one: a weak third hit costs
        // tokens on every later round and dilutes the answer.
        const hits = raw.filter((h) => h.score >= raw[0]?.score * 0.4);
        if (hits.length === 0) {
          return seenDocs.size
            ? 'No new entries beyond the evidence already provided. Answer now.'
            : 'Evidence grade: none. No matching knowledge-base entries. Answer from general track coaching principles and say so.';
        }
        for (const h of hits) seenDocs.add(h.id);
        const grade = gradeEvidence(hits);
        return `Evidence grade: ${grade}${grade === 'weak' ? ' (partial match: hedge and say what is general guidance)' : ''}.\n` + hits
          .map((h) => {
            const id = `${h.kind === 'drill' ? 'D' : 'K'}:${h.id}`;
            evidence.set(id, h.title);
            return `[${id}] ${h.title}\n${h.content}\n(Source: ${h.source})`;
          })
          .join('\n\n');
      }

      case 'get_athlete_metrics': {
        const analyses = await ctx.deps.getAnalysesByUser(ctx.userId);
        const wanted = args.analysisId ?? ctx.analysisId;
        const latest = wanted ? analyses.find((a) => a.id === wanted && a.status === 'completed') : latestCompleted(analyses);
        if (!latest) return 'No completed run analysis yet. Encourage the athlete to record a running clip.';
        return analysisSummary(latest);
      }

      case 'get_metric_trend': {
        const rawKey = String(args.metric_key ?? '');
        const key = normalizeMetricKey(rawKey);
        const weeks = Number.isFinite(args.weeks) ? Math.max(1, Math.min(52, Number(args.weeks))) : 12;
        const since = clock().getTime() - weeks * 7 * 86_400_000;
        const analyses = (await ctx.deps.getAnalysesByUser(ctx.userId))
          .filter((a) => a.status === 'completed' && a.result_json)
          .filter((a) => new Date(a.completed_at ?? a.created_at ?? 0).getTime() >= since)
          .sort((x, y) => new Date(x.completed_at ?? x.created_at).getTime() - new Date(y.completed_at ?? y.created_at).getTime());
        const points = analyses.flatMap((a) => {
          const m = (groundedResult(a.result_json)?.metrics ?? []).find((x: any) => x.key === key);
          if (!m || typeof m.measured?.value !== 'number') return [];
          return [{ day: String(a.completed_at ?? a.created_at).slice(0, 10), value: m.measured.value, unit: m.unit ?? '', trusted: m.trustStatus === 'trusted' }];
        });
        evidence.set(`T:${key}`, `${metricLabel(key)} trend`);
        if (points.length) {
          const trusted = points.filter((p) => p.trusted);
          const series = points.map((p) => `${p.day}: ${fmtNum(Math.round(p.value * 10) / 10)}${p.unit}${p.trusted ? '' : ' [experimental]'}`).join('; ');
          if (trusted.length < 2) {
            return `[T:${key}] ${metricLabel(key)} over ${weeks} weeks: ${series}. Fewer than two trusted readings, so there is no reliable trend yet; hedge.`;
          }
          const delta = Math.round((trusted[trusted.length - 1].value - trusted[0].value) * 10) / 10;
          return `[T:${key}] ${metricLabel(key)} over ${weeks} weeks: ${series}. Across ${trusted.length} trusted readings the change is ${delta > 0 ? '+' : ''}${delta}${trusted[0].unit}.`;
        }
        const legacy = TIMELINE_KEYS[key];
        const rows = legacy ? await ctx.deps.getMetricsTrend(ctx.userId, legacy, weeks) : [];
        if (!rows.length) {
          const aliasNote = key !== rawKey ? ` (normalized from "${rawKey}")` : '';
          return `No trend data for "${key}"${aliasNote} in the last ${weeks} weeks.`;
        }
        const series = rows.map((r) => `${r.week}: ${Math.round(r.avg_value * 100) / 100}`).join('; ');
        const delta = Math.round((rows[rows.length - 1].avg_value - rows[0].avg_value) * 100) / 100;
        return `[T:${key}] Weekly ${metricLabel(key)}: ${series}. Net change ${delta} (${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}).`;
      }

      case 'get_reference_drill': {
        const drillKey = args.drill_key ? String(args.drill_key) : '';
        if (drillKey) {
          const drill = await ctx.deps.getReferenceDrill(drillKey);
          if (!drill) return `No reference drill found for key "${drillKey}". Do not invent one; search by metric_key or name instead.`;
          return describeDrill(drill);
        }
        const library = await libraryDrills();
        const metric = args.metric_key ? normalizeMetricKey(String(args.metric_key)) : '';
        const name = String(args.name ?? '').toLowerCase();
        const matches = library.filter((d) => (metric && Array.isArray(d.target_metrics) && d.target_metrics.includes(metric))
          || (name && String(d.name).toLowerCase().includes(name)));
        if (!matches.length) return `No library drill matches ${metric || name || 'that request'}. Available: ${library.map((d) => `${d.key} (${(d.target_metrics ?? []).join('/')})`).join(', ') || 'none'}.`;
        return matches.slice(0, 3).map(describeDrill).join('\n\n');
      }

      case 'get_current_plan': {
        const days = Number.isFinite(args.days) ? Math.max(1, Math.min(60, Number(args.days))) : 14;
        const today = clock();
        const toDate = new Date(today);
        toDate.setDate(today.getDate() + days);
        const events = await ctx.deps.getCalendarEvents(ctx.userId, fmtDate(today), fmtDate(toDate));
        evidence.set('C', 'Your calendar');
        if (!events.length) return `[C] No scheduled events in the next ${days} days. The plan is open.`;
        return '[C] ' + events
          .map((e) => `- ${String(e.scheduled_date).slice(0, 10)} [${e.event_type}] ${e.title} (${e.status}) id=${e.id} details=${JSON.stringify(e.details ?? {})}`)
          .join('\n');
      }

      default:
        return `Unknown tool "${name}".`;
    }
  }

  async function execute(name: string, args: Record<string, any>): Promise<string> {
    try {
      // Proposals have their own dedupe; every other identical call in a turn
      // already has its answer in the transcript.
      const memoKey = name === 'propose_app_action' ? null : `${name}:${JSON.stringify(args, Object.keys(args ?? {}).sort())}`;
      if (memoKey && callResults.has(memoKey)) return 'Same call already made this turn; use the result above.';
      const out = await run(name, args ?? {});
      if (memoKey) callResults.set(memoKey, out);
      return out;
    } catch (err) {
      return `Tool "${name}" failed: ${err instanceof Error ? err.message : 'unknown error'}. Continue without it.`;
    }
  }

  /** Schemas restricted to `names` (undefined = every permitted tool). */
  function schemasFor(names?: string[]): ToolSchema[] {
    return names ? allSchemas.filter((s) => names.includes(s.function.name)) : allSchemas;
  }

  return { schemas: allSchemas, schemasFor, execute, proposals, evidence };
}

export type CoachToolset = ReturnType<typeof buildCoachTools>;
