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

  transforms  each map's placement record (map_transforms), in metres. THE
              placement — the pictures, the rooms drawn on them and the world
              frame every stacked view renders in are all derived from it.

There used to be a second candidate, `stack`, built by composing the hand-tuned
`maps[].stack` and anchoring it to metres. It is gone because it cannot differ:
the stack is the record divided by the world gauge, so composing it and
multiplying back is the identity. Two "forms of truth" that agree by
construction are one form of truth and a lie about it.

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


# How far outside a drawn room still counts as inside the building.
#
# Rooms do not tile a floor. Hallways, landings and stairwells are almost never
# drawn, and a wall has thickness, so a point genuinely indoors can sit outside
# every polygon by a metre or so. A point in the garden is out by tens of
# metres. Two metres separates those cases with room to spare.
FOOTPRINT_TOLERANCE_M = 2.0


def inside_building_footprint(x_m: float, y_m: float, floor_rooms: dict | None,
                              tol_m: float = FOOTPRINT_TOLERANCE_M) -> bool:
    """Is this point inside the building, on this floor?

    **The footprint is the union of the rooms.** It is not a box drawn around
    them. A bounding box is a superset of the union, so it can prove a point is
    OUTSIDE the building and can never prove it is inside: the missing corner of
    an L, the yard between two wings and the driveway are all inside the box and
    inside no room. Using a box as the containment test is what let a parked car
    be positioned thirteen metres into a field and drawn there.

    A floor with no usable geometry cannot judge, so it accepts — a floor nobody
    has drawn must not have its positions suppressed.
    """
    best: float | None = None
    for geo in (floor_rooms or {}).values():
        d = room_distance_m(geo, x_m, y_m)
        if d is None:
            continue
        if d <= 0.0:
            return True
        if best is None or d < best:
            best = d
    if best is None:
        return True
    return best <= tol_m


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


# ── The world frame (mirror of makeStackXform) ───────────────────────────────
#
#     world = metres / gauge.m_per_unit
#
# One similarity, DERIVED from the placement record. There is no second
# description of where a map sits, so there is nothing for a second
# description to disagree with — which is the whole of R3.
#
# It used to be READ off `maps[].stack`: five decomposed fields, or a solved
# affine `_m` that took precedence over them, with every y term stretched by
# the map's `ref_ar`. That representation is what generated this project's bug
# class. Three copies of one fact (the stack's raw affine, the decomposition
# beside it, and `map_transforms`) meant every operation had to update all
# three, and the ones that did not are issues #62, #64, #67 and the trim.
#
# `ar` is gone with it, and its absence is not a simplification either. The
# picture's aspect is `scale_y_m / scale_x_m` — the record says how wide and
# how tall the map is in metres, which is the same fact `ar` carried and one
# the owner can actually measure. World space was already isotropic (the old
# frame put `ar` into the frac→world step precisely so that a fraction of 1.0
# DOWN covered `ar` times as much world as 1.0 ACROSS, i.e. so that world
# pixels were square); this says so directly instead of arranging it.


def image_ar(m: dict) -> float:
    img = m.get("image") or {}
    return float(img.get("height") or 600) / float(img.get("width") or 800)


def stack_world_xform(t: dict | None, gauge: dict[str, Any]) -> Callable[[float, float], tuple[float, float]]:
    """Map-fraction (0-1) → shared world space. Mirrors makeStackXform.

    Four lines, because a world frame that is metres divided by a constant is
    four lines. Raises through `_gauge_scale` when there is no world frame —
    every caller has already gone through `metre_gauge`, and inventing a scale
    here is the deleted 20 m fallback rebuilt one level down.
    """
    k = _gauge_scale(gauge)

    def map_pt(px: float, py: float) -> tuple[float, float]:
        mx, my = placement_metres(t or {}, px, py)
        return (mx / k, my / k)

    return map_pt


def legacy_stack_world_xform(stk: dict | None, fallback_ar: float) -> Callable[[float, float], tuple[float, float]]:
    """The PRE-R3 world frame, read off `maps[].stack`. Mirror of what the
    renderer drew before the stack became derived.

    Exactly two callers, both one-shot and both about the upgrade:
    `measure_world_gauge` (which has to seed the gauge in the frame the old
    renderer used, or the conversion below it reads every legacy stack at the
    wrong scale) and `migrations._derive_world_placement` (which converts
    those stacks into metre records and then deletes them).

    It is named `legacy_` so that a third caller cannot appear by accident.
    Nothing that renders, repairs or compares may read it: a stack's numbers
    are no longer where the map is, and after the conversion they are not even
    on disk. A store with no legacy stack fields reads as the IDENTITY here —
    span 1.0 across, `ar` down — which is what a master map's stack always
    was, and is what makes one world unit the seed map's picture width on an
    install that never had a stack to convert.
    """
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


def legacy_world_footprint(m: dict, stk: dict | None = None) -> tuple[float, float]:
    """The world span of a map's full image under its LEGACY stack.

    Returns (width, height) as the lengths of the image's two edges in world
    space, which is what "how much world does this picture cover" means under
    rotation as well as without it.

    Never re-derive this from `scale * scale_x_adj` and `scale * ref_ar`.
    Those are the inputs to ONE of legacy_stack_world_xform's two branches,
    and it ignores them completely when Point Align has written a raw affine
    `_m`. A Point-Aligned map derived that way gets a footprint the renderer
    never drew, and every metre figure computed from it is skewed by whatever
    the stale fields happen to still say (issue #62).

    Legacy, and it goes where its two callers go: the gauge seed and the
    conversion. The DERIVED footprint of a map is `(scale_x_m, scale_y_m)`
    divided by the gauge, which is not worth a function.
    """
    if stk is None:
        stk = m.get("stack") or {}
    xf = legacy_stack_world_xform(stk, image_ar(m))
    x0, y0 = xf(0.0, 0.0)
    x1, y1 = xf(1.0, 0.0)
    x2, y2 = xf(0.0, 1.0)
    return (math.hypot(x1 - x0, y1 - y0), math.hypot(x2 - x0, y2 - y0))


# How far a map's OWN two axis scales may disagree before the record stops
# describing one picture. A well-formed map is 0 to floating point — swept
# over 4368 placements (aspect 0.25-1.41, x-stretch 0.5-1.7, scale 0.3-2.7,
# every 7° of rotation) the worst is 2.05e-16 relative, one unit in the last
# place, 4.1e-15 m on a 20 m map — because a map's metric extent and its
# world footprint are the same shape seen twice. A trimmed one is off by the
# fraction that was cut, so anything above a couple of percent is a real
# disagreement.
#
# It was ANCHOR_ISO_TOL: the bar an anchor had to clear before the house was
# scaled off it. There is no such bar any more, because there is no per-render
# anchor to clear it — the gauge is stored. What survives is what the number
# always actually measured: the point at which ONE RECORD stops being
# self-consistent. Renamed to say that, because a constant whose name
# describes a decision nobody makes any more is the next wrong comment.
RECORD_ISO_TOL = 0.02


