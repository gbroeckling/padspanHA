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

import io
import json
import math
import re
import zipfile
import zlib
from typing import Any

# The plan's single level: RoomPlan's world origin is wherever the phone
# started, so there is no meaningful elevation, and a CapturedStructure's
# rooms (even several stories of them) all land on this one level.
LEVEL_ID = "roomplan"
LEVEL_NAME = "RoomPlan scan"

_JOIN_M = 0.5   # wall ends further apart than this don't join into an outline


class RoomPlanParseError(Exception):
    """A file could not be read as a RoomPlan JSON export. Raised rather
    than returning a partial or guessed result. `code`: "unreadable" (not a
    zip or JSON that opens) or "not_scan" (it opened, and holds no room scan)."""

    def __init__(self, message: str, code: str = "unreadable") -> None:
        super().__init__(message)
        self.code = code


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
        return parse_usdz(data)
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
    return _parse_doc(doc)


def _parse_doc(doc: dict) -> dict[str, Any]:
    """A CapturedRoom or CapturedStructure, as a dict, into parse_sh3d's contract (parse_roomplan's and
    parse_usdz's one body)."""
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
        raise RoomPlanParseError("Not a RoomPlan export (no rooms, walls or floors found)", "not_scan")

    stories = {part.get("story") for cap in captures for part in [cap, *_list(cap, "floors")]
               if isinstance(part.get("story"), int)}
    if len(stories) > 1:
        warnings.append(f"The scan spans {len(stories)} stories; they are all placed on one level")
    if not rooms and not extras["walls"] and not extras["objects"]:
        # A file in some other tool's own layout (seen: an app's "blueprint" JSON, walls as size/position/rotation).
        raise RoomPlanParseError("No walls or rooms were found in this file. It isn't a RoomPlan export (CapturedRoom or CapturedStructure): "
                                 "in the scanning app, share the scan as USDZ, or as RoomPlan JSON.", "not_scan")
    if not rooms:
        warnings.append("No rooms with a usable polygon were found in this file")
    heights = sorted({round(d[1], 2) for cap in captures for w in _list(cap, "walls") for d in [_vec3(w.get("dimensions"))] if d and d[1] > 0})

    return {
        "levels": [{"id": LEVEL_ID, "name": LEVEL_NAME, "elevation_m": 0.0}],
        "rooms": rooms,
        "warnings": warnings,
        "source": "roomplan",
        "heights_m": heights,        # the walls' heights: one for a flat ceiling, several under a sloped or stepped one
        **extras,
    }


# ── RoomPlan's USDZ (2026-11-16) ─────────────────────────────────────────────────────────────────────────────────────
# What every RoomPlan app can share: CapturedRoom.export(to:) writes a zip of TEXT layers (.usda), one per wall, door,
# window, opening, floor and object, each with its category in customData, its mesh points in its own frame and its
# place as `matrix4d xformOp:transform` (rows: right, up, normal, position; metres, Y up). Checked against two real
# exports from two apps, one of them with the same room's JSON beside it: the walls' ends agree to the centimetre.
# The only binary files in it are optional furniture models, never read here. Each element becomes the dict
# JSONEncoder would have written (transform as 16 numbers, dimensions), so _parse_doc reads both the same way.
USDZ_MAX_FILES, USDZ_MAX_LAYER, USDZ_MAX_TOTAL = 4000, 2_000_000, 40_000_000
# Hostile text (review 2026-11-16): a pattern that may fail after a long run and start again at the next occurrence is
# quadratic, and a layer may be 2 MB. So a value is found with str.find, once, from its first key to the first closing
# mark (_usd_value: linear), and the patterns below run only on those short slices or have every run bounded.
_USD_TUPLE = re.compile(r"\(([^()]{0,200})\)")
_USD_CATEGORY = re.compile(r"([A-Za-z]{1,40})(.{0,80})", re.DOTALL)
_USD_SECTION = re.compile(r'def Xform "([A-Za-z]{1,60})\d{0,6}"[^{]{0,200}\{\s{0,40}matrix4d xformOp:transform = \( \([^)]{0,200}\), \([^)]{0,200}\), \([^)]{0,200}\), \(([^)]{0,200})\) \)')


