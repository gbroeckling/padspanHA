# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
WebSocket API surface for the PadSpan HA frontend panel.

Every UI action (settings changes, map edits, calibration, object labelling,
backup/restore, etc.) flows through handlers registered here.  We use the
HA websocket_api rather than REST because hass.callWS is stable across HA
releases and gives us push-capable connections for free.

The file is organised into logical sections:
  - Status / diagnostics / version
  - Model (floors, areas, room metadata)
  - Settings (read / write)
  - Live snapshot (the main data pipeline: BLE → objects → rooms)
  - Maps CRUD
  - Object labelling & history
  - Radio management (area assignment, lost/disabled, full reset)
  - Follow / alert configuration
  - Calibration (points, model computation, health check)
  - Movement history & traceback playback
  - Notifications
  - Adaptive learning
  - Propagation health analysis
  - Backup / restore
  - Private BLE / IRK management
  - Companion App discovery & auto-follow
  - HA Tags integration
  - Factory reset
"""


import asyncio
import logging
import time
from pathlib import Path

import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, State, callback
from homeassistant.helpers import area_registry, device_registry, entity_registry
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN, VERSION, DATA_SETTINGS, DATA_MAPS, DATA_MODEL, DATA_FABRIC, DATA_OBJECTS,
    DATA_OBJECTS_CACHE, DATA_OBJECT_HISTORY, OBJECT_HISTORY_STORE_KEY,
    DEFAULT_FLOOR_ID, OUTSIDE_FLOOR_ID, DATA_COORDINATOR, DATA_CALIBRATION, DATA_ADAPTIVE,
    DATA_ALERTS, DATA_MOVEMENT, BACKUPS_STORE_KEY,
    SETTINGS_STORE_KEY, CALIBRATION_STORE_KEY, ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY, FABRIC_STORE_KEY,
    ALERTS_STORE_KEY, MOVEMENT_STORE_KEY,
    DATA_TRACEBACK, TRACEBACK_STORE_KEY,
    DATA_ESPRESENSE_MQTT,
)
from .calibration_store import CalibrationStore
from .fabric_truth import (
    cluster_count as _cluster_count,
    geom_bbox_m as _geom_bbox_m,
)
from .build_info import BUILD_ID, BUILD_VERSION
from .bluetooth_live import get_bluetooth_live
from .vendor_lookup import async_lookup_vendor
from .private_ble_resolver import get_resolver as _get_ble_resolver
from .ble_enrichment import enrich_object as _enrich_ble_object

_LOGGER = logging.getLogger(__name__)

# ── In-memory ring buffer for PadSpan logs ────────────────────────────────────
# Captures WARNING+ from all padspan_ha loggers so the UI can show them.
_LOG_BUFFER_SIZE = 500

# Max rotating-MAC addresses retained per tracked object.  Bounds the persisted
# cache and the live-snapshot payload (an unbounded list reached 42k addresses /
# ~900KB on a single phone, ballooning the snapshot past the websocket limit).
_ALL_ADDR_CAP = 96

# Max addresses copied onto a single advertisement's _xref.  The frontend keys
# off canonical_id; only a cosmetic detail row ever reads these, so a sample is
# enough.  Shipping the full list on 1000+ ads grew the snapshot to ~300MB.
_XREF_ADDR_SAMPLE = 8


# Retention windows offered for object history, in days.  Anything else the
# user or a hand-edited settings file supplies falls back to the default.
_OBJECT_HISTORY_DAY_CHOICES = (1, 2, 7, 14)
_OBJECT_HISTORY_DAYS_DEFAULT = 1


def _object_history_ttl_s(hass) -> int:
    """Seconds an unidentified object is kept, from the object_history_days setting.

    Identified/tagged objects never expire, so this only bounds anonymous
    rotating-MAC churn.  Longer windows are paid for on every live_snapshot
    poll, which is why this is a small fixed set of choices rather than free
    input — see the retention note in _build_live_snapshot.
    """
    days = _OBJECT_HISTORY_DAYS_DEFAULT
    try:
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            raw = st.get("object_history_days")
            if raw in _OBJECT_HISTORY_DAY_CHOICES:
                days = raw
    except Exception:
        pass
    return days * 86400


def _capped_mac_history(addrs: list) -> list:
    """De-duplicate, MAC-filter, and cap a rotating-MAC address history.

    Order is preserved and callers pass the freshest addresses first, so the
    retained head is the most recent rotations.  Stale MACs are no longer
    broadcast, making the dropped tail unreachable anyway.

    The MAC-shape filter also scrubs historic cache entries poisoned with key
    strings ("ibeacon:...") appended by older merge code.
    """
    return [
        a for a in dict.fromkeys(addrs)
        if isinstance(a, str) and len(a) == 17 and a.count(":") == 5
    ][:_ALL_ADDR_CAP]


class _RingLogHandler(logging.Handler):
    """Captures log records into a bounded list for UI display."""
    def __init__(self, maxlen: int = _LOG_BUFFER_SIZE) -> None:
        super().__init__(level=logging.DEBUG)
        self._maxlen = maxlen
        self.records: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        entry = {
            "ts": record.created,
            "level": record.levelname,
            "logger": record.name.replace("custom_components.padspan_ha.", ""),
            "message": self.format(record),
        }
        self.records.append(entry)
        if len(self.records) > self._maxlen:
            self.records = self.records[-self._maxlen:]

_log_handler: _RingLogHandler | None = None

def _ensure_log_handler() -> _RingLogHandler:
    global _log_handler
    if _log_handler is None:
        _log_handler = _RingLogHandler()
        _log_handler.setFormatter(logging.Formatter("%(message)s"))
        # Attach to the padspan_ha root logger to capture all sub-modules
        root = logging.getLogger("custom_components.padspan_ha")
        root.addHandler(_log_handler)
    return _log_handler


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
    websocket_api.async_register_command(hass, ws_positioning_repair)
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
    websocket_api.async_register_command(hass, ws_beacon_positions_get)
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
    # Phase 1: positioning fabric commands
    websocket_api.async_register_command(hass, ws_fabric_scanner_set)
    websocket_api.async_register_command(hass, ws_fabric_scanner_remove)
    websocket_api.async_register_command(hass, ws_fabric_room_add)
    websocket_api.async_register_command(hass, ws_fabric_room_remove)
    websocket_api.async_register_command(hass, ws_fabric_adjacency_set)
    websocket_api.async_register_command(hass, ws_fabric_sync_mode_set)
    # Phase 2: real-world spatial model commands
    websocket_api.async_register_command(hass, ws_fabric_scanner_position_set)
    websocket_api.async_register_command(hass, ws_fabric_floor_elevations_set)
    websocket_api.async_register_command(hass, ws_fabric_scanner_z_set)
    websocket_api.async_register_command(hass, ws_fabric_correct_room)
    websocket_api.async_register_command(hass, ws_fabric_commit_floor)
    websocket_api.async_register_command(hass, ws_fabric_floor_finalize)
    websocket_api.async_register_command(hass, ws_fabric_truth_candidates)
    websocket_api.async_register_command(hass, ws_fabric_map_align_to_stack)
    websocket_api.async_register_command(hass, ws_fabric_rf_barrier_set)
    websocket_api.async_register_command(hass, ws_fabric_rf_barrier_remove)
    websocket_api.async_register_command(hass, ws_fabric_map_transform_set)
    websocket_api.async_register_command(hass, ws_fabric_map_reanchor)
    websocket_api.async_register_command(hass, ws_fabric_migrate_from_maps)
    websocket_api.async_register_command(hass, ws_fabric_spatial_batch_save)
    websocket_api.async_register_command(hass, ws_occupancy_estimate)
    websocket_api.async_register_command(hass, ws_occupancy_train)
    websocket_api.async_register_command(hass, ws_fabric_health)
    websocket_api.async_register_command(hass, ws_fabric_resync)
    websocket_api.async_register_command(hass, ws_radio_audit)
    websocket_api.async_register_command(hass, ws_fabric_reset_spatial)
    websocket_api.async_register_command(hass, ws_device_registry_list)
    websocket_api.async_register_command(hass, ws_device_registry_migrate)
    websocket_api.async_register_command(hass, ws_device_registry_merge)
    websocket_api.async_register_command(hass, ws_device_registry_resolve)
    websocket_api.async_register_command(hass, ws_device_registry_label_set)
    websocket_api.async_register_command(hass, ws_device_registry_add_identity)
    websocket_api.async_register_command(hass, ws_device_registry_delete)
    websocket_api.async_register_command(hass, ws_espresense_companion_import)
    # Forensics (opt-in time-window presence queries; Pro licence gated)
    websocket_api.async_register_command(hass, ws_forensics_query)
    websocket_api.async_register_command(hass, ws_forensics_stats)
    websocket_api.async_register_command(hass, ws_forensics_clear)
    websocket_api.async_register_command(hass, ws_forensics_license_activate)
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

@websocket_api.websocket_command({"type": "padspan_ha/room_tags"})
@websocket_api.async_response
async def ws_room_tags(hass: HomeAssistant, connection, msg) -> None:
    """
    Return the room→object map used by the UI.

    Important behavior:
      - Always prefer the saved/coordinator room_tag_map when it exists (this is the user's curated model).
      - In live mode, also return the best-effort *derived* map from HA Areas/entities for debugging,
        but do not let it collapse the UI to a single room if Areas aren't set up.
    """
    settings = _get_settings(hass)

    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    saved_map = coord.room_tag_map if coord else {}

    if settings.get("data_mode") == "live":
        snap = await _live_snapshot(hass)
        live_map = snap.get("room_tag_map", {}) or {}
        # If the user has a saved map, keep UI stable by using it.
        effective = saved_map if saved_map else live_map
        connection.send_result(
            msg["id"],
            {
                "room_tag_map": effective,
                "room_tag_map_saved": saved_map,
                "room_tag_map_live": live_map,
                "live": True,
                "sources": snap.get("sources", {}) or {},
                "raw_counts": snap.get("raw_counts", {}) or {},
            },
        )
        return

    connection.send_result(msg["id"], {"room_tag_map": saved_map, "live": False})


@websocket_api.websocket_command({"type": "padspan_ha/auto_diagnostics"})
@websocket_api.async_response
async def ws_auto_diagnostics(hass: HomeAssistant, connection, msg) -> None:
    """Run quick health checks and return pass/fail with recommendations.

    Checks: coordinator presence, room_tag_map population, last_error state.
    Used by the Manage → Diagnostics panel to show at-a-glance system health.
    """
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    checks = []
    recs = []
    ok = True

    if not coord:
        ok = False
        checks.append({"name": "coordinator", "ok": False, "detail": "Coordinator missing"})
        recs.append("Restart Home Assistant after installing the integration.")
    else:
        checks.append({"name": "coordinator", "ok": True, "detail": "Coordinator present"})
        # Rooms can be defined two ways: the curated room_tag_map (object→room
        # overlay, optional) or room boundaries drawn on floor-plan maps (the
        # primary model).  Only fail when NEITHER exists — an empty room_tag_map
        # is fine when the map model already has rooms, so this stops the check
        # crying wolf on map-only setups.
        room_count = len(coord.room_tag_map or {})
        room_source = "room_tag_map"
        if not room_count:
            try:
                maps_store = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
                if maps_store:
                    _rooms: set[str] = set()
                    for _m in (maps_store.list_maps() or []):
                        _rooms |= set((_m.get("room_bounds") or {}).keys())
                    room_count = len(_rooms)
                    room_source = "map room boundaries"
            except Exception:  # noqa: BLE001 — diagnostics must never raise
                pass
        if room_count:
            checks.append({"name": "room_tag_map", "ok": True, "detail": f"{room_count} rooms loaded ({room_source})"})
        else:
            checks.append({"name": "room_tag_map", "ok": False, "detail": "No room/tag data loaded"})
            recs.append("Draw room boundaries on a floor plan (Maps tab) or set a room_tag_map.")
            ok = False
        if coord.last_error:
            checks.append({"name": "last_error", "ok": False, "detail": coord.last_error})
            recs.append("Fix the last_error and re-run diagnostics.")
            ok = False
        else:
            checks.append({"name": "last_error", "ok": True, "detail": "No errors recorded"})

    summary = {
        "total": len(checks),
        "passed": sum(1 for c in checks if c["ok"]),
        "failed": sum(1 for c in checks if not c["ok"]),
        "ok": ok,
    }

    connection.send_result(msg["id"], {
        "version": VERSION,
        "summary": summary,
        "checks": checks,
        "recommendations": recs,
    })

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
            {"id": f.floor_id, "name": f.name}
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
                for _k in ("floor_to_floor_m", "base_elevation_m"):
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
    scanner_positions_m = mdl.data.get("scanner_positions_m", {}) if mdl else {}
    room_geometry_m = mdl.room_geometry_m() if mdl else {}
    rf_barriers_m = mdl.data.get("rf_barriers_m", []) if mdl else []
    map_transforms = mdl.data.get("map_transforms", {}) if mdl else {}
    beacon_positions_m = mdl.data.get("beacon_positions_m", {}) if mdl else {}
    _fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    fabric_floors = _fab.floors_status() if _fab else {}

    connection.send_result(msg["id"], {
        "floors": floors, "areas": areas, "room_meta": room_meta,
        "scanners": scanners, "room_adjacency": room_adjacency,
        "fabric_sync_mode": fabric_sync_mode,
        "scanner_positions_m": scanner_positions_m,
        "room_geometry_m": room_geometry_m,
        "rf_barriers_m": rf_barriers_m,
        "map_transforms": map_transforms,
        "beacon_positions_m": beacon_positions_m,
        "fabric_floors": fabric_floors,
        "floor_elevations": _mdl_el.floor_base_elevations_m() if _mdl_el else {},
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

@callback
def _get_settings(hass: HomeAssistant) -> dict:
    """Read current settings, defaulting to sample mode if store isn't loaded."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        return dict(st.data)
    return {"data_mode": "sample"}

def _padspan_pro_active(hass: HomeAssistant) -> bool:
    """Return True if a PadSpan Pro licence key has been activated.

    Shared gate for every PadSpan Pro feature (Forensics, Lights map
    placement, ...) — they all key off the single licence activated via
    padspan_ha/forensics_license_activate.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        return False
    return bool(str(st.data.get("forensics_license_key") or "").strip())

def _is_rpa_addr(address: str) -> bool:
    """Return True if a BLE address is a Resolvable Private Address (rotating MAC).

    CAUTION: this MSB heuristic is only meaningful for addresses that are
    actually of the *random* type.  HA's snapshot does not expose the HCI
    address-type bit, so any PUBLIC IEEE-assigned MAC whose OUI starts with
    0x40-0x7F (~25% of vendor space, e.g. 48:87:2D = Shen Zhen Da Xia "DX"
    beacons) false-positives here.  Callers must not treat a True result as
    proof of rotation on its own — see the named-device exemption in the
    objects build and the same-OUI guard in the iBeacon split.
    """
    try:
        msb = int(address.upper().split(":")[0], 16)
        return (msb & 0xC0) == 0x40
    except Exception:
        return False


# iBeacon UUIDs that ship as factory defaults on cheap beacon hardware.
# Beacons sold in multi-packs all broadcast the same uuid:major:minor out of
# the box, so these UUIDs must never be trusted as a unique device identity —
# the simultaneous-MAC split below always separates them per MAC.
_DEFAULT_IBEACON_UUIDS = frozenset({
    "e2c56db5-dffb-48d2-b060-d0f5a71096e0",  # AprilBrother / textbook demo UUID (DX CP27 and many clones)
    "fda50693-a4e2-4fb1-afcf-c6eb07647825",  # common Chinese default (HM-10 clones, iTag)
    "b9407f30-f5f8-466e-aff9-25556b57fe6d",  # Estimote factory default
    "f7826da6-4fa2-4e98-8024-bc5b71e0893e",  # Kontakt.io factory default
    "74278bda-b644-4520-8f0c-720eaf059935",  # Glimworm / generic example UUID
})


# ── Live Snapshot ──────────────────────────────────────────────────────────────
# This is the MAIN data pipeline: assembles everything the UI needs from HA state,
# BLE advertisements, device/entity registries, calibration, and object history.
# Called every 5s by the panel's poll loop and on demand by other handlers.

_SNAPSHOT_CACHE_TTL_S = 2.0
_DATA_SNAPSHOT_CACHE = "snapshot_cache"
_DATA_SNAPSHOT_CACHE_LOCK = "snapshot_cache_lock"


def _invalidate_snapshot_cache(hass: HomeAssistant) -> None:
    """Drop the cached live snapshot so the next fetch rebuilds.

    Called by mutating handlers whose effect the panel re-reads immediately
    (labels, radio areas, settings) — without this, a rename could appear to
    do nothing until the cache TTL expires.
    """
    hass.data.get(DOMAIN, {}).pop(_DATA_SNAPSHOT_CACHE, None)


async def _live_snapshot(hass: HomeAssistant) -> dict:
    """Return the live snapshot, serving a shared cached build when fresh.

    The full pipeline (_build_live_snapshot) is expensive and is invoked by the
    panel poll (per connected client), the presence coordinator, and several
    handlers — often within the same second.  A short TTL collapses those into
    a single build; the lock prevents concurrent duplicate builds.

    IMPORTANT: the returned dict is SHARED between callers.  Treat it as
    read-only — copy any dict (including the object dicts in objects.list)
    before mutating it, as ws_live_snapshot does.
    """
    dom = hass.data.setdefault(DOMAIN, {})
    cached = dom.get(_DATA_SNAPSHOT_CACHE)
    if cached and (time.monotonic() - cached[0]) < _SNAPSHOT_CACHE_TTL_S:
        return cached[1]
    lock = dom.get(_DATA_SNAPSHOT_CACHE_LOCK)
    if lock is None:
        lock = dom[_DATA_SNAPSHOT_CACHE_LOCK] = asyncio.Lock()
    async with lock:
        cached = dom.get(_DATA_SNAPSHOT_CACHE)
        if cached and (time.monotonic() - cached[0]) < _SNAPSHOT_CACHE_TTL_S:
            return cached[1]
        snap = await _build_live_snapshot(hass)
        dom[_DATA_SNAPSHOT_CACHE] = (time.monotonic(), snap)
        return snap


async def _build_live_snapshot(hass: HomeAssistant) -> dict:
    """Build a comprehensive snapshot of all PadSpan-relevant HA data.

    Discovers:
      - BLE scanners (radios) and advertisements from bluetooth_live
      - Rooms from the HA Area Registry
      - Tag/entity candidates (Bermuda, device_tracker, sensor)
      - BLE objects grouped by identity (MAC, iBeacon, private_ble/IRK)
      - Room assignments via RSSI-to-scanner-area mapping
      - Object history cache (7-day rolling, disk-backed)
      - Traceback position recording for playback

    IMPORTANT: This function must never raise.  If any subsection fails, it
    logs and continues so the UI always gets a renderable (possibly sparse) result.
    """
    snapshot: dict[str, Any] = {
        "source": "live",
        "generated_at": dt_util.utcnow().isoformat(),
        "rooms_discovered": [],
        "receivers": [],
        "tags": [],
        "room_tag_map": {},
        "room_tag_map_live": {},
        "room_tag_map_missing": {},
        "room_tag_map_saved": {},
        "raw_counts": {},
    }

    # --- Bluetooth (scanners + advertisements) ---
    # Fetched FIRST because downstream sections (objects, room assignment) depend on it.
    try:
        bl = get_bluetooth_live(hass)
        if bl is not None:
            # Max age is user-configurable (Settings → Presence).  Clamped to [60s, 4h].
            _ble_age = 14400
            try:
                _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _v = ((_st.data if _st else {}).get("ble_max_age_s"))
                if _v is not None:
                    _ble_age = max(60, min(14400, int(_v)))
            except Exception:
                pass
            snapshot["ble"] = bl.get_snapshot(max_ads=5000, max_age_s=_ble_age)
        else:
            snapshot["ble"] = {"radios": [], "advertisements": [], "diag": {"ok": False, "errors": ["no_bluetooth_live"]}}
    except Exception as e:
        snapshot["ble"] = {"radios": [], "advertisements": [], "diag": {"ok": False, "errors": ["ble_snapshot_error"]}}


    # --- ESPresense MQTT (merge into BLE snapshot if enabled) ---
    try:
        esp_mqtt = hass.data.get(DOMAIN, {}).get(DATA_ESPRESENSE_MQTT)
        if esp_mqtt is not None:
            esp_snap = esp_mqtt.get_snapshot(max_age_s=_ble_age if "_ble_age" in dir() else 900)
            ble = snapshot.setdefault("ble", {"radios": [], "advertisements": [], "diag": {}})
            ble["radios"].extend(esp_snap.get("radios", []))
            ble["advertisements"].extend(esp_snap.get("advertisements", []))
            ble["diag"]["espresense"] = esp_snap.get("diag", {})
            # Re-sort merged advertisements by age
            ble["advertisements"].sort(key=lambda x: x.get("age_s", 1e9))
    except Exception:
        pass

    # --- Areas (rooms) ---
    area_by_id: dict[str, str] = {}
    try:
        ar = area_registry.async_get(hass)
        area_by_id = {a.id: a.name for a in ar.async_list_areas()}
        snapshot["rooms_discovered"] = sorted(area_by_id.values())
    except Exception:
        pass

    # --- Find Bermuda config entries (if installed) ---
    # Bermuda is a popular BLE presence integration.  We auto-detect its entities
    # as "tag candidates" unless the user has set bermuda_ignore=true.
    bermuda_entry_ids: set[str] = set()
    _bermuda_ignore = False
    try:
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if _st and _st.get("bermuda_ignore"):
            _bermuda_ignore = True
    except Exception:
        pass
    # Always discover Bermuda entry IDs (needed for both include and exclude logic)
    _all_bermuda_entry_ids: set[str] = set()
    try:
        for ent in hass.config_entries.async_entries():
            if ent.domain == "bermuda":
                _all_bermuda_entry_ids.add(ent.entry_id)
    except Exception:
        pass
    if not _bermuda_ignore:
        bermuda_entry_ids = set(_all_bermuda_entry_ids)

    # --- Receivers (devices belonging to Bermuda entries) ---
    try:
        dr = device_registry.async_get(hass)
        receivers: list[dict[str, Any]] = []
        for dev in dr.devices.values():
            if bermuda_entry_ids and any(entry_id in bermuda_entry_ids for entry_id in dev.config_entries):
                receivers.append(
                    {
                        "id": dev.id,
                        "name": dev.name_by_user or dev.name or dev.model or "Receiver",
                        "manufacturer": dev.manufacturer or "",
                        "model": dev.model or "",
                        "sw_version": dev.sw_version or "",
                    }
                )
        snapshot["receivers"] = sorted(receivers, key=lambda d: (d.get("name") or "").lower())
    except Exception:
        snapshot["receivers"] = []

    # --- Tag candidates + room mapping ---
    # Walk every HA entity and heuristically determine which ones represent
    # BLE trackable objects and which room they're currently in.
    er = entity_registry.async_get(hass)

    def _norm(s: str) -> str:
        """Case-fold + strip for fuzzy room name matching."""
        return (s or "").strip().casefold()

    known_rooms = {_norm(r): r for r in snapshot.get("rooms_discovered", [])}

    def _room_from_state(entity_id: str, st: State) -> str | None:
        """Determine which room an entity is in, trying 4 strategies in priority order."""
        # 1) state string equals a room name
        room = known_rooms.get(_norm(st.state))
        if room:
            return room

        # 2) explicit attribute hints
        for key in ("room", "area", "area_name"):
            v = st.attributes.get(key)
            if isinstance(v, str):
                room = known_rooms.get(_norm(v))
                if room:
                    return room

        # 3) entity registry area assignment
        ent = er.async_get(entity_id)
        if ent and ent.area_id and ent.area_id in area_by_id:
            return area_by_id[ent.area_id]

        # 4) attribute area_id
        aid = st.attributes.get("area_id")
        if isinstance(aid, str) and aid in area_by_id:
            return area_by_id[aid]

        return None

    def _is_candidate(entity_id: str, st: State) -> bool:
        """Return True if the entity looks like a BLE presence-tracking entity.

        Accepts: Bermuda config_entry entities, entities with *_area_last_seen
        naming patterns, entities with receiver/rssi/distance attributes, and
        entities with bluetooth-ish keywords in their entity_id or name.
        """
        ent = er.async_get(entity_id)
        # When bermuda_ignore is on, reject any entity from a Bermuda config entry
        if _bermuda_ignore and ent and ent.config_entry_id in _all_bermuda_entry_ids:
            return False
        if ent and ent.config_entry_id in bermuda_entry_ids:
            return True

        dom = entity_id.split('.', 1)[0]
        if dom not in ('device_tracker', 'sensor', 'binary_sensor', 'tag', 'text_sensor'):
            return False

        n = _norm(getattr(st, 'name', '') or st.attributes.get('friendly_name', ''))
        eidn = _norm(entity_id)

        # Strong patterns for 'current room/area' entities (Bermuda-style and similar).
        if any(p in eidn for p in ('_area_last_seen', 'area_last_seen', '_room_last_seen', 'room_last_seen', 'nearest_area', 'nearest_room')):
            return True
        if 'last_seen' in eidn and ('area' in eidn or 'room' in eidn):
            return True

        # Attribute hints (many BLE/RTLS integrations expose receiver/rssi fields).
        for k in ('nearest_receiver', 'receiver', 'receivers', 'rssi', 'distance', 'gateway', 'bermuda'):
            if k in (st.attributes or {}):
                return True

        # Bluetooth-ish heuristics (fallback).
        return any(k in eidn for k in ('ble', 'bluetooth', 'bermuda', 'tag', 'beacon')) or any(
            k in n for k in ('ble', 'bluetooth', 'bermuda', 'tag', 'beacon')
        )

    def _looks_like_room_tracker(entity_id: str, st: State) -> bool:
        """Safety net for live mode: accept entities whose id/attrs look like location trackers."""
        eidn = _norm(entity_id)
        if any(p in eidn for p in ('_area_last_seen', 'area_last_seen', '_room_last_seen', 'room_last_seen', 'nearest_area', 'nearest_room')):
            return True
        if 'last_seen' in eidn and ('area' in eidn or 'room' in eidn):
            return True
        for k in ('nearest_receiver', 'receiver', 'receivers', 'rssi', 'distance', 'gateway'):
            if k in (st.attributes or {}):
                return True
        return False

    tags: list[dict[str, Any]] = []
    room_tag_map_live: dict[str, list[str]] = {r: [] for r in (snapshot.get('rooms_discovered') or [])}
    room_tag_map_missing: dict[str, list[str]] = {r: [] for r in (snapshot.get('rooms_discovered') or [])}

    # --- Saved (configured) room→tag map (from coordinator) ---
    # In many setups, you curate your rooms/tags here. We keep this separately
    # from live-discovered tags so 'live' views don't get polluted by placeholders.
    saved_room_tag_map: dict[str, list[str]] = {r: [] for r in (snapshot.get('rooms_discovered') or [])}
    try:
        coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
        if coord and getattr(coord, 'room_tag_map', None):
            saved_room_tag_map = {str(k): list(v) for k, v in (coord.room_tag_map or {}).items() if isinstance(v, (list, tuple))}
    except Exception:
        saved_room_tag_map = {}
    def _resolve_saved_entity_id(tag_id: str) -> str:
        """Resolve a saved tag ID (which may be a tag.* placeholder) to a real HA entity.

        The coordinator's room_tag_map may contain tag.* entries from sample mode
        or user configuration.  We try common Bermuda/BLE naming patterns and
        finally do a fuzzy search across all HA states.
        """
        if hass.states.get(tag_id):
            return tag_id
        if "." not in tag_id:
            return tag_id
        dom, obj = tag_id.split(".", 1)
        if dom != "tag":
            return tag_id

        # Common Bermuda / presence naming patterns
        guesses = [
            f"sensor.{obj}_area_last_seen",
            f"sensor.{obj}_area",
            f"sensor.{obj}_room",
            f"device_tracker.{obj}",
            f"text_sensor.{obj}_area_last_seen",
            f"text_sensor.{obj}_area",
        ]
        for g in guesses:
            if hass.states.get(g):
                return g

        # Fuzzy fallback: find an entity id containing the object id
        objn = _norm(obj)
        for st in hass.states.async_all():
            eidn = _norm(st.entity_id)
            if objn and objn in eidn and any(k in eidn for k in ("area", "room", "bermuda", "ble", "beacon", "tag")):
                return st.entity_id

        return tag_id

    cand = 0
    mapped = 0

    try:
        for st in hass.states.async_all():
            entity_id = st.entity_id

            # Skip our own derived sensor/tracker entities (area, distance) — they are
            # characteristics of BLE objects already in section B/C of the objects list.
            # Including them would show "Dog Distance" and "Dog Area" as separate "objects".
            try:
                _ent_entry = er.async_get(entity_id)
                if _ent_entry and _ent_entry.platform == DOMAIN:
                    continue
            except Exception:
                pass

            # Determine room/area first (state often contains the room name).
            room = _room_from_state(entity_id, st)
            if not room:
                continue

            # Candidate filter: accept Bermuda (by config_entry), common '*_area_last_seen' patterns, or receiver/rssi hints.
            if not (_is_candidate(entity_id, st) or _looks_like_room_tracker(entity_id, st)):
                continue
            cand += 1

            tag_label = st.attributes.get('friendly_name') or entity_id.split('.', 1)[-1]

            extra: dict[str, Any] = {}
            for k in ('nearest_receiver', 'receiver', 'rssi', 'distance', 'gateway',
                       'mac_address', 'address', 'mac', 'scanner', 'scanners'):
                if k in (st.attributes or {}):
                    extra[k] = st.attributes.get(k)

            tags.append({
                'entity_id': entity_id,
                'name': str(tag_label),
                'room': room,
                'state': st.state,
                **extra,
            })

            room_tag_map_live.setdefault(room, []).append(entity_id)
            mapped += 1
    except Exception:
        # If anything weird happens, keep the UI alive with whatever we collected.
        pass

    # --- Merge in configured tags (even if heuristics didn't find them) ---
    saved_total = 0
    saved_found = 0
    saved_missing = 0
    try:
        for room, ids in (saved_room_tag_map or {}).items():
            if not isinstance(ids, (list, tuple)):
                continue
            for tag_id in ids:
                if not isinstance(tag_id, str):
                    continue
                saved_total += 1
                resolved = _resolve_saved_entity_id(tag_id)
                st = hass.states.get(resolved)
                if st is None:
                    saved_missing += 1
                    tags.append(
                        {
                            "entity_id": resolved,
                            "name": tag_id,
                            "room": room,
                            "state": "unavailable",
                            "missing": True,
                            "source": "saved_map",
                        }
                    )
                    room_tag_map_missing.setdefault(room, []).append(resolved)
                    mapped += 1
                    continue

                saved_found += 1
                label = st.attributes.get("friendly_name") or getattr(st, "name", None) or tag_id
                tags.append(
                    {
                        "entity_id": resolved,
                        "name": str(label),
                        "room": room,
                        "state": st.state,
                        "source": "saved_map",
                    }
                )
                room_tag_map_live.setdefault(room, []).append(resolved)
                mapped += 1
    except Exception:
        pass

    # De-dupe tags by entity_id while keeping first occurrence
    seen = set()
    deduped: list[dict[str, Any]] = []
    for t in tags:
        eid = t.get("entity_id")
        if eid in seen:
            continue
        seen.add(eid)
        deduped.append(t)

    snapshot["tags"] = deduped
    snapshot["room_tag_map_saved"] = saved_room_tag_map
    snapshot["room_tag_map_missing"] = room_tag_map_missing
    snapshot["room_tag_map_live"] = room_tag_map_live
    snapshot["room_tag_map"] = room_tag_map_live
    snapshot["raw_counts"] = {
        "areas": len(snapshot.get("rooms_discovered") or []),
        "receivers": len(snapshot.get("receivers") or []),
        "candidate_entities": cand,
        "mapped_entities": mapped,
        "saved_entities_total": saved_total if 'saved_total' in locals() else 0,
        "saved_entities_found": saved_found if 'saved_found' in locals() else 0,
        "saved_entities_missing": saved_missing if 'saved_missing' in locals() else 0,
    }


    # NOTE: snapshot["ble"] was already set at the top of this function.
    # Do NOT overwrite it here — a second bl.get_snapshot() call could return
    # empty data if get_bluetooth_live() returns None, wiping all BLE ads.

    # Attach area_name and device_id to radios (best-effort, from HA device_registry)
    try:
        dr_ar = device_registry.async_get(hass)
        ar_reg = area_registry.async_get(hass)
        area_names = {a.id: a.name for a in ar_reg.async_list_areas()}
        # Build name → area and name → device_id lookup from all HA devices
        name_to_area: dict[str, str] = {}
        name_to_dev_id: dict[str, str] = {}
        for dev in dr_ar.devices.values():
            for cand in [dev.name_by_user, dev.name]:
                if not cand:
                    continue
                key = cand.lower()
                name_to_dev_id[key] = dev.id
                if dev.area_id:
                    area = area_names.get(dev.area_id, "")
                    if area:
                        name_to_area[key] = area
        # Match each radio source/name against HA devices
        for radio in ((snapshot.get("ble") or {}).get("radios") or []):
            src = str(radio.get("source") or "").lower()
            rname = str(radio.get("name") or "").lower()
            for key in name_to_dev_id:
                if key and (key in src or src in key or key in rname or rname in key):
                    if not radio.get("device_id"):
                        radio["device_id"] = name_to_dev_id[key]
                    if not radio.get("area_name") and key in name_to_area:
                        radio["area_name"] = name_to_area[key]
                    break
    except Exception:
        pass

    # Attach network info (IP, WiFi SSID) from entity states for each radio's device
    try:
        import re as _re
        er_net = entity_registry.async_get(hass)

        # Strategy 1: device_id based lookup (most reliable when device_id is set)
        dev_entities: dict[str, list] = {}
        for ent in er_net.entities.values():
            if ent.device_id:
                dev_entities.setdefault(ent.device_id, []).append(ent)

        # Strategy 2: entity slug prefix lookup (works even without device_id)
        # ESPHome entities follow the pattern: sensor.<slug>_ip_address, etc.
        # Build a map from slug prefix → list of entity entries
        # Radio name "Office Proxy" → slug "office_proxy"
        def _name_to_slug(name: str) -> str:
            return _re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")

        def _find_net_entities(radio: dict) -> list:
            """Find network-related entities for a radio via device_id or name/source slug."""
            candidates: list = []
            # Try device_id first
            did = radio.get("device_id")
            if did and did in dev_entities:
                candidates = dev_entities[did]
            # Fallback: search by entity slug prefix matching radio name or source
            if not candidates:
                slugs_to_try = set()
                rname = radio.get("name") or ""
                rsource = radio.get("source") or ""
                if rname:
                    slugs_to_try.add(_name_to_slug(rname))
                if rsource:
                    slugs_to_try.add(_name_to_slug(rsource))
                for slug in slugs_to_try:
                    if slug and len(slug) >= 3:
                        prefix_sensor = f"sensor.{slug}_"
                        prefix_text = f"text_sensor.{slug}_"
                        for ent in er_net.entities.values():
                            eid = ent.entity_id or ""
                            if eid.startswith(prefix_sensor) or eid.startswith(prefix_text):
                                candidates.append(ent)
                    if candidates:
                        break
            return candidates

        def _apply_net_info(radio: dict, entities: list) -> None:
            for ent in entities:
                eid = ent.entity_id or ""
                eid_lower = eid.lower()
                st = hass.states.get(eid)
                if not st or st.state in ("unknown", "unavailable", ""):
                    continue
                val = st.state
                # IP address sensor
                if not radio.get("ip") and ("ip_address" in eid_lower or eid_lower.endswith("_ip")):
                    radio["ip"] = val
                # WiFi SSID sensor
                elif not radio.get("ssid") and ("ssid" in eid_lower):
                    radio["ssid"] = val
                # WiFi signal strength
                elif not radio.get("wifi_signal") and ("wifi_signal" in eid_lower or "signal_strength" in eid_lower):
                    try:
                        radio["wifi_signal"] = int(float(val))
                    except (ValueError, TypeError):
                        pass
                # Connection type (wired/wireless)
                elif not radio.get("connection_type") and ("connection_type" in eid_lower or "network_type" in eid_lower):
                    radio["connection_type"] = val

        for radio in ((snapshot.get("ble") or {}).get("radios") or []):
            ents = _find_net_entities(radio)
            if ents:
                _apply_net_info(radio, ents)
    except Exception:
        pass

    # Mark radios flagged as "lost" or "disabled" in PadSpan settings.
    # These sources are excluded from location math downstream (per-object
    # per-scanner RSSI maps + strongest-scanner fallback room assignment),
    # but stay in the radios list so the UI can show them as lost/disabled.
    _excluded_radio_srcs: set[str] = set()
    try:
        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS, None)
        lost_set     = (_st.data.get("lost_radios",     {}) if _st else {})
        disabled_set = (_st.data.get("disabled_radios", {}) if _st else {})
        _excluded_radio_srcs = {str(s) for s in lost_set} | {str(s) for s in disabled_set}
        for radio in ((snapshot.get("ble") or {}).get("radios") or []):
            src = str(radio.get("source") or "")
            if src in lost_set:
                radio["lost"] = True
                radio["lost_since"] = lost_set[src].get("marked_at", "")
            if src in disabled_set:
                radio["disabled"] = True
                radio["disabled_since"] = disabled_set[src].get("marked_at", "")
    except Exception:
        pass

    # ---- Backwards-compatible aliases for the frontend ----
    # Some UI modules (overview, legacy panels) expect these keys.
    if "rooms" not in snapshot:
        snapshot["rooms"] = [{"name": r} for r in (snapshot.get("rooms_discovered") or [])]

    # Preserve the older "receivers" device list under a clearer name too.
    if "bermuda_devices" not in snapshot:
        snapshot["bermuda_devices"] = snapshot.get("receivers") or []

    # --- Derived "objects" list (entities + BLE addresses) ---
    # This is the core data structure the UI consumes.  It merges three sources:
    #   (A) Entity-based objects (Bermuda device_trackers, sensors with area states)
    #   (B) Raw BLE advertisement objects (deduplicated by MAC address)
    #   (B2) Private BLE objects (rotating-MAC phones merged by IRK canonical_id)
    #   (C) iBeacon objects (merged by UUID:major:minor across rotating MACs)
    # After building, we run aggressive deduplication (D1-D7) to collapse duplicates
    # from MAC rotation, multi-protocol broadcasts, and Apple continuity noise.
    try:
        dr2 = device_registry.async_get(hass)
        er2 = entity_registry.async_get(hass)

        # Build a quick map of Bluetooth address -> HA device (device_registry)
        addr_to_device: dict[str, dict[str, Any]] = {}
        for dev in dr2.devices.values():
            try:
                for (ctype, cid) in (dev.connections or set()):
                    if str(ctype) == "bluetooth" and isinstance(cid, str):
                        addr_to_device[cid.upper()] = {
                            "device_id": dev.id,
                            "name": dev.name_by_user or dev.name or dev.model or "",
                            "manufacturer": dev.manufacturer or "",
                            "model": dev.model or "",
                        }
            except Exception:
                continue

        # Map Bluetooth address -> tag entities that belong to the same HA device.
        addr_to_entities: dict[str, list[str]] = {}
        for t in (snapshot.get("tags") or []):
            eid = t.get("entity_id")
            if not eid:
                continue
            ent = er2.async_get(eid)
            if not ent or not ent.device_id:
                continue
            dev = dr2.devices.get(ent.device_id)
            if not dev:
                continue
            for (ctype, cid) in (dev.connections or set()):
                if str(ctype) == "bluetooth" and isinstance(cid, str):
                    addr_to_entities.setdefault(cid.upper(), []).append(eid)

        # Deduplicate advertisements by address (HA often reports same address via multiple scanners).
        ads = ((snapshot.get("ble") or {}).get("advertisements") or [])
        ble_by_addr: dict[str, dict[str, Any]] = {}
        for a in ads:
            addr = str(a.get("address") or "").upper()
            if not addr:
                continue
            rec = ble_by_addr.get(addr)
            if not rec:
                rec = {
                    "address": addr,
                    "name": a.get("name") or "",
                    "rssi": a.get("rssi"),
                    "last_seen": a.get("last_seen"),
                    "age_s": a.get("age_s"),
                    "sources": {},  # source_name → {"rssi": ..., "age_s": ...}
                    "connectable": a.get("connectable"),
                    # Extra fields for identification hints (mirrors HA advertisement monitor)
                    "manufacturer_data": a.get("manufacturer_data") or {},
                    "service_data": a.get("service_data") or {},
                    "service_uuids": a.get("service_uuids") or [],
                }
                ble_by_addr[addr] = rec

            src = a.get("source")
            # Scanners marked lost/disabled don't contribute to per-scanner
            # RSSI maps (excluded from location math; radios list unaffected).
            if src and str(src) not in _excluded_radio_srcs:
                src_key = str(src)
                a_rssi = a.get("rssi")
                a_age = a.get("age_s")
                prev = rec["sources"].get(src_key)
                if prev is None or (a_rssi is not None and (prev.get("rssi") is None or a_rssi > prev["rssi"])):
                    rec["sources"][src_key] = {"rssi": a_rssi, "age_s": a_age}

            # Merge identification hints (keep the richest set we have)
            try:
                # Name: prefer a real name over the MAC address
                ad_name = a.get("name") or ""
                cur_name = rec.get("name") or ""
                if ad_name and ad_name != addr and (not cur_name or cur_name == addr):
                    rec["name"] = ad_name

                md = a.get("manufacturer_data") or {}
                sd = a.get("service_data") or {}
                su = a.get("service_uuids") or []
                # Merge (not replace) so multi-protocol devices keep all data
                # e.g. same MAC broadcasting iBeacon + Eddystone
                if md:
                    rec.setdefault("manufacturer_data", {}).update(md)
                if sd:
                    rec.setdefault("service_data", {}).update(sd)
                if su:
                    existing = rec.setdefault("service_uuids", [])
                    for _u in su:
                        if _u not in existing:
                            existing.append(_u)
                # Connectable: prefer True over None
                ac = a.get("connectable")
                if ac is True or rec.get("connectable") is None:
                    rec["connectable"] = ac
            except Exception:
                pass

            # Keep the most "useful" RSSI (largest / closest to 0).
            try:
                rssi = a.get("rssi")
                if rssi is not None and (rec.get("rssi") is None or rssi > rec.get("rssi")):
                    rec["rssi"] = rssi
            except Exception:
                pass

            # Keep newest last_seen (ISO8601 string; lexicographic compare works for same-format UTC stamps)
            try:
                ls = a.get("last_seen")
                if ls and (not rec.get("last_seen") or str(ls) > str(rec.get("last_seen"))):
                    rec["last_seen"] = ls
            except Exception:
                pass

            # Keep minimum age_s (lower == newer)
            try:
                age = a.get("age_s")
                if isinstance(age, (int, float)):
                    if rec.get("age_s") is None or age < rec.get("age_s"):
                        rec["age_s"] = age
            except Exception:
                pass

        # Count how often each OUI/prefix appears (useful heuristic: repeated prefixes often mean "a bunch of the same device type").
        prefix_counts: dict[str, int] = {}
        for addr in ble_by_addr.keys():
            parts = addr.split(":")
            if len(parts) >= 3:
                pfx = ":".join(parts[:3])
                prefix_counts[pfx] = prefix_counts.get(pfx, 0) + 1

        # --- Private BLE Device / IRK resolution ---
        # Modern phones (iOS 8+, Android 8+) rotate their BLE MAC every ~15 minutes.
        # The only way to identify them stably is via an IRK (Identity Resolving Key)
        # registered in HA's private_ble_device integration or in PadSpan settings.
        # We also parse Apple iBeacon UUIDs from manufacturer_data for Companion App phones.
        canonical_by_addr: dict[str, dict[str, Any]] = {}   # addr → {canonical_id, name, kind}
        ibeacon_groups: dict[str, dict[str, Any]] = {}       # "ibeacon:uuid:major:minor" → merged group
        ibeacon_addrs: set[str] = set()                      # MAC addresses absorbed into an iBeacon group
        _resolver_diag: dict[str, Any] = {"irk_devices": 0, "resolved": 0, "ibeacon_groups": 0, "rpa_count": 0, "crypto_ok": True, "errors": []}
        try:
            from .private_ble_resolver import crypto_available as _crypto_avail
            _resolver_diag["crypto_ok"] = _crypto_avail()
            resolver = await _get_ble_resolver(hass)
            _resolver_diag["irk_devices"] = resolver.device_count
            _resolver_diag["rpa_count"] = resolver.count_rpas(ble_by_addr.keys())
            if resolver.has_devices():
                for addr, rec in ble_by_addr.items():
                    resolved = resolver.resolve_address(addr)
                    if resolved:
                        canonical_by_addr[addr] = resolved
                _resolver_diag["resolved"] = len(canonical_by_addr)
        except Exception as _res_err:
            _resolver_diag["errors"].append(f"resolver: {_res_err}")
            _LOGGER.warning("Private BLE resolver error: %s", _res_err)

        # ── MAC Rotation Bridging ─────────────────────────────────────────
        # When an RPA disappears and a new one appears with matching advertisement
        # characteristics, tentatively link them so the UI can track continuity.
        # Only runs when the user has enabled the mac_rotation_bridging setting.
        try:
            _st_bridge = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st_bridge and _st_bridge.get("mac_rotation_bridging"):
                _bridge_cache_key = "rotation_bridge_cache"
                _domain_data = hass.data.setdefault(DOMAIN, {})
                _bridge_cache: dict = _domain_data.setdefault(_bridge_cache_key, {})
                # {fingerprint_str: {"canonical": canonical_id, "addr": last_addr, "ts": timestamp}}

                import time as _time_mod
                _now_ts = _time_mod.time()
                _BRIDGE_STALE_S = 30  # only bridge if disappeared within last 30s

                # Purge stale entries (older than 30s)
                _stale_keys = [k for k, v in _bridge_cache.items() if _now_ts - v.get("ts", 0) > _BRIDGE_STALE_S]
                for _sk in _stale_keys:
                    del _bridge_cache[_sk]

                def _build_bridge_fingerprint(rec: dict) -> str | None:
                    """Build a fingerprint from advertisement characteristics."""
                    manuf = rec.get("manufacturer_data") or {}
                    company_ids = sorted(str(k) for k in manuf.keys()) if manuf else []
                    svc_uuids = sorted(rec.get("service_uuids") or [])
                    connectable = rec.get("connectable")
                    if not company_ids and not svc_uuids:
                        return None  # not enough info to fingerprint
                    return f"{','.join(company_ids)}|{','.join(svc_uuids)}|{connectable}"

                # Update cache with currently-resolved addresses (so when they disappear, we remember)
                for addr, canonical in canonical_by_addr.items():
                    rec = ble_by_addr.get(addr)
                    if rec:
                        fp = _build_bridge_fingerprint(rec)
                        if fp:
                            _bridge_cache[fp] = {
                                "canonical": canonical["canonical_id"],
                                "addr": addr,
                                "ts": _now_ts,
                            }

                # Also seed from identified/labelled rotating devices WITHOUT an
                # IRK (AirTag/SmartTag-class trackers).  These rotate their MAC
                # too but never appear in canonical_by_addr, so without this
                # they could never be bridged.  Canonical id = the labelled MAC
                # itself: the label re-apply pass looks objects up in the
                # ObjectStore by canonical_id, so a bridged rotation keeps its
                # user label.
                _obj_store_br = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
                for addr, rec in ble_by_addr.items():
                    if addr in canonical_by_addr:
                        continue  # IRK-resolved — seeded above
                    if not _is_rpa_addr(addr):
                        continue  # static MAC — nothing to bridge
                    if not (
                        addr in addr_to_device
                        or addr in addr_to_entities
                        or (_obj_store_br and _obj_store_br.get_label(addr))
                    ):
                        continue  # unidentified — no stable identity to carry over
                    _seed_age = rec.get("age_s")
                    if isinstance(_seed_age, (int, float)) and _seed_age > _BRIDGE_STALE_S:
                        continue  # long silent — outside the bridge window
                    fp = _build_bridge_fingerprint(rec)
                    if not fp:
                        continue
                    _existing = _bridge_cache.get(fp)
                    if _existing and _existing.get("canonical") != addr:
                        continue  # entry belongs to another device or a fired bridge
                    _bridge_cache[fp] = {"canonical": addr, "addr": addr, "ts": _now_ts}

                # Try to bridge unresolved RPAs
                for addr, rec in ble_by_addr.items():
                    if addr in canonical_by_addr:
                        continue  # already resolved
                    if not _is_rpa_addr(addr):
                        continue  # not a rotating address
                    fp = _build_bridge_fingerprint(rec)
                    if not fp:
                        continue
                    cached_entry = _bridge_cache.get(fp)
                    if not cached_entry:
                        continue
                    if cached_entry["addr"] == addr:
                        # Same address seen again — refresh ts so the entry
                        # doesn't purge as stale after _BRIDGE_STALE_S while
                        # the device is still advertising.
                        cached_entry["ts"] = _now_ts
                        if cached_entry["canonical"] == addr:
                            continue  # self-seeded entry — no rotation yet
                        # Previously-fired bridge: fall through and re-apply
                        # the canonical mapping (canonical_by_addr is rebuilt
                        # from scratch every snapshot).
                    # Sources is a dict {source_name: {rssi, age_s}} at this point
                    # Bridge if fingerprint matches (RSSI overlap is best-effort)
                    canonical_by_addr[addr] = {
                        "canonical_id": cached_entry["canonical"],
                        "name": cached_entry["canonical"],
                        "kind": "private_ble",
                        "bridge_match": True,
                    }
                    # Update cache with the new address
                    _bridge_cache[fp] = {
                        "canonical": cached_entry["canonical"],
                        "addr": addr,
                        "ts": _now_ts,
                    }
        except Exception as _bridge_err:
            _LOGGER.debug("MAC rotation bridging error: %s", _bridge_err)

        # Parse iBeacon from every advertisement; group by stable UUID/major/minor key.
        # This is deliberately OUTSIDE the resolver try/except so iBeacon detection
        # never gets silently skipped if the private BLE resolver has issues.
        # IMPORTANT: MACs that resolve to a private_ble device (via IRK) are NOT
        # absorbed into iBeacon groups — the IRK identity is authoritative.  The
        # iBeacon metadata (UUID/major/minor) is attached to the private_ble object
        # later instead.  This prevents the phone from existing as two separate
        # objects (one iBeacon, one private_ble) and getting "lost" on MAC rotation.
        _ibeacon_meta_for_private: dict[str, dict[str, Any]] = {}  # canonical_id → iBeacon info
        try:
            _ib_resolver = await _get_ble_resolver(hass)
            for addr, rec in ble_by_addr.items():
                ib = _ib_resolver.parse_ibeacon(rec.get("manufacturer_data") or {})
                if ib:
                    # If this MAC also resolves to a private_ble device, DON'T absorb
                    # it into the iBeacon group — let private_ble grouping handle it.
                    canonical = canonical_by_addr.get(addr)
                    if canonical:
                        cid = canonical["canonical_id"]
                        _ibeacon_meta_for_private[cid] = ib
                        continue
                    uuid_key = f"ibeacon:{ib['uuid']}:{ib['major']}:{ib['minor']}"
                    ibeacon_addrs.add(addr)
                    if uuid_key not in ibeacon_groups:
                        ibeacon_groups[uuid_key] = {
                            "uuid": ib["uuid"],
                            "major": ib["major"],
                            "minor": ib["minor"],
                            "tx_power": ib.get("tx_power"),  # factory-calibrated TX power from iBeacon payload
                            "addrs": set(),
                            "sources": [],
                            "_rssi_list": [],
                        }
                    g = ibeacon_groups[uuid_key]
                    g["addrs"].add(addr)
                    for src_key, src_info in (rec.get("sources") or {}).items():
                        g["sources"].append({"source": src_key, **(src_info if isinstance(src_info, dict) else {})})
                    rssi = rec.get("rssi")
                    if rssi is not None:
                        g["_rssi_list"].append((rssi, rec.get("age_s")))
            # Finalise each group: pick best RSSI, sort addrs, deduplicate sources
            # Split groups where multiple MACs are simultaneously active (separate
            # physical devices sharing factory-default UUID:major:minor, e.g. CP27).
            _split_groups: dict[str, dict] = {}
            for uuid_key, g in list(ibeacon_groups.items()):
                rssi_list = g.pop("_rssi_list")
                if rssi_list:
                    # age_s = freshest reading (lowest age) across all MACs.
                    # rssi  = strongest signal among recent readings (within 60s
                    #         of freshest) so stale rotated-out MACs don't win.
                    ages = [a for _, a in rssi_list if a is not None]
                    min_age = min(ages) if ages else None
                    g["age_s"] = min_age
                    if min_age is not None:
                        cutoff = min_age + 60
                        recent = [r for r, a in rssi_list if a is not None and a <= cutoff]
                        g["rssi"] = max(recent) if recent else max(r for r, _ in rssi_list)
                    else:
                        g["rssi"] = max(r for r, _ in rssi_list)
                else:
                    g["rssi"] = None; g["age_s"] = None
                g["addrs"] = sorted(g["addrs"])
                # Deduplicate sources by scanner — prefer freshest reading per
                # source (consistent with private_ble merge strategy). Stale
                # strong readings from old MACs shouldn't win over fresh ones.
                dedup_map: dict[str, dict] = {}
                for s in g["sources"]:
                    sk = s.get("source", "")
                    prev = dedup_map.get(sk)
                    if prev is None:
                        dedup_map[sk] = s
                    else:
                        s_age = s.get("age_s")
                        p_age = prev.get("age_s")
                        # Prefer fresher (lower age_s); tie-break on stronger RSSI
                        if s_age is not None and (p_age is None or s_age < p_age):
                            dedup_map[sk] = s
                        elif s_age == p_age:
                            s_rssi = s.get("rssi")
                            if s_rssi is not None and (prev.get("rssi") is None or s_rssi > prev["rssi"]):
                                dedup_map[sk] = s
                g["sources"] = sorted(dedup_map.values(), key=lambda x: x.get("source", ""))

                # Detect simultaneous MACs → split into per-MAC objects.
                # If multiple MACs are all recently seen (age < 60s), they are
                # distinct physical devices, not MAC rotation on a single device.
                # EXCEPTION: Phones rotate their MAC every ~15 min.  During the
                # rotation window both old and new MACs are age < 60s.  If ALL
                # recent MACs are RPAs (Resolvable Private Addresses = rotating),
                # they almost certainly belong to a single phone — do NOT split.
                if len(g["addrs"]) > 1:
                    recent_macs = [
                        a for a in g["addrs"]
                        if (ble_by_addr.get(a, {}).get("age_s") or 9999) < 60
                    ]
                    # Check if all recent MACs are RPAs (rotating) — if so, same device
                    _all_rpa = all(_is_rpa_addr(m) for m in recent_macs) if recent_macs else False
                    # Two overrides — these are sibling DEVICES, not one rotating phone:
                    # (1) Factory-default UUID: beacon multi-packs share uuid:major:minor
                    #     out of the box; treat each MAC as its own physical device.
                    # (2) Shared OUI: true RPA rotation randomizes the whole address, so
                    #     several simultaneously-fresh MACs inside ONE vendor OUI block
                    #     are distinct hardware. _is_rpa_addr() false-positives on public
                    #     OUIs 0x40-0x7F (e.g. DX CP27 packs, OUI 48:87:2D) — without
                    #     this guard the split is suppressed and the whole pack merges
                    #     into a single object.
                    _is_default_uuid = str(g.get("uuid") or "").lower() in _DEFAULT_IBEACON_UUIDS
                    _same_oui = len({m[:9] for m in recent_macs}) == 1 if len(recent_macs) > 1 else False
                    if _is_default_uuid or _same_oui:
                        _all_rpa = False
                    if len(recent_macs) > 1 and not _all_rpa:
                        # Multiple distinct devices — split each MAC into its own object
                        for idx, mac in enumerate(recent_macs):
                            rec = ble_by_addr.get(mac, {})
                            split_key = f"{uuid_key}:{mac}"
                            # Use the sources from this specific MAC's advertisement
                            mac_src_dict = rec.get("sources") or {}
                            mac_sources = [{"source": k, **(v if isinstance(v, dict) else {})} for k, v in mac_src_dict.items()]
                            _split_groups[split_key] = {
                                "uuid": g["uuid"],
                                "major": g["major"],
                                "minor": g["minor"],
                                "tx_power": g.get("tx_power"),
                                "addrs": [mac],
                                "sources": mac_sources,
                                "rssi": rec.get("rssi"),
                                "age_s": rec.get("age_s"),
                                "_split_from": uuid_key,
                            }
                        # Also keep stale MACs (age >= 60s) in the original group
                        stale = [a for a in g["addrs"] if a not in recent_macs]
                        if stale:
                            g["addrs"] = stale
                        else:
                            # All MACs split out — remove original group
                            del ibeacon_groups[uuid_key]
                        continue
            # Merge split groups into main dict
            ibeacon_groups.update(_split_groups)
            _resolver_diag["ibeacon_groups"] = len(ibeacon_groups)
        except Exception as _ib_err:
            _resolver_diag["errors"].append(f"ibeacon: {_ib_err}")

        # (B) BLE advertisement objects (what HA Bluetooth "Advertisement monitor" shows)
        # Group private_ble addresses by canonical_id so rotating MACs merge
        # into ONE object per physical device (like iBeacon merging above).
        # NOTE: _private_groups MUST be initialized before section A because
        # section A references it to link entity objects to private_ble devices.
        _private_groups: dict[str, dict[str, Any]] = {}  # canonical_id → merged info
        for addr, rec in ble_by_addr.items():
            if addr in ibeacon_addrs:
                continue  # absorbed into a merged iBeacon group (section C)
            canonical = canonical_by_addr.get(addr)
            if canonical:
                cid = canonical["canonical_id"]
                if cid not in _private_groups:
                    _private_groups[cid] = {
                        "canonical": canonical,
                        "addrs": [],
                        "all_sources": {},  # source_name → {"rssi": ..., "age_s": ...}
                        "all_linked": set(),
                        "best_rssi": -999,
                        "best_rec": rec,
                        "best_addr": addr,
                        "freshest_age": None,   # minimum age_s across all rotating MACs
                        "freshest_rec": None,    # record with the freshest observation
                        "device": None,
                        "manufacturer_data": {},
                        "service_data": {},
                        "service_uuids": [],
                    }
                pg = _private_groups[cid]
                pg["addrs"].append(addr)
                # Per-source merge: prefer the FRESHEST (lowest age_s) reading
                # per scanner source across all rotating MACs — not the strongest
                # RSSI, which may come from a stale MAC the phone stopped using.
                for src_key, src_info in (rec.get("sources") or {}).items():
                    prev = pg["all_sources"].get(src_key)
                    si = src_info if isinstance(src_info, dict) else {"rssi": None, "age_s": None}
                    if prev is None:
                        pg["all_sources"][src_key] = si
                    else:
                        s_age = si.get("age_s")
                        p_age = prev.get("age_s")
                        # Prefer lower age (fresher); fall back to stronger RSSI if ages equal/missing
                        if s_age is not None and (p_age is None or s_age < p_age):
                            pg["all_sources"][src_key] = si
                        elif s_age == p_age:
                            s_rssi = si.get("rssi")
                            if s_rssi is not None and (prev.get("rssi") is None or s_rssi > prev["rssi"]):
                                pg["all_sources"][src_key] = si
                for e in addr_to_entities.get(addr, []):
                    pg["all_linked"].add(e)
                # Track best RSSI for address/signal display
                rssi = rec.get("rssi")
                if rssi is not None and rssi > pg["best_rssi"]:
                    pg["best_rssi"] = rssi
                    pg["best_rec"] = rec
                    pg["best_addr"] = addr
                # Track freshest record (minimum age_s) for last_seen/age reporting.
                # This is the critical fix: a phone's newest rotating MAC has age≈0
                # even if an older MAC with stronger RSSI has age>>0.
                age = rec.get("age_s")
                if age is not None and (pg["freshest_age"] is None or age < pg["freshest_age"]):
                    pg["freshest_age"] = age
                    pg["freshest_rec"] = rec
                if not pg["device"] and addr in addr_to_device:
                    pg["device"] = addr_to_device[addr]
                # Merge BLE metadata
                pg["manufacturer_data"].update(rec.get("manufacturer_data") or {})
                pg["service_data"].update(rec.get("service_data") or {})
                for u in (rec.get("service_uuids") or []):
                    if u not in pg["service_uuids"]:
                        pg["service_uuids"].append(u)

        objects: list[dict[str, Any]] = []

        # (A) Entity-based objects (bermuda tags, device_trackers, etc.)
        _MAC_RE = __import__("re").compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")
        for t in (snapshot.get("tags") or []):
            eid = t.get("entity_id") or ""
            addr = ""
            all_addrs: list[str] = []
            canonical_id = ""
            try:
                ent = er2.async_get(eid)
                if ent and ent.device_id:
                    dev = dr2.devices.get(ent.device_id)
                    if dev:
                        # 1) Check device connections for a static BLE MAC
                        for (ctype, cid) in (dev.connections or set()):
                            if str(ctype) == "bluetooth" and isinstance(cid, str):
                                addr = cid.upper()
                                break

                        # 2) Check device identifiers — Bermuda stores MAC as
                        #    ("bermuda", "AA:BB:CC:DD:EE:FF") identifier
                        if not addr:
                            for (domain, ident) in (dev.identifiers or set()):
                                ident_s = str(ident)
                                if _MAC_RE.match(ident_s):
                                    addr = ident_s.upper()
                                    break

                        # 3) Match to private_ble objects by device_id
                        if not addr:
                            for _cid, pg in _private_groups.items():
                                _pg_dev = pg.get("device")
                                if _pg_dev and _pg_dev.get("id") == ent.device_id:
                                    canonical_id = _cid
                                    addr = pg["best_addr"].upper() if pg.get("best_addr") else ""
                                    all_addrs = sorted(pg.get("addrs") or [])
                                    break

                        # 4) Match to regular BLE objects by device_id
                        if not addr and ent.device_id:
                            for _ba, _bd in addr_to_device.items():
                                if isinstance(_bd, dict) and _bd.get("id") == ent.device_id:
                                    addr = _ba.upper()
                                    break

                # 5) Check entity state attributes for MAC address hints
                #    Bermuda entities often expose mac_address/address in attributes
                if not addr:
                    _st = hass.states.get(eid)
                    if _st:
                        for _attr_key in ("mac_address", "address", "mac"):
                            _attr_val = (_st.attributes or {}).get(_attr_key)
                            if isinstance(_attr_val, str) and _MAC_RE.match(_attr_val):
                                addr = _attr_val.upper()
                                break
            except Exception:
                addr = ""

            prefix = ":".join(addr.split(":")[:3]) if addr else ""
            _ent_obj: dict[str, Any] = {
                "key": f"entity:{eid}",
                "kind": "entity",
                "entity_id": eid,
                "name": t.get("name") or eid,
                "state": t.get("state"),
                "room": t.get("room"),
                "missing": bool(t.get("missing")),
                "address": addr or None,
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0) if prefix else 0,
                "identified": True,
            }
            if canonical_id:
                _ent_obj["canonical_id"] = canonical_id
            if all_addrs:
                _ent_obj["all_addresses"] = all_addrs
            objects.append(_ent_obj)

        # (B-cont) Regular (non-rotating, non-iBeacon) BLE advertisement objects
        for addr, rec in ble_by_addr.items():
            if addr in ibeacon_addrs:
                continue  # absorbed into a merged iBeacon group (section C)
            if canonical_by_addr.get(addr):
                continue  # handled by _private_groups (section B2)
            # Skip unresolved RPAs (rotating MACs from phones/watches that
            # aren't resolved by IRK and aren't part of an iBeacon group).
            # These are noise — duplicate entries from the same phone's non-
            # iBeacon advertisements, or from neighbors' devices.  Without
            # IRK they can't be merged and just clutter the device list.
            # EXEMPTION: keep devices that advertise a local name.  Phones'
            # rotating-RPA adverts are anonymous; a named advertiser is almost
            # always real hardware whose public OUI (0x40-0x7F first octet)
            # false-positives in _is_rpa_addr() — e.g. DX-brand 48:87:2D gear.
            if (
                _is_rpa_addr(addr)
                and addr not in addr_to_device
                and addr not in addr_to_entities
                and not str(rec.get("name") or "").strip()
            ):
                continue

            # Regular (non-rotating) BLE object
            parts = addr.split(":")
            prefix = ":".join(parts[:3]) if len(parts) >= 3 else ""
            identified = (addr in addr_to_device) or (addr in addr_to_entities)

            obj: dict[str, Any] = {
                "key": f"ble:{addr}",
                "kind": "ble",
                "address": addr,
                "name": rec.get("name") or addr,
                "rssi": rec.get("rssi"),
                "last_seen": rec.get("last_seen"),
                "age_s": rec.get("age_s"),
                "sources": sorted(
                    [{"source": k, "rssi": v.get("rssi"), "age_s": v.get("age_s")} for k, v in (rec.get("sources") or {}).items()],
                    key=lambda x: x["source"],
                ),
                "manufacturer_data": rec.get("manufacturer_data") or {},
                "service_data": rec.get("service_data") or {},
                "service_uuids": rec.get("service_uuids") or [],
                "connectable": rec.get("connectable"),
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0),
                "identified": bool(identified),
                "linked_entities": sorted(list(set(addr_to_entities.get(addr, [])))),
                "device": addr_to_device.get(addr),
            }
            objects.append(obj)

        # (B2) Merged private_ble objects — one per canonical_id (phone identity)
        for cid, pg in _private_groups.items():
            canonical = pg["canonical"]
            # Use the freshest record for age/last_seen (not the strongest RSSI record)
            # — a phone's newest rotating MAC has age≈0 but may have weaker RSSI.
            freshest = pg.get("freshest_rec")
            rec = freshest if freshest else pg["best_rec"]
            addr = pg["best_addr"]
            parts = addr.split(":")
            prefix = ":".join(parts[:3]) if len(parts) >= 3 else ""
            obj_pb: dict[str, Any] = {
                "key": cid,  # STABLE key — survives address rotation
                "kind": "private_ble",
                "address": addr,  # current best (strongest signal) rotating MAC
                "canonical_id": cid,
                "private_ble_name": canonical["name"],
                "all_addresses": sorted(pg["addrs"]),  # all rotating MACs seen this cycle
                "name": canonical.get("name") or rec.get("name") or addr,
                "rssi": pg["best_rssi"] if pg["best_rssi"] > -999 else rec.get("rssi"),
                "last_seen": rec.get("last_seen"),
                "age_s": pg["freshest_age"] if pg["freshest_age"] is not None else rec.get("age_s"),
                "sources": sorted(
                    [{"source": k, "rssi": v.get("rssi"), "age_s": v.get("age_s")} for k, v in pg["all_sources"].items()],
                    key=lambda x: x["source"],
                ),
                "manufacturer_data": pg["manufacturer_data"],
                "service_data": pg["service_data"],
                "service_uuids": pg["service_uuids"],
                "connectable": rec.get("connectable"),
                "prefix": prefix or None,
                "prefix_count": prefix_counts.get(prefix, 0),
                "identified": bool(pg["device"] or pg["all_linked"]),
                "linked_entities": sorted(pg["all_linked"]),
                "device": pg["device"],
            }
            # Mark bridge-matched objects so the UI knows they're probabilistic
            if canonical.get("bridge_match"):
                obj_pb["bridge_match"] = True
            # Attach iBeacon metadata if this private_ble device also broadcasts
            # as an iBeacon (e.g. HA Companion App "Track Phone").
            _ib_meta = _ibeacon_meta_for_private.get(cid)
            if _ib_meta:
                obj_pb["ibeacon_uuid"] = _ib_meta["uuid"]
                obj_pb["ibeacon_major"] = _ib_meta["major"]
                obj_pb["ibeacon_minor"] = _ib_meta["minor"]
                if _ib_meta.get("tx_power") is not None:
                    obj_pb["tx_power"] = _ib_meta["tx_power"]
            objects.append(obj_pb)

        # (C) iBeacon objects — one per UUID/major/minor key, merged from all rotating MACs
        _obj_store_c = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        for uuid_key, g in ibeacon_groups.items():
            all_linked: list[str] = sorted({
                e for a in g["addrs"] for e in addr_to_entities.get(a, [])
            })
            identified_ib = any(a in addr_to_device for a in g["addrs"]) or bool(all_linked)
            # Use persisted user label as display name if available (prevents flickering)
            _ib_label = None
            if _obj_store_c:
                _ib_entry = _obj_store_c.get(uuid_key)
                if _ib_entry:
                    _ib_label = _ib_entry.get("label") or None
            # Merge BLE metadata from all underlying MAC addresses so that
            # service_data (e.g. Eddystone), manufacturer_data, and service_uuids
            # are preserved on the merged iBeacon object instead of being lost.
            _ib_ble_name = None
            _ib_manuf: dict[str, Any] = {}
            _ib_svcdata: dict[str, Any] = {}
            _ib_svcuuids: list[str] = []
            _ib_connectable = None
            _ib_device = None
            for _ib_mac in (g.get("addrs") or []):
                _ib_rec = ble_by_addr.get(_ib_mac)
                if not _ib_rec:
                    continue
                _n = _ib_rec.get("name") or ""
                if _n and _n != _ib_mac and not _ib_ble_name:
                    _ib_ble_name = _n
                _ib_manuf.update(_ib_rec.get("manufacturer_data") or {})
                _ib_svcdata.update(_ib_rec.get("service_data") or {})
                for _u in (_ib_rec.get("service_uuids") or []):
                    if _u not in _ib_svcuuids:
                        _ib_svcuuids.append(_u)
                if _ib_rec.get("connectable") is True:
                    _ib_connectable = True
                elif _ib_connectable is None:
                    _ib_connectable = _ib_rec.get("connectable")
                if not _ib_device and _ib_mac in addr_to_device:
                    _ib_device = addr_to_device[_ib_mac]
            # For split groups (multiple physical devices sharing same UUID:major:minor),
            # append the MAC suffix so the user can distinguish them.
            _is_split = "_split_from" in g
            _default_name = _ib_ble_name or f"iBeacon {g['uuid'][:8]}"
            if _is_split and g["addrs"]:
                _mac_short = g["addrs"][0][-8:]  # last 8 chars of MAC (XX:XX:XX)
                _default_name = f"{_default_name} ({_mac_short})"
            obj_ib: dict[str, Any] = {
                "key": uuid_key,
                "kind": "ibeacon",
                "address": uuid_key,           # stable key — used by label store & tagging
                "all_addresses": g["addrs"],   # rotating MACs this beacon was seen from
                "name": _ib_label or _default_name,
                "ble_name": _ib_ble_name,      # original BLE broadcast name for display
                "rssi": g.get("rssi"),
                "age_s": g.get("age_s"),
                "sources": g.get("sources") or [],
                "ibeacon_uuid": g["uuid"],
                "ibeacon_major": g["major"],
                "ibeacon_minor": g["minor"],
                "tx_power": g.get("tx_power"),  # factory TX power dBm at 1m (from iBeacon payload)
                "manufacturer_data": _ib_manuf,
                "service_data": _ib_svcdata,
                "service_uuids": _ib_svcuuids,
                "connectable": _ib_connectable,
                "identified": bool(identified_ib) or bool(_ib_label),
                "linked_entities": all_linked,
                "device": _ib_device,
            }
            if _ib_label:
                obj_ib["user_label"] = _ib_label
            objects.append(obj_ib)

        # ── Apple Auto-Classification ─────────────────────────────────────
        # Decode Apple Continuity protocol messages to label devices as
        # iPhone, iPad, Apple Watch, AirPods, etc.  Display-only — does
        # not change identity or tracking.  Gated behind setting.
        try:
            _st_apple = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _st_apple and _st_apple.get("apple_auto_classify"):
                _APPLE_COMPANY_ID = "76"  # 0x004C in decimal string key
                _APPLE_SUBTYPES = {
                    0x07: "AirPods",
                    0x10: "Apple Device",  # Nearby Info — refined below by model bits
                    0x12: "AirTag",        # FindMy
                }
                _NEARBY_MODELS = {
                    # Device model bits (upper nibble of status byte) in Nearby Info
                    0x01: "iPhone",
                    0x02: "iPhone",
                    0x03: "iPad",
                    0x04: "MacBook",
                    0x05: "Apple Watch",
                    0x06: "MacBook",
                    0x07: "iPhone",
                    0x09: "MacBook",
                    0x0A: "iPad",
                    0x0B: "Apple Watch",
                    0x0C: "MacBook",
                    0x0E: "iPhone",
                    0x0F: "iPad",
                    0x10: "iPhone",
                    0x11: "MacBook",
                    0x14: "iPhone",
                }
                for obj in objects:
                    if obj.get("kind") not in ("ble", "private_ble", "ibeacon"):
                        continue
                    manuf = obj.get("manufacturer_data") or {}
                    apple_data = manuf.get(_APPLE_COMPANY_ID) or manuf.get(76)
                    if not apple_data:
                        continue
                    # apple_data may be a hex string or bytes-like; normalise to bytes
                    try:
                        if isinstance(apple_data, str):
                            _raw = bytes.fromhex(apple_data)
                        elif isinstance(apple_data, (list, tuple)):
                            _raw = bytes(apple_data)
                        elif isinstance(apple_data, bytes):
                            _raw = apple_data
                        else:
                            continue
                    except Exception:
                        continue
                    if len(_raw) < 1:
                        continue
                    subtype = _raw[0]
                    label = _APPLE_SUBTYPES.get(subtype)
                    if not label:
                        continue
                    # Refine Nearby Info (0x10) by device model bits
                    if subtype == 0x10 and len(_raw) >= 3:
                        model_bits = (_raw[2] >> 4) & 0x1F
                        label = _NEARBY_MODELS.get(model_bits, "Apple Device")
                    # FindMy (0x12) could be AirTag or third-party accessory
                    if subtype == 0x12 and len(_raw) >= 3:
                        # Byte 2 bit 0: 0 = AirTag, 1 = third-party FindMy accessory
                        if _raw[2] & 0x01:
                            label = "Find My accessory"
                    obj["auto_class"] = label
        except Exception as _apple_err:
            _LOGGER.debug("Apple auto-classify error: %s", _apple_err)

        # ── Cross-link MAC ↔ iBeacon ↔ entity for the same physical device ──
        # Build lookup maps so labels/tags propagate across all representations.
        _mac_to_ibeacon_key: dict[str, str] = {}   # MAC → ibeacon:uuid:major:minor
        _ibeacon_to_macs: dict[str, list[str]] = {}  # ibeacon key → [MAC, ...]
        for uuid_key, g in ibeacon_groups.items():
            macs = list(g.get("addrs") or [])
            _ibeacon_to_macs[uuid_key] = macs
            for mac in macs:
                _mac_to_ibeacon_key[mac] = uuid_key

        # Tag entity objects with their iBeacon key if their MAC matches
        for obj in objects:
            if obj.get("kind") == "entity":
                eaddr = (obj.get("address") or "").upper()
                ib_key = _mac_to_ibeacon_key.get(eaddr)
                if ib_key:
                    obj["ibeacon_key"] = ib_key

        # ── Merge duplicate objects that represent the same physical device ──
        # A device can broadcast multiple BLE protocols (iBeacon + Eddystone,
        # iBeacon + regular BLE, etc.) on different MACs. When they share the
        # same HA device_id, merge the secondary into the primary (iBeacon wins).
        try:
            # Index iBeacon objects by device_id and by all their MAC addresses
            _ib_by_devid: dict[str, dict[str, Any]] = {}
            _ib_by_mac: dict[str, dict[str, Any]] = {}
            for obj in objects:
                if obj.get("kind") != "ibeacon":
                    continue
                dev = obj.get("device")
                if isinstance(dev, dict) and dev.get("id"):
                    _ib_by_devid[dev["id"]] = obj
                for mac in (obj.get("all_addresses") or []):
                    _ib_by_mac[mac.upper()] = obj

            _absorbed_keys: set[str] = set()  # keys of objects merged into an iBeacon
            for obj in objects:
                if obj.get("kind") not in ("ble", "private_ble"):
                    continue
                # Match by HA device_id
                target_ib = None
                dev = obj.get("device")
                if isinstance(dev, dict) and dev.get("id"):
                    target_ib = _ib_by_devid.get(dev["id"])
                # Match by MAC address overlap
                if not target_ib:
                    obj_addr = (obj.get("address") or "").upper()
                    if obj_addr:
                        target_ib = _ib_by_mac.get(obj_addr)
                    if not target_ib:
                        for mac in (obj.get("all_addresses") or []):
                            target_ib = _ib_by_mac.get(mac.upper())
                            if target_ib:
                                break
                if not target_ib:
                    continue
                # Merge: fold BLE/private_ble data into the iBeacon object
                _absorbed_keys.add(obj.get("key", ""))
                # Merge metadata (don't overwrite existing non-empty fields)
                for _mf in ("manufacturer_data", "service_data"):
                    src_d = obj.get(_mf) or {}
                    if src_d:
                        target_ib.setdefault(_mf, {}).update(src_d)
                for _u in (obj.get("service_uuids") or []):
                    target_uuids = target_ib.setdefault("service_uuids", [])
                    if _u not in target_uuids:
                        target_uuids.append(_u)
                # Merge MAC addresses
                for _ma in (obj.get("all_addresses") or [obj.get("address")]):
                    if _ma:
                        existing_addrs = list(target_ib.get("all_addresses") or [])
                        if _ma not in existing_addrs:
                            existing_addrs.append(_ma)
                        target_ib["all_addresses"] = sorted(existing_addrs)
                # Merge linked entities
                for _le in (obj.get("linked_entities") or []):
                    existing_le = target_ib.setdefault("linked_entities", [])
                    if _le not in existing_le:
                        existing_le.append(_le)
                # Merge sources
                existing_srcs = target_ib.get("sources") or []
                for _s in (obj.get("sources") or []):
                    sk = _s.get("source") if isinstance(_s, dict) else str(_s)
                    if sk not in {(s.get("source") if isinstance(s, dict) else str(s)) for s in existing_srcs}:
                        existing_srcs.append(_s)
                target_ib["sources"] = existing_srcs
                # Prefer better RSSI
                if obj.get("rssi") is not None:
                    if target_ib.get("rssi") is None or obj["rssi"] > target_ib["rssi"]:
                        target_ib["rssi"] = obj["rssi"]
                        target_ib["age_s"] = obj.get("age_s")
                # Connectable
                if obj.get("connectable") is True:
                    target_ib["connectable"] = True
                # Device info
                if not target_ib.get("device") and obj.get("device"):
                    target_ib["device"] = obj["device"]
                # BLE name
                obj_name = obj.get("name") or ""
                if obj_name and obj_name != obj.get("address") and not target_ib.get("ble_name"):
                    target_ib["ble_name"] = obj_name
                # Mark iBeacon as identified if the absorbed object was
                if obj.get("identified"):
                    target_ib["identified"] = True
                # Track merged protocols
                _merged = target_ib.setdefault("merged_protocols", ["ibeacon"])
                obj_kind = obj.get("kind", "ble")
                if obj_kind not in _merged:
                    _merged.append(obj_kind)

            # Remove absorbed objects from the list
            if _absorbed_keys:
                objects = [o for o in objects if o.get("key", "") not in _absorbed_keys]
        except Exception as _merge_err:
            _LOGGER.debug("Object merge error: %s", _merge_err)

        # ── Aggressive beacon deduplication (D1–D7) ─────────────────────────
        # A typical home sees 200-700+ BLE addresses, many of which are the same
        # physical device broadcasting under different MACs or protocols.
        # Strategies (in order):
        #   D1: Entity absorbs its raw BLE counterpart (same MAC)
        #   D2: Eddystone-UID namespace grouping (same namespace+instance)
        #   D3: Same BLE broadcast name on random MACs
        #   D4: Identical manufacturer_data fingerprint (excl. Apple continuity)
        #   D5: Apple continuity subtype + same scanner set
        #   D6: Identical service_uuids + same scanner set
        #   D7: Bare random MACs with zero distinguishing data → collapse by scanner set
        # Runs twice: once on current objects, again after cache reintroduction.
        _dedup_absorbed: set[str] = set()

        # Helper: merge obj_src into obj_dst (like the iBeacon merge above)
        def _merge_into(dst: dict, src: dict) -> None:
            for _mf in ("manufacturer_data", "service_data"):
                sd = src.get(_mf) or {}
                if sd:
                    dst.setdefault(_mf, {}).update(sd)
            for _u in (src.get("service_uuids") or []):
                tl = dst.setdefault("service_uuids", [])
                if _u not in tl:
                    tl.append(_u)
            # all_addresses holds MAC addresses ONLY.  For ibeacon/private_ble
            # objects the "address" field is a key string ("ibeacon:uuid:...")
            # — appending those poisons the list (and the 7-day cache) with
            # pseudo-addresses that later match nothing.
            def _is_mac(s: Any) -> bool:
                return isinstance(s, str) and len(s) == 17 and s.count(":") == 5
            ea = [a for a in dst.setdefault("all_addresses", []) if _is_mac(a)]
            if _is_mac(dst.get("address")) and dst["address"] not in ea:
                ea.append(dst["address"])
            for _ma in (src.get("all_addresses") or [src.get("address")]):
                if _is_mac(_ma) and _ma not in ea:
                    ea.append(_ma)
            dst["all_addresses"] = sorted(ea)
            for _le in (src.get("linked_entities") or []):
                el2 = dst.setdefault("linked_entities", [])
                if _le not in el2:
                    el2.append(_le)
            es = dst.setdefault("sources", [])
            es_set = {(s.get("source") if isinstance(s, dict) else str(s)) for s in es}
            for _s in (src.get("sources") or []):
                sk = _s.get("source") if isinstance(_s, dict) else str(_s)
                if sk not in es_set:
                    es.append(_s)
                    es_set.add(sk)
            if src.get("rssi") is not None:
                if dst.get("rssi") is None or src["rssi"] > dst["rssi"]:
                    dst["rssi"] = src["rssi"]
                    dst["age_s"] = src.get("age_s")
            if src.get("connectable") is True:
                dst["connectable"] = True
            if not dst.get("device") and src.get("device"):
                dst["device"] = src["device"]
            sn = src.get("name") or ""
            if sn and sn != src.get("address") and not dst.get("ble_name"):
                dst["ble_name"] = sn
            if src.get("identified"):
                dst["identified"] = True
            _mp = dst.setdefault("merged_protocols", [dst.get("kind", "ble")])
            sk2 = src.get("kind", "ble")
            if sk2 not in _mp:
                _mp.append(sk2)

        def _run_dedup(objects: list, absorbed: set) -> list:
            """Run D1-D7 dedup strategies. Mutates absorbed set, returns filtered list."""
            # --- (D1) Entity absorbs its BLE counterpart ─────────────────────
            # Entity objects that share a MAC with a ble/private_ble/ibeacon
            # object → absorb the raw BLE object (entity is the richer representation)
            _ent_macs: dict[str, dict[str, Any]] = {}  # MAC → entity obj
            for obj in objects:
                if obj.get("kind") == "entity" and obj.get("address"):
                    _ent_macs[obj["address"].upper()] = obj
            for obj in objects:
                if obj.get("kind") not in ("ble",):
                    continue
                obj_addr = (obj.get("address") or "").upper()
                ent_obj = _ent_macs.get(obj_addr) if obj_addr else None
                if ent_obj:
                    absorbed.add(obj.get("key", ""))
                    # Copy BLE metadata into the entity object
                    for _mf in ("manufacturer_data", "service_data", "service_uuids",
                                "company_name", "device_type", "service_names"):
                        v = obj.get(_mf)
                        if v and not ent_obj.get(_mf):
                            ent_obj[_mf] = v
                    if obj.get("rssi") is not None and ent_obj.get("rssi") is None:
                        ent_obj["rssi"] = obj["rssi"]
                    if obj.get("sources"):
                        ent_obj.setdefault("sources", [])
                        for _s in obj["sources"]:
                            if _s not in ent_obj["sources"]:
                                ent_obj["sources"].append(_s)

            # --- (D2) Eddystone-UID namespace grouping ───────────────────────
            # Eddystone-UID beacons broadcast service_data under UUID 0xFEAA.
            # Frame type 0x00 = UID frame: 10-byte namespace + 6-byte instance.
            # Group by namespace+instance (like iBeacon UUID/major/minor).
            _eddystone_groups: dict[str, list[dict[str, Any]]] = {}  # "eddy:ns:inst" → [objs]
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble", "private_ble"):
                    continue
                sd = obj.get("service_data") or {}
                for sdk in ("0000feaa-0000-1000-8000-00805f9b34fb", "feaa", "0xFEAA"):
                    raw = sd.get(sdk)
                    if not raw:
                        continue
                    try:
                        if isinstance(raw, str):
                            payload = bytes(int(x, 16) for x in raw.split())
                        elif isinstance(raw, (bytes, bytearray)):
                            payload = bytes(raw)
                        else:
                            continue
                        if len(payload) >= 18 and payload[0] == 0x00:
                            # UID frame: byte 0 = frame type, byte 1 = tx power,
                            # bytes 2-11 = namespace (10 bytes), bytes 12-17 = instance (6 bytes)
                            ns = payload[2:12].hex()
                            inst = payload[12:18].hex()
                            eddy_key = f"eddy:{ns}:{inst}"
                            _eddystone_groups.setdefault(eddy_key, []).append(obj)
                    except Exception:
                        pass

            for eddy_key, group in _eddystone_groups.items():
                if len(group) <= 1:
                    continue
                # Keep the one with best RSSI as primary
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                primary["eddystone_uid"] = eddy_key
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)

            # --- (D3) Same BLE name merging ──────────────────────────────────
            # Devices with identical non-generic broadcast names and random MACs
            # are very likely the same device with rotating addresses.
            # Generic names (empty, MAC-like, short hex) are excluded.
            _GENERIC_NAME_RE = __import__("re").compile(
                r"^$|^([0-9A-Fa-f]{2}[:\-]){2,}|^[0-9A-Fa-f]{4,}$|^BLE$|^Unknown$"
            )
            _name_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                name = (obj.get("name") or "").strip()
                addr = (obj.get("address") or "").upper()
                # Skip if name is generic or IS the MAC address
                if not name or name.upper() == addr or _GENERIC_NAME_RE.match(name):
                    continue
                # Only merge random-address MACs (bit 1 of first octet set = random)
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)  # locally administered bit
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                _name_groups.setdefault(name, []).append(obj)

            for name, group in _name_groups.items():
                if len(group) <= 1:
                    continue
                # All share the same broadcast name + have random MACs → likely same device
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary.setdefault("merged_protocols", [primary.get("kind", "ble")])
                primary["_dedup_reason"] = f"same_name:{name}"

            # --- (D4) Manufacturer data fingerprint dedup ────────────────────
            # Devices with identical manufacturer_data payloads on different
            # random MACs are the same rotating device.  Only for random MACs.
            # Exclude Apple (76) continuity data which changes frequently.
            _manuf_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                md = obj.get("manufacturer_data") or {}
                if not md:
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                # Build a fingerprint from manufacturer_data, excluding Apple
                # continuity (company 76) which rotates frequently
                fp_parts = []
                for k, v in sorted(md.items()):
                    if str(k) in ("76", "0x004c", "0x004C"):
                        continue  # skip Apple continuity — too variable
                    fp_parts.append(f"{k}={v}")
                if not fp_parts:
                    continue
                fp = "|".join(fp_parts)
                _manuf_groups.setdefault(fp, []).append(obj)

            for fp, group in _manuf_groups.items():
                if len(group) <= 1:
                    continue
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = "same_manuf_data"

            # --- (D5) Apple continuity dedup ─────────────────────────────────
            # Apple devices rotate MACs but broadcast company 76 with a
            # consistent subtype byte (byte 0 after company ID).  Devices
            # from the same scanners with the same subtype are grouped.
            _apple_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                md = obj.get("manufacturer_data") or {}
                apple_raw = None
                for k in ("76", "0x004c", "0x004C"):
                    if k in md:
                        apple_raw = md[k]
                        break
                if not apple_raw:
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                # Parse subtype from Apple continuity data
                try:
                    if isinstance(apple_raw, str):
                        raw_bytes = [int(x, 16) for x in apple_raw.split()]
                    elif isinstance(apple_raw, (bytes, bytearray)):
                        raw_bytes = list(apple_raw)
                    else:
                        continue
                    if len(raw_bytes) < 2:
                        continue
                    subtype = raw_bytes[0]
                    data_len = raw_bytes[1]
                except Exception:
                    continue
                # Skip iBeacon subtype (already handled)
                if subtype == 0x02 and data_len == 0x15:
                    continue
                # Group by subtype + data length + scanner set
                srcs = obj.get("sources") or []
                src_key = ",".join(sorted(str(s) for s in srcs)) if srcs else "_"
                apple_key = f"apple:{subtype:02x}:{data_len:02x}:{src_key}"
                _apple_groups.setdefault(apple_key, []).append(obj)

            for apple_key, group in _apple_groups.items():
                if len(group) <= 1:
                    continue
                # Same Apple subtype + same scanners → likely same device rotating MACs
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = f"apple_continuity:{apple_key}"

            # --- (D6) Identical service_uuids + same scanners dedup ──────────
            # Random-MAC devices advertising identical service_uuids from the
            # same set of scanners are very likely the same rotating device.
            _svcuuid_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                su = obj.get("service_uuids") or []
                if not su:
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                name = (obj.get("name") or "").strip()
                # Only group unnamed or generic-named devices
                if name and name.upper() != addr and not _GENERIC_NAME_RE.match(name):
                    continue  # named devices already handled by D3
                srcs = obj.get("sources") or []
                src_key = ",".join(sorted(str(s) for s in srcs)) if srcs else "_"
                uuid_key = "+".join(sorted(su)) + "@" + src_key
                _svcuuid_groups.setdefault(uuid_key, []).append(obj)

            for uuid_key, group in _svcuuid_groups.items():
                if len(group) <= 1:
                    continue
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = "same_svc_uuids_scanners"

            # --- (D7) Bare random MACs with no data ──────────────────────────
            # Random-address devices with no name, no manufacturer_data, no
            # service_data, no service_uuids → group by scanner set.
            # These are typically the same device rotating its address.
            _bare_groups: dict[str, list[dict[str, Any]]] = {}
            for obj in objects:
                if obj.get("key", "") in absorbed:
                    continue
                if obj.get("kind") not in ("ble",):
                    continue
                addr = (obj.get("address") or "").upper()
                try:
                    first_octet = int(addr.split(":")[0], 16)
                    is_random = bool(first_octet & 0x02)
                except Exception:
                    is_random = False
                if not is_random:
                    continue
                name = (obj.get("name") or "").strip()
                if name and name.upper() != addr:
                    continue  # has a real name
                md = obj.get("manufacturer_data") or {}
                sd = obj.get("service_data") or {}
                su = obj.get("service_uuids") or []
                if md or sd or su:
                    continue  # has some distinguishing data
                srcs = obj.get("sources") or []
                src_key = ",".join(sorted(str(s) for s in srcs)) if srcs else "_"
                _bare_groups.setdefault(src_key, []).append(obj)

            for src_key, group in _bare_groups.items():
                if len(group) <= 1:
                    continue
                # Group all bare random-MAC devices per scanner set into one
                group.sort(key=lambda o: o.get("rssi") or -999, reverse=True)
                primary = group[0]
                primary["name"] = f"Unknown BLE ({len(group)} rotations)"
                for secondary in group[1:]:
                    absorbed.add(secondary.get("key", ""))
                    _merge_into(primary, secondary)
                primary["_dedup_reason"] = "bare_random_mac"

            # Remove all absorbed objects
            if absorbed:
                _pre = len(objects)
                objects = [o for o in objects if o.get("key", "") not in absorbed]
                _LOGGER.debug(
                    "Aggressive dedup: %d → %d objects (-%d)",
                    _pre, len(objects), _pre - len(objects),
                )
            return objects

        try:
            objects = _run_dedup(objects, _dedup_absorbed)
        except Exception as _dedup_err:
            _LOGGER.debug("Aggressive dedup error: %s", _dedup_err)

        # Attach user labels — DeviceRegistry is the primary source (resolved later
        # in the DeviceRegistry enrichment block). ObjectStore is a thin fallback for
        # any labels not yet migrated to DeviceRegistry.
        try:
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if obj_store:
                for obj in objects:
                    if obj.get("user_label"):
                        continue  # already labeled
                    kind = obj.get("kind", "")
                    addr = obj.get("address", "") or ""
                    lookup_key = obj.get("canonical_id") or obj.get("key") or addr
                    if not lookup_key:
                        continue
                    entry = obj_store.get(lookup_key)
                    if not entry and lookup_key != addr:
                        entry = obj_store.get(addr)
                    if entry:
                        label = entry.get("label", "")
                        if label:
                            obj["user_label"] = label
                            if kind in ("ble", "ibeacon", "private_ble"):
                                obj["identified"] = True
        except Exception:
            pass

        # BLE enrichment: decode company names, device types, service names
        for obj in objects:
            if obj.get("kind") in ("ble", "private_ble", "ibeacon"):
                try:
                    _enrich_ble_object(obj)
                except Exception:
                    pass

        # ── Persistent object history (rolling, disk-backed) ───────────────
        # WHY: Objects disappear from BLE when out of range or MAC rotates.
        # Without history, they'd vanish from the UI.  This cache preserves
        # every object with all metadata so they reappear with correct labels.
        # Tagged/identified objects NEVER expire, whatever this TTL says.
        # The cache is loaded from disk on first access and saved every 15s.
        #
        # The TTL only governs objects that were never identified — in a busy
        # BLE environment that is passing phones and neighbours' devices, one
        # new object per MAC rotation.  It used to be a hard-coded 7 days,
        # which accumulated ~16.4k objects (only ~50 seen in the last five
        # minutes).  Since the whole cache ships in every live_snapshot, and
        # the panel polls that every 5s, a week of strangers' phones meant a
        # 19.5MB / 2-7s poll on a 5s interval — polls overlapping and backing
        # up.  Now user-selectable (Settings -> Object History): 1 day keeps it
        # at ~2.8k objects / 3.8MB / sub-second, 14 days is the pack-rat end.
        import time as _time
        _HISTORY_TTL = _object_history_ttl_s(hass)
        _SAVE_INTERVAL = 15         # save to disk at most every 15 s
        _now_ts = _time.time()      # real wall-clock time (survives restarts)

        _dom = hass.data.setdefault(DOMAIN, {})
        _cache: dict[str, dict[str, Any]] = _dom.get(DATA_OBJECT_HISTORY)

        # First access: load from disk
        if _cache is None:
            from homeassistant.helpers.storage import Store as _Store
            _hist_store = _dom.setdefault("_obj_hist_store", _Store(hass, 1, OBJECT_HISTORY_STORE_KEY))
            _loaded = await _hist_store.async_load()
            _cache = _loaded if isinstance(_loaded, dict) else {}
            _dom[DATA_OBJECT_HISTORY] = _cache
            _dom["_obj_hist_last_save"] = _now_ts
            _LOGGER.debug("Object history loaded from disk: %d entries", len(_cache))

        # Fields to merge (never overwrite good data with empty values)
        _MERGE_FIELDS = (
            "company_name", "device_type", "service_names", "service_uuid_map",
            "name", "private_ble_name", "ibeacon_uuid", "ibeacon_major",
            "ibeacon_minor", "tx_power", "manufacturer_data", "service_data",
            "service_uuids", "all_addresses", "linked_entities", "device",
            "prefix", "prefix_count",
        )

        # Index current objects by key for fast lookup
        _current_keys: set[str] = set()
        for obj in objects:
            key = obj.get("key") or ""
            if not key:
                continue
            _current_keys.add(key)

            # Merge: keep previously-discovered metadata if current is empty
            prev = _cache.get(key)
            if prev:
                for fld in _MERGE_FIELDS:
                    cur_val = obj.get(fld)
                    prev_val = prev.get(fld)
                    if not cur_val and prev_val:
                        obj[fld] = prev_val
                # Preserve first_seen from history
                obj["_first_seen"] = prev.get("_first_seen") or _now_ts
                # Merge all_addresses (accumulate over time).  Current-cycle
                # addresses go first so the retained head is the freshest.
                if prev.get("all_addresses") and obj.get("all_addresses"):
                    obj["all_addresses"] = _capped_mac_history(
                        list(obj["all_addresses"]) + list(prev["all_addresses"])
                    )
            else:
                obj["_first_seen"] = _now_ts

            # Split iBeacon objects own exactly ONE MAC — the one in their key.
            # Never union sibling MACs from merged-era cache entries; the cache
            # rewrite below then self-heals old entries that claimed the pack.
            if obj.get("kind") == "ibeacon":
                _kparts = str(obj.get("key") or "").split(":")
                if len(_kparts) > 4:
                    _own_mac = ":".join(_kparts[-6:])
                    if len(_own_mac) == 17 and _own_mac.count(":") == 5:
                        obj["all_addresses"] = [_own_mac]

            # Update cache entry
            obj["_last_seen_ts"] = _now_ts
            obj["_cache_age_s"] = obj.get("age_s") or 0
            _cache[key] = dict(obj)  # snapshot copy

        # Merge cached objects not seen this cycle back into the list
        # Skip keys absorbed by deduplication — they are ghosts of merged objects
        _cached_added = 0
        for key, cached_obj in list(_cache.items()):
            if key in _current_keys:
                continue  # already in this cycle's list
            if key in _dedup_absorbed:
                del _cache[key]  # purge absorbed ghost from cache
                continue
            # When bermuda_ignore is on, purge cached entity objects from Bermuda
            # so they don't keep resurrecting after being filtered out
            if _bermuda_ignore and _all_bermuda_entry_ids and cached_obj.get("kind") == "entity":
                _cached_eid = cached_obj.get("entity_id") or ""
                if _cached_eid:
                    try:
                        _cached_ent = er.async_get(_cached_eid)
                        if _cached_ent and _cached_ent.config_entry_id in _all_bermuda_entry_ids:
                            del _cache[key]
                            continue
                    except Exception:
                        pass
            stale_s = _now_ts - (cached_obj.get("_last_seen_ts") or _now_ts)
            is_identified = cached_obj.get("identified") or cached_obj.get("user_label")
            # Verify label still exists — if deleted from obj_store, clear the
            # cached flags so the ghost can expire normally instead of lingering
            # forever as a phantom identified object.
            if is_identified and obj_store and stale_s > 60:
                _cache_label_key = cached_obj.get("canonical_id") or key
                _cache_entry = obj_store.get(_cache_label_key) or obj_store.get(key)
                if not _cache_entry or not _cache_entry.get("label"):
                    cached_obj.pop("identified", None)
                    cached_obj.pop("user_label", None)
                    is_identified = False
            # Tagged/identified objects never expire from history
            if not is_identified and stale_s > _HISTORY_TTL:
                del _cache[key]
                continue
            # Heal pre-cap poisoned address histories in place: cache entries
            # persisted before _ALL_ADDR_CAP existed can carry tens of
            # thousands of addresses, and resurrection shipped them uncapped —
            # re-bloating the snapshot the cap was added to shrink.
            _aa = cached_obj.get("all_addresses")
            if isinstance(_aa, list) and len(_aa) > _ALL_ADDR_CAP:
                cached_obj["all_addresses"] = _capped_mac_history(_aa)
            # Bring it back — compute age_s = original age + time since last seen
            obj_copy = dict(cached_obj)
            base_age = cached_obj.get("_cache_age_s") or 0
            obj_copy["age_s"] = base_age + stale_s
            # Update per-source age_s values too (they were frozen at cache time)
            if obj_copy.get("sources"):
                obj_copy["sources"] = [
                    {**s, "age_s": (s.get("age_s") or 0) + stale_s}
                    if isinstance(s, dict) else s
                    for s in obj_copy["sources"]
                ]
            objects.append(obj_copy)
            _cached_added += 1

        # Second dedup pass: catch cached objects that were reintroduced
        if _cached_added > 0:
            try:
                objects = _run_dedup(objects, _dedup_absorbed)
            except Exception as _dedup2_err:
                _LOGGER.debug("Post-cache dedup error: %s", _dedup2_err)

        # Re-apply user labels to any cached objects that were merged back
        # without labels (e.g. labelled via companion_follow after initial cache)
        try:
            _obj_store2 = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            if _obj_store2:
                for obj in objects:
                    if obj.get("user_label"):
                        continue  # already labelled
                    kind = obj.get("kind", "")
                    if kind not in ("ble", "private_ble", "ibeacon"):
                        continue
                    # Try the object's key, address, canonical_id, ibeacon key variants
                    _lbl = None
                    _try_keys = [obj.get("key"), obj.get("address"), obj.get("canonical_id")]
                    # Split iBeacon objects (key = ibeacon:uuid:major:minor:MAC) are
                    # DISTINCT physical devices sharing a factory-default UUID.  They
                    # must NOT inherit the unsplit group key's label — that resurrects
                    # a stale label onto every beacon in the pack AND shadows per-MAC
                    # renames made in the Bluetooth tab.
                    _is_split_ib = kind == "ibeacon" and len(str(obj.get("key") or "").split(":")) > 4
                    # Also try ibeacon key from metadata (unsplit objects only)
                    _ib_u = obj.get("ibeacon_uuid")
                    if _ib_u is not None and not _is_split_ib:
                        _ibk = f"ibeacon:{_ib_u}:{obj.get('ibeacon_major', 0)}:{obj.get('ibeacon_minor', 0)}"
                        _try_keys.extend([_ibk, _ibk.upper()])
                    # Also try all_addresses
                    for _a in (obj.get("all_addresses") or []):
                        _try_keys.append(_a)
                    for _try_key in _try_keys:
                        if _try_key:
                            _e = _obj_store2.get(_try_key)
                            if _e and _e.get("label"):
                                _lbl = _e["label"]
                                break
                    if _lbl:
                        obj["user_label"] = _lbl
                        obj["identified"] = True
        except Exception:
            pass

        # ── Same-label dedup (post-labelling safety net) ───────────────────
        # WHY: A device can exist as multiple object kinds simultaneously
        # (e.g. ble MAC + ibeacon key, or cached stale + fresh live).
        # If the user labelled both halves, they'd see the same name twice.
        # This pass merges objects sharing the same user_label into one.
        try:
            _label_groups: dict[str, list[dict]] = {}
            for obj in objects:
                ul = obj.get("user_label", "")
                if ul and obj.get("key", "") not in _dedup_absorbed:
                    _label_groups.setdefault(ul, []).append(obj)

            for _lbl, _grp in _label_groups.items():
                if len(_grp) <= 1:
                    continue
                # Keep the one with best RSSI (or most recent) as primary
                _grp.sort(key=lambda o: (o.get("rssi") or -999), reverse=True)
                _primary = _grp[0]
                for _sec in _grp[1:]:
                    # A label is a display string, NOT an identity.  Two iBeacon
                    # objects with DIFFERENT keys are distinct physical devices
                    # (e.g. a beacon multi-pack split per MAC) that merely share
                    # an inherited label — never merge them, or the per-MAC split
                    # gets silently undone right here.
                    if (
                        _primary.get("kind") == "ibeacon"
                        and _sec.get("kind") == "ibeacon"
                        and _sec.get("key") != _primary.get("key")
                    ):
                        continue
                    _sec_key = _sec.get("key", "")
                    if _sec_key:
                        _dedup_absorbed.add(_sec_key)
                    _merge_into(_primary, _sec)
                _primary.setdefault("_dedup_reason", "same_user_label")
                _LOGGER.debug(
                    "Same-label dedup: merged %d objects with label '%s'",
                    len(_grp), _lbl,
                )

            if _dedup_absorbed:
                objects = [o for o in objects if o.get("key", "") not in _dedup_absorbed]
        except Exception as _sld_err:
            _LOGGER.debug("Same-label dedup error: %s", _sld_err)

        # Periodic disk save (at most every 60 s)
        _last_save = _dom.get("_obj_hist_last_save") or 0
        if _now_ts - _last_save >= _SAVE_INTERVAL:
            _hist_store = _dom.get("_obj_hist_store")
            if _hist_store is None:
                from homeassistant.helpers.storage import Store as _Store
                _hist_store = _Store(hass, 1, OBJECT_HISTORY_STORE_KEY)
                _dom["_obj_hist_store"] = _hist_store
            # Strip non-serializable fields before saving
            _save_data = {}
            for _k, _v in _cache.items():
                _sv = dict(_v)
                # Remove any fields that might not be JSON-serializable
                _sv.pop("_smoothed", None)
                _sv.pop("_stale", None)
                _save_data[_k] = _sv
            await _hist_store.async_save(_save_data)
            _dom["_obj_hist_last_save"] = _now_ts

        # Send first_seen to frontend, strip internal cache fields
        for obj in objects:
            # Convert _first_seen to ISO string for frontend
            fs = obj.pop("_first_seen", None)
            if fs:
                from datetime import datetime, timezone
                obj["first_seen"] = datetime.fromtimestamp(fs, tz=timezone.utc).isoformat()
            obj.pop("_last_seen_ts", None)
            obj.pop("_cache_age_s", None)

        # Ghost injection removed — if a device isn't broadcasting, it
        # shouldn't appear in the object list.  Followed devices are tracked
        # via alerts/history, not by faking their presence on the map.

        unidentified = [o for o in objects if o.get("kind") in ("ble", "private_ble", "ibeacon") and not o.get("identified")]
        identified = [o for o in objects if not (o.get("kind") in ("ble", "private_ble", "ibeacon") and not o.get("identified"))]
        common_prefixes = {p: c for p, c in prefix_counts.items() if c >= 3}

        snapshot["objects"] = {
            "list": objects,
            "summary": {
                "total": len(objects),
                "identified": len(identified),
                "unidentified": len(unidentified),
                "entities": len([o for o in objects if o.get("kind") == "entity"]),
                "ble": len([o for o in objects if o.get("kind") in ("ble", "private_ble")]),
                "private_ble": len([o for o in objects if o.get("kind") == "private_ble"]),
                "ibeacon": len([o for o in objects if o.get("kind") == "ibeacon"]),
                "common_prefixes": common_prefixes,  # prefix -> count (>=3)
                "resolver": _resolver_diag,
                "cached_objects": _cached_added,
                "dedup_absorbed": len(_dedup_absorbed),
            },
        }
    except Exception as _obj_err:
        _LOGGER.warning("Objects list build failed: %s", _obj_err, exc_info=True)
        snapshot["objects"] = {"list": [], "summary": {"total": 0, "identified": 0, "unidentified": 0, "entities": 0, "ble": 0, "common_prefixes": {}}}

    # ── Enrich objects with stable padspan_id from DeviceRegistry ──
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            for _o in (snapshot.get("objects") or {}).get("list") or []:
                _okey = _o.get("key", "")
                if not _okey:
                    continue
                # Try resolving by key, address, canonical_id, all_addresses
                _pid = _dev_reg.resolve(_okey)
                if not _pid:
                    _pid = _dev_reg.resolve(_o.get("address") or "")
                if not _pid and _o.get("canonical_id"):
                    _pid = _dev_reg.resolve(_o["canonical_id"])
                if not _pid:
                    for _alt in (_o.get("all_addresses") or []):
                        _pid = _dev_reg.resolve(str(_alt))
                        if _pid:
                            break
                if _pid:
                    _o["padspan_id"] = _pid
                    _plbl = _dev_reg.get_label(_pid)
                    if _plbl and not _o.get("user_label"):
                        _o["user_label"] = _plbl
                        _o["identified"] = True
                else:
                    # Auto-register in ephemeral cache (not persisted)
                    _kind = "ibeacon" if _okey.startswith("ibeacon:") else "irk" if _okey.startswith("irk:") else "mac"
                    _pid = _dev_reg.resolve_or_create(_okey, kind=_kind, persist=False)
                    _o["padspan_id"] = _pid
    except Exception as _dr_err:
        _LOGGER.debug("DeviceRegistry enrichment: %s", _dr_err)

    # ── Enrich raw advertisements with decoded metadata + object cross-reference ──
    try:
        from .ble_enrichment import enrich_object as _enrich_ad
        _obj_by_addr: dict[str, dict[str, Any]] = {}
        for _o in (snapshot.get("objects") or {}).get("list") or []:
            for _a in ([_o.get("address")] + (_o.get("all_addresses") or [])):
                if _a:
                    _obj_by_addr[str(_a).upper()] = _o
        _raw_ads = (snapshot.get("ble") or {}).get("advertisements") or []
        for _ad in _raw_ads:
            _enrich_ad(_ad)  # adds company_name, device_type, service_names, service_uuid_map
            _ad_addr = str(_ad.get("address") or "").upper()
            _xobj = _obj_by_addr.get(_ad_addr)
            if _xobj:
                _ad["_xref"] = {
                    "key": _xobj.get("key"),
                    "kind": _xobj.get("kind"),
                    "label": _xobj.get("user_label") or _xobj.get("name"),
                    "identified": _xobj.get("identified", False),
                    "room": _xobj.get("room"),
                }
                if _xobj.get("canonical_id"):
                    _ad["_xref"]["canonical_id"] = _xobj["canonical_id"]
                if _xobj.get("all_addresses"):
                    _ad["_xref"]["all_addresses"] = list(
                        _xobj["all_addresses"]
                    )[:_XREF_ADDR_SAMPLE]
                if _xobj.get("ibeacon_uuid"):
                    _ad["_xref"]["ibeacon_uuid"] = _xobj["ibeacon_uuid"]
                    _ad["_xref"]["ibeacon_major"] = _xobj.get("ibeacon_major")
                    _ad["_xref"]["ibeacon_minor"] = _xobj.get("ibeacon_minor")
                if _xobj.get("entity_id"):
                    _ad["_xref"]["entity_id"] = _xobj["entity_id"]
            else:
                _ad["_xref"] = None
    except Exception:
        pass

    snapshot["bermuda_devices"] = snapshot.get("receivers") or []

    # Frontend "radios" should reflect actual Bluetooth scanners/adapters (not Bermuda tag devices).
    if "radios" not in snapshot:
        snapshot["radios"] = (snapshot.get("ble") or {}).get("radios") or []

    # --- BLE room assignment (strongest-scanner heuristic) ---
    # Unlike entity-based objects (which get their room from HA state), raw BLE
    # objects have no inherent room.  We assign one by finding which scanner
    # hears the device with the strongest RSSI, then using that scanner's HA area.
    # Scanner RSSI offsets (user-configured corrections for hot/cold scanners)
    # are applied before comparison.
    try:
        radios = (snapshot.get("ble") or {}).get("radios") or []
        source_to_area: dict[str, str] = {}
        for r in radios:
            src = r.get("source")
            area = r.get("area_name") or r.get("area")
            # Lost/disabled scanners are excluded from location math
            if src and area and str(src) not in _excluded_radio_srcs:
                source_to_area[str(src)] = str(area)

        if source_to_area:
            ads_raw = (snapshot.get("ble") or {}).get("advertisements") or []
            # Build {addr: {source: rssi}} from raw advertisements.
            # Skip readings older than 60s so a scanner that heard the device
            # long ago can't win (same recency cutoff as the iBeacon merge),
            # and skip scanners marked lost/disabled.
            addr_src_rssi: dict[str, dict[str, float]] = {}
            for ad in ads_raw:
                addr = str(ad.get("address") or "").upper()
                src  = ad.get("source")
                rssi = ad.get("rssi")
                if not (addr and src and rssi is not None):
                    continue
                if str(src) in _excluded_radio_srcs:
                    continue
                _age = ad.get("age_s")
                if isinstance(_age, (int, float)) and _age > 60:
                    continue
                addr_src_rssi.setdefault(addr, {})[str(src)] = float(rssi)

            # Apply per-scanner RSSI offsets (corrects scanners that read consistently high/low)
            _scanner_offsets: dict[str, float] = {}
            try:
                _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
                _scanner_offsets = ((_st.data if _st else {}).get("scanner_offsets") or {})
                if _scanner_offsets:
                    for _am in addr_src_rssi.values():
                        for _src in _am:
                            _off = _scanner_offsets.get(_src)
                            if _off:
                                _am[_src] = _am[_src] + float(_off)
            except Exception:
                pass
            snapshot["scanner_offsets"] = _scanner_offsets

            objects_list = (snapshot.get("objects") or {}).get("list") or []
            for obj in objects_list:
                if obj.get("room"):
                    continue
                kind = obj.get("kind")
                if kind == "ibeacon":
                    # Merge RSSI from all rotating MACs for this iBeacon group
                    best_rssi_ib: float | None = None
                    best_area_ib: str | None = None
                    for a in (obj.get("all_addresses") or []):
                        for src, rssi in addr_src_rssi.get(str(a).upper(), {}).items():
                            area = source_to_area.get(src)
                            if area and (best_rssi_ib is None or rssi > best_rssi_ib):
                                best_rssi_ib = rssi
                                best_area_ib = area
                    if best_area_ib:
                        obj["room"] = best_area_ib
                elif kind == "private_ble":
                    # Check ALL rotating MACs for strongest signal (like iBeacon)
                    best_rssi_pb: float | None = None
                    best_area_pb: str | None = None
                    _pb_addrs = (obj.get("all_addresses") or [])
                    if not _pb_addrs:
                        _pb_addr = str(obj.get("address") or "").upper()
                        if _pb_addr:
                            _pb_addrs = [_pb_addr]
                    for a in _pb_addrs:
                        for src, rssi in addr_src_rssi.get(str(a).upper(), {}).items():
                            area = source_to_area.get(src)
                            if area and (best_rssi_pb is None or rssi > best_rssi_pb):
                                best_rssi_pb = rssi
                                best_area_pb = area
                    if best_area_pb:
                        obj["room"] = best_area_pb
                elif kind == "ble":
                    addr = str(obj.get("address") or "").upper()
                    if not addr:
                        continue
                    src_map = addr_src_rssi.get(addr, {})
                    # Pick source with highest RSSI that has an area mapping
                    best_rssi: float | None = None
                    best_area: str | None = None
                    for src, rssi in src_map.items():
                        area = source_to_area.get(src)
                        if area and (best_rssi is None or rssi > best_rssi):
                            best_rssi = rssi
                            best_area = area
                    if best_area:
                        obj["room"] = best_area
    except Exception:
        pass

    # ── Traceback recording moved to ws_live_snapshot (after k-NN overlay) ──

    # ── Scanner health (Phase 3) ─────────────────────────────────────────────
    try:
        _pc_sh = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if _pc_sh and _pc_sh.data:
            _sh = _pc_sh.data.get("__scanner_health__")
            if _sh:
                snapshot["scanner_health"] = _sh
    except Exception:
        pass

    return snapshot

@websocket_api.websocket_command({"type": "padspan_ha/settings_get"})

@websocket_api.async_response
async def ws_settings_get(hass: HomeAssistant, connection, msg) -> None:
    from .presence_coordinator import PresenceCoordinator  # noqa: PLC0415
    connection.send_result(msg["id"], {
        "settings": _get_settings(hass),
        "cpu_pinning_supported": PresenceCoordinator.cpu_pinning_supported(),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/settings_set",
        vol.Optional("data_mode"): str,
        vol.Optional("cpu_mode"): str,                        # "shared"|"single"|"dedicated"
        vol.Optional("update_check_enabled"): bool,           # daily version ping (README)
        vol.Optional("vendor_lookup_enabled"): bool,
        vol.Optional("room_change_delay_s"): vol.Coerce(float),
        vol.Optional("away_timeout_m"): vol.Coerce(float),
        vol.Optional("ref_power"): vol.Coerce(float),
        vol.Optional("path_loss_exp"): vol.Coerce(float),
        vol.Optional("kalman_q"): vol.Coerce(float),
        vol.Optional("kalman_r"): vol.Coerce(float),
        vol.Optional("room_sigma_m"): vol.Coerce(float),
        vol.Optional("assumed_device_height_m"): vol.Coerce(float),
        vol.Optional("hidden_map_ids"): list,
        vol.Optional("followed_addrs"): list,
        vol.Optional("health_reminder_enabled"): bool,
        vol.Optional("health_reminder_last_ts"): vol.Any(float, int, None),
        vol.Optional("maps_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("maps_iso_focus"): vol.Any(int, None),
        vol.Optional("overview_iso_floor_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_horiz_gap"): vol.Coerce(int),
        vol.Optional("overview_iso_focus"): vol.Any(int, None),
        vol.Optional("lights_hidden"): list,
        vol.Optional("adaptive_learning_enabled"): bool,
        vol.Optional("adaptive_floor_detection"): bool,
        vol.Optional("signal_loss_linger_s"): vol.Coerce(int),
        vol.Optional("advanced_extra_tabs"): list,
        vol.Optional("ha_entity_tracker_enabled"): bool,
        vol.Optional("ha_entity_area_enabled"): bool,
        vol.Optional("ha_entity_distance_enabled"): bool,
        vol.Optional("ha_entity_scanner_distance_enabled"): bool,
        vol.Optional("ha_entity_occupancy_enabled"): bool,
        vol.Optional("mqtt_publish_enabled"): bool,
        vol.Optional("espresense_mqtt_enabled"): bool,
        vol.Optional("espresense_topic_prefix"): str,
        vol.Optional("espresense_room_map"): dict,
        vol.Optional("espresense_companion_url"): str,
        vol.Optional("aggressive_ble_reseed"): bool,
        vol.Optional("presence_poll_interval_s"): vol.Coerce(int),
        vol.Optional("ble_reseed_interval_s"): vol.Coerce(int),
        vol.Optional("lights_panel_enabled"): bool,
        vol.Optional("bermuda_ignore"): bool,
        vol.Optional("tags_room_events_enabled"): bool,
        vol.Optional("tags_nfc_identify_enabled"): bool,
        vol.Optional("tags_phone_autolink_enabled"): bool,
        vol.Optional("quiet_mode"): bool,
        vol.Optional("overview_2d_mode"): bool,
        vol.Optional("positioning_algorithm"): str,
        vol.Optional("beacon_profiling_enabled"): bool,
        vol.Optional("beacon_tune_disabled"): list,
        vol.Optional("beacon_group_overrides"): dict,
        vol.Optional("trackability_rating_enabled"): bool,
        vol.Optional("walk_to_identify_enabled"): bool,
        vol.Optional("radio_map_enabled"): bool,
        vol.Optional("distortion_map_enabled"): bool,
        vol.Optional("compass_ring_enabled"): bool,
        vol.Optional("replay_timeline_enabled"): bool,
        vol.Optional("phone_wizard_enabled"): bool,
        vol.Optional("mac_rotation_bridging"): bool,
        vol.Optional("apple_auto_classify"): bool,
        vol.Optional("forensics_enabled"): bool,
        vol.Optional("forensics_retention_days"): vol.Coerce(int),
        vol.Optional("ble_max_age_s"): vol.Coerce(int),
        vol.Optional("occupancy_hybrid_enabled"): bool,
        vol.Optional("occupancy_cluster_threshold"): vol.Coerce(float),
        vol.Optional("distance_stationary_devices"): list,
        vol.Optional("onboarding_completed"): bool,
        # Radio map visualization parameters (clamped in handler below)
        vol.Optional("heatmap_gain"): vol.Coerce(int),        # -20 to +20 dB
        vol.Optional("heatmap_contrast"): vol.Coerce(int),    # -15 to +15
        vol.Optional("distortion_intensity"): vol.Coerce(int),  # 0-100 %
        vol.Optional("heatmap_source"): vol.Coerce(int),      # 0-100 % (calibration vs adaptive blend)
        vol.Optional("auto_offset_mode"): str,                # "off"|"partial"|"full"
        vol.Optional("padspan_automations"): list,              # [{trigger, device_key, device_label, action, entity_id, enabled}]
    }
)
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection, msg) -> None:
    """Persist one or more settings changes.

    Each field is individually validated and clamped to safe ranges before
    being written to the SettingsStore.  After saving, entity toggles in the
    HA registry are updated to reflect enabled/disabled preferences.
    """
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        payload: dict[str, Any] = {}
        # Only touch data_mode when the message actually carries it.  Callers
        # that omit it (e.g. the lights panel hiding a light) must not flip
        # the integration back to "sample" mode as a side effect.
        if "data_mode" in msg:
            mode = (msg.get("data_mode") or "sample").strip().lower()
            if mode not in ("sample", "live"):
                mode = "sample"
            payload["data_mode"] = mode
        if "cpu_mode" in msg:
            cm = (msg.get("cpu_mode") or "shared").strip().lower()
            if cm not in ("shared", "single", "dedicated"):
                cm = "shared"
            payload["cpu_mode"] = cm
        if "update_check_enabled" in msg:
            payload["update_check_enabled"] = bool(msg.get("update_check_enabled"))
        if "vendor_lookup_enabled" in msg:
            payload["vendor_lookup_enabled"] = bool(msg.get("vendor_lookup_enabled"))
        if "room_change_delay_s" in msg:
            payload["room_change_delay_s"] = max(0.0, min(300.0, float(msg["room_change_delay_s"])))
        if "away_timeout_m" in msg:
            payload["away_timeout_m"] = max(1.0, min(1440.0, float(msg["away_timeout_m"])))
        if "ref_power" in msg:
            payload["ref_power"] = max(-100.0, min(0.0, float(msg["ref_power"])))
        if "path_loss_exp" in msg:
            payload["path_loss_exp"] = max(1.0, min(4.0, float(msg["path_loss_exp"])))
        if "kalman_q" in msg:
            payload["kalman_q"] = max(0.01, min(1.0, float(msg["kalman_q"])))
        if "kalman_r" in msg:
            payload["kalman_r"] = max(0.5, min(50.0, float(msg["kalman_r"])))
        if "room_sigma_m" in msg:
            payload["room_sigma_m"] = max(1.0, min(20.0, float(msg["room_sigma_m"])))
        if "assumed_device_height_m" in msg:
            payload["assumed_device_height_m"] = max(0.0, min(3.0, float(msg["assumed_device_height_m"])))
        if "hidden_map_ids" in msg:
            ids = msg["hidden_map_ids"]
            payload["hidden_map_ids"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "followed_addrs" in msg:
            addrs = msg["followed_addrs"]
            _new_followed = [str(x).upper() for x in addrs if isinstance(x, str)] if isinstance(addrs, list) else []
            payload["followed_addrs"] = _new_followed
            try:
                _old_followed = set(str(x).upper() for x in (st.data.get("followed_addrs") or []))
            except Exception:
                _old_followed = set()
            # Clear coordinator state for unfollowed objects so they don't
            # linger on the overview 3D map as stale ghosts.
            try:
                _removed_f = _old_followed - set(x.upper() for x in _new_followed)
                if _removed_f:
                    _coord_f = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
                    if _coord_f:
                        for _rf in _removed_f:
                            _coord_f.clear_object_state(_rf)
            except Exception:
                pass
            # Auto-label newly-followed objects that have no label yet.
            # Entity creation (device_tracker/sensor) requires user_label, so
            # following alone used to produce no entities and the device never
            # surfaced outside the panel.  Label = advertised BLE name when we
            # can see one, else a readable fallback derived from the key.
            try:
                _added_f = set(_new_followed) - _old_followed
                _obj_store_f = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
                if _added_f and _obj_store_f:
                    _name_by_mac: dict[str, str] = {}
                    try:
                        _bl_f = get_bluetooth_live(hass)
                        if _bl_f is not None:
                            for _adf in (_bl_f.get_snapshot(max_ads=5000, max_age_s=14400).get("advertisements") or []):
                                _a_addr = str(_adf.get("address") or "").upper()
                                _a_name = str(_adf.get("name") or "").strip()
                                if _a_addr and _a_name and _a_addr not in _name_by_mac:
                                    _name_by_mac[_a_addr] = _a_name
                    except Exception:
                        pass
                    for _af in _added_f:
                        if _obj_store_f.get(_af):
                            continue  # already labelled by the user
                        _parts_f = _af.split(":")
                        _mac_f = None
                        if len(_parts_f) >= 6 and all(len(p) == 2 for p in _parts_f[-6:]):
                            _mac_f = ":".join(_parts_f[-6:])
                        _lbl_f = _name_by_mac.get(_mac_f or _af, "")
                        if not _lbl_f:
                            if _af.startswith("IBEACON:") and len(_parts_f) >= 4:
                                _lbl_f = f"iBeacon {_parts_f[1][:8].lower()}"
                                if _mac_f:
                                    _lbl_f += f" ({_mac_f[-8:]})"
                            elif _mac_f:
                                _lbl_f = _mac_f
                            else:
                                continue  # entity_id or unknown form — already tracked via HA
                        await _obj_store_f.async_set(_af, _lbl_f)
                        _LOGGER.info("Auto-labelled followed object %s as %r", _af, _lbl_f)
            except Exception as _fl_err:
                _LOGGER.debug("Follow auto-label failed: %s", _fl_err)
        if "health_reminder_enabled" in msg:
            payload["health_reminder_enabled"] = bool(msg["health_reminder_enabled"])
        if "health_reminder_last_ts" in msg:
            ts = msg["health_reminder_last_ts"]
            payload["health_reminder_last_ts"] = float(ts) if ts is not None else None
        if "maps_iso_floor_gap" in msg:
            payload["maps_iso_floor_gap"] = max(60, min(340, int(msg["maps_iso_floor_gap"])))
        if "maps_iso_horiz_gap" in msg:
            payload["maps_iso_horiz_gap"] = max(-120, min(120, int(msg["maps_iso_horiz_gap"])))
        if "maps_iso_focus" in msg:
            v = msg["maps_iso_focus"]
            payload["maps_iso_focus"] = int(v) if v is not None else None
        if "overview_iso_floor_gap" in msg:
            payload["overview_iso_floor_gap"] = max(60, min(340, int(msg["overview_iso_floor_gap"])))
        if "overview_iso_horiz_gap" in msg:
            payload["overview_iso_horiz_gap"] = max(-120, min(120, int(msg["overview_iso_horiz_gap"])))
        if "overview_iso_focus" in msg:
            v = msg["overview_iso_focus"]
            payload["overview_iso_focus"] = int(v) if v is not None else None
        if "lights_hidden" in msg:
            ids = msg["lights_hidden"]
            payload["lights_hidden"] = [str(x) for x in ids if isinstance(x, str)] if isinstance(ids, list) else []
        if "ble_max_age_s" in msg:
            payload["ble_max_age_s"] = max(30, min(14400, int(msg["ble_max_age_s"])))
        # ── Radio map / heatmap visualization controls (v0.15.x) ──────────
        if "heatmap_gain" in msg:
            payload["heatmap_gain"] = max(-20, min(20, int(msg["heatmap_gain"])))
        if "heatmap_contrast" in msg:
            payload["heatmap_contrast"] = max(-15, min(15, int(msg["heatmap_contrast"])))
        if "distortion_intensity" in msg:
            payload["distortion_intensity"] = max(0, min(100, int(msg["distortion_intensity"])))
        if "heatmap_source" in msg:
            payload["heatmap_source"] = max(0, min(100, int(msg["heatmap_source"])))
        if "auto_offset_mode" in msg:
            # "off" = manual offsets only, "partial" = auto-adjust weak scanners,
            # "full" = auto-adjust all scanners to minimize prediction error
            mode = str(msg["auto_offset_mode"]).strip().lower()
            payload["auto_offset_mode"] = mode if mode in ("off", "partial", "full") else "partial"
        if "scanner_offsets" in msg:
            raw = msg["scanner_offsets"]
            if isinstance(raw, dict):
                payload["scanner_offsets"] = {str(k): float(v) for k, v in raw.items()}
        if "adaptive_learning_enabled" in msg:
            payload["adaptive_learning_enabled"] = bool(msg["adaptive_learning_enabled"])
        if "adaptive_floor_detection" in msg:
            payload["adaptive_floor_detection"] = bool(msg["adaptive_floor_detection"])
        if "signal_loss_linger_s" in msg:
            payload["signal_loss_linger_s"] = max(10, min(300, int(msg["signal_loss_linger_s"])))
        if "advanced_extra_tabs" in msg:
            valid = {"devices","bluetooth","presence","monitor","qa","sandbox"}
            payload["advanced_extra_tabs"] = [t for t in msg["advanced_extra_tabs"] if t in valid]
        for key in ("ha_entity_tracker_enabled", "ha_entity_area_enabled",
                    "ha_entity_distance_enabled", "ha_entity_scanner_distance_enabled",
                    "mqtt_publish_enabled", "espresense_mqtt_enabled", "aggressive_ble_reseed",
                    "ha_entity_occupancy_enabled",
                    "lights_panel_enabled", "bermuda_ignore",
                    "tags_room_events_enabled", "tags_nfc_identify_enabled",
                    "tags_phone_autolink_enabled", "quiet_mode",
                    "overview_2d_mode", "beacon_profiling_enabled",
                    "trackability_rating_enabled", "walk_to_identify_enabled",
                    "radio_map_enabled", "distortion_map_enabled",
                    "compass_ring_enabled", "replay_timeline_enabled",
                    "phone_wizard_enabled", "mac_rotation_bridging",
                    "apple_auto_classify"):
            if key in msg:
                payload[key] = bool(msg[key])
        if "forensics_enabled" in msg:
            # Enabling requires an activated PadSpan Pro licence key (set via
            # padspan_ha/forensics_license_activate).  Disabling is always allowed.
            _want = bool(msg["forensics_enabled"])
            if _want and not str(st.data.get("forensics_license_key") or "").strip():
                _want = False
            payload["forensics_enabled"] = _want
        if "forensics_retention_days" in msg:
            from .forensics_store import RETENTION_CHOICES, DEFAULT_RETENTION_DAYS
            _fd = int(msg["forensics_retention_days"])
            payload["forensics_retention_days"] = _fd if _fd in RETENTION_CHOICES else DEFAULT_RETENTION_DAYS
        if "presence_poll_interval_s" in msg:
            payload["presence_poll_interval_s"] = max(1, min(60, int(msg["presence_poll_interval_s"])))
        if "ble_reseed_interval_s" in msg:
            payload["ble_reseed_interval_s"] = max(1, min(60, int(msg["ble_reseed_interval_s"])))
        if "positioning_algorithm" in msg:
            algo = str(msg["positioning_algorithm"]).strip().lower()
            payload["positioning_algorithm"] = algo if algo in ("knn", "rf") else "knn"
        if "beacon_tune_disabled" in msg:
            raw = msg["beacon_tune_disabled"]
            payload["beacon_tune_disabled"] = [str(x) for x in raw] if isinstance(raw, list) else []
        if "beacon_group_overrides" in msg:
            raw = msg["beacon_group_overrides"]
            payload["beacon_group_overrides"] = {str(k): str(v) for k, v in raw.items()} if isinstance(raw, dict) else {}
        if "distance_stationary_devices" in msg:
            raw = msg["distance_stationary_devices"]
            payload["distance_stationary_devices"] = [str(x) for x in raw] if isinstance(raw, list) else []
        if "onboarding_completed" in msg:
            payload["onboarding_completed"] = bool(msg["onboarding_completed"])
        if "espresense_companion_url" in msg:
            _url = str(msg["espresense_companion_url"]).strip().rstrip("/")
            payload["espresense_companion_url"] = _url
        if "espresense_topic_prefix" in msg:
            _raw_prefix = str(msg["espresense_topic_prefix"]).strip().strip("/").replace("#", "").replace("+", "")
            if _raw_prefix:
                payload["espresense_topic_prefix"] = _raw_prefix
        if "espresense_room_map" in msg:
            _raw_rm = msg["espresense_room_map"]
            payload["espresense_room_map"] = {str(k): str(v) for k, v in _raw_rm.items()} if isinstance(_raw_rm, dict) else {}
        # ── Occupancy estimation controls ──────────────────────────────────
        if "occupancy_multiplier" in msg:
            payload["occupancy_multiplier"] = max(0.5, min(10.0, float(msg["occupancy_multiplier"])))
        if "occupancy_dwell_min" in msg:
            payload["occupancy_dwell_min"] = max(0.0, min(60.0, float(msg["occupancy_dwell_min"])))
        if "occupancy_cluster_threshold" in msg:
            payload["occupancy_cluster_threshold"] = max(2.0, min(30.0, float(msg["occupancy_cluster_threshold"])))
        if "occupancy_hybrid_enabled" in msg:
            payload["occupancy_hybrid_enabled"] = bool(msg["occupancy_hybrid_enabled"])
        if "padspan_automations" in msg:
            # Validate and sanitize each rule
            _clean_rules = []
            for r in (msg["padspan_automations"] or []):
                if not isinstance(r, dict):
                    continue
                _clean_rules.append({
                    "id": str(r.get("id", "")),
                    "trigger": str(r.get("trigger", ""))[:10],
                    "device_key": str(r.get("device_key", "")),
                    "device_label": str(r.get("device_label", ""))[:80],
                    "action": str(r.get("action", ""))[:20],
                    "entity_id": str(r.get("entity_id", ""))[:120],
                    "enabled": bool(r.get("enabled", True)),
                })
            payload["padspan_automations"] = _clean_rules
        await st.async_set(**payload)

        # ── Dynamic ESPresense MQTT toggle ───────────────────────────────────
        if "espresense_mqtt_enabled" in msg:
            try:
                if bool(msg["espresense_mqtt_enabled"]):
                    _prefix = st.data.get("espresense_topic_prefix", "espresense")
                    from .espresense_mqtt import async_setup_espresense_mqtt
                    hass.async_create_task(async_setup_espresense_mqtt(hass, _prefix))
                else:
                    _esp = hass.data.get(DOMAIN, {}).pop(DATA_ESPRESENSE_MQTT, None)
                    if _esp:
                        hass.async_create_task(_esp.async_stop())
            except Exception:
                pass

        # ── Toggle existing PadSpan entities in HA registry ──────────────────
        _entity_keys = {
            "ha_entity_tracker_enabled": "__tracker",
            "ha_entity_area_enabled": "__area",
            "ha_entity_distance_enabled": "__distance",
            "ha_entity_scanner_distance_enabled": "__dist__",
        }
        _toggled_any = False
        for _skey, _suffix in _entity_keys.items():
            if _skey not in msg:
                continue
            _enabled = bool(msg[_skey])
            try:
                _er = entity_registry.async_get(hass)
                _disabler = entity_registry.RegistryEntryDisabler.INTEGRATION
                for _entry in list(_er.entities.values()):
                    if _entry.platform != DOMAIN:
                        continue
                    _uid = _entry.unique_id or ""
                    # __dist__ matches scanner-distance; __distance matches global distance
                    # Make sure __distance doesn't match __dist__ entries
                    if _suffix == "__distance" and "__dist__" in _uid:
                        continue
                    if _suffix not in _uid:
                        continue
                    if _enabled and _entry.disabled_by == _disabler:
                        _er.async_update_entity(_entry.entity_id, disabled_by=None)
                        _toggled_any = True
                    elif not _enabled and _entry.disabled_by is None:
                        _er.async_update_entity(_entry.entity_id, disabled_by=_disabler)
                        _toggled_any = True
            except Exception:
                _LOGGER.debug("Failed to toggle entities for %s", _skey, exc_info=True)
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"settings": _get_settings(hass)})


@websocket_api.websocket_command({"type": "padspan_ha/calibration_health_check"})
@websocket_api.async_response
async def ws_calibration_health_check(hass: HomeAssistant, connection, msg) -> None:
    """Analyse calibration data quality for the Health Reminder notification.

    Checks:
      - Staleness: how many days since the last calibration capture
      - Scanner anomalies: scanners whose mean RSSI deviates >12 dBm from fleet avg
      - Sparse coverage: grid cells below 0.8 coverage score per map (top 3 worst)

    Returns has_issues=True if any check fails, enabling the UI health badge.
    """
    from datetime import datetime, timezone as _tz  # noqa: PLC0415

    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    settings: dict[str, Any] = (st.data or {}) if st else {}
    enabled = bool(settings.get("health_reminder_enabled", False))

    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    points: list[dict[str, Any]] = (cal.data.get("points") or []) if cal else []

    now_ts = datetime.now(_tz.utc).timestamp()

    # ── Staleness ──────────────────────────────────────────────────────────────
    stale_days: float | None = None
    if points:
        isos = [p.get("collected_at") or "" for p in points]
        latest_iso = max((s for s in isos if s), default="")
        if latest_iso:
            try:
                latest_ts = datetime.fromisoformat(latest_iso).timestamp()
                stale_days = round((now_ts - latest_ts) / 86400)
            except Exception:
                pass

    # ── Per-scanner mean-RSSI anomalies ───────────────────────────────────────
    scanner_sum: dict[str, float] = {}
    scanner_cnt: dict[str, int] = {}
    for p in points:
        for r in (p.get("scanner_readings") or []):
            src = r.get("source")
            mean_rssi = r.get("mean_rssi")
            if src and mean_rssi is not None:
                scanner_sum[src] = scanner_sum.get(src, 0.0) + float(mean_rssi)
                scanner_cnt[src] = scanner_cnt.get(src, 0) + 1

    scanner_anomalies: list[dict[str, Any]] = []
    if scanner_sum:
        means = {s: scanner_sum[s] / scanner_cnt[s] for s in scanner_sum}
        grand_mean = sum(means.values()) / len(means)
        for src, mean in means.items():
            if scanner_cnt[src] < 3:
                continue
            dev = mean - grand_mean
            if abs(dev) > 12:
                direction = "above" if dev > 0 else "below"
                scanner_anomalies.append({
                    "scanner": src,
                    "deviation_db": round(dev, 1),
                    "message": (
                        f"'{src}' reads {abs(dev):.0f} dBm {direction} the fleet average "
                        f"({scanner_cnt[src]} calibration point(s)). "
                        "Consider re-running the walk-around near this scanner."
                    ),
                    "severity": "warning",
                })

    # ── Sparse coverage spots — top 3 least-covered positions per map ─────────
    maps_store = hass.data.get(DOMAIN, {}).get("maps")
    all_maps: list[dict[str, Any]] = []
    map_ids: list[str] = []
    if maps_store:
        try:
            all_maps = maps_store.data.get("maps") or []
            map_ids = [m["id"] for m in all_maps]
        except Exception:
            pass
    map_name_lookup: dict[str, str] = {m["id"]: m.get("name", "") for m in all_maps}

    recommended_spots: list[dict[str, Any]] = []
    if cal and map_ids:
        for mid in map_ids:
            cov = cal.compute_coverage(mid)
            if cov["point_count"] == 0:
                continue  # no calibration data for this map yet
            grid = cov["grid"]
            n = cov["grid_n"]
            # Collect cells below 0.8 coverage, sorted worst-first; return up to 3
            cells = sorted(
                ((grid[cy * n + cx], cx, cy) for cy in range(n) for cx in range(n)),
                key=lambda t: t[0],
            )
            count = 0
            for score, cx, cy in cells:
                if score >= 0.8 or count >= 3:
                    break
                recommended_spots.append({
                    "map_id": mid,
                    "map_name": map_name_lookup.get(mid, ""),
                    "x_frac": round((cx + 0.5) / n, 3),
                    "y_frac": round((cy + 0.5) / n, 3),
                    "coverage_score": round(score, 3),
                })
                count += 1

    has_issues = bool(scanner_anomalies) or bool(recommended_spots) or (
        stale_days is not None and stale_days > 60
    )

    # ── Per-scanner summary for the UI ────────────────────────────────────────
    # Includes name from live radios, point count, and mean RSSI.
    coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
    live_radios: list[dict[str, Any]] = []
    if coord:
        try:
            live_radios = coord.data.get("ble", {}).get("radios", []) if coord.data else []
        except Exception:
            pass
    radio_name_map: dict[str, str] = {}
    for _r in live_radios:
        _src = _r.get("source") or ""
        _nm = _r.get("name") or _r.get("area_name") or _r.get("area") or ""
        if _src and _nm:
            radio_name_map[_src] = _nm

    scanner_summary: list[dict[str, Any]] = []
    for src in sorted(scanner_sum.keys(), key=lambda s: scanner_cnt.get(s, 0), reverse=True):
        cnt = scanner_cnt[src]
        mean = round(scanner_sum[src] / cnt, 1) if cnt else 0
        scanner_summary.append({
            "source": src,
            "name": radio_name_map.get(src, ""),
            "point_count": cnt,
            "mean_rssi": mean,
        })

    connection.send_result(msg["id"], {
        "enabled": enabled,
        "point_count": len(points),
        "stale_days": stale_days,
        "scanner_anomalies": scanner_anomalies,
        "scanner_summary": scanner_summary,
        "recommended_spots": recommended_spots,
        "has_issues": has_issues,
    })


@websocket_api.websocket_command({"type": "padspan_ha/live_snapshot"})
@websocket_api.async_response
async def ws_live_snapshot(hass: HomeAssistant, connection, msg) -> None:
    """Return the full live snapshot to the panel, enriched with presence + calibration data.

    This is called every 5s by the panel's poll loop.  It:
      1. Builds the raw snapshot via _live_snapshot()
      2. Overlays smoothed k-NN positions from the presence coordinator
      3. Injects stale followed objects that are missing from BLE
      4. Attaches calibration status metadata for the Setup tab
    """
    snap = await _live_snapshot(hass)

    # The snapshot is shared via the TTL cache — shallow-copy the envelope and
    # the object dicts before the overlays below so mutations never leak into
    # other callers (notably the presence coordinator's next poll).
    snap = dict(snap)
    try:
        _objs_env = dict(snap.get("objects") or {})
        _objs_env["list"] = [dict(_o) for _o in (_objs_env.get("list") or [])]
        snap["objects"] = _objs_env
    except Exception:
        pass

    # Overlay presence-coordinator smoothed data (x_frac, y_frac,
    # knn_confidence, room, room_confidence) so the UI can show
    # calibration-derived positions and stable room assignments.
    try:
        pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if pc and pc.data:
            _MERGE_KEYS = ("x_frac", "y_frac", "knn_confidence", "knn_map_id",
                           "room", "room_confidence", "rssi_margin_confidence",
                           "_smoothed", "_stale")
            obj_list = (snap.get("objects") or {}).get("list") or []
            for obj in obj_list:
                key = obj.get("key", "")
                if not key:
                    continue
                smoothed = pc.data.get(key)
                if not smoothed:
                    continue
                for mk in _MERGE_KEYS:
                    val = smoothed.get(mk)
                    if val is not None:
                        obj[mk] = val
    except Exception as _overlay_err:
        _LOGGER.warning("Coordinator overlay failed — positioning data may be stale: %s", _overlay_err, exc_info=True)

    # Rebuild room_tag_map from overlaid objects so the map matches the
    # presence coordinator's smoothed room assignments (spatial centroid).
    # Without this, the map uses pre-overlay raw RSSI rooms while the
    # object list uses post-overlay smoothed rooms → mismatch.
    try:
        _rtm_fresh: dict[str, list[str]] = {}
        for _obj in (snap.get("objects") or {}).get("list") or []:
            _r = _obj.get("room")
            _eid = _obj.get("entity_id") or _obj.get("key") or ""
            if _r and _eid:
                _rtm_fresh.setdefault(_r, []).append(_eid)
        if _rtm_fresh:
            snap["room_tag_map_live"] = _rtm_fresh
            snap["room_tag_map"] = _rtm_fresh
    except Exception:
        pass

    # Inject calibration status so the UI knows the state of the cal store
    try:
        _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if _cal:
            _pts = _cal.data.get("points", [])
            _auto = sum(1 for p in _pts if str(p.get("label", "")).startswith("[auto]"))
            _empty = sum(1 for p in _pts if not (p.get("scanner_readings") or []))
            _knn_active_count = 0
            _spatial_active_count = 0
            _pc3 = hass.data.get(DOMAIN, {}).get("presence_coordinator")
            if _pc3:
                _knn_active_count = len(getattr(_pc3, "_knn_position", {}))
                _spatial_active_count = len(getattr(_pc3, "_spatial_position", {}))
            # Collect all scanner source names used in calibration data
            _cal_sources = set()
            for _p in _pts:
                for _r in (_p.get("scanner_readings") or []):
                    if _r.get("source"):
                        _cal_sources.add(_r["source"])

            # Live k-NN diagnostic: pick up to 3 objects with EMA data from the
            # presence coordinator and test them against the calibration store
            _knn_diag = []
            _ema_sources = set()
            if _pc3:
                _ema_dict = getattr(_pc3, "_ema_rssi", {})
                for _ek, _ev in list(_ema_dict.items())[:5]:
                    _ema_sources.update(_ev.keys())
                    _shared = set(_ev.keys()) & _cal_sources
                    _result = _cal.knn_locate(dict(_ev)) if _shared else None
                    _knn_diag.append({
                        "key": _ek[:40],
                        "ema_scanners": len(_ev),
                        "ema_sources": sorted(list(_ev.keys()))[:5],
                        "shared_with_cal": len(_shared),
                        "knn_result": {
                            "confidence": _result.get("confidence") if _result else None,
                            "room": _result.get("nearest_room") if _result else None,
                            "map_id": (_result.get("map_id") or "")[:20] if _result else None,
                            "k_used": _result.get("k_used") if _result else None,
                            "shared_scanners": _result.get("shared_scanners") if _result else None,
                        } if _result else None,
                    })
            snap["calibration_status"] = {
                "total_points": len(_pts),
                "auto_points": _auto,
                "manual_points": len(_pts) - _auto,
                "empty_points": _empty,
                "maps": len({p.get("map_id") for p in _pts if p.get("map_id")}),
                "scanners": len({r.get("source") for p in _pts for r in (p.get("scanner_readings") or [])}),
                "knn_min_required": 5,
                "knn_active": len(_pts) >= 5,
                "knn_positioned_objects": _knn_active_count,
                "spatial_positioned_objects": _spatial_active_count,
                "store_initialized": True,
                "rf_trained": getattr(_cal, "rf_trained", False),
                "positioning_algorithm": (
                    (hass.data.get(DOMAIN, {}).get(DATA_SETTINGS).data.get("positioning_algorithm", "knn"))
                    if hass.data.get(DOMAIN, {}).get(DATA_SETTINGS) else "knn"
                ),
                "cal_sources": sorted(list(_cal_sources))[:20],
                "ema_sources": sorted(list(_ema_sources))[:20],
                "source_overlap": len(_cal_sources & _ema_sources),
                "knn_diag": _knn_diag,
            }
        else:
            snap["calibration_status"] = {
                "total_points": 0,
                "store_initialized": False,
                "knn_active": False,
                "knn_positioned_objects": 0,
                "spatial_positioned_objects": 0,
            }
    except Exception:
        pass

    # ── Traceback: record AFTER all overlays (k-NN, stale injection) ─────────
    # Objects now have x_frac, y_frac, knn_map_id, room (smoothed),
    # room_confidence — everything the traceback view needs for precise placement.
    try:
        from .const import DATA_TRACEBACK  # noqa: PLC0415
        _tb_store = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
        if _tb_store:
            _tb_objs = (snap.get("objects") or {}).get("list") or []
            _tb_followed = set(_get_settings(hass).get("followed_addrs") or [])
            _tb_store.record_frame(_tb_objs, followed_set=_tb_followed)
            await _tb_store.async_maybe_save()
    except Exception:
        pass

    # ── Expose suspend status ──────────────────────────────────────────────
    try:
        _pc_sus = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if _pc_sus:
            snap["suspended"] = _pc_sus.suspended
            if _pc_sus.suspended:
                import time as _time_mod
                if _pc_sus._suspend_permanent:
                    snap["suspend_remaining_s"] = 0  # permanent until unsuspended
                else:
                    _remaining = max(0, _pc_sus._suspend_until - _time_mod.monotonic())
                    snap["suspend_remaining_s"] = round(_remaining)
    except Exception:
        pass

    connection.send_result(msg["id"], {"snapshot": snap})


@websocket_api.websocket_command({
    "type": "padspan_ha/scanner_offset_set",
    "source": str,
    vol.Optional("offset_db", default=0.0): vol.Coerce(float),
})
@websocket_api.async_response
async def ws_scanner_offset_set(hass: HomeAssistant, connection, msg) -> None:
    """Set (or clear) the RSSI calibration offset for a single Bluetooth scanner."""
    source = str(msg.get("source", "")).strip()
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source required")
        return
    offset = max(-50.0, min(50.0, float(msg.get("offset_db", 0.0))))
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        offsets: dict[str, float] = dict(st.data.get("scanner_offsets") or {})
        if offset == 0.0:
            offsets.pop(source, None)   # zero = no offset, clean up
        else:
            offsets[source] = round(offset, 1)
        await st.async_set(scanner_offsets=offsets)
    connection.send_result(msg["id"], {"source": source, "offset_db": offset})


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

import time as _time
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
        vol.Optional("rf_barriers"): list,
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

    _lights = msg.get("lights")
    _lights_blocked = _lights is not None and not _padspan_pro_active(hass)
    if _lights_blocked:
        _lights = None

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
            rf_barriers=msg.get("rf_barriers"),
            stack=msg.get("stack"),
            lights=_lights,
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

    # ── Phase 2: sync spatial data to real-world model when map changes ───
    try:
        _mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if _mdl and (updated.get("id") or map_id) in (_mdl.data.get("map_transforms") or {}):
            await _mdl.async_sync_spatial_from_map(map_id, updated)
    except Exception:
        pass  # best-effort

    # ── Phase 3: remap calibration points from metres when map changes ───
    # Skipped for stack-only saves (issue #56): the 3D alignment editor only
    # writes the cosmetic stack, which the metre transform does not depend
    # on — re-deriving fracs here was rewriting calibration pins through a
    # transform whose origin no longer matched the stored metres.
    _stack_only = (
        msg.get("stack") is not None
        and msg.get("receivers") is None and _beacons is None
        and msg.get("calibration") is None and _incoming_rb is None
        and msg.get("rf_barriers") is None and msg.get("floor_id") is None
    )
    if not _stack_only:
        try:
            _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
            if _cal:
                await _cal.async_remap_from_metres(map_id)
        except Exception:
            pass  # best-effort

    connection.send_result(msg["id"], {"map": updated, "lights_blocked": _lights_blocked})


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
        pass

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

    src_stk = src_map.get("stack") or {}
    tgt_stk = tgt_map.get("stack") or {}

    def _xform(px: float, py: float) -> tuple[float, float]:
        """Source map 0-1 → target map 0-1 via world coords.

        Maps use fractional coordinates [0,1].  The stack alignment gives each
        map a world-space position/scale.  We go source→world→target to
        preserve spatial accuracy when merging maps at different zoom levels.
        """
        wx, wy = ms.map_to_world(px, py, src_stk)
        return ms.world_to_map(wx, wy, tgt_stk)

    def _xform_bounds(bounds: dict) -> dict:
        """Transform a room_bounds entry from source → target space."""
        b = dict(bounds)
        if b.get("type") == "poly" and isinstance(b.get("points"), list):
            b["points"] = [list(_xform(p[0], p[1])) for p in b["points"] if len(p) >= 2]
        elif b.get("type") == "circle":
            cx, cy = _xform(b.get("cx", 0.5), b.get("cy", 0.5))
            b["cx"] = cx
            b["cy"] = cy
            # Scale radius: transform a point at (cx+r, cy) and measure distance
            r = float(b.get("r", 0.12))
            rx, ry = _xform(b.get("cx", 0.5) + r, b.get("cy", 0.5))
            b["r"] = max(0.01, ((rx - cx) ** 2 + (ry - cy) ** 2) ** 0.5)
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
                await ms.async_extend_canvas(tgt_id, pad_left, pad_right, pad_top, pad_bottom)
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
    result = await ms.async_revert_extend(msg.get("map_id") or "")
    if result:
        connection.send_result(msg["id"], {"ok": True})
    else:
        connection.send_result(msg["id"], {"ok": False, "reason": "no_extend_snapshot"})


# ── Object Labelling ───────────────────────────────────────────────────────────

@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_set",
        "address": str,
        "label": str,
    }
)
@websocket_api.async_response
async def ws_object_label_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a user label to a BLE object (MAC, ibeacon key, or canonical_id).

    Labels are the primary way users "identify" BLE objects.  A labelled object
    gets "identified: true", which keeps it in history forever and surfaces it
    prominently in the UI.

    Key behavior:
      - Rotating MACs (RPAs) are resolved to a stable canonical_id via IRK so
        the label survives address rotation.
      - The label is cross-stored under ALL stable identity keys for the same
        physical device (canonical_id, iBeacon key, static MAC).  This prevents
        the device from splitting into labelled + unlabelled halves when one
        identity is seen in a snapshot but not another.
    """
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip()
    # Only uppercase plain MAC addresses; leave ibeacon/irk keys as-is
    if len(addr) == 17 and addr.count(":") == 5:
        addr = addr.upper()
    label = str(msg.get("label") or "").strip()[:48]
    if not addr:
        connection.send_error(msg["id"], "invalid_address", "Address is required")
        return
    if not label:
        connection.send_error(msg["id"], "invalid_label", "Label is required")
        return

    # If the address is a rotating MAC (RPA), resolve to canonical_id so the
    # label survives BLE address rotation (iPhones, Android phones).
    store_addr = addr
    if len(addr) == 17 and addr.count(":") == 5 and not addr.startswith("irk:"):
        try:
            from .private_ble_resolver import get_resolver  # noqa: PLC0415
            resolver = await get_resolver(hass)
            resolved = resolver.resolve_address(addr)
            if resolved and resolved.get("canonical_id"):
                store_addr = resolved["canonical_id"]
                _LOGGER.debug(
                    "object_label_set: resolved rotating MAC %s → %s",
                    addr, store_addr,
                )
        except Exception:
            pass

    await obj_store.async_set(store_addr, label)

    # ── Cross-store label under ALL stable identities ─────────────────
    # A device can broadcast as ble (MAC), ibeacon (key), private_ble
    # (canonical_id), or entity.  If we only store the label under one
    # key, the device splits into labelled + unlabelled when the merge
    # doesn't fire in a particular snapshot cycle.  Fix: find the device
    # in the object history cache and store the label under every key.
    _cross_stored: list[str] = [store_addr]
    try:
        _dom = hass.data.get(DOMAIN, {})
        _cache = _dom.get(DATA_OBJECT_HISTORY) or {}

        # Find the object in cache that matches the address we just labelled
        _target = _cache.get(addr) or _cache.get(store_addr)

        # If not found by direct key, search by exact key/canonical matches
        # FIRST across the whole cache, then fall back to all_addresses.
        # all_addresses can over-claim (merged-era sibling entries listed each
        # other's MACs) — an exact match must always win over a claimed MAC.
        if not _target:
            addr_upper = addr.upper()
            store_upper = store_addr.upper()
            for _key, _obj in _cache.items():
                if _key.upper() == addr_upper or _key.upper() == store_upper:
                    _target = _obj
                    break
                if _obj.get("canonical_id") == store_addr or _obj.get("canonical_id") == addr:
                    _target = _obj
                    break
        if not _target:
            addr_upper = addr.upper()
            for _key, _obj in _cache.items():
                _all = _obj.get("all_addresses") or []
                if any(str(a).upper() == addr_upper for a in _all):
                    _target = _obj
                    break

        if _target:
            # Collect all stable keys for this device
            _keys_to_label: set[str] = set()

            # canonical_id (private_ble identity)
            _cid = _target.get("canonical_id")
            if _cid:
                _keys_to_label.add(_cid)

            # iBeacon key
            _ib_key = _target.get("key", "")
            if _ib_key and _ib_key.startswith("ibeacon:"):
                _keys_to_label.add(_ib_key)
                _keys_to_label.add(_ib_key.upper())

            # Build ibeacon key from metadata if available.
            # NEVER for split objects or factory-default UUIDs: the unsplit
            # group key is shared by every beacon in a multi-pack, so storing
            # a label under it stamps the whole pack with one beacon's name
            # (and resurrects the merged-ghost problem on every rename).
            _t_key = str(_target.get("key") or "")
            _t_is_split = _t_key.startswith("ibeacon:") and len(_t_key.split(":")) > 4
            _ib_uuid = _target.get("ibeacon_uuid")
            _uuid_is_default = str(_ib_uuid or "").lower() in _DEFAULT_IBEACON_UUIDS
            if _ib_uuid is not None and not _t_is_split and not _uuid_is_default:
                _ib_major = _target.get("ibeacon_major", 0)
                _ib_minor = _target.get("ibeacon_minor", 0)
                _ib_k = f"ibeacon:{_ib_uuid}:{_ib_major}:{_ib_minor}"
                _keys_to_label.add(_ib_k)
                _keys_to_label.add(_ib_k.upper())

            # Static MAC address (non-rotating — starts with non-random prefix)
            _obj_addr = _target.get("address", "")
            if _obj_addr and len(_obj_addr) == 17 and _obj_addr.count(":") == 5:
                # Only store under MAC if it's not a rotating random address
                _first_byte = int(_obj_addr[:2], 16) if _obj_addr[:2].replace(":", "") else 0
                if not (_first_byte & 0x02):  # bit 1 clear = globally unique (not random)
                    _keys_to_label.add(_obj_addr.upper())

            # Remove keys we already stored under
            _keys_to_label.discard(store_addr)
            _keys_to_label.discard(store_addr.upper() if store_addr == store_addr.upper() else store_addr)

            for _xk in _keys_to_label:
                if _xk and not obj_store.get(_xk):
                    await obj_store.async_set(_xk, label)
                    _cross_stored.append(_xk)

            if len(_cross_stored) > 1:
                _LOGGER.info(
                    "object_label_set: cross-stored '%s' under %d keys: %s",
                    label, len(_cross_stored), _cross_stored,
                )
    except Exception as _xs_err:
        _LOGGER.debug("object_label_set cross-store: %s", _xs_err)

    # ── DeviceRegistry: persist label on stable padspan_id ──────────────
    _padspan_id = None
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            # Resolve or create persistent device entry
            _kind = "ibeacon" if store_addr.startswith("ibeacon:") else "irk" if store_addr.startswith("irk:") else "mac"
            _padspan_id = _dev_reg.resolve_or_create(store_addr, kind=_kind, persist=True)

            # Link all known identities to this padspan_id
            if addr != store_addr:
                _ak = "ibeacon" if addr.startswith("ibeacon:") else "irk" if addr.startswith("irk:") else "mac"
                await _dev_reg.async_add_identity(_padspan_id, _ak, addr)
            for _xk in _cross_stored:
                if _xk != store_addr and _xk != addr:
                    _xkind = "ibeacon" if _xk.startswith("ibeacon:") else "irk" if _xk.startswith("irk:") else "mac"
                    await _dev_reg.async_add_identity(_padspan_id, _xkind, _xk)

            # Set the label on the padspan_id
            await _dev_reg.async_set_label(_padspan_id, label)
            _LOGGER.debug("DeviceRegistry: labeled %s as '%s' (padspan_id=%s)", store_addr, label, _padspan_id)
    except Exception as _dr_err:
        _LOGGER.debug("DeviceRegistry label_set: %s", _dr_err)

    # Warn when another DEVICE already uses this label.  Labels drive HA
    # entity/device naming downstream, so two devices sharing a label end
    # up merged into one HA device with doubled sensors.
    _dup_keys: list[str] = []
    try:
        _cross_set = {str(k).upper() for k in _cross_stored}
        for _ok, _oe in (obj_store.all() or {}).items():
            if str(_oe.get("label") or "").strip() == label and str(_ok).upper() not in _cross_set:
                _dup_keys.append(_ok)
    except Exception:
        pass

    _result: dict[str, Any] = {
        "ok": True, "address": store_addr, "label": label,
        "cross_stored": _cross_stored,
        "padspan_id": _padspan_id,
    }
    if _dup_keys:
        _result["duplicate_label_keys"] = _dup_keys
        _result["warning"] = (
            f"Label '{label}' is already used by {len(_dup_keys)} other device(s). "
            "Devices sharing a label merge into one HA device — use unique names."
        )
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], _result)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_delete",
        "address": str,
    }
)
@websocket_api.async_response
async def ws_object_label_delete(hass: HomeAssistant, connection, msg) -> None:
    """Remove the user label for a BLE MAC address."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip()
    # Only uppercase plain MAC addresses; leave ibeacon/irk keys as-is
    if len(addr) == 17 and addr.count(":") == 5:
        addr = addr.upper()
    # Resolve rotating MAC → canonical_id (same as label_set)
    if addr and len(addr) == 17 and addr.count(":") == 5 and not addr.startswith("irk:"):
        try:
            from .private_ble_resolver import get_resolver  # noqa: PLC0415
            resolver = await get_resolver(hass)
            resolved = resolver.resolve_address(addr)
            if resolved and resolved.get("canonical_id"):
                addr = resolved["canonical_id"]
        except Exception:
            pass
    if addr:
        # Get the label before deleting so we can find cross-stored copies
        _entry = obj_store.get(addr)
        _del_label = (_entry.get("label", "") if _entry else "").strip()
        await obj_store.async_delete(addr)

        # Also delete cross-stored copies under other identity keys
        _cross_deleted: list[str] = [addr]
        if _del_label:
            try:
                _all_labels = obj_store.all()
                for _key, _val in list(_all_labels.items()):
                    if _key == addr.upper() or _key == addr:
                        continue
                    if _val.get("label", "").strip() == _del_label:
                        # Verify it belongs to the same device by checking
                        # the object history cache for cross-references
                        _dom = hass.data.get(DOMAIN, {})
                        _cache = _dom.get(DATA_OBJECT_HISTORY) or {}
                        _obj_for_key = _cache.get(_key)
                        _obj_for_addr = _cache.get(addr)
                        # If both point to the same canonical_id or same
                        # ibeacon key, they're the same device
                        _same = False
                        if _obj_for_key and _obj_for_addr:
                            cid1 = _obj_for_key.get("canonical_id")
                            cid2 = _obj_for_addr.get("canonical_id")
                            if cid1 and cid2 and cid1 == cid2:
                                _same = True
                            k1 = _obj_for_key.get("key", "")
                            k2 = _obj_for_addr.get("key", "")
                            if k1 and k2 and k1 == k2:
                                _same = True
                        # Also same if one key is an ibeacon variant of the other
                        if _key.upper() == addr.upper():
                            _same = True
                        if _key.startswith("ibeacon:") or _key.startswith("IBEACON:"):
                            if addr.startswith("ibeacon:") or addr.startswith("IBEACON:"):
                                if _key.lower() == addr.lower():
                                    _same = True
                        if _same:
                            await obj_store.async_delete(_key)
                            _cross_deleted.append(_key)
            except Exception as _xd_err:
                _LOGGER.debug("object_label_delete cross-delete: %s", _xd_err)

        # Clear identified/user_label from object history cache so the ghost
        # doesn't linger indefinitely after label deletion
        try:
            _dom = hass.data.get(DOMAIN, {})
            _hist_cache = _dom.get(DATA_OBJECT_HISTORY) or {}
            for _del_key in _cross_deleted:
                _hobj = _hist_cache.get(_del_key)
                if _hobj:
                    _hobj.pop("identified", None)
                    _hobj.pop("user_label", None)
            # Also scan cache for any entry with the deleted label
            if _del_label:
                for _hk, _hv in _hist_cache.items():
                    if _hv.get("user_label") == _del_label:
                        _hv.pop("identified", None)
                        _hv.pop("user_label", None)
        except Exception:
            pass

    # ── DeviceRegistry: clear label on stable padspan_id ──────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg and addr:
            _pid = _dev_reg.resolve(addr)
            if _pid:
                await _dev_reg.async_delete_label(_pid)
                _LOGGER.debug("DeviceRegistry: cleared label for %s (padspan_id=%s)", addr, _pid)
    except Exception as _dr_err:
        _LOGGER.debug("DeviceRegistry label_delete: %s", _dr_err)

    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"ok": True, "address": addr})


@websocket_api.websocket_command({"type": "padspan_ha/object_label_list"})
@websocket_api.async_response
async def ws_object_label_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all stored object labels from ObjectStore + DeviceRegistry."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    labels = obj_store.all() if obj_store else {}
    # Enrich with DeviceRegistry data
    _reg_labels = {}
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            for pid, dev in _dev_reg.all_labeled().items():
                _reg_labels[pid] = {
                    "label": dev.get("label", ""),
                    "padspan_id": pid,
                    "identities": len(dev.get("identities", [])),
                    "source": "device_registry",
                }
    except Exception:
        pass
    connection.send_result(msg["id"], {
        "labels": labels,
        "registry_labels": _reg_labels,
    })


@websocket_api.websocket_command({"type": "padspan_ha/objects_clear_history"})
@websocket_api.async_response
async def ws_objects_clear_history(hass: HomeAssistant, connection, msg) -> None:
    """Purge untagged/unfollowed objects from the 7-day history cache.

    WHY: Over time the cache accumulates hundreds of transient neighbour
    devices.  This lets the user declutter without losing their labelled
    or followed devices.  Tagged and followed objects are always preserved.
    Forces an immediate disk save so the purge survives restarts.
    """
    _dom = hass.data.get(DOMAIN, {})
    _cache: dict | None = _dom.get(DATA_OBJECT_HISTORY)
    if not _cache:
        connection.send_result(msg["id"], {"ok": True, "removed": 0, "kept": 0})
        return

    obj_store = _dom.get(DATA_OBJECTS)
    labelled_keys: set[str] = set()
    if obj_store:
        for addr, entry in (obj_store.all() or {}).items():
            if entry.get("label"):
                labelled_keys.add(addr)

    # Also preserve followed objects
    followed_set: set[str] = set()
    st = _dom.get(DATA_SETTINGS)
    if st:
        for fa in (st.data.get("followed_addrs") or []):
            followed_set.add(str(fa).upper())

    removed = 0
    kept = 0
    for key in list(_cache.keys()):
        cached = _cache[key]
        has_label = cached.get("user_label") or key in labelled_keys
        addr = (cached.get("address") or "").upper()
        if addr and addr in labelled_keys:
            has_label = True
        # Also keep if followed
        if not has_label:
            ck = key.upper()
            if ck in followed_set or addr in followed_set:
                has_label = True
        if has_label:
            kept += 1
        else:
            del _cache[key]
            removed += 1

    # Force immediate save
    from homeassistant.helpers.storage import Store as _Store
    _hist_store = _dom.get("_obj_hist_store")
    if _hist_store is None:
        _hist_store = _Store(hass, 1, OBJECT_HISTORY_STORE_KEY)
        _dom["_obj_hist_store"] = _hist_store
    _save_data = {}
    for _k, _v in _cache.items():
        _sv = dict(_v)
        _sv.pop("_smoothed", None)
        _sv.pop("_stale", None)
        _save_data[_k] = _sv
    await _hist_store.async_save(_save_data)

    _LOGGER.info("Object history cleared: removed %d, kept %d tagged", removed, kept)
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"ok": True, "removed": removed, "kept": kept})


# ── Forensics (opt-in time-window presence queries — issue #55) ───────────────
# Data comes from ForensicsStore (real recorded sessions) with a lower-
# confidence fallback over the object-history cache's first/last-seen span.
# NOTHING here ships in live_snapshot; these are on-demand queries only.

@websocket_api.websocket_command(
    {
        "type": "padspan_ha/forensics_query",
        vol.Required("from_ts"): vol.Coerce(float),
        vol.Required("to_ts"): vol.Coerce(float),
    }
)
@websocket_api.async_response
async def ws_forensics_query(hass: HomeAssistant, connection, msg) -> None:
    """Return devices present (recorded) or possibly present (first/last-seen
    overlap) during [from_ts, to_ts] (epoch seconds)."""
    from .const import DATA_FORENSICS
    from .forensics_store import retention_days

    from_ts = float(msg["from_ts"])
    to_ts = float(msg["to_ts"])
    if to_ts < from_ts:
        from_ts, to_ts = to_ts, from_ts

    _dom = hass.data.get(DOMAIN, {})
    fs = _dom.get(DATA_FORENSICS)
    # The query is a sync scan over every stored session — run it off the
    # event loop (only the 60s tick otherwise touches the store's dict).
    recorded = await hass.async_add_executor_job(fs.query, from_ts, to_ts, 500) if fs else []
    stats = fs.stats() if fs else {}

    # Label + vendor enrichment from ObjectStore / object-history cache.
    # Rotating-MAC devices (private BLE / split iBeacon) are cached under
    # irk:/ibeacon: keys with the current MAC only in the entry's address /
    # all_addresses fields — build a reverse MAC index so the user's own
    # labelled phone doesn't show up as an anonymous MAC.
    obj_store = _dom.get(DATA_OBJECTS)
    _hist: dict = _dom.get(DATA_OBJECT_HISTORY) or {}
    _mac_to_hist: dict[str, tuple[str, dict]] = {}
    for _k, _cached in list(_hist.items()):
        if not _k.startswith(("irk:", "ibeacon:")):
            continue
        _macs = [_cached.get("address")] + list(_cached.get("all_addresses") or [])
        for _m in _macs:
            _mu = str(_m or "").upper()
            if len(_mu) == 17:
                _mac_to_hist.setdefault(_mu, (_k, _cached))
    for r in recorded:
        addr = r["address"]
        if obj_store:
            label = obj_store.get_label(addr) or obj_store.get_label(f"ble:{addr}")
            if label:
                r["user_label"] = label
        h = _hist.get(f"ble:{addr}")
        hist_key = f"ble:{addr}"
        if h is None and addr in _mac_to_hist:
            hist_key, h = _mac_to_hist[addr]
        if h:
            for fld in ("company_name", "device_type", "user_label", "name"):
                if h.get(fld) and not r.get(fld):
                    r[fld] = h[fld]
            if obj_store and not r.get("user_label"):
                label = obj_store.get_label(h.get("canonical_id") or hist_key)
                if label:
                    r["user_label"] = label

    # Fallback tier: cache entries whose [first_seen, last_seen] span overlaps
    # the window but have no recorded sessions.  A device seen before AND
    # after the window matches too — hence "possible", not "recorded".
    #
    # ONLY offered when the window reaches before recording began: for any
    # window the recorder already covers, span-overlap matches every device
    # currently alive (last_seen = now) and floods the results with the whole
    # neighbourhood (measured: 145 "possible" on a 1-minute window).
    oldest_rec = stats.get("oldest_ts")
    include_possible = oldest_rec is None or from_ts < float(oldest_rec)
    recorded_addrs = {r["address"] for r in recorded}
    possible = []
    for key, cached in list(_hist.items()) if include_possible else []:
        fs_ts = cached.get("_first_seen")
        ls_ts = cached.get("_last_seen_ts")
        if not isinstance(fs_ts, (int, float)) or not isinstance(ls_ts, (int, float)):
            continue
        if fs_ts > to_ts or ls_ts < from_ts:
            continue
        addr = (cached.get("address") or "").upper()
        if addr and addr in recorded_addrs:
            continue
        # Grouped entries (irk:/ibeacon:) carry their rotation history in
        # all_addresses — drop them too if any of those MACs was recorded.
        if any(str(a or "").upper() in recorded_addrs for a in (cached.get("all_addresses") or [])):
            continue
        possible.append({
            "key": key,
            "kind": cached.get("kind") or "",
            "address": addr,
            "name": cached.get("name") or "",
            "user_label": cached.get("user_label") or "",
            "company_name": cached.get("company_name") or "",
            "device_type": cached.get("device_type") or "",
            "first_seen": fs_ts,
            "last_seen": ls_ts,
        })
    # Collect ALL matches first, then sort by recency and truncate — an early
    # break would keep an arbitrary insertion-order subset of the cache.
    possible.sort(key=lambda p: p["last_seen"], reverse=True)
    del possible[500:]

    connection.send_result(msg["id"], {
        "recorded": recorded,
        "possible": possible,
        "possible_suppressed": not include_possible,
        "recording_oldest_ts": stats.get("oldest_ts"),
        "retention_days": retention_days(hass),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/forensics_license_activate",
        vol.Required("key"): str,
    }
)
@websocket_api.async_response
async def ws_forensics_license_activate(hass: HomeAssistant, connection, msg) -> None:
    """Validate a PadSpan Pro licence key against traks.ca and, if valid,
    store it and enable forensics.  The server does the HTTP call so the
    browser never needs cross-origin access."""
    key = str(msg.get("key") or "").strip().upper()
    if not key:
        connection.send_error(msg["id"], "invalid_key", "Licence key is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return
    try:
        import json as _json  # noqa: PLC0415
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        try:
            from homeassistant.helpers.instance_id import async_get as _instance_id  # noqa: PLC0415
            machine = await _instance_id(hass)
        except Exception:
            machine = "padspan-ha"
        session = async_get_clientsession(hass)
        async with session.get(
            "https://traks.ca/license/",
            params={"action": "validate", "product": "padspan", "key": key, "machine": machine},
            timeout=15,
        ) as resp:
            text = await resp.text()
        data = _json.loads(text.lstrip("\ufeff"))  # licence server prefixes a BOM
    except Exception as err:
        connection.send_error(msg["id"], "network",
            f"Could not reach the licence server ({err}). Check the internet connection and try again.")
        return
    if data.get("valid"):
        await st.async_set(
            forensics_license_key=key,
            forensics_license_expires=str(data.get("expires_at") or ""),
            forensics_enabled=True,
        )
        _invalidate_snapshot_cache(hass)
        connection.send_result(msg["id"], {
            "ok": True,
            "expires_at": data.get("expires_at"),
            "days_left": data.get("days_left"),
            "settings": _get_settings(hass),
        })
    else:
        connection.send_result(msg["id"], {
            "ok": False,
            "status": data.get("status") or "invalid",
            "message": data.get("message") or "Key not valid for PadSpan Pro.",
        })


@websocket_api.websocket_command({"type": "padspan_ha/forensics_stats"})
@websocket_api.async_response
async def ws_forensics_stats(hass: HomeAssistant, connection, msg) -> None:
    """Return recorder stats for the Settings UI."""
    from .const import DATA_FORENSICS

    fs = hass.data.get(DOMAIN, {}).get(DATA_FORENSICS)
    stats = fs.stats() if fs else {"addr_count": 0, "session_count": 0, "oldest_ts": None, "newest_ts": None}
    connection.send_result(msg["id"], stats)


@websocket_api.websocket_command({"type": "padspan_ha/forensics_clear"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_forensics_clear(hass: HomeAssistant, connection, msg) -> None:
    """Delete all recorded forensics sessions (irreversible)."""
    from .const import DATA_FORENSICS

    fs = hass.data.get(DOMAIN, {}).get(DATA_FORENSICS)
    removed = await fs.async_clear() if fs else 0
    _LOGGER.info("Forensics data cleared (%d addresses removed)", removed)
    connection.send_result(msg["id"], {"ok": True, "removed": removed})


# ── Radio / Scanner Management ─────────────────────────────────────────────────

@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_area_set",
        vol.Optional("device_id"): str,
        vol.Optional("source"): str,
        vol.Optional("area_name"): str,
    }
)
@websocket_api.async_response
async def ws_radio_area_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a BLE scanner to an HA area.  This is how PadSpan knows which
    room a scanner is in — the scanner's area becomes the "room" for objects
    it hears the loudest.  Pass area_name='' to clear the assignment.
    """
    dev_id = (msg.get("device_id") or "").strip()
    source = (msg.get("source") or "").strip()
    area_name = (msg.get("area_name") or "").strip()

    # Resolve device_id from source string if not provided directly
    if not dev_id and source:
        try:
            dr_r = device_registry.async_get(hass)
            src_l = source.lower()
            for dev in dr_r.devices.values():
                for nm in [dev.name_by_user, dev.name]:
                    if nm and (nm.lower() in src_l or src_l in nm.lower()):
                        dev_id = dev.id
                        break
                if dev_id:
                    break
        except Exception:
            pass

    if not dev_id:
        connection.send_error(msg["id"], "device_not_found", "Could not find HA device for this radio source")
        return

    # Resolve area_id from area_name (blank → clear area assignment)
    area_id: str | None = None
    if area_name:
        try:
            ar_r = area_registry.async_get(hass)
            for a in ar_r.async_list_areas():
                if a.name.casefold() == area_name.casefold():
                    area_id = a.id
                    break
        except Exception:
            pass
        if not area_id:
            connection.send_error(msg["id"], "area_not_found", f"Area '{area_name}' not found in HA area registry")
            return

    try:
        dr_u = device_registry.async_get(hass)
        dr_u.async_update_device(dev_id, area_id=area_id)
        _invalidate_snapshot_cache(hass)
        connection.send_result(msg["id"], {"ok": True, "device_id": dev_id, "area_id": area_id, "area_name": area_name or None})
    except Exception as e:
        connection.send_error(msg["id"], "update_failed", str(e)[:500])


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_lost_set",
        "source": str,
        "lost": bool,
    }
)
@websocket_api.async_response
async def ws_radio_lost_set(hass: HomeAssistant, connection, msg) -> None:
    """Mark or unmark a BLE radio as 'lost' (excluded from location math)."""
    source = str(msg.get("source") or "").strip()
    lost = bool(msg.get("lost", True))
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "no_settings", "Settings store not initialized")
        return
    lost_radios = dict(st.data.get("lost_radios", {}))
    if lost:
        lost_radios[source] = {"marked_at": dt_util.utcnow().isoformat()}
    else:
        lost_radios.pop(source, None)
    await st.async_set(lost_radios=lost_radios)
    connection.send_result(msg["id"], {"ok": True, "source": source, "lost": lost})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_disabled_set",
        "source": str,
        "disabled": bool,
    }
)
@websocket_api.async_response
async def ws_radio_disabled_set(hass: HomeAssistant, connection, msg) -> None:
    """Mark or unmark a BLE radio as 'disabled' (intentionally excluded from location math)."""
    source = str(msg.get("source") or "").strip()
    disabled = bool(msg.get("disabled", True))
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "no_settings", "Settings store not initialized")
        return
    disabled_radios = dict(st.data.get("disabled_radios", {}))
    if disabled:
        disabled_radios[source] = {"marked_at": dt_util.utcnow().isoformat()}
    else:
        disabled_radios.pop(source, None)
    await st.async_set(disabled_radios=disabled_radios)
    connection.send_result(msg["id"], {"ok": True, "source": source, "disabled": disabled})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/radio_reset",
        "source": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_radio_reset(hass: HomeAssistant, connection, msg) -> None:
    """Nuclear reset for a single BLE scanner — clears ALL associated data.

    Used when a scanner is replaced or relocated.  Clears across 6 subsystems:
      1. Settings: RSSI offset, lost flag, disabled flag
      2. Maps: receiver pin placements on all maps
      3. Calibration: removes all scanner_readings entries + prunes empty points
      4. Adaptive: removes room fingerprint observations from this scanner
      5. Presence coordinator: clears Kalman/EMA smoothing state
      6. Bluetooth live: clears advertisement cache entries from this scanner
    """
    source = str(msg.get("source") or "").strip()
    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return

    summary: dict = {}

    # 1. Settings — pop from scanner_offsets, lost_radios, disabled_radios
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st:
        offsets = dict(st.data.get("scanner_offsets") or {})
        lost = dict(st.data.get("lost_radios") or {})
        disabled = dict(st.data.get("disabled_radios") or {})
        had_offset = source in offsets
        had_lost = source in lost
        had_disabled = source in disabled
        offsets.pop(source, None)
        lost.pop(source, None)
        disabled.pop(source, None)
        await st.async_set(
            scanner_offsets=offsets,
            lost_radios=lost,
            disabled_radios=disabled,
        )
        summary["settings"] = {
            "offset_cleared": had_offset,
            "lost_cleared": had_lost,
            "disabled_cleared": had_disabled,
        }

    # 2. Maps — remove receiver placements
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if ms:
        receivers_removed = await ms.async_remove_receiver_by_source(source)
        summary["maps"] = {"receivers_removed": receivers_removed}

    # 3. Calibration — remove scanner readings + prune empty points
    try:
        cal = await _get_cal_store(hass)
        cal_result = await cal.async_remove_scanner(source)
        summary["calibration"] = cal_result
    except Exception as err:
        _LOGGER.warning("Radio reset: calibration cleanup failed: %s", err)

    # 4. Adaptive — remove room fingerprints
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        ad_removed = await ad.async_remove_scanner(source)
        summary["adaptive"] = {"room_pairs_removed": ad_removed}

    # 5. Presence coordinator — clear Kalman smoothing state
    coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
    if coord and hasattr(coord, "clear_scanner"):
        pc_cleared = coord.clear_scanner(source)
        summary["presence"] = {"devices_cleared": pc_cleared}

    # 6. Bluetooth live — clear advertisement cache
    bl = get_bluetooth_live(hass)
    if bl:
        bl_cleared = bl.clear_scanner(source)
        summary["bluetooth"] = {"addresses_cleared": bl_cleared}

    _LOGGER.info("Radio reset complete for source=%s: %s", source, summary)
    connection.send_result(msg["id"], {"ok": True, "source": source, "summary": summary})


# ── Follow / Alert Configuration ───────────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/follow_alert_get"})
@websocket_api.async_response
async def ws_follow_alert_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all saved follow-alert configurations (persisted in AlertStore)."""
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    configs = alert_store.all() if alert_store else {}
    connection.send_result(msg["id"], {"configs": configs})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/follow_alert_save",
        vol.Optional("addr"): str,
        vol.Optional("config"): dict,
    }
)
@websocket_api.async_response
async def ws_follow_alert_save(hass: HomeAssistant, connection, msg) -> None:
    """Save follow/alert configuration for a tracked object.

    Persists to AlertStore so configs survive HA restarts.
    """
    addr = str(msg.get("addr") or "").strip()
    config = msg.get("config") or {}
    if len(str(config)) > 50000:
        connection.send_error(msg["id"], "config_too_large", "Alert config exceeds size limit")
        return
    # Persist to AlertStore (disk-backed) — resolve padspan_id for stable identity
    from .const import DATA_ALERTS, DATA_DEVICE_REGISTRY
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    _pid = None
    try:
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            _pid = _dev_reg.resolve(addr)
    except Exception:
        pass
    if alert_store:
        await alert_store.async_save_config(addr, config, padspan_id=_pid)
    else:
        # Fallback: session-only (shouldn't happen if stores loaded)
        hass.data.setdefault(DOMAIN, {}).setdefault("follow_alerts", {})[addr] = config
    _LOGGER.debug("PadSpan HA follow_alert_save: addr=%s keys=%s", addr, list(config.keys()) if isinstance(config, dict) else "?")
    connection.send_result(msg["id"], {"ok": True, "addr": addr})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/follow_alert_delete",
        vol.Required("addr"): str,
    }
)
@websocket_api.async_response
async def ws_follow_alert_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a follow-alert configuration for a tracked object."""
    addr = str(msg.get("addr") or "").strip()
    if not addr:
        connection.send_error(msg["id"], "missing_addr", "addr is required")
        return
    from .const import DATA_ALERTS
    alert_store = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
    deleted = False
    if alert_store:
        deleted = await alert_store.async_delete_config(addr)
    else:
        alerts = hass.data.get(DOMAIN, {}).get("follow_alerts", {})
        if addr in alerts:
            del alerts[addr]
            deleted = True
    _LOGGER.debug("PadSpan HA follow_alert_delete: addr=%s deleted=%s", addr, deleted)
    connection.send_result(msg["id"], {"ok": True, "addr": addr, "deleted": deleted})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/area_delete",
        "area_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_area_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete an HA area and clean up PadSpan room_meta."""
    area_id = (msg.get("area_id") or "").strip()
    if not area_id:
        connection.send_error(msg["id"], "invalid_area_id", "area_id required")
        return
    ar = area_registry.async_get(hass)
    area = ar.async_get_area(area_id)
    if not area:
        connection.send_error(msg["id"], "not_found", "Area not found")
        return
    area_name = area.name
    ar.async_delete(area_id)
    # Clean up PadSpan room_meta for this area name
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if mdl:
        try:
            room_meta = mdl.room_meta() or {}
            if area_name in room_meta:
                updated_meta = {k: v for k, v in room_meta.items() if k != area_name}
                await mdl.async_update(room_meta=updated_meta)
        except Exception:
            pass
    connection.send_result(msg["id"], {"deleted": area_id, "name": area_name})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/entity_delete",
        "entity_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_entity_delete(hass: HomeAssistant, connection, msg) -> None:
    """Remove an entity from the HA entity registry."""
    entity_id = (msg.get("entity_id") or "").strip()
    if not entity_id:
        connection.send_error(msg["id"], "invalid_entity_id", "entity_id required")
        return
    er = entity_registry.async_get(hass)
    entry = er.async_get(entity_id)
    if not entry:
        connection.send_error(msg["id"], "not_found", f"Entity '{entity_id}' not found in registry")
        return
    er.async_remove(entity_id)
    connection.send_result(msg["id"], {"deleted": entity_id})


@websocket_api.websocket_command({"type": "padspan_ha/room_tag_purge_missing"})
@websocket_api.async_response
async def ws_room_tag_purge_missing(hass: HomeAssistant, connection, msg) -> None:
    """Remove entity_ids from room_tag_map that have no current HA state (phantom/sample entities)."""
    coord = hass.data.get(DOMAIN, {}).get("coordinator")
    if not coord:
        connection.send_result(msg["id"], {"removed": 0, "rooms": 0})
        return
    removed = 0
    new_map: dict = {}
    for room, ids in (coord.room_tag_map or {}).items():
        valid = [eid for eid in (ids or []) if hass.states.get(str(eid)) is not None]
        removed += len(ids or []) - len(valid)
        if valid:
            new_map[room] = valid
    coord.room_tag_map = new_map
    # Persist the purge so phantom entries don't reappear on restart.  The
    # set_room_tag_map service saves room_tag_map to SettingsStore and
    # async_setup_entry restores it; without saving here the restored map would
    # re-add the very entries we just removed.  Only write when something changed.
    if removed:
        try:
            _settings = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            if _settings:
                await _settings.async_set(room_tag_map=new_map)
        except Exception as err:
            _LOGGER.exception("Failed to persist purged room_tag_map: %s", err)
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"removed": removed, "rooms": len(new_map)})


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

async def _get_cal_store(hass: HomeAssistant) -> CalibrationStore:
    """Lazily initialize and return the CalibrationStore.

    Creates and loads the store on first access.  Subsequent calls return
    the cached instance from hass.data.
    """
    domain_data = hass.data.setdefault(DOMAIN, {})
    if DATA_CALIBRATION not in domain_data:
        store = CalibrationStore(hass)
        # Phase 3: wire ModelStore for metre conversions
        _mdl = domain_data.get(DATA_MODEL)
        if _mdl:
            store.set_model_store(_mdl)
        await store.async_setup()
        domain_data[DATA_CALIBRATION] = store
    return domain_data[DATA_CALIBRATION]


@websocket_api.websocket_command({"type": "padspan_ha/calibration_get"})
@websocket_api.async_response
async def ws_calibration_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all calibration points and the cached model stats."""
    cal = await _get_cal_store(hass)
    connection.send_result(msg["id"], {
        "points": cal.list_points(),
        "model": cal.data.get("model") or {},
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_save_point",
        vol.Required("point"): dict,
    }
)
@websocket_api.async_response
async def ws_calibration_save_point(hass: HomeAssistant, connection, msg) -> None:
    """Save one calibration point (position + per-scanner RSSI readings)."""
    cal = await _get_cal_store(hass)
    try:
        saved = await cal.async_add_point(msg["point"])
        _total = len(cal.data.get("points", []))
        _scanners = len({r.get("source") for p in cal.data.get("points", [])
                         for r in (p.get("scanner_readings") or []) if r.get("source")})
        _LOGGER.info(
            "Calibration point saved: id=%s map=%s room=%s scanners=%d samples=%d (total: %d pts, %d scanners)",
            saved.get("id", "?"), saved.get("map_id", "?")[:20],
            saved.get("room") or "(none)", len(saved.get("scanner_readings") or []),
            sum(len(r.get("rssi_samples", [])) for r in (saved.get("scanner_readings") or [])),
            _total, _scanners,
        )
        connection.send_result(msg["id"], {
            "ok": True, "point": saved,
            "total_points": _total, "total_scanners": _scanners,
        })
    except Exception as e:
        _LOGGER.warning("Calibration save failed: %s", e)
        connection.send_error(msg["id"], "save_failed", str(e))


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_delete_point",
        "point_id": str,
    }
)
@websocket_api.async_response
async def ws_calibration_delete_point(hass: HomeAssistant, connection, msg) -> None:
    """Delete a single calibration point by ID."""
    cal = await _get_cal_store(hass)
    point_id = (msg.get("point_id") or "").strip()
    if not point_id:
        connection.send_error(msg["id"], "invalid_id", "point_id required")
        return
    deleted = await cal.async_delete_point(point_id)
    connection.send_result(msg["id"], {"ok": deleted, "point_id": point_id})


@websocket_api.websocket_command({"type": "padspan_ha/calibration_clear"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_calibration_clear(hass: HomeAssistant, connection, msg) -> None:
    """Delete all calibration points and reset the model."""
    cal = await _get_cal_store(hass)
    count = await cal.async_clear_all()
    connection.send_result(msg["id"], {"ok": True, "deleted": count})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_clear_map",
        "map_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_calibration_clear_map(hass: HomeAssistant, connection, msg) -> None:
    """Delete all calibration points collected on a specific map."""
    map_id = str(msg.get("map_id") or "").strip()
    if not map_id:
        connection.send_error(msg["id"], "invalid_map_id", "map_id is required")
        return
    cal = await _get_cal_store(hass)
    count = await cal.async_clear_map(map_id)
    connection.send_result(msg["id"], {"ok": True, "map_id": map_id, "deleted": count})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_evict",
        "key": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_object_evict(hass: HomeAssistant, connection, msg) -> None:
    """Evict a single object from the coordinator's smoothed state cache.

    WHY: After physically moving a beacon, the Kalman filter / EMA smoother
    still remembers the old position.  Evicting forces immediate k-NN
    recalculation on the next poll instead of slowly drifting to the new spot.
    """
    key = str(msg.get("key") or "").strip()
    if not key:
        connection.send_error(msg["id"], "invalid_key", "key is required")
        return
    _coord = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
    if _coord:
        _coord.clear_object_state(key)
    connection.send_result(msg["id"], {"ok": True, "key": key})


@websocket_api.websocket_command({"type": "padspan_ha/calibration_compute_model"})
@websocket_api.async_response
async def ws_calibration_compute_model(hass: HomeAssistant, connection, msg) -> None:
    """Trigger full calibration model recomputation.

    Computes: coverage grids (heatmaps), per-scanner path-loss regression
    fits (if scanner positions are placed on maps), and Leave-One-Out (LOO)
    cross-validation accuracy.  Results are persisted and returned to the UI.
    """
    cal = await _get_cal_store(hass)
    maps_store = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    maps_data = maps_store.list_maps() if maps_store else None
    try:
        model = cal.compute_model(maps_data=maps_data)
        await cal.store.async_save(cal.data)
        connection.send_result(msg["id"], {"ok": True, "model": model})
    except Exception as e:
        _LOGGER.error("PadSpan HA calibration_compute_model failed: %s", e)
        connection.send_error(msg["id"], "compute_failed", str(e))


@websocket_api.websocket_command({"type": "padspan_ha/positioning_repair"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_positioning_repair(hass: HomeAssistant, connection, msg) -> None:
    """One-shot repair of positioning data poisoned by fabricated fallback
    transforms — the "beacons teleport to nonsense" fix, in order:

      1. Align every unmeasured map whose system placement disagrees with
         the hand-tuned stack (never touches reference-measured maps or
         outside maps), re-deriving that map's scanners/beacons/barriers.
      2. Recompute every calibration point's real-world metres through the
         repaired transforms (map frac→metres; room-centroid fallback for
         map-less points; unanchorable metres cleared — those points remain
         valid RSSI fingerprints, just not spatial anchors).
      3. Retrain the RF model on the clean metres.

    Room fabric is untouchable by design. Everything here is recomputable,
    nothing is deleted beyond garbage metre stamps.
    """
    from . import fabric_truth

    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    cal = await _get_cal_store(hass)
    if not mdl or not ms or not cal:
        connection.send_error(msg["id"], "no_stores", "Model/Maps/Calibration store not loaded")
        return

    report = {"maps_repaired": [], "maps_skipped": [],
              "cal_from_map": 0, "cal_from_room": 0, "cal_cleared": 0,
              "spatial_resynced": 0}

    # ── 1. Repair lying map placements from the stack alignment ──────────
    anchor = fabric_truth.find_metre_anchor(ms.data.get("maps") or [], mdl)
    if anchor:
        for m in (ms.data.get("maps") or []):
            mid = m.get("id", "")
            name = m.get("name") or mid
            if not mid:
                continue
            if str(m.get("floor_id", "")) == OUTSIDE_FLOOR_ID:
                report["maps_skipped"].append({"map": name, "why": "outside"})
                continue
            t = mdl.map_transform(mid) or {}
            if t.get("reference_measurements"):
                report["maps_skipped"].append({"map": name, "why": "measured"})
                continue
            st = fabric_truth.stack_metre_transform(m, anchor)
            if not st:
                report["maps_skipped"].append({"map": name, "why": "no_stack"})
                continue
            if st["shear_rad"] > 0.02:
                report["maps_skipped"].append({"map": name, "why": "sheared"})
                continue
            try:
                agrees = t and (
                    abs(float(t.get("origin_x_m", 0)) - st["origin_x_m"]) <= 0.2
                    and abs(float(t.get("origin_y_m", 0)) - st["origin_y_m"]) <= 0.2
                    and abs(float(t.get("scale_x_m", 0)) - st["scale_x_m"]) <= max(0.2, 0.02 * st["scale_x_m"])
                    and abs(float(t.get("scale_y_m", 0)) - st["scale_y_m"]) <= max(0.2, 0.02 * st["scale_y_m"])
                )
            except (TypeError, ValueError):
                agrees = False
            if agrees:
                report["maps_skipped"].append({"map": name, "why": "already_aligned"})
                continue
            new_t = {
                "origin_x_m": st["origin_x_m"], "origin_y_m": st["origin_y_m"],
                "scale_x_m": st["scale_x_m"], "scale_y_m": st["scale_y_m"],
                "rotation_rad": st["rotation_rad"],
                "floor_id": str(m.get("floor_id", DEFAULT_FLOOR_ID)),
            }
            await mdl.async_set_map_transform(mid, new_t, reanchor=True)
            report["spatial_resynced"] += await mdl.async_sync_spatial_from_map(mid, m)
            report["maps_repaired"].append(name)
    else:
        report["anchor_missing"] = True

    # ── 2. Re-derive calibration metres through the repaired transforms ──
    centroids = mdl.room_centroids_m()
    for p in cal.data.get("points", []):
        mid = p.get("map_id") or ""
        xf, yf = p.get("x_frac"), p.get("y_frac")
        done = False
        if (mid and isinstance(xf, (int, float)) and isinstance(yf, (int, float))
                and not isinstance(xf, bool) and mdl.map_transform(mid)):
            c = mdl.map_frac_to_metres(float(xf), float(yf), mid)
            if c:
                p["x_m"], p["y_m"] = round(c[0], 3), round(c[1], 3)
                report["cal_from_map"] += 1
                done = True
        if not done:
            cent = centroids.get(str(p.get("room") or ""))
            if cent:
                p["x_m"], p["y_m"] = round(cent[0], 3), round(cent[1], 3)
                report["cal_from_room"] += 1
            else:
                if p.get("x_m") is not None:
                    report["cal_cleared"] += 1
                p.pop("x_m", None)
                p.pop("y_m", None)
    await cal.store.async_save(cal.data)

    # ── 3. Retrain the RF on the clean metres ────────────────────────────
    try:
        await cal._async_train_rf()
        report["rf_trained"] = cal.rf_trained
        report["rf_metres"] = getattr(cal._rf, "_use_metres", False) if cal.rf_trained else False
    except Exception as e:
        report["rf_error"] = str(e)

    connection.send_result(msg["id"], report)


@websocket_api.websocket_command({"type": "padspan_ha/calibration_retrain_rf"})
@websocket_api.async_response
async def ws_calibration_retrain_rf(hass: HomeAssistant, connection, msg) -> None:
    """Force retrain the Random Forest model (picks up metre-space data)."""
    cal = await _get_cal_store(hass)
    try:
        await cal._async_train_rf()
        rf_trained = cal.rf_trained
        rf_metres = getattr(cal._rf, "_use_metres", False) if rf_trained else False
        connection.send_result(msg["id"], {
            "ok": True,
            "rf_trained": rf_trained,
            "use_metres": rf_metres,
            "point_count": len(cal.data.get("points", [])),
        })
    except Exception as e:
        connection.send_error(msg["id"], "retrain_failed", str(e))


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_swap_radio",
        vol.Required("old_source"): str,
        vol.Required("new_source"): str,
    }
)
@websocket_api.async_response
async def ws_calibration_swap_radio(hass: HomeAssistant, connection, msg) -> None:
    """Replace every occurrence of old_source with new_source in calibration data.

    Useful when a physical scanner is replaced — all fingerprint readings recorded
    under the old source ID are re-attributed to the new source ID.
    """
    old_source = str(msg.get("old_source") or "").strip()
    new_source = str(msg.get("new_source") or "").strip()

    if not old_source or not new_source:
        connection.send_error(msg["id"], "invalid", "old_source and new_source are required")
        return
    if old_source == new_source:
        connection.send_error(msg["id"], "invalid", "old_source and new_source must be different")
        return

    cal = await _get_cal_store(hass)
    updated_readings = 0

    for pt in cal.data.get("points", []):
        for sr in pt.get("scanner_readings", []):
            if sr.get("source") == old_source:
                sr["source"] = new_source
                updated_readings += 1

    # Re-key model sub-dicts that are keyed by source
    model = cal.data.get("model", {})
    for section in ("path_loss", "scanner_stats"):
        sec = model.get(section, {})
        if old_source in sec:
            sec[new_source] = sec.pop(old_source)

    await cal.store.async_save(cal.data)
    connection.send_result(msg["id"], {
        "ok": True,
        "old_source": old_source,
        "new_source": new_source,
        "updated_readings": updated_readings,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/calibration_relearn_radio",
        vol.Required("source"): str,
        vol.Required("gain_db"): vol.Coerce(float),
    }
)
@websocket_api.async_response
async def ws_calibration_relearn_radio(hass: HomeAssistant, connection, msg) -> None:
    """Shift stored RSSI readings for a scanner after an antenna upgrade/downgrade.

    When hardware changes (e.g. new antenna), the RSSI values in calibration
    data become invalid.  Instead of recollecting every point, the user provides
    the dB gain difference and we adjust all stored samples:
      new_rssi = old_rssi + gain_db   (positive = upgrade, negative = downgrade)
    Then recompute mean/std per reading and rebuild the model.
    """
    source = str(msg.get("source") or "").strip()
    gain_db = float(msg.get("gain_db", 0.0))

    if not source:
        connection.send_error(msg["id"], "invalid_source", "source is required")
        return
    if gain_db == 0.0:
        connection.send_error(msg["id"], "invalid_gain", "gain_db must be non-zero")
        return
    if not -30.0 <= gain_db <= 30.0:
        connection.send_error(msg["id"], "invalid_gain", "gain_db must be between -30 and +30")
        return

    cal = await _get_cal_store(hass)
    updated_readings = 0
    updated_points = 0

    for pt in cal.data.get("points", []):
        point_touched = False
        for sr in pt.get("scanner_readings", []):
            if sr.get("source") != source:
                continue
            # Shift every raw RSSI sample
            samples = sr.get("rssi_samples", [])
            if samples:
                sr["rssi_samples"] = [round(s + gain_db, 1) for s in samples]
            # Recompute mean and std from shifted samples
            shifted = sr["rssi_samples"] if samples else []
            if shifted:
                sr["mean_rssi"] = round(sum(shifted) / len(shifted), 2)
                if len(shifted) >= 2:
                    m = sr["mean_rssi"]
                    sr["std_rssi"] = round(
                        (sum((v - m) ** 2 for v in shifted) / len(shifted)) ** 0.5, 2
                    )
            elif "mean_rssi" in sr:
                # No raw samples stored — shift the mean directly
                sr["mean_rssi"] = round(sr["mean_rssi"] + gain_db, 2)
            updated_readings += 1
            point_touched = True
        if point_touched:
            updated_points += 1

    if updated_readings == 0:
        connection.send_error(
            msg["id"], "no_data",
            f"No calibration readings found for scanner '{source}'"
        )
        return

    # Persist shifted data
    await cal.store.async_save(cal.data)

    # Rebuild the model with the adjusted readings
    try:
        maps_data = None
        ms = hass.data.get(DOMAIN, {}).get("maps")
        if ms:
            maps_data = ms.data if hasattr(ms, "data") else ms
        cal.compute_model(maps_data=maps_data)
        await cal.store.async_save(cal.data)
    except Exception as e:
        _LOGGER.warning("PadSpan HA relearn model recompute failed: %s", e)

    connection.send_result(msg["id"], {
        "ok": True,
        "source": source,
        "gain_db": gain_db,
        "updated_points": updated_points,
        "updated_readings": updated_readings,
    })


@websocket_api.websocket_command({"type": "padspan_ha/calibration_beacon_profiles"})
@websocket_api.async_response
async def ws_calibration_beacon_profiles(hass: HomeAssistant, connection, msg) -> None:
    """Compute per-beacon signal profiles grouped by model.

    Cross-references calibration points with the live snapshot to derive model
    keys (iBeacon UUID prefix, company+device_type, BLE name prefix, etc.).
    Returns per-beacon stats and model-level defaults.
    """
    cal = await _get_cal_store(hass)
    try:
        snap = await _live_snapshot(hass)
        obj_list = (snap.get("objects") or {}).get("list") or []
        profiles = cal.compute_beacon_profiles(snapshot_objects=obj_list)
        connection.send_result(msg["id"], profiles)
    except Exception as e:
        _LOGGER.error("PadSpan HA calibration_beacon_profiles failed: %s", e)
        connection.send_error(msg["id"], "compute_failed", str(e))


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

@websocket_api.websocket_command({"type": "padspan_ha/notify_services_list"})
@websocket_api.async_response
async def ws_notify_services_list(hass: HomeAssistant, connection, msg) -> None:
    """Discover all available HA notification services/entities.

    WHY so many methods: HA's notify landscape is fragmented across versions.
    Legacy YAML services, entity-based platform (2024+), entity registry entries,
    entity platforms, and cross-domain services all need checking to reliably
    find every notification target.  The UI uses this to populate the alert
    service picker dropdown.
    """
    result_set: set[str] = set()

    # ── Method 1: hass.services — legacy YAML-configured services ────────
    # async_services() returns {domain: {service_name: ...}}
    # For YAML notify: name "Foo" → service "notify.foo" (lowered, spaces→_)
    try:
        all_svc = hass.services.async_services()
        notify_svc = all_svc.get("notify", {})
        for svc_name in notify_svc:
            if svc_name == "send_message":
                continue  # generic dispatcher, not a target
            # Legacy services are called as notify.{svc_name}
            result_set.add(f"notify.{svc_name}")
        _LOGGER.debug("notify discovery method1 (services): %s", list(notify_svc.keys()))
    except Exception as exc:
        _LOGGER.warning("notify discovery method1 failed: %s", exc)

    # ── Method 2: hass.services.async_services_for_domain (HA 2024.4+) ───
    try:
        if hasattr(hass.services, "async_services_for_domain"):
            domain_svc = hass.services.async_services_for_domain("notify")
            for svc_name in domain_svc:
                if svc_name != "send_message":
                    result_set.add(f"notify.{svc_name}")
            _LOGGER.debug("notify discovery method2 (for_domain): %s", list(domain_svc.keys()))
    except Exception as exc:
        _LOGGER.warning("notify discovery method2 failed: %s", exc)

    # ── Method 3: notify entities from state machine ─────────────────────
    try:
        for state in hass.states.async_all("notify"):
            result_set.add(state.entity_id)
        _LOGGER.debug("notify discovery method3 (states): %s",
                       [s.entity_id for s in hass.states.async_all("notify")])
    except Exception as exc:
        _LOGGER.warning("notify discovery method3 failed: %s", exc)

    # ── Method 4: entity registry (catches entities without state) ───────
    try:
        from homeassistant.helpers import entity_registry as er
        ent_reg = er.async_get(hass)
        for entry in ent_reg.entities.values():
            if entry.domain == "notify" and not entry.disabled_by:
                result_set.add(entry.entity_id)
    except Exception as exc:
        _LOGGER.warning("notify discovery method4 failed: %s", exc)

    # ── Method 5: entity platforms ───────────────────────────────────────
    try:
        from homeassistant.helpers import entity_platform
        for platform in entity_platform.async_get_platforms(hass, "notify"):
            for entity in platform.entities.values():
                if hasattr(entity, "entity_id"):
                    result_set.add(entity.entity_id)
    except Exception as exc:
        _LOGGER.warning("notify discovery method5 failed: %s", exc)

    # ── Method 6: scan ALL services for notify-like domains ──────────────
    # Some integrations register under their own domain with send_message
    try:
        all_svc = hass.services.async_services()
        for domain, svcs in all_svc.items():
            if domain == "notify":
                continue
            # Look for domains that have a "send_message" or "notify" service
            if "send_message" in svcs or "notify" in svcs:
                result_set.add(f"{domain}.send_message")
    except Exception as exc:
        _LOGGER.warning("notify discovery method6 failed: %s", exc)

    has_send_message = False
    try:
        has_send_message = "send_message" in hass.services.async_services().get("notify", {})
    except Exception:
        pass

    result = sorted(result_set)
    _LOGGER.warning(
        "notify_services_list result: %s (has_send_message=%s)",
        result, has_send_message,
    )
    connection.send_result(msg["id"], {
        "services": result,
        "has_send_message": has_send_message,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/notify_test",
        vol.Optional("email"): str,
        vol.Optional("service"): str,
    }
)
@websocket_api.async_response
async def ws_notify_test(hass: HomeAssistant, connection, msg) -> None:
    """Send a test notification via HA notify to verify the pipeline works.

    Supports both legacy notify.{name} services and the newer HA 2024+
    entity-based notify platform (notify.send_message + entity_id).
    """
    email = str(msg.get("email") or "").strip()
    chosen = str(msg.get("service") or "").strip()
    services = hass.services.async_services().get("notify", {})
    has_send_message = "send_message" in services
    # Gather all notify entities (new platform)
    entity_ids = [s.entity_id for s in hass.states.async_all("notify")]
    legacy = [k for k in services if k != "send_message"]

    if not services and not entity_ids:
        connection.send_error(
            msg["id"], "no_notify",
            "No notify services found in HA. You need to set up a notification "
            "integration first (e.g. SMTP email, Mobile App, Pushover). "
            "Go to HA Settings → Devices & Services → Add Integration → search for your notification provider."
        )
        return

    base_data: dict[str, Any] = {
        "title": "PadSpan HA — Test Notification",
        "message": "This is a test from PadSpan HA. If you see this, your notification pipeline is working correctly.",
    }

    # Determine if the chosen value is an entity_id (e.g. "notify.smtp")
    is_entity = chosen.startswith("notify.")
    attempts: list[tuple[str, str, dict[str, Any]]] = []  # (description, svc_name, payload)

    if is_entity and has_send_message:
        # New HA platform: use notify.send_message with entity_id targeting
        payload_eid = {**base_data, "entity_id": chosen}
        if email:
            attempts.append(("send_message+entity+target", "send_message", {**payload_eid, "target": email}))
            attempts.append(("send_message+entity+data.target", "send_message", {**payload_eid, "data": {"target": email}}))
        attempts.append(("send_message+entity", "send_message", payload_eid))
        # Also try legacy call with the slug (e.g. notify.smtp → service "smtp")
        slug = chosen.split(".", 1)[1] if "." in chosen else chosen
        if slug in services:
            if email:
                attempts.append(("legacy+target", slug, {**base_data, "target": email}))
            attempts.append(("legacy", slug, base_data))
    elif chosen and chosen in services:
        # Legacy service chosen directly
        if email:
            attempts.append(("legacy+target", chosen, {**base_data, "target": email}))
            attempts.append(("legacy+data.target", chosen, {**base_data, "data": {"target": email}}))
        attempts.append(("legacy", chosen, base_data))
    else:
        # Nothing chosen or invalid — auto-pick
        # Prefer entity_ids with mail/smtp, then legacy with mail/smtp, then first available
        pick_entity = None
        pick_legacy = None
        for eid in entity_ids:
            if "mail" in eid.lower() or "smtp" in eid.lower():
                pick_entity = eid
                break
        for svc in legacy:
            if "mail" in svc.lower() or "smtp" in svc.lower():
                pick_legacy = svc
                break
        if pick_entity and has_send_message:
            payload_eid = {**base_data, "entity_id": pick_entity}
            if email:
                attempts.append(("auto-entity+target", "send_message", {**payload_eid, "target": email}))
            attempts.append(("auto-entity", "send_message", payload_eid))
        if pick_legacy:
            if email:
                attempts.append(("auto-legacy+target", pick_legacy, {**base_data, "target": email}))
            attempts.append(("auto-legacy", pick_legacy, base_data))
        # Last resort: first entity or first legacy
        if not attempts:
            if entity_ids and has_send_message:
                eid = entity_ids[0]
                attempts.append(("fallback-entity", "send_message", {**base_data, "entity_id": eid}))
            elif legacy:
                attempts.append(("fallback-legacy", legacy[0], base_data))

    if not attempts:
        connection.send_error(
            msg["id"], "no_notify",
            "Could not find a usable notify service or entity. "
            "Go to HA Settings → Devices & Services → Add Integration → add a notification provider."
        )
        return

    last_err = None
    for desc, svc_name, payload in attempts:
        try:
            await hass.services.async_call("notify", svc_name, payload)
            used = svc_name if svc_name != "send_message" else payload.get("entity_id", svc_name)
            _LOGGER.info("PadSpan test notification sent via notify.%s (%s)", used, desc)
            connection.send_result(msg["id"], {
                "ok": True, "service": used,
                "available_services": sorted(set(entity_ids + legacy)),
            })
            return
        except Exception as err:
            last_err = err
            _LOGGER.debug("PadSpan test notify (%s) failed: %s", desc, err)
            continue

    detail = str(last_err) if last_err else "Unknown error"
    all_avail = sorted(set(entity_ids + legacy))
    connection.send_error(
        msg["id"], "send_failed",
        f"All send attempts failed: {detail}. "
        f"Available: {', '.join(all_avail) or 'none'}. "
        "Check HA Settings → Devices & Services for your notification provider's configuration."
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Adaptive learning
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({"type": "padspan_ha/adaptive_status_get"})
@websocket_api.async_response
async def ws_adaptive_status_get(hass: HomeAssistant, connection, msg) -> None:
    """Return adaptive learning summary stats."""
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        connection.send_result(msg["id"], {"adaptive": ad.summary()})
    else:
        connection.send_result(msg["id"], {"adaptive": {}})


@websocket_api.websocket_command({"type": "padspan_ha/adaptive_fingerprints_get"})
@websocket_api.async_response
async def ws_adaptive_fingerprints_get(hass: HomeAssistant, connection, msg) -> None:
    """Return raw adaptive learning fingerprints for heatmap visualization.

    Returns per-room, per-scanner mean RSSI from confirmed observations.
    Format: { room_name: { scanner_source: { mean, var, n } } }
    """
    _empty = {"fingerprints": {}, "scanner_best": {}, "total_observations": 0}
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if not (ad and ad.data):
        connection.send_result(msg["id"], _empty)
        return
    try:
        fps = ad.data.get("room_fingerprints", {})
        # Flatten to { room: { scanner: mean_rssi } } — only include
        # scanners with ≥5 observations for statistical confidence.
        simple: dict[str, dict[str, float]] = {}
        for room, scanners in fps.items():
            if not isinstance(scanners, dict):
                continue  # guard against corrupted persistent data
            simple[room] = {}
            for src, stats in scanners.items():
                if isinstance(stats, dict) and stats.get("n", 0) >= 5:
                    simple[room][src] = round(stats.get("mean", -100), 1)
        # Per-scanner best = strongest mean across all rooms (for heatmap scaling)
        scanner_best: dict[str, float] = {}
        for room, scanners in simple.items():
            for src, mean in scanners.items():
                if src not in scanner_best or mean > scanner_best[src]:
                    scanner_best[src] = mean
        connection.send_result(msg["id"], {
            "fingerprints": simple,
            "scanner_best": scanner_best,
            "total_observations": (ad.data.get("stats") or {}).get("total_observations", 0),
        })
    except Exception:
        connection.send_result(msg["id"], _empty)


@websocket_api.websocket_command({"type": "padspan_ha/adaptive_reset"})
@websocket_api.async_response
async def ws_adaptive_reset(hass: HomeAssistant, connection, msg) -> None:
    """Clear all adaptive learning data."""
    ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
    if ad:
        await ad.async_reset()
    connection.send_result(msg["id"], {"ok": True})


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


@websocket_api.websocket_command({"type": "padspan_ha/positioning_diag"})
@websocket_api.async_response
async def ws_positioning_diag(hass: HomeAssistant, connection, msg) -> None:
    """Return detailed positioning diagnostics for all labelled devices."""
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    diag: list[dict] = []
    _stats = {"total": 0, "active": 0, "spatial_ok": 0, "outside_all": 0}
    if pc and pc.data:
        scanner_positions = getattr(pc, "_scanner_positions", {})
        ema_rssi = getattr(pc, "_ema_rssi", {})
        confirmed = getattr(pc, "_confirmed_room", {})
        spatial_debug = getattr(pc, "_spatial_debug", {})
        last_cand = getattr(pc, "_last_candidate", {})
        room_votes = getattr(pc, "_room_votes", {})
        source_to_area = {}
        source_to_floor = {}
        if model:
            source_to_area, source_to_floor = model.get_scanner_mappings()

        for key, obj in pc.data.items():
            if key.startswith("__"):
                continue
            _stats["total"] += 1
            label = obj.get("user_label") or obj.get("name") or ""
            kind = obj.get("kind", "")
            _addr_key = str(obj.get("address") or "").upper() if kind in ("ble", "private_ble") else key
            ema = ema_rssi.get(_addr_key, {})
            if not ema:
                continue  # no scanner data = nothing to diagnose
            _stats["active"] += 1
            # Only show user-labelled devices — random BLE is noise
            if not obj.get("user_label"):
                continue

            # Decision chain from last poll
            cand = last_cand.get(key, {})
            _sp_xy = cand.get("spatial_xy")
            _sp_room = cand.get("spatial_room") or ""
            _sp_dbg = spatial_debug.get(key, "")

            # Track spatial stats
            if "computed:" in _sp_dbg:
                if ">OUTSIDE_ALL" in _sp_dbg:
                    _stats["outside_all"] += 1
                else:
                    _stats["spatial_ok"] += 1

            # Top 4 scanners (room + rssi + floor)
            top_scanners = []
            for src, rssi in sorted(ema.items(), key=lambda x: -x[1])[:4]:
                sp = scanner_positions.get(src)
                top_scanners.append({
                    "room": source_to_area.get(src, "?"),
                    "rssi": round(rssi, 1),
                    "floor": sp[2] if sp else source_to_floor.get(src, "?"),
                })

            # Vote window
            _votes = list(room_votes.get(key, []))

            _ema_with_pos = len(set(ema.keys()) & set(scanner_positions.keys()))

            diag.append({
                "label": label or key[:30],
                "kind": kind,
                "confirmed": confirmed.get(key, ""),
                "candidate": cand.get("candidate", ""),
                "cand_source": cand.get("source", ""),
                "spatial_room": _sp_room,
                "spatial_xy": f"({_sp_xy[0]:.1f},{_sp_xy[1]:.1f})@{_sp_xy[2]}" if _sp_xy else "",
                "spatial_debug": _sp_dbg,
                "rssi_top3": [[r, round(s, 1)] for r, s in cand.get("rssi_top3", [])],
                "votes": _votes,
                "scanners": top_scanners,
                "ema_count": len(ema),
                "ema_with_pos": _ema_with_pos,
            })

    # BLE seed status
    _bl = None
    try:
        from .bluetooth_live import get_bluetooth_live
        _bl = get_bluetooth_live(hass)
    except Exception:
        pass
    ble_seed = {
        "method": getattr(_bl, "seed_method", "?") if _bl else "no_bluetooth_live",
        "scanner_count": getattr(_bl, "seed_scanner_count", 0) if _bl else 0,
        "device_readings": getattr(_bl, "seed_device_readings", 0) if _bl else 0,
        "error": getattr(_bl, "seed_error", "") if _bl else "",
    }
    # Room geometry summary (once, not per-device)
    all_geo = {}
    if model:
        for rn, geo in model.room_geometry_m().items():
            if isinstance(geo, dict):
                all_geo[rn] = geo.get("floor_id", "?")
    connection.send_result(msg["id"], {
        "devices": diag,
        "stats": _stats,
        "ble_seed": ble_seed,
        "all_room_geometry": all_geo,
        "scanner_positions": len(getattr(pc, "_scanner_positions", {})) if pc else 0,
    })


# ═══════════════════════════════════════════════════════════════════════════════
# Propagation health analysis
# ═══════════════════════════════════════════════════════════════════════════════

@websocket_api.websocket_command({"type": "padspan_ha/propagation_health"})
@websocket_api.async_response
async def ws_propagation_health(hass: HomeAssistant, connection, msg) -> None:
    """Compute comprehensive propagation model health analysis.

    Combines data from three sources:
      - Adaptive store: room fingerprint stability, observation counts
      - Calibration store: path-loss fits (R-squared), LOO accuracy
      - Floor pairs: cross-floor RSSI delta (sufficient separation for floor detection)

    Returns an overall letter grade (A-F), per-room status, per-scanner
    path-loss quality, and prioritised recommendations.
    """
    import math as _math

    domain = hass.data.get(DOMAIN, {})
    ad = domain.get(DATA_ADAPTIVE)
    calib = domain.get(DATA_CALIBRATION)
    st = domain.get(DATA_SETTINGS)
    settings = (st.data if st else {}) or {}

    rooms_discovered: list[str] = []
    try:
        from homeassistant.helpers import area_registry as _ar
        rooms_discovered = [a.name for a in _ar.async_get(hass).async_list_areas()]
    except Exception:
        pass
    total_rooms = max(len(rooms_discovered), 1)

    # ── Fingerprint data from adaptive store ──
    fp_data = (ad.data if ad else {}).get("room_fingerprints", {})
    floor_pairs = (ad.data if ad else {}).get("floor_pairs", {})
    ad_stats = (ad.data if ad else {}).get("stats", {})

    # Per-room analysis
    per_room: list[dict[str, Any]] = []
    total_var = 0.0
    var_count = 0
    rooms_with_data = 0
    for room_name in rooms_discovered:
        room_fp = fp_data.get(room_name, {})
        scanners = len(room_fp)
        total_obs = sum(s.get("n", 0) for s in room_fp.values())
        avg_var = 0.0
        if room_fp:
            vars_list = [s.get("var", 0) for s in room_fp.values() if s.get("n", 0) >= 10]
            avg_var = sum(vars_list) / len(vars_list) if vars_list else 0.0
            total_var += avg_var
            var_count += 1
        status = "no data"
        if total_obs >= 100 and avg_var < 15:
            status = "stable"
        elif total_obs >= 30:
            status = "building"
        elif total_obs > 0:
            status = "sparse"
        if total_obs > 0:
            rooms_with_data += 1
        per_room.append({
            "room": room_name,
            "scanners": scanners,
            "observations": total_obs,
            "avg_var": round(avg_var, 1),
            "status": status,
        })
    per_room.sort(key=lambda r: r["observations"], reverse=True)

    # Coverage percentage (rooms with any fingerprint data)
    coverage_pct = round(rooms_with_data / total_rooms, 3) if total_rooms else 0.0

    # Fingerprint stability
    avg_variance = round(total_var / var_count, 1) if var_count else 0.0
    rooms_stable = sum(1 for r in per_room if r["status"] == "stable")
    rooms_unstable = sum(1 for r in per_room if r["status"] in ("sparse", "no data"))

    # ── Calibration model data ──
    accuracy: dict[str, Any] = {}
    per_scanner_pl: list[dict[str, Any]] = []
    if calib:
        try:
            maps_store = domain.get(DATA_MAPS)
            maps_data = maps_store.list_maps() if maps_store else []
            model = calib.compute_model(maps_data)
            loo = model.get("loo_accuracy")
            if loo:
                accuracy = {
                    "mean_error_frac": loo.get("mean_error_frac", 0),
                    "mean_error_m_est": loo.get("mean_error_m_est", 0),
                }
            for src, pl in model.get("path_loss", {}).items():
                r_sq = pl.get("r_squared", 0)
                quality = "good" if r_sq >= 0.7 else "fair" if r_sq >= 0.4 else "poor"
                per_scanner_pl.append({
                    "source": src,
                    "name": pl.get("scanner_name", src),
                    "n": pl.get("n", 0),
                    "rssi_1m": pl.get("rssi_1m", 0),
                    "r_sq": r_sq,
                    "quality": quality,
                })
        except Exception as _cal_err:
            _LOGGER.warning("Propagation health: calibration model error: %s", _cal_err, exc_info=True)

    # ── Floor separation ──
    floor_sep: dict[str, Any] = {"mean_delta": 0, "pairs": 0, "sufficient": False}
    if floor_pairs:
        deltas = [v.get("mean", 0) for v in floor_pairs.values() if v.get("n", 0) >= 5]
        if deltas:
            floor_sep = {
                "mean_delta": round(sum(deltas) / len(deltas), 1),
                "pairs": len(deltas),
                "sufficient": abs(sum(deltas) / len(deltas)) >= 8,
            }

    # ── Recommendations ──
    recs: list[dict[str, str]] = []
    for r in per_room:
        if r["status"] == "no data":
            recs.append({"text": f"No data for {r['room']} — enable adaptive learning or add calibration points", "priority": "high"})
        elif r["status"] == "sparse":
            recs.append({"text": f"Only {r['observations']} observations for {r['room']} — needs more time to stabilize", "priority": "medium"})
        elif r["avg_var"] > 20:
            recs.append({"text": f"{r['room']} fingerprint is unstable (variance {r['avg_var']}) — nearby interference or obstructions?", "priority": "medium"})
    for pl in per_scanner_pl:
        if pl["quality"] == "poor":
            recs.append({"text": f"Scanner {pl['name']} has poor path-loss fit (R\u00b2={pl['r_sq']}) — consider repositioning or adding calibration points near it", "priority": "medium"})
    if not settings.get("adaptive_learning_enabled"):
        recs.append({"text": "Enable adaptive learning in Settings \u2192 Presence to automatically improve accuracy over time", "priority": "low"})
    if floor_sep["pairs"] == 0 and total_rooms > 3:
        recs.append({"text": "No cross-floor data yet — enable floor detection enhancement in Settings \u2192 Presence", "priority": "low"})
    recs = recs[:10]  # cap at 10

    # ── Grade computation ──
    acc_val = accuracy.get("mean_error_frac", 1.0)
    grade = "F"
    if coverage_pct >= 0.8 and acc_val < 0.05 and avg_variance < 15 and (floor_sep["sufficient"] or floor_sep["pairs"] == 0):
        grade = "A"
    elif coverage_pct >= 0.6 and acc_val < 0.08:
        grade = "B"
    elif coverage_pct >= 0.4 and acc_val < 0.12:
        grade = "C"
    elif coverage_pct >= 0.2 or rooms_with_data > 0:
        grade = "D"
    # If no calibration data at all, use adaptive data alone for grade
    if not accuracy and rooms_with_data > 0:
        if coverage_pct >= 0.8 and avg_variance < 15:
            grade = "B"
        elif coverage_pct >= 0.5:
            grade = "C"
        else:
            grade = "D"

    connection.send_result(msg["id"], {
        "grade": grade,
        "coverage_pct": coverage_pct,
        "accuracy": accuracy,
        "fingerprint_stability": {
            "avg_variance": avg_variance,
            "rooms_stable": rooms_stable,
            "rooms_unstable": rooms_unstable,
        },
        "floor_separation": floor_sep,
        "per_room": per_room,
        "per_scanner_pl": per_scanner_pl,
        "recommendations": recs,
        "settings": {
            "ref_power": settings.get("ref_power", -59.0),
            "path_loss_exp": settings.get("path_loss_exp", 2.5),
            "room_sigma_m": settings.get("room_sigma_m", 4.0),
            "kalman_q": settings.get("kalman_q", 0.125),
            "kalman_r": settings.get("kalman_r", 8.0),
            "adaptive_enabled": bool(settings.get("adaptive_learning_enabled")),
            "adaptive_maturity": ad.maturity() if ad else 0,
        },
    })


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


@websocket_api.websocket_command({"type": "padspan_ha/system_critics"})
@websocket_api.async_response
async def ws_system_critics(hass: HomeAssistant, connection, msg) -> None:
    """Phase 4: unified system self-diagnosis.

    Collects diagnostics from every data source and emits a flat list of
    critic messages sorted by severity, plus a room-confusion matrix.
    """
    from datetime import datetime, timezone as _tz  # noqa: PLC0415
    import math as _math  # noqa: PLC0415

    domain = hass.data.get(DOMAIN, {})
    ad = domain.get(DATA_ADAPTIVE)
    calib = domain.get(DATA_CALIBRATION)
    coord = domain.get(DATA_COORDINATOR)
    maps_store = domain.get(DATA_MAPS)
    st = domain.get(DATA_SETTINGS)
    settings: dict[str, Any] = (st.data if st else {}) or {}

    critics: list[dict[str, Any]] = []

    # ── 1. Room Confusion Matrix ──────────────────────────────────────────────
    # Analyse bidirectional transition counts from the adaptive store.
    # Rooms that frequently transition back and forth are likely "confused" —
    # the system keeps oscillating between them.
    confusion_matrix: list[dict[str, Any]] = []
    if ad:
        tc = (ad.data or {}).get("transition_counts", {})
        # Build symmetric pair counts: confusion(A,B) = tc[A][B] + tc[B][A]
        pair_counts: dict[tuple[str, str], int] = {}
        for from_room, dests in tc.items():
            for to_room, count in dests.items():
                if from_room == to_room:
                    continue
                pair = tuple(sorted([from_room, to_room]))
                pair_counts[pair] = pair_counts.get(pair, 0) + count

        # Total transitions for rate calculation
        total_transitions = sum(pair_counts.values()) if pair_counts else 1

        # Sort by count descending — top confused pairs first
        sorted_pairs = sorted(pair_counts.items(), key=lambda x: x[1], reverse=True)

        for (room_a, room_b), count in sorted_pairs:
            if count < 4:
                break  # below noise threshold
            rate = round(count / total_transitions, 3) if total_transitions else 0
            confusion_matrix.append({
                "room_a": room_a,
                "room_b": room_b,
                "count": count,
                "rate": rate,
            })

        # Flag top confused pairs as critics
        for entry in confusion_matrix[:5]:
            count = entry["count"]
            rate = entry["rate"]
            room_a, room_b = entry["room_a"], entry["room_b"]
            if rate >= 0.15:
                severity = "critical"
            elif rate >= 0.08 or count >= 20:
                severity = "warning"
            else:
                severity = "info"
            critics.append({
                "category": "room_confusion",
                "severity": severity,
                "title": f"{room_a} \u2194 {room_b} frequently confused",
                "message": (
                    f"{count} bidirectional transitions ({rate:.0%} of all). "
                    "The system may be oscillating between these rooms."
                ),
                "action": (
                    f"Add calibration points in both {room_a} and {room_b}, "
                    "especially near the boundary. Consider adding an RF barrier "
                    "in the map editor if a wall separates them."
                ),
            })

    # ── 2. Per-Map Quality (LOO cross-validation) ─────────────────────────────
    per_map_quality: list[dict[str, Any]] = []
    if calib:
        try:
            maps_data = maps_store.list_maps() if maps_store else []
            model = calib.compute_model(maps_data)
            cov_by_map = model.get("coverage_by_map", {})
            map_name_lookup: dict[str, str] = {}
            for m in maps_data:
                map_name_lookup[m.get("id", "")] = m.get("name", m.get("id", ""))

            for mid, cov in cov_by_map.items():
                loo = cov.get("loo_accuracy")
                map_name = map_name_lookup.get(mid, mid)
                point_count = cov.get("point_count", 0)
                entry = {
                    "map_id": mid,
                    "map_name": map_name,
                    "point_count": point_count,
                    "mean_error_frac": loo["mean_error_frac"] if loo else None,
                    "mean_error_m_est": loo["mean_error_m_est"] if loo else None,
                    "max_error_frac": loo["max_error_frac"] if loo else None,
                }
                per_map_quality.append(entry)

                # Generate critic if LOO error is high
                if loo:
                    err_m = loo.get("mean_error_m_est", 0)
                    err_frac = loo.get("mean_error_frac", 0)
                    if err_frac >= 0.15:
                        severity = "critical"
                    elif err_frac >= 0.08:
                        severity = "warning"
                    else:
                        continue  # acceptable
                    critics.append({
                        "category": "map_quality",
                        "severity": severity,
                        "title": f"Map \u201c{map_name}\u201d has high calibration error",
                        "message": (
                            f"LOO mean error: {err_m:.1f}m ({err_frac:.1%} of map). "
                            f"Max error: {loo.get('max_error_frac', 0):.1%}. "
                            f"Based on {point_count} calibration points."
                        ),
                        "action": (
                            f"Add more calibration points to \u201c{map_name}\u201d, "
                            "especially in areas with poor coverage. Check that "
                            "room boundaries match the physical layout."
                        ),
                    })
                elif point_count < 5:
                    critics.append({
                        "category": "map_quality",
                        "severity": "info",
                        "title": f"Map \u201c{map_name}\u201d has few calibration points",
                        "message": f"Only {point_count} point(s). Need \u22655 for LOO validation.",
                        "action": f"Run a calibration walk-around on \u201c{map_name}\u201d.",
                    })
        except Exception:
            pass

    # ── 3. Scanner Disagreement (from coordinator Phase 3 data) ───────────────
    scanner_critics: list[dict[str, Any]] = []
    if coord and hasattr(coord, "_scanner_reliability"):
        # Get live radio names for friendly display
        live_radios: list[dict[str, Any]] = []
        try:
            live_radios = (
                coord.data.get("ble", {}).get("radios", []) if coord.data else []
            )
        except Exception:
            pass
        radio_name_map: dict[str, str] = {}
        for _r in live_radios:
            _src = _r.get("source") or ""
            _nm = _r.get("name") or _r.get("area_name") or _r.get("area") or ""
            if _src and _nm:
                radio_name_map[_src] = _nm

        for src, rel in coord._scanner_reliability.items():
            q = coord._scanner_agree.get(src)
            polls = len(q) if q else 0
            if polls < 12:
                continue  # not enough data
            agree_pct = round(sum(q) / polls * 100, 0) if polls else 100
            name = radio_name_map.get(src, src)
            entry = {
                "source": src,
                "name": name,
                "reliability": rel,
                "agree_pct": agree_pct,
                "polls": polls,
            }
            scanner_critics.append(entry)

            if rel < 0.6:
                severity = "critical"
            elif rel < 0.7:
                severity = "warning"
            else:
                continue  # healthy
            critics.append({
                "category": "scanner",
                "severity": severity,
                "title": f"Scanner \u201c{name}\u201d disagrees with consensus",
                "message": (
                    f"Reliability {rel:.2f} ({agree_pct:.0f}% agreement over {polls} polls). "
                    "This scanner frequently assigns objects to the wrong room."
                ),
                "action": (
                    f"Check scanner \u201c{name}\u201d placement and antenna orientation. "
                    "Ensure it is in the correct HA area. Consider adjusting its "
                    "RSSI offset in Settings \u2192 Scanner Map."
                ),
            })

    # ── 4. Calibration Staleness & Coverage Gaps ──────────────────────────────
    if calib:
        points: list[dict[str, Any]] = calib.data.get("points") or []
        now_ts = datetime.now(_tz.utc).timestamp()

        # Staleness
        if points:
            isos = [p.get("collected_at") or "" for p in points]
            latest_iso = max((s for s in isos if s), default="")
            if latest_iso:
                try:
                    latest_ts = datetime.fromisoformat(latest_iso).timestamp()
                    stale_days = round((now_ts - latest_ts) / 86400)
                    if stale_days > 90:
                        critics.append({
                            "category": "calibration",
                            "severity": "warning",
                            "title": "Calibration data is stale",
                            "message": f"Last calibration was {stale_days} days ago.",
                            "action": "Run a fresh calibration walk-around to account for any changes in furniture, hardware, or RF environment.",
                        })
                    elif stale_days > 60:
                        critics.append({
                            "category": "calibration",
                            "severity": "info",
                            "title": "Calibration data is aging",
                            "message": f"Last calibration was {stale_days} days ago. Consider refreshing soon.",
                            "action": "Schedule a calibration session to keep accuracy optimal.",
                        })
                except Exception:
                    pass
        elif not points:
            critics.append({
                "category": "calibration",
                "severity": "critical",
                "title": "No calibration data",
                "message": "The system has zero calibration points. Positioning relies solely on adaptive learning and default models.",
                "action": "Run the Calibration \u2192 Tune workflow to collect reference data.",
            })

    # ── 5. Adaptive Learning Health ───────────────────────────────────────────
    if ad:
        fp_data = (ad.data or {}).get("room_fingerprints", {})
        stats = (ad.data or {}).get("stats", {})
        total_obs = stats.get("total_observations", 0)

        # Rooms with unstable fingerprints (high variance)
        for room_name, room_fp in fp_data.items():
            vars_list = [
                s.get("var", 0) for s in room_fp.values()
                if s.get("n", 0) >= 10
            ]
            if not vars_list:
                continue
            avg_var = sum(vars_list) / len(vars_list)
            if avg_var > 25:
                critics.append({
                    "category": "propagation",
                    "severity": "warning",
                    "title": f"{room_name} fingerprint is unstable",
                    "message": f"Average RSSI variance {avg_var:.1f} dBm\u00b2 (target <15). Signal environment is noisy or changing.",
                    "action": f"Check for interference sources near {room_name} (microwaves, USB3, WiFi APs). Consider adding calibration points.",
                })

        if not settings.get("adaptive_learning_enabled") and total_obs == 0:
            critics.append({
                "category": "propagation",
                "severity": "info",
                "title": "Adaptive learning is disabled",
                "message": "The system is not passively learning from confirmed room assignments.",
                "action": "Enable adaptive learning in Settings \u2192 Presence to improve accuracy over time.",
            })

    # ── Sort by severity ──────────────────────────────────────────────────────
    _sev_order = {"critical": 0, "warning": 1, "info": 2}
    critics.sort(key=lambda c: (_sev_order.get(c["severity"], 9), c["category"]))

    # ── Summary counts ────────────────────────────────────────────────────────
    summary = {
        "total": len(critics),
        "critical": sum(1 for c in critics if c["severity"] == "critical"),
        "warning": sum(1 for c in critics if c["severity"] == "warning"),
        "info": sum(1 for c in critics if c["severity"] == "info"),
        "healthy": len(critics) == 0,
    }

    connection.send_result(msg["id"], {
        "summary": summary,
        "critics": critics,
        "confusion_matrix": confusion_matrix[:20],  # cap at 20 pairs
        "per_map_quality": per_map_quality,
        "scanner_critics": scanner_critics,
    })


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

_ALL_STORE_KEYS = [
    SETTINGS_STORE_KEY,
    CALIBRATION_STORE_KEY,
    ADAPTIVE_STORE_KEY,
    OBJECT_STORE_KEY,
    MAPS_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
    ALERTS_STORE_KEY,
    MOVEMENT_STORE_KEY,
    TRACEBACK_STORE_KEY,
    OBJECT_HISTORY_STORE_KEY,
]

# Maps HA Storage file keys → in-memory hass.data[DOMAIN] keys.
# Used by both backup (read live data) and restore (hot-patch in-memory stores).
_DATA_KEY_MAP = {
    SETTINGS_STORE_KEY: DATA_SETTINGS,
    CALIBRATION_STORE_KEY: DATA_CALIBRATION,
    ADAPTIVE_STORE_KEY: DATA_ADAPTIVE,
    OBJECT_STORE_KEY: DATA_OBJECTS,
    MAPS_STORE_KEY: DATA_MAPS,
    MODEL_STORE_KEY: DATA_MODEL,
    FABRIC_STORE_KEY: DATA_FABRIC,
    ALERTS_STORE_KEY: DATA_ALERTS,
    MOVEMENT_STORE_KEY: DATA_MOVEMENT,
    TRACEBACK_STORE_KEY: DATA_TRACEBACK,
    OBJECT_HISTORY_STORE_KEY: DATA_OBJECT_HISTORY,
}

_MAX_BACKUPS = 3  # Oldest backup is dropped when a new one exceeds this limit


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


@websocket_api.websocket_command({"type": "padspan_ha/beacon_positions_get"})
@websocket_api.async_response
async def ws_beacon_positions_get(hass: HomeAssistant, connection, msg) -> None:
    """Return all pinned beacon positions across all maps with their computed room.

    Used by the Beacon Tune tab to show where beacons are placed.  Room is
    determined by point-in-polygon/circle test against the map's room_bounds.
    """
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not ms:
        connection.send_result(msg["id"], {"positions": []})
        return
    positions: list[dict[str, Any]] = []
    for m in ms.list_maps():
        map_id = m.get("id", "")
        floor_id = m.get("floor_id", "")
        room_bounds = m.get("room_bounds") or {}
        for bk in m.get("beacons") or []:
            room = _room_from_bounds(room_bounds, float(bk.get("x", 0)), float(bk.get("y", 0)))
            positions.append({
                "key": bk.get("key", ""),
                "map_id": map_id,
                "x": bk.get("x", 0),
                "y": bk.get("y", 0),
                "label": bk.get("label", ""),
                "floor_id": floor_id,
                "room": room,
                "kind": bk.get("kind", ""),
            })
    connection.send_result(msg["id"], {"positions": positions})


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


@websocket_api.websocket_command({"type": "padspan_ha/ha_entities_audit"})
@websocket_api.async_response
async def ws_ha_entities_audit(hass: HomeAssistant, connection, msg) -> None:
    """Return every PadSpan entity with live state, health, and automation usage."""
    er = entity_registry.async_get(hass)
    now = dt_util.utcnow()
    entities: list[dict[str, Any]] = []

    # Collect automation/script entity_id references via HA helpers (2023.1+)
    _auto_users: dict[str, list[str]] = {}  # padspan_entity_id → [automation.xxx]
    _script_users: dict[str, list[str]] = {}
    _padspan_eids: list[str] = []
    for entry in er.entities.values():
        if entry.platform == DOMAIN:
            _padspan_eids.append(entry.entity_id)

    try:
        from homeassistant.components.automation import automations_with_entity  # noqa: PLC0415
        for eid in _padspan_eids:
            refs = automations_with_entity(hass, eid)
            if refs:
                _auto_users[eid] = list(refs)
    except Exception:
        pass
    try:
        from homeassistant.components.script import scripts_with_entity  # noqa: PLC0415
        for eid in _padspan_eids:
            refs = scripts_with_entity(hass, eid)
            if refs:
                _script_users[eid] = list(refs)
    except Exception:
        pass

    # Classify entity type from unique_id suffix
    def _etype(uid: str) -> str:
        if "__tracker" in uid:
            return "tracker"
        if "__dist__" in uid:
            return "scanner_distance"
        if "__distance" in uid:
            return "distance"
        if "__area" in uid:
            return "area"
        return "unknown"

    # Suggestions per type for entities with no automation usage
    _suggestions: dict[str, str] = {
        "tracker": "Link to a Person entity (Settings → People) for zone-based presence.",
        "area": "Add a confidence-gated automation — trigger on room change with room_confidence > 0.75.",
        "distance": "Create a proximity trigger — e.g. wake a device when distance < 1.5 m.",
        "scanner_distance": "Build micro-zones — trigger per-scanner when distance < 1.2 m for room-within-room control.",
    }

    for entry in er.entities.values():
        if entry.platform != DOMAIN:
            continue

        eid = entry.entity_id
        uid = entry.unique_id or ""
        etype = _etype(uid)

        # Live state from hass.states
        state_obj: State | None = hass.states.get(eid)
        state_val: str | None = None
        last_changed: str | None = None
        last_updated: str | None = None
        attrs: dict[str, Any] = {}
        if state_obj:
            state_val = state_obj.state
            last_changed = state_obj.last_changed.isoformat() if state_obj.last_changed else None
            last_updated = state_obj.last_updated.isoformat() if state_obj.last_updated else None
            attrs = dict(state_obj.attributes)

        # Health classification
        health = "good"
        health_detail = ""
        if entry.disabled_by is not None:
            health = "disabled"
            health_detail = f"Disabled by {entry.disabled_by}"
        elif state_val == "unavailable":
            health = "unavailable"
            health_detail = "Entity is unavailable — integration may need reload."
        elif state_val == "unknown":
            health = "unknown"
            health_detail = "State is unknown — device may not have reported yet."
        elif state_obj and state_obj.last_changed:
            age_h = (now - state_obj.last_changed).total_seconds() / 3600
            if age_h > 24:
                health = "stale"
                health_detail = f"No state change in {int(age_h)}h — device may be away or out of range."

        # Automation / script usage
        autos = _auto_users.get(eid, [])
        scripts = _script_users.get(eid, [])
        used_count = len(autos) + len(scripts)

        # Suggestion hint (only for unused entities)
        suggestion = ""
        if used_count == 0 and health not in ("disabled",):
            suggestion = _suggestions.get(etype, "")

        # Friendly label: try to extract from device name
        dev_label = ""
        if entry.device_id:
            try:
                dr = device_registry.async_get(hass)
                dev = dr.async_get(entry.device_id)
                if dev and dev.name:
                    dev_label = dev.name
            except Exception:
                pass

        entities.append({
            "entity_id": eid,
            "unique_id": uid,
            "type": etype,
            "device_label": dev_label,
            "state": state_val,
            "last_changed": last_changed,
            "last_updated": last_updated,
            "disabled_by": str(entry.disabled_by) if entry.disabled_by else None,
            "health": health,
            "health_detail": health_detail,
            "automations": autos,
            "scripts": scripts,
            "used_count": used_count,
            "suggestion": suggestion,
            "room_confidence": attrs.get("room_confidence"),
            "home": attrs.get("home"),
        })

    # Sort: active first, then by type, then entity_id
    _type_order = {"tracker": 0, "area": 1, "distance": 2, "scanner_distance": 3, "unknown": 4}
    entities.sort(key=lambda e: (
        0 if e["health"] == "good" else (1 if e["health"] == "stale" else 2),
        _type_order.get(e["type"], 9),
        e["entity_id"],
    ))

    # Summary stats
    by_health = {}
    by_type = {}
    for e in entities:
        by_health[e["health"]] = by_health.get(e["health"], 0) + 1
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    total_used = sum(1 for e in entities if e["used_count"] > 0)

    connection.send_result(msg["id"], {
        "entities": entities,
        "total": len(entities),
        "by_health": by_health,
        "by_type": by_type,
        "total_used_in_automations": total_used,
    })


# ── Geometry Helpers ───────────────────────────────────────────────────────────

def _room_from_bounds(room_bounds: dict, x: float, y: float) -> str:
    """Determine which room a point (x,y) falls in using room boundary shapes.

    Supports two shape types:
      - "circle": center (cx,cy) + radius r — simple distance check
      - "poly": list of [x,y] vertices — ray-casting point-in-polygon test
    Returns the room name or '' if the point is outside all boundaries.
    """
    for room_name, b in room_bounds.items():
        if not isinstance(b, dict):
            continue
        btype = b.get("type", "poly")
        if btype == "circle":
            cx = float(b.get("cx", 0.5))
            cy = float(b.get("cy", 0.5))
            r = float(b.get("r", 0.12))
            if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                return str(room_name)
        elif btype == "poly":
            pts = b.get("points") or []
            if len(pts) < 3:
                continue
            # Ray-casting point-in-polygon test
            inside = False
            n = len(pts)
            j = n - 1
            for i in range(n):
                xi, yi = float(pts[i][0]), float(pts[i][1])
                xj, yj = float(pts[j][0]), float(pts[j][1])
                if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                    inside = not inside
                j = i
            if inside:
                return str(room_name)
    return ""


# ── Private BLE / IRK Management ───────────────────────────────────────────────
# IRKs (Identity Resolving Keys) let PadSpan identify phones/watches whose BLE
# MAC address rotates every ~15 minutes.  IRKs can come from HA's private_ble_device
# integration or be managed directly via PadSpan settings (irk_add/irk_remove).

@websocket_api.websocket_command({"type": "padspan_ha/private_ble_status"})
@websocket_api.async_response
async def ws_private_ble_status(hass: HomeAssistant, connection, msg) -> None:
    """Return Private BLE Device resolver status for the UI setup wizard.

    Includes: IRK count, registered devices, RPA count in live BLE cache,
    and whether the private_ble_device integration is available.
    """
    try:
        resolver = await _get_ble_resolver(hass)
        status = resolver.get_status()

        # Count RPAs in live BLE cache
        ble_live = get_bluetooth_live(hass)
        snap = ble_live.get_snapshot(max_ads=2000, max_age_s=3600)
        all_addrs = set()
        for ad in (snap.get("advertisements") or []):
            addr = ad.get("address")
            if addr:
                all_addrs.add(addr)
        status["rpa_count"] = resolver.count_rpas(all_addrs)
        status["total_ble_addresses"] = len(all_addrs)

        connection.send_result(msg["id"], status)
    except Exception as err:
        _LOGGER.warning("private_ble_status failed: %s", err)
        connection.send_result(msg["id"], {
            "irk_count": 0, "devices": [], "source_info": [],
            "has_private_ble_integration": False, "mobile_apps": [],
            "rpa_count": 0, "total_ble_addresses": 0,
            "error": str(err),
        })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/irk_add",
        vol.Required("name"): str,
        vol.Required("irk_hex"): str,
    }
)
@websocket_api.async_response
async def ws_irk_add(hass: HomeAssistant, connection, msg) -> None:
    """Add an IRK directly via PadSpan settings (no private_ble_device integration needed).

    Accepts IRK in multiple formats: 32 hex chars, base64 (24 chars = 16 bytes),
    or colon/dash/space-separated hex.  Normalises to lowercase hex, checks for
    duplicates, stores in settings.irk_devices, and reloads the resolver
    immediately so the IRK takes effect without restart.
    """
    from .private_ble_resolver import _parse_irk  # noqa: PLC0415

    name = str(msg["name"]).strip()
    irk_raw = str(msg["irk_hex"]).strip()
    if not name:
        connection.send_error(msg["id"], "invalid", "name is required")
        return
    if not irk_raw:
        connection.send_error(msg["id"], "invalid", "irk_hex is required")
        return

    # Use _parse_irk for consistent handling (same path as resolver + validation)
    irk_bytes = _parse_irk(irk_raw)
    if not irk_bytes:
        connection.send_error(msg["id"], "invalid", "Could not parse IRK. Enter 32 hex chars or base64.")
        return

    irk_clean = irk_bytes.hex().lower()

    # Store in settings
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return

    irk_list = list(st.data.get("irk_devices") or [])
    # Check for duplicates
    for existing in irk_list:
        if (existing.get("irk_hex") or "").lower().replace(":", "").replace("-", "").replace(" ", "") == irk_clean:
            connection.send_error(msg["id"], "duplicate", f"IRK already registered for '{existing.get('name')}'")
            return

    irk_list.append({"name": name, "irk_hex": irk_clean})
    await st.async_set(irk_devices=irk_list)

    # Reload the resolver so it picks up the new IRK immediately
    try:
        resolver = await _get_ble_resolver(hass)
        await resolver.async_load()
        _LOGGER.info("IRK added for '%s' — resolver reloaded (%d devices)", name, resolver.device_count)
    except Exception as e:
        _LOGGER.warning("IRK added but resolver reload failed: %s", e)

    connection.send_result(msg["id"], {
        "ok": True,
        "name": name,
        "irk_hex": irk_clean,
        "canonical_id": f"irk:{irk_clean}",
        "device_count": resolver.device_count if resolver else 0,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/irk_validate",
        vol.Required("irk_hex"): str,
    }
)
@websocket_api.async_response
async def ws_irk_validate(hass: HomeAssistant, connection, msg) -> None:
    """Test an IRK against all currently-visible BLE RPAs.

    Returns the number of matched addresses so the UI can confirm the key is
    valid before saving.  Does NOT persist anything — purely a read-only check.

    Tries the IRK in multiple byte orders and base64 vs hex interpretations
    to maximise the chance of finding a match.
    """
    from .private_ble_resolver import _parse_irk, _address_matches_irk, _is_rpa  # noqa: PLC0415
    import base64 as _b64  # noqa: PLC0415

    irk_raw = str(msg["irk_hex"]).strip()

    # Build a set of candidate IRK byte arrays to try
    candidates: list[tuple[bytes, str]] = []  # (irk_bytes, description)
    seen_hex: set[str] = set()

    def _add_candidate(b: bytes, desc: str) -> None:
        h = b.hex()
        if h not in seen_hex:
            seen_hex.add(h)
            candidates.append((b, desc))

    # Primary parse
    irk_bytes = _parse_irk(irk_raw)
    if irk_bytes:
        _add_candidate(irk_bytes, "parsed")
        _add_candidate(bytes(reversed(irk_bytes)), "parsed_reversed")

    # Also try raw base64 without any reversal (in case _parse_irk applied reversal)
    stripped = irk_raw.strip()
    if stripped.lower().startswith("irk:"):
        stripped = stripped[4:]
    try:
        raw_b64 = _b64.b64decode(stripped)
        if len(raw_b64) == 16:
            _add_candidate(raw_b64, "base64_raw")
            _add_candidate(bytes(reversed(raw_b64)), "base64_reversed")
    except Exception:
        pass
    # Try with padding
    for pad in ("=", "=="):
        try:
            raw_b64p = _b64.b64decode(stripped + pad)
            if len(raw_b64p) == 16:
                _add_candidate(raw_b64p, "base64_padded")
                _add_candidate(bytes(reversed(raw_b64p)), "base64_padded_reversed")
        except Exception:
            pass

    # Try hex with separator stripping
    import re as _re  # noqa: PLC0415
    cleaned = _re.sub(r"[:\-\s]", "", stripped)
    if len(cleaned) == 32:
        try:
            h_bytes = bytes.fromhex(cleaned)
            _add_candidate(h_bytes, "hex")
            _add_candidate(bytes(reversed(h_bytes)), "hex_reversed")
        except ValueError:
            pass

    if not candidates:
        connection.send_error(msg["id"], "invalid", "Could not parse IRK. Enter 32 hex chars or base64.")
        return

    # Gather all RPAs from the live BLE advertisement cache
    try:
        ble_live = get_bluetooth_live(hass)
        snap = ble_live.get_snapshot(max_ads=5000, max_age_s=3600)
        rpas: set[str] = set()
        for ad in (snap.get("advertisements") or []):
            addr = (ad.get("address") or "").upper()
            if addr and _is_rpa(addr):
                rpas.add(addr)
    except Exception as err:
        _LOGGER.warning("irk_validate: BLE snapshot error: %s", err)
        rpas = set()

    # Test ALL candidate byte orders against every RPA
    best_matched: list[str] = []
    best_irk: bytes | None = None
    best_desc: str = ""

    for cand_bytes, cand_desc in candidates:
        matched: list[str] = []
        for addr in rpas:
            try:
                if _address_matches_irk(addr, cand_bytes):
                    matched.append(addr)
            except Exception:
                pass
        if len(matched) > len(best_matched):
            best_matched = matched
            best_irk = cand_bytes
            best_desc = cand_desc
        if best_matched:
            break  # Found matches, no need to try more candidates

    result_irk = best_irk or (candidates[0][0] if candidates else irk_bytes)
    connection.send_result(msg["id"], {
        "valid": len(best_matched) > 0,
        "matched_count": len(best_matched),
        "matched_addresses": best_matched[:10],
        "rpa_count": len(rpas),
        "irk_hex": result_irk.hex() if result_irk else "",
        "matched_format": best_desc,
        "candidates_tried": len(candidates),
    })


@websocket_api.websocket_command({"type": "padspan_ha/irk_auto_detect"})
@websocket_api.async_response
async def ws_irk_auto_detect(hass: HomeAssistant, connection, msg) -> None:
    """Scan system Bluetooth bonds and live BLE cache to find IRKs automatically.

    Checks:
    1. Linux Bluetooth bonded device files (/var/lib/bluetooth/...)
    2. HA private_ble_device config entries (already loaded by resolver)
    3. Live BLE advertisements — tests found IRKs against visible RPAs
    """
    from .private_ble_resolver import (  # noqa: PLC0415
        _read_system_bluetooth_irks, _parse_irk, _address_matches_irk, _is_rpa,
    )

    found: list[dict[str, Any]] = []
    already_registered: set[str] = set()

    # Get currently registered IRKs to mark duplicates
    try:
        resolver = await _get_ble_resolver(hass)
        for dev in resolver._devices:
            already_registered.add(dev["irk_bytes"].hex())
            already_registered.add(bytes(reversed(dev["irk_bytes"])).hex())
    except Exception:
        pass

    # 1. System Bluetooth bonds
    try:
        sys_irks = await hass.async_add_executor_job(_read_system_bluetooth_irks)
        for si in sys_irks:
            irk_hex = si["irk_bytes"].hex()
            is_dup = irk_hex in already_registered
            found.append({
                "name": si["name"],
                "irk_hex": irk_hex,
                "source": "bluetooth_bond",
                "device_mac": si.get("device_mac", ""),
                "already_registered": is_dup,
            })
    except Exception as err:
        _LOGGER.debug("IRK auto-detect system scan: %s", err)

    # 2. Gather RPAs from live BLE to verify found IRKs
    rpas: set[str] = set()
    try:
        ble_live = get_bluetooth_live(hass)
        snap = ble_live.get_snapshot(max_ads=5000, max_age_s=3600)
        for ad in (snap.get("advertisements") or []):
            addr = (ad.get("address") or "").upper()
            if addr and _is_rpa(addr):
                rpas.add(addr)
    except Exception:
        pass

    # Test each found IRK against live RPAs
    for item in found:
        if item["already_registered"]:
            item["verified"] = True
            item["matched_count"] = -1  # already tracked
            continue
        try:
            irk_bytes = bytes.fromhex(item["irk_hex"])
            matched = sum(1 for addr in rpas if _address_matches_irk(addr, irk_bytes))
            item["verified"] = matched > 0
            item["matched_count"] = matched
        except Exception:
            item["verified"] = False
            item["matched_count"] = 0

    connection.send_result(msg["id"], {
        "found": found,
        "rpa_count": len(rpas),
        "system_bond_count": len([f for f in found if f["source"] == "bluetooth_bond"]),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/irk_remove",
        vol.Required("irk_hex"): str,
    }
)
@websocket_api.async_response
async def ws_irk_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove a PadSpan-managed IRK and reload the resolver."""
    irk_raw = str(msg["irk_hex"]).strip().lower().replace(":", "").replace("-", "").replace(" ", "")
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "not_ready", "Settings store not available")
        return

    irk_list = list(st.data.get("irk_devices") or [])
    new_list = [e for e in irk_list if (e.get("irk_hex") or "").lower().replace(":", "").replace("-", "").replace(" ", "") != irk_raw]
    removed = len(irk_list) - len(new_list)
    await st.async_set(irk_devices=new_list)

    try:
        resolver = await _get_ble_resolver(hass)
        await resolver.async_load()
    except Exception:
        pass

    connection.send_result(msg["id"], {"ok": True, "removed": removed})


@websocket_api.websocket_command({
    "type": "padspan_ha/private_ble_add_irk",
    vol.Required("irk"): str,
    vol.Optional("name", default=""): str,
})
@websocket_api.async_response
async def ws_private_ble_add_irk(hass: HomeAssistant, connection, msg) -> None:
    """Add a Private BLE Device IRK via PadSpan UI (creates HA config entry)."""
    import re as _re
    import base64 as _b64

    irk_input = str(msg.get("irk", "")).strip()
    device_name = str(msg.get("name", "")).strip() or "PadSpan Device"

    if not irk_input:
        connection.send_error(msg["id"], "invalid_irk", "IRK is required")
        return

    # Normalise IRK: accept hex (with/without colons/spaces), base64, or irk:-prefixed base64
    irk_hex = ""
    irk_stripped = irk_input
    # Strip "irk:" prefix if present (HA format)
    if irk_stripped.lower().startswith("irk:"):
        irk_stripped = irk_stripped[4:]
    try:
        # Try hex first — strip separators
        cleaned = _re.sub(r"[:\-\s]", "", irk_stripped)
        if _re.fullmatch(r"[0-9a-fA-F]{32}", cleaned):
            irk_hex = cleaned.lower()
        else:
            # Try base64
            decoded = _b64.b64decode(irk_stripped)
            if len(decoded) == 16:
                irk_hex = decoded.hex()
    except Exception:
        pass

    if not irk_hex or len(irk_hex) != 32:
        connection.send_error(msg["id"], "invalid_irk",
            "IRK must be 32 hex characters, 24-char base64 (16 bytes), or irk:-prefixed base64")
        return

    # Check for duplicates.  Stored IRKs vary in format (plain hex, base64,
    # irk:-prefixed) and byte order — normalise through the same decoder and
    # compare BOTH orders, else re-adding the same IRK in a different format
    # sails past this check and creates a duplicate entry.
    def _stored_irk_hexes(raw: Any) -> set[str]:
        s = str(raw or "").strip()
        if s.lower().startswith("irk:"):
            s = s[4:]
        cleaned = _re.sub(r"[:\-\s]", "", s)
        if _re.fullmatch(r"[0-9a-fA-F]{32}", cleaned):
            b = bytes.fromhex(cleaned.lower())
        else:
            try:
                b = _b64.b64decode(s)
            except Exception:
                return set()
            if len(b) != 16:
                return set()
        return {b.hex(), b[::-1].hex()}

    for entry in hass.config_entries.async_entries("private_ble_device"):
        if irk_hex in _stored_irk_hexes((entry.data or {}).get("irk", "")):
            connection.send_result(msg["id"], {
                "ok": True, "duplicate": True,
                "message": f"IRK already registered as '{entry.title}'",
            })
            return

    # HA's private_ble_device config flow accepts:
    #   1) Plain hex: "aabbccdd..." (32 chars)
    #   2) "irk:"-prefixed base64: "irk:AAAA...==" (bytes are REVERSED by HA)
    # The flow also requires the device to be actively broadcasting in range.
    irk_bytes = bytes.fromhex(irk_hex)
    irk_bytes_reversed = irk_bytes[::-1]
    irk_formats = [
        irk_hex,                                                         # plain hex
        "irk:" + _b64.b64encode(irk_bytes_reversed).decode(),           # irk:-prefixed base64 (HA reverses)
        "irk:" + _b64.b64encode(irk_bytes).decode(),                    # irk:-prefixed base64 (no reversal)
        irk_bytes_reversed.hex(),                                        # reversed hex
    ]

    async def _try_create_entry(irk_value: str) -> tuple[dict | None, str]:
        """Attempt to create a private_ble_device config entry with the given IRK format.
        Returns (flow_result, error_detail) tuple."""
        flow_id = None

        def _abort_flow() -> None:
            # A failed attempt must not leave the config flow in progress —
            # each of the 4 format retries used to leak one, piling up
            # "discovered" flows in Settings until restart.
            if flow_id:
                try:
                    hass.config_entries.flow.async_abort(flow_id)
                except Exception:
                    pass

        try:
            result = await hass.config_entries.flow.async_init(
                "private_ble_device",
                context={"source": "user"},
            )
            rtype = str(result.get("type", ""))

            if "create_entry" in rtype:
                return result, ""

            flow_id = result.get("flow_id")
            if "form" not in rtype:
                _abort_flow()
                return None, f"flow init returned {rtype}"

            if not flow_id:
                return None, "no flow_id"

            # Submit the IRK to the form
            result2 = await hass.config_entries.flow.async_configure(
                flow_id, user_input={"irk": irk_value}
            )
            rtype2 = str(result2.get("type", ""))

            if "create_entry" in rtype2:
                return result2, ""

            errors = result2.get("errors") or {}
            if errors:
                err_detail = ", ".join(f"{k}: {v}" for k, v in errors.items())
                _LOGGER.debug("private_ble flow errors for format %s: %s",
                              irk_value[:20], err_detail)
                _abort_flow()
                return None, err_detail

            _abort_flow()
            return None, f"flow returned {rtype2}"
        except Exception as e:
            _abort_flow()
            return None, str(e)

    try:
        created = None
        all_errors: list[str] = []
        for fmt in irk_formats:
            result, err_detail = await _try_create_entry(fmt)
            if result:
                created = result
                break
            if err_detail:
                all_errors.append(err_detail)

        if created:
            entry = created.get("result")
            if entry and device_name:
                hass.config_entries.async_update_entry(entry, title=device_name)
            # Force resolver refresh
            try:
                resolver = await _get_ble_resolver(hass)
                await resolver.async_load()
            except Exception:
                pass
            connection.send_result(msg["id"], {
                "ok": True, "duplicate": False,
                "message": f"IRK registered as '{device_name}'",
                "entry_id": entry.entry_id if entry else None,
            })
        else:
            # Determine the most helpful error message
            unique_errors = list(dict.fromkeys(all_errors))  # deduplicate preserving order
            if any("irk_not_found" in e for e in unique_errors):
                connection.send_error(msg["id"], "irk_not_found",
                    "IRK is valid but no matching device was detected. "
                    "The device must be actively broadcasting nearby (Bluetooth on, in range of a scanner). "
                    "Make sure the device is awake and near a scanner, then try again.")
            elif any("irk_not_valid" in e for e in unique_errors):
                connection.send_error(msg["id"], "irk_not_valid",
                    "IRK format not recognised by HA. Try plain hex (32 chars), "
                    "base64, or irk:-prefixed base64 from Apple Keychain.")
            else:
                detail = "; ".join(unique_errors) if unique_errors else "unknown"
                connection.send_error(msg["id"], "flow_failed",
                    f"Could not create Private BLE Device entry ({detail}). "
                    "Make sure the 'Private BLE Device' integration is available in HA "
                    "(Settings → Devices & Services → Add Integration → search 'Private BLE').")
    except Exception as err:
        _LOGGER.warning("private_ble_add_irk failed: %s", err, exc_info=True)
        connection.send_error(msg["id"], "add_failed",
            f"Failed to add IRK: {err}. Make sure 'Private BLE Device' integration is available in HA.")


@websocket_api.websocket_command({
    "type": "padspan_ha/private_ble_delete_irk",
    vol.Required("entry_id"): str,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_private_ble_delete_irk(hass: HomeAssistant, connection, msg) -> None:
    """Delete a Private BLE Device config entry by entry_id."""
    entry_id = str(msg.get("entry_id", "")).strip()
    if not entry_id:
        connection.send_error(msg["id"], "invalid_entry", "entry_id is required")
        return
    entry = hass.config_entries.async_get_entry(entry_id)
    if not entry or entry.domain != "private_ble_device":
        connection.send_error(msg["id"], "not_found", "Config entry not found")
        return
    try:
        await hass.config_entries.async_remove(entry_id)
        # Refresh resolver so status reflects the deletion
        try:
            resolver = await _get_ble_resolver(hass)
            await resolver.async_load()
        except Exception:
            pass
        connection.send_result(msg["id"], {"ok": True, "removed": entry.title or entry_id})
    except Exception as err:
        connection.send_error(msg["id"], "remove_failed", str(err))


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

@websocket_api.websocket_command({"type": "padspan_ha/companion_discover"})
@websocket_api.async_response
async def ws_companion_discover(hass: HomeAssistant, connection, msg) -> None:
    """Discover HA Companion App phones that have BLE Transmitter enabled.

    Returns a list of phones with their iBeacon UUID, visibility status,
    IRK availability, and whether they're already followed.  Disabled
    sensors are included so the UI can prompt the user to enable them.
    """
    try:
        from homeassistant.helpers import entity_registry as er

        ent_reg = er.async_get(hass)
        phones: list[dict[str, Any]] = []

        # Collect debug info about what mobile_app entities exist
        _debug_mobile_entities: list[str] = []
        _debug_ble_candidates: list[str] = []
        _debug_platforms: dict[str, int] = {}
        _debug_ble_any: list[str] = []  # BLE-related entities on ANY platform

        # Find all BLE transmitter sensor entities from mobile_app
        for entity in ent_reg.entities.values():
            # Track all platforms for debug
            _debug_platforms[entity.platform] = _debug_platforms.get(entity.platform, 0) + 1
            # Catch BLE-related entities on ANY platform
            _eid_lower = entity.entity_id.lower()
            if ("ble" in _eid_lower or "transmit" in _eid_lower or "beacon" in _eid_lower) and len(_debug_ble_any) < 20:
                _debug_ble_any.append(f"{entity.entity_id} (platform={entity.platform})")

            if entity.platform != "mobile_app":
                continue
            _debug_mobile_entities.append(entity.entity_id)
            eid = entity.entity_id
            if "ble_transmitter" not in eid:
                # Also check for BLE-related entities with different naming
                if "ble" in _eid_lower or "bluetooth" in _eid_lower or "transmit" in _eid_lower or "beacon" in _eid_lower:
                    _debug_ble_candidates.append(eid)
                continue

            # Read entity state — the state or attributes contain the transmitting UUID
            state_obj = hass.states.get(eid)
            is_disabled = entity.disabled_by is not None

            # Disabled entities have no state in HA.  Still show them in the
            # discovery list so the UI can prompt the user to enable them
            # (common on iOS where BLE Transmitter is disabled by default).
            if not state_obj and not is_disabled:
                continue

            attrs = (state_obj.attributes or {}) if state_obj else {}
            _LOGGER.debug(
                "companion_discover: %s state=%r disabled=%s attrs=%s",
                eid, state_obj.state if state_obj else "(no state)", is_disabled,
                {k: str(v)[:80] for k, v in attrs.items()},
            )

            # Companion App stores UUID, Major, Minor in separate attributes
            # or as a combined "transmitting_id" / "id" / the state itself.
            uuid_attr = ""
            major = 0
            minor = 0
            transmitting_id = ""

            # Try separate UUID / Major / Minor attributes first (most reliable)
            if attrs.get("UUID") or attrs.get("uuid"):
                uuid_attr = str(attrs.get("UUID") or attrs.get("uuid") or "")
                major = int(attrs.get("Major", attrs.get("major", 0)))
                minor = int(attrs.get("Minor", attrs.get("minor", 0)))
            else:
                # Fall back to combined transmitting_id / id attribute or state
                transmitting_id = (
                    attrs.get("transmitting_id")
                    or attrs.get("id")
                    or ""
                )
                # Also check if the state itself is a UUID-like string
                if not transmitting_id and state_obj and state_obj.state and len(state_obj.state) > 30:
                    transmitting_id = state_obj.state

                if transmitting_id:
                    # Parse UUID, Major, Minor from transmitting_id.
                    # Formats seen in the wild:
                    #   Dashes:      "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX-Major-Minor"
                    #   Underscores: "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX_Major_Minor"
                    # A standard UUID is exactly 36 chars (8-4-4-4-12).
                    # If the string is longer, the suffix holds Major/Minor.
                    import re as _re
                    _tid = transmitting_id.strip()
                    if len(_tid) > 36:
                        _uuid_part = _tid[:36]
                        _suffix = _tid[36:]  # e.g. "_100_40004" or "-100-40004"
                        _nums = _re.findall(r"\d+", _suffix)
                        if len(_nums) >= 2:
                            try:
                                major = int(_nums[0])
                                minor = int(_nums[1])
                                uuid_attr = _uuid_part
                            except (ValueError, IndexError):
                                uuid_attr = _tid
                        elif len(_nums) == 1:
                            try:
                                major = int(_nums[0])
                                uuid_attr = _uuid_part
                            except (ValueError, IndexError):
                                uuid_attr = _tid
                        else:
                            uuid_attr = _tid
                    else:
                        uuid_attr = _tid

            # Disabled entities (common on iOS) — show in list so user can enable
            if is_disabled:
                device_name = ""
                if entity.device_id:
                    from homeassistant.helpers import device_registry as dr
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(entity.device_id)
                    if device:
                        device_name = device.name or device.name_by_user or ""
                if not device_name:
                    device_name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()
                phones.append({
                    "entity_id": eid,
                    "device_name": device_name,
                    "uuid": "",
                    "major": 0,
                    "minor": 0,
                    "ibeacon_key": "",
                    "transmitting_id": "",
                    "is_transmitting": False,
                    "is_visible": False,
                    "is_followed": False,
                    "is_disabled": True,
                    "existing_label": "",
                    "state": "disabled",
                    "attributes": {},
                    "has_irk": False,
                    "irk_canonical": "",
                })
                continue

            if not uuid_attr:
                _LOGGER.debug("companion_discover: %s — no UUID found, skipping", eid)
                continue

            # Normalise UUID to lowercase with dashes
            uuid_clean = uuid_attr.lower().strip().replace(" ", "")
            if len(uuid_clean) == 32:
                uuid_clean = f"{uuid_clean[:8]}-{uuid_clean[8:12]}-{uuid_clean[12:16]}-{uuid_clean[16:20]}-{uuid_clean[20:]}"

            # Get device name from the parent device
            device_name = ""
            if entity.device_id:
                from homeassistant.helpers import device_registry as dr
                dev_reg = dr.async_get(hass)
                device = dev_reg.async_get(entity.device_id)
                if device:
                    device_name = device.name or device.name_by_user or ""

            if not device_name:
                device_name = eid.replace("sensor.", "").replace("_ble_transmitter", "").replace("_", " ").title()

            # Build the iBeacon key that PadspanHA would use
            ibeacon_key = f"ibeacon:{uuid_clean}:{major}:{minor}"

            # Check if this phone is already labelled/followed
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            existing_label = ""
            if obj_store:
                entry = obj_store.get(ibeacon_key)
                if entry:
                    existing_label = entry.get("label", "")

            settings = _get_settings(hass)
            followed = settings.get("followed_addrs") or []
            is_followed = ibeacon_key in followed or ibeacon_key.upper() in [f.upper() for f in followed]

            # Check if the phone is currently visible in BLE.
            # Method 1: iBeacon advertisement matches UUID:major:minor.
            # Method 2: Any RPA resolves via IRK to a device matching this phone.
            is_visible = False
            has_irk = False
            irk_canonical = ""
            _vis_scanner_count = 0
            _vis_rssi = None
            try:
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=600)
                _irk_resolver = await _get_ble_resolver(hass)
                from .private_ble_resolver import PrivateBLEResolver

                # First check: does the resolver have an IRK device matching
                # this phone's name?  This works even without any live ads.
                for _dev in _irk_resolver._devices:
                    _dev_name = (_dev.get("name") or "").lower()
                    if device_name.lower() in _dev_name or _dev_name in device_name.lower():
                        has_irk = True
                        irk_canonical = _dev["canonical_id"]
                        break

                # Scan all BLE advertisements for this phone
                _irk_match_cid = irk_canonical  # canonical_id to match for IRK visibility
                for ad in (ble_snap.get("advertisements") or []):
                    ad_addr = (ad.get("address") or "").upper()
                    mfr = ad.get("manufacturer_data") or {}
                    parsed = PrivateBLEResolver.parse_ibeacon(mfr)
                    # iBeacon match
                    if parsed and parsed["uuid"].lower() == uuid_clean and parsed["major"] == major and parsed["minor"] == minor:
                        is_visible = True
                        # Also check IRK on this specific ad
                        if not has_irk and _is_rpa_addr(ad_addr):
                            _irk_res = _irk_resolver.resolve_address(ad_addr)
                            if _irk_res and _irk_res.get("canonical_id"):
                                has_irk = True
                                irk_canonical = _irk_res["canonical_id"]
                                _irk_match_cid = irk_canonical
                        continue
                    # IRK-only match: RPA resolves to the same canonical_id
                    if _irk_match_cid and _is_rpa_addr(ad_addr):
                        _irk_res = _irk_resolver.resolve_address(ad_addr)
                        if _irk_res and _irk_res.get("canonical_id") == _irk_match_cid:
                            is_visible = True
                            _rssi = ad.get("rssi")
                            if _rssi is not None and (_vis_rssi is None or _rssi > _vis_rssi):
                                _vis_rssi = _rssi
                            _vis_scanner_count += 1
            except Exception:
                pass

            phones.append({
                "entity_id": eid,
                "device_name": device_name,
                "uuid": uuid_clean,
                "major": major,
                "minor": minor,
                "ibeacon_key": ibeacon_key,
                "transmitting_id": transmitting_id,
                "is_transmitting": state_obj.state not in ("unavailable", "unknown", "off", ""),
                "is_visible": is_visible,
                "is_followed": is_followed,
                "is_disabled": False,
                "existing_label": existing_label,
                "state": state_obj.state,
                "attributes": {k: str(v) for k, v in attrs.items()},
                "has_irk": has_irk,
                "irk_canonical": irk_canonical,
            })

        # ── Device-registry fallback ──────────────────────────────────────
        # On Android, disabled sensors are never registered in the entity
        # registry.  The device registry always has the phone though.
        # Find mobile_app devices that have NO BLE transmitter entity and
        # surface them so the UI can tell the user to enable the sensor.
        _debug_devices: list[dict] = []
        _phones_entity_ids = {p["entity_id"] for p in phones}
        try:
            from homeassistant.helpers import device_registry as dr
            dev_reg = dr.async_get(hass)
            for entry in hass.config_entries.async_entries("mobile_app"):
                for device in dr.async_entries_for_config_entry(dev_reg, entry.entry_id):
                    device_name = device.name or device.name_by_user or ""
                    _debug_devices.append({
                        "device_id": device.id,
                        "name": device_name,
                        "model": device.model or "",
                        "manufacturer": device.manufacturer or "",
                    })
                    # Check if we already found a BLE transmitter entity for this device
                    has_ble = False
                    for p in phones:
                        if p.get("device_name", "").lower() == device_name.lower():
                            has_ble = True
                            break
                    if has_ble:
                        continue
                    # No BLE transmitter entity — phone is registered but sensor
                    # is not enabled.  Show it so the UI can prompt the user.
                    # Check if phone has IRK by name match
                    _fb_has_irk = False
                    _fb_irk_cid = ""
                    try:
                        _fb_resolver = await _get_ble_resolver(hass)
                        for _fb_dev in _fb_resolver._devices:
                            _fb_n = (_fb_dev.get("name") or "").lower()
                            if device_name.lower() in _fb_n or _fb_n in device_name.lower():
                                _fb_has_irk = True
                                _fb_irk_cid = _fb_dev["canonical_id"]
                                break
                    except Exception:
                        pass
                    phones.append({
                        "entity_id": "",
                        "device_name": device_name,
                        "uuid": "",
                        "major": 0,
                        "minor": 0,
                        "ibeacon_key": "",
                        "transmitting_id": "",
                        "is_transmitting": False,
                        "is_visible": False,
                        "is_followed": False,
                        "is_disabled": False,
                        "existing_label": "",
                        "state": "sensor_not_registered",
                        "attributes": {},
                        "device_id": device.id,
                        "model": device.model or "",
                        "manufacturer": device.manufacturer or "",
                        "has_irk": _fb_has_irk,
                        "irk_canonical": _fb_irk_cid,
                    })
        except Exception as e:
            _LOGGER.debug("companion_discover device-registry scan: %s", e)

        # ── Notify-service discovery ──────────────────────────────────────
        # notify.mobile_app_<name> services are ALWAYS created when the
        # Companion App registers, even if all sensors are disabled and
        # no entities exist.  This is the most reliable indicator.
        _debug_notify_services: list[str] = []
        _phones_names_lc = {p.get("device_name", "").lower() for p in phones}
        try:
            all_services = hass.services.async_services()
            notify_svcs = all_services.get("notify", {})
            for svc_name in notify_svcs:
                if svc_name.startswith("mobile_app_"):
                    _debug_notify_services.append(svc_name)
                    # Derive a human-readable device name
                    dev_slug = svc_name[len("mobile_app_"):]
                    dev_name = dev_slug.replace("_", " ").title()
                    if dev_name.lower() in _phones_names_lc:
                        continue  # already found via entity/device registry
                    # Try to find matching device in device registry
                    _dev_model = ""
                    _dev_manufacturer = ""
                    _dev_id = ""
                    try:
                        from homeassistant.helpers import device_registry as dr
                        dev_reg = dr.async_get(hass)
                        for device in dev_reg.devices.values():
                            dn = (device.name or "").lower().replace(" ", "_")
                            if dn == dev_slug or (device.name_by_user or "").lower().replace(" ", "_") == dev_slug:
                                dev_name = device.name or device.name_by_user or dev_name
                                _dev_model = device.model or ""
                                _dev_manufacturer = device.manufacturer or ""
                                _dev_id = device.id
                                break
                    except Exception:
                        pass
                    phones.append({
                        "entity_id": "",
                        "device_name": dev_name,
                        "uuid": "",
                        "major": 0,
                        "minor": 0,
                        "ibeacon_key": "",
                        "transmitting_id": "",
                        "is_transmitting": False,
                        "is_visible": False,
                        "is_followed": False,
                        "is_disabled": False,
                        "existing_label": "",
                        "state": "sensor_not_registered",
                        "attributes": {},
                        "device_id": _dev_id,
                        "model": _dev_model,
                        "manufacturer": _dev_manufacturer,
                        "found_via": "notify_service",
                        "has_irk": False,
                        "irk_canonical": "",
                    })
                    _phones_names_lc.add(dev_name.lower())
        except Exception as e:
            _LOGGER.debug("companion_discover notify scan: %s", e)

        # ── Device-tracker entity discovery ───────────────────────────────
        # device_tracker.* entities from mobile_app always exist even when
        # all sensors are disabled.  They track the phone's GPS location.
        _debug_device_trackers: list[str] = []
        try:
            for entity in ent_reg.entities.values():
                if entity.platform != "mobile_app":
                    continue
                if not entity.entity_id.startswith("device_tracker."):
                    continue
                _debug_device_trackers.append(entity.entity_id)
                # Derive device name from the entity
                dev_name = ""
                if entity.device_id:
                    from homeassistant.helpers import device_registry as dr
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(entity.device_id)
                    if device:
                        dev_name = device.name or device.name_by_user or ""
                if not dev_name:
                    dev_name = entity.entity_id.replace("device_tracker.", "").replace("_", " ").title()
                if dev_name.lower() in _phones_names_lc:
                    continue  # already found
                phones.append({
                    "entity_id": entity.entity_id,
                    "device_name": dev_name,
                    "uuid": "",
                    "major": 0,
                    "minor": 0,
                    "ibeacon_key": "",
                    "transmitting_id": "",
                    "is_transmitting": False,
                    "is_visible": False,
                    "is_followed": False,
                    "is_disabled": entity.disabled_by is not None,
                    "existing_label": "",
                    "state": "sensor_not_registered",
                    "attributes": {},
                    "device_id": entity.device_id or "",
                    "model": "",
                    "manufacturer": "",
                    "found_via": "device_tracker",
                    "has_irk": False,
                    "irk_canonical": "",
                })
                _phones_names_lc.add(dev_name.lower())
        except Exception as e:
            _LOGGER.debug("companion_discover device-tracker scan: %s", e)

        # ── Webhook / hass.data discovery ─────────────────────────────────
        # The mobile_app integration stores webhook registrations in
        # hass.data["mobile_app"].  This exists even with zero entities.
        _debug_webhooks: list[dict] = []
        try:
            mobile_data = hass.data.get("mobile_app")
            if mobile_data and isinstance(mobile_data, dict):
                # mobile_app stores registrations keyed by webhook_id
                for wh_key, wh_val in mobile_data.items():
                    if isinstance(wh_val, dict):
                        wh_name = wh_val.get("device_name") or wh_val.get("name") or ""
                        _debug_webhooks.append({
                            "webhook_id": str(wh_key)[:12],
                            "device_name": wh_name,
                            "os_name": wh_val.get("os_name", ""),
                            "os_version": wh_val.get("os_version", ""),
                            "app_version": wh_val.get("app_version", ""),
                            "model": wh_val.get("model", ""),
                            "manufacturer": wh_val.get("manufacturer", ""),
                        })
                        if wh_name and wh_name.lower() not in _phones_names_lc:
                            phones.append({
                                "entity_id": "",
                                "device_name": wh_name,
                                "uuid": "",
                                "major": 0,
                                "minor": 0,
                                "ibeacon_key": "",
                                "transmitting_id": "",
                                "is_transmitting": False,
                                "is_visible": False,
                                "is_followed": False,
                                "is_disabled": False,
                                "existing_label": "",
                                "state": "sensor_not_registered",
                                "attributes": {},
                                "device_id": "",
                                "model": wh_val.get("model", ""),
                                "manufacturer": wh_val.get("manufacturer", ""),
                                "found_via": "webhook",
                                "has_irk": False,
                                "irk_canonical": "",
                            })
                            _phones_names_lc.add(wh_name.lower())
            # Also try the mobile_app "registrations" storage key
            mobile_reg = hass.data.get("mobile_app_registrations")
            if mobile_reg and isinstance(mobile_reg, dict):
                for rk, rv in mobile_reg.items():
                    if isinstance(rv, dict):
                        _debug_webhooks.append({
                            "reg_key": str(rk)[:12],
                            "device_name": rv.get("device_name", ""),
                            "os_name": rv.get("os_name", ""),
                        })
        except Exception as e:
            _LOGGER.debug("companion_discover webhook scan: %s", e)

        # Sort platforms by count descending, top 20
        _sorted_plats = dict(sorted(_debug_platforms.items(), key=lambda x: -x[1])[:20])

        # Check if mobile_app integration is actually loaded in HA
        _mobile_app_loaded = "mobile_app" in hass.config.components
        _mobile_app_entries = len(hass.config_entries.async_entries("mobile_app"))

        # ── Broad device search ───────────────────────────────────────────
        # If no phones found via mobile_app, look for phone-like devices
        # across ALL integrations (the phone might be registered differently).
        _debug_all_phone_devices: list[dict] = []
        _debug_all_config_entries: list[dict] = []
        if not phones:
            try:
                from homeassistant.helpers import device_registry as dr
                dev_reg = dr.async_get(hass)

                # Log all config entries so we can see what integrations exist
                for ce in hass.config_entries.async_entries():
                    _debug_all_config_entries.append({
                        "domain": ce.domain,
                        "title": ce.title,
                        "entry_id": ce.entry_id[:8],
                    })

                # Search ALL devices for phone-like entries
                _phone_hints = {"phone", "mobile", "android", "iphone", "pixel",
                                "samsung", "galaxy", "oneplus", "xiaomi", "huawei",
                                "companion", "app"}
                for device in dev_reg.devices.values():
                    name_lower = ((device.name or "") + " " + (device.name_by_user or "") +
                                  " " + (device.model or "") + " " + (device.manufacturer or "")).lower()
                    if any(h in name_lower for h in _phone_hints):
                        # Find which config entry this device belongs to
                        domains = []
                        for ce_id in (device.config_entries or set()):
                            ce = hass.config_entries.async_get_entry(ce_id)
                            if ce:
                                domains.append(ce.domain)
                        _debug_all_phone_devices.append({
                            "device_id": device.id,
                            "name": device.name or "",
                            "name_by_user": device.name_by_user or "",
                            "model": device.model or "",
                            "manufacturer": device.manufacturer or "",
                            "integrations": domains,
                            "identifiers": [list(i) for i in (device.identifiers or set())],
                        })
            except Exception as e:
                _LOGGER.debug("companion_discover broad device scan: %s", e)

        # ── iBeacon scan from live BLE ────────────────────────────────────
        # If still no phones, show any iBeacons visible in BLE as
        # potential companion app phones (user can identify theirs).
        _debug_live_ibeacons: list[dict] = []
        if not phones:
            try:
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=120)
                from .private_ble_resolver import PrivateBLEResolver
                for ad in (ble_snap.get("advertisements") or []):
                    mfr = ad.get("manufacturer_data") or {}
                    parsed = PrivateBLEResolver.parse_ibeacon(mfr)
                    if parsed:
                        ib_key = f"ibeacon:{parsed['uuid']}:{parsed['major']}:{parsed['minor']}"
                        _debug_live_ibeacons.append({
                            "address": ad.get("address", ""),
                            "rssi": ad.get("rssi"),
                            "uuid": parsed["uuid"],
                            "major": parsed["major"],
                            "minor": parsed["minor"],
                            "ibeacon_key": ib_key,
                            "name": ad.get("name", ""),
                        })
            except Exception as e:
                _LOGGER.debug("companion_discover iBeacon scan: %s", e)

        connection.send_result(msg["id"], {
            "phones": phones,
            "mobile_app_loaded": _mobile_app_loaded,
            "mobile_app_entries": _mobile_app_entries,
            "debug": {
                "mobile_app_entities": _debug_mobile_entities[:50],
                "ble_candidates": _debug_ble_candidates[:20],
                "total_entities": len(list(ent_reg.entities.values())),
                "platforms": _sorted_plats,
                "ble_any_platform": _debug_ble_any,
                "mobile_app_devices": _debug_devices,
                "notify_services": _debug_notify_services,
                "device_trackers": _debug_device_trackers,
                "webhooks": _debug_webhooks,
                "all_phone_devices": _debug_all_phone_devices[:20],
                "all_config_entries": _debug_all_config_entries,
                "live_ibeacons": _debug_live_ibeacons[:20],
            },
        })
    except Exception as err:
        _LOGGER.warning("companion_discover failed: %s", err)
        connection.send_result(msg["id"], {"phones": [], "error": str(err)})


@websocket_api.websocket_command({
    "type": "padspan_ha/companion_follow",
    vol.Required("ibeacon_key"): str,
    vol.Required("device_name"): str,
    vol.Optional("entity_id"): str,
})
@websocket_api.async_response
async def ws_companion_follow(hass: HomeAssistant, connection, msg) -> None:
    """One-click "Follow This Phone" action for Companion App phones.

    Performs four steps atomically:
      1. Labels the iBeacon object in ObjectStore (+ cross-stores under canonical_id)
      2. Adds the uppercase iBeacon key to followed_addrs in settings
      3. Enables the BLE Transmitter sensor in the entity registry (un-disables)
      4. Sends a command_ble_transmitter turn_on notification to the phone app

    Returns verification flags so the UI can confirm each step succeeded.
    """
    try:
        ibeacon_key = str(msg["ibeacon_key"])
        follow_key = ibeacon_key.upper()  # followed_addrs are always uppercase
        device_name = str(msg["device_name"]).strip()
        transmitter_eid = str(msg.get("entity_id") or "").strip()

        if not device_name:
            device_name = "Phone"

        results: list[str] = []
        labelled = False
        followed = False
        transmitter_enabled = False

        # 1) Label the object in ObjectStore (tagged)
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store:
            await obj_store.async_set(ibeacon_key, device_name)
            # Also label the uppercase variant so lookups always match
            await obj_store.async_set(follow_key, device_name)

            # If this phone also resolves via IRK (private_ble), store the label
            # under the canonical_id too — otherwise the private_ble object won't
            # find it (private_ble looks up by canonical_id, not ibeacon key).
            try:
                resolver = await _get_ble_resolver(hass)
                ble_live = get_bluetooth_live(hass)
                ble_snap = ble_live.get_snapshot(max_ads=2000, max_age_s=600)
                for ad in (ble_snap.get("advertisements") or []):
                    ib = resolver.parse_ibeacon(ad.get("manufacturer_data") or {})
                    if not ib:
                        continue
                    ad_ib_key = f"ibeacon:{ib['uuid']}:{ib['major']}:{ib['minor']}"
                    if ad_ib_key.upper() != follow_key:
                        continue
                    ad_addr = (ad.get("address") or "").upper()
                    resolved = resolver.resolve_address(ad_addr)
                    if resolved and resolved.get("canonical_id"):
                        cid = resolved["canonical_id"]
                        await obj_store.async_set(cid, device_name)
                        _LOGGER.info(
                            "companion_follow: also labelled canonical_id %s for %s",
                            cid, device_name,
                        )
                    break
            except Exception as _cid_err:
                _LOGGER.debug("companion_follow: canonical_id cross-label: %s", _cid_err)

            labelled = True
            results.append(f"Labelled as '{device_name}'")

        # 2) Add to followed_addrs in settings (always uppercase)
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            followed_list = list(st.data.get("followed_addrs") or [])
            existing_upper = {f.upper() for f in followed_list}
            if follow_key not in existing_upper:
                followed_list.append(follow_key)
                await st.async_set(followed_addrs=followed_list)
                followed = True
                results.append("Added to followed list")
            else:
                followed = True
                results.append("Already followed")

        # 3) Enable BLE Transmitter: entity registry + notify command to app.
        if transmitter_eid:
            # 3a) Enable in entity registry (un-disable if disabled)
            try:
                from homeassistant.helpers import entity_registry as er

                ent_reg = er.async_get(hass)
                ent_entry = ent_reg.async_get(transmitter_eid)
                if ent_entry and ent_entry.disabled_by is not None:
                    ent_reg.async_update_entity(
                        transmitter_eid, disabled_by=None
                    )
                    transmitter_enabled = True
                    results.append("BLE Transmitter entity enabled")
            except Exception as te:
                _LOGGER.debug("Entity registry enable for %s: %s", transmitter_eid, te)

            # 3b) Send notification command to Companion App to turn on the
            #     BLE transmitter sensor.  The Companion App (Android + iOS)
            #     supports command_ble_transmitter via the notify service.
            try:
                from homeassistant.helpers import entity_registry as er, device_registry as dr

                ent_reg = er.async_get(hass)
                ent_entry = ent_reg.async_get(transmitter_eid)
                if ent_entry and ent_entry.device_id:
                    dev_reg = dr.async_get(hass)
                    device = dev_reg.async_get(ent_entry.device_id)
                    if device:
                        # Find the notify service for this mobile_app device.
                        # Convention: notify.mobile_app_<device_name_slug>
                        notify_target = None
                        for ident in device.identifiers:
                            if ident[0] == "mobile_app":
                                notify_target = f"mobile_app_{ident[1]}"
                                break
                        if not notify_target:
                            # Fallback: derive from device name
                            dname = (device.name or "").lower().replace(" ", "_").replace("-", "_")
                            if dname:
                                notify_target = f"mobile_app_{dname}"
                        if notify_target:
                            await hass.services.async_call(
                                "notify",
                                notify_target,
                                {
                                    "message": "command_ble_transmitter",
                                    "data": {"command": "turn_on"},
                                },
                                blocking=True,
                            )
                            transmitter_enabled = True
                            results.append("BLE Transmitter command sent to phone")
                            _LOGGER.info(
                                "Sent command_ble_transmitter turn_on via notify.%s",
                                notify_target,
                            )
            except Exception as te:
                _LOGGER.warning(
                    "Failed to send BLE Transmitter command for %s: %s",
                    transmitter_eid,
                    te,
                )
                results.append(f"BLE command send failed: {te}")

        # 4) Verify: re-read to confirm persistence
        verify_label = ""
        verify_followed = False
        if obj_store:
            entry = obj_store.get(ibeacon_key) or obj_store.get(follow_key)
            verify_label = (entry or {}).get("label", "")
        if st:
            verify_followed = follow_key in {f.upper() for f in (st.data.get("followed_addrs") or [])}

        connection.send_result(msg["id"], {
            "ok": True,
            "ibeacon_key": ibeacon_key,
            "follow_key": follow_key,
            "device_name": device_name,
            "labelled": labelled,
            "followed": followed,
            "transmitter_enabled": transmitter_enabled,
            "verified_label": verify_label,
            "verified_followed": verify_followed,
            "actions": results,
        })
    except Exception as err:
        _LOGGER.warning("companion_follow failed: %s", err)
        connection.send_error(msg["id"], "follow_failed", str(err))


@websocket_api.websocket_command({
    "type": "padspan_ha/companion_unfollow",
    vol.Required("ibeacon_key"): str,
})
@websocket_api.async_response
async def ws_companion_unfollow(hass: HomeAssistant, connection, msg) -> None:
    """Remove a Companion App phone from followed list and delete its label."""
    try:
        ibeacon_key = str(msg["ibeacon_key"])
        follow_key = ibeacon_key.upper()
        results: list[str] = []

        # 1) Remove label from ObjectStore
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if obj_store:
            await obj_store.async_delete(ibeacon_key)
            await obj_store.async_delete(follow_key)
            results.append("Label removed")

        # 2) Remove from followed_addrs
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            followed_list = list(st.data.get("followed_addrs") or [])
            new_list = [f for f in followed_list if f.upper() != follow_key]
            if len(new_list) < len(followed_list):
                await st.async_set(followed_addrs=new_list)
                results.append("Removed from followed list")

        # 3) Clear coordinator state so object doesn't linger as stale
        try:
            _coord_uf = hass.data.get(DOMAIN, {}).get(DATA_COORDINATOR)
            if _coord_uf:
                _coord_uf.clear_object_state(ibeacon_key)
        except Exception:
            pass

        connection.send_result(msg["id"], {
            "ok": True,
            "ibeacon_key": ibeacon_key,
            "actions": results,
        })
    except Exception as err:
        _LOGGER.warning("companion_unfollow failed: %s", err)
        connection.send_error(msg["id"], "unfollow_failed", str(err))


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
    try:
        st = _St(hass, 1, SETTINGS_STORE_KEY)
        await st.async_save(dict(DEFAULT_SETTINGS))
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

    connection.send_result(msg["id"], {
        "ok": len(errors) == 0,
        "cleared": cleared,
        "total": 11,
        "errors": errors,
    })


# ══════════════════════════════════════════════════════════════════════════════
# Phase 1 — Positioning Fabric WS handlers
# ══════════════════════════════════════════════════════════════════════════════


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_set",
        "source": str,
        "room": str,
        vol.Optional("floor_id"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a scanner to a room in the positioning fabric."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    source = (msg.get("source") or "").strip()
    room = (msg.get("room") or "").strip()
    if not source or not room:
        connection.send_error(msg["id"], "invalid", "source and room are required")
        return
    floor_id = (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID
    await mdl.async_set_scanner(source, room, floor_id, source_type="manual")
    connection.send_result(msg["id"], {"ok": True, "source": source, "room": room, "floor_id": floor_id})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_remove",
        "source": str,
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove a scanner from the positioning fabric."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    source = (msg.get("source") or "").strip()
    if not source:
        connection.send_error(msg["id"], "invalid", "source is required")
        return
    await mdl.async_remove_scanner(source)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_room_add",
        "room": str,
        vol.Optional("floor_id"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_room_add(hass: HomeAssistant, connection, msg) -> None:
    """Add a PadSpan-native room (no HA area needed)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    if not room:
        connection.send_error(msg["id"], "invalid", "room is required")
        return
    floor_id = (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID
    await mdl.async_ensure_rooms([room])
    # Update floor_id if provided
    rm = mdl.data.get("room_meta", {})
    if room in rm:
        rm[room]["floor_id"] = floor_id
        await mdl.store.async_save(mdl.data)
    # Also init adjacency entry if not present
    adj = mdl.data.setdefault("room_adjacency", {})
    if room not in adj:
        adj[room] = []
        await mdl.store.async_save(mdl.data)
    connection.send_result(msg["id"], {"ok": True, "room": room, "floor_id": floor_id})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_room_remove",
        "room": str,
    }
)
@websocket_api.async_response
async def ws_fabric_room_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove a room from the fabric (room_meta + adjacency + scanner assignments)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    if not room:
        connection.send_error(msg["id"], "invalid", "room is required")
        return
    # Remove from room_meta
    rm = mdl.data.get("room_meta", {})
    rm.pop(room, None)
    # Remove from adjacency
    await mdl.async_remove_adjacency(room)
    # Remove scanners assigned to this room
    scanners = mdl.data.get("scanners", {})
    to_remove = [s for s, info in scanners.items() if info.get("room") == room]
    for s in to_remove:
        scanners.pop(s, None)
    await mdl.store.async_save(mdl.data)
    connection.send_result(msg["id"], {"ok": True, "removed": room})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_adjacency_set",
        "room": str,
        "neighbors": [str],
    }
)
@websocket_api.async_response
async def ws_fabric_adjacency_set(hass: HomeAssistant, connection, msg) -> None:
    """Set room neighbors in the positioning fabric."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    neighbors = msg.get("neighbors") or []
    if not room:
        connection.send_error(msg["id"], "invalid", "room is required")
        return
    await mdl.async_set_adjacency(room, [str(n).strip() for n in neighbors if str(n).strip()])
    connection.send_result(msg["id"], {"ok": True, "room": room, "neighbors": mdl.adjacency().get(room, [])})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_sync_mode_set",
        "mode": str,
    }
)
@websocket_api.async_response
async def ws_fabric_sync_mode_set(hass: HomeAssistant, connection, msg) -> None:
    """Switch fabric sync mode: 'auto' (sync from HA) or 'manual' (standalone)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    mode = (msg.get("mode") or "").strip().lower()
    if mode not in ("auto", "manual"):
        connection.send_error(msg["id"], "invalid", "mode must be 'auto' or 'manual'")
        return
    await mdl.async_set_sync_mode(mode)
    # If switching to auto, trigger immediate HA sync
    if mode == "auto":
        try:
            await mdl.async_sync_from_ha()
        except Exception:
            pass
    connection.send_result(msg["id"], {"ok": True, "mode": mode})


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Real-world spatial model WS handlers
# ══════════════════════════════════════════════════════════════════════════════


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_position_set",
        "source": str,
        "x_m": float,
        "y_m": float,
        vol.Optional("z_m"): float,
        vol.Optional("floor_id"): str,
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_position_set(hass: HomeAssistant, connection, msg) -> None:
    """Set a scanner's real-world position in metres."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    source = (msg.get("source") or "").strip()
    if not source:
        connection.send_error(msg["id"], "invalid", "source is required")
        return
    await mdl.async_set_scanner_position_m(
        source, float(msg["x_m"]), float(msg["y_m"]),
        float(msg.get("z_m", 2.4)),
        (msg.get("floor_id") or "").strip() or DEFAULT_FLOOR_ID,
        origin="manual",
    )
    connection.send_result(msg["id"], {"ok": True, "source": source})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_scanner_z_set",
        "source": str,
        "z_m": vol.Coerce(float),
    }
)
@websocket_api.async_response
async def ws_fabric_scanner_z_set(hass: HomeAssistant, connection, msg) -> None:
    """Set only a scanner's mounting height (z stays through map syncs)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    ok = await mdl.async_set_scanner_z_m((msg.get("source") or "").strip(), float(msg["z_m"]))
    if not ok:
        connection.send_error(msg["id"], "not_found", "Scanner has no fabric position yet")
        return
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_floor_elevations_set",
        "floors": list,  # [{id, level?, floor_to_floor_m?, base_elevation_m?}]
    }
)
@websocket_api.async_response
async def ws_fabric_floor_elevations_set(hass: HomeAssistant, connection, msg) -> None:
    """Upsert per-floor elevation data (floor-to-floor height / base elevation).

    Merge-only: unlisted floors are untouched; ids unknown to the ModelStore
    (HA-registry floor ids appear here the first time elevation data is
    written for them) are created.  Null clears a field.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    floors = await mdl.async_set_floor_elevations(msg.get("floors") or [])
    connection.send_result(msg["id"], {
        "floors": floors,
        "floor_elevations": mdl.floor_base_elevations_m(),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_correct_room",
        "floor_id": str,
        "room": str,
        "geometry": dict,
    }
)
@websocket_api.async_response
async def ws_fabric_correct_room(hass: HomeAssistant, connection, msg) -> None:
    """Directly correct one room's real-world shape in the FabricStore.

    Always allowed — a committed floor blocks bulk re-commits, never
    corrections. This is the room editor's save path.
    """
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    if not fab:
        connection.send_error(msg["id"], "no_fabric", "FabricStore not loaded")
        return
    room = (msg.get("room") or "").strip()
    geo = msg.get("geometry")
    if not room or not isinstance(geo, dict):
        connection.send_error(msg["id"], "invalid", "room and geometry dict are required")
        return
    res = await fab.async_correct_room(msg.get("floor_id") or DEFAULT_FLOOR_ID, room, geo)
    if not res.get("ok"):
        connection.send_error(msg["id"], res.get("error", "failed"), str(res))
        return
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_commit_floor",
        "floor_id": str,
        vol.Optional("mode"): vol.In(["bootstrap", "overwrite"]),
        vol.Optional("source"): vol.In(["transforms", "stack"]),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_commit_floor(hass: HomeAssistant, connection, msg) -> None:
    """One-time bootstrap of a floor's fabric from its maps' room bounds.

    The single moment map state ever reaches room geometry. `source` selects
    the form of truth ("transforms" = per-map calibration, "stack" = the
    hand-tuned alignment anchored by a measured map). Refuses on a floor
    that already has rooms (or is committed) unless mode="overwrite", which
    the UI only sends after an explicit confirmation.
    """
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not fab or not mdl or not ms:
        connection.send_error(msg["id"], "no_stores", "Fabric/Model/Maps store not loaded")
        return
    res = await fab.async_commit_floor(
        msg.get("floor_id") or DEFAULT_FLOOR_ID, ms, mdl,
        mode=msg.get("mode") or "bootstrap",
        source=msg.get("source") or "transforms",
    )
    if not res.get("ok"):
        connection.send_error(msg["id"], res.get("error", "failed"), str(res))
        return
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_truth_candidates",
        "floor_id": str,
    }
)
@websocket_api.async_response
async def ws_fabric_truth_candidates(hass: HomeAssistant, connection, msg) -> None:
    """Read-only preview of every form of truth a floor's layout can come
    from, so the user can compare and pick the most accurate one BEFORE
    anything is committed to the base fabric.

    Returns {fabric, transforms, stack} — each {rooms, stats} (stack is null
    with a reason when no measured map anchors the frame) — plus a per-map
    alignment comparison (system placement vs stack placement).
    """
    from . import fabric_truth

    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not fab or not mdl or not ms:
        connection.send_error(msg["id"], "no_stores", "Fabric/Model/Maps store not loaded")
        return
    fl = str(msg.get("floor_id") or DEFAULT_FLOOR_ID)
    all_maps = ms.data.get("maps") or []
    floor_maps = [m for m in all_maps if str(m.get("floor_id", DEFAULT_FLOOR_ID)) == fl]

    fabric_rooms = {r: g for r, g in fab.rooms_flat().items() if str(g.get("floor_id")) == fl}
    transforms_rooms = fabric_truth.rooms_from_transforms(floor_maps, mdl)

    anchor = fabric_truth.find_metre_anchor(all_maps, mdl)
    stack_rooms = fabric_truth.rooms_from_stack(floor_maps, anchor) if anchor else None

    # Per-map alignment: where the system thinks the map sits vs where the
    # hand-tuned stack puts it — surfaced so a wrong system placement can be
    # FIXED (fabric_map_align_to_stack) rather than thrown away.
    alignment = []
    for m in floor_maps:
        mid = m.get("id", "")
        t = mdl.map_transform(mid) or {}
        stack_t = fabric_truth.stack_metre_transform(m, anchor) if anchor else None
        entry = {
            "map_id": mid,
            "name": m.get("name", mid),
            "system": {
                "origin_x_m": t.get("origin_x_m"), "origin_y_m": t.get("origin_y_m"),
                "scale_x_m": t.get("scale_x_m"), "scale_y_m": t.get("scale_y_m"),
                "rotation_rad": t.get("rotation_rad", 0),
                "measured": bool(t.get("reference_measurements")),
            } if t else None,
            "stack": stack_t,
        }
        if t and stack_t:
            try:
                entry["agrees"] = (
                    abs(float(t.get("origin_x_m", 0)) - stack_t["origin_x_m"]) <= 0.2
                    and abs(float(t.get("origin_y_m", 0)) - stack_t["origin_y_m"]) <= 0.2
                    and abs(float(t.get("scale_x_m", 0)) - stack_t["scale_x_m"]) <= max(0.2, 0.02 * stack_t["scale_x_m"])
                    and abs(float(t.get("scale_y_m", 0)) - stack_t["scale_y_m"]) <= max(0.2, 0.02 * stack_t["scale_y_m"])
                )
            except (TypeError, ValueError):
                entry["agrees"] = False
        alignment.append(entry)

    connection.send_result(msg["id"], {
        "floor_id": fl,
        "fabric": {"rooms": fabric_rooms, "stats": fabric_truth.rooms_stats(fabric_rooms)},
        "transforms": {"rooms": transforms_rooms, "stats": fabric_truth.rooms_stats(transforms_rooms)},
        "stack": (
            {"rooms": stack_rooms, "stats": fabric_truth.rooms_stats(stack_rooms), "anchor": anchor}
            if stack_rooms is not None else None
        ),
        "stack_unavailable_reason": None if anchor else "no map anywhere in the stack has a reference-measured scale",
        "alignment": alignment,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_map_align_to_stack",
        "map_id": str,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_map_align_to_stack(hass: HomeAssistant, connection, msg) -> None:
    """Repair a map's system placement (map_transforms) to match the
    hand-tuned stack alignment, instead of discarding it.

    Writes the stack-implied metre transform via the sanctioned re-anchor
    path, then re-derives this map's scanner/beacon/barrier metre positions
    from their photo-space fracs through the corrected transform. Room
    geometry is untouchable by design (fabric writers only). Calibration
    point metres are NOT touched here (their own remediation is a retrain —
    the known follow-up).
    """
    from . import fabric_truth

    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not mdl or not ms:
        connection.send_error(msg["id"], "no_stores", "Model/Maps store not loaded")
        return
    mid = (msg.get("map_id") or "").strip()
    m = ms.get_map(mid)
    if not m:
        connection.send_error(msg["id"], "not_found", f"Map {mid} not found")
        return
    anchor = fabric_truth.find_metre_anchor(ms.data.get("maps") or [], mdl)
    if not anchor:
        connection.send_error(msg["id"], "no_metre_anchor",
                              "No map anywhere in the stack has a reference-measured scale")
        return
    stack_t = fabric_truth.stack_metre_transform(m, anchor)
    if not stack_t:
        connection.send_error(msg["id"], "no_stack_transform", "Map has no usable stack placement")
        return
    if stack_t["shear_rad"] > 0.02:
        connection.send_error(msg["id"], "sheared_stack",
                              f"Stack placement is sheared ({stack_t['shear_rad']:.3f} rad) — "
                              "the origin/scale/rotation model can't represent it losslessly")
        return

    new_t = {
        "origin_x_m": stack_t["origin_x_m"],
        "origin_y_m": stack_t["origin_y_m"],
        "scale_x_m": stack_t["scale_x_m"],
        "scale_y_m": stack_t["scale_y_m"],
        "rotation_rad": stack_t["rotation_rad"],
        "floor_id": str(m.get("floor_id", DEFAULT_FLOOR_ID)),
    }
    old_t = mdl.map_transform(mid) or {}
    if old_t.get("reference_measurements"):
        new_t["reference_measurements"] = old_t["reference_measurements"]
    await mdl.async_set_map_transform(mid, new_t, reanchor=True)

    # Re-derive this map's spatial data (scanners/barriers/beacons) from its
    # photo-space fracs through the corrected placement.
    resynced = await mdl.async_sync_spatial_from_map(mid, m)

    connection.send_result(msg["id"], {
        "ok": True, "map_id": mid,
        "transform": {k: new_t[k] for k in ("origin_x_m", "origin_y_m", "scale_x_m", "scale_y_m", "rotation_rad")},
        "spatial_resynced": resynced,
        "calibration_touched": False,
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_floor_finalize",
        "floor_id": str,
        "committed": bool,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_floor_finalize(hass: HomeAssistant, connection, msg) -> None:
    """Finalize (lock) or unlock a floor's fabric. Flips only the flag."""
    fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
    if not fab:
        connection.send_error(msg["id"], "no_fabric", "FabricStore not loaded")
        return
    res = await fab.async_set_floor_committed(
        msg.get("floor_id") or DEFAULT_FLOOR_ID, bool(msg.get("committed"))
    )
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_rf_barrier_set",
        "barrier": dict,
    }
)
@websocket_api.async_response
async def ws_fabric_rf_barrier_set(hass: HomeAssistant, connection, msg) -> None:
    """Add or update an RF barrier in real-world metres (matched by name)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    barrier = msg.get("barrier")
    if not isinstance(barrier, dict) or not barrier.get("name"):
        connection.send_error(msg["id"], "invalid", "barrier dict with name is required")
        return
    barrier.setdefault("origin", "manual")
    barrier.setdefault("floor_id", DEFAULT_FLOOR_ID)
    await mdl.async_set_rf_barrier_m(barrier)
    connection.send_result(msg["id"], {"ok": True, "name": barrier["name"]})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_rf_barrier_remove",
        "name": str,
    }
)
@websocket_api.async_response
async def ws_fabric_rf_barrier_remove(hass: HomeAssistant, connection, msg) -> None:
    """Remove an RF barrier by name."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    name = (msg.get("name") or "").strip()
    if not name:
        connection.send_error(msg["id"], "invalid", "name is required")
        return
    await mdl.async_remove_rf_barrier_m(name)
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_map_transform_set",
        "map_id": str,
        "transform": dict,
    }
)
@websocket_api.async_response
async def ws_fabric_map_transform_set(hass: HomeAssistant, connection, msg) -> None:
    """Set the affine transform for a map (frac ↔ metres)."""
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    map_id = (msg.get("map_id") or "").strip()
    transform = msg.get("transform")
    if not map_id or not isinstance(transform, dict):
        connection.send_error(msg["id"], "invalid", "map_id and transform dict are required")
        return
    transform.setdefault("floor_id", DEFAULT_FLOOR_ID)
    await mdl.async_set_map_transform(map_id, transform)
    # Remap calibration points using the new transform
    try:
        _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if _cal:
            await _cal.async_remap_from_metres(map_id)
    except Exception:
        pass
    _stored = (mdl.data.get("map_transforms") or {}).get(map_id, {})
    connection.send_result(msg["id"], {
        "ok": True, "map_id": map_id,
        "scale_x_m": _stored.get("scale_x_m"),
        "scale_y_m": _stored.get("scale_y_m"),
        "refs": len(_stored.get("reference_measurements", [])),
    })


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_map_reanchor",
        "map_id": str,
        vol.Optional("origin_x_m"): vol.Coerce(float),
        vol.Optional("origin_y_m"): vol.Coerce(float),
        vol.Optional("rotation_rad"): vol.Coerce(float),
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_map_reanchor(hass: HomeAssistant, connection, msg) -> None:
    """Explicitly redefine a map's world pose (origin + rotation).

    Metres are the truth: the map's fracs re-derive through the new pose.
    Refuses (writing nothing) when the pose would strand the calibration
    pins off the map.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    if not ms:
        connection.send_error(msg["id"], "no_maps", "Maps store not initialized")
        return
    map_id = (msg.get("map_id") or "").strip()
    m = ms.get_map(map_id)
    if not m:
        connection.send_error(msg["id"], "not_found", "Map not found")
        return
    _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    res = await mdl.async_reanchor_map(
        map_id, m, _cal,
        origin_x_m=msg.get("origin_x_m"),
        origin_y_m=msg.get("origin_y_m"),
        rotation_rad=msg.get("rotation_rad"),
    )
    if not res.get("ok"):
        _err = res.get("error", "reanchor_failed")
        _detail = "Re-anchor refused"
        if _err == "points_out_of_range":
            _detail = (
                f"Re-anchor refused: {res.get('out_of_range', 0)}/{res.get('owned', 0)} "
                "calibration pins would land off the map under this pose; nothing was changed"
            )
        elif _err == "not_measured":
            _detail = "Map has no measured transform to re-anchor"
        elif _err == "invalid_pose":
            _detail = "Origin/rotation must be finite numbers"
        connection.send_error(msg["id"], _err, _detail)
        return
    if res.get("map_items_rederived"):
        await ms.store.async_save(ms.data)
    connection.send_result(msg["id"], res)


@websocket_api.websocket_command({
    "type": "padspan_ha/fabric_migrate_from_maps",
    vol.Optional("default_floor_width_m"): vol.Coerce(float),
})
@websocket_api.async_response
async def ws_fabric_migrate_from_maps(hass: HomeAssistant, connection, msg) -> None:
    """Trigger migration from map data to real-world model.

    Optional default_floor_width_m: if maps lack px_per_meter calibration,
    use this as the x-axis width in metres to derive transforms.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    if not ms:
        connection.send_error(msg["id"], "no_maps", "MapsStore not loaded")
        return
    _default_w = float(msg.get("default_floor_width_m") or 0)
    n_transforms = await mdl.async_derive_transforms(ms, default_floor_width_m=_default_w)
    stats = await mdl.async_migrate_from_maps(ms)
    # Phase 3: backfill calibration points with metres after transforms are computed
    cal_backfilled = 0
    try:
        _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if _cal:
            if not _cal._model:
                _cal.set_model_store(mdl)
            cal_backfilled = await _cal.async_backfill_metres()
    except Exception:
        pass
    connection.send_result(msg["id"], {
        "ok": True,
        "transforms_computed": n_transforms,
        "cal_points_backfilled": cal_backfilled,
        **stats,
    })


# ══════════════════════════════════════════════════════════════════════════════
# Fabric Authority — batch spatial save
# ══════════════════════════════════════════════════════════════════════════════


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/fabric_spatial_batch_save",
        vol.Optional("map_id"): str,
        vol.Optional("floor_id"): str,
        vol.Optional("scanners"): list,
        vol.Optional("rooms"): dict,
        vol.Optional("rf_barriers"): list,
        vol.Optional("beacons"): list,
    }
)
@websocket_api.async_response
async def ws_fabric_spatial_batch_save(hass: HomeAssistant, connection, msg) -> None:
    """Save spatial data to fabric. Accepts map fracs, converts to metres.

    A "rooms" payload is still accepted for schema compat but ignored: room
    geometry lives in the FabricStore, and no map-fraction save may reach it.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    map_id = (msg.get("map_id") or "").strip()
    floor_id = (msg.get("floor_id") or "").strip()
    if not floor_id:
        ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        if ms and map_id:
            m = ms.get_map(map_id)
            if m:
                floor_id = m.get("floor_id", DEFAULT_FLOOR_ID)
        if not floor_id:
            floor_id = DEFAULT_FLOOR_ID
    stats = await mdl.async_batch_save_spatial(
        map_id, floor_id,
        scanners=msg.get("scanners"),
        rf_barriers=msg.get("rf_barriers"), beacons=msg.get("beacons"),
    )
    # Re-derive map fracs for rendering
    try:
        ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        if ms and map_id:
            _m = ms.get_map(map_id)
            if _m:
                await mdl.async_rederive_map_fracs(map_id, _m)
                await ms.store.async_save(ms.data)
    except Exception:
        pass
    # Calibration remap
    try:
        _cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
        if _cal and map_id:
            await _cal.async_remap_from_metres(map_id)
    except Exception:
        pass
    connection.send_result(msg["id"], {"ok": True, **stats})


# ══════════════════════════════════════════════════════════════════════════════
# Occupancy Estimation (experimental)
# ══════════════════════════════════════════════════════════════════════════════


async def compute_occupancy_estimate(hass: HomeAssistant) -> dict:
    """Compute building and per-room occupancy from live BLE data.

    Hybrid approach: identified devices count 1:1, unidentified BLE
    with sufficient dwell time count with a configurable multiplier.
    Auto-excludes iBeacons, infrastructure, and known IoT devices.

    Returns the occupancy result dict.  Called by both the WS handler
    and the occupancy sensor coordinator.
    """
    from .bluetooth_live import get_bluetooth_live

    # Settings
    _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    _sd = (_st.data if _st else {}) or {}
    multiplier = float(_sd.get("occupancy_multiplier", 1.5))
    dwell_min = float(_sd.get("occupancy_dwell_min", 5.0))  # minutes
    dwell_s = dwell_min * 60

    # Training history
    training = _sd.get("occupancy_training") or []

    # Adjusted multiplier from training (EMA of observed ratios)
    if training:
        # Use last 20 observations, EMA with alpha=0.3
        recent = training[-20:]
        ema = multiplier
        for obs in recent:
            if obs.get("computed_multiplier"):
                ema = ema * 0.7 + float(obs["computed_multiplier"]) * 0.3
        multiplier = round(max(0.5, min(5.0, ema)), 2)

    # Known IoT OUI prefixes (first 3 bytes of MAC) — common BLE IoT manufacturers
    _IOT_OUIS = {
        "AC:67:B2", "24:6F:28", "30:AE:A4", "A4:CF:12",  # Espressif
        "E8:DB:84", "CC:50:E3",  # Espressif variants
        "F4:12:FA", "D4:F9:8D",  # Nordic Semi
        "DC:A6:32", "B8:27:EB",  # Raspberry Pi
        "A4:C1:38",  # Tuya/Zigbee
    }

    # Get live snapshot
    bl = get_bluetooth_live(hass)
    if not bl:
        return {
            "total_estimate": 0, "confidence": "low", "rooms": [],
            "identified": 0, "unidentified": 0, "excluded": 0, "multiplier": multiplier,
        }

    snap = bl.get_snapshot(max_ads=10000, max_age_s=600)
    ads = snap.get("advertisements") or []
    radios = snap.get("radios") or []

    # Build radio source→room mapping from fabric
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    source_to_room: dict[str, str] = {}
    source_to_floor: dict[str, str] = {}
    if mdl:
        source_to_room, source_to_floor = mdl.get_scanner_mappings()

    # Get presence coordinator data for enriched objects
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    pc_data = (pc.data or {}) if pc else {}

    # Phase 1: Collect unique devices with room assignments
    import time as _time
    now_wall = _time.time()
    # First-seen lookup for dwell computation — the 7-day object history
    # cache (same keys as the coordinator data) tracks _first_seen per object.
    _hist_cache: dict = hass.data.get(DOMAIN, {}).get(DATA_OBJECT_HISTORY) or {}
    devices: dict[str, dict] = {}  # addr → {room, floor, kind, label, first_seen_s, is_identified, rssi_var}

    # ── Phone detection helper ─────────────────────────────────────────
    # Random MAC = locally-administered bit set (bit 1 of first octet).
    # All modern phones (iOS 8+, Android 6+) use random MACs for BLE.
    # IoT devices almost always use static (public) MACs.
    def _is_random_mac(addr: str) -> bool:
        try:
            return bool(int(addr.replace(":", "")[:2], 16) & 0x02)
        except (ValueError, IndexError):
            return False

    _INSIDE_RSSI = -75.0  # dBm — weaker = likely outside building
    _MIN_SCANNERS = 2     # must be heard by >=2 scanners (not wall bleed)

    # From enriched objects (presence coordinator)
    # Classification per Cisco/Aruba approach:
    #   - Labelled devices: always count (user tagged = known person)
    #   - Private BLE (IRK phones): always count (resolved identity)
    #   - Entity trackers: always count (HA person/device_tracker)
    #   - Random MAC BLE with strong RSSI + multi-scanner: phone inside building
    #   - Static MAC BLE / weak RSSI / single scanner: exclude (IoT or outside)
    #   - iBeacons: exclude (infrastructure)
    for key, obj in pc_data.items():
        if not isinstance(obj, dict) or key.startswith("__"):
            continue
        room = obj.get("room") or ""
        kind = obj.get("kind") or ""
        addr = obj.get("address") or key
        age_s = obj.get("age_s")
        if age_s is not None and float(age_s) > 600:
            continue  # too stale

        has_label = bool(obj.get("user_label"))
        is_entity = kind == "entity"
        is_phone = kind == "private_ble"

        # Skip iBeacons (infrastructure) unless labelled
        if kind == "ibeacon" and not has_label:
            continue

        # For unlabelled BLE devices: classify as phone or noise
        addr_upper = str(addr).upper()
        if kind == "ble" and not has_label:
            # Must have random MAC (phones do, IoT doesn't)
            if not _is_random_mac(addr_upper):
                continue
            # IoT OUI check
            if any(addr_upper.startswith(oui) for oui in _IOT_OUIS):
                continue
            # Must be heard strongly (inside building, not neighbour)
            source_rssi = obj.get("_source_rssi") or {}
            if not source_rssi:
                continue
            best_rssi = max(source_rssi.values())
            if best_rssi < _INSIDE_RSSI:
                continue  # too weak — likely outside
            # Must be heard by multiple scanners (not single-wall bleed)
            if len(source_rssi) < _MIN_SCANNERS:
                continue

        is_identified = has_label or is_entity or is_phone

        # IoT OUI check for non-BLE kinds
        is_iot = any(addr_upper.startswith(oui) for oui in _IOT_OUIS)
        if is_iot and not has_label:
            continue

        # Dwell = time since FIRST seen, not age_s (time since last
        # advertisement).  Using age_s inverted the filter: actively-
        # advertising phones (age≈0) were excluded as "dwell too short"
        # while only long-silent devices were counted.
        _fs = None
        _hist_ent = _hist_cache.get(key)
        if isinstance(_hist_ent, dict):
            _fs = _hist_ent.get("_first_seen")
        if not isinstance(_fs, (int, float)):
            _fs_iso = obj.get("first_seen")
            if _fs_iso:
                try:
                    from datetime import datetime as _dt
                    _fs = _dt.fromisoformat(str(_fs_iso)).timestamp()
                except Exception:
                    _fs = None
        _dev_dwell = max(0.0, now_wall - float(_fs)) if isinstance(_fs, (int, float)) else 0.0

        devices[addr_upper] = {
            "room": room, "floor": source_to_floor.get(room, ""),
            "kind": kind, "label": obj.get("user_label") or obj.get("name") or "",
            "is_identified": is_identified,
            "dwell_s": _dev_dwell,
            "excluded": False,
        }

    # Phase 2: Raw BLE advertisements NOT counted.
    # Only devices tracked by the presence coordinator (with confirmed
    # rooms from the spatial/vote pipeline) are reliable enough for
    # occupancy.  Raw ads include hundreds of transient neighbor devices
    # that pass RSSI/scanner filters but aren't in the building.

    # Phase 3: Apply dwell filter + infrastructure detection
    excluded_count = 0
    for addr, dev in devices.items():
        # Dwell too short
        if dev["dwell_s"] < dwell_s and not dev["is_identified"]:
            dev["excluded"] = True
            excluded_count += 1
            continue
        # Infrastructure: >24hr dwell, likely always-on device
        if dev["dwell_s"] > 86400 and not dev["is_identified"]:
            dev["excluded"] = True
            excluded_count += 1

    # Phase 3b: RSSI co-location clustering
    # Devices carried by the same person share nearly identical RSSI fingerprints
    # across all scanners (they're physically together).  Group unidentified devices
    # in the same room into clusters using pairwise RSSI-vector distance.
    # Each cluster ≈ one person, so we count clusters instead of raw devices.

    # Build RSSI fingerprint per device: {addr → {source → best_rssi}}
    _dev_fp: dict[str, dict[str, float]] = {}
    for ad in ads:
        addr = str(ad.get("address") or "").upper()
        if addr not in devices or devices[addr]["excluded"]:
            continue
        src = str(ad.get("source") or "")
        rssi = ad.get("rssi")
        if not src or rssi is None:
            continue
        rssi_f = float(rssi)
        if addr not in _dev_fp:
            _dev_fp[addr] = {}
        # Keep strongest RSSI per scanner
        if src not in _dev_fp[addr] or rssi_f > _dev_fp[addr][src]:
            _dev_fp[addr][src] = rssi_f

    # Also add fingerprints from identified objects (presence coordinator data)
    for key, obj in pc_data.items():
        if not isinstance(obj, dict):
            continue
        addr = str(obj.get("address") or key).upper()
        if addr not in devices or devices[addr]["excluded"]:
            continue
        # Sources come from the ad stream already processed above
        # No extra action needed — pc objects also appear in ads

    def _fp_distance(fp1: dict, fp2: dict) -> float:
        """Euclidean distance between two RSSI fingerprint vectors.

        Only considers scanners present in both fingerprints.
        Missing scanners are penalised with a 20 dBm gap.
        """
        shared = set(fp1.keys()) & set(fp2.keys())
        all_srcs = set(fp1.keys()) | set(fp2.keys())
        if not all_srcs:
            return 999.0
        sum_sq = 0.0
        for s in shared:
            diff = fp1[s] - fp2[s]
            sum_sq += diff * diff
        # Penalise unshared scanners (device seen by one scanner but not the other
        # means they are likely in different spots)
        missing = len(all_srcs) - len(shared)
        sum_sq += missing * (20.0 ** 2)
        return (sum_sq / max(len(all_srcs), 1)) ** 0.5

    # Group unidentified devices by room, then cluster within each room
    _room_unident: dict[str, list[str]] = {}  # room → [addr, ...]
    for addr, dev in devices.items():
        if dev["excluded"] or dev["is_identified"]:
            continue
        room = dev["room"] or "Unknown"
        _room_unident.setdefault(room, []).append(addr)

    # Simple greedy agglomerative clustering: merge closest pair until all
    # pairs exceed threshold.  Threshold = 8 dBm RMS difference (devices
    # carried together typically differ by <5 dBm).
    CLUSTER_THRESH = float(_sd.get("occupancy_cluster_threshold", 8.0))
    _cluster_count: dict[str, int] = {}  # room → number of clusters
    _cluster_map: dict[str, int] = {}    # addr → cluster_id (for UI)

    for room, addrs in _room_unident.items():
        fps = [(a, _dev_fp.get(a, {})) for a in addrs]
        # Assign each device to its own cluster initially
        clusters: list[list[int]] = [[i] for i in range(len(fps))]
        # Iteratively merge closest pair
        changed = True
        while changed and len(clusters) > 1:
            changed = False
            best_dist = CLUSTER_THRESH
            best_i = -1
            best_j = -1
            for ci in range(len(clusters)):
                for cj in range(ci + 1, len(clusters)):
                    # Average-linkage distance between clusters
                    dists = []
                    for ai in clusters[ci]:
                        for aj in clusters[cj]:
                            dists.append(_fp_distance(fps[ai][1], fps[aj][1]))
                    avg = sum(dists) / len(dists) if dists else 999.0
                    if avg < best_dist:
                        best_dist = avg
                        best_i = ci
                        best_j = cj
            if best_i >= 0:
                clusters[best_i].extend(clusters[best_j])
                clusters.pop(best_j)
                changed = True
        _cluster_count[room] = len(clusters)
        # Record cluster assignment for UI
        for cid, members in enumerate(clusters):
            for idx in members:
                _cluster_map[fps[idx][0]] = cid

    # Phase 4: Compute per-room occupancy
    room_data: dict[str, dict] = {}  # room → {identified, unidentified, clusters, estimate_low, estimate_high, estimate}
    for addr, dev in devices.items():
        if dev["excluded"]:
            continue
        room = dev["room"] or "Unknown"
        if room not in room_data:
            room_data[room] = {"identified": 0, "unidentified": 0, "clusters": 0, "devices": []}
        if dev["is_identified"]:
            room_data[room]["identified"] += 1
        else:
            room_data[room]["unidentified"] += 1
        room_data[room]["devices"].append({
            "addr": addr[-8:],  # last 8 chars for privacy
            "label": dev["label"],
            "kind": dev["kind"],
            "is_identified": dev["is_identified"],
            "cluster": _cluster_map.get(addr),
        })

    # Assign cluster counts
    for room, rd in room_data.items():
        rd["clusters"] = _cluster_count.get(room, rd["unidentified"])

    # Compute estimates per room
    # New formula: identified count 1:1, unidentified uses cluster count
    # (each cluster ≈ one person's devices grouped together).
    # The multiplier now applies to clusters, not raw device count.
    rooms_result = []
    total_identified = 0
    total_unidentified = 0
    total_estimate = 0
    total_clusters = 0
    for room, rd in sorted(room_data.items()):
        ident = rd["identified"]
        unident = rd["unidentified"]
        clust = rd["clusters"]
        total_clusters += clust
        # Primary estimate: identified + clusters (each cluster ≈ 1 person)
        # Apply multiplier to clusters for fine-tuning (trained value converges to 1.0)
        est = ident + max(0, round(clust / multiplier))
        est_low = ident + max(0, round(clust / (multiplier * 1.5)))
        est_high = ident + round(clust / max(0.5, multiplier * 0.7))
        total_identified += ident
        total_unidentified += unident
        total_estimate += est
        rooms_result.append({
            "room": room,
            "identified": ident,
            "unidentified": unident,
            "clusters": clust,
            "estimate": est,
            "estimate_low": est_low,
            "estimate_high": est_high,
            "devices": rd["devices"],
        })

    # ── Phase 5: Hybrid signals from HA ─────────────────────────────────────
    _hybrid_enabled = bool(_sd.get("occupancy_hybrid_enabled", True))
    # BLE alone misses people whose phones don't advertise. Supplement with:
    #   1. person.* entities (home/away from GPS + WiFi + BLE)
    #   2. binary_sensor.*_occupancy / *_presence (mmWave / radar)
    #   3. binary_sensor.*_motion (PIR / motion sensors)
    #   4. WiFi connected client counts (router integrations)

    hybrid_signals: dict[str, Any] = {
        "persons_home": 0, "person_names": [],
        "presence_sensors_active": 0, "presence_rooms": [],
        "motion_sensors_active": 0, "motion_rooms": [],
        "wifi_clients": 0, "wifi_source": "",
    }

    # 1. person.* entities — who is "home"?
    if _hybrid_enabled:
        try:
            for state in hass.states.async_all("person"):
                if state.state == "home":
                    hybrid_signals["persons_home"] += 1
                    name = state.attributes.get("friendly_name") or state.entity_id
                    hybrid_signals["person_names"].append(name)
        except Exception:
            pass

    # 2. binary_sensor occupancy/presence — room-level presence (mmWave, radar)
    # 3. binary_sensor motion — recent movement
    if _hybrid_enabled:
        try:
            _area_registry = None
            try:
                from homeassistant.helpers import area_registry as _ar_mod
                _area_registry = _ar_mod.async_get(hass)
            except Exception:
                pass

            _entity_registry = None
            try:
                from homeassistant.helpers import entity_registry as _er_mod
                _entity_registry = _er_mod.async_get(hass)
            except Exception:
                pass

            for state in hass.states.async_all("binary_sensor"):
                eid = state.entity_id or ""
                eid_lower = eid.lower()
                is_occupancy = any(k in eid_lower for k in ("occupancy", "presence", "mmwave", "ld2410", "fp2", "human"))
                is_motion = "motion" in eid_lower and not is_occupancy

                if not is_occupancy and not is_motion:
                    continue
                if state.state != "on":
                    continue

                # Try to find the room/area for this sensor
                sensor_room = ""
                if _entity_registry and _area_registry:
                    try:
                        entry = _entity_registry.async_get(eid)
                        area_id = entry.area_id if entry else None
                        if not area_id and entry and entry.device_id:
                            from homeassistant.helpers import device_registry as _dr_mod
                            _dr = _dr_mod.async_get(hass)
                            dev = _dr.async_get(entry.device_id)
                            area_id = dev.area_id if dev else None
                        if area_id:
                            area = _area_registry.async_get_area(area_id)
                            sensor_room = area.name if area else ""
                    except Exception:
                        pass

                if is_occupancy:
                    hybrid_signals["presence_sensors_active"] += 1
                    if sensor_room and sensor_room not in hybrid_signals["presence_rooms"]:
                        hybrid_signals["presence_rooms"].append(sensor_room)
                elif is_motion:
                    hybrid_signals["motion_sensors_active"] += 1
                    if sensor_room and sensor_room not in hybrid_signals["motion_rooms"]:
                        hybrid_signals["motion_rooms"].append(sensor_room)
        except Exception:
            pass

    # 4. WiFi connected clients — router integrations expose client counts
    if _hybrid_enabled:
        try:
            for state in hass.states.async_all("sensor"):
                eid = state.entity_id or ""
                eid_lower = eid.lower()
                if any(k in eid_lower for k in ("connected_client", "num_client", "wifi_client",
                                                 "connected_device", "wlan_client", "active_client")):
                    try:
                        val = int(float(state.state))
                        if val > hybrid_signals["wifi_clients"]:
                            hybrid_signals["wifi_clients"] = val
                            hybrid_signals["wifi_source"] = eid
                    except (ValueError, TypeError):
                        pass
        except Exception:
            pass

    # ── Phase 6: Fuse signals into final estimate ─────────────────────────
    # BLE estimate is the base. Hybrid signals provide a FLOOR — if other
    # signals indicate more people, raise the estimate to match.
    #
    # Logic:
    #   - persons_home is a hard floor (HA knows who's home via GPS+WiFi)
    #   - presence_sensors_active rooms: at least 1 person per active room
    #   - wifi_clients: roughly 1 person per 2 WiFi devices (phones + laptops)
    #   - motion_rooms: weak signal, at least 1 person per active room

    ble_estimate = total_estimate
    hybrid_floor = 0

    if _hybrid_enabled:
        # Person entities — most reliable signal for residents
        hybrid_floor = max(hybrid_floor, hybrid_signals["persons_home"])

        # Presence/occupancy sensors — at least 1 person per room with active sensor
        hybrid_floor = max(hybrid_floor, hybrid_signals["presence_sensors_active"])

        # WiFi clients — very weak signal in smart homes where most WiFi
        # devices are IoT, not phones.  Only use as last-resort floor when
        # no persons/presence sensors available, and use a conservative ratio.
        if hybrid_floor == 0 and hybrid_signals["wifi_clients"] > 0:
            wifi_est = max(1, round(hybrid_signals["wifi_clients"] / 10))
            hybrid_floor = wifi_est

        # Motion — weaker signal, use as minimum if we have no other data
        if hybrid_floor == 0 and hybrid_signals["motion_sensors_active"] > 0:
            hybrid_floor = hybrid_signals["motion_sensors_active"]

    # Apply: raise BLE estimate to the hybrid floor if higher
    if hybrid_floor > total_estimate:
        total_estimate = hybrid_floor
        # Also raise the room-level estimates proportionally if possible
        # Distribute the extra people into rooms with presence/motion sensors
        extra = hybrid_floor - ble_estimate
        if extra > 0:
            # Add to rooms with active presence sensors first
            _boosted_rooms = set(hybrid_signals.get("presence_rooms", []) + hybrid_signals.get("motion_rooms", []))
            for r in rooms_result:
                if extra <= 0:
                    break
                if r["room"] in _boosted_rooms and r["estimate"] == 0:
                    r["estimate"] = 1
                    extra -= 1

    # Overall confidence — improves with hybrid data
    total_devices = total_identified + total_unidentified
    hybrid_boost = min(hybrid_signals["persons_home"], 3) + min(hybrid_signals["presence_sensors_active"], 2)
    if total_devices == 0 and hybrid_boost == 0:
        confidence = "low"
    elif hybrid_boost >= 3 or total_identified / max(total_devices, 1) > 0.8:
        confidence = "high"
    elif hybrid_boost >= 1 or total_identified / max(total_devices, 1) > 0.4:
        confidence = "medium"
    else:
        confidence = "low"

    total_low = max(hybrid_signals["persons_home"], sum(r["estimate_low"] for r in rooms_result))
    total_high = max(total_estimate, sum(r["estimate_high"] for r in rooms_result))

    return {
        "total_estimate": total_estimate,
        "total_low": total_low,
        "total_high": total_high,
        "confidence": confidence,
        "rooms": rooms_result,
        "identified": total_identified,
        "unidentified": total_unidentified,
        "clusters": total_clusters,
        "excluded": excluded_count,
        "multiplier": multiplier,
        "cluster_threshold": CLUSTER_THRESH,
        "dwell_min": dwell_min,
        "training_count": len(training),
        "ble_estimate": ble_estimate,
        "hybrid_enabled": _hybrid_enabled,
        "hybrid": hybrid_signals,
    }


@websocket_api.websocket_command({"type": "padspan_ha/occupancy_estimate"})
@websocket_api.async_response
async def ws_occupancy_estimate(hass: HomeAssistant, connection, msg) -> None:
    """WS wrapper for occupancy estimation."""
    result = await compute_occupancy_estimate(hass)
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({
    "type": "padspan_ha/occupancy_train",
    "actual_count": vol.Coerce(int),
    vol.Optional("room"): str,
})
@websocket_api.async_response
async def ws_occupancy_train(hass: HomeAssistant, connection, msg) -> None:
    """Record actual headcount for occupancy multiplier training."""
    _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not _st:
        connection.send_error(msg["id"], "no_settings", "Settings not loaded")
        return

    actual = int(msg["actual_count"])
    room = (msg.get("room") or "").strip()

    # Get current estimate for comparison
    from .bluetooth_live import get_bluetooth_live
    bl = get_bluetooth_live(hass)
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    pc_data = (pc.data or {}) if pc else {}

    # Quick device count
    identified = sum(1 for o in pc_data.values() if isinstance(o, dict) and o.get("user_label"))
    unidentified_raw = sum(1 for o in pc_data.values() if isinstance(o, dict) and not o.get("user_label") and o.get("kind") in ("ble", "private_ble"))

    # Compute what multiplier would match
    if actual > identified and unidentified_raw > 0:
        computed_mult = round(unidentified_raw / max(1, actual - identified), 2)
    elif actual <= identified:
        computed_mult = 99.0  # all accounted for by identified
    else:
        computed_mult = 1.5  # can't compute

    from datetime import datetime, timezone
    observation = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "actual": actual,
        "room": room,
        "identified": identified,
        "unidentified": unidentified_raw,
        "computed_multiplier": min(5.0, computed_mult),
    }

    training = list(_st.data.get("occupancy_training") or [])
    training.append(observation)
    # Keep last 100 observations
    if len(training) > 100:
        training = training[-100:]
    _st.data["occupancy_training"] = training
    await _st.store.async_save(_st.data)

    connection.send_result(msg["id"], {"ok": True, "observation": observation, "total_observations": len(training)})


# ══════════════════════════════════════════════════════════════════════════════
# Fabric Health — diagnostic checks for Phase 1-3 decoupling
# ══════════════════════════════════════════════════════════════════════════════


@websocket_api.websocket_command({"type": "padspan_ha/fabric_health"})
@websocket_api.async_response
async def ws_fabric_health(hass: HomeAssistant, connection, msg) -> None:
    """Run diagnostic checks on the positioning fabric (Phase 1-3)."""
    checks: list[dict[str, Any]] = []
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")

    # ── Phase 1: Fabric sync ────────────────────────────────────────────────
    if mdl:
        scanners = mdl.data.get("scanners", {})
        sync_mode = mdl.sync_mode()
        ha_sync_count = sum(1 for s in scanners.values() if isinstance(s, dict) and s.get("source_type") == "ha_sync")
        manual_count = sum(1 for s in scanners.values() if isinstance(s, dict) and s.get("source_type") == "manual")
        adj = mdl.adjacency()
        adj_room_count = len(adj)
        adj_edge_count = sum(len(v) for v in adj.values()) // 2

        checks.append({
            "group": "fabric_sync", "name": "Sync Mode",
            "ok": True, "value": sync_mode,
            "detail": f"Mode: {sync_mode}",
        })
        checks.append({
            "group": "fabric_sync", "name": "Scanners in Fabric",
            "ok": len(scanners) > 0, "value": len(scanners),
            "detail": f"{len(scanners)} total ({ha_sync_count} ha_sync, {manual_count} manual)",
        })
        # List scanner→room mappings
        scanner_list = []
        for src, info in sorted(scanners.items()):
            if isinstance(info, dict):
                scanner_list.append({
                    "source": src, "room": info.get("room", "?"),
                    "floor_id": info.get("floor_id", "?"),
                    "source_type": info.get("source_type", "?"),
                })
        # Adjacency: pass if we have adjacency data OR centroid-based adjacency is active
        _has_centroids = bool(mdl.room_centroids_m()) or bool(mdl.room_geometry_m())
        checks.append({
            "group": "fabric_sync", "name": "Adjacency",
            "ok": adj_room_count > 0 or _has_centroids or len(scanners) <= 1,
            "value": f"{adj_room_count} rooms, {adj_edge_count} edges" + (" (centroids active)" if _has_centroids and adj_room_count == 0 else ""),
            "detail": f"{adj_room_count} rooms with neighbors, {adj_edge_count} bidirectional edges" +
                      (". Centroid-based adjacency prior active from room geometry." if _has_centroids and adj_room_count == 0 else ""),
        })
    else:
        checks.append({
            "group": "fabric_sync", "name": "ModelStore",
            "ok": False, "value": "not loaded",
            "detail": "ModelStore is not initialized — fabric is offline",
        })
        scanner_list = []

    # ── Phase 2: Spatial model ───────────────────────────────────────────────
    if mdl:
        positions = mdl.data.get("scanner_positions_m", {})
        geometry = mdl.room_geometry_m()
        barriers = mdl.data.get("rf_barriers_m", [])
        transforms = mdl.data.get("map_transforms", {})

        checks.append({
            "group": "spatial", "name": "Scanner Positions (metres)",
            "ok": len(positions) > 0, "value": len(positions),
            "detail": f"{len(positions)} scanners have real-world metre positions",
        })
        checks.append({
            "group": "spatial", "name": "Room Geometry (metres)",
            "ok": len(geometry) > 0, "value": len(geometry),
            "detail": f"{len(geometry)} rooms have real-world geometry (poly/circle)",
        })
        checks.append({
            "group": "spatial", "name": "RF Barriers (metres)",
            "ok": True, "value": len(barriers),
            "detail": f"{len(barriers)} barriers in real-world metre space",
        })
        # Build transform detail with scale and measurement info
        _tx_details = []
        for _mid, _tx in transforms.items():
            sx = _tx.get("scale_x_m", 0)
            sy = _tx.get("scale_y_m", 0)
            _refs = _tx.get("reference_measurements") or []
            _ref_str = f", {len(_refs)} ref measurement(s)" if _refs else ""
            _map_name = ""
            if ms:
                _m = ms.get_map(_mid)
                if _m:
                    _map_name = _m.get("name", _mid)
            _tx_details.append(f"{_map_name or _mid}: {sx:.1f}m × {sy:.1f}m{_ref_str}")
        checks.append({
            "group": "spatial", "name": "Map Transforms",
            "ok": len(transforms) > 0 or (ms and not ms.list_maps()),
            "value": len(transforms),
            "detail": "; ".join(_tx_details) if _tx_details else "No transforms",
        })
        # Reference measurements check
        _total_refs = sum(len(t.get("reference_measurements") or []) for t in transforms.values() if isinstance(t, dict))
        _has_refs = _total_refs > 0
        checks.append({
            "group": "spatial", "name": "Scale Calibration",
            "ok": _has_refs,
            "value": f"{_total_refs} measurement(s)" if _has_refs else "not calibrated",
            "detail": f"{_total_refs} reference distance measurement(s) from the Measure tool" if _has_refs else "Use the Measure tool in Maps \u2192 Edit to set real-world scale from known distances",
        })

        # Check if coordinator is using metre model
        use_metres = getattr(pc, "_use_metres", False) if pc else False
        checks.append({
            "group": "spatial", "name": "Coordinator Mode",
            "ok": True, "value": "metres" if use_metres else "map fractions",
            "detail": "Presence coordinator is using " + ("real-world metre model" if use_metres else "legacy map-fraction model"),
        })

        # Scanner positions detail list
        position_list = []
        for src, pos in sorted(positions.items()):
            if isinstance(pos, dict):
                position_list.append({
                    "source": src,
                    "x_m": pos.get("x_m"), "y_m": pos.get("y_m"), "z_m": pos.get("z_m"),
                    "floor_id": pos.get("floor_id", "?"),
                    "origin": pos.get("origin", "?"),
                })

        # Room geometry detail list
        geometry_list = []
        centroids = mdl.room_centroids_m()
        for room, geo in sorted(geometry.items()):
            if isinstance(geo, dict):
                c = centroids.get(room)
                geometry_list.append({
                    "room": room, "type": geo.get("type", "?"),
                    "floor_id": geo.get("floor_id", "?"),
                    "origin": geo.get("committed_by") or geo.get("origin", "?"),
                    "centroid_m": [round(c[0], 2), round(c[1], 2)] if c else None,
                })

        # ── Fabric floor status + disconnected-cluster diagnostic ─────────
        # A floor whose room shapes form more than one spatially disconnected
        # group is the signature of the fabricated-transform corruption —
        # surface it proactively instead of waiting for positioning to lie.
        _fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)
        fabric_floors = _fab.floors_status() if _fab else {}
        _by_floor: dict[str, list] = {}
        for _room, _geo in geometry.items():
            if isinstance(_geo, dict):
                _bb = _geom_bbox_m(_geo)
                if _bb:
                    _by_floor.setdefault(str(_geo.get("floor_id", "?")), []).append(_bb)
        for _fl, _bbs in _by_floor.items():
            _clusters = _cluster_count(_bbs)
            _entry = fabric_floors.setdefault(_fl, {"committed": False, "committed_at": None, "rooms": len(_bbs)})
            _entry["clusters"] = _clusters
            _entry["bbox_w_m"] = round(max(b[2] for b in _bbs) - min(b[0] for b in _bbs), 1)
            _entry["bbox_h_m"] = round(max(b[3] for b in _bbs) - min(b[1] for b in _bbs), 1)
            checks.append({
                "group": "spatial", "name": f"Floor '{_fl}' coherence",
                "ok": _clusters <= 1,
                "value": f"{_clusters} cluster" + ("s" if _clusters != 1 else ""),
                "detail": (
                    f"{len(_bbs)} rooms form one connected floor plan"
                    if _clusters <= 1 else
                    f"{len(_bbs)} rooms fall into {_clusters} disconnected groups — "
                    "open Mapping → Rooms and drag the stray group into place"
                ),
            })
    else:
        position_list = []
        geometry_list = []
        fabric_floors = {}

    # ── Phase 3: Calibration metres ──────────────────────────────────────────
    if cal:
        pts = cal.data.get("points", [])
        total_pts = len(pts)
        pts_with_m = sum(1 for p in pts if p.get("x_m") is not None)
        pts_without_m = total_pts - pts_with_m

        checks.append({
            "group": "calibration", "name": "Calibration Points",
            "ok": total_pts > 0, "value": total_pts,
            "detail": f"{total_pts} total calibration fingerprint points",
        })
        checks.append({
            "group": "calibration", "name": "Points with Metres",
            "ok": pts_without_m == 0 or total_pts == 0,
            "value": f"{pts_with_m}/{total_pts}",
            "detail": f"{pts_with_m} of {total_pts} points have x_m/y_m coordinates" +
                      (f" ({pts_without_m} missing — run fabric_migrate_from_maps)" if pts_without_m > 0 else " — all anchored"),
        })

        # ModelStore wired?
        has_model_ref = cal._model is not None
        checks.append({
            "group": "calibration", "name": "ModelStore Wired",
            "ok": has_model_ref, "value": "yes" if has_model_ref else "no",
            "detail": "CalibrationStore " + ("has" if has_model_ref else "MISSING") + " reference to ModelStore for metre conversions",
        })

        # RF trained in metres?
        rf_trained = cal.rf_trained
        rf_metres = getattr(cal._rf, "_use_metres", False) if rf_trained else False
        checks.append({
            "group": "calibration", "name": "RF Model",
            "ok": rf_trained, "value": ("metres" if rf_metres else "fractions") if rf_trained else "not trained",
            "detail": ("Random Forest trained in " + ("metre" if rf_metres else "fraction") + " space") if rf_trained else "RF not trained (need ≥4 points)",
        })

        # LOO accuracy
        loo = cal.loo_accuracy()
        if loo:
            has_real_m = "mean_error_m" in loo
            err_str = f"{loo['mean_error_m']}m" if has_real_m else f"~{loo.get('mean_error_m_est', '?')}m (estimated)"
            checks.append({
                "group": "calibration", "name": "LOO Accuracy",
                "ok": True, "value": err_str,
                "detail": f"Mean error: {err_str}, median: " +
                          (f"{loo.get('median_error_m', '?')}m" if has_real_m else f"{loo.get('median_error_frac', '?')} frac") +
                          f" ({loo['point_count']} points)",
            })
    else:
        checks.append({
            "group": "calibration", "name": "CalibrationStore",
            "ok": False, "value": "not loaded",
            "detail": "CalibrationStore is not initialized",
        })

    # ── Device Registry ───────────────────────────────────────────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            _dev_count = _dev_reg.device_count()
            _labeled = _dev_reg.all_labeled()
            _labeled_count = len(_labeled)
            checks.append({
                "group": "identity", "name": "Device Registry",
                "ok": True, "value": f"{_dev_count} devices",
                "detail": f"{_dev_count} persistent devices, {_labeled_count} labeled",
            })
            # Migration status
            obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
            _obj_count = len(obj_store.all()) if obj_store else 0
            _needs_migration = _dev_count == 0 and _obj_count > 0
            checks.append({
                "group": "identity", "name": "Identity Migration",
                "ok": not _needs_migration,
                "value": "needed" if _needs_migration else "complete",
                "detail": (f"{_obj_count} objects in legacy store need migration to Device Registry"
                           if _needs_migration else
                           f"Device Registry active ({_dev_count} devices, {_labeled_count} labeled)"),
            })
        else:
            checks.append({
                "group": "identity", "name": "Device Registry",
                "ok": False, "value": "not loaded",
                "detail": "DeviceRegistry is not initialized",
            })
    except Exception:
        pass

    # ── Dependent store identity migration ──────────────────────────────────
    try:
        from .const import DATA_MOVEMENT, DATA_TRACEBACK, DATA_ALERTS, DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg and _dev_reg.device_count() > 0:
            # Movement store: check how many entries have padspan_id
            _mv = hass.data.get(DOMAIN, {}).get(DATA_MOVEMENT)
            if _mv:
                _mv_total = len(_mv.entries)
                _mv_with_pid = sum(1 for e in _mv.entries if e.get("padspan_id"))
                checks.append({
                    "group": "identity", "name": "Movement History",
                    "ok": _mv_total == 0 or _mv_with_pid > 0,
                    "value": f"{_mv_with_pid}/{_mv_total}",
                    "detail": f"{_mv_with_pid} of {_mv_total} movement entries have stable padspan_id",
                })

            # Traceback: check recent frames for padspan_id
            _tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
            if _tb and _tb.frames:
                _recent = _tb.frames[-min(100, len(_tb.frames)):]
                _tb_objs = sum(len(f.get("o", [])) for f in _recent)
                _tb_with_pid = sum(1 for f in _recent for o in f.get("o", []) if o.get("pid"))
                checks.append({
                    "group": "identity", "name": "Traceback Frames",
                    "ok": _tb_objs == 0 or _tb_with_pid > 0,
                    "value": f"{_tb_with_pid}/{_tb_objs} (last 100 frames)",
                    "detail": f"{_tb_with_pid} of {_tb_objs} traceback objects have stable padspan_id",
                })

            # Alert configs: check for padspan_id
            _al = hass.data.get(DOMAIN, {}).get(DATA_ALERTS)
            if _al:
                _al_total = len(_al.data)
                _al_with_pid = sum(1 for v in _al.data.values() if isinstance(v, dict) and v.get("padspan_id"))
                checks.append({
                    "group": "identity", "name": "Follow Alerts",
                    "ok": _al_total == 0 or _al_with_pid > 0,
                    "value": f"{_al_with_pid}/{_al_total}",
                    "detail": f"{_al_with_pid} of {_al_total} alert configs have stable padspan_id",
                })
    except Exception:
        pass

    # ── Label pipeline health ───────────────────────────────────────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
        if _dev_reg:
            # Compare label counts: DeviceRegistry vs ObjectStore
            _reg_labeled = len(_dev_reg.all_labeled())
            _obj_labeled = 0
            _obj_only = 0  # labels in ObjectStore but NOT in DeviceRegistry
            if obj_store:
                _obj_all = obj_store.all()
                for _oaddr, _oval in _obj_all.items():
                    if isinstance(_oval, dict) and _oval.get("label"):
                        _obj_labeled += 1
                        _pid = _dev_reg.resolve(_oaddr)
                        if not _pid or not _dev_reg.get_label(_pid):
                            _obj_only += 1
            checks.append({
                "group": "identity", "name": "Label Pipeline",
                "ok": _obj_only == 0,
                "value": f"Registry: {_reg_labeled}, Legacy: {_obj_labeled}" + (f", {_obj_only} unmigrated" if _obj_only else ""),
                "detail": (f"{_obj_only} labels exist only in legacy ObjectStore — re-save them or restart to trigger migration"
                           if _obj_only else
                           f"All labels in DeviceRegistry ({_reg_labeled} devices). Legacy ObjectStore has {_obj_labeled} entries (fallback only)."),
            })
    except Exception:
        pass

    # ── HA Entity identity ──────────────────────────────────────────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        _pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if _dev_reg and _pc and _pc.data:
            _ent_total = len(_pc.data)
            _ent_with_pid = sum(1 for v in _pc.data.values() if isinstance(v, dict) and v.get("padspan_id"))
            checks.append({
                "group": "identity", "name": "Entity Identity",
                "ok": _ent_total == 0 or _ent_with_pid > 0,
                "value": f"{_ent_with_pid}/{_ent_total}",
                "detail": f"{_ent_with_pid} of {_ent_total} tracked objects have padspan_id (used for HA device identity)",
            })
    except Exception:
        pass

    # ── Phase B: Multi-floor + Occupancy ────────────────────────────────────
    try:
        _ad = hass.data.get(DOMAIN, {}).get(DATA_ADAPTIVE)
        _pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
        if _ad:
            # Floor transition learning
            _ft = _ad.data.get("floor_transitions", {})
            _ft_total = sum(e.get("n", 0) for e in _ft.values() if isinstance(e, dict))
            _ft_pairs = len(_ft)
            checks.append({
                "group": "multifloor", "name": "Floor Transition Learning",
                "ok": True, "value": f"{_ft_total} observations, {_ft_pairs} pairs",
                "detail": f"{_ft_total} floor transitions recorded across {_ft_pairs} floor pairs" +
                          (f" ({', '.join(k + ':' + str(v.get('n',0)) for k,v in _ft.items() if isinstance(v,dict))})" if _ft_pairs else "")
                          if _ft_total else "No floor transitions recorded yet — learning starts automatically when devices change floors",
            })
            # Learned cross-floor attenuation
            _fp = _ad.data.get("floor_pairs", {})
            _fp_ready = sum(1 for v in _fp.values() if isinstance(v, dict) and v.get("n", 0) >= 10)
            _fp_total = len(_fp)
            checks.append({
                "group": "multifloor", "name": "Cross-Floor Attenuation",
                "ok": True, "value": f"{_fp_ready}/{_fp_total} pairs ready",
                "detail": f"{_fp_ready} floor pairs have enough data (>10 obs) for learned attenuation correction" +
                          (". " + ", ".join(f"{k}: {v.get('mean',0):.1f}dB ({v.get('n',0)} obs)" for k,v in _fp.items() if isinstance(v,dict) and v.get("n",0) >= 10) if _fp_ready else ""),
            })
        # Dwell tracking
        if _pc:
            _dwell_count = len(getattr(_pc, "_room_dwell_start", {}))
            _floor_count = len(getattr(_pc, "_device_floor", {}))
            checks.append({
                "group": "multifloor", "name": "Dwell Tracking",
                "ok": True, "value": f"{_dwell_count} devices tracked",
                "detail": f"{_dwell_count} devices with room dwell tracking, {_floor_count} with floor assignment",
            })
        # Occupancy
        try:
            _st_occ = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _occ_training = ((_st_occ.data if _st_occ else {}).get("occupancy_training") or []) if _st_occ else []
            _occ_mult = float((_st_occ.data if _st_occ else {}).get("occupancy_multiplier", 1.5)) if _st_occ else 1.5
            checks.append({
                "group": "occupancy", "name": "Occupancy Estimator",
                "ok": True, "value": f"multiplier {_occ_mult}x, {len(_occ_training)} training observations",
                "detail": f"BLE device multiplier: {_occ_mult}x" +
                          (f" (trained from {len(_occ_training)} observations)" if _occ_training else " (default — train with actual headcounts to improve accuracy)"),
            })
        except Exception:
            pass
    except Exception:
        pass

    # ── Summary ──────────────────────────────────────────────────────────────
    total = len(checks)
    passed = sum(1 for c in checks if c["ok"])
    failed = total - passed

    # ── Maps diagnostic info ───────────────────────────────────────────────
    maps_diag: list[dict[str, Any]] = []
    if ms:
        for m in ms.list_maps():
            img = m.get("image") or {}
            cal = m.get("calibration") or {}
            stk = m.get("stack") or {}
            maps_diag.append({
                "id": m.get("id", "?"),
                "name": m.get("name", "?"),
                "floor_id": m.get("floor_id", "?"),
                "width": img.get("width", 0),
                "height": img.get("height", 0),
                "px_per_meter": cal.get("px_per_meter"),
                "cal_mode": cal.get("mode", "none"),
                "is_master": stk.get("is_master", False),
                "has_receivers": len(m.get("receivers") or []),
                "has_room_bounds": len(m.get("room_bounds") or {}),
                "has_rf_barriers": len(m.get("rf_barriers") or []),
            })

    connection.send_result(msg["id"], {
        "summary": {"total": total, "passed": passed, "failed": failed, "healthy": failed == 0},
        "checks": checks,
        "scanners": scanner_list,
        "scanner_positions_m": position_list if mdl else [],
        "room_geometry_m": geometry_list if mdl else [],
        "fabric_floors": fabric_floors,
        "adjacency": mdl.adjacency() if mdl else {},
        "maps": maps_diag,
    })


@websocket_api.websocket_command({"type": "padspan_ha/radio_audit"})
@websocket_api.async_response
async def ws_radio_audit(hass: HomeAssistant, connection, msg) -> None:
    """Cross-reference BLE radios with ESPHome devices and fabric scanners.

    For each active BLE radio, returns:
    - BLE source info (source, name, connectable, scanning, last_heard)
    - HA device info (name, manufacturer, model, sw_version, hw_version, MACs)
    - ESPHome identification (config entry, identifiers)
    - Area/floor assignment from HA vs fabric
    - Mismatch flags when HA and fabric disagree
    """
    from .bluetooth_live import get_bluetooth_live

    dr = device_registry.async_get(hass)
    ar = area_registry.async_get(hass)

    # Area lookups
    area_id_to_name: dict[str, str] = {}
    area_id_to_floor: dict[str, str] = {}
    for a in ar.async_list_areas():
        area_id_to_name[a.id] = a.name
        fl = getattr(a, "floor_id", None)
        if fl:
            area_id_to_floor[a.id] = str(fl)

    # Get live BLE snapshot
    bl = get_bluetooth_live(hass)
    ble_snap = bl.get_snapshot(max_ads=0, max_age_s=300) if bl else {"radios": []}
    radios = ble_snap.get("radios") or []

    # Fabric scanner mappings
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    fabric_scanners = (mdl.data.get("scanners") or {}) if mdl else {}
    fabric_positions = (mdl.data.get("scanner_positions_m") or {}) if mdl else {}

    # Build name→device lookup
    name_to_dev: dict[str, Any] = {}
    for dev in dr.devices.values():
        for cand in [dev.name_by_user, dev.name]:
            if cand:
                name_to_dev[cand.lower()] = dev

    # ESPHome config entry IDs
    esphome_entry_ids: set[str] = set()
    for ent in hass.config_entries.async_entries():
        if ent.domain == "esphome":
            esphome_entry_ids.add(ent.entry_id)

    results: list[dict[str, Any]] = []
    for radio in radios:
        src = radio.get("source", "")
        rname = radio.get("name", "")

        entry: dict[str, Any] = {
            "source": src,
            "radio_name": rname,
            "connectable": radio.get("connectable"),
            "scanning": radio.get("scanning"),
            "last_heard_s": radio.get("last_heard_s"),
        }

        # ── Match to HA device ──────────────────────────────────────────
        dev = None
        dev_id = radio.get("device_id")
        if dev_id:
            dev = dr.async_get(dev_id)
        if not dev:
            # Fuzzy match by name
            src_l = src.lower()
            rname_l = rname.lower()
            for key, d in name_to_dev.items():
                if key and (key in src_l or src_l in key or key in rname_l or rname_l in key):
                    dev = d
                    break

        if dev:
            # Extract MACs from connections
            macs: list[dict[str, str]] = []
            for ctype, cid in (dev.connections or set()):
                macs.append({"type": str(ctype), "address": str(cid).upper()})

            # Extract identifiers
            idents: list[dict[str, str]] = []
            is_esphome = False
            for domain, ident in (dev.identifiers or set()):
                idents.append({"domain": str(domain), "id": str(ident)})
                if domain == "esphome":
                    is_esphome = True

            # ESPHome config entry info
            esphome_entries: list[str] = []
            for ce_id in (dev.config_entries or set()):
                if ce_id in esphome_entry_ids:
                    ce = hass.config_entries.async_get_entry(ce_id)
                    if ce:
                        esphome_entries.append(ce.title)

            # HA area assignment
            ha_area = area_id_to_name.get(dev.area_id, "") if dev.area_id else ""
            ha_floor = area_id_to_floor.get(dev.area_id, "") if dev.area_id else ""

            entry["device"] = {
                "id": dev.id,
                "name": dev.name,
                "name_by_user": dev.name_by_user,
                "manufacturer": dev.manufacturer,
                "model": dev.model,
                "sw_version": dev.sw_version,
                "hw_version": dev.hw_version,
                "is_esphome": is_esphome,
                "esphome_names": esphome_entries,
                "identifiers": idents,
                "macs": macs,
                "ha_area": ha_area,
                "ha_floor": ha_floor,
            }
        else:
            entry["device"] = None

        # ── Fabric scanner info ─────────────────────────────────────────
        fabric = fabric_scanners.get(src)
        if fabric and isinstance(fabric, dict):
            entry["fabric"] = {
                "room": fabric.get("room"),
                "floor_id": fabric.get("floor_id"),
                "source_type": fabric.get("source_type"),
            }
        else:
            entry["fabric"] = None

        # Fabric metre position
        pos = fabric_positions.get(src)
        if pos and isinstance(pos, dict):
            entry["position_m"] = {
                "x_m": pos.get("x_m"),
                "y_m": pos.get("y_m"),
                "z_m": pos.get("z_m"),
                "floor_id": pos.get("floor_id"),
            }
        else:
            entry["position_m"] = None

        # ── Mismatch detection ──────────────────────────────────────────
        mismatches: list[str] = []
        if entry["device"] and entry["fabric"]:
            ha_area = entry["device"]["ha_area"]
            fabric_room = entry["fabric"]["room"]
            if ha_area and fabric_room and ha_area != fabric_room:
                mismatches.append(f"Room: HA={ha_area} vs fabric={fabric_room}")
            ha_fl = entry["device"]["ha_floor"]
            fab_fl = entry["fabric"]["floor_id"]
            if ha_fl and fab_fl and ha_fl != fab_fl:
                mismatches.append(f"Floor: HA={ha_fl} vs fabric={fab_fl}")
        if not entry["device"]:
            mismatches.append("No matching HA device found")
        if not entry["fabric"]:
            mismatches.append("Not in fabric scanner list")
        entry["mismatches"] = mismatches
        entry["ok"] = len(mismatches) == 0

        results.append(entry)

    # Sort: mismatches first, then by source
    results.sort(key=lambda r: (r["ok"], r["source"]))

    connection.send_result(msg["id"], {
        "total_radios": len(radios),
        "total_mismatches": sum(1 for r in results if not r["ok"]),
        "radios": results,
    })


@websocket_api.websocket_command({"type": "padspan_ha/fabric_resync"})
@websocket_api.async_response
async def ws_fabric_resync(hass: HomeAssistant, connection, msg) -> None:
    """Wipe all ha_sync scanner entries and rebuild clean from HA + snapshot.

    Fixes stale room/floor assignments. Preserves manual entries.
    Also prunes to actual BLE radios only.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return
    stats = await mdl.async_resync_clean()
    # Prune to radios only (using presence coordinator's last known radios)
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    pruned = 0
    if pc:
        try:
            from .websocket import _live_snapshot
            snap = await _live_snapshot(hass)
            _radios = (snap.get("ble") or {}).get("radios") or []
            _radio_srcs = {str(r.get("source")) for r in _radios if r.get("source")}
            if _radio_srcs:
                pruned = await mdl.async_prune_non_radio_scanners(_radio_srcs)
        except Exception:
            pass
    # Force snapshot sync to pick up floor_ids
    try:
        snap = await _live_snapshot(hass)
        _radios = (snap.get("ble") or {}).get("radios") or []
        if _radios:
            await mdl.async_sync_from_snapshot(_radios)
    except Exception:
        pass
    final_count = len(mdl.data.get("scanners", {}))
    connection.send_result(msg["id"], {
        "ok": True,
        **stats,
        "pruned": pruned,
        "final_count": final_count,
    })


@websocket_api.websocket_command({"type": "padspan_ha/fabric_reset_spatial"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_fabric_reset_spatial(hass: HomeAssistant, connection, msg) -> None:
    """Reset the spatial model (Phase 2+3) and rebuild from maps.

    Clears scanner_positions_m, rf_barriers_m, map_transforms, and beacon
    positions. The room fabric (FabricStore) is deliberately untouched — a
    built floor's room shapes are ground truth and no reset may wipe them.
    """
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return

    # Clear spatial data only — user must explicitly migrate after
    mdl.data["scanner_positions_m"] = {}
    mdl.data["rf_barriers_m"] = []
    mdl.data["map_transforms"] = {}
    mdl.data["beacon_positions_m"] = {}
    await mdl.store.async_save(mdl.data)

    # Clear metre coords from calibration points (they'll be re-backfilled on migrate)
    cal = hass.data.get(DOMAIN, {}).get(DATA_CALIBRATION)
    cal_cleared = 0
    if cal:
        try:
            for p in cal.data.get("points", []):
                if p.get("x_m") is not None:
                    p.pop("x_m", None)
                    p.pop("y_m", None)
                    cal_cleared += 1
            if cal_cleared:
                await cal.store.async_save(cal.data)
        except Exception:
            pass

    connection.send_result(msg["id"], {
        "ok": True, "cleared": True,
        "cal_points_cleared": cal_cleared,
        "next_step": "Click 'Migrate to Metres' with your floor width to rebuild.",
    })


# ── Device Registry WS Handlers ──────────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/device_registry_list"})
@websocket_api.async_response
async def ws_device_registry_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all devices in the Device Registry."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    devices = dev_reg.all_devices()
    connection.send_result(msg["id"], {
        "devices": devices,
        "count": len(devices),
        "labeled": len(dev_reg.all_labeled()),
    })


@websocket_api.websocket_command({"type": "padspan_ha/device_registry_migrate"})
@websocket_api.async_response
async def ws_device_registry_migrate(hass: HomeAssistant, connection, msg) -> None:
    """Trigger migration from ObjectStore to DeviceRegistry."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    stats = await dev_reg.async_migrate_from_object_store(obj_store)
    connection.send_result(msg["id"], {
        "ok": True,
        "migrated": stats["migrated"],
        "merged": stats["merged"],
        "skipped": stats["skipped"],
        "total_devices": dev_reg.device_count(),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_merge",
    "keep_id": str,
    "absorb_id": str,
})
@websocket_api.async_response
async def ws_device_registry_merge(hass: HomeAssistant, connection, msg) -> None:
    """Merge two devices in the Device Registry. absorb_id is removed."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    keep_id = str(msg["keep_id"]).strip()
    absorb_id = str(msg["absorb_id"]).strip()
    if not keep_id or not absorb_id:
        connection.send_error(msg["id"], "invalid_ids", "Both keep_id and absorb_id are required")
        return
    ok = await dev_reg.async_merge(keep_id, absorb_id)
    if not ok:
        connection.send_error(msg["id"], "merge_failed", "One or both devices not found")
        return
    connection.send_result(msg["id"], {
        "ok": True,
        "kept": keep_id,
        "absorbed": absorb_id,
        "device": dev_reg.get(keep_id),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_resolve",
    "key": str,
})
@websocket_api.async_response
async def ws_device_registry_resolve(hass: HomeAssistant, connection, msg) -> None:
    """Resolve a volatile key (MAC, iBeacon, canonical_id) to a padspan_id."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    key = str(msg["key"]).strip()
    pid = dev_reg.resolve(key)
    device = dev_reg.get(pid) if pid else None
    connection.send_result(msg["id"], {
        "padspan_id": pid,
        "device": device,
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_label_set",
    "padspan_id": str,
    "label": str,
})
@websocket_api.async_response
async def ws_device_registry_label_set(hass: HomeAssistant, connection, msg) -> None:
    """Set label on a device by padspan_id."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    pid = str(msg["padspan_id"]).strip()
    label = str(msg["label"]).strip()[:48]
    await dev_reg.async_set_label(pid, label)
    # Also sync to ObjectStore for backwards compat
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if obj_store:
        dev = dev_reg.get(pid)
        if dev:
            for ident in (dev.get("identities") or []):
                val = ident.get("value", "")
                if val:
                    await obj_store.async_set(val, label)
    connection.send_result(msg["id"], {
        "ok": True,
        "padspan_id": pid,
        "label": label,
        "device": dev_reg.get(pid),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_add_identity",
    "padspan_id": str,
    "kind": str,
    "value": str,
})
@websocket_api.async_response
async def ws_device_registry_add_identity(hass: HomeAssistant, connection, msg) -> None:
    """Link an additional volatile key to an existing device."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    pid = str(msg["padspan_id"]).strip()
    kind = str(msg["kind"]).strip()
    value = str(msg["value"]).strip()
    await dev_reg.async_add_identity(pid, kind, value)
    connection.send_result(msg["id"], {
        "ok": True,
        "padspan_id": pid,
        "device": dev_reg.get(pid),
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/device_registry_delete",
    "padspan_id": str,
})
@websocket_api.async_response
async def ws_device_registry_delete(hass: HomeAssistant, connection, msg) -> None:
    """Delete a device from the Device Registry."""
    from .const import DATA_DEVICE_REGISTRY
    dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
    if not dev_reg:
        connection.send_error(msg["id"], "no_device_registry", "Device Registry not initialized")
        return
    pid = str(msg["padspan_id"]).strip()
    if not dev_reg.get(pid):
        connection.send_error(msg["id"], "not_found", f"Device {pid} not found")
        return
    await dev_reg.async_delete(pid)
    connection.send_result(msg["id"], {"ok": True, "padspan_id": pid})


# ══════════════════════════════════════════════════════════════════════════════
# ESPresense Companion Import
# ══════════════════════════════════════════════════════════════════════════════


@websocket_api.websocket_command({"type": "padspan_ha/espresense_companion_import"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_espresense_companion_import(hass: HomeAssistant, connection, msg) -> None:
    """Import floors, rooms, and scanner positions from ESPresense Companion.

    Reads from the Companion REST API (GET /api/state/config), parses the
    response, and writes floors/room_meta/scanner positions to the ModelStore.
    Room shapes go through FabricStore.async_correct_room (external_import,
    merge-only) — an import can add rooms but never overwrite existing fabric.
    """
    import aiohttp

    _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not _st:
        connection.send_error(msg["id"], "no_settings", "Settings not loaded")
        return

    url = (_st.data.get("espresense_companion_url") or "").strip().rstrip("/")
    if not url:
        connection.send_error(msg["id"], "no_url",
                              "ESPresense Companion URL not configured. Set it in Manage → ESPresense MQTT.")
        return

    # ── Fetch config from Companion REST API ─────────────────────────────
    api_url = f"{url}/api/state/config"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200:
                    connection.send_error(msg["id"], "http_error",
                                          f"Companion returned HTTP {resp.status} from {api_url}")
                    return
                data = await resp.json()
    except aiohttp.ClientError as e:
        connection.send_error(msg["id"], "connect_failed",
                              f"Cannot reach ESPresense Companion at {api_url}: {e}")
        return
    except Exception as e:
        connection.send_error(msg["id"], "fetch_error", f"Failed to fetch config: {e}")
        return

    if not isinstance(data, dict):
        connection.send_error(msg["id"], "bad_data", "Unexpected response format from Companion")
        return

    # ── Parse and import ─────────────────────────────────────────────────
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if not mdl:
        connection.send_error(msg["id"], "no_model", "ModelStore not loaded")
        return

    stats = {"floors": 0, "rooms": 0, "scanners": 0, "skipped": 0}

    # ── Floors ───────────────────────────────────────────────────────────
    floors_raw = data.get("floors") or []
    if not isinstance(floors_raw, list):
        floors_raw = []

    existing_floors = {f.get("id"): f for f in (mdl.data.get("floors") or [])}

    for fl in floors_raw:
        if not isinstance(fl, dict):
            continue
        fl_name = str(fl.get("name") or fl.get("id") or "").strip()
        fl_id = str(fl.get("id") or fl_name).strip().lower().replace(" ", "_")
        if not fl_id:
            stats["skipped"] += 1
            continue

        # Add floor if not already present
        if fl_id not in existing_floors:
            floors_list = mdl.data.setdefault("floors", [])
            # Derive z_level from bounds if available
            bounds = fl.get("bounds") or []
            z_level = 0
            if isinstance(bounds, list) and len(bounds) >= 2:
                try:
                    z_level = int(round(float(bounds[0][2]) if len(bounds[0]) > 2 else 0))
                except Exception:
                    pass
            floors_list.append({"id": fl_id, "name": fl_name, "level": z_level})
            existing_floors[fl_id] = floors_list[-1]
            stats["floors"] += 1

        # ── Rooms (nested under floor) ───────────────────────────────────
        rooms_raw = fl.get("rooms") or []
        if not isinstance(rooms_raw, list):
            continue

        room_meta = mdl.data.setdefault("room_meta", {})
        _fab = hass.data.get(DOMAIN, {}).get(DATA_FABRIC)

        for rm in rooms_raw:
            if not isinstance(rm, dict):
                continue
            rm_name = str(rm.get("name") or "").strip()
            if not rm_name:
                stats["skipped"] += 1
                continue

            # Room meta
            if rm_name not in room_meta:
                room_meta[rm_name] = {"floor_id": fl_id}
                color = rm.get("color")
                if color:
                    room_meta[rm_name]["color"] = str(color)

            # Room geometry: routed through the FabricStore's correction
            # choke point, merge-only — an import can add a new room but
            # never overwrite existing (possibly hand-corrected) fabric.
            points = rm.get("points") or []
            if _fab and isinstance(points, list) and len(points) >= 3:
                try:
                    pts_m = [[round(float(p[0]), 3), round(float(p[1]), 3)]
                             for p in points if isinstance(p, (list, tuple)) and len(p) >= 2]
                    if len(pts_m) >= 3:
                        res = await _fab.async_correct_room(
                            fl_id, rm_name,
                            {"type": "poly", "points_m": pts_m},
                            committed_by="external_import",
                        )
                        if res.get("ok"):
                            stats["rooms"] += 1
                        else:
                            stats["skipped"] += 1
                except Exception:
                    stats["skipped"] += 1

    # ── Nodes (scanner positions) ────────────────────────────────────────
    nodes_raw = data.get("nodes") or []
    if not isinstance(nodes_raw, list):
        nodes_raw = []

    positions = mdl.data.setdefault("scanner_positions_m", {})
    scanners = mdl.data.setdefault("scanners", {})

    for nd in nodes_raw:
        if not isinstance(nd, dict):
            continue
        nd_name = str(nd.get("name") or nd.get("id") or "").strip()
        nd_id = str(nd.get("id") or nd_name).strip().lower().replace(" ", "_")
        if not nd_name or not nd_id:
            stats["skipped"] += 1
            continue

        # Enabled check
        if nd.get("enabled") is False:
            stats["skipped"] += 1
            continue

        # Position [x, y, z] in metres
        point = nd.get("point") or []
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            stats["skipped"] += 1
            continue

        try:
            x_m = round(float(point[0]), 3)
            y_m = round(float(point[1]), 3)
            z_m = round(float(point[2]), 3) if len(point) > 2 else 2.4
        except (ValueError, TypeError):
            stats["skipped"] += 1
            continue

        # Determine floor from node's floor assignment or z coordinate
        nd_floors = nd.get("floors") or []
        fl_id = nd_floors[0] if isinstance(nd_floors, list) and nd_floors else DEFAULT_FLOOR_ID

        # Determine room from node position (check which room polygon contains the point)
        room = ""
        for rm_name, geo in mdl.room_geometry_m().items():
            if geo.get("floor_id") != fl_id or geo.get("type") != "poly":
                continue
            pts = geo.get("points_m") or []
            if _point_in_polygon(x_m, y_m, pts):
                room = rm_name
                break

        # Use ESPresense source naming (matches MQTT topic espresense/rooms/{id})
        source = f"espresense_{nd_id}"

        positions[source] = {
            "x_m": x_m,
            "y_m": y_m,
            "z_m": z_m,
            "floor_id": fl_id,
            "origin": "espresense_import",
        }

        # Also add to scanners dict for auto-sync
        if source not in scanners or scanners[source].get("source_type") != "manual":
            scanners[source] = {
                "room": room or nd_name,
                "floor_id": fl_id,
                "source_type": "espresense_import",
            }

        stats["scanners"] += 1

    # ── Save ─────────────────────────────────────────────────────────────
    await mdl.store.async_save(mdl.data)

    _LOGGER.info(
        "ESPresense Companion import: %d floors, %d rooms, %d scanners (%d skipped) from %s",
        stats["floors"], stats["rooms"], stats["scanners"], stats["skipped"], url,
    )

    connection.send_result(msg["id"], {
        "ok": True,
        **stats,
        "source": url,
    })


def _point_in_polygon(x: float, y: float, polygon: list) -> bool:
    """Ray-casting point-in-polygon test for [x,y] coordinate lists."""
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = float(polygon[i][0]), float(polygon[i][1])
        xj, yj = float(polygon[j][0]), float(polygon[j][1])
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside
