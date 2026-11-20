"""What the live snapshot builder gives for one fixed house, written down whole.

Used by tests/test_golden_snapshot.py. The house is made of stand-ins for
Home Assistant's side (areas, devices, entities, states, a Bermuda entry) and
PadSpan's own stores as they are (labels, ids, settings, the Find My bridge,
the name links, the object history). The adverts are a fixed list (HEARD):
each is handed to PadSpan's own BluetoothLive the way Home Assistant hands
them over, on a simulated clock. snapshot_builder._build_live_snapshot is
then run at six moments over twenty minutes, so what it keeps from one build
to the next (the object history, each beacon's last addresses, the Find My
links) is used too.

A record per build: the whole snapshot it returned, and what it kept for the
next one. Every clock the builder reads is the simulated one.
"""

from __future__ import annotations

import asyncio
import copy
import sys
from contextlib import ExitStack, contextmanager
from types import SimpleNamespace as NS
from typing import Any, Iterator
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from custom_components.padspan_ha import bluetooth_live as _bl
from custom_components.padspan_ha import findmy as F
from custom_components.padspan_ha import label_follow as LF
from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha.const import (
    DATA_BEACON_LAST_MACS, DATA_CALIBRATION, DATA_DEVICE_REGISTRY, DATA_MODEL,
    DATA_OBJECT_HISTORY, DATA_OBJECTS, DATA_SETTINGS, DOMAIN,
)
from custom_components.padspan_ha.device_registry import DeviceRegistry
from custom_components.padspan_ha.object_store import ObjectStore
from custom_components.padspan_ha.private_ble_resolver import PrivateBLEResolver
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests import room_speed_sim as sim

BUILD_AT = (0.0, 20.0, 90.0, 150.0, 400.0, 1300.0)      # seconds: when a snapshot is built

# ── Receivers ────────────────────────────────────────────────────────────────
KITCHEN, LOUNGE, OFFICE = "AA:00:00:00:00:01", "AA:00:00:00:00:02", "AA:00:00:00:00:03"
GONE = "AA:00:00:00:00:09"          # heard from, but Home Assistant lists no such scanner


class ESPHomeScanner:
    """A Bluetooth proxy as Home Assistant lists it."""

    def __init__(self, source: str, name: str, mode: str | None = "passive") -> None:
        self.source, self.name = source, name
        self.connectable, self.scanning, self.adapter = False, True, None
        self.current_mode = NS(value=mode) if mode else None
        self.requested_mode = NS(value=mode) if mode else None
        self.discovered_devices_and_advertisement_data: dict[str, tuple] = {}
        self.discovered_device_timestamps: dict[str, float] = {}


class HaScanner(ESPHomeScanner):
    """This machine's own adapter."""

    def __init__(self, source: str, name: str) -> None:
        super().__init__(source, name, "active")
        self.connectable, self.adapter = True, "hci0"


# ── The adverts ──────────────────────────────────────────────────────────────

def _ibeacon(uuid: str, major: int, minor: int, tx: int = -59) -> dict[int, bytes]:
    return {76: bytes([0x02, 0x15]) + bytes.fromhex(uuid.replace("-", ""))
            + major.to_bytes(2, "big") + minor.to_bytes(2, "big") + tx.to_bytes(1, "big", signed=True)}


def _findmy(key_byte: int) -> dict[int, bytes]:
    return {76: bytes([0x12, 0x19, 0x10] + [key_byte] * 22 + [0x01, 0x00])}


_IRK = bytes.fromhex("ec0234a357c8ad05341010a60a397d9b")     # Bluetooth Core Spec's own sample key


def _private_address(prand: int) -> str:
    """The address a phone with _IRK shows for this random part (the spec's ah())."""
    r = prand.to_bytes(3, "big")
    enc = Cipher(algorithms.AES(_IRK), modes.ECB()).encryptor()
    h = (enc.update(b"\x00" * 13 + r) + enc.finalize())[13:]
    return ":".join(f"{b:02X}" for b in r + h)


