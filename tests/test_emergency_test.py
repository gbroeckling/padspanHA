# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas emergency lighting test (emergency_test.py).

What must hold: the lights come from the setting, else HA's "emergency"
groups (all of them, nested expanded, members not groups), else the default
rule (Pakedge ports 7/8 + one light per "emergency" WLED device); the lights
already on when a test starts stay on when it ends, Force off turns off all;
a second start keeps the first tags; the tags survive a restart; an
unavailable light is skipped without failing the rest; the three usage
events are in the closed vocabulary.
"""

from __future__ import annotations

import asyncio
import copy
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import emergency_test as ET
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN


def _run(coro):
    return asyncio.run(coro)


class _DiskStore:
    """One file per key, shared across 'restarts'."""
    files: dict = {}

    def __init__(self, hass, version, key):
        self.key = key

    async def async_load(self):
        return copy.deepcopy(_DiskStore.files.get(self.key))

    async def async_save(self, data):
        _DiskStore.files[self.key] = copy.deepcopy(data)


class House:
    def __init__(self, monkeypatch, settings=None):
        from homeassistant.helpers import device_registry as dr, entity_registry as er, storage
        self.states, self.entities, self.devices, self.calls = {}, {}, {}, []
        self.fail = set()
        self.settings = SimpleNamespace(data=dict(settings or {}))
        _DiskStore.files = {}
        monkeypatch.setattr(storage, "Store", _DiskStore, raising=False)
        monkeypatch.setattr(er, "async_get", lambda h: SimpleNamespace(
            entities=self.entities, async_get=lambda e: self.entities.get(e)), raising=False)
        monkeypatch.setattr(dr, "async_get", lambda h: SimpleNamespace(async_get=lambda d: self.devices.get(d)),
                            raising=False)
        self.hass = self._new_hass()

    def _new_hass(self):
        hass = MagicMock()
        hass.data = {DOMAIN: {DATA_SETTINGS: self.settings, "telemetry_counters": {}}}
        hass.states.get = lambda e: self.states.get(e)
        hass.states.async_all = lambda: list(self.states.values())

        async def _call(domain, service, data=None, blocking=False):
            eid = data["entity_id"]
            if eid in self.fail:
                raise RuntimeError("device said no")
            self.calls.append((domain, service, eid))
            self.states[eid].state = "on" if service == "turn_on" else "off"
        hass.services.async_call = _call
        return hass

    def restart(self):
        self.hass = self._new_hass()

    def state(self, eid, state="off", name=None, members=None):
        attrs = {"friendly_name": name or eid}
        if members is not None:
            attrs["entity_id"] = list(members)
        self.states[eid] = SimpleNamespace(entity_id=eid, state=state, attributes=attrs)

    def wled(self, dev, name, *, lights, main=None, dev_name=None):
        """lights: {entity_id: (segment, state, friendly_name)}; main: (entity_id, state)."""
        self.devices[dev] = SimpleNamespace(id=dev, name=dev_name or dev, name_by_user=None)
        mac = f"aabbcc{dev}"
        if main:
            eid, st = main
            self.entities[eid] = SimpleNamespace(entity_id=eid, device_id=dev, unique_id=mac, platform="wled",
                                                 name=None, original_name="Main", disabled_by=None)
            self.state(eid, st, f"{name} Main")
        for eid, (seg, st, fname) in lights.items():
            self.entities[eid] = SimpleNamespace(entity_id=eid, device_id=dev, unique_id=f"{mac}_{seg}",
                                                 platform="wled", name=None, original_name=None, disabled_by=None)
            self.state(eid, st, fname)


def _live_house(monkeypatch, **kw):
    """Garry's house on 2026-09-28, before the groups were made."""
    h = House(monkeypatch, **kw)
    for p in range(1, 9):
        h.state(f"switch.pakedge_poe_port_{p}", "on", f"Pakedge PoE Port {p}")
    h.wled("d_closet", "closet", lights={"light.a1_slwf_09": (0, "off", "Emergency WLed closet")},
           main=("light.a1_slwf_09_main", "unavailable"), dev_name="Emergency bedroom SLWF-09")
    h.wled("d_office", "office", lights={"light.upper_south_2": (0, "off", "Emergency GarryOffice fun display")},
           dev_name="Emergeny Garryoffice fun displa")
    h.wled("d_spare", "spare", lights={"light.emergencysparebed_slwf_09": (0, "unavailable", "EmergencySpareBed-SLWF-09")})
    # Not emergency lights.
    h.wled("d_kitchen", "kitchen", lights={"light.quin_kitchen_valance": (0, "on", "Quin-Kitchen-Valance"),
                                           "light.quin_kitchen_valance_segment_1": (1, "on", "Quin-Kitchen-Valance Segment 1")},
           main=("light.quin_kitchen_valance_main", "on"))
    h.state("switch.emergency_wled_closet_freeze", "off", "Emergency WLed closet freeze")
    return h


