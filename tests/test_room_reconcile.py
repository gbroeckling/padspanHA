# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The provenance-gated reconcile: the one sanctioned map→fabric write.

The invariants these tests exist to hold, in order of how expensive their
loss would be:

1. **A hand-corrected room is structurally out of the reconcile's reach.**
   Provenance is stamped only when a write asserts "this geometry is exactly
   what that map's placement implies", and ANY other write clears it — so
   the reconcile, which only touches stamped rooms, cannot reach a room a
   person has shaped. The f3466fc incident was an automatic rewrite that
   could; this whole design exists so that class of loss cannot recur.

2. **The stamp is the server's, not the client's.** `fabric_correct_room`
   accepts a map id and reads that map's placement itself. A client cannot
   supply the transform half of the claim, so it cannot forge a stamp that
   would later hand its room to the reconcile against a different placement.

3. **`room_bounds` — the hand trace on the photo — is read, never written.**
   The old rederive corrupted exactly this; the reconcile's direction is
   inverted on purpose.

4. **Eligibility is decided at execution time, server-side.** The reconcile
   command takes a floor, not a room list — a client cannot widen the set.

5. **Nothing is silent.** Every fixed, skipped and failed room is reported
   by name.
"""

from __future__ import annotations

import copy
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with, seed_world_gauge

# One floor, one map, rotation-free numbers a reader can check by hand.
_OLD_T = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0,
          "scale_y_m": 8.0, "rotation_rad": 0.0, "shear_rad": 0.0,
          "reference_measurements": [{"distance_m": 10.0}]}
_NEW_T = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 18.35,
          "scale_y_m": 9.78, "rotation_rad": 0.0, "shear_rad": 0.0,
          "reference_measurements": [{"distance_m": 18.35}]}
_KITCHEN_FRACS = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]


def _map(mid: str = "main_floor", name: str = "Main Floor") -> dict:
    return {"id": mid, "floor_id": "main", "name": name,
            "image": {"width": 1600, "height": 853},
            "room_bounds": {"kitchen": {"type": "poly", "points": copy.deepcopy(_KITCHEN_FRACS)}}}


def _mdl(transforms: dict, maps: list) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock(); s.store = AsyncMock(); s.fabric = None
    s.data = {"map_transforms": transforms}
    seed_world_gauge(s, maps)
    return s


def _fab() -> FabricStore:
    fs = FabricStore.__new__(FabricStore)
    fs.hass = MagicMock()
    fs.store = AsyncMock()
    fs.data = {"floors": {}, "history": []}
    return fs


def _derived_geo(mdl: ModelStore, mid: str) -> dict:
    """Kitchen's metres exactly as the map's CURRENT placement implies them —
    computed through the same arithmetic the product uses, so these tests
    hold to semantics rather than to hand-copied numbers."""
    t = mdl.map_transform(mid)
    pts = [fabric_truth.placement_metres(t, fx, fy) for fx, fy in _KITCHEN_FRACS]
    return {"type": "poly", "points_m": [[round(x, 3), round(y, 3)] for x, y in pts]}


def _hass_with(mdl: ModelStore, maps: list, fab: FabricStore):
    ms = maps_store_with(maps)
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: ms, DATA_FABRIC: fab,
                          DATA_SETTINGS: SimpleNamespace(data={})}}
    return hass


# ── the stamp ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_correct_room_stamps_only_when_both_fields_arrive() -> None:
    fab = _fab()
    snap = fabric_truth.placement_snapshot(_OLD_T)
    await fab.async_correct_room("main", "kitchen", {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
                                 source_map_id="main_floor", source_transform=snap)
    rec = fab.data["floors"]["main"]["rooms"]["kitchen"]
    assert rec["source_map_id"] == "main_floor"
    assert rec["source_transform"] == snap

    # map id alone is not a claim — half a stamp stores as no stamp.
    await fab.async_correct_room("main", "pantry", {"type": "poly", "points_m": [[0, 0], [2, 0], [2, 2]]},
                                 source_map_id="main_floor")
    rec = fab.data["floors"]["main"]["rooms"]["pantry"]
    assert rec["source_map_id"] is None and rec["source_transform"] is None


@pytest.mark.asyncio
async def test_a_hand_correction_clears_the_stamp() -> None:
    """The invariant the whole design rests on: after a person touches a
    room, no record remains that could hand it to the reconcile. The old
    carry-forward here would have preserved a claim the geometry no longer
    honours — that is what would let automation overwrite a person's work."""
    fab = _fab()
    snap = fabric_truth.placement_snapshot(_OLD_T)
    await fab.async_correct_room("main", "kitchen", {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
                                 source_map_id="main_floor", source_transform=snap)
    await fab.async_correct_room("main", "kitchen", {"type": "poly", "points_m": [[0, 0], [4.2, 0], [4.2, 3]]})
    rec = fab.data["floors"]["main"]["rooms"]["kitchen"]
    assert rec["source_map_id"] is None and rec["source_transform"] is None
    assert rec["revision"] == 2


@pytest.mark.asyncio
async def test_ws_correct_room_resolves_the_stamp_server_side() -> None:
    """The client asserts WHICH map; the server records WHAT that map's
    placement is. There is no field a client could use to supply the
    transform half of the claim."""
    from custom_components.padspan_ha.ws_fabric import ws_fabric_correct_room

    maps = [_map()]
    mdl = _mdl({"main_floor": dict(_NEW_T)}, maps)
    fab = _fab()
    hass = _hass_with(mdl, maps, fab)
    conn = MagicMock()
    await ws_fabric_correct_room(hass, conn, {
        "id": 1, "floor_id": "main", "room": "kitchen",
        "geometry": {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
        "source_map_id": "main_floor",
    })
    assert conn.send_result.called, conn.send_error.call_args
    rec = fab.data["floors"]["main"]["rooms"]["kitchen"]
    assert rec["source_map_id"] == "main_floor"
    assert rec["source_transform"] == fabric_truth.placement_snapshot(_NEW_T)


@pytest.mark.asyncio
async def test_ws_correct_room_will_not_stamp_from_an_unreadable_placement() -> None:
    """An unreadable placement implies nothing, so no claim is recorded —
    the write itself still lands."""
    from custom_components.padspan_ha.ws_fabric import ws_fabric_correct_room

    maps = [_map()]
    mdl = _mdl({"main_floor": {"origin_x_m": 0.0, "origin_y_m": 0.0,
                               "scale_x_m": None, "scale_y_m": 8.0}}, maps)
    fab = _fab()
    hass = _hass_with(mdl, maps, fab)
    conn = MagicMock()
    await ws_fabric_correct_room(hass, conn, {
        "id": 1, "floor_id": "main", "room": "kitchen",
        "geometry": {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3]]},
        "source_map_id": "main_floor",
    })
    assert conn.send_result.called
    rec = fab.data["floors"]["main"]["rooms"]["kitchen"]
    assert rec["source_map_id"] is None and rec["source_transform"] is None


