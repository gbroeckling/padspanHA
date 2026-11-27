# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Energy, the paid add-on (licence.ADDONS "energy"; the owner, 2026-11-26).

Off by default (settings energy_enabled): while off, or where the add-on is not allowed (PadSpan Pro or an "energy"
key, licence.hass_addon_allowed), nothing here reads Home Assistant, samples or keeps anything, and energy_get
answers {"on": False}. Not sold until the owner publishes it (licence.NOT_ON_SALE).

WHAT IT READS is Home Assistant's own Energy setup, never a copy of it: the energy integration's preferences
(homeassistant.components.energy.data.async_get_manager) and the recorder's statistics. Nothing to import:

    device_consumption  each metered device: stat_consumption (kWh, total_increasing) and stat_rate (its live power),
                        included_in_stat (its parent's stat_consumption: the child is taken out of the parent, so
                        nothing is counted twice)
    the house           the "home" source's stat_rate, else the grid's (signed: + import, - export) plus solar's
    the price           the grid's number_energy_price, else the state of its entity_energy_price
    the currency        Home Assistant's own (hass.config.currency)

A device's room is its entity's area, else its device's area (the stat_rate sensor's, else the stat_consumption
sensor's), matched to the map's rooms by name as the rest of PadSpan matches areas (presence_rules.place_name).

