# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for calibration points and the models trained on them.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .telemetry import bump as _bump
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DEFAULT_FLOOR_ID,
    OUTSIDE_FLOOR_ID,
    DATA_COORDINATOR,
    DATA_CALIBRATION,
    CALIBRATION_STORE_KEY,
    MODEL_STORE_KEY,
    FABRIC_STORE_KEY,
)
from .calibration_store import CalibrationStore
from .snapshot_builder import _live_snapshot
from .ws_backup import _auto_backup

_LOGGER = logging.getLogger(__name__)


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
        _bump(hass, "calibration_point_added")
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
