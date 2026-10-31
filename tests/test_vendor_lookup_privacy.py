"""The device maker (vendor) lookup's privacy rules: an allowlist.

It sends only the first three bytes of an address, and only for devices a
Bluetooth receiver confirms have a fixed, maker-assigned address (ESPHome
proxies and Home Assistant's own Bluetooth say so; Shelly, ESPresense and
Tasmota don't, so devices only they hear aren't looked up).

Random or unknown is never sent, whatever the bits; the bits only hold back
more. A confirmed public address is kept in .storage, through prunes and
restarts. Anything else gets the answer kept for its prefix, if there is one.
On by default, admin-only, cached by prefix, and the switch is reported as
on/off only.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import vendor_lookup as VL
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_settings_store import _make_settings


class _Resp:
    def __init__(self, status: int, text: str = "", js=None) -> None:
        self.status = status
        self._text = text
        self._js = js

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def text(self) -> str:
        return self._text

    async def json(self, content_type=None):
        return self._js


class _Session:
    """Records every URL asked for; answers like the two services."""

    def __init__(self) -> None:
        self.urls: list[str] = []

    def get(self, url: str, timeout=None):
        self.urls.append(url)
        if "macvendors" in url:
            return _Resp(200, "Apple, Inc.")
        return _Resp(200, js={"company": "Apple, Inc.", "found": True, "success": True,
                              "isRand": False, "isPrivate": False})


class _Cache:
    def __init__(self) -> None:
        self.entries: dict[str, dict] = {}

    def get(self, prefix):
        return self.entries.get(prefix)

    def set(self, prefix, entry):
        self.entries[prefix] = entry

    async def async_save(self):
        return None


@pytest.fixture
def online(monkeypatch):
    session = _Session()
    cache = _Cache()
    monkeypatch.setattr(VL, "async_get_clientsession", lambda hass: session)

    async def _no_wait(hass, provider):
        return None

    async def _get_cache(hass):
        return cache

    monkeypatch.setattr(VL, "_throttle", _no_wait)
    monkeypatch.setattr(VL, "_get_cache", _get_cache)
    return session, cache


def _hass(settings: dict | None = None):
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    if settings is not None:
        st = MagicMock()
        st.get = lambda k, d=None: settings.get(k, d)
        hass.data[DOMAIN][DATA_SETTINGS] = st
    return hass



RANDOM_STATIC = "C4:11:22:33:44:55"  # 0xC4: bits 0x01 and 0x02 clear, so the bits would let it through
PUBLIC = "F0:18:98:12:34:56"


def _keep(cache, prefix="C4:11:22", maker="Kept, Inc."):
    """An answer the 30-day cache already holds for the prefix."""
    import datetime as dt

    cache.set(prefix, {"fetched_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                       "found": True, "sources": {"macvendors": maker, "maclookup": None}})


# ── The lookup itself ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_confirmed_public_address_sends_only_its_first_three_bytes(online) -> None:
    session, _ = online
    out = await VL.async_lookup_vendor(_hass(), "f0:18:98:12:34:56", address_type="public")
    assert out["found"] is True and out["skipped"] is None
    assert len(session.urls) == 2
    for url in session.urls:
        assert url.endswith("/F0:18:98"), url
        assert "12:34:56" not in url and "123456" not in url


@pytest.mark.asyncio
@pytest.mark.parametrize("first", ["40", "7C", "C0", "C4", "F0", "00"])
async def test_an_unconfirmed_address_is_never_sent_whatever_its_bits(online, first) -> None:
    session, cache = online
    out = await VL.async_lookup_vendor(_hass(), f"{first}:11:22:33:44:55")
    assert out["skipped"] == "unconfirmed" and out["found"] is False
    assert session.urls == [] and cache.entries == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("first", ["40", "7C", "C0", "F4"])
async def test_a_known_random_address_is_never_sent_whatever_its_bits(online, first) -> None:
    session, cache = online
    out = await VL.async_lookup_vendor(_hass(), f"{first}:11:22:33:44:55", address_type="random")
    assert out["skipped"] == "random" and out["found"] is False
    assert session.urls == [] and cache.entries == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("mac,reason", [
    ("DA:A1:19:11:22:33", "local"),      # 0xDA has bit 0x02 set
    ("4E:12:34:56:78:9A", "local"),
    ("01:00:5E:00:00:FB", "multicast"),
    ("33:33:00:00:00:01", "multicast"),
])
@pytest.mark.parametrize("address_type", [None, "public"])
async def test_the_bits_only_hold_back_more(online, mac, reason, address_type) -> None:
    session, cache = online
    out = await VL.async_lookup_vendor(_hass(), mac, address_type=address_type)
    assert out["skipped"] == reason and session.urls == [] and cache.entries == {}


def test_skip_reason_allows_a_confirmed_public_address_only() -> None:
    assert VL.lookup_skip_reason("F0:18:98:12:34:56", "public") is None
    assert VL.lookup_skip_reason("F0:18:98:12:34:56") == "unconfirmed"
    assert VL.lookup_skip_reason("F0:18:98:12:34:56", "random") == "random"
    assert VL.lookup_skip_reason("02:00:00:00:00:00", "public") == "local"
    assert VL.lookup_skip_reason("03:00:00:00:00:00", "public") == "multicast"
    assert VL.lookup_skip_reason("ZZ:00:00:00:00:00", "public") == "bad_mac"


@pytest.mark.asyncio
async def test_a_known_prefix_is_answered_from_the_cache(online) -> None:
    session, _ = online
    await VL.async_lookup_vendor(_hass(), "F0:18:98:12:34:56", address_type="public")
    asked = len(session.urls)
    out = await VL.async_lookup_vendor(_hass(), "F0:18:98:AB:CD:EF", address_type="public")
    assert out["cached"] is True and out["found"] is True
    assert len(session.urls) == asked


@pytest.mark.asyncio
async def test_an_unconfirmed_address_gets_only_the_answer_kept_for_its_prefix(online) -> None:
    session, cache = online
    cache.set("C4:11:22", {"fetched_at": "2026-01-01T00:00:00Z", "found": True,
                           "sources": {"macvendors": "Old, Inc.", "maclookup": None}})
    out = await VL.async_lookup_vendor(_hass(), RANDOM_STATIC)
    assert out["skipped"] == "unconfirmed" and session.urls == []   # older than 30 days: not used
    _keep(cache)
    for force in (False, True):
        out = await VL.async_lookup_vendor(_hass(), RANDOM_STATIC, force_refresh=force)
        assert out["cached"] is True and out["skipped"] is None
        assert out["sources"]["macvendors"] == "Kept, Inc." and session.urls == []


# ── The handler ──────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_switch_decides_and_unreadable_settings_send_nothing(online, monkeypatch) -> None:
    from custom_components.padspan_ha import websocket as W
    from custom_components.padspan_ha import bluetooth_live as BL

    session, _ = online
    called = []

    async def _lookup(hass, mac, force_refresh=False, address_type=None):
        called.append((mac, address_type))
        return {}

    monkeypatch.setattr(W, "async_lookup_vendor", _lookup)
    monkeypatch.setattr(BL, "known_address_type", lambda hass, mac: "public")
    for settings in ({"vendor_lookup_enabled": False}, None):
        conn = MagicMock()
        await W.ws_vendor_lookup(_hass(settings), conn, {"id": 1, "mac": PUBLIC})
        assert conn.send_result.call_args.args[1] == {"enabled": False}
    assert called == [] and session.urls == []

    # On by default: a store without the key looks it up.
    for settings in ({}, {"vendor_lookup_enabled": True}):
        conn = MagicMock()
        await W.ws_vendor_lookup(_hass(settings), conn, {"id": 2, "mac": PUBLIC})
        assert conn.send_result.call_args.args[1]["enabled"] is True
    assert called == [(PUBLIC, "public")] * 2


@pytest.mark.asyncio
async def test_the_handler_passes_the_type_a_radio_reported(online, monkeypatch) -> None:
    from custom_components.padspan_ha import websocket as W
    from custom_components.padspan_ha import bluetooth_live as BL

    session, _ = online
    for atype, skipped, sent in (("random", "random", False), (None, "unconfirmed", False), ("public", None, True)):
        monkeypatch.setattr(BL, "known_address_type", lambda hass, mac, _t=atype: _t)
        conn = MagicMock()
        await W.ws_vendor_lookup(_hass({"vendor_lookup_enabled": True}), conn, {"id": 1, "mac": "40:11:22:33:44:55"})
        out = conn.send_result.call_args.args[1]
        assert out["skipped"] == skipped and bool(session.urls) is sent, atype


@pytest.mark.asyncio
async def test_when_the_type_cant_be_read_nothing_is_sent(online, monkeypatch) -> None:
    from custom_components.padspan_ha import websocket as W
    from custom_components.padspan_ha import bluetooth_live as BL

    session, cache = online

    def _broken(hass, mac):
        raise RuntimeError("no Bluetooth")

    monkeypatch.setattr(BL, "known_address_type", _broken)
    conn = MagicMock()
    await W.ws_vendor_lookup(_hass({"vendor_lookup_enabled": True}), conn, {"id": 1, "mac": PUBLIC})
    out = conn.send_result.call_args.args[1]
    assert out["skipped"] == "unconfirmed" and out["enabled"] is True and session.urls == []
    _keep(cache, prefix="F0:18:98", maker="Apple, Inc.")
    await W.ws_vendor_lookup(_hass({"vendor_lookup_enabled": True}), conn, {"id": 2, "mac": PUBLIC})
    out = conn.send_result.call_args.args[1]
    assert out["cached"] is True and out["sources"]["macvendors"] == "Apple, Inc." and session.urls == []


# ── What a radio says ────────────────────────────────────────────────────────


def test_the_address_type_is_read_from_esphome_and_bluez() -> None:
    from types import SimpleNamespace
    from custom_components.padspan_ha.bluetooth_live import address_type_of

    assert address_type_of(SimpleNamespace(details={"source": "x", "address_type": 1})) == "random"
    assert address_type_of(SimpleNamespace(details={"source": "x", "address_type": 0})) == "public"
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


def test_known_address_type_random_wins_across_radios(monkeypatch) -> None:
    from types import SimpleNamespace
    from custom_components.padspan_ha import bluetooth_live as BL

    bl = SimpleNamespace(_seen_by_source={
        "AA:BB:CC:DD:EE:FF": {"p1": SimpleNamespace(record={"address_type": "public"}),
                              "p2": SimpleNamespace(record={"address_type": "random"})},
        "11:22:33:44:55:66": {"p1": SimpleNamespace(record={"address_type": None})},
    })
    monkeypatch.setattr(BL, "get_bluetooth_live", lambda hass: bl)
    assert BL.known_address_type(None, "AA:BB:CC:DD:EE:FF") == "random"
    assert BL.known_address_type(None, "aa:bb:cc:dd:ee:ff") == "random"
    assert BL.known_address_type(None, "11:22:33:44:55:66") is None
    assert BL.known_address_type(None, "99:99:99:99:99:99") is None


# ── The switch ───────────────────────────────────────────────────────────────


def test_on_by_default() -> None:
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

    assert DEFAULT_SETTINGS["vendor_lookup_enabled"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", [True, False])
async def test_a_saved_choice_is_kept(stored) -> None:
    ss, _ = _make_settings(store_data={"vendor_lookup_enabled": stored, "data_mode": "live"})
    data = await ss.async_load()
    assert data["vendor_lookup_enabled"] is stored
    assert "vendor_lookup_optin_v1" not in data


def test_only_an_admin_can_change_the_switch() -> None:
    from tests.test_enhanced_security import _set

    for security_on in (False, True):
        data, conn = _set(security_on, False, vendor_lookup_enabled=False)
        conn.send_error.assert_called_once()
        # Refused either way: by this switch's own check, or first by Enhanced security's gate.
        assert conn.send_error.call_args.args[1] in ("unauthorized", "admin_only")
        assert data.get("vendor_lookup_enabled", True) is True  # nothing was saved
    data, conn = _set(False, True, vendor_lookup_enabled=False)
    conn.send_error.assert_not_called()
    assert data["vendor_lookup_enabled"] is False


def test_the_switch_is_reported_as_on_or_off_only() -> None:
    from custom_components.padspan_ha import telemetry as T

    assert "vendor_lookup_enabled" in T._FEATURE_FLAGS


# ── Through the real recording: _on_adv, the reseed, the handler ─────────────
# On HA OS, live adverts from HA's own adapter come through habluetooth's mgmt
# side channel with the BlueZ path only, no AddressType, while the reseed and
# the scanner's cache have BlueZ's. Shelly, ESPresense and Tasmota never say.


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


def _bluez(addr, address_type=None):
    """HA's own adapter's BLEDevice: from BlueZ's cache (with AddressType) or
    from the mgmt side channel (the path only)."""
    from types import SimpleNamespace

    props = {"Adapter": "/org/bluez/hci0"}
    if address_type:
        props["AddressType"] = address_type
    return SimpleNamespace(address=addr, name=None,
                           details={"path": "/org/bluez/hci0/dev_" + addr.replace(":", "_"), "props": props})


def _esphome(addr, address_type):
    from types import SimpleNamespace

    return SimpleNamespace(address=addr, name=None, details={"source": "proxy", "address_type": address_type})


def _shelly(addr):
    from types import SimpleNamespace

    return SimpleNamespace(address=addr, name=None, details={"source": "shelly"})


def _advert(addr, device, source="hci0"):
    from types import SimpleNamespace

    return SimpleNamespace(address=addr, name=None, source=source, rssi=-60, time=0, device=device,
                           manufacturer_data={}, service_data={}, service_uuids=[], tx_power=None,
                           connectable=True)


def _stack(monkeypatch, cached=None, by_address=None):
    """A BluetoothLive behind the real handler. `cached`: what the reseed reads
    from scanner hci0 ({addr: BLEDevice}). `by_address`: what the scanners' own
    caches answer when asked for one address; None leaves that out, so only
    PadSpan's own record can decide."""
    import sys
    import time
    from types import SimpleNamespace
    from custom_components.padspan_ha import bluetooth_live as BL

    adv = SimpleNamespace(rssi=-60, local_name=None, manufacturer_data={}, service_data={},
                          service_uuids=[], tx_power=None)
    cached = cached or {}
    scanner = SimpleNamespace(
        source="hci0",
        discovered_devices_and_advertisement_data={a: (d, adv) for a, d in cached.items()},
        discovered_device_timestamps={a: time.monotonic() for a in cached})
    manager = SimpleNamespace(async_current_scanners=lambda: [scanner])
    if by_address is not None:
        manager.async_scanner_devices_by_address = lambda addr, connectable: [
            SimpleNamespace(ble_device=d) for d in by_address.get(addr, [])]
    monkeypatch.setitem(sys.modules, "habluetooth", SimpleNamespace(get_manager=lambda: manager))
    hass = _hass({"vendor_lookup_enabled": True})
    bl = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    hass.data[DOMAIN][BL.DATA_KEY] = bl
    return BL, bl, hass


