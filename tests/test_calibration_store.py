"""Unit tests for pure helper/math functions in calibration_store.py."""

from __future__ import annotations

import math
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.calibration_store import (
    CalibrationStore,
    GRID_N,
    KNN_K,
    SIGMA_CELLS,
    _gaussian,
    _mean,
    _std,
)
from custom_components.padspan_ha.random_forest import RandomForestLocator


# ---------------------------------------------------------------------------
# Inline helpers — self-contained, no conftest dependency
# ---------------------------------------------------------------------------


def _make_store(points: list[dict] | None = None) -> CalibrationStore:
    """Create a CalibrationStore backed by mocks with optional seed data."""
    hass = MagicMock()
    store = CalibrationStore.__new__(CalibrationStore)
    store.hass = hass
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.data = {"points": list(points or []), "model": {}}
    store._rf = RandomForestLocator()
    store._model = None
    return store


def _make_point(
    *,
    map_id: str = "map1",
    x_frac: float = 0.5,
    y_frac: float = 0.5,
    room: str = "living",
    readings: dict[str, float] | None = None,
) -> dict:
    """Build a calibration point dict with scanner_readings from a {source: rssi} map."""
    scanner_readings = []
    for src, rssi in (readings or {}).items():
        scanner_readings.append({
            "source": src,
            "name": src,
            "rssi_samples": [rssi],
            "mean_rssi": rssi,
            "std_rssi": 0.0,
            "sample_count": 1,
        })
    return {
        "id": f"cp_{x_frac}_{y_frac}",
        "map_id": map_id,
        "x_frac": x_frac,
        "y_frac": y_frac,
        "floor_id": "floor1",
        "room": room,
        "label": "",
        "device_id": "dev1",
        "collected_at": "2026-01-15T12:00:00+00:00",
        "duration_s": 15,
        "scanner_readings": scanner_readings,
    }


# ---------------------------------------------------------------------------
# Tests: _gaussian
# ---------------------------------------------------------------------------


class TestGaussian:
    """Tests for the _gaussian() helper."""

    def test_peak_at_zero(self) -> None:
        """_gaussian(0, sigma) should always equal 1.0 (peak of Gaussian)."""
        assert _gaussian(0.0, SIGMA_CELLS) == 1.0
        assert _gaussian(0.0, 1.0) == 1.0
        assert _gaussian(0.0, 100.0) == 1.0

    def test_symmetry(self) -> None:
        """_gaussian(d) == _gaussian(-d) for any d."""
        for d in [0.5, 1.0, 2.0, 5.0]:
            assert _gaussian(d, SIGMA_CELLS) == pytest.approx(_gaussian(-d, SIGMA_CELLS))

    def test_decays_with_distance(self) -> None:
        """Values should decrease monotonically as distance grows."""
        vals = [_gaussian(d, SIGMA_CELLS) for d in [0, 1, 2, 3, 4, 5]]
        for i in range(len(vals) - 1):
            assert vals[i] > vals[i + 1]

    def test_known_value_at_one_sigma(self) -> None:
        """At distance == sigma, value should be exp(-0.5) ~= 0.6065."""
        expected = math.exp(-0.5)
        assert _gaussian(SIGMA_CELLS, SIGMA_CELLS) == pytest.approx(expected, rel=1e-9)

    def test_large_distance_approaches_zero(self) -> None:
        """At very large distances the Gaussian should be essentially zero."""
        assert _gaussian(100.0, 1.0) == pytest.approx(0.0, abs=1e-100)


# ---------------------------------------------------------------------------
# Tests: _mean
# ---------------------------------------------------------------------------


class TestMean:
    """Tests for the _mean() helper."""

    def test_empty_returns_zero(self) -> None:
        """Mean of an empty list is defined as 0.0."""
        assert _mean([]) == 0.0

    def test_single_element(self) -> None:
        """Mean of a single-element list is that element."""
        assert _mean([42.0]) == 42.0

    def test_typical_case(self) -> None:
        """Mean of [1, 2, 3, 4, 5] is 3.0."""
        assert _mean([1.0, 2.0, 3.0, 4.0, 5.0]) == pytest.approx(3.0)

    def test_negative_values(self) -> None:
        """Mean works correctly with negative values (typical for RSSI)."""
        assert _mean([-60.0, -70.0, -80.0]) == pytest.approx(-70.0)


# ---------------------------------------------------------------------------
# Tests: _std
# ---------------------------------------------------------------------------


