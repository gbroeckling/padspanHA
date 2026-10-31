"""The device maker (vendor) lookup's privacy rules.

First three bytes only; never addresses known to be random or locally
administered. A radio's reported type wins (ESPHome, BlueZ); with no type, the
first byte's bits decide. On by default, admin-only, cached by prefix, and the
switch is reported as on/off only.
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


@pytest.mark.asyncio
async def test_only_the_maker_prefix_is_sent(online) -> None:
    session, _ = online
    out = await VL.async_lookup_vendor(_hass(), "f0:18:98:12:34:56")
    assert out["found"] is True and out["skipped"] is None
    assert len(session.urls) == 2
    for url in session.urls:
        assert url.endswith("/F0:18:98"), url
        assert "12:34:56" not in url and "123456" not in url


@pytest.mark.asyncio
@pytest.mark.parametrize("mac,reason", [
    ("DA:A1:19:11:22:33", "local"),      # 0xDA has bit 0x02 set: a random address
    ("4E:12:34:56:78:9A", "local"),
    ("01:00:5E:00:00:FB", "multicast"),  # group address
    ("33:33:00:00:00:01", "multicast"),
])
async def test_random_and_group_addresses_are_never_sent(online, mac, reason) -> None:
    session, cache = online
    out = await VL.async_lookup_vendor(_hass(), mac)
    assert out["skipped"] == reason and out["found"] is False
    assert session.urls == []
    assert cache.entries == {}


def test_skip_reason_reads_the_first_byte_only() -> None:
    assert VL.lookup_skip_reason("F0:18:98:12:34:56") is None
    assert VL.lookup_skip_reason("00:1A:7D:DA:71:13") is None
    assert VL.lookup_skip_reason("02:00:00:00:00:00") == "local"
    assert VL.lookup_skip_reason("03:00:00:00:00:00") == "multicast"
    assert VL.lookup_skip_reason("ZZ:00:00:00:00:00") == "bad_mac"


@pytest.mark.asyncio
async def test_a_known_prefix_is_answered_from_the_cache(online) -> None:
    session, _ = online
    await VL.async_lookup_vendor(_hass(), "F0:18:98:12:34:56")
    asked = len(session.urls)
    out = await VL.async_lookup_vendor(_hass(), "F0:18:98:AB:CD:EF")
    assert out["cached"] is True and out["found"] is True
    assert len(session.urls) == asked


@pytest.mark.asyncio
async def test_the_switch_decides_and_unreadable_settings_send_nothing(online, monkeypatch) -> None:
    from custom_components.padspan_ha import websocket as W
    from custom_components.padspan_ha import bluetooth_live as BL

    session, _ = online
    called = []

    async def _lookup(hass, mac, force_refresh=False, address_type=None, cached_only=False):
        called.append((mac, address_type))
        return {}

    monkeypatch.setattr(W, "async_lookup_vendor", _lookup)
    monkeypatch.setattr(BL, "known_address_type", lambda hass, mac: None)
    for settings in ({"vendor_lookup_enabled": False}, None):
        conn = MagicMock()
        await W.ws_vendor_lookup(_hass(settings), conn, {"id": 1, "mac": "F0:18:98:12:34:56"})
        assert conn.send_result.call_args.args[1] == {"enabled": False}
    assert called == [] and session.urls == []

    # On by default: a store without the key looks it up.
    for settings in ({}, {"vendor_lookup_enabled": True}):
        conn = MagicMock()
        await W.ws_vendor_lookup(_hass(settings), conn, {"id": 2, "mac": "F0:18:98:12:34:56"})
        assert conn.send_result.call_args.args[1]["enabled"] is True
    assert called == [("F0:18:98:12:34:56", None)] * 2


@pytest.mark.asyncio
async def test_the_handler_passes_the_type_a_radio_reported(online, monkeypatch) -> None:
    from custom_components.padspan_ha import websocket as W
    from custom_components.padspan_ha import bluetooth_live as BL

    session, _ = online
    monkeypatch.setattr(BL, "known_address_type", lambda hass, mac: "random")
    conn = MagicMock()
    # 0x40: bits 0x01 and 0x02 clear, so only the reported type can hold it back.
    await W.ws_vendor_lookup(_hass({"vendor_lookup_enabled": True}), conn,
                             {"id": 1, "mac": "40:11:22:33:44:55"})
    out = conn.send_result.call_args.args[1]
    assert out["skipped"] == "random" and session.urls == []


@pytest.mark.asyncio
@pytest.mark.parametrize("first", ["40", "7C", "C0", "F4"])
async def test_a_known_random_address_is_never_sent_whatever_its_bits(online, first) -> None:
    session, cache = online
    out = await VL.async_lookup_vendor(_hass(), f"{first}:11:22:33:44:55", address_type="random")
    assert out["skipped"] == "random" and out["found"] is False
    assert session.urls == [] and cache.entries == {}


@pytest.mark.asyncio
async def test_an_unknown_type_falls_back_to_the_bits(online) -> None:
    session, _ = online
    out = await VL.async_lookup_vendor(_hass(), "40:11:22:33:44:55", address_type=None)
    assert out["skipped"] is None and session.urls and all(u.endswith("/40:11:22") for u in session.urls)
    out = await VL.async_lookup_vendor(_hass(), "DA:11:22:33:44:55", address_type=None)
    assert out["skipped"] == "local"
    out = await VL.async_lookup_vendor(_hass(), "DA:11:22:33:44:55", address_type="public")
    assert out["skipped"] == "local"


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


# ── The type is kept per address (0.38.208) ──────────────────────────────────
# On HA OS, live adverts from HA's own adapter come through habluetooth's mgmt
# side channel with the BlueZ path only, no AddressType, while the 30 s reseed
# reads the scanner's BlueZ cache, which has it. 0.38.207 stored each report's
# type as it came, so one live advert wiped the reseed's "random" and the lookup
# asked both services for C4:11:22. These go through the real recording
# (_on_adv, the reseed), the real known_address_type and the real handler.

RANDOM_STATIC = "C4:11:22:33:44:55"  # 0xC4: bits 0x01 and 0x02 clear, so only the type holds it back


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


def _advert(addr, device, source="hci0"):
    from types import SimpleNamespace

    return SimpleNamespace(address=addr, name=None, source=source, rssi=-60, time=0, device=device,
                           manufacturer_data={}, service_data={}, service_uuids=[], tx_power=None,
                           connectable=True)


def _stack(monkeypatch, cached=None, by_address=None):
    """A BluetoothLive behind the real handler. `cached`: what the reseed reads
    from scanner hci0 ({addr: BLEDevice}). `by_address`: what the scanners' own
    caches answer when asked for one address; None leaves that out, so only
    PadSpan's own record can hold an address back."""
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
async def test_a_random_address_padspan_has_no_type_for_yet_is_never_sent(online, monkeypatch) -> None:
    """First heard on HA's own adapter (no type) and asked about before any
    reseed: the scanner's own BlueZ cache already says random."""
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, by_address={RANDOM_STATIC: [_bluez(RANDOM_STATIC, "random")]})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))
    assert bl._address_types == {}
    out = await _ask(hass, RANDOM_STATIC)
    assert out["skipped"] == "random" and session.urls == []
    # Never heard by PadSpan at all, and an ESPHome proxy's cache says random.
    other = "C8:11:22:33:44:55"
    _, _, hass2 = _stack(monkeypatch, by_address={other: [_esphome(other, 1)]})
    out = await _ask(hass2, other)
    assert out["skipped"] == "random" and session.urls == []


