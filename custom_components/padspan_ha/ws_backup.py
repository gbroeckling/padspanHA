# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for store backup and restore.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import contextlib
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
    DATA_SETTINGS,
    DATA_FABRIC,
    DATA_HOUSE3D,
    DATA_MAPS,
    DATA_MODEL,
    BACKUPS_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
    HOUSE3D_STORE_KEY,
    DATA_TRACEBACK,
    TRACEBACK_STORE_KEY,
    DATA_WLED_LOOKS,
    WLED_LOOKS_STORE_KEY,
    DATA_LOST_AND_FOUND,
    LOST_AND_FOUND_STORE_KEY,
)
from .build_info import BUILD_VERSION
from .ws_common import (
    ABSENT_MARKER, _BACKUP_ONLY_ONCE_WRITTEN, _DATA_KEY_MAP, _MAX_AUTO_BACKUPS, _MAX_BACKUPS, _is_absent_marker,
    _store_file_written,
)
from .telemetry import bump as _bump

_LOGGER = logging.getLogger(__name__)


def _licence_rank(d: dict[str, Any]) -> tuple[int, float]:
    """(has a working key, its expiry) - higher is better. A working key is
    one with no expiry or one not past the grace period (ws_common's rule);
    no expiry ranks above any date."""
    from datetime import datetime, timedelta, timezone  # noqa: PLC0415
    from .ws_common import PRO_GRACE_DAYS  # noqa: PLC0415
    if not str(d.get("forensics_license_key") or "").strip():
        return (0, 0.0)
    raw = str(d.get("forensics_license_expires") or "").strip()
    if not raw:
        return (2, float("inf"))
    try:
        exp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
    except ValueError:
        return (2, float("inf"))      # an unreadable date never locks anyone out
    working = exp - datetime.now(timezone.utc) > -timedelta(days=PRO_GRACE_DAYS)
    return (2 if working else 1, exp.timestamp())


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


def _backups_lock(hass: HomeAssistant) -> asyncio.Lock:
    """The lock every load-change-save of the backup list holds.

    Each writer uses its own Store object, and HA's write lock belongs to
    the object, so two writers that overlap each save the list they loaded
    and the second wipes out the first one's change: a backup that was
    reported as taken, or a deleted one that comes back.
    """
    return hass.data.setdefault(f"{DOMAIN}_backups_lock", asyncio.Lock())


async def _store_lock(hass: HomeAssistant, store_key: str) -> Any:
    """The lock a store's own writes hold, for a restore or a factory reset
    to hold while it writes that store, so a Save never lands under it (read
    before, written after). Live Aboard's store has one (House3dStore.lock:
    the 3D editor's Save, Remove all, the library); it loads on first use,
    so it is loaded here to have its lock. A file that can't be read keeps
    no store, and then nothing else writes it either. The rest: none."""
    if store_key == HOUSE3D_STORE_KEY:
        from .house3d_store import ReadFailed, async_get_store  # noqa: PLC0415
        with contextlib.suppress(ReadFailed):
            await async_get_store(hass)
    lock = getattr(hass.data.get(DOMAIN, {}).get(_DATA_KEY_MAP.get(store_key)), "lock", None)
    return lock if isinstance(lock, asyncio.Lock) else contextlib.nullcontext()


def _trim_backups(backups: list[dict[str, Any]], auto: bool) -> None:
    """Drop the oldest backups of one kind over that kind's cap, in place.

    Automatic backups (marked "auto") and the ones a person made are capped
    separately, so a safety net taken before an operation can never push out
    a backup the user made, and a new manual backup never removes more than
    the oldest manual one. An entry without the mark counts as manual: that
    includes automatic ones from before the mark existed, which is the side
    that keeps them.
    """
    cap = _MAX_AUTO_BACKUPS if auto else _MAX_BACKUPS
    same = [b for b in backups if bool(b.get("auto")) == auto]
    drop = {id(b) for b in same[:max(0, len(same) - cap)]}
    backups[:] = [b for b in backups if id(b) not in drop]


