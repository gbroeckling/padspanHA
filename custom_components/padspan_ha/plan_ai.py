# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Add data via plans: the plan AI (experimental, off by default; 2026-11).

The reading (Stage 1a). The person's own AI Task reads each placed floor plan
for staircases, then looks again at a crop round each one (the measured
recipe: a find the crop says isn't there is dropped, one it boxes is placed
from that box), and asks whether a handrail is drawn beside it; all inside one
time budget. Every find is matched against the stairs already in the 3D house
(already there, a correction of one, new, or a second staircase stacked over
one) and kept as a SUGGESTION in this store, padspan_ha.plan_ai, with the
plan's picture and placement signatures of the moment it was read. What the person says of
a suggestion in Live Aboard's Plans tool (it looks right; wrong, with a reason;
later) comes back here the moment it is clicked, and a "wrong" is remembered as
a reject so the same find on the same plan is not queued again. A session in
which no plan's whole read answered ends failed, saying why: it read nothing,
which is not the same as finding nothing.

Lights (Stage 3), only on a plan the person says draws light fixtures: after
everything else, 3 x 3 tiles at 20 % overlap with the measured all-kinds prompt
(only its lights kept), finds within LIGHT_MERGE_M one find, then one crop check
per find, which also names the symbol. A symbol is matched against the placed
light. entries of the map, and never moves one: within LIGHT_M and agreeing it is
already there; within LIGHT_M and differing it may correct that light's KIND;
further away it is unmatched, which is no failure of the AI.

Nothing here writes the 3D house, the map (fabric, model, maps), calibration
or any other store: keeping a suggestion (new, correction) and undoing what was
kept is plan_ai_write.py, the one writer. The plan's picture goes only to the chosen AI
Task, as the photo step sends a photo (ws_house3d_photo.ask: a hidden file
for the call); the answer is reduced to numbers and closed words before it
is stored, and the model's text is never stored, shown or logged.

Design: PadspanResearch/plan-ai-design-2026-11.md (sections 2, 3, 4, 7, 8).

Build from plans: line up (Stage 1, at the end of this file): with Claude
Opus 5.5 or newer as the AI Task, the same reader reads each plan of one
floor for its printed text, dimension strings, stairs and outside corners;
plan_geom.py measures (ticks, pixels per metre, tilt, the fit of one plan on
another); the proposals (a placement per plan, a refile for a plan of another
floor) are kept in this store's "lineups" section with what each would shift.
Nothing here writes a placement: saving an accepted proposal and undoing a
session is plan_ai_write.py, the one writer (Stage 1b), with its ledger in this
store's "lineup_batches". Design: PadspanResearch/plan-build-design-2026-11.md.

The store's Home Assistant version stays 1 forever; shape changes go through
the data's own "schema" field, read the tolerant way (house3d_store.py).
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import math
import re
import secrets
import time
from typing import Any, Callable

from homeassistant.core import HomeAssistant

from .const import DATA_MAPS, DATA_MODEL, DATA_PLAN_AI, DATA_SETTINGS, DEFAULT_FLOOR_ID, DOMAIN, OUTSIDE_FLOOR_ID, PLAN_AI_STORE_KEY
from . import ai_usage as U
from . import plan_geom as G
from . import ws_house3d_photo as P
from . import ws_house3d_stairs as S
from .fabric_truth import placement_metres
from .ws_common import _point_in_polygon

_LOGGER = logging.getLogger(__name__)

SCHEMA = 1
_LOAD_LOCK = "plan_ai_load_lock"      # hass.data[DOMAIN]: one first load at a time
_DATA_JOB = "plan_ai_job"             # hass.data[DOMAIN]: the one running job (Job)
_DATA_STARTS = "plan_ai_starts"       # hass.data[DOMAIN]: when sessions started (monotonic), for the rate caps

PLAN_BUDGET_S = 480                   # one session's reads, all told
PLAN_READ_LOCAL_S = 90                # one read on a local AI Task; a cloud one gets the photo step's PHOTO_TIMEOUT_S
START_GAP_S = 60                      # a start at most this often
STARTS_A_DAY = 10
MAX_SESSIONS, MAX_SUGGESTIONS, MAX_BATCHES, MAX_REJECTS = 5, 200, 20, 500
KINDS: tuple[str, ...] = ("stairs", "railing", "light")
DUP_M, CORR_M = 1.0, 2.5              # within DUP_M of one existing stair: a duplicate, whatever its shape; up to CORR_M: a correction
REJECT_M = 0.5                        # a find this close to a remembered reject on the same plan version is not queued
CROP_M = (3.0, 8.0)                   # the crop round a find, its side: 2.5 × the find's long side, within these (experiment run_crops.py)
CROP_PX = 768                         # sent no bigger than this on its long side, then fitted to the frame
CROP_MIN_FRAC = 0.05                  # a crop's box narrower or lower than this share of it is a mark, not stairs (the smallest of 21 recorded answers: 0.14)
LIGHT_CROP_MIN_FRAC = 0.005           # a light IS a small mark: only a box of nothing is no box
LIGHT_M = 0.6                         # a symbol this close to a placed light (to its outline, if it has one) is about that light
LIGHT_MERGE_M = 0.3                   # finds this close, across tiles or plans, are one
MAX_LIGHTS = 40                       # on one plan, at most
TILES, TILE_OVERLAP, TILE_PX = 3, 0.2, 1024    # the measured recipe (experiment planlib.tiles_of, run_reads stage_T)
TILE_SLOW_S = 45                      # a first read longer than this: nine more a plan would eat the session, so no tiles
GROUP_M = 1.5                         # a placed light drawn this long stands for a room's lights, unless it is a strip
STATUS: tuple[str, ...] = ("running", "done", "cancelled", "failed", "out_of_time")
CANCEL_WHY: tuple[str, ...] = ("user", "switch_off", "house3d_off", "licence", "plan_gone", "plan_changed", "restart")
FAILURE_WHY: tuple[str, ...] = ("wrong_place", "nothing_there", "already_here", "wrong_kind", "cant_tell")
# Counted from the panel (views/live_aboard_plans.js, the what's-missing pass, through telemetry_event): the Add by hand it led to.
MISSING_ADDED_EVENT = "plan_ai_missing_added:{kind}"
VERDICTS: tuple[str, ...] = ("failure", "later", "right")   # what a person can say of a suggestion in this stage; each is stored and counted
# Why a session read nothing: the reason most of its failed reads gave, the earlier here on a tie.
NO_READ_WHY: tuple[str, ...] = ("no_media", "no_picture", "unreachable", "timeout", "bad_answer")
# A stair the AI placed (the stair finder's labels, and the Plans tool's; setup_checks.py counts them the same way).
AI_LABELS = ("Stairs (AI first guess", "Stairs (from the plan")

# The second look at a find, in the experiment's own words (run_crops.py,
# 2026-11-02 §4): kept where it says present and placed from its box, a find's
# precision at 1 m went 0.70 → 0.84. The railing question beside a kept stair
# is unmeasured: the side is used only when the arrow was read, and even then
# the person chooses; the next stage counts how often the AI's side is taken.
CROP_PROMPT = (
    "This is a crop of a floor plan, {w} by {h} pixels. Is there a staircase (a run of many short parallel step lines, "
    "often with an arrow and UP or DOWN) at or near the centre of this crop? Output JSON: "
    "{{\"present\": true or false, \"bbox_2d\": [x1, y1, x2, y2]}} with pixel coordinates of it, or {{\"present\": false}}.")
RAIL_PROMPT = (
    "This picture is {w} by {h} pixels: a crop from a floor plan with a staircase at its centre. Is a handrail or "
    "balustrade drawn beside the staircase (a thin line or a row of small marks along its side)? Say left or right "
    "as someone climbing the stairs would, facing the way up. Output JSON only: "
    "{{\"rail\": \"yes|no\", \"side\": \"left|right|both|none\"}}.")
# The measured light read (experiment planlib.prompt_all): all five kinds asked,
# P 0.72 / R 0.57 on lights against 0.41 / 0.65 asking for lights alone. Only the
# lights are kept; the doors, windows and the rest are discarded unseen.
TILE_PROMPT = (
    "This floor plan image is {w} by {h} pixels. Locate every door (a gap in a wall, usually with a thin quarter-circle swing arc), "
    "window (a thin double or triple line set into an outside wall), staircase (a run of many short parallel step lines), "
    "railing (a long thin line along a stair or the edge of an open area, not a full wall) and ceiling light fixture "
    "(a small circle or circle with a cross, printed or handwritten). Output JSON: a list of objects "
    "{{\"bbox_2d\": [x1, y1, x2, y2], \"label\": \"door|window|stairs|railing|light\"}} with pixel coordinates.")
# The measured crop check (planlib.prompt_check), with the symbol asked in the same read: on 15 finds
# (Mac, 2026-11-02) it answered present alike with and without the symbol, the boxes nearly alike on 14.
LIGHT_CROP_PROMPT = (
    "This is a crop of a floor plan, {w} by {h} pixels. Is there a ceiling light fixture (a small circle or circle with a "
    "cross, a pot light or downlight mark, printed or handwritten) at or near the centre of this crop? Output JSON: "
    "{{\"present\": true or false, \"bbox_2d\": [x1, y1, x2, y2], \"symbol\": \"pot|pendant|sconce|unknown\"}} with pixel "
    "coordinates of it, or {{\"present\": false}}. symbol: pot for a small plain circle, pendant for a circle with a cross, "
    "sconce for a half circle on a wall, unknown for anything else.")
# What a symbol is drawn as (a kind Live Aboard has), and the kinds that already agree with it.
SYMBOL_KIND = {"pot": "pot", "pendant": "pendant", "sconce": "sconce"}
SYMBOL_AGREES = {"pot": ("pot", "pot_ring"), "pendant": ("pendant", "chandelier"), "sconce": ("sconce", "vanity")}
_LIGHT_LABELS = ("light", "lights", "light fixture", "light fixtures", "ceiling light", "ceiling light fixture", "lamp")   # the experiment's synonyms


# ── The store ────────────────────────────────────────────────────────────────

def empty() -> dict[str, Any]:
    return {"schema": SCHEMA, "sessions": {}, "batches": {}, "rejects": {}, "lineups": {}, "stall": {}, "lineup_batches": {}, "rooms": {}, "room_batches": {}, "scale_batches": {}, "scales": {}}


def writable(data: Any) -> bool:
    """Only a schema up to this version's is written back (house3d_store.writable)."""
    s = data.get("schema", SCHEMA) if isinstance(data, dict) else SCHEMA
    return isinstance(s, int) and not isinstance(s, bool) and 0 <= s <= SCHEMA


def normalise(raw: Any) -> dict[str, Any]:
    """Tolerant read: every key kept; a missing or broken section of a file
    this version may write becomes empty; a newer PadSpan's file is kept whole."""
    if not isinstance(raw, dict):
        return empty()
    out = dict(raw)
    out.setdefault("schema", SCHEMA)
    if writable(out):
        for k in ("sessions", "batches", "rejects", "lineups", "stall", "lineup_batches", "rooms", "room_batches", "scale_batches", "scales"):
            if not isinstance(out.get(k), dict):
                out[k] = {}
    return out


def sweep_restart(data: dict[str, Any], keep: str | None = None) -> int:
    """A session still marked running with no job behind it (Home Assistant
    restarted during the read, or a restore brought one back) is over: failed,
    reason restart, and the sheet says run it again. `keep`: the one really
    running. Returns how many were swept."""
    n = 0
    for sid, sess in (data.get("sessions") or {}).items():
        if isinstance(sess, dict) and sess.get("status") == "running" and sid != keep:
            sess.update(status="failed", error="restart", finished_at=time.time(), rev=int(sess.get("rev") or 0) + 1)
            sess.pop("finds", None)
            sess.pop("light_finds", None)
            n += 1
    return n


def sweep_lineups(data: dict[str, Any], keep: str | None = None, hass: HomeAssistant | None = None) -> int:
    """sweep_restart for line-ups: one still marked running with no job
    behind it failed (restart); its reads stay, and Resume reads the rest. One
    waiting for the person's help has no job behind it by design: it stays.
    `hass`: the stop is noted and counted too (design 14: the card says why)."""
    n = 0
    for sid, sess in [*(data.get("lineups") or {}).items(), *(data.get("rooms") or {}).items(),   # the rooms sessions (Stage 2) too
                      *(data.get("scales") or {}).items()]:                                       # and the rooms helper's scale reads
        if isinstance(sess, dict) and sess.get("status") == "running" and sid != keep:
            sess.update(status="failed", error="restart", finished_at=time.time(), rev=int(sess.get("rev") or 0) + 1)
            if hass is not None:
                note_stop(hass, data, sess, "restart")
            n += 1
    return n


class PlanAiStore:
    """padspan_ha.plan_ai. `.data` is what a backup saves and a restore
    replaces (ws_common._DATA_KEY_MAP); the file exists only once a session
    has run (ws_common._BACKUP_ONLY_ONCE_WRITTEN)."""

    def __init__(self, hass: HomeAssistant) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.hass = hass
        self.store = Store(hass, 1, PLAN_AI_STORE_KEY)
        self._data: dict[str, Any] = empty()
        self.lock = asyncio.Lock()

    @property
    def data(self) -> dict[str, Any]:
        return self._data

    @data.setter
    def data(self, value: Any) -> None:
        self._data = normalise(value)

    async def async_load(self) -> dict[str, Any]:
        self.data = await self.store.async_load()
        await self.async_sweep()
        return self._data

    async def async_sweep(self, keep: str | None = None) -> None:
        """sweep_restart, counted and saved when it found any."""
        swept = sweep_restart(self._data, keep) if writable(self._data) else 0
        scales = sum(1 for sid, s in (self._data.get("scales") or {}).items()
                     if isinstance(s, dict) and s.get("status") == "running" and sid != keep) if writable(self._data) else 0
        lined = sweep_lineups(self._data, keep, self.hass) if writable(self._data) else 0
        if swept:
            for _ in range(swept):
                _bump(self.hass, "plan_ai_session:failed")
                _bump(self.hass, "plan_ai_cancel_why:restart")
        for _ in range(lined - scales):
            _bump(self.hass, "plan_build_run:s1_failed")
        for _ in range(scales):
            _bump(self.hass, "plan_build_run:s0_failed")
        if swept or lined:
            await self.async_save()

    async def async_save(self) -> bool:
        """Write the data as it is. A newer PadSpan's file is never written."""
        if not writable(self._data):
            return False
        await self.store.async_save(self._data)
        return True

    async def async_checked_save(self) -> bool:
        """Write the data and read it back: written only if the file then holds
        it. Home Assistant's Store logs a failed write and returns normally, so
        only the comparison tells (house3d_store.async_write). What a commit's
        ledger stands on (plan_ai_write.py)."""
        if not writable(self._data):
            return False
        try:
            await self.store.async_save(self._data)
            back = await self.store.async_load()
        except Exception as err:  # noqa: BLE001
            _LOGGER.error("PadSpan plans: the plan store couldn't be written: %s", P._why(err))  # noqa: SLF001
            return False
        if back != self._data:
            _LOGGER.error("PadSpan plans: the plan store doesn't hold what was written")
            return False
        return True

    def session(self, sid: str | None) -> dict[str, Any] | None:
        sessions = self._data.get("sessions") or {}
        if sid:
            s = sessions.get(sid)
            return s if isinstance(s, dict) else None
        latest = max((s for s in sessions.values() if isinstance(s, dict)),
                     key=lambda s: float(s.get("started_at") or 0), default=None)
        return latest

    def lineup(self, sid: str | None) -> dict[str, Any] | None:
        """A line-up session by id (Stage 1), or None."""
        s = (self._data.get("lineups") or {}).get(sid) if sid else None
        return s if isinstance(s, dict) else None

    def rooms_session(self, sid: str | None) -> dict[str, Any] | None:
        """A rooms session by id (Stage 2), or None."""
        s = (self._data.get("rooms") or {}).get(sid) if sid else None
        return s if isinstance(s, dict) else None

    def scale_session(self, sid: str | None) -> dict[str, Any] | None:
        """A scale read of the rooms helper by id (design E.1), or None."""
        s = (self._data.get("scales") or {}).get(sid) if sid else None
        return s if isinstance(s, dict) else None

    def trim(self) -> None:
        """The caps: the oldest sessions, batches, rejects and line-ups over them go."""
        for key, cap, when in (("sessions", MAX_SESSIONS, "started_at"), ("batches", MAX_BATCHES, "committed_at"),
                               ("rejects", MAX_REJECTS, "at"), ("lineups", MAX_LINEUPS, "started_at"),
                               ("lineup_batches", MAX_BATCHES, "committed_at"), ("rooms", MAX_ROOM_SESSIONS, "started_at"),
                               ("room_batches", MAX_BATCHES, "committed_at"), ("scale_batches", MAX_BATCHES, "committed_at"),
                               ("scales", MAX_SCALE_SESSIONS, "started_at")):
            d = self._data.get(key) or {}
            if len(d) > cap:
                order = sorted(d, key=lambda k: float((d[k] or {}).get(when) or 0) if isinstance(d[k], dict) else 0)
                for k in order[:len(d) - cap]:
                    d.pop(k, None)


async def async_get_store(hass: HomeAssistant) -> PlanAiStore:
    """The store, loaded on first use and kept in hass.data. Loading reads;
    it writes only to sweep a session a restart cut short."""
    dom = hass.data.setdefault(DOMAIN, {})
    store = dom.get(DATA_PLAN_AI)
    if isinstance(store, PlanAiStore):
        return store
    async with dom.setdefault(_LOAD_LOCK, asyncio.Lock()):
        store = dom.get(DATA_PLAN_AI)
        if not isinstance(store, PlanAiStore):
            store = PlanAiStore(hass)
            await store.async_load()
            dom[DATA_PLAN_AI] = store
    return store


def _bump(hass: HomeAssistant, event: str, n: int = 1) -> None:
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, event, n)
    except Exception:  # noqa: BLE001
        pass


