// Stride Coach, an LLM coach that is GROUNDED in the athlete's own
// biomechanic analysis and scoped to running form, track training, nutrition,
// and recovery. It receives the ML analyzer's structured output as context so
// every reply references the athlete's real measured numbers.

import { CoachRateLimitError } from './coach/errors.js';
import { resolveCoachProvider, postToProvider } from './coach/provider.js';

const SYSTEM_PROMPT = `You are "Stride Coach", an expert coach for runners and sprinters. Scope: running form and biomechanics, track training and periodization, fuelling and hydration, recovery and injury prevention, plus mental performance, competition prep and recruiting. For anything outside athletics, decline in one sentence.

You are given the athlete's latest run analysis when there is one. Use it to explain what is happening in their running and why it costs them speed, not to recite a stat: not "your knee drive is 59 degrees, normal is 80 to 110" but "you are not driving the knee high enough in swing, which shortens your stride". Never invent a metric you were not given. Metrics marked [experimental] or low confidence are less certain, so hedge those.

You never schedule anything. The app shows a calendar button by itself when your reply contains a real plan. Only mention scheduling if they ask.

Lead with the 1 or 2 things that matter most, worst first. Never diagnose an injury; for pain, send them to a professional.

FORMAT, exactly:
- No markdown, no asterisks, no hashtags, no backticks, no emoji.
- Never use an em dash or an en dash. Use a comma, a colon or a full stop.
- Label each section on its own line: FOCUS:  FORM:  DRILL:  PLAN:  FUEL:  MIND:  TIP:
  Add METRIC: <key> when you cite a measured issue. Keys: knee_drive, trunk_lean, hip_extension, knee_flexion, contact_time_ms, cadence_spm, overstride, arm_swing, vertical_oscillation.
- Bullets start with •. One or two lines per section.
- 70 to 130 words in total. Specific, direct, second person. No preamble, no sign-off.`;

interface Metric {
  key: string;
  measured: { value: number; confidence: number };
  unit: string;
  normalRange?: [number, number];
  trustStatus?: string;
}
interface AnalysisLike {
  economyScore?: number;
  metrics?: Metric[];
  flaws?: { name: string; severity: number; plainExplanation?: string }[];
  captureQuality?: { primaryNudge?: string; fps?: number };
}
interface Profile {
  event_specialty?: string | null;
  experience_level?: string | null;
  personal_best_seconds?: number | null;
  display_name?: string | null;
}

/**
 * Compact, LLM-friendly grounding block from the analyzer output + profile.
 *
 * `brief` is for the agent path, which owns get_athlete_metrics: sending the
 * full metric table here as well meant every request paid for the same numbers
 * twice, once in the system turn and again in the tool result. Brief keeps who
 * the athlete is and enough of a headline for the model to know whether it needs
 * the tool at all. The single-shot fallback has no tools, so it still gets the
 * whole block.
 */
export function buildAnalysisContext(
  result: AnalysisLike | null,
  profile?: Profile | null,
  opts?: { brief?: boolean },
): string {
  const who = profile
    ? `ATHLETE: ${profile.display_name ?? 'runner'}, event ${profile.event_specialty ?? 'unknown'}, level ${profile.experience_level ?? 'unknown'}${profile.personal_best_seconds ? `, PB ${profile.personal_best_seconds}s` : ''}.`
    : 'ATHLETE: (no profile set).';

  if (!result || !result.metrics?.length) {
    return `${who}\nLATEST RUN ANALYSIS: none yet. Give general guidance and invite them to record a side-on running clip.`;
  }

  if (opts?.brief) {
    const worst = (result.flaws ?? [])
      .slice()
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 2)
      .map((f) => f.name)
      .join(', ');
    return [
      who,
      `LATEST RUN: economy ${result.economyScore ?? 'n/a'}/100${worst ? `, worst issues: ${worst}` : ', nothing flagged'}.`,
      'Call get_athlete_metrics for the numbers before you discuss their form.',
    ].join('\n');
  }

  const fmt = (n: number) => n.toLocaleString('en-US');
  const lines = result.metrics.map((m) => {
    const [lo, hi] = m.normalRange ?? [0, 0];
    const inRange = m.measured.value >= lo && m.measured.value <= hi;
    const tag = m.trustStatus === 'experimental' ? ' [experimental]' : '';
    const flag = inRange ? 'ok' : m.measured.value < lo ? 'LOW' : 'HIGH';
    const label = m.key.replace(/_(ms|spm)$/, '').replace(/_/g, ' ');
    return `- ${label}: ${fmt(m.measured.value)}${m.unit} (normal ${fmt(lo)}–${fmt(hi)}${m.unit}) → ${flag}${tag}`;
  });
  const flaws = (result.flaws ?? [])
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 4)
    .map((f) => `- ${f.plainExplanation || f.name}`);
  const nudge = result.captureQuality?.primaryNudge;

  return [
    who,
    `LATEST RUN ANALYSIS, running economy ${result.economyScore ?? 'n/a'}/100:`,
    'Metrics:',
    ...lines,
    flaws.length ? `Top flagged issues (worst first):\n${flaws.join('\n')}` : 'No issues flagged.',
    nudge ? `Capture note: ${nudge}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Single-shot completion: system prompt + grounding + the athlete's message. */
export async function generateCoachReply(params: {
  analysisContext: string;
  userMessage: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  /**
   * Output budget. The default suits a chat reply (the prompt caps it at
   * 70-130 words) PLUS headroom for a reasoning model's hidden thinking tokens,
   * which consume this budget without appearing in completion_tokens. The
   * add-to-calendar path passes a far larger one, because it emits a two-week
   * JSON array in one shot and a truncated array is unparseable, silently
   * turning into a 422 rather than a short answer.
   */
  maxTokens?: number;
}): Promise<string> {
  const provider = resolveCoachProvider();

  // Single system turn, see the note in coach/agent.ts.
  const messages = [
    { role: 'system' as const, content: `${SYSTEM_PROMPT}\n\n${params.analysisContext}` },
    ...(params.history ?? []).slice(-4),
    { role: 'user' as const, content: params.userMessage },
  ];

  const resp = await postToProvider(provider, {
    model: provider.model, messages, temperature: 0.7,
    max_tokens: params.maxTokens ?? 650,
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error(`${provider.name} API error:`, resp.status, t);
    if (resp.status === 429) throw new CoachRateLimitError();
    throw new Error(`${provider.name} API error: ${resp.status}`);
  }
  const json = (await resp.json()) as any;
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error(`No content returned from ${provider.name}`);
  return text.trim();
}

// ─── Agentic coach (grounded, tool-using, track-focused) ───────────
// generateCoachReply above is the simple single-shot fallback. The agentic path
// below is the primary coach: it searches a vetted track knowledge base and the
// athlete's real data via tools before answering. See ./coach/*.
export { runTrackCoach } from './coach/agent.js';
export { buildCoachTools, type CoachDeps, type CoachProfile, type CoachToolContext, type CoachToolset } from './coach/tools.js';
export { retrieveKnowledge, KNOWLEDGE } from './coach/knowledge.js';
