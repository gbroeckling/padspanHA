# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""The live snapshot: one build of every object the system currently sees, cached for a short TTL and shared by every view. This is the largest single piece of PadSpan and it has its own file for that reason.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
import time as _time
import asyncio
import time
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, State
from homeassistant.helpers import area_registry, device_registry, entity_registry
from homeassistant.util import dt as dt_util
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_OBJECTS,
    DATA_OBJECT_HISTORY,
    OBJECT_HISTORY_STORE_KEY,
    DATA_BEACON_LAST_MACS,
    DATA_COORDINATOR,
    DATA_CALIBRATION,
    DATA_TRACEBACK,
    DATA_ESPRESENSE_MQTT,
    DATA_DEVICE_REGISTRY,
)
from .bluetooth_live import get_bluetooth_live
from .private_ble_resolver import PrivateBLEResolver, get_resolver as _get_ble_resolver
from .ingest_policy import Identity as _IngestIdentity, IngestPolicy
from .beacon_identity import decide_split as _decide_beacon_split, rotation_bridge_allowed, same_device_by_address
from .ble_enrichment import enrich_object as _enrich_ble_object
from .presence_rules import away_timeout_s, is_away
from .ws_common import (
    _ALL_ADDR_CAP,
    _DATA_SNAPSHOT_CACHE,
    _DATA_SNAPSHOT_CACHE_LOCK,
    _DEFAULT_IBEACON_UUIDS,
    _SNAPSHOT_CACHE_TTL_S,
    _XREF_ADDR_SAMPLE,
    _capped_mac_history,
    _get_settings,
    _invalidate_snapshot_cache,  # noqa: F401  re-exported: the cache is owned here
    _is_rpa_addr,
    _object_history_ttl_s,
)

