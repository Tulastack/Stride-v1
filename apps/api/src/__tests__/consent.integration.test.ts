/**
 * Integration tests for Consent & Liability (Prompt 2).
 *
 * Strategy: mount requireConsent middleware and route handlers directly in a
 * test express app (no JWT — user is injected via a simple middleware). This
 * avoids ESM jest.mock hoisting issues with the baked-in `authenticate` calls
 * inside the existing routers, while still testing against a real Postgres DB.
 */
import { jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import type { Response, NextFunction } from 'express';
import { Pool } from 'pg';

const TEST_DB_URL = process.env.DATABASE_URL!;

// ─── Mock external services ───────────────────────────────────────────────────

const mockEnqueueAnalysis = jest.fn((_id: string, _key: string) => Promise.resolve());
const mockInitiateMultipart = jest.fn((_key: string) => Promise.resolve('test-upload-id'));
const mockPresignParts = jest.fn((_key: string, _id: string, _n: number) =>
  Promise.resolve([{ partNumber: 1, url: 'http://s3.test/part1' }]),
);
const mockCompleteMultipart = jest.fn((_key: string, _id: string, _parts: unknown[]) =>
  Promise.resolve(),
);

jest.mock('../lib/sqs.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  enqueueAnalysis: (a: any, b: any) => mockEnqueueAnalysis(a, b),
  checkSQSHealth: () => Promise.resolve(true),
}));

jest.mock('../lib/s3.js', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initiateMultipartUpload: (a: any) => mockInitiateMultipart(a),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generatePresignedPartUrls: (a: any, b: any, c: any) => mockPresignParts(a, b, c),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completeMultipartUpload: (a: any, b: any, c: any) => mockCompleteMultipart(a, b, c),
  checkS3Health: () => Promise.resolve(true),
}));

jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  setupExpressErrorHandler: jest.fn(),
  captureException: jest.fn(),
}));

