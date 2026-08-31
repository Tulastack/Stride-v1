/**
 * The calendar reveal endpoints — unrevealed / reveal / decline / undo / streak.
 *
 * Strategy: these mount the REAL router (via unstable_mockModule + dynamic
 * import, which is ESM-safe) rather than re-declaring the handlers, so the
 * validation and wiring under test is the code that actually ships.
 */
import { jest } from '@jest/globals';
import type { CalendarEvent } from '../../types.js';

const mockGetUnrevealedEvents = jest.fn<() => Promise<CalendarEvent[]>>();
const mockMarkEventsRevealed = jest.fn<(u: string, ids?: string[]) => Promise<number>>();
const mockDeclineEvents = jest.fn<(u: string, ids: string[]) => Promise<CalendarEvent[]>>();
const mockRestoreEvents = jest.fn<(u: string, ids: string[]) => Promise<CalendarEvent[]>>();
const mockGetTrainingDays =
  jest.fn<() => Promise<{ date: string; completed: number; outstanding: number }[]>>();

jest.unstable_mockModule('../../db/queries.js', () => ({
  createCalendarEvent: jest.fn(),
  createCalendarEvents: jest.fn(),
  getCalendarEvents: jest.fn(async () => []),
  updateCalendarEvent: jest.fn(),
  getUnrevealedEvents: mockGetUnrevealedEvents,
  markEventsRevealed: mockMarkEventsRevealed,
  declineEvents: mockDeclineEvents,
  restoreEvents: mockRestoreEvents,
  getTrainingDays: mockGetTrainingDays,
}));

jest.unstable_mockModule('../../middleware/auth.js', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.userId = 'user-test-123';
    next();
  },
}));

const express = (await import('express')).default;
const request = (await import('supertest')).default;
const calendarRouter = (await import('../calendar.js')).default;
const { errorHandler } = await import('../../middleware/errors.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/calendar', calendarRouter);
  // The real app's error middleware, so validation failures surface here as the
  // 400s callers actually get rather than as bare 500s.
  app.use(errorHandler);
  return app;
}

const EVENT: CalendarEvent = {
  id: '33333333-3333-3333-3333-333333333333',
  user_id: 'user-test-123',
  title: 'Wall drive',
  event_type: 'drill',
  scheduled_date: '2026-09-01',
  details: {},
  status: 'scheduled',
  completion_note: null,
  source: 'analysis',
  revealed_at: null,
  created_at: new Date(),
};

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUnrevealedEvents.mockResolvedValue([]);
  mockMarkEventsRevealed.mockResolvedValue(0);
  mockDeclineEvents.mockResolvedValue([]);
  mockRestoreEvents.mockResolvedValue([]);
  mockGetTrainingDays.mockResolvedValue([]);
});

describe('GET /calendar/unrevealed', () => {
  it('returns the events waiting to be revealed', async () => {
    mockGetUnrevealedEvents.mockResolvedValue([EVENT]);
    const res = await request(buildApp()).get('/calendar/unrevealed');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].source).toBe('analysis');
  });

  it('returns an empty list when there is nothing to reveal', async () => {
    const res = await request(buildApp()).get('/calendar/unrevealed');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('POST /calendar/reveal', () => {
  it('marks the given events revealed', async () => {
    mockMarkEventsRevealed.mockResolvedValue(2);
    const res = await request(buildApp())
      .post('/calendar/reveal')
      .send({ eventIds: [UUID_A, UUID_B] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revealed: 2 });
    expect(mockMarkEventsRevealed).toHaveBeenCalledWith('user-test-123', [UUID_A, UUID_B]);
  });

  it('clears every outstanding reveal when no ids are given', async () => {
    // This is the Skip path: it must not leave the takeover to reappear later.
    const res = await request(buildApp()).post('/calendar/reveal').send({});
    expect(res.status).toBe(200);
    expect(mockMarkEventsRevealed).toHaveBeenCalledWith('user-test-123', undefined);
  });

  it('rejects ids that are not uuids', async () => {
    const res = await request(buildApp()).post('/calendar/reveal').send({ eventIds: ['nope'] });
    expect(res.status).toBe(400);
    expect(mockMarkEventsRevealed).not.toHaveBeenCalled();
  });
});

describe('POST /calendar/decline', () => {
  it('drops the day and reports what it dropped', async () => {
    mockDeclineEvents.mockResolvedValue([{ ...EVENT, status: 'skipped' }]);
    const res = await request(buildApp()).post('/calendar/decline').send({ eventIds: [UUID_A] });

    expect(res.status).toBe(200);
    expect(res.body.declined).toBe(1);
    expect(mockDeclineEvents).toHaveBeenCalledWith('user-test-123', [UUID_A]);
  });

  it('refuses an empty decline rather than touching anything', async () => {
    const res = await request(buildApp()).post('/calendar/decline').send({ eventIds: [] });
    expect(res.status).toBe(400);
    expect(mockDeclineEvents).not.toHaveBeenCalled();
  });
});

describe('POST /calendar/decline/undo', () => {
  it('puts the declined day back', async () => {
    mockRestoreEvents.mockResolvedValue([EVENT]);
    const res = await request(buildApp())
      .post('/calendar/decline/undo')
      .send({ eventIds: [UUID_A] });

    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(1);
    expect(mockRestoreEvents).toHaveBeenCalledWith('user-test-123', [UUID_A]);
  });
});

describe('GET /calendar/streak', () => {
  it('derives the streak against the caller’s local date', async () => {
    mockGetTrainingDays.mockResolvedValue([
      { date: '2026-09-01', completed: 1, outstanding: 0 },
      { date: '2026-09-02', completed: 1, outstanding: 0 },
    ]);

    const res = await request(buildApp()).get('/calendar/streak?today=2026-09-02');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe(2);
    expect(res.body.streakStart).toBe('2026-09-01');
    expect(res.body.streakEnd).toBe('2026-09-02');
  });

  it('rejects a malformed today', async () => {
    // A bad local date would silently produce a wrong streak, so it 400s
    // rather than falling back to the server's own idea of today.
    const res = await request(buildApp()).get('/calendar/streak?today=09-02-2026');
    expect(res.status).toBe(400);
    expect(mockGetTrainingDays).not.toHaveBeenCalled();
  });

  it('falls back to the server date when today is omitted', async () => {
    const res = await request(buildApp()).get('/calendar/streak');
    expect(res.status).toBe(200);
    expect(res.body.current).toBe(0);
  });
});
