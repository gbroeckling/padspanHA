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

    try:
        xml_bytes = zf.read("Home.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise Sh3dParseError("Home.xml entry could not be read") from exc

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