async def _ask(hass, mac):
    from custom_components.padspan_ha import websocket as W

    conn = MagicMock()
    await W.ws_vendor_lookup(hass, conn, {"id": 1, "mac": mac})
    return conn.send_result.call_args.args[1]


async def _never_sent_but_kept_answer_shown(hass, session, cache, mac=RANDOM_STATIC):
    out = await _ask(hass, mac)
    assert out["skipped"] in ("unconfirmed", "random") and out["found"] is False, out
    if out["skipped"] == "unconfirmed":
        _keep(cache, prefix=mac[:8])
        out = await _ask(hass, mac)
        assert out["cached"] is True and out["sources"]["macvendors"] == "Kept, Inc.", out
    assert session.urls == []


def _age(bl, addr, seconds):
    import datetime as dt

    for rec in bl._seen_by_source[addr].values():
        rec.seen = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds)


def _prune(bl, addr):
    _age(bl, addr, 5 * 3600)
    bl.cache_age_s = 4 * 3600.0
    bl.get_snapshot(max_ads=100, max_age_s=4 * 3600)
    assert addr not in bl._seen_by_source


@pytest.mark.asyncio
async def test_a_confirmed_public_address_sends_its_prefix(online, monkeypatch) -> None:
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source="proxy"))   # ESPHome: 0, public
    assert BL.known_address_type(hass, PUBLIC) == "public"
    out = await _ask(hass, PUBLIC)
    assert out["skipped"] is None and out["found"] is True
    assert session.urls and all(u.endswith("/F0:18:98") for u in session.urls)
    # HA's own adapter: BlueZ says public in the reseed's cache.
    other = "00:1A:7D:DA:71:13"
    BL, bl, hass = _stack(monkeypatch, cached={other: _bluez(other, "public")}, by_address={})
    bl._seed_from_discovered()
    bl._on_adv(_advert(other, _bluez(other)))                          # live, no type: still public
    out = await _ask(hass, other)
    assert out["skipped"] is None and session.urls[-1].endswith("/00:1A:7D")


