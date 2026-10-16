# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Issue #91 and the low-memory switch: what PadSpan holds and works on
next to a busy street.

The report (HA Green, four proxies): ~4,982 objects held, 4,969 of them
unidentified, 214 heard in the last 10 s — and every one went through the
full per-object pipeline every poll, Core CPU 3.6% -> 13.9%. Alongside: an
ID cache that thrashed past ~1,000 devices and gave each stranger a new ID
every build, which Lost & Found read as a new departure and kept forever.
"""

from __future__ import annotations

import datetime as dt
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import low_memory
from custom_components.padspan_ha.bluetooth_live import BluetoothLive, _Adv
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.device_registry import _EPHEMERAL_MAX, DeviceRegistry
from custom_components.padspan_ha.findmy import _payload_bytes, parse_findmy
from custom_components.padspan_ha.lost_and_found_store import LostAndFoundStore
from custom_components.padspan_ha.presence_coordinator import (
    _BACKGROUND_AGE_S,
    is_background_object,
)
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from custom_components.padspan_ha.snapshot_builder import (
    _prune_lost_and_found_strangers,
    cap_object_history,
)
from tests.test_poll_level import ble_object, make_coordinator, run_poll, snapshot

OLD = _BACKGROUND_AGE_S + 240.0


def _mac(i: int) -> str:
    return "AA:BB:CC:{:02X}:{:02X}:{:02X}".format((i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF)


class _Settings:
    """Both ways the code reads settings: .data and .get()."""
    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data

    def get(self, key, default=None):
        return self.data.get(key, default)


def _hass(settings: dict[str, Any] | None = None) -> MagicMock:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: _Settings(dict(settings or {}))}}
    return hass


def _registry() -> DeviceRegistry:
    """The registry without its Store (which will not take a mock hass)."""
    reg = DeviceRegistry.__new__(DeviceRegistry)
    reg.hass = MagicMock()
    reg._store = MagicMock()
    reg._devices, reg._index = {}, {}
    from collections import OrderedDict
    reg._ephemeral = OrderedDict()
    reg._dirty = False
    return reg


# ── which objects the pipeline skips ──────────────────────────────────────────

class TestIsBackground:
    def test_an_unidentified_device_not_heard_for_a_minute_is_background(self):
        assert is_background_object(ble_object("ble:A", _mac(1), age_s=OLD), {}, set())

    def test_a_device_on_the_air_is_not(self):
        assert not is_background_object(ble_object("ble:A", _mac(1), age_s=2.0), {}, set())

    def test_someones_object_never_is(self):
        for extra in ({"user_label": "Keys"}, {"identified": True}):
            assert not is_background_object(ble_object("ble:A", _mac(1), age_s=OLD, **extra), {}, set())
        irk = {"key": "irk:1", "kind": "private_ble", "age_s": OLD}
        assert not is_background_object(irk, {}, set())

    def test_pinned_and_followed_never_are(self):
        obj = ble_object("ble:" + _mac(1), _mac(1), age_s=OLD)
        assert not is_background_object(obj, {"ble:" + _mac(1): {}}, set())
        assert not is_background_object(obj, {}, {_mac(1)})
        assert not is_background_object(obj, {}, {("ble:" + _mac(1)).upper()})

    def test_only_radio_objects_with_an_age(self):
        assert not is_background_object({"key": "entity:x", "kind": "entity", "age_s": OLD}, {}, set())
        assert not is_background_object(ble_object("ble:A", _mac(1)), {}, set())
        ib = {"key": "ibeacon:u:1:2", "kind": "ibeacon", "age_s": OLD}
        assert is_background_object(ib, {}, set())


class TestThePollSkipsBackgroundObjects:
    """Poll-level (tests/test_poll_level.py): the caller is what matters."""

    def test_listed_as_is_but_not_smoothed(self):
        coord = make_coordinator()
        old, fresh, mine = "ble:" + _mac(1), "ble:" + _mac(2), "ble:" + _mac(3)
        out = run_poll(coord, snapshot([
            ble_object(old, _mac(1), age_s=OLD),
            ble_object(fresh, _mac(2), age_s=1.0),
            ble_object(mine, _mac(3), age_s=OLD, user_label="Keys"),
        ]))
        assert {old, fresh, mine} <= set(out)
        assert not out[old].get("_smoothed")
        assert out[fresh].get("_smoothed") and out[mine].get("_smoothed")
        assert old not in coord._known_objs and fresh in coord._known_objs
        assert coord.last_object_counts == {"smoothed": 2, "background": 1}

    def test_going_background_lets_its_state_go(self):
        coord = make_coordinator()
        key = "ble:" + _mac(1)
        run_poll(coord, snapshot([ble_object(key, _mac(1), age_s=1.0)]))
        assert key in coord._known_objs and key in coord._last_seen
        run_poll(coord, snapshot([ble_object(key, _mac(1), age_s=OLD)]))
        assert key not in coord._known_objs
        assert key not in coord._last_seen and key not in coord._room_votes

    def test_heard_again_it_is_smoothed_again(self):
        coord = make_coordinator()
        key = "ble:" + _mac(1)
        run_poll(coord, snapshot([ble_object(key, _mac(1), age_s=OLD)]))
        out = run_poll(coord, snapshot([ble_object(key, _mac(1), age_s=0.5)]))
        assert out[key].get("_smoothed") and key in coord._known_objs

    def test_a_followed_one_is_still_smoothed(self):
        coord = make_coordinator({"followed_addrs": [_mac(1).lower()]})
        key = "ble:" + _mac(1)
        out = run_poll(coord, snapshot([ble_object(key, _mac(1), age_s=OLD)]))
        assert out[key].get("_smoothed")

    def test_a_street_costs_only_what_is_on_the_air(self):
        coord = make_coordinator()
        objs = [ble_object("ble:" + _mac(i), _mac(i), age_s=(1.0 if i < 20 else OLD)) for i in range(2000)]
        out = run_poll(coord, snapshot(objs))
        assert len([k for k in out if k.startswith("ble:")]) == 2000
        assert coord.last_object_counts == {"smoothed": 20, "background": 1980}
        assert len(coord._known_objs) == 20


# ── device IDs and Lost & Found ───────────────────────────────────────────────

class TestEphemeralIdsAreStable:
    def test_an_evicted_device_comes_back_with_the_same_id(self):
        reg = _registry()
        first = reg.resolve_or_create("ble:" + _mac(0))
        for i in range(1, _EPHEMERAL_MAX + 10):      # push it out of the cache
            reg.resolve_or_create("ble:" + _mac(i))
        assert reg.resolve("ble:" + _mac(0)) is None
        assert reg.resolve_or_create("ble:" + _mac(0)) == first

    def test_ids_keep_their_shape_and_differ_by_device(self):
        reg = _registry()
        a, b = reg.resolve_or_create(_mac(1)), reg.resolve_or_create(_mac(2))
        assert a != b
        for pid in (a, b):
            assert pid.startswith("ps_") and len(pid) == 15
            int(pid[3:], 16)

    def test_a_key_and_its_ble_form_are_one_device(self):
        assert _registry().resolve_or_create("ble:" + _mac(1)) == \
            _registry().resolve_or_create(_mac(1))


def _lf() -> LostAndFoundStore:
    store = LostAndFoundStore.__new__(LostAndFoundStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_delay_save = MagicMock()
    store.records = {}
    return store


class TestLostAndFoundKeepsOnlySomeonesObjects:
    @pytest.mark.asyncio
    async def test_a_stranger_is_not_recorded(self):
        lf = _lf()
        await lf.record("ble:" + _mac(1), "Garage", identified=False)
        assert lf.records == {}
        lf.store.async_delay_save.assert_not_called()

    @pytest.mark.asyncio
    async def test_someones_object_still_is(self):
        lf = _lf()
        await lf.record("ble:" + _mac(1), "Garage", label="Keys", identified=True)
        assert lf.records["ble:" + _mac(1)]["room"] == "Garage"

    def test_the_strangers_older_versions_kept_are_cleared_once(self):
        lf = _lf()
        keys = {n: "ble:" + _mac(n) for n in range(1, 7)}
        lf.records = {k: {"room": "Hall", "ts": 1.0, "padspan_id": f"ps_{n:012x}"} for n, k in keys.items()}
        lf.records["ibeacon:u:1:2"] = {"room": "Hall", "ts": 1.0}
        lf.records["irk:abc"] = {"room": "Hall", "ts": 1.0}
        obj_store = MagicMock()
        obj_store.get_label.side_effect = lambda mac: "Keys" if mac == _mac(1) else None
        dev_reg = MagicMock()
        dev_reg.get_label_by_key.side_effect = lambda k: "Bag" if k == keys[2] else None
        dev_reg.get.side_effect = lambda pid: {"label": None} if pid == f"ps_{3:012x}" else None
        dev_reg.resolve.return_value = None
        hass = _hass({"followed_addrs": [_mac(4)]})
        hass.data[DOMAIN]["object_store"] = obj_store
        from custom_components.padspan_ha.const import DATA_DEVICE_REGISTRY, DATA_OBJECTS
        hass.data[DOMAIN][DATA_OBJECTS] = obj_store
        hass.data[DOMAIN][DATA_DEVICE_REGISTRY] = dev_reg
        live = [ble_object(keys[5], _mac(5), identified=True)]
        _prune_lost_and_found_strangers(hass, lf, live)
        # 1 labelled, 2 registry label, 3 registered, 4 followed, 5 identified
        # in the list now; 6 nobody's. Non-MAC keys are never touched.
        assert set(lf.records) == {keys[n] for n in range(1, 6)} | {"ibeacon:u:1:2", "irk:abc"}
        _prune_lost_and_found_strangers(hass, lf, [])       # once per start
        lf.records[keys[6]] = {"room": "Hall", "ts": 1.0}
        _prune_lost_and_found_strangers(hass, lf, [])
        assert keys[6] in lf.records

    def test_waits_for_the_label_stores(self):
        lf = _lf()
        lf.records = {"ble:" + _mac(1): {"room": "Hall", "ts": 1.0}}
        _prune_lost_and_found_strangers(_hass(), lf, [])
        assert lf.records


# ── the caches' limits ────────────────────────────────────────────────────────

class TestObjectHistoryCap:
    def _cache(self, n: int, **extra: Any) -> dict[str, dict[str, Any]]:
        return {f"k{i}": {"_last_seen_ts": float(i), **extra} for i in range(n)}

    def test_under_the_cap_nothing_goes(self):
        c = self._cache(100)
        assert cap_object_history(c, 100, set()) == 0 and len(c) == 100

    def test_over_it_the_longest_unheard_go_to_ninety_percent(self):
        c = self._cache(150)
        assert cap_object_history(c, 100, set()) == 60
        assert len(c) == 90 and "k0" not in c and "k149" in c

    def test_someones_objects_and_this_builds_never_go(self):
        c = self._cache(150)
        c["k0"]["user_label"] = "Keys"
        c["k1"]["identified"] = True
        cap_object_history(c, 100, {"k2"})
        assert {"k0", "k1", "k2"} <= set(c)

    def test_identified_objects_do_not_count_toward_it(self):
        c = self._cache(150, identified=True)
        assert cap_object_history(c, 100, set()) == 0 and len(c) == 150


class TestBluetoothCacheCap:
    def test_over_the_cap_the_longest_unheard_go(self):
        bl = BluetoothLive(MagicMock())
        now = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
        for i in range(50):
            seen = now - dt.timedelta(seconds=50 - i)
            bl._seen_by_source[_mac(i)] = {"p1": _Adv(record={}, seen=seen)}
            bl._rssi_samples[_mac(i)] = {}
        bl.cache_max_addrs = 20
        bl._cap_addresses(now)
        assert len(bl._seen_by_source) == 18
        assert _mac(0) not in bl._seen_by_source and _mac(49) in bl._seen_by_source
        assert set(bl._rssi_samples) == set(bl._seen_by_source)

    def test_no_cap_by_default(self):
        bl = BluetoothLive(MagicMock())
        now = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
        for i in range(50):
            bl._seen_by_source[_mac(i)] = {"p1": _Adv(record={}, seen=now)}
        bl._cap_addresses(now)
        assert bl.cache_max_addrs == 0 and len(bl._seen_by_source) == 50


class TestLowMemoryMode:
    def test_off_by_default(self):
        assert DEFAULT_SETTINGS["low_memory_mode"] is False
        assert not low_memory.enabled(_hass())

    def test_the_timeout_default_is_what_the_backend_has_always_used(self):
        assert low_memory.ble_age_s(_hass()) == 14400
        assert low_memory.ble_age_s(_hass({"ble_max_age_s": 600})) == 600
        assert low_memory.ble_age_s(_hass({"ble_max_age_s": 5})) == 60
        assert low_memory.ble_age_s(_hass({"ble_max_age_s": 99999})) == 14400

    def test_on_it_caps_everything(self):
        on = _hass({"low_memory_mode": True})
        assert low_memory.ble_age_s(on) == low_memory.LOW_MEM_BLE_AGE_S
        assert low_memory.ble_age_s(_hass({"low_memory_mode": True, "ble_max_age_s": 120})) == 120
        assert low_memory.ble_max_addrs(on) == low_memory.LOW_MEM_BLE_ADDRS
        assert low_memory.snapshot_ads(on) == low_memory.LOW_MEM_SNAPSHOT_ADS
        assert low_memory.history_max(on) == low_memory.LOW_MEM_HISTORY_MAX
        off = _hass()
        assert low_memory.ble_max_addrs(off) == 0
        assert low_memory.history_max(off) == low_memory.HISTORY_MAX

    def test_it_holds_the_history_to_a_day(self):
        from custom_components.padspan_ha.websocket import _object_history_ttl_s
        assert _object_history_ttl_s(_hass({"object_history_days": 14})) == 14 * 86400
        assert _object_history_ttl_s(_hass({"object_history_days": 14, "low_memory_mode": True})) == 86400

    def test_together_it_stays_under_what_2gb_was_measured_to_fit(self):
        # docs/MINIMUM_REQUIREMENTS.md: ~5,000 devices or fewer on 2 GB.
        assert low_memory.LOW_MEM_BLE_ADDRS + low_memory.LOW_MEM_HISTORY_MAX <= 5000


# ── Find My parsing ───────────────────────────────────────────────────────────

class TestPayloadCache:
    @pytest.mark.parametrize("value", ["0x12 0x19 0x10", "121910", "0x12,0x19,0x10", " 121910 "])
    def test_every_string_shape_reads_the_same(self, value):
        assert _payload_bytes(value) == b"\x12\x19\x10"

    def test_bad_hex_is_still_none(self):
        assert _payload_bytes("zz") is None
        assert _payload_bytes("0xzz") is None

    def test_parse_hands_out_its_own_dict(self):
        md = {"76": "0x12 0x19 0x10"}
        a, b = parse_findmy(md), parse_findmy(md)
        assert a == b and a is not b
        a["status"] = 0
        assert parse_findmy(md)["status"] == 0x10


# ── Diag Export ───────────────────────────────────────────────────────────────

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_diag_export_cuts_the_long_lists_but_keeps_every_own_object(tmp_path: Path):
    (tmp_path / "monitor.mjs").write_text((_VIEWS / "monitor.js").read_text(encoding="utf-8"), encoding="utf-8")
    objs = [{"key": f"k{i}", "kind": "ble"} for i in range(5000)]
    objs[4000]["user_label"] = "Keys"
    objs[4500]["identified"] = True
    snap = {"objects": {"list": objs, "summary": {"total": 5000}},
            "ble": {"advertisements": [{"address": f"a{i}"} for i in range(5000)], "radios": [1]},
            "other": 1}
    (tmp_path / "snap.json").write_text(json.dumps(snap), encoding="utf-8")
    (tmp_path / "run.mjs").write_text(
        "import { diagSnapshot } from './monitor.mjs';\n"
        "import { readFileSync } from 'node:fs';\n"
        "const s = JSON.parse(readFileSync(new URL('./snap.json', import.meta.url)));\n"
        "const d = diagSnapshot(s);\n"
        "console.log(JSON.stringify({n: d.objects.list.length, t: d.objects.trimmed,"
        " mine: d.objects.list.filter(o => o.user_label || o.identified).length,"
        " ads: d.ble.advertisements.length, at: d.ble.trimmed, radios: d.ble.radios.length,"
        " other: d.other, orig: s.objects.list.length, small: diagSnapshot({objects: {list: [1]}}).objects.list.length}));\n",
        encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    out = json.loads(res.stdout.strip().splitlines()[-1])
    assert out == {"n": 200, "t": {"total": 5000, "kept": 200}, "mine": 2, "ads": 200,
                   "at": {"total": 5000, "kept": 200}, "radios": 1, "other": 1,
                   "orig": 5000, "small": 1}


# ── Bermuda troubleshooting (opt-in report) ───────────────────────────────────

class TestSnapshotBuildDiagnostics:
    """A third of the installs reporting take 1.4-18 s per snapshot build, all
    with Bermuda. The report says which phase, how many HA states and how
    much of it is Bermuda's."""

    def test_the_counts_reach_the_report(self):
        from custom_components.padspan_ha import perf_sampler as ps
        hass = MagicMock()
        snap = {"objects": {"summary": {"total": 5}, "list": []},
                "raw_counts": {"receivers": 7, "candidate_entities": 120, "saved_entities_missing": 3}}
        hass.data = {DOMAIN: {"snapshot_cache": (0.0, snap)}}
        hass.states.async_entity_ids_count.return_value = 31234
        out = ps.padspan_sizes(hass, {}, estimate=False)
        assert out["states"] == 31234
        assert (out["bermuda_rcv"], out["tag_cands"], out["saved_missing"]) == (7, 120, 3)

    @pytest.mark.asyncio
    async def test_every_build_phase_is_timed(self, monkeypatch):
        from custom_components.padspan_ha import snapshot_builder as SB
        from tests.test_findmy_snapshot import _make_house
        house = _make_house(monkeypatch, labels={}, followed=[])
        seen = []
        monkeypatch.setattr(SB, "record_duration", lambda h, m, ms: seen.append((m, ms)))
        await house.poll(0, [])
        # 0.38.133: inside "ha", its parts and its CPU time.
        assert [m for m, _ in seen] == ["snap_ble", "snap_ha_areas", "snap_ha_tags", "snap_ha", "snap_ha_cpu",
                                        "snap_ha_radios", "snap_objects", "snap_enrich"]
        assert all(ms >= 0 for _, ms in seen)


