# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What the 2026-11-02 review of device detail found. See tests/js/device_detail_fixes.mjs
for the browser's half."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from custom_components.padspan_ha import ble_enrichment as BE
from custom_components.padspan_ha import device_detail as DD
from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha import telemetry as TM
from custom_components.padspan_ha import ws_calibration, ws_objects
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_device_detail import _ad, _hex, _obj, house  # noqa: F401  (house is a fixture)

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components/padspan_ha/www/padspan-ha/views"
_NODE = shutil.which("node")
A, B = "4C:11:22:33:44:55", "D4:44:44:44:44:44"

# The status byte's bits 4-5 are Find My's device type.
FINDMY = {v: _hex(0x12, 0x19, v << 4, *[0x11] * 24) for v in range(4)}
HOMEKIT = _hex(0x06, 0x05, 1, 2, 3, 4, 5)
PAIRING = (0x07, 0x03, 1, 2, 3)


# ── Apple's number, and who made it ─────────────────────────────────────

@pytest.mark.parametrize("payload,maker", [
    (HOMEKIT, None),
    (FINDMY[2], None),
    (_hex(0x12, 0x02, 0x20, 0x00), None),     # near its owner, the short form
    (FINDMY[0], "Apple"),
    (FINDMY[1], "Apple"),
    (FINDMY[3], "Apple"),
    (_hex(0x12, 0x19, 0x20, *[0x11] * 24, *PAIRING), "Apple"),     # value 2 beside AirPods' own record
    (_hex(0x10, 0x05, 1, 2, 3, 4, 5), "Apple"),
    (_hex(0x02, 0x15, *[0] * 21), None),
    (_hex(0x12), "Apple"),     # nothing to read: it stays as it was
])
def test_apple_s_number_is_a_maker_only_where_only_apple_uses_it(payload, maker) -> None:
    o = BE.enrich_object({"manufacturer_data": {"76": payload}})
    assert o["company_name"] == maker
    assert o.get("maker_source") == ("company_id" if maker else None)


@pytest.mark.parametrize("payload", [HOMEKIT, FINDMY[2]])
def test_such_a_device_says_what_it_is_and_no_maker(payload) -> None:
    o = BE.enrich_object(_obj(manufacturer_data={"76": payload}))
    d = DD.describe(o)
    assert d["maker"] is None and d["best_name"] == DD.UNNAMED and d["what_it_is"]
    assert "Apple," not in d["how_known"]


def test_every_shape_of_the_payload_gets_the_same_answer() -> None:
    raw = bytes([0x12, 0x19, 0x20, *[0x11] * 24])
    assert BE.apple_number_only(raw) and BE.apple_number_only(list(raw)) and BE.apple_number_only(raw.hex())
    assert not BE.apple_number_only(None) and not BE.apple_number_only("")


def test_history_loses_the_old_maker_when_it_loads() -> None:
    cache = {"ble:x": {"kind": "ble", "company_name": "Apple", "maker_source": "company_id",
                       "manufacturer_data": {"76": FINDMY[2]}}}
    SB._reenrich_history(cache)
    assert cache["ble:x"]["company_name"] is None and "maker_source" not in cache["ble:x"]


@pytest.mark.parametrize("payload,dtype", [(FINDMY[2], "Find My"), (HOMEKIT, "HomeKit")])
async def test_calibration_s_model_group_stays_what_it_was(payload, dtype) -> None:
    """compute_beacon_profiles groups by company and type. Taking Apple off the screen
    mustn't move a calibrated beacon to another group."""
    o = BE.enrich_object({"kind": "ble", "address": A, "manufacturer_data": {"76": payload}})
    assert o["company_name"] is None and o["device_type"] == dtype
    cal = SimpleNamespace(compute_beacon_profiles=lambda snapshot_objects: {"objs": snapshot_objects})
    out = {}
    conn = SimpleNamespace(send_result=lambda _i, r: out.update(r), send_error=lambda *a: out.update(err=a))
    fn = ws_calibration.ws_calibration_beacon_profiles
    fn = getattr(fn, "__wrapped__", fn)
    with patch.object(ws_calibration, "_get_cal_store", AsyncMock(return_value=cal)), \
            patch.object(ws_calibration, "_live_snapshot", AsyncMock(return_value={"objects": {"list": [o]}})):
        res = fn(SimpleNamespace(data={}), conn, {"id": 1})
        if res is not None:
            await res
    assert out["objs"][0]["company_name"] == "Apple" and o["company_name"] is None, "the live object isn't touched"


