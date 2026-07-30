# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Model Store
==========================
Global spatial model: floors, per-room metadata, positioning fabric, and
real-world spatial geometry.

Deliberately separate from MapsStore because:
- Floors and room_meta are shared across ALL maps (a room exists independently
  of which map it appears on).
- Maps are per-image resources with their own metadata.
- The spatial model (scanner positions, room geometry, RF barriers) lives here
  in real-world metres so it survives map image replacement.

Data layout in .storage/padspan_ha.model:
  {
    "floors": [{"id": "main", "name": "Main Floor"}, ...],
    "room_meta": {"Kitchen": {"floor_id": "main", "color": "#7a9b5c"}, ...},
    "scanners": {...},               # Phase 1: source→room fabric
    "room_adjacency": {...},         # Phase 1: room→[neighbors]
    "fabric_sync_mode": "auto",      # Phase 1: "auto" | "manual"
    "scanner_positions_m": {...},     # Phase 2: source→{x_m, y_m, z_m, floor_id}
    "room_geometry_m": {...},         # Phase 2: room→{type, points_m/cx_m/..., floor_id}
    "rf_barriers_m": [...],           # Phase 2: [{points_m, attenuation_dbm, floor_id}]
    "map_transforms": {...},          # Phase 2: map_id→affine (frac↔metres)
  }

