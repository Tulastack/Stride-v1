import { pool } from './queries.js';
import { snapshot, type AppAction } from '../lib/coach/appActions.js';

/** One transaction covers the receipt and every write. A lost HTTP response can
 * be retried with the same proposal without adding duplicate workouts. */
export async function applyCoachAction(userId: string, sessionId: string,
  proposal: { action: AppAction; before?: any; nonce: string }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO coach_action_receipts (id, user_id, session_id) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO NOTHING RETURNING id`, [proposal.nonce, userId, sessionId]);
    if (!inserted.rows.length) {
      const receipt = await client.query('SELECT result FROM coach_action_receipts WHERE id=$1 AND user_id=$2 AND session_id=$3', [proposal.nonce, userId, sessionId]);
      if (!receipt.rows.length) throw new Error('Action receipt not found');
      await client.query('COMMIT');
      return receipt.rows[0].result;
    }
    const action = proposal.action;
    let result: any = { applied: true, action };
    if (action.kind === 'create_events') {
      const events = [];
      for (const e of action.events) {
        const { rows } = await client.query(
          `INSERT INTO calendar_events (user_id,title,event_type,scheduled_date,details,source,revealed_at)
           VALUES ($1,$2,$3,$4,$5,'coach',now()) RETURNING *`,
          [userId, e.title, e.eventType, e.scheduledDate, JSON.stringify(e.details)]);
        events.push(rows[0]);
      }
      result.events = events;
    } else if (action.kind === 'update_event' || action.kind === 'delete_event') {
      const { rows } = await client.query(`SELECT * FROM calendar_events WHERE id=$1 AND user_id=$2${process.env.DSQL_ENDPOINT ? '' : ' FOR UPDATE'}`, [action.eventId, userId]);
      if (!rows[0] || snapshot(rows[0]) !== snapshot(proposal.before)) throw new Error('This session changed. Ask the coach to review it again.');
      if (rows[0].status === 'completed') throw new Error('Completed training cannot be moved or deleted by the coach.');
      if (action.kind === 'delete_event') {
        await client.query('DELETE FROM calendar_events WHERE id=$1 AND user_id=$2', [action.eventId, userId]);
      } else {
        const c = action.changes;
        const updated = await client.query(
          `UPDATE calendar_events SET title=$3,event_type=$4,scheduled_date=$5,details=$6, revealed_at=now()
           WHERE id=$1 AND user_id=$2 RETURNING *`,
          [action.eventId, userId, c.title ?? rows[0].title, c.eventType ?? rows[0].event_type,
            c.scheduledDate ?? rows[0].scheduled_date, JSON.stringify(c.details ?? rows[0].details)]);
        result.event = updated.rows[0];
      }
    } else if (action.kind === 'update_profile') {
      const { rows } = await client.query(`SELECT * FROM users WHERE id=$1${process.env.DSQL_ENDPOINT ? '' : ' FOR UPDATE'}`, [userId]);
      for (const key of Object.keys(action.changes)) {
        if (rows[0]?.[key] !== proposal.before?.[key]) throw new Error('Your profile changed. Ask the coach to review it again.');
      }
      const entries = Object.entries(action.changes);
      const updated = await client.query(`UPDATE users SET ${entries.map(([k], i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [userId, ...entries.map(([,v]) => v)]);
      result.user = updated.rows[0];
    } else if (action.kind === 'set_event_status') {
      const { rows } = await client.query(`SELECT * FROM calendar_events WHERE id=$1 AND user_id=$2${process.env.DSQL_ENDPOINT ? '' : ' FOR UPDATE'}`, [action.eventId, userId]);
      if (!rows[0] || snapshot(rows[0]) !== snapshot(proposal.before)) throw new Error('This session changed. Ask the coach to review it again.');
      const day = action.today ?? new Date().toISOString().slice(0, 10);
      // node-pg parses DATE to LOCAL midnight; toISOString() would shift the day west of UTC.
      const sd = rows[0].scheduled_date;
      const scheduled = sd instanceof Date
        ? `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}`
        : String(sd).slice(0, 10);
      if (action.status === 'completed' && scheduled > day) throw new Error("A session can't be completed before the day it's scheduled for.");
      const updated = await client.query(
        'UPDATE calendar_events SET status=$3, completed_on=$4 WHERE id=$1 AND user_id=$2 RETURNING *',
        [action.eventId, userId, action.status, action.status === 'completed' ? day : null]);
      result.event = updated.rows[0];
    } else if (action.kind === 'approve_suggestion' || action.kind === 'skip_suggestion') {
      // These run the same idempotent queries as the Suggestions screen. A
      // failure throws before COMMIT, so the receipt rolls back with it.
      const q = await import('./queries.js');
      const done = action.kind === 'approve_suggestion'
        ? await q.approveSuggestion(action.suggestionId, userId)
        : await q.skipSuggestion(action.suggestionId, userId);
      if (!done) throw new Error('Suggestion not found');
      result.suggestion = done;
    }
    await client.query('UPDATE coach_action_receipts SET result=$2 WHERE id=$1', [proposal.nonce, JSON.stringify(result)]);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
}