class TestBermudaTagAddresses:
    """The entity objects Bermuda's area sensors become: each one's address
    comes from its HA device (connections, then a MAC-shaped identifier). A
    fourth step walked every Bluetooth device per tag comparing a key the
    entries never had — removed; addresses resolve exactly as before."""

    def _house(self, monkeypatch, n_tags):
        from types import SimpleNamespace as NS
        from custom_components.padspan_ha import snapshot_builder as SB
        from tests.test_findmy_snapshot import _make_house
        house = _make_house(monkeypatch, labels={}, followed=[])
        states, ents, devs = [], {}, []
        for i in range(n_tags):
            eid = f"sensor.tag{i}_area_last_seen"
            states.append(NS(entity_id=eid, state="Kitchen", attributes={"friendly_name": f"Tag {i}"}, name=eid))
            ents[eid] = NS(entity_id=eid, device_id=f"d{i}", platform="bermuda", config_entry_id="b1",
                           area_id=None, domain="sensor")
            ident = {("bermuda", _mac(i).lower())} if i % 2 == 0 else {("bermuda", f"irk_{i}")}
            devs.append(NS(id=f"d{i}", connections=set(), identifiers=ident, name=f"Tag {i}",
                           name_by_user=None, model="", manufacturer="", config_entries={"b1"}, sw_version=""))
        for j in range(n_tags):         # Bluetooth devices the dead step walked
            devs.append(NS(id=f"p{j}", connections={("bluetooth", _mac(10_000 + j))}, identifiers=set(),
                           name=f"P{j}", name_by_user=None, model="", manufacturer="", config_entries=set(), sw_version=""))
        by = {s.entity_id: s for s in states}
        house.hass.states = NS(async_all=lambda *a: states, get=lambda e: by.get(e))
        er = NS(async_get=lambda eid: ents.get(eid), entities=ents)
        dr = NS(devices={d.id: d for d in devs}, async_get=lambda i: None)
        ar = NS(async_list_areas=lambda: [NS(id="k", name="Kitchen")])
        monkeypatch.setattr(SB.entity_registry, "async_get", lambda h: er)
        monkeypatch.setattr(SB.device_registry, "async_get", lambda h: dr)
        monkeypatch.setattr(SB.area_registry, "async_get", lambda h: ar)
        return house

    @pytest.mark.asyncio
    async def test_a_mac_identifier_still_gives_the_address(self, monkeypatch):
        house = self._house(monkeypatch, 4)
        objs, _x = await house.poll(0, [])
        assert objs["entity:sensor.tag0_area_last_seen"]["address"] == _mac(0)
        assert objs["entity:sensor.tag2_area_last_seen"]["address"] == _mac(2)
        # no MAC on its device: unresolved, as it always was
        assert objs["entity:sensor.tag1_area_last_seen"]["address"] is None

    @pytest.mark.asyncio
    async def test_thousands_of_bermuda_tags_build_in_linear_time(self, monkeypatch):
        import time as _t
        house = self._house(monkeypatch, 3000)
        await house.poll(0, [])
        t0 = _t.perf_counter()
        objs, _x = await house.poll(5, [])
        assert sum(1 for k in objs if k.startswith("entity:")) == 3000
        # 1,500 unresolved tags x 3,000 Bluetooth devices: ~4.5M dead iterations,
        # 0.63 s -> 0.06 s for this build when the step was removed
        assert _t.perf_counter() - t0 < 5.0

    @pytest.mark.asyncio
    async def test_missing_saved_tags_share_one_walk_over_the_states(self, monkeypatch):
        from types import SimpleNamespace as NS
        from custom_components.padspan_ha.const import DATA_COORDINATOR
        house = self._house(monkeypatch, 4)
        st_all = house.hass.states.async_all
        cat = NS(entity_id="sensor.my_cat_room_sensor", state="Kitchen", attributes={}, name="cat")
        states = list(st_all()) + [cat]
        calls = []

        def _all(*a):
            calls.append(1)
            return states
        by = {s.entity_id: s for s in states}
        house.hass.states = NS(async_all=_all, get=lambda e: by.get(e))
        house.hass.data[DOMAIN][DATA_COORDINATOR] = NS(
            room_tag_map={"Kitchen": ["tag.dog", "tag.cat", "tag.keys", "tag.fox"]})
        calls.clear()
        snap = await __import__("custom_components.padspan_ha.snapshot_builder",
                                fromlist=["x"])._build_live_snapshot(house.hass)
        # the main pass + ONE shared fuzzy pass, not one per missing tag
        assert len(calls) == 2
        tags = {t["entity_id"] for t in snap["tags"]}
        assert "sensor.my_cat_room_sensor" in tags               # fuzzy match still found
        assert snap["raw_counts"]["saved_entities_missing"] == 3   # dog, keys, fox


