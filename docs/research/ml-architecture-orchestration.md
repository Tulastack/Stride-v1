# ML Pipeline Architecture — Model-Agnostic, Single-Target, CPU-First

> Orchestration of six research surveys against Stride's **actual** pose pipeline.
> Goal: make the pipeline (1) **model-agnostic** and (2) **primarily focused on one
> target**, at **minimal compute/storage**, on a **CPU/onnxruntime-only** worker
> (torch deliberately excluded), without breaking the working
> upload → analysis → suggestions → calendar → coach path.
>
> This is an architecture/plan document only. No production code here. A separate
> testing phase (§6) follows. Every recommendation cites real `file:line`.

## 0. The problem in one paragraph

The production 2D path is `RTMDet/YOLOX → RTMPose (COCO-17) → crop-to-target track →
biomech2d → trust tiers`, all CPU/ONNX (`worker.py:87`, `pose2d.py`,
`rtmpose_backend.py`, `biomech2d.py`). It works, but three structural gaps block the
stated goal. **(a) Identity is owned by a heuristic, not a tracker:** the crop picks
the detection nearest the crop centre and EMA-smooths the box
(`rtmpose_backend.py:147-160`), which still swaps onto bystanders in dense clusters
(benchmark §5.4: "relay: 1–2 residual switches"). **(b) The pipeline is only
*half* model-agnostic:** backends share a per-frame dict, but biomechanics indexes a
hardcoded COCO-17 map (`biomech2d.py:28` → `biomechanics.py:22-40`), the backend seam
is an `if/elif` (`pose2d.py:19-27`), and RTMPose reuses MoveNet's confidence threshold
(`rtmpose_backend.py:20`). Swap the backbone and biomech silently reads wrong joints.
**(c) The honesty gate is unreachable by construction:** temporal metrics gate at
120 fps (`biomech2d.py:90`) but pose is sampled at 15 fps (`worker.py:183`) and
`temporal_fps = min(cap_fps, pose_fps)` (`biomech2d.py:258`) — so cadence/contact-time
are *always* "experimental," even on a 240 fps capture.

The convergent fix is a **3-layer seam** (raw backend → per-backend canonicalizer →
canonical schema → biomech) with a **dedicated tracker that owns identity**, a
**dual-rate timing signal**, and **cheap causal smoothing** — nearly all shippable on
CPU today, with a small set of options honestly quarantined to a future GPU tier.

---

## 1. Target architecture

Three layers replace the current two. The middle **canonicalizer** layer is what is
missing today. A dedicated **crop_tracker** owns target identity (it is no longer a
side-effect of the RTMPose backend). A **dual-rate** split lets timing metrics ride a
full-fps 1-D signal while angles stay at 15 fps. Smoothing and (optional) masking sit
at defined seams.

```
                              ┌──────────────────────────────────────────────────────────┐
   video file  ──────────────►│  FRAME SOURCE  (frame_source.py — NEW, opt.)              │
   (worker._run_2d)           │  • sample detector KEYFRAMES every N frames               │
                              │  • LK optical flow carries the box + kpts between them    │  CPU
                              │    (cv2.calcOpticalFlowPyrLK — no new dep) → 3–5× fewer    │
                              │    detector calls                                          │
                              └───────────────┬──────────────────────────────────────────┘
                                              │ frame, is_keyframe
                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────┐
   │  CROP_TRACKER  (crop_tracker.py — NEW; factored out of rtmpose_backend.py:44-188)      │
   │  OWNS IDENTITY. Pure numpy/cv2, backend-agnostic (takes only keypoints/scores/frame).  │
   │                                                                                         │
   │   ┌── Kalman (cv2.KalmanFilter, constant-velocity on bbox) ──► predicted search box    │
   │   │                                                                                     │
   │   │   run backend ONLY inside the predicted box  ───────────────────────────────┐      │
   │   │                                                                              │      │
   │   ▼                                                                              ▼      │
   │  CASCADED GATE (replaces _select_person nearest-centroid, rtmpose_backend.py:60-78):    │
   │    1. motion/IoU gate  → keep only motion-plausible detections                          │  CPU
   │    2. appearance tie-break → HSV colour histogram (→ tiny OSNet ONNX only if needed)    │
   │    3. cadence-FFT gate (opt.) → reject non-periodic candidates (spectators)             │
   │  FREE BYSTANDER EXCLUSION: body(crop) already returns ALL people (rtmpose_backend.py    │
   │    :147); zero-out/blur the non-target boxes before refining the target's keypoints.    │
   │  CONDITIONAL MASK (opt., mask.py — NEW): only when ≥2 detections overlap the target     │
   │    box → MobileSAM-in-crop keyframe mask (ONNX/CPU).                                     │
   └───────────────┬────────────────────────────────────────────────────────────────────────┘
                   │ crop (target isolated) + target bbox
                   ▼
   ┌──────────────────────────────┐     ┌───────────────────────────────────────────────────┐
   │  POSE BACKEND (registry)     │     │  (opt.) 2nd BACKEND for CROSS-BACKBONE CONSENSUS   │
   │  pose_backend.py — NEW       │     │  same crop → different backbone                    │
   │  Protocol: iter_frames,      │     └──────────────────────┬────────────────────────────┘
   │  KEYPOINT_FORMAT,            │                            │
   │  MODEL_VERSION, MODEL_META   │                            │
   │  REGISTRY replaces pose2d    │                            │
   │  if/elif (pose2d.py:19-27)   │                            │
   └──────────────┬───────────────┘                            │
                  │ RAW keypoints (native topology, native coord convention)                 │
                  ▼                                                                           ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────┐
   │  CANONICALIZER  (canonicalize.py — NEW)   ← the missing middle layer                    │
   │  • undo native transform → normalize by ORIGINAL frame dims → reorder to [y,x,conf]     │
   │  • map native indices → canonical JOINT_NAMES (extends joint_schema.py)                 │
   │  • per-format confidence normalization (fix rtmpose_backend.py:20 threshold reuse)      │
   │  • synthesize missing joints (COCO neck = shoulder-midpoint) with derived=True          │
   │  • emit typed Frame2D {frame_index, timestamp_ms, keypoints, keypoint_format, bbox,     │
   │    model_meta, avg_confidence, excluded}                                                 │
   │  • CONSENSUS: where two backbones' canonical joints agree → trust boost                 │
   └──────────────┬─────────────────────────────────────────────────────────────────────────┘
                  │ canonical Frame2D stream
                  ▼
   ┌──────────────────────────────┐        ┌──────────────────────────────────────────────┐
   │  ONE-EURO SMOOTHING          │        │  DUAL-RATE TIMING SIGNAL                       │
   │  smoothing.py — NEW          │        │  ankle-y / foot-velocity 1-D signal extracted │
   │  causal, per-canonical-joint │        │  at FULL source fps (network-free, from the   │
   │  or per-angle-scalar         │        │  already-tracked box) → feeds _gait timing    │
   │  (scipy already available)   │        │  while angles stay at pose_fps=15             │
   └──────────────┬───────────────┘        └───────────────────┬──────────────────────────┘
                  │                                             │
                  ▼                                             ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────┐
   │  biomech2d.analyze_2d_sagittal_stream  (biomech2d.py)                                   │
   │  • reads CANONICAL names, not KP indices (removes biomech2d.py:28 hardcoding)           │
   │  • temporal_fps derived from the FULL-fps timing signal, not min(cap,pose) → clears     │
   │    the 120 fps gate (fixes biomech2d.py:258 vs :90)                                     │
   │  → AnalysisResult (unchanged @stride/types contract) → API → suggestions/calendar/coach │
   └──────────────────────────────────────────────────────────────────────────────────────┘
```

