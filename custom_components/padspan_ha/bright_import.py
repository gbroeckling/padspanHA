# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""PadSpan Bright → PadSpan HA: the house someone built in Bright, once.

PadSpan Bright is the same integration under another domain, so its storage
files are the same schema under another prefix: `.storage/padspan_bright.X`
next to this install's `.storage/padspan_ha.X`. Someone who mapped their
whole house in Bright and then installed PadSpan HA would otherwise start
again. This carries the house across.

What moves is what a PERSON built — the four "house" stores:

    fabric     floors, rooms, walls, placed lights (metres)
    model      floor names/levels, room meta, map transforms
    maps       the floor-plan records — plus their images under www/
    settings   light shapes, hidden lights, view sliders, the licence key

Everything else PadSpan keeps (objects, calibration, movement, adaptive,
traceback, forensics, captures, devices…) is presence machinery that
regenerates on its own; a Bright install ran that engine in the background
and its files are noise, not work. They are not touched.

The rules, in the order they run:

    1. Nothing to import → say so. A Bright build imports nothing (it IS
       the source).
    2. BACK UP FIRST — an automatic snapshot of the four target stores into
       the ordinary Backup/Restore list, the recovery flow the user already
       knows. If that snapshot cannot be taken, nothing proceeds.
    3. REFUSE A NON-EMPTY TARGET. If this install already holds a floor, a
       room, a placed light, a wall, a map, or a map transform, the import
       does not run and says exactly what it found. It never merges: two
       houses cannot be reconciled by a script, and an import that
       overwrites eats a weekend of someone's work.
    4. Copy each store — file to file, through HA's own Store — then the map
       images, then stamp `bright_import_done` into settings so the offer
       becomes a receipt.
    5. Reload the config entry so every in-memory store re-reads its file.
       (Patching four live store objects by hand would re-implement four
       setup paths; the reload runs the real ones.)

The Bright files are read, never removed: uninstalling PadSpan Bright is the
user's step, taken when they can see the house standing in PadSpan HA.

Settings carry across wholesale — they are the user's choices — with one
exception: a licence key already entered into THIS install stays if the
Bright settings bring none. A key typed into the product being moved to is
the newer intent.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    DATA_FABRIC,
    DATA_MAPS,
    DATA_MODEL,
    DATA_SETTINGS,
    DOMAIN,
    FABRIC_STORE_KEY,
    MAPS_DIR,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    SETTINGS_STORE_KEY,
)

_LOGGER = logging.getLogger(__name__)

# The source domain — a constant of the PRODUCT, not derived from anything.
# In a generated Bright build this equals DOMAIN and the importer is inert.
BRIGHT_DOMAIN = "padspan_bright"

# The house stores, source suffix → this install's full store key.
HOUSE_STORES: tuple[tuple[str, str], ...] = (
    ("fabric", FABRIC_STORE_KEY),
    ("model", MODEL_STORE_KEY),
    ("maps", MAPS_STORE_KEY),
    ("settings", SETTINGS_STORE_KEY),
)
_LICENCE_KEYS = ("forensics_license_key", "forensics_license_expires", "license_tier")
DONE_KEY = "bright_import_done"


def _storage_dir(hass: HomeAssistant) -> Path:
    return Path(hass.config.path(".storage"))


def bright_files(hass: HomeAssistant) -> dict[str, Path]:
    """The Bright house files that exist on this HA, by suffix."""
    if BRIGHT_DOMAIN == DOMAIN:
        return {}
    d = _storage_dir(hass)
    out: dict[str, Path] = {}
    for suffix, _ in HOUSE_STORES:
        p = d / f"{BRIGHT_DOMAIN}.{suffix}"
        if p.is_file():
            out[suffix] = p
    return out


