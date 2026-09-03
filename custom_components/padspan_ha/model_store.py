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
    "room_geometry_m": {...},         # RETIRED legacy copy — ground truth lives in
                                      # padspan_ha.fabric (FabricStore); kept on disk
                                      # for rollback only, never read or written live
    "rf_barriers_m": [...],           # Phase 2: [{points_m, attenuation_dbm, floor_id}]
    "map_transforms": {...},          # Phase 2: map_id→affine (frac↔metres)
  }

Room colours are deterministically generated from the room name (SHA-256 hash →
pastel RGB) so they're stable across sessions without needing explicit assignment.
"""

import asyncio
import copy
import hashlib
import logging
import math
import re
from dataclasses import dataclass, field
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from . import fabric_truth
from .const import MODEL_STORE_KEY, DEFAULT_FLOOR_ID, MAX_HEIGHT_M, LIGHT_SHAPE_KINDS, OUTDOOR_FLOOR_NAMES
from .safe_store import wrap_store

_LOGGER = logging.getLogger(__name__)


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


# ── Floor elevation defaults ────────────────────────────────────────────────
# Finished floor to the next finished floor: interior ceiling height plus the
# slab between.  Used when a floor has no explicit floor_to_floor_m.
DEFAULT_FLOOR_TO_FLOOR_M: float = 2.8


# The six coordinates of a placement — see ModelStore.map_frac_to_metres.
# `_put_map_transform` carries any of them a new record does not state, so
# these are the fields a rebuild cannot drop by forgetting them.
_PLACEMENT_FIELDS = ("origin_x_m", "origin_y_m", "scale_x_m", "scale_y_m",
                     "rotation_rad", "shear_rad")

# Carried with them: the provenance that decides whether a map counts as
# MEASURED at all. It is not a coordinate, but it is subject to the same rule
# and was subject to the same defect — a record that does not MENTION it had
# been un-measuring the map, which is the σ bug on the one field that decides
# whether the map can anchor the house to metres. Four callers carried it by
# hand and the websocket writer, which takes an unvalidated dict straight from
# a client, did not.
# `floor_id` rides with them under the same rule. It is not a coordinate
# either, but it decides which storey the map's rooms are drawn on, and the
# record is REPLACED by the payload — so the one writer that takes a client
# dict whole moved a map to 'main' whenever the client left the key out.
_CARRIED_FIELDS = _PLACEMENT_FIELDS + ("reference_measurements", "floor_id")


def _has_valid_origin(t: Any) -> bool:
    """True if a map transform carries finite numeric origin fields.

    A transform passing this check has an anchored world pose: its origin
    (and rotation) are authoritative and must never be re-derived from
    presentation state.
    """
    if not isinstance(t, dict):
        return False
    try:
        return all(
            math.isfinite(float(t[k])) for k in ("origin_x_m", "origin_y_m")
        )
    except (KeyError, TypeError, ValueError):
        return False


def _has_valid_scale(t: Any) -> bool:
    """True if a map transform carries finite positive scale fields."""
    if not isinstance(t, dict):
        return False
    try:
        return all(
            math.isfinite(float(t[k])) and float(t[k]) > 0
            for k in ("scale_x_m", "scale_y_m")
        )
    except (KeyError, TypeError, ValueError):
        return False


def _norm_floor(f: dict[str, Any]) -> dict[str, Any]:
    """Normalise one floor entry, preserving elevation keys.

    Floors carry two optional elevation fields:
      level              stacking order (bottom-up); falls back to list order
      floor_to_floor_m   finished floor to the next finished floor
      base_elevation_m   absolute height of this floor; None = derive it
    """
    fid = str(f.get("id") or "").strip() or DEFAULT_FLOOR_ID
    out: dict[str, Any] = {
        "id": fid[:40],
        "name": str(f.get("name") or fid)[:80],
    }
    lvl = f.get("level")
    if isinstance(lvl, (int, float)) and not isinstance(lvl, bool):
        out["level"] = int(lvl)
    for key, lo, hi in (("floor_to_floor_m", 1.5, MAX_HEIGHT_M), ("base_elevation_m", -50.0, 500.0)):
        val = f.get(key)
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            out[key] = round(max(lo, min(hi, float(val))), 3)
    return out


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
    # RETIRED (pass 2): scanner_positions_m / rf_barriers_m / beacon_positions_m
    # live in FabricStore (padspan_ha.fabric) like room_geometry_m before them.
    # Stored copies in pre-pass-2 model files stay untouched — they are the
    # one-time verbatim import source and allow clean rollback.
    "room_geometry_m": {
        # RETIRED — room shapes live in FabricStore (padspan_ha.fabric).
        # This key stays only so pre-fabric stores can roll back cleanly.
    },
    "map_transforms": {
        # map_id: { origin_x_m, origin_y_m, scale_x_m, scale_y_m, rotation_rad,
        #           shear_rad, floor_id, origin_anchored }
        # shear_rad: σ, the sixth degree of freedom — see map_frac_to_metres.
        # Absent means 0 (square axes), which is every placement written
        # before the field existed.
        # origin_anchored: the world pose (origin + rotation) is write-once —
        # only the explicit re-anchor action may change it.
    },
    # How many metres one unit of the shared stack world frame is.
    #
    #   { m_per_unit: float|None, source_map_id: str|None }
    #
    # ONE scalar, because metres carry no aspect ratio and neither does world
    # space — see the note above `measure_world_gauge` in fabric_truth. This
    # was measured on every read, by dividing a measured map's `scale_x_m` by
    # the world footprint of its picture, which made the house's metre scale a
    # property of a photograph and of the order the maps happened to be in
    # (two self-consistent maps swing it 20%). It is measured once, written
    # here, and read from here.
    #
    # None until something is measured, and None is a REFUSAL, not a cue to
    # invent one. The 20 m fallback that used to fill this in was deleted for
    # putting every position on an unmeasured plan at the wrong size silently.
    #
    # It is not the MEASURED flag: `map_transforms[id].reference_measurements`
    # keeps that job. A map can be PLACED in gauge units without anyone having
    # measured it, which is what makes an unmeasured floor plan drawable.
    "world_gauge": {"m_per_unit": None, "source_map_id": None},
}


# ── Light pin appearance ─────────────────────────────────────────────────────
# A placed light's marker: colour, shape, rotation, real-world footprint. This
# validation lived on the per-photo light list, which nothing writes any more;
# it belongs on the one write path a light has — metres in the fabric.
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
# The marker vocabulary: const.LIGHT_SHAPE_KINDS (the renderer's list, held
# equal to it by tests) plus "auto" — a placed light may say "derive the
# shape from the entity". The list this replaced (rect, pill, octagon, star,
# bulb…) was a vocabulary the frontend had never drawn, and would have turned
# every "bar" strip and "pendant" into a circle on the way in.
LIGHT_PIN_SHAPES = frozenset(LIGHT_SHAPE_KINDS) | {"auto"}
LIGHT_PIN_DEFAULT_SHAPE = "hex"
LIGHT_PIN_DEFAULT_COLOR = "#fbbf24"
LIGHT_PIN_DEFAULT_SIZE_CM = 15.0


LIGHT_PIN_DEFAULT_MARGIN_CM = 15.0

def light_appearance(*, color: Any = "", shape: Any = "", rotation: Any = 0.0,
                     width_cm: Any = None, height_cm: Any = None,
                     margin_cm: Any = None) -> dict[str, Any]:
    """Normalise a light marker's appearance to what the fabric stores.

    Colour is a 6-digit hex or the default; shape is one of LIGHT_PIN_SHAPES
    or the default fixture hex; rotation is folded into [0, 360); the
    footprint is clamped to 1-1000 cm and defaults to 15 cm a side. An
    explicit zero size clamps to 1 cm rather than silently defaulting — the
    caller said zero, not nothing.

    margin_cm is the "perimeter" shape's inset from the room's own walls —
    unlike width/height, zero is a real answer (trace right on the wall
    line), so it clamps down to 0 rather than up to 1.
    """
    c = str(color or "").strip()
    sh = str(shape or LIGHT_PIN_DEFAULT_SHAPE).strip().lower()

    def _size(v: Any) -> float:
        if v is None or v == "":
            return LIGHT_PIN_DEFAULT_SIZE_CM
        try:
            return max(1.0, min(1000.0, float(v)))
        except (TypeError, ValueError):
            return LIGHT_PIN_DEFAULT_SIZE_CM

    def _margin(v: Any) -> float:
        if v is None or v == "":
            return LIGHT_PIN_DEFAULT_MARGIN_CM
        try:
            return max(0.0, min(500.0, float(v)))
        except (TypeError, ValueError):
            return LIGHT_PIN_DEFAULT_MARGIN_CM

    try:
        rot = float(rotation or 0.0) % 360.0
    except (TypeError, ValueError):
        rot = 0.0
    return {
        "color": c if _HEX_COLOR_RE.match(c) else LIGHT_PIN_DEFAULT_COLOR,
        "shape": sh if sh in LIGHT_PIN_SHAPES else LIGHT_PIN_DEFAULT_SHAPE,
        "rotation": rot,
        "width_cm": _size(width_cm),
        "height_cm": _size(height_cm),
        "margin_cm": _margin(margin_cm),
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
        self.fabric: Any = None  # FabricStore, attached by __init__ after both load

    def attach_fabric(self, fabric: Any) -> None:
        """Wire the FabricStore this model reads room geometry through."""
        self.fabric = fabric

    def room_geometry_m(self) -> dict[str, dict[str, Any]]:
        """Room geometry ground truth, read through from the FabricStore.

        Deliberately NO fallback to the legacy self.data copy: a missed
        fabric wiring must fail loud (empty geometry) rather than silently
        serve the stale pre-fabric cache.
        """
        fab = getattr(self, "fabric", None)
        return fab.rooms_flat() if fab else {}

    async def async_setup(self) -> None:
        loaded = await self.store.async_load()
        _stamped = False
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
            # scanner_positions_m / rf_barriers_m / beacon_positions_m are NOT
            # ensured here anymore — whatever the file carries is preserved
            # verbatim as the fabric's one-time import source.
            if not isinstance(self.data.get("room_geometry_m"), dict):
                self.data["room_geometry_m"] = {}
            if not isinstance(self.data.get("map_transforms"), dict):
                self.data["map_transforms"] = {}
            # Not seeded here — only shaped. Seeding needs the maps store, and
            # a store that boots with the key absent must read as "nothing
            # measured yet" rather than as a broken gauge.
            if not isinstance(self.data.get("world_gauge"), dict):
                self.data["world_gauge"] = dict(DEFAULT_DATA["world_gauge"])
            # ── Migration: freeze existing map-transform world poses ────────
            # The stored origin is already the effective origin every reader
            # uses, so this changes no numbers — it marks the pose write-once
            # so no derive path may rewrite it from presentation state.
            # Tracked with a flag: self.data is a SHALLOW copy of loaded, so
            # the stamp mutates both and the json change-compare below
            # cannot see it.
            for _t in self.data["map_transforms"].values():
                if _has_valid_origin(_t) and not _t.get("origin_anchored"):
                    _t["origin_anchored"] = True
                    _stamped = True
        else:
            self.data = {k: (list(v) if isinstance(v, list) else dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_DATA.items()}

        # Normalize floors
        norm_floors: list[dict[str, Any]] = []
        seen: set[str] = set()
        for f in self.data.get("floors", []):
            if not isinstance(f, dict):
                continue
            entry = _norm_floor(f)
            if entry["id"] in seen:
                continue
            seen.add(entry["id"])
            norm_floors.append(entry)
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
        if _stamped or (json.dumps(self.data, sort_keys=True) != json.dumps(loaded, sort_keys=True) if loaded else True):
            await self.store.async_save(self.data)

    def snapshot(self) -> dict[str, Any]:
        return {
            "floors": list(self.data.get("floors", [])),
            "room_meta": dict(self.data.get("room_meta", {})),
            "scanners": dict(self.data.get("scanners", {})),
            "room_adjacency": dict(self.data.get("room_adjacency", {})),
            "fabric_sync_mode": self.data.get("fabric_sync_mode", "auto"),
            "scanner_positions_m": self.scanner_positions_m(),
            "room_geometry_m": self.room_geometry_m(),
            "rf_barriers_m": self.rf_barriers_m(),
            "map_transforms": dict(self.data.get("map_transforms", {})),
            "beacon_positions_m": self.beacon_positions_m(),
            "world_gauge": self.world_gauge(),
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

    async def async_sync_floors(self, registry_floors: list[dict[str, Any]]) -> bool:
        """Adopt the building's floors from the HA floor registry.

        `data["floors"]` is the sole input to `floor_stack_index()` and
        `floor_base_elevations_m()`, and nothing ever wrote it. The panel looked
        right because `ws_model_get` reads the registry live, for display —
        but the POSITIONING side read this list, found the one synthetic
        `main` entry it was created with, and ran every multi-floor house as a
        single storey. `_slabs_crossed` then took its "unknown stacking" branch
        for every cross-floor path, so a basement scanner and an upstairs
        scanner were penalised identically and floor selection had nothing to
        discriminate with. Measured on a real three-storey install: 2.9 million
        confirmed cross-floor room changes, split almost evenly both ways —
        oscillation, not movement.

        Stored heights win over the registry: the registry knows which floors
        exist and their level, the user's Floor Heights table knows how far
        apart they are, and a sync must never overwrite the latter.

        Returns True when something changed (and was saved).
        """
        incoming = [f for f in (registry_floors or []) if isinstance(f, dict) and f.get("id")]
        if not incoming:
            return False   # a registry we could not read is not a reason to forget the floors

        stored = {str(f.get("id")): f for f in (self.data.get("floors") or [])
                  if isinstance(f, dict) and f.get("id")}
        merged: list[dict[str, Any]] = []
        for f in incoming:
            fid = str(f["id"])
            prev = stored.get(fid, {})
            entry = {**prev, "id": fid, "name": f.get("name") or prev.get("name") or fid}
            # A level the user typed into Floor Heights outranks the registry's,
            # which is null on most installs anyway.
            reg_level = f.get("level")
            if prev.get("level") is None and reg_level is not None:
                entry["level"] = reg_level
            merged.append(_norm_floor(entry))

        # Keep any floor the fabric still uses but the registry has dropped —
        # deleting it here would strand its rooms outside the stack entirely.
        used = set()
        fab = getattr(self, "fabric", None)
        if fab:
            try:
                used = {str((g or {}).get("floor_id") or "")
                        for g in (fab.room_geometry_m() or {}).values()}
            except Exception:
                used = set()
        have = {f["id"] for f in merged}
        for fid, prev in stored.items():
            if fid not in have and fid in used:
                merged.append(prev)

        if merged == (self.data.get("floors") or []):
            return False
        self.data["floors"] = merged
        await self.store.async_save(self.data)
        return True

    async def async_remove_room(self, room: str) -> dict[str, Any]:
        """Delete a room everywhere it exists: geometry, metadata, adjacency,
        and any scanner assigned to it.

        One call, because a room removed from three of those four places is
        the bug this replaced — the geometry lives in the FabricStore and was
        the one piece the old delete never touched, so the room kept its shape
        and kept drawing after being "deleted".
        """
        room = str(room or "").strip()
        if not room:
            return {"ok": False, "error": "invalid_room"}

        fab = getattr(self, "fabric", None)
        geo = await fab.async_remove_room(room) if fab else {"removed": False}

        (self.data.get("room_meta") or {}).pop(room, None)
        scanners = self.data.get("scanners") or {}
        detached = [s for s, info in scanners.items()
                    if isinstance(info, dict) and info.get("room") == room]
        for s in detached:
            scanners.pop(s, None)
        await self.store.async_save(self.data)
        await self.async_remove_adjacency(room)   # saves again; adjacency owns its write

        return {"ok": True, "room": room,
                "geometry_removed": bool(geo.get("removed")),
                "scanners_detached": len(detached),
                "floor_id": geo.get("floor_id")}

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
    # Pass 2: spatial positions live in the FabricStore.  Same loud-empty
    # doctrine as room_geometry_m — no fallback to the stale legacy copy.

    def scanner_positions_m(self) -> dict[str, dict[str, Any]]:
        """Return {source: {x_m, y_m, z_m, floor_id}} for all scanners."""
        fab = getattr(self, "fabric", None)
        return fab.scanner_positions_m() if fab else {}

    # ── Floor elevation ──────────────────────────────────────────────────────

    # Conventional storeys, for a registry that never got filled in. These are
    # not decoration: HA's floor registry lets `level` be null, and on a real
    # install it usually is, so without this a house is stacked in whatever
    # order its floors happened to be created. Below-ground is negative,
    # ground is 0, above-ground is positive — the same numbering HA uses when
    # a level IS set, so a later explicit level slots in without a conversion.
    _CONVENTIONAL_LEVEL = {
        "subbasement": -2, "sub_basement": -2, "cellar": -1, "basement": -1,
        "lower": -1, "downstairs": -1, "lower_floor": -1,
        "ground": 0, "main": 0, "first": 0, "mainfloor": 0, "main_floor": 0,
        "ground_floor": 0, "first_floor": 0,
        # Outdoors is at ground level, not above the roof. Ranking it as an
        # unknown name put it on top of the stack, which made every outdoor
        # scanner two slabs (20 dB) away from the ground floor it stands next
        # to. The names come from const.OUTDOOR_FLOOR_NAMES — one list.
        **{name: 0 for name in OUTDOOR_FLOOR_NAMES},
        "upper": 1, "upstairs": 1, "second": 1, "middle": 1,
        "upper_floor": 1, "second_floor": 1,
        "third": 2, "third_floor": 2, "loft": 2, "attic": 3, "roof": 4,
    }

    def _ordered_floors(self) -> list[dict[str, Any]]:
        """Floors bottom-up: explicit level, then convention, then stored order.

        Registry order is the last resort, not the second one. HA's floor
        registry lets `level` be null and usually it is, which left the stack
        in whatever order the floors happened to be created — alphabetical, on
        the install this came from, so `attic` would have sorted below
        `basement`. The index difference here is the number of slabs an RF path
        crosses, so a wrong order is a wrong attenuation, not just a wrong
        picture.
        """
        floors = [f for f in (self.data.get("floors") or []) if isinstance(f, dict)]

        def _rank(pair: tuple[int, dict[str, Any]]) -> tuple[int, float, int]:
            i, f = pair
            level = f.get("level")
            if isinstance(level, (int, float)) and not isinstance(level, bool):
                return (0, float(level), i)
            conv = self._CONVENTIONAL_LEVEL.get(
                str(f.get("id") or "").strip().lower().replace(" ", "_"))
            if conv is not None:
                return (0, float(conv), i)
            # Nothing to go on. Keep it above the named storeys rather than
            # interleaved with them, and stable in stored order.
            return (1, 0.0, i)

        return [f for _, f in sorted(enumerate(floors), key=_rank)]

    def _storey_of(self, f: dict[str, Any]) -> float | None:
        """The storey a floor occupies, or None when nothing places it."""
        level = f.get("level")
        if isinstance(level, (int, float)) and not isinstance(level, bool):
            return float(level)
        conv = self._CONVENTIONAL_LEVEL.get(
            str(f.get("id") or "").strip().lower().replace(" ", "_"))
        return float(conv) if conv is not None else None

    def floor_stack_index(self) -> dict[str, int]:
        """Return {floor_id: slab position in the bottom-up stack} (0 = lowest).

        The index DIFFERENCE is the number of slabs an RF path must cross, so
        two floors on the same storey have to share an index. This used to
        return the enumerate() position, which gave every floor its own number
        — so "Outside" and "Main", both at ground level, came out one apart and
        an outdoor scanner was charged a slab of concrete it never saw through.
        Indices are assigned per distinct storey now, not per row.
        """
        out: dict[str, int] = {}
        slab = -1
        prev: float | None = None
        first = True
        for f in self._ordered_floors():
            fid = str(f.get("id") or "")
            if not fid:
                continue
            storey = self._storey_of(f)
            # An unplaceable floor gets its own slab: we cannot claim it shares
            # one with anything, and merging it would understate the path.
            if first or storey is None or prev is None or storey != prev:
                slab += 1
            first = False
            prev = storey
            out[fid] = slab
        return out

    def floor_base_elevations_m(self) -> dict[str, float]:
        """Return {floor_id: absolute height of that floor's walking surface}.

        An explicit base_elevation_m always wins — split levels and mezzanines
        can't be derived.  Otherwise it's the running sum of floor_to_floor_m
        for the floors below, with the lowest floor at 0.

        Floors on the SAME storey share a base and do not advance the sum. The
        garden and the ground floor are both at zero; adding a storey height
        between them invented 2.8 m of building and pushed every floor above
        them that much too high.
        """
        out: dict[str, float] = {}
        running = 0.0          # where the NEXT storey's base will be
        prev_base = 0.0        # the base of the storey just placed
        prev: float | None = None
        first = True
        for f in self._ordered_floors():
            fid = str(f.get("id") or "")
            if not fid:
                continue
            storey = self._storey_of(f)
            same_storey = (not first and storey is not None
                           and prev is not None and storey == prev)
            explicit = f.get("base_elevation_m")
            if isinstance(explicit, (int, float)) and not isinstance(explicit, bool):
                base = float(explicit)
                # An explicit value re-bases everything stacked above it.
                running = base
            elif same_storey:
                # Share the storey's base. `running` has already moved on to
                # the next storey by now, and reading it here is what put the
                # garden a full storey up — level with the bedrooms — the
                # moment it sorted after the ground floor.
                base = prev_base
            else:
                base = running
            out[fid] = round(base, 3)
            if not same_storey:
                f2f = f.get("floor_to_floor_m")
                running = base + (float(f2f)
                                  if isinstance(f2f, (int, float)) and not isinstance(f2f, bool)
                                  else DEFAULT_FLOOR_TO_FLOOR_M)
            first = False
            prev = storey
            prev_base = base
        return out

    async def async_set_scanner_z_m(self, source: str, z_m: float) -> bool:
        """Set only a scanner's mounting height, leaving x/y alone."""
        fab = getattr(self, "fabric", None)
        if not fab:
            return False
        entry = fab.scanner_positions_m().get(str(source))
        if not isinstance(entry, dict):
            return False
        entry = dict(entry)
        entry["z_m"] = round(max(0.0, min(MAX_HEIGHT_M, float(z_m))), 2)
        await fab.async_spatial_update(
            set_scanners={str(source): entry}, op="scanner_z_set")
        return True

    async def async_set_floor_elevations(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Upsert per-floor elevation data ({id, level?, floor_to_floor_m?, base_elevation_m?}).

        Merge semantics: floors not mentioned are untouched, unknown ids are
        created (the UI floor list comes from the HA registry, whose ids won't
        exist here until elevation data is first written for them), and a
        field sent as null clears the stored value.  Returns the floors list.
        """
        floors = [f for f in (self.data.get("floors") or []) if isinstance(f, dict)]
        by_id = {str(f.get("id")): i for i, f in enumerate(floors) if f.get("id")}
        changed = False
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            fid = str(entry.get("id") or "").strip()[:40]
            if not fid:
                continue
            if fid in by_id:
                merged = dict(floors[by_id[fid]])
                merged.update(entry)
                merged["id"] = fid
                new_f = _norm_floor(merged)
                if new_f != floors[by_id[fid]]:
                    floors[by_id[fid]] = new_f
                    changed = True
            else:
                new_f = _norm_floor(dict(entry, id=fid, name=entry.get("name") or fid))
                floors.append(new_f)
                by_id[fid] = len(floors) - 1
                changed = True
        if changed:
            self.data["floors"] = floors
            await self.store.async_save(self.data)
        return list(floors)

    def scanner_absolute_z_m(self) -> dict[str, float]:
        """Return {source: absolute height}, i.e. floor elevation + local z_m.

        z_m stays "height above its own floor", so nothing stored changes
        meaning when elevations are introduced.
        """
        bases = self.floor_base_elevations_m()
        out: dict[str, float] = {}
        for src, pos in self.scanner_positions_m().items():
            if not isinstance(pos, dict):
                continue
            z = pos.get("z_m")
            local = float(z) if isinstance(z, (int, float)) and not isinstance(z, bool) else 2.4
            out[str(src)] = round(bases.get(str(pos.get("floor_id") or ""), 0.0) + local, 3)
        return out

    def room_centroids_m(self) -> dict[str, tuple[float, float, str]]:
        """Compute room centroids in metres from the fabric's room geometry.

        Returns {room_name: (cx_m, cy_m, floor_id)}.
        """
        centroids: dict[str, tuple[float, float, str]] = {}
        for room, geo in self.room_geometry_m().items():
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
        fab = getattr(self, "fabric", None)
        return fab.rf_barriers_m() if fab else []

    def map_transform(self, map_id: str) -> dict | None:
        """Return the affine transform for a specific map, or None."""
        return (self.data.get("map_transforms") or {}).get(map_id)

    def world_gauge(self) -> dict[str, Any]:
        """The stored world gauge: {m_per_unit: float|None, source_map_id}.

        Shape only — `fabric_truth.metre_gauge` is what decides whether the
        value is USABLE, and it is the one every consumer goes through. The
        two are deliberately not the same function: this one answers "what is
        on disk" (the panel and the backup need that, including a gauge that
        is broken), and that one answers "is there a world frame" (every
        renderer and repair path needs that, and must get None for a broken
        gauge rather than a number).
        """
        g = self.data.get("world_gauge")
        if not isinstance(g, dict):
            return {"m_per_unit": None, "source_map_id": None}
        return {"m_per_unit": g.get("m_per_unit"),
                "source_map_id": g.get("source_map_id")}

    async def async_ensure_world_gauge(self, maps_list: list[dict]) -> dict[str, Any] | None:
        """Seed the world gauge if it has never been set. THE one writer.

        Returns the usable gauge (as `fabric_truth.metre_gauge` returns it) or
        None when nothing has been measured yet.

        WRITE-ONCE, and that is the whole design. A gauge that were re-measured
        on every write would be the per-render measurement again with an extra
        step, and the failure it caused would be worse for being sticky: the
        house's metre scale would move whenever a map was added, re-measured
        or re-ordered, silently rescaling every room and every scanner that
        had not moved. Once it is set, re-measuring a map changes THAT MAP's
        record — which is what a re-measure means — and the map's placement
        follows. The house does not resize because one plan was re-measured.

        Called from the upgrade migration (for stores that already have
        measured maps) and from the transform writer (so an install's FIRST
        measurement seeds it). Both go through here, so "what can set the
        house's scale" has one answer.

        Logged at INFO with the map and the reason, because this freezes a
        one-time judgement and the owner has to be able to see that it
        happened and which picture it was taken from.
        """
        existing = fabric_truth.metre_gauge(self)
        if existing:
            return existing
        seed = fabric_truth.measure_world_gauge(maps_list or [], self)
        if not seed:
            return None
        self.data["world_gauge"] = {"m_per_unit": seed["m_per_unit"],
                                    "source_map_id": seed["source_map_id"]}
        await self.store.async_save(self.data)
        _LOGGER.info(
            "World gauge set: 1 world unit = %.6f m, measured from map %s — %s. "
            "This is now stored and will not be re-measured; re-measuring a map "
            "changes that map's placement, not the scale of the house.",
            seed["m_per_unit"], seed["source_map_id"], seed["source_reason"],
        )
        return fabric_truth.metre_gauge(self)

    def has_spatial_model(self) -> bool:
        """Return True if real-world spatial data has been populated."""
        return bool(self.scanner_positions_m() or self.room_geometry_m() or self.beacon_positions_m())

    # ── Coordinate conversion ─────────────────────────────────────────────

    # The placement model, written down once:
    #
    #   metres = origin + R(ρ) · [[Sx, -Sy·sin σ], [0, Sy·cos σ]] · frac
    #
    # ρ = rotation_rad is the x axis's bearing; σ = shear_rad is how far the y
    # axis leans away from perpendicular to it, wrapped to (-π, π]. Five fields
    # are NOT enough: they can only describe a placement whose axes are square
    # to each other, and the renderer draws placements whose axes are not — a
    # Point Align full transform, a MIRRORED placement, or any rotated
    # placement on an anchor whose two axis scales disagree. All three were
    # recorded as the nearest square placement: about 9 cm per metre of the
    # map for a 5° lean, and the whole span of it for a mirror, moved
    # silently and with no way back.
    #
    # σ = 0 is the five-field arithmetic BIT FOR BIT — `rot + 0.0` is `rot`
    # exactly, so every existing placement converts through the same
    # multiplications in the same order it always did. σ = ±π is a mirror, so
    # reflection needs no flag of its own.

    def map_frac_to_metres(self, x_frac: float, y_frac: float, map_id: str) -> tuple[float, float] | None:
        """Convert map 0-1 fractions to real-world metres using stored transform."""
        t = (self.data.get("map_transforms") or {}).get(map_id)
        if not t:
            return None
        # The arithmetic lives in fabric_truth beside the decomposition that
        # is its inverse, so the record is evaluated in exactly one place —
        # everything comparing two placements evaluates them the same way.
        return fabric_truth.placement_metres(t, x_frac, y_frac)

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
        sig = float(t.get("shear_rad", 0) or 0)
        # How far the picture REACHES on each axis: `Sx` across, and
        # `Sy·|cos σ|` perpendicular to it, which is what a lean eats into. A
        # zero scale and a quarter-turn lean are the same refusal, asked once,
        # in metres. It was three thresholds, one of them on a bare cosine,
        # and that one let a quarter turn through — rounded to the store's
        # grid `cos σ` reads 3.3e-07. Held equal to
        # `fabric_truth.placement_is_readable` and the panel's
        # `metresToMapFrac`.
        cos_s = math.cos(sig)
        _min = fabric_truth.PLACEMENT_MIN_EXTENT_M
        if abs(sx) < _min or abs(sy) * abs(cos_s) < _min:
            return None
        rx = x_m - ox
        ry = y_m - oy
        if abs(rot) > 1e-9 or abs(sig) > 1e-9:
            cos_r = math.cos(rot)
            sin_r = math.sin(rot)
            cos_q = math.cos(rot + sig)
            sin_q = math.sin(rot + sig)
            dx = rx * cos_q + ry * sin_q
            dy = ry * cos_r - rx * sin_r
            return (dx / (sx * cos_s), dy / (sy * cos_s))
        return (rx / sx, ry / sy)

    # ── Spatial mutators ──────────────────────────────────────────────────

    async def async_set_scanner_position_m(
        self, source: str, x_m: float, y_m: float, z_m: float,
        floor_id: str, map_id: str | None = None,
    ) -> None:
        """Set a scanner's real-world position (canonical copy in the fabric)."""
        fab = getattr(self, "fabric", None)
        if not fab:
            return
        await fab.async_spatial_update(set_scanners={str(source): {
            "x_m": float(x_m), "y_m": float(y_m), "z_m": float(z_m),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
            "map_id": map_id,
        }}, op="scanner_set")

    async def async_set_rf_barrier_m(self, barrier: dict) -> dict | None:
        """Add or replace an RF barrier in real-world metres, by id.

        A barrier without an id is new and is given one. Returns the stored
        entry (with its id) so the caller can address it from then on.
        """
        fab = getattr(self, "fabric", None)
        if not fab:
            return None
        norm = fab._norm_barrier(dict(barrier))
        if norm is None:
            return None
        await fab.async_spatial_update(set_barriers=[norm], op="barrier_set")
        return next((b for b in fab.rf_barriers_m() if b.get("id") == norm["id"]), None)

    async def async_remove_rf_barrier_m(self, barrier_id: str) -> None:
        """Remove an RF barrier by id."""
        fab = getattr(self, "fabric", None)
        if not fab:
            return
        await fab.async_spatial_update(remove_barrier_ids=[str(barrier_id)], op="barrier_remove")

    def _put_map_transform(self, map_id: str, transform: dict) -> dict:
        """The ONE mutator of `map_transforms`. Nothing else may assign to it.

        INVARIANT: a map's placement changes in exactly one place. Three call
        sites used to assign `map_transforms[mid] = {...}` themselves — the
        build-from-maps derivation, the image-replacement recompute and the
        re-anchor preflight — so "what can move a map" was a question with
        four answers, and any field added to the record (shear_rad is the
        current one) had to be remembered at all four or it silently vanished
        on whichever path forgot it. Every historical desync in this codebase
        is two copies of a placement disagreeing; a second writer is how the
        second copy gets made. (`maps[].stack` had the same problem and the
        same fix: ws_fabric_map_stack_rebuild now goes through the maps
        store's `async_update_map` instead of assigning `m["stack"]`.)

        A field the new record does not MENTION is unchanged, not zero. That
        is the one rule this writer enforces, and it is what makes a
        five-field rebuild structurally impossible: a branch that builds a
        `{...}` literal and forgets σ leaves the map's lean alone instead of
        straightening it. Forgetting a field was the whole failure mode — the
        record grew a sixth one and the crop branch carried it, the bake
        branch did not, and each branch that rebuilds a record was one more
        place to remember. Only a caller that STATES a field may change it.

        `reference_measurements` is carried under the same rule, for the same
        reason: it is not a coordinate, but it is what makes a map MEASURED,
        and a record that omitted it turned a measured map into an unmeasured
        one — silently, and with the measurement gone. Four callers remembered
        it by hand; the fifth is a websocket handler taking a client dict.

        The pose rules and the field sanitise stay in
        async_set_map_transform, which has the policy the callers below are
        explicitly opting out of. This is the choke point, not the policy —
        it is where R3 will hook the derivation.

        The carry is written INTO the caller's dict rather than onto a copy:
        the record handed to this writer is the record stored, which is an
        invariant of its own (test_map_transform_single_writer.py).
        """
        old = (self.data.get("map_transforms") or {}).get(str(map_id)) or {}
        for _k in _CARRIED_FIELDS:
            if _k not in transform and _k in old:
                transform[_k] = old[_k]
        self.data.setdefault("map_transforms", {})[str(map_id)] = transform
        return transform

    async def async_set_map_transform(
        self, map_id: str, transform: dict, *, reanchor: bool = False
    ) -> None:
        """Set the affine transform for a map (frac ↔ metres).

        The world pose (origin + rotation) is write-once: once the stored
        transform carries a valid origin, saves keep it — a re-measure
        updates the scale without silently moving the world frame.  Only an
        explicit re-anchor (reanchor=True) may overwrite the pose.

        `shear_rad` is SHAPE, not pose, so it follows the scales rather than
        the origin: it says how the map's own two axes sit relative to each
        other, which is what a re-measure is entitled to restate.

        INVARIANT, for σ: it is changed only by a payload that STATES it.
        "Shape, not pose" says a re-measure MAY restate σ; it does not say a
        payload that never mentions σ has restated it as square.  Save Scale
        sends exactly five fields, so defaulting the missing key to 0
        straightened every sheared map the moment its scale was re-measured.

        The same rule now covers `reference_measurements`, one level down in
        `_put_map_transform`: an omitted key may not un-measure a map either.
        It was left out of R1 as a separate policy question about the metre
        anchor, and the answer is the same one — the record is otherwise
        REPLACED by the payload, so the four callers that build a record by
        hand carried it by hand, and the websocket writer that takes a client
        dict did not.

        The two SCALES are sanitised here rather than carried blindly,
        because they are the only fields whose value can make every later
        conversion raise or lie: `float(None)` is a TypeError in both
        directions, and a zero is a singular matrix that answers the origin
        for every point on the map. A payload that does not state a usable
        one has not restated the scale.
        """
        transforms = self.data.get("map_transforms") or {}
        new_t = dict(transform)
        old_t = transforms.get(str(map_id))
        # Sanitize the pose to finite floats (the ws layer accepts any dict).
        # shear_rad rides with them: it is a coordinate of the placement like
        # the others, and a string or a NaN in it would poison every later
        # conversion the same way.  Its default is the STORED value rather
        # than 0 — see the invariant above; an explicit `shear_rad: null` is
        # still a statement, and still sanitises to 0.
        for _k in ("origin_x_m", "origin_y_m", "rotation_rad", "shear_rad"):
            _default = (old_t or {}).get(_k, 0) if _k == "shear_rad" else 0
            try:
                _v = float(new_t.get(_k, _default) or 0)
            except (TypeError, ValueError):
                _v = 0.0
            new_t[_k] = _v if math.isfinite(_v) else 0.0
        # The scales: strictly positive and finite, or not a scale at all.
        # An unusable value falls back to the STORED scale — the σ rule again
        # — and with nothing stored the key is dropped, so the map reads as
        # having no scale rather than carrying a poisonous one. Every reader
        # already handles an absent scale; none of them handles a null.
        for _k in ("scale_x_m", "scale_y_m"):
            try:
                _v = float(new_t[_k])
            except (KeyError, TypeError, ValueError):
                _v = 0.0
            if math.isfinite(_v) and _v > 0:
                new_t[_k] = _v
                continue
            try:
                _v = float((old_t or {}).get(_k))
            except (TypeError, ValueError):
                _v = 0.0
            if math.isfinite(_v) and _v > 0:
                new_t[_k] = _v
            else:
                # Nothing usable on either side. The key has to end up ABSENT,
                # and `_put_map_transform`'s rule is that an absent key is
                # carried from the old record — which would put the unusable
                # stored value straight back. So it goes from the outgoing
                # record too; that record is being replaced on the next line
                # but one, and this is the only way to say "there is no scale"
                # through a writer whose rule is "absent means unchanged".
                new_t.pop(_k, None)
                if old_t is not None:
                    old_t.pop(_k, None)
        if not reanchor and _has_valid_origin(old_t):
            new_t["origin_x_m"] = float(old_t["origin_x_m"])
            new_t["origin_y_m"] = float(old_t["origin_y_m"])
            try:
                _rot = float(old_t.get("rotation_rad", 0) or 0)
            except (TypeError, ValueError):
                _rot = 0.0
            # A stored NaN/Inf must not be preserved over the sanitized
            # incoming value — it would poison every later conversion.
            new_t["rotation_rad"] = _rot if math.isfinite(_rot) else 0.0
        new_t["origin_anchored"] = True
        self._put_map_transform(map_id, new_t)
        await self.store.async_save(self.data)

    # ── Beacon positions (metre space) ──────────────────────────────────────

    def beacon_positions_m(self) -> dict[str, dict[str, Any]]:
        """Return {beacon_key: {x_m, y_m, floor_id, room, kind, label}}."""
        fab = getattr(self, "fabric", None)
        return fab.beacon_positions_m() if fab else {}

    async def async_set_beacon_position_m(
        self, key: str, x_m: float, y_m: float, floor_id: str,
        room: str = "", kind: str = "", label: str = "", map_id: str | None = None,
    ) -> None:
        """Set a beacon's real-world position (canonical copy in the fabric)."""
        fab = getattr(self, "fabric", None)
        if not fab:
            return
        await fab.async_spatial_update(set_beacons={str(key): {
            "x_m": round(float(x_m), 3),
            "y_m": round(float(y_m), 3),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
            "room": str(room),
            "kind": str(kind),
            "label": str(label),
            "map_id": map_id,
        }}, op="beacon_set")

    def light_positions_m(self) -> dict[str, dict[str, Any]]:
        """{entity_id: {x_m, y_m, floor_id, ...}} — read through the fabric."""
        fab = getattr(self, "fabric", None)
        return fab.light_positions_m() if fab else {}

    async def async_set_light_position_m(
        self, entity_id: str, x_m: float, y_m: float, floor_id: str,
        color: str = "", shape: str = "", rotation: float = 0.0,
        width_cm: float = 0.0, height_cm: float = 0.0, margin_cm: float = 0.0,
        label: str = "",
    ) -> None:
        """Place a light in real-world metres — the only way a light is placed."""
        fab = getattr(self, "fabric", None)
        if not fab:
            return
        entry = {
            "x_m": round(float(x_m), 3), "y_m": round(float(y_m), 3),
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID),
        }
        entry.update(light_appearance(color=color, shape=shape, rotation=rotation,
                                      width_cm=width_cm, height_cm=height_cm,
                                      margin_cm=margin_cm))
        if label:
            entry["label"] = str(label)[:120]
        await fab.async_spatial_update(set_lights={str(entity_id): entry}, op="light_set")

    async def async_remove_light_position_m(self, entity_id: str) -> None:
        fab = getattr(self, "fabric", None)
        if not fab:
            return
        await fab.async_spatial_update(remove_lights=[str(entity_id)], op="light_remove")

    async def async_remove_beacon_position_m(self, key: str) -> None:
        """Remove a beacon from metre-space positions."""
        fab = getattr(self, "fabric", None)
        if not fab:
            return
        await fab.async_spatial_update(remove_beacons=[str(key)], op="beacon_remove")

    def beacon_room_from_geometry(self, x_m: float, y_m: float, floor_id: str) -> str:
        """Determine which room a metre-space point falls in, from the fabric."""
        for room, geo in self.room_geometry_m().items():
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

    # ── Migration: derive transforms + convert map data to metres ─────────

    # ── Phase 4: map image replacement — recompute + re-derive ─────────────

    async def async_recompute_transform_for_map(
        self, map_id: str, map_dict: dict, maps_store: Any, crop: dict | None = None,
        pixel_op: dict | None = None, old_px: tuple[int, int] | None = None,
    ) -> bool:
        """Recompute a single map's frac↔metre transform after image replacement.

        Each image operation preserves a different invariant, and the backend
        cannot guess which one happened — the client declares it:

        crop ({fx0, fy0, fx1, fy1}, 0-1 fractions of the OLD image): the map
        keeps that fraction of its real-world extent, world-anchored (the
        origin shifts by the cut-off margin).  Exact under the client's
        resample — px_per_meter is not, since resampling changes pixel density.

        pixel_op ({deg, sx, sy} with old_px = (old_w, old_h)): a baked
        rotate/scale, canvas form p' = c_new + R(deg)·diag(sx, sy)·(p − c_old).
        A pure scale preserves extent; anything with a turn in it is composed
        by asking the OLD placement where the new image's corners came from,
        which is exact for every invertible op — rotation with an anisotropic
        stretch included.  That combination used to be refused as
        unrepresentable and the whole record dropped, which was true of the
        five-field model and stopped being true when σ was added: a rotated
        anisotropic bake is a general affine, and six fields hold every
        general affine there is.  A Point Align across two differently-shaped
        pictures bakes exactly that (issue #62), so a measured map read
        unmeasured after one click in the image editor.

        Neither: a pure resample, which preserves the real-world extent —
        unless the aspect ratio changed, which no known no-op replacement
        does, so that also invalidates rather than guessing.

        Returns True if the transform was updated (False = skipped or dropped).
        """
        cal = map_dict.get("calibration") or {}
        img = map_dict.get("image") or {}
        img_w = int(img.get("width") or 0)
        img_h = int(img.get("height") or 0)
        if img_w <= 0 or img_h <= 0:
            return False

        old_t = (self.data.get("map_transforms") or {}).get(map_id) or {}
        scale_x_m = scale_y_m = 0.0
        crop_origin: tuple[float, float] | None = None
        composed: dict[str, float] | None = None

        def _invalidate() -> None:
            (self.data.get("map_transforms") or {}).pop(map_id, None)

        # Bake (rotate and/or scale): compose the old transform with the op.
        if pixel_op and old_px and old_t.get("scale_x_m") and old_t.get("scale_y_m"):
            ow, oh = float(old_px[0]), float(old_px[1])
            theta = math.radians(float(pixel_op.get("deg", 0)))
            bsx = float(pixel_op.get("sx", 1)) or 1.0
            bsy = float(pixel_op.get("sy", 1)) or 1.0
            old_sx = float(old_t["scale_x_m"])
            old_sy = float(old_t["scale_y_m"])
            rot0 = float(old_t.get("rotation_rad", 0))
            o0x = float(old_t.get("origin_x_m", 0))
            o0y = float(old_t.get("origin_y_m", 0))
            if ow <= 0 or oh <= 0 or old_sx <= 0 or old_sy <= 0:
                pass  # nothing usable — fall through to the generic paths
            elif abs(theta) < 1e-9:
                # Pure per-axis pixel scale: the depicted extent is unchanged
                # (stretching pixels doesn't move the house), fracs map 1:1.
                composed = {
                    "origin_x_m": o0x, "origin_y_m": o0y,
                    "scale_x_m": old_sx, "scale_y_m": old_sy,
                    "rotation_rad": rot0,
                }
            else:
                # ASK THE PLACEMENT where the new image's corners came from,
                # then read the six fields off the two axes that come back —
                # the same route the crop takes below, and for the same
                # reason.  Rebuilt from the fields it was `ρ' = ρ − θ` with
                # the naive scales, which is the FIVE-field composition: a
                # turn moves a map's two axes together only while they are
                # square to each other, so a baked rotation on a sheared map
                # slid the picture by the lean — 1.09 m on this 20 m map at
                # 5° and a 30° turn, 2.18 m at 90°, and the record kept a σ
                # that no longer described the axes it was stored beside.
                #
                # New frac f' is at new pixel D₁·f' − c_new, which the op put
                # there from old pixel c_old + diag(1/sx, 1/sy)·R(θ)⁻¹·(that).
                # Over (ow, oh) that is the old fraction, and where THAT went
                # in metres is a question for the placement, not for a second
                # copy of it.
                #
                # The two divisors are PER AXIS because the op's are: the
                # stretch is applied inside the turn, so undoing it comes
                # after undoing the turn.  One averaged divisor is the same
                # arithmetic when sx == sy, and the composition it could not
                # do is the one this branch used to refuse.
                c1, s1 = math.cos(theta), math.sin(theta)

                def _from_frac(fx: float, fy: float) -> tuple[float, float] | None:
                    px = img_w * fx - img_w / 2.0
                    py = img_h * fy - img_h / 2.0
                    ux = (px * c1 + py * s1) / bsx
                    uy = (py * c1 - px * s1) / bsy
                    return self.map_frac_to_metres(
                        (ux + ow / 2.0) / ow, (uy + oh / 2.0) / oh, map_id)

                _o = _from_frac(0.0, 0.0)
                _ex = _from_frac(1.0, 0.0)
                _ey = _from_frac(0.0, 1.0)
                composed = fabric_truth.placement_from_columns(
                    _o, (_ex[0] - _o[0], _ex[1] - _o[1]),
                    (_ey[0] - _o[0], _ey[1] - _o[1]),
                ) if _o and _ex and _ey else None
                if composed is None:
                    # Degenerate axes: the op collapsed the map to a line.
                    _invalidate()
                    await self.store.async_save(self.data)
                    return False

        # Crop: the new image is the retained rectangle of the old one, and
        # `rebase_placement` is the ONE function that says what that does to a
        # placement — the same one the canvas extend and its revert go
        # through, because padding a canvas is a crop with the rectangle
        # bigger than the picture. There is no second copy on the stack to
        # keep in step any more: the stack is derived from what is written
        # here, so issue #62 has nothing left to happen between.
        if composed is None and crop and old_t.get("scale_x_m") and old_t.get("scale_y_m"):
            _fx0 = float(crop.get("fx0", 0))
            _fy0 = float(crop.get("fy0", 0))
            _fw = float(crop.get("fx1", 1)) - _fx0
            _fh = float(crop.get("fy1", 1)) - _fy0
            _rebased = fabric_truth.rebase_placement(old_t, _fx0, _fy0, _fw, _fh)
            if _rebased is not None:
                scale_x_m = _rebased["scale_x_m"]
                scale_y_m = _rebased["scale_y_m"]
                crop_origin = (_rebased["origin_x_m"], _rebased["origin_y_m"])

        if composed is None and not scale_x_m:
            ppm = cal.get("px_per_meter")
            if ppm and float(ppm) > 0:
                ppm = float(ppm)
            elif old_t.get("scale_x_m"):
                # No declared op — a pure resample keeps the real-world
                # extent.  A resample also keeps the PIXEL aspect ratio (the
                # scale aspect can legitimately differ after a stretch bake);
                # if the pixel aspect changed, this was some content-altering
                # operation the caller didn't declare, and extent-preserve
                # would write a distorted scale.  Drop it instead of guessing.
                if old_px and old_px[0] > 0 and old_px[1] > 0:
                    old_aspect = old_px[0] / old_px[1]
                    new_aspect = img_w / img_h
                    if abs(new_aspect - old_aspect) > 0.02 * old_aspect:
                        _invalidate()
                        await self.store.async_save(self.data)
                        return False
                ppm = img_w / float(old_t["scale_x_m"])
            else:
                return False
            scale_x_m = img_w / ppm
            scale_y_m = img_h / ppm

        fl = str(map_dict.get("floor_id", DEFAULT_FLOOR_ID))

        if composed is not None:
            # Baked op: everything comes from the composition.
            scale_x_m = composed["scale_x_m"]
            scale_y_m = composed["scale_y_m"]
            origin_x = composed["origin_x_m"]
            origin_y = composed["origin_y_m"]
            rot_rad = composed["rotation_rad"]
        else:
            # World pose.  An anchored transform keeps its origin and
            # rotation — a plain image replacement must never move the map.
            # A crop is world-anchored too: fabric data keeps its old world
            # coordinates, so the origin comes from the rebased placement.
            #
            # The three stack fallbacks that used to sit here are gone with
            # the stack: `rotation` off the alignment, `(0,0)` for a map
            # carrying the master flag, and `x_offset * scale_x_m` for
            # everyone else. All three answered "where is this map" from the
            # OTHER copy of the answer, which is what R3 deletes. A map with
            # no anchored placement being handed a new image is a map nobody
            # has placed, and the honest pose for one of those is the origin,
            # unturned — which is what the record already says, since an
            # unanchored record has no origin and no rotation to read.
            _anchored = _has_valid_origin(old_t)
            try:
                rot_rad = float(old_t.get("rotation_rad", 0) or 0)
            except (TypeError, ValueError):
                rot_rad = 0.0
            if not math.isfinite(rot_rad):
                rot_rad = 0.0
            if crop_origin is not None:
                origin_x, origin_y = crop_origin
            elif _anchored:
                origin_x = float(old_t["origin_x_m"])
                origin_y = float(old_t["origin_y_m"])
            else:
                origin_x, origin_y = 0.0, 0.0

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
        # σ is STATED only by the op that changes it. A baked rotation is the
        # one this function handles that does — it turns the x axis and the y
        # axis by different amounts unless they are already square, and a
        # stretch baked with it leans them apart on its own — so the
        # composition above hands back the lean it computed. A crop and an
        # axis-aligned pixel scale rescale the fraction axes without turning
        # either; neither says anything about the lean, so neither writes the
        # key and `_put_map_transform` carries the stored one forward. Absent
        # means unchanged, not square.
        if composed and "shear_rad" in composed:
            new_t["shear_rad"] = round(composed["shear_rad"], 6)
        self._put_map_transform(map_id, new_t)
        await self.store.async_save(self.data)
        return True

    async def async_rebase_placement(self, map_id: str, fx0: float, fy0: float,
                                     fw: float, fh: float) -> bool:
        """The new image is the old image's rectangle [fx0, fx0+fw] x [fy0,
        fy0+fh]. Move the placement with it. Returns True if it wrote.

        THE INVARIANT: an operation that changes what the picture COVERS
        changes the placement, in the same call, always. A pixel of the
        retained image has to stay on the same square metre of the house, and
        the only thing that can keep it there is the record — the picture
        carries no coordinates of its own.

        There are four such operations and two of them did not do this.  Crop
        and bake go through `async_recompute_transform_for_map`, which has
        rebased the record for releases.  `async_extend_canvas` and
        `async_revert_extend` renormalise every stored FRACTION — receivers,
        beacons, room bounds — into the new image's frac space and never
        touched the record, so a map padded 20% on the left kept a `scale_x_m`
        describing the old width and an origin pointing at the old top-left
        corner. That is issue #62 running the other way: live, unreported, and
        in two functions rather than one.  Both now come through here.
        """
        old_t = (self.data.get("map_transforms") or {}).get(str(map_id))
        rebased = fabric_truth.rebase_placement(old_t or {}, fx0, fy0, fw, fh)
        if rebased is None:
            return False        # unmeasured, or a degenerate rectangle
        self._put_map_transform(str(map_id), {
            "origin_x_m": round(rebased["origin_x_m"], 4),
            "origin_y_m": round(rebased["origin_y_m"], 4),
            "scale_x_m": round(rebased["scale_x_m"], 4),
            "scale_y_m": round(rebased["scale_y_m"], 4),
            "rotation_rad": round(rebased["rotation_rad"], 6),
            "shear_rad": round(rebased["shear_rad"], 6),
        })
        await self.store.async_save(self.data)
        return True

    async def async_rederive_map_fracs(self, map_id: str, map_dict: dict) -> int:
        """Re-derive map-fraction coordinates from metres for a single map.

        Display only, and one-directional: the fabric is read, the picture is
        drawn. A floor plan shows whatever the fabric puts inside its
        footprint — there is no ownership, because "this pin belongs to that
        photo" was photo-linked thinking. Nothing here writes the fabric.
        Returns count of items updated. Mutates map_dict in place.
        """
        count = 0
        positions = self.scanner_positions_m()
        barriers_m = self.rf_barriers_m()

        # ── Receivers ─────────────────────────────────────────────────────
        existing_receivers = map_dict.get("receivers") or []
        existing_sources = {(rx.get("source") or rx.get("id", "")) for rx in existing_receivers}

        for rx in existing_receivers:
            src = rx.get("source") or rx.get("id", "")
            if not src or src not in positions:
                continue
            pos = positions[src]
            fracs = self.metres_to_map_frac(float(pos["x_m"]), float(pos["y_m"]), map_id)
            if fracs:
                rx["x"] = round(max(0.0, min(1.0, fracs[0])), 4)
                rx["y"] = round(max(0.0, min(1.0, fracs[1])), 4)
                count += 1

        # Anything in the fabric that lands inside this image gets drawn on it.
        for src, pos in positions.items():
            if src in existing_sources:
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

        # ── Beacons ───────────────────────────────────────────────────────
        beacons_m = self.beacon_positions_m()
        existing_beacons = map_dict.get("beacons") or []
        existing_keys = {bk.get("key") for bk in existing_beacons if bk.get("key")}

        # Update existing beacon entries
        for bk in existing_beacons:
            bk_key = bk.get("key")
            if not bk_key or bk_key not in beacons_m:
                continue
            bm = beacons_m[bk_key]
            fracs = self.metres_to_map_frac(float(bm["x_m"]), float(bm["y_m"]), map_id)
            if fracs:
                bk["x"] = round(max(0.0, min(1.0, fracs[0])), 4)
                bk["y"] = round(max(0.0, min(1.0, fracs[1])), 4)
                count += 1

        # Anything in the fabric that lands inside this image gets drawn on it.
        for bk_key, bm in beacons_m.items():
            if bk_key in existing_keys:
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

    async def async_reanchor_map(
        self, map_id: str, map_dict: dict, cal_store: Any = None, *,
        origin_x_m: float | None = None, origin_y_m: float | None = None,
        rotation_rad: float | None = None,
        scale_x_m: float | None = None, scale_y_m: float | None = None,
        shear_rad: float | None = None,
    ) -> dict[str, Any]:
        """THE EXPLICIT COMMIT of a map's placement. All six fields.

        The only sanctioned way to move a map that is already placed.  The
        shared metre fabric is the truth: the new placement re-derives THIS
        map's fractional coordinates (calibration pins, receivers, barriers,
        beacons) from stored metres.  Preflights the calibration guard under
        the new placement and writes NOTHING if most pins would strand off
        the map.

        IT TOOK THREE FIELDS AND IT IS WHERE THE ALIGN EDITOR NOW LANDS, so it
        takes six.  The editor used to write `maps[].stack` — a second
        placement nothing here could see — and a drag that resized or sheared
        a map went to a writer with no scale to give it.  With the stack
        derived, a drag IS a placement, so it comes through the one writer
        that can refuse it.  The refusal is what makes this a commit rather
        than a gesture: a live 60 Hz drag must never meet a writer that can
        silently decline, so the drag moves nothing on disk and the owner's
        Save is the single call that either lands or comes back with a reason.

        With NO field given this is a no-op that still runs the guard, which
        is what an idempotence check wants.  It used to derive the pose from
        the stack in that case ("make the world match the display"); there is
        no display-only copy left to match.

        Mutates map_dict in place when map fracs re-derive — the caller
        must persist the maps store if map_items_rederived > 0.
        """
        transforms = self.data.get("map_transforms") or {}
        old_t = transforms.get(map_id)
        if not old_t or not old_t.get("scale_x_m") or not old_t.get("scale_y_m"):
            return {"ok": False, "error": "not_measured"}

        try:
            nx = float(origin_x_m if origin_x_m is not None else old_t.get("origin_x_m", 0))
            ny = float(origin_y_m if origin_y_m is not None else old_t.get("origin_y_m", 0))
            nrot = float(rotation_rad if rotation_rad is not None else old_t.get("rotation_rad", 0) or 0)
            nsx = float(scale_x_m if scale_x_m is not None else old_t["scale_x_m"])
            nsy = float(scale_y_m if scale_y_m is not None else old_t["scale_y_m"])
            nsig = float(shear_rad if shear_rad is not None else old_t.get("shear_rad", 0) or 0)
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid_pose"}
        if not all(math.isfinite(v) for v in (nx, ny, nrot, nsx, nsy, nsig)):
            return {"ok": False, "error": "invalid_pose"}

        # Only the fields the CALLER STATED are written, which is
        # `_put_map_transform`'s rule read from the other side: a re-anchor
        # that says nothing about the lean has not restated the lean, and
        # writing the stored value back through the store's 1 µrad grid would
        # quietly move it. The origin and rotation are always written because
        # re-anchoring the pose is what this is for.
        new_t = dict(old_t)
        new_t["origin_x_m"] = round(nx, 4)
        new_t["origin_y_m"] = round(ny, 4)
        new_t["rotation_rad"] = round(nrot, 6)
        if scale_x_m is not None:
            new_t["scale_x_m"] = round(nsx, 4)
        if scale_y_m is not None:
            new_t["scale_y_m"] = round(nsy, 4)
        if shear_rad is not None:
            new_t["shear_rad"] = round(nsig, 6)
        new_t["origin_anchored"] = True
        # A placement that covers no area does not place the map — the same
        # sentence `placement_is_readable` applies to a zero scale, asked
        # BEFORE the write rather than discovered after it. A commit is the
        # last point at which a singular placement can be refused instead of
        # stored, because after R3 nothing downstream compares it to anything.
        if not fabric_truth.placement_is_readable(new_t):
            return {"ok": False, "error": "invalid_pose"}

        # Preflight the remap guard under the new pose: swap in memory,
        # measure, and roll back before any await — nothing is persisted
        # unless the pose keeps the pins on the map. The swap and both
        # rollbacks go through the one mutator: a temporary placement is
        # still a placement, and _put_map_transform is what makes "everything
        # that can move a map" a list of one.
        self._put_map_transform(map_id, new_t)
        owned = owned_bad = 0
        for p in (cal_store.data.get("points") or []) if cal_store else []:
            if p.get("x_m") is None or p.get("map_id", "") != map_id:
                continue
            try:
                _xm, _ym = float(p["x_m"]), float(p["y_m"])
            except (KeyError, TypeError, ValueError):
                continue  # not evaluable — neither agreement nor failure
            owned += 1
            fr = self.metres_to_map_frac(_xm, _ym, map_id)
            if not fr or not (-0.05 <= fr[0] <= 1.05 and -0.05 <= fr[1] <= 1.05):
                owned_bad += 1
        if owned and owned_bad * 2 > owned:
            self._put_map_transform(map_id, old_t)
            return {
                "ok": False, "error": "points_out_of_range",
                "owned": owned, "out_of_range": owned_bad,
            }

        # Downstream failure must not leave the new pose persisted over old
        # fracs — that is the exact split-brain this action exists to
        # prevent.  Snapshot the mutable state and roll everything back if
        # the remap or re-derive fails.
        _cal_points_snap = (
            copy.deepcopy(cal_store.data.get("points")) if cal_store else None
        )
        _map_snap = copy.deepcopy(map_dict)
        await self.store.async_save(self.data)
        try:
            remapped = 0
            if cal_store:
                remapped = await cal_store.async_remap_from_metres(
                    map_id
                )
            rederived = await self.async_rederive_map_fracs(map_id, map_dict)
        except Exception as err:
            self._put_map_transform(map_id, old_t)
            if cal_store and _cal_points_snap is not None:
                cal_store.data["points"] = _cal_points_snap
            map_dict.clear()
            map_dict.update(_map_snap)
            try:
                await self.store.async_save(self.data)
            except Exception:
                pass  # best-effort — the in-memory state is consistent
            return {"ok": False, "error": "remap_failed", "detail": str(err)}
        return {
            "ok": True, "map_id": map_id,
            "origin_x_m": new_t["origin_x_m"],
            "origin_y_m": new_t["origin_y_m"],
            "rotation_rad": new_t["rotation_rad"],
            "scale_x_m": new_t.get("scale_x_m"),
            "scale_y_m": new_t.get("scale_y_m"),
            "shear_rad": new_t.get("shear_rad", 0.0),
            "cal_points_remapped": remapped,
            "map_items_rederived": rederived,
            "owned": owned, "out_of_range": owned_bad,
        }

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
            # Existing entries carry elevation data the caller may not send —
            # the floor editor posts {id, name} only, so merge rather than
            # rebuild or every save would wipe the stack heights.
            prior = {
                str(f.get("id")): f
                for f in (self.data.get("floors") or [])
                if isinstance(f, dict) and f.get("id")
            }
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
                merged = dict(prior.get(fid) or {})
                merged.update(f)
                merged["id"] = fid
                merged["name"] = (name or fid)[:80]
                norm_floors.append(_norm_floor(merged))
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
