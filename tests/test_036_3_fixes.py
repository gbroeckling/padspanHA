# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Cover the three fixes going into 0.36.3.

Each was obvious enough to make without argument, which is exactly the kind of
change that ships untested. The crash that froze a live install this week was
one line in a diagnostic string.
"""

from __future__ import annotations

import math
from pathlib import Path

from custom_components.padspan_ha.presence_coordinator import (
    _POSITION_MAX_SIGMA_M,
    _position_sigma_m,
)

_SRC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


def _dists(scanners, x, y, w=1.0):
    """Exact ranges to (x, y) — a perfectly consistent set of measurements."""
    return [(sx, sy, math.hypot(x - sx, y - sy), w) for sx, sy in scanners]


class TestTheSigmaGateMeasuresWhatItClaims:
    """The gate publishes a position only when the geometry determines one."""

    def test_fewer_than_three_ranges_determine_nothing(self):
        assert _position_sigma_m(5.0, 5.0, _dists([(0, 0), (10, 0)], 5, 5)) == math.inf

    def test_KNOWN_DEFECT_zero_residual_hides_a_degenerate_geometry(self):
        """sigma = sqrt((residual/dof) * trace((JtWJ)^-1)).

        The trace term IS the geometric conditioning and it is the thing the
        docstring claims to be reporting — but it is MULTIPLIED by the
        residual, so a perfectly consistent set of ranges drives sigma to zero
        no matter how degenerate the geometry is.

        Three receivers in a line with exact ranges to a point 200 m away is
        determined only up to reflection across that line — the solve cannot
        know which side the device is on — and the gate reports 0.0 m, i.e.
        maximum confidence, and publishes it.

        This test documents the shipped behaviour rather than asserting the
        behaviour we want, so the suite stays honest and the fix has somewhere
        to land. The fix is to gate on conditioning independently of residual;
        it is a design change to 0.36.1's gate, not a patch, so it is not in
        0.36.3.
        """
        cluster = [(0, 0), (0, 1), (0, 2)]
        sigma = _position_sigma_m(200.0, 1.0, _dists(cluster, 200.0, 1.0))
        assert sigma == 0.0, (
            "shipped behaviour changed — if this now reports high uncertainty "
            "the defect is fixed and this test should become the real assertion"
        )
        assert sigma <= _POSITION_MAX_SIGMA_M  # ...and is therefore published

    def test_the_conditioning_term_alone_does_see_it(self):
        """The information IS there — only the multiplication discards it.

        Same degenerate geometry, ranges that disagree slightly, and the
        uncertainty explodes. Which is the proof that trace((JtWJ)^-1) is
        carrying the geometry and the residual is gating whether anyone hears
        about it.
        """
        cluster = [(0, 0), (0, 1), (0, 2)]
        clean = _dists(cluster, 200.0, 1.0)
        noisy = [(sx, sy, d + (0.5 if i == 0 else -0.5), w)
                 for i, (sx, sy, d, w) in enumerate(clean)]
        spread = [(0, 0), (10, 0), (5, 8)]
        spread_noisy = [(sx, sy, d + (0.5 if i == 0 else -0.5), w)
                        for i, (sx, sy, d, w) in enumerate(_dists(spread, 5.0, 3.0))]
        assert _position_sigma_m(200.0, 1.0, noisy) > _position_sigma_m(5.0, 3.0, spread_noisy), (
            "with equal disagreement the degenerate geometry must report more "
            "uncertainty than the well-spread one"
        )

    def test_a_well_spread_consistent_fix_is_determined(self):
        spread = [(0, 0), (10, 0), (5, 8)]
        sigma = _position_sigma_m(5.0, 3.0, _dists(spread, 5.0, 3.0))
        assert sigma <= _POSITION_MAX_SIGMA_M
        assert math.isfinite(sigma)

    def test_inconsistent_ranges_raise_the_uncertainty(self):
        """Sigma has to respond to disagreement, or it is measuring nothing."""
        spread = [(0, 0), (10, 0), (5, 8)]
        clean = _dists(spread, 5.0, 3.0)
        noisy = [(sx, sy, d + (4.0 if i == 0 else -4.0), w)
                 for i, (sx, sy, d, w) in enumerate(clean)]
        assert _position_sigma_m(5.0, 3.0, noisy) > _position_sigma_m(5.0, 3.0, clean)


class TestTheGateIsObservable:
    """A gate that fires invisibly is a gate nobody can diagnose.

    `wls_undetermined` was written to _spatial_debug and then overwritten by
    the unconditional `computed:` assignment a few statements later, so it
    could fire on every poll of every device and never appear anywhere.
    """

    def test_the_note_is_folded_into_the_published_line(self):
        src = (_SRC / "presence_coordinator.py").read_text(encoding="utf-8")
        assert "_sigma_note" in src
        # It must be appended to the line the poll actually publishes...
        assert '+ (_sigma_note if len(_all_scanners) >= 3 else "")' in src
        # ...and must no longer be written to a key that gets reassigned.
        assert 'self._spatial_debug[key] = (\n                                        f"wls_undetermined' not in src


class TestTheRebuildCommandIsAdminOnly:
    """It writes a map store and saves it, exactly like its sibling."""

    def test_it_carries_require_admin(self):
        src = (_SRC / "ws_fabric.py").read_text(encoding="utf-8")
        i = src.index("async def ws_fabric_map_stack_rebuild")
        decorators = src[max(0, i - 400):i]
        assert "require_admin" in decorators, (
            "the rebuild command writes maps.maps[].stack and saves the store; "
            "its sibling ws_fabric_map_align_to_stack is admin-gated"
        )

    def test_its_sibling_still_is_too(self):
        src = (_SRC / "ws_fabric.py").read_text(encoding="utf-8")
        i = src.index("async def ws_fabric_map_align_to_stack")
        assert "require_admin" in src[max(0, i - 400):i]


class TestTheRepairDialogNamesTheRealSignal:
    """A fault fires on iso_error, scale_error_frac OR origin_delta_m.

    Naming only two of them meant a scale-only fault fell through and quoted an
    origin delta that is inside its own tolerance — a number that reads as
    nonsense to the person being asked to approve a permanent change.
    """

    def test_all_three_signals_can_be_explained(self):
        js = (_SRC / "www" / "padspan-ha" / "views" / "maps.js").read_text(encoding="utf-8")
        i = js.index("const why = gf.iso_error")
        branch = js[i:i + 700]
        assert "iso_error" in branch
        assert "scale_error_frac" in branch, (
            "a scale-only fault still falls through to the origin wording"
        )
        assert "origin_delta_m" in branch
