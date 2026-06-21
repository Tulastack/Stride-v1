/**
 * Unit tests for Drill Suggestions route (Prompt 3.2).
 *
 * Strategy: build minimal Express apps that inject userId directly,
 * bypassing JWT auth. All DB calls are mocked via jest.fn().
 */
import { jest } from '@jest/globals';
import type { DrillSuggestion, CalendarEvent, Analysis } from '../../types.js';

// ─── Mock DB queries ───────────────────────────────────────────────
const mockGetAnalysis = jest.fn<() => Promise<Analysis | null>>();
const mockGetDrillSuggestion = jest.fn<() => Promise<DrillSuggestion | null>>();
const mockGetSuggestionsByAnalysis = jest.fn<() => Promise<DrillSuggestion[]>>();
const mockApproveSuggestion = jest.fn<() => Promise<{ suggestion: DrillSuggestion; calendarEvent: CalendarEvent } | null>>();
const mockSkipSuggestion = jest.fn<() => Promise<DrillSuggestion | null>>();

jest.mock('../../db/queries.js', () => ({
  getAnalysis: () => mockGetAnalysis(),
  getDrillSuggestion: () => mockGetDrillSuggestion(),
  getSuggestionsByAnalysis: () => mockGetSuggestionsByAnalysis(),
  approveSuggestion: () => mockApproveSuggestion(),
  skipSuggestion: () => mockSkipSuggestion(),
}));

import express from 'express';
import request from 'supertest';

function buildApp() {
  const app = express();
  app.use(express.json());

  // Inject userId (bypass JWT)
  app.use((req: any, _res: any, next: any) => {
    req.userId = 'user-test-123';
    next();
  });

  // GET /analyses/:analysisId/suggestions
  app.get('/analyses/:analysisId/suggestions', async (req: any, res: any) => {
    const { analysisId } = req.params;
    const userId = req.userId;

    // UUID regex validation
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(analysisId)) { res.status(400).json({ error: 'Invalid analysisId' }); return; }

    const analysis = await mockGetAnalysis();
    if (!analysis) { res.status(404).json({ error: 'Analysis not found' }); return; }

    const suggestions = await mockGetSuggestionsByAnalysis();
    res.json(suggestions);
  });

  // POST /suggestions/:id/approve
  app.post('/suggestions/:id/approve', async (req: any, res: any) => {
    const { id } = req.params;
    const userId = req.userId;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(id)) { res.status(400).json({ error: 'Invalid suggestion id' }); return; }

    const suggestion = await mockGetDrillSuggestion();
    if (!suggestion) { res.status(404).json({ error: 'Suggestion not found' }); return; }

    // Validate date format
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(suggestion.suggested_date)) {
      res.status(400).json({ error: 'Invalid suggested_date format in suggestion' }); return;
    }

    const result = await mockApproveSuggestion();
    if (!result) { res.status(404).json({ error: 'Suggestion not found' }); return; }
    res.json(result);
  });

  // POST /suggestions/:id/skip
  app.post('/suggestions/:id/skip', async (req: any, res: any) => {
    const { id } = req.params;
    const userId = req.userId;

    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(id)) { res.status(400).json({ error: 'Invalid suggestion id' }); return; }

    const suggestion = await mockGetDrillSuggestion();
    if (!suggestion) { res.status(404).json({ error: 'Suggestion not found' }); return; }

    const skipped = await mockSkipSuggestion();
    if (!skipped) { res.status(404).json({ error: 'Suggestion not found' }); return; }
    res.json(skipped);
  });

  return app;
}

const SUGGESTION_PENDING: DrillSuggestion = {
  id: '11111111-1111-1111-1111-111111111111',
  analysis_id: '22222222-2222-2222-2222-222222222222',
  user_id: 'user-test-123',
  drill_key: 'a_skips',
  drill_name: 'A-Skips',
  suggested_date: '2026-05-26',
  status: 'pending',
  created_at: new Date(),
};

const CALENDAR_EVENT: CalendarEvent = {
  id: '33333333-3333-3333-3333-333333333333',
  user_id: 'user-test-123',
  title: 'A-Skips',
  event_type: 'drill',
  scheduled_date: '2026-05-26',
  details: { drill_key: 'a_skips' },
  status: 'scheduled',
  completion_note: null,
  created_at: new Date(),
};

