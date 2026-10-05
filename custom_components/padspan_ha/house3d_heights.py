# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard's heights move into the placement record.

Garry, 2026-10-05: "Device placement on atlas is good until we get to sims,
needs same information store ... Same dataset, just extra info to sims view
use." A placed device's height above its floor (z_m) now lives on its one
placement record in the fabric (light_positions_m[eid].z_m, set with
fabric_light_height_set or with the placement itself), not in Live Aboard's
own file. Before, the 3D editor kept it in padspan_ha.house3d (lights[eid].z_m
and devices[eid].z_m).

This moves each height Live Aboard's file still holds for a device that has
a placement record:
  1. the record first: the file's height is copied into a record that has
     none (one fabric write, through the fabric's own spatial update, read
     back from disk before anything else happens). A record that already has
     a height keeps it: the record wins;
  2. then the file: that z_m is taken out of the file's entry (its kind, run
     and look stay; an entry left empty goes), in one read-back-verified
     write under the file's lock (House3dStore.lock, which every Save holds).
A device with no placement record keeps its height in the file (there is no
record to hold it), and Live Aboard reads it there as before. Scanners are
not touched: their height has always been on their own record.

Safe to stop anywhere: a restart between 1 and 2 leaves the record holding
the height and the file still holding it too; the next run copies nothing
(the record has one) and finishes step 2. A run with nothing left to move
writes nothing at all, so it runs at every start (and when Live Aboard is
turned on) and is a no-op after the first.

Only while Live Aboard is on at Pro, like the rest of it: off (or below Pro,
as if off), nothing is read and nothing is written; Live Aboard reads a
height still in the file as a fallback whenever it is turned on again. A file
that cannot be read, or a newer PadSpan's, is left alone.
"""

from __future__ import annotations

import copy
import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_FABRIC, DATA_MODEL, DOMAIN
from .fabric_store import device_height
from .house3d_store import ReadFailed, async_file_exists, async_get_store, enabled, writable

_LOGGER = logging.getLogger(__name__)

SECTIONS: tuple[str, ...] = ("lights", "devices")


def _height(v: Any) -> float | None:
    """A height the 3D file held (house3d_store kept it 0 to 10 m)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        return None
    return device_height(v)


def plan(house: dict, records: dict) -> tuple[dict[str, float], list[tuple[str, str]]]:
    """What a move does to `house` (Live Aboard's file) and `records`
    (light_positions_m): ({entity_id: z_m to copy into its record},
    [(section, entity_id) whose z_m leaves the file]). Only devices with a
    placement record; a record that has a height keeps it."""
    copy_in: dict[str, float] = {}
    strip: list[tuple[str, str]] = []
    for section in SECTIONS:
        entries = house.get(section)
        if not isinstance(entries, dict):
            continue
        for eid, e in entries.items():
            if not isinstance(e, dict) or "z_m" not in e:
                continue
            rec = records.get(eid)
            if not isinstance(rec, dict):
                continue                       # unplaced: the file keeps its height
            z = _height(e.get("z_m"))
            if z is None:
                continue                       # not a height: left as it is
            if device_height(rec.get("z_m")) is None and eid not in copy_in:
                copy_in[eid] = z
            strip.append((section, eid))
    return copy_in, strip


def stripped(house: dict, strip: list[tuple[str, str]]) -> dict:
    """The file with those heights taken out; an entry left empty goes."""
    out = copy.deepcopy(house)
    for section, eid in strip:
        e = out[section].get(eid)
        if not isinstance(e, dict):
            continue
        e.pop("z_m", None)
        if not e:
            del out[section][eid]
    return out


async def async_move_heights(hass: HomeAssistant) -> dict[str, int]:
    """Move the 3D file's heights into the placement records (see above).
    Returns {"copied": n, "removed": m}: what went into records, and how
    many heights left the file (both 0 when there was nothing to do)."""
    done = {"copied": 0, "removed": 0}
    from .ws_common import _tier_at_least  # noqa: PLC0415
    if not enabled(hass) or not _tier_at_least(hass, "pro"):
        return done
    if not await async_file_exists(hass):
        return done                            # never written: no heights in it
    dom = hass.data.get(DOMAIN, {})
    mdl = dom.get(DATA_MODEL)
    fab = getattr(mdl, "fabric", None) or dom.get(DATA_FABRIC)
    if fab is None:
        return done
    try:
        store = await async_get_store(hass)
    except ReadFailed:
        _LOGGER.warning("Live Aboard heights: Live Aboard's file could not be read; its heights stay "
                        "where they are and are moved on a later start")
        return done
    async with store.lock:
        if not writable(store.data):
            return done
        copy_in, strip = plan(store.data, fab.light_positions_m())
        if not strip:
            return done
        if copy_in:
            records = fab.light_positions_m()
            await fab.async_spatial_update(
                set_lights={eid: {**records[eid], "z_m": z} for eid, z in copy_in.items()},
                op="migration:house3d_heights")
            # Read back: only once the records hold the heights on disk may the
            # file let them go. Otherwise the file keeps them (Live Aboard still
            # reads them there) and a later start tries again.
            try:
                back = await fab.store.async_load()
            except Exception:  # noqa: BLE001 — said below
                back = None
            on_disk = (back or {}).get("light_positions_m") if isinstance(back, dict) else None
            if not isinstance(on_disk, dict) or any(
                    device_height((on_disk.get(eid) or {}).get("z_m")) != z for eid, z in copy_in.items()):
                _LOGGER.error("Live Aboard heights: the placement records could not be saved; the heights "
                              "stay in Live Aboard's file and are moved on a later start")
                return done
            done["copied"] = len(copy_in)
        if not await store.async_write(stripped(store.data, strip)):
            _LOGGER.error("Live Aboard heights: %d heights are in the placement records, but Live Aboard's "
                          "file could not be written; they are taken out of it on a later start", len(copy_in))
            return done
        done["removed"] = len(strip)
    _LOGGER.info("Live Aboard heights: %d moved into the placement records, %d taken out of Live Aboard's file "
                 "(a device's height is now on its placement record)", done["copied"], done["removed"])
    return done
