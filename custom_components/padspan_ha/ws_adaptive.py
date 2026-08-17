# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the adaptive learning store.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import DOMAIN, DATA_ADAPTIVE


@websocket_api.websocket_command({"type": "padspan_ha/adaptive_status_get"})
@websocket_api.async_response
async def ws_adaptive_status_get(hass: HomeAssistant, connection, msg) -> None:
    """Return adaptive learning summary stats."""
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        connection.send_result(msg["id"], {"adaptive": ad.summary()})
    else:
        connection.send_result(msg["id"], {"adaptive": {}})


@websocket_api.websocket_command({"type": "padspan_ha/adaptive_fingerprints_get"})
@websocket_api.async_response
async def ws_adaptive_fingerprints_get(hass: HomeAssistant, connection, msg) -> None:
    """Return raw adaptive learning fingerprints for heatmap visualization.

    Returns per-room, per-scanner mean RSSI from confirmed observations.
    Format: { room_name: { scanner_source: { mean, var, n } } }
    """
    _empty = {"fingerprints": {}, "scanner_best": {}, "total_observations": 0}
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if not (ad and ad.data):
        connection.send_result(msg["id"], _empty)
        return
    try:
        fps = ad.data.get("room_fingerprints", {})
        # Flatten to { room: { scanner: mean_rssi } } — only include
        # scanners with ≥5 observations for statistical confidence.
        simple: dict[str, dict[str, float]] = {}
        for room, scanners in fps.items():
            if not isinstance(scanners, dict):
                continue  # guard against corrupted persistent data
            simple[room] = {}
            for src, stats in scanners.items():
                if isinstance(stats, dict) and stats.get("n", 0) >= 5:
                    simple[room][src] = round(stats.get("mean", -100), 1)
        # Per-scanner best = strongest mean across all rooms (for heatmap scaling)
        scanner_best: dict[str, float] = {}
        for room, scanners in simple.items():
            for src, mean in scanners.items():
                if src not in scanner_best or mean > scanner_best[src]:
                    scanner_best[src] = mean
        connection.send_result(msg["id"], {
            "fingerprints": simple,
            "scanner_best": scanner_best,
            "total_observations": (ad.data.get("stats") or {}).get("total_observations", 0),
        })
    except Exception:
        connection.send_result(msg["id"], _empty)


@websocket_api.websocket_command({"type": "padspan_ha/adaptive_reset"})
@websocket_api.async_response
async def ws_adaptive_reset(hass: HomeAssistant, connection, msg) -> None:
    """Clear all adaptive learning data."""
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        await ad.async_reset()
    connection.send_result(msg["id"], {"ok": True})