LIVE_DEFAULT = ["switch.pakedge_poe_port_7", "switch.pakedge_poe_port_8",
                "light.a1_slwf_09", "light.upper_south_2", "light.emergencysparebed_slwf_09"]


# ── Which lights ─────────────────────────────────────────────────────────────


def test_default_rule_on_the_live_house(monkeypatch):
    h = _live_house(monkeypatch)
    res = ET.resolve_members(h.hass)
    assert res["source"] == "default"
    assert sorted(res["members"]) == sorted(LIVE_DEFAULT)


def test_default_rule_takes_the_master_light_when_ha_shows_it(monkeypatch):
    h = House(monkeypatch)
    h.wled("d1", "hall", lights={"light.emergency_hall": (0, "on", "Emergency hall"),
                                 "light.emergency_hall_segment_1": (1, "on", "Emergency hall Segment 1")},
           main=("light.emergency_hall_main", "on"))
    assert ET.resolve_members(h.hass)["members"] == ["light.emergency_hall_main"]
    # The master light hidden (one segment): the first segment instead, once.
    h.states["light.emergency_hall_main"].state = "unavailable"
    assert ET.resolve_members(h.hass)["members"] == ["light.emergency_hall"]


def test_default_rule_skips_missing_pakedge_ports_and_non_wled(monkeypatch):
    h = House(monkeypatch)
    h.state("light.emergency_lamp", "off", "Emergency lamp")          # not WLED, not a group
    assert ET.resolve_members(h.hass) == {"source": None, "groups": [], "members": []}


def test_two_single_domain_groups_are_unioned(monkeypatch):
    h = _live_house(monkeypatch)
    h.state("light.emergency_lighting", "off", "Emergency Lighting",
            members=["light.a1_slwf_09", "light.upper_south_2", "light.emergencysparebed_slwf_09"])
    h.state("switch.emergency_lighting_poe", "on", "Emergency Lighting PoE",
            members=["switch.pakedge_poe_port_7", "switch.pakedge_poe_port_8"])
    res = ET.resolve_members(h.hass)
    assert res["source"] == "group"
    assert res["groups"] == ["light.emergency_lighting", "switch.emergency_lighting_poe"]
    assert sorted(res["members"]) == sorted(LIVE_DEFAULT)      # the members, never the groups


def test_group_matched_by_name_and_nested_groups_expanded(monkeypatch):
    h = House(monkeypatch)
    h.state("light.a", "off"); h.state("light.b", "off"); h.state("switch.c", "off")
    h.state("light.inner", "off", "Downstairs", members=["light.b", "switch.c"])
    h.state("group.backup_lights", "off", "Emergency backup", members=["light.a", "light.inner", "light.a"])
    h.state("light.kitchen_group", "off", "Kitchen", members=["light.z"])       # not emergency
    res = ET.resolve_members(h.hass)
    assert res == {"source": "group", "groups": ["group.backup_lights"], "members": ["light.a", "light.b", "switch.c"]}


def test_setting_overrides_groups_and_default(monkeypatch):
    h = _live_house(monkeypatch, settings={"emergency_entities": ["light.x", "switch.y", "lock.front", "light.x"]})
    h.state("light.emergency_lighting", "off", "Emergency Lighting", members=["light.a1_slwf_09"])
    res = ET.resolve_members(h.hass)
    assert res == {"source": "settings", "groups": [], "members": ["light.x", "switch.y"]}


def test_group_beats_default(monkeypatch):
    h = _live_house(monkeypatch)
    h.state("switch.emergency_lighting_poe", "on", "Emergency Lighting PoE", members=["switch.pakedge_poe_port_8"])
    assert ET.resolve_members(h.hass)["members"] == ["switch.pakedge_poe_port_8"]


# ── The test ─────────────────────────────────────────────────────────────────


def test_lights_already_on_stay_on_at_test_off(monkeypatch):
    h = _live_house(monkeypatch)
    h.states["light.upper_south_2"].state = "on"                  # already on: tagged
    _run(ET.async_test(h.hass, True))
    st = _run(ET.async_status(h.hass))
    assert st["test"]["active"] is True
    assert sorted(st["test"]["kept_on"]) == ["light.upper_south_2", "switch.pakedge_poe_port_7",
                                            "switch.pakedge_poe_port_8"]
    assert h.states["light.a1_slwf_09"].state == "on"
    # Only what was off got a turn_on; the unavailable one was skipped.
    assert [c[2] for c in h.calls] == ["light.a1_slwf_09"]
    h.calls.clear()
    results = _run(ET.async_test(h.hass, False))
    assert [c for c in h.calls] == [("light", "turn_off", "light.a1_slwf_09")]
    assert h.states["light.upper_south_2"].state == "on"
    assert h.states["switch.pakedge_poe_port_7"].state == "on"
    assert {"entity_id": "light.emergencysparebed_slwf_09", "ok": False, "skipped": "unavailable"} in results
    assert _run(ET.async_status(h.hass))["test"] == {"active": False, "started_at": None, "kept_on": [], "manual": []}


