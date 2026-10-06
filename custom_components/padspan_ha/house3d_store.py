# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard, the 3D house: its own file, padspan_ha.house3d.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch ("Data", "Normally
off"). Everything the 3D view needs that the map does not hold lives here, so
this feature never writes the map (fabric, model, maps, light positions).

Normally off. While settings.atlas_3d_enabled is False (the default) the file
is registered, so backup, restore and factory reset know it, but nothing
writes it, and it is not even loaded until something asks for it
(async_get_store), so an install with the feature off does no work at all.

The Home Assistant store version stays 1 forever: a different major version
makes HA refuse the file, SafeStore turns that into None, and the next save
would overwrite what was there. Shape changes go through the data's own
"schema" field. Reading is tolerant: every key is kept, known or not, so an
older and a newer PadSpan never lose what the other wrote. A newer PadSpan's
file (after a downgrade) is read and kept whole, and never written here
(writable). A file that is there but cannot be read is never taken for an
empty one (ReadFailed), so no Save writes an empty house over it.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import re
import unicodedata
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from .const import DATA_HOUSE3D, DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from .safe_store import wrap_store

_LOGGER = logging.getLogger(__name__)

SCHEMA = 1
# The keyed sections (docs: pieces, 3D-only light heights, door hinge and swing,
# beacon/scanner recipes, people figures). "library" holds the terms acceptance.
SECTIONS: tuple[str, ...] = ("pieces", "lights", "openings", "devices", "figures")
_LOAD_LOCK = "house3d_load_lock"   # hass.data[DOMAIN]: one first load at a time
NEWER_MESSAGE = ("Live Aboard's file was saved by a newer PadSpan. This version shows it but does not "
                 "change it: update PadSpan to edit it.")


def empty() -> dict[str, Any]:
    """The file's content for a house with nothing in 3D yet."""
    return {"schema": SCHEMA, **{k: {} for k in SECTIONS}, "library": {}}


def writable(data: Any) -> bool:
    """May this version write the file? Only when its schema is a whole number
    up to SCHEMA (no schema is this version's). A newer PadSpan's file is read
    and kept as it is: writing it back would reshape or drop what only the
    newer version knows."""
    s = data.get("schema", SCHEMA) if isinstance(data, dict) else SCHEMA
    return isinstance(s, int) and not isinstance(s, bool) and 0 <= s <= SCHEMA


def normalise(raw: Any) -> dict[str, Any]:
    """Tolerant read: every key in `raw` is kept; anything that is not a dict
    is an empty house. In a file this version writes, a missing or broken
    section becomes empty; a newer PadSpan's file is kept exactly as it is,
    sections and all (nothing here writes it)."""
    if not isinstance(raw, dict):
        return empty()
    out = dict(raw)
    out.setdefault("schema", SCHEMA)
    if writable(out):
        for k in (*SECTIONS, "library"):
            if not isinstance(out.get(k), dict):
                out[k] = {}
    return out


async def async_file_exists(hass: HomeAssistant) -> bool:
    """Has anything ever written the file? An install that never used the
    feature has none, and backups, restores and resets keep it that way.
    (ws_common._store_file_written: an unanswerable check counts as yes.)"""
    from .ws_common import _store_file_written  # noqa: PLC0415
    return await _store_file_written(hass, HOUSE3D_STORE_KEY)


def enabled(hass: HomeAssistant) -> bool:
    """The master switch, settings.atlas_3d_enabled (default off)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool(((st.data if st else {}) or {}).get("atlas_3d_enabled", False))


class ReadFailed(Exception):
    """The file is there but could not be read. Nothing is kept in memory and
    nothing writes the file until a read succeeds."""


class House3dStore:
    """padspan_ha.house3d. `.data` is what a PadSpan backup saves and a
    restore replaces (ws_common._DATA_KEY_MAP)."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self._raw_store = Store(hass, 1, HOUSE3D_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "house3d")
        self._data: dict[str, Any] = empty()
        # Held by every write (an edit's apply-and-save, a clear and its
        # backup): one Save never rolls back another, and none lands between
        # a clear's backup and the clear.
        self.lock = asyncio.Lock()

    @property
    def data(self) -> dict[str, Any]:
        return self._data

    @data.setter
    def data(self, value: Any) -> None:
        # A restore (ws_backup) and a factory reset assign .data directly:
        # whatever comes in is read the tolerant way, so the sections are
        # always there for the code that reads them.
        self._data = normalise(value)

    async def async_load(self) -> dict[str, Any]:
        """Read the file. SafeStore would turn a read error into None, the
        empty house; a read that fails while the file is there raises
        ReadFailed instead."""
        try:
            raw = await self._raw_store.async_load()
        except Exception as exc:  # noqa: BLE001
            if await async_file_exists(self.hass):
                _LOGGER.error("PadSpan load FAILED for house3d: %s", exc)
                raise ReadFailed(str(exc)) from exc
            raw = None
        self.data = normalise(raw)
        return self.data

    async def async_write(self, new: dict[str, Any]) -> bool:
        """Write `new` as the whole file and read it back: written only if the
        file then holds exactly `new`. Home Assistant's Store logs a failed
        write and returns normally, and SafeStore's read-back then finds the
        old file, so only the comparison tells (as ws_backup._auto_backup
        does). Memory becomes `new` only then; on a failure it is unchanged."""
        if not await self.store.async_save(new):
            return False
        try:
            back = await self._raw_store.async_load()
        except Exception:  # noqa: BLE001
            back = None
        if back != new:
            _LOGGER.error("PadSpan save VERIFICATION FAILED for house3d: the file does not hold what was written")
            return False
        self.data = new
        return True

    def counts(self) -> dict[str, int]:
        # A newer PadSpan's section can be other than a dict (normalise).
        return {k: len(self.data[k]) if isinstance(self.data.get(k), dict) else 0 for k in SECTIONS}