def enabled(hass: HomeAssistant) -> bool:
    """The master switch, settings.ai_plans_enabled (default off)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return ((st.data if st else {}) or {}).get("ai_plans_enabled") is True


# ── Plans and their signatures ───────────────────────────────────────────────

def image_sig(m: dict) -> str:
    """The picture's version: the image's sha256 (every rewrite of the
    picture sets it), else the map's `updated`. Not `updated` first: any save
    of the map record moves it (a refile's floor, a scanner dragged), and none
    of those changes the picture."""
    image = m.get("image") or {}
    return re.sub(r"[^a-zA-Z0-9]", "", str(image.get("sha256") or m.get("updated") or ""))[:32]


def legacy_image_sig(m: dict) -> str:
    """The picture's signature as PadSpan stored it before the sha256 came
    first (0.38.220 on): the map's `updated` first. Still the same picture
    while it matches: the record hasn't been saved since (review B3)."""
    image = m.get("image") or {}
    return re.sub(r"[^a-zA-Z0-9]", "", str(m.get("updated") or image.get("sha256") or ""))[:32]


def same_picture(stored: Any, now: dict) -> bool:
    """A stored picture signature against a plan as it is now (its
    image_sig, and the old formula's image_sig_was)."""
    return stored in (now.get("image_sig"), now.get("image_sig_was"))


def place_sig(t: Any) -> str:
    """The placement's version: a hash of the whole transform record. A
    re-placement writes the record and never bumps `updated`, so this is
    what tells a moved plan (and lets a reject keyed to it expire)."""
    if not isinstance(t, dict):
        return ""
    return hashlib.sha256(json.dumps(t, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:16]


def plans(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The placed plans there are to read (ws_house3d_stairs._plans), each
    with its four corners in metres, how many reference measurements placed
    it (0: placed by eye) and its two signatures. No view reads a placement.
    A plan of the outside (a site plan) is left out: it has no stairs to
    read, and it is the sheet most likely to carry the address."""
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    maps = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    out = []
    for pl in S._plans(hass):  # noqa: SLF001
        if str(pl["floor_id"] or "").lower() in (OUTSIDE_FLOOR_ID, "outside"):
            continue
        mid = pl["map_id"]
        m = maps.get_map(mid) if maps is not None else None
        t = model.map_transform(mid) if model is not None else None
        if m is None:
            continue
        corners = [model.map_frac_to_metres(fx, fy, mid) for fx, fy in ((0, 0), (1, 0), (1, 1), (0, 1))]
        if any(c is None for c in corners):
            continue
        out.append({**pl, "floor_id": pl["floor_id"] or DEFAULT_FLOOR_ID, "corners_m": [[round(c[0], 3), round(c[1], 3)] for c in corners],
                    "refs": len((t or {}).get("reference_measurements") or []),
                    "image_sig": image_sig(m), "image_sig_was": legacy_image_sig(m), "place_sig": place_sig(t)})
    return out


def plan_now(hass: HomeAssistant, map_id: str) -> dict[str, Any] | None:
    """One plan as it is now (its signatures), or None when it is gone or unplaced."""
    for pl in plans(hass):
        if pl["map_id"] == map_id:
            return pl
    return None


def plans_moved(hass: HomeAssistant, sess: dict[str, Any]) -> set[str]:
    """The session's plans whose picture or placement changed since the read
    (each marked changed, for good: its positions came from what was there):
    their ids."""
    for pl in sess.get("plans") or []:
        now = plan_now(hass, pl["map_id"])
        if now is None or not same_picture(pl["image_sig"], now) or now["place_sig"] != pl["place_sig"]:
            pl["changed"] = True
    return {pl["map_id"] for pl in sess.get("plans") or [] if pl.get("changed")}


# ── Frames and the 0-1000 trap ───────────────────────────────────────────────

_QWEN25 = re.compile(r"qwen\s*2[._-]?5", re.I)


def _registry(hass: HomeAssistant, eid: str) -> tuple[Any, Any, Any, Any]:
    """The one registry read of an AI Task (review B5): its entity, its
    config entry, the entry's sub-entry and its device, None each that
    can't be read."""
    try:
        from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415
        ent = er.async_get(hass).async_get(eid)
        entry = hass.config_entries.async_get_entry(getattr(ent, "config_entry_id", None))
        sub = (getattr(entry, "subentries", None) or {}).get(getattr(ent, "config_subentry_id", None))
        return ent, entry, sub, dr.async_get(hass).async_get(getattr(ent, "device_id", None))
    except Exception:  # noqa: BLE001
        return None, None, None, None


def _model_text(hass: HomeAssistant, eid: str) -> str:
    """What names the model behind an AI Task entity: its id and names, the
    "model" of the integration's sub-entry or entry (Ollama keeps it there),
    and model_sources (the sub-entry's "chat_model", Anthropic's, and the
    device's model and model id). Whatever can't be read is left out: no
    name means a named frame."""
    ent, entry, sub, _dev = _registry(hass, eid)
    out = [str(eid or "")] + [str(getattr(ent, k, None) or "") for k in ("name", "original_name")]
    for src in (getattr(sub, "data", None), getattr(entry, "options", None), getattr(entry, "data", None)):
        if src and src.get("model"):
            out.append(str(src["model"]))
    return " ".join(out + model_sources(hass, eid))


def frame_kind(hass: HomeAssistant, eid: str) -> str:
    """"probed": Ollama with a Qwen2.5-VL, whose frame is measured
    (ws_house3d_stairs.frame_of); "named": anything else, sent at the same
    size, answering in a frame of its own. A named frame holds corrections:
    a 20-30 % frame error looks exactly like a plan offset."""
    if P._platform(hass, eid) != "ollama":  # noqa: SLF001
        return "named"
    return "probed" if _QWEN25.search(_model_text(hass, eid)) else "named"


def suspect_frame(boxes: Any, w: int, h: int) -> bool:
    """A model that answers 0-1000 by design (Qwen3-VL, Gemini) on a frame
    over 1000 px on an axis: every coordinate at most 1000 and the largest
    at least 900. Asked of a named frame only (read_plan): a probed one is
    measured, and on a tall plan its real answers land there too (8 of 21
    recorded). A named frame holds its finds anyway, so this is the counter
    that shows such a model."""
    if max(w, h) <= 1000 or not isinstance(boxes, list):
        return False
    coords: list[float] = []
    for b in boxes:
        bb = b.get("bbox_2d") or b.get("bbox") or b.get("box") if isinstance(b, dict) else None
        if isinstance(bb, list):
            coords.extend(v for v in (S._num(x) for x in bb) if v is not None)  # noqa: SLF001
    return bool(coords) and max(coords) <= 1000 and max(coords) >= 900


# ── Floors ───────────────────────────────────────────────────────────────────

def floor_order(model: Any) -> list[dict[str, Any]]:
    """Indoor floors, lowest first: [{id, elev}]."""
    try:
        elev = model.floor_base_elevations_m()
    except Exception:  # noqa: BLE001
        elev = {}
    out = []
    for i, f in enumerate(model.floors() if model is not None else []):
        fid = str(f.get("id") or "")
        if not fid or fid == OUTSIDE_FLOOR_ID or fid.lower() == "outside":
            continue
        out.append({"id": fid, "elev": float(elev.get(fid, i * 2.8)), "i": i})
    out.sort(key=lambda f: (f["elev"], f["i"]))
    return out


def floor_step(floors: list[dict], fid: str, step: int) -> str | None:
    """The next indoor floor up (step 1) or down (-1) from fid, or None."""
    ids = [f["id"] for f in floors]
    if fid not in ids:
        return None
    i = ids.index(fid) + step
    return ids[i] if 0 <= i < len(ids) else None


def floor_of_find(floors: list[dict], plan_floor: str, says: str) -> str | None:
    """Where a find goes: the floor it climbs from. A DOWN find, or any find
    on the top floor, belongs to the floor below (live_aboard_furnish.js
    readPlanStairs); None when there is none."""
    if plan_floor not in [f["id"] for f in floors]:
        return None
    top = floor_step(floors, plan_floor, 1) is None
    return floor_step(floors, plan_floor, -1) if says == "DOWN" or top else plan_floor


def base_floor(fid: Any) -> str:
    """A split level's id ("upper~0.75") is its whole floor."""
    return str(fid or "").split("~")[0]


# ── Conflation ───────────────────────────────────────────────────────────────

def stair_pieces(house: dict | None) -> list[dict[str, Any]]:
    """The 3D house's stairs, flat: id, floor, position, the floor they reach
    (named, else none), their rail and shape, and whether a person placed
    them (hand)."""
    out = []
    for pid, p in ((house or {}).get("pieces") or {}).items():
        if not isinstance(p, dict) or not isinstance(p.get("recipe"), dict) or p["recipe"].get("kind") != "stairs":
            continue
        params = p["recipe"].get("params") or {}
        label = str(p.get("label") or "")
        out.append({"id": str(pid), "floor_id": str(p.get("floor_id") or DEFAULT_FLOOR_ID), "x_m": S._num(p.get("x_m")) or 0.0,  # noqa: SLF001
                    "y_m": S._num(p.get("y_m")) or 0.0, "rotation": S._num(p.get("rotation")) or 0.0,  # noqa: SLF001
                    "to_floor": base_floor(params.get("to_floor")) or None, "label": label,
                    "rail": str(params.get("rail") or "auto"), "shape": str(params.get("shape") or "straight"),
                    "hand": not label.startswith(AI_LABELS)})
    return out


def target_snap(piece: dict) -> dict[str, Any]:
    """The target as read at match time (compared again before a commit)."""
    return {k: piece.get(k) for k in ("x_m", "y_m", "rotation", "floor_id", "to_floor", "label", "rail")}


def classify(fid: str, implied_to: str | None, x: float, y: float, stairs: list[dict], matched: set[str]) -> dict[str, Any]:
    """One find against the stairs on its floor. Candidates are the ones
    reaching the floor the find implies (unnamed: the next floor up, as the
    house draws them). Within DUP_M of one: a duplicate, full stop (shape
    and rotation are the AI's weakest reads). DUP_M-CORR_M from exactly one:
    a correction. Two or more inside CORR_M: new, named near them, never
    auto-paired. A candidate already matched this session, or a stair within
    CORR_M that reaches another floor: "a second staircase here, stacked?",
    with the floor choice open. Otherwise new."""
    near = []
    for st in stairs:
        if st["floor_id"] != fid:
            continue
        dist = math.hypot(st["x_m"] - x, st["y_m"] - y)
        if dist <= CORR_M:
            near.append((dist, st))
    near.sort(key=lambda t: t[0])
    agree = [(d, st) for d, st in near if (st["to_floor"] or implied_to) == implied_to]
    other = [(d, st) for d, st in near if (st["to_floor"] or implied_to) != implied_to]
    out: dict[str, Any] = {"target": None, "distance_m": None, "relation": "new", "near": [st["id"] for _, st in near],
                           "near_names": [st["label"] or "Stairs" for _, st in near], "held": None, "target_snap": None}
    if len(agree) == 1:
        d, st = agree[0]
        if st["id"] in matched:
            return {**out, "relation": "stacked", "target": st["id"], "distance_m": round(d, 2), "target_snap": target_snap(st)}
        out.update(target=st["id"], distance_m=round(d, 2), target_snap=target_snap(st), hand=st["hand"],
                   relation="duplicate" if d <= DUP_M else "correction")
        return out
    if len(agree) >= 2:                              # new, near them: the person may turn it into a correction of one
        return {**out, "near_snaps": {st["id"]: target_snap(st) for _, st in agree}}
    if other:
        d, st = other[0]
        return {**out, "relation": "stacked", "target": st["id"], "distance_m": round(d, 2), "target_snap": target_snap(st)}
    return out


def rail_relation(have: str | None, side: str | None, shape: str) -> str:
    """A railing hint against the stair it sits beside. Rail "none": nothing
    chosen, so new. "auto" draws its rails as it always did and "both" has
    every side: already there. One side chosen: already there, unless the AI
    names another side, which is a correction to look at; on a turning flight
    left and right don't say inner or outer, so it can't be told apart. A rail
    someone chose is never suggested away: nothing here proposes less rail."""
    if have == "none":
        return "new"
    if have in ("inner", "outer"):
        said = {"left": "inner", "right": "outer"}.get(side or "") if shape == "straight" else None   # a straight flight's inner is its left
        if side == "both" or (said and said != have):
            return "correction"
    return "duplicate"


def _corners(f: dict) -> list[tuple[float, float]]:
    """A find's footprint as the turned rectangle it is: its run (depth)
    along (sin r, -cos r) and its width across, from the rotation the
    reader gives (ws_house3d_stairs._rot_facing: the front faces -run)."""
    r = math.radians(float(f.get("rotation") or 0.0))
    hw, hd = (float(f.get("width_m") or 0.6)) / 2, (float(f.get("depth_m") or 0.6)) / 2
    ux, uy, vx, vy = math.cos(r), math.sin(r), math.sin(r), -math.cos(r)
    return [(f["x_m"] + sx * hw * ux + sy * hd * vx, f["y_m"] + sx * hw * uy + sy * hd * vy)
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def _overlap(a: dict, b: dict) -> bool:
    """Two footprints overlap (separating axes on the two rectangles)."""
    pa, pb = _corners(a), _corners(b)
    for poly in (pa, pb):
        for i in range(4):
            ex, ey = poly[(i + 1) % 4][0] - poly[i][0], poly[(i + 1) % 4][1] - poly[i][1]
            nx, ny = -ey, ex
            qa = [x * nx + y * ny for x, y in pa]
            qb = [x * nx + y * ny for x, y in pb]
            if max(qa) <= min(qb) + 1e-9 or max(qb) <= min(qa) + 1e-9:
                return False
    return True


def merge_across_plans(finds: list[dict]) -> list[dict]:
    """The same staircase read on two plans becomes one find (seen_on both):
    only across plans, and only when the floor relation agrees (an upper
    plan's DOWN with the lower plan's UP or unsaid, both landing on one
    floor, within DUP_M) or the footprints overlap. Never two finds from one
    plan, and never on distance alone: a split-entry's up and down flights
    sit 1.2 m apart. Plans that put one staircase further apart than that
    both keep their find, each named by its plan."""
    out: list[dict] = []
    for f in finds:
        twin = None
        for g in out:
            if g["map_id"] == f["map_id"] or any(s["map_id"] == f["map_id"] for s in g["seen_on"]) or g["floor_id"] != f["floor_id"]:
                continue
            dist = math.hypot(g["x_m"] - f["x_m"], g["y_m"] - f["y_m"])
            agrees = ({g["says"], f["says"]} >= {"DOWN"} and g["plan_floor"] != f["plan_floor"] and dist <= DUP_M)
            if agrees or _overlap(g, f):
                twin = g
                break
        if twin is None:
            out.append({**f, "seen_on": [{"map_id": f["map_id"], "x_m": f["x_m"], "y_m": f["y_m"]}]})
            continue
        twin["seen_on"].append({"map_id": f["map_id"], "x_m": f["x_m"], "y_m": f["y_m"]})
        # The one read where it climbs from wins the position (the furnish loop's rule).
        if f["plan_floor"] == f["floor_id"] and twin["plan_floor"] != twin["floor_id"]:
            for k in ("x_m", "y_m", "rotation", "width_m", "depth_m", "shape", "says", "sure_up", "map_id", "plan_floor", "box_px", "frame"):
                twin[k] = f[k]
        if f.get("rail") and not twin.get("rail"):
            twin["rail"] = f["rail"]
    return out


# ── Lights ───────────────────────────────────────────────────────────────────

def _words(*w: str) -> re.Pattern[str]:
    return re.compile(r"\b(" + "|".join(w) + r")\b")


# What a light's name gives away (live_aboard_house.js NAME_KIND, in its order; that is what the house draws).
_NAME_KIND = (
    ("fan", _words("fans?")), ("chandelier", _words("chandeliers?")), ("pendant", _words("pendants?", "hanging", "drop lights?")),
    ("vanity", _words("vanity")), ("sconce", _words("sconces?", "wall lights?", "wall lamps?")),
    ("spot", _words("spots?", "spotlights?", "spot lights?", "floods?", "floodlights?", "flood lights?", "wall wash", "washers?")),
    ("tv", _words("tv", "bias")), ("led", _words("status led", "indicator", "backlight")),
    ("pot", _words("pots?", "pot ?lights?", "potlights?", "downlights?", "down lights?", "recessed", "can lights?", "cans")),
    ("track", _words("track")),
    ("strip", _words("valances?", "strips?", "coves?", "tape", "rope", r"under ?cab\w*", r"ws2812\w*", r"sk6812\w*", "neopixels?", "xmas", "christmas")),
    ("tube", _words("flouresents?", "fluorescents?", "tubes?", "shop lights?")),
    ("fixture", _words("ceiling lights?", "flush ?mounts?", "fixtures?", "dome lights?")),
)
_KIND_OF_SHAPE = {"hex": "fixture", "circle": "pot", "bar": "strip", "line": "track", "square": "tube", "fan": "fan", "pendant": "pendant",
                  "sconce": "sconce", "chandelier": "chandelier", "triangle": "spot", "diamond": "led", "perimeter": "perimeter"}   # KIND_OF_SHAPE
_STRIPS = ("strip", "valance", "undercab", "kick", "tv", "track", "tube", "led")


def _drawn_kind(eid: str, label: Any, stored: Any, override: Any) -> str | None:
    """What the house draws a light as, as far as a symbol can disagree with it
    (live_aboard_house.js guessKind): the kind set in Live Aboard, the shape set
    on the Atlas, the words in its name. None: nothing says (it glows)."""
    if isinstance(stored, str) and stored:
        return stored
    if override and override != "auto" and override in _KIND_OF_SHAPE:
        return _KIND_OF_SHAPE[override]
    text = " " + re.sub(r"[^a-z0-9]+", " ", f"{eid} {label or ''}".lower()) + " "
    return next((k for k, r in _NAME_KIND if r.search(text)), None)


def footprint(rec: dict) -> tuple[tuple[float, float], tuple[float, float], float] | None:
    """A placed light's outline in plan metres (live_aboard_house.js footprint):
    its two half-axes and its long side. Under 30 cm a marker has no size."""
    w, h = (S._num(rec.get("width_cm")) or 0.0) / 100, (S._num(rec.get("height_cm")) or 0.0) / 100  # noqa: SLF001
    if max(w, h) < 0.3:
        return None
    t, c30 = math.radians(S._num(rec.get("rotation")) or 0.0), math.cos(math.pi / 6)  # noqa: SLF001
    iso = lambda sx, sy: (sx / (2 * c30) + sy, -sx / (2 * c30) + sy)  # noqa: E731
    e1, e2 = iso(math.cos(t), math.sin(t)), iso(-math.sin(t), math.cos(t))
    a, b = (e1[0] * w / 2, e1[1] * w / 2), (e2[0] * h / 2, e2[1] * h / 2)
    return a, b, 2 * max(math.hypot(*a), math.hypot(*b))


def _seg_dist(px: float, py: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
    return math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)


def light_distance(light: dict, x: float, y: float) -> float:
    """How far a point is from a placed light: from its outline, where it has
    one ("Pots Main North" covers 4.75 x 2 m: a symbol inside it is on it), else
    from its point."""
    dx, dy = x - light["x_m"], y - light["y_m"]
    fp = light.get("fp")
    if not fp:
        return math.hypot(dx, dy)
    a, b, _long = fp
    det = a[0] * b[1] - a[1] * b[0]
    if abs(det) > 1e-9 and abs((dx * b[1] - dy * b[0]) / det) <= 1 and abs((a[0] * dy - a[1] * dx) / det) <= 1:
        return 0.0
    corners = [(sa * a[0] + sb * b[0], sa * a[1] + sb * b[1]) for sa, sb in ((1, 1), (1, -1), (-1, -1), (-1, 1))]
    return min(_seg_dist(dx, dy, corners[i], corners[(i + 1) % 4]) for i in range(4))


def light_snap(light: dict) -> dict[str, Any]:
    """The target as read at match time (compared again before a commit)."""
    return {k: light.get(k) for k in ("x_m", "y_m", "floor_id", "stored_kind")}


def placed_lights(hass: HomeAssistant, house: dict | None) -> list[dict[str, Any]]:
    """The light. entries of the map's positions (never fan., binary_sensor.,
    sensor. or lock., which share the store), read only, with what the 3D file
    says of each. `group`: it stands for a room's lights (a Home Assistant
    group, or a long outline that isn't a strip)."""
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    overrides = ((st.data if st else {}) or {}).get("light_shapes") or {}
    stored = (house or {}).get("lights") or {}
    out = []
    for eid, rec in (model.light_positions_m() if model is not None else {}).items():
        if not str(eid).startswith("light.") or not isinstance(rec, dict):
            continue
        x, y = S._num(rec.get("x_m")), S._num(rec.get("y_m"))  # noqa: SLF001
        if x is None or y is None:
            continue
        entry = stored.get(eid) if isinstance(stored.get(eid), dict) else {}
        state = hass.states.get(eid)
        label = rec.get("label") or (state.attributes.get("friendly_name") if state else None) or ""
        kind, fp = _drawn_kind(eid, label, entry.get("kind"), overrides.get(eid)), footprint(rec)
        members = state.attributes.get("entity_id") if state else None
        out.append({"id": str(eid), "floor_id": str(rec.get("floor_id") or DEFAULT_FLOOR_ID), "x_m": x, "y_m": y, "label": str(label), "fp": fp,
                    "stored_kind": entry.get("kind"), "kind": kind,
                    "group": isinstance(members, (list, tuple)) or bool(fp and fp[2] >= GROUP_M and kind not in _STRIPS)})
    return out


def classify_light(fid: str, x: float, y: float, symbol: str, lights: list[dict], offered: set[tuple[str, str]]) -> dict[str, Any]:
    """One symbol against the placed lights on its floor. Beyond LIGHT_M of all:
    unmatched. Within it: a duplicate if it agrees with any of them, or says
    nothing (unknown: it can't disagree, and there is no kind to offer), or was
    offered already as that kind on that light; else a correction, kind only, of
    the nearest."""
    near = sorted(((light_distance(lt, x, y), lt) for lt in lights if base_floor(lt["floor_id"]) == base_floor(fid)), key=lambda t: t[0])
    near = [(d, lt) for d, lt in near if d <= LIGHT_M]
    out: dict[str, Any] = {"target": None, "distance_m": None, "relation": "unmatched", "near": [], "held": None, "target_snap": None}
    if not near:
        return out
    d, lt = next(((d, lt) for d, lt in near if lt["kind"] in SYMBOL_AGREES.get(symbol, ())), near[0])
    out.update(target=lt["id"], distance_m=round(d, 2), target_snap=light_snap(lt), label=lt["label"], now_kind=lt["kind"], group=lt["group"])
    agrees = symbol not in SYMBOL_KIND or lt["kind"] in SYMBOL_AGREES[symbol] or (lt["id"], symbol) in offered
    out["relation"] = "duplicate" if agrees else "correction"
    if not agrees:
        out["want_kind"] = SYMBOL_KIND[symbol]
    return out


def merge_lights(finds: list[dict]) -> list[dict]:
    """Finds within LIGHT_MERGE_M of one on one floor are one, the first kept
    (tiles overlap, and a model repeats itself), a known symbol winning over
    unknown. Two plans seeing it are both named."""
    out: list[dict] = []
    for f in finds:
        twin = next((g for g in out if g["plan_floor"] == f["plan_floor"] and math.hypot(g["x_m"] - f["x_m"], g["y_m"] - f["y_m"]) <= LIGHT_MERGE_M), None)
        if twin is None:
            out.append({**f, "seen_on": list(f.get("seen_on") or [{"map_id": f["map_id"], "x_m": f["x_m"], "y_m": f["y_m"]}])})
            continue
        if f["map_id"] not in [s["map_id"] for s in twin["seen_on"]]:
            twin["seen_on"].append({"map_id": f["map_id"], "x_m": f["x_m"], "y_m": f["y_m"]})
        if twin.get("symbol", "unknown") == "unknown" and f.get("symbol", "unknown") != "unknown":
            twin["symbol"] = f["symbol"]
    return out


def capped_lights(finds: list[dict]) -> list[dict]:
    """MAX_LIGHTS a plan: past that a read is noise."""
    seen: dict[str, int] = {}
    out = []
    for f in finds:
        seen[f["map_id"]] = seen.get(f["map_id"], 0) + 1
        if seen[f["map_id"]] <= MAX_LIGHTS:
            out.append(f)
    return out


def tile_boxes(W: int, H: int) -> list[tuple[int, int, int, int]]:
    """TILES x TILES tiles covering a W x H picture, TILE_OVERLAP shared between neighbours."""
    tw, th = W / (TILES - (TILES - 1) * TILE_OVERLAP), H / (TILES - (TILES - 1) * TILE_OVERLAP)
    return [(round(i * tw * (1 - TILE_OVERLAP)), round(j * th * (1 - TILE_OVERLAP)),
             min(W, round(i * tw * (1 - TILE_OVERLAP) + tw)), min(H, round(j * th * (1 - TILE_OVERLAP) + th)))
            for j in range(TILES) for i in range(TILES)]


def tiles(path) -> list[tuple[bytes, int, int, tuple[float, float, float, float]]]:
    """A plan's tiles, each a JPEG at the frame the model looks at it in after
    making it at most TILE_PX on its long side, with its size and its bounds as
    fractions of the picture. Runs in the executor."""
    from PIL import Image  # noqa: PLC0415
    import io  # noqa: PLC0415
    out = []
    with Image.open(path) as im:
        im = im.convert("RGB")
        W, H = im.size
        for box in tile_boxes(W, H):
            part = im.crop(box)
            part.thumbnail((TILE_PX, TILE_PX))
            part = part.resize(S.frame_of(*part.size), Image.LANCZOS)
            buf = io.BytesIO()
            part.save(buf, "JPEG", quality=88)
            out.append((buf.getvalue(), part.size[0], part.size[1], (box[0] / W, box[1] / H, box[2] / W, box[3] / H)))
    return out


_BOXED = re.compile(r"\{[^{}]*?\"bbox_2d\"[^{}]*?\}")


def tile_lights(answer: Any, w: int, h: int) -> list[dict] | None:
    """A tile's answer, reduced to its lights' boxes in the frame ({bbox_2d}),
    each once; None when it can't be read. The model can run on, repeating itself
    until it is cut off, so a list cut short still gives the objects it holds. A
    box past the tile is another frame's, and goes."""
    items = S._list_of(answer)  # noqa: SLF001
    if items is None and isinstance(answer, str):
        items = []
        for m in _BOXED.finditer(answer):
            try:
                items.append(json.loads(m.group(0)))
            except ValueError:
                continue
        if not items:
            return None
    if items is None:
        return None
    out, seen, edge = [], set(), S.PAST_EDGE_FRAC
    for b in items:
        bb = b.get("bbox_2d") if isinstance(b, dict) else None
        if not isinstance(b, dict) or str(b.get("label") or "").strip().lower() not in _LIGHT_LABELS or not isinstance(bb, list) or len(bb) != 4:
            continue
        xs = [S._num(v) for v in bb]  # noqa: SLF001
        if any(v is None for v in xs):
            continue
        x1, x2, y1, y2 = min(xs[0], xs[2]), max(xs[0], xs[2]), min(xs[1], xs[3]), max(xs[1], xs[3])
        if x1 < -edge * w or y1 < -edge * h or x2 > (1 + edge) * w or y2 > (1 + edge) * h or (x1, y1, x2, y2) in seen:
            continue
        seen.add((x1, y1, x2, y2))
        out.append({"bbox_2d": [x1, y1, x2, y2]})
    return out


def symbol_of(answer: Any) -> str:
    """The symbol word of a crop check's answer, a closed word: unknown unless it says one."""
    word: Any = None
    if isinstance(answer, dict):
        word = answer.get("symbol")
    elif isinstance(answer, str):
        m = re.search(r'"?symbol"?\s*:\s*"([a-zA-Z_ ]+)"', answer)
        word = m.group(1) if m else None
    word = str(word or "").strip().lower()
    return word if word in SYMBOL_KIND else "unknown"


# ── Rejects ──────────────────────────────────────────────────────────────────

def reject_key(kind: str, map_id: str, isig: str, psig: str, x: float, y: float) -> str:
    return f"{kind}|{map_id}|{isig}|{psig}|{x:.1f}|{y:.1f}"


def remembered_reject(rejects: dict, kind: str, map_id: str, isig: str | tuple, psig: str, x: float, y: float) -> str | None:
    """The key of a live reject of this kind within REJECT_M on this plan
    version, or None. After a re-placement the placement hash differs and
    the old reject no longer matches: it expires by itself. `isig`: the
    picture's signature, or it and the old formula's (legacy_image_sig)."""
    isigs = (isig,) if isinstance(isig, str) else tuple(isig)
    for key, r in (rejects or {}).items():
        if not isinstance(r, dict) or r.get("kind") != kind or r.get("map_id") != map_id:
            continue
        if r.get("image_sig") not in isigs or r.get("place_sig") != psig:
            continue
        try:
            if math.hypot(float(r["x_m"]) - x, float(r["y_m"]) - y) <= REJECT_M:
                return key
        except (KeyError, TypeError, ValueError):
            continue
    return None


# ── Reading a plan ───────────────────────────────────────────────────────────

def crop(path, cx: float, cy: float, hx: float, hy: float) -> tuple[bytes, int, int, tuple[float, float, float, float]]:
    """A crop of the plan round (cx, cy), half-widths hx, hy, all fractions of
    the picture, clipped to it, as a JPEG at the frame the model looks at
    it in (ws_house3d_stairs.frame_of) after making it at most CROP_PX on its
    long side, and the crop's bounds as fractions.
    Runs in the executor."""
    from PIL import Image  # noqa: PLC0415
    import io  # noqa: PLC0415
    with Image.open(path) as im:
        im = im.convert("RGB")
        W, H = im.size
        x0, y0 = max(0.0, cx - hx), max(0.0, cy - hy)
        x1, y1 = min(1.0, cx + hx), min(1.0, cy + hy)
        box = (int(x0 * W), int(y0 * H), max(int(x0 * W) + 8, int(x1 * W)), max(int(y0 * H) + 8, int(y1 * H)))
        part = im.crop(box)
        part.thumbnail((CROP_PX, CROP_PX))
        part = part.resize(S.frame_of(*part.size), Image.LANCZOS)
        buf = io.BytesIO()
        part.save(buf, "JPEG", quality=88)
        return buf.getvalue(), part.size[0], part.size[1], (box[0] / W, box[1] / H, box[2] / W, box[3] / H)


def crop_answer(answer: Any, w: int, h: int, min_frac: float = CROP_MIN_FRAC) -> tuple[bool, tuple[float, float, float, float] | None] | None:
    """The second look's answer, reduced to (present, its box as fractions of
    the crop, x1, y1, x2, y2, or None without a usable box); None when it says
    neither. A box out past the crop is another frame's, and one under
    min_frac a side (a point, a mark) is no staircase: neither is used."""
    present: Any = None
    bb: Any = None
    if isinstance(answer, dict):
        present, bb = answer.get("present"), answer.get("bbox_2d")
    elif isinstance(answer, str):
        m = re.search(r'"?present"?\s*:\s*(true|false)', answer, re.I)
        present = m.group(1).lower() == "true" if m else None
        m = re.search(r'"?bbox_2d"?\s*:\s*\[([^\]]*)\]', answer)
        bb = m.group(1).split(",") if m else None
    if not isinstance(present, bool):
        return None
    if not present:
        return False, None
    xs = [S._num(v) for v in bb] if isinstance(bb, list) and len(bb) == 4 else None  # noqa: SLF001
    if not xs or any(v is None for v in xs):
        return True, None
    x1, x2, y1, y2 = min(xs[0], xs[2]), max(xs[0], xs[2]), min(xs[1], xs[3]), max(xs[1], xs[3])
    edge = S.PAST_EDGE_FRAC
    if x1 < -edge * w or y1 < -edge * h or x2 > (1 + edge) * w or y2 > (1 + edge) * h:
        return True, None
    x1, y1, x2, y2 = max(0.0, x1) / w, max(0.0, y1) / h, min(float(w), x2) / w, min(float(h), y2) / h
    if x2 - x1 < min_frac or y2 - y1 < min_frac:
        return True, None
    return True, (x1, y1, x2, y2)


def json_object(answer: Any) -> dict | None:
    """The answer's JSON object: itself, or the first {...} in its text."""
    if isinstance(answer, dict):
        return answer
    if isinstance(answer, str):
        a, b = answer.find("{"), answer.rfind("}")
        if 0 <= a < b:
            try:
                v = json.loads(answer[a:b + 1])
            except ValueError:
                return None
            return v if isinstance(v, dict) else None
    return None


def rail_of(answer: Any) -> tuple[bool, str | None]:
    """The railing answer as (drawn, side): side in left|right|both or None."""
    obj = json_object(answer)
    if isinstance(answer, str):
        if obj is None:
            yes = bool(re.search(r"\byes\b", answer, re.I)) and not re.search(r"\bno\b", answer, re.I)
            return yes, None
    if not isinstance(obj, dict):
        return False, None
    yes = str(obj.get("rail") or "").strip().lower() in ("yes", "true", "1")
    side = str(obj.get("side") or "").strip().lower()
    return yes, side if side in ("left", "right", "both") else None


def _band(n: int, bands: tuple[tuple[int, str], ...], last: str) -> str:
    for upto, name in bands:
        if n <= upto:
            return name
    return last


class Job:
    """The one running session: its id, task and cancel flag."""

    def __init__(self, sid: str) -> None:
        self.sid = sid
        self.task: asyncio.Task | None = None
        self.cancel = False


def running(hass: HomeAssistant) -> Job | None:
    job = hass.data.get(DOMAIN, {}).get(_DATA_JOB)
    return job if isinstance(job, Job) and job.task is not None and not job.task.done() else None


_DATA_SCALE_SAVED = "plan_ai_scale_saved"   # hass.data[DOMAIN]: when the rooms helper last saved a plan's scale (monotonic)
SCALE_GAP_S = 600                            # its rooms read started this soon after skips the one-a-minute gap (design E.2)


def _mark_scale_saved(hass: HomeAssistant) -> None:
    """The rooms helper saved a plan's scale (plan_ai_write.scale_save): its rooms read may start at once."""
    hass.data.setdefault(DOMAIN, {})[_DATA_SCALE_SAVED] = time.monotonic()


def take_scale_gap(hass: HomeAssistant, now: float | None = None) -> bool:
    """Whether the helper's own scale save came just before, used up by asking."""
    now = time.monotonic() if now is None else now
    at = hass.data.get(DOMAIN, {}).pop(_DATA_SCALE_SAVED, None)
    return isinstance(at, (int, float)) and 0 <= now - at < SCALE_GAP_S


def start_allowed(hass: HomeAssistant, now: float | None = None, skip_gap: bool = False) -> str | None:
    """Why a start is refused now: already_running, too_soon (one a minute)
    or daily_cap (STARTS_A_DAY in 24 h); None when it may start. `skip_gap`:
    the rooms helper's read right after its own scale save (design E.2): one
    at a time and the daily cap still hold."""
    now = time.monotonic() if now is None else now
    if running(hass) is not None:
        return "already_running"
    starts = [t for t in hass.data.get(DOMAIN, {}).get(_DATA_STARTS, []) if now - t < 86400]
    if starts and now - max(starts) < START_GAP_S and not skip_gap:
        return "too_soon"
    if len(starts) >= STARTS_A_DAY:
        return "daily_cap"
    return None


def new_session(ai: dict, plans_: list[dict], kinds: list[str], frame: str, fixtures: dict[str, str] | None = None) -> dict[str, Any]:
    """A session record about to run (the store's shape, section 4). `fixtures`:
    the person's answer per plan (yes, no, unsure) to whether it draws light
    fixtures; only a plan on yes is read for lights."""
    fx = fixtures or {}
    return {"rev": 1, "started_at": time.time(), "finished_at": None, "status": "running", "error": None,
            "ai_task": str(ai.get("ai_task") or ""), "local": ai.get("local"), "backup_used": False,
            "frame": frame, "budget_s": PLAN_BUDGET_S, "spent_s": 0.0,
            "reads": 0, "tiles": 0, "timeouts": 0, "errors": {}, "skipped": 0, "no_floor": 0, "crop_dropped": 0, "light_dropped": 0,
            "lights_asked": "light" in kinds,
            "progress": {"plan": 0, "of": len(plans_), "name": "", "step": "stairs"},
            "plans": [{"map_id": p["map_id"], "name": p.get("name") or "", "floor_id": p["floor_id"],
                       "kinds": [k for k in kinds if k != "light" or fx.get(p["map_id"]) == "yes"],
                       "fixtures_drawn": {"yes": True, "no": False}.get(fx.get(p["map_id"], "")) if "light" in kinds else None, "refs": int(p.get("refs") or 0),
                       "image_sig": p["image_sig"], "image_sig_was": p.get("image_sig_was"), "place_sig": p["place_sig"], "frame": None, "suspect": False,
                       "read": False, "answered": False, "changed": False} for p in plans_],
            "finds": [], "light_finds": [], "suggestions": {}, "batch": None, "backup_id": None}


class Runner:
    """One session's reads and conflation, written to the store as it goes.
    The one plan reader (design 15): ask and read below are the only path to
    the AI for the plan AI and the line-up; what differs is said here."""

    TASK = "PadSpan plans"                # what ai_usage counts these reads as
    BACKUP = True                         # the backup AI Task when the main one is away (ask_ai); the line-up never (design 8)
    HALTS: tuple[str, ...] = ()           # a failure that ends this run's reads

    def __init__(self, hass: HomeAssistant, store: PlanAiStore, job: Job, ai: dict[str, Any]) -> None:
        self.hass, self.store, self.job, self.ai = hass, store, job, ai
        self.halt: str | None = None        # a failure in HALTS met: no more reads this run
        self.t0 = time.monotonic()
        self.consecutive_timeouts = 0
        self.cut_short = False              # the budget ran out before a read this session wanted
        self.phase = "whole"                # which reads are under way: whole, crop, railing, tiles, light_crop
        self.first_read_s: float | None = None   # how long the first answer took: a slow AI reads no tiles
        self.files: dict[str, Any] = {}     # map id → the plan's picture on disk, for its crops
        self.crops: dict[int, tuple[bytes, int, int]] = {}   # a find (by id) → its crop, for the railing question; never stored

    @property
    def sess(self) -> dict[str, Any]:
        return self.store.session(self.job.sid) or {}

    def left(self) -> float:
        return PLAN_BUDGET_S - (time.monotonic() - self.t0)

    def _err(self, reason: str) -> None:
        e = self.sess.setdefault("errors", {})
        e[reason] = int(e.get(reason) or 0) + 1
        _bump(self.hass, f"plan_ai_error:{reason}")

    async def _save(self) -> None:
        sess = self.sess
        sess["rev"] = int(sess.get("rev") or 0) + 1
        sess["spent_s"] = round(time.monotonic() - self.t0, 1)
        await self.store.async_save()

    def guard(self) -> str | None:
        """At every read boundary: the switch, the 3D house, the tier, and
        every plan as it was. A failed check ends the session, cancelled."""
        from .house3d_store import enabled as house3d_on  # noqa: PLC0415
        from .ws_common import _tier_at_least  # noqa: PLC0415
        if self.job.cancel or self.store.session(self.job.sid) is None:   # None: a restore or a reset took the session away
            return "user"
        if not enabled(self.hass):
            return "switch_off"
        if not house3d_on(self.hass):
            return "house3d_off"
        if not _tier_at_least(self.hass, "pro"):
            return "licence"
        for pl in self.sess.get("plans") or []:
            now = plan_now(self.hass, pl["map_id"])
            if now is None:
                return "plan_gone"
            if not same_picture(pl["image_sig"], now) or now["place_sig"] != pl["place_sig"]:
                return "plan_changed"
        return None

    def stop_here(self) -> bool:
        """Before a read inside a plan: a failed check, two timeouts in a row,
        or too little of the budget left to start one."""
        if self.guard() or self.consecutive_timeouts >= 2:
            return True
        if self.left() < P.READ_MIN_S:
            if not self.cut_short:
                self.cut_short = True
                self.sess["cut_short"] = self.phase
                _bump(self.hass, f"plan_ai_budget_cut:{self.phase}")
            return True
        return False

    def read_cap(self) -> float:
        """One read's time at most."""
        return PLAN_READ_LOCAL_S if self.ai.get("local") is True else P.PHOTO_TIMEOUT_S

    def count_secs(self, band: str) -> None:
        """How long a read took (PHOTO_SECS bands)."""
        _bump(self.hass, f"plan_ai_read_secs:{band}")

    def failed(self, err: BaseException) -> str:
        """The error a read that raised is counted under."""
        return "unreachable" if P.unreachable(err) else "bad_answer"

    def unusable(self, answer: Any) -> None:
        """An answer that couldn't be used: for the AI credit tracker."""
        U.unusable(self.hass, getattr(self, "last_by", None) or self.ai.get("ai_task"), answer)

    def retried(self) -> None:
        """The one retry of an answer that couldn't be used is under way."""

    def gave_up(self) -> None:
        """Neither answer could be used."""
        self._err("bad_answer")

    async def ask(self, prompt: str, raw: bytes, size: tuple[int, int] | None = None) -> Any:
        """One read inside the budget and the per-read cap; None on a failure
        (counted by reason). Two timeouts in a row end the session; a failure
        in HALTS ends the reads. The backup AI Task only where BACKUP.
        `size`: the picture's, as its executor job measured it (the estimate)."""
        sess = self.sess
        eid = str(self.ai.get("ai_task") or "")
        t0 = time.monotonic()
        sess["reads"] = int(sess.get("reads") or 0) + 1
        if "est_usd" in sess:                            # the line-up's own estimate of its reads (ai_usage's formula)
            try:
                usd = U.estimate_usd(U.price_of(U.model_of(self.hass, eid)), size, len(prompt))
                sess["est_usd"] = round(float(sess.get("est_usd") or 0.0) + (usd or 0.0), 5)
            except Exception:  # noqa: BLE001 — the estimate never stops a read
                pass
        timeout_s = max(1.0, min(self.read_cap(), self.left()))
        try:
            if self.BACKUP:
                answer, by = await P.ask_ai(self.hass, self.ai, prompt, None, raw, "image/jpeg", task_name=self.TASK, count=False, timeout_s=timeout_s)
            else:
                answer, by = await P.ask(self.hass, eid, prompt, None, raw, "image/jpeg", task_name=self.TASK, timeout_s=timeout_s), eid
        except TimeoutError:
            sess["timeouts"] = int(sess.get("timeouts") or 0) + 1
            self.consecutive_timeouts += 1
            self._err("timeout")
            return None
        except P._NoMedia:  # noqa: SLF001
            self._err("no_media")
            self.halt = "no_media" if "no_media" in self.HALTS else self.halt
            return None
        except Exception as err:  # noqa: BLE001 — any failure of the AI Task is one read lost
            _LOGGER.warning("PadSpan plans: the AI Task %s couldn't read a plan: %s", eid, P._why(err))  # noqa: SLF001
            why = self.failed(err)
            self._err(why)
            self.halt = why if why in self.HALTS else self.halt
            return None
        finally:
            self.count_secs(P._secs_event(time.monotonic() - t0).partition(":")[2])  # noqa: SLF001
        self.consecutive_timeouts = 0
        if self.first_read_s is None:
            self.first_read_s = time.monotonic() - t0
        self.last_by = by
        if by != self.ai.get("ai_task"):
            if not sess.get("backup_used"):              # counted per session, not per read (count=False above)
                _bump(self.hass, "ai_backup_used")
            sess["backup_used"] = True
            if frame_kind(self.hass, by) == "named":   # another model's frame: its positions hold corrections too
                sess["frame"] = "named"
        if answer is None:
            self._err("bad_answer")
            U.unusable(self.hass, by)
        return answer

    async def read(self, prompt: str, raw: bytes, parse, size: tuple[int, int] | None = None) -> Any:
        """One read, parsed, and once more on an answer that can't be parsed
        (parse → None): the design's one retry. None when nothing came of it."""
        answer = await self.ask(prompt, raw, size)
        if answer is None:
            return None
        got = parse(answer)
        if got is None:                                  # each answer that couldn't be used
            self.unusable(answer)
        if got is None and not self.stop_here():
            self.retried()
            answer = await self.ask(prompt, raw, size)
            if answer is None:
                return None
            got = parse(answer)
            if got is None:
                self.unusable(answer)
        if got is None:
            self.gave_up()
        return got

    async def read_plan(self, pl: dict, i: int) -> list[dict]:
        """One plan's whole read for stairs: its finds, in metres."""
        sess = self.sess
        model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        maps = self.hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        mid = pl["map_id"]
        m = maps.get_map(mid) if maps is not None else None
        fp = await self.hass.async_add_executor_job(
            lambda: maps.image_file(str(((m or {}).get("image") or {}).get("filename") or ""), must_exist=True))
        try:
            if fp is None:
                raise OSError("no image")
            raw, w, h = await self.hass.async_add_executor_job(S.shrink, fp)
        except Exception:  # noqa: BLE001 — a missing or unreadable picture: the AI was never asked
            self._err("no_picture")
            return []
        self.files[mid] = fp
        pl["frame"] = [w, h]
        to_m = lambda fx, fy: model.map_frac_to_metres(fx, fy, mid)  # noqa: E731
        sess["progress"] = {"plan": i + 1, "of": len(sess.get("plans") or []), "name": pl.get("name") or "", "step": "stairs"}
        await self._save()
        boxes = await self.read(S.PROMPT.format(w=w, h=h), raw, S._list_of)  # noqa: SLF001
        if boxes is None:
            return []
        pl["answered"] = True
        if sess.get("frame") != "probed" and suspect_frame(boxes, w, h):
            pl["suspect"] = True
            self._err("suspect_frame")
        counts: dict[str, int] = {}
        finds: list[dict] = []
        for b in boxes[:S.MAX_FOUND * 2]:
            got = S.stairs_from_answer([b], w, h, to_m, counts)
            if not got:
                continue
            bb = [float(v) for v in (b.get("bbox_2d") or b.get("bbox") or b.get("box"))]
            finds.append({**got[0], "map_id": mid, "plan_floor": pl["floor_id"], "frame": [w, h], "reads": ["whole"], "rail": None,
                          "box_px": [round(v, 1) for v in (min(bb[0], bb[2]), min(bb[1], bb[3]), max(bb[0], bb[2]), max(bb[1], bb[3]))]})
            if len(finds) >= S.MAX_FOUND:
                break
        for k, event in (("kept", "stair_box:kept"), ("dropped", "stair_box:dropped"), ("past_edge", "stair_box:past_edge")):
            if counts.get(k):
                _bump(self.hass, event, counts[k])
        return finds

    def _progress(self, f: dict, step: str) -> None:
        """Where the second looks are: the find's plan, and which of them."""
        plans_ = self.sess.get("plans") or []
        at = next((n for n, pl in enumerate(plans_) if pl["map_id"] == f["map_id"]), 0)
        self.sess["progress"] = {"plan": at + 1, "of": len(plans_), "name": (plans_[at].get("name") or "") if plans_ else "", "step": step}

    async def look_again(self, f: dict) -> bool:
        """The second look at one find, a crop round it, its side 2.5 × the
        find's, within CROP_M. False: it says nothing is there, and the find
        goes. A box places the find and is the box kept for the list, in the
        whole read's frame, so what is drawn is what the metres came from; any
        other answer leaves it as it was. A light's look also names its symbol."""
        light = f.get("kind") == "light"
        model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        mid = f["map_id"]
        to_m = lambda fx, fy: model.map_frac_to_metres(fx, fy, mid)  # noqa: E731
        w, h = f["frame"]
        x1, y1, x2, y2 = f["box_px"]
        mx = math.hypot(*(a - b for a, b in zip(to_m(1, 0) or (0, 0), to_m(0, 0) or (0, 0)))) or 1.0
        my = math.hypot(*(a - b for a, b in zip(to_m(0, 1) or (0, 0), to_m(0, 0) or (0, 0)))) or 1.0
        side = min(CROP_M[1], max(CROP_M[0], 2.5 * max((x2 - x1) / w * mx, (y2 - y1) / h * my)))
        self._progress(f, "light_check" if light else "check")
        try:
            craw, cw, ch, (bx0, by0, bx1, by1) = await self.hass.async_add_executor_job(
                crop, self.files[mid], (x1 + x2) / 2 / w, (y1 + y2) / 2 / h, side / 2 / mx, side / 2 / my)
        except Exception:  # noqa: BLE001 — a picture that won't crop: the find stays as the whole read had it
            return True
        if light:
            def parse(a: Any) -> tuple | None:
                got = crop_answer(a, cw, ch, LIGHT_CROP_MIN_FRAC)
                return None if got is None else (*got, symbol_of(a))
            seen = await self.read(LIGHT_CROP_PROMPT.format(w=cw, h=ch), craw, parse)
        else:
            self.crops[id(f)] = (craw, cw, ch)
            seen = await self.read(CROP_PROMPT.format(w=cw, h=ch), craw, lambda a: crop_answer(a, cw, ch))
        if seen is None:
            return True
        f["reads"].append("crop")
        present, at = seen[:2]
        if light:
            f["symbol"] = seen[2]
        if not present:
            key = "light_dropped" if light else "crop_dropped"
            self.sess[key] = int(self.sess.get(key) or 0) + 1
            _bump(self.hass, f"plan_ai_crop:{'light_' if light else ''}dropped")
            return False
        spot = None
        if at:
            fx0, fy0, fx1, fy1 = bx0 + at[0] * (bx1 - bx0), by0 + at[1] * (by1 - by0), bx0 + at[2] * (bx1 - bx0), by0 + at[3] * (by1 - by0)
            spot = to_m((fx0 + fx1) / 2, (fy0 + fy1) / 2)
        if spot:
            f.update(x_m=round(spot[0], 3), y_m=round(spot[1], 3), box_px=[round(fx0 * w, 1), round(fy0 * h, 1), round(fx1 * w, 1), round(fy1 * h, 1)])
        _bump(self.hass, f"plan_ai_crop:{'light_' if light else ''}{'placed' if spot else 'kept'}")
        return True

    async def second_looks(self, finds: list[dict]) -> list[dict]:
        """After every plan's whole read, in the design's order, so a slow AI
        loses the extras and not a plan: every find's crop, then every kept
        find's railing question. Cut short, the finds not looked at again stay
        as the whole read had them."""
        kept: list[dict] = []
        self.phase = "crop"
        for n, f in enumerate(finds):
            if self.stop_here():
                kept.extend(finds[n:])
                break
            if await self.look_again(f):
                kept.append(f)
            await self._save()
        kinds = {pl["map_id"]: pl.get("kinds") or [] for pl in self.sess.get("plans") or []}
        self.phase = "railing"
        for f in kept:
            got = self.crops.get(id(f))
            if not got or "railing" not in kinds.get(f["map_id"], []):
                continue
            if self.stop_here():
                break
            self._progress(f, "railing")
            ans = await self.ask(RAIL_PROMPT.format(w=got[1], h=got[2]), got[0])
            if ans is not None:
                yes, side = rail_of(ans)
                f["rail"] = {"drawn": yes, "side": side if f["sure_up"] else None}
            await self._save()
        return kept

    async def read_lights(self) -> None:
        """Last of all, so a slow AI loses the lights and not a stair: each plan
        marked Yes in tiles, then one crop check per find. A first read over
        TILE_SLOW_S skips them and says so. Cut short, what was read stays."""
        sess = self.sess
        yes = [pl for pl in sess.get("plans") or [] if "light" in (pl.get("kinds") or []) and pl.get("read") and pl["map_id"] in self.files and pl.get("frame")]
        if not yes:
            return
        if (self.first_read_s or 0.0) > TILE_SLOW_S:
            sess["tiles_skipped"] = "slow"
            _bump(self.hass, "plan_ai_tiles_slow")
            return
        model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        finds: list[dict] = []
        self.phase = "tiles"
        for pl in yes:
            if self.stop_here():
                break
            mid = pl["map_id"]
            try:
                parts = await self.hass.async_add_executor_job(tiles, self.files[mid])
            except Exception:  # noqa: BLE001 — a picture that won't cut: this plan's lights stay unread
                self._err("no_picture")
                continue
            W, H = pl["frame"]
            plans_ = sess.get("plans") or []
            for n, (raw, w, h, (bx0, by0, bx1, by1)) in enumerate(parts):
                if self.stop_here():
                    break
                sess["progress"] = {"plan": plans_.index(pl) + 1, "of": len(plans_), "name": pl.get("name") or "", "step": "tiles", "tile": n + 1}
                sess["tiles"] = int(sess.get("tiles") or 0) + 1
                await self._save()
                got = await self.read(TILE_PROMPT.format(w=w, h=h), raw, lambda a, w=w, h=h: tile_lights(a, w, h))
                if got is None:
                    continue
                if sess.get("frame") != "probed" and suspect_frame(got, w, h) and not pl.get("suspect"):
                    pl["suspect"] = True
                    self._err("suspect_frame")
                for b in got:
                    x1, y1, x2, y2 = b["bbox_2d"]
                    fx0, fy0 = bx0 + x1 / w * (bx1 - bx0), by0 + y1 / h * (by1 - by0)
                    fx1, fy1 = bx0 + x2 / w * (bx1 - bx0), by0 + y2 / h * (by1 - by0)
                    at = model.map_frac_to_metres((fx0 + fx1) / 2, (fy0 + fy1) / 2, mid)
                    if at:
                        finds.append({"kind": "light", "map_id": mid, "plan_floor": pl["floor_id"], "floor_id": pl["floor_id"], "frame": [W, H], "reads": ["tile"], "symbol": "unknown",
                                      "x_m": round(at[0], 3), "y_m": round(at[1], 3),
                                      "box_px": [round(fx0 * W, 1), round(fy0 * H, 1), round(fx1 * W, 1), round(fy1 * H, 1)]})
                sess["light_finds"] = capped_lights(merge_lights(finds))
        merged = sess.get("light_finds") or []
        self.phase = "light_crop"
        kept: list[dict] = []
        for n, f in enumerate(merged):
            if self.stop_here():
                kept.extend(merged[n:])
                break
            if await self.look_again(f):
                kept.append(f)
            await self._save()
        sess["light_finds"] = kept

    def conflate_lights(self, house: dict | None, by_map: dict[str, dict], rejects: dict, sugs: dict[str, dict]) -> None:
        """Every light find against the placed lights: a suggestion each. A
        light is never moved or added here: at most its kind may change, on a
        commit. A coarse frame offers no correction: a symbol can't be said to
        be on a light there, so it is unmatched, and says why."""
        sess = self.sess
        lights = placed_lights(self.hass, house)
        offered: set[tuple[str, str]] = set()
        for f in merge_lights(sess.get("light_finds") or []):
            if len(sugs) >= MAX_SUGGESTIONS:
                break
            pl = by_map.get(f["map_id"]) or {}
            symbol = f.get("symbol") or "unknown"
            match = classify_light(f["floor_id"], f["x_m"], f["y_m"], symbol, lights, offered)
            if sess.get("frame") == "named":
                match["held"] = "frame"
                if match["relation"] == "correction":
                    match.update(relation="unmatched", target=None, target_snap=None, distance_m=None)
                    match.pop("want_kind", None)
            elif match["relation"] == "correction" and int(pl.get("refs") or 0) == 0:
                match["held"] = "eye"
            if match["held"]:
                _bump(self.hass, f"plan_ai_held:{match['held']}")
            if match["relation"] == "correction":
                offered.add((match["target"], symbol))
            sid = "sug_" + secrets.token_hex(4)
            sug = {"id": sid, "kind": "light", "map_id": f["map_id"], "floor_id": f["floor_id"], "box_px": f["box_px"], "frame": f["frame"],
                   "seen_on": f["seen_on"], "reads": f["reads"], "geom": {"x_m": f["x_m"], "y_m": f["y_m"], "symbol": symbol}, "match": match,
                   "state": "queued", "verdict": None, "piece_id": None}
            rk = remembered_reject(rejects, "light", f["map_id"], (pl.get("image_sig") or "", pl.get("image_sig_was") or ""), pl.get("place_sig") or "", f["x_m"], f["y_m"])
            if match["relation"] == "duplicate":
                sug["state"] = "duplicate"
                if symbol != "unknown":            # a mark nobody read a symbol from isn't "already there"
                    _bump(self.hass, "plan_ai_duplicate:light")
            elif rk:
                sug["state"] = "failure"
                sug["verdict"] = {"v": "failure", "at": time.time(), "why": (rejects[rk] or {}).get("why"), "remembered": True, "reject": rk}
            elif match["relation"] == "unmatched":
                sug["state"] = "unmatched"
                _bump(self.hass, "plan_ai_light_unmatched")
            else:
                _bump(self.hass, "plan_ai_suggested:light")
            sugs[sid] = sug

    async def conflate(self) -> None:
        """Every find of the session against the house and each other; the
        suggestions. Run at the end, and after a cancel, on what was read."""
        from .house3d_store import ReadFailed, async_get_store as house_store  # noqa: PLC0415
        sess = self.sess
        model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        floors = floor_order(model)
        try:
            house = (await house_store(self.hass)).data
        except ReadFailed:
            house = None
        stairs = stair_pieces(house)
        by_map = {pl["map_id"]: pl for pl in sess.get("plans") or []}
        placed = []
        for f in sess.get("finds") or []:
            fid = floor_of_find(floors, f["plan_floor"], f.get("says") or "")
            if fid is None:                                # no floor for it to climb from (a house of one storey)
                sess["no_floor"] = int(sess.get("no_floor") or 0) + 1
                _bump(self.hass, "plan_ai_no_floor")
                continue
            placed.append({**f, "floor_id": fid})
        merged = merge_across_plans(placed)
        rejects = self.store.data.get("rejects") or {}
        sugs: dict[str, dict] = {}
        matched: set[str] = set()
        for f in merged:
            if len(sugs) >= MAX_SUGGESTIONS:
                break
            pl = by_map.get(f["map_id"]) or {}
            implied = floor_step(floors, f["floor_id"], 1)
            match = classify(f["floor_id"], implied, f["x_m"], f["y_m"], stairs, matched)
            # Two plans disagreeing about one staircase: both stay, each named; nothing wins silently.
            match["others"] = [{"map_id": g["map_id"], "distance_m": round(d, 2)} for g, d in
                               ((g, math.hypot(g["x_m"] - f["x_m"], g["y_m"] - f["y_m"])) for g in merged
                                if g is not f and g["floor_id"] == f["floor_id"] and g["map_id"] != f["map_id"]) if DUP_M < d <= CORR_M]
            if sess.get("frame") == "named":
                match["held"] = "frame"
            elif match["relation"] == "correction" and int(pl.get("refs") or 0) == 0:
                match["held"] = "eye"
            if match["held"] == "frame" and match["relation"] == "correction":
                match["relation"] = "new"                 # a coarse frame never advises a move
            if match["held"]:
                _bump(self.hass, f"plan_ai_held:{match['held']}")
            if match["relation"] == "correction":
                tgt = next((st for st in stairs if st["id"] == match["target"]), None)
                _bump(self.hass, "plan_ai_correction_target:hand" if tgt and tgt["hand"] else "plan_ai_correction_target:ai")
            if match["relation"] == "stacked":
                _bump(self.hass, "plan_ai_stacked:offered")
            if match["target"] and match["relation"] in ("duplicate", "correction"):
                matched.add(match["target"])
            sid = "sug_" + secrets.token_hex(4)
            geom = {k: f[k] for k in ("x_m", "y_m", "rotation", "width_m", "depth_m", "shape", "says", "sure_up")}
            sug = {"id": sid, "kind": "stairs", "map_id": f["map_id"], "floor_id": f["floor_id"], "box_px": f["box_px"],
                   "frame": f["frame"], "seen_on": f["seen_on"], "reads": f["reads"], "geom": geom, "match": match,
                   "state": "queued", "verdict": None, "piece_id": None, "says": f.get("says") or ""}
            rk = remembered_reject(rejects, "stairs", f["map_id"], (pl.get("image_sig") or "", pl.get("image_sig_was") or ""), pl.get("place_sig") or "", f["x_m"], f["y_m"])
            if match["relation"] == "duplicate":
                sug["state"] = "duplicate"
                _bump(self.hass, "plan_ai_duplicate:stairs")
            elif rk:
                sug["state"] = "failure"
                sug["verdict"] = {"v": "failure", "at": time.time(), "why": (rejects[rk] or {}).get("why"), "remembered": True, "reject": rk}
            else:
                _bump(self.hass, "plan_ai_suggested:stairs")
            sugs[sid] = sug
            # A railing hint beside a kept or existing stair: the side only where the arrow was read.
            rail = f.get("rail")
            if not (rail and rail.get("drawn")) or sug["state"] not in ("queued", "duplicate") or len(sugs) >= MAX_SUGGESTIONS:
                continue
            on = next((st for st in stairs if st["id"] == match["target"]), None) if match["relation"] in ("duplicate", "correction") else None
            side = rail.get("side")
            rid = "sug_" + secrets.token_hex(4)
            rel = rail_relation(on["rail"], side, on["shape"]) if on else "new"
            hint = {"id": rid, "kind": "railing", "of_stair": sid, "map_id": f["map_id"], "floor_id": f["floor_id"], "box_px": f["box_px"],
                    "frame": f["frame"], "seen_on": f["seen_on"], "reads": ["crop"],
                    "geom": {"stair": on["id"] if on else sid, "side": side, "x_m": geom["x_m"], "y_m": geom["y_m"]},
                    "match": {"target": on["id"] if on else None, "distance_m": None, "relation": rel, "near": [], "held": match["held"],
                              "target_snap": target_snap(on) if on else None, "have": on["rail"] if on else None},
                    "state": "queued", "verdict": None, "piece_id": None}
            rk = remembered_reject(rejects, "railing", f["map_id"], (pl.get("image_sig") or "", pl.get("image_sig_was") or ""), pl.get("place_sig") or "", geom["x_m"], geom["y_m"])
            if rel == "duplicate":
                hint["state"] = "duplicate"
                _bump(self.hass, "plan_ai_duplicate:railing")
            elif rk:
                hint["state"] = "failure"
                hint["verdict"] = {"v": "failure", "at": time.time(), "why": (rejects[rk] or {}).get("why"), "remembered": True, "reject": rk}
            else:
                _bump(self.hass, "plan_ai_suggested:railing")
            sugs[rid] = hint
        if sess.get("light_finds"):
            self.conflate_lights(house, by_map, rejects, sugs)
        sess["suggestions"] = sugs

    def no_read(self) -> str | None:
        """Why no plan's whole read answered, in the failed reads' own word,
        or None: one answered, or no read failed (nothing was tried)."""
        sess = self.sess
        if any(pl.get("answered") for pl in sess.get("plans") or []):
            return None
        errors = sess.get("errors") or {}
        return max((k for k in NO_READ_WHY if errors.get(k)), key=lambda k: errors[k], default=None)

    async def run(self) -> None:
        sess = self.sess
        _bump(self.hass, "plan_ai_session:started")
        _bump(self.hass, f"plan_ai_model:{'local' if self.ai.get('local') is True else 'cloud' if self.ai.get('local') is False else 'unknown'}")
        _bump(self.hass, f"plan_ai_frame:{sess.get('frame')}")
        n = len(sess.get("plans") or [])
        _bump(self.hass, f"plan_ai_plans:{_band(n, ((1, '1'), (3, '2_3'), (6, '4_6')), 'gt6')}")
        status, why = "done", None
        # Home Assistant stopping cancels this task (a CancelledError goes straight through):
        # the file still says running, and the next load sweeps it to failed, reason restart.
        try:
            await self._save()
            for i, pl in enumerate(sess.get("plans") or []):
                why = self.guard()
                if why:
                    status = "cancelled"
                    break
                if self.consecutive_timeouts >= 2:
                    status = "out_of_time"
                    break
                if self.left() < P.READ_MIN_S:
                    sess["skipped"] = int(sess.get("skipped") or 0) + 1
                    self._err("budget")
                    continue
                finds = await self.read_plan(pl, i)
                pl["read"] = True
                sess.setdefault("finds", []).extend(finds)
                await self._save()
            if status == "done":
                sess["finds"] = await self.second_looks(sess.get("finds") or [])
                await self.read_lights()
            if status == "done":                       # one that came during the second looks: no next plan to notice it
                why = self.guard()
                status = "cancelled" if why else status
            if status == "done" and (sess.get("skipped") or self.consecutive_timeouts >= 2 or self.cut_short):
                status = "out_of_time"
        except Exception as err:  # noqa: BLE001 — the session fails; nothing else is touched
            _LOGGER.warning("PadSpan plans: the session stopped: %s", P._why(err))  # noqa: SLF001
            status = "failed"
        try:
            await self.conflate()
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("PadSpan plans: the finds couldn't be matched: %s", P._why(err))  # noqa: SLF001
            status = "failed"
        sess = self.sess
        no_read = self.no_read() if status in ("done", "out_of_time") else None
        if no_read:                                    # it read nothing, which is not the same as finding nothing
            status = "failed"
        sess.pop("finds", None)                        # matched: the suggestions hold what is kept
        sess.pop("light_finds", None)
        sess.update(status=status, error=why if status == "cancelled" else no_read, finished_at=time.time())
        sess["progress"] = {"plan": n, "of": n, "name": "", "step": "done"}
        _bump(self.hass, f"plan_ai_session:{'no_read' if no_read else status}")
        if no_read:
            _bump(self.hass, f"plan_ai_no_read:{no_read}")
        if why:
            _bump(self.hass, f"plan_ai_cancel_why:{why}")
        reads = int(sess.get("reads") or 0)
        if reads:
            _bump(self.hass, f"plan_ai_reads:{_band(reads, ((5, '1_5'), (15, '6_15'), (40, '16_40')), 'gt40')}")
        if sess.get("lights_asked"):
            tiles_read = int(sess.get("tiles") or 0)
            _bump(self.hass, f"plan_ai_tiles:{_band(tiles_read, ((0, 'none'), (9, '1_9'), (27, '10_27')), 'gt27')}")
        await self._save()


def start(hass: HomeAssistant, store: PlanAiStore, ai: dict[str, Any], plans_: list[dict], kinds: list[str], frame: str, fixtures: dict[str, str] | None = None) -> str:
    """Make a session and start its task. The id. Nothing here waits, so a
    second press finds the job (already_running), and a status check never
    sees a session marked running with no job behind it."""
    sid = "ps_" + secrets.token_hex(4)
    dom = hass.data.setdefault(DOMAIN, {})
    now = time.monotonic()
    dom[_DATA_STARTS] = [t for t in dom.get(_DATA_STARTS, []) if now - t < 86400] + [now]
    store.data.setdefault("sessions", {})[sid] = new_session(ai, plans_, kinds, frame, fixtures)
    store.trim()
    job = Job(sid)
    dom[_DATA_JOB] = job
    # A background task: a read of a minute must not hold up Home Assistant's own shutdown or start.
    job.task = hass.async_create_background_task(Runner(hass, store, job, ai).run(), "padspan_ha plan_ai")
    return sid


def settle_rails(hass: HomeAssistant, sess: dict[str, Any], stair_id: str, why: str | None = None) -> list[dict]:
    """A stair marked wrong takes its railing hint out of the queue: there is
    nothing to check beside a stair that isn't there. "Already here" (Keep
    mine) says the stair is there, so a hint on the stair in the house stays.
    The hint keeps where it stood, for a take-back. No reject of its own: the
    stair's stops the hint coming back on the next read. The hints it changed."""
    out = []
    for hint in (sess.get("suggestions") or {}).values():
        if why == "already_here" and isinstance(hint, dict) and (hint.get("match") or {}).get("target"):
            continue
        if isinstance(hint, dict) and hint.get("of_stair") == stair_id and hint.get("state") in ("queued", "later", "stale"):
            hint["verdict"] = {"v": "settled", "at": time.time(), "stair": stair_id, "was": {"state": hint["state"], "verdict": hint.get("verdict")}}
            hint["state"] = "settled"
            _bump(hass, "plan_ai_verdict:railing_settled")
            out.append(hint)
    return out


def unsettle_rails(hass: HomeAssistant, sess: dict[str, Any], stair_id: str) -> list[dict]:
    """The stair's verdict taken back: its hint goes back where it stood."""
    out = []
    for hint in (sess.get("suggestions") or {}).values():
        if isinstance(hint, dict) and hint.get("of_stair") == stair_id and hint.get("state") == "settled":
            was = (hint.get("verdict") or {}).get("was") or {}
            hint["state"], hint["verdict"] = was.get("state") or "queued", was.get("verdict")
            _bump(hass, "plan_ai_taken_back:railing_settled")
            out.append(hint)
    return out


def check_session(hass: HomeAssistant, store: PlanAiStore, sess: dict[str, Any], house: dict | None) -> bool:
    """The target and signature checks on a session that is not running:
    a plan whose picture or placement changed since the read marks its
    suggestions still open stale; a correction whose target is gone or differs
    from its snapshot is stale too, and a railing hint whose stair was kept and
    is no longer there, and a duplicate of a stair that is gone; a light's correction when that light moved, went or
    was given another kind, and a duplicate of a light that is gone. `house` None (the 3D file couldn't be read): the
    targets aren't judged. Returns whether anything changed."""
    was_moved = {pl["map_id"] for pl in sess.get("plans") or [] if pl.get("changed")}
    moved = plans_moved(hass, sess)
    changed = moved != was_moved
    stairs = {st["id"]: st for st in stair_pieces(house)}
    sugs = sess.get("suggestions") or {}
    lights = {lt["id"]: lt for lt in placed_lights(hass, house)} if house is not None and any(
        isinstance(s, dict) and s.get("kind") == "light" for s in sugs.values()) else {}
    for sug in sugs.values():
        if not isinstance(sug, dict) or sug.get("state") not in ("queued", "later", "duplicate"):
            continue
        stale = sug.get("map_id") in moved
        match = sug.get("match") or {}
        if sug.get("kind") == "light":
            tgt = lights.get(match.get("target"))
            if sug.get("state") == "duplicate":
                stale = house is not None and bool(match.get("target")) and tgt is None
            elif not stale and house is not None and match.get("target"):
                stale = tgt is None or light_snap(tgt) != match.get("target_snap")
        elif sug.get("state") == "duplicate":        # "already in your house", until that stair is gone
            stale = house is not None and bool(match.get("target")) and match["target"] not in stairs
        elif not stale and house is not None and match.get("target") and (match.get("relation") in ("correction", "stacked") or sug.get("kind") == "railing"):
            tgt = stairs.get(match["target"])
            stale = tgt is None or target_snap(tgt) != match.get("target_snap")
        elif not stale and house is not None and sug.get("kind") == "railing":
            stair = sugs.get((sug.get("geom") or {}).get("stair")) or {}
            stale = stair.get("state") == "undone" or (str(stair.get("state")).startswith("committed") and stair.get("piece_id") not in stairs)
        if stale:
            sug["state"] = "stale"
            changed = True
            _bump(hass, "plan_ai_stale")
    if changed:
        sess["rev"] = int(sess.get("rev") or 0) + 1
    return changed


def puts_back(b: dict[str, Any]) -> bool:
    """Would undoing this batch put items back? Yes for an undo; no for what it
    undid, or for an undo of an undo, which kept them again. plan_ai_write.undo
    writes it on the batch it makes."""
    return bool(b.get("puts_back"))


def items_in(entries: Any) -> int:
    """How many suggestions a batch's entries hold: a stair and its railing are
    one entry (one before, one after) and two items to the person who kept them."""
    return sum(1 + len(e.get("also") or []) for e in entries or [])


def batch_summary(batches: dict[str, Any], batch_id: str) -> dict[str, Any]:
    """A batch as the sheet and Settings say it: how many items, and what
    undoing it does."""
    b = batches[batch_id]
    return {"id": batch_id, "session": b.get("session"), "at": b.get("committed_at"), "items": items_in(b.get("items")),
            "puts_back": puts_back(b)}


def track_record(store: PlanAiStore) -> dict[str, dict[str, int]]:
    """This house's own record, per kind, over the sessions kept: how many of
    the items a person decided were right (kept, or "looks right") of how many
    (those, and the ones marked wrong). No confidence number exists: this is
    the only figure the vetting map shows. Later, unmatched, undone and a
    remembered reject (nobody looked at it this time) don't count."""
    out: dict[str, dict[str, int]] = {}
    for sess in (store.data.get("sessions") or {}).values():
        for sug in (sess.get("suggestions") or {}).values() if isinstance(sess, dict) else ():
            if not isinstance(sug, dict):
                continue
            state, verdict = sug.get("state"), sug.get("verdict") or {}
            right = state in ("committed_new", "committed_correction", "right")
            if not right and not (state == "failure" and not verdict.get("remembered")):
                continue
            row = out.setdefault(str(sug.get("kind") or "stairs"), {"right": 0, "of": 0})
            row["of"] += 1
            row["right"] += 1 if right else 0
    return out


def last_batch(store: PlanAiStore, sid: str | None = None) -> dict[str, Any] | None:
    """The newest batch still standing (of one session, or of any): what "Undo
    this session" undoes. A batch in the middle of its two writes is not one."""
    batches = store.data.get("batches") or {}
    best = None
    for bid, b in batches.items():
        if not isinstance(b, dict) or b.get("undone_at") or b.get("pending") or not b.get("items") or (sid and b.get("session") != sid):
            continue
        if best is None or float(b.get("committed_at") or 0) > float(batches[best].get("committed_at") or 0):
            best = bid
    return batch_summary(batches, best) if best else None


# ══ Build from plans: line up (Stage 1; experimental) ═══════════════════════
# Design: PadspanResearch/plan-build-design-2026-11.md, sections 1-4, 8, 10, 14,
# 15. Claude reads the printed text; plan_geom.py measures; nothing here writes
# a placement (the writes are Stage 1b, reviewed apart).

# ── The numbers that can stop or hold it back, in one block (design 14) ─────
# Each was chosen for the reason beside it; the stall counters can move them,
# and a change goes to Garry by form first.
S1_BUDGET_S = 600            # one session's reads, all told (design 8)
S1_READ_S = 90               # one read (design 8; the worst of 175 reads through HA was 19.9 s)
S1_HELP_MAX = 3              # questions a floor (design 3.5); past it a plan is left out
S1_PLANS_MAX = 12            # plans a floor (design 4)
S1_DIMS_PER_AXIS = 2         # dimension strings read closely, per axis per plan (design 3.3)
S1_DIMS_AGREE = 0.015        # two readings of one axis agree within this (design 3.4.3)
S1_PARSE_AGREE = 0.005       # PadSpan's reading of the text and Claude's metres (design 3.4.1)
S1_SINGLE_CHANGE = 0.03      # one reading alone may change a plan's scale this much before it is confirmed (design 3.5)
S1_BIG_CHANGE = 0.10         # any change of scale over this is confirmed (the basement's 27 % would ask; design 3.5)
S1_ANCHOR_SHAPE = 0.03       # an anchor's two axes agree within this (design 3.1)
S1_ANCHOR_SCALE = 0.05       # and each is within this of its printed dimensions (design 3.1)
S1_ANCHOR_SMALL = 0.03       # an anchor's own error under this is information; from it an item, Not now by default (form q7)
S1_SAME_M = 0.10             # a proposal moving no corner further than this: "already lined up" (the acceptance tolerance)
S1_FLAG_M = 0.30             # a click landing this far from its stored metres is flagged (design 3.6)
S1_OUTLINE_ON_INK = 0.5      # under this share of the AI's outline on drawn walls, its positions are suspect. Design 3.2 had the
                             # outline's box against the ink's box (IoU < 0.7); on one test plan (Nov 9) that misfired at 0.43
                             # (patio and dimensions outside the walls are ink too), while on-ink read 0.54-0.87 right and
                             # 0.16-0.40 shifted or in a 0-1000 frame (dry run, 2026-11-09). The box IoU is still recorded.
S1_PICTURE_PX, S1_PICTURE_MP = 2560, 3.5      # what Claude is sent (design 3.2; Stage 0b: 4.1 MP was shrunk by the API)
S1_CROP_PX, S1_TEXT_MIN_PX = 2048, 14         # a dimension's crop: full resolution, no longer than this, 2× when its text is small.
                                              # Design 3.2 said 1024; the crop now runs the plan's whole length along the line
                                              # (a thin band, ~200 picture tokens), and a tall plan's text shrank at 1024.
S1_RESUMES_STRESS = 2        # Resume pressed more than this in one session: a stress signal (design 14)
S1_QUICK_ABANDON_S = 60      # a run left within this of a stop: a stress signal (design 14)
S1_ABANDON_DAYS = 14         # proposals with no verdict this long: abandoned (design 10)
S1_BACKUPS_KEPT = 6          # safety backups kept in the line-up's own slot, one before each save and undo: enough that a
                             # session's first save still has its "before" after five more (form q10)
MAX_LINEUPS = 10             # sessions kept (design 4)
PIXEL_FRAME = "pixel"        # Claude answers in the picture's own pixels (design 3.2)
TASK_NAME = "PadSpan plan build"   # ai_usage counts these reads as plan_build

# Every stop has a name, what happened and the one thing that gets it moving
# again (design 14). Counted per session, per month (this store's "stall") and
# in the opt-in report (plan_build_stop:<reason>). The ones marked 1b are
# reached by the writes (plan_ai_write.py); room_gate by Stage 2, named here so
# the block is whole.
STOPS: dict[str, tuple[str, str]] = {
    "locked": ("Line up plans needs Claude Opus 5.5 or newer as your AI Task.", "Choose one in Settings → AI."),
    "unreachable": ("Claude couldn't be reached; nothing was changed. What was read is kept.", "Resume when it's back."),
    "no_credit": ("Your Claude account is out of credit; no other AI is used for this. What was read is kept.",
                  "Add credit in the Anthropic Console, then Resume."),
    "out_of_time": ("The session ran out of time. What was read is kept.", "Resume reads the rest."),
    "no_media": ("Home Assistant's media folder couldn't take the plan for Claude.", "Check the media folder, then Resume."),
    "help_unanswered": ("A question is waiting for you.", "Answer it, or Skip."),
    "help_limit": ("This plan couldn't be lined up within three questions.", "Mapping → 3D Stack → Alignment Overlay lines it up by hand."),
    "refile_refused": ("This plan shows another floor, but things are drawn on it.", "Move it by hand in Mapping → 3D Stack if you're sure."),
    "measured_plan_protected": ("This is the plan that set your house's scale, so it is never moved here.",
                                "Measure it again in Mapping → Edit → Measure if it is wrong."),
    "anchor_error": ("The plan the others are lined up to disagrees with its own printed dimensions by 3 % or more.",
                     "Look at its item before you accept anything."),
    "no_anchor": ("No plan on this floor matches its own printed sizes, so there's nothing sure to line the others up to.",
                  "Look closely at every item, or measure one plan in Mapping → Edit → Measure."),
    "no_metre_scale": ("Your house has no scale yet: no plan has been measured.", "Measure one plan first in Mapping → Edit → Measure."),
    "not_placed": ("This floor has no plan with a scale yet.", "Measure one in Mapping → Edit → Measure first."),
    "fit_rejected": ("The match and the printed dimensions didn't agree for this plan.", "Tap the same corner on both plans."),
    "cancelled": ("The session was stopped. What was read is kept.", "Resume reads the rest."),
    "abandoned": ("The proposals were left without a verdict.", "Line up the floor again when you're ready."),
    "group_refused": ("Some items change calibration, devices or traced rooms, so they are accepted one by one.", "Accept them one at a time."),   # 1b
    "preflight_blocked": ("Most of this plan's calibration points would fall off its picture, so nothing was saved.",
                          "Mark it wrong, or line the plan up by hand in Mapping → 3D Stack → Alignment Overlay."),                                                  # 1b
    "backup_failed": ("The safety backup couldn't be made, so nothing was saved.", "Try again; check Home Assistant's storage."),          # 1b
    "changed_while_saving": ("A plan was changed in Mapping while this save was under way, so nothing of the line-up was written over it.",
                             "Line the floor up again."),                                                                                    # 1b
    "undo_failed": ("The undo couldn't be written, so nothing was changed: the line-up is still as saved.",
                    "Try again; or restore the backup taken before it in Manage → Data → Backup & Restore."),                                        # 1b
    "floor_gone": ("The floor this plan was to move to isn't in Home Assistant any more, so nothing was saved.",
        "Move it to a floor that exists in Mapping, or line the floor up again."),
    "plan_changed": ("A plan was moved, changed or removed in Mapping while this session read it, so what was read no longer fits it.",
        "Line the floor up again."),
    "ai_changed": ("Your AI Task changed since this session started; a session is read by one AI only.",
        "Line the floor up again."),
    "restart": ("Home Assistant restarted while this session was reading. What was read is kept.",
        "Resume reads the rest."),
    "bad_answer": ("Claude's answers couldn't be used for this floor's plans. What was read is kept.",
        "Resume tries again; if it keeps happening, line the plans up by hand in Mapping → 3D Stack → Alignment Overlay."),
    "refusal": ("Claude declined to read this floor's plans. What was read is kept.",
        "Resume tries again; if it keeps declining, line the plans up by hand in Mapping → 3D Stack → Alignment Overlay."),
    "error": ("Something went wrong in PadSpan while lining up this floor; nothing in your house was changed. What was read is kept.",
        "Resume tries again; Home Assistant's log says what went wrong."),
    "anchor_after_fit": ("Moving it or changing its scale now would leave them off their drawings, so nothing was saved.",
        "Undo this line-up session first, then save this plan on its own and line the floor up again."),
    "save_stands": ("A save of this line-up was cut short (Home Assistant stopped) and couldn't be put back, so it stands as saved.",
        "Look at the plans it saved; Undo this line-up session takes them back."),
    "undo_stands": ("An undo of this line-up was cut short (Home Assistant stopped) and couldn't be put back; the plans it reached are back where they were.",
        "Undo this line-up session takes the rest back."),
    "room_gate": ("These rooms and walls would place your calibration spots worse.", "Look at the rooms flagged."),                         # s2
}
STOPS_LATER: tuple[str, ...] = ("room_gate",)
STRESS: tuple[str, ...] = ("repeat", "help_over", "resumes", "quick_abandon")
WAIT_BANDS: tuple[str, ...] = ("lt1m", "1_10m", "10_60m", "gt1h")
WRONG_WHY: tuple[str, ...] = ("wrong_match", "wrong_scale", "wrong_floor", "cant_tell")
ITEM_KINDS: tuple[str, ...] = ("place", "refile", "anchor_scale")
LINEUP_STATUS: tuple[str, ...] = ("running", "needs_help", "done", "cancelled", "failed", "out_of_time", "no_credit")
LINEUP_RESUMABLE: tuple[str, ...] = ("out_of_time", "no_credit", "failed", "cancelled")   # what Resume carries on
LINEUP_NOT_RESUMABLE: tuple[str, ...] = ("plan_changed", "plan_gone", "ai_changed")       # unless it stopped for this: line up again

READ_A_PROMPT = (
    "This floor plan image is {w} by {h} pixels; give every position in those pixels, (0, 0) at the top left. Return JSON only: "
    "{{\"title\": the drawing's printed title or null, \"floor\": \"basement|ground|main|upper|second|third|attic|unknown\", "
    "\"rooms\": [{{\"name\": as printed, \"box\": [x1, y1, x2, y2]}}], \"stairs\": [{{\"box\": [x1, y1, x2, y2]}}], "
    "\"outline\": [[x, y], ...] the outside corners of the building's outer walls, clockwise, "
    "\"dimensions\": [{{\"text\": exactly as printed; where one dimension line is a chain of segments, every segment in order joined with \" + \", "
    "\"axis\": \"x\" for a line running across or \"y\" for one running down, \"box\": [x1, y1, x2, y2] around the whole dimension line with its text}}]}}. "
    "At most 12 dimensions: the lines that span the most of the building first (overall and chained lines outside the walls), short room dimensions last.")
READ_B_PROMPT = (
    "This is a crop of a floor plan, {w} by {h} pixels, around one dimension line running {way} through the middle of the crop. "
    "Return JSON only: {{\"text\": the dimension exactly as printed, \"metres\": the whole line's length in metres, "
    "\"chain\": [each segment's text in order] if this one line is a chain of segments, "
    "\"ends\": [[x, y], [x, y]] where the whole line starts and ends (its first and last tick marks, arrowheads or dots)}}.")
FLOOR_WORDS: tuple[str, ...] = ("basement", "ground", "main", "upper", "second", "third", "attic", "unknown")
# Words that say which floor a drawing shows (design 2): a floor whose name or id holds one of a group's words owns the group.
_FLOOR_GROUPS: tuple[frozenset[str], ...] = (frozenset({"basement", "lower", "cellar"}), frozenset({"main", "ground", "first"}),
                                             frozenset({"upper", "second", "top"}), frozenset({"third", "attic", "loft"}))
_ROOM_STOP = frozenset({"room", "rm", "the", "of", "and", "area", "space", "open", "to", "below", "above", "new", "existing"})


# ── Who may use it: the unlock rule (design 1, form q2) ──────────────────────
PLAN_BUILD_MIN: dict[str, tuple[int, int]] = {"opus": (5, 5), "fable": (5, 0), "mythos": (5, 0)}
_CLAUDE_MODEL = re.compile(r"claude-?(opus|fable|mythos|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?!\d)")


def claude_model(text: Any) -> tuple[str, tuple[int, int]] | None:
    """A Claude model's family and version from one name ("Claude Opus 5.5",
    "claude-opus-5-5", "claude-opus-5-5-20261201", "Claude Opus 6"), or None:
    lower-cased, "_ . space" made "-", then the design's pattern. Fails on
    "claude-opus-latest" and the old "claude-3-5-sonnet" order."""
    s = re.sub(r"[_.\s]+", "-", str(text or "").strip().lower())
    m = _CLAUDE_MODEL.search(s)
    if not m:
        return None
    return m.group(1), (int(m.group(2)), int(m.group(3) or 0))


def unlock_rule(platform: str | None, sources: list[str]) -> dict[str, Any]:
    """The pure rule: {ok, why, display, family}. Anthropic's integration only;
    every source that names a Claude model must read as one and qualify (Opus
    5.5 or newer, any Fable or Mythos; Sonnet and Haiku never, a family not
    listed never); sources disagreeing, or none readable: locked. Fails closed."""
    if platform != "anthropic":
        return {"ok": False, "why": "not_anthropic", "display": None, "family": None}
    read: list[tuple[str, tuple[int, int]]] = []
    for src in sources:
        if not isinstance(src, str) or not src.strip():
            continue
        got = claude_model(src)
        if got is None:
            if "claude" in src.lower():               # names Claude, but no model PadSpan can read: closed
                return {"ok": False, "why": "unknown_model", "display": None, "family": None}
            continue
        read.append(got)
    if not read:
        return {"ok": False, "why": "unknown_model", "display": None, "family": None}
    if len(set(read)) > 1:
        return {"ok": False, "why": "sources_disagree", "display": None, "family": None}
    fam, ver = read[0]
    display = f"Claude {fam.capitalize()} {ver[0]}.{ver[1]}"
    want = PLAN_BUILD_MIN.get(fam)
    if want is None or ver < want:
        return {"ok": False, "why": "below_opus_5_5", "display": display, "family": fam}
    return {"ok": True, "why": "ok", "display": display, "family": fam, "version": list(ver)}


def model_sources(hass: HomeAssistant, eid: str) -> list[str]:
    """Every name of the model behind an AI Task that can be read (design 1.3):
    the integration sub-entry's chat_model (Anthropic's), and its device's
    model and model id. The unlock and the AI credit tracker's price
    (ai_usage.model_of) both read the model here, through claude_model."""
    _ent, _entry, sub, dev = _registry(hass, eid)
    chat = (getattr(sub, "data", None) or {}).get("chat_model")
    return ([chat] if isinstance(chat, str) else []) + [v for v in (getattr(dev, k, None) for k in ("model", "model_id")) if isinstance(v, str)]


def unlock(hass: HomeAssistant) -> dict[str, Any]:
    """unlock_rule on the main AI Task (the backup never counts): {ok, why,
    display}; why no_ai_task when none is chosen."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    eid = str(((st.data if st else {}) or {}).get("atlas_3d_ai_task_entity") or "").strip()
    if not eid.startswith("ai_task."):
        return {"ok": False, "why": "no_ai_task", "display": None, "family": None}
    return {**unlock_rule(P._platform(hass, eid), model_sources(hass, eid)), "ai_task": eid}  # noqa: SLF001


def claude_unchosen(hass: HomeAssistant) -> bool:
    """An AI Task other than the chosen one that unlock_rule passes: a usable
    Claude is set up but not picked in Settings → AI (the report's
    env.ai.claude_available, design J.3)."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    chosen = str(((st.data if st else {}) or {}).get("atlas_3d_ai_task_entity") or "").strip()
    return any(eid != chosen and unlock_rule(P._platform(hass, eid), model_sources(hass, eid)).get("ok")  # noqa: SLF001
               for eid in hass.states.async_entity_ids("ai_task"))


def build_switch(hass: HomeAssistant) -> bool:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return ((st.data if st else {}) or {}).get("ai_plan_build_enabled") is True


def build_on(hass: HomeAssistant) -> bool:
    """The effective rule (design 1): the master switch, this switch, and Claude unlocked."""
    return enabled(hass) and build_switch(hass) and bool(unlock(hass).get("ok"))


def unlock_event(u: dict[str, Any]) -> str:
    """The tier only, never a version (design 10)."""
    if u.get("ok"):
        return "opus" if u.get("family") == "opus" else "fable" if u.get("family") == "fable" else "other"
    return str(u.get("why") or "unknown_model")


# ── The stall watch (design 14) ──────────────────────────────────────────────

def _month() -> str:
    return time.strftime("%Y-%m", time.localtime())


def _band_s(s: float) -> str:
    return "lt1m" if s < 60 else "1_10m" if s < 600 else "10_60m" if s < 3600 else "gt1h"


def _band_m(m: float) -> str:
    return "lt0_3" if m < 0.3 else "0_3_1" if m < 1 else "1_3" if m < 3 else "gt3"


def _scale_band(pct: float) -> str:
    return "lt1" if pct < 1 else "1_3" if pct < 3 else "3_10" if pct < 10 else "gt10"


def _bump_once(hass: HomeAssistant, event: str) -> None:
    """Counted once a report window (the counters empty on each take)."""
    try:
        from .telemetry import _DATA_COUNTERS  # noqa: PLC0415
        if int((hass.data.get(DOMAIN, {}).get(_DATA_COUNTERS) or {}).get(event) or 0) > 0:
            return
    except Exception:  # noqa: BLE001
        pass
    _bump(hass, event)


def note_stop(hass: HomeAssistant, data: dict[str, Any], sess: dict[str, Any] | None, reason: str, map_id: str | None = None) -> dict[str, Any]:
    """One stop: kept on the session (with its plan), counted for the month in
    this store and in the opt-in report; the same reason twice in a session is
    a stress signal. The record, as the screen says it. A scale read's
    (stage s0) is kept on its session only: those counts carry no stage word
    and are the line-up's (its run's end is in plan_build_run:s0_*)."""
    reason = reason if reason in STOPS else "cancelled"
    rec = {"reason": reason, "at": time.time(), **({"map_id": map_id} if map_id else {})}
    counted = not (sess is not None and sess.get("stage") == "s0")
    if sess is not None:
        stops = sess.setdefault("stops", [])
        if counted and sum(1 for s in stops if s.get("reason") == reason) == 1:
            _bump(hass, "plan_build_stress:repeat")
        stops.append(rec)
        del stops[:-50]
    if not counted:
        return rec
    stall = data.setdefault("stall", {})
    month = stall.setdefault(_month(), {})
    month[reason] = int(month.get(reason) or 0) + 1
    for old in sorted(stall)[:-13]:
        stall.pop(old, None)
    _bump(hass, f"plan_build_stop:{reason}")
    return rec


def stop_resolved(hass: HomeAssistant, sess: dict[str, Any], reasons: tuple[str, ...]) -> None:
    """The person moved on from the newest open stop of these reasons: how long they waited."""
    for rec in reversed(sess.get("stops") or []):
        if rec.get("reason") in reasons and "waited_s" not in rec:
            rec["waited_s"] = round(max(0.0, time.time() - float(rec.get("at") or time.time())), 1)
            _bump(hass, f"plan_build_wait:{_band_s(rec['waited_s'])}")
            return


def stop_words(rec: dict[str, Any]) -> dict[str, Any]:
    what, way = STOPS.get(str(rec.get("reason")), ("", ""))
    return {**rec, "say": what, "next": way}


# ── What the house holds, read once for the local steps ──────────────────────

def house_snapshot(hass: HomeAssistant) -> dict[str, Any]:
    """The plans, placements, drawn things, calibration points, rooms and
    device positions the line-up looks at, as plain data (the local steps
    are pure). Read only."""
    from .const import DATA_CALIBRATION  # noqa: PLC0415
    from .fabric_truth import metre_gauge  # noqa: PLC0415
    dom = hass.data.get(DOMAIN, {})
    model, maps, cal = dom.get(DATA_MODEL), dom.get(DATA_MAPS), dom.get(DATA_CALIBRATION)
    names = {str(f.get("id") or ""): str(f.get("name") or f.get("id") or "") for f in (model.floors() if model is not None else [])}
    floors = [{**f, "name": names.get(f["id"], f["id"])} for f in floor_order(model)]
    gauge = metre_gauge(model) if model is not None else None
    points = []
    for p in (cal.list_points() if cal is not None and hasattr(cal, "list_points") else []):
        if isinstance(p, dict) and p.get("map_id"):
            points.append({k: p.get(k) for k in ("id", "map_id", "x_frac", "y_frac", "x_m", "y_m", "floor_id", "room")})
    plans_: dict[str, Any] = {}
    for m in (maps.list_maps() if maps is not None else []):
        mid = str(m.get("id") or "")
        t = model.map_transform(mid) if model is not None else None
        image = m.get("image") or {}
        if not mid or not isinstance(t, dict):
            continue
        cal_n = sum(1 for p in points if p["map_id"] == mid)
        plans_[mid] = {"name": str(m.get("name") or "")[:80], "floor_id": str(m.get("floor_id") or ""),
                       "size": [int(image.get("width") or 0), int(image.get("height") or 0)],
                       "t": {k: t.get(k) for k in G.FIELDS if t.get(k) is not None}, "refs": len(t.get("reference_measurements") or []),
                       "image_sig": image_sig(m), "image_sig_was": legacy_image_sig(m), "place_sig": place_sig(t),
                       "room_bounds": {str(k): (v or {}).get("points") or [] for k, v in (m.get("room_bounds") or {}).items() if isinstance(v, dict)},
                       "receivers": [r for r in m.get("receivers") or [] if isinstance(r, dict)],
                       "beacons": [b for b in m.get("beacons") or [] if isinstance(b, dict)],
                       "lights": [li for li in m.get("lights") or [] if isinstance(li, dict)],
                       "drawn": {"rooms": len(m.get("room_bounds") or {}), "calibration": cal_n, "receivers": len(m.get("receivers") or []),
                                 "beacons": len(m.get("beacons") or []), "lights": len(m.get("lights") or [])}}
    return {"floors": floors, "gauge_map": (gauge or {}).get("source_map_id"), "gauge": bool(gauge), "plans": plans_, "calibration": points,
            "rooms": {str(k): {"floor_id": str(v.get("floor_id") or ""), "points_m": v.get("points_m") or []}
                      for k, v in (model.room_geometry_m() if model is not None else {}).items() if isinstance(v, dict)},
            "scanners": dict(model.scanner_positions_m() if model is not None else {}),
            "beacons": dict(model.beacon_positions_m() if model is not None else {}),
            "lights": dict(model.light_positions_m() if model is not None else {})}


def drawn_total(drawn: dict[str, int]) -> int:
    return sum(int(v or 0) for v in (drawn or {}).values())


# ── Reading the answers ──────────────────────────────────────────────────────

def _box(v: Any, w: int, h: int, k: float) -> list[float] | None:
    """A box in the sent frame, checked against it and turned into the
    picture's own pixels (÷ k, the sent size over the picture's)."""
    if not isinstance(v, (list, tuple)) or len(v) != 4:
        return None
    xs = [S._num(x) for x in v]  # noqa: SLF001
    if any(x is None for x in xs):
        return None
    x1, x2, y1, y2 = min(xs[0], xs[2]), max(xs[0], xs[2]), min(xs[1], xs[3]), max(xs[1], xs[3])
    e = S.PAST_EDGE_FRAC
    if x1 < -e * w or y1 < -e * h or x2 > (1 + e) * w or y2 > (1 + e) * h or x2 - x1 < 1 or y2 - y1 < 1:
        return None
    return [round(max(0.0, x1) / k, 1), round(max(0.0, y1) / k, 1), round(min(float(w), x2) / k, 1), round(min(float(h), y2) / k, 1)]


def _short(v: Any, n: int = 40) -> str | None:
    s = " ".join(str(v).split())[:n] if isinstance(v, str) else None
    return s or None


def parse_read_a(answer: Any, w: int, h: int, k: float = 1.0) -> dict[str, Any] | None:
    """Read A reduced to numbers, closed words and short names (design 3.3):
    the title and room names cut to 40 characters, the floor word from its
    closed list, boxes and corners in the picture's own pixels. None when it
    isn't the object asked for."""
    o = json_object(answer)
    if o is None or not any(key in o for key in ("dimensions", "rooms", "outline", "stairs")):
        return None
    floor = str(o.get("floor") or "unknown").strip().lower()
    rooms = []
    for r in (o.get("rooms") or [])[:40]:
        if isinstance(r, dict) and _short(r.get("name")):
            rooms.append({"name": _short(r.get("name")), "box": _box(r.get("box"), w, h, k)})
    stairs = [b for b in (_box(s.get("box") if isinstance(s, dict) else s, w, h, k) for s in (o.get("stairs") or [])[:8]) if b]
    outline = []
    for p in (o.get("outline") or [])[:40]:
        if isinstance(p, (list, tuple)) and len(p) == 2 and all(S._num(x) is not None for x in p):  # noqa: SLF001
            outline.append([round(S._num(p[0]) / k, 1), round(S._num(p[1]) / k, 1)])  # noqa: SLF001
    dims = []
    for d in (o.get("dimensions") or [])[:12]:
        if not isinstance(d, dict):
            continue
        axis = str(d.get("axis") or "").strip().lower()
        box = _box(d.get("box"), w, h, k)
        if axis in ("x", "y") and box:
            dims.append({"text": _short(d.get("text"), 24), "axis": axis, "box": box})
    return {"title": _short(o.get("title")), "floor_word": floor if floor in FLOOR_WORDS else "unknown",
            "rooms": rooms, "stairs": stairs, "outline": outline, "dims": dims, "suspect": False}


def parse_read_b(answer: Any, w: int, h: int) -> dict[str, Any] | None:
    """Read B reduced: the printed text (24 characters), Claude's metres, the
    chain's segments' texts, the two ends in the crop's pixels. None when
    there is no text or length to check."""
    o = json_object(answer)
    if o is None:
        return None
    text = _short(o.get("text"), 24)
    metres = S._num(o.get("metres"))  # noqa: SLF001
    chain = [_short(c, 24) for c in (o.get("chain") or []) if _short(c, 24)][:24] if isinstance(o.get("chain"), list) else []
    ends = None
    e = o.get("ends")
    if isinstance(e, list) and len(e) == 2 and all(isinstance(p, (list, tuple)) and len(p) == 2 for p in e):
        pts = [[S._num(p[0]), S._num(p[1])] for p in e]  # noqa: SLF001
        if all(v is not None for p in pts for v in p) and all(-0.05 * w <= p[0] <= 1.05 * w and -0.05 * h <= p[1] <= 1.05 * h for p in pts):
            ends = pts
    if metres is None or metres <= 0 or not (text or chain):
        return None
    return {"text": text, "metres": round(metres, 4), "chain": chain, "ends": ends}


# ── Pictures and crops (executor) ────────────────────────────────────────────

def picture(path) -> tuple[bytes, int, int, int, int]:
    """The whole plan for read A: ws_house3d_stairs.shrink in the pixel
    frame, at most S1_PICTURE_PX and S1_PICTURE_MP; and the picture's own size."""
    from PIL import Image  # noqa: PLC0415
    raw, w, h = S.shrink(path, S1_PICTURE_PX, S1_PICTURE_MP, framed=False)
    with Image.open(path) as im:
        W, H = im.size
    return raw, w, h, W, H


def dim_crop(path, box: list[float], axis: str) -> tuple[bytes, int, int, tuple[float, float, float, float]]:
    """The crop round one dimension line for read B: the plan's whole width
    (or height) along the line, so a chain is seen end to end (read A's boxes
    stop short: dry run, 2026-11-09), a band across it; full resolution, the
    long side at most S1_CROP_PX, twice the size when the line's box is under
    S1_TEXT_MIN_PX across (small text); and how its pixels map back:
    (x0, y0, kx, ky), picture = (x0 + u / kx, y0 + v / ky)."""
    from PIL import Image  # noqa: PLC0415
    import io  # noqa: PLC0415
    with Image.open(path) as im:
        im = im.convert("RGB")
        W, H = im.size
        x1, y1, x2, y2 = box
        across = (y2 - y1) if axis == "x" else (x2 - x1)
        pc = max(24.0, across)
        cx0, cx1 = (0, W) if axis == "x" else (x1 - pc, x2 + pc)
        cy0, cy1 = (y1 - pc, y2 + pc) if axis == "x" else (0, H)
        cx0, cy0, cx1, cy1 = max(0, int(cx0)), max(0, int(cy0)), min(W, int(math.ceil(cx1))), min(H, int(math.ceil(cy1)))
        part = im.crop((cx0, cy0, max(cx0 + 8, cx1), max(cy0 + 8, cy1)))
        k = 1.0
        if max(part.size) > S1_CROP_PX:
            k = S1_CROP_PX / max(part.size)
        elif across < S1_TEXT_MIN_PX:
            k = min(2.0, S1_CROP_PX / max(part.size))
        if k != 1.0:
            part = part.resize((max(1, round(part.width * k)), max(1, round(part.height * k))), Image.LANCZOS)
        buf = io.BytesIO()
        part.save(buf, "JPEG", quality=92)
        return buf.getvalue(), part.size[0], part.size[1], (float(cx0), float(cy0), part.width / max(1, cx1 - cx0), part.height / max(1, cy1 - cy0))


def open_grey(path) -> Any:
    from PIL import Image  # noqa: PLC0415
    with Image.open(path) as im:
        return G.grey(im)


# ── The local steps (design 3.4-3.6): no AI, no store ────────────────────────

def _ppm_axis(readings: list[dict], axis: str) -> dict[str, Any]:
    """One axis's printed pixels per metre: two or more agreeing (median),
    single, disagree, or none."""
    vals = sorted(r["ppm"] for r in readings if r.get("axis") == axis and r.get("ok") and r.get("ppm"))
    if not vals:
        return {"ppm": None, "n": 0, "state": "none"}
    if len(vals) == 1:
        return {"ppm": vals[0], "n": 1, "state": "single"}
    mid = len(vals) // 2
    med = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
    if all(G.agrees(v, med, S1_DIMS_AGREE) for v in vals):
        return {"ppm": round(med, 4), "n": len(vals), "state": "agree"}
    return {"ppm": None, "n": len(vals), "state": "disagree"}


def plan_health(pl: dict, t: dict) -> dict[str, Any]:
    """How far the placement is from the plan's own printed dimensions (design 3.4.5)."""
    w, h = pl["size_px"]
    now = (w / float(t["scale_x_m"]), h / float(t["scale_y_m"])) if t.get("scale_x_m") and t.get("scale_y_m") else (None, None)
    px, py = (pl.get("ppm") or {}).get("x"), (pl.get("ppm") or {}).get("y")
    ex = now[0] / px - 1 if px and now[0] else None
    ey = now[1] / py - 1 if py and now[1] else None
    shape = abs(ex - ey) if ex is not None and ey is not None else None
    return {"scale_err_x": None if ex is None else round(ex, 4), "scale_err_y": None if ey is None else round(ey, 4),
            "shape_err": None if shape is None else round(shape, 4), "ppm_now": [None if v is None else round(v, 3) for v in now]}


def _words(s: Any) -> set[str]:
    return {w for w in re.findall(r"[a-z]+", str(s or "").lower()) if w not in _ROOM_STOP and len(w) > 2}


def floor_evidence(read_a: dict, floors: list[dict], rooms: dict[str, dict]) -> dict[str, dict[str, Any]]:
    """Per floor: whether the title or the floor word names it, and which of
    the plan's room names belong to it (case-insensitive word overlap with its
    rooms; design 2)."""
    out = {}
    title_words = _words(read_a.get("title"))
    fw = read_a.get("floor_word") or "unknown"
    for f in floors:
        own = _words(f.get("name")) | _words(f.get("id"))
        group = next((g for g in _FLOOR_GROUPS if g & own), frozenset(own))
        named = bool(title_words & group) or fw in group
        theirs = [_words(n) for n, r in rooms.items() if r.get("floor_id") == f["id"]]
        hits = [r["name"] for r in read_a.get("rooms") or [] if any(_words(r["name"]) & t for t in theirs if t)]
        out[f["id"]] = {"named": named, "rooms": hits[:6]}
    return out


def refile_candidates(sess: dict, snap: dict) -> dict[str, dict]:
    """Plans whose read says they show another floor (design 2): that floor
    named, or two of its rooms, and nothing pointing at their own. Never the
    gauge plan, never to or from Outside (Outside isn't among the floors)."""
    fid, out, floors = sess["floor_id"], {}, snap["floors"]
    for pl in sess["plans"]:
        ra = pl.get("read_a")
        if ra is None or pl["map_id"] == snap["gauge_map"]:
            continue
        ev = floor_evidence(ra, floors, snap["rooms"])
        own = ev.get(fid) or {}
        if own.get("named") or own.get("rooms"):
            continue
        # A floor the drawing names outranks room names (a closet or a deck is on most floors).
        named = [f for f in floors if f["id"] != fid and (ev.get(f["id"]) or {}).get("named")]
        roomy = [f for f in floors if f["id"] != fid and len((ev.get(f["id"]) or {}).get("rooms") or []) >= 2]
        to = named or roomy
        if len(to) != 1:
            continue
        out[pl["map_id"]] = {"to_floor_id": to[0]["id"], "to_name": to[0].get("name"), "title": ra.get("title"),
                             "rooms": (ev[to[0]["id"]].get("rooms") or [r["name"] for r in ra.get("rooms") or []])[:8],
                             "named": bool(ev[to[0]["id"]]["named"])}
    return out


def _room_at(snap: dict, fid: str, x: float, y: float) -> str | None:
    for name, r in snap["rooms"].items():
        if r["floor_id"] == fid and len(r["points_m"]) >= 3 and _point_in_polygon(x, y, r["points_m"]):
            return name
    return None


def effects(snap: dict, map_id: str, new_t: dict) -> tuple[list[dict], dict[str, Any]]:
    """What a placement change would shift (design 3.6): each calibration
    point, scanner, beacon and light drawn on the plan whose click would land
    S1_FLAG_M or more from where it is stored, each traced room whose trace
    would sit that far from its outline; and the other devices on the floor
    under the plan (a count and names). Nothing is moved, ever."""
    pl = snap["plans"][map_id]
    fid = pl["floor_id"]
    flags: list[dict] = []

    def flag(what: str, ident: Any, frac: tuple, stored: tuple, label: Any = None) -> None:
        if None in frac or None in stored:
            return
        sh = G.shift_of(new_t, frac, stored)
        if sh.moved_m >= S1_FLAG_M:
            flags.append({"what": what, "id": str(ident), "label": _short(label, 40), "stored_m": [round(v, 3) for v in sh.stored_m],
                          "click_m": [round(v, 3) for v in sh.click_m], "moved_m": round(sh.moved_m, 2),
                          "room_now": _room_at(snap, fid, *sh.stored_m), "room_click": _room_at(snap, fid, *sh.click_m)})

    for p in snap["calibration"]:
        if p["map_id"] == map_id:
            flag("calibration", p["id"], (p.get("x_frac"), p.get("y_frac")), (p.get("x_m"), p.get("y_m")), p.get("room"))
    on_plan = set()
    for r in pl["receivers"]:
        pos = snap["scanners"].get(r.get("source")) or {}
        on_plan.add(str(r.get("source")))
        flag("receiver", r.get("source"), (r.get("x"), r.get("y")), (pos.get("x_m"), pos.get("y_m")), r.get("label"))
    for b in pl["beacons"]:
        pos = snap["beacons"].get(b.get("key")) or {}
        on_plan.add(str(b.get("key")))
        flag("beacon", b.get("key"), (b.get("x"), b.get("y")), (pos.get("x_m"), pos.get("y_m")), b.get("label"))
    for li in pl["lights"]:
        pos = snap["lights"].get(li.get("entity_id")) or {}
        on_plan.add(str(li.get("entity_id")))
        flag("light", li.get("entity_id"), (li.get("x"), li.get("y")), (pos.get("x_m"), pos.get("y_m")), li.get("label"))
    for name, fracs in pl["room_bounds"].items():
        room = snap["rooms"].get(name)
        good = [f for f in fracs if isinstance(f, (list, tuple)) and len(f) == 2]
        if not room or room["floor_id"] != fid or not good or not room["points_m"]:
            continue
        trace = [placement_metres(new_t, float(f[0]), float(f[1])) for f in good]
        far = max(min(math.dist(a, b) for b in room["points_m"]) for a in trace)
        if far >= S1_FLAG_M:
            flags.append({"what": "room_trace", "id": name, "label": _short(name), "moved_m": round(far, 2)})
    corners = G.corners(new_t)
    others = []
    for table in (snap["scanners"], snap["beacons"], snap["lights"]):
        for ident, pos in table.items():
            if str(ident) in on_plan or not isinstance(pos, dict) or str(pos.get("floor_id") or "") != fid:
                continue
            x, y = S._num(pos.get("x_m")), S._num(pos.get("y_m"))  # noqa: SLF001
            if x is not None and y is not None and _point_in_polygon(x, y, corners):
                others.append(_short(pos.get("label") or ident, 40))
    return flags, {"n": len(others), "names": others[:20]}


def _keep_point(snap: dict, map_id: str) -> tuple[float, float]:
    """The middle of what is drawn on a plan, as a fraction of its picture
    (its traced rooms and calibration points), else the picture's middle (design 3.4.9)."""
    pl = snap["plans"][map_id]
    pts = [(float(f[0]), float(f[1])) for fr in pl["room_bounds"].values() for f in fr if isinstance(f, (list, tuple)) and len(f) == 2]
    pts += [(float(p["x_frac"]), float(p["y_frac"])) for p in snap["calibration"] if p["map_id"] == map_id and p.get("x_frac") is not None]
    if not pts:
        return 0.5, 0.5
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


class LocalSteps:
    """The local steps of one floor's session, run in the executor on what was
    read: no AI, no store. `grey(map_id)` opens a plan's picture as grey;
    `bump(event)` counts; `cancel()` asks whether to stop. The stops it meets
    are left in .stops for the event loop to note. `only`: the plans an
    answer is about; the other plans keep their items, unfitted again, while
    the anchor stays the one they were fitted to (design 3.5)."""

    # The rooms helper's scale read only (SCALE_PARSE_NEAR): a printed length PadSpan reads past
    # S1_PARSE_AGREE from Claude's metres but within this is kept, never as confirmed. 0: dropped (the line-up).
    near_ok = 0.0

    def __init__(self, sess: dict, snap: dict, grey: Callable[[str], Any], bump: Callable[[str], None],
                 cancel: Callable[[], bool] = lambda: False, only: set[str] | None = None) -> None:
        self.sess, self.snap, self.grey, self.bump, self.cancel, self.only = sess, snap, grey, bump, cancel, only
        self.stops: list[tuple[str, str | None]] = []
        self._pics: dict[str, Any] = {}

    def pic(self, mid: str) -> Any:
        if mid not in self._pics:
            self._pics[mid] = self.grey(mid)
        return self._pics[mid]

    # -- the printed dimensions ----------------------------------------------
    def measure(self, pl: dict) -> None:
        """Each dimension read closely → its ticks and pixels per metre (its
        text parsed here must agree with Claude's metres, or it is held); then
        the plan's two axes."""
        if pl.get("tilt_rad") is None:
            try:
                pl["tilt_rad"] = round(G.scan_tilt(self.pic(pl["map_id"])), 6)
            except Exception:  # noqa: BLE001
                pl["tilt_rad"] = 0.0
        # PadSpan's own reading of what is printed must agree with Claude's metres:
        # the text (a chain joined by +), else the chain's segments summed.
        todo: list[tuple[dict, float, list[float]]] = []
        for d in pl.get("dims") or []:
            if d.get("done") or not d.get("box") or d.get("source") in ("skipped", "set_aside") or not d.get("metres"):
                continue
            d["done"] = True
            segs: list[Any] = []
            near = False
            if d.get("source") == "person":
                m = float(d["metres"])
            else:
                claude = float(d["metres"])
                parsed, chain_sum = G.parse_length(d.get("text"), claude), G.chain_length(d.get("chain"), claude)
                m = parsed if G.agrees(parsed, claude, S1_PARSE_AGREE) else chain_sum if G.agrees(chain_sum, claude, S1_PARSE_AGREE) else None
                if m is None and self.near_ok:           # the scale read: PadSpan's reading kept, shown as not confirmed
                    m = parsed if G.agrees(parsed, claude, self.near_ok) else chain_sum if G.agrees(chain_sum, claude, self.near_ok) else None
                    near = m is not None
                if m is None:
                    d.update(ok=False, why="parse_mismatch", parse_m=parsed if parsed is not None else chain_sum)
                    self.bump("plan_build_dims:parse_mismatch")
                    continue
                # The segments, for finding the inner ticks: only a chain that sums to the length.
                if G.agrees(chain_sum, m, S1_PARSE_AGREE):
                    segs = list(d.get("chain") or [])
                elif "+" in str(d.get("text") or ""):
                    segs = str(d["text"]).split("+")
            d["parse_m"] = round(m, 5)
            if near:
                d["near"] = True
            seg_m = [G.parse_length(c) for c in segs]
            # A chain of three or more: two segments have one inner tick, matched by chance too easily (Garry's main floor, 2026-11-09).
            todo.append((d, m, seg_m if len(seg_m) >= 3 and all(v is not None for v in seg_m) else []))
        # Chains first: a chain's ticks are found by its own segments. A single
        # line's ends sit among wall faces drawn double, so its ticks are picked
        # to agree with the plan's chains (same axis, else the other: square
        # pixels); with no chain to agree with, it stays a guess and isn't used.
        for d, m, seg_m in sorted(todo, key=lambda t: 0 if t[2] else 1):
            box = list(d["box"])
            if d.get("ends_px"):                          # the line runs as far as the closer read saw it
                k = 0 if d["axis"] == "x" else 1
                e = sorted(float(p[k]) for p in d["ends_px"])
                box[k], box[k + 2] = min(box[k], e[0]), max(box[k + 2], e[1])
            chained = [o["ppm"] for o in pl.get("dims") or [] if o.get("ok") and o.get("chain_hits") and o is not d]
            same = [o["ppm"] for o in pl.get("dims") or [] if o.get("ok") and o.get("chain_hits") and o.get("axis") == d["axis"] and o is not d]
            ref = same or chained
            expect = sorted(ref)[len(ref) // 2] * m if ref and not seg_m else None
            try:
                ticks = G.dimension_ticks(self.pic(pl["map_id"]), box, d["axis"], ends=d.get("ends_px"), tilt=float(pl.get("tilt_rad") or 0.0),
                                          chain=seg_m or None, expect_span=expect)
            except Exception:  # noqa: BLE001
                ticks = None
            if ticks is None:
                d.update(ok=False, why="no_ticks")
                continue
            ppm = round(ticks.span / m, 4)
            if d.get("near") or (not seg_m and expect is None and d.get("source") != "person"):
                d.update(ok=False, why="unconfirmed", ppm_guess=ppm, ticks_px=ticks.ends_px)
                continue
            d.update(ok=True, why=None, ticks_px=ticks.ends_px, span_px=ticks.span, ppm=ppm, chain_hits=ticks.matched)
        ax, ay = _ppm_axis(pl.get("dims") or [], "x"), _ppm_axis(pl.get("dims") or [], "y")
        pl["ppm"] = {"x": ax["ppm"], "y": ay["ppm"], "n_x": ax["n"], "n_y": ay["n"], "x_state": ax["state"], "y_state": ay["state"]}

    # -- the session ---------------------------------------------------------
    def run(self) -> None:
        sess, snap = self.sess, self.snap
        for pl in sess["plans"]:
            if pl.get("read_a") is not None:
                self.measure(pl)
                for axis in ("x", "y"):
                    self.bump(f"plan_build_dims:{pl['ppm'][axis + '_state']}")
            else:
                pl["ppm"] = {"x": None, "y": None, "n_x": 0, "n_y": 0, "x_state": "none", "y_state": "none"}
            pl["health"] = plan_health(pl, snap["plans"].get(pl["map_id"], {}).get("t") or {})
            if (snap["plans"].get(pl["map_id"]) or {}).get("t"):
                pl["corners_m"] = G.corners(snap["plans"][pl["map_id"]]["t"])     # where its picture lies now, for the overlays
            se = pl["health"].get("shape_err")
            if se is not None:
                self.bump(f"plan_build_shape_err:{_scale_band(se * 100)}")
        # A plan of another floor is not lined up here: it is offered a refile.
        refiles = self.refiles()
        by = {pl["map_id"]: pl for pl in sess["plans"]}
        work = [pl for pl in sess["plans"] if pl["map_id"] not in refiles]
        anchor = self.choose_anchor(work)
        sess["anchor"] = anchor["map_id"] if anchor else None
        items: dict[str, dict] = {}
        for mid, ev in refiles.items():
            by[mid]["role"] = "other_floor"
            items[f"refile_{mid}"] = self.refile_item(by[mid], ev)
        for pl in work:
            pl["role"] = "gauge" if pl["map_id"] == snap["gauge_map"] else ("anchor" if pl is anchor else "plan")
        if anchor is not None and anchor["role"] == "anchor":
            it = self.anchor_item(anchor)
            if it:
                items[f"anchor_{anchor['map_id']}"] = it
        if anchor is not None and anchor["role"] == "gauge":
            # Said only on two readings agreeing: one reading against a measured plan is the reading's doubt, not the plan's.
            h = anchor.get("health") or {}
            errs = [abs(h[f"scale_err_{k}"]) for k in ("x", "y") if h.get(f"scale_err_{k}") is not None and anchor["ppm"].get(f"{k}_state") == "agree"]
            if errs and max(errs) >= S1_ANCHOR_SMALL:
                self.stops.append(("measured_plan_protected", anchor["map_id"]))
        # No anchor: the plans are fitted to the one with the most drawn on it,
        # which keeps where it is, and every item is held "look closely" (design 3.1.3).
        ref = anchor
        if anchor is None and len(work) > 1:
            ref = max(work, key=lambda p: drawn_total(snap["plans"][p["map_id"]]["drawn"]))
            ref["role"] = "reference"
        # An answer about one plan refits that plan only, while what the others were fitted to is unchanged.
        keep = self.only is not None and ref is not None and ref["map_id"] == self.sess.get("ref_map_id") and ref["map_id"] not in self.only
        self.sess["ref_map_id"] = ref["map_id"] if ref is not None else None
        for pl in work:
            if pl is ref or pl["role"] == "gauge" or self.cancel():
                continue
            if keep and pl["map_id"] not in self.only:
                if isinstance((sess.get("items") or {}).get(f"place_{pl['map_id']}"), dict):
                    items[f"place_{pl['map_id']}"] = sess["items"][f"place_{pl['map_id']}"]
                continue
            it = self.place_item(pl, ref, held=anchor is None)
            if it:
                items[f"place_{pl['map_id']}"] = it
        if anchor is None and work:
            self.stops.append(("no_anchor", None))
        sess["cross_floor"] = self.cross_floor(anchor)
        # A verdict already given stays with its item while the item is the same.
        old = sess.get("items") or {}
        for iid, it in items.items():
            was = old.get(iid)
            if isinstance(was, dict) and was.get("verdict") and was.get("proposal") == it.get("proposal"):
                it["state"], it["verdict"] = was["state"], was["verdict"]
        # A plan saved in this session keeps its saved item, whatever this
        # measuring makes of it (another anchor, after an answer): it is never
        # offered, nor saved, twice, so Undo can always take the session back (review B6).
        saved = {iid: it for iid, it in old.items() if isinstance(it, dict) and it.get("state") == "committed"}
        saved_maps = {it.get("map_id") for it in saved.values()}
        sess["items"] = {**{iid: it for iid, it in items.items() if it.get("map_id") not in saved_maps}, **saved}

    def choose_anchor(self, work: list[dict]) -> dict | None:
        """The gauge plan when it is on this floor; else the plan whose own
        printed dimensions agree best with its placement (design 3.1)."""
        g = next((pl for pl in work if pl["map_id"] == self.snap["gauge_map"]), None)
        if g is not None:
            self.bump("plan_build_anchor:gauge")
            return g
        ok = []
        for pl in work:
            h = pl.get("health") or {}
            ex, ey, se = h.get("scale_err_x"), h.get("scale_err_y"), h.get("shape_err")
            if se is None or se > S1_ANCHOR_SHAPE or abs(ex) > S1_ANCHOR_SCALE or abs(ey) > S1_ANCHOR_SCALE:
                continue
            ok.append(pl)
        if not ok:
            self.bump("plan_build_anchor:none")
            return None
        sp = self.snap["plans"]
        ok.sort(key=lambda pl: (round(pl["health"]["shape_err"], 3), -int(sp[pl["map_id"]]["refs"]), -int(sp[pl["map_id"]]["drawn"]["calibration"])))
        self.bump("plan_build_anchor:evidence")
        return ok[0]

    def _base_item(self, kind: str, pl: dict) -> dict[str, Any]:
        sp = self.snap["plans"][pl["map_id"]]
        return {"kind": kind, "map_id": pl["map_id"], "name": pl.get("name") or "", "image_sig": sp["image_sig"],
                "target_place_sig": sp["place_sig"], "state": "open", "verdict": None, "held": None}

    def _place_fields(self, it: dict, pl: dict, now_t: dict, new_t: dict) -> dict:
        w, h = pl["size_px"]
        it.update(proposal=new_t, now={k: now_t.get(k) for k in G.FIELDS if now_t.get(k) is not None},
                  corners_now_m=G.corners(now_t), corners_new_m=G.corners(new_t), max_move_m=round(G.max_move(now_t, new_t), 3))
        ch = [abs(float(new_t[k]) / float(now_t[k]) - 1) for k in ("scale_x_m", "scale_y_m") if now_t.get(k)]
        it["scale_change"] = round(max(ch), 4) if ch else 0.0
        it["flags"], it["others"] = effects(self.snap, pl["map_id"], new_t)
        it["evidence"] = {**(it.get("evidence") or {}), "ppm_printed": [pl["ppm"].get("x"), pl["ppm"].get("y")],
                          "ppm_now": pl["health"].get("ppm_now"),
                          "ppm_new": [round(w / float(new_t["scale_x_m"]), 3), round(h / float(new_t["scale_y_m"]), 3)],
                          "tilt_deg": round(math.degrees(float(pl.get("tilt_rad") or 0.0)), 2)}
        if it["max_move_m"] < S1_SAME_M:
            it["state"] = "same"
        return it

    def anchor_item(self, pl: dict) -> dict | None:
        """The anchor's own printed-dimension error (form q7): under
        S1_ANCHOR_SMALL information only; from it an item, Not now by default."""
        h = pl.get("health") or {}
        errs = [abs(v) for v in (h.get("scale_err_x"), h.get("scale_err_y")) if v is not None]
        if not errs:
            return None
        sp = self.snap["plans"][pl["map_id"]]
        new_t = G.scale_only(sp["t"], tuple(pl["size_px"]), (pl["ppm"].get("x"), pl["ppm"].get("y")), _keep_point(self.snap, pl["map_id"]))
        if new_t is None:
            return None
        it = self._place_fields(self._base_item("anchor_scale", pl), pl, sp["t"], new_t)
        it["evidence"]["seed"] = "dims"
        it["evidence"]["scale_err"] = [h.get("scale_err_x"), h.get("scale_err_y")]
        if max(errs) < S1_ANCHOR_SMALL:
            it["state"] = "info"
        else:
            it["state"] = "not_now"
            self.stops.append(("anchor_error", pl["map_id"]))
        return it

    def _questions(self) -> list[dict]:
        return self.sess.setdefault("questions", [])

    def _ask(self, kind: str, pl: dict, **extra: Any) -> dict | None:
        """A question, unless one like it is there already, or the floor's
        S1_HELP_MAX are used (then the plan is left out, and said)."""
        qs = self._questions()
        same = next((q for q in qs if q["kind"] == kind and q["map_id"] == pl["map_id"] and q.get("axis") == extra.get("axis")
                     and q["state"] in ("open", "answered")), None)
        if same is not None:
            return same
        if len(qs) >= S1_HELP_MAX:
            self.bump("plan_build_help:gave_up")
            self.bump("plan_build_stress:help_over")
            self.stops.append(("help_limit", pl["map_id"]))
            pl["left_out"] = True
            return None
        q = {"id": f"q{len(qs) + 1}", "kind": kind, "map_id": pl["map_id"], "name": pl.get("name") or "", "state": "open",
             "answer": None, "asked_at": time.time(), **extra}
        qs.append(q)
        self.bump("plan_build_help:dimension_shown" if kind == "confirm_dimension" else "plan_build_help:taps_shown")
        return q

    def _confirm(self, pl: dict, axis: str) -> dict | None:
        """The dimension to confirm on one axis: its longest reading."""
        cand = [d for d in pl.get("dims") or [] if d.get("axis") == axis and d.get("box") and d.get("source") not in ("skipped", "set_aside")]
        if not cand:
            return None
        d = max(cand, key=lambda d: (d["box"][2] - d["box"][0]) if axis == "x" else (d["box"][3] - d["box"][1]))
        if d.get("confirmed"):
            return None
        return self._ask("confirm_dimension", pl, axis=axis, dim=pl["dims"].index(d), box=d.get("box"),
                         ticks_px=d.get("ticks_px"), ai={"text": d.get("text"), "metres": d.get("metres")})

    def _doubts(self, pl: dict, scale_change: float | None = None, fitted: bool = False) -> bool:
        """The dimension doubts of design 3.5 on this plan; True when a
        question about it is open. A reading PadSpan and Claude disagree on is
        asked about only when its axis has no other reading to go on. One
        reading that would change the scale by S1_SINGLE_CHANGE is asked about
        only where it sets the proposal (a scale-only one): a fitted plan's
        scale comes from the fit, which its readings only check."""
        open_q = False
        for axis in ("x", "y"):
            st = pl["ppm"].get(axis + "_state")
            mism = st == "none" and any(d.get("why") == "parse_mismatch" for d in pl.get("dims") or [] if d.get("axis") == axis)
            err = (pl.get("health") or {}).get("scale_err_" + axis)
            single_big = not fitted and st == "single" and err is not None and abs(err) > S1_SINGLE_CHANGE
            if st == "disagree" or mism or single_big:
                q = self._confirm(pl, axis)
                open_q = open_q or bool(q and q["state"] == "open")
        if scale_change is not None and scale_change > S1_BIG_CHANGE:
            for axis in ("x", "y"):
                if pl["ppm"].get(axis):
                    q = self._confirm(pl, axis)
                    open_q = open_q or bool(q and q["state"] == "open")
        return open_q

    def place_item(self, pl: dict, anchor: dict | None, held: bool = False) -> dict | None:
        """One plan fitted onto the anchor (design 3.4.6-7), or, with nothing
        to fit it to, set to its printed scale about the middle of what is
        drawn on it (3.4.9). `held`: there is no anchor on this floor, so the
        item says look closely. None while a question about it is open or it
        is left out."""
        snap = self.snap
        now_t = snap["plans"][pl["map_id"]]["t"]
        if pl.get("read_a") is None or pl.get("left_out"):
            return None
        it = self._base_item("place", pl)
        it["held"] = "no_anchor" if held else None
        if anchor is None:
            if not (pl["ppm"].get("x") or pl["ppm"].get("y")) or self._doubts(pl):
                return None
            new_t = G.scale_only(now_t, tuple(pl["size_px"]), (pl["ppm"].get("x"), pl["ppm"].get("y")), _keep_point(snap, pl["map_id"]))
            it["evidence"] = {"seed": "dims", "anchor": None}
            return self._place_fields(it, pl, now_t, new_t) if new_t else None
        if self._doubts(pl, fitted=True):
            return None
        fit = self.fit(pl, anchor)
        if fit is None:
            return None
        new_t = G.compose(snap["plans"][anchor["map_id"]]["t"], tuple(anchor["size_px"]), tuple(pl["size_px"]), fit)
        if new_t is None:
            return None
        it["evidence"] = {"anchor": anchor["map_id"], "anchor_name": anchor.get("name") or "", "corr": round(fit.corr, 3), "seed": fit.seed,
                          "overlap": round(fit.overlap, 2), "fit_secs": fit.secs, "ratio_fit": [round(fit.sx, 4), round(fit.sy, 4)],
                          "ratio_dims": pl.get("ratio_dims")}
        it["anchor_now"] = dict(snap["plans"][anchor["map_id"]]["t"])     # composed on this: a save checks it is still so
        self._place_fields(it, pl, now_t, new_t)
        if self._doubts(pl, it["scale_change"], fitted=True):
            return None
        return it

    def fit(self, pl: dict, anchor: dict) -> G.Fit | None:
        """Seeds in the design's order: the person's taps when given, else the
        stairs paired, else the coarse search; the first fit accepted wins. Not
        accepted: the person is asked to tap the same corner on both."""
        a, m = anchor, pl
        sp = self.snap["plans"]
        ratio = [a["ppm"].get(k) / m["ppm"].get(k) if a["ppm"].get(k) and m["ppm"].get(k) else None for k in ("x", "y")]
        pl["ratio_dims"] = [None if r is None else round(r, 4) for r in ratio]
        placed_m = (m["size_px"][0] / float(sp[m["map_id"]]["t"]["scale_x_m"]), m["size_px"][1] / float(sp[m["map_id"]]["t"]["scale_y_m"]))
        placed_a = (a["size_px"][0] / float(sp[a["map_id"]]["t"]["scale_x_m"]), a["size_px"][1] / float(sp[a["map_id"]]["t"]["scale_y_m"]))
        scale0 = tuple(ratio[i] or ratio[1 - i] or placed_a[i] / placed_m[i] for i in (0, 1))
        checked = any(r is not None for r in ratio)
        taps = next((q for q in self._questions() if q["kind"] == "tap_corners" and q["map_id"] == m["map_id"] and q["state"] == "answered"), None)
        seeds: list[Callable[[], G.Fit | None]] = []
        t0 = time.monotonic()                            # the pair's G.FIT_SECS, the coarse search inside it
        if taps:
            seeds.append(lambda: G.taps_start((taps.get("answer") or {}).get("taps") or [], (tuple(m["size_px"]), tuple(a["size_px"]))))
        else:
            if not (m.get("read_a") or {}).get("suspect") and not (a.get("read_a") or {}).get("suspect"):
                seeds.append(lambda: G.stairs_start((m.get("read_a") or {}).get("stairs") or [], (a.get("read_a") or {}).get("stairs") or [], scale0))
            seeds.append(lambda: G.search_start(self.pic(m["map_id"]), self.pic(a["map_id"]), scale0, deadline=t0 + G.FIT_SECS, cancel=self.cancel))
        best, why = None, "low_corr"
        for seed in seeds:
            left = G.FIT_SECS - (time.monotonic() - t0)
            if left <= 1 or self.cancel():
                break
            start = seed()
            if start is None:
                continue
            f = G.register(self.pic(m["map_id"]), self.pic(a["map_id"]), start, scale0, cancel=self.cancel, secs=left)
            f.overlap = G.overlap_share(f, tuple(m["size_px"]), tuple(a["size_px"]))
            w = G.accepted(f, (ratio[0], ratio[1]), f.overlap)
            if w is None and not checked and f.seed != "taps":
                w = "ratio_disagree"                     # no printed dimension to check it by: only the person's taps stand in
            self.bump(f"plan_build_fit:{'ge95' if f.corr >= 0.95 else '85_95' if f.corr >= 0.85 else '70_85' if f.corr >= 0.70 else 'lt70'}")
            if w == "ratio_disagree":
                self.bump("plan_build_fit:ratio_disagree")
            self.bump(f"plan_build_fit_secs:{'capped' if f.stopped == 'capped' else 'lt5' if f.secs < 5 else '5_20' if f.secs < 20 else '20_60'}")
            if w is None:
                self.bump(f"plan_build_seed:{f.seed}")
                pl.pop("fit_fail", None)
                return f
            if best is None or f.corr > best.corr:
                best, why = f, w
        pl["fit_fail"] = {"why": why, "corr": round(best.corr, 3) if best else None}
        if taps:
            taps["state"] = "failed"
        self.stops.append(("fit_rejected", m["map_id"]))
        self._ask("tap_corners", m, other_map_id=a["map_id"], other_name=a.get("name") or "")
        return None

    def refiles(self) -> dict[str, dict]:
        return refile_candidates(self.sess, self.snap)

    def refile_item(self, pl: dict, ev: dict) -> dict:
        """A refile, for a plan with nothing drawn on it; one with things on it
        is refused and says what (design 2, form q5)."""
        it = self._base_item("refile", pl)
        drawn = self.snap["plans"][pl["map_id"]]["drawn"]
        it.update(proposal={"to_floor_id": ev["to_floor_id"], "why": {"title": ev.get("title"), "rooms": ev.get("rooms")}},
                  to_name=ev.get("to_name"), drawn=drawn, flags=[], others={"n": 0, "names": []})
        self.bump("plan_build_refile:suggested")
        if drawn_total(drawn):
            it["state"] = "refused"
            self.bump("plan_build_refile:refused_drawn")
            self.stops.append(("refile_refused", pl["map_id"]))
        return it

    def cross_floor(self, anchor: dict | None) -> dict | None:
        """Information only (design 3.4.8): the anchor's stairs against the
        stairs of a plan on the floor above or below that was read before (its
        read A reused, no new read), through both placements."""
        if anchor is None or not (anchor.get("read_a") or {}).get("stairs"):
            return None
        ids = [f["id"] for f in self.snap["floors"]]
        fid = self.sess["floor_id"]
        if fid not in ids:
            return None
        i = ids.index(fid)
        ours = [self._stair_m(anchor["map_id"], b, anchor["size_px"]) for b in anchor["read_a"]["stairs"]]
        for other in [ids[j] for j in (i + 1, i - 1) if 0 <= j < len(ids)]:
            for ref in self.sess.get("references") or []:
                if ref.get("floor_id") != other or not ref.get("stairs") or ref["map_id"] not in self.snap["plans"]:
                    continue
                theirs = [self._stair_m(ref["map_id"], b, ref["size_px"]) for b in ref["stairs"]]
                d = min((math.dist(p, q) for p in ours for q in theirs), default=None)
                if d is not None:
                    return {"floor_id": other, "map_id": ref["map_id"], "stairs_m": round(d, 2)}
        return None

    def _stair_m(self, mid: str, box: list, size: list) -> tuple[float, float]:
        return placement_metres(self.snap["plans"][mid]["t"], (box[0] + box[2]) / 2 / size[0], (box[1] + box[3]) / 2 / size[1])


# ── The session and its job ──────────────────────────────────────────────────

def floor_plans(snap: dict, floor_id: str) -> list[str]:
    """The placed plans filed on a floor (never Outside), at most S1_PLANS_MAX."""
    if str(floor_id).lower() in (OUTSIDE_FLOOR_ID, "outside"):
        return []
    return [mid for mid, p in snap["plans"].items() if p["floor_id"] == floor_id and p["size"][0] and p["size"][1]][:S1_PLANS_MAX]


def earlier_reads(store: PlanAiStore) -> dict[str, dict]:
    """Read A (and the closer reads) of every plan in kept line-ups, keyed by
    map id and picture signature, newest kept: reused with no new read. The
    rooms helper's scale reads (design E.1) give their Read A only (they read
    one dimension an axis, fewer than a line-up's), and a line-up's read of
    the same picture comes before theirs."""
    out: dict[str, dict] = {}
    for key in ("scales", "lineups"):
        for sess in sorted((s for s in (store.data.get(key) or {}).values() if isinstance(s, dict)), key=lambda s: float(s.get("started_at") or 0)):
            for pl in sess.get("plans") or []:
                if pl.get("read_a") is not None:
                    full = key == "lineups" and bool(pl.get("dims_read"))
                    out[f"{pl['map_id']}|{pl['image_sig']}"] = {
                        "map_id": pl["map_id"], "read_a": pl["read_a"], "floor_id": pl.get("floor_id"), "size_px": pl.get("size_px"),
                        "dims": pl.get("dims") if full else None, "dims_read": full, "tilt_rad": pl.get("tilt_rad")}
    return out


def _fresh_dims(dims: Any) -> list[dict]:
    """A reused plan's close reads, without what the last session measured from them (measured again here)."""
    keep = ("axis", "text", "box", "source", "read", "metres", "chain", "ends_px")
    return [{k: d[k] for k in keep if k in d} for d in dims or [] if isinstance(d, dict) and d.get("source") in ("ai", None)]


def new_lineup(u: dict, snap: dict, floor_id: str, map_ids: list[str], earlier: dict[str, dict]) -> dict[str, Any]:
    """A line-up session about to run (design 4's shape, in this store's
    "lineups"). `earlier`: earlier_reads, reused where the picture is the same."""
    plans_ = []
    for mid in map_ids:
        p = snap["plans"][mid]
        prior = earlier.get(f"{mid}|{p['image_sig']}")
        plans_.append({"map_id": mid, "name": p["name"], "floor_id": p["floor_id"], "image_sig": p["image_sig"], "place_sig": p["place_sig"],
                       "size_px": list(p["size"]), "role": "plan", "drawn": dict(p["drawn"]), "refs": p["refs"],
                       "read_a": copy.deepcopy(prior["read_a"]) if prior else None, "reused": bool(prior),
                       "dims": _fresh_dims(prior.get("dims")) if prior and prior.get("dims_read") else [],
                       "dims_read": bool(prior and prior.get("dims_read")), "tilt_rad": prior.get("tilt_rad") if prior else None,
                       "ppm": {}, "health": {}})
        if prior and not prior.get("dims_read") and prior.get("read_a") and not prior["read_a"].get("suspect"):
            plans_[-1]["dims"] = _dims_to_read(prior["read_a"])    # a suspect first look reads no dimension (read_whole's rule)
    return {"rev": 1, "stage": "s1", "floor_id": floor_id, "started_at": time.time(), "finished_at": None, "status": "running", "error": None,
            "ai_task": u.get("ai_task"), "model": {"family": u.get("family"), "version": u.get("version"), "display": u.get("display")},
            "frame": PIXEL_FRAME, "budget_s": S1_BUDGET_S, "spent_s": 0.0, "spent_before": 0.0, "reads": 0, "reused": 0, "timeouts": 0,
            "errors": {}, "est_usd": 0.0, "resumes": 0, "plans": plans_, "questions": [], "items": {}, "stops": [], "references": [],
            "progress": {"plan": 0, "of": len(plans_), "name": "", "step": "plan"}}


def plan_estimate(hass: HomeAssistant, size: list[int]) -> list[float] | None:
    """What lining one plan up may cost on the main AI Task, by the AI credit
    tracker's own formula (ai_usage.estimate_usd): its whole read at the size
    it is sent (S1_PICTURE_PX, S1_PICTURE_MP) and S1_DIMS_PER_AXIS dimension
    crops an axis (the plan's length along the line, at most S1_CROP_PX, a
    band of about 200 px across it); [every read once, every read twice (its
    one retry)], in US dollars. None: no price is known for the model."""
    price = U.price_of(U.model_of(hass, str(unlock(hass).get("ai_task") or "")))
    w, h = (int(v or 0) for v in (list(size or []) + [0, 0])[:2])
    if price is None or not w or not h:
        return None
    k = min(1.0, S1_PICTURE_PX / max(w, h), math.sqrt(S1_PICTURE_MP * 1e6 / (w * h)))
    usd = U.estimate_usd(price, (round(w * k), round(h * k)), len(READ_A_PROMPT)) or 0.0
    for side in (w, h):
        usd += S1_DIMS_PER_AXIS * (U.estimate_usd(price, (min(side, S1_CROP_PX), 200), len(READ_B_PROMPT)) or 0.0)
    return [round(usd, 4), round(2 * usd, 4)]


def _dims_to_read(read_a: dict) -> list[dict]:
    """The dimensions to read closely: the longest S1_DIMS_PER_AXIS on each
    axis (design 3.3), by the line as traced in the picture (line_px; the
    AI's boxes stop short), else by its box; a chain before a single line of
    the same length."""
    out = []
    for axis in ("x", "y"):
        mine = [d for d in read_a.get("dims") or [] if d["axis"] == axis]
        mine.sort(key=lambda d: (-(d.get("line_px") or ((d["box"][2] - d["box"][0]) if axis == "x" else (d["box"][3] - d["box"][1]))),
                                 "+" not in str(d.get("text") or "")))
        picked: list[dict] = []
        for d in mine:                                    # one reading a drawn line: boxes on the same line are one
            k = 1 if axis == "x" else 0
            mid = (d["box"][k] + d["box"][k + 2]) / 2
            if all(abs(mid - (o["box"][k] + o["box"][k + 2]) / 2) > 8 for o in picked):
                picked.append(d)
        out += [{"axis": axis, "text": d.get("text"), "box": d["box"], "source": "ai"} for d in picked[:S1_DIMS_PER_AXIS]]
    return out


class LineupRunner(Runner):
    """One floor's line-up: the reads (Runner's ask and read, the plan AI's
    one path, asked of the main AI Task only, never the backup: design 8;
    a credit, reach or media failure halts them), then the local steps in
    the executor."""

    TASK = TASK_NAME
    BACKUP = False
    HALTS = ("no_media", "no_credit", "unreachable")
    STAGE = "s1"                                         # the report's stage word (s0: the rooms helper's scale read)

    def __init__(self, hass: HomeAssistant, store: PlanAiStore, job: Job, eid: str) -> None:
        super().__init__(hass, store, job, {"ai_task": eid, "local": False})
        self.eid = eid
        self.last_by = eid

    @property
    def sess(self) -> dict[str, Any]:
        return self.store.lineup(self.job.sid) or {}

    def left(self) -> float:
        return S1_BUDGET_S - float(self.sess.get("spent_before") or 0.0) - (time.monotonic() - self.t0)

    def _err(self, reason: str) -> None:
        e = self.sess.setdefault("errors", {})
        e[reason] = int(e.get(reason) or 0) + 1
        _bump(self.hass, f"plan_build_read_fail:{self.STAGE}_{reason}")

    async def _save(self) -> None:
        sess = self.sess
        sess["rev"] = int(sess.get("rev") or 0) + 1
        sess["spent_s"] = round(float(sess.get("spent_before") or 0.0) + time.monotonic() - self.t0, 1)
        await self.store.async_save()

    def guard(self) -> str | None:
        """At every read boundary: the switches, Claude unlocked, Live Aboard,
        Pro, and every plan as it was (design 3.9)."""
        from .house3d_store import enabled as house3d_on  # noqa: PLC0415
        from .ws_common import _tier_at_least  # noqa: PLC0415
        if self.job.cancel or not self.sess:             # gone: a restore or a reset took the session (a rooms session too)
            return "user"
        if not enabled(self.hass) or not build_switch(self.hass):
            return "switch_off"
        u = unlock(self.hass)
        if not u.get("ok"):
            return "locked"
        if u.get("ai_task") != self.eid:              # the session's own AI Task, still the main one and still qualifying: else closed
            return "ai_changed"
        if not house3d_on(self.hass) and self.sess.get("via") != "wizard":    # the rooms helper reads rooms only: Live Aboard may be off
            return "house3d_off"
        if not _tier_at_least(self.hass, "pro"):
            return "licence"
        return self.plan_guard()

    def plan_guard(self) -> str | None:
        """Every plan as it was: its picture and its placement."""
        for pl in self.sess.get("plans") or []:
            now = plan_now(self.hass, pl["map_id"])
            if now is None:
                return "plan_gone"
            if not same_picture(pl["image_sig"], now) or now["place_sig"] != pl["place_sig"]:
                return "plan_changed"
        return None

    def stop_here(self) -> bool:
        if self.halt or self.guard() or self.consecutive_timeouts >= 2:
            return True
        if self.left() < 5:
            self.cut_short = True
            return True
        return False

    def read_cap(self) -> float:
        return S1_READ_S

    def count_secs(self, band: str) -> None:
        _bump(self.hass, f"plan_build_read_secs:{band}")

    def failed(self, err: BaseException) -> str:
        """ai_usage's one reading of an AI Task's error (credit, reach, a refusal); any other error is an answer lost."""
        why = U.stop_reason(err, no_media=False, unreachable=P.unreachable(err))
        return why if why in ("no_credit", "unreachable", "refusal") else "bad_answer"

    def unusable(self, answer: Any) -> None:
        self._err("refusal" if U.unusable(self.hass, self.eid, answer) == "refusal" else "bad_answer")

    def retried(self) -> None:
        _bump(self.hass, f"plan_build_read:{self.STAGE}_retry")

    def gave_up(self) -> None:
        """Each answer was counted already (unusable)."""

    async def read_whole(self, pl: dict, i: int, fp) -> None:
        """Read A of one plan, and the outline-vs-ink check (design 3.2)."""
        sess = self.sess
        sess["progress"] = {"plan": i + 1, "of": len(sess.get("plans") or []), "name": pl.get("name") or "", "step": "plan"}
        await self._save()
        try:
            raw, w, h, W, H = await self.hass.async_add_executor_job(picture, fp)
        except Exception:  # noqa: BLE001 — a picture that won't open: the AI was never asked
            self._err("no_media")
            return
        k = w / W if W else 1.0
        pl["frame"] = [w, h]
        _bump(self.hass, f"plan_build_read:{self.STAGE}_plan")
        got = await self.read(READ_A_PROMPT.format(w=w, h=h), raw, lambda a: parse_read_a(a, w, h, k), (w, h))
        if got is None:
            return
        try:
            def check(outline=got["outline"]):
                g = open_grey(fp)
                tilt = G.scan_tilt(g)
                for d in got["dims"]:                     # each line as long as it is drawn, for choosing which to read closely
                    d["line_px"] = G.line_extent(g, d["box"], d["axis"], tilt)
                pl["tilt_rad"] = round(tilt, 6)
                return G.ink_bbox(g), G.outline_on_ink(g, outline)
            ink = await self.hass.async_add_executor_job(check)
            ink = ink if ink[0] else None
        except Exception:  # noqa: BLE001
            ink = None
        if ink and len(got["outline"]) >= 3:
            xs, ys = [p[0] for p in got["outline"]], [p[1] for p in got["outline"]]
            got["outline_iou"] = round(G.iou([min(xs), min(ys), max(xs), max(ys)], list(ink[0])), 3)
            got["outline_on_ink"] = round(ink[1], 3)
            if got["outline_on_ink"] < S1_OUTLINE_ON_INK:
                got["suspect"] = True
                self._err("suspect_frame")
        pl["read_a"] = got
        pl["dims"] = [] if got["suspect"] else _dims_to_read(got)
        await self._save()

    async def read_dims(self, pl: dict, i: int, fp) -> None:
        """Read B of each chosen dimension: its text, metres, chain and ends."""
        sess = self.sess
        for d in pl.get("dims") or []:
            if d.get("read") or d.get("source") != "ai":
                continue
            if self.stop_here():
                return
            sess["progress"] = {"plan": i + 1, "of": len(sess.get("plans") or []), "name": pl.get("name") or "", "step": "dimension"}
            try:
                raw, w, h, (x0, y0, kx, ky) = await self.hass.async_add_executor_job(dim_crop, fp, d["box"], d["axis"])
            except Exception:  # noqa: BLE001
                d["read"] = True
                continue
            _bump(self.hass, f"plan_build_read:{self.STAGE}_dimension")
            got = await self.read(READ_B_PROMPT.format(w=w, h=h, way="across" if d["axis"] == "x" else "down"), raw,
                                  lambda a: parse_read_b(a, w, h), (w, h))
            if self.halt and got is None:
                return                                   # read again on Resume
            d["read"] = True
            if got is not None:
                d.update(text=got["text"] or d.get("text"), metres=got["metres"], chain=got["chain"],
                         ends_px=[[round(x0 + p[0] / kx, 1), round(y0 + p[1] / ky, 1)] for p in got["ends"]] if got["ends"] else None)
            await self._save()
        pl["dims_read"] = all(d.get("read") or d.get("source") != "ai" for d in pl.get("dims") or [])

    async def files_of(self) -> dict[str, Any]:
        maps = self.hass.data.get(DOMAIN, {}).get(DATA_MAPS)
        out = {}
        for pl in self.sess.get("plans") or []:
            m = maps.get_map(pl["map_id"]) if maps is not None else None
            out[pl["map_id"]] = await self.hass.async_add_executor_job(
                lambda m=m: maps.image_file(str(((m or {}).get("image") or {}).get("filename") or ""), must_exist=True)) if m else None
        return out

    async def local(self, files: dict[str, Any] | None = None, only: set[str] | None = None) -> list[tuple[str, str | None]]:
        """The local steps in the executor, on a snapshot of the house and a
        copy of the session (a save on the event loop never meets it half
        changed); what they made is put on the session after, unless Stop
        cut them short (what was there stays). The stops they met."""
        files = files if files is not None else await self.files_of()
        snap = house_snapshot(self.hass)
        work = copy.deepcopy(self.sess)
        steps = LocalSteps(work, snap, lambda mid: open_grey(files[mid]), lambda e: _bump(self.hass, e), lambda: bool(self.job.cancel), only)
        await self.hass.async_add_executor_job(steps.run)
        sess = self.store.lineup(self.job.sid)
        if sess is not None and not self.job.cancel:
            for k in ("plans", "items", "questions", "anchor", "ref_map_id", "cross_floor"):
                sess[k] = work.get(k)
        return steps.stops

    async def run(self) -> None:  # noqa: C901 — one session's order, as the design lists it
        sess = self.sess
        resumed = int(sess.get("resumes") or 0) > 0
        _bump(self.hass, f"plan_build_run:s1_{'resumed' if resumed else 'started'}")
        n = len(sess.get("plans") or [])
        if not resumed:
            _bump(self.hass, f"plan_build_plans:{_band(n, ((1, '1'), (3, '2_3'), (6, '4_6')), 'gt6')}")
        reads0, usd0 = int(sess.get("reads") or 0), float(sess.get("est_usd") or 0.0)
        status, why = "done", None
        try:
            await self._save()
            files = await self.files_of()
            for i, pl in enumerate(sess.get("plans") or []):
                if pl.get("read_a") is not None:
                    if pl.pop("reused", False):
                        sess["reused"] = int(sess.get("reused") or 0) + 1
                        _bump(self.hass, "plan_build_read:s1_reused")
                    continue
                if self.stop_here():
                    break
                if files.get(pl["map_id"]) is None:
                    self._err("no_media")
                    continue
                await self.read_whole(pl, i, files[pl["map_id"]])
            # A plan that shows another floor is offered a refile, not measured: no closer reads.
            other = refile_candidates(sess, house_snapshot(self.hass))
            for i, pl in enumerate(sess.get("plans") or []):
                if pl["map_id"] in other:
                    continue
                if pl.get("read_a") is not None and not pl.get("dims_read") and files.get(pl["map_id"]) is not None and not self.stop_here():
                    await self.read_dims(pl, i, files[pl["map_id"]])
            why = self.guard()
            if why:
                status = "cancelled"
            elif self.halt == "no_credit":
                status = "no_credit"
            elif self.halt in ("unreachable", "no_media"):
                status, why = "failed", self.halt
            elif self.consecutive_timeouts >= 2 or self.cut_short:
                status = "out_of_time"
            # Other floors' plans read before: their stairs, for the cross-floor look (no new read).
            sess["references"] = [{"map_id": r["map_id"], "floor_id": r["floor_id"], "stairs": r["read_a"].get("stairs"), "size_px": r["size_px"]}
                                  for r in earlier_reads(self.store).values() if r.get("floor_id") != sess.get("floor_id")]
            if status != "cancelled":
                sess["progress"] = {"plan": n, "of": n, "name": "", "step": "measure"}
                await self._save()
                for reason, mid in await self.local(files):
                    note_stop(self.hass, self.store.data, self.sess, reason, mid)
                if self.job.cancel:                      # Stop while measuring: what was there stays
                    status, why = "cancelled", "user"
        except Exception as err:  # noqa: BLE001 — the session fails; nothing else is touched
            _LOGGER.warning("PadSpan plan line-up: the session stopped: %s", P._why(err))  # noqa: SLF001
            status, why = "failed", "error"
        sess = self.sess
        if status == "done" and any(q.get("state") == "open" for q in sess.get("questions") or []):
            status = "needs_help"
        if status == "done" and not any(pl.get("read_a") for pl in sess.get("plans") or []):
            errs = sess.get("errors") or {}
            status, why = "failed", max(errs, key=lambda k: errs[k]) if errs else "bad_answer"
        sess.update(status=status, error=why, finished_at=time.time())
        stop = ending_stop(status, why)
        if stop:
            note_stop(self.hass, self.store.data, sess, stop)
        sess["progress"] = {"plan": n, "of": n, "name": "", "step": "done"}
        self.count_run_end(sess, status, reads0, usd0)
        count_items(self.hass, sess)
        await self._save()

    def count_run_end(self, sess: dict[str, Any], status: str, reads0: int, usd0: float) -> None:
        """How the run ended, how long it took and what its reads cost (bands), under this runner's stage word."""
        _bump(self.hass, f"plan_build_run:{self.STAGE}_{'finished' if status == 'done' else status}")
        secs = float(sess.get("spent_s") or 0.0)
        _bump(self.hass, f"plan_build_run_secs:{self.STAGE}_{'lt1m' if secs < 60 else '1_3m' if secs < 180 else '3_10m' if secs < 600 else 'gt10m'}")
        usd = float(sess.get("est_usd") or 0.0) - usd0
        if int(sess.get("reads") or 0) > reads0:
            _bump(self.hass, f"plan_build_credit_run:{self.STAGE}_{'lt0_10' if usd < 0.10 else '0_10_0_50' if usd < 0.5 else '0_50_2' if usd < 2 else 'gt2'}")


def ending_stop(status: str, why: str | None) -> str | None:
    """The named stop a session's ending is (design 14: every failed or
    stopped session says why on its card), or None for done."""
    if status == "cancelled":
        return {"locked": "locked", "plan_changed": "plan_changed", "plan_gone": "plan_changed", "ai_changed": "ai_changed"}.get(str(why), "cancelled")
    if status == "failed":
        return {"timeout": "out_of_time", "suspect_frame": "bad_answer"}.get(str(why)) or (why if why in STOPS else "error")
    return {"no_credit": "no_credit", "out_of_time": "out_of_time", "needs_help": "help_unanswered"}.get(status)


def resumable(sess: dict[str, Any] | None) -> bool:
    """Whether Resume can carry a session on: it stopped short, and not
    because a plan changed under it or its AI Task did (those line up again)."""
    return bool(sess) and sess.get("status") in LINEUP_RESUMABLE and sess.get("error") not in LINEUP_NOT_RESUMABLE


def resume_refused(hass: HomeAssistant, store: PlanAiStore, sess: dict[str, Any] | None) -> str | None:
    """Why Resume can't carry this session on: not_open, or a named stop;
    None when it can. Checked before a start is spent: a plan moved or the
    AI Task changed since it stopped (fail closed) means lining the floor up
    again, said once on the session, never a run that stops at once."""
    if not resumable(sess):
        return ending_stop("cancelled", sess.get("error")) if sess and sess.get("error") in LINEUP_NOT_RESUMABLE else "not_open"
    u = unlock(hass)
    why = "ai_changed" if u.get("ok") and u.get("ai_task") != sess.get("ai_task") else "plan_changed" if plans_moved(hass, sess) else None
    if why is None:
        return None
    sess.update(status="cancelled", error=why, rev=int(sess.get("rev") or 0) + 1)
    note_stop(hass, store.data, sess, why)
    return why


def count_items(hass: HomeAssistant, sess: dict[str, Any]) -> None:
    """The proposals shown, by kind, how far they move and what they would shift (design 10)."""
    for it in (sess.get("items") or {}).values():
        _bump(hass, f"plan_build_item:{it['kind']}_shown")
        if it.get("max_move_m") is not None:
            _bump(hass, f"plan_build_move:shown_{_band_m(float(it['max_move_m']))}")
            _bump(hass, f"plan_build_scale_change:shown_{_scale_band(float(it.get('scale_change') or 0) * 100)}")
        kinds = {f["what"] for f in it.get("flags") or []}
        for k in ("calibration", "room_trace"):
            if k in kinds:
                _bump(hass, f"plan_build_flags:{k}")
        if kinds & {"receiver", "beacon", "light"}:
            _bump(hass, "plan_build_flags:device")
        for f in it.get("flags") or []:
            if f["what"] == "calibration":
                _bump(hass, f"plan_build_flag_move:{_band_m(float(f['moved_m']))}")


def start_lineup(hass: HomeAssistant, store: PlanAiStore, sess: dict[str, Any], sid: str | None = None) -> str:
    """Keep a line-up session and start its job, in the plan AI's one job slot
    (one AI job per house). Nothing here waits."""
    sid = sid or "pb_" + secrets.token_hex(4)
    dom = hass.data.setdefault(DOMAIN, {})
    now = time.monotonic()
    dom[_DATA_STARTS] = [t for t in dom.get(_DATA_STARTS, []) if now - t < 86400] + [now]
    store.data.setdefault("lineups", {})[sid] = sess
    store.trim()
    job = Job(sid)
    dom[_DATA_JOB] = job
    job.task = hass.async_create_background_task(LineupRunner(hass, store, job, str(sess.get("ai_task") or "")).run(), "padspan_ha plan_build")
    return sid


def resume_lineup(hass: HomeAssistant, store: PlanAiStore, sid: str) -> str:
    """Resume a session that stopped short (out of time, credit, reach, a
    restart): what was read stays; the rest is read; the local steps run again."""
    sess = store.lineup(sid) or {}
    sess["resumes"] = int(sess.get("resumes") or 0) + 1
    if sess["resumes"] > S1_RESUMES_STRESS:
        _bump(hass, "plan_build_stress:resumes")
    stop_resolved(hass, sess, ("out_of_time", "no_credit", "unreachable", "no_media", "cancelled", "restart", "bad_answer", "refusal", "error"))
    # A resume gets a whole budget of its own; the time spent before is kept apart.
    sess["spent_earlier"] = round(float(sess.get("spent_earlier") or 0.0) + float(sess.get("spent_s") or 0.0), 1)
    sess.update(status="running", error=None, finished_at=None, spent_s=0.0, spent_before=0.0, budget_s=S1_BUDGET_S)
    return start_lineup(hass, store, sess, sid)


def start_answer(hass: HomeAssistant, store: PlanAiStore, sid: str, only: set[str]) -> None:
    """An answer's rerun of the local steps (no new read, design 3.5) as the
    house's one job: Stop reaches it, the other commands wait for it, and it
    runs outside the plan store's lock (Add data via plans shares that lock).
    The caller has marked the session running."""
    dom = hass.data.setdefault(DOMAIN, {})
    job = Job(sid)
    dom[_DATA_JOB] = job
    job.task = hass.async_create_background_task(answer_locally(hass, store, job, only), "padspan_ha plan_build answer")


async def answer_locally(hass: HomeAssistant, store: PlanAiStore, job: Job, only: set[str] | None = None) -> None:
    """The rerun: the plans the answer was about fitted again (`only`; the
    others keep their items), each fit within G.FIT_SECS; then needs_help or
    done, or cancelled by Stop, or failed, each with its stop."""
    sid = job.sid
    sess = store.lineup(sid)
    if sess is None:
        return
    status, why, stops = None, None, []
    try:
        stops = await LineupRunner(hass, store, job, str(sess.get("ai_task") or "")).local(only=only)
        if job.cancel:
            status, why = "cancelled", "user"
    except Exception as err:  # noqa: BLE001 — the rerun fails; nothing else is touched
        _LOGGER.warning("PadSpan plan line-up: re-measuring after an answer stopped: %s", P._why(err))  # noqa: SLF001
        status, why = "failed", "error"
    sess = store.lineup(sid)
    if sess is None:
        return
    for reason, mid in stops:
        note_stop(hass, store.data, sess, reason, mid)
    if status is None:
        status = "needs_help" if any(q.get("state") == "open" for q in sess.get("questions") or []) else "done"
    sess.update(status=status, error=why, finished_at=time.time())
    if ending_stop(status, why) and status != "needs_help":
        note_stop(hass, store.data, sess, ending_stop(status, why))
    sess["progress"] = {"plan": len(sess.get("plans") or []), "of": len(sess.get("plans") or []), "name": "", "step": "done"}
    sess["rev"] = int(sess.get("rev") or 0) + 1
    await store.async_save()


def apply_answer(sess: dict[str, Any], qid: str, answer: Any) -> str:
    """A person's answer on its question: yes, {metres}, {taps} or skip. The
    help counter's word (dimension_yes, dimension_typed, …), else a refusal
    word (not_open, bad_answer)."""
    q = next((q for q in sess.get("questions") or [] if q.get("id") == qid), None)
    if q is None or q.get("state") != "open":
        return "not_open"
    pl = next((p for p in sess.get("plans") or [] if p["map_id"] == q["map_id"]), None)
    if pl is None:
        return "not_open"
    if q["kind"] == "confirm_dimension":
        dims = pl.get("dims") or []
        d = dims[int(q.get("dim") or 0)] if int(q.get("dim") or 0) < len(dims) else None
        if answer == "skip":
            q.update(state="skipped", answer="skip")
            if d is not None:
                d.update(source="skipped", ok=False, done=True, why="skipped")
            return "dimension_skipped"
        if d is None:
            return "not_open"
        for o in dims:                                # the person's word on this axis: the other readings of it are set aside
            if o is not d and o.get("axis") == d.get("axis") and o.get("source") == "ai":
                o.update(source="set_aside", ok=False, done=True, why="set_aside")
        if answer == "yes":
            q.update(state="answered", answer="yes")
            d.update(confirmed=True, done=False)
            if d.get("why") == "parse_mismatch":
                d.update(source="person")             # Claude's metres, as the person confirmed them
            return "dimension_yes"
        metres = S._num((answer or {}).get("metres")) if isinstance(answer, dict) else None  # noqa: SLF001
        if metres is None or not 0.1 <= metres <= 200:
            return "bad_answer"
        q.update(state="answered", answer={"metres": round(metres, 4)})
        d.update(source="person", metres=round(metres, 4), chain=[], confirmed=True, done=False, text=f"{round(metres, 3)} m")
        return "dimension_typed"
    if q["kind"] == "tap_corners":
        if answer == "skip":
            q.update(state="skipped", answer="skip")
            pl["left_out"] = True
            return "taps_skipped"
        taps = (answer or {}).get("taps") if isinstance(answer, dict) else None
        try:
            ok = isinstance(taps, list) and len(taps) == 4 and all(0 <= float(t[0]) <= 1 and 0 <= float(t[1]) <= 1 for t in taps)
        except (TypeError, ValueError, IndexError):
            ok = False
        if not ok:
            return "bad_answer"
        q.update(state="answered", answer={"taps": [[round(float(t[0]), 4), round(float(t[1]), 4)] for t in taps]})
        return "taps_done"
    return "not_open"


def sweep_abandoned(hass: HomeAssistant, store: PlanAiStore, now: float | None = None) -> int:
    """Line-ups that ended with proposals and no verdict for S1_ABANDON_DAYS,
    or that a newer one on the same floor replaced: abandoned, counted once
    with the last stop's reason kept (design 10, 14)."""
    now = time.time() if now is None else now
    lineups = store.data.get("lineups") or {}
    latest: dict[Any, float] = {}
    for s in lineups.values():
        if isinstance(s, dict):
            latest[s.get("floor_id")] = max(latest.get(s.get("floor_id"), 0.0), float(s.get("started_at") or 0))
    n = 0
    for s in lineups.values():
        if not isinstance(s, dict) or s.get("abandoned") or s.get("status") not in ("done", "needs_help"):
            continue
        items = [i for i in (s.get("items") or {}).values() if isinstance(i, dict) and i.get("state") == "open"]
        if not items or any(i.get("verdict") for i in (s.get("items") or {}).values() if isinstance(i, dict)):
            continue
        replaced = float(s.get("started_at") or 0) < latest.get(s.get("floor_id"), 0.0)
        if replaced or now - float(s.get("finished_at") or now) > S1_ABANDON_DAYS * 86400:
            last = (s.get("stops") or [{}])[-1]
            s["abandoned"] = {"at": now, "last_stop": last.get("reason")}
            _bump(hass, "plan_build_run:s1_abandoned")
            if replaced and last.get("at") and now - float(last["at"]) < S1_QUICK_ABANDON_S:
                _bump(hass, "plan_build_stress:quick_abandon")
            note_stop(hass, store.data, s, "abandoned")
            n += 1
    return n


def lineup_public(sess: dict[str, Any] | None, sid: str | None) -> dict[str, Any] | None:
    """A line-up as the screen sees it, every stop in words."""
    if not sess:
        return None
    return {"id": sid, **{k: v for k, v in sess.items() if k not in ("references", "spent_before")},
            "stops": [stop_words(r) for r in sess.get("stops") or []], "resumable": resumable(sess)}


def stall_summary(store: PlanAiStore) -> dict[str, Any]:
    """This house's stops, this month and over the months kept (design 14:
    shown to Garry in the house, not only in the report)."""
    stall = store.data.get("stall") or {}
    month = stall.get(_month()) or {}
    total: dict[str, int] = {}
    for m in stall.values():
        for k, v in (m or {}).items():
            total[k] = total.get(k, 0) + int(v or 0)
    return {"month": dict(month), "all": total, "words": {k: STOPS[k][0] for k in set(month) | set(total) if k in STOPS}}


# ── Saving, the reading side (Stage 1b) ──────────────────────────────────────
# What a save (plan_ai_write.lineup_commit) and the status check agree on. The
# writes themselves are plan_ai_write.py's; nothing here writes.

def placement_of(t: Any) -> dict[str, float] | None:
    """A placement's six numbers as the store keeps them (origin and scale to
    0.1 mm, turn and lean to 1 µrad, as the Align editor's commit stores them), an absent
    lean read as 0.0 (the same placement bit for bit: model_store's note), so
    two records compare as placements. None: not a placement."""
    if not isinstance(t, dict) or not t.get("scale_x_m") or not t.get("scale_y_m"):
        return None
    try:
        return {k: round(float(t.get(k) or 0.0), 6 if k in ("rotation_rad", "shear_rad") else 4) for k in G.FIELDS}
    except (TypeError, ValueError):
        return None


def item_now(snap: dict, sess: dict, it: dict) -> str | None:
    """Whether an item still stands on the house as it is now: None, or why
    not: gone (the plan isn't placed any more), picture (its picture changed),
    moved (its placement or its floor changed), anchor (the plan it was fitted
    to moved), floor_gone (a refile's floor isn't in the house any more).
    Placements compare as placements, so an undo that put a plan back makes
    its item good again (design 12: applied, undone, applied again)."""
    p = snap["plans"].get(it.get("map_id"))
    if p is None or placement_of(p.get("t")) is None:
        return "gone"
    if not same_picture(it.get("image_sig"), p):
        return "picture"
    if p["floor_id"] != sess.get("floor_id"):
        return "moved"
    if it.get("kind") == "refile":                 # the floor it goes to must still be one of the house's (design 2, step 1)
        to = (it.get("proposal") or {}).get("to_floor_id")
        return None if any(f["id"] == to for f in snap["floors"]) else "floor_gone"
    if placement_of(p["t"]) != placement_of(it.get("now")):
        return "moved"
    anchor = (it.get("evidence") or {}).get("anchor")
    if anchor:
        a = snap["plans"].get(anchor)
        if a is None:
            return "anchor"
        if isinstance(it.get("anchor_now"), dict):
            if placement_of(a.get("t")) != placement_of(it["anchor_now"]):
                return "anchor"
        else:                                          # an item from before anchor_now was kept: the signature it was read with
            pl = next((x for x in sess.get("plans") or [] if x.get("map_id") == anchor), None)
            if pl is None or pl.get("place_sig") != a.get("place_sig"):
                return "anchor"
    return None


def refile_by_hand(sess: dict, snap: dict, map_id: str, to_floor_id: str) -> tuple[str, dict | None]:
    """The person says a plan shows another floor (design 2, "By hand"): the
    same item a suggested refile is, under the same rules. (word, item): ok;
    refile_refused with the item (things are drawn on it, it says what);
    measured_plan_protected; not_found; invalid (not an indoor floor, or its own)."""
    pl = next((p for p in sess.get("plans") or [] if p.get("map_id") == map_id), None)
    sp = snap["plans"].get(map_id)
    floors = {f["id"]: f for f in snap["floors"]}          # indoor only: never to or from Outside
    if pl is None or sp is None or sp["floor_id"] != sess.get("floor_id"):
        return "not_found", None
    if map_id == snap["gauge_map"]:
        return "measured_plan_protected", None
    if to_floor_id not in floors or to_floor_id == sess.get("floor_id"):
        return "invalid", None
    it = {"kind": "refile", "map_id": map_id, "name": pl.get("name") or "", "image_sig": sp["image_sig"], "target_place_sig": sp["place_sig"],
          "state": "open", "verdict": None, "held": None, "by_hand": True,
          "proposal": {"to_floor_id": to_floor_id, "why": {"title": None, "rooms": []}}, "to_name": floors[to_floor_id].get("name"),
          "drawn": dict(sp["drawn"]), "flags": [], "others": {"n": 0, "names": []}}
    if drawn_total(sp["drawn"]):
        it["state"] = "refused"
        return "refile_refused", it
    return "ok", it


def lineup_undo_info(store: PlanAiStore, sid: str | None = None) -> dict[str, Any] | None:
    """The newest line-up session with saves still to undo (or that session):
    {session, floor_id, items, saves, at}; None when there is none. Answered
    whatever the AI Task (form q3: Settings → AI keeps the undo reachable)."""
    by: dict[str, dict[str, Any]] = {}
    for b in (store.data.get("lineup_batches") or {}).values():
        if not isinstance(b, dict) or b.get("undo_of") or b.get("undone_at") or b.get("pending") or not b.get("session"):
            continue
        if sid and b["session"] != sid:
            continue
        s = by.setdefault(b["session"], {"session": b["session"], "floor_id": b.get("floor_id"), "items": 0, "saves": 0, "at": 0.0})
        s["items"] += len(b.get("items") or [])
        s["saves"] += 1
        s["at"] = max(s["at"], float(b.get("committed_at") or 0))
    return max(by.values(), key=lambda s: s["at"], default=None)


# ══ Build from plans: rooms, doors, windows and stairs (Stage 2; experimental) ══
# Design: PadspanResearch/plan-build-design-2026-11.md, section 5 (Stage 2 as
# built, 2026-11-10), from the read-only test of that day (rooms-stage2-test-
# 2026-11-10.md, "All at once"): one whole-plan read gives the rooms, doors,
# windows and stairs together, and two reads of each plan tell the weak rooms
# apart. Reads go through Runner.ask/read (the one plan reader); the proposal
# is pure (rooms_proposal); nothing here writes the house: the one write and
# its undo are plan_ai_write.py's (rooms_commit, rooms_undo, settle_rooms).

# ── The numbers that can stop or hold it back (design 14), each with why ─────
S2_READS = 2                 # reads of each plan: where the two disagree, the room is weak (test, 2026-11-10)
S2_PICTURE_PX, S2_PICTURE_MP = 1568, 1.15     # as tested (the research harness's Anthropic limit); Stage 1's size wasn't tried
S2_INSIDE = 0.60             # a printed space this much inside one of the person's rooms is part of it (the test's rule)
S2_AGREE = 0.85              # the two reads' outlines of a room this alike: ready (every weak room of the test was under it)
S2_SAME_SPACE = 0.5          # two printed spaces outside every room this alike (IoU) are one
S2_SAME_M = 0.5              # a door or window this close to another is the same one (the test scored within 0.5 m)
S2_SNAP_M = 0.6              # a door or window this close to an outline's edge is put on it; further: not offered
S2_STAIR_SAME_M = 1.0        # two reads' stairs this close are one (plan_ai.DUP_M)
S2_WIDTH_M = {"door": 0.8, "doorway": 0.9, "window": 1.2}     # the read gives only a centre
S2_MIN_M = {"door": 0.6, "doorway": 0.6, "window": 0.3}       # house3d_store's DOOR_MIN_M and WINDOW_MIN_M
S2_DOOR_HEAD_M, S2_WINDOW_SILL_M, S2_WINDOW_HEAD_M = 2.03, 0.9, 2.1   # the 3D editor's defaults (live_aboard_draft.js)
S2_GATE_SPOTS = 10           # under this many labelled spots on the floor its score is shown "too few to judge"
S2_SIMPLIFY_M = 0.05         # a saved outline keeps the corners a person would draw: none moves more than this (Garry, 2026-11-10)
S2_NAME_MAX = 40             # a new room's name, at most
MAX_ROOM_SESSIONS = 10       # sessions kept
S2_DOOR_TYPES = {"sliding": "sliding", "pocket": "pocket", "bifold": "bifold"}   # the read's kind kept as the door's type
S2_LABEL = "Stairs (from the plan)"                                               # plan_ai_write.PIECE_LABEL

STOPS.update({
    "rooms_changed": ("A room, a door or a stair was changed in your house since Claude read the plans, so nothing was saved.",
                      "Read the floor again."),
    "name_taken": ("That name is already a room in your house.", "Pick another name, or merge the space into that room."),
})

ROOMS_SCHEMA = ('{"rooms": [{"name": "...", "corners": [[x, y], ...]}], '
                '"doors": [{"at": [x, y], "between": ["room", "room or outside"], "kind": "hinged|sliding|pocket|bifold|opening"}], '
                '"windows": [{"at": [x, y], "room": "..."}], '
                '"stairs": [{"box": [x1, y1, x2, y2], "room": "...", "says": "UP|DOWN|none"}]}')


def rooms_prompt(w: int, h: int) -> str:
    """The tested all-at-once prompt, word for word (run_joint_s2.prompt_joint,
    look_first False). A change must be tested again before it ships
    (tests/test_plan_build_rooms.py pins it)."""
    return (f'This floor plan picture is {w} by {h} pixels. Read it the way an architect would, as one drawing: the walls '
            '(thick lines, outside and inside), the doors (a gap in a wall, usually with a thin quarter-circle swing arc; '
            'also sliding, pocket and folding doors, and plain cased openings), the windows (thin parallel lines set in an '
            'outside wall), the stairs (a run of many short parallel tread lines, often with an arrow and UP or DN), the '
            'fixtures (counters, tubs, toilets, appliances) and the printed room names. Door swing arcs, stair treads, '
            'fixtures, dimension lines and text are not walls. Then give:\n'
            '- rooms: every room or named space, traced along the inside faces of its walls, corners in order around the '
            'room. A door or opening sits in its wall, so the outline runs straight across it. Where a space is open to '
            'another with no wall between, follow the line the opening makes. A staircase belongs to the room or hall it '
            'stands in, so that outline includes it.\n'
            '- doors: the centre of each door or opening, and the two rooms it joins ("outside" for an outside door).\n'
            '- windows: the centre of each window and its room.\n'
            '- stairs: the box around each staircase, the room it is in, and UP or DOWN as printed.\n'
            'Use pixels of this picture. Ignore the title block, notes and dimension text. Output only JSON: ' + ROOMS_SCHEMA)


def last_json(answer: Any) -> dict | None:
    """The answer's LAST JSON object holding what was asked (Claude sometimes
    corrects itself: "Let me reconsider…" and a second, cleaner JSON). A dict
    answer is itself."""
    if isinstance(answer, dict):
        return answer
    s, out, i = answer if isinstance(answer, str) else "", None, 0
    dec = json.JSONDecoder()
    while i < len(s):
        j = s.find("{", i)
        if j < 0:
            break
        try:
            v, end = dec.raw_decode(s, j)
        except ValueError:
            i = j + 1
            continue
        if isinstance(v, dict) and any(k in v for k in ("rooms", "doors", "windows", "stairs")):
            out = v
        i = end
    return out


def _pt(v: Any, w: int, h: int, k: float) -> list[float] | None:
    """A point in the sent frame, checked against it, in the picture's own pixels."""
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        return None
    x, y = S._num(v[0]), S._num(v[1])  # noqa: SLF001
    e = S.PAST_EDGE_FRAC
    if x is None or y is None or not (-e * w <= x <= (1 + e) * w and -e * h <= y <= (1 + e) * h):
        return None
    return [round(min(max(x, 0.0), float(w)) / k, 1), round(min(max(y, 0.0), float(h)) / k, 1)]


def parse_rooms_read(answer: Any, w: int, h: int, k: float = 1.0) -> dict[str, Any] | None:
    """One read reduced to numbers, short names (40 characters) and closed
    words, in the picture's own pixels (÷ k, the sent size over the
    picture's). None when it isn't the object asked for."""
    o = last_json(answer)
    if o is None:
        return None
    rooms = []
    for r in (o.get("rooms") or [])[:60]:
        if not isinstance(r, dict):
            continue
        pts = [p for p in (_pt(c, w, h, k) for c in (r.get("corners") or [])[:80]) if p]
        if len(pts) >= 3 and G.area(pts) > 0:
            rooms.append({"name": _short(r.get("name")) or "?", "px": pts})
    doors = []
    for d in (o.get("doors") or [])[:80]:
        at = _pt(d.get("at"), w, h, k) if isinstance(d, dict) else None
        if at:
            kind = str(d.get("kind") or "hinged").strip().lower()
            between = [_short(b) or "?" for b in (d.get("between") or [])[:2]] if isinstance(d.get("between"), list) else []
            doors.append({"px": at, "kind": kind if kind in ("hinged", "sliding", "pocket", "bifold", "opening") else "hinged", "between": between})
    windows = []
    for d in (o.get("windows") or [])[:120]:
        at = _pt(d.get("at"), w, h, k) if isinstance(d, dict) else None
        if at:
            windows.append({"px": at, "room": _short(d.get("room"))})
    stairs = []
    for d in (o.get("stairs") or [])[:8]:
        box = _box(d.get("box"), w, h, k) if isinstance(d, dict) else None
        if box:
            says = str(d.get("says") or "").strip().upper()
            stairs.append({"box": box, "room": _short(d.get("room")), "says": "DOWN" if says in ("DN", "DOWN") else "UP" if says == "UP" else ""})
    return {"rooms": rooms, "doors": doors, "windows": windows, "stairs": stairs}


# ── Which plans are lined up (the precondition, design 5) ───────────────────

def rooms_ready(store: PlanAiStore, snap: dict, floor_id: str) -> dict[str, Any]:
    """Which plans of a floor can be read for rooms, and what the line-up says
    of them (design 5; Garry, 2026-11-10: the line-up is a note, not a
    block). Every plan with a placement in metres on the floor is read where
    it sits now; the only refusal is a floor with none (not_placed). The
    floor's newest line-up gives a note: none run, still open (questions), or
    a plan moved since; and per plan: lined up, not lined up, or showing
    another floor (an open refile: offered unticked). {ok, why, lineup,
    lined_up, note, plans: [map ids], suggest: [map ids ticked], others:
    [{map_id, name, why}]}."""
    plans_ = [mid for mid, p in snap["plans"].items() if p.get("floor_id") == floor_id and p.get("t", {}).get("scale_x_m")
              and p["size"][0] and p["size"][1] and str(floor_id).lower() not in (OUTSIDE_FLOOR_ID, "outside")][:S1_PLANS_MAX]
    out: dict[str, Any] = {"ok": bool(plans_), "why": "ok" if plans_ else "not_placed", "lineup": None, "lined_up": False, "note": None,
                           "plans": plans_, "suggest": list(plans_), "others": []}
    lus = [(sid, s_) for sid, s_ in (store.data.get("lineups") or {}).items() if isinstance(s_, dict) and s_.get("floor_id") == floor_id]
    if not lus:
        out["note"] = "no_lineup"
        return out
    sid, sess = max(lus, key=lambda t: float(t[1].get("started_at") or 0))
    out["lineup"] = sid
    items = sess.get("items") or {}
    seen = {pl.get("map_id"): pl for pl in sess.get("plans") or []}
    for mid in plans_:
        pl, now = seen.get(mid), snap["plans"][mid]
        it, rf = items.get(f"place_{mid}") or {}, items.get(f"refile_{mid}") or {}
        if rf and rf.get("state") not in ("wrong", "not_now", "committed", "undone"):
            why = "other_floor"                       # the line-up says it shows another floor: offered, unticked
            out["suggest"].remove(mid)
        elif pl is None:
            why = "not_lined_up"
        elif not same_picture(pl.get("image_sig"), now) or now.get("place_sig") != pl.get("place_sig"):
            why = "moved"
        elif not (pl.get("role") in ("gauge", "anchor", "reference") or it.get("state") in ("committed", "same")):
            why = "not_lined_up"
        else:
            continue
        out["others"].append({"map_id": mid, "name": now.get("name") or "", "why": why})
    out["lined_up"] = sess.get("status") == "done" and not out["others"]
    out["note"] = None if out["lined_up"] else "lineup_open" if sess.get("status") != "done" else "moved" if any(o["why"] == "moved" for o in out["others"]) else "not_lined_up"
    return out


def rooms_estimate(hass: HomeAssistant, sizes: list[list[int]]) -> float | None:
    """What S2_READS reads of each plan may cost on the main AI Task, by the
    AI credit tracker's formula; None: no price known for the model."""
    price = U.price_of(U.model_of(hass, str(unlock(hass).get("ai_task") or "")))
    if price is None:
        return None
    usd = 0.0
    for size in sizes:
        w, h = (int(v or 0) for v in (list(size or []) + [0, 0])[:2])
        if w and h:
            k = min(1.0, S2_PICTURE_PX / max(w, h), math.sqrt(S2_PICTURE_MP * 1e6 / (w * h)))
            usd += S2_READS * (U.estimate_usd(price, (round(w * k), round(h * k)), len(rooms_prompt(w, h))) or 0.0)
    return round(usd, 4)


def new_rooms_session(u: dict, snap: dict, floor_id: str, ready: dict, map_ids: list[str]) -> dict[str, Any]:
    """A rooms session about to run, in this store's "rooms"."""
    plans_ = []
    for mid in map_ids:
        p = snap["plans"][mid]
        plans_.append({"map_id": mid, "name": p["name"], "floor_id": p["floor_id"], "image_sig": p["image_sig"], "place_sig": p["place_sig"],
                       "size_px": list(p["size"]), "t": dict(p["t"]), "reads": [None] * S2_READS})
    return {"rev": 1, "stage": "s2", "floor_id": floor_id, "lineup": ready.get("lineup"), "started_at": time.time(), "finished_at": None,
            "status": "running", "error": None, "ai_task": u.get("ai_task"),
            "model": {"family": u.get("family"), "version": u.get("version"), "display": u.get("display")}, "frame": PIXEL_FRAME,
            "budget_s": S1_BUDGET_S, "spent_s": 0.0, "spent_before": 0.0, "reads": 0, "timeouts": 0, "errors": {}, "est_usd": 0.0,
            "resumes": 0, "plans": plans_, "stops": [], "edits": {"merges": [], "spaces": {}, "picks": {}}, "proposal": None,
            "progress": {"plan": 0, "of": len(plans_), "name": "", "step": "read 1"}}


# ── The proposal (pure; design 5) ───────────────────────────────────────────

def _barrier_kind(b: dict) -> str:
    """What the 3D view draws a barrier as (live_aboard_house.js barrierKind)."""
    m, n = str(b.get("material") or "").lower(), str(b.get("name") or "")
    if m == "open":
        return "open"
    if m == "glass" or re.search(r"window", n, re.I):
        return "window"
    if re.search(r"\b(door|gate)\b", n, re.I) or "door" in str(b.get("linked_entity_id") or "").lower():
        return "door"
    return "wall"


def _cls(kind: str) -> str:
    return "window" if kind == "window" else "door"


def _to_m(t: dict, size: list, px: list) -> list[float]:
    return [round(v, 3) for v in placement_metres(t, px[0] / size[0], px[1] / size[1])]


def _cluster(found: list[dict], near: Callable[[dict, dict], bool]) -> list[list[dict]]:
    """Greedy: each find joins the first group it is near, from another plan."""
    groups: list[list[dict]] = []
    for f in found:
        g = next((g for g in groups if all(o["plan"] != f["plan"] for o in g) and near(g[0], f)), None)
        if g is None:
            groups.append([f])
        else:
            g.append(f)
    return groups


def _pair(a: list[dict], b: list[dict], tol: float) -> tuple[list[tuple[dict, dict]], list[dict]]:
    """Read 1's and read 2's finds paired greedily, nearest first, within tol: (pairs, the rest)."""
    cand = sorted((math.dist(x["at"], y["at"]), i, j) for i, x in enumerate(a) for j, y in enumerate(b) if x["cls"] == y["cls"])
    ua, ub, pairs = set(), set(), []
    for d, i, j in cand:
        if d <= tol and i not in ua and j not in ub:
            ua.add(i)
            ub.add(j)
            pairs.append((a[i], b[j]))
    return pairs, [x for i, x in enumerate(a) if i not in ua] + [y for j, y in enumerate(b) if j not in ub]


def _snap_opening(o: dict, outlines: dict[str, list], names: dict[str, str]) -> dict[str, Any] | None:
    """A door onto the wall between the two outlines it joins (the middle of
    the nearest points on both faces), an outside door or a window onto its
    outline's nearest edge, within S2_SNAP_M; None: on no wall."""
    x, y = o["at"]
    want = [names.get(n) for n in o.get("names") or [] if names.get(n)]
    pool = {k: v for k, v in outlines.items() if v}

    def edge(k: str) -> dict | None:
        e = G.nearest_edge(pool[k], x, y)
        return e if e and e["d"] <= S2_SNAP_M else None

    joins = [k for k in dict.fromkeys(want) if k in pool]
    if o["cls"] == "door" and len(want) >= 2 and len(set(want)) == 1:
        return None                                # both printed rooms inside one of his (a suite): its wall isn't one of his; never the outer wall (review B9)
    if o["cls"] == "door" and len(joins) < 2 and "outside" not in [str(n).lower() for n in o.get("names") or []]:
        near = sorted((e["d"], k) for k in pool if (e := edge(k)))
        joins = list(dict.fromkeys(joins + [k for _d, k in near]))[:2]
    if o["cls"] == "door" and len(joins) >= 2:
        ea, eb = edge(joins[0]), edge(joins[1])
        if ea and eb:
            mid = ((ea["at"][0] + eb["at"][0]) / 2, (ea["at"][1] + eb["at"][1]) / 2)
            return {"at": mid, "u": ea["u"], "room": [joins[0], joins[1]], "length": ea["length"]}
    cands = joins or list(pool)
    best = min(((e["d"], k, e) for k in cands if (e := edge(k))), default=None, key=lambda t: t[0])
    if best is None:
        return None
    _d, k, e = best
    return {"at": e["at"], "u": e["u"], "room": [k], "length": e["length"]}


def _ends(at: tuple, u: tuple, kind: str, length: float) -> tuple[list[float], list[float]]:
    w = max(S2_MIN_M[kind], min(S2_WIDTH_M[kind], length))
    return ([round(at[0] - u[0] * w / 2, 3), round(at[1] - u[1] * w / 2, 3)], [round(at[0] + u[0] * w / 2, 3), round(at[1] + u[1] * w / 2, 3)])


def existing_openings(house: dict | None, barriers: list, floor_id: str) -> list[dict]:
    """The doors and windows already in the house on a floor: the 3D file's
    own (added in 3D) and the barriers the 3D view draws as one."""
    out = []
    for oid, e in ((house or {}).get("openings") or {}).items():
        if isinstance(e, dict) and H_OPENING.match(str(oid)) and str(e.get("floor_id")) == floor_id and e.get("a_m") and e.get("b_m"):
            a, b = e["a_m"], e["b_m"]
            out.append({"id": str(oid), "what": "opening", "cls": _cls(str(e.get("kind"))), "at": ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), "line": [a, b],
                        "entry": copy.deepcopy(e)})
    for b in barriers or []:
        if isinstance(b, dict) and str(b.get("floor_id")) == floor_id and len(b.get("points_m") or []) >= 2:
            k = _barrier_kind(b)
            if k in ("door", "window"):
                pts = b["points_m"]
                out.append({"id": str(b.get("id") or ""), "what": "barrier", "cls": k, "at": tuple(G.centroid(pts)), "line": pts})
    return out


H_OPENING = re.compile(r"^(win|door|doorway)_[0-9a-f]{8}$")    # house3d_store.OPENING_ID


def _near_existing(o: dict, have: list[dict]) -> dict | None:
    for e in have:
        if e["cls"] != o["cls"]:
            continue
        line = e["line"]
        d = min(G._seg_dist(o["at"], line[i - 1], line[i]) for i in range(1, len(line)))  # noqa: SLF001
        if d <= S2_SAME_M:
            return {"id": e["id"], "what": e["what"], **({"entry": e["entry"]} if e.get("entry") else {})}
    return None


def _read_finds(sess: dict, k: int) -> dict[str, list[dict]]:
    """Read k of every plan in metres: rooms, doors and windows, stairs."""
    out: dict[str, list[dict]] = {"rooms": [], "openings": [], "stairs": []}
    for n, pl in enumerate(sess.get("plans") or []):
        reads = pl.get("reads") or []
        r = reads[k] if k < len(reads) else None          # a third read exists only on the plans read again
        if not r:
            continue
        t, size = pl["t"], pl["size_px"]
        for room in r.get("rooms") or []:
            out["rooms"].append({"plan": n, "name": room["name"], "poly": [_to_m(t, size, p) for p in room["px"]]})
        for d in r.get("doors") or []:
            kind = "doorway" if d.get("kind") == "opening" else "door"
            out["openings"].append({"plan": n, "cls": "door", "kind": kind, "type": S2_DOOR_TYPES.get(d.get("kind")),
                                    "at": tuple(_to_m(t, size, d["px"])), "names": d.get("between") or []})
        for d in r.get("windows") or []:
            out["openings"].append({"plan": n, "cls": "window", "kind": "window", "type": None, "at": tuple(_to_m(t, size, d["px"])),
                                    "names": [d.get("room")] if d.get("room") else []})
        for s in r.get("stairs") or []:
            got = S.stairs_from_answer([{"bbox_2d": s["box"], "says": s.get("says")}], size[0], size[1],
                                       lambda fx, fy, t=t: placement_metres(t, fx, fy))
            if got:
                out["stairs"].append({**got[0], "plan": n, "plan_floor": pl["floor_id"], "room": s.get("room"), "box_px": s["box"]})
    return out


def rooms_proposal(sess: dict, snap: dict, house: dict | None, points: list[dict], barriers: list | None = None) -> dict[str, Any]:
    """Everything the session proposes, from its reads and the person's edits,
    against the house as it is (design 5). Pure; run in the executor."""
    fid = sess["floor_id"]
    edits = sess.get("edits") or {}
    his = {n: r["points_m"] for n, r in snap["rooms"].items() if r.get("floor_id") == fid and len(r.get("points_m") or []) >= 3}
    # A third read, made for a room the person asked to read again (plan_build_rooms_read_again): two out of three decide it.
    nr = S2_READS + 1 if any(len(pl.get("reads") or []) > S2_READS and pl["reads"][S2_READS] for pl in sess.get("plans") or []) else S2_READS
    reads = [_read_finds(sess, k) for k in range(nr)]
    labelled = [p for p in points if str(p.get("floor_id")) == fid and p.get("room") in his and p.get("x_m") is not None]

    # Rooms by overlap into his rooms, never by name; what lies in none is an extra space.
    parts: list[dict[str, list]] = [{n: [] for n in his} for _ in range(nr)]
    loose: list[dict] = []
    owner: list[dict[tuple[int, str], str]] = [{} for _ in range(S2_READS)]
    for k, rd in enumerate(reads):
        for f in rd["rooms"]:
            shares = [(G.share_inside(f["poly"], q), n) for n, q in his.items()]
            best = max(shares, default=(0.0, None))
            if best[0] >= S2_INSIDE:
                parts[k][best[1]].append(f)
                if k < S2_READS:
                    owner[k][(f["plan"], f["name"])] = best[1]
            elif k < S2_READS:                          # extra spaces come from the two reads; a third is about one room
                loose.append({**f, "read": k})
    rooms: dict[str, dict] = {}
    for n, now in his.items():
        outs, names, raw, pieces = [], [], [], 0
        for k in range(nr):
            uniq: dict[str, dict] = {}
            for f in parts[k][n]:                       # one copy a printed name (overlapping plans read a room twice): the larger
                if f["name"] not in uniq or G.area(f["poly"]) > G.area(uniq[f["name"]]["poly"]):
                    uniq[f["name"]] = f
            o, m = G.merge_outline([f["poly"] for f in uniq.values()]) if uniq else ([], 0)
            outs.append(o or None)
            names.append(sorted(uniq))
            raw.append([f["poly"] for f in uniq.values()])
            pieces = max(pieces, m) if k < S2_READS else pieces
        if not any(outs[:S2_READS]):
            continue
        agree = round(G.union_iou(raw[0], raw[1]), 3) if all(outs[:S2_READS]) else None   # the test's measure; a third read never changes it
        mine = [p for p in labelled if p["room"] == n]
        spots_all = [sum(1 for p in mine if G.inside(float(p["x_m"]), float(p["y_m"]), o)) if o else -1 for o in outs]
        spots = spots_all[:S2_READS]
        pick = 0 if spots[0] >= spots[1] else 1
        picked_by = "spots"
        flags = [] if agree is not None and agree >= S2_AGREE else ["one_read" if agree is None else "reads_differ"]
        third = None
        if n in (edits.get("third") or []) and nr > S2_READS and outs[S2_READS] and "reads_differ" in flags:
            # Two out of three: read 3 against each of the two; the one it agrees with wins, else the three differ.
            vs = [round(G.union_iou(raw[k], raw[S2_READS]), 3) if outs[k] else 0.0 for k in range(S2_READS)]
            win = max(range(S2_READS), key=lambda k: vs[k])
            third = {"agree": vs, "decided": vs[win] >= S2_AGREE}
            if third["decided"]:
                pick, picked_by, flags = win, "two_of_three", []
            else:
                flags = ["three_differ"]
        if str(edits.get("picks", {}).get(n)) in ("1", "2", "3") and int(edits["picks"][n]) <= nr and outs[int(edits["picks"][n]) - 1]:
            pick, picked_by = int(edits["picks"][n]) - 1, "person"
        if pieces > 1:
            flags.append("apart")
        ready = ((agree is not None and agree >= S2_AGREE) or bool(third and third["decided"])) and pieces <= 1
        rooms[n] = {"id": f"room:{n}", "room": n, "now_m": now, "reads_m": outs, "parts": names, "agree": agree, "third": third,
                    # Parts that didn't join: the outline is only the largest of them, not what was read (dry run, Entry): not ready,
                    # offered unticked with the reason (Garry, 2026-11-10); the person can merge, tick or leave it.
                    "ready": ready, "pick": pick + 1, "picked_by": picked_by, "spots": spots + [len(mine)],
                    "spots_read3": spots_all[S2_READS] if nr > S2_READS else None,
                    "plans": sorted({sess["plans"][f["plan"]]["map_id"] for k in range(S2_READS) for f in parts[k][n]}),
                    "base_m": outs[pick], "merged": [], "flags": flags}
    unseen = sorted(n for n in his if n not in rooms)

    # Extra spaces: the same printed space read twice, or on two plans, is one.
    spaces: dict[str, dict] = {}
    groups: list[list[dict]] = []
    for f in sorted(loose, key=lambda f: -G.area(f["poly"])):
        g = next((g for g in groups if G.poly_iou(g[0]["poly"], f["poly"]) >= S2_SAME_SPACE), None)
        if g is None:
            groups.append([f])
        else:
            g.append(f)
    groups.sort(key=lambda g: (round(G.centroid(g[0]["poly"])[1], 1), round(G.centroid(g[0]["poly"])[0], 1)))
    for g in groups:
        # Its id comes from the read (plan, read, printed name, shape of the group's largest), never from its place in
        # the list: which spaces are loose depends on his rooms as they are now, and a name, a merge, a tick or "saved"
        # must stay on the same space after he edits a room (review B3).
        f0 = g[0]
        key = json.dumps([sess["plans"][f0["plan"]]["map_id"], f0["read"], f0["name"], [[round(v, 2) for v in p] for p in f0["poly"]]])
        sid = "space:" + hashlib.sha1(key.encode()).hexdigest()[:8]
        while sid in spaces:
            sid += "x"
        spaces[sid] = {"id": sid, "name": f0["name"], "outline_m": G.merge_outline([f0["poly"]])[0] or G.simplify(f0["poly"], 0.0),
                       "reads": sorted({f["read"] + 1 for f in g}), "merged_into": None, "new": None, "parts": [sid]}
        for f in g:
            owner[f["read"]][(f["plan"], f["name"])] = sid

    # The person's merges, in order: into one of his rooms, or spaces into one space. One whose parts don't touch
    # (more than a merge closes) isn't made: listed in `apart`, so the edit is refused with its reason (review B8).
    apart: list[int] = []
    for m in edits.get("merges") or []:
        ids = [i for i in m.get("parts") or [] if i in spaces and spaces[i]["merged_into"] is None]
        into = m.get("into")
        if into:
            n = str(into)[5:] if str(into).startswith("room:") else None
            base = rooms[n]["base_m"] if n in rooms else his.get(n) if n else None
            if base is None or not ids:
                continue
            out, pieces = G.merge_outline([base] + [spaces[i]["outline_m"] for i in ids])
            if pieces > 1:
                apart.append(int(m.get("id") or 0))
                continue
            if n not in rooms:                             # one of his rooms the plans didn't show: its outline now, grown
                rooms[n] = {"id": into, "room": n, "now_m": his[n], "reads_m": [None] * S2_READS, "parts": [[] for _ in range(S2_READS)],
                            "agree": None, "ready": False, "pick": 1, "picked_by": "merge", "spots": [-1] * S2_READS + [0],
                            "base_m": his[n], "merged": [], "flags": ["merge_only"]}
                if n in unseen:
                    unseen.remove(n)
            r = rooms[n]
            r["base_m"] = out
            r["merged"] += ids
            for i in ids:
                spaces[i]["merged_into"] = into
        elif len(ids) >= 2:
            sid = f"space:m{m['id']}"
            out, pieces = G.merge_outline([spaces[i]["outline_m"] for i in ids])
            if pieces > 1:
                apart.append(int(m.get("id") or 0))
                continue
            spaces[sid] = {"id": sid, "name": " + ".join(spaces[i]["name"] for i in ids)[:S2_NAME_MAX], "outline_m": out,
                           "reads": sorted({r for i in ids for r in spaces[i]["reads"]}), "merged_into": None, "new": None,
                           "parts": [p for i in ids for p in spaces[i]["parts"]], "merge": m["id"]}
            for i in ids:
                spaces[i]["merged_into"] = sid
    for sid, s in spaces.items():
        s["outline_m"] = G.simplify(s["outline_m"], S2_SIMPLIFY_M)
        nm = (edits.get("spaces") or {}).get(sid, {}).get("new")
        if nm and s["merged_into"] is None:
            s["new"] = nm

    # Each room's outline, how far it is from the person's (said, never a flag: where the two reads agree the
    # reading is trusted over the outline he drew; Garry, 2026-11-10: "My kitchen open edge is wrong, trust the
    # ai results on this one"), what it does to the calibration spots.
    for n, r in rooms.items():
        r["outline_m"] = G.simplify(r.pop("base_m"), S2_SIMPLIFY_M)
        r["iou_now"] = round(G.poly_iou(r["outline_m"], r["now_m"]), 3)
        r["area_now"], r["area_new"] = round(G.area(r["now_m"]), 1), round(G.area(r["outline_m"]), 1)
        mine = [p for p in labelled if p["room"] == n]
        leave = [str(p.get("id")) for p in mine if G.inside(float(p["x_m"]), float(p["y_m"]), r["now_m"])
                 and not G.inside(float(p["x_m"]), float(p["y_m"]), r["outline_m"])]
        r["cal"] = {"labelled": len(mine), "leave": leave[:50], "leaving": len(leave)}
        if leave:                                    # information and a choice (keep mine, use Claude's), never a refusal (Garry, 2026-11-10)
            r["flags"].append("spots_out")
        # Ticked by default (Garry, by form, 2026-11-10): a room the reads agree on, or one of his grown by a merge; not one
        # whose reads still differ (three_differ too), not one whose parts don't join, and not one that would push half or
        # more of its labelled spots out (Keep mine first, the count said).
        r["cal"]["most"] = bool(leave) and 2 * len(leave) >= len(mine)
        r["default"] = (r["ready"] or "merge_only" in r["flags"]) and not r["cal"]["most"]

    # Doors and windows: both reads within S2_SAME_M proposed, one read a maybe; on a wall, never twice.
    outlines = {**{r["id"]: r["outline_m"] for r in rooms.values()},
                **{f"room:{n}": q for n, q in his.items() if f"room:{n}" not in {r["id"] for r in rooms.values()}},
                **{s["id"]: s["outline_m"] for s in spaces.values() if s["merged_into"] is None}}
    room_of = {}
    for k in range(S2_READS):
        for (plan, name), who in owner[k].items():
            w = who if who.startswith("space:") else f"room:{who}"
            while w.startswith("space:") and spaces.get(w, {}).get("merged_into"):
                w = spaces[w]["merged_into"]
            room_of[(k, plan, name)] = w
    per_read = []
    for k, rd in enumerate(reads):
        mine = []
        for grp in _cluster(rd["openings"], lambda a, b: a["cls"] == b["cls"] and math.dist(a["at"], b["at"]) <= S2_SAME_M):
            f = grp[0]
            mine.append({**f, "at": tuple(sum(o["at"][i] for o in grp) / len(grp) for i in (0, 1)), "read": k,
                         "names": f.get("names") or [], "lookup": {n: room_of.get((k, f["plan"], n)) for n in f.get("names") or []}})
        per_read.append(mine)
    pairs, singles = _pair(per_read[0], per_read[1] if S2_READS > 1 else [], S2_SAME_M)
    have = existing_openings(house, barriers or [], fid)
    openings: dict[str, dict] = {}
    found = [((a["at"][0] + b["at"][0]) / 2, (a["at"][1] + b["at"][1]) / 2, a, 2) for a, b in pairs] + [(s["at"][0], s["at"][1], s, 1) for s in singles]
    found.sort(key=lambda t: (t[2]["cls"], round(t[1], 1), round(t[0], 1)))
    n_door = n_win = 0
    for x, y, f, nreads in found:
        o = {"cls": f["cls"], "at": (x, y), "names": f["names"]}
        names = {nm: v for nm, v in f["lookup"].items() if v}
        sn = _snap_opening(o, outlines, names)
        if f["cls"] == "window":
            n_win += 1
            oid = f"window:{n_win}"
        else:
            n_door += 1
            oid = f"door:{n_door}"
        item = {"id": oid, "kind": f["kind"], "type": f.get("type"), "cls": f["cls"], "reads": nreads, "floor_id": fid,
                "at_read": [round(x, 3), round(y, 3)], "between": f["names"][:2], "placed": sn is not None, "a_m": None, "b_m": None,
                "rooms": [], "existing": None}
        if sn:
            item["a_m"], item["b_m"] = _ends(sn["at"], sn["u"], f["kind"], sn["length"])
            item["at"] = [round(sn["at"][0], 3), round(sn["at"][1], 3)]
            item["rooms"] = [(w[5:] if w.startswith("room:") else spaces[w]["name"]) for w in sn["room"]]
            item["existing"] = _near_existing({"cls": f["cls"], "at": sn["at"]}, have)
        # One already in the 3D house within S2_SAME_M: a correction of it (moved or resized to the read one), offered
        # unticked, as a correction of a stair the person placed is (Garry, 2026-11-10); never a second one, never a
        # delete. One drawn on the map as a barrier is a signal wall, which this tool doesn't write: left as it is.
        ex = item["existing"]
        item["relation"] = "new" if ex is None else "correction" if ex["what"] == "opening" else "already_there"
        item["default"] = nreads == S2_READS and item["placed"] and ex is None
        openings[oid] = item

    # Stairs: the stair finder's own box-to-metres, matched against the 3D house's stairs.
    floors = floor_order_of(snap)
    stairs_now = stair_pieces(house)
    per = []
    for rd in reads:
        g = _cluster(rd["stairs"], lambda a, b: _overlap(a, b) or math.dist((a["x_m"], a["y_m"]), (b["x_m"], b["y_m"])) <= S2_STAIR_SAME_M)
        per.append([grp[0] for grp in g])
    st_pairs, st_single = [], []
    used: set[int] = set()
    for a in per[0]:
        j = min(((math.dist((a["x_m"], a["y_m"]), (b["x_m"], b["y_m"])), j) for j, b in enumerate(per[1] if S2_READS > 1 else []) if j not in used),
                default=None)
        if j is not None and j[0] <= S2_STAIR_SAME_M:
            used.add(j[1])
            st_pairs.append(a)
        else:
            st_single.append(a)
    st_single += [b for j, b in enumerate(per[1] if S2_READS > 1 else []) if j not in used]
    stairs: dict[str, dict] = {}
    matched: set[str] = set()
    for i, (f, nreads) in enumerate([(f, S2_READS) for f in st_pairs] + [(f, 1) for f in st_single]):
        sfid = floor_of_find(floors, f["plan_floor"], f.get("says") or "")
        if sfid is None:
            continue
        # A DOWN flight read here climbs from the floor below: matched there, offered unticked (best read with that floor).
        rel = classify(sfid, floor_step(floors, sfid, 1), f["x_m"], f["y_m"], stairs_now, matched)
        if rel.get("target") and rel["relation"] in ("correction", "duplicate"):
            matched.add(rel["target"])
        geom = {k: f[k] for k in ("x_m", "y_m", "rotation", "width_m", "depth_m", "shape", "says")}
        sid = f"stairs:{i + 1}"
        stairs[sid] = {"id": sid, "floor_id": sfid, "geom": geom, "room": f.get("room"), "reads": nreads, "relation": rel["relation"],
                       "target": rel.get("target"), "target_snap": rel.get("target_snap"), "distance_m": rel.get("distance_m"),
                       "hand": rel.get("hand"), "other_floor": sfid != fid,
                       # A correction of a stair the person placed is offered, not ticked (the plan AI's Keep mine first); so is one of another floor.
                       "default": nreads == S2_READS and sfid == fid and (rel["relation"] == "new" or (rel["relation"] == "correction" and not rel.get("hand")))}
    return {"rooms": rooms, "unseen": unseen, "spaces": spaces, "openings": openings, "stairs": stairs, "labelled": len(labelled), "apart": apart}


def floor_order_of(snap: dict) -> list[dict]:
    """The indoor floors, lowest first, as the snapshot has them."""
    return [{"id": f["id"], "elev": f.get("elev", 0.0)} for f in snap.get("floors") or []]


# ── The gate (design 5, form q12) ────────────────────────────────────────────

def _room_lookup(rooms: dict[str, dict]) -> Callable[[float, float, str], str]:
    """model_store.beacon_room_from_geometry over these rooms: the first one a point is inside."""
    def at(x: float, y: float, fl: str) -> str:
        for n, g in rooms.items():
            if str(g.get("floor_id")) == str(fl) and len(g.get("points_m") or []) >= 3 and G.inside(x, y, g["points_m"]):
                return n
        return ""
    return at


def rooms_with(rooms_now: dict[str, dict], floor_id: str, outlines: dict[str, list]) -> dict[str, dict]:
    """The house's rooms with these outlines in place (a new name added on the floor)."""
    out = {n: dict(g) for n, g in rooms_now.items()}
    for n, pts in outlines.items():
        out[n] = {**out.get(n, {}), "floor_id": floor_id, "points_m": pts}
    return out


def rooms_gate(points: list[dict], floor_id: str, rooms_now: dict[str, dict], outlines: dict[str, list], excluded: Any = frozenset()) -> dict[str, Any]:
    """The room score on the floor's calibration spots, now and with these
    outlines: the share of the spots labelled with a room that lie inside
    it (the 2026-11-10 test's measure: 98 % with his outlines, 97 % with
    Claude's). Information for the floor, never a refusal (Garry,
    2026-11-10: each room says what it does to its own spots, and the person
    chooses); under S2_GATE_SPOTS labelled spots it is "too few to judge".
    The held-out k-NN score (heldout.evaluate, this floor's spots) is shown
    beside it: on his house it reads 4-7 % rooms right either way.
    {now, with, spots, inside_now, inside_with, blocked, scored, held_out}.
    Pure; run in the executor."""
    from . import heldout  # noqa: PLC0415
    new = rooms_with(rooms_now, floor_id, outlines)
    out: dict[str, Any] = {"how": "containment", "now": None, "with": None, "spots": 0, "inside_now": 0, "inside_with": 0,
                           "scored": False, "held_out": None}
    mine = [p for p in points if str(p.get("floor_id")) == floor_id and p.get("room") in new and p.get("x_m") is not None]
    if mine:
        now = sum(1 for p in mine if p["room"] in rooms_now and G.inside(float(p["x_m"]), float(p["y_m"]), rooms_now[p["room"]].get("points_m") or []))
        wth = sum(1 for p in mine if G.inside(float(p["x_m"]), float(p["y_m"]), new[p["room"]].get("points_m") or []))
        out.update(now=round(100 * now / len(mine), 1), spots=len(mine), inside_now=now, inside_with=wth, scored=len(mine) >= S2_GATE_SPOTS)
        out["with"] = round(100 * wth / len(mine), 1)
    try:
        a = heldout.evaluate(points, excluded=frozenset(excluded or ()), room_at=_room_lookup(rooms_now), floor_id=floor_id)
        b = heldout.evaluate(points, excluded=frozenset(excluded or ()), room_at=_room_lookup(new), floor_id=floor_id) if a else None
        ka, kb = (a or {}).get("knn") or {}, (b or {}).get("knn") or {}
        if ka.get("rooms_right_pc") is not None and kb.get("rooms_right_pc") is not None:
            out["held_out"] = {"now": ka["rooms_right_pc"], "with": kb["rooms_right_pc"], "spots": ka.get("room_spots")}
    except Exception:  # noqa: BLE001 — shown only; a score that can't be made is left out
        pass
    return out


def gate_event(g: dict) -> str:
    if g.get("now") is None or g.get("with") is None or not g.get("scored"):
        return "unscored"
    return "up" if g["with"] > g["now"] else "down" if g["with"] < g["now"] else "same"


def chosen_outlines(prop: dict, ids: list[str]) -> dict[str, list]:
    """The outlines a save of these items writes: {room name: outline}."""
    out: dict[str, list] = {}
    for iid in ids:
        if iid.startswith("room:") and iid[5:] in prop["rooms"]:
            out[iid[5:]] = prop["rooms"][iid[5:]]["outline_m"]
        elif iid.startswith("space:") and iid in prop["spaces"] and prop["spaces"][iid].get("new"):
            out[prop["spaces"][iid]["new"]] = prop["spaces"][iid]["outline_m"]
    return out


def apply_rooms_edit(sess: dict, snap: dict, op: str, args: dict) -> str:
    """A person's edit of the proposal (design 5): merge, separate, space (a
    new room's name, or leave out), pick (read 1 or 2). "ok" or a refusal
    word: not_found, invalid, two_rooms, depends, name_taken."""
    edits = sess.setdefault("edits", {"merges": [], "spaces": {}, "picks": {}})
    prop = sess.get("proposal") or {}
    rooms, spaces = prop.get("rooms") or {}, prop.get("spaces") or {}
    if op == "merge":
        ids = list(dict.fromkeys(args.get("parts") or []))
        rms = [i for i in ids if i.startswith("room:")]
        sps = [i for i in ids if i.startswith("space:")]
        if len(ids) < 2 or len(rms) + len(sps) != len(ids):
            return "invalid"
        if len(rms) > 1:
            return "two_rooms"                     # merging two of the person's rooms would delete one: never
        his = {n for n, r in snap["rooms"].items() if r.get("floor_id") == sess.get("floor_id")}
        if any(i[5:] not in rooms and i[5:] not in his for i in rms) or any(i not in spaces or spaces[i].get("merged_into") for i in sps):
            return "not_found"
        n = 1 + max((int(m.get("id") or 0) for m in edits["merges"]), default=0)
        edits["merges"].append({"id": n, "into": rms[0] if rms else None, "parts": sps})
        for i in sps:
            edits["spaces"].pop(i, None)
        return "ok"
    if op == "separate":
        mid = int(args.get("merge") or 0)
        m = next((m for m in edits["merges"] if int(m.get("id") or 0) == mid), None)
        if m is None:
            return "not_found"
        if any(f"space:m{mid}" in (o.get("parts") or []) for o in edits["merges"]):
            return "depends"                       # a later merge took this one in: separate that first
        edits["merges"].remove(m)
        edits["spaces"].pop(f"space:m{mid}", None)
        return "ok"
    if op == "space":
        sid = str(args.get("space") or "")
        if sid not in spaces or spaces[sid].get("merged_into"):
            return "not_found"
        name = " ".join(str(args.get("name") or "").split())[:S2_NAME_MAX]
        if not name:
            edits["spaces"].pop(sid, None)
            return "ok"
        taken = {n.lower() for n in snap["rooms"]} | {str(v.get("new") or "").lower() for k, v in edits["spaces"].items() if k != sid}
        if name.lower() in taken:
            return "name_taken"
        edits["spaces"][sid] = {"new": name}
        return "ok"
    if op == "pick":
        room = str(args.get("room") or "")
        reads_m = (rooms.get(room) or {}).get("reads_m") or []
        if room not in rooms or args.get("read") not in (1, 2, 3) or args["read"] > len(reads_m) or not reads_m[args["read"] - 1]:
            return "not_found"
        edits["picks"][room] = args["read"]
        return "ok"
    return "invalid"


class RoomsRunner(LineupRunner):
    """One floor's rooms read: S2_READS reads of each lined-up plan (Runner's
    ask and read, the main AI Task only, never the backup), then the proposal
    in the executor. The guard adds: the line-up it stands on unchanged."""

    STAGE = "s2"

    @property
    def sess(self) -> dict[str, Any]:
        return self.store.rooms_session(self.job.sid) or {}

    def _err(self, reason: str) -> None:
        e = self.sess.setdefault("errors", {})
        e[reason] = int(e.get(reason) or 0) + 1
        _bump(self.hass, f"plan_build_read_fail:s2_{reason}")

    def retried(self) -> None:
        _bump(self.hass, "plan_build_read:s2_retry")

    async def read_rooms(self, pl: dict, i: int, k: int, fp) -> None:
        """One read of one plan; what it gave is kept on the plan."""
        sess = self.sess
        sess["progress"] = {"plan": i + 1, "of": len(sess.get("plans") or []), "name": pl.get("name") or "", "step": f"read {k + 1}"}
        await self._save()
        try:
            raw, w, h = await self.hass.async_add_executor_job(lambda: S.shrink(fp, S2_PICTURE_PX, S2_PICTURE_MP, framed=False))
        except Exception:  # noqa: BLE001 — a picture that won't open: the AI was never asked
            self._err("no_media")
            return
        W = int(pl["size_px"][0]) or w
        kk = w / W if W else 1.0
        _bump(self.hass, "plan_build_read:s2_plan")
        got = await self.read(rooms_prompt(w, h), raw, lambda a: parse_rooms_read(a, w, h, kk), (w, h))
        if got is not None:
            pl["reads"][k] = got
            pl["frame"] = [w, h]
        await self._save()

    async def propose(self) -> None:
        """The proposal, in the executor, on the house as it is."""
        sess = self.store.rooms_session(self.job.sid)
        if sess is None:
            return
        snap, house, points, barriers = await rooms_inputs(self.hass)
        sess["proposal"] = await self.hass.async_add_executor_job(rooms_proposal, copy.deepcopy(sess), snap, house, points, barriers)
        if sess.get("via") == "wizard":
            from .ai_wizard import ha_areas  # noqa: PLC0415
            wizard_name(sess, snap, ha_areas(self.hass))

    async def run(self) -> None:  # noqa: C901 — one session's order
        sess = self.sess
        if sess.get("third_for"):
            return await self.run_third()
        resumed = int(sess.get("resumes") or 0) > 0
        _bump(self.hass, f"plan_build_run:s2_{'resumed' if resumed else 'started'}")
        n = len(sess.get("plans") or [])
        reads0, usd0 = int(sess.get("reads") or 0), float(sess.get("est_usd") or 0.0)
        status, why = "done", None
        try:
            await self._save()
            files = await self.files_of()
            for i, pl in enumerate(sess.get("plans") or []):
                for k in range(S2_READS):
                    if (pl.get("reads") or [None] * S2_READS)[k] is not None:
                        continue
                    if self.stop_here():
                        break
                    if files.get(pl["map_id"]) is None:
                        self._err("no_media")
                        break
                    await self.read_rooms(pl, i, k, files[pl["map_id"]])
            why = self.guard()
            if why:
                status = "cancelled"
            elif self.halt == "no_credit":
                status = "no_credit"
            elif self.halt in ("unreachable", "no_media"):
                status, why = "failed", self.halt
            elif self.consecutive_timeouts >= 2 or self.cut_short:
                status = "out_of_time"
            sess = self.sess
            if status != "cancelled" and any(r for pl in sess.get("plans") or [] for r in pl.get("reads") or []):
                sess["progress"] = {"plan": n, "of": n, "name": "", "step": "measure"}
                await self._save()
                await self.propose()
        except Exception as err:  # noqa: BLE001 — the session fails; nothing else is touched
            _LOGGER.warning("PadSpan rooms from plans: the session stopped: %s", P._why(err))  # noqa: SLF001
            status, why = "failed", "error"
        sess = self.sess
        if status == "done" and not any(r for pl in sess.get("plans") or [] for r in pl.get("reads") or []):
            errs = sess.get("errors") or {}
            status, why = "failed", max(errs, key=lambda k: errs[k]) if errs else "bad_answer"
        sess.update(status=status, error=why, finished_at=time.time())
        stop = ending_stop(status, why)
        if stop:
            note_stop(self.hass, self.store.data, sess, stop)
        sess["progress"] = {"plan": n, "of": n, "name": "", "step": "done"}
        _bump(self.hass, f"plan_build_run:s2_{'finished' if status == 'done' else status}")
        secs = float(sess.get("spent_s") or 0.0)
        _bump(self.hass, f"plan_build_run_secs:s2_{'lt1m' if secs < 60 else '1_3m' if secs < 180 else '3_10m' if secs < 600 else 'gt10m'}")
        usd = float(sess.get("est_usd") or 0.0) - usd0
        if int(sess.get("reads") or 0) > reads0:
            _bump(self.hass, f"plan_build_credit_run:s2_{'lt0_10' if usd < 0.10 else '0_10_0_50' if usd < 0.5 else '0_50_2' if usd < 2 else 'gt2'}")
        count_rooms(self.hass, sess.get("proposal"))
        if sess.get("via") == "wizard" and sess.get("proposal"):
            from .ai_wizard import wizard_ticks  # noqa: PLC0415
            from .telemetry import rooms_band  # noqa: PLC0415
            _bump(self.hass, f"plan_build_rooms_offered:{rooms_band(len(wizard_ticks(sess['proposal'], sess.get('named') or {})['rows']))}")
        await self._save()


    async def run_third(self) -> None:
        """Read again (design 5): one more whole read of each plan a flagged
        room was read on, through the same reader and the same tested prompt
        (a crop was worse in the test: it cut rooms off), then the proposal,
        where two reads out of three decide that room. What was saved and the
        other rooms stay as they were."""
        sess = self.sess
        _bump(self.hass, "plan_build_run:s2_read_again")
        status, why = "done", None
        try:
            files = await self.files_of()
            for i, pl in enumerate(sess.get("plans") or []):
                if pl["map_id"] not in sess["third_for"]["plans"]:
                    continue
                reads = pl.setdefault("reads", [None] * S2_READS)
                while len(reads) <= S2_READS:
                    reads.append(None)
                if reads[S2_READS] is not None or self.stop_here() or files.get(pl["map_id"]) is None:
                    continue
                await self.read_rooms(pl, i, S2_READS, files[pl["map_id"]])
            why = self.guard()
            if why:
                status = "cancelled"
            elif self.halt == "no_credit":
                status = "no_credit"
            elif self.halt in ("unreachable", "no_media"):
                status, why = "failed", self.halt
            if status != "cancelled":
                await self.propose()
                count_rooms(self.hass, self.sess.get("proposal"), self.sess["third_for"]["room"])
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("PadSpan rooms from plans: reading again stopped: %s", P._why(err))  # noqa: SLF001
            status, why = "failed", "error"
        sess = self.sess
        sess.pop("third_for", None)
        sess.update(status="done" if status in ("done", "cancelled") and sess.get("proposal") else status, error=why if status != "done" else None,
                    finished_at=time.time())
        stop = ending_stop(status, why)
        if stop and status != "done":
            note_stop(self.hass, self.store.data, sess, stop)
        await self._save()


def wizard_name(sess: dict, snap: dict, areas: list[dict]) -> None:
    """A helper's session (via "wizard"; design D): each space not named yet
    gets ai_wizard.suggest_names' name through the person's own edit field
    (edits.spaces[id].new), so the ticks, the checks and rooms_commit are the
    Plans tool's, unchanged. Where each name came from is kept (`named`)."""
    from .ai_wizard import suggest_names  # noqa: PLC0415
    prop = sess.get("proposal") or {}
    named = sess.setdefault("named", {})
    todo = {sid: s for sid, s in (prop.get("spaces") or {}).items() if s.get("merged_into") is None and not s.get("new")}
    if not todo:
        return
    edits = sess.setdefault("edits", {"merges": [], "spaces": {}, "picks": {}})
    taken = set(snap.get("rooms") or {}) | {str(v.get("new")) for v in (edits.get("spaces") or {}).values() if v.get("new")}
    got = suggest_names(todo, areas, taken, str(sess.get("floor_id") or ""))
    for sid in todo:
        g = got.get(sid)
        named[sid] = g["source"] if g else ""
        if g:
            edits.setdefault("spaces", {})[sid] = {"new": g["name"]}
            prop["spaces"][sid]["new"] = g["name"]


def read_again(hass: HomeAssistant, store: PlanAiStore, sid: str, room: str) -> str:
    """Start a third read for one flagged room (the plans it was read on), in
    the one job slot; "ok", or not_found / not_flagged / already_running."""
    sess = store.rooms_session(sid)
    r = ((sess or {}).get("proposal") or {}).get("rooms", {}).get(room)
    if r is None or not r.get("plans"):
        return "not_found"
    if not ({"reads_differ", "three_differ"} & set(r.get("flags") or [])):
        return "not_flagged"
    if running(hass) is not None:
        return "already_running"
    edits = sess.setdefault("edits", {"merges": [], "spaces": {}, "picks": {}})
    if room not in edits.setdefault("third", []):
        edits["third"].append(room)
    sess["third_for"] = {"room": room, "plans": list(r["plans"])}
    sess.update(status="running", error=None, finished_at=None, spent_s=0.0, spent_before=0.0,
                progress={"plan": 1, "of": len(r["plans"]), "name": room, "step": "read 3"}, rev=int(sess.get("rev") or 0) + 1)
    dom = hass.data.setdefault(DOMAIN, {})
    job = Job(sid)
    dom[_DATA_JOB] = job
    job.task = hass.async_create_background_task(RoomsRunner(hass, store, job, str(sess.get("ai_task") or "")).run(), "padspan_ha plan_build read again")
    return "ok"


async def rooms_inputs(hass: HomeAssistant) -> tuple[dict, dict, list, list]:
    """What the proposal reads, taken on the event loop: the snapshot, the 3D
    file (empty when it can't be read), every calibration point, the barriers."""
    from .const import DATA_CALIBRATION  # noqa: PLC0415
    from .house3d_store import async_get_store as house_store  # noqa: PLC0415
    snap = house_snapshot(hass)
    try:
        house = copy.deepcopy((await house_store(hass)).data)
    except Exception:  # noqa: BLE001 — unreadable: nothing is matched against it, and Save refuses (plan_ai_write)
        house = {}
    dom = hass.data.get(DOMAIN, {})
    cal, model = dom.get(DATA_CALIBRATION), dom.get(DATA_MODEL)
    points = [dict(p) for p in (cal.list_points() if cal is not None and hasattr(cal, "list_points") else []) if isinstance(p, dict)]
    barriers = list(model.rf_barriers_m() if model is not None and hasattr(model, "rf_barriers_m") else [])
    return snap, house, points, barriers


def count_rooms(hass: HomeAssistant, prop: dict | None, room: str | None = None) -> None:
    """What a proposal showed, by kind (design 10). `room`: after Read again,
    only what the third read made of that room (two_of_three, three_differ)."""
    if not prop:
        return
    if room is not None:
        third = ((prop.get("rooms") or {}).get(room) or {}).get("third")
        if third:
            _bump(hass, f"plan_build_agree:{'two_of_three' if third.get('decided') else 'three_differ'}")
        return
    for r in (prop.get("rooms") or {}).values():
        _bump(hass, "plan_build_item:room_shown")
        _bump(hass, f"plan_build_agree:{'ready' if r.get('ready') else 'differ'}")
        for f in ("apart", "spots_out"):
            if f in r.get("flags") or []:
                _bump(hass, f"plan_build_agree:{f}")
    for s in (prop.get("spaces") or {}).values():
        if not s.get("merge"):
            _bump(hass, "plan_build_item:space_shown")
    for o in (prop.get("openings") or {}).values():
        _bump(hass, f"plan_build_item:{o['cls']}_{'shown' if o.get('default') else 'maybe'}")
    for s in (prop.get("stairs") or {}).values():
        _bump(hass, f"plan_build_item:stairs_{'shown' if s.get('default') else 'maybe'}")


def _start_job(hass: HomeAssistant, store: PlanAiStore, key: str, sid: str, sess: dict[str, Any], runner: type, name: str) -> str:
    """Keep a session in this store's `key` and start its job in the plan AI's one job slot, a start counted for the caps."""
    dom = hass.data.setdefault(DOMAIN, {})
    now = time.monotonic()
    dom[_DATA_STARTS] = [t for t in dom.get(_DATA_STARTS, []) if now - t < 86400] + [now]
    store.data.setdefault(key, {})[sid] = sess
    store.trim()
    job = Job(sid)
    dom[_DATA_JOB] = job
    job.task = hass.async_create_background_task(runner(hass, store, job, str(sess.get("ai_task") or "")).run(), name)
    return sid


def start_rooms(hass: HomeAssistant, store: PlanAiStore, sess: dict[str, Any], sid: str | None = None) -> str:
    """Keep a rooms session and start its job in the plan AI's one job slot."""
    return _start_job(hass, store, "rooms", sid or "rb_" + secrets.token_hex(4), sess, RoomsRunner, "padspan_ha plan_build rooms")


def resume_rooms(hass: HomeAssistant, store: PlanAiStore, sid: str) -> str:
    """Resume a rooms session that stopped short: what was read stays."""
    sess = store.rooms_session(sid) or {}
    sess["resumes"] = int(sess.get("resumes") or 0) + 1
    if sess["resumes"] > S1_RESUMES_STRESS:
        _bump(hass, "plan_build_stress:resumes")
    stop_resolved(hass, sess, ("out_of_time", "no_credit", "unreachable", "no_media", "cancelled", "restart", "bad_answer", "refusal", "error"))
    sess["spent_earlier"] = round(float(sess.get("spent_earlier") or 0.0) + float(sess.get("spent_s") or 0.0), 1)
    sess.update(status="running", error=None, finished_at=None, spent_s=0.0, spent_before=0.0, budget_s=S1_BUDGET_S)
    return start_rooms(hass, store, sess, sid)


def rooms_resume_refused(hass: HomeAssistant, store: PlanAiStore, sess: dict[str, Any] | None) -> str | None:
    """resume_refused for a rooms session."""
    if not resumable(sess):
        return ending_stop("cancelled", sess.get("error")) if sess and sess.get("error") in LINEUP_NOT_RESUMABLE else "not_open"
    u = unlock(hass)
    why = "ai_changed" if u.get("ok") and u.get("ai_task") != sess.get("ai_task") else "plan_changed" if plans_moved(hass, sess) else None
    if why is None:
        return None
    sess.update(status="cancelled", error=why, rev=int(sess.get("rev") or 0) + 1)
    note_stop(hass, store.data, sess, why)
    return why


def rooms_public(sess: dict[str, Any] | None, sid: str | None) -> dict[str, Any] | None:
    """A rooms session as the screen sees it: the reads left out (they are in
    the proposal), every stop in words."""
    if not sess:
        return None
    return {"id": sid, **{k: v for k, v in sess.items() if k not in ("spent_before",)},
            "plans": [{k: v for k, v in pl.items() if k != "reads"} | {"read": [r is not None for r in pl.get("reads") or []]}
                      for pl in sess.get("plans") or []],
            "stops": [stop_words(r) for r in sess.get("stops") or []], "resumable": resumable(sess)}


def rooms_undo_info(store: PlanAiStore, sid: str | None = None) -> dict[str, Any] | None:
    """The newest rooms session with saves still to undo (or that session)."""
    best = None
    for b in (store.data.get("room_batches") or {}).values():
        if not isinstance(b, dict) or b.get("undo_of") or b.get("undone_at") or b.get("pending") or not b.get("session"):
            continue
        if sid and b["session"] != sid:
            continue
        if best is None or float(b.get("committed_at") or 0) > float(best.get("committed_at") or 0):
            best = b
    if best is None:
        return None
    mine = [b for b in (store.data.get("room_batches") or {}).values() if isinstance(b, dict) and b.get("session") == best["session"]
            and not b.get("undo_of") and not b.get("undone_at") and not b.get("pending")]
    sess = store.rooms_session(best["session"]) or {}
    out = {"session": best["session"], "floor_id": best.get("floor_id"), "items": sum(len(b.get("items") or []) for b in mine),
           "saves": len(mine), "at": max(float(b.get("committed_at") or 0) for b in mine),
           "helper": sess.get("via") == "wizard"}                                  # saved by Let Claude draw your rooms
    if out["helper"]:
        out["map_id"] = ((sess.get("plans") or [{}])[0] or {}).get("map_id")      # the plan whose scale the helper may have set
    return out


# ══ The rooms helper's scale read (Let Claude draw your rooms, piece 4; design E.1) ══
# One plan with no scale: Read A, then Read B of at most one dimension an axis
# (three reads in all, the line-up's own readers), then LocalSteps.measure in
# the executor, each axis on its own: the person checks what was read, so a
# single line is offered as read (their Yes confirms it) and a picture
# stretched one way shows as stretched. scale_proposal says what was found;
# the save is plan_ai_write.scale_save's (piece 3), unchanged, from the two
# tick ends and the length text. Sessions in this store's "scales".

MAX_SCALE_SESSIONS = 10      # sessions kept
SCALE_AXES_AGREE = 0.03      # across and down within this: no stretch said (either way the average is used, as Mapping's Measure does);
                             # both read and within it: the reading is double-checked (`checked`), the only one offered with Yes picked
SCALE_PARSE_NEAR = 0.02      # PadSpan's reading of the text this far from Claude's metres (past S1_PARSE_AGREE): kept, never double-checked


def _one_per_axis(dims: Any) -> list[dict]:
    """At most one dimension an axis, in the line-up's order (the longest first); one read already before one not."""
    out = []
    for axis in ("x", "y"):
        mine = [d for d in dims or [] if isinstance(d, dict) and d.get("axis") == axis]
        if mine:
            out.append(next((d for d in mine if d.get("metres")), mine[0]))
    return out


def new_scale_session(u: dict, m: dict, earlier: dict[str, dict]) -> dict[str, Any]:
    """A scale read about to run: new_lineup's shape over one plan that has no
    placement yet (house_snapshot leaves such a plan out), stage s0, the
    helper's (via "wizard": Live Aboard may be off). `earlier`: earlier_reads."""
    image = m.get("image") or {}
    mid, fid = str(m.get("id") or ""), str(m.get("floor_id") or "")
    one = {"plans": {mid: {"name": str(m.get("name") or "")[:80], "floor_id": fid, "image_sig": image_sig(m), "place_sig": "",
                           "size": [int(image.get("width") or 0), int(image.get("height") or 0)], "drawn": {}, "refs": 0}}}
    sess = new_lineup(u, one, fid, [mid], earlier)
    for pl in sess["plans"]:
        pl["dims"] = _one_per_axis(pl["dims"])
    sess.update(stage="s0", via="wizard", map_id=mid, proposal=None)
    return sess


def measure_axes(steps: LocalSteps, pl: dict) -> None:
    """LocalSteps.measure on each axis's dimension alone (executor): a single
    line isn't held to the other axis's chain here (the person sees it and
    says yes or no), so a stretched picture is said, not left unmeasured."""
    dims = pl.get("dims") or []
    for axis in ("x", "y"):
        one = {**pl, "dims": [d for d in dims if d.get("axis") == axis]}
        steps.measure(one)
        pl["tilt_rad"] = one.get("tilt_rad")


def _save_text(d: dict, m: float) -> tuple[str, bool]:
    """The length as Save sends it: the printed text when PadSpan reads it as
    the length measured, else the chain's segments joined (Read B's text is
    cut at 24 characters), else the metres; always one plan_geom.parse_length
    reads, at most 40 characters; of two that do, the nearer Claude's metres
    (a text cut short can still pass). And whether it is the print's own words."""
    want = float(d.get("metres") or m)
    ok = [str(t) for t in (d.get("text"), " + ".join(str(c) for c in d.get("chain") or []))
          if t and len(str(t)) <= 40 and G.agrees(G.parse_length(t), m, S1_PARSE_AGREE)]
    if ok:
        return min(ok, key=lambda t: abs(float(G.parse_length(t) or 0.0) - want)), True
    return f"{m:.4f} m", False


SCALE_SHOW_MAX = 80          # a chain of printed lengths this long is quoted whole on the check screen; longer, by how many it has


def _shown_text(d: dict, save: str, printed: bool, m: float) -> str:
    """What the check screen quotes beside the metres: the print's own words
    when Save sends them; else the whole chain joined by + when its lengths
    add up to the length (too long for Save's 40 characters), or how many
    lengths it has when it is longer still; else the metres. Never a text cut
    short, whose numbers would add up to less than the metres said beside it."""
    if printed:
        return save
    # Printed as the length, read only with Claude's metres as the unit hint (66-7 in dashed feet, a bare 2029 in
    # centimetres), as LocalSteps.measure read it: the print's own words, to compare with the plan.
    text = str(d.get("text") or "")
    if text and G.agrees(G.parse_length(text, float(d.get("metres") or m)), m, S1_PARSE_AGREE):
        return text
    chain = [str(c) for c in d.get("chain") or []]
    if chain and G.agrees(G.chain_length(chain, m), m, S1_PARSE_AGREE):
        joined = " + ".join(chain)
        return joined if len(joined) <= SCALE_SHOW_MAX else f"{len(chain)} lengths printed end to end"
    return f"{m:.2f} m"


def scale_proposal(pl: dict, size: Any) -> dict[str, Any]:
    """Pure. What the scale read found on one plan of `size` (its picture's
    pixels): per axis {text (as quoted: _shown_text), save_text, metres, ppm, ends_frac
    (the two tick ends, fractions of the picture), box_frac (the printed line
    with its text), span_frac, state single | unconfirmed | none, near: its
    text read only near Claude's metres (SCALE_PARSE_NEAR)}, the axis
    shown first (main: a confirmed one, then the longer), the other, the
    plan's pixels per metre (the axes' average, as Mapping's Measure does) and
    its size from it, how far the axes differ (stretch_pct, stretched past
    SCALE_AXES_AGREE), none_found, checked (both axes read, not stretched,
    neither near: the only reading the screen offers with Yes picked). Each axis's px/m is worked out from its
    rounded ends and its save_text, as plan_ai_write.scale_from_measures will."""
    W, H = (int(v or 0) for v in (list(size or []) + [0, 0])[:2])

    def clamp(v: float) -> float:
        return round(min(max(float(v), 0.0), 1.0), 4)

    axes: dict[str, dict[str, Any]] = {}
    for axis in ("x", "y"):
        rec: dict[str, Any] = {"text": None, "save_text": None, "metres": None, "ppm": None, "ends_frac": None, "box_frac": None,
                               "span_frac": None, "state": "none", "near": False}
        d = next((d for d in pl.get("dims") or [] if d.get("axis") == axis and d.get("ticks_px") and d.get("parse_m")
                  and (d.get("ok") or d.get("why") == "unconfirmed")), None)
        if d is not None and W and H:
            save, printed = _save_text(d, float(d["parse_m"]))
            m = G.parse_length(save)
            ends = [[clamp(float(p[0]) / W), clamp(float(p[1]) / H)] for p in d["ticks_px"][:2]]
            px = math.hypot((ends[1][0] - ends[0][0]) * W, (ends[1][1] - ends[0][1]) * H)
            if m and px >= 8:
                b = d.get("box") or []
                rec.update(text=_shown_text(d, save, printed, m), save_text=save, metres=round(m, 4), ppm=round(px / m, 4), ends_frac=ends,
                           box_frac=[clamp(b[0] / W), clamp(b[1] / H), clamp(b[2] / W), clamp(b[3] / H)] if len(b) == 4 else None,
                           span_frac=round(px / (W if axis == "x" else H), 3), state="single" if d.get("ok") else "unconfirmed",
                           near=bool(d.get("near")))
        axes[axis] = rec
    found = sorted((a for a in ("x", "y") if axes[a]["ppm"]), key=lambda a: (axes[a]["state"] != "unconfirmed", axes[a]["span_frac"]), reverse=True)
    out: dict[str, Any] = {"axes": axes, "main": None, "other": None, "ppm": None, "across_m": None, "down_m": None,
                           "stretch_pct": None, "stretched": False, "none_found": not found, "checked": False}
    if not found:
        return out
    ppm = sum(axes[a]["ppm"] for a in found) / len(found)
    out.update(main=found[0], other=found[1] if len(found) > 1 else None, ppm=round(ppm, 4), across_m=round(W / ppm, 2), down_m=round(H / ppm, 2))
    if len(found) == 2:
        pct = abs(axes["x"]["ppm"] - axes["y"]["ppm"]) / ppm * 100
        out.update(stretch_pct=round(pct, 1), stretched=pct > SCALE_AXES_AGREE * 100)
        # Double-checked: two readings, one each way, that agree (the real-Claude test of 2026-11-11 saved
        # +19 to +41 % from one line), neither of them a printed length PadSpan read only near Claude's.
        out["checked"] = not out["stretched"] and not any(axes[a]["near"] for a in found)
    return out


def count_scale_read(hass: HomeAssistant, prop: dict | None) -> None:
    """What a finished scale read offers (design J.4): a printed dimension,
    double-checked (offered with Yes picked) or not (the person measures
    first), none, how many axes, how far apart."""
    if not prop:
        return
    if prop.get("none_found"):
        _bump(hass, "plan_build_scale:none_found")
        _bump(hass, "plan_build_scale_axes:none")
        return
    _bump(hass, f"plan_build_scale:{'printed_checked' if prop.get('checked') else 'printed_unchecked'}")
    _bump(hass, f"plan_build_scale_axes:{'two' if prop.get('other') else 'one'}")
    if prop.get("stretch_pct") is not None:
        _bump(hass, f"plan_build_scale_stretch:{_scale_band(float(prop['stretch_pct']))}")


def count_scale_check(hass: HomeAssistant, sess: dict | None, source: str, measures: Any) -> None:
    """A save from the scale read (design J.4): the person's Yes, or a number
    they corrected and how far it was from what Claude read (bands)."""
    if source == "plan_dimension":
        _bump(hass, "plan_build_scale_check:yes")
    elif source == "plan_dimension_corrected":
        _bump(hass, "plan_build_scale_check:corrected")
        prop = (sess or {}).get("proposal") or {}
        claude = ((prop.get("axes") or {}).get(prop.get("main")) or {}).get("metres")
        first = measures[0] if isinstance(measures, list) and measures and isinstance(measures[0], dict) else {}
        typed = G.parse_length(first.get("text"))
        if claude and typed:
            _bump(hass, f"plan_build_scale_fix:{_scale_band(abs(typed / float(claude) - 1) * 100)}")


class ScaleRunner(LineupRunner):
    """One plan's scale read for the rooms helper (design E.1): the line-up's
    reads and gates, counted as stage s0. The plan has no placement, so the
    guard asks that its picture is the same and it is still unmeasured."""

    STAGE = "s0"

    @property
    def sess(self) -> dict[str, Any]:
        return self.store.scale_session(self.job.sid) or {}

    def count_secs(self, band: str) -> None:
        """Not counted: plan_build_read_secs carries no stage word and is the line-up's."""

    def plan_guard(self) -> str | None:
        dom = self.hass.data.get(DOMAIN, {})
        maps, model = dom.get(DATA_MAPS), dom.get(DATA_MODEL)
        for pl in self.sess.get("plans") or []:
            m = maps.get_map(pl["map_id"]) if maps is not None else None
            if not isinstance(m, dict):
                return "plan_gone"
            if not same_picture(pl["image_sig"], {"image_sig": image_sig(m), "image_sig_was": legacy_image_sig(m)}):
                return "plan_changed"
            if model is not None and model.map_transform(pl["map_id"]) is not None:    # measured by hand meanwhile
                return "plan_changed"
        return None

    async def measure(self, fp) -> None:
        """The ticks and pixels per metre (executor), on a copy; the proposal from them."""
        work = copy.deepcopy((self.sess.get("plans") or [None])[0])
        if not work:
            return
        # Not counted: plan_build_dims:* are the line-up's (no stage word); this read says what it found in plan_build_scale*.
        steps = LocalSteps({}, {}, lambda mid: open_grey(fp), lambda e: None, lambda: bool(self.job.cancel))
        steps.near_ok = SCALE_PARSE_NEAR
        await self.hass.async_add_executor_job(measure_axes, steps, work)
        sess = self.store.scale_session(self.job.sid)
        if sess is not None and not self.job.cancel:
            sess["plans"][0] = work
            sess["proposal"] = scale_proposal(work, work.get("size_px"))

    async def run(self) -> None:  # noqa: C901 — one read's order
        sess = self.sess
        _bump(self.hass, "plan_build_run:s0_started")
        reads0, usd0 = int(sess.get("reads") or 0), float(sess.get("est_usd") or 0.0)
        status, why = "done", None
        try:
            await self._save()
            files = await self.files_of()
            pl = (sess.get("plans") or [{}])[0]
            fp = files.get(pl.get("map_id"))
            if fp is None:
                self._err("no_media")
            else:
                if pl.get("read_a") is not None:
                    if pl.pop("reused", False):
                        sess["reused"] = int(sess.get("reused") or 0) + 1
                        _bump(self.hass, "plan_build_read:s0_reused")
                elif not self.stop_here():
                    await self.read_whole(pl, 0, fp)
                    pl["dims"] = _one_per_axis(pl.get("dims"))
                if pl.get("read_a") is not None and not pl.get("dims_read") and not self.stop_here():
                    await self.read_dims(pl, 0, fp)
            why = self.guard()
            if why:
                status = "cancelled"
            elif self.halt == "no_credit":
                status = "no_credit"
            elif self.halt in ("unreachable", "no_media"):
                status, why = "failed", self.halt
            elif self.consecutive_timeouts >= 2 or self.cut_short:
                status = "out_of_time"
            if status == "done" and fp is not None and pl.get("read_a") is not None:
                sess["progress"] = {"plan": 1, "of": 1, "name": pl.get("name") or "", "step": "measure"}
                await self._save()
                await self.measure(fp)
                if self.job.cancel:
                    status, why = "cancelled", "user"
        except Exception as err:  # noqa: BLE001 — the session fails; nothing else is touched
            _LOGGER.warning("PadSpan rooms helper: the scale read stopped: %s", P._why(err))  # noqa: SLF001
            status, why = "failed", "error"
        sess = self.sess
        if status == "done" and not any(p.get("read_a") for p in sess.get("plans") or []):
            errs = sess.get("errors") or {}
            status, why = "failed", max(errs, key=lambda k: errs[k]) if errs else "bad_answer"
        sess.update(status=status, error=why, finished_at=time.time())
        stop = ending_stop(status, why)
        if stop:
            note_stop(self.hass, self.store.data, sess, stop)
        sess["progress"] = {"plan": 1, "of": 1, "name": "", "step": "done"}
        self.count_run_end(sess, status, reads0, usd0)
        if status == "done":
            count_scale_read(self.hass, sess.get("proposal"))
        await self._save()


def held_scale_read(store: PlanAiStore, m: dict) -> str | None:
    """The newest finished scale read of this plan and this picture still held
    in the store, or None: a later "Read my plan" offers it again instead of
    paying Claude to read the same picture twice (end-to-end test 2026-11-11)."""
    now = {"image_sig": image_sig(m), "image_sig_was": legacy_image_sig(m)}
    held = [(sid, s) for sid, s in (store.data.get("scales") or {}).items()
            if isinstance(s, dict) and s.get("map_id") == m.get("id") and s.get("status") == "done" and s.get("proposal") is not None
            and same_picture(((s.get("plans") or [{}])[0] or {}).get("image_sig"), now)]
    return max(held, key=lambda t: float(t[1].get("started_at") or 0))[0] if held else None


def start_scale(hass: HomeAssistant, store: PlanAiStore, sess: dict[str, Any], sid: str | None = None) -> str:
    """Keep a scale read and start its job in the plan AI's one job slot."""
    return _start_job(hass, store, "scales", sid or "sc_" + secrets.token_hex(4), sess, ScaleRunner, "padspan_ha plan_build scale")


def scale_public(sess: dict[str, Any] | None, sid: str | None) -> dict[str, Any] | None:
    """A scale read as the helper's screen sees it: where it is, what it found, every stop in words, and
    whether Claude's first look didn't match the drawing (suspect: no dimension was read; it may be asked again)."""
    if not sess:
        return None
    return {"id": sid, **{k: sess.get(k) for k in ("status", "error", "map_id", "floor_id", "progress", "proposal", "rev", "started_at",
                                                    "finished_at", "reads")},
            "suspect": any(bool((p.get("read_a") or {}).get("suspect")) for p in sess.get("plans") or []),
            "stops": [stop_words(r) for r in sess.get("stops") or []]}
