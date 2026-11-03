# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One name, maker and type for each device, what it is, and the limits on reading it.

Byte strings marked "house" are as heard at Garry's house on 2026-11-02, with key
bytes cut. See tests/js/device_lists.mjs for how the lists gather them.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import bluetooth_live as BL
from custom_components.padspan_ha import device_detail as DD
from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha import telemetry as TM
from custom_components.padspan_ha.const import DATA_OBJECT_HISTORY, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.ws_common import RadioDeviceIndex, radio_display
from tests.test_findmy_snapshot import _make_house

_ROOT = Path(__file__).resolve().parents[1]
_NODE = shutil.which("node")
ADDR = "4C:11:22:33:44:55"


def _hex(*body):
    return " ".join(f"0x{b:02X}" for b in body)


def _obj(**over):
    return {"key": f"ble:{ADDR}", "kind": "ble", "address": ADDR, "name": ADDR, **over}


def _name(**over):
    d = DD.describe(_obj(**over))
    return d["best_name"], d["name_source"]


# ── n7: the ladder ────────────────────────────────────────────────────────────

FULL = dict(user_label="My tag", private_ble_name="Alice's iPhone", device={"name": "HA thing", "manufacturer": "Acme"},
            name="CP27", company_name="Samsung", maker_source="company_id")


@pytest.mark.parametrize("drop,want", [
    ((), ("My tag", "label")),
    (("user_label",), ("Alice's iPhone", "device")),
    (("user_label", "private_ble_name"), ("HA thing", "device")),
    (("user_label", "private_ble_name", "device"), ("CP27", "broadcast")),
])
def test_a_stronger_source_replaces_a_weaker(drop, want):
    assert _name(**{k: v for k, v in FULL.items() if k not in drop}) == want


def test_then_the_maker_then_unnamed_and_never_the_address():
    assert _name(company_name="Samsung", maker_source="company_id") == ("Samsung device", "maker")
    assert _name(maker_guess="Espressif") == ("Probably Espressif device", "maker")
    assert _name() == ("Unnamed device", "none")


def test_a_service_owner_is_never_called_the_maker():
    d = DD.describe(_obj(service_owner="Neurostim OAB"))
    assert (d["best_name"], d["name_source"]) == ("Uses a service from Neurostim OAB", "service")
    assert d["maker"] is None and d["service_owner"] == "Neurostim OAB"
    assert d["how_known"].startswith("Uses a service from Neurostim OAB. Other makers' devices")
    # A real maker comes first, and a "probably" comes after the owner.
    assert _name(service_owner="X", company_name="Feasycom", maker_source="address") == ("Feasycom device", "maker")
    assert _name(service_owner="X", maker_guess="Y") == ("Uses a service from X", "service")


@pytest.mark.parametrize("raw,want", [
    ("\x00", ("Unnamed device", "none")),                   # one house object's name
    (" \x00 ", ("Unnamed device", "none")),
    ("CP27-D1DB (9D:D1:DB)", ("CP27-D1DB", "broadcast")),   # PadSpan's own tail
    ("Proxy (AA:BB:CC:DD:EE:FF)", ("Proxy", "broadcast")),  # Home Assistant's
    ("aa:bb:cc:dd:ee:ff", ("Unnamed device", "none")),      # an address, not a name
    ("iBeacon e2c56db5", ("iBeacon e2c56db5", "beacon")),
    ("iBeacon 99a58376 (D2:68:50)", ("iBeacon 99a58376", "beacon")),
])
def test_what_isnt_a_real_name(raw, want):
    assert _name(name=raw) == want


def test_a_generated_name_saved_as_a_label_doesnt_beat_a_real_one():
    # house: user_label literally "iBeacon e2c56db5", as saved by an old version.
    assert _name(user_label="iBeacon e2c56db5", name="iBeacon e2c56db5") == ("iBeacon e2c56db5", "beacon")
    assert _name(user_label="iBeacon e2c56db5", name="CP27-BC88") == ("CP27-BC88", "broadcast")


def test_espresense_s_own_id_isnt_a_broadcast_name():
    i = "apple:1005:9-26"
    assert _name(name=i, espresense_id=i)[1] == "none"


def test_an_ibeacon_s_name_field_holding_the_label_isnt_a_broadcast_name():
    assert DD.broadcast_name(_obj(kind="ibeacon", name="Bronco", user_label="Bronco")) == ""


