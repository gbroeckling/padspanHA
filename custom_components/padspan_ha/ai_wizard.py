# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Let Claude draw your rooms (code: ai_wizard; design PadspanResearch
ai-wizard-design-2026-11-10.md, sections A and J).

Piece 1 is the rule and its field signal only: nothing here is on screen. One
pure function, offer_reason, says whether the helper may be offered to a house
and, when not, the one named reason why. The panel will ask it through
padspan_ha/ai_wizard_info and the daily opt-in report asks it too (as
env.mapping.wizard), so both read the same copy. OFFER_AFTER_DAYS and
SCALE_BUILT are the places to widen it.

The "is this setup step done" checks are views/setup_status.js's, ported here
for the report and the rule; tests/test_ai_wizard.py runs both copies on the
same states (and trial_offer.js's trialOfferable against trial_offerable).
"""
from __future__ import annotations

import math
import re
import time
from datetime import date, datetime
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_PLAN_AI, DATA_SETTINGS, DOMAIN
from .presence_rules import is_outdoor_floor
from .telemetry import AI_WIZARD_STEPS, AI_WIZARD_SURFACES, INSTALL_AGE_WORDS, install_age_word

OFFER_AFTER_DAYS = 7    # a plan this many days old with no rooms is stuck (the field's median stuck house: 18 days)
SCALE_BUILT = True      # piece 3: the helper sets a plan's scale by one measurement, so no_scale is never the answer (kept in REASONS for older reports)
SURFACES: tuple[str, ...] = ("push", "pull")   # push: the Overview (respects Not now / Don't ask again); pull: Setup, the Mapping wizard
REASONS: tuple[str, ...] = ("not_admin", "not_live", "wall_screen", "edition", "has_rooms", "no_plan",
                            "age_unknown", "plan_too_new", "not_struggled", "dismissed", "undone", "snoozed",
                            "tool_used", "no_pro_path", "no_scale", "offer")
# The pull surfaces' trigger (owner, 2026-11-12): no day count; Setup and the Mapping wizard offer the helper once the
# person has opened the Scale or Rooms step and left it unfinished (settings.ai_map_wizard.struggled, set by mark()),
# or has used the helper already. The push surfaces keep OFFER_AFTER_DAYS.
SETUP_STEPS_WATCHED: tuple[str, ...] = ("scale", "rooms")
# A helper's read the person hasn't finished: it can be picked up again (the step before Save, or a read still running).
_UNFINISHED = frozenset({"scale_read", "scale_check", "scale_guided", "floor_pick", "rooms_read", "rooms_check"})


def goes_on(f: dict[str, Any]) -> bool:
    """A house with rooms that the helper itself is still working on: an indoor
    floor with a plan has no rooms yet, and the helper either saved rooms here
    (that floor is next) or left one of its reads part-way. Only the pull
    surfaces see it; a house that got its rooms some other way, or whose
    floors all have rooms now (a read that failed, the rooms drawn by hand),
    is never offered the helper."""
    w = f["wizard"]
    st = w.get("started") if isinstance(w.get("started"), dict) else {}
    return bool(f.get("floor_no_rooms")) and (bool(w.get("finished_day")) or st.get("at") in _UNFINISHED)


def offer_reason(f: dict[str, Any], surface: str) -> str:
    """The first reason the helper is not offered, or "offer". `f` is facts()."""
    if not f["admin"]:
        return "not_admin"
    if not f["live"]:
        return "not_live"                          # Sample mode's house, or not known yet
    if f["kiosk"]:
        return "wall_screen"
    if f["edition"] == "bright":
        return "edition"                           # Bright builds show no presence
    if (f["rooms"] or f["room_bounds"]) and (surface == "push" or not goes_on(f)):
        return "has_rooms"                         # never disturb a house that has rooms (pull: unless the helper is still at it)
    if not f["indoor_plans"]:
        return "no_plan"
    w = f["wizard"]
    if surface == "push":
        if f["plan_age_days"] is None:
            return "age_unknown"                   # no plan's `created`, and no first_seen_ts
        if f["plan_age_days"] < OFFER_AFTER_DAYS:
            return "plan_too_new"
    elif not (w.get("struggled") or w.get("started")):
        return "not_struggled"                     # pull: the Scale or Rooms step not yet opened and left unfinished
    if surface == "push" and w.get("dismissed"):
        return "dismissed"
    if surface == "push" and w.get("undone"):
        return "undone"                            # design A.3: not pushed again; Setup, the Mapping wizard and the Plans tool still offer it
    if surface == "push" and f["now"] < (w.get("snooze_until") or 0):
        return "snoozed"
    if surface == "push" and f["tool_used"] and not w.get("started"):
        # Someone already found the Plans tool (Line up / Rooms from plans): not pushed a beginner's helper. The pull
        # surfaces offer it all the same (review 2026-11-12): there the person is stuck at Scale or Rooms right now.
        return "tool_used"
    if f["tier"] != "pro" and not f["trial_offerable"]:
        return "no_pro_path"                       # a lapsed key, or the trial already used
    if not SCALE_BUILT and not f["plan_scaled"]:
        return "no_scale"
    return "offer"


# ── views/setup_status.js, the same checks over the same state shape ─────────
# state = {"maps": {"list": [...]}, "model": {"room_geometry_m", "map_transforms"},
#          "calibration": {"points", "model"}}, as the panel holds it.

def _maps(s: dict) -> list:
    return [m for m in ((s.get("maps") or {}).get("list") or []) if isinstance(m, dict)]


def has_maps(s: dict) -> bool:
    return bool(_maps(s))


def has_receivers(s: dict) -> bool:
    return any(len(m.get("receivers") or []) > 0 for m in _maps(s))


def has_fabric_rooms(s: dict) -> bool:
    return len((s.get("model") or {}).get("room_geometry_m") or {}) > 0


def has_rooms(s: dict) -> bool:
    return has_fabric_rooms(s) or any(len(m.get("room_bounds") or {}) > 0 for m in _maps(s))


def has_scale(s: dict) -> bool:
    return any(isinstance(t, dict) and len(t.get("reference_measurements") or []) > 0
               for t in ((s.get("model") or {}).get("map_transforms") or {}).values())


def has_calibration(s: dict) -> bool:
    cal = s.get("calibration") or {}
    return len(cal.get("points") or []) >= 5 or len(cal.get("model") or {}) > 0


def trial_offerable(has_key: bool, tier: str) -> bool:
    """trial_offer.js trialOfferable: no key of any kind, and a tier below Bright."""
    from .licence import tier_at_least  # noqa: PLC0415
    return not has_key and not tier_at_least(tier, "bright")


# ── what the report says (design J.1); closed words only ─────────────────────
# A house is set up once it is calibrated (the Getting started card's last
# step); until then, the first step not done. Sent only by a house with a plan
# that isn't set up, or that used the helper: a set-up house's report is as it was.
STUCK_WORDS: tuple[str, ...] = ("plan_no_rooms", "rooms_no_receivers", "receivers_no_calibration", "none")
WIZARD_STEPS: tuple[str, ...] = AI_WIZARD_STEPS       # one list: the report's words (telemetry.AI_WIZARD_EVENTS)
WIZARD_STATES: tuple[str, ...] = ("never", "offered", "opened", *(f"left_{s}" for s in WIZARD_STEPS),
                                  "finished", "dismissed", "snoozed", "undone")
DONE_AGE_WORDS: tuple[str, ...] = ("lt7d", "7_30d", "gt30d")
_DAY = re.compile(r"\d{4}-\d{2}-\d{2}")


def stuck_word(s: dict) -> str:
    if has_calibration(s):
        return "none"
    if not has_rooms(s):
        return "plan_no_rooms"
    if not has_receivers(s):
        return "rooms_no_receivers"
    return "receivers_no_calibration"


def wizard_state(w: dict, now: float) -> str:
    """Where this house is with the helper, from settings.ai_map_wizard."""
    if w.get("undone"):
        return "undone"
    if w.get("finished_day"):
        return "finished"
    if w.get("dismissed"):
        return "dismissed"
    if now < (w.get("snooze_until") or 0):
        return "snoozed"
    st = w.get("started")
    if isinstance(st, dict):
        return f"left_{st['at']}" if st.get("at") in WIZARD_STEPS else "opened"
    return "offered" if w.get("offered") else "never"


def done_age_word(finished_day: Any, today: date) -> str | None:
    try:
        d = (today - date.fromisoformat(str(finished_day))).days
    except ValueError:
        return None
    return None if d < 0 else "lt7d" if d < 7 else "7_30d" if d <= 30 else "gt30d"


def clean_wizard(raw: dict) -> dict[str, Any]:
    """settings.ai_map_wizard as stored: the keys design A.3 names, nothing else."""
    out: dict[str, Any] = {}
    for k in ("dismissed", "undone", "offered", "struggled"):
        if raw.get(k) is True:
            out[k] = True
    ok = raw.get("scale_ok")                       # plans whose scale the person said is right (mark "scale_ok")
    if isinstance(ok, list):
        ok = [str(m)[:64] for m in ok if isinstance(m, str) and m][-20:]
        if ok:
            out["scale_ok"] = ok
    resc = raw.get("rescale")                      # plan -> its rooms session, while "Check the scale" waits for the new measurement
    if isinstance(resc, dict):
        resc = {str(k)[:64]: str(v)[:64] for k, v in list(resc.items())[-10:] if isinstance(k, str) and isinstance(v, str) and k and v}
        if resc:
            out["rescale"] = resc
    rp = raw.get("receivers_placed")              # "Put my receivers in their rooms": source -> [x_m, y_m, z_m, floor_id], for its Undo
    if isinstance(rp, dict):
        rp = {str(k)[:80]: [float(v[0]), float(v[1]), float(v[2]), str(v[3])[:64]] for k, v in list(rp.items())[:64]
              if isinstance(k, str) and isinstance(v, list) and len(v) == 4 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v[:3])}
        if rp:
            out["receivers_placed"] = rp
    seen = raw.get("seen")                         # Setup step -> the page load that first showed it (mark "step_seen")
    if isinstance(seen, dict):
        seen = {k: str(v)[:64] for k, v in seen.items() if k in SETUP_STEPS_WATCHED and isinstance(v, str)}
        if seen:
            out["seen"] = seen
    for k in ("snooze_until", "snoozes"):
        v = raw.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            out[k] = int(v) if k == "snoozes" else float(v)
    if isinstance(raw.get("finished_day"), str) and _DAY.fullmatch(raw["finished_day"]):
        out["finished_day"] = raw["finished_day"]
    st = raw.get("started")
    if isinstance(st, dict):
        out["started"] = {"at": st["at"] if st.get("at") in WIZARD_STEPS else "intro",
                          **{k: str(st[k])[:64] for k in ("map_id", "floor_id", "scale_session", "rooms_session") if isinstance(st.get(k), str)}}
    return out


# ── the facts, read from what the stores already hold ────────────────────────

def _ts(iso: Any) -> float | None:
    try:
        return datetime.fromisoformat(str(iso)).timestamp()
    except (TypeError, ValueError):
        return None


def setup_state(hass: HomeAssistant) -> dict[str, Any]:
    """The panel's state shape, from the stores: plans, rooms (the fabric's, as
    model_get's room_geometry_m), the plans' scale, calibration."""
    dom = hass.data.get(DOMAIN, {})
    fab = getattr(dom.get(DATA_FABRIC), "data", None) or {}
    rooms = {r: 1 for f in (fab.get("floors") or {}).values() if isinstance(f, dict) for r in (f.get("rooms") or {})}
    mdl = getattr(dom.get(DATA_MODEL), "data", None) or {}
    cal = getattr(dom.get(DATA_CALIBRATION), "data", None) or {}
    return {"maps": {"list": list((getattr(dom.get(DATA_MAPS), "data", None) or {}).get("maps") or [])},
            "model": {"room_geometry_m": rooms, "map_transforms": mdl.get("map_transforms") or {}},
            "calibration": {"points": cal.get("points") or [], "model": cal.get("model") or {}}}


def plan_roomed(m: dict, roomed: set[str], rooms: list) -> bool:
    """Whether a plan's floor has rooms (the panel's planRoomed, views/ai_wizard.js, is this rule): rooms drawn on the
    plan itself, or on its floor; a plan with no floor never takes another floor's rooms, only the rooms drawn on it
    (its room_bounds, or a room whose outline was made from it)."""
    if m.get("room_bounds"):
        return True
    if m.get("floor_id"):
        return str(m["floor_id"]) in roomed
    return any(isinstance(r, dict) and r.get("source_map_id") == m.get("id") for r in rooms)


def facts(hass: HomeAssistant, *, admin: bool = True, kiosk: bool = False, live: bool | None = None,
          now: float | None = None) -> dict[str, Any]:
    """What offer_reason reads. `live`: the panel's word (Sample mode, a demo);
    the house's data_mode decides when it isn't given. The plan AI's store is
    read only if loaded (async_get_store first, where it matters)."""
    from .licence import edition, hass_tier  # noqa: PLC0415
    dom = hass.data.get(DOMAIN, {})
    st = dom.get(DATA_SETTINGS)
    settings: dict[str, Any] = (st.data if st else {}) or {}
    now = time.time() if now is None else now
    s = setup_state(hass)
    indoor = [m for m in _maps(s) if not is_outdoor_floor(m.get("floor_id"))]      # the one outdoors rule (Outside, Yard, Garden…)
    created = [t for t in (_ts(m.get("created")) for m in indoor) if t is not None]
    seen = settings.get("first_seen_ts")
    plan_since = min(created) if created else None
    since = plan_since if plan_since is not None else (float(seen) if isinstance(seen, (int, float)) and not isinstance(seen, bool) and seen > 0 else None)
    plan_ai = getattr(dom.get(DATA_PLAN_AI), "data", None) or {}
    tier = hass_tier(hass)
    w = settings.get("ai_map_wizard")
    fab = getattr(dom.get(DATA_FABRIC), "data", None) or {}
    roomed = {str(fid) for fid, fl in (fab.get("floors") or {}).items() if isinstance(fl, dict) and fl.get("rooms")} \
        | {str(m.get("floor_id")) for m in _maps(s) if m.get("room_bounds") and m.get("floor_id")}
    fab_rooms = [r for fl in (fab.get("floors") or {}).values() if isinstance(fl, dict) for r in (fl.get("rooms") or {}).values()]
    return {"admin": admin, "live": settings.get("data_mode") == "live" and live is not False, "kiosk": kiosk,
            "edition": edition(), "rooms": has_fabric_rooms(s), "room_bounds": any(len(m.get("room_bounds") or {}) > 0 for m in _maps(s)),
            "floor_no_rooms": any(not plan_roomed(m, roomed, fab_rooms) for m in indoor),
            "indoor_plans": len(indoor), "plan_since": plan_since, "plan_age_days": None if since is None else max(0.0, (now - since) / 86400),
            "wizard": w if isinstance(w, dict) else {}, "now": now,
            # The Plans tool's own sessions only: the helper's rooms and scale sessions are kept in the same store (via "wizard").
            "tool_used": bool(plan_ai.get("lineups")) or any(isinstance(r, dict) and r.get("via") != "wizard" for r in (plan_ai.get("rooms") or {}).values()),
            "tier": tier, "trial_offerable": trial_offerable(bool(str(settings.get("forensics_license_key") or "").strip()), tier),
            "plan_scaled": has_scale(s), "state": s}


def report_env(hass: HomeAssistant, now: float) -> dict[str, Any] | None:
    """env.mapping for the daily report, or None where it doesn't apply (no
    plan; set up and never used the helper). The rule's word is its answer for
    an administrator on the Overview, a screen that isn't a wall."""
    f = facts(hass, now=now)
    s, w = f["state"], f["wizard"]
    stuck = stuck_word(s)
    if not has_maps(s) or (stuck == "none" and not w):
        return None
    out = {"stuck": stuck}
    age = install_age_word(f["plan_since"], now)          # days since the first plan's `created`
    if age:
        out["plan_age"] = age
    out["wizard"] = offer_reason(f, "push")
    out["wizard_state"] = wizard_state(w, now)
    if out["wizard_state"] == "finished":
        done = done_age_word(w.get("finished_day"), date.fromtimestamp(now))
        if done:
            out["wizard_done_age"] = done
    return out


