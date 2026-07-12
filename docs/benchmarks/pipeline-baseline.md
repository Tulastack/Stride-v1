# Stride 2D Pipeline — Quantitative Baseline (AS-IS, pre-architecture-change)

> Measured by Testing Agent A on **2026-07-11** against the **real test videos**, running the
> production 2D ML path **in-process** (no API, no queue). This is the frozen baseline the
> post-implementation runs (Phases 0–7 of `docs/research/ml-architecture-orchestration.md`)
> must be compared against, apples-to-apples. No production code under `apps/ml-worker/src/`
> was modified. **Caveat:** there is no motion-capture ground truth, so "accuracy" here means
> *physiological plausibility and internal consistency*, not clinical validation.

## 0. Method & environment

- **Runtime env (exactly the production path):** `STORAGE_DRIVER=local STRIDE_PIPELINE=2d
  POSE2D_BACKEND=rtmpose RTMPOSE_MODE=lightweight POSE_FPS=15`, CPU/onnxruntime, torch absent.
- **Call path replicated from `worker._run_2d` (`worker.py:171-226`):**
  `stream_frames(video, target_fps=15, target)` (`pose2d.py:30` → `rtmpose_backend.iter_frames`)
  → `analyze_2d_sagittal_stream(..., fps=eff_fps=min(15,cap_fps), azimuth_deg=20, overlay_out=[],
  source_fps, capture_fps)` (`biomech2d.py:340`). `capture_fps=30` (no capture sidecar present).
- **Backend actually loaded (lightweight):** YOLOX-tiny detector + RTMPose-s SimCC, from
  `~/.cache/rtmlib/hub/checkpoints/yolox_tiny_8xb8-300e_humanart-6f3252f9.onnx` and
  `rtmpose-s_simcc-body7_...onnx`.
- **Two target modes per clip:** `none` = whole-frame auto lock-and-follow; `bbox` = synthetic
  centred brush seed `(x0,y0,x1,y1)=(0.40,0.08,0.60,0.95)`.
- Each clip ran in its **own subprocess** for clean per-clip peak RSS and latency. Model-load
  time is measured and reported separately from analysis latency.

---

## 1. Per-video metadata + scene classification + camera angle

Metadata via `cv2.VideoCapture` (ffprobe unavailable). Scene class = distinct **confident**
people (mean core-joint score ≥ `CONFIDENCE_THRESHOLD`=0.3) over 10 evenly-sampled frames, using
the pipeline's own YOLOX+RTMPose detector. Azimuth = median of `estimate_azimuth_from_keypoints`
(`biomech2d.py:130`) on the highest-confidence person (0°=side-on, 90°=head-on).

| Clip | Resolution | fps | frames | dur | size | conf-people/frame (10 samples) | max | **scene class** | azimuth | angle |
|---|---|---|---|---|---|---|---|---|---|---|
| IMG_0271.MOV | 1280×720 (land) | 29.98 | 674 | 22.5 s | 30.7 MB | 1,2,3,4,3,2,2,3,1,3 | **4** | **MULTI-PERSON** | 51° | oblique |
| IMG_0274.MOV | 1920×1080 (land) | 29.99 | 221 | 7.4 s | 14.5 MB | 1,1,1,1,1,1,1,1,0,0 | 1 | SINGLE-PERSON | 0° | side-on |
| IMG_8263.MOV | 1080×1920 (port) | 29.99 | 216 | 7.2 s | 14.8 MB | 2,1,1,1,1,1,1,1,1,0 | 2 | (borderline) MULTI | 58° | oblique |
| IMG_8264.MOV | 1920×1080 (land) | 29.98 | 182 | 6.1 s | 12.5 MB | 10,11,11,10,8,8,11,8,8,9 | **11** | **MULTI-PERSON (crowd)** | 55° | oblique |
| IMG_8266.MOV | 1920×1080 (land) | 29.99 | 155 | 5.2 s | 10.8 MB | 9,8,9,8,10,9,9,9,6,7 | **10** | **MULTI-PERSON (crowd)** | 55° | oblique |
| IMG_8267.MOV | 1080×1920 (port) | 29.99 | 177 | 5.9 s | 12.2 MB | 2,2,2,2,2,2,2,2,2,2 | 2 | **MULTI-PERSON (clean pair)** | 60° | head-on |
| IMG_8269.MOV | 1920×1080 (land) | 29.99 | 175 | 5.8 s | 12.1 MB | 7,6,4,5,4,5,4,3,6,5 | **7** | **MULTI-PERSON** | 45° | oblique |
| forward_angle_test.mov | 720×1280 (port) | 30.00 | 538 | 17.9 s | 6.1 MB | 0,0,1,1,1,1,1,1,1,0 | 1 | SINGLE-PERSON | 56° | oblique/head-on |
| left_angle_test.mov | 720×1280 (port) | 29.96 | 488 | 16.3 s | 5.7 MB | 0,0,0,0,0,0,0,0,0,1 | 1 | SINGLE (partial body) | — | unknown |

