# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Robot-vacuum map import (docs: PadspanResearch vacuum_map_formats.md).

Three things, every one of them off until the user asks for it:

  1. IMPORT. A vacuum's own map becomes a CANDIDATE — a picture, a metre
     scale, room outlines with names, the dock — the same parse-then-review
     shape as the Sweet Home 3D import. Two formats are read:
       - Valetudo's map JSON (pasted, fetched from the robot's REST URL, or
         taken from the zTXt chunk "ValetudoMap" in a camera's PNG — Valetudo's
         map-data-hass camera and Dreame's hidden map-data camera both carry
         it). Centimetres, top-left origin, Y down; room masks as runs.
       - A camera's `calibration_points` attribute (Xiaomi Cloud Map
         Extractor, Dreame): three vacuum↔picture pairs, an affine. Rooms are
         the `rooms` bounding boxes.
     The commit (ws_vacuum.py) goes through the existing writers: a NEW map
     (maps_store.async_add_map), its placement (model.async_set_map_transform)
     and rooms through fabric.async_correct_room as external_import, which
     refuses any room that already exists. Nothing existing is overwritten.

  2. LIVE POSITION. With the link turned on, the robot's spot (Valetudo
     robot_position / attribute vacuum_position) goes through the vacuum→
     metres affine the import was committed with — the vacuum's own
     coordinates, the frame its rooms were written in; no photo coordinate is
     converted (the metres-are-truth rule). It rides the live snapshot as
     `vacuum`, and only while a link is on.

  3. CALIBRATION WALKER → REVIEW PILE. With the walker on and a tag named
     (the BLE tag riding on the robot), each spot where the robot stood still
     becomes a PENDING point: its known position and the tag's readings.
     Nothing reaches calibration from here. Only an accepted point is handed
     to calibration_store.async_add_point, one at a time, by the user.