def legacy_record_iso_error(m: dict, t: dict) -> float | None:
    """How far a map's stored metric extent and its LEGACY world footprint
    disagree.

    |ky − kx| / kx over the map's own two axes: the metres-per-world-unit its
    width implies against the one its height implies. They are two readings of
    ONE quantity — world space is isotropic, because `stack_world_xform`
    rotates x and y into each other and a rotation of non-commensurable axes
    is not a rotation — so a map that reads two different numbers has a record
    that no longer describes its picture (issue #62: a trim that rewrote the
    metric record and left the stack behind).

    It stops being a FAULT under R3 and keeps exactly one job: ranking the
    gauge seed. The disagreement it measured was between the record and the
    picture as the STACK drew it, and after the conversion the stack does not
    draw the picture — the record does, so the picture is drawn at whatever
    aspect the record states and there is nothing left to differ. What is
    still worth knowing at seed time is that a map whose record does not match
    its own picture was probably mis-measured, and a world unit is better
    taken from one that does. It is a tie-break, not a diagnosis, and it is in
    the legacy block because it reads the legacy footprint.

    None when the map has no footprint or no readable scales.
    """
    try:
        sx_m = float(t["scale_x_m"])
        sy_m = float(t["scale_y_m"])
    except (KeyError, TypeError, ValueError):
        return None
    if sx_m <= 0 or sy_m <= 0:
        return None
    world_w, world_h = legacy_world_footprint(m)
    if world_w <= 0 or world_h <= 0:
        return None
    kx = sx_m / world_w
    ky = sy_m / world_h
    return abs(ky - kx) / kx if kx else None


# ── The world gauge ─────────────────────────────────────────────────────────
#
# One scalar: how many metres one unit of the shared stack world frame is.
#
# It used to be MEASURED on every read, by dividing a map's `scale_x_m` by its
# `world_footprint` — and `world_footprint` reads the stack. R3 derives the
# stack from the metric record, so measuring the record's units off that stack
# would be this project's own bug class relocated: a quantity defined in terms
# of the thing that is defined in terms of it. So it is measured ONCE and
# stored, and every read is a read.
#
# It is ISOTROPIC, and that is not a simplification. Metres carry no aspect
# ratio and neither does world space. The per-axis pair `m_per_world_x` /
# `m_per_world_y` was never two quantities; it was one quantity read twice off
# a record that could disagree with itself, and `iso_error` was the
# disagreement. With one stored scalar the pair is unrepresentable and
# `iso_error` has nothing to be the difference OF — which is issue #62 made
# impossible rather than fixed.
#
# WHAT IT MEANS AFTER R3: it is a rendering constant and nothing else. World
# space is metres divided by it, so changing it zooms every view together and
# moves nothing relative to anything. It is still stored and still write-once,
# because the CONVERSION reads legacy stacks through it — a stack's numbers
# only become metres when multiplied by this — so an install that re-measured
# it mid-upgrade would convert half its maps at one scale and half at another.
# On an install with no legacy stack to convert (a fresh one, or any install
# after the conversion) the legacy reader answers the identity and one world
# unit is simply the seed map's picture width in metres.