# ── Words ───────────────────────────────────────────────────────────────

def test_nearby_info_says_no_more_than_it_knows() -> None:
    d = DD.describe(_obj(manufacturer_data={"76": _hex(0x10, 0x05, 1, 2, 3, 4, 5)}, company_name="Apple"))
    assert d["what_it_is"] == "Apple device" and "phone" not in d["how_known"]


@pytest.mark.parametrize("name,what", [
    ("", "Shelly device"),
    ("ShellyPlus1PM-AABBCCDDEEFF", "Shelly device"),
    ("SBBT-002C", "Shelly BLU Button1"),
    ("SBZZ-001A", "Shelly BLU device"),
    ("Shelly BLU Gateway", "Shelly BLU device"),
])
def test_shelly_blu_only_on_blu_names(name, what) -> None:
    assert DD.what_it_is(_obj(name=name or A, manufacturer_data={"2985": _hex(1, 2)}))[0] == what


# ── Hashes, a record cut short ──────────────────────────────────────────

@pytest.mark.parametrize("block,kept", [
    (bytes([0x05, 0x12, *[0] * 8, 0x01, 0xAA, 0xAA, 0xBB, 0xBB]), 2),     # AirDrop, tail lost
    (bytes([0x0F, 0x11, 0xC0, 0x08, 0xAA, 0xBB, 0xCC]), 4),               # Nearby Action keeps flags and type
    (bytes([0x0D, 0x08, 0xAA, 0xBB]), 2),                                 # Tethering Target
    (bytes([0x10, 0x40, 1, 2, 3, 0x05, 0x12, 0xAA, 0xBB]), 2),            # AirDrop after another's bad length
])
def test_a_record_cut_short_is_zeroed_to_the_end(block, kept) -> None:
    out = DD.scrub_apple_block(block)
    assert len(out) == len(block) and out[:kept] == block[:kept]
    assert not any(out[kept:]), out.hex()


def test_a_record_cut_short_after_a_whole_one_leaves_that_one_alone() -> None:
    whole = bytes([0x10, 0x02, 0x77, 0x88])
    out = DD.scrub_apple_block(whole + bytes([0x05, 0x12, 0xAA, 0xBB]))
    assert out == whole + bytes([0x05, 0x12, 0, 0])


@pytest.mark.parametrize("block", [
    bytes([0x12, 0x19, 0x10, 0x47, 0x42]),     # Find My cut short: a key, and findmy.py reads its status
    bytes([0x10, 0x02, 0x77, 0x88]),
    bytes([0x10, 0x02, 0x77, 0x88, 0x05]),     # a lone type byte holds nothing
    b"",
])
def test_what_holds_no_hash_is_returned_as_it_came(block) -> None:
    assert DD.scrub_apple_block(block) == block


# ── The snapshot's size ─────────────────────────────────────────────────

def test_how_known_stays_off_the_object_and_describe_still_has_it() -> None:
    o = BE.enrich_object(_obj(manufacturer_data={"76": FINDMY[1]}))
    DD.apply_detail(o)
    assert "how_known" not in o and "maker_source" in o
    assert DD.describe(o)["how_known"] == "Apple, from its company number. AirTag, from its Find My broadcast."


def test_name_source_is_left_off_when_it_is_maker() -> None:
    o = _obj(company_name="Apple")
    DD.apply_detail(o)
    assert o["best_name"] == "Apple device" and "name_source" not in o
    o = _obj(company_name="Apple", name="EX90", name_source="stale")
    DD.apply_detail(o)
    assert o["name_source"] == "broadcast"
    o = _obj(company_name="Apple", name_source="broadcast")
    DD.apply_detail(o)
    assert "name_source" not in o, "last build's word doesn't stay"


