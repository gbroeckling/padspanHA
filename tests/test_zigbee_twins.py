# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One Zigbee device in Home Assistant twice (zigbee_twins.py).

The device registry fixtures below are shaped as the integrations register
them: Zigbee2MQTT through MQTT discovery (identifier "zigbee2mqtt_0x<ieee>",
every device via its bridge "zigbee2mqtt_bridge_0x<coordinator>"), ZHA
(identifier and "zigbee" connection "aa:bb:...", every device via its
coordinator, the one ZHA device with no via), deCONZ (a "zigbee" connection,
via its gateway). The addresses are made up.
"""

from __future__ import annotations

import ast
import asyncio
import json
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_common as C
from custom_components.padspan_ha import zigbee_twins as Z
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"

PORCH = "a4c1380000000001"          # made-up addresses
HALL = "00158d0000000002"
STUDY = "54ef440000000003"
Z2M_STICK = "00124b0000000a01"
ZHA_STICK = "00124b0000000a02"


def _colons(a: str) -> str:
    return ":".join(a[i:i + 2] for i in range(0, 16, 2))


def dev(id, identifiers=(), connections=(), via=None, name=None, disabled_by=None, name_by_user=None):
    return SimpleNamespace(id=id, identifiers={tuple(i) for i in identifiers}, connections={tuple(c) for c in connections},
                           via_device_id=via, name=name or id, name_by_user=name_by_user, disabled_by=disabled_by)


def z2m(id, addr, name=None, **kw):
    return dev(id, [("mqtt", f"zigbee2mqtt_0x{addr}")], (), via="z2m_bridge", name=name, **kw)


def zha(id, addr, name=None, **kw):
    kw.setdefault("via", "zha_coord")
    return dev(id, [("zha", _colons(addr))], [("zigbee", _colons(addr))], name=name, **kw)


def deconz(id, addr, name=None, **kw):
    kw.setdefault("via", "deconz_gw")
    return dev(id, [("deconz", _colons(addr))], [("zigbee", _colons(addr))], name=name, **kw)


def ent(eid, device_id, dc=None, unit=None, category=None, name=None, key=None, disabled_by=None, original_dc=None):
    return SimpleNamespace(entity_id=eid, device_id=device_id, device_class=dc, original_device_class=original_dc,
                           unit_of_measurement=unit, entity_category=category, original_name=name,
                           translation_key=key, disabled_by=disabled_by)


BRIDGE = dev("z2m_bridge", [("mqtt", f"zigbee2mqtt_bridge_0x{Z2M_STICK}")], name="Zigbee2MQTT Bridge")
COORD = dev("zha_coord", [("zha", _colons(ZHA_STICK))], [("zigbee", _colons(ZHA_STICK))], name="Zigbee Coordinator")
GATEWAY = dev("deconz_gw", [("deconz", "00212EFFFF000001")], [("mac", "00:21:2e:ff:ff:00")], name="deCONZ gateway")


def house():
    """A home with both integrations, each with its stick, one sensor in both."""
    devices = [BRIDGE, COORD, z2m("z_porch", PORCH, "Porch sensor"), zha("h_porch", PORCH, "Porch motion"),
               z2m("z_hall", HALL, "Hall light"), zha("h_study", STUDY, "Study plug")]
    entities = [
        ent("binary_sensor.porch_occupancy", "z_porch", "occupancy", name="Occupancy"),
        ent("sensor.porch_temperature", "z_porch", "temperature", "°C", name="Temperature"),
        ent("sensor.porch_device_temperature", "z_porch", "temperature", "°C", "diagnostic", name="Device temperature"),
        ent("sensor.porch_battery", "z_porch", "battery", "%", "diagnostic", name="Battery"),
        ent("sensor.porch_linkquality", "z_porch", None, "lqi", "diagnostic", name="Linkquality"),
        ent("binary_sensor.porch_motion_motion", "h_porch", original_dc="motion", name="Motion"),
        ent("sensor.porch_motion_temperature", "h_porch", original_dc="temperature", unit="°C"),
        ent("sensor.porch_motion_battery", "h_porch", original_dc="battery", unit="%", category="diagnostic"),
        ent("sensor.porch_motion_rssi", "h_porch", original_dc="signal_strength", unit="dBm", category="diagnostic"),
        ent("light.hall_light", "z_hall"),
        ent("switch.study_plug", "h_study"),
    ]
    return devices, entities


# ── the address ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw,want", [
    ("0xA4C1380000000001", PORCH), ("a4:c1:38:00:00:00:00:01", PORCH), ("a4-c1-38-00-00-00-00-01", PORCH),
    ("a4c1380000000001", PORCH), ("0xa4c13800000000", None), ("not an address", None), ("", None), (None, None),
])
def test_an_address_reads_the_same_whichever_way_it_is_written(raw, want):
    assert Z.zigbee_address(raw) == want


def test_each_integrations_shape_gives_the_address_and_who_has_it():
    assert Z.device_copy(z2m("a", PORCH)) == (PORCH, Z.Z2M, False)
    assert Z.device_copy(zha("b", PORCH)) == (PORCH, Z.ZHA, False)
    assert Z.device_copy(deconz("c", PORCH)) == (PORCH, Z.DECONZ, False)
    assert Z.device_copy(BRIDGE) == (Z2M_STICK, Z.Z2M, True)
    # Not Zigbee devices: a Zigbee2MQTT group, a deCONZ gateway, a Wi-Fi plug, an MQTT device of another kind.
    assert Z.device_copy(dev("g", [("mqtt", "zigbee2mqtt_1221051039810110150109113116116_5")])) is None
    assert Z.device_copy(GATEWAY) is None
    assert Z.device_copy(dev("w", [("tplink", "abc")], [("mac", "aa:bb:cc:dd:ee:ff")])) is None
    assert Z.device_copy(dev("t", [("mqtt", "tasmota_0x1234")])) is None


# ── which devices are twins, and which copy is kept ──────────────────────────

def test_a_device_in_zha_and_zigbee2mqtt_is_one_unit_and_zigbee2mqtt_is_kept():
    t = Z.find_twins(*house())
    assert t["devices"] == {"h_porch": {"name": "Porch motion", "via": "ZHA", "twin": "z_porch",
                                        "twin_name": "Porch sensor", "twin_via": "Zigbee2MQTT"}}
    assert [(p["keep"], p["copies"], p["address"]) for p in t["pairs"]] == [("z_porch", ["h_porch"], PORCH)]
    # A device in one integration only is nobody's twin.
    assert not {"z_hall", "h_study"} & (set(t["devices"]) | {p["keep"] for p in t["pairs"]})


def test_the_name_given_in_home_assistant_is_the_one_shown():
    devices, entities = house()
    devices[3] = zha("h_porch", PORCH, "Porch motion", name_by_user="Front porch (old)")
    assert Z.find_twins(devices, entities)["devices"]["h_porch"]["name"] == "Front porch (old)"


def test_the_coordinator_sticks_are_never_duplicates():
    # Each stick in both integrations: the ZHA copy of Zigbee2MQTT's stick, and
    # Zigbee2MQTT's bridge and a ZHA coordinator on the same stick.
    devices = [BRIDGE, COORD, zha("h_old_stick", Z2M_STICK, "Old coordinator"),
               dev("zha_coord2", [("zha", _colons(Z2M_STICK))], [("zigbee", _colons(Z2M_STICK))]),
               z2m("z_zha_stick", ZHA_STICK, "Coordinator seen by Zigbee2MQTT")]
    t = Z.find_twins(devices, [])
    assert t == {"devices": {}, "entities": {}, "pairs": []}


def test_a_device_others_are_registered_via_is_a_coordinator():
    # A deCONZ-style hub that is itself a Zigbee device: never a duplicate.
    hub = deconz("hub", PORCH, "Hub")
    child = deconz("child", HALL, "Child", via="hub")
    t = Z.find_twins([hub, child, z2m("z_hub", PORCH), BRIDGE, GATEWAY], [])
    assert t["pairs"] == []


@pytest.mark.parametrize("copies,kept", [
    ((Z.Z2M, Z.ZHA, Z.DECONZ), "z2m"),
    ((Z.ZHA, Z.DECONZ), "zha"),
    ((Z.DECONZ, Z.Z2M), "z2m"),
])
def test_zigbee2mqtt_first_then_zha_then_deconz(copies, kept):
    make = {Z.Z2M: lambda: z2m("z2m", PORCH, "A"), Z.ZHA: lambda: zha("zha", PORCH, "B"), Z.DECONZ: lambda: deconz("deconz", PORCH, "C")}
    for order in (copies, tuple(reversed(copies))):
        t = Z.find_twins([BRIDGE, COORD, GATEWAY] + [make[c]() for c in order], [])
        assert [p["keep"] for p in t["pairs"]] == [kept]
        assert set(t["devices"]) == {c if c != Z.Z2M else "z2m" for c in copies} - {kept}


def test_a_disabled_copy_is_no_copy():
    devices, entities = house()
    devices[2] = z2m("z_porch", PORCH, "Porch sensor", disabled_by="user")
    assert Z.find_twins(devices, entities)["pairs"] == []


# ── each entity of the copy, to the kept one's ───────────────────────────────

def test_each_entity_maps_to_the_one_that_measures_the_same():
    ents = Z.find_twins(*house())["entities"]
    assert ents == {
        # ZHA's "motion" is Zigbee2MQTT's "occupancy": the same sensor.
        "binary_sensor.porch_motion_motion": {"twin": "binary_sensor.porch_occupancy", "device": "h_porch"},
        # Two temperatures on the kept copy; the device's own is diagnostic, the room's is not.
        "sensor.porch_motion_temperature": {"twin": "sensor.porch_temperature", "device": "h_porch"},
        "sensor.porch_motion_battery": {"twin": "sensor.porch_battery", "device": "h_porch"},
        # Signal strength: Zigbee2MQTT has nothing like it, so it is no duplicate (still listed).
    }


def test_several_that_could_be_it_is_no_twin_and_still_a_duplicate():
    devices = [BRIDGE, COORD, z2m("z_t", HALL, "Thermostat"), zha("h_t", HALL, "Thermostat")]
    entities = [ent("sensor.t_local_temperature", "z_t", "temperature", "°C", name="Local temperature"),
                ent("sensor.t_temperature", "z_t", "temperature", "°C", name="Temperature"),
                ent("sensor.t_zha_temperature", "h_t", original_dc="temperature", unit="°C"),
                ent("sensor.t_zha_air", "h_t", original_dc="temperature", unit="°C", name="Temperature")]
    ents = Z.find_twins(devices, entities)["entities"]
    assert ents["sensor.t_zha_temperature"] == {"twin": "", "device": "h_t"}
    assert ents["sensor.t_zha_air"] == {"twin": "sensor.t_temperature", "device": "h_t"}   # its name settles it


def test_a_light_maps_to_the_light_and_a_door_to_the_contact():
    devices = [BRIDGE, COORD, z2m("z_l", HALL, "Bulb"), zha("h_l", HALL, "Bulb"), z2m("z_d", STUDY, "Door"), zha("h_d", STUDY, "Door")]
    entities = [ent("light.bulb", "z_l"), ent("light.bulb_2", "h_l"),
                ent("binary_sensor.door_contact", "z_d", "door"), ent("binary_sensor.door_opening", "h_d", original_dc="opening"),
                ent("binary_sensor.door_tamper", "z_d", "tamper", category="diagnostic")]
    ents = Z.find_twins(devices, entities)["entities"]
    assert ents["light.bulb_2"]["twin"] == "light.bulb"
    assert ents["binary_sensor.door_opening"]["twin"] == "binary_sensor.door_contact"


def test_a_disabled_entity_is_never_the_twin():
    devices = [BRIDGE, COORD, z2m("z_l", HALL, "Bulb"), zha("h_l", HALL, "Bulb")]
    entities = [ent("light.bulb", "z_l", disabled_by="user"), ent("light.bulb_2", "h_l")]
    assert Z.find_twins(devices, entities)["entities"] == {}


# ── the panel gets it in its settings, without asking ────────────────────────

def _hass(devices, entities, told=()):
    st = SimpleNamespace(data={"data_mode": "live", Z.TOLD_KEY: list(told)})
    async def _set(**kw):
        st.data = {**st.data, **kw}
        return st.data
    st.async_set = _set
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: st}}
    return h


@pytest.fixture
def registries(monkeypatch):
    """Home Assistant's registries, as find_twins reads them (dr.async_get, er.async_get)."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er
    held = {"devices": [], "entities": []}
    monkeypatch.setattr(dr, "async_get", lambda h: SimpleNamespace(devices={d.id: d for d in held["devices"]}), raising=False)
    monkeypatch.setattr(er, "async_get", lambda h: SimpleNamespace(entities={e.entity_id: e for e in held["entities"]}), raising=False)
    return held


