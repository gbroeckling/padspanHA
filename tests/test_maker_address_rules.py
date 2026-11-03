# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What a radio says about an address, which decides what the built-in maker
list may say about it.

A radio must confirm an address is public (ESPHome proxies from firmware 2022.12
and Home Assistant's own Bluetooth say so; Shelly, ESPresense and Tasmota don't)
before the list counts as fact; a confirmed public address is kept in .storage,
through prunes and restarts; a random report wins and is never downgraded. With
no word from a radio, a match is only "probably".

Carried over from the online lookup's privacy tests: the same recording, now
deciding a label instead of what is sent.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import ble_enrichment as BE
from custom_components.padspan_ha import device_tables as DT
from custom_components.padspan_ha.const import DOMAIN

RANDOM_STATIC = "C4:11:22:33:44:55"  # 0xC4: bits 0x01 and 0x02 clear, so the bits would let it through
PUBLIC = "F0:18:98:12:34:56"
PROXY = "AA:BB:CC:00:00:01"  # an ESPHome proxy's scanner source: its Bluetooth MAC


@pytest.fixture(autouse=True)
def _every_address_in_a_block(monkeypatch):
    """So only the rule decides, not whether a test address happens to be listed."""
    monkeypatch.setattr(DT, "address_maker", lambda address: "Maker")


def _label(bl, mac, said=None):
    """What the snapshot's maker pass makes of this address: (fact, probably)."""
    o = {"company_name": None}
    kinds = (said, bl.known_type(mac))
    BE.apply_address_maker(o, mac, "random" if "random" in kinds else "public" if "public" in kinds else None)
    return o["company_name"], o.get("maker_guess")


class _Store:
    """Stand-in for HA's Store: what was saved is what loads."""

    def __init__(self, data=None) -> None:
        self.data = data
        self.saves = 0

    async def async_load(self):
        return self.data

    def async_delay_save(self, func, delay) -> None:
        self.data = func()
        self.saves += 1
        self.delays = getattr(self, "delays", []) + [delay]

    async def async_save(self, data) -> None:
        self.data = data
        self.saved_at_once = getattr(self, "saved_at_once", 0) + 1

    async def async_remove(self) -> None:
        self.data = None
        self.removed = True


def _bluez(addr, address_type=None):
    """HA's own adapter's BLEDevice: from BlueZ's cache (with AddressType) or
    from the mgmt side channel (the path only)."""
    props = {"Adapter": "/org/bluez/hci0"}
    if address_type:
        props["AddressType"] = address_type
    return SimpleNamespace(address=addr, name=None,
                           details={"path": "/org/bluez/hci0/dev_" + addr.replace(":", "_"), "props": props})


def _esphome(addr, address_type, source=PROXY):
    return SimpleNamespace(address=addr, name=None, details={"source": source, "address_type": address_type})


def _shelly(addr):
    return SimpleNamespace(address=addr, name=None, details={"source": "shelly"})


def _advert(addr, device, source="hci0"):
    return SimpleNamespace(address=addr, name=None, source=source, rssi=-60, time=0, device=device,
                           manufacturer_data={}, service_data={}, service_uuids=[], tx_power=None,
                           connectable=True)


def _stack(monkeypatch, cached=None, esphome_version="2024.6.0"):
    """A real BluetoothLive. `cached`: what the reseed reads from scanner hci0
    ({addr: BLEDevice}). `esphome_version`: the firmware of the ESPHome proxy
    PROXY, kept as bleak-esphome keeps it (None: not known)."""
    import functools
    import sys
    import time
    from custom_components.padspan_ha import bluetooth_live as BL

    adv = SimpleNamespace(rssi=-60, local_name=None, manufacturer_data={}, service_data={},
                          service_uuids=[], tx_power=None)
    cached = cached or {}
    scanner = SimpleNamespace(
        source="hci0",
        discovered_devices_and_advertisement_data={a: (d, adv) for a, d in cached.items()},
        discovered_device_timestamps={a: time.monotonic() for a in cached})
    client_data = SimpleNamespace(device_info=SimpleNamespace(esphome_version=esphome_version))
    proxy = SimpleNamespace(
        source=PROXY, discovered_devices_and_advertisement_data={}, discovered_device_timestamps={},
        connector=SimpleNamespace(client=functools.partial(object, client_data=client_data)))
    manager = SimpleNamespace(async_current_scanners=lambda: [scanner, proxy])
    monkeypatch.setitem(sys.modules, "habluetooth", SimpleNamespace(get_manager=lambda: manager))
    return BL, BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))


