# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Open screens (screens.py, views/screens_client.js, views/screens_card.js).

What must hold: off by default, and off, no page joins, the list is empty
and both services refuse; a page joins and leaves with its socket; reload,
rename and announce reach only the screens asked for (by id or name, any
case) or all; an announcement is cut to its limits; the page shows it as
text, never HTML; the panel and the Atlas page join only while the setting
is on, and the Atlas page not inside the panel.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import screens as S
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
WWW = ROOT / "www" / "padspan-ha"


def _run(coro):
    return asyncio.run(coro)


def _hass(on=True):
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={"screens_remote_enabled": on})}})


def _conn(user="Garry"):
    return SimpleNamespace(subscriptions={}, send_message=MagicMock(), send_result=MagicMock(),
                           send_error=MagicMock(), user=SimpleNamespace(name=user))


def _join(hass, conn, mid, sid, name="", **kw):
    msg = {"id": mid, "type": "padspan_ha/screens_join", "screen_id": sid, "name": name, "page": kw.get("page", "atlas"),
           "view": kw.get("view", ""), "kiosk": kw.get("kiosk", True), "build": "20261123T070705Z", "device": "Fully Kiosk · Android"}
    S.ws_screens_join(hass, conn, msg)


def _pushes(conn):
    return [c.args[0] for c in conn.send_message.call_args_list]