MAPPING_WORDS: dict[str, tuple[str, ...]] = {
    "stuck": STUCK_WORDS, "plan_age": INSTALL_AGE_WORDS, "wizard": REASONS,
    "wizard_state": WIZARD_STATES, "wizard_done_age": DONE_AGE_WORDS}


# ── piece 2: Not now, Don't ask again, where it was left (design A.3) ────────
SNOOZE_DAYS: tuple[int, int] = (7, 30)          # the first Not now, then every one after
MARKS: tuple[str, ...] = ("offered", "opened", "step", "snoozed", "dismissed", "came_back", "finished", "undone",
                          "step_seen", "step_left", "scale_ok", "rescale", "rescale_done", "receivers_placed")


def mark(w: dict, what: str, now: float, today: date, step: str | None = None, **ids: Any) -> dict[str, Any]:
    """settings.ai_map_wizard after one thing the person did. Pure. step_seen (Setup's Scale or Rooms step shown, with
    the page load's id): seen again on another page load, the person left it unfinished and came back (struggled);
    step_left (Setup shown again after opening that step from it, in the same page load): struggled."""
    w = clean_wizard(w)
    if what == "step_seen" and step in SETUP_STEPS_WATCHED:
        seen, page = dict(w.get("seen") or {}), str(ids.get("page") or "")[:64]
        if step in seen and seen[step] != page:
            w["struggled"] = True
        seen.setdefault(step, page)
        w["seen"] = seen
    elif what == "step_left" and step in SETUP_STEPS_WATCHED:
        w["struggled"] = True
    elif what == "scale_ok" and isinstance(ids.get("map_id"), str) and ids["map_id"]:
        w["scale_ok"] = [m for m in w.get("scale_ok") or [] if m != ids["map_id"]] + [ids["map_id"]]
    elif what == "rescale" and ids.get("map_id") and ids.get("rooms_session"):
        w["rescale"] = {**{k: v for k, v in (w.get("rescale") or {}).items() if k != ids["map_id"]}, ids["map_id"]: ids["rooms_session"]}
    elif what == "rescale_done" and ids.get("map_id"):
        w["rescale"] = {k: v for k, v in (w.get("rescale") or {}).items() if k != ids["map_id"]}
    elif what == "receivers_placed":
        w["receivers_placed"] = dict(ids.get("placed") or {})
    elif what in ("offered", "opened"):
        w["offered"] = True
        if what == "opened" and "started" not in w:
            w["started"] = {"at": "intro"}
    elif what == "step":
        old = w.get("started") or {}
        if ids.get("map_id") and old.get("map_id") and ids["map_id"] != old["map_id"]:
            old = {}                                   # another plan: the last plan's readings aren't its own
        w["started"] = {**old, "at": step if step in WIZARD_STEPS else "intro",
                        **{k: v for k, v in ids.items() if isinstance(v, str) and v}}
    elif what == "snoozed":
        n = int(w.get("snoozes") or 0) + 1
        w.update(snoozes=n, snooze_until=now + SNOOZE_DAYS[min(n, 2) - 1] * 86400)
    elif what == "dismissed":
        w["dismissed"] = True
    elif what == "finished":
        w["finished_day"] = today.isoformat()
        w.pop("undone", None)
    elif what == "undone":
        w["undone"] = True
    return clean_wizard(w)


