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

-- Migration: Add reference_drills.recovery_phases + the metric_biomechanics
-- table (run against existing DBs — see the metric_biomechanics research pipeline)
-- ALTER TABLE reference_drills ADD COLUMN IF NOT EXISTS recovery_phases JSONB NOT NULL DEFAULT '[]';
-- CREATE TABLE IF NOT EXISTS metric_biomechanics (
--     metric_key VARCHAR(100) PRIMARY KEY,
--     body_region VARCHAR(100) NOT NULL,
--     primary_structure VARCHAR(200) NOT NULL,
--     mechanism TEXT NOT NULL,
--     injury_risks JSONB NOT NULL DEFAULT '[]',
--     confidence VARCHAR(20) NOT NULL CHECK (confidence IN ('established','emerging','preliminary')),
--     correlation_or_causal VARCHAR(20) NOT NULL CHECK (correlation_or_causal IN ('causal_mechanism','correlational','biomechanically_plausible')),
--     hedge_note TEXT,
--     citations JSONB NOT NULL DEFAULT '[]',
--     checker_a_verdict VARCHAR(20) NOT NULL CHECK (checker_a_verdict IN ('confirmed','partial','contradicted','no_lit_found')),
--     checker_b_verdict VARCHAR(20) NOT NULL CHECK (checker_b_verdict IN ('confirmed','partial','contradicted','no_lit_found')),
--     reviewed_by VARCHAR(255),
--     reviewed_at TIMESTAMPTZ,
--     pipeline_run_id VARCHAR(100) NOT NULL,
--     created_at TIMESTAMPTZ DEFAULT now()
-- );

-- ─── Reference Drills ─────────────────────────────────────────────
CREATE TABLE reference_drills (
    key VARCHAR(100) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    video_url TEXT,
    cues JSONB NOT NULL DEFAULT '[]',
    contraindications JSONB NOT NULL DEFAULT '[]',
    target_metrics JSONB NOT NULL DEFAULT '[]',
    -- An ORDERED, TIME-BASED 4-phase corrective program — NOT interchangeable
    -- difficulty tiers picked by athlete level. Every athlete who gets this
    -- metric's flaw progresses phase 1 -> 2 -> 3 -> 4 in order; each phase has
    -- its own FIXED exercise group, done for that phase's duration, then the
    -- whole group swaps at the phase boundary. See generateRecoveryProgram()
    -- in calendar/trainingPlan.ts for how this becomes calendar_events.
    -- Shape: [{
    --   phase: 1|2|3|4,
    --   name: "Stability"|"Strength"|"Plyometrics & Movement"|"Back to Sport",
    --   durationWeeksMin, durationWeeksMax: number,
    --   daysPerWeek: number,
    --   exercises: [{name, sets, reps, cue, rationale, sourceCitation}],
    --   advanceCriteria: string
    -- }]
    -- Populated from metric_biomechanics once a metric's research has been
    -- human-reviewed (see metric_biomechanics.reviewed_by) — '[]' means no
    -- reviewed phase content exists yet, not an error; approveSuggestion()
    -- falls back to the flat drillId/sets/reps dosing when empty.
    recovery_phases JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Metric Biomechanics (offline research pipeline output) ──────────────
-- Populated by apps/api/scripts/research/generate-metric-biomechanics.ts
-- (biometrics agent -> 2 independent checkers -> human review), then synced
-- into biomech2d.py's WHY dict, coach/knowledge.ts, and
-- reference_drills.recovery_phases ONLY once reviewed_by is set. This table
-- is the durable, auditable SOURCE — not read at runtime by the analysis
-- pipeline or the coach agent,
-- by design (see docs/research/metric-biomechanics.md).
CREATE TABLE metric_biomechanics (
    metric_key VARCHAR(100) PRIMARY KEY,      -- must match biomech2d.py NORMAL_RANGE keys exactly
    body_region VARCHAR(100) NOT NULL,
    primary_structure VARCHAR(200) NOT NULL,
    mechanism TEXT NOT NULL,
    injury_risks JSONB NOT NULL DEFAULT '[]', -- [{name, mechanism_note}]
    confidence VARCHAR(20) NOT NULL
        CHECK (confidence IN ('established','emerging','preliminary')),
    correlation_or_causal VARCHAR(20) NOT NULL
        CHECK (correlation_or_causal IN ('causal_mechanism','correlational','biomechanically_plausible')),
    hedge_note TEXT,
    citations JSONB NOT NULL DEFAULT '[]',    -- [{citation, url_or_doi, what_it_shows}]
    checker_a_verdict VARCHAR(20) NOT NULL CHECK (checker_a_verdict IN ('confirmed','partial','contradicted','no_lit_found')),
    checker_b_verdict VARCHAR(20) NOT NULL CHECK (checker_b_verdict IN ('confirmed','partial','contradicted','no_lit_found')),
    reviewed_by VARCHAR(255),                 -- human reviewer; NULL = not yet cleared to ship
    reviewed_at TIMESTAMPTZ,
    pipeline_run_id VARCHAR(100) NOT NULL,
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
