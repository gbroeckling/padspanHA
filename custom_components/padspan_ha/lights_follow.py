# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Lights follow people (2026-11-23, free, off by default).

The owner's words: "A built-in option, off by default, that turns a room's
lights on when a tracked person enters and off after the room has been empty
for a set time. Per room: which lights, the off delay, optional 'only when
dark' (sun or a lux sensor), optional quiet hours. Per person: include or
exclude (guests' tags excluded by default). It must never fight a manual
switch: if someone turns a light off by hand while in the room, leave it off
until they leave and come back."

Off (settings.lights_follow_enabled, False by default) nothing here runs: the
presence poll calls in and gets an immediate return, and nothing is kept.

THE PEOPLE are PadSpan's named devices (a phone, a watch, a tag), one person
per name, as the arrive/depart rules and the area sensors know them. Each
counts unless excluded (lights_follow_people {name: False}); a guest tag
(guest_tags.py) counts only when included by name. A keys tag left in the
kitchen keeps the kitchen lit: exclude it.

A ROOM (lights_follow_rooms {room: {...}}) has its lights, its off delay, an
optional "only when dark" (the sun below the horizon, or a light sensor under
a level), optional quiet hours (no turning on inside them; turning off still
happens), and optional motion or occupancy sensors. A person's room is the
one PadSpan shows (after Room Change Delay); when this poll's evidence puts
them in a room with its own sensor reading "on", that room counts at once:
the sensor confirms the entry, so the light does not wait the 20 to 40 s
Room Change Delay takes. Only this feature reads it that way; the room shown
everywhere else is unchanged.

ENTERING (empty -> someone in it): its lights go on, unless held (below), in
quiet hours, or not dark. Only on entering: a light someone turns off later
is not turned back on, and darkness falling while they sit there does not
turn it on either.

EMPTY for the off delay: the lights go off once, and only if a tracked person
was in the room before. A light turned on by hand in a room nobody tracked has
been in is never turned off.

BY HAND: a room's lights going from on to off while a tracked person stays in
it is someone's hand (PadSpan only ever turns lights off in an empty room).
The room is then held: nothing turns its lights on until everyone has left it
for LEAVE_S, so a walk to the doorway and back is not leaving. After a restart,
or when the feature or a room is first switched on, what each room holds is a
baseline: nothing is switched for it until someone next comes or goes.

Counts for the opt-in report (telemetry LIGHTS_FOLLOW_EVENTS): words only,
never a room, a name or a light.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any

from homeassistant.components import websocket_api

from .const import DATA_SETTINGS, DOMAIN
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

SETTING = "lights_follow_enabled"
ROOMS_KEY = "lights_follow_rooms"
PEOPLE_KEY = "lights_follow_people"
_DATA = "_lights_follow"

DEFAULT_OFF_DELAY_S = 120
OFF_DELAY_MAX_S = 3600
LEAVE_S = 60.0                  # a room empty this long has been left: a hand's "off" no longer holds it
DEFAULT_LUX_BELOW = 50.0
LUX_MAX = 100000.0
ROOMS_MAX = 64
LIGHTS_MAX = 24
SENSORS_MAX = 8
NAME_MAX = 80
DARK_CHOICES = ("", "sun", "lux")
_LIGHT_RE = re.compile(r"^(light|switch)\.[a-z0-9_]+$")
_SENSOR_RE = re.compile(r"^binary_sensor\.[a-z0-9_]+$")
_LUX_RE = re.compile(r"^sensor\.[a-z0-9_]+$")
_NOT_ROOMS = frozenset({"", "unknown", "unavailable", "not home", "not_home", "home", "away"})
SENSOR_CLASSES = ("motion", "occupancy", "presence")


# ── settings ────────────────────────────────────────────────────────────────

def enabled(hass: Any) -> bool:
    st = (getattr(hass, "data", None) or {}).get(DOMAIN, {}).get(DATA_SETTINGS)
    return bool(st and (st.data or {}).get(SETTING))


def _ids(raw: Any, pattern: re.Pattern, most: int) -> list[str]:
    out: list[str] = []
    for v in raw if isinstance(raw, list) else []:
        s = str(v).strip() if isinstance(v, str) else ""
        if pattern.match(s) and s not in out:
            out.append(s)
    return out[:most]


def _quiet_ok(spec: Any) -> str:
    from .guest_tags import valid_quiet  # noqa: PLC0415
    s = str(spec or "").strip() if isinstance(spec, str) else ""
    return s if s and valid_quiet(s) else ""


def clean_room(raw: Any) -> dict[str, Any] | None:
    """One room's settings as kept, or None when it has no light to switch."""
    if not isinstance(raw, dict):
        return None
    lights = _ids(raw.get("lights"), _LIGHT_RE, LIGHTS_MAX)
    if not lights:
        return None
    try:
        delay = int(round(float(raw.get("off_delay_s", DEFAULT_OFF_DELAY_S))))
    except (TypeError, ValueError, OverflowError):
        delay = DEFAULT_OFF_DELAY_S
    dark = raw.get("dark") if raw.get("dark") in DARK_CHOICES else ""
    lux_entity = str(raw.get("lux_entity") or "").strip()
    lux_entity = lux_entity if _LUX_RE.match(lux_entity) else ""
    if dark == "lux" and not lux_entity:
        dark = ""
    try:
        lux_below = float(raw.get("lux_below", DEFAULT_LUX_BELOW))
        if lux_below != lux_below:
            raise ValueError
    except (TypeError, ValueError, OverflowError):
        lux_below = DEFAULT_LUX_BELOW
    return {
        "lights": lights,
        "off_delay_s": max(0, min(OFF_DELAY_MAX_S, delay)),
        "dark": dark,
        "lux_entity": lux_entity,
        "lux_below": max(0.0, min(LUX_MAX, lux_below)),
        "quiet": _quiet_ok(raw.get("quiet")),
        "sensors": _ids(raw.get("sensors"), _SENSOR_RE, SENSORS_MAX),
    }


def clean_rooms(raw: Any) -> dict[str, dict[str, Any]]:
    """What settings_set keeps of a lights_follow_rooms write: each room by
    its name, with at least one light; anything else dropped. {} = no room."""
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(raw, dict):
        return out
    for name, cfg in raw.items():
        if not isinstance(name, str) or not name.strip() or len(out) >= ROOMS_MAX:
            continue
        room = clean_room(cfg)
        if room is not None:
            out[name.strip()[:NAME_MAX]] = room
    return out


def clean_people(raw: Any) -> dict[str, bool]:
    """What settings_set keeps of a lights_follow_people write: a name (lower
    case) and whether it counts. A name not here counts, unless a guest tag."""
    out: dict[str, bool] = {}
    if not isinstance(raw, dict):
        return out
    for name, inc in raw.items():
        key = person_of(name)
        if key and isinstance(inc, bool) and len(out) < 500:
            out[key] = inc
    return out


def _settings(hass: Any) -> dict[str, Any]:
    st = (getattr(hass, "data", None) or {}).get(DOMAIN, {}).get(DATA_SETTINGS)
    return (st.data if st else None) or {}


# ── who is where (pure) ─────────────────────────────────────────────────────

def person_of(label: Any) -> str:
    return str(label).strip().lower()[:NAME_MAX] if isinstance(label, str) else ""


def counts(person: str, people: dict[str, bool], guest: bool) -> bool:
    """Does this person turn lights on: their own choice, else everyone but a guest tag."""
    return people[person] if person in people else not guest


def _room_key(name: Any) -> str:
    return " ".join(str(name or "").lower().replace("_", " ").replace("-", " ").split())


def who_is_where(result: dict[str, Any], present: set[str], people: dict[str, bool], guest_keys: set[str],
                 rooms: dict[str, dict], candidates: dict[str, str | None] | None = None,
                 sensor_on: Any = None) -> tuple[dict[str, set[str]], set[str]]:
    """({configured room: the people in it}, the rooms someone is in only by a
    sensor's confirmation). A person's room: the room PadSpan shows, or this
    poll's room when that room's own motion or occupancy sensor is on."""
    by_key = {_room_key(r): r for r in rooms}
    inside: dict[str, set[str]] = {}
    seen_shown: dict[str, set[str]] = {}
    fast: set[str] = set()
    for key in present:
        obj = result.get(key)
        if not isinstance(obj, dict) or obj.get("_stale") or obj.get("_ghost") or obj.get("away"):
            continue
        person = person_of(obj.get("user_label"))
        if not person or not counts(person, people, key in guest_keys):
            continue
        shown = obj.get("room") if isinstance(obj.get("room"), str) else ""
        room = by_key.get(_room_key(shown)) if _room_key(shown) not in _NOT_ROOMS else None
        cand = (candidates or {}).get(key)
        cand_room = by_key.get(_room_key(cand)) if isinstance(cand, str) else None
        if (cand_room and cand_room != room and sensor_on is not None
                and any(sensor_on(s) for s in rooms[cand_room].get("sensors") or [])):
            fast.add(cand_room)
            room = cand_room
        elif room:
            seen_shown.setdefault(room, set()).add(person)
        if room:
            inside.setdefault(room, set()).add(person)
    return inside, fast - set(seen_shown)


def new_room_state(occupied: bool, lights_on: bool | None) -> dict[str, Any]:
    """A baseline: nothing is switched for what a room holds when first seen."""
    return {"occupied": occupied, "empty_since": None, "off_done": True, "hold": False, "was_on": lights_on}


def step_room(st: dict[str, Any], occupied: bool, lights_on: bool | None, now: float, *,
              off_delay_s: float, dark: bool, quiet: bool) -> tuple[str | None, list[str]]:
    """Advance one room by one poll: ("on" / "off" / None, what happened).
    lights_on: any of its lights on now (None: none of them can be read)."""
    events: list[str] = []
    action: str | None = None
    was = bool(st.get("occupied"))
    if was and occupied and st.get("was_on") is True and lights_on is False and not st.get("hold"):
        st["hold"] = True                    # turned off by hand with someone in the room
        events.append("manual_hold")
    if occupied:
        st["empty_since"] = None
        if not was:
            st["off_done"] = False
            if st.get("hold"):
                events.append("held")
            elif quiet:
                events.append("skip_quiet")
            elif not dark:
                events.append("skip_daylight")
            elif lights_on is not True:
                action = "on"
    else:
        if was:
            st["empty_since"] = now
            st["off_done"] = False
        since = st.get("empty_since")
        if since is not None:
            if st.get("hold") and now - since >= LEAVE_S:
                st["hold"] = False
            if not st.get("off_done") and now - since >= off_delay_s:
                st["off_done"] = True
                if lights_on is True:
                    action = "off"
    st["occupied"] = occupied
    st["was_on"] = lights_on
    return action, events


# ── Home Assistant ──────────────────────────────────────────────────────────

def _state(hass: Any, eid: str) -> str | None:
    st = hass.states.get(eid)
    return getattr(st, "state", None) if st is not None else None


def _targets(hass: Any, lights: list[str]) -> list[str]:
    """Each light as PadSpan switches it (a power team's member as its team), once."""
    try:
        from .power_team import team_light_of  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        _quiet_error("lights_follow:team_light_of")
        return list(lights)
    out: list[str] = []
    for eid in lights:
        t = team_light_of(hass, eid)
        if t not in out:
            out.append(t)
    return out


def lights_state(hass: Any, targets: list[str]) -> bool | None:
    states = [_state(hass, t) for t in targets]
    if any(s == "on" for s in states):
        return True
    return False if any(s == "off" for s in states) else None


def is_dark(hass: Any, cfg: dict[str, Any]) -> bool:
    """Dark enough for this room. Not asked: always. A sun or light sensor that
    cannot be read counts as dark: a light on in daylight beats a dark room."""
    mode = cfg.get("dark") or ""
    if mode == "sun":
        return _state(hass, "sun.sun") != "above_horizon"
    if mode == "lux":
        try:
            return float(_state(hass, cfg.get("lux_entity") or "")) < float(cfg.get("lux_below", DEFAULT_LUX_BELOW))
        except (TypeError, ValueError):
            return True
    return True


def _quiet(cfg: dict[str, Any], at_local: Any) -> bool:
    spec = cfg.get("quiet") or ""
    if not spec:
        return False
    from .guest_tags import quiet_now  # noqa: PLC0415
    return quiet_now(spec, at_local)


def guest_keys(hass: Any, result: dict[str, Any]) -> set[str]:
    """The poll's keys that are a guest tag (marked in Guests, lent or not)."""
    try:
        from .guest_tags import enabled as _guests_on, store_if_loaded, tag_objects  # noqa: PLC0415
        st = store_if_loaded(hass)
        if st is None or not _guests_on(hass):
            return set()
        out: set[str] = set()
        for tag in st.tags().values():
            out |= {k for k, _o in tag_objects(tag, result)}
        return out
    except Exception:  # noqa: BLE001
        _quiet_error("lights_follow:guest_keys")
        return set()


def _bump(hass: Any, word: str) -> None:
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, f"lights_follow:{word}")
    except Exception:  # noqa: BLE001
        _quiet_error("lights_follow:bump")