class TestStd:
    """Tests for the _std() (sample std-dev, N-1) helper."""

    def test_empty_returns_zero(self) -> None:
        """Std of empty list is 0.0."""
        assert _std([]) == 0.0

    def test_single_element_returns_zero(self) -> None:
        """Std of a single-element list is 0.0 (not enough data)."""
        assert _std([99.0]) == 0.0

    def test_identical_values(self) -> None:
        """Std of identical values is 0.0."""
        assert _std([5.0, 5.0, 5.0, 5.0]) == pytest.approx(0.0)

    def test_known_std(self) -> None:
        """Sample std (N-1) of [2, 4, 4, 4, 5, 5, 7, 9] is sqrt(32/7)."""
        vals = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]
        assert _std(vals) == pytest.approx(math.sqrt(32.0 / 7.0))


# ---------------------------------------------------------------------------
# Tests: compute_coverage
# ---------------------------------------------------------------------------


class TestComputeCoverage:
    """Tests for CalibrationStore.compute_coverage()."""

    def test_empty_map_all_zeros(self) -> None:
        """Coverage grid with no points should be all zeros."""
        store = _make_store()
        result = store.compute_coverage("map1")

        assert result["point_count"] == 0
        assert result["covered_cells"] == 0
        assert result["coverage_pct"] == 0.0
        assert len(result["grid"]) == GRID_N * GRID_N
        assert all(v == 0.0 for v in result["grid"])

    def test_center_point_creates_nonzero_coverage(self) -> None:
        """A single point at the center should produce a non-zero coverage grid."""
        store = _make_store(points=[_make_point(x_frac=0.5, y_frac=0.5)])
        result = store.compute_coverage("map1")

        assert result["point_count"] == 1
        assert result["covered_cells"] > 0
        assert result["coverage_pct"] > 0.0
        assert any(v > 0.0 for v in result["grid"])

    def test_next_target_always_present(self) -> None:
        """Result always includes a next_target with valid fractional coordinates."""
        store = _make_store()
        result = store.compute_coverage("map1")

        nt = result["next_target"]
        assert 0.0 <= nt["x_frac"] <= 1.0
        assert 0.0 <= nt["y_frac"] <= 1.0
        assert "score" in nt

    def test_filters_by_map_id(self) -> None:
        """Points on a different map are not included in coverage."""
        store = _make_store(points=[
            _make_point(map_id="mapA", x_frac=0.5, y_frac=0.5),
            _make_point(map_id="mapB", x_frac=0.1, y_frac=0.1),
        ])
        result = store.compute_coverage("mapA")
        assert result["point_count"] == 1

    def test_grid_values_capped_at_one(self) -> None:
        """Even with many overlapping points, grid values should not exceed 1.0."""
        pts = [_make_point(x_frac=0.5, y_frac=0.5) for _ in range(20)]
        store = _make_store(points=pts)
        result = store.compute_coverage("map1")
        assert all(v <= 1.0 for v in result["grid"])


# ---------------------------------------------------------------------------
# Tests: fit_path_loss
# ---------------------------------------------------------------------------