Room colours are deterministically generated from the room name (SHA-256 hash →
pastel RGB) so they're stable across sessions without needing explicit assignment.
"""

import asyncio
import hashlib
import math
import re
from dataclasses import dataclass, field
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import MODEL_STORE_KEY, DEFAULT_FLOOR_ID
from .safe_store import wrap_store


def _slug(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "floor"


def _hash_color_hex(name: str) -> str:
    # Stable, pleasant-ish pastel palette from hash (not too dark).
    h = hashlib.sha256(name.encode("utf-8")).hexdigest()
    # Use first bytes to pick hue-ish RGB.
    r = 64 + (int(h[0:2], 16) % 160)
    g = 64 + (int(h[2:4], 16) % 160)
    b = 64 + (int(h[4:6], 16) % 160)
    return f"#{r:02x}{g:02x}{b:02x}"


DEFAULT_DATA: dict[str, Any] = {
    "floors": [
        {"id": DEFAULT_FLOOR_ID, "name": "Main Floor"},
    ],
    "room_meta": {
        # roomName: { floor_id, color }
    },
    # ── Positioning fabric (Phase 1 decoupling) ──────────────────────────────
    "scanners": {
        # source_name: { room, floor_id, source_type }
        # source_type: "ha_sync" (auto-populated from HA) | "manual" (user-set)
    },
    "room_adjacency": {
        # room_name: [neighbor_room_name, ...]
    },
    "fabric_sync_mode": "auto",  # "auto" = sync from HA, "manual" = standalone
    # ── Phase 2: Real-world spatial model (metres) ───────────────────────────
    "scanner_positions_m": {
        # source_name: { x_m, y_m, z_m, floor_id, origin, map_id }
    },
    "room_geometry_m": {
        # room_name: { type, floor_id, origin, points_m | cx_m/cy_m/r_m }
    },
    "rf_barriers_m": [
        # { name, material, attenuation_dbm, floor_id, points_m, origin, map_id }
    ],
    "map_transforms": {
        # map_id: { origin_x_m, origin_y_m, scale_x_m, scale_y_m, rotation_rad, floor_id }
    },
    "beacon_positions_m": {
        # beacon_key: { x_m, y_m, floor_id, room, kind, label, origin, map_id }
    },
}


@dataclass
class ModelStore:
    hass: HomeAssistant
    store: Store
    data: dict[str, Any] = field(default_factory=lambda: dict(DEFAULT_DATA))

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._raw_store = Store(hass, 1, MODEL_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "model")
        self.data = dict(DEFAULT_DATA)

    async def async_setup(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            # Start from loaded data, then ensure required keys exist
            self.data = dict(loaded)
            # Ensure core keys
            if not isinstance(self.data.get("floors"), list):
                self.data["floors"] = list(DEFAULT_DATA["floors"])
            if not isinstance(self.data.get("room_meta"), dict):
                self.data["room_meta"] = {}
            # ── Migration: add fabric keys if absent (pre-Phase-1 stores) ────
            if not isinstance(self.data.get("scanners"), dict):
                self.data["scanners"] = {}
            if not isinstance(self.data.get("room_adjacency"), dict):
                self.data["room_adjacency"] = {}
            if self.data.get("fabric_sync_mode") not in ("auto", "manual"):
                self.data["fabric_sync_mode"] = "auto"
            # ── Migration: Phase 2 spatial model keys ────────────────────────
            if not isinstance(self.data.get("scanner_positions_m"), dict):
                self.data["scanner_positions_m"] = {}
            if not isinstance(self.data.get("room_geometry_m"), dict):
                self.data["room_geometry_m"] = {}
            if not isinstance(self.data.get("rf_barriers_m"), list):
                self.data["rf_barriers_m"] = []
            if not isinstance(self.data.get("map_transforms"), dict):
                self.data["map_transforms"] = {}
            if not isinstance(self.data.get("beacon_positions_m"), dict):
                self.data["beacon_positions_m"] = {}
        else:
            self.data = {k: (list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_DATA.items()}

        # Normalize floors
        norm_floors: list[dict[str, Any]] = []
        seen: set[str] = set()
        for f in self.data.get("floors", []):
            if not isinstance(f, dict):
                continue
            fid = str(f.get("id") or "").strip() or DEFAULT_FLOOR_ID
            if fid in seen:
                continue
            seen.add(fid)
            norm_floors.append({"id": fid[:40], "name": str(f.get("name") or fid)[:80]})
        if not norm_floors:
            norm_floors = list(DEFAULT_DATA["floors"])
        self.data["floors"] = norm_floors

        # Normalize room_meta
        rm: dict[str, Any] = {}
        for k, v in (self.data.get("room_meta") or {}).items():
            if not isinstance(k, str) or not isinstance(v, dict):
                continue
            room = k[:120]
            floor_id = str(v.get("floor_id") or DEFAULT_FLOOR_ID)[:40]
            color = str(v.get("color") or _hash_color_hex(room))[:20]
            rm[room] = {"floor_id": floor_id, "color": color}
        self.data["room_meta"] = rm

        # Only re-save on load if normalization actually changed something
        # This prevents overwriting fresh saves with stale data on reload
        import json
        if json.dumps(self.data, sort_keys=True) != json.dumps(loaded, sort_keys=True) if loaded else True:
            await self.store.async_save(self.data)

    def snapshot(self) -> dict[str, Any]:
        return {
            "floors": list(self.data.get("floors", [])),
            "room_meta": dict(self.data.get("room_meta", {})),
            "scanners": dict(self.data.get("scanners", {})),
            "room_adjacency": dict(self.data.get("room_adjacency", {})),
            "fabric_sync_mode": self.data.get("fabric_sync_mode", "auto"),
            "scanner_positions_m": dict(self.data.get("scanner_positions_m", {})),
            "room_geometry_m": dict(self.data.get("room_geometry_m", {})),
            "rf_barriers_m": list(self.data.get("rf_barriers_m", [])),
            "map_transforms": dict(self.data.get("map_transforms", {})),
            "beacon_positions_m": dict(self.data.get("beacon_positions_m", {})),
        }

    def floors(self) -> list[dict[str, Any]]:
        return list(self.data.get("floors", []))

    def room_meta(self) -> dict[str, dict[str, Any]]:
        return dict(self.data.get("room_meta", {}))

    # ── Fabric accessors ────────────────────────────────────────────────────

    def get_scanner_mappings(self) -> tuple[dict[str, str], dict[str, str]]:
        """Return (source_to_area, source_to_floor) from the scanners dict."""
        source_to_area: dict[str, str] = {}
        source_to_floor: dict[str, str] = {}
        for src, info in (self.data.get("scanners") or {}).items():
            if not isinstance(info, dict):
                continue
            room = info.get("room")
            if room:
                source_to_area[src] = str(room)
            fl = info.get("floor_id")
            if fl:
                source_to_floor[src] = str(fl)
        return source_to_area, source_to_floor

    def adjacency(self) -> dict[str, list[str]]:
        """Return room adjacency map: {room: [neighbor, ...]}."""
        return dict(self.data.get("room_adjacency") or {})

    def sync_mode(self) -> str:
        """Return fabric sync mode: 'auto' or 'manual'."""
        return self.data.get("fabric_sync_mode", "auto")

    async def async_set_scanner(self, source: str, room: str, floor_id: str, source_type: str = "manual") -> None:
        """Add or update a scanner in the fabric."""
        scanners = self.data.setdefault("scanners", {})
        scanners[str(source)] = {
            "room": str(room),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
            "source_type": str(source_type),
        }
        await self.store.async_save(self.data)

    async def async_remove_scanner(self, source: str) -> None:
        """Remove a scanner from the fabric."""
        scanners = self.data.get("scanners") or {}
        scanners.pop(str(source), None)
        await self.store.async_save(self.data)

    async def async_set_adjacency(self, room: str, neighbors: list[str]) -> None:
        """Set room neighbors (replaces existing list for this room)."""
        adj = self.data.setdefault("room_adjacency", {})
        adj[str(room)] = [str(n) for n in neighbors]
        await self.store.async_save(self.data)

    async def async_remove_adjacency(self, room: str) -> None:
        """Remove a room from the adjacency map (and from all neighbor lists)."""
        adj = self.data.get("room_adjacency") or {}
        adj.pop(str(room), None)
        # Also remove from other rooms' neighbor lists
        for k in list(adj):
            if str(room) in adj[k]:
                adj[k] = [n for n in adj[k] if n != str(room)]
        await self.store.async_save(self.data)

    async def async_set_sync_mode(self, mode: str) -> None:
        """Switch fabric sync mode: 'auto' or 'manual'."""
        if mode not in ("auto", "manual"):
            mode = "auto"
        self.data["fabric_sync_mode"] = mode
        await self.store.async_save(self.data)

    async def async_prune_non_radio_scanners(self, radio_sources: set[str]) -> int:
        """Remove ha_sync scanners that aren't in the set of actual BLE radio sources.

        Only prunes ha_sync entries; manual entries are preserved.
        Returns count of removed entries.
        """
        scanners = self.data.get("scanners") or {}
        to_remove = [
            src for src, info in scanners.items()
            if isinstance(info, dict)
            and info.get("source_type") == "ha_sync"
            and src not in radio_sources
        ]
        if to_remove:
            for src in to_remove:
                scanners.pop(src, None)
            await self.store.async_save(self.data)
        return len(to_remove)

    async def async_sync_from_snapshot(self, radios: list[dict]) -> None:
        """Compare BLE snapshot radios with stored scanners; update ha_sync entries.

        Only modifies entries with source_type='ha_sync'. Manual entries are preserved.
        Resolves floor_id from HA area registry (not just defaulting to "main").
        """
        # Build area_name→floor_id from HA registries
        _area_to_floor: dict[str, str] = {}
        try:
            from homeassistant.helpers import area_registry as _ar_mod
            for _a in _ar_mod.async_get(self.hass).async_list_areas():
                _fl = getattr(_a, "floor_id", None)
                if _a.name and _fl:
                    _area_to_floor[_a.name] = str(_fl)
        except Exception:
            pass

        scanners = self.data.setdefault("scanners", {})
        changed = False

        for r in (radios or []):
            src = r.get("source")
            area = r.get("area_name") or r.get("area")
            if not src or not area:
                continue
            src = str(src)
            area = str(area)
            existing = scanners.get(src)
            if existing and existing.get("source_type") == "manual":
                continue  # never overwrite manual entries
            floor_id = _area_to_floor.get(area, DEFAULT_FLOOR_ID)
            new_entry = {
                "room": area,
                "floor_id": floor_id,
                "source_type": "ha_sync",
            }
            if not existing or existing.get("room") != area or existing.get("floor_id") != floor_id:
                scanners[src] = new_entry
                changed = True

        if changed:
            await self.store.async_save(self.data)

    async def async_resync_clean(self) -> dict[str, int]:
        """Wipe all ha_sync scanner entries and rebuild from HA registries + snapshot.

        Preserves manual entries. Returns {removed, added}.
        Use this to fix stale/junk data in the fabric.
        """
        scanners = self.data.setdefault("scanners", {})
        # Remove all ha_sync entries
        removed = 0
        for src in list(scanners):
            if isinstance(scanners[src], dict) and scanners[src].get("source_type") == "ha_sync":
                scanners.pop(src)
                removed += 1
        # Re-sync from HA
        await self.async_sync_from_ha()
        added = sum(1 for s in scanners.values() if isinstance(s, dict) and s.get("source_type") == "ha_sync")
        await self.store.async_save(self.data)
        return {"removed": removed, "added": added}

    async def async_sync_from_ha(self) -> None:
        """Sync scanners from HA Area/Floor registries (startup path).

        Only syncs devices that are likely BLE proxies (ESPHome integrations
        with bluetooth capability). Preserves manual entries.
        """
        try:
            from homeassistant.helpers import (
                area_registry as ar_mod,
                device_registry as dr_mod,
            )
        except ImportError:
            return

        dr = dr_mod.async_get(self.hass)
        ar = ar_mod.async_get(self.hass)

        # Build area_id→name and area_id→floor_id maps
        area_id_to_name: dict[str, str] = {}
        area_id_to_floor: dict[str, str] = {}
        for a in ar.async_list_areas():
            area_id_to_name[a.id] = a.name
            fl = getattr(a, "floor_id", None)
            if fl:
                area_id_to_floor[a.id] = str(fl)

        # Build set of known BLE radio sources from existing snapshot-synced
        # scanners (the snapshot sync only adds actual radio sources)
        _known_radio_sources: set[str] = set()
        for src, info in (self.data.get("scanners") or {}).items():
            if isinstance(info, dict):
                _known_radio_sources.add(src)

        scanners = self.data.setdefault("scanners", {})
        changed = False

        # Only sync devices whose identifiers are ESPHome BLE proxies.
        # Filter: device must have an esphome or bluetooth-related integration.
        _BLE_DOMAINS = {"esphome", "bluetooth", "bluetooth_le_tracker"}
        for dev in dr.devices.values():
            if not dev.area_id:
                continue
            # Check if this device is from a BLE-relevant integration
            _dev_domains = {c[0] for c in (dev.identifiers or set())}
            _config_domains = {c for c in (dev.config_entries or set())}
            # Also check connections for MAC-based matching
            _has_ble_domain = bool(_dev_domains & _BLE_DOMAINS)

            # Fallback: if the device name/id matches a known radio source, include it
            src = dev.name_by_user or dev.name
            if not src:
                continue
            _is_known_radio = src in _known_radio_sources

            if not _has_ble_domain and not _is_known_radio:
                continue  # skip non-BLE devices

            area_name = area_id_to_name.get(dev.area_id)
            if not area_name:
                continue

            existing = scanners.get(src)
            if existing and existing.get("source_type") == "manual":
                continue  # preserve manual entries

            floor_id = area_id_to_floor.get(dev.area_id, DEFAULT_FLOOR_ID)
            new_entry = {
                "room": area_name,
                "floor_id": floor_id,
                "source_type": "ha_sync",
            }
            if not existing or existing != new_entry:
                scanners[src] = new_entry
                changed = True

        if changed:
            await self.store.async_save(self.data)

    # ── Phase 2: Real-world spatial model ────────────────────────────────────

    def scanner_positions_m(self) -> dict[str, dict[str, Any]]:
        """Return {source: {x_m, y_m, z_m, floor_id}} for all scanners."""
        return dict(self.data.get("scanner_positions_m") or {})

    def room_centroids_m(self) -> dict[str, tuple[float, float, str]]:
        """Compute room centroids in metres from room_geometry_m.

        Returns {room_name: (cx_m, cy_m, floor_id)}.
        """
        centroids: dict[str, tuple[float, float, str]] = {}
        for room, geo in (self.data.get("room_geometry_m") or {}).items():
            if not isinstance(geo, dict):
                continue
            fl = str(geo.get("floor_id", DEFAULT_FLOOR_ID))
            gtype = geo.get("type", "")
            if gtype == "circle":
                cx = float(geo.get("cx_m", 0))
                cy = float(geo.get("cy_m", 0))
                centroids[room] = (cx, cy, fl)
            elif gtype == "poly":
                pts = geo.get("points_m") or []
                if len(pts) >= 3:
                    cx = sum(float(p[0]) for p in pts) / len(pts)
                    cy = sum(float(p[1]) for p in pts) / len(pts)
                    centroids[room] = (cx, cy, fl)
        return centroids

    def rf_barriers_m(self) -> list[dict]:
        """Return RF barriers in real-world metres."""
        return list(self.data.get("rf_barriers_m") or [])

    def map_transform(self, map_id: str) -> dict | None:
        """Return the affine transform for a specific map, or None."""
        return (self.data.get("map_transforms") or {}).get(map_id)

    def has_spatial_model(self) -> bool:
        """Return True if real-world spatial data has been populated."""
        return bool(self.data.get("scanner_positions_m") or self.data.get("room_geometry_m") or self.data.get("beacon_positions_m"))

    # ── Coordinate conversion ─────────────────────────────────────────────

    def map_frac_to_metres(self, x_frac: float, y_frac: float, map_id: str) -> tuple[float, float] | None:
        """Convert map 0-1 fractions to real-world metres using stored transform."""
        t = (self.data.get("map_transforms") or {}).get(map_id)
        if not t:
            return None
        ox = float(t.get("origin_x_m", 0))
        oy = float(t.get("origin_y_m", 0))
        sx = float(t.get("scale_x_m", 1))
        sy = float(t.get("scale_y_m", 1))
        rot = float(t.get("rotation_rad", 0))
        # Apply: translate frac to centered, scale, rotate, offset
        dx = x_frac * sx
        dy = y_frac * sy
        if abs(rot) > 1e-9:
            cos_r = math.cos(rot)
            sin_r = math.sin(rot)
            rx = dx * cos_r - dy * sin_r
            ry = dx * sin_r + dy * cos_r
        else:
            rx, ry = dx, dy
        return (ox + rx, oy + ry)

    def metres_to_map_frac(self, x_m: float, y_m: float, map_id: str) -> tuple[float, float] | None:
        """Inverse: real-world metres to map 0-1 fractions."""
        t = (self.data.get("map_transforms") or {}).get(map_id)
        if not t:
            return None
        ox = float(t.get("origin_x_m", 0))
        oy = float(t.get("origin_y_m", 0))
        sx = float(t.get("scale_x_m", 1))
        sy = float(t.get("scale_y_m", 1))
        rot = float(t.get("rotation_rad", 0))
        # Reverse: remove offset, inverse rotate, inverse scale
        rx = x_m - ox
        ry = y_m - oy
        if abs(rot) > 1e-9:
            cos_r = math.cos(-rot)
            sin_r = math.sin(-rot)
            dx = rx * cos_r - ry * sin_r
            dy = rx * sin_r + ry * cos_r
        else:
            dx, dy = rx, ry
        if abs(sx) < 1e-9 or abs(sy) < 1e-9:
            return None
        return (dx / sx, dy / sy)

    # ── Spatial mutators ──────────────────────────────────────────────────

    async def async_set_scanner_position_m(
        self, source: str, x_m: float, y_m: float, z_m: float,
        floor_id: str, origin: str = "manual", map_id: str | None = None,
    ) -> None:
        """Set a scanner's real-world position."""
        positions = self.data.setdefault("scanner_positions_m", {})
        positions[str(source)] = {
            "x_m": float(x_m), "y_m": float(y_m), "z_m": float(z_m),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
            "origin": str(origin),
            "map_id": map_id,
        }
        await self.store.async_save(self.data)

    async def async_set_room_geometry_m(self, room: str, geometry: dict) -> None:
        """Set a room's real-world geometry (polygon or circle in metres)."""
        geo = self.data.setdefault("room_geometry_m", {})
        geo[str(room)] = dict(geometry)
        await self.store.async_save(self.data)

    async def async_set_rf_barrier_m(self, barrier: dict) -> None:
        """Add or replace an RF barrier in real-world metres (matched by name)."""
        barriers = self.data.setdefault("rf_barriers_m", [])
        name = barrier.get("name", "")
        # Replace existing barrier with same name
        self.data["rf_barriers_m"] = [b for b in barriers if b.get("name") != name]
        self.data["rf_barriers_m"].append(dict(barrier))
        await self.store.async_save(self.data)

    async def async_remove_rf_barrier_m(self, name: str) -> None:
        """Remove an RF barrier by name."""
        barriers = self.data.get("rf_barriers_m") or []
        self.data["rf_barriers_m"] = [b for b in barriers if b.get("name") != name]
        await self.store.async_save(self.data)

    async def async_set_map_transform(self, map_id: str, transform: dict) -> None:
        """Set the affine transform for a map (frac ↔ metres)."""
        transforms = self.data.setdefault("map_transforms", {})
        transforms[str(map_id)] = dict(transform)
        await self.store.async_save(self.data)

    # ── Beacon positions (metre space) ──────────────────────────────────────

    def beacon_positions_m(self) -> dict[str, dict[str, Any]]:
        """Return {beacon_key: {x_m, y_m, floor_id, room, kind, label}}."""
        return dict(self.data.get("beacon_positions_m") or {})

    async def async_set_beacon_position_m(
        self, key: str, x_m: float, y_m: float, floor_id: str,
        room: str = "", kind: str = "", label: str = "",
        origin: str = "manual", map_id: str | None = None,
    ) -> None:
        """Set a beacon's real-world position."""
        beacons = self.data.setdefault("beacon_positions_m", {})
        beacons[str(key)] = {
            "x_m": round(float(x_m), 3),
            "y_m": round(float(y_m), 3),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
            "room": str(room),
            "kind": str(kind),
            "label": str(label),
            "origin": str(origin),
            "map_id": map_id,
        }
        await self.store.async_save(self.data)

    async def async_remove_beacon_position_m(self, key: str) -> None:
        """Remove a beacon from metre-space positions."""
        beacons = self.data.get("beacon_positions_m") or {}
        beacons.pop(str(key), None)
        await self.store.async_save(self.data)

    def beacon_room_from_geometry(self, x_m: float, y_m: float, floor_id: str) -> str:
        """Determine which room a metre-space point falls in, using room_geometry_m."""
        for room, geo in (self.data.get("room_geometry_m") or {}).items():
            if not isinstance(geo, dict):
                continue
            if geo.get("floor_id") != floor_id:
                continue
            gtype = geo.get("type", "")
            if gtype == "poly":
                pts = geo.get("points_m") or []
                if len(pts) < 3:
                    continue
                # Ray-casting point-in-polygon
                inside = False
                n = len(pts)
                j = n - 1
                for i in range(n):
                    xi, yi = float(pts[i][0]), float(pts[i][1])
                    xj, yj = float(pts[j][0]), float(pts[j][1])
                    if ((yi > y_m) != (yj > y_m)) and (x_m < (xj - xi) * (y_m - yi) / (yj - yi) + xi):
                        inside = not inside
                    j = i
                if inside:
                    return str(room)
            elif gtype == "circle":
                cx = float(geo.get("cx_m", 0))
                cy = float(geo.get("cy_m", 0))
                r = float(geo.get("r_m", 0))
                if (x_m - cx) ** 2 + (y_m - cy) ** 2 <= r ** 2:
                    return str(room)
        return ""

    # ── Batch spatial save (fabric authority) ────────────────────────────────

    async def async_batch_save_spatial(
        self, map_id: str, floor_id: str,
        scanners: list[dict] | None = None,
        rooms: dict | None = None,
        rf_barriers: list[dict] | None = None,
        beacons: list[dict] | None = None,
    ) -> dict[str, int]:
        """Atomic batch save of spatial data from map-fraction coordinates.

        Converts fracs to metres using the map transform, writes to fabric.
        Returns counts: {scanners, rooms, barriers, beacons}.
        """
        stats = {"scanners": 0, "rooms": 0, "barriers": 0, "beacons": 0}
        t = (self.data.get("map_transforms") or {}).get(map_id)
        fl = str(floor_id or DEFAULT_FLOOR_ID)
        positions = self.data.setdefault("scanner_positions_m", {})
        geometry = self.data.setdefault("room_geometry_m", {})
        beacons_m = self.data.setdefault("beacon_positions_m", {})

        if scanners is not None:
            for rx in scanners:
                src = rx.get("source") or rx.get("id", "")
                if not src:
                    continue
                if positions.get(src, {}).get("origin") == "manual":
                    continue
                if t:
                    coords = self.map_frac_to_metres(float(rx.get("x", 0)), float(rx.get("y", 0)), map_id)
                    if coords:
                        positions[src] = {"x_m": round(coords[0], 3), "y_m": round(coords[1], 3), "z_m": 2.4, "floor_id": fl, "origin": "map", "map_id": map_id}
                        stats["scanners"] += 1

        if rooms is not None:
            for rname, b in rooms.items():
                if not isinstance(b, dict) or geometry.get(rname, {}).get("origin") == "manual":
                    continue
                btype = b.get("type", "poly")
                if btype == "poly" and t:
                    pts = b.get("points") or []
                    pts_m = [([round(c[0], 3), round(c[1], 3)]) for p in pts if (c := self.map_frac_to_metres(float(p[0]), float(p[1]), map_id))]
                    if len(pts_m) >= 3:
                        geometry[rname] = {"type": "poly", "floor_id": fl, "origin": "map", "points_m": pts_m}
                        stats["rooms"] += 1
                elif btype == "circle" and t:
                    c_center = self.map_frac_to_metres(float(b.get("cx", 0.5)), float(b.get("cy", 0.5)), map_id)
                    if c_center:
                        avg_scale = (float(t["scale_x_m"]) + float(t["scale_y_m"])) / 2
                        geometry[rname] = {"type": "circle", "floor_id": fl, "origin": "map", "cx_m": round(c_center[0], 3), "cy_m": round(c_center[1], 3), "r_m": round(float(b.get("r", 0.12)) * avg_scale, 3)}
                        stats["rooms"] += 1

        if rf_barriers is not None and t:
            self.data["rf_barriers_m"] = [bm for bm in self.data.get("rf_barriers_m", []) if not (bm.get("origin") == "map" and bm.get("map_id") == map_id)]
            for idx, bar in enumerate(rf_barriers):
                pts = bar.get("points") or []
                pts_m = [([round(c[0], 3), round(c[1], 3)]) for p in pts if (c := self.map_frac_to_metres(float(p[0]), float(p[1]), map_id))]
                if len(pts_m) >= 2:
                    self.data["rf_barriers_m"].append({"name": str(bar.get("name", f"Barrier {map_id}_{idx+1}"))[:80], "material": str(bar.get("material", "custom"))[:20], "attenuation_dbm": float(bar.get("attenuation_dbm", 6)), "floor_id": fl, "points_m": pts_m, "origin": "map", "map_id": map_id})
                    stats["barriers"] += 1

        if beacons is not None:
            for bk in beacons:
                bk_key = bk.get("key")
                if not bk_key or beacons_m.get(bk_key, {}).get("origin") == "manual":
                    continue
                if t:
                    coords = self.map_frac_to_metres(float(bk.get("x", 0)), float(bk.get("y", 0)), map_id)
                    if coords:
                        room = self.beacon_room_from_geometry(coords[0], coords[1], fl)
                        beacons_m[bk_key] = {"x_m": round(coords[0], 3), "y_m": round(coords[1], 3), "floor_id": fl, "room": room or str(bk.get("label", "")), "kind": str(bk.get("kind", "")), "label": str(bk.get("label", "")), "origin": "map", "map_id": map_id}
                        stats["beacons"] += 1

        await self.store.async_save(self.data)
        return stats

    # ── Migration: derive transforms + convert map data to metres ─────────

    async def async_derive_transforms(self, maps_store: Any, default_floor_width_m: float = 0.0) -> int:
        """Compute map_transforms from existing map calibration + stack data.

        Master map on each floor gets origin (0,0). Other maps on the same floor
        get their origin offset via the stack alignment.

        default_floor_width_m: if > 0, maps without px_per_meter calibration
        use this as the x-axis real-world width (derives px_per_meter from
        image width / floor_width_m).

        Returns number of transforms computed.
        """
        transforms = self.data.setdefault("map_transforms", {})
        count = 0

        # Find master map per floor
        maps_list = maps_store.data.get("maps") or []
        master_per_floor: dict[str, dict] = {}  # floor_id → map dict
        for m in maps_list:
            fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            if (m.get("stack") or {}).get("is_master"):
                master_per_floor[fl] = m

        for m in maps_list:
            mid = m.get("id", "")
            if not mid:
                continue
            # Skip maps that already have a manually-set transform with reference measurements
            _existing = transforms.get(mid)
            if _existing and _existing.get("reference_measurements"):
                count += 1  # count as already done
                continue
            cal = m.get("calibration") or {}
            ppm = cal.get("px_per_meter")
            img = m.get("image") or {}
            img_w = int(img.get("width") or 0)
            img_h = int(img.get("height") or 0)
            if img_w <= 0 or img_h <= 0:
                continue

            if ppm and float(ppm) > 0:
                ppm = float(ppm)
            elif default_floor_width_m > 0:
                # Estimate: floor_width_m covers the full image width
                ppm = img_w / default_floor_width_m
            else:
                continue

            # Scale: metres per 1.0 fraction
            scale_x_m = img_w / ppm
            scale_y_m = img_h / ppm

            stk = m.get("stack") or {}
            fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            rot_deg = float(stk.get("rotation", 0))
            rot_rad = math.radians(rot_deg)

            # Origin: master map = (0,0), others offset via stack
            is_master = stk.get("is_master", False)
            if is_master or mid == master_per_floor.get(fl, {}).get("id"):
                origin_x = 0.0
                origin_y = 0.0
            else:
                # Use stack x_offset, y_offset (normalised) scaled to master's metres
                master = master_per_floor.get(fl)
                if master:
                    m_cal = (master.get("calibration") or {})
                    m_ppm = float(m_cal.get("px_per_meter") or 0) or ppm
                    m_img = master.get("image") or {}
                    m_w = int(m_img.get("width") or img_w)
                    m_h = int(m_img.get("height") or img_h)
                    origin_x = float(stk.get("x_offset", 0)) * (m_w / m_ppm)
                    origin_y = float(stk.get("y_offset", 0)) * (m_h / m_ppm)
                else:
                    origin_x = float(stk.get("x_offset", 0)) * scale_x_m
                    origin_y = float(stk.get("y_offset", 0)) * scale_y_m

            transforms[mid] = {
                "origin_x_m": round(origin_x, 4),
                "origin_y_m": round(origin_y, 4),
                "scale_x_m": round(scale_x_m, 4),
                "scale_y_m": round(scale_y_m, 4),
                "rotation_rad": round(rot_rad, 6),
                "floor_id": fl,
            }
            count += 1

        if count:
            await self.store.async_save(self.data)
        return count

    async def async_migrate_from_maps(self, maps_store: Any) -> dict[str, int]:
        """One-time migration: convert map spatial data to real-world metres.

        Reads receivers → scanner_positions_m, room_bounds → room_geometry_m,
        rf_barriers → rf_barriers_m. Only writes if the target key is empty
        (won't overwrite existing manual edits).

        Returns {scanners_migrated, rooms_migrated, barriers_migrated}.
        """
        stats = {"scanners_migrated": 0, "rooms_migrated": 0, "barriers_migrated": 0, "beacons_migrated": 0}
        transforms = self.data.get("map_transforms") or {}
        if not transforms:
            return stats

        positions = self.data.setdefault("scanner_positions_m", {})
        geometry = self.data.setdefault("room_geometry_m", {})
        barriers = self.data.setdefault("rf_barriers_m", [])

        # Track which rooms came from a master map (prefer master)
        master_rooms: set[str] = set()
        maps_list = maps_store.data.get("maps") or []

        # Sort maps so master maps are processed last (overwrite non-master)
        sorted_maps = sorted(maps_list, key=lambda m: 1 if (m.get("stack") or {}).get("is_master") else 0)

        changed = False
        for m in sorted_maps:
            mid = m.get("id", "")
            t = transforms.get(mid)
            if not t:
                continue

            fl = str(m.get("floor_id", DEFAULT_FLOOR_ID))
            stk = m.get("stack") or {}
            is_master = stk.get("is_master", False)
            ceiling_h = float(stk.get("ceiling_height_m", 2.4))

            # ── Scanners (receivers) ──────────────────────────────────────
            for rx in (m.get("receivers") or []):
                src = rx.get("source") or rx.get("id", "")
                if not src:
                    continue
                # Don't overwrite existing entries (manual or already migrated)
                if src in positions:
                    continue
                x_frac = float(rx.get("x", 0))
                y_frac = float(rx.get("y", 0))
                coords = self.map_frac_to_metres(x_frac, y_frac, mid)
                if coords:
                    positions[src] = {
                        "x_m": round(coords[0], 3),
                        "y_m": round(coords[1], 3),
                        "z_m": round(ceiling_h, 2),
                        "floor_id": fl,
                        "origin": "map",
                        "map_id": mid,
                    }
                    stats["scanners_migrated"] += 1
                    changed = True

            # ── Room bounds → geometry ────────────────────────────────────
            for rname, b in (m.get("room_bounds") or {}).items():
                if not isinstance(b, dict):
                    continue
                # Master map overrides non-master
                if rname in geometry and rname in master_rooms and not is_master:
                    continue
                btype = b.get("type", "poly")
                if btype == "poly":
                    pts = b.get("points") or []
                    if len(pts) < 3:
                        continue
                    pts_m = []
                    for p in pts:
                        c = self.map_frac_to_metres(float(p[0]), float(p[1]), mid)
                        if c:
                            pts_m.append([round(c[0], 3), round(c[1], 3)])
                    if len(pts_m) >= 3:
                        geometry[rname] = {
                            "type": "poly",
                            "floor_id": fl,
                            "origin": "map",
                            "points_m": pts_m,
                        }
                        if is_master:
                            master_rooms.add(rname)
                        stats["rooms_migrated"] += 1
                        changed = True
                elif btype == "circle":
                    c_center = self.map_frac_to_metres(
                        float(b.get("cx", 0.5)), float(b.get("cy", 0.5)), mid
                    )
                    if c_center:
                        # Approximate radius: use avg of x/y scale
                        avg_scale = (float(t["scale_x_m"]) + float(t["scale_y_m"])) / 2
                        r_m = float(b.get("r", 0.12)) * avg_scale
                        geometry[rname] = {
                            "type": "circle",
                            "floor_id": fl,
                            "origin": "map",
                            "cx_m": round(c_center[0], 3),
                            "cy_m": round(c_center[1], 3),
                            "r_m": round(r_m, 3),
                        }
                        if is_master:
                            master_rooms.add(rname)
                        stats["rooms_migrated"] += 1
                        changed = True

            # ── RF barriers ───────────────────────────────────────────────
            for idx, bar in enumerate(m.get("rf_barriers") or []):
                pts = bar.get("points") or []
                if len(pts) < 2:
                    continue
                pts_m = []
                for p in pts:
                    c = self.map_frac_to_metres(float(p[0]), float(p[1]), mid)
                    if c:
                        pts_m.append([round(c[0], 3), round(c[1], 3)])
                if len(pts_m) >= 2:
                    barriers.append({
                        "name": str(bar.get("name", f"Barrier {mid}_{idx+1}"))[:80],
                        "material": str(bar.get("material", "custom"))[:20],
                        "attenuation_dbm": float(bar.get("attenuation_dbm", 6)),
                        "floor_id": fl,
                        "points_m": pts_m,
                        "origin": "map",
                        "map_id": mid,
                    })
                    stats["barriers_migrated"] += 1
                    changed = True

            # ── Beacons ───────────────────────────────────────────────
            beacons_m = self.data.setdefault("beacon_positions_m", {})
            for bk in (m.get("beacons") or []):
                bk_key = bk.get("key")
                if not bk_key or bk_key in beacons_m:
                    continue
                bk_x = float(bk.get("x", 0))
                bk_y = float(bk.get("y", 0))
                coords = self.map_frac_to_metres(bk_x, bk_y, mid)
                if coords:
                    room = self.beacon_room_from_geometry(coords[0], coords[1], fl)
                    beacons_m[bk_key] = {
                        "x_m": round(coords[0], 3),
                        "y_m": round(coords[1], 3),
                        "floor_id": fl,
                        "room": room or str(bk.get("label", "")),
                        "kind": str(bk.get("kind", "")),
                        "label": str(bk.get("label", "")),
                        "origin": "map",
                        "map_id": mid,
                    }
                    stats["beacons_migrated"] += 1
                    changed = True

        if changed:
            await self.store.async_save(self.data)
        return stats

    async def async_sync_spatial_from_map(self, map_id: str, map_dict: dict) -> int:
        """Re-derive metre-space data for a single map after it's edited.

        Updates scanner positions, room geometry, and RF barriers that originated
        from this map. Returns number of items updated.
        """
        t = (self.data.get("map_transforms") or {}).get(map_id)
        if not t:
            return 0

        fl = str(map_dict.get("floor_id", DEFAULT_FLOOR_ID))
        stk = map_dict.get("stack") or {}
        ceiling_h = float(stk.get("ceiling_height_m", 2.4))
        count = 0

        # ── Sync scanner positions ────────────────────────────────────────
        positions = self.data.setdefault("scanner_positions_m", {})
        for rx in (map_dict.get("receivers") or []):
            src = rx.get("source") or rx.get("id", "")
            if not src:
                continue
            existing = positions.get(src)
            # Only update map-origin entries from this map (or new entries)
            if existing and existing.get("origin") == "manual":
                continue
            coords = self.map_frac_to_metres(float(rx.get("x", 0)), float(rx.get("y", 0)), map_id)
            if coords:
                positions[src] = {
                    "x_m": round(coords[0], 3),
                    "y_m": round(coords[1], 3),
                    "z_m": round(ceiling_h, 2),
                    "floor_id": fl,
                    "origin": "map",
                    "map_id": map_id,
                }
                count += 1

        # ── Sync room geometry ────────────────────────────────────────────
        geometry = self.data.setdefault("room_geometry_m", {})
        for rname, b in (map_dict.get("room_bounds") or {}).items():
            if not isinstance(b, dict):
                continue
            existing = geometry.get(rname)
            if existing and existing.get("origin") == "manual":
                continue
            btype = b.get("type", "poly")
            if btype == "poly":
                pts = b.get("points") or []
                pts_m = []
                for p in pts:
                    c = self.map_frac_to_metres(float(p[0]), float(p[1]), map_id)
                    if c:
                        pts_m.append([round(c[0], 3), round(c[1], 3)])
                if len(pts_m) >= 3:
                    geometry[rname] = {
                        "type": "poly", "floor_id": fl, "origin": "map",
                        "points_m": pts_m,
                    }
                    count += 1
            elif btype == "circle":
                c_center = self.map_frac_to_metres(
                    float(b.get("cx", 0.5)), float(b.get("cy", 0.5)), map_id
                )
                if c_center:
                    avg_scale = (float(t["scale_x_m"]) + float(t["scale_y_m"])) / 2
                    geometry[rname] = {
                        "type": "circle", "floor_id": fl, "origin": "map",
                        "cx_m": round(c_center[0], 3),
                        "cy_m": round(c_center[1], 3),
                        "r_m": round(float(b.get("r", 0.12)) * avg_scale, 3),
                    }
                    count += 1

        # ── Sync RF barriers ─────────────────────────────────────────────
        barriers = self.data.setdefault("rf_barriers_m", [])
        # Remove old map-origin barriers from this map
        self.data["rf_barriers_m"] = [
            b for b in barriers
            if not (b.get("origin") == "map" and b.get("map_id") == map_id)
        ]
        for idx, bar in enumerate(map_dict.get("rf_barriers") or []):
            pts = bar.get("points") or []
            pts_m = []
            for p in pts:
                c = self.map_frac_to_metres(float(p[0]), float(p[1]), map_id)
                if c:
                    pts_m.append([round(c[0], 3), round(c[1], 3)])
            if len(pts_m) >= 2:
                self.data["rf_barriers_m"].append({
                    "name": str(bar.get("name", f"Barrier {map_id}_{idx+1}"))[:80],
                    "material": str(bar.get("material", "custom"))[:20],
                    "attenuation_dbm": float(bar.get("attenuation_dbm", 6)),
                    "floor_id": fl,
                    "points_m": pts_m,
                    "origin": "map",
                    "map_id": map_id,
                })
                count += 1

        # ── Sync beacons ──────────────────────────────────────────────────
        beacons_m = self.data.setdefault("beacon_positions_m", {})
        for bk in (map_dict.get("beacons") or []):
            bk_key = bk.get("key")
            if not bk_key:
                continue
            existing = beacons_m.get(bk_key)
            if existing and existing.get("origin") == "manual":
                continue
            coords = self.map_frac_to_metres(float(bk.get("x", 0)), float(bk.get("y", 0)), map_id)
            if coords:
                room = self.beacon_room_from_geometry(coords[0], coords[1], fl)
                beacons_m[bk_key] = {
                    "x_m": round(coords[0], 3),
                    "y_m": round(coords[1], 3),
                    "floor_id": fl,
                    "room": room or str(bk.get("label", "")),
                    "kind": str(bk.get("kind", "")),
                    "label": str(bk.get("label", "")),
                    "origin": "map",
                    "map_id": map_id,
                }
                count += 1

        if count:
            await self.store.async_save(self.data)
        return count

    # ── Phase 4: map image replacement — recompute + re-derive ─────────────

    async def async_recompute_transform_for_map(
        self, map_id: str, map_dict: dict, maps_store: Any, crop: dict | None = None,
    ) -> bool:
        """Recompute a single map's frac↔metre transform after image replacement.

        Uses the map's calibration px_per_meter (or existing default_floor_width
        from the current transform) with the NEW image dimensions.

        crop: when the replacement was a crop of the previous image
        ({fx0, fy0, fx1, fy1} as 0-1 fractions of the OLD image), the map now
        covers only that fraction of its former real-world extent.  Scaling the
        old extent by the crop fractions is exact and survives the resample that
        the client applies to keep images under its max dimension — px_per_meter
        does not, since the pixel density changes with that resample.

        Returns True if transform was updated.
        """
        cal = map_dict.get("calibration") or {}
        img = map_dict.get("image") or {}
        img_w = int(img.get("width") or 0)
        img_h = int(img.get("height") or 0)
        if img_w <= 0 or img_h <= 0:
            return False

        old_t = (self.data.get("map_transforms") or {}).get(map_id) or {}
        scale_x_m = scale_y_m = 0.0

        # Crop: derive the new extent from the retained fraction of the old one.
        if crop and old_t.get("scale_x_m") and old_t.get("scale_y_m"):
            _fw = float(crop.get("fx1", 1)) - float(crop.get("fx0", 0))
            _fh = float(crop.get("fy1", 1)) - float(crop.get("fy0", 0))
            if _fw > 0 and _fh > 0:
                scale_x_m = float(old_t["scale_x_m"]) * _fw
                scale_y_m = float(old_t["scale_y_m"]) * _fh

        if not scale_x_m:
            ppm = cal.get("px_per_meter")
            if ppm and float(ppm) > 0:
                ppm = float(ppm)
            elif old_t.get("scale_x_m"):
                # No crop — a pure resample keeps the real-world extent, so
                # back-derive px/m for the new pixel dimensions.
                ppm = img_w / float(old_t["scale_x_m"])
            else:
                return False
            scale_x_m = img_w / ppm
            scale_y_m = img_h / ppm

        stk = map_dict.get("stack") or {}
        fl = str(map_dict.get("floor_id", DEFAULT_FLOOR_ID))
        rot_rad = math.radians(float(stk.get("rotation", 0)))

        # Origin: master = (0,0), others from stack offset
        is_master = stk.get("is_master", False)
        if is_master:
            origin_x, origin_y = 0.0, 0.0
        else:
            # Use stack offsets scaled by master's metres
            origin_x = float(stk.get("x_offset", 0)) * scale_x_m
            origin_y = float(stk.get("y_offset", 0)) * scale_y_m

        transforms = self.data.setdefault("map_transforms", {})
        new_t = {
            "origin_x_m": round(origin_x, 4),
            "origin_y_m": round(origin_y, 4),
            "scale_x_m": round(scale_x_m, 4),
            "scale_y_m": round(scale_y_m, 4),
            "rotation_rad": round(rot_rad, 6),
            "floor_id": fl,
        }
        # Carry the manual-scale provenance forward — it marks the map as
        # measured (panel "has scale" check, health counts, and the build path's
        # skip test), and replacing an image doesn't un-measure it.
        if old_t.get("reference_measurements"):
            new_t["reference_measurements"] = old_t["reference_measurements"]
        transforms[map_id] = new_t
        await self.store.async_save(self.data)
        return True

    async def async_rederive_map_fracs(self, map_id: str, map_dict: dict) -> int:
        """Re-derive map-fraction coordinates from metres for a single map.

        Inverse of async_sync_spatial_from_map: reads metre-space data and
        writes back to the map dict's receivers, room_bounds, rf_barriers.
        Returns count of items updated. Mutates map_dict in place.
        """
        count = 0
        positions = self.data.get("scanner_positions_m") or {}
        geometry = self.data.get("room_geometry_m") or {}
        barriers_m = self.data.get("rf_barriers_m") or []

        # ── Receivers ─────────────────────────────────────────────────────
        existing_receivers = map_dict.get("receivers") or []
        existing_sources = {(rx.get("source") or rx.get("id", "")) for rx in existing_receivers}

        for rx in existing_receivers:
            src = rx.get("source") or rx.get("id", "")
            if not src or src not in positions:
                continue
            pos = positions[src]
            if pos.get("origin") == "manual" and pos.get("map_id") != map_id:
                continue  # don't override manual positions from other maps
            fracs = self.metres_to_map_frac(float(pos["x_m"]), float(pos["y_m"]), map_id)
            if fracs:
                rx["x"] = round(max(0.0, min(1.0, fracs[0])), 4)
                rx["y"] = round(max(0.0, min(1.0, fracs[1])), 4)
                count += 1

        # Add receivers from fabric that belong to this map but aren't in map_dict yet
        for src, pos in positions.items():
            if src in existing_sources:
                continue
            if pos.get("map_id") != map_id:
                continue
            fracs = self.metres_to_map_frac(float(pos["x_m"]), float(pos["y_m"]), map_id)
            if fracs and 0.0 <= fracs[0] <= 1.0 and 0.0 <= fracs[1] <= 1.0:
                existing_receivers.append({
                    "id": src,
                    "source": src,
                    "label": src,
                    "x": round(fracs[0], 4),
                    "y": round(fracs[1], 4),
                    "room": pos.get("room", ""),
                })
                count += 1
        map_dict["receivers"] = existing_receivers

        # ── Room bounds ───────────────────────────────────────────────────
        # Room boundaries are the user's authoritative drawings. Do NOT
        # overwrite them from metre-space re-derivation (map transform drift
        # corrupts positions) and do NOT inject room boundaries from the
        # fabric into maps (creates phantom outlines the user never drew).
        # Room bounds are ONLY modified by explicit user Save in the Edit tab.

        # ── RF barriers ──────────────────────────────────────────────────
        map_barriers_m = [bm for bm in barriers_m if bm.get("map_id") == map_id]
        existing_barriers = map_dict.get("rf_barriers") or []
        if map_barriers_m and existing_barriers:
            # Match by index/name and re-derive points
            for i, bar in enumerate(existing_barriers):
                if i >= len(map_barriers_m):
                    break
                bm = map_barriers_m[i]
                new_pts = []
                for pm in (bm.get("points_m") or []):
                    fracs = self.metres_to_map_frac(float(pm[0]), float(pm[1]), map_id)
                    if fracs:
                        new_pts.append([
                            round(max(0.0, min(1.0, fracs[0])), 4),
                            round(max(0.0, min(1.0, fracs[1])), 4),
                        ])
                if len(new_pts) >= 2:
                    bar["points"] = new_pts
                    count += 1

        # ── Beacons ───────────────────────────────────────────────────────
        beacons_m = self.data.get("beacon_positions_m") or {}
        existing_beacons = map_dict.get("beacons") or []
        existing_keys = {bk.get("key") for bk in existing_beacons if bk.get("key")}

        # Update existing beacon entries
        for bk in existing_beacons:
            bk_key = bk.get("key")
            if not bk_key or bk_key not in beacons_m:
                continue
            bm = beacons_m[bk_key]
            if bm.get("origin") == "manual" and bm.get("map_id") != map_id:
                continue
            fracs = self.metres_to_map_frac(float(bm["x_m"]), float(bm["y_m"]), map_id)
            if fracs:
                bk["x"] = round(max(0.0, min(1.0, fracs[0])), 4)
                bk["y"] = round(max(0.0, min(1.0, fracs[1])), 4)
                count += 1

        # Add new beacons from fabric that belong to this map but aren't in m.beacons yet
        # Only add if fracs are within map bounds (skip beacons outside this map's area)
        for bk_key, bm in beacons_m.items():
            if bk_key in existing_keys:
                continue
            if bm.get("map_id") != map_id:
                continue
            fracs = self.metres_to_map_frac(float(bm["x_m"]), float(bm["y_m"]), map_id)
            if fracs and 0.0 <= fracs[0] <= 1.0 and 0.0 <= fracs[1] <= 1.0:
                existing_beacons.append({
                    "id": f"bk_{bk_key[:12]}",
                    "key": bk_key,
                    "label": bm.get("label", ""),
                    "kind": bm.get("kind", ""),
                    "x": round(fracs[0], 4),
                    "y": round(fracs[1], 4),
                })
                count += 1
        map_dict["beacons"] = existing_beacons

        return count

    def has_floor(self, floor_id: str) -> bool:
        fid = str(floor_id or "")
        return any(f.get("id") == fid for f in self.data.get("floors", []))

    async def async_ensure_rooms(self, rooms: list[str]) -> None:
        changed = False
        rm: dict[str, Any] = self.data.get("room_meta", {}) or {}
        for r in rooms or []:
            if not r or not isinstance(r, str):
                continue
            if r not in rm:
                rm[r] = {"floor_id": DEFAULT_FLOOR_ID, "color": _hash_color_hex(r)}
                changed = True
            else:
                # Ensure keys exist
                if "floor_id" not in rm[r]:
                    rm[r]["floor_id"] = DEFAULT_FLOOR_ID
                    changed = True
                if "color" not in rm[r] or not rm[r]["color"]:
                    rm[r]["color"] = _hash_color_hex(r)
                    changed = True
        if changed:
            self.data["room_meta"] = rm
            await self.store.async_save(self.data)

    async def async_update(self, *, floors: list[dict[str, Any]] | None = None, room_meta: dict[str, Any] | None = None) -> dict[str, Any]:
        if isinstance(floors, list):
            norm_floors: list[dict[str, Any]] = []
            seen: set[str] = set()
            for f in floors:
                if not isinstance(f, dict):
                    continue
                fid = str(f.get("id") or "").strip()
                name = str(f.get("name") or "").strip()
                if not fid:
                    fid = _slug(name)[:40]
                fid = fid[:40]
                if not fid or fid in seen:
                    continue
                seen.add(fid)
                norm_floors.append({"id": fid, "name": (name or fid)[:80]})
            if not any(x["id"] == DEFAULT_FLOOR_ID for x in norm_floors):
                norm_floors.insert(0, {"id": DEFAULT_FLOOR_ID, "name": "Main Floor"})
            self.data["floors"] = norm_floors

        if isinstance(room_meta, dict):
            rm: dict[str, Any] = self.data.get("room_meta", {}) or {}
            for room, meta in room_meta.items():
                if not isinstance(room, str) or not isinstance(meta, dict):
                    continue
                r = room[:120]
                floor_id = str(meta.get("floor_id") or DEFAULT_FLOOR_ID)[:40]
                if not self.has_floor(floor_id):
                    floor_id = DEFAULT_FLOOR_ID
                color = str(meta.get("color") or _hash_color_hex(r))[:20]
                rm[r] = {"floor_id": floor_id, "color": color}
            self.data["room_meta"] = rm

        await self.store.async_save(self.data)
        return self.snapshot()
