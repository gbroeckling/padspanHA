# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handler for the factory reset.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .telemetry import bump as _bump
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_FABRIC,
    DATA_OBJECTS,
    DATA_OBJECTS_CACHE,
    DATA_OBJECT_HISTORY,
    OBJECT_HISTORY_STORE_KEY,
    DATA_BEACON_LAST_MACS,
    DATA_COORDINATOR,
    DATA_CALIBRATION,
    DATA_ADAPTIVE,
    DATA_ALERTS,
    DATA_MOVEMENT,
    BACKUPS_STORE_KEY,
    SETTINGS_STORE_KEY,
    CALIBRATION_STORE_KEY,
    ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
    ALERTS_STORE_KEY,
    MOVEMENT_STORE_KEY,
    DATA_TRACEBACK,
    TRACEBACK_STORE_KEY,
)
from .bluetooth_live import get_bluetooth_live

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command({
    "type": "padspan_ha/factory_reset",
    vol.Required("confirm"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_factory_reset(hass: HomeAssistant, connection, msg) -> None:
    """Erase every PadSpan HA persistent store and reset to factory defaults.

    Requires confirm="FACTORY RESET" as a safety latch.  Admin-only.

    Resets 12 stores, each to its correct empty/default state:
      - SettingsStore → DEFAULT_SETTINGS (not {}, which would break the UI)
      - MapsStore → {"maps": []} + deletes uploaded image files from disk
      - CalibrationStore → {"points": [], "model": {}}
      - AdaptiveStore → empty room fingerprints / stats
      - ModelStore → DEFAULT_DATA
      - FabricStore → {"floors": {}, "history": []}
      - ObjectStore, AlertStore → {}
      - MovementStore → []
      - TracebackStore → {"frames": []}
      - ObjectHistory → {} (in-memory dict, re-initialized on next snapshot)
      - BackupsStore → {}

    Also clears in-memory caches: presence coordinator, main coordinator,
    object history dict, and bluetooth_live advertisement cache.

    bluetooth_live subscription is intentionally left intact — BLE radios
    keep working and will repopulate naturally.
    """
    if msg["confirm"] != "FACTORY RESET":
        connection.send_error(
            msg["id"], "confirmation_failed",
            'You must pass confirm="FACTORY RESET" to proceed.'
        )
        return

    import asyncio as _aio
    from pathlib import Path as _Path
    from homeassistant.helpers.storage import Store as _St
    from .settings_store import DEFAULT_SETTINGS
    from .model_store import DEFAULT_DATA as _model_defaults

    def _adaptive_empty():
        return {
            "room_fingerprints": {},
            "transition_counts": {},
            "floor_pairs": {},
            "stats": {"total_observations": 0, "learning_since": None, "days_active": 0},
        }

    domain = hass.data.get(DOMAIN, {})
    cleared = 0
    errors = []

    # ── 1. SettingsStore — reset to DEFAULT_SETTINGS, NOT {} ─────────────
    # The purchased licence survives a factory reset. It is not configuration
    # the user is asking to clear — it is proof of payment, it cannot be read
    # back once gone, and wiping it turns "start clean" into a support ticket.
    try:
        _live_settings = domain.get(DATA_SETTINGS)
        _keep_licence = {
            k: (_live_settings.data if _live_settings else {}).get(k, "")
            for k in ("forensics_license_key", "forensics_license_expires")
        }
        st = _St(hass, 1, SETTINGS_STORE_KEY)
        await st.async_save({**dict(DEFAULT_SETTINGS), **{
            k: v for k, v in _keep_licence.items() if v
        }})
        cleared += 1
        store_obj = domain.get(DATA_SETTINGS)
        if store_obj and hasattr(store_obj, "data"):
            store_obj.data = dict(DEFAULT_SETTINGS)
    except Exception as e:
        _LOGGER.warning("Factory reset: settings — %s", e)
        errors.append(SETTINGS_STORE_KEY)

    # ── 2. MapsStore — reset to {"maps": []} and delete map image files ──
    try:
        st = _St(hass, 1, MAPS_STORE_KEY)
        await st.async_save({"maps": []})
        cleared += 1
        maps_obj = domain.get(DATA_MAPS)
        if maps_obj and hasattr(maps_obj, "data"):
            maps_obj.data = {"maps": []}
        # Delete uploaded map images
        if maps_obj and hasattr(maps_obj, "maps_dir"):
            _mdir = maps_obj.maps_dir
        else:
            _mdir = _Path(hass.config.path("www")) / "padspan_ha" / "maps"
        if await _aio.to_thread(_mdir.is_dir):
            for f in await _aio.to_thread(list, _mdir.iterdir()):
                if f.is_file() and f.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
                    try:
                        await _aio.to_thread(f.unlink)
                    except Exception:
                        pass
    except Exception as e:
        _LOGGER.warning("Factory reset: maps — %s", e)
        errors.append(MAPS_STORE_KEY)

    # ── 3. CalibrationStore — reset to {"points": [], "model": {}} ───────
    try:
        st = _St(hass, 1, CALIBRATION_STORE_KEY)
        await st.async_save({"points": [], "model": {}})
        cleared += 1
        cal_obj = domain.get(DATA_CALIBRATION)
        if cal_obj and hasattr(cal_obj, "data"):
            cal_obj.data = {"points": [], "model": {}}
    except Exception as e:
        _LOGGER.warning("Factory reset: calibration — %s", e)
        errors.append(CALIBRATION_STORE_KEY)

    # ── 4. AdaptiveStore — reset to _empty_data() ────────────────────────
    try:
        st = _St(hass, 1, ADAPTIVE_STORE_KEY)
        await st.async_save(_adaptive_empty())
        cleared += 1
        ada_obj = domain.get(DATA_ADAPTIVE)
        if ada_obj and hasattr(ada_obj, "data"):
            ada_obj.data = _adaptive_empty()
    except Exception as e:
        _LOGGER.warning("Factory reset: adaptive — %s", e)
        errors.append(ADAPTIVE_STORE_KEY)

    # ── 5. ModelStore — reset to DEFAULT_DATA ─────────────────────────────
    try:
        st = _St(hass, 1, MODEL_STORE_KEY)
        await st.async_save(dict(_model_defaults))
        cleared += 1
        mod_obj = domain.get(DATA_MODEL)
        if mod_obj and hasattr(mod_obj, "data"):
            mod_obj.data = dict(_model_defaults)
    except Exception as e:
        _LOGGER.warning("Factory reset: model — %s", e)
        errors.append(MODEL_STORE_KEY)

    # ── 5b. FabricStore — reset room-geometry ground truth ────────────────
    # A factory reset is the one sanctioned full wipe: the "FACTORY RESET"
    # confirm latch above is the explicit user consent the fabric requires.
    try:
        st = _St(hass, 1, FABRIC_STORE_KEY)
        await st.async_save({"floors": {}, "history": []})
        cleared += 1
        fab_obj = domain.get(DATA_FABRIC)
        if fab_obj and hasattr(fab_obj, "data"):
            fab_obj.data = {"floors": {}, "history": []}
    except Exception as e:
        _LOGGER.warning("Factory reset: fabric — %s", e)
        errors.append(FABRIC_STORE_KEY)

    # ── 6. ObjectStore — reset ._data to {} ───────────────────────────────
    try:
        st = _St(hass, 1, OBJECT_STORE_KEY)
        await st.async_save({})
        cleared += 1
        obj_obj = domain.get(DATA_OBJECTS)
        if obj_obj:
            if hasattr(obj_obj, "_data"):
                obj_obj._data = {}
            elif hasattr(obj_obj, "data"):
                obj_obj.data = {}
    except Exception as e:
        _LOGGER.warning("Factory reset: objects — %s", e)
        errors.append(OBJECT_STORE_KEY)

    # ── 7. AlertStore — reset to {} ───────────────────────────────────────
    try:
        st = _St(hass, 1, ALERTS_STORE_KEY)
        await st.async_save({})
        cleared += 1
        alert_obj = domain.get(DATA_ALERTS)
        if alert_obj and hasattr(alert_obj, "data"):
            alert_obj.data = {}
    except Exception as e:
        _LOGGER.warning("Factory reset: alerts — %s", e)
        errors.append(ALERTS_STORE_KEY)

    # ── 8. MovementStore — reset .entries to [] ───────────────────────────
    try:
        st = _St(hass, 1, MOVEMENT_STORE_KEY)
        await st.async_save([])
        cleared += 1
        mov_obj = domain.get(DATA_MOVEMENT)
        if mov_obj and hasattr(mov_obj, "entries"):
            mov_obj.entries = []
        elif mov_obj and hasattr(mov_obj, "data"):
            mov_obj.data = []
    except Exception as e:
        _LOGGER.warning("Factory reset: movement — %s", e)
        errors.append(MOVEMENT_STORE_KEY)

    # ── 9. TracebackStore — reset .frames to [] ──────────────────────────
    try:
        st = _St(hass, 1, TRACEBACK_STORE_KEY)
        await st.async_save({"frames": []})
        cleared += 1
        tb_obj = domain.get(DATA_TRACEBACK)
        if tb_obj and hasattr(tb_obj, "frames"):
            tb_obj.frames = []
        elif tb_obj and hasattr(tb_obj, "data"):
            tb_obj.data = {"frames": []}
    except Exception as e:
        _LOGGER.warning("Factory reset: traceback — %s", e)
        errors.append(TRACEBACK_STORE_KEY)

    # ── 9b. CaptureStore — manifest AND session files ─────────────────────
    # The only store whose payload is not in the blob, so clearing the manifest
    # alone would leave the .jsonl files on disk.  async_clear unlinks them.
    try:
        from .const import CAPTURE_STORE_KEY, DATA_CAPTURE

        st = _St(hass, 1, CAPTURE_STORE_KEY)
        await st.async_save({"sessions": []})
        cleared += 1
        cap_obj = domain.get(DATA_CAPTURE)
        if cap_obj is not None:
            await cap_obj.async_clear()
    except Exception as e:
        _LOGGER.warning("Factory reset: capture — %s", e)
        errors.append("padspan_ha.capture")

    # ── 10. Object history (plain dict, not a store class) ────────────────
    try:
        st = _St(hass, 1, OBJECT_HISTORY_STORE_KEY)
        await st.async_save({})
        cleared += 1
    except Exception as e:
        _LOGGER.warning("Factory reset: object_history — %s", e)
        errors.append(OBJECT_HISTORY_STORE_KEY)

    # ── 11. Backups store ─────────────────────────────────────────────────
    try:
        st = _St(hass, 1, BACKUPS_STORE_KEY)
        await st.async_save({})
        cleared += 1
    except Exception as e:
        _LOGGER.warning("Factory reset: backups — %s", e)
        errors.append(BACKUPS_STORE_KEY)

    # ── Clear ALL in-memory caches ────────────────────────────────────────

    # Object snapshot cache (used for fast re-renders)
    domain.pop(DATA_OBJECTS_CACHE, None)

    # One poll of beacon address memory. Stale across a reload — the addresses
    # a rotating device wore before are gone — and keeping it would have the
    # first poll after a reload compare against a world that no longer exists.
    domain.pop(DATA_BEACON_LAST_MACS, None)

    # Object history — set to None so the reload condition triggers fresh load
    domain.pop(DATA_OBJECT_HISTORY, None)
    domain.pop("_obj_hist_last_save", None)
    domain.pop("_obj_hist_store", None)

    # Presence coordinator caches
    try:
        _coord = domain.get("presence_coordinator")
        if _coord:
            for attr in ("_known_objs", "_last_seen", "_room_votes",
                         "_room_confidence", "_device_labels"):
                if hasattr(_coord, attr):
                    getattr(_coord, attr).clear()
    except Exception:
        pass

    # Main coordinator caches
    try:
        _main_coord = domain.get(DATA_COORDINATOR)
        if _main_coord:
            for attr in ("_known_objs", "_last_seen"):
                if hasattr(_main_coord, attr):
                    getattr(_main_coord, attr).clear()
    except Exception:
        pass

    # BluetoothLive advertisement cache — clear so old objects disappear.
    # The subscription stays active so new ads will repopulate naturally.
    try:
        _bl = get_bluetooth_live(hass)
        if _bl:
            _bl._seen_by_source.clear()
            _bl._radio_last_heard.clear()
            _bl._last_reseed = None
    except Exception:
        pass

    _LOGGER.warning(
        "FACTORY RESET executed by %s — cleared %d stores",
        connection.user.name if connection.user else "unknown",
        cleared,
    )

    _bump(hass, "factory_reset")
    connection.send_result(msg["id"], {
        "ok": len(errors) == 0,
        "cleared": cleared,
        "total": 11,
        "errors": errors,
    })
