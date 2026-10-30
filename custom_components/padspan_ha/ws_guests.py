# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket commands for guest tags (guest_tags.py).

- guests_get: reads. Works while the feature is off (says so) and writes
  nothing; with it off it does not even create the store.
- guest_tag_mark / guest_tag_unmark / guest_session_start / _update / _end /
  _forget: admin only, refused while settings.guest_tags_enabled is off.
"""
from __future__ import annotations

import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_DEVICE_REGISTRY, DOMAIN
from .guest_tags import (RETENTION_CHOICES, async_get_store, enabled, fire, retention_days, session_out,
                         store_if_loaded, tag_state, valid_quiet)
from .ws_common import admin_if_enhanced_security

OFF_CODE = "guest_tags_off"
OFF_MESSAGE = "Guest tags are off. Turn them on in Settings → Tracking → Guest tags."
_TAG_KINDS = ("ibeacon", "private_ble", "findmy", "ble", "entity")


def _bump(hass: HomeAssistant, name: str) -> None:
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, name)
    except Exception:  # noqa: BLE001
        pass


async def _objects(hass: HomeAssistant) -> list[dict]:
    try:
        from .snapshot_builder import _live_snapshot  # noqa: PLC0415
        snap = await _live_snapshot(hass)
        return [o for o in ((snap.get("objects") or {}).get("list") or []) if isinstance(o, dict)]
    except Exception:  # noqa: BLE001
        return []


def _kind_of(o: dict) -> str:
    if o.get("findmy") or str(o.get("key") or "").startswith("findmy:"):
        return "findmy"
    k = str(o.get("kind") or "ble")
    return k if k in _TAG_KINDS else "ble"


@websocket_api.websocket_command({"type": "padspan_ha/guests_get"})
@websocket_api.async_response
@admin_if_enhanced_security
async def ws_guests_get(hass: HomeAssistant, connection, msg) -> None:
    """The guest tags, the stays (running and kept), and the labelled devices
    that could become a guest tag."""
    on = enabled(hass)
    out: dict[str, Any] = {"enabled": on, "retention_days": retention_days(hass), "tags": [], "sessions": [],
                           "candidates": []}
    if not on:
        connection.send_result(msg["id"], out)
        return
    st = await async_get_store(hass)
    now = time.time()
    objs = await _objects(hass)
    by_key = {str(o.get("key") or ""): o for o in objs}
    from .presence_rules import away_timeout_s, is_away  # noqa: PLC0415
    _away = away_timeout_s(hass)
    present = {k for k, o in by_key.items() if not is_away(o, _away)}
    for pid, tag in st.tags().items():
        is_here, room, _keys = tag_state(tag, by_key, present)
        act = st.active_for(pid)
        out["tags"].append({**tag, "present": is_here, "room": room, "session": act.get("id") if act else None,
                            "guest": act.get("name") if act else None})
    for s in sorted(st.sessions().values(), key=lambda s: -(s.get("start") or 0)):
        out["sessions"].append(session_out(s, st.tags().get(s.get("pid")), now))
    marked = {k for t in st.tags().values() for k in (t.get("keys") or [])}
    seen_labels = set()
    for o in objs:
        lbl = str(o.get("user_label") or "").strip()
        k = str(o.get("key") or "")
        if not lbl or k in marked or lbl.lower() in seen_labels or o.get("kind") == "entity":
            continue
        seen_labels.add(lbl.lower())
        out["candidates"].append({"key": k, "label": lbl, "kind": _kind_of(o), "room": o.get("room"),
                                  "age_s": o.get("age_s")})
    connection.send_result(msg["id"], out)


async def _on_or_refuse(hass: HomeAssistant, connection, msg) -> Any:
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return None
    return await async_get_store(hass)


@websocket_api.websocket_command({"type": "padspan_ha/guest_tag_mark", vol.Required("key"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_guest_tag_mark(hass: HomeAssistant, connection, msg) -> None:
    """Make a labelled device a guest tag. Its label stays the tag's."""
    st = await _on_or_refuse(hass, connection, msg)
    if st is None:
        return
    key = str(msg["key"]).strip()
    obj = next((o for o in await _objects(hass) if str(o.get("key") or "") == key), None)
    if not obj or not str(obj.get("user_label") or "").strip():
        connection.send_error(msg["id"], "not_labelled", "Give the tag a name first (Devices → Rename), then use it as a guest tag.")
        return
    reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    pid = obj.get("padspan_id") or ""
    if reg is not None:
        try:
            pid = reg.resolve_or_create(key, kind="ibeacon" if key.startswith("ibeacon:") else "mac", persist=True) or pid
        except Exception:  # noqa: BLE001
            pass
    if not pid:
        connection.send_error(msg["id"], "no_identity", "PadSpan has no steady identity for this device yet.")
        return
    keys = [key, obj.get("address"), obj.get("canonical_id"), *(obj.get("all_addresses") or [])[:8]]
    tag = st.mark(pid, str(obj["user_label"]).strip(), [k for k in keys if k], _kind_of(obj), time.time())
    _bump(hass, "guest_tag_marked")
    connection.send_result(msg["id"], {"tag": tag})


