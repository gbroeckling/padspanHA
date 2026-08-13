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


_SAMPLES = ((5.0, -65.0), (10.0, -75.0), (15.0, -81.0))


def _ols_for_offset(dz: float) -> tuple[float, float]:
    """Hand-compute the (n, rssi_1m) the store should produce for this dz.

    Independent of the implementation — an OLS of RSSI on log10(slant range),
    written out longhand, so the test pins the arithmetic and not just a
    difference between two runs.
    """
    pairs = [(math.log10(math.sqrt(d * d + dz * dz)), r) for d, r in _SAMPLES]
    n = len(pairs)
    sx = sum(p[0] for p in pairs)
    sy = sum(p[1] for p in pairs)
    sxx = sum(p[0] ** 2 for p in pairs)
    sxy = sum(p[0] * p[1] for p in pairs)
    b = (n * sxy - sx * sy) / (n * sxx - sx ** 2)
    return round(max(0.5, min(8.0, -b / 10.0)), 3), round((sy - b * sx) / n, 1)


# Scanner: upper floor base 3.0 + 2.4 m mounting = 5.4 m absolute.
# Walker on the upper floor: 3.0 + 1.0 carry height = 4.0 m.
_TRUE_DZ = 5.4 - 4.0        # 1.4 m — the real vertical offset
_DATUM_DZ = 5.4 - 1.0       # 4.4 m — what assuming the ground floor invented


def test_a_blank_floor_point_is_fitted_in_exactly_2d():
    """An unknown floor degrades to 2D — not to a guess at the datum."""
    blank = _fit_for("")
    assert blank is not None
    n_2d, ref_2d = _ols_for_offset(0.0)
    assert (blank["n"], blank["rssi_1m"]) == (pytest.approx(n_2d), pytest.approx(ref_2d)), (
        "a point with no resolvable floor must contribute its plain "
        "horizontal distance, exactly as it did before 3D fitting existed"
    )


def test_a_blank_floor_point_does_not_reproduce_the_datum_bug():
    blank = _fit_for("")
    n_datum, ref_datum = _ols_for_offset(_DATUM_DZ)
    assert (blank["n"], blank["rssi_1m"]) != (pytest.approx(n_datum), pytest.approx(ref_datum)), (
        "a floorless point is still being fitted as if it sat on the datum"
    )


def test_a_known_floor_is_fitted_against_its_real_offset():
    """The fix must not quietly turn 3D fitting off for everyone."""
    known = _fit_for("upper")
    assert known is not None
    n_3d, ref_3d = _ols_for_offset(_TRUE_DZ)
    assert (known["n"], known["rssi_1m"]) == (pytest.approx(n_3d), pytest.approx(ref_3d)), (
        "a point with a known floor should be fitted against its true "
        "vertical offset (scanner 5.4 m, walker 4.0 m)"
    )


def test_the_datum_assumption_was_worth_fixing():
    """Guard the premise: the old bug moved n by a material amount.

    If this ever stops being true the whole fix is noise, and the test should
    say so rather than quietly passing.
    """
    n_true, _ = _ols_for_offset(_TRUE_DZ)
    n_datum, _ = _ols_for_offset(_DATUM_DZ)
    assert abs(n_datum - n_true) / n_true > 0.05