Everything above the "future GPU tier" line runs on the existing
CPU/onnxruntime/opencv/scipy stack (`requirements.txt:1-16`, torch commented at
`requirements.txt:18-19`). Only real pixel-mask *video* propagation (SAM2 class) and
the 3D lift belong to the GPU tier (§5).

---

## 2. Component specs

Each component names its target file(s), interface, and how it plugs into current code.
"NEW" = new module; otherwise an edit to an existing file.

### 2.1 PoseBackend Protocol/ABC + registry — `pose_backend.py` (NEW), edit `pose2d.py`

**Why:** `pose2d.py:19-27` and `:34-42` dispatch backends with `if backend ==
"rtmpose" … else movenet`. Fine for 2, doesn't scale, and hardcodes MoveNet as the
fallback everywhere.

**Interface (new `pose_backend.py`):**
```python
class PoseBackend(Protocol):
    KEYPOINT_FORMAT: str            # "coco17" | "halpe26" | "blazepose33" | ...
    MODEL_VERSION: str              # e.g. "rtmpose-m-body7"
    MODEL_META: dict                # {backend, model_version, input_size, device}
    def iter_frames(self, video_path, target_fps, target=None) -> Iterator[RawFrame]: ...

REGISTRY: dict[str, str] = {        # name → import path
    "rtmpose": "src.rtmpose_backend",
    "movenet": "src.movenet",
}
```
**Plug-in:** `pose2d.process_video`/`stream_frames` become 3-line resolvers over
`REGISTRY[os.environ["POSE2D_BACKEND"]]`. Adding BlazePose/ViTPose/RTMO becomes
"register a module," not "add an elif." Pattern is exactly Pose2Sim's declarative
`pose_model` selector.
**Cost:** zero runtime; pure refactor. **CPU-safe now.**

### 2.2 Per-backbone canonicalizer + typed Frame2D — `canonicalize.py` (NEW), extend `joint_schema.py`, edit `biomech2d.py`

**Why (the actual model-agnosticism bug):** the 3D path already routes through
`joint_schema.py`'s `JOINT_NAMES`/`MOVENET_TO_ENGINE` (`joint_schema.py:7-33`), but the
2D production path bypasses it: `biomech2d.py:28` imports the COCO-17 `KP` dict from
`biomechanics.py:22-40` and indexes raw positions throughout (`_frame_scalars`,
`biomech2d.py:145-170`; `estimate_azimuth_from_keypoints`, `:130-142`; gait ankle-rel,
`:380-382`). Index 11 = `left_hip` in COCO-17 but `left_foot_index` in BlazePose-33 —
a silent wrong-joint read on any backbone swap.

**Typed contract (`Frame2D`, in `canonicalize.py`), extends today's dict:**
```
Frame2D:
  frame_index:     int
  timestamp_ms:    float           # NEW — don't assume constant sample interval
  keypoints:       float32[K,3]    # canonical order, [y,x,conf], original-frame normalized
  keypoint_format: str             # NEW — declares topology
  bbox_xyxy_norm:  tuple | None     # NEW — already computed (rtmpose_backend._norm_bbox_from_kp:81)
  avg_confidence:  float
  excluded:        bool
  model_meta:      dict             # NEW — {backend, model_version, input_size, device}
  derived:         bool[K]          # NEW — synthesized joints (e.g. COCO neck) flagged
```
**Canonicalizer interface:** `canonicalize(raw_kpts, scores, keypoint_format, frame_w,
frame_h) -> Frame2D`. Per format it (1) undoes the native transform, (2) normalizes by
**original** frame dims, (3) reorders to `[y,x,conf]`, (4) maps native index → canonical
name, (5) synthesizes missing joints with `derived=True`, (6) applies a
**format-specific** confidence normalization.
**Plug-in:** biomech2d switches from `KP["left_hip"]` (integer index) to
canonical-name access. Because canonical order is fixed, biomech's geometry is
untouched — the regression test (§6) asserts identical output for identical COCO-17
input.
**Cost:** negligible (index remap per frame). **CPU-safe now.** This is the gate that
must land before BodyWithFeet (§2.9) or any new backbone.

### 2.3 Shared crop_tracker.py (Kalman + cascaded gate + free bystander exclusion + optional cadence-FFT) — `crop_tracker.py` (NEW), edit `rtmpose_backend.py`

