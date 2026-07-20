import pg from 'pg';
import type { User, Analysis, CalendarEvent, CoachSession, DrillSuggestion, ReferenceDrill, MetricsTimelineRow } from '../types.js';
import { dbConnectionConfig } from './dsql.js';

const { Pool, types } = pg;

// Return DATE columns (OID 1082) as the raw 'YYYY-MM-DD' string instead of a JS
// Date. Our types declare these as strings (scheduled_date, suggested_date,
// date_of_birth), and the mobile calendar matches days by exact 'YYYY-MM-DD'
// string — a Date would serialize to a full ISO timestamp and never match, so
// no events would render. (Age calc uses new Date(...), which accepts the string.)
types.setTypeParser(types.builtins.DATE, (v) => v);

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
  // Get-or-create for the auth path. Two hazards under concurrent first-login:
  //   • users.email is ALSO unique, so the ON CONFLICT (supabase_uid) arbiter
  //     doesn't cover an email-index collision → intermittent 23505.
  //   • ON CONFLICT DO UPDATE takes a row lock across BOTH unique indexes and
  //     can deadlock (40P01) when sessions acquire them in different orders.
  // DO NOTHING avoids the update-lock deadlock; the select-fallback + bounded
  // retry make the whole thing race-proof (the row always exists on conflict).
  for (let attempt = 0; ; attempt++) {
    try {
      const { rows } = await pool.query<User>(
        `INSERT INTO users (supabase_uid, email)
         VALUES ($1, $2)
         ON CONFLICT (supabase_uid) DO NOTHING
         RETURNING *`,
        [supabaseUid, email],
      );
      if (rows[0]) return rows[0];
      const existing = await getUserBySupabaseUid(supabaseUid);
      if (existing) return existing;
      // No row returned and none found: a racing insert hasn't committed yet.
      if (attempt >= 3) throw new Error(`createUser: could not resolve user ${supabaseUid}`);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if ((code === '23505' || code === '40P01') && attempt < 3) continue;
      throw err;
    }
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
  const { rows } = await pool.query<Analysis>(
    `INSERT INTO analyses (user_id, s3_key, status)
     VALUES ($1, $2, 'pending')
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
  const completedAt = update.status === 'completed' || update.status === 'failed' ? 'now()' : null;
  const { rows } = await pool.query<Analysis>(
    `UPDATE analyses
     SET status = $1,
         overall_score = COALESCE($2, overall_score),
         result_json = COALESCE($3, result_json),
         error_message = COALESCE($4, error_message),
         movenet_version = COALESCE($5, movenet_version),
         completed_at = COALESCE(${completedAt ? `now()` : `$6`}, completed_at)
     WHERE id = ${completedAt ? '$6' : '$7'}
     RETURNING *`,
    completedAt
      ? [update.status, update.overall_score ?? null, update.result_json ? JSON.stringify(update.result_json) : null, update.error_message ?? null, update.movenet_version ?? null, analysisId]
      : [update.status, update.overall_score ?? null, update.result_json ? JSON.stringify(update.result_json) : null, update.error_message ?? null, update.movenet_version ?? null, null, analysisId],
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
): Promise<{ suggestion: DrillSuggestion; calendarEvent: CalendarEvent } | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE row-locks the suggestion so concurrent approvals (double-tap,
    // two devices, a retried request) serialize here instead of all reading
    // 'pending' and each inserting a duplicate calendar event.
    const { rows: suggRows } = await client.query<DrillSuggestion>(
      'SELECT * FROM drill_suggestions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    const suggestion = suggRows[0];
    if (!suggestion) {
      await client.query('ROLLBACK');
      return null;
    }

    // Idempotent: if already approved, return existing calendar_event
    if (suggestion.status === 'approved') {
      const { rows: evtRows } = await client.query<CalendarEvent>(
        `SELECT ce.* FROM calendar_events ce
         JOIN suggestion_audit sa ON sa.suggestion_id = $1
         WHERE ce.user_id = $2 AND ce.scheduled_date = $3
           AND ce.title = $4
         LIMIT 1`,
        [id, userId, suggestion.suggested_date, suggestion.drill_name],
      );
      await client.query('COMMIT');
      const calendarEvent = evtRows[0];
      if (calendarEvent) {
        return { suggestion, calendarEvent };
      }
    }

    // Update suggestion status
    const { rows: updatedSuggRows } = await client.query<DrillSuggestion>(
      `UPDATE drill_suggestions SET status = 'approved' WHERE id = $1 RETURNING *`,
      [id],
    );
    const updatedSuggestion = updatedSuggRows[0]!;

    // Write audit record
    await client.query(
      `INSERT INTO suggestion_audit (suggestion_id, user_id, action) VALUES ($1, $2, 'approved')`,
      [id, userId],
    );

    // Create calendar event
    const { rows: evtRows } = await client.query<CalendarEvent>(
      `INSERT INTO calendar_events (user_id, title, event_type, scheduled_date, details)
       VALUES ($1, $2, 'drill', $3, $4)
       RETURNING *`,
      [userId, updatedSuggestion.drill_name, updatedSuggestion.suggested_date, JSON.stringify({ drill_key: updatedSuggestion.drill_key })],
    );
    const calendarEvent = evtRows[0]!;

    await client.query('COMMIT');
    return { suggestion: updatedSuggestion, calendarEvent };
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

    // Row-lock so a skip can't race an approve into a double audit / event.
    const { rows: suggRows } = await client.query<DrillSuggestion>(
      'SELECT * FROM drill_suggestions WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [id, userId],
    );
    const suggestion = suggRows[0];
    if (!suggestion) {
      await client.query('ROLLBACK');
      return null;
    }

    // Already-decided suggestions are left as-is (idempotent, no second audit row).
    if (suggestion.status !== 'pending') {
      await client.query('COMMIT');
      return suggestion;
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

  const valueClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const row of rowsToInsert) {
    valueClauses.push(
      `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`,
    );
    values.push(userId, analysisId, row.metricKey, row.value, row.unit, row.optimal_min, row.optimal_max);
  }

  const { rows } = await pool.query<MetricsTimelineRow>(
    `INSERT INTO metrics_timeline (user_id, analysis_id, metric_key, value, unit, optimal_min, optimal_max)
     VALUES ${valueClauses.join(', ')}
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

export async function sweepStuckAnalyses(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE analyses
     SET status = 'failed',
         error_message = 'analysis_timeout',
         completed_at = now()
     WHERE status = 'pending'
       AND created_at < now() - INTERVAL '10 minutes'`,
  );
  return rowCount ?? 0;
}