UUID_BIKE = "0a1b2c3d-0000-4000-8000-00000000cafe"
UUID_ROTATES = "0a1b2c3d-0000-4000-8000-00000000beef"
UUID_FACTORY = "fda50693-a4e2-4fb1-afcf-c6eb07647825"       # a maker's default, shared by many beacons
TILE, BIKE = "C4:00:00:00:00:21", "C4:00:00:00:00:22"
ROT_A, ROT_B = "D6:00:00:00:00:31", "E7:00:00:00:00:32"
TWIN_A, TWIN_B = "C4:00:00:00:00:41", "C4:00:00:00:00:42"
PHONE_A, PHONE_B = _private_address(0x708194), _private_address(0x4A1B2C)
STRANGER_A, STRANGER_B = "5B:11:22:33:44:55", "6C:11:22:33:44:66"
KEYS_A, KEYS_B = "D1:11:11:11:11:11", "E2:22:22:22:22:22"
CAR_A, CAR_B = "DA:00:00:00:00:51", "DA:00:00:00:00:52"
BARE = ("F2:00:00:00:00:61", "F2:00:00:00:00:62", "F2:00:00:00:00:63")
WATCH, LAPTOP, URL_BEACON, EXPOSURE = "C4:00:00:00:00:71", "7A:00:00:00:00:72", "C4:00:00:00:00:73", "4D:00:00:00:00:74"
TV, SIGN, HIDDEN_BEACON = "C4:00:00:00:00:81", "C4:00:00:00:00:82", "C4:00:00:00:00:83"
OLD_TAG, DOG = "C4:00:00:00:00:91", "C4:00:00:00:00:92"
UUID_HIDDEN = "0a1b2c3d-0000-4000-8000-00000000d00d"
_NEARBY = {76: bytes.fromhex("1005031c6b2f1e")}
_TILE_UUID = "0000feed-0000-1000-8000-00805f9b34fb"
_EDDYSTONE = "0000feaa-0000-1000-8000-00805f9b34fb"
_EXPOSURE_UUID = "0000fd6f-0000-1000-8000-00805f9b34fb"


def _h(t: float, addr: str, heard_by: dict[str, int], name: str = "", manuf: dict | None = None,
       svc: dict | None = None, uuids: tuple = (), tx: int | None = None, connectable: bool = False) -> dict:
    return {"t": t, "address": addr, "heard_by": heard_by, "name": name, "manufacturer_data": manuf or {},
            "service_data": svc or {}, "service_uuids": list(uuids), "tx_power": tx, "connectable": connectable}


_devices_so_far = [0]


def _each(times: tuple, addr: str, heard_by: dict[str, int], **kw) -> list[dict]:
    """One device's adverts at these times. No two adverts in the list are
    heard at the same instant (each device is a few hundredths of a second
    after the one before, each receiver a thousandth after the last): two
    adverts of exactly the same age come out of BluetoothLive in an order
    that changes from run to run (it walks a set)."""
    _devices_so_far[0] += 1
    late = 0.013 * _devices_so_far[0]
    return [_h(t + late, addr, {s: r - i for s, r in heard_by.items()}, **kw) for i, t in enumerate(times)]


