-- Coach message allowance per athlete and period ('beta' or 'YYYY-MM'). Counts
-- and token totals only, never message content: there are no conversations.
CREATE TABLE IF NOT EXISTS coach_usage (
  user_id UUID NOT NULL,
  period VARCHAR(10) NOT NULL,
  messages INTEGER NOT NULL DEFAULT 0,
  prompt_tokens BIGINT NOT NULL DEFAULT 0,
  completion_tokens BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, period)
);
