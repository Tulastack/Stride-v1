-- Retry-safe receipts for explicitly approved coach actions. No conversations.
CREATE TABLE IF NOT EXISTS coach_action_receipts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES coach_sessions(id) ON DELETE CASCADE,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
