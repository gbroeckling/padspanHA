# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Rooms that are the wrong size for the map they were built from.

`map_geometry_faults` can only ever see a map's OWN placement record, and the
0.38.0 consolidation made that record internally consistent by construction —
a placement that is readable but simply WRONG passes it clean. Rooms are the
one part of the fabric still built from a map once and then kept forever
independently of it: once traced, their metres do not move just because the
map they came from later gets a better scale.

Issue #62, rjbutler's Main Floor: the map's placement was eventually correct,
and the rooms — traced back when it was not — stayed at 10.7m x 8.8m against
a floor actually measured at roughly 18.3m x 9.8m. Nothing in the fault list
that already existed could ever have said so, because nothing compared rooms
against the map's own measurement. This is that comparison.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import fabric_truth
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with, seed_world_gauge

# rjbutler's actual reported numbers (issue #62): a floor measured at roughly
# 18.35m x 9.78m whose committed rooms came in at 10.7m x 8.8m — 0.67 of the
# map's diagonal, comfortably below ROOM_FOOTPRINT_MIN_FRAC (0.6... margin is
# the wrong way, see test below) — kept here so the fixture and the real
# report never drift apart.
_MAP_W, _MAP_H = 18.3472, 9.7813
_ROOM_W, _ROOM_H = 10.7, 8.8


def _room(w: float, h: float, floor_id: str = "main") -> dict:
    return {"type": "poly", "floor_id": floor_id,
            "points_m": [[0, 0], [w, 0], [w, h], [0, h]]}


def _map(mid: str, name: str, floor_id: str = "main") -> dict:
    return {"id": mid, "floor_id": floor_id, "name": name,
            "image": {"width": 1600, "height": 1200}}


def _transform(sx: float, sy: float, *, measured: bool = True) -> dict:
    t = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": sx, "scale_y_m": sy,
         "rotation_rad": 0.0, "shear_rad": 0.0}
    if measured:
        t["reference_measurements"] = [{"distance_m": sx, "p1": [0, 0], "p2": [1, 0]}]
    return t


def _store(transforms: dict, maps: list) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock(); s.store = AsyncMock(); s.fabric = None
    s.data = {"map_transforms": transforms}
    seed_world_gauge(s, maps)
    return s


# ── the predicate ────────────────────────────────────────────────────────────

def test_undersized_rooms_are_named() -> None:
    """rjbutler's own numbers: rooms well short of their map's diagonal."""
    maps = [_map("main_floor", "Main Floor")]
    mdl = _store({"main_floor": _transform(_MAP_W, _MAP_H)}, maps)
    geometry = {"kitchen": _room(_ROOM_W, _ROOM_H)}

    faults = fabric_truth.room_footprint_faults(geometry, maps, mdl)

    assert [(f["floor_id"], f["terms"]) for f in faults] == [("main", ["undersized"])]
    assert faults[0]["map_id"] == "main_floor"
    assert faults[0]["footprint_frac"] < fabric_truth.ROOM_FOOTPRINT_MIN_FRAC


def test_oversized_rooms_are_named_and_distinguished() -> None:
    """Bigger than the photo they were traced on is not a heuristic — it is
    impossible — so it gets its own term rather than folding into undersized."""
    maps = [_map("main_floor", "Main Floor")]
    mdl = _store({"main_floor": _transform(6.0, 5.0)}, maps)
    geometry = {"kitchen": _room(10.0, 8.0)}

    faults = fabric_truth.room_footprint_faults(geometry, maps, mdl)

    assert [f["terms"] for f in faults] == [["oversized"]]
    assert faults[0]["footprint_frac"] > 1.0


def test_a_healthy_floor_is_not_reported() -> None:
    """The control. Rooms that plausibly fit their map's photo — including
    the ordinary case of not spanning the whole thing — are not a fault."""
    maps = [_map("main_floor", "Main Floor")]
    mdl = _store({"main_floor": _transform(_MAP_W, _MAP_H)}, maps)
    # A floor plan rarely traces edge-to-edge; most of a real map's own
    # measured size is still normal.
    geometry = {"kitchen": _room(_MAP_W * 0.85, _MAP_H * 0.85)}

    assert fabric_truth.room_footprint_faults(geometry, maps, mdl) == []


