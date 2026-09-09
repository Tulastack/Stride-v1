# Analysis latency, end to end

> Measured 2026-09-08 on the dev Mac (11 cores, CPU onnxruntime) against the real
> clips in `test-videos/`, through the **live stack**: API + Postgres + the ML
> worker on `STRIDE_PIPELINE=3d-geo POSE2D_BACKEND=rtmpose RTMPOSE_MODE=lightweight
> POSE_FPS=15`, which is what `scripts/dev-up.sh` starts. Reproduce with
> `python -m scripts.e2e_latency --all` from `apps/ml-worker`.

The product promises an analysis in about 20 seconds. This is where that number
actually came from, what broke it, and what it costs now.

## The complaint

Analyses "took forever" and the app sat on the loading screen. The database
agreed: recent rows included analyses that took **301 s** and **728 s**, and two
that were failed by the sweeper as `analysis_timeout` after **30 minutes**.

`analysis_timeout` is set on rows that sat in `pending` for 30 minutes, which
means no worker ever claimed them. That is the whole shape of the bug:

1. Analysis cost scales with clip length. The Analyze screen lets the athlete
   pick any video out of their library, and `MAX_ANALYSIS_SECONDS` was 120, so a
   long 4K clip could run for minutes.
2. The worker processes one job at a time, synchronously (`_start_local_worker`
   calls `_process_local` inline).
3. So everything queued behind a slow clip waited, and anything waiting past 30
   minutes was failed by `sweepStuckAnalyses`.

The athlete sees a spinner, then "Timed out waiting for analysis". Nothing in
the ML was broken; the work was simply unbounded.

## Where the time goes

`scripts/time_pose_loop.py`, IMG_0271 (1280x720, 22.5 s), pose sampled at 15 fps:

| stage | seconds | share |
|---|---|---|
| YOLOX + RTMPose inference | 32.40 | 93.9% |
| decode (674 frames) | 1.41 | 4.1% |
| optical flow (timing signal) | 0.42 | 1.2% |
| BGR2GRAY | 0.15 | 0.4% |
| downscale | 0.10 | 0.3% |

Inference is everything. `scripts/time_inference.py` splits one call
(measured with nothing else running, which matters, a background job inflates
these by ~2x):

| | ms/frame | share |
|---|---|---|
| YOLOX detector | 33-37 | ~60% |
| RTMPose keypoints | 13 per person | ~40% |
| **one sampled frame** | **46-61** | |

So **latency ≈ frames sampled × ~55 ms**, and frames sampled = seconds analysed
× `POSE_FPS`. That is the entire cost model:

| seconds analysed | pose calls | analysis |
|---|---|---|
| 12 | 180 | 13-17 s |
| 22 | 337 | 30 s |
| 45 (4K) | 675 | 50 s |
| 120 (the old cap) | 1800 | minutes |

## The fix

`MAX_ANALYSIS_SECONDS` 120 → **12**, with a hard ceiling of 1.5× that many
sampled frames (`LEAD_IN_ALLOWANCE`) so a clip where the athlete is never
confidently detected cannot run to its own end hunting for usable frames.

12 s is not an arbitrary trim: it is exactly what the in-app camera records
(`recordAsync({ maxDuration: 12 })`), so **every clip filmed in Stride is
analysed in full and nothing about that path changes**. It is also many strides,
and the metrics are medians of per-stride peaks.

When a clip is longer than the window, `captureQuality.analyzedWindow` records
which stretch the numbers came from and `primaryNudge` says so, because the
results screen renders that field and silence would leave an athlete who filmed
a whole 400 m unable to tell that the numbers describe part of it.

## End to end, before and after

`queued` is pending → claimed (the worker's 2 s poll). `analysis` is claimed →
terminal. `total` includes the upload.

| clip | MB | before | after |
|---|---|---|---|
| IMG_0271.MOV (22.5 s) | 30.7 | 30.5 s | **17.8 s** |
| IMG_0274.MOV (7.4 s) | 14.5 | 12.1 s | 12.5 s |
| IMG_8263.MOV (7.2 s) | 14.8 | 9.9 s | 9.8 s |
| IMG_8264.MOV (6.1 s) | 12.5 | 14.7 s | 13.7 s |
| IMG_8266.MOV (5.2 s) | 10.8 | 11.5 s | 11.4 s |
| IMG_8267.MOV (5.9 s) | 12.2 | 8.3 s | 7.6 s |
| IMG_8269.MOV (5.8 s) | 12.1 | 12.1 s | 9.7 s |
| forward_angle_test.mov (17.9 s) | 6.1 | 18.7 s | 16.2 s |
| left_angle_test.mov (16.3 s) | 5.7 | 15.8 s | 14.0 s (fails: low_confidence_video) |
| 4K 45 s stress clip | 248.5 | 49.6 s | **20.2 s** |

Worst case is now 20.2 s, on a deliberately adversarial input (a 45 s 4K clip,
which the in-app camera cannot produce). Every real clip lands between 7.6 s and
17.8 s.

The stress clip is generated, not committed:
`python -m scripts.make_stress_clip --src IMG_0274.MOV --seconds 45 --height 2160`.

## Nothing that fitted the window moved

Same clips, same code, cap 120 vs cap 12, comparing every measured metric:

| clip | pose frames | metrics |
|---|---|---|
| IMG_0274, IMG_8263, IMG_8264, IMG_8266, IMG_8267, IMG_8269, forward_angle_test | 13-91 | **identical** |
| IMG_0271 | 333 | changed (clip truncated, as intended) |
| 4K stress clip | 108 of 675 | changed (clip truncated, as intended) |

Every clip that fits inside the window produces bit-identical numbers, which is
what it means for this to be a latency change and not a measurement change.

## What was tried and rejected

**Running YOLOX every N sampled frames** (reusing a box derived from the previous
frame's keypoints between detections). It works and it is fast: 2.6-3.1x quicker
pose extraction, no dropped frames, 0.89 px mean keypoint displacement on
IMG_0271.

It was reverted, because those sub-pixel keypoint changes came out the far end
as **20°+ swings in the reported joint angles** (knee_drive 51.9° → 28.5°,
overstride 83.8 → 11.2, and four `economyScore`s moved by 10-90 points). Two
consecutive runs of identical code produce identical numbers, so that is not
noise: the geometric 3D lift amplifies tiny 2D perturbations enormously.

That is worth knowing on its own. **The lift's conditioning, not the detector,
is the thing standing between this pipeline and a faster one**, and it is a
robustness question about the numbers the athlete is shown, not only a speed
one. Until it is understood, treat the 2D keypoints as an input that must not be
perturbed, and find latency elsewhere.

## Still open

- **The worker is single-threaded.** Bounding each job means the queue drains
  predictably now, but two athletes analysing at once still serialise. The 30
  minute `pending` sweep is a long way above a ~20 s job.
- **`lift_sequence` is the second-largest cost** (0.7-7.6 s, and it varies a lot
  by clip) and it is not bounded by the frame cap in the same direct way.
- **Latency here is a dev Mac on CPU.** A deployed CPU worker will differ; these
  numbers are the shape of the cost, not a production SLA.
