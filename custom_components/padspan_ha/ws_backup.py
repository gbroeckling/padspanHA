# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for store backup and restore.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import asyncio
from pathlib import Path
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from .const import (
    DOMAIN,
    DATA_FABRIC,
    BACKUPS_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
)
from .build_info import BUILD_VERSION
from .ws_common import _DATA_KEY_MAP, _MAX_BACKUPS

_LOGGER = logging.getLogger(__name__)


async def _load_backups(hass: HomeAssistant) -> dict[str, Any]:
    """Load the backup index from HA persistent storage."""
    from homeassistant.helpers.storage import Store as _St
    st = _St(hass, 1, BACKUPS_STORE_KEY)
    loaded = await st.async_load()
    return loaded if isinstance(loaded, dict) else {"backups": []}


async def _save_backups(hass: HomeAssistant, data: dict[str, Any]) -> None:
    """Write the backup index (including all snapshot data) to disk."""
    from homeassistant.helpers.storage import Store as _St
    st = _St(hass, 1, BACKUPS_STORE_KEY)
    await st.async_save(data)


async def _auto_backup(hass: HomeAssistant, note: str, store_keys: list[str]) -> str | None:
    """Snapshot the named stores into the normal backup list before a
    destructive operation, and return the backup id.

    Deliberately narrower than ws_store_backup_create: it skips the base64
    map images, so a safety net taken automatically before an operation can
    never itself be the expensive part. It lands in the same list the
    Backup/Restore UI shows, so recovery is the flow the user already knows.
    Failure here is reported to the caller — a safety net that silently did
    not happen is worse than none, because the user will believe it exists.
    """
    import os as _os  # noqa: PLC0415
    from homeassistant.helpers.storage import Store as _St  # noqa: PLC0415

    stores_data: dict[str, Any] = {}
    for store_key in store_keys:
        data_key = _DATA_KEY_MAP.get(store_key)
        store_obj = hass.data.get(DOMAIN, {}).get(data_key) if data_key else None
        try:
            if store_obj is not None and hasattr(store_obj, "data"):
                stores_data[store_key] = store_obj.data
            else:
                stores_data[store_key] = await _St(hass, 1, store_key).async_load() or {}
        except Exception:
            return None
    backup_id = f"bk_{_os.urandom(6).hex()}"
    try:
        bk = await _load_backups(hass)
        bk.setdefault("backups", []).append({
            "id": backup_id,
            "created_at": dt_util.utcnow().replace(microsecond=0).isoformat(),
            "version": BUILD_VERSION,
            "note": note[:200],
            "stores": stores_data,
            "map_images": {},
        })
        while len(bk["backups"]) > _MAX_BACKUPS:
            bk["backups"].pop(0)
        await _save_backups(hass, bk)
    except Exception:
        return None
    return backup_id


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_create",
    vol.Optional("note"): str,
})
@websocket_api.async_response
async def ws_store_backup_create(hass: HomeAssistant, connection, msg) -> None:
    """Create a full backup snapshot of all PadSpan persistent stores + map images.

    Each store is read from the in-memory object first (for consistency with
    current session state).  If the in-memory object isn't available (e.g. store
    not yet loaded), falls back to reading directly from HA's on-disk storage.

    Map images (PNG/JPG/WEBP) are base64-encoded and included so the backup is
    fully self-contained — restoring on a fresh HA instance recovers everything.
    """
    import os
    from datetime import datetime, timezone as _tz

    domain = hass.data.get(DOMAIN, {})
    stores_data: dict[str, Any] = {}

    # Snapshot each store, probing for the correct data attribute
    for store_key, data_key in _DATA_KEY_MAP.items():
        store_obj = domain.get(data_key)
        if not store_obj:
            # Store not loaded in memory — read from HA's JSON storage files
            try:
                from homeassistant.helpers.storage import Store as _St
                _st = _St(hass, 1, store_key)
                _loaded = await _st.async_load()
                stores_data[store_key] = _loaded if _loaded is not None else {}
            except Exception:
                stores_data[store_key] = {}
            continue
        # Each store class uses different attribute names for its data
        if hasattr(store_obj, "data"):
            stores_data[store_key] = store_obj.data
        elif hasattr(store_obj, "_data"):
            stores_data[store_key] = store_obj._data
        elif hasattr(store_obj, "entries"):
            stores_data[store_key] = store_obj.entries
        elif hasattr(store_obj, "frames"):
            stores_data[store_key] = store_obj.frames
        else:
            # Last resort: read from disk
            try:
                from homeassistant.helpers.storage import Store as _St
                _st = _St(hass, 1, store_key)
                _loaded = await _st.async_load()
                stores_data[store_key] = _loaded if _loaded is not None else {}
            except Exception:
                stores_data[store_key] = {}

    # ── Collect map image files ──────────────────────────────────────────────
    # WHY: Maps metadata (receiver positions, room bounds) is useless without
    # the underlying floor plan image.  Including images makes backups portable.
    import base64 as _b64
    map_images: dict[str, str] = {}  # filename -> base64-encoded image data
    try:
        from .const import MAPS_DIR
        maps_dir = Path(hass.config.path("www")) / MAPS_DIR
        if maps_dir.is_dir():
            for fp in maps_dir.iterdir():
                if fp.is_file() and fp.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                    try:
                        raw = await asyncio.get_event_loop().run_in_executor(None, fp.read_bytes)
                        map_images[fp.name] = _b64.b64encode(raw).decode("ascii")
                    except Exception:
                        pass
    except Exception:
        pass

    backup_id = f"bk_{os.urandom(6).hex()}"
    backup = {
        "id": backup_id,
        "created_at": datetime.now(_tz.utc).replace(microsecond=0).isoformat(),
        "version": BUILD_VERSION,
        "note": str(msg.get("note") or "")[:200],
        "stores": stores_data,
        "map_images": map_images,
    }

    bk_data = await _load_backups(hass)
    bk_data.setdefault("backups", []).append(backup)
    # Trim to max
    while len(bk_data["backups"]) > _MAX_BACKUPS:
        bk_data["backups"].pop(0)
    await _save_backups(hass, bk_data)

    connection.send_result(msg["id"], {
        "backup_id": backup_id,
        "created_at": backup["created_at"],
        "store_count": len(stores_data),
    })


