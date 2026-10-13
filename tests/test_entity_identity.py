# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One label on two keys (the phone wizard names a phone's iBeacon key and
its IRK the same; naming a device copies the label onto several keys).

- The Area/Distance sensors re-targeted only when a NEW key appeared, so once
  both were known they stayed on the one that went quiet (not_home) while
  the tracker followed the live one.
- The unique_id came from whichever key polled first, so a restart with the
  other key fresher created a second set of entities (device_tracker.phone_2).
- Entities created before PadSpan's device list loaded were named after the
  plain address instead of the saved id.
"""

from __future__ import annotations

import asyncio
import sys
import types
from unittest.mock import MagicMock

import pytest

import tests.conftest  # noqa: F401  (HA stubs)
from custom_components.padspan_ha.const import DATA_DEVICE_REGISTRY, DATA_SETTINGS, DOMAIN


_ENT_REG = MagicMock()


@pytest.fixture(autouse=True)
def _stubs(monkeypatch):
    mod = sys.modules["homeassistant.components.sensor"]
    monkeypatch.setattr(mod, "SensorStateClass", types.SimpleNamespace(MEASUREMENT="measurement"), raising=False)
    from homeassistant.helpers import entity_registry as er
    monkeypatch.setattr(er, "async_get", lambda h: _ENT_REG, raising=False)


def _boot(data, registry=True, registered=(), known_pids=()):
    from custom_components.padspan_ha import device_tracker as T, sensor as S
    coord = MagicMock()
    listeners = []
    coord.async_add_listener = lambda cb: (listeners.append(cb), (lambda: None))[1]
    st = MagicMock()
    st.data = {}
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    if registry:
        reg = MagicMock()
        reg.get = lambda pid: {"padspan_id": pid} if pid in known_pids else None
        reg.resolve = lambda key: None
        hass.data[DOMAIN][DATA_DEVICE_REGISTRY] = reg
    coord.hass = hass
    coord.data = data
    hass.data[DOMAIN]["presence_coordinator"] = coord
    _ENT_REG.async_get_entity_id = lambda domain, platform, uid: "x" if uid in registered else None
    added = []

    async def go():
        await S.async_setup_entry(hass, MagicMock(), lambda e: added.extend(e))
        await T.async_setup_entry(hass, MagicMock(), lambda e: added.extend(e))
    asyncio.run(go())
    return added, coord, listeners


_IRK = {"kind": "private_ble", "user_label": "Phone", "room": "Kitchen", "address": "5A:11:22:33:44:55",
        "_source_rssi": {"proxy_kitchen": -60}}
_IB = {"kind": "ibeacon", "user_label": "Phone", "room": "Kitchen", "address": "ibeacon:u:1:2",
       "_source_rssi": {"proxy_kitchen": -61}}


def _uids(added):
    return sorted(e.unique_id for e in added)


def test_the_same_entities_whichever_key_is_fresher_at_startup():
    a, _, _ = _boot({"irk:abc": {**_IRK, "age_s": 1}, "ibeacon:u:1:2": {**_IB, "age_s": 2}})
    b, _, _ = _boot({"irk:abc": {**_IRK, "age_s": 2}, "ibeacon:u:1:2": {**_IB, "age_s": 1}})
    assert _uids(a) == _uids(b)
    assert "padspan_ha__irk_abc__tracker" in _uids(a)


def test_an_entity_already_registered_keeps_its_name():
    a, _, _ = _boot({"irk:abc": {**_IRK, "age_s": 1}, "ibeacon:u:1:2": {**_IB, "age_s": 2}},
                    registered={"padspan_ha__ibeacon_u_1_2__tracker", "padspan_ha__ibeacon_u_1_2__area"})
    assert "padspan_ha__ibeacon_u_1_2__tracker" in _uids(a)
    assert "padspan_ha__ibeacon_u_1_2__area" in _uids(a)


def test_the_area_sensor_follows_the_live_key_every_poll():
    data = {"irk:abc": {**_IRK, "age_s": 1}, "ibeacon:u:1:2": {**_IB, "age_s": 50, "room": "Bedroom"}}
    added, coord, listeners = _boot(data)
    area = next(e for e in added if e.unique_id.endswith("__area"))
    assert area._key == "irk:abc"
    coord.data = {"irk:abc": {**_IRK, "age_s": 5000}, "ibeacon:u:1:2": {**_IB, "age_s": 1, "room": "Bedroom"}}
    for cb in listeners:
        cb()
    assert area._key == "ibeacon:u:1:2"
    assert area.native_value == "Bedroom"


def test_entities_wait_for_the_device_list():
    added, _, _ = _boot({"irk:abc": {**_IRK, "age_s": 1}}, registry=False)
    assert added == []


def test_a_scanner_sensor_already_registered_keeps_its_name():
    """Scanner sensors took the label's area-sensor identity without looking
    in the registry, so one an older version had named after the other key
    came back as a new entity."""
    a, _, _ = _boot({"irk:abc": {**_IRK, "age_s": 1}, "ibeacon:u:1:2": {**_IB, "age_s": 2}},
                    registered={"padspan_ha__ibeacon_u_1_2__dist__proxy_kitchen"})
    assert "padspan_ha__ibeacon_u_1_2__dist__proxy_kitchen" in _uids(a)


def test_a_plain_address_device_named_by_its_address_keeps_it():
    """Before the wait for the device list, a plain-address device could be
    registered under its address; once the list loads its saved id became
    the name and a second set of entities appeared."""
    from custom_components.padspan_ha.const import DATA_DEVICE_REGISTRY
    obj = {"kind": "ble", "user_label": "Keys", "room": "Hall", "address": "AA:BB:CC:DD:EE:01",
           "padspan_id": "ps_000000000001", "_source_rssi": {}, "age_s": 1}
    fresh, _, _ = _boot({"ble:AA:BB:CC:DD:EE:01": obj}, known_pids={"ps_000000000001"})
    assert "padspan_ha__ps_000000000001__tracker" in _uids(fresh)    # a new install: the saved id
    added, _, _ = _boot({"ble:AA:BB:CC:DD:EE:01": obj}, known_pids={"ps_000000000001"},
                        registered={"padspan_ha__ble_AA_BB_CC_DD_EE_01__tracker",
                                    "padspan_ha__ble_AA_BB_CC_DD_EE_01__area"})
    assert "padspan_ha__ble_AA_BB_CC_DD_EE_01__tracker" in _uids(added)
    assert "padspan_ha__ble_AA_BB_CC_DD_EE_01__area" in _uids(added)


def test_a_bermuda_entity_never_names_a_new_tracker():
    """A Bermuda entity object takes the label through its device's MAC and
    beat the saved id alphabetically; a restart without it (Bermuda Ignore
    on, Bermuda removed) made device_tracker.keys_2. One an older version
    already named after it keeps that name."""
    ble = {"kind": "ble", "user_label": "Keys", "room": "Hall", "address": "AA:BB:CC:DD:EE:01",
           "padspan_id": "ps_000000000001", "_source_rssi": {}, "age_s": 5}
    ent = {"kind": "entity", "user_label": "Keys", "room": "Hall", "entity_id": "sensor.keys_area",
           "address": "AA:BB:CC:DD:EE:01", "age_s": 1}
    data = {"ble:AA:BB:CC:DD:EE:01": ble, "entity:sensor.keys_area": ent}
    fresh, _, _ = _boot(data, known_pids={"ps_000000000001"})
    assert [e.unique_id for e in fresh if e.unique_id.endswith("__tracker")] == [
        "padspan_ha__ps_000000000001__tracker"]
    old = "padspan_ha__entity_sensor.keys_area__tracker"
    added, _, _ = _boot(data, known_pids={"ps_000000000001"}, registered={old})
    assert [e.unique_id for e in added if e.unique_id.endswith("__tracker")] == [old]
