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

    async def _lookup(hass, mac, force_refresh=False, address_type=None):
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
