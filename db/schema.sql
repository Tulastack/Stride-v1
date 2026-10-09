-- Stride, Aurora DSQL schema (canonical).
-- Aurora DSQL is PostgreSQL-compatible. Run this against the DSQL cluster:
--   region:   us-east-1
--   endpoint: gft3jhbw2zbldbhnokioha5epm.dsql.us-east-1.on.aws
--
-- DSQL-specific rules applied throughout (these are DSQL limitations, not design choices):
--   • No `CREATE EXTENSION`, `gen_random_uuid()` is built in, so none is needed.
--   • No FOREIGN KEY constraints, referential integrity is enforced in app code.
--   • Secondary indexes use `CREATE INDEX ASYNC` (partial WHERE indexes are supported;
--     ASC/DESC sort order on index keys is not, the planner scans either direction).
--   • One DDL statement per transaction; DDL and DML never share a transaction.
--   • ALTER TABLE ADD COLUMN takes only name + type: set defaults with a separate
--     ALTER COLUMN SET DEFAULT and add CHECKs as ADD CONSTRAINT ... NOT VALID.
-- Existing databases are brought up to date with apps/api/scripts/dsql/migrate.mjs.
-- Column types, CHECK constraints, defaults, and PRIMARY KEYs mirror the
-- Postgres schema in apps/api/src/db/schema.sql exactly.

-- Connectivity smoke-test table (kept from the original DSQL bootstrap).
CREATE TABLE IF NOT EXISTS users_2 (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Users ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
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

-- ─── Analyses ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
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
CREATE INDEX ASYNC IF NOT EXISTS idx_analyses_user_id ON analyses(user_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_analyses_status ON analyses(status);
CREATE INDEX ASYNC IF NOT EXISTS idx_analyses_created ON analyses(created_at);

-- NOTE: no `conversations` table (PRD v2.2 F.5, structured-only coaching, no chat).

-- ─── Calendar Events ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('workout','rest','competition','drill','hydration','recovery','cross_training')),
    scheduled_date DATE NOT NULL,
    details JSONB,
    status VARCHAR(20) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','completed','skipped','modified')),
    completion_note TEXT,
    -- The athlete's own calendar date on the day they marked this complete.
    -- NULL until completed (and on rows that predate the column). The streak
    -- counts a day only when its completions were logged on that day.
    completed_on DATE,
    -- Who scheduled it; only coach/analysis events get the card reveal.
    source VARCHAR(10) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual','coach','analysis')),
    -- NULL = the athlete has not yet been shown the card for this event.
    revealed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_calendar_user_date ON calendar_events(user_id, scheduled_date);
CREATE INDEX ASYNC IF NOT EXISTS idx_calendar_unrevealed ON calendar_events(user_id, scheduled_date)
    WHERE revealed_at IS NULL AND source <> 'manual';

-- ─── Coach Sessions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    analysis_id UUID,
    session_type VARCHAR(20) NOT NULL CHECK (session_type IN ('analysis_workflow','free_coach')),
    status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
    last_activity_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_coach_sessions_user ON coach_sessions(user_id);
CREATE INDEX ASYNC IF NOT EXISTS idx_coach_sessions_analysis ON coach_sessions(analysis_id);

-- ─── Drill Suggestions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drill_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID NOT NULL,
    user_id UUID NOT NULL,
    drill_key VARCHAR(100) NOT NULL,
    drill_name VARCHAR(200) NOT NULL,
    suggested_date DATE NOT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','skipped')),
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_drill_suggestions_unique ON drill_suggestions(analysis_id, drill_key);
CREATE INDEX ASYNC IF NOT EXISTS idx_drill_suggestions_user ON drill_suggestions(user_id);

-- ─── Suggestion Audit ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestion_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id UUID NOT NULL,
    user_id UUID NOT NULL,
    action VARCHAR(10) NOT NULL CHECK (action IN ('approved','skipped')),
    acted_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Reference Drills ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reference_drills (
    key VARCHAR(100) PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    video_url TEXT,
    cues JSONB NOT NULL DEFAULT '[]',
    contraindications JSONB NOT NULL DEFAULT '[]',
    target_metrics JSONB NOT NULL DEFAULT '[]',
    -- Ordered 4-phase corrective program; '[]' = no reviewed content yet.
    recovery_phases JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Metric Biomechanics (offline research pipeline output) ──────
CREATE TABLE IF NOT EXISTS metric_biomechanics (
    metric_key VARCHAR(100) PRIMARY KEY,
    body_region VARCHAR(100) NOT NULL,
    primary_structure VARCHAR(200) NOT NULL,
    mechanism TEXT NOT NULL,
    injury_risks JSONB NOT NULL DEFAULT '[]',
    confidence VARCHAR(20) NOT NULL
        CHECK (confidence IN ('established','emerging','preliminary')),
    correlation_or_causal VARCHAR(30) NOT NULL
        CHECK (correlation_or_causal IN ('causal_mechanism','correlational','biomechanically_plausible')),
    hedge_note TEXT,
    citations JSONB NOT NULL DEFAULT '[]',
    checker_a_verdict VARCHAR(20) NOT NULL CHECK (checker_a_verdict IN ('confirmed','partial','contradicted','no_lit_found')),
    checker_b_verdict VARCHAR(20) NOT NULL CHECK (checker_b_verdict IN ('confirmed','partial','contradicted','no_lit_found')),
    reviewed_by VARCHAR(255),
    reviewed_at TIMESTAMPTZ,
    pipeline_run_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Metrics Timeline ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics_timeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    analysis_id UUID NOT NULL,
    metric_key VARCHAR(100) NOT NULL,
    value NUMERIC(8,2) NOT NULL,
    unit VARCHAR(50),
    optimal_min NUMERIC(8,2),
    optimal_max NUMERIC(8,2),
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ASYNC IF NOT EXISTS idx_metrics_user_key ON metrics_timeline(user_id, metric_key, measured_at);
CREATE INDEX ASYNC IF NOT EXISTS idx_metrics_analysis ON metrics_timeline(analysis_id);
-- Idempotent reprocessing: one row per metric per analysis.
CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_metrics_analysis_metric ON metrics_timeline(analysis_id, metric_key);
