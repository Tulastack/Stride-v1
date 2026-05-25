import pg from 'pg';
import type { User, Analysis, Conversation, ConversationMessage, CalendarEvent } from '../types.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
  const { rows } = await pool.query<User>(
    `INSERT INTO users (supabase_uid, email)
     VALUES ($1, $2)
     ON CONFLICT (supabase_uid) DO UPDATE SET email = EXCLUDED.email
     RETURNING *`,
    [supabaseUid, email],
  );
  return rows[0]!;
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

export async function createConversation(
  userId: string,
  analysisId: string | null,
): Promise<Conversation> {
  const { rows } = await pool.query<Conversation>(
    `INSERT INTO conversations (user_id, analysis_id, messages)
     VALUES ($1, $2, '[]'::jsonb)
     RETURNING *`,
    [userId, analysisId],
  );
  return rows[0]!;
}

export async function getConversation(
  conversationId: string,
  userId: string,
): Promise<Conversation | null> {
  const { rows } = await pool.query<Conversation>(
    'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
    [conversationId, userId],
  );
  return rows[0] ?? null;
}

export async function getConversationsByUser(userId: string): Promise<Conversation[]> {
  const { rows } = await pool.query<Conversation>(
    'SELECT id, user_id, analysis_id, summary, created_at, updated_at FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC',
    [userId],
  );
  return rows;
}

export async function addMessage(
  conversationId: string,
  message: ConversationMessage,
): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET messages = messages || $1::jsonb,
         updated_at = now()
     WHERE id = $2`,
    [JSON.stringify([message]), conversationId],
  );
}

export async function updateSummary(conversationId: string, summary: string): Promise<void> {
  await pool.query(
    `UPDATE conversations SET summary = $1, updated_at = now() WHERE id = $2`,
    [summary, conversationId],
  );
}

export async function getConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const { rows } = await pool.query<{ messages: ConversationMessage[] }>(
    'SELECT messages FROM conversations WHERE id = $1',
    [conversationId],
  );
  return rows[0]?.messages ?? [];
}

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
