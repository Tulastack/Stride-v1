import pg from 'pg';
import type { User, Analysis, CalendarEvent, CoachSession, DrillSuggestion, ReferenceDrill, MetricsTimelineRow } from '../types.js';
import { dbConnectionConfig } from './dsql.js';
import { generateDrillProgram, generateRecoveryProgram, type RecoveryPhase } from '../calendar/trainingPlan.js';

const { Pool } = pg;

// Return DATE columns (OID 1082) as raw 'YYYY-MM-DD' strings, NOT JS Date objects.
// node-pg's default Date parsing serializes to a full ISO timestamp and can shift
// the day across timezones — which silently broke calendar grouping (scheduled_date
// compared against 'YYYY-MM-DD') and drill-suggestion date validation.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new Pool({
  ...dbConnectionConfig(), // DATABASE_URL by default; Aurora DSQL (token+TLS) when DSQL_ENDPOINT is set
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// ─── Users ────────────────────────────────────────────────────────

export async function getUserBySupabaseUid(supabaseUid: string): Promise<User | null> {
  const { rows } = await pool.query<User>(
    'SELECT * FROM users WHERE supabase_uid = $1',
    [supabaseUid],
  );
  return rows[0] ?? null;
}

export async function createUser(supabaseUid: string, email: string): Promise<User> {
  try {
    const { rows } = await pool.query<User>(
      `INSERT INTO users (supabase_uid, email)
       VALUES ($1, $2)
       ON CONFLICT (supabase_uid) DO UPDATE SET email = EXCLUDED.email
       RETURNING *`,
      [supabaseUid, email],
    );
    return rows[0]!;
  } catch (err) {
    // users.email is UNIQUE. A user who deleted their auth account and signed
    // up again arrives with a NEW supabase_uid + the SAME email; re-link the
    // existing row instead of failing every request with a 401 forever.
    if ((err as { code?: string }).code === '23505' && email) {
      const { rows } = await pool.query<User>(
        `UPDATE users SET supabase_uid = $1 WHERE email = $2 RETURNING *`,
        [supabaseUid, email],
      );
      if (rows[0]) return rows[0];
    }
    throw err;
  }
}

