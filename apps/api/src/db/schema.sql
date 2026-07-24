-- Stride API Database Schema
-- Run against your PostgreSQL instance to initialize the database

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_uid VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    event_specialty VARCHAR(10) CHECK (event_specialty IN ('100m','200m','400m')),
    experience_level VARCHAR(20) CHECK (experience_level IN ('beginner','intermediate','advanced')),
    personal_best_seconds NUMERIC(6,2),
    created_at TIMESTAMPTZ DEFAULT now(),
    date_of_birth DATE,
    consent_given_at TIMESTAMPTZ,
    consent_version INTEGER NOT NULL DEFAULT 0,
    parental_consent BOOLEAN NOT NULL DEFAULT FALSE,
    drill_intensity_cap VARCHAR(20) CHECK (drill_intensity_cap IN ('moderate','full')),
    is_injured BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    s3_key TEXT NOT NULL,
    -- 'uploading' = row created at /upload-url; bytes not ready yet.
    -- 'pending'   = finalize done; safe for the ML worker to claim.
    status VARCHAR(20) NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading','pending','processing','completed','failed')),
    movenet_version VARCHAR(50),
    overall_score SMALLINT CHECK (overall_score BETWEEN 0 AND 100),
    result_json JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_analyses_user_id ON analyses(user_id);
CREATE INDEX idx_analyses_status ON analyses(status);
CREATE INDEX idx_analyses_pending ON analyses(created_at) WHERE status = 'pending';

-- NOTE: the `conversations` table was intentionally REMOVED (PRD v2.2 F.5
-- vision retention). There is no free-text chat: coaching is structured-only
-- (data-driven briefings + typed slots). Do not re-add a conversations table.

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('workout','rest','competition','drill','hydration','recovery','cross_training')),
    scheduled_date DATE NOT NULL,
    details JSONB,
    status VARCHAR(20) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','completed','skipped','modified')),
    completion_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calendar_user_date ON calendar_events(user_id, scheduled_date);

-- ─── Coach Sessions ──────────────────────────────────────────────
CREATE TABLE coach_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    session_type VARCHAR(20) NOT NULL CHECK (session_type IN ('analysis_workflow','free_coach')),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_coach_sessions_user ON coach_sessions(user_id);
CREATE INDEX idx_coach_sessions_analysis ON coach_sessions(analysis_id) WHERE analysis_id IS NOT NULL;

-- ─── Drill Suggestions ───────────────────────────────────────────
CREATE TABLE drill_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drill_key VARCHAR(100) NOT NULL,
    drill_name VARCHAR(200) NOT NULL,
    suggested_date DATE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','skipped')),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX idx_drill_suggestions_unique ON drill_suggestions(analysis_id, drill_key);
CREATE INDEX idx_drill_suggestions_user ON drill_suggestions(user_id);

CREATE TABLE suggestion_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id UUID NOT NULL REFERENCES drill_suggestions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(10) NOT NULL CHECK (action IN ('approved','skipped')),
    acted_at TIMESTAMPTZ DEFAULT now()
);

-- Migration: Allow 'hydration'/'recovery'/'cross_training' calendar events
-- (run against existing DBs — workout/drill remain the coach's primary focus,
-- these exist so the athlete can add other things themselves if they want to)
-- ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_event_type_check;
-- ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check
--     CHECK (event_type IN ('workout','rest','competition','drill','hydration','recovery','cross_training'));

-- Migration: Add consent fields (run against existing DBs)
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS parental_consent BOOLEAN NOT NULL DEFAULT FALSE;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS drill_intensity_cap VARCHAR(20) CHECK (drill_intensity_cap IN ('moderate','full'));
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS is_injured BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Reference Drills ─────────────────────────────────────────────
CREATE TABLE reference_drills (
    key VARCHAR(100) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    video_url TEXT,
    cues JSONB NOT NULL DEFAULT '[]',
    contraindications JSONB NOT NULL DEFAULT '[]',
    target_metrics JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Metrics Timeline ─────────────────────────────────────────────
CREATE TABLE metrics_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    metric_key VARCHAR(100) NOT NULL,
    value NUMERIC(8,2) NOT NULL,
    unit VARCHAR(50),
    optimal_min NUMERIC(8,2),
    optimal_max NUMERIC(8,2),
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_metrics_user_key ON metrics_timeline(user_id, metric_key, measured_at DESC);
CREATE INDEX idx_metrics_analysis ON metrics_timeline(analysis_id);
-- Idempotent reprocessing: one row per metric per analysis (SQS redelivery /
-- finalize retries must not stack duplicates that skew trend averages).
CREATE UNIQUE INDEX idx_metrics_analysis_metric ON metrics_timeline(analysis_id, metric_key);
