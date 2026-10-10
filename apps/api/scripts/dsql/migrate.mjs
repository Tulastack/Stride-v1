#!/usr/bin/env node
// Bring an existing Stride database up to the current schema, safely and
// idempotently. Designed for Aurora DSQL's rules:
//   • one DDL statement per transaction, DDL and DML never mixed
//   • ADD COLUMN takes only name + type (defaults set separately)
//   • CHECKs added as ADD CONSTRAINT ... NOT VALID
//   • indexes built with CREATE INDEX ASYNC
//   • at most 3,000 modified rows per transaction (backfills are batched)
//
// DRY RUN by default: prints what it would do and changes nothing.
//
//   node apps/api/scripts/dsql/migrate.mjs --cluster gft3jhbw2zbldbhnokioha5epm
//   node apps/api/scripts/dsql/migrate.mjs --cluster gft3jhbw2zbldbhnokioha5epm --apply
//   node apps/api/scripts/dsql/migrate.mjs --local postgres://... --apply   (rehearsal)
//   add --skip-seeds to leave reference_drills / metric_biomechanics content alone
//
// Never drops a table or column and never deletes rows.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArgs, connect, tableExists, columnExists, columnDefault, indexExists, checkDefs,
} from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = parseArgs(process.argv.slice(2));
const APPLY = !!args.apply;

/** Split a SQL file into statements (comments stripped; statements end with ';' at end of line). */
function statements(file) {
  const text = readFileSync(join(ROOT, file), 'utf8')
    .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  return text.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
}

const schema = statements('db/schema.sql');
const tableDdl = new Map();   // table -> CREATE TABLE statement
const indexDdl = [];          // { name, table, sql }
for (const s of schema) {
  let m = s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/i);
  if (m) { tableDdl.set(m[1], s); continue; }
  m = s.match(/^CREATE (?:UNIQUE )?INDEX ASYNC IF NOT EXISTS (\w+) ON (\w+)/i);
  if (m) indexDdl.push({ name: m[1], table: m[2], sql: s });
}
tableDdl.delete('users_2'); // connectivity smoke-test table, not used by the app

// ── Build the step list ──────────────────────────────────────────────────────
// Each step: { what, needed(c) -> bool, run(c, dsql) }
const steps = [];

for (const [table, sql] of tableDdl) {
  steps.push({
    what: `create table ${table}`,
    needed: async (c) => !(await tableExists(c, table)),
    run: (c) => c.query(sql),
  });
}

function addColumn(table, column, type, { def, backfill, check } = {}) {
  steps.push({
    what: `add column ${table}.${column} ${type}`,
    needed: async (c) => (await tableExists(c, table)) && !(await columnExists(c, table, column)),
    run: (c) => c.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`),
  });
  if (def !== undefined) {
    steps.push({
      what: `default ${table}.${column} = ${def}`,
      needed: async (c) => (await columnExists(c, table, column)) && (await columnDefault(c, table, column)) === null,
      run: (c) => c.query(`ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT ${def}`),
    });
  }
  if (backfill !== undefined) {
    const pk = table === 'reference_drills' ? 'key' : 'id';
    steps.push({
      what: `backfill NULL ${table}.${column} = ${backfill}`,
      needed: async (c) => (await columnExists(c, table, column))
        && (await c.query(`SELECT 1 FROM ${table} WHERE ${column} IS NULL LIMIT 1`)).rowCount > 0,
      run: async (c) => {
        let total = 0;
        for (;;) {
          const r = await c.query(
            `UPDATE ${table} SET ${column} = ${backfill}
              WHERE ${pk} IN (SELECT ${pk} FROM ${table} WHERE ${column} IS NULL LIMIT 1000)`);
          total += r.rowCount;
          if (r.rowCount === 0) break;
        }
        return `${total} rows`;
      },
    });
  }
  if (check) {
    const name = `${table}_${column}_check`;
    steps.push({
      what: `check ${name}`,
      needed: async (c) => (await columnExists(c, table, column))
        && !(await checkDefs(c, table)).some((d) => d.conname === name),
      run: (c) => c.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${check}) NOT VALID`),
    });
  }
}

/** Replace a CHECK whose definition lacks `mustContain` (e.g. a widened enum). */
function widenCheck(table, column, identify, mustContain, newCheck) {
  const name = `${table}_${column}_check`;
  steps.push({
    what: `widen ${name} to allow ${mustContain}`,
    needed: async (c) => {
      if (!(await tableExists(c, table))) return false;
      const defs = (await checkDefs(c, table)).filter((d) => d.def.includes(identify));
      return defs.length === 0 || !defs.some((d) => d.def.includes(mustContain));
    },
    run: async (c) => {
      const stale = (await checkDefs(c, table))
        .filter((d) => d.def.includes(identify) && !d.def.includes(mustContain));
      for (const d of stale) await c.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${d.conname}`);
      await c.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${newCheck}) NOT VALID`);
      return stale.length ? `replaced ${stale.map((d) => d.conname).join(', ')}` : 'added';
    },
  });
}

// users: consent / injury fields (PRD v2.1)
addColumn('users', 'date_of_birth', 'DATE');
addColumn('users', 'consent_given_at', 'TIMESTAMPTZ');
addColumn('users', 'consent_version', 'INTEGER', { def: '0', backfill: '0' });
addColumn('users', 'parental_consent', 'BOOLEAN', { def: 'FALSE', backfill: 'FALSE' });
addColumn('users', 'drill_intensity_cap', 'VARCHAR(20)', { check: `drill_intensity_cap IN ('moderate','full')` });
addColumn('users', 'is_injured', 'BOOLEAN', { def: 'FALSE', backfill: 'FALSE' });

