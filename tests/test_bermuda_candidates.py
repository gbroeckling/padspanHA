# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Which HA entities become tracked objects (snapshot_builder's tag
candidates), through the real _build_live_snapshot.

- One Bermuda device became several objects: its Area and Floor sensors both
  carry area_name, and each per-scanner "Distance to" sensor carries the
  scanner's area (devices x scanners x 2 objects, each in a room of its own).
- Bermuda Ignore still let every sensor.*_area_last_seen in.
- Substring matching made sensor.kitchen_voltage ("tag") and
  binary_sensor.dining_table_occupancy ("ble") tracked objects.
"""

from __future__ import annotations

from types import SimpleNamespace as NS

import pytest

from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_findmy_snapshot import _make_house

ROOMS = ["Kitchen", "Office", "Hall"]


def _house(monkeypatch, extra_states=(), bermuda_ignore=False):
    house = _make_house(monkeypatch, labels={}, followed=[])
    if bermuda_ignore:
        house.hass.data[DOMAIN][DATA_SETTINGS].data["bermuda_ignore"] = True
    states, ents = [], {}
    areas = [NS(id=f"a{i}", name=r) for i, r in enumerate(ROOMS)]
    attrs = {"area_id": "a0", "area_name": "Kitchen", "floor_name": "Ground", "current_mac": "AA:BB:CC:00:00:01"}
    for suffix, state in (("area", "Kitchen"), ("floor", "Ground"), ("area_last_seen", "Kitchen")):
        eid = f"sensor.phone_{suffix}"
        states.append(NS(entity_id=eid, state=state, attributes=dict(attrs, friendly_name=f"Phone {suffix}"), name=eid))
        ents[eid] = NS(entity_id=eid, device_id="bd1", platform="bermuda", config_entry_id="bermuda1", area_id=None)
    for s, room in ((0, "Office"), (1, "Hall")):
        eid = f"sensor.phone_distance_to_proxy_{s}"
        states.append(NS(entity_id=eid, state="4.1", attributes={"area_id": f"a{s + 1}", "area_name": room,
                                                                 "area_scanner_name": f"proxy_{s}"}, name=eid))
        ents[eid] = NS(entity_id=eid, device_id="bd1", platform="bermuda", config_entry_id="bermuda1", area_id=None)
    for st, ent in extra_states:
        states.append(st)
        ents[st.entity_id] = ent
    by = {s.entity_id: s for s in states}
    house.hass.states = NS(async_all=lambda *a: states, get=lambda e: by.get(e))
    house.hass.config_entries = NS(async_entries=lambda *a: [NS(domain="bermuda", entry_id="bermuda1")])
    er = NS(async_get=lambda eid: ents.get(eid), entities=ents)
    monkeypatch.setattr(SB.entity_registry, "async_get", lambda h: er)
    monkeypatch.setattr(SB.device_registry, "async_get", lambda h: NS(devices={}, async_get=lambda i: None))
    monkeypatch.setattr(SB.area_registry, "async_get", lambda h: NS(async_list_areas=lambda: areas))
    return house


def _entity_objects(objs):
    return sorted(o.get("entity_id") for o in objs.values() if o.get("kind") == "entity")


@pytest.mark.asyncio
async def test_one_bermuda_device_is_one_object_from_its_area_sensor(monkeypatch):
    house = _house(monkeypatch)
    objs, _ = await house.poll(0, [])
    assert _entity_objects(objs) == ["sensor.phone_area"]


@pytest.mark.asyncio
async def test_bermuda_ignore_lets_no_bermuda_entity_in(monkeypatch):
    house = _house(monkeypatch, bermuda_ignore=True)
    objs, _ = await house.poll(0, [])
    assert _entity_objects(objs) == []


@pytest.mark.asyncio
async def test_a_word_inside_a_name_does_not_make_a_tracker(monkeypatch):
    def _st(eid, area):
        return (NS(entity_id=eid, state="on", attributes={"friendly_name": eid, "area_id": area}, name=eid),
                NS(entity_id=eid, device_id=None, platform="x", config_entry_id="x", area_id=area))
    house = _house(monkeypatch, bermuda_ignore=True, extra_states=[
        _st("sensor.kitchen_voltage", "a0"),
        _st("binary_sensor.dining_table_occupancy", "a1"),
        _st("sensor.keys_ble_tag", "a2"),            # a real BLE tag still counts
    ])
    objs, _ = await house.poll(0, [])
    assert _entity_objects(objs) == ["sensor.keys_ble_tag"]
