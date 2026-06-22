const { Pool } = require('pg');
const { DsqlSigner } = require('@aws-sdk/dsql-signer');

let pool;

/**
 * Generate a short-lived IAM auth token for Aurora DSQL.
 */
async function generateToken() {
  const signer = new DsqlSigner({
    hostname: process.env.DB_HOST,
    region: process.env.AWS_REGION || 'us-east-1',
  });
  return signer.getDbConnectAdminAuthToken();
}

/**
 * Get or create the connection pool.
 * When IAM auth is enabled, the pool refreshes tokens automatically
 * since DSQL tokens are valid for 15 minutes.
 */
async function getPool() {
  if (pool) return pool;

  const useIamAuth = process.env.DB_USE_IAM_AUTH === 'true';

  const config = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
    max: 10,
    idleTimeoutMillis: 30000,
  };

  if (useIamAuth) {
    config.password = await generateToken();
  } else {
    config.password = process.env.DB_PASSWORD;
  }

  pool = new Pool(config);

  pool.on('error', (err) => {
    console.error('Unexpected DB pool error', err);
    // Reset pool so next query gets a fresh token
    pool = null;
  });

  // Refresh token every 10 minutes (tokens last 15 min)
  if (useIamAuth) {
    setInterval(async () => {
      try {
        const newToken = await generateToken();
        pool.options.password = newToken;
      } catch (err) {
        console.error('Failed to refresh DSQL auth token', err);
      }
    }, 10 * 60 * 1000);
  }

  return pool;
}

module.exports = { getPool };
