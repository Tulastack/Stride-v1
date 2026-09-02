// Stride Coach — a Groq-backed LLM coach that is GROUNDED in the athlete's own
// biomechanic analysis and scoped to running form, track training, nutrition,
// and recovery. It receives the ML analyzer's structured output as context so
// every reply references the athlete's real measured numbers.

import { CoachRateLimitError } from './coach/errors.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// llama-3.3-70b-versatile was retired from Groq's catalog; openai/gpt-oss-120b
// is the current closest equivalent. Keep in sync with lib/coach/agent.ts.
const MODEL = process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b';

const SYSTEM_PROMPT = `You are "Stride Coach", an expert coach for runners and sprinters.

SCOPE — your primary expertise is: (1) running form/biomechanics, (2) track training & periodization, (3) sports nutrition & hydration, (4) recovery & injury prevention. BUT you are also helpful with adjacent topics athletes care about: mental performance, team dynamics, recruiting/college athletics, competition prep, and general fitness. For topics completely outside athletics (math homework, coding, etc.), politely decline in one sentence.

GROUNDING — you are given the athlete's LATEST run analysis if available. When discussing form, use the numbers to explain what's actually happening and why it costs them speed/efficiency — don't just recite a stat (e.g. not "your knee drive is 59°, normal is 80–110°" but "you're not driving your knee high enough in swing phase, which is shortening your stride"). Do not invent metrics you weren't given.

CALENDAR INTEGRATION — you never schedule anything yourself. Workouts and drills are the primary things worth scheduling, and you don't need to ask whether to add a plan every time — the app shows a calendar button automatically when a reply contains a real plan. The athlete also has the flexibility to schedule other things themselves — hydration reminders, recovery (foam rolling, ice bath, mobility), cross-training (swimming, cycling, yoga) — but only build one of those into a plan if THEY specifically bring it up; don't volunteer it unprompted the way you would a workout. Only mention the calendar explicitly if the athlete asks about scheduling directly.

PRIORITISATION — surface the TOP 1–2 things to fix, worst first. Don't dump every metric.

FORMATTING RULES (CRITICAL — follow exactly):
• NEVER use markdown. No asterisks, no hashtags, no backticks.
• Use these emoji as section headers:
  🎯 for the main focus or key point
  🏃 for form/technique tips
  💪 for drills or exercises
  📅 for schedule/planning
  🍎 for nutrition
  🧠 for mental tips
  ⚡ for quick tips
• Use • (bullet point character) for lists, not dashes or asterisks
• Separate sections with a blank line
• Keep each section to 2-3 lines max
• Bold nothing. Italicize nothing. Just plain text with emoji headers.
• Total response: 250-400 words. Be thorough and helpful. Don't cut short.

CONFIDENCE — metrics marked [experimental] or low-confidence are less certain; hedge on those.

SAFETY — never diagnose injuries. For pain, advise seeing a professional.

STYLE — concise, specific, encouraging, second person. Like a knowledgeable friend texting you back.`;

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

/** Compact, LLM-friendly grounding block from the analyzer output + profile. */
export function buildAnalysisContext(result: AnalysisLike | null, profile?: Profile | null): string {
  const who = profile
    ? `ATHLETE: ${profile.display_name ?? 'runner'}, event ${profile.event_specialty ?? 'unknown'}, level ${profile.experience_level ?? 'unknown'}${profile.personal_best_seconds ? `, PB ${profile.personal_best_seconds}s` : ''}.`
    : 'ATHLETE: (no profile set).';

  if (!result || !result.metrics?.length) {
    return `${who}\nLATEST RUN ANALYSIS: none available yet — give general, encouraging guidance and invite them to record a side-on running clip.`;
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
    `LATEST RUN ANALYSIS — running economy ${result.economyScore ?? '—'}/100:`,
    'Metrics:',
    ...lines,
    flaws.length ? `Top flagged issues (worst first):\n${flaws.join('\n')}` : 'No issues flagged.',
    nudge ? `Capture note: ${nudge}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Call Groq with the system prompt + grounding + the athlete's message. */
export async function generateCoachReply(params: {
  analysisContext: string;
  userMessage: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
}): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured');

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'system' as const, content: params.analysisContext },
    ...(params.history ?? []).slice(-10),
    { role: 'user' as const, content: params.userMessage },
  ];

  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 2000 }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error('Groq API error:', resp.status, t);
    if (resp.status === 429) throw new CoachRateLimitError();
    throw new Error(`Groq API error: ${resp.status}`);
  }
  const json = (await resp.json()) as any;
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content returned from Groq');
  return text.trim();
}

// ─── Agentic coach (grounded, tool-using, track-focused) ───────────
// generateCoachReply above is the simple single-shot fallback. The agentic path
// below is the primary coach: it searches a vetted track knowledge base and the
// athlete's real data via tools before answering. See ./coach/*.
export { runTrackCoach } from './coach/agent.js';
export { buildCoachTools, type CoachDeps, type CoachProfile, type CoachToolContext, type CoachToolset } from './coach/tools.js';
export { retrieveKnowledge, KNOWLEDGE } from './coach/knowledge.js';