def _usd_value(text: str, key: str, close: str, cap: int) -> str | None:
    """What stands between the first `key` and the first `close` after it, or None (no key, no close, or longer than `cap`)."""
    i = text.find(key)
    if i < 0:
        return None
    i += len(key)
    j = text.find(close, i, i + cap + 1)
    return text[i:j] if j >= 0 else None


class _Found(str):
    """A found value, read as the patterns used to be: .group(1) is the value."""

    def group(self, _n: int = 1) -> str:
        return str(self)


def _usd_found(text: str, key: str, close: str, cap: int) -> _Found | None:
    v = _usd_value(text, key, close, cap)
    return _Found(v) if v is not None else None
_USD_KINDS = {"Wall": "walls", "Door": "doors", "Window": "windows", "Opening": "openings", "Floor": "floors"}
_FACE_Z = 0.005     # a mesh point within this of z = 0 is on the element's face (its other side is the thickness away)


def _floats(text: str) -> list[float] | None:
    try:
        v = [float(x) for x in text.split(",")]
    except ValueError:
        return None
    return v if all(math.isfinite(x) for x in v) else None


def _usd_element(text: str) -> tuple[str, dict, int] | None:
    """One layer → (its list in a CapturedRoom, the element as JSONEncoder would write it, its rank), or None. An app
    may pack the same element three ways (assets/Parametric, Mesh, Model: one UUID): the parametric one, a unit cube
    with its width, height and thickness as its scale, is exactly the JSON's dimensions and ranks first (0); a mesh
    (1) is measured from its face, and its walls run a thickness long at the corners."""
    cat_text = _usd_value(text, 'string Category = "', '"', 120)
    cat = _USD_CATEGORY.fullmatch(cat_text) if cat_text is not None else None
    pts = _usd_found(text, "point3f[] points = [", "]", USDZ_MAX_LAYER)
    mat_text = _usd_value(text, "matrix4d xformOp:transform = ( ", " )\n", 900)
    if not cat or mat_text is None:
        return None
    rows = [_floats(g) for g in _USD_TUPLE.findall(mat_text)]
    if len(rows) != 4 or any(r is None or len(r) != 4 for r in rows):
        return None
    m = [v for r in rows for v in r]                       # rows right, up, normal, position: Swift's column-major 16
    kind = _USD_KINDS.get(cat.group(1))
    scale = _usd_value(text, "double3 xformOp:scale = (", ")", 200) if "def Cube" in text else None
    box = _floats(scale) if scale is not None else None
    if box and len(box) == 3 and not pts:
        el0: dict[str, Any] = {"transform": m, "dimensions": [box[0], box[1], 0.0 if kind else box[2]]}
        if kind is None:
            el0["category"] = cat.group(1)[:1].lower() + cat.group(1)[1:]
        elif kind == "doors":
            el0["category"] = {"door": {"isOpen": "true" in cat.group(2).lower()}}
        return kind or "objects", el0, 0
    if not pts:
        return None
    points = [p for p in (_floats(t) for t in _USD_TUPLE.findall(pts.group(1))) if p and len(p) == 3]
    if len(points) < 3:
        return None
    face = [p for p in points if abs(p[2]) <= _FACE_Z] or points
    x0, x1 = min(p[0] for p in face), max(p[0] for p in face)
    y0, y1 = min(p[1] for p in face), max(p[1] for p in face)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2                   # the face's centre, should the mesh not sit on its origin
    for i in range(3):
        m[12 + i] += m[i] * cx + m[4 + i] * cy
    el: dict[str, Any] = {"transform": m, "dimensions": [x1 - x0, y1 - y0, 0.0]}
    if kind == "doors":
        el["category"] = {"door": {"isOpen": "true" in cat.group(2).lower()}}
    if kind == "floors":
        ring = _face_outline(points, _usd_found(text, "int[] faceVertexIndices = [", "]", USDZ_MAX_LAYER))
        if ring:
            el["polygonCorners"] = [[x - cx, y - cy, 0.0] for x, y in ring]
    elif kind is None:
        el["category"] = cat.group(1)[:1].lower() + cat.group(1)[1:]
        el["dimensions"] = [x1 - x0, y1 - y0, max(p[2] for p in points) - min(p[2] for p in points)]
        kind = "objects"
    return kind, el, 1