_ALWAYS = (-4.0, 17.0, 86.0, 146.0, 396.0, 1296.0)
HEARD: list[dict] = sorted([
    # A named tag Home Assistant knows as a device of its own.
    *_each(_ALWAYS, TILE, {KITCHEN: -58, LOUNGE: -80}, name="Tile Keys", uuids=(_TILE_UUID,), connectable=True),
    # An iBeacon with a label and a pin, on one address.
    *_each(_ALWAYS, BIKE, {KITCHEN: -70, OFFICE: -66}, manuf=_ibeacon(UUID_BIKE, 1, 2)),
    # An iBeacon that changes address between the second and third build.
    *_each(_ALWAYS[:2], ROT_A, {LOUNGE: -61}, manuf=_ibeacon(UUID_ROTATES, 7, 9, -65)),
    *_each(_ALWAYS[2:], ROT_B, {LOUNGE: -63, KITCHEN: -82}, manuf=_ibeacon(UUID_ROTATES, 7, 9, -65)),
    # Two beacons still on their maker's default id, in different rooms.
    *_each(_ALWAYS, TWIN_A, {KITCHEN: -55}, manuf=_ibeacon(UUID_FACTORY, 10011, 19641)),
    *_each(_ALWAYS, TWIN_B, {OFFICE: -57}, manuf=_ibeacon(UUID_FACTORY, 10011, 19641)),
    # A phone whose private address resolves, before and after it changes.
    *_each(_ALWAYS[:2], PHONE_A, {LOUNGE: -52, KITCHEN: -71}, manuf=_NEARBY, connectable=True),
    *_each(_ALWAYS[2:], PHONE_B, {OFFICE: -50, LOUNGE: -77}, manuf=_NEARBY, connectable=True),
    # Someone else's phone: private addresses that resolve to nothing.
    *_each(_ALWAYS[:3], STRANGER_A, {KITCHEN: -88}, manuf={76: bytes.fromhex("1006411e9c0a5b30")}),
    *_each(_ALWAYS[3:], STRANGER_B, {KITCHEN: -86}, manuf={76: bytes.fromhex("1006411e9c0a5b30")}),
    # A Find My tag, named and followed on its first address, then on its next.
    *_each(_ALWAYS[:2], KEYS_A, {KITCHEN: -50, OFFICE: -88}, manuf=_findmy(0x11)),
    *_each((18.0, 86.0, 146.0, 396.0, 1296.0), KEYS_B, {KITCHEN: -51, OFFICE: -87}, manuf=_findmy(0x22)),
    # One car, two random addresses with the same name.
    *_each(_ALWAYS, CAR_A, {LOUNGE: -75}, name="EX90"),
    *_each(_ALWAYS[1:], CAR_B, {LOUNGE: -74}, name="EX90"),
    # Three random addresses that say nothing at all, heard by one receiver.
    *[h for a in BARE for h in _each(_ALWAYS[:3], a, {OFFICE: -90})],
    # Makers and services the name tables know.
    *_each(_ALWAYS, WATCH, {LOUNGE: -64}, name="Galaxy Watch", manuf={117: bytes.fromhex("420401802060")}, tx=-7),
    *_each(_ALWAYS, LAPTOP, {OFFICE: -60}, manuf={6: bytes.fromhex("0109200222b4c8d1")}),
    *_each(_ALWAYS, URL_BEACON, {KITCHEN: -77}, svc={_EDDYSTONE: bytes.fromhex("10ee02676f6f2e676c00")},
           uuids=(_EDDYSTONE,)),
    *_each(_ALWAYS[:5], EXPOSURE, {GONE: -81}, svc={_EXPOSURE_UUID: bytes.fromhex("aa" * 20)}, uuids=(_EXPOSURE_UUID,)),
    # Three the settings hide (by its address in the simple list, by an
    # address rule, by its beacon id); heard once and never again; labelled
    # and steady.
    *_each(_ALWAYS, TV, {LOUNGE: -45}, name="[TV] Lounge"),
    *_each(_ALWAYS, SIGN, {LOUNGE: -48}, name="Shop sign"),
    *_each(_ALWAYS, HIDDEN_BEACON, {OFFICE: -59}, manuf=_ibeacon(UUID_HIDDEN, 3, 4)),
    *_each(_ALWAYS[:1], OLD_TAG, {OFFICE: -72}, name="Old tag"),
    *_each(_ALWAYS, DOG, {KITCHEN: -62, LOUNGE: -66, OFFICE: -83}, name="PetTag", tx=-59),
], key=lambda h: (h["t"], h["address"]))

LABELS = {"ibeacon:" + UUID_BIKE + ":1:2": "Bike", KEYS_A: "Keys", DOG: "Dog collar", "C4:00:00:00:00:99": "Spare tag"}
SETTINGS = {
    "mac_rotation_bridging": True, "apple_auto_classify": True,
    "followed_addrs": [KEYS_A, PHONE_A],
    "excluded_objects": [TV, "ibeacon:" + UUID_HIDDEN + ":3:4"],
    "ingest_rules": [{"match": {"addrs": [SIGN]}, "action": "mask", "reason": "a sign"}],
    "scanner_offsets": {OFFICE: -3},
    "lost_radios": {GONE: {"marked_at": "2026-09-20T10:00:00+00:00"}},
}
# What the history file holds when the first build loads it: a labelled tag
# not heard for an hour, as an older version stored it.
HISTORY_ON_DISK = {
    "ble:C4:00:00:00:00:99": {
        "key": "ble:C4:00:00:00:00:99", "kind": "ble", "address": "C4:00:00:00:00:99", "name": "Spare tag",
        "user_label": "Spare tag", "identified": True, "room": "Office", "rssi": -70, "age_s": 5.0,
        "sources": [{"source": OFFICE, "rssi": -70, "age_s": 5.0}], "manufacturer_data": {}, "service_data": {},
        "service_uuids": [], "_first_seen": sim.Clock.EPOCH0 - 86400.0, "_last_seen_ts": sim.Clock.EPOCH0 - 3600.0,
    },
}


# ── Home Assistant's side ────────────────────────────────────────────────────

