"""The PadSpan Pro licence gate, and where light placement is (not) written.

`_padspan_pro_active` is the single gate for every Pro feature. Light
placement is gated on its real write path — `fabric_light_position_set` /
`fabric_light_remove`, see test_fabric_lights.py — and the per-photo `lights`
list that maps_update used to accept is gone.
"""

from __future__ import annotations

import base64
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.const import DOMAIN, DATA_MAPS, DATA_SETTINGS
from custom_components.padspan_ha.maps_store import MapsStore


def _make_maps_store(tmp_path: Path) -> MapsStore:
    hass = MagicMock()
    hass.config.path = lambda *parts: str(tmp_path.joinpath(*parts))
    store = MapsStore.__new__(MapsStore)
    store.hass = hass
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.maps_dir = tmp_path / "www" / "padspan_ha" / "maps"
    store.maps_dir.mkdir(parents=True, exist_ok=True)
    store.data = {"maps": []}
    return store


def _small_png_b64() -> str:
    raw = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    return base64.b64encode(raw).decode()


def _make_hass(maps_store: MapsStore, licence_key: str = "") -> SimpleNamespace:
    settings = SimpleNamespace(data={"forensics_license_key": licence_key})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MAPS: maps_store, DATA_SETTINGS: settings}}
    return hass


def _make_connection() -> MagicMock:
    conn = MagicMock()
    conn.send_result = MagicMock()
    conn.send_error = MagicMock()
    return conn


# ---------------------------------------------------------------------------
# _padspan_pro_active
# ---------------------------------------------------------------------------


def test_padspan_pro_active_false_when_no_settings_store() -> None:
    hass = MagicMock()
    hass.data = {}
    assert ws._padspan_pro_active(hass) is False


def test_padspan_pro_active_false_when_key_blank_or_whitespace() -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"forensics_license_key": "   "})}}
    assert ws._padspan_pro_active(hass) is False


def test_padspan_pro_active_true_when_key_set() -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"forensics_license_key": "PSPAN-AAAA-BBBB-CCCC-DDDD"})}}
    assert ws._padspan_pro_active(hass) is True


# ---------------------------------------------------------------------------
# ws_maps_update: lights gate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_maps_update_no_longer_writes_lights_at_all(tmp_path: Path) -> None:
    """A light is placed in metres (fabric_light_position_set, Pro-gated
    there). The per-photo `lights` list on a map was the old write path; the
    UI stopped sending it when lights moved to metres, and the licence gate
    that lived on it guarded nothing. maps_update ignores the key now, and a
    map is created without one."""
    maps_store = _make_maps_store(tmp_path)
    info = await maps_store.async_add_map(
        name="Kitchen", filename="k.png", mime="image/png",
        width=100, height=100, png_base64=_small_png_b64(),
    )
    assert "lights" not in maps_store.get_map(info["id"])
    hass = _make_hass(maps_store, licence_key="PSPAN-AAAA-BBBB-CCCC-DDDD")  # even WITH a licence
    connection = _make_connection()
    await ws.ws_maps_update(hass, connection, {
        "id": 1,
        "map_id": info["id"],
        "lights": [{"entity_id": "light.kitchen", "x": 0.25, "y": 0.75}],
        "notes": "just a note",
    })
    connection.send_error.assert_not_called()
    _msg_id, payload = connection.send_result.call_args[0]
    assert "lights_blocked" not in payload
    assert "lights" not in maps_store.get_map(info["id"])
    assert payload["map"]["notes"] == "just a note"
