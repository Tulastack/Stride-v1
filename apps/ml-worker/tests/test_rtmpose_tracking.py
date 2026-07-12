"""Crop-to-target person matching (apps/ml-worker/src/rtmpose_backend.py).

Regression guard for the identity-switching bug: when two people are inside
the tracking crop, the frame-to-frame match must prefer whoever overlaps the
PREVIOUSLY tracked box, not just whoever happens to be nearest the crop's
geometric center this frame — center-proximity alone picked the wrong runner
whenever a bystander drifted toward the middle of the (re-centered) crop.

No video/model dependency — this exercises the pure geometry helper directly,
since running rtmlib's real RTMDet/RTMPose models needs no test video/harness
checked into this repo (the multi-person relay clip behind
docs/benchmarks/model-benchmark.md's numbers isn't committed here).
"""
from src.rtmpose_backend import _iou


def test_iou_of_identical_boxes_is_one():
    box = (0.2, 0.2, 0.4, 0.6)
    assert _iou(box, box) == 1.0


def test_iou_of_disjoint_boxes_is_zero():
    a = (0.0, 0.0, 0.1, 0.1)
    b = (0.5, 0.5, 0.6, 0.6)
    assert _iou(a, b) == 0.0


def test_iou_prefers_the_previously_tracked_box_over_a_merely_centered_one():
    # The box we were actually tracking last frame ("the real target," now
    # slightly off from the crop's new center after a stride).
    tracked = (0.30, 0.20, 0.54, 0.80)
    # A bystander who happens to be sitting near the crop's geometric center
    # this frame, but has nothing to do with where the target actually was.
    centered_bystander = (0.46, 0.45, 0.62, 0.85)
    # A detection of the same runner, slightly shifted (one stride later).
    same_runner_next_frame = (0.32, 0.21, 0.55, 0.81)

    iou_bystander = _iou(centered_bystander, tracked)
    iou_same_runner = _iou(same_runner_next_frame, tracked)

    assert iou_same_runner > iou_bystander
    assert iou_same_runner > 0.05  # would pass the acceptance gate in rtmpose_backend.py