# ── The 3D editor's Save (ws_house3d.house3d_edit) ───────────────────────────
# One draft, written at once: doors, windows and doorways drawn on a wall in
# 3D ("win_" / "door_" / "doorway_" + 8 hex digits, a stretch of wall in
# fabric metres; a doorway is an opening with no door in it, an archway), the
# hinge, swing, sill and head of a barrier's own door or window and how a door
# with no sensor is shown (keyed by the barrier's id; the map is never written), the 3D-only height of a light (and
# what it is, its kind) or another device (or a beacon's or scanner's look),
# the furniture (P2 Furnish: "fur_" + 8 hex digits) and the people figures
# (P6). Each entry is set, or removed with None. What the editor owns is checked strictly; every other
# key already in the file (a newer PadSpan's) is kept.
EDIT_SECTIONS: tuple[str, ...] = ("openings", "lights", "devices", "pieces", "figures")
OPENING_ID = re.compile(r"^(win|door|doorway)_[0-9a-f]{8}$")
BARRIER_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")
# Home Assistant's own entity id shape (core.valid_entity_id).
ENTITY_ID = re.compile(r"^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$")
WINDOW_MIN_M, DOOR_MIN_M, OPENING_MAX_M = 0.3, 0.6, 50.0
DOOR_MIN_HEAD_M, HEIGHT_MAX_M, GAP_MIN_M = 0.5, 10.0, 0.1
COORD_MAX_M = 10_000.0
MAX_OPENINGS, MAX_HEIGHTS, MAX_CHANGES = 500, 2000, 1000
_ADDED_KEYS = {"window": ("kind", "floor_id", "a_m", "b_m", "sill_m", "head_m"),
               "door": ("kind", "floor_id", "a_m", "b_m", "head_m", "hinge", "swing"),
               "doorway": ("kind", "floor_id", "a_m", "b_m", "head_m")}
# A door with no sensor is shown open, ajar (the default for an inside door)
# or shut (an outside door's); one linked to a sensor follows it.
DOOR_SHOWN = ("open", "ajar", "shut")
# What a door is (Garry, 2026-10-05: "a door will also need swing left, right,
# roll up or down, etc."), and its options: which way it slides or folds, the
# face a barn door runs on, how many panels (a bifold's; a gate's 2 is a double
# gate), glass, and what drives it in Live Aboard (link: a contact sensor or a
# cover, whose position it follows). None stored: PadSpan's guess. An older
# PadSpan keeps these keys (they are not its own) and draws the door hinged.
DOOR_TYPES = ("hinged", "double", "sliding", "barn", "pocket", "bifold", "overhead", "rollup", "tiltup", "gate")
DOOR_SLIDES, DOOR_FACES, DOOR_PANELS = ("left", "right", "both"), ("in", "out"), (2, 4)
_DOOR_TYPE_KEYS = ("type", "slide", "face", "panels", "glass", "link")
_ADDED_MAYBE = {"door": ("shown",) + _DOOR_TYPE_KEYS}
_ADDED_OWNED = frozenset(_ADDED_KEYS["window"] + _ADDED_KEYS["door"] + _ADDED_KEYS["doorway"] + ("shown",) + _DOOR_TYPE_KEYS)
_BARRIER_OWNED = frozenset(("hinge", "swing", "sill_m", "head_m", "shown") + _DOOR_TYPE_KEYS)
_HEIGHT_OWNED = frozenset(("z_m",))
# A piece of furniture (docs "Data"): where it stands is fabric metres on its
# floor, z_m its bottom above that floor, rotation degrees. Its recipe is plain
# data the builders draw; an unknown kind or param is kept (drawn as a box).
PIECE_ID = re.compile(r"^fur_[0-9a-f]{8}$")
ORIGINS = ("build", "photo", "library", "import")
MAX_PIECES, PIECE_Z_MAX_M, SIZE_MIN_M, SIZE_MAX_M = 1000, 20.0, 0.001, 8.0   # a rug can be a few millimetres thin
MAX_PARAMS, MAX_COLORS, NAME_MAX, TEXT_MAX, LABEL_MAX, PIECE_JSON_MAX = 40, 6, 40, 60, 60, 8000
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
REF_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
# Stairs are a piece (recipe kind "stairs"): straight, an L or a U, turning
# left or right, from their floor up to the floor they reach (to_floor, a
# floor's id; none: the next floor up). Width and depth are their footprint,
# height their rise (the gap between the two floors, kept by the editor; the
# view always draws the gap).
STAIR_SHAPES, STAIR_TURNS = ("straight", "l", "u"), ("left", "right")
STAIR_SIZE_MIN_M, STAIR_RISE_M = 0.5, (0.3, 8.0)
_PIECE_OWNED = frozenset(("id", "recipe", "origin", "label", "library_id", "submission_id", "floor_id",
                          "x_m", "y_m", "z_m", "rotation", "entity_id", "entity_reg_id", "updated_at"))
_CAPS = {"openings": MAX_OPENINGS, "lights": MAX_HEIGHTS, "devices": MAX_HEIGHTS, "pieces": MAX_PIECES,
         "figures": 50}


class EditError(ValueError):
    """An edit that cannot be saved; nothing of it is written."""


class NewerFile(EditError):
    """The file is a newer PadSpan's (writable is False): nothing is written."""