@pytest.mark.asyncio
async def test_an_address_heard_only_by_shelly_espresense_or_tasmota_is_never_sent(online, monkeypatch) -> None:
    import datetime as dt
    from types import SimpleNamespace
    from custom_components.padspan_ha.const import DATA_ESPRESENSE_MQTT
    from custom_components.padspan_ha.tasmota_ble import DATA_TASMOTA_BLE

    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={RANDOM_STATIC: [_shelly(RANDOM_STATIC)]})
    bl._on_adv(_advert(RANDOM_STATIC, _shelly(RANDOM_STATIC), source="shelly"))
    assert BL.known_address_type(hass, RANDOM_STATIC) is None
    await _never_sent_but_kept_answer_shown(hass, session, cache)

    now = dt.datetime.now(dt.timezone.utc)
    for data_key, mac in ((DATA_ESPRESENSE_MQTT, "C8:11:22:33:44:55"), (DATA_TASMOTA_BLE, "CC:11:22:33:44:55")):
        BL, bl, hass = _stack(monkeypatch, by_address={})
        hass.data[DOMAIN][data_key] = SimpleNamespace(_seen={mac: {"node": SimpleNamespace(seen=now)}})
        await _never_sent_but_kept_answer_shown(hass, session, cache, mac=mac)


@pytest.mark.asyncio
async def test_random_then_pruned_then_heard_by_espresense_is_never_sent(online, monkeypatch) -> None:
    """The 0.38.210 review's probe: ESPHome said random, the address was
    pruned, ESPresense heard it, and C4:11:22 went to both services."""
    import datetime as dt
    from types import SimpleNamespace
    from custom_components.padspan_ha.const import DATA_ESPRESENSE_MQTT

    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source="proxy"))
    _prune(bl, RANDOM_STATIC)
    hass.data[DOMAIN][DATA_ESPRESENSE_MQTT] = SimpleNamespace(
        _seen={RANDOM_STATIC: {"espresense_hall": SimpleNamespace(seen=dt.datetime.now(dt.timezone.utc))}})
    await _never_sent_but_kept_answer_shown(hass, session, cache)


