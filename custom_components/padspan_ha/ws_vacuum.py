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
robot    the robovac card (2026-11-24): the robot's state and battery read
         from its own Valetudo, Start / Pause / Dock, its address and login.
run      room location runs (vacuum_run.py): start, stop, undo one run.
findings where the runs' points say a receiver really is (vacuum_findings.py).
robot_wifi_readings  the robot's Wi-Fi at each run spot, and while it cleans
         when the owner turned that on (vacuum_moving.py), for other
         integrations (its shape: vacuum_run.py's docstring).

All admin-gated: they parse untrusted files, reach a robot on the network, or
write the house's maps and calibration. Registration stays in
websocket.py.
"""

from __future__ import annotations

import base64
import json
import logging
from urllib.parse import urlsplit

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DEFAULT_FLOOR_ID, DOMAIN, NOT_LOADED_MESSAGE
from . import vacuum_import as vi
from . import vacuum_run as vr
from . import vacuum_use as vu
from .quiet_errors import note as _quiet_error
from .util import AddressRefused
from .ws_common import id_text

_LOGGER = logging.getLogger(__name__)


async def _store(hass: HomeAssistant) -> vi.VacuumStore:
    dom = hass.data.setdefault(DOMAIN, {})
    vs = dom.get(vi.DATA_VACUUM)
    if vs is None:
        vs = vi.VacuumStore(hass)
        await vs.async_load()
        dom[vi.DATA_VACUUM] = vs
    return vs


def _floor_is_empty(ms, fab, floor_id: str) -> bool:
    """No map and no room on this floor yet. The import places the robot's
    map at the world origin, unrotated, in the robot's own frame: on an empty
    floor that frame IS the floor's, on one that already has plans the rooms
    and the robot's spots would land metres from where they are."""
    for m in (ms.data.get("maps") or []):
        if isinstance(m, dict) and (m.get("floor_id") or DEFAULT_FLOOR_ID) == floor_id:
            return False
    floor = ((getattr(fab, "data", None) or {}).get("floors") or {}).get(floor_id) or {}
    return not (floor.get("rooms") or {})


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
                vmap = await hass.async_add_executor_job(json.loads, text)
            except ValueError:
                connection.send_error(msg["id"], "parse_failed", "That is not JSON")
                return
            cand = await hass.async_add_executor_job(vi.parse_valetudo, vmap)
        elif msg.get("url"):
            url = vi.valetudo_map_url(msg["url"])
            vmap = await vi.fetch_url_json(hass, url, vs.basic_auth())
            cand = await hass.async_add_executor_job(vi.parse_valetudo, vmap)
            read = {"read": "url", "ref": url, "format": "valetudo"}
        elif msg.get("entity_id"):
            eid = msg["entity_id"].strip()
            if not eid.startswith("camera."):
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
    except AddressRefused as exc:
        connection.send_error(msg["id"], "address_refused", str(exc))
        return
    except Exception as exc:  # noqa: BLE001 — a robot that cannot be reached says so
        _quiet_error("ws_vacuum:import_preview")
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
        connection.send_error(msg["id"], "not_ready", NOT_LOADED_MESSAGE)
        return
    floor_id = (msg.get("floor_id") or DEFAULT_FLOOR_ID).strip() or DEFAULT_FLOOR_ID
    # Rooms and the robot link (its live spot, the walker's points) only on
    # a floor with nothing on it yet; elsewhere the picture alone, to line up.
    empty = _floor_is_empty(ms, fab, floor_id)
    if not empty and msg.get("include_rooms", True):
        connection.send_error(
            msg["id"], "floor_not_empty",
            "This floor already has maps or rooms, and the robot's rooms would not line up with them. "
            "Untick \"Add its rooms\" to import the map picture only, then line it up in 3D Stack.")
        return
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
            # The vacuum's own metres, on the frame the map was just placed
            # at (origin 0, square) — not a photo coordinate converted.
            pts = [[round(float(x), 3), round(float(y), 3)] for x, y in r["points_m"]]
            if len(pts) < 3:
                skipped.append(r["name"])
                continue
            res = await fab.async_correct_room(floor_id, r["name"], {"type": "poly", "points_m": pts},
                                               committed_by="external_import")
            (added if res.get("ok") else skipped).append(r["name"])
    read = cand.get("read") or {}
    vs.data["link"] = {
        "enabled": False, "map_id": map_id, "floor_id": floor_id, "to_m": cand["to_m"],
        "read": read.get("read"), "ref": read.get("ref"), "format": read.get("format"),
        "vacuum_entity": (msg.get("vacuum_entity") or "").strip(),
        "dock": cand.get("dock"),
    } if read.get("read") and empty else vs.data.get("link")
    vs.preview = None
    await vs.async_save()
    _LOGGER.info("Vacuum map imported as map %s on %s: %d rooms added, %d skipped (already there)",
                 map_id, floor_id, len(added), len(skipped))
    from .telemetry import bump as _bump  # noqa: PLC0415
    _bump(hass, "vacuum_imported")
    connection.send_result(msg["id"], {"ok": True, "map": info, "rooms_added": added,
                                       "rooms_skipped": skipped, "linkable": bool(read.get("read")) and empty})


@websocket_api.websocket_command({"type": "padspan_ha/vacuum_status"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_status(hass: HomeAssistant, connection, msg) -> None:
    connection.send_result(msg["id"], _status(await _store(hass)))


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_link_set",
    vol.Optional("enabled"): bool,
    vol.Optional("vacuum_entity"): id_text,
    vol.Optional("walker_enabled"): bool,
    vol.Optional("walker_tag"): id_text,
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
    vol.Required("point_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_cal_pending_accept(hass: HomeAssistant, connection, msg) -> None:
    """The user accepted one pending point: THE one road into calibration."""
    vs = await _store(hass)
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    if not cal:
        connection.send_error(msg["id"], "not_ready", NOT_LOADED_MESSAGE)
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
    from .telemetry import bump as _bump  # noqa: PLC0415
    _bump(hass, "vacuum_point_accepted")
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


# ── the robovac card and room location runs (vacuum_run.py, 2026-11-24) ────
# The browser never calls the robot: these do, from here, so its address and
# login stay on the Home Assistant side. A robot that cannot be read is said in
# the answer (state.error), not as a failed command, so the card still shows
# what is set up and what is missing. A refusal's code is what the card words.

def _use_change(hass: HomeAssistant, vs: vi.VacuumStore) -> dict | None:
    robot = vs.data.get("robot") or {}
    use = vu.use_of(vs)
    if use is None or robot.get("use_left") == use:
        return None
    dom = hass.data.get(DOMAIN, {})
    cal, fab = dom.get(DATA_CALIBRATION), dom.get(DATA_FABRIC)
    if not cal:
        return None
    plan = vu.plan_change(vs.data.get("runs") or [], cal.list_points(), fab.rooms_flat() if fab else {}, use)
    return plan if (plan["add"] or plan["remove"] or plan["reweight"]) else None


async def _robot_status(hass: HomeAssistant, vs: vi.VacuumStore, rooms: bool) -> dict:
    eng = vr.engine(hass, vs)
    await eng.async_settle()
    lk = vs.data.get("link") if isinstance(vs.data.get("link"), dict) else None
    base = vr.robot_base(vs)
    tag = str((vs.data.get("walker") or {}).get("tag") or "")
    out: dict = {
        "robot": {"url": base, "auth": bool(vs.basic_auth()),
                  # How the robot's points are used (vacuum_use.py): None until the owner picks.
                  "use": vu.use_of(vs), "applied": (vs.data.get("robot") or {}).get("applied"),
                  # Wi-Fi while it cleans (vacuum_moving.py): the owner's switch, off by default, and what it kept.
                  "wifi_moving": bool((vs.data.get("robot") or {}).get("wifi_moving")),
                  "wifi_moving_n": len((vs.data.get("wifi") or {}).get("moving") or [])},
        "link": {"map": bool(lk and lk.get("map_id")), "valetudo": bool(lk and lk.get("format") == "valetudo"),
                 "on": vs.link_on(), "vacuum_entity": (lk or {}).get("vacuum_entity") or ""},
        "tag": {"address": tag, **vr.tag_heard(hass, tag)},
        "state": None,
        "run": vr.run_for_client(eng.current) if eng.current and eng.running else None,
        # A choice changed since the earlier runs were made: what applying it to them would do.
        "use_change": _use_change(hass, vs),
        # The last run and every run whose points can still be undone, newest first.
        "runs": [vr.run_for_client(r) for r in vr.runs_for_card(vs.data.get("runs") or [])],
        "live": vi.live_position(hass),
    }

    def failed(exc: Exception) -> dict:
        if isinstance(exc, vr.RobotError):
            return {"error": exc.code, "text": str(exc)}
        return {"error": "address_refused" if isinstance(exc, AddressRefused) else "refused", "text": str(exc)}

    if base:
        # The state and the rooms apart: a map that cannot be read never hides the robot's state.
        try:
            out["state"] = vr.robot_state(await vr.robot_call(hass, base, "GET", vr.ATTRS_PATH, auth=vs.basic_auth()))
        except (vr.RobotError, AddressRefused, vi.VacuumImportError) as exc:
            out["state"] = failed(exc)
        if rooms and not (out["state"] or {}).get("error"):
            try:
                vmap = await vr.robot_call(hass, base, "GET", vr.MAP_PATH, auth=vs.basic_auth())
                out["rooms"] = (await hass.async_add_executor_job(vr.plan_spots, vmap, None))["rooms"]
            except (vr.RobotError, AddressRefused, vi.VacuumImportError) as exc:
                out["rooms_error"] = failed(exc)
    return out


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_robot_status",
    vol.Optional("rooms", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_robot_status(hass: HomeAssistant, connection, msg) -> None:
    """The robovac card: the robot as its Valetudo reports it, what a run needs, the last runs."""
    connection.send_result(msg["id"], await _robot_status(hass, await _store(hass), msg.get("rooms", False)))


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_robot_set",
    vol.Optional("url"): id_text,
    vol.Optional("user"): id_text,
    vol.Optional("password"): id_text,
    vol.Optional("wifi_moving"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_robot_set(hass: HomeAssistant, connection, msg) -> None:
    """The robot's Valetudo address, and its user and password when Valetudo asks for them;
    and the switch "Collect Wi-Fi while it cleans" (vacuum_moving.py), off until the owner turns it on."""
    vs = await _store(hass)
    if "wifi_moving" in msg:
        vs.data.setdefault("robot", {})["wifi_moving"] = bool(msg["wifi_moving"])
        await vs.async_save()
    if "url" in msg:
        url = msg["url"].strip().rstrip("/")
        try:
            if url:
                vi.valetudo_map_url(url)              # http(s) only, as the import takes it
        except vi.VacuumImportError as exc:
            connection.send_error(msg["id"], "invalid", str(exc))
            return
        if "@" in urlsplit(url).netloc:
            # A login in the address would ride every request in the clear and in logs: it has its own boxes.
            connection.send_error(msg["id"], "bad_login", "Put the user and password in their own boxes, not in the address")
            return
        vs.data.setdefault("robot", {})["url"] = url
        await vs.async_save()
    if "user" in msg or "password" in msg:
        user = msg.get("user", vs.auth.get("user") or "").strip()
        if ":" in user:
            # Basic auth joins user and password with ":": one in the user name cannot be sent.
            connection.send_error(msg["id"], "bad_login", "A Valetudo user name cannot contain a colon")
            return
        await vs.async_save_auth(user, msg.get("password", vs.auth.get("password") or "") if user else "")
    connection.send_result(msg["id"], await _robot_status(hass, vs, False))


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_robot_control",
    vol.Required("action"): vol.In(vr.CONTROL_ACTIONS),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_robot_control(hass: HomeAssistant, connection, msg) -> None:
    """Start, Pause or Dock, through Valetudo's BasicControlCapability (not while a run goes)."""
    vs = await _store(hass)
    base = vr.robot_base(vs)
    try:
        if not base:
            raise vr.RunRefused("no_address", "Give the robot's address first")
        if vr.engine(hass, vs).running:
            raise vr.RunRefused("busy", "Stop the run first")
        await vr.robot_call(hass, base, "PUT", vr.CONTROL_PATH, {"action": msg["action"]}, auth=vs.basic_auth())
    except (vr.RunRefused, vr.RobotError) as exc:
        connection.send_error(msg["id"], exc.code, str(exc))
        return
    except AddressRefused as exc:
        connection.send_error(msg["id"], "address_refused", str(exc))
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_run_start",
    vol.Optional("room"): id_text,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_run_start(hass: HomeAssistant, connection, msg) -> None:
    """Start a room location run (every room, or one): calibration is backed up first."""
    vs = await _store(hass)
    try:
        run = await vr.engine(hass, vs).async_start((msg.get("room") or "").strip() or None)
    except (vr.RunRefused, vr.RobotError) as exc:
        connection.send_error(msg["id"], exc.code, str(exc))
        return
    except AddressRefused as exc:
        connection.send_error(msg["id"], "address_refused", str(exc))
        return
    except vi.VacuumImportError as exc:
        connection.send_error(msg["id"], "refused", str(exc))
        return
    connection.send_result(msg["id"], {"ok": True, "run": vr.run_for_client(run)})


@websocket_api.websocket_command({"type": "padspan_ha/vacuum_run_stop"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_run_stop(hass: HomeAssistant, connection, msg) -> None:
    """Stop the run going: the robot is sent home, the points so far stay."""
    connection.send_result(msg["id"], {"ok": True, "stopped": vr.engine(hass, await _store(hass)).stop()})


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_run_undo",
    vol.Required("run_id"): id_text,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_run_undo(hass: HomeAssistant, connection, msg) -> None:
    """Remove exactly one run's points from calibration."""
    try:
        removed = await vr.engine(hass, await _store(hass)).async_undo(msg["run_id"])
    except vr.RunRefused as exc:
        connection.send_error(msg["id"], exc.code, str(exc))
        return
    connection.send_result(msg["id"], {"ok": True, "removed": removed})


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_robot_use_set",
    vol.Required("use"): vol.In(vu.USES),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_robot_use_set(hass: HomeAssistant, connection, msg) -> None:
    """How the robot's points are used from now on. Earlier runs are not touched:
    the answer says what applying it to them would do (vacuum_robot_use_apply)."""
    vs = await _store(hass)
    robot = vs.data.setdefault("robot", {})
    if not robot.get("use"):
        robot["use_left"] = msg["use"]                # the first pick: nothing earlier to change
    robot["use"] = msg["use"]
    await vs.async_save()
    connection.send_result(msg["id"], await _robot_status(hass, vs, False))


@websocket_api.websocket_command({
    "type": "padspan_ha/vacuum_robot_use_apply",
    vol.Optional("leave", default=False): bool,
    vol.Optional("undo", default=False): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_robot_use_apply(hass: HomeAssistant, connection, msg) -> None:
    """Apply the choice to the earlier runs (their points out and back in by it, one
    step after a backup), or leave them as they are, or undo the last apply (the
    choice before it, applied the same way)."""
    vs = await _store(hass)
    robot = vs.data.setdefault("robot", {})
    use = vu.use_of(vs)
    if msg.get("leave"):
        robot["use_left"] = use
        await vs.async_save()
        connection.send_result(msg["id"], await _robot_status(hass, vs, False))
        return
    dom = hass.data.get(DOMAIN, {})
    cal, fab = dom.get(DATA_CALIBRATION), dom.get(DATA_FABRIC)
    was = robot.get("applied") if msg.get("undo") else None
    target = was.get("from") if isinstance(was, dict) else use
    from .const import CALIBRATION_STORE_KEY  # noqa: PLC0415
    from .ws_backup import _auto_backup  # noqa: PLC0415
    try:
        if not cal:
            raise vr.RunRefused("not_ready", "PadSpan is still loading")
        if vr.engine(hass, vs).running:
            raise vr.RunRefused("busy", "Stop the run first")
        if target not in vu.USES:
            raise vr.RunRefused("no_use", "Choose how the robot's points are used first")
        backup_id = await _auto_backup(hass, "Before the robot's points were used another way", [CALIBRATION_STORE_KEY],
                                       slot="robot_run", slot_keep=3)
        if not backup_id:
            raise vr.RunRefused("backup_failed", "Calibration could not be backed up, so nothing was changed")
    except vr.RunRefused as exc:
        connection.send_error(msg["id"], exc.code, str(exc))
        return
    done = await vu.async_apply(cal, vs.data.get("runs") or [], fab.rooms_flat() if fab else {}, target, vr.TAG_Z_M, vr.DWELL_S)
    robot["applied"] = None if msg.get("undo") else {"from": robot.get("use_left"), "to": target, "backup_id": backup_id, **done}
    robot["use"] = robot["use_left"] = target
    await vs.async_save()
    connection.send_result(msg["id"], {**await _robot_status(hass, vs, False), "done": done})


_FINDINGS_KEPT = "vacuum_findings_kept"     # (what they were worked out from, the findings)


@websocket_api.websocket_command({"type": "padspan_ha/vacuum_findings"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_vacuum_findings(hass: HomeAssistant, connection, msg) -> None:
    """Receivers the robot runs' points say are placed wrongly. Reads only; moves nothing.

    Off the event loop, and kept until the robot points, the receivers' places
    or the rooms change: a big house after many runs is seconds of arithmetic."""
    from .vacuum_findings import cache_key, find_mistakes  # noqa: PLC0415
    dom = hass.data.get(DOMAIN, {})
    cal, mdl, fab = dom.get(DATA_CALIBRATION), dom.get(DATA_MODEL), dom.get(DATA_FABRIC)
    if not cal or not mdl:
        connection.send_error(msg["id"], "not_ready", NOT_LOADED_MESSAGE)
        return
    pts, pos, rooms = cal.list_points(), mdl.scanner_positions_m() or {}, fab.rooms_flat() if fab else {}
    # And the stops kept in the runs' records, not in calibration (the owner's choice, vacuum_use.py).
    pts = pts + vu.stops_as_points((await _store(hass)).data.get("runs") or [], {str(p.get("id")) for p in pts})
    key = await hass.async_add_executor_job(cache_key, pts, pos, rooms)
    kept = dom.get(_FINDINGS_KEPT)
    if kept and kept[0] == key:
        out = kept[1]
    else:
        out = await hass.async_add_executor_job(find_mistakes, pts, pos, rooms)
        dom[_FINDINGS_KEPT] = (key, out)
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({"type": "padspan_ha/robot_wifi_readings"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_robot_wifi_readings(hass: HomeAssistant, connection, msg) -> None:
    """The robot's Wi-Fi at each room location run spot and while it cleans, for other integrations (version 1)."""
    await _store(hass)
    connection.send_result(msg["id"], vr.robot_wifi_snapshot(hass))


HANDLERS = (
    ws_vacuum_import_preview, ws_vacuum_import_commit, ws_vacuum_status, ws_vacuum_link_set,
    ws_vacuum_cal_pending_list, ws_vacuum_cal_pending_accept, ws_vacuum_cal_pending_reject,
    ws_vacuum_robot_status, ws_vacuum_robot_set, ws_vacuum_robot_control,
    ws_vacuum_run_start, ws_vacuum_run_stop, ws_vacuum_run_undo,
    ws_vacuum_findings, ws_robot_wifi_readings, ws_vacuum_robot_use_set, ws_vacuum_robot_use_apply,
)