def _device(did: str, name: str, **kw: Any) -> NS:
    base = dict(id=did, name=name, name_by_user=None, model="", manufacturer="", sw_version="",
                connections=set(), identifiers=set(), area_id=None, via_device_id=None,
                config_entries=set(), config_entry_id=None, primary_config_entry=None,
                disabled_by=None, entry_type=None)
    base.update(kw)
    if base["config_entry_id"] is None and base["config_entries"]:
        base["config_entry_id"] = sorted(base["config_entries"])[0]
    return NS(**base)


def _entity(eid: str, device_id: str | None = None, platform: str = "x", entry: str | None = None,
            area_id: str | None = None, unique_id: str = "") -> NS:
    return NS(entity_id=eid, device_id=device_id, platform=platform, config_entry_id=entry, area_id=area_id,
              unique_id=unique_id or eid, disabled_by=None)


def _state(eid: str, state: str, **attrs: Any) -> NS:
    return NS(entity_id=eid, state=state, attributes=attrs, name=attrs.get("friendly_name", eid))


AREAS = [NS(id="a_kitchen", name="Kitchen", floor_id="ground"), NS(id="a_lounge", name="Lounge", floor_id="ground"),
         NS(id="a_office", name="Office", floor_id="upper"), NS(id="a_garden", name="Garden", floor_id=None)]
DEVICES = [
    _device("d_kitchen", "Kitchen Proxy", manufacturer="Espressif", model="ESP32", sw_version="2026.10.1",
            connections={("bluetooth", KITCHEN), ("mac", "aa:00:00:00:00:f1")}, area_id="a_kitchen",
            config_entries={"esphome1"}),
    _device("d_lounge", "lounge-proxy", name_by_user="Lounge Proxy", connections={("bluetooth", LOUNGE)},
            area_id="a_lounge", config_entries={"esphome2"}),
    _device("d_office", "Office Proxy", connections={("bluetooth", OFFICE)}, area_id="a_office",
            config_entries={"esphome3"}),
    _device("d_tile", "Tile Keys", manufacturer="Tile", model="Mate", connections={("bluetooth", TILE)},
            config_entries={"ble1"}),
    _device("d_bermuda_phone", "Phone", config_entries={"bermuda1"}),
    _device("d_bermuda_scanner", "Bermuda Kitchen scanner", manufacturer="Bermuda", model="Scanner",
            config_entries={"bermuda1"}),
]
ENTITIES = {e.entity_id: e for e in (
    _entity("device_tracker.tile_keys", "d_tile", "ble_tracker", "ble1"),
    _entity("sensor.phone_area", "d_bermuda_phone", "bermuda", "bermuda1"),
    _entity("sensor.phone_area_last_seen", "d_bermuda_phone", "bermuda", "bermuda1"),
    _entity("sensor.phone_distance_to_kitchen", "d_bermuda_phone", "bermuda", "bermuda1"),
    _entity("sensor.kitchen_proxy_ip_address", "d_kitchen", "esphome", "esphome1"),
    _entity("sensor.kitchen_proxy_wifi_signal", "d_kitchen", "esphome", "esphome1"),
    _entity("sensor.kitchen_proxy_ssid", "d_kitchen", "esphome", "esphome1"),
    _entity("sensor.office_proxy_ip_address", None, "esphome", "esphome3"),
    _entity("sensor.dog_collar_area", None, DOMAIN, None, unique_id="dog__area"),
    _entity("sensor.beacon1_room", None, "template", None),
    _entity("binary_sensor.kitchen_motion", None, "zha", None, area_id="a_kitchen"),
    _entity("sensor.kitchen_voltage", None, "zha", None, area_id="a_kitchen"),
)}
STATES = [
    _state("device_tracker.tile_keys", "Kitchen", friendly_name="Tile Keys", source_type="bluetooth_le", rssi=-58),
    _state("sensor.phone_area", "Lounge", friendly_name="Phone Area", area_id="a_lounge", area_name="Lounge"),
    _state("sensor.phone_area_last_seen", "Lounge", friendly_name="Phone Area Last Seen", area_name="Lounge"),
    _state("sensor.phone_distance_to_kitchen", "4.1", friendly_name="Phone Distance to Kitchen",
           area_id="a_kitchen", area_name="Kitchen", area_scanner_name="Kitchen Proxy"),
    _state("sensor.kitchen_proxy_ip_address", "192.0.2.10"),
    _state("sensor.kitchen_proxy_wifi_signal", "-61"),
    _state("sensor.kitchen_proxy_ssid", "ExampleNet"),
    _state("sensor.office_proxy_ip_address", "192.0.2.12"),
    _state("sensor.dog_collar_area", "Kitchen", friendly_name="Dog collar Area"),
    _state("sensor.beacon1_room", "Office", friendly_name="Beacon 1 room"),
    _state("binary_sensor.kitchen_motion", "on", friendly_name="Kitchen motion", device_class="motion"),
    _state("sensor.kitchen_voltage", "231", friendly_name="Kitchen voltage"),
    _state("person.alex", "home", friendly_name="Alex"),
]


