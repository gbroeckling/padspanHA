# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""PadSpan HA inside a real Home Assistant.

The main suite (tests/) replaces the `homeassistant` package with stubs, so
nothing there loads the integration the way Home Assistant does. These tests
do: a real Home Assistant core from pytest-homeassistant-custom-component,
the integration set up from a config entry, and every websocket command
called over a real websocket connection.

They run apart from the main suite, in their own environment (Linux or WSL;
Home Assistant does not import on Windows):

    pip install -r requirements_test_ha.txt
    python -m pytest tests_ha

The house they run in has no Bluetooth adapter, no MQTT and no recorder. Its
config folder is the test's temp folder, Home Assistant's storage is kept in
memory by the harness, and no request leaves the machine (see `network`).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import aiohttp
import pytest
from homeassistant.auth.const import GROUP_ID_USER
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HassJob
from homeassistant.setup import async_setup_component
from homeassistant.util.async_ import get_scheduled_timer_handles
from pytest_homeassistant_custom_component.common import MockConfigEntry
from yarl import URL

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:       # so `custom_components.padspan_ha` is found
    sys.path.insert(0, str(ROOT))

DOMAIN = "padspan_ha"
# No single command may take longer than this to answer.
ANSWER_WITHIN_S = 20


@pytest.fixture
def hass_config_dir(tmp_path: Path) -> str:
    """Home Assistant's config folder: an empty temp folder, so the plan
    images and backups the integration writes stay inside the test."""
    path = tmp_path / "config"
    path.mkdir()
    return str(path)


@pytest.fixture(autouse=True)
def _custom_integrations(enable_custom_integrations: None) -> None:
    """Let Home Assistant load integrations from custom_components/."""


@pytest.fixture(autouse=True)
def network(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """No request leaves the machine: every aiohttp request or websocket to
    anything but this test's own Home Assistant fails as an offline house
    would, and its address is noted here. (The harness also fails a test
    that opens any other socket.)"""
    tried: list[str] = []
    real_request = aiohttp.ClientSession._request
    real_ws_connect = aiohttp.ClientSession._ws_connect

    def _local(url) -> bool:
        return URL(str(url)).host in ("127.0.0.1", "localhost", "::1")

    async def _request(self, method, url, *args, **kwargs):
        if _local(url):
            return await real_request(self, method, url, *args, **kwargs)
        tried.append(f"{method} {url}")
        raise aiohttp.ClientConnectionError("the network is blocked in tests")

    async def _ws_connect(self, url, *args, **kwargs):
        if _local(url):
            return await real_ws_connect(self, url, *args, **kwargs)
        tried.append(f"WS {url}")
        raise aiohttp.ClientConnectionError("the network is blocked in tests")

    monkeypatch.setattr(aiohttp.ClientSession, "_request", _request)
    monkeypatch.setattr(aiohttp.ClientSession, "_ws_connect", _ws_connect)
    return tried


@pytest.fixture
async def padspan(hass) -> MockConfigEntry:
    """The integration set up as Home Assistant sets it up: the web server
    and the websocket API first (every Home Assistant has both), then the
    config entry, then everything the setup left running in the background."""
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, title="PadSpan HA", data={})
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    return entry


@pytest.fixture
async def everything_on(hass, padspan) -> None:
    """The same house with a Pro key, live data and every switch that is off
    by default turned on, so a command runs its own code instead of answering
    that its feature is off."""
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS  # noqa: PLC0415

    await hass.data[DOMAIN]["settings"].async_set(
        **{key: True for key, value in DEFAULT_SETTINGS.items() if value is False},
        data_mode="live", forensics_license_key="PSPAN-TEST-TEST-TEST-TEST")
    await hass.async_block_till_done()
    yield
    # With the usage report on, a command that counts something leaves the
    # counters' save scheduled after the integration is unloaded
    # (test_setup.py holds that as a known failure). That one timer is
    # cancelled here so the harness still fails the test on any other.
    for timer in counter_save_timers(hass):
        timer.cancel()


def counter_save_timers(hass) -> list:
    """The usage report's pending counter saves (telemetry._persist_counters)."""
    return [handle for handle in get_scheduled_timer_handles(hass.loop)
            if not handle.cancelled() and handle._args and isinstance(handle._args[-1], HassJob)
            and "_persist_counters" in getattr(handle._args[-1].target, "__qualname__", "")]


@pytest.fixture
async def admin(hass, padspan, hass_ws_client):
    """A websocket connection signed in as an administrator."""
    return await hass_ws_client(hass)


@pytest.fixture
async def member(hass, padspan, hass_ws_client):
    """A websocket connection signed in as an ordinary household member:
    a Home Assistant user who is not an administrator."""
    user = await hass.auth.async_create_user("Household member", group_ids=[GROUP_ID_USER])
    assert not user.is_admin
    token = await hass.auth.async_create_refresh_token(user, "https://example.test")
    return await hass_ws_client(hass, hass.auth.async_create_access_token(token))


async def call(client, msg: dict) -> dict:
    """Send one command and return Home Assistant's reply to it. Raises
    TimeoutError if none comes within ANSWER_WITHIN_S."""
    await client.send_json_auto_id(msg)
    async with asyncio.timeout(ANSWER_WITHIN_S):
        while True:
            reply = await client.receive_json()
            if reply.get("type") == "result":
                return reply
