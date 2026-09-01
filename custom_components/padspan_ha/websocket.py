# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""PadSpan HA websocket API — registration and the handlers with no subject of their own.

The API is split by subject; each module registers nothing and websocket.py
registers everything (async_register_websockets), so the panel sees one API.

    ws_common          shared helpers: settings, the Pro gate, RPA heuristic, snapshot cache keys
    snapshot_builder   the live snapshot (the largest single piece; its own file for that reason)
    ws_fabric          writes to the metric fabric: scanners, beacons, lights, rooms, walls, floors
    ws_calibration     calibration points and the models trained on them
    ws_capture         RSSI vector capture sessions
    ws_maps            the floor-plan photographs
    ws_objects         object labels and history
    ws_forensics       Forensics (Pro) and the licence
    ws_backup          store backup and restore
    ws_irk             Private BLE (IRK)
    ws_companion       Companion App phone discovery and follow
    ws_occupancy       occupancy estimation
    ws_devices         the device registry
    ws_radios          scanner (radio) management
    ws_follow          follow/alert configuration, room-tag housekeeping
    ws_notify          notification services
    ws_adaptive        the adaptive learning store
    ws_diagnostics     system critics, propagation health, positioning diagnostics, HA entity audit
    ws_factory_reset   the factory reset
    ws_bright_import   the PadSpan Bright → PadSpan HA import
    ws_telemetry       the opt-in usage report
    ws_settings        settings get/set