class TestSameDeviceObjectsMerge:
    """Objects a HA device owns by Bluetooth connection carry it as
    obj["device"], an addr_to_device entry keyed "device_id". Two matches
    read "id" instead and never fired: an iBeacon and a plain BLE address of
    the SAME device stayed two objects unless their MACs overlapped."""

    UUID = "0x" + " 0x".join(["E2"] * 16)

    def _ib(self, addr):
        md = "0x02 0x15 " + self.UUID + " 0x00 0x01 0x00 0x02 0xC5"
        return [{"address": addr, "source": "kit", "rssi": -60, "age_s": 1.0, "name": "",
                 "manufacturer_data": {"76": md}, "service_data": {}, "service_uuids": [],
                 "connectable": False}]

    def _plain(self, addr):
        return [{"address": addr, "source": "kit", "rssi": -62, "age_s": 1.0, "name": "Tracker",
                 "manufacturer_data": {}, "service_data": {}, "service_uuids": [], "connectable": False}]

    def _house(self, monkeypatch, same_device):
        from types import SimpleNamespace as NS
        from custom_components.padspan_ha import snapshot_builder as SB
        from tests.test_findmy_snapshot import _make_house
        house = _make_house(monkeypatch, labels={}, followed=[])
        a, b = _mac(1), _mac(2)
        if same_device:
            devs = [NS(id="d1", connections={("bluetooth", a), ("bluetooth", b)}, identifiers=set(), name="Fob",
                       name_by_user=None, model="", manufacturer="", config_entries=set(), sw_version="")]
        else:
            devs = [NS(id=f"d{i}", connections={("bluetooth", m)}, identifiers=set(), name=f"Fob{i}",
                       name_by_user=None, model="", manufacturer="", config_entries=set(), sw_version="")
                    for i, m in enumerate((a, b))]
        dr = NS(devices={d.id: d for d in devs}, async_get=lambda i: None)
        er = NS(async_get=lambda e: None, entities={})
        monkeypatch.setattr(SB.device_registry, "async_get", lambda h: dr)
        monkeypatch.setattr(SB.entity_registry, "async_get", lambda h: er)
        return house, a, b

    @pytest.mark.asyncio
    async def test_an_ibeacon_and_a_plain_address_of_one_device_are_one_object(self, monkeypatch):
        house, a, b = self._house(monkeypatch, same_device=True)
        objs, _x = await house.poll(0, self._ib(a) + self._plain(b))
        ib = [o for o in objs.values() if o.get("kind") == "ibeacon"]
        assert len(ib) == 1 and b in (ib[0].get("all_addresses") or [])
        assert "ble:" + b not in objs

    @pytest.mark.asyncio
    async def test_different_devices_stay_apart(self, monkeypatch):
        house, a, b = self._house(monkeypatch, same_device=False)
        objs, _x = await house.poll(0, self._ib(a) + self._plain(b))
        assert "ble:" + b in objs

    @pytest.mark.asyncio
    async def test_a_merge_by_device_is_counted_for_the_report(self, monkeypatch):
        from custom_components.padspan_ha import snapshot_builder as SB
        house, a, b = self._house(monkeypatch, same_device=True)
        await house.poll(0, self._ib(a) + self._plain(b))
        snap = await SB._build_live_snapshot(house.hass)
        assert snap["raw_counts"]["merged_by_device"] == 1


