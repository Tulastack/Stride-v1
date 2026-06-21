import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrateTestDb(pool: Pool): Promise<void> {
  const schema = fs.readFileSync(
    path.resolve(__dirname, '../../../db/schema.sql'), 'utf8'
  );
  // Run schema idempotently using IF NOT EXISTS
  const idempotentSchema = schema
    .replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE INDEX /g, 'CREATE INDEX IF NOT EXISTS ')
    .replace(/CREATE UNIQUE INDEX /g, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  await pool.query(idempotentSchema);
}
