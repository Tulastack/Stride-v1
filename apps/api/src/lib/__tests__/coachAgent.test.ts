/**
 * Unit tests for the agentic, track-focused coach:
 *  - the lexical knowledge retriever grounds answers in the vetted corpus
 *  - the tool executors return real, injected athlete data
 *  - runTrackCoach drives a genuine tool-calling loop (call tool → read result
 *    → answer), not a single blind completion.
 *
 * No network: fetch is injected and DB access is stubbed.
 */
import { jest } from '@jest/globals';
import { retrieveKnowledge } from '../coach/knowledge.js';
import { buildCoachTools, type CoachDeps } from '../coach/tools.js';
import { runTrackCoach } from '../coach/agent.js';
import { CoachRateLimitError } from '../coach/errors.js';

describe('retrieveKnowledge', () => {
  it('returns the most relevant, sourced entry for a query', () => {
    const hits = retrieveKnowledge('how do I fix overstriding?');
    expect(hits.length).toBeGreaterThan(0);
    const ids = hits.map((h) => h.id);
    expect(ids).toContain('overstriding-flaw');
    // every hit carries an attribution so the agent can cite it
    expect(hits.every((h) => h.source && h.source.length > 0)).toBe(true);
  });

  it('biases toward the athlete event when provided', () => {
    const hits = retrieveKnowledge('race pacing strategy', { event: '400m', topK: 3 });
    expect(hits.map((h) => h.id)).toContain('race-400');
  });

  it('returns [] for an empty/stopword-only query', () => {
    expect(retrieveKnowledge('the a of to')).toEqual([]);
  });
});

function makeDeps(overrides: Partial<CoachDeps> = {}): CoachDeps {
  return {
    getAnalysesByUser: jest.fn<CoachDeps['getAnalysesByUser']>(async () => [
      {
        status: 'completed',
        completed_at: '2026-07-01',
        result_json: {
          economyScore: 72,
          metrics: [{ key: 'knee_drive', trustStatus: 'trusted', measured: { value: 59, confidence: 0.9 }, unit: '°', normalRange: [80, 110] }],
          flaws: [{ name: 'Low knee drive', severity: 3, plainExplanation: 'Thigh drops early.' }],
        },
      },
    ]),
    getMetricsTrend: jest.fn<CoachDeps['getMetricsTrend']>(async () => []),
    getReferenceDrill: jest.fn<CoachDeps['getReferenceDrill']>(async () => null),
    getCalendarEvents: jest.fn<CoachDeps['getCalendarEvents']>(async () => []),
    ...overrides,
  };
}

describe('coach tool executors', () => {
  it('search_track_knowledge returns grounded text with sources', async () => {
    const tools = buildCoachTools({ userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: { event_specialty: '100m' }, deps: makeDeps() });
    const out = await tools.execute('search_track_knowledge', { query: 'max velocity front side mechanics' });
    expect(out).toMatch(/Source:/);
    expect(out.toLowerCase()).toContain('velocity');
  });

  it('get_athlete_metrics surfaces the real measured numbers', async () => {
    const deps = makeDeps();
    const tools = buildCoachTools({ userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: null, deps });
    const out = await tools.execute('get_athlete_metrics', {});
    expect(out).toContain('59');
    expect(out).toContain('knee drive');
    expect(deps.getAnalysesByUser).toHaveBeenCalledWith('u1');
  });

  it('never throws, a failing dep is reported as text', async () => {
    const deps = makeDeps({
      getReferenceDrill: jest.fn<CoachDeps['getReferenceDrill']>(async () => {
        throw new Error('db down');
      }),
    });
    const tools = buildCoachTools({ userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: null, deps });
    const out = await tools.execute('get_reference_drill', { drill_key: 'drill-wickets' });
    expect(out).toContain('failed');
  });
});

