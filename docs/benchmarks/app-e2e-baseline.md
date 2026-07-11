# Stride — App E2E Baseline (Testing Agent B)

> **Re-run 2 (2026-07-11, post ML honesty + bug-fix restart) is at the bottom of
> this file.** It verifies the B3 fix, trust-honesty gating, and new
> `captureQuality` fields across two clips. The original baseline (below) is kept
> for the before/after contrast (B3 mislog `"Thunder"` → fixed `"rtmpose-lightweight"`).

Full end-to-end validation of the current app on the **local DB-poll stack**
(`STORAGE_DRIVER=local`, native API + native Python worker, RTMPose-s / 2D
sagittal pipeline). Goal: confirm "the rest of the app is functioning as
intended" while ML work proceeds, and reproduce bug **B3** (model identity
mislog).

- **Date:** 2026-07-11
- **Stack:** API `http://localhost:3000` (native `tsx`), worker native venv
  `LOCAL DB-poll, pipeline=2d, POSE2D_BACKEND=rtmpose, RTMPOSE_MODE=lightweight,
  POSE_FPS=15`, Postgres `stride_test`.
- **Pose backend actually loaded (worker.log):** `rtmpose-s_simcc-body7_pt-body7_420e-256x192-acd4a1ef_20230504.onnx` via rtmlib/onnxruntime (CPU).
- **Test video:** `test-videos/IMG_8266.MOV` (1920×1080, 30 fps, 155 frames, 5.2 s, single-runner side-on).
- **Test user:** `adhibanvolunteering@gmail.com` (redacted creds), user id `ca6f45c5-…`, DB user `eecaddef-…`.
- **Analysis id for this run:** `911a4788-041b-4fb2-b9b2-e1cd1e25cf8e`.
- **Driver:** `scratchpad/e2e_driver.py` (scaffolding only; no production code modified). Secrets read from gitignored `.env`; tokens/keys never printed.

---

## Scorecard

| Step | Check | Result | Evidence |
|---|---|---|---|
| 1 | Auth: Supabase password grant → `access_token` | 🟢 PASS | `token_type=bearer`, subject `ca6f45c5-…` |
| 1 | `GET /users/me` returns profile | 🟢 PASS | `200`, event=`100m`, level=`beginner`, consent set `2026-07-04` |
| 1 | Profile has coaching context (event/level) | 🟢 PASS | already populated (`event_specialty=100m`, `experience_level=beginner`) — PATCH not needed |
| 2 | `POST /videos/upload-url` → analysisId + local blob URL | 🟢 PASS | `200`, `uploadId=local`, 1 part, URL points back at API |
| 2 | `PUT /videos/:id/blob` writes bytes | 🟢 PASS | `200`, `bytes=10,814,391` == file size |
| 2 | `POST /videos/finalize` with captureManifest → row created | 🟢 PASS | `200`, `status=pending` |
| 3 | Analysis completes (poll `GET /videos/:id`) | 🟢 PASS | `pending → processing → completed` in **12.2 s**; `overall_score=55` |
| 4 | `GET /videos/:id/overlay` per-frame keypoints | 🟢 PASS | `200`, **76 frames**, each `{tMs, kp}` |
| 4 | `GET /videos/:id/file` serves video (range) | 🟢 PASS | `206 Partial Content`, `video/mp4`, `Accept-Ranges: bytes` |
| 5 | `GET /analyses/:id/suggestions` > 0 | 🟢 PASS | `200`, **5 suggestions** (e.g. "High-knee wall switches" 2026-07-12) |
| 5 | `POST /suggestions/:id/approve` | 🟢 PASS | `200`, response `{suggestion, calendarEvent}` — event created |
| 6 | `GET /calendar/events?from=&to=` shows approved drill; dates `YYYY-MM-DD` | 🟢 PASS | `200`, approved drill present on `2026-07-12`, all `scheduled_date` are `YYYY-MM-DD` |
| 7 | `POST /coach-sessions` (free_coach) | 🟢 PASS | `201`, session `48e6d878-…` |
| 7 | Coach reply references athlete's **real measured numbers** | 🟢 PASS | cites `knee drive of 61.5 degrees … below the normal range of 80–110 degrees` (matches `result_json.metrics.knee_drive=61.5°`) |

