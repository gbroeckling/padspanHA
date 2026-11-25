# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Plan files from other apps ("More imports", approved by the owner 2026-11-23; free, as all plan making is):
Easy Floorplan's card YAML, DXF drawings and Floorplanner's FML. Each is read into roomplan_import's contract
({levels, rooms, warnings, source, walls, openings, objects, heights_m}), so Mapping → Upload's "Import a plan from
another app" goes down the room scan's own path (ws_maps.ws_maps_scan_create: plan_frame, scan_plan_png, the plan
saved to scale, the file's rooms kept as outlines a Home Assistant room can take). No second pipeline, and nothing
is written here. Rooms stay Home Assistant areas: the file's rooms are outlines to link, never new rooms.

Added to the contract: "file" (which format), "scale" ("file": its own unit; "typed": the width the person typed;
"doors": estimated from its doors) and "skipped" [{"what", "n"}], what was left out, by kind (views/rough_plan.js
says each in the panel's language). parse_plan_file picks the format from the bytes and hands anything else to
roomplan_import.parse_roomplan, so a RoomPlan scan reads exactly as before.

Where each format comes from (read for this, nothing guessed beyond what is noted):
  Easy Floorplan  the card's configuration reference, github.com/nicosandller/easy-floorplan docs/configuration.md:
                  walls {x1, y1, x2, y2}, openings {type door|window|passage|skylight, x, y, length, angle in
                  degrees}, areas {points [{x, y}], name, haArea (a Home Assistant area id)}, items (devices, each
                  with its entity), furniture, texts, trackers; several floors under `floors` ({id, name, haFloor,
                  and the same lists}) or one plan at the top. Coordinates are "canvas units" with no length
                  behind them, y down, so the scale is the width typed or, failing that, the doors (DOOR_M wide).
                  Its docs warn Home Assistant's editor can save the `y` key as `true`: read too.
  DXF             AutoCAD's DXF reference: ASCII group-code pairs; $INSUNITS (header, group 70) gives the unit;
                  LWPOLYLINE (70 bit 1 closed, 10/20 vertices, 42 bulge), POLYLINE with VERTEX ... SEQEND, LINE
                  (10/20, 11/21), TEXT and MTEXT (10/20, 1). Y runs up, so it is turned over. Closed polylines are
                  rooms (as NextFloor and NeonPlan read them), named by a text inside them; open ones and lines
                  are walls. Binary DXF and DWG are refused with what to do instead.
  Floorplanner    the FML v3.0 "persistent" JSON, floorplanner.readme.io/reference/v30-specification: Project
                  {floors [{id, name, level, designs [{walls, areas, items, labels, lines, dimensions,
                  surfaces}]}]}, walls {a {x, y}, b {x, y}, c (a curve's control point), openings [{type, t 0-1
                  along a→b, width}]}, areas {poly [{x, y}], name, customName}; centimetres, y down. The opening
                  width's unit is not stated there: taken as centimetres like everything else. Its export (Quick
                  Export) is a zip holding the .fml; the older XML FML is refused with a clear message.