def measure_world_gauge(maps_list: list[dict], model_store: Any) -> dict[str, Any] | None:
    """Measure the world gauge from a measured map. THE SEED, called once.

    Returns {"m_per_unit", "source_map_id", "source_reason"} or None when no
    map anywhere in the stack has a real (reference-measured) scale.

    This is the ONLY place in the integration that divides a metric extent by
    a world footprint, and the footprint it divides by is the LEGACY one — the
    span the pre-R3 renderer drew the picture at. That is deliberate and it is
    what makes the conversion below it exact: a legacy stack becomes metres by
    being multiplied by this number, so the number has to be measured in the
    frame those stacks were written in. On a store with no legacy stack fields
    the legacy reader is the identity, the footprint is 1.0 across, and one
    world unit is the seed map's picture width — which is what a master map's
    stack always made it. Everything else READS the stored result through
    `metre_gauge`. It is called from `ModelStore.async_ensure_world_gauge`,
    which is the one writer, and nowhere else.

    WHICH MAP is a one-time judgement, so it is made deterministically and
    logged rather than taken from list order. The old candidate loop returned
    the FIRST map that qualified, so the house's metre scale depended on where
    a map sat in an array: two maps that are each internally self-consistent
    (iso 0.0 both) but measured at different scales swing the gauge 20% purely
    by being reordered, which places the same map 5.000 m differently. A map
    being added, deleted or re-sorted must not re-scale the house.

    The order here:

      1. The LEGACY MASTER map, if it is measured and self-consistent. World
         units ARE the master's picture: its legacy stack is the identity
         (is_master, offset 0, scale 1), so metres-per-world-unit is exactly
         its `scale_x_m`. That is a reason, not a tie-break.
      2. Otherwise the self-consistent measured map with the lowest id —
         arbitrary, but STABLE, which is the property list order lacked.
      3. Otherwise the measured map with the lowest id, whose record disagrees
         with its own picture. Its scale is still better than no scale —
         refusing here would leave an install that draws today drawing
         nothing — and `source_reason` says so in the log.

    `is_master` IS DELETED, and this is the one place that still reads it: it
    is a legacy field, read off legacy data, by the one function whose job is
    to measure the legacy frame. On any store that has been through the
    conversion there is no `is_master` on disk, this reads False for every
    map, and the ranking falls through to 2 and 3 — which is what it should
    do, because after the conversion no picture defines the world unit and any
    measured map's scale is as good a constant as any other. Ranking a
    one-time constant off a flag nobody can write any more is not the same
    thing as keeping the feature.

    `scale_x_m` is the figure taken, not the mean of the two axes: it is the
    number every legacy reader already applied to BOTH axes, so a store seeded
    from it converts bit-for-bit as it did before.
    """
    best: tuple[int, str, dict[str, Any]] | None = None
    for m in maps_list or []:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        t = model_store.map_transform(mid)
        if not t or not (t.get("reference_measurements") or []):
            continue
        try:
            sx_m = float(t["scale_x_m"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (math.isfinite(sx_m) and sx_m > 0):
            continue
        world_w, _world_h = legacy_world_footprint(m)
        if world_w <= 0:
            continue
        iso = legacy_record_iso_error(m, t)
        consistent = iso is not None and iso <= RECORD_ISO_TOL
        legacy_master = bool((m.get("stack") or {}).get("is_master"))
        # Lower rank wins, the id breaks the tie — so nothing depends on the
        # order the maps happen to arrive in.
        rank = 0 if (legacy_master and consistent) else (1 if consistent else 2)
        if best is not None and (rank, mid) >= best[:2]:
            continue
        reason = (
            "the legacy master map, whose picture defined the world unit" if rank == 0
            else "the lowest-id measured map whose record matches its own picture"
            if rank == 1 else
            "no measured map matches its own picture; this one's two axis "
            f"scales disagree by {iso:.0%} and it is faulted"
        )
        best = (rank, mid, {
            "m_per_unit": round(sx_m / world_w, 6),
            "source_map_id": mid,
            "source_reason": reason,
        })
    return best[2] if best else None


def metre_gauge(model_store: Any) -> dict[str, Any] | None:
    """The stored world gauge, or None. A READ — it measures nothing.

    Returns {"m_per_unit", "source_map_id"}, or None when nothing has ever
    been measured OR the stored gauge is not usable as a scale.

    Those two cases are deliberately the SAME answer, and the answer is
    refusal. Every consumer already refuses when there is no anchor, so the
    refusal path is the one that has always been there; what is new is that a
    STORED record can be corrupt where a computed one could not (a null, a
    string, a zero, a NaN — `map_transforms` has shipped all four, which is
    what migration step 10 exists to repair). The failure mode to avoid is
    inventing a number for it. The deleted 20 m fallback is exactly what that
    mistake looked like last time: a fabricated scale put every position on an
    unmeasured plan at the wrong size, silently, and an install could not tell
    it was happening. No gauge means no world frame.
    """
    getter = getattr(model_store, "world_gauge", None)
    g = getter() if callable(getter) else None
    if not isinstance(g, dict):
        return None
    # The TYPE gate is held equal to the panel's, in
    # views/stack_transform.js `worldGauge` — two implementations of one
    # predicate disagreeing about which records are readable is where this
    # programme started. `float([20])` raises here while `Number([20])` is
    # 20 there; `float(True)` is 1.0 here while `typeof true` is not a
    # number there. Neither is a scale anybody measured. A numeric STRING
    # is accepted by both, because it converts to the scale the owner
    # actually measured and blanking a house over a JSON type is worse.
    # test_metre_anchor_axes.py holds the two to one table.
    raw = g.get("m_per_unit")
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return None
    try:
        k = float(raw)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(k) and k > 0):
        return None
    src = g.get("source_map_id")
    return {"m_per_unit": k, "source_map_id": str(src) if src else None}


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


def _merge_maps_rooms(floor_maps: list[dict], geo_for: Callable[[dict, dict], dict | None]) -> dict[str, dict]:
    """Merge room_bounds across maps. Highest precedence wins the name.

    Iterated LOWEST precedence first and written over, so the winner is the
    last write and there is no second rule about who may overwrite whom.
    """
    rooms: dict[str, dict] = {}
    for m in sorted(floor_maps, key=room_precedence, reverse=True):
        for rname, b in (m.get("room_bounds") or {}).items():
            if not isinstance(b, dict) or not isinstance(rname, str):
                continue
            geo = geo_for(m, b)
            if geo is None:
                continue
            geo["source_map_id"] = m.get("id")
            rooms[rname] = geo
    return rooms


def room_precedence(m: dict) -> tuple[str, str]:
    """Which map wins when two of them draw a room with the same name.

    CREATION ORDER, oldest first — the plan you started the floor with defines
    the floor. It is a TOTAL order and it cannot be nulled, which is the whole
    reason it replaced what was here.

    What was here was `is_master`: a boolean on the stack, sorted so the master
    came last and therefore overwrote everyone. Three things were wrong with
    it and only the third was ever reported. It is PARTIAL — with no master
    anywhere, or with two, the winner was list order, i.e. whatever order the
    store happened to hold. It is WRITABLE BY ACCIDENT — `maps_store` honours
    any `is_master` key present in a stack payload, so a view holding a stale
    copy of a map revoked the star on an ordinary save, and the rooms on that
    floor silently changed shape (#67). And it is UNREACHABLE TO FIX — the UI
    models one global master while `master_per_floor` was keyed by floor, so a
    store with a master on one floor and none on another could not be repaired
    from the panel at all. `_alignMasterRefusal` was a guard bolted over the
    second of those; a guard is a patch, and the thing that produced the wrong
    answer was a precedence order a flag write could change.

    `created` is an ISO-8601 timestamp written once by `async_add_map` and by
    nothing else, so it sorts lexically and no later operation moves a map in
    the order. The id is the tie-break for stores old enough to predate the
    field: arbitrary, but stable, which is the property list order lacked.
    """
    return (str(m.get("created") or ""), str(m.get("id") or ""))


def rooms_from_transforms(floor_maps: list[dict], model_store: Any) -> dict[str, dict]:
    """Rooms in metres via each map's placement record. THE room layout.

    It was one of two candidates — this one and `rooms_from_stack`, which
    composed the hand-tuned stack and multiplied by the gauge. They are the
    same function now: the stack IS the record divided by the gauge, so the
    multiplication puts it straight back. Measured over 20 maps the two agreed
    to 0.0 m exactly. Offering an owner two "forms of truth" that cannot
    differ is worse than offering one.
    """
    def geo_for(m: dict, b: dict) -> dict | None:
        mid = m.get("id", "")
        t = model_store.map_transform(mid)
        if not t:
            return None
        avg_scale = (float(t.get("scale_x_m") or 0) + float(t.get("scale_y_m") or 0)) / 2
        return _bounds_to_geo(b, lambda px, py: model_store.map_frac_to_metres(px, py, mid), avg_scale)

    return _merge_maps_rooms(floor_maps, geo_for)


def _gauge_scale(gauge: dict[str, Any]) -> float:
    """Metres per world unit. ONE number, because there is one.

    This was `_anchor_scales`, returning a (kx, ky) pair "so a caller cannot
    use the x scale for y by accident — which is the whole of issue #62". The
    pair was the patch: it made two copies of one quantity agree. There is no
    accident left to prevent, because there is no second scale to reach for —
    a metre is a metre in both directions and the gauge says how many of them
    a world unit is. The two live x-scale-applied-to-y bugs this pair was
    written to stop (calibration.js, traceback.js) are dead for the same
    reason: there is nothing left for them to get wrong.

    It RAISES on a gauge with no usable scale, and does not default. Every
    caller reaches here through `metre_gauge`, which has already refused an
    unusable one, so the raise is unreachable today — and "unreachable today"
    is exactly the argument that kept the fabricated 20 m house alive for a
    release. A default here would be that fallback rebuilt in the one function
    every metre conversion goes through, and it would be SILENT: a house drawn
    at a scale nobody measured, with nothing anywhere to say so. This is not.
    """
    k = float(gauge["m_per_unit"])
    if not (math.isfinite(k) and k > 0):
        raise ValueError(f"world gauge is not a scale: {gauge!r}")
    return k


# ── One definition of "these two placements agree" ───────────────────────────
#
# Three sites decided it independently and all three compared FIELDS: origin
# and the two scales, which is four of the six a placement has. ρ and σ were
# never in any of them, so on a 20 x 15 m map with an identical origin and
# identical scales a +5°/-5° difference in lean read as agreement at 2.61 m
# apart, a mirror at 30 m, and a half-turn of rotation at 50 m — and with
# every one of those the panel drew a green tick, Repair Positioning skipped
# the map as `already_aligned` and Rebuild Stack refused it as `not_faulted`.
# All three repair routes closed on a map that is metres wrong.
#
# The question is not which fields to compare. Two placements agree when they
# PUT THE MAP IN THE SAME PLACE, and that is a distance in metres. Written
# here once so the field question stops being askable.

# The corners of the map's own picture. A placement is affine, so the
# difference between two of them is affine too and its greatest magnitude over
# the picture is always at a corner — there is nothing in the interior worth
# sampling.
_PLACEMENT_CORNERS = ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0))

# How far apart two placements may put the same corner of the same map and
# still be describing the same placement. Deliberately generous: this names a
# map that is genuinely in the wrong place, not one whose hand alignment is a
# little loose.
PLACEMENT_AGREE_TOL_M = 0.5

# And the component tolerances, which the displacement does NOT subsume.
#
# A distance in metres is an absolute bar, and an absolute bar is blind to a
# proportional error on a small map: a 2 x 1.5 m map stored 20% too big puts
# its far corner exactly 0.5000 m out — inside the tolerance — while every
# room drawn on it is a fifth too wide. It is also a LOOSE bar on a large one.
# The three sites that decided agreement before this one held the origin to
# 0.2 m per axis and the scales to 2%, and on a 20 x 15 m map a 0.3 m nudge or
# a 2% stretch is under half a metre of corner travel: replacing them with the
# distance alone made two repair routes stop offering a repair they used to
# make.
#
# So the distance is ADDITIONAL evidence, never a replacement. It catches ρ, σ
# and a mirror, which score zero on every term below; the terms below catch
# what an absolute metre threshold cannot see. Two placements agree when they
# put the map in the same PLACE **and** describe it at the same SIZE, and the
# gate is therefore strictly wider than either half was on its own.
#
# Not made relative to the map instead: `TOL_M * max(1, diagonal / 25)` passes
# every fixture in this suite because every one of them is 25 m across — the
# single size at which absolute and relative coincide — and it grows without
# bound (0.72 m at 30 x 20, 1.0 m at 40 x 30), which is the same blindness
# again on the maps that matter most.
PLACEMENT_AGREE_ORIGIN_TOL_M = 0.2      # per axis
PLACEMENT_AGREE_SCALE_TOL_FRAC = 0.02   # per axis, of the smaller scale
PLACEMENT_AGREE_SCALE_TOL_M = 0.2       # ... or this, whichever is larger


