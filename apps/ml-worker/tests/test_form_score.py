"""Behavioral contract for the running form score (_form_score).

Regression guards for the two failure modes of the old midpoint-averaging
formula: (1) perfect "lower is better" values (0% overstride, 0 valgus) scored
50% because they sit at the band edge; (2) values anywhere inside the healthy
band were penalized for not being at the exact band midpoint. Both meant
accurate form could never score well.
"""
from src.biomech2d import _form_score, FORM_WEIGHT, NORMAL_RANGE


def test_all_metrics_inside_healthy_band_score_100():
    # Values deliberately OFF-center but inside every band — the band is a
    # plateau, not a bullseye.
    scorable = [
        ("trunk_lean", 20.0, True),       # band 8-22, near upper edge
        ("knee_drive", 82.0, True),       # band 80-110, near lower edge
        ("hip_extension", 184.0, True),   # band 160-185, near upper edge
        ("knee_flexion", 26.0, True),     # band 25-55, near lower edge
        ("arm_swing", 108.0, True),       # band 70-110
    ]
    assert _form_score(scorable, "max_velocity") == 100


def test_elite_low_values_on_lower_is_better_metrics_are_not_punished():
    # Old formula: overstride 1% vs band (0,12) → |1-6|/12 → term 0.58;
    # valgus 0.5% vs (0,8) → 0.56. Perfection scored ~57. Now: no deduction.
    scorable = [
        ("overstride", 1.0, True),
        ("knee_valgus", 0.5, True),
        ("pelvic_drop", 1.0, True),
    ]
    assert _form_score(scorable, "max_velocity") == 100


def test_one_severe_fault_costs_roughly_its_weight():
    # Everything clean except knee drive at 22° vs band 80-110 (dev≈3.9
    # half-widths) — deduction saturates near FORM_WEIGHT["knee_drive"].
    scorable = [
        ("trunk_lean", 15.0, True),
        ("knee_drive", 22.0, True),
        ("hip_extension", 172.0, True),
        ("knee_flexion", 40.0, True),
    ]
    score = _form_score(scorable, "max_velocity")
    assert 100 - FORM_WEIGHT["knee_drive"] - 2 <= score <= 100 - FORM_WEIGHT["knee_drive"] + 4


def test_important_faults_cost_more_than_style_faults():
    base = [("trunk_lean", 15.0, True), ("knee_flexion", 40.0, True)]
    hip_fault = _form_score(base + [("hip_extension", 120.0, True)], "max_velocity")
    arm_fault = _form_score(base + [("arm_swing", 160.0, True)], "max_velocity")
    assert hip_fault < arm_fault  # hip extension is weighted ~3x arm swing


def test_worse_deviation_scores_lower_monotonically():
    def with_lean(v):
        return _form_score([("trunk_lean", v, True), ("knee_drive", 95.0, True),
                            ("hip_extension", 172.0, True)], "max_velocity")
    inside, mild, severe = with_lean(15.0), with_lean(28.0), with_lean(38.0)
    assert inside > mild > severe


def test_sparse_coverage_caps_the_score():
    one = _form_score([("trunk_lean", 15.0, True)], "max_velocity")
    two = _form_score([("trunk_lean", 15.0, True), ("knee_drive", 95.0, True)], "max_velocity")
    assert one == 80   # 1 metric can't claim perfection
    assert two == 90
    assert _form_score(
        [("trunk_lean", 15.0, True), ("knee_drive", 95.0, True), ("hip_extension", 172.0, True)],
        "max_velocity",
    ) == 100


def test_experimental_fallback_scores_at_half_weight():
    # No trusted metrics at all: experimental ones score, discounted.
    trusted_version = _form_score([("knee_drive", 22.0, True), ("trunk_lean", 15.0, True),
                                   ("hip_extension", 172.0, True)], "max_velocity")
    experimental_version = _form_score([("knee_drive", 22.0, False), ("trunk_lean", 15.0, False),
                                        ("hip_extension", 172.0, False)], "max_velocity")
    assert experimental_version > trusted_version  # same fault, half the deduction


def test_nothing_usable_scores_zero():
    assert _form_score([], "max_velocity") == 0


def test_acceleration_phase_uses_phase_band_for_trunk_lean():
    # 42° lean is CORRECT in the drive phase (band 35-55) and would be a severe
    # fault against the upright band (8-22).
    accel = _form_score([("trunk_lean", 42.0, True), ("knee_drive", 95.0, True),
                         ("hip_extension", 172.0, True)], "acceleration")
    upright = _form_score([("trunk_lean", 42.0, True), ("knee_drive", 95.0, True),
                           ("hip_extension", 172.0, True)], "max_velocity")
    assert accel == 100
    assert upright < accel


def test_band_midpoint_and_band_edge_score_identically():
    # The named regression: the old formula gave the edge half the credit.
    lo, hi = NORMAL_RANGE["knee_drive"]
    mid = _form_score([("knee_drive", (lo + hi) / 2, True), ("trunk_lean", 15.0, True),
                       ("hip_extension", 172.0, True)], "max_velocity")
    edge = _form_score([("knee_drive", lo + 0.1, True), ("trunk_lean", 15.0, True),
                        ("hip_extension", 172.0, True)], "max_velocity")
    assert mid == edge == 100
