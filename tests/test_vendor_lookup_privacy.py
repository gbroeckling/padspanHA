"""The device maker (vendor) lookup's privacy rules.

Off unless switched on; when on, only the maker prefix (AA:BB:CC) leaves the
house, never a full address; random (locally administered) and group addresses
are never sent; answers are cached by prefix; the switch is reported as on/off
only; installs from before are switched off once.
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
async def test_nothing_is_asked_with_the_switch_off(online, monkeypatch) -> None:
    from custom_components.padspan_ha import websocket as W

    session, _ = online
    called = []

    async def _lookup(hass, mac, force_refresh=False):
        called.append(mac)
        return {}

    monkeypatch.setattr(W, "async_lookup_vendor", _lookup)
    for settings in ({"vendor_lookup_enabled": False}, {}, None):
        conn = MagicMock()
        await W.ws_vendor_lookup(_hass(settings), conn, {"id": 1, "mac": "F0:18:98:12:34:56"})
        assert conn.send_result.call_args.args[1] == {"enabled": False}
    assert called == [] and session.urls == []

    conn = MagicMock()
    await W.ws_vendor_lookup(_hass({"vendor_lookup_enabled": True}), conn,
                             {"id": 2, "mac": "F0:18:98:12:34:56"})
    assert called == ["F0:18:98:12:34:56"]
    assert conn.send_result.call_args.args[1]["enabled"] is True


def test_off_by_default() -> None:
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

    assert DEFAULT_SETTINGS["vendor_lookup_enabled"] is False


@pytest.mark.asyncio
async def test_installs_from_before_are_switched_off_once() -> None:
    # An install from before: the old default (on) saved, no flag yet.
    ss, ms = _make_settings(store_data={"vendor_lookup_enabled": True, "data_mode": "live"})
    data = await ss.async_load()
    assert data["vendor_lookup_enabled"] is False
    assert data["vendor_lookup_optin_v1"] is True
    assert ms._data["vendor_lookup_enabled"] is False

    # Turned back on after that: it stays on.
    ss2, _ = _make_settings(store_data=dict(ms._data, vendor_lookup_enabled=True))
    data2 = await ss2.async_load()
    assert data2["vendor_lookup_enabled"] is True


@pytest.mark.asyncio
async def test_a_new_install_starts_off() -> None:
    ss, _ = _make_settings(store_data=None)
    data = await ss.async_load()
    assert data["vendor_lookup_enabled"] is False


def test_the_switch_is_reported_as_on_or_off_only() -> None:
    from custom_components.padspan_ha import telemetry as T

    assert "vendor_lookup_enabled" in T._FEATURE_FLAGS