def test_padspan_s_own_ha_device_doesnt_read_back():
    own = {"device_id": "x", "name": "MaschineBOX", "manufacturer": "PadSpan HA", "model": "BLE Presence Tracker"}
    assert _name(device=own, name="CP27-BC88") == ("CP27-BC88", "broadcast")
    o = _obj(device=own)
    DD.apply_detail(o)
    assert o["device"] is None
    other = {"device_id": "y", "name": "Test Beacon Feasycom", "manufacturer": ""}
    o = _obj(device=other)
    DD.apply_detail(o)
    assert o["device"] == other and o["best_name"] == "Test Beacon Feasycom"


def test_apply_detail_only_adds_fields():
    """`name` stays: the same-name merge reads it. So does everything calibration reads."""
    before = _obj(name="EX90", rssi=-60, sources=[{"source": "s", "rssi": -60, "age_s": 1}], padspan_id="ps_1",
                  manufacturer_data={"76": _hex(0x10, 0x05, 1, 2, 3, 4, 5)}, company_name="Apple",
                  maker_source="company_id", device_type="Nearby Info", room="Hall", x_m=1.0, y_m=2.0)
    after = json.loads(json.dumps(before))
    DD.apply_detail(after)
    assert {k: after[k] for k in before} == before
    assert set(after) - set(before) <= {"best_name", "name_source", "what_it_is", "how_known", "address_kind"}


# ── n8: what it is ────────────────────────────────────────────────────────────

APPLE = {
    # house, Find My status byte in the third place
    "airtag_separated": (_hex(0x12, 0x19, 0x10, *[0x11] * 25), "AirTag"),
    "airtag_near": (_hex(0x12, 0x02, 0x14, 0x03), "AirTag"),
    "accessory": (_hex(0x12, 0x02, 0x24, 0x01), "Find My accessory"),
    "apple_device": (_hex(0x12, 0x02, 0x00, 0x01), "Apple device"),
    "airpods_case": (_hex(0x12, 0x02, 0x2E, 0x02, 0x07, 0x11, 0x06, 0x39, *[0x22] * 15), "AirPods or Beats"),
    "airpods_open": (_hex(0x07, 0x19, 0x01, 0x14, 0x20, *[0x33] * 22), "AirPods or Beats"),
    "bits_3": (_hex(0x12, 0x02, 0x34, 0x01), "AirPods or Beats"),
    "nearby_info": (_hex(0x10, 0x05, 0x03, 0x18, 1, 2, 3), "Apple phone or tablet"),
    "handoff_then_nearby": (_hex(0x0C, 0x0E, 0x00, *[0x44] * 13, 0x10, 0x06, 0x45, 0x1D, 1, 2, 3, 4), "Apple phone or tablet"),
    "homekit": (_hex(0x06, 0x03, 1, 2, 3), "Apple Home accessory"),
    "ibeacon": (_hex(0x02, 0x15, *[0x55] * 21), "iBeacon"),
    "airplay": (_hex(0x09, 0x06, 1, 2, 3, 4, 5, 6, 0x16, 0x01, 0x02), None),
}


@pytest.mark.parametrize("case", APPLE)
def test_apple(case):
    payload, want = APPLE[case]
    assert DD.what_it_is(_obj(manufacturer_data={"76": payload}))[0] == want


def test_find_my_bits_stay_quiet_with_the_setting_off():
    p = {"76": APPLE["airtag_separated"][0]}
    assert DD.what_it_is(_obj(manufacturer_data=p), False)[0] == "Find My device"
    assert DD.what_it_is(_obj(manufacturer_data={"76": APPLE["airpods_open"][0]}), False)[0] == "AirPods or Beats"


@pytest.mark.parametrize("kind,want", [
    (1, "Xbox"), (6, "iPhone"), (7, "iPad"), (8, "Android device"), (9, "Windows PC"), (11, "Windows phone"),
    (12, "Linux computer"), (13, "Windows IoT device"), (14, "Surface Hub"), (15, "Windows laptop"), (16, "Windows tablet"),
])
def test_microsoft_cdp(kind, want):
    # MS-CDP: scenario 1, then version in the high 3 bits and type in the low 5.
    assert DD.what_it_is(_obj(manufacturer_data={"6": _hex(0x01, 0x20 | kind, 0x20, 0x00)}))[0] == want


