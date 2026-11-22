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
import shutil
import subprocess
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
_VIEWS = _CC / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

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


def _live(registries, monkeypatch, told=(Z.EXISTING,)):
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
    run()                                   # setup's own task: the pairs already there
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
    assert h.data[DOMAIN][DATA_SETTINGS].data[Z.TOLD_KEY] == [Z.EXISTING, f"{PORCH}:zha+zigbee2mqtt"]


def test_remembered_across_a_restart(registries, monkeypatch):
    registries["devices"], registries["entities"] = house()
    _h, shown, run = _live(registries, monkeypatch, told=[Z.EXISTING, f"{PORCH}:zha+zigbee2mqtt"])
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


# ── the panel (tests/js/zigbee_twins.mjs runs it) ────────────────────────────

@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "zigbee_twins.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_panel_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)


@pytest.mark.parametrize("case", [
    "the rain list leaves the ZHA copy out",
    "and says so, quietly, under it",
    "and is said so, naming the Zigbee2MQTT one",
    "nothing is switched by itself",
    "pressed, it uses the Zigbee2MQTT one everywhere PadSpan keeps it",
])
def test_the_rain_sensor_list(harness, case) -> None:
    assert harness["cases"].get(case) is True, case


@pytest.mark.parametrize("case", [
    "the Atlas leaves an unplaced duplicate copy out",
    "and keeps one that is placed",
    "the light index says so, quietly, in its header",
    "a placed duplicate's row names the Zigbee2MQTT one",
    "nothing moved by itself",
    "the row's button moves it to the Zigbee2MQTT one when pressed",
    "a team's duplicate bulb is still listed, ticked",
    "its button moves the team to the Zigbee2MQTT one, read back",
    "with nothing unsaved the button is there to press",
    "with an unsaved edit it waits, and says why",
    "pressed then, nothing is moved and the edit stays",
    "saved, it is there to press again",
    "Live Aboard's room list leaves the duplicate copy out",
])
def test_the_atlas_and_power_teams(harness, case) -> None:
    assert harness["cases"].get(case) is True, case


def test_every_list_that_offers_a_device_leaves_the_duplicate_out() -> None:
    """Each place PadSpan offers Home Assistant devices to pick or place reads the one map (views/zigbee_twins.js)."""
    www = _CC / "www" / "padspan-ha"
    wired = {
        "views/settings.js": ["TW.dropDuplicates(offered, settings, [cur])", "TW.duplicateWarningEl(cur, settings, states,",
                              "TW.duplicateOf(e, ctx.state.settings)", "TW.duplicateOf(e, settings)"],
        "views/lights_map.js": ["export function withoutZigbeeDuplicates(", "TW.duplicateOf(eid, o)", "twins: TW"],
        "views/maps.js": ["withoutZigbeeDuplicates(gathered, ctx.state.settings,", "zigbeeTwins,", "onUseTwin:", "_noTwins(candidates, ctx,"],
        "lights_panel.js": ["withoutZigbeeDuplicates(gathered, { zigbee_twins: this.state._zigbeeTwins },", "zigbeeTwins,"],
        "views/rooms.js": ["_LM.withoutZigbeeDuplicates(_LM.gatherLights("],
        "views/power_teams.js": ["TW.duplicateOf(eid", "TW.duplicateWarningEl(t.power"],
        "views/devices.js": ["_dup(ctx, c.entity_id)", "TW.duplicateWarningEl(eid, ctx.state.settings, states"],
        "views/live_aboard_edit.js": ["tw.duplicateOf(eid, host.settings3d)", "tw.duplicateWarningEl(cur.link"],
        "views/live_aboard_furnish.js": ["host.twins.duplicateOf(eid, host.settings)", "host.twins.duplicateWarningEl(p.entity_id"],
        "views/aboard_wizard.js": ["settings.zigbee_twins.entities"],
        "views/house_activity.js": ["withoutZigbeeDuplicates(gathered, settings,"],
        "views/live_aboard_rooms.js": ["twins[eid]"],
        "views/live_aboard.js": ["lastP && lastP.settings3d));"],
    }
    for rel, wants in wired.items():
        src = (www / rel).read_text(encoding="utf-8")
        for want in wants:
            assert want in src, (rel, want)


# ── the pairs already there when this version first runs ─────────────────────

