# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Maps Store
========================
Persists floor-plan map metadata (name, floor, room bounds, receivers, beacons,
alignment stack) and the associated PNG image files on disk.

Data layout:
  - Metadata: .storage/padspan_ha.maps  →  {"maps": [MapDict, ...]}
  - Images:   www/padspan_ha/maps/{map_id}.png

Each map dict holds:
  - id, name, created, updated
  - image: {filename, width, height, sha256, ...}
  - receivers: [{id, label, x, y, room, source}, ...]    (scanner pin positions)
  - beacons:   [{id, label, key, x, y, kind}, ...]       (beacon pin positions)
  - lights:    LEGACY, read once by the lights_to_metres migration and never
               written again — a light is placed in metres in the fabric
               (light_positions_m).
  - room_bounds: {roomName: {type:"poly", points:[[x,y],...]} | {type:"circle",...}}
  - calibration: {mode, px_per_meter, reference_points}
  - stack: {z_level, x_offset, y_offset, scale, rotation, ...}  (alignment transform)
  - floor_id, notes

Coordinate convention: all positions are normalised 0-1 fractions of the image
dimensions (x = left-to-right, y = top-to-bottom).
"""

import asyncio
import base64
import hashlib
import math
import os
import struct
import zlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import MAPS_STORE_KEY, MAPS_DIR, DEFAULT_FLOOR_ID, MAX_HEIGHT_M
from .safe_store import wrap_store

MAX_MAP_BYTES = 20 * 1024 * 1024  # 20 MB decoded limit — prevents OOM on large uploads

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def _sha256(data: bytes) -> str:
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


@dataclass
class MapsStore:
    """Manages floor-plan map metadata and image files.

    Images live on disk at www/padspan_ha/maps/{map_id}.png so HA's
    built-in static file server exposes them at /local/padspan_ha/maps/.
    Metadata lives in HA Storage (.storage/padspan_ha.maps).
    """

    hass: HomeAssistant
    store: Store
    maps_dir: Path
    data: dict[str, Any] = field(default_factory=lambda: {"maps": []})

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._raw_store = Store(hass, 1, MAPS_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "maps")
        self.maps_dir = Path(hass.config.path("www")) / MAPS_DIR
        self.data = {"maps": []}

    async def async_setup(self) -> None:
        """Load stored map data and ensure the image directory exists.

        Also normalises legacy map dicts to include all expected fields
        (receivers, beacons, calibration, room_bounds, stack, etc.) so
        downstream code never needs defensive .get() chains.
        """
        await asyncio.to_thread(self.maps_dir.mkdir, parents=True, exist_ok=True)
        loaded = await self.store.async_load()
        if isinstance(loaded, dict) and "maps" in loaded:
            self.data = loaded
        else:
            self.data = {"maps": []}

        # Normalise existing maps — fill in fields added in later versions
        _migrated_open_barriers = False
        for m in self.data.get("maps", []):
            m.setdefault("receivers", [])
            m.setdefault("beacons", [])
            m.setdefault("calibration", {"mode": "none", "px_per_meter": None, "reference_points": []})
            m.setdefault("notes", "")
            m.setdefault("floor_id", DEFAULT_FLOOR_ID)
            m.setdefault("room_bounds", {})
            # Normalize receivers to include optional fields
            recs = m.get("receivers") or []
            if isinstance(recs, list):
                for r in recs:
                    if isinstance(r, dict):
                        r.setdefault("room", "")
                        r.setdefault("source", "")
            m.setdefault("stack", {"z_level": 0, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0, "ceiling_height_m": 2.4})
            m.setdefault("created", _now_iso())
            m.setdefault("updated", m.get("created", _now_iso()))
            # One-time migration (P0-11.3): a frontend falsy-zero bug
            # (`_matAtten[mat] || 6`) saved "open" (no wall) barriers with
            # attenuation_dbm 6 instead of 0. Material is stored, so reset.
            for bar in m.get("rf_barriers") or []:
                if (
                    isinstance(bar, dict)
                    and bar.get("material") == "open"
                    and bar.get("attenuation_dbm") not in (0, 0.0)
                ):
                    bar["attenuation_dbm"] = 0.0
                    _migrated_open_barriers = True

        # Only re-save if normalization added missing fields
        import json
        if (json.dumps(self.data, sort_keys=True) != json.dumps(loaded, sort_keys=True) if loaded else True) or _migrated_open_barriers:
            await self.store.async_save(self.data)

    def list_maps(self) -> list[dict[str, Any]]:
        return list(self.data.get("maps", []))

    def get_map(self, map_id: str) -> dict[str, Any] | None:
        for m in self.data.get("maps", []):
            if m.get("id") == map_id:
                return m
        return None

    async def async_add_map(self, name: str, filename: str, mime: str, width: int, height: int, png_base64: str, floor_id: str | None = None) -> dict[str, Any]:
        """Create a new map from an uploaded PNG image.

        Writes the image file to disk, creates the metadata dict with default
        stack/calibration/bounds, and persists to storage.
        """
        # Reject oversized uploads before decoding (avoid OOM)
        max_b64_len = (MAX_MAP_BYTES * 4) // 3 + 4
        if len(png_base64) > max_b64_len:
            raise ValueError(f"Map image exceeds {MAX_MAP_BYTES // (1024*1024)} MB limit")
        raw = base64.b64decode(png_base64)
        if len(raw) > MAX_MAP_BYTES:
            raise ValueError(f"Map image exceeds {MAX_MAP_BYTES // (1024*1024)} MB limit")
        map_id = os.urandom(8).hex()
        file_name = f"{map_id}.png"
        file_path = self.maps_dir / file_name
        await asyncio.to_thread(file_path.write_bytes, raw)

        info = {
            "id": map_id,
            "name": (name or "Untitled Map")[:120],
            "created": _now_iso(),
            "updated": _now_iso(),
            "image": {
                "filename": file_name,
                "original_filename": (filename or "map")[:180],
                "mime": "image/png",
                "original_mime": (mime or "image/*")[:80],
                "width": int(width or 0),
                "height": int(height or 0),
                "size_bytes": len(raw),
                "sha256": _sha256(raw),
            },
            "calibration": {"mode": "none", "px_per_meter": None, "reference_points": []},
            "receivers": [],
            "beacons": [],
            "room_bounds": {},
            "floor_id": str(floor_id or DEFAULT_FLOOR_ID)[:40],
            "notes": "",
            "stack": {"z_level": 0, "x_offset": 0.0, "y_offset": 0.0, "scale": 1.0, "ceiling_height_m": 2.4},
        }

        self.data.setdefault("maps", [])
        self.data["maps"].append(info)
        await self.store.async_save(self.data)
        return info

    async def async_update_map(self, map_id: str, *, receivers: list[dict[str, Any]] | None = None, beacons: list[dict[str, Any]] | None = None, calibration: dict[str, Any] | None = None, notes: str | None = None, floor_id: str | None = None, room_bounds: dict[str, Any] | None = None, stack: dict | None = None) -> dict[str, Any]:
        """Update map metadata — only fields that are not None are changed.

        Each field is validated and sanitised (coords clamped 0-1, strings
        truncated, etc.) before being stored.  The stack dict preserves
        alignment fields (is_master, ref_map_id, ref_ar, scale_x_adj, tie_ins)
        across partial updates so alignment state is never accidentally lost.
        """
        m = self.get_map(map_id)
        if not m:
            raise KeyError("not_found")

        if isinstance(receivers, list):
            clean: list[dict[str, Any]] = []
            for r in receivers:
                if not isinstance(r, dict):
                    continue
                rx = {
                    "id": str(r.get("id") or "")[:80],
                    "label": str(r.get("label") or "")[:120],
                    "x": float(r.get("x") or 0.0),
                    "y": float(r.get("y") or 0.0),
                    "room": str(r.get("room") or "")[:120],
                    "source": str(r.get("source") or "")[:80],
                }
                rx["x"] = max(0.0, min(1.0, rx["x"]))
                rx["y"] = max(0.0, min(1.0, rx["y"]))
                if rx["id"] or rx["label"]:
                    clean.append(rx)
            m["receivers"] = clean

        if isinstance(beacons, list):
            clean_bk: list[dict[str, Any]] = []
            for bk in beacons:
                if not isinstance(bk, dict):
                    continue
                entry = {
                    "id": str(bk.get("id") or f"bk_{os.urandom(4).hex()}")[:80],
                    "label": str(bk.get("label") or "")[:120],
                    "key": str(bk.get("key") or "")[:200],
                    "x": float(bk.get("x") or 0.0),
                    "y": float(bk.get("y") or 0.0),
                    "kind": str(bk.get("kind") or "")[:20],
                }
                entry["x"] = max(0.0, min(1.0, entry["x"]))
                entry["y"] = max(0.0, min(1.0, entry["y"]))
                if entry["key"]:
                    clean_bk.append(entry)
            m["beacons"] = clean_bk

        if isinstance(calibration, dict):
            m["calibration"] = {
                "mode": str(calibration.get("mode") or "none"),
                "px_per_meter": calibration.get("px_per_meter"),
                "reference_points": calibration.get("reference_points") or [],
            }

        if notes is not None:
            m["notes"] = str(notes)[:10000]

        if floor_id is not None:
            m["floor_id"] = str(floor_id or DEFAULT_FLOOR_ID)[:40]

        if isinstance(room_bounds, dict):
            # room_bounds: { roomName: {type:"poly", points:[[x,y],...]} | {type:"circle", cx,cy,r} }
            clean_rb: dict[str, Any] = {}
            for room, b in room_bounds.items():
                if not isinstance(room, str) or not isinstance(b, dict):
                    continue
                rname = room[:120]
                btype = str(b.get("type") or "poly")
                if btype == "poly":
                    pts = b.get("points")
                    if not isinstance(pts, list) or len(pts) < 3:
                        continue
                    clean_pts = []
                    for p in pts:
                        if not isinstance(p, (list, tuple)) or len(p) < 2:
                            continue
                        x = float(p[0])
                        y = float(p[1])
                        x = max(0.0, min(1.0, x))
                        y = max(0.0, min(1.0, y))
                        clean_pts.append([x, y])
                    if len(clean_pts) >= 3:
                        clean_rb[rname] = {"type": "poly", "points": clean_pts}
                elif btype == "circle":
                    try:
                        cx = float(b.get("cx") or 0.5)
                        cy = float(b.get("cy") or 0.5)
                        rr = float(b.get("r") or 0.12)
                        cx = max(0.0, min(1.0, cx))
                        cy = max(0.0, min(1.0, cy))
                        rr = max(0.01, min(0.5, rr))
                        clean_rb[rname] = {"type": "circle", "cx": cx, "cy": cy, "r": rr}
                    except Exception:
                        continue
            m["room_bounds"] = clean_rb

        if isinstance(stack, dict):
            # Clamp numeric values to sane ranges to prevent broken rendering
            z = max(0, min(20, int(stack.get("z_level", 0))))
            sc = max(0.1, min(10.0, float(stack.get("scale", 1.0))))
            ceil_h = max(1.5, min(MAX_HEIGHT_M, float(stack.get("ceiling_height_m", 2.4))))
            rot = float(stack.get("rotation", 0.0))
            new_stack: dict[str, Any] = {
                "z_level": z,
                "x_offset": float(stack.get("x_offset", 0.0)),
                "y_offset": float(stack.get("y_offset", 0.0)),
                "scale": sc,
                "ceiling_height_m": ceil_h,
                "rotation": rot,
            }
            # Preserve alignment fields that may not be in the incoming payload
            # (e.g. when only z_level or ceiling_height is being updated from
            # the 3D Stack table — the caller shouldn't need to re-send the
            # full alignment state every time)
            if "is_master" in stack:
                new_stack["is_master"] = bool(stack["is_master"])
            elif m.get("stack", {}).get("is_master"):
                new_stack["is_master"] = True
            if "ref_map_id" in stack:
                new_stack["ref_map_id"] = str(stack["ref_map_id"]) if stack["ref_map_id"] else None
            elif m.get("stack", {}).get("ref_map_id"):
                new_stack["ref_map_id"] = m["stack"]["ref_map_id"]
            if "ref_ar" in stack:
                new_stack["ref_ar"] = float(stack["ref_ar"]) if stack["ref_ar"] is not None else None
            elif m.get("stack", {}).get("ref_ar") is not None:
                new_stack["ref_ar"] = m["stack"]["ref_ar"]
            if "scale_x_adj" in stack:
                new_stack["scale_x_adj"] = max(0.01, min(100.0, float(stack.get("scale_x_adj", 1.0))))
            elif m.get("stack", {}).get("scale_x_adj") is not None:
                new_stack["scale_x_adj"] = m["stack"]["scale_x_adj"]
            if "tie_ins" in stack:
                new_stack["tie_ins"] = stack["tie_ins"] if isinstance(stack["tie_ins"], list) else []
            elif m.get("stack", {}).get("tie_ins"):
                new_stack["tie_ins"] = m["stack"]["tie_ins"]
            # Raw affine matrix from Point Align solver — stored as [m11,m12,m21,m22].
            # If present, the stack renderer uses CSS matrix() instead of the lossy
            # decomposed scale/rotation/scaleX_adj fallback.
            if "_m" in stack:
                raw_m = stack.get("_m")
                if isinstance(raw_m, list) and len(raw_m) == 4:
                    new_stack["_m"] = [float(v) for v in raw_m]
                    new_stack["_m_ar"] = float(stack.get("_m_ar", 1.0))
                else:
                    new_stack["_m"] = None
                    new_stack["_m_ar"] = None
            elif m.get("stack", {}).get("_m"):
                new_stack["_m"] = m["stack"]["_m"]
                new_stack["_m_ar"] = m["stack"].get("_m_ar")
            m["stack"] = new_stack

        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m

    async def async_replace_image(
        self,
        map_id: str,
        png_base64: str,
        width: int,
        height: int,
        crop: dict | None = None,
        skip_frac_renorm: bool = False,
    ) -> dict[str, Any]:
        """Replace the PNG for an existing map and renormalize stored coordinates.

        crop (optional) describes the region of the *original* image that was
        kept: {fx0, fy0, fx1, fy1} as 0-1 fractions.  All receiver positions
        and room-bound polygon points are remapped so they remain correct in the
        new (cropped) image coordinate space.

        skip_frac_renorm: when True, skip crop-based renormalization — the caller
        will re-derive fractions from metre-space data (Phase 4).
        """
        m = self.get_map(map_id)
        if not m:
            raise KeyError("not_found")

        raw = base64.b64decode(png_base64)

        # Overwrite the same file so the browser cache-busts via map.updated timestamp
        file_path = (self.maps_dir / m["image"]["filename"]).resolve()
        if not str(file_path).startswith(str(self.maps_dir.resolve())):
            raise ValueError("Invalid filename")
        await asyncio.to_thread(file_path.write_bytes, raw)

        m["image"]["width"]      = int(width)
        m["image"]["height"]     = int(height)
        m["image"]["size_bytes"] = len(raw)
        m["image"]["sha256"]     = _sha256(raw)

        # Renormalize stored coordinates if a crop rectangle was supplied
        # Phase 4: skip when metre-space data is authoritative (caller re-derives)
        if crop and not skip_frac_renorm:
            fx0 = float(crop.get("fx0", 0))
            fy0 = float(crop.get("fy0", 0))
            fx1 = float(crop.get("fx1", 1))
            fy1 = float(crop.get("fy1", 1))
            fw  = fx1 - fx0
            fh  = fy1 - fy0
            if fw > 0 and fh > 0:
                def _rx(px: float) -> float:
                    return max(0.0, min(1.0, (float(px) - fx0) / fw))
                def _ry(py: float) -> float:
                    return max(0.0, min(1.0, (float(py) - fy0) / fh))

                for r in m.get("receivers", []):
                    r["x"] = _rx(r.get("x", 0))
                    r["y"] = _ry(r.get("y", 0))

                for bk in m.get("beacons", []):
                    bk["x"] = _rx(bk.get("x", 0))
                    bk["y"] = _ry(bk.get("y", 0))


                for b in m.get("room_bounds", {}).values():
                    if isinstance(b, dict):
                        if b.get("type") == "poly" and isinstance(b.get("points"), list):
                            b["points"] = [[_rx(p[0]), _ry(p[1])] for p in b["points"] if len(p) >= 2]
                        elif b.get("type") == "circle":
                            b["cx"] = _rx(b.get("cx", 0.5))
                            b["cy"] = _ry(b.get("cy", 0.5))

        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m

    async def async_prune_stale_receivers(self, known_sources: set[str], known_names: set[str]) -> int:
        """Remove receivers from all maps that don't match any known radio.

        Only prunes receivers with an EMPTY source field (legacy data).
        Receivers with a non-empty source are always kept — the user placed
        them intentionally and the source may simply be temporarily offline.

        Returns the number of receivers removed.
        """
        removed = 0
        dirty = False
        for m in self.data.get("maps", []):
            recs = m.get("receivers")
            if not isinstance(recs, list) or not recs:
                continue
            before = len(recs)
            m["receivers"] = [
                r for r in recs
                if r.get("source")  # non-empty source → always keep
                or (r.get("label") or "") in known_names
            ]
            diff = before - len(m["receivers"])
            if diff > 0:
                removed += diff
                dirty = True
        if dirty:
            await self.store.async_save(self.data)
        return removed

    async def async_remove_receiver_by_source(self, source: str) -> int:
        """Remove receivers matching a specific source from all maps.

        Matches if r["id"] == source or r["source"] == source.
        Returns the number of receivers removed.
        """
        removed = 0
        dirty = False
        for m in self.data.get("maps", []):
            recs = m.get("receivers")
            if not isinstance(recs, list) or not recs:
                continue
            before = len(recs)
            m["receivers"] = [
                r for r in recs
                if (r.get("id") or "") != source
                and (r.get("source") or "") != source
            ]
            diff = before - len(m["receivers"])
            if diff > 0:
                removed += diff
                dirty = True
        if dirty:
            await self.store.async_save(self.data)
        return removed

    async def async_delete_map(self, map_id: str) -> None:
        m = self.get_map(map_id)
        if not m:
            return
        fn = m.get("image", {}).get("filename")
        if fn:
            fp = (self.maps_dir / str(fn)).resolve()
            if str(fp).startswith(str(self.maps_dir.resolve())) and fp.exists():
                try:
                    await asyncio.to_thread(fp.unlink)
                except Exception:
                    pass
        self.data["maps"] = [x for x in self.data.get("maps", []) if x.get("id") != map_id]
        await self.store.async_save(self.data)

    # ── Coordinate transforms for cross-map migration ──────────────────────
    # These convert between a map's local (0-1) space and a shared "world"
    # coordinate system.  Used when migrating receivers/bounds from a
    # deleted map onto a surviving one (maps_delete_migrate).

    @staticmethod
    def map_to_world(px: float, py: float, stk: dict) -> tuple[float, float]:
        """Map-local normalised (0-1) → world coords.

        When a raw affine matrix ``_m`` is present (from Point Align solver),
        uses it directly.  Otherwise falls back to decomposed
        scale × scale_x_adj → rotate → translate.
        Mirrors the JS ``_mapToWorld`` function in maps.js.
        """
        ox = float(stk.get("x_offset", 0.0))
        oy = float(stk.get("y_offset", 0.0))
        _m = stk.get("_m")
        if _m and len(_m) == 4:
            u, v = px - 0.5, py - 0.5
            ar = float(stk.get("_m_ar") or stk.get("ref_ar") or 1.0)
            rx = _m[0] * u + _m[1] * v + 0.5 + ox
            ry = _m[2] * u + _m[3] * v + 0.5 + oy
            return (rx, ar * ry)
        sc = float(stk.get("scale", 1.0))
        sx_adj = float(stk.get("scale_x_adj", 1.0))
        ref_ar = float(stk.get("ref_ar") or (1.0))
        rot = math.radians(float(stk.get("rotation", 0.0)))

        dx = (px - 0.5) * sc * sx_adj
        dy = (py - 0.5) * sc * ref_ar
        rx = dx * math.cos(rot) - dy * math.sin(rot)
        ry = dx * math.sin(rot) + dy * math.cos(rot)
        return ((0.5 + ox) + rx, ref_ar * (0.5 + oy) + ry)

    @staticmethod
    def world_to_map(wx: float, wy: float, stk: dict) -> tuple[float, float]:
        """World coords → map-local normalised (0-1).  Inverse of map_to_world."""
        ox = float(stk.get("x_offset", 0.0))
        oy = float(stk.get("y_offset", 0.0))
        _m = stk.get("_m")
        if _m and len(_m) == 4:
            ar = float(stk.get("_m_ar") or stk.get("ref_ar") or 1.0)
            rx = wx - 0.5 - ox
            ry = wy / ar - 0.5 - oy  # undo AR scaling applied in map_to_world
            det = _m[0] * _m[3] - _m[1] * _m[2]
            if abs(det) < 1e-12:
                return (0.5, 0.5)
            return ((_m[3] * rx - _m[1] * ry) / det + 0.5,
                    (-_m[2] * rx + _m[0] * ry) / det + 0.5)
        sc = float(stk.get("scale", 1.0))
        sx_adj = float(stk.get("scale_x_adj", 1.0))
        ref_ar = float(stk.get("ref_ar") or (1.0))
        rot = math.radians(float(stk.get("rotation", 0.0)))

        rx = wx - (0.5 + ox)
        ry = wy - ref_ar * (0.5 + oy)
        # Inverse rotation
        dx = rx * math.cos(-rot) - ry * math.sin(-rot)
        dy = rx * math.sin(-rot) + ry * math.cos(-rot)
        # Inverse scale
        denom_x = sc * sx_adj if abs(sc * sx_adj) > 1e-9 else 1e-9
        denom_y = sc * ref_ar if abs(sc * ref_ar) > 1e-9 else 1e-9
        px = dx / denom_x + 0.5
        py = dy / denom_y + 0.5
        return (px, py)

    async def async_extend_canvas(
        self,
        map_id: str,
        pad_left: float,
        pad_right: float,
        pad_top: float,
        pad_bottom: float,
    ) -> dict[str, Any]:
        """Extend a map's PNG canvas with dark padding and renormalise all
        stored coordinates.

        pad_* values are in normalised (0-1) space of the CURRENT image.
        e.g. pad_left=0.2 means add 20% of the current width to the left.

        Returns the updated map dict and stores ``_pre_extend`` snapshot
        for undo.
        """
        m = self.get_map(map_id)
        if not m:
            raise KeyError("not_found")

        img = m.get("image") or {}
        old_w = int(img.get("width") or 800)
        old_h = int(img.get("height") or 600)

        # Pixels to add on each side
        add_l = max(0, int(round(pad_left * old_w)))
        add_r = max(0, int(round(pad_right * old_w)))
        add_t = max(0, int(round(pad_top * old_h)))
        add_b = max(0, int(round(pad_bottom * old_h)))

        if add_l + add_r + add_t + add_b == 0:
            return m  # nothing to do

        new_w = old_w + add_l + add_r
        new_h = old_h + add_t + add_b

        # Read existing PNG
        fn = img.get("filename")
        if not fn:
            raise ValueError("Map has no image file")
        fp = (self.maps_dir / str(fn)).resolve()
        if not str(fp).startswith(str(self.maps_dir.resolve())) or not fp.exists():
            raise ValueError("Image file not found")
        old_png = await asyncio.to_thread(fp.read_bytes)

        # Extend the PNG using Canvas-style compositing
        new_png = _extend_png(old_png, old_w, old_h, new_w, new_h, add_l, add_t)
        await asyncio.to_thread(fp.write_bytes, new_png)

        # Save pre-extend snapshot for undo
        m["_pre_extend"] = {
            "width": old_w,
            "height": old_h,
            "pad_left": add_l,
            "pad_right": add_r,
            "pad_top": add_t,
            "pad_bottom": add_b,
        }

        # Update image dimensions
        m["image"]["width"] = new_w
        m["image"]["height"] = new_h
        m["image"]["size_bytes"] = len(new_png)
        m["image"]["sha256"] = _sha256(new_png)

        # Renormalise all stored coordinates
        fw = old_w / new_w
        fh = old_h / new_h
        ox = add_l / new_w
        oy = add_t / new_h

        def _rx(px: float) -> float:
            return ox + float(px) * fw

        def _ry(py: float) -> float:
            return oy + float(py) * fh

        for r in m.get("receivers", []):
            r["x"] = _rx(r.get("x", 0))
            r["y"] = _ry(r.get("y", 0))

        for bk in m.get("beacons", []):
            bk["x"] = _rx(bk.get("x", 0))
            bk["y"] = _ry(bk.get("y", 0))


        for b in m.get("room_bounds", {}).values():
            if isinstance(b, dict):
                if b.get("type") == "poly" and isinstance(b.get("points"), list):
                    b["points"] = [[_rx(p[0]), _ry(p[1])] for p in b["points"] if len(p) >= 2]
                elif b.get("type") == "circle":
                    b["cx"] = _rx(b.get("cx", 0.5))
                    b["cy"] = _ry(b.get("cy", 0.5))
                    # Scale radius proportionally (use smaller factor)
                    b["r"] = float(b.get("r", 0.12)) * min(fw, fh)

        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m

    async def async_revert_extend(self, map_id: str) -> dict[str, Any] | None:
        """Revert a canvas extension using the saved ``_pre_extend`` snapshot.

        Returns the updated map or None if no snapshot exists.
        """
        m = self.get_map(map_id)
        if not m:
            return None
        pre = m.get("_pre_extend")
        if not pre:
            return None

        old_w = int(pre["width"])
        old_h = int(pre["height"])
        add_l = int(pre["pad_left"])
        add_t = int(pre["pad_top"])
        new_w = m["image"]["width"]
        new_h = m["image"]["height"]

        # Read current (extended) PNG and crop back to original
        fn = (m.get("image") or {}).get("filename")
        if fn:
            fp = (self.maps_dir / str(fn)).resolve()
            if str(fp).startswith(str(self.maps_dir.resolve())) and fp.exists():
                cur_png = await asyncio.to_thread(fp.read_bytes)
                orig_png = _crop_png(cur_png, new_w, new_h, add_l, add_t, old_w, old_h)
                if orig_png:
                    await asyncio.to_thread(fp.write_bytes, orig_png)
                    m["image"]["size_bytes"] = len(orig_png)
                    m["image"]["sha256"] = _sha256(orig_png)

        m["image"]["width"] = old_w
        m["image"]["height"] = old_h

        # Reverse the coordinate renormalisation
        fw = old_w / new_w
        ox = add_l / new_w
        fh = old_h / new_h
        oy = add_t / new_h

        def _ux(px: float) -> float:
            return max(0.0, min(1.0, (float(px) - ox) / fw)) if fw > 0 else 0.5

        def _uy(py: float) -> float:
            return max(0.0, min(1.0, (float(py) - oy) / fh)) if fh > 0 else 0.5

        for r in m.get("receivers", []):
            r["x"] = _ux(r.get("x", 0))
            r["y"] = _uy(r.get("y", 0))

        for bk in m.get("beacons", []):
            bk["x"] = _ux(bk.get("x", 0))
            bk["y"] = _uy(bk.get("y", 0))


        for b in m.get("room_bounds", {}).values():
            if isinstance(b, dict):
                if b.get("type") == "poly" and isinstance(b.get("points"), list):
                    b["points"] = [[_ux(p[0]), _uy(p[1])] for p in b["points"] if len(p) >= 2]
                elif b.get("type") == "circle":
                    b["cx"] = _ux(b.get("cx", 0.5))
                    b["cy"] = _uy(b.get("cy", 0.5))
                    b["r"] = float(b.get("r", 0.12)) / min(fw, fh) if min(fw, fh) > 0 else 0.12

        del m["_pre_extend"]
        m["updated"] = _now_iso()
        await self.store.async_save(self.data)
        return m


# ── Pure-Python PNG manipulation ──────────────────────────────────────────────
# We can't use Pillow (not in HA's dependency tree).  Instead we do minimal
# PNG chunk parsing, zlib inflate/deflate, and manual scanline filter reversal.
# These functions support the canvas-extend and crop-revert features.

def _extend_png(old_png: bytes, old_w: int, old_h: int,
                new_w: int, new_h: int,
                offset_x: int, offset_y: int) -> bytes:
    """Create a new PNG with the original image placed at (offset_x, offset_y)
    on a larger dark canvas.  Uses raw RGBA scanline construction + zlib.
    Falls back to returning the original PNG on error.
    """
    try:
        # Decode original PNG to raw RGBA pixels
        old_pixels = _decode_png_to_rgba(old_png, old_w, old_h)
        if not old_pixels:
            # Can't decode — return original as-is
            return old_png

        # Build new RGBA buffer (dark background: #0a1a10 fully opaque)
        bg = b'\x0a\x1a\x10\xff'
        new_row_bytes = new_w * 4
        rows: list[bytes] = []
        for y in range(new_h):
            src_y = y - offset_y
            if 0 <= src_y < old_h:
                # Build row: left pad + old row data + right pad
                old_row_start = src_y * old_w * 4
                left = bg * offset_x if offset_x > 0 else b''
                mid = old_pixels[old_row_start:old_row_start + old_w * 4]
                right_pad = new_w - offset_x - old_w
                right = bg * right_pad if right_pad > 0 else b''
                row = left + mid + right
            else:
                row = bg * new_w
            # PNG filter byte (0 = None)
            rows.append(b'\x00' + row[:new_row_bytes])

        raw_data = b''.join(rows)
        return _encode_rgba_to_png(raw_data, new_w, new_h)
    except Exception:
        return old_png  # safety fallback


def _crop_png(png_data: bytes, cur_w: int, cur_h: int,
              crop_x: int, crop_y: int,
              crop_w: int, crop_h: int) -> bytes | None:
    """Crop a PNG back to a sub-region. Returns new PNG bytes or None on error."""
    try:
        pixels = _decode_png_to_rgba(png_data, cur_w, cur_h)
        if not pixels:
            return None

        rows: list[bytes] = []
        for y in range(crop_h):
            src_y = crop_y + y
            if 0 <= src_y < cur_h:
                start = (src_y * cur_w + crop_x) * 4
                row = pixels[start:start + crop_w * 4]
                # Pad if needed
                if len(row) < crop_w * 4:
                    row += b'\x0a\x1a\x10\xff' * (crop_w - len(row) // 4)
            else:
                row = b'\x0a\x1a\x10\xff' * crop_w
            rows.append(b'\x00' + row)

        raw_data = b''.join(rows)
        return _encode_rgba_to_png(raw_data, crop_w, crop_h)
    except Exception:
        return None


def _decode_png_to_rgba(png_data: bytes, expected_w: int, expected_h: int) -> bytes | None:
    """Minimal PNG decoder → raw RGBA pixels.  Handles 8-bit RGBA and RGB."""
    try:
        if png_data[:8] != b'\x89PNG\r\n\x1a\n':
            return None

        pos = 8
        width = height = bit_depth = color_type = 0
        idat_chunks: list[bytes] = []
        palette: list[tuple[int, int, int]] = []

        while pos < len(png_data):
            length = struct.unpack(">I", png_data[pos:pos + 4])[0]
            chunk_type = png_data[pos + 4:pos + 8]
            chunk_data = png_data[pos + 8:pos + 8 + length]
            pos += 12 + length

            if chunk_type == b'IHDR':
                width, height, bit_depth, color_type = struct.unpack(">IIBB", chunk_data[:10])
            elif chunk_type == b'PLTE':
                for i in range(0, len(chunk_data), 3):
                    palette.append((chunk_data[i], chunk_data[i + 1], chunk_data[i + 2]))
            elif chunk_type == b'IDAT':
                idat_chunks.append(chunk_data)
            elif chunk_type == b'IEND':
                break

        if width != expected_w or height != expected_h:
            return None
        if bit_depth != 8:
            return None

        raw = zlib.decompress(b''.join(idat_chunks))

        # Determine bytes per pixel and convert to RGBA
        if color_type == 6:    # RGBA
            bpp = 4
        elif color_type == 2:  # RGB
            bpp = 3
        elif color_type == 3:  # Indexed
            bpp = 1
        elif color_type == 0:  # Greyscale
            bpp = 1
        elif color_type == 4:  # Greyscale + alpha
            bpp = 2
        else:
            return None

        # Reconstruct scanlines (apply PNG filters)
        stride = width * bpp
        scanlines = _unfilter_png(raw, width, height, bpp, stride)
        if not scanlines:
            return None

        # Convert to RGBA
        rgba = bytearray(width * height * 4)
        for y in range(height):
            row = scanlines[y * stride:(y + 1) * stride]
            for x in range(width):
                off = (y * width + x) * 4
                if color_type == 6:  # RGBA
                    rgba[off:off + 4] = row[x * 4:x * 4 + 4]
                elif color_type == 2:  # RGB
                    rgba[off:off + 3] = row[x * 3:x * 3 + 3]
                    rgba[off + 3] = 255
                elif color_type == 3:  # Indexed
                    idx = row[x]
                    if idx < len(palette):
                        r, g, b = palette[idx]
                        rgba[off] = r; rgba[off + 1] = g; rgba[off + 2] = b; rgba[off + 3] = 255
                    else:
                        rgba[off:off + 4] = b'\x00\x00\x00\xff'
                elif color_type == 0:  # Greyscale
                    v = row[x]
                    rgba[off] = v; rgba[off + 1] = v; rgba[off + 2] = v; rgba[off + 3] = 255
                elif color_type == 4:  # Greyscale + alpha
                    v = row[x * 2]
                    a = row[x * 2 + 1]
                    rgba[off] = v; rgba[off + 1] = v; rgba[off + 2] = v; rgba[off + 3] = a
        return bytes(rgba)
    except Exception:
        return None


def _unfilter_png(raw: bytes, width: int, height: int, bpp: int, stride: int) -> bytes | None:
    """Apply PNG scanline filters to reconstruct pixel data."""
    try:
        result = bytearray(height * stride)
        row_size = stride + 1  # +1 for filter byte
        for y in range(height):
            filt = raw[y * row_size]
            row_raw = raw[y * row_size + 1:y * row_size + 1 + stride]
            if len(row_raw) < stride:
                row_raw = row_raw + b'\x00' * (stride - len(row_raw))
            dst_off = y * stride
            prev_off = (y - 1) * stride if y > 0 else -1

            if filt == 0:  # None
                result[dst_off:dst_off + stride] = row_raw
            elif filt == 1:  # Sub
                for i in range(stride):
                    a = result[dst_off + i - bpp] if i >= bpp else 0
                    result[dst_off + i] = (row_raw[i] + a) & 0xFF
            elif filt == 2:  # Up
                for i in range(stride):
                    b = result[prev_off + i] if prev_off >= 0 else 0
                    result[dst_off + i] = (row_raw[i] + b) & 0xFF
            elif filt == 3:  # Average
                for i in range(stride):
                    a = result[dst_off + i - bpp] if i >= bpp else 0
                    b = result[prev_off + i] if prev_off >= 0 else 0
                    result[dst_off + i] = (row_raw[i] + (a + b) // 2) & 0xFF
            elif filt == 4:  # Paeth
                for i in range(stride):
                    a = result[dst_off + i - bpp] if i >= bpp else 0
                    b = result[prev_off + i] if prev_off >= 0 else 0
                    c = result[prev_off + i - bpp] if prev_off >= 0 and i >= bpp else 0
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                    result[dst_off + i] = (row_raw[i] + pr) & 0xFF
            else:
                result[dst_off:dst_off + stride] = row_raw
        return bytes(result)
    except Exception:
        return None


def _encode_rgba_to_png(filtered_data: bytes, width: int, height: int) -> bytes:
    """Encode pre-filtered RGBA scanline data into a PNG file."""
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    idat_data = zlib.compress(filtered_data, 6)

    def _chunk(ctype: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(ctype + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + ctype + data + struct.pack(">I", crc)

    png = b'\x89PNG\r\n\x1a\n'
    png += _chunk(b'IHDR', ihdr_data)
    png += _chunk(b'IDAT', idat_data)
    png += _chunk(b'IEND', b'')
    return png
