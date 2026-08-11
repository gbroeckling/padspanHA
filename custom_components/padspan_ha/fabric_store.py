# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Fabric Store
=========================
The real-world room fabric: one coherent, directly-correctable set of room
shapes per floor, in metres.  This is GROUND TRUTH, never a cache.

Deliberately a physically separate persisted store (own storage key, own
version lineage) from ModelStore.  The uploaded photo/map is a ONE-TIME
BOOTSTRAP tool: async_commit_floor is the single moment a map's calibration
is ever consulted — after it returns, no code path may derive room geometry
from map state again.  A mis-pinned or never-measured photo therefore has
zero bearing on the fabric's correctness once a floor is built.

Exactly two methods write room geometry — nothing else may touch it:
  async_commit_floor    one-time bulk bootstrap of a floor from its maps
  async_correct_room    per-room direct correction (always allowed)
async_set_floor_committed flips only the committed flag, never geometry.

Data layout in .storage/padspan_ha.fabric:
  {
    "floors": {
      "<floor_id>": {
        "committed": bool,          # finalized — commit_floor refuses unless overwrite
        "committed_at": iso | None,
        "rooms": {
          "<room>": {
            "type": "poly"|"circle",
            "floor_id": str,        # mirrors the parent key; entries stay self-describing
            "points_m": [[x,y],..] | "cx_m"/"cy_m"/"r_m": float,
            "source_map_id": str|None,   # provenance, forensic only — never gates behavior
            "committed_by": "commit"|"correction"|"legacy_import"|"external_import",
            "revision": int,
            "committed_at": iso,
          }
        },
        # Whole-house shared XY frame hook (default = per-floor-siloed, as today).
        "frame_offset_m": {"dx_m": 0.0, "dy_m": 0.0, "rotation_rad": 0.0},
      }
    },
    "history": [ {ts, floor_id, room, op, revision} ]   # append-only, capped
  }