def test_the_panels_settings_carry_the_copies_and_never_an_address(registries):
    registries["devices"], registries["entities"] = house()
    h = _hass(*house(), told=[f"{PORCH}:zha+zigbee2mqtt"])
    conn = SimpleNamespace(user=SimpleNamespace(is_admin=True))
    out = C._get_settings(h, conn)
    assert out["zigbee_twins"]["devices"]["h_porch"]["twin"] == "z_porch"
    assert out["zigbee_twins"]["entities"]["sensor.porch_motion_battery"]["twin"] == "sensor.porch_battery"
    text = json.dumps(out)
    assert PORCH not in text and _colons(PORCH) not in text and Z.TOLD_KEY not in out
    # Read inside the backend, the settings are only the settings.
    assert "zigbee_twins" not in C._get_settings(h)


def test_a_home_with_no_twins_gets_empty_maps(registries):
    out = C._get_settings(_hass([], []), SimpleNamespace(user=None))
    assert out["zigbee_twins"] == {"devices": {}, "entities": {}}


# ── told once, when a copy appears ───────────────────────────────────────────

class _Bus:
    def __init__(self):
        self.listeners = {}

    def async_listen(self, name, fn):
        self.listeners.setdefault(name, []).append(fn)
        return lambda: self.listeners[name].remove(fn)

    def fire(self, name, data):
        for fn in list(self.listeners.get(name, [])):
            fn(SimpleNamespace(data=data))


