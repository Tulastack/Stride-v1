// Shared helpers for the Aurora DSQL maintenance scripts (inspect / migrate).
//
// Connection targets:
//   --cluster <id>      Aurora DSQL in us-east-1 (or --region), admin IAM token
//   --local <pg-url>    plain Postgres, used to rehearse migrations locally
import pg from 'pg';

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export async function connect({ cluster, local, region = 'us-east-1' }) {
  if (local) {
    const client = new pg.Client({ connectionString: local });
    await client.connect();
    return { client, label: `local ${local.replace(/:[^:@/]+@/, ':***@')}`, dsql: false };
  }
  if (!cluster) throw new Error('Pass --cluster <dsql-cluster-id> or --local <postgres-url>');
  const host = `${cluster}.dsql.${region}.on.aws`;
  const { DsqlSigner } = await import('@aws-sdk/dsql-signer');
  const token = await new DsqlSigner({ hostname: host, region }).getDbConnectAdminAuthToken();
  const client = new pg.Client({
    host, port: 5432, user: 'admin', database: 'postgres', password: token,
    ssl: { rejectUnauthorized: true },
    // An INACTIVE cluster wakes on first connect, which can take a while.
    connectionTimeoutMillis: 120_000,
  });
  await client.connect();
  return { client, label: `DSQL ${host}`, dsql: true };
}

export async function tableExists(c, table) {
  const r = await c.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]);
  return r.rowCount > 0;
}

export async function columnExists(c, table, column) {
  const r = await c.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]);
  return r.rowCount > 0;
}

export async function columnDefault(c, table, column) {
  const r = await c.query(
    `SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column]);
  return r.rows[0]?.column_default ?? null;
}

export async function indexExists(c, name) {
  const r = await c.query(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [name]);
  return r.rowCount > 0;
}

/** CHECK constraint definitions on a table, as text (e.g. "CHECK ((status)::text = ANY ...)"). */
export async function checkDefs(c, table) {
  const r = await c.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE contype='c' AND conrelid = to_regclass($1)`, [`public.${table}`]);
  return r.rows;
}
