# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Add data via plans: the plan AI (experimental, off by default; 2026-11).

Stage 1a, the dry run. The person's own AI Task reads each placed floor plan
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

Nothing here writes the 3D house, the map (fabric, model, maps), calibration
or any other store: keeping a suggestion (new, correction) is the next
stage's one commit command. The plan's picture goes only to the chosen AI
Task, as the photo step sends a photo (ws_house3d_photo.ask: a hidden file
for the call); the answer is reduced to numbers and closed words before it
is stored, and the model's text is never stored, shown or logged.

Design: PadspanResearch/plan-ai-design-2026-11.md (sections 2, 3, 4, 7, 8).

The store's Home Assistant version stays 1 forever; shape changes go through
the data's own "schema" field, read the tolerant way (house3d_store.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import secrets
import time
from typing import Any

from homeassistant.core import HomeAssistant

from .const import DATA_MAPS, DATA_MODEL, DATA_PLAN_AI, DATA_SETTINGS, DEFAULT_FLOOR_ID, DOMAIN, OUTSIDE_FLOOR_ID, PLAN_AI_STORE_KEY
from . import ws_house3d_photo as P
from . import ws_house3d_stairs as S

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
KINDS: tuple[str, ...] = ("stairs", "railing")       # lights come with a later stage
DUP_M, CORR_M = 1.0, 2.5              # within DUP_M of one existing stair: a duplicate, whatever its shape; up to CORR_M: a correction
REJECT_M = 0.5                        # a find this close to a remembered reject on the same plan version is not queued
CROP_M = (3.0, 8.0)                   # the crop round a find, its side: 2.5 × the find's long side, within these (experiment run_crops.py)
CROP_PX = 768                         # sent no bigger than this on its long side, then fitted to the frame
CROP_MIN_FRAC = 0.05                  # a crop's box narrower or lower than this share of it is a mark, not stairs (the smallest of 21 recorded answers: 0.14)
STATUS: tuple[str, ...] = ("running", "done", "cancelled", "failed", "out_of_time")
CANCEL_WHY: tuple[str, ...] = ("user", "switch_off", "house3d_off", "licence", "plan_gone", "plan_changed", "restart")
FAILURE_WHY: tuple[str, ...] = ("wrong_place", "nothing_there", "already_here", "wrong_kind", "cant_tell")
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


# ── The store ────────────────────────────────────────────────────────────────

def empty() -> dict[str, Any]:
    return {"schema": SCHEMA, "sessions": {}, "batches": {}, "rejects": {}}


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
        for k in ("sessions", "batches", "rejects"):
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
        if swept:
            for _ in range(swept):
                _bump(self.hass, "plan_ai_session:failed")
                _bump(self.hass, "plan_ai_cancel_why:restart")
            await self.async_save()

    async def async_save(self) -> bool:
        """Write the data as it is. A newer PadSpan's file is never written."""
        if not writable(self._data):
            return False
        await self.store.async_save(self._data)
        return True

    def session(self, sid: str | None) -> dict[str, Any] | None:
        sessions = self._data.get("sessions") or {}
        if sid:
            s = sessions.get(sid)
            return s if isinstance(s, dict) else None
        latest = max((s for s in sessions.values() if isinstance(s, dict)),
                     key=lambda s: float(s.get("started_at") or 0), default=None)
        return latest

    def trim(self) -> None:
        """The caps: the oldest sessions, batches and rejects over them go."""
        for key, cap, when in (("sessions", MAX_SESSIONS, "started_at"), ("batches", MAX_BATCHES, "committed_at"),
                               ("rejects", MAX_REJECTS, "at")):
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
    """The picture's version: the map's `updated`, else the image's sha256
    (map_image_view.image_path keys the browser's links the same way)."""
    image = m.get("image") or {}
    return re.sub(r"[^a-zA-Z0-9]", "", str(m.get("updated") or image.get("sha256") or ""))[:32]


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
                    "image_sig": image_sig(m), "place_sig": place_sig(t)})
    return out


def plan_now(hass: HomeAssistant, map_id: str) -> dict[str, Any] | None:
    """One plan as it is now (its signatures), or None when it is gone or unplaced."""
    for pl in plans(hass):
        if pl["map_id"] == map_id:
            return pl
    return None


# ── Frames and the 0-1000 trap ───────────────────────────────────────────────

_QWEN25 = re.compile(r"qwen\s*2[._-]?5", re.I)


