# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for diagnostics: system critics, propagation health, positioning diagnostics, HA entity audit.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import device_registry, entity_registry
from homeassistant.util import dt as dt_util
from .const import (
    DOMAIN,
    VERSION,
    DATA_SETTINGS,
    DATA_MAPS,
    DATA_MODEL,
    DATA_CALIBRATION,
    DATA_ADAPTIVE,
    GRADE_A_ERROR_M,
    GRADE_B_ERROR_M,
    GRADE_C_ERROR_M,
    GRADE_NO_DATA_ERROR_M,
    CRITIC_CRITICAL_ERROR_M,
    CRITIC_WARNING_ERROR_M,
)
from .bluetooth_live import get_bluetooth_live
from .quiet_errors import listing as _quiet_listing, note as _quiet_error

_LOGGER = logging.getLogger(__name__)


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
                _quiet_error("ws_diagnostics:auto_diagnostics")
                pass
        if room_count:
            checks.append({"name": "room_tag_map", "ok": True, "detail": f"{room_count} rooms loaded ({room_source})"})
        else:
            checks.append({"name": "room_tag_map", "ok": False, "detail": "No room/tag data loaded"})
            recs.append("Draw your rooms in Mapping (Edit or Layout) so PadSpan has rooms to place devices in.")
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
        _quiet_error("ws_diagnostics:positioning_diag")
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
        _quiet_error("ws_diagnostics:propagation_areas")
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
            await calib.async_prepare_model()     # its leave-one-out in the executor
            model = calib.compute_model(maps_data)
            loo = model.get("loo_accuracy")
            if loo:
                accuracy = {"mean_error_m": loo.get("mean_error_m", 0)}
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
        recs.append({"text": "Enable adaptive learning in Settings \u2192 Tracking to automatically improve accuracy over time", "priority": "low"})
    if floor_sep["pairs"] == 0 and total_rooms > 3:
        recs.append({"text": "No cross-floor data yet — enable floor detection enhancement in Settings \u2192 Tracking", "priority": "low"})
    recs = recs[:10]  # cap at 10

    # ── Grade computation ──
    acc_val = accuracy.get("mean_error_m", GRADE_NO_DATA_ERROR_M)
    grade = "F"
    if coverage_pct >= 0.8 and acc_val < GRADE_A_ERROR_M and avg_variance < 15 and (floor_sep["sufficient"] or floor_sep["pairs"] == 0):
        grade = "A"
    elif coverage_pct >= 0.6 and acc_val < GRADE_B_ERROR_M:
        grade = "B"
    elif coverage_pct >= 0.4 and acc_val < GRADE_C_ERROR_M:
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

    # Held-out accuracy (heldout.py), shown beside the score; the grade
    # above is unchanged by it. The cached result: a stale one is redone in
    # the background, never while this waits.
    heldout = None
    _pc = domain.get("presence_coordinator")
    if calib and _pc is not None and hasattr(_pc, "heldout_cached"):
        try:
            heldout = _pc.heldout_cached()
        except Exception:
            _quiet_error("ws_diagnostics:propagation_heldout")
            heldout = None

    connection.send_result(msg["id"], {
        "grade": grade,
        "coverage_pct": coverage_pct,
        "accuracy": accuracy,
        "heldout": heldout,
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
            "kalman_q": settings.get("kalman_q", 3.0),
            "kalman_r": settings.get("kalman_r", 8.0),
            "adaptive_enabled": bool(settings.get("adaptive_learning_enabled")),
            "adaptive_maturity": ad.maturity() if ad else 0,
        },
    })