export async function updateUser(
  userId: string,
  fields: {
    display_name?: string;
    event_specialty?: string;
    experience_level?: string;
    personal_best_seconds?: number;
  },
): Promise<User | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (fields.display_name !== undefined) {
    setClauses.push(`display_name = $${paramIndex++}`);
    values.push(fields.display_name);
  }
  if (fields.event_specialty !== undefined) {
    setClauses.push(`event_specialty = $${paramIndex++}`);
    values.push(fields.event_specialty);
  }
  if (fields.experience_level !== undefined) {
    setClauses.push(`experience_level = $${paramIndex++}`);
    values.push(fields.experience_level);
  }
  if (fields.personal_best_seconds !== undefined) {
    setClauses.push(`personal_best_seconds = $${paramIndex++}`);
    values.push(fields.personal_best_seconds);
  }

  if (setClauses.length === 0) return null;

  values.push(userId);
  const { rows } = await pool.query<User>(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

export async function recordConsent(
  userId: string,
  fields: {
    consent_version: number;
    date_of_birth?: string | null;
    parental_consent?: boolean;
    drill_intensity_cap?: 'moderate' | 'full' | null;
  },
): Promise<User> {
  const setClauses: string[] = ['consent_given_at = now()', `consent_version = $1`];
  const values: unknown[] = [fields.consent_version];
  let paramIndex = 2;

  if (fields.date_of_birth !== undefined) {
    setClauses.push(`date_of_birth = $${paramIndex++}`);
    values.push(fields.date_of_birth ?? null);
  }
  if (fields.parental_consent !== undefined) {
    setClauses.push(`parental_consent = $${paramIndex++}`);
    values.push(fields.parental_consent);
  }
  if (fields.drill_intensity_cap !== undefined) {
    setClauses.push(`drill_intensity_cap = $${paramIndex++}`);
    values.push(fields.drill_intensity_cap ?? null);
  }

  values.push(userId);
  const { rows } = await pool.query<User>(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values,
  );
  return rows[0]!;
}

export async function updateInjuryStatus(userId: string, is_injured: boolean): Promise<User | null> {
  const { rows } = await pool.query<User>(
    'UPDATE users SET is_injured = $1 WHERE id = $2 RETURNING *',
    [is_injured, userId],
  );
  return rows[0] ?? null;
}

// ─── Analyses ─────────────────────────────────────────────────────

export async function createAnalysis(userId: string, s3Key: string): Promise<Analysis> {
  // 'uploading' — NOT 'pending'. The ML worker claims pending rows; if we mark
  // pending at upload-url time it races the phone's PUT and fails with
  // "video not found in local storage". Finalize promotes to pending.
  const { rows } = await pool.query<Analysis>(
    `INSERT INTO analyses (user_id, s3_key, status)
     VALUES ($1, $2, 'uploading')
     RETURNING *`,
    [userId, s3Key],
  );
  return rows[0]!;
}

export async function updateAnalysisStatus(
  analysisId: string,
  update: {
    status: Analysis['status'];
    overall_score?: number | null;
    result_json?: Record<string, unknown> | null;
    error_message?: string | null;
    movenet_version?: string | null;
  },
): Promise<Analysis | null> {
  const isTerminal = update.status === 'completed' || update.status === 'failed';
  const { rows } = await pool.query<Analysis>(
    `UPDATE analyses
     SET status = $1::text,
         overall_score = COALESCE($2, overall_score),
         result_json = COALESCE($3, result_json),
         error_message = CASE WHEN $1::text = 'completed' THEN NULL ELSE COALESCE($4, error_message) END,
         movenet_version = COALESCE($5, movenet_version),
         completed_at = ${isTerminal ? 'now()' : 'completed_at'}
     WHERE id = $6
       AND status NOT IN ('completed','failed')
     RETURNING *`,
    // Terminal rows are immutable: a duplicate/late worker callback or an SQS
    // redelivery must never overwrite a completed/failed verdict (e.g. a swept
    // 'failed' row silently flipping to 'completed' after the user saw failure).
    [update.status, update.overall_score ?? null, update.result_json ? JSON.stringify(update.result_json) : null, update.error_message ?? null, update.movenet_version ?? null, analysisId],
  );
  return rows[0] ?? null;
}

export async function getAnalysis(analysisId: string, userId: string): Promise<Analysis | null> {
  const { rows } = await pool.query<Analysis>(
    'SELECT * FROM analyses WHERE id = $1 AND user_id = $2',
    [analysisId, userId],
  );
  return rows[0] ?? null;
}

export async function getAnalysisByIdOnly(analysisId: string): Promise<Analysis | null> {
  const { rows } = await pool.query<Analysis>(
    'SELECT * FROM analyses WHERE id = $1',
    [analysisId],
  );
  return rows[0] ?? null;
}

export async function getAnalysesByUser(userId: string): Promise<Analysis[]> {
  const { rows } = await pool.query<Analysis>(
    'SELECT * FROM analyses WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  return rows;
}

// ─── Conversations ────────────────────────────────────────────────
// REMOVED (PRD v2.2 F.5 vision retention): the conversations table and all
// free-text chat persistence are gone. Coaching is structured-only (briefings,
// typed slots), never an open message stream.

// ─── Calendar Events ──────────────────────────────────────────────

export async function createCalendarEvent(
  userId: string,
  event: {
    title: string;
    event_type: string;
    scheduled_date: string;
    details?: Record<string, unknown> | null;
  },
): Promise<CalendarEvent> {
  const { rows } = await pool.query<CalendarEvent>(
    `INSERT INTO calendar_events (user_id, title, event_type, scheduled_date, details)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, event.title, event.event_type, event.scheduled_date, event.details ? JSON.stringify(event.details) : null],
  );
  return rows[0]!;
}

export async function createCalendarEvents(
  userId: string,
  events: {
    title: string;
    event_type: string;
    scheduled_date: string;
    details?: Record<string, unknown> | null;
  }[],
): Promise<CalendarEvent[]> {
  if (events.length === 0) return [];

  const valueClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const event of events) {
    valueClauses.push(
      `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
    );
    values.push(userId, event.title, event.event_type, event.scheduled_date, event.details ? JSON.stringify(event.details) : null);
  }

  const { rows } = await pool.query<CalendarEvent>(
    `INSERT INTO calendar_events (user_id, title, event_type, scheduled_date, details)
     VALUES ${valueClauses.join(', ')}
     RETURNING *`,
    values,
  );
  return rows;
}

export async function getCalendarEvents(
  userId: string,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const { rows } = await pool.query<CalendarEvent>(
    `SELECT * FROM calendar_events
     WHERE user_id = $1 AND scheduled_date >= $2 AND scheduled_date <= $3
     ORDER BY scheduled_date ASC`,
    [userId, from, to],
  );
  return rows;
}

export async function updateCalendarEvent(
  eventId: string,
  userId: string,
  fields: { status?: string; completion_note?: string },
): Promise<CalendarEvent | null> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (fields.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    values.push(fields.status);
  }
  if (fields.completion_note !== undefined) {
    setClauses.push(`completion_note = $${paramIndex++}`);
    values.push(fields.completion_note);
  }

  if (setClauses.length === 0) return null;

  values.push(eventId, userId);
  const { rows } = await pool.query<CalendarEvent>(
    `UPDATE calendar_events SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
}

// ─── Coach Sessions ───────────────────────────────────────────────

export async function createCoachSession(
  userId: string,
  sessionType: 'analysis_workflow' | 'free_coach',
  analysisId?: string | null,
): Promise<CoachSession> {
  const { rows } = await pool.query<CoachSession>(
    `INSERT INTO coach_sessions (user_id, session_type, analysis_id)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, sessionType, analysisId ?? null],
  );
  return rows[0]!;
}