def _age(bl, addr, seconds):
    import datetime as dt

    for rec in bl._seen_by_source[addr].values():
        rec.seen = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds)


def _prune(bl, addr):
    _age(bl, addr, 5 * 3600)
    bl.cache_age_s = 4 * 3600.0
    bl.get_snapshot(max_ads=100, max_age_s=4 * 3600)
    assert addr not in bl._seen_by_source


# ── What a radio says ───────────────────────────────────────────────────────

def test_the_address_type_is_read_from_esphome_and_bluez() -> None:
    from custom_components.padspan_ha.bluetooth_live import address_type_of

    assert address_type_of(SimpleNamespace(details={"source": "x", "address_type": 1})) == "random"
    # ESPHome's 0 is protobuf's empty value too: public only from firmware that sends the type.
    zero = SimpleNamespace(details={"source": "x", "address_type": 0})
    assert address_type_of(zero) is None
    assert address_type_of(zero, lambda source: source == "x") == "public"
    assert address_type_of(zero, lambda source: False) is None
    # ESP-IDF's resolvable private kinds: random on the air.
    assert address_type_of(SimpleNamespace(details={"address_type": 2})) == "random"
    assert address_type_of(SimpleNamespace(details={"address_type": 3})) == "random"
    assert address_type_of(SimpleNamespace(details={"address_type": 4})) is None
    assert address_type_of(SimpleNamespace(details={"path": "/org/bluez", "props": {"AddressType": "random"}})) == "random"
    assert address_type_of(SimpleNamespace(details={"props": {"AddressType": "public"}})) == "public"
    assert address_type_of(SimpleNamespace(details={"address_type": True})) is None
    assert address_type_of(SimpleNamespace(details={"source": "shelly"})) is None
    assert address_type_of(SimpleNamespace(details={})) is None
    assert address_type_of(SimpleNamespace(details=None)) is None
    assert address_type_of(None) is None


# ── Through the real recording: _on_adv and the reseed ──────────────────────
# On HA OS, live adverts from HA's own adapter come through habluetooth's mgmt
# side channel with the BlueZ path only, no AddressType, while the reseed and
# the scanner's cache have BlueZ's. Shelly, ESPresense and Tasmota never say.

def test_a_confirmed_public_address_is_fact(monkeypatch) -> None:
    BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source=PROXY))   # ESPHome: 0, public
    assert bl.known_type(PUBLIC) == "public" and _label(bl, PUBLIC) == ("Maker", None)
    # HA's own adapter: BlueZ says public in the reseed's cache.
    other = "00:1A:7D:DA:71:13"
    BL, bl = _stack(monkeypatch, cached={other: _bluez(other, "public")})
    bl._seed_from_discovered()
    bl._on_adv(_advert(other, _bluez(other)))                          # live, no type: still public
    assert _label(bl, other) == ("Maker", None)


def test_an_address_heard_only_by_shelly_is_only_probably(monkeypatch) -> None:
    BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(RANDOM_STATIC, _shelly(RANDOM_STATIC), source="shelly"))
    assert bl.known_type(RANDOM_STATIC) is None and _label(bl, RANDOM_STATIC) == (None, "Maker")