def _face_outline(points: list[list[float]], faces: Any) -> list[tuple[float, float]] | None:
    """A floor's outline from its mesh: the edges of its top face (z = 0) that belong to one triangle only, chained.
    None when they don't close into one ring (the floor's rectangle is used then)."""
    idx = [int(v) for v in re.findall(r"-?\d+", faces.group(1))] if faces else []
    key = lambda i: (round(points[i][0], 3), round(points[i][1], 3))  # noqa: E731 — the mesh repeats a corner per face
    zs = [p[2] for p in points]
    top = max(zs)
    near = min(_FACE_Z, (top - min(zs)) / 2) or _FACE_Z      # the top face alone: a parametric floor is 0.0001 m thick
    edges: dict[tuple, int] = {}
    for t in range(0, len(idx) - 2, 3):
        tri = idx[t:t + 3]
        if any(i < 0 or i >= len(points) or abs(points[i][2] - top) >= near for i in tri):
            continue
        for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
            e = tuple(sorted((key(a), key(b))))
            if e[0] != e[1]:
                edges[e] = edges.get(e, 0) + 1
    rim = [e for e, n in edges.items() if n == 1]
    if len(rim) < 3:
        return None
    ring = [rim[0][0], rim[0][1]]
    left = rim[1:]
    while left:
        nxt = next((e for e in left if ring[-1] in e), None)
        if nxt is None:
            return None
        left.remove(nxt)
        ring.append(nxt[1] if nxt[0] == ring[-1] else nxt[0])
    if ring[0] != ring[-1] or len(ring) <= 3:
        return None
    ring = ring[:-1]
    # A straight edge is cut where two triangles meet: a corner is a point the outline turns at.
    turns = [p for i, p in enumerate(ring) if abs((p[0] - ring[i - 1][0]) * (ring[(i + 1) % len(ring)][1] - p[1])
                                                 - (p[1] - ring[i - 1][1]) * (ring[(i + 1) % len(ring)][0] - p[0])) > 1e-6]
    return turns if len(turns) >= 3 else None