@pytest.mark.asyncio
async def test_confirmed_public_is_kept_across_a_restart(online, monkeypatch) -> None:
    from types import SimpleNamespace

    session, _ = online
    store = _Store()
    BL, bl, hass = _stack(monkeypatch, by_address={})
    await bl.async_load_public(store)
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source="proxy"))
    assert PUBLIC in (store.data or {}).get("addresses", {})
    # Restart: a new, empty BluetoothLive reads the store; the device isn't heard again.
    fresh = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    await fresh.async_load_public(_Store(store.data))
    hass.data[DOMAIN][BL.DATA_KEY] = fresh
    assert fresh._seen_by_source == {} and BL.known_address_type(hass, PUBLIC) == "public"
    out = await _ask(hass, PUBLIC)
    assert out["skipped"] is None and session.urls and all(u.endswith("/F0:18:98") for u in session.urls)
    # A radio saying random takes it out of the store.
    fresh._public_store = store
    fresh._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 1), source="proxy2"))
    assert PUBLIC not in store.data["addresses"] and BL.known_address_type(hass, PUBLIC) == "random"


@pytest.mark.asyncio
async def test_setup_reads_the_kept_public_addresses(monkeypatch) -> None:
    """async_setup_bluetooth_live loads the store (PUBLIC_ADDRESSES_STORE_KEY)."""
    import homeassistant.helpers.storage as hs
    from types import SimpleNamespace
    from custom_components.padspan_ha import bluetooth_live as BL
    from custom_components.padspan_ha.const import PUBLIC_ADDRESSES_STORE_KEY

    opened = []

    def _store(hass, version, key):
        opened.append(key)
        return _Store({"addresses": {PUBLIC: 1761900000}})

    monkeypatch.setattr(hs, "Store", _store)
    hass = SimpleNamespace(data={DOMAIN: {}})
    bl = await BL.async_setup_bluetooth_live(hass)
    assert opened == [PUBLIC_ADDRESSES_STORE_KEY] and bl._public == {PUBLIC: 1761900000}


