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

import re
import time
from datetime import date, datetime
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_PLAN_AI, DATA_SETTINGS, DOMAIN, OUTSIDE_FLOOR_ID
from .telemetry import INSTALL_AGE_WORDS, install_age_word

OFFER_AFTER_DAYS = 7    # a plan this many days old with no rooms is stuck (the field's median stuck house: 18 days)
SCALE_BUILT = False     # piece 3 (the helper sets a plan's scale) turns this on, and no_scale goes
SURFACES: tuple[str, ...] = ("push", "pull")   # push: the Overview (respects Not now / Don't ask again); pull: Setup, the Mapping wizard
REASONS: tuple[str, ...] = ("not_admin", "not_live", "wall_screen", "edition", "has_rooms", "no_plan",
                            "age_unknown", "plan_too_new", "dismissed", "undone", "snoozed",
                            "tool_used", "no_pro_path", "no_scale", "offer")


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
    if f["rooms"] or f["room_bounds"]:
        return "has_rooms"                         # never disturb a house that has rooms
    if not f["indoor_plans"]:
        return "no_plan"
    if f["plan_age_days"] is None:
        return "age_unknown"                       # no plan's `created`, and no first_seen_ts
    if f["plan_age_days"] < OFFER_AFTER_DAYS:
        return "plan_too_new"
    w = f["wizard"]
    if surface == "push" and w.get("dismissed"):
        return "dismissed"
    if w.get("undone"):
        return "undone"
    if surface == "push" and f["now"] < (w.get("snooze_until") or 0):
        return "snoozed"
    if f["tool_used"] and not w.get("started"):
        return "tool_used"                         # someone already found Line up / Rooms from plans
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
WIZARD_STEPS: tuple[str, ...] = ("intro", "trial", "connect", "consent", "scale_read", "scale_check", "scale_guided",
                                 "floor_pick", "rooms_read", "rooms_check", "saved", "next_floor", "handoff")
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
    for k in ("dismissed", "undone", "offered"):
        if raw.get(k) is True:
            out[k] = True
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
    indoor = [m for m in _maps(s) if str(m.get("floor_id") or "") != OUTSIDE_FLOOR_ID]
    created = [t for t in (_ts(m.get("created")) for m in indoor) if t is not None]
    seen = settings.get("first_seen_ts")
    plan_since = min(created) if created else None
    since = plan_since if plan_since is not None else (float(seen) if isinstance(seen, (int, float)) and not isinstance(seen, bool) and seen > 0 else None)
    plan_ai = getattr(dom.get(DATA_PLAN_AI), "data", None) or {}
    tier = hass_tier(hass)
    w = settings.get("ai_map_wizard")
    return {"admin": admin, "live": settings.get("data_mode") == "live" and live is not False, "kiosk": kiosk,
            "edition": edition(), "rooms": has_fabric_rooms(s), "room_bounds": any(len(m.get("room_bounds") or {}) > 0 for m in _maps(s)),
            "indoor_plans": len(indoor), "plan_since": plan_since, "plan_age_days": None if since is None else max(0.0, (now - since) / 86400),
            "wizard": w if isinstance(w, dict) else {}, "now": now,
            "tool_used": bool(plan_ai.get("lineups") or plan_ai.get("rooms")),
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


@websocket_api.websocket_command({
    "type": "padspan_ha/ai_wizard_info",
    vol.Optional("surface", default="push"): vol.In(SURFACES),
    vol.Optional("kiosk", default=False): bool,
    vol.Optional("live"): bool,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_ai_wizard_info(hass: HomeAssistant, connection, msg) -> None:
    """{reason, offer}: the rule's answer for this screen. Nothing calls it yet (piece 1)."""
    from .plan_ai import async_get_store  # noqa: PLC0415
    await async_get_store(hass)                    # "tool_used" reads its sessions
    reason = offer_reason(facts(hass, kiosk=msg["kiosk"], live=msg.get("live")), msg["surface"])
    connection.send_result(msg["id"], {"reason": reason, "offer": reason == "offer"})


WS_COMMANDS = (ws_ai_wizard_info,)