No real export of any of the three was available while this was written: the tests use small files made for them
in these structures. As with the RoomPlan and Sweet Home 3D readers, the first real file is the true test.
"""

import io
import json
import math
import re
import zipfile
import zlib
from typing import Any

from . import roomplan_import as RP

DOOR_M = 0.85                  # an Easy Floorplan door's width, when the doors are all the scale there is
MIN_ROOM_M2 = 1.0              # a closed shape smaller than this is no room (a column, a cupboard, a symbol)
THIN_M = 0.5                   # ...and one thinner than this on average is a wall drawn as an outline
MAX_ROOMS = 60                 # the rooms a plan keeps (ws_maps_scan_create)
FML_MAX_BYTES = 20_000_000     # an .fml inside a zip, inflated, at most
_NODE_BUDGET = 50_000          # dicts and lists looked through for the card in a whole dashboard's YAML

# $INSUNITS (AutoCAD's header variable): code → metres. 0 is "unitless", and so is anything not listed.
DXF_UNITS = {1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1.0, 10: 0.9144, 14: 0.1}

SKIP_KINDS = ("devices", "furniture", "annotations", "small_shapes", "thin_shapes", "curves", "other_designs",
              "rooms_over", "bad", "other")


class PlanFileError(RP.RoomPlanParseError):
    """A plan file that can't be drawn. `code` as RoomPlanParseError's, and: "need_size" (no unit and nothing to
    judge one by: the width is asked for), "pick_level" (several floors in the file: `levels` says which), "empty"
    (nothing to draw). `why`, where there is more to say than the code: "binary_dxf", "dwg", "fml_xml", "sh3d",
    "no_card" (the panel says each in its language, views/rough_plan.js)."""

    def __init__(self, message: str, code: str = "unreadable", levels: list[dict] | None = None, why: str = "") -> None:
        super().__init__(message, code)
        self.levels = levels or []
        self.why = why


# ── Choosing the format ─────────────────────────────────────────────────────────────────────────────────────────────

def parse_plan_file(data: bytes, *, across_m: float | None = None, level: str | None = None, floor_id: str | None = None,
                    area_names: dict[str, str] | None = None) -> dict[str, Any]:
    """Any plan file Mapping → Upload takes, by its bytes: a RoomPlan scan (USDZ or JSON), Easy Floorplan YAML, a DXF
    or Floorplanner's FML (or its zip). `across_m`: the drawing's width, for a file with no unit. `level`: which of
    the file's floors (an id from PlanFileError.levels); unsaid, the one linked to `floor_id`, else the only one.
    `area_names`: Home Assistant's {area id: name}, to name an Easy Floorplan room by the area it is linked to."""
    if data[:2] == b"PK":
        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        except (zipfile.BadZipFile, ValueError, OSError):
            names = []
        if "Home.xml" in names or "Home" in names:
            raise PlanFileError("This is a Sweet Home 3D file. Import it in Mapping → Layout with 📐 Import floorplan.", "not_scan", why="sh3d")
        if any(n.lower().endswith(".fml") for n in names):
            return _done(parse_floorplanner(data, level=level), "floorplanner")
        return _done(RP.parse_roomplan(data), "usdz")
    if data.startswith(b"AutoCAD Binary DXF"):
        raise PlanFileError("This is a binary DXF. Save it again as an ASCII (text) DXF and pick that.", "unreadable", why="binary_dxf")
    if re.match(rb"AC10\d\d", data[:6]):
        raise PlanFileError("This is a DWG drawing. Save or export it as DXF and pick that.", "unreadable", why="dwg")
    text = _text(data)
    if _looks_dxf(text):
        return _done(parse_dxf(text, across_m=across_m), "dxf")
    head = text.lstrip()[:400]
    if head.startswith("<"):
        if re.search(r"<(project|design|floorplanner)\b", head):
            raise PlanFileError("This is Floorplanner's older XML form of FML, which PadSpan doesn't read. "
                                "Export the project again (Quick Export) for the newer JSON form.", "unreadable", why="fml_xml")
        return _done(RP.parse_roomplan(data), "json")         # not JSON either: RoomPlan's reader says so
    if head.startswith(("{", "[")):
        try:
            doc = json.loads(text)
        except (ValueError, RecursionError):
            doc = None
        if isinstance(doc, dict) and _is_fml(doc):
            return _done(_floorplanner_doc(doc, level=level), "floorplanner")
        card = _find_card(doc) if doc is not None else None
        if card is not None:
            return _done(_easy_floorplan_card(card, across_m=across_m, level=level, floor_id=floor_id, area_names=area_names), "easy_floorplan")
        return _done(RP.parse_roomplan(data), "json")
    return _done(parse_easy_floorplan(text, across_m=across_m, level=level, floor_id=floor_id, area_names=area_names), "easy_floorplan")


def _done(parsed: dict[str, Any], file: str) -> dict[str, Any]:
    parsed["file"] = file
    parsed.setdefault("skipped", [])
    parsed.setdefault("scale", "file")
    return parsed