def placement_metres(t: dict, x_frac: float, y_frac: float) -> tuple[float, float]:
    """Where a placement record puts one fraction of the map, in metres.

    The ONE evaluation of the placement model

        metres = origin + R(ρ) · [[Sx, -Sy·sin σ], [0, Sy·cos σ]] · frac

    `ModelStore.map_frac_to_metres` is this plus the map_id lookup, and
    `placement_from_columns` is the same model read off two axes — the record
    is written down in one place and evaluated in one place, so a σ convention
    cannot be got wrong twice.
    """
    ox = float(t.get("origin_x_m", 0))
    oy = float(t.get("origin_y_m", 0))
    sx = float(t.get("scale_x_m", 1))
    sy = float(t.get("scale_y_m", 1))
    rot = float(t.get("rotation_rad", 0))
    sig = float(t.get("shear_rad", 0) or 0)
    # Apply: scale each axis, aim the x axis at ρ and the y axis at ρ+σ+90°,
    # offset. The y column is the one σ tilts; the x column never moves.
    dx = x_frac * sx
    dy = y_frac * sy
    if abs(rot) > 1e-9 or abs(sig) > 1e-9:
        cos_r = math.cos(rot)
        sin_r = math.sin(rot)
        cos_q = math.cos(rot + sig)
        sin_q = math.sin(rot + sig)
        rx = dx * cos_r - dy * sin_q
        ry = dx * sin_r + dy * cos_q
    else:
        rx, ry = dx, dy
    return (ox + rx, oy + ry)


def placement_disagreement_m(a: dict, b: dict) -> float | None:
    """How far apart two placements put the same map, in metres.

    The greatest distance between where each puts the same corner of the
    picture. Every degree of freedom is in it because every one of them moves
    a corner: an origin offset moves all four together, a scale error moves
    the far ones, and ρ and σ swing them — which is exactly what four-field
    comparison could not see.

    None when either side is not readable as a placement.
    """
    try:
        pairs = [(placement_metres(a, fx, fy), placement_metres(b, fx, fy))
                 for fx, fy in _PLACEMENT_CORNERS]
    except (TypeError, ValueError):
        return None
    worst = max(math.hypot(p[0] - q[0], p[1] - q[1]) for p, q in pairs)
    return worst if math.isfinite(worst) else None


# The smallest EXTENT a placement may have on either axis and still be placing
# a picture: one millimetre. The x extent is `Sx`; the y extent is
# `Sy · |cos σ|`, the distance the y axis reaches PERPENDICULAR to the x one,
# which is what a lean eats into. Together they are the parallelogram's two
# sides, and their product is the determinant.
#
# In metres, not in cosines. The inverses tested `|cos σ| < 1e-9`, which is a
# threshold on nothing physical: σ rounded to the store's 1 µrad grid reads
# `cos σ = 3.3e-07` at a quarter turn — three hundred times over that bar — and
# describes a 20 x 15 m map five microns tall. Nor is an AREA bar enough: the
# same map has 98 mm² of it, because 20 x 15 is a big number to multiply a
# tiny one by. The question is how far the picture reaches in each direction,
# and that is what this asks.
PLACEMENT_MIN_EXTENT_M = 1e-3


def placement_is_readable(t: Any) -> bool:
    """Is this stored record a placement AT ALL?

    A record whose scale is a null or a string or a zero does not put the map
    anywhere: `placement_metres` raises on it and a zero-scale placement
    answers the origin for every point on the map. Before this existed the
    only thing that noticed was `placement_disagreement_m` returning None, and
    None read as agreement — so the one record that is provably broken was the
    one reported as fine, and `map_geometry_faults`, the diagnostic written to
    find broken records, dropped it with a `continue`.

    Asked through `placement_metres`, not by re-listing the fields, so a
    record this calls readable is exactly a record the evaluator can evaluate.
    The pose fields default the way it defaults them (an absent rotation is
    0°); the two SCALES are read without a default, because a map with no
    scale has no size.

    Pre-R1 `ws_fabric_map_transform_set` wrote client dicts verbatim, so
    `scale_x_m: null` reached disk. A5 fixed that writer; migration step 10
    is what repairs the records it already wrote.

    THE AREA GATE IS R3's. Evaluability was never the whole question and
    while the stack was stored it did not have to be: a placement whose two
    axes lie on one line covers no area, `placement_metres` evaluates it
    perfectly happily, and nothing here objected — the map was caught anyway,
    because it disagreed with the stack that was actually drawing it. Deriving
    the stack removes that second opinion, so a singular record would draw the
    map AS a line and every detector would report a healthy install. It is the
    same sentence the zero scale already gets, and the same one
    `metres_to_map_frac` and `metresToMapFrac` have always enforced from the
    other side: a record that cannot be inverted did not place the map. Two
    implementations of "is this record usable" disagreeing about which records
    are usable is where this programme started, so all three now ask the same
    question in the same units: how far does the picture REACH on each axis.

    Dimensional, deliberately — see `PLACEMENT_MIN_EXTENT_M`. A threshold on
    a cosine is a threshold on nothing physical, and it let a quarter-turn
    lean through.
    """
    if not isinstance(t, dict) or not t:
        return False
    try:
        x, y = placement_metres(t, 1.0, 1.0)
        sx = float(t["scale_x_m"])
        sy = float(t["scale_y_m"])
        cos_sigma = math.cos(float(t.get("shear_rad", 0) or 0))
    except (KeyError, TypeError, ValueError):
        return False
    return (sx >= PLACEMENT_MIN_EXTENT_M
            and sy * abs(cos_sigma) >= PLACEMENT_MIN_EXTENT_M
            and math.isfinite(x) and math.isfinite(y))


def placement_disagreements(a: dict | None, b: dict | None) -> list[str]:
    """WHICH terms of agreement these two placements fail. Empty means agree.

    The term that decides is the term that says so. A gate whose thresholds
    live here and whose wordings live in the Health critic and whose counters
    live in the usage report is three copies of one rule, and widening the
    gate quietly left two of them behind: a 0.25 m nudge on a 20 m map became
    a fault that the critic rendered as "…no longer describe the same picture
    — ." and the report counted under nothing. So the readers are handed the
    terms rather than re-deriving them from the numbers.

    Every term has to pass and none of them is redundant — see the note on the
    tolerances above. The scale terms are measured against the SMALLER of the
    two scales so the answer does not depend on which placement is handed in
    first; the distance already does not.
    """
    if not placement_is_readable(a) or not placement_is_readable(b):
        return ["unreadable"]
    out: list[str] = []
    d = placement_disagreement_m(a, b)
    if d is None or d > PLACEMENT_AGREE_TOL_M:
        out.append("displacement")
    for _k in ("origin_x_m", "origin_y_m"):
        if abs(float(a.get(_k, 0)) - float(b.get(_k, 0))) > PLACEMENT_AGREE_ORIGIN_TOL_M:
            out.append("origin")
            break
    for _k in ("scale_x_m", "scale_y_m"):
        sa = float(a[_k]); sb = float(b[_k])
        delta = abs(sa - sb)
        smaller = min(sa, sb)
        if (delta > max(PLACEMENT_AGREE_SCALE_TOL_M,
                        PLACEMENT_AGREE_SCALE_TOL_FRAC * smaller)
                or delta > GEOMETRY_SCALE_TOL * smaller):
            out.append("scale")
            break
    return out