def _many(n):
    """n devices in both Zigbee2MQTT and ZHA (made-up addresses, names Device 01...)."""
    devices, entities = [BRIDGE, COORD], []
    for i in range(n):
        addr = f"a4c13800000001{i:02x}"
        devices += [z2m(f"z{i}", addr, f"Device {i + 1:02d}"), zha(f"h{i}", addr, f"Device {i + 1:02d} (old)")]
        entities += [ent(f"light.d{i}", f"z{i}"), ent(f"light.d{i}_2", f"h{i}")]
    return devices, entities


def test_the_pairs_already_there_are_told_once_together(registries, monkeypatch):
    registries["devices"], registries["entities"] = _many(12)
    h, shown, run = _live(registries, monkeypatch, told=())
    run()
    assert len(shown) == 1, shown
    n = shown[0]
    assert n["title"] == "PadSpan: 12 Zigbee devices are in Home Assistant twice"
    assert n["notification_id"] == "padspan_ha_zigbee_twins_existing"
    m = n["message"]
    assert m.startswith("12 Zigbee devices are in Home Assistant twice, with the same Zigbee address in two integrations.")
    assert "PadSpan uses the Zigbee2MQTT copy and leaves the other out of its lists" in m
    named = [ln for ln in m.splitlines() if ln.startswith("- **")]
    assert len(named) == 10 and named[0] == "- **Device 01** (Zigbee2MQTT), also in ZHA as **Device 01 (old)**"
    assert "- and 2 more" in m and "Home Assistant itself is unchanged." in m
    told = h.data[DOMAIN][DATA_SETTINGS].data[Z.TOLD_KEY]
    assert told[0] == Z.EXISTING and len(told) == 13
    # Every one of them is remembered: one of them changing later says nothing.
    h.bus.fire("device_registry_updated", {"action": "create", "device_id": "h3"})
    run()
    assert len(shown) == 1


def test_once_ever_even_after_a_restart(registries, monkeypatch):
    registries["devices"], registries["entities"] = _many(2)
    h, shown, run = _live(registries, monkeypatch, told=())
    run()
    told = list(h.data[DOMAIN][DATA_SETTINGS].data[Z.TOLD_KEY])
    _h2, shown2, run2 = _live(registries, monkeypatch, told=told)          # Home Assistant again
    run2()
    assert len(shown) == 1 and shown2 == []


def test_one_pair_reads_as_one(registries, monkeypatch):
    registries["devices"], registries["entities"] = _many(1)
    _h, shown, run = _live(registries, monkeypatch, told=())
    run()
    assert shown[0]["title"] == "PadSpan: a Zigbee device is in Home Assistant twice"
    assert shown[0]["message"].startswith("A Zigbee device is in Home Assistant twice,") and "more" not in shown[0]["message"]


def test_none_there_says_nothing_and_a_later_one_is_told_on_its_own(registries, monkeypatch):
    devices, entities = house()
    registries["devices"], registries["entities"] = [d for d in devices if d.id != "h_porch"], entities
    h, shown, run = _live(registries, monkeypatch, told=())
    run()
    assert shown == [] and h.data[DOMAIN][DATA_SETTINGS].data[Z.TOLD_KEY] == [Z.EXISTING]
    registries["devices"] = devices
    h.bus.fire("device_registry_updated", {"action": "create", "device_id": "h_porch"})
    run()
    assert len(shown) == 1 and "ZHA just added **Porch motion**" in shown[0]["message"]


def test_a_pair_told_on_its_own_is_not_told_again_in_the_first_runs_notice(registries, monkeypatch):
    registries["devices"], registries["entities"] = _many(3)
    first = Z.find_twins(*_many(3))["pairs"][0]["key"]
    _h, shown, run = _live(registries, monkeypatch, told=[first])
    run()
    assert len(shown) == 1 and shown[0]["title"] == "PadSpan: 2 Zigbee devices are in Home Assistant twice"
    assert "Device 01" not in shown[0]["message"]


# ── "Use the Zigbee2MQTT one": everything the copy had ───────────────────────

def test_rekey_moves_values_and_keys_and_keeps_the_twins_own():
    old, new = "light.a_2", "light.a"
    v, n = Z.rekey({"shapes": {old: "bar", "light.b": "spot"}, "hidden": [old, "light.b", new], "one": old,
                    "teams": [{"power": old, "bulbs": [old, "light.c"]}], "n": 3}, old, new)
    assert v == {"shapes": {new: "bar", "light.b": "spot"}, "hidden": [new, "light.b"], "one": new,
                 "teams": [{"power": new, "bulbs": [new, "light.c"]}], "n": 3}
    assert n == 5
    kept, n2 = Z.rekey({old: "bar", new: "spot"}, old, new)
    assert kept == {new: "spot"} and n2 == 1, "the twin's own entry stays; the copy's goes"
    same = {"x": ["light.b"]}
    assert Z.rekey(same, old, new) == (same, 0) and Z.rekey(same, old, new)[0] is same
    assert Z.rekey("light.a_23", old, new) == ("light.a_23", 0), "only the whole id"