def test_microsoft_house_bytes_and_other_scenarios():
    assert DD.what_it_is(_obj(manufacturer_data={"6": _hex(0x01, 0x09, 0x20)}))[0] == "Windows PC"  # house, 170 objects
    assert DD.what_it_is(_obj(manufacturer_data={"6": _hex(0x03, 0x00, 0x80)}))[0] is None          # Swift Pair
    assert DD.what_it_is(_obj(manufacturer_data={"6": _hex(0x01, 0x1F)}))[0] is None                # unknown type


SVC = "0000{}-0000-1000-8000-00805f9b34fb"


@pytest.mark.parametrize("data,uuids,want", [
    ({SVC.format("fe2c"): _hex(0xAA, 0xBB, 0xCC)}, [], "Fast Pair accessory"),
    ({SVC.format("feaa"): _hex(0x40, 1, 2)}, [], "Find Hub tag"),
    ({SVC.format("feaa"): _hex(0x41, 1, 2)}, [], "Find Hub tag"),
    ({SVC.format("feaa"): _hex(0x00, 1, 2)}, [], "Eddystone beacon"),
    ({SVC.format("feaa"): _hex(0x10, 1, 2)}, [], "Eddystone beacon"),
    ({SVC.format("feaa"): _hex(0x20, 1, 2)}, [], "Eddystone beacon"),
    ({SVC.format("feaa"): _hex(0x30, 1, 2)}, [], "Eddystone beacon"),
    ({SVC.format("feaa"): _hex(0x77, 1, 2)}, [], None),
    ({}, [SVC.format("feaa")], "Eddystone beacon"),
    ({SVC.format("fd5a"): _hex(0x14, 1, 2)}, [], "Samsung SmartTag"),
    ({SVC.format("fd5a"): _hex(0x40, 1, 2)}, [], None),
    ({SVC.format("feed"): _hex(0x02, 0x00, 1)}, [], "Tile"),
    ({}, [SVC.format("feed")], "Tile"),
    ({SVC.format("fe95"): _hex(0x30, 0x58, 0x5B, 0x05, 1)}, [], "Xiaomi Temperature/Humidity Sensor LYWSD03MMC"),
    ({SVC.format("fe95"): _hex(0x30, 0x58, 0xFB, 0x50, 1)}, [], "Linptech Human Presence Sensor ES3"),
    ({SVC.format("fe95"): _hex(0x30, 0x58, 0xFE, 0xFF, 1)}, [], "MiBeacon device"),
])
def test_services(data, uuids, want):
    assert DD.what_it_is(_obj(service_data=data, service_uuids=uuids))[0] == want


@pytest.mark.parametrize("over,want", [
    ({"name": "SBBT-002C"}, "Shelly BLU Button1"),
    ({"name": "SBDW-002C"}, "Shelly BLU Door/Window"),
    ({"manufacturer_data": {"2985": _hex(1, 2)}}, "Shelly BLU device"),
    ({"manufacturer_data": {"1177": _hex(5, 2)}}, "RuuviTag"),
    ({"manufacturer_data": {"1660": _hex(5, 2)}}, "Tile"),
    ({"name": "GVH5075_1A2B"}, "Govee H5075"),
    ({"name": "Govee_H5074_1A2B"}, "Govee H5074"),
    ({"name": "GV5121_ABCD"}, "Govee 5121"),
    ({"name": "Govern"}, None),
    ({"espresense_id": "tile:aabbccddeeff"}, "Tile"),
    ({"espresense_id": "smarttag:x"}, "Samsung SmartTag"),
    ({"espresense_id": "apple:findmy"}, "Find My device"),
    ({"espresense_id": "msft:cdp:0920"}, "Windows PC"),
    ({"espresense_id": "md:1234:5"}, None),
    ({"kind": "ibeacon", "manufacturer_data": {"17496": _hex(0x02, 0x15, 1)}}, "iBeacon"),
])
def test_the_rest(over, want):
    assert DD.what_it_is(_obj(**over))[0] == want