def placements_agree(a: dict | None, b: dict | None) -> bool:
    """Do these two placements put the map in the same place, at the same size?

    THE agreement predicate: the panel's green tick, Repair Positioning's
    `already_aligned` skip and Rebuild Stack's `not_faulted` refusal are one
    question with one answer, so raising the bar in one place cannot leave the
    other two behind.
    """
    return not placement_disagreements(a, b)


# The relative scale term of `placements_agree`, kept under its own name
# because it is also the figure that DIAGNOSES the fault: "its stored scale is
# 33% off its placement" says what "6.8 m apart" only reports.
#
# `GEOMETRY_ORIGIN_TOL_M` stood beside it, already read by nothing in the
# integration and kept for the two tests that reasoned about "a map that has
# genuinely moved" with it. Those tests were about a map disagreeing with its
# own stack, so they went with the disagreement, and the name went with them.
GEOMETRY_SCALE_TOL = 0.05      # fraction


def map_geometry_faults(maps_list: list[dict], model_store: Any) -> list[dict[str, Any]]:
    """Maps this install cannot draw, and why. READ ONLY.

    IT USED TO REPORT DISAGREEMENT, and there is none left to report. A map's
    placement was stored twice — metric in `map_transforms`, world in
    `maps[].stack` — and four of this diagnostic's five terms (`displacement`,
    `origin`, `scale`, `iso`) measured the gap between the two copies. The
    stack is DERIVED from the record now, so the two copies are one number:
    measured over 400 random placements the worst corner gap is 1.2e-04 m, the
    store's own 0.1 mm rounding, and a record deliberately trimmed 50%, moved
    50 m, turned a half turn or mirrored — the four states this diagnostic was
    written to find, each of which HEAD reports at 7.5 m, 50.0 m, 50.0 m and
    30.0 m — every one of them reports NOTHING here, because the picture moved
    with the record. Terms that can only ever read zero are not detectors;
    keeping them would be a green tick nobody earned.

    What CAN still be wrong is a record that does not place the map:

    `unreadable` — the record is not a placement. A null, a string or a zero
    where a scale belongs, or a NULL ORIGIN beside two good scales, or a
    SINGULAR pair of axes (σ = ±90°, the two axes on one line, no area). It
    needs no world frame, because whether a record can be read is a question
    about the record. Pre-A5 the transform writer stored client dicts
    verbatim, so all of these reached disk.

    `unplaced` — the map has NO record at all, or a record with neither scale.
    Before R3 such a map still drew, through its stack; now it cannot be drawn
    at all, and the difference between "not measured" and "not on the floor"
    stopped being cosmetic the moment the stack went. Severity is the caller's
    to decide — this only says the map has nowhere to be.

    `no_world_frame` — reported ONCE, against no map, when the install has
    placements and no gauge. Nothing draws in that state: every world
    conversion refuses rather than inventing a scale, which is correct and
    completely silent. R2 shipped it as "could not verify"; with the stack
    derived it is the single condition that blanks a working house, so it is
    named here rather than left to be discovered on a blank screen.

    `terms` names which of those fired, from the code that decides. A reader
    that re-derives them from the numbers is a second copy of the gate, and
    the second copy is the one left behind when the gate moves.
    """
    gauge = metre_gauge(model_store)
    out: list[dict[str, Any]] = []
    placed = 0
    for m in (maps_list or []):
        mid = m.get("id", "")
        if not mid:
            continue
        t = model_store.map_transform(mid) or {}
        entry = {
            "map_id": mid,
            "name": str(m.get("name") or mid),
            "floor_id": str(m.get("floor_id") or "main"),
            "displacement_m": None,
            "iso_error": 0.0,
            "scale_error_frac": 0.0,
            "origin_delta_m": 0.0,
            "is_anchor": mid == (gauge or {}).get("source_map_id"),
        }
        if placement_is_readable(t):
            placed += 1
            continue
        # A stored placement either places the map or says nothing. NEITHER
        # scale is "says nothing" — that is what an unmeasured map looks like,
        # and it is what the transform writer deliberately leaves behind when
        # a payload's scale is unusable. A record that STATES part of a
        # placement it cannot deliver is the other thing, and it is corrupt
        # rather than absent. The two get different words because the repairs
        # are different: one is "measure this map", the other is "this record
        # is damaged".
        absent = not t or ("scale_x_m" not in t and "scale_y_m" not in t)
        out.append({**entry, "terms": ["unplaced" if absent else "unreadable"]})
    if placed and not gauge:
        # No map, because it is not about a map. The install has placements it
        # cannot convert into world space, so nothing renders — and every
        # renderer's refusal is individually correct, which is exactly why the
        # state is invisible without this.
        out.append({
            "map_id": "", "name": "", "floor_id": "",
            "terms": ["no_world_frame"], "displacement_m": None,
            "iso_error": 0.0, "scale_error_frac": 0.0, "origin_delta_m": 0.0,
            "is_anchor": False,
        })
    return out


# How much smaller a floor's rooms are allowed to be, ON EITHER AXIS, than
# the map they were built from before `room_footprint_faults` calls it wrong
# rather than just incomplete. Deliberately loose: hallways, a garage, an
# untraced utility room all legitimately shrink a floor's footprint below its
# photo's, so this is not a precision check, it is a "did someone trace a
# dollhouse" check.
#
# PER AXIS, not the diagonal. rjbutler's Main Floor (issue #62) was 10.7m x
# 8.8m against a map measured at 18.3472m x 9.7813m — width at 0.583 of the
# map, height at 0.900. A single diagonal ratio blends those two into 0.666,
# which is nowhere near loose enough to call "incomplete floor plan" and
# nowhere near tight enough to reliably clear a sensible threshold either —
# it sits in the dead zone specifically because the real fault was ONE axis,
# not both, which is the same shape as the Point-Align aspect bug that caused
# it (`_solvePtAlignRigid` applying one image's aspect to both). The width
# ratio alone is unambiguous; comparing axes separately keeps it that way
# instead of laundering it through a blend that a one-axis error survives.
ROOM_FOOTPRINT_MIN_FRAC = 0.65


