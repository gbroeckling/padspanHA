# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Stairs read off a floor plan by the customer's own AI Task (Settings → AI →
Stairs from your floor plans, off by default; 0.38.188).

Two commands. house3d_stairs_plans: the placed floor plans there are to
read (id, name, floor). house3d_stairs_read: one of them, read here from its
file and made smaller (at most 1024 px, a JPEG, as the photo step's browser
does), so the 3D view never handles a plan or the maps list. The AI Task is asked for the staircases on it as boxes in those
pixels: Qwen2.5-VL and its kind locate things in pixels, and a test on real
plans (2026-10-27, qwen2.5vl:7b) put 3 of 4 staircases in the right place that
way, against 1 of 2 when asked for percentages. Each box goes through the
plan's own placement (model_store.map_frac_to_metres) to metres, and comes
back as a stair's footprint, turn and a guess at its shape. Nothing is kept:
the image is the photo step's (a hidden file only for the call), the answer is
read and dropped, and the Furnish tab adds what it chooses as unsaved pieces.

The model's shape and its idea of which way is up were weak in the test, so
the shape is mostly the box's own (a big, nearly square box is a U), and the
direction comes from the arrow only when the AI read one; the floor is the
Furnish tab's to pick (an upper plan's stairs belong to the floor below).

The plan is sent at the size the model looks at it (frame_of). Ollama feeds
Qwen2.5-VL at least 1024 patches of 28 px, scaling a smaller picture up, and
the model answers in that enlarged frame whatever size the prompt names; read
as named and clipped, a tall plan's stairs landed 22-34 % of the plan away
(2026-11-02, 16 plans and 11 probes with marks at known places). Sent at
exactly that frame, the named size is the frame for Ollama and Qwen, and
nothing changes for a model that answers in the picture's own pixels. Home
Assistant's Ollama integration passes the picture's bytes through untouched.
"""

from __future__ import annotations

import json
import math
import re
import time
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN
from .house3d_store import enabled
from .ws_common import _tier_at_least
from .ws_house3d import OFF_CODE, OFF_MESSAGE, PRO_MESSAGE
from . import ai_usage as U
from . import ws_house3d_photo as P
from .ws_common import admin_if_enhanced_security

# The master switch over every AI map-building feature (Settings → AI → AI
# map-building research, experimental, 2026-11): off hides the stair finder too.
PLANS_OFF_CODE = "ai_plans_off"
PLANS_OFF_MESSAGE = "AI map-building research is off: turn it on in Settings → AI to read plans."
STAIRS_OFF_CODE = "ai_stairs_off"
STAIRS_OFF_MESSAGE = "Reading stairs off the plans is off: turn on Stairs from your floor plans in Settings → AI."
NOT_PLACED_CODE = "map_not_placed"
MAX_FOUND = 6                       # stairs on one plan, at most
MIN_SIDE_FRAC = 0.015               # a box narrower than this share of the image is a mark, not stairs
SIZE_M = (0.6, 8.0)                 # a stair's footprint, each way (house3d_store's range)
# What a staircase can be, in metres: a straight flight at most this wide and
# long, a turning one at most this each way. The model boxes a U or landing
# stair together with its landings and calls it straight (2026-11-02: 4 of
# the 15 real finds on 16 plans were 2.8-4.6 m across and up to 6.0 m long;
# the one junk box past the old 2.4 m / 4.2 m limits was 4.0 × 9.1 m), so the
# limits take a landing in. A box past these is not a staircase, and is left
# out.
STRAIGHT_MAX_M, TURNING_MAX_M = (3.5, 6.0), 6.5
PAST_EDGE_FRAC = 0.02               # a box further out past the picture than this is answered in another frame, not rounding
STRAIGHT_WIDTH_M = 1.3              # a plan's box takes in the wall or rail too: a straight flight is drawn no wider
MAX_AREA_FRAC = 0.6                 # nor is a box over most of the plan (a zoomed-in plan's stairs can fill a third of it)

# Short on purpose: scored against hand-marked stairs on four real plans
# (2026-10-27, qwen2.5vl:7b), this wording placed them best (mean overlap 0.65
# against 0.48 for a longer one that described landings and labels) and
# answered in 3-4 s a plan against 13. Asking for a second, zoomed look did
# not help (0.42).
PROMPT = (
    "This floor plan image is {w} by {h} pixels. Locate every staircase (a run of many short parallel step "
    "lines, often with an arrow and UP or DOWN). Output JSON: a list of objects {{\"bbox_2d\": [x1, y1, x2, y2], "
    "\"label\": \"stairs\", \"says\": \"UP|DOWN|none\", \"up\": \"top|bottom|left|right\", "
    "\"shape\": \"straight|L|U\"}} with pixel coordinates. Only staircases.")


def _list_of(answer: Any) -> list[dict] | None:
    """The answer's list of boxes: the list itself, a {"stairs": [...]}, or
    the first [...] in text (a model that wraps it in ```json fences)."""
    if isinstance(answer, dict):
        for k in ("stairs", "staircases", "items", "data"):
            if isinstance(answer.get(k), list):
                return answer[k]
        return None
    if isinstance(answer, list):
        return answer
    if isinstance(answer, str):
        s = answer.strip()
        a, b = s.find("["), s.rfind("]")
        if a < 0 or b <= a:
            return [] if re.search(r"\bnone\b|\bno stair", s, re.I) else None
        try:
            v = json.loads(s[a:b + 1])
        except ValueError:
            return None
        return v if isinstance(v, list) else None
    return None


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _rot_facing(fx: float, fy: float) -> float:
    """A piece's rotation (degrees) for its front facing (fx, fy) on the plan
    (live_aboard_pieces.js rotFacing)."""
    r = math.degrees(math.atan2(-fx, fy)) % 360.0
    return round(r, 1) % 360.0


def stairs_from_answer(answer: Any, w: int, h: int, to_metres,
                       counts: dict[str, int] | None = None) -> list[dict[str, Any]] | None:
    """The stairs in an AI Task's answer: [{x_m, y_m, rotation, width_m,
    depth_m, shape, says, sure_up}], or None when the answer is not a list of
    boxes. `to_metres(fx, fy)` is the plan's placement (fractions → metres).
    `counts`, when given, gets how the boxes fared (telemetry
    STAIR_BOX_OUTCOMES): kept, dropped (not a staircase's size or shape) and
    past_edge (out past the picture by more than PAST_EDGE_FRAC of a side:
    the model answered in another frame than the one sent)."""
    boxes = _list_of(answer)
    if boxes is None:
        return None
    out: list[dict[str, Any]] = []

    def tally(k: str) -> None:
        if counts is not None:
            counts[k] = counts.get(k, 0) + 1
    for b in boxes[:MAX_FOUND * 2]:
        if not isinstance(b, dict):
            continue
        bb = b.get("bbox_2d") or b.get("bbox") or b.get("box")
        if not (isinstance(bb, list) and len(bb) == 4):
            continue
        xs = [_num(v) for v in bb]
        if any(v is None for v in xs):
            continue
        x1, y1, x2, y2 = (min(xs[0], xs[2]), min(xs[1], xs[3]), max(xs[0], xs[2]), max(xs[1], xs[3]))
        if x1 < -PAST_EDGE_FRAC * w or y1 < -PAST_EDGE_FRAC * h or x2 > (1 + PAST_EDGE_FRAC) * w or y2 > (1 + PAST_EDGE_FRAC) * h:
            tally("past_edge")
        x1, x2 = max(0.0, x1) / w, min(float(w), x2) / w
        y1, y2 = max(0.0, y1) / h, min(float(h), y2) / h
        if x2 - x1 < MIN_SIDE_FRAC or y2 - y1 < MIN_SIDE_FRAC or (x2 - x1) * (y2 - y1) > MAX_AREA_FRAC:
            tally("dropped")
            continue
        p00, p10, p01 = to_metres(x1, y1), to_metres(x2, y1), to_metres(x1, y2)
        mid = to_metres((x1 + x2) / 2, (y1 + y2) / 2)
        if not (p00 and p10 and p01 and mid):
            return None
        ex = (p10[0] - p00[0], p10[1] - p00[1])        # the box's image-x side, in metres
        ey = (p01[0] - p00[0], p01[1] - p00[1])        # its image-y side
        lx, ly = math.hypot(*ex), math.hypot(*ey)
        if min(lx, ly) < SIZE_M[0] * 0.8 or max(lx, ly) > SIZE_M[1] * 1.5:
            tally("dropped")
            continue                                     # not a staircase's size on this plan
        run, across = (ex, ey) if lx >= ly else (ey, ex)
        L_run, L_across = max(lx, ly), min(lx, ly)
        u = (run[0] / L_run, run[1] / L_run)
        # Which way is up: the arrow, where the AI read one, along the run.
        up = str(b.get("up") or "").lower()
        img = {"top": (0.0, -1.0), "bottom": (0.0, 1.0), "left": (-1.0, 0.0), "right": (1.0, 0.0)}.get(up)
        sure_up = False
        if img:
            vx = ex[0] / (lx or 1) * img[0] + ey[0] / (ly or 1) * img[1]
            vy = ex[1] / (lx or 1) * img[0] + ey[1] / (ly or 1) * img[1]
            d = vx * u[0] + vy * u[1]
            if abs(d) > 0.5:
                sure_up = True
                if d < 0:
                    u = (-u[0], -u[1])
        said = str(b.get("shape") or "").strip().upper()
        if said == "U" or (L_across >= 1.6 and L_run / max(L_across, 1e-6) < 1.6):
            shape = "u"
        elif said == "L":
            shape = "l"
        else:
            shape = "straight"
        if (L_across > TURNING_MAX_M or L_run > TURNING_MAX_M) if shape != "straight"                 else (L_across > STRAIGHT_MAX_M[0] or L_run > STRAIGHT_MAX_M[1]):
            tally("dropped")
            continue
        tally("kept")
        says = str(b.get("says") or "").strip().upper()
        says = "DOWN" if says in ("DN", "DOWN", "DWN") else "UP" if says == "UP" else ""
        out.append({
            "x_m": round(mid[0], 3), "y_m": round(mid[1], 3),
            # Climbing toward u: the front (the bottom step) faces −u.
            "rotation": _rot_facing(-u[0], -u[1]),
            "width_m": round(min(max(L_across, SIZE_M[0]), STRAIGHT_WIDTH_M if shape == "straight" else SIZE_M[1]), 3),
            "depth_m": round(min(max(L_run, SIZE_M[0]), SIZE_M[1]), 3),
            "shape": shape, "says": says, "sure_up": sure_up,
        })
        if len(out) >= MAX_FOUND:
            break
    return out


SHRINK_PX = 1024                    # the plan is made at most this big on its long side, then fitted to the frame
PATCH_PX = 28                       # Qwen2.5-VL's patch: Ollama makes each side a multiple of it
MIN_PATCHES = 1024                  # and scales a smaller picture up to at least this many (Ollama 0.32, measured)


def frame_of(w: int, h: int) -> tuple[int, int]:
    """The size Ollama feeds Qwen2.5-VL a w × h picture at, and so the frame
    its boxes come back in: under MIN_PATCHES patches the picture is scaled
    up and each side rounded up to a multiple of PATCH_PX, otherwise each
    side is rounded to the nearest multiple. Measured on 11 sizes with 9
    marks each (2026-11-02): read this way the marks were within 1.5 % of
    the long side, read as named up to 28 % off. Other servers and models
    resize their own way; this size is harmless to them."""
    if w * h < MIN_PATCHES * PATCH_PX * PATCH_PX:
        b = math.sqrt(MIN_PATCHES * PATCH_PX * PATCH_PX / (w * h))
        return math.ceil(w * b / PATCH_PX) * PATCH_PX, math.ceil(h * b / PATCH_PX) * PATCH_PX
    return max(PATCH_PX, round(w / PATCH_PX) * PATCH_PX), max(PATCH_PX, round(h / PATCH_PX) * PATCH_PX)


def shrink(path, px: int = SHRINK_PX, max_mp: float | None = None, framed: bool = True) -> tuple[bytes, int, int]:
    """A plan's image as a JPEG at the frame the model looks at it in
    (frame_of, after making it at most `px` on its long side), and that
    size. `framed` False: a model that answers in the picture's own pixels
    (Claude, the plan line-up: plan_ai.PIXEL_FRAME) gets it at that size,
    no larger than `max_mp` megapixels either. Pillow ships with Home
    Assistant. Runs in the executor."""
    from PIL import Image  # noqa: PLC0415
    import io  # noqa: PLC0415
    with Image.open(path) as im:
        im = im.convert("RGB")
        im.thumbnail((px, px))
        if max_mp and im.size[0] * im.size[1] > max_mp * 1e6:
            k = math.sqrt(max_mp * 1e6 / (im.size[0] * im.size[1]))
            im = im.resize((max(1, int(im.size[0] * k)), max(1, int(im.size[1] * k))), Image.LANCZOS)
        if framed:
            im = im.resize(frame_of(*im.size), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=88)
        return buf.getvalue(), im.size[0], im.size[1]


def _plans(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The floor plans that can be read: placed on their floor, with an image."""
    maps = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    if maps is None or model is None:
        return []
    out = []
    for m in maps.list_maps():
        mid = str(m.get("id") or "")
        if not mid or not (m.get("image") or {}).get("filename"):
            continue
        if model.map_frac_to_metres(0.5, 0.5, mid) is None:
            continue
        out.append({"map_id": mid, "name": str(m.get("name") or "")[:80], "floor_id": str(m.get("floor_id") or "")})
    return out


def _refused(hass: HomeAssistant, connection, msg) -> dict | None:
    """The gates both commands share; the AI Task when they pass."""
    if not enabled(hass):
        connection.send_error(msg["id"], OFF_CODE, OFF_MESSAGE)
        return None
    if not _tier_at_least(hass, "pro"):
        connection.send_error(msg["id"], OFF_CODE, PRO_MESSAGE)
        return None
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if ((st.data if st else {}) or {}).get("ai_plans_enabled") is not True:
        connection.send_error(msg["id"], PLANS_OFF_CODE, PLANS_OFF_MESSAGE)
        return None
    if ((st.data if st else {}) or {}).get("ai_stairs_enabled") is not True:
        connection.send_error(msg["id"], STAIRS_OFF_CODE, STAIRS_OFF_MESSAGE)
        return None
    return P.ai_task(hass, with_backup=True)


def _bump(hass: HomeAssistant, event: str, n: int = 1) -> None:
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, event, n)
    except Exception:  # noqa: BLE001
        pass


@websocket_api.websocket_command({"type": "padspan_ha/house3d_stairs_plans"})
@websocket_api.async_response
@admin_if_enhanced_security
async def ws_house3d_stairs_plans(hass: HomeAssistant, connection, msg) -> None:
    """The placed floor plans there are to read: [{map_id, name, floor_id}],
    and whether the AI Task runs on this home's own computer (local: True,
    False, or None when unknown): a small local model reads plans less well."""
    ai = _refused(hass, connection, msg)
    if ai is None:
        return
    connection.send_result(msg["id"], {"plans": _plans(hass), "ai_ready": bool(ai.get("ready")),
                                       "message": "" if ai.get("ready") else ai.get("message", ""),
                                       "local": ai.get("local") if ai.get("ready") else None})


@websocket_api.websocket_command({
    "type": "padspan_ha/house3d_stairs_read",
    vol.Required("map_id"): str,
})
@websocket_api.async_response
@admin_if_enhanced_security
async def ws_house3d_stairs_read(hass: HomeAssistant, connection, msg) -> None:
    """One floor plan's stairs, read by the chosen AI Task. Stores nothing."""
    ai = _refused(hass, connection, msg)
    if ai is None:
        return
    if not ai["ready"]:
        _bump(hass, "stair_read:no_ai_task")
        await U.refused(hass, "no_ai", ai.get("ai_task"))
        connection.send_error(msg["id"], P.NO_AI_CODE, ai["message"])
        return
    model = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    maps = hass.data.get(DOMAIN, {}).get(DATA_MAPS)
    map_id = msg["map_id"]
    m = maps.get_map(map_id) if maps is not None else None
    if model is None or m is None or model.map_frac_to_metres(0.5, 0.5, map_id) is None:
        connection.send_error(msg["id"], NOT_PLACED_CODE, "That floor plan isn't placed on its floor yet.")
        return
    fp = await hass.async_add_executor_job(
        lambda: maps.image_file(str((m.get("image") or {}).get("filename") or ""), must_exist=True))
    try:
        if fp is None:
            raise OSError("no image")
        raw, w, h = await hass.async_add_executor_job(shrink, fp)
    except Exception:  # noqa: BLE001 — a missing or unreadable picture is one answer
        connection.send_error(msg["id"], "bad_photo", "That floor plan's picture couldn't be read.")
        return
    mime = "image/jpeg"
    t0 = time.monotonic()
    try:
        answer, by = await P.ask_ai(hass, ai, PROMPT.format(w=w, h=h), None, raw, mime,
                                    task_name="PadSpan Live Aboard stairs")
    except P._NoMedia:  # noqa: SLF001
        _bump(hass, "stair_read:error")
        connection.send_result(msg["id"], {"ok": False, "reason": "error", "message": P.NO_MEDIA})
        return
    except Exception as err:  # noqa: BLE001 — any failure of the AI Task is a plain "couldn't read it"
        P._LOGGER.warning("PadSpan Live Aboard: the AI Task %s couldn't read a floor plan: %s", ai["ai_task"], P._why(err))
        _bump(hass, "stair_read:error")
        connection.send_result(msg["id"], {"ok": False, "reason": "error", "message": P.FAILED.format(why=P._why(err))})
        return
    took = round(time.monotonic() - t0, 1)
    # How long the AI took (telemetry.STAIR_EVENTS): local and cloud told apart by env.ai.
    _bump(hass, P._secs_event(took).replace("photo_secs:", "stair_secs:"))  # noqa: SLF001
    counts: dict[str, int] = {}
    found = stairs_from_answer(answer, w, h, lambda fx, fy: model.map_frac_to_metres(fx, fy, map_id), counts)
    if found is None:
        _bump(hass, "stair_read:bad_answer")
        U.unusable(hass, by, answer)
        connection.send_result(msg["id"], {"ok": False, "reason": "bad_answer", "took_s": took,
                                           "message": "The AI's answer had no stairs in it that PadSpan could read."})
        return
    _bump(hass, "stair_read:found" if found else "stair_read:none")
    # How the boxes fared (telemetry.STAIR_BOX_OUTCOMES), each as often as it happened.
    for k, event in (("kept", "stair_box:kept"), ("dropped", "stair_box:dropped"), ("past_edge", "stair_box:past_edge")):
        if counts.get(k):
            _bump(hass, event, counts[k])
    # Which AI Task answered; by_backup only where the backup did (Settings → AI).
    connection.send_result(msg["id"], {"ok": True, "map_id": map_id, "stairs": found, "took_s": took,
                                       "ai_task": by, **({"by_backup": True} if by != ai["ai_task"] else {})})


WS_COMMANDS = (ws_house3d_stairs_plans, ws_house3d_stairs_read)
