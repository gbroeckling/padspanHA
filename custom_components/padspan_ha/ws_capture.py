# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for RSSI vector capture sessions.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import DOMAIN, DATA_MODEL
from .ws_common import _get_settings
from .telemetry import bump as _bump

_LOGGER = logging.getLogger(__name__)


def _capture_store(hass: HomeAssistant):
    from .const import DATA_CAPTURE

    return hass.data.get(DOMAIN, {}).get(DATA_CAPTURE)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/capture_start",
        vol.Optional("minutes", default=5): vol.All(vol.Coerce(int), vol.Range(min=1, max=60)),
        vol.Optional("label", default=""): str,
        vol.Optional("keys", default=[]): list,
        vol.Optional("ground_truth", default=""): str,
        vol.Optional("include_calibration", default=False): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_start(hass: HomeAssistant, connection, msg) -> None:
    """Open a recording session against the live coordinator state."""
    from .capture_store import build_header

    cap = _capture_store(hass)
    if not cap:
        connection.send_error(msg["id"], "no_capture", "CaptureStore not loaded")
        return
    if _get_settings(hass).get("rssi_capture_enabled") is not True:
        connection.send_error(msg["id"], "not_enabled",
                              "Enable RSSI Vector Capture in Settings → Features")
        return
    # "presence_coordinator", NOT DATA_COORDINATOR — those are two different
    # objects. DATA_COORDINATOR is the PadSpanCoordinator that drives the
    # snapshot; the positioning state a capture records (Kalman filters, votes,
    # scanner geometry) lives on the PresenceCoordinator, which is stored under
    # its own literal key. Everything else that needs it reads it this way too.
    coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    if not coord:
        connection.send_error(msg["id"], "no_coordinator", "Presence coordinator not ready")
        return
    if cap.recording:
        connection.send_error(msg["id"], "already_recording",
                              "A capture session is already running")
        return
    # The coordinator's poll IS the recorder's clock, so a session started
    # before the first poll records a header, an end line, and nothing else —
    # while reporting a healthy scanner count, because that comes from the
    # fabric rather than from anything having run. Measured after a restart:
    # a full minute of "recording" with zero frames and no error anywhere.
    # Refusing is the only answer that tells the truth.
    if getattr(coord, "data", None) is None:
        connection.send_error(
            msg["id"], "not_polling",
            "Positioning has not completed its first poll yet — wait a few "
            "seconds after a restart and try again")
        return

    # Scanner attribution comes from the fabric, which is where the coordinator
    # reads it from every poll — not from a fresh scan.  A session must be
    # pinned to what the pipeline is actually running on.  Any radio the fabric
    # does not know about yet is appended by the first frame's env line.
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    s2a, s2f = model.get_scanner_mappings() if model else ({}, {})
    s2a, s2f = dict(s2a), dict(s2f)
    srcs = sorted(set(getattr(coord, "_scanner_positions", None) or {}) | set(s2a))
    rooms = set(model.room_geometry_m()) if model else set()

    # The vote window is derived, not stored — the coordinator recomputes it
    # every poll from room_change_delay_s against the live poll interval.  The
    # same derivation here keeps the header honest on frame zero; a mid-session
    # change to either input still surfaces as a per-frame vw/vt override.
    poll_s = coord.update_interval.total_seconds() if coord.update_interval else 5.0
    delay_s = max(0.0, min(300.0, float(_get_settings(hass).get("room_change_delay_s") or 20.0)))
    vote_window = max(1, round(delay_s / max(1.0, poll_s)))

    hdr = build_header(
        hass, coord,
        label=msg.get("label") or "",
        poll_s=poll_s,
        vote_window=vote_window,
        vote_threshold=vote_window // 2 + 1,
        fabric_rooms=rooms,
        include_calibration=bool(msg.get("include_calibration")),
    )
    sid = cap.start_session(
        hdr,
        minutes=int(msg.get("minutes") or 5),
        label=msg.get("label") or "",
        keys=[str(k) for k in (msg.get("keys") or [])],
        followed=set(_get_settings(hass).get("followed_addrs") or []),
        sources=srcs, source_to_area=s2a, source_to_floor=s2f,
    )
    if msg.get("ground_truth"):
        cap.mark_ground_truth(str(msg["ground_truth"]))
    await cap.async_flush()   # the header hits disk before the first frame
    _LOGGER.info("Capture session %s started (%d min, %d sources)",
                 sid, int(msg.get("minutes") or 5), len(srcs))
    _bump(hass, "capture_started")
    connection.send_result(msg["id"], {
        "ok": True, "session_id": sid,
        "ends_ts": cap.status().get("ends_ts"),
        "minutes": int(msg.get("minutes") or 5),
        "sources": len(srcs),
    })


