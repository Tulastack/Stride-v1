# Stride ML Benchmark — Pipeline vs. Other Systems

> Honest assessment of Stride's current pose→biomechanics pipeline against alternative
> systems and on the available test videos. Measured values come from actual runs in
> this repo's `apps/ml-worker` (RTMDet+RTMPose, ONNX/CPU, `RTMPOSE_MODE=lightweight`).
> **Caveat up front:** we have **no motion-capture ground truth** for running, so this
> is *not* a validated accuracy study. It reports (a) published accuracy for the methods
> we build on, (b) measured tracking robustness, and (c) plausibility/consistency on real
> clips. Treat angle numbers as "consistent and literature-plausible," not "clinically
> validated." A mocap validation set is the honest next step (research plan Phase 0).

## 1. What Stride runs today

`RTMDet person detector → RTMPose (COCO-17) → crop-to-target tracking → 2D sagittal
biomechanics (biomech2d) → type-weighted, frame-rate-gated trust`. No 3D lift on the
upload path (the CPU 3D fallback was degenerate). Entirely CPU/ONNX, no cloud.

## 2. System comparison (published numbers)

| System | 2D keypoint acc. | Sagittal joint-angle acc. | Angle-robust? | On-device / cost | Notes |
|---|---|---|---|---|---|
| **MoveNet Thunder** (was Stride's backbone) | COCO AP ~70; **no person detector** | n/a | no | edge model | **Failed on our real side clip: 0/488 usable frames** (single-pose, small/off-centre subject) |
| **RTMPose-m/-t** (Stride now) | COCO AP **75.8** (m); real-time on CPU | inherits 2D error | via crop-track | CPU/ONNX, ~15–35 fps CPU | + RTMDet detector → survives small/off-centre subjects |
| **VideoRun2D** (closest analog) | — | **3.2–5.5° (trunk/hip/knee), sprint** | **only ⟂ side view, 100 fps** | single cam | The method Stride's 2D path mirrors |
| **OpenCap (monocular)** | — | **4.8° rotational** | prescribes **45° camera**; walking/squat only; **no sprint, no jumping** | phone→cloud | out-of-distribution for sprint |
| **WHAM** (3D) | — | 57.8 mm MPJPE (3DPW) | assumes full body in frame; AMASS-trained | **GPU** | sprint is out-of-distribution |
| **Ochy** (competitor) | — | claims **~2.5° back-view** | guided side+back capture | app+cloud | federation-backed; guided, not "any angle" |
| **Clinical thresholds** | — | **<2° ideal; 2–5° needs interpretation; >10° unreliable** | — | — | the bar to judge against |

**Takeaways:** (1) swapping MoveNet→RTMPose+detector was the single biggest correctness
win — MoveNet literally produced 0 usable frames on a real side clip. (2) Our sagittal-
angle *ceiling* is the VideoRun2D regime (~3–5°) **and only side-on**; head-on sagittal
depth is physically unrecoverable (no system recovers it). (3) "Any angle" is not a
defensible claim vs. Ochy/OpenCap — "side/oblique-tolerant, honest per-metric trust" is.

## 3. Measured on the test videos

| Clip | Content | MoveNet usable | RTMPose usable / conf | Verdict |
|---|---|---|---|---|
| `left_angle_test.mov` | **indoor, partial body** (not a sprint) | **0 / 488** | still low (half body out of frame) | correctly rejected — invalid capture |
| `forward_angle_test.mov` | indoor walk toward camera, full body | 318/538 (after letterbox fix) | ~0.64 conf | processes; head-on → sagittal untrusted |
| OSS sprint clip (Kambundji, side/oblique) | real elite sprinter | — | **0.74 conf** | hip-ext 165°, trunk 26° — physiologically plausible |
| OSS relay (3–8 runners) | multi-person | — | 0.58 conf | used for the tracking benchmark below |

### Tracking robustness (multi-person relay, measured)

| Strategy | person-switches | mean frame-to-frame jump |
|---|---|---|
| Old: argmax highest-confidence **every frame** | **53** | 0.087 |
| Lock-and-follow (centroid) | 4 | 0.024 |
| **Crop-to-target (current)** | **1–2** | **0.019** |

The old code switched runners 53× across the clip — this is the "keypoints jump between
people" bug. Crop-to-target (run pose only inside the tracked person's box) cuts it to
1–2 and isolates the athlete from bystanders. Distinct seeds/brush strokes lock onto
distinct runners.

## 4. Per-metric honesty (trust tiers)

| Metric | Tier | Trustworthy when | Assessment |
|---|---|---|---|
| trunk lean, knee drive, hip extension, knee flexion, arm swing | 2 sagittal | side-on (azimuth ≲30°), conf ≥0.6 | literature-plausible (VideoRun2D ~3–5°); **experimental off-axis** |
| cadence, contact time | 1 temporal | **≥120 fps** | **experimental on 30 fps uploads** (±33 ms on ~90 ms contacts) |
| vertical oscillation | 1 (candidate) | side-on, stable scale | off-axis error unmeasured → kept experimental |
| overstride | 3 rebinned | — | translation-dependent → descriptive only, never "trusted" |

Nothing is emitted as "trusted" unless the tier's conditions hold — the app labels the
rest `experimental` rather than faking confidence.

## 5. Honest limitations

1. **No mocap ground truth** — angle accuracy is inferred from the method (VideoRun2D),
   not measured on Stride. A 5-viewpoint running validation set is the real gate.
2. **Temporal metrics need 120–240 fps** — most phone uploads are 30–60 fps; contact
   time / cadence are honestly experimental there.
3. **Head-on = no sagittal depth** — augmentation/tracking can't manufacture it.
4. **Crop-track still imperfect in dense clusters** (relay: 1–2 residual switches) — a
   true segmentation mask (SAM-style) would isolate further, at extra compute.
5. **CPU latency** — lightweight RTMPose keeps a short clip to ~10–35 s on CPU; a GPU/NPU
   path (research plan Phase 3) is required for the premium 3D tier.

## 6. Where Stride wins / where it doesn't

- **Wins:** handheld side/oblique capture with a **person detector + crop-track** (robust
  to small/off-centre/multi-person), **honest per-metric trust**, on-device/CPU, no cloud.
- **Loses (today):** clinically-validated angle accuracy, true angle-agnosticism, and
  reliable temporal metrics at low fps — all gated on the Phase-0 validation set and the
  3D/IMU-gravity work.
