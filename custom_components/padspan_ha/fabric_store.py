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
version lineage) from ModelStore.  A photo is one way to say where something
is, never where it stays: rooms may be traced on one and adopted through the
Rooms tab, and after that exactly ONE code path may derive room geometry from
map state again — the explicit, provenance-gated reconcile (see
`fabric_truth.reconcilable_rooms`). It runs only as a deliberate action,
never as a side effect of another save, and it may touch only a room whose
stored value is provably the pure output of that map's placement
(`source_transform` recorded, geometry never hand-edited since). A room a
person has corrected is structurally out of its reach. A mis-pinned or
never-measured photo still has zero bearing on the fabric.

That is a deliberate loosening of what this header used to promise ("no code
path derives room geometry from map state afterwards"). The old promise was
written when the alternative was `async_rederive_map_fracs` — an automatic,
silent, error-swallowing rewrite that fired as a side effect of unrelated
saves and overwrote hand-traced work through whatever transform happened to
be current (f3466fc). The reconcile is the opposite of that on every axis
that made it dangerous: opt-in, reported, provenance-gated, and it writes
through the one writer below rather than beside it.

Exactly one method writes room geometry — nothing else may touch it:
  async_correct_room    per-room direct correction (always allowed);
                        the reconcile persists through this same method.
async_set_floor_committed flips only the committed flag, never geometry.

Data layout in .storage/padspan_ha.fabric:
  {
    "floors": {
      "<floor_id>": {
        "committed": bool,          # finalized (metadata only)
        "committed_at": iso | None,
        "rooms": {
          "<room>": {
            "type": "poly"|"circle",
            "floor_id": str,        # mirrors the parent key; entries stay self-describing
            "points_m": [[x,y],..] | "cx_m"/"cy_m"/"r_m": float,
            # Provenance. Present TOGETHER, only while the stored geometry is
            # the pure, unedited output of that map's placement — the write
            # that stamps them is a map-derived commit or a reconcile, and
            # ANY other write (a hand correction above all) clears BOTH.
            # They gate exactly one behavior: eligibility for the explicit
            # reconcile. Nothing else may read them to decide anything.
            "source_map_id": str|None,
            "source_transform": dict|None,  # that map's placement at stamp time
            "committed_by": "commit"|"correction"|"legacy_import"|"external_import"|"reconcile",
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
    "rf_barriers_m":       [ {id, name, material, attenuation_dbm, floor_id, points_m} ],
    "light_positions_m":   { "<entity_id>": {x_m, y_m, floor_id, color, shape, rotation, width_cm, height_cm, label} },

    "history": [ {ts, floor_id, room, op, revision} ]   # append-only, capped
  }
"""

import logging
import math
import os
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
            "beacon_positions_m": {}, "rf_barriers_m": [], "light_positions_m": {},
            "history": [],
        }

    _SPATIAL_KEYS = (
        ("scanner_positions_m", dict),
        ("beacon_positions_m", dict),
        ("rf_barriers_m", list),
        ("light_positions_m", dict),
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

    def light_positions_m(self) -> dict[str, dict[str, Any]]:
        """{entity_id: {x_m, y_m, floor_id, ...}} — canonical light placement."""
        return dict(self.data.get("light_positions_m") or {})

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

    # ── The room writer: direct correction, always in metres ─────────────────────────────────

    async def async_correct_room(
        self, floor_id: str, room: str, geometry: dict[str, Any],
        committed_by: str = "correction",
        source_map_id: str | None = None,
        source_transform: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Directly set one room's real-world shape.  Always allowed —
        committed state never blocks correction, only bulk re-commits.

        committed_by="external_import" is merge-only: refuses if the room
        already exists anywhere (that's how external importers are prevented
        from silently overwriting corrected fabric).

        Provenance is stamped only when BOTH source fields arrive together —
        the caller asserting "this geometry is exactly what that map's
        placement implies right now". Every other write CLEARS both, on
        purpose: a hand correction makes that claim false even when the map
        has not moved, and the old carry-forward here would have kept a claim
        the geometry no longer honours. Provenance gates exactly one thing,
        eligibility for the explicit reconcile, so a stale stamp is not a
        cosmetic error — it is what would let the reconcile overwrite a
        person's work.
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

        stamped = bool(source_map_id) and isinstance(source_transform, dict)
        floor = self.data.setdefault("floors", {}).setdefault(fl, _default_floor())
        prev = (floor.get("rooms") or {}).get(room)
        revision = (int(prev.get("revision", 0)) + 1) if isinstance(prev, dict) else 1
        floor.setdefault("rooms", {})[room] = {
            **norm,
            "floor_id": fl,
            "source_map_id": str(source_map_id) if stamped else None,
            "source_transform": dict(source_transform) if stamped else None,
            "committed_by": committed_by,
            "revision": revision,
            "committed_at": dt_util.utcnow().isoformat(),
        }
        self._log_history(fl, room, committed_by, revision)
        await self.store.async_save(self.data)
        return {"ok": True, "floor_id": fl, "room": room, "revision": revision}

    async def async_remove_room(self, room: str) -> dict[str, Any]:
        """Delete a room's real-world shape.  The counterpart to correction.

        There was no way to do this. `fabric_room_remove` removed a room from
        room_meta, adjacency and the scanner map — all of which live in the
        ModelStore blob — and left `room_geometry_m` untouched, because that
        moved to the fabric and the handler was never updated. The room
        therefore kept its shape: it went on drawing on the map, went on
        appearing in `_fabric_rooms`, and went on being a candidate the
        positioning pipeline could pick. Deleting a room did nothing a user
        could see, which is exactly how it was reported.

        Geometry is the room. Removing it here is what makes the delete real.
        """
        room = str(room or "").strip()
        if not room:
            return {"ok": False, "error": "invalid_room"}
        fl = self._find_room_floor(room)
        if fl is None:
            # Nothing to remove is a successful delete, not a failure — the
            # caller is also clearing metadata and must not be stopped.
            return {"ok": True, "room": room, "removed": False}
        floor = (self.data.get("floors") or {}).get(fl) or {}
        rooms = floor.get("rooms") or {}
        prev = rooms.pop(room, None)
        revision = (int(prev.get("revision", 0)) + 1) if isinstance(prev, dict) else 1
        self._log_history(fl, room, "remove", revision)
        await self.store.async_save(self.data)
        return {"ok": True, "room": room, "floor_id": fl, "removed": True}

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
        """A barrier is a wall in metres with an IDENTITY of its own.

        Barriers used to be matched by name, and unnamed ones were called
        "Barrier {n}" by position in a list — so reordering renamed them, two
        floors' "Barrier 1" replaced each other, and the photo they were
        drawn on had to stay their editor of record because nothing else
        could say which wall was which. Every barrier now carries an id;
        the name is a label.
        """
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
        out["id"] = str(out.get("id") or "").strip()[:40] or f"bar_{os.urandom(4).hex()}"
        out.pop("map_id", None)   # a wall is not "on" a photograph
        return out

    async def async_spatial_update(
        self, *,
        set_scanners: dict[str, dict] | None = None,
        remove_scanners: list[str] | None = None,
        set_beacons: dict[str, dict] | None = None,
        remove_beacons: list[str] | None = None,
        set_lights: dict[str, dict] | None = None,
        remove_lights: list[str] | None = None,
        set_barriers: list[dict] | None = None,
        remove_barrier_ids: list[str] | None = None,
        op: str = "spatial_update",
    ) -> dict[str, int]:
        """Apply a set of spatial changes atomically.

        set_barriers replaces by id (a barrier without one is new and gets
        one); remove_barrier_ids removes by id. There is no per-photo
        replace any more: a wall is placed and edited in metres like a
        scanner or a room, and no photograph owns a list of them.
        Invalid entries are skipped, not fatal.  Returns per-kind counts.
        """
        counts = {"scanners": 0, "beacons": 0, "barriers": 0, "lights": 0, "removed": 0}
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

        lights = self.data.setdefault("light_positions_m", {})
        for eid, entry in (set_lights or {}).items():
            norm = self._norm_point_entry(entry, need_z=False)
            if norm is None or not str(eid):
                continue
            lights[str(eid)] = norm
            counts["lights"] += 1
        for eid in (remove_lights or []):
            if lights.pop(str(eid), None) is not None:
                counts["removed"] += 1

        barriers = self.data.setdefault("rf_barriers_m", [])
        if set_barriers:
            for bar in set_barriers:
                norm = self._norm_barrier(bar)
                if norm is None:
                    continue
                barriers = [b for b in barriers if b.get("id") != norm["id"]]
                barriers.append(norm)
                counts["barriers"] += 1
            self.data["rf_barriers_m"] = barriers
        if remove_barrier_ids:
            ids = {str(i) for i in remove_barrier_ids}
            kept = [b for b in barriers if b.get("id") not in ids]
            counts["removed"] += len(barriers) - len(kept)
            self.data["rf_barriers_m"] = kept

        total = (counts["scanners"] + counts["beacons"] + counts["barriers"]
                 + counts["lights"] + counts["removed"])
        if total:
            self._log_history("", "", op, total)
            await self.store.async_save(self.data)
        return counts
