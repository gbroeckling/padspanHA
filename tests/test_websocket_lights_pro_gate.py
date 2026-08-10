"""Unit tests for the PadSpan Pro licence gate on Lights map placement.

Exercises the real code path exposed to the frontend: the
`padspan_ha/maps_update` websocket handler must silently drop an incoming
`lights` payload (and tell the client via `lights_blocked`) unless a PadSpan
Pro licence key is active — mirroring the existing Forensics gate.
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
async def test_maps_update_blocks_lights_without_pro_licence(tmp_path: Path) -> None:
    maps_store = _make_maps_store(tmp_path)
    info = await maps_store.async_add_map(
        name="Kitchen", filename="k.png", mime="image/png",
        width=100, height=100, png_base64=_small_png_b64(),
    )
    hass = _make_hass(maps_store, licence_key="")  # no licence
    connection = _make_connection()

    await ws.ws_maps_update(hass, connection, {
        "id": 1,
        "map_id": info["id"],
        "lights": [{"entity_id": "light.kitchen", "x": 0.5, "y": 0.5}],
    })

    connection.send_error.assert_not_called()
    connection.send_result.assert_called_once()
    _msg_id, payload = connection.send_result.call_args[0]
    assert payload["lights_blocked"] is True
    assert payload["map"]["lights"] == []  # write was dropped, not just flagged
    assert maps_store.get_map(info["id"])["lights"] == []


@pytest.mark.asyncio
async def test_maps_update_allows_lights_with_pro_licence(tmp_path: Path) -> None:
    maps_store = _make_maps_store(tmp_path)
    info = await maps_store.async_add_map(
        name="Kitchen", filename="k.png", mime="image/png",
        width=100, height=100, png_base64=_small_png_b64(),
    )
    hass = _make_hass(maps_store, licence_key="PSPAN-AAAA-BBBB-CCCC-DDDD")
    connection = _make_connection()

    await ws.ws_maps_update(hass, connection, {
        "id": 1,
        "map_id": info["id"],
        "lights": [{"entity_id": "light.kitchen", "x": 0.25, "y": 0.75}],
    })

    connection.send_error.assert_not_called()
    _msg_id, payload = connection.send_result.call_args[0]
    assert payload["lights_blocked"] is False
    assert len(payload["map"]["lights"]) == 1
    saved = maps_store.get_map(info["id"])["lights"][0]
    assert saved["entity_id"] == "light.kitchen"
    assert saved["x"] == pytest.approx(0.25)
    assert saved["y"] == pytest.approx(0.75)


@pytest.mark.asyncio
async def test_maps_update_without_lights_key_is_unaffected_by_pro_gate(tmp_path: Path) -> None:
    """A save that doesn't touch `lights` at all must not be blocked or flagged oddly."""
    maps_store = _make_maps_store(tmp_path)
    info = await maps_store.async_add_map(
        name="Kitchen", filename="k.png", mime="image/png",
        width=100, height=100, png_base64=_small_png_b64(),
    )
    hass = _make_hass(maps_store, licence_key="")
    connection = _make_connection()

    await ws.ws_maps_update(hass, connection, {
        "id": 1,
        "map_id": info["id"],
        "notes": "just a note",
    })

    connection.send_error.assert_not_called()
    _msg_id, payload = connection.send_result.call_args[0]
    assert payload["lights_blocked"] is False
    assert payload["map"]["notes"] == "just a note"