// ─── DB setup ─────────────────────────────────────────────────────────────────

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL });
  // Idempotent: add consent columns if schema is old
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS parental_consent BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS drill_intensity_cap VARCHAR(20);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_injured BOOLEAN NOT NULL DEFAULT FALSE;
  `);
});

afterAll(async () => {
  await pool.end();
});

beforeEach(() => {
  mockEnqueueAnalysis.mockClear();
  mockInitiateMultipart.mockClear();
  mockPresignParts.mockClear();
  mockCompleteMultipart.mockClear();
});

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function createTestUser(overrides: Record<string, any> = {}): Promise<Record<string, any>> {
  const uid = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const { rows } = await pool.query(
    `INSERT INTO users (supabase_uid, email, consent_version, parental_consent, is_injured)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [uid, `${uid}@test.com`, overrides.consent_version ?? 0, false, false],
  );
  const user = rows[0];

  const updates: string[] = [];
  const vals: unknown[] = [];
  if (overrides.consent_given_at != null) {
    updates.push(`consent_given_at = $${updates.length + 1}`);
    vals.push(overrides.consent_given_at);
  }
  if (overrides.date_of_birth != null) {
    updates.push(`date_of_birth = $${updates.length + 1}`);
    vals.push(overrides.date_of_birth);
  }
  if (updates.length > 0) {
    vals.push(user.id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${vals.length}`, vals);
  }

  const { rows: [fresh] } = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
  return fresh;
}

async function cleanupUser(userId: string) {
  await pool.query('DELETE FROM analyses WHERE user_id = $1', [userId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

// ─── Inline test app builder ──────────────────────────────────────────────────
// Mounts requireConsent directly — no JWT/authenticate in the chain.

async function buildConsentGatedApp(testUser: Record<string, any>) {
  const { requireConsent } = await import('../middleware/consent.js');
  const { createAnalysis } = await import('../db/queries.js');

  const app = express();
  app.use(express.json());

  // Inject the test user — simulates what authenticate does in production
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.userId = testUser.id;
    req.supabaseUid = testUser.supabase_uid;
    req.user = testUser;
    next();
  });

  // POST /analyses — create analysis row + enqueue (mirrors /videos/upload-url + /finalize)
  app.post(
    '/analyses',
    requireConsent,
    async (req: any, res: Response, next: NextFunction) => {
      try {
        const s3Key = `uploads/${req.userId}/test.mp4`;
        const analysis = await createAnalysis(req.userId, s3Key);
        await mockEnqueueAnalysis(analysis.id, s3Key);
        res.status(202).json(analysis);
      } catch (err) {
        next(err);
      }
    },
  );

  // POST /consent — records consent directly using the consent logic
  app.post('/consent', async (req: any, res: Response, next: NextFunction) => {
    try {
      const { recordConsent } = await import('../db/queries.js');
      const { isMinor, CURRENT_CONSENT_VERSION } = await import('../middleware/consent.js');
      const { consent_version, date_of_birth, parental_consent } = req.body;

      if (!consent_version || consent_version < CURRENT_CONSENT_VERSION) {
        res.status(400).json({ code: 'CONSENT_VERSION_TOO_OLD' });
        return;
      }

      let drill_intensity_cap: 'moderate' | 'full' | null = null;
      if (date_of_birth) {
        const dob = new Date(date_of_birth);
        if (isMinor(dob)) {
          if (!parental_consent) {
            res.status(403).json({ code: 'PARENTAL_CONSENT_REQUIRED' });
            return;
          }
          drill_intensity_cap = 'moderate';
        } else {
          drill_intensity_cap = 'full';
        }
      }

      const user = await recordConsent(req.userId, {
        consent_version,
        date_of_birth: date_of_birth ?? null,
        parental_consent: parental_consent ?? false,
        drill_intensity_cap,
      });

      res.status(200).json(user);
    } catch (err) {
      next(err);
    }
  });

  // Expose errors for debugging
  app.use((err: any, _req: any, res: Response, _next: NextFunction) => {
    console.error('[test-app error]', err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('POST /analyses — consent gating', () => {
  it('returns 403 CONSENT_REQUIRED when consent_given_at IS NULL, no row created, no SQS', async () => {
    const user = await createTestUser({ consent_version: 0 }); // no consent_given_at
    const app = await buildConsentGatedApp(user);

    const res = await request(app).post('/analyses').send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED');

    // No analysis row created
    const { rows } = await pool.query('SELECT * FROM analyses WHERE user_id = $1', [user.id]);
    expect(rows).toHaveLength(0);

    // No SQS enqueue
    expect(mockEnqueueAnalysis).not.toHaveBeenCalled();

    await cleanupUser(user.id);
  });

  it('returns 202 and creates row + enqueues SQS when consent is valid', async () => {
    const user = await createTestUser({ consent_version: 1, consent_given_at: new Date() });
    const app = await buildConsentGatedApp(user);

    const res = await request(app).post('/analyses').send({});

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('id');
    expect(res.body.status).toBe('pending');

    // Analysis row was created in DB
    const { rows } = await pool.query('SELECT * FROM analyses WHERE user_id = $1', [user.id]);
    expect(rows).toHaveLength(1);

    // SQS was enqueued
    expect(mockEnqueueAnalysis).toHaveBeenCalledTimes(1);

    await cleanupUser(user.id);
  });
});

describeIfDb('POST /consent — minor user gating', () => {
  it('blocks minor (age 17) without parental_consent', async () => {
    const user = await createTestUser({ consent_version: 0 });
    const app = await buildConsentGatedApp(user);

    const dob17 = new Date();
    dob17.setFullYear(dob17.getFullYear() - 17);
    const dobStr = dob17.toISOString().split('T')[0];

    const res = await request(app)
      .post('/consent')
      .send({ consent_version: 1, date_of_birth: dobStr, parental_consent: false });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PARENTAL_CONSENT_REQUIRED');

    await cleanupUser(user.id);
  });

  it('allows minor (age 17) with parental_consent=true and sets drill_intensity_cap=moderate', async () => {
    const user = await createTestUser({ consent_version: 0 });
    const app = await buildConsentGatedApp(user);

    const dob17 = new Date();
    dob17.setFullYear(dob17.getFullYear() - 17);
    const dobStr = dob17.toISOString().split('T')[0];

    const res = await request(app)
      .post('/consent')
      .send({ consent_version: 1, date_of_birth: dobStr, parental_consent: true });

    expect(res.status).toBe(200);
    expect(res.body.drill_intensity_cap).toBe('moderate');
    expect(res.body.parental_consent).toBe(true);
    expect(res.body.consent_version).toBe(1);
    expect(res.body.consent_given_at).toBeTruthy();

    await cleanupUser(user.id);
  });
});