"""

import base64
import json
import logging
import math
import os
import struct
import time
import zlib
from datetime import datetime, timedelta, timezone
from typing import Any

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

VACUUM_STORE_KEY = "padspan_ha.vacuum"
DATA_VACUUM = "vacuum_import"

MAX_JSON_BYTES = 30 * 1024 * 1024       # a huge Dreame map is a few MB of JSON
MAX_IMAGE_PX = 2400                     # the rendered picture's longest side
MAX_MASK_PX = 5_000_000                 # grid pixels a map's runs may expand to, all layers together
PAD_GRID = 3                            # grid pixels of margin around the house
TICK_S = 10                             # how often a linked robot is read
LIVE_STALE_S = 120                      # a spot older than this is not shown
WALK_STILL_M = 0.25                     # moved less than this between reads: standing still
WALK_APART_M = 1.0                      # a new pending point at least this far from the others
WALK_MIN_SOURCES = 2                    # scanners that must hear the tag at a spot
PENDING_MAX = 200

_PNG_SIG = b"\x89PNG\r\n\x1a\n"


class VacuumImportError(Exception):
    """The input could not be read as a vacuum map. Raised rather than
    returning a partial or guessed candidate."""


# ── reading the formats ─────────────────────────────────────────────────────

def png_size(png: bytes) -> tuple[int, int]:
    if png[:8] != _PNG_SIG or png[12:16] != b"IHDR":
        raise VacuumImportError("The camera's picture is not a PNG")
    w, h = struct.unpack(">II", png[16:24])
    return int(w), int(h)


def extract_valetudo_json(png: bytes) -> dict | None:
    """The ValetudoMap JSON in a PNG's zTXt chunk, or None if it has none.

    Chunk data = b"ValetudoMap" + 0x00 + compression method (0) + zlib stream
    (Valetudo's MapNodeMqttHandle; Pillow's add_text(zip=True) for Dreame)."""
    if png[:8] != _PNG_SIG:
        return None
    pos = 8
    while pos + 8 <= len(png):
        length = struct.unpack(">I", png[pos:pos + 4])[0]
        ctype = png[pos + 4:pos + 8]
        data = png[pos + 8:pos + 8 + length]
        pos += 12 + length
        if ctype == b"zTXt":
            key, _, rest = data.partition(b"\x00")
            if key == b"ValetudoMap" and rest[:1] == b"\x00":
                try:
                    d = zlib.decompressobj()
                    raw = d.decompress(rest[1:], MAX_JSON_BYTES)
                    return json.loads(raw.decode("utf-8"))
                except Exception as exc:
                    raise VacuumImportError("The camera's map data could not be unpacked") from exc
        elif ctype == b"IEND":
            break
    return None


def _decompress(cp: Any, budget: int = MAX_MASK_PX) -> list[tuple[int, int]]:
    """Valetudo compressedPixels: flat [xStart, y, count, ...] runs (grid px).

    The runs are counted before anything is expanded: a map whose runs add up
    to more than `budget` pixels (a real house is well under a million) is
    refused, not allocated."""
    out: list[tuple[int, int]] = []
    if not isinstance(cp, list):
        return out
    runs: list[tuple[int, int, int]] = []
    total = 0
    for i in range(0, len(cp) - 2, 3):
        try:
            x0, y, n = int(cp[i]), int(cp[i + 1]), int(cp[i + 2])
        except (TypeError, ValueError):
            continue
        n = max(0, n)
        total += n
        if n > MAX_IMAGE_PX * 50 or total > budget:
            raise VacuumImportError("The map is too large to read")
        runs.append((x0, y, n))
    for x0, y, n in runs:
        out.extend((x0 + j, y) for j in range(n))
    return out


def _layer_pixels(layer: dict, budget: int = MAX_MASK_PX) -> list[tuple[int, int]]:
    px = _decompress(layer.get("compressedPixels"), budget)
    if not px and isinstance(layer.get("pixels"), list):   # an old uncompressed map: [x, y, x, y, ...]
        p = layer["pixels"]
        if len(p) // 2 > budget:
            raise VacuumImportError("The map is too large to read")
        px = [(int(p[i]), int(p[i + 1])) for i in range(0, len(p) - 1, 2)]
    return px


def _outline(pixels: set[tuple[int, int]]) -> list[tuple[int, int]]:
    """The outer boundary of a pixel mask, as grid-corner vertices.

    Every pixel edge with no pixel across it is a boundary edge, oriented so
    the mask is on its right; chained into loops, the longest loop is the
    outside of the room (the others are holes or islands). Straight runs are
    merged so a wall is one edge, not one per pixel."""
    nxt: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for (x, y) in pixels:
        if (x, y - 1) not in pixels:
            nxt.setdefault((x, y), []).append((x + 1, y))
        if (x + 1, y) not in pixels:
            nxt.setdefault((x + 1, y), []).append((x + 1, y + 1))
        if (x, y + 1) not in pixels:
            nxt.setdefault((x + 1, y + 1), []).append((x, y + 1))
        if (x - 1, y) not in pixels:
            nxt.setdefault((x, y + 1), []).append((x, y))
    best: list[tuple[int, int]] = []
    while nxt:
        start = next(iter(nxt))
        loop = [start]
        cur = start
        while True:
            outs = nxt.get(cur)
            if not outs:
                break
            nb = outs.pop()
            if not outs:
                del nxt[cur]
            if nb == start:
                break
            loop.append(nb)
            cur = nb
        if len(loop) > len(best):
            best = loop
    if len(best) < 3:
        return []
    out: list[tuple[int, int]] = []
    n = len(best)
    for i in range(n):
        a, b, c = best[i - 1], best[i], best[(i + 1) % n]
        if (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) != 0:
            out.append(b)
    return _simplify(out, 1.0)


def _simplify(pts: list[tuple[int, int]], tol: float) -> list[tuple[int, int]]:
    """Ramer–Douglas–Peucker on a closed ring: a stair-stepped diagonal wall
    becomes one edge, within `tol` grid pixels of the mask."""
    if len(pts) <= 8:
        return pts

    def rdp(seg: list[tuple[int, int]]) -> list[tuple[int, int]]:
        if len(seg) < 3:
            return seg
        (x1, y1), (x2, y2) = seg[0], seg[-1]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy) or 1.0
        far, idx = -1.0, 0
        for i in range(1, len(seg) - 1):
            d = abs(dy * (seg[i][0] - x1) - dx * (seg[i][1] - y1)) / norm
            if d > far:
                far, idx = d, i
        if far <= tol:
            return [seg[0], seg[-1]]
        return rdp(seg[:idx + 1])[:-1] + rdp(seg[idx:])

    # Split the ring at its two most distant vertices so both halves are open.
    i_far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = rdp(pts[:i_far + 1])
    b = rdp(pts[i_far:] + [pts[0]])
    ring = a[:-1] + b[:-1]
    return ring if len(ring) >= 3 else pts


_SEG_COLOURS = [(186, 214, 196), (205, 214, 186), (186, 200, 214), (214, 196, 186),
                (200, 186, 214), (214, 210, 186), (186, 214, 212), (214, 186, 200)]


def _render_png(w: int, h: int, s: int, layers: list[tuple[str, int, list[tuple[int, int]]]],
                ox: int, oy: int) -> bytes:
    """A plain floor plan: white page, floor grey, rooms pastel, walls dark."""
    from .maps_store import _encode_rgba_to_png  # noqa: PLC0415 — the one PNG writer
    buf = bytearray(b"\xff" * (w * h * 4))
    for kind, idx, pixels in layers:
        col = ((60, 66, 72) if kind == "wall" else (222, 222, 222) if kind == "floor"
               else _SEG_COLOURS[idx % len(_SEG_COLOURS)])
        rgba = bytes((col[0], col[1], col[2], 255))
        run = rgba * s
        for (gx, gy) in pixels:
            px, py = (gx - ox) * s, (gy - oy) * s
            if px < 0 or py < 0 or px + s > w or py + s > h:
                continue
            for r in range(s):
                off = ((py + r) * w + px) * 4
                buf[off:off + 4 * s] = run
    rows = bytearray()
    stride = w * 4
    for y in range(h):
        rows.append(0)
        rows += buf[y * stride:(y + 1) * stride]
    return _encode_rgba_to_png(bytes(rows), w, h)


def _point_entity(entities: list, kind: str) -> dict | None:
    for e in entities:
        if isinstance(e, dict) and e.get("type") == kind:
            p = e.get("points")
            if isinstance(p, list) and len(p) >= 2:
                try:
                    ang = (e.get("metaData") or {}).get("angle")
                    return {"x": float(p[0]), "y": float(p[1]),
                            "a": float(ang) if isinstance(ang, (int, float)) else None}
                except (TypeError, ValueError):
                    return None
    return None


def _apply(aff: list[float], x: float, y: float) -> tuple[float, float]:
    return (aff[0] * x + aff[1] * y + aff[2], aff[3] * x + aff[4] * y + aff[5])


def parse_valetudo(vmap: Any) -> dict[str, Any]:
    """A ValetudoMap JSON into an import candidate (see _candidate)."""
    if not isinstance(vmap, dict) or not isinstance(vmap.get("layers"), list):
        raise VacuumImportError("Not a Valetudo map (no layers)")
    if vmap.get("__class") not in (None, "ValetudoMap"):
        raise VacuumImportError("Not a Valetudo map")
    try:
        ps = float(vmap.get("pixelSize") or 5)
    except (TypeError, ValueError):
        ps = 0.0
    if not (0.5 <= ps <= 50):
        raise VacuumImportError("The map's pixel size is missing or unusable")
    warnings: list[str] = []
    layers: list[tuple[str, int, list[tuple[int, int]]]] = []
    segs: list[tuple[str, set[tuple[int, int]]]] = []
    budget = MAX_MASK_PX
    for i, lay in enumerate(vmap["layers"]):
        if not isinstance(lay, dict):
            continue
        kind = str(lay.get("type") or "")
        if kind not in ("floor", "wall", "segment"):
            continue
        px = _layer_pixels(lay, budget)
        budget -= len(px)
        if not px:
            continue
        layers.append((kind, len(segs), px))
        if kind == "segment":
            md = lay.get("metaData") or {}
            name = str(md.get("name") or "").strip() or f"Room {md.get('segmentId') or len(segs) + 1}"
            segs.append((name[:60], set(px)))
    if not layers:
        raise VacuumImportError("The map has no floor, walls or rooms in it")
    xs = [p[0] for _, _, px in layers for p in px]
    ys = [p[1] for _, _, px in layers for p in px]
    ox, oy = min(xs) - PAD_GRID, min(ys) - PAD_GRID
    gw, gh = max(xs) - ox + 1 + PAD_GRID, max(ys) - oy + 1 + PAD_GRID
    s = max(1, min(4, MAX_IMAGE_PX // max(gw, gh)))
    if max(gw, gh) * s > MAX_IMAGE_PX * 2:
        raise VacuumImportError("The map is too large to draw")
    # Draw order: floor under rooms under walls.
    layers.sort(key=lambda t: {"floor": 0, "segment": 1, "wall": 2}[t[0]])
    w, h = gw * s, gh * s
    png = _render_png(w, h, s, layers, ox, oy)
    # vacuum cm → picture fraction: cm/ps is a grid pixel, minus the crop.
    to_frac = [1.0 / (ps * gw), 0.0, -ox / gw, 0.0, 1.0 / (ps * gh), -oy / gh]
    rooms = []
    for name, mask in segs:
        ring = _outline(mask)
        if len(ring) < 3:
            warnings.append(f"{name}: no outline could be traced")
            continue
        rooms.append({"name": name, "points_frac": [[round((x - ox) / gw, 6), round((y - oy) / gh, 6)] for x, y in ring]})
    if not segs:
        warnings.append("The map has no rooms (segments) — only the picture comes in")
    ents = vmap.get("entities") if isinstance(vmap.get("entities"), list) else []
    return _candidate("valetudo", png, w, h, ps / 100.0 / s, to_frac, rooms,
                      _point_entity(ents, "charger_location"), _point_entity(ents, "robot_position"), warnings)


def _solve_affine(pairs: list[tuple[tuple[float, float], tuple[float, float]]]) -> list[float] | None:
    """The affine taking three vacuum points to three picture points."""
    (x1, y1), (x2, y2), (x3, y3) = (p[0] for p in pairs[:3])
    det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2)
    if abs(det) < 1e-12:
        return None
    out: list[float] = []
    for k in (0, 1):
        u1, u2, u3 = (p[1][k] for p in pairs[:3])
        a = (u1 * (y2 - y3) - y1 * (u2 - u3) + (u2 * y3 - u3 * y2)) / det
        b = (x1 * (u2 - u3) - u1 * (x2 - x3) + (x2 * u3 - x3 * u2)) / det
        c = (x1 * (y2 * u3 - y3 * u2) - y1 * (x2 * u3 - x3 * u2) + u1 * (x2 * y3 - x3 * y2)) / det
        out += [a, b, c]
    return out


def _xy(d: Any) -> tuple[float, float] | None:
    if isinstance(d, dict):
        try:
            return float(d["x"]), float(d["y"])
        except (KeyError, TypeError, ValueError):
            return None
    return None


def parse_calibrated_camera(attrs: dict, png: bytes) -> dict[str, Any]:
    """A camera with `calibration_points` (XCME, Dreame) into a candidate."""
    cal = attrs.get("calibration_points")
    pairs = []
    for p in cal if isinstance(cal, list) else []:
        v, m = _xy((p or {}).get("vacuum")), _xy((p or {}).get("map"))
        if v and m:
            pairs.append((v, m))
    if len(pairs) < 3:
        raise VacuumImportError("The camera has no calibration_points (turn the attribute on in its settings)")
    to_px = _solve_affine(pairs)
    if not to_px or abs(to_px[0] * to_px[4] - to_px[1] * to_px[3]) < 1e-12:
        raise VacuumImportError("The camera's calibration points are empty or in a line (is the map loaded?)")
    w, h = png_size(png)
    # Vacuum units: millimetres for every brand but Viomi, whose calibration
    # points sit 1 unit apart because its unit is the metre.
    span = math.dist(pairs[0][0], pairs[1][0])
    m_per_unit = 1.0 if span < 50 else 0.001
    px_per_unit = math.sqrt(abs(to_px[0] * to_px[4] - to_px[1] * to_px[3]))
    to_frac = [to_px[0] / w, to_px[1] / w, to_px[2] / w, to_px[3] / h, to_px[4] / h, to_px[5] / h]
    warnings = ["Rooms from this camera are rectangles (its rooms attribute is bounding boxes only)"]
    rooms = []
    raw_rooms = attrs.get("rooms")
    items = raw_rooms.items() if isinstance(raw_rooms, dict) else enumerate(raw_rooms or [])
    for num, r in items:
        if not isinstance(r, dict):
            continue
        try:
            x0, y0, x1, y1 = (float(r[k]) for k in ("x0", "y0", "x1", "y1"))
        except (KeyError, TypeError, ValueError):
            continue
        name = str(r.get("custom_name") or r.get("name") or "").strip() or f"Room {num}"
        corners = [_apply(to_frac, x, y) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        rooms.append({"name": name[:60], "points_frac": [[round(fx, 6), round(fy, 6)] for fx, fy in corners]})
    dock = _xy(attrs.get("charger_position") or attrs.get("charger"))
    robot = _xy(attrs.get("vacuum_position"))
    return _candidate("calibration_points", png, w, h, m_per_unit / px_per_unit, to_frac, rooms,
                      {"x": dock[0], "y": dock[1], "a": None} if dock else None,
                      {"x": robot[0], "y": robot[1], "a": None} if robot else None, warnings)


def _candidate(source: str, png: bytes, w: int, h: int, m_per_px: float, to_frac: list[float],
               rooms: list[dict], dock: dict | None, robot: dict | None, warnings: list[str]) -> dict[str, Any]:
    """The one candidate shape both formats come out as.

    Rooms are in picture FRACTIONS (points_frac) — what the commit pushes
    through the new map's placement — and, for the preview, in metres on the
    picture's own frame (points_m, origin at its top-left corner), the shape
    the Sweet Home 3D candidate has."""
    sx, sy = w * m_per_px, h * m_per_px
    for r in rooms:
        r["points_m"] = [[round(fx * sx, 3), round(fy * sy, 3)] for fx, fy in r["points_frac"]]
        r["level_id"] = None

    def spot(p):
        if not p:
            return None
        fx, fy = _apply(to_frac, p["x"], p["y"])
        return {"x_frac": round(fx, 6), "y_frac": round(fy, 6), "x_m": round(fx * sx, 3), "y_m": round(fy * sy, 3)}

    return {
        "source": source, "png": png, "width": w, "height": h,
        "m_per_px": m_per_px, "scale_x_m": round(sx, 4), "scale_y_m": round(sy, 4),
        "to_frac": to_frac, "to_m": [to_frac[0] * sx, to_frac[1] * sx, to_frac[2] * sx,
                                     to_frac[3] * sy, to_frac[4] * sy, to_frac[5] * sy],
        "levels": [], "rooms": rooms,
        "dock": spot(dock), "robot": spot(robot), "warnings": warnings,
    }


def candidate_for_client(c: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in c.items() if k != "png"}
    out["png_base64"] = base64.b64encode(c["png"]).decode("ascii")
    return out


def robot_spot(source: str, payload: Any) -> dict | None:
    """The robot's spot in vacuum units from what a link reads each tick:
    a ValetudoMap (robot_position) or camera attributes (vacuum_position)."""
    if source == "valetudo":
        ents = payload.get("entities") if isinstance(payload, dict) else None
        return _point_entity(ents, "robot_position") if isinstance(ents, list) else None
    if isinstance(payload, dict):
        v = payload.get("vacuum_position")
        xy = _xy(v)
        if xy:
            a = v.get("a")
            return {"x": xy[0], "y": xy[1], "a": float(a) if isinstance(a, (int, float)) else None}
    return None


# ── the store: link, walker, review pile ────────────────────────────────────

def _default_data() -> dict[str, Any]:
    return {
        "link": None,                          # set by an import commit, off until turned on
        "walker": {"enabled": False, "tag": ""},
        "pending": [],                          # the review pile — never calibration
    }


class VacuumStore:
    """padspan_ha.vacuum — what the robot-vacuum import keeps. Not calibration."""

    def __init__(self, hass) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self.store = Store(hass, 1, VACUUM_STORE_KEY)
        self.data: dict[str, Any] = _default_data()
        self.live: dict[str, Any] | None = None
        self.preview: dict[str, Any] | None = None   # the last parsed candidate, for its commit
        self._last_spot: tuple[float, float, str] | None = None
        self._unsub = None

    async def async_load(self) -> None:
        loaded = await self.store.async_load()
        if isinstance(loaded, dict):
            base = _default_data()
            base.update({k: loaded[k] for k in base if k in loaded})
            self.data = base

    async def async_save(self) -> None:
        await self.store.async_save(self.data)

    # The link ---------------------------------------------------------------
    def link_on(self) -> bool:
        lk = self.data.get("link")
        return bool(isinstance(lk, dict) and lk.get("enabled") and lk.get("map_id"))

    def start(self) -> None:
        """Read the robot every TICK_S — only while a link is on."""
        self.stop()
        if not self.link_on():
            return
        from homeassistant.helpers.event import async_track_time_interval  # noqa: PLC0415

        async def _tick(_now=None):
            try:
                await self.async_tick()
            except Exception:  # noqa: BLE001 — a robot that cannot be read is not an error
                _LOGGER.debug("Vacuum read failed", exc_info=True)
        self._unsub = async_track_time_interval(self.hass, _tick, timedelta(seconds=TICK_S))

    def stop(self) -> None:
        if self._unsub:
            self._unsub()
            self._unsub = None
        self.live = None
        self._last_spot = None

    async def async_read_payload(self, link: dict) -> Any:
        kind, ref = link.get("read"), link.get("ref") or ""
        if kind == "url":
            return await fetch_url_json(self.hass, ref)
        if kind == "camera_png":
            png = await camera_image(self.hass, ref)
            # Unpacking a few MB of map JSON every tick: off the event loop.
            return await self.hass.async_add_executor_job(extract_valetudo_json, png)
        if kind == "camera_attrs":
            st = self.hass.states.get(ref)
            return dict(st.attributes) if st else None
        return None

    async def async_tick(self) -> None:
        lk = self.data.get("link")
        if not self.link_on():
            self.live = None
            return
        payload = await self.async_read_payload(lk)
        spot = robot_spot(lk.get("format") or "", payload)
        if not spot:
            return
        to_m = lk.get("to_m")
        if not isinstance(to_m, list) or len(to_m) != 6:
            return
        m = _apply(to_m, spot["x"], spot["y"])
        self.live = {"x_m": round(m[0], 3), "y_m": round(m[1], 3), "floor_id": lk.get("floor_id"),
                     "map_id": lk["map_id"],
                     "angle": spot.get("a"), "entity_id": lk.get("vacuum_entity") or "", "ts": time.time()}
        await self.async_walk(m[0], m[1], lk)

    # The walker ---------------------------------------------------------------
    async def async_walk(self, x_m: float, y_m: float, lk: dict) -> dict | None:
        """At a spot the robot stood still on, a PENDING point — never a calibration point."""
        wk = self.data.get("walker") or {}
        tag = str(wk.get("tag") or "").strip().upper()
        fl = str(lk.get("floor_id") or "")
        prev, self._last_spot = self._last_spot, (x_m, y_m, fl)
        if not wk.get("enabled") or not tag:
            return None
        if not prev or prev[2] != fl or math.hypot(x_m - prev[0], y_m - prev[1]) > WALK_STILL_M:
            return None
        pend = self.data.setdefault("pending", [])
        if len(pend) >= PENDING_MAX:
            return None
        if any(p.get("floor_id") == fl and math.hypot(p["x_m"] - x_m, p["y_m"] - y_m) < WALK_APART_M for p in pend):
            return None
        from .calibration_store import MIN_SCANNER_SAMPLES  # noqa: PLC0415
        readings = [r for r in tag_samples(self.hass, tag, TICK_S + 2) if len(r["rssi_samples"]) >= MIN_SCANNER_SAMPLES]
        if len(readings) < WALK_MIN_SOURCES:
            return None
        point = {"id": f"vp_{os.urandom(5).hex()}", "x_m": round(x_m, 3), "y_m": round(y_m, 3),
                 "floor_id": fl, "map_id": lk["map_id"], "tag": tag,
                 "collected_at": datetime.now(timezone.utc).isoformat(), "scanner_readings": readings}
        pend.append(point)
        await self.async_save()
        return point

    def pending_list(self) -> list[dict]:
        return list(self.data.get("pending") or [])

    def take_pending(self, point_id: str) -> dict | None:
        pend = self.data.get("pending") or []
        for i, p in enumerate(pend):
            if p.get("id") == point_id:
                return pend.pop(i)
        return None


def tag_samples(hass, tag: str, window_s: float) -> list[dict]:
    """The tag's raw RSSI samples per scanner over the last window_s seconds
    (bluetooth_live's median-of-N buffers, the same ones the beacon
    auto-calibration buffer is filled from)."""
    from .bluetooth_live import DATA_KEY, _now  # noqa: PLC0415
    bl = hass.data.get(DOMAIN, {}).get(DATA_KEY)
    samples = getattr(bl, "_rssi_samples", None)
    if not isinstance(samples, dict):
        return []
    per = next((v for k, v in samples.items() if str(k).upper() == tag), None) or {}
    cutoff = _now() - timedelta(seconds=window_s)
    out = []
    for src, dq in per.items():
        vals = [float(r) for (t, r) in list(dq) if t >= cutoff]
        if vals and src != "_unknown":
            out.append({"source": str(src), "rssi_samples": vals})
    return out


async def camera_image(hass, entity_id: str) -> bytes:
    from homeassistant.components.camera import async_get_image  # noqa: PLC0415
    img = await async_get_image(hass, entity_id, timeout=15)
    return img.content


async def fetch_url_json(hass, url: str) -> Any:
    """GET a Valetudo map from the robot's REST API (the address the user gave)."""
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
    import aiohttp  # noqa: PLC0415
    async with async_get_clientsession(hass).get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        if resp.status != 200:
            raise VacuumImportError(f"The robot answered HTTP {resp.status}")
        raw = await resp.content.read(MAX_JSON_BYTES + 1)
    if len(raw) > MAX_JSON_BYTES:
        raise VacuumImportError("The map is too large")
    # A few MB of JSON every tick with the link on: parsed off the event loop.
    return await hass.async_add_executor_job(_json_answer, raw)


def _json_answer(raw: bytes) -> Any:
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:
        raise VacuumImportError("The robot's answer is not JSON") from exc


def valetudo_map_url(url: str) -> str:
    """A robot's address (or its map URL) as the map URL. http(s) only."""
    u = str(url or "").strip().rstrip("/")
    if not u.lower().startswith(("http://", "https://")):
        raise VacuumImportError("The robot's address must start with http:// or https://")
    return u if u.endswith("/api/v2/robot/state/map") else u + "/api/v2/robot/state/map"


def live_position(hass) -> dict | None:
    """The linked robot's spot for the live snapshot, or None (no link, off, stale)."""
    vs = hass.data.get(DOMAIN, {}).get(DATA_VACUUM)
    live = getattr(vs, "live", None)
    if not live or not vs.link_on() or time.time() - float(live.get("ts") or 0) > LIVE_STALE_S:
        return None
    return dict(live)