**A usable multi-person clip now EXISTS — several.** The prior blocker (`ml-architecture-orchestration.md`
§6: "the relay clip must be added before person-switch tests can run") is **resolved**. The new IMG
clips give a spectrum of crowd density: **IMG_8264 (≤11 people)** and **IMG_8266 (≤10)** are dense
crowd scenes (closest analog to the missing OSS relay); **IMG_8269 (≤7)** and **IMG_0271 (≤4)** are
moderate multi-person; **IMG_8267 is a clean, consistent 2-person head-on pair** (ideal controlled
switch test). Azimuth estimates are **unstable and target-dependent** (e.g. IMG_8266 estimated 33°
in auto vs 0° with the bbox seed — different tracked person → different shoulder/hip ratio).

---

## 2. Single-target tracking stability (identity-switch baseline)

**Method** (per `model-benchmark.md:47-51`): from the persisted overlay (one 17×3 keypoint record per
retained frame — exactly what `_write_overlay` stores), compute the tracked person's **torso centroid**
(mean of L/R shoulder+hip = kp indices 5,6,11,12, normalized image coords). A **target-identity switch**
= a frame-to-frame centroid displacement **> 0.15** between consecutive retained pose samples (chosen
between normal 15-fps running motion ≈0.02–0.05 and the code's own `_TRACK_GATE=0.20`,
`rtmpose_backend.py:49`). Switch counts at 0.10/0.15/0.20 are reported for sensitivity; **mean** and
**p95** frame-to-frame displacement are the `model-benchmark.md` "mean jump" metric.

| Clip | mode | samples | mean disp | p95 disp | max jump | sw>0.10 | **sw>0.15** | sw>0.20 |
|---|---|---|---|---|---|---|---|---|
| IMG_0271 | none | 333 | 0.0044 | 0.0105 | 0.187 | 2 | **2** | 0 |
| IMG_0271 | bbox | 333 | 0.0043 | 0.0103 | 0.144 | 2 | **0** | 0 |
| IMG_0274 | none | 81 | 0.0123 | 0.0446 | 0.064 | 0 | **0** | 0 |
| IMG_0274 | bbox | 83 | 0.0114 | 0.0441 | 0.052 | 0 | **0** | 0 |
| IMG_8264 (crowd 11) | none | 91 | 0.0034 | 0.0077 | 0.021 | 0 | **0** | 0 |
| IMG_8264 (crowd 11) | bbox | 91 | 0.0027 | 0.0067 | 0.007 | 0 | **0** | 0 |
| IMG_8266 (crowd 10) | none | 78 | 0.0118 | 0.0501 | 0.118 | 1 | **0** | 0 |
| IMG_8266 (crowd 10) | bbox | 70 | 0.0181 | 0.0492 | 0.122 | 2 | **0** | 0 |
| IMG_8267 (pair) | none | 89 | 0.0011 | 0.0022 | 0.003 | 0 | **0** | 0 |
| IMG_8267 (pair) | bbox | 89 | 0.0039 | 0.0141 | 0.025 | 0 | **0** | 0 |
| IMG_8269 (crowd 7) | none | 88 | 0.0089 | 0.0392 | 0.157 | 1 | **1** | 0 |
| IMG_8269 (crowd 7) | bbox | 87 | 0.0115 | 0.0602 | 0.098 | 0 | **0** | 0 |
| forward_angle_test | bbox | 190 | 0.0143 | 0.0391 | **0.367** | 3 | **2** | 1 |