class TestFitPathLoss:
    """Tests for CalibrationStore.fit_path_loss()."""

    def test_fewer_than_three_points_returns_none(self) -> None:
        """fit_path_loss requires at least 3 data points."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.5, readings={"scannerA": -50.0}),
            _make_point(x_frac=0.3, y_frac=0.5, readings={"scannerA": -60.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5)
        assert result is None

    def test_three_points_returns_model(self) -> None:
        """With three valid points the fit should return a model dict."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.5, readings={"scannerA": -45.0}),
            _make_point(x_frac=0.3, y_frac=0.5, readings={"scannerA": -55.0}),
            _make_point(x_frac=0.6, y_frac=0.5, readings={"scannerA": -65.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5)

        assert result is not None
        assert "n" in result
        assert "rssi_1m" in result
        assert "r_squared" in result
        assert result["point_count"] == 3
        # Path-loss exponent should be clamped to [0.5, 8.0]
        assert 0.5 <= result["n"] <= 8.0

    def test_ignores_close_points(self) -> None:
        """Points with distance < 0.02 from the scanner are ignored."""
        pts = [
            _make_point(x_frac=0.005, y_frac=0.5, readings={"scannerA": -30.0}),  # too close
            _make_point(x_frac=0.1, y_frac=0.5, readings={"scannerA": -50.0}),
            _make_point(x_frac=0.3, y_frac=0.5, readings={"scannerA": -60.0}),
            _make_point(x_frac=0.6, y_frac=0.5, readings={"scannerA": -70.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5)

        assert result is not None
        # The close point should have been dropped, leaving 3
        assert result["point_count"] == 3

    def test_filters_by_map_id(self) -> None:
        """When map_id is given, only points on that map are used."""
        pts = [
            _make_point(map_id="mapA", x_frac=0.1, y_frac=0.5, readings={"scannerA": -45.0}),
            _make_point(map_id="mapA", x_frac=0.3, y_frac=0.5, readings={"scannerA": -55.0}),
            _make_point(map_id="mapA", x_frac=0.6, y_frac=0.5, readings={"scannerA": -65.0}),
            _make_point(map_id="mapB", x_frac=0.1, y_frac=0.5, readings={"scannerA": -50.0}),
        ]
        store = _make_store(points=pts)
        result = store.fit_path_loss("scannerA", 0.0, 0.5, map_id="mapA")
        assert result is not None
        assert result["point_count"] == 3


# ---------------------------------------------------------------------------
# Tests: knn_locate
# ---------------------------------------------------------------------------


class TestKnnLocate:
    """Tests for CalibrationStore.knn_locate()."""

    def test_empty_store_returns_none(self) -> None:
        """No points means no location estimate."""
        store = _make_store()
        result = store.knn_locate({"scannerA": -60.0})
        assert result is None

    def test_empty_query_returns_none(self) -> None:
        """An empty query RSSI dict returns None."""
        store = _make_store(points=[
            _make_point(readings={"scannerA": -50.0}),
        ])
        result = store.knn_locate({})
        assert result is None

    def test_no_shared_scanners_returns_none(self) -> None:
        """When query and fingerprints share no scanners, return None."""
        store = _make_store(points=[
            _make_point(readings={"scannerA": -50.0}),
        ])
        result = store.knn_locate({"scannerB": -60.0})
        assert result is None

    def test_exact_match_returns_that_point(self) -> None:
        """When query exactly matches one fingerprint, result is near that point."""
        pts = [
            _make_point(x_frac=0.2, y_frac=0.3, room="kitchen",
                        readings={"s1": -50.0, "s2": -60.0}),
            _make_point(x_frac=0.8, y_frac=0.7, room="bedroom",
                        readings={"s1": -70.0, "s2": -40.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -50.0, "s2": -60.0})

        assert result is not None
        assert result["x_frac"] == pytest.approx(0.2, abs=0.05)
        assert result["y_frac"] == pytest.approx(0.3, abs=0.05)
        assert result["nearest_room"] == "kitchen"

    def test_k_used_capped(self) -> None:
        """k_used should not exceed the number of scoreable points."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, readings={"s1": -40.0}),
            _make_point(x_frac=0.9, y_frac=0.9, readings={"s1": -80.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -60.0}, k=5)
        assert result is not None
        assert result["k_used"] == 2  # only 2 points available

    def test_filters_by_map_id(self) -> None:
        """Only points matching the given map_id are considered."""
        pts = [
            _make_point(map_id="mapA", x_frac=0.1, y_frac=0.1, readings={"s1": -40.0}),
            _make_point(map_id="mapB", x_frac=0.9, y_frac=0.9, readings={"s1": -80.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -40.0}, map_id="mapA")
        assert result is not None
        assert result["k_used"] == 1

    def test_confidence_between_zero_and_one(self) -> None:
        """Confidence should be in range (0, 1]."""
        pts = [
            _make_point(x_frac=0.5, y_frac=0.5, readings={"s1": -55.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -55.0})
        assert result is not None
        assert 0.0 < result["confidence"] <= 1.0


# ---------------------------------------------------------------------------
# Tests: knn_locate TX-invariance (per-point mean-centering)
# ---------------------------------------------------------------------------


class TestKnnTxInvariance:
    """The k-NN metric must be invariant to a constant per-device TX offset."""

    def test_constant_offset_query_matches_point(self) -> None:
        """A query identical to a stored point but offset -12 dB on every
        scanner (different tag TX power) must match that point with high
        confidence."""
        pts = [
            _make_point(x_frac=0.2, y_frac=0.3, room="kitchen",
                        readings={"s1": -50.0, "s2": -60.0, "s3": -70.0, "s4": -55.0}),
            _make_point(x_frac=0.8, y_frac=0.7, room="bedroom",
                        readings={"s1": -75.0, "s2": -45.0, "s3": -58.0, "s4": -68.0}),
        ]
        store = _make_store(points=pts)
        # Kitchen fingerprint shifted by a constant -12 dB everywhere
        query = {"s1": -62.0, "s2": -72.0, "s3": -82.0, "s4": -67.0}
        result = store.knn_locate(query)

        assert result is not None
        assert result["nearest_room"] == "kitchen"
        assert result["x_frac"] == pytest.approx(0.2, abs=0.05)
        assert result["y_frac"] == pytest.approx(0.3, abs=0.05)
        assert result["confidence"] >= 0.9

    def test_shape_still_distinguishes_points(self) -> None:
        """Two points with the same mean RSSI but different SHAPE (which
        scanner is strong vs weak) must still be distinguished after
        mean-centering."""
        pts = [
            _make_point(x_frac=0.2, y_frac=0.2, room="kitchen",
                        readings={"s1": -50.0, "s2": -70.0}),
            _make_point(x_frac=0.8, y_frac=0.8, room="bedroom",
                        readings={"s1": -70.0, "s2": -50.0}),
        ]
        store = _make_store(points=pts)
        # Both fingerprints have mean -60; only shape differs. Query has
        # kitchen's shape (strong s1, weak s2), offset -8 dB.
        result = store.knn_locate({"s1": -58.0, "s2": -78.0})

        assert result is not None
        assert result["nearest_room"] == "kitchen"
        assert result["x_frac"] == pytest.approx(0.2, abs=0.05)

    def test_missing_scanner_penalty_stays_absolute(self) -> None:
        """A 1-shared-scanner point always has centered distance 0 — the
        absolute missing-scanner penalty must keep it from beating a
        full-coverage match."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, room="garage",
                        readings={"s1": -50.0}),
            _make_point(x_frac=0.7, y_frac=0.7, room="office",
                        readings={"s1": -52.0, "s2": -63.0, "s3": -71.0}),
        ]
        store = _make_store(points=pts)
        result = store.knn_locate({"s1": -52.0, "s2": -63.0, "s3": -71.0})

        assert result is not None
        assert result["nearest_room"] == "office"


# ---------------------------------------------------------------------------
# Tests: async_clear_map dirty-check (detached points must persist)
# ---------------------------------------------------------------------------


class TestClearMap:
    """Tests for CalibrationStore.async_clear_map()."""

    async def test_detached_points_are_persisted(self) -> None:
        """When every point on the map has metres (detach, not delete), the
        map_id='' mutation must still be saved and coverage invalidated."""
        pt = _make_point(map_id="mapA", readings={"s1": -50.0})
        pt["x_m"] = 3.0
        pt["y_m"] = 4.0
        store = _make_store(points=[pt])
        store.data["model"] = {"coverage_by_map": {"mapA": {"grid": []}}}

        removed = await store.async_clear_map("mapA")

        assert removed == 0  # detached, not deleted
        assert store.data["points"][0]["map_id"] == ""
        store.store.async_save.assert_awaited_once()
        assert "mapA" not in store.data["model"]["coverage_by_map"]

    async def test_untouched_map_does_not_save(self) -> None:
        """Clearing a map with no points must not persist or retrain."""
        pt = _make_point(map_id="mapA", readings={"s1": -50.0})
        store = _make_store(points=[pt])

        removed = await store.async_clear_map("mapZ")

        assert removed == 0
        store.store.async_save.assert_not_awaited()


# ---------------------------------------------------------------------------
# Tests: loo_accuracy
# ---------------------------------------------------------------------------


class TestLooAccuracy:
    """Tests for CalibrationStore.loo_accuracy()."""

    def test_too_few_points_returns_none(self) -> None:
        """Need at least KNN_K + 1 points for LOO to work."""
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, readings={"s1": -40.0}),
            _make_point(x_frac=0.5, y_frac=0.5, readings={"s1": -60.0}),
        ]
        store = _make_store(points=pts)
        result = store.loo_accuracy()
        assert result is None

    def test_returns_error_metrics_with_enough_points(self) -> None:
        """With KNN_K+1 points, LOO should return error metrics."""
        # Create KNN_K + 1 = 4 points with shared scanner
        pts = [
            _make_point(x_frac=0.1, y_frac=0.1, readings={"s1": -40.0, "s2": -70.0}),
            _make_point(x_frac=0.3, y_frac=0.3, readings={"s1": -50.0, "s2": -60.0}),
            _make_point(x_frac=0.6, y_frac=0.6, readings={"s1": -60.0, "s2": -50.0}),
            _make_point(x_frac=0.9, y_frac=0.9, readings={"s1": -75.0, "s2": -35.0}),
        ]
        store = _make_store(points=pts)
        result = store.loo_accuracy()

        assert result is not None
        assert "mean_error_frac" in result
        assert "median_error_frac" in result
        assert "max_error_frac" in result
        assert "point_count" in result
        assert "mean_error_m_est" in result
        assert result["point_count"] >= 1
        # Errors should be non-negative
        assert result["mean_error_frac"] >= 0.0
        assert result["median_error_frac"] >= 0.0
        assert result["max_error_frac"] >= 0.0
        # Mean error in metres is ~15x fractional error
        assert result["mean_error_m_est"] == pytest.approx(
            result["mean_error_frac"] * 15, abs=0.02
        )

    def test_filters_by_map_id(self) -> None:
        """LOO only considers points on the specified map."""
        pts_a = [
            _make_point(map_id="mapA", x_frac=i * 0.2, y_frac=i * 0.2,
                        readings={"s1": -40.0 - i * 10})
            for i in range(5)
        ]
        pts_b = [_make_point(map_id="mapB", x_frac=0.5, y_frac=0.5, readings={"s1": -55.0})]
        store = _make_store(points=pts_a + pts_b)

        result_a = store.loo_accuracy(map_id="mapA")
        result_b = store.loo_accuracy(map_id="mapB")

        assert result_a is not None
        assert result_b is None  # only 1 point on mapB, not enough


