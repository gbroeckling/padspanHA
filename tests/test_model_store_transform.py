"""Unit tests for ModelStore.async_recompute_transform_for_map."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.model_store import ModelStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store(transform: dict) -> ModelStore:
    """Create a ModelStore holding a single map transform for map id "m1"."""
    store = ModelStore.__new__(ModelStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_save = AsyncMock()
    store.data = {"map_transforms": {"m1": dict(transform)}}
    return store


def _map(width: int, height: int, **kw) -> dict:
    """A map dict with the given NEW image dimensions."""
    m = {
        "id": "m1",
        "floor_id": "main",
        "image": {"width": width, "height": height},
        "stack": {"is_master": True},
        "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
    }
    m.update(kw)
    return m


# A map measured at 20 px/m: 1600x1200 px image covering 80m x 60m.
_MEASURED = {
    "origin_x_m": 0.0,
    "origin_y_m": 0.0,
    "scale_x_m": 80.0,
    "scale_y_m": 60.0,
    "rotation_rad": 0.0,
    "floor_id": "main",
    "reference_measurements": [
        {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "distance_m": 40.0,
         "px_per_meter": 20.0, "angle_deg": 0, "date": "2026-07-01"},
    ],
}


# ---------------------------------------------------------------------------
# Crop-aware rescaling
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_crop_scales_extent_by_retained_fraction(tmp_path: Path) -> None:
    """Cropping to the middle half keeps half the real-world extent."""
    store = _make_store(_MEASURED)
    # Kept x 0.25-0.75 (half) and y 0.2-0.8 (60%); client resampled to 800x720.
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(800, 720), MagicMock(),
        crop={"fx0": 0.25, "fy0": 0.2, "fx1": 0.75, "fy1": 0.8},
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(40.0)   # 80 * 0.50
    assert t["scale_y_m"] == pytest.approx(36.0)   # 60 * 0.60


@pytest.mark.asyncio
async def test_crop_extent_is_independent_of_resample(tmp_path: Path) -> None:
    """The retained extent must not depend on the pixel dimensions chosen."""
    crop = {"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5}
    results = []
    for w, h in ((800, 600), (1600, 1200), (137, 103)):
        store = _make_store(_MEASURED)
        await store.async_recompute_transform_for_map(
            "m1", _map(w, h), MagicMock(), crop=crop
        )
        t = store.data["map_transforms"]["m1"]
        results.append((t["scale_x_m"], t["scale_y_m"]))
    assert results == [(40.0, 30.0)] * 3


@pytest.mark.asyncio
async def test_no_crop_preserves_extent_across_resample(tmp_path: Path) -> None:
    """A pure resample (rotate/replace, no crop) keeps the real-world extent."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(), crop=None
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)
    assert t["scale_y_m"] == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_degenerate_crop_falls_back_to_extent(tmp_path: Path) -> None:
    """A zero-area crop rectangle must not produce a zero-metre map."""
    store = _make_store(_MEASURED)
    ok = await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(),
        crop={"fx0": 0.4, "fy0": 0.4, "fx1": 0.4, "fy1": 0.4},
    )
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)
    assert t["scale_y_m"] == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_legacy_px_per_meter_still_honoured(tmp_path: Path) -> None:
    """Maps carrying legacy calibration px_per_meter keep using it (no crop)."""
    store = _make_store({"scale_x_m": 80.0, "scale_y_m": 60.0, "floor_id": "main"})
    m = _map(800, 600)
    m["calibration"]["px_per_meter"] = 10.0
    ok = await store.async_recompute_transform_for_map("m1", m, MagicMock())
    assert ok
    t = store.data["map_transforms"]["m1"]
    assert t["scale_x_m"] == pytest.approx(80.0)   # 800 px / 10 px per m
    assert t["scale_y_m"] == pytest.approx(60.0)


@pytest.mark.asyncio
async def test_unmeasured_map_without_transform_is_skipped(tmp_path: Path) -> None:
    """With neither calibration nor a prior transform there is nothing to recover."""
    store = _make_store({})
    store.data["map_transforms"] = {}
    ok = await store.async_recompute_transform_for_map("m1", _map(800, 600), MagicMock())
    assert ok is False


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_reference_measurements_survive_recompute(tmp_path: Path) -> None:
    """Replacing an image must not un-measure the map."""
    store = _make_store(_MEASURED)
    await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5},
    )
    t = store.data["map_transforms"]["m1"]
    assert t.get("reference_measurements") == _MEASURED["reference_measurements"]


@pytest.mark.asyncio
async def test_crop_is_world_anchored(tmp_path: Path) -> None:
    """A crop shifts the origin by the cut-off margin so world coords hold.

    The stack-offset origin formula must NOT apply here — fabric data is
    stored in old world coordinates and the cropped image's frac (0,0) now
    sits at (fx0·scale_x, fy0·scale_y) in that world.
    """
    store = _make_store(_MEASURED)
    m = _map(800, 720, stack={"is_master": False, "x_offset": 0.5, "y_offset": 0.25})
    await store.async_recompute_transform_for_map(
        "m1", m, MagicMock(),
        crop={"fx0": 0.25, "fy0": 0.2, "fx1": 0.75, "fy1": 0.8},
    )
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(20.0)   # 0.25 * 80
    assert t["origin_y_m"] == pytest.approx(12.0)   # 0.20 * 60


@pytest.mark.asyncio
async def test_crop_roundtrips_fabric_position(tmp_path: Path) -> None:
    """A scanner's world position re-derives to the right frac after a trim.

    Regression for the origin bug: with the origin left at (0,0) the pin
    landed displaced by exactly the cut-off left/top margin.
    """
    store = _make_store(_MEASURED)
    # Scanner at world (30, 15): frac (0.375, 0.25) on the original map.
    await store.async_recompute_transform_for_map(
        "m1", _map(800, 720), MagicMock(),
        crop={"fx0": 0.25, "fy0": 0.2, "fx1": 0.75, "fy1": 0.8},
    )
    fx, fy = store.metres_to_map_frac(30.0, 15.0, "m1")
    # In the cropped image: ((0.375-0.25)/0.5, (0.25-0.2)/0.6)
    assert fx == pytest.approx(0.25)
    assert fy == pytest.approx(0.0833, abs=1e-3)
    # And the inverse agrees.
    wx, wy = store.map_frac_to_metres(fx, fy, "m1")
    assert (wx, wy) == (pytest.approx(30.0), pytest.approx(15.0))


@pytest.mark.asyncio
async def test_full_frame_crop_keeps_origin(tmp_path: Path) -> None:
    """A crop starting at (0,0) leaves the origin where it was."""
    store = _make_store(_MEASURED)
    await store.async_recompute_transform_for_map(
        "m1", _map(800, 600), MagicMock(),
        crop={"fx0": 0.0, "fy0": 0.0, "fx1": 0.5, "fy1": 0.5},
    )
    t = store.data["map_transforms"]["m1"]
    assert t["origin_x_m"] == pytest.approx(0.0)
    assert t["origin_y_m"] == pytest.approx(0.0)