def _num(v: Any, lo: float, hi: float, what: str) -> float:
    try:
        ok = not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v) and lo <= v <= hi
    except OverflowError:   # an int too big for a float
        ok = False
    if not ok:
        raise EditError(f"{what} must be a number from {lo:g} to {hi:g}")
    return round(float(v), 3)


def _pick(v: Any, choices: tuple[str, ...], what: str) -> str:
    if v not in choices:
        raise EditError(f"{what} must be one of {', '.join(choices)}")
    return v


def _added_opening(oid: str, e: dict) -> dict:
    """A door, window or doorway drawn in 3D: complete, in range, and of its id's kind."""
    kind = oid.split("_")[0]
    kind = "window" if kind == "win" else kind
    want, maybe = _ADDED_KEYS[kind], _ADDED_MAYBE.get(kind, ())
    if not set(want) <= set(e) <= set(want) | set(maybe):
        raise EditError(f"{oid}: a {kind} has exactly {', '.join(want)}"
                        + (f", and {', '.join(maybe)} if it has it" if maybe else ""))
    if e["kind"] != kind:
        raise EditError(f"{oid}: its kind must be {kind}")
    fl = e["floor_id"]
    if not isinstance(fl, str) or not fl.strip() or len(fl) > 64:
        raise EditError(f"{oid}: floor_id must be a floor's id")
    pts = []
    for k in ("a_m", "b_m"):
        p = e[k]
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            raise EditError(f"{oid}: {k} must be [x, y] in metres")
        pts.append([_num(p[0], -COORD_MAX_M, COORD_MAX_M, f"{oid} {k}"),
                    _num(p[1], -COORD_MAX_M, COORD_MAX_M, f"{oid} {k}")])
    lo = WINDOW_MIN_M if kind == "window" else DOOR_MIN_M          # a doorway is as wide as a door at least
    if not lo - 1e-6 <= math.dist(*pts) <= OPENING_MAX_M:
        raise EditError(f"{oid}: a {kind} is {lo:g} m to {OPENING_MAX_M:g} m wide")
    out = {"kind": kind, "floor_id": fl.strip(), "a_m": pts[0], "b_m": pts[1]}
    if kind == "window":
        sill = _num(e["sill_m"], 0.0, HEIGHT_MAX_M, f"{oid} sill_m")
        head = _num(e["head_m"], 0.0, HEIGHT_MAX_M, f"{oid} head_m")
        if head < sill + GAP_MIN_M - 1e-9:
            raise EditError(f"{oid}: the head must be above the sill")
        out.update(sill_m=sill, head_m=head)
    elif kind == "doorway":
        out.update(head_m=_num(e["head_m"], DOOR_MIN_HEAD_M, HEIGHT_MAX_M, f"{oid} head_m"))
    else:
        out.update(head_m=_num(e["head_m"], DOOR_MIN_HEAD_M, HEIGHT_MAX_M, f"{oid} head_m"),
                   hinge=_pick(e["hinge"], ("left", "right"), f"{oid} hinge"),
                   swing=_pick(e["swing"], ("in", "out"), f"{oid} swing"))
        if "shown" in e:
            out["shown"] = _pick(e["shown"], DOOR_SHOWN, f"{oid} shown")
        out.update(_door_type(oid, e))
    return out


def _door_type(oid: str, e: dict) -> dict:
    """A door's type and options, each checked when it is there."""
    out: dict[str, Any] = {}
    if "type" in e:
        out["type"] = _pick(e["type"], DOOR_TYPES, f"{oid} type")
    if "slide" in e:
        out["slide"] = _pick(e["slide"], DOOR_SLIDES, f"{oid} slide")
    if "face" in e:
        out["face"] = _pick(e["face"], DOOR_FACES, f"{oid} face")
    if "panels" in e:
        p = e["panels"]
        if isinstance(p, bool) or not isinstance(p, int) or not DOOR_PANELS[0] <= p <= DOOR_PANELS[1]:
            raise EditError(f"{oid}: panels must be a whole number from {DOOR_PANELS[0]} to {DOOR_PANELS[1]}")
        out["panels"] = p
    if "glass" in e:
        if not isinstance(e["glass"], bool):
            raise EditError(f"{oid}: glass must be true or false")
        out["glass"] = e["glass"]
    if "link" in e:
        lk = e["link"]
        if not (isinstance(lk, str) and len(lk) <= 255 and ENTITY_ID.fullmatch(lk)):
            raise EditError(f"{oid}: link must be an entity id")
        out["link"] = lk
    return out


def _barrier_override(bid: str, e: dict) -> dict:
    """A barrier's door or window in 3D only: any of hinge, swing, sill, head,
    and how a door with no sensor is shown."""
    if not e or set(e) - _BARRIER_OWNED:
        raise EditError(f"{bid}: a barrier's opening takes only {', '.join(sorted(_BARRIER_OWNED))}")
    out: dict[str, Any] = {}
    if "hinge" in e:
        out["hinge"] = _pick(e["hinge"], ("left", "right"), f"{bid} hinge")
    if "swing" in e:
        out["swing"] = _pick(e["swing"], ("in", "out"), f"{bid} swing")
    for k in ("sill_m", "head_m"):
        if k in e:
            out[k] = _num(e[k], 0.0, HEIGHT_MAX_M, f"{bid} {k}")
    if "shown" in e:
        out["shown"] = _pick(e["shown"], DOOR_SHOWN, f"{bid} shown")
    out.update(_door_type(bid, e))
    if "sill_m" in out and "head_m" in out and out["head_m"] < out["sill_m"] + GAP_MIN_M - 1e-9:
        raise EditError(f"{bid}: the head must be above the sill")
    return out