describe('runTrackCoach agentic loop', () => {
  const OLD_KEY = process.env.GROQ_API_KEY;
  beforeAll(() => { process.env.GROQ_API_KEY = 'test-key'; });
  afterAll(() => { process.env.GROQ_API_KEY = OLD_KEY; });

  function jsonResponse(payload: any) {
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as any;
  }

  it('calls a tool, reads the result, then produces a final grounded answer', async () => {
    const deps = makeDeps();
    const tools = buildCoachTools({ userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: { event_specialty: '100m' }, deps });

    // Round 1: model asks for the athlete's metrics. Round 2: model answers.
    const fetchImpl = jest
      .fn<any>()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'get_athlete_metrics', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: '🎯 Your knee drive of 59° is low. 💪 Try A-skips.' } }] }),
      );

    const answer = await runTrackCoach({
      userMessage: 'How is my form?',
      analysisContext: 'ATHLETE: test',
      toolset: tools,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(answer).toContain('59°');
    // The loop actually ran the tool (grounding) before answering.
    expect(deps.getAnalysesByUser).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Second request must include the tool result message in the transcript.
    const secondBody = JSON.parse((fetchImpl.mock.calls[1] as any)[1].body);
    const roles = secondBody.messages.map((m: any) => m.role);
    expect(roles).toContain('tool');

    // Exactly ONE system turn, carrying both the persona and the grounding.
    // Gemma 4's chat template expects a single system turn, so a second one
    // would silently cost the coach its athlete context on that provider.
    const firstBody = JSON.parse((fetchImpl.mock.calls[0] as any)[1].body);
    const systems = firstBody.messages.filter((m: any) => m.role === 'system');
    expect(systems).toHaveLength(1);
    expect(systems[0].content).toContain('Stride Coach');
    expect(systems[0].content).toContain('ATHLETE: test');
  });

  const actionTools = () => buildCoachTools({
    userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: null, deps: makeDeps(),
    proposeAction: async (action: any) => ({ token: 'tok', label: 'Use dark appearance', action }),
  });

  it('requires a tool call on the first round of a direct command', async () => {
    const fetchImpl = jest.fn<any>().mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Done.' } }] }));
    await runTrackCoach({ userMessage: 'Turn on dark mode', analysisContext: '', toolset: actionTools(),
      toolNames: ['propose_app_action'], command: true, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(JSON.parse((fetchImpl.mock.calls[0] as any)[1].body).tool_choice).toBe('required');
  });

  it('sends a reply that claims an unmade change back for one correction', async () => {
    const fetchImpl = jest.fn<any>()
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'PLAN: Proposed approval for Wall drives.' } }] }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'PLAN: You have one pending suggestion, Wall drives.' } }] }));
    const answer = await runTrackCoach({ userMessage: 'Tell me about my suggestion', analysisContext: '', toolset: actionTools(),
      toolNames: ['propose_app_action'], fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const second = JSON.parse((fetchImpl.mock.calls[1] as any)[1].body);
    expect(second.messages.at(-1).content).toMatch(/propose_app_action was not called/);
    expect(answer).toBe('PLAN: You have one pending suggestion, Wall drives.');
  });

  it('throws CoachRateLimitError (not a generic Error) on a 429 from Groq', async () => {
    const tools = buildCoachTools({ userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: null, deps: makeDeps() });
    const fetchImpl = jest.fn<any>().mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => '{"error":{"message":"Rate limit reached ... tokens per day (TPD)"}}',
    } as any);

    await expect(
      runTrackCoach({
        userMessage: 'How is my form?',
        analysisContext: 'ATHLETE: test',
        toolset: tools,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(CoachRateLimitError);
  });

  it('throws when no LLM key is configured so the route can fall back', async () => {
    const names = ['GROQ_API_KEY', 'OPENROUTER_API_KEY', 'INCEPTION_API_KEY', 'GOOGLE_API_KEY', 'LLM_PROVIDER'];
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    names.forEach((n) => delete process.env[n]);
    try {
      const tools = buildCoachTools({ userId: 'u1', permissions: { analysis: true, calendar: true, profile: true, app: true }, profile: null, deps: makeDeps() });
      await expect(
        runTrackCoach({ userMessage: 'hi', analysisContext: '', toolset: tools }),
      ).rejects.toThrow(/not configured/);
    } finally {
      for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
    }
  });
});
