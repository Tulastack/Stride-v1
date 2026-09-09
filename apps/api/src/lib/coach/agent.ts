// Stride Coach, the agentic core.
//
// Instead of one blind LLM completion, this runs a bounded tool-calling loop:
// the model can search the vetted track knowledge base, pull the athlete's real
// metrics/trends, look up canonical drills, and read the current plan BEFORE it
// answers. That grounding, plus a tight track-only scope, is what makes this a
// real coaching agent rather than a generic chatbot wrapper.

import type { CoachToolset } from './tools.js';
import { CoachRateLimitError } from './errors.js';
import { resolveCoachProvider, postToProvider } from './provider.js';

// Two rounds: one to gather, one to answer. The prompt asks for every tool in a
// single turn, and each extra round re-sends the entire transcript plus the tool
// schemas, which was by far the largest line in the coach's token bill.
const MAX_TOOL_ROUNDS = 2;

/**
 * Cap on one tool result. Long results are not just paid for once: every later
 * round re-sends them. 4000 characters of knowledge-base prose was roughly a
 * thousand tokens per call, re-billed on each subsequent round.
 */
const TOOL_RESULT_CHARS = 1200;

/** Turns of prior conversation carried into the request. */
const HISTORY_TURNS = 4;

const AGENT_SYSTEM_PROMPT = `You are "Stride Coach", an elite Track and Field coach for sprinters and distance runners. Scope: form and biomechanics, race strategy, periodization, strength for speed, warm-up, fuelling, recovery, injury prevention, plus mental game, competition prep and recruiting. Anything outside athletics: decline in one friendly line and steer back to their running.

TOOLS. Do not answer technical questions from memory. Request every tool you need in ONE turn, together: each extra turn re-sends this whole conversation.
- search_track_knowledge before any mechanics, drill, strategy, periodization, fuelling or recovery advice. Answer from what it returns.
- get_athlete_metrics before discussing their form. Say what the number means for their running ("you are not driving the knee high enough, which shortens your stride"), not the number on its own. Never invent a metric.
- get_metric_trend for progress questions. get_reference_drill before naming a drill. get_current_plan before touching their schedule.
Hedge anything marked [experimental].

You never schedule anything. The app shows a calendar button by itself when your reply contains a real plan. Only mention scheduling if they ask.

Lead with the 1 or 2 things that matter most, worst first. Never diagnose an injury; for pain, send them to a professional and do not prescribe training through it.

FORMAT, exactly:
- No markdown, no asterisks, no hashtags, no backticks, no emoji.
- Never use an em dash or an en dash. Use a comma, a colon or a full stop.
- Label each section on its own line: FOCUS:  FORM:  DRILL:  PLAN:  FUEL:  MIND:  TIP:
  Add METRIC: <key> when you cite a measured issue. Keys: knee_drive, trunk_lean, hip_extension, knee_flexion, contact_time_ms, cadence_spm, overstride, arm_swing, vertical_oscillation.
- Bullets start with •. One or two lines per section.
- 70 to 130 words in total. Specific, direct, second person. No preamble, no sign-off.`;

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
 * is unreachable or misconfigured, callers can fall back to the simple path.
 */
export async function runTrackCoach(params: RunCoachParams): Promise<string> {
  // Throws when no key is configured, which the route catches to fall back to
  // the single-shot coach.
  const provider = resolveCoachProvider();
  const doFetch = params.fetchImpl ?? fetch;

  // ONE system turn, not two. Gemma 4's chat template expects a single system
  // turn ahead of the first user turn, and every other OpenAI-compatible model
  // is equally happy with one, so merging keeps the coach portable across
  // providers instead of relying on a gateway to normalise it.
  const messages: any[] = [
    { role: 'system', content: `${AGENT_SYSTEM_PROMPT}\n\n${params.analysisContext}` },
    ...(params.history ?? []).slice(-HISTORY_TURNS),
    { role: 'user', content: params.userMessage },
  ];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    // On the last allowed round, force a plain text answer (no more tools).
    const forceText = round === MAX_TOOL_ROUNDS;
    const body: any = {
      model: provider.model,
      messages,
      temperature: 0.6,
      // The prompt asks for 70-130 words (~190 tokens). Providers reserve
      // max_tokens against the per-minute budget up front, so anything above
      // what the coach can actually use is pure rate-limit cost.
      //
      // Not trimmed to ~250 though: current Gemini Flash models think before
      // answering, and those reasoning tokens are invisible in completion_tokens
      // but DO consume this budget, a probe with max_tokens 10 returned empty
      // content and 80 total tokens for a one-word reply. Too tight a cap
      // truncates the answer into nothing on exactly the providers worth using.
      max_tokens: 550,
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
        // 429 debuggable, never swallow it.
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
          content: result.slice(0, TOOL_RESULT_CHARS),
        });
      }
      continue; // let the model read tool results and continue
    }

    const text = (msg.content ?? '').trim();
    if (text) return text;
    // Model returned neither text nor tools, nudge once more toward an answer.
    messages.push({ role: 'user', content: 'Please give me your coaching answer now.' });
  }

  throw new Error('Coach agent did not produce a final answer');
}
