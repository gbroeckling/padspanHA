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

    # Pass 2 — spatial ground truth, same doctrine as rooms: metres are the
    # canonical values; a map drag is an INPUT DEVICE whose frac→metre
    # conversion happens once at write time.  Key names/shapes deliberately
    # mirror ModelStore's legacy keys so the one-time import is verbatim.
    "scanner_positions_m": { "<source>": {x_m, y_m, z_m, floor_id, map_id} },
    "beacon_positions_m":  { "<key>": {x_m, y_m, floor_id, room, kind, label, map_id} },
    "rf_barriers_m":       [ {name, material, attenuation_dbm, floor_id, points_m, map_id} ],

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
        self.data: dict[str, Any] = {
            "floors": {}, "scanner_positions_m": {},
            "beacon_positions_m": {}, "rf_barriers_m": [], "history": [],
        }

    _SPATIAL_KEYS = (
        ("scanner_positions_m", dict),
        ("beacon_positions_m", dict),
        ("rf_barriers_m", list),
    )

    async def async_setup(
        self, legacy_geometry: dict[str, Any] | None = None,
        legacy_spatial: dict[str, Any] | None = None,
    ) -> None:
        """Load the store; on very first load, import the legacy geometry.

        legacy_geometry is ModelStore's pre-fabric room_geometry_m dict.  The
        import is a VERBATIM copy of already-computed metre shapes (marked
        legacy_import, source unrecoverable) — deliberately NOT a re-derive
        from maps, which would re-run the fallback-scale math that corrupted
        the data in the first place.  It runs only when the fabric storage
        file does not exist yet, so it can never overwrite fabric state.

        legacy_spatial is ModelStore's pre-pass-2 spatial data (the three
        *_m keys).  Each key imports verbatim exactly once — only while the
        fabric file does not carry that key yet — so a pass-1 fabric file
        picks up its spatial sections on first boot of pass 2 and never again.
        """
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            self.data = dict(loaded)
            if not isinstance(self.data.get("floors"), dict):
                self.data["floors"] = {}
            if not isinstance(self.data.get("history"), list):
                self.data["history"] = []
            changed = self._import_legacy_spatial(legacy_spatial)
            changed = self._check_legacy_drift(legacy_geometry, legacy_spatial) or changed
            if changed:
                await self.store.async_save(self.data)
            return

        # Spatial keys deliberately absent here — _import_legacy_spatial
        # creates each one, importing legacy content in the same motion.
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
        self._import_legacy_spatial(legacy_spatial)
        # Record what this fabric was built from, so a later divergence (a
        # rollback-and-edit) is detectable instead of silently ignored.
        self.data["legacy_fingerprint"] = self._legacy_fingerprint(legacy_geometry, legacy_spatial)
        self.data["legacy_drift"] = False
        await self.store.async_save(self.data)

    @staticmethod
    def _legacy_fingerprint(
        legacy_geometry: dict[str, Any] | None,
        legacy_spatial: dict[str, Any] | None,
    ) -> str:
        """Stable hash of the legacy geometry/spatial data the fabric came from."""
        import hashlib  # noqa: PLC0415
        import json     # noqa: PLC0415

        payload = json.dumps(
            {"geometry": legacy_geometry or {}, "spatial": legacy_spatial or {}},
            sort_keys=True, default=str,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]

    def _check_legacy_drift(
        self,
        legacy_geometry: dict[str, Any] | None,
        legacy_spatial: dict[str, Any] | None,
    ) -> bool:
        """Detect legacy data that changed AFTER this fabric was imported.

        The fabric is imported from the legacy keys exactly once, and after
        that the legacy copies are never read again. That is correct going
        forwards — but it silently discards work done on an older version:
        roll back to a pre-fabric release, edit rooms or scanners (those
        writes land in the legacy keys), roll forward, and the fabric still
        exists, so nothing is imported and nothing reads the edits. The user
        sees their corrections quietly reverted, or worse, still sees the
        stale shape they thought they fixed.

        Fingerprinting the source at import time makes that detectable. This
        does NOT auto-import — silently overwriting a user's fabric would be
        the same mistake in the other direction — it records the divergence
        and raises a repairable notification so a human chooses.
        """
        fp = self._legacy_fingerprint(legacy_geometry, legacy_spatial)
        prev = self.data.get("legacy_fingerprint")
        if not prev:
            # Fabric imported before this guard existed: adopt the current
            # fingerprint as the baseline rather than crying drift on it.
            self.data["legacy_fingerprint"] = fp
            self.data["legacy_drift"] = False
            return True
        if prev == fp:
            return bool(self.data.pop("legacy_drift", False))
        self.data["legacy_fingerprint"] = fp
        self.data["legacy_drift"] = True
        self._log_history("", "", "legacy_drift_detected", 0)
        _LOGGER.warning(
            "FabricStore: the legacy room/scanner data changed since this fabric was "
            "imported — most likely PadSpan was rolled back, edited, and upgraded again. "
            "Those edits are NOT in the fabric and are not being used. Nothing has been "
            "overwritten; use Health → Rebuild fabric from legacy data to adopt them."
        )
        return True

    def _import_legacy_spatial(self, legacy_spatial: dict[str, Any] | None) -> bool:
        """Per-key one-time verbatim import of legacy spatial data.

        A key already present in the fabric file (even empty) is never
        touched — presence of the key IS the imported-once marker.
        """
        changed = False
        for key, typ in self._SPATIAL_KEYS:
            if isinstance(self.data.get(key), typ):
                continue
            src = (legacy_spatial or {}).get(key)
            if typ is dict:
                self.data[key] = {
                    str(k): dict(v) for k, v in (src or {}).items() if isinstance(v, dict)
                }
            else:
                self.data[key] = [dict(b) for b in (src or []) if isinstance(b, dict)]
            n = len(self.data[key])
            if n:
                self._log_history("", "", f"legacy_import:{key}", n)
                _LOGGER.info("FabricStore: imported %d legacy %s entries verbatim", n, key)
            changed = True
        return changed

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

    def scanner_positions_m(self) -> dict[str, dict[str, Any]]:
        """{source: {x_m, y_m, z_m, floor_id, map_id, ...}} — canonical."""
        return dict(self.data.get("scanner_positions_m") or {})

    def beacon_positions_m(self) -> dict[str, dict[str, Any]]:
        """{key: {x_m, y_m, floor_id, room, kind, label, map_id}} — canonical."""
        return dict(self.data.get("beacon_positions_m") or {})

    def rf_barriers_m(self) -> list[dict[str, Any]]:
        """[{name, material, attenuation_dbm, floor_id, points_m, ...}] — canonical."""
        return list(self.data.get("rf_barriers_m") or [])

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

    # ── Pass 2 writer: spatial ground truth (scanners/beacons/barriers) ──────
    #
    # One method is the ONLY write path for spatial data, mirroring the
    # two-writers discipline rooms have.  Callers (ModelStore delegates) do
    # any frac→metre conversion BEFORE calling; the fabric stores metres and
    # never consults a map.  One history entry and one save per call, however
    # many items a batch carries.

    @staticmethod
    def _norm_point_entry(entry: Any, *, need_z: bool) -> dict[str, Any] | None:
        if not isinstance(entry, dict):
            return None
        out = dict(entry)
        try:
            for k in ("x_m", "y_m") + (("z_m",) if need_z else ()):
                v = float(out.get(k, 0 if k == "z_m" else None))
                if not math.isfinite(v):
                    return None
                out[k] = v
        except (TypeError, ValueError):
            return None
        out["floor_id"] = str(out.get("floor_id") or DEFAULT_FLOOR_ID)
        return out

    @staticmethod
    def _norm_barrier(bar: Any) -> dict[str, Any] | None:
        if not isinstance(bar, dict) or not str(bar.get("name") or "").strip():
            return None
        pts = bar.get("points_m") or []
        out_pts: list[list[float]] = []
        for p in pts:
            try:
                x, y = float(p[0]), float(p[1])
            except (TypeError, ValueError, IndexError):
                return None
            if not (math.isfinite(x) and math.isfinite(y)):
                return None
            out_pts.append([x, y])
        if len(out_pts) < 2:
            return None
        out = dict(bar)
        out["points_m"] = out_pts
        out["floor_id"] = str(out.get("floor_id") or DEFAULT_FLOOR_ID)
        return out

    async def async_spatial_update(
        self, *,
        set_scanners: dict[str, dict] | None = None,
        remove_scanners: list[str] | None = None,
        set_beacons: dict[str, dict] | None = None,
        remove_beacons: list[str] | None = None,
        set_barriers: list[dict] | None = None,
        remove_barrier_names: list[str] | None = None,
        replace_map_barriers: tuple[str, list[dict]] | None = None,
        op: str = "spatial_update",
    ) -> dict[str, int]:
        """Apply a set of spatial changes atomically.

        set_barriers replaces by name (today's semantics);
        replace_map_barriers=(map_id, barriers) drops every barrier that
        map drew and installs the given list — the Edit-tab save shape.
        Barriers are the one thing the photo still edits (they have no stable
        identity of their own to correct in metres), so a hand-placed barrier
        carries no map_id and is never swept up here.
        Invalid entries are skipped, not fatal.  Returns per-kind counts.
        """
        counts = {"scanners": 0, "beacons": 0, "barriers": 0, "removed": 0}
        scanners = self.data.setdefault("scanner_positions_m", {})
        beacons = self.data.setdefault("beacon_positions_m", {})

        for src, entry in (set_scanners or {}).items():
            norm = self._norm_point_entry(entry, need_z=True)
            if norm is None or not str(src):
                continue
            scanners[str(src)] = norm
            counts["scanners"] += 1
        for src in (remove_scanners or []):
            if scanners.pop(str(src), None) is not None:
                counts["removed"] += 1

        for key, entry in (set_beacons or {}).items():
            norm = self._norm_point_entry(entry, need_z=False)
            if norm is None or not str(key):
                continue
            beacons[str(key)] = norm
            counts["beacons"] += 1
        for key in (remove_beacons or []):
            if beacons.pop(str(key), None) is not None:
                counts["removed"] += 1

        barriers = self.data.setdefault("rf_barriers_m", [])
        if replace_map_barriers is not None:
            mid, new_bars = replace_map_barriers
            kept = [
                b for b in barriers
                if b.get("map_id") != str(mid)
            ]
            counts["removed"] += len(barriers) - len(kept)
            barriers = kept
            for bar in (new_bars or []):
                norm = self._norm_barrier(bar)
                if norm is not None:
                    barriers.append(norm)
                    counts["barriers"] += 1
            self.data["rf_barriers_m"] = barriers
        if set_barriers:
            for bar in set_barriers:
                norm = self._norm_barrier(bar)
                if norm is None:
                    continue
                barriers = [b for b in barriers if b.get("name") != norm.get("name")]
                barriers.append(norm)
                counts["barriers"] += 1
            self.data["rf_barriers_m"] = barriers
        if remove_barrier_names:
            names = {str(n) for n in remove_barrier_names}
            kept = [b for b in barriers if b.get("name") not in names]
            counts["removed"] += len(barriers) - len(kept)
            self.data["rf_barriers_m"] = kept

        total = counts["scanners"] + counts["beacons"] + counts["barriers"] + counts["removed"]
        if total:
            self._log_history("", "", op, total)
            await self.store.async_save(self.data)
        return counts
