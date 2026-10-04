# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard P3 and P6: a photo read by the customer's own AI Task.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("From a photo", "Beacons, scanners and
people from photos"). One command, house3d_from_photo:

- In: what the photo is (target: furniture, tag, scanner or person), the
  photo (base64 JPEG, PNG or WebP, at most MAX_PHOTO_BYTES) and, optionally,
  the kind the person says it is. Without a photo it only says whether the
  photo step can run and which AI Task would read it (local or cloud).
- It calls Home Assistant's own ai_task.generate_data on the AI Task chosen
  in Settings (atlas_3d_ai_task_entity), with a fixed prompt, the photo as an
  attachment and a structure: Home Assistant's field list (selectors), flat,
  built from the builders' own settings (house3d_builders, from
  views/live_aboard_furniture.js) and the library's details sheet.
- Out: the answer checked and clamped to the builders' ranges: a recipe
  (contracts §1) with its details sheet and the AI's own sizes and how sure it
  was, or a person's figure settings. A bad or empty answer, or an AI Task
  that fails, is a plain "couldn't read it" result (ok: false) the screen
  falls back from to Build with the kind picked, or a box; never an error.

It stores nothing. The photo goes browser → Home Assistant → the chosen AI
Task and is then dropped. Home Assistant hands an attachment to the AI Task
as a file a media source resolves, so for the call only the photo is a file
in a new hidden folder (a random name, owner-only) in Home Assistant's first
media folder, which the media browser does not list; it is removed in
`finally`, whether the call worked, failed or was cancelled. It is never
logged and never sent anywhere else.

Refused (nothing read, nothing sent): while off and below Pro (as if off),
as ws_house3d.py; no_ai_task when no AI Task is chosen, it is not there, it
cannot read photos, or Home Assistant is older than 2025.8 (the release that
added structure and attachments to ai_task.generate_data). The gate is light
placement's (any user, no admin) inside the Pro-only feature, as
house3d_edit; choosing the AI Task is an administrator's setting
(ws_settings), since a cloud one sends the photo out of the house.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import re
import secrets
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from . import house3d_builders as B
from .const import DATA_SETTINGS, DOMAIN
from .house3d_store import enabled
from .ws_common import _tier_at_least
from .ws_house3d import OFF_CODE, OFF_MESSAGE, PRO_MESSAGE

_LOGGER = logging.getLogger(__name__)

TARGETS: tuple[str, ...] = ("furniture", "tag", "scanner", "person")
# The builder groups each target reads into (contracts §3).
_GROUPS = {"furniture": ("furniture", "device"), "tag": ("tag",), "scanner": ("scanner",)}
MIN_HA = (2025, 8)
MAX_PHOTO_BYTES = 2 * 1024 * 1024     # the screen sends a ≤1280 px JPEG, far under this
PHOTO_TIMEOUT_S = 240                 # a local vision model on a CPU is slow
_MIME = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_FOLDER = ".padspan_ha_photo_"
_SUPPORTS = 1 | 2                     # AITaskEntityFeature GENERATE_DATA | SUPPORT_ATTACHMENTS
# Where an AI Task runs, by its integration, for the screen's note (anything
# else: "if it runs in the cloud, the photo leaves the house").
_LOCAL = frozenset({"ollama"})
_CLOUD = frozenset({"openai_conversation", "google_generative_ai_conversation", "anthropic", "cloud",
                    "open_router", "openrouter", "mistral_ai", "azure_openai_conversation", "groq", "xai"})

NO_AI_CODE = "no_ai_task"
_SETTINGS_PATH = "Settings → UI Structure → Atlas → 3D house"
NO_AI_CHOSEN = (f"No AI Task is chosen to read photos. It needs Home Assistant 2025.8 or newer with an AI "
                f"Task (from an AI integration such as Ollama, OpenAI or Google), chosen in {_SETTINGS_PATH}.")
NO_AI_OLD = "Reading photos needs Home Assistant 2025.8 or newer. Update Home Assistant to use it."
NO_AI_SERVICE = ("Home Assistant's AI Task isn't running. Add an AI integration that makes an AI Task "
                 f"(such as Ollama, OpenAI or Google), then choose it in {_SETTINGS_PATH}.")