**Baseline switch numbers:** with the **bbox seed**, every real IMG clip shows **0 switches (>0.15)** —
already at the §6 "≤1" target. In **auto** mode the worst are **IMG_0271 = 2** and **IMG_8269 = 1**.
Mean frame-to-frame displacement is **0.003–0.018**, in line with the `model-benchmark.md` crop-track
reference of 0.019 (p95 ≤ 0.060). `forward_angle_test` (bbox) is the least stable (2 switches, max jump
0.367) — a head-on subject the tracker repeatedly loses and re-acquires.

> **Critical caveat — a low switch count here does NOT mean the tracker is correct.** On the dense
> crowds (IMG_8264/8266) the switch count is 0 because the tracker locks a **small, near-stationary,
> distant figure** and never leaves it — which the biomechanics (§3) exposes as degenerate (a
> straight leg that "never flexes," cadence 167–251 spm). So the identity-switch metric must be read
> **together with** biomech plausibility; on its own it is optimistic on crowd clips. This is exactly
> the "identity is owned by a heuristic, not a tracker" gap (`ml-architecture-orchestration.md` §0a).

---

## 3. Biomechanics output & plausibility assessment

Full `AnalysisResult` captured per clip/mode (economyScore, every metric's value + `trustStatus` +
`normalRange` + tier, flaws). Highlights and the **worst plausibility problems**:

### 3.1 Two metrics are pinned to their clamp ceilings on 100% of clips (non-informative)
- **`overstride` = 40.0 % on every single successful run** — this is the exact hard clamp
  `min(...*100, 40.0)` (`biomech2d.py:241`). It never reports anything but its ceiling → useless as a
  signal, yet still fires an "Overstriding" flaw wherever it's deemed usable.
- **`vertical_oscillation` = 25.0 % on every single successful run** — the hard clamp
  `min(..., 25.0)` (`biomech2d.py:242`). Always maxed → every clip earns "Excess vertical bounce
  (sev3)."

### 3.2 Temporal metrics are physiologically impossible at 15 fps pose sampling
- **`contact_time_ms` ranges 167 → 3567 ms** (normal 80–140). Values like 859, 1111, 3567 ms (a
  3.5-second ground contact) are absurd — a direct consequence of gait detection on a 15-fps
  subsampled signal (the root cause of bug **B1**, §5). Every clip earns "Long ground contact (sev3)."
- **`cadence_spm` ranges 5 → 251** (normal 270–330) — always far **below** range for the same reason.
  Every clip earns "Cadence off-target (sev3)."

### 3.3 "trusted" labels appear on physically implausible angles
The trust tier is gated on **azimuth + keypoint confidence only — never on plausibility**
(`biomech2d.py:262-282`). On **IMG_0274** (estimated side-on, azimuth 0°, conf 0.62–0.67) the tier-2
sagittal metrics are stamped **`trusted`**, yet the emitted values are not credible for a runner:
**`trunk_lean` 68–72°** (a near-horizontal torso), **`knee_drive` 21°**, **`arm_swing` 164°** (an
almost-straight elbow). So the system can label nonsense "trusted." This is the single most dangerous
plausibility failure: a green "trusted" badge on out-of-physiology output.

### 3.4 Auto lock-and-follow selects degenerate targets on crowds/oblique clips
On IMG_8264/8266/8269/0271 the auto/centre-bbox target is a distant near-static person:
**`knee_flexion` 137–176°** (normal 25–55; the metric is the *most-flexed* frame, so >150° means the
leg literally never bends), **`arm_swing` 122–167°**, `economyScore` **0**. These are "measurements"
of the wrong (or non-running) subject.

### 3.5 Reference-clip sanity checks (as expected)
- **`forward_angle_test`** (head-on walk): **auto mode fails outright** (0 usable frames,
  `low_confidence_video`); a centred **bbox seed rescues it** (190 frames) but everything comes back
  tier-2 **experimental** (conf 0.25) — head-on → no sagittal depth, honestly untrusted. ✔ expected.
