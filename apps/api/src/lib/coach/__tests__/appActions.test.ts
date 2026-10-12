import { appActionSchema, signProposal, verifyProposal } from '../appActions.js';
import { buildCoachTools } from '../tools.js';
import { groundedResult } from '../../measurementTrust.js';

test('approvals are tied to user, session and exact changes', () => {
  const action = appActionSchema.parse({ kind: 'create_events', events: [{ title: 'Tempo', eventType: 'workout', scheduledDate: '2026-10-12' }] });
  if (action.kind !== 'create_events') throw new Error('Unexpected action');
  const p = signProposal('u1', 's1', action);
  expect(verifyProposal(p.token, 'u1', 's1').action).toEqual(action);
  expect(() => verifyProposal(p.token, 'u2', 's1')).toThrow();
  expect(() => verifyProposal(p.token, 'u1', 's2')).toThrow();
  expect(() => verifyProposal(p.token.slice(0, -5) + 'abcde', 'u1', 's1')).toThrow();
  expect(() => appActionSchema.parse({ ...action, events: [{ ...action.events[0], scheduledDate: '2026-02-30' }] })).toThrow();
});

test('private tools deny access before calling a dependency', async () => {
  let reads = 0;
  const tools = buildCoachTools({ userId: 'u1', profile: null, deps: {
    getAnalysesByUser: async () => { reads++; return []; }, getMetricsTrend: async () => [],
    getCalendarEvents: async () => { reads++; return []; }, getReferenceDrill: async () => null,
  }, readAppData: async () => { reads++; return {}; } });
  for (const name of ['get_athlete_metrics', 'get_current_plan', 'read_app_data']) {
    expect(await tools.execute(name, { resource: 'profile' })).toContain('Access denied');
  }
  expect(reads).toBe(0);
  expect(await tools.execute('propose_app_action', { action: { kind: 'appearance', value: 'dark' } })).toContain('Access denied');
  expect(tools.proposals).toHaveLength(0);
});

test('tentative readings remain available without leaking unusable facts or false flaws', () => {
  const r = groundedResult({ metrics: [
    { key: 'knee_drive', trustStatus: 'experimental', measured: { value: 59, confidence: .55 } },
    { key: 'trunk_lean', trustStatus: 'trusted', measured: { value: 90, confidence: .2 } },
  ], flaws: [{ id: 'flaw-knee-drive', evidence: { measured: { value: 59, confidence: .55 } } }],
  focusAreas: [{ key: 'knee_drive', name: 'Tentative knee drive' }] });
  expect(r.metrics).toHaveLength(1);
  expect(r.flaws).toHaveLength(0);
  expect(r.focusAreas).toHaveLength(1);
});