NO_AI_GONE = "The AI Task chosen for photos ({eid}) isn't in Home Assistant any more. Choose another in " + _SETTINGS_PATH + "."
NO_AI_BLIND = ("The AI Task chosen for photos ({name}) can't read pictures. Choose one with a vision model in "
               + _SETTINGS_PATH + ".")
BAD_ANSWER = "Couldn't read it: the AI Task's answer didn't describe it. Build it with the sliders instead."
FAILED = "Couldn't read it: the AI Task didn't answer ({why}). Try again, or build it with the sliders."
NO_MEDIA = ("Couldn't read it: Home Assistant's media folder couldn't take the photo for the AI Task. "
            "Build it with the sliders instead.")

# ── The library's details sheet (plan: "The details sheet"), the parts the AI
# fills in from the photo. Colour family and size class are worked out from
# the recipe, and title, brand and model are checked again before any share
# (the library's screen and server), so nothing here is final.
CATEGORIES = ("seating", "sleeping", "tables", "storage", "lighting", "media", "decor", "outdoor", "appliance",
              "kids", "pets", "office", "bath", "kitchen", "device", "other")
ROOMS = ("living", "bedroom", "kids_room", "kitchen", "dining", "office", "bathroom", "hallway", "garage",
         "patio", "any")
STYLES = ("modern", "mid-century", "traditional", "rustic", "industrial", "scandinavian", "farmhouse",
          "minimalist", "boho", "coastal", "glam", "retro", "other")
MATERIALS = ("wood", "fabric", "leather", "metal", "glass", "plastic", "stone", "rattan", "mixed")
FEATURES = ("has_arms", "reclines", "sectional", "sofa_bed", "storage", "on_wheels", "foldable",
            "adjustable_height", "wall_mounted")
BED_SIZES = ("twin", "double", "queen", "king", "crib", "bunk")
FIXTURES = ("floor", "table", "desk", "pendant", "wall", "strip")
CONFIDENCE = ("high", "medium", "low")
_COUNTED = frozenset({"storage", "tables", "office", "kitchen", "bath", "media", "kids"})
TITLE_MIN, TITLE_MAX = 3, 60
_CTRL = re.compile(r"[\x00-\x1f\x7f]+")


def _ha_version() -> tuple[int, int] | None:
    try:
        from homeassistant.const import MAJOR_VERSION, MINOR_VERSION  # noqa: PLC0415
        return int(MAJOR_VERSION), int(MINOR_VERSION)
    except Exception:  # noqa: BLE001
        return None


def _platform(hass: HomeAssistant, eid: str) -> str | None:
    try:
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        ent = er.async_get(hass).async_get(eid)
        p = getattr(ent, "platform", None)
        return p if isinstance(p, str) else None
    except Exception:  # noqa: BLE001
        return None


def ai_task(hass: HomeAssistant) -> dict[str, Any]:
    """The AI Task that would read a photo: {ready: True, ai_task, name,
    local (True, False, or None when unknown)}, or {ready: False, message}."""
    v = _ha_version()
    if v is None or v < MIN_HA:
        return {"ready": False, "message": NO_AI_OLD}
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    eid = str(((st.data if st else {}) or {}).get("atlas_3d_ai_task_entity") or "").strip()
    if not eid.startswith("ai_task."):
        return {"ready": False, "message": NO_AI_CHOSEN}
    try:
        has = bool(hass.services.has_service("ai_task", "generate_data"))
    except Exception:  # noqa: BLE001
        has = False
    if not has:
        return {"ready": False, "message": NO_AI_SERVICE}
    state = hass.states.get(eid)
    if state is None:
        return {"ready": False, "message": NO_AI_GONE.format(eid=eid)}
    attrs = getattr(state, "attributes", None) or {}
    name = str(attrs.get("friendly_name") or eid)
    feats = attrs.get("supported_features")
    if isinstance(feats, int) and not isinstance(feats, bool) and feats & _SUPPORTS != _SUPPORTS:
        return {"ready": False, "message": NO_AI_BLIND.format(name=name)}
    plat = _platform(hass, eid)
    local = True if plat in _LOCAL else False if plat in _CLOUD else None
    return {"ready": True, "ai_task": eid, "name": name, "local": local}