- **`left_angle_test`** (indoor, partial body): **correctly rejected** in both modes
  (`low_confidence_video`; 6 and 1 usable frames). ✔ expected.

**Plausibility verdict:** the *only* run that produces a coherent side-on athlete profile is
**IMG_0274** — and even there `trunk_lean`/`arm_swing` are implausible while wearing a `trusted` badge.
Trust tiers correctly gate *temporal* and *off-axis* metrics to experimental, but do **not** protect
against implausible *values* or a degenerate *target*. `overstride` and `vertical_oscillation` are
saturated ceilings and should be treated as non-signals in the current build.

---

## 4. Compute & storage

Per-clip analysis latency (streaming pose+biomech, model load excluded), effective throughput, peak
RSS (`resource.getrusage`, darwin bytes), and persisted-artifact sizes.

| Clip | mode | video s | analysis s | ×realtime | eff fps | peak RSS | result.json | overlay.json | overlay B/frame |
|---|---|---|---|---|---|---|---|---|---|
| IMG_0271 | none | 22.5 | 19.7 | 0.88× | 16.9 | 289 MB | 5.1 KB | 154.5 KB | 464 |
| IMG_0271 | bbox | 22.5 | 20.7 | 0.92× | 16.1 | 290 MB | 5.1 KB | 154.5 KB | 464 |
| IMG_0274 | none | 7.4 | 5.5 | 0.74× | 14.8 | 341 MB | 9.1 KB | 37.5 KB | 463 |
| IMG_8264 | none | 6.1 | 10.7 | **1.76×** | 8.5 | 347 MB | 5.1 KB | 42.2 KB | 463 |
| IMG_8264 | bbox | 6.1 | 6.1 | 1.01× | 14.9 | 354 MB | 5.1 KB | 42.2 KB | 464 |
| IMG_8266 | none | 5.2 | 8.6 | 1.66× | 9.1 | 346 MB | 7.4 KB | 36.2 KB | 464 |
| IMG_8267 | none | 5.9 | 5.5 | 0.94× | 16.1 | 356 MB | 5.1 KB | 41.2 KB | 463 |
| IMG_8269 | none | 5.8 | 7.3 | 1.25× | 12.1 | 347 MB | 5.1 KB | 40.8 KB | 464 |
| forward_angle_test | bbox | 17.9 | 12.7 | 0.71× | 14.9 | 289 MB | 5.1 KB | 87.9 KB | 463 |

**Headline:**
- **Latency ≈ 0.7–1.0× video duration** for sparse scenes; **1.3–1.8× (slower than realtime)** for auto
  mode on dense crowds, because full-frame YOLOX+RTMPose runs on all 8–11 people every sampled frame.
  A **bbox crop seed removes that penalty** (IMG_8264 auto 10.7 s → bbox 6.1 s). Model load is a
  one-time ~0.15–0.2 s (weights disk-cached; first inference absorbs CoreML warmup).
- **Peak RSS ≈ 280–360 MB** (onnxruntime + ~76 MB of ONNX weights resident). Fits comfortably on a
  small CPU worker.
- **Storage:** `overlay.json` is a compact **~463 bytes per retained frame** → **~6.9 KB per second of
  video** at pose_fps=15 (≈ `464 × 15`). `result.json` is a fixed **~5–9 KB** per analysis. A 20 s clip
  costs ~155 KB of overlay; storage scales linearly with clip length, not resolution.

---

## 5. Documented-bug confirmations (B1 / B4 / B5)

### B1 — Temporal trust gate is unreachable by construction ✔ CONFIRMED (key honesty bug)
`FPS_TRUST_GATE = 120.0` (`biomech2d.py:90`) but `temporal_fps = min(cap_fps, pose_fps)`
(`biomech2d.py:258`), and production caps `pose_fps` at 15 (`POSE_FPS` default, `worker.py:183`) →
`temporal_fps ≤ 15 < 120` **always**. So `cadence_spm`, `contact_time_ms`, and `vertical_oscillation`
(tier 1) return `experimental` regardless of capture fps.