Every moved name is imported back here, so `from .websocket import ws_x`
still works for tests and callers.
"""


import logging

import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry

from .const import (
    DOMAIN,
    VERSION,
    DATA_SETTINGS,
    DATA_MODEL,
    DATA_FABRIC,
    DATA_OBJECTS,
    DEFAULT_FLOOR_ID,
    DATA_MOVEMENT,
    DATA_TRACEBACK,
)
from .build_info import BUILD_ID, BUILD_VERSION
from .vendor_lookup import async_lookup_vendor

_LOGGER = logging.getLogger(__name__)

from .ws_common import (  # noqa: F401  (re-exported: registration, tests, callers)
    PRO_GRACE_DAYS,
    _ALL_ADDR_CAP,
    _ALL_STORE_KEYS,
    _DATA_KEY_MAP,
    _DATA_SNAPSHOT_CACHE,
    _DATA_SNAPSHOT_CACHE_LOCK,
    _DEFAULT_IBEACON_UUIDS,
    _LIGHT_SHAPE_KINDS,
    _LOG_BUFFER_SIZE,
    _MAX_BACKUPS,
    _OBJECT_HISTORY_DAYS_DEFAULT,
    _OBJECT_HISTORY_DAY_CHOICES,
    _RingLogHandler,
    _SNAPSHOT_CACHE_TTL_S,
    _XREF_ADDR_SAMPLE,
    _capped_mac_history,
    _ensure_log_handler,
    _get_settings,
    _invalidate_snapshot_cache,
    _is_rpa_addr,
    _log_handler,
    _object_history_ttl_s,
    _padspan_pro_active,
    _tier_at_least,
    _point_in_polygon,
    _pro_expiry_state,
    _room_from_bounds,
)
from .ws_follow import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_area_delete,
    ws_entity_delete,
    ws_follow_alert_delete,
    ws_follow_alert_get,
    ws_follow_alert_save,
    ws_room_tag_purge_missing,
    ws_room_tags,
)
from .ws_diagnostics import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_auto_diagnostics,
    ws_ha_entities_audit,
    ws_positioning_diag,
    ws_propagation_health,
    ws_system_critics,
)
from .snapshot_builder import (  # noqa: F401  (re-exported: registration, tests, callers)
    _build_live_snapshot,
    _live_snapshot,
    ws_live_snapshot,
)
from .ws_settings import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_settings_get,
    ws_settings_set,
)
from .ws_calibration import (  # noqa: F401  (re-exported: registration, tests, callers)
    _get_cal_store,
    ws_calibration_beacon_profiles,
    ws_calibration_clear,
    ws_calibration_clear_map,
    ws_calibration_compute_model,
    ws_calibration_delete_point,
    ws_calibration_get,
    ws_calibration_health_check,
    ws_calibration_relearn_radio,
    ws_calibration_retrain_rf,
    ws_calibration_save_point,
    ws_calibration_swap_radio,
    ws_object_evict,
)
from .ws_radios import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_radio_area_set,
    ws_radio_audit,
    ws_radio_disabled_set,
    ws_radio_lost_set,
    ws_radio_reset,
    ws_scanner_offset_set,
)
from .ws_maps import (  # noqa: F401  (re-exported: registration, tests, callers)
    _last_receiver_prune,
    ws_maps_delete,
    ws_maps_delete_migrate,
    ws_maps_list,
    ws_maps_replace_image,
    ws_maps_revert_extend,
    ws_maps_update,
    ws_maps_upload,
)
from .ws_objects import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_object_label_delete,
    ws_object_label_list,
    ws_object_label_set,
    ws_objects_clear_history,
)
from .ws_forensics import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_forensics_clear,
    ws_forensics_license_activate,
    ws_forensics_license_reveal,
    ws_forensics_query,
    ws_forensics_stats,
)
from .ws_capture import (  # noqa: F401  (re-exported: registration, tests, callers)
    _capture_store,
    ws_capture_delete,
    ws_capture_get,
    ws_capture_list,
    ws_capture_mark,
    ws_capture_start,
    ws_capture_status,
    ws_capture_stop,
)
from .ws_notify import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_notify_services_list,
    ws_notify_test,
)
from .ws_adaptive import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_adaptive_fingerprints_get,
    ws_adaptive_reset,
    ws_adaptive_status_get,
)
from .ws_backup import (  # noqa: F401  (re-exported: registration, tests, callers)
    _auto_backup,
    _load_backups,
    _save_backups,
    ws_store_backup_create,
    ws_store_backup_delete,
    ws_store_backup_list,
    ws_store_backup_restore,
)
from .ws_irk import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_irk_add,
    ws_irk_auto_detect,
    ws_irk_remove,
    ws_irk_validate,
    ws_private_ble_add_irk,
    ws_private_ble_delete_irk,
    ws_private_ble_status,
)
from .ws_companion import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_companion_discover,
    ws_companion_follow,
    ws_companion_unfollow,
)
from .ws_factory_reset import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_factory_reset,
)
from .ws_bright_import import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_bright_import,
    ws_bright_import_status,
)
from .ws_telemetry import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_telemetry_event,
    ws_telemetry_preview,
    ws_telemetry_reset_id,
    ws_install_base,
    ws_telemetry_send_now,
)
from .ws_fabric import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_fabric_beacon_position_set,
    ws_fabric_beacon_remove,
    ws_fabric_correct_room,
    ws_fabric_floor_elevations_set,
    ws_fabric_floor_finalize,
    ws_fabric_health,
    ws_fabric_light_position_set,
    ws_fabric_light_remove,
    ws_fabric_map_reanchor,
    ws_fabric_map_transform_set,
    ws_fabric_reset_spatial,
    ws_fabric_resync,
    ws_fabric_rf_barrier_remove,
    ws_fabric_rf_barrier_set,
    ws_fabric_room_add,
    ws_fabric_room_remove,
    ws_fabric_rooms_reconcile,
    ws_fabric_scanner_position_set,
    ws_fabric_scanner_remove,
    ws_fabric_scanner_z_set,
    ws_fabric_sync_mode_set,
    ws_fabric_truth_candidates,
)
from .ws_occupancy import (  # noqa: F401  (re-exported: registration, tests, callers)
    compute_occupancy_estimate,
    ws_occupancy_estimate,
    ws_occupancy_train,
)
from .ws_devices import (  # noqa: F401  (re-exported: registration, tests, callers)
    ws_device_registry_add_identity,
    ws_device_registry_delete,
    ws_device_registry_label_set,
    ws_device_registry_list,
    ws_device_registry_merge,
    ws_device_registry_migrate,
    ws_espresense_companion_import,
)


# ── WebSocket Command Registration ─────────────────────────────────────────────

@callback
def async_register_websockets(hass: HomeAssistant) -> None:
    """Register every PadSpan WS command with Home Assistant.

    Called once during integration setup.  Also attaches the in-memory log
    handler so the UI Debug tab can display WARNING+ log entries.
    """
    websocket_api.async_register_command(hass, ws_status)
    websocket_api.async_register_command(hass, ws_room_tags)
    websocket_api.async_register_command(hass, ws_auto_diagnostics)
    websocket_api.async_register_command(hass, ws_version)
    websocket_api.async_register_command(hass, ws_settings_get)
    websocket_api.async_register_command(hass, ws_settings_set)
    websocket_api.async_register_command(hass, ws_scanner_offset_set)
    websocket_api.async_register_command(hass, ws_live_snapshot)
    websocket_api.async_register_command(hass, ws_vendor_lookup)
    websocket_api.async_register_command(hass, ws_maps_list)
    websocket_api.async_register_command(hass, ws_maps_upload)
    websocket_api.async_register_command(hass, ws_maps_update)
    websocket_api.async_register_command(hass, ws_maps_replace_image)
    websocket_api.async_register_command(hass, ws_maps_delete)
    websocket_api.async_register_command(hass, ws_maps_delete_migrate)
    websocket_api.async_register_command(hass, ws_maps_revert_extend)
    websocket_api.async_register_command(hass, ws_model_get)
    websocket_api.async_register_command(hass, ws_model_update)
    websocket_api.async_register_command(hass, ws_object_label_set)
    websocket_api.async_register_command(hass, ws_object_label_delete)
    websocket_api.async_register_command(hass, ws_object_label_list)
    websocket_api.async_register_command(hass, ws_radio_area_set)
    websocket_api.async_register_command(hass, ws_radio_lost_set)
    websocket_api.async_register_command(hass, ws_radio_disabled_set)
    websocket_api.async_register_command(hass, ws_radio_reset)
    websocket_api.async_register_command(hass, ws_follow_alert_get)
    websocket_api.async_register_command(hass, ws_follow_alert_save)
    websocket_api.async_register_command(hass, ws_follow_alert_delete)
    websocket_api.async_register_command(hass, ws_area_delete)
    websocket_api.async_register_command(hass, ws_entity_delete)
    websocket_api.async_register_command(hass, ws_room_tag_purge_missing)
    websocket_api.async_register_command(hass, ws_integration_reload)
    websocket_api.async_register_command(hass, ws_calibration_get)
    websocket_api.async_register_command(hass, ws_calibration_save_point)
    websocket_api.async_register_command(hass, ws_calibration_delete_point)
    websocket_api.async_register_command(hass, ws_calibration_clear)
    websocket_api.async_register_command(hass, ws_calibration_clear_map)
    websocket_api.async_register_command(hass, ws_object_evict)
    websocket_api.async_register_command(hass, ws_calibration_compute_model)
    websocket_api.async_register_command(hass, ws_calibration_retrain_rf)
    websocket_api.async_register_command(hass, ws_calibration_swap_radio)
    websocket_api.async_register_command(hass, ws_calibration_relearn_radio)
    websocket_api.async_register_command(hass, ws_calibration_beacon_profiles)
    websocket_api.async_register_command(hass, ws_calibration_health_check)
    websocket_api.async_register_command(hass, ws_movement_history_get)
    websocket_api.async_register_command(hass, ws_traceback_get)
    websocket_api.async_register_command(hass, ws_traceback_objects)
    websocket_api.async_register_command(hass, ws_notify_services_list)
    websocket_api.async_register_command(hass, ws_notify_test)
    websocket_api.async_register_command(hass, ws_adaptive_status_get)
    websocket_api.async_register_command(hass, ws_adaptive_fingerprints_get)
    websocket_api.async_register_command(hass, ws_adaptive_reset)
    websocket_api.async_register_command(hass, ws_suspend_databases)
    websocket_api.async_register_command(hass, ws_unsuspend_databases)
    websocket_api.async_register_command(hass, ws_positioning_diag)
    websocket_api.async_register_command(hass, ws_propagation_health)
    websocket_api.async_register_command(hass, ws_system_critics)
    websocket_api.async_register_command(hass, ws_store_backup_create)
    websocket_api.async_register_command(hass, ws_store_backup_list)
    websocket_api.async_register_command(hass, ws_store_backup_restore)
    websocket_api.async_register_command(hass, ws_store_backup_delete)
    websocket_api.async_register_command(hass, ws_ha_entities_audit)
    websocket_api.async_register_command(hass, ws_logs_get)
    websocket_api.async_register_command(hass, ws_private_ble_status)
    websocket_api.async_register_command(hass, ws_irk_add)
    websocket_api.async_register_command(hass, ws_irk_validate)
    websocket_api.async_register_command(hass, ws_irk_auto_detect)
    websocket_api.async_register_command(hass, ws_irk_remove)
    websocket_api.async_register_command(hass, ws_private_ble_add_irk)
    websocket_api.async_register_command(hass, ws_private_ble_delete_irk)
    websocket_api.async_register_command(hass, ws_objects_clear_history)
    websocket_api.async_register_command(hass, ws_companion_discover)
    websocket_api.async_register_command(hass, ws_companion_follow)
    websocket_api.async_register_command(hass, ws_companion_unfollow)
    websocket_api.async_register_command(hass, ws_tags_status)
    websocket_api.async_register_command(hass, ws_factory_reset)
    websocket_api.async_register_command(hass, ws_bright_import_status)
    websocket_api.async_register_command(hass, ws_bright_import)
    websocket_api.async_register_command(hass, ws_telemetry_preview)
    websocket_api.async_register_command(hass, ws_telemetry_event)
    websocket_api.async_register_command(hass, ws_telemetry_send_now)
    websocket_api.async_register_command(hass, ws_telemetry_reset_id)
    websocket_api.async_register_command(hass, ws_install_base)
    # Phase 1: positioning fabric commands
    websocket_api.async_register_command(hass, ws_fabric_scanner_remove)
    websocket_api.async_register_command(hass, ws_fabric_beacon_remove)
    websocket_api.async_register_command(hass, ws_fabric_beacon_position_set)
    websocket_api.async_register_command(hass, ws_fabric_light_position_set)
    websocket_api.async_register_command(hass, ws_fabric_light_remove)
    websocket_api.async_register_command(hass, ws_fabric_room_add)
    websocket_api.async_register_command(hass, ws_fabric_room_remove)
    websocket_api.async_register_command(hass, ws_fabric_sync_mode_set)
    # Phase 2: real-world spatial model commands
    websocket_api.async_register_command(hass, ws_fabric_scanner_position_set)
    websocket_api.async_register_command(hass, ws_fabric_floor_elevations_set)
    websocket_api.async_register_command(hass, ws_fabric_scanner_z_set)
    websocket_api.async_register_command(hass, ws_fabric_correct_room)
    websocket_api.async_register_command(hass, ws_fabric_rooms_reconcile)
    websocket_api.async_register_command(hass, ws_fabric_floor_finalize)
    websocket_api.async_register_command(hass, ws_fabric_truth_candidates)
    websocket_api.async_register_command(hass, ws_fabric_rf_barrier_set)
    websocket_api.async_register_command(hass, ws_fabric_rf_barrier_remove)
    websocket_api.async_register_command(hass, ws_fabric_map_transform_set)
    websocket_api.async_register_command(hass, ws_fabric_map_reanchor)
    websocket_api.async_register_command(hass, ws_occupancy_estimate)
    websocket_api.async_register_command(hass, ws_occupancy_train)
    websocket_api.async_register_command(hass, ws_fabric_health)
    websocket_api.async_register_command(hass, ws_fabric_resync)
    websocket_api.async_register_command(hass, ws_radio_audit)
    websocket_api.async_register_command(hass, ws_fabric_reset_spatial)
    websocket_api.async_register_command(hass, ws_device_registry_list)
    websocket_api.async_register_command(hass, ws_device_registry_migrate)
    websocket_api.async_register_command(hass, ws_device_registry_merge)
    websocket_api.async_register_command(hass, ws_device_registry_label_set)
    websocket_api.async_register_command(hass, ws_device_registry_add_identity)
    websocket_api.async_register_command(hass, ws_device_registry_delete)
    websocket_api.async_register_command(hass, ws_espresense_companion_import)
    # Forensics (opt-in time-window presence queries; Pro licence gated)
    websocket_api.async_register_command(hass, ws_forensics_query)
    websocket_api.async_register_command(hass, ws_forensics_stats)
    websocket_api.async_register_command(hass, ws_forensics_clear)
    websocket_api.async_register_command(hass, ws_forensics_license_activate)
    websocket_api.async_register_command(hass, ws_forensics_license_reveal)
    # RSSI vector capture (opt-in session recorder; replay fixtures)
    websocket_api.async_register_command(hass, ws_capture_start)
    websocket_api.async_register_command(hass, ws_capture_stop)
    websocket_api.async_register_command(hass, ws_capture_status)
    websocket_api.async_register_command(hass, ws_capture_mark)
    websocket_api.async_register_command(hass, ws_capture_list)
    websocket_api.async_register_command(hass, ws_capture_get)
    websocket_api.async_register_command(hass, ws_capture_delete)
    _ensure_log_handler()
    _LOGGER.debug("PadSpan HA websocket commands registered")

# ── Status / Diagnostics / Version ─────────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/status"})
@websocket_api.async_response
async def ws_status(hass: HomeAssistant, connection, msg) -> None:
    """Return the coordinator's current state dict for the Manage → Health tab."""
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    entries = []
    if coord:
        entries.append(coord.as_dict())
    connection.send_result(msg["id"], {"entries": entries})