DUP, TWIN = "light.porch_2", "light.porch"                 # a bulb: ZHA's copy, Zigbee2MQTT's
DOOR_DUP, DOOR = "binary_sensor.back_door_2", "binary_sensor.back_door"


def _settings_for_move():
    return {
        "light_shapes": {DUP: "bar", "light.other": "spot"},
        "light_type_overrides": {DUP: "wled"},
        "lights_hidden": [DUP, "light.other"],
        "atlas_weather_rain_entity": "binary_sensor.rain",
        "power_teams": [{"id": "t1", "name": "Porch", "power": "switch.wall", "bulbs": [DUP], "off": "power", "adaptive": True}],
        "vacation_mode_anchors": [DUP],
        "vacation_mode_pattern": {DUP: {"0:1900": 0.8}},
        "emergency_entities": [DUP],
        "whole_house_presets": [{"name": "Evening", "entities": {DUP: {"state": "on"}}}],
        "padspan_automations": [{"device": "KEYS", "action": "turn_on", "entity_id": DUP}],
        "atlas_3d_director": [{"entity": DOOR_DUP, "camera": ""}],
        "flood_latches": {},
        "door_opener_ids": [],
        Z.TOLD_KEY: [Z.EXISTING],
    }


_LA_FILE = {
    "schema": 1,
    "lights": {DUP: {"z_m": 2.1, "kind": "pendant"}},
    "devices": {DOOR_DUP: {"z_m": 1.1}},
    "openings": {"bar_back": {"type": "hinged", "link": DOOR_DUP}},
    "pieces": {"p1": {"recipe": {"kind": "lamp", "params": {}, "colors": []}, "floor_id": "main", "x_m": 1.0, "y_m": 1.0,
                      "rotation": 0, "entity_id": DUP, "entity_reg_id": "reg-old", "label": "Porch lamp"}},
    "figures": {}, "library": {},
}
_FAB = {"floors": {}, "history": [], "scanner_positions_m": {}, "beacon_positions_m": {},
        "rf_barriers_m": [{"id": "bar_back", "name": "Back door", "material": "wood", "floor_id": "main",
                           "points_m": [[1, 0], [1.9, 0]], "linked_entity_id": DOOR_DUP, "invert_state": True,
                           "linked_lock_entity_id": "lock.back"}],
        "light_positions_m": {DUP: {"x_m": 3.0, "y_m": 1.5, "floor_id": "main", "color": "#fbbf24", "shape": "pendant",
                                    "rotation": 30.0, "width_cm": 40, "label": "Porch"}},
        "light_heights_m": {DUP: 2.2}}


@pytest.fixture
def stores(monkeypatch, tmp_path):
    """Settings, a real fabric and Live Aboard's real file, on disk."""
    import copy as _copy

    from custom_components.padspan_ha import fabric_store as FS
    from custom_components.padspan_ha.const import DATA_FABRIC, DATA_HOUSE3D, DATA_MODEL, FABRIC_STORE_KEY
    from custom_components.padspan_ha.model_store import ModelStore
    from tests.test_house3d_edit import _DiskStore, _seed
    from tests.test_house3d_store import _house, _run
    import homeassistant.helpers.storage as _hs
    _DiskStore.root, _DiskStore.writes, _DiskStore.fail, _DiskStore.slow = tmp_path, [], [], False
    monkeypatch.setattr(_hs, "Store", _DiskStore)
    monkeypatch.setattr(FS, "Store", _DiskStore)
    _seed(tmp_path, _copy.deepcopy(_LA_FILE))
    _seed(tmp_path, _copy.deepcopy(_FAB), FABRIC_STORE_KEY)
    h = _house(tmp_path, on=True)
    st = h.data[DOMAIN][DATA_SETTINGS]
    st.data.update(_copy.deepcopy(_settings_for_move()))
    fab = FS.FabricStore(h)
    _run(fab.async_setup())
    mdl = ModelStore.__new__(ModelStore)
    mdl.data, mdl.fabric = {}, fab
    h.data[DOMAIN][DATA_MODEL] = mdl
    h.data[DOMAIN][DATA_FABRIC] = fab
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)
    from homeassistant.helpers import entity_registry as er
    monkeypatch.setattr(er, "async_get", lambda hass: SimpleNamespace(
        async_get=lambda eid: SimpleNamespace(id="reg-twin") if eid == TWIN else None), raising=False)
    told = []
    monkeypatch.setattr("custom_components.padspan_ha.power_team.async_setup_power_teams", lambda hass: told.append("teams"))
    return SimpleNamespace(h=h, st=st, mdl=mdl, run=_run, tmp=tmp_path, teams=told)


