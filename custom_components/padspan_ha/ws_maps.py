# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for the floor-plan photographs (upload, update, replace, delete).

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DEFAULT_FLOOR_ID,
    OUTSIDE_FLOOR_ID,
    DATA_COORDINATOR,
    DATA_CALIBRATION,
    DATA_TRACEBACK,
)
import time as _time

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
    connection.send_result(msg["id"], {"maps": maps})


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
    }
)
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
        )
    except ValueError as exc:
        connection.send_error(msg["id"], "upload_too_large", str(exc))
        return
    connection.send_result(msg["id"], {"map": info})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_update",
        "map_id": str,
        vol.Optional("receivers"): list,
        vol.Optional("calibration"): dict,
        vol.Optional("notes"): str,
        vol.Optional("floor_id"): str,
        vol.Optional("room_bounds"): dict,
        vol.Optional("stack"): dict,
        vol.Optional("beacons"): list,
        vol.Optional("lights"): list,
    }
)
@websocket_api.async_response
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
        _new_beacon_keys = {bk.get("key", "") for bk in _beacons}
        _removed = _old_beacon_keys - _new_beacon_keys
        if _removed:
            try:
                _coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
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
                pass

    # ── Immediate calibration injection when beacons are saved ────────────
    if _beacons:
        try:
            _coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
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
            pass  # best-effort

    connection.send_result(msg["id"], {"map": updated})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/maps_replace_image",
        "map_id": str,
        "width": int,
        "height": int,
        "png_base64": str,
        vol.Optional("crop"): dict,      # {fx0, fy0, fx1, fy1} in 0-1 image fractions
        vol.Optional("pixel_op"): dict,  # {deg, sx, sy} baked rotate/scale (canvas op)
    }
)
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
    except Exception:
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
        pass

    await ms.async_delete_map(map_id)
    connection.send_result(msg["id"], {"ok": True})


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
        pass

    # --- Delete the source map ---
    await ms.async_delete_map(src_id)

    connection.send_result(msg["id"], {
        "ok": True,
        "canvas_extended": canvas_extended,
        "needs_extend": needs_extend and not canvas_extended,
        "migrated": {
            "receivers": moved_receivers,
            "beacons": moved_beacons,
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
