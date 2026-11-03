# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The two bug fixes that go with the device names.

The guessing merges (snapshot_builder D3 to D7): nothing labelled, saved, pinned
or calibrated is merged, the freshest address is the primary, and the opt-in
report can see what they did. The merge test itself is NOT changed here: its
wrong bit stays until these counts have been read.

The device identifiers: an entity already on a device stays on it, under an id
that device holds, so no new id joins it and no empty duplicate is made.

And through a real build: stored calibration comes out byte for byte the same.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha.const import (
    DATA_CALIBRATION,
    DATA_DEVICE_REGISTRY,
    DATA_MODEL,
    DATA_OBJECT_HISTORY,
    DATA_OBJECTS,
    DATA_SETTINGS,
    DOMAIN,
)
from custom_components.padspan_ha.entity_identity import kept_device_info
from custom_components.padspan_ha.merge_guard import MergeGuard
from custom_components.padspan_ha.private_ble_resolver import PrivateBLEResolver

# All with bit 0x02 set, the test D3 and D4 still use today.
A, B, C = "DA:00:00:00:00:01", "DA:00:00:00:00:02", "DA:00:00:00:00:03"
_ROOT = Path(__file__).resolve().parents[1]


def _ad(addr, age=1.0, rssi=-60, name="EX90", manuf=None, **extra):
    return {"address": addr, "name": name, "source": "s1", "rssi": rssi, "age_s": age, "last_seen": "2026-11-02T00:00:00+00:00",
            "manufacturer_data": manuf or {}, "service_data": {}, "service_uuids": [], "connectable": None, **extra}


class _Labels:
    def __init__(self, labels=None):
        self.labels = dict(labels or {})

    def get(self, k):
        return {"label": self.labels[k]} if k in self.labels else None

    def get_label(self, k):
        return self.labels.get(k)

    def all(self):
        return {k: {"label": v} for k, v in self.labels.items()}


class _Registry:
    """Saved ids answer get(); an unsaved one only resolve()s, like the real one's ephemeral cache."""

    def __init__(self, saved=()):
        self.saved = {k: f"ps_{i:012x}" for i, k in enumerate(saved)}
        self.resolved = []

    def resolve(self, key):
        self.resolved.append(key)
        bare = key[4:] if key.startswith("ble:") else key
        return self.saved.get(key) or self.saved.get(bare) or ("ps_ephemeral" if key else None)

    def get(self, pid):
        return {"padspan_id": pid} if pid in self.saved.values() else None

    def get_label(self, pid):
        return None

    def resolve_or_create(self, key, kind="mac", persist=False):
        return "ps_ephemeral"


class _Model:
    def __init__(self, pins=()):
        self.pins = {k: {"x_m": 1.0, "y_m": 1.0} for k in pins}

    def beacon_positions_m(self):
        return dict(self.pins)


class _Store:
    async def async_save(self, data):
        pass

    def async_delay_save(self, func, delay):
        pass


def _hass(labels=None, saved=(), pins=(), points=(), history=None):
    settings = {}
    hass = SimpleNamespace(data={}, states=SimpleNamespace(async_all=lambda *a: [], get=lambda e: None),
                           config_entries=SimpleNamespace(async_entries=lambda *a: []))
    hass.data[DOMAIN] = {
        DATA_SETTINGS: SimpleNamespace(data=settings, get=lambda k, d=None: settings.get(k, d)),
        DATA_OBJECTS: _Labels(labels),
        DATA_DEVICE_REGISTRY: _Registry(saved),
        DATA_CALIBRATION: SimpleNamespace(data={"points": [dict(p) for p in points], "model": {}}),
        DATA_MODEL: _Model(pins),
        DATA_OBJECT_HISTORY: dict(history or {}),
        "_obj_hist_store": _Store(),
    }
    return hass


