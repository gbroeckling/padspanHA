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


@pytest.mark.asyncio
async def test_area_last_seen_never_becomes_the_device_while_it_has_an_area_sensor(monkeypatch):
    """Picking by state swapped to Area Last Seen while the phone was out of
    range and back on return, leaving a second object in the old room."""
    house = _house(monkeypatch)
    objs, _ = await house.poll(0, [])
    assert _entity_objects(objs) == ["sensor.phone_area"]
    for st in house.hass.states.async_all():          # out of range: Area unknown
        if st.entity_id == "sensor.phone_area":
            st.state = "unknown"
    objs, _ = await house.poll(30, [])
    assert "sensor.phone_area_last_seen" not in _entity_objects(objs)


@pytest.mark.asyncio
async def test_an_upgrade_drops_the_old_extra_bermuda_objects_from_the_history(monkeypatch):
    """0.38.105 made a device's Floor, Area Last Seen and each Distance to
    sensor objects of their own. Nothing removed them from the saved object
    history, which replayed them frozen in their old rooms (an entity is never
    away) - a labelled copy forever. The history drops what the selection
    never makes, and saves that; the Area sensor and other entities stay."""
    from custom_components.padspan_ha.const import DATA_OBJECT_HISTORY, DATA_OBJECTS
    other = "sensor.keys_distance_to_hall"      # not Bermuda's, and not live now
    house = _house(monkeypatch, extra_states=[(
        NS(entity_id=other, state="on", attributes={"friendly_name": other}, name=other),
        NS(entity_id=other, device_id="d9", platform="x", config_entry_id="x", area_id=None))])
    dom = house.hass.data[DOMAIN]
    t0 = 1_800_000_000.0 - 3600                 # last heard an hour before the upgrade
    old = ["sensor.phone_area", "sensor.phone_floor", "sensor.phone_area_last_seen",
           "sensor.phone_distance_to_proxy_0", "sensor.phone_distance_to_proxy_1", other]
    dom.pop(DATA_OBJECT_HISTORY)                # loaded from disk on the first build
    dom["_obj_hist_store"].saved = {
        f"entity:{e}": {"key": f"entity:{e}", "kind": "entity", "entity_id": e, "name": e, "room": "Office",
                        "identified": True, "_last_seen_ts": t0, "_first_seen": t0} for e in old}
    dom[DATA_OBJECTS].labels["ENTITY:SENSOR.PHONE_FLOOR"] = "Phone"
    objs, _ = await house.poll(0, [])
    assert _entity_objects(objs) == sorted(["sensor.phone_area", other])
    await house.poll(20, [])                    # the history's next save
    saved = sorted(k for k in dom["_obj_hist_store"].saved if k.startswith("entity:"))
    assert saved == sorted(["entity:sensor.phone_area", f"entity:{other}"])


@pytest.mark.asyncio
async def test_the_report_counts_the_old_bermuda_objects_the_history_dropped(monkeypatch):
    """#152 from the field: bermuda_history_purged is the entries one upgrade
    from 0.38.105 removes, once, and nothing after."""
    from custom_components.padspan_ha.const import DATA_OBJECT_HISTORY
    from custom_components.padspan_ha.telemetry import _DATA_COUNTERS
    house = _house(monkeypatch)
    dom = house.hass.data[DOMAIN]
    dom[DATA_SETTINGS].data["telemetry_enabled"] = True
    t0 = 1_800_000_000.0 - 3600
    old = ["sensor.phone_area", "sensor.phone_floor", "sensor.phone_area_last_seen",
           "sensor.phone_distance_to_proxy_0", "sensor.phone_distance_to_proxy_1"]
    dom.pop(DATA_OBJECT_HISTORY)
    dom["_obj_hist_store"].saved = {
        f"entity:{e}": {"key": f"entity:{e}", "kind": "entity", "entity_id": e, "name": e, "room": "Office",
                        "identified": True, "_last_seen_ts": t0, "_first_seen": t0} for e in old}
    await house.poll(0, [])
    assert dom[_DATA_COUNTERS].get("bermuda_history_purged") == 4     # the Area sensor is live, not purged
    await house.poll(20, [])
    assert dom[_DATA_COUNTERS].get("bermuda_history_purged") == 4


def test_bluetooth_words_with_digits_and_maker_prefixes_still_match():
    import re
    src = (__import__("pathlib").Path(SB.__file__)).read_text(encoding="utf-8")
    pat = re.search(r'_BT_WORD = _re\.compile\(r"(.+?)"\)', src).group(1)
    rx = re.compile(pat)
    for name in ("sensor.beacon1", "sensor.tag1_room", "sensor.ble01", "device_tracker.airtag_keys",
                 "galaxy_smarttag2", "sensor.ibeacon_kitchen", "bletag", "sensor.keys_ble_tag"):
        assert rx.search(name), name
    for name in ("sensor.kitchen_voltage", "binary_sensor.dining_table_occupancy", "sensor.cable_box"):
        assert not rx.search(name), name