_LOGGER = logging.getLogger(__name__)


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
        from .presence_rules import excluded_sources  # noqa: PLC0415

        _st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS, None)
        _settings_d = (_st.data if _st else {}) or {}
        lost_set     = _settings_d.get("lost_radios",     {}) or {}
        disabled_set = _settings_d.get("disabled_radios", {}) or {}
        # All three masks, not just the two that carry a UI badge. This set
        # decides which receivers may assign a room downstream, and it used to
        # omit `excluded_scanners` — so a receiver the user had explicitly
        # masked because it had physically MOVED went on placing objects.
        # lost_set/disabled_set stay separate below purely for the badges.
        _excluded_radio_srcs = set(excluded_sources(_settings_d))
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
        # One poll of memory per beacon identity. A pack keeps advertising the
        # same addresses; a rotator abandons each one after using it, so what
        # survived from last poll is what tells them apart. Read here, written
        # once the groups are built, so a mid-loop exception cannot leave a
        # half-updated view that makes the next poll's answer worse.
        _beacon_last_macs: dict[str, set[str]] = hass.data.get(DOMAIN, {}).get(DATA_BEACON_LAST_MACS) or {}
        _beacon_seen_now: dict[str, set[str]] = {}
        # Ingest policy — the single point that decides whether an advertiser
        # becomes an object at all. Rebuilt every poll, like the excluded-
        # scanner set, so a change takes effect on the next snapshot rather
        # than at the next restart. See ingest_policy.py for why this is a
        # module: the cost of a device is its churn RATE, and a site cannot
        # enumerate MACs that change every second.
        try:
            _st_ing = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
            _ingest = IngestPolicy.from_settings((_st_ing.data if _st_ing else {}) or {})
        except Exception:
            _ingest = IngestPolicy()
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
                    """Build a fingerprint from advertisement characteristics.

                    None for an advertiser that names its own identity: an
                    iBeacon carries UUID/major/minor, and iBeacon grouping —
                    with the persistence-based pack/rotator split — owns that
                    identity. Bridging those by fingerprint duplicated that
                    machinery with a weaker test and, on a four-pack of CP27s
                    sharing one fingerprint, chained live beacons into one
                    object; and once bridged they were EXCLUDED from iBeacon
                    grouping as "IRK-resolved", so the right identity never
                    got its turn.
                    """
                    manuf = rec.get("manufacturer_data") or {}
                    if manuf and PrivateBLEResolver.parse_ibeacon(manuf):
                        return None  # an iBeacon has an identity; the bridge is for anonymous rotators
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
                    else:
                        # A bridge is a HAND-OVER: the address it bridges from
                        # must have stopped. Two addresses live at once are two
                        # devices, whatever their fingerprints say — see
                        # beacon_identity.rotation_bridge_allowed.
                        _old_rec = ble_by_addr.get(cached_entry["addr"])
                        _old_age = _old_rec.get("age_s") if _old_rec else None
                        if rotation_bridge_allowed(
                                _old_age if isinstance(_old_age, (int, float)) else None).split:
                            continue
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
                    # Masked BEFORE the group is built, so a device rotating its
                    # address every 1.6 seconds costs nothing rather than being
                    # filtered out later at full price. Marked absorbed too, or
                    # it would simply reappear as a bare MAC object.
                    if _ingest.active and _ingest.is_masked(_IngestIdentity(
                            addr=addr, key=uuid_key, uuid=str(ib.get("uuid") or ""))):
                        ibeacon_addrs.add(addr)
                        continue
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
                # Recorded for EVERY identity, not only the ones that are
                # ambiguous today. A beacon showing one address this poll and
                # three the next is exactly the case the persistence test
                # exists for, and it can only answer if the quiet poll was
                # written down too.
                _recent_all = [
                    a for a in g["addrs"]
                    if (ble_by_addr.get(a, {}).get("age_s") or 9999) < 60
                ]
                _beacon_seen_now[uuid_key] = set(_recent_all)
                if len(g["addrs"]) > 1:
                    recent_macs = _recent_all
                    # One beacon wearing many addresses, or many beacons sharing
                    # one identity? The address heuristics below cannot tell
                    # those apart on their own — see beacon_identity.py — so the
                    # decision is made from whether the addresses PERSIST across
                    # polls, and the heuristics are what it falls back to before
                    # there is any history to read.
                    _all_rpa = all(_is_rpa_addr(m) for m in recent_macs) if recent_macs else False
                    _is_default_uuid = str(g.get("uuid") or "").lower() in _DEFAULT_IBEACON_UUIDS
                    _same_oui = len({m[:9] for m in recent_macs}) == 1 if len(recent_macs) > 1 else False
                    _split_decision = _decide_beacon_split(
                        recent_macs,
                        _beacon_last_macs.get(uuid_key),
                        all_rpa=_all_rpa,
                        default_uuid=_is_default_uuid,
                        same_oui=_same_oui,
                    )
                    _resolver_diag.setdefault("split_reasons", {})[uuid_key[:48]] = _split_decision.reason
                    if _split_decision.split:
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
            # Commit this poll's view for the next one to compare against.
            # Only identities seen this poll are carried forward, so a beacon
            # that goes away stops occupying memory and is treated as new when
            # it returns — which is the right answer after an unknown gap.
            if _beacon_seen_now:
                hass.data.setdefault(DOMAIN, {})[DATA_BEACON_LAST_MACS] = _beacon_seen_now
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
            # A device with no beacon identity can still be masked — by its own
            # MAC if it is static, or by vendor prefix. Checked here as well as
            # at the iBeacon grouping because these are two separate ways to
            # become an object, and a mask that only covered one of them would
            # look like it had stopped working.
            if _ingest.active:
                canonical_for_mask = canonical_by_addr.get(addr) or {}
                if _ingest.is_masked(_IngestIdentity(
                        addr=addr,
                        key=str(canonical_for_mask.get("canonical_id") or ""),
                        name=str(rec.get("name") or ""))):
                    continue
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
            # — and that a guess is not an identity: a device link found under
            # one of its addresses does not make the bridge "identified".
            if canonical.get("bridge_match"):
                obj_pb["bridge_match"] = True
                obj_pb["identified"] = False
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
            # A bridge is a per-poll INFERENCE ("this new address is probably
            # that phone"), not an identity. It must never be immortalised:
            # a CP27 beacon that was once wrongly bridged sat in this cache
            # for 20 hours as "Private BLE: 1 device tracked", identified by
            # PadSpan's own device link, resurrected every poll. A cached
            # bridge expires like any unidentified object — and if its
            # address is on the air right now under a real identity (an
            # iBeacon group owns it), it is a ghost of a superseded guess and
            # goes at once.
            if cached_obj.get("bridge_match"):
                _ghost_addr = str(cached_obj.get("address") or key).upper()
                if _ghost_addr in ibeacon_addrs or _ghost_addr in ble_by_addr:
                    del _cache[key]
                    continue
                if stale_s > _HISTORY_TTL:
                    del _cache[key]
                    continue
                cached_obj.pop("identified", None)
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
                # The LIVE one is primary — freshest first, RSSI only to break
                # a tie. Sorting by RSSI let a stale cached ghost, whose RSSI
                # was frozen at whatever it last was, win over the object that
                # is actually advertising, and the live one was absorbed into
                # the ghost every poll.
                _grp.sort(key=lambda o: ((o.get("age_s") if o.get("age_s") is not None else 1e9),
                                         -(o.get("rssi") if o.get("rssi") is not None else -999)))
                _primary = _grp[0]
                for _sec in _grp[1:]:
                    # A label is a display string, NOT an identity. Two objects
                    # are one device only if they share an ADDRESS — the case
                    # this pass exists for (a bare MAC and its iBeacon key). A
                    # beacon multi-pack split per MAC merely shares an inherited
                    # label, and merging it here silently undid the split.
                    if not same_device_by_address(_primary, _sec):
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
                # What the ingest policy hid this poll, and why. A mask that
                # cannot be seen is indistinguishable from a bug, and this is
                # also the number that answers "what is it saving me".
                "ingest": _ingest.diagnostics(),
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
            _MERGE_KEYS = ("x_m", "y_m", "floor_id", "knn_confidence",
                           "room", "room_confidence", "rssi_margin_confidence",
                           "outside", "_smoothed", "_stale")
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

    # ── `room` is PRESENT TENSE, once, here ──────────────────────────────────
    # An object keeps its last known room forever, which is deliberate: it is
    # how "last seen in the Garage" survives a dropout. But leaving that value
    # in `room` meant every surface that printed the field asserted the device
    # was THERE, and each one had to remember to check the age. They did not:
    # the same car showed as being in the Garage on five separate surfaces,
    # hours after it left, while its own entities correctly read not_home —
    # and each was fixed only when someone happened to spot it.
    #
    # So the snapshot answers it instead of asking every caller to. A departed
    # object has no current room; where it was last seen moves to `last_room`,
    # and `away` says so outright. Anything that reads `room` is now correct by
    # construction, including code not written yet.
    try:
        _away_s = away_timeout_s(hass)
        for _obj in (snap.get("objects") or {}).get("list") or []:
            if not is_away(_obj, _away_s):
                continue
            if _obj.get("room"):
                _obj["last_room"] = _obj["room"]
            _obj["room"] = ""
            _obj["away"] = True
    except Exception as _away_err:
        _LOGGER.warning("Away marking failed: %s", _away_err, exc_info=True)

    # Rebuild room_tag_map from overlaid objects so the map matches the
    # presence coordinator's smoothed room assignments (spatial centroid).
    # Without this, the map uses pre-overlay raw RSSI rooms while the
    # object list uses post-overlay smoothed rooms → mismatch.
    # A room lists who is IN it. An object keeps its last known room forever —
    # that is deliberate, it is how "last seen in the Garage" survives a
    # dropout — but occupancy is a present-tense question, so anything past the
    # away timeout is not an occupant. Without this filter a car that left an
    # hour ago stayed listed in the Garage beside devices seen 20 seconds ago.
    try:
        _away_s = away_timeout_s(hass)
        _rtm_fresh: dict[str, list[str]] = {}
        for _obj in (snap.get("objects") or {}).get("list") or []:
            _r = _obj.get("room")
            _eid = _obj.get("entity_id") or _obj.get("key") or ""
            if _r and _eid and not is_away(_obj, _away_s):
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
    # Objects now have x_m, y_m, floor_id, room (smoothed),
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
