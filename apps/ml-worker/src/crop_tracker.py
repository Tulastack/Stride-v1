"""Single-target crop tracker — owns athlete identity across frames.

Replaces the old "run pose on the crop, keep the detection nearest the crop
centre, EMA the box" heuristic (`rtmpose_backend`), which switched onto
bystanders in multi-person / staggered sprint-start clips and could latch a
standing figure. Instead the target is tracked with:

  1. a MOTION model — a constant-velocity Kalman filter on the bbox, so the
     search region is *predicted* from where the athlete is going (not widened
     isotropically from a stale box);
  2. an APPEARANCE gate — an HSV colour histogram of the athlete's torso, so a
     different-looking person nearby is rejected even if geometrically close;
  3. a CASCADED selection — position first, appearance to break ties, confidence
     last; a candidate that is BOTH far from the prediction AND dissimilar in
     appearance is refused (counts as a miss) rather than accepted as a switch.

Pure numpy/cv2, CPU-cheap (Kalman + a small histogram per detection), and
backend-agnostic: it consumes only keypoints/scores + the crop pixels, so any
pose backbone can plug in. All boxes/points are normalized to the full frame.
"""

from __future__ import annotations

import cv2
import numpy as np

# Torso keypoints (COCO-17) give a stable centroid + appearance region.
_TORSO = [5, 6, 11, 12]
# A candidate must be within this normalized distance of the Kalman prediction
# OR appearance-consistent; being BOTH far and dissimilar → treated as a miss.
_MOTION_GATE = 0.22
_APP_GATE = 0.45          # 1 - histogram-correlation above this = "looks different"
_SEED_GATE = 0.28         # first lock: how near the seed box the athlete must be
_ANCHOR_GATE = 0.60       # never adopt a target that looks nothing like the first lock


def _torso_centroid_norm(xy: np.ndarray, origin, frame_wh) -> tuple[float, float]:
    """Torso centroid of a crop-local detection → normalized full-frame (x, y)."""
    (ox, oy) = origin
    (W, H) = frame_wh
    tx = float(np.mean(xy[_TORSO, 0]))
    ty = float(np.mean(xy[_TORSO, 1]))
    return ((ox + tx) / W, (oy + ty) / H)


def _kp_bbox_px(xy: np.ndarray, sc: np.ndarray, cw: int, ch: int):
    """Pixel bbox (in crop coords) around a detection's confident keypoints."""
    good = sc > 0.3
    if int(good.sum()) < 3:
        good = np.ones(len(sc), dtype=bool)
    xs = xy[good, 0]
    ys = xy[good, 1]
    x0 = int(max(0, np.floor(xs.min())))
    y0 = int(max(0, np.floor(ys.min())))
    x1 = int(min(cw, np.ceil(xs.max())))
    y1 = int(min(ch, np.ceil(ys.max())))
    return x0, y0, x1, y1


def _hsv_hist(patch_bgr: np.ndarray):
    """Normalized H-S histogram of an image patch (appearance signature)."""
    if patch_bgr is None or patch_bgr.size == 0 or patch_bgr.shape[0] < 4 or patch_bgr.shape[1] < 4:
        return None
    hsv = cv2.cvtColor(patch_bgr, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [30, 32], [0, 180, 0, 256])
    cv2.normalize(h, h, 0.0, 1.0, cv2.NORM_MINMAX)
    return h