@pytest.mark.asyncio
async def test_with_no_type_reported_anywhere_the_bits_decide(online, monkeypatch) -> None:
    session, _ = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    for addr in (RANDOM_STATIC, "DA:11:22:33:44:55"):
        bl._on_adv(_advert(addr, _bluez(addr)))
    assert BL.known_address_type(hass, RANDOM_STATIC) is None
    out = await _ask(hass, RANDOM_STATIC)
    assert out["skipped"] is None and session.urls
    assert all(u.endswith("/C4:11:22") for u in session.urls), session.urls
    asked = len(session.urls)
    out = await _ask(hass, "DA:11:22:33:44:55")
    assert out["skipped"] == "local" and len(session.urls) == asked


def test_random_is_never_downgraded_and_goes_with_the_address(monkeypatch) -> None:
    import datetime as dt

    BL, bl, hass = _stack(monkeypatch)
    a, b = RANDOM_STATIC, "C8:11:22:33:44:55"
    bl._on_adv(_advert(a, _esphome(a, 1), source="proxy"))
    bl._on_adv(_advert(a, _esphome(a, 0), source="proxy"))  # a later "public" doesn't undo it
    bl._on_adv(_advert(a, _bluez(a)))
    bl._on_adv(_advert(b, _esphome(b, 0), source="proxy"))
    bl._on_adv(_advert(b, _bluez(b)))                        # no type: public stays
    assert bl._address_types == {a: "random", b: "public"}
    assert BL.known_address_type(hass, a.lower()) == "random"
    assert BL.known_address_type(hass, a.replace(":", "-")) == "random"
    assert BL.known_address_type(hass, b) == "public"
    # One radio's records going doesn't forget it; the address leaving the cache does.
    bl.clear_scanner("proxy")
    assert BL.known_address_type(hass, a) == "random"
    bl.clear_scanner("hci0")
    assert a not in bl._address_types and BL.known_address_type(hass, a) is None
    # The age prune too.
    bl._on_adv(_advert(a, _esphome(a, 1), source="proxy"))
    old = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)
    for src_map in bl._seen_by_source.values():
        for rec in src_map.values():
            rec.seen = old
    bl.cache_age_s = 60.0
    bl.get_snapshot(max_ads=100, max_age_s=60)
    assert bl._seen_by_source == {} and bl._address_types == {}