@websocket_api.websocket_command({"type": "padspan_ha/capture_stop"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_stop(hass: HomeAssistant, connection, msg) -> None:
    """Close the running session.  Idle is an answer, not an error."""
    cap = _capture_store(hass)
    if not cap or not cap.recording:
        connection.send_result(msg["id"], {"ok": False, "error": "Not recording"})
        return
    sess = await cap.async_stop("manual")
    connection.send_result(msg["id"], {
        "ok": True, "session_id": sess.get("id"), "frames": sess.get("frames"),
        "bytes": sess.get("bytes"), "stop_reason": sess.get("stop_reason"),
    })


@websocket_api.websocket_command({"type": "padspan_ha/capture_status"})
@websocket_api.async_response
async def ws_capture_status(hass: HomeAssistant, connection, msg) -> None:
    """Live session state; polled by the Health tab while recording."""
    cap = _capture_store(hass)
    out = cap.status() if cap else {"recording": False, "session_id": "", "frames": 0,
                                    "objects": 0, "bytes": 0, "sources": 0,
                                    "gt_room": "", "truncated": 0,
                                    "started_ts": 0, "ends_ts": 0}
    out["enabled"] = _get_settings(hass).get("rssi_capture_enabled") is True
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/capture_mark",
        vol.Required("room"): str,
        vol.Optional("keys", default=[]): list,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_mark(hass: HomeAssistant, connection, msg) -> None:
    """Stamp ground truth: the operator asserting where a device really is."""
    cap = _capture_store(hass)
    if not cap or not cap.recording:
        connection.send_result(msg["id"], {"ok": False, "error": "Not recording"})
        return
    cap.mark_ground_truth(str(msg["room"]), [str(k) for k in (msg.get("keys") or [])])
    connection.send_result(msg["id"], {"ok": True, "room": str(msg["room"])})


@websocket_api.websocket_command({"type": "padspan_ha/capture_list"})
@websocket_api.async_response
async def ws_capture_list(hass: HomeAssistant, connection, msg) -> None:
    """Recorded sessions, newest first.  Prunes first, so a disabled install
    still honours retention the next time anyone opens the tab."""
    cap = _capture_store(hass)
    connection.send_result(msg["id"], {"sessions": cap.list_sessions() if cap else []})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/capture_get",
        vol.Required("session_id"): str,
        vol.Optional("offset", default=0): vol.All(vol.Coerce(int), vol.Range(min=0)),
        vol.Optional("limit", default=2000): vol.All(vol.Coerce(int), vol.Range(min=1, max=5000)),
    }
)
@websocket_api.async_response
async def ws_capture_get(hass: HomeAssistant, connection, msg) -> None:
    """One page of a session file — the export transport.

    Byte-capped as well as line-capped, so one response stays ~1.5 MB whatever
    `limit` asks for.  The 19.5 MB live_snapshot that took a browser down is
    why every bulk read in this file carries a hard response cap.
    """
    cap = _capture_store(hass)
    page = await cap.async_read_lines(
        str(msg["session_id"]), int(msg.get("offset") or 0),
        int(msg.get("limit") or 2000)) if cap else None
    if page is None:
        connection.send_error(msg["id"], "not_found", "No such capture session")
        return
    connection.send_result(msg["id"], page)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/capture_delete",
        vol.Required("session_id"): str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_capture_delete(hass: HomeAssistant, connection, msg) -> None:
    cap = _capture_store(hass)
    removed = await cap.async_delete(str(msg["session_id"])) if cap else False
    connection.send_result(msg["id"], {"ok": True, "removed": removed})
