// Which LLM serves the coach, and where.
//
// Both coach entry points (the agentic loop in agent.ts and the single-shot
// fallback in coach.ts) speak the OpenAI /chat/completions wire format, so
// switching providers is a base URL + model + key swap and nothing more. This
// module is the one place that decides those three things.
//
// Default is Gemma 4 31B on OpenRouter's free endpoint: it is hosted (nothing
// to run locally), costs nothing, and — unlike most small open models — has
// native function calling, which the agent's tool loop depends on. Groq is kept
// as a first-class alternative because the coach shipped on it.
//
// Resolved per call rather than at module load so tests and deploys can change
// the environment without re-importing.

export interface CoachProvider {
  /** Human-readable, used in error messages. */
  name: string;
  url: string;
  model: string;
  /** Tried once if the primary model is persistently overloaded (503). */
  fallbackModel?: string;
  /** Provider-specific body fields merged into every request. */
  extraParams?: Record<string, unknown>;
  headers: Record<string, string>;
}

const PROVIDERS = {
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    // ':free' is the no-cost endpoint. It accepts `tools`/`tool_choice`, which
    // the agent needs; dropping the suffix moves to the paid endpoint with
    // higher limits and no other change.
    model: 'google/gemma-4-31b-it:free',
    keyEnv: 'OPENROUTER_API_KEY',
  },
  google: {
    name: 'Google AI Studio',
    // Gemini's OpenAI-compatible surface: same /chat/completions wire format,
    // same tools/tool_choice, so the agent loop needs no changes.
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    // Free tier is ~1,000,000 tokens/minute and 1,500 requests/day, against
    // Groq's 8,000 TPM — which is the entire reason the coach agent could not
    // complete a single message there. This agent sends five tool schemas plus a
    // growing transcript across up to five rounds; a per-minute budget in the
    // thousands cannot hold that, and one in the millions does not notice it.
    // Chosen by listing what this key can actually reach, not from docs:
    // gemini-2.5-flash is retired for new keys, and 3.6-flash — which the
    // retirement message itself recommends — returns 503 "experiencing high
    // demand" persistently. 3.8-flash is the newest full (non-lite) Flash and
    // answers immediately. Override with LLM_MODEL when Google moves again;
    // gemini-3.1-flash-lite is a verified-working fallback with more headroom.
    model: 'gemini-3.8-flash',
    // Gemini returns 503 "experiencing high demand" per-model, so a busy
    // primary is survivable by asking a different one rather than failing the
    // athlete. Verified reachable on this key and answers immediately.
    fallbackModel: 'gemini-3.1-flash-lite',
    // Current Gemini Flash models think before answering, and those thinking
    // tokens are invisible in completion_tokens while still consuming
    // max_tokens — which truncated the coach's reply mid-sentence at 1,100.
    // Measured on a real coaching prompt: default effort burned ~900 tokens of
    // hidden reasoning and returned a cut-off answer, 'low' returned 0 thinking
    // tokens, 229 completion tokens and a complete 173-word reply in the right
    // format. It is the single biggest token saving available here, and it
    // costs no answer quality at this task's difficulty.
    extraParams: { reasoning_effort: 'low' },
    keyEnv: 'GOOGLE_API_KEY',
  },
  groq: {
    name: 'Groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    // NOT llama-3.3-70b-versatile — that was retired from Groq's catalog and
    // every coach call 404'd. gpt-oss-120b is the replacement, verified to
    // return standard OpenAI-shape tool_calls, which the agent loop needs.
    model: 'openai/gpt-oss-120b',
    keyEnv: 'GROQ_API_KEY',
  },
} as const;

export type ProviderName = keyof typeof PROVIDERS;

/**
 * Pick the provider. Explicit `LLM_PROVIDER` wins; otherwise whichever key is
 * present, preferring OpenRouter. Choosing by key matters — sending a Groq key
 * to OpenRouter (or the reverse) would just 401, so the key and the host are
 * never resolved independently.
 */
/**
 * Read an env var, treating BLANK as unset.
 *
 * `process.env.X ?? fallback` keeps an empty string, because '' is not nullish
 * — so a commented-out-by-blanking `LLM_MODEL=` in a .env silently overrode the
 * provider's default with no model at all, and Google rejected the call with
 * "model is not specified". Blank means unset for every one of these.
 */
function envOr(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v : fallback;
}

export function resolveCoachProvider(): CoachProvider {
  const explicitRaw = process.env.LLM_PROVIDER;
  const explicit = (explicitRaw && explicitRaw.trim() !== ''
    ? explicitRaw.trim()
    : undefined) as ProviderName | undefined;
  // Preference order when nothing is pinned: Google first, because its free
  // tier is the only one measured to actually fit this agent's token footprint.
  const auto: ProviderName | undefined =
    process.env.GOOGLE_API_KEY ? 'google'
      : process.env.OPENROUTER_API_KEY ? 'openrouter'
        : process.env.GROQ_API_KEY ? 'groq'
          : undefined;

  const chosen: ProviderName =
    explicit && explicit in PROVIDERS ? explicit : (auto ?? 'google');

  const provider = PROVIDERS[chosen];
  const apiKey = process.env[provider.keyEnv];
  if (!apiKey) {
    throw new Error(
      `Coach LLM is not configured — set ${provider.keyEnv}` +
        (chosen === 'openrouter' ? ' (free key at https://openrouter.ai/keys)'
          : chosen === 'google' ? ' (free key at https://aistudio.google.com/apikey)' : ''),
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  // OpenRouter uses these for attribution on its model leaderboards. Optional,
  // and harmless to send.
  if (chosen === 'openrouter') {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL ?? 'https://stride.app';
    headers['X-Title'] = 'Stride Coach';
  }

  return {
    name: provider.name,
    // Escape hatches for a provider this file doesn't know about (a gateway, a
    // self-hosted vLLM) without another code change.
    url: envOr('LLM_BASE_URL', provider.url),
    model: envOr('LLM_MODEL', provider.model),
    fallbackModel: (provider as { fallbackModel?: string }).fallbackModel,
    extraParams: (provider as { extraParams?: Record<string, unknown> }).extraParams,
    headers,
  };
}


/**
 * POST to the coach provider, retrying once on a transient upstream failure.
 *
 * 503 from Gemini means "this model is experiencing high demand ... usually
 * temporary" — a queue depth on their side, not anything wrong with the
 * request. Failing the athlete's message on a condition that clears in a second
 * is the wrong call, and one retry is cheap: at most two calls against a
 * 1,500/day free tier.
 *
 * Deliberately NOT retried: 429 (a real budget, retrying spends more of it),
 * and every 4xx (the request is wrong and will be wrong again).
 */
export async function postToProvider(
  provider: CoachProvider,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const payload = { ...(provider.extraParams ?? {}), ...(body as object) };
  const send = () =>
    fetchImpl(provider.url, {
      method: 'POST',
      headers: provider.headers,
      body: JSON.stringify(payload),
    });

  const first = await send();
  if (first.status !== 503) return first;
  await new Promise((r) => setTimeout(r, 1200));
  const second = await send();
  if (second.status !== 503 || !provider.fallbackModel) return second;

  // Still overloaded after a retry. 503 is per-MODEL on Gemini, so the useful
  // move now is a different model rather than a third attempt at the busy one.
  // Observed: gemini-3.8-flash 503'd twice in a row while 3.1-flash-lite
  // answered immediately.
  return fetchImpl(provider.url, {
    method: 'POST',
    headers: provider.headers,
    body: JSON.stringify({ ...payload, model: provider.fallbackModel }),
  });
}