@pytest.fixture
def build(monkeypatch):
    async def _build(hass, ads):
        bl = SimpleNamespace(get_snapshot=lambda max_ads=5000, max_age_s=14400: {
            "radios": [{"source": "s1", "name": "s1"}],
            "advertisements": [dict(a) for a in ads], "diag": {"ok": True, "errors": []}})
        resolver = PrivateBLEResolver(hass)

        async def _res(_h):
            return resolver

        monkeypatch.setattr(SB, "get_bluetooth_live", lambda _h: bl)
        monkeypatch.setattr(SB, "_get_ble_resolver", _res)
        snap = await SB._build_live_snapshot(hass)
        return snap, {o["key"]: o for o in snap["objects"]["list"]}
    return _build


# ── The guard, on its own ───────────────────────────────────────────────────

def test_the_guard_leaves_an_ordinary_object_free() -> None:
    assert MergeGuard(_hass())({"key": f"ble:{A}", "address": A}) is False


@pytest.mark.parametrize("obj", [
    {"user_label": "Keys"}, {"identified": True}, {"device": {"device_id": "x"}}, {"linked_entities": ["sensor.x"]},
])
def test_the_guard_reads_the_object(obj) -> None:
    assert MergeGuard(_hass())({"key": f"ble:{A}", "address": A, **obj}) is True


@pytest.mark.parametrize("hass_kw", [
    {"labels": {f"ble:{A}": "Keys"}},             # a label under its key: attaches after the first pass
    {"labels": {A: "Keys"}},                      # or its address
    {"saved": [A]},                               # in PadSpan's saved list
    {"saved": [f"ble:{A}"]},
    {"pins": [A]},                                # pinned on the map
    {"pins": [f"ble:{A}"]},
    {"pins": [A.lower()]},
    {"points": [{"device_id": A}]},               # a calibration key
    {"points": [{"device_id": f"ble:{A}"}]},
])
def test_the_guard_asks_the_stores(hass_kw) -> None:
    assert MergeGuard(_hass(**hass_kw))({"key": f"ble:{A}", "address": A}) is True


def test_the_guard_checks_every_address_the_object_has_held() -> None:
    guard = MergeGuard(_hass(points=[{"device_id": B}]))
    assert guard({"key": f"ble:{A}", "address": A, "all_addresses": [A, B]}) is True


def test_an_unsaved_id_from_the_ephemeral_cache_doesnt_count_as_saved() -> None:
    assert MergeGuard(_hass(saved=["SOMETHING ELSE"]))({"key": f"ble:{A}", "address": A}) is False


@pytest.mark.parametrize("missing", [DATA_OBJECTS, DATA_DEVICE_REGISTRY, DATA_CALIBRATION, DATA_MODEL])
def test_until_the_stores_have_loaded_nothing_is_merged(missing) -> None:
    hass = _hass()
    del hass.data[DOMAIN][missing]
    assert MergeGuard(hass)({"key": f"ble:{A}", "address": A}) is True


# ── Through a real build ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_rotation_still_merges_with_the_freshest_as_primary(build) -> None:
    """Rotating addresses of one device: the oldest was the strongest, and used to be primary."""
    hass = _hass()
    snap, objs = await build(hass, [_ad(A, age=8000.0, rssi=-40), _ad(B, age=2.0, rssi=-70), _ad(C, age=4000.0, rssi=-55)])
    assert list(objs) == [f"ble:{B}"], list(objs)
    primary = objs[f"ble:{B}"]
    assert primary["rssi"] == -70 and primary["age_s"] == 2.0, "an old strong reading doesn't take over"
    assert set(primary["all_addresses"]) == {A, B, C}
    assert snap["raw_counts"]["merge_same_name"] == 2 and "merge_held" not in snap["raw_counts"]


