# Multi-agent research pipeline: metric → body-part/injury-risk → training plan

## Context

Stride's 11 biomechanics metrics (`apps/ml-worker/src/biomech2d.py`) currently carry almost no real injury/body-part causal language — only 2 of 11 (`knee_valgus`, `pelvic_drop`) have any muscle-level explanation, and neither the coach's knowledge base (`knowledge.ts`, 25 entries) nor the drill library ties a metric to a validated mechanism. The user wants this fixed the right way: a research-backed pipeline (biometrics research → independent fact-checking → tiered training-plan generation), run by a small swarm of Opus agents with a built-in accountability layer, rather than hand-writing plausible-sounding copy.

Three Explore passes plus a Plan-agent design pass (grounded in direct file reads, not guesses) surfaced two things that reshape the work:

1. **This is health-adjacent content.** It needs literature grounding, honest confidence/hedge labeling (matching the app's existing "never state more confidently than measured" discipline), and human sign-off before it reaches an athlete — not a live, unreviewed LLM call in the hot path.
2. **A live, blocking bug already exists downstream.** `reference_drills` seed data (`a_skips`, `wall_drills`, …) uses a completely different key vocabulary than the 11 real `drillId`s the engine emits (`drill-wall-drive`, `drill-hip-hitch`, …). Every drill lookup in `approveSuggestion()` (`apps/api/src/db/queries.ts:511-517`) is silently `undefined` today — cues/rationale in every approved calendar event are empty right now, in production. This pipeline's output is unreachable until that's fixed, so the fix is a hard prerequisite, not a nice-to-have.

Intended outcome: a one-time, human-reviewed offline pipeline that populates a durable, versioned dataset mapping all 11 metrics to body region / mechanism / injury risk / citations / confidence, plus a tiered (beginner/intermediate/advanced) exercise library — both landing in the app's *existing* runtime paths (`biomech2d.py`'s `WHY`/`DRILLS`, `knowledge.ts`, `reference_drills` + `generateDrillProgram()`), not a new parallel system.

## Recommended approach

**Architecture: offline batch pipeline, not a live per-analysis agent call.** The target content (what pelvic drop implicates anatomically) is a property of the metric, not the athlete or the video — research it once, review it once, ship it as static, versioned data. This matches how `knowledge.ts` and `biomech2d.py`'s dicts already work (both are explicitly dependency-free, no runtime network/LLM calls), avoids bolting tens of seconds of Opus + web-search latency onto the upload or coach-chat hot path, and — critically for health-adjacent content — produces a diffable artifact a human can actually review in a PR before it reaches an athlete, the same way `docs/research/angle-agnostic-kinematics.md` was reviewed.

### Step 0 — fix the drill-key namespace bug first (prerequisite, small and isolated)

Rewrite `apps/api/src/db/seeds/reference_drills.sql` to use the 11 real `drillId` keys already defined in `biomech2d.py`'s `DRILLS` dict (`drill-wall-drive`, `drill-high-knee-switch`, `drill-dribble-bound`, `drill-heel-recovery`, `drill-arm-iso`, `drill-quick-feet`, `drill-wickets`, `drill-banded-starts`, `drill-metronome`, `drill-lateral-band`, `drill-hip-hitch`), retiring the orphaned rows. Nothing outside the seed file and its own test fixtures references the old keys, so this is a safe direct replacement. Add a regression test in `apps/api/src/routes/__tests__/suggestions.test.ts` asserting `approveSuggestion()` now actually finds a `reference_drills` row for a real `drillId` and that `calendar_events.details.why`/`.cues` come through non-empty — proving the bug is closed, not just theoretically fixed.

### Step 1 — the agent pipeline (`scripts/research/generate-metric-biomechanics.ts`, one-off Node/TS script using the Anthropic SDK with web search tool-use, Opus model)