@websocket_api.websocket_command({"type": "padspan_ha/store_backup_list"})
@websocket_api.async_response
async def ws_store_backup_list(hass: HomeAssistant, connection, msg) -> None:
    """List all available backups."""
    bk_data = await _load_backups(hass)
    items = []
    for bk in bk_data.get("backups", []):
        items.append({
            "id": bk.get("id", ""),
            "created_at": bk.get("created_at", ""),
            "version": bk.get("version", ""),
            "note": bk.get("note", ""),
            "store_count": len(bk.get("stores", {})),
            "store_keys": list(bk.get("stores", {}).keys()),
            "map_image_count": len(bk.get("map_images", {})),
        })
    connection.send_result(msg["id"], {"backups": items})


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_restore",
    vol.Required("backup_id"): str,
    vol.Optional("store_keys"): [str],
    vol.Optional("restore_map_images"): bool,
})
@websocket_api.async_response
async def ws_store_backup_restore(hass: HomeAssistant, connection, msg) -> None:
    """Restore selected stores from a backup snapshot.

    Selective restore: if store_keys is provided, ONLY those stores are written
    back — e.g. the user can restore just calibration without touching settings.
    If store_keys is None/omitted, all stores in the backup are restored.

    For each restored store:
      1. Write to HA's on-disk JSON storage (survives restarts)
      2. Hot-patch the in-memory store object so the UI reflects changes immediately

    Map images are restored to www/padspan_ha/maps/ with path traversal protection.
    """
    from homeassistant.helpers.storage import Store as _St

    backup_id = msg["backup_id"]
    bk_data = await _load_backups(hass)
    backup = None
    for bk in bk_data.get("backups", []):
        if bk.get("id") == backup_id:
            backup = bk
            break
    if not backup:
        connection.send_error(msg["id"], "not_found", f"Backup {backup_id} not found")
        return

    stores_data = backup.get("stores", {})
    selected_keys = msg.get("store_keys")  # None = restore all
    restored = 0

    # ── Pre-fabric backups (issue: hybrid restore) ───────────────────────
    # A backup taken before the fabric store existed has no fabric entry, so
    # the loop below rolls padspan_ha.model back while leaving the CURRENT
    # fabric standing — and geometry is read from the fabric only. The user
    # restores "my backup from before all this" and the restored rooms are
    # silently inert. The backup has always recorded the version it came
    # from; this reads it. Dropping the fabric makes the next boot re-import
    # it from the restored legacy geometry, which is exactly the state that
    # backup represents.
    _bk_ver = str(backup.get("version") or "")
    _restoring_all = selected_keys is None or FABRIC_STORE_KEY in (selected_keys or [])
    _pre_fabric = (
        FABRIC_STORE_KEY not in stores_data
        and MODEL_STORE_KEY in stores_data
        and _restoring_all
    )
    if _pre_fabric:
        try:
            await _St(hass, 1, FABRIC_STORE_KEY).async_remove()
            _fab_obj = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
            if _fab_obj is not None:
                _fab_obj.data = {"floors": {}, "history": []}
            _LOGGER.warning(
                "Restoring a pre-fabric backup (from %s): the room fabric was cleared so it "
                "will be rebuilt from the restored geometry on the next restart.",
                _bk_ver or "an older version",
            )
        except Exception as _pf_err:
            _LOGGER.error("Could not clear the fabric for a pre-fabric restore: %s", _pf_err)
            connection.send_error(
                msg["id"], "restore_unsafe",
                "This backup predates the room-fabric storage and the current fabric could "
                "not be cleared, so restoring it would leave the map in a mixed state. "
                "Nothing was changed.")
            return
    for store_key, data in stores_data.items():
        if data is None:
            continue
        if selected_keys is not None and store_key not in selected_keys:
            continue
        try:
            st = _St(hass, 1, store_key)
            await st.async_save(data)
            restored += 1
            # Reload in-memory store object
            data_key = _DATA_KEY_MAP.get(store_key)
            if data_key:
                store_obj = hass.data.get(DOMAIN, {}).get(data_key)
                if store_obj:
                    if hasattr(store_obj, "data") and isinstance(data, dict):
                        store_obj.data = data
                    elif hasattr(store_obj, "_data") and isinstance(data, dict):
                        store_obj._data = data
                    elif hasattr(store_obj, "entries") and isinstance(data, list):
                        store_obj.entries = data
                    elif hasattr(store_obj, "frames") and isinstance(data, list):
                        store_obj.frames = data
        except Exception as e:
            _LOGGER.warning("Failed to restore %s: %s", store_key, e)

    # ── Restore map images to disk ────────────────────────────────────────────
    images_restored = 0
    if msg.get("restore_map_images") and backup.get("map_images"):
        import base64 as _b64
        try:
            from .const import MAPS_DIR
            maps_dir = Path(hass.config.path("www")) / MAPS_DIR
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: maps_dir.mkdir(parents=True, exist_ok=True)
            )
            for fname, b64data in backup["map_images"].items():
                # Sanitize filename
                safe = Path(fname).name
                if not safe or "/" in safe or "\\" in safe:
                    continue
                fp = (maps_dir / safe).resolve()
                if not str(fp).startswith(str(maps_dir.resolve())):
                    continue
                try:
                    raw = _b64.b64decode(b64data)
                    await asyncio.get_event_loop().run_in_executor(None, fp.write_bytes, raw)
                    images_restored += 1
                except Exception:
                    pass
        except Exception as e:
            _LOGGER.warning("Failed to restore map images: %s", e)

    connection.send_result(msg["id"], {
        "restored": restored,
        "total": len(stores_data),
        "images_restored": images_restored,
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_delete",
    vol.Required("backup_id"): str,
})
@websocket_api.async_response
async def ws_store_backup_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a specific backup."""
    backup_id = msg["backup_id"]
    bk_data = await _load_backups(hass)
    before = len(bk_data.get("backups", []))
    bk_data["backups"] = [b for b in bk_data.get("backups", []) if b.get("id") != backup_id]
    deleted = before - len(bk_data["backups"])
    if deleted > 0:
        await _save_backups(hass, bk_data)
    connection.send_result(msg["id"], {"deleted": deleted > 0})