def _plain(v: Any, most: int, *, blank: bool = False) -> bool:
    """Text of at most `most` characters, none of them a control character,
    and not blank unless `blank`."""
    return (isinstance(v, str) and len(v) <= most and (blank or bool(v.strip()))
            and not any(unicodedata.category(c) == "Cc" for c in v))


def _finite(v: Any) -> bool:
    try:
        return not isinstance(v, bool) and isinstance(v, (int, float)) and math.isfinite(v)
    except OverflowError:   # an int too big for a float
        return False


def _recipe(pid: str, r: Any) -> dict:
    """A recipe (contracts §1): a short kind (unknown kinds kept), a flat dict
    of params, up to six colours, and a size in range. Other keys (the
    library's details sheet, a newer PadSpan's) are kept."""
    if not isinstance(r, dict):
        raise EditError(f"{pid}: recipe must be an object")
    if not _plain(r.get("kind"), NAME_MAX):
        raise EditError(f"{pid}: recipe.kind must be text of 1 to {NAME_MAX} characters")
    params, colors = r.get("params", {}), r.get("colors", [])
    if not isinstance(params, dict) or len(params) > MAX_PARAMS:
        raise EditError(f"{pid}: recipe.params must be an object of at most {MAX_PARAMS} settings")
    for k, v in params.items():
        if not _plain(k, NAME_MAX) or not (isinstance(v, bool) or _finite(v) or _plain(v, TEXT_MAX, blank=True)):
            raise EditError(f"{pid}: recipe.params holds short names with numbers, short text or true/false")
    if not isinstance(colors, list) or len(colors) > MAX_COLORS or not all(isinstance(c, str) and COLOR.fullmatch(c) for c in colors):
        raise EditError(f"{pid}: recipe.colors must be at most {MAX_COLORS} colours like #5b6b7a")
    if "details" in r and not isinstance(r["details"], dict):
        raise EditError(f"{pid}: recipe.details must be an object")
    out = {**r, "kind": r["kind"].strip(), "params": dict(params), "colors": [c.lower() for c in colors]}
    for k in ("width_m", "depth_m", "height_m"):
        out[k] = _num(r.get(k), SIZE_MIN_M, SIZE_MAX_M, f"{pid} recipe.{k}")
    if out["kind"] == "stairs":
        _stairs(pid, out)
    return out


def _stairs(pid: str, r: dict) -> None:
    """Stairs: a shape and a turn from the closed lists, the floor they reach
    a floor's id when given, a footprint at least half a metre each way and a
    rise in range."""
    p = r["params"]
    _pick(p.get("shape", "straight"), STAIR_SHAPES, f"{pid} stairs shape")
    _pick(p.get("turn", "left"), STAIR_TURNS, f"{pid} stairs turn")
    to = p.get("to_floor")
    if to is not None and not _plain(to, 64):
        raise EditError(f"{pid}: the floor stairs reach (to_floor) must be a floor's id")
    for k in ("width_m", "depth_m"):
        if r[k] < STAIR_SIZE_MIN_M:
            raise EditError(f"{pid}: stairs are at least {STAIR_SIZE_MIN_M:g} m each way")
    _num(r["height_m"], *STAIR_RISE_M, f"{pid} stairs rise (recipe.height_m)")


def _piece(pid: str, e: dict, stamp: str) -> dict:
    """A piece of furniture (contracts §2), complete: what it is, where it
    stands, which device it is. Its floor may be one since deleted (the plan:
    a floor that no longer exists is accepted). Keys it does not know are kept."""
    if e.get("id", pid) != pid:
        raise EditError(f"{pid}: its id must be its key")
    fl, label = e.get("floor_id"), e.get("label") or ""
    if not isinstance(fl, str) or not fl.strip() or len(fl) > 64:
        raise EditError(f"{pid}: floor_id must be a floor's id")
    if not isinstance(label, str):
        raise EditError(f"{pid}: label must be text")
    label = "".join(c for c in label if unicodedata.category(c) != "Cc").strip()
    if len(label) > LABEL_MAX:
        raise EditError(f"{pid}: a label is at most {LABEL_MAX} characters")
    out = {**e, "id": pid, "recipe": _recipe(pid, e.get("recipe")), "label": label, "floor_id": fl.strip(),
           "origin": _pick(e.get("origin", "build"), ORIGINS, f"{pid} origin"),
           "x_m": _num(e.get("x_m"), -COORD_MAX_M, COORD_MAX_M, f"{pid} x_m"),
           "y_m": _num(e.get("y_m"), -COORD_MAX_M, COORD_MAX_M, f"{pid} y_m"),
           "z_m": _num(e.get("z_m", 0.0), 0.0, PIECE_Z_MAX_M, f"{pid} z_m"),
           "updated_at": stamp}
    rot = round(_num(e.get("rotation", 0.0), -COORD_MAX_M, COORD_MAX_M, f"{pid} rotation") % 360.0, 3)
    out["rotation"] = 0.0 if rot >= 360.0 else rot + 0.0          # [0, 360), never -0.0
    for k in ("library_id", "submission_id", "entity_reg_id"):
        v = out[k] = e.get(k)
        if v is not None and not (isinstance(v, str) and REF_ID.fullmatch(v)):
            raise EditError(f"{pid}: {k} must be a short id or null")
    ent = out["entity_id"] = e.get("entity_id")
    if ent is not None and not (isinstance(ent, str) and len(ent) <= 255 and ENTITY_ID.fullmatch(ent)):
        raise EditError(f"{pid}: entity_id must be an entity id or null")
    try:
        size = len(json.dumps(out, allow_nan=False))
    except (TypeError, ValueError) as err:
        raise EditError(f"{pid}: holds something that is not plain data") from err
    if size > PIECE_JSON_MAX:
        raise EditError(f"{pid}: a piece is at most {PIECE_JSON_MAX} characters of data")
    return out