def _model_text(hass: HomeAssistant, eid: str) -> str:
    """What names the model behind an AI Task entity: its id and names, and
    the "model" of the integration's sub-entry or entry (Ollama keeps it
    there). Whatever can't be read is left out: no name means a named frame."""
    out = [str(eid or "")]
    try:
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        ent = er.async_get(hass).async_get(eid)
        out += [str(getattr(ent, k, None) or "") for k in ("name", "original_name")]
        entry = hass.config_entries.async_get_entry(getattr(ent, "config_entry_id", None))
        sub = (getattr(entry, "subentries", None) or {}).get(getattr(ent, "config_subentry_id", None))
        for src in (getattr(sub, "data", None), getattr(entry, "options", None), getattr(entry, "data", None)):
            if src and src.get("model"):
                out.append(str(src["model"]))
    except Exception:  # noqa: BLE001
        pass
    return " ".join(out)


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
    if len(agree) >= 2:
        return out                                   # new, near them: the person may turn it into a correction of one
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


# ── Rejects ──────────────────────────────────────────────────────────────────

def reject_key(kind: str, map_id: str, isig: str, psig: str, x: float, y: float) -> str:
    return f"{kind}|{map_id}|{isig}|{psig}|{x:.1f}|{y:.1f}"


def remembered_reject(rejects: dict, kind: str, map_id: str, isig: str, psig: str, x: float, y: float) -> str | None:
    """The key of a live reject of this kind within REJECT_M on this plan
    version, or None. After a re-placement the placement hash differs and
    the old reject no longer matches: it expires by itself."""
    for key, r in (rejects or {}).items():
        if not isinstance(r, dict) or r.get("kind") != kind or r.get("map_id") != map_id:
            continue
        if r.get("image_sig") != isig or r.get("place_sig") != psig:
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


def crop_answer(answer: Any, w: int, h: int) -> tuple[bool, tuple[float, float, float, float] | None] | None:
    """The second look's answer, reduced to (present, its box as fractions of
    the crop, x1, y1, x2, y2, or None without a usable box); None when it says
    neither. A box out past the crop is another frame's, and one under
    CROP_MIN_FRAC a side (a point, a mark) is no staircase: neither is used."""
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
    if x2 - x1 < CROP_MIN_FRAC or y2 - y1 < CROP_MIN_FRAC:
        return True, None
    return True, (x1, y1, x2, y2)


def rail_of(answer: Any) -> tuple[bool, str | None]:
    """The railing answer as (drawn, side): side in left|right|both or None."""
    obj = None
    if isinstance(answer, dict):
        obj = answer
    elif isinstance(answer, str):
        a, b = answer.find("{"), answer.rfind("}")
        if 0 <= a < b:
            try:
                obj = json.loads(answer[a:b + 1])
            except ValueError:
                obj = None
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


def start_allowed(hass: HomeAssistant, now: float | None = None) -> str | None:
    """Why a start is refused now: already_running, too_soon (one a minute)
    or daily_cap (STARTS_A_DAY in 24 h); None when it may start."""
    now = time.monotonic() if now is None else now
    if running(hass) is not None:
        return "already_running"
    starts = [t for t in hass.data.get(DOMAIN, {}).get(_DATA_STARTS, []) if now - t < 86400]
    if starts and now - max(starts) < START_GAP_S:
        return "too_soon"
    if len(starts) >= STARTS_A_DAY:
        return "daily_cap"
    return None


def new_session(ai: dict, plans_: list[dict], kinds: list[str], backup_ok: bool, frame: str) -> dict[str, Any]:
    """A session record about to run (the store's shape, section 4)."""
    return {"rev": 1, "started_at": time.time(), "finished_at": None, "status": "running", "error": None,
            "ai_task": str(ai.get("ai_task") or ""), "local": ai.get("local"), "backup_used": False,
            "backup_ok": bool(backup_ok), "frame": frame, "budget_s": PLAN_BUDGET_S, "spent_s": 0.0,
            "reads": 0, "tiles": 0, "timeouts": 0, "errors": {}, "skipped": 0, "no_floor": 0, "crop_dropped": 0,
            "progress": {"plan": 0, "of": len(plans_), "name": "", "step": "stairs"},
            "plans": [{"map_id": p["map_id"], "name": p.get("name") or "", "floor_id": p["floor_id"],
                       "kinds": list(kinds), "fixtures_drawn": None, "refs": int(p.get("refs") or 0),
                       "image_sig": p["image_sig"], "place_sig": p["place_sig"], "frame": None, "suspect": False,
                       "read": False, "answered": False, "changed": False} for p in plans_],
            "finds": [], "suggestions": {}, "batch": None, "backup_id": None}


