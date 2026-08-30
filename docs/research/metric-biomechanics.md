# Metric → Body-Part / Injury-Risk Mapping — Research Pipeline

> Mapping each of Stride's 11 biomechanics metrics to the body part/mechanism it
> implicates and the injury/inefficiency risk it's associated with, backed by
> real literature — then building a research-grounded, time-based recovery
> program from that mapping.
>
> Follows the fan-out / independent-checker / synthesis pattern established by
> [`angle-agnostic-kinematics.md`](./angle-agnostic-kinematics.md), scaled down
> to the roles the pipeline actually needs: 1 researcher, 2 independent
> checkers, an accountability pass, 2 parallel plan-builders, 1 packaging
> synthesis.

## TL;DR

Only 2 of Stride's 11 metrics (`knee_valgus`, `pelvic_drop`) carried any
muscle-level causal language before this pipeline existed — and one of those
two (`knee_valgus`) turned out to be actively wrong (see below). This is
health-adjacent content, so it's built as an **offline, human-reviewed batch
pipeline** — never a live call in the analysis or coach hot path — that
populates a durable `metric_biomechanics` table, which only syncs into
athlete-facing surfaces (`biomech2d.py`'s `WHY` dict, `coach/knowledge.ts`,
`reference_drills.recovery_phases`) once a human sets `reviewed_by`.

**All 11 metrics have now been run through the full pipeline** (2026-08-30),
via the Agent-tool swarm inside a Claude Code session rather than the billed
standalone script — see "Full batch run" below. Every row's `reviewed_by` is
still `NULL`; nothing here has synced into any athlete-facing surface yet.

## Architecture

Seven roles, run per metric key. The reusable, billable version of this
pipeline (`apps/api/scripts/research/generate-metric-biomechanics.ts`) pulls
metric keys live from `biomech2d.py`'s `NORMAL_RANGE` so no metric can be
silently skipped:

1. **Biometrics agent** — real web search, one call per metric (not one call
   covering all 11), producing body region / primary structure / mechanism /
   injury risks / confidence / citations / a raw `search_log` the orchestrator
   can audit for evidence of genuine research.
2. **Checker A** / **Checker B** — independent re-derivation from their own
   searches, no visibility into each other. Verdict: `confirmed` / `partial` /
   `contradicted` / `no_lit_found`.
3. **Orchestrator audit** — citation presence, non-empty `search_log`, field
   completeness, checker-divergence flagging. A `contradicted` verdict or
   empty required field blocks the run from proceeding to the plan agents.
4. **Plan agent 1** (high-level) / **Plan agent 2** (PT-literature deep dive)
   — run in parallel from the same checker-verified mapping, neither sees the
   other's output. Agent 1 proposes movement categories + root-cause
   rationale; agent 2 searches PT/rehab literature for cited, dosed exercises.
5. **Packaging agent** — merges both into exactly **4 ordered recovery
   phases** (Stability → Strength → Plyometrics & Movement → Back to Sport),
   output shaped directly as `reference_drills.recovery_phases` rows.

### Why 4 time-based phases, not 3 difficulty tiers

The pilot run originally shipped a 3-tier design (beginner/intermediate/
advanced difficulty, athlete picks a tier). That was replaced at the user's
direction with a **single ordered recovery arc every athlete goes through**:
each phase has a fixed exercise group, done for that phase's duration, then
the whole group swaps at the phase boundary — closer to how an actual PT
rehab progression works, and avoids "variation" needing its own runtime
subsystem (see `calendar/trainingPlan.ts::generateRecoveryProgram`).

## Data model

