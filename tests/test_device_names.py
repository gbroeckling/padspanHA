# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Getting device makers right (the device detail plan's n1-n6, n13, n14).

The official lists behind every maker, what each list may be used for, the
wrong labels on Bluetooth → Advertisements, the tool that regenerates the
tables, and how much the usage report can see of all this. Merging and the
device identifiers have their own file (test_merge_guard.py).
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ble_enrichment as BE
from custom_components.padspan_ha import device_tables as DT
from custom_components.padspan_ha.bluetooth_live import (
    _service_info_to_record,
    _service_info_to_record_from_adv,
    receiver_type,
)

_ROOT = Path(__file__).resolve().parents[1]
_INTEGRATION = next(p for p in (_ROOT / "custom_components").iterdir() if p.is_dir() and (p / "manifest.json").is_file())
_NODE = shutil.which("node")


# ── n1: the official company list ───────────────────────────────────────────

@pytest.mark.parametrize("cid,name", [
    (0x004C, "Apple"), (0x0006, "Microsoft"), (0x00E0, "Google"), (0x0075, "Samsung Electronics"),
    (0x0059, "Nordic Semiconductor"), (0x004D, "Staccato Communications"), (0x00CC, "Beats Electronics"),
    (0x00C4, "LG Electronics"), (0x01DA, "Logitech International"), (0x0087, "Garmin International"),
    (0x006B, "Polar Electro"), (0x02B2, "Oura Health"), (0x03FF, "Withings"), (0x0100, "TomTom International"),
    (0x067C, "Tile"), (0x0BA9, "Allterco Robotics"), (0x0499, "Ruuvi Innovations"),
])
def test_a_company_number_reads_as_bluetooth_sig_lists_it(cid, name) -> None:
    assert BE.lookup_company(cid) == name


def test_the_whole_list_is_there() -> None:
    assert DT.table_sizes()["companies"] >= 4000
    assert DT.company(0xFFFF) is None


def test_samsung_is_samsung_not_beats() -> None:
    assert BE.enrich_object({"manufacturer_data": {"117": "0x01 0x02"}})["company_name"] == "Samsung Electronics"


# ── n2: who holds a service UUID ────────────────────────────────────────────

@pytest.mark.parametrize("uuid,owner", [
    ("fef3", "Google"), ("FCF1", "Google"), ("0xfd5a", "Samsung Electronics"), ("fcb2", "Apple"),
    ("feb9", "LG Electronics"), ("0000fef3-0000-1000-8000-00805f9b34fb", "Google"),
])
def test_a_service_uuid_names_its_owner(uuid, owner) -> None:
    assert BE.lookup_service_owner(uuid) == owner
    assert DT.table_sizes()["members"] >= 700


@pytest.mark.parametrize("field,value", [
    ("service_uuids", ["0000fef3-0000-1000-8000-00805f9b34fb"]),
    ("service_data", {"0000fef3-0000-1000-8000-00805f9b34fb": "0x01"}),
    ("service_data", {"fcf1": "0x01"}),
])
def test_an_object_with_only_a_service_gets_an_owner_not_a_maker(field, value) -> None:
    o = BE.enrich_object({field: value})
    assert o["company_name"] is None and o["maker_source"] is None and o["service_owner"] == "Google"
    assert o["service_names"] == [], "the same word again as a service says nothing"
    assert "Google" in o["service_uuid_map"].values()


def test_the_company_number_beats_the_service_owner() -> None:
    o = BE.enrich_object({"manufacturer_data": {"76": "0x10 0x05"}, "service_uuids": ["fef3"]})
    assert o["company_name"] == "Apple" and o["maker_source"] == "company_id"


@pytest.mark.parametrize("uuid", [
    "abcd1800-1111-2222-3333-444455556666",   # read as Generic Access
    "1234fe2c-1111-2222-3333-444455556666",   # read as Google Fast Pair
    "0000fef3-1111-2222-3333-444455556666",   # the right start, not on the Bluetooth base
    "abcd1800-0000-1000-8000-00805f9b34fb",   # a 32-bit UUID on the base
    "3e1d50cd-7e3e-427d-8e1c-b78aa87fe624",   # the house's disputed one: no owner
])
def test_a_128_bit_uuid_off_the_bluetooth_base_matches_nothing(uuid) -> None:
    assert BE.lookup_service_uuid(uuid) is None and BE.lookup_service_owner(uuid) is None
    assert BE.enrich_object({"service_uuids": [uuid], "service_data": {uuid: "0x01"}})["company_name"] is None