@websocket_api.websocket_command({"type": "padspan_ha/system_critics"})
@websocket_api.async_response
async def ws_system_critics(hass: HomeAssistant, connection, msg) -> None:
    """Phase 4: unified system self-diagnosis.

    Collects diagnostics from every data source and emits a flat list of
    critic messages sorted by severity, plus a room-confusion matrix.

    Each critic is written for the person who owns the house (2026-11-21):
    `title` says what they would notice, `message` why, `action` what to do,
    and `detail` keeps the measurements and the engineer's terms (LOO error,
    RSSI variance, agreement, fabric) for anyone who wants them. `go`, where
    the panel has a screen that fixes it, names that screen: {"to": "measure",
    "map_id"}, {"to": "calibrate", "map_id"?}, {"to": "layout", "floor_id"},
    {"to": "receivers", "source"} or {"to": "adaptive_learning"} (health.js
    opens it). Severity follows the house's stage: what a house still being
    set up simply hasn't done yet (no calibration, a plan just uploaded) is
    its next step, "info", never a critical problem.
    """
    from datetime import datetime, timezone as _tz  # noqa: PLC0415
    import math as _math  # noqa: PLC0415

    domain = hass.data.get(DOMAIN, {})
    ad = domain.get(DATA_ADAPTIVE)
    calib = domain.get(DATA_CALIBRATION)
    maps_store = domain.get(DATA_MAPS)
    st = domain.get(DATA_SETTINGS)
    settings: dict[str, Any] = (st.data if st else {}) or {}

    critics: list[dict[str, Any]] = []

    def _floor_name(fid: str) -> str:
        """A floor as people know it: its Home Assistant name, not the id."""
        if fid == "__outside__":
            return "Outside"
        data = getattr(domain.get(DATA_MODEL), "data", None)
        floors = data.get("floors") if isinstance(data, dict) else None
        for f in floors if isinstance(floors, list) else []:
            if isinstance(f, dict) and str(f.get("id") or f.get("floor_id") or "") == str(fid):
                return str(f.get("name") or fid)
        return str(fid)

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
                "title": f"{room_a} and {room_b} get mixed up",
                "message": (
                    f"PadSpan keeps moving devices back and forth between {room_a} and {room_b}, "
                    "so someone in one of them is often shown in the other."
                ),
                "action": (
                    f"Calibrate in both {room_a} and {room_b}, mostly near where they meet. "
                    "If a wall separates them, draw it as a signal wall on the floor plan."
                ),
                "detail": f"{count} moves back and forth, {rate:.0%} of all room changes.",
                "go": {"to": "calibrate"},
            })

    # ── 2. Per-Map Quality (LOO cross-validation) ─────────────────────────────
    per_map_quality: list[dict[str, Any]] = []
    if calib:
        try:
            maps_data = maps_store.list_maps() if maps_store else []
            await calib.async_prepare_model()     # its leave-one-out in the executor
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
                    "mean_error_m": loo["mean_error_m"] if loo else None,
                    "max_error_m": loo["max_error_m"] if loo else None,
                }
                per_map_quality.append(entry)

                # Generate critic if LOO error is high
                if loo:
                    err_m = loo.get("mean_error_m", 0)
                    if err_m >= CRITIC_CRITICAL_ERROR_M:
                        severity = "critical"
                    elif err_m >= CRITIC_WARNING_ERROR_M:
                        severity = "warning"
                    else:
                        continue  # acceptable
                    critics.append({
                        "category": "map_quality",
                        "severity": severity,
                        "title": f"Positions on \u201c{map_name}\u201d are often off",
                        "message": (
                            "When PadSpan checks this plan's calibration points against each other, "
                            f"it places them about {err_m:.1f} m from where they were taken."
                        ),
                        "action": (
                            f"Calibrate more spots on \u201c{map_name}\u201d, mostly where there are few, "
                            "and check that the rooms are drawn where the walls really are."
                        ),
                        "detail": (
                            f"Leave-one-out mean error {err_m:.2f} m, "
                            f"worst {loo.get('max_error_m', 0):.2f} m, "
                            f"from {point_count} calibration points."
                        ),
                        "go": {"to": "calibrate", "map_id": mid},
                    })
                elif point_count < 5:
                    critics.append({
                        "category": "map_quality",
                        "severity": "info",
                        "title": f"\u201c{map_name}\u201d has few calibration points",
                        "message": (
                            f"It has {point_count} so far. From 5, PadSpan can check how "
                            "accurate positions on this plan are."
                        ),
                        "action": f"Calibrate a few more spots on \u201c{map_name}\u201d.",
                        "detail": "Leave-one-out validation needs at least 5 points.",
                        "go": {"to": "calibrate", "map_id": mid},
                    })
        except Exception:
            _quiet_error("ws_diagnostics:critics_map_quality")
            pass

    # ── 2b. Map geometry self-consistency ────────────────────────────────────
    # A map whose stored scale and stored placement no longer describe the same
    # thing. Nobody notices this by looking at the map — it shows up as rooms
    # drawn in the wrong place on a DIFFERENT floor, because one bad map can
    # anchor the whole house. It took a user's screenshots to find it the first
    # time (issue #62); this is so an install can say it itself.
    try:
        from . import fabric_truth as _ft  # noqa: PLC0415
        _ms = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        _mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        if _ms and _mdl:
            _maps_list = _ms.data.get("maps") or []
            _maps_by_id = {str(m.get("id") or ""): m for m in _maps_list if isinstance(m, dict)}
            for _f in _ft.map_geometry_faults(_maps_list, _mdl):
                # The terms the GATE fired on, named by the gate. Re-deriving
                # them from the numbers here was a second copy of the
                # thresholds, and it was the copy left behind whenever the
                # gate moved.
                #
                # FOUR OF THEM ARE GONE. `iso`, `displacement`, `scale` and
                # `origin` each measured a gap between a map's two stored
                # placements, and there is one placement now — so all four
                # read zero on every install, forever, and a sentence built
                # out of them would be a critical warning with nothing in the
                # middle of it. The two that remain are about the record
                # alone, and the third is about the house.
                _terms = _f.get("terms") or []
                if "no_world_frame" in _terms:
                    _first = next(iter(_maps_by_id), "")
                    critics.append({
                        "category": "map_geometry",
                        "severity": "critical",
                        "title": "No floor plan has a scale, so the map stays empty",
                        "message": (
                            "Rooms, receivers and plans are drawn in metres, and no plan "
                            "has been measured yet, so PadSpan can't tell how big anything "
                            "is. It shows nothing rather than guess a size."
                        ),
                        "action": (
                            "Measure one distance you know on any floor plan, such as a "
                            "doorway or a wall. One measurement gives the whole house its scale."
                        ),
                        "detail": (
                            "Plans are placed, but none has a measurement against a known "
                            "distance, so there is no metre scale for the house."
                        ),
                        "go": {"to": "measure", "map_id": _first},
                    })
                    continue
                if "unreadable" in _terms:
                    critics.append({
                        "category": "map_geometry",
                        "severity": "critical",
                        "title": f"PadSpan can't read where “{_f['name']}” goes",
                        "message": (
                            "This plan's saved size or position is damaged, so PadSpan "
                            "can't place it in the house or tell how big it is. Rooms drawn "
                            "on it have no size until it is measured again."
                        ),
                        "action": "Measure this plan again: mark two points a known distance apart.",
                        "detail": (
                            "The stored placement is not a placement: a scale is missing, "
                            "empty, zero or not a number, or the two axes lie on one line. "
                            "Saving a scale on a build before 0.37 could write one of these."
                        ),
                        "go": {"to": "measure", "map_id": _f["map_id"]},
                    })
                    continue
                if "unplaced" in _terms:
                    # Nothing drawn on it yet: a plan just uploaded, whose next
                    # step is its scale. Rooms or receivers on it that can't be
                    # drawn are a real problem.
                    _m = _maps_by_id.get(str(_f["map_id"])) or {}
                    _used = bool(_m.get("room_bounds") or _m.get("receivers"))
                    critics.append({
                        "category": "map_geometry",
                        "severity": "warning" if _used else "info",
                        "title": (f"“{_f['name']}” has rooms or receivers but no scale" if _used
                                  else f"Next step: set the scale of “{_f['name']}”"),
                        "message": (
                            "Rooms or receivers are drawn on this plan, but it was never "
                            "measured or lined up with another plan, so none of it can be "
                            "shown in the house." if _used else
                            "This plan isn't measured yet, so it has no size and can't be "
                            "drawn. That is normal for a plan that has just been uploaded."
                        ),
                        "action": (
                            "Measure one distance you know on it, such as a doorway, or line "
                            "it up over a plan that is already measured (Mapping → 3D Stack, "
                            "then Save Alignment)."
                        ),
                        "detail": "No placement is stored for this plan.",
                        "go": {"to": "measure", "map_id": _f["map_id"]},
                    })
    except Exception:
        _quiet_error("ws_diagnostics:critics_geometry")
        pass

    # ── 2c. Room footprint vs. map scale ─────────────────────────────────────
    # A map can be perfectly self-consistent (2b clean) and still be the
    # WRONG size, if it was fixed after its rooms were already built from it.
    # Rooms are traced once and kept independently of the map forever, so a
    # correct map today says nothing about whether it was correct when these
    # rooms were made. Issue #62, same install, the other half of the bug.
    try:
        if _ms and _mdl:
            for _rf in _ft.room_footprint_faults(_mdl.room_geometry_m(), _ms.data.get("maps") or [], _mdl):
                _oversized = "oversized" in _rf["terms"]
                critics.append({
                    "category": "room_footprint",
                    "severity": "critical" if _oversized else "warning",
                    "title": f"The rooms on {_floor_name(_rf['floor_id'])} don’t fit “{_rf['map_name']}”",
                    "message": (
                        "The rooms on this floor cover more ground than the plan they were "
                        "drawn on. The plan's scale most likely changed after the rooms were drawn."
                        if _oversized else
                        "The rooms on this floor are much smaller than the plan they were drawn "
                        "on, as if they were drawn while the plan had a different scale that "
                        "was corrected since."
                    ),
                    "action": (
                        "Don't redraw the rooms by hand to make up for it. In Mapping → Layout, "
                        "pick “Map placements” in its Layout row to see the rooms as the plan's "
                        "scale places them; if that looks right, Save keeps it."
                    ),
                    "detail": (
                        f"Rooms span {_rf['room_w_m']}m × {_rf['room_h_m']}m; "
                        f"“{_rf['map_name']}” measures {_rf['map_w_m']}m × {_rf['map_h_m']}m "
                        f"({round(_rf['footprint_frac']*100)}% of the map on its worst axis). "
                        "Saving replaces the committed room fabric for this floor."
                    ),
                    "go": {"to": "layout", "floor_id": _rf["floor_id"]},
                })
    except Exception:
        _quiet_error("ws_diagnostics:critics_room_footprint")
        pass

    # ── 2d. Room trace vs. committed fabric — group divergence ───────────────
    # The two records of a floor's rooms (the map's hand trace, the committed
    # fabric) can drift apart as a group when either predates a change to the
    # map — a placement fix the fabric never followed, or an image op the
    # trace missed (a measured-map trim before 0.38.10 renormalized every
    # fraction on the map EXCEPT the trace). Per-room disagreement is hand
    # editing; the same factor on every room is a stale record. Issue #62,
    # third act: rjbutler's trimmed floors previewed wrong because the trace
    # was still in pre-trim image space, and nothing said so.
    try:
        if _ms and _mdl:
            for _dv in _ft.room_divergence_faults(_mdl.room_geometry_m(), _ms.data.get("maps") or [], _mdl):
                critics.append({
                    "category": "room_divergence",
                    "severity": "warning",
                    "title": f"The two copies of the rooms on “{_dv['map_name']}” disagree",
                    "message": (
                        "The rooms traced on this plan and the rooms PadSpan saved for its floor "
                        "all differ by the same amount, so one of the two is out of date: the "
                        "plan was measured again, or its picture was trimmed or turned, after "
                        "the other was saved."
                    ),
                    "action": (
                        "In Mapping → Layout, compare its Layout row's “Saved layout” and "
                        "“Map placements” over the floor plan, and keep the one that matches "
                        "the picture. If “Map placements” matches, save it. If “Saved layout” "
                        "matches, the tracing is out of date: upload this plan's original "
                        "picture again (Mapping → Edit → Replace image), check the tracing sits "
                        "right on it, then trim it again."
                    ),
                    "detail": (
                        f"{len(_dv['rooms'])} rooms are in both this map's trace and the "
                        f"committed fabric, each differing by the same factor "
                        f"(×{_dv['ratio_x']} across, ×{_dv['ratio_y']} down). From 0.38.10 the "
                        "trace follows every image edit."
                    ),
                    "go": {"to": "layout", "floor_id": _dv["floor_id"]},
                })
    except Exception:
        _quiet_error("ws_diagnostics:critics_room_divergence")
        pass

    # ── 3. Scanner Disagreement (from coordinator Phase 3 data) ───────────────
    scanner_critics: list[dict[str, Any]] = []
    # The presence coordinator holds the reliability figures; the config
    # holder ('coordinator') has none, so this section never ran.
    pc = domain.get("presence_coordinator")
    if pc and hasattr(pc, "_scanner_reliability"):
        # Get live radio names for friendly display
        live_radios: list[dict[str, Any]] = []
        try:
            from .snapshot_builder import _live_snapshot  # noqa: PLC0415
            live_radios = ((await _live_snapshot(hass)).get("ble") or {}).get("radios") or []
        except Exception:
            _quiet_error("ws_diagnostics:critics_live_radios")
            pass
        radio_name_map: dict[str, str] = {}
        for _r in live_radios:
            _src = _r.get("source") or ""
            _nm = _r.get("name") or _r.get("area_name") or _r.get("area") or ""
            if _src and _nm:
                radio_name_map[_src] = _nm

        for src, rel in pc._scanner_reliability.items():
            q = pc._scanner_agree.get(src)
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
                "title": f"Receiver \u201c{name}\u201d often points to the wrong room",
                "message": (
                    "It often disagrees with the other receivers about which room a device "
                    "is in, so it can pull people and things into the wrong room."
                ),
                "action": (
                    f"Check that \u201c{name}\u201d is in the right room in Home Assistant, and where "
                    "and which way up it is mounted. If it hears devices louder or quieter than "
                    "it should, change its signal adjustment on the Receivers page."
                ),
                "detail": (
                    f"Reliability {rel:.2f}: {agree_pct:.0f}% agreement with the consensus "
                    f"room over {polls} polls. The signal adjustment is its RSSI offset "
                    "(also in Settings \u2192 Tracking \u2192 Receivers)."
                ),
                "go": {"to": "receivers", "source": src},
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
                            "title": "Calibration is out of date",
                            "message": (
                                f"The last calibration was {stale_days} days ago. Moved furniture "
                                "and new devices change how signals travel, so rooms can drift."
                            ),
                            "action": "Walk the house and calibrate again.",
                            "detail": f"Newest calibration point: {stale_days} days old (a warning after 90).",
                            "go": {"to": "calibrate"},
                        })
                    elif stale_days > 60:
                        critics.append({
                            "category": "calibration",
                            "severity": "info",
                            "title": "Calibration is getting old",
                            "message": (
                                f"The last calibration was {stale_days} days ago. Moved furniture "
                                "and new devices change how signals travel."
                            ),
                            "action": "Calibrate again some time soon to keep rooms accurate.",
                            "detail": f"Newest calibration point: {stale_days} days old (a note after 60).",
                            "go": {"to": "calibrate"},
                        })
                except Exception:
                    _quiet_error("ws_diagnostics:critics_calibration_age")
                    pass
        elif not points:
            # Not a fault: a house that hasn't calibrated yet still gets its
            # rooms from the nearest receiver. It is the next step, said as one
            # (2026-11-21; it was "critical" on every new install).
            critics.append({
                "category": "calibration",
                "severity": "info",
                "title": "Next step: calibrate",
                "message": (
                    "Rooms come from the nearest receiver for now. Calibrating teaches PadSpan "
                    "what each spot in your home sounds like, so it tells rooms next to each "
                    "other apart better."
                ),
                "action": "Walk around the house with your phone in \U0001f9ed Guided calibration.",
                "detail": (
                    "No calibration points yet: positions come from adaptive learning "
                    "and the default signal model only."
                ),
                "go": {"to": "calibrate"},
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
                    "title": f"Signals in {room_name} keep changing",
                    "message": (
                        f"What the receivers hear in {room_name} varies a lot, so {room_name} is "
                        "harder to tell apart from the rooms around it."
                    ),
                    "action": (
                        f"Look for things near {room_name} that interfere, such as Wi-Fi routers, "
                        "microwaves and USB 3 devices, and calibrate a few more spots in it."
                    ),
                    "detail": (
                        f"Room fingerprint unstable: average RSSI variance {avg_var:.1f} dBm\u00b2 "
                        "(target under 15)."
                    ),
                    "go": {"to": "calibrate"},
                })

        if not settings.get("adaptive_learning_enabled") and total_obs == 0:
            critics.append({
                "category": "propagation",
                "severity": "info",
                "title": "Learning from everyday use is off",
                "message": (
                    "PadSpan isn't learning from the rooms it is sure of, so it won't get "
                    "better by itself over time."
                ),
                "action": "Turn on Adaptive Learning in Settings \u2192 Tracking.",
                "detail": "Adaptive learning is disabled and has no observations.",
                "go": {"to": "adaptive_learning"},
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
        _quiet_error("ws_diagnostics:audit_automations")
        pass
    try:
        from homeassistant.components.script import scripts_with_entity  # noqa: PLC0415
        for eid in _padspan_eids:
            refs = scripts_with_entity(hass, eid)
            if refs:
                _script_users[eid] = list(refs)
    except Exception:
        _quiet_error("ws_diagnostics:audit_scripts")
        pass

    # Classify entity type from unique_id suffix. These suffixes are set at
    # entity-creation time, not here — "__tracker" (device_tracker.py),
    # "__area" / "__distance" (sensor.py's per-room area and distance
    # sensors), and "__dist__<scanner>" (sensor.py's per-scanner distance
    # sensors — one per scanner, hence its own embedded scanner id).
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
                _quiet_error("ws_diagnostics:audit_device")
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


@websocket_api.websocket_command({"type": "padspan_ha/quiet_errors"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_quiet_errors(hass: HomeAssistant, connection, msg) -> None:
    """Errors PadSpan handled quietly since Home Assistant started (quiet_errors.py):
    each site that fired, its count, and its last error with the time.

    Administrators only, and never part of any report: an error's text can
    name rooms and devices. The opt-in usage report carries the site names
    and counts alone (telemetry.build_payload).
    """
    connection.send_result(msg["id"], {"sites": _quiet_listing()})
