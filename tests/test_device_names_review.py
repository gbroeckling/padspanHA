# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What the device names review found (2026-11-02), held."""

from __future__ import annotations

import struct
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import ble_enrichment as BE
from custom_components.padspan_ha import device_detail as DD
from custom_components.padspan_ha import device_tables as DT
from custom_components.padspan_ha import perf_sampler as PS
from custom_components.padspan_ha import settings_store as SS
from custom_components.padspan_ha import telemetry as TM
from custom_components.padspan_ha import ws_occupancy
from custom_components.padspan_ha.const import DOMAIN
from tests.test_merge_guard import _ad, _hass, build  # noqa: F401 - build is a fixture
from tests.test_occupancy_people import GARMIN, LOGITECH, SCANNERS, _estimate
from tests.test_occupancy_people import _ad as _occ_ad, _hass as _occ_hass

A, B = "4E:00:00:00:00:01", "4E:00:00:00:00:02"


# ── 1. A merged row doesn't flip between two live addresses ───────────────────

@pytest.mark.asyncio
async def test_two_live_addresses_keep_one_leader_whichever_spoke_last(build) -> None:  # noqa: F811
    for age_a, age_b in ((1.0, 3.0), (3.0, 1.0), (40.0, 2.0), (2.0, 40.0)):
        _snap, objs = await build(_hass(), [_ad(A, age=age_a, rssi=-55), _ad(B, age=age_b, rssi=-78)])
        assert list(objs) == [f"ble:{A}"], (age_a, age_b, list(objs))


@pytest.mark.asyncio
async def test_a_dead_address_still_doesnt_lead(build) -> None:  # noqa: F811
    _snap, objs = await build(_hass(), [_ad(A, age=600.0, rssi=-40), _ad(B, age=2.0, rssi=-78)])
    assert list(objs) == [f"ble:{B}"], "the strong old reading isn't on the air"


@pytest.mark.asyncio
async def test_equal_signals_settle_by_key_not_by_who_spoke_last(build) -> None:  # noqa: F811
    for age_a, age_b in ((1.0, 3.0), (3.0, 1.0)):
        _snap, objs = await build(_hass(), [_ad(B, age=age_b, rssi=-60), _ad(A, age=age_a, rssi=-60)])
        assert list(objs) == [f"ble:{A}"]


# ── 2. The share of addresses a radio has spoken for reaches the report ───────

def test_type_known_pc_gets_from_the_build_to_the_report() -> None:
    hass = SimpleNamespace(data={DOMAIN: {"snapshot_cache": (0.0, {"raw_counts": {"type_known_pc": 18.5, "merge_held": 2}})}},
                           config_entries=SimpleNamespace(async_entries=lambda *a: []))
    out = PS.padspan_sizes(hass, {}, estimate=False)
    assert out["type_known_pc"] == 18.5 and out["merge_held"] == 2


# ── 3. A service owner isn't a maker ──────────────────────────────────────────

@pytest.fixture
def tables():
    DT.load_tables()


def test_a_confirmed_public_address_outranks_a_service_owner(tables) -> None:
    # A Feasycom beacon, its service number Dialog Semiconductor's (house).
    o = BE.enrich_object({"manufacturer_data": {"76": "0x02 0x15 0x00"}, "service_uuids": ["fef5"]})
    assert o["company_name"] is None and o["service_owner"] == "Dialog Semiconductor"
    BE.apply_address_maker(o, "F0:18:98:12:34:56", "public")
    assert o["company_name"] == "Apple" and o["maker_source"] == "address"
    assert o["service_owner"] == "Dialog Semiconductor", "kept, in its own field"
    assert DD.describe(o)["how_known"] == "Apple, from its address."


def test_a_cp27_doesnt_read_neurostim(tables) -> None:
    o = BE.enrich_object({"name": "x", "service_uuids": ["fda5"]})
    assert o["company_name"] is None and o["service_owner"] == "Neurostim OAB"
    assert DD.describe(o)["how_known"].startswith("Uses a service from Neurostim OAB.")


def test_location_trackers_format_isnt_apple_s(tables) -> None:
    o = BE.enrich_object({"service_data": {"0000fcb2-0000-1000-8000-00805f9b34fb": "0x01"}})
    assert o["company_name"] is None and o["service_owner"] is None


def test_the_report_counts_an_owner_apart_from_makers() -> None:
    out = TM._object_detail([{"kind": "ble", "address": "A", "name": "A", "service_owner": "Google"},
                             {"kind": "ble", "address": "B", "name": "B", "company_name": "Apple", "maker_source": "company_id"}])
    assert out["maker"] == 1 and out["maker_company_id"] == 1 and out["maker_service_uuid"] == 1


# ── 6. A stored False survives, for the way back ──────────────────────────────

@pytest.mark.parametrize("stored,kept", [(False, True), (True, False)])
@pytest.mark.asyncio
async def test_a_switched_off_lookup_stays_off_after_a_downgrade(stored, kept) -> None:
    store = SS.SettingsStore.__new__(SS.SettingsStore)

    class _Disk:
        async def async_load(self):
            return {"vendor_lookup_enabled": stored}

        async def async_save(self, data):
            pass

    async def _first():
        return False

    async def _job(f, *a):
        return False

    store.store = _Disk()
    store.hass = SimpleNamespace(data={}, config=SimpleNamespace(path=lambda *a: "."), async_add_executor_job=_job)
    store.data = {}
    store._first_run = _first
    await store.async_load()
    assert ("vendor_lookup_enabled" in store.data) is kept


