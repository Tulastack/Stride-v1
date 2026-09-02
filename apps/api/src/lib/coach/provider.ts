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
    // Override with LLM_MODEL if a newer Flash model is current.
    model: 'gemini-2.5-flash',
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
export function resolveCoachProvider(): CoachProvider {
  const explicit = process.env.LLM_PROVIDER as ProviderName | undefined;
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
    url: process.env.LLM_BASE_URL ?? provider.url,
    model: process.env.LLM_MODEL ?? provider.model,
    headers,
  };
}