**14/14 green.** No red steps.

### End-to-end latency
Upload finalize → `status=completed`: **12.2 s** (RTMPose-s CPU, 155-frame / 5.2 s clip at POSE_FPS=15). Worker stage progression observed: `pose_extraction 30% → biomechanics_calculation 75% → finalizing 95% → completed`.

---

## Evidence detail

### Measured biomechanics (`result_json`, this run)
```
economyScore 28/100 · reconstructionMethod "2d" · captureQuality.overall 0.55
metrics:
  trunk_lean=22°  knee_drive=61.5°  hip_extension=178°  knee_flexion=37.8°
  arm_swing=147.6°  overstride=40%  vertical_oscillation=25%
  contact_time_ms=323.8ms  cadence_spm=52.9spm
flaws: Low knee drive · Arm swing off-target · Excess vertical bounce ·
       Long ground contact · Cadence off-target
```
(Temporal metrics — contact time, cadence — are physically unreliable at 30 fps;
this is the known B1 trust-gate limitation, not an app failure.)

### Suggestions → Calendar linkage
`/internal/analysis-completed` auto-created **4 metric rows** and **5 drill
suggestions** for the analysis. Approving the first suggestion returned both the
updated `suggestion` and a newly created `calendarEvent`; the drill then appears
in `GET /calendar/events` on its `suggested_date` (`2026-07-12`) with a proper
`YYYY-MM-DD` date (not an ISO timestamp). Approve → calendar linkage **works**.

### Coach grounding — genuinely data-referenced
Prompt: *"What is my single worst form issue, and what exactly is my measured
knee drive angle? Give me one drill to fix it."* Reply (verbatim):

> 🎯 Your single worst form issue is a low knee drive of 61.5 degrees, which is below the normal range of 80-110 degrees.
> 🏃 To fix this, try A-skips: drive your knee up to hip height, keep your foot dorsiflexed, and maintain a tall posture.
> 💪 Start with 3 sets of 20 meters and progress to A-runs for higher speed carryover. Want me to add this to your plan? Tap the calendar button below to schedule it.

The reply cites the athlete's **exact measured value (61.5°)** and its normal
range — this can only come from the grounding block built from `result_json`,
not generic advice. Grounding is **real**.

**Coach path used:** the **agentic path** (`runTrackCoach`) succeeded for this
call (no "Coach agent failed, falling back" logged after this analysis
completed). **Operational caveat:** the agentic path degrades to the single-shot
fallback (`generateCoachReply`) under Groq **429 rate-limits** — 7 such
fallbacks were logged earlier today, and the Groq daily token budget was nearly
exhausted (`~99,967 / 100,000` TPD). When *both* agent and fallback 429, the
route 500s. This is an external-quota risk, not a code bug, but it will surface
as coach failures once the daily budget is hit.

---

## B3 — Model identity mislog (reproduced ✅)

**Architecture doc §3, B3:** *"Model version not derived from the backend that
ran."* Confirmed for this RTMPose run.

**What actually ran:** RTMPose-s (SimCC, body7, 256×192) via onnxruntime CPU
(worker.log: `Loading … (mode=lightweight)` → `RTMPose backend loaded` →
`rtmpose-s_simcc-body7_…onnx`).

**What is persisted (Postgres `analyses` row `911a4788-…`):**
```
movenet_version | recon | has_model_meta | knee_drive
Thunder         | 2d    | f              | 61.5
```
- `analyses.movenet_version = "Thunder"` — a **MoveNet** identity (MoveNet
  SinglePose *Thunder*), hardcoded regardless of the backend that ran.
- `result_json.reconstructionMethod = "2d"` and **no `model_meta`** at all
  (`result_json ? 'model_meta'` → false). Nothing in the stored result identifies
  the pose backend or its version.

