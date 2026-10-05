# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard's shared furniture library: this house's side of it (P4).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch, "The shared
furniture library" and "The details sheet". The library is the only PadSpan
server this feature ever talks to, and it is extra: with the "Shared library"
switch off (settings.atlas_3d_library, the default) nothing here is called, so
nothing goes out (ws_house3d_library refuses first); with the library
unreachable, Furnish still works from the built-ins and the starter set.

What leaves the house, only to LIBRARY_URL and only while the switch is on:
- a share: the piece's recipe — kind, builder settings, colours, width / depth
  / height — with its details sheet, plus a random submission id, its owner
  token, the terms version accepted and the PadSpan version. The body is built
  from those keys alone (shared_recipe, share_body), so nothing else of the
  piece — where it sits, its name in the house, the device it is — can travel.
  It is checked here before it goes, with the same lists and patterns as
  server/furniture_library.php (tests hold them equal), and again there.
- a withdrawal: this house's submission ids with their owner tokens.
- a search, a look at one piece, placing one (an anonymous +1), and a report
  (the piece, a reason, and this house's random 6-hex prefix).
Never a photo, the floor plan, the install id, or anyone's figure.

What stays here, in the 3D file's "library" section: the terms version and
when they were accepted; this house's random prefix (the start of each of its
submission ids, which the library's daily limits and reports count by); its
submissions (id -> owner token, library id, when), kept only here; and the
shares waiting for the library to answer again (pending_shares), sent at the
next successful fetch. A share is written here before it is sent, so an answer
lost on the way never leaves a piece that this house cannot withdraw; sending
it again is harmless (the same id and token are an edit).
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import math
import re
import secrets
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant

from .build_info import BUILD_VERSION
from .const import DOMAIN
from .house3d_store import House3dStore, writable

_LOGGER = logging.getLogger(__name__)

LIBRARY_URL = "https://padspan.traks.ca/api/furniture_library.php"
TERMS_VERSION = 1                  # views/live_aboard_library.js TERMS_VERSION, held equal by tests
TIMEOUT_S = 8                      # short: a slow library must never hold up Furnish
MAX_SEND = 8192                    # the server's $MAX
MAX_ANSWER = 512 * 1024
MAX_PENDING = 50
FLUSH_BATCH = 10                   # pending shares sent per successful fetch
MAX_SUBMISSIONS = 1000
_FLUSH_LOCK = "house3d_library_flush"   # hass.data[DOMAIN]: one flush at a time

# ── The details sheet: server/furniture_library.php's lists, in its order ────
CATEGORIES = ("seating", "sleeping", "tables", "storage", "lighting", "media", "decor", "outdoor",
              "appliance", "kids", "pets", "office", "bath", "kitchen", "device", "other")
ROOMS = ("living", "bedroom", "kids-room", "kitchen", "dining", "office", "bathroom", "hallway",
         "garage", "patio", "any")
STYLES = ("modern", "mid-century", "traditional", "rustic", "industrial", "scandinavian", "farmhouse",
          "minimalist", "boho", "coastal", "glam", "retro", "other")
MATERIALS = ("wood", "fabric", "leather", "metal", "glass", "plastic", "stone", "rattan", "mixed")
COLOR_FAMILIES = ("white", "cream", "beige", "brown", "black", "grey", "red", "orange", "yellow",
                  "green", "teal", "blue", "purple", "pink")
SIZE_CLASSES = ("small", "medium", "large", "extra-large")
BED_SIZES = ("twin", "double", "queen", "king", "crib", "bunk")
FEATURES = ("has_arms", "reclines", "sectional", "sofa_bed", "storage", "on_wheels", "foldable",
            "adjustable_height", "wall_mounted")
FIXTURES = ("floor", "table", "desk", "pendant", "wall", "strip")
FORMS = ("puck", "card", "fob", "phone", "box", "board")
SORTS = ("placed", "newest", "size", "name", "fit")
REASONS = ("details", "title")
RECIPE_KEYS = ("kind", "params", "colors", "width_m", "depth_m", "height_m", "details")
DETAIL_KEYS = ("category", "kind", "rooms", "style", "material", "color_family", "size_class",
               "seats", "bed_size", "features", "drawers", "doors", "shelves", "fixture", "shades",
               "form", "antenna", "outdoor", "title", "brand", "model", "checked")
REQUIRED = ("category", "kind", "rooms", "style", "material", "color_family", "size_class")
FILTER_KEYS = ("category", "kind", "room", "style", "material", "color_family", "size_class", "seats",
               "features", "outdoor", "fits")
COUNTS = {"seats": (1, 8), "drawers": (0, 50), "doors": (0, 50), "shelves": (0, 50), "shades": (0, 12)}
TEXT = {"title": (3, 60), "brand": (2, 40), "model": (1, 60)}
MAX_PARAMS, MAX_COLORS, MAX_TEXT, PAGE_MAX, PAGE_DEFAULT, MAX_OFFSET = 40, 6, 60, 60, 30, 5000
DIM_MIN_M, DIM_MAX_M = 0.001, 8.0      # a rug can be a few millimetres thin

KIND_RX = re.compile(r"[a-z][a-z0-9_]{0,31}", re.ASCII)
PARAM_KEY_RX = re.compile(r"[a-z][a-z0-9_]{0,31}", re.ASCII)
PARAM_STR_RX = re.compile(r"[a-z0-9][a-z0-9_-]{0,23}", re.ASCII)
COLOR_RX = re.compile(r"#[0-9a-f]{6}", re.ASCII)
SUB_RX = re.compile(r"sub_[0-9a-f]{16}", re.ASCII)
TOKEN_RX = re.compile(r"[0-9a-f]{32}", re.ASCII)
LIB_RX = re.compile(r"lib_[0-9a-f]{12}", re.ASCII)
PREFIX_RX = re.compile(r"[0-9a-f]{6}", re.ASCII)

# Free text, in this order (the server's): (what, pattern, ignore case).
SECRETS: tuple[tuple[str, str, bool], ...] = (
    ("a PadSpan licence key", r"\b[Pp][Ss][Pp][Aa][Nn]-[A-Za-z0-9-]{8,}", False),
    ("a long hex string (a key or an IRK)", r"\b[0-9A-Fa-f]{32,}\b", False),
    ("a login token", r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}", False),
    ("a long key or token", r"(?=[A-Za-z0-9+=_]*[0-9])(?=[A-Za-z0-9+=_]*[A-Za-z])[A-Za-z0-9+=_]{40,}", False),
)
PERSONAL: tuple[tuple[str, str, bool], ...] = (
    ("email", r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}", False),
    ("url", r"(?:https?:\/\/|www\.)|\b[A-Za-z0-9-]{2,}\.(?:com|net|org|info|biz|io|co|ca|us|uk|de|fr|nl|eu|au|nz"
            r"|app|dev|shop|store|online|site|xyz|me|tv|ly)\b", True),
    ("phone", r"(?:\+?\d[\s.\/()-]*){9,}|\b\d{3}[\s.-]\d{4}\b", False),
    ("address", r"\b\d{1,6}[A-Za-z]?\s+(?:[A-Za-z][A-Za-z'.-]*\s+){1,4}(?:street|st|road|rd|avenue|ave|boulevard"
                r"|blvd|drive|dr|lane|ln|way|court|ct|crescent|cres|place|pl|terrace|highway|hwy|close|parkway|pkwy"
                r"|circle|cir|trail|square|sq)\b|\b[A-Za-z]+(?:strasse|straße|str\.|weg|allee|gasse|platz)\s*\d{1,5}\b"
                r"|\b(?:p\.?\s?o\.?\s?box|apt)\.?\s*#?\s*\d+|\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b", True),
)
WORDS = ("fuck", "fucking", "fucker", "shit", "shitty", "cunt", "bitch", "bastard", "asshole",
         "dickhead", "cock", "pussy", "whore", "slut", "wank", "wanker", "twat", "porn", "nazi", "rape")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")
_SECRET_RX = [re.compile(p, re.ASCII | (re.IGNORECASE if i else 0)) for _, p, i in SECRETS]
_PERSONAL_RX = [(w, re.compile(p, re.ASCII | (re.IGNORECASE if i else 0))) for w, p, i in PERSONAL]
_WORD_RX = re.compile(r"\b(?:" + "|".join(WORDS) + r")\b", re.ASCII | re.IGNORECASE)
TEXT_PROBLEMS = ("control", "secret", "email", "url", "phone", "address", "word")
_SAY = {"control": "a control character", "secret": "something that looks like a key or a token",
        "email": "an email address", "url": "a web address", "phone": "a phone number",
        "address": "a street address", "word": "a word the library does not take"}
_FIELD = {"color_family": "colour family", "size_class": "size class", "bed_size": "bed size",
          "width_m": "width", "depth_m": "depth", "height_m": "height", "colors": "colours",
          "params": "builder settings"}


class LibraryError(Exception):
    """Refused, with a code and plain words for the person; `field` and
    `problem` say which detail when it is one."""

    def __init__(self, code: str, message: str, field: str = "", problem: str = "") -> None:
        super().__init__(message)
        self.code, self.message, self.field, self.problem = code, message, field, problem


class Unreachable(LibraryError):
    """The library did not answer, or not usefully: nothing was refused."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _num(v: Any) -> bool:
    if type(v) not in (int, float):
        return False
    try:
        return math.isfinite(float(v))
    except OverflowError:
        return False


def _count_in(v: Any, lo: int, hi: int) -> bool:
    return type(v) is int and lo <= v <= hi


def _trim(s: str) -> str:
    return s.strip(" \t\n\r\0\x0b")


# ── The checks (server/furniture_library.php's, in its order) ────────────────

def text_problem(s: str) -> str:
    """'' when free text may be shared, else what it looks like."""
    if _CTRL.search(s):
        return "control"
    if any(rx.search(s) for rx in _SECRET_RX):
        return "secret"
    for what, rx in _PERSONAL_RX:
        if rx.search(s):
            return what
    return "word" if _WORD_RX.search(s) else ""


def _set_of(v: Any, values: tuple[str, ...], least: int) -> list[str] | None:
    if not isinstance(v, list) or not least <= len(v) <= len(values):
        return None
    if any(not isinstance(x, str) or x not in values for x in v) or len(set(v)) != len(v):
        return None
    return [x for x in values if x in v]


def check_details(d: Any, kind: str) -> tuple[dict[str, Any] | None, str, str]:
    """The details sheet: (clean, "", "") or (None, field, problem). The first
    problem: not an object; a key outside the sheet; a required field missing;
    then each field in the sheet's order."""
    if not isinstance(d, dict):
        return None, "details", "value"
    for k in d:
        if k not in DETAIL_KEYS:
            return None, str(k), "key"
    for k in REQUIRED:
        v = d.get(k)
        if v is None or v == "" or (isinstance(v, (list, dict)) and not v):
            return None, k, "missing"
    lists = {"category": CATEGORIES, "style": STYLES, "material": MATERIALS, "color_family": COLOR_FAMILIES,
             "size_class": SIZE_CLASSES, "bed_size": BED_SIZES, "fixture": FIXTURES, "form": FORMS}
    out: dict[str, Any] = {}
    for k in DETAIL_KEYS:
        if k not in d:
            continue
        v = d[k]
        if k in lists:
            if not isinstance(v, str) or v not in lists[k]:
                return None, k, "value"
        elif k == "kind":
            if not isinstance(v, str) or v not in (kind, "other"):
                return None, k, "value"
        elif k in ("rooms", "features"):
            v = _set_of(v, ROOMS if k == "rooms" else FEATURES, 1 if k == "rooms" else 0)
            if v is None:
                return None, k, "value"
        elif k in COUNTS:
            if not _count_in(v, *COUNTS[k]):
                return None, k, "value"
        elif k in TEXT:
            if not isinstance(v, str):
                return None, k, "value"
            v = _trim(v)
            if not v:
                continue
            if not TEXT[k][0] <= len(v) <= TEXT[k][1]:
                return None, k, "length"
            p = text_problem(v)
            if p:
                return None, k, p
        elif not isinstance(v, bool):    # antenna, outdoor, checked
            return None, k, "value"
        out[k] = v
    return out, "", ""


def problem_words(field: str, problem: str) -> str:
    """The refusal in plain words."""
    name = _FIELD.get(field, field.replace("_", " "))
    if problem in _SAY:
        return f"The {name} looks like it has {_SAY[problem]} in it. Please take it out: the library is shared with everyone."
    if problem == "missing":
        return f"Please fill in the {name}: the library needs it."
    if problem == "length":
        lo, hi = TEXT.get(field, (0, 0))
        return f"The {name} must be {lo} to {hi} characters."
    if problem == "key":
        return f"“{field}” is not part of a library piece."
    return f"The {name} is not one the library knows."


def shared_recipe(recipe: Any) -> dict[str, Any]:
    """The recipe exactly as it may leave the house: the shared keys only,
    checked. Whatever else the piece's recipe or its sheet holds (a newer
    PadSpan's keys, a builder setting the library cannot take) is left out,
    never sent; a missing or wrong detail is refused (LibraryError "invalid")."""
    def bad(field: str, problem: str) -> LibraryError:
        return LibraryError("invalid", problem_words(field, problem), field, problem)

    if not isinstance(recipe, dict):
        raise bad("recipe", "value")
    kind = recipe.get("kind")
    if not isinstance(kind, str) or not KIND_RX.fullmatch(kind):
        raise bad("kind", "value")
    params: dict[str, Any] = {}
    raw = recipe.get("params")
    for k, v in (raw.items() if isinstance(raw, dict) else ()):
        if not isinstance(k, str) or not PARAM_KEY_RX.fullmatch(k) or len(params) >= MAX_PARAMS:
            continue
        if isinstance(v, bool) or (_num(v) and abs(v) <= 1000) or (isinstance(v, str) and PARAM_STR_RX.fullmatch(v)):
            params[k] = v
    colors = [c.lower() for c in (recipe.get("colors") or []) if isinstance(c, str) and COLOR_RX.fullmatch(c.lower())]
    if not colors or not isinstance(recipe.get("colors"), list):
        raise bad("colors", "value")
    out: dict[str, Any] = {"kind": kind, "params": params, "colors": colors[:MAX_COLORS]}
    for k in ("width_m", "depth_m", "height_m"):
        v = recipe.get(k)
        if not _num(v) or not DIM_MIN_M <= v <= DIM_MAX_M:
            raise bad(k, "value")
        out[k] = round(float(v), 3)
    sheet = recipe.get("details")
    if not isinstance(sheet, dict):
        raise bad("details", "missing")
    # The sheet's own keys only: anything else on it (an AI's confidence, a
    # newer PadSpan's field) stays home, like the rest of the piece.
    details, field, problem = check_details({k: v for k, v in sheet.items() if k in DETAIL_KEYS}, kind)
    if details is None:
        raise bad(field, problem)
    out["details"] = details
    return out


def share_body(submission_id: str, owner_token: str, recipe: dict[str, Any]) -> dict[str, Any]:
    """Everything a share sends, and nothing more."""
    return {"schema": 1, "action": "share", "submission_id": submission_id, "owner_token": owner_token,
            "terms_version": TERMS_VERSION, "version": BUILD_VERSION, "recipe": recipe}


def search_body(msg: dict[str, Any]) -> dict[str, Any]:
    """A search as the browser asked for it, checked against the closed lists
    (LibraryError "invalid" for anything the library would refuse)."""
    def bad(what: str) -> LibraryError:
        return LibraryError("invalid", f"The library cannot search by that ({what}).")

    text = msg.get("text") or ""
    if not isinstance(text, str) or len(text) > MAX_TEXT or _CTRL.search(text):
        raise bad("text")
    lists = {"category": CATEGORIES, "room": ROOMS, "style": STYLES, "material": MATERIALS,
             "color_family": COLOR_FAMILIES, "size_class": SIZE_CLASSES}
    filters: dict[str, Any] = {}
    for k, v in (msg.get("filters") or {}).items():
        if k not in FILTER_KEYS:
            raise bad(k)
        ok = ((k in lists and isinstance(v, str) and v in lists[k])
              or (k == "kind" and isinstance(v, str) and KIND_RX.fullmatch(v) is not None)
              or (k == "seats" and _count_in(v, 1, 8))
              or (k == "features" and _set_of(v, FEATURES, 1) is not None)
              or (k == "outdoor" and isinstance(v, bool))
              or (k == "fits" and isinstance(v, dict) and set(v) == {"width_m", "depth_m"}
                  and all(_num(v[m]) and 0.05 <= v[m] <= 100 for m in v)))
        if not ok:
            raise bad(k)
        filters[k] = v
    sort = msg.get("sort") or "placed"
    if sort not in SORTS or (sort == "fit" and "fits" not in filters):
        raise bad("sort")
    offset, limit = msg.get("offset", 0), msg.get("limit", PAGE_DEFAULT)
    if not _count_in(offset, 0, MAX_OFFSET) or not _count_in(limit, 1, PAGE_MAX):
        raise bad("page")
    body: dict[str, Any] = {"schema": 1, "action": "search", "sort": sort, "offset": offset, "limit": limit}
    if text.strip():
        body["text"] = text.strip()
    if filters:
        body["filters"] = filters
    return body


def _entry(e: Any) -> dict[str, Any] | None:
    """A library entry as the browser gets it, or None for one not shaped
    like a library entry (the browser's builders clamp the rest)."""
    if not isinstance(e, dict) or not isinstance(e.get("library_id"), str) or not LIB_RX.fullmatch(e["library_id"]):
        return None
    r = e.get("recipe")
    if not isinstance(r, dict) or not isinstance(r.get("kind"), str) or not isinstance(r.get("details"), dict):
        return None
    if not all(_num(r.get(k)) for k in ("width_m", "depth_m", "height_m")):
        return None
    return {"library_id": e["library_id"], "recipe": r,
            "houses": e["houses"] if _count_in(e.get("houses"), 0, 10**9) else 1,
            "copies": e["copies"] if _count_in(e.get("copies"), 0, 10**9) else 1,
            "checked": e.get("checked") is True,
            "created": e["created"] if isinstance(e.get("created"), str) else ""}


# ── The wire ─────────────────────────────────────────────────────────────────

async def post(hass: HomeAssistant, body: dict[str, Any]) -> dict[str, Any]:
    """One POST to LIBRARY_URL, and only there: the answer when it is
    {"ok": true}. A refusal (4xx) raises LibraryError("refused"); no answer, a
    busy or full library, or an answer that is not JSON raises Unreachable."""
    data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(data) > MAX_SEND:
        raise LibraryError("invalid", "That piece is too big to share (over 8 KB).")
    status, reply = 0, None
    try:
        import aiohttp  # noqa: PLC0415
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415
        session = async_get_clientsession(hass)
        async with session.post(LIBRARY_URL, data=data, headers={"Content-Type": "application/json"},
                                timeout=aiohttp.ClientTimeout(total=TIMEOUT_S)) as resp:
            status = int(resp.status)
            raw = bytearray()
            async for chunk in resp.content.iter_chunked(65536):
                raw += chunk
                if len(raw) > MAX_ANSWER:
                    raise ValueError("answer too long")
            try:
                reply = json.loads(bytes(raw).decode("utf-8"))
            except ValueError:
                reply = None
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Furniture library unreachable: %s", err)
        raise Unreachable("unreachable", "Can't reach the shared library right now.") from None
    if 200 <= status < 300 and isinstance(reply, dict) and reply.get("ok") is True:
        return reply
    if status in (400, 403, 404, 405, 413) and isinstance(reply, dict):
        field = reply.get("field") if isinstance(reply.get("field"), str) else ""
        problem = reply.get("problem") if isinstance(reply.get("problem"), str) else ""
        said = reply.get("error") if isinstance(reply.get("error"), str) else ""
        why = reply.get("why") if isinstance(reply.get("why"), str) else ""
        words = problem_words(field, problem) if field and problem else (" ".join(said.split())[:200]
                                                                         or f"HTTP {status}")
        raise LibraryError("refused", f"The library did not take it: {words}", field, problem or why)
    raise Unreachable("unreachable", "The shared library is busy or can't be reached right now.")


# ── The 3D file's library section ────────────────────────────────────────────

def section(data: Any) -> dict[str, Any]:
    """The library section as this version reads it (tolerant: a missing or
    broken part is empty)."""
    lib = data.get("library") if isinstance(data, dict) else None
    lib = lib if isinstance(lib, dict) else {}
    subs = lib.get("submissions")
    pend = lib.get("pending_shares")
    return {**lib,
            "submissions": {k: v for k, v in subs.items() if isinstance(k, str) and isinstance(v, dict)}
            if isinstance(subs, dict) else {},
            "pending_shares": [p for p in pend if isinstance(p, dict) and isinstance(p.get("submission_id"), str)
                               and isinstance(p.get("recipe"), dict)] if isinstance(pend, list) else []}


def status(data: Any) -> dict[str, Any]:
    """What the browser may know: never an owner token."""
    lib = section(data)
    return {"terms_version": lib.get("terms_version") if _count_in(lib.get("terms_version"), 0, 10**6) else 0,
            "terms_current": TERMS_VERSION, "accepted_at": lib.get("accepted_at") or "",
            "shared": len(lib["submissions"]), "waiting": len(lib["pending_shares"])}


def without_tokens(data: Any) -> Any:
    """The 3D file as a browser may see it (house3d_get, house3d_edit): each
    submission without its owner token. The token stays in the file; only
    this house's withdraw and share send it, and only to the library."""
    lib = data.get("library") if isinstance(data, dict) else None
    subs = lib.get("submissions") if isinstance(lib, dict) else None
    if not isinstance(subs, dict):
        return data
    return {**data, "library": {**lib, "submissions": {
        k: {kk: vv for kk, vv in v.items() if kk != "owner_token"} if isinstance(v, dict) else v
        for k, v in subs.items()}}}


async def _write_library(store: House3dStore, change) -> bool:
    """One write of the library section, under the store's lock, from the
    file as it is now: `change(lib)` edits a copy and returns False for no
    change. Never a newer PadSpan's file."""
    async with store.lock:
        if not writable(store.data):
            raise LibraryError("house3d_newer", "Live Aboard's file was saved by a newer PadSpan. Update PadSpan to share.")
        new = copy.deepcopy(store.data)
        lib = section(new)
        if change(lib) is False:
            return True
        new["library"] = lib
        if not await store.async_write(new):
            raise LibraryError("save_failed", "Could not save Live Aboard's file. Nothing was sent.")
        return True


def _prefix(lib: dict[str, Any]) -> str:
    p = lib.get("prefix")
    if not isinstance(p, str) or not PREFIX_RX.fullmatch(p):
        p = lib["prefix"] = secrets.token_hex(3)
    return p


def terms_ok(data: Any) -> bool:
    return section(data).get("terms_version") == TERMS_VERSION


async def accept_terms(store: House3dStore, version: Any) -> dict[str, Any]:
    if version != TERMS_VERSION:
        raise LibraryError("terms_changed", "The terms have changed. Please read them again.")

    def change(lib: dict[str, Any]) -> None:
        lib["terms_version"], lib["accepted_at"] = TERMS_VERSION, _now()
    await _write_library(store, change)
    return status(store.data)


async def share(hass: HomeAssistant, store: House3dStore, recipe: Any,
                submission_id: str | None = None) -> dict[str, Any]:
    """Share a piece, or send new details for one this house shared. Written
    here first (submission + pending), then sent; a library that does not
    answer leaves it waiting for the next successful fetch."""
    if not terms_ok(store.data):
        raise LibraryError("terms_required", "Accept the library's terms before sharing furniture.")
    out = shared_recipe(recipe)
    picked: dict[str, str] = {}

    def queue(lib: dict[str, Any]) -> None:
        subs, pend = lib["submissions"], lib["pending_shares"]
        sid = submission_id if isinstance(submission_id, str) and submission_id in subs else ""
        if not sid:
            if len(subs) >= MAX_SUBMISSIONS:
                raise LibraryError("full", "This house has shared as many pieces as it can keep track of.")
            sid = f"sub_{_prefix(lib)}{secrets.token_hex(5)}"
            subs[sid] = {"owner_token": secrets.token_hex(16), "library_id": None, "shared_at": None,
                         "kind": out["kind"]}
        if len(pend) >= MAX_PENDING and not any(p.get("submission_id") == sid for p in pend):
            raise LibraryError("busy", "Too many shares are waiting for the library. Try again once it answers.")
        lib["pending_shares"] = [p for p in pend if p.get("submission_id") != sid]
        lib["pending_shares"].append({"submission_id": sid, "recipe": out, "queued_at": _now()})
        picked["sid"] = sid
    await _write_library(store, queue)
    sid = picked["sid"]
    sub = section(store.data)["submissions"][sid]
    try:
        reply = await post(hass, share_body(sid, sub["owner_token"], out))
    except Unreachable:
        return {"submission_id": sid, "status": "queued", "library_id": sub.get("library_id")}
    except LibraryError as err:
        await _settle(store, sid, None, err)
        raise
    lid = reply.get("library_id") if isinstance(reply.get("library_id"), str) else None
    await _settle(store, sid, lid, None)
    await flush_pending(hass, store)
    return {"submission_id": sid, "status": "updated" if reply.get("edited") else "shared", "library_id": lid}


async def _settle(store: House3dStore, sid: str, library_id: str | None, refused: LibraryError | None) -> None:
    """After the library's answer: a share no longer waits; a refused new one
    is forgotten (the library never kept it)."""
    def change(lib: dict[str, Any]) -> None:
        lib["pending_shares"] = [p for p in lib["pending_shares"] if p.get("submission_id") != sid]
        sub = lib["submissions"].get(sid)
        if sub is None:
            return
        if refused is None:
            sub["library_id"] = library_id or sub.get("library_id")
            sub["shared_at"] = _now()
        elif not sub.get("shared_at"):
            del lib["submissions"][sid]
    try:
        await _write_library(store, change)
    except LibraryError as err:   # it stays waiting; sending it again is an edit
        _LOGGER.debug("Library share %s not settled: %s", sid, err.message)


async def flush_pending(hass: HomeAssistant, store: House3dStore) -> int:
    """Send what waited, at most FLUSH_BATCH, one at a time, stopping at the
    first that finds the library unreachable. Returns how many went."""
    lock = hass.data.setdefault(DOMAIN, {}).setdefault(_FLUSH_LOCK, asyncio.Lock())
    if lock.locked() or not writable(store.data):
        return 0
    sent = 0
    async with lock:
        lib = section(store.data)
        for item in lib["pending_shares"][:FLUSH_BATCH]:
            sid = item["submission_id"]
            sub = lib["submissions"].get(sid)
            if sub is None:   # withdrawn meanwhile, or never this house's: it never goes
                await _settle(store, sid, None, LibraryError("gone", ""))
                continue
            try:
                reply = await post(hass, share_body(sid, sub.get("owner_token", ""), item["recipe"]))
            except Unreachable:
                break
            except LibraryError as err:
                await _settle(store, sid, None, err)
                continue
            await _settle(store, sid, reply.get("library_id") if isinstance(reply.get("library_id"), str) else None, None)
            sent += 1
    return sent


async def withdraw_all(hass: HomeAssistant, store: House3dStore) -> dict[str, Any]:
    """Take every piece this house shared out of the library. Shares still
    waiting are dropped here first (they must never go now); the ids the
    library confirms are forgotten; the rest stay, to try again."""
    lib = section(store.data)
    items = [{"submission_id": sid, "owner_token": s.get("owner_token")} for sid, s in lib["submissions"].items()
             if SUB_RX.fullmatch(sid) and isinstance(s.get("owner_token"), str) and TOKEN_RX.fullmatch(s["owner_token"])]

    def drop_waiting(lib: dict[str, Any]) -> bool:
        if not lib["pending_shares"]:
            return False
        lib["pending_shares"] = []
        return True
    await _write_library(store, drop_waiting)
    done: list[str] = []
    try:
        for i in range(0, len(items), 200):
            reply = await post(hass, {"schema": 1, "action": "withdraw", "items": items[i:i + 200]})
            done += [s for s in reply.get("withdrawn") or [] if isinstance(s, str)]
    finally:
        if done:
            def forget(lib: dict[str, Any]) -> None:
                for sid in done:
                    lib["submissions"].pop(sid, None)
            await _write_library(store, forget)
    return {"withdrawn": len(done), "left": len(section(store.data)["submissions"])}


async def report(hass: HomeAssistant, store: House3dStore, library_id: Any, reason: Any) -> None:
    if not isinstance(library_id, str) or not LIB_RX.fullmatch(library_id) or reason not in REASONS:
        raise LibraryError("invalid", "That is not a library piece or a reason to report it.")
    lib = section(store.data)
    prefix = lib.get("prefix") if isinstance(lib.get("prefix"), str) and PREFIX_RX.fullmatch(lib["prefix"]) else ""
    if not prefix:
        await _write_library(store, _prefix)
        prefix = section(store.data)["prefix"]
    await post(hass, {"schema": 1, "action": "report", "library_id": library_id, "reason": reason,
                      "reporter": prefix})


async def search(hass: HomeAssistant, msg: dict[str, Any]) -> dict[str, Any]:
    reply = await post(hass, search_body(msg))
    entries = [e for e in (_entry(x) for x in (reply.get("entries") or [])) if e is not None]
    total = reply.get("total") if _count_in(reply.get("total"), 0, 10**9) else len(entries)
    return {"total": total, "entries": entries}


async def get(hass: HomeAssistant, library_id: Any, placed: bool) -> dict[str, Any]:
    if not isinstance(library_id, str) or not LIB_RX.fullmatch(library_id):
        raise LibraryError("invalid", "That is not a library piece.")
    reply = await post(hass, {"schema": 1, "action": "get", "library_id": library_id, "placed": bool(placed)})
    entry = _entry(reply.get("entry"))
    if entry is None:
        raise Unreachable("unreachable", "The library's answer could not be read.")
    return entry