# A light's 3D-only entry: its height {z_m} and/or what it is in Live Aboard
# {kind} (a pot, a valance, a lamp...; 3D only, the map is never written), and
# where an LED strip or a string of lights really goes {run} (the Strip
# tool). The entry is the editor's whole: a key it leaves out goes. A kind is
# a short word, and one this version does not draw is still kept (drawn as
# guessed).
_LIGHT_OWNED = frozenset(("z_m", "kind", "run"))
# A run: pts [[x, y, h], ...] in metres, 2 to 64 of them: x and y on the
# light's own floor (or across and to the front of a piece of furniture when
# it is on one, "piece"), h above that floor (above the piece's bottom). face:
# which way it shines. loop: the last point joins the first. A string of
# lights hangs in a swag (sag_m) with a bulb every spacing_m; gaps: the
# stretches that are only wire (a jump past a door), by number from 0.
RUN_FACES = ("up", "down", "room", "wall")
RUN_PTS_MAX, RUN_SEG_MIN_M, RUN_MAX_M = 64, 0.05, 100.0
RUN_SAG_MAX_M, RUN_SPACING_M = 1.5, (0.15, 2.0)
_RUN_KEYS = frozenset(("pts", "face", "loop", "piece", "sag_m", "spacing_m", "gaps"))


def _run(k: str, r: Any) -> dict:
    """A light's run, checked: every point in range, every stretch at least
    5 cm, at most 100 m in all."""
    if not isinstance(r, dict) or set(r) - _RUN_KEYS or not {"pts", "face", "loop"} <= set(r):
        raise EditError(f"{k}: a run is {{pts, face, loop}}, and piece, sag_m, spacing_m and gaps if it has them")
    pts = r["pts"]
    if not isinstance(pts, list) or not 2 <= len(pts) <= RUN_PTS_MAX:
        raise EditError(f"{k}: a run has 2 to {RUN_PTS_MAX} points")
    clean = []
    for i, p in enumerate(pts, 1):
        if not isinstance(p, (list, tuple)) or len(p) != 3:
            raise EditError(f"{k}: run point {i} must be [x, y, height] in metres")
        clean.append([_num(p[0], -COORD_MAX_M, COORD_MAX_M, f"{k} run point {i} x"),
                      _num(p[1], -COORD_MAX_M, COORD_MAX_M, f"{k} run point {i} y"),
                      _num(p[2], 0.0, HEIGHT_MAX_M, f"{k} run point {i} height")])
    loop = r["loop"]
    if not isinstance(loop, bool):
        raise EditError(f"{k}: run loop must be true or false")
    if loop and len(clean) < 3:
        raise EditError(f"{k}: a run round a loop has at least 3 points")
    segs = list(zip(clean, clean[1:])) + ([(clean[-1], clean[0])] if loop else [])
    total = 0.0
    for i, (a, b) in enumerate(segs, 1):
        d = math.dist(a, b)
        if d < RUN_SEG_MIN_M - 1e-9:
            raise EditError(f"{k}: each stretch of a run is at least 5 cm (stretch {i} is {d * 100:.1f} cm)")
        total += d
    if total > RUN_MAX_M + 1e-9:
        raise EditError(f"{k}: a run is at most {RUN_MAX_M:g} m long")
    out: dict[str, Any] = {"pts": clean, "face": _pick(r["face"], RUN_FACES, f"{k} run face"), "loop": loop}
    if "piece" in r:
        if not isinstance(r["piece"], str) or not PIECE_ID.fullmatch(r["piece"]):
            raise EditError(f"{k}: run piece must be a piece's id (fur_ + 8 hex digits)")
        out["piece"] = r["piece"]
    if "sag_m" in r:
        out["sag_m"] = _num(r["sag_m"], 0.0, RUN_SAG_MAX_M, f"{k} run sag_m")
    if "spacing_m" in r:
        out["spacing_m"] = _num(r["spacing_m"], *RUN_SPACING_M, f"{k} run spacing_m")
    if "gaps" in r:
        g = r["gaps"]
        if (not isinstance(g, list) or len(set(map(repr, g))) != len(g) or len(g) >= len(segs)
                or not all(isinstance(i, int) and not isinstance(i, bool) and 0 <= i < len(segs) for i in g)):
            raise EditError(f"{k}: run gaps are the numbers of some of its stretches, each once, not all of them")
        out["gaps"] = sorted(g)
    return out


def piece_point(piece: dict, p: list) -> list:
    """A run's point on a piece (across, to the front, above its bottom) as a
    point on its floor: the piece's own frame (live_aboard_pieces.js boxOf)."""
    t = math.radians((piece.get("rotation") or 0.0) % 360.0)
    x, y, z = (float(piece.get(k) or 0.0) for k in ("x_m", "y_m", "z_m"))
    return [round(x + math.cos(t) * p[0] - math.sin(t) * p[1], 3), round(y + math.sin(t) * p[0] + math.cos(t) * p[1], 3),
            round(min(HEIGHT_MAX_M, z + p[2]), 3)]