- **Measured on every real clip:** all three tier-1 metrics = `experimental` (§3, tables above).
- **Measured with a simulated 120 fps capture** (`capture_fps=source_fps=120`, `pose_fps=15`,
  conf 0.67 ≥ 0.6 so *only* the fps gate is binding): `temporal_fps = min(120,15) = 15` →
  `cadence_spm`, `contact_time_ms`, `vertical_oscillation` **still `experimental`.**
- **Gate-flip proof (synthetic, conf 0.9):** feeding identical frames but varying only `pose_fps`:

  | pose_fps | temporal_fps = min(120, pose_fps) | cadence | contact_time | vert_osc |
  |---|---|---|---|---|
  | **15** (production) | 15 | **experimental** | **experimental** | experimental |
  | 120 (unreachable) | 120 | **trusted** | **trusted** | experimental* |

  The gate logic itself works — it flips to `trusted` at ≥120 — but production's `pose_fps=15` cap plus
  `min(cap,pose)` makes 120 unreachable. (*`vertical_oscillation` stays experimental even at 120 because
  it is in `CANDIDATE`, `biomech2d.py:93` — a second, independent reason it can never be trusted.) Fix =
  dual-rate timing (§2.5 / Phase 3): derive `temporal_fps` from a full-source-fps 1-D signal.

### B4 — Non-portable confidence threshold ✔ CONFIRMED
`rtmpose_backend.py:20` imports MoveNet's constant:
`from src.movenet import CONFIDENCE_THRESHOLD, ...`, and reuses it verbatim as the frame-exclusion
gate at `rtmpose_backend.py:162` and `:177` (`... < CONFIDENCE_THRESHOLD`). The value is defined once
for MoveNet's heatmap-argmax distribution at `movenet.py:46` (`CONFIDENCE_THRESHOLD: float = 0.3`) and
is not recalibrated for RTMPose's SimCC score distribution. Fix = per-format threshold in the
canonicalizer (§2.2 / B4).

### B5 — "RTMDet" is actually YOLOX ✔ CONFIRMED
The installed `rtmlib` `Body` class loads **YOLOX** detector weights, not RTMDet
(`.venv312/.../rtmlib/tools/solution/body.py`):
- `MODE['lightweight']['det'] = '...yolox_tiny_8xb8-300e_humanart-6f3252f9.zip'` (line 58);
  `balanced` → `yolox_m` (line 66); `performance` → `yolox_x` (line 50).
- The detector class instantiated is **`YOLOX`**: `from .. import YOLOX, RTMPose` (line 115) →
  `self.det_model = YOLOX(det, ...)` (line 127). There is no RTMDet import.
- **On-disk cache confirms it:** the actually-downloaded detector is
  `~/.cache/rtmlib/hub/checkpoints/yolox_tiny_8xb8-300e_humanart-6f3252f9.onnx` (+ `yolox_m`).

Yet the code/docs say "RTMDet": `rtmpose_backend.py:1` docstring ("RTMDet person detector"),
`pose2d.py:4` comment ("RTMDet detector + RTMPose"), and `model-benchmark.md:14`. Doc-only bug (both
Apache-2.0), but it misleads the next engineer. Fix = rename "RTMDet"→"YOLOX" in comments/docstrings.

**Corroborating B3:** the emitted `result.json` carries **no `model_meta`** — only
`reconstructionMethod: "2d"` (`biomech2d.py:332`). The backend that ran is not recorded in the result,
consistent with the B3 finding (model version not derived from the backend).

---

## 6. Recommended clip for future person-switch tests

The person-switch tests (§6 of the architecture doc) need a **genuine multi-person** clip where a
target runner moves *among distractors*. Recommendation, in priority order:

1. **IMG_8266.MOV (≤10 people, oblique) — PRIMARY.** Densest crowd that still tracks a plausible moving
   subject in bbox mode (real angle values, not a frozen distant figure), and it already shows residual
   tracking sensitivity (auto max-jump 0.118). Best stand-in for the missing OSS relay.
2. **IMG_8269.MOV (≤7 people, oblique) — SECONDARY / the honest stressor.** The *only* clip that
   produced a **real auto-mode identity switch** (1 switch >0.15, max jump 0.157) — the exact failure
   the Kalman+cascade tracker (Phase 1) must drive to 0.