@pytest.mark.parametrize("hass_kw", [
    {"labels": {f"ble:{A}": "Keys"}}, {"labels": {A: "Keys"}}, {"saved": [A]}, {"pins": [A]},
    {"points": [{"device_id": A}]}, {"points": [{"device_id": f"ble:{A}"}]},
])
@pytest.mark.asyncio
async def test_a_protected_device_is_neither_absorbed_nor_primary(build, hass_kw) -> None:
    hass = _hass(**hass_kw)
    # The protected one is the freshest and the strongest: it would have been primary.
    snap, objs = await build(hass, [_ad(A, age=1.0, rssi=-40), _ad(B, age=5.0, rssi=-60), _ad(C, age=9.0, rssi=-70)])
    assert set(objs) == {f"ble:{A}", f"ble:{B}"}, "the other two still merge, without it"
    assert A not in (objs[f"ble:{B}"].get("all_addresses") or [])
    assert snap["raw_counts"]["merge_held"] >= 1


@pytest.mark.asyncio
async def test_a_protected_device_stays_in_history_through_the_first_pass(build) -> None:
    """First-pass absorbed objects were deleted from history with no label check."""
    hass = _hass(labels={f"ble:{B}": "Bike"})
    await build(hass, [_ad(A, age=1.0, rssi=-40), _ad(B, age=5.0, rssi=-60)])
    assert f"ble:{B}" in hass.data[DOMAIN][DATA_OBJECT_HISTORY]
    assert f"ble:{A}" in hass.data[DOMAIN][DATA_OBJECT_HISTORY]


@pytest.mark.asyncio
async def test_identical_maker_data_has_its_own_counter_and_the_same_guard(build) -> None:
    manuf = {"224": "0x01 0x02 0x03"}
    hass = _hass()
    snap, objs = await build(hass, [_ad(A, age=1.0, name=A, manuf=manuf), _ad(B, age=9.0, name=B, manuf=manuf)])
    assert list(objs) == [f"ble:{A}"] and snap["raw_counts"]["merge_same_data"] == 1
    hass = _hass(pins=[B])
    snap, objs = await build(hass, [_ad(A, age=1.0, name=A, manuf=manuf), _ad(B, age=9.0, name=B, manuf=manuf)])
    assert set(objs) == {f"ble:{A}", f"ble:{B}"} and "merge_same_data" not in snap["raw_counts"]


@pytest.mark.asyncio
async def test_the_merge_test_itself_hasnt_changed(build) -> None:
    """Same name, bit 0x02 clear: still not merged, whatever the top bits say.
    Fixing the test comes after these counts have been read."""
    hass = _hass()
    a, b = "D8:00:00:00:00:01", "D8:00:00:00:00:02"       # top bits 11, bit 0x02 clear
    snap, objs = await build(hass, [_ad(a), _ad(b, age=2.0)])
    assert set(objs) == {f"ble:{a}", f"ble:{b}"}
    src = (Path(SB.__file__)).read_text(encoding="utf-8")
    assert src.count("is_random = bool(first_octet & 0x02)") == 5


@pytest.mark.asyncio
async def test_no_merges_leave_no_counters_but_the_type_share(build) -> None:
    snap, _objs = await build(_hass(), [_ad(A, address_type="random"), _ad("D8:00:00:00:00:09", name="Other")])
    counts = snap["raw_counts"]
    assert not {"merge_same_name", "merge_same_data", "merge_held"} & set(counts)
    assert counts["type_known_pc"] == 50.0


