/**
 * Real-database regression for calendar_events.source / revealed_at.
 *
 * Every other route test mocks db/queries.js, which means no test could catch a
 * malformed *statement* — and one shipped: reusing the source parameter in both
 * the varchar column and a CASE comparison made Postgres deduce two types for
 * it and reject the insert with 42P08 ("inconsistent types deduced"). These
 * cases execute the actual SQL.
 *
 * Opt-in via STRIDE_DB_TESTS=1, because this is the only suite that opens a
 * real connection. Gating on DATABASE_URL would not work — src/__tests__/setup.ts
 * always defaults it — and every other test runs happily with no database at
 * all, a contract worth keeping. Bring the stack up with `npm run test:env:up`,
 * then: STRIDE_DB_TESTS=1 npm test
 */
import { jest } from '@jest/globals';

const describeDb = process.env.STRIDE_DB_TESTS === '1' ? describe : describe.skip;

jest.setTimeout(30_000);

describeDb('calendar_events source tagging (real DB)', () => {
  // Imported lazily so the connection pool is never created when skipping.
  let queries: typeof import('../queries.js');
  let userId: string;

  beforeAll(async () => {
    queries = await import('../queries.js');
    const { rows } = await queries.pool.query<{ id: string }>(
      `INSERT INTO users (supabase_uid, email) VALUES ($1, $2) RETURNING id`,
      [`test-src-${Date.now()}`, `test-src-${Date.now()}@example.test`],
    );
    userId = rows[0]!.id;
  });

  afterAll(async () => {
    if (userId) await queries.pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await queries.pool.end();
  });

  const day = (n: number) => `2027-03-${String(n).padStart(2, '0')}`;

  it.each(['coach', 'analysis'] as const)(
    'leaves %s-scheduled events unrevealed so they reach the card stack',
    async (source) => {
      const batch = await queries.createCalendarEvents(
        userId,
        [
          { title: 'A', event_type: 'drill', scheduled_date: day(1) },
          { title: 'B', event_type: 'workout', scheduled_date: day(2) },
        ],
        source,
      );
      expect(batch).toHaveLength(2);
      for (const row of batch) {
        expect(row.source).toBe(source);
        expect(row.revealed_at).toBeNull();
      }

      const single = await queries.createCalendarEvent(
        userId,
        { title: 'C', event_type: 'rest', scheduled_date: day(3) },
        source,
      );
      expect(single.source).toBe(source);
      expect(single.revealed_at).toBeNull();
    },
  );

  it('marks manually-added events revealed on the way in', async () => {
    // The athlete already knows about work they added themselves, so it must
    // never take the Plan tab over.
    const [row] = await queries.createCalendarEvents(
      userId,
      [{ title: 'D', event_type: 'drill', scheduled_date: day(4) }],
      'manual',
    );
    expect(row!.source).toBe('manual');
    expect(row!.revealed_at).not.toBeNull();

    const single = await queries.createCalendarEvent(userId, {
      title: 'E',
      event_type: 'drill',
      scheduled_date: day(5),
    });
    expect(single.source).toBe('manual');
    expect(single.revealed_at).not.toBeNull();
  });

  it('only offers non-manual, unrevealed events for reveal', async () => {
    await queries.createCalendarEvents(
      userId,
      [{ title: 'F', event_type: 'drill', scheduled_date: day(6) }],
      'coach',
    );
    await queries.createCalendarEvents(
      userId,
      [{ title: 'G', event_type: 'drill', scheduled_date: day(7) }],
      'manual',
    );

    const pending = await queries.getUnrevealedEvents(userId);
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((e) => e.source !== 'manual')).toBe(true);
    expect(pending.every((e) => e.revealed_at === null)).toBe(true);
    expect(pending.map((e) => e.title)).not.toContain('G');
  });

  it('round-trips decline and undo', async () => {
    const [row] = await queries.createCalendarEvents(
      userId,
      [{ title: 'H', event_type: 'drill', scheduled_date: day(8) }],
      'coach',
    );
    const declined = await queries.declineEvents(userId, [row!.id]);
    expect(declined[0]!.status).toBe('skipped');
    // Declining also counts as seen, so the card cannot come back.
    expect(declined[0]!.revealed_at).not.toBeNull();

    const restored = await queries.restoreEvents(userId, [row!.id]);
    expect(restored[0]!.status).toBe('scheduled');
  });

  it('marks events revealed, and is idempotent', async () => {
    const [row] = await queries.createCalendarEvents(
      userId,
      [{ title: 'I', event_type: 'drill', scheduled_date: day(9) }],
      'coach',
    );
    expect(await queries.markEventsRevealed(userId, [row!.id])).toBe(1);
    // Already revealed — a repeat send must be a no-op, not a second write.
    expect(await queries.markEventsRevealed(userId, [row!.id])).toBe(0);
  });
});
