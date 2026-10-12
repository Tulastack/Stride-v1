/** Exercise the shipping router; mock only auth, storage and provider boundaries. */
import { jest } from '@jest/globals';
import { buildCoachTools } from '../../lib/coach/tools.js';
import { signProposal, NO_ACCESS } from '../../lib/coach/appActions.js';
const session = { id: '11111111-1111-4111-8111-111111111111', status: 'open', session_type: 'free_coach', analysis_id: null };
const analysisReads = jest.fn(async () => []);
const writes = jest.fn(async () => ({ applied: true }));
const event = { id: '22222222-2222-4222-8222-222222222222', title: 'Tempo', scheduled_date: '2026-10-13', event_type: 'workout', status: 'scheduled', details: {} };
const usage = { used: 3, cap: 20, remaining: 17, period: 'beta' };
const reserve = jest.fn(async (): Promise<typeof usage | null> => usage);
const refund = jest.fn(async () => {});
const recordTokens = jest.fn(async () => {});
jest.unstable_mockModule('../../db/queries.js', () => ({
  createCoachSession: jest.fn(), getCoachSession: jest.fn(async () => session),
  getCoachSessionsByUser: jest.fn(async () => []), touchCoachSession: jest.fn(), sealCoachSession: jest.fn(),
  getAnalysisByIdOnly: jest.fn(), getAnalysesByUser: analysisReads, getMetricsTrend: jest.fn(async () => []),
  getReferenceDrill: jest.fn(), getCalendarEvents: jest.fn(async () => [event]), getCalendarEventById: jest.fn(async () => event),
  getAllReferencedrills: jest.fn(async () => []),
  reserveCoachMessage: reserve, refundCoachMessage: refund, recordCoachTokens: recordTokens,
  getCoachUsage: jest.fn(async () => ({ used: 20, cap: 20, remaining: 0, period: 'beta' })),
}));
const runAgent = jest.fn(async ({ toolset, onUsage }: any) => {
  await toolset.execute('get_current_plan', {});
  await toolset.execute('propose_app_action', { action: { kind: 'update_event', eventId: event.id, changes: { scheduledDate: '2026-10-15' } } });
  onUsage?.({ prompt: 1200, completion: 150, cached: 0 });
  return 'Moved your workout'; // Model prose is not allowed to declare success.
});
const fallback = jest.fn(async () => 'Fallback');
jest.unstable_mockModule('../../db/coachActions.js', () => ({ applyCoachAction: writes }));
jest.unstable_mockModule('../../middleware/auth.js', () => ({ authenticate: (req: any, _res: any, next: any) => { req.userId='u1'; req.user={display_name: 'Private profile', is_injured: false}; next(); } }));
jest.unstable_mockModule('../../lib/coach.js', () => ({
  buildCoachTools, buildAnalysisContext: jest.fn(() => 'No analysis access'), generateCoachReply: fallback,
  runTrackCoach: runAgent,
}));
jest.unstable_mockModule('../../lib/coach/calendarRelevance.js', () => ({ isCalendarRelevant: jest.fn(async () => false) }));
const express = (await import('express')).default;
const request = (await import('supertest')).default;
const router = (await import('../coachSessions.js')).default;
const app = express(); app.use(express.json()); app.use('/coach-sessions', router);
const path = `/coach-sessions/${session.id}`;
beforeEach(() => jest.clearAllMocks());

test('a calendar request yields a signed proposal, not a write or private analysis read', async () => {
  const res = await request(app).post(`${path}/message`).send({ content: 'Move Tempo to Thursday', permissions: { ...NO_ACCESS, calendar: true } });
  expect(res.status).toBe(200);
  expect(res.body.actions).toHaveLength(1);
  expect(res.body.actions[0].action.changes.scheduledDate).toBe('2026-10-15');
  expect(res.body.content).toContain('Nothing has changed yet');
  expect(res.body.content).not.toContain('Moved your workout');
  expect(writes).not.toHaveBeenCalled(); expect(analysisReads).not.toHaveBeenCalled();
  expect(res.body.usage).toEqual(usage);
  expect(recordTokens).toHaveBeenCalledWith('u1', 'beta', 1200, 150);
  expect(refund).not.toHaveBeenCalled();
});
test('a used-up allowance answers 429 COACH_CAP_REACHED without calling the model', async () => {
  reserve.mockResolvedValueOnce(null);
  const res = await request(app).post(`${path}/message`).send({ content: 'What should I fix first?', permissions: NO_ACCESS });
  expect(res.status).toBe(429);
  expect(res.body).toMatchObject({ code: 'COACH_CAP_REACHED', usage: { remaining: 0 } });
  expect(runAgent).not.toHaveBeenCalled(); expect(fallback).not.toHaveBeenCalled();
});
test('a message that gets no answer is given back', async () => {
  runAgent.mockRejectedValueOnce(new Error('provider down'));
  fallback.mockRejectedValueOnce(new Error('provider down'));
  const res = await request(app).post(`${path}/message`).send({ content: 'What should I fix first?', permissions: NO_ACCESS });
  expect(res.status).toBe(500);
  expect(refund).toHaveBeenCalledWith('u1', 'beta');
});
test('revoked access, forged tokens and another user cannot approve a change', async () => {
  const action = { kind: 'delete_event' as const, eventId: event.id };
  const proposal = signProposal('u1', session.id, action, event);
  expect((await request(app).post(`${path}/actions/apply`).send({ token: proposal.token, permissions: NO_ACCESS })).status).toBe(403);
  expect((await request(app).post(`${path}/actions/apply`).send({ token: 'forged.token', permissions: { ...NO_ACCESS, calendar: true } })).status).toBe(400);
  const wrongOwner = signProposal('u2', session.id, action, event);
  expect((await request(app).post(`${path}/actions/apply`).send({ token: wrongOwner.token, permissions: { ...NO_ACCESS, calendar: true } })).status).toBe(400);
  expect(writes).not.toHaveBeenCalled();
});
test('approval executes the signed payload, ignoring a caller-supplied replacement action', async () => {
  const action = { kind: 'delete_event' as const, eventId: event.id };
  const proposal = signProposal('u1', session.id, action, event);
  const res = await request(app).post(`${path}/actions/apply`).send({ token: proposal.token, permissions: { ...NO_ACCESS, calendar: true }, action: { kind: 'delete_event', eventId: 'some-other-event' } });
  expect(res.status).toBe(200);
  expect(writes).toHaveBeenCalledWith('u1', session.id, expect.objectContaining({ action }));
});