# ── eligibility ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reconcilable_lists_only_the_provably_stale() -> None:
    maps = [_map()]
    maps[0]["room_bounds"]["study"] = {"type": "poly", "points": copy.deepcopy(_KITCHEN_FRACS)}
    mdl = _mdl({"main_floor": dict(_NEW_T)}, maps)
    fab = _fab()
    old_snap = fabric_truth.placement_snapshot(_OLD_T)
    new_snap = fabric_truth.placement_snapshot(_NEW_T)
    geo = {"type": "poly", "points_m": [[1, 0.8], [5, 0.8], [5, 4], [1, 4]]}
    # stamped under the OLD placement → stale → eligible
    await fab.async_correct_room("main", "kitchen", geo, source_map_id="main_floor", source_transform=old_snap)
    # stamped under the CURRENT placement → agrees → nothing to do
    await fab.async_correct_room("main", "study", geo, source_map_id="main_floor", source_transform=new_snap)
    # no stamp → hand-authored → out of reach, however wrong it looks
    await fab.async_correct_room("main", "den", geo)

    out = fabric_truth.reconcilable_rooms(fab.rooms_flat(), maps, mdl)
    assert [r["room"] for r in out] == ["kitchen"]
    assert out[0]["map_id"] == "main_floor" and out[0]["floor_id"] == "main"


