import { randomUUID } from 'node:crypto';
const describeDb = process.env.STRIDE_DB_TESTS === '1' ? describe : describe.skip;

describeDb('approved coach actions and trusted progress (real DB)', () => {
  let q: typeof import('../queries.js');
  let apply: typeof import('../coachActions.js');
  let user: string, session: string;
  beforeAll(async () => {
    q = await import('../queries.js'); apply = await import('../coachActions.js');
    const id = randomUUID();
    const created = await q.createUser(`coach-action-${id}`, `${id}@example.test`);
    user = created.id; session = (await q.createCoachSession(user, 'free_coach', null)).id;
  });
  afterAll(async () => { if (user) await q.deleteUserAccount(user); await q.pool.end(); });

  it('creates, retries, moves and deletes the exact event without duplicates', async () => {
    const proposal = { nonce: randomUUID(), action: { kind: 'create_events' as const, events: [{ title: 'Tempo', eventType: 'workout' as const, scheduledDate: '2027-01-12', details: { volume: '20 minutes' } }] } };
    const first = await apply.applyCoachAction(user, session, proposal);
    const retried = await apply.applyCoachAction(user, session, proposal);
    expect(retried.events[0].id).toBe(first.events[0].id);
    expect(await q.getCalendarEvents(user, '2027-01-12', '2027-01-12')).toHaveLength(1);
    const event = first.events[0];
    const move = { nonce: randomUUID(), before: event, action: { kind: 'update_event' as const, eventId: event.id, changes: { scheduledDate: '2027-01-14' } } };
    const moved = await apply.applyCoachAction(user, session, move);
    expect(moved.event.scheduled_date).toBe('2027-01-14');
    expect(moved.event.details.volume).toBe('20 minutes');
    await expect(apply.applyCoachAction(user, session, { ...move, nonce: randomUUID() })).rejects.toThrow(/changed/);
    const deletion = { nonce: randomUUID(), before: moved.event, action: { kind: 'delete_event' as const, eventId: event.id } };
    await apply.applyCoachAction(user, session, deletion);
    await apply.applyCoachAction(user, session, deletion);
    expect(await q.getCalendarEventById(event.id, user)).toBeNull();
  });

  it('rejects completed training and rolls back the action receipt', async () => {
    const event = await q.createCalendarEvent(user, { title: 'Completed', event_type: 'workout', scheduled_date: '2026-01-12' });
    const completed = await q.updateCalendarEvent(event.id, user, { status: 'completed' });
    const nonce = randomUUID();
    await expect(apply.applyCoachAction(user, session, { nonce, before: completed, action: { kind: 'delete_event', eventId: event.id } })).rejects.toThrow(/Completed/);
    const receipts = await q.pool.query('SELECT id FROM coach_action_receipts WHERE id=$1', [nonce]);
    expect(receipts.rows).toHaveLength(0);
  });

  it('prevents untrusted timeline rows and filters historically polluted rows', async () => {
    const a = await q.createAnalysis(user, 'test-only.mp4');
    const measured = (key: string, confidence: number, trustStatus: string) => ({ key, trustStatus, measured: { value: 100, confidence }, unit: '°' });
    const result = { phase: 'general', reconstructionMethod: '2d', metrics: [measured('knee_drive', .9, 'trusted'), measured('hip_extension', .9, 'experimental'), measured('trunk_lean', .2, 'trusted')], captureQuality: { perMetricUsable: { knee_drive: true, hip_extension: true, trunk_lean: false } } };
    await q.updateAnalysisStatus(a.id, { status: 'completed', result_json: result });
    expect(await q.createMetricsFromAnalysis(user, a.id, result)).toHaveLength(1);
    // A row from an older API version must not become a trusted trend.
    await q.pool.query('INSERT INTO metrics_timeline (user_id, analysis_id, metric_key, value) VALUES ($1,$2,$3,$4)', [user,a.id,'hip_extension',100]);
    const timeline = await q.getMetricsTimeline(user, 30);
    expect(timeline.map((m) => m.metric_key)).toEqual(['knee_drive_angle']);
    expect(await q.getMetricsTrend(user, 'hip_extension', 4)).toHaveLength(0);
    expect(await q.getMetricsTrend(user, 'knee_drive_angle', 4)).toHaveLength(1);
  });
});