# ---------------------------------------------------------------------------
# Tests: loo_accuracy algorithm awareness (RF out-of-bag validation)
# ---------------------------------------------------------------------------


def _grid_points() -> list[dict]:
    """8 fraction-space points on a 2-scanner gradient for RF training."""
    pts = []
    for i in range(8):
        f = i / 7.0
        pts.append(_make_point(
            x_frac=round(f, 3),
            y_frac=round(f, 3),
            room="kitchen" if f < 0.5 else "bedroom",
            readings={"s1": -40.0 - 40.0 * f, "s2": -80.0 + 40.0 * f},
        ))
    return pts


class TestLooAlgorithm:
    """Tests for loo_accuracy(algorithm=...)."""

    def test_rf_untrained_returns_none(self) -> None:
        """RF validation with no trained forest returns None."""
        store = _make_store(points=_grid_points())
        result = store.loo_accuracy(algorithm="rf")
        assert result is None

    def test_rf_oob_returns_metrics(self) -> None:
        """RF validation uses out-of-bag trees and reports the same shape."""
        pts = _grid_points()
        store = _make_store(points=pts)
        rf = RandomForestLocator()
        rf.train(pts, use_metres=False)
        assert rf.is_trained
        store._rf = rf

        result = store.loo_accuracy(algorithm="rf")

        assert result is not None
        assert result["algorithm"] == "rf"
        assert result["validation"] == "oob"
        assert result["point_count"] >= 1
        assert result["mean_error_frac"] >= 0.0
        assert result["max_error_frac"] >= result["median_error_frac"]
        assert "mean_error_m_est" in result

    def test_default_algorithm_is_knn(self) -> None:
        """Default call reports the k-NN metric (backward compatible)."""
        store = _make_store(points=_grid_points())
        result = store.loo_accuracy()
        assert result is not None
        assert result["algorithm"] == "knn"