async def async_poll(hass: Any, result: dict[str, Any], present: set[str],
                     last_candidate: dict[str, dict] | None = None, now: float | None = None) -> None:
    """Called by the presence poll with its result and each key's room this
    poll (the coordinator's _last_candidate). Nothing while off."""
    dom = hass.data.setdefault(DOMAIN, {})
    if not enabled(hass):
        dom.pop(_DATA, None)
        return
    settings = _settings(hass)
    rooms = clean_rooms(settings.get(ROOMS_KEY))
    mem = dom.setdefault(_DATA, {"rooms": {}, "inside": {}, "day": ""})
    if not rooms:
        mem["rooms"].clear()
        mem["inside"] = {}
        return
    now = time.monotonic() if now is None else now
    from homeassistant.util import dt as dt_util  # noqa: PLC0415
    at_local = dt_util.now()
    day = at_local.date().isoformat()
    if mem.get("day") != day:
        mem["day"] = day
        _bump(hass, "on_today")
    people = clean_people(settings.get(PEOPLE_KEY))
    candidates = {k: (last_candidate.get(k) or {}).get("candidate") for k in present} if last_candidate else {}
    inside, fast = who_is_where(result, present, people, guest_keys(hass, result), rooms, candidates,
                                lambda eid: _state(hass, eid) == "on")
    mem["inside"] = {r: sorted(p) for r, p in inside.items()}
    states: dict[str, dict] = mem["rooms"]
    for gone in set(states) - set(rooms):
        states.pop(gone, None)
    for room, cfg in rooms.items():
        targets = _targets(hass, cfg["lights"])
        on = lights_state(hass, targets)
        occupied = bool(inside.get(room))
        st = states.get(room)
        if st is None:
            states[room] = new_room_state(occupied, on)
            continue
        action, events = step_room(st, occupied, on, now, off_delay_s=cfg["off_delay_s"],
                                   dark=is_dark(hass, cfg), quiet=_quiet(cfg, at_local))
        for word in events:
            _bump(hass, word)
        if action is None:
            continue
        want = action == "on"
        if want and room in fast:
            _bump(hass, "sensor_entry")
        switched = await _async_switch_room(hass, targets, want)
        _bump(hass, ("lit" if want else "off_empty") if switched else "failed")


