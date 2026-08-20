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

from .const import DATA_SETTINGS, DOMAIN, OUTDOOR_FLOOR_NAMES

# Kinds that physically go away.  An HA entity has no radio and no age, so it
# is never "away" — blanking those was how an earlier attempt at this rule
# emptied half the UI.
RADIO_KINDS = ("ble", "private_ble", "ibeacon")

DEFAULT_AWAY_TIMEOUT_M = 5.0
_MIN_AWAY_TIMEOUT_M = 1.0
_MAX_AWAY_TIMEOUT_M = 1440.0


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


def is_outdoor_floor(floor_id: Any) -> bool:
    """Whether a floor id names the outdoors — the fabric sentinel or a
    registry floor called outside/garden/yard/…, one list in const."""
    return str(floor_id or "").strip().lower().replace(" ", "_") in OUTDOOR_FLOOR_NAMES


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
