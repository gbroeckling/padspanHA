# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every websocket command, called in a real Home Assistant.

Each command gets a Home Assistant of its own, so one that resets or reloads
the integration cannot disturb the next.
"""

from __future__ import annotations

import re

import pytest
from homeassistant.components import websocket_api

from . import commands as C
from .conftest import call

DECLARED = C.declared()
ADMIN_ONLY = sorted(c for c, d in DECLARED.items() if d.admin_only)
SWITCH_GATED = C.switch_gated()

# An error text that is Python's own, not a refusal a person wrote.
_PYTHON_ERROR = re.compile(
    r"is not defined|has no attribute|positional argument|keyword argument|"
    r"object is not (subscriptable|iterable|callable)|unsupported operand|referenced before assignment")


# A refusal code that says a feature is switched off or needs a licence.
_SWITCHED_OFF = re.compile(r"(^|_)off$|^(bright|pro)_required$|^tier$|^not_enabled$")


def _registered(hass) -> dict:
    """command -> (handler, schema), as Home Assistant holds them."""
    return {t[len(C.PREFIX):]: v for t, v in hass.data[websocket_api.DOMAIN].items() if t.startswith(C.PREFIX)}


def _message(hass, command: str) -> dict:
    return C.minimal_message(command, _registered(hass)[command][1])


def test_the_scan_finds_the_commands():
    assert len(DECLARED) > 150, "the scan found too few commands to mean anything"
    assert len(ADMIN_ONLY) > 50 and len(SWITCH_GATED) > 30


async def test_every_declared_command_is_registered(hass, padspan):
    registered = set(_registered(hass))
    assert sorted(set(DECLARED) - registered) == [], "declared in the source, never registered"
    assert sorted(registered - set(DECLARED)) == [], "registered, but the scan of the source does not find it"


def test_the_switch_list_matches_the_source():
    in_source = sorted(c for c, d in DECLARED.items() if d.switch_gated)
    assert in_source == SWITCH_GATED, "tests/test_enhanced_security.py GATED and the decorators disagree"


async def _answer(client, msg: dict) -> dict:
    """The reply to a minimal valid message: a result, or a refusal with a
    code. Never Home Assistant's "unknown_error" (the handler raised), never
    Python's own error text passed on as the refusal, never silence."""
    try:
        reply = await call(client, msg)
    except TimeoutError:
        pytest.fail(f"no answer to {msg}")
    if not reply["success"]:
        error = reply["error"]
        assert error["code"] != "unknown_error", f"the handler raised on {msg}"
        assert error["code"] != "invalid_format", f"{msg} is not what the schema accepts: {error['message']}"
        assert not _PYTHON_ERROR.search(str(error["message"])), f"{msg} was refused with a Python error: {error}"
    return reply


@pytest.mark.parametrize("command", sorted(DECLARED))
async def test_a_command_answers(hass, admin, command):
    """In the house as installed: free, sample data, every extra off."""
    await _answer(admin, _message(hass, command))


@pytest.mark.parametrize("command", sorted(DECLARED))
async def test_a_command_answers_with_everything_on(hass, admin, everything_on, command):
    """In a Pro house with every switch on, where no command may stop at
    "this is off": about a quarter of them do in the house as installed."""
    reply = await _answer(admin, _message(hass, command))
    if not reply["success"]:
        assert not _SWITCHED_OFF.search(reply["error"]["code"]), f"still off in the everything_on house: {reply['error']}"


@pytest.mark.parametrize("command", ADMIN_ONLY)
async def test_an_admin_only_command_refuses_a_member(hass, member, command):
    reply = await call(member, _message(hass, command))
    assert not reply["success"]
    assert reply["error"]["code"] == "unauthorized"


async def _switch_on(admin) -> None:
    reply = await call(admin, {"type": "padspan_ha/settings_set", "enhanced_security": True})
    assert reply["success"], reply


@pytest.mark.parametrize("command", SWITCH_GATED)
async def test_a_switch_gated_command_refuses_a_member_when_on(hass, admin, member, command):
    await _switch_on(admin)
    reply = await call(member, _message(hass, command))
    assert not reply["success"]
    assert reply["error"]["code"] == "admin_only"


async def test_settings_with_the_switch_on(hass, admin, member):
    """settings_set is gated key by key (PER_KEY in the main suite's lists)."""
    assert C.security_lists()["PER_KEY"] == {"settings_set"}
    # Only an administrator turns the switch on.
    reply = await call(member, {"type": "padspan_ha/settings_set", "enhanced_security": True})
    assert reply["error"]["code"] == "unauthorized"
    await _switch_on(admin)
    # The home's setup is an administrator's; a person's own view stays theirs.
    reply = await call(member, {"type": "padspan_ha/settings_set", "update_check_enabled": False})
    assert reply["error"]["code"] == "admin_only"
    reply = await call(member, {"type": "padspan_ha/settings_set", "light_theme": True})
    assert reply["success"], reply
    settings = (await call(member, {"type": "padspan_ha/settings_get"}))["result"]["settings"]
    assert settings.get("light_theme") is True and settings.get("update_check_enabled") is not False