def _text(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", "replace")          # an older DXF is written in the Windows code page


# ── Shared ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float, str)):
        return None
    try:
        f = float(v)
    except ValueError:
        return None
    return f if math.isfinite(f) else None


def _area(pts: list[list[float]]) -> float:
    return abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1]))) / 2


def _perimeter(pts: list[list[float]]) -> float:
    return sum(math.dist(p, q) for p, q in zip(pts, pts[1:] + pts[:1]))


class _Out:
    """What a reader gathers: levels, rooms, walls, openings, skipped (by kind) and warnings, in metres."""

    def __init__(self, source: str) -> None:
        self.source = source
        self.rooms: list[dict[str, Any]] = []
        self.walls: list[dict[str, Any]] = []
        self.openings: list[dict[str, Any]] = []
        self.skipped: dict[str, int] = {}
        self.warnings: list[str] = []
        self._edges: set[tuple] = set()

    def skip(self, what: str, n: int = 1) -> None:
        if n > 0:
            self.skipped[what] = self.skipped.get(what, 0) + n

    def wall(self, a: list[float], b: list[float]) -> None:
        a, b = [round(a[0], 3) + 0.0, round(a[1], 3) + 0.0], [round(b[0], 3) + 0.0, round(b[1], 3) + 0.0]   # never -0.0
        key = tuple(sorted((tuple(a), tuple(b))))
        if a != b and key not in self._edges:                # two rooms' shared edge is one wall
            self._edges.add(key)
            self.walls.append({"a_m": a, "b_m": b})

    def room(self, name: str | None, pts: list[list[float]], level_id: str, edges_are_walls: bool = False) -> None:
        if len(self.rooms) >= MAX_ROOMS:
            self.skip("rooms_over")
            return
        self.rooms.append({"name": (name or None), "level_id": level_id, "points_m": [[round(x, 3) + 0.0, round(y, 3) + 0.0] for x, y in pts]})
        if edges_are_walls:
            for a, b in zip(pts, pts[1:] + pts[:1]):
                self.wall(a, b)

    def result(self, levels: list[dict], level_id: str, scale: str = "file") -> dict[str, Any]:
        if not self.rooms and not self.walls:
            raise PlanFileError("Nothing to draw: no walls or rooms were found in this file.", "empty")
        if not self.walls:                                   # rooms and no wall: the rooms' edges are what is drawn
            for r in self.rooms:
                pts = r["points_m"]
                for a, b in zip(pts, pts[1:] + pts[:1]):
                    self.wall(a, b)
        if not self.rooms:
            self.warnings.append("No rooms with a usable outline were found in this file")
        return {"levels": levels, "level": level_id, "rooms": self.rooms, "warnings": self.warnings, "source": self.source,
                "walls": self.walls, "openings": self.openings, "objects": [], "heights_m": [], "scale": scale,
                "skipped": [{"what": k, "n": self.skipped[k]} for k in SKIP_KINDS if self.skipped.get(k)]}


def _ring(pts: list[list[float]]) -> list[list[float]]:
    return RP._clean_ring(pts)  # noqa: SLF001 — the RoomPlan reader's own: duplicates out, the ring left open


def _choose(levels: list[dict], with_content: list[str], level: str | None, floor_id: str | None,
            linked: dict[str, str] | None = None) -> str:
    """The file's floor to draw: the one asked for, else the only one with anything on it, else the one linked to
    the Home Assistant floor chosen. Otherwise the person is asked (PlanFileError "pick_level")."""
    ids = [lv["id"] for lv in levels]
    if level is not None and level in ids:
        return level
    if level is None:
        if len(with_content) == 1:
            return with_content[0]
        if not with_content:
            raise PlanFileError("Nothing to draw: no walls or rooms were found in this file.", "empty")
        hit = [i for i in with_content if floor_id and (linked or {}).get(i) == floor_id]
        if len(hit) == 1:
            return hit[0]
    raise PlanFileError("This file has several floors. Choose which one to draw.", "pick_level",
                        [lv for lv in levels if lv["id"] in with_content])