def _live(registries, monkeypatch, told=()):
    shown = []
    pn = types.ModuleType("homeassistant.components.persistent_notification")
    pn.async_create = lambda hass, message, **kw: shown.append({"message": message, **kw})
    monkeypatch.setitem(sys.modules, "homeassistant.components.persistent_notification", pn)
    h = _hass([], [], told)
    h.bus = _Bus()
    tasks = []
    h.async_create_task = lambda coro: tasks.append(coro)
    Z.async_setup_zigbee_twins(h)

    def run():
        while tasks:
            asyncio.run(tasks.pop(0))
    return h, shown, run


def test_a_new_copy_is_told_once_naming_both_and_the_one_used(registries, monkeypatch):
    devices, entities = house()
    registries["devices"] = [d for d in devices if d.id != "h_porch"]
    registries["entities"] = entities
    h, shown, run = _live(registries, monkeypatch)
    assert Z.panel_twins(h)["devices"] == {}                   # before: one copy
    registries["devices"] = devices                            # ZHA adds the porch sensor
    h.bus.fire("device_registry_updated", {"action": "create", "device_id": "h_porch"})
    run()
    assert len(shown) == 1
    n = shown[0]
    assert "Porch motion" in n["message"] and "Porch sensor" in n["message"]
    assert "ZHA just added **Porch motion**" in n["message"] and "Zigbee2MQTT as **Porch sensor**" in n["message"]
    assert "PadSpan uses the Zigbee2MQTT one" in n["message"] and "Home Assistant itself is unchanged" in n["message"]
    assert n["title"] == "PadSpan: a Zigbee device is in Home Assistant twice"
    assert Z.panel_twins(h)["devices"]["h_porch"]["twin"] == "z_porch"   # the panel's map follows at once
    # The same pair again (an update to it, the copy removed and added back): never told twice.
    h.bus.fire("device_registry_updated", {"action": "update", "device_id": "h_porch", "changes": {"identifiers": set()}})
    h.bus.fire("device_registry_updated", {"action": "create", "device_id": "z_porch"})
    run()
    assert len(shown) == 1
    assert h.data[DOMAIN][DATA_SETTINGS].data[Z.TOLD_KEY] == [f"{PORCH}:zha+zigbee2mqtt"]


