"""The RSSI→distance cap must follow the site, not describe a house.

Every per-scanner distance estimate is clamped before it reaches the IDW
centroid and the WLS refinement. The clamp stops a noise-floor reading
claiming a distance the building could never contain — but it was a flat
50 m, which is a statement about a house.

On a large commercial floor (100,000 m² is ~450 m corner to corner) a flat
50 m clamps every genuinely distant scanner to the same value, so they all
receive the same 1/d² weight and the centroid stops being able to tell them
apart. The cap now derives from the scanner bounding box instead.

The floor at 50 m is the compatibility guarantee: no domestic install can see
a different number than it saw before this change.
"""

from __future__ import annotations

import math

import pytest

from custom_components.padspan_ha.presence_coordinator import (
    _MIN_RANGE_CAP_M,
    _site_range_cap,
)


def _pos(*xy: tuple[float, float]) -> dict[str, tuple[float, float, str]]:
    return {f"sc{i}": (x, y, "main") for i, (x, y) in enumerate(xy)}


# ── Domestic installs must be bit-identical to the old constant ───────────


@pytest.mark.parametrize(
    "corners",
    [
        ((0.0, 0.0), (8.0, 6.0)),                    # small flat, 10 m diagonal
        ((0.0, 0.0), (12.0, 9.0)),                   # house, 15 m diagonal
        ((0.0, 0.0), (15.0, 20.0)),                  # large house, 25 m diagonal
        ((-5.0, -5.0), (10.0, 10.0)),                # negative coordinates
    ],
)
def test_domestic_sites_keep_the_historic_cap(corners):
    """Anything up to a 25 m diagonal still caps at exactly 50 m."""
    assert _site_range_cap(_pos(*corners)) == pytest.approx(50.0)


def test_the_floor_is_the_old_constant():
    assert _MIN_RANGE_CAP_M == 50.0


# ── Large sites scale themselves ──────────────────────────────────────────


def test_a_commercial_floor_scales_past_the_old_ceiling():
    """~100,000 m²: 316 m square, ~447 m diagonal — the old cap was 11x short."""
    cap = _site_range_cap(_pos((0.0, 0.0), (316.0, 316.0)))
    assert cap == pytest.approx(2.0 * math.hypot(316.0, 316.0))
    assert cap > 800.0


def test_the_cap_is_twice_the_bounding_diagonal():
    cap = _site_range_cap(_pos((10.0, 10.0), (110.0, 10.0), (110.0, 85.0)))
    assert cap == pytest.approx(2.0 * math.hypot(100.0, 75.0))  # 250.0


def test_scanners_between_the_corners_do_not_change_the_cap():
    """The cap is set by the extremes; infill must not shrink or grow it."""
    sparse = _site_range_cap(_pos((0.0, 0.0), (200.0, 200.0)))
    dense = _site_range_cap(
        _pos((0.0, 0.0), (50.0, 50.0), (100.0, 100.0), (150.0, 150.0), (200.0, 200.0))
    )
    assert sparse == pytest.approx(dense)


# ── Degenerate inputs must not raise ──────────────────────────────────────


def test_no_scanners():
    assert _site_range_cap({}) == pytest.approx(50.0)


def test_one_scanner():
    assert _site_range_cap(_pos((7.0, 3.0))) == pytest.approx(50.0)


def test_all_scanners_stacked_on_one_point():
    """A zero-extent site is degenerate, not an error."""
    assert _site_range_cap(_pos((4.0, 4.0), (4.0, 4.0), (4.0, 4.0))) == pytest.approx(50.0)


def test_collinear_scanners_use_the_line_length():
    assert _site_range_cap(_pos((0.0, 5.0), (300.0, 5.0))) == pytest.approx(600.0)


def test_integer_coordinates_are_accepted():
    assert _site_range_cap({"a": (0, 0, "main"), "b": (300, 400, "main")}) == pytest.approx(1000.0)
