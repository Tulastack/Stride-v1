/**
 * PROMPT F.7 — calendar approval gate.
 * Unit: proposal generation is pure/no side effects; approval is the only write.
 * Integration: analysis completion never creates events; only commit() does.
 */
import { jest } from '@jest/globals';
import { generateProposal } from '../proposal.js';
import { LocalCalendarProvider } from '../provider.js';
import type { DrillRec } from '@stride/types';

const focus: DrillRec = {
  flawId: 'flaw-low-knee',
  drillId: 'high-knee-switch',
  drillName: 'High-knee wall switches',
  cue: 'Punch the knee up higher than normal.',
  demoAssetId: 'demo-high-knee-switch',
  sets: 3,
  reps: 10,
  rationale: 'Raises knee-drive height.',
};

describe('generateProposal (pure)', () => {
  it('produces a deterministic proposed schedule with no side effects', () => {
    const a = generateProposal(focus, { startDate: '2026-02-02', sessions: 3, everyNDays: 2 });
    const b = generateProposal(focus, { startDate: '2026-02-02', sessions: 3, everyNDays: 2 });
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(a.map((s) => s.scheduledDate)).toEqual(['2026-02-02', '2026-02-04', '2026-02-06']);
    expect(a[0].details.flawId).toBe('flaw-low-knee');
  });

  it('carries the drill prescription into details', () => {
    const [first] = generateProposal(focus, { startDate: '2026-02-02' });
    expect(first.details.sets).toBe(3);
    expect(first.details.reps).toBe(10);
    expect(first.title).toBe('High-knee wall switches');
  });
});

describe('approval is the only write path', () => {
  it('generating a proposal calls no DB writer', () => {
    const writer = jest.fn();
    // Simulate "analysis completion" / proposal building: never writes.
    generateProposal(focus, { startDate: '2026-02-02' });
    expect(writer).not.toHaveBeenCalled();
  });

  it('only commit() (approval) writes events', async () => {
    const createCalendarEvents = jest
      .fn<(...args: any[]) => Promise<{ id: string; title: string; scheduled_date: string }[]>>()
      .mockResolvedValue([
        { id: 'e1', title: 'High-knee wall switches', scheduled_date: '2026-02-02' },
      ]);
    const provider = new LocalCalendarProvider(createCalendarEvents as any);

    const proposal = generateProposal(focus, { startDate: '2026-02-02', sessions: 1 });
    expect(createCalendarEvents).not.toHaveBeenCalled(); // proposal != write

    const committed = await provider.commit('user-1', proposal);
    expect(createCalendarEvents).toHaveBeenCalledTimes(1);
    expect(committed).toEqual([{ id: 'e1', title: 'High-knee wall switches', scheduledDate: '2026-02-02' }]);
  });

  it('committing an empty (declined) proposal writes nothing', async () => {
    const createCalendarEvents = jest.fn();
    const provider = new LocalCalendarProvider(createCalendarEvents as any);
    const committed = await provider.commit('user-1', []);
    expect(createCalendarEvents).not.toHaveBeenCalled();
    expect(committed).toEqual([]);
  });
});