@pytest.mark.asyncio
async def test_a_confirmed_public_address_is_looked_up_however_long_ago_it_was_heard(online, monkeypatch) -> None:
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(PUBLIC, _esphome(PUBLIC, 0), source="proxy"))
    _prune(bl, PUBLIC)                       # a tagged row from the history, 5 h on
    out = await _ask(hass, PUBLIC)
    assert out["skipped"] is None and session.urls and all(u.endswith("/F0:18:98") for u in session.urls)


def test_the_kept_public_addresses_are_capped_oldest_first(monkeypatch) -> None:
    import time

    BL, bl, hass = _stack(monkeypatch)
    monkeypatch.setattr(BL, "PUBLIC_MAX", 10)
    base = int(time.time()) - 1000
    for n in range(12):
        bl._public[f"00:1A:7D:00:00:{n:02X}"] = base + n
    bl._save_public()
    assert len(bl._public) == 9 and "00:1A:7D:00:00:00" not in bl._public and "00:1A:7D:00:00:0B" in bl._public


@pytest.mark.asyncio
async def test_a_live_advert_without_a_type_keeps_the_reseeds_random(online, monkeypatch) -> None:
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, cached={RANDOM_STATIC: _bluez(RANDOM_STATIC, "random")})
    bl._seed_from_discovered()                                # BlueZ: random
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))  # the mgmt side channel: no type
    assert BL.known_address_type(hass, RANDOM_STATIC) == "random"
    out = await _ask(hass, RANDOM_STATIC)
    assert out["skipped"] == "random" and session.urls == []


