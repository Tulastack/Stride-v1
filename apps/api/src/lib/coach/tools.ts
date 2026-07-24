// Stride Coach — agent tools.
//
// The coach is an AGENT, not a single completion: it can call these tools to
// pull the athlete's real measured data, the vetted knowledge base, and the
// canonical drill library before answering. Every tool is READ-ONLY — writes to
// the calendar go exclusively through the explicit approval gate elsewhere, so
// the agent can never silently schedule anything.
//
// Executors take their DB access via an injected `deps` object so the agent is
// unit-testable without a database.

import { retrieveKnowledge } from './knowledge.js';

export interface CoachProfile {
  event_specialty?: string | null;
  experience_level?: string | null;
  personal_best_seconds?: number | null;
  display_name?: string | null;
}

/** DB access the tools need — injected so tests can stub them. */
export interface CoachDeps {
  getAnalysesByUser(userId: string): Promise<any[]>;
  getMetricsTrend(userId: string, metricKey: string, weeks: number): Promise<{ week: string; avg_value: number }[]>;
  getReferenceDrill(key: string): Promise<any | null>;
  getCalendarEvents(userId: string, from: string, to: string): Promise<any[]>;
}

export interface CoachToolContext {
  userId: string;
  profile: CoachProfile | null;
  deps: CoachDeps;
  /** Injectable clock (defaults to real now) so date logic is testable. */
  now?: () => Date;
}