# ── 7. Did the wearable correction move the estimate, not just its addresses ──

def _recorded(monkeypatch):
    got = {}
    monkeypatch.setattr(ws_occupancy, "record_duration", lambda _h, m, v: got.__setitem__(m, v))
    return got


def _wearing(monkeypatch, company, *extra):
    ads = [_occ_ad("4F:49:7F:E7:CD:2B", "s1", -50, company=company), _occ_ad("4F:49:7F:E7:CD:2B", "s2", -60, company=company),
           *extra]
    return _occ_hass(monkeypatch, ads=ads, scanners=SCANNERS)


def test_a_watch_on_a_charger_is_one_person_more(monkeypatch) -> None:
    got = _recorded(monkeypatch)
    assert _estimate(_wearing(monkeypatch, GARMIN))["total_estimate"] == 1
    assert got["occ_wear_gain"] == 1 and got["occ_wear_more"] == 1 and "occ_wear_fewer" not in got


def test_a_mouse_no_longer_counted_is_one_person_fewer(monkeypatch) -> None:
    got = _recorded(monkeypatch)
    assert _estimate(_wearing(monkeypatch, LOGITECH))["total_estimate"] == 0
    assert got["occ_wear_lost"] == 1 and got["occ_wear_fewer"] == 1 and "occ_wear_more" not in got


def test_a_watch_beside_its_owner_s_phone_moves_addresses_but_not_the_estimate(monkeypatch) -> None:
    got = _recorded(monkeypatch)
    phone = [_occ_ad("4A:49:7F:E7:CD:2B", "s1", -52, apple="Nearby Info"), _occ_ad("4A:49:7F:E7:CD:2B", "s2", -61, apple="Nearby Info")]
    assert _estimate(_wearing(monkeypatch, GARMIN, *phone))["total_estimate"] == 1
    assert got["occ_wear_gain"] == 1 and "occ_wear_more" not in got and "occ_wear_fewer" not in got


def test_a_house_it_doesnt_touch_reports_nothing_and_pays_for_nothing(monkeypatch) -> None:
    got = _recorded(monkeypatch)
    calls = []
    real = ws_occupancy._cluster
    monkeypatch.setattr(ws_occupancy, "_cluster", lambda *a: calls.append(1) or real(*a))
    phone = [_occ_ad("4A:49:7F:E7:CD:2B", "s1", -52, apple="Nearby Info"), _occ_ad("4A:49:7F:E7:CD:2B", "s2", -61, apple="Nearby Info")]
    _estimate(_occ_hass(monkeypatch, ads=phone, scanners=SCANNERS))
    assert not {k for k in got if k.startswith("occ_wear")} and len(calls) == 1


# ── 8. `named` isn't PadSpan's own names ──────────────────────────────────────

def test_named_leaves_out_generated_ibeacon_names() -> None:
    out = TM._object_detail([
        {"kind": "ibeacon", "address": "ibeacon:x", "name": "iBeacon 99a58376 (D2:68:50)"},
        {"kind": "ibeacon", "address": "ibeacon:y", "name": "Mine", "user_label": "Mine"},
        {"kind": "ble", "address": "A", "name": "EX90"},
        {"kind": "ble", "address": "B", "name": "B"},
    ])
    assert out["total"] == 4 and out["named"] == 2


# ── 9. A damaged table falls back, once ───────────────────────────────────────

def _with_table(monkeypatch, tmp_path, raw: bytes) -> list:
    was = DT._loaded, DT._companies, DT._members, DT._mac
    (tmp_path / "mac_makers.bin").write_bytes(raw)
    monkeypatch.setattr(DT, "_DATA", tmp_path)
    DT._loaded, DT._companies, DT._members, DT._mac = False, {}, {}, None
    return was


@pytest.mark.parametrize("counts", [(10, 2**31, 0, 0), (10, 2**32 - 1, 2**32 - 1, 2**32 - 1), (2**32 - 1, 1, 0, 0), (10, 1000, 0, 0)])
def test_a_bad_header_count_is_refused_not_allocated(monkeypatch, tmp_path, counts) -> None:
    was = _with_table(monkeypatch, tmp_path, DT._MAC_MAGIC + struct.pack("<IIII", *counts) + b"x" * 40)
    try:
        DT.load_tables()
        assert DT._loaded and DT._mac is None and DT.address_maker("F0:18:98:00:00:00") is None
    finally:
        DT._loaded, DT._companies, DT._members, DT._mac = was


def test_whatever_a_file_raises_there_is_one_try(monkeypatch, tmp_path) -> None:
    was = _with_table(monkeypatch, tmp_path, b"x")
    reads = []

    class _Boom:
        def __init__(self, raw):
            reads.append(1)
            raise OverflowError("cannot fit")

    monkeypatch.setattr(DT, "_MacTable", _Boom)
    try:
        DT.load_tables()
        DT.load_tables()
        assert DT._loaded and len(reads) == 1
    finally:
        DT._loaded, DT._companies, DT._members, DT._mac = was


def test_a_damaged_name_index_answers_nothing_and_doesnt_stop_the_pass(monkeypatch) -> None:
    class _Bad:
        def lookup(self, addr):
            raise IndexError("array index out of range")

    monkeypatch.setattr(DT, "_mac", _Bad())
    assert DT.address_maker("F0:18:98:00:00:00") is None
