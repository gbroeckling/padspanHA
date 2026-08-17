# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The positioning side has to know the building has more than one floor.

`data["floors"]` is the sole input to `floor_stack_index()` and
`floor_base_elevations_m()`, and nothing ever wrote it. The panel looked
correct because `ws_model_get` reads the HA floor registry live for display —
but that read was never persisted, so the POSITIONING side found the single
synthetic `main` entry the store is created with and ran every multi-floor
house as one storey.

The consequence is not subtle. `_slabs_crossed` returns its flat "unknown
stacking" 1 whenever either floor is missing from the index, so a basement
scanner and an upstairs scanner are penalised identically and floor selection
has nothing left to discriminate with. Measured on a real three-storey
install: 2,886,899 confirmed cross-floor room changes, split 1,093,120 /
1,062,985 between the two directions — a near-perfect symmetry, which is what
oscillation looks like and what movement does not.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

from custom_components.padspan_ha.model_store import ModelStore


class FakeFabric:
    def __init__(self, rooms: dict[str, str] | None = None) -> None:
        self._rooms = {r: {"floor_id": f} for r, f in (rooms or {}).items()}

    def room_geometry_m(self) -> dict[str, Any]:
        return self._rooms


def _store(floors: list[dict[str, Any]] | None = None,
           rooms: dict[str, str] | None = None) -> ModelStore:
    ms = ModelStore.__new__(ModelStore)
    ms.store = AsyncMock()
    ms.store.async_save = AsyncMock()
    ms.data = {"floors": floors if floors is not None else [{"id": "main", "name": "Main Floor"}]}
    ms.fabric = FakeFabric(rooms)
    return ms


# What the HA registry hands back on the install this came from: real floors,
# and `level` null on every one of them, which is the normal case.
REGISTRY = [
    {"id": "basement", "name": "Basement", "level": None},
    {"id": "main", "name": "Main", "level": None},
    {"id": "outside", "name": "Outside", "level": None},
    {"id": "upper", "name": "Upper", "level": None},
]


async def test_the_stack_learns_the_floors_the_house_actually_has() -> None:
    """The bug, stated as the number that was wrong.

    One entry in, four floors in the registry, one floor in the stack index.
    """
    ms = _store()
    assert len(ms.floor_stack_index()) == 1        # the fault, before

    changed = await ms.async_sync_floors(REGISTRY)

    assert changed is True
    assert set(ms.floor_stack_index()) == {"basement", "main", "outside", "upper"}


async def test_cross_floor_paths_can_finally_be_told_apart() -> None:
    """The consequence, which is the reason this matters at all.

    With one floor indexed, `_slabs_crossed` takes its unknown-stacking branch
    for every cross-floor pair and returns 1 — so one storey and two storeys
    attenuate identically.
    """
    ms = _store()
    await ms.async_sync_floors(REGISTRY)
    idx = ms.floor_stack_index()

    assert abs(idx["main"] - idx["upper"]) == 1
    assert abs(idx["basement"] - idx["upper"]) == 2, (
        "two storeys apart is still being counted as one: %r" % (idx,))


async def test_heights_the_user_typed_are_not_overwritten() -> None:
    """The registry knows WHICH floors exist; the user knows how far apart.

    A sync that clobbered the Floor Heights table would make the feature
    unusable — every poll would undo it.
    """
    ms = _store([
        {"id": "basement", "name": "Basement", "level": -1, "floor_to_floor_m": 3.0},
        {"id": "main", "name": "Main", "level": 0, "floor_to_floor_m": 2.3},
    ])

    await ms.async_sync_floors(REGISTRY)

    by_id = {f["id"]: f for f in ms.data["floors"]}
    assert by_id["basement"]["floor_to_floor_m"] == 3.0
    assert by_id["main"]["floor_to_floor_m"] == 2.3
    assert by_id["basement"]["level"] == -1, "a user-set level was overwritten"
    elev = ms.floor_base_elevations_m()
    assert abs(elev["main"] - elev["basement"] - 3.0) < 1e-6, elev