async def _auto_backup(hass: HomeAssistant, note: str, store_keys: list[str], *, mark_absent: bool = False) -> str | None:
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
        if store_key in _BACKUP_ONLY_ONCE_WRITTEN and not await _store_file_written(hass, store_key):
            # Never written: no entry, so a restore never creates or empties
            # it. Before an operation that may create it (mark_absent: the
            # Bright import), "there was none", so restoring takes it away.
            if mark_absent:
                stores_data[store_key] = {ABSENT_MARKER: True}
            continue
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
        async with _backups_lock(hass):
            bk = await _load_backups(hass)
            bk.setdefault("backups", []).append({
                "id": backup_id,
                "created_at": dt_util.utcnow().replace(microsecond=0).isoformat(),
                "version": BUILD_VERSION,
                "note": note[:200],
                "stores": stores_data,
                "map_images": {},
                "auto": True,
            })
            _trim_backups(bk["backups"], auto=True)
            await _save_backups(hass, bk)
            # HA's Store logs a failed write (a full disk, a read-only file)
            # and returns normally, so "saved" is only known by reading it back.
            written = await _load_backups(hass)
    except Exception:
        return None
    if not any(b.get("id") == backup_id for b in written.get("backups") or []):
        _LOGGER.error("The automatic backup (%s) was not written to disk", note)
        return None
    return backup_id


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_create",
    vol.Optional("note"): str,
})
@websocket_api.require_admin
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
    unread: list[str] = []

    # Snapshot each store, probing for the correct data attribute
    for store_key, data_key in _DATA_KEY_MAP.items():
        if store_key in _BACKUP_ONLY_ONCE_WRITTEN and not await _store_file_written(hass, store_key):
            continue   # never written: no entry, so a restore never creates or empties it
        store_obj = domain.get(data_key)
        if not store_obj:
            # Store not loaded in memory — read from HA's JSON storage files
            try:
                from homeassistant.helpers.storage import Store as _St
                _st = _St(hass, 1, store_key)
                _loaded = await _st.async_load()
                stores_data[store_key] = _loaded if _loaded is not None else {}
            except Exception as err:  # noqa: BLE001 — said below
                _LOGGER.error("Backup: could not read %s: %s", store_key, err)
                unread.append(store_key)
            continue
        # Each store class uses different attribute names for its data
        if store_key == TRACEBACK_STORE_KEY and hasattr(store_obj, "async_export"):
            # Traceback: its history is files on disk; a backup carries
            # the last day of it (traceback_store.BACKUP_WINDOW_S).
            stores_data[store_key] = await store_obj.async_export()
        elif hasattr(store_obj, "data"):
            stores_data[store_key] = store_obj.data
        elif hasattr(store_obj, "_data"):
            stores_data[store_key] = store_obj._data
        elif hasattr(store_obj, "entries"):
            stores_data[store_key] = store_obj.entries
        elif hasattr(store_obj, "frames"):
            stores_data[store_key] = store_obj.frames
        elif hasattr(store_obj, "records"):
            stores_data[store_key] = store_obj.records     # Lost & Found
        else:
            # Last resort: read from disk
            try:
                from homeassistant.helpers.storage import Store as _St
                _st = _St(hass, 1, store_key)
                _loaded = await _st.async_load()
                stores_data[store_key] = _loaded if _loaded is not None else {}
            except Exception as err:  # noqa: BLE001 — said below
                _LOGGER.error("Backup: could not read %s: %s", store_key, err)
                unread.append(store_key)
    if unread:
        # Recorded as {}, a store that couldn't be read would be emptied by
        # restoring this backup: none is made.
        connection.send_error(msg["id"], "backup_failed",
                              f"Could not read {', '.join(unread)}, so no backup was made. Nothing was saved.")
        return

    # ── Collect map image files ──────────────────────────────────────────────
    # WHY: Maps metadata (receiver positions, room bounds) is useless without
    # the underlying floor plan image.  Including images makes backups portable.
    import base64 as _b64
    map_images: dict[str, str] = {}  # filename -> base64-encoded image data
    try:
        from .maps_store import maps_dir_for
        maps_dir = maps_dir_for(hass)

        def _image_files() -> list[Path]:
            # is_dir / iterdir / is_file all touch the disk: not on the loop.
            if not maps_dir.is_dir():
                return []
            return [fp for fp in maps_dir.iterdir()
                    if fp.is_file() and fp.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]

        for fp in await asyncio.get_event_loop().run_in_executor(None, _image_files):
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

    async with _backups_lock(hass):
        bk_data = await _load_backups(hass)
        bk_data.setdefault("backups", []).append(backup)
        # Trim to max (backups made by a person; automatic ones have their own cap)
        _trim_backups(bk_data["backups"], auto=False)
        await _save_backups(hass, bk_data)

    _bump(hass, "backup_created")
    connection.send_result(msg["id"], {
        "backup_id": backup_id,
        "created_at": backup["created_at"],
        "store_count": len(stores_data),
    })


