# Angle-Agnostic Runner Kinematics — Research Recommendation

> Recovering the kinematics runners need from a **single uncalibrated phone at any angle**,
> with **minimal GPU** and **kilobytes per athlete**.
>
> Synthesized by a 19-agent research workflow (3 groups × 4 specialists → 3 group leads →
> 2 orchestrators → adversarial critic → chief synthesizer; 336 live searches, 0 errors).
> A richer, navigable version of this report is published as a Claude artifact.

## TL;DR — "Stride-GV"

A **phone-first evolution of the existing Stage 1–7 pipeline**, not a rewrite. Both
independent orchestrators converged on the same stack, so the architecture is
high-confidence; the remaining work is honest calibration.

The two ideas that carry it:

1. **Anchor to gravity, don't infer "up."** `stage4_canonicalize.ts` builds its body frame
   from `WORLD_UP=[0,1,0]` + a hip-width lateral axis — ill-conditioned exactly where the app
   already demotes to `experimental` (near head-on, apparent hip width → 0). Feed the phone
   accelerometer+gyro **gravity vector** into the *lift itself*. Feeding the gyro also deletes
   visual-odometry SLAM — the single biggest minimal-GPU win.
2. **Trust by variable _type_, not by azimuth.** Replace the blanket `sin²(azimuth)` penalty in
   `stage6_confidence.ts` with per-variable trust. Timing/CoM metrics are recoverable from any
   angle (gated on frame rate); sagittal angles stay best side-on; frontal injury metrics are
   best from the rear. Spend the expensive true-3D budget only where the view matters.

**This is partial, not total, invariance** — no method can manufacture the sagittal depth a
true head-on view never captured.

## Architecture → Stride file mapping

| Stage | Change | File(s) | GPU |
|------|--------|---------|-----|
| 0–1 | Add accelerometer to manifest; gyro+accel gravity fusion (complementary/Kalman, **not** low-pass); deprecate hip-width azimuth heuristic | `capture/types.ts`, `stage1_pipeline.ts` | on-device |
| 2 | Replace weak-perspective `depthScale=2.2/hipW` with a learned lifter trained with **360° rotation augmentation + athletic fine-tune**, fed the gravity vector; extend `integratedYaw` beyond `g.wy`; keep CPU lift as fallback | `stage2_monocular_lift.ts` | phone NPU / short burst |
| 4 | `bodyBasis` becomes the fallback; primary is a learned Gravity-View canonicalizer (6D→SO(3)) emitting per-joint uncertainty. A/B on the running set | `stage4_canonicalize.ts` | ms on NPU |
| 5a | Closed-form twist-swing IK → biomechanical joint angles; optional anatomical joint limits as a free trust prior; per-metric bias offsets (hip flex/ext ~15°) | `stage5_metrics.ts` | ≈ free |
| 5b | Three-tier metrics; Tier-1 from foot-velocity zero-crossings + gravity vertical CoM (extend `detectStances`); **rebin** braking index / stride length / horizontal speed out of angle-robust | `stage5_metrics.ts` | negligible |
| 6 | Type-weighted, frame-rate-gated, event-conditioned, self-signal trust; widen `MetricPlane` beyond `{sagittal,temporal}` | `stage6_confidence.ts` | a few denoising steps |
| 7 | Single-nudge UX sourced from new trust; commit compact per-athlete storage | `stage7_capture.ts` | none |
| Premium (opt) | GVHMR gravity-view lift **fed the phone IMU instead of SLAM**, behind the unchanged `.frames3d.json` contract | `stage23_lift_fit.ts`, `ml-worker/wham_lift.py` | single-GPU, ~tens of s/clip |

## Metrics & trust tiers

- **Tier 1 — angle-robust** (any angle, gated on **frame rate**): cadence, contact time, duty
  factor, step time, L/R symmetry, k_vert/k_leg stiffness, vertical CoM oscillation *(candidate)*.
  Flight time included but flagged lowest-trust temporal (CV 16–23%).
- **Tier 2 — sagittal** (best side-on, degraded-not-zeroed off-axis, sprint-prioritized): trunk
  lean, thigh separation, hip extension (+~15° offset), knee drive, stance knee flexion.
- **Tier 3 — frontal injury** (best rear/head-on, **descriptive**, wide bands): peak hip
  adduction, contralateral pelvic drop, rearfoot eversion, lateral trunk lean.
