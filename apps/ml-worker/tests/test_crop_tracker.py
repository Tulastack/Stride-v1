"""Tracker resilience contract: losing the athlete must be recoverable.

The failure chain these lock down: tracker misses → search stays glued to a
stale position (or a false exit latch blinds it permanently) → every remaining
frame excluded → the whole analysis dies with low_confidence_video. A lost
target must be re-findable; an entering runner must not read as a leaving one.

And the identity contract: the tracker never hops to another person. A re-find
has to be physically reachable and the same body size, or it is refused.
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
    # First locks happen AT the edge when an athlete runs into frame, moving
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


def _miss(tr: CropTracker, n: int) -> None:
    for _ in range(n):
        tr.predict()
        tr.miss += 1


def test_global_search_relocks_only_within_sprint_reach():
    # After a run of misses the athlete is re-found by appearance, but only
    # where they could have run to in that time. A same-kit person further
    # away is a different athlete.
    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000)
    _tracked_step(tr, 500, 500, RED)
    _miss(tr, _RESET_MISS)
    near, sc = _person_kpts(780, 500)          # ~6 body lengths in 5 samples (1/3 s)
    assert tr.select([near], [sc], _crop(RED), FULL, WH) == 0
    far, sc = _person_kpts(980, 900)           # ~13 body lengths: not reachable
    assert tr.select([far], [sc], _crop(RED), FULL, WH) is None
    assert tr.select([near], [sc], _crop(BLUE), FULL, WH) is None


def test_a_different_sized_person_nearby_is_a_hop():
    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000)
    _tracked_step(tr, 500, 500, RED)
    tr.predict()
    small, sc = _person_kpts(530, 480, w_px=25.0, h_px=50.0)   # a figure far down the track
    assert tr.select([small], [sc], _crop(RED), FULL, WH) is None
    assert tr.hops_refused == 1


def test_athlete_lost_for_over_a_second_is_gone():
    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000, dt=1 / 15)
    _tracked_step(tr, 500, 500, RED)
    _miss(tr, 16)
    assert tr.gone
    xy, sc = _person_kpts(500, 500)
    assert tr.select([xy], [sc], _crop(RED), FULL, WH) is None


def test_first_lock_needs_the_person_mostly_inside_the_circle():
    # The circle is the user's choice: someone mostly outside it is never
    # locked, however long the tracker waits.
    tr = CropTracker((0.10, 0.10, 0.20, 0.20), 1000, 1000)
    xy, sc = _person_kpts(270, 200)           # box ≈ (0.24–0.30, 0.14–0.26): outside the circle
    assert tr.select([xy], [sc], _crop(RED), FULL, WH) is None
    tr.miss = 20
    assert tr.select([xy], [sc], _crop(RED), FULL, WH) is None
    inside, sc_in = _person_kpts(160, 150, w_px=60.0, h_px=90.0)
    assert tr.select([xy, inside], [sc, sc_in], _crop(RED), FULL, WH) == 1


def test_forward_track_on_someone_else_at_the_circled_frame_invalidates():
    import pytest
    from src.rtmpose_backend import _check_brush_identity

    tr = CropTracker((0.4, 0.3, 0.6, 0.7), 1000, 1000)
    _tracked_step(tr, 500, 500, RED)
    _check_brush_identity(tr, tr.box)          # same person: fine
    with pytest.raises(ValueError, match="target_identity_lost"):
        _check_brush_identity(tr, (0.75, 0.40, 0.85, 0.60))