def room_footprint_faults(
        room_geometry: dict[str, dict[str, Any]],
        maps_list: list[dict], model_store: Any) -> list[dict[str, Any]]:
    """Floors whose committed rooms are a different size than their own map.

    READ ONLY, and the complement of `map_geometry_faults`: that function can
    only ever see a map's OWN placement record, which the 0.38.0 consolidation
    made internally consistent by construction — a placement that is readable
    but simply WRONG passes it clean. Rooms are the one part of the fabric
    still built from a map once and then kept forever independently of it
    (see the Rooms tab header comment in maps.js): once traced, their metres
    do not move just because the map they came from later gets a better
    scale. A map fixed after its rooms were built leaves the rooms wrong with
    nothing left pointing at them — issue #62 found exactly this on Main
    Floor, after the map side was already believed fixed, and it took a
    user's screenshots to see it.

    Compares each floor's combined room bounding box against the largest
    MEASURED map on that floor (measured, not merely placed — an aligned but
    unmeasured map's scale can itself be a guess, and a guess proves nothing
    against another guess). A floor with no rooms, or no measured map, has
    nothing to compare and is skipped rather than reported as fine.

    Compared per axis, not by diagonal — see ROOM_FOOTPRINT_MIN_FRAC for why.

    `terms`:

    `undersized` — the rooms are smaller than ROOM_FOOTPRINT_MIN_FRAC of the
    map's own size on AT LEAST ONE axis. Consistent with the rooms having
    been built while this map held a smaller, since-corrected placement.

    `oversized` — the rooms are BIGGER than the map they were supposedly
    traced on, on at least one axis, past ordinary rounding. Not a
    heuristic: nothing traced on a photo can exceed that photo's own
    physical size on either axis, so this is the map's current scale having
    shrunk after the rooms were built, or rooms that were never really this
    map's.
    """
    out: list[dict[str, Any]] = []
    by_floor: dict[str, dict[str, dict]] = {}
    for room, geo in (room_geometry or {}).items():
        if isinstance(geo, dict):
            fl = str(geo.get("floor_id") or "main")
            by_floor.setdefault(fl, {})[room] = geo

    maps_by_floor: dict[str, list[dict]] = {}
    for m in (maps_list or []):
        maps_by_floor.setdefault(str(m.get("floor_id") or "main"), []).append(m)

    for fl, rooms in by_floor.items():
        stats = rooms_stats(rooms)
        room_w, room_h = stats["bbox_w_m"], stats["bbox_h_m"]
        if room_w <= 0 or room_h <= 0:
            continue

        # The largest MEASURED map on this floor, by diagonal — the closest
        # thing the floor has to a primary photo. Which map "wins" here is a
        # separate question from whether either axis then disagrees with it.
        best_map, best_sx, best_sy, best_diag = None, 0.0, 0.0, 0.0
        for m in maps_by_floor.get(fl, []):
            t = model_store.map_transform(m.get("id", "")) or {}
            if not t.get("reference_measurements"):
                continue
            sx, sy = t.get("scale_x_m"), t.get("scale_y_m")
            if not (isinstance(sx, (int, float)) and isinstance(sy, (int, float)) and sx > 0 and sy > 0):
                continue
            diag = math.hypot(sx, sy)
            if diag > best_diag:
                best_map, best_sx, best_sy, best_diag = m, sx, sy, diag
        if best_map is None:
            continue

        w_frac, h_frac = room_w / best_sx, room_h / best_sy
        entry = {
            "floor_id": fl,
            "map_id": best_map.get("id", ""),
            "map_name": str(best_map.get("name") or best_map.get("id", "")),
            "room_w_m": room_w, "room_h_m": room_h,
            "map_w_m": round(best_sx, 1), "map_h_m": round(best_sy, 1),
        }
        if max(w_frac, h_frac) > 1.02:
            out.append({**entry, "terms": ["oversized"], "footprint_frac": round(max(w_frac, h_frac), 3)})
        elif min(w_frac, h_frac) < ROOM_FOOTPRINT_MIN_FRAC:
            out.append({**entry, "terms": ["undersized"], "footprint_frac": round(min(w_frac, h_frac), 3)})
    return out


# A floor's two records of its rooms — the committed fabric and the map's
# hand trace — can drift apart AS A GROUP when either predates a change to
# the map (a re-measure moves what the trace derives to; an image op the
# trace missed moves the trace). Per-room disagreement is what hand editing
# looks like; the SAME offset on every room is what a stale record looks
# like, because no human edits every room by an identical factor.
ROOM_DIVERGENCE_MIN_ROOMS = 2      # one room can't establish a group
ROOM_DIVERGENCE_BAND = 0.10        # group ratio within ±10% of 1 = agreement
ROOM_DIVERGENCE_SPREAD = 1.15      # per-room ratios within 15% of each other


def room_divergence_faults(
        room_geometry: dict[str, dict[str, Any]],
        maps_list: list[dict], model_store: Any) -> list[dict[str, Any]]:
    """Maps whose hand trace and committed fabric disagree as a GROUP.

    READ ONLY, and deliberately agnostic about WHICH side is stale — it
    cannot know. The committed fabric may predate a placement fix (issue
    #62's first half) or the trace may predate an image op that skipped it
    (the second half — a measured-map trim before 0.38.10 renormalized
    every fraction on the map except the trace). Either way the two records
    stopped describing the same house, the divergence is one shared factor,
    and a person looking at the "Map placements" preview against the photo
    can tell in seconds which side matches reality. This exists so they
    look — the state was invisible for months otherwise.

    Fires only on the group signature: at least ROOM_DIVERGENCE_MIN_ROOMS
    rooms present in BOTH records, their candidate/fabric size ratios
    mutually consistent (spread under ROOM_DIVERGENCE_SPREAD — a hand edit
    moves one room by its own amount, not every room by the same amount),
    and the shared ratio outside the agreement band on either axis.

    SCALE only, by choice: size ratios are what a skipped crop renorm, a
    stale measurement and a stack-era placement all produce, and they are
    dimensionless — no threshold in metres to tune. A pure-translation
    group drift (same sizes, every room shifted by one vector — an
    origin-only re-anchor after commit) passes this quietly; if that state
    ever shows up in a report, a centroid-delta term belongs here beside
    the ratios.
    """
    by_name: dict[str, dict] = {r: g for r, g in (room_geometry or {}).items()
                                if isinstance(g, dict)}
    out: list[dict[str, Any]] = []
    for m in (maps_list or []):
        mid = m.get("id", "")
        bounds = m.get("room_bounds") or {}
        if not mid or not bounds:
            continue
        ratios: list[tuple[str, float, float]] = []
        for room in bounds:
            fab_geo = by_name.get(room)
            if not isinstance(fab_geo, dict):
                continue
            fb = geom_bbox_m(fab_geo)
            cand = recompute_room_from_map(m, room, model_store)
            cb = geom_bbox_m(cand) if cand else None
            if not fb or not cb:
                continue
            fw, fh = fb[2] - fb[0], fb[3] - fb[1]
            cw, ch = cb[2] - cb[0], cb[3] - cb[1]
            if min(fw, fh, cw, ch) <= 0.05:
                continue  # degenerate slivers prove nothing
            ratios.append((room, cw / fw, ch / fh))
        if len(ratios) < ROOM_DIVERGENCE_MIN_ROOMS:
            continue
        rx = [r[1] for r in ratios]
        ry = [r[2] for r in ratios]
        if max(rx) / min(rx) > ROOM_DIVERGENCE_SPREAD or max(ry) / min(ry) > ROOM_DIVERGENCE_SPREAD:
            continue  # rooms disagree with EACH OTHER — hand edits, not a group shift
        gx = sum(rx) / len(rx)
        gy = sum(ry) / len(ry)
        if abs(gx - 1.0) <= ROOM_DIVERGENCE_BAND and abs(gy - 1.0) <= ROOM_DIVERGENCE_BAND:
            continue
        out.append({
            "map_id": mid,
            "map_name": str(m.get("name") or mid),
            "floor_id": str(m.get("floor_id") or "main"),
            "rooms": [r[0] for r in ratios],
            "ratio_x": round(gx, 3),
            "ratio_y": round(gy, 3),
            "terms": ["group_offset"],
        })
    return out


# ── Provenance-gated reconcile ───────────────────────────────────────────────
# The one sanctioned way room geometry may be derived from map state after a
# floor is built. Everything here is READ ONLY — the write goes through
# FabricStore.async_correct_room like every other room write, and the caller
# (ws_fabric) re-verifies eligibility at execution time rather than trusting
# a list a client sent back.

PLACEMENT_SNAPSHOT_FIELDS = ("origin_x_m", "origin_y_m", "scale_x_m",
                             "scale_y_m", "rotation_rad", "shear_rad")


