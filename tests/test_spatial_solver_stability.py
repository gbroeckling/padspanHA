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


# ── A solve that lands in no room is a failed solve ──────────────────────────
# Two tiers guard a spatial estimate, and they are not the same strength:
#
#   _within_floor_bounds      the floor's BOUNDING BOX plus a 3 m margin
#   beacon_room_from_geometry the actual room POLYGONS
#
# A house is not a rectangle, so there is a gap between them: the missing corner
# of an L, the yard between two wings, the driveway. A point there passes bounds
# and hits no room.
#
# The estimate was rejected as evidence for the ROOM there — correctly, RSSI
# scoring decides instead — and its coordinates were published anyway. So a
# device got a sensible room and was DRAWN in the gap:
# "computed:(3.8,-13.2)@main>NO_GEOMETRY_HIT" on a car that had not moved.
#
# The polygons are now authoritative for BOTH, and the bbox is only a cheap
# pre-filter. No position is published that no room contains.

from custom_components.padspan_ha import fabric_truth  # noqa: E402

# An L-shaped floor: two wings meeting at the origin corner. The notch at
# (12, 12) is inside the bounding box and inside neither wing.
_L_FLOOR = {
    "West Wing": {"type": "poly", "floor_id": "main",
                  "points_m": [[0, 0], [10, 0], [10, 20], [0, 20]]},
    "South Wing": {"type": "poly", "floor_id": "main",
                   "points_m": [[0, 0], [20, 0], [20, 10], [0, 10]]},
}


def _hits_a_room(x, y):
    """The polygon test, as beacon_room_from_geometry applies it."""
    for name, geo in _L_FLOOR.items():
        d = fabric_truth.room_distance_m(geo, x, y)
        if d is not None and d <= 0:
            return name
    return None


def test_the_bounding_box_alone_cannot_keep_a_solve_indoors():
    """The gap, demonstrated — this is why the bbox is not sufficient."""
    bounds = _floor_bounds_from_geometry(_L_FLOOR)
    notch_x, notch_y = 15.0, 15.0

    assert _within_floor_bounds(notch_x, notch_y, "main", bounds) is True, \
        "the notch must be inside the bounding box, or the example proves nothing"
    assert _hits_a_room(notch_x, notch_y) is None, \
        "the notch must be inside no room, or the example proves nothing"


def test_a_point_in_the_notch_is_not_a_position():
    """The invariant: no room contains it, so it is not publishable.

    The production code expresses this by leaving _spatial_xy unset, which
    routes the poll into the existing hold branch — keep the last good
    position for the grace window, then drop it honestly.
    """
    for x, y in ((15.0, 15.0), (19.0, 19.0), (11.0, 12.5)):
        assert _hits_a_room(x, y) is None
        # publishable <=> a room contains it
        assert (_hits_a_room(x, y) is not None) is False


def test_points_actually_inside_a_wing_are_still_positions():
    """The fix must not suppress good solves."""
    for x, y in ((5.0, 5.0), (5.0, 18.0), (18.0, 5.0), (9.5, 9.5)):
        assert _hits_a_room(x, y) is not None, f"({x},{y}) should be inside a wing"


def test_the_margin_makes_the_gap_wider_not_narrower():
    """A 3 m margin admits points further outside, so bounds cannot tighten."""
    bounds = _floor_bounds_from_geometry(_L_FLOOR)
    just_outside = (_SITE_MARGIN_M - 0.5)
    x = 20.0 + just_outside
    assert _within_floor_bounds(x, 5.0, "main", bounds) is True
    assert _hits_a_room(x, 5.0) is None, "outside every wing, yet bounds accepts it"


# ── The estimator reports whether it determined a point ──────────────────────
# A least-squares solve returns a point whether or not the geometry determines
# one. When every receiver lies in roughly one direction the residual surface is
# flat along it: the minimiser slides out and nothing pulls it back. That is how
# a parked car was placed thirteen metres into a field, and it was "fixed" with
# a bounding box — which is neither the building nor the evidence.
#
# The flatness is not something to fence off. It is what the covariance of the
# fit measures. _position_sigma_m reports it, and an estimate that is not
# determined is not a position. No guard, no hull, no box: the estimator says
# what it knows.