def parse_usdz(data: bytes) -> dict[str, Any]:
    """A RoomPlan USDZ's raw bytes into parse_roomplan's contract. Raises RoomPlanParseError for a zip that is not a
    RoomPlan export (a mesh scan, a model from another tool), or one too large to be one."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        infos = z.infolist()
    except (zipfile.BadZipFile, ValueError, OSError) as exc:
        raise RoomPlanParseError("Not a USDZ file (it could not be opened)") from exc
    layers = [i for i in infos if i.filename.lower().endswith(".usda")]
    if len(infos) > USDZ_MAX_FILES or sum(i.file_size for i in layers) > USDZ_MAX_TOTAL or any(i.file_size > USDZ_MAX_LAYER for i in layers):
        raise RoomPlanParseError("This USDZ is too large to be a room scan")
    doc: dict[str, Any] = {k: [] for k in (*_USD_KINDS.values(), "objects", "sections")}
    seen: dict[str, tuple[int, str, dict]] = {}             # by UUID: the best-ranked form of each element
    for info in layers:
        try:
            # No more than a layer may hold is ever inflated, whatever size the zip declares for it (review 2026-11-16:
            # a 522 KB zip declaring 1,000 bytes inflated to 512 MB). One byte over is a file that is no room scan.
            with z.open(info) as fh:
                raw = fh.read(USDZ_MAX_LAYER + 1)
        except (zipfile.BadZipFile, OSError, RuntimeError, ValueError, EOFError, zlib.error):
            continue                                        # a damaged member: what else the file holds may still read
        if len(raw) > USDZ_MAX_LAYER:
            raise RoomPlanParseError("This USDZ is too large to be a room scan")
        text = raw.decode("utf-8", "replace")
        got = _usd_element(text)
        if got:
            uid = _usd_value(text, 'string UUID = "', '"', 80) or info.filename
            rank = 0 if "/parametric/" in info.filename.lower() else got[2]      # a floor is a mesh in every form
            if uid not in seen or rank < seen[uid][0]:
                seen[uid] = (rank, got[0], got[1])
        elif "Section_grp" in text:                         # the root layer: the room types the phone recognised
            for label, pos in _USD_SECTION.findall(text):
                c = _floats(pos)
                if c and len(c) == 4 and not label.endswith("grp"):
                    doc["sections"].append({"label": label, "center": c[:3]})
    for _rank, kind, el in seen.values():
        doc[kind].append(el)
    if not doc["walls"] and not doc["floors"]:
        raise RoomPlanParseError("No walls or floors were found in this USDZ. A room scan made with Apple's RoomPlan has them; "
                                 "a mesh scan (a photo-like 3D model) does not. In the scanning app, use its room or floor-plan mode.", "not_scan")
    return _parse_doc(doc)


def plan_frame(parsed: dict[str, Any], margin_m: float = 0.5) -> dict[str, Any] | None:
    """Pure. A scan turned and shifted into a plan's own frame: a scan's axes are wherever the phone pointed when it
    started, so everything is turned until the walls' main direction (by length, modulo a quarter turn) runs along
    the axes, then shifted so its box, `margin_m` round it, starts at 0, 0. {across_m, down_m, walls, openings, rooms
    [{name, points_m}]}, or None with no wall or room to draw."""
    walls = [(w["a_m"], w["b_m"]) for w in parsed.get("walls") or []]
    rooms = [r for r in parsed.get("rooms") or [] if len(r.get("points_m") or []) >= 3]
    edges = walls or [(r["points_m"][i - 1], r["points_m"][i]) for r in rooms for i in range(len(r["points_m"]))]
    if not edges:
        return None
    sx = sy = 0.0
    for a, b in edges:                                      # the mean direction of 4x the angle: quarter turns agree
        ln, ang = math.dist(a, b), math.atan2(b[1] - a[1], b[0] - a[0])
        sx += ln * math.cos(4 * ang)
        sy += ln * math.sin(4 * ang)
    turn = -math.atan2(sy, sx) / 4
    c, s = math.cos(turn), math.sin(turn)
    rot = lambda p: (p[0] * c - p[1] * s, p[0] * s + p[1] * c)  # noqa: E731
    pts = [rot(p) for e in edges for p in e] + [rot(p) for r in rooms for p in r["points_m"]]
    x0, y0 = min(p[0] for p in pts) - margin_m, min(p[1] for p in pts) - margin_m
    put = lambda p: [round(rot(p)[0] - x0, 3), round(rot(p)[1] - y0, 3)]  # noqa: E731
    return {"across_m": round(max(p[0] for p in pts) + margin_m - x0, 3), "down_m": round(max(p[1] for p in pts) + margin_m - y0, 3),
            "walls": [[put(a), put(b)] for a, b in walls],
            "openings": [{"kind": o.get("kind"), "a_m": put(o["a_m"]), "b_m": put(o["b_m"])} for o in parsed.get("openings") or []],
            "rooms": [{"name": r.get("name"), "points_m": [put(p) for p in r["points_m"]]} for r in rooms],
            "objects": [{"category": o.get("category"), "center_m": put(o["center_m"]), "size_m": o["size_m"], "height_m": o.get("height_m"),
                         "angle_deg": round(float(o.get("angle_deg") or 0.0) + math.degrees(turn), 1)}
                        for o in parsed.get("objects") or [] if o.get("center_m") and o.get("size_m")]}


# ── Autoplace (owner, 2026-11-16: "a test in a house like mine with plans would be an autoplace for lidar files") ────
# A scan is in true metres and so are the rooms a house already has, so there is no scale to guess: only where the scan
# sits and which way round. Its walls are laid over the edges of the floor's rooms at each quarter turn, from each
# room's middle and the floor's, and slid until as much wall as possible lies on a drawn edge. Pure, and it only
# answers: the caller decides whether to place the new plan there, and nothing that exists is ever moved.
PLACE_CELL_M = 0.1            # the grid the drawn edges are stamped on
PLACE_NEAR_M = (0.5, 0.2)     # a wall sample counts within this of a drawn edge: to search, then to score
PLACE_MIN = 0.7               # the share of the scan's walls that must lie on drawn edges
PLACE_CLEAR = 0.1             # ...and by this much more than anywhere else it could go
PLACE_TIE = 0.03              # two turns this close in score: the outline fits both ways round
PLACE_MAX_SAMPLES = 4000      # wall samples scored (a whole floor: thinned to this)


def _samples(edges: list, step: float) -> list[tuple[float, float]]:
    out = []
    for a, b in edges:
        ln = math.dist(a, b)
        n = max(1, int(ln / step))
        out += [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]
    return out


def _stamp(points: list[tuple[float, float]], near_m: float) -> set[tuple[int, int]]:
    """The grid cells within `near_m` of any of the points."""
    r = int(round(near_m / PLACE_CELL_M))
    disc = [(i, j) for i in range(-r, r + 1) for j in range(-r, r + 1) if i * i + j * j <= r * r]
    out: set[tuple[int, int]] = set()
    for x, y in points:
        cx, cy = int(round(x / PLACE_CELL_M)), int(round(y / PLACE_CELL_M))
        out.update((cx + i, cy + j) for i, j in disc)
    return out


PLACE_ROOM_MIN = 0.75         # a scanned room and a drawn one must cover each other this much (area in both / area in either)
PLACE_TURN = math.radians(15)    # how far from a quarter turn a scanned room may be turned to fit
PLACE_ROOM_SIZES = (0.55, 1.8)   # ...and be of about one size: the scan's area over the drawn room's


def _poly_area(P: list) -> float:
    return abs(sum(P[i - 1][0] * P[i][1] - P[i][0] * P[i - 1][1] for i in range(len(P)))) / 2


def _place_room(S: list, rooms: dict[str, list], frame: dict[str, Any], openings: list | None) -> dict[str, Any] | None:
    """autoplace for a scan of one closed room `S` (its outline in the plan's own metres)."""
    area_s = _poly_area(S)
    if area_s < 1.0:
        return None
    g = max(0.2, math.sqrt(area_s / 400))                     # about 400 samples, whatever the room's size
    x0, x1 = min(p[0] for p in S), max(p[0] for p in S)
    y0, y1 = min(p[1] for p in S), max(p[1] for p in S)
    Sl = [list(p) for p in S]
    pts = [(x0 + g / 2 + i * g, y0 + g / 2 + j * g) for i in range(int((x1 - x0) / g) + 1) for j in range(int((y1 - y0) / g) + 1)]
    pts = [p for p in pts if _inside([p[0], p[1]], Sl)]
    if len(pts) < 12:
        return None
    cx, cy = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    cell = area_s / len(pts)
    found: list[tuple[float, int, float, float, str, float]] = []
    for name, P in rooms.items():
        area_r = _poly_area(P)
        if area_r <= 0 or not PLACE_ROOM_SIZES[0] <= area_s / area_r <= PLACE_ROOM_SIZES[1]:
            continue
        Pl = [list(p) for p in P]
        bx0, bx1 = min(p[0] for p in P), max(p[0] for p in P)
        by0, by1 = min(p[1] for p in P), max(p[1] for p in P)

        def cover(th: float, tx: float, ty: float) -> float:
            c, s = math.cos(th), math.sin(th)
            n = 0
            for x, y in pts:
                dx, dy = x - cx, y - cy
                hx, hy = cx + dx * c - dy * s + tx, cy + dx * s + dy * c + ty
                if bx0 <= hx <= bx1 and by0 <= hy <= by1 and _inside([hx, hy], Pl):
                    n += 1
            both = n * cell
            return both / (area_s + area_r - both)

        for k in range(4):
            # From each quarter turn: slid and turned a little at a time while the cover grows. A room is seldom drawn
            # exactly square to its plan (a slanted garage wall, a plan placed a few degrees off), so the turn is free
            # within PLACE_TURN of the quarter.
            th, tx, ty = k * math.pi / 2, (bx0 + bx1) / 2 - cx, (by0 + by1) / 2 - cy
            best = cover(th, tx, ty)
            for st, da in ((0.4, math.radians(4)), (0.15, math.radians(1)), (0.05, math.radians(0.25))):
                moved = True
                while moved:
                    moved = False
                    for dx, dy, dt in ((st, 0, 0), (-st, 0, 0), (0, st, 0), (0, -st, 0), (0, 0, da), (0, 0, -da)):
                        if abs(th + dt - k * math.pi / 2) > PLACE_TURN:
                            continue
                        v = cover(th + dt, tx + dx, ty + dy)
                        if v > best + 1e-9:
                            best, th, tx, ty, moved = v, th + dt, tx + dx, ty + dy, True
            found.append((best, k, tx, ty, name, th))
    if not found:
        return None
    found.sort(reverse=True)
    top = found[0]
    other = next((f for f in found[1:] if f[4] != top[4]), None)
    if top[0] < PLACE_ROOM_MIN or (other and other[0] > top[0] - PLACE_CLEAR):
        return None
    turns = [f for f in found if f[4] == top[4] and f[1] != top[1] and f[0] >= top[0] - PLACE_TIE]
    both_ways = bool(turns)
    put_k = lambda f, x, y: (cx + (x - cx) * math.cos(f[5]) - (y - cy) * math.sin(f[5]) + f[2],  # noqa: E731
                             cy + (x - cx) * math.sin(f[5]) + (y - cy) * math.cos(f[5]) + f[3])
    doors = [((o["a_m"][0] + o["b_m"][0]) / 2, (o["a_m"][1] + o["b_m"][1]) / 2) for o in frame.get("openings") or []]
    if both_ways and openings and doors:                   # the house's drawn doors and windows say which way round
        near = _stamp([((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in openings], 0.6)
        hits = lambda f: sum(1 for d in doors if (int(round(put_k(f, *d)[0] / PLACE_CELL_M)), int(round(put_k(f, *d)[1] / PLACE_CELL_M))) in near)  # noqa: E731
        ranked = sorted([top, *turns], key=hits, reverse=True)
        if hits(ranked[0]) > hits(ranked[1]):
            top, both_ways = ranked[0], False
    ox, oy = put_k(top, 0.0, 0.0)
    P = rooms[top[4]]
    wx, wy = x1 - x0, y1 - y0
    return {"origin_x_m": round(ox, 3), "origin_y_m": round(oy, 3), "rotation_rad": round(top[5] % (2 * math.pi), 6), "score": round(top[0], 2),
            "room": top[4], "fits_both_ways": both_ways, "size_scan_m": [round(wy if top[1] % 2 else wx, 2), round(wx if top[1] % 2 else wy, 2)],
            "size_room_m": [round(max(p[0] for p in P) - min(p[0] for p in P), 2), round(max(p[1] for p in P) - min(p[1] for p in P), 2)]}


def autoplace(frame: dict[str, Any], house_rooms: dict[str, list], openings: list | None = None) -> dict[str, Any] | None:
    """Where a scan (plan_frame's) belongs among a floor's drawn rooms ({name: [[x_m, y_m], ...]}), or None when it
    fits nowhere well, or as well in two places. {origin_x_m, origin_y_m, rotation_rad: the plan's placement; score:
    the share of its walls on drawn edges; room: the room it lies in, when it lies in one; fits_both_ways: its outline
    fits as well turned round (a plain rectangle), so its doors may be on the wrong walls; size_scan_m / size_room_m:
    the scan's own width and depth and that room's, the scan's turned to match}. `openings`: the house's drawn doors
    and windows on this floor ([[a_m, b_m], ...], Live Aboard's), which settle which way round where they exist."""
    walls = [(tuple(a), tuple(b)) for a, b in frame.get("walls") or [] if math.dist(a, b) > 0.05]
    rooms = {n: [tuple(p[:2]) for p in pts] for n, pts in (house_rooms or {}).items() if isinstance(pts, list) and len(pts) >= 3}
    if len(walls) < 3 or not rooms:
        return None
    # One closed room in the scan: laid over each drawn room of about its size, scored by how much of the two cover
    # each other. (Walls on drawn edges alone let a small room slide along a neighbour's long wall: on a real house's
    # outlines that placed 10 of 21 right; this places it in its room or not at all.)
    one = [r["points_m"] for r in frame.get("rooms") or [] if len(r.get("points_m") or []) >= 3]
    if len(one) == 1:
        return _place_room([tuple(p[:2]) for p in one[0]], rooms, frame, openings)
    drawn = [(pts[i - 1], pts[i]) for pts in rooms.values() for i in range(len(pts))]
    edge_pts = _samples(drawn, PLACE_CELL_M)
    coarse, fine = _stamp(edge_pts, PLACE_NEAR_M[0]), _stamp(edge_pts, PLACE_NEAR_M[1])
    pts = _samples(walls, 0.2)
    if len(pts) > PLACE_MAX_SAMPLES:
        pts = pts[::len(pts) // PLACE_MAX_SAMPLES + 1]
    door_pts = [((o["a_m"][0] + o["b_m"][0]) / 2, (o["a_m"][1] + o["b_m"][1]) / 2) for o in frame.get("openings") or []]
    door_near = _stamp([((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) for a, b in (openings or [])], 0.6) if openings and door_pts else None
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    box = lambda P: ((min(p[0] for p in P) + max(p[0] for p in P)) / 2, (min(p[1] for p in P) + max(p[1] for p in P)) / 2)  # noqa: E731
    anchors = [box(P) for P in rooms.values()] + [box([p for P in rooms.values() for p in P])]

    def score(k: int, tx: float, ty: float, cells: set, of: list) -> float:
        c, s = ((1, 0), (0, 1), (-1, 0), (0, -1))[k]
        hit = 0
        for x, y in of:
            dx, dy = x - cx, y - cy
            if (int(round((cx + dx * c - dy * s + tx) / PLACE_CELL_M)), int(round((cy + dx * s + dy * c + ty) / PLACE_CELL_M))) in cells:
                hit += 1
        return hit / len(of)

    found: list[tuple[float, int, float, float]] = []
    for k in range(4):
        for ax, ay in anchors:
            tx, ty = ax - cx, ay - cy
            best = score(k, tx, ty, coarse, pts)
            for cells, steps in ((coarse, (0.6, 0.3, 0.1)), (fine, (0.1, 0.05))):
                best = score(k, tx, ty, cells, pts)
                for st in steps:
                    moved = True
                    while moved:
                        moved = False
                        for dx, dy in ((st, 0), (-st, 0), (0, st), (0, -st)):
                            v = score(k, tx + dx, ty + dy, cells, pts)
                            if v > best + 1e-9:
                                best, tx, ty, moved = v, tx + dx, ty + dy, True
            found.append((best, k, round(tx, 2), round(ty, 2)))
    found.sort(reverse=True)
    top = found[0]
    if top[0] < PLACE_MIN:
        return None
    same_spot = lambda a, b: math.hypot(a[2] - b[2], a[3] - b[3]) <= 0.5  # noqa: E731
    elsewhere = next((f for f in found[1:] if not same_spot(f, top)), None)
    if elsewhere and elsewhere[0] > top[0] - PLACE_CLEAR:
        return None                                        # as good a fit somewhere else: two rooms alike
    turns = [f for f in found if same_spot(f, top) and f[1] != top[1] and f[0] >= top[0] - PLACE_TIE]
    both = bool(turns)
    if both and door_near is not None:                     # the doors and windows say which way round
        ranked = sorted([top, *turns], key=lambda f: score(f[1], f[2], f[3], door_near, door_pts), reverse=True)
        if score(ranked[0][1], ranked[0][2], ranked[0][3], door_near, door_pts) > score(ranked[1][1], ranked[1][2], ranked[1][3], door_near, door_pts) + 1e-9:
            top, both = ranked[0], False
    _best, k, tx, ty = top
    c, s = ((1, 0), (0, 1), (-1, 0), (0, -1))[k]
    put = lambda x, y: (cx + (x - cx) * c - (y - cy) * s + tx, cy + (x - cx) * s + (y - cy) * c + ty)  # noqa: E731
    ox, oy = put(0.0, 0.0)
    mx, my = put(cx, cy)
    inside = [n for n, P in rooms.items() if _inside([mx, my], [list(p) for p in P])]
    wx = max(p[0] for p in pts) - min(p[0] for p in pts)
    wy = max(p[1] for p in pts) - min(p[1] for p in pts)
    out: dict[str, Any] = {"origin_x_m": round(ox, 3), "origin_y_m": round(oy, 3), "rotation_rad": round(k * math.pi / 2, 6),
                           "score": round(top[0], 2), "room": inside[0] if len(inside) == 1 else None, "fits_both_ways": both,
                           "size_scan_m": [round(wy if k % 2 else wx, 2), round(wx if k % 2 else wy, 2)]}
    if out["room"]:
        P = rooms[out["room"]]
        out["size_room_m"] = [round(max(p[0] for p in P) - min(p[0] for p in P), 2), round(max(p[1] for p in P) - min(p[1] for p in P), 2)]
    return out
