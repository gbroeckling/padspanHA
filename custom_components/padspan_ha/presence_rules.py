# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""The single owner of "is this object still here?".

One rule, one implementation.  It had been hand-rolled in nine places —
sensor.py, device_tracker.py and seven spots across the frontend — each
re-deriving `(away_timeout_m ?? 5) * 60`.  Copies drift: the server-side
room-occupancy rebuild never implemented it at all, so a car that had been
gone for an hour stayed listed in the Garage next to devices seen 20 seconds
ago.

Anything that decides whether an object is present must call these.
"""

from __future__ import annotations

from typing import Any

import math
import re

from .const import (
    DATA_MODEL, DATA_SETTINGS, DEFAULT_PATH_LOSS_EXP, DEFAULT_REF_POWER, DOMAIN, OUTDOOR_FLOOR_NAMES,
)

# Kinds that physically go away.  An HA entity has no radio and no age, so it
# is never "away" — blanking those was how an earlier attempt at this rule
# emptied half the UI.
RADIO_KINDS = ("ble", "private_ble", "ibeacon")

DEFAULT_AWAY_TIMEOUT_M = 5.0
_MIN_AWAY_TIMEOUT_M = 1.0
_MAX_AWAY_TIMEOUT_M = 1440.0


FLOOR_MIN_DBM = -110.0
FLOOR_MAX_DBM = -30.0


def scanner_floors(settings: dict[str, Any] | None) -> dict[str, float]:
    """Each receiver's minimum signal, in dBm (opt-in, Ben Hines 2026-10-16).

    `scanner_min_rssi` = {source: dBm}; empty unless the user sets one (Bluetooth
    → Scanners). A reading weaker than its receiver's floor is ignored by
    POSITIONING (the coordinator's per-scanner RSSI maps) and by the OCCUPANCY
    phone count, and by nothing else: the raw advertisement lists, Forensics,
    Traceback, Find My following and calibration capture all still see it. A
    receiver on an outside wall can drop the street and the flat below without
    losing anything another receiver hears well.
    """
    out: dict[str, float] = {}
    raw = (settings or {}).get("scanner_min_rssi") or {}
    if not isinstance(raw, dict):
        return out
    for src, v in raw.items():
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if src and FLOOR_MIN_DBM <= f <= FLOOR_MAX_DBM:
            out[str(src)] = f
    return out


def below_floor(floors: dict[str, float] | None, src: Any, rssi: Any) -> bool:
    """A reading weaker than its receiver's minimum signal (no floor: never)."""
    if not floors or src is None or rssi is None:
        return False
    try:
        return float(rssi) < floors.get(str(src), -999.0)
    except (TypeError, ValueError):
        return False


def clean_floors(raw: Any) -> dict[str, int]:
    """What settings_set keeps of a scanner_min_rssi write: sources with a
    whole dBm in range; anything else dropped. {} turns every floor off."""
    out: dict[str, int] = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if isinstance(k, str) and k.strip() and FLOOR_MIN_DBM <= f <= FLOOR_MAX_DBM:
            out[k] = int(round(f))
    return out


def excluded_sources(settings: dict[str, Any] | None) -> frozenset[str]:
    """Scanner sources masked out of positioning — all three ways at once.

    A source can be masked three ways and they mean the same thing downstream:

      excluded_scanners  the user masked a receiver whose readings are actively
                         misleading, usually because it physically moved
      lost_radios        marked lost
      disabled_radios    marked disabled

    This had four implementations. Two included all three sets; the two used by
    the LIVE SNAPSHOT and by advertisement INGESTION included only lost and
    disabled. So a scanner the user had explicitly excluded went on entering
    the RSSI maps and went on assigning rooms to objects, while the smoothed
    state was simultaneously being purged of it — two halves of one poll
    disagreeing about whether that receiver existed.

    Taking a settings dict rather than `hass` keeps this callable from the
    coordinator, the websocket snapshot and the calibration store alike, and
    keeps the rule testable without a Home Assistant instance.
    """
    d = settings or {}
    out = {str(s) for s in (d.get("excluded_scanners") or []) if s}
    out |= {str(s) for s in (d.get("lost_radios") or {})}
    out |= {str(s) for s in (d.get("disabled_radios") or {})}
    return frozenset(out)


def away_timeout_s(hass: Any) -> float:
    """Configured away timeout in seconds (default 5 min).

    Clamped to the same 1..1440 minute range the settings endpoint enforces,
    so a hand-edited store cannot produce a timeout the UI cannot express.
    """
    try:
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            val = (st.data or {}).get("away_timeout_m")
            if val is not None:
                return max(_MIN_AWAY_TIMEOUT_M,
                           min(_MAX_AWAY_TIMEOUT_M, float(val))) * 60.0
    except (AttributeError, TypeError, ValueError):
        pass
    return DEFAULT_AWAY_TIMEOUT_M * 60.0


def is_away(obj: dict[str, Any], timeout_s: float) -> bool:
    """Has this radio object gone quiet for longer than the timeout?

    Only radio-backed objects can be away.  An object with no usable age has
    never been aged out — absence of evidence is not evidence of absence, and
    treating it as away would hide devices the moment the field went missing.
    """
    if not isinstance(obj, dict):
        return False
    if obj.get("kind") not in RADIO_KINDS:
        return False
    age = obj.get("age_s")
    if not isinstance(age, (int, float)) or isinstance(age, bool):
        return False
    if age != age or age in (float("inf"), float("-inf")):  # NaN / inf
        return False
    return age > timeout_s


# ── Is a person home? ────────────────────────────────────────────────────────
#
# A Home Assistant person counted only when their state was exactly "home"
# vanished from the count and the 3D house when they were plainly in: a person
# linked to PadSpan's own device tracker reads the ROOM (that tracker's state
# is the room, and PadSpan's guide says to link it), a person with no tracker
# of their own reads "unknown" while PadSpan hears their phone in the hall, and
# a person in a Garden zone inside the home zone reads "Garden".
#
# One rule, here and in the panel (views/person_home.js; tests/
# test_person_home.py holds the two alike on one table). A person is home when
# their state is "home", a room PadSpan knows, the home zone's name or a zone
# wholly inside the home zone, or "unknown" while PadSpan places one of their
# own devices in the house. Anything else is away; a zone wins over a room of
# the same name, so someone at a zone called "Office" is never counted in the
# office at home.

_EARTH_M = 6371000.0
_HOME_RADIUS_M = 100.0     # Home Assistant's own default for zone.home
_NOT_ROOMS = frozenset({"", "unknown", "unavailable", "not home", "home", "away"})


def place_name(s: Any) -> str:
    """A room or zone name as compared: case, "_" and "-" and extra spaces aside."""
    return " ".join(re.sub(r"[_-]+", " ", "" if s is None else str(s).lower()).split())


def _finite(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v) if math.isfinite(v) else None


def _metres_apart(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.pi / 180.0
    d_lat, d_lon = (lat2 - lat1) * rad, (lon2 - lon1) * rad
    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    return 2 * _EARTH_M * math.asin(min(1.0, math.sqrt(h)))


def home_zones(zone_states: Any) -> dict[str, bool]:
    """Home Assistant's zones by name (place_name), each True when it is the
    home zone or lies wholly inside it. Two zones of one name are at home only
    if both are. zone_states: the zone.* states."""
    states = [s for s in (zone_states or []) if str(getattr(s, "entity_id", "")).startswith("zone.")]
    home = next((s for s in states if s.entity_id == "zone.home"), None)
    ha = (getattr(home, "attributes", None) or {}) if home is not None else {}
    h_lat, h_lon = _finite(ha.get("latitude")), _finite(ha.get("longitude"))
    h_r = _finite(ha.get("radius"))
    h_r = _HOME_RADIUS_M if h_r is None else h_r
    out: dict[str, bool] = {}
    for s in states:
        a = getattr(s, "attributes", None) or {}
        name = place_name(a.get("friendly_name") or s.entity_id[5:])
        if not name:
            continue
        at_home = s.entity_id == "zone.home"
        lat, lon = _finite(a.get("latitude")), _finite(a.get("longitude"))
        if not at_home and None not in (h_lat, h_lon, lat, lon):
            r = _finite(a.get("radius")) or 0.0
            at_home = _metres_apart(h_lat, h_lon, lat, lon) + max(0.0, r) <= h_r  # type: ignore[arg-type]
        out[name] = (out[name] and at_home) if name in out else at_home
    return out


def person_is_home(state: Any, *, rooms: Any = (), zones: dict[str, bool] | None = None,
                   placed: bool = False) -> bool:
    """The rule. state: the person's state (a string, or their State); rooms:
    the names PadSpan knows; zones: home_zones'; placed: PadSpan places one of
    their own devices in the house now."""
    raw = getattr(state, "state", state)
    s = ("" if raw is None else str(raw)).strip()
    if s == "home":
        return True
    if s == "unknown":
        return bool(placed)
    if s in ("", "not_home", "unavailable"):
        return False
    n = place_name(s)
    z: dict[str, bool] = {}
    for k, v in (zones or {}).items():
        kn = place_name(k)
        z[kn] = (z[kn] and bool(v)) if kn in z else bool(v)
    if n in z:
        return z[n]
    return n not in _NOT_ROOMS and any(place_name(r) == n for r in (rooms or ()))


def known_rooms(hass: Any) -> set[str]:
    """Every room PadSpan knows (place_name): the map's rooms, each receiver's
    room, the receivers' Home Assistant areas the engine uses before a map has
    any, the room each device is in now, and Home Assistant's areas."""
    out: set[str] = set()

    def add(r: Any) -> None:
        if isinstance(r, str):
            n = place_name(r)
            if n not in _NOT_ROOMS:
                out.add(n)

    d = (getattr(hass, "data", None) or {}).get(DOMAIN) or {}
    mdl, pc = d.get(DATA_MODEL), d.get("presence_coordinator")
    sources = (
        lambda: list((mdl.room_geometry_m() or {}).keys()),
        lambda: list((mdl.get_scanner_mappings()[0] or {}).values()),
        lambda: list((getattr(pc, "_last_source_to_area", None) or {}).values()),
        lambda: [o.get("room") for o in (getattr(pc, "data", None) or {}).values() if isinstance(o, dict)],
        lambda: [a.name for a in _area_registry(hass).async_list_areas()],
    )
    for names in sources:
        try:
            for r in names():
                add(r)
        except Exception:  # noqa: BLE001 — a store or registry not ready: those rooms are not known yet
            continue
    return out


def _area_registry(hass: Any) -> Any:
    from homeassistant.helpers import area_registry as ar  # noqa: PLC0415
    return ar.async_get(hass)


def person_identity(hass: Any, st: Any) -> tuple[set[str], set[str]]:
    """A person's device trackers, and the names their things may carry: their
    own, and each tracker's name and object id (lower case)."""
    attrs = getattr(st, "attributes", None) or {}
    trackers = {str(t) for t in (attrs.get("device_trackers") or [])}
    if attrs.get("source"):
        trackers.add(str(attrs["source"]))
    names = {str(attrs.get("friendly_name") or getattr(st, "entity_id", "")).lower()}
    for t in trackers:
        tst = hass.states.get(t)
        fn = (getattr(tst, "attributes", None) or {}).get("friendly_name") if tst is not None else None
        if fn:
            names.add(str(fn).lower())
        names.add(t.split(".", 1)[-1].replace("_", " ").lower())
    names.discard("")
    return trackers, names


def device_is_theirs(obj: dict[str, Any], trackers: set[str], names: set[str]) -> bool:
    """A PadSpan object is a person's when it is labelled with one of their
    names, or linked to (or is) one of their device trackers."""
    label = str(obj.get("user_label") or "").strip().lower()
    linked = {str(e) for e in (obj.get("linked_entities") or [])}
    # An entity object (a Bermuda or other tracker in HA) is the tracker itself.
    if obj.get("entity_id"):
        linked.add(str(obj["entity_id"]))
    return bool((label and label in names) or (linked & trackers))


def placed_in_house(obj: Any, timeout_s: float) -> bool:
    """Does PadSpan place this device in the house now: a radio device heard
    within the away timeout, with a room or a spot. An HA entity's room is not
    PadSpan placing it (a tracker kept in its area for good)."""
    if not isinstance(obj, dict) or obj.get("kind") not in RADIO_KINDS or is_away(obj, timeout_s):
        return False
    if obj.get("_stale") or obj.get("_ghost") or obj.get("away"):
        return False
    room = obj.get("room")
    if isinstance(room, str) and place_name(room) not in _NOT_ROOMS:
        return True
    return _finite(obj.get("x_m")) is not None and _finite(obj.get("y_m")) is not None


def home_context(hass: Any, objects: Any = None) -> dict[str, Any]:
    """What person_home reads, gathered once for many people: the rooms
    PadSpan knows, the zones at home, and the devices it places in the house
    (objects: PadSpan's objects; None: the presence engine's own)."""
    if objects is None:
        pc = ((getattr(hass, "data", None) or {}).get(DOMAIN) or {}).get("presence_coordinator")
        try:
            objects = [o for o in (getattr(pc, "data", None) or {}).values()]
        except Exception:  # noqa: BLE001
            objects = []
    try:
        zones = home_zones(hass.states.async_all("zone"))
    except Exception:  # noqa: BLE001 — no states yet: no zones
        zones = {}
    timeout = away_timeout_s(hass)
    return {"rooms": known_rooms(hass), "zones": zones,
            "placed": [o for o in objects or [] if placed_in_house(o, timeout)]}


def person_home(hass: Any, st: Any, ctx: dict[str, Any] | None = None) -> bool:
    """Is this person (their State) home? The rule, with what it reads from
    Home Assistant and PadSpan (ctx: home_context's, for many people at once)."""
    ctx = ctx if ctx is not None else home_context(hass)
    placed = False
    if str(getattr(st, "state", "") or "").strip() == "unknown":
        trackers, names = person_identity(hass, st)
        placed = any(device_is_theirs(o, trackers, names) for o in ctx["placed"])
    return person_is_home(getattr(st, "state", None), rooms=ctx["rooms"], zones=ctx["zones"], placed=placed)


# ── Outside: the site's indoor coverage envelope ────────────────────────────
#
# A device on the property but not in the building is heard by every indoor
# scanner faintly, through the walls, and the strongest of several faint
# readings is some perimeter room — so a parked vehicle lived in the Bedroom
# Closet. Nothing about one faint reading says "outside". What is always true
# of an outside device on a covered site is that NO scanner hears it well: a
# device indoors has a scanner within a few metres. The site can measure that
# about itself — see docs/outside-attribution-plan.md.

COVERAGE_MIN_POINTS = 30       # fewer indoor calibration points: rule inactive
COVERAGE_PERCENTILE = 0.05     # the low tail of "strongest reading" indoors
COVERAGE_HYSTERESIS_DB = 2.0   # enter below floor-2, leave above floor+2

# How many polls of best-RSSI the outside rule looks back over before it will
# claim a device has left the building.
#
# The rule reads the STRONGEST scanner still inside the silence grace. When the
# scanner that hears a device best goes quiet, that value does not degrade — it
# drops to the next-best, which can be 25-30 dB lower, and crosses the floor in
# a single poll. "Its best radio stopped reporting" and "it left the building"
# are not the same event, and instantaneous max cannot tell them apart. Worse,
# scanners are shared: every device whose best hearer went quiet flips in the
# SAME poll, which is why the symptom is a whole house going outside at once
# rather than one device drifting.
#
# Six polls is ~30s at the default interval: long enough to ride out a radio
# missing a few reports, short enough that a vehicle actually leaving is
# outside within half a minute.
# Expressed as a DURATION, not a poll count. `presence_poll_interval_s` is a
# user setting (1-60s, default 5), so a fixed poll count is a different length
# of time on every install: six polls is 30s on a default install and a full
# minute on one polling every 10s. The rule is about how long a device has been
# unheard, which is a physical fact about the device — it cannot depend on how
# often this particular install happens to look.
COVERAGE_WINDOW_S = 30.0


def coverage_window_polls(poll_interval_s: float | None) -> int:
    """How many polls span COVERAGE_WINDOW_S at this install's poll rate."""
    try:
        p = float(poll_interval_s)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        p = 5.0
    if not (p > 0):
        p = 5.0
    return max(2, min(60, round(COVERAGE_WINDOW_S / p)))


# Kept for callers that have no interval to hand; equals COVERAGE_WINDOW_S at
# the default 5s poll.
COVERAGE_WINDOW_POLLS = 6


def room_change_delay_s(settings: dict[str, Any]) -> float:
    """Room Change Delay in seconds, 0-300. Unset is the default 20 s; 0 is
    0 — "switch on the first poll that agrees", as the panel says. It used to
    read `or 20.0`, so a delay of 0 still waited 20 s."""
    v = (settings or {}).get("room_change_delay_s")
    try:
        d = 20.0 if v is None or v == "" else float(v)
    except (TypeError, ValueError):
        d = 20.0
    return max(0.0, min(300.0, d))


def is_outdoor_floor(floor_id: Any) -> bool:
    """Whether a floor id names the outdoors — the fabric sentinel or a
    registry floor called outside/garden/yard/…, one list in const."""
    return str(floor_id or "").strip().lower().replace(" ", "_") in OUTDOOR_FLOOR_NAMES


# What kind of space a room is (the panel's views/outdoor_space.js
# outdoorKind is the same rule; tests/test_outdoor_kind.py holds them alike).
# A drawing matter: positioning, presence and the report read is_outdoor_floor,
# never this, so a covered patio is as outdoors for radio as it always was.
OUTDOOR_ROOM_NAME = re.compile(r"\b(deck|patio|porch|balcony|terrace|veranda|yard|garden|lawn|driveway|outside|outdoor)\b", re.I | re.A)
# room_meta[room]["space"]: as a person chose it; no key, worked out.
ROOM_SPACES = ("indoor", "open", "covered")


def outdoor_kind(name: Any, floor_id: Any, stored: Any = None, *, within: bool = False, over: bool = False) -> str:
    """"ground" on an Outside floor; else the kind stored; else worked out:
    indoors unless the name says outdoors, and indoors too where it stands
    within a lower floor's room that rises past it (within); an outdoor room
    with a room of a higher floor over most of it (over) is covered, else open."""
    if is_outdoor_floor(floor_id):
        return "ground"
    if stored in ROOM_SPACES:
        return str(stored)
    if not OUTDOOR_ROOM_NAME.search(str(name or "")) or within:
        return "indoor"
    return "covered" if over else "open"


def indoor_coverage_floor(points: list[dict[str, Any]], *,
                          min_points: int = COVERAGE_MIN_POINTS,
                          percentile: float = COVERAGE_PERCENTILE) -> float | None:
    """The coverage floor: the worst 'strongest reading' the house produces indoors.

    For each calibration point on an indoor floor, the strongest mean reading
    across its scanners is how well the nearest scanner hears a device standing
    there. The low tail of that over all indoor points is the weakest a device
    INSIDE the covered building is ever heard. None with too few points — a
    site that has not calibrated does not get the rule, and nothing regresses.
    """
    best: list[float] = []
    for p in points or []:
        if not isinstance(p, dict) or is_outdoor_floor(p.get("floor_id")):
            continue
        # Only real fingerprints. A point kept as one scanner's reading with
        # too few samples (quality "undersampled") says how well ONE scanner
        # heard something ONCE — not how well the house hears a device
        # standing there — and four hundred of them on one house put the
        # floor at -96.
        if p.get("quality") == "undersampled":
            continue
        vals = [r.get("mean_rssi") for r in (p.get("scanner_readings") or [])
                if isinstance(r, dict) and isinstance(r.get("mean_rssi"), (int, float))]
        if len(vals) >= 2:
            best.append(float(max(vals)))
    if len(best) < min_points:
        return None
    best.sort()
    idx = int(percentile * (len(best) - 1))
    return round(best[idx], 1)


def modelled_coverage_floor(rooms_m: dict[str, dict[str, Any]],
                            scanners: dict[str, tuple[float, float, str]],
                            ref_power: float, path_loss_exp: float,
                            floor_stack_idx: dict[str, int] | None = None,
                            slab_db: float = 10.0, grid_m: float = 1.0) -> float | None:
    """The same floor from physics, for a site with too little calibration.

    Sample every indoor room polygon on a metre grid; at each sample the best
    a scanner could hear a device there is the log-distance model to the
    nearest scanner (a slab of attenuation per storey between them). The
    minimum over the building is the modelled floor. Coarser than the
    measured one — walls and furniture are not in it — so the measured floor
    takes over as calibration accrues.
    """
    if not scanners:
        return None
    worst: float | None = None
    stack = floor_stack_idx or {}
    for room, g in (rooms_m or {}).items():
        if not isinstance(g, dict) or is_outdoor_floor(g.get("floor_id")):
            continue
        pts = g.get("points_m") if g.get("type") == "poly" else None
        if not pts or len(pts) < 3:
            continue
        fid = str(g.get("floor_id") or "")
        xs = [float(p[0]) for p in pts]; ys = [float(p[1]) for p in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        gx = x0
        while gx <= x1 + 1e-9:
            gy = y0
            while gy <= y1 + 1e-9:
                if _point_in_poly(gx, gy, pts):
                    best = -999.0
                    for _src, (sx, sy, sf) in scanners.items():
                        d = max(0.5, math.hypot(gx - sx, gy - sy))
                        rssi = ref_power - 10.0 * path_loss_exp * math.log10(d)
                        if sf and fid and sf != fid:
                            si, di = stack.get(str(sf)), stack.get(fid)
                            rssi -= slab_db * (abs(si - di) if si is not None and di is not None else 1)
                        if rssi > best:
                            best = rssi
                    if best > -999.0 and (worst is None or best < worst):
                        worst = best
                gy += grid_m
            gx += grid_m
    return round(worst, 1) if worst is not None else None


def _point_in_poly(x: float, y: float, poly: list) -> bool:
    # Standard ray-casting test: count edges the horizontal ray from (x, y)
    # toward +x crosses; odd = inside. Used by modelled_coverage_floor's grid
    # sampler to decide which sample points actually fall inside a room's
    # polygon before running the log-distance model on them.
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = float(poly[i][0]), float(poly[i][1])
        xj, yj = float(poly[j][0]), float(poly[j][1])
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def coverage_evidence(history: list[float] | None, best_live_dbm: float | None,
                      *, window: int = COVERAGE_WINDOW_POLLS) -> tuple[list[float], float | None]:
    """Fold this poll's best reading into the trailing window.

    Returns (new_history, best_recent). `best_recent` is the strongest reading
    in the window, so a scanner going quiet cannot cliff it — the device has to
    be unheard by EVERYTHING for the whole window before the value falls.

    Polls where nothing was heard contribute nothing rather than a sentinel: a
    device that is simply not advertising is not evidence about where it is.
    """
    hist = list(history or [])
    if best_live_dbm is not None:
        hist.append(float(best_live_dbm))
    if len(hist) > window:
        hist = hist[-window:]
    return hist, (max(hist) if hist else None)


def outside_by_coverage(best_recent_dbm: float | None, coverage_floor: float | None,
                        was_outside: bool, *, band_db: float = COVERAGE_HYSTERESIS_DB) -> bool:
    """Is the object outside the covered building?

    Enter below floor − band, leave above floor + band, hold in between; with
    no floor (rule inactive) or nothing heard, the answer is 'not by this rule'.

    `best_recent_dbm` is the strongest reading over the last few polls (see
    coverage_evidence), NOT this poll's. The asymmetry that produces is
    deliberate and is the point of the rule:

      * going outside is SLOW — it disables the indoor solve, so it is the
        destructive claim and has to survive a whole window of evidence
      * coming back inside is IMMEDIATE — one strong reading raises the
        window's max at once, and being wrongly inside costs nothing worse
        than an ordinary room vote

    Fed this poll's instantaneous max instead, the rule cannot distinguish a
    device leaving from its best scanner falling silent, and flips whole
    houses in a single poll.
    """
    if coverage_floor is None or best_recent_dbm is None:
        return False
    if best_recent_dbm < coverage_floor - band_db:
        return True
    if best_recent_dbm > coverage_floor + band_db:
        return False
    return was_outside


def outdoor_attribution(live: dict[str, float], source_to_area: dict[str, str],
                        source_to_floor: dict[str, str]) -> str | None:
    """The area of the outdoor scanner that hears the device best, or None.

    The rule only ever ADDS an outdoor attribution when there is outdoor
    evidence; with no outdoor scanner hearing the device it changes nothing.
    """
    best_src, best_val = None, None
    for src, rssi in (live or {}).items():
        if not is_outdoor_floor(source_to_floor.get(src)):
            continue
        if not source_to_area.get(src):
            continue
        if best_val is None or rssi > best_val:
            best_src, best_val = src, rssi
    return source_to_area.get(best_src) if best_src else None


def _distance_params(hass: Any) -> tuple[float, float]:
    """Return (ref_power, path_loss_exp) from settings, with safe defaults."""
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    data = (st.data or {}) if st else {}
    ref = float(data.get("ref_power", DEFAULT_REF_POWER))
    exp = float(data.get("path_loss_exp", DEFAULT_PATH_LOSS_EXP))
    return max(-100.0, min(0.0, ref)), max(1.0, min(4.0, exp))


def calc_distance(rssi: float, obj: dict, hass: Any) -> float:
    """Calculate distance using path-loss formula, preferring device's own RSSI@1m.
    Shared by the HA Distance sensors and the MQTT /distance topic."""
    ref, n = _distance_params(hass)
    # A device-advertised reference is only usable when it is a plausible
    # RSSI@1m (e.g. iBeacon measured power, ~-59 dBm).  BLE AD 0x0A
    # "Tx Power Level" is radiated power (0..+12 dBm), NOT RSSI@1m — using it
    # raw yields ~900 m distances.  Mirror the coordinator's spatial-path
    # validation: only trust values in [-90, -30], else keep configured ref.
    tx_power = obj.get("tx_power")
    if tx_power is not None:
        try:
            _tp = float(tx_power)
        except (TypeError, ValueError):
            _tp = None
        if _tp is not None and -90.0 <= _tp <= -30.0:
            ref = _tp
    return round(max(0.0, 10 ** ((ref - rssi) / (10.0 * n))), 1)
