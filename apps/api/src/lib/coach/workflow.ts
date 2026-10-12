// Stride Coach, evidence workflow.
//
// Plan-then-execute instead of discover-as-you-go. ReWOO (Xu et al. 2023)
// showed that fetching evidence from a plan made up front, rather than one
// tool call per model round, cuts tokens about 5x with no accuracy loss, and
// LLMCompiler (Kim et al., ICML 2024) that running independent calls in
// parallel cuts latency up to 3.7x. Here the plan comes from the router, the
// calls are local reads that finish in milliseconds, and the model gets
// everything in its FIRST round. The common case becomes one model call.
//
// The model still has tools for what the plan missed, but only the ones this
// route can use: fewer, relevant tools make small models choose more
// accurately and run faster (Less-is-More, Paramanayakam et al., DATE 2025).
//
// Order matters: models use evidence at the start and end of a long context
// far better than the middle (Liu et al., "Lost in the Middle", TACL 2024), so
// the evidence that answers the question goes first.

import type { Route } from './router.js';
import type { CoachToolset } from './tools.js';

export interface WorkflowHints {
  /** The question, used as the knowledge query. */
  message: string;
  /** Names of the latest analysis's worst flaws, to target retrieval. */
  flawNames?: string[];
  /** Metric keys behind those flaws, for drill lookup. */
  flawMetricKeys?: string[];
  /** Metric keys in the latest analysis (trusted first), for trends. */
  metricKeys?: string[];
}

export interface EvidencePlan {
  /** EVIDENCE block for the system turn ('' when nothing was gathered). */
  block: string;
  /** Tools to expose this turn; [] means answer in one call. */
  toolNames: string[];
}

/** Per-item and overall caps keep the first round inside a few thousand tokens. */
const ITEM_CHARS = 2400;
const TOTAL_CHARS = 9000;

export async function gatherEvidence(route: Route, toolset: CoachToolset, hints: WorkflowHints): Promise<EvidencePlan> {
  const { intents } = route;
  const steps: { order: number; call: [string, Record<string, any>] }[] = [];
  const add = (order: number, name: string, args: Record<string, any> = {}) => steps.push({ order, call: [name, args] });

  const own = intents.has('form') || intents.has('progress');
  if (own) add(0, 'get_athlete_metrics');
  if (intents.has('progress')) {
    for (const key of (hints.metricKeys ?? []).slice(0, 3)) add(1, 'get_metric_trend', { metric_key: key });
  }
  if (intents.has('form') || intents.has('drill')) {
    for (const key of (hints.flawMetricKeys ?? []).slice(0, 2)) add(2, 'get_reference_drill', { metric_key: key });
  }
  if (intents.has('knowledge') || intents.has('drill') || intents.has('injury') || intents.has('form')) {
    // For "what should I fix" the athlete's own flaws are the real query.
    const query = intents.has('form') && hints.flawNames?.length
      ? `${hints.flawNames.join(' ')} ${hints.message}` : hints.message;
    add(own ? 3 : 0, 'search_track_knowledge', { query });
  }
  if (intents.has('plan')) add(1, 'get_current_plan', { days: 14 });
  if (intents.has('injury') || intents.has('plan') || intents.has('profile')) add(4, 'read_app_data', { resource: 'profile' });
  if (intents.has('suggestions')) add(2, 'read_app_data', { resource: 'suggestions' });
  if (intents.has('app')) add(5, 'read_app_data', { resource: 'settings' });

  const results = await Promise.all(steps.map(async (s) => ({ order: s.order, out: await toolset.execute(...s.call) })));
  const usable = results
    .filter((r) => !/^(Access denied|Tool ".*" failed|Resource unavailable|Unknown)/.test(r.out))
    .sort((a, b) => a.order - b.order)
    .map((r) => (r.out.length > ITEM_CHARS ? `${r.out.slice(0, ITEM_CHARS)}\n[truncated]` : r.out));

  let block = '';
  for (const item of usable) {
    if (block.length + item.length > TOTAL_CHARS) break;
    block += `${block ? '\n\n' : ''}${item}`;
  }

  const strongKnowledge = /Evidence grade: strong/.test(block);
  const toolNames = new Set<string>();
  if (route.needsActions) ['propose_app_action', 'read_app_data', 'get_current_plan'].forEach((t) => toolNames.add(t));
  if (own) ['get_metric_trend', 'get_athlete_metrics', 'read_app_data'].forEach((t) => toolNames.add(t));
  if (intents.has('drill') || intents.has('form')) toolNames.add('get_reference_drill');
  // A pure knowledge question with strong evidence is answered in one call;
  // otherwise one search stays available for what the plan missed.
  const pureKnowledge = [...intents].every((i) => i === 'knowledge' || i === 'injury');
  if (!(pureKnowledge && strongKnowledge)) toolNames.add('search_track_knowledge');

  return { block, toolNames: [...toolNames] };
}
