# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Live Aboard's import (P7): a Sweet Home 3D file's doors, windows and
furniture, as candidates to preview.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("P7 Import"). house3d_import_preview takes
an uploaded .sh3d the way the room import takes one (ws_floorplan_import.py:
the same base64 field and 10 MB limit, then sh3d_import.py's caps and
refusals) and answers candidates. It WRITES NOTHING and reads nothing but the
upload: the person picks what comes in (views/live_aboard_import.js), the
Furnish tab drops it into its draft, and only Save (house3d_edit) writes the
3D file.

- Furniture comes in as kind and size only: the words of its name (then of
  its catalogue id) mapped onto PadSpan's own builders (kind_of), anything
  unmatched a box of its size. Nothing is refused. Never a model, a texture,
  an icon or any other file from the .sh3d.
- Doors and windows come in as Live Aboard's own added openings ("door_" /
  "win_" + 8 hex digits, a stretch of wall in fabric metres, sill and head),
  here the stretch the file draws; the preview puts each on the nearest wall
  of the floor it goes to, by the 3D editor's own rules.
- Which floor each level of the file goes to is the person's choice in the
  preview, so every candidate's floor_id is None here.

The gate is house3d_edit's: refused while Live Aboard is off, and below Pro
(as if off); inside it, the light-placement gate (any user, no admin), as the
plan has it for making furniture. The room import keeps its own admin gate.
"""

from __future__ import annotations

import base64
import math
import re
import secrets
import unicodedata
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .house3d_store import DOOR_MIN_M, WINDOW_MIN_M, enabled
from .sh3d_import import Sh3dParseError, parse_sh3d_furniture
from .ws_common import _tier_at_least
from .ws_floorplan_import import MAX_SH3D_BYTES
from .ws_house3d import OFF_CODE, OFF_MESSAGE, PRO_MESSAGE

BOX = "other"                  # the builders' own box, "Box" in the Build menu (contracts §3)
# Words → PadSpan kinds. A pair first (two words that mean something the
# words alone don't), then the LAST word that names a kind: in a name the
# thing itself comes last ("coffee table", "table lamp", "desk chair";
# "bedside table" is a pair). The name decides when it can, else the
# catalogue id, else a category. Accents are dropped and run-together words
# split ("doubleBed") before matching, so a few common words of other
# languages work too. The "box" words name things no builder draws, so that
# "chest freezer" is a box and not a chest.
KIND_PHRASES: tuple[tuple[str, str], ...] = (
    ("tv stand", "tv"), ("tv unit", "tv"), ("tv cabinet", "tv"), ("tv bench", "tv"), ("tv table", "tv"),
    ("media unit", "tv"), ("media console", "tv"),
    ("sofa bed", "sofa"), ("bunk bed", "bed"),
    ("bedside table", "dresser"), ("bedside cabinet", "dresser"), ("night table", "dresser"),
    ("night stand", "dresser"), ("chest of drawers", "dresser"),
    ("washing machine", "washer"), ("lave linge", "washer"), ("tumble dryer", "dryer"), ("seche linge", "dryer"),
    ("book case", "shelf"), ("book shelf", "shelf"),
    ("robot vacuum", "vacuum_dock"), ("charging station", "charger"),
)
KIND_WORDS: dict[str, tuple[str, ...]] = {
    "sofa": ("sofa", "couch", "settee", "loveseat", "sectional", "futon", "divan", "chesterfield", "canape", "divano"),
    "bed": ("bed", "bunk", "crib", "cot", "cradle", "bassinet", "mattress", "lit", "bett", "cama", "letto"),
    "table": ("table", "tisch", "mesa", "tavolo", "tafel"),
    "chair": ("chair", "stool", "armchair", "recliner", "chaise", "fauteuil", "stuhl", "sessel", "silla", "sedia",
              "stoel"),
    "desk": ("desk", "workstation", "schreibtisch", "escritorio", "scrivania"),
    "dresser": ("dresser", "cabinet", "chest", "sideboard", "cupboard", "drawer", "commode", "credenza", "buffet",
                "nightstand", "vanity", "kommode", "schrank"),
    "tv": ("tv", "television", "telly", "televisor", "fernseher", "televiseur", "televisore"),
    "lamp": ("lamp", "light", "lantern", "chandelier", "pendant", "sconce", "spotlight", "luminaire", "lampe",
             "lampara", "lampada", "lustre"),
    "rug": ("rug", "carpet", "mat", "tapis", "teppich", "alfombra", "tappeto"),
    "shelf": ("shelf", "shelves", "shelving", "bookcase", "bookshelf", "bookshelves", "rack", "etagere", "regal",
              "estanteria", "scaffale"),
    "wardrobe": ("wardrobe", "closet", "armoire", "penderie", "kleiderschrank", "armario", "guardaroba"),
    "plant": ("plant", "tree", "flower", "cactus", "palm", "fern", "bush", "shrub", "bonsai", "plante", "pflanze",
              "planta", "pianta"),
    "washer": ("washer", "waschmaschine", "lavadora", "lavatrice"),
    "dryer": ("dryer", "drier", "trockner", "secadora", "asciugatrice"),
    "radiator": ("radiator", "heater", "radiateur", "heizkorper", "radiador", "termosifone"),
    "fan": ("fan", "ventilator", "ventilateur", "ventilador", "ventilatore"),
    "speaker": ("speaker", "loudspeaker", "subwoofer", "soundbar", "lautsprecher", "enceinte", "altavoz"),
    "vacuum_dock": ("vacuum", "roomba"),
    "mower_dock": ("mower", "lawnmower", "automower"),
    "car": ("car", "vehicle", "suv", "voiture", "coche"),
    "charger": ("charger", "wallbox", "chargepoint"),
    BOX: ("fridge", "refrigerator", "freezer", "oven", "stove", "cooker", "hob", "dishwasher", "microwave", "sink",
          "basin", "washbasin", "toilet", "bidet", "bathtub", "bath", "tub", "shower", "boiler", "piano"),
}
_WORD_KIND: dict[str, str] = {w: k for k, words in KIND_WORDS.items() for w in words}
# A door or a window: by its words, else by its shape (on the floor and at
# least this tall is a door).
DOOR_WORDS = frozenset(("door", "gate", "doorway", "porte", "tur", "puerta", "porta", "deur"))
WINDOW_WORDS = frozenset(("window", "skylight", "casement", "fenetre", "fenster", "ventana", "finestra", "raam"))
DOOR_TALL_M, ON_FLOOR_M = 1.8, 0.05
Z_MAX_M = 20.0                 # a piece's height in its room, as the 3D file keeps it


def words_of(text: Any) -> list[str]:
    """The lowercase words of a name or catalogue id: accents dropped, a
    run-together "doubleBed" or "TVStand" split, digits and marks gone."""
    s = unicodedata.normalize("NFKD", str(text or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", s)
    s = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", s)
    return re.findall(r"[a-z]+", s.lower())


def _word_kind(w: str) -> str | None:
    for cand in (w, w[:-1] if w.endswith("s") else None, w[:-2] if w.endswith("es") else None):
        if cand and cand in _WORD_KIND:
            return _WORD_KIND[cand]
    return None


def kind_of(item: dict[str, Any]) -> tuple[str, str | None]:
    """A piece's PadSpan kind and the word (or pair) that decided it; a box
    and None when nothing matched. A light with no telling words is a lamp."""
    for text in (item.get("name"), item.get("catalog"), item.get("category")):
        words = words_of(text)
        if not words:
            continue
        joined = f" {' '.join(words)} "
        for phrase, kind in KIND_PHRASES:
            if f" {phrase} " in joined:
                return kind, phrase
        for w in reversed(words):
            kind = _word_kind(w)
            if kind:
                return kind, w
    if item.get("tag") == "light":
        return "lamp", "light"
    return BOX, None


def opening_kind(item: dict[str, Any]) -> tuple[str, str | None]:
    """"door" or "window", and the word that decided it (None: its shape)."""
    words = set()
    for text in (item.get("name"), item.get("catalog"), item.get("category")):
        words.update(words_of(text))
    door, window = words & DOOR_WORDS, words & WINDOW_WORDS
    if door and not window:
        return "door", sorted(door)[0]
    if window and not door:
        return "window", sorted(window)[0]
    on_floor = item.get("elevation_m", 0.0) <= ON_FLOOR_M and item.get("height_m", 0.0) >= DOOR_TALL_M
    return ("door" if on_floor else "window"), None


def _mm(v: float) -> float:
    """Metres to the millimetre, never -0.0."""
    return round(v, 3) + 0.0


def _new_id(prefix: str, used: set[str]) -> str:
    while True:
        oid = f"{prefix}_{secrets.token_hex(4)}"
        if oid not in used:
            used.add(oid)
            return oid


def preview(data: bytes) -> dict[str, Any]:
    """The candidates of one .sh3d: {levels, pieces, openings, report}.

    pieces:   {"fur_…": a piece as the 3D file keeps it (contracts §2), origin
              "import", its recipe the kind and the file's size only (params
              and colours empty: the preview fills in the builder's own)}
    openings: {"door_…" / "win_…": a door or window drawn in 3D, as the file
              places it: a_m / b_m its ends, a window's sill and head, a
              door's head (hinged left, swinging in, the editor's defaults)}
    report:   {"pieces": {id: {name, level_id, word, kind}},
               "openings": {id: {name, level_id, word, kind, width_m}},
               "skipped": [{name, why}], "warnings": [...]}
    Raises Sh3dParseError as the room import does."""
    parsed = parse_sh3d_furniture(data)
    used: set[str] = set()
    pieces: dict[str, Any] = {}
    openings: dict[str, Any] = {}
    rep_p: dict[str, Any] = {}
    rep_o: dict[str, Any] = {}
    skipped = list(parsed["skipped"])
    for it in parsed["pieces"]:
        kind, word = kind_of(it)
        pid = _new_id("fur", used)
        pieces[pid] = {
            "id": pid,
            "recipe": {"kind": kind, "params": {}, "colors": [],
                       "width_m": it["width_m"], "depth_m": it["depth_m"], "height_m": it["height_m"]},
            "origin": "import", "label": it["name"], "library_id": None, "submission_id": None,
            "floor_id": None, "x_m": it["x_m"], "y_m": it["y_m"],
            "z_m": _mm(min(Z_MAX_M, max(0.0, it["elevation_m"]))), "rotation": it["angle_deg"],
            "entity_id": None, "entity_reg_id": None,
        }
        rep_p[pid] = {"name": it["name"] or it["catalog"], "level_id": it["level_id"], "word": word, "kind": kind}
    for it in parsed["openings"]:
        kind, word = opening_kind(it)
        least = DOOR_MIN_M if kind == "door" else WINDOW_MIN_M
        name = it["name"] or it["catalog"] or kind
        if it["width_m"] < least:
            skipped.append({"name": name, "why": f"narrower than a {kind} can be ({least:g} m)"})
            continue
        oid = _new_id("door" if kind == "door" else "win", used)
        turn = math.radians(it["angle_deg"])
        ux, uy, half = math.cos(turn), math.sin(turn), it["width_m"] / 2
        a = [_mm(it["x_m"] - ux * half), _mm(it["y_m"] - uy * half)]
        b = [_mm(it["x_m"] + ux * half), _mm(it["y_m"] + uy * half)]
        head = _mm(max(0.0, it["elevation_m"] + it["height_m"]))
        if kind == "window":
            openings[oid] = {"kind": "window", "floor_id": None, "a_m": a, "b_m": b,
                             "sill_m": _mm(max(0.0, it["elevation_m"])), "head_m": head}
        else:
            openings[oid] = {"kind": "door", "floor_id": None, "a_m": a, "b_m": b, "head_m": head,
                             "hinge": "left", "swing": "in"}
        rep_o[oid] = {"name": name, "level_id": it["level_id"], "word": word, "kind": kind,
                      "width_m": it["width_m"]}
    return {"levels": parsed["levels"], "pieces": pieces, "openings": openings,
            "report": {"pieces": rep_p, "openings": rep_o, "skipped": skipped, "warnings": parsed["warnings"]}}


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_import_preview",
    "sh3d_base64": str,
})
@websocket_api.async_response
async def ws_house3d_import_preview(hass: HomeAssistant, connection, msg) -> None:
    """A .sh3d's doors, windows and furniture as candidates. Writes nothing."""
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return
    if not _tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], OFF_CODE, PRO_MESSAGE)
        return
    b64 = msg.get("sh3d_base64") or ""
    if len(b64) > (MAX_SH3D_BYTES * 4) // 3 + 4:
        connection.send_error(msg["id"], "upload_too_large",
                              f"File exceeds the {MAX_SH3D_BYTES // (1024 * 1024)} MB limit")
        return
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception:
        connection.send_error(msg["id"], "bad_base64", "Could not decode the uploaded file")
        return
    try:
        result = await hass.async_add_executor_job(preview, raw)
    except Sh3dParseError as exc:
        connection.send_error(msg["id"], "parse_failed", str(exc))
        return
    connection.send_result(msg["id"], result)


WS_COMMANDS = (ws_house3d_import_preview,)
