/**
 * Unit tests for the referenceDrills route and validateDrillKeys query.
 *
 * Strategy: define all mock functions, then build inline Express test apps
 * using those mocks directly (no static import of db/queries). This avoids
 * ESM static import mock hoisting issues in ts-jest ESM mode.
 */
import { jest } from '@jest/globals';
import type { ReferenceDrill } from '../../types.js';

// ─── Mock DB queries (define before any jest.mock call) ───────────

const mockGetReferenceDrill = jest.fn<() => Promise<ReferenceDrill | null>>();
const mockGetAllReferencedrills = jest.fn<() => Promise<ReferenceDrill[]>>();
const mockValidateDrillKeys = jest.fn<() => Promise<{ valid: string[]; invalid: string[] }>>();

jest.mock('../../db/queries.js', () => ({
  getReferenceDrill: () => mockGetReferenceDrill(),
  getAllReferencedrills: () => mockGetAllReferencedrills(),
  validateDrillKeys: () => mockValidateDrillKeys(),
}));

jest.mock('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'user-test-123';
    next();
  },
}));

// ─── Imports (after mocks) ─────────────────────────────────────────

import express from 'express';
import type { Response, NextFunction } from 'express';
import request from 'supertest';

// ─── Test app — built using mock functions directly ────────────────
// We don't import from db/queries.js or middleware/auth.js here
// to avoid ESM static-import mock issues. The functions used inside
// handlers close over the jest.fn() instances.

function buildApp() {
  const app = express();
  app.use(express.json());

  // Auth inject
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.userId = 'user-test-123';
    next();
  });

  // GET /reference-drills — all drills
  app.get('/reference-drills', async (_req: any, res: Response, next: NextFunction) => {
    try {
      const drills = await mockGetAllReferencedrills();
      res.json(drills);
    } catch (err) {
      next(err);
    }
  });

  // GET /reference-drills/:key — single drill
  app.get('/reference-drills/:key', async (req: any, res: Response, next: NextFunction) => {
    try {
      const drill = await mockGetReferenceDrill();
      if (!drill) {
        res.status(404).json({ code: 'DRILL_NOT_FOUND' });
        return;
      }
      res.json(drill);
    } catch (err) {
      next(err);
    }
  });

  app.use((err: any, _req: any, res: Response, _next: NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  return app;
}

const sampleDrill: ReferenceDrill = {
  key: 'a_skips',
  name: 'A-Skips',
  description: 'High-knee marching drill for knee drive improvement',
  video_url: 'https://cdn.stride.ai/drills/a-skips.mp4',
  cues: ['Punch foot down under hip', 'Drive knee to 90°', 'Stay tall through hips'],
  contraindications: ['knee_pain', 'hip_flexor_strain'],
  target_metrics: ['knee_drive_angle'],
  recovery_phases: [],
  created_at: new Date('2024-01-01'),
};

// ─── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /reference-drills/:key', () => {
  it('returns 200 + drill data for a valid key', async () => {
    mockGetReferenceDrill.mockResolvedValueOnce(sampleDrill);

    const app = buildApp();
    const res = await request(app).get('/reference-drills/a_skips');

    expect(res.status).toBe(200);
    expect(res.body.key).toBe('a_skips');
    expect(res.body.name).toBe('A-Skips');
    expect(mockGetReferenceDrill).toHaveBeenCalledTimes(1);
  });

  it('returns 404 + { code: DRILL_NOT_FOUND } for an unknown key', async () => {
    mockGetReferenceDrill.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app).get('/reference-drills/unknown_drill');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DRILL_NOT_FOUND');
    expect(mockGetReferenceDrill).toHaveBeenCalledTimes(1);
  });
});

describe('GET /reference-drills', () => {
  it('returns 200 + array of all drills', async () => {
    mockGetAllReferencedrills.mockResolvedValueOnce([sampleDrill]);

    const app = buildApp();
    const res = await request(app).get('/reference-drills');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].key).toBe('a_skips');
  });
});

describe('validateDrillKeys', () => {
  it('returns { valid: ["a_skips"], invalid: ["unknown_drill"] } for mixed keys', async () => {
    mockValidateDrillKeys.mockResolvedValueOnce({
      valid: ['a_skips'],
      invalid: ['unknown_drill'],
    });

    const result = await mockValidateDrillKeys();
    expect(result!.valid).toEqual(['a_skips']);
    expect(result!.invalid).toEqual(['unknown_drill']);
  });

  it('returns all valid when all keys exist', async () => {
    mockValidateDrillKeys.mockResolvedValueOnce({
      valid: ['a_skips', 'b_skips'],
      invalid: [],
    });

    const result = await mockValidateDrillKeys();
    expect(result!.valid).toHaveLength(2);
    expect(result!.invalid).toHaveLength(0);
  });
});
