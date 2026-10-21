# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""hold_last_room_s and room_reason_attribute: both OFF by default.

hold_last_room_s keeps showing the room a device had before a short signal
gap, in the snapshot only (the vote, smoothing, gate and re-entry reset are
unchanged). room_reason_attribute adds a "why this room" attribute to each
area sensor. With both at their defaults the snapshot and the entity must be
exactly what they were.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from custom_components.padspan_ha import snapshot_builder as sb
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.sensor import PadSpanAreaSensor
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

from .test_poll_level import ble_object, make_coordinator, run_poll, snapshot

K = "ble:AA:BB:CC:DD:EE:01"
ADDR = "AA:BB:CC:DD:EE:01"


def _gap_coordinator(settings=None):
    """A coordinator whose device had Kitchen, went quiet 90 s and came back."""
    coord = make_coordinator(settings)
    obj = lambda age: ble_object(K, ADDR, age_s=age, user_label="Phone")
    run_poll(coord, snapshot([obj(1.0)]))
    coord._confirmed_room[K] = "Kitchen"
    run_poll(coord, snapshot([obj(90.0)]))
    run_poll(coord, snapshot([obj(1.0)]))
    return coord


def test_defaults_are_off():
    assert DEFAULT_SETTINGS["hold_last_room_s"] == 0.0
    assert DEFAULT_SETTINGS["room_reason_attribute"] is False


# ── the coordinator side ──────────────────────────────────────────────────────

def test_held_room_after_a_short_gap():
    coord = _gap_coordinator()
    assert coord.held_room(K, 120.0) == "Kitchen"


def test_held_room_is_nothing_when_off_or_expired():
    coord = _gap_coordinator()
    assert coord.held_room(K, 0.0) == ""
    coord._room_gap_mono[K] -= 200.0
    assert coord.held_room(K, 120.0) == ""


def test_held_room_changes_no_coordinator_state():
    coord = _gap_coordinator()
    before = (dict(coord._confirmed_room), dict(coord._room_before_gap),
              {k: list(v) for k, v in coord._room_votes.items()})
    coord.held_room(K, 120.0)
    coord.room_reason(K)
    after = (dict(coord._confirmed_room), dict(coord._room_before_gap),
             {k: list(v) for k, v in coord._room_votes.items()})
    assert before == after


def test_room_reason_reports_votes_and_gate():
    coord = make_coordinator()
    from collections import deque
    coord._confirmed_room[K] = "Kitchen"
    coord._room_votes[K] = deque(["Garage", "Garage", "Garage", "Kitchen", "Kitchen"], maxlen=5)
    coord._spatial_debug[K] = "computed:3_scanners"
    r = coord.room_reason(K)
    assert r["votes_won"] == 2 and r["votes_needed"] == 3 and r["vote_window"] == 5
    assert r["gate_active"] is True
    assert r["positioning"] == "computed:3_scanners"


# ── the snapshot side ─────────────────────────────────────────────────────────

def _run_snapshot(settings: dict, objects: list[dict], pc) -> dict:
    st = SimpleNamespace(data=dict(settings))
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: st, "presence_coordinator": pc}}
    conn = MagicMock()
    snap = {"objects": {"list": copy.deepcopy(objects)}, "ble": {"advertisements": [], "radios": []}}

    async def _snap(_hass):
        return snap

    with patch.object(sb, "_live_snapshot", _snap), \
         patch("custom_components.padspan_ha.perf_sampler.note_snapshot_request", lambda h: None):
        asyncio.run(sb.ws_live_snapshot(hass, conn, {"id": 1}))
    return conn.send_result.call_args[0][1]["snapshot"]


def _pc_with_gap():
    coord = _gap_coordinator()
    coord.data = {}
    return coord


_OBJS = [{"key": K, "address": ADDR, "kind": "ble", "room": "", "age_s": 5.0}]


def test_snapshot_unchanged_with_the_hold_off():
    pc = _pc_with_gap()
    off = _run_snapshot({}, _OBJS, pc)
    zero = _run_snapshot({"hold_last_room_s": 0}, _OBJS, pc)
    assert off["objects"] == zero["objects"]
    o = off["objects"]["list"][0]
    assert o["room"] == "" and "room_held" not in o


def test_snapshot_holds_the_room_when_on():
    pc = _pc_with_gap()
    o = _run_snapshot({"hold_last_room_s": 120}, _OBJS, pc)["objects"]["list"][0]
    assert o["room"] == "Kitchen" and o["room_held"] is True


def test_snapshot_never_holds_an_away_device():
    pc = _pc_with_gap()
    objs = [dict(_OBJS[0], age_s=99999.0)]
    o = _run_snapshot({"hold_last_room_s": 600}, objs, pc)["objects"]["list"][0]
    assert o["room"] == "" and "room_held" not in o


# ── the entity side ───────────────────────────────────────────────────────────

def _sensor(settings: dict):
    coord = _gap_coordinator()
    coord.hass.data[DOMAIN][DATA_SETTINGS].data.update(settings)
    coord.last_update_success = True
    coord.data = {K: {"key": K, "address": ADDR, "kind": "ble", "room": "", "age_s": 2.0,
                      "room_scores": {"Kitchen": 0.6, "Hall": 0.3, "Den": 0.05, "Bath": 0.05}}}
    s = PadSpanAreaSensor.__new__(PadSpanAreaSensor)
    s.coordinator = coord
    s._key = K
    return s


def test_entity_attributes_unchanged_by_default():
    attrs = _sensor({}).extra_state_attributes
    assert "room_reason" not in attrs
    assert _sensor({"room_reason_attribute": False}).extra_state_attributes == attrs


def test_entity_room_reason_when_on():
    attrs = _sensor({"room_reason_attribute": True, "hold_last_room_s": 120}).extra_state_attributes
    r = attrs["room_reason"]
    assert list(r["top_room_scores"]) == ["Kitchen", "Hall", "Den"]
    assert r["room_held"] is True
    assert "votes_needed" in r and "gate_active" in r and "current_room_bias" in r