# ── what is asked ────────────────────────────────────────────────────────────

def _sel_select(options, *, multiple: bool = False) -> dict:
    cfg: dict[str, Any] = {"options": [str(o) for o in options]}
    if multiple:
        cfg["multiple"] = True
    return {"select": cfg}


def _sel_number(lo: float, hi: float, step: float | None = None) -> dict:
    cfg: dict[str, Any] = {"min": lo, "max": hi, "mode": "box"}
    cfg["step"] = step if isinstance(step, (int, float)) and step >= 0.001 else "any"
    return {"number": cfg}


def _field(desc: str, selector: dict, *, required: bool = False) -> dict:
    out: dict[str, Any] = {"description": desc, "selector": selector}
    if required:
        out["required"] = True
    return out


def _param_field(p: dict, owner: str) -> dict | None:
    t, label = p.get("type"), str(p.get("label") or p.get("key"))
    desc = f"{label} ({owner})"
    if t in ("int", "num"):
        lo, hi = B.number(p.get("min")), B.number(p.get("max"))
        if lo is None or hi is None or hi < lo:
            return None
        step = B.number(p.get("step")) or (1 if t == "int" else None)
        return _field(desc, _sel_number(lo, hi, 1 if t == "int" else step), required=True)
    if t == "choice":
        opts = B.choices_of(p)
        return _field(desc, _sel_select(opts), required=True) if opts else None
    if t == "bool":
        return _field(desc, {"boolean": {}}, required=True)
    return None


def _size_ranges(kinds: list[str]) -> dict[str, tuple[float, float]]:
    """Each size's range over these kinds (the union: the AI is not told one
    kind's limits before it has said what it is)."""
    out = {}
    fur = B.data()["furniture"]
    for key in ("width_m", "depth_m", "height_m"):
        lo, hi = None, None
        for k in kinds:
            rng = (fur[k].get("size") or {}).get(key)
            if isinstance(rng, (list, tuple)) and len(rng) == 3:
                a, b = B.number(rng[0]), B.number(rng[1])
                if a is not None and b is not None:
                    lo, hi = (a if lo is None else min(lo, a)), (b if hi is None else max(hi, b))
        out[key] = (lo, hi) if lo is not None else B.SIZE_ANY_M
    return out


_PROMPT = {
    "furniture": (
        "The photo shows one piece of furniture or one household appliance in a home. Describe the main "
        "piece (the one nearest the middle of the photo) so PadSpan can draw a simple 3D model of it from "
        "a few settings. Answer every field from what you can see.{kind} Colours: up to three main colours "
        "as #rrggbb, the largest area first. Sizes are in metres: width_m across the front from side to "
        "side, depth_m from front to back, height_m from the floor to the highest point. size_confidence: "
        "high only when something of known size is in the photo to judge the scale by (a tape measure, a "
        "door frame, a standard chair), otherwise medium or low. Details: the rooms it suits, its style, its "
        "main material, its features, and a short plain title such as \"Three-seat grey sofa, slim arms\" "
        "(no names of people, places or brands)."),
    "tag": (
        "The photo shows one small Bluetooth tag or tracker: a keyring tag, a card, a fob, a coin-shaped "
        "puck or a phone. Describe it so PadSpan can draw a small 3D model of it.{kind} Colours: up to three "
        "main colours as #rrggbb, the largest area first. Sizes are in metres (a tag is a few centimetres): "
        "width_m side to side, depth_m front to back, height_m its thickness. size_confidence: high only "
        "when something of known size is in the photo, otherwise medium or low. A short plain title such as "
        "\"White puck tag\" (no names of people or places)."),
    "scanner": (
        "The photo shows one small Bluetooth scanner: an ESP32 or a similar board, bare or in a case. "
        "Describe it so PadSpan can draw a small 3D model of it.{kind} Colours: up to three main colours as "
        "#rrggbb, the largest area first. Sizes are in metres (a few centimetres): width_m side to side, "
        "depth_m front to back, height_m its thickness. size_confidence: high only when something of known "
        "size is in the photo, otherwise medium or low. A short plain title such as \"Black ESP32 box with "
        "antenna\" (no names of people or places)."),
    "person": (
        "The photo shows a person. PadSpan draws a simple cartoon figure for them, never a likeness. Fill in "
        "only the fields: roughly how tall they are in metres, their build, their hair, and the colours as "
        "#rrggbb, each as listed. Do not describe the face, do not guess age, and do not say who the person "
        "is."),
}


