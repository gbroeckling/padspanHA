# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Deleting a room deletes the room, geometry included.

Reported as "under mappings and rooms, the delete room doesn't work".

It half-worked, which is why it looked like nothing happened. The handler
removed the room from `room_meta`, from `room_adjacency`, and from the scanner
map — three fields that live in the ModelStore blob — and never touched
`room_geometry_m`, because geometry had moved to the FabricStore and the
handler was never updated with it. The SHAPE is the room: it kept drawing on
the map, kept appearing in `_fabric_rooms`, and kept being a candidate the
positioning pipeline could pick.

This is the shape of every remaining pre-fabric defect: code that still edits
the legacy blob directly and does not know that the ground truth moved. So the
test asserts on the fabric, not on the blob.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore


def _fabric() -> FabricStore:
    fab = FabricStore.__new__(FabricStore)
    fab.store = AsyncMock()
    fab.store.async_save = AsyncMock()
    fab.data = {
        "floors": {
            "main": {
                "rooms": {
                    "Kitchen": {"type": "poly", "floor_id": "main", "revision": 3,
                                "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
                    "Living": {"type": "poly", "floor_id": "main", "revision": 1,
                               "points_m": [[5, 0], [9, 0], [9, 4], [5, 4]]},
                },
                "committed": False,
            },
            "upper": {
                "rooms": {
                    "Bed": {"type": "poly", "floor_id": "upper", "revision": 1,
                            "points_m": [[0, 0], [3, 0], [3, 3], [0, 3]]},
                },
                "committed": False,
            },
        },
        "history": [],
    }
    return fab


def _model(fab: FabricStore) -> ModelStore:
    ms = ModelStore.__new__(ModelStore)
    ms.store = AsyncMock()
    ms.store.async_save = AsyncMock()
    ms.fabric = fab
    ms.data = {
        "room_meta": {"Kitchen": {"colour": "#fff"}, "Living": {"colour": "#eee"}},
        "room_adjacency": {"Kitchen": ["Living"], "Living": ["Kitchen", "Bed"]},
        "scanners": {
            "AA:01": {"room": "Kitchen", "floor_id": "main"},
            "AA:02": {"room": "Living", "floor_id": "main"},
        },
    }
    return ms


async def test_the_rooms_geometry_is_actually_gone(tmp_path) -> None:
    """The bug, in one assertion. The shape IS the room."""
    fab = _fabric()
    ms = _model(fab)

    res = await ms.async_remove_room("Kitchen")

    assert res["ok"] is True
    assert res["geometry_removed"] is True
    assert "Kitchen" not in fab.data["floors"]["main"]["rooms"], (
        "the room kept its shape and will keep drawing")
    # rooms_flat is what ModelStore.room_geometry_m serves from, so this is
    # the view every consumer of the fabric actually sees.
    assert "Kitchen" not in fab.rooms_flat()


async def test_it_also_clears_the_metadata_it_always_cleared(tmp_path) -> None:
    """The three things the old handler did right must keep working."""
    fab = _fabric()
    ms = _model(fab)

    res = await ms.async_remove_room("Kitchen")

    assert "Kitchen" not in ms.data["room_meta"]
    assert "Kitchen" not in ms.data["room_adjacency"]
    assert "Kitchen" not in ms.data["room_adjacency"]["Living"], (
        "a neighbour still points at the deleted room")
    assert "AA:01" not in ms.data["scanners"], "a scanner is still assigned to it"
    assert res["scanners_detached"] == 1


async def test_only_that_room_is_touched(tmp_path) -> None:
    """A delete that takes a neighbour with it is worse than one that fails."""
    fab = _fabric()
    ms = _model(fab)

    await ms.async_remove_room("Kitchen")

    assert "Living" in fab.data["floors"]["main"]["rooms"]
    assert "Bed" in fab.data["floors"]["upper"]["rooms"]
    assert "Living" in ms.data["room_meta"]
    assert "AA:02" in ms.data["scanners"]


async def test_a_room_on_another_floor_is_found(tmp_path) -> None:
    """Rooms are stored under their floor, so removal has to search for it.

    Looking only on the default floor would silently no-op for every room
    upstairs — the same failure with a smaller blast radius.
    """
    fab = _fabric()
    ms = _model(fab)

    res = await ms.async_remove_room("Bed")

    assert res["geometry_removed"] is True
    assert res["floor_id"] == "upper"
    assert "Bed" not in fab.data["floors"]["upper"]["rooms"]


async def test_removing_a_room_that_does_not_exist_is_not_an_error(tmp_path) -> None:
    """The metadata may still need clearing even when the geometry is gone.

    Half-deleted rooms exist in the wild precisely because of the old bug, so
    refusing here would leave them unfixable through the UI.
    """
    fab = _fabric()
    ms = _model(fab)
    ms.data["room_meta"]["Ghost"] = {"colour": "#000"}

    res = await ms.async_remove_room("Ghost")

    assert res["ok"] is True
    assert res["geometry_removed"] is False
    assert "Ghost" not in ms.data["room_meta"], (
        "a room left behind by the old bug cannot be cleaned up")


async def test_an_empty_name_is_refused(tmp_path) -> None:
    """A blank room name must not walk the fabric deleting nothing in a loop."""
    fab = _fabric()
    ms = _model(fab)

    res = await ms.async_remove_room("   ")

    assert res["ok"] is False
    assert res["error"] == "invalid_room"
    assert len(fab.data["floors"]["main"]["rooms"]) == 2


async def test_the_removal_is_recorded_in_the_fabric_history(tmp_path) -> None:
    """Geometry changes are auditable; a deletion is a geometry change.

    Corrections log; a removal that did not would leave a room's disappearance
    as the one unexplained event in the history.
    """
    fab = _fabric()
    ms = _model(fab)

    await ms.async_remove_room("Kitchen")

    ops = [h.get("op") for h in fab.data.get("history", []) if isinstance(h, dict)]
    assert "remove" in ops, fab.data.get("history")