class _Disk:
    """A store's file: what was saved is what loads."""

    def __init__(self, saved: Any = None) -> None:
        self.saved = saved
        self.saves = 0

    async def async_load(self) -> Any:
        return copy.deepcopy(self.saved)

    async def async_save(self, data: Any) -> None:
        self.saved, self.saves = copy.deepcopy(data), self.saves + 1

    def async_delay_save(self, fn: Any, delay: float = 0) -> None:
        self.saved, self.saves = copy.deepcopy(fn()), self.saves + 1


def _house() -> tuple[Any, dict[str, Any]]:
    states = {s.entity_id: s for s in copy.deepcopy(STATES)}
    hass = NS(
        data={},
        states=NS(async_all=lambda domain=None: [s for s in states.values()
                                                 if domain is None or s.entity_id.startswith(domain + ".")],
                  get=lambda eid: states.get(eid)),
        config_entries=NS(async_entries=lambda *a: [NS(domain="bermuda", entry_id="bermuda1"),
                                                     NS(domain="esphome", entry_id="esphome1")]),
        config=NS(country="CA", latitude=50.0, longitude=-125.0, time_zone="UTC"),
    )

    async def _job(fn, *args):
        return fn(*args)

    hass.async_add_executor_job = _job
    settings = {**copy.deepcopy(DEFAULT_SETTINGS), **copy.deepcopy(SETTINGS)}
    labels = ObjectStore.__new__(ObjectStore)
    labels.hass, labels._data = hass, {k.upper(): {"label": v} for k, v in LABELS.items()}
    ids = DeviceRegistry.__new__(DeviceRegistry)
    ids.hass, ids._devices, ids._index, ids._dirty = hass, {}, {}, False
    ids._ephemeral = __import__("collections").OrderedDict()
    ids._devices["ps_00000000d06c"] = {"padspan_id": "ps_00000000d06c", "label": "Dog collar",
                                      "identities": [{"kind": "mac", "value": DOG}]}
    ids._rebuild_index()
    stores = {"history": _Disk(copy.deepcopy(HISTORY_ON_DISK)), "findmy": _Disk(), "links": _Disk()}
    hass.data[DOMAIN] = {
        DATA_SETTINGS: NS(data=settings, get=lambda k, d=None: settings.get(k, d)),
        DATA_OBJECTS: labels,
        DATA_DEVICE_REGISTRY: ids,
        DATA_CALIBRATION: NS(data={"points": [{"id": "cp_1", "device_id": WATCH, "label": "", "room": "Lounge"}],
                                   "model": {}}),
        DATA_MODEL: NS(beacon_positions_m=lambda: {"ibeacon:" + UUID_BIKE + ":1:2": {
            "x_m": 2.0, "y_m": 3.0, "floor_id": "ground", "room": "Kitchen"}}),
        "_obj_hist_store": stores["history"],
        SB._FINDMY: F.FindMyBridge(), SB._FINDMY_STORE: stores["findmy"],
        SB._LABEL_LINKS: LF.LabelLinks(), SB._LABEL_LINKS_STORE: stores["links"],
        "presence_coordinator": NS(data={"__scanner_health__": {
            KITCHEN: {"reliability": 1.0, "agree_pct": 100, "polls": 30, "room": "Kitchen"}}}),
    }
    return hass, stores