/** OpenAI/Groq-compatible function-tool schema. */
export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'search_track_knowledge',
      description:
        'Search the curated Track & Field coaching knowledge base for vetted, sourced information about sprint/distance mechanics, drills, race strategy, periodization, strength, nutrition, recovery, injury, and warm-up. ALWAYS use this before giving technical coaching advice so your answer is grounded, and cite the returned sources.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look up, e.g. "fix overstriding" or "400m pacing".' },
          event: { type: 'string', enum: ['100m', '200m', '400m', 'distance'], description: 'Optional event to bias results toward.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_athlete_metrics',
      description:
        "Get the athlete's most recent completed run analysis: measured biomechanic metrics (with normal ranges and trust status) and flagged flaws. Use this whenever discussing their form so you reference their real numbers.",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_metric_trend',
      description:
        "Get the weekly trend of one biomechanic metric for the athlete over recent weeks, to see if it is improving. Use when the athlete asks about progress.",
      parameters: {
        type: 'object',
        properties: {
          metric_key: {
            type: 'string',
            description:
              'Metric key from analysis (aliases ok): knee_drive / knee_drive_angle, trunk_lean / torso_lean, hip_extension, contact_time_ms / ground_contact_time, arm_angle.',
          },
          weeks: { type: 'number', description: 'How many weeks back (default 4).' },
        },
        required: ['metric_key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_reference_drill',
      description:
        'Look up a canonical drill by its key to get the exact cue, prescription, and any contraindications/safety warnings. Use before recommending a specific drill so cues and warnings are accurate.',
      parameters: {
        type: 'object',
        properties: { drill_key: { type: 'string', description: 'The drill key, e.g. "drill-wickets".' } },
        required: ['drill_key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_plan',
      description:
        "Get the athlete's currently scheduled training events (calendar) around today, so your advice fits their existing plan and avoids stacking hard days.",
      parameters: {
        type: 'object',
        properties: { days: { type: 'number', description: 'Window size in days around today (default 14).' } },
      },
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

/** Map result_json / LLM aliases → metrics_timeline keys. */
const TREND_KEY_ALIASES: Record<string, string> = {
  knee_drive: 'knee_drive_angle',
  knee_drive_angle: 'knee_drive_angle',
  trunk_lean: 'torso_lean',
  torso_lean: 'torso_lean',
  hip_extension: 'hip_extension',
  contact_time_ms: 'ground_contact_time',
  ground_contact_time: 'ground_contact_time',
  arm_angle: 'arm_angle',
};

function normalizeTrendKey(raw: string): string {
  return TREND_KEY_ALIASES[raw] ?? TREND_KEY_ALIASES[raw.replace(/\s+/g, '_')] ?? raw;
}

/**
 * Build the tool executor bound to a specific athlete. `execute` returns a
 * plain string (the tool result the model reads) and never throws — failures
 * come back as a readable message so the agent can recover.
 */
export function buildCoachTools(ctx: CoachToolContext) {
  const clock = ctx.now ?? (() => new Date());

  async function execute(name: string, args: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'search_track_knowledge': {
          const query = String(args.query ?? '');
          const event = args.event ?? ctx.profile?.event_specialty ?? null;
          const hits = retrieveKnowledge(query, { topK: 4, event });
          if (hits.length === 0) return 'No matching knowledge-base entries. Answer from general track coaching principles and say so.';
          return hits
            .map((h, i) => `[${i + 1}] ${h.title}\n${h.content}\n(Source: ${h.source})`)
            .join('\n\n');
        }

        case 'get_athlete_metrics': {
          const analyses = await ctx.deps.getAnalysesByUser(ctx.userId);
          const latest = latestCompleted(analyses);
          if (!latest) return 'No completed run analysis yet. Encourage the athlete to record a running clip.';
          const r = latest.result_json ?? {};
          const metrics: any[] = r.metrics ?? [];
          const flaws: any[] = r.flaws ?? [];
          const usable: Record<string, boolean> = r.captureQuality?.perMetricUsable ?? {};
          const metricLines = metrics.length
            ? metrics
                .map((m) => {
                  const key = String(m.key ?? '');
                  const label = key.replace(/_(ms|spm)$/, '').replace(/_/g, ' ');
                  const val = typeof m.measured?.value === 'number' ? m.measured.value : (m.measured ?? '—');
                  const conf = typeof m.measured?.confidence === 'number' ? m.measured.confidence : null;
                  const [lo, hi] = m.normalRange ?? [];
                  const fmt = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
                  const range = lo != null && hi != null ? ` (normal ${fmt(lo)}-${fmt(hi)}${m.unit ?? ''})` : '';
                  const trust =
                    m.trustStatus === 'experimental'
                      ? ' [experimental — hedge; do not treat as definitive]'
                      : m.trustStatus === 'trusted'
                        ? ' [trusted]'
                        : '';
                  const confStr = conf != null ? ` conf=${conf.toFixed(2)}` : '';
                  const gated =
                    usable[key] === false || (conf != null && conf < 0.35)
                      ? ' [NOT USABLE — do not cite as fact; ask them to re-film]'
                      : '';
                  return `- ${label}: ${fmt(val)}${m.unit ?? ''}${range}${confStr}${trust}${gated}`;
                })
                .join('\n')
            : '- (no per-metric values)';
          const flawLines = flaws.length
            ? flaws
                .slice()
                .sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0))
                .slice(0, 4)
                .map((f) => `- ${f.name}${f.plainExplanation ? `: ${f.plainExplanation}` : ''}`)
                .join('\n')
            : '- none flagged';
          const econ = r.economyScore != null ? `Economy score: ${r.economyScore}/100.\n` : '';
          const nudge = r.captureQuality?.primaryNudge
            ? `Capture note: ${r.captureQuality.primaryNudge}\n`
            : '';
          const method = r.reconstructionMethod ? `Method: ${r.reconstructionMethod}.\n` : '';
          return `Latest analysis (${latest.completed_at ?? latest.created_at ?? 'recent'}):\n${method}${econ}${nudge}Metrics:\n${metricLines}\nTop flaws (worst first):\n${flawLines}`;
        }

        case 'get_metric_trend': {
          const rawKey = String(args.metric_key ?? '');
          const key = normalizeTrendKey(rawKey);
          const weeks = Number.isFinite(args.weeks) ? Math.max(1, Math.min(52, Number(args.weeks))) : 4;
          const rows = await ctx.deps.getMetricsTrend(ctx.userId, key, weeks);
          if (!rows.length) {
            const aliasNote = key !== rawKey ? ` (normalized from "${rawKey}")` : '';
            return `No trend data for "${key}"${aliasNote} in the last ${weeks} weeks.`;
          }
          const series = rows.map((r) => `${r.week}: ${Math.round(r.avg_value * 100) / 100}`).join('; ');
          const first = rows[0].avg_value;
          const last = rows[rows.length - 1].avg_value;
          const delta = Math.round((last - first) * 100) / 100;
          const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
          return `Trend for ${key} over ${rows.length} week(s): ${series}. Net change ${delta} (${dir}).`;
        }

        case 'get_reference_drill': {
          const drillKey = String(args.drill_key ?? '');
          const drill = await ctx.deps.getReferenceDrill(drillKey);
          if (!drill) return `No reference drill found for key "${drillKey}". Do not invent one; suggest a known drill instead.`;
          const contra = drill.contraindications
            ? `Contraindications/warnings: ${Array.isArray(drill.contraindications) ? drill.contraindications.join('; ') : drill.contraindications}`
            : 'Contraindications: none listed.';
          // Column is `cues` (JSONB array) — there is no `cue`/`default_cue`.
          const cues = Array.isArray((drill as { cues?: unknown }).cues) && (drill as { cues: unknown[] }).cues.length > 0
            ? (drill as { cues: unknown[] }).cues.join('; ')
            : 'n/a';
          return `Drill: ${drill.name} (key ${drill.key}).\nCue: ${cues}.\n${contra}`;
        }

        case 'get_current_plan': {
          const days = Number.isFinite(args.days) ? Math.max(1, Math.min(60, Number(args.days))) : 14;
          const today = clock();
          const from = fmtDate(today);
          const toDate = new Date(today);
          toDate.setDate(today.getDate() + days);
          const events = await ctx.deps.getCalendarEvents(ctx.userId, from, fmtDate(toDate));
          if (!events.length) return `No scheduled events in the next ${days} days. The plan is open.`;
          return events
            .map((e) => `- ${e.scheduled_date} [${e.event_type}] ${e.title} (${e.status})`)
            .join('\n');
        }

        default:
          return `Unknown tool "${name}".`;
      }
    } catch (err) {
      return `Tool "${name}" failed: ${err instanceof Error ? err.message : 'unknown error'}. Continue without it.`;
    }
  }

  return { schemas: TOOL_SCHEMAS, execute };
}

export type CoachToolset = ReturnType<typeof buildCoachTools>;