def detach_runs(lights: dict, gone: dict) -> None:
    """Runs on pieces that are gone (`gone`: id → the piece as it was) stay
    where they were: plain points on the floor, in place."""
    for e in lights.values():
        run = e.get("run") if isinstance(e, dict) else None
        piece = gone.get(run.get("piece")) if isinstance(run, dict) else None
        if not isinstance(piece, dict) or not isinstance(run.get("pts"), list):
            continue
        try:
            pts = [piece_point(piece, p) for p in run["pts"]]
        except (TypeError, ValueError, IndexError):
            continue
        e["run"] = {**{k: v for k, v in run.items() if k != "piece"}, "pts": pts}


def _light_entry(k: str, v: dict) -> dict:
    if not v or set(v) - _LIGHT_OWNED:
        raise EditError(f"{k}: a light has a height {{z_m}}, a kind {{kind}} and/or a run {{run}}")
    out: dict[str, Any] = {}
    if "z_m" in v:
        out["z_m"] = _num(v["z_m"], 0.0, HEIGHT_MAX_M, f"{k} z_m")
    if "kind" in v:
        if not isinstance(v["kind"], str) or not _KIND.fullmatch(v["kind"]):
            raise EditError(f"{k}: kind must be a short word (a-z, 0-9 and _)")
        out["kind"] = v["kind"]
    if "run" in v:
        out["run"] = _run(k, v["run"])
    return out


def _entry(section: str, key: Any, e: Any, stamp: str = "") -> tuple[frozenset, dict | None, bool]:
    """(the keys the editor owns in this entry, the checked entry or None to
    remove it, whether removing takes the whole entry)."""
    if not isinstance(key, str):
        raise EditError(f"{section}: every key must be text")
    if section in _OWN_ENTRY:            # people figures, and beacon and scanner looks (P6)
        return _OWN_ENTRY[section](key, e)
    # fullmatch: with match, "$" also matches before a trailing newline.
    if section == "openings":
        if OPENING_ID.fullmatch(key):
            owned, whole, check = _ADDED_OWNED, True, _added_opening
        elif key.startswith(("win_", "door_", "doorway_")) or not BARRIER_ID.fullmatch(key):
            raise EditError(f"openings: {key[:48]!r} is neither win_/door_/doorway_ + 8 hex digits nor a barrier's id")
        else:
            owned, whole, check = _BARRIER_OWNED, False, _barrier_override
    elif section == "pieces":
        if not PIECE_ID.fullmatch(key):
            raise EditError(f"pieces: {key[:48]!r} is not fur_ + 8 hex digits")
        owned, whole = _PIECE_OWNED, True

        def check(k: str, v: dict) -> dict:
            return _piece(k, v, stamp)
    elif section == "lights":
        if len(key) > 255 or not ENTITY_ID.fullmatch(key):
            raise EditError(f"{section}: {key[:48]!r} is not an entity id")
        owned, whole, check = _LIGHT_OWNED, False, _light_entry
    else:
        if len(key) > 255 or not ENTITY_ID.fullmatch(key):
            raise EditError(f"{section}: {key[:48]!r} is not an entity id")
        owned, whole = _HEIGHT_OWNED, False

        def check(k: str, v: dict) -> dict:
            if set(v) != {"z_m"}:
                raise EditError(f"{k}: a height is {{z_m}} alone")
            return {"z_m": _num(v["z_m"], 0.0, HEIGHT_MAX_M, f"{k} z_m")}
    if e is None:
        return owned, None, whole
    if not isinstance(e, dict):
        raise EditError(f"{key}: must be an object, or null to remove it")
    return owned, check(key, e), whole


def apply_edit(data: Any, changes: Any) -> dict[str, Any]:
    """The file as it is after `changes` ({section: {key: entry | None}}),
    or EditError and nothing changed. `data` itself is never modified, so a
    refused or failed save leaves the file and the memory as they were. A
    newer PadSpan's file is never changed (NewerFile)."""
    base = normalise(data)
    if not writable(base):
        raise NewerFile(NEWER_MESSAGE)
    if not isinstance(changes, dict) or set(changes) - set(EDIT_SECTIONS):
        raise EditError(f"an edit has only {', '.join(EDIT_SECTIONS)}")
    out = copy.deepcopy(base)
    n, stamp = 0, dt_util.utcnow().replace(microsecond=0).isoformat()
    for section in EDIT_SECTIONS:
        entries = changes.get(section)
        if entries is None:
            continue
        if not isinstance(entries, dict):
            raise EditError(f"{section} must be an object")
        n += len(entries)
        if n > MAX_CHANGES:
            raise EditError(f"at most {MAX_CHANGES} changes in one save")
        target, before = out[section], len(out[section])
        for key, e in entries.items():
            owned, clean, whole = _entry(section, key, e, stamp)
            old = target.get(key)
            # Keys this editor does not own stay (a newer PadSpan's), except
            # when a door or window drawn in 3D is removed: the entry is it.
            keep = {}
            if isinstance(old, dict) and not (whole and clean is None):
                keep = {k: v for k, v in old.items() if k not in owned}
            if clean is None and not keep:
                target.pop(key, None)
            else:
                target[key] = {**keep, **(clean or {})}
        if len(target) > max(_CAPS[section], before):
            raise EditError(f"{section}: at most {_CAPS[section]}")
    if not n:
        raise EditError("nothing to save")
    # A piece removed takes no strip with it: a run on it stays where it was.
    detach_runs(out["lights"], {pid: p for pid, p in base["pieces"].items() if pid not in out["pieces"]})
    for key in changes.get("lights") or {}:
        e = out["lights"].get(key)
        run = e.get("run") if isinstance(e, dict) else None
        if isinstance(run, dict) and "piece" in run and run["piece"] not in out["pieces"]:
            raise EditError(f"{key}: its run is on a piece that is not there")
    return out


