# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for occupancy estimation.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import voluptuous as vol
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_MODEL,
    DATA_OBJECT_HISTORY,
)
from .fabric_truth import cluster_count as _cluster_count
from .bluetooth_live import get_bluetooth_live
import time as _time


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