async def _async_switch_room(hass: Any, targets: list[str], on: bool) -> bool:
    """Each light that is not already as wanted (an unavailable one is left). True if every call went."""
    from .power_team import async_switch  # noqa: PLC0415
    ok = True
    for eid in targets:
        s = _state(hass, eid)
        if s in (None, "unavailable") or (s == "on") == on:
            continue
        try:
            await async_switch(hass, eid, on, source="lights_follow")
        except Exception as err:  # noqa: BLE001 — one light that fails leaves the rest switched
            ok = False
            _LOGGER.warning("Lights follow people: could not turn %s %s: %s", eid, "on" if on else "off", err)
    return ok


# ── the panel ───────────────────────────────────────────────────────────────

def _area_entities(hass: Any) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """({area name: its lights}, {area name: its motion, occupancy and presence sensors}),
    from Home Assistant's registries: what a newly added room starts with."""
    lights: dict[str, list[str]] = {}
    sensors: dict[str, list[str]] = {}
    try:
        from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
        from homeassistant.helpers import device_registry as dr  # noqa: PLC0415
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        names = {a.id: a.name for a in ar.async_get(hass).async_list_areas()}
        devs = dr.async_get(hass)
        for e in er.async_get(hass).entities.values():
            if e.disabled_by:
                continue
            area = e.area_id
            if not area and e.device_id:
                d = devs.async_get(e.device_id)
                area = d.area_id if d is not None else None
            name = names.get(area)
            if not name:
                continue
            if _LIGHT_RE.match(e.entity_id) and e.entity_id.startswith("light."):
                lights.setdefault(name, []).append(e.entity_id)
            elif _SENSOR_RE.match(e.entity_id) and (e.device_class or e.original_device_class) in SENSOR_CLASSES:
                sensors.setdefault(name, []).append(e.entity_id)
    except Exception:  # noqa: BLE001 — registries not ready: nothing to suggest
        _quiet_error("lights_follow:area_entities")
    return ({k: sorted(v) for k, v in lights.items()}, {k: sorted(v) for k, v in sensors.items()})


