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


def room_distance_m(geo: dict | None, x_m: float, y_m: float) -> float | None:
    """Distance from a point to one room geometry: 0.0 inside, edge distance
    outside, None when the geometry is missing/unusable."""
    if not isinstance(geo, dict):
        return None
    try:
        if geo.get("type") == "circle":
            dx = x_m - float(geo.get("cx_m", 0))
            dy = y_m - float(geo.get("cy_m", 0))
            return max(0.0, math.hypot(dx, dy) - float(geo.get("r_m", 0.1)))
        if geo.get("type") == "poly":
            pts = [(float(p[0]), float(p[1])) for p in (geo.get("points_m") or [])]
            if len(pts) < 3:
                return None
            inside = False
            j = len(pts) - 1
            for i in range(len(pts)):
                xi, yi = pts[i]
                xj, yj = pts[j]
                if (yi > y_m) != (yj > y_m) and x_m < (xj - xi) * (y_m - yi) / (yj - yi) + xi:
                    inside = not inside
                j = i
            if inside:
                return 0.0
            best = math.inf
            for i in range(len(pts)):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % len(pts)]
                dx, dy = x2 - x1, y2 - y1
                t = ((x_m - x1) * dx + (y_m - y1) * dy) / max(dx * dx + dy * dy, 1e-9)
                t = max(0.0, min(1.0, t))
                best = min(best, math.hypot(x_m - (x1 + t * dx), y_m - (y1 + t * dy)))
            return best
    except (TypeError, ValueError, IndexError):
        return None
    return None


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


# How far the two axis scales may disagree before a map is considered unfit to
# anchor the house. A well-formed map is 0; a trimmed one is the fraction that
# was cut off, so anything above a couple of percent is a real disagreement.
ANCHOR_ISO_TOL = 0.02


def find_metre_anchor(maps_list: list[dict], model_store: Any) -> dict[str, Any] | None:
    """The measured map that pins the shared world frame to metres.

    Returns {"map_id", "m_per_world", "m_per_world_x", "m_per_world_y",
    "iso_error"} or None when no map anywhere in the stack frame has a real
    (reference-measured) scale.

    World space is ANISOTROPIC in y — stack_world_xform spans the image across
    `scale * scale_x_adj` in x and `scale * ar` in y — so a measured map has
    TWO metres-per-world-unit figures, not one.

    Both were computed here from the start, and only x was returned. Callers
    then applied that single number to both axes, which is issue #62: rooms
    correct across and wrong down by exactly the map's aspect error, and it
    only ever looked right while a map's pixel aspect matched its metric one.
    The JS twin (views/stack_transform.js) was fixed; this, the side that
    WRITES — committed room geometry via rooms_from_stack, and scale_x_m /
    scale_y_m via stack_metre_transform — was not.

    `m_per_world` keeps its old meaning (the x figure) so existing readers are
    unchanged; `iso_error` still reports how far the two disagree.
    """
    # Candidates are collected rather than returned on first sight: a map whose
    # two axis scales disagree is a map whose stored metric extent no longer
    # describes its world footprint — the signature of a trim, which rewrites
    # map_transforms but leaves the stack alone (issue #62). Anchoring the whole
    # house to one of those skews every floor, including untrimmed ones.
    # Prefer a self-consistent map; fall back to today's first-match so an
    # install whose only measured map is trimmed is never left worse off.
    candidates: list[dict[str, Any]] = []
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
        cand = {
            "map_id": mid,
            # Kept as the x figure so existing readers are unchanged in meaning.
            "m_per_world": round(m_per_w_x, 6),
            "m_per_world_x": round(m_per_w_x, 6),
            "m_per_world_y": round(m_per_w_y, 6),
            "iso_error": round(iso_error, 4),
        }
        if iso_error <= ANCHOR_ISO_TOL:
            return cand
        candidates.append(cand)
    # Nothing self-consistent: the least-skewed of what there is, flagged so
    # callers and diagnostics can say so rather than silently drawing it.
    if candidates:
        worst = min(candidates, key=lambda c: c["iso_error"])
        return {**worst, "degraded": True}
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


def _anchor_scales(anchor: dict[str, Any]) -> tuple[float, float]:
    """Metres per world unit, per axis. One place, so a caller cannot use the
    x scale for y by accident — which is the whole of issue #62."""
    kx = float(anchor.get("m_per_world_x") or anchor["m_per_world"])
    ky = float(anchor.get("m_per_world_y") or anchor["m_per_world"])
    return kx, ky


