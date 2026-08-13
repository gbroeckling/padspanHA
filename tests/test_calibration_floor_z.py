"""A calibration point with no resolvable floor must not be assumed to be on the datum.

The 3D path-loss fit (issue #54) adds the scanner↔point vertical offset to the
horizontal distance before fitting. The point's elevation comes from its floor,
so a point whose floor_id is blank used to fall back to elevation 0 — the
ground. On a multi-storey install that is wrong by a whole storey, and it feeds
metres of phantom vertical range into that scanner's path-loss fit, biasing
both n and rssi_1m in a way no user could see or report.

Blanks are not hypothetical: auto-calibration injects points from beacon pins,
and a pin whose floor is unknown arrives blank (presence_coordinator's
_inject_beacon_calibration). So this is fixed at both ends — filled in on
capture when the building leaves no choice, and dropped to a 2D distance in the
fit when it is still unknown.
"""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.random_forest import RandomForestLocator


def _make_store(points=None, floors=None, scanner=None) -> CalibrationStore:
    store = CalibrationStore.__new__(CalibrationStore)
    store.hass = MagicMock()
    store.hass.data = {}
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"points": list(points or []), "model": {}}
    store._rf = RandomForestLocator()
    store._model = None
    if floors is not None:
        model = MagicMock()
        model.floor_base_elevations_m.return_value = dict(floors)
        model.scanner_positions_m.return_value = scanner or {}
        model.scanner_absolute_z_m.return_value = (
            {"sc1": 2.4 + dict(floors).get("upper", 0.0)} if scanner else {}
        )
        store._model = model
    return store


# ── Resolving a blank floor on capture ────────────────────────────────────


def test_blank_floor_is_filled_in_when_there_is_only_one():
    store = _make_store(floors={"main": 0.0})
    assert store._resolve_floor_id("") == "main"
    assert store._resolve_floor_id(None) == "main"


def test_blank_floor_stays_blank_when_the_building_has_storeys():
    """Two floors means a blank is genuinely unknown — do not guess ground."""
    store = _make_store(floors={"main": 0.0, "upper": 3.0})
    assert store._resolve_floor_id("") == ""


def test_an_explicit_floor_is_never_overridden():
    store = _make_store(floors={"main": 0.0, "upper": 3.0})
    assert store._resolve_floor_id("upper") == "upper"


def test_resolution_survives_a_missing_model():
    store = _make_store()
    assert store._resolve_floor_id("") == ""


@pytest.mark.asyncio
async def test_added_point_carries_the_resolved_floor():
    store = _make_store(floors={"main": 0.0})
    saved = await store.async_add_point({
        "x_m": 1.0, "y_m": 1.0,
        "scanner_readings": [{"source": "sc1", "rssi_samples": [-60] * 10}],
    })
    assert saved["floor_id"] == "main"


# ── The fit itself ────────────────────────────────────────────────────────


def _points(floor_id: str):
    """Three points 5/10/15 m east of a scanner, walked on the upper floor."""
    return [
        {
            "id": f"p{i}", "x_m": float(d), "y_m": 0.0, "floor_id": floor_id,
            "scanner_readings": [{"source": "sc1", "mean_rssi": r}],
        }
        for i, (d, r) in enumerate(((5.0, -65.0), (10.0, -75.0), (15.0, -81.0)))
    ]


def _fit_for(floor_id: str):
    store = _make_store(
        points=_points(floor_id),
        floors={"main": 0.0, "upper": 3.0},
        scanner={"sc1": {"x_m": 0.0, "y_m": 0.0, "z_m": 2.4, "floor_id": "upper"}},
    )
    return store.fit_path_loss("sc1")


def test_a_blank_floor_point_is_fitted_in_2d_not_against_the_datum():
    """The whole point: an unknown floor must not become a phantom storey.

    The scanner sits at 5.4 m absolute (upper floor at 3.0 + 2.4 mounting).
    Assuming ground for the walker put it at 1.0 m, a 4.4 m vertical offset
    that never existed; the truth for a point on the scanner's own floor is
    5.4 − 4.0 = 1.4 m. Falling back to 2D is the honest degradation, and it
    must not reproduce the datum-assumed numbers.
    """
    blank = _fit_for("")
    assert blank is not None

    # What the old code did: treat the blank as the datum.
    sz, dev_h = 5.4, 1.0
    datum_assumed = []
    for d, r in ((5.0, -65.0), (10.0, -75.0), (15.0, -81.0)):
        dz = sz - (0.0 + dev_h)
        datum_assumed.append((math.log10(math.sqrt(d * d + dz * dz)), r))
    n_pts = len(datum_assumed)
    sx = sum(p[0] for p in datum_assumed)
    sy = sum(p[1] for p in datum_assumed)
    sxx = sum(p[0] ** 2 for p in datum_assumed)
    sxy = sum(p[0] * p[1] for p in datum_assumed)
    b = (n_pts * sxy - sx * sy) / (n_pts * sxx - sx ** 2)
    n_datum = round(max(0.5, min(8.0, -b / 10.0)), 3)

    assert blank["n"] != pytest.approx(n_datum), (
        "a floorless point is still being fitted as if it sat on the datum"
    )


def test_a_known_floor_still_gets_the_3d_correction():
    """The fix must not quietly turn 3D fitting off for everyone."""
    known = _fit_for("upper")
    blank = _fit_for("")
    assert known is not None and blank is not None
    assert known["n"] != pytest.approx(blank["n"]), (
        "a point with a known floor should be fitted against its real "
        "vertical offset, not the same 2D distance as a floorless one"
    )
