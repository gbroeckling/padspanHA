"""Unit tests for FabricStore — the independent room-geometry ground truth.

Covers the two (and only two) geometry writers, the committed-floor guards,
the one-time legacy import, and ModelStore's read-through. The invariant
under test throughout: after a floor is built, no map/transform state can
reach room geometry — only commit_floor (bootstrap/overwrite) and
correct_room may write.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.fabric_store import FabricStore, _norm_geometry
from custom_components.padspan_ha.model_store import ModelStore


def _make_fabric(data: dict | None = None) -> FabricStore:
    fab = FabricStore.__new__(FabricStore)
    fab.hass = MagicMock()
    fab.store = AsyncMock()
    fab.store.async_save = AsyncMock()
    fab.data = data if data is not None else {"floors": {}, "history": []}
    return fab


def _make_model(transforms: dict | None = None) -> ModelStore:
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.store.async_save = AsyncMock()
    mdl.data = {"map_transforms": transforms or {}}
    mdl.fabric = None
    return mdl


def _maps_store(maps: list[dict]):
    ms = MagicMock()
    ms.data = {"maps": maps}
    return ms


_SQUARE = {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]]}


# ---------------------------------------------------------------------------
# Geometry validation
# ---------------------------------------------------------------------------


def test_norm_geometry_poly_valid() -> None:
    out = _norm_geometry({"type": "poly", "points_m": [[0, 0], [1.23456, 0], [1, 2]]})
    assert out == {"type": "poly", "points_m": [[0.0, 0.0], [1.235, 0.0], [1.0, 2.0]]}


def test_norm_geometry_rejects_bad_shapes() -> None:
    assert _norm_geometry(None) is None
    assert _norm_geometry({"type": "poly", "points_m": [[0, 0], [1, 1]]}) is None
    assert _norm_geometry({"type": "poly", "points_m": [[0, 0], [1, 1], [float("nan"), 2]]}) is None
    assert _norm_geometry({"type": "circle", "cx_m": 1, "cy_m": 2, "r_m": 0}) is None
    assert _norm_geometry({"type": "circle", "cx_m": 1, "cy_m": 2}) is None
    assert _norm_geometry({"type": "blob"}) is None


def test_norm_geometry_circle_valid() -> None:
    out = _norm_geometry({"type": "circle", "cx_m": 1.0, "cy_m": 2.0, "r_m": 0.5})
    assert out == {"type": "circle", "cx_m": 1.0, "cy_m": 2.0, "r_m": 0.5}


# ---------------------------------------------------------------------------
# Legacy import (one-time, only when the storage file doesn't exist)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_setup_imports_legacy_verbatim_on_first_load() -> None:
    fab = _make_fabric()
    fab.store.async_load = AsyncMock(return_value=None)
    legacy = {
        "Kitchen": {"type": "poly", "floor_id": "main", "origin": "map",
                    "points_m": [[0, 0], [4, 0], [4, 3]]},
        "Office": {"type": "circle", "floor_id": "upper", "cx_m": 1, "cy_m": 2, "r_m": 1.5},
        "Broken": {"type": "poly", "floor_id": "main", "points_m": [[0, 0]]},
    }
    await fab.async_setup(legacy_geometry=legacy)

    rooms = fab.rooms_flat()
    assert set(rooms) == {"Kitchen", "Office"}          # invalid entry skipped
    assert rooms["Kitchen"]["committed_by"] == "legacy_import"
    assert rooms["Kitchen"]["source_map_id"] is None    # unrecoverable — never guessed
    assert rooms["Kitchen"]["points_m"] == [[0.0, 0.0], [4.0, 0.0], [4.0, 3.0]]
    assert rooms["Office"]["floor_id"] == "upper"
    # Imported floors start UNcommitted — Garry corrects, then finalizes.
    assert fab.floor_committed("main") is False
    fab.store.async_save.assert_awaited()


@pytest.mark.asyncio
async def test_setup_never_imports_over_existing_store() -> None:
    existing = {"floors": {"main": {"committed": True, "committed_at": "t",
                                    "rooms": {"Kitchen": {**_SQUARE, "floor_id": "main"}},
                                    "frame_offset_m": {}}},
                "history": []}
    fab = _make_fabric()
    fab.store.async_load = AsyncMock(return_value=existing)
    await fab.async_setup(legacy_geometry={"Intruder": {**_SQUARE, "floor_id": "main"}})
    assert set(fab.rooms_flat()) == {"Kitchen"}         # legacy ignored once store exists


# ---------------------------------------------------------------------------
# Writer 2: async_correct_room
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_correct_room_creates_and_bumps_revision() -> None:
    fab = _make_fabric()
    r1 = await fab.async_correct_room("main", "Kitchen", _SQUARE)
    assert r1 == {"ok": True, "floor_id": "main", "room": "Kitchen", "revision": 1}
    r2 = await fab.async_correct_room("main", "Kitchen", _SQUARE)
    assert r2["revision"] == 2
    entry = fab.rooms_flat()["Kitchen"]
    assert entry["committed_by"] == "correction"
    assert entry["floor_id"] == "main"


@pytest.mark.asyncio
async def test_correct_room_always_allowed_on_committed_floor() -> None:
    fab = _make_fabric()
    await fab.async_correct_room("main", "Kitchen", _SQUARE)
    await fab.async_set_floor_committed("main", True)
    res = await fab.async_correct_room("main", "Kitchen", _SQUARE)
    assert res["ok"] is True and res["revision"] == 2


@pytest.mark.asyncio
async def test_correct_room_rejects_invalid() -> None:
    fab = _make_fabric()
    assert (await fab.async_correct_room("main", "", _SQUARE))["error"] == "invalid_room"
    bad = await fab.async_correct_room("main", "Kitchen", {"type": "poly", "points_m": []})
    assert bad["error"] == "invalid_geometry"
    fab.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_correct_room_refuses_cross_floor() -> None:
    fab = _make_fabric()
    await fab.async_correct_room("main", "Kitchen", _SQUARE)
    res = await fab.async_correct_room("upper", "Kitchen", _SQUARE)
    assert res == {"ok": False, "error": "room_on_other_floor", "floor_id": "main"}


@pytest.mark.asyncio
async def test_external_import_is_merge_only() -> None:
    fab = _make_fabric()
    await fab.async_correct_room("main", "Kitchen", _SQUARE)
    res = await fab.async_correct_room(
        "main", "Kitchen", _SQUARE, committed_by="external_import")
    assert res["ok"] is False and res["error"] == "exists"
    new = await fab.async_correct_room(
        "main", "Pantry", _SQUARE, committed_by="external_import")
    assert new["ok"] is True
    assert fab.rooms_flat()["Pantry"]["committed_by"] == "external_import"


@pytest.mark.asyncio
async def test_finalize_and_unlock_touch_only_the_flag() -> None:
    fab = _make_fabric()
    await fab.async_correct_room("main", "Kitchen", _SQUARE)
    before = fab.rooms_flat()["Kitchen"]
    res = await fab.async_set_floor_committed("main", True)
    assert res["committed"] is True
    assert fab.floor_committed("main") is True
    assert fab.floors_status()["main"]["committed_at"] is not None
    assert fab.rooms_flat()["Kitchen"] == before
    res = await fab.async_set_floor_committed("main", False)
    assert res["committed"] is False
    assert fab.floors_status()["main"]["committed_at"] is None


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_history_appends_and_caps() -> None:
    from custom_components.padspan_ha import fabric_store as fs
    fab = _make_fabric()
    await fab.async_correct_room("main", "Kitchen", _SQUARE)
    assert fab.data["history"][-1]["op"] == "correction"
    for i in range(fs._HISTORY_CAP + 20):
        fab._log_history("main", f"r{i}", "correction", 1)
    assert len(fab.data["history"]) == fs._HISTORY_CAP


# ---------------------------------------------------------------------------
# ModelStore read-through
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_model_store_reads_through_fabric() -> None:
    fab = _make_fabric()
    await fab.async_correct_room("main", "Kitchen", _SQUARE)
    await fab.async_correct_room("upper", "Loft",
                                 {"type": "circle", "cx_m": 2, "cy_m": 2, "r_m": 1})
    mdl = _make_model()
    mdl.data.update({"floors": [], "room_meta": {}, "room_geometry_m": {"Stale": {}}})
    mdl.attach_fabric(fab)

    geo = mdl.room_geometry_m()
    assert set(geo) == {"Kitchen", "Loft"}                    # never the stale legacy copy
    assert mdl.snapshot()["room_geometry_m"] == geo

    cents = mdl.room_centroids_m()
    assert cents["Kitchen"] == (pytest.approx(2.0), pytest.approx(1.5), "main")
    assert cents["Loft"] == (2.0, 2.0, "upper")

    assert mdl.beacon_room_from_geometry(2.0, 1.5, "main") == "Kitchen"
    assert mdl.beacon_room_from_geometry(2.0, 1.5, "upper") == "Loft"
    assert mdl.beacon_room_from_geometry(50.0, 50.0, "main") == ""
    assert mdl.has_spatial_model() is True


def test_model_store_without_fabric_is_empty_not_stale() -> None:
    mdl = _make_model()
    mdl.data["room_geometry_m"] = {"Stale": {"type": "poly", "floor_id": "main",
                                             "points_m": [[0, 0], [1, 0], [1, 1]]}}
    # No fabric attached: loud empty, never the legacy cache.
    assert mdl.room_geometry_m() == {}
    assert mdl.beacon_room_from_geometry(0.5, 0.5, "main") == ""


# ---------------------------------------------------------------------------
# Pass 2: spatial ground truth (scanners / beacons / barriers)
# ---------------------------------------------------------------------------


def _spatial_fabric() -> FabricStore:
    return _make_fabric({
        "floors": {}, "scanner_positions_m": {}, "beacon_positions_m": {},
        "rf_barriers_m": [], "light_positions_m": {}, "history": [],
    })


@pytest.mark.asyncio
async def test_spatial_import_once_per_key() -> None:
    """A pass-1 fabric file (no spatial keys) imports each key exactly once."""
    fab = _make_fabric()
    fab.store.async_load = AsyncMock(return_value={"floors": {}, "history": []})
    legacy = {
        "scanner_positions_m": {"kitchen": {"x_m": 1.0, "y_m": 2.0, "z_m": 2.4, "floor_id": "main"}},
        "beacon_positions_m": {"b1": {"x_m": 3.0, "y_m": 4.0, "floor_id": "main", "room": "K"}},
        "rf_barriers_m": [{"name": "Wall", "points_m": [[0, 0], [1, 0]], "floor_id": "main"}],
    }
    await fab.async_setup(legacy_spatial=legacy)
    assert fab.scanner_positions_m()["kitchen"]["x_m"] == 1.0
    assert fab.beacon_positions_m()["b1"]["room"] == "K"
    assert fab.rf_barriers_m()[0]["name"] == "Wall"
    fab.store.async_save.assert_awaited()

    # Second boot: keys exist (even if emptied) — legacy must NOT re-import.
    fab2 = _make_fabric()
    fab2.store.async_load = AsyncMock(return_value={
        "floors": {}, "history": [], "scanner_positions_m": {},
        "beacon_positions_m": {}, "rf_barriers_m": [],
    })
    await fab2.async_setup(legacy_spatial=legacy)
    assert fab2.scanner_positions_m() == {}
    assert fab2.beacon_positions_m() == {}
    assert fab2.rf_barriers_m() == []


@pytest.mark.asyncio
async def test_spatial_import_on_fresh_store() -> None:
    fab = _make_fabric()
    fab.store.async_load = AsyncMock(return_value=None)
    await fab.async_setup(legacy_spatial={
        "scanner_positions_m": {"s1": {"x_m": 5, "y_m": 6, "z_m": 2, "floor_id": "main"}},
    })
    assert fab.scanner_positions_m()["s1"]["y_m"] == 6
    assert fab.beacon_positions_m() == {}
    assert fab.rf_barriers_m() == []


@pytest.mark.asyncio
async def test_spatial_update_set_and_remove() -> None:
    fab = _spatial_fabric()
    counts = await fab.async_spatial_update(
        set_scanners={
            "good": {"x_m": 1, "y_m": 2, "z_m": 2.4, "floor_id": "main", "origin": "map"},
            "bad": {"x_m": float("nan"), "y_m": 2, "z_m": 2.4},
        },
        set_beacons={"bk": {"x_m": 3, "y_m": 4, "floor_id": "main", "room": "K"}},
        op="test",
    )
    assert counts["scanners"] == 1 and counts["beacons"] == 1
    assert "bad" not in fab.scanner_positions_m()

    counts = await fab.async_spatial_update(
        remove_scanners=["good", "never-there"], remove_beacons=["bk"], op="test")
    assert counts["removed"] == 2
    assert fab.scanner_positions_m() == {} and fab.beacon_positions_m() == {}
    # History carries one entry per call
    assert [h["op"] for h in fab.data["history"]] == ["test", "test"]


@pytest.mark.asyncio
async def test_spatial_update_barriers_name_and_map_replace() -> None:
    fab = _spatial_fabric()
    await fab.async_spatial_update(set_barriers=[
        {"name": "Wall", "points_m": [[0, 0], [1, 0]], "floor_id": "main", "origin": "map", "map_id": "m1"},
        {"name": "Door", "points_m": [[2, 0], [3, 0]], "floor_id": "main", "origin": "manual"},
    ], op="seed")
    # Name replace
    await fab.async_spatial_update(set_barriers=[
        {"name": "Wall", "points_m": [[0, 0], [0, 5]], "floor_id": "main", "origin": "map", "map_id": "m1"},
    ], op="replace")
    walls = [b for b in fab.rf_barriers_m() if b["name"] == "Wall"]
    assert len(walls) == 1 and walls[0]["points_m"][1] == [0, 5]
    # Map replace drops only that map's map-origin barriers
    await fab.async_spatial_update(replace_map_barriers=("m1", []), op="wipe-m1")
    names = [b["name"] for b in fab.rf_barriers_m()]
    assert names == ["Door"]


@pytest.mark.asyncio
async def test_placement_is_ground_truth_across_a_transform_change() -> None:
    """The doctrine, end to end, with no photo anywhere in it.

    A person placed this scanner in metres. Re-placing, re-measuring or
    deleting the floor plan underneath it cannot move it, because no code
    path converts image coordinates into fabric coordinates any more.
    """
    transforms = {"m1": {"origin_x_m": 0, "origin_y_m": 0, "scale_x_m": 10,
                         "scale_y_m": 10, "rotation_rad": 0, "floor_id": "main"}}
    mdl = _make_model(transforms)
    fab = _spatial_fabric()
    mdl.fabric = fab
    await mdl.async_set_scanner_position_m("rx", 5.0, 5.0, 2.4, "main")
    before = json.dumps(fab.data, sort_keys=True)

    m = {"id": "m1", "floor_id": "main", "stack": {},
         "receivers": [{"id": "rx", "source": "rx", "x": 0.5, "y": 0.5}], "beacons": []}
    transforms["m1"]["scale_x_m"] = 20        # the photo is re-placed...
    transforms["m1"]["scale_y_m"] = 20
    await mdl.async_rederive_map_fracs("m1", m)   # ...and redrawn from metres

    assert json.dumps(fab.data, sort_keys=True) == before
    assert fab.scanner_positions_m()["rx"]["x_m"] == pytest.approx(5.0)
    assert m["receivers"][0]["x"] == pytest.approx(0.25)   # the PIN moved


def test_no_implicit_spatial_write_path_survives() -> None:
    """The invariant this pass buys: nothing writes spatial fabric except a
    placement. async_sync_spatial_from_map was the one exception and is gone;
    this fails loudly if anything reintroduces it."""
    from pathlib import Path

    from custom_components.padspan_ha.model_store import ModelStore

    assert not hasattr(ModelStore, "async_sync_spatial_from_map")
    src = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    for name in ("websocket.py", "model_store.py", "__init__.py"):
        text = (src / name).read_text(encoding="utf-8")
        assert "async_sync_spatial_from_map(" not in text, name


@pytest.mark.asyncio
async def test_hand_placed_barrier_survives_an_edit_tab_save() -> None:
    """Barriers are the one thing the photo still edits, so an Edit save
    replaces that map's barriers. A barrier placed directly in metres carries
    no map_id and must not be swept up with them."""
    fab = _spatial_fabric()
    fab.data["rf_barriers_m"] = [
        {"name": "Hand wall", "points_m": [[0, 0], [1, 0]], "floor_id": "main"},
        {"name": "Traced wall", "points_m": [[2, 0], [3, 0]], "floor_id": "main", "map_id": "m1"},
    ]
    await fab.async_spatial_update(
        replace_map_barriers=("m1", [{"name": "Traced wall v2",
                                      "points_m": [[4, 0], [5, 0]], "floor_id": "main",
                                      "map_id": "m1"}]))
    names = {b["name"] for b in fab.rf_barriers_m()}
    assert names == {"Hand wall", "Traced wall v2"}


def test_model_spatial_reads_loud_empty_without_fabric() -> None:
    mdl = _make_model()
    mdl.fabric = None
    assert mdl.scanner_positions_m() == {}
    assert mdl.beacon_positions_m() == {}
    assert mdl.rf_barriers_m() == []


@pytest.mark.asyncio
async def test_unmeasured_map_gets_no_invented_scale() -> None:
    """The 20m fabrication is gone. A photo nobody measured is a picture:
    it gets no transform, so nothing can derive metres through it."""
    mdl = _make_model()
    ms = _maps_store([
        {"id": "measured", "floor_id": "main", "stack": {"is_master": True},
         "calibration": {"px_per_meter": 100.0},
         "image": {"width": 1000, "height": 800}},
        {"id": "unmeasured", "floor_id": "main", "stack": {},
         "calibration": {},
         "image": {"width": 1000, "height": 800}},
    ])
    n = await mdl.async_derive_transforms(ms)
    t = mdl.data["map_transforms"]
    assert "measured" in t
    assert "unmeasured" not in t
    assert n == 1
    assert t["measured"]["scale_x_m"] == pytest.approx(10.0)

    # The fallback fired only when a caller supplied a width, so asserting the
    # default behaviour proves nothing — the parameter itself has to be gone.
    import inspect

    assert "default_floor_width_m" not in inspect.signature(
        mdl.async_derive_transforms).parameters
    with pytest.raises(TypeError):
        await mdl.async_derive_transforms(ms, default_floor_width_m=20.0)


def test_nothing_converts_photo_coordinates_into_data() -> None:
    """The invariant, checked structurally so it cannot quietly come back.

    Every write path that turned a photo coordinate into a stored one has
    been deleted. The single surviving conversion is the one-shot upgrade
    migration, and it is allowed to exist precisely because it runs once.
    """
    from pathlib import Path

    from custom_components.padspan_ha.model_store import ModelStore

    for gone in ("async_sync_spatial_from_map", "async_batch_save_spatial",
                 "async_migrate_from_maps"):
        assert not hasattr(ModelStore, gone), gone

    src = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    allowed = {"migrations.py", "model_store.py", "fabric_truth.py", "calibration_store.py"}
    for path in src.glob("*.py"):
        text = path.read_text(encoding="utf-8")
        if path.name not in allowed:
            assert "map_frac_to_metres" not in text, f"{path.name} converts photo coords"

    # The forest answers in metres; the fraction fallback is gone.
    rf = (src / "random_forest.py").read_text(encoding="utf-8")
    assert 'p["x_frac"]' not in rf and "use_metres: bool" not in rf


def test_the_fabric_holds_every_kind_of_thing_with_a_position() -> None:
    """Rooms, scanners, beacons, barriers and lights all live in one store,
    in metres. If a new kind of thing appears, it belongs here too."""
    fab = _spatial_fabric()
    for key in ("scanner_positions_m", "beacon_positions_m",
                "rf_barriers_m", "light_positions_m"):
        assert key in fab.data, key
