// Stride Coach — the agentic core.
//
// Instead of one blind LLM completion, this runs a bounded tool-calling loop:
// the model can search the vetted track knowledge base, pull the athlete's real
// metrics/trends, look up canonical drills, and read the current plan BEFORE it
// answers. That grounding — plus a tight track-only scope — is what makes this a
// real coaching agent rather than a generic chatbot wrapper.

import type { CoachToolset } from './tools.js';
import { CoachRateLimitError } from './errors.js';
import { resolveCoachProvider, postToProvider } from './provider.js';

const MAX_TOOL_ROUNDS = 4;

const AGENT_SYSTEM_PROMPT = `You are "Stride Coach", an elite Track & Field coach for sprinters and distance runners. Scope: running form/biomechanics, race strategy (100m/200m/400m/distance), periodization, strength for speed, warm-up, nutrition/hydration, recovery, injury prevention. Also athlete-adjacent topics (mental performance, recruiting, competition prep). For anything outside athletics, decline in one friendly sentence and steer back to their running.

USE YOUR TOOLS — do not answer technical questions from memory:
• search_track_knowledge before any mechanics/drill/strategy/periodization/nutrition/recovery advice; base the answer on what it returns.
• get_athlete_metrics whenever discussing their form. Use their REAL numbers to explain what is happening and why it costs speed — not "your knee drive is 59°, normal is 80–110°" but "you're not driving the knee high enough in swing, which shortens your stride". Never invent metrics.
• get_metric_trend when they ask about progress.
• get_reference_drill before prescribing a named drill, for the exact cue and any contraindications.
• get_current_plan before proposing schedule changes, so you fit their plan and don't stack hard days.
REQUEST EVERY TOOL YOU NEED IN ONE TURN — issue them together, not one per turn. Each extra turn re-sends this whole prompt.
Weave returned sources in naturally; you may note it reflects established coaching science. Hedge anything marked [experimental].

CALENDAR: you never schedule anything. Workouts and drills are the things worth scheduling; the app shows a calendar button automatically when a reply contains a real plan, and the athlete's tap is what adds it. They can also schedule hydration, recovery (foam rolling, ice bath, mobility) or cross-training (swim, bike, yoga) themselves — only build those into a plan if THEY raised it. Only mention scheduling if they ask.

PRIORITISE: the top 1–2 things to fix, worst first. Don't dump every metric.

SAFETY: never diagnose injuries; for pain, advise seeing a professional and don't prescribe training through it.

FORMAT (exactly):
• NEVER use markdown — no asterisks, hashtags, backticks, emoji, bold or italic.
• Start each section with a label on its own line: FOCUS:  FORM:  DRILL:  PLAN:  FUEL:  MIND:  TIP:
  When discussing a measured issue also emit: METRIC: <key>
  (keys: knee_drive, trunk_lean, hip_extension, knee_flexion, contact_time_ms, cadence_spm, overstride, arm_swing, vertical_oscillation)
• Use • for bullets. Blank line between sections. 2–3 lines per section.
• Total 120–250 words. Concise, specific, encouraging, second person.`;

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
  // Throws when no key is configured, which the route catches to fall back to
  // the single-shot coach.
  const provider = resolveCoachProvider();
  const doFetch = params.fetchImpl ?? fetch;

  // ONE system turn, not two. Gemma 4's chat template expects a single system
  // turn ahead of the first user turn, and every other OpenAI-compatible model
  // is equally happy with one — so merging keeps the coach portable across
  // providers instead of relying on a gateway to normalise it.
  const messages: any[] = [
    { role: 'system', content: `${AGENT_SYSTEM_PROMPT}\n\n${params.analysisContext}` },
    ...(params.history ?? []).slice(-8),
    { role: 'user', content: params.userMessage },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last allowed round, force a plain text answer (no more tools).
    const forceText = round === MAX_TOOL_ROUNDS;
    const body: any = {
      model: provider.model,
      messages,
      temperature: 0.6,
      // The prompt asks for 120-250 words (~340 tokens). 1500 was ~4x more than
      // the coach can ever use, and providers reserve max_tokens against the
      // per-minute budget up front, so the excess was pure rate-limit cost.
      //
      // Not trimmed all the way to ~400 though: current Gemini Flash models
      // think before answering, and those reasoning tokens are invisible in
      // completion_tokens but DO consume this budget — a probe with max_tokens
      // 10 returned empty content and 80 total tokens for a one-word reply. Too
      // tight a cap truncates the answer into nothing on exactly the providers
      // worth using.
      max_tokens: 800,
    };
    if (!forceText) {
      body.tools = params.toolset.schemas;
      body.tool_choice = 'auto';
    }

    const resp = await postToProvider(provider, body, doFetch);
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      if (resp.status === 429) {
        // The athlete gets a friendly message, but the upstream reason (which
        // quota, whose pool, when it resets) is the only thing that makes a
        // 429 debuggable — never swallow it.
        console.error(`${provider.name} 429 for ${provider.model}:`, t.slice(0, 500));
        throw new CoachRateLimitError();
      }
      throw new Error(`${provider.name} API error: ${resp.status} ${t.slice(0, 300)}`);
    }
    const json = (await resp.json()) as any;
    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error(`No message returned from ${provider.name}`);

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
