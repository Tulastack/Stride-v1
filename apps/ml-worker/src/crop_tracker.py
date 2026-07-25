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

import os

import cv2
import numpy as np

# Optional per-frame decision log for diagnostics (set STRIDE_TRACK_DEBUG=1).
DEBUG: list = []

# Torso keypoints (COCO-17) give a stable centroid + appearance region.
_TORSO = [5, 6, 11, 12]
# A candidate must be within this normalized distance of the Kalman prediction
# OR appearance-consistent; being BOTH far and dissimilar → treated as a miss.
_MOTION_GATE = 0.22       # max normalized jump from the Kalman prediction to still be "the target"
_REACQ_MISS = 2           # after this many consecutive misses we're "re-acquiring"
_REACQ_APP_GATE = 0.50    # on re-acquisition, candidate must match the RECENT (EMA) look
_VMAX = 0.10              # cap per-frame predicted motion so noisy detections can't make it run away
_RESET_MISS = 4           # after this many misses the position lock is stale → global search
_GLOBAL_APP_GATE = 0.45   # in global search, candidate must match the first-lock anchor this well
_REENTRY_APP_GATE = 0.35  # an "exited" target only re-locks on a STRONG anchor match
_SEED_INFLATE = 0.15      # first-lock: widen the brush box by this much per miss (imprecise brushes)
_SEED_INFLATE_MAX = 2.5   # ... up to this factor — spatial tolerance grows, user intent still anchors it
_EDGE = 0.03              # normalized margin that counts as "at the frame edge"
_EXIT_VEL = 0.005         # min outward velocity (normalized/frame) for an edge touch to mean "leaving"


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


def _iou(a, b) -> float:
    """IoU of two normalized (x0, y0, x1, y1) boxes."""
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 1e-9 else 0.0