def placement_snapshot(t: dict | None) -> dict[str, float] | None:
    """The six placement fields, copied — the provenance stamp's payload.

    None when the transform cannot place a map: a stamp is the claim "this
    geometry is exactly what that placement implies", and an unreadable
    placement implies nothing, so stamping from one would be a false claim
    that later makes the room look reconcilable against garbage.
    """
    if not placement_is_readable(t or {}):
        return None
    return {
        "origin_x_m": float(t.get("origin_x_m") or 0.0),
        "origin_y_m": float(t.get("origin_y_m") or 0.0),
        "scale_x_m": float(t["scale_x_m"]),
        "scale_y_m": float(t["scale_y_m"]),
        "rotation_rad": float(t.get("rotation_rad") or 0.0),
        "shear_rad": float(t.get("shear_rad") or 0.0),
    }


def image_identity(m: dict) -> dict[str, Any] | None:
    """The identity of a map's CURRENT picture — the other half of a stamp.

    A placement snapshot alone cannot tell a re-measure from a crop: both
    rewrite the same six fields and neither touches ρ or σ. What separates
    them is the picture — a re-measure keeps it, an image op replaces its
    bytes — so the stamp records which picture the claim was made against.
    A stamp whose image differs from the map's current image is a claim
    about a picture that no longer exists, and the reconcile treats it
    accordingly (see `reconcilable_rooms`).
    """
    img = (m or {}).get("image") or {}
    sha = str(img.get("sha256") or "")
    if not sha:
        return None
    return {"sha256": sha,
            "w": int(img.get("width") or 0), "h": int(img.get("height") or 0)}


def geometry_close(a: dict | None, b: dict | None, tol_m: float = 0.05) -> bool:
    """Do two room geometries describe the same shape, within tolerance?

    Vertex-wise, not area-wise: two different rooms can share an area. The
    tolerance covers the store's rounding (1 mm on points) compounded
    through a frac→metre round trip, with margin — anything a human moved
    is centimetres at least.
    """
    if not isinstance(a, dict) or not isinstance(b, dict) or a.get("type") != b.get("type"):
        return False
    if a.get("type") == "poly":
        pa, pb = a.get("points_m") or [], b.get("points_m") or []
        if len(pa) != len(pb) or not pa:
            return False
        return all(math.hypot(float(p[0]) - float(q[0]), float(p[1]) - float(q[1])) <= tol_m
                   for p, q in zip(pa, pb))
    if a.get("type") == "circle":
        return (math.hypot(float(a.get("cx_m", 0)) - float(b.get("cx_m", 0)),
                           float(a.get("cy_m", 0)) - float(b.get("cy_m", 0))) <= tol_m
                and abs(float(a.get("r_m", 0)) - float(b.get("r_m", 0))) <= tol_m)
    return False


def recompute_room_from_map(m: dict, room: str, model_store: Any) -> dict | None:
    """One room's metre geometry, re-derived from its map's CURRENT placement.

    Deliberately the same arithmetic as `rooms_from_transforms` — the number
    the reconcile writes must be the number the "Map placements" candidate
    previews, or the preview and the action would disagree about what "fixed"
    looks like. Reads `room_bounds` and never writes it: the hand trace on
    the photo is the source here, not a target.
    """
    mid = m.get("id", "")
    b = (m.get("room_bounds") or {}).get(room)
    if not mid or not isinstance(b, dict):
        return None
    t = model_store.map_transform(mid)
    if not placement_is_readable(t or {}):
        return None
    avg_scale = (float(t.get("scale_x_m") or 0) + float(t.get("scale_y_m") or 0)) / 2
    return _bounds_to_geo(b, lambda px, py: model_store.map_frac_to_metres(px, py, mid), avg_scale)


def reconcilable_rooms(
        room_geometry: dict[str, dict[str, Any]],
        maps_list: list[dict], model_store: Any) -> list[dict[str, Any]]:
    """Rooms it is safe to re-derive from their map, and only those.

    Safe means every one of these, and each is a refusal on its own:

      * The room carries BOTH provenance fields — its stored geometry is the
        pure, unedited output of a named map's placement. A room without them
        is hand-authored, hand-corrected since, or predates the stamping, and
        in every one of those cases recomputing it would overwrite work or a
        state this code cannot reason about. That room is out of reach.
      * That map still exists and still carries a `room_bounds` trace for the
        room — there is something real to recompute FROM.
      * The map's current placement is readable — recomputing through a
        broken placement manufactures garbage with a fresh stamp on it.
      * The current placement DISAGREES with the stamp (`placements_agree`,
        the same tolerances as everything else). Agreement means the stored
        geometry already says what the map says, and rewriting it would be
        churn with a new revision number.

    And one more, added when the trim bug's second half surfaced: the
    IMAGE gate. A placement snapshot alone cannot tell a re-measure (bounds
    still valid — the original use case) from an image op the bounds might
    have missed (bounds possibly stale — reconciling would bake garbage
    with a fresh stamp on it). The picture's identity settles it: a stamp
    that recorded `source_image` is only honoured while the map still shows
    that picture, UNLESS the recompute converges on what is already stored
    — which is the signature of a completed image op (placement rebased AND
    bounds renormalized together), where re-deriving is a harmless
    re-stamp. A pre-image-gate stamp (no `source_image`) is honoured as it
    always was; that window is days of one beta.

    What this cannot know: whether the CURRENT placement is itself right.
    Provenance proves nothing hand-made is at stake; it does not prove the
    new answer is the true one. That is why the reconcile stays an explicit,
    visible action and never a side effect — the failure mode of trusting a
    freshly-wrong transform silently is the exact incident (f3466fc) this
    replaces.
    """
    maps_by_id = {m.get("id"): m for m in (maps_list or []) if m.get("id")}
    out: list[dict[str, Any]] = []
    for room, geo in (room_geometry or {}).items():
        if not isinstance(geo, dict):
            continue
        smid = geo.get("source_map_id")
        snap = geo.get("source_transform")
        if not smid or not isinstance(snap, dict):
            continue
        m = maps_by_id.get(smid)
        if not m or not isinstance((m.get("room_bounds") or {}).get(room), dict):
            continue
        cur = model_store.map_transform(smid) or {}
        if not placement_is_readable(cur):
            continue
        if placements_agree(snap, cur):
            continue
        stamped_sha = str(((geo.get("source_image") or {}).get("sha256")) or "")
        current_sha = str(((m.get("image") or {}).get("sha256")) or "")
        if stamped_sha and current_sha and stamped_sha != current_sha:
            cand = recompute_room_from_map(m, room, model_store)
            if cand is None or not geometry_close(cand, geo):
                continue
        out.append({
            "room": room,
            "floor_id": str(geo.get("floor_id") or "main"),
            "map_id": smid,
            "map_name": str(m.get("name") or smid),
        })
    return out