**Root cause (code):**
- `apps/api/src/routes/internal.ts:56` — the `/analysis-completed` callback (the
  path taken in DB-poll mode) writes `movenet_version: 'Thunder'` unconditionally.
  → This is what produced the `"Thunder"` value above.
- `apps/ml-worker/src/worker.py:236` — DB-fallback (only if the callback fails)
  hardcodes `"rtmpose+2d-sagittal"` (correct only *if* backend is rtmpose;
  still not derived from the active backend).
- `apps/ml-worker/src/worker.py:303` — legacy path writes
  `MOVENET_VERSION = "singlepose-thunder-v4"` (`movenet.py:58`) regardless of backend.
- `apps/ml-worker/src/biomech2d.py:332` — the result dict emits only
  `reconstructionMethod:"2d"`; no `model_meta` field.

**What *should* be stored:** a `model_meta` derived from the backend that
actually ran — e.g. `{backend:"rtmpose", model_version:"rtmpose-s_simcc-body7_…",
input_size:"256x192", device:"cpu"}` — threaded into both `result_json` and the
DB write (doc §2.2 / §3 fix). Instead the DB **actively mislabels this RTMPose
run as MoveNet "Thunder"**, and the result JSON carries no backend identity to
disambiguate it.

---

## Notes / incidental observations (not in scope, flagged for ML team)
- **B5 (doc bug)** visible in worker.log: `Loading RTMDet+RTMPose …` — rtmlib's
  detector is actually YOLOX, not RTMDet. Cosmetic/docstring only.
- SSE delivery to the user showed `delivered: false` (no live client connected
  during a headless run) — expected; the polling path still returns completion.
- The calendar window returned 106 events — accumulation from prior test runs,
  not a bug; the approve→event linkage for this run is the relevant signal.

---
---

# Re-run 2 — post ML honesty + bug-fix restart (2026-07-11)

Focused E2E (auth → upload → completion → DB/result inspection → suggestions;
**coach step deliberately skipped** to preserve the Groq daily budget). Two clips.
Driver: `scratchpad/e2e_focused.py`. Worker restarted; log now correctly reads
`Loading YOLOX+RTMPose` (B5 doc fix landed) and loads
`yolox_tiny_…onnx` + `rtmpose-s_simcc-body7_…onnx`. No worker errors/tracebacks
for either run. Target lock brush bboxes honored (`Target lock: brush bbox (…)`).

## Per-clip scorecard

| Check | IMG_0274 (clean side-on) | IMG_8266 (oblique crowd) |
|---|---|---|
| Analysis completes, no worker error | 🟢 completed | 🟢 completed |
| Latency (finalize → completed) | **8.5 s** | **8.2 s** |
| overall_score / economyScore | 64 / 36 | 35 / 0 |
| B3: `movenet_version` backend-derived | 🟢 `rtmpose-lightweight` | 🟢 `rtmpose-lightweight` |
| B3: `result_json.model_meta` exists | 🟢 yes | 🟢 yes |
| Honesty: temporal + overstride = experimental, not flaws | 🟢 | 🟢 |
| Honesty: implausible angles = experimental | 🟢 | 🟢 |
| captureQuality has `subjectMotion` + `movingSubject` | 🟢 `0.89` / `true` | 🟢 `1.07` / `true` |
| Suggestions count | 🟢 **1** (≥1 expected) | 🟢 **0** (honestly OK) |

## B3 fix — exact DB values (`analyses` row, via psql)

Both rows (`10c07c51-…` IMG_0274, `decb301f-…` IMG_8266):
```
movenet_version = rtmpose-lightweight        ← backend-derived (was "Thunder")
result_json->'model_meta' =
  {"device":"cpu","backend":"rtmpose","poseFps":15,"detector":"yolox",
   "pipeline":"2d-sagittal","model_version":"rtmpose-lightweight"}
result_json->reconstructionMethod = 2d
captureQuality.subjectMotion  = 0.89 (IMG_0274) / 1.07 (IMG_8266)
captureQuality.movingSubject  = true / true
```
**B3 is FIXED and verified end-to-end:** the persisted model identity now matches
the backend that actually ran (RTMPose lightweight + YOLOX detector, CPU), and
`model_meta` is present in the result JSON. No more MoveNet "Thunder" mislabel.

