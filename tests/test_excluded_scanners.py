"""Excluded scanners are a MASK, never a delete (issue #59).

The promise made to the reporter: an excluded receiver stops influencing
anything, stored calibration data is never modified, and un-excluding restores
the previous behaviour exactly. These tests pin the parts of that promise that
are pure logic — the symmetric k-NN mask, the forest's feature columns, capture
skipping, and reversibility.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.calibration_store import CalibrationStore
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.random_forest import RandomForestLocator


def _store(points: list[dict], settings: dict | None = None) -> CalibrationStore:
    hass = MagicMock()
    settings_obj = MagicMock()
    settings_obj.data = settings or {}
    hass.data = {DOMAIN: {DATA_SETTINGS: settings_obj}}
    st = CalibrationStore.__new__(CalibrationStore)
    st.hass = hass
    st.store = AsyncMock()
    st.data = {"points": list(points), "model": {}}
    st._rf = RandomForestLocator()
    st._model = None
    return st


def _pt(name: str, x: float, y: float, readings: dict[str, float]) -> dict:
    return {
        "id": name, "map_id": "m1", "x_frac": x, "y_frac": y,
        "x_m": x * 10.0, "y_m": y * 10.0, "floor_id": "main", "room": name,
        "scanner_readings": [
            {"source": s, "name": s, "mean_rssi": v, "rssi_samples": [v]}
            for s, v in readings.items()
        ],
    }


# A wandering scanner ("rover") that happened to be sitting in the kitchen
# during calibration, so ONLY the kitchen points recorded it. That asymmetry is
# what makes the stored-side mask matter: the distance metric charges a penalty
# per scanner on one side and not the other, so leaving the rover in the stored
# kitchen fingerprints penalises exactly the points a kitchen query should
# match. A rover present in every point would penalise every point equally and
# hide the bug.
_POINTS = [
    _pt("kitchen", 0.2, 0.2, {"fix_a": -60, "fix_b": -70, "fix_c": -80, "rover": -50}),
    _pt("study", 0.8, 0.8, {"fix_a": -65, "fix_b": -70, "fix_c": -75}),
]


def test_excluded_source_is_dropped_from_stored_fingerprints():
    """The mask is symmetric — it must leave the stored side too.

    The distance metric charges a penalty per scanner present on one side and
    absent from the other. Masking only the live query would penalise exactly
    those points that recorded the excluded scanner.
    """
    st = _store(_POINTS, {"excluded_scanners": ["rover"]})
    assert st.excluded_sources() == frozenset({"rover"})

    masked = st._readings_to_map(_POINTS[0], st.excluded_sources())
    assert "rover" not in masked
    assert set(masked) == {"fix_a", "fix_b", "fix_c"}

    # The stored point itself is untouched — this is a mask, not a delete.
    assert any(r["source"] == "rover" for r in _POINTS[0]["scanner_readings"])


def test_masking_only_the_live_side_would_match_the_wrong_room():
    """The stored-side mask changes the ANSWER, not just the score.

    The query is an exact match for the kitchen fingerprint. With the rover
    left in the stored kitchen point, that point is charged a missing-scanner
    penalty the study point never pays, and the match flips to the study —
    the wrong room. Masking both sides restores the correct answer.
    """
    query = {"fix_a": -60, "fix_b": -70, "fix_c": -80}   # exactly the kitchen

    st_on = _store(_POINTS, {})                                  # rover active
    st_off = _store(_POINTS, {"excluded_scanners": ["rover"]})   # rover masked

    res_on = st_on.knn_locate(dict(query), map_id="m1", k=1)
    res_off = st_off.knn_locate(dict(query), map_id="m1", k=1)
    assert res_on and res_off

    assert res_on["nearest_room"] == "study", (
        "precondition: with the rover unmasked the penalty should mis-match — "
        "if this fails the fixture no longer exercises the bug"
    )
    assert res_off["nearest_room"] == "kitchen"


def test_lost_and_disabled_radios_are_masked_too():
    """The three ways to mask a source share one definition."""
    st = _store(_POINTS, {
        "excluded_scanners": ["rover"],
        "lost_radios": {"fix_c": {"marked_at": "2026-08-11T00:00:00+00:00"}},
        "disabled_radios": {"fix_b": {"marked_at": "2026-08-11T00:00:00+00:00"}},
    })
    assert st.excluded_sources() == frozenset({"rover", "fix_b", "fix_c"})


# The forest needs at least four points to train, and only keeps a scanner as
# a feature column if it appears in enough of them — so the RF cases get their
# own fixture with the rover present throughout.
_RF_POINTS = [
    _pt(f"p{i}", 0.1 * i, 0.1 * i,
        {"fix_a": -60 - i, "fix_b": -70 + i, "fix_c": -80 + i, "rover": -50})
    for i in range(6)
]


def test_forest_has_no_column_for_a_masked_scanner():
    rf = RandomForestLocator()
    rf.train(_RF_POINTS, frozenset({"rover"}))
    assert rf.is_trained
    assert "rover" not in rf._sources
    assert {"fix_a", "fix_b", "fix_c"} <= set(rf._sources)


def test_unmasking_restores_the_previous_model_exactly():
    """Reversibility is the whole point of a mask."""
    before = RandomForestLocator()
    before.train(_RF_POINTS, frozenset())

    masked = RandomForestLocator()
    masked.train(_RF_POINTS, frozenset({"rover"}))

    after = RandomForestLocator()
    after.train(_RF_POINTS, frozenset())

    assert before._sources == after._sources != masked._sources


def test_capture_skips_masked_sources_but_keeps_older_points(monkeypatch):
    """New points skip the masked scanner; points captured earlier keep it."""
    import asyncio

    st = _store(_POINTS, {"excluded_scanners": ["rover"]})
    st._async_train_rf = AsyncMock()
    st._async_save = AsyncMock()

    # Both readings must clear MIN_SCANNER_SAMPLES, and the rover deliberately
    # has the MOST samples: without the mask it would not merely be kept, it
    # would be the strongest reading on the point. Anything less and the
    # "undersampled" fallback (keep only the best single reading) would drop
    # the rover on its own and the test would pass whether or not the mask
    # works.
    saved = asyncio.run(st.async_add_point({
        # A captured point carries its position; one without is refused now
        # (a fingerprint with no location is not a calibration point).
        "map_id": "m1", "x_frac": 0.3, "y_frac": 0.3, "x_m": 3.0, "y_m": 3.0,
        "room": "kitchen",
        "scanner_readings": [
            {"source": "fix_a", "name": "fix_a", "rssi_samples": [-56, -57, -56, -58]},
            {"source": "rover", "name": "rover", "rssi_samples": [-50, -51, -50, -49, -50, -51]},
        ],
    }))
    sources = {r["source"] for r in saved["scanner_readings"]}
    assert sources == {"fix_a"}, "a masked scanner must not enter a new point"

    # The pre-existing points still hold their rover readings, untouched.
    assert any(
        r["source"] == "rover"
        for p in _POINTS for r in p["scanner_readings"]
    )