def _room_names(hass: Any, objects: dict[str, Any]) -> list[str]:
    """The rooms to choose from: the map's, the receivers', where devices are, and Home Assistant's areas."""
    out: dict[str, str] = {}

    def add(r: Any) -> None:
        if isinstance(r, str) and r.strip() and _room_key(r) not in _NOT_ROOMS:
            out.setdefault(_room_key(r), r.strip())

    d = hass.data.get(DOMAIN, {})
    from .const import DATA_MODEL  # noqa: PLC0415
    mdl, pc = d.get(DATA_MODEL), d.get("presence_coordinator")
    sources = (
        lambda: list((mdl.room_geometry_m() or {}).keys()),
        lambda: list((mdl.get_scanner_mappings()[0] or {}).values()),
        lambda: list((getattr(pc, "_last_source_to_area", None) or {}).values()),
        lambda: [o.get("room") for o in objects.values() if isinstance(o, dict)],
    )
    for names in sources:
        try:
            for r in names():
                add(r)
        except Exception:  # noqa: BLE001 — a store not ready: those rooms later
            _quiet_error("lights_follow:room_names")
    try:
        from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
        for a in ar.async_get(hass).async_list_areas():
            add(a.name)
    except Exception:  # noqa: BLE001
        _quiet_error("lights_follow:room_names_areas")
    return sorted(out.values(), key=str.lower)