from custom_components.padspan_ha.presence_coordinator import (  # noqa: E402
    _POSITION_MAX_SIGMA_M,
    _position_sigma_m,
)

_HOUSE = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]
_SHED = (5.0, -14.0)


def _meas(receivers, true_pt, *, noise=None):
    out = []
    for i, (sx, sy) in enumerate(receivers):
        d = math.hypot(true_pt[0] - sx, true_pt[1] - sy)
        if noise:
            d += noise[i]
        out.append((sx, sy, d, 1.0))
    return out


def test_a_point_among_the_receivers_is_tightly_determined():
    pt = (4.0, 6.0)
    sigma = _position_sigma_m(*pt, _meas(_HOUSE, pt, noise=[0.3, -0.2, 0.25, -0.3]))
    assert sigma < 1.0, f"well-surrounded fix should be sub-metre, got {sigma:.2f}"


def test_a_point_in_the_field_is_not_determined_by_house_receivers():
    """Thirteen metres out, every receiver in the same direction: the residual is
    flat along that axis and sigma says so. This is the Tesla."""
    field = (3.8, -13.2)
    ranges = _meas(_HOUSE, (5.0, 5.0), noise=[3.0, -3.0, 2.5, -2.5])  # inconsistent, as real
    sigma = _position_sigma_m(*field, ranges)
    assert sigma > _POSITION_MAX_SIGMA_M,         f"an undetermined solve must report a large sigma, got {sigma:.1f}"


def test_the_bronco_by_the_shed_is_determined_once_the_shed_hears_it():
    """The one thing that may sit outside the house — and it needs NO special
    case. The shed is a receiver. With it, the geometry brackets the point and
    sigma is finite. Without it, the same point is undetermined.

    Outdoor placement is allowed exactly when an outdoor radio supplies the
    evidence. That is the rule working, not an exception to it.
    """
    bronco = (4.5, -12.0)
    without = _position_sigma_m(*bronco, _meas(_HOUSE, bronco, noise=[0.5, -0.4, 0.5, -0.5]))
    with_shed = _position_sigma_m(*bronco, _meas(_HOUSE + [_SHED], bronco, noise=[0.5, -0.4, 0.5, -0.5, 0.3]))
    assert with_shed < without, "the shed's range must tighten the fix"
    assert with_shed <= _POSITION_MAX_SIGMA_M, f"shed-supported fix should be a position, got {with_shed:.1f}"


def test_an_estimate_on_the_receivers_line_is_undetermined():
    """Receivers on a line AND the estimate on that line: every unit vector is
    parallel, JᵀWJ is rank one, sigma is infinite. The estimator names the
    degeneracy instead of returning a confident point on it.

    (An estimate OFF the line is a different story — the unit vectors fan out
    and the point is determined, up to the mirror ambiguity across the line,
    which is a two-fold ambiguity the local covariance cannot see and _wls_refine
    handles by refusing near-collinear receivers.)
    """
    line = [(0.0, 0.0), (5.0, 0.0), (10.0, 0.0)]
    sigma = _position_sigma_m(15.0, 0.0, _meas(line, (15.0, 0.0), noise=[0.3, -0.3, 0.2]))
    assert sigma == math.inf


def test_two_receivers_cannot_determine_a_point():
    assert _position_sigma_m(1.0, 1.0, _meas(_HOUSE[:2], (1.0, 1.0))) == math.inf


def test_sigma_grows_with_distance_from_the_receivers():
    """The property that makes this the right primitive: uncertainty rises
    smoothly as the geometry thins, rather than a wall appearing at a box edge."""
    pts = [(5.0, -2.0), (5.0, -6.0), (5.0, -10.0), (5.0, -14.0)]
    sigmas = [_position_sigma_m(*p, _meas(_HOUSE, (5.0, 5.0), noise=[1.0, -1.0, 1.0, -1.0])) for p in pts]
    assert sigmas == sorted(sigmas), f"sigma should rise monotonically going out: {sigmas}"
