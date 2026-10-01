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
older and a newer PadSpan never lose what the other wrote.
"""

from __future__ import annotations

import copy
import math
import re
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_HOUSE3D, DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from .safe_store import wrap_store

SCHEMA = 1
# The keyed sections (docs: pieces, 3D-only light heights, door hinge and swing,
# beacon/scanner recipes, people figures). "library" holds the terms acceptance.
SECTIONS: tuple[str, ...] = ("pieces", "lights", "openings", "devices", "figures")


def empty() -> dict[str, Any]:
    """The file's content for a house with nothing in 3D yet."""
    return {"schema": SCHEMA, **{k: {} for k in SECTIONS}, "library": {}}


def normalise(raw: Any) -> dict[str, Any]:
    """Tolerant read: every key in `raw` is kept; a missing or broken section
    becomes empty; anything that is not a dict is an empty house."""
    if not isinstance(raw, dict):
        return empty()
    out = dict(raw)
    out.setdefault("schema", SCHEMA)
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


class House3dStore:
    """padspan_ha.house3d. `.data` is what a PadSpan backup saves and a
    restore replaces (ws_common._DATA_KEY_MAP)."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self._raw_store = Store(hass, 1, HOUSE3D_STORE_KEY)
        self.store = wrap_store(self._raw_store, hass, "house3d")
        self._data: dict[str, Any] = empty()

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
        self.data = normalise(await self.store.async_load())
        return self.data

    async def async_save(self) -> bool:
        return bool(await self.store.async_save(self.data))

    async def async_clear(self) -> bool:
        self.data = empty()
        return await self.async_save()

    def counts(self) -> dict[str, int]:
        return {k: len(self.data.get(k) or {}) for k in SECTIONS}


# ── The 3D editor's Save (ws_house3d.house3d_edit) ───────────────────────────
# One draft, written at once: doors and windows drawn on a wall in 3D
# ("win_" / "door_" + 8 hex digits, a stretch of wall in fabric metres), the
# hinge, swing, sill and head of a barrier's own door or window (keyed by the
# barrier's id; the map is never written), and the 3D-only height of a light
# or another device. Each entry is set, or removed with None. What the editor
# owns is checked strictly; every other key already in the file (a newer
# PadSpan's) is kept.
EDIT_SECTIONS: tuple[str, ...] = ("openings", "lights", "devices")
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
_CAPS = {"openings": MAX_OPENINGS, "lights": MAX_HEIGHTS, "devices": MAX_HEIGHTS}


class EditError(ValueError):
    """An edit that cannot be saved; nothing of it is written."""


def _num(v: Any, lo: float, hi: float, what: str) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not lo <= v <= hi:
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
    if section == "openings":
        if OPENING_ID.match(key):
            owned, whole, check = _ADDED_OWNED, True, _added_opening
        elif key.startswith(("win_", "door_")) or not BARRIER_ID.match(key):
            raise EditError(f"openings: {key[:48]!r} is neither win_/door_ + 8 hex digits nor a barrier's id")
        else:
            owned, whole, check = _BARRIER_OWNED, False, _barrier_override
    else:
        if len(key) > 255 or not ENTITY_ID.match(key):
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
    refused or failed save leaves the file and the memory as they were."""
    if not isinstance(changes, dict) or set(changes) - set(EDIT_SECTIONS):
        raise EditError(f"an edit has only {', '.join(EDIT_SECTIONS)}")
    out = copy.deepcopy(normalise(data))
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


async def async_get_store(hass: HomeAssistant) -> House3dStore:
    """The store, loaded on first use and kept in hass.data. Loading reads the
    file; it never writes it."""
    dom = hass.data.setdefault(DOMAIN, {})
    store = dom.get(DATA_HOUSE3D)
    if not isinstance(store, House3dStore):
        store = House3dStore(hass)
        await store.async_load()
        dom[DATA_HOUSE3D] = store
    return store
