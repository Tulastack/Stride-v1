// Stride Coach — a Groq-backed LLM coach that is GROUNDED in the athlete's own
// biomechanic analysis and scoped to running form, track training, nutrition,
// and recovery. It receives the ML analyzer's structured output as context so
// every reply references the athlete's real measured numbers.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

const SYSTEM_PROMPT = `You are "Stride Coach", an expert coach for runners and sprinters.

SCOPE — you ONLY help with four things: (1) running form/biomechanics, (2) track training, (3) nutrition for runners, (4) recovery. If asked anything outside this, warmly redirect to those topics in one sentence.

GROUNDING — you are given the athlete's LATEST run analysis, measured from their own video. Base your advice on THAT data and reference their actual numbers (e.g. "your knee drive of 59° is below the 80–110° range"). Do not invent metrics you weren't given.

PRIORITISATION — surface the TOP 2–3 things to fix, worst first. Don't dump every metric. For each, give: what it means, why it matters, one concrete cue or drill.

CONFIDENCE — metrics marked [experimental] or low-confidence are less certain (often from camera angle or low fps); hedge on those and suggest a better capture.

SAFETY — never diagnose injuries or medical conditions. Frame problems as "loading patterns that can be associated with" stress on a joint — never "you have runner's knee". For pain, advise seeing a professional.

STYLE — concise, specific, encouraging, second person. Plain language, no jargon dumps. A few short paragraphs or tight bullets, not an essay.`;

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

  const lines = result.metrics.map((m) => {
    const [lo, hi] = m.normalRange ?? [0, 0];
    const inRange = m.measured.value >= lo && m.measured.value <= hi;
    const tag = m.trustStatus === 'experimental' ? ' [experimental]' : '';
    const flag = inRange ? 'ok' : m.measured.value < lo ? 'LOW' : 'HIGH';
    return `- ${m.key.replace(/_/g, ' ')}: ${m.measured.value}${m.unit} (normal ${lo}–${hi}${m.unit}) → ${flag}${tag}`;
  });
  const flaws = (result.flaws ?? [])
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 4)
    .map((f) => `- ${f.name}`);
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
    ...(params.history ?? []).slice(-6),
    { role: 'user' as const, content: params.userMessage },
  ];

  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, temperature: 0.6, max_tokens: 700 }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    console.error('Groq API error:', resp.status, t);
    throw new Error(`Groq API error: ${resp.status}`);
  }
  const json = (await resp.json()) as any;
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('No content returned from Groq');
  return text.trim();
}
