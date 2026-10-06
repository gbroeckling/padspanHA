# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard's heights onto the placement records.

Garry, 2026-10-05: "Device placement on atlas is good until we get to sims,
needs same information store ... Same dataset, just extra info to sims view
use." A placed device's height above its floor now belongs to its placement
record (the fabric keeps it beside the record, fabric_store "light_heights_m";
the model hands it over in the record as z_m). Before, the 3D editor kept it
in Live Aboard's own file (lights[eid].z_m, devices[eid].z_m).

This copies each height Live Aboard's file holds for a placed device whose
record has none decided (no height, and Default never chosen) onto that
record: one fabric write, read back from disk. The first time, a safety
backup of the fabric comes first (as the photo-divorce migration does); no
backup, no copy. That it was taken is kept in the fabric itself
(BACKUP_MARK), not in its history, which keeps only the last 200 changes.
What to copy is decided with nothing awaited before the write, so a height
set or Default chosen while the backup was written is never overwritten.
A record with a height, or with Default chosen, keeps it:
the record wins. A device with no placement record keeps its height in the
file only, and Live Aboard reads it there.

Live Aboard's file is never stripped. An older PadSpan (0.38.104 and before),
should someone roll back to one, reads heights only from that file, so it
keeps the heights it had; this version reads the record first and never
writes a placed device's height into the file. Copying is the only write, so
a restart anywhere leaves either no copy or the whole copy, and the next run
copies whatever is left (a fabric-only restore of an older backup gets its
heights back that way too). A run with nothing to copy writes nothing.

Only while Live Aboard is on at Pro, like the rest of it: off (or below Pro,
as if off), nothing is read and nothing is written; Live Aboard reads a
height still only in the file whenever it is turned on again. A file that
cannot be read, or a newer PadSpan's, is left alone.
"""

from __future__ import annotations

import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_FABRIC, DATA_MODEL, DOMAIN, FABRIC_STORE_KEY
from .fabric_store import device_height
from .house3d_store import ReadFailed, async_file_exists, async_get_store, enabled, writable

_LOGGER = logging.getLogger(__name__)

SECTIONS: tuple[str, ...] = ("lights", "devices")
BACKUP_NOTE = "Before Live Aboard's heights moved onto the placement records"
MOVE_OP = "migration:house3d_heights"         # the fabric's history entry for a copy
BACKUP_MARK = "live_aboard_heights_backup"    # the fabric's key: the first copy's safety backup id


def _height(v: Any) -> float | None:
    """A height the 3D file held (house3d_store kept it 0 to 10 m)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        return None
    return device_height(v)


def plan(house: dict, records: dict, heights: dict) -> dict[str, float]:
    """{entity_id: z_m} to copy from `house` (Live Aboard's file) onto the
    placement `records` (light_positions_m): placed devices only, and only
    where `heights` (light_heights_m) has nothing decided for them."""
    copy_in: dict[str, float] = {}
    for section in SECTIONS:
        entries = house.get(section)
        if not isinstance(entries, dict):
            continue
        for eid, e in entries.items():
            if not isinstance(e, dict) or eid in copy_in or eid in heights:
                continue
            if not isinstance(records.get(eid), dict):
                continue                       # unplaced: the file keeps its height
            z = _height(e.get("z_m"))
            if z is not None:
                copy_in[eid] = z
    return copy_in


async def async_move_heights(hass: HomeAssistant) -> dict[str, int]:
    """Copy the 3D file's heights onto the placement records (see above).
    Returns {"copied": n}: 0 when there was nothing to do or it could not."""
    done = {"copied": 0}
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
        _LOGGER.warning("Live Aboard heights: Live Aboard's file could not be read; its heights are "
                        "copied onto the placement records on a later start")
        return done
    if not writable(store.data):
        return done                            # a newer PadSpan's file: its shape is not this version's
    copy_in = plan(store.data, fab.light_positions_m(), fab.light_heights_m())
    if not copy_in:
        return done
    if not fab.data.get(BACKUP_MARK):
        # The first copy: the fabric as it was, in a safety backup first.
        from .ws_backup import _auto_backup  # noqa: PLC0415
        backup_id = await _auto_backup(hass, BACKUP_NOTE, [FABRIC_STORE_KEY])
        if not backup_id:
            _LOGGER.error("Live Aboard heights: the safety backup could not be taken, so nothing was copied; "
                          "a later start tries again")
            return done
        fab.data[BACKUP_MARK] = backup_id          # saved with the copy (or the fabric's next write)
        # The backup awaited the disk: decide again against the records as
        # they are now (a height set or Default chosen meanwhile stays).
        copy_in = plan(store.data, fab.light_positions_m(), fab.light_heights_m())
        if not copy_in:
            return done
    await fab.async_spatial_update(set_light_heights=copy_in, op=MOVE_OP)
    # Read back: counted only once the records hold them on disk. Otherwise a
    # later start copies them again (Live Aboard still reads them from its file).
    try:
        back = await fab.store.async_load()
    except Exception:  # noqa: BLE001 — said below
        back = None
    on_disk = (back or {}).get("light_heights_m") if isinstance(back, dict) else None
    if not isinstance(on_disk, dict) or any(on_disk.get(eid) != z for eid, z in copy_in.items()):
        _LOGGER.error("Live Aboard heights: the placement records could not be saved; a later start tries again")
        return done
    done["copied"] = len(copy_in)
    _LOGGER.info("Live Aboard heights: %d copied onto their placement records (Live Aboard's own file keeps "
                 "its copy for an older PadSpan)", done["copied"])
    return done