# Thresholds for map_geometry_faults(). Deliberately generous: this reports a
# map that is genuinely broken, not one whose hand alignment is a little loose.
GEOMETRY_SCALE_TOL = 0.05      # fraction
GEOMETRY_ORIGIN_TOL_M = 0.5    # metres


def map_geometry_faults(maps_list: list[dict], model_store: Any) -> list[dict[str, Any]]:
    """Maps whose stored geometry no longer agrees with itself. READ ONLY.

    Two independent signals, both computed from data already on disk:

    `iso_error` — the map's two metres-per-world-unit figures disagree. A
    healthy map has one scale; a map with two is one whose metric extent and
    world footprint were updated by different code paths. This is what a trim
    did before the crop path re-derived the stack (issue #62), and it is why a
    trimmed map drew its rooms stretched on one axis.

    `origin_delta_m` / `scale_error_frac` — the placement implied by the map's
    stack does not match the placement in its stored transform. Same root
    cause, measured at the other end.

    Reported per map so a critic can name it and the opt-in usage report can
    count it. Nothing here changes rendering, gates a write, or repairs
    anything — the whole point is that an install can say what is wrong with it
    without the owner having to notice and screenshot it first.
    """
    anchor = find_metre_anchor(maps_list, model_store)
    if not anchor:
        return []
    out: list[dict[str, Any]] = []
    for m in (maps_list or []):
        mid = m.get("id", "")
        if not mid:
            continue
        t = model_store.map_transform(mid)
        if not t:
            continue
        st = stack_metre_transform(m, anchor)
        if not st:
            continue
        try:
            sx = float(t.get("scale_x_m") or 0); sy = float(t.get("scale_y_m") or 0)
            ox = float(t.get("origin_x_m") or 0); oy = float(t.get("origin_y_m") or 0)
        except (TypeError, ValueError):
            continue
        if sx <= 0 or sy <= 0:
            continue
        scale_err = max(
            abs(sx - st["scale_x_m"]) / sx,
            abs(sy - st["scale_y_m"]) / sy,
        )
        origin_delta = math.hypot(ox - st["origin_x_m"], oy - st["origin_y_m"])
        # This map's own two axis scales, independent of the anchor map.
        stk = m.get("stack") or {}
        sc = float(stk.get("scale") or 1)
        world_w = sc * float(stk.get("scale_x_adj") or 1)
        world_h = sc * (float(stk.get("ref_ar") or image_ar(m) or 1))
        iso = 0.0
        if world_w > 0 and world_h > 0:
            mx, my = sx / world_w, sy / world_h
            iso = abs(my - mx) / mx if mx else 0.0
        if (scale_err <= GEOMETRY_SCALE_TOL
                and origin_delta <= GEOMETRY_ORIGIN_TOL_M
                and iso <= ANCHOR_ISO_TOL):
            continue
        out.append({
            "map_id": mid,
            "name": str(m.get("name") or mid),
            "floor_id": str(m.get("floor_id") or "main"),
            "iso_error": round(iso, 4),
            "scale_error_frac": round(scale_err, 4),
            "origin_delta_m": round(origin_delta, 3),
            "is_anchor": mid == anchor.get("map_id"),
            "anchor_degraded": bool(anchor.get("degraded")),
        })
    return out