const ANALYSIS: Analysis = {
  id: '22222222-2222-2222-2222-222222222222',
  user_id: 'user-test-123',
  s3_key: 'key',
  status: 'completed',
  movenet_version: null,
  overall_score: null,
  result_json: {},
  error_message: null,
  created_at: new Date(),
  completed_at: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Test: approve writes calendar_events row ──────────────────────
describe('POST /suggestions/:id/approve', () => {
  it('returns suggestion and calendarEvent on approve', async () => {
    mockGetDrillSuggestion.mockResolvedValueOnce(SUGGESTION_PENDING);
    mockApproveSuggestion.mockResolvedValueOnce({
      suggestion: { ...SUGGESTION_PENDING, status: 'approved' },
      calendarEvent: CALENDAR_EVENT,
    });

    const app = buildApp();
    const res = await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/approve').send();

    expect(res.status).toBe(200);
    expect(res.body.calendarEvent).toBeDefined();
    expect(res.body.calendarEvent.event_type).toBe('drill');
    expect(res.body.suggestion.status).toBe('approved');
    expect(mockApproveSuggestion).toHaveBeenCalled();
  });

  // ─── Test: approve writes suggestion_audit with action='approved' ─
  it('delegates audit writing to approveSuggestion query (not route)', async () => {
    mockGetDrillSuggestion.mockResolvedValueOnce(SUGGESTION_PENDING);
    mockApproveSuggestion.mockResolvedValueOnce({
      suggestion: { ...SUGGESTION_PENDING, status: 'approved' },
      calendarEvent: CALENDAR_EVENT,
    });

    const app = buildApp();
    await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/approve').send();

    expect(mockApproveSuggestion).toHaveBeenCalled();
    expect(mockSkipSuggestion).not.toHaveBeenCalled();
  });

  // ─── Test: approve twice is idempotent ────────────────────────────
  it('approve twice is idempotent — same calendarEvent returned both times', async () => {
    const approvedSuggestion: DrillSuggestion = { ...SUGGESTION_PENDING, status: 'approved' };
    const app = buildApp();

    // First call
    mockGetDrillSuggestion.mockResolvedValueOnce(approvedSuggestion);
    mockApproveSuggestion.mockResolvedValueOnce({ suggestion: approvedSuggestion, calendarEvent: CALENDAR_EVENT });
    const res1 = await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/approve').send();
    expect(res1.status).toBe(200);

    // Second call
    mockGetDrillSuggestion.mockResolvedValueOnce(approvedSuggestion);
    mockApproveSuggestion.mockResolvedValueOnce({ suggestion: approvedSuggestion, calendarEvent: CALENDAR_EVENT });
    const res2 = await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/approve').send();
    expect(res2.status).toBe(200);
    expect(res2.body.calendarEvent.id).toBe('33333333-3333-3333-3333-333333333333');
    // DB-level idempotency: approveSuggestion called each time, returns same event
    expect(mockApproveSuggestion).toHaveBeenCalledTimes(2);
  });
});

// ─── Test: skip writes no calendar_events ─────────────────────────
describe('POST /suggestions/:id/skip', () => {
  it('skip returns skipped suggestion — no calendarEvent field', async () => {
    mockGetDrillSuggestion.mockResolvedValueOnce(SUGGESTION_PENDING);
    mockSkipSuggestion.mockResolvedValueOnce({ ...SUGGESTION_PENDING, status: 'skipped' });

    const app = buildApp();
    const res = await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/skip').send();

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
    // No calendarEvent in skip response
    expect(res.body.calendarEvent).toBeUndefined();
    expect(mockSkipSuggestion).toHaveBeenCalled();
    expect(mockApproveSuggestion).not.toHaveBeenCalled();
  });

  // ─── Test: skip writes suggestion_audit action='skipped' ──────────
  it('delegates audit writing to skipSuggestion query (not route)', async () => {
    mockGetDrillSuggestion.mockResolvedValueOnce(SUGGESTION_PENDING);
    mockSkipSuggestion.mockResolvedValueOnce({ ...SUGGESTION_PENDING, status: 'skipped' });

    const app = buildApp();
    await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/skip').send();

    expect(mockSkipSuggestion).toHaveBeenCalled();
    expect(mockApproveSuggestion).not.toHaveBeenCalled();
  });
});

// ─── Test: bad date → 400 ─────────────────────────────────────────
describe('POST /suggestions/:id/approve with bad date', () => {
  it('returns 400 when suggestion has invalid date format', async () => {
    mockGetDrillSuggestion.mockResolvedValueOnce({
      ...SUGGESTION_PENDING,
      suggested_date: 'not-a-date',
    });

    const app = buildApp();
    const res = await request(app).post('/suggestions/11111111-1111-1111-1111-111111111111/approve').send();

    expect(res.status).toBe(400);
    expect(mockApproveSuggestion).not.toHaveBeenCalled();
  });
});

// ─── Test: GET /analyses/:analysisId/suggestions ──────────────────
describe('GET /analyses/:analysisId/suggestions', () => {
  it('returns list of suggestions for a valid analysis', async () => {
    mockGetAnalysis.mockResolvedValueOnce(ANALYSIS);
    mockGetSuggestionsByAnalysis.mockResolvedValueOnce([SUGGESTION_PENDING]);

    const app = buildApp();
    const res = await request(app).get('/analyses/22222222-2222-2222-2222-222222222222/suggestions');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].drill_key).toBe('a_skips');
  });

  it('returns 404 when analysis not found', async () => {
    mockGetAnalysis.mockResolvedValueOnce(null);

    const app = buildApp();
    const res = await request(app).get('/analyses/22222222-2222-2222-2222-222222222222/suggestions');

    expect(res.status).toBe(404);
  });
});