`metric_biomechanics` (schema.sql) is the durable source — one row per
metric, both checkers' verdicts, and a `reviewed_by`/`reviewed_at` gate that
must be set by a human before anything syncs downstream. `reference_drills`
carries a `recovery_phases JSONB` column for the packaging agent's output.
Neither table is read at runtime by the analysis pipeline or the coach
agent — this is research output, synced by hand into the existing constant
dicts (`biomech2d.py`'s `WHY`, `knowledge.ts`'s `KNOWLEDGE` array) the same
way a person would edit them directly. `calendar/trainingPlan.ts` has two
program generators now: `generateDrillProgram()` (the original flat,
progressively-loaded block, used when a metric has no reviewed phases yet)
and `generateRecoveryProgram()` (the 4-phase arc, used once
`recovery_phases` is non-empty) — `approveSuggestion()` in `queries.ts`
picks between them automatically.

## Pilot run: `pelvic_drop` (2026-08-25)

Run first, alone, as the dry-run this design calls for — validate the full
pipeline shape on one metric before scaling. Headline result: the pipeline
**did not just confirm the obvious story**. The commonly-assumed
pelvic-drop → IT band syndrome link turned out to be the **weakest**-supported
association in the literature; the strongest was medial tibial stress
syndrome. Checker A caught a mischaracterized claim about hip adduction's role
in ITBS; Checker B found a significant paper (Bramah et al. 2018) the
biometrics agent's search missed entirely.

## Full batch run: remaining 10 metrics (2026-08-30)

Run via the Agent tool inside this Claude Code session (not the billed
standalone script — no separate API spend), same 7-role structure per metric,
all 10 remaining metrics fanned out and cascaded in parallel. A representative
sample of what the checker pass actually caught:

- **`knee_valgus`** — corrects a claim that was *already shipping* in the app
  ("strengthens glute-med to stop the knee collapsing inward," stated as
  settled fact). Direct intervention trials (Snyder et al. 2011; Noehren's own
  follow-up study) found hip-abductor strengthening improves strength and pain
  but produces **no change in running-gait knee valgus angle**. What actually
  works, per the literature that tested it directly, is real-time gait
  retraining with visual/verbal/tactile feedback *during running* — the
  packaging agent restructured the whole 4-phase program around that finding,
  with strengthening demoted to a supporting role.
- **`knee_drive`** — the classic "more knee drive is always better" coaching
  cue is now empirically contested: a 2022 predictive-simulation paper found
  the best-performing simulated sprint techniques actually had *lower* hip
  extension at takeoff, corroborated by an independent 2018 empirical study.
  Confidence downgraded accordingly; the plan avoids drills that chase thigh
  angle directly.
- **`cadence_spm`** — both checkers independently recommended downgrading
  confidence from "emerging" to "preliminary": the one direct sprint-specific
  study found a null result, and the rest of the injury evidence is
  extrapolated from distance runners at roughly half the sprint cadence band.
- **`contact_time_ms`** — checkers found Stride's own 80-140ms band is
  correct for max-velocity sprinting but *wrong* for acceleration-phase
  strides, where elite contact times legitimately run 150-165ms. The 4-phase
  plan now cues different targets by sprint phase instead of "shorter is
  always better."
- Several citation-name errors were caught and corrected in-flight (e.g. a
  vertical-oscillation meta-analysis mis-attributed to "Bramah et al." was
  actually Van Hooren et al. 2024; a contact-time bone-stress paper citation
  was swapped to the correct PMC ID).

## Coverage assertion

All 11 metrics now have a `metric_biomechanics` row and a
`reference_drills.recovery_phases` entry with all 4 phases populated —
verified by parsing every JSON payload back out of both seed files and
confirming byte-exact, valid content before this was committed.

## Still open

- **Human sign-off is the only remaining gate.** Every row's `reviewed_by` is
  `NULL`. Nothing here has synced into `biomech2d.py`'s `WHY` dict or
  `coach/knowledge.ts` — those syncs are still manual, deliberate edits gated
  on a person reviewing this content first.
- The reusable standalone script
  (`apps/api/scripts/research/generate-metric-biomechanics.ts`) exists and
  works (typechecked, ready to run) for future re-runs once new literature
  exists — this batch used the Agent-tool swarm instead specifically to avoid
  a separate API bill; the script remains the right tool for a scheduled
  refresh later.