class Runner:
    """One session's reads and conflation, written to the store as it goes."""

    def __init__(self, hass: HomeAssistant, store: PlanAiStore, job: Job, ai: dict[str, Any]) -> None:
        self.hass, self.store, self.job, self.ai = hass, store, job, ai
        self.t0 = time.monotonic()
        self.consecutive_timeouts = 0
        self.cut_short = False              # the budget ran out before a read this session wanted
        self.phase = "whole"                # which reads are under way: whole, crop, railing
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
            if now["image_sig"] != pl["image_sig"] or now["place_sig"] != pl["place_sig"]:
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

    async def ask(self, prompt: str, raw: bytes) -> Any:
        """One read inside the budget and the per-read cap; None on a failure
        (counted by reason). Two timeouts in a row end the session."""
        sess = self.sess
        cap = PLAN_READ_LOCAL_S if self.ai.get("local") is True else P.PHOTO_TIMEOUT_S
        t0 = time.monotonic()
        sess["reads"] = int(sess.get("reads") or 0) + 1
        try:
            answer, by = await P.ask_ai(self.hass, self.ai, prompt, None, raw, "image/jpeg", task_name="PadSpan plans",
                                        count=False, timeout_s=max(1.0, min(cap, self.left())))
        except TimeoutError:
            sess["timeouts"] = int(sess.get("timeouts") or 0) + 1
            self.consecutive_timeouts += 1
            self._err("timeout")
            return None
        except P._NoMedia:  # noqa: SLF001
            self._err("no_media")
            return None
        except Exception as err:  # noqa: BLE001 — any failure of the AI Task is one read lost
            _LOGGER.warning("PadSpan plans: the AI Task %s couldn't read a plan: %s", self.ai.get("ai_task"), P._why(err))  # noqa: SLF001
            self._err("unreachable" if P.unreachable(err) else "bad_answer")
            return None
        finally:
            _bump(self.hass, P._secs_event(time.monotonic() - t0).replace("photo_secs:", "plan_ai_read_secs:"))  # noqa: SLF001
        self.consecutive_timeouts = 0
        if by != self.ai.get("ai_task"):
            if not sess.get("backup_used"):              # counted per session, not per read (count=False above)
                _bump(self.hass, "ai_backup_used")
            sess["backup_used"] = True
            if frame_kind(self.hass, by) == "named":   # another model's frame: its positions hold corrections too
                sess["frame"] = "named"
        if answer is None:
            self._err("bad_answer")
        return answer

    async def read(self, prompt: str, raw: bytes, parse) -> Any:
        """One read, parsed, and once more on an answer that can't be parsed
        (parse → None): the design's one retry. None when nothing came of it."""
        answer = await self.ask(prompt, raw)
        if answer is None:
            return None
        got = parse(answer)
        if got is None and not self.stop_here():
            answer = await self.ask(prompt, raw)
            if answer is None:
                return None
            got = parse(answer)
        if got is None:
            self._err("bad_answer")
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
        other answer leaves it as it was."""
        model = self.hass.data.get(DOMAIN, {}).get(DATA_MODEL)
        mid = f["map_id"]
        to_m = lambda fx, fy: model.map_frac_to_metres(fx, fy, mid)  # noqa: E731
        w, h = f["frame"]
        x1, y1, x2, y2 = f["box_px"]
        mx = math.hypot(*(a - b for a, b in zip(to_m(1, 0) or (0, 0), to_m(0, 0) or (0, 0)))) or 1.0
        my = math.hypot(*(a - b for a, b in zip(to_m(0, 1) or (0, 0), to_m(0, 0) or (0, 0)))) or 1.0
        side = min(CROP_M[1], max(CROP_M[0], 2.5 * max((x2 - x1) / w * mx, (y2 - y1) / h * my)))
        self._progress(f, "check")
        try:
            craw, cw, ch, (bx0, by0, bx1, by1) = await self.hass.async_add_executor_job(
                crop, self.files[mid], (x1 + x2) / 2 / w, (y1 + y2) / 2 / h, side / 2 / mx, side / 2 / my)
        except Exception:  # noqa: BLE001 — a picture that won't crop: the find stays as the whole read had it
            return True
        self.crops[id(f)] = (craw, cw, ch)
        seen = await self.read(CROP_PROMPT.format(w=cw, h=ch), craw, lambda a: crop_answer(a, cw, ch))
        if seen is None:
            return True
        f["reads"].append("crop")
        present, at = seen
        if not present:
            self.sess["crop_dropped"] = int(self.sess.get("crop_dropped") or 0) + 1
            _bump(self.hass, "plan_ai_crop:dropped")
            return False
        spot = None
        if at:
            fx0, fy0, fx1, fy1 = bx0 + at[0] * (bx1 - bx0), by0 + at[1] * (by1 - by0), bx0 + at[2] * (bx1 - bx0), by0 + at[3] * (by1 - by0)
            spot = to_m((fx0 + fx1) / 2, (fy0 + fy1) / 2)
        if spot:
            f.update(x_m=round(spot[0], 3), y_m=round(spot[1], 3), box_px=[round(fx0 * w, 1), round(fy0 * h, 1), round(fx1 * w, 1), round(fy1 * h, 1)])
        _bump(self.hass, "plan_ai_crop:placed" if spot else "plan_ai_crop:kept")
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
            rk = remembered_reject(rejects, "stairs", f["map_id"], pl.get("image_sig") or "", pl.get("place_sig") or "", f["x_m"], f["y_m"])
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
            rk = remembered_reject(rejects, "railing", f["map_id"], pl.get("image_sig") or "", pl.get("place_sig") or "", geom["x_m"], geom["y_m"])
            if rel == "duplicate":
                hint["state"] = "duplicate"
                _bump(self.hass, "plan_ai_duplicate:railing")
            elif rk:
                hint["state"] = "failure"
                hint["verdict"] = {"v": "failure", "at": time.time(), "why": (rejects[rk] or {}).get("why"), "remembered": True, "reject": rk}
            else:
                _bump(self.hass, "plan_ai_suggested:railing")
            sugs[rid] = hint
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
        await self._save()


def start(hass: HomeAssistant, store: PlanAiStore, ai: dict[str, Any], plans_: list[dict], kinds: list[str],
          backup_ok: bool, frame: str) -> str:
    """Make a session and start its task. The id. Nothing here waits, so a
    second press finds the job (already_running), and a status check never
    sees a session marked running with no job behind it."""
    sid = "ps_" + secrets.token_hex(4)
    dom = hass.data.setdefault(DOMAIN, {})
    now = time.monotonic()
    dom[_DATA_STARTS] = [t for t in dom.get(_DATA_STARTS, []) if now - t < 86400] + [now]
    store.data.setdefault("sessions", {})[sid] = new_session(ai, plans_, kinds, backup_ok, frame)
    store.trim()
    job = Job(sid)
    dom[_DATA_JOB] = job
    # A background task: a read of a minute must not hold up Home Assistant's own shutdown or start.
    job.task = hass.async_create_background_task(Runner(hass, store, job, ai).run(), "padspan_ha plan_ai")
    return sid


def settle_rails(hass: HomeAssistant, sess: dict[str, Any], stair_id: str) -> list[dict]:
    """A stair marked wrong takes its railing hint out of the queue: there is
    nothing to check beside a stair that isn't there. The hint keeps where it
    stood, for a take-back. No reject of its own: the stair's stops the hint
    coming back on the next read. The hints it changed."""
    out = []
    for hint in (sess.get("suggestions") or {}).values():
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
    queued suggestions stale; a correction whose target is gone or differs
    from its snapshot is stale too. Returns whether anything changed."""
    changed = False
    stairs = {st["id"]: st for st in stair_pieces(house)}
    for pl in sess.get("plans") or []:
        now = plan_now(hass, pl["map_id"])
        gone = now is None or now["image_sig"] != pl["image_sig"] or now["place_sig"] != pl["place_sig"]
        if gone and not pl.get("changed"):
            pl["changed"] = True
            changed = True
    moved = {pl["map_id"] for pl in sess.get("plans") or [] if pl.get("changed")}
    for sug in (sess.get("suggestions") or {}).values():
        if not isinstance(sug, dict) or sug.get("state") != "queued":
            continue
        stale = sug.get("map_id") in moved
        match = sug.get("match") or {}
        if not stale and match.get("target") and (match.get("relation") in ("correction", "stacked") or sug.get("kind") == "railing"):
            tgt = stairs.get(match["target"])
            stale = tgt is None or target_snap(tgt) != match.get("target_snap")
        if stale:
            sug["state"] = "stale"
            changed = True
            _bump(hass, "plan_ai_stale")
    if changed:
        sess["rev"] = int(sess.get("rev") or 0) + 1
    return changed
