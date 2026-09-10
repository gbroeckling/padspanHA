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


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """HA's standard diagnostics hook (this exact function name/signature is
    what HA's "Download diagnostics" button calls — see async_get_config_entry_diagnostics
    in HA core). entry.data/options are included as-is: this integration's
    config entry never stores credentials or tokens (BLE scanning is local,
    no cloud login), so there is nothing here that needs redacting before
    a user pastes this into a bug report."""
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    return {
        "version": VERSION,
        "entry": {
            "entry_id": entry.entry_id,
            "title": entry.title,
            "data": dict(entry.data),
            "options": dict(entry.options),
        },
        "coordinator": coord.as_dict() if coord else None,
        "note": "Share this diagnostics blob + traceback if any flows fail.",
    }
