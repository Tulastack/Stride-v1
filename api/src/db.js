const { Pool } = require('pg');
const { DsqlSigner } = require('@aws-sdk/dsql-signer');

// Generates a fresh IAM auth token (valid ~15 min)
async function getAuthToken() {
  const signer = new DsqlSigner({
    hostname: process.env.DB_HOST,
    region:   process.env.AWS_REGION || 'us-east-1',
  });
  return signer.getDbConnectAdminAuthToken();
}

// pg supports a password factory function — called on each new connection
const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: getAuthToken,   // fresh token per connection
  ssl:      { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB pool error', err);
});

module.exports = pool;