@pytest.mark.asyncio
async def test_no_trace_or_no_map_or_broken_placement_means_not_eligible() -> None:
    """Each precondition is a refusal on its own: a deleted map, a missing
    room_bounds trace, and an unreadable current placement all take the room
    off the list — a reconcile that cannot recompute honestly must not
    offer to."""
    maps = [_map()]
    mdl = _mdl({"main_floor": dict(_NEW_T)}, maps)
    fab = _fab()
    old_snap = fabric_truth.placement_snapshot(_OLD_T)
    geo = {"type": "poly", "points_m": [[1, 0.8], [5, 0.8], [5, 4], [1, 4]]}
    await fab.async_correct_room("main", "kitchen", geo, source_map_id="main_floor", source_transform=old_snap)

    # trace gone
    no_trace = copy.deepcopy(maps); no_trace[0]["room_bounds"] = {}
    assert fabric_truth.reconcilable_rooms(fab.rooms_flat(), no_trace, mdl) == []
    # map gone
    assert fabric_truth.reconcilable_rooms(fab.rooms_flat(), [], mdl) == []
    # current placement unreadable
    broken = _mdl({"main_floor": {"scale_x_m": None, "scale_y_m": 8.0,
                                  "origin_x_m": 0.0, "origin_y_m": 0.0}}, maps)
    assert fabric_truth.reconcilable_rooms(fab.rooms_flat(), maps, broken) == []


# ── the action ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reconcile_rewrites_the_stale_room_and_only_it() -> None:
    from custom_components.padspan_ha.ws_fabric import ws_fabric_rooms_reconcile

    maps = [_map()]
    mdl = _mdl({"main_floor": dict(_NEW_T)}, maps)
    fab = _fab()
    old_snap = fabric_truth.placement_snapshot(_OLD_T)
    stale_geo = {"type": "poly", "points_m": [[1, 0.8], [5, 0.8], [5, 4], [1, 4]]}
    hand_geo = {"type": "poly", "points_m": [[7, 7], [9, 7], [9, 9], [7, 9]]}
    await fab.async_correct_room("main", "kitchen", stale_geo, source_map_id="main_floor", source_transform=old_snap)
    await fab.async_correct_room("main", "den", hand_geo)
    den_before = copy.deepcopy(fab.data["floors"]["main"]["rooms"]["den"])
    bounds_before = copy.deepcopy(maps[0]["room_bounds"])

    hass = _hass_with(mdl, maps, fab)
    conn = MagicMock()
    await ws_fabric_rooms_reconcile(hass, conn, {"id": 1, "floor_id": "main"})

    res = conn.send_result.call_args[0][1]
    assert res["fixed"] == ["kitchen"] and res["failed"] == [] and res["eligible"] == ["kitchen"]

    kitchen = fab.data["floors"]["main"]["rooms"]["kitchen"]
    expected = _derived_geo(mdl, "main_floor")
    assert kitchen["points_m"] == expected["points_m"], "must equal what Map placements previews"
    assert kitchen["committed_by"] == "reconcile"
    assert kitchen["source_map_id"] == "main_floor"
    assert kitchen["source_transform"] == fabric_truth.placement_snapshot(_NEW_T)

    # The hand-authored room is byte-identical — not merely similar.
    assert fab.data["floors"]["main"]["rooms"]["den"] == den_before
    # The photo trace was read, never written.
    assert maps[0]["room_bounds"] == bounds_before