# ── Makers through a real build ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_makers_and_address_types_reach_objects_and_adverts(build) -> None:
    apple_public = "F0:18:98:12:34:56"
    apple_random = "F0:18:98:AB:CD:EF"
    apple_silent = "F0:18:98:00:00:01"
    hass = _hass()
    snap, objs = await build(hass, [
        _ad(apple_public, name=apple_public, address_type="public"),
        _ad(apple_random, name=apple_random, address_type="random"),
        _ad(apple_silent, name=apple_silent),
        _ad("D8:00:00:00:00:04", name="D8:00:00:00:00:04", espresense_id="msft:cdp:0901"),
    ])
    pub = objs[f"ble:{apple_public}"]
    assert pub["company_name"] == "Apple" and pub["maker_source"] == "address" and pub["address_type"] == "public"
    rnd = objs[f"ble:{apple_random}"]
    assert rnd["company_name"] is None and "maker_guess" not in rnd and rnd["address_type"] == "random"
    silent = objs[f"ble:{apple_silent}"]
    assert silent["company_name"] is None and silent["maker_guess"] == "Apple" and "address_type" not in silent
    esp = objs["ble:D8:00:00:00:00:04"]
    assert esp["company_name"] == "Microsoft" and esp["maker_source"] == "espresense"
    ads = {a["address"]: a for a in snap["ble"]["advertisements"]}
    assert ads[apple_public]["company_name"] == "Apple" and ads[apple_silent]["maker_guess"] == "Apple"
    assert ads[apple_random]["company_name"] is None and "maker_guess" not in ads[apple_random]


@pytest.mark.asyncio
async def test_what_a_radio_said_outlives_the_advert(build) -> None:
    """Confirmed random, then the advert ages out: history remembers, so it never
    gets a "probably" (the rule that the type alone can't keep, once it's forgotten)."""
    addr = "F0:18:98:AB:CD:EF"
    hass = _hass()
    await build(hass, [_ad(addr, name=addr, address_type="random")])
    kept = hass.data[DOMAIN][DATA_OBJECT_HISTORY][f"ble:{addr}"]
    assert kept["address_type"] == "random"
    assert "maker_guess" not in kept and kept["company_name"] is None
    _snap, objs = await build(hass, [])
    again = objs[f"ble:{addr}"]
    assert again["address_type"] == "random" and "maker_guess" not in again


@pytest.mark.asyncio
async def test_a_probably_never_goes_into_history(build) -> None:
    addr = "F0:18:98:00:00:01"
    hass = _hass()
    await build(hass, [_ad(addr, name=addr)])
    kept = hass.data[DOMAIN][DATA_OBJECT_HISTORY][f"ble:{addr}"]
    assert "maker_guess" not in kept and not kept.get("company_name")
    _snap, objs = await build(hass, [])
    assert objs[f"ble:{addr}"]["maker_guess"] == "Apple", "worked out again each build"


@pytest.mark.asyncio
async def test_the_xref_says_whether_someone_named_it(build) -> None:
    hass = _hass(labels={f"ble:{A}": "Keys"})
    plain = "D8:00:00:00:00:05"
    snap, _objs = await build(hass, [_ad(A, name=A), _ad(plain, name=plain)])
    xref = {a["address"]: a["_xref"] for a in snap["ble"]["advertisements"]}
    assert xref[A]["user_label"] == "Keys" and xref[A]["label"] == "Keys"
    assert "user_label" not in xref[plain] and xref[plain]["label"] == plain, "label stays for what reads it"


def test_history_gets_the_new_names_when_it_loads() -> None:
    """A device not heard since an older version keeps showing nothing wrong: a
    Samsung as Beats, every iBeacon as Apple. And Apple doesn't come back from
    history when the fresh answer is empty."""
    cache = {
        "ble:x": {"kind": "ble", "company_name": "Beats Electronics", "manufacturer_data": {"117": "0x01"}},
        "ibeacon:y": {"kind": "ibeacon", "company_name": "Apple", "manufacturer_data": {"76": "0x02 0x15 0x00"}},
        "entity:z": {"kind": "entity", "company_name": "Left alone"},
        "bad": "not a dict",
    }
    SB._reenrich_history(cache)
    assert cache["ble:x"]["company_name"] == "Samsung Electronics"
    assert cache["ibeacon:y"]["company_name"] is None and cache["ibeacon:y"]["device_type"] == "iBeacon"
    assert cache["entity:z"]["company_name"] == "Left alone"


