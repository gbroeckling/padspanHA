# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the robot-vacuum import (vacuum_import.py).

preview  parses a map into a candidate and keeps it; nothing is written.
commit   writes the kept candidate through the existing writers — a NEW map,
         its placement, and rooms as external_import (merge-only: a room that
         already exists anywhere is skipped, never overwritten). The link it
         records is OFF.
link     turns the live position and the calibration walker on or off.
pending  the walker's review pile: list, accept (the one road into
         calibration_store.async_add_point), reject.

All admin-gated: they parse untrusted files, reach a robot on the network, or
write the house's maps and calibration. Registration stays in
websocket.py.
"""

from __future__ import annotations

import base64
import json
import logging

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DEFAULT_FLOOR_ID, DOMAIN
from . import vacuum_import as vi

_LOGGER = logging.getLogger(__name__)


async def _store(hass: HomeAssistant) -> vi.VacuumStore:
    dom = hass.data.setdefault(DOMAIN, {})
    vs = dom.get(vi.DATA_VACUUM)
    if vs is None:
        vs = vi.VacuumStore(hass)
        await vs.async_load()
        dom[vi.DATA_VACUUM] = vs
    return vs


def _status(vs: vi.VacuumStore) -> dict:
    return {
        "link": vs.data.get("link"),
        "walker": vs.data.get("walker"),
        "pending": len(vs.data.get("pending") or []),
        "live": vi.live_position(vs.hass),
    }


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_import_preview",
    vol.Optional("json_text"): str,
    vol.Optional("url"): str,
    vol.Optional("entity_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_import_preview(hass: HomeAssistant, connection, msg) -> None:
    """Parse a robot vacuum's map into a candidate. Writes nothing.

    One of: json_text (a Valetudo map, pasted or from a file), url (the
    robot's Valetudo address), entity_id (a camera — its PNG's ValetudoMap
    chunk first, then its calibration_points attributes)."""
    vs = await _store(hass)
    read: dict = {}
    try:
        if msg.get("json_text"):
            text = msg["json_text"]
            if len(text) > vi.MAX_JSON_BYTES:
                connection.send_error(msg["id"], "upload_too_large", "The map file is too large")
                return
            try:
                vmap = json.loads(text)
            except ValueError:
                connection.send_error(msg["id"], "parse_failed", "That is not JSON")
                return
            cand = await hass.async_add_executor_job(vi.parse_valetudo, vmap)
        elif msg.get("url"):
            url = vi.valetudo_map_url(msg["url"])
            vmap = await vi.fetch_url_json(hass, url)
            cand = await hass.async_add_executor_job(vi.parse_valetudo, vmap)
            read = {"read": "url", "ref": url, "format": "valetudo"}
        elif msg.get("entity_id"):
            eid = msg["entity_id"].strip()
            if not eid.startswith(("camera.", "image.")):
                connection.send_error(msg["id"], "invalid", "Pick the vacuum's map camera")
                return
            png = await vi.camera_image(hass, eid)
            vmap = await hass.async_add_executor_job(vi.extract_valetudo_json, png)
            if vmap is not None:
                cand = await hass.async_add_executor_job(vi.parse_valetudo, vmap)
                read = {"read": "camera_png", "ref": eid, "format": "valetudo"}
            else:
                st = hass.states.get(eid)
                attrs = dict(st.attributes) if st else {}
                cand = await hass.async_add_executor_job(vi.parse_calibrated_camera, attrs, png)
                read = {"read": "camera_attrs", "ref": eid, "format": "attrs"}
        else:
            connection.send_error(msg["id"], "invalid", "Give a map file, the robot's address, or its camera")
            return
    except vi.VacuumImportError as exc:
        connection.send_error(msg["id"], "parse_failed", str(exc))
        return
    except Exception as exc:  # noqa: BLE001 — a robot that cannot be reached says so
        _LOGGER.debug("Vacuum map preview failed", exc_info=True)
        connection.send_error(msg["id"], "fetch_failed", f"Could not read the map: {exc}")
        return
    cand["read"] = read
    vs.preview = cand
    connection.send_result(msg["id"], vi.candidate_for_client(cand))


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_import_commit",
    vol.Optional("floor_id"): str,
    vol.Optional("name"): str,
    vol.Optional("include_rooms", default=True): bool,
    vol.Optional("vacuum_entity"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_import_commit(hass: HomeAssistant, connection, msg) -> None:
    """Write the previewed candidate: a new map, its placement, new rooms only."""
    vs = await _store(hass)
    cand = vs.preview
    dom = hass.data.get(DOMAIN, {})
    ms, mdl, fab = dom.get(DATA_MAPS), dom.get(DATA_MODEL), dom.get(DATA_FABRIC)
    if not cand:
        connection.send_error(msg["id"], "no_preview", "Preview a vacuum map first")
        return
    if not ms or not mdl:
        connection.send_error(msg["id"], "not_ready", "Maps not loaded yet")
        return
    floor_id = (msg.get("floor_id") or DEFAULT_FLOOR_ID).strip() or DEFAULT_FLOOR_ID
    try:
        info = await ms.async_add_map(
            (msg.get("name") or "Robot vacuum map").strip()[:120] or "Robot vacuum map",
            "vacuum_map.png", "image/png", cand["width"], cand["height"],
            base64.b64encode(cand["png"]).decode("ascii"), floor_id,
        )
    except ValueError as exc:
        connection.send_error(msg["id"], "invalid_image", str(exc))
        return
    map_id = info["id"]
    # The new map's placement: the vacuum's own metre scale, square, at the
    # world origin — the writer every measurement comes through. A brand-new
    # map has no calibration points, so there is nothing to remap.
    await mdl.async_set_map_transform(map_id, {
        "origin_x_m": 0.0, "origin_y_m": 0.0, "rotation_rad": 0.0, "shear_rad": 0.0,
        "scale_x_m": cand["scale_x_m"], "scale_y_m": cand["scale_y_m"], "floor_id": floor_id,
    })
    try:
        await mdl.async_ensure_world_gauge(ms.data.get("maps") or [])
    except Exception:  # a gauge that could not be seeded is refusal, not failure
        _LOGGER.exception("Could not seed the world gauge after a vacuum import")
    added, skipped = [], []
    if msg.get("include_rooms", True) and fab:
        for r in cand["rooms"]:
            pts = [mdl.map_frac_to_metres(fx, fy, map_id) for fx, fy in r["points_frac"]]
            pts = [[round(p[0], 3), round(p[1], 3)] for p in pts if p]
            if len(pts) < 3:
                skipped.append(r["name"])
                continue
            res = await fab.async_correct_room(floor_id, r["name"], {"type": "poly", "points_m": pts},
                                               committed_by="external_import")
            (added if res.get("ok") else skipped).append(r["name"])
    read = cand.get("read") or {}
    vs.data["link"] = {
        "enabled": False, "map_id": map_id, "floor_id": floor_id, "to_frac": cand["to_frac"],
        "read": read.get("read"), "ref": read.get("ref"), "format": read.get("format"),
        "vacuum_entity": (msg.get("vacuum_entity") or "").strip(),
        "dock": cand.get("dock"),
    } if read.get("read") else vs.data.get("link")
    vs.preview = None
    await vs.async_save()
    _LOGGER.info("Vacuum map imported as map %s on %s: %d rooms added, %d skipped (already there)",
                 map_id, floor_id, len(added), len(skipped))
    connection.send_result(msg["id"], {"ok": True, "map": info, "rooms_added": added,
                                       "rooms_skipped": skipped, "linkable": bool(read.get("read"))})


@websocket_api.websocket_command({"type": "padspan_ha/vacuum_status"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_status(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], _status(await _store(hass)))


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_link_set",
    vol.Optional("enabled"): bool,
    vol.Optional("vacuum_entity"): str,
    vol.Optional("walker_enabled"): bool,
    vol.Optional("walker_tag"): str,
    vol.Optional("unlink", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_link_set(hass: HomeAssistant, connection, msg) -> None:
    """Turn the live position / the walker on or off. Writes no calibration."""
    vs = await _store(hass)
    lk = vs.data.get("link")
    if msg.get("unlink"):
        vs.data["link"] = None
    elif isinstance(lk, dict):
        if "enabled" in msg:
            lk["enabled"] = bool(msg["enabled"])
        if "vacuum_entity" in msg:
            lk["vacuum_entity"] = msg["vacuum_entity"].strip()
    elif msg.get("enabled"):
        connection.send_error(msg["id"], "no_link", "Import a vacuum map from its camera or address first")
        return
    wk = vs.data.setdefault("walker", {"enabled": False, "tag": ""})
    if "walker_tag" in msg:
        wk["tag"] = msg["walker_tag"].strip().upper()[:40]
    if "walker_enabled" in msg:
        wk["enabled"] = bool(msg["walker_enabled"]) and bool(wk.get("tag"))
    await vs.async_save()
    vs.start()
    connection.send_result(msg["id"], _status(vs))


@websocket_api.websocket_command({"type": "padspan_ha/vacuum_cal_pending_list"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_cal_pending_list(hass: HomeAssistant, connection, msg) -> None:
    vs = await _store(hass)
    connection.send_result(msg["id"], {"pending": vs.pending_list()})


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_cal_pending_accept",
    "point_id": str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_cal_pending_accept(hass: HomeAssistant, connection, msg) -> None:
    """The user accepted one pending point: THE one road into calibration."""
    vs = await _store(hass)
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    if not cal:
        connection.send_error(msg["id"], "not_ready", "Calibration not loaded yet")
        return
    p = next((x for x in vs.pending_list() if x.get("id") == msg["point_id"]), None)
    if not p:
        connection.send_error(msg["id"], "not_found", "That pending point is gone")
        return
    try:
        saved = await cal.async_add_point({
            "map_id": "", "x_frac": 0.5, "y_frac": 0.5,
            "x_m": p["x_m"], "y_m": p["y_m"], "floor_id": p.get("floor_id") or "",
            "label": f"[vacuum] {p.get('tag') or ''}".strip(), "device_id": p.get("tag") or "",
            "collected_at": p.get("collected_at"), "duration_s": vi.TICK_S,
            "scanner_readings": p.get("scanner_readings") or [],
        })
    except Exception as exc:  # noqa: BLE001 — the point stays in the pile
        connection.send_error(msg["id"], "save_failed", str(exc))
        return
    vs.take_pending(p["id"])
    await vs.async_save()
    connection.send_result(msg["id"], {"ok": True, "point": saved, "pending": len(vs.pending_list())})


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_cal_pending_reject",
    vol.Optional("point_id"): str,
    vol.Optional("all", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_cal_pending_reject(hass: HomeAssistant, connection, msg) -> None:
    vs = await _store(hass)
    if msg.get("all"):
        n = len(vs.pending_list())
        vs.data["pending"] = []
    else:
        n = 1 if vs.take_pending(msg.get("point_id") or "") else 0
    await vs.async_save()
    connection.send_result(msg["id"], {"ok": True, "rejected": n, "pending": len(vs.pending_list())})


HANDLERS = (
    ws_vacuum_import_preview, ws_vacuum_import_commit, ws_vacuum_status, ws_vacuum_link_set,
    ws_vacuum_cal_pending_list, ws_vacuum_cal_pending_accept, ws_vacuum_cal_pending_reject,
)