@websocket_api.websocket_command({"type": "padspan_ha/store_backup_list"})
@websocket_api.require_admin
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
@websocket_api.require_admin
@websocket_api.async_response
async def ws_store_backup_restore(hass: HomeAssistant, connection, msg) -> None:
    """Restore selected stores from a backup snapshot.

    Selective restore: if store_keys is provided, ONLY those stores are written
    back — e.g. the user can restore just calibration without touching settings.
    If store_keys is None/omitted, all stores in the backup are restored.

    For each restored store:
      1. Write to HA's on-disk JSON storage (survives restarts)
      2. Hot-patch the in-memory store object so the UI reflects changes immediately

    Map images are restored to <config>/padspan_ha/maps/ with path traversal protection.
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
    wled_touched = False

    # ── Maps and Model are ONE fact in two files ─────────────────────────
    #
    # A map's picture and stack live in `padspan_ha.maps`; where that map SITS,
    # in metres, lives in `padspan_ha.model` under `map_transforms[map_id]`,
    # and so does the world gauge that gives its stack a size. They are keyed
    # to each other by map id, so restoring one without the other pairs each
    # map with a placement belonging to a different set of maps:
    #
    #   Maps alone   — every restored map is placed by whatever the CURRENT
    #                  model says about an id it may not contain. Maps that
    #                  sit nowhere, or worse, sit somewhere wrong.
    #   Model alone  — placements and a gauge for maps that are not there,
    #                  and the maps that ARE there re-placed by records that
    #                  were measured on different pictures.
    #
    # Refused rather than warned. The two checkboxes are also coupled in the
    # panel (manage.js) so this is not normally reachable, but the panel is
    # not the only caller of a websocket command and a refusal that lives in
    # the UI is a refusal that does not exist. R3 makes this sharper still:
    # once the stack is DERIVED from the metric record, a Maps-only restore
    # brings back pictures with no placement at all.
    if selected_keys is not None:
        _sel = set(selected_keys)
        _pair = {MAPS_STORE_KEY, MODEL_STORE_KEY} & set(stores_data)
        _missing = _pair - _sel
        if _pair & _sel and _missing:
            connection.send_error(
                msg["id"], "restore_incomplete",
                "Maps and Model have to be restored together: a map's picture and "
                "stack are in Maps, and where that map sits in metres is in Model, "
                "keyed by map id. Restoring one without the other leaves every map "
                "placed by a record that belongs to a different set of maps. "
                f"Add {', '.join(sorted(_missing))} to the selection, or leave both out. "
                "Nothing was changed.")
            return

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
        # Under the store's own lock: a Save started meanwhile goes on top.
        async with await _store_lock(hass, store_key):
            if _is_absent_marker(data):
                # "There was no file" (ws_common.ABSENT_MARKER): only Live Aboard's
                # file knows how to go back to none; never written as data.
                if store_key == HOUSE3D_STORE_KEY:
                    from .house3d_store import async_restore_absent
                    held = hass.data.get(DOMAIN, {}).get(DATA_HOUSE3D)
                    try:
                        await async_restore_absent(hass)
                        restored += 1
                        if held is not None:
                            # A Save waiting on this lock has the store just
                            # dropped: it stays THE store (one store, one lock;
                            # put back before any await, so no request builds a
                            # second) and goes on from the file as it is now.
                            hass.data.setdefault(DOMAIN, {})[DATA_HOUSE3D] = held
                            await held.async_load()
                    except Exception as err:  # noqa: BLE001 — reported, like every store below
                        _LOGGER.error("Restore of %s failed: %s", store_key, err)
                continue
            try:
                if store_key == TRACEBACK_STORE_KEY:
                    # Traceback's history is its daily segment files: written
                    # to the old single file, a restore was gone at restart.
                    tb_obj = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
                    if tb_obj is not None and hasattr(tb_obj, "async_merge"):
                        # Joined by timestamp: replacing it erased every
                        # movement recorded since the backup was taken.
                        await tb_obj.async_merge(data)
                        restored += 1
                        continue
                if store_key == LOST_AND_FOUND_STORE_KEY:
                    # Joined by each record's time, like Traceback: replacing
                    # it sent every object back to its room at backup time
                    # and dropped the record of one lost since.
                    lf_obj = hass.data.get(DOMAIN, {}).get(DATA_LOST_AND_FOUND)
                    if lf_obj is not None and hasattr(lf_obj, "async_merge"):
                        await lf_obj.async_merge(data)
                        restored += 1
                        continue
                if store_key == HOUSE3D_STORE_KEY:
                    # Live Aboard's file: a backup with no furniture in it keeps
                    # the furniture placed since (house3d_store.async_restore_data).
                    from .house3d_store import async_restore_data
                    data = await async_restore_data(hass, data)
                if store_key == WLED_LOOKS_STORE_KEY:
                    # Looks come back; what PadSpan did to each device's
                    # flash (sync switched off, the originals kept) stays.
                    from .wled_exact import restore_keeps_switch_state
                    _wl = hass.data.get(DOMAIN, {}).get(DATA_WLED_LOOKS)
                    data = restore_keeps_switch_state(getattr(_wl, "data", None), data)
                    wled_touched = True
                st = _St(hass, 1, store_key)
                await st.async_save(data)
                restored += 1
                # Reload in-memory store object
                data_key = _DATA_KEY_MAP.get(store_key)
                if data_key:
                    store_obj = hass.data.get(DOMAIN, {}).get(data_key)
                    if store_obj:
                        if data_key == DATA_SETTINGS and isinstance(data, dict) and hasattr(store_obj, "data"):
                            # Vacation Mode's spans describe what is in the recorder
                            # now, not when the backup was taken (vacation_mode.py).
                            import time as _time
                            from .vacation_mode import restore_fields
                            # A tester sign-up is not house configuration: the
                            # live one stays, so an older backup can neither lose
                            # one nobody could then withdraw, nor bring back one
                            # that was withdrawn (tester.carried_over).
                            from .tester import carried_over
                            data = {**data, **restore_fields(store_obj.data or {}, data, _time.time()),
                                    **carried_over(store_obj.data or {})}
                            # The one-time "Atlas on" has already run here: an
                            # older backup must not run it again over a choice
                            # made since (settings_store.py).
                            if (store_obj.data or {}).get("atlas_default_v1_applied"):
                                data["atlas_default_v1_applied"] = True
                            # A Pro invite is this install's now, answered or
                            # not: an older backup must not bring one back.
                            from .pro_invite import SETTINGS_KEY as _INVITE_KEY
                            data[_INVITE_KEY] = (store_obj.data or {}).get(_INVITE_KEY) or {}
                            # The offers' server switches are today's, not the backup's.
                            data["server_offers"] = (store_obj.data or {}).get("server_offers") or {}
                            # Nor bring back the trial milestone card, or restart
                            # its week (settings_store.trial_state_kept).
                            from .settings_store import trial_state_kept
                            data.update(trial_state_kept(store_obj.data or {}, data))
                            # The licence on this install stays when it is the
                            # better one: a backup from before a purchase (or
                            # from a trial) blanked the key or put the old one
                            # back, locking paid editing. But an expired live
                            # key never beats a working one in the backup, and
                            # an install with no key takes the backup's.
                            _live = store_obj.data or {}
                            if _licence_rank(_live) >= _licence_rank(data):
                                for _k in ("forensics_license_key", "forensics_license_expires",
                                           "license_tier", "license_is_trial",
                                           # this home among the key's homes (licence_homes.py):
                                           # a restored token would look like a copy of it
                                           "license_home_token", "license_home_label",
                                           "license_home_status", "license_homes_used"):
                                    if _k in _live:
                                        data[_k] = _live[_k]
                                    else:
                                        data.pop(_k, None)
                            # WLED teams: their mode and the members' kept
                            # sync are the devices' state now (wled_exact).
                            from .wled_exact import restore_keeps_team_state
                            data["wled_teams"] = restore_keeps_team_state(
                                (store_obj.data or {}).get("wled_teams"), data.get("wled_teams"))
                            wled_touched = True
                            await st.async_save(data)
                        if hasattr(store_obj, "data") and isinstance(data, dict):
                            store_obj.data = data
                        elif hasattr(store_obj, "_data") and isinstance(data, dict):
                            store_obj._data = data
                        elif hasattr(store_obj, "entries") and isinstance(data, list):
                            store_obj.entries = data
                        elif hasattr(store_obj, "frames") and isinstance(data, list):
                            store_obj.frames = data
                        elif isinstance(store_obj, dict) and isinstance(data, dict):
                            # The object history is a plain dict in hass.data,
                            # saved every 15 s from memory: replaced in place
                            # (other holders keep the same dict).
                            store_obj.clear()
                            store_obj.update(data)
                        elif hasattr(store_obj, "async_load"):
                            # Forensics (.addrs) and the device registry
                            # (._devices + its index) match none of the above:
                            # their next save wrote the old data back over the
                            # restore. They read the restored file back in.
                            await store_obj.async_load()
            except Exception as e:
                _LOGGER.warning("Failed to restore %s: %s", store_key, e)

    if wled_touched:
        # The hold / reconnect / team-follow listener tracks the restored
        # set of devices, not the one before (it was until a restart).
        try:
            from .wled_exact import _refresh_listener
            _refresh_listener(hass)
        except Exception as e:  # noqa: BLE001
            _LOGGER.debug("WLED listener refresh after restore failed: %s", e)

    # ── Restore map images to disk ────────────────────────────────────────────
    images_restored = 0
    if msg.get("restore_map_images") and backup.get("map_images"):
        import base64 as _b64
        try:
            from .maps_store import maps_dir_for
            maps_dir = maps_dir_for(hass)
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: maps_dir.mkdir(parents=True, exist_ok=True)
            )
            maps_root = await asyncio.get_event_loop().run_in_executor(None, maps_dir.resolve)
            for fname, b64data in backup["map_images"].items():
                # Sanitize filename
                safe = Path(fname).name
                if not safe or "/" in safe or "\\" in safe:
                    continue
                fp = await asyncio.get_event_loop().run_in_executor(None, (maps_dir / safe).resolve)
                if not str(fp).startswith(str(maps_root)):
                    continue
                try:
                    raw = _b64.b64decode(b64data)
                    await asyncio.get_event_loop().run_in_executor(None, fp.write_bytes, raw)
                    images_restored += 1
                except Exception:
                    pass
        except Exception as e:
            _LOGGER.warning("Failed to restore map images: %s", e)

    # ── The world gauge, after a Model restore ───────────────────────────
    #
    # A restore REPLACES `mdl.data` wholesale, so a backup taken before the
    # gauge existed takes `world_gauge` away with it. The startup migration
    # cannot put it back — its marker is already set and a marker is one-way —
    # so the house would lose its metre scale permanently, at the moment the
    # owner was trying to recover it. `async_ensure_world_gauge` is write-once
    # and returns immediately when the gauge is already set, so this is a
    # no-op on a restore that brought one back.
    if restored:
        try:
            _mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
            _ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
            if _mdl is not None:
                await _mdl.async_ensure_world_gauge(
                    (_ms.data.get("maps") or []) if _ms else [])
        except Exception:
            _LOGGER.exception("Could not re-seed the world gauge after a restore")

    if restored:
        _bump(hass, "backup_restored")
    connection.send_result(msg["id"], {
        "restored": restored,
        "total": len(stores_data),
        "images_restored": images_restored,
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/store_backup_delete",
    vol.Required("backup_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_store_backup_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a specific backup."""
    backup_id = msg["backup_id"]
    async with _backups_lock(hass):
        bk_data = await _load_backups(hass)
        before = len(bk_data.get("backups", []))
        bk_data["backups"] = [b for b in bk_data.get("backups", []) if b.get("id") != backup_id]
        deleted = before - len(bk_data["backups"])
        if deleted > 0:
            await _save_backups(hass, bk_data)
    connection.send_result(msg["id"], {"deleted": deleted > 0})