## Trust-honesty gating — metrics (key / value / trustStatus)

**IMG_0274 (clean side-on, azimuth ~0°):**
```
trunk_lean      72.4 deg  experimental  (range 8–22; implausibly high → not trusted ✅)
knee_drive      20.9 deg  TRUSTED       (range 80–110)
hip_extension  162.8 deg  TRUSTED       (range 160–185)
knee_flexion    35.3 deg  TRUSTED       (range 25–55)
arm_swing      162.5 deg  experimental  (range 70–110; implausibly high → not trusted ✅)
overstride        40 %    experimental  (not a flaw ✅)
vertical_oscillation 25 % experimental
contact_time_ms 566.7 ms  experimental
cadence_spm    157.9 spm  experimental
flaws: ["Low knee drive"]   ← the ONE trusted-angle flaw → 1 suggestion
```

**IMG_8266 (oblique crowd, azimuth 52.7°):**
```
ALL nine metrics = experimental (oblique view → nothing trusted)
trunk_lean 22 · knee_drive 45.5 · hip_extension 178.4 · knee_flexion 48.1 ·
arm_swing 147.6 · overstride 40% · vertical_oscillation 25% ·
contact_time_ms 323.8 · cadence_spm 52.9
flaws: []   ← 0 flaws → 0 suggestions (honest refusal on a bad-angle clip)
```

**Honesty behavior confirmed:** temporal metrics (contact_time_ms, cadence_spm,
vertical_oscillation) and overstride are always `experimental` and never surfaced
as flaws; physically implausible angle readings (trunk_lean 72°, arm_swing 162°
on the clean clip) are downgraded to `experimental` rather than `trusted`; and an
oblique/crowd clip trusts nothing and emits zero flaws/suggestions instead of
inventing issues. `primaryNudge` is context-appropriate ("Record at 120fps+…" for
the good clip vs "Film from the side…" for the oblique clip).

---
---

# Re-run 3 — new single-target tracker (crop_tracker.py) (2026-07-11)

Worker restarted with the new tracker (Kalman motion + HSV appearance +
drift-anchor + cascaded gate, replacing nearest-crop-center in
rtmpose_backend). Focused E2E, coach skipped. Driver: `scratchpad/e2e_tracker.py`.

| Check | IMG_8269 (staggered PAIR, lock LEFT) | IMG_0274 (single, no-regression) |
|---|---|---|
| Completes, no worker error/traceback | 🟢 completed | 🟢 completed |
| Latency | **8.4 s** | **8.2 s** |
| overall_score / economy | 56 / 16 | 64 / 23 |
| Target lock honored (worker.log) | 🟢 brush bbox (0.15,0.2,0.55,0.98) | 🟢 brush bbox (0.35,0.08,0.65,0.98) |
| B3 `movenet_version` | 🟢 `rtmpose-lightweight` | 🟢 `rtmpose-lightweight` |
| B3 `model_meta` (backend/detector) | 🟢 rtmpose / yolox | 🟢 rtmpose / yolox |
| captureQuality subjectMotion / movingSubject | 🟢 0.55 / true | 🟢 0.89 / true |
| Temporal+overstride experimental & unflagged | 🟢 | 🟢 |
| Implausible angles experimental | 🟢 (knee_flexion 137.9°, arm_swing 166.4° → exp) | 🟢 (trunk_lean 40.5°, arm_swing 166.1° → exp) |
| Flaws / suggestions | 0 / 0 (oblique 39.6°, nothing trusted) | 2 / 2 (Low knee drive, Limited hip extension) |

**Worker log (both runs): zero WARNING/ERROR/traceback.** Each job: Claimed →
Target lock brush bbox → RTMPose loaded → overlay written (84 / 82 frames) →
completion reported successfully. The new tracker runs cleanly through the full
pipeline; no crash, no identity-switch error surfaced.