def test_the_history_cap_never_drops_an_irk_phone():
    """low_memory.py promises an IRK phone is never dropped; the cap checked
    only identified/user_label, so an unlabelled one could go."""
    from custom_components.padspan_ha.snapshot_builder import cap_object_history
    cache = {f"ble:{i:02X}": {"_last_seen_ts": i} for i in range(20)}
    cache["irk:abc"] = {"kind": "private_ble", "_last_seen_ts": -1}
    cap_object_history(cache, 5, set())
    assert "irk:abc" in cache


@pytest.mark.asyncio
async def test_the_object_history_save_is_not_awaited_inside_the_build(monkeypatch):
    """The ~6 MB save (serialise, write, fsync) was awaited inside the
    snapshot lock every interval, holding up the panel's and the presence
    poll's builds. It is scheduled with async_delay_save."""
    from tests.test_findmy_snapshot import _make_house
    from custom_components.padspan_ha.const import DOMAIN
    house = _make_house(monkeypatch, labels={}, followed=[])
    calls = []

    class _Rec:
        async def async_load(self):
            return None

        async def async_save(self, data):
            calls.append("save")

        def async_delay_save(self, fn, delay):
            calls.append("delay")
            fn()
    house.hass.data[DOMAIN]["_obj_hist_store"] = _Rec()
    await house.poll(0, [])
    await house.poll(120, [])
    assert "delay" in calls and "save" not in calls


