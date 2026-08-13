"""Regression tests for spatial-solver stability.

Live positions intermittently flew outside the building while being dead-on on
other polls.  The cause was in how a range estimate was *trusted*, not where it
was placed.

RSSI ranging error is multiplicative (σ_d ∝ d), which is why the solve weights
receivers by 1/d².  But the 3D work (issue #54) projects each slant range onto
the horizontal plane, d_h = sqrt(d² − dz²), and then weighted by 1/d_h².  That
projection amplifies measurement error by ∂d_h/∂d = d/d_h, so exactly the
readings whose horizontal component is least determined — a scanner nearly
overhead, or one on another floor — arrived with the *most* authority.

A cross-floor scanner whose noise pushed its range below its own vertical
offset collapsed to the 0.3 m floor and took a weight of ~10, against ~0.04 for
an honest scanner 5 m away: a 250:1 inversion that pinned the estimate onto
that scanner's coordinates.  It only fires on the polls where noise crosses
that threshold, which is why the symptom was "sometimes it's dead on".

_range_weight carries the projection's uncertainty into the solve: d_h²/d⁴,
which is identically the legacy 1/d² whenever dz is 0.
"""

from __future__ import annotations

import math

from custom_components.padspan_ha.presence_coordinator import (
    _SITE_MARGIN_M,
    _floor_bounds_from_geometry,
    _range_weight,
    _slant_to_horizontal,
    _within_floor_bounds,
)
from custom_components.padspan_ha.presence_coordinator import _wls_refine


def _idw(meas):
    """The production IDW centroid, mirrored for assertions."""
    wx = wy = wt = 0.0
    for sx, sy, d, w in meas:
        wx += sx * w
        wy += sy * w
        wt += w
    return (wx / wt, wy / wt)


def _reading(sx, sy, d_slant, dz):
    """One scanner as the production code prepares it."""
    d_h = _slant_to_horizontal(d_slant, dz)
    return (sx, sy, max(0.3, d_h), _range_weight(d_h, d_slant))


def _cost(x, y, meas):
    """The weighted cost the refinement minimises."""
    return sum(
        w * (math.hypot(x - sx, y - sy) - d) ** 2 for sx, sy, d, w in meas
    )


# ---------------------------------------------------------------------------
# 1. Weighting must reflect how well the horizontal range is determined
# ---------------------------------------------------------------------------

def test_same_floor_weighting_is_exactly_the_legacy_inverse_square():
    """Flat installs must keep the behaviour they have today."""
    for d in (0.5, 1.0, 3.0, 7.5, 20.0):
        d_h = _slant_to_horizontal(d, 0.0)
        assert d_h == d
        legacy = 1.0 / (d * d + 0.01)
        assert abs(_range_weight(d_h, d) - legacy) < 1e-9 * legacy


def test_near_vertical_reading_loses_authority_rather_than_gaining_it():
    """The inversion: a collapsed range used to be the most trusted input."""
    honest = _range_weight(*(lambda d: (_slant_to_horizontal(d, 0.0), d))(5.0))
    # Cross-floor scanner, 3.5 m of vertical separation, reading hot at 2.0 m
    # — inconsistent with its own geometry, so d_h collapses to the floor.
    d_slant, dz = 2.0, -3.5
    d_h = _slant_to_horizontal(d_slant, dz)
    assert d_h == 0.3, "precondition: this is the collapse case"

    inverted = 1.0 / (d_h * d_h + 0.01)      # what the solve used to do
    assert inverted > honest * 100, "precondition: the old weight was dominant"

    corrected = _range_weight(d_h, d_slant)
    assert corrected < honest, (
        f"a contradictory reading still outweighs an honest 5 m one "
        f"({corrected:.5f} vs {honest:.5f})"
    )


def test_inconsistent_cross_floor_scanner_cannot_capture_the_centroid():
    """The live failure, end to end."""
    good = [
        _reading(0.0, 0.0, 7.1, 0.0),
        _reading(10.0, 0.0, 7.1, 0.0),
        _reading(5.0, 10.0, 5.0, 0.0),
    ]
    honest_x, honest_y = _idw(good)

    rogue = _reading(30.0, 30.0, 2.0, -3.5)
    cx, cy = _idw(good + [rogue])
    pull = math.hypot(cx - honest_x, cy - honest_y)

    # Same rogue under the old 1/d_h² weighting, for scale.
    was = _idw(good + [(30.0, 30.0, 0.3, 1.0 / (0.3 * 0.3 + 0.01))])
    pull_before = math.hypot(was[0] - honest_x, was[1] - honest_y)

    assert pull_before > 30.0, "precondition: the inversion moved it 30 m+"
    assert pull < 3.0, (
        f"one inconsistent cross-floor scanner moved the centroid {pull:.1f} m "
        f"to ({cx:.1f}, {cy:.1f})"
    )
    assert pull < pull_before / 10.0


