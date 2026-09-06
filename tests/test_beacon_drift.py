"""Unit tests for beacon_drift.py (gap #6 of the best-in-class roadmap,
docs/BEST_IN_CLASS_ROADMAP.md) — pure math, no HA dependency.
"""
from __future__ import annotations

import pytest

from custom_components.padspan_ha.beacon_drift import (
    DRIFT_BAD_M,
    DRIFT_WARN_M,
    compute_drift_m,
    drift_severity,
)


def test_drift_is_zero_when_solved_matches_true_exactly():
    assert compute_drift_m(4.0, -3.0, 4.0, -3.0) == 0.0


def test_drift_is_the_straight_line_distance():
    # A 3-4-5 triangle — easy to hand-verify.
    assert compute_drift_m(0.0, 0.0, 3.0, 4.0) == pytest.approx(5.0)


def test_drift_is_none_when_any_position_is_unknown():
    assert compute_drift_m(None, 0.0, 1.0, 1.0) is None
    assert compute_drift_m(0.0, None, 1.0, 1.0) is None
    assert compute_drift_m(0.0, 0.0, None, 1.0) is None
    assert compute_drift_m(0.0, 0.0, 1.0, None) is None


def test_severity_ok_at_and_below_the_warn_threshold():
    assert drift_severity(0.0) == "ok"
    assert drift_severity(DRIFT_WARN_M) == "ok"


def test_severity_warn_between_thresholds():
    assert drift_severity(DRIFT_WARN_M + 0.01) == "warn"
    assert drift_severity(DRIFT_BAD_M) == "warn"


def test_severity_bad_above_the_bad_threshold():
    assert drift_severity(DRIFT_BAD_M + 0.01) == "bad"


def test_severity_unknown_when_drift_is_none():
    assert drift_severity(None) == "unknown"
