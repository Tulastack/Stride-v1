import { describe, expect, it, jest } from '@jest/globals';
import { routeMessage } from '../router.js';
import { retrieveKnowledge, gradeEvidence } from '../knowledge.js';
import { gatherEvidence } from '../workflow.js';
import { finalizeReply } from '../reply.js';
import { buildCoachTools, type CoachDeps } from '../tools.js';
import { coachCapConfig } from '../../../db/queries.js';

const ALL = { analysis: true, calendar: true, profile: true, app: true };

function deps(): CoachDeps {
  return {
    getAnalysesByUser: jest.fn<CoachDeps['getAnalysesByUser']>(async () => [{
      id: 'a1', status: 'completed', completed_at: '2026-10-01', created_at: '2026-10-01',
      result_json: {
        metrics: [{ key: 'knee_drive', trustStatus: 'trusted', measured: { value: 59, confidence: 0.9 }, unit: '°', normalRange: [80, 110] }],
        flaws: [{ name: 'Low knee drive', severity: 3, plainExplanation: 'Thigh drops early.', evidence: { measured: { value: 59 } } }],
      },
    }]),
    getMetricsTrend: jest.fn<CoachDeps['getMetricsTrend']>(async () => []),
    getReferenceDrill: jest.fn<CoachDeps['getReferenceDrill']>(async () => null),
    getCalendarEvents: jest.fn<CoachDeps['getCalendarEvents']>(async () => []),
    listReferenceDrills: jest.fn<NonNullable<CoachDeps['listReferenceDrills']>>(async () => []),
  };
}

describe('router', () => {
  it('sends a general question to knowledge only, with no actions', () => {
    const r = routeMessage('How should I warm up before a 100m race?');
    expect([...r.intents]).toEqual(expect.arrayContaining(['knowledge']));
    expect(r.intents.has('form')).toBe(false);
    expect(r.needsActions).toBe(false);
  });

  it('routes a form question to the athlete data, not general knowledge', () => {
    const r = routeMessage('What should I fix first?');
    expect(r.intents.has('form')).toBe(true);
  });

  it('marks calendar edits as needing actions', () => {
    const r = routeMessage('Move my tempo session to Thursday');
    expect(r.intents.has('plan')).toBe(true);
    expect(r.needsActions).toBe(true);
  });

  it('lets a short follow-up inherit the previous topic', () => {
    const r = routeMessage('how many sets?', 'What should I fix first?');
    expect(r.intents.has('form')).toBe(true);
    expect(r.intents.has('drill')).toBe(true);
  });

  it('keeps a new question of its own from inheriting the last topic', () => {
    expect(routeMessage('How should I hydrate and recover?', 'Create a 2-week plan').intents.has('plan')).toBe(false);
  });

  it('flags direct change requests as commands, but not questions', () => {
    expect(routeMessage('Turn on dark mode').command).toBe(true);
    expect(routeMessage('Approve the pending drill suggestion').command).toBe(true);
    expect(routeMessage('What is on my calendar this week?').command).toBe(false);
  });

  it('routes tightness to injury guidance', () => {
    expect(routeMessage('My hamstring feels tight after sprints').intents.has('injury')).toBe(true);
  });
});