def request(target: str, kind: str | None) -> tuple[str, dict[str, dict]]:
    """(instructions, structure) for one photo: Home Assistant's own field
    list, flat, from the builders' settings and the details sheet."""
    if target == "person":
        return _PROMPT["person"], _figure_structure()
    fur = B.data()["furniture"]
    kinds = B.kinds_of(_GROUPS[target])
    if kind not in kinds and len(kinds) == 1:
        kind = kinds[0]           # one kind in the group: there is nothing to ask
    spec = fur.get(kind) if kind in kinds else None
    s: dict[str, dict] = {}
    if spec is None:
        s["kind"] = _field("What it is: the closest kind, or other",
                           _sel_select([*kinds, *([] if B.BOX_KIND in kinds else [B.BOX_KIND])]), required=True)
        ranges = _size_ranges(kinds)
        said = ""
    else:
        name = str(spec.get("name") or kind)
        for p in spec.get("params") or []:
            f = _param_field(p, name) if isinstance(p, dict) and isinstance(p.get("key"), str) else None
            if f:
                s[f"param_{p['key']}"] = f
        ranges = _size_ranges([kind])
        said = f" It is a {name.lower()}."
    for i, what in enumerate(("Main colour", "Second colour", "Third colour, if there is one"), 1):
        s[f"color_{i}"] = _field(f"{what}, #rrggbb", {"text": {}}, required=i == 1)
    for key, what in (("width_m", "Width in metres, across the front"), ("depth_m", "Depth in metres, front to back"),
                      ("height_m", "Height in metres, floor to top")):
        lo, hi = ranges[key]
        s[key] = _field(what, _sel_number(lo, hi, 0.01), required=True)
    s["size_confidence"] = _field("How sure the sizes are: high only with a known-size object in the photo",
                                  _sel_select(CONFIDENCE), required=True)
    s.update(_details_fields(target, spec))
    return _PROMPT[target].format(kind=said), s


def _details_fields(target: str, spec: dict | None) -> dict[str, dict]:
    s: dict[str, dict] = {}
    cat = (spec or {}).get("category")
    if target == "furniture":
        if spec is None:
            s["category"] = _field("Its category", _sel_select(CATEGORIES))
        s["rooms"] = _field("The rooms it suits", _sel_select(ROOMS, multiple=True))
        s["style"] = _field("Its style", _sel_select(STYLES), required=True)
        s["material"] = _field("Its main material", _sel_select(MATERIALS), required=True)
        s["features"] = _field("Its features, any that apply", _sel_select(FEATURES, multiple=True))
        s["outdoor"] = _field("Made for outdoors", {"boolean": {}})
        if cat in (None, "seating"):
            s["seats"] = _field("How many people it seats", _sel_number(1, 8, 1))
        if cat in (None, "sleeping"):
            s["bed_size"] = _field("The bed size", _sel_select(BED_SIZES))
        if cat in (None, "lighting"):
            s["fixture"] = _field("The light's fixture type", _sel_select(FIXTURES))
        if cat == "lighting":
            s["shades"] = _field("How many shades", _sel_number(0, 8, 1))
        if cat in _COUNTED:
            for key, what in (("drawers", "drawers"), ("doors", "doors"), ("shelves", "shelves")):
                s[key] = _field(f"How many {what}", _sel_number(0, 20, 1))
    else:
        s["material"] = _field("Its main material", _sel_select(MATERIALS))
    s["title"] = _field("A short plain title, 3 to 60 characters", {"text": {}}, required=True)
    return s


def _figure_spec() -> dict:
    return B.data()["figure"]


def _figure_structure() -> dict[str, dict]:
    fig = _figure_spec()
    s: dict[str, dict] = {}
    for p in fig.get("params") or []:
        f = _param_field(p, "the figure") if isinstance(p, dict) and isinstance(p.get("key"), str) else None
        if f:
            s[f"param_{p['key']}"] = f
    for name in B.figure_colour_names():
        s[f"color_{name}"] = _field(f"The {name.replace('_', ' ')} colour, #rrggbb", {"text": {}}, required=True)
    return s


