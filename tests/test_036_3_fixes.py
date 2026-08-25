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

    def test_a_perfect_fit_on_a_degenerate_geometry_is_still_rejected(self):
        """A fit cannot be more certain than the measurements it is made of.

        This was the defect: sigma = sqrt((residual/dof) * trace((JtWJ)^-1)),
        and the trace term — which IS the geometric conditioning — was
        multiplied by the residual. With three ranges and two unknowns there is
        one degree of freedom, so roughly consistent ranges drive the residual
        to nothing and the geometry never gets to speak.

        Three receivers in a line with exact ranges to a point 200 m away is
        determined only up to reflection across that line. The solve cannot
        know which side of the receivers the device is on, and it used to
        report 0.0 m and publish it.
        """
        cluster = [(0, 0), (0, 1), (0, 2)]
        sigma = _position_sigma_m(200.0, 1.0, _dists(cluster, 200.0, 1.0))
        assert sigma > _POSITION_MAX_SIGMA_M, (
            f"a geometry determined only up to reflection reported sigma="
            f"{sigma}, which would be published as a position"
        )

    def test_the_noise_floor_does_not_reject_ordinary_geometry(self):
        """The floor must catch degeneracy without disabling the feature.

        A normal three-scanner room is orders of magnitude away from the
        degenerate case, so the gate separates them with room to spare rather
        than sitting on a knife edge.
        """
        spread = [(0, 0), (10, 0), (5, 8)]
        good = _position_sigma_m(5.0, 3.0, _dists(spread, 5.0, 3.0))
        cluster = [(0, 0), (0, 1), (0, 2)]
        bad = _position_sigma_m(200.0, 1.0, _dists(cluster, 200.0, 1.0))
        assert good <= _POSITION_MAX_SIGMA_M
        assert bad > 10 * _POSITION_MAX_SIGMA_M, (
            f"only {bad / max(good, 1e-9):.0f}x between an ordinary room and a "
            f"degenerate solve — too close to call"
        )

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