def test_a_genuinely_close_scanner_still_dominates():
    """Negative control: down-weighting must not deafen the solve.

    A device really 1 m from a same-floor scanner should still be placed
    there — the fix targets ill-determined projections, not proximity.
    """
    far = [
        _reading(0.0, 0.0, 9.0, 0.0),
        _reading(20.0, 0.0, 12.0, 0.0),
    ]
    near = _reading(10.0, 10.0, 1.0, 0.0)
    cx, cy = _idw(far + [near])
    assert math.hypot(cx - 10.0, cy - 10.0) < 1.5, (
        f"close same-floor scanner no longer dominates: ({cx:.1f}, {cy:.1f})"
    )


def test_consistent_slant_projection_is_unchanged():
    """The genuine 3D correction (issue #54) must still work."""
    assert _slant_to_horizontal(5.0, 3.0) == 4.0          # 3-4-5 triangle
    assert _slant_to_horizontal(7.0, 0.0) == 7.0          # 2D legacy path
    assert abs(_slant_to_horizontal(10.0, 2.4) - math.sqrt(100 - 5.76)) < 1e-9


# ---------------------------------------------------------------------------
# 2. The refinement must refine, not relocate
# ---------------------------------------------------------------------------

def test_wls_does_not_launch_on_near_collinear_receivers():
    """Three scanners along one wall are near-singular, not singular."""
    meas = [
        _reading(0.0, 0.0, 6.0, 0.0),
        _reading(5.0, 0.001, 3.0, 0.0),
        _reading(10.0, 0.002, 6.5, 0.0),
    ]
    seed = _idw(meas)
    x, y = _wls_refine(seed[0], seed[1], meas)
    drift = math.hypot(x - seed[0], y - seed[1])
    assert drift < 15.0, f"refinement travelled {drift:.1f} m from the seed"
    assert math.isfinite(x) and math.isfinite(y)


def test_wls_stays_within_its_damping_bound():
    """Damping is 5 m per iteration over 3 iterations."""
    meas = [
        _reading(0.0, 0.0, 0.3, 0.0),
        _reading(1.0, 0.05, 0.3, 0.0),
        _reading(2.0, 0.1, 0.3, 0.0),
        _reading(3.0, 0.0, 40.0, 0.0),
    ]
    seed = _idw(meas)
    x, y = _wls_refine(seed[0], seed[1], meas)
    drift = math.hypot(x - seed[0], y - seed[1])
    assert drift <= 15.0 + 1e-6, f"refinement escaped {drift:.1f} m from the seed"


def test_wls_still_improves_a_solvable_geometry():
    """Negative control: the refinement must remain useful.

    Well-conditioned receivers with consistent ranges — the case WLS was added
    for.  If a change makes this pass trivially, the refinement is dead.
    """
    true_x, true_y = 6.0, 4.0
    scanners = [(0.0, 0.0), (12.0, 0.0), (0.0, 9.0), (12.0, 9.0)]
    meas = [
        _reading(sx, sy, math.hypot(true_x - sx, true_y - sy), 0.0)
        for sx, sy in scanners
    ]
    seed = _idw(meas)
    seed_err = math.hypot(seed[0] - true_x, seed[1] - true_y)
    x, y = _wls_refine(seed[0], seed[1], meas)
    err = math.hypot(x - true_x, y - true_y)
    assert err < seed_err, (
        f"refinement no longer improves a clean solve: {seed_err:.2f} m -> {err:.2f} m"
    )
    assert err < 0.5


def test_wls_honours_the_supplied_weights():
    """Guard: the refinement must use _range_weight, not recompute 1/d².

    Two identical geometries differing only in weight must not solve alike.
    """
    base = [(0.0, 0.0, 5.0), (10.0, 0.0, 5.0), (5.0, 8.0, 3.0)]
    heavy = [(sx, sy, d, 1.0 if sy else 0.001) for sx, sy, d in base]
    light = [(sx, sy, d, 0.001 if sy else 1.0) for sx, sy, d in base]
    a = _wls_refine(5.0, 4.0, heavy)
    b = _wls_refine(5.0, 4.0, light)
    assert math.hypot(a[0] - b[0], a[1] - b[1]) > 0.5, (
        "weights had no effect on the solution"
    )


# ---------------------------------------------------------------------------
# 3. A refinement may leave the receiver hull, but not the building
# ---------------------------------------------------------------------------

