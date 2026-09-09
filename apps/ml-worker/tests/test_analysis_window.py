"""The analysis window is the latency budget, so it gets a test.

Analysis cost is essentially (frames sampled x one pose inference), so the frame
cap is the only thing standing between "20 seconds" and the multi-minute
analyses that used to queue up behind each other until the sweeper failed them.
"""
from __future__ import annotations

import importlib
import os

import pytest


@pytest.fixture
def worker(monkeypatch):
    """Import the worker with a known cap, whatever the ambient env says."""
    monkeypatch.setenv('MAX_ANALYSIS_SECONDS', '12')
    monkeypatch.setenv('LEAD_IN_ALLOWANCE', '1.5')
    monkeypatch.setenv('STORAGE_DRIVER', 'local')
    import src.worker as w
    return importlib.reload(w)


class TestFrameCap:
    def test_budget_is_seconds_times_pose_rate(self, worker):
        # 12 s at 15 fps is 180 pose inferences, roughly 10 s of compute.
        assert worker._max_frames(15) == 180
        assert worker._max_frames(30) == 360

    def test_never_below_a_usable_floor(self, worker):
        # A very low pose rate must still leave enough frames to measure a
        # stride, even though that costs more than the cap implies.
        assert worker._max_frames(1) == 64

    def test_cap_is_short_enough_to_keep_the_promise(self, worker):
        # One pose inference is ~55 ms on the dev Mac (YOLOX ~35 + RTMPose ~13
        # per person, docs/benchmarks/pipeline-latency.md). The whole analysis
        # is advertised at about 20 s, and the lift plus decode need their share.
        assert worker._max_frames(15) * 0.055 < 12.0


class TestAnalysisWindowNote:
    def _frames(self, n, fps=30, step=2):
        return [{'frame_index': i * step} for i in range(n)]

    def test_says_nothing_when_the_whole_clip_fitted(self, worker):
        result = {}
        worker._note_analysis_window(result, self._frames(50), 15.0, 30.0, max_frames=180)
        # A normal in-app recording must not pick up a caveat it has not earned.
        assert result == {}

    def test_records_the_window_when_the_clip_was_cut(self, worker):
        result = {}
        worker._note_analysis_window(result, self._frames(180), 15.0, 30.0, max_frames=180)
        window = result['captureQuality']['analyzedWindow']
        assert window['frames'] == 180
        assert window['startSec'] == 0.0
        assert window['endSec'] == pytest.approx(358 / 30.0, abs=0.05)

    def test_tells_the_athlete_rather_than_only_the_json(self, worker):
        # primaryNudge is the only capture field the results screen renders, so
        # a window recorded anywhere else is a window nobody sees.
        result = {}
        worker._note_analysis_window(result, self._frames(180), 15.0, 30.0, max_frames=180)
        assert 'longer than we analyse' in result['captureQuality']['primaryNudge']

    def test_does_not_overwrite_advice_the_analysis_already_gave(self, worker):
        result = {'captureQuality': {'primaryNudge': 'Film from the side.'}}
        worker._note_analysis_window(result, self._frames(180), 15.0, 30.0, max_frames=180)
        assert result['captureQuality']['primaryNudge'] == 'Film from the side.'
        assert 'analyzedWindow' in result['captureQuality']