@pytest.mark.asyncio
async def test_confirmed_public_is_kept_across_a_restart(monkeypatch) -> None:
    store = _Store()
    BL, bl = _stack(monkeypatch)
    await bl.async_load_public(store)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source=PROXY))
    assert PUBLIC in (store.data or {}).get("addresses", {})
    # Restart: a new, empty BluetoothLive reads the store; the device isn't heard again.
    fresh = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    await fresh.async_load_public(_Store(store.data))
    assert fresh._seen_by_source == {} and _label(fresh, PUBLIC) == ("Maker", None)
    # A radio saying random takes it out of the store.
    fresh._public_store = store
    fresh._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 1, source="AA:BB:CC:00:00:02"), source="AA:BB:CC:00:00:02"))
    assert PUBLIC not in store.data["addresses"] and fresh.known_type(PUBLIC) == "random"
    assert _label(fresh, PUBLIC) == (None, None)


@pytest.mark.asyncio
async def test_setup_reads_the_kept_addresses_and_removes_the_old_lookups_answers(monkeypatch) -> None:
    import homeassistant.helpers.storage as hs
    from custom_components.padspan_ha import bluetooth_live as BL
    from custom_components.padspan_ha.const import PUBLIC_ADDRESSES_STORE_KEY, VENDOR_CACHE_STORE_KEY

    opened = {}

    def _store(hass, version, key):
        opened[key] = _Store({"rule": BL.PUBLIC_STORE_RULE, "addresses": {PUBLIC: 1761900000}})
        return opened[key]

    monkeypatch.setattr(hs, "Store", _store)
    bl = await BL.async_setup_bluetooth_live(SimpleNamespace(data={DOMAIN: {}}))
    assert bl._public == {PUBLIC: 1761900000}
    assert opened[VENDOR_CACHE_STORE_KEY].removed is True
    assert not getattr(opened[PUBLIC_ADDRESSES_STORE_KEY], "removed", False)


def test_a_confirmed_public_address_is_fact_however_long_ago_it_was_heard(monkeypatch) -> None:
    BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source=PROXY))
    _prune(bl, PUBLIC)                       # a tagged row from the history, 5 h on
    assert _label(bl, PUBLIC) == ("Maker", None)


def test_the_kept_public_addresses_are_capped_oldest_first(monkeypatch) -> None:
    import time

    BL, bl = _stack(monkeypatch)
    monkeypatch.setattr(BL, "PUBLIC_MAX", 10)
    base = int(time.time()) - 1000
    for n in range(12):
        bl._public[f"00:1A:7D:00:00:{n:02X}"] = base + n
    bl._save_public()
    assert len(bl._public) == 9 and "00:1A:7D:00:00:00" not in bl._public and "00:1A:7D:00:00:0B" in bl._public


def test_a_live_advert_without_a_type_keeps_the_reseeds_random(monkeypatch) -> None:
    BL, bl = _stack(monkeypatch, cached={RANDOM_STATIC: _bluez(RANDOM_STATIC, "random")})
    bl._seed_from_discovered()                                # BlueZ: random
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))  # the mgmt side channel: no type
    assert bl.known_type(RANDOM_STATIC) == "random" and _label(bl, RANDOM_STATIC) == (None, None)


def test_a_reseed_without_a_type_keeps_a_live_adverts_random(monkeypatch) -> None:
    BL, bl = _stack(monkeypatch, cached={RANDOM_STATIC: _bluez(RANDOM_STATIC)})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC, "random")))  # live, with BlueZ's type
    bl._seed_from_discovered()                                          # the same radio, no type
    assert bl._seen_by_source[RANDOM_STATIC]["hci0"].record["address_type"] is None
    assert bl.known_type(RANDOM_STATIC) == "random" and _label(bl, RANDOM_STATIC) == (None, None)