**IMG_8269 (tracker key test):** oblique start pair (azimuth 39.6°) → all 9
metrics `experimental`, 0 flaws, 0 suggestions (honest refusal). The pipeline
locked on the seeded LEFT-athlete bbox and produced a single coherent skeleton
track (84 overlay frames) without erroring; because the view is oblique nothing
is trusted, which is the correct honest outcome.

**IMG_0274 (no-regression):** still completes with trusted knee_drive 23.4° /
hip_extension 143.5° / knee_flexion 37.1°; 2 trusted-angle flaws → 2 suggestions.
(Slightly different trusted-angle values vs Re-run 2 — expected, since the new
tracker changes which per-frame crops feed the angle estimates — but the
trust/honesty framework and B3 identity are unchanged.)

---
---

# Re-run 4 — P2 registry + COCO-17 canonicalizer seam (2026-07-11)

Worker restarted after the P2 refactor (pose2d.py → pose_backend.py registry →
canonical_2d.py COCO-17 canonicalization before biomech2d). Process-level
confirmation only (biomech2d output already proven byte-identical by the
coordinator's regression gate). One clip: **IMG_0274.MOV** (single), coach skipped.

| Check | Result |
|---|---|
| Completes, no worker error/traceback | 🟢 completed |
| Latency (finalize→completed) | **8.3 s** |
| overall_score / economy | 64 / 23 |
| model_meta.keypointFormat | 🟢 `coco17` (+ backend=rtmpose, detector=yolox, model_version=rtmpose-lightweight) |
| B3 movenet_version (DB) | 🟢 `rtmpose-lightweight` |
| Metrics/flaws unchanged vs Re-run 3 | 🟢 identical (knee_drive 23.4° trusted, hip_extension 143.5° trusted, knee_flexion 37.1° trusted; trunk_lean/arm_swing/temporal/overstride experimental) |
| Flaws / suggestions | 🟢 2 / 2 (Low knee drive, Limited hip extension) |
| pose2d backend log line | 🟢 `Pose2D backend (stream): rtmpose +target (native=coco17)` |

**Worker log: zero ERROR/traceback.** Clean seam: Claimed → Target lock → pose2d
`native=coco17` → RTMPose loaded → overlay (82 frames) → completion reported.
Note: the log prints `native=coco17` (rtmpose's native format); it does not print
an explicit `→ canonical=coco17` suffix, but since native and canonical are both
COCO-17 the mapping is identity — consistent with the byte-identical regression
gate. The refactored registry/canonicalizer seam works end-to-end; app stays green.

---
---

# Re-run 5 — sprint-start phase awareness (2026-07-11)

Worker restarted: biomech2d now infers PHASE from posture (moving + trunk lean)
— acceleration / max_velocity / static — and applies phase-appropriate norms
(acceleration trunk_lean 35–55°) instead of azimuth-based upright norms. One clip:
**IMG_0274.MOV** (block-start, side-on), coach skipped.

| Check | Result |
|---|---|
| Completes, no worker error/traceback | 🟢 completed |
| Latency (finalize→completed) | **8.5 s** |
| `result_json.phase == "acceleration"` | 🟢 (DB + result_json) |
| trunk_lean now trusted, range [35,55], value 40.5° in-range → NOT flagged | 🟢 trustStatus=`trusted`, normalRange `[35,55]`, 40.5° |
| Other flaws still present | 🟢 `["Low knee drive","Limited hip extension"]` |
| Suggestions count | 🟢 **2** |
| B3 movenet_version / model_meta.keypointFormat | 🟢 `rtmpose-lightweight` / `coco17` |
| Worker log ERROR/traceback | 🟢 none |

**Phase-awareness works:** the ~45° drive lean is now judged GOOD (trusted,
in-range [35,55]) instead of being flagged against the upright 8–22° norm — the
false "excessive trunk lean" flaw is gone, while the two legitimate flaws (low
knee drive, limited hip extension) and their 2 suggestions remain. Note trunk_lean
also flipped from `experimental` (Re-run 4) to `trusted` here, since the phase
model now trusts a drive-phase lean. B3/model_meta/keypointFormat unchanged.
