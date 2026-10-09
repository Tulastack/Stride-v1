#!/usr/bin/env node
// READ-ONLY look inside one or more databases: which tables exist, how many
// rows each has, and when the latest activity was. Use it to tell which DSQL
// cluster holds the real production data before migrating anything.
//
//   node apps/api/scripts/dsql/inspect.mjs --cluster sztwxa4q2knxrbnfldh5x3fita
//   node apps/api/scripts/dsql/inspect.mjs --cluster A --cluster2 B
//   node apps/api/scripts/dsql/inspect.mjs --local postgres://...
//
// Runs only SELECTs. Nothing is written.
import { parseArgs, connect, tableExists } from './lib.mjs';

const TABLES = [
  'users', 'analyses', 'calendar_events', 'coach_sessions', 'drill_suggestions',
  'suggestion_audit', 'reference_drills', 'metrics_timeline', 'metric_biomechanics',
];
const LATEST = {
  users: 'created_at', analyses: 'created_at', calendar_events: 'created_at',
  coach_sessions: 'last_activity_at', metrics_timeline: 'measured_at',
};

async function inspect(target) {
  let conn;
  try {
    conn = await connect(target);
  } catch (err) {
    console.log(`\n=== ${target.cluster ?? target.local}\n  could not connect: ${err.message}`);
    return;
  }
  const { client: c, label } = conn;
  console.log(`\n=== ${label}`);
  try {
    const all = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`);
    const names = all.rows.map((r) => r.table_name);
    console.log(`  tables present: ${names.length ? names.join(', ') : '(none)'}`);
    for (const t of TABLES) {
      if (!(await tableExists(c, t))) { console.log(`  ${t.padEnd(20)} MISSING`); continue; }
      const n = (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      let latest = '';
      if (LATEST[t] && n > 0) {
        const r = await c.query(`SELECT max(${LATEST[t]}) AS m FROM ${t}`);
        latest = `  latest ${new Date(r.rows[0].m).toISOString().slice(0, 10)}`;
      }
      console.log(`  ${t.padEnd(20)} ${String(n).padStart(6)} rows${latest}`);
    }
  } finally {
    await c.end();
  }
}

const args = parseArgs(process.argv.slice(2));
const targets = [];
if (args.local) targets.push({ local: args.local });
for (const k of ['cluster', 'cluster2']) if (args[k]) targets.push({ cluster: args[k], region: args.region });
if (!targets.length) {
  targets.push({ cluster: 'sztwxa4q2knxrbnfldh5x3fita' }, { cluster: 'gft3jhbw2zbldbhnokioha5epm' });
}
for (const t of targets) await inspect(t);
console.log('\nRead-only: nothing was changed.');