Roles, run per metric key (pulled live from `biomech2d.py`'s `NORMAL_RANGE.keys()` so no metric is silently skipped):

1. **Biometrics agent** — one parallel call per metric (11 total, not one call covering all 11 — this is what makes per-metric coverage auditable). Given the metric's existing name/unit/plane/current `WHY` text, researches (via real web search, not model memory) body region, primary muscle/structure, causal mechanism, injury/inefficiency risks, with citations.
2. **Checker A / Checker B** — run independently per metric, no visibility into each other's output. Each re-derives the mechanism from its own literature search and returns a verdict: `confirmed` / `partial` / `contradicted` / `no_lit_found`, plus its own citations.
3. **Orchestrator** — the accountability layer, run last over all metrics' transcripts. Concretely checks: every claim carries a real, checkable citation (not "studies show"); the biometrics agent's tool-call transcript shows it actually searched rather than hallucinated; all 11 metrics have non-empty output (catches the "only the easy ones get done" failure mode); checker disagreements are flagged for human review, never auto-resolved; every claim carries a confidence tier and a correlation-vs-causation hedge.
4. **Plan agent 1 (high-level)** and **Plan agent 2 (PT-literature deep dive)** — run in parallel per metric, after the mapping is checker-confirmed. Agent 1 proposes movement categories + root-cause rationale; Agent 2 searches PT/rehab literature for specific exercises with cited sets/reps/progression.
5. **Packaging agent** — merges both plan agents' output into 3 tiers keyed to the app's *existing* athlete-context axes (`experienceLevel`, `isInjured`/`drillIntensityCap`, `flawSeverity` — already computed in `apps/api/src/calendar/trainingPlan.ts:39-44`), output shaped directly as the target `reference_drills.tiers` rows — no lossy hand-translation step.

### Step 2 — data model

New table in `apps/api/src/db/schema.sql`, `metric_biomechanics` (one row per metric key): `body_region`, `primary_structure`, `mechanism`, `injury_risks` (JSONB array), `confidence` (`established`/`emerging`/`preliminary`), `correlation_or_causal`, `hedge_note`, `citations` (JSONB), both checkers' verdicts, `reviewed_by`/`reviewed_at` (non-null required before sync), `pipeline_run_id`. This is the durable, auditable source — not read at runtime.

Add `tiers JSONB DEFAULT '[]'` to `reference_drills` (`[{tier, sets, reps, cue, rationale, source_citation}]`), populated by the packaging agent's output.

### Step 3 — sync into existing runtime paths (no new parallel system)

A small sync step, gated on `reviewed_by IS NOT NULL`, copies reviewed content into:
- `biomech2d.py`'s `WHY` dict (the 9 metrics currently missing body-part language) — surfaces immediately in flaw cards.
- `knowledge.ts`'s `KNOWLEDGE` array (new `topic: 'injury'` entries — closes the confirmed gap where nothing mentions hip drop/pelvis/Trendelenburg) — lets the coach's `search_track_knowledge` tool retrieve and cite it.
- `reference_drills.tiers` — feeds the tier-selection logic added in `approveSuggestion()` (`queries.ts`, right where `refDrill` is already fetched), which overrides `sets`/`reps`/`cue` before calling the existing, untouched `generateDrillProgram()`. The LLM pipeline's output never writes to `calendar_events` directly — it only ever proposes data that the existing deterministic scheduler consumes, preserving the app's current propose/gate-write separation.

## Critical files

- `apps/ml-worker/src/biomech2d.py` — `WHY`/`DRILLS`/`NAMES` dicts (source of truth for metric definitions; do not touch the TS-side `stage5_metrics.ts`/`stage6_confidence.ts` or `metricExplanations.ts`, which are drifted/dormant duplicates)
- `apps/api/src/db/schema.sql` — new `metric_biomechanics` table, `reference_drills.tiers` column
- `apps/api/src/db/seeds/reference_drills.sql` — key-namespace fix (Step 0)
- `apps/api/src/db/queries.ts` — `approveSuggestion()`, tier-selection insertion point (~line 511-531)
- `apps/api/src/calendar/trainingPlan.ts` — `generateDrillProgram()` (reused untouched) and its existing experience/injury-cap logic (reused for tier selection, not reinvented)
- `apps/api/src/lib/coach/knowledge.ts` — new `KNOWLEDGE` entries
- `apps/api/src/routes/__tests__/suggestions.test.ts` — regression test for Step 0
- `docs/research/angle-agnostic-kinematics.md` — style/shape reference for the new `docs/research/metric-biomechanics.md` writeup
- New: `scripts/research/generate-metric-biomechanics.ts` (the pipeline itself)

## Verification

1. Coverage assertion in the pipeline script: fail the run if any of the 11 metric keys ends up with empty `body_region`/`mechanism`/`injury_risks`/`citations`.
2. Human spot-check: for the pilot metric (`pelvic_drop`, already drafted end-to-end as a worked example — glute medius/Trendelenburg mechanism → IT band/PFPS/gluteal tendinopathy risk → 3-tier corrective program), open at least one cited source per metric and confirm it says what's claimed.
3. Checker convergence report reviewed before merge — any `partial`/`contradicted`/`no_lit_found` verdict gets manual review, never auto-shipped.
4. Run the pipeline on `pelvic_drop` alone first as a dry run to validate the full shape (all 7 agent roles, correct JSON matching `reference_drills.tiers`) before spending budget on the remaining 10 metrics.
5. After Step 0 + Step 3 land: run `apps/api/src/routes/__tests__/suggestions.test.ts` (new regression case) and `apps/api/scripts/validate-biomech.ts`; manually walk the full user path for 2-3 metrics (trigger flaw → read updated `plainExplanation` → approve suggestion → confirm tier-appropriate calendar entries for a beginner vs. advanced test athlete); ask the coach agent a question that should retrieve a new `knowledge.ts` entry (e.g. "why do my hips drop when I run") and confirm it cites a real source.