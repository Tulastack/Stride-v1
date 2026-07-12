"""Readability of the 2D-path metric formatting/explanation text — the actual
production path for real (side-on, single-camera) uploads. Regression guard
against reintroducing 'deg' text, missing thousands separators, or a metric
label leaking its unit suffix (e.g. 'contact time ms')."""
from src.biomech2d import UNIT, WHY, _fmt_value, _metric_label, _plausible_range


def test_units_use_the_degree_symbol_not_the_word_deg():
    for key in ("trunk_lean", "knee_drive", "hip_extension", "knee_flexion", "arm_swing"):
        assert UNIT[key] == "°"
    assert "deg" not in UNIT.values()


def test_fmt_value_formats_degrees_with_no_space():
    assert _fmt_value(18.0, "°") == "18°"


def test_fmt_value_formats_percent_with_no_space():
    assert _fmt_value(40.0, "%") == "40%"


def test_fmt_value_formats_abbreviated_units_with_a_space():
    assert _fmt_value(167.3, "ms") == "167 ms"
    assert _fmt_value(85.7, "spm") == "86 spm"


def test_fmt_value_adds_thousands_separators():
    assert _fmt_value(1234.5, "ms") == "1,234 ms"


def test_metric_label_strips_unit_suffix_not_just_underscores():
    assert _metric_label("contact_time_ms") == "contact time"
    assert _metric_label("cadence_spm") == "cadence"
    assert _metric_label("knee_drive") == "knee drive"


def test_every_metric_has_a_why_reason():
    for key in UNIT:
        assert WHY.get(key), f"missing WHY entry for {key}"


def test_contact_time_plausibility_rejects_values_actually_seen_in_production():
    # These exact figures were pulled from real stored analyses — a gait-timing
    # bug (dual-rate optical-flow timing since fixed) produced physically
    # impossible ground-contact readings that then poisoned the economy score
    # to a flat 0. No human's foot is on the ground for over a second while
    # running.
    lo, hi = _plausible_range("contact_time_ms", "max_velocity")
    for impossible in (1066.7, 1111.1, 1900.0, 561.9):
        assert not (lo <= impossible <= hi), f"{impossible}ms should be rejected as implausible"
    # Real, physiologically normal ground-contact times must still pass through.
    for real in (85.7, 120.0, 166.7, 177.8):
        assert lo <= real <= hi, f"{real}ms is a normal contact time and should be usable"


def test_cadence_plausibility_has_a_sane_floor_and_ceiling():
    lo, hi = _plausible_range("cadence_spm", "max_velocity")
    assert lo < 270 < hi  # the "normal" NORMAL_RANGE band must fit inside the plausible one
    assert not (lo <= 0 <= hi)