# ── Easy Floorplan ──────────────────────────────────────────────────────────────────────────────────────────────────

CARD_TYPE = "custom:easy-floorplan-card"


def parse_easy_floorplan(text: str, *, across_m: float | None = None, level: str | None = None, floor_id: str | None = None,
                         area_names: dict[str, str] | None = None) -> dict[str, Any]:
    """Easy Floorplan's card configuration (the card alone, or a whole dashboard's YAML holding it) into the
    contract. Raises PlanFileError when it isn't YAML, holds no such card, or has nothing to scale it by."""
    import yaml  # noqa: PLC0415 — Home Assistant ships PyYAML; only this reader needs it
    try:
        doc = yaml.load(text, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))  # noqa: S506 — a safe loader
    except (yaml.YAMLError, RecursionError, ValueError) as exc:
        raise PlanFileError("This file could not be read: it is not a plan file PadSpan knows "
                            "(RoomPlan, Easy Floorplan YAML, DXF or Floorplanner FML).", "unreadable") from exc
    if not isinstance(doc, (dict, list)):
        raise PlanFileError("This file could not be read: it is not a plan file PadSpan knows "
                            "(RoomPlan, Easy Floorplan YAML, DXF or Floorplanner FML).", "unreadable")
    card = _find_card(doc)
    if card is None:
        raise PlanFileError("No Easy Floorplan card was found in this file. In the dashboard, edit the card, open "
                            "its code editor and copy all of it into the file.", "not_scan", why="no_card")
    return _easy_floorplan_card(card, across_m=across_m, level=level, floor_id=floor_id, area_names=area_names)


def _looks_card(d: dict) -> bool:
    if d.get("type") == CARD_TYPE:
        return True
    if "type" in d:
        return False
    walls = d.get("walls")
    floors = d.get("floors")
    return (isinstance(walls, list) and any(isinstance(w, dict) and "x1" in w for w in walls[:20])) or \
        (isinstance(floors, list) and any(isinstance(f, dict) and isinstance(f.get("walls"), list) for f in floors[:20]))


def _find_card(doc: Any) -> dict | None:
    """The card: the document itself, or the first such card found in it (a whole dashboard pasted), looked through
    breadth first and no further than _NODE_BUDGET dicts and lists, so a file built to be endless ends."""
    queue, seen = [doc], 0
    while queue and seen < _NODE_BUDGET:
        node = queue.pop(0)
        seen += 1
        if isinstance(node, dict):
            if _looks_card(node):
                return node
            queue.extend(v for v in node.values() if isinstance(v, (dict, list)))
        elif isinstance(node, list):
            queue.extend(v for v in node if isinstance(v, (dict, list)))
    return None


def _xy(d: Any) -> tuple[float, float] | None:
    """An Easy Floorplan point: `x` and `y`, the y also as Home Assistant's editor may save it (`true`)."""
    if not isinstance(d, dict):
        return None
    x = _num(d.get("x"))
    y = next((v for v in (_num(d.get(k)) for k in ("y", True, "true")) if v is not None), None)
    return (x, y) if x is not None and y is not None else None


def _list(d: dict, key: str) -> list:
    v = d.get(key)
    return v if isinstance(v, list) else []