- **Rebinned out** (view/translation-dependent): braking index, stride length, horizontal speed.
- **Experimental regardless of angle:** GRF proxies, absolute transverse rotations, foot-strike.

## Budget

- **GPU:** core path is entirely on-device (zero cloud). Heavy methods (TRAM, per-clip SMPLify,
  IMU+video fusion, NeRF) are **hard-quarantined to offline pseudo-GT generation**, never the
  upload path. Premium is a single-GPU burst; distilling ViT-H → NLF is the open lever to make
  it a true few-second burst.
- **Storage:** per session ≈ gait-cycle-normalized joint-angle curves (~8–12 × 101 samples) +
  ~20-scalar metric vector, each trust-tagged — a few KB to low-tens of KB. Per athlete: one
  10-float SMPL/SKEL shape-β. **Never raw video or meshes.**

## Phased build plan

- **Phase 0 (gate, L):** accelerometer + gravity fusion; build an internal running validation
  set (side/oblique/head-on/rear/elevated); **measure** per-metric error by azimuth, gyro drift
  vs SLAM over 10–30 s, and gravity-vector error under panning. These gate every promise.
- **Phase 1 (M):** gravity vector → world-up; rotation aug + athletic fine-tune; rebuild Stage 6
  trust; add Tier-1 metrics + fix binning. Zero new models, highest ROI.
- **Phase 2 (M):** 3DPCNet candidate (fallback retained, A/B); HybrIK IK + offsets; DPoser/Pose-NDF
  gait prior; Tier-3 descriptive metrics; compact storage contract.
- **Phase 3 (L):** GVHMR-fed-by-IMU premium tier; distill ViT-H backbone; optional PhysPT head.
- **Phase 4 (M):** calibrate trust thresholds on running data; A/B canonicalizers on rotated/rear
  captures; measure vertical-CoM off-axis error before promoting it to a headline metric.

## Honesty ledger (adversarial corrections — read before building)

1. **Nothing is validated on high-speed running** — every cited number is walking/ADL/in-the-wild.
   The Phase-0 running set is a hard prerequisite.
2. **Gyro deletes rotation, not translation** — stride length/speed/braking index need world
   translation the phone IMU can't supply.
3. **Head-on sagittal depth is physically unrecoverable** — augmentation only makes off-axis inputs
   in-distribution.
4. **"Any angle" is really "any angle at 120–240 fps"** — 30 fps (most uploads) gives ±33 ms on
   ~90 ms contacts.
5. **Gravity extraction under handheld panning is unvalidated** — measure fusion residual in Phase 0.
6. **Premium latency is ~tens of seconds**, not "a few" — ~46 s of ViT-H preprocessing survives the
   SLAM deletion until the backbone is distilled.
7. **3DPCNet is a candidate, not a keystone** — 2025 preprint, daily-activity, azimuth not varied.
8. **Velocity-derived metrics stay weakly correlated (0.12–0.47)** — Tier-1 trust must stay conservative.
9. **Vertical CoM oscillation off-axis error is unmeasured** — keep it a candidate until Phase 4.
10. **Frontal recovery has no supporting citation on runners** — Tier-3 ships descriptively.
11. **Hip flex/ext carries a systematic ~15° offset** — near-uninformative without calibration.
12. **GRF is qualitative and not running-validated** — experimental low-trust only.
13. **On-device NLF/CameraHMR latency is unpublished** — verify phone-NPU feasibility first.

## Key sources

GVHMR (SIGGRAPH Asia 2024, arXiv:2409.06662) · NLF (NeurIPS 2024, arXiv:2407.07532) ·
CameraHMR (3DV 2025, arXiv:2411.08128) · HybrIK-X (TPAMI 2025, arXiv:2304.05690) ·
WHAM (CVPR 2024, arXiv:2312.07531) · MotionAGFormer (WACV 2024, arXiv:2310.16288) ·
AthletePose3D (arXiv:2503.07499) · BioPose (arXiv:2501.07800) · SKEL/HSMR (CVPR 2025,
arXiv:2503.21751) · PhysPT (CVPR 2024, arXiv:2404.04430) · DPoser (arXiv:2312.05541) /
Pose-NDF (ECCV 2022) · 3DPCNet (arXiv:2509.23455, unverified) · IMU+phone-video knee
(arXiv:2405.17368, walking) · Markerless running gait, single smartphone (Sensors 2023,
PMC9866353) · running economy & stiffness (Liu 2022; van Hooren 2024).
