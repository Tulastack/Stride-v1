// Database connection config for the pg Pool.
//
// DEFAULT (unchanged): standard PostgreSQL via DATABASE_URL — local dev, the
// docker harness, tests, and RDS. Nothing about that path changes.
//
// OPT-IN: when DSQL_ENDPOINT is set, connect to Aurora DSQL, which requires
//   • TLS, and
//   • a short-lived IAM auth token used as the password (regenerated per new
//     connection — pg calls this function each time it opens a socket).
// This keeps the change surgical: no DSQL code runs unless DSQL_ENDPOINT is set.

import type { PoolConfig } from 'pg';

export function isDsqlMode(): boolean {
  return !!process.env.DSQL_ENDPOINT;
}

export function dbConnectionConfig(): PoolConfig {
  const endpoint = process.env.DSQL_ENDPOINT;
  if (!endpoint) {
    // Standard Postgres path — identical to the original behavior.
    return { connectionString: process.env.DATABASE_URL };
  }

  const region = process.env.DSQL_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
  const user = process.env.DSQL_USER ?? 'admin';
  const database = process.env.DSQL_DATABASE ?? 'postgres';

  return {
    host: endpoint,
    port: 5432,
    user,
    database,
    ssl: { rejectUnauthorized: true }, // DSQL uses a public Amazon CA (in Node's bundle)
    // Aurora DSQL password = a fresh IAM auth token, minted per connection.
    password: async () => {
      const { DsqlSigner } = await import('@aws-sdk/dsql-signer');
      const signer = new DsqlSigner({ hostname: endpoint, region });
      return user === 'admin'
        ? signer.getDbConnectAdminAuthToken()
        : signer.getDbConnectAuthToken();
    },
  };
}
