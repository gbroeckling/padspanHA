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
    """x/y are NOT clamped to 0-1 like room_bounds/receivers/beacons — a
    light's position is a point in a floor's shared real-world space
    expressed through one map's calibration, and a floor with multiple maps
    legitimately needs positions well outside any single map's own 0-1
    photo footprint. Only a generous sanity bound guards against garbage."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": -999, "y": 999}],
    )
    lt = updated["lights"][0]
    assert lt["x"] == -50.0
    assert lt["y"] == 50.0


@pytest.mark.asyncio
async def test_update_lights_allows_coordinates_beyond_unit_range(tmp_path: Path) -> None:
    """A light seeded in a neighbouring room covered by a different map's
    photo (e.g. via Add to Room / drag) needs a fraction outside 0-1 against
    THIS map's calibration to round-trip to the correct real-world spot."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 1.75, "y": -0.4}],
    )
    lt = updated["lights"][0]
    assert lt["x"] == pytest.approx(1.75)
    assert lt["y"] == pytest.approx(-0.4)


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
async def test_update_lights_size_defaults_to_15cm(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5}],
    )
    lt = updated["lights"][0]
    assert lt["width_cm"] == pytest.approx(15.0)
    assert lt["height_cm"] == pytest.approx(15.0)


@pytest.mark.asyncio
async def test_update_lights_size_clamped_to_sane_range(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "width_cm": -5, "height_cm": 5000}],
    )
    lt = updated["lights"][0]
    assert lt["width_cm"] == pytest.approx(1.0)
    assert lt["height_cm"] == pytest.approx(1000.0)


@pytest.mark.asyncio
async def test_update_lights_size_independent_width_height_preserved(tmp_path: Path) -> None:
    """A linear light strip (long + thin) must keep its aspect ratio, not get squared off."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "shape": "pill", "width_cm": 60, "height_cm": 8}],
    )
    lt = updated["lights"][0]
    assert lt["shape"] == "pill"
    assert lt["width_cm"] == pytest.approx(60.0)
    assert lt["height_cm"] == pytest.approx(8.0)


@pytest.mark.asyncio
async def test_update_lights_new_shape_library_accepted(tmp_path: Path) -> None:
    store = _make_store(tmp_path)
    info = await _add_map(store)
    shapes = ["circle", "rect", "rounded_rect", "pill", "hex", "triangle",
              "diamond", "pentagon", "octagon", "star", "bulb"]
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": f"light.l{i}", "x": 0.5, "y": 0.5, "shape": s} for i, s in enumerate(shapes)],
    )
    assert [lt["shape"] for lt in updated["lights"]] == shapes


@pytest.mark.asyncio
async def test_update_lights_legacy_square_shape_maps_to_rect(tmp_path: Path) -> None:
    """'square' was a valid shape before the shape library was expanded —
    a light saved with it must not silently revert to 'circle' the next
    time that map's lights are saved."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "shape": "square"}],
    )
    assert updated["lights"][0]["shape"] == "rect"


@pytest.mark.asyncio
async def test_update_lights_explicit_zero_size_clamps_not_defaults(tmp_path: Path) -> None:
    """width_cm/height_cm: 0 is out-of-range input and must clamp to the
    1cm floor, not be treated as "not provided" and silently replaced with
    the 15cm default."""
    store = _make_store(tmp_path)
    info = await _add_map(store)
    updated = await store.async_update_map(
        info["id"],
        lights=[{"entity_id": "light.a", "x": 0.5, "y": 0.5, "width_cm": 0, "height_cm": 0}],
    )
    lt = updated["lights"][0]
    assert lt["width_cm"] == pytest.approx(1.0)
    assert lt["height_cm"] == pytest.approx(1.0)


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