def test_a_cut_short_or_odd_payload_says_nothing_and_raises_nothing():
    for bad in ("", "0x12", "0x12 0x19", "0x07 0xFF 0x01", "zz", "0x10 0x05 0x01"):
        DD.describe(_obj(manufacturer_data={"76": bad, "6": bad}, service_data={SVC.format("fe95"): bad}))
    DD.describe(_obj(manufacturer_data={"76": b"\x12\x02\x10", 6: [1, 9]}))


def test_how_known_reads_as_the_plan_says():
    how = DD.describe(_obj(manufacturer_data={"76": APPLE["airtag_separated"][0]}, company_name="Apple", maker_source="company_id"))["how_known"]
    assert how == "Apple, from its company number. AirTag, from its Find My broadcast."
    assert DD.describe(_obj())["how_known"] == "Nothing in its broadcast says who made it or what it is."
    assert DD.describe(_obj(company_name="Espressif", maker_source="address"))["how_known"] == "Espressif, from its address."


# ── n12: the limits ───────────────────────────────────────────────────────────

def test_only_the_kind_is_read_never_what_someone_is_doing():
    """Change every state byte: locked, on a call, driving, earbuds in, lid open.
    What it says stays the same, and nothing else comes out of describe()."""
    fields = set()
    for state in range(256):
        nearby = DD.describe(_obj(manufacturer_data={"76": _hex(0x10, 0x05, state, state, 1, 2, 3)}))
        pairing = DD.describe(_obj(manufacturer_data={"76": _hex(0x07, 0x19, 0x01, 0x14, 0x20, *[state] * 22)}))
        assert nearby["what_it_is"] == "Apple phone or tablet" and pairing["what_it_is"] == "AirPods or Beats"
        fields |= set(nearby) | set(pairing)
    assert fields == {"best_name", "name_source", "maker", "service_owner", "what_it_is", "how_known", "address_kind"}


NEARBY_ACTION = bytes([0x0F, 0x11, 0xC0, 0x08, 1, 2, 3, 0xAA, 0xAA, 0xAA, 0xBB, 0xBB, 0xBB, 0xCC, 0xCC, 0xCC, 0xDD, 0xDD, 0xDD])
AIRDROP = bytes([0x05, 0x12, *[0] * 8, 0x01, 0xAA, 0xAA, 0xBB, 0xBB, 0xCC, 0xCC, 0xDD, 0xDD, 0x00])
TETHER = bytes([0x0D, 0x04, 0xAA, 0xBB, 0xCC, 0xDD])


@pytest.mark.parametrize("block", [NEARBY_ACTION, AIRDROP, TETHER])
def test_hashes_of_a_person_s_identifiers_are_not_kept(block):
    out = DD.scrub_apple_block(block + bytes([0x10, 0x02, 0x77, 0x88]))
    assert len(out) == len(block) + 4 and out[:2] == block[:2]
    assert not {0xAA, 0xBB, 0xCC, 0xDD} & set(out), "the hash bytes are gone"
    assert out[-4:] == bytes([0x10, 0x02, 0x77, 0x88]), "the next record is left alone"


def test_nearby_action_keeps_its_type_for_the_merge_and_nothing_stored_changes_shape():
    out = DD.scrub_apple_block(NEARBY_ACTION)
    assert out[:4] == NEARBY_ACTION[:4], "D5 groups by type and length"
    for keep in (APPLE["airtag_separated"][0], APPLE["nearby_info"][0]):
        assert DD.scrub_apple_hex(keep) == keep


def test_scrubbing_happens_where_adverts_arrive_and_for_apple_only():
    assert BL._manuf_hex(76, TETHER) == _hex(0x0D, 0x04, 0, 0, 0, 0)
    assert BL._manuf_hex(117, TETHER) == _hex(*TETHER)


def test_history_kept_by_an_older_version_is_scrubbed():
    cache = {"ble:X": {"kind": "ble", "address": "X", "manufacturer_data": {"76": _hex(*TETHER), "117": _hex(*TETHER)}}}
    SB._reenrich_history(cache)
    assert cache["ble:X"]["manufacturer_data"] == {"76": _hex(0x0D, 0x04, 0, 0, 0, 0), "117": _hex(*TETHER)}


def test_nothing_connects_to_a_device():
    src = (_ROOT / "custom_components" / "padspan_ha" / "device_detail.py").read_text(encoding="utf-8")
    assert not re.search(r"\b(establish_connection|BleakClient|BleakGATT|\.connect\()", src)