WHAT IT WORKS OUT (async_summary, the panel's padspan_ha/energy_get):
    now        each device's watts from its stat_rate sensor's state, in W from its unit (W or kW). A reading older
               than STALE_S is stale and left out of every total.
    today      kWh per device since local midnight (the recorder's hourly `change`, read at most every STATS_EVERY_S),
               and the cost at the grid's price
    rooms      the devices' watts, kWh and cost by room, each parent less its children
    rest       the whole-house figure less the metered devices, where there is a whole-house figure
    empty      watts in rooms nobody has been in for energy_empty_after_min (PadSpan's own presence: Traceback; and
               the room's own motion / occupancy / presence sensors; with everyone away, every room), leaving out the
               devices on the always-on list (energy_always_on)
    standby    while everyone is out (every HA person away and PadSpan seeing none of their devices) or Vacation Mode is on, the
               house's watts are sampled every SAMPLE_EVERY into a small store of its own; the 1st percentile of them
               is "standby while you're out", with its cost over a year
    health     stale sensors, units that are not W / kW or kWh / Wh, a power sensor and its energy sensor that
               disagree over the day, a child bigger than its parent, a grid figure that exports at night (its sign
               looks inverted), a device with no area

SPIKES (padspan_ha/energy_spikes, an administrator's, and only while energy_spikes_enabled is on: energy data shows a
household's routines): the whole-house power's 5-minute means over the last SPIKE_DAYS days, each point well above the
rolling baseline and above a floor, with who was home and in which room then (Traceback keeps 7 days).

The usage report (telemetry.py env.energy) gets counts only, and only while it is on (report): never watts, kWh or
money, which identify routines.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DATA_MODEL, DATA_SETTINGS, DATA_TRACEBACK, DOMAIN
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

ADDON = "energy"
SETTING = "energy_enabled"
ATLAS_SETTING = "atlas_energy_enabled"
EMPTY_KEY = "energy_empty_after_min"
ALWAYS_ON_KEY = "energy_always_on"
SPIKES_KEY = "energy_spikes_enabled"
DEFAULT_EMPTY_MIN = 15
EMPTY_MIN_MAX = 240
ALWAYS_ON_MAX = 200
CONFIG_URL = "/config/energy"            # Home Assistant's Energy settings

STALE_S = 1800.0                         # a reading older than this is stale: shown as such, in no total
QUIET_W = 1.0                            # below this a device's or a room's watts are not shown on the map
STATS_EVERY_S = 300.0                    # today's kWh read from the recorder at most this often
OCCUPANCY_EVERY_S = 600.0                # Traceback's day read at most this often (its last minutes, from memory, between)
LOOKBACK_S = 86400.0                     # how far back Traceback is read for "empty since"
SEEN_NOW_S = 120.0                       # someone seen in a room this recently is in it now
SAMPLE_EVERY = timedelta(minutes=5)
SAMPLES_DAYS = 14
SAMPLES_MAX = 4032                       # 14 days of 5-minute samples
STANDBY_MIN_SAMPLES = 12                 # an hour out before standby says anything
STANDBY_PCT = 1.0                        # Sense's "always on": the 1 % bin
SUMMARY_EVERY_S = 3600.0                 # the sampler works the summary out this often for the report
MISMATCH_MIN_KWH = 0.2                   # both readings at least this today before they are compared
MISMATCH_RATIO = 2.0                     # one more than twice the other: they disagree
NIGHT_EXPORT_W = 50.0                    # the grid exporting this much with the sun down and no battery
CHILD_SLACK_KWH = 0.05
CHILD_SLACK_W = 5.0
SPIKE_DAYS = 7
SPIKE_FLOOR_W = 1500.0                   # a spike is at least this ...
SPIKE_RISE_W = 1000.0                    # ... this much above the baseline ...
SPIKE_FACTOR = 2.0                       # ... and at least twice it
SPIKE_BASE_N = 12                        # the baseline: the median of the hour before (12 five-minute points)
SPIKES_MAX = 50
SPIKE_FRAMES = 20000                     # Traceback's frames read once for every spike's "who was home"
STORE_KEY = "padspan_ha.energy"
SAVE_DELAY_S = 60.0
_DATA = "_energy"

# Every power and energy unit Home Assistant's own converters know (PowerConverter, EnergyConverter): live power is
# converted to W here, and the recorder hands energy back in kWh whatever the sensor's unit.
POWER_UNITS = {"mW": 0.001, "W": 1.0, "kW": 1000.0, "MW": 1e6, "GW": 1e9, "TW": 1e12}
ENERGY_UNITS = frozenset({"mWh", "Wh", "kWh", "MWh", "GWh", "TWh", "J", "kJ", "MJ", "GJ", "cal", "kcal", "Mcal", "Gcal"})
ISSUE_KINDS: tuple[str, ...] = ("stale", "unit", "mismatch", "child_over_parent", "grid_sign", "no_area", "loop")
OCCUPANCY_CLASSES = ("motion", "occupancy", "presence")


# ── reading what Home Assistant says ────────────────────────────────────────

def _settings(hass: Any) -> dict[str, Any]:
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return (getattr(st, "data", None) or {}) if st else {}


def allowed(hass: Any) -> bool:
    """PadSpan Pro or an "energy" add-on key (licence.hass_addon_allowed)."""
    from .licence import hass_addon_allowed  # noqa: PLC0415
    return hass_addon_allowed(hass, ADDON)


def on(hass: Any) -> bool:
    """Switched on (energy_enabled) where the add-on is allowed."""
    return _settings(hass).get(SETTING) is True and allowed(hass)


def empty_after_s(settings: dict[str, Any]) -> float:
    v = settings.get(EMPTY_KEY)
    m = v if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= EMPTY_MIN_MAX else DEFAULT_EMPTY_MIN
    return float(m) * 60.0


def clean_always_on(raw: Any) -> list[str]:
    """The always-on list as stored: entity ids, each once, in order, at most ALWAYS_ON_MAX."""
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for v in raw:
        e = v.strip().lower() if isinstance(v, str) else ""
        if e.count(".") == 1 and all(p and all(c.isalnum() or c == "_" for c in p) for p in e.split(".")) and e not in out:
            out.append(e)
    return out[:ALWAYS_ON_MAX]


def _ts(v: Any) -> float | None:
    if isinstance(v, datetime):
        return (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).timestamp()
    if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
        return float(v)
    return None


def _num(v: Any) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _attrs(state: Any) -> dict[str, Any]:
    a = getattr(state, "attributes", None)
    return dict(a) if hasattr(a, "get") else {}


def reading(state: Any, now: float) -> dict[str, Any]:
    """A power sensor's reading: {w (None: no number, or not W / kW), age_s, stale, unit_ok, unit}. Its age is from
    when it last reported (last_reported, Home Assistant 2024.3 on), else last changed."""
    if state is None:
        return {"w": None, "age_s": None, "stale": True, "unit_ok": True, "unit": None}
    unit = _attrs(state).get("unit_of_measurement")
    factor = POWER_UNITS.get(unit) if isinstance(unit, str) else None
    value = _num(getattr(state, "state", None))
    at = _ts(getattr(state, "last_reported", None)) or _ts(getattr(state, "last_updated", None))
    age = max(0.0, now - at) if at is not None else None
    stale = value is None or age is None or age > STALE_S
    w = value * factor if value is not None and factor is not None else None
    return {"w": w, "age_s": age, "stale": stale, "unit_ok": factor is not None, "unit": unit}


def devices_of(prefs: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The metered devices in Home Assistant's Energy setup, each once: {id (stat_consumption), rate (stat_rate or
    None), name, parent (included_in_stat or None), loop (its included_in_stat goes round in a circle, A in B and B
    in A: the loop's links are left out, so nothing there is taken out of anything)}."""
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for d in (prefs or {}).get("device_consumption") or []:
        if not isinstance(d, dict):
            continue
        sid = d.get("stat_consumption")
        if not isinstance(sid, str) or not sid or sid in seen:
            continue
        seen.add(sid)
        rate = d.get("stat_rate") if isinstance(d.get("stat_rate"), str) and d.get("stat_rate") else None
        parent = d.get("included_in_stat") if isinstance(d.get("included_in_stat"), str) and d.get("included_in_stat") else None
        name = d.get("name") if isinstance(d.get("name"), str) and d.get("name").strip() else None
        out.append({"id": sid, "rate": rate, "name": name, "parent": parent if parent != sid else None})
    ids = {d["id"] for d in out}
    for d in out:                          # a parent that is not a metered device here is no parent
        d["loop"] = False
        if d["parent"] not in ids:
            d["parent"] = None
    parent = {d["id"]: d["parent"] for d in out}
    looped: set[str] = set()
    for d in out:
        chain, at = [], d["id"]
        while at is not None and at not in chain and at not in looped:
            chain.append(at)
            at = parent.get(at)
        if at is not None and at in chain:                 # came back round: the chain from `at` on is a loop
            looped.update(chain[chain.index(at):])
    for d in out:
        if d["id"] in looped:
            d["parent"], d["loop"] = None, True
    return out


def sources_of(prefs: dict[str, Any] | None) -> dict[str, Any]:
    """The whole-house figure's sensors: {home, grid, solar, battery_rate: [stat_rate], battery: bool (a battery is
    set up, with or without a live figure)}."""
    out: dict[str, Any] = {"home": [], "grid": [], "solar": [], "battery_rate": [], "battery": False}
    for s in (prefs or {}).get("energy_sources") or []:
        if not isinstance(s, dict):
            continue
        kind, rate = s.get("type"), s.get("stat_rate")
        if kind == "battery":
            out["battery"] = True
        if kind in ("home", "grid", "solar", "battery") and isinstance(rate, str) and rate:
            out["battery_rate" if kind == "battery" else kind].append(rate)
    return out


def house_parts(prefs: dict[str, Any] | None, states: Any, now: float) -> dict[str, Any]:
    """The whole-house watts now: the home source, else the grid's signed figure (+ import, - export) plus solar's and
    the battery's (+ discharging). {w, source, stale, parts: [(entity, reading)]}. Any part stale or unreadable: w is
    None and stale True, never a partial sum (a stale solar, or one of two grid connections, would read low)."""
    src = sources_of(prefs)
    ids = src["home"] or src["grid"]
    if not ids:
        return {"w": None, "source": None, "stale": False, "parts": []}
    every = list(ids) if src["home"] else [*src["grid"], *src["solar"], *src["battery_rate"]]
    parts = [(e, reading(states.get(e), now)) for e in every]
    bad = any(p["stale"] or p["w"] is None for _e, p in parts)
    return {"w": None if bad else sum(p["w"] for _e, p in parts),
            "source": None if bad else ("home" if src["home"] else "grid"), "stale": bad, "parts": parts}


def _price_unit_factor(unit: Any) -> float:
    """A price entity's unit to a price per kWh: ".../Wh" x 1000, ".../MWh" / 1000, anything else as it is."""
    u = str(unit or "")
    if u.endswith("/Wh"):
        return 1000.0
    if u.endswith("/MWh"):
        return 0.001
    return 1.0


def price_of(prefs: dict[str, Any] | None, states: Any) -> float | None:
    """The grid's price per kWh: number_energy_price, else the state of entity_energy_price; the first grid source
    with either (one per connection since 2026.3, or the older flow_from list)."""
    for s in (prefs or {}).get("energy_sources") or []:
        if not isinstance(s, dict) or s.get("type") != "grid":
            continue
        for f in [s, *[x for x in (s.get("flow_from") or []) if isinstance(x, dict)]]:
            n = _num(f.get("number_energy_price")) if f.get("number_energy_price") is not None else None
            if n is not None and n >= 0:
                return n
            eid = f.get("entity_energy_price")
            if isinstance(eid, str) and eid:
                st = states.get(eid) if states is not None else None
                v = _num(getattr(st, "state", None))
                if v is not None and v >= 0:
                    return v * _price_unit_factor(_attrs(st).get("unit_of_measurement"))
    return None


def set_up(prefs: dict[str, Any] | None) -> bool:
    """Whether Home Assistant's Energy is set up: anything metered, or a source with a live figure."""
    s = sources_of(prefs)
    return bool(devices_of(prefs) or s["home"] or s["grid"] or s["solar"])


# ── rooms and presence ──────────────────────────────────────────────────────

def _key(name: Any) -> str:
    from .presence_rules import place_name  # noqa: PLC0415
    return place_name(name)


def empty_spans(occupied: list[tuple[float, float]], start: float, end: float) -> list[tuple[float, float]]:
    from .traceback_store import empty_spans as _spans  # noqa: PLC0415
    return _spans(occupied, start, end)


def room_occupancy(rooms: list[str], trace: dict[str, list[tuple[float, float]]] | None, trace_start: float,
                   sensors: dict[str, list[tuple[bool, float | None]]], away_since: float | None, now: float,
                   after_s: float, day_start: float, receivers: Any = ()) -> dict[str, dict[str, Any]]:
    """{room key: {occupied, since (empty since; None while occupied), empty (seconds empty now, 0 while occupied),
    spans (today's stretches the room counted as empty: each gap less its first after_s)}} for each room something
    is known about. Pure.

    trace: Traceback's occupied stretches since trace_start by room key (None: PadSpan's presence is not in use
    here, no scanners); through it a room is known only where PadSpan can see someone, as Yesterday at home reads it:
    a receiver's room (receivers, by name) or a room Traceback saw someone in. Any other room (a garage with no
    receiver, an area off the map) is known only by its own sensors or by everyone being away; sensors: each room's motion / occupancy / presence sensors as (on, last changed); away_since:
    when everyone went out (every HA person away and PadSpan seeing none of their devices), else None. A room nothing is known about
    is left out: it never counts as empty."""
    out: dict[str, dict[str, Any]] = {}
    seeable = {_key(r) for r in receivers or ()} | set(trace or {})
    for room in rooms:
        k = _key(room)
        known, occupied, last = False, False, None
        occ: list[tuple[float, float]] = []
        start = None
        if trace is not None and k in seeable:
            known, start = True, trace_start
            spans = trace.get(k) or []
            occ.extend(spans)
            ends = [e for _s, e in spans]
            if ends:
                last = max(ends)
                occupied = now - last <= SEEN_NOW_S
        for is_on, changed in sensors.get(k) or []:
            known = True
            if is_on:
                occupied = True
                occ.append((changed if changed is not None else now, now))
            elif changed is not None:
                last = changed if last is None else max(last, changed)
                occ.append((changed, changed))
                start = changed if start is None else min(start, changed)
        if not known and away_since is not None:
            known, last, start = True, away_since, away_since
        if not known:
            continue
        if occupied:
            out[k] = {"occupied": True, "since": None, "empty": 0.0, "spans": []}
            continue
        since = last if last is not None else start
        gaps = empty_spans(occ, start, now) if start is not None else []
        spans = []
        for s, e in gaps:
            s2 = max(s + after_s, day_start)
            if e > s2:
                spans.append((s2, e))
        out[k] = {"occupied": False, "since": since, "empty": max(0.0, now - since) if since is not None else 0.0,
                  "spans": spans}
    return out


def kwh_in_spans(hourly: list[tuple], spans: list[tuple[float, float]]) -> float:
    """The kWh of each bucket (start, kWh[, seconds long: an hour unless said]) in proportion to how much of it the
    spans cover."""
    total = 0.0
    for b in hourly:
        start, kwh, dur = b[0], b[1], (b[2] if len(b) > 2 else 3600.0)
        cover = sum(max(0.0, min(start + dur, e) - max(start, s)) for s, e in spans)
        total += kwh * min(1.0, cover / dur) if dur > 0 else 0.0
    return total


# ── the summary ─────────────────────────────────────────────────────────────

def _own(devs: list[dict[str, Any]], field: str) -> dict[str, float | None]:
    """Each device's own figure: its own less its children's (None stays None; a child's None counts as 0)."""
    kids: dict[str, float] = {}
    for d in devs:
        if d["parent"] and isinstance(d.get(field), (int, float)):
            kids[d["parent"]] = kids.get(d["parent"], 0.0) + float(d[field])
    out: dict[str, float | None] = {}
    for d in devs:
        v = d.get(field)
        out[d["id"]] = None if v is None else max(0.0, float(v) - kids.get(d["id"], 0.0))
    return out


def _own_hourly(devs: list[dict[str, Any]], hourly: dict[str, list[tuple]]) -> dict[str, list[tuple]]:
    kids: dict[str, dict[float, float]] = {}
    for d in devs:
        if d["parent"]:
            row = kids.setdefault(d["parent"], {})
            for b in hourly.get(d["id"]) or []:
                row[b[0]] = row.get(b[0], 0.0) + b[1]
    return {d["id"]: [(b[0], max(0.0, b[1] - kids.get(d["id"], {}).get(b[0], 0.0)), *b[2:])
                      for b in hourly.get(d["id"]) or []] for d in devs}


def compute(f: dict[str, Any]) -> dict[str, Any]:
    """The summary energy_get answers, from what async_summary gathered (f). Pure. f:
        prefs, states (eid -> state, with .get), now, day_start, settings, currency
        areas        {entity id: (area name or None, device id or None)}
        rooms        the map's room names
        kwh          {stat_consumption: kWh today}; hourly {stat_consumption: [(hour start, kWh)]}
        power_kwh    {stat_rate: kWh today from its 5-minute means}
        occupancy    room_occupancy's answer (room key -> ...), source ("padspan", "sensors", "away" or None)
        sun_below    the sun is below the horizon now
        samples      [(ts, W)] standby samples"""
    prefs, states, now = f.get("prefs"), f.get("states") or {}, float(f["now"])
    settings = f.get("settings") or {}
    devs = devices_of(prefs)
    src = sources_of(prefs)
    price = price_of(prefs, states)
    always = set(clean_always_on(settings.get(ALWAYS_ON_KEY)))
    areas, kwh, hourly, pkwh = f.get("areas") or {}, f.get("kwh") or {}, f.get("hourly") or {}, f.get("power_kwh") or {}
    map_rooms = {_key(r): r for r in f.get("rooms") or []}
    issues: list[dict[str, Any]] = []

    def issue(kind: str, entity: str, **more: Any) -> None:
        issues.append({"kind": kind, "entity": entity, **more})

    rows: list[dict[str, Any]] = []
    for d in devs:
        r = reading(states.get(d["rate"]) if d["rate"] else None, now) if d["rate"] else None
        cons = states.get(d["id"])
        area, dev_id = (areas.get(d["rate"]) if d["rate"] else None) or (None, None)
        if not area:
            area, dev_id2 = areas.get(d["id"]) or (None, None)
            dev_id = dev_id or dev_id2
        elif not dev_id:
            dev_id = (areas.get(d["id"]) or (None, None))[1]
        room = map_rooms.get(_key(area)) if area else None
        name = d["name"] or str(_attrs(states.get(d["rate"]) if d["rate"] else None).get("friendly_name") or "") \
            or str(_attrs(cons).get("friendly_name") or "") or d["id"]
        w = r["w"] if r and not r["stale"] else None
        k = kwh.get(d["id"])
        rows.append({"id": d["id"], "rate": d["rate"], "name": name, "parent": d["parent"], "area": area,
                     "room": room or area, "on_map": room is not None, "device_id": dev_id,
                     "w": w, "kwh": k, "stale": bool(r and r["stale"]), "age_s": r["age_s"] if r else None,
                     "always_on": d["id"] in always or (d["rate"] or "") in always})
        if r and r["stale"]:
            issue("stale", d["rate"], age_s=r["age_s"])
        if r and r["w"] is None and _num(getattr(states.get(d["rate"]), "state", None)) is not None and not r["unit_ok"]:
            issue("unit", d["rate"], unit=r["unit"])
        cu = _attrs(cons).get("unit_of_measurement") if cons is not None else None
        if cons is not None and cu not in ENERGY_UNITS:
            issue("unit", d["id"], unit=cu)
        if not area:
            issue("no_area", d["rate"] or d["id"])
        if d.get("loop"):
            issue("loop", d["id"])
        pk = pkwh.get(d["rate"]) if d["rate"] else None
        if isinstance(k, (int, float)) and isinstance(pk, (int, float)) and max(k, pk) >= MISMATCH_MIN_KWH:
            lo, hi = min(k, pk), max(k, pk)
            if lo <= 0 or hi / lo > MISMATCH_RATIO:
                issue("mismatch", d["id"], power=d["rate"], kwh=round(float(k), 2), power_kwh=round(float(pk), 2))
    by_id = {r["id"]: r for r in rows}
    for r in rows:
        p = by_id.get(r["parent"]) if r["parent"] else None
        if p is None:
            continue
        over_kwh = isinstance(r["kwh"], (int, float)) and isinstance(p["kwh"], (int, float)) \
            and r["kwh"] > p["kwh"] * 1.05 + CHILD_SLACK_KWH
        over_w = isinstance(r["w"], (int, float)) and isinstance(p["w"], (int, float)) and r["w"] > p["w"] + CHILD_SLACK_W
        if over_kwh or over_w:
            issue("child_over_parent", r["id"], parent=p["id"])
    own_w, own_kwh = _own(rows, "w"), _own(rows, "kwh")
    own_hourly = _own_hourly(rows, hourly)
    for r in rows:
        r["own_w"], r["own_kwh"] = own_w[r["id"]], own_kwh[r["id"]]
        r["cost"] = round(r["own_kwh"] * price, 4) if price is not None and r["own_kwh"] is not None else None

    # The house (house_parts): the home source, else the grid plus solar plus the battery; none from a stale part.
    hp = house_parts(prefs, states, now)
    house_w, house_src, house_stale = hp["w"], hp["source"], hp["stale"]
    for e, p in hp["parts"]:
        if p["stale"]:
            issue("stale", e, age_s=p["age_s"])
        elif p["w"] is None and not p["unit_ok"]:
            issue("unit", e, unit=p["unit"])
    # The grid's sign: exporting at night with no battery can't be (solar makes nothing then). A sign the wrong way
    # round reads as export.
    if f.get("sun_below") and not src["battery"]:
        for e in src["grid"]:
            p = reading(states.get(e), now)
            if not p["stale"] and p["w"] is not None and p["w"] < -NIGHT_EXPORT_W:
                issue("grid_sign", e, w=round(p["w"]))
    metered = sum(r["own_w"] for r in rows if r["own_w"] is not None)
    rest = max(0.0, house_w - metered) if house_w is not None else None

    # Rooms.
    occ = f.get("occupancy") or {}
    after_s = empty_after_s(settings)
    rooms: dict[str, dict[str, Any]] = {}
    for r in rows:
        if not r["room"]:
            continue
        g = rooms.setdefault(r["room"], {"room": r["room"], "on_map": r["on_map"], "w": 0.0, "kwh": 0.0, "metered": 0,
                                         "devices": [], "stale": 0})
        g["devices"].append(r["id"])
        g["metered"] += 1
        g["stale"] += 1 if r["stale"] else 0
        g["w"] += r["own_w"] or 0.0
        g["kwh"] += r["own_kwh"] or 0.0
    empty_rows = []
    for g in rooms.values():
        g["cost"] = round(g["kwh"] * price, 4) if price is not None else None
        o = occ.get(_key(g["room"]))
        g["occupied"] = None if o is None else o["occupied"]
        g["empty"] = None
        if o is None or o["occupied"] or o["empty"] < after_s:
            continue
        mine = [by_id[i] for i in g["devices"] if not by_id[i]["always_on"]]
        ew = sum(x["own_w"] for x in mine if x["own_w"] is not None)
        ek = sum(kwh_in_spans(own_hourly.get(x["id"]) or [], o["spans"]) for x in mine)
        if ew < QUIET_W and ek <= 0:
            continue
        g["empty"] = {"since": o["since"], "for_s": round(o["empty"]), "w": round(ew, 1), "kwh": round(ek, 3),
                      "cost": round(ek * price, 4) if price is not None else None}
        empty_rows.append({"room": g["room"], **g["empty"]})
    for g in rooms.values():
        g["w"], g["kwh"] = round(g["w"], 1), round(g["kwh"], 3)
    empty_rows.sort(key=lambda e: -e["w"])

    samples = f.get("samples") or []
    sw = standby_w(samples, now)
    standby = None
    if sw is not None:
        standby = {"w": round(sw, 1), "samples": len(samples),
                   "year_kwh": round(sw / 1000.0 * 8760.0, 1),
                   "year_cost": round(sw / 1000.0 * 8760.0 * price, 2) if price is not None else None}
    for r in rows:
        for k2 in ("w", "own_w"):
            if r[k2] is not None:
                r[k2] = round(r[k2], 1)
        for k2 in ("kwh", "own_kwh"):
            if isinstance(r[k2], (int, float)):
                r[k2] = round(float(r[k2]), 3)
    return {
        "on": True, "allowed": True, "set_up": set_up(prefs), "config_url": CONFIG_URL,
        "currency": f.get("currency") or None, "price": price, "now": now,
        "stale_after_s": STALE_S, "quiet_w": QUIET_W,
        "house": {"w": round(house_w, 1) if house_w is not None else None, "source": house_src, "stale": house_stale,
                  "metered_w": round(metered, 1), "rest_w": round(rest, 1) if rest is not None else None},
        # Today across every metered device (each parent less its children): the house's metered total.
        "today": {"kwh": round(sum(r["own_kwh"] for r in rows if isinstance(r["own_kwh"], (int, float))), 3),
                  "cost": round(sum(r["own_kwh"] for r in rows if isinstance(r["own_kwh"], (int, float))) * price, 4)
                  if price is not None else None},
        "rooms": sorted(rooms.values(), key=lambda g: (-g["w"], g["room"])),
        "devices": rows,
        "empty": {"w": round(sum(e["w"] for e in empty_rows), 1), "rooms": empty_rows,
                  "after_min": int(after_s // 60), "source": f.get("occupancy_source")},
        "standby": standby,
        "issues": issues,
    }


def standby_w(samples: list[Any], now: float) -> float | None:
    """The STANDBY_PCT percentile of the samples of the last SAMPLES_DAYS days, once there are STANDBY_MIN_SAMPLES."""
    cut = now - SAMPLES_DAYS * 86400.0
    vals = sorted(float(w) for t, w in (s for s in samples if isinstance(s, (list, tuple)) and len(s) == 2)
                  if isinstance(t, (int, float)) and t >= cut and isinstance(w, (int, float)) and math.isfinite(w))
    if len(vals) < STANDBY_MIN_SAMPLES:
        return None
    i = max(0, min(len(vals) - 1, int(math.floor(STANDBY_PCT / 100.0 * len(vals)))))
    return max(0.0, vals[i])


def house_w(prefs: dict[str, Any] | None, states: Any, now: float) -> float | None:
    """The whole-house watts now (compute's figure), or None (no figure, or a part of it stale)."""
    return house_parts(prefs, states, now)["w"]


# ── spikes ──────────────────────────────────────────────────────────────────

def find_spikes(series: list[tuple[float, float]]) -> list[dict[str, Any]]:
    """[{ts, w, baseline}] newest first: each run of 5-minute points well above the median of the hour before (by
    SPIKE_RISE_W and SPIKE_FACTOR times) and above SPIKE_FLOOR_W, as its highest point. Pure."""
    pts = sorted((float(t), float(w)) for t, w in series if math.isfinite(w))
    out: list[dict[str, Any]] = []
    run: dict[str, Any] | None = None
    for i, (t, w) in enumerate(pts):
        before = sorted(x for _t, x in pts[max(0, i - SPIKE_BASE_N):i])
        base = before[len(before) // 2] if before else None
        high = base is not None and w >= SPIKE_FLOOR_W and w - base >= SPIKE_RISE_W and w >= base * SPIKE_FACTOR
        if high and run is not None and t - run["last"] <= 600:
            run["last"] = t
            if w > run["w"]:
                run.update(ts=t, w=w)
            continue
        if run is not None:
            out.append(run)
            run = None
        if high:
            run = {"ts": t, "w": w, "baseline": base, "last": t}
    if run is not None:
        out.append(run)
    return [{"ts": r["ts"], "w": round(r["w"]), "baseline": round(r["baseline"])}
            for r in sorted(out, key=lambda r: -r["ts"])][:SPIKES_MAX]


def who_at(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """[{name, rooms}] from Traceback's frames: each named device and the rooms it was in, in the order seen. Pure."""
    seen: dict[str, list[str]] = {}
    for fr in frames or []:
        for o in (fr or {}).get("o") or []:
            name, room = o.get("n"), o.get("r")
            if not isinstance(name, str) or not name:
                continue
            rooms = seen.setdefault(name, [])
            if isinstance(room, str) and room and room not in rooms:
                rooms.append(room)
    return [{"name": n, "rooms": r} for n, r in seen.items()]


def traceback_link(ts: float) -> str:
    """Traceback around a moment (panel.js ?view=traceback&from=&to=, epoch seconds)."""
    return f"/padspan-ha?view=traceback&from={int(ts - 600)}&to={int(ts + 900)}"


# ── Home Assistant: prefs, statistics, registries, presence ─────────────────

async def _async_prefs(hass: Any) -> dict[str, Any] | None:
    """Home Assistant's Energy preferences, or None (not set up, or the energy integration is not there)."""
    try:
        from homeassistant.components.energy.data import async_get_manager  # noqa: PLC0415
        mgr = await async_get_manager(hass)
    except Exception:  # noqa: BLE001 — no energy integration: Energy is not set up
        _quiet_error("energy:prefs")
        return None
    data = getattr(mgr, "data", None)
    return data if isinstance(data, dict) else None


def _row_start(row: Any) -> float | None:
    return _ts(row.get("start")) if isinstance(row, dict) else None


async def _async_stats(hass: Any, ids: set[str], start: datetime, end: datetime, period: str,
                       types: set[str]) -> dict[str, list[dict[str, Any]]]:
    """The recorder's statistics, in kWh and W (the recorder converts), read in its own executor."""
    if not ids:
        return {}
    try:
        from homeassistant.components.recorder.statistics import statistics_during_period  # noqa: PLC0415
        from homeassistant.helpers.recorder import get_instance  # noqa: PLC0415
        got = await get_instance(hass).async_add_executor_job(
            statistics_during_period, hass, start, end, set(ids), period, {"energy": "kWh", "power": "W"}, set(types))
    except Exception:  # noqa: BLE001 — no recorder, or it refused: no figures from it
        _quiet_error("energy:stats")
        return {}
    return got if isinstance(got, dict) else {}


def _area_of(hass: Any, eids: set[str]) -> dict[str, tuple[str | None, str | None]]:
    """{entity id: (its area's name, else its device's, or None; its device id or None)}."""
    out: dict[str, tuple[str | None, str | None]] = {}
    try:
        from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
        from homeassistant.helpers import device_registry as dr  # noqa: PLC0415
        from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
        ents, devs, areas = er.async_get(hass), dr.async_get(hass), ar.async_get(hass)
        for eid in eids:
            e = ents.async_get(eid)
            if e is None:
                out[eid] = (None, None)
                continue
            area_id = e.area_id
            if not area_id and e.device_id:
                d = devs.async_get(e.device_id)
                area_id = d.area_id if d is not None else None
            a = areas.async_get_area(area_id) if area_id else None
            out[eid] = (a.name if a is not None else None, e.device_id or None)
    except Exception:  # noqa: BLE001 — registries not ready: no rooms yet
        _quiet_error("energy:areas")
    return out


def _map_rooms(hass: Any) -> list[str]:
    mdl = hass.data.get(DOMAIN, {}).get(DATA_MODEL)
    try:
        return list((mdl.room_geometry_m() or {}).keys()) if mdl is not None else []
    except Exception:  # noqa: BLE001 — the model not ready: no map rooms yet
        _quiet_error("energy:map_rooms")
        return []


def _day_start(hass: Any, now: float) -> float:
    from .presence_coordinator import _house_tz  # noqa: PLC0415
    tz = _house_tz(hass)
    d = datetime.fromtimestamp(now, tz)
    return d.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


def _all_states(hass: Any, domain: str) -> list[Any]:
    try:
        return list(hass.states.async_all(domain))
    except Exception:  # noqa: BLE001
        _quiet_error("energy:states")
        return []


def padspan_person_home(hass: Any) -> bool:
    """PadSpan sees one of the house's people home: a device a Home Assistant person carries (presence_rules.is_carried:
    their phone, their watch), present and in a room. A tag on keys left at home is nobody."""
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    data = getattr(pc, "data", None)
    if not isinstance(data, dict):
        return False
    try:
        from .presence_rules import is_carried  # noqa: PLC0415
        for o in data.values():
            if not isinstance(o, dict) or o.get("away") or o.get("_stale") or o.get("_ghost"):
                continue
            if str(o.get("room") or "") not in ("", "unknown", "not_home") and is_carried(hass, o, data):
                return True
    except Exception:  # noqa: BLE001 — not readable now: Home Assistant's people decide
        _quiet_error("energy:people")
    return False


def away_since(hass: Any, now: float) -> float | None:
    """When everyone went out: every HA person away (at least one person) and PadSpan seeing none of the house's people
    home (padspan_person_home: their own devices, never a tag left at home); then the latest a person left. Else None."""
    people = _all_states(hass, "person")
    if not people or any(str(getattr(p, "state", "")) == "home" for p in people):
        return None
    if padspan_person_home(hass):
        return None
    left = [_ts(getattr(p, "last_changed", None)) for p in people]
    left = [x for x in left if x is not None]
    return max(left) if left else now


def everyone_out(hass: Any, now: float) -> bool:
    """Away standby's moment: everyone out, or Vacation Mode on."""
    return _settings(hass).get("vacation_mode_enabled") is True or away_since(hass, now) is not None


def _receiver_rooms(hass: Any) -> list[str]:
    """Each receiver's room, as the presence poll last mapped them (Yesterday at home reads the same)."""
    pc = hass.data.get(DOMAIN, {}).get("presence_coordinator")
    return sorted({str(r) for r in (getattr(pc, "_last_source_to_area", None) or {}).values() if r})


def _room_sensors(hass: Any, rooms: list[str]) -> dict[str, list[tuple[bool, float | None]]]:
    """Each map room's motion, occupancy and presence binary sensors (by their area) as (on, last changed)."""
    keys = {_key(r) for r in rooms}
    states = [s for s in _all_states(hass, "binary_sensor")
              if _attrs(s).get("device_class") in OCCUPANCY_CLASSES and getattr(s, "state", None) in ("on", "off")]
    areas = _area_of(hass, {s.entity_id for s in states if isinstance(getattr(s, "entity_id", None), str)})
    out: dict[str, list[tuple[bool, float | None]]] = {}
    for s in states:
        area = (areas.get(getattr(s, "entity_id", "")) or (None, None))[0]
        k = _key(area) if area else None
        if k in keys:
            out.setdefault(k, []).append((s.state == "on", _ts(getattr(s, "last_changed", None))))
    return out


async def _async_trace(hass: Any, now: float) -> tuple[dict[str, list[tuple[float, float]]] | None, float]:
    """Traceback's occupied stretches by room key over the last LOOKBACK_S, or None where it holds nothing in that
    time (no scanners: PadSpan's presence is not in use). Read at most every OCCUPANCY_EVERY_S, and then only the
    frames since the last read (a cursor), the stretches older than LOOKBACK_S dropped; one read at a time."""
    mem = _mem(hass)
    tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
    async with mem.setdefault("trace_lock", asyncio.Lock()):
        got = mem.get("trace")
        if not got or now - got["at"] >= OCCUPANCY_EVERY_S:
            start = now - LOOKBACK_S
            frm = max(start, got["at"]) if got else start
            spans = {k: [sp for sp in v if sp[1] >= start] for k, v in (got["spans"] if got else {}).items()}
            if tb is not None:
                try:
                    summ = await tb.async_day_summary(frm, now)
                    for room, sp in (summ.get("occupied") or {}).items():
                        spans.setdefault(_key(room), []).extend((float(a), float(b)) for a, b in sp)
                except Exception:  # noqa: BLE001 — Traceback not readable now: what was read before stands
                    _quiet_error("energy:trace")
            got = mem["trace"] = {"at": now, "spans": {k: v for k, v in spans.items() if v}}
    # Between those reads, who is in which room now from Traceback's last minutes in memory (recorded every poll).
    return with_recent(got["spans"] or None, getattr(tb, "frames", None) or [], got["at"]), now - LOOKBACK_S


def with_recent(trace: dict[str, list[tuple[float, float]]] | None, frames: list[Any],
                since: float) -> dict[str, list[tuple[float, float]]] | None:
    """trace with each room seen in a frame after `since` added as a sighting then. Pure."""
    seen = [(float(f["ts"]), o.get("r")) for f in frames if isinstance(f, dict) and isinstance(f.get("ts"), (int, float))
            and f["ts"] > since for o in f.get("o") or [] if isinstance(o, dict) and isinstance(o.get("r"), str) and o.get("r")]
    if not seen:
        return trace
    out = {k: list(v) for k, v in (trace or {}).items()}
    for ts, room in seen:
        out.setdefault(_key(room), []).append((ts, ts))
    return out


def _changes(rows: Any, lo: float, hi: float) -> list[tuple[float, float]]:
    """(start, kWh) of each statistics row with a `change` that starts in [lo, hi)."""
    return [(t, float(r["change"])) for r in rows or []
            if (t := _row_start(r)) is not None and lo <= t < hi and _num(r.get("change")) is not None]


async def _async_today(hass: Any, devs: list[dict[str, Any]], now: float, day_start: float) -> dict[str, Any]:
    """Today's kWh by device and each power sensor's kWh from its 5-minute means, read at most every STATS_EVERY_S,
    one read at a time (a second caller waits for the first and takes its figures).

    The hourly `change` rows start on the hour; where local midnight is not on one (a half-hour time zone), the part
    of the day before the first full hour comes from the 5-minute rows, as one bucket of its own. A power sensor's
    kWh is summed only over the 5-minute rows before the end of its device's last hourly row, so the two cover the
    same time (the hourly figure ends at the last full hour)."""
    mem = _mem(hass)
    ids = {d["id"] for d in devs}
    rates = {d["rate"] for d in devs if d["rate"]}
    async with mem.setdefault("today_lock", asyncio.Lock()):
        got = mem.get("today")
        if got and now - got["at"] < STATS_EVERY_S and got["day"] == day_start and got["ids"] == ids | rates:
            return got
        hour0 = math.floor(day_start / 3600.0) * 3600.0          # the hour that holds local midnight
        first = day_start if hour0 == day_start else hour0 + 3600.0
        utc = lambda ts: datetime.fromtimestamp(ts, timezone.utc)  # noqa: E731
        end = now + 3600.0
        hourly: dict[str, list[tuple]] = {}
        for sid, rows in (await _async_stats(hass, ids, utc(first), utc(end), "hour", {"change"})).items():
            hourly[sid] = _changes(rows, first, end)
        if first > day_start:
            for sid, rows in (await _async_stats(hass, ids, utc(day_start), utc(first), "5minute", {"change"})).items():
                part = _changes(rows, day_start, first)
                if part:
                    hourly[sid] = [(day_start, sum(v for _t, v in part), first - day_start), *hourly.get(sid, [])]
        cut = {}
        for d in devs:
            if d["rate"] and hourly.get(d["id"]):
                cut[d["rate"]] = max(b[0] + (b[2] if len(b) > 2 else 3600.0) for b in hourly[d["id"]])
        power_kwh: dict[str, float] = {}
        for sid, rows in (await _async_stats(hass, set(cut), utc(day_start), utc(end), "5minute", {"mean"})).items():
            vals = [_num(r.get("mean")) for r in rows or []
                    if isinstance(r, dict) and (t := _row_start(r)) is not None and t < cut.get(sid, 0.0)]
            vals = [v for v in vals if v is not None]
            if vals:
                power_kwh[sid] = sum(vals) * (5.0 / 60.0) / 1000.0
        got = {"at": now, "day": day_start, "ids": ids | rates, "hourly": hourly, "power_kwh": power_kwh,
               "kwh": {sid: sum(b[1] for b in rows) for sid, rows in hourly.items()}}
        mem["today"] = got
        return got


def _sun_below(hass: Any) -> bool:
    s = hass.states.get("sun.sun") if getattr(hass, "states", None) is not None else None
    return getattr(s, "state", None) == "below_horizon"


def _currency(hass: Any) -> str | None:
    c = getattr(getattr(hass, "config", None), "currency", None)
    return c if isinstance(c, str) and c.strip() else None


# ── memory and the samples' store ───────────────────────────────────────────

def _mem(hass: Any) -> dict[str, Any]:
    return hass.data.setdefault(DOMAIN, {}).setdefault(_DATA, {})


class Samples:
    """padspan_ha.energy: the away-standby samples, [[ts, W]], at most SAMPLES_MAX of the last SAMPLES_DAYS days."""

    def __init__(self, hass: Any) -> None:
        from homeassistant.helpers.storage import Store  # noqa: PLC0415
        self.store = Store(hass, 1, STORE_KEY)
        self.samples: list[list[float]] = []
        self.loaded = False

    async def async_load(self) -> None:
        if self.loaded:
            return
        self.loaded = True
        try:
            raw = await self.store.async_load()
        except Exception:  # noqa: BLE001 — a store that can't be read starts empty
            _quiet_error("energy:load")
            raw = None
        rows = raw.get("samples") if isinstance(raw, dict) else None
        self.samples = [[float(t), float(w)] for t, w in (r for r in rows or [] if isinstance(r, list) and len(r) == 2)
                        if isinstance(t, (int, float)) and isinstance(w, (int, float))][-SAMPLES_MAX:]

    def add(self, ts: float, w: float) -> None:
        cut = ts - SAMPLES_DAYS * 86400.0
        self.samples = [s for s in self.samples if s[0] >= cut][-(SAMPLES_MAX - 1):] + [[round(ts), round(w, 1)]]
        try:
            self.store.async_delay_save(lambda: {"samples": self.samples}, SAVE_DELAY_S)
        except Exception:  # noqa: BLE001
            _quiet_error("energy:save")


async def _async_samples(hass: Any) -> Samples:
    mem = _mem(hass)
    s = mem.get("samples")
    if not isinstance(s, Samples):
        s = mem["samples"] = Samples(hass)
    await s.async_load()
    return s


# ── the summary, from a running Home Assistant ──────────────────────────────

async def async_summary(hass: Any, now: float | None = None) -> dict[str, Any]:
    """energy_get's answer. Off, or not allowed: {"on": False, "allowed": bool} and nothing is read."""
    if _settings(hass).get(SETTING) is not True or not allowed(hass):
        return {"on": False, "allowed": allowed(hass)}
    now = time.time() if now is None else float(now)
    prefs = await _async_prefs(hass)
    devs = devices_of(prefs)
    settings = _settings(hass)
    day_start = _day_start(hass, now)
    if not set_up(prefs):
        # Home Assistant's Energy is not set up: say so, and read nothing else (no Traceback, no statistics).
        out = compute({"prefs": prefs, "states": hass.states, "now": now, "day_start": day_start, "settings": settings,
                       "currency": _currency(hass)})
        out["away"] = False
        _mem(hass)["counts"] = {"at": now, "rooms": 0, "devices": 0, "issues": 0, "house": False}
        return out
    today = await _async_today(hass, devs, now, day_start) if devs else {}
    eids = {d["id"] for d in devs} | {d["rate"] for d in devs if d["rate"]}
    rooms = _map_rooms(hass)
    areas = _area_of(hass, eids)
    area_rooms = sorted({a for a, _d in areas.values() if a} | set(rooms))
    trace, trace_start = await _async_trace(hass, now)
    sensors = _room_sensors(hass, area_rooms)
    away = away_since(hass, now)
    occ = room_occupancy(area_rooms, trace, trace_start, sensors, away, now, empty_after_s(settings), day_start,
                         _receiver_rooms(hass))
    source = "padspan" if trace is not None else "sensors" if sensors else "away" if away is not None else None
    samples = await _async_samples(hass)
    out = compute({"prefs": prefs, "states": hass.states, "now": now, "day_start": day_start, "settings": settings,
                   "currency": _currency(hass), "areas": areas, "rooms": rooms,
                   "kwh": today.get("kwh"), "hourly": today.get("hourly"), "power_kwh": today.get("power_kwh"),
                   "occupancy": occ, "occupancy_source": source, "sun_below": _sun_below(hass),
                   "samples": samples.samples})
    out["away"] = everyone_out(hass, now)
    _mem(hass)["counts"] = {"at": now, "rooms": len(out["rooms"]), "devices": len(out["devices"]),
                            "issues": len(out["issues"]), "house": out["house"]["w"] is not None}
    return out


async def async_tick(hass: Any, now: float | None = None) -> None:
    """Every SAMPLE_EVERY: nothing while off; while everyone is out (or Vacation Mode is on) the house's watts go into
    the samples; and the summary is worked out once an hour, for the report's counts."""
    if not on(hass):
        return
    now = time.time() if now is None else float(now)
    try:
        if everyone_out(hass, now):
            w = house_w(await _async_prefs(hass), hass.states, now)
            if w is not None:
                (await _async_samples(hass)).add(now, w)
        counts = _mem(hass).get("counts")
        if not counts or now - counts.get("at", 0) >= SUMMARY_EVERY_S:
            await async_summary(hass, now)
    except Exception:  # noqa: BLE001 — the next tick tries again
        _quiet_error("energy:tick")


def async_setup_energy(hass: Any) -> None:
    """The sampler's timer, once per Home Assistant (a no-op on each tick while Energy is off)."""
    from homeassistant.helpers.event import async_track_time_interval  # noqa: PLC0415
    mem = _mem(hass)
    if mem.get("unsub"):
        return

    async def _run(_now: Any = None) -> None:
        await async_tick(hass)

    mem["unsub"] = async_track_time_interval(hass, _run, SAMPLE_EVERY)


def async_stop_energy(hass: Any) -> None:
    unsub = _mem(hass).pop("unsub", None)
    if unsub:
        try:
            unsub()
        except Exception:  # noqa: BLE001
            _quiet_error("energy:stop")


# ── spikes, an administrator's ──────────────────────────────────────────────

async def async_spikes(hass: Any, now: float | None = None) -> dict[str, Any]:
    """The last SPIKE_DAYS days' spikes in the whole-house power, each with who was home and where (Traceback), and
    a link to Traceback then. Only while Energy and its spikes are on."""
    if not on(hass) or _settings(hass).get(SPIKES_KEY) is not True:
        return {"enabled": False, "spikes": []}
    now = time.time() if now is None else float(now)
    src = sources_of(await _async_prefs(hass))
    ids = src["home"] or src["grid"]
    extra = [] if src["home"] else src["solar"]
    if not ids:
        return {"enabled": True, "house": False, "spikes": []}
    start = datetime.fromtimestamp(now - SPIKE_DAYS * 86400.0, timezone.utc)
    end = datetime.fromtimestamp(now, timezone.utc)
    stats = await _async_stats(hass, set(ids) | set(extra), start, end, "5minute", {"mean"})
    series: dict[float, float] = {}
    have: dict[float, int] = {}
    for sid in ids:
        for r in stats.get(sid) or []:
            t, m = _row_start(r), _num(r.get("mean")) if isinstance(r, dict) else None
            if t is not None and m is not None:
                series[t] = series.get(t, 0.0) + m
                have[t] = have.get(t, 0) + 1
    for sid in extra:
        for r in stats.get(sid) or []:
            t, m = _row_start(r), _num(r.get("mean")) if isinstance(r, dict) else None
            if t is not None and m is not None and t in series:
                series[t] += m
    points = [(t, w) for t, w in series.items() if have.get(t) == len(ids)]
    spikes = find_spikes(points)
    tb = hass.data.get(DOMAIN, {}).get(DATA_TRACEBACK)
    frames: list[dict[str, Any]] = []
    if tb is not None and spikes:
        # One read for them all: from the first spike to the end of the last one's five minutes.
        try:
            frames = await tb.async_get_frames(min(x["ts"] for x in spikes), max(x["ts"] for x in spikes) + 300.0,
                                               max_frames=SPIKE_FRAMES)
        except Exception:  # noqa: BLE001 — Traceback not readable: nobody named
            _quiet_error("energy:spike_who")
    for s in spikes:
        s["who"] = who_at([f for f in frames if isinstance(f, dict) and s["ts"] <= float(f.get("ts") or 0) <= s["ts"] + 300.0])
        s["link"] = traceback_link(s["ts"])
    return {"enabled": True, "house": True, "days": SPIKE_DAYS, "spikes": spikes}


# ── Yesterday at home's line ────────────────────────────────────────────────

async def async_yesterday(hass: Any, start: float, end: float,
                          occupied: dict[str, list[tuple[float, float]]]) -> dict[str, Any] | None:
    """The kWh and cost used yesterday in rooms nobody had been in for energy_empty_after_min, by Yesterday at
    home's own occupied stretches ({room: [(from, to)]}, presence_coordinator), the always-on list left out. None
    while Energy is off, or where nothing is metered by room."""
    if not on(hass):
        return None
    prefs = await _async_prefs(hass)
    devs = devices_of(prefs)
    if not devs:
        return None
    settings = _settings(hass)
    always = set(clean_always_on(settings.get(ALWAYS_ON_KEY)))
    after = empty_after_s(settings)
    areas = _area_of(hass, {d["id"] for d in devs} | {d["rate"] for d in devs if d["rate"]})
    by_key = {_key(r): spans for r, spans in occupied.items()}
    stats = await _async_stats(hass, {d["id"] for d in devs}, datetime.fromtimestamp(start, timezone.utc),
                               datetime.fromtimestamp(end, timezone.utc), "hour", {"change"})
    hourly = {sid: [(t, float(r["change"])) for r in rows or []
                    if (t := _row_start(r)) is not None and start <= t < end and _num(r.get("change")) is not None]
              for sid, rows in stats.items()}
    own = _own_hourly(devs, hourly)
    total = 0.0
    for d in devs:
        if d["id"] in always or (d["rate"] or "") in always:
            continue
        area = ((areas.get(d["rate"]) if d["rate"] else None) or (None, None))[0] or (areas.get(d["id"]) or (None, None))[0]
        if not area or _key(area) not in by_key:
            continue
        gaps = [(s + after, e) for s, e in empty_spans(by_key[_key(area)], start, end) if e > s + after]
        total += kwh_in_spans(own.get(d["id"]) or [], gaps)
    price = price_of(prefs, hass.states)
    return {"kwh": round(total, 2), "cost": round(total * price, 2) if price is not None else None,
            "currency": _currency(hass)}


def yesterday_words(got: dict[str, Any] | None) -> str | None:
    """The morning message's line ("Used in empty rooms: 1.4 kWh (about 0.18 CAD)."), or None for nothing used."""
    if not got or not got.get("kwh") or got["kwh"] < 0.01:
        return None
    cost = got.get("cost")
    money = f" (about {cost:.2f} {got.get('currency') or ''}".rstrip() + ")" if isinstance(cost, (int, float)) else ""
    return f"Used in empty rooms: {got['kwh']:.2f} kWh{money}."


# ── the usage report ────────────────────────────────────────────────────────

REPORT_KEYS: tuple[str, ...] = ("on", "rooms", "devices", "issues", "house", "spikes")
REPORT_CAP = 99


def report(hass: Any, settings: dict[str, Any]) -> dict[str, Any] | None:
    """env.energy: counts only, only while it is on (never watts, kWh or money)."""
    if settings.get(SETTING) is not True or not allowed(hass):
        return None
    c = _mem(hass).get("counts") or {}

    def n(k: str) -> int:
        v = c.get(k)
        return min(int(v), REPORT_CAP) if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0
    return {"on": True, "rooms": n("rooms"), "devices": n("devices"), "issues": n("issues"),
            "house": c.get("house") is True, "spikes": settings.get(SPIKES_KEY) is True}


def report_ok(sec: Any) -> bool:
    """Whether env.energy holds only REPORT_KEYS: two yes/noes and three counts, and on True."""
    if not isinstance(sec, dict) or set(sec) - set(REPORT_KEYS) or sec.get("on") is not True:
        return False
    for k, v in sec.items():
        if k in ("on", "house", "spikes"):
            if not isinstance(v, bool):
                return False
        elif not (isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= REPORT_CAP):
            return False
    return True


# ── the commands ────────────────────────────────────────────────────────────

@websocket_api.websocket_command({"type": "padspan_ha/energy_get"})
@websocket_api.async_response
async def ws_energy_get(hass: HomeAssistant, connection, msg) -> None:
    """The rooms, devices, house figures, price, currency, health and staleness: any logged-in user, as Home
    Assistant's own Energy data is."""
    try:
        connection.send_result(msg["id"], await async_summary(hass))
    except Exception as err:  # noqa: BLE001 — said to the panel, which keeps its last answer
        _quiet_error("energy:get")
        connection.send_error(msg["id"], "energy_failed", str(err)[:200])


@websocket_api.websocket_command({"type": "padspan_ha/energy_spikes"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_energy_spikes(hass: HomeAssistant, connection, msg) -> None:
    """Who was home at the spikes: an administrator's, and the data stays on the house."""
    user = getattr(connection, "user", None)
    if user is None or getattr(user, "is_admin", False) is not True:
        connection.send_error(msg["id"], "unauthorized", "Only an administrator can see who was home at spikes")
        return
    connection.send_result(msg["id"], await async_spikes(hass))


WS_COMMANDS = (ws_energy_get, ws_energy_spikes)
