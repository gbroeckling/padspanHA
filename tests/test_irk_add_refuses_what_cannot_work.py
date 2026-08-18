"""IRKs: the resolver is right, and the add path now refuses what cannot work.

Two things were found on the live install on 2026-08-18. Both are pinned.

1. The one "IRK" registered was the Pixel's iBeacon UUID (the Companion App
   shows the UUID on the very screen people look for the key). The add path
   validated it, said "Saving anyway…", and it sat there for weeks reading
   "0 resolved". Now: a value equal to a beacon UUID on the air is refused
   and the beacon named; a key that resolves nothing is refused unless the
   caller says `force` (the phone is away).

2. A CP27 beacon that was once wrongly fingerprint-bridged lived on for 20 h
   as "Private BLE: 1 device tracked": the object-history layer never expires
   identified objects, and the bridge had picked up `identified` from a
   device link. A bridge is an inference, not an identity.

Also here, because nothing else pins it: the resolver's ah() against the
Bluetooth SIG sample data.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_irk
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.private_ble_resolver import _address_matches_irk, _is_rpa

# Bluetooth Core Spec, Vol 3 Part H, Appendix D.7 — ah() sample data
_SIG_IRK = bytes.fromhex("EC0234A357C8AD05341010A60A397D9B")
_SIG_RPA = "70:81:94:0D:FB:AA"          # prand 708194 → hash 0DFBAA
_PIXEL_UUID = "99a58376-461d-4a9b-9700-2375fcfd705b"


def test_the_resolver_math_matches_the_sig_sample_data() -> None:
    assert _is_rpa(_SIG_RPA)
    assert _address_matches_irk(_SIG_RPA, _SIG_IRK) is True
    assert _address_matches_irk("70:81:94:0D:FB:AB", _SIG_IRK) is False
    assert _address_matches_irk(_SIG_RPA, bytes(16)) is False


# ── a hass with states, a live BLE cache and a settings store ────────────────

def _hass(*, ads=(), states=(), irk_devices=None):
    h = MagicMock()
    settings = SimpleNamespace(data={"irk_devices": list(irk_devices or [])})
    saved = {}
    async def _set(**kw):
        settings.data.update(kw); saved.update(kw)
    settings.async_set = _set
    h.data = {DOMAIN: {DATA_SETTINGS: settings}}
    h.states.async_all = lambda domain=None: [s for s in states]
    h._saved = saved
    ble = MagicMock()
    ble.get_snapshot = lambda **kw: {"advertisements": list(ads)}
    return h, ble


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _ibeacon_ad(addr, uuid_hex, major=100, minor=40004, name=None):
    payload = "0x02 0x15 " + " ".join(f"0x{b:02X}" for b in bytes.fromhex(uuid_hex)) \
              + f" 0x{major >> 8:02X} 0x{major & 255:02X} 0x{minor >> 8:02X} 0x{minor & 255:02X} 0xC5"
    return {"address": addr, "name": name or addr, "rssi": -70, "manufacturer_data": {"76": payload}}


def _conn():
    c = MagicMock(); c.send_result = MagicMock(); c.send_error = MagicMock(); return c


@pytest.fixture(autouse=True)
def _patch_resolver(monkeypatch):
    # The resolver reload after a save touches HA registries — not under test.
    resolver = SimpleNamespace(device_count=1)
    async def _load(): return None
    resolver.async_load = _load
    async def _get(hass): return resolver
    monkeypatch.setattr(ws_irk, "_get_ble_resolver", _get)


def _add(h, ble, monkeypatch, name, irk, force=False):
    monkeypatch.setattr(ws_irk, "get_bluetooth_live", lambda hass: ble)
    conn = _conn()
    msg = {"id": 1, "name": name, "irk_hex": irk, "force": force}
    _run(ws_irk.ws_irk_add(h, conn, msg))
    return conn


def test_a_beacon_uuid_on_the_air_is_refused_and_named(monkeypatch):
    """The Pixel's UUID pasted as its IRK — refused, with the phone named."""
    ads = [_ibeacon_ad("4A:11:22:33:44:55", _PIXEL_UUID.replace("-", ""), name="4A:11:22:33:44:55")]
    px = SimpleNamespace(entity_id="sensor.pixel_8_pro_ble_transmitter",
                         attributes={"id": f"{_PIXEL_UUID}_100_40004", "friendly_name": "Pixel 8 Pro BLE transmitter"})
    h, ble = _hass(ads=ads, states=[px])
    conn = _add(h, ble, monkeypatch, "Pixel 8 Pro", _PIXEL_UUID.replace("-", ""))
    conn.send_error.assert_called_once()
    _, code, message = conn.send_error.call_args[0]
    assert code == "not_an_irk"
    assert "Pixel 8 Pro" in message and "iBeacon UUID" in message
    assert not h._saved, "a UUID was saved as an IRK"
    # force does not override this one — waiting will never make a UUID resolve
    conn2 = _add(h, ble, monkeypatch, "Pixel 8 Pro", _PIXEL_UUID.replace("-", ""), force=True)
    assert conn2.send_error.call_args[0][1] == "not_an_irk"
    assert not h._saved