@pytest.mark.parametrize("uuid,service", [
    ("feaa", "Eddystone"), ("fe2c", "Google Fast Pair"), ("fcd2", "BTHome"), ("fd6f", "Exposure Notification"),
    ("fcb2", "Apple"),
])
def test_an_open_format_says_what_it_is_not_who_made_it(uuid, service) -> None:
    """Anyone's hardware sends these. A Feasycom beacon with Eddystone isn't Google."""
    o = BE.enrich_object({"service_uuids": [uuid], "service_data": {uuid: "0x00"}})
    assert o.get("service_owner") is None and o["company_name"] is None and o["service_names"] == [service]
    assert BE.enrich_object({"espresense_id": f"sd:{uuid}"}).get("service_owner") is None


def test_an_open_format_doesnt_hide_a_real_owner_beside_it() -> None:
    assert BE.enrich_object({"service_uuids": ["feaa", "fef3"]})["service_owner"] == "Google"
    assert BE.enrich_object({"service_uuids": ["feaa", "fd5a"]})["service_owner"] == "Samsung Electronics"


def test_a_16_bit_uuid_on_the_base_still_matches() -> None:
    assert BE.lookup_service_uuid("0000180f-0000-1000-8000-00805f9b34fb") == "Battery"


# ── n4: the built-in address list ───────────────────────────────────────────

def test_the_list_has_all_three_block_sizes_and_the_longest_match_wins() -> None:
    assert DT.table_sizes()["mac_blocks"] >= 50000
    assert DT.address_maker("F0:18:98:12:34:56") == "Apple"       # MA-L, 24 bits
    table = (DT._mac._blocks[28], DT._mac._blocks[36])
    assert len(table[0][0]) > 5000 and len(table[1][0]) > 5000