def test_remembered_across_a_restart(registries, monkeypatch):
    registries["devices"], registries["entities"] = house()
    _h, shown, run = _live(registries, monkeypatch, told=[f"{PORCH}:zha+zigbee2mqtt"])
    _h.bus.fire("device_registry_updated", {"action": "create", "device_id": "h_porch"})
    run()
    assert shown == []


def test_the_zigbee2mqtt_copy_added_second_is_told_the_other_way_round(registries, monkeypatch):
    registries["devices"], registries["entities"] = house()
    h, shown, run = _live(registries, monkeypatch)
    h.bus.fire("device_registry_updated", {"action": "create", "device_id": "z_porch"})
    run()
    assert len(shown) == 1
    assert "Zigbee2MQTT just added **Porch sensor**, a device already in ZHA as **Porch motion**" in shown[0]["message"]
    assert "leaves the ZHA copy out" in shown[0]["message"]


def test_a_device_that_is_nobodys_twin_and_a_change_that_identifies_nothing_say_nothing(registries, monkeypatch):
    registries["devices"], registries["entities"] = house()
    h, shown, run = _live(registries, monkeypatch)
    h.bus.fire("device_registry_updated", {"action": "create", "device_id": "z_hall"})
    h.bus.fire("device_registry_updated", {"action": "update", "device_id": "h_porch", "changes": {"sw_version": "1"}})
    h.bus.fire("device_registry_updated", {"action": "remove", "device_id": "h_study"})
    run()
    assert shown == []