def test_the_report_counts_a_name_with_no_source_as_a_maker_s() -> None:
    out = TM._object_detail([{"kind": "ble", "address": "A", "name": "A", "best_name": "Apple device"},
                             {"kind": "ble", "address": "B", "name": "B", "best_name": "Tile", "name_source": "broadcast"},
                             {"kind": "ble", "address": "C", "name": "C"}])
    assert out["name_maker"] == 1 and out["name_broadcast"] == 1 and "name_None" not in out


async def test_the_build_leaves_them_off(house) -> None:  # noqa: F811
    await house.poll(0, [
        _ad(A, address_type="public", manufacturer_data={"76": FINDMY[1]}),
        _ad(B, address_type="random"),
    ])
    snap = house.built["snap"]
    objs = {o["address"]: o for o in snap["objects"]["list"]}
    rows = {a["address"]: a for a in snap["ble"]["advertisements"]}
    assert "how_known" not in objs[A] and objs[A]["maker_source"] == "company_id"
    assert "maker_source" not in objs[B]
    assert rows[A]["company_name"] == "Apple" and "maker_source" not in rows[A], "the object says it"
    assert "user_label" not in rows[A]["_xref"], "empty"
    assert '"maker_source": null' not in json.dumps(snap, default=str)


async def test_the_window_asks_for_how_known(house) -> None:  # noqa: F811
    house.hass.data[DOMAIN][DATA_SETTINGS].data["apple_auto_classify"] = True
    out = {}
    conn = SimpleNamespace(send_result=lambda _i, r: out.update(r))
    fn = ws_objects.ws_device_how_known
    fn = getattr(fn, "__wrapped__", fn)
    res = fn(house.hass, conn, {"id": 1, "object": {"kind": "ble", "company_name": "Apple", "maker_source": "company_id",
                                                    "manufacturer_data": {"76": FINDMY[1]}}})
    if res is not None:
        await res
    assert out == {"how_known": "Apple, from its company number. AirTag, from its Find My broadcast."}


# ── The screens, by their source ────────────────────────────────────────

@pytest.mark.parametrize("view,line", [
    ("follow.js", "const name = pickName(o, id);"),
    ("calibration.js", 'const label = pickName(o, stableId) + '),
    ("calibration.js", "opt.textContent = pickName(o, o.key) + "),
    ("presence.js", "const label = o ? pickName(o, d.addr) : (d.name || d.addr);"),
    ("monitor.js", 'const label = pickName(o, "Unknown");'),
    ("locate.js", 'label: pickName(o, "?"), room: o.room,'),
    ("../panel.js", 'DEVICE_NAME.pickName(o, "Unknown")'),
])
def test_where_people_pick_a_device_the_rows_differ(view, line) -> None:
    assert line in (_VIEWS / view).read_text(encoding="utf-8")


@pytest.mark.parametrize("line", [
    "cs.deviceLabel = obj ? (obj.user_label || obj.name || value) : value;",
    "          name: rd.name || source,",
    'label: rd.name || rd.source || "",',
    'source, name: rd.name || source, rssi_samples: rd.samples || [],',
    "const radioName = (snap2?.ble?.radios || []).find(r => r.source === src)?.name || src;",
    "const devName = r.name || r.source;",
    'const _lr = _liveRadios.find(rd => rd.name === (r.label || "")',
])
def test_what_calibration_saves_and_matches_on_keeps_the_raw_name(line) -> None:
    assert line in (_VIEWS / "calibration.js").read_text(encoding="utf-8")


def test_live_tracker_changed_its_search_text_only() -> None:
    src = (_VIEWS / "purelive.js").read_text(encoding="utf-8")
    assert 'search: [label, o.address, ...(o.all_addresses || [])].join(" ")' in src
    assert "filter(r => (r.search || r.label).toLowerCase().includes(q))" in src


def test_monitor_still_hands_out_hide_irks() -> None:
    assert "export { hideIrks };" in (_VIEWS / "monitor.js").read_text(encoding="utf-8")


# ── The browser's half ──────────────────────────────────────────────────

@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_browser_half_in_node() -> None:
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "device_detail_fixes.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout
    assert json.loads(r.stdout.strip().splitlines()[-1])["cases"] >= 25
