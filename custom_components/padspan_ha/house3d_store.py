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
import logging
import math
import re
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_HOUSE3D, DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from .safe_store import wrap_store

_LOGGER = logging.getLogger(__name__)

SCHEMA = 1
# The keyed sections (docs: pieces, 3D-only light heights, door hinge and swing,
# beacon/scanner recipes, people figures). "library" holds the terms acceptance.
SECTIONS: tuple[str, ...] = ("pieces", "lights", "openings", "devices", "figures")
_LOAD_LOCK = "house3d_load_lock"   # hass.data[DOMAIN]: one first load at a time
NEWER_MESSAGE = ("This 3D house was saved by a newer PadSpan. This version shows it but does not "
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
# One draft, written at once: doors and windows drawn on a wall in 3D
# ("win_" / "door_" + 8 hex digits, a stretch of wall in fabric metres), the
# hinge, swing, sill and head of a barrier's own door or window (keyed by the
# barrier's id; the map is never written), and the 3D-only height of a light
# or another device. Each entry is set, or removed with None. What the editor
# owns is checked strictly; every other key already in the file (a newer
# PadSpan's) is kept.
EDIT_SECTIONS: tuple[str, ...] = ("openings", "lights", "devices", "figures")
OPENING_ID = re.compile(r"^(win|door)_[0-9a-f]{8}$")
BARRIER_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,40}$")
# Home Assistant's own entity id shape (core.valid_entity_id).
ENTITY_ID = re.compile(r"^(?!.+__)(?!_)[\da-z_]+(?<!_)\.(?!_)[\da-z_]+(?<!_)$")
WINDOW_MIN_M, DOOR_MIN_M, OPENING_MAX_M = 0.3, 0.6, 50.0
DOOR_MIN_HEAD_M, HEIGHT_MAX_M, GAP_MIN_M = 0.5, 10.0, 0.1
COORD_MAX_M = 10_000.0
MAX_OPENINGS, MAX_HEIGHTS, MAX_CHANGES = 500, 2000, 1000
_ADDED_KEYS = {"window": ("kind", "floor_id", "a_m", "b_m", "sill_m", "head_m"),
               "door": ("kind", "floor_id", "a_m", "b_m", "head_m", "hinge", "swing")}
_ADDED_OWNED = frozenset(_ADDED_KEYS["window"] + _ADDED_KEYS["door"])
_BARRIER_OWNED = frozenset(("hinge", "swing", "sill_m", "head_m"))
_HEIGHT_OWNED = frozenset(("z_m",))
_CAPS = {"openings": MAX_OPENINGS, "lights": MAX_HEIGHTS, "devices": MAX_HEIGHTS, "figures": 50}


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
    """A door or window drawn in 3D: complete, in range, and of its id's kind."""
    kind = "window" if oid.startswith("win_") else "door"
    want = _ADDED_KEYS[kind]
    if set(e) != set(want):
        raise EditError(f"{oid}: a {kind} has exactly {', '.join(want)}")
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
    lo = WINDOW_MIN_M if kind == "window" else DOOR_MIN_M
    if not lo - 1e-6 <= math.dist(*pts) <= OPENING_MAX_M:
        raise EditError(f"{oid}: a {kind} is {lo:g} m to {OPENING_MAX_M:g} m wide")
    out = {"kind": kind, "floor_id": fl.strip(), "a_m": pts[0], "b_m": pts[1]}
    if kind == "window":
        sill = _num(e["sill_m"], 0.0, HEIGHT_MAX_M, f"{oid} sill_m")
        head = _num(e["head_m"], 0.0, HEIGHT_MAX_M, f"{oid} head_m")
        if head < sill + GAP_MIN_M - 1e-9:
            raise EditError(f"{oid}: the head must be above the sill")
        out.update(sill_m=sill, head_m=head)
    else:
        out.update(head_m=_num(e["head_m"], DOOR_MIN_HEAD_M, HEIGHT_MAX_M, f"{oid} head_m"),
                   hinge=_pick(e["hinge"], ("left", "right"), f"{oid} hinge"),
                   swing=_pick(e["swing"], ("in", "out"), f"{oid} swing"))
    return out


def _barrier_override(bid: str, e: dict) -> dict:
    """A barrier's door or window in 3D only: any of hinge, swing, sill, head."""
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
    if "sill_m" in out and "head_m" in out and out["head_m"] < out["sill_m"] + GAP_MIN_M - 1e-9:
        raise EditError(f"{bid}: the head must be above the sill")
    return out


def _entry(section: str, key: Any, e: Any) -> tuple[frozenset, dict | None, bool]:
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
        elif key.startswith(("win_", "door_")) or not BARRIER_ID.fullmatch(key):
            raise EditError(f"openings: {key[:48]!r} is neither win_/door_ + 8 hex digits nor a barrier's id")
        else:
            owned, whole, check = _BARRIER_OWNED, False, _barrier_override
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
    n = 0
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
            owned, clean, whole = _entry(section, key, e)
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
    return out


# ── People figures and beacon and scanner looks (P6) ──────────────────────────
# figures: {"person.<name>": {"params": FIGURE's settings, "origin": photo |
# build}}, kept only in this file and its backups: never shared, never sent,
# never in telemetry. A figure goes only when it is removed here (None), never
# because its person is gone: the screen shows that one as unlinked.
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