@pytest.mark.asyncio
async def test_a_radios_network_info_is_found_by_its_name_once_per_build(monkeypatch):
    """The fallback walked the whole entity registry per slug per radio
    (25,000 Bermuda rows x 20 radios: 240 ms a build); network entities are
    indexed once. The answer is the same: a proxy named 'off' gets the IP
    and SSID from sensor.off_ip_address / sensor.off_wifi_ssid."""
    from types import SimpleNamespace as NS
    from custom_components.padspan_ha import snapshot_builder as SB
    from tests.test_findmy_snapshot import _make_house
    import tests.test_findmy_snapshot as FS
    monkeypatch.setattr(FS, "RADIOS", FS.RADIOS + [{"source": f"px{i}", "name": f"proxy {i}"} for i in range(10)])
    house = _make_house(monkeypatch, labels={}, followed=[])
    states = [NS(entity_id="sensor.off_ip_address", state="10.0.0.9", attributes={}, name="ip"),
              NS(entity_id="sensor.off_wifi_ssid", state="HomeNet", attributes={}, name="ssid")]
    ents = {s.entity_id: NS(entity_id=s.entity_id, device_id=None, platform="esphome",
                            config_entry_id="e", area_id=None) for s in states}
    for i in range(2000):
        eid = f"sensor.bermuda_{i}_distance_to_off"
        ents[eid] = NS(entity_id=eid, device_id=f"d{i}", platform="bermuda", config_entry_id="b", area_id=None)
    by = {s.entity_id: s for s in states}
    house.hass.states = NS(async_all=lambda *a: states, get=lambda e: by.get(e))
    calls = {"n": 0}

    class _Ents(dict):
        def values(self):
            calls["n"] += 1
            return super().values()
    er = NS(async_get=lambda eid: ents.get(eid), entities=_Ents(ents))
    monkeypatch.setattr(SB.entity_registry, "async_get", lambda h: er)
    snap = await SB._build_live_snapshot(house.hass)
    off = next(r for r in snap["ble"]["radios"] if r["source"] == "off")
    assert off.get("ip") == "10.0.0.9" and off.get("ssid") == "HomeNet"
    assert calls["n"] <= 3


def test_factory_reset_clears_history_through_the_builders_store():
    """The history save is a delayed save on the snapshot builder's Store;
    factory reset saved {} through a second Store, and the pending write put
    the pre-reset history back. A save on the same Store cancels it."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert 'st = domain.get("_obj_hist_store") or _St(hass, 1, OBJECT_HISTORY_STORE_KEY)' in src
