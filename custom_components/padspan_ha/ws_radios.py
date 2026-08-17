# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for scanner (radio) management.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry, device_registry
from homeassistant.util import dt as dt_util
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_COORDINATOR,
    DATA_ADAPTIVE,
)
from .bluetooth_live import get_bluetooth_live
from .ws_calibration import _get_cal_store
from .ws_common import _invalidate_snapshot_cache

_LOGGER = logging.getLogger(__name__)


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
    fabric_positions = mdl.scanner_positions_m() if mdl else {}

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
