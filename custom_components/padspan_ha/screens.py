# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""
Open screens — the PadSpan pages open right now, reloaded and spoken to from
Home Assistant
============================================================================
Every open PadSpan page (the panel, or the Atlas page on a wall) joins
through padspan_ha/screens_join, a websocket subscription, and leaves when
its socket goes. From Settings → Atlas → Open screens, or from an automation, a
screen can then be:

  reloaded    padspan_ha.reload_screens, or the "Reload" buttons: after an
              update, new code reaches a wall nobody is standing at.
  spoken to   padspan_ha.announce: the message big over the page for a few
              seconds, with a chime, and read aloud if asked.
  renamed     the name lives on the screen itself (its browser's storage).

Off by default: settings.screens_remote_enabled. Off, no page joins and
both services refuse. Nothing is written anywhere: the list lives in memory
and is gone after a restart, when the screens join again on their own.
"""
from __future__ import annotations

import functools
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError

from .const import DATA_SETTINGS, DOMAIN
from .quiet_errors import note as _quiet_error

_DATA = "_screens"
OFF_CODE = "screens_off"
OFF_MESSAGE = "Open screens is off. Turn it on in Settings → Atlas → Open screens."
MAX_SCREENS = 50
MESSAGE_MAX = 300
NAME_MAX = 60
SECONDS_DEFAULT, SECONDS_MIN, SECONDS_MAX = 15, 3, 300

_short = vol.All(str, vol.Length(max=120))


def _names(v):
    """screens: one name, or a list of them (an automation writes either)."""
    if v is None:
        return []
    if isinstance(v, (str, int, float)):
        v = [v]
    if not isinstance(v, (list, tuple)):
        raise vol.Invalid("screens must be a name or a list of names")
    return [str(x) for x in v if str(x).strip()]


_text = vol.All(vol.Coerce(str), vol.Strip)


def enabled(hass: HomeAssistant) -> bool:
    """The switch, settings.screens_remote_enabled (default off)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool(((st.data if st else {}) or {}).get("screens_remote_enabled", False))


def _screens(hass: HomeAssistant) -> dict[tuple[int, int], dict[str, Any]]:
    return hass.data.setdefault(DOMAIN, {}).setdefault(_DATA, {})


def _bump(hass: HomeAssistant, event: str) -> None:
    from .telemetry import bump  # noqa: PLC0415
    bump(hass, event)


def _count_sent(hass: HomeAssistant, cmd: str) -> None:
    """The field signal for Settings' buttons: a reload or a test announcement that reached a screen."""
    if cmd == "announce":
        _bump(hass, "screens_announce_test_sent")
    else:
        _bump(hass, "screens_reload_sent")


def listed(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The open screens, newest first, without their send handles. One
    browser open twice (two tabs) is two screens with the same id."""
    now = time.time()
    out = [{k: v for k, v in s.items() if k != "send"} | {"open_s": int(now - s["since"])}
           for s in _screens(hass).values()]
    return sorted(out, key=lambda s: -s["since"])


def _matches(screen: dict[str, Any], wanted: list[str] | None) -> bool:
    """No list: every screen. Otherwise by id, or by name (any case)."""
    if not wanted:
        return True
    w = {str(x).strip().casefold() for x in wanted if str(x).strip()}
    return screen["screen_id"].casefold() in w or screen["name"].strip().casefold() in w


def send(hass: HomeAssistant, payload: dict[str, Any], wanted: list[str] | None = None) -> int:
    """Push payload to the screens wanted; how many got it."""
    n = 0
    for s in list(_screens(hass).values()):
        if _matches(s, wanted):
            try:
                s["send"](payload)
                n += 1
            except Exception:  # noqa: BLE001 — a socket that just closed
                _quiet_error("screens:send")
                continue
    return n


def announcement(data: dict[str, Any]) -> dict[str, Any]:
    """The push a screen shows: the message, its optional title, how long,
    and whether to chime and to read it aloud."""
    return {"cmd": "announce", "message": str(data["message"])[:MESSAGE_MAX],
            "title": str(data.get("title") or "")[:NAME_MAX],
            "seconds": int(data.get("seconds", SECONDS_DEFAULT)),
            "chime": bool(data.get("chime", True)), "speak": bool(data.get("speak", False))}


ANNOUNCE_FIELDS = {
    vol.Required("message"): vol.All(_text, vol.Length(min=1, max=MESSAGE_MAX)),
    vol.Optional("title"): vol.All(_text, vol.Length(max=NAME_MAX)),
    vol.Optional("screens"): _names,
    vol.Optional("seconds", default=SECONDS_DEFAULT): vol.All(vol.Coerce(int), vol.Range(min=SECONDS_MIN, max=SECONDS_MAX)),
    vol.Optional("chime", default=True): bool,
    vol.Optional("speak", default=False): bool,
}


# ── Websocket ─────────────────────────────────────────────────────────────────

@websocket_api.websocket_command({
    "type": "padspan_ha/screens_join",
    vol.Required("screen_id"): vol.All(str, vol.Length(min=4, max=40)),
    vol.Optional("name", default=""): vol.All(str, vol.Length(max=NAME_MAX)),
    vol.Optional("page", default=""): vol.All(str, vol.Length(max=20)),
    vol.Optional("view", default=""): vol.All(str, vol.Length(max=40)),
    vol.Optional("kiosk", default=False): bool,
    vol.Optional("build", default=""): vol.All(str, vol.Length(max=20)),
    vol.Optional("device", default=""): _short,
})
@callback
def ws_screens_join(hass: HomeAssistant, connection, msg) -> None:
    """Subscription: the page is listed until its socket closes; pushes are
    {"cmd": "reload" | "announce" | "rename", ...}."""
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    screens = _screens(hass)
    key = (id(connection), msg["id"])
    if key not in screens and len(screens) >= MAX_SCREENS:
        connection.send_error(msg["id"], "too_many", f"At most {MAX_SCREENS} open screens are listed.")
        return
    user = getattr(connection, "user", None)

    def _send(payload: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    screens[key] = {"key": f"{key[0]:x}-{key[1]}", "screen_id": msg["screen_id"], "name": msg["name"].strip(),
                    "page": msg["page"], "view": msg["view"], "kiosk": msg["kiosk"], "build": msg["build"],
                    "device": msg["device"], "user": getattr(user, "name", "") or "",
                    "since": time.time(), "send": _send}
    connection.subscriptions[msg["id"]] = functools.partial(screens.pop, key, None)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({
    "type": "padspan_ha/screens_update",
    vol.Required("screen_id"): vol.All(str, vol.Length(min=4, max=40)),
    vol.Optional("view"): vol.All(str, vol.Length(max=40)),
    vol.Optional("name"): vol.All(str, vol.Length(max=NAME_MAX)),
})
@callback
def ws_screens_update(hass: HomeAssistant, connection, msg) -> None:
    """A screen telling what it shows now, or its new name. Only its own
    joins (this connection's) change."""
    n = 0
    for (cid, _), s in _screens(hass).items():
        if cid == id(connection) and s["screen_id"] == msg["screen_id"]:
            if "view" in msg:
                s["view"] = msg["view"]
            if "name" in msg:
                s["name"] = msg["name"].strip()
            n += 1
    connection.send_result(msg["id"], {"updated": n})


@websocket_api.websocket_command({"type": "padspan_ha/screens_list"})
@websocket_api.require_admin
@callback
def ws_screens_list(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], {"enabled": enabled(hass), "screens": listed(hass) if enabled(hass) else []})


@websocket_api.websocket_command({
    "type": "padspan_ha/screens_command",
    vol.Required("cmd"): vol.In(("reload", "rename", "announce")),
    vol.Optional("screens"): [str],
    vol.Optional("name"): vol.All(str, vol.Length(max=NAME_MAX)),
    vol.Optional("message"): vol.All(str, vol.Length(min=1, max=MESSAGE_MAX)),
})
@websocket_api.require_admin
@callback
def ws_screens_command(hass: HomeAssistant, connection, msg) -> None:
    """Settings' buttons: reload, rename one screen, or a test announcement."""
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    wanted = msg.get("screens")
    if msg["cmd"] == "rename":
        if not wanted or "name" not in msg:
            connection.send_error(msg["id"], "invalid", "Renaming needs the screen and its new name.")
            return
        payload: dict[str, Any] = {"cmd": "rename", "name": msg["name"].strip()}
    elif msg["cmd"] == "announce":
        message = msg.get("message")
        if not message:
            connection.send_error(msg["id"], "invalid", "An announcement needs a message.")
            return
        payload = announcement({"message": message})
    else:
        payload = {"cmd": "reload"}
    n = send(hass, payload, wanted)
    if msg["cmd"] == "rename":
        for s in _screens(hass).values():
            if _matches(s, wanted):
                s["name"] = payload["name"]
    elif n:
        _count_sent(hass, msg["cmd"])
    connection.send_result(msg["id"], {"sent": n, "screens": listed(hass)})


def register_ws(hass: HomeAssistant) -> None:
    for cmd in (ws_screens_join, ws_screens_update, ws_screens_list, ws_screens_command):
        websocket_api.async_register_command(hass, cmd)


# ── Services ──────────────────────────────────────────────────────────────────

def register_services(hass: HomeAssistant) -> None:
    """padspan_ha.reload_screens and padspan_ha.announce. Both refuse while
    the switch is off, so an automation says why instead of doing nothing."""

    def _check() -> None:
        if not enabled(hass):
            raise HomeAssistantError(OFF_MESSAGE)

    async def _reload(call: ServiceCall) -> dict[str, Any]:
        _check()
        n = send(hass, {"cmd": "reload"}, call.data.get("screens"))
        if n:
            _bump(hass, "screens_reload_sent")
        return {"screens": n}

    async def _announce(call: ServiceCall) -> dict[str, Any]:
        _check()
        n = send(hass, announcement(dict(call.data)), call.data.get("screens"))
        if n:
            _bump(hass, "screens_announce_sent")
        return {"screens": n}

    try:
        from homeassistant.core import SupportsResponse  # noqa: PLC0415
        kw: dict[str, Any] = {"supports_response": SupportsResponse.OPTIONAL}
    except ImportError:
        kw = {}
    hass.services.async_register(DOMAIN, "reload_screens", _reload,
                                 schema=vol.Schema({vol.Optional("screens"): _names}), **kw)
    hass.services.async_register(DOMAIN, "announce", _announce, schema=vol.Schema(ANNOUNCE_FIELDS), **kw)