"""

import logging
import math
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DEFAULT_FLOOR_ID, FABRIC_STORE_KEY
from .safe_store import wrap_store

_LOGGER = logging.getLogger(__name__)

_HISTORY_CAP = 200


def _default_floor() -> dict[str, Any]:
    return {
        "committed": False,
        "committed_at": None,
        "rooms": {},
        "frame_offset_m": {"dx_m": 0.0, "dy_m": 0.0, "rotation_rad": 0.0},
    }


def _norm_geometry(geo: Any) -> dict[str, Any] | None:
    """Validate + normalize a geometry dict to only its shape keys.

    Returns {"type": "poly", "points_m": [...]} or
    {"type": "circle", "cx_m": .., "cy_m": .., "r_m": ..}, or None if invalid.
    """
    if not isinstance(geo, dict):
        return None
    gtype = geo.get("type", "poly")
    if gtype == "poly":
        pts = geo.get("points_m") or []
        out_pts: list[list[float]] = []
        for p in pts:
            try:
                x, y = float(p[0]), float(p[1])
            except (TypeError, ValueError, IndexError):
                return None
            if not (math.isfinite(x) and math.isfinite(y)):
                return None
            out_pts.append([round(x, 3), round(y, 3)])
        if len(out_pts) < 3:
            return None
        return {"type": "poly", "points_m": out_pts}
    if gtype == "circle":
        try:
            cx, cy, r = float(geo.get("cx_m")), float(geo.get("cy_m")), float(geo.get("r_m"))
        except (TypeError, ValueError):
            return None
        if not all(math.isfinite(v) for v in (cx, cy, r)) or r <= 0:
            return None
        return {"type": "circle", "cx_m": round(cx, 3), "cy_m": round(cy, 3), "r_m": round(r, 3)}
    return None


class FabricStore:
    """Room-geometry ground truth, per floor, in real-world metres."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._raw_store = Store(hass, 1, FABRIC_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "fabric")
        self.data: dict[str, Any] = {"floors": {}, "history": []}

    async def async_setup(self, legacy_geometry: dict[str, Any] | None = None) -> None:
        """Load the store; on very first load, import the legacy geometry.

        legacy_geometry is ModelStore's pre-fabric room_geometry_m dict.  The
        import is a VERBATIM copy of already-computed metre shapes (marked
        legacy_import, source unrecoverable) — deliberately NOT a re-derive
        from maps, which would re-run the fallback-scale math that corrupted
        the data in the first place.  It runs only when the fabric storage
        file does not exist yet, so it can never overwrite fabric state.
        """
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = dict(loaded)
            if not isinstance(self.data.get("floors"), dict):
                self.data["floors"] = {}
            if not isinstance(self.data.get("history"), list):
                self.data["history"] = []
            return

        self.data = {"floors": {}, "history": []}
        imported = 0
        now = dt_util.utcnow().isoformat()
        for room, geo in (legacy_geometry or {}).items():
            norm = _norm_geometry(geo)
            if norm is None or not isinstance(room, str):
                continue
            fl = str(geo.get("floor_id") or DEFAULT_FLOOR_ID)
            floor = self.data["floors"].setdefault(fl, _default_floor())
            floor["rooms"][room] = {
                **norm,
                "floor_id": fl,
                "source_map_id": None,
                "committed_by": "legacy_import",
                "revision": 1,
                "committed_at": now,
            }
            imported += 1
        if imported:
            self._log_history("", "", "legacy_import", imported)
            _LOGGER.info("FabricStore: imported %d legacy room shapes verbatim", imported)
        await self.store.async_save(self.data)

    # ── Reads ────────────────────────────────────────────────────────────────

    def rooms_flat(self) -> dict[str, dict[str, Any]]:
        """All rooms across floors as the flat {room: geometry} shape every
        consumer of the old room_geometry_m expects (floor_id inside each)."""
        out: dict[str, dict[str, Any]] = {}
        for floor in (self.data.get("floors") or {}).values():
            if isinstance(floor, dict):
                for room, geo in (floor.get("rooms") or {}).items():
                    if isinstance(geo, dict):
                        out[room] = dict(geo)
        return out

    def floor_committed(self, floor_id: str) -> bool:
        floor = (self.data.get("floors") or {}).get(str(floor_id))
        return bool(isinstance(floor, dict) and floor.get("committed"))

    def floors_status(self) -> dict[str, dict[str, Any]]:
        """{floor_id: {committed, committed_at, rooms}} for UI/health."""
        out: dict[str, dict[str, Any]] = {}
        for fl, floor in (self.data.get("floors") or {}).items():
            if isinstance(floor, dict):
                out[str(fl)] = {
                    "committed": bool(floor.get("committed")),
                    "committed_at": floor.get("committed_at"),
                    "rooms": len(floor.get("rooms") or {}),
                }
        return out

    def _find_room_floor(self, room: str) -> str | None:
        for fl, floor in (self.data.get("floors") or {}).items():
            if isinstance(floor, dict) and room in (floor.get("rooms") or {}):
                return str(fl)
        return None

    def _log_history(self, floor_id: str, room: str, op: str, revision: int) -> None:
        hist = self.data.setdefault("history", [])
        hist.append({
            "ts": dt_util.utcnow().isoformat(),
            "floor_id": floor_id,
            "room": room,
            "op": op,
            "revision": revision,
        })
        if len(hist) > _HISTORY_CAP:
            del hist[:-_HISTORY_CAP]

    # ── Writer 1: one-time bulk bootstrap ────────────────────────────────────

    async def async_commit_floor(
        self, floor_id: str, maps_store: Any, model_store: Any, mode: str = "bootstrap",
        source: str = "transforms",
    ) -> dict[str, Any]:
        """Build a floor's fabric from its maps — the one and only moment map
        state matters; after this call returns, maps never influence the
        fabric again.

        source picks which form of truth converts the traced bounds to metres:
          "transforms"  each map's own frac→metre calibration
          "stack"       the hand-tuned stack alignment, anchored to metres by
                        a genuinely measured map (the layout the Overview
                        shows — usually the accurate one)

        Merges by room name with master-map priority. Refuses on a committed
        floor, and on any floor that already has rooms, unless
        mode="overwrite" (which rebuilds and resets committed so the floor
        must be re-verified and re-finalized).
        """
        from . import fabric_truth

        fl = str(floor_id or DEFAULT_FLOOR_ID)
        existing = (self.data.get("floors") or {}).get(fl)
        if isinstance(existing, dict) and mode != "overwrite":
            # Bootstrap is strictly build-from-empty: a floor that already has
            # rooms (committed or not — e.g. freshly legacy-imported, awaiting
            # correction) must never be silently rebuilt from map math.
            if existing.get("committed"):
                return {"ok": False, "error": "already_committed", "floor_id": fl}
            if existing.get("rooms"):
                return {"ok": False, "error": "floor_has_rooms", "floor_id": fl}

        floor_maps = [
            m for m in (maps_store.data.get("maps") or [])
            if str(m.get("floor_id", DEFAULT_FLOOR_ID)) == fl
        ]

        if source == "stack":
            anchor = fabric_truth.find_metre_anchor(maps_store.data.get("maps") or [], model_store)
            if not anchor:
                return {"ok": False, "error": "no_metre_anchor", "floor_id": fl}
            candidate = fabric_truth.rooms_from_stack(floor_maps, anchor)
        else:
            candidate = fabric_truth.rooms_from_transforms(floor_maps, model_store)

        now = dt_util.utcnow().isoformat()
        prev_rooms = (existing.get("rooms") or {}) if isinstance(existing, dict) else {}
        new_rooms: dict[str, dict[str, Any]] = {}
        skipped_cross_floor: list[str] = []
        maps_used: list[str] = []

        for rname, geo in candidate.items():
            other = self._find_room_floor(rname)
            if other is not None and other != fl:
                skipped_cross_floor.append(rname)
                continue
            src_mid = geo.pop("source_map_id", None)
            norm = _norm_geometry(geo)
            if norm is None:
                continue
            prev = prev_rooms.get(rname)
            new_rooms[rname] = {
                **norm,
                "floor_id": fl,
                "source_map_id": src_mid,
                "committed_by": "commit",
                "revision": (int(prev.get("revision", 0)) + 1) if isinstance(prev, dict) else 1,
                "committed_at": now,
            }
            if src_mid and src_mid not in maps_used:
                maps_used.append(src_mid)

        if not new_rooms:
            return {"ok": False, "error": "no_mappable_rooms", "floor_id": fl}

        floor = existing if isinstance(existing, dict) else _default_floor()
        floor["rooms"] = new_rooms
        # An overwrite rebuild must be re-verified and re-finalized by hand.
        floor["committed"] = False
        floor["committed_at"] = None
        self.data.setdefault("floors", {})[fl] = floor
        self._log_history(fl, "", f"commit_floor:{mode}:{source}", len(new_rooms))
        await self.store.async_save(self.data)
        return {
            "ok": True, "floor_id": fl, "mode": mode, "source": source,
            "rooms": len(new_rooms), "maps_used": maps_used,
            "skipped_cross_floor": skipped_cross_floor,
        }

    # ── Writer 2: per-room direct correction ─────────────────────────────────

    async def async_correct_room(
        self, floor_id: str, room: str, geometry: dict[str, Any],
        committed_by: str = "correction",
    ) -> dict[str, Any]:
        """Directly set one room's real-world shape.  Always allowed —
        committed state never blocks correction, only bulk re-commits.

        committed_by="external_import" is merge-only: refuses if the room
        already exists anywhere (that's how external importers are prevented
        from silently overwriting corrected fabric).
        """
        fl = str(floor_id or DEFAULT_FLOOR_ID)
        room = str(room or "").strip()
        if not room:
            return {"ok": False, "error": "invalid_room"}
        norm = _norm_geometry(geometry)
        if norm is None:
            return {"ok": False, "error": "invalid_geometry"}

        other = self._find_room_floor(room)
        if committed_by == "external_import" and other is not None:
            return {"ok": False, "error": "exists", "floor_id": other}
        if other is not None and other != fl:
            return {"ok": False, "error": "room_on_other_floor", "floor_id": other}

        floor = self.data.setdefault("floors", {}).setdefault(fl, _default_floor())
        prev = (floor.get("rooms") or {}).get(room)
        revision = (int(prev.get("revision", 0)) + 1) if isinstance(prev, dict) else 1
        floor.setdefault("rooms", {})[room] = {
            **norm,
            "floor_id": fl,
            "source_map_id": prev.get("source_map_id") if isinstance(prev, dict) else None,
            "committed_by": committed_by,
            "revision": revision,
            "committed_at": dt_util.utcnow().isoformat(),
        }
        self._log_history(fl, room, committed_by, revision)
        await self.store.async_save(self.data)
        return {"ok": True, "floor_id": fl, "room": room, "revision": revision}

    # ── Committed flag (metadata only — never geometry) ──────────────────────

    async def async_set_floor_committed(self, floor_id: str, committed: bool) -> dict[str, Any]:
        """Finalize (lock) or unlock a floor.  Touches only the flag."""
        fl = str(floor_id or DEFAULT_FLOOR_ID)
        floor = self.data.setdefault("floors", {}).setdefault(fl, _default_floor())
        floor["committed"] = bool(committed)
        floor["committed_at"] = dt_util.utcnow().isoformat() if committed else None
        self._log_history(fl, "", "finalize" if committed else "unlock", 0)
        await self.store.async_save(self.data)
        return {"ok": True, "floor_id": fl, "committed": floor["committed"]}
