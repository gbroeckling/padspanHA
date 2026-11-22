# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A phone's key is an administrator's.

Settings sent to someone who is not an administrator carry each saved phone's
name and no key; an administrator's settings are as they were. Testing a key
and looking for keys are administrator-only, as saving and removing one are.
The reply to saving a key no longer repeats it.
"""

from __future__ import annotations

import ast
import asyncio
import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ws_common as C
from custom_components.padspan_ha import ws_irk
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_KEY_A = "ec0234a357c8ad05341010a60a397d9b"
_KEY_B = "000102030405060708090a0b0c0d0e0f"
_STORED = [{"name": "Alex's iPhone", "irk_hex": _KEY_A, "via": "irk_capture"},
           {"name": "Sam's watch", "irk_hex": _KEY_B}]
_HEX32 = re.compile(r"[0-9a-fA-F]{32}")


def _hass() -> MagicMock:
    st = MagicMock()
    st.data = {"forensics_license_key": "", "forensics_license_expires": "", "data_mode": "live",
               "irk_devices": [dict(d) for d in _STORED]}
    h = MagicMock()
    h.data = {DOMAIN: {DATA_SETTINGS: st}}
    return h


def _conn(admin) -> MagicMock:
    conn = MagicMock()
    conn.user = SimpleNamespace(is_admin=admin)
    return conn


def _settings_get(admin) -> tuple[dict, MagicMock]:
    h, conn = _hass(), _conn(admin)
    asyncio.run(WS.ws_settings_get(h, conn, {"id": 1}))
    return conn.send_result.call_args.args[1]["settings"], h


def test_settings_for_someone_who_is_not_an_administrator_carry_no_phone_key():
    out, h = _settings_get(False)
    assert out["irk_devices"] == [{"name": "Alex's iPhone", "via": "irk_capture"}, {"name": "Sam's watch"}]
    text = json.dumps(out)
    assert _KEY_A not in text.lower() and _KEY_B not in text.lower()
    assert not _HEX32.search(json.dumps(out["irk_devices"]))
    # The store keeps them: only the reply is shorter.
    assert h.data[DOMAIN][DATA_SETTINGS].data["irk_devices"] == _STORED


def test_an_administrators_settings_are_as_they_were():
    out, _h = _settings_get(True)
    assert out["irk_devices"] == _STORED


@pytest.mark.parametrize("connection", [None, SimpleNamespace(), SimpleNamespace(user=None),
                                        SimpleNamespace(user=SimpleNamespace()),
                                        SimpleNamespace(user=SimpleNamespace(is_admin="yes")), MagicMock()])
def test_a_caller_not_known_to_be_an_administrator_gets_no_phone_key(connection):
    out = C._get_settings(_hass(), connection)
    assert not _HEX32.search(json.dumps(out["irk_devices"]))
    assert [d["name"] for d in out["irk_devices"]] == ["Alex's iPhone", "Sam's watch"]


def test_a_home_with_no_saved_phone_keys_gets_an_empty_list():
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data.pop("irk_devices")
    assert C._get_settings(h, _conn(False))["irk_devices"] == []


def test_every_reply_that_carries_the_settings_says_who_asked():
    # Each command that answers with the settings passes its connection, so
    # an administrator's reply is whole and anyone else's has no phone key.
    seen = 0
    for f in sorted(_CC.glob("*.py")):
        src = f.read_text(encoding="utf-8")
        assert '"settings": _get_settings(hass)' not in src, f.name
        seen += src.count('"settings": _get_settings(hass, connection)')
    assert seen == 7


def _decorators(name: str) -> list[str]:
    tree = ast.parse((_CC / "ws_irk.py").read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == name)
    return [ast.unparse(d) for d in fn.decorator_list]


@pytest.mark.parametrize("handler", ["ws_irk_validate", "ws_irk_auto_detect", "ws_irk_add", "ws_irk_remove"])
def test_the_phone_key_commands_are_administrator_only(handler):
    # Home Assistant's own decorator refuses a caller who is not an
    # administrator before the handler runs (the tests stub it, so the source
    # is what shows it). It sits under the command decorator, above async_response.
    decs = _decorators(handler)
    assert "websocket_api.require_admin" in decs, handler
    assert decs.index("websocket_api.require_admin") < decs.index("websocket_api.async_response")
    assert "websocket_command" in decs[0]


def test_saving_a_key_does_not_repeat_it_in_the_reply(monkeypatch):
    resolver = SimpleNamespace(device_count=1)
    async def _load(): return None
    resolver.async_load = _load
    async def _get(hass): return resolver
    monkeypatch.setattr(ws_irk, "_get_ble_resolver", _get)
    ble = MagicMock()
    ble.get_snapshot = lambda **kw: {"advertisements": []}
    monkeypatch.setattr(ws_irk, "get_bluetooth_live", lambda hass: ble)
    h = MagicMock()
    settings = SimpleNamespace(data={"irk_devices": []})
    async def _set(**kw): settings.data.update(kw)
    settings.async_set = _set
    h.data = {DOMAIN: {DATA_SETTINGS: settings}}
    h.states.async_all = lambda domain=None: []
    conn = _conn(True)
    asyncio.run(ws_irk.ws_irk_add(h, conn, {"id": 1, "name": "Alex's iPhone", "irk_hex": _KEY_A, "force": True}))
    reply = conn.send_result.call_args.args[1]
    assert reply["ok"] is True and "irk_hex" not in reply
    # The phone wizard links the new phone by this id (views/iphone_irk.js).
    assert reply["canonical_id"] == f"irk:{_KEY_A}"
    assert settings.data["irk_devices"] == [{"name": "Alex's iPhone", "irk_hex": _KEY_A}]