# ---------------------------------------------------------------------------
# Tests: async_remap_from_metres safety (issue #56 — corner pile-up)
# ---------------------------------------------------------------------------


class _FakeModel:
    """Model stub whose metres_to_map_frac returns preset fracs per (x_m, y_m)."""

    def __init__(self, mapping):
        self._mapping = mapping

    def metres_to_map_frac(self, x_m, y_m, map_id):
        return self._mapping.get((x_m, y_m))


def _remap_point(x_m: float, y_m: float, map_id: str = "map1", x_frac: float = 0.5, y_frac: float = 0.5) -> dict:
    p = _make_point(map_id=map_id, x_frac=x_frac, y_frac=y_frac)
    p["x_m"] = x_m
    p["y_m"] = y_m
    return p


async def test_remap_out_of_range_point_keeps_existing_fracs() -> None:
    """A point re-deriving outside the map keeps its fracs (no corner clamp)."""
    pts = [
        _remap_point(1.0, 1.0, x_frac=0.4, y_frac=0.4),   # re-derives in range
        _remap_point(2.0, 2.0, x_frac=0.7, y_frac=0.7),   # re-derives NEGATIVE
    ]
    store = _make_store(pts)
    store._model = _FakeModel({(1.0, 1.0): (0.3, 0.3), (2.0, 2.0): (-0.4, -0.6)})
    count = await store.async_remap_from_metres("map1")
    assert count == 1
    assert store.data["points"][0]["x_frac"] == 0.3
    # The bad point was NOT clamped to (0,0) — old behavior — nor moved at all
    assert store.data["points"][1]["x_frac"] == 0.7
    assert store.data["points"][1]["y_frac"] == 0.7


