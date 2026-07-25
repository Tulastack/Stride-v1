"""Tracker resilience contract: losing the athlete must be recoverable.

The failure chain these lock down: tracker misses → search stays glued to a
stale position (or a false exit latch blinds it permanently) → every remaining
frame excluded → the whole analysis dies with low_confidence_video. A lost
target must be re-findable; an entering runner must not read as a leaving one.
"""
import numpy as np

from src.crop_tracker import CropTracker, _RESET_MISS


def _person_kpts(cx_px: float, cy_px: float, w_px: float = 60.0, h_px: float = 120.0):
    """17 keypoints spread over a person-shaped box centered at (cx, cy), crop px."""
    xs = np.linspace(cx_px - w_px / 2, cx_px + w_px / 2, 17)
    ys = np.linspace(cy_px - h_px / 2, cy_px + h_px / 2, 17)
    xy = np.stack([xs, ys], axis=1)
    sc = np.full(17, 0.9)
    return xy, sc


def _crop(color, w=1000, h=1000):
    img = np.zeros((h, w, 3), dtype=np.uint8)
    img[:, :] = color
    return img


RED = (0, 0, 220)
BLUE = (220, 0, 0)
FULL = (0, 0)          # origin: crop == full frame
WH = (1000, 1000)


def _tracked_step(tr: CropTracker, x_px: float, y_px: float, color=RED):
    """One normal predict→update cycle with the person at (x, y) full-frame px."""
    tr.predict()
    xy, sc = _person_kpts(x_px, y_px)
    tr.update(xy, sc, _crop(color), FULL, WH)


def test_entering_runner_near_edge_does_not_latch_exit():
    # First locks happen AT the edge when an athlete runs into frame — moving
    # inward must never read as an exit.
    tr = CropTracker((0.0, 0.3, 0.1, 0.7), 1000, 1000)
    for x in (15, 25, 60, 110):   # near left edge, moving right (inward)
        _tracked_step(tr, x, 500)
    assert not tr._exited


def test_runner_leaving_through_edge_latches_exit():
    tr = CropTracker((0.3, 0.3, 0.5, 0.7), 1000, 1000)
    for x in (400, 300, 200, 100, 40, 15):   # marching out the left edge
        _tracked_step(tr, x, 500)
    assert tr._exited


def test_exited_tracker_relocks_on_strong_anchor_match_only():
    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000)
    _tracked_step(tr, 500, 500, RED)          # sets appearance anchor (red kit)
    tr._exited = True

    # A different-looking person (blue) must NOT be grabbed.
    xy_b, sc_b = _person_kpts(500, 500)
    assert tr.select([xy_b], [sc_b], _crop(BLUE), FULL, WH) is None
    assert tr._exited

    # The athlete themselves (red, matches the anchor) re-locks.
    xy_r, sc_r = _person_kpts(480, 500)
    assert tr.select([xy_r], [sc_r], _crop(RED), FULL, WH) == 0
    assert not tr._exited


def test_position_lock_goes_global_after_reset_misses():
    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000)
    assert not tr.needs_global_search()       # first-lock phase: brush governs
    _tracked_step(tr, 500, 500)
    assert not tr.needs_global_search()
    tr.miss = _RESET_MISS
    assert tr.needs_global_search()


def test_global_search_relocks_far_away_target_by_appearance():
    # After a long miss the athlete may be ANYWHERE — a strong appearance match
    # far from the stale prediction must be accepted, a mismatch refused.
    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000)
    _tracked_step(tr, 500, 500, RED)
    tr.miss = _RESET_MISS
    xy_far, sc_far = _person_kpts(880, 500)   # 0.38 normalized away (>> motion gate)
    assert tr.select([xy_far], [sc_far], _crop(RED), FULL, WH) == 0

    tr.miss = _RESET_MISS
    assert tr.select([xy_far], [sc_far], _crop(BLUE), FULL, WH) is None


def test_first_lock_seed_box_inflates_with_misses():
    # An imprecise brush (athlete just outside it) must eventually lock instead
    # of leaving the whole clip unanalyzable.
    tr = CropTracker((0.10, 0.10, 0.20, 0.20), 1000, 1000)
    xy, sc = _person_kpts(270, 200)           # box ≈ (0.24–0.30, 0.14–0.26): outside the brush
    assert tr.select([xy], [sc], _crop(RED), FULL, WH) is None
    tr.miss = 8                                # inflation ≈ 2.2x → tolerance reaches the athlete
    assert tr.select([xy], [sc], _crop(RED), FULL, WH) == 0