export async function getCoachSession(sessionId: string, userId: string): Promise<CoachSession | null> {
  const { rows } = await pool.query<CoachSession>(
    'SELECT * FROM coach_sessions WHERE id = $1 AND user_id = $2',
    [sessionId, userId],
  );
  return rows[0] ?? null;
}

export async function getCoachSessionsByUser(userId: string): Promise<CoachSession[]> {
  const { rows } = await pool.query<CoachSession>(
    'SELECT * FROM coach_sessions WHERE user_id = $1 ORDER BY last_activity_at DESC',
    [userId],
  );
  return rows;
}

export async function touchCoachSession(sessionId: string): Promise<void> {
  await pool.query(
    'UPDATE coach_sessions SET last_activity_at = now() WHERE id = $1',
    [sessionId],
  );
}

export async function sealCoachSession(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE coach_sessions SET status = 'closed' WHERE id = $1`,
    [sessionId],
  );
}

export async function sealInactiveSessions(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE coach_sessions
     SET status = 'closed'
     WHERE status = 'open'
       AND last_activity_at < now() - INTERVAL '24 hours'`,
  );
  return rowCount ?? 0;
}

// ─── Drill Suggestions ────────────────────────────────────────────

export async function createDrillSuggestions(
  suggestions: {
    analysis_id: string;
    user_id: string;
    drill_key: string;
    drill_name: string;
    suggested_date: string;
  }[],
): Promise<DrillSuggestion[]> {
  if (suggestions.length === 0) return [];

  const valueClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const s of suggestions) {
    valueClauses.push(
      `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
    );
    values.push(s.analysis_id, s.user_id, s.drill_key, s.drill_name, s.suggested_date);
  }

  const { rows } = await pool.query<DrillSuggestion>(
    `INSERT INTO drill_suggestions (analysis_id, user_id, drill_key, drill_name, suggested_date)
     VALUES ${valueClauses.join(', ')}
     ON CONFLICT (analysis_id, drill_key) DO NOTHING
     RETURNING *`,
    values,
  );
  return rows;
}

export async function getDrillSuggestion(id: string, userId: string): Promise<DrillSuggestion | null> {
  const { rows } = await pool.query<DrillSuggestion>(
    'SELECT * FROM drill_suggestions WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function getSuggestionsByAnalysis(analysisId: string, userId: string): Promise<DrillSuggestion[]> {
  const { rows } = await pool.query<DrillSuggestion>(
    'SELECT * FROM drill_suggestions WHERE analysis_id = $1 AND user_id = $2 ORDER BY created_at ASC',
    [analysisId, userId],
  );
  return rows;
}

export async function approveSuggestion(
  id: string,
  userId: string,
): Promise<{ suggestion: DrillSuggestion; calendarEvent: CalendarEvent; plan: CalendarEvent[] } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: suggRows } = await client.query<DrillSuggestion>(
      'SELECT * FROM drill_suggestions WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    const suggestion = suggRows[0];
    if (!suggestion) {
      await client.query('ROLLBACK');
      return null;
    }

    // Idempotent: if already approved, return the existing program (every
    // session tagged with this suggestion's id) instead of building a second one.
    if (suggestion.status === 'approved') {
      const { rows: planRows } = await client.query<CalendarEvent>(
        `SELECT * FROM calendar_events WHERE user_id = $1 AND details->>'drill_suggestion_id' = $2 ORDER BY scheduled_date ASC`,
        [userId, id],
      );
      if (planRows.length > 0) {
        await client.query('COMMIT');
        return { suggestion, calendarEvent: planRows[0]!, plan: planRows };
      }
      // Legacy approvals predate program tagging: their single event matches
      // on title/date instead of drill_suggestion_id. Return it rather than
      // silently stacking a whole new program on top of it — only a true
      // drift (no event at all) falls through to the rebuild below.
      const { rows: legacyRows } = await client.query<CalendarEvent>(
        `SELECT * FROM calendar_events
         WHERE user_id = $1 AND scheduled_date = $2 AND title = $3
         LIMIT 1`,
        [userId, suggestion.suggested_date, suggestion.drill_name],
      );
      if (legacyRows.length > 0) {
        await client.query('COMMIT');
        return { suggestion, calendarEvent: legacyRows[0]!, plan: legacyRows };
      }
    }

    let updatedSuggestion = suggestion;
    if (suggestion.status !== 'approved') {
      // Update suggestion status
      const { rows: updatedSuggRows } = await client.query<DrillSuggestion>(
        `UPDATE drill_suggestions SET status = 'approved' WHERE id = $1 RETURNING *`,
        [id],
      );
      updatedSuggestion = updatedSuggRows[0]!;

      // Write audit record
      await client.query(
        `INSERT INTO suggestion_audit (suggestion_id, user_id, action) VALUES ($1, $2, 'approved')`,
        [id, userId],
      );
    }

    // Pull sets/reps/cue for this drill from the source analysis's recommendations
    // (already computed by the analysis engine) so the program uses real,
    // structured volume instead of guessed numbers. Also pull the source
    // flaw's severity (via the recommendation's flawId) so plan frequency can
    // react to how big this specific fault is.
    const { rows: analysisRows } = await client.query<{ result_json: Record<string, unknown> | null }>(
      'SELECT result_json FROM analyses WHERE id = $1',
      [updatedSuggestion.analysis_id],
    );
    const recommendations = (analysisRows[0]?.result_json as any)?.recommendations as
      | { flawId?: string; drillId: string; sets?: number; reps?: number; cue?: string }[]
      | undefined;
    const flaws = (analysisRows[0]?.result_json as any)?.flaws as
      | { id: string; severity?: 1 | 2 | 3 }[]
      | undefined;
    const rec = recommendations?.find((r) => r.drillId === updatedSuggestion.drill_key);
    const flaw = flaws?.find((f) => f.id === rec?.flawId);

    // Athlete context that shapes plan length/frequency/progression (see
    // calendar/trainingPlan.ts AthleteProgramInput) — reuses the open
    // transaction client rather than a separate pooled query.
    const { rows: userRows } = await client.query<{
      experience_level: 'beginner' | 'intermediate' | 'advanced' | null;
      is_injured: boolean;
      drill_intensity_cap: 'moderate' | 'full' | null;
    }>(
      'SELECT experience_level, is_injured, drill_intensity_cap FROM users WHERE id = $1',
      [userId],
    );
    const athlete = userRows[0]
      ? {
          experienceLevel: userRows[0].experience_level,
          isInjured: userRows[0].is_injured,
          drillIntensityCap: userRows[0].drill_intensity_cap,
          flawSeverity: flaw?.severity ?? null,
        }
      : undefined;

    // "Why this drill" text for the calendar detail view — already sitting
    // unused on reference_drills, so no schema change needed to surface it.
    const { rows: refDrillRows } = await client.query<{
      description: string | null;
      cues: string[];
      recovery_phases: RecoveryPhase[];
    }>(
      'SELECT description, cues, recovery_phases FROM reference_drills WHERE key = $1',
      [updatedSuggestion.drill_key],
    );
    const refDrill = refDrillRows[0];

    // Two program shapes, chosen by whether this drill's metric has been
    // through the offline research pipeline AND human-reviewed
    // (reference_drills.recovery_phases non-empty). Reviewed metrics get the
    // real 4-phase recovery arc (Stability -> Strength -> Plyometrics &
    // Movement -> Back to Sport); everything else falls back to the
    // original flat, progressively-loaded single-drill block — never an
    // error, just less content than a reviewed metric has earned.
    const sessions =
      refDrill?.recovery_phases && refDrill.recovery_phases.length > 0
        ? generateRecoveryProgram(
            updatedSuggestion.drill_key,
            refDrill.recovery_phases,
            updatedSuggestion.id,
            updatedSuggestion.suggested_date,
          )
        : generateDrillProgram(
            {
              drillKey: updatedSuggestion.drill_key,
              drillName: updatedSuggestion.drill_name,
              cue: rec?.cue ?? '',
              sets: rec?.sets ?? 3,
              reps: rec?.reps ?? 10,
              why: refDrill?.description ?? undefined,
              cues: refDrill?.cues,
            },
            updatedSuggestion.id,
            updatedSuggestion.suggested_date,
            athlete,
          );

    const valueClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;
    for (const s of sessions) {
      valueClauses.push(`($${paramIndex++}, $${paramIndex++}, 'drill', $${paramIndex++}, $${paramIndex++})`);
      values.push(userId, s.title, s.scheduledDate, JSON.stringify(s.details));
    }

    const { rows: evtRows } = await client.query<CalendarEvent>(
      `INSERT INTO calendar_events (user_id, title, event_type, scheduled_date, details)
       VALUES ${valueClauses.join(', ')}
       RETURNING *`,
      values,
    );

    await client.query('COMMIT');
    return { suggestion: updatedSuggestion, calendarEvent: evtRows[0]!, plan: evtRows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function skipSuggestion(id: string, userId: string): Promise<DrillSuggestion | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: suggRows } = await client.query<DrillSuggestion>(
      'SELECT * FROM drill_suggestions WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    const suggestion = suggRows[0];
    if (!suggestion) {
      await client.query('ROLLBACK');
      return null;
    }

    const { rows: updatedRows } = await client.query<DrillSuggestion>(
      `UPDATE drill_suggestions SET status = 'skipped' WHERE id = $1 RETURNING *`,
      [id],
    );

    await client.query(
      `INSERT INTO suggestion_audit (suggestion_id, user_id, action) VALUES ($1, $2, 'skipped')`,
      [id, userId],
    );

    await client.query('COMMIT');
    return updatedRows[0]!;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function sweepExpiredSuggestions(): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: expiredRows } = await client.query<DrillSuggestion>(
      `SELECT id, user_id FROM drill_suggestions
       WHERE status = 'pending'
         AND created_at < now() - INTERVAL '7 days'`,
    );

    if (expiredRows.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    const ids = expiredRows.map((r) => r.id);

    await client.query(
      `UPDATE drill_suggestions SET status = 'skipped' WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    const auditValues: unknown[] = [];
    const auditClauses: string[] = [];
    let paramIndex = 1;
    for (const row of expiredRows) {
      auditClauses.push(`($${paramIndex++}, $${paramIndex++}, 'skipped')`);
      auditValues.push(row.id, row.user_id);
    }

    await client.query(
      `INSERT INTO suggestion_audit (suggestion_id, user_id, action) VALUES ${auditClauses.join(', ')}`,
      auditValues,
    );

    await client.query('COMMIT');
    return expiredRows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Reference Drills ─────────────────────────────────────────────

export async function getReferenceDrill(key: string): Promise<ReferenceDrill | null> {
  const { rows } = await pool.query<ReferenceDrill>(
    'SELECT * FROM reference_drills WHERE key = $1',
    [key],
  );
  return rows[0] ?? null;
}

export async function getAllReferencedrills(): Promise<ReferenceDrill[]> {
  const { rows } = await pool.query<ReferenceDrill>(
    'SELECT * FROM reference_drills ORDER BY name ASC',
  );
  return rows;
}

export async function validateDrillKeys(
  keys: string[],
): Promise<{ valid: string[]; invalid: string[] }> {
  if (keys.length === 0) return { valid: [], invalid: [] };
  const { rows } = await pool.query<{ key: string }>(
    'SELECT key FROM reference_drills WHERE key = ANY($1::text[])',
    [keys],
  );
  const validSet = new Set(rows.map((r) => r.key));
  const valid = keys.filter((k) => validSet.has(k));
  const invalid = keys.filter((k) => !validSet.has(k));
  return { valid, invalid };
}

// ─── Metrics Timeline ─────────────────────────────────────────────

const TRACKED_METRIC_KEYS = new Set([
  'knee_drive_angle',
  'torso_lean',
  'arm_angle',
  'hip_extension',
  'ground_contact_time',
]);

function parseMeasuredValue(raw: unknown): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const parsed = parseFloat(String(raw));
  if (isNaN(parsed)) return null;
  return parsed;
}

function parseUnit(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/[a-zA-Z°%]+/);
  return match ? match[0] : null;
}

