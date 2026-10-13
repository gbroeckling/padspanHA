# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Signal-ingestion fixes, round 3 (2026-10-12)."""

from __future__ import annotations

import datetime as dt
import inspect
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


def test_espresense_handlers_run_on_the_event_loop():
    """HA's MQTT client runs a plain subscriber in a worker thread; these
    handlers insert into dicts the snapshot iterates on the loop, and the
    swallowed "changed size during iteration" dropped every ESPresense
    reading from that build."""
    from custom_components.padspan_ha import espresense_mqtt
    src = inspect.getsource(espresense_mqtt.EspresenseMqtt)
    assert "@callback\n    def _on_device_message" in src
    assert "@callback\n    def _on_room_message" in src


def _rpa(irk: bytes, prand=b"\x4a\x12\x34") -> str:
    ct = Cipher(algorithms.AES(irk), modes.ECB()).encryptor()
    out = ct.update(b"\x00" * 13 + prand) + ct.finalize()
    return ":".join(f"{b:02X}" for b in prand + out[13:])


@pytest.mark.asyncio
async def test_a_reload_forgets_cached_unresolved_addresses():
    """A phone's address cached as unresolved stayed so for up to 20 minutes
    after its IRK was added, though the add reported a match."""
    from custom_components.padspan_ha import private_ble_resolver as pr
    irk = bytes(range(16, 32))
    rpa = _rpa(irk)
    r = pr.PrivateBLEResolver(MagicMock())
    r._devices = []
    assert r.resolve_address(rpa) is None          # cached as unresolved
    src = inspect.getsource(pr.PrivateBLEResolver.async_load)
    # Swapped in, then the cache cleared, after the last await: a resolve
    # during the load sees the old list, never a half-built one.
    swap = src.index("self._devices = devices")
    assert src.index("self._cache.clear()") > swap > src.rindex("await ")
    r._cache.clear()                               # what async_load now does
    r._devices = [{"canonical_id": "irk:b", "name": "B", "irk_bytes": irk}]
    assert r.resolve_address(rpa) is not None


@pytest.mark.asyncio
async def test_a_reload_with_the_same_keys_keeps_the_cache():
    """The 5-minute reload cleared the cache every time: every address was
    AES-checked against every key again and counted as a first sighting
    again. Only a change of keys clears it."""
    from custom_components.padspan_ha import private_ble_resolver as pr
    from custom_components.padspan_ha.const import DOMAIN
    irk_a, irk_b = bytes(range(16)), bytes(range(16, 32))
    rpa_a, rpa_b = _rpa(irk_a), _rpa(irk_b, b"\x55\x66\x77")
    keys = [{"name": "A", "irk_hex": irk_a.hex()}]
    hass = MagicMock()
    hass.config_entries.async_entries = lambda domain: []
    hass.async_add_executor_job = AsyncMock(return_value=[])
    hass.states.async_all = lambda domain: []
    hass.data = {DOMAIN: {"settings": types.SimpleNamespace(data={"irk_devices": keys})}}
    r = pr.PrivateBLEResolver(hass)
    counted: list[str] = []
    r._count = counted.append
    await r.async_load()
    assert r.resolve_address(rpa_a)["canonical_id"] == f"irk:{irk_a.hex()}"
    assert r.resolve_address(rpa_b) is None
    assert counted == ["irk_resolved", "irk_unresolved_rpa"]

    await r.async_load()                          # same keys
    assert set(r._cache) == {rpa_a, rpa_b}
    assert r.resolve_address(rpa_a) is not None
    assert counted == ["irk_resolved", "irk_unresolved_rpa"]

    keys.append({"name": "B", "irk_hex": irk_b.hex()})
    await r.async_load()                          # B's address was cached unresolved
    assert r.resolve_address(rpa_b)["canonical_id"] == f"irk:{irk_b.hex()}"


def test_a_disconnected_proxy_is_not_shown_as_scanning(monkeypatch):
    bt = types.ModuleType("homeassistant.components.bluetooth")
    bt.async_current_scanners = lambda hass: []
    monkeypatch.setitem(sys.modules, "homeassistant.components.bluetooth", bt)
    import homeassistant.components as hc
    monkeypatch.setattr(hc, "bluetooth", bt, raising=False)
    from custom_components.padspan_ha import bluetooth_live as bl
    hass = MagicMock()
    hass.data = {}
    b = bl.BluetoothLive(hass)
    b._last_reseed = bl._now()
    b._seed_from_discovered = lambda: None
    old = bl._now() - dt.timedelta(seconds=600)
    b._seen_by_source["11:22:33:44:55:66"] = {"AA:BB:CC:DD:EE:01": bl._Adv(
        record={"address": "11:22:33:44:55:66", "source": "AA:BB:CC:DD:EE:01", "rssi": -60}, seen=old)}
    radios = b.get_snapshot(max_age_s=900)["radios"]
    orphan = next(r for r in radios if r["source"] == "AA:BB:CC:DD:EE:01")
    assert orphan["scanning"] is False


def test_bright_keeps_the_presence_coordinator_polling():
    """HA polls a coordinator only while something listens to it, and Bright
    has no entities: after the first poll, presence stopped."""
    import custom_components.padspan_ha as pkg
    from custom_components.padspan_ha.const import DOMAIN
    coord = MagicMock()
    unsub = MagicMock()
    coord.async_add_listener = MagicMock(return_value=unsub)
    hass = MagicMock()
    hass.data = {DOMAIN: {"presence_coordinator": coord}}
    pkg.presence_keepalive(hass, True)
    pkg.presence_keepalive(hass, True)
    coord.async_add_listener.assert_called_once()
    pkg.presence_keepalive(hass, False)
    unsub.assert_called_once()
    assert "presence_keepalive(hass, bool(_st and _st.data.get(\"bright_reveal_presence\")))" in \
        inspect.getsource(pkg.async_setup_entry)


def test_the_irk_cache_holds_a_full_snapshot_of_addresses():
    """At 4,096 a snapshot of 4,500 addresses evicted itself every build and
    every address was AES-checked against every IRK again."""
    from custom_components.padspan_ha import private_ble_resolver as pr
    from custom_components.padspan_ha.low_memory import SNAPSHOT_ADS
    assert pr._CACHE_MAX >= 2 * SNAPSHOT_ADS
