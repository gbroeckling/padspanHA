"""Unit tests for the PadSpan Pro light-placement fields on MapsStore.

Covers: default lights=[] on new maps, sanitisation/validation in
async_update_map, migration of legacy map dicts, and coordinate remapping on
crop (async_replace_image) and canvas extend/revert.
"""

from __future__ import annotations

import base64
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.maps_store import MapsStore


def _make_store(tmp_path: Path) -> MapsStore:
    hass = MagicMock()
    hass.config.path = lambda *parts: str(tmp_path.joinpath(*parts))

    store = MapsStore.__new__(MapsStore)
    store.hass = hass
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.maps_dir = tmp_path / "www" / "padspan_ha" / "maps"
    store.maps_dir.mkdir(parents=True, exist_ok=True)
    store.data = {"maps": []}
    return store


def _small_png_b64() -> str:
    raw = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(raw).decode()


async def _add_map(store: MapsStore, **overrides) -> dict:
    kwargs = dict(
        name="Living Room",
        filename="living.png",
        mime="image/png",
        width=800,
        height=600,
        png_base64=_small_png_b64(),
    )
    kwargs.update(overrides)
    return await store.async_add_map(**kwargs)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_map_has_empty_lights_list(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    assert info["lights"] == []


# ---------------------------------------------------------------------------
# async_update_map sanitisation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_lights_round_trip(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{
            "id": "lt_1",
            "entity_id": "light.kitchen_ceiling",
            "label": "Kitchen Ceiling",
            "x": 0.42,
            "y": 0.77,
            "color": "#ff00aa",
            "shape": "star",
            "rotation": 45,
        }],
    )
    assert len(updated["lights"]) == 1
    lt = updated["lights"][0]
    assert lt["entity_id"] == "light.kitchen_ceiling"
    assert lt["label"] == "Kitchen Ceiling"
    assert lt["x"] == pytest.approx(0.42)
    assert lt["y"] == pytest.approx(0.77)
    assert lt["color"] == "#ff00aa"
    assert lt["shape"] == "star"
    assert lt["rotation"] == 45


@pytest.mark.asyncio
async def test_update_lights_drops_non_light_entities(tmp_path: Path) -> None:
    """Only light.* entity_ids are accepted — anything else is dropped."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[
            {"entity_id": "switch.kitchen", "x": 0.5, "y": 0.5},
            {"entity_id": "light.valid", "x": 0.5, "y": 0.5},
            {"x": 0.5, "y": 0.5},  # missing entity_id entirely
        ],
    )
    eids = [lt["entity_id"] for lt in updated["lights"]]
    assert eids == ["light.valid"]


@pytest.mark.asyncio
async def test_update_lights_clamps_coordinates(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": -5, "y": 99}],
    )
    lt = updated["lights"][0]
    assert lt["x"] == 0.0
    assert lt["y"] == 1.0


@pytest.mark.asyncio
async def test_update_lights_invalid_color_falls_back_to_default(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "color": "not-a-color"}],
    )
    assert updated["lights"][0]["color"] == "#fbbf24"


@pytest.mark.asyncio
async def test_update_lights_valid_color_preserved(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "color": "#123ABC"}],
    )
    assert updated["lights"][0]["color"] == "#123ABC"


@pytest.mark.asyncio
async def test_update_lights_invalid_shape_falls_back_to_circle(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "shape": "rhombus"}],
    )
    assert updated["lights"][0]["shape"] == "circle"


@pytest.mark.asyncio
async def test_update_lights_rotation_normalised_mod_360(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "rotation": 725}],
    )
    assert updated["lights"][0]["rotation"] == pytest.approx(5.0)


@pytest.mark.asyncio
async def test_update_lights_capped_at_500(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    many = [{"entity_id": f"light.l{i}", "x": 0.5, "y": 0.5} for i in range(600)]
    updated = await store.async_update_map(info["id"], lights=many)
    assert len(updated["lights"]) == 500


@pytest.mark.asyncio
async def test_update_lights_none_leaves_existing_untouched(tmp_path: Path) -> None:
    """Passing lights=None (field omitted by caller) must not clear existing pins."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    await store.async_update_map(
        info["id"], lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5}]
    )
    updated = await store.async_update_map(info["id"], notes="just a note")
    assert len(updated["lights"]) == 1
    assert updated["notes"] == "just a note"


# ---------------------------------------------------------------------------
# Migration of legacy map dicts (async_setup)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_async_setup_backfills_lights_on_legacy_maps(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    legacy_map = {
        "id": "legacy1",
        "name": "Old Map",
        "image": {"filename": "old.png", "width": 10, "height": 10},
        "receivers": [],
        "beacons": [],
        "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
        "room_bounds": {},
        "rf_barriers": [],
        "floor_id": "main",
        "notes": "",
        "stack": {},
        # deliberately no "lights" key — simulates data saved before this feature
    }
    store.store.async_load = AsyncMock(return_value={"maps": [legacy_map]})
    await store.async_setup()
    assert store.get_map("legacy1")["lights"] == []


# ---------------------------------------------------------------------------
# Coordinate remapping on crop / canvas extend / revert
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replace_image_crop_remaps_light_positions(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store, width=100, height=100)
    await store.async_update_map(
        info["id"], lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5}]
    )
    # Crop to the right half of the image: fx0=0.5..fx1=1.0, full height
    updated = await store.async_replace_image(
        map_id=info["id"],
        png_base64=_small_png_b64(),
        width=1,
        height=1,
        crop={"fx0": 0.5, "fy0": 0.0, "fx1": 1.0, "fy1": 1.0},
    )
    lt = updated["lights"][0]
    # x=0.5 was exactly at the crop's left edge -> renormalised to 0.0
    assert lt["x"] == pytest.approx(0.0)
    assert lt["y"] == pytest.approx(0.5)


@pytest.mark.asyncio
async def test_extend_and_revert_canvas_round_trips_light_position(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store, width=100, height=100)
    await store.async_update_map(
        info["id"], lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5}]
    )

    extended = await store.async_extend_canvas(info["id"], 0.2, 0.0, 0.0, 0.0)
    lt = extended["lights"][0]
    # Old width 100 becomes new width 120 (20% padding added on the left);
    # the point that was at the horizontal centre shifts right proportionally.
    assert lt["x"] == pytest.approx((20 + 50) / 120, abs=1e-6)
    assert lt["y"] == pytest.approx(0.5)

    reverted = await store.async_revert_extend(info["id"])
    lt2 = reverted["lights"][0]
    assert lt2["x"] == pytest.approx(0.5, abs=1e-6)
    assert lt2["y"] == pytest.approx(0.5, abs=1e-6)
