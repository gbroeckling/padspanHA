# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The integration sets up, unloads and reloads in a real Home Assistant."""

from __future__ import annotations

import logging

import pytest
from homeassistant.config_entries import ConfigEntryState

from .conftest import DOMAIN, call, counter_save_timers

PLATFORMS = ("sensor", "binary_sensor", "device_tracker", "light")


def _problems(caplog) -> list[str]:
    """What the integration itself logged as a warning or worse, while it was
    set up (the `padspan` fixture) and during the test."""
    return [f"{r.levelname} {r.name}: {r.getMessage()}" for r in (*caplog.get_records("setup"), *caplog.records)
            if r.levelno >= logging.WARNING and r.name.startswith("custom_components.padspan_ha")]


async def test_it_sets_up(hass, padspan, caplog):
    assert padspan.state is ConfigEntryState.LOADED
    # The house it came up in: none of these is there.
    assert not {"bluetooth", "mqtt", "recorder"} & hass.config.components
    for platform in PLATFORMS:
        assert f"{DOMAIN}.{platform}" in hass.config.components, f"the {platform} platform did not load"
    assert hass.services.has_service(DOMAIN, "set_room_tag_map")
    assert hass.services.has_service(DOMAIN, "dump_devices")
    assert "padspan-ha" in hass.data["frontend_panels"], "the sidebar panel was not registered"
    assert not _problems(caplog)


async def test_it_unloads(hass, padspan, caplog):
    assert await hass.config_entries.async_unload(padspan.entry_id)
    await hass.async_block_till_done()
    assert padspan.state is ConfigEntryState.NOT_LOADED
    assert not _problems(caplog)


async def test_it_reloads(hass, padspan, caplog):
    for _ in range(2):      # the second reload starts from what the first left
        assert await hass.config_entries.async_reload(padspan.entry_id)
        await hass.async_block_till_done()
        assert padspan.state is ConfigEntryState.LOADED
    assert "padspan-ha" in hass.data["frontend_panels"]
    assert not _problems(caplog)


@pytest.mark.xfail(strict=True, reason="with the usage report on, a command that counts something schedules the "
                   "counters' save up to 120 s ahead (telemetry._persist_counters) and unloading does not cancel it")
async def test_unloading_leaves_no_counter_save_scheduled(hass, padspan, admin, everything_on):
    assert (await call(admin, {"type": "padspan_ha/store_backup_create"}))["success"]
    assert await hass.config_entries.async_unload(padspan.entry_id)
    await hass.async_block_till_done()
    assert not counter_save_timers(hass)