# ── what comes back ──────────────────────────────────────────────────────────

def _as_dict(answer: Any) -> dict | None:
    if isinstance(answer, str):
        t = answer.strip()
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
        try:
            answer = json.loads(t)
        except ValueError:
            return None
    return answer if isinstance(answer, dict) else None


def _colour(v: Any) -> str | None:
    """An AI's colour: "#rrggbb", also when it left out the "#"."""
    if isinstance(v, str) and re.fullmatch(r"\s*([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\s*", v):
        v = "#" + v.strip()
    return B.hex_colour(v)


def _title(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    t = " ".join(_CTRL.sub(" ", v).split())[:TITLE_MAX].strip()
    return t if len(t) >= TITLE_MIN else None


def _pick(v: Any, options: tuple[str, ...]) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().lower()
    return s if s in options else None


def _picks(v: Any, options: tuple[str, ...]) -> list[str]:
    vals = v if isinstance(v, list) else [x for x in re.split(r"[,;]", v)] if isinstance(v, str) else []
    out = []
    for x in vals:
        p = _pick(x, options)
        if p and p not in out:
            out.append(p)
    return out


def _count(v: Any, lo: int, hi: int) -> int | None:
    f = B.number(v)
    return None if f is None else int(min(max(round(f), lo), hi))


def _details(target: str, kind: str, spec: dict | None, a: dict, params: dict) -> dict[str, Any]:
    d: dict[str, Any] = {}
    cat = (spec or {}).get("category") or _pick(a.get("category"), CATEGORIES)
    if target in ("tag", "scanner"):
        cat = "device"
    if cat:
        d["category"] = cat
    if target == "furniture":
        rooms = _picks(a.get("rooms"), ROOMS)
        if rooms:
            d["rooms"] = rooms
        for key, opts in (("style", STYLES), ("bed_size", BED_SIZES), ("fixture", FIXTURES)):
            v = _pick(a.get(key), opts)
            if v:
                d[key] = v
        feats = _picks(a.get("features"), FEATURES)
        if feats:
            d["features"] = feats
        if isinstance(a.get("outdoor"), bool):
            d["outdoor"] = a["outdoor"]
        seats = _count(a.get("seats"), 1, 8)
        if seats is not None:
            d["seats"] = seats
        for key, hi in (("shades", 8), ("drawers", 20), ("doors", 20), ("shelves", 20)):
            n = _count(a.get(key), 0, hi)
            if n is not None:
                d[key] = n
    else:
        for key in ("form", "antenna"):
            if key in params:
                d[key] = params[key]
    m = _pick(a.get("material"), MATERIALS)
    if m:
        d["material"] = m
    t = _title(a.get("title"))
    if t:
        d["title"] = t
    d["checked"] = False          # AI-filled: nobody has looked at it yet
    return d


def parse(target: str, kind: str | None, answer: Any) -> dict[str, Any]:
    """The AI's answer, checked and clamped: {ok: True, ...} or, when it
    holds nothing usable, {ok: False, reason: "bad_answer"}."""
    a = _as_dict(answer)
    if target == "person":
        return _parse_figure(a)
    fur = B.data()["furniture"]
    kinds = B.kinds_of(_GROUPS[target])
    bad = {"ok": False, "target": target, "reason": "bad_answer", "message": BAD_ANSWER,
           "kind": kind if kind in kinds else None}
    if a is None:
        return bad
    said = _pick(a.get("kind"), tuple(kinds)) if isinstance(a.get("kind"), str) else None
    if kind in kinds:
        k = kind
    elif said:
        k = said
    elif len(kinds) == 1:
        k = kinds[0]
    else:
        k = B.BOX_KIND
    spec = fur.get(k)
    params: dict[str, Any] = {}
    used = said is not None
    for p in (spec or {}).get("params") or []:
        if isinstance(p, dict) and isinstance(p.get("key"), str):
            raw = a.get(f"param_{p['key']}")
            used = used or _readable(p, raw)
            params[p["key"]] = B.clamp_param(p, raw)
    colours = [c for c in (_colour(a.get(f"color_{i}")) for i in (1, 2, 3)) if c]
    sizes = {key: B.number(a.get(key)) for key in ("width_m", "depth_m", "height_m")}
    used = used or bool(colours) or any(v is not None and v > 0 for v in sizes.values())
    if not used:
        return bad
    recipe = B.clamp_recipe({"kind": k, "params": params, "colors": colours,
                             **{key: v for key, v in sizes.items() if v is not None and v > 0}})
    conf = _pick(a.get("size_confidence"), CONFIDENCE)
    size = {key: (recipe[key] if sizes[key] is not None and sizes[key] > 0 else None) for key in sizes}
    size["confidence"] = conf if any(size[key] is not None for key in sizes) else None
    out = {"ok": True, "target": target, "kind": k, "recipe": recipe,
           "details": _details(target, k, spec, a, recipe["params"]), "size": size}
    return out


def _readable(p: dict, raw: Any) -> bool:
    """Did the AI answer this setting (rather than leave it to the default)?"""
    t = p.get("type")
    if t in ("int", "num"):
        return B.number(raw) is not None
    if t == "choice":
        return B.is_choice(p, raw)
    return t == "bool" and isinstance(raw, bool)


def _parse_figure(a: dict | None) -> dict[str, Any]:
    bad = {"ok": False, "target": "person", "reason": "bad_answer", "message": BAD_ANSWER, "kind": None}
    if a is None:
        return bad
    fig = _figure_spec()
    raw: dict[str, Any] = {}
    used = False
    for p in fig.get("params") or []:
        if isinstance(p, dict) and isinstance(p.get("key"), str):
            v = a.get(f"param_{p['key']}")
            used = used or _readable(p, v)
            raw[p["key"]] = v
    colours = {}
    for name in B.figure_colour_names():
        c = _colour(a.get(f"color_{name}"))
        if c:
            colours[name] = c
            used = True
    if not used:
        return bad
    params = B.clamp_figure({**{k: v for k, v in raw.items() if v is not None}, "colors": colours})
    return {"ok": True, "target": "person", "figure": {"params": params, "origin": "photo"}}


# ── the photo ────────────────────────────────────────────────────────────────

class PhotoError(ValueError):
    """The photo itself can't be used (code, message)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def decode(b64: Any) -> tuple[bytes, str]:
    """(bytes, mime type) of a JPEG, PNG or WebP photo sent as base64 (a
    data: URL prefix allowed), or PhotoError."""
    if not isinstance(b64, str) or not b64.strip():
        raise PhotoError("bad_photo", "No photo came with the request.")
    s = b64.strip()
    if s.startswith("data:"):
        s = s.partition(",")[2]
    if len(s) > (MAX_PHOTO_BYTES * 4) // 3 + 4:
        raise PhotoError("photo_too_big", f"The photo is over {MAX_PHOTO_BYTES // (1024 * 1024)} MB. "
                                          "Take it again, or pick a smaller one.")
    try:
        raw = base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError):
        raise PhotoError("bad_photo", "The photo couldn't be read. Take it again, or pick another.") from None
    if len(raw) > MAX_PHOTO_BYTES:
        raise PhotoError("photo_too_big", f"The photo is over {MAX_PHOTO_BYTES // (1024 * 1024)} MB.")
    if raw[:3] == b"\xff\xd8\xff":
        return raw, "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return raw, "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return raw, "image/webp"
    raise PhotoError("bad_photo", "Only JPEG, PNG or WebP photos can be read.")


def _media_dir(hass: HomeAssistant) -> tuple[str, Path] | None:
    dirs = getattr(hass.config, "media_dirs", None)
    if not isinstance(dirs, dict) or not dirs:
        return None
    key = "local" if "local" in dirs else next(iter(dirs))
    return (key, Path(dirs[key])) if isinstance(key, str) and dirs[key] else None


def _write(folder: Path, path: Path, raw: bytes) -> None:
    """The photo as an owner-only file in a new owner-only folder. The media
    folder itself must be there already: nothing else is created."""
    folder.mkdir(mode=0o700)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(raw)


def _remove(folder: Path, path: Path) -> None:
    for step in (lambda: path.unlink(missing_ok=True), folder.rmdir):
        try:
            step()
        except FileNotFoundError:
            pass
        except OSError as err:
            _LOGGER.warning("PadSpan Live Aboard: couldn't remove the photo's temporary file: %s",
                            type(err).__name__)


class _NoMedia(Exception):
    pass


async def ask(hass: HomeAssistant, eid: str, instructions: str, structure: dict, raw: bytes, mime: str) -> Any:
    """One ai_task.generate_data call with the photo; the answer's data. The
    photo's file exists only for the call."""
    media = _media_dir(hass)
    if media is None:
        raise _NoMedia
    dir_id, base = media
    folder = base / f"{_FOLDER}{secrets.token_hex(16)}"
    path = folder / f"photo{_MIME[mime]}"
    try:
        await hass.async_add_executor_job(_write, folder, path, raw)
    except OSError:
        await hass.async_add_executor_job(_remove, folder, path)
        raise _NoMedia from None
    try:
        async with asyncio.timeout(PHOTO_TIMEOUT_S):
            resp = await hass.services.async_call(
                "ai_task", "generate_data",
                {"task_name": "PadSpan Live Aboard photo", "entity_id": eid, "instructions": instructions,
                 "structure": structure,
                 "attachments": [{"media_content_id": f"media-source://media_source/{dir_id}/{folder.name}/{path.name}",
                                  "media_content_type": mime}]},
                blocking=True, return_response=True)
    finally:
        try:
            await hass.async_add_executor_job(_remove, folder, path)
        except BaseException:
            _remove(folder, path)
            raise
    return resp.get("data") if isinstance(resp, dict) else None


def _why(err: BaseException) -> str:
    if isinstance(err, TimeoutError):
        return f"no answer in {PHOTO_TIMEOUT_S // 60} minutes"
    text = " ".join(str(err).split())[:160]
    return text or type(err).__name__


def _bump(hass: HomeAssistant, event: str) -> None:
    """Count one photo_read event (telemetry.PHOTO_EVENTS; nothing while the report is off)."""
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, event)
    except Exception:  # noqa: BLE001
        pass


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_from_photo",
    vol.Required("target"): vol.In(TARGETS),
    vol.Optional("photo"): str,
    vol.Optional("kind"): vol.Any(str, None),
})
@websocket_api.async_response
async def ws_house3d_from_photo(hass: HomeAssistant, connection, msg) -> None:
    """Read one photo with the chosen AI Task (or, with no photo, say which
    AI Task would). Stores nothing."""
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    if not _tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], OFF_CODE, PRO_MESSAGE)
        return
    await B.async_data(hass)
    ai = ai_task(hass)
    target = msg["target"]
    if "photo" not in msg:
        connection.send_result(msg["id"], ai)
        return
    if not ai["ready"]:
        _bump(hass, "photo_read:no_ai_task")
        connection.send_error(msg["id"], NO_AI_CODE, ai["message"])
        return
    try:
        raw, mime = decode(msg.get("photo"))
    except PhotoError as err:
        connection.send_error(msg["id"], err.code, str(err))
        return
    kind = msg.get("kind") if target != "person" else None
    instructions, structure = request(target, kind)
    try:
        answer = await ask(hass, ai["ai_task"], instructions, structure, raw, mime)
    except _NoMedia:
        _bump(hass, "photo_read:error")
        connection.send_result(msg["id"], {"ok": False, "target": target, "reason": "error", "message": NO_MEDIA,
                                           "kind": kind, "ai_task": ai["ai_task"]})
        return
    except Exception as err:  # noqa: BLE001 — any failure of the AI Task is a plain "couldn't read it"
        _LOGGER.warning("PadSpan Live Aboard: the AI Task %s couldn't read a photo: %s", ai["ai_task"], _why(err))
        _bump(hass, "photo_read:error")
        connection.send_result(msg["id"], {"ok": False, "target": target, "reason": "error",
                                           "message": FAILED.format(why=_why(err)), "kind": kind,
                                           "ai_task": ai["ai_task"]})
        return
    out = parse(target, kind, answer)
    _bump(hass, "photo_read:ok" if out["ok"] else "photo_read:bad_answer")
    connection.send_result(msg["id"], {**out, "ai_task": ai["ai_task"]})


WS_COMMANDS = (ws_house3d_from_photo,)
