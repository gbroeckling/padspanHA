# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the floor-plan photographs (upload, update, replace, delete).

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
from typing import Any
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .ws_common import admin_if_enhanced_security, finite_float
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DEFAULT_FLOOR_ID,
    OUTSIDE_FLOOR_ID,
    DATA_CALIBRATION,
    DATA_HOUSE3D,
    DATA_TRACEBACK,
)
import base64
import math
import time as _time
from .map_image_view import signed_image_urls
from .presence_rules import is_outdoor_floor
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)


# Delay first prune until 15 min after module load (HA boot).  ESPHome scanners
# need time to reconnect after a reboot; premature pruning caused receivers
# to silently disappear (fixed v0.6.72).
_last_receiver_prune: float = _time.monotonic() + 900


@websocket_api.websocket_command({"type": "padspan_ha/maps_list"})
@websocket_api.async_response
async def ws_maps_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all maps.  Auto-prune is deliberately disabled (see v0.6.72 fix)."""
    global _last_receiver_prune
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)

    maps = ms.list_maps() if ms else []
    # Diagnostic: log room_bounds counts per map for persistence debugging
    for _dm in maps:
        _rb = _dm.get("room_bounds") or {}
        if _rb:
            _LOGGER.debug("maps_list: map %s has %d room_bounds: %s", _dm.get("id","?")[:8], len(_rb), list(_rb.keys()))
    # Signed links beside the maps, never inside them (map_image_view.py).
    connection.send_result(msg["id"], {
        "maps": maps,
        "image_urls": _image_urls(hass, maps, connection),
    })


def _image_urls(hass: HomeAssistant, maps: list, connection) -> dict:
    """Signed image links; on a failure, none — the maps still load without them."""
    try:
        return signed_image_urls(hass, maps, connection.refresh_token_id)
    except Exception:  # noqa: BLE001 — pins and rooms must not go blank with the pictures
        _LOGGER.exception("Could not sign the floor plan image links")
        return {}


@websocket_api.websocket_command({"type": "padspan_ha/maps_image_urls"})
@websocket_api.async_response
async def ws_maps_image_urls(hass: HomeAssistant, connection, msg) -> None:
    """Fresh signed image links only — the panel's keep-alive for them.

    Separate from maps_list so the refresh never replaces the map objects a
    view may be in the middle of editing.
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    maps = ms.list_maps() if ms else []
    connection.send_result(msg["id"], {"image_urls": _image_urls(hass, maps, connection)})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_upload",
        "name": str,
        "filename": str,
        "mime": str,
        "width": int,
        "height": int,
        "png_base64": str,
        vol.Optional("floor_id"): str,
        # Backup restore only: a map whose backup has no picture is created
        # without one rather than lost with its data (async_add_map).
        vol.Optional("allow_no_image", default=False): bool,
        # Mapping → Upload: "Set this plan's scale now" waits on the new plan (views/scale_nudge.js).
        vol.Optional("scale_nudge", default=False): bool,
        # Only when the person said so: their own sketch, not to scale (maps_store.PLAN_KINDS; "blank" is maps_blank_create's).
        vol.Optional("kind"): vol.In(["sketch"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_upload(hass: HomeAssistant, connection, msg) -> None:
    """Upload a new floor plan image and create a map entry.

    The PNG is sent as base64 in the WS message.  Only one Outside map is
    allowed (the Outside floor has special handling in the 3D stack view).
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    floor_id = msg.get("floor_id") or DEFAULT_FLOOR_ID
    # Enforce single Outside map
    if floor_id == OUTSIDE_FLOOR_ID:
        existing = ms.list_maps()
        if any(m.get("floor_id") == OUTSIDE_FLOOR_ID for m in existing):
            connection.send_error(msg["id"], "duplicate_outside",
                                  "Only one Outside map is allowed. Delete the existing one first.")
            return
    try:
        info = await ms.async_add_map(
            msg.get("name") or "Untitled Map",
            msg.get("filename") or "map",
            msg.get("mime") or "image/*",
            msg.get("width") or 0,
            msg.get("height") or 0,
            msg.get("png_base64") or "",
            floor_id,
            allow_no_image=bool(msg.get("allow_no_image")),
            scale_nudge=bool(msg.get("scale_nudge")) and floor_id != OUTSIDE_FLOOR_ID,
            kind=msg.get("kind"),
        )
    except ValueError as exc:
        # Only the size limit is "too large"; an empty, non-PNG or garbled
        # payload is a bad image, and the panel should be able to say so.
        code = "upload_too_large" if "limit" in str(exc) else "invalid_image"
        connection.send_error(msg["id"], code, str(exc))
        return
    connection.send_result(msg["id"], {"map": info})


# "Set this plan's scale now" (views/scale_nudge.js), right after Mapping → Upload: a hand
# measurement, one length or two, saved exactly as Mapping → Edit → Measure saves one,
# through its writer (ws_fabric.async_write_measured_transform), on the plan's own floor.
# Never the rooms helper's: no backup, no ledger, no undo of its own; its lengths carry no
# helper source, so the helper never takes it for its own. The lengths are read and the
# scale worked out here (plan_ai_write.measures_preview / scale_from_measures, the same
# reading the helper's measuring screen shows); any scale the panel sends is not read.
_HAND_MEASURE = vol.Schema({vol.Optional("p1"): [vol.Coerce(float)], vol.Optional("p2"): [vol.Coerce(float)],
                            vol.Optional("text", default=""): vol.All(str, vol.Length(max=40))}, extra=vol.REMOVE_EXTRA)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_scale_measure",
        vol.Required("map_id"): str,
        vol.Optional("measures", default=list): vol.All([_HAND_MEASURE], vol.Length(max=2)),
        vol.Optional("save", default=False): bool,
        # "This picture isn't to scale" pressed on the screen (two lengths that disagree): each direction its own scale,
        # and with `save` the plan is a sketch from then on. A plan uploaded as a sketch needs no flag.
        vol.Optional("not_to_scale", default=False): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_scale_measure(hass: HomeAssistant, connection, msg) -> None:
    """What the lengths make of the plan (writes nothing), or with `save` the
    plan's scale from them. A save that can't go is an ok: false answer with
    its plain words; nothing was written."""
    from . import plan_ai_write as C  # noqa: PLC0415
    from .ws_fabric import async_write_measured_transform  # noqa: PLC0415
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    m = ms.get_map(msg["map_id"]) if ms else None
    if not m:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    size = C._picture_size(m)  # noqa: SLF001
    measures = msg.get("measures") or []
    per_axis = m.get("kind") == "sketch" or bool(msg.get("not_to_scale"))
    if not msg.get("save"):
        connection.send_result(msg["id"], {"size": list(size) if size else None, **C.measures_preview(size, measures, C.feet_on(hass), per_axis)})
        return
    if size is None:
        connection.send_result(msg["id"], {"ok": False, "code": "no_picture_size", "message": C.SCALE_WORDS["no_picture_size"]})
        return
    try:
        # A FIRST scale only (a stale second tab must not re-scale a measured plan; Edit → Measure re-measures), as the
        # rooms helper's save stops it (plan_ai_write.scale_stops), and never the outdoors'.
        if is_outdoor_floor(m.get("floor_id")):
            raise C.Refused("outdoor", C.SCALE_WORDS["outdoor"])
        C.scale_stops(hass, msg["map_id"])
        got = C.scale_from_measures(size, measures, None, _time.strftime("%Y-%m-%d", _time.gmtime()), C.feet_on(hass), per_axis)
    except C.Refused as err:
        connection.send_result(msg["id"], {"ok": False, "code": err.code, "message": err.message})
        return
    if msg.get("not_to_scale") and got["per_axis"]:
        await ms.async_set_kind(msg["map_id"], "sketch")
    # Measure's own rule: the plan's floor as it is (a first measurement of a plan with none: the main floor).
    stored = await async_write_measured_transform(hass, msg["map_id"], {**got["transform"], "floor_id": m.get("floor_id") or DEFAULT_FLOOR_ID})
    connection.send_result(msg["id"], {"ok": True, "map_id": msg["map_id"], "scale_x_m": stored.get("scale_x_m"),
                                       "scale_y_m": stored.get("scale_y_m"), "lengths": len(measures), **({"per_axis": True} if got["per_axis"] else {})})


# No plan picture at all (views/rough_plan.js, 2026-11-16): a blank floor of the size the person types, to scale by
# construction, saved as any plan is and measured as Measure measures one (its whole width, the length typed).
BLANK_WORDS: dict[str, str] = {
    "size": "Type the floor's width and depth, each between 2 and 200 metres (or in feet): for example 12 m and 9 m.",
    "outdoor": "A blank floor is for a floor of the house, not the outdoors.",
}


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_blank_create",
        "floor_id": str,
        vol.Required("across"): vol.All(str, vol.Length(max=40)),
        vol.Required("down"): vol.All(str, vol.Length(max=40)),
        vol.Optional("name", default=""): vol.All(str, vol.Length(max=120)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_blank_create(hass: HomeAssistant, connection, msg) -> None:
    """{ok, map} or {ok: false, message}: nothing is written unless both lengths read."""
    from . import plan_ai_write as C  # noqa: PLC0415
    from . import plan_geom as G  # noqa: PLC0415
    from .maps_store import BLANK_MAX_M, BLANK_MIN_M, blank_plan_png  # noqa: PLC0415
    from .ws_fabric import async_write_measured_transform  # noqa: PLC0415
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    floor_id = msg.get("floor_id") or DEFAULT_FLOOR_ID
    feet = C.feet_on(hass)
    across, down = G.parse_length(msg["across"], feet=feet), G.parse_length(msg["down"], feet=feet)
    if is_outdoor_floor(floor_id):
        connection.send_result(msg["id"], {"ok": False, "code": "outdoor", "message": BLANK_WORDS["outdoor"]})
        return
    if across is None or down is None or not (BLANK_MIN_M <= across <= BLANK_MAX_M and BLANK_MIN_M <= down <= BLANK_MAX_M):
        connection.send_result(msg["id"], {"ok": False, "code": "size", "message": BLANK_WORDS["size"]})
        return
    png, w, h = await hass.async_add_executor_job(blank_plan_png, across, down)
    info = await ms.async_add_map(msg["name"].strip() or "Blank floor", "blank-floor.png", "image/png", w, h,
                                  base64.b64encode(png).decode("ascii"), floor_id, kind="blank")
    ref = {"p1": [0.0, 0.5], "p2": [1.0, 0.5], "distance_m": round(across, 4), "px_per_meter": round(w / across * 100) / 100,
           "angle_deg": 0, "date": _time.strftime("%Y-%m-%d", _time.gmtime()), "source": "blank"}
    await async_write_measured_transform(hass, info["id"], {"scale_x_m": round(across, 4), "scale_y_m": round(down, 4),
                                                           "reference_measurements": [ref], "floor_id": floor_id})
    connection.send_result(msg["id"], {"ok": True, "map": info})


@websocket_api.websocket_command({"type": "padspan_ha/maps_scale_nudge_end", vol.Required("map_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_scale_nudge_end(hass: HomeAssistant, connection, msg) -> None:
    """"Later" on "Set this plan's scale now": it ends for this plan, for good."""
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    ended = await ms.async_end_scale_nudge(msg["map_id"]) if ms else False
    connection.send_result(msg["id"], {"ok": True, "ended": ended})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_update",
        "map_id": str,
        # Pins, each an object: a list holding anything else saved as no pins at all.
        vol.Optional("receivers"): [dict],
        vol.Optional("calibration"): dict,
        vol.Optional("notes"): str,
        vol.Optional("floor_id"): str,
        vol.Optional("room_bounds"): dict,
        vol.Optional("stack"): dict,
        vol.Optional("beacons"): [dict],
        vol.Optional("lights"): list,
    }
)
@websocket_api.async_response
@admin_if_enhanced_security
async def ws_maps_update(hass: HomeAssistant, connection, msg) -> None:
    """Update map metadata: receivers, beacons, room_bounds, calibration, stack, notes.

    When beacons are saved, also triggers immediate calibration injection so
    the k-NN model incorporates them without waiting for the next walk-around.
    When beacons are removed, clears stale coordinator state to prevent
    ghost objects from lingering on the overview 3D map.

    ``lights`` (map pin placement for the Lights sidebar) is a PadSpan Pro
    feature — if no licence is active, the incoming value is dropped so the
    rest of the update still saves.
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    map_id = msg.get("map_id")

    # Enforce single Outside map when changing floor_id
    new_floor_id = msg.get("floor_id")
    if new_floor_id == OUTSIDE_FLOOR_ID:
        existing = [m for m in ms.list_maps()
                    if m.get("floor_id") == OUTSIDE_FLOOR_ID and m.get("id") != map_id]
        if existing:
            connection.send_error(msg["id"], "duplicate_outside",
                                  "Only one Outside map is allowed.")
            return

    # ── Capture old beacon keys BEFORE update (to detect removals) ────────
    _old_beacon_keys: set[str] = set()
    _beacons = msg.get("beacons")
    if _beacons is not None:
        try:
            _old_map = ms.get_map(map_id)
            if _old_map:
                for _bk in (_old_map.get("beacons") or []):
                    if _bk.get("key"):
                        _old_beacon_keys.add(_bk["key"])
        except Exception:
            _quiet_error("ws_maps:update_old_map")
            pass

    # Diagnostic: log incoming room_bounds for persistence debugging
    _incoming_rb = msg.get("room_bounds")
    if _incoming_rb is not None:
        _LOGGER.info("maps_update: map %s received %d room_bounds: %s", map_id[:8] if map_id else "?", len(_incoming_rb) if isinstance(_incoming_rb, dict) else -1, list(_incoming_rb.keys()) if isinstance(_incoming_rb, dict) else "not-dict")

    try:
        updated = await ms.async_update_map(
            map_id,
            receivers=msg.get("receivers"),
            beacons=_beacons,
            calibration=msg.get("calibration"),
            notes=msg.get("notes"),
            floor_id=msg.get("floor_id"),
            room_bounds=_incoming_rb,
            stack=msg.get("stack"),
        )
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return

    # Diagnostic: confirm what was actually saved
    _saved_rb = updated.get("room_bounds") or {}
    if _incoming_rb is not None:
        _LOGGER.info("maps_update: map %s saved %d room_bounds: %s", map_id[:8] if map_id else "?", len(_saved_rb), list(_saved_rb.keys()))

    # ── Clear coordinator state for removed beacons ───────────────────────
    # When beacons are removed from beacon tune, their stale coordinator
    # state (room lock, k-NN position, etc.) must be cleared so they don't
    # linger on the overview 3D map.
    if _beacons is not None and _old_beacon_keys:
        # What was stored, cleaned (maps_store.async_update_map), not the
        # message: a key of the wrong kind there is no key at all.
        _new_beacon_keys = {bk.get("key", "") for bk in (updated.get("beacons") or [])}
        _removed = _old_beacon_keys - _new_beacon_keys
        if _removed:
            try:
                _coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
                if _coord:
                    # Check if removed key still exists on another map
                    _all_map_keys: set[str] = set()
                    for _m in (ms.data.get("maps") or []):
                        for _bk in (_m.get("beacons") or []):
                            if _bk.get("key"):
                                _all_map_keys.add(_bk["key"])
                    for _rk in _removed:
                        if _rk not in _all_map_keys:
                            _coord.clear_object_state(_rk)
            except Exception:
                _quiet_error("ws_maps:update_beacons_removed")
                pass

    # ── Immediate calibration injection when beacons are saved ────────────
    if _beacons:
        try:
            _coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
            if _coord:
                _rb = updated.get("room_bounds") or {}
                _fid = updated.get("floor_id") or ""
                _injected = await _coord.inject_immediate_calibration(
                    _beacons, map_id, _fid, _rb
                )
                if _injected:
                    _LOGGER.debug(
                        "Immediate beacon calibration: %d points injected for map %s",
                        _injected, map_id,
                    )
        except Exception:
            _quiet_error("ws_maps:update_beacon_calibration")
            pass  # best-effort; don't fail the save

    # A map save does NOT write spatial fabric. Scanner/beacon/barrier metres
    # are ground truth; they change when a person places something, never
    # because the photo they were once traced on was saved again.

    # ── Phase 3: remap calibration points from metres when map changes ───
    # Skipped for stack-only saves (issue #56). The reason has changed and the
    # skip is now structural: a stack CANNOT carry a placement, so a save that
    # touches only the stack cannot have moved the map and re-deriving the
    # calibration fracs through an unchanged placement would be work with no
    # input. It used to be a judgement about which writes were "cosmetic",
    # which is what a second stored placement forced.
    _stack_only = (
        msg.get("stack") is not None
        and msg.get("receivers") is None and _beacons is None
        and msg.get("calibration") is None and _incoming_rb is None
        and msg.get("floor_id") is None
    )
    if not _stack_only:
        try:
            _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            if _cal:
                await _cal.async_remap_from_metres(map_id)
        except Exception:
            _quiet_error("ws_maps:update_calibration")
            pass  # best-effort

    connection.send_result(msg["id"], {"map": updated})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_replace_image",
        "map_id": str,
        "width": vol.All(int, vol.Range(min=1)),
        "height": vol.All(int, vol.Range(min=1)),
        "png_base64": str,
        # {fx0, fy0, fx1, fy1} in 0-1 image fractions
        vol.Optional("crop"): {vol.Optional(k): finite_float for k in ("fx0", "fy0", "fx1", "fy1")},
        # {deg, sx, sy} baked rotate/scale (canvas op)
        vol.Optional("pixel_op"): {vol.Optional(k): finite_float for k in ("deg", "sx", "sy")},
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_replace_image(hass: HomeAssistant, connection, msg) -> None:
    """Replace the stored PNG for an existing map and renormalize coordinates."""
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return

    _map_id = msg.get("map_id") or ""
    _mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    # Phase 4: skip crop-based renorm when metre model is authoritative
    _has_model = bool(_mdl and _mdl.map_transform(_map_id))

    # Old pixel dims — needed to compose a baked rotate/scale into the
    # transform, and gone once async_replace_image mutates the map dict.
    _m_before = ms.get_map(_map_id)
    _old_px = None
    if _m_before:
        _oi = _m_before.get("image") or {}
        if int(_oi.get("width") or 0) > 0 and int(_oi.get("height") or 0) > 0:
            _old_px = (int(_oi["width"]), int(_oi["height"]))

    try:
        updated = await ms.async_replace_image(
            _map_id,
            msg.get("png_base64") or "",
            msg.get("width") or 0,
            msg.get("height") or 0,
            msg.get("crop"),
            skip_frac_renorm=_has_model,
            pixel_op=msg.get("pixel_op"),
        )
    except KeyError:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    except ValueError as exc:
        # As an upload says it: only the size limit is "too large".
        connection.send_error(msg["id"], "upload_too_large" if "limit" in str(exc) else "invalid_image", str(exc))
        return

    # Phase 4: recompute transform + re-derive all map fracs from metres
    _scale_invalidated = False
    try:
        if _mdl and _map_id:
            _recomputed = await _mdl.async_recompute_transform_for_map(
                _map_id, updated, ms, crop=msg.get("crop"),
                pixel_op=msg.get("pixel_op"), old_px=_old_px,
            )
            # A measured map whose transform is gone after recompute was
            # invalidated (unrepresentable op) — tell the client so the user
            # hears "re-measure" instead of silently losing the scale.
            _scale_invalidated = _has_model and not _mdl.map_transform(_map_id)
            if _recomputed:
                _n = await _mdl.async_rederive_map_fracs(_map_id, updated)
                if _n:
                    await ms.store.async_save(ms.data)
            # Phase 3: remap calibration points (with updated transform)
            _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            if _cal:
                await _cal.async_remap_from_metres(_map_id)
    except Exception:
        # The image is already replaced and the trace renormalized WITH it —
        # but the PLACEMENT was not rebased, so until a recompute succeeds
        # (or the owner re-measures) every fraction on this map converts to
        # metres through a record describing the pre-op picture. The trace
        # and the image at least agree with each other, which is what makes
        # the state repairable at all; a swallowed failure here is how a
        # whole class of stale-space damage stayed invisible (issue #62).
        _LOGGER.exception("maps_replace_image: transform recompute/rederive failed for %s — placement still describes the pre-op image until re-measured", _map_id)

    connection.send_result(msg["id"], {"map": updated, "scale_invalidated": _scale_invalidated})


@websocket_api.websocket_command({"type": "padspan_ha/maps_delete", "map_id": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a map and scrub every OTHER store's reference to it.

    Nothing cascades automatically when a map disappears — calibration
    points, traceback frames, and the settings' hidden_map_ids list all
    hold their own copy of map_id, so each is walked and cleaned up here
    explicitly before the map record itself is removed. Each cleanup is
    best-effort (a failure there must never block the delete the user
    actually asked for) except the delete itself, which is the one step
    allowed to fail loudly.
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    map_id = msg.get("map_id") or ""
    # Clean up calibration data for the deleted map
    try:
        cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if cal:
            await cal.async_clear_map(map_id)
            from .ws_calibration import _note_points_seen  # noqa: PLC0415
            await _note_points_seen(hass, cal)
    except Exception:
        _quiet_error("ws_maps:delete_calibration")
        pass

    # Clean up traceback frames referencing this map
    try:
        _tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
        if _tb and hasattr(_tb, "frames"):
            _before = len(_tb.frames)
            # Remove map_id references from traceback objects (don't delete frames,
            # just clear the map_id so they won't try to render on a dead map)
            for _fr in _tb.frames:
                for _obj in (_fr.get("objects") or []):
                    if _obj.get("m") == map_id:
                        _obj["m"] = ""
    except Exception:
        _quiet_error("ws_maps:delete_traceback")
        pass

    # Clean up hidden_map_ids in settings
    try:
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if _st and isinstance(_st.data, dict):
            _hidden = _st.data.get("hidden_map_ids")
            if isinstance(_hidden, list) and map_id in _hidden:
                _st.data["hidden_map_ids"] = [x for x in _hidden if x != map_id]
                await _st.async_save()
    except Exception:
        _quiet_error("ws_maps:delete_settings")
        pass

    await ms.async_delete_map(map_id)
    _note_map_deleted(hass, ms, migrated=False)
    connection.send_result(msg["id"], {"ok": True})


def _note_map_deleted(hass: HomeAssistant, ms: Any, migrated: bool) -> None:
    """A map deleted on purpose (0.38.177): counted, and the report's marker
    follows, so the next report does not read it as a map lost
    (telemetry health.maps_vanished)."""
    try:
        from .telemetry import bump  # noqa: PLC0415
        if migrated:
            bump(hass, "map_deleted_migrated")
        else:
            bump(hass, "map_deleted")
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if _st is not None and isinstance(_st.data, dict):
            _n = len((ms.data or {}).get("maps") or [])
            _st.data["maps_seen"] = _n                       # this run's report reads it at once
            hass.async_create_task(_st.async_set(maps_seen=_n))   # and a restart keeps it
    except Exception as err:  # noqa: BLE001
        _quiet_error("ws_maps:note_map_deleted")
        _LOGGER.debug("map delete not noted: %s", err)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_delete_migrate",
        "map_id": str,
        "target_map_id": str,
        vol.Optional("extend_canvas", default=False): bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_delete_migrate(hass: HomeAssistant, connection, msg) -> None:
    """Delete a map after migrating its data (receivers, beacons, room_bounds,
    calibration) to a target map on the same z-level.

    Coordinates are transformed from source map space → world → target map
    space using stack alignment.  If migrated data falls outside the target's
    [0,1] bounds the target canvas is extended automatically.
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return

    src_id = str(msg.get("map_id") or "").strip()
    tgt_id = str(msg.get("target_map_id") or "").strip()
    src_map = ms.get_map(src_id)
    tgt_map = ms.get_map(tgt_id)
    if not src_map:
        connection.send_error(msg["id"], "not_found", "Source map not found")
        return
    if not tgt_map:
        connection.send_error(msg["id"], "not_found", "Target map not found")
        return

    _mdl_x = hass.data.get(DOMAIN, {}).get(DATA_MODEL)

    def _xform(px: float, py: float) -> tuple[float, float]:
        """Source map 0-1 → target map 0-1, THROUGH METRES.

        It went source → world → target, on two `stack` dicts and a pair of
        static helpers in the maps store that were a fourth copy of the
        renderer's affine. Metres are the shared frame now — a fraction of one
        picture is a place in the house, and a place in the house is a
        fraction of another picture — so this is the two conversions every
        other consumer already uses, with no world space in the middle.

        Refuses (returns the point unchanged, so the caller's clamp keeps it
        on the map) when either map has no placement: two pictures with no
        metres between them have no spatial relationship to preserve, and
        inventing one is how coordinates end up in the wrong room.
        """
        if not _mdl_x:
            return (px, py)
        _m_pt = _mdl_x.map_frac_to_metres(px, py, src_id)
        if not _m_pt:
            return (px, py)
        _f = _mdl_x.metres_to_map_frac(_m_pt[0], _m_pt[1], tgt_id)
        return _f if _f else (px, py)

    def _xform_bounds(bounds: dict) -> dict:
        """Transform a room_bounds entry from source → target space."""
        b = dict(bounds)
        if b.get("type") == "poly" and isinstance(b.get("points"), list):
            b["points"] = [list(_xform(p[0], p[1])) for p in b["points"] if len(p) >= 2]
        elif b.get("type") == "circle":
            # Every probe reads the SOURCE values, captured before anything
            # is written. The radius probe used to read b["cx"] after the
            # centre had already been overwritten with the TARGET value, so
            # it transformed (target_cx + r, target_cy) as if it were a
            # source point — a wrong radius whenever the two placements
            # differ at all, which is the whole reason a migration runs.
            scx = float(bounds.get("cx", 0.5))
            scy = float(bounds.get("cy", 0.5))
            r = float(bounds.get("r", 0.12))
            cx, cy = _xform(scx, scy)
            # Sample both axes: a single +x probe is wrong whenever the
            # composed transform is anisotropic (different x/y scale, or a
            # rotation between the two placements) — average the two
            # probes' distances as a low-risk equivalent-circle radius.
            rx, ry = _xform(scx + r, scy)
            rx2, ry2 = _xform(scx, scy + r)
            r1 = ((rx - cx) ** 2 + (ry - cy) ** 2) ** 0.5
            r2 = ((rx2 - cx) ** 2 + (ry2 - cy) ** 2) ** 0.5
            b["cx"] = cx
            b["cy"] = cy
            b["r"] = max(0.01, (r1 + r2) / 2.0)
        return b

    tgt_receivers = list(tgt_map.get("receivers") or [])
    tgt_beacons = list(tgt_map.get("beacons") or [])
    tgt_bounds = dict(tgt_map.get("room_bounds") or {})

    tgt_rx_sources = {r.get("source") for r in tgt_receivers if r.get("source")}
    tgt_bk_keys = {b.get("key") for b in tgt_beacons if b.get("key")}

    moved_receivers: list[str] = []
    moved_beacons: list[str] = []
    # What Revert migration removes: labels repeat ("Kitchen" on both maps),
    # keys don't, and the migration already told the two apart by key.
    moved_receiver_keys: list[str] = []
    moved_beacon_keys: list[str] = []
    moved_rooms: list[str] = []
    skipped_receivers: list[str] = []
    skipped_beacons: list[str] = []
    skipped_rooms: list[str] = []

    # Collect all migrated target-space coords to detect canvas extension need
    all_migrated_pts: list[tuple[float, float]] = []

    # --- Migrate receivers ---
    for rx in (src_map.get("receivers") or []):
        src_key = rx.get("source") or rx.get("id") or ""
        label = rx.get("label") or src_key
        if src_key and src_key in tgt_rx_sources:
            skipped_receivers.append(f"{label} (already on target)")
            continue
        new_rx = dict(rx)
        tx, ty = _xform(float(rx.get("x", 0.5)), float(rx.get("y", 0.5)))
        new_rx["x"] = tx
        new_rx["y"] = ty
        new_rx["_migrated"] = True
        all_migrated_pts.append((tx, ty))
        tgt_receivers.append(new_rx)
        moved_receivers.append(label)
        moved_receiver_keys.append(src_key)
        if src_key:
            tgt_rx_sources.add(src_key)

    # --- Migrate beacons ---
    for bk in (src_map.get("beacons") or []):
        bk_key = bk.get("key") or ""
        label = bk.get("label") or bk_key
        if bk_key and bk_key in tgt_bk_keys:
            skipped_beacons.append(f"{label} (already on target)")
            continue
        new_bk = dict(bk)
        tx, ty = _xform(float(bk.get("x", 0.5)), float(bk.get("y", 0.5)))
        new_bk["x"] = tx
        new_bk["y"] = ty
        new_bk["_migrated"] = True
        all_migrated_pts.append((tx, ty))
        tgt_beacons.append(new_bk)
        moved_beacons.append(label)
        moved_beacon_keys.append(bk_key)
        if bk_key:
            tgt_bk_keys.add(bk_key)

    # --- Migrate room_bounds ---
    for room_name, bounds in (src_map.get("room_bounds") or {}).items():
        if room_name in tgt_bounds:
            skipped_rooms.append(f"{room_name} (already drawn on target)")
            continue
        new_b = _xform_bounds(bounds)
        # Collect all points for canvas extension check
        if new_b.get("type") == "poly":
            for p in (new_b.get("points") or []):
                all_migrated_pts.append((p[0], p[1]))
        elif new_b.get("type") == "circle":
            cx, cy, r = new_b.get("cx", 0.5), new_b.get("cy", 0.5), new_b.get("r", 0.12)
            all_migrated_pts.extend([(cx - r, cy - r), (cx + r, cy + r)])
        tgt_bounds[room_name] = new_b
        moved_rooms.append(room_name)

    # --- Check if canvas extension is needed ---
    canvas_extended = False
    needs_extend = False
    _renorm_x = lambda px: px  # noqa: E731 — identity unless canvas is extended
    _renorm_y = lambda py: py  # noqa: E731
    if all_migrated_pts:
        min_x = min(p[0] for p in all_migrated_pts)
        max_x = max(p[0] for p in all_migrated_pts)
        min_y = min(p[1] for p in all_migrated_pts)
        max_y = max(p[1] for p in all_migrated_pts)

        margin = 0.03  # 3% padding
        pad_left = max(0.0, -min_x + margin)
        pad_right = max(0.0, max_x - 1.0 + margin)
        pad_top = max(0.0, -min_y + margin)
        pad_bottom = max(0.0, max_y - 1.0 + margin)

        needs_extend = pad_left > 0 or pad_right > 0 or pad_top > 0 or pad_bottom > 0

        if needs_extend and msg.get("extend_canvas"):
            try:
                await ms.async_extend_canvas(
                    tgt_id, pad_left, pad_right, pad_top, pad_bottom,
                    model_store=hass.data.get(DOMAIN, {}).get(DATA_MODEL))
                canvas_extended = True
                tgt_map = ms.get_map(tgt_id)
                old_w_ratio = 1.0 / (1.0 + pad_left + pad_right)
                old_h_ratio = 1.0 / (1.0 + pad_top + pad_bottom)
                ox_off = pad_left / (1.0 + pad_left + pad_right)
                oy_off = pad_top / (1.0 + pad_top + pad_bottom)

                _renorm_x = lambda px: ox_off + float(px) * old_w_ratio  # noqa: E731
                _renorm_y = lambda py: oy_off + float(py) * old_h_ratio  # noqa: E731

                for rx in tgt_receivers:
                    if rx.get("_migrated"):
                        rx["x"] = _renorm_x(rx["x"])
                        rx["y"] = _renorm_y(rx["y"])
                for bk in tgt_beacons:
                    if bk.get("_migrated"):
                        bk["x"] = _renorm_x(bk["x"])
                        bk["y"] = _renorm_y(bk["y"])
                for rm_name in moved_rooms:
                    b = tgt_bounds.get(rm_name)
                    if not b:
                        continue
                    if b.get("type") == "poly":
                        b["points"] = [[_renorm_x(p[0]), _renorm_y(p[1])] for p in b.get("points", [])]
                    elif b.get("type") == "circle":
                        b["cx"] = _renorm_x(b.get("cx", 0.5))
                        b["cy"] = _renorm_y(b.get("cy", 0.5))
                        b["r"] = float(b.get("r", 0.12)) * min(old_w_ratio, old_h_ratio)
            except Exception as _ext_err:
                _quiet_error("ws_maps:delete_migrate_canvas")
                _LOGGER.debug("Canvas extension failed: %s", _ext_err)
        elif needs_extend and not msg.get("extend_canvas"):
            # Data needs extending but user hasn't approved — report overflow
            # Items outside [0,1] will be clamped to the edge (not ideal but safe)
            pass

    # Clean up migration markers before save
    for rx in tgt_receivers:
        rx.pop("_migrated", None)
    for bk in tgt_beacons:
        bk.pop("_migrated", None)

    # --- Save merged data to target map ---
    await ms.async_update_map(
        tgt_id,
        receivers=tgt_receivers,
        calibration=(tgt_map or {}).get("calibration") or {},
        notes=(tgt_map or {}).get("notes") or "",
        floor_id=(tgt_map or {}).get("floor_id") or "",
        room_bounds=tgt_bounds,
        stack=(tgt_map or {}).get("stack") or {},
        beacons=tgt_beacons,
    )

    # --- Migrate calibration points (transform coords too) ---
    cal_moved = 0
    try:
        cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if cal:
            points = cal.data.get("points", [])
            changed = False
            for pt in points:
                if pt.get("map_id") == src_id:
                    # Transform calibration point coordinates.  Points store
                    # x_frac/y_frac — reading "x"/"y" always hit the 0.5
                    # default, so points were re-owned to the target with
                    # their untransformed source fracs.
                    px = float(pt.get("x_frac", 0.5))
                    py = float(pt.get("y_frac", 0.5))
                    tx, ty = _xform(px, py)
                    if canvas_extended:
                        tx = _renorm_x(tx)
                        ty = _renorm_y(ty)
                    pt["x_frac"] = round(tx, 4)
                    pt["y_frac"] = round(ty, 4)
                    pt["map_id"] = tgt_id
                    cal_moved += 1
                    changed = True
            if changed:
                cov = (cal.data.get("model") or {}).get("coverage_by_map")
                if isinstance(cov, dict):
                    cov.pop(src_id, None)
                    cov.pop(tgt_id, None)
                await cal.store.async_save(cal.data)
    except Exception:
        _quiet_error("ws_maps:delete_migrate_calibration")
        pass

    # --- Delete the source map ---
    await ms.async_delete_map(src_id)
    _note_map_deleted(hass, ms, migrated=True)

    connection.send_result(msg["id"], {
        "ok": True,
        "canvas_extended": canvas_extended,
        "needs_extend": needs_extend and not canvas_extended,
        "migrated": {
            "receivers": moved_receivers,
            "beacons": moved_beacons,
            "receiver_keys": moved_receiver_keys,
            "beacon_keys": moved_beacon_keys,
            "rooms": moved_rooms,
            "calibration_points": cal_moved,
        },
        "skipped": {
            "receivers": skipped_receivers,
            "beacons": skipped_beacons,
            "rooms": skipped_rooms,
        },
    })


@websocket_api.websocket_command({"type": "padspan_ha/maps_revert_extend", "map_id": str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_revert_extend(hass: HomeAssistant, connection, msg) -> None:
    """Revert a canvas extension on a map (undo the image padding + coord shift)."""
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    result = await ms.async_revert_extend(
        msg.get("map_id") or "",
        model_store=hass.data.get(DOMAIN, {}).get(DATA_MODEL))
    if result:
        connection.send_result(msg["id"], {"ok": True})
    else:
        connection.send_result(msg["id"], {"ok": False, "reason": "no_extend_snapshot"})


# A room scan from a phone's LiDAR (Apple's RoomPlan: the USDZ every such app can share, or its JSON), 2026-11-16: read
# (roomplan_import), turned so its walls run along the axes, drawn as a plan picture to scale, and saved as any plan
# is, its scale exact: nothing to measure. Its rooms' outlines and names are kept on the plan's record (`scan`).
class _TooBig(Exception):
    """A scan larger than a floor of a house."""


# Home Assistant drops a websocket message over about 4 MiB (seen 2026-11-16: a 5 MB file never arrived), so a scan is
# at most 2.8 MB, about 3.75 MB as base64. Real scans seen: 0.13 to 1.45 MB.
SCAN_MAX_B64 = 3_800_000
SCAN_WORDS: dict[str, str] = {
    "too_large": "This file is too large to be a room scan (2.8 MB at most).",
    "outdoor": "A room scan is of a floor of the house, not the outdoors.",
    "empty": "No walls were found in this scan, so there is nothing to draw.",
    "too_big": "This scan is larger than a floor of a house (200 m at most, 3,000 walls), so it wasn't drawn.",
}
SCAN_MAX_M, SCAN_MAX_WALLS, SCAN_MAX_OBJECTS = 200.0, 3000, 2000
SCAN_CORNER_M = 0.35          # a room outline's corner this near a wall end is that wall end


@websocket_api.websocket_command({"type": "padspan_ha/maps_fit_suggest", vol.Required("map_id"): str, vol.Required("ref_map_id"): str})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_fit_suggest(hass: HomeAssistant, connection, msg) -> None:
    """Where this plan would sit over the Reference plan's floor, from the rooms traced on it (roomplan_import.
    fit_to_floor). Reads only: the Align editor shows it and the person saves it or not. {fit: {origin_x_m,
    origin_y_m, rotation_rad, score} | None}."""
    dom = hass.data.get(DOMAIN, {})
    ms, mdl = dom.get(DATA_MAPS), dom.get(DATA_MODEL)
    m, ref = (ms.get_map(msg["map_id"]), ms.get_map(msg["ref_map_id"])) if ms else (None, None)
    t = mdl.map_transform(msg["map_id"]) if (mdl is not None and m) else None
    fit = None
    try:
        from . import roomplan_import as RP  # noqa: PLC0415
        if m and ref and t and float(t.get("scale_x_m") or 0) > 0 and float(t.get("scale_y_m") or 0) > 0:
            floor = str(ref.get("floor_id") or DEFAULT_FLOOR_ID)
            sx, sy = float(t["scale_x_m"]), float(t["scale_y_m"])
            mine = {n: [[float(p[0]) * sx, float(p[1]) * sy] for p in (b.get("points") or [])] for n, b in (m.get("room_bounds") or {}).items()
                    if isinstance(b, dict) and b.get("type", "poly") == "poly"}
            on_it = set(m.get("room_bounds") or {})
            house = {n: [p[:2] for p in (g.get("points_m") or [])] for n, g in (mdl.room_geometry_m() or {}).items()
                     if isinstance(g, dict) and str(g.get("floor_id") or DEFAULT_FLOOR_ID) == floor and n not in on_it}
            got = await hass.async_add_executor_job(RP.fit_to_floor, mine, house)
            if got:
                fit = {k: got[k] for k in ("origin_x_m", "origin_y_m", "rotation_rad", "score")}
    except Exception:  # noqa: BLE001 — a suggestion that can't be worked out is no suggestion
        _quiet_error("ws_maps:fit_suggest")
        _LOGGER.debug("PadSpan: no fit suggested", exc_info=True)
    connection.send_result(msg["id"], {"fit": fit})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_scan_create",
        "floor_id": str,
        vol.Required("file_base64"): str,
        vol.Optional("name", default=""): vol.All(str, vol.Length(max=120)),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_maps_scan_create(hass: HomeAssistant, connection, msg) -> None:
    """{ok, map, rooms, heights_m, warnings} or {ok: false, message}: nothing is written unless the scan reads."""
    from . import roomplan_import as RP  # noqa: PLC0415
    from .maps_store import scan_plan_png  # noqa: PLC0415
    from .ws_fabric import async_write_measured_transform  # noqa: PLC0415
    from .ws_house3d_import import scan_furniture  # noqa: PLC0415
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_error(msg["id"], "no_maps_store", "Maps store not initialized")
        return
    floor_id = msg.get("floor_id") or DEFAULT_FLOOR_ID

    def no(code: str, message: str) -> None:
        connection.send_result(msg["id"], {"ok": False, "code": code, "message": message})

    if is_outdoor_floor(floor_id):
        return no("outdoor", SCAN_WORDS["outdoor"])
    if len(msg["file_base64"]) > SCAN_MAX_B64:
        return no("too_large", SCAN_WORDS["too_large"])

    def read() -> tuple[dict, dict | None, tuple | None]:
        raw = base64.b64decode(msg["file_base64"])
        parsed = RP.parse_roomplan(raw)
        parsed["file"] = "usdz" if raw[:2] == b"PK" else "json"
        frame = RP.plan_frame(parsed) if parsed.get("walls") else None
        if frame and (not (0 < frame["across_m"] <= SCAN_MAX_M and 0 < frame["down_m"] <= SCAN_MAX_M) or len(frame["walls"]) > SCAN_MAX_WALLS):
            raise _TooBig()
        if frame:
            frame["objects"] = frame["objects"][:SCAN_MAX_OBJECTS]
        return parsed, frame, scan_plan_png(frame) if frame else None

    try:
        parsed, frame, pic = await hass.async_add_executor_job(read)
    except RP.RoomPlanParseError as err:
        return no(err.code, str(err))
    except _TooBig:
        return no("too_large", SCAN_WORDS["too_big"])
    except Exception:  # noqa: BLE001 — a file from anywhere: whatever it does, the answer is that it couldn't be read
        _quiet_error("ws_maps:scan_create_read")
        _LOGGER.debug("PadSpan: a scan file could not be read", exc_info=True)
        return no("unreadable", "This file could not be read.")
    if not frame or not pic:
        return no("empty", SCAN_WORDS["empty"])
    png, w, h = pic
    info = await ms.async_add_map(msg["name"].strip() or "Room scan", "room-scan.png", "image/png", w, h,
                                  base64.b64encode(png).decode("ascii"), floor_id, kind="scan")
    across, down = frame["across_m"], frame["down_m"]
    # The walls are what the phone measured; a scan's floor outline can run a little outside them (a sample's ran
    # 0.18 m out on every side). So the wall ends are kept as the corners a drawn room lands on, and each corner of a
    # room's outline within SCAN_CORNER_M of a wall end is put on it.
    ends = list({(e[0], e[1]) for w_ in frame["walls"] for e in w_})[:400]
    frac = lambda p: [round(p[0] / across, 4), round(p[1] / down, 4)]  # noqa: E731

    def _on_wall(p):
        e = min(ends, key=lambda q: math.dist(q, p), default=None)
        return e if e is not None and math.dist(e, p) <= SCAN_CORNER_M else p

    info["scan"] = {"rooms": [{"name": r.get("name"), "points": [frac(_on_wall(p)) for p in r["points_m"]]} for r in frame["rooms"]][:60],
                    "corners": [frac(e) for e in ends],
                    "heights_m": (parsed.get("heights_m") or [])[:40],
                    "furniture": scan_furniture(frame)}
    await ms.store.async_save(ms.data)
    ref = {"p1": [0.0, 0.5], "p2": [1.0, 0.5], "distance_m": round(across, 4), "px_per_meter": round(w / across * 100) / 100,
           "angle_deg": 0, "date": _time.strftime("%Y-%m-%d", _time.gmtime()), "source": "scan"}
    await async_write_measured_transform(hass, info["id"], {"scale_x_m": round(across, 4), "scale_y_m": round(down, 4),
                                                           "reference_measurements": [ref], "floor_id": floor_id})
    # Autoplace (roomplan_import.autoplace): on a floor that already has rooms, the scan is put where its outline
    # fits them, by the Align editor's own writer. Only the new plan is placed; nothing that exists is moved. Where it
    # fits nowhere, or as well in two places, it stays where every new plan starts and the answer says so.
    placed: dict | None = None
    try:
        mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        geo = mdl.room_geometry_m() if mdl is not None else {}
        house = {n: [p[:2] for p in (g.get("points_m") or [])] for n, g in (geo or {}).items()
                 if isinstance(g, dict) and str(g.get("floor_id") or DEFAULT_FLOOR_ID) == floor_id}
        if house:
            h3 = getattr(hass.data.get(DOMAIN, {}).get(DATA_HOUSE3D), "data", None) or {}
            doors = [[o["a_m"], o["b_m"]] for o in (h3.get("openings") or {}).values()
                     if isinstance(o, dict) and str(o.get("floor_id") or DEFAULT_FLOOR_ID) == floor_id and o.get("a_m") and o.get("b_m")]
            fit = await hass.async_add_executor_job(RP.autoplace, frame, house, doors or None)
            placed = {"fit": False}
            if fit:
                res = await mdl.async_reanchor_map(info["id"], info, hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION),
                                                   origin_x_m=fit["origin_x_m"], origin_y_m=fit["origin_y_m"], rotation_rad=fit["rotation_rad"])
                if res.get("ok"):
                    if res.get("map_items_rederived"):
                        await ms.store.async_save(ms.data)
                    placed = {"fit": True, **{k: fit[k] for k in ("room", "score", "fits_both_ways", "size_scan_m") if k in fit},
                              **({"size_room_m": fit["size_room_m"]} if fit.get("size_room_m") else {})}
    except Exception:  # noqa: BLE001 — the plan is saved either way: it is only not placed
        _quiet_error("ws_maps:scan_create_model")
        _LOGGER.debug("PadSpan: a scan could not be placed among the floor's rooms", exc_info=True)
    connection.send_result(msg["id"], {"ok": True, "map": info, "rooms": len(frame["rooms"]), "walls": len(frame["walls"]),
                                       **({"placed": placed} if placed is not None else {}),
                                       "heights_m": info["scan"]["heights_m"], "warnings": parsed.get("warnings") or [],
                                       "file": parsed["file"], "named": any(r.get("name") for r in frame["rooms"])})