function parseOptimalRange(raw: unknown): { min: number | null, max: number | null } {
  if (typeof raw !== 'string') return { min: null, max: null };
  const matches = raw.match(/([0-9.]+)[^0-9.]+([0-9.]+)/);
  if (matches && matches.length >= 3) {
    return { min: parseFloat(matches[1]!), max: parseFloat(matches[2]!) };
  }
  return { min: null, max: null };
}

export async function createMetricsFromAnalysis(
  userId: string,
  analysisId: string,
  resultJson: Record<string, unknown>,
): Promise<MetricsTimelineRow[]> {
  const rowsToInsert: { metricKey: string; value: number; unit: string | null; optimal_min: number | null; optimal_max: number | null }[] = [];

  // PRD v2.2 metrics[] from WHAM+OpenCap pipeline
  const v2Metrics = resultJson.metrics;
  const v2KeyMap: Record<string, string> = {
    trunk_lean: 'torso_lean',
    knee_drive: 'knee_drive_angle',
    hip_extension: 'hip_extension',
    contact_time_ms: 'ground_contact_time',
    cadence_spm: 'cadence_spm',
  };
  if (Array.isArray(v2Metrics)) {
    for (const m of v2Metrics) {
      if (typeof m !== 'object' || m === null) continue;
      const key = (m as Record<string, unknown>).key as string;
      const mapped = v2KeyMap[key] ?? key;
      if (!TRACKED_METRIC_KEYS.has(mapped)) continue;
      const measured = (m as Record<string, unknown>).measured as Record<string, unknown> | undefined;
      const value = typeof measured?.value === 'number' ? measured.value : null;
      if (value === null) continue;
      const unit = typeof (m as Record<string, unknown>).unit === 'string' ? ((m as Record<string, unknown>).unit as string) : null;
      const nr = (m as Record<string, unknown>).normalRange as [number, number] | undefined;
      rowsToInsert.push({
        metricKey: mapped,
        value,
        unit,
        optimal_min: nr?.[0] ?? null,
        optimal_max: nr?.[1] ?? null,
      });
    }
  }

  const primaryIssues = resultJson.primary_issues;
  const typeToMetricKey: Record<string, string> = {
    'low_knee_drive': 'knee_drive_angle',
    'excessive_forward_lean': 'torso_lean',
    'insufficient_arm_drive': 'arm_angle',
    'low_hip_extension': 'hip_extension',
    'overstriding': 'ground_contact_time',
  };

  if (Array.isArray(primaryIssues)) {
    for (const issue of primaryIssues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const issueType = (issue as Record<string, unknown>).type as string;
    const rawMetricKey = (issue as Record<string, unknown>).metric_key as string;
    const metricKey = rawMetricKey || typeToMetricKey[issueType];
    const measuredValue = (issue as Record<string, unknown>).measured_value;
    const optimalRange = (issue as Record<string, unknown>).optimal_range;

    if (typeof metricKey !== 'string' || !TRACKED_METRIC_KEYS.has(metricKey)) continue;

    const value = parseMeasuredValue(measuredValue);
    if (value === null) continue;

    const unit = parseUnit(measuredValue);
    const { min: optimal_min, max: optimal_max } = parseOptimalRange(optimalRange);

    rowsToInsert.push({ metricKey, value, unit, optimal_min, optimal_max });
    }
  }

  if (rowsToInsert.length === 0) return [];

  // One row per metric per analysis: dedupe within the batch (a metric can
  // arrive via both metrics[] and primary_issues[]), and ON CONFLICT makes
  // reprocessing (SQS redelivery / finalize retry) idempotent instead of
  // stacking duplicate rows that skew trend averages.
  const byKey = new Map<string, (typeof rowsToInsert)[number]>();
  for (const row of rowsToInsert) {
    if (!byKey.has(row.metricKey)) byKey.set(row.metricKey, row);
  }

  const valueClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const row of byKey.values()) {
    valueClauses.push(
      `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
    );
    values.push(userId, analysisId, row.metricKey, row.value, row.unit, row.optimal_min, row.optimal_max);
  }

  const { rows } = await pool.query<MetricsTimelineRow>(
    `INSERT INTO metrics_timeline (user_id, analysis_id, metric_key, value, unit, optimal_min, optimal_max)
     VALUES ${valueClauses.join(', ')}
     ON CONFLICT (analysis_id, metric_key) DO NOTHING
     RETURNING *`,
    values,
  );
  return rows;
}

export async function getMetricsTimeline(
  userId: string,
  days: number,
): Promise<MetricsTimelineRow[]> {
  const { rows } = await pool.query<MetricsTimelineRow>(
    `SELECT * FROM metrics_timeline
     WHERE user_id = $1
       AND measured_at >= now() - ($2 || ' days')::INTERVAL
     ORDER BY metric_key ASC, measured_at DESC`,
    [userId, days],
  );
  return rows;
}

export async function getMetricsTrend(
  userId: string,
  metricKey: string,
  weeks: number,
): Promise<{ week: string; avg_value: number }[]> {
  const { rows } = await pool.query<{ week: string; avg_value: number }>(
    `SELECT
       to_char(date_trunc('week', measured_at), 'YYYY-MM-DD') AS week,
       AVG(value)::float AS avg_value
     FROM metrics_timeline
     WHERE user_id = $1
       AND metric_key = $2
       AND measured_at >= now() - ($3 || ' weeks')::INTERVAL
     GROUP BY date_trunc('week', measured_at)
     ORDER BY date_trunc('week', measured_at) ASC`,
    [userId, metricKey, weeks],
  );
  return rows;
}

// ─── Sweep stuck analyses ─────────────────────────────────────────
// Every non-terminal state needs a timeout, or a crash at the wrong moment
// leaves the user staring at a spinner forever:
//   uploading  — client died before finalize (generous window for slow LTE)
//   pending    — queued but never claimed (worker down / backlog)
//   processing — worker died mid-job (OOM, deploy) and never released the row

export async function sweepStuckAnalyses(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE analyses
     SET status = 'failed',
         error_message = CASE
           WHEN status = 'uploading' THEN 'upload_abandoned'
           WHEN status = 'processing' THEN 'worker_timeout'
           ELSE 'analysis_timeout'
         END,
         completed_at = now()
     WHERE (status = 'pending'    AND created_at < now() - INTERVAL '30 minutes')
        OR (status = 'processing' AND created_at < now() - INTERVAL '45 minutes')
        OR (status = 'uploading'  AND created_at < now() - INTERVAL '6 hours')`,
  );
  return rowCount ?? 0;
}

// ─── Account deletion (App Store 5.1.1(v)) ────────────────────────
// Deleting the users row cascades through analyses, calendar_events,
// coach_sessions, drill_suggestions, suggestion_audit and metrics_timeline
// (all FK ON DELETE CASCADE).

export async function deleteUserAccount(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ supabase_uid: string }>(
    'DELETE FROM users WHERE id = $1 RETURNING supabase_uid',
    [userId],
  );
  return rows[0]?.supabase_uid ?? null;
}