def test_an_unmeasured_map_is_not_a_ruler() -> None:
    """A map that is merely PLACED, not measured, can itself be a guess —
    comparing rooms against a guess proves nothing, so the floor is skipped
    rather than faulted either way."""
    maps = [_map("main_floor", "Main Floor")]
    mdl = _store({"main_floor": _transform(_MAP_W, _MAP_H, measured=False)}, maps)
    geometry = {"kitchen": _room(_ROOM_W, _ROOM_H)}

    assert fabric_truth.room_footprint_faults(geometry, maps, mdl) == []


def test_a_floor_with_no_rooms_is_skipped() -> None:
    maps = [_map("main_floor", "Main Floor")]
    mdl = _store({"main_floor": _transform(_MAP_W, _MAP_H)}, maps)

    assert fabric_truth.room_footprint_faults({}, maps, mdl) == []


def test_only_the_faulted_floor_is_reported() -> None:
    """Two floors, one bad — the healthy one must not be swept up."""
    maps = [_map("main_floor", "Main Floor", "main"),
            _map("upstairs", "Upstairs", "upstairs")]
    mdl = _store({"main_floor": _transform(_MAP_W, _MAP_H),
                  "upstairs": _transform(10.0, 8.0)}, maps)
    geometry = {
        "kitchen": _room(_ROOM_W, _ROOM_H, "main"),
        "bedroom": _room(9.0, 7.0, "upstairs"),
    }

    faults = fabric_truth.room_footprint_faults(geometry, maps, mdl)

    assert [f["floor_id"] for f in faults] == ["main"]


def test_the_larger_measured_map_is_the_one_compared() -> None:
    """A floor can carry more than one map. The comparison should be against
    the largest MEASURED one — the closest thing this floor has to a primary
    photo — not whichever happens to be first."""
    maps = [_map("small", "Small crop"), _map("main_floor", "Main Floor")]
    mdl = _store({"small": _transform(2.0, 2.0),
                  "main_floor": _transform(_MAP_W, _MAP_H)}, maps)
    geometry = {"kitchen": _room(_MAP_W * 0.85, _MAP_H * 0.85)}

    # Judged against "small" this would be wildly oversized; judged against
    # the real primary map it is healthy.
    assert fabric_truth.room_footprint_faults(geometry, maps, mdl) == []


# ── what says so ─────────────────────────────────────────────────────────────

def _hass_with(transforms: dict, maps: list[dict], geometry: dict):
    mdl = _store(transforms, maps)
    ms = maps_store_with(maps)
    fab = MagicMock()
    fab.rooms_flat.return_value = geometry
    mdl.fabric = fab
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: ms, DATA_FABRIC: fab,
                          DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}}
    return hass, mdl, ms


@pytest.mark.asyncio
async def test_the_health_critic_reports_the_mismatch() -> None:
    from custom_components.padspan_ha.ws_diagnostics import ws_system_critics

    maps = [_map("main_floor", "Main Floor")]
    hass, _, _ = _hass_with({"main_floor": _transform(_MAP_W, _MAP_H)}, maps,
                            {"kitchen": _room(_ROOM_W, _ROOM_H)})
    conn = MagicMock()
    await ws_system_critics(hass, conn, {"id": 1})

    fp = [c for c in conn.send_result.call_args[0][1]["critics"]
          if c["category"] == "room_footprint"]
    assert len(fp) == 1, fp
    assert fp[0]["severity"] == "warning"
    assert "Main Floor" in fp[0]["title"]
    assert "redraw" in fp[0]["action"].lower()


@pytest.mark.asyncio
async def test_oversized_is_reported_critical() -> None:
    from custom_components.padspan_ha.ws_diagnostics import ws_system_critics

    maps = [_map("main_floor", "Main Floor")]
    hass, _, _ = _hass_with({"main_floor": _transform(6.0, 5.0)}, maps,
                            {"kitchen": _room(10.0, 8.0)})
    conn = MagicMock()
    await ws_system_critics(hass, conn, {"id": 1})

    fp = [c for c in conn.send_result.call_args[0][1]["critics"]
          if c["category"] == "room_footprint"]
    assert len(fp) == 1
    assert fp[0]["severity"] == "critical"


def test_the_usage_report_counts_it() -> None:
    from custom_components.padspan_ha import telemetry as T

    maps = [_map("main_floor", "Main Floor")]
    hass, _, _ = _hass_with({"main_floor": _transform(_MAP_W, _MAP_H)}, maps,
                            {"kitchen": _room(_ROOM_W, _ROOM_H)})
    health = T.build_payload(hass)["health"]

    assert health["room_footprint_undersized"] == 1
    assert health["room_footprint_oversized"] == 0