@websocket_api.websocket_command({"type": "padspan_ha/guest_tag_unmark", vol.Required("pid"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_guest_tag_unmark(hass: HomeAssistant, connection, msg) -> None:
    st = await _on_or_refuse(hass, connection, msg)
    if st is None:
        return
    try:
        found = st.unmark(msg["pid"])
    except ValueError as err:
        connection.send_error(msg["id"], "busy", str(err))
        return
    connection.send_result(msg["id"], {"removed": found})


_OPTS = {
    vol.Optional("off_limits"): [str],
    vol.Optional("notify_arrive"): bool,
    vol.Optional("notify_leave"): bool,
    vol.Optional("notify_target"): str,
    vol.Optional("quiet"): str,
    vol.Optional("counts_home"): bool,
}


def _opts_of(msg: dict) -> dict:
    return {k: msg[k] for k in ("off_limits", "notify_arrive", "notify_leave", "notify_target", "quiet", "counts_home") if k in msg}


@websocket_api.websocket_command({"type": "padspan_ha/guest_session_start", vol.Required("pid"): str,
                                  vol.Required("name"): str, vol.Optional("end_at"): vol.Any(None, vol.Coerce(float)),
                                  **_OPTS})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_guest_session_start(hass: HomeAssistant, connection, msg) -> None:
    """Lend a guest tag: who, until when, and how the stay is watched."""
    st = await _on_or_refuse(hass, connection, msg)
    if st is None:
        return
    if "quiet" in msg and not valid_quiet(msg["quiet"]):
        connection.send_error(msg["id"], "invalid_format", "Quiet hours are HH:MM-HH:MM.")
        return
    now = time.time()
    end_at = msg.get("end_at")
    if end_at and not (now < end_at <= now + 366 * 86400):
        connection.send_error(msg["id"], "invalid_format", "The end must be in the next year.")
        return
    try:
        s = st.start(msg["pid"], msg["name"], now, end_at, _opts_of(msg))
    except ValueError as err:
        connection.send_error(msg["id"], "refused", str(err))
        return
    await st.async_save_now()
    _bump(hass, "guest_session_started")
    fire(hass, "started", s, st.tags().get(s["pid"]))
    connection.send_result(msg["id"], {"session": session_out(s, st.tags().get(s["pid"]), now)})


@websocket_api.websocket_command({"type": "padspan_ha/guest_session_update", vol.Required("session"): str,
                                  vol.Optional("name"): str, vol.Optional("end_at"): vol.Any(None, vol.Coerce(float)),
                                  **_OPTS})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_guest_session_update(hass: HomeAssistant, connection, msg) -> None:
    st = await _on_or_refuse(hass, connection, msg)
    if st is None:
        return
    if "quiet" in msg and not valid_quiet(msg["quiet"]):
        connection.send_error(msg["id"], "invalid_format", "Quiet hours are HH:MM-HH:MM.")
        return
    fields: dict[str, Any] = {}
    if "name" in msg:
        fields["name"] = msg["name"]
    if "end_at" in msg:
        fields["end_planned"] = msg["end_at"]
    opts = _opts_of(msg)
    if opts:
        fields["opts"] = opts
    now = time.time()
    try:
        s = st.update(msg["session"], now, **fields)
    except ValueError as err:
        connection.send_error(msg["id"], "refused", str(err))
        return
    connection.send_result(msg["id"], {"session": session_out(s, st.tags().get(s["pid"]), now)})


@websocket_api.websocket_command({"type": "padspan_ha/guest_session_end", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_guest_session_end(hass: HomeAssistant, connection, msg) -> None:
    """The tag is back: the stay ends, its report is kept."""
    st = await _on_or_refuse(hass, connection, msg)
    if st is None:
        return
    now = time.time()
    try:
        s = st.end(msg["session"], now, "manual")
    except ValueError as err:
        connection.send_error(msg["id"], "refused", str(err))
        return
    await st.async_save_now()
    _bump(hass, "guest_session_ended")
    fire(hass, "ended", s, st.tags().get(s["pid"]), {"how": "manual"})
    connection.send_result(msg["id"], {"session": session_out(s, st.tags().get(s["pid"]), now)})


@websocket_api.websocket_command({"type": "padspan_ha/guest_session_forget", vol.Required("session"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_guest_session_forget(hass: HomeAssistant, connection, msg) -> None:
    """Delete a finished stay now, name and report."""
    st = store_if_loaded(hass) or await _on_or_refuse(hass, connection, msg)
    if st is None:
        return
    try:
        found = st.forget(msg["session"])
    except ValueError as err:
        connection.send_error(msg["id"], "refused", str(err))
        return
    await st.async_save_now()
    connection.send_result(msg["id"], {"forgotten": found})


WS_COMMANDS = (ws_guests_get, ws_guest_tag_mark, ws_guest_tag_unmark, ws_guest_session_start,
               ws_guest_session_update, ws_guest_session_end, ws_guest_session_forget)
__all__ = ["WS_COMMANDS", "RETENTION_CHOICES"]
