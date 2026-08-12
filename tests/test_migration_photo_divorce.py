"""The upgrade path onto the metre-only fabric.

Existing installs carry coordinates derived through photo placements, some of
them wrong — a never-measured photo was handed a fabricated 20 m width, which
put every position on it at the wrong scale. Nothing re-derives any more, so
whatever is wrong at upgrade time would stay wrong forever. This migration is
the photo's last job.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.migrations import (
    MARKER,
    PHOTO_DIVORCE,
    async_run_photo_divorce,
)
from custom_components.padspan_ha.model_store import ModelStore


def _fab(data: dict | None = None) -> FabricStore:
    f = FabricStore.__new__(FabricStore)
    f.hass = MagicMock()
    f.store = AsyncMock()
    f.store.async_save = AsyncMock()
    f.data = data or {"floors": {}, "history": [], "scanner_positions_m": {},
                      "beacon_positions_m": {}, "rf_barriers_m": []}
    return f


def _mdl(transforms: dict) -> ModelStore:
    m = ModelStore.__new__(ModelStore)
    m.hass = MagicMock()
    m.store = AsyncMock()
    m.store.async_save = AsyncMock()
    m.data = {"map_transforms": transforms}
    m.fabric = None
    return m


def _maps(maps: list[dict]):
    ms = MagicMock()
    ms.data = {"maps": maps}
    return ms


def _scenario():
    """A measured master, plus a second photo hung at twice its true scale.

    The stack says the second photo is 10m wide; its transform claims 20m —
    the fabricated default. Its scanner's metres are therefore double what
    they should be, which is the live Position1.jpg defect in miniature.
    """
    master = {
        "id": "master", "floor_id": "main", "name": "Ground",
        "stack": {"is_master": True, "x_offset": 0, "y_offset": 0, "scale": 1.0},
        "calibration": {"px_per_meter": 100.0},
        "image": {"width": 1000, "height": 800},
        "receivers": [{"id": "rx_master", "source": "rx_master", "x": 0.5, "y": 0.5}],
    }
    bad = {
        "id": "bad", "floor_id": "main", "name": "Outside",
        "stack": {"x_offset": 0, "y_offset": 0, "scale": 1.0},
        "calibration": {},
        "image": {"width": 1000, "height": 800},
        "receivers": [{"id": "rx_bad", "source": "rx_bad", "x": 0.5, "y": 0.5}],
    }
    transforms = {
        "master": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0,
                   "scale_y_m": 8.0, "rotation_rad": 0.0, "floor_id": "main",
                   "reference_measurements": [{"m": 1}]},
        # fabricated: exactly the 20m default, so everything on it is 2x out
        "bad": {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
                "scale_y_m": 16.0, "rotation_rad": 0.0, "floor_id": "main"},
    }
    mdl = _mdl(transforms)
    fab = _fab()
    mdl.fabric = fab
    fab.data["scanner_positions_m"] = {
        # derived through the fabricated transform: 0.5 * 20 = 10, should be 5
        "rx_bad": {"x_m": 10.0, "y_m": 8.0, "z_m": 2.4, "floor_id": "main",
                   "origin": "map", "map_id": "bad"},
        # already correct, and derived through a real measurement
        "rx_master": {"x_m": 5.0, "y_m": 4.0, "z_m": 2.4, "floor_id": "main",
                      "origin": "map", "map_id": "master"},
    }
    return mdl, fab, _maps([master, bad])


@pytest.mark.asyncio
async def test_repairs_a_photo_hung_at_the_wrong_scale() -> None:
    mdl, fab, ms = _scenario()
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab)

    assert "Outside" in stats["maps_repaired"]
    # The transform is corrected to what the stack says...
    assert mdl.map_transform("bad")["scale_x_m"] == pytest.approx(10.0)
    # ...and the position that was derived through the wrong one is fixed.
    assert fab.scanner_positions_m()["rx_bad"]["x_m"] == pytest.approx(5.0)
    # The correct one is left where it was.
    assert fab.scanner_positions_m()["rx_master"]["x_m"] == pytest.approx(5.0)


@pytest.mark.asyncio
async def test_a_hand_placed_position_is_never_touched() -> None:
    """Anything already placed in metres outranks every photo on the box."""
    mdl, fab, ms = _scenario()
    fab.data["scanner_positions_m"]["rx_bad"] = {
        "x_m": 3.21, "y_m": 4.32, "z_m": 2.4, "floor_id": "main",
    }
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    entry = fab.scanner_positions_m()["rx_bad"]
    assert (entry["x_m"], entry["y_m"]) == (3.21, 4.32)


@pytest.mark.asyncio
async def test_legacy_ownership_keys_are_stripped() -> None:
    mdl, fab, ms = _scenario()
    fab.data["beacon_positions_m"] = {
        "bk": {"x_m": 1.0, "y_m": 1.0, "floor_id": "main", "origin": "map", "map_id": "bad"},
    }
    fab.data["rf_barriers_m"] = [
        {"name": "Wall", "points_m": [[0, 0], [1, 0]], "floor_id": "main",
         "origin": "map", "map_id": "bad"},
    ]
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab)

    for entry in fab.scanner_positions_m().values():
        assert "origin" not in entry and "map_id" not in entry and "z_origin" not in entry
    for entry in fab.beacon_positions_m().values():
        assert "origin" not in entry and "map_id" not in entry
    # Barriers keep map_id — it is how an Edit save replaces the walls it drew.
    assert "origin" not in fab.rf_barriers_m()[0]
    assert fab.rf_barriers_m()[0]["map_id"] == "bad"


@pytest.mark.asyncio
async def test_runs_exactly_once() -> None:
    mdl, fab, ms = _scenario()
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    assert PHOTO_DIVORCE in fab.data[MARKER]

    # Someone then moves a scanner by hand. A second startup must not undo it.
    fab.data["scanner_positions_m"]["rx_bad"]["x_m"] = 42.0
    again = await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    assert again == {"skipped": True}
    assert fab.scanner_positions_m()["rx_bad"]["x_m"] == 42.0


@pytest.mark.asyncio
async def test_no_measured_map_means_no_guessing() -> None:
    """With nothing measured there is no metre anchor, so there is no truth to
    repair against. Leave it all alone rather than invent a correction."""
    mdl, fab, ms = _scenario()
    mdl.data["map_transforms"]["master"].pop("reference_measurements")
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    assert fab.scanner_positions_m()["rx_bad"]["x_m"] == pytest.approx(10.0)


@pytest.mark.asyncio
async def test_calibration_points_are_anchored_once() -> None:
    """A point recorded on a photo but never given metres gets them here.

    After this its metres are the stored truth — where the person stood —
    and the photo coordinates are only used to draw the dot.
    """
    mdl, fab, ms = _scenario()
    cal = MagicMock()
    cal.async_backfill_metres = AsyncMock(return_value=468)
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, cal)
    assert stats["cal_points_anchored"] == 468
    cal.async_backfill_metres.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_failing_calibration_backfill_never_blocks_the_migration() -> None:
    mdl, fab, ms = _scenario()
    cal = MagicMock()
    cal.async_backfill_metres = AsyncMock(side_effect=RuntimeError("boom"))
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab, cal)
    assert stats["cal_points_anchored"] == 0
    assert PHOTO_DIVORCE in fab.data[MARKER]          # still marked done
    assert fab.scanner_positions_m()["rx_bad"]["x_m"] == pytest.approx(5.0)


@pytest.mark.asyncio
async def test_lights_are_converted_as_part_of_the_upgrade() -> None:
    """A light placed on a photo becomes a light placed in the house."""
    mdl, fab, ms = _scenario()
    ms.data["maps"][0]["lights"] = [
        {"entity_id": "light.kitchen", "x": 0.5, "y": 0.5, "shape": "bar"}]
    stats = await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    assert stats["lights_converted"] == 1
    lp = fab.light_positions_m()["light.kitchen"]
    assert (lp["x_m"], lp["y_m"]) == (5.0, 4.0)      # master map: 10m x 8m
    assert lp["shape"] == "bar"
    assert "map_id" not in lp


@pytest.mark.asyncio
async def test_the_whole_upgrade_is_idempotent_on_real_shaped_data() -> None:
    """Second startup changes nothing at all — bytes identical."""
    import json

    mdl, fab, ms = _scenario()
    ms.data["maps"][0]["lights"] = [{"entity_id": "light.a", "x": 0.2, "y": 0.2}]
    await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    after_first = json.dumps(fab.data, sort_keys=True)

    await async_run_photo_divorce(MagicMock(), mdl, ms, fab)
    assert json.dumps(fab.data, sort_keys=True) == after_first