class CropTracker:
    """Owns the identity of ONE athlete via Kalman motion + appearance gating."""

    def __init__(self, seed_bbox, frame_w: int, frame_h: int):
        x0, y0, x1, y1 = seed_bbox
        self.W, self.H = int(frame_w), int(frame_h)
        cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
        w, h = max(abs(x1 - x0), 0.05), max(abs(y1 - y0), 0.08)

        kf = cv2.KalmanFilter(6, 4)  # state [cx,cy,w,h,vx,vy], measure [cx,cy,w,h]
        kf.transitionMatrix = np.array([
            [1, 0, 0, 0, 1, 0],
            [0, 1, 0, 0, 0, 1],
            [0, 0, 1, 0, 0, 0],
            [0, 0, 0, 1, 0, 0],
            [0, 0, 0, 0, 1, 0],
            [0, 0, 0, 0, 0, 1],
        ], dtype=np.float32)
        kf.measurementMatrix = np.eye(4, 6, dtype=np.float32)
        kf.processNoiseCov = np.diag([1e-4, 1e-4, 1e-4, 1e-4, 1e-3, 1e-3]).astype(np.float32)
        kf.measurementNoiseCov = np.diag([4e-3, 4e-3, 1e-2, 1e-2]).astype(np.float32)
        kf.errorCovPost = np.eye(6, dtype=np.float32) * 0.1
        kf.statePost = np.array([[cx], [cy], [w], [h], [0], [0]], dtype=np.float32)
        self.kf = kf

        self.hist = None            # appearance model, EMA'd (None until first lock)
        self.anchor = None          # first-lock appearance, never updated (drift anchor)
        self.miss = 0               # consecutive frames the target was not found
        self._cur = (cx, cy, w, h)  # latest predicted box (centre + size)

    # ── prediction ────────────────────────────────────────────────────────
    def predict(self) -> None:
        """Advance the Kalman filter one sampled step."""
        if self.miss > 0:
            # Once the target is lost, its future motion is unknown — don't let
            # the filter coast on stale velocity (that chases the box off-frame
            # and re-acquires edge noise). Hold position instead.
            self.kf.statePost[4, 0] = 0.0
            self.kf.statePost[5, 0] = 0.0
        p = self.kf.predict()
        cx, cy = float(p[0, 0]), float(p[1, 0])
        w, h = max(float(p[2, 0]), 0.05), max(float(p[3, 0]), 0.08)
        self._cur = (cx, cy, w, h)

    def search_box(self) -> tuple[float, float, float, float]:
        """Predicted box, widened by how long the target has been missing."""
        cx, cy, w, h = self._cur
        mx = w * (0.35 + 0.30 * self.miss) + 0.04
        my = h * (0.25 + 0.25 * self.miss) + 0.04
        return (cx - w / 2 - mx, cy - h / 2 - my, cx + w / 2 + mx, cy + h / 2 + my)

    # ── selection (cascaded gate) ─────────────────────────────────────────
    def select(self, kpts_c, scores_c, crop_bgr, origin, crop_wh):
        """Choose the detection that IS the target, or None (a miss).

        kpts_c/scores_c: per-person crop-local keypoints + scores.
        origin: (cx0, cy0) crop top-left in full-frame px. crop_wh: (cw, ch)."""
        cx, cy, _, _ = self._cur
        cw, ch = crop_wh
        seeded = self.hist is not None
        best = None
        best_cost = 1e9
        for i in range(len(scores_c)):
            xy, sc = kpts_c[i], scores_c[i]
            core = float(np.mean(sc[_TORSO]))
            pxn, pyn = _torso_centroid_norm(xy, origin, (self.W, self.H))
            motion = ((pxn - cx) ** 2 + (pyn - cy) ** 2) ** 0.5
            app = 0.0
            app_anchor = 0.0
            if seeded:
                bx0, by0, bx1, by1 = _kp_bbox_px(xy, sc, cw, ch)
                hh = _hsv_hist(crop_bgr[by0:by1, bx0:bx1])
                if hh is not None:
                    app = 1.0 - max(0.0, float(cv2.compareHist(self.hist, hh, cv2.HISTCMP_CORREL)))
                    if self.anchor is not None:
                        app_anchor = 1.0 - max(0.0, float(cv2.compareHist(self.anchor, hh, cv2.HISTCMP_CORREL)))
            cost = motion * 3.0 + app * 1.0 - core * 0.2
            if cost < best_cost:
                best_cost = cost
                best = (i, motion, app, app_anchor)
        if best is None:
            return None
        i, motion, app, app_anchor = best
        if seeded:
            # reject a candidate that is both far AND looks different (a bystander)
            if motion > _MOTION_GATE and app > _APP_GATE:
                return None
            # after a loss streak, only RE-ACQUIRE something that looks like the
            # target — otherwise a passer-by / edge noise gets adopted as the athlete
            if self.miss >= 3 and app > _APP_GATE:
                return None
            # never let identity drift (frame by frame) onto something that looks
            # nothing like the athlete we originally locked (e.g. edge noise once
            # the runner has left the frame)
            if app_anchor > _ANCHOR_GATE:
                return None
        else:
            # first lock: the athlete must be near the seed box
            if motion > _SEED_GATE:
                return None
        return i

    # ── update ────────────────────────────────────────────────────────────
    def update(self, xy, sc, crop_bgr, origin, crop_wh) -> None:
        """Correct the Kalman filter + refresh the appearance model."""
        cw, ch = crop_wh
        pxn, pyn = _torso_centroid_norm(xy, origin, (self.W, self.H))
        bx0, by0, bx1, by1 = _kp_bbox_px(xy, sc, cw, ch)
        wn = max((bx1 - bx0) / self.W, 0.03)
        hn = max((by1 - by0) / self.H, 0.05)
        self.kf.correct(np.array([[pxn], [pyn], [wn], [hn]], dtype=np.float32))
        self._cur = (pxn, pyn, wn, hn)
        self.miss = 0
        hh = _hsv_hist(crop_bgr[by0:by1, bx0:bx1])
        if hh is not None:
            if self.hist is None:
                self.hist = hh
                self.anchor = hh.copy()  # permanent drift anchor
            else:  # slow EMA so the model tracks lighting but not a switch
                self.hist = cv2.addWeighted(self.hist, 0.85, hh, 0.15, 0.0)
