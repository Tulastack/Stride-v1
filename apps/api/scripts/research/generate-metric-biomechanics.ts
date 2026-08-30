#!/usr/bin/env tsx
/**
 * scripts/research/generate-metric-biomechanics
 *
 * Offline, one-off research pipeline: for each Stride biomechanics metric,
 * maps the measurement to the body part/mechanism it implicates and the
 * injury/inefficiency risk it's associated with, backed by real literature —
 * then builds a tiered (beginner/intermediate/advanced) corrective exercise
 * program from that mapping. See docs/research/metric-biomechanics.md for
 * the full design and docs/research/angle-agnostic-kinematics.md for the
 * house fan-out/checker/synthesis convention this follows.
 *
 * Seven roles, run per metric:
 *   1. Biometrics agent   — researches body region/mechanism/injury risk
 *   2. Checker A          — independently re-derives + verifies (1)
 *   3. Checker B          — independently re-derives + verifies (1), no
 *                           visibility into Checker A
 *   4. Orchestrator audit — programmatic accountability pass over (1)-(3):
 *                           citation presence, coverage, checker convergence
 *   5. Plan agent 1       — high-level corrective movement categories
 *   6. Plan agent 2       — PT-literature deep dive, cited sets/reps/protocol
 *   7. Packaging agent    — merges (5)+(6) into 3 tiers matching Stride's
 *                           existing experienceLevel/isInjured/flawSeverity
 *                           axes (apps/api/src/calendar/trainingPlan.ts)
 *
 * This is a RESEARCH step, not a runtime dependency — output lands in
 * output/<metric>.json and output/<metric>.sql for HUMAN REVIEW before
 * anything is synced into biomech2d.py, knowledge.ts, or
 * reference_drills.tiers. Nothing here is called from the analysis pipeline
 * or the coach agent's hot path.
 *
 * Usage:
 *   npx tsx apps/api/scripts/research/generate-metric-biomechanics.ts pelvic_drop
 *   npx tsx apps/api/scripts/research/generate-metric-biomechanics.ts --all
 *
 * Requires ANTHROPIC_API_KEY (or an `ant auth login` profile) — this makes
 * real, billed Claude Opus 5 + web-search calls. A single metric run is
 * roughly 6 model calls; running --all against a real API key has a real
 * dollar cost. Nothing here runs automatically — it's a script a human
 * invokes deliberately.
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BIOMECH_PY_PATH = resolve(here, '../../../ml-worker/src/biomech2d.py');
const OUTPUT_DIR = resolve(here, 'output');

const MODEL = 'claude-opus-5';
const client = new Anthropic();

// ─── Metric keys, pulled live from the source of truth ─────────────────────
// Never hand-typed here — a metric silently missing from this list is
// exactly the "only the easy ones get done" failure mode the orchestrator
// audit exists to catch, so the list itself must not be able to drift.
function loadMetricKeys(): string[] {
  const src = readFileSync(BIOMECH_PY_PATH, 'utf-8');
  const block = src.match(/NORMAL_RANGE:[^{]*\{([\s\S]*?)\n\}/);
  if (!block) {
    throw new Error(
      `Could not locate NORMAL_RANGE dict in ${BIOMECH_PY_PATH} — has the source format changed? ` +
        'Update the regex in loadMetricKeys() rather than hand-typing the metric list.',
    );
  }
  const keys = [...block[1]!.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]!);
  if (keys.length === 0) {
    throw new Error('Parsed zero metric keys from biomech2d.py — regex is likely stale.');
  }
  return keys;
}

// ─── Shared model-call helper ───────────────────────────────────────────────
// Server tools (web_search) run inline within one messages.create() call;
// the only reason to loop is a pause_turn on a long-running search turn.
async function runTurn(system: string, user: string, opts: { search: boolean }): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: user }];
  const tools = opts.search
    ? [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 15 }]
    : undefined;

  for (let guard = 0; guard < 10; guard++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system,
      ...(tools ? { tools } : {}),
      messages,
    });

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  throw new Error('Exceeded pause_turn resumption guard (10 iterations) without finishing.');
}

function extractJson<T>(text: string, label: string): T {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) ?? text.match(/```\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1]! : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`[${label}] No JSON object found in model output:\n${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as T;
  } catch (err) {
    throw new Error(`[${label}] JSON parse failed: ${(err as Error).message}\n${raw.slice(0, 800)}`);
  }
}

// ─── Role 1: Biometrics agent ───────────────────────────────────────────────
interface Citation {
  citation: string;
  url_or_doi?: string;
  what_it_shows: string;
}
interface InjuryRisk {
  name: string;
  mechanism_note: string;
}
interface BiomechanicsFinding {
  metric_key: string;
  body_region: string;
  primary_structure: string;
  mechanism: string;
  injury_risks: InjuryRisk[];
  confidence: 'established' | 'emerging' | 'preliminary';
  correlation_or_causal: 'causal_mechanism' | 'correlational' | 'biomechanically_plausible';
  hedge_note: string;
  citations: Citation[];
  search_log: string[];
}

async function runBiometricsAgent(metricKey: string, unit: string, plane: string, currentWhy: string): Promise<BiomechanicsFinding> {
  const system =
    'You are the biometrics research agent in a pipeline for Stride, a sprint-biomechanics coaching app. ' +
    'You research ONE running metric and produce a literature-backed mapping from the kinematic measurement ' +
    'to the body part/mechanism it implicates and the injury/inefficiency risk it is associated with. ' +
    'This output may inform real athlete-facing coaching content, so it must be genuinely researched via ' +
    'web search, not written from memory or invented. Do not overstate confidence, and explicitly distinguish ' +
    'causal mechanisms from correlational/observational findings.';

  const user = `Metric: \`${metricKey}\` (unit: ${unit}, plane: ${plane}).
Current app explanation (extend/validate/deepen, don't just restate): "${currentWhy}"

Use real web search (multiple queries) to find sports-medicine / biomechanics / gait-analysis literature on this metric during running — what causes deviations, what body structures are implicated, what injuries or performance issues it's associated with, ideally in runners specifically. Only cite sources you can name with something a human could verify (author/year/journal, or a stable URL). Note whether evidence is well-replicated, single-study, or plausible-reasoning-only, and whether relationships are causal or correlational.

Respond with ONLY a JSON object (in a \`\`\`json fence), matching this shape exactly:
{
  "metric_key": "${metricKey}",
  "body_region": "...",
  "primary_structure": "...",
  "mechanism": "2-4 sentences",
  "injury_risks": [{"name": "...", "mechanism_note": "..."}],
  "confidence": "established|emerging|preliminary",
  "correlation_or_causal": "causal_mechanism|correlational|biomechanically_plausible",
  "hedge_note": "1-3 sentences on what the evidence does/doesn't support",
  "citations": [{"citation": "...", "url_or_doi": "...", "what_it_shows": "..."}],
  "search_log": ["query 1", "query 2", ...]
}
search_log must list the actual queries you ran — the orchestrator audit checks this is non-empty as a real-research signal.`;

  const text = await runTurn(system, user, { search: true });
  return extractJson<BiomechanicsFinding>(text, `biometrics:${metricKey}`);
}

// ─── Roles 2/3: Checkers ────────────────────────────────────────────────────
interface CheckerVerdict {
  verdict: 'confirmed' | 'partial' | 'contradicted' | 'no_lit_found';
  reasoning: string;
  own_citations: Citation[];
  corrections: string[];
  additions: string[];
}

async function runChecker(label: 'A' | 'B', finding: BiomechanicsFinding): Promise<CheckerVerdict> {
  const system =
    `You are Checker ${label} in a research-verification pipeline for Stride, a sprint-biomechanics coaching app. ` +
    'Another agent researched a running metric and produced claims about body structures and injury associations. ' +
    'Verify INDEPENDENTLY — run your own web searches, do not just skim the given citation list and agree. ' +
    'You have not seen a second checker\'s work; do not try to produce a "balanced" answer, just report what you find.';

  const user = `Metric: \`${finding.metric_key}\`
Claimed mechanism: ${finding.mechanism}
Claimed injury risks: ${JSON.stringify(finding.injury_risks)}
Claimed confidence: ${finding.confidence} / ${finding.correlation_or_causal}
Claimed citations: ${JSON.stringify(finding.citations)}

Run your own independent searches. Try to verify the specific citations (do they say what's claimed?). Form your own view of what the literature says, independent of the claims above — note anything missed or overstated.

Respond with ONLY a JSON object (in a \`\`\`json fence):
{
  "verdict": "confirmed|partial|contradicted|no_lit_found",
  "reasoning": "...",
  "own_citations": [{"citation": "...", "url_or_doi": "...", "what_it_shows": "..."}],
  "corrections": ["specific claim that was wrong or overstated, if any"],
  "additions": ["significant citation or finding the original agent missed, if any"]
}`;

  const text = await runTurn(system, user, { search: true });
  return extractJson<CheckerVerdict>(text, `checker${label}:${finding.metric_key}`);
}

// ─── Role 4: Orchestrator audit (programmatic, not a model call) ──────────
interface AuditResult {
  metricKey: string;
  status: 'covered' | 'needs_rework' | 'blocked';
  issues: string[];
}

function auditFinding(finding: BiomechanicsFinding, checkerA: CheckerVerdict, checkerB: CheckerVerdict): AuditResult {
  const issues: string[] = [];

  if (!finding.search_log || finding.search_log.length === 0) {
    issues.push('search_log is empty — no evidence the biometrics agent actually searched.');
  }
  if (!finding.citations || finding.citations.length === 0) {
    issues.push('No citations provided.');
  }
  if (!finding.body_region || !finding.primary_structure || !finding.mechanism || !finding.injury_risks?.length) {
    issues.push('One or more required fields empty (body_region/primary_structure/mechanism/injury_risks).');
  }
  if (!finding.hedge_note) {
    issues.push('No hedge_note — confidence claim is unqualified.');
  }
  if (checkerA.verdict === 'contradicted' || checkerB.verdict === 'contradicted') {
    issues.push('At least one checker contradicted the finding — requires human review before shipping.');
  }
  if (checkerA.verdict === 'no_lit_found' && checkerB.verdict === 'no_lit_found') {
    issues.push('Neither checker found supporting literature independently.');
  }
  if (checkerA.verdict !== checkerB.verdict) {
    issues.push(
      `Checkers diverged (A=${checkerA.verdict}, B=${checkerB.verdict}) — flagged for manual review, not auto-resolved.`,
    );
  }

  const blocked = issues.some((i) => i.includes('contradicted') || i.includes('empty'));
  const status: AuditResult['status'] = blocked ? 'blocked' : issues.length > 0 ? 'needs_rework' : 'covered';
  return { metricKey: finding.metric_key, status, issues };
}

// ─── Roles 5/6: Plan agents ─────────────────────────────────────────────────
interface MovementCategory {
  category: string;
  rationale: string;
  addresses: string;
}
interface PlanAgent1Output {
  metric_key: string;
  movement_categories: MovementCategory[];
  sequencing_note: string;
}

async function runPlanAgent1(finding: BiomechanicsFinding): Promise<PlanAgent1Output> {
  const system =
    'You are the high-level planning agent in a training-plan pipeline for Stride. Given a checker-verified ' +
    'metric-to-injury mapping, propose 2-4 basic corrective MOVEMENT CATEGORIES (not named exercises with dosage — ' +
    'that is a separate agent\'s job). Reason from the actual mechanism, not generic advice.';

  const user = `Metric: \`${finding.metric_key}\`
Mechanism: ${finding.mechanism}
Injury risks: ${JSON.stringify(finding.injury_risks)}
Confidence: ${finding.confidence} (${finding.correlation_or_causal}) — ${finding.hedge_note}

You may do light web searching to inform category selection, but this is primarily a reasoning task.

Respond with ONLY a JSON object (in a \`\`\`json fence):
{
  "metric_key": "${finding.metric_key}",
  "movement_categories": [{"category": "...", "rationale": "2-3 sentences tied to the mechanism/evidence above", "addresses": "which injury risk(s)"}],
  "sequencing_note": "..."
}`;

  const text = await runTurn(system, user, { search: true });
  return extractJson<PlanAgent1Output>(text, `plan1:${finding.metric_key}`);
}

interface ExerciseSpec {
  name: string;
  sets_reps: string;
  frequency: string;
  progression_note: string;
  source: string;
  contraindication_note: string;
}
interface PlanAgent2Output {
  metric_key: string;
  exercises: ExerciseSpec[];
  protocol_source_confidence: string;
}

async function runPlanAgent2(finding: BiomechanicsFinding): Promise<PlanAgent2Output> {
  const system =
    'You are the PT/medical-literature deep-dive agent in a training-plan pipeline for Stride. Find REAL, cited ' +
    'exercises with REAL sets/reps/frequency/progression protocols from sports-PT/rehab literature — not ' +
    'plausible-sounding numbers. Prioritize pulling an actual intervention-study protocol if one exists for this ' +
    'mechanism; otherwise cite general rehab-literature dosing for the same target structure. You run in ' +
    'PARALLEL with a separate high-level movement-category agent working from the same mapping below — you do ' +
    'not see its output, so focus on specific, dosed, cited exercises rather than category-level reasoning.';

  const user = `Metric: \`${finding.metric_key}\`
Mechanism: ${finding.mechanism}
Primary structure: ${finding.primary_structure}
Injury risks: ${JSON.stringify(finding.injury_risks)}

Do a genuine literature search for real, cited exercise protocols targeting this structure/mechanism. Note contraindications where the literature mentions them.

Respond with ONLY a JSON object (in a \`\`\`json fence):
{
  "metric_key": "${finding.metric_key}",
  "exercises": [{"name": "...", "sets_reps": "...", "frequency": "...", "progression_note": "...", "source": "real citation", "contraindication_note": "..."}],
  "protocol_source_confidence": "did you find an actual named intervention-study protocol, or general rehab-literature dosing? be explicit."
}`;

  const text = await runTurn(system, user, { search: true });
  return extractJson<PlanAgent2Output>(text, `plan2:${finding.metric_key}`);
}

// ─── Role 7: Packaging agent ─────────────────────────────────────────────────
// Output is an ORDERED 4-phase recovery arc — every athlete who gets this
// metric's flaw progresses phase 1 -> 2 -> 3 -> 4 in sequence, each phase's
// exercise group entirely replacing the last. This is NOT a difficulty tier
// an athlete is assigned once; it's a recovery timeline. See
// calendar/trainingPlan.ts::generateRecoveryProgram and
// docs/research/metric-biomechanics.md for the shape this feeds.
interface PhaseExercise {
  name: string;
  sets: number;
  reps: string;
  cue: string;
  rationale: string;
  source_citation: string;
}
interface RecoveryPhaseOutput {
  phase: 1 | 2 | 3 | 4;
  name: 'Stability' | 'Strength' | 'Plyometrics & Movement' | 'Back to Sport';
  duration_weeks_min: number;
  duration_weeks_max: number;
  days_per_week: number;
  exercises: PhaseExercise[];
  advance_criteria: string;
}
interface PackagingOutput {
  metric_key: string;
  phases: RecoveryPhaseOutput[];
  packaging_notes: string;
}

async function runPackagingAgent(
  metricKey: string,
  categories: PlanAgent1Output,
  exercises: PlanAgent2Output,
): Promise<PackagingOutput> {
  const system =
    'You are the packaging agent, the final stage in a training-plan pipeline for Stride. Merge two upstream ' +
    'agents\' output into exactly 4 ORDERED recovery phases: 1 Stability (motor control / lowest load), ' +
    '2 Strength (the real evidence-based loading backbone), 3 "Plyometrics & Movement" (bridges strength to ' +
    'running-relevant speed/impact — hold back anything with a contraindication flag from the earlier phases), ' +
    '4 "Back to Sport" (gradual running reintegration + maintenance strength work). This is a TIME-BASED ' +
    'PROGRESSION every athlete goes through in order, not a difficulty tier picked once by athlete level — do ' +
    'not invent a tier concept. Use contraindication notes from the input to decide which phase an exercise ' +
    'first appears in. This is a synthesis/logic task, no new research.';

  const user = `Metric: \`${metricKey}\`

Movement categories (input A): ${JSON.stringify(categories.movement_categories)}
Sequencing note: ${categories.sequencing_note}

Exercises (input B): ${JSON.stringify(exercises.exercises)}
Protocol source confidence: ${exercises.protocol_source_confidence}

Respond with ONLY a JSON object (in a \`\`\`json fence) — this must be directly usable as
reference_drills.recovery_phases rows:
{
  "metric_key": "${metricKey}",
  "phases": [
    {"phase": 1, "name": "Stability", "duration_weeks_min": 1, "duration_weeks_max": 2, "days_per_week": 4,
     "exercises": [{"name": "...", "sets": 3, "reps": "...", "cue": "...", "rationale": "...", "source_citation": "..."}],
     "advance_criteria": "..."},
    {"phase": 2, "name": "Strength", ...},
    {"phase": 3, "name": "Plyometrics & Movement", ...},
    {"phase": 4, "name": "Back to Sport", ...}
  ],
  "packaging_notes": "2-4 sentences on phase-assignment logic, especially where a contraindication pushed an exercise to a later phase"
}`;

  const text = await runTurn(system, user, { search: false });
  return extractJson<PackagingOutput>(text, `packaging:${metricKey}`);
}

// ─── Per-metric orchestration ────────────────────────────────────────────────
interface MetricRunResult {
  finding: BiomechanicsFinding;
  checkerA: CheckerVerdict;
  checkerB: CheckerVerdict;
  audit: AuditResult;
  categories: PlanAgent1Output;
  exercises: PlanAgent2Output;
  packaging: PackagingOutput;
}

function loadBiomechContext(metricKey: string): { unit: string; plane: string; why: string } {
  const src = readFileSync(BIOMECH_PY_PATH, 'utf-8');
  const grab = (dictName: string): string => {
    const block = src.match(new RegExp(`${dictName}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!block) return '';
    const entry = block[1]!.match(new RegExp(`"${metricKey}":\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    return entry ? entry[1]! : '';
  };
  return { unit: grab('UNIT') || '?', plane: grab('PLANE') || '?', why: grab('WHY') || '(no existing WHY entry)' };
}

async function runMetricPipeline(metricKey: string): Promise<MetricRunResult> {
  const { unit, plane, why } = loadBiomechContext(metricKey);

  // eslint-disable-next-line no-console
  console.log(`[${metricKey}] 1/7 biometrics agent...`);
  const finding = await runBiometricsAgent(metricKey, unit, plane, why);

  // eslint-disable-next-line no-console
  console.log(`[${metricKey}] 2-3/7 checkers A + B (parallel, independent)...`);
  const [checkerA, checkerB] = await Promise.all([runChecker('A', finding), runChecker('B', finding)]);

  // eslint-disable-next-line no-console
  console.log(`[${metricKey}] 4/7 orchestrator audit...`);
  const audit = auditFinding(finding, checkerA, checkerB);
  if (audit.status === 'blocked') {
    // eslint-disable-next-line no-console
    console.warn(`[${metricKey}] BLOCKED — not proceeding to plan agents:\n  - ${audit.issues.join('\n  - ')}`);
    throw new Error(`Pipeline blocked for ${metricKey}: ${audit.issues.join('; ')}`);
  }
  if (audit.status === 'needs_rework') {
    // eslint-disable-next-line no-console
    console.warn(`[${metricKey}] flagged needs_rework (continuing, but flag for human review):\n  - ${audit.issues.join('\n  - ')}`);
  }

  // eslint-disable-next-line no-console
  console.log(`[${metricKey}] 5-6/7 plan agents (parallel, independent)...`);
  const [categories, exercises] = await Promise.all([runPlanAgent1(finding), runPlanAgent2(finding)]);

  // eslint-disable-next-line no-console
  console.log(`[${metricKey}] 7/7 packaging agent...`);
  const packaging = await runPackagingAgent(metricKey, categories, exercises);

  return { finding, checkerA, checkerB, audit, categories, exercises, packaging };
}

// ─── Output: JSON (full transcript) + SQL (ready for human review) ─────────
function sqlQuote(s: string): string {
  return s.replace(/'/g, "''");
}

function writeOutputs(result: MetricRunResult, runId: string): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const { finding } = result;
  const jsonPath = resolve(OUTPUT_DIR, `${finding.metric_key}.json`);
  writeFileSync(jsonPath, JSON.stringify(result, null, 2), 'utf-8');

  const sqlPath = resolve(OUTPUT_DIR, `${finding.metric_key}.sql`);
  const sql = `-- Pipeline output for ${finding.metric_key} — run_id ${runId}.
-- reviewed_by/reviewed_at are NULL on purpose. A HUMAN must review this
-- content (see audit issues below) and set reviewed_by before appending to
-- apps/api/src/db/seeds/metric_biomechanics.sql or syncing anywhere
-- athlete-facing (biomech2d.py WHY dict, coach/knowledge.ts,
-- reference_drills.recovery_phases).
--
-- Orchestrator audit status: ${result.audit.status}
${result.audit.issues.map((i) => `-- ISSUE: ${i}`).join('\n')}
--
-- Checker A: ${result.checkerA.verdict} — ${result.checkerA.reasoning.slice(0, 200)}
-- Checker B: ${result.checkerB.verdict} — ${result.checkerB.reasoning.slice(0, 200)}

INSERT INTO metric_biomechanics (
    metric_key, body_region, primary_structure, mechanism,
    injury_risks, confidence, correlation_or_causal, hedge_note, citations,
    checker_a_verdict, checker_b_verdict, reviewed_by, reviewed_at, pipeline_run_id
) VALUES (
'${sqlQuote(finding.metric_key)}',
'${sqlQuote(finding.body_region)}',
'${sqlQuote(finding.primary_structure)}',
'${sqlQuote(finding.mechanism)}',
'${sqlQuote(JSON.stringify(finding.injury_risks))}',
'${finding.confidence}',
'${finding.correlation_or_causal}',
'${sqlQuote(finding.hedge_note)}',
'${sqlQuote(JSON.stringify(finding.citations))}',
'${result.checkerA.verdict}',
'${result.checkerB.verdict}',
NULL,
NULL,
'${sqlQuote(runId)}'
);

-- Suggested reference_drills.recovery_phases update (apply only after the above is reviewed):
-- UPDATE reference_drills SET recovery_phases = '${sqlQuote(JSON.stringify(result.packaging.phases))}'::jsonb WHERE key = '<drillId for ${finding.metric_key}>';
`;
  writeFileSync(sqlPath, sql, 'utf-8');

  // eslint-disable-next-line no-console
  console.log(`[${finding.metric_key}] wrote ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`[${finding.metric_key}] wrote ${sqlPath} (NOT applied — human review required)`);
}

// ─── CLI entry ────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: tsx generate-metric-biomechanics.ts <metric_key> | --all');
    process.exit(1);
  }

  const allKeys = loadMetricKeys();
  const targets = arg === '--all' ? allKeys : [arg];
  const unknown = targets.filter((k) => !allKeys.includes(k));
  if (unknown.length > 0) {
    console.error(`Unknown metric key(s): ${unknown.join(', ')}. Known: ${allKeys.join(', ')}`);
    process.exit(1);
  }

  const runId = `run-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;
  const results: { metricKey: string; status: AuditResult['status'] }[] = [];

  for (const metricKey of targets) {
    try {
      const result = await runMetricPipeline(metricKey);
      writeOutputs(result, runId);
      results.push({ metricKey, status: result.audit.status });
    } catch (err) {
      console.error(`[${metricKey}] FAILED: ${(err as Error).message}`);
      results.push({ metricKey, status: 'blocked' });
    }
  }

  console.log('\n=== Coverage summary ===');
  for (const key of allKeys) {
    const r = results.find((x) => x.metricKey === key);
    console.log(`  ${key}: ${r ? r.status : 'NOT RUN'}`);
  }
  const missing = allKeys.filter((k) => !results.some((r) => r.metricKey === k));
  if (arg === '--all' && missing.length > 0) {
    console.error(`Coverage assertion FAILED — missing: ${missing.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