def test_reports_get_counts_and_no_detail():
    objs = [{"kind": "ble", "address": "AA", "name": "AA", "best_name": "Secret phone", "name_source": "broadcast",
             "what_it_is": "AirTag", "address_kind": "rotating", "how_known": "x"},
            {"kind": "ble", "address": "BB", "name": "BB", "best_name": "Apple device", "name_source": "maker", "address_kind": "fixed"}]
    out = TM._object_detail(objs)
    assert out["name_broadcast"] == 1 and out["name_maker"] == 1 and out["what"] == 1
    assert out["addr_rotating"] == 1 and out["addr_fixed"] == 1
    assert all(isinstance(v, int) for v in out.values()), "counts, never a name"


# ── n9: Fixed or Rotating ─────────────────────────────────────────────────────

@pytest.mark.parametrize("first,said,rotates,want", [
    ("F0", "public", False, "fixed"),
    ("4C", "public", False, "fixed"),   # looks rotating; the radio says otherwise
    ("4C", "random", False, "rotating"),
    ("1C", "random", False, "rotating"),
    ("C4", "random", False, "fixed"),   # static
    ("C4", "random", True, "rotating"),  # Find My's key: static-looking, rotates
    ("84", "random", False, None),       # reserved
    ("C4", None, False, None),           # no radio has said: no guess from the bits
])
def test_address_kind(first, said, rotates, want):
    o = _obj(address=f"{first}:11:22:33:44:55")
    if said:
        o["address_type"] = said
    assert DD.address_kind(o, rotates) == want


def test_address_kind_for_the_other_kinds():
    assert DD.address_kind({"kind": "private_ble"}) == "rotating"
    split = {"kind": "ibeacon", "address": "ibeacon:x", "all_addresses": ["48:87:2D:9D:D1:DB"], "address_type": "public"}
    assert DD.address_kind(split) == "fixed"
    many = {"kind": "ibeacon", "address": "ibeacon:x", "all_addresses": ["A", "B"], "address_type": "random"}
    assert DD.address_kind(many) is None


def test_a_find_my_broadcast_counts_as_rotating():
    o = _obj(address="D2:C9:36:D3:E6:1F", address_type="random", manufacturer_data={"76": APPLE["airtag_separated"][0]})
    assert DD.describe(o)["address_kind"] == "rotating"


# ── n11: receiver names ───────────────────────────────────────────────────────

def _dev(name=None, by_user=None, **over):
    return SimpleNamespace(name=name, name_by_user=by_user, **over)


def test_a_receiver_has_one_name_with_no_address_tail():
    scanner = _dev("BLE-white3dprintedBOX (1C:DB:D4:74:D7:1E)")
    assert radio_display({"source": "x"}, scanner) == ("BLE-white3dprintedBOX", "ha")


def test_a_name_set_on_the_esphome_device_wins():
    scanner = _dev("TTGO BLE-Phonetracker (24:62:AB:F9:97:EE)")
    assert radio_display({"source": "x"}, scanner, _dev("Tracker TTGO BLE-Busyness")) == ("Tracker TTGO BLE-Busyness", "ha")
    assert radio_display({"source": "x"}, scanner, _dev("Tracker", "Shed")) == ("Shed", "ha_user")
    assert radio_display({"source": "x"}, _dev("S (24:62:AB:F9:97:EE)", "On scanner"), _dev("Tracker")) == ("On scanner", "ha_user")


def test_only_a_scanner_device_takes_its_via_device_s_name():
    idx = RadioDeviceIndex.__new__(RadioDeviceIndex)
    hub = _dev("Hub")
    idx._by_id = {"h": hub}
    assert idx.parent_of(_dev("S", via_device_id="h", connections={("bluetooth", "AA")})) is hub
    assert idx.parent_of(_dev("Node", via_device_id="h", connections={("mac", "AA")})) is None


def test_overview_floor_labels_use_it():
    src = (_ROOT / "custom_components/padspan_ha/www/padspan-ha/views/overview.js").read_text(encoding="utf-8")
    assert "(r.name || r.source" not in src, "floor labels read the raw scanner name"
    assert "radio.name || radio.source" not in src.replace("radio.display_name || radio.name || radio.source", "")


# ── Through the real builder ──────────────────────────────────────────────────