**Why:** `rtmpose_backend.py:44-188` mixes RTMPose inference with ~100 lines of tracking
that only use `(keypoints, scores, frame)` — nothing RTMPose-specific. Today identity is
"nearest to crop centre + EMA box" (`rtmpose_backend.py:60-78`, `:147-160`), which is a
position heuristic with no motion model and no appearance check → the residual relay
switches.

**Interface (`crop_tracker.py`):**
```python
class CropTracker:
    def __init__(self, seed_bbox, frame_wh): ...          # seed from brush bbox / point
    def predict(self) -> bbox: ...                          # Kalman constant-velocity
    def update(self, detections, frame) -> (bbox, target_idx, bystander_boxes): ...
```
Internals, ordered by the **cascaded gate** (motion first, appearance only to break
ties):
1. **Kalman motion prediction** — `cv2.KalmanFilter` (constant-velocity on bbox
   centre+size, in opencv already). Replaces the isotropic `(0.4 + 0.25*miss)` box
   widening (`rtmpose_backend.py:140-141`) with a motion-predicted search region.
2. **Motion/IoU gate** — keep only detections plausibly reachable from the prediction.
3. **Appearance tie-break** — HSV colour-histogram similarity of the target box vs
   candidates; escalate to a tiny **OSNet-x0.25 ONNX** Re-ID embedding *only* if the
   histogram is ambiguous (same-uniform relay case).
4. **Cadence-FFT gate (optional)** — a rolling FFT / zero-crossing check on the
   candidate's vertical bob; runners show a ~2.5–3.5 Hz periodicity spectators don't.
   Catches the same-uniform case appearance can't.
5. **Free bystander exclusion (ship first, see Phase 0)** — `body(crop)` already returns
   *all* people in the crop and discards all but the centroid-nearest
   (`rtmpose_backend.py:147-152`). Zero-out/blur the non-target detection boxes in the
   crop before refining the target's keypoints. Zero new model, zero added latency.

**Plug-in:** `rtmpose_backend.iter_frames` calls `CropTracker.predict()/update()` instead
of its inline centroid/EMA logic; any future backend gets crop-tracking for free.
**Cost:** Kalman + histogram are microseconds/frame. OSNet-x0.25 is ~1–2 ms/crop on CPU,
invoked rarely. **CPU-safe now.**

### 2.4 LK-flow keyframe sampling — `frame_source.py` (NEW) or inside crop_tracker

**Why:** compute reduction. Run the detector+pose every N frames (keyframes); between
them, carry the box and keypoints with **Lucas-Kanade optical flow**
(`cv2.calcOpticalFlowPyrLK`, already in opencv) → 3–5× fewer detector calls at similar
accuracy for smooth running motion.
**Interface:** a generator that yields `(frame, is_keyframe, tracked_kpts)`; the backend
runs full inference only on keyframes, LK-propagates otherwise.
**Cost:** net compute *reduction*; LK is far cheaper than a detector pass. **CPU-safe
now.** This is also the natural host for the dual-rate signal (§2.5) since LK already
gives per-frame foot motion between keyframes.

### 2.5 Dual-rate temporal signal — edit `biomech2d.py`, `rtmpose_backend.py`/`crop_tracker.py`, `worker.py`

**Why (the 120-vs-15 bug):** `FPS_TRUST_GATE = 120.0` (`biomech2d.py:90`) but
`temporal_fps = min(cap_fps, pose_fps)` (`biomech2d.py:258`) and `pose_fps` defaults 15
(`worker.py:183`), so `temporal_fps ≤ 15 < 120` always → cadence/contact-time/vertical-
oscillation stuck "experimental" regardless of capture fps.
**Design:** decouple *timing* from *angles*. Extract a 1-D `ankle_y`/`foot_velocity`
signal at **full source fps** — network-free, straight off the tracked crop box (or LK
flow, §2.4) — and feed it to `_contact_positions`/`_gait` (`biomech2d.py:173-211`).
Joint angles stay at 15 fps. Then `temporal_fps` for the timing metrics reflects the
source fps of the 1-D signal, so a real 120/240 fps capture actually clears the gate.
**Plug-in:** `analyze_2d_sagittal_stream` gains an optional high-rate `timing_signal`
iterable; `_assemble` computes `temporal_fps` from it instead of `min(cap_fps,
pose_fps)`. No change to inference cost (the signal is free).
**Cost:** near-zero compute; small storage (a 1-D array during analysis, discarded
after). **CPU-safe now.**

### 2.6 One-Euro smoothing — `smoothing.py` (NEW) or scipy in `biomech2d.py`