def _la_disk(tmp_path):
    from tests.test_house3d_edit import _file
    return json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]


def test_every_setting_naming_the_copy_now_names_the_twin(stores):
    moved = stores.run(Z.async_use_twin(stores.h, DUP, TWIN))
    d = stores.st.data
    assert d["light_shapes"] == {TWIN: "bar", "light.other": "spot"}, "its shape"
    assert d["light_type_overrides"] == {TWIN: "wled"}, "its type"
    assert d["lights_hidden"] == [TWIN, "light.other"], "hidden from the map"
    assert d["power_teams"][0]["bulbs"] == [TWIN] and d["power_teams"][0]["power"] == "switch.wall", "its power team"
    assert stores.teams == ["teams"], "the teams run with it at once"
    assert d["vacation_mode_anchors"] == [TWIN] and d["vacation_mode_pattern"] == {TWIN: {"0:1900": 0.8}}, "Vacation Mode"
    assert d["emergency_entities"] == [TWIN], "the emergency lighting test"
    assert d["whole_house_presets"][0]["entities"] == {TWIN: {"state": "on"}}, "Whole house presets"
    assert d["padspan_automations"][0]["entity_id"] == TWIN, "PadSpan's automations"
    assert d["atlas_3d_director"] == [{"entity": DOOR_DUP, "camera": ""}], "another entity's entries are left alone"
    assert d[Z.TOLD_KEY] == [Z.EXISTING] and moved["settings"] == 9
    assert DUP not in json.dumps({k: v for k, v in d.items()}), "nothing names the copy any more"


def test_its_place_looks_label_and_height_arrive_and_the_copys_go(stores):
    moved = stores.run(Z.async_use_twin(stores.h, DUP, TWIN))
    placed = stores.mdl.light_positions_m()
    assert DUP not in placed
    assert placed[TWIN] == {"x_m": 3.0, "y_m": 1.5, "floor_id": "main", "color": "#fbbf24", "shape": "pendant",
                            "rotation": 30.0, "width_cm": 40, "label": "Porch", "z_m": 2.2}
    assert DUP not in stores.mdl.fabric.light_heights_m()
    assert moved["placement"] == 1 and stores.mdl.fabric.data["history"][-1]["op"] == "zigbee_twin_use"


def test_a_wall_link_moves_with_its_invert_and_lock(stores):
    moved = stores.run(Z.async_use_twin(stores.h, DOOR_DUP, DOOR))
    bar = stores.mdl.fabric.rf_barriers_m()[0]
    assert bar["linked_entity_id"] == DOOR and bar["invert_state"] is True and bar["linked_lock_entity_id"] == "lock.back"
    assert bar["material"] == "wood" and bar["points_m"] == [[1, 0], [1.9, 0]] and bar["id"] == "bar_back"
    assert moved["walls"] == 1
    assert stores.st.data["atlas_3d_director"] == [{"entity": DOOR, "camera": ""}], "Live Aboard's director"


def test_live_aboards_links_heights_and_runs_arrive(stores):
    stores.run(Z.async_use_twin(stores.h, DUP, TWIN))
    stores.run(Z.async_use_twin(stores.h, DOOR_DUP, DOOR))
    f = _la_disk(stores.tmp)
    assert f["lights"] == {TWIN: {"z_m": 2.1, "kind": "pendant"}}, "its 3D height and kind"
    assert f["devices"] == {DOOR: {"z_m": 1.1}}, "a sensor's 3D height"
    assert f["openings"]["bar_back"]["link"] == DOOR, "the door that follows it"
    assert f["pieces"]["p1"]["entity_id"] == TWIN and f["pieces"]["p1"]["entity_reg_id"] == "reg-twin", "the furniture linked to it"
    assert f["pieces"]["p1"]["label"] == "Porch lamp"
    assert DUP not in json.dumps(f) and DOOR_DUP not in json.dumps(f)