3. **IMG_8267.MOV (consistent 2-person, head-on) — CONTROLLED PAIR TEST.** Two people every frame with
   distinct positions → clean, reproducible A-vs-B switch scenario for scripted-occlusion re-acquisition.
4. **IMG_8264.MOV (≤11 people) — DENSITY CEILING**, but note its auto target is a degenerate distant
   figure (0 switches for the wrong reason); use it to test bystander *rejection*, not switch counting.

Seed each with a **specific runner's brush bbox** (not the generic centre seed) so "did the tracker stay
on the seeded athlete?" is well-posed. Pair every switch count with a biomech-plausibility check
(§2 caveat) so a frozen-on-a-bystander lock is not mistaken for a stable track.

---

## 7. Baseline mapped to the §6 pass/fail targets

| §6 test (phase) | Target | **Measured baseline (this doc)** |
|---|---|---|
| Free-bystander exclusion (P0) — switches on relay/crowd | ≤ 1; single-runner jump ≤ 0.019 | Auto: **IMG_0271=2, IMG_8269=1**, others 0. Bbox: **0** on all IMG clips. Mean jump **0.003–0.018** (≤0.019 ✔ except forward_bbox 0.014 w/ max 0.367). |
| One-Euro/SG smoothing (P0) — peak metrics & jitter | jitter ↓≥20%, peak shift ≤2° | Pre-smoothing peaks on the clean clip **IMG_0274 (side-on)**: `knee_drive` p95 **20.7°**, `hip_ext` p95 **159.3°**, `knee_flex` p5 **35.2°**. (Per-frame jitter series not persisted — recompute at test time; these are the peaks to hold within 2°.) |
| B3/B4/B5 (P0) | model_meta matches backend; RTMPose own threshold; no "RTMDet" | **B4 & B5 CONFIRMED broken** (§5). result.json has **no model_meta** (B3 corroborated). |
| `keypoint_format` field (P0) | present, `=="coco17"` | **ABSENT today** — yielded frame dict is `{frame_index, keypoints, avg_confidence, excluded}` (`rtmpose_backend.py:179-184`); no `keypoint_format`. |
| Kalman+cascade tracker (P1) | switches ≤1; re-acquire ≤10 frames; jump ≤0.019 | Baseline auto switches up to **2**; **IMG_8269 auto = 1 real switch** is the target case; jump baseline **0.003–0.018**. |
| Dual-rate timing (P3) — B1 | high-fps ⇒ `cadence`/`contact_time` trusted; 30 fps ⇒ experimental | Baseline: **always `experimental`**, even at simulated 120 fps (§5 B1). Post-fix must show `trusted` at ≥120 fps. |
| LK-flow sampling (P4) — latency | detector calls ≥3× fewer; angles ≤2°; latency ↓ | Baseline latency **0.7–1.8× realtime** (auto-crowd worst 1.76×); baseline eff throughput **8.5–17 fps**. |
| Latency budget (all CPU phases) | ≤ 20% added vs baseline | Baseline analysis latency per clip tabulated in §4 — the number to stay within +20% of. |

---

## 8. Failures captured as findings (not fixed)

| Clip | mode | outcome | note |
|---|---|---|---|
| IMG_8263.MOV | none / bbox | `low_confidence_video` (25 / 42 frames included) | Portrait, borderline 2-person; >60% frames excluded → rejected. Real content the pipeline can't currently use. |
| forward_angle_test.mov | none | `low_confidence_video` (**0** usable frames) | Whole-frame auto lock-and-follow finds **no** usable frame on this small/far head-on subject; the **bbox crop seed rescues it (190 frames)**. Concrete evidence that whole-frame auto is fragile and crop-to-target is load-bearing. |
| left_angle_test.mov | none / bbox | `low_confidence_video` (6 / 1) | Correctly rejected (partial body), as designed. |

No clip crashed the pipeline; all failures were the intended `low_confidence_video` guard
(`biomech2d.py:399`). Throwaway scripts and raw per-run JSON live in the session scratchpad.
