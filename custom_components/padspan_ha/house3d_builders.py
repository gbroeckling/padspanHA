# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard: the builders' settings, as data the server can read.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("From a photo", "Beacons, scanners and
people from photos"). The builders are browser code
(views/live_aboard_furniture.js: FURNITURE_KINDS, FURNITURE, FIGURE). The
server needs their lists too: the photo step asks the AI Task for exactly a
builder's settings and clamps what comes back to their ranges, and a people
figure is checked against FIGURE before it is saved. So the lists ship as
data, live_aboard_builders.json, written from the module itself
(node tests/js/live_aboard_builders_data.mjs <www/padspan-ha> --write) and
held equal to it by tests/test_house3d_photo.py: one source, never two
hand-kept copies. Read once, in the executor, on first use.

The clamps read a value exactly the way the builders' own clampRecipe does
(tests/test_house3d_photo.py runs the same recipes through both): a number
into its range (rounded for "int"), a choice from its list, a yes/no, a
colour "#rrggbb"; anything unreadable is the default. Unknown kinds and
settings are kept, as everywhere in the 3D file; an unknown kind is a box.
"""

from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path
from typing import Any

_FILE = Path(__file__).with_name("live_aboard_builders.json")
_HEX = re.compile(r"#[0-9a-f]{6}")
_HEX3 = re.compile(r"#[0-9a-f]{3}")
BOX_KIND = "other"                    # the builders' box: what no builder fits
DIMS = ("width_m", "depth_m", "height_m")
_BOX_SIZE = {"width_m": [0.05, 6, 0.6], "depth_m": [0.05, 6, 0.6], "height_m": [0.02, 4, 0.6]}
_BOX_COLOR = "#9aa3ab"
_cache: dict[str, Any] | None = None


def _read() -> dict[str, Any]:
    try:
        raw = json.loads(_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = None
    raw = raw if isinstance(raw, dict) else {}
    fur = raw.get("furniture") if isinstance(raw.get("furniture"), dict) else {}
    fur = {k: v for k, v in fur.items() if isinstance(v, dict)}
    kinds = [k for k in (raw.get("kinds") or []) if isinstance(k, str) and k in fur]
    fig = raw.get("figure") if isinstance(raw.get("figure"), dict) else {}
    return {"kinds": kinds, "furniture": fur, "figure": fig}


def data() -> dict[str, Any]:
    """{kinds (the Build menu), furniture (every kind), figure}, read on first use."""
    global _cache  # noqa: PLW0603
    if _cache is None:
        _cache = _read()
    return _cache


async def async_data(hass) -> dict[str, Any]:
    """data(), the first read in the executor (no file read in the loop)."""
    global _cache  # noqa: PLW0603
    if _cache is None:
        _cache = await hass.async_add_executor_job(_read)
    return _cache


def kinds_of(groups: tuple[str, ...]) -> list[str]:
    """Every kind in these builder groups: the Build menu's order first, then
    the rest (tags and scanners are not in the menu) in the builders' order."""
    d = data()
    order = [*d["kinds"], *(k for k in d["furniture"] if k not in d["kinds"])]
    return [k for k in order if d["furniture"][k].get("group") in groups]


def hex_colour(v: Any) -> str | None:
    """"#rrggbb" from "#RRGGBB" or "#rgb" (spaces trimmed); None otherwise."""
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    if _HEX3.fullmatch(s):
        s = "#" + "".join(c * 2 for c in s[1:])
    return s if _HEX.fullmatch(s) else None


def number(v: Any) -> float | None:
    """A finite number from a number, or from text that is one (the builders'
    toNum); None otherwise. True and False are not numbers."""
    if isinstance(v, str):
        if not v.strip():
            return None
        try:
            v = float(v.strip())
        except ValueError:
            return None
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _js_round(f: float) -> int:
    return math.floor(f + 0.5)       # JavaScript's Math.round, not Python's half-to-even


def choices_of(p: dict) -> list:
    return list(p.get("choices") or [])