def test_force_off_turns_every_member_off(monkeypatch):
    h = _live_house(monkeypatch)
    h.states["light.upper_south_2"].state = "on"
    _run(ET.async_test(h.hass, True))
    _run(ET.async_force_off(h.hass))
    for e in ("light.a1_slwf_09", "light.upper_south_2", "switch.pakedge_poe_port_7", "switch.pakedge_poe_port_8"):
        assert h.states[e].state == "off", e
    assert h.states["switch.pakedge_poe_port_1"].state == "on"     # not a member
    assert _run(ET.async_status(h.hass))["test"]["active"] is False


def test_second_start_does_not_retag(monkeypatch):
    h = _live_house(monkeypatch)
    _run(ET.async_test(h.hass, True))
    first = _run(ET.async_status(h.hass))["test"]
    _run(ET.async_test(h.hass, True))                               # everything is on now
    second = _run(ET.async_status(h.hass))["test"]
    assert second == first
    _run(ET.async_test(h.hass, False))
    assert h.states["light.a1_slwf_09"].state == "off"
    assert h.states["switch.pakedge_poe_port_7"].state == "on"      # tagged at the FIRST start


def test_off_without_a_test_does_nothing(monkeypatch):
    h = _live_house(monkeypatch)
    assert _run(ET.async_test(h.hass, False)) == []
    assert h.calls == []


def test_tags_survive_a_restart(monkeypatch):
    h = _live_house(monkeypatch)
    h.states["light.upper_south_2"].state = "on"
    _run(ET.async_test(h.hass, True))
    h.restart()                                                      # fresh hass.data, same disk
    st = _run(ET.async_status(h.hass))
    assert st["test"]["active"] is True
    assert "light.upper_south_2" in st["test"]["kept_on"]
    _run(ET.async_test(h.hass, False))
    assert h.states["light.upper_south_2"].state == "on"
    assert h.states["light.a1_slwf_09"].state == "off"


def test_a_failing_member_does_not_stop_the_rest(monkeypatch):
    h = _live_house(monkeypatch)
    for p in (7, 8):
        h.states[f"switch.pakedge_poe_port_{p}"].state = "off"
    h.fail.add("switch.pakedge_poe_port_7")
    results = {r["entity_id"]: r for r in _run(ET.async_test(h.hass, True))}
    assert results["switch.pakedge_poe_port_7"]["ok"] is False and "error" in results["switch.pakedge_poe_port_7"]
    assert results["switch.pakedge_poe_port_8"]["ok"] is True
    assert h.states["light.a1_slwf_09"].state == "on"


def test_only_lights_and_switches_are_switched(monkeypatch):
    h = House(monkeypatch)
    h.state("lock.front", "locked"); h.state("light.a", "off")
    h.state("group.emergency", "off", "Emergency", members=["lock.front", "light.a"])
    results = {r["entity_id"]: r for r in _run(ET.async_test(h.hass, True))}
    assert results["lock.front"] == {"entity_id": "lock.front", "ok": False, "skipped": "not a light or switch"}
    assert h.calls == [("light", "turn_on", "light.a")]


def test_status_payload(monkeypatch):
    h = _live_house(monkeypatch)
    st = _run(ET.async_status(h.hass))
    assert st["available"] is True and st["source"] == "default"
    by = {m["entity_id"]: m for m in st["members"]}
    assert by["light.a1_slwf_09"] == {"entity_id": "light.a1_slwf_09", "name": "Emergency WLed closet", "state": "off"}
    assert by["light.emergencysparebed_slwf_09"]["state"] == "unavailable"


def test_ws_commands_answer(monkeypatch):
    h = _live_house(monkeypatch)
    out = []
    conn = SimpleNamespace(send_result=lambda mid, data=None: out.append(data), send_error=MagicMock())
    _run(ET.ws_emergency_test(h.hass, conn, {"id": 1, "type": "padspan_ha/emergency_test", "on": True}))
    assert out[-1]["test"]["active"] is True and out[-1]["results"]
    _run(ET.ws_emergency_force_off(h.hass, conn, {"id": 2, "type": "padspan_ha/emergency_force_off"}))
    assert out[-1]["test"]["active"] is False
    _run(ET.ws_emergency_status(h.hass, conn, {"id": 3, "type": "padspan_ha/emergency_status"}))
    assert set(out[-1]) == {"available", "source", "groups", "members", "test"}