def test_random_is_never_downgraded_and_goes_with_the_address(monkeypatch) -> None:
    import datetime as dt

    BL, bl = _stack(monkeypatch)
    a, b = RANDOM_STATIC, "C8:11:22:33:44:55"
    bl._on_adv(_advert(a, _esphome(a, 1), source=PROXY))
    bl._on_adv(_advert(a, _esphome(a, 0), source=PROXY))  # a later "public" doesn't undo it
    bl._on_adv(_advert(a, _bluez(a)))
    bl._on_adv(_advert(b, _esphome(b, 0), source=PROXY))
    bl._on_adv(_advert(b, _bluez(b)))                        # no type: public stays
    assert bl._address_types == {a: "random", b: "public"} and set(bl._public) == {b}
    assert bl.known_type(a) == "random" and bl.known_type(b) == "public"
    # One radio's records going doesn't forget it; the address leaving the cache does.
    bl.clear_scanner(PROXY)
    assert bl.known_type(a) == "random"
    bl.clear_scanner("hci0")
    assert a not in bl._address_types and bl.known_type(a) is None
    assert bl.known_type(b) == "public"        # kept: public never changes
    # The age prune too.
    bl._on_adv(_advert(a, _esphome(a, 1), source=PROXY))
    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)
    for src_map in bl._seen_by_source.values():
        for rec in src_map.values():
            rec.seen = old
    bl.cache_age_s = 60.0
    bl.get_snapshot(max_ads=100, max_age_s=60)
    assert bl._seen_by_source == {} and bl._address_types == {} and set(bl._public) == {b}


def test_random_then_pruned_stays_random_on_the_object(monkeypatch) -> None:
    """The radio's word leaves the live cache with the address. The object's
    history keeps it (snapshot_builder), and that decides."""
    BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source=PROXY))
    _prune(bl, RANDOM_STATIC)
    assert bl._address_types == {} and bl.known_type(RANDOM_STATIC) is None
    assert _label(bl, RANDOM_STATIC, said="random") == (None, None)


@pytest.mark.asyncio
async def test_after_a_restart_a_row_with_no_word_is_only_probably(monkeypatch) -> None:
    """HA replays the last advert without a type. Fact needs a radio's word."""
    import time

    BL, bl = _stack(monkeypatch)
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source=PROXY))
    fresh = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    replayed = _advert(RANDOM_STATIC, _bluez(RANDOM_STATIC))
    replayed.time = time.monotonic() - 1020.0
    fresh._on_adv(replayed)
    assert fresh.known_type(RANDOM_STATIC) is None
    assert _label(fresh, RANDOM_STATIC)[0] is None


# ── ESPHome's 0 only from firmware that sends the type (0.38.212) ───────────
# 0 is also protobuf's empty value: ESPHome before 2022.12.0 (esphome#4115)
# sends no address type, HA still takes its adverts, and 0.38.211 stored every
# address such a proxy heard, random ones too, as confirmed public.

@pytest.mark.parametrize("version", ["2022.11.5", "2022.12.0-dev", "1.15.0", None])
def test_an_old_esphome_proxy_confirms_nothing(monkeypatch, version) -> None:
    BL, bl = _stack(monkeypatch, esphome_version=version)
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 0), source=PROXY))
    bl._seed_from_discovered()
    assert bl._public == {} and bl._address_types == {}
    assert bl.known_type(RANDOM_STATIC) is None and _label(bl, RANDOM_STATIC) == (None, "Maker")


@pytest.mark.parametrize("version", ["2022.12.0", "2022.12.0b1", "2023.1.0-dev", "2025.10.2"])
def test_an_esphome_proxy_from_2022_12_is_trusted(monkeypatch, version) -> None:
    BL, bl = _stack(monkeypatch, esphome_version=version)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source=PROXY))
    assert set(bl._public) == {PUBLIC} and _label(bl, PUBLIC) == ("Maker", None)


