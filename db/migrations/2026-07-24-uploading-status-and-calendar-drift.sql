-- Migration: run against EXISTING databases (prod DSQL + any long-lived dev DB).
-- Fresh databases get all of this from db/schema.sql / apps/api/src/db/schema.sql.
--
-- 1) analyses.status gains 'uploading' (upload race fix):
--    rows are created 'uploading' at /videos/upload-url and promoted to
--    'pending' by /videos/finalize once the bytes exist, so the ML worker can
--    no longer claim a row before its video arrives.
--    WITHOUT THIS, the new API fails every upload with a CHECK violation.
--
-- 2) calendar_events.event_type drift fix: prod (DSQL) schema only allowed
--    ('workout','rest','competition','drill') while the API zod schema, the
--    coach prompt, and the app also emit 'hydration','recovery','cross_training'.
--
-- NOTE for Aurora DSQL: verify ALTER TABLE DROP/ADD CONSTRAINT support on your
-- cluster version before running (test on a scratch cluster first). If ADD
-- CONSTRAINT is unsupported, recreate the tables per DSQL migration guidance.

BEGIN;

-- ── analyses.status: allow 'uploading', keep default at 'uploading' ─────────
ALTER TABLE analyses ALTER COLUMN status SET DEFAULT 'uploading';
ALTER TABLE analyses DROP CONSTRAINT IF EXISTS analyses_status_check;
ALTER TABLE analyses ADD CONSTRAINT analyses_status_check
    CHECK (status IN ('uploading','pending','processing','completed','failed'));

-- ── calendar_events.event_type: allow athlete-added lifestyle events ────────
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_event_type_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_event_type_check
    CHECK (event_type IN ('workout','rest','competition','drill','hydration','recovery','cross_training'));

COMMIT;

-- ── metrics_timeline: one row per metric per analysis (idempotent reprocessing)
-- Run OUTSIDE the transaction on DSQL (ASYNC index). Deduplicate first if the
-- table already has duplicates:
--   DELETE FROM metrics_timeline a USING metrics_timeline b
--    WHERE a.id > b.id AND a.analysis_id = b.analysis_id AND a.metric_key = b.metric_key;
-- Plain Postgres:
--   CREATE UNIQUE INDEX IF NOT EXISTS idx_metrics_analysis_metric ON metrics_timeline(analysis_id, metric_key);
-- Aurora DSQL:
--   CREATE UNIQUE INDEX ASYNC IF NOT EXISTS idx_metrics_analysis_metric ON metrics_timeline(analysis_id, metric_key);