def placement_from_columns(
    origin: tuple[float, float],
    col_x: tuple[float, float],
    col_y: tuple[float, float],
) -> dict[str, float] | None:
    """The six-field placement whose two axes are these metre columns.

    The ONE place the record's fields are read off a pair of axes. The stack
    fit below measures a placement this way; so does the recompose after a
    baked image op (model_store.async_recompute_transform_for_map), which asks
    the old placement where the new image's corners went and reads the fields
    off what comes back. Two decompositions would be two chances to wrap σ
    differently, and σ is the field a disagreement is invisible in.

    σ is wrapped to a half-turn either way. `atan2` reports each column's
    bearing in (-π, π], so once ρ + σ passes a QUARTER turn the y column's
    bearing comes back a full turn below the x column's and the raw difference
    lands near -2π. Unwrapped, a square map rotated 143° with a 0.3° lean
    records σ = -359.7° — the same placement, since every conversion is
    2π-periodic in σ, and refused by everything that asks whether σ is SMALL.
    Everything that asks whether σ is SMALL — the conversion's refusal, the
    shear backfill's counter — reads it from here, so an unwrapped value would
    make a square map look sheared from about a quarter turn on.
    """
    scale_x_m = math.hypot(*col_x)
    scale_y_m = math.hypot(*col_y)
    if scale_x_m <= 0 or scale_y_m <= 0:
        return None
    rot = math.atan2(col_x[1], col_x[0])
    rot_y = math.atan2(col_y[1], col_y[0])
    return {
        "origin_x_m": origin[0],
        "origin_y_m": origin[1],
        "scale_x_m": scale_x_m,
        "scale_y_m": scale_y_m,
        "rotation_rad": rot,
        "shear_rad": ((rot_y - rot - math.pi / 2) + math.pi) % (2 * math.pi) - math.pi,
    }


def rebase_placement(t: dict, fx0: float, fy0: float, fw: float, fh: float) -> dict[str, float] | None:
    """The placement of a NEW image that occupies the old image's fraction
    rectangle [fx0, fx0+fw] x [fy0, fy0+fh].

    ONE operation for every image edit that changes what the picture covers,
    because they are one operation. A CROP keeps a sub-rectangle (0 <= fx0,
    fw <= 1). An EXTEND pads the canvas, which is the same thing with the
    rectangle bigger than the picture (fx0 < 0, fw > 1). A REVERT is the
    inverse of whichever ran. Each one has to leave every pixel of the
    retained image on the same square metre of the house, and each one used to
    have its own arithmetic:

      - the crop branch of `async_recompute_transform_for_map` did it right,
      - `_recrop_stack` did it AGAIN on the stack, so the two copies stayed in
        step (issue #62 is what happened when one of them did not),
      - `async_extend_canvas` and `async_revert_extend` did not do it AT ALL.
        They renormalise every stored fraction — receivers, beacons, room
        bounds — into the new image's frac space and touch neither placement.
        A map padded 20% on the left keeps a `scale_x_m` that describes the
        old width and an origin that points at the old top-left corner, so
        every frac on it converts to the wrong metres by the pad. That is the
        trim bug running the other way, live and unreported, in two functions.

    Substituting frac_old = (fx0, fy0) + (fw, fh) . frac_new into
    `placement_metres` gives an origin at the old rectangle's corner and both
    scales multiplied by the retained fraction. ρ and σ are UNTOUCHED: fw and
    fh are positive, so neither axis turns and the angle between them does not
    change — a crop does not rotate a picture and neither does a pad.

    The origin is ASKED of the placement rather than rebuilt from its fields.
    Rebuilding it was `origin + R(rho).(frac (*) scale)`, which is the
    five-field model, so a crop with fy0 != 0 on a sheared map dropped the
    -Sy.sin(sigma) term and moved the retained half of the picture. Identical
    arithmetic in identical order when sigma = 0.

    None when the record is not a placement or the rectangle is degenerate.
    """
    if not placement_is_readable(t) or not (fw > 0 and fh > 0):
        return None
    ox, oy = placement_metres(t, fx0, fy0)
    return {
        "origin_x_m": ox,
        "origin_y_m": oy,
        "scale_x_m": float(t["scale_x_m"]) * fw,
        "scale_y_m": float(t["scale_y_m"]) * fh,
        "rotation_rad": float(t.get("rotation_rad", 0) or 0.0),
        "shear_rad": float(t.get("shear_rad", 0) or 0.0),
    }


def _legacy_stack_metre_fit(m: dict, gauge: dict[str, Any]) -> dict[str, float] | None:
    """`legacy_stack_metre_transform` before it is rounded to the store's grid.

    Split out so the six-field MODEL can be checked against the renderer
    without the store's quantisation standing in the way. Rounding a
    placement to 0.1 mm and 1 µrad displaces the far corner of a 20 m map
    by ~1e-4 m, which is a floor under every placement tolerance measured
    through a stored record — and is not evidence about the model, which
    is exact. See test_placement_shear.py.
    """
    k = _gauge_scale(gauge)
    xf = legacy_stack_world_xform(m.get("stack") or {}, image_ar(m))
    o = xf(0.0, 0.0)
    ex = xf(1.0, 0.0)
    ey = xf(0.0, 1.0)
    # A world delta is scaled by the gauge, both components alike. It used to
    # take a separate figure per axis — the x component metres-per-world-x,
    # the y component metres-per-world-y — which is what a house scale read
    # off a photograph's footprint forced. With one gauge this is a SIMILARITY
    # transform: it cannot change a shape's aspect, cannot turn a right angle
    # into a lean, and cannot put a scale_y_m into map_transforms that
    # disagrees with the scale_x_m beside it. Issue #62 has no arithmetic left
    # to happen in.
    col_x = ((ex[0] - o[0]) * k, (ex[1] - o[1]) * k)
    col_y = ((ey[0] - o[0]) * k, (ey[1] - o[1]) * k)
    # σ, the sixth degree of freedom: how far the y column leans off
    # perpendicular to the x one. It is a FIELD OF THE PLACEMENT, not a
    # residual to be refused — with it stored, the record holds every affine
    # the renderer can draw, and σ = 0 is the five-field arithmetic unchanged.
    #
    # The SIGN is the placement; abs() was here, and both +5° and -5° of lean
    # recorded as +0.087266, i.e. the record could not say which way the map
    # was skewed.
    #
    # A degraded anchor used to MANUFACTURE σ with no Point Align involved:
    # when kx != ky the world→metre map is not conformal, so any ROTATED
    # placement came out non-perpendicular. One gauge cannot do that — a
    # similarity preserves angles — so every σ that reaches a record from here
    # is now a lean the renderer actually draws.
    #
    # The origin is a world POINT and takes the same gauge, exactly as the
    # column vectors above do.
    return placement_from_columns((o[0] * k, o[1] * k), col_x, col_y)


def legacy_stack_metre_transform(m: dict, gauge: dict[str, Any]) -> dict[str, float] | None:
    """The frac→metre placement a map's LEGACY stack implies. Legacy, and it
    has exactly one caller left: the conversion in `migrations.py`.

    Fits the six-field model the map_transforms store uses:

        metres = origin + R(ρ) · [[Sx, -Sy·sin σ], [0, Sy·cos σ]] · frac

    f(0,0) = origin; the columns f(1,0)-f(0,0) and f(0,1)-f(0,0) give the
    scaled axes, Sx and Sy their lengths, ρ the first column's bearing and σ
    the second column's lean away from perpendicular. It is what turns a hand
    alignment into a placement, which is the whole of the one-way conversion:
    the owner's drag becomes metres once and the drag itself is deleted.

    The six fields are a QR decomposition with a positive leading diagonal,
    which is complete over the invertible 2x2 — so this is not a fit that gets
    close, it reproduces every affine the renderer can draw exactly, mirrors
    included (a mirror is σ = ±π, not a separate flag).

    Rounded to what the store holds: 0.1 mm on a length, 1 µrad on an angle.
    """
    fit = _legacy_stack_metre_fit(m, gauge)
    if fit is None:
        return None
    return {
        "origin_x_m": round(fit["origin_x_m"], 4),
        "origin_y_m": round(fit["origin_y_m"], 4),
        "scale_x_m": round(fit["scale_x_m"], 4),
        "scale_y_m": round(fit["scale_y_m"], 4),
        "rotation_rad": round(fit["rotation_rad"], 6),
        "shear_rad": round(fit["shear_rad"], 6),
    }
