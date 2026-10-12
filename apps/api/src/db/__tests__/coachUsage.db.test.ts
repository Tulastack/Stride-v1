import { randomUUID } from 'node:crypto';
const describeDb = process.env.STRIDE_DB_TESTS === '1' ? describe : describe.skip;

describeDb('coach message cap (real DB)', () => {
  let q: typeof import('../queries.js');
  let user: string;
  const saved = { cap: process.env.COACH_MESSAGE_CAP, period: process.env.COACH_CAP_PERIOD };
  beforeAll(async () => {
    process.env.COACH_MESSAGE_CAP = '20'; process.env.COACH_CAP_PERIOD = 'beta';
    q = await import('../queries.js');
    const id = randomUUID();
    user = (await q.createUser(`coach-usage-${id}`, `${id}@example.test`)).id;
  });
  afterAll(async () => {
    if (user) await q.deleteUserAccount(user);
    await q.pool.end();
    for (const [k, v] of [['COACH_MESSAGE_CAP', saved.cap], ['COACH_CAP_PERIOD', saved.period]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  it('grants exactly the cap when messages race for the last slots', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => q.reserveCoachMessage(user)));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(await q.getCoachUsage(user)).toMatchObject({ used: 20, cap: 20, remaining: 0 });
  });

  it('gives a slot back on refund and records tokens', async () => {
    await q.refundCoachMessage(user, 'beta');
    expect((await q.getCoachUsage(user)).remaining).toBe(1);
    expect(await q.reserveCoachMessage(user)).toMatchObject({ used: 20, remaining: 0 });
    await q.recordCoachTokens(user, 'beta', 1500, 200);
    const { rows } = await q.pool.query('SELECT prompt_tokens, completion_tokens FROM coach_usage WHERE user_id = $1', [user]);
    expect(rows[0]).toEqual({ prompt_tokens: '1500', completion_tokens: '200' });
  });

  it('is removed with the account', async () => {
    const id = randomUUID();
    const other = (await q.createUser(`coach-usage-${id}`, `${id}@example.test`)).id;
    await q.reserveCoachMessage(other);
    await q.deleteUserAccount(other);
    const { rows } = await q.pool.query('SELECT 1 FROM coach_usage WHERE user_id = $1', [other]);
    expect(rows).toHaveLength(0);
  });
});