def test_the_proxy_version_is_read_from_its_scanner_or_its_config_entry(monkeypatch) -> None:
    BL, bl = _stack(monkeypatch, esphome_version="2024.6.0")
    assert BL.esphome_version(SimpleNamespace(), PROXY.lower()) == "2024.6.0"
    # No scanner holds it: HA's ESPHome config entry (runtime_data.device_info).
    BL, bl = _stack(monkeypatch, esphome_version=None)
    di = SimpleNamespace(mac_address="AA:BB:CC:00:00:00", bluetooth_mac_address=PROXY, esphome_version="2022.11.5")
    entries = [SimpleNamespace(runtime_data=None), SimpleNamespace(runtime_data=SimpleNamespace(device_info=di))]
    ha = SimpleNamespace(config_entries=SimpleNamespace(async_entries=lambda domain: entries if domain == "esphome" else []))
    assert BL.esphome_version(ha, PROXY) == "2022.11.5"
    assert BL.esphome_version(ha, "AA:BB:CC:00:00:00") == "2022.11.5"   # the network MAC as the source
    assert BL.esphome_version(ha, "AA:BB:CC:00:00:09") is None
    assert BL.esphome_version(SimpleNamespace(), PROXY) is None
    for v, ok in (("2022.11.5", False), ("2022.12.0", True), ("2022.12.0-dev", False), ("2024.6.0", True),
                  ("", False), (None, False), ("garbage", False)):
        assert BL.esphome_sends_address_type(v) is ok, v


def test_the_proxy_version_is_asked_again_soon(monkeypatch) -> None:
    import time

    BL, bl = _stack(monkeypatch, esphome_version=None)
    t0 = time.monotonic()
    monkeypatch.setattr(time, "monotonic", lambda: t0)
    assert bl._esphome_public_ok(PROXY) is False
    BL2, bl2 = _stack(monkeypatch, esphome_version="2024.6.0")   # the proxy connects
    bl2._esphome_ok_cache = bl._esphome_ok_cache
    assert bl2._esphome_public_ok(PROXY) is False                     # cached for a minute
    monkeypatch.setattr(time, "monotonic", lambda: t0 + 61)
    assert bl2._esphome_public_ok(PROXY) is True


@pytest.mark.asyncio
async def test_a_file_from_0_38_211_is_not_read() -> None:
    from custom_components.padspan_ha import bluetooth_live as BL

    bl = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    await bl.async_load_public(_Store({"addresses": {RANDOM_STATIC: 1761900000}}))   # no "rule"
    assert bl._public == {}
    await bl.async_load_public(_Store({"rule": BL.PUBLIC_STORE_RULE, "addresses": {PUBLIC: 1761900000}}))
    assert bl._public == {PUBLIC: 1761900000}


@pytest.mark.asyncio
async def test_a_random_report_takes_it_out_of_memory_and_the_file(monkeypatch) -> None:
    """Both, not one: left in memory, it would read as fact again once "random"
    left with the address; left in the file, after the next restart."""
    store = _Store()
    BL, bl = _stack(monkeypatch)
    await bl.async_load_public(store)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source=PROXY))
    assert PUBLIC in bl._public and PUBLIC in store.data["addresses"]
    bl._on_adv(_advert(PUBLIC, _bluez(PUBLIC, "random")))
    assert PUBLIC not in bl._public, "left in memory"
    assert PUBLIC not in store.data["addresses"], "left in the file"
    _prune(bl, PUBLIC)                                  # "random" leaves with the address
    assert bl.known_type(PUBLIC) is None and _label(bl, PUBLIC)[0] is None
    fresh = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))   # and after a restart
    await fresh.async_load_public(_Store(store.data))
    assert fresh._public == {}


@pytest.mark.asyncio
async def test_a_removal_is_saved_at_once_and_an_addition_within_a_minute(monkeypatch) -> None:
    import asyncio

    store = _Store()
    BL, bl = _stack(monkeypatch)
    tasks = []
    bl.hass = SimpleNamespace(data={DOMAIN: {}}, async_create_task=lambda coro: tasks.append(asyncio.ensure_future(coro)))
    await bl.async_load_public(store)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source=PROXY))
    assert store.delays == [60] and not getattr(store, "saved_at_once", 0)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 1, source="AA:BB:CC:00:00:02"), source="AA:BB:CC:00:00:02"))
    await asyncio.gather(*tasks)
    assert store.saved_at_once == 1 and store.data["addresses"] == {} and store.delays == [60]