def _read_store_file(path: Path) -> Any:
    """The `data` of an HA storage file, or None if it is not one."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return raw.get("data") if isinstance(raw, dict) else None


def target_contents(fabric: dict | None, model: dict | None, maps: dict | None) -> list[str]:
    """What this install already holds that an import would collide with —
    empty means the target is empty. Human strings, because the answer is
    shown to the person who has to decide what to do about it."""
    found: list[str] = []
    fab = fabric or {}
    floors = fab.get("floors") if isinstance(fab.get("floors"), dict) else {}
    rooms = sum(len(f.get("rooms") or {}) for f in floors.values() if isinstance(f, dict))
    if floors:
        found.append(f"{len(floors)} floor{'s' if len(floors) != 1 else ''}")
    if rooms:
        found.append(f"{rooms} room{'s' if rooms != 1 else ''}")
    lights = fab.get("light_positions_m") if isinstance(fab.get("light_positions_m"), dict) else {}
    if lights:
        found.append(f"{len(lights)} placed light{'s' if len(lights) != 1 else ''}")
    walls = fab.get("rf_barriers_m") if isinstance(fab.get("rf_barriers_m"), list) else []
    if walls:
        found.append(f"{len(walls)} wall{'s' if len(walls) != 1 else ''}")
    mdl = model or {}
    geo = mdl.get("room_geometry_m") if isinstance(mdl.get("room_geometry_m"), dict) else {}
    if geo and not rooms:
        found.append(f"{len(geo)} room shape{'s' if len(geo) != 1 else ''} (model)")
    tx = mdl.get("map_transforms") if isinstance(mdl.get("map_transforms"), dict) else {}
    if tx:
        found.append(f"{len(tx)} map transform{'s' if len(tx) != 1 else ''}")
    mp = (maps or {}).get("maps") if isinstance((maps or {}).get("maps"), list) else []
    if mp:
        found.append(f"{len(mp)} map{'s' if len(mp) != 1 else ''}")
    return found


def _live(hass: HomeAssistant, data_key: str) -> dict | None:
    obj = hass.data.get(DOMAIN, {}).get(data_key)
    d = getattr(obj, "data", None)
    return d if isinstance(d, dict) else None


async def async_status(hass: HomeAssistant) -> dict[str, Any]:
    """What the Health tab shows: is there a Bright house here, has it been
    imported already, and would the target refuse it."""
    files = await asyncio.to_thread(bright_files, hass)
    settings = _live(hass, DATA_SETTINGS) or {}
    out: dict[str, Any] = {
        "available": bool(files),
        "files": sorted(files.keys()),
        "done_at": settings.get(DONE_KEY) or None,
        "target_has": target_contents(_live(hass, DATA_FABRIC), _live(hass, DATA_MODEL), _live(hass, DATA_MAPS)),
        "source": {},
    }
    if files:
        src_fab = await asyncio.to_thread(_read_store_file, files["fabric"]) if "fabric" in files else None
        src_mdl = await asyncio.to_thread(_read_store_file, files["model"]) if "model" in files else None
        src_maps = await asyncio.to_thread(_read_store_file, files["maps"]) if "maps" in files else None
        out["source"] = {"has": target_contents(src_fab, src_mdl, src_maps)}
    return out


async def async_import(hass: HomeAssistant, backup: Any) -> dict[str, Any]:
    """Run the import. `backup(hass, note, store_keys) -> backup_id | None` is
    the ordinary auto-backup (ws_backup._auto_backup), injected so this
    module stays importable without the websocket layer.

    Returns {"ok": True, ...} or {"ok": False, "error": code, "message": ...}.
    Never raises for the expected refusals.
    """
    files = await asyncio.to_thread(bright_files, hass)
    if not files:
        return {"ok": False, "error": "nothing_to_import",
                "message": "No PadSpan Bright data found on this Home Assistant."}

    # 2. Back up first. No snapshot, no import.
    backup_id = await backup(hass, "Before PadSpan Bright import",
                             [key for _, key in HOUSE_STORES])
    if not backup_id:
        return {"ok": False, "error": "backup_failed",
                "message": "Could not take the safety backup — nothing was changed."}

    # 3. Refuse a non-empty target. From the LIVE stores — the truth this
    #    install is running on, not a file that may lag it.
    has = target_contents(_live(hass, DATA_FABRIC), _live(hass, DATA_MODEL), _live(hass, DATA_MAPS))
    if has:
        return {"ok": False, "error": "target_not_empty", "target_has": has,
                "message": "This install already holds " + ", ".join(has)
                           + ". Import only runs into an empty house — it never merges."}

    # 4. Store by store, file → HA Store (its own atomic write, its own format).
    imported: list[str] = []
    live_settings = _live(hass, DATA_SETTINGS) or {}
    for suffix, target_key in HOUSE_STORES:
        src = files.get(suffix)
        if src is None:
            continue
        data = await asyncio.to_thread(_read_store_file, src)
        if not isinstance(data, (dict, list)):
            _LOGGER.warning("Bright import: %s is not a storage file — skipped", src.name)
            continue
        if suffix == "settings" and isinstance(data, dict):
            data = dict(data)
            if not str(data.get("forensics_license_key") or "").strip():
                for k in _LICENCE_KEYS:
                    if live_settings.get(k):
                        data[k] = live_settings[k]
            data[DONE_KEY] = dt_util.utcnow().replace(microsecond=0).isoformat()
        await Store(hass, 1, target_key).async_save(data)
        imported.append(suffix)

    # The map images live beside the records, under www/<domain>/maps.
    images = 0
    src_dir = Path(hass.config.path("www")) / BRIGHT_DOMAIN / "maps"
    dst_dir = Path(hass.config.path("www")) / MAPS_DIR

    def _copy_images() -> int:
        n = 0
        if not src_dir.is_dir():
            return 0
        dst_dir.mkdir(parents=True, exist_ok=True)
        for f in src_dir.iterdir():
            if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                shutil.copy2(f, dst_dir / f.name)
                n += 1
        return n
    images = await asyncio.to_thread(_copy_images)

    _LOGGER.info("PadSpan Bright import: stores %s, %d map image(s), backup %s — reloading",
                 ", ".join(imported), images, backup_id)

    # 5. Reload so every store re-reads its file through its own setup path.
    async def _reload() -> None:
        for entry in hass.config_entries.async_entries(DOMAIN):
            await hass.config_entries.async_reload(entry.entry_id)
    hass.async_create_task(_reload())

    return {"ok": True, "imported": imported, "images": images,
            "backup_id": backup_id, "reloading": True}