**Why (cheapest quality win):** angle scalars get **no** temporal filtering today —
`_smooth` (`biomech2d.py:104-107`) is a 3-tap boxcar applied *only* to `ank_y_rel` for
contact detection; `_assemble` takes raw `np.percentile`/`np.mean` over the unsmoothed
`knee_drive`/`hip_ext`/`knee_flex`/`elbow`/`trunk` series (`biomech2d.py:245-255`), so
per-frame jitter inflates the p95/p5 peaks the metrics report.
**Design (two honest options):**
- **One-Euro** (causal, adaptive; MediaPipe's last step): ~15 lines pure Python, applied
  per canonical joint inside the stream loop (`biomech2d.py:369-396`) or per angle
  scalar. Smooths static stance-phase joints hard, relaxes during fast swing so peaks
  aren't flattened. Start `mincutoff≈1.0Hz`, tune `beta` higher for ankle/knee than
  trunk.
- **Savitzky-Golay** (`scipy.signal.savgol_filter`; scipy already in
  `requirements.txt:13`): offline-OK since analysis is a queued job. **Window ≤ 5 at 15
  fps** (an 11-tap window is 730 ms > a full swing phase and *would* flatten peaks).
**Plug-in:** filter each `S[k]` series at the top of `_assemble` (`biomech2d.py:233`) or
stream-filter in the loop. Parameterize by canonicalizer metadata
(`outputs_subpixel`) so heatmap-argmax vs SimCC backbones get appropriate strength.
**Cost:** O(1)/keypoint, no new dependency. **CPU-safe now.** Single cheapest win.

### 2.7 Conditional MobileSAM-in-crop — `mask.py` (NEW), gated in crop_tracker

**Why:** masks measurably help pose accuracy **only** when another person's pixels fall
inside the target box (CrowdPose-style overlap; ICCV'25 MaskPose 42.6→45.0 AP). A tight,
well-tracked crop already removes non-runner content for one runner in open space — so
mask **conditionally**, not always-on.
**Design:** gate on the free bystander detections (§2.3): only when ≥2 detections overlap
the target box, run **MobileSAM** (MIT, 5 M-param encoder, ONNX-exportable — the only
SAM-family model that is small **and** permissive **and** ONNX, no torch) **inside the
crop** as a **keyframe mask** (every 0.5–1 s), carried forward by the box motion between
keyframes. Seed prompt = the brush bbox from `TargetSelect.tsx:78-84`
(`{x0,y0,x1,y1}` is already a SAM box prompt).
**Cost:** MobileSAM on CPU is ~100s of ms per keyframe — non-trivial but bounded (crop
resolution, keyframe cadence, only-on-overlap). **CPU-viable but conditional/optional.**
Do NOT reach for SAM2-class video propagation (§5).

### 2.8 Cross-backbone consensus trust — edit `canonicalize.py` / new `consensus.py`

**Why (model-agnostic trust signal):** where two independent backbones (e.g. RTMPose vs
MoveNet, or RTMPose-t vs -m) agree in canonical space, the joint is trustworthy without
any single-model calibration — a genuinely backend-agnostic confidence.
**Design:** run a second backend on the same crop (via the registry, §2.1), canonicalize
both, and set a per-joint `consensus_agreement` from their canonical-space distance;
feed it into biomech2d's per-metric trust (`biomech2d.py:262-282`) alongside `mean_conf`.
**Cost:** ~2× pose compute when enabled → make it an **opt-in "high-accuracy" mode** or
an **offline validation tool**, not always-on. **CPU-safe but compute-costly.**

### 2.9 BodyWithFeet (Halpe-26) — edit `rtmpose_backend._load_body` (after §2.2)

**Why:** COCO-17 (both current backbones) has **no foot keypoints**; `_contact_positions`
proxies foot-strike off ankle-height maxima (`biomech2d.py:173-186`), noisier than a real
heel keypoint (~0.55 cm vs multi-cm). `rtmlib` `BodyWithFeet` (Halpe-26, real heel/toe)
is already vendored, same cost tier.
**Blocker:** it changes 17→26 keypoints and `KEYPOINT_INDEX`/`CORE_JOINTS` are hardcoded
17-point (`rtmpose_backend.py:20`). **Must land after the canonicalizer (§2.2).**
**Cost:** ~zero extra compute. **CPU-safe now, but gated on §2.2.**

---

## 3. The real bugs (file:line + fix)

| # | Bug | Location | Fix |
|---|-----|----------|-----|
| B1 | **Temporal trust gate unreachable.** Gate is 120 fps but pose is sampled 15 fps and `temporal_fps = min(cap_fps, pose_fps)`. Cadence/contact-time/vertical-osc are *always* "experimental," even on a 240 fps capture. | `biomech2d.py:90` (`FPS_TRUST_GATE=120`), `biomech2d.py:258` (`temporal_fps=min(cap_fps,pose_fps)`), `worker.py:183` (`POSE_FPS` default 15) | Dual-rate (§2.5): derive `temporal_fps` from a full-source-fps 1-D timing signal, not `pose_fps`. |
| B2 | **biomech2d is not backend-agnostic.** Hardcoded COCO-17 index dict indexed throughout; swap backbone → silently wrong joints. | `biomech2d.py:28` (`from src.biomechanics import KP`), `biomechanics.py:22-40` (COCO-17 `KP`), usages `biomech2d.py:132-133,147-154,166-167,380-382` | Route 2D path through canonicalizer + canonical `JOINT_NAMES` (§2.2), same as the 3D path already does. |
| B3 | **Model version not derived from the backend that ran.** 2D DB-fallback writes a hardcoded `"rtmpose+2d-sagittal"` (correct only if backend *is* rtmpose); legacy path writes `MOVENET_VERSION` regardless of backend; the result JSON carries no `model_meta` at all (only `reconstructionMethod:"2d"`). | `worker.py:236` (hardcoded string), `worker.py:303` (`MOVENET_VERSION` unconditional), `biomech2d.py:332` (no model_meta) | Thread `model_meta` (§2.2) from the active backend into the result and DB write. |
| B4 | **Non-portable confidence threshold.** RTMPose imports and reuses MoveNet's `CONFIDENCE_THRESHOLD=0.3`, tuned for MoveNet's heatmap-argmax distribution, not RTMPose's SimCC distribution. | `rtmpose_backend.py:20` (import), `rtmpose_backend.py:162,177` (usage), source `movenet.py:46` | Per-format threshold in the canonicalizer's confidence normalization (§2.2); give RTMPose its own calibrated constant. |
| B5 | **Doc bug: "RTMDet" is actually YOLOX.** rtmlib `Body` loads YOLOX detector weights, not RTMDet. Misleads the next engineer. | `rtmpose_backend.py:1` (docstring), `pose2d.py:4` (comment), `model-benchmark.md:14` | Correct comments/docstrings to "YOLOX detector." No functional change (both Apache-2.0). |

B3, B4, B5 are the near-zero-cost Phase-0 fixes; B1 (dual-rate) and B2 (canonicalizer)
are structural and land in their own phases below.

---

## 4. Phased plan (ordered by leverage-per-cost)

Each phase is independently shippable and E2E-testable. "CPU-now" = ships on the current
onnxruntime/opencv/scipy stack; "GPU-tier" = future only.

### Phase 0 — near-zero-cost wins  ·  CPU-now  ·  highest leverage-per-cost
- **Free bystander exclusion** (§2.3.5): zero-out non-target detection boxes inside the
  crop before refining. `rtmpose_backend.py:147-166`. *Cost:* ~0 (uses a call already
  made). *Gain:* directly attacks the 1–2 residual relay switches.
- **One-Euro / Savitzky-Golay smoothing** (§2.6) on angle scalars. `biomech2d.py:233` /
  `:369-396`. *Cost:* O(1)/kp, no new dep. *Gain:* tighter, less jittery peak metrics.
- **B3 model_meta**, **B4 confidence threshold**, **B5 YOLOX doc**. *Cost:* trivial.
- **`keypoint_format` field** added to the yielded frame dict (unblocks the canonicalizer).
  *Cost:* one field. *Gain:* the down payment on model-agnosticism.
- *Storage/latency:* effectively unchanged.

### Phase 1 — Kalman + cascaded-gate tracker  ·  CPU-now  ·  highest absolute leverage on the core bug
- **crop_tracker.py** (§2.3): Kalman motion prediction + motion/IoU gate + HSV appearance
  tie-break (OSNet-x0.25 ONNX only on ambiguity) + optional cadence-FFT gate; factor the
  ~100 tracking lines out of `rtmpose_backend.py:44-188`. Replaces
  nearest-centroid+EMA (`:60-78`, `:147-160`).
- *Cost:* µs/frame Kalman+histogram; OSNet ~1–2 ms/crop, rare. *Gain:* the tracker OWNS
  identity → drives residual relay switches toward 0; motion-predicted search beats
  isotropic box widening on fast motion/occlusion.

### Phase 2 — canonicalizer + registry + typed Frame2D  ·  CPU-now  ·  unlocks model-agnosticism
- **pose_backend.py registry** (§2.1) replaces `pose2d.py:19-27` if/elif.
- **canonicalize.py + joint_schema extension** (§2.2); move biomech2d off `KP` indices
  (fixes **B2**). Emit typed `Frame2D` with `timestamp_ms`, `keypoint_format`, `bbox`,
  `model_meta`.
- *Cost:* negligible runtime; mostly refactor. *Gain:* backbones become drop-in;
  ends silent wrong-joint reads; hard prerequisite for Phases 4 & 6.
- **Gate:** regression test (§6) — identical output for identical COCO-17 input.

### Phase 3 — dual-rate timing  ·  CPU-now  ·  fixes the honesty gate
- **Dual-rate signal** (§2.5): full-fps ankle-y/foot-velocity → `_gait`; `temporal_fps`
  from the timing signal, not `min(cap_fps,pose_fps)` (fixes **B1**).
- *Cost:* ~0 compute. *Gain:* cadence/contact-time actually reach "trusted" on high-fps
  captures instead of being permanently "experimental."

### Phase 4 — LK-flow keyframe sampling  ·  CPU-now  ·  compute reduction
- **frame_source.py** (§2.4): detector+pose on keyframes, LK between. 3–5× fewer detector
  calls. *Cost:* net reduction. *Gain:* lower per-clip latency; also feeds Phase 3's
  high-rate signal. (Ordered after Phase 3 because Phase 3 defines the timing-signal
  consumer; can be pulled earlier if latency is the priority.)

### Phase 5 — cross-backbone consensus trust  ·  CPU-but-costly  ·  opt-in
- **consensus.py** (§2.8): second backbone via registry; agreement → trust boost feeding
  `biomech2d.py:262-282`. *Cost:* ~2× pose when enabled → opt-in "high-accuracy" mode or
  offline validation only. *Gain:* backend-agnostic per-joint confidence.

### Phase 6 — conditional MobileSAM masking  ·  CPU-viable, conditional
- **mask.py** (§2.7): MobileSAM-in-crop keyframe mask, gated on ≥2 overlapping detections,
  seeded from the brush bbox. *Cost:* ~100s ms/keyframe when triggered; bounded by
  crop-size + keyframe cadence + only-on-overlap. *Gain:* the proven-to-help case
  (bystander pixels inside the box) only.

### Phase 7 — BodyWithFeet (Halpe-26)  ·  CPU-now, gated on Phase 2
- **§2.9**: swap `Body`→`BodyWithFeet` in `rtmpose_backend._load_body` (`:27-42`); real
  heel/toe. *Cost:* ~0 extra compute. *Gain:* better overstride/contact-time.
  **Only after the canonicalizer (Phase 2)** because it changes 17→26 keypoints.

**Future GPU tier (not on the CPU worker):** SAM2/EdgeTAM/EfficientTAM video masks,
WHAM/GVHMR 3D lift (`worker.py:87` `STRIDE_PIPELINE=wham`, `wham_lift.py`), ViTPose. See
§5.

---

## 5. Explicitly rejected / deferred

| Option | Verdict | One-line reason |
|--------|---------|-----------------|
| SAM2 / EdgeTAM / EfficientTAM | Deferred → GPU tier | GPU/PyTorch-only, no mature CPU/ONNX path; fast-motion memory drift on sprint clips. |
| XMem / Cutie / DEVA (VOS propagation) | Deferred → GPU tier | PyTorch, GPU-real-time only; overkill for one known target. |
| YOLOv8 / YOLOv11-seg | Rejected | AGPL-3.0 — commercial closed-source needs a paid Ultralytics Enterprise license. |
| RVM (Robust Video Matting) | Rejected | GPL-3.0 copyleft. |
| EdgeSAM | Rejected | S-Lab License 1.0 — non-commercial research only. |
| RTMO (one-stage) | Rejected for us | Its latency win only appears with multiple people in-frame; we crop to 1, so two-stage keeps its identity-lock advantage. |
| SmoothNet / DeciWatch | Deferred | New model artifact; One-Euro/Savitzky-Golay solves jitter at 15 fps first — only justified if profiling shows residual jitter dominates. |
| CoTracker (point tracking) | Rejected | 14–39° angle error on this exact task (arXiv:2505.04713); no anatomical prior. |
| OpenPose | Rejected | CMU non-commercial license; GPU-heavy. |
| Full first-frame-mask VOS propagation | Rejected | Fast-motion drift onto similar distractors; conditional keyframe re-mask (§2.7) preferred. |
| Apple Vision / MediaPipe Selfie person-seg | Deferred | Merges all people into one mask (no instance separation) and/or iOS-only; doesn't isolate the target among bystanders. |
| MobileSAM always-on | Rejected | Mask helps only under box-overlap; always-on is wasted CPU for the common single-runner case → make it conditional (§2.7). |

---

## 6. Test plan (executable by the Phase-3 testing agents)

Test videos live in `/Users/adhibanarulselvan/Desktop/StrideFinal/Stride-v1/test-videos`.
**Available locally:** `forward_angle_test.mov` (head-on walk, full body) and
`left_angle_test.mov` (indoor, partial body — correctly rejected). **Not present
locally:** the OSS **relay** (3–8 runners) and **side sprint** clips referenced in
`model-benchmark.md:42-51`. **The relay clip must be added to `test-videos/` before the
person-switch tests can run** — flag this as a prerequisite.

**Global regression gate (run for every phase):** full-app smoke path stays green —
upload → analysis completes → suggestions render → calendar populates → coach answers
grounded (see `docs/LOCAL_E2E_RUNBOOK.md`). Any red = phase blocked.

| Component (phase) | Test | Pass/fail criterion |
|---|---|---|
| Free bystander exclusion (P0) | Run 2D path on relay clip, count target-identity switches (method of `model-benchmark.md:47-51`). | Person-switch count **≤ 1** (from current 1–2). **No regression** on single-runner side clip (switch count unchanged; mean frame-to-frame jump ≤ 0.019). |
| One-Euro / SG smoothing (P0) | Compare peak metrics (`knee_drive` p95, `hip_ext` p95, `knee_flex` p5) and per-frame angle jitter (std of first difference) smoothed vs unsmoothed on the clean side clip. | Jitter **reduced ≥ 20%**; peak metrics shift **≤ 2°** (no peak flattening). On a synthetic noisy sine, filtered output tracks truth within tolerance. |
| Bug fixes B3/B4/B5 (P0) | Inspect result JSON + DB row + docstrings after a run with `POSE2D_BACKEND=rtmpose` and again with `movenet`. | `model_meta.backend`/`model_version` **match the backend that ran** (not a hardcoded/MoveNet string); RTMPose uses its own threshold constant; no "RTMDet" left in comments. |
| `keypoint_format` field (P0) | Assert the field is present and correct on every yielded frame. | `keypoint_format == "coco17"` on both current backends. |
| Kalman + cascade tracker (P1) | Relay clip: switches + re-acquisition after a scripted occlusion; fast-motion clip: mean frame-to-frame jump. | Switches **≤ 1**; re-acquires target within **≤ N=10** frames after occlusion; jump **≤ 0.019** (no worse than current). Same-uniform pair: appearance/cadence gate keeps the seeded runner. |
| Canonicalizer no-regression (P2) | Feed identical COCO-17 keypoints through the **new** canonicalizer path and the **legacy** `KP`-index path; diff biomech2d output. | Output **identical within float epsilon** (metrics, flaws, economy). This is the hard gate that proves the refactor is behavior-preserving. |
| Registry (P2) | Toggle `POSE2D_BACKEND` across registered backends. | Each produces valid `Frame2D` frames; unknown backend fails loudly, not silently to MoveNet. |
| Dual-rate timing (P3) | Run on a **120/240 fps** capture (real or frame-duplicated synthetic) and a 30 fps capture. | On high-fps: `cadence_spm`/`contact_time_ms` `trustStatus == "trusted"` (currently always "experimental"). On 30 fps: still "experimental" (honest). Angle metrics unchanged. |
| LK-flow sampling (P4) | Compare detector-call count and joint-angle output with LK on vs off on the side clip. | Detector calls **≥ 3× fewer**; angle metrics within **≤ 2°** of the every-frame baseline; per-clip latency reduced. |
| Cross-backbone consensus (P5) | Two backbones on the clean clip; measure canonical-space agreement and the resulting trust flags. | Agreeing joints flagged high-trust; disagreement (e.g. head-on ambiguity) lowers trust. Consensus mode adds **≤ ~1×** pose latency and is opt-in (default path unchanged). |
| Conditional MobileSAM (P6) | Relay clip (overlap) vs single-runner clip (no overlap); check mask invocation + latency + switches. | Mask invoked **only** when ≥2 detections overlap the box; **not** invoked on the single-runner clip; added latency **≤ 300 ms/keyframe**; relay switches **≤ 0** with mask on. |
| BodyWithFeet (P7) | Swap to Halpe-26; verify heel/toe populated and canonicalized. | 26 keypoints mapped to canonical names correctly; contact-time localization improved vs ankle-proxy; **no** biomech2d regression (canonicalizer absorbs the topology change). |

**Latency budget (all CPU phases combined):** per-clip added latency vs today's baseline
**≤ 20%** on the side clip (P0–P4 should be net-neutral-to-negative thanks to LK; P5/P6
are opt-in/conditional and excluded from the default-path budget).

---

## Executive summary

**Target architecture:** insert the missing middle layer so the pipeline becomes
`video → LK-sampled frames → a dedicated crop_tracker that OWNS identity (Kalman
motion-prediction + a cascaded motion→appearance→cadence gate, with free bystander
exclusion from detections we already compute) → pose backend (Protocol + registry) →
per-backend canonicalizer emitting a typed Frame2D in canonical joint names → One-Euro
smoothing + a dual-rate full-fps timing signal → biomech2d → unchanged AnalysisResult`.
This makes the system model-agnostic (any backbone is a registered module whose
canonicalizer maps it to fixed canonical joints, ending the `biomech2d` COCO-17
hardcoding) and single-target-focused (a real tracker with a motion model and appearance
gate replaces "nearest to crop centre"), while nearly everything runs on the existing
CPU/onnxruntime/opencv/scipy stack — only SAM2-class video masks and the 3D lift are
honestly quarantined to a future GPU tier.

**Phase ordering (leverage-per-cost):** P0 near-zero wins (free bystander exclusion,
One-Euro smoothing, bug fixes B3/B4/B5, `keypoint_format`) → P1 Kalman+cascade tracker →
P2 canonicalizer+registry (fixes B2) → P3 dual-rate timing (fixes B1) → P4 LK-flow
sampling → P5 cross-backbone consensus (opt-in) → P6 conditional MobileSAM → P7
BodyWithFeet.

**Single highest-leverage change:** give a dedicated `crop_tracker.py` **ownership of
identity** — Kalman motion-prediction + a cascaded motion→appearance gate replacing the
`_select_person` nearest-centroid heuristic — because identity switching onto bystanders
is the core stated failure. Its **zero-cost down payment, shippable today**, is the free
bystander exclusion in Phase 0 (zero-out the non-target detections `body(crop)` already
returns), which attacks the exact residual-switch case with no new model and no added
latency.

**Doc path:** `docs/research/ml-architecture-orchestration.md`

---

## 7. Implementation status

### Phase 0 — ✅ IMPLEMENTED & VERIFIED (in-process + full-app E2E)

The baseline (`docs/benchmarks/pipeline-baseline.md`) reframed the priority: with the
brush-bbox seed the crop-tracker already scores **0 identity-switches** on every real
clip, so the worst *measured* problems were the biomechanics **honesty layer**, not
tracking. P0 was therefore sequenced as **biomech honesty first, then a guard**.

Shipped:
- **Honesty gate** (`biomech2d.py`): a metric may raise an authoritative flaw only when
  **trusted AND physically plausible** (new `PLAUSIBLE` envelope); an implausible value
  demotes its own trust to `experimental`. This kills the clamp-ceiling false flaws
  (overstride 40 / vert-osc 25 every clip), the impossible-at-15 fps temporal flaws, and
  the "trusted badge on trunk 72° / arm 163°" cases — while a real trusted-angle flaw
  (e.g. "Low knee drive" on a side-on clip) still fires.
- **Smoothing** (`biomech2d._savgol`): 5-tap Savitzky-Golay on angle series before peak
  percentiles (scipy, no new dep), de-jittering peaks without flattening them.
- **Static-subject guard** (`biomech2d.py`): `subjectMotion`/`movingSubject` from vertical
  ankle travel; a locked static bystander raises **no** flaws + an honest nudge. Floor
  0.25·leg-length; real clips read 0.86–6.79 (no false positives).
- **B3** (`worker.py` + `api/.../internal.ts`): backend-derived `model_meta` threaded into
  `result_json`; API persists it. DB now stores `movenet_version = "rtmpose-lightweight"`
  (was the hardcoded MoveNet `"Thunder"`).
- **B4** (`rtmpose_backend.py`): RTMPose gets its own SimCC-calibrated `_CONF_THRESHOLD`
  (env `RTMPOSE_CONFIDENCE_THRESHOLD`), not MoveNet's.
- **B5** (`rtmpose_backend.py`): docstrings/log corrected "RTMDet" → "YOLOX".

E2E verification (`docs/benchmarks/app-e2e-baseline.md`, "Re-run 2"): both a clean side-on
clip and an oblique crowd clip complete (~8 s), B3 values confirmed at the DB level,
honest gating confirmed in `result_json`, side-on → 1 trusted flaw → 1 suggestion,
oblique crowd → 0 flaws (honest refusal + "film from the side" nudge).

**Deferred from P0 (not yet done):** `keypoint_format` field + the free bystander-exclusion
re-run (folded into P1/P2 since the seeded crop path already gets 0 switches). Crop-select
consistency left untouched on purpose — it is a working path; the real replacement is the
P1 Kalman/cascade tracker.

### Accuracy work — trunk_lean / arm_swing (partially addressed + key discovery)
- **Discovery:** the only clean side-on clip, `IMG_0274.MOV`, is a **sprint block-START**,
  not steady running — the athlete kneels in, holds a bent "set" pose with straight bracing
  arms for many frames, drives out, and **leaves the frame** ~60% through. So the
  "trunk_lean 72° / arm 163°" were largely the pipeline *correctly* capturing the set pose,
  averaged across set + drive + athlete-absent frames with a non-robust **mean**.
- **Fixed (robust aggregation):** `trunk_lean` and `arm_swing` now use **median**, not mean
  (`biomech2d.py` values dict). Effect: trunk_lean 72°→45° (a plausible drive-phase lean),
  more stable across clips. `arm_swing` stays ~171° — because the arm genuinely reads
  straight on this block-start clip (set-position bracing), which median correctly reflects.
- **Still open — needs a proper clip:** validating/tuning steady-state trunk & arm, and
  adding **drive/run phase-windowing** (compute angle metrics on the dynamic running frames,
  not the static set-hold or athlete-absent frames), requires a clean **single side-on
  STEADY-RUNNING** clip. Tuning against a block start risks harming the normal running case.
- **Temporal metrics** still need P3 dual-rate (B1); **P2 canonicalizer/registry** remains.

### Phase 1 — ✅ IMPLEMENTED & VERIFIED (single-target tracker)

`crop_tracker.py` (NEW) gives a dedicated **CropTracker** ownership of athlete identity,
replacing the old "detection nearest the crop centre + EMA box" heuristic in
`rtmpose_backend.iter_frames` (which switched onto bystanders in multi-person /
staggered sprint-start clips). It combines, CPU-cheaply and backend-agnostically:
- **Kalman** constant-velocity motion model on the bbox → the search region is
  *predicted*, not widened isotropically from a stale box;
- **HSV torso colour-histogram** appearance gate → a geometrically-close but
  different-looking bystander is rejected;
- a permanent **appearance anchor** (first-lock histogram, never EMA'd) → identity
  can't creep frame-by-frame onto edge noise once the runner leaves frame;
- **velocity damping on loss** + **appearance-gated re-acquisition** → lost frames are
  *excluded*, not latched onto noise;
- a **cascaded gate**: motion first, appearance to break ties, confidence last.

Verified in-process (`track_verify`): **staggered sprint-start pair → 0 identity-switches**
(the exact case the old logic failed), single clip → **0** (no regression; the athlete-left
tail is now excluded rather than drifted onto), crowd/multi clips 1–2 switches over
260+/57 frames with more off-target garbage correctly rejected. Verified E2E
(`app-e2e-baseline.md`, "Re-run 3"): both clips complete ~8 s (no latency cost), seeds
honored, worker log clean (no drift/switch/crash), B3 + honesty gate unchanged, single
clip still yields trusted angles + 2 suggestions.

**Nice-to-have (deferred):** the tracker emits no per-frame telemetry, so production
"no-switch" is inferred from the clean single-skeleton overlay rather than logged — a debug
counter (gate rejections / appearance tie-breaks / re-acquisitions) would make it directly
observable.

### Phase 2 — ✅ IMPLEMENTED & VERIFIED (model-agnostic seam)

The 2D pipeline is now genuinely backbone-agnostic, fixing bug **B2** (biomech2d used to
index a hardcoded COCO-17 map, so a backbone swap would silently read the wrong joint):

- **`canonical_2d.py` (NEW)** — a fixed canonical joint schema (COCO-17) accessed BY NAME,
  plus `to_canonical(kpts, keypoint_format)` mapping any native layout onto it. Ships maps
  for `coco17` (identity), `halpe26` (first-17), and `blazepose33`; unknown formats **raise
  loudly** instead of mis-indexing.
- **`pose_backend.py` (NEW)** — a name→module **registry** replacing `pose2d.py`'s if/elif;
  each backend declares `KEYPOINT_FORMAT`. Adding ViTPose/BlazePose/BodyWithFeet is now
  "register a module."
- **`pose2d.py`** canonicalizes every frame at the seam (attaching `keypoint_format`), so
  biomech + the tracker always receive canonical joints regardless of backbone.
- **`biomech2d.py`** now imports `CANON_KP` from the canonical schema instead of the
  backbone's raw indices. `model_meta.keypointFormat` records the canonical layout.

**Verified:** the **regression gate is byte-identical** — biomech2d produces exactly the
same metrics/flaws/economy on real clips before vs after the refactor (COCO-17 canonical =
what the backbones already emit). Unit checks confirm the non-COCO maps (blazepose33
`left_hip` correctly sourced from native index 23), loud failure on unknown formats, and the
registry. This unblocks **P7 BodyWithFeet** (Halpe-26 real heel/toe) — now a safe swap.

### Sprint-start awareness — ✅ IMPLEMENTED & VERIFIED

The test footage is sprint-start practice, and the metric norms were tuned for upright
max-velocity running — so a correct ~45° drive lean was being judged against the upright
8–22° range. Fixed in `biomech2d.py`:
- **Posture-based phase detection** replaces the old azimuth-based misnomer: a *moving*
  athlete with a high median trunk lean (≥ `ACCEL_LEAN_THRESH` = 28°) → `acceleration`; a low
  lean → `max_velocity`; a non-moving subject → `static`. (`result.phase` now means the
  running phase, not the camera angle.)
- **Phase-specific norms** (`PHASE_NORMAL_RANGE` / `PHASE_PLAUSIBLE`): in `acceleration`,
  trunk_lean is judged against 35–55° (plausible 12–75°) instead of the upright 8–22°.
  Applied consistently to the metric band, flaw test, evidence, and economy.

**Verified:** on the side-on block-start clip, phase is detected as `acceleration` and the
40.5° drive lean is now `trusted` and **in-range (no false flaw)** — previously it was
demoted to `experimental` as "implausible." Upright/static clips keep the upright norms
(no regression). Scoped to `trunk_lean` (the clearly phase-sensitive metric); knee_drive /
hip_extension acceleration-phase norms are a future refinement (need sprint-accel reference
values rather than guesses).

### Phase 3 — ✅ IMPLEMENTED & VERIFIED (dual-rate timing, fixes B1)

B1: `FPS_TRUST_GATE = 120` but `temporal_fps = min(cap_fps, pose_fps=15)`, so cadence /
contact-time were **always** "experimental" even on a 240fps capture. Fixed with a dual-rate
signal — timing decoupled from the (sparse) pose sampling:
- **`rtmpose_backend.iter_frames(timing_out=...)`** carries the two ankle heights at **FULL
  source fps** by **Lucas-Kanade optical flow** (`cv2.calcOpticalFlowPyrLK`) between pose
  keyframes, re-anchored from the pose each keyframe. **Opt-in**: when `timing_out is None`
  (all non-worker callers, tests) the pose path does zero extra work and is unchanged.
- **`biomech2d._gait_signal`** detects footstrikes / contact runs from that full-fps signal
  with an **fps-scaled** smoothing window + refractory, and `_assemble` sets
  `temporal_fps = timing_fps` (source fps) instead of `min(cap_fps, pose_fps)`.
- Threaded through `pose2d.stream_frames` → `worker._run_2d` (passes `timing_fps=source_fps`).

**Verified:** on a real 30fps clip the signal is populated full-fps (192 timing samples vs 82
pose frames); on a **clean synthetic 120fps** foot signal `_gait_signal` returns contact
**107 ms** / cadence **273 spm** and the full pipeline marks both **`trusted`** — the gate now
*clears* (was categorically impossible before). At 30fps, temporal stays honestly
`experimental` (30 < 120). Default (no-timing) path is byte-unchanged. **Known limit:** on a
block-start clip the static set-hold inflates the raw contact-run (the value is
`experimental`/hidden anyway); a real high-fps *running* clip is the payoff case.