def test_a_beacon_uuid_is_named_even_without_the_sensor(monkeypatch):
    """No Companion App sensor, but the UUID is on the air as an iBeacon."""
    ads = [_ibeacon_ad("48:87:2D:9D:BC:88", "e2c56db5dffb48d2b060d0f5a71096e0", 5, 6, name="CP27-BC88")]
    h, ble = _hass(ads=ads)
    conn = _add(h, ble, monkeypatch, "beacon", "e2c56db5dffb48d2b060d0f5a71096e0")
    _, code, message = conn.send_error.call_args[0]
    assert code == "not_an_irk" and "CP27-BC88" in message and "major 5" in message


def test_a_key_that_resolves_nothing_is_refused_unless_forced(monkeypatch):
    # An RPA that this key does NOT generate, so nothing on the air resolves.
    ads = [{"address": "4A:11:22:33:44:55", "name": "x", "rssi": -80, "manufacturer_data": {}}]
    h, ble = _hass(ads=ads)
    conn = _add(h, ble, monkeypatch, "Phone", _SIG_IRK.hex())
    _, code, message = conn.send_error.call_args[0]
    assert code == "unverified" and "1 tested" in message
    assert not h._saved
    # The phone is away: forced, it saves, and says it is unverified.
    conn2 = _add(h, ble, monkeypatch, "Phone", _SIG_IRK.hex(), force=True)
    conn2.send_error.assert_not_called()
    res = conn2.send_result.call_args[0][1]
    assert res["ok"] and res["verified"] is False and res["matched_count"] == 0
    assert h._saved["irk_devices"][0]["irk_hex"] == _SIG_IRK.hex()


def test_a_key_that_resolves_a_live_address_saves_and_says_so(monkeypatch):
    ads = [{"address": _SIG_RPA, "name": "phone?", "rssi": -60, "manufacturer_data": {}},
           {"address": "4A:11:22:33:44:55", "name": "x", "rssi": -80, "manufacturer_data": {}}]
    h, ble = _hass(ads=ads)
    conn = _add(h, ble, monkeypatch, "Phone", _SIG_IRK.hex())
    conn.send_error.assert_not_called()
    res = conn.send_result.call_args[0][1]
    assert res["verified"] is True and res["matched_count"] == 1 and res["rpa_count"] == 2
    assert h._saved["irk_devices"][0]["name"] == "Phone"


def test_validate_names_the_beacon_uuid_mistake(monkeypatch):
    ads = [_ibeacon_ad("4A:11:22:33:44:55", _PIXEL_UUID.replace("-", ""))]
    h, ble = _hass(ads=ads)
    monkeypatch.setattr(ws_irk, "get_bluetooth_live", lambda hass: ble)
    conn = _conn()
    _run(ws_irk.ws_irk_validate(h, conn, {"id": 1, "irk_hex": _PIXEL_UUID}))
    res = conn.send_result.call_args[0][1]
    assert res["valid"] is False and res["not_an_irk"] and "iBeacon UUID" in res["not_an_irk"]


# ── the ghost ────────────────────────────────────────────────────────────────

def test_a_bridge_is_an_inference_and_never_immortal():
    """Source-level: the two rules that stop a wrong bridge living forever.

    The builder is one 2,400-line function, so the rules are pinned where
    they live: a bridged object is written with identified=False, and a
    cached bridge that is not current expires by TTL — or at once if its
    address is on the air under a real identity.
    """
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "snapshot_builder.py").read_text(encoding="utf-8")
    write = src.index('if canonical.get("bridge_match"):\n                obj_pb["bridge_match"] = True')
    assert 'obj_pb["identified"] = False' in src[write:write + 400], "a bridge picked up identified from a device link"
    resurrect = src.index("# Merge cached objects not seen this cycle back into the list")
    block = src[resurrect:resurrect + 4000]
    assert 'if cached_obj.get("bridge_match"):' in block
    guard = block[block.index('if cached_obj.get("bridge_match"):'):]
    assert "ibeacon_addrs" in guard[:900] and "ble_by_addr" in guard[:900], "a bridge ghost whose address is live is not purged"
    assert "_HISTORY_TTL" in guard[:900], "a bridge ghost does not expire"
    assert 'cached_obj.pop("identified", None)' in guard[:900]
    # and the immortality rule comes AFTER the bridge rule, so it cannot rescue one
    assert guard.index('cached_obj.pop("identified", None)') < guard.index("is_identified = cached_obj.get")
