/** Raised when the coach LLM returns 429 (rate limit or daily quota
 * exhausted — the free OpenRouter tier allows 50 requests/day). Carries a
 * statusCode so the shared errorHandler middleware (middleware/errors.ts)
 * surfaces this message as-is instead of masking it as a 500. */
export class CoachRateLimitError extends Error {
  statusCode = 429;
  constructor(message = 'Your coach is a bit busy right now — try again in a few minutes.') {
    super(message);
    this.name = 'CoachRateLimitError';
  }
}