@websocket_api.websocket_command({"type": "padspan_ha/version"})
@websocket_api.async_response
async def ws_version(hass: HomeAssistant, connection, msg) -> None:
    """Return version info.  BUILD_ID is a YYYYMMDDTHHMMSSZ cache-buster for JS imports."""
    connection.send_result(msg["id"], {"version": VERSION, "build_version": BUILD_VERSION, "build_id": BUILD_ID})


@websocket_api.websocket_command({"type": "padspan_ha/model_get"})
@websocket_api.async_response
async def ws_model_get(hass: HomeAssistant, connection, msg) -> None:
    """Return floors from HA floor registry, areas from HA area registry, and per-room metadata."""
    # --- Floors: prefer HA floor registry (HA 2024.1+), fall back to ModelStore ---
    floors: list[dict[str, Any]] = []
    try:
        from homeassistant.helpers import floor_registry as fr_helper
        fr = fr_helper.async_get(hass)
        floors = [
            {"id": f.floor_id, "name": f.name, "level": getattr(f, "level", None)}
            for f in sorted(fr.async_list_floors(), key=lambda x: (getattr(x, "level", 0) or 0, x.name))
        ]
    except Exception:
        pass
    if not floors:
        mdl_fb = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        floors = mdl_fb.floors() if mdl_fb else [{"id": DEFAULT_FLOOR_ID, "name": "Main Floor"}]

    # Overlay stored elevation data (ModelStore) onto the registry floors —
    # the registry knows names and levels, the ModelStore knows heights.
    _mdl_el = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if _mdl_el:
        _stored = {str(f.get("id")): f for f in _mdl_el.floors() if isinstance(f, dict)}
        for _fl in floors:
            _sf = _stored.get(str(_fl.get("id")))
            if _sf:
                # "level" too: it is the key _ordered_floors stacks by, so a
                # frontend that sorts without it shows the floors in a
                # different order than the elevations were derived in.
                for _k in ("level", "floor_to_floor_m", "base_elevation_m"):
                    if _k in _sf:
                        _fl[_k] = _sf[_k]

    # --- Areas: from HA area registry ---
    areas: list[dict[str, Any]] = []
    try:
        ar_r = area_registry.async_get(hass)
        areas = [
            {"id": a.id, "name": a.name, "floor_id": getattr(a, "floor_id", None) or DEFAULT_FLOOR_ID}
            for a in sorted(ar_r.async_list_areas(), key=lambda x: x.name)
        ]
    except Exception:
        pass

    # --- Room meta: from ModelStore ---
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    room_meta = mdl.room_meta() if mdl else {}

    # ── Fabric data (Phase 1 + Phase 2 decoupling) ─────────────────────────
    scanners = mdl.data.get("scanners", {}) if mdl else {}
    room_adjacency = mdl.data.get("room_adjacency", {}) if mdl else {}
    fabric_sync_mode = mdl.data.get("fabric_sync_mode", "auto") if mdl else "auto"
    scanner_positions_m = mdl.scanner_positions_m() if mdl else {}
    room_geometry_m = mdl.room_geometry_m() if mdl else {}
    rf_barriers_m = mdl.rf_barriers_m() if mdl else []
    map_transforms = mdl.data.get("map_transforms", {}) if mdl else {}
    beacon_positions_m = mdl.beacon_positions_m() if mdl else {}
    _fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    fabric_floors = _fab.floors_status() if _fab else {}

    connection.send_result(msg["id"], {
        "floors": floors, "areas": areas, "room_meta": room_meta,
        "scanners": scanners, "room_adjacency": room_adjacency,
        "fabric_sync_mode": fabric_sync_mode,
        "scanner_positions_m": scanner_positions_m,
        "light_positions_m": mdl.light_positions_m() if mdl else {},
        "room_geometry_m": room_geometry_m,
        "rf_barriers_m": rf_barriers_m,
        "map_transforms": map_transforms,
        "beacon_positions_m": beacon_positions_m,
        "fabric_floors": fabric_floors,
        "floor_elevations": _mdl_el.floor_base_elevations_m() if _mdl_el else {},
        # The house's metre scale, stored. The panel used to work it out for
        # itself, in `stack_transform.js`'s metreAnchor, from the maps and
        # their transforms — a second implementation of the same measurement,
        # which is how the reader and the writer came to be able to pick
        # different maps. There is one number and this is where it comes from.
        "world_gauge": mdl.world_gauge() if mdl else {"m_per_unit": None, "source_map_id": None},
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/model_update",
        vol.Optional("floors"): list,  # accepted for schema compat; ignored — floors come from HA
        vol.Optional("room_meta"): dict,
    }
)
@websocket_api.async_response
async def ws_model_update(hass: HomeAssistant, connection, msg) -> None:
    """Update room_meta (color, floor assignment). Floors are read-only from HA floor registry."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model_store", "Model store not initialized")
        return
    updated = await mdl.async_update(room_meta=msg.get("room_meta"))
    connection.send_result(msg["id"], updated)


# ── Settings Helpers ───────────────────────────────────────────────────────────


# ── Live Snapshot ──────────────────────────────────────────────────────────────
# This is the MAIN data pipeline: assembles everything the UI needs from HA state,
# BLE advertisements, device/entity registries, calibration, and object history.
# Called every 5s by the panel's poll loop and on demand by other handlers.


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/vendor_lookup",
        "mac": str,
        vol.Optional("force_refresh"): bool,
    }
)
@websocket_api.async_response
async def ws_vendor_lookup(hass: HomeAssistant, connection, msg) -> None:
    """Vendor lookup for a MAC address.

    Used by the Overview → Objects/Unidentified modal.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    enabled = True
    try:
        if st:
            enabled = bool(st.get("vendor_lookup_enabled", True))
    except Exception:
        enabled = True

    if not enabled:
        connection.send_result(msg["id"], {"enabled": False})
        return

    mac = msg.get("mac") or ""
    force = bool(msg.get("force_refresh", False))
    res = await async_lookup_vendor(hass, mac, force_refresh=force)
    res["enabled"] = True
    connection.send_result(msg["id"], res)