// analyses: 'uploading' status (upload race fix, 2026-07-24)
widenCheck('analyses', 'status', "'pending'", "'uploading'",
  `status IN ('uploading','pending','processing','completed','failed')`);
steps.push({
  what: `default analyses.status = 'uploading'`,
  needed: async (c) => (await tableExists(c, 'analyses'))
    && !String(await columnDefault(c, 'analyses', 'status')).includes('uploading'),
  run: (c) => c.query(`ALTER TABLE analyses ALTER COLUMN status SET DEFAULT 'uploading'`),
});

// calendar_events: lifestyle event types, streak date, card reveal
widenCheck('calendar_events', 'event_type', "'workout'", "'hydration'",
  `event_type IN ('workout','rest','competition','drill','hydration','recovery','cross_training')`);
addColumn('calendar_events', 'completed_on', 'DATE');
addColumn('calendar_events', 'source', 'VARCHAR(10)', {
  def: `'manual'`, backfill: `'manual'`, check: `source IN ('manual','coach','analysis')`,
});
// Existing rows count as already revealed, so nobody gets a retroactive card
// stack of every session they were ever scheduled.
addColumn('calendar_events', 'revealed_at', 'TIMESTAMPTZ', { backfill: 'now()' });

// reference_drills: 4-phase recovery programs
addColumn('reference_drills', 'recovery_phases', 'JSONB', { def: `'[]'::jsonb`, backfill: `'[]'::jsonb` });

// metric_biomechanics.correlation_or_causal was VARCHAR(20), too short for its
// own allowed value 'biomechanically_plausible' (25 chars). Widen it where the
// engine allows; DSQL cannot change a column type, so there it is reported.
steps.push({
  what: 'widen metric_biomechanics.correlation_or_causal to VARCHAR(30)',
  needed: async (c) => {
    const r = await c.query(`SELECT character_maximum_length AS n FROM information_schema.columns
      WHERE table_schema='public' AND table_name='metric_biomechanics' AND column_name='correlation_or_causal'`);
    return r.rowCount > 0 && r.rows[0].n < 30;
  },
  run: async (c, dsql) => {
    if (dsql) throw new Error('column is VARCHAR(20) on this cluster; DSQL cannot alter column types. Ask for help before seeding.');
    await c.query('ALTER TABLE metric_biomechanics ALTER COLUMN correlation_or_causal TYPE VARCHAR(30)');
  },
});

// Indexes last, so every column they reference exists.
for (const ix of indexDdl) {
  if (ix.table === 'users_2') continue;
  steps.push({
    what: `index ${ix.name} on ${ix.table}`,
    needed: async (c) => (await tableExists(c, ix.table)) && !(await indexExists(c, ix.name)),
    run: (c, dsql) => c.query(dsql ? ix.sql : ix.sql.replace(/ ASYNC/i, '')),
  });
}

// Reference content (drills + research), upserted from the repo's seed files.
function seed(file, table, pk) {
  for (const [i, s] of statements(file).entries()) {
    const cols = s.match(/^INSERT INTO \w+\s*\(([^)]+)\)/i)?.[1].split(',').map((x) => x.trim());
    if (!cols) continue;
    const set = cols.filter((c) => c !== pk && c !== 'created_at').map((c) => `${c} = EXCLUDED.${c}`);
    const sql = `${s}\nON CONFLICT (${pk}) DO UPDATE SET ${set.join(', ')}`;
    steps.push({
      what: `upsert ${table} content (${file.split('/').pop()} #${i + 1})`,
      needed: async (c) => !args['skip-seeds'] && (await tableExists(c, table) || !APPLY),
      run: async (c) => `${(await c.query(sql)).rowCount} rows`,
    });
  }
}
seed('apps/api/src/db/seeds/reference_drills.sql', 'reference_drills', 'key');
seed('apps/api/src/db/seeds/metric_biomechanics.sql', 'metric_biomechanics', 'metric_key');

// ── Run ──────────────────────────────────────────────────────────────────────
const { client: c, label, dsql } = await connect({
  cluster: args.cluster, local: args.local, region: args.region,
});
console.log(`${APPLY ? 'APPLYING to' : 'DRY RUN against'} ${label}\n`);
let todo = 0;
let failed = 0;
try {
  for (const step of steps) {
    let needed;
    try { needed = await step.needed(c); } catch (err) { needed = true; }
    if (!needed) { console.log(`  ok    ${step.what}`); continue; }
    todo++;
    if (!APPLY) { console.log(`  TODO  ${step.what}`); continue; }
    try {
      const note = await step.run(c, dsql);
      console.log(`  done  ${step.what}${typeof note === 'string' ? ` (${note})` : ''}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${step.what}: ${err.message}`);
    }
  }
} finally {
  await c.end();
}
console.log(APPLY
  ? `\n${todo - failed} applied, ${failed} failed.${failed ? ' Paste this output for help.' : ''}`
  : `\n${todo} change(s) needed. Nothing was changed. Re-run with --apply to make them.`);
if (dsql && APPLY && todo) {
  console.log('Indexes build in the background on DSQL; they are usable within a few minutes.');
}
process.exitCode = failed ? 1 : 0;