def without_pieces(data: dict) -> dict:
    """The file with no furniture ("Remove all furniture"): the runs that
    were on pieces stay where they were."""
    out = {**data, "pieces": {}}
    if isinstance(data.get("lights"), dict) and isinstance(data.get("pieces"), dict) and data["pieces"]:
        out["lights"] = copy.deepcopy(data["lights"])
        detach_runs(out["lights"], data["pieces"])
    return out


async def async_restore_data(hass: HomeAssistant, incoming: Any) -> Any:
    """What a backup restore writes for this file (ws_backup): the backup's,
    except that a backup with no furniture in it (one from before the
    furniture) keeps the furniture this install has now. The plan, "Undoing
    it": restoring an older backup that has no furniture leaves the current
    furniture alone. What this house shared to the library stays as it is now
    (house3d_library.carried_over). A file that cannot be read now, or either
    side a newer PadSpan's, is restored as the backup has it."""
    pieces = incoming.get("pieces") if isinstance(incoming, dict) else None
    if not isinstance(incoming, dict) or not writable(incoming):
        return incoming
    try:
        current = (await async_get_store(hass)).data
    except ReadFailed:
        return incoming
    if not writable(current):
        return incoming
    from .house3d_library import carried_over  # noqa: PLC0415
    out = carried_over(current, incoming)
    if (isinstance(pieces, dict) and pieces) or not current.get("pieces"):
        return out
    return {**out, "pieces": copy.deepcopy(current["pieces"])}


async def async_restore_absent(hass: HomeAssistant) -> None:
    """Restore a safety backup taken when this file did not exist (the Bright
    import's: ws_common.ABSENT_MARKER): the file goes again, and the cached
    store with it, so the next use reads none. What this house shared to the
    library stays (house3d_library.carried_over): its owner tokens are the only
    way to withdraw those pieces, so with any, the file is kept, empty but for
    them."""
    from homeassistant.helpers.storage import Store  # noqa: PLC0415
    from .house3d_library import carried_over  # noqa: PLC0415
    try:
        current = (await async_get_store(hass)).data
    except ReadFailed:
        current = None
    kept = carried_over(current, empty()) if isinstance(current, dict) else empty()
    st = Store(hass, 1, HOUSE3D_STORE_KEY)
    if ((kept.get("library") or {}).get("submissions")):
        await st.async_save(kept)
    else:
        await st.async_remove()
    hass.data.get(DOMAIN, {}).pop(DATA_HOUSE3D, None)


# ── People figures and beacon and scanner looks (P6) ──────────────────────────
# figures: {"person.<name>": {"params": FIGURE's settings, "origin": photo |
# build}}, kept only in this file and its backups: never shared, never sent,
# never in telemetry. A figure goes when it is removed here (None), or when its
# person is deleted in Home Assistant (house3d_people.py); a person merely
# missing from the states never removes it (the screen shows that one as unlinked).
# devices: besides a 3D-only height ({z_m}, the 3D editor's), an entry can
# carry a look, {recipe, library_id, submission_id}, keyed by the id PadSpan
# tracks the beacon or scanner by ("ble:<address>", a scanner's address). A
# look is removed with {"recipe": None}, which keeps the height; None alone
# is still the editor's "back to the default height", which keeps the look.
_FIGURE_OWNED = frozenset(("params", "origin"))
_LOOK_OWNED = frozenset(("recipe", "library_id", "submission_id"))
DEVICE_KEY = re.compile(r"[A-Za-z0-9_.:-]{1,96}")
_LINK_ID = re.compile(r"[A-Za-z0-9_-]{1,64}")
_KIND = re.compile(r"[a-z0-9_]{1,40}")
_RECIPE_KEYS = frozenset(("kind", "params", "colors", "width_m", "depth_m", "height_m", "details"))
LOOK_SIZE_M = (0.001, 8.0)
_SHORT = 60


def _figure_params(key: str, p: Any) -> dict:
    """FIGURE's settings (house3d_builders, from the builders): numbers
    clamped, choices and yes/no checked, a "#rrggbb" for each part; a setting
    left out is its default, one FIGURE doesn't have is refused."""
    from . import house3d_builders as B  # noqa: PLC0415
    fig = B.data()["figure"]
    specs = {s["key"]: s for s in fig.get("params") or [] if isinstance(s, dict) and isinstance(s.get("key"), str)}
    names = dict(fig.get("colors") or {})
    if not isinstance(p, dict):
        raise EditError(f"{key}: params must be an object")
    extra = sorted(set(p) - set(specs) - {"colors"}, key=str)
    if extra:
        raise EditError(f"{key}: a figure has no setting {str(extra[0])[:40]!r}")
    out: dict[str, Any] = {}
    for k, s in specs.items():
        v, t = p.get(k, s.get("def")), s.get("type")
        if t in ("int", "num"):
            if isinstance(v, str) or B.number(v) is None:
                raise EditError(f"{key} {k} must be a number")
            out[k] = B.clamp_param(s, v)
        elif t == "choice":
            if not B.is_choice(s, v):
                raise EditError(f"{key} {k} must be one of {', '.join(map(str, B.choices_of(s)))}")
            out[k] = v
        elif t == "bool":
            if not isinstance(v, bool):
                raise EditError(f"{key} {k} must be true or false")
            out[k] = v
    cols = p.get("colors", {})
    if not isinstance(cols, dict) or set(cols) - set(names):
        raise EditError(f"{key}: a figure's colors are {', '.join(names)}")
    out["colors"] = {}
    for n, default in names.items():
        c = B.hex_colour(cols.get(n, default))
        if c is None:
            raise EditError(f"{key} {n} colour must be #rrggbb")
        out["colors"][n] = c
    return out


