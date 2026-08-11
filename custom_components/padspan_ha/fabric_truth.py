# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Fabric Truth Candidates
====================================
Pure math for the competing "forms of truth" a floor's room layout can be
built from, so the user can preview each and choose (or refine) the most
accurate one BEFORE committing it to the base fabric:

  transforms  each map's own frac→metre calibration (map_transforms) — where
              the SYSTEM thinks each map sits. Wrong wherever a map was never
              measured (fallback-scaled).
  stack       the hand-tuned map alignment (maps' stack dicts) composed into
              the shared world frame and anchored to metres by a genuinely
              measured map. This is the assembly the Overview renders, i.e.
              what the user has already visually verified.

`stack_world_xform` is the Python mirror of the frontend's makeStackXform
(www/padspan-ha/views/stack_transform.js) — keep the two in sync.

Nothing in this module writes anywhere. FabricStore's two writers remain the
only room-geometry write paths; this module only computes candidates.
"""

import math
from typing import Any, Callable

from .const import DEFAULT_FLOOR_ID


# ── Geometry stats (shared with the Health coherence check) ──────────────────

def geom_bbox_m(geo: dict) -> tuple[float, float, float, float] | None:
    """(min_x, min_y, max_x, max_y) of one room geometry, or None."""
    try:
        if geo.get("type") == "poly":
            pts = geo.get("points_m") or []
            if len(pts) < 3:
                return None
            xs = [float(p[0]) for p in pts]
            ys = [float(p[1]) for p in pts]
            return (min(xs), min(ys), max(xs), max(ys))
        if geo.get("type") == "circle":
            cx, cy, r = float(geo.get("cx_m", 0)), float(geo.get("cy_m", 0)), float(geo.get("r_m", 0.1))
            return (cx - r, cy - r, cx + r, cy + r)
    except (TypeError, ValueError, IndexError):
        return None
    return None


def cluster_count(bboxes: list, gap_m: float = 1.0) -> int:
    """Connected components over room bboxes, adjacent when within gap_m."""
    n = len(bboxes)
    if n == 0:
        return 0
    half = gap_m / 2.0
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        ax0, ay0, ax1, ay1 = bboxes[i]
        for j in range(i + 1, n):
            bx0, by0, bx1, by1 = bboxes[j]
            if (ax0 - half <= bx1 + half and bx0 - half <= ax1 + half
                    and ay0 - half <= by1 + half and by0 - half <= ay1 + half):
                parent[find(i)] = find(j)
    return len({find(i) for i in range(n)})


def rooms_stats(rooms: dict[str, dict]) -> dict[str, Any]:
    """{rooms, clusters, bbox_w_m, bbox_h_m} for a candidate room set."""
    boxes = [b for b in (geom_bbox_m(g) for g in rooms.values()) if b]
    if not boxes:
        return {"rooms": 0, "clusters": 0, "bbox_w_m": 0.0, "bbox_h_m": 0.0}
    return {
        "rooms": len(boxes),
        "clusters": cluster_count(boxes),
        "bbox_w_m": round(max(b[2] for b in boxes) - min(b[0] for b in boxes), 1),
        "bbox_h_m": round(max(b[3] for b in boxes) - min(b[1] for b in boxes), 1),
    }


# ── Stack world frame (mirror of makeStackXform) ─────────────────────────────

def image_ar(m: dict) -> float:
    img = m.get("image") or {}
    return float(img.get("height") or 600) / float(img.get("width") or 800)


def stack_world_xform(stk: dict | None, fallback_ar: float) -> Callable[[float, float], tuple[float, float]]:
    """Map-fraction (0-1) → shared world space. Mirrors stack_transform.js."""
    stk = stk or {}
    ox = float(stk.get("x_offset") or 0)
    oy = float(stk.get("y_offset") or 0)
    ref_ar = float(stk.get("ref_ar") or fallback_ar or 1)

    _m = stk.get("_m")
    if isinstance(_m, (list, tuple)) and len(_m) == 4:
        a, b, c, d = (float(v) for v in _m)
        ar = float(stk.get("_m_ar") or ref_ar)

        def map_pt_affine(px: float, py: float) -> tuple[float, float]:
            u, v = px - 0.5, py - 0.5
            return (a * u + b * v + 0.5 + ox, ar * (c * u + d * v + 0.5 + oy))

        return map_pt_affine

    sc = float(stk.get("scale") or 1)
    sx = float(stk.get("scale_x_adj") or 1)
    ar = ref_ar
    r = math.radians(float(stk.get("rotation") or 0))
    cos_r, sin_r = math.cos(r), math.sin(r)

    def map_pt(px: float, py: float) -> tuple[float, float]:
        dx = (px - 0.5) * sc * sx
        dy = (py - 0.5) * sc * ar
        return ((0.5 + ox) + dx * cos_r - dy * sin_r, ar * (0.5 + oy) + dx * sin_r + dy * cos_r)

    return map_pt


def find_metre_anchor(maps_list: list[dict], model_store: Any) -> dict[str, Any] | None:
    """The measured map that pins the shared world frame to metres.

    Returns {"map_id", "m_per_world", "iso_error"} or None when no map
    anywhere in the stack frame has a real (reference-measured) scale.
    m_per_world uses the anchor's x-axis; iso_error reports how far the
    y-axis disagrees (0 = perfectly isotropic frame).
    """
    for m in maps_list:
        mid = m.get("id", "")
        t = model_store.map_transform(mid) if mid else None
        if not t or not (t.get("reference_measurements") or []):
            continue
        try:
            sx_m = float(t["scale_x_m"])
            sy_m = float(t["scale_y_m"])
        except (KeyError, TypeError, ValueError):
            continue
        if sx_m <= 0 or sy_m <= 0:
            continue
        stk = m.get("stack") or {}
        sc = float(stk.get("scale") or 1)
        sxadj = float(stk.get("scale_x_adj") or 1)
        ref_ar = float(stk.get("ref_ar") or image_ar(m) or 1)
        world_w = sc * sxadj          # world-x span of the full image width
        world_h = sc * ref_ar         # world-y span of the full image height
        if world_w <= 0 or world_h <= 0:
            continue
        m_per_w_x = sx_m / world_w
        m_per_w_y = sy_m / world_h
        iso_error = abs(m_per_w_y - m_per_w_x) / m_per_w_x if m_per_w_x else 1.0
        return {
            "map_id": mid,
            "m_per_world": round(m_per_w_x, 6),
            "iso_error": round(iso_error, 4),
        }
    return None


# ── Candidate builders ───────────────────────────────────────────────────────

def _bounds_to_geo(b: dict, to_metres: Callable[[float, float], tuple[float, float] | None],
                   radius_scale_m: float) -> dict | None:
    """One map room_bounds entry → metre geometry via a frac→metre function."""
    btype = b.get("type", "poly")
    if btype == "poly":
        pts_m = []
        for p in (b.get("points") or []):
            try:
                c = to_metres(float(p[0]), float(p[1]))
            except (TypeError, ValueError, IndexError):
                return None
            if c:
                pts_m.append([round(c[0], 3), round(c[1], 3)])
        if len(pts_m) >= 3:
            return {"type": "poly", "points_m": pts_m}
        return None
    if btype == "circle":
        try:
            c = to_metres(float(b.get("cx", 0.5)), float(b.get("cy", 0.5)))
        except (TypeError, ValueError):
            return None
        if c:
            return {
                "type": "circle",
                "cx_m": round(c[0], 3), "cy_m": round(c[1], 3),
                "r_m": round(max(0.1, float(b.get("r", 0.12)) * radius_scale_m), 3),
            }
    return None


def _merge_maps_rooms(sorted_maps: list[dict], geo_for: Callable[[dict, dict], dict | None]) -> dict[str, dict]:
    """Merge room_bounds across maps (master last = master priority)."""
    rooms: dict[str, dict] = {}
    master_rooms: set[str] = set()
    for m in sorted_maps:
        is_master = (m.get("stack") or {}).get("is_master", False)
        for rname, b in (m.get("room_bounds") or {}).items():
            if not isinstance(b, dict) or not isinstance(rname, str):
                continue
            if rname in rooms and rname in master_rooms and not is_master:
                continue
            geo = geo_for(m, b)
            if geo is None:
                continue
            geo["source_map_id"] = m.get("id")
            rooms[rname] = geo
            if is_master:
                master_rooms.add(rname)
    return rooms


def _master_last(maps_list: list[dict]) -> list[dict]:
    return sorted(maps_list, key=lambda m: 1 if (m.get("stack") or {}).get("is_master") else 0)


def rooms_from_transforms(floor_maps: list[dict], model_store: Any) -> dict[str, dict]:
    """Rooms in metres via each map's OWN calibration (map_transforms)."""
    def geo_for(m: dict, b: dict) -> dict | None:
        mid = m.get("id", "")
        t = model_store.map_transform(mid)
        if not t:
            return None
        avg_scale = (float(t.get("scale_x_m") or 0) + float(t.get("scale_y_m") or 0)) / 2
        return _bounds_to_geo(b, lambda px, py: model_store.map_frac_to_metres(px, py, mid), avg_scale)

    return _merge_maps_rooms(_master_last(floor_maps), geo_for)


def rooms_from_stack(floor_maps: list[dict], anchor: dict[str, Any]) -> dict[str, dict]:
    """Rooms in metres via the hand-tuned stack composition + metre anchor."""
    m_per_w = float(anchor["m_per_world"])

    def geo_for(m: dict, b: dict) -> dict | None:
        stk = m.get("stack") or {}
        xf = stack_world_xform(stk, image_ar(m))

        def to_metres(px: float, py: float) -> tuple[float, float]:
            wx, wy = xf(px, py)
            return (wx * m_per_w, wy * m_per_w)

        radius_scale = float(stk.get("scale") or 1) * m_per_w
        return _bounds_to_geo(b, to_metres, radius_scale)

    return _merge_maps_rooms(_master_last(floor_maps), geo_for)


def stack_metre_transform(m: dict, anchor: dict[str, Any]) -> dict[str, float] | None:
    """A map's TRUE frac→metre transform implied by the stack composition.

    Fits the origin/scale/rotation model the map_transforms store uses:
      f(0,0) = origin; columns f(1,0)-f(0,0) and f(0,1)-f(0,0) give the
      scaled axes. Used to REPAIR a map's system placement to match the
      hand-tuned alignment instead of discarding it.
    """
    m_per_w = float(anchor["m_per_world"])
    xf = stack_world_xform(m.get("stack") or {}, image_ar(m))
    o = xf(0.0, 0.0)
    ex = xf(1.0, 0.0)
    ey = xf(0.0, 1.0)
    col_x = ((ex[0] - o[0]) * m_per_w, (ex[1] - o[1]) * m_per_w)
    col_y = ((ey[0] - o[0]) * m_per_w, (ey[1] - o[1]) * m_per_w)
    scale_x_m = math.hypot(*col_x)
    scale_y_m = math.hypot(*col_y)
    if scale_x_m <= 0 or scale_y_m <= 0:
        return None
    rot = math.atan2(col_x[1], col_x[0])
    # The origin/scale/rotation model assumes perpendicular axes (y axis at
    # rot+90°). A solved-affine stack (_m) can shear; report the residual so
    # callers can refuse a lossy repair instead of silently distorting.
    rot_y = math.atan2(col_y[1], col_y[0])
    shear = abs(((rot_y - rot - math.pi / 2) + math.pi) % (2 * math.pi) - math.pi)
    return {
        "origin_x_m": round(o[0] * m_per_w, 4),
        "origin_y_m": round(o[1] * m_per_w, 4),
        "scale_x_m": round(scale_x_m, 4),
        "scale_y_m": round(scale_y_m, 4),
        "rotation_rad": round(rot, 6),
        "shear_rad": round(shear, 6),
    }
