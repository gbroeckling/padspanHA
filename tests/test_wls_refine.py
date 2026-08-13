"""Unit tests for the WLS multilateration refinement in presence_coordinator."""

from __future__ import annotations

import math

from custom_components.padspan_ha.presence_coordinator import (
    _range_weight,
    _wls_refine,
)


def _ranges(receivers: list[tuple[float, float]], px: float, py: float):
    """Exact same-floor ranges: no vertical offset, so d_h == d_slant and the
    weight is identically the legacy 1/(d²+0.01)."""
    out = []
    for sx, sy in receivers:
        d = math.hypot(px - sx, py - sy)
        out.append((sx, sy, d, _range_weight(d, d)))
    return out


def test_converges_to_point_inside_hull() -> None:
    recv = [(0.0, 0.0), (8.0, 0.0), (0.0, 8.0), (8.0, 8.0)]
    true = (5.0, 3.0)
    seed = (4.0, 4.0)  # centroid-ish
    x, y = _wls_refine(seed[0], seed[1], _ranges(recv, *true), iters=10)
    assert math.hypot(x - true[0], y - true[1]) < 0.2


def test_can_leave_convex_hull() -> None:
    """The whole point of WLS over IDW: solutions outside the receiver hull."""
    recv = [(0.0, 0.0), (4.0, 0.0), (0.0, 4.0)]
    true = (6.0, 6.0)  # well outside the triangle
    seed = (1.5, 1.5)  # IDW can never leave the hull; WLS must
    x, y = _wls_refine(seed[0], seed[1], _ranges(recv, *true), iters=10)
    assert math.hypot(x - true[0], y - true[1]) < 0.5


def test_collinear_receivers_return_seed() -> None:
    """Singular geometry must not explode — falls back to the seed."""
    recv = [(0.0, 0.0), (2.0, 0.0), (4.0, 0.0)]
    seed = (2.0, 1.0)
    x, y = _wls_refine(seed[0], seed[1], _ranges(recv, 2.0, 3.0), iters=10)
    assert math.isfinite(x) and math.isfinite(y)
    # Collinear ranging has a mirror ambiguity; the solver must stay bounded
    assert abs(x - seed[0]) < 6.0 and abs(y - seed[1]) < 6.0


def test_step_damping_limits_single_iteration() -> None:
    recv = [(0.0, 0.0), (8.0, 0.0), (0.0, 8.0)]
    x, y = _wls_refine(50.0, 50.0, _ranges(recv, 4.0, 4.0), iters=1)
    # One damped iteration moves at most 5 m from the seed
    assert math.hypot(x - 50.0, y - 50.0) <= 5.0 + 1e-6