# ── Only devices heard right now (0.38.209) ──────────────────────────────────
# The types radios report are kept in memory and only while the address is
# cached (4 h by default), but the Objects list also shows rows from the object
# history: 1-14 days, tagged ones for good, and across restarts. 0.38.208 asked
# online for those with only the bits to go on, so C4:11:22 went out for a
# random address it had stopped hearing. Now an address no radio heard in the
# last 5 minutes gets the answer kept for its prefix, if there is one, and
# nothing is sent.


def _keep(cache, prefix="C4:11:22", maker="Kept, Inc."):
    """An answer the 30-day cache already holds for the prefix."""
    import datetime as dt

    cache.set(prefix, {"fetched_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
                       "found": True, "sources": {"macvendors": maker, "maclookup": None}})


async def _never_sent_but_kept_answer_shown(hass, session, cache, mac=RANDOM_STATIC):
    out = await _ask(hass, mac)
    assert out["not_heard"] is True and out["found"] is False and out["skipped"] is None, out
    _keep(cache)
    out = await _ask(hass, mac)
    assert out["cached"] is True and out["sources"]["macvendors"] == "Kept, Inc.", out
    assert out["not_heard"] is False
    assert session.urls == []


def _age(bl, addr, seconds):
    import datetime as dt

    for rec in bl._seen_by_source[addr].values():
        rec.seen = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=seconds)


@pytest.mark.asyncio
async def test_an_address_pruned_from_the_live_cache_is_never_sent(online, monkeypatch) -> None:
    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source="proxy"))
    _age(bl, RANDOM_STATIC, 5 * 3600)
    bl.cache_age_s = 4 * 3600.0
    bl.get_snapshot(max_ads=100, max_age_s=4 * 3600)
    assert RANDOM_STATIC not in bl._seen_by_source and bl._address_types == {}  # the type went with it
    await _never_sent_but_kept_answer_shown(hass, session, cache)


@pytest.mark.asyncio
async def test_after_a_restart_a_row_left_in_history_is_never_sent(online, monkeypatch) -> None:
    import time

    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _esphome(RANDOM_STATIC, 1), source="proxy"))
    assert BL.known_address_type(hass, RANDOM_STATIC) == "random"
    # Home Assistant restarts: a new, empty cache. The row is still in the
    # object history; the device isn't heard again, though HA replays its last
    # advert from 17 minutes ago, without a type.
    from types import SimpleNamespace
    fresh = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    hass.data[DOMAIN][BL.DATA_KEY] = fresh
    replayed = _advert(RANDOM_STATIC, _bluez(RANDOM_STATIC))
    replayed.time = time.monotonic() - 1020.0
    fresh._on_adv(replayed)
    assert BL.known_address_type(hass, RANDOM_STATIC) is None and not BL.heard_now(hass, RANDOM_STATIC)
    await _never_sent_but_kept_answer_shown(hass, session, cache)