# ── Calibration, proved ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_build_leaves_stored_calibration_and_saved_ids_byte_identical(build, monkeypatch) -> None:
    points = [
        {"id": "p1", "device_id": A, "map_id": "m", "x_frac": 0.25, "y_frac": 0.5, "source": "hand",
         "scanner_readings": [{"source": "s1", "mean_rssi": -60.5, "std_rssi": 1.5, "name": "s1"}]},
        {"id": "p2", "device_id": "ibeacon:e2c56db5-dffb-48d2-b060-d0f5a71096e0:1:2", "map_id": "m", "x_frac": 0.5,
         "y_frac": 0.5, "source": "auto", "scanner_readings": [{"source": "s1", "mean_rssi": -70.0, "std_rssi": 2.0}]},
    ]
    hass = _hass(points=points, pins=[A], labels={A: "Keys"}, saved=[A])
    cal = hass.data[DOMAIN][DATA_CALIBRATION]
    before = json.dumps(cal.data, sort_keys=False)
    model_before = json.dumps(hass.data[DOMAIN][DATA_MODEL].pins)
    saved_before = dict(hass.data[DOMAIN][DATA_DEVICE_REGISTRY].saved)
    ib = "0x02 0x15 0xE2 0xC5 0x6D 0xB5 0xDF 0xFB 0x48 0xD2 0xB0 0x60 0xD0 0xF5 0xA7 0x10 0x96 0xE0 0x00 0x01 0x00 0x02 0xC5"
    snap, objs = await build(hass, [_ad(A), _ad(B, age=5.0), _ad(C, name=C, manuf={"76": ib})])
    assert json.dumps(cal.data, sort_keys=False) == before
    assert json.dumps(hass.data[DOMAIN][DATA_MODEL].pins) == model_before
    assert hass.data[DOMAIN][DATA_DEVICE_REGISTRY].saved == saved_before
    assert objs[f"ble:{A}"]["padspan_id"] == saved_before[A]


def test_no_store_that_holds_calibration_or_identity_was_changed_by_this_work() -> None:
    """Names never reach these. Only labels and groups computed per call read them."""
    src = (Path(SB.__file__).parent / "calibration_store.py").read_text(encoding="utf-8")
    assert "lookup_company" not in src and "ble_enrichment" not in src and "device_tables" not in src
    reg = (Path(SB.__file__).parent / "device_registry.py").read_text(encoding="utf-8")
    assert "company_name" not in reg and "ble_enrichment" not in reg and "device_tables" not in reg


# ── The device identifiers ──────────────────────────────────────────────────

D = DOMAIN


def _ha(monkeypatch, *, entity=None, device=None):
    """entity: the entity's registry row's device id; device: that device."""
    from homeassistant.helpers import device_registry as dr
    from homeassistant.helpers import entity_registry as er

    rows = {} if entity is None else {("sensor", D, "uid"): "sensor.x"}
    reg = SimpleNamespace(
        async_get_entity_id=lambda platform, domain, unique_id: rows.get((platform, domain, unique_id)),
        async_get=lambda entity_id: SimpleNamespace(device_id=entity) if entity_id == "sensor.x" else None)
    devs = SimpleNamespace(async_get=lambda device_id: device if device_id == entity else None)
    monkeypatch.setattr(er, "async_get", lambda hass: reg, raising=False)
    monkeypatch.setattr(dr, "async_get", lambda hass: devs, raising=False)
    return SimpleNamespace()


def test_a_new_entity_gets_a_new_id_and_its_connection(monkeypatch) -> None:
    hass = _ha(monkeypatch)
    assert kept_device_info(hass, "sensor", "uid", "ps_new", {("bluetooth", "AA")}) == ({(D, "ps_new")}, {("bluetooth", "AA")})