# The live fabric, as measured on the running install.
_LIVE_GEOMETRY = {
    "Kitchen":         {"type": "poly", "floor_id": "main",
                        "points_m": [[-3.17, -16.48], [16.66, -16.48],
                                     [16.66, 12.10], [-3.17, 12.10]]},
    "Garry's Office":  {"type": "poly", "floor_id": "upper",
                        "points_m": [[3.38, -21.34], [12.80, -21.34],
                                     [12.80, 6.19], [3.38, 6.19]]},
    "North Suite":     {"type": "poly", "floor_id": "basement",
                        "points_m": [[-4.25, -17.79], [11.59, -17.79],
                                     [11.59, 12.40], [-4.25, 12.40]]},
}


def test_floor_bounds_come_from_the_fabric():
    b = _floor_bounds_from_geometry(_LIVE_GEOMETRY)
    assert b["main"] == (-3.17, 16.66, -16.48, 12.10)
    assert b["upper"] == (3.38, 12.80, -21.34, 6.19)
    assert b["basement"] == (-4.25, 11.59, -17.79, 12.40)


def test_floor_bounds_handle_circular_rooms():
    b = _floor_bounds_from_geometry(
        {"Round": {"type": "circle", "floor_id": "main",
                   "cx_m": 5.0, "cy_m": -2.0, "r_m": 3.0}}
    )
    assert b["main"] == (2.0, 8.0, -5.0, 1.0)


def test_the_live_escapes_are_rejected():
    """The exact estimates the running install was producing."""
    b = _floor_bounds_from_geometry(_LIVE_GEOMETRY)
    # Pixel 8 Pro and MaschineBOX: x ~18.5 on a floor that ends at 12.80,
    # with the outermost upper scanner at x=12.08.
    assert not _within_floor_bounds(18.6, 3.8, "upper", b)
    assert not _within_floor_bounds(18.4, -19.1, "upper", b)
    # iBeacon: 6.5 m below a floor that ends at -16.48.
    assert not _within_floor_bounds(3.9, -23.0, "main", b)
    assert not _within_floor_bounds(11.1, -19.5, "main", b)


def test_positions_inside_the_building_are_kept():
    """Negative control: containment must not suppress real positions."""
    b = _floor_bounds_from_geometry(_LIVE_GEOMETRY)
    assert _within_floor_bounds(8.3, -3.1, "main", b)       # GarryBroncoKeys
    assert _within_floor_bounds(5.0, 0.0, "upper", b)
    assert _within_floor_bounds(-4.0, -17.0, "basement", b)


def test_margin_allows_walls_and_doorways_but_not_the_garden():
    b = _floor_bounds_from_geometry(_LIVE_GEOMETRY)
    just_outside = 12.80 + _SITE_MARGIN_M - 0.1
    well_outside = 12.80 + _SITE_MARGIN_M + 0.1
    assert _within_floor_bounds(just_outside, 0.0, "upper", b)
    assert not _within_floor_bounds(well_outside, 0.0, "upper", b)


def test_a_floor_with_no_geometry_never_suppresses_a_position():
    """A missing polygon is not evidence the device is somewhere impossible."""
    b = _floor_bounds_from_geometry(_LIVE_GEOMETRY)
    assert _within_floor_bounds(999.0, -999.0, "__outside__", b)
    assert _within_floor_bounds(0.0, 0.0, "", b)


def test_wls_rejects_a_refinement_that_fits_worse_than_the_seed():
    """Gauss-Newton takes its step whether or not the step helps.

    These are real production-shaped inputs (found by random search over
    plausible scanner layouts and RSSI-derived ranges): one scanner almost
    on top of the seed carrying nearly all the weight, and two distant ones
    with weak, inconsistent ranges.  Unguarded, the step fits the data 309x
    WORSE and walks 6.5 m outward — straight out of the building.
    """
    meas = [
        (11.7709, -12.5573, 0.3057, 9.6678),
        (-1.1515, -11.6670, 23.3254, 0.0018),
        (-2.5652, -10.4842, 22.5086, 0.0020),
    ]
    seed = _idw(meas)
    seed_cost = _cost(seed[0], seed[1], meas)

    x, y = _wls_refine(seed[0], seed[1], meas)

    assert _cost(x, y, meas) <= seed_cost + 1e-9, (
        f"refinement worsened the fit: {seed_cost:.4f} -> {_cost(x, y, meas):.4f}"
    )
    assert math.hypot(x - seed[0], y - seed[1]) < 1e-9, (
        "a strictly worse refinement must fall back to the seed exactly"
    )