def _same(a: Any, b: Any) -> bool:
    """JavaScript's includes(): numbers by value, true never 1, text as text."""
    if isinstance(a, bool) or isinstance(b, bool):
        return a is b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return type(a) is type(b) and isinstance(a, str) and a == b


def is_choice(p: dict, v: Any) -> bool:
    return any(_same(c, v) for c in choices_of(p))


def clamp_param(p: dict, v: Any) -> Any:
    """One builder setting read the builders' way; unreadable = its default."""
    t, d = p.get("type"), p.get("def")
    if t == "choice":
        ch = choices_of(p)
        if is_choice(p, v):
            return v
        s = v.strip().lower() if isinstance(v, str) else None
        return s if s is not None and s in ch else d
    if t == "bool":
        if isinstance(v, bool):
            return v
        if v == "true" or v == "1" or (isinstance(v, (int, float)) and v == 1):
            return True
        if v == "false" or v == "0" or (isinstance(v, (int, float)) and v == 0):
            return False
        return d
    if t in ("int", "num"):
        f = number(v)
        if f is None:
            return d
        lo, hi = number(p.get("min")), number(p.get("max"))
        if lo is not None:
            f = max(f, lo)
        if hi is not None:
            f = min(f, hi)
        return _js_round(f) if t == "int" else f
    return v


def _clamp_size(v: Any, rng: list) -> float:
    f = number(v)
    return rng[2] if f is None else min(rng[1], max(rng[0], f))


def _clamp_colours(want: list, v: Any) -> list[str]:
    src = v if isinstance(v, list) else []
    out = [hex_colour(src[i]) if i < len(src) and hex_colour(src[i]) else c for i, c in enumerate(want)]
    out += [c for c in (hex_colour(x) for x in src[len(want):]) if c]
    if not out:
        box = data()["furniture"].get(BOX_KIND) or {}
        out.append((box.get("colors") or [_BOX_COLOR])[0])
    return out


def clamp_recipe(recipe: Any) -> dict[str, Any]:
    """A tolerant copy of a recipe (contracts §1, the builders' clampRecipe):
    its kind's settings, colours and sizes read the builders' way; unknown
    kinds, settings and keys kept; an unknown kind keeps the box's sizes."""
    src = recipe if isinstance(recipe, dict) else {}
    out = copy.deepcopy(src)
    fur = data()["furniture"]
    raw = src["kind"].strip() if isinstance(src.get("kind"), str) and src["kind"].strip() else BOX_KIND
    spec = fur.get(raw.lower())
    out["kind"] = raw.lower() if spec else raw
    given = src.get("params") if isinstance(src.get("params"), dict) else {}
    params = copy.deepcopy(given)
    for p in (spec or {}).get("params") or []:
        params[p["key"]] = clamp_param(p, given.get(p["key"]))
    out["params"] = params
    out["colors"] = _clamp_colours(list((spec or {}).get("colors") or []), src.get("colors"))
    size = (spec or {}).get("size") or (fur.get(BOX_KIND) or {}).get("size") or _BOX_SIZE
    for k in DIMS:
        out[k] = _clamp_size(src.get(k), size[k])
    return out


def recipe_defaults(kind: str) -> dict[str, Any]:
    """A complete recipe with every default (the builders' defaultRecipe)."""
    return clamp_recipe({"kind": kind})


def figure_colour_names() -> list[str]:
    cols = data()["figure"].get("colors")
    return list(cols) if isinstance(cols, dict) else []


def clamp_figure(params: Any) -> dict[str, Any]:
    """A people figure's settings read the builders' way (FIGURE): its own
    settings only, and a colour for each of its parts."""
    src = params if isinstance(params, dict) else {}
    fig = data()["figure"]
    out: dict[str, Any] = {p["key"]: clamp_param(p, src.get(p["key"])) for p in fig.get("params") or []}
    cols = src.get("colors") if isinstance(src.get("colors"), dict) else {}
    out["colors"] = {k: hex_colour(cols.get(k)) or c for k, c in (fig.get("colors") or {}).items()}
    return out