describe('retrieval', () => {
  it('matches a paraphrase through synonyms and grades it strong', () => {
    const hits = retrieveKnowledge('what should I eat before a meet', { topK: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(gradeEvidence(hits)).toBe('strong');
  });

  it('grades an empty result none', () => {
    expect(gradeEvidence(retrieveKnowledge('zzqx vvbn'))).toBe('none');
  });

  it('honours exclusions so repeated searches surface new entries', () => {
    const first = retrieveKnowledge('sleep and recovery', { topK: 1 });
    const second = retrieveKnowledge('sleep and recovery', { topK: 1, exclude: new Set([first[0].id]) });
    expect(second[0]?.id).not.toBe(first[0].id);
  });
});

describe('evidence workflow', () => {
  it('answers a well-covered knowledge question with no tools exposed', async () => {
    const toolset = buildCoachTools({ userId: 'u1', profile: null, permissions: ALL, deps: deps() });
    const message = 'How should I warm up before a race?';
    const plan = await gatherEvidence(routeMessage(message), toolset, { message });
    expect(plan.block).toMatch(/Evidence grade: strong/);
    expect(plan.toolNames).toEqual([]);
  });

  it('prefetches the athlete metrics for a form question and keeps follow-up tools', async () => {
    const d = deps();
    const toolset = buildCoachTools({ userId: 'u1', profile: null, permissions: ALL, deps: d });
    const message = 'What should I fix first?';
    const plan = await gatherEvidence(routeMessage(message), toolset, { message, flawNames: ['Low knee drive'], flawMetricKeys: ['knee_drive'] });
    expect(plan.block).toContain('[A]');
    expect(plan.toolNames).toContain('get_reference_drill');
    expect(d.getAnalysesByUser).toHaveBeenCalled();
  });

  it('reads nothing private when access is off', async () => {
    const d = deps();
    const toolset = buildCoachTools({ userId: 'u1', profile: null, permissions: { analysis: false, calendar: false, profile: false, app: false }, deps: d });
    const message = 'What should I fix first?';
    await gatherEvidence(routeMessage(message), toolset, { message });
    expect(d.getAnalysesByUser).not.toHaveBeenCalled();
  });

  it('answers a repeated identical call from memory instead of re-running it', async () => {
    const d = deps();
    const toolset = buildCoachTools({ userId: 'u1', profile: null, permissions: ALL, deps: d });
    await toolset.execute('get_athlete_metrics', {});
    const again = await toolset.execute('get_athlete_metrics', {});
    expect(again).toMatch(/Same call already made/);
    expect(d.getAnalysesByUser).toHaveBeenCalledTimes(1);
  });
});

describe('finalizeReply', () => {
  it('strips the SOURCES line and resolves only known evidence', () => {
    const out = finalizeReply('FOCUS: Drive the knee.\nSOURCES: [A], [K:warmup], [X:fake]', {
      evidence: new Map([['A', 'Your analysis'], ['K:warmup', 'Warm-up']]),
    });
    expect(out.text).toBe('FOCUS: Drive the knee.');
    expect(out.sources).toEqual([{ id: 'A', title: 'Your analysis' }, { id: 'K:warmup', title: 'Warm-up' }]);
  });

  it('drops chart links to metrics that were not measured', () => {
    const out = finalizeReply('FOCUS: x\nMETRIC: knee_drive\nMETRIC: cadence', { measuredKeys: new Set(['knee_drive']) });
    expect(out.text).toContain('METRIC: knee_drive');
    expect(out.text).not.toContain('cadence');
  });

  it('removes dashes while keeping number ranges readable', () => {
    expect(finalizeReply('Do 3\u20135 reps \u2014 then rest').text).toBe('Do 3 to 5 reps, then rest');
  });
});

describe('message cap config', () => {
  it('defaults to 20 messages for the whole beta', () => {
    const saved = { cap: process.env.COACH_MESSAGE_CAP, period: process.env.COACH_CAP_PERIOD };
    delete process.env.COACH_MESSAGE_CAP; delete process.env.COACH_CAP_PERIOD;
    expect(coachCapConfig()).toEqual({ cap: 20, period: 'beta' });
    process.env.COACH_CAP_PERIOD = 'month';
    process.env.COACH_MESSAGE_CAP = '0';
    expect(coachCapConfig(new Date('2026-10-12T00:00:00Z'))).toEqual({ cap: 0, period: '2026-10' });
    for (const [k, v] of [['COACH_MESSAGE_CAP', saved.cap], ['COACH_CAP_PERIOD', saved.period]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});