def test_off_by_default():
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS as DEFAULTS
    assert DEFAULTS["screens_remote_enabled"] is False
    ws = (ROOT / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("screens_remote_enabled"): bool' in ws
    assert '"subzones_enabled", "screens_remote_enabled",' in ws      # the handler's allowlist


def test_off_no_join_no_list():
    hass, conn = _hass(False), _conn()
    _join(hass, conn, 1, "abcd1234")
    conn.send_error.assert_called_once()
    assert conn.send_error.call_args.args[1] == S.OFF_CODE
    assert S.listed(hass) == []
    lst = _conn()
    S.ws_screens_list(hass, lst, {"id": 2})
    assert lst.send_result.call_args.args[1] == {"enabled": False, "screens": []}


def test_join_lists_and_socket_close_leaves():
    hass, conn = _hass(), _conn()
    _join(hass, conn, 5, "abcd1234", name="Kitchen tablet")
    conn.send_result.assert_called_once_with(5)
    [s] = S.listed(hass)
    assert s["name"] == "Kitchen tablet" and s["user"] == "Garry" and s["kiosk"] is True and "send" not in s
    conn.subscriptions[5]()          # the socket closed: HA calls the unsubscribe
    assert S.listed(hass) == []


def test_reload_rename_announce_reach_only_the_wanted():
    hass = _hass()
    a, b = _conn(), _conn()
    _join(hass, a, 1, "aaaa1111", name="Kitchen tablet")
    _join(hass, b, 1, "bbbb2222", name="Hall TV")
    assert S.send(hass, {"cmd": "reload"}, ["kitchen TABLET"]) == 1
    assert len(_pushes(a)) == 1 and _pushes(b) == []
    assert S.send(hass, {"cmd": "reload"}, ["bbbb2222"]) == 1
    assert S.send(hass, {"cmd": "reload"}) == 2
    c = _conn()
    S.ws_screens_command(hass, c, {"id": 9, "cmd": "rename", "screens": ["aaaa1111"], "name": "  Fridge  "})
    assert {s["screen_id"]: s["name"] for s in S.listed(hass)}["aaaa1111"] == "Fridge"
    assert c.send_result.call_args.args[1]["sent"] == 1


def test_command_refused_off_and_rename_needs_target():
    hass, c = _hass(False), _conn()
    S.ws_screens_command(hass, c, {"id": 1, "cmd": "reload"})
    assert c.send_error.call_args.args[1] == S.OFF_CODE
    hass, c = _hass(), _conn()
    S.ws_screens_command(hass, c, {"id": 1, "cmd": "rename", "name": "X"})
    assert c.send_error.call_args.args[1] == "invalid"


def test_update_changes_only_its_own_connection():
    hass = _hass()
    a, b = _conn(), _conn()
    _join(hass, a, 1, "same1234", page="panel", view="overview")
    _join(hass, b, 1, "same1234", page="panel", view="overview")     # one browser, two tabs
    S.ws_screens_update(hass, a, {"id": 2, "screen_id": "same1234", "view": "follow"})
    assert sorted(s["view"] for s in S.listed(hass)) == ["follow", "overview"]


def test_announcement_limits():
    a = S.announcement({"message": "x" * 999, "title": "t" * 99})
    assert len(a["message"]) == S.MESSAGE_MAX and len(a["title"]) == S.NAME_MAX
    assert a["seconds"] == S.SECONDS_DEFAULT and a["chime"] is True and a["speak"] is False
    import voluptuous as vol
    schema = vol.Schema(S.ANNOUNCE_FIELDS)
    with pytest.raises(vol.Invalid):
        schema({"message": ""})
    with pytest.raises(vol.Invalid):
        schema({"message": "hi", "seconds": 1})
    assert schema({"message": "hi"})["seconds"] == 15
    # An automation writes one screen as a string, and a template can render a number.
    assert schema({"message": 42, "screens": "Kitchen tablet"}) == {
        "message": "42", "screens": ["Kitchen tablet"], "seconds": 15, "chime": True, "speak": False}


def test_announce_without_a_message_is_refused():
    hass, c = _hass(), _conn()
    S.ws_screens_command(hass, c, {"id": 1, "cmd": "announce"})
    assert c.send_error.call_args.args[1] == "invalid"


def test_handlers_are_callbacks_not_tasks():
    """Joined on the loop at once: a socket that closes first never leaves an entry behind."""
    src = (ROOT / "screens.py").read_text(encoding="utf-8")
    assert "async def ws_screens" not in src and src.count("@callback\ndef ws_screens") == 4


def test_services_refuse_off_and_send_on(monkeypatch):
    from homeassistant.exceptions import HomeAssistantError
    monkeypatch.setattr(S.websocket_api, "event_message", lambda i, p: {"id": i, "type": "event", "event": p}, raising=False)
    registered = {}
    hass = _hass(False)
    hass.services = SimpleNamespace(async_register=lambda d, name, fn, **kw: registered.__setitem__(name, fn))
    S.register_services(hass)
    assert set(registered) == {"reload_screens", "announce"}
    with pytest.raises(HomeAssistantError):
        _run(registered["announce"](SimpleNamespace(data={"message": "hi"})))
    hass.data[DOMAIN][DATA_SETTINGS].data["screens_remote_enabled"] = True
    conn = _conn()
    _join(hass, conn, 1, "abcd1234", name="Hall")
    r = _run(registered["announce"](SimpleNamespace(data={"message": "Dinner", "seconds": 20, "chime": True, "speak": True})))
    assert r == {"screens": 1}
    ev = _pushes(conn)[-1]["event"]
    assert ev == {"cmd": "announce", "message": "Dinner", "title": "", "seconds": 20, "chime": True, "speak": True}
    assert _run(registered["reload_screens"](SimpleNamespace(data={"screens": ["nobody"]}))) == {"screens": 0}


def test_services_declared():
    y = (ROOT / "services.yaml").read_text(encoding="utf-8")
    assert "\nreload_screens:" in y and "\nannounce:" in y
    import json
    for p in (ROOT / "strings.json", ROOT / "translations" / "en.json"):
        sv = json.loads(p.read_text(encoding="utf-8"))["services"]
        assert {"reload_screens", "announce"} <= set(sv)


def test_page_shows_text_never_html_and_joins_only_when_on():
    js = (WWW / "views" / "screens_client.js").read_text(encoding="utf-8")
    body = js.split("export function showAnnouncement", 1)[1].split("\nexport function", 1)[0]
    assert "innerHTML" not in body and "tx.textContent = msg" in body
    panel = (WWW / "panel.js").read_text(encoding="utf-8")
    assert "screens_remote_enabled === true" in panel and "this._screenSync();" in panel
    lights = (WWW / "lights_panel.js").read_text(encoding="utf-8")
    sync = lights.split("  _screenSync(){", 1)[1].split("\n  }", 1)[0]
    assert "this._embedded" in sync and "this._screensOn === true" in sync


def test_registered():
    ws = (ROOT / "websocket.py").read_text(encoding="utf-8")
    assert "from .screens import register_ws" in ws
    init = (ROOT / "__init__.py").read_text(encoding="utf-8")
    assert "from .screens import register_services" in init