def test_commands_are_registered_and_open_to_any_user():
    from pathlib import Path
    src = (Path(ET.__file__).parent / "websocket.py").read_text(encoding="utf-8")
    assert "from .emergency_test import WS_COMMANDS" in src
    for cmd in ET.WS_COMMANDS:
        assert not getattr(cmd, "_ws_require_admin", False)
    assert "require_admin" not in (Path(ET.__file__).read_text(encoding="utf-8").split("# ── Websocket")[1])


# ── One member by hand (the card behind the ring) ─────────────────────────────


def test_a_member_switched_by_hand_during_a_test_is_left_as_set(monkeypatch):
    h = _live_house(monkeypatch)
    for p in (7, 8):
        h.states[f"switch.pakedge_poe_port_{p}"].state = "off"
    _run(ET.async_test(h.hass, True))
    # By hand: the closet light off and on again (keep it), port 8 off.
    _run(ET.async_member(h.hass, "light.a1_slwf_09", False))
    _run(ET.async_member(h.hass, "light.a1_slwf_09", True))
    _run(ET.async_member(h.hass, "switch.pakedge_poe_port_8", False))
    assert sorted(_run(ET.async_status(h.hass))["test"]["manual"]) == ["light.a1_slwf_09", "switch.pakedge_poe_port_8"]
    _run(ET.async_test(h.hass, True))                               # a second start: port 8 stays off
    assert h.states["switch.pakedge_poe_port_8"].state == "off"
    h.calls.clear()
    _run(ET.async_test(h.hass, False))
    assert h.states["light.a1_slwf_09"].state == "on"                # as the person set it
    assert h.states["switch.pakedge_poe_port_8"].state == "off"
    assert h.states["switch.pakedge_poe_port_7"].state == "off"      # the test's own: off
    assert sorted(c[2] for c in h.calls) == ["light.upper_south_2", "switch.pakedge_poe_port_7"]


def test_controls_opened_during_a_test_keep_the_member_on(monkeypatch):
    h = _live_house(monkeypatch)
    _run(ET.async_test(h.hass, True))
    assert _run(ET.async_member(h.hass, "light.upper_south_2", None)) == []    # tagged, not switched
    _run(ET.async_test(h.hass, False))
    assert h.states["light.upper_south_2"].state == "on"
    assert h.states["light.a1_slwf_09"].state == "off"


def test_force_off_turns_off_hand_set_members_too(monkeypatch):
    h = _live_house(monkeypatch)
    _run(ET.async_test(h.hass, True))
    _run(ET.async_member(h.hass, "light.a1_slwf_09", True))
    _run(ET.async_force_off(h.hass))
    assert h.states["light.a1_slwf_09"].state == "off"
    assert _run(ET.async_status(h.hass))["test"]["manual"] == []


def test_by_hand_outside_a_test_only_switches(monkeypatch):
    h = _live_house(monkeypatch)
    assert _run(ET.async_member(h.hass, "light.a1_slwf_09", True)) == [{"entity_id": "light.a1_slwf_09", "ok": True}]
    assert h.states["light.a1_slwf_09"].state == "on"
    assert _run(ET.async_status(h.hass))["test"]["manual"] == []


def test_by_hand_refuses_what_is_not_a_member(monkeypatch):
    h = _live_house(monkeypatch)
    assert _run(ET.async_member(h.hass, "switch.pakedge_poe_port_1", False)) is None
    assert h.states["switch.pakedge_poe_port_1"].state == "on"
    errors = []
    conn = SimpleNamespace(send_result=MagicMock(), send_error=lambda mid, code, m: errors.append(code))
    _run(ET.ws_emergency_member(h.hass, conn, {"id": 1, "entity_id": "switch.pakedge_poe_port_1", "on": False}))
    assert errors == ["not_found"]


# ── Usage events ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("event", ["emergency_test_on", "emergency_test_off", "emergency_force_off"])
def test_usage_events_are_in_the_closed_vocabulary(event):
    assert event in T.EVENTS and T.event_allowed(event)


def test_usage_events_count_once_per_action(monkeypatch):
    h = _live_house(monkeypatch)
    seen = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: seen.append(e) or True)
    _run(ET.async_test(h.hass, True))
    _run(ET.async_test(h.hass, True))
    _run(ET.async_test(h.hass, False))
    _run(ET.async_test(h.hass, True))
    _run(ET.async_force_off(h.hass))
    assert seen == ["emergency_test_on", "emergency_test_off", "emergency_test_on", "emergency_force_off"]