def test_an_entity_on_a_device_that_holds_its_id_changes_nothing(monkeypatch) -> None:
    dev = SimpleNamespace(identifiers={(D, "ps_old"), (D, "ps_new")})
    hass = _ha(monkeypatch, entity="dev1", device=dev)
    assert kept_device_info(hass, "sensor", "uid", "ps_new", {("bluetooth", "AA")}) == ({(D, "ps_new")}, {("bluetooth", "AA")})


def test_an_entity_keeps_its_device_when_the_objects_id_changes(monkeypatch) -> None:
    dev = SimpleNamespace(identifiers={(D, "ps_b"), (D, "ps_a"), ("ibeacon", "other")})
    hass = _ha(monkeypatch, entity="dev1", device=dev)
    ids, conns = kept_device_info(hass, "sensor", "uid", "ps_new", {("bluetooth", "AA")})
    assert ids == {(D, "ps_a")}, "one the device already holds, the same one every time"
    assert conns == set(), "another device may hold it, and from HA 2026.8 that refuses the add"


def test_an_unlinked_row_or_another_integrations_device_gets_the_new_id(monkeypatch) -> None:
    hass = _ha(monkeypatch, entity="dev1", device=None)
    assert kept_device_info(hass, "sensor", "uid", "ps_new")[0] == {(D, "ps_new")}
    hass = _ha(monkeypatch, entity="dev1", device=SimpleNamespace(identifiers={("bermuda", "x")}))
    assert kept_device_info(hass, "sensor", "uid", "ps_new")[0] == {(D, "ps_new")}


def test_no_registry_answer_changes_nothing(monkeypatch) -> None:
    from homeassistant.helpers import entity_registry as er

    def _boom(hass):
        raise RuntimeError("no registry")

    monkeypatch.setattr(er, "async_get", _boom, raising=False)
    assert kept_device_info(None, "sensor", "uid", "ps_new", {("bluetooth", "AA")}) == ({(D, "ps_new")}, {("bluetooth", "AA")})


def test_all_four_sites_use_it() -> None:
    base = Path(SB.__file__).parent
    sensor = (base / "sensor.py").read_text(encoding="utf-8")
    tracker = (base / "device_tracker.py").read_text(encoding="utf-8")
    assert sensor.count("kept_device_info(") == 3 and tracker.count("kept_device_info(") == 1
    assert sensor.count('"identifiers": {(DOMAIN, "padspan_occupancy")}') == 1, "the one fixed device, not an object's"
    assert sensor.count('"identifiers": {(DOMAIN') == 1 and tracker.count('"identifiers": {(DOMAIN') == 0


def test_the_field_count(monkeypatch) -> None:
    from homeassistant.helpers import device_registry as dr
    from custom_components.padspan_ha.telemetry import _padspan_device_ids

    devices = {
        "a": SimpleNamespace(identifiers={(D, f"ps_{i}") for i in range(14)}, name="Bronco", name_by_user=None),
        "b": SimpleNamespace(identifiers={(D, "ps_x")}, name="Bronco", name_by_user=None),
        "c": SimpleNamespace(identifiers={(D, "ps_y"), ("other", "z")}, name="Other", name_by_user="Mine"),
        "d": SimpleNamespace(identifiers={("esphome", "q")}, name="Bronco", name_by_user=None),
    }
    monkeypatch.setattr(dr, "async_get", lambda hass: SimpleNamespace(devices=devices), raising=False)
    assert _padspan_device_ids(None) == {"devices": 3, "ids": 16, "most": 14, "over_10": 1, "same_name": 2}
    # HA 2026.9's view, whose iteration yields the entries (util.ha_devices).
    monkeypatch.setattr(dr, "async_get", lambda hass: SimpleNamespace(devices=list(devices.values())), raising=False)
    assert _padspan_device_ids(None)["ids"] == 16
    monkeypatch.setattr(dr, "async_get", lambda hass: SimpleNamespace(devices={}), raising=False)
    assert _padspan_device_ids(None) == {}
