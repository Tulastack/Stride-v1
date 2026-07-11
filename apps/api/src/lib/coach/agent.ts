// Stride Coach — the agentic core.
//
// Instead of one blind LLM completion, this runs a bounded tool-calling loop:
// the model can search the vetted track knowledge base, pull the athlete's real
// metrics/trends, look up canonical drills, and read the current plan BEFORE it
// answers. That grounding — plus a tight track-only scope — is what makes this a
// real coaching agent rather than a generic chatbot wrapper.

import type { CoachToolset } from './tools.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
const MAX_TOOL_ROUNDS = 4;

const AGENT_SYSTEM_PROMPT = `You are "Stride Coach", an elite Track & Field coach for sprinters and runners. You are laser-focused on TRACK: sprint & distance running form/biomechanics, event-specific race strategy (100m/200m/400m and distance), periodization & training plans, strength for speed, warm-up, sports nutrition/hydration, recovery, and injury prevention. You also help with directly athlete-adjacent topics (mental performance, recruiting/college athletics, competition prep). For anything clearly outside athletics (coding, math homework, general trivia), decline in one friendly sentence and steer back to their running.

YOU ARE A GROUNDED AGENT — USE YOUR TOOLS. Do not answer technical coaching questions from memory alone:
• Call search_track_knowledge before giving mechanics/drill/strategy/periodization/nutrition/recovery advice, and base your answer on what it returns.
• Call get_athlete_metrics whenever you discuss the athlete's form. Use their REAL measured numbers to explain what's actually happening and why it costs them speed/efficiency — don't just recite a stat (e.g. not "your knee drive is 59°, normal is 80–110°" but "you're not driving your knee high enough in swing phase, which is shortening your stride"). Never invent metrics.
• Call get_metric_trend when they ask about progress.
• Call get_reference_drill before prescribing a specific named drill, to use the exact cue and surface any contraindications.
• Call get_current_plan before proposing schedule changes, so you fit their existing plan and don't stack hard days.
When knowledge tools return sources, weave the guidance in naturally; you may mention that it reflects established coaching science. If a metric is marked [experimental], hedge on it.

CALENDAR: You can DISCUSS and design training, but you never schedule anything yourself. You don't need to ask whether to add a plan every time — the app shows a calendar button automatically when a reply contains a real, concrete plan (the athlete's tap is what actually adds it; nothing is auto-added). Only bring up scheduling explicitly if the athlete asks about it directly.

PRIORITISATION: surface the TOP 1–2 things to fix, worst first. Don't dump every metric.

SAFETY: never diagnose injuries; for pain, advise seeing a professional and don't prescribe training through it.

FORMATTING (follow exactly):
• NEVER use markdown. No asterisks, hashtags, backticks, or emoji. Bold/italic nothing.
• Start each section with a labeled header on its own line:
  FOCUS:  FORM:  DRILL:  PLAN:  FUEL:  MIND:  TIP:
  When discussing a specific measured issue, also emit: METRIC: <key>
  (keys: knee_drive, trunk_lean, hip_extension, knee_flexion, contact_time_ms, cadence_spm, overstride, arm_swing, vertical_oscillation)
• Use the • character for bullets. Separate sections with a blank line. Keep each section 2–3 lines.
• Total 120–250 words. Concise, specific, encouraging, second person — scannable, not a wall of text.`;

export interface RunCoachParams {
  userMessage: string;
  analysisContext: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  toolset: CoachToolset;
  /** Injectable fetch for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Optional progress callback, fired as the agent works through tool calls. */
  onProgress?: (ev: { label: string }) => void;
}

const TOOL_PROGRESS_LABELS: Record<string, string> = {
  search_track_knowledge: 'Checking coaching knowledge',
  get_athlete_metrics: 'Reading your latest analysis',
  get_metric_trend: 'Checking your progress trend',
  get_reference_drill: 'Looking up drill cues',
  get_current_plan: 'Reviewing your current plan',
};

function parseArgs(raw: unknown): Record<string, any> {
  if (raw && typeof raw === 'object') return raw as Record<string, any>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw || '{}');
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Run the agentic coach. Returns the final assistant text. Throws only if Groq
 * is unreachable or misconfigured — callers can fall back to the simple path.
 */
export async function runTrackCoach(params: RunCoachParams): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
  const doFetch = params.fetchImpl ?? fetch;

  const messages: any[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'system', content: params.analysisContext },
    ...(params.history ?? []).slice(-8),
    { role: 'user', content: params.userMessage },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last allowed round, force a plain text answer (no more tools).
    const forceText = round === MAX_TOOL_ROUNDS;
    const body: any = {
      model: MODEL,
      messages,
      temperature: 0.6,
      max_tokens: 1500,
    };
    if (!forceText) {
      body.tools = params.toolset.schemas;
      body.tool_choice = 'auto';
    }

    const resp = await doFetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      throw new Error(`Groq API error: ${resp.status} ${t.slice(0, 300)}`);
    }
    const json = (await resp.json()) as any;
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error('No message returned from Groq');

    const toolCalls = msg.tool_calls as any[] | undefined;
    if (!forceText && toolCalls && toolCalls.length > 0) {
      // Record the assistant's tool-call turn, then run each tool.
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
      for (const call of toolCalls) {
        const fnName = call.function?.name ?? '';
        const fnArgs = parseArgs(call.function?.arguments);
        params.onProgress?.({ label: TOOL_PROGRESS_LABELS[fnName] ?? 'Thinking it through' });
        const result = await params.toolset.execute(fnName, fnArgs);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.slice(0, 4000),
        });
      }
      continue; // let the model read tool results and continue
    }

    const text = (msg.content ?? '').trim();
    if (text) return text;
    // Model returned neither text nor tools — nudge once more toward an answer.
    messages.push({ role: 'user', content: 'Please give me your coaching answer now.' });
  }

  throw new Error('Coach agent did not produce a final answer');
}
