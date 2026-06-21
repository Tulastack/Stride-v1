import pg from 'pg';
import * as fs from 'fs';

const { Pool } = pg;

interface AuditResult {
  stuckAnalyses: number;
  calendarViolations: number;
  openWorkflowSessions: number;
  avgConfidence: number | null;
  timestamp: string;
  violations: string[];
}

async function runHealthAudit(): Promise<AuditResult> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const result: AuditResult = {
    stuckAnalyses: 0,
    calendarViolations: 0,
    openWorkflowSessions: 0,
    avgConfidence: null,
    timestamp: new Date().toISOString(),
    violations: [],
  };

  try {
    // 1. Stuck analyses (pending > 10 minutes)
    const { rows: stuck } = await pool.query(`
      SELECT COUNT(*)::int as count FROM analyses
      WHERE status = 'pending' AND created_at < now() - INTERVAL '10 minutes'
    `);
    result.stuckAnalyses = stuck[0].count;
    if (result.stuckAnalyses > 0) {
      result.violations.push(`${result.stuckAnalyses} analyses stuck in pending`);
    }

    // 2. Calendar events without approved suggestion_audit (vision violation)
    // Only check if suggestion_audit table exists
    try {
      const { rows: calViolations } = await pool.query(`
        SELECT COUNT(*)::int as count FROM calendar_events ce
        WHERE ce.event_type = 'drill' AND NOT EXISTS (
          SELECT 1 FROM suggestion_audit sa
          JOIN drill_suggestions ds ON ds.id = sa.suggestion_id
          WHERE sa.action = 'approved'
            AND ds.drill_key = ce.details->>'drill_key'
        ) AND ce.created_at > now() - INTERVAL '30 days'
      `);
      result.calendarViolations = calViolations[0].count;
      if (result.calendarViolations > 0) {
        result.violations.push(`${result.calendarViolations} calendar events without approved suggestion (VISION VIOLATION)`);
      }
    } catch { /* table may not exist yet */ }

    // 3. Open analysis_workflow sessions > 24h
    try {
      const { rows: openSessions } = await pool.query(`
        SELECT COUNT(*)::int as count FROM coach_sessions
        WHERE session_type = 'analysis_workflow' AND status = 'open'
          AND last_activity_at < now() - INTERVAL '24 hours'
      `);
      result.openWorkflowSessions = openSessions[0].count;
      if (result.openWorkflowSessions > 0) {
        result.violations.push(`${result.openWorkflowSessions} workflow sessions open >24h (cleanup bug)`);
      }
    } catch { /* table may not exist yet */ }

    // 4. Average pose confidence last 24h
    const { rows: conf } = await pool.query(`
      SELECT AVG((result_json->>'overall_score')::numeric) as avg_score
      FROM analyses
      WHERE status = 'completed' AND completed_at > now() - INTERVAL '24 hours'
    `);
    result.avgConfidence = conf[0].avg_score ? parseFloat(conf[0].avg_score) : null;

  } finally {
    await pool.end();
  }

  return result;
}

const audit = await runHealthAudit();
console.log('\n=== STRIDE HEALTH AUDIT ===');
console.log(JSON.stringify(audit, null, 2));

if (audit.violations.length > 0) {
  console.error('\n❌ VIOLATIONS DETECTED:');
  audit.violations.forEach(v => console.error(`  • ${v}`));
  process.exit(1);
} else {
  console.log('\n✅ No violations detected');
}