@pytest.mark.asyncio
async def test_reconcile_is_idempotent() -> None:
    """After one pass the stamp agrees with the placement, so a second pass
    finds nothing — rerunning the fix must never become churn."""
    from custom_components.padspan_ha.ws_fabric import ws_fabric_rooms_reconcile

    maps = [_map()]
    mdl = _mdl({"main_floor": dict(_NEW_T)}, maps)
    fab = _fab()
    await fab.async_correct_room("main", "kitchen",
                                 {"type": "poly", "points_m": [[1, 0.8], [5, 0.8], [5, 4], [1, 4]]},
                                 source_map_id="main_floor",
                                 source_transform=fabric_truth.placement_snapshot(_OLD_T))
    hass = _hass_with(mdl, maps, fab)
    conn = MagicMock()
    await ws_fabric_rooms_reconcile(hass, conn, {"id": 1, "floor_id": "main"})
    rev_after_first = fab.data["floors"]["main"]["rooms"]["kitchen"]["revision"]

    conn2 = MagicMock()
    await ws_fabric_rooms_reconcile(hass, conn2, {"id": 2, "floor_id": "main"})
    res2 = conn2.send_result.call_args[0][1]
    assert res2["eligible"] == [] and res2["fixed"] == []
    assert fab.data["floors"]["main"]["rooms"]["kitchen"]["revision"] == rev_after_first


@pytest.mark.asyncio
async def test_truth_candidates_reports_the_reconcilable_room() -> None:
    """The Rooms tab learns about the stale room from the fetch it already
    makes — that is how the fix becomes discoverable instead of a tab
    nobody thinks to open."""
    from custom_components.padspan_ha.ws_fabric import ws_fabric_truth_candidates

    maps = [_map()]
    mdl = _mdl({"main_floor": dict(_NEW_T)}, maps)
    fab = _fab()
    await fab.async_correct_room("main", "kitchen",
                                 {"type": "poly", "points_m": [[1, 0.8], [5, 0.8], [5, 4], [1, 4]]},
                                 source_map_id="main_floor",
                                 source_transform=fabric_truth.placement_snapshot(_OLD_T))
    hass = _hass_with(mdl, maps, fab)
    conn = MagicMock()
    await ws_fabric_truth_candidates(hass, conn, {"id": 1, "floor_id": "main"})
    res = conn.send_result.call_args[0][1]
    assert [r["room"] for r in res["reconcilable"]] == ["kitchen"]


# ── the full arc ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_rjbutler_arc() -> None:
    """Commit under a wrong placement, fix the placement, reconcile, healthy.

    The three-week shape of issue #62, compressed: rooms adopted while the
    map's placement was wrong; the placement later corrected; the rooms —
    which nothing used to point at — found and re-derived, and the size
    mismatch the health check flags is gone."""
    from custom_components.padspan_ha.ws_fabric import ws_fabric_rooms_reconcile

    maps = [_map()]
    mdl = _mdl({"main_floor": dict(_OLD_T)}, maps)
    fab = _fab()
    # Rooms committed from the map while its placement was WRONG — the
    # candidate path stamps provenance from the then-current placement.
    geo = fabric_truth.recompute_room_from_map(maps[0], "kitchen", mdl)
    await fab.async_correct_room("main", "kitchen", geo,
                                 source_map_id="main_floor",
                                 source_transform=fabric_truth.placement_snapshot(mdl.map_transform("main_floor")))
    # The map's placement is later corrected (re-measure, alignment fix...).
    mdl.data["map_transforms"]["main_floor"] = dict(_NEW_T)
    # The rooms are now stale — and, for the first time, something says so.
    assert [r["room"] for r in fabric_truth.reconcilable_rooms(fab.rooms_flat(), maps, mdl)] == ["kitchen"]

    hass = _hass_with(mdl, maps, fab)
    conn = MagicMock()
    await ws_fabric_rooms_reconcile(hass, conn, {"id": 1, "floor_id": "main"})
    assert conn.send_result.call_args[0][1]["fixed"] == ["kitchen"]
    assert fab.data["floors"]["main"]["rooms"]["kitchen"]["points_m"] == _derived_geo(mdl, "main_floor")["points_m"]
    assert fabric_truth.reconcilable_rooms(fab.rooms_flat(), maps, mdl) == []
