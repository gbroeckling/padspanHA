# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""PadSpan HA — Diagnostics endpoint for HA's "Download diagnostics" button."""
from __future__ import annotations

from typing import Any
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION

REDACTED = "**REDACTED**"


def redact_room_tag_map(room_tag_map: Any) -> dict[str, Any]:
    """room_tag_map ({room: [object key, ...]}) with every object key hidden:
    a key can be a device's Bluetooth address. The rooms and how many tags
    each has stay, which is what a bug report needs."""
    if not isinstance(room_tag_map, dict):
        return {}
    return {str(room): [REDACTED] * len(keys) if isinstance(keys, (list, tuple)) else REDACTED
            for room, keys in room_tag_map.items()}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """HA's standard diagnostics hook (this exact function name/signature is
    what HA's "Download diagnostics" button calls — see async_get_config_entry_diagnostics
    in HA core). entry.data/options are included as-is: this integration's
    config entry never stores credentials or tokens (BLE scanning is local,
    no cloud login). The coordinator's room_tag_map is the one thing here
    that can hold a Bluetooth address (its tag keys), so its keys are
    hidden (redact_room_tag_map) before a user pastes this into a bug report."""
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    coord_dict = coord.as_dict() if coord else None
    if isinstance(coord_dict, dict) and "room_tag_map" in coord_dict:
        coord_dict = {**coord_dict, "room_tag_map": redact_room_tag_map(coord_dict["room_tag_map"])}
    return {
        "version": VERSION,
        "entry": {
            "entry_id": entry.entry_id,
            "title": entry.title,
            "data": dict(entry.data),
            "options": dict(entry.options),
        },
        "coordinator": coord_dict,
        "note": "Share this diagnostics blob + traceback if any flows fail.",
    }