@pytest.mark.asyncio
async def test_a_tagged_row_older_than_4_hours_is_never_sent(online, monkeypatch) -> None:
    """Tagged rows never leave the history. Here its last report is even still
    in the live cache (no snapshot has pruned it yet), without a type."""
    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))
    _age(bl, RANDOM_STATIC, 4 * 3600 + 600)
    assert RANDOM_STATIC in bl._seen_by_source and not BL.heard_now(hass, RANDOM_STATIC)
    await _never_sent_but_kept_answer_shown(hass, session, cache)


@pytest.mark.asyncio
async def test_a_device_heard_in_the_last_5_minutes_is_looked_up(online, monkeypatch) -> None:
    session, cache = online
    BL, bl, hass = _stack(monkeypatch, by_address={})
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))
    _age(bl, RANDOM_STATIC, 290)
    out = await _ask(hass, RANDOM_STATIC)
    assert out["not_heard"] is False and out["skipped"] is None
    assert session.urls and all(u.endswith("/C4:11:22") for u in session.urls)
    _age(bl, RANDOM_STATIC, 310)
    cache.entries.clear()
    asked = len(session.urls)
    out = await _ask(hass, RANDOM_STATIC)
    assert out["not_heard"] is True and len(session.urls) == asked


def test_heard_now_reads_every_radio_by_when_it_was_heard(monkeypatch) -> None:
    import datetime as dt
    from types import SimpleNamespace
    from custom_components.padspan_ha.const import DATA_ESPRESENSE_MQTT
    from custom_components.padspan_ha.tasmota_ble import DATA_TASMOTA_BLE

    BL, bl, hass = _stack(monkeypatch)
    now = dt.datetime.now(dt.timezone.utc)
    at = lambda s: SimpleNamespace(seen=now - dt.timedelta(seconds=s))  # noqa: E731
    hass.data[DOMAIN][DATA_ESPRESENSE_MQTT] = SimpleNamespace(_seen={
        "A4:C1:38:00:00:01": {"espresense_hall": at(30)}, "A4:C1:38:00:00:02": {"espresense_hall": at(900)}})
    hass.data[DOMAIN][DATA_TASMOTA_BLE] = SimpleNamespace(_seen={"A4:C1:38:00:00:03": {"tasmota_k": at(60)}})
    assert BL.heard_now(hass, "a4:c1:38:00:00:01") and BL.heard_now(hass, "A4C138000003")
    assert not BL.heard_now(hass, "A4:C1:38:00:00:02") and not BL.heard_now(hass, "A4:C1:38:00:00:09")
    bl._on_adv(_advert(RANDOM_STATIC, _bluez(RANDOM_STATIC)))
    assert BL.heard_now(hass, RANDOM_STATIC)
    _age(bl, RANDOM_STATIC, BL.HEARD_NOW_S + 1)
    assert not BL.heard_now(hass, RANDOM_STATIC)


@pytest.mark.asyncio
async def test_cached_only_answers_from_the_cache_or_not_at_all(online) -> None:
    session, cache = online
    out = await VL.async_lookup_vendor(_hass(), RANDOM_STATIC, cached_only=True)
    assert out["not_heard"] is True and session.urls == []
    cache.set("C4:11:22", {"fetched_at": "2026-01-01T00:00:00Z", "found": True,
                           "sources": {"macvendors": "Old, Inc.", "maclookup": None}})
    out = await VL.async_lookup_vendor(_hass(), RANDOM_STATIC, cached_only=True)
    assert out["not_heard"] is True and session.urls == []      # older than 30 days: not used
    _keep(cache)
    for force in (False, True):
        out = await VL.async_lookup_vendor(_hass(), RANDOM_STATIC, force_refresh=force, cached_only=True)
        assert out["cached"] is True and out["not_heard"] is False and session.urls == []
    out = await VL.async_lookup_vendor(_hass(), "DA:11:22:33:44:55", cached_only=True)
    assert out["skipped"] == "local" and out["not_heard"] is False
