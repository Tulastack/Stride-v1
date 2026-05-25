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
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','completed','failed')),
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

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    analysis_id UUID REFERENCES analyses(id) ON DELETE SET NULL,
    messages JSONB NOT NULL DEFAULT '[]',
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_conversations_user_id ON conversations(user_id);

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('workout','rest','competition','drill')),
    scheduled_date DATE NOT NULL,
    details JSONB,
    status VARCHAR(20) DEFAULT 'scheduled'
        CHECK (status IN ('scheduled','completed','skipped','modified')),
    completion_note TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_calendar_user_date ON calendar_events(user_id, scheduled_date);

-- Migration: Add consent fields (run against existing DBs)
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS parental_consent BOOLEAN NOT NULL DEFAULT FALSE;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS drill_intensity_cap VARCHAR(20) CHECK (drill_intensity_cap IN ('moderate','full'));
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS is_injured BOOLEAN NOT NULL DEFAULT FALSE;
