-- Migration: run against EXISTING databases (prod DSQL + any long-lived dev DB).
-- Fresh databases get this from db/schema.sql / apps/api/src/db/schema.sql.
--
-- calendar_events.completed_on: the athlete's own calendar date on the day they
-- ticked an event off. The streak now counts a day only when its completions
-- were logged on that day (apps/api/src/calendar/streak.ts), so going back and
-- marking last Tuesday done leaves Tuesday complete on the calendar without
-- rebuilding the run Tuesday broke.
--
-- Existing completed rows keep completed_on NULL on purpose. The streak query
-- reads NULL as "banked", so nobody's current streak changes when this lands.

BEGIN;

ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS completed_on DATE;

COMMIT;
