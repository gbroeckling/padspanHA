# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""One-shot upgrade repairs.

Each migration runs exactly once per install, guarded by a marker in the
fabric store, and is safe to call on every startup.

`fabric_photo_divorce` is the upgrade path onto the metre-only fabric. Before
it, scanner/beacon/barrier metres were continuously re-derived from
(photo fracs x that photo's transform), so a photo hanging in the wrong place
silently held wrong coordinates — and a never-measured photo was given a
fabricated 20 m width, which put every position on it at the wrong scale.
Nothing re-derives any more, which is the point: it also means whatever is
wrong today stays wrong. So the photo gets one final use on the way out —
transforms are repaired against the hand-tuned 3D stack, positions are
re-derived through the corrected placement, and the ownership keys that only
existed to serve re-derivation are stripped. After this the fabric stands on
its own and no image is consulted again.
"""

from __future__ import annotations

import logging
from typing import Any

from .const import DEFAULT_FLOOR_ID

_LOGGER = logging.getLogger(__name__)

MARKER = "migrations_done"
PHOTO_DIVORCE = "fabric_photo_divorce"

# A transform matching the stack this closely is already correct.
_ORIGIN_TOL_M = 0.2
_SCALE_TOL_FRAC = 0.02


def _agrees(t: dict, stack_t: dict) -> bool:
    try:
        return (
            abs(float(t.get("origin_x_m", 0)) - stack_t["origin_x_m"]) <= _ORIGIN_TOL_M
            and abs(float(t.get("origin_y_m", 0)) - stack_t["origin_y_m"]) <= _ORIGIN_TOL_M
            and abs(float(t.get("scale_x_m", 0)) - stack_t["scale_x_m"])
            <= max(_ORIGIN_TOL_M, _SCALE_TOL_FRAC * stack_t["scale_x_m"])
            and abs(float(t.get("scale_y_m", 0)) - stack_t["scale_y_m"])
            <= max(_ORIGIN_TOL_M, _SCALE_TOL_FRAC * stack_t["scale_y_m"])
        )
    except (TypeError, ValueError, KeyError):
        return False


def _strip_legacy_keys(fab: Any) -> int:
    """Remove origin / z_origin / map_id — they only meant "re-derivable"."""
    n = 0
    for entry in list((fab.data.get("scanner_positions_m") or {}).values()):
        for k in ("origin", "z_origin", "map_id"):
            if k in entry:
                entry.pop(k, None)
                n += 1
    for entry in list((fab.data.get("beacon_positions_m") or {}).values()):
        for k in ("origin", "map_id"):
            if k in entry:
                entry.pop(k, None)
                n += 1
    # Barriers keep map_id: it is how an Edit-tab save replaces the walls it
    # drew. Only the origin class goes.
    for entry in list(fab.data.get("rf_barriers_m") or []):
        if "origin" in entry:
            entry.pop("origin", None)
            n += 1
    return n


async def async_run_photo_divorce(
    hass: Any, mdl: Any, ms: Any, fab: Any, cal: Any = None,
) -> dict[str, Any]:
    """Repair photo-derived coordinates once, then cut the cord.

    Returns a stats dict; {"skipped": True} if it has already run.
    """
    done = set(fab.data.get(MARKER) or [])
    if PHOTO_DIVORCE in done:
        return {"skipped": True}

    from . import fabric_truth

    stats: dict[str, Any] = {
        "maps_repaired": [], "maps_already_correct": 0,
        "positions_rederived": 0, "legacy_keys_stripped": 0,
        "cal_points_anchored": 0, "lights_converted": 0, "anchor": None,
    }

    maps_list = (ms.data.get("maps") or []) if ms else []
    anchor = fabric_truth.find_metre_anchor(maps_list, mdl) if maps_list else None
    stats["anchor"] = (anchor or {}).get("map_id")

    # 1. Repair placements that disagree with the hand-tuned stack. Without a
    #    measured map there is no metre anchor and therefore nothing to check
    #    against — leave those alone rather than guess.
    if anchor:
        for m in maps_list:
            mid = m.get("id", "")
            t = mdl.map_transform(mid)
            stack_t = fabric_truth.stack_metre_transform(m, anchor)
            if not stack_t:
                continue
            if t and _agrees(t, stack_t):
                stats["maps_already_correct"] += 1
                continue
            new_t = dict(stack_t)
            new_t["floor_id"] = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            if t and t.get("reference_measurements"):
                new_t["reference_measurements"] = t["reference_measurements"]
            await mdl.async_set_map_transform(mid, new_t, reanchor=True)
            stats["maps_repaired"].append(m.get("name", mid))

    # 2. The photo's last job: convert its pins through the corrected
    #    placement, for entries that have never been touched in metres.
    if anchor:
        stats["positions_rederived"] = await _rederive_once(mdl, fab, maps_list)

    # 3. Calibration points recorded on a photo but never given metres get
    #    them now, through the repaired placements. A point's metres are where
    #    a person physically stood; after this they are the stored truth and
    #    the photo coordinates are only used to draw the dot.
    if cal is not None and anchor:
        try:
            stats["cal_points_anchored"] = await cal.async_backfill_metres()
        except Exception as err:  # never block the rest of the migration
            _LOGGER.warning("Calibration backfill during migration failed: %s", err)

    # 4. Light placements lived per-photo, in that photo's fraction space.
    #    Convert them to metres once; from here a light is placed in the
    #    house like everything else.
    if anchor:
        stats["lights_converted"] = await _convert_lights(mdl, fab, maps_list)

    # 5. Drop the keys that only existed to mark things re-derivable.
    stats["legacy_keys_stripped"] = _strip_legacy_keys(fab)

    done.add(PHOTO_DIVORCE)
    fab.data[MARKER] = sorted(done)
    await fab.store.async_save(fab.data)
    _LOGGER.info(
        "Photo divorce migration: %d map placement(s) repaired (%s), %d already correct, "
        "%d position(s) re-derived one last time, %d calibration point(s) anchored, "
        "%d light(s) converted to metres, %d legacy key(s) stripped",
        len(stats["maps_repaired"]), ", ".join(stats["maps_repaired"]) or "none",
        stats["maps_already_correct"], stats["positions_rederived"],
        stats["cal_points_anchored"], stats["lights_converted"],
        stats["legacy_keys_stripped"],
    )
    return stats


async def _rederive_once(mdl: Any, fab: Any, maps_list: list[dict]) -> int:
    """Final frac -> metre conversion, for map-origin entries only.

    An entry a person has already placed in metres carries no origin marker
    and is never touched. This is the only place in the codebase that still
    reads photo coordinates into the fabric, and it runs once.
    """
    scanners = fab.scanner_positions_m()
    beacons = fab.beacon_positions_m()
    set_scanners: dict[str, dict] = {}
    set_beacons: dict[str, dict] = {}
    count = 0

    for m in maps_list:
        mid = m.get("id", "")
        if not mdl.map_transform(mid):
            continue
        fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
        for rx in (m.get("receivers") or []):
            src = rx.get("source") or rx.get("id", "")
            cur = scanners.get(src)
            if not src or not isinstance(cur, dict):
                continue
            if cur.get("origin") != "map":      # placed by hand — leave it
                continue
            coords = mdl.map_frac_to_metres(float(rx.get("x", 0)), float(rx.get("y", 0)), mid)
            if not coords:
                continue
            entry = {k: v for k, v in cur.items() if k not in ("origin", "z_origin", "map_id")}
            entry["x_m"], entry["y_m"] = round(coords[0], 3), round(coords[1], 3)
            entry["floor_id"] = fl
            set_scanners[src] = entry
            count += 1
        for bk in (m.get("beacons") or []):
            key = bk.get("key")
            cur = beacons.get(key)
            if not key or not isinstance(cur, dict):
                continue
            if cur.get("origin") != "map":
                continue
            coords = mdl.map_frac_to_metres(float(bk.get("x", 0)), float(bk.get("y", 0)), mid)
            if not coords:
                continue
            entry = {k: v for k, v in cur.items() if k not in ("origin", "map_id")}
            entry["x_m"], entry["y_m"] = round(coords[0], 3), round(coords[1], 3)
            entry["floor_id"] = fl
            set_beacons[key] = entry
            count += 1

    if set_scanners or set_beacons:
        await fab.async_spatial_update(
            set_scanners=set_scanners or None,
            set_beacons=set_beacons or None,
            op="migration:photo_divorce",
        )
    return count


async def _convert_lights(mdl: Any, fab: Any, maps_list: list[dict]) -> int:
    """Move per-photo light placements into the fabric, in metres.

    A light's x/y used the same fraction convention as room bounds, so the
    map's own transform converts it. A light already placed in metres wins.
    """
    existing = fab.light_positions_m()
    set_lights: dict[str, dict] = {}
    for m in maps_list:
        mid = m.get("id", "")
        if not mdl.map_transform(mid):
            continue
        fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
        for lt in (m.get("lights") or []):
            eid = str(lt.get("entity_id") or "")
            if not eid or eid in existing or eid in set_lights:
                continue
            coords = mdl.map_frac_to_metres(float(lt.get("x") or 0.0), float(lt.get("y") or 0.0), mid)
            if not coords:
                continue
            entry = {"x_m": round(coords[0], 3), "y_m": round(coords[1], 3), "floor_id": fl}
            for src, dst in (("color", "color"), ("shape", "shape"), ("label", "label")):
                if lt.get(src):
                    entry[dst] = lt[src]
            for k in ("rotation", "width_cm", "height_cm"):
                if lt.get(k):
                    entry[k] = float(lt[k])
            set_lights[eid] = entry
    if set_lights:
        await fab.async_spatial_update(set_lights=set_lights, op="migration:lights_to_metres")
    return len(set_lights)
