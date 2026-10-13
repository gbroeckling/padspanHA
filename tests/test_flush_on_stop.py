# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Home Assistant doesn't unload integrations when it stops, so the
Forensics save and Traceback flush in async_unload_entry never ran on a
restart: up to 5 minutes of Forensics sessions and 30 s of Traceback lost."""

from __future__ import annotations

import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest

import custom_components.padspan_ha as pkg
from custom_components.padspan_ha.const import DATA_FORENSICS, DATA_TRACEBACK, DOMAIN


@pytest.mark.asyncio
async def test_stop_writes_forensics_and_traceback():
    fs, tb = MagicMock(), MagicMock()
    fs.async_save_if_due = AsyncMock()
    tb.async_flush = AsyncMock()
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_FORENSICS: fs, DATA_TRACEBACK: tb}}
    await pkg._async_flush_history(hass)
    fs.async_save_if_due.assert_awaited_once_with(force=True)
    tb.async_flush.assert_awaited_once()


def test_setup_listens_for_home_assistant_stopping():
    src = inspect.getsource(pkg.async_setup_entry)
    assert "async_listen_once(EVENT_HOMEASSISTANT_STOP, _flush_on_stop)" in src