@pytest.mark.asyncio
async def test_a_reseed_without_a_type_keeps_a_live_adverts_random(online, monkeypatch) -> None:
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, cached={RANDOM_STATIC: _bluez(RANDOM_STATIC)})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC, "random")))  # live, with BlueZ's type
    bl._seed_from_discovered()                                          # the same radio, no type
    assert bl._seen_by_source[RANDOM_STATIC]["hci0"].record["address_type"] is None
    assert BL.known_address_type(hass, RANDOM_STATIC) == "random"
    out = await _ask(hass, RANDOM_STATIC)
    assert out["skipped"] == "random" and session.urls == []


@pytest.mark.asyncio
async def test_the_scanners_own_caches_are_read_too(online, monkeypatch) -> None:
    """First heard on HA's own adapter (no type), asked about before any
    reseed: the scanner's BlueZ cache already says which kind it is."""
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, by_address={RANDOM_STATIC: [_bluez(RANDOM_STATIC, "random")],
                                                   PUBLIC: [_bluez(PUBLIC, "public")]})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))
    assert bl._address_types == {}
    out = await _ask(hass, RANDOM_STATIC)
    assert out["skipped"] == "random" and session.urls == []
    out = await _ask(hass, PUBLIC)                      # never heard by PadSpan; BlueZ says public
    assert out["skipped"] is None and session.urls