async def async_mark(hass: HomeAssistant, what: str, **kw: Any) -> dict[str, Any]:
    """mark() written to the settings store; the stored value."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if st is None:
        return {}
    now = time.time()
    w = mark(st.data.get("ai_map_wizard") or {}, what, now, date.fromtimestamp(now), **kw)
    await st.async_set(ai_map_wizard=w)
    return w


# ── piece 2: names for the rooms Claude found (design D) ─────────────────────
# Folded: lower case, no accents, no punctuation, letters apart from numbers.
# Matched on the folded words with the abbreviations a plan prints written out;
# Master and Primary are one word.
ABBREV: dict[str, tuple[str, ...]] = {
    **dict.fromkeys(("br", "bdrm", "bd", "bed"), ("bedroom",)), **dict.fromkeys(("ba", "bath"), ("bathroom",)),
    **dict.fromkeys(("kit", "kitch"), ("kitchen",)), **dict.fromkeys(("lr", "liv", "living"), ("living", "room")),
    **dict.fromkeys(("dr", "din", "dining"), ("dining", "room")), **dict.fromkeys(("wc", "pwdr", "powder"), ("powder", "room")),
    **dict.fromkeys(("ldry", "lndry"), ("laundry",)), **dict.fromkeys(("ofc", "study"), ("office",)),
    **dict.fromkeys(("ent", "entry", "foyer"), ("entrance",)), **dict.fromkeys(("hall", "corr", "corridor"), ("hallway",)),
    **dict.fromkeys(("cl", "clo", "clos", "wic"), ("closet",)), **dict.fromkeys(("master", "mstr"), ("primary",)),
    "bedrm": ("bedroom",), "mbr": ("primary", "bedroom"), "pwd": ("powder", "room"), "rm": ("room",), "fam": ("family", "room"),
    "util": ("utility",), "mech": ("mechanical",), "wd": ("laundry",), **dict.fromkeys(("ens", "ensuite"), ("ensuite", "bathroom")),
    "gar": ("garage",),
    # German, French and Dutch room names (folded: no accents), so "the scale looks wrong" reads them too (2026-11-12).
    **dict.fromkeys(("schlafzimmer", "kinderzimmer", "gastezimmer", "chambre", "slaapkamer"), ("bedroom",)),
    **dict.fromkeys(("badezimmer", "bad", "bains", "sdb", "badkamer"), ("bathroom",)),
    **dict.fromkeys(("kuche", "cuisine", "keuken"), ("kitchen",)),
    **dict.fromkeys(("wohnzimmer", "salon", "sejour", "woonkamer"), ("living", "room")),
    **dict.fromkeys(("esszimmer", "eetkamer"), ("dining", "room")),
    **dict.fromkeys(("flur", "diele", "couloir", "degagement", "gang", "hal", "overloop"), ("hallway",)),
    **dict.fromkeys(("buro", "arbeitszimmer", "bureau", "kantoor", "werkkamer"), ("office",)),
    **dict.fromkeys(("waschkuche", "hauswirtschaftsraum", "buanderie", "wasruimte", "washok"), ("laundry",)),
    **dict.fromkeys(("abstellraum", "placard", "dressing", "berging"), ("closet",)),
    **dict.fromkeys(("toilette", "toilettes", "toilet"), ("powder", "room")),
    **dict.fromkeys(("eingang", "entree"), ("entrance",))}
# Written out in a printed name too: only true abbreviations (STUDY stays Study, MASTER stays Master, ENSUITE stays Ensuite).
_SPELL_OUT = frozenset({"br", "bdrm", "bd", "ba", "kit", "kitch", "lr", "liv", "dr", "din", "wc", "pwdr", "ldry", "lndry", "ofc", "ent",
                        "corr", "cl", "clo", "clos", "wic", "bed", "bedrm", "mbr", "pwd", "rm", "fam", "util", "mech", "wd", "ens", "gar", "mstr"})
_PRINTED = {"mstr": ("master",), "mbr": ("master", "bedroom"), "ens": ("ensuite",)}   # written out as printed plans mean them
# Not a room to tick at the start (still offered, unticked): outside, stairs and voids, in English, German, French and Dutch.
OUTDOOR_WORDS = frozenset({"porch", "deck", "patio", "balcony", "terrace", "veranda", "lanai", "carport", "stair", "stairs", "stairwell", "void",
                           "balkon", "loggia", "terrasse", "garten", "hof", "treppenhaus",            # German
                           "balcon", "cour", "jardin", "escalier",                                  # French (loggia, terrasse above)
                           "terras", "tuin", "trap", "trappenhuis"})                                # Dutch (balkon above)
# A size printed with a room's name (14'-8" x 8'-5", 4.2 x 3.1, 132 sq ft, 12.3 m²): never part of the name.
_LEN = r"\d+(?:[.,]\d+)?\s*(?:['′’]|ft\.?|mm|cm|m)?(?:\s*-?\s*\d+(?:[.,]\d+)?(?:\s+\d+/\d+)?\s*(?:[\"″”]|''|in\.?)?)?"
_SIZE = re.compile(rf"{_LEN}\s*[x×]\s*{_LEN}|\d+(?:[.,]\d+)?\s*(?:sq\.?\s*(?:ft|m)|sf|ft²|ft2|m²|m2)\.?", re.I)
SMALL_M2, TICK_M2 = 2.0, 4.0     # under 2 m²: Small spaces, unticked; 4 m² or more: ticked when both reads saw it
NAME_MAX = 40                    # plan_ai.S2_NAME_MAX


def fold(s: Any) -> str:
    import unicodedata  # noqa: PLC0415
    t = "".join(c for c in unicodedata.normalize("NFKD", str(s or "")) if not unicodedata.combining(c)).lower()
    t = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", re.sub(r"[^\w]+|_", " ", t))
    return " ".join(t.split())


def strip_size(label: Any) -> str:
    """A printed label without the size printed with it (_SIZE), and what that leaves empty: "( )", a trailing dash."""
    s = re.sub(r"[(\[]\s*[)\]]", " ", _SIZE.sub(" ", str(label or "")))
    return " ".join(s.split()).strip(" -–,:;/|")


def _same(out: list[str], x: str) -> bool:
    """A word written out twice in a row (BED RM: bedroom; LIV RM: living room; ENSUITE BATH: ensuite bathroom)."""
    return bool(out) and ((out[-1].lower() == x and not x.isdigit()) or (x == "room" and out[-1].lower().endswith("room")))


def _words(s: Any) -> list[str]:
    out: list[str] = []
    for w in re.sub(r"\bw d\b", "wd", fold(strip_size(s))).split():
        for x in ABBREV.get(w, (w,)):
            if not _same(out, x):
                out.append(x)
    return out


def is_void(label: Any) -> bool:
    f = fold(label)
    return "open to below" in f or "open below" in f or f in ("void", "otb")


def is_outdoor(label: Any) -> bool:
    return bool(OUTDOOR_WORDS & set(fold(label).split()))


def printed_name(label: Any) -> str:
    """A printed label as a room's name: abbreviations written out, CAPITALS
    made Title Case, accents kept, a printed size left out."""
    raw = strip_size(label)
    caps = raw.isupper()
    out: list[str] = []
    for w in raw.split():
        f = fold(w)
        f = "wd" if f == "w d" else f
        if f in _SPELL_OUT:
            for x in _PRINTED.get(f, ABBREV[f]):
                if not _same(out, x):
                    out.append(x.capitalize())
        else:
            out.append(w.capitalize() if caps else w)
    return " ".join(out)[:NAME_MAX].strip()


def _unique(name: str, taken: set[str]) -> str:
    n, k = name, 2
    while n.lower() in taken:
        sfx = f" {k}"
        n, k = name[:NAME_MAX - len(sfx)].rstrip() + sfx, k + 1
    return n


def suggest_names(spaces: dict[str, dict], areas: list[dict], taken: Any, floor_id: str) -> dict[str, dict[str, str]]:
    """{space id: {name, source}} for the spaces Claude found (design D): a
    Home Assistant area that isn't a room yet, on this floor or on none
    (area_exact, then area_abbrev: the abbreviations written out, then the
    area's words all in the label), the largest space first; else the printed
    name (printed), made unique house-wide with 2, 3. "Open to below" gets no
    name. `spaces`: {id: {name, outline_m}}. Pure."""
    from . import plan_geom as G  # noqa: PLC0415
    taken_l = {str(n).lower() for n in taken if n}
    free = [a for a in areas if a.get("name") and str(a["name"]).lower() not in taken_l
            and a.get("floor_id") in (None, "", floor_id)]
    order = sorted((sid for sid, s in spaces.items() if not is_void(s.get("name"))),
                   key=lambda sid: -G.area(spaces[sid].get("outline_m") or []))
    out: dict[str, dict[str, str]] = {}
    used: set[int] = set()

    def give(test, source: str) -> None:
        for sid in order:
            if sid in out:
                continue
            i = next((i for i, a in enumerate(free) if i not in used and test(strip_size(spaces[sid].get("name")), a["name"])), None)
            if i is not None:
                used.add(i)
                out[sid] = {"name": str(free[i]["name"])[:NAME_MAX], "source": source}

    def within(label: Any, area: Any) -> bool:
        aw = set(_words(area))
        return any(len(w) >= 3 and not w.isdigit() for w in aw) and aw <= set(_words(label))

    give(lambda lab, ar: fold(lab) == fold(ar) and bool(fold(ar)), "area_exact")
    give(lambda lab, ar: _words(lab) == _words(ar) and bool(_words(ar)), "area_abbrev")
    give(within, "area_abbrev")
    # Another floor's area keeps its name to itself: a room saved under it here would move it to this floor.
    names = taken_l | {v["name"].lower() for v in out.values()} | {str(a["name"]).lower() for a in areas if a.get("name")
                                                                    and a.get("floor_id") not in (None, "", floor_id)}
    for sid in order:
        if sid not in out:
            nm = _unique(printed_name(spaces[sid].get("name")) or "Room", names)
            names.add(nm.lower())
            out[sid] = {"name": nm, "source": "printed"}
    return out


def wizard_ticks(prop: dict, sources: dict[str, str]) -> dict[str, Any]:
    """What the helper offers and ticks at the start (design D; Garry,
    2026-11-10: a room only in PadSpan is ticked like any other). Only rooms:
    doors, windows and stairs stay on the session for Live Aboard's Plans
    tool. Ticked: seen by both reads and 4 m² or more, or 2 m² or more and
    one of the house's Home Assistant areas. Unticked: one read only, a
    porch, a deck, stairs or a carport (OUTDOOR_WORDS, in four languages);
    under 2 m²: Small spaces. Open to below: not offered."""
    from . import plan_geom as G  # noqa: PLC0415
    rows, ticked, small, outdoor, dropped, m2 = [], [], [], [], [], {}
    for r in (prop.get("rooms") or {}).values():
        rows.append(r["id"])
        if r.get("default"):
            ticked.append(r["id"])
    for sid, s in (prop.get("spaces") or {}).items():
        if s.get("merged_into"):
            continue
        if is_void(s.get("name")) or not s.get("new"):
            dropped.append(sid)
            continue
        a = round(G.area(s.get("outline_m") or []), 1)
        m2[sid] = a
        rows.append(sid)
        if a < SMALL_M2:
            small.append(sid)
            continue
        if is_outdoor(s.get("name")):
            outdoor.append(sid)
            continue
        matched = str(sources.get(sid) or "").startswith("area") or sources.get(sid) == "picked_area"
        if len(s.get("reads") or []) >= 2 and (a >= TICK_M2 or matched):
            ticked.append(sid)
    return {"rows": rows, "ticked": ticked, "small": small, "outdoor": outdoor, "dropped": dropped, "m2": m2}


# ── "The scale looks wrong" (owner, 2026-11-12): evidence the rooms read already holds, at no cost ─────────
# Every sign is an ESTIMATE of the length factor k: how many times too long the plan's lengths come out at its scale
# (k = 2: twice too big; k = 1/3: three times too small). Three kinds of evidence, honestly counted:
#   room sizes: ONE sign, whichever way it is worked out, because both ways read the same room areas. With three or more
#     rooms whose names say what they are (TYPICAL_M2; German, French and Dutch names through ABBREV), against what a
#     room of that name usually is; else, any language or rooms named by number, the median room against a home's
#     usual room (ROOM_M2). Strong only when the median is off by ROOMS_OFF or more and most rooms are off that way.
#   spread: how far the rooms reach (their longest extent) for how many rooms there are, against how far that many
#     rooms usually reach. The same outlines, so not independent of the areas, but it errs differently (a house's shape,
#     not its rooms' sizes); weak, so it only counts when it points the same way.
#   printed: a printed measurement Claude read and double-checked, against the scale saved: the strongest.
# The notice ("lots of evidence"): room sizes strong on their own terms AND the spread or a printed reading pointing the
# same way within AGREE_X of it. Doors carry none: they are read as points, and their width is a standard one.
TYPICAL_M2: dict[str, float] = {"bedroom": 12.0, "bathroom": 5.0, "kitchen": 12.0, "living": 22.0, "dining": 12.0, "family": 20.0,
                                "office": 10.0, "laundry": 5.0, "closet": 2.5, "hallway": 6.0, "entrance": 5.0, "garage": 32.0,
                                "powder": 2.5, "ensuite": 5.0}
ROOM_M2 = 10.0          # a home's usual room, the median of all its rooms
ROOMS_OFF = 1.55        # room sizes say the scale is off from this length factor (0.8-1.25 never: tests/test_ai_wizard_rooms.py's table)
ROOM_ONE_OFF = 1.25     # one room is off that way past this factor; "most rooms": MOST_ROOMS of them
MOST_ROOMS = 0.6
SPREAD_M = 1.4          # n rooms of ROOM_M2 usually reach about SPREAD_M * sqrt(n * ROOM_M2) metres at their longest
AGREE_X = 1.6           # another sign agrees when it points the same way within this factor of the room sizes' estimate
MIN_ROOMS = 3
SCALE_SIGNS: tuple[str, ...] = ("rooms", "spread", "printed")


def _kind(name: Any) -> str | None:
    words = _words(name)
    return next((k for k in TYPICAL_M2 if k in words), None)


def scale_signs(spaces: dict[str, dict], rows: list[str], printed: dict | None = None) -> dict[str, Any] | None:
    """Pure. {k (the length factor, the printed reading's when there is one), signs, example} when the evidence says the
    scale is off (the rule above), else None. `spaces`: the proposal's, `rows`: the space ids offered; `printed`: {k,
    text, metres, here_m} from a held, double-checked reading. `example`: the facts said on the check list."""
    from . import plan_geom as G  # noqa: PLC0415
    rooms = [(str(s.get("new") or s.get("name") or ""), G.area(s.get("outline_m") or []), s.get("outline_m") or [])
             for s in (spaces.get(sid) for sid in rows) if isinstance(s, dict)]
    rooms = [r for r in rooms if r[1] > 0]
    if len(rooms) < MIN_ROOMS:
        return None
    named = [(math.sqrt(a / TYPICAL_M2[k]), nm, k, a) for nm, a, _p in rooms for k in [_kind(nm)] if k]
    each = named if len(named) >= MIN_ROOMS else [(math.sqrt(a / ROOM_M2), nm, None, a) for nm, a, _p in rooms]
    ks = sorted(e[0] for e in each)
    k_rooms = ks[len(ks) // 2] if len(ks) % 2 else math.sqrt(ks[len(ks) // 2 - 1] * ks[len(ks) // 2])
    big = k_rooms > 1
    most = sum(1 for e in each if (e[0] >= ROOM_ONE_OFF if big else e[0] <= 1 / ROOM_ONE_OFF)) / len(each)
    if max(k_rooms, 1 / k_rooms) < ROOMS_OFF or most < MOST_ROOMS:
        return None
    ex = max(each, key=lambda e: e[0]) if big else min(each, key=lambda e: e[0])
    facts: dict[str, dict] = {"rooms": {"name": ex[1], "kind": ex[2], "m2": round(ex[3], 1)}}
    agree: dict[str, float] = {}
    pts = [p for _n, _a, poly in rooms for p in poly]
    reach = max(max(p[0] for p in pts) - min(p[0] for p in pts), max(p[1] for p in pts) - min(p[1] for p in pts))
    k_spread = reach / (SPREAD_M * math.sqrt(len(rooms) * ROOM_M2))
    if (k_spread > 1) == big and max(k_spread / k_rooms, k_rooms / k_spread) <= AGREE_X:
        agree["spread"] = k_spread
        facts["spread"] = {"m": round(reach, 1)}
    if printed and printed.get("k"):
        k_p = float(printed["k"])
        if (k_p > 1) == big and max(k_p / k_rooms, k_rooms / k_p) <= AGREE_X:
            agree["printed"] = k_p
            facts["printed"] = {"text": printed.get("text"), "metres": printed.get("metres"), "here_m": printed.get("here_m")}
    if not agree:
        return None
    k = agree.get("printed", k_rooms)
    return {"k": round(k, 3), "signs": sorted(["rooms", *agree]), "example": facts}


def ha_areas(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Home Assistant's areas: [{name, floor_id}]; none when the registry can't be read."""
    try:
        from homeassistant.helpers import area_registry  # noqa: PLC0415
        areas = list(area_registry.async_get(hass).async_list_areas())
    except Exception:  # noqa: BLE001
        return []
    return [{"name": str(a.name), "floor_id": getattr(a, "floor_id", None)} for a in areas if getattr(a, "name", None)]


# ── piece 2: "Also add this room to Home Assistant" (Garry, 2026-11-10) ──────
# Off by default; run only after the rooms were saved; outside PadSpan's backup
# and undo, which the row says. A name that is already an area is matched,
# never made twice; a failure is said and counted, the rooms stay saved.

def create_area(areas_reg: Any, floors_reg: Any, name: str, floor_id: str | None) -> str:
    """matched, created or failed: one Home Assistant area of this name, on
    this floor when Home Assistant has the floor."""
    try:
        if areas_reg.async_get_area_by_name(name) is not None:
            return "matched"
        fid = floor_id if floor_id and floors_reg is not None and floors_reg.async_get_floor(floor_id) is not None else None
        areas_reg.async_create(name, floor_id=fid)
        return "created"
    except Exception:  # noqa: BLE001 — said on the Done screen, the rooms stay saved
        return "failed"


def ensure_area(hass: HomeAssistant, name: str, floor_id: str | None) -> str:
    try:
        from homeassistant.helpers import area_registry  # noqa: PLC0415
        areas_reg = area_registry.async_get(hass)
    except Exception:  # noqa: BLE001
        return "failed"
    try:
        from homeassistant.helpers import floor_registry  # noqa: PLC0415
        floors_reg = floor_registry.async_get(hass)
    except Exception:  # noqa: BLE001
        floors_reg = None
    return create_area(areas_reg, floors_reg, name, floor_id)


def before_save(sess: dict) -> dict[str, Any]:
    """What after_save needs from the proposal before the save works it out
    again (a saved space becomes one of the house's rooms there)."""
    spaces = (sess.get("proposal") or {}).get("spaces") or {}
    return {"names": {sid: s.get("new") for sid, s in spaces.items() if s.get("new")}, "sources": dict(sess.get("named") or {}),
            "floor_id": sess.get("floor_id")}


async def after_save(hass: HomeAssistant, pre: dict[str, Any], answer: dict[str, Any], ha_ids: list[str]) -> dict[str, Any]:
    """A helper's save that went through: the areas asked for, the counts,
    the helper marked finished. {"areas": {space id: matched|created|failed}}."""
    from .telemetry import NAME_SOURCES, bump, rooms_band  # noqa: PLC0415
    saved = [i for i in answer.get("saved") or [] if isinstance(i, str)]
    bump(hass, f"plan_build_rooms_saved:{rooms_band(len(saved))}")
    for sid in saved:
        if sid.startswith("space:"):
            src = pre["sources"].get(sid)
            bump(hass, f"plan_build_name:{src if src in NAME_SOURCES else 'printed'}")
    areas_out: dict[str, str] = {}
    for sid in ha_ids:
        name = pre["names"].get(sid)
        if sid in saved and name:
            areas_out[sid] = ensure_area(hass, name, pre["floor_id"])
            if areas_out[sid] in ("created", "failed"):
                bump(hass, f"ai_wizard:area_{areas_out[sid]}")
    have = {str(n).lower() for n in _house_rooms(hass)}
    left = [a for a in ha_areas(hass) if a.get("floor_id") in (None, "", pre["floor_id"]) and a["name"].lower() not in have]
    bump(hass, f"plan_build_unmatched_areas:{rooms_band(len(left))}")
    await async_mark(hass, "finished")
    bump(hass, "ai_wizard:finished")
    return {"areas": areas_out}


def _house_rooms(hass: HomeAssistant) -> list[str]:
    return list(setup_state(hass)["model"]["room_geometry_m"])


@websocket_api.websocket_command({
    "type": "padspan_ha/ai_wizard_info",
    vol.Optional("surface", default="push"): vol.In(SURFACES),
    vol.Optional("kiosk", default=False): bool,
    vol.Optional("live"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ai_wizard_info(hass: HomeAssistant, connection, msg) -> None:
    """{reason, offer, wizard, tier, trial_offerable}: the rule's answer for
    this screen, and where this house is with the helper (settings.ai_map_wizard)."""
    from .plan_ai import async_get_store  # noqa: PLC0415
    store = await async_get_store(hass)            # "tool_used" reads its sessions
    f = facts(hass, kiosk=msg["kiosk"], live=msg.get("live"))
    reason = offer_reason(f, msg["surface"])
    out = {"reason": reason, "offer": reason == "offer", "wizard": clean_wizard(f["wizard"]), "tier": f["tier"], "trial_offerable": f["trial_offerable"]}
    if msg["surface"] == "pull" and not msg["kiosk"]:
        from .ws_plan_ai import helper_undo  # noqa: PLC0415 — the plan writer's own module answers it
        out["undo"] = await helper_undo(hass, store)   # Setup's Draw the rooms row offers the helper's later undo (owner, 2026-11-12)
    connection.send_result(msg["id"], out)


@websocket_api.websocket_command({
    "type": "padspan_ha/ai_wizard_mark",
    vol.Required("what"): vol.In(("offered", "opened", "step", "snoozed", "dismissed", "came_back", "step_seen", "step_left", "scale_ok",
                                  "rescale", "rescale_done")),
    vol.Optional("surface"): vol.In(AI_WIZARD_SURFACES),
    vol.Optional("step"): vol.In(WIZARD_STEPS),
    vol.Optional("setup_step"): vol.In(SETUP_STEPS_WATCHED),
    vol.Optional("page"): vol.All(str, vol.Length(max=64)),
    vol.Optional("map_id"): vol.All(str, vol.Length(max=64)),
    vol.Optional("floor_id"): vol.All(str, vol.Length(max=64)),
    vol.Optional("scale_session"): vol.All(str, vol.Length(max=64)),
    vol.Optional("rooms_session"): vol.All(str, vol.Length(max=64)),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ai_wizard_mark(hass: HomeAssistant, connection, msg) -> None:
    """One thing the person did with the helper: shown and opened (by where),
    a step reached (where it reopens), Not now, Don't ask again, came back.
    Written to settings.ai_map_wizard and counted. Saved and Undo are marked
    by the rooms save and undo themselves (ws_plan_ai, via "wizard")."""
    from .telemetry import bump  # noqa: PLC0415
    what = msg["what"]
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if what in ("offered", "opened") and msg.get("surface"):
        bump(hass, f"ai_wizard_{what}:{msg['surface']}")
    elif what == "step" and msg.get("step"):
        bump(hass, f"ai_wizard_step:{msg['step']}")
    elif what in ("snoozed", "dismissed", "came_back"):
        bump(hass, f"ai_wizard:{what}")
    if what == "opened":
        # Opened again after its own Undo, or on a house that has rooms (the next floor, a read left part-way): the ways
        # back only the pull surfaces give (offer_reason), counted so the field shows whether they are used.
        if ((st.data if st else {}).get("ai_map_wizard") or {}).get("undone"):
            bump(hass, "ai_wizard:after_undo")
        elif has_rooms(setup_state(hass)):
            bump(hass, "ai_wizard:with_rooms")
    if what == "came_back" or st is None:
        connection.send_result(msg["id"], {"wizard": clean_wizard((st.data if st else {}).get("ai_map_wizard") or {})})
        return
    if what in ("step_seen", "step_left"):
        # Setup's or the Mapping wizard's Scale or Rooms step: the pull surfaces' trigger, counted once when it is first met.
        was = bool((st.data.get("ai_map_wizard") or {}).get("struggled"))
        w = await async_mark(hass, what, step=msg.get("setup_step"), page=msg.get("page"))
        if w.get("struggled") and not was:
            bump(hass, f"ai_wizard:struggled_{'later' if what == 'step_seen' else 'left'}")
        connection.send_result(msg["id"], {"wizard": w})
        return
    w = await async_mark(hass, what, step=msg.get("step"),
                         **{k: msg[k] for k in ("map_id", "floor_id", "scale_session", "rooms_session") if k in msg})
    connection.send_result(msg["id"], {"wizard": w})


CHECK_OK_S = 3600       # a check that passed is believed this long: Start doesn't pay for a second one
CHECK_WORDS = "This is a connection check. Reply with the single word OK."
CHECK_WHY: tuple[str, ...] = ("ok", "no_credit", "unreachable", "no_media", "error", "not_ready")
# A 1 x 1 white PNG: the one ask path takes a picture, and this one costs next to nothing; no plan is in it.
_TINY_PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478da63f8ffff3f0005fe02fe"
                          "331295140000000049454e44ae426082")


@websocket_api.websocket_command({"type": "padspan_ha/ai_wizard_check_claude"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ai_wizard_check_claude(hass: HomeAssistant, connection, msg) -> None:
    """Before anything is measured or read (owner, 2026-11-12: catch an Anthropic account with no credit before the
    person has spent effort): one tiny read through PadSpan's AI Task with no plan in it, through the one ask path
    (ws_house3d_photo.ask, counted by the AI credit tracker like any read). {ok} or {ok: False, why}: CHECK_WHY. A pass
    is believed for CHECK_OK_S. Counted as ai_wizard_check:<why>."""
    from . import ai_usage as U  # noqa: PLC0415
    from . import ws_house3d_photo as P  # noqa: PLC0415
    from .telemetry import bump  # noqa: PLC0415
    dom = hass.data.setdefault(DOMAIN, {})
    ai = P.ai_task(hass)
    passed = dom.get("_aiw_claude_ok") or {}                 # {AI Task: when it passed}: a pass counts for that AI Task only
    if ai.get("ready") and time.time() - float(passed.get(ai.get("ai_task")) or 0) < CHECK_OK_S:
        connection.send_result(msg["id"], {"ok": True})
        return
    why = "ok"
    if not ai.get("ready"):
        why = "not_ready"
    else:
        try:
            await P.ask(hass, ai["ai_task"], CHECK_WORDS, None, _TINY_PNG, "image/png", task_name="PadSpan rooms helper check", timeout_s=60)
        except Exception as err:  # noqa: BLE001 — said on the screen in the helper's words
            w = U.stop_reason(err, no_media=isinstance(err, P._NoMedia), unreachable=P.unreachable(err))  # noqa: SLF001
            why = w if w in CHECK_WHY else "error"
    if why == "ok":
        dom["_aiw_claude_ok"] = {ai["ai_task"]: time.time()}
    bump(hass, f"ai_wizard_check:{why}")
    connection.send_result(msg["id"], {"ok": why == "ok", **({} if why == "ok" else {"why": why})})


WS_COMMANDS = (ws_ai_wizard_info, ws_ai_wizard_mark, ws_ai_wizard_check_claude)