# ── Maps CRUD ──────────────────────────────────────────────────────────────────



# ── Object Labelling ───────────────────────────────────────────────────────────


# ── Forensics (opt-in time-window presence queries — issue #55) ───────────────
# Data comes from ForensicsStore (real recorded sessions) with a lower-
# confidence fallback over the object-history cache's first/last-seen span.
# NOTHING here ships in live_snapshot; these are on-demand queries only.


# ── RSSI Vector Capture ────────────────────────────────────────────────────────
# Session recorder for offline replay.  Off by default; a session only exists
# because an operator started one, and it stops itself at 60 min or 25 MB.
# Export runs over this websocket rather than an HTTP view — the integration
# registers none, and .storage is not reachable from the two static dirs
# panel.py mounts.


# ── Radio / Scanner Management ─────────────────────────────────────────────────


# ── Follow / Alert Configuration ───────────────────────────────────────────────


@websocket_api.websocket_command({"type": "padspan_ha/integration_reload"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_integration_reload(hass: HomeAssistant, connection, msg) -> None:
    """Reload the PadSpan HA config entry."""
    reloaded = 0
    for entry in hass.config_entries.async_entries(DOMAIN):
        try:
            await hass.config_entries.async_reload(entry.entry_id)
            reloaded += 1
        except Exception as e:
            _LOGGER.warning("PadSpan HA reload failed for %s: %s", entry.entry_id, e)
    connection.send_result(msg["id"], {"ok": True, "reloaded": reloaded})


# ── Calibration WebSocket Handlers ────────────────────────────────────────────
# Calibration data is SACRED (see feedback_calibration_data.md).  Beacon captures
# are cumulative — old positions must never be deleted, only new ones added.
# The CalibrationStore holds per-position RSSI fingerprints that power the k-NN
# and Random Forest positioning algorithms.


# ═══════════════════════════════════════════════════════════════════════════════
# Movement history
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({
    "type": "padspan_ha/movement_history_get",
    vol.Optional("device"): str,
    vol.Optional("limit", default=100): int,
})
@websocket_api.async_response
async def ws_movement_history_get(hass: HomeAssistant, connection, msg) -> None:
    """Return recent movement history entries."""
    from .const import DATA_MOVEMENT
    mv = hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
    if not mv:
        connection.send_result(msg["id"], {"entries": []})
        return
    device = msg.get("device")
    limit = msg.get("limit", 100)
    entries = mv.get_history(device=device, limit=limit)
    connection.send_result(msg["id"], {"entries": entries})


# Traceback playback
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({
    "type": "padspan_ha/traceback_get",
    vol.Optional("start_ts"): vol.Coerce(float),
    vol.Optional("end_ts"): vol.Coerce(float),
    vol.Optional("obj_key"): str,
    vol.Optional("max_frames", default=4000): int,
})
@websocket_api.async_response
async def ws_traceback_get(hass: HomeAssistant, connection, msg) -> None:
    """Return traceback position frames for playback."""
    from .const import DATA_TRACEBACK
    tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
    if not tb:
        connection.send_result(msg["id"], {"frames": [], "range": {"start": 0, "end": 0, "count": 0}})
        return
    frames = tb.get_frames(
        start_ts=msg.get("start_ts"),
        end_ts=msg.get("end_ts"),
        obj_key=msg.get("obj_key"),
        max_frames=msg.get("max_frames", 4000),
    )
    connection.send_result(msg["id"], {
        "frames": frames,
        "range": tb.get_time_range(),
    })


@websocket_api.websocket_command({"type": "padspan_ha/traceback_objects"})
@websocket_api.async_response
async def ws_traceback_objects(hass: HomeAssistant, connection, msg) -> None:
    """Return all object keys seen in traceback history."""
    from .const import DATA_TRACEBACK
    tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
    if not tb:
        connection.send_result(msg["id"], {"objects": [], "range": {"start": 0, "end": 0, "count": 0}})
        return
    connection.send_result(msg["id"], {
        "objects": tb.get_object_keys(),
        "range": tb.get_time_range(),
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Notify services list
# ═══════════════════════════════════════════════════════════════════════════════

# ── Notification Service Discovery ─────────────────────────────────────────────


# ═══════════════════════════════════════════════════════════════════════════════
# Adaptive learning
# ═══════════════════════════════════════════════════════════════════════════════


@websocket_api.websocket_command({
    "type": "padspan_ha/suspend_databases",
    vol.Optional("minutes", default=60): vol.All(int, vol.Range(min=1, max=480)),
})
@websocket_api.async_response
async def ws_suspend_databases(hass: HomeAssistant, connection, msg) -> None:
    """Suspend all learned databases — raw radio + spatial centroid only."""
    coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    minutes = msg.get("minutes", 60)
    if coord:
        coord.suspend_databases(minutes)
        connection.send_result(msg["id"], {"ok": True, "minutes": minutes, "suspended": True})
    else:
        connection.send_result(msg["id"], {"ok": False, "error": "Coordinator not ready"})


@websocket_api.websocket_command({"type": "padspan_ha/unsuspend_databases"})
@websocket_api.async_response
async def ws_unsuspend_databases(hass: HomeAssistant, connection, msg) -> None:
    """End database suspension early — resume full pipeline."""
    coord = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    if coord:
        coord.unsuspend_databases()
        connection.send_result(msg["id"], {"ok": True, "suspended": False})
    else:
        connection.send_result(msg["id"], {"ok": False, "error": "Coordinator not ready"})


# ═══════════════════════════════════════════════════════════════════════════════
# Propagation health analysis
# ═══════════════════════════════════════════════════════════════════════════════


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 4: System Self-Diagnosis ("Critics")
# ═══════════════════════════════════════════════════════════════════════════════
#
# Aggregates data from the calibration store, adaptive store, presence
# coordinator (scanner reliability), and maps store into a unified list of
# actionable diagnostic messages.  Each "critic" describes a specific issue,
# its severity, and a concrete next step.
#
# Categories:
#   room_confusion  — room pairs with high bidirectional transition counts
#   map_quality     — per-map LOO position error
#   scanner         — scanners that persistently disagree with consensus
#   calibration     — staleness, sparse coverage, scanner RSSI anomalies
#   propagation     — adaptive-store fingerprint issues


# ═══════════════════════════════════════════════════════════════════════════════
# Store Backup / Restore
# ═══════════════════════════════════════════════════════════════════════════════
#
# Backs up ALL PadSpan persistent stores + map image files into a single JSON
# blob stored via HA's built-in Storage helper.  Up to 3 backups are retained.
#
# Key design decisions:
#   - Map images are base64-encoded and included in the backup so restoring on
#     a new HA instance doesn't lose floor plan images.
#   - Restore supports selective store_keys filtering — the user can restore
#     only calibration data without overwriting their settings.
#   - In-memory store objects are hot-patched after restore so no restart is
#     needed (though HA restart is recommended for full consistency).
#   - Each store class uses different attribute names (.data, ._data, .entries,
#     .frames) so both backup and restore probe for the correct attribute.


@websocket_api.websocket_command({
    "type": "padspan_ha/logs_get",
    vol.Optional("level", default="DEBUG"): str,
    vol.Optional("limit", default=200): int,
})
@websocket_api.async_response
async def ws_logs_get(hass: HomeAssistant, connection, msg) -> None:
    """Return recent PadSpan log entries from the in-memory ring buffer."""
    handler = _ensure_log_handler()
    min_level = getattr(logging, str(msg.get("level", "DEBUG")).upper(), logging.DEBUG)
    limit = min(500, max(1, int(msg.get("limit", 200))))
    filtered = [e for e in handler.records if getattr(logging, e["level"], 0) >= min_level]
    # Most recent first
    entries = list(reversed(filtered[-limit:]))
    connection.send_result(msg["id"], {"entries": entries, "total": len(handler.records)})


# ── Geometry Helpers ───────────────────────────────────────────────────────────


# ── Private BLE / IRK Management ───────────────────────────────────────────────
# IRKs (Identity Resolving Keys) let PadSpan identify phones/watches whose BLE
# MAC address rotates every ~15 minutes.  IRKs can come from HA's private_ble_device
# integration or be managed directly via PadSpan settings (irk_add/irk_remove).


# ── Auto-discover Companion App phones via BLE Transmitter ───────────────────
# The Companion App (Android + iOS) can broadcast as an iBeacon via its
# BLE Transmitter sensor.  This section discovers phones using 5 strategies:
#   1. Entity registry: sensor.*_ble_transmitter from mobile_app platform
#   2. Device registry: mobile_app devices without BLE transmitter entities
#   3. Notify services: notify.mobile_app_* always exists when app is registered
#   4. Device tracker: device_tracker.* from mobile_app (always present)
#   5. Webhook registrations: hass.data["mobile_app"] (lowest level, always exists)
# Each strategy catches progressively less-configured phones so the UI can
# guide the user through enabling BLE Transmitter step by step.


# ── HA Tags integration status ──────────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/tags_status"})
@websocket_api.async_response
async def ws_tags_status(hass: HomeAssistant, connection, msg) -> None:
    """Return HA Tags integration status and followed object tag mappings."""
    try:
        settings = _get_settings(hass)
        room_events = settings.get("tags_room_events_enabled", False)
        nfc_identify = settings.get("tags_nfc_identify_enabled", False)
        phone_autolink = settings.get("tags_phone_autolink_enabled", False)

        # Build tag_id mappings for followed objects
        import re
        followed = settings.get("followed_addrs") or []
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        mappings: list[dict[str, str]] = []
        for addr in followed:
            tag_id = "padspan_" + re.sub(r"[^a-z0-9_]", "_", addr.lower().strip())
            label = addr
            if obj_store:
                entry = obj_store.get(addr)
                if entry:
                    label = entry.get("label", addr)
            mappings.append({
                "object_key": addr,
                "tag_id": tag_id,
                "label": label,
            })

        # Check if HA tag component is loaded
        tag_available = "tag" in hass.config.components

        connection.send_result(msg["id"], {
            "tag_available": tag_available,
            "room_events_enabled": room_events,
            "nfc_identify_enabled": nfc_identify,
            "phone_autolink_enabled": phone_autolink,
            "followed_tag_mappings": mappings,
        })
    except Exception as err:
        _LOGGER.warning("tags_status failed: %s", err)
        connection.send_result(msg["id"], {
            "tag_available": False,
            "room_events_enabled": False,
            "nfc_identify_enabled": False,
            "phone_autolink_enabled": False,
            "followed_tag_mappings": [],
            "error": str(err),
        })


# ═══════════════════════════════════════════════════════════════════════════════
# Factory Reset — wipe ALL persistent data
# ═══════════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1 — Positioning Fabric WS handlers
# ══════════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Real-world spatial model WS handlers
# ══════════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════════
# Fabric Authority — batch spatial save
# ══════════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════════
# Occupancy Estimation (experimental)
# ══════════════════════════════════════════════════════════════════════════════


# ══════════════════════════════════════════════════════════════════════════════
# Fabric Health — diagnostic checks for Phase 1-3 decoupling
# ══════════════════════════════════════════════════════════════════════════════


# ── Device Registry WS Handlers ──────────────────────────────────────────────


# ══════════════════════════════════════════════════════════════════════════════
# ESPresense Companion Import
# ══════════════════════════════════════════════════════════════════════════════