TAG, PC, BEACON = "D4:44:44:44:44:44", "4C:66:66:66:66:66", "48:87:2D:9D:D1:DB"


def _ad(addr, **over):
    return {"address": addr, "source": "kit", "rssi": -55.0, "age_s": 1.0, "name": addr, "manufacturer_data": {},
            "service_data": {}, "service_uuids": [], "connectable": False, **over}


@pytest.fixture
def house(monkeypatch):
    h = _make_house(monkeypatch, labels={}, followed=[])
    built = {}
    real = SB._build_live_snapshot

    async def _keep(hass):
        built["snap"] = await real(hass)
        return built["snap"]

    monkeypatch.setattr(SB, "_build_live_snapshot", _keep)
    h.settings = h.hass.data[DOMAIN][DATA_SETTINGS].data
    h.settings["apple_auto_classify"] = True
    h.built = built
    return h


async def test_the_build_gives_every_object_and_row_the_fields_and_history_none(house):
    objs, _x = await house.poll(0, [
        _ad(TAG, address_type="random", manufacturer_data={"76": APPLE["airtag_separated"][0]}),
        _ad(PC, address_type="random", manufacturer_data={"6": _hex(0x01, 0x09, 0x20)}),
        _ad(BEACON, name="EX90", address_type="public"),
    ])
    tag, pc, named = objs["ble:" + TAG], objs["ble:" + PC], objs["ble:" + BEACON]
    assert tag["what_it_is"] == "AirTag" and tag["address_kind"] == "rotating" and tag["name"] == TAG
    assert pc["what_it_is"] == "Windows PC" and pc["best_name"] == "Microsoft device" and pc["name"] == PC
    assert named["best_name"] == "EX90" and named["name_source"] == "broadcast" and named["address_kind"] == "fixed"
    # A row with an object reads the object's: 3,000 rows every 5 s shouldn't each carry it.
    rows = {a["address"]: a for a in house.built["snap"]["ble"]["advertisements"]}
    assert rows[PC]["_xref"]["key"] == "ble:" + PC and "best_name" not in rows[PC] and "how_known" not in rows[PC]
    cached = house.hass.data[DOMAIN][DATA_OBJECT_HISTORY]["ble:" + PC]
    assert not {"best_name", "what_it_is", "how_known", "address_kind"} & set(cached), "worked out fresh each build"


async def test_a_name_heard_once_stays_while_name_goes_back(house):
    await house.poll(0, [_ad(BEACON, name="EX90")])
    objs, _x = await house.poll(30, [_ad(BEACON)])
    o = objs["ble:" + BEACON]
    assert o["best_name"] == "EX90" and o["name_source"] == "broadcast", "never back down to a weaker name"
    assert o["name"] == BEACON, "the same-name merge still reads what it read"


# ── Calibration and identity stay as they are ─────────────────────────────────

def test_calibration_and_positioning_read_none_of_it():
    base = _ROOT / "custom_components" / "padspan_ha"
    for f in ("calibration_store.py", "ws_calibration.py", "presence_coordinator.py", "presence_rules.py",
              "device_registry.py", "merge_guard.py"):
        src = (base / f).read_text(encoding="utf-8")
        assert not re.search(r"best_name|what_it_is|how_known|address_kind|name_source|broadcast_name", src), f


@pytest.mark.parametrize("line", [
    'cs.deviceLabel = obj ? (obj.user_label || obj.name || value) : value;',
    'const bkLabel = obj.user_label || obj.name || obj.key;',
    'label: obj.user_label || obj.name || selKey,',
    'bs.pendingPlace = { key: obj.key, label: obj.user_label || obj.name || "", kind: obj.kind || "ble" };',
    'const bkLabel = obj?.user_label || obj?.name || bk.label || bk.key;',
    'const bkLabel = bkObj.user_label || bkObj.name || bkKey;',
])
def test_what_calibration_saves_as_a_label_is_unchanged(line):
    src = (_ROOT / "custom_components/padspan_ha/www/padspan-ha/views/calibration.js").read_text(encoding="utf-8")
    assert line in src, "only what it shows moved; a saved label would change the store's bytes"


# ── The lists and helpers, in node ────────────────────────────────────────────

@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_device_lists_in_node() -> None:
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "device_lists.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout
    assert json.loads(r.stdout.strip().splitlines()[-1])["cases"] >= 25