async def test_a_registry_level_fills_a_gap_but_never_replaces_one() -> None:
    """Most registries have no levels; the ones that do are worth adopting."""
    ms = _store([{"id": "main", "name": "Main", "level": 5}])
    reg = [{"id": "main", "name": "Main", "level": 0},
           {"id": "upper", "name": "Upper", "level": 1}]

    await ms.async_sync_floors(reg)

    by_id = {f["id"]: f for f in ms.data["floors"]}
    assert by_id["main"]["level"] == 5, "the stored level was overwritten by the registry"
    assert by_id["upper"]["level"] == 1, "an empty level was not filled from the registry"


async def test_a_floor_the_fabric_still_uses_is_never_dropped() -> None:
    """Deleting an HA floor must not strand the rooms drawn on it.

    They would vanish from the stack index entirely, which is the original bug
    again with a smaller blast radius and a worse cause.
    """
    ms = _store(
        [{"id": "attic", "name": "Attic", "level": 2}, {"id": "main", "name": "Main"}],
        rooms={"Loft": "attic", "Kitchen": "main"},
    )

    await ms.async_sync_floors([{"id": "main", "name": "Main", "level": 0}])

    assert "attic" in ms.floor_stack_index(), (
        "a floor with rooms on it was dropped when HA forgot about it")


async def test_a_floor_with_nothing_on_it_is_allowed_to_go() -> None:
    """The counterpart: an empty floor deleted in HA should actually leave."""
    ms = _store([{"id": "spare", "name": "Spare"}, {"id": "main", "name": "Main"}],
                rooms={"Kitchen": "main"})

    await ms.async_sync_floors([{"id": "main", "name": "Main"}])

    assert "spare" not in ms.floor_stack_index()


async def test_outdoors_sits_at_ground_level_not_above_the_roof() -> None:
    """Outdoors is a place, not a storey.

    "outside" is not a conventional storey name, so it fell to the
    "above everything" tier and ranked on top of the top floor — which made
    every outdoor scanner two slabs, twenty decibels, away from the ground
    floor it is standing next to.
    """
    ms = _store()
    await ms.async_sync_floors(REGISTRY)
    idx = ms.floor_stack_index()

    assert idx["outside"] == idx["main"], (
        "outdoors is not at ground level: %r" % (idx,))
    assert idx["outside"] < idx["upper"], idx
    assert idx["basement"] < idx["outside"], idx


async def test_ha_default_floor_slugs_are_recognised() -> None:
    """HA names its own floors ground_floor / first_floor / second_floor.

    Missing those meant the commonest registry of all fell straight through
    the convention table into stored order.
    """
    ms = _store([])
    await ms.async_sync_floors([
        {"id": "second_floor", "name": "Second"},
        {"id": "ground_floor", "name": "Ground"},
        {"id": "first_floor", "name": "First"},
    ])
    idx = ms.floor_stack_index()
    assert idx["ground_floor"] <= idx["first_floor"] < idx["second_floor"], idx


async def test_an_unreadable_registry_changes_nothing() -> None:
    """A registry that failed to load is not evidence the house has no floors.

    Treating an empty list as truth would wipe the stack on any transient
    error, which is a far worse failure than the one being fixed.
    """
    ms = _store([{"id": "basement"}, {"id": "main"}, {"id": "upper"}])

    assert await ms.async_sync_floors([]) is False
    assert len(ms.floor_stack_index()) == 3
    ms.store.async_save.assert_not_awaited()


async def test_a_repeat_sync_does_not_write() -> None:
    """This runs on every poll. It must be a no-op once settled.

    Saving each time would rewrite the store every few seconds — the exact
    SD-card wear pattern the history stores were rebuilt to avoid.
    """
    ms = _store()
    assert await ms.async_sync_floors(REGISTRY) is True
    ms.store.async_save.reset_mock()

    assert await ms.async_sync_floors(REGISTRY) is False
    ms.store.async_save.assert_not_awaited()