def status(hass: Any) -> dict[str, Any]:
    """What the Settings card shows: the switch, the rooms to choose from (with
    their area's lights and sensors), each configured room now, and the people."""
    settings = _settings(hass)
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    objects = getattr(pc, "data", None) or {}
    objects = objects if isinstance(objects, dict) else {}
    guests = guest_keys(hass, objects)
    people_cfg = clean_people(settings.get(PEOPLE_KEY))
    people: dict[str, dict[str, Any]] = {}
    for key, o in objects.items():
        if not isinstance(o, dict):
            continue
        p = person_of(o.get("user_label"))
        if not p:
            continue
        row = people.setdefault(p, {"name": str(o.get("user_label")).strip(), "guest": False})
        row["guest"] = row["guest"] or key in guests
    for p in people_cfg:
        people.setdefault(p, {"name": p, "guest": False})
    for p, row in people.items():
        row["counts"] = counts(p, people_cfg, row["guest"])
    mem = hass.data.get(DOMAIN, {}).get(_DATA) or {}
    states, inside = mem.get("rooms") or {}, mem.get("inside") or {}
    rooms = clean_rooms(settings.get(ROOMS_KEY))
    now_rooms = {r: {"people": inside.get(r, []), "held": bool((states.get(r) or {}).get("hold")),
                     "lights_on": lights_state(hass, _targets(hass, cfg["lights"]))} for r, cfg in rooms.items()}
    area_lights, area_sensors = _area_entities(hass)
    return {"enabled": enabled(hass), "rooms": rooms, "now": now_rooms,
            "room_names": _room_names(hass, objects), "area_lights": area_lights, "area_sensors": area_sensors,
            "people": sorted(people.values(), key=lambda r: r["name"].lower())}


@websocket_api.websocket_command({"type": "padspan_ha/lights_follow_get"})
@websocket_api.async_response
async def ws_lights_follow_get(hass: Any, connection: Any, msg: dict[str, Any]) -> None:
    """Lights follow people: the switch, each room's lights and options and who is in it now, and the people."""
    connection.send_result(msg["id"], status(hass))
