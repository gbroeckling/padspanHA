# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Group divergence: a floor's two room records drifting apart together.

The committed fabric and the map's hand trace describe the same rooms two
ways. When either predates a change to the map, every shared room drifts by
the SAME factor — no human edits every room by an identical amount, so the
group signature separates "a record went stale" from "somebody moved a
room". rjbutler's trimmed floors (issue #62) sat in exactly this state for
weeks with nothing saying so: traces still in pre-trim image space, every
preview room at ~55% of the photo's width, and the only detector was his
own eyes against a screenshot.

The detector deliberately does NOT say which side is stale — it cannot
know. It exists to make a person compare the two layouts over the photo,
where the answer takes seconds.
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
from custom_components.padspan_ha.model_store import ModelStore
from tests.conftest import maps_store_with, seed_world_gauge

_T = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 20.0,
      "scale_y_m": 16.0, "rotation_rad": 0.0, "shear_rad": 0.0,
      "reference_measurements": [{"distance_m": 20.0}]}


def _mdl(maps: list) -> ModelStore:
    s = ModelStore.__new__(ModelStore)
    s.hass = MagicMock(); s.store = AsyncMock(); s.fabric = None
    s.data = {"map_transforms": {"m1": dict(_T)}}
    seed_world_gauge(s, maps)
    return s


def _map(bounds: dict) -> dict:
    return {"id": "m1", "floor_id": "main", "name": "Main Floor",
            "image": {"width": 1000, "height": 800, "sha256": "abc"},
            "room_bounds": bounds}


def _poly(fracs) -> dict:
    return {"type": "poly", "points": [list(p) for p in fracs]}


def _fabric_from(bounds: dict, mdl: ModelStore, m: dict, scale: float = 1.0) -> dict:
    """Fabric rooms as the map derives them, optionally shrunk by a uniform
    factor about the origin — the shape stale records take."""
    out = {}
    for room in bounds:
        g = fabric_truth.recompute_room_from_map(m, room, mdl)
        if scale != 1.0 and g and g.get("type") == "poly":
            g["points_m"] = [[p[0] * scale, p[1] * scale] for p in g["points_m"]]
        g["floor_id"] = "main"
        out[room] = g
    return out


_BOUNDS = {
    "kitchen": _poly([[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]]),
    "garage": _poly([[0.6, 0.2], [0.9, 0.2], [0.9, 0.7], [0.6, 0.7]]),
    "hall": _poly([[0.45, 0.1], [0.55, 0.1], [0.55, 0.6], [0.45, 0.6]]),
}


def test_a_group_shift_is_named() -> None:
    """Every shared room smaller by the same 0.55 — the rjbutler signature."""
    m = _map(copy.deepcopy(_BOUNDS))
    mdl = _mdl([m])
    fabric = _fabric_from(_BOUNDS, mdl, m, scale=1 / 0.55)  # fabric larger ⇒ candidate/fabric ≈ 0.55

    out = fabric_truth.room_divergence_faults(fabric, [m], mdl)
    assert len(out) == 1
    assert out[0]["map_id"] == "m1" and out[0]["terms"] == ["group_offset"]
    assert out[0]["ratio_x"] == pytest.approx(0.55, abs=0.01)
    assert sorted(out[0]["rooms"]) == ["garage", "hall", "kitchen"]


def test_agreement_is_quiet() -> None:
    m = _map(copy.deepcopy(_BOUNDS))
    mdl = _mdl([m])
    fabric = _fabric_from(_BOUNDS, mdl, m)
    assert fabric_truth.room_divergence_faults(fabric, [m], mdl) == []


def test_a_hand_edit_is_not_a_group() -> None:
    """One room moved a lot, the others agreeing — that is editing, and the
    spread check keeps it out of this detector's mouth."""
    m = _map(copy.deepcopy(_BOUNDS))
    mdl = _mdl([m])
    fabric = _fabric_from(_BOUNDS, mdl, m)
    fabric["garage"]["points_m"] = [[p[0] * 0.5, p[1]] for p in fabric["garage"]["points_m"]]
    assert fabric_truth.room_divergence_faults(fabric, [m], mdl) == []


def test_one_shared_room_cannot_establish_a_group() -> None:
    one = {"kitchen": copy.deepcopy(_BOUNDS["kitchen"])}
    m = _map(one)
    mdl = _mdl([m])
    fabric = _fabric_from(one, mdl, m, scale=1 / 0.55)
    assert fabric_truth.room_divergence_faults(fabric, [m], mdl) == []


@pytest.mark.asyncio
async def test_the_health_critic_says_so() -> None:
    from custom_components.padspan_ha.fabric_store import FabricStore
    from custom_components.padspan_ha.ws_diagnostics import ws_system_critics

    m = _map(copy.deepcopy(_BOUNDS))
    mdl = _mdl([m])
    fab = FabricStore.__new__(FabricStore)
    fab.hass = MagicMock(); fab.store = AsyncMock()
    fab.data = {"floors": {"main": {"committed": False, "committed_at": None,
                                    "rooms": _fabric_from(_BOUNDS, mdl, m, scale=1 / 0.55)}},
                "history": []}
    mdl.fabric = fab
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: maps_store_with([m]), DATA_FABRIC: fab,
                          DATA_SETTINGS: SimpleNamespace(data={})}}
    conn = MagicMock()
    await ws_system_critics(hass, conn, {"id": 1})
    dv = [c for c in conn.send_result.call_args[0][1]["critics"]
          if c["category"] == "room_divergence"]
    assert len(dv) == 1
    assert dv[0]["severity"] == "warning"
    assert "Main Floor" in dv[0]["title"]
    assert "Map placements" in dv[0]["action"]


def test_the_usage_report_counts_it() -> None:
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha.fabric_store import FabricStore

    m = _map(copy.deepcopy(_BOUNDS))
    mdl = _mdl([m])
    fab = FabricStore.__new__(FabricStore)
    fab.hass = MagicMock(); fab.store = AsyncMock()
    fab.data = {"floors": {"main": {"committed": False, "committed_at": None,
                                    "rooms": _fabric_from(_BOUNDS, mdl, m, scale=1 / 0.55)}},
                "history": []}
    mdl.fabric = fab
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: maps_store_with([m]), DATA_FABRIC: fab,
                          DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}}
    health = T.build_payload(hass)["health"]
    assert health["maps_divergent"] == 1