async def test_remap_aborts_when_majority_out_of_range() -> None:
    """If most owned points re-derive out of range, the whole remap is a no-op."""
    pts = [
        _remap_point(1.0, 1.0, x_frac=0.1, y_frac=0.1),
        _remap_point(2.0, 2.0, x_frac=0.2, y_frac=0.2),
        _remap_point(3.0, 3.0, x_frac=0.3, y_frac=0.3),
    ]
    store = _make_store(pts)
    store._model = _FakeModel({
        (1.0, 1.0): (0.5, 0.5),      # fine
        (2.0, 2.0): (-1.0, -1.0),    # out of range
        (3.0, 3.0): (-2.0, -2.0),    # out of range
    })
    count = await store.async_remap_from_metres("map1")
    assert count == 0
    for i, orig in enumerate([0.1, 0.2, 0.3]):
        assert store.data["points"][i]["x_frac"] == orig
    store.store.async_save.assert_not_awaited()


async def test_remap_orphan_adoption_still_works() -> None:
    """Orphans (map_id='') inside the map are still adopted with fracs set."""
    orphan = _remap_point(1.0, 1.0, map_id="", x_frac=0.9, y_frac=0.9)
    store = _make_store([orphan])
    store._model = _FakeModel({(1.0, 1.0): (0.25, 0.75)})
    count = await store.async_remap_from_metres("map1")
    assert count == 1
    assert store.data["points"][0]["map_id"] == "map1"
    assert store.data["points"][0]["x_frac"] == 0.25


# ---------------------------------------------------------------------------
# End-to-end chain repro (issue #56): a 3D-alignment-style save demotes the
# master map, the transform recompute rebases the origin from stack offsets,
# and the calibration remap — driven by the REAL ModelStore math, not a stub —
# must refuse to destroy the points.
# ---------------------------------------------------------------------------

from custom_components.padspan_ha.model_store import ModelStore  # noqa: E402


def _real_model(transform: dict) -> ModelStore:
    m = ModelStore.__new__(ModelStore)
    m.hass = MagicMock()
    m.store = AsyncMock()
    m.store.async_save = AsyncMock()
    m.data = {"map_transforms": {"map1": dict(transform)}}
    return m