def test_random_is_never_downgraded_and_goes_with_the_address(monkeypatch) -> None:
    import datetime as dt

    BL, bl, hass = _stack(monkeypatch)
    a, b = RANDOM_STATIC, "C8:11:22:33:44:55"
    bl._on_adv(_advert(a, _esphome(a, 1), source="proxy"))
    bl._on_adv(_advert(a, _esphome(a, 0), source="proxy"))  # a later "public" doesn't undo it
    bl._on_adv(_advert(a, _bluez(a)))
    bl._on_adv(_advert(b, _esphome(b, 0), source="proxy"))
    bl._on_adv(_advert(b, _bluez(b)))                        # no type: public stays
    assert bl._address_types == {a: "random", b: "public"} and set(bl._public) == {b}
    assert BL.known_address_type(hass, a.lower()) == "random"
    assert BL.known_address_type(hass, a.replace(":", "-")) == "random"
    assert BL.known_address_type(hass, b) == "public"
    # One radio's records going doesn't forget it; the address leaving the cache does.
    bl.clear_scanner("proxy")
    assert BL.known_address_type(hass, a) == "random"
    bl.clear_scanner("hci0")
    assert a not in bl._address_types and BL.known_address_type(hass, a) is None
    assert BL.known_address_type(hass, b) == "public"        # kept: public never changes
    # The age prune too.
    bl._on_adv(_advert(a, _esphome(a, 1), source="proxy"))
    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)
    for src_map in bl._seen_by_source.values():
        for rec in src_map.values():
            rec.seen = old
    bl.cache_age_s = 60.0
    bl.get_snapshot(max_ads=100, max_age_s=60)
    assert bl._seen_by_source == {} and bl._address_types == {} and set(bl._public) == {b}


@pytest.mark.asyncio
async def test_an_address_pruned_from_the_live_cache_is_never_sent(online, monkeypatch) -> None:
    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source="proxy"))
    _prune(bl, RANDOM_STATIC)
    assert bl._address_types == {}                       # "random" went with it
    await _never_sent_but_kept_answer_shown(hass, session, cache)


@pytest.mark.asyncio
async def test_after_a_restart_a_row_left_in_history_is_never_sent(online, monkeypatch) -> None:
    import time
    from types import SimpleNamespace

    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source="proxy"))
    # Restart: a new, empty cache; the row is still in the object history, and
    # HA replays its last advert from 17 minutes ago, without a type.
    fresh = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    hass.data[DOMAIN][BL.DATA_KEY] = fresh
    replayed = _advert(RANDOM_STATIC, _bluez(RANDOM_STATIC))
    replayed.time = time.monotonic() - 1020.0
    fresh._on_adv(replayed)
    assert BL.known_address_type(hass, RANDOM_STATIC) is None
    await _never_sent_but_kept_answer_shown(hass, session, cache)


@pytest.mark.asyncio
async def test_a_tagged_row_older_than_4_hours_is_never_sent(online, monkeypatch) -> None:
    """Tagged rows never leave the history. Here its last report, without a
    type, is even still in the live cache (no snapshot has pruned it yet)."""
    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))
    _age(bl, RANDOM_STATIC, 4 * 3600 + 600)
    await _never_sent_but_kept_answer_shown(hass, session, cache)