def stack_from_transform(m: dict, t: dict, anchor: dict[str, Any]) -> dict | None:
    """The stack that reproduces a stored map transform. Inverse of
    stack_metre_transform.

    The repair for a map whose STACK is the stale half — a map trimmed by a
    build that re-derived only its metric record (issue #62). The stored
    transform is the trustworthy side there, because the crop path derives it
    from the retained fraction, so the stack is rebuilt FROM it rather than the
    map being re-traced or re-measured by hand.

    This is the opposite direction to ws_fabric_map_align_to_stack, which
    repairs the transform to match a hand-tuned stack. Which one is correct
    depends on which half went stale, and that is what map_geometry_faults()
    determines — never assume the stack is truth.

    `ref_ar` and the stack's own rotation are held fixed: ref_ar is the world
    frame's y anisotropy, shared with every map on the same master, and a crop
    does not rotate. Returns None for a solved-affine (_m) stack, which has no
    scale/scale_x_adj to solve for.
    """
    stk = m.get("stack") or {}
    if isinstance(stk.get("_m"), (list, tuple)):
        return None
    ar = float(stk.get("ref_ar") or image_ar(m) or 1.0)
    if ar <= 0:
        return None
    kx, ky = _anchor_scales(anchor)
    if kx <= 0 or ky <= 0:
        return None
    try:
        sx_m = float(t["scale_x_m"]); sy_m = float(t["scale_y_m"])
        ox_m = float(t.get("origin_x_m", 0)); oy_m = float(t.get("origin_y_m", 0))
        rot = float(stk.get("rotation") or 0.0)
    except (KeyError, TypeError, ValueError):
        return None
    if not (sx_m > 0 and sy_m > 0):
        return None

    r = math.radians(rot)
    cos_r, sin_r = math.cos(r), math.sin(r)
    # A world delta takes kx on its x component and ky on its y component, so a
    # rotated axis is measured through both. Solve each world span from the
    # metre length it has to end up with.
    den_x = math.hypot(cos_r * kx, sin_r * ky)
    den_y = math.hypot(sin_r * kx, cos_r * ky)
    if den_x <= 0 or den_y <= 0:
        return None
    world_w = sx_m / den_x
    world_h = sy_m / den_y
    sc = world_h / ar
    if sc <= 0 or world_w <= 0:
        return None

    # f(0,0) must land on the stored origin.
    dx = -0.5 * world_w
    dy = -0.5 * world_h
    ox = (ox_m / kx) - 0.5 - (dx * cos_r - dy * sin_r)
    oy = ((oy_m / ky) - (dx * sin_r + dy * cos_r)) / ar - 0.5

    out = dict(stk)
    out["scale"] = sc
    out["scale_x_adj"] = world_w / sc
    out["x_offset"] = ox
    out["y_offset"] = oy
    return out


def rooms_from_stack(floor_maps: list[dict], anchor: dict[str, Any]) -> dict[str, dict]:
    """Rooms in metres via the hand-tuned stack composition + metre anchor."""
    m_per_w_x, m_per_w_y = _anchor_scales(anchor)

    def geo_for(m: dict, b: dict) -> dict | None:
        stk = m.get("stack") or {}
        xf = stack_world_xform(stk, image_ar(m))

        def to_metres(px: float, py: float) -> tuple[float, float]:
            wx, wy = xf(px, py)
            # Per axis. World y carries the map's aspect ratio, so scaling it
            # by the x figure stretched every room by exactly the aspect error.
            return (wx * m_per_w_x, wy * m_per_w_y)

        # A circle in an anisotropic world is an ellipse, and this geometry
        # format has one radius. The geometric mean is the radius of the
        # circle with the same area as that ellipse — the least wrong single
        # number available, and bounded by the aspect error rather than
        # proportional to it. Traced circles are approximations already; a
        # room whose shape actually matters should be drawn as a polygon.
        radius_scale = float(stk.get("scale") or 1) * math.sqrt(m_per_w_x * m_per_w_y)
        return _bounds_to_geo(b, to_metres, radius_scale)

    return _merge_maps_rooms(_master_last(floor_maps), geo_for)


def stack_metre_transform(m: dict, anchor: dict[str, Any]) -> dict[str, float] | None:
    """A map's TRUE frac→metre transform implied by the stack composition.

    Fits the origin/scale/rotation model the map_transforms store uses:
      f(0,0) = origin; columns f(1,0)-f(0,0) and f(0,1)-f(0,0) give the
      scaled axes. Used to REPAIR a map's system placement to match the
      hand-tuned alignment instead of discarding it.
    """
    m_per_w_x, m_per_w_y = _anchor_scales(anchor)
    xf = stack_world_xform(m.get("stack") or {}, image_ar(m))
    o = xf(0.0, 0.0)
    ex = xf(1.0, 0.0)
    ey = xf(0.0, 1.0)
    # Each COMPONENT of a world delta takes its own axis scale: the x
    # component metres-per-world-x, the y component metres-per-world-y. Using
    # one figure for both is what put a wrong scale_y_m into map_transforms,
    # from where every later read inherited it.
    col_x = ((ex[0] - o[0]) * m_per_w_x, (ex[1] - o[1]) * m_per_w_y)
    col_y = ((ey[0] - o[0]) * m_per_w_x, (ey[1] - o[1]) * m_per_w_y)
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
        # The origin is a world POINT, so each component takes its own axis
        # scale, exactly as the column vectors above do.
        "origin_x_m": round(o[0] * m_per_w_x, 4),
        "origin_y_m": round(o[1] * m_per_w_y, 4),
        "scale_x_m": round(scale_x_m, 4),
        "scale_y_m": round(scale_y_m, 4),
        "rotation_rad": round(rot, 6),
        "shear_rad": round(shear, 6),
    }
