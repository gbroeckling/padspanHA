# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Apple RoomPlan JSON floorplan import — gap #7 tier 2, best-in-class roadmap:
"Floorplan import: Sweet Home 3D first, then RoomPlan JSON, then image
room-detection."

Parses a RoomPlan CapturedRoom or CapturedStructure, as written by Swift's
JSONEncoder, into the SAME candidate contract parse_sh3d returns
(sh3d_import.py): {"levels", "rooms", "warnings"}. Nothing is written to the
fabric here; maps.js's Rooms tab previews the candidate and the user commits
it exactly as it does an .sh3d import. JSON only: a USDZ export is a 3D
model, not a plan, and is refused with a clear message.

The structure below comes from Apple's documentation and public exports, not
a guess:

  - CapturedRoom / CapturedStructure are Codable; their encoded keys are the
    property names: walls, doors, windows, openings, floors, objects,
    sections, and (CapturedStructure) rooms: [CapturedRoom].
    https://developer.apple.com/documentation/roomplan/capturedroom
    https://developer.apple.com/documentation/roomplan/capturedstructure
  - A Surface/Object encodes "identifier", "category" (an enum, encoded as
    {"wall": {}} or {"door": {"isOpen": true}}), "confidence" ({"high": {}}),
    "dimensions" [x, y, z] in metres and "transform", a 4x4 matrix as a FLAT
    16-number array, column-major (columns.3 is the position). A JSONEncoder
    export of a wall, quoted in https://qiita.com/kitanote/items/efcc3f03cf1a84703e6c
  - The first column of a surface's transform is its "right" vector, the
    second "up"; a surface's corners follow from transform + dimensions
    (Apple engineers, WWDC22 RoomPlan Q&A,
    https://developer.apple.com/forums/thread/713409).
  - iOS 17 added floors with "polygonCorners" ([simd_float3], in the
    surface's local frame), "parentIdentifier" and "story", and sections:
    {label, center [x, y, z], story}.
    https://developer.apple.com/documentation/roomplan/capturedroom/section
    https://developer.apple.com/videos/play/wwdc2023/10192/
  - World frame is ARKit's: Y up, metres. The plan uses world X and Z.

No real RoomPlan export was available during development; the tests use a
hand-made fixture in this structure. Treat the first real import as the true
validation, as with the .sh3d importer.
"""

import json
import math
import re
from typing import Any

# The plan's single level: RoomPlan's world origin is wherever the phone
# started, so there is no meaningful elevation, and a CapturedStructure's
# rooms (even several stories of them) all land on this one level.
LEVEL_ID = "roomplan"
LEVEL_NAME = "RoomPlan scan"

_JOIN_M = 0.5   # wall ends further apart than this don't join into an outline


class RoomPlanParseError(Exception):
    """A file could not be read as a RoomPlan JSON export. Raised rather
    than returning a partial or guessed result."""


def _enum_name(value: Any) -> str | None:
    """A Swift enum as JSONEncoder writes it: "kitchen" or {"door": {...}}."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and len(value) == 1:
        return next(iter(value))
    return None


def _vec3(value: Any) -> tuple[float, float, float] | None:
    if not isinstance(value, list) or len(value) < 3:
        return None
    try:
        x, y, z = (float(v) for v in value[:3])
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(v) for v in (x, y, z)):
        return None
    return x, y, z


def _matrix(value: Any) -> list[float] | None:
    """The flat column-major 16 numbers of a simd_float4x4."""
    if not isinstance(value, list) or len(value) != 16:
        return None
    try:
        m = [float(v) for v in value]
    except (TypeError, ValueError):
        return None
    return m if all(math.isfinite(v) for v in m) else None


def _apply(m: list[float], p: tuple[float, float, float]) -> list[float]:
    """Local point → plan [x_m, y_m] (world X, world Z)."""
    x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
    z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
    return [round(x, 3), round(z, 3)]


def _clean_ring(points: list[list[float]]) -> list[list[float]]:
    out: list[list[float]] = []
    for p in points:
        if not out or p != out[-1]:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def _floor_polygon(floor: dict) -> list[list[float]] | None:
    """A floor surface's outline: its polygonCorners (iOS 17), else the
    rectangle its dimensions span (iOS 16)."""
    m = _matrix(floor.get("transform"))
    if m is None:
        return None
    corners = [c for c in (_vec3(v) for v in (floor.get("polygonCorners") or [])) if c]
    if len(corners) < 3:
        dims = _vec3(floor.get("dimensions"))
        if not dims or dims[0] <= 0 or dims[1] <= 0:
            return None
        hw, hd = dims[0] / 2, dims[1] / 2
        corners = [(-hw, -hd, 0.0), (hw, -hd, 0.0), (hw, hd, 0.0), (-hw, hd, 0.0)]
    ring = _clean_ring([_apply(m, c) for c in corners])
    return ring if len(ring) >= 3 else None


def _segment(surface: dict) -> tuple[list[float], list[float]] | None:
    """A wall/door/window/opening as its plan line: centre ± right * width/2."""
    m = _matrix(surface.get("transform"))
    dims = _vec3(surface.get("dimensions"))
    if m is None or not dims or dims[0] <= 0:
        return None
    hw = dims[0] / 2
    return _apply(m, (-hw, 0.0, 0.0)), _apply(m, (hw, 0.0, 0.0))


def _outline_from_walls(walls: list[dict]) -> list[list[float]] | None:
    """Chain wall segments end to nearest end into one outline."""
    segs = [s for s in (_segment(w) for w in walls) if s]
    if len(segs) < 3:
        return None
    ring = [segs[0][0], segs[0][1]]
    left = segs[1:]
    while left:
        tail = ring[-1]
        best_i, best_d, best_flip = 0, math.inf, False
        for i, (a, b) in enumerate(left):
            for flip, end in ((False, a), (True, b)):
                d = math.dist(tail, end)
                if d < best_d:
                    best_i, best_d, best_flip = i, d, flip
        if best_d > _JOIN_M:
            return None
        a, b = left.pop(best_i)
        ring.append(a if best_flip else b)
    ring = _clean_ring(ring)
    return ring if len(ring) >= 3 else None


def _inside(pt: list[float], poly: list[list[float]]) -> bool:
    x, y = pt
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def _label_words(label: str) -> str:
    """"livingRoom" → "Living room"."""
    words = re.sub(r"(?<!^)(?=[A-Z])", " ", label).lower()
    return words[:1].upper() + words[1:]


def _section_points(sections: Any) -> list[tuple[list[float], str]]:
    out = []
    for s in sections or []:
        if not isinstance(s, dict):
            continue
        label = _enum_name(s.get("label"))
        c = _vec3(s.get("center"))
        if label and label != "unidentified" and c:
            out.append(([c[0], c[2]], _label_words(label)))
    return out


def _name_for(poly: list[list[float]], own: list, shared: list) -> str | None:
    """The section labels whose centres fall in this outline; a lone room's
    own labels if none do (a centre can sit just outside an inferred shape)."""
    names: list[str] = []
    for pt, label in own + shared:
        if _inside(pt, poly) and label not in names:
            names.append(label)
    if not names:
        for _pt, label in own:
            if label not in names:
                names.append(label)
    return " / ".join(names) or None


def _list(d: dict, key: str) -> list[dict]:
    v = d.get(key)
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _rooms_of(room: dict, label: str, shared_sections: list, warnings: list) -> list[dict]:
    """One CapturedRoom → candidate room polygon(s)."""
    own = _section_points(room.get("sections"))
    polys = [p for p in (_floor_polygon(f) for f in _list(room, "floors")) if p]
    if not polys:
        outline = _outline_from_walls(_list(room, "walls"))
        if outline is None:
            warnings.append(f"Skipped {label}: no floor outline and its walls don't close into one")
            return []
        warnings.append(f"{label}: no floor outline in the scan — shape inferred from its walls")
        polys = [outline]
    return [{"name": _name_for(p, own, shared_sections), "level_id": LEVEL_ID, "points_m": p} for p in polys]


def _extras(captures: list[dict]) -> dict[str, list]:
    """Walls, doors/windows/openings and objects, for anything that wants
    more than the room outlines (the room candidate itself uses none)."""
    walls, openings, objects = [], [], []
    for cap in captures:
        for w in _list(cap, "walls"):
            seg = _segment(w)
            if seg:
                walls.append({"a_m": seg[0], "b_m": seg[1]})
        for key, kind in (("doors", "door"), ("windows", "window"), ("openings", "opening")):
            for s in _list(cap, key):
                seg = _segment(s)
                if not seg:
                    continue
                cat = s.get("category")
                is_open = None
                if isinstance(cat, dict) and isinstance(cat.get("door"), dict):
                    is_open = cat["door"].get("isOpen")
                openings.append({"kind": kind, "a_m": seg[0], "b_m": seg[1],
                                 "is_open": is_open if isinstance(is_open, bool) else None})
        for o in _list(cap, "objects"):
            m = _matrix(o.get("transform"))
            dims = _vec3(o.get("dimensions"))
            if m is None or not dims:
                continue
            objects.append({
                "category": _enum_name(o.get("category")) or "unknown",
                "center_m": [round(m[12], 3), round(m[14], 3)],
                "size_m": [round(dims[0], 3), round(dims[2], 3)],
                "height_m": round(dims[1], 3),
                "angle_deg": round(math.degrees(math.atan2(m[2], m[0])), 1),
            })
    return {"walls": walls, "openings": openings, "objects": objects}


_MAX_DEPTH = 200   # a RoomPlan export is a few levels deep
# A string (to its closing quote, or to the end if it has none) or one
# bracket, in one left-to-right pass: an unclosed quote is read to the end
# once, not again from every quote after it (that was quadratic).
_TOKENS = re.compile(r'"(?:[^"\\]|\\.)*(?:"|\\?\Z)|[\[\]{}]', re.DOTALL)


def parse_roomplan(data: bytes) -> dict[str, Any]:
    """Parse a RoomPlan JSON export's raw bytes into parse_sh3d's contract.

    Returns {"levels": [one level], "rooms": [...], "warnings": [...],
    "source": "roomplan", "walls", "openings", "objects"}: rooms as
    {"name", "level_id", "points_m"}, outlines from the floors (or, failing
    that, the walls, with a warning that the shape was inferred), names from
    the section labels.

    Raises RoomPlanParseError for anything that isn't a CapturedRoom or
    CapturedStructure JSON export.
    """
    if data[:2] == b"PK":
        raise RoomPlanParseError(
            "This looks like a USDZ (3D model) export. Export the scan as JSON "
            "(CapturedRoom or CapturedStructure) and import that instead.")
    try:
        text = data.decode("utf-8-sig")
        # Refuse absurd nesting before parsing: whether json.loads gives up on
        # it (RecursionError) depends on the Python build, so the answer
        # wouldn't be the same on every machine. A real export is a few
        # levels deep. Strings are blanked first so brackets in text don't count.
        depth = deepest = 0
        for m in _TOKENS.finditer(text):
            tok = m.group()
            if tok[0] == '"':
                continue
            depth += 1 if tok in "[{" else -1
            deepest = max(deepest, depth)
            if deepest > _MAX_DEPTH:
                raise ValueError("nested too deeply")
        doc = json.loads(text)
    except (UnicodeDecodeError, ValueError, RecursionError) as exc:
        raise RoomPlanParseError("Not a valid RoomPlan JSON file (could not read it as JSON)") from exc
    if not isinstance(doc, dict):
        raise RoomPlanParseError("Not a RoomPlan export (expected a JSON object)")

    warnings: list[str] = []
    rooms: list[dict[str, Any]] = []
    if isinstance(doc.get("rooms"), list):
        captures = _list(doc, "rooms")
        shared = _section_points(doc.get("sections"))
        for i, room in enumerate(captures):
            rooms += _rooms_of(room, f"scanned room {i + 1}", shared, warnings)
        if not rooms and _list(doc, "floors"):
            rooms = _rooms_of(doc, "the structure", [], warnings)
        extras = _extras(captures or [doc])
    elif any(isinstance(doc.get(k), list) for k in ("walls", "floors")):
        captures = [doc]
        rooms = _rooms_of(doc, "the scanned room", [], warnings)
        extras = _extras(captures)
    else:
        raise RoomPlanParseError("Not a RoomPlan export (no rooms, walls or floors found)")

    stories = {part.get("story") for cap in captures for part in [cap, *_list(cap, "floors")]
               if isinstance(part.get("story"), int)}
    if len(stories) > 1:
        warnings.append(f"The scan spans {len(stories)} stories; they are all placed on one level")
    if not rooms:
        warnings.append("No rooms with a usable polygon were found in this file")

    return {
        "levels": [{"id": LEVEL_ID, "name": LEVEL_NAME, "elevation_m": 0.0}],
        "rooms": rooms,
        "warnings": warnings,
        "source": "roomplan",
        **extras,
    }