def _figure_entry(key: str, e: Any) -> tuple[frozenset, dict | None, bool]:
    if len(key) > 255 or not key.startswith("person.") or not ENTITY_ID.fullmatch(key):
        raise EditError(f"figures: {key[:48]!r} is not a person (person.<name>)")
    if e is None:
        return _FIGURE_OWNED, None, True          # removing a figure removes all of it
    if not isinstance(e, dict) or set(e) != _FIGURE_OWNED:
        raise EditError(f"{key}: a figure is {{params, origin}}")
    return _FIGURE_OWNED, {"params": _figure_params(key, e["params"]),
                           "origin": _pick(e["origin"], ("photo", "build"), f"{key} origin")}, True


def _simple(v: Any, depth: int = 0) -> bool:
    """Plain, small data: what a recipe's settings and details may hold."""
    if v is None or isinstance(v, bool):
        return True
    if isinstance(v, (int, float)):
        try:
            return math.isfinite(v)
        except OverflowError:
            return False
    if isinstance(v, str):
        return len(v) <= _SHORT
    if isinstance(v, list) and depth < 2:
        return len(v) <= 16 and all(_simple(x, depth + 1) for x in v)
    return False


def _look_recipe(key: str, r: Any) -> dict:
    """A beacon's or scanner's look: a recipe (contracts §1), plain data. An
    unknown kind is kept (it draws as a box); the builders read the rest."""
    if not isinstance(r, dict) or set(r) - _RECIPE_KEYS:
        raise EditError(f"{key}: a recipe has only {', '.join(sorted(_RECIPE_KEYS))}")
    kind = r.get("kind")
    if not isinstance(kind, str) or not _KIND.fullmatch(kind):
        raise EditError(f"{key}: recipe kind must be a builder's kind")
    params = r.get("params", {})
    if (not isinstance(params, dict) or len(params) > 40
            or not all(isinstance(k, str) and len(k) <= 40 and _simple(v, 2) for k, v in params.items())):
        raise EditError(f"{key}: recipe params must be at most 40 plain settings")
    colours = r.get("colors")
    if not isinstance(colours, list) or not 1 <= len(colours) <= 6 or not all(
            isinstance(c, str) and re.fullmatch(r"#[0-9a-f]{6}", c) for c in colours):
        raise EditError(f"{key}: recipe colors must be 1 to 6 \"#rrggbb\"")
    out: dict[str, Any] = {"kind": kind, "params": dict(params), "colors": list(colours)}
    for k in ("width_m", "depth_m", "height_m"):
        out[k] = _num(r.get(k), *LOOK_SIZE_M, f"{key} {k}")
    if "details" in r:
        d = r["details"]
        if not isinstance(d, dict) or len(d) > 40 or not all(
                isinstance(k, str) and len(k) <= 40 and _simple(v) for k, v in d.items()):
            raise EditError(f"{key}: recipe details must be at most 40 plain fields")
        out["details"] = dict(d)
    return out


def _device_entry(key: str, e: Any) -> tuple[frozenset, dict | None, bool]:
    """A device's 3D-only height (the 3D editor's, keyed by entity id), and/or
    a beacon's or scanner's look (keyed by the id PadSpan tracks it by)."""
    look = isinstance(e, dict) and "recipe" in e
    if len(key) > 255 or not (ENTITY_ID.fullmatch(key) or (look and DEVICE_KEY.fullmatch(key))):
        raise EditError(f"devices: {key[:48]!r} is not an entity id" + (" or a tracked id" if look else ""))
    if e is None:
        return _HEIGHT_OWNED, None, False
    if not isinstance(e, dict) or not e or set(e) - _HEIGHT_OWNED - _LOOK_OWNED or (
            not look and set(e) & _LOOK_OWNED):
        raise EditError(f"{key}: a device has a height {{z_m}} and/or a look {{recipe, library_id, submission_id}}")
    clean: dict[str, Any] = {}
    if "z_m" in e:
        clean["z_m"] = _num(e["z_m"], 0.0, HEIGHT_MAX_M, f"{key} z_m")
    if look and e["recipe"] is not None:
        clean["recipe"] = _look_recipe(key, e["recipe"])
        for k in ("library_id", "submission_id"):
            v = e.get(k)
            if v is not None and not (isinstance(v, str) and _LINK_ID.fullmatch(v)):
                raise EditError(f"{key}: {k} must be an id or null")
            clean[k] = v
    elif look and set(e) & {"library_id", "submission_id"}:
        raise EditError(f"{key}: a look removed (recipe null) takes no library_id or submission_id")
    owned = frozenset(e) | (_LOOK_OWNED if look else frozenset())
    return owned, clean or None, False


_OWN_ENTRY = {"figures": _figure_entry, "devices": _device_entry}


async def async_get_store(hass: HomeAssistant) -> House3dStore:
    """The store, loaded on first use and kept in hass.data. Loading reads the
    file; it never writes it. One first load at a time: two at once made two
    stores, and a Save through the one replaced was lost to the next. A read
    that fails (ReadFailed) keeps nothing, so the next use reads again."""
    dom = hass.data.setdefault(DOMAIN, {})
    store = dom.get(DATA_HOUSE3D)
    if isinstance(store, House3dStore):
        return store
    async with dom.setdefault(_LOAD_LOCK, asyncio.Lock()):
        store = dom.get(DATA_HOUSE3D)
        if not isinstance(store, House3dStore):
            store = House3dStore(hass)
            await store.async_load()
            dom[DATA_HOUSE3D] = store
    return store
