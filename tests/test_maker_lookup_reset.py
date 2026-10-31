# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Factory Reset erases what the maker lookup learned.

The help says a reset "erases all of PadSpan's data". The addresses a radio
confirmed as public (bluetooth_live, padspan_ha.public_addresses) and the
makers kept for 30 days (vendor_lookup, padspan_ha.vendor_cache) outlived it,
in memory and on disk. Each file goes through the store the live object
writes with, so a save still pending can't write it back.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import bluetooth_live as BL
from custom_components.padspan_ha.const import DOMAIN, PUBLIC_ADDRESSES_STORE_KEY, VENDOR_CACHE_STORE_KEY
from tests.test_telemetry import _hass


class _Store:
    """Every store the reset opens; what is removed is gone."""
    files: dict = {}

    def __init__(self, hass, version, key):
        self.key = key

    async def async_load(self):
        return _Store.files.get(self.key)

    async def async_save(self, data):
        _Store.files[self.key] = data

    def async_delay_save(self, func, delay):
        _Store.files[self.key] = func()

    async def async_remove(self):
        _Store.files.pop(self.key, None)
        self.removed = True


@pytest.fixture
def store(monkeypatch):
    import homeassistant.helpers.storage as hs

    _Store.files = {}
    monkeypatch.setattr(hs, "Store", _Store)
    return _Store


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_a_factory_reset_erases_the_confirmed_addresses_and_the_kept_makers(store) -> None:
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset

    h = _hass()
    bl = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    public_store = _Store(None, 1, PUBLIC_ADDRESSES_STORE_KEY)
    _run(bl.async_load_public(public_store))
    bl._public = {"F0:18:98:12:34:56": 1761900000}
    bl._save_public()
    h.data[DOMAIN][BL.DATA_KEY] = bl
    # The live VendorCache (vendor_lookup._get_cache): its data and its store.
    vc = SimpleNamespace(data={"entries": {"F0:18:98": {"found": True, "sources": {"macvendors": "Apple, Inc."}}}},
                         store=_Store(None, 1, VENDOR_CACHE_STORE_KEY))
    _run(vc.store.async_save(vc.data))
    h.data[DOMAIN]["_vendor_cache"] = vc
    assert PUBLIC_ADDRESSES_STORE_KEY in store.files and VENDOR_CACHE_STORE_KEY in store.files

    conn = MagicMock()
    _run(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))

    assert bl._public == {} and getattr(public_store, "removed", False), "through the store it writes with"
    assert PUBLIC_ADDRESSES_STORE_KEY not in store.files
    assert vc.data == {"entries": {}} and VENDOR_CACHE_STORE_KEY not in store.files
    errors = conn.send_result.call_args[0][1]["errors"]
    assert PUBLIC_ADDRESSES_STORE_KEY not in errors and VENDOR_CACHE_STORE_KEY not in errors
    # Learned again from scratch afterwards.
    assert BL.known_address_type(h, "F0:18:98:12:34:56") is None


def test_a_factory_reset_with_nothing_loaded_still_removes_the_files(store) -> None:
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset

    store.files = {PUBLIC_ADDRESSES_STORE_KEY: {"rule": BL.PUBLIC_STORE_RULE, "addresses": {"F0:18:98:12:34:56": 1}},
                   VENDOR_CACHE_STORE_KEY: {"entries": {"F0:18:98": {}}}}
    h = _hass()
    h.data[DOMAIN].pop(BL.DATA_KEY, None)
    h.data[DOMAIN].pop("_vendor_cache", None)
    conn = MagicMock()
    _run(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))
    assert PUBLIC_ADDRESSES_STORE_KEY not in store.files and VENDOR_CACHE_STORE_KEY not in store.files
