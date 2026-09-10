# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Config flow for PadSpan HA.

There is deliberately no options flow: the only option it ever exposed
(CONF_SCAN_INTERVAL) was a no-op — the real polling cadence is the
``presence_poll_interval_s`` setting managed from the panel — and saving it
triggered a config-entry reload that tore down the BLE live feeds.
"""

import logging
from typing import Any

import voluptuous as vol
from homeassistant import config_entries

from .const import (
    DOMAIN,
    NAME,
    VERSION,
    CONF_ENABLE_CLOUD,
    CONF_HUB_URL,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
)

_LOGGER = logging.getLogger(__name__)

def _clamp_interval(value: Any) -> int:
    try:
        v = int(value)
    except (ValueError, TypeError):
        v = DEFAULT_SCAN_INTERVAL
    return max(1, min(3600, v))

def _schema(default_interval: int) -> vol.Schema:
    return vol.Schema(
        {
            vol.Required(
                CONF_SCAN_INTERVAL,
                default=_clamp_interval(default_interval),
            ): vol.All(vol.Coerce(int), vol.Range(min=1, max=3600)),
        }
    )

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle initial setup."""
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        try:
            # Single-instance only: everything this integration owns (BLE live
            # feeds, the fabric/model store, hass.data[DOMAIN] state) is keyed
            # per-HASS, not per-config-entry, so a second entry would just
            # collide with the first rather than run a genuinely separate copy.
            if self.hass.config_entries.async_entries(DOMAIN):
                return self.async_abort(reason="already_configured")

            if user_input is None:
                return self.async_show_form(
                    step_id="user",
                    data_schema=_schema(DEFAULT_SCAN_INTERVAL),
                )

            interval = _clamp_interval(user_input.get(CONF_SCAN_INTERVAL))
            data = {
                CONF_ENABLE_CLOUD: False,
                CONF_HUB_URL: "",
                CONF_API_KEY: "",
                CONF_SCAN_INTERVAL: interval,
            }
            return self.async_create_entry(title=NAME, data=data)
        except Exception as err:
            # An unhandled exception here would otherwise surface to the user
            # as a raw HA config-flow crash screen with no way to retry
            # cleanly; log the real cause for diagnosis and abort gracefully
            # instead.
            _LOGGER.exception("ConfigFlow user crashed (v%s): %s", VERSION, err)
            return self.async_abort(reason="unknown")