@contextmanager
def _pinned(clock: sim.Clock, manager: Any, scanners: list, bl_box: list, resolver_box: list) -> Iterator[None]:
    """Every clock the builder and BluetoothLive read is `clock`; Home
    Assistant's registries and Bluetooth are the stand-ins above."""
    areas = NS(async_list_areas=lambda: list(AREAS))
    devices = NS(devices={d.id: d for d in DEVICES}, async_get=lambda did: None)
    entities = NS(entities=ENTITIES, async_get=lambda eid: ENTITIES.get(eid))

    async def _resolver(_hass):
        return resolver_box[0]

    saved = (_bl._now, _bl.time, SB.time, SB._time, sys.modules.get("habluetooth"))
    _bl._now = clock.now
    _bl.time = SB.time = SB._time = clock          # type: ignore[assignment]
    sys.modules["habluetooth"] = NS(get_manager=lambda: manager)   # type: ignore[assignment]
    try:
        with ExitStack() as stack:
            for target, name, stand_in in (
                (SB.area_registry, "async_get", lambda _h: areas),
                (SB.device_registry, "async_get", lambda _h: devices),
                (SB.entity_registry, "async_get", lambda _h: entities),
                (sys.modules["homeassistant.components"], "bluetooth",
                 NS(async_current_scanners=lambda _h: list(scanners))),
                (SB.dt_util, "utcnow", clock.now),
                (SB, "get_bluetooth_live", lambda _h: bl_box[0]),
                (SB, "_get_ble_resolver", _resolver),
            ):
                stack.enter_context(patch.object(target, name, stand_in))
            stack.enter_context(patch("time.time", clock.time))
            yield
    finally:
        _bl._now, _bl.time, SB.time, SB._time = saved[0], saved[1], saved[2], saved[3]
        if saved[4] is None:
            sys.modules.pop("habluetooth", None)
        else:
            sys.modules["habluetooth"] = saved[4]


def _hear(h: dict, clock: sim.Clock, scanners: dict[str, Any], bl: Any) -> None:
    """One advert, as each receiver that heard it reports it."""
    for n, (source, rssi) in enumerate(h["heard_by"].items()):
        clock.t = h["t"] + 0.001 * n
        mono = clock.monotonic()
        fields = dict(rssi=rssi, tx_power=h["tx_power"], service_uuids=list(h["service_uuids"]),
                      service_data=dict(h["service_data"]), manufacturer_data=dict(h["manufacturer_data"]))
        sc = scanners.get(source)
        if sc is not None:
            sc.discovered_devices_and_advertisement_data[h["address"]] = (
                NS(address=h["address"], name=h["name"], details={}), NS(local_name=h["name"], **fields))
            sc.discovered_device_timestamps[h["address"]] = mono
        bl._on_adv(NS(address=h["address"], time=mono, source=source, name=h["name"],
                      connectable=h["connectable"], device=None, **fields))


def run() -> list[dict[str, Any]]:
    """The six builds; one record each."""
    from tests import golden_tools as gt
    clock = sim.Clock()
    scanners = {KITCHEN: ESPHomeScanner(KITCHEN, "Kitchen Proxy", "active"),
                LOUNGE: ESPHomeScanner(LOUNGE, "lounge-proxy"),
                OFFICE: HaScanner(OFFICE, "hci0 (" + OFFICE + ")")}
    manager = sim.FakeManager(list(scanners.values()))
    hass, stores = _house()
    resolver = PrivateBLEResolver(hass)
    resolver._devices = [{"canonical_id": "irk:" + _IRK.hex(), "name": "Private phone", "irk_bytes": _IRK}]
    bl_box: list = [None]
    records: list[dict[str, Any]] = []
    loop = asyncio.new_event_loop()
    try:
        with _pinned(clock, manager, list(scanners.values()), bl_box, [resolver]):
            bl = bl_box[0] = _bl.BluetoothLive(hass)
            todo = list(HEARD)
            for at in BUILD_AT:
                while todo and todo[0]["t"] <= at:
                    _hear(todo.pop(0), clock, scanners, bl)
                clock.t = at
                snap = loop.run_until_complete(SB._build_live_snapshot(hass))
                dom = hass.data[DOMAIN]
                records.append(gt.plain({
                    "at_s": at,
                    "snapshot": snap,
                    "kept_for_the_next_build": {
                        "object_history": dom.get(DATA_OBJECT_HISTORY),
                        "beacon_last_addresses": dom.get(DATA_BEACON_LAST_MACS),
                        "find_my_links": dom[SB._FINDMY].to_state(),
                        "name_links": dom[SB._LABEL_LINKS].to_state(),
                        "saved_files": {name: {"saves": d.saves, "saved": d.saved} for name, d in stores.items()},
                    },
                }))
    finally:
        loop.close()
    return records


def counts(records: list[dict[str, Any]]) -> dict[str, Any]:
    objs = [len(r["snapshot"]["objects"]["list"]) for r in records]
    return {"builds": len(records), "objects_per_build": objs,
            "adverts_per_build": [len(r["snapshot"]["ble"]["advertisements"]) for r in records],
            "object_keys": len({o["key"] for r in records for o in r["snapshot"]["objects"]["list"]})}


def label(record: dict[str, Any]) -> str:
    return f'(the build at {record["at_s"]:.0f} s)'