def _easy_floorplan_card(card: dict, *, across_m: float | None, level: str | None, floor_id: str | None,
                         area_names: dict[str, str] | None) -> dict[str, Any]:
    floors = [f for f in _list(card, "floors") if isinstance(f, dict)]
    if floors:
        levels = [{"id": str(f.get("id") or f"floor_{i + 1}"), "name": str(f.get("name") or f.get("id") or f"Floor {i + 1}"),
                   "elevation_m": 0.0} for i, f in enumerate(floors)]
        by_id = {lv["id"]: f for lv, f in zip(levels, floors)}
        linked = {lv["id"]: str(f.get("haFloor")) for lv, f in zip(levels, floors) if f.get("haFloor")}
    else:
        levels = [{"id": "plan", "name": str(card.get("title") or "Plan"), "elevation_m": 0.0}]
        by_id, linked = {"plan": card}, {}
    content = [i for i, f in by_id.items() if _list(f, "walls") or _list(f, "areas")]
    chosen = _choose(levels, content, level, floor_id, linked)
    fl = by_id[chosen]

    # The drawing in its own units first, then one scale for all of it.
    walls_u: list[tuple[tuple[float, float], tuple[float, float]]] = []
    out = _Out("easy_floorplan")
    for w in _list(fl, "walls"):
        a = (_num(w.get("x1")), _num(w.get("y1"))) if isinstance(w, dict) else (None, None)
        b = (_num(w.get("x2")), _num(w.get("y2"))) if isinstance(w, dict) else (None, None)
        if None in a or None in b:
            out.skip("bad")
            continue
        walls_u.append((a, b))   # type: ignore[arg-type]
    rooms_u: list[tuple[str | None, list[tuple[float, float]]]] = []
    for ar in _list(fl, "areas"):
        pts = [_xy(p) for p in _list(ar, "points")] if isinstance(ar, dict) else []
        if len(pts) < 3 or any(p is None for p in pts):
            out.skip("bad")
            continue
        ha = str(ar.get("haArea") or "")
        rooms_u.append(((area_names or {}).get(ha) or str(ar.get("name") or "").strip() or None, pts))   # type: ignore[arg-type]
    doors_u: list[float] = []
    openings_u: list[tuple[str, tuple[float, float], tuple[float, float]]] = []
    for o in _list(fl, "openings"):
        kind = o.get("type", "door") if isinstance(o, dict) else None
        c, ln = _xy(o), _num(o.get("length")) if isinstance(o, dict) else None
        if kind == "skylight":
            out.skip("other")
            continue
        if kind not in ("door", "window", "passage") or c is None or not ln or ln <= 0:
            out.skip("bad")
            continue
        ang = math.radians(_num(o.get("angle")) or 0.0)
        dx, dy = math.cos(ang) * ln / 2, math.sin(ang) * ln / 2
        openings_u.append(("opening" if kind == "passage" else kind, (c[0] - dx, c[1] - dy), (c[0] + dx, c[1] + dy)))
        if kind == "door":
            doors_u.append(ln)
    out.skip("devices", len(_list(fl, "items")) + len(_list(fl, "trackers")))
    out.skip("furniture", len(_list(fl, "furniture")))
    out.skip("annotations", len(_list(fl, "texts")) + len(_list(fl, "panels")))
    out.skip("other", len(_list(fl, "roofs")))

    xs = [p[0] for w in walls_u for p in w] or [p[0] for _n, pts in rooms_u for p in pts]
    width_u = (max(xs) - min(xs)) if xs else 0.0
    if across_m and width_u > 0:
        s, scale = across_m / width_u, "typed"
    elif doors_u:
        s, scale = DOOR_M / sorted(doors_u)[len(doors_u) // 2], "doors"
    else:
        raise PlanFileError("Easy Floorplan drawings have no unit, and this one has no doors to judge one by. "
                            "Type the drawing's width (outside wall to outside wall) and pick the file again.", "need_size")
    for a, b in walls_u:
        out.wall([a[0] * s, a[1] * s], [b[0] * s, b[1] * s])
    for name, pts in rooms_u:
        ring = _ring([[x * s, y * s] for x, y in pts])
        if len(ring) < 3 or _area(ring) <= 0.01:              # a room drawn as a line: it has no inside
            out.skip("bad")
            continue
        out.room(name, ring, chosen, edges_are_walls=not walls_u)
    for kind, a, b in openings_u:
        out.openings.append({"kind": kind, "a_m": [round(a[0] * s, 3), round(a[1] * s, 3)], "b_m": [round(b[0] * s, 3), round(b[1] * s, 3)]})
    return out.result(levels, chosen, scale)


# ── DXF ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

def _looks_dxf(text: str) -> bool:
    lines = [ln.strip() for ln in text[:4000].splitlines()[:8]]
    while len(lines) >= 2 and lines[0] == "999":          # a comment first, as some programs write
        lines = lines[2:]
    return len(lines) >= 2 and lines[0] == "0" and lines[1].upper() == "SECTION"


def _dxf_pairs(text: str) -> list[tuple[int, str]]:
    lines = text.splitlines()
    pairs = []
    for i in range(0, len(lines) - 1, 2):
        try:
            code = int(lines[i].strip())
        except ValueError as exc:
            raise PlanFileError(f"This DXF could not be read (line {i + 1} should be a group code).", "unreadable") from exc
        pairs.append((code, lines[i + 1].strip()))
    return pairs


def _mtext(s: str) -> str:
    s = re.sub(r"\\[PpNn~]", " ", s)
    s = re.sub(r"\\[A-Za-z][^;\\{}]*;", "", s)
    return " ".join(s.replace("{", "").replace("}", "").split())


def parse_dxf(text: str, *, across_m: float | None = None) -> dict[str, Any]:
    """An ASCII DXF into the contract: closed polylines are rooms, open ones and lines walls, a text inside a room
    its name. Raises PlanFileError when it can't be read, or has no unit and no width was typed."""
    pairs = _dxf_pairs(text)
    units = 0
    section = None
    ents: list[tuple[str, list[tuple[int, str]]]] = []
    i = 0
    while i < len(pairs):
        code, val = pairs[i]
        if code == 0 and val == "SECTION" and i + 1 < len(pairs) and pairs[i + 1][0] == 2:
            section = pairs[i + 1][1].upper()
            i += 2
            continue
        if code == 0 and val == "ENDSEC":
            section = None
        elif section == "HEADER" and code == 9 and val == "$INSUNITS" and i + 1 < len(pairs):
            try:
                units = int(pairs[i + 1][1])
            except ValueError:
                units = 0
        elif section == "ENTITIES" and code == 0:
            ents.append((val.upper(), []))
        elif section == "ENTITIES" and ents:
            ents[-1][1].append((code, val))
        i += 1

    out = _Out("dxf")
    shapes: list[tuple[bool, list[list[float]], bool]] = []      # (closed, points, curved) in the file's units
    texts: list[tuple[float, float, str]] = []
    j = 0
    while j < len(ents):
        kind, g = ents[j]
        j += 1
        if any(c == 67 and v == "1" for c, v in g):              # paper space: a layout's frame, not the plan
            out.skip("other")
            continue
        try:
            if kind == "LWPOLYLINE":
                pts: list[list[float]] = []
                curved = False
                flags, mirror = 0, False
                for c, v in g:
                    if c == 10:
                        pts.append([float(v), 0.0])
                    elif c == 20 and pts:
                        pts[-1][1] = float(v)
                    elif c == 42 and float(v) != 0.0:
                        curved = True
                    elif c == 70:
                        flags = int(v)
                    elif c == 230 and float(v) < 0:
                        mirror = True                          # drawn with its z axis down: x runs the other way
                if mirror:
                    pts = [[-x, y] for x, y in pts]
                shapes.append((bool(flags & 1), pts, curved))
            elif kind == "POLYLINE":
                flags = int(next((v for c, v in g if c == 70), "0"))
                pts, curved = [], False
                while j < len(ents) and ents[j][0] == "VERTEX":
                    vg = ents[j][1]
                    j += 1
                    x = next((float(v) for c, v in vg if c == 10), None)
                    y = next((float(v) for c, v in vg if c == 20), None)
                    if any(c == 42 and float(v) != 0.0 for c, v in vg):
                        curved = True
                    if x is not None and y is not None:
                        pts.append([x, y])
                if j < len(ents) and ents[j][0] == "SEQEND":
                    j += 1
                if flags & (16 | 64):                          # a mesh, not a line drawing
                    out.skip("other")
                    continue
                shapes.append((bool(flags & 1), pts, curved))
            elif kind == "LINE":
                v = {c: float(x) for c, x in g if c in (10, 20, 11, 21)}
                shapes.append((False, [[v[10], v[20]], [v[11], v[21]]], False))
            elif kind in ("TEXT", "MTEXT"):
                x = next((float(v) for c, v in g if c == 10), None)
                y = next((float(v) for c, v in g if c == 20), None)
                words = _mtext("".join(v for c, v in g if c == 3) + next((v for c, v in g if c == 1), ""))
                if x is not None and y is not None and re.search(r"[^\W\d_]", words):
                    texts.append((x, y, words[:60]))
                else:
                    out.skip("annotations")
            elif kind in ("VERTEX", "SEQEND"):
                continue
            else:
                out.skip("other")                              # arcs, circles, blocks, hatches, dimensions...
        except (ValueError, KeyError, StopIteration):
            out.skip("bad")
    for _closed, pts, curved in shapes:
        if curved:
            out.skip("curves")

    f = DXF_UNITS.get(units)
    scale = "file"
    if f is None:
        xs = [p[0] for _c, pts, _k in shapes for p in pts]
        if not across_m or not xs or max(xs) - min(xs) <= 0:
            raise PlanFileError("This DXF doesn't say what unit it is drawn in. Type the drawing's width (outside wall "
                                "to outside wall) and pick the file again.", "need_size")
        f, scale = across_m / (max(xs) - min(xs)), "typed"
    m = lambda p: [p[0] * f, -p[1] * f]  # noqa: E731 — metres, turned over: a DXF's y runs up, a plan's down

    rooms: list[list[list[float]]] = []
    for closed, pts, _curved in shapes:
        ring = _ring([m(p) for p in pts])
        if closed and len(ring) >= 3:
            a = _area(ring)
            if a < MIN_ROOM_M2:
                out.skip("small_shapes")
                continue
            if a / (_perimeter(ring) / 2) < THIN_M:
                out.skip("thin_shapes")
                for p, q in zip(ring, ring[1:] + ring[:1]):
                    out.wall(p, q)
                continue
            rooms.append(ring)
        else:
            for p, q in zip(ring, ring[1:]):
                out.wall(p, q)
    # A text names the smallest room it stands in (a whole floor's outline holds them all); the first word with a
    # letter in it, so a room's area printed under its name doesn't take its place.
    names: dict[int, str] = {}
    for x, y, words in texts:
        at = m((x, y))
        inside = [k for k, r in enumerate(rooms) if RP._inside(at, r)]  # noqa: SLF001
        if inside:
            k = min(inside, key=lambda k: _area(rooms[k]))
            names.setdefault(k, words)
        else:
            out.skip("annotations")
    for k, ring in enumerate(rooms):
        out.room(names.get(k), ring, "dxf", edges_are_walls=True)
    return out.result([{"id": "dxf", "name": "DXF", "elevation_m": 0.0}], "dxf", scale)


# ── Floorplanner (FML v3.0, JSON) ───────────────────────────────────────────────────────────────────────────────────

def _is_fml(doc: dict) -> bool:
    floors = doc.get("floors")
    if isinstance(floors, list) and any(isinstance(f, dict) and isinstance(f.get("designs"), list) for f in floors[:20]):
        return True
    if isinstance(doc.get("designs"), list):
        return True
    walls = doc.get("walls")
    return isinstance(walls, list) and any(isinstance(w, dict) and isinstance(w.get("a"), dict) and isinstance(w.get("b"), dict) for w in walls[:20])


def parse_floorplanner(data: bytes, *, level: str | None = None) -> dict[str, Any]:
    """Floorplanner's FML (JSON), or the zip its export comes in, into the contract."""
    if data[:2] == b"PK":
        try:
            z = zipfile.ZipFile(io.BytesIO(data))
            fml = next(i for i in z.infolist() if i.filename.lower().endswith(".fml"))
            with z.open(fml) as fh:
                data = fh.read(FML_MAX_BYTES + 1)              # never more than that inflated, whatever the zip says
        except (StopIteration, zipfile.BadZipFile, OSError, RuntimeError, ValueError, EOFError, zlib.error) as exc:
            raise PlanFileError("The .fml file in this zip could not be read.", "unreadable") from exc
        if len(data) > FML_MAX_BYTES:
            raise PlanFileError("The .fml file in this zip is too large to be a floor plan.", "too_large")
    text = _text(data).lstrip()
    if text.startswith("<"):
        raise PlanFileError("This is Floorplanner's older XML form of FML, which PadSpan doesn't read. "
                            "Export the project again (Quick Export) for the newer JSON form.", "unreadable", why="fml_xml")
    try:
        doc = json.loads(text)
    except (ValueError, RecursionError) as exc:
        raise PlanFileError("This FML file could not be read as JSON.", "unreadable") from exc
    if not isinstance(doc, dict) or not _is_fml(doc):
        raise PlanFileError("No Floorplanner floors or walls were found in this file.", "not_scan")
    return _floorplanner_doc(doc, level=level)


def _pt_cm(p: Any) -> list[float] | None:
    if not isinstance(p, dict):
        return None
    x, y = _num(p.get("x")), _num(p.get("y"))
    return [x / 100.0, y / 100.0] if x is not None and y is not None else None


def _floorplanner_doc(doc: dict, *, level: str | None) -> dict[str, Any]:
    if isinstance(doc.get("floors"), list):
        floors = [f for f in doc["floors"] if isinstance(f, dict)]
    elif isinstance(doc.get("designs"), list):
        floors = [doc]
    else:
        floors = [{"id": "plan", "name": doc.get("name") or "Plan", "designs": [doc]}]
    levels = [{"id": str(f.get("id") if f.get("id") is not None else i + 1), "name": str(f.get("name") or f"Floor {i + 1}"),
               "elevation_m": 0.0} for i, f in enumerate(floors)]
    designs: dict[str, tuple[dict, int]] = {}
    for lv, f in zip(levels, floors):
        ds = [d for d in (f.get("designs") or []) if isinstance(d, dict)]
        used = next((d for d in ds if _list(d, "walls") or _list(d, "areas")), None)
        if used is not None:
            designs[lv["id"]] = (used, len(ds) - 1)
    chosen = _choose(levels, list(designs), level, None)
    design, others = designs[chosen]
    out = _Out("floorplanner")
    out.skip("other_designs", others)
    for w in _list(design, "walls"):
        a, b = _pt_cm(w.get("a")) if isinstance(w, dict) else None, _pt_cm(w.get("b")) if isinstance(w, dict) else None
        if a is None or b is None:
            out.skip("bad")
            continue
        if isinstance(w.get("c"), dict):
            out.skip("curves")                                  # a curved wall, drawn straight
        out.wall(a, b)
        ln = math.dist(a, b)
        for o in _list(w, "openings"):
            t, width = (_num(o.get("t")), _num(o.get("width"))) if isinstance(o, dict) else (None, None)
            if t is None or not width or width <= 0 or ln <= 0:
                out.skip("bad")
                continue
            ux, uy = (b[0] - a[0]) / ln, (b[1] - a[1]) / ln
            cx, cy, h = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, width / 200.0
            kind = o.get("type") if o.get("type") in ("door", "window") else "opening"
            out.openings.append({"kind": kind, "a_m": [round(cx - ux * h, 3), round(cy - uy * h, 3)],
                                 "b_m": [round(cx + ux * h, 3), round(cy + uy * h, 3)]})
    for ar in _list(design, "areas"):
        pts = [_pt_cm(p) for p in _list(ar, "poly")] if isinstance(ar, dict) else []
        ring = _ring([p for p in pts if p is not None]) if pts and None not in pts else []
        if len(ring) < 3 or _area(ring) <= 0.01:
            out.skip("bad")
            continue
        name = str(ar.get("customName") or ar.get("name") or "").strip() or None
        out.room(name, ring, chosen)
    out.skip("furniture", len(_list(design, "items")))
    out.skip("annotations", len(_list(design, "labels")) + len(_list(design, "lines")) + len(_list(design, "dimensions")))
    out.skip("other", len(_list(design, "surfaces")))
    return out.result(levels, chosen)