def test_a_registry_change_is_read_afresh_and_nothing_else_reads_it_again(registries, monkeypatch):
    devices, entities = house()
    registries["devices"], registries["entities"] = devices, entities
    h, _shown, _run = _live(registries, monkeypatch)
    first = Z.twins(h)
    registries["devices"] = [d for d in devices if d.id != "h_porch"]
    assert Z.twins(h) is first                                  # nothing changed as far as anyone said
    h.bus.fire("entity_registry_updated", {"action": "update", "entity_id": "light.hall_light"})
    assert Z.twins(h)["pairs"] == []                            # an entity change: read again
    registries["devices"] = devices
    h.bus.fire("device_registry_updated", {"action": "remove", "device_id": "x"})
    assert Z.twins(h)["pairs"] != []
    Z.async_stop_zigbee_twins(h)
    assert h.bus.listeners == {"device_registry_updated": [], "entity_registry_updated": []}


def test_it_listens_and_never_polls():
    src = (_CC / "zigbee_twins.py").read_text(encoding="utf-8")
    for poll in ("async_track_time_interval", "async_call_later", "call_later", "asyncio.sleep", "async_track_point_in"):
        assert poll not in src, poll
    tree = ast.parse((_CC / "__init__.py").read_text(encoding="utf-8"))
    called = {n.func.id for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert {"async_setup_zigbee_twins", "async_stop_zigbee_twins"} <= called
