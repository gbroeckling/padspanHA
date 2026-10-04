# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Sweet Home 3D (.sh3d) floorplan import — gap #7 tier 1, best-in-class
roadmap: "Floorplan import: Sweet Home 3D first, then RoomPlan JSON, then
image room-detection."

Parses room polygons out of a .sh3d file into a CANDIDATE layout — nothing
is written to the fabric here. The frontend (maps.js's Rooms tab) plugs the
result into its existing "candidates" mechanism (the same one that already
serves "Map placements"/"Blended" layouts for preview, edit, and an
explicit commit) rather than this module inventing a second import/preview
UI.

The schema below is NOT a guess. It was fetched and verified against the
live, official DTD (https://www.sweethome3d.com/SweetHome3D.dtd) before
this was written:

  - A .sh3d file is a ZIP. Since Sweet Home 3D 5.3 (Nov 2016) it contains a
    Home.xml entry. A ZIP with only a legacy "Home" entry (no extension) is
    the PRE-2016 Java-serialization format — not XML, not supported here,
    and never guessed at: it raises Sh3dParseError with a clear message
    rather than attempting to deserialize Java objects.
  - <room> elements are DIRECT CHILDREN of <home> — siblings of <level>,
    NOT nested inside it — each with an optional level="<level id>" IDREF,
    an optional name, and child <point x="" y=""/> elements IN DOCUMENT
    ORDER forming its polygon.
  - <level id name elevation floorThickness height ...> — id/name/elevation
    are #REQUIRED by the DTD.
  - Units are centimetres, confirmed by Sweet Home 3D's own author on the
    project's support forum, not inferred — divided by 100 here.

No real exported .sh3d file was available to test against during
development; this was verified against the DTD grammar only. Treat the
first real-world import as the true validation and widen error handling
here if a genuine file trips something this DTD reading didn't anticipate.
"""

import io
import math
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

CM_PER_M = 100.0


class Sh3dParseError(Exception):
    """A .sh3d file could not be read as a current-format Sweet Home 3D
    floorplan. Raised rather than returning a partial or guessed result."""


def parse_sh3d(data: bytes) -> dict[str, Any]:
    """Parse a .sh3d file's raw bytes into levels + room polygons, in metres.

    Returns {"levels": [...], "rooms": [...], "warnings": [...]}:
      levels: [{"id": str, "name": str, "elevation_m": float}, ...]
      rooms:  [{"name": str | None, "level_id": str | None,
                "points_m": [[x_m, y_m], ...]}, ...]
      warnings: human-readable strings for rooms/levels skipped or
        malformed — never silently dropped without a trace.

    Raises Sh3dParseError for anything that isn't a readable Home.xml —
    a bad ZIP, a pre-2016 legacy file, invalid XML, or an unexpected root.
    """
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise Sh3dParseError("Not a valid .sh3d file (not a ZIP archive)") from exc

    names = zf.namelist()
    if "Home.xml" not in names:
        if "Home" in names:
            raise Sh3dParseError(
                "This .sh3d file predates Sweet Home 3D 5.3 (2016) and has no "
                "Home.xml entry — only the legacy Java-serialized format, which "
                "is not supported. Re-save it from a current Sweet Home 3D "
                "version and try again."
            )
        raise Sh3dParseError("Not a Sweet Home 3D file (no Home.xml entry found)")

    # Decompressed-size cap, checked against the zip's own central-directory
    # metadata BEFORE the expensive read — the caller already caps the
    # COMPRESSED upload (ws_floorplan_import.py's MAX_SH3D_BYTES), which does
    # nothing to stop one small entry inflating to gigabytes (a classic
    # zip-bomb: found in the Phase 2i security audit, 2026-09-19). A real
    # Home.xml is KB-to-low-MB scale even for a large house.
    MAX_HOME_XML_BYTES = 50 * 1024 * 1024
    if zf.getinfo("Home.xml").file_size > MAX_HOME_XML_BYTES:
        raise Sh3dParseError("Home.xml is implausibly large for a floorplan file")

    try:
        xml_bytes = zf.read("Home.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise Sh3dParseError("Home.xml entry could not be read") from exc
    if len(xml_bytes) > MAX_HOME_XML_BYTES:
        raise Sh3dParseError("Home.xml is implausibly large for a floorplan file")

    # Reject a DOCTYPE outright rather than trust ElementTree to handle one
    # safely (same audit finding): stdlib ElementTree does not fetch external
    # entities/DTDs, but it DOES expand internal ones, which is the "billion
    # laughs" vector — a few KB of nested <!ENTITY> definitions can exhaust
    # CPU/memory well before any size cap above would catch it. A real
    # Sweet Home 3D export has no DOCTYPE at all, so this rejects nothing
    # legitimate.
    if b"<!DOCTYPE" in xml_bytes:
        raise Sh3dParseError("Home.xml has a DOCTYPE declaration, which is not a Sweet Home 3D export")

    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise Sh3dParseError(f"Home.xml is not valid XML: {exc}") from exc

    if root.tag != "home":
        raise Sh3dParseError(f"Unexpected root element <{root.tag}> — expected <home>")

    warnings: list[str] = []

    levels: list[dict[str, Any]] = []
    for lv in root.findall("level"):
        lv_id = lv.get("id")
        if not lv_id:
            warnings.append("Skipped a <level> with no id")
            continue
        try:
            elevation_cm = float(lv.get("elevation", "0"))
        except (TypeError, ValueError):
            elevation_cm = 0.0
        levels.append({
            "id": lv_id,
            "name": lv.get("name") or lv_id,
            "elevation_m": round(elevation_cm / CM_PER_M, 3),
        })
    level_ids = {lv["id"] for lv in levels}

    rooms: list[dict[str, Any]] = []
    for rm in root.findall("room"):
        room_label = rm.get("name") or rm.get("id") or "(unnamed room)"
        points: list[list[float]] = []
        malformed = False
        for pt in rm.findall("point"):
            try:
                x_cm = float(pt.get("x"))
                y_cm = float(pt.get("y"))
            except (TypeError, ValueError):
                malformed = True
                break
            points.append([round(x_cm / CM_PER_M, 3), round(y_cm / CM_PER_M, 3)])
        if malformed or len(points) < 3:
            warnings.append(f"Skipped room '{room_label}': fewer than 3 usable points")
            continue
        level_id = rm.get("level")
        if level_id and level_id not in level_ids:
            warnings.append(f"Room '{room_label}' references unknown level '{level_id}' — treated as unassigned")
            level_id = None
        rooms.append({
            "name": rm.get("name"),
            "level_id": level_id,
            "points_m": points,
        })

    if not rooms:
        warnings.append("No rooms with a usable polygon were found in this file")

    return {"levels": levels, "rooms": rooms, "warnings": warnings}


# ── Live Aboard: doors, windows and furniture (P7 import) ───────────────────
# The rest of a home, for Live Aboard's import preview (ws_house3d_import.py):
# doors and windows, and furniture as its name and catalogue words, position,
# size, angle, elevation and level. Never a model, a texture, an icon or any
# other file in the archive: only Home.xml is read. parse_sh3d above is left
# exactly as it is and is called first, so its caps and refusals (not a ZIP,
# a legacy file, an oversized Home.xml, a DOCTYPE, bad XML, the wrong root)
# refuse here the same way.
#
# Units as the rooms: centimetres divided by 100 and nothing else (no offset,
# no flip; the file's plan and the fabric both run y-down), so a piece lands
# where the rooms imported from the same file land. The file's angles are
# radians; out come degrees turning the width axis from +x toward +y, which
# is clockwise on the plan, as Live Aboard turns a piece. x and y are the
# middle of the footprint; elevation is the bottom's height above its level
# (a window's sill).
#
# Clean-room (Live Aboard's rule): for this part nothing of Sweet Home 3D was
# read, neither its source nor its DTD nor its documentation; only the room
# reading above and its tests. The element names (doorOrWindow,
# pieceOfFurniture, light, furnitureGroup) and the attributes beyond the
# rooms' (catalogId, width, depth, angle) are the ones the files carry, as
# known without reading those. As for the rooms, the first real file is the
# true test.
OPENING_TAGS = ("doorOrWindow",)
PIECE_TAGS = ("pieceOfFurniture", "light")
GROUP_TAGS = ("furnitureGroup",)
MAX_IMPORT_PIECES = 1000       # the 3D file keeps at most 1000 pieces
MAX_IMPORT_OPENINGS = 500      # and 500 openings (house3d_store.MAX_OPENINGS)
MAX_GROUP_DEPTH = 16           # groups inside groups, this deep at most
FAR_M = 10_000.0               # the 3D file's coordinate limit (house3d_store.COORD_MAX_M)
NAME_MAX = 60                  # a piece's name in the house is at most 60 characters

_NEED = (("x_m", "x", "position"), ("y_m", "y", "position"), ("width_m", "width", "width"),
         ("depth_m", "depth", "depth"), ("height_m", "height", "height"))


def _clean_text(v: Any, limit: int = NAME_MAX) -> str:
    """Printable text, one line, at most `limit` characters."""
    s = "".join(ch if ch.isprintable() else " " for ch in str(v or ""))
    return " ".join(s.split())[:limit].strip()


def _cm_to_m(raw: str | None) -> float | None:
    """A finite number of centimetres as metres (to the millimetre), else None."""
    try:
        v = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return round(v / CM_PER_M, 3) if math.isfinite(v) else None


def _furnishing(el: ET.Element, inherited_level: str | None, level_ids: set[str],
                warnings: list[str]) -> tuple[dict[str, Any] | None, str]:
    """One door, window or piece of furniture, or (None, why it was left out)."""
    name = _clean_text(el.get("name"))
    out: dict[str, Any] = {"tag": el.tag, "name": name, "catalog": _clean_text(el.get("catalogId"), 120),
                           "category": _clean_text(el.get("category"), 120)}
    for key, attr, what in _NEED:
        v = _cm_to_m(el.get(attr))
        if v is None:
            return None, f"its {what} is not a number" if el.get(attr) is not None else f"it has no {what}"
        out[key] = v
    if min(out["width_m"], out["depth_m"], out["height_m"]) <= 0:
        return None, "it has no size"
    if abs(out["x_m"]) > FAR_M or abs(out["y_m"]) > FAR_M:
        return None, "it is too far from the rest of the plan"
    out["elevation_m"] = _cm_to_m(el.get("elevation", "0")) or 0.0
    try:
        angle = float(el.get("angle", "0"))
    except (TypeError, ValueError):
        angle = 0.0
    deg = round(math.degrees(angle) % 360.0, 1) if math.isfinite(angle) else 0.0
    out["angle_deg"] = 0.0 if deg >= 360.0 else deg
    level_id = el.get("level") or inherited_level
    if level_id and level_id not in level_ids:
        warnings.append(f"'{name or el.tag}' references unknown level '{level_id}' — treated as unassigned")
        level_id = None
    out["level_id"] = level_id
    return out, ""


def parse_sh3d_furniture(data: bytes, *, max_pieces: int = MAX_IMPORT_PIECES,
                         max_openings: int = MAX_IMPORT_OPENINGS) -> dict[str, Any]:
    """Parse a .sh3d file's doors, windows and furniture, in metres and degrees.

    Returns {"levels": [...], "openings": [...], "pieces": [...],
             "skipped": [...], "warnings": [...]}:
      levels:   exactly parse_sh3d's.
      openings: doors and windows, document order:
                {"tag", "name", "catalog", "category", "level_id", "x_m", "y_m",
                 "width_m", "depth_m", "height_m", "elevation_m", "angle_deg"}
      pieces:   furniture (lights included), the same fields; a group's
                pieces one by one (in its level when they name none).
      skipped:  [{"name", "why"}] for each one left out, and one line for any
                past the caps — never dropped without a trace.
      warnings: the levels' and unknown levels', as parse_sh3d words them.

    Raises Sh3dParseError exactly where parse_sh3d does.
    """
    base = parse_sh3d(data)
    # Read again: parse_sh3d has just checked these very bytes (a ZIP, Home.xml
    # within its cap, no DOCTYPE, well-formed, a <home> root).
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(data)).read("Home.xml"))
    level_ids = {lv["id"] for lv in base["levels"]}
    warnings = [w for w in base["warnings"] if w.startswith("Skipped a <level>")]
    openings: list[dict[str, Any]] = []
    pieces: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    over = {"openings": 0, "pieces": 0}
    stack = [(el, None, 0) for el in reversed(list(root))]
    while stack:
        el, group_level, depth = stack.pop()
        if el.tag in GROUP_TAGS:
            if depth >= MAX_GROUP_DEPTH:
                skipped.append({"name": _clean_text(el.get("name")) or "a group",
                                "why": f"groups inside groups deeper than {MAX_GROUP_DEPTH}"})
                continue
            level = el.get("level") or group_level
            stack.extend((child, level, depth + 1) for child in reversed(list(el)))
            continue
        if el.tag in OPENING_TAGS:
            into, cap, key = openings, max_openings, "openings"
        elif el.tag in PIECE_TAGS:
            into, cap, key = pieces, max_pieces, "pieces"
        else:
            continue
        item, why = _furnishing(el, group_level, level_ids, warnings)
        if item is None:
            skipped.append({"name": _clean_text(el.get("name")) or _clean_text(el.get("catalogId")) or el.tag,
                            "why": why})
        elif len(into) >= cap:
            over[key] += 1
        else:
            into.append(item)
    if over["openings"]:
        skipped.append({"name": f"{over['openings']} more doors and windows",
                        "why": f"at most {max_openings} come in at once"})
    if over["pieces"]:
        skipped.append({"name": f"{over['pieces']} more pieces", "why": f"at most {max_pieces} come in at once"})
    if not openings and not pieces:
        warnings.append("No doors, windows or furniture were found in this file")
    return {"levels": base["levels"], "openings": openings, "pieces": pieces,
            "skipped": skipped, "warnings": warnings}