def test_a_chosen_rain_sensor_moves_and_its_wet_time_starts_again(stores, monkeypatch):
    from custom_components.padspan_ha import rain_wet
    stores.st.data.update({"atlas_weather_rain_entity": "binary_sensor.rain_2", rain_wet.KEY: 1000.0})
    monkeypatch.setattr(rain_wet, "wet_since_for", lambda hass, eid: 0 if eid == "binary_sensor.rain" else -1)
    stores.run(Z.async_use_twin(stores.h, "binary_sensor.rain_2", "binary_sensor.rain"))
    assert stores.st.data["atlas_weather_rain_entity"] == "binary_sensor.rain"
    assert stores.st.data[rain_wet.KEY] == 0, "as settings_set: the old sensor's wet time says nothing about this one"


def test_what_the_twin_already_has_of_its_own_stays(stores):
    stores.st.data["light_shapes"][TWIN] = "spot"
    stores.run(stores.mdl.fabric.async_spatial_update(set_lights={TWIN: {"x_m": 9.0, "y_m": 9.0, "floor_id": "main"}}))
    stores.run(Z.async_use_twin(stores.h, DUP, TWIN))
    assert stores.st.data["light_shapes"] == {TWIN: "spot", "light.other": "spot"}
    placed = stores.mdl.light_positions_m()
    assert placed[TWIN]["x_m"] == 9.0 and DUP not in placed, "its own place stays; the copy's goes"


def _ws(h, eid, twin, monkeypatch, entities):
    monkeypatch.setattr(Z, "twins", lambda hass: {"devices": {}, "entities": entities, "pairs": []})
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=True)
    asyncio.new_event_loop().run_until_complete(Z.ws_zigbee_twin_use(h, conn, {"id": 1, "entity_id": eid, "twin": twin}))
    return conn


def test_the_command_moves_only_a_copy_to_its_own_twin(stores, monkeypatch):
    conn = _ws(stores.h, DUP, "light.somewhere_else", monkeypatch, {DUP: {"twin": TWIN, "device": "h"}})
    assert conn.send_error.call_args.args[1] == "not_a_duplicate" and stores.st.data["light_shapes"].get(DUP) == "bar"
    conn = _ws(stores.h, "light.other", TWIN, monkeypatch, {DUP: {"twin": TWIN, "device": "h"}})
    assert conn.send_error.called and "light.other" in stores.st.data["light_shapes"]
    conn = _ws(stores.h, DUP, TWIN, monkeypatch, {DUP: {"twin": "", "device": "h"}})
    assert conn.send_error.called, "no single twin: nothing to move to"
    conn = _ws(stores.h, DUP, TWIN, monkeypatch, {DUP: {"twin": TWIN, "device": "h"}})
    res = conn.send_result.call_args.args[1]
    assert res["ok"] is True and res["moved"]["placement"] == 1 and res["settings"]["light_shapes"] == {TWIN: "bar", "light.other": "spot"}


def test_the_command_is_registered_and_an_administrators_with_enhanced_security():
    src = (_CC / "websocket.py").read_text(encoding="utf-8")
    assert "from .zigbee_twins import WS_COMMANDS as _twin_commands" in src
    tree = ast.parse((_CC / "zigbee_twins.py").read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef) and n.name == "ws_zigbee_twin_use")
    assert "admin_if_enhanced_security" in {getattr(d, "id", None) for d in fn.decorator_list}


# ── Vacation Mode never drives a duplicate copy ──────────────────────────────

def test_vacation_mode_switches_the_kept_copy_only(monkeypatch):
    import custom_components.padspan_ha.vacation_mode as vm
    states = {"light.porch": SimpleNamespace(state="off", attributes={}),
              "light.porch_2": SimpleNamespace(state="off", attributes={}),
              "light.hall": SimpleNamespace(state="off", attributes={})}
    hass = SimpleNamespace(data={}, states=SimpleNamespace(async_entity_ids=lambda: list(states), get=states.get))
    monkeypatch.setattr(Z, "twins", lambda h: {"devices": {}, "entities": {"light.porch_2": {"twin": "light.porch", "device": "h"}}, "pairs": []})
    assert vm._eligible_entity_ids(hass) == ["light.porch", "light.hall"]
    assert [r[0] for r in vm.eligible_lights(hass)] == ["light.hall", "light.porch"]