@pytest.mark.parametrize("bits", [28, 36])
def test_a_smaller_block_answers_inside_its_parent(bits) -> None:
    prefixes, ids = DT._mac._blocks[bits]
    addr48 = prefixes[len(prefixes) // 2] << (48 - bits)
    digits = f"{addr48:012X}"
    mac = ":".join(digits[i:i + 2] for i in range(0, 12, 2))
    assert DT.address_maker(mac) == DT._mac._name(ids[len(prefixes) // 2])
    assert DT.address_maker(mac) != "IEEE Registration Authority"


def test_no_row_reads_as_a_non_maker() -> None:
    names = DT._mac._names.decode("utf-8").split("\n")
    assert len(names) > 10000 and len(set(names)) == len(names)
    lower = {n.lower() for n in names}
    assert "ieee registration authority" not in lower and "private" not in lower and "" not in lower


@pytest.mark.parametrize("address", ["", None, "ibeacon:abc", "AA:BB", "ZZ:ZZ:ZZ:ZZ:ZZ:ZZ"])
def test_something_that_isnt_an_address_has_no_maker(address) -> None:
    assert DT.address_maker(address) is None


@pytest.fixture
def maker(monkeypatch):
    """Every address in a known block, so only the rule decides."""
    monkeypatch.setattr(DT, "address_maker", lambda address: "Maker")


def test_a_confirmed_public_address_gets_a_maker(maker) -> None:
    o = {"company_name": None}
    BE.apply_address_maker(o, "F0:18:98:12:34:56", "public")
    assert o["company_name"] == "Maker" and o["maker_source"] == "address" and "maker_guess" not in o


@pytest.mark.parametrize("first", ["40", "7C", "C0", "C4", "F0", "00", "DA", "4E", "01", "33"])
def test_a_confirmed_random_address_never_gets_one_whatever_its_bits(maker, first) -> None:
    o = {"company_name": None}
    BE.apply_address_maker(o, f"{first}:11:22:33:44:55", "random")
    assert o == {"company_name": None}


@pytest.mark.parametrize("first", ["40", "7C", "C0", "C4", "F0", "00"])
def test_an_unconfirmed_address_only_gets_a_probably(maker, first) -> None:
    o = {"company_name": None}
    BE.apply_address_maker(o, f"{first}:11:22:33:44:55", None)
    assert o["company_name"] is None and o["maker_guess"] == "Maker"


@pytest.mark.parametrize("first", ["DA", "4E", "01", "33"])
def test_bits_ieee_doesnt_assign_rule_out_an_unconfirmed_address(maker, first) -> None:
    o = {"company_name": None}
    BE.apply_address_maker(o, f"{first}:11:22:33:44:55", None)
    assert o == {"company_name": None}


def test_a_radio_saying_public_outweighs_the_bits(maker) -> None:
    """The bits only said no faster while something was sent. A radio saw this one."""
    o = {"company_name": None}
    BE.apply_address_maker(o, "DA:11:22:33:44:55", "public")
    assert o["company_name"] == "Maker"


def test_what_the_broadcast_said_comes_first(maker) -> None:
    o = {"company_name": "Apple", "maker_source": "company_id"}
    BE.apply_address_maker(o, "F0:18:98:12:34:56", "public")
    assert o == {"company_name": "Apple", "maker_source": "company_id"}


def test_an_advert_row_doesnt_keep_an_old_probably(maker) -> None:
    """Advert rows are bluetooth_live's own records, enriched again each build."""
    row = {"address": "F0:18:98:12:34:56"}
    BE.enrich_object(row)
    BE.apply_address_maker(row, row["address"], None)
    assert row["maker_guess"] == "Maker"
    BE.enrich_object(row)
    BE.apply_address_maker(row, row["address"], "random")
    assert "maker_guess" not in row and row["company_name"] is None


# ── n4: the online lookup is gone ───────────────────────────────────────────

def test_the_lookup_module_and_its_command_are_gone() -> None:
    assert not (_INTEGRATION / "vendor_lookup.py").exists()
    for rel in ("websocket.py", "www/padspan-ha/panel.js" if (_INTEGRATION / "www/padspan-ha").exists() else "websocket.py"):
        src = (_INTEGRATION / rel).read_text(encoding="utf-8")
        assert "vendor_lookup" not in src and "vendorLookup" not in src


def test_nothing_in_the_integration_names_the_services_any_more() -> None:
    hits = []
    for p in _INTEGRATION.rglob("*"):
        if not p.is_file() or p.suffix not in (".py", ".js", ".md", ".yaml"):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        if "macvendors" in text.lower() or "maclookup" in text.lower():
            hits.append(p.name)
    assert hits == []


def test_the_public_wording_says_nothing_is_sent() -> None:
    if not (_ROOT / "site").is_dir():
        pytest.skip("the Bright tree has its own README and no site")
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    assert "macvendors" not in readme and "maclookup" not in readme
    assert "Nothing is sent anywhere for this" in readme
    # The site's changelog keeps its history; what it claims today doesn't name them.
    lede = next(ln for ln in (_ROOT / "site" / "index.html").read_text(encoding="utf-8").splitlines() if "What leaves your house" in ln)
    assert "macvendors" not in lede and "so nothing is sent for those" in lede
    assert "macvendors" not in (_ROOT / "site" / "creators" / "index.html").read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_the_setting_is_dropped_from_an_older_file() -> None:
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS, RETIRED_SETTINGS, SettingsStore

    assert "vendor_lookup_enabled" in RETIRED_SETTINGS and "vendor_lookup_enabled" not in DEFAULT_SETTINGS
    store = SettingsStore.__new__(SettingsStore)

    class _Disk:
        saved = None

        async def async_load(self):
            return {"vendor_lookup_enabled": False, "room_change_delay_s": 12.0}

        async def async_save(self, data):
            type(self).saved = dict(data)

    store.store = _Disk()
    store.hass = SimpleNamespace(data={}, config=SimpleNamespace(path=lambda *a: "."),
                                 async_add_executor_job=lambda f, *a: _done(False))
    store.data = {}

    async def _first():
        return False

    store._first_run = _first
    await store.async_load()
    assert store.data["vendor_lookup_enabled"] is False and store.data["room_change_delay_s"] == 12.0
    assert _Disk.saved["vendor_lookup_enabled"] is False, "an older version read back with no key turns the lookup on"


def _done(value):
    fut = asyncio.get_event_loop().create_future()
    fut.set_result(value)
    return fut


def test_the_report_no_longer_lists_the_switch() -> None:
    from custom_components.padspan_ha import telemetry as T

    assert "vendor_lookup_enabled" not in repr({k: getattr(T, k) for k in dir(T) if k.isupper()})


# ── n5: ESPresense's id and what can't be confirmed ─────────────────────────

@pytest.mark.parametrize("device_id,maker", [
    ("apple:1005:9-26", "Apple"), ("apple:findmy", "Apple"), ("msft:cdp:0901", "Microsoft"),
    ("tile:aabbccddeeff", "Tile"), ("md:0075:12", "Samsung Electronics"), ("md:0059:8-12", "Nordic Semiconductor"),
    # No maker in these. A service number says whose service, see below.
    ("sd:fef3", None), ("sd:fd5a12", None),
    ("iBeacon:e2c56db5-1-2", None), ("name:living-room-tv", None), ("ad:180f", None), ("aabbccddeeff", None),
    ("md:zzzz:1", None), ("sd:", None), ("sd:fef3abcd-0000-1000-8000-00805f9b34fb", None), ("", None), (None, None),
])
def test_espresenses_id_says_who_made_it(device_id, maker) -> None:
    o = BE.enrich_object({"espresense_id": device_id, "manufacturer_data": {}, "service_uuids": [], "service_data": {}})
    assert o["company_name"] == maker
    assert o["maker_source"] == ("espresense" if maker else None)


@pytest.mark.parametrize("device_id,owner", [("sd:fef3", "Google"), ("sd:fd5a12", "Samsung Electronics"), ("sd:", None),
                                             ("sd:fef3abcd-0000-1000-8000-00805f9b34fb", None), ("md:0075:12", None)])
def test_espresenses_id_says_whose_service(device_id, owner) -> None:
    assert BE.enrich_object({"espresense_id": device_id}).get("service_owner") == owner


def test_espresense_rows_carry_the_id_through_to_a_maker(maker) -> None:
    """What the MQTT feed sends looks like this: no broadcast fields at all."""
    row = {"address": "APPLE:1005:9-26", "espresense_id": "apple:1005:9-26",
           "manufacturer_data": {}, "service_data": {}, "service_uuids": []}
    BE.enrich_object(row)
    BE.apply_address_maker(row, row["address"], None)
    assert row["company_name"] == "Apple" and "maker_guess" not in row


def test_a_tasmota_row_gets_a_probably(maker) -> None:
    """Address, name and signal: all Tasmota sends (tasmota_ble.py)."""
    row = {"address": "A4:C1:38:00:00:01", "name": "", "manufacturer_data": {}, "service_data": {}, "service_uuids": []}
    BE.enrich_object(row)
    BE.apply_address_maker(row, row["address"], None)
    assert row["company_name"] is None and row["maker_guess"] == "Maker"


# ── n6: the wrong labels ────────────────────────────────────────────────────

def test_tx_power_minus_127_means_none_on_both_paths() -> None:
    dev = SimpleNamespace(details={}, name=None)
    si = SimpleNamespace(address="AA:BB:CC:DD:EE:FF", name=None, source="s", rssi=-60, time=0, device=dev,
                         manufacturer_data={}, service_data={}, service_uuids=[], tx_power=-127, connectable=True)
    assert _service_info_to_record(si)["tx_power"] is None
    si.tx_power = -12
    assert _service_info_to_record(si)["tx_power"] == -12
    si.tx_power = None
    si.advertisement = SimpleNamespace(tx_power=-127)
    assert _service_info_to_record(si)["tx_power"] is None
    import datetime as dt
    adv = SimpleNamespace(local_name=None, manufacturer_data={}, service_data={}, service_uuids=[], tx_power=-127)
    now = dt.datetime.now(dt.timezone.utc)
    assert _service_info_to_record_from_adv("AA:BB:CC:DD:EE:FF", "s", -60, dev, adv, now)["tx_power"] is None
    adv.tx_power = -4
    assert _service_info_to_record_from_adv("AA:BB:CC:DD:EE:FF", "s", -60, dev, adv, now)["tx_power"] == -4


@pytest.mark.parametrize("payload", [
    "0x02 0x15 0xE2 0xC5 0x6D 0xB5", b"\x02\x15\xe2\xc5", [0x02, 0x15, 0xE2],
])
def test_an_ibeacon_isnt_apple(payload) -> None:
    for key in ("76", 76):
        o = BE.enrich_object({"manufacturer_data": {key: payload}})
        assert o["company_name"] is None and o["device_type"] == "iBeacon"


def test_an_ibeacon_still_gets_a_maker_from_elsewhere() -> None:
    o = BE.enrich_object({"manufacturer_data": {"76": "0x02 0x15 0x00", "117": "0x01"}})
    assert o["company_name"] == "Samsung Electronics"
    o = BE.enrich_object({"manufacturer_data": {"76": "0x02 0x15 0x00"}, "service_data": {"fef3": "0x01"}})
    assert o["company_name"] is None and o["service_owner"] == "Google"


def test_other_apple_broadcasts_are_still_apple() -> None:
    assert BE.enrich_object({"manufacturer_data": {"76": "0x10 0x05 0x01"}})["company_name"] == "Apple"
    assert BE.enrich_object({"manufacturer_data": {"76": "0x02 0x14 0x01"}})["company_name"] == "Apple"


# Run in node: tests/js/bt_labels.mjs reads the row and the details of each.
@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_advertisements_screen_in_node() -> None:
    r = _run_js("bt_labels.mjs")
    assert r["cases"] >= 12


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_objects_lists_maker_column_in_node() -> None:
    r = _run_js("maker_column.mjs")
    assert r["cases"] >= 12


def _run_js(name: str) -> dict:
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / name), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [json.loads(ln) for ln in r.stdout.splitlines() if ln.startswith("{")]
    summary = next((ln for ln in lines if ln.get("summary")), None)
    assert summary is not None, f"no result from {name}:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}"
    failed = [ln["case"] for ln in lines if ln.get("ok") is False]
    assert r.returncode == 0 and not failed, f"{failed}\n{r.stderr[-3000:]}"
    return summary


# ── n13: the tables and the tool ────────────────────────────────────────────

def test_the_tables_are_numbers_and_names_only() -> None:
    data = _INTEGRATION / "data"
    assert sorted(p.name for p in data.iterdir()) == ["bt_companies.tsv", "bt_members.tsv", "mac_makers.bin"]
    for fname, key in (("bt_companies.tsv", r"[0-9A-F]{4}"), ("bt_members.tsv", r"[0-9a-f]{4}")):
        for line in (data / fname).read_text(encoding="utf-8").splitlines():
            assert re.fullmatch(key + r"\t[^\t]{1,30}", line), line
    blob = b"".join((data / f).read_bytes() for f in ("bt_companies.tsv", "bt_members.tsv", "mac_makers.bin")).lower()
    for word in (b"this document", b"as is", b"license agreement", b"bluetooth sig, inc", b"organization address"):
        assert word not in blob, word


def test_the_tables_are_listed_as_third_party_data() -> None:
    notices = _ROOT / "THIRD_PARTY_NOTICES.md"
    if not notices.is_file():
        pytest.skip("the Bright tree carries no notices file")
    text = notices.read_text(encoding="utf-8")
    assert "Bluetooth SIG" in text and "IEEE" in text and "tools/build_device_tables.py" in text
    for fname in ("bt_companies.tsv", "bt_members.tsv", "mac_makers.bin"):
        assert fname in text


def test_the_release_doesnt_depend_on_the_tool_or_the_lists() -> None:
    release = _ROOT / "scripts" / "release.py"
    if not release.is_file():
        pytest.skip("the Bright tree has no release script")
    src = release.read_text(encoding="utf-8")
    assert "build_device_tables" not in src and "standards-oui" not in src and "bluetooth-SIG" not in src
    src_int = (_INTEGRATION / "device_tables.py").read_text(encoding="utf-8")
    assert "aiohttp" not in src_int and "urllib" not in src_int and "async_get_clientsession" not in src_int


def test_the_tables_load_off_the_loop_once() -> None:
    calls = []

    async def _job(func, *args):
        calls.append(func)
        func(*args)

    hass = SimpleNamespace(async_add_executor_job=_job)
    was = DT._loaded, DT._companies, DT._members, DT._mac
    try:
        DT._loaded, DT._companies, DT._members, DT._mac = False, {}, {}, None
        assert DT.company(76) is None and DT.service_owner("fef3") is None and DT.address_maker("F0:18:98:00:00:00") is None
        assert BE.enrich_object({"manufacturer_data": {"76": "0x10"}})["company_name"] is None, "no answer until loaded"
        asyncio.run(DT.async_load_tables(hass))
        assert calls == [DT.load_tables] and DT.company(76) == "Apple"
        asyncio.run(DT.async_load_tables(hass))
        assert calls == [DT.load_tables], "only once"
    finally:
        DT._loaded, DT._companies, DT._members, DT._mac = was


def test_a_table_that_cant_be_read_answers_nothing_and_doesnt_stop_anything(monkeypatch, tmp_path) -> None:
    was = DT._loaded, DT._companies, DT._members, DT._mac
    try:
        monkeypatch.setattr(DT, "_DATA", tmp_path)
        DT._loaded, DT._companies, DT._members, DT._mac = False, {}, {}, None
        DT.load_tables()
        assert DT._loaded and DT.company(76) is None and DT.address_maker("F0:18:98:00:00:00") is None
        (tmp_path / "mac_makers.bin").write_bytes(b"not a table")
        DT._loaded = False
        DT.load_tables()
        assert DT._mac is None
    finally:
        DT._loaded, DT._companies, DT._members, DT._mac = was


@pytest.fixture
def tool():
    path = _ROOT / "tools" / "build_device_tables.py"
    if not path.is_file():
        pytest.skip("the Bright tree has no tools folder")
    sys.path.insert(0, str(path.parent))
    try:
        import build_device_tables as tool_module  # noqa: PLC0415
        yield tool_module
    finally:
        sys.path.remove(str(path.parent))


@pytest.mark.parametrize("name,short", [
    ("Apple, Inc.", "Apple"), ("Samsung Electronics Co. Ltd.", "Samsung Electronics"), ("Microsoft", "Microsoft"),
    ("Google LLC", "Google"), ("Woan Technology (Shenzhen) Co., Ltd.", "Woan Technology"),
    ("Samsung Electronics Co.,Ltd", "Samsung Electronics"), ("Rohde & Schwarz GmbH & Co. KG", "Rohde & Schwarz"),
    ("Polar Electro OY", "Polar Electro"), ("3M", "3M"), ("AS", "AS"), ("Procter & Gamble", "Procter & Gamble"),
    ("A Very Long Company Name That Keeps On Going Technology", "A Very Long Company Name"),
])
def test_a_name_loses_its_legal_form(tool, name, short) -> None:
    assert tool.short_name(name) == short


def test_a_short_or_wrong_list_stops_the_tool(tool) -> None:
    with pytest.raises(SystemExit, match="only 1 entries"):
        tool.company_table("company_identifiers:\n  - value: 0x004C\n    name: 'Apple, Inc.'\n")
    wrong = "".join(f"  - value: 0x{i:04X}\n    name: 'Company {i}'\n" for i in range(tool.MIN_COMPANIES))
    with pytest.raises(SystemExit, match="0x004C"):
        tool.company_table(wrong)
    with pytest.raises(SystemExit, match="blocks"):
        tool.mac_table({"oui.csv": "Registry,Assignment,Organization Name,Organization Address\n", "mam.csv": "", "oui36.csv": ""})


def test_the_tool_builds_what_device_tables_reads(tool, monkeypatch, tmp_path) -> None:
    """A rebuild comes out the same, drops postal addresses and non-makers, and
    reads back through device_tables."""
    monkeypatch.setattr(tool, "MIN_BLOCKS", 1)
    head = "Registry,Assignment,Organization Name,Organization Address\n"
    csvs = {
        "oui.csv": (head + 'MA-L,F01898,"Apple, Inc.",1 Infinite Loop Cupertino CA US 95014\n'
                    'MA-L,AABBCC,IEEE Registration Authority,445 Hoes Lane\nMA-L,AABBCD,Private,\n'
                    'MA-L,001122,ACME CORP,Somewhere\nMA-L,001123,"Acme Corp, Inc.",Elsewhere\n'),
        "mam.csv": head + 'MA-M,AABBCC1,"Small Maker Ltd.",2 Road\n',
        "oui36.csv": head + 'MA-S,AABBCC123,"Tiny Maker GmbH",3 Street\n',
    }
    built = tool.mac_table(csvs)
    assert built == tool.mac_table(csvs), "the same every time"
    assert b"Infinite Loop" not in built and b"Road" not in built and b"Registration" not in built
    table = DT._MacTable(built)
    addr = lambda s: int(s.replace(":", ""), 16)  # noqa: E731
    assert table.lookup(addr("F0:18:98:12:34:56")) == "Apple"
    assert table.lookup(addr("AA:BB:CC:12:34:56")) == "Tiny Maker"
    assert table.lookup(addr("AA:BB:CC:1F:FF:FF")) == "Small Maker"
    assert table.lookup(addr("AA:BB:CC:20:00:00")) is None, "the parent's row isn't a maker"
    assert table.lookup(addr("AA:BB:CD:00:00:00")) is None, "nor is Private"
    assert table.lookup(addr("00:11:22:00:00:00")) == table.lookup(addr("00:11:23:00:00:00")) == "Acme"
    assert table.lookup(addr("00:00:00:00:00:00")) is None and table.lookup(addr("FF:FF:FF:FF:FF:FF")) is None
    assert len(table) == 5


def test_the_committed_tables_load_in_a_fresh_process() -> None:
    """No Home Assistant, no network: just the files, as a release ships them."""
    code = ("import importlib.util, sys;"
            f"s = importlib.util.spec_from_file_location('dt', {str(_INTEGRATION / 'device_tables.py')!r});"
            "m = importlib.util.module_from_spec(s); sys.modules['dt'] = m; s.loader.exec_module(m);"
            "m.load_tables(); print(m.table_sizes()['mac_blocks'], m.company(76), m.service_owner('fef3'))")
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    n, company, owner = r.stdout.split()
    assert int(n) >= 50000 and company == "Apple" and owner == "Google"


# ── n14: what the usage report can see ──────────────────────────────────────

@pytest.mark.parametrize("cls,kind", [
    ("ESPHomeScanner", "esphome"), ("ShellyBLEScanner", "shelly"), ("HaScanner", "ha_adapter"),
    ("HaScannerMgmt", "ha_adapter"), ("RuuviGatewayScanner", "ruuvi"), ("SomethingNew", "other"),
])
def test_a_receiver_type_comes_from_its_scanner_class(cls, kind) -> None:
    assert receiver_type(type(cls, (), {})()) == kind


def test_the_report_counts_objects_never_naming_them() -> None:
    from custom_components.padspan_ha.telemetry import _object_detail

    objs = [
        {"kind": "ble", "address": "AA:BB:CC:DD:EE:01", "name": "AA:BB:CC:DD:EE:01"},
        {"kind": "ble", "address": "AA:BB:CC:DD:EE:02", "name": "EX90", "company_name": "Volvo", "maker_source": "company_id"},
        {"kind": "ble", "address": "AA:BB:CC:DD:EE:03", "name": "AA:BB:CC:DD:EE:03", "maker_guess": "Espressif"},
        {"kind": "ibeacon", "address": "ibeacon:x", "name": "ibeacon:x", "user_label": "Keys", "company_name": "Google",
         "maker_source": "service_uuid", "device_type": "iBeacon"},
        {"kind": "ble", "address": "AA:BB:CC:DD:EE:05", "name": "AA:BB:CC:DD:EE:05", "company_name": "Apple",
         "maker_source": "address", "auto_class": "AirTag"},
        {"kind": "entity", "name": "Car", "company_name": "Nope", "maker_source": "company_id"},
        "not a dict",
    ]
    out = _object_detail(objs)
    assert out == {"total": 5, "named": 2, "maker": 4, "type": 2, "maker_company_id": 1, "maker_guess": 1,
                   "maker_service_uuid": 1, "maker_address": 1}
    text = json.dumps(out)
    for word in ("EX90", "Volvo", "Espressif", "Keys", "Google", "Apple", "AA:BB"):
        assert word not in text


def test_the_new_fields_need_no_server_deploy() -> None:
    """Nested in env and health, which telemetry.php already allows. One level
    deep, so stats.php adds them up by itself."""
    php = _ROOT / "server" / "telemetry.php"
    if not php.is_file():
        pytest.skip("the Bright tree has no server folder")
    src = php.read_text(encoding="utf-8")
    assert "'env'" in src and "'health'" in src
    from custom_components.padspan_ha.telemetry import _object_detail

    out = _object_detail([{"kind": "ble", "address": "A", "name": "A", "company_name": "X", "maker_source": "company_id"}])
    assert all(isinstance(v, int) for v in out.values())


def test_the_install_base_page_gives_the_plain_names() -> None:
    src = (_INTEGRATION / "www" / "padspan-ha" / "views" / "installbase.js")
    if not src.is_file():
        pytest.skip("renamed in the Bright tree")
    text = src.read_text(encoding="utf-8")
    for word in ("ESPHome proxy", "Home Assistant's own adapter", "Shelly", "What the receivers are",
                 "How much devices say about themselves", '"scanner_types"', '"object_detail"', '"device_ids"'):
        assert word in text, word