async def test_issue56_chain_origin_rebase_cannot_destroy_calibration() -> None:
    """Replays erkr's #56 damage steps against real transform math.

    Ground map measured as master: origin (0,0), 10m x 8m.  Points recorded
    in metres well inside the map.  The 3D alignment save flips is_master
    off and leaves stack offsets, after which the recompute path derives
    origin = offset * scale — here (6.0, 4.0) — so most points re-derive to
    negative fracs.  Pre-0.22.3 the remap clamped them all to (0,0); now it
    must abort and leave every frac untouched.
    """
    model = _real_model({
        "origin_x_m": 0.0, "origin_y_m": 0.0,
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    pts = [
        _remap_point(2.0, 2.0, x_frac=0.2, y_frac=0.25),
        _remap_point(3.0, 3.2, x_frac=0.3, y_frac=0.4),
        _remap_point(5.0, 4.0, x_frac=0.5, y_frac=0.5),
    ]
    cal = _make_store(pts)
    cal._model = model

    # Sanity: with the healthy transform the remap is a faithful no-op-ish
    # rewrite (fracs re-derive to their stored values).
    count = await cal.async_remap_from_metres("map1")
    assert count == 3
    assert cal.data["points"][0]["x_frac"] == pytest.approx(0.2)

    # The 3D-save consequence: origin rebased from stack offsets
    # (model_store.async_recompute_transform_for_map non-master branch:
    # origin = x_offset * scale) — is_master flipped off with offsets 0.6/0.5.
    model.data["map_transforms"]["map1"]["origin_x_m"] = 0.6 * 10.0
    model.data["map_transforms"]["map1"]["origin_y_m"] = 0.5 * 8.0

    # All three points now re-derive negative (e.g. (2-6)/10 = -0.4) —
    # exactly the condition that used to clamp the whole floor to (0,0).
    fx, fy = model.metres_to_map_frac(2.0, 2.0, "map1")
    assert fx < -0.05 and fy < -0.05

    count = await cal.async_remap_from_metres("map1")
    assert count == 0  # aborted as degenerate
    for p, (ox, oy) in zip(cal.data["points"], [(0.2, 0.25), (0.3, 0.4), (0.5, 0.5)]):
        assert p["x_frac"] == pytest.approx(ox)
        assert p["y_frac"] == pytest.approx(oy)
        assert (p["x_frac"], p["y_frac"]) != (0.0, 0.0)


# ---------------------------------------------------------------------------
# Re-anchor: the explicit, guarded way to change a map's world pose
# ---------------------------------------------------------------------------


async def test_reanchor_repairs_corrupted_origin() -> None:
    """The #56 recovery: metres are truth, an explicit re-anchor to the
    correct origin re-derives the pins back to consistency."""
    model = _real_model({
        "origin_x_m": 6.0, "origin_y_m": 4.0,        # corrupted by 3D-save flip
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    pts = [
        _remap_point(2.0, 2.0, x_frac=0.2, y_frac=0.25),
        _remap_point(3.0, 3.2, x_frac=0.3, y_frac=0.4),
        _remap_point(5.0, 4.0, x_frac=0.5, y_frac=0.5),
    ]
    cal = _make_store(pts)
    cal._model = model

    res = await model.async_reanchor_map(
        "map1", {"stack": {}}, cal,
        origin_x_m=0.0, origin_y_m=0.0, rotation_rad=0.0,
    )
    assert res["ok"] is True
    assert res["cal_points_remapped"] == 3
    t = model.data["map_transforms"]["map1"]
    assert t["origin_x_m"] == 0.0 and t["origin_y_m"] == 0.0
    assert t["origin_anchored"] is True
    # Pins re-derive to fracs consistent with their metres again.
    assert cal.data["points"][0]["x_frac"] == pytest.approx(0.2)
    assert cal.data["points"][0]["y_frac"] == pytest.approx(0.25)
    assert cal.data["points"][2]["x_frac"] == pytest.approx(0.5)
    # Metres untouched (write-once).
    assert cal.data["points"][0]["x_m"] == 2.0


async def test_reanchor_refuses_stranding_pose() -> None:
    """A pose that lands most pins off the map is refused with NO writes."""
    model = _real_model({
        "origin_x_m": 0.0, "origin_y_m": 0.0,
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    pts = [
        _remap_point(2.0, 2.0, x_frac=0.2, y_frac=0.25),
        _remap_point(5.0, 4.0, x_frac=0.5, y_frac=0.5),
    ]
    cal = _make_store(pts)
    cal._model = model

    res = await model.async_reanchor_map(
        "map1", {"stack": {}}, cal,
        origin_x_m=100.0, origin_y_m=100.0, rotation_rad=0.0,
    )
    assert res["ok"] is False
    assert res["error"] == "points_out_of_range"
    assert res["out_of_range"] == 2
    # Rolled back in memory, nothing persisted, fracs untouched.
    t = model.data["map_transforms"]["map1"]
    assert t["origin_x_m"] == 0.0 and t["origin_y_m"] == 0.0
    model.store.async_save.assert_not_awaited()
    cal.store.async_save.assert_not_awaited()
    assert cal.data["points"][0]["x_frac"] == pytest.approx(0.2)


async def test_reanchor_from_stack_uses_legacy_rules() -> None:
    """With no explicit pose the stack derives it — the one sanctioned
    'make the world match the display' path (master → origin (0,0))."""
    model = _real_model({
        "origin_x_m": 6.0, "origin_y_m": 4.0,        # corrupt
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    pts = [_remap_point(2.0, 2.0, x_frac=0.9, y_frac=0.9)]  # frac stale
    cal = _make_store(pts)
    cal._model = model

    res = await model.async_reanchor_map(
        "map1", {"stack": {"is_master": True, "rotation": 0}}, cal,
    )
    assert res["ok"] is True
    t = model.data["map_transforms"]["map1"]
    assert t["origin_x_m"] == 0.0 and t["origin_y_m"] == 0.0
    assert cal.data["points"][0]["x_frac"] == pytest.approx(0.2)  # repaired
    assert cal.data["points"][0]["y_frac"] == pytest.approx(0.25)


async def test_reanchor_unmeasured_map_errors() -> None:
    """No transform (or no scale) → nothing to re-anchor."""
    model = _real_model({"floor_id": "main"})
    res = await model.async_reanchor_map("map1", {"stack": {}}, None)
    assert res == {"ok": False, "error": "not_measured"}


async def test_reanchor_with_rotation_repairs_pins() -> None:
    """The rotation half of the pose works through the repair path: pins
    re-derive through the rotated frame and round-trip back to their metres."""
    import math as _math
    model = _real_model({
        "origin_x_m": 6.0, "origin_y_m": 4.0,        # corrupt
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    rot = _math.pi / 6                                # re-anchor to 30°
    # Pins whose metres sit inside the ROTATED frame at origin (1, 1).
    def _world(fx, fy):
        dx, dy = fx * 10.0, fy * 8.0
        return (1.0 + dx * _math.cos(rot) - dy * _math.sin(rot),
                1.0 + dx * _math.sin(rot) + dy * _math.cos(rot))
    targets = [(0.2, 0.25), (0.5, 0.5), (0.8, 0.4)]
    pts = [_remap_point(*_world(fx, fy), x_frac=0.9, y_frac=0.9)
           for fx, fy in targets]
    cal = _make_store(pts)
    cal._model = model

    res = await model.async_reanchor_map(
        "map1", {"stack": {}}, cal,
        origin_x_m=1.0, origin_y_m=1.0, rotation_rad=rot,
    )
    assert res["ok"] is True
    assert res["cal_points_remapped"] == 3
    t = model.data["map_transforms"]["map1"]
    assert t["rotation_rad"] == pytest.approx(rot, abs=1e-6)
    for p, (fx, fy) in zip(cal.data["points"], targets):
        assert p["x_frac"] == pytest.approx(fx, abs=1e-3)
        assert p["y_frac"] == pytest.approx(fy, abs=1e-3)


async def test_reanchor_partial_explicit_pose_keeps_other_fields() -> None:
    """Giving only origin_x_m selects the explicit branch; the unspecified
    fields come from the stored transform, not the stack."""
    model = _real_model({
        "origin_x_m": 6.0, "origin_y_m": 4.0,
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.25, "floor_id": "main",
    })
    res = await model.async_reanchor_map(
        "map1", {"stack": {"is_master": True, "rotation": 90}}, None,
        origin_x_m=2.0,
    )
    assert res["ok"] is True
    t = model.data["map_transforms"]["map1"]
    assert t["origin_x_m"] == 2.0                    # explicit
    assert t["origin_y_m"] == 4.0                    # from stored, NOT stack
    assert t["rotation_rad"] == pytest.approx(0.25)  # from stored, NOT stack


async def test_reanchor_does_not_adopt_orphans() -> None:
    """Re-anchor must not adopt foreign orphan pins (map_id='') — a wrong
    pose would claim them and the guard would then refuse the corrective
    re-anchor: a one-way ratchet (lean-review finding)."""
    model = _real_model({
        "origin_x_m": 0.0, "origin_y_m": 0.0,
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    pts = [
        _remap_point(5.0, 4.0, x_frac=0.5, y_frac=0.5),                # owned
        _remap_point(12.0, 12.0, map_id="", x_frac=0.1, y_frac=0.1),   # orphan
    ]
    cal = _make_store(pts)
    cal._model = model

    # Wrong pose (4,4): owned pin still in range, orphan lands in range too.
    res = await model.async_reanchor_map(
        "map1", {"stack": {}}, cal,
        origin_x_m=4.0, origin_y_m=4.0, rotation_rad=0.0,
    )
    assert res["ok"] is True
    assert cal.data["points"][1]["map_id"] == ""      # NOT adopted
    # The corrective re-anchor back to (0,0) is therefore still possible.
    res2 = await model.async_reanchor_map(
        "map1", {"stack": {}}, cal,
        origin_x_m=0.0, origin_y_m=0.0, rotation_rad=0.0,
    )
    assert res2["ok"] is True
    assert cal.data["points"][0]["x_frac"] == pytest.approx(0.5)      # restored
    # Normal map-save remap still adopts (behavior unchanged elsewhere).
    n = await cal.async_remap_from_metres("map1")
    assert cal.data["points"][1]["map_id"] == ""       # 12,12 out of range anyway
    assert n >= 1


async def test_reanchor_rolls_back_on_remap_failure() -> None:
    """A downstream save failure must not leave the new pose persisted over
    old fracs — full rollback of transform + calibration (codex review)."""
    model = _real_model({
        "origin_x_m": 6.0, "origin_y_m": 4.0,
        "scale_x_m": 10.0, "scale_y_m": 8.0,
        "rotation_rad": 0.0, "floor_id": "main",
    })
    pts = [_remap_point(2.0, 2.0, x_frac=0.9, y_frac=0.9)]
    cal = _make_store(pts)
    cal._model = model
    cal.store.async_save = AsyncMock(side_effect=OSError("disk full"))

    res = await model.async_reanchor_map(
        "map1", {"stack": {}}, cal,
        origin_x_m=0.0, origin_y_m=0.0, rotation_rad=0.0,
    )
    assert res["ok"] is False
    assert res["error"] == "remap_failed"
    t = model.data["map_transforms"]["map1"]
    assert t["origin_x_m"] == 6.0 and t["origin_y_m"] == 4.0   # rolled back
    assert cal.data["points"][0]["x_frac"] == pytest.approx(0.9)  # restored