def _contained(det, box) -> float:
    """Fraction of `det`'s area that lies inside `box` (both normalized xyxy)."""
    ix0, iy0 = max(det[0], box[0]), max(det[1], box[1])
    ix1, iy1 = min(det[2], box[2]), min(det[3], box[3])
    inter = max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)
    da = (det[2] - det[0]) * (det[3] - det[1])
    return inter / da if da > 1e-9 else 0.0


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
        # the brushed box, kept for the first-lock overlap test
        self.seed_box = (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

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
        self._exited = False        # latched once the athlete tracks off a frame edge
        self._locks = 0             # successful updates so far (exit needs a settled filter)

    # ── prediction ────────────────────────────────────────────────────────
    def predict(self) -> None:
        """Advance the Kalman filter one sampled step."""
        if self.miss > 0:
            # Once the target is lost, its future motion is unknown — don't let
            # the filter coast on stale velocity (that chases the box off-frame
            # and re-acquires edge noise). Hold position instead.
            self.kf.statePost[4, 0] = 0.0
            self.kf.statePost[5, 0] = 0.0
        else:
            # Cap velocity so a handful of noisy/low-confidence detections can't
            # build a runaway velocity that shoots the prediction off the subject.
            self.kf.statePost[4, 0] = float(np.clip(self.kf.statePost[4, 0], -_VMAX, _VMAX))
            self.kf.statePost[5, 0] = float(np.clip(self.kf.statePost[5, 0], -_VMAX, _VMAX))
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

    def needs_global_search(self) -> bool:
        """True once the position lock can no longer be trusted — the caller
        should hand select() the FULL frame so the athlete can be re-found
        anywhere (identity then rests on the appearance anchor, not position).
        Applies after a long miss run or an exit latch; never during first lock,
        where the user's brush box is the only ground truth we have."""
        return self.hist is not None and (self.miss >= _RESET_MISS or self._exited)

    # ── selection (cascaded gate) ─────────────────────────────────────────
    def select(self, kpts_c, scores_c, crop_bgr, origin, crop_wh):
        """Choose the detection that IS the target, or None (a miss).

        kpts_c/scores_c: per-person crop-local keypoints + scores.
        origin: (cx0, cy0) crop top-left in full-frame px. crop_wh: (cw, ch)."""
        cx, cy, _, _ = self._cur
        cw, ch = crop_wh
        ox, oy = origin
        seeded = self.hist is not None
        decision = None
        cand_dbg = []

        # Once the athlete has tracked off a frame edge, do NOT free-run on
        # noise — but the exit call itself can be wrong (a runner ENTERING near
        # an edge, an occlusion at the boundary). A candidate that strongly
        # matches the first-lock appearance anchor re-locks the target; anything
        # weaker stays refused, which keeps the bystander protection.
        if self._exited:
            best_i, best_app = None, _REENTRY_APP_GATE
            for i in range(len(scores_c)):
                xy, sc = kpts_c[i], scores_c[i]
                if float(np.mean(sc[_TORSO])) < 0.35 or self.anchor is None:
                    continue
                bx0, by0, bx1, by1 = _kp_bbox_px(xy, sc, cw, ch)
                hh = _hsv_hist(crop_bgr[by0:by1, bx0:bx1])
                if hh is None:
                    continue
                app_anchor = 1.0 - max(0.0, float(cv2.compareHist(self.anchor, hh, cv2.HISTCMP_CORREL)))
                if app_anchor < best_app:
                    best_app, best_i = app_anchor, i
            if best_i is not None:
                self._exited = False
            if os.environ.get("STRIDE_TRACK_DEBUG"):
                DEBUG.append({"pred_x": round(cx, 2), "seeded": seeded, "miss": self.miss,
                              "n": len(scores_c), "cands": cand_dbg, "chosen": best_i,
                              "exited": best_i is None})
            return best_i

        if not seeded:
            # ── FIRST LOCK ── pick the detection whose box best OVERLAPS the
            # brushed seed box. "Nearest to the box centre" mis-picks a bystander
            # when the box spans several people or the athlete sits low (bent at
            # the blocks), because the y-distance dominates. Overlap doesn't.
            # The box INFLATES with each miss: an imprecise brush (or an athlete
            # who enters the region a beat later) must not leave the whole clip
            # unlocked and every frame excluded — the user's intent stays the
            # anchor, the spatial tolerance around it grows.
            inflate = min(1.0 + _SEED_INFLATE * self.miss, _SEED_INFLATE_MAX)
            scx = (self.seed_box[0] + self.seed_box[2]) / 2.0
            scy = (self.seed_box[1] + self.seed_box[3]) / 2.0
            shw = (self.seed_box[2] - self.seed_box[0]) / 2.0 * inflate
            shh = (self.seed_box[3] - self.seed_box[1]) / 2.0 * inflate
            lock_box = (scx - shw, scy - shh, scx + shw, scy + shh)
            best_score = 0.0
            for i in range(len(scores_c)):
                xy, sc = kpts_c[i], scores_c[i]
                bx0, by0, bx1, by1 = _kp_bbox_px(xy, sc, cw, ch)
                det = ((ox + bx0) / self.W, (oy + by0) / self.H,
                       (ox + bx1) / self.W, (oy + by1) / self.H)
                # overlap = IoU with the brush box, boosted by how much of the
                # detection is contained inside it (rewards a person the brush is on)
                score = _iou(det, lock_box) + 0.5 * _contained(det, lock_box)
                if os.environ.get("STRIDE_TRACK_DEBUG"):
                    pxn, _ = _torso_centroid_norm(xy, origin, (self.W, self.H))
                    cand_dbg.append((round(pxn, 2), round(score, 2), round(float(np.mean(sc[_TORSO])), 2)))
                if score > best_score:
                    best_score = score
                    decision = i
            if best_score < 0.10:   # nothing meaningfully inside the brush → miss
                decision = None
        else:
            # ── TRACKING ── cascade: motion first, appearance to break ties/reject
            # drift. Once the position lock is stale (long miss run → the caller
            # hands us the full frame), position is meaningless and identity
            # rests on appearance against the EMA look and the first-lock anchor.
            global_search = self.miss >= _RESET_MISS
            best = None
            best_cost = 1e9
            for i in range(len(scores_c)):
                xy, sc = kpts_c[i], scores_c[i]
                core = float(np.mean(sc[_TORSO]))
                pxn, pyn = _torso_centroid_norm(xy, origin, (self.W, self.H))
                motion = ((pxn - cx) ** 2 + (pyn - cy) ** 2) ** 0.5
                app = 0.0
                app_anchor = 0.0
                bx0, by0, bx1, by1 = _kp_bbox_px(xy, sc, cw, ch)
                hh = _hsv_hist(crop_bgr[by0:by1, bx0:bx1])
                if hh is not None:
                    app = 1.0 - max(0.0, float(cv2.compareHist(self.hist, hh, cv2.HISTCMP_CORREL)))
                    if self.anchor is not None:
                        app_anchor = 1.0 - max(0.0, float(cv2.compareHist(self.anchor, hh, cv2.HISTCMP_CORREL)))
                cost = (app * 2.0 + app_anchor * 1.0 - core * 0.3) if global_search \
                    else (motion * 3.0 + app * 1.0 - core * 0.2)
                if os.environ.get("STRIDE_TRACK_DEBUG"):
                    cand_dbg.append((round(pxn, 2), round(motion, 3), round(app, 2), round(core, 2)))
                if cost < best_cost:
                    best_cost = cost
                    best = (i, motion, app, app_anchor)
            if best is not None:
                i, motion, app, app_anchor = best
                decision = i
                if global_search:
                    # Position lock is stale — accept on appearance alone, against
                    # either the recent look or the immutable first-lock anchor.
                    if not (app <= _REACQ_APP_GATE or app_anchor <= _GLOBAL_APP_GATE):
                        decision = None
                # Position continuity is PRIMARY: a detection within the motion
                # gate of the prediction is the target — accept it even if the
                # colour histogram drifted (a set→drive pose change makes appearance
                # an unreliable hard gate).
                elif motion > _MOTION_GATE:
                    decision = None
                # Appearance only matters when RE-ACQUIRING after a loss, and
                # against the RECENT (EMA) look — this rejects grabbing a nearby
                # bystander once the athlete has actually left.
                elif self.miss >= _REACQ_MISS and app > _REACQ_APP_GATE:
                    decision = None

        if os.environ.get("STRIDE_TRACK_DEBUG"):
            DEBUG.append({"pred_x": round(cx, 2), "seeded": seeded, "miss": self.miss,
                          "n": len(scores_c), "cands": cand_dbg, "chosen": decision})
        return decision

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
        self._locks += 1
        # Exit = torso centroid at a frame edge AND velocity pointing OUT of it,
        # once the filter has settled (>= 3 locks). A bare position test latched
        # on athletes legitimately near an edge — above all a runner ENTERING
        # the shot, whose very first lock is at the edge — and the first locks'
        # velocity is dominated by the seed-box innovation, not real motion.
        # A false latch here used to blind the tracker for the rest of the clip.
        vx = float(self.kf.statePost[4, 0])
        vy = float(self.kf.statePost[5, 0])
        if self._locks >= 3 and (
                (pxn < _EDGE and vx < -_EXIT_VEL) or (pxn > 1 - _EDGE and vx > _EXIT_VEL)
                or (pyn < _EDGE and vy < -_EXIT_VEL) or (pyn > 1 - _EDGE and vy > _EXIT_VEL)):
            self._exited = True
        hh = _hsv_hist(crop_bgr[by0:by1, bx0:bx1])
        if hh is not None:
            if self.hist is None:
                self.hist = hh
                self.anchor = hh.copy()  # permanent drift anchor
            else:  # slow EMA so the model tracks lighting but not a switch
                self.hist = cv2.addWeighted(self.hist, 0.85, hh, 0.15, 0.0)
