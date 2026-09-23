# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
Vacation Mode — a Whole House Preset that isn't a snapshot.

Garry, 2026-09-21: "In whole house presets, add a permanent option,
vacation. Have the vacation act like an average day based on data
collected, and turn on and off lights based on that data until it is
turned off." Then: "day of the week to make it look a bit more random"
(so the pattern is per weekday, not one flat "average day"), and a
0-100 intensity slider ("energy saving vacation mode" at low settings).

THE DATA: Home Assistant's own recorder already has state-change history
for every light/fan, as long as they aren't excluded from it — no new
PadSpan-side tracking needed. build_pattern below turns that raw history
into, per entity, a per-(weekday, time-of-day) on-probability. Recorder's
default retention is 10 days, so a given (weekday, window) cell may only
ever see 1-2 historical samples; MIN_SAMPLES below is the line between
"trust this" and "say nothing for this slot" rather than confidently
inventing a schedule from a single fluke.

THE DECISION: decide_states draws a weighted random per (entity, tick)
against probability × (intensity / 100) — not a fixed replay of whatever
happened most often. That is what "a bit more random" actually asks for:
a real house doesn't do the identical thing at the identical minute every
day, and a schedule that does reads as an obviously-away home to exactly
the kind of watcher this feature exists to fool. It is also what makes
the intensity slider double as an energy-saving mode: turning it down
scales EVERY light's odds of being asked on, not a hard cutoff.

NEVER LEARN FROM ITSELF (Garry, 2026-09-23). The recorder cannot tell a
light Vacation Mode switched from one a person switched, so a pattern rebuilt
while Vacation Mode runs slowly learns its own output: below 100% intensity
every daily rebuild came out at roughly intensity x the day before, and a
long trip went progressively darker. So the pattern is built ONCE per
vacation, from history that ends when it was turned on
(vacation_mode_enabled_at), and every earlier vacation's own span
(vacation_mode_periods) is left out of the sample too. While it runs, what
it switches is kept in its own small log (VacationLog) so Traceback's Full
house activity can mark those events as Vacation Mode's, not a person's.

Everything here that touches history/state/services is a thin, largely
unverifiable (this repo's test suite has no real recorder or clock to
check it against) wrapper around two PURE functions — build_pattern and
decide_states — which carry the actual logic and are fully unit tested.
"""

import logging
import random
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, DATA_SETTINGS

_LOGGER = logging.getLogger(__name__)

# Light/fan only — the exact same allowlist ws_settings.py's whole-house-
# preset sanitizer enforces (_WHP_DOMAINS there). A saved preset can never
# reach a lock, a cover, an alarm panel; neither can vacation mode, even
# from a hand-edited or foreign settings store — checked again just before
# any service call below, not trusted from the pattern alone.
VM_DOMAINS = ("light.", "fan.")

# 30 minutes: coarse enough that a 10-day recorder history still gives a
# real (if thin) sample per weekday slot; finer than this and most cells
# would never clear MIN_SAMPLES at all.
WINDOW_MINUTES = 30
HISTORY_DAYS = 30
MIN_SAMPLES = 2

CHECK_INTERVAL = timedelta(minutes=5)

# Past vacation spans kept for exclusion — anything older has left
# HISTORY_DAYS' window anyway; the count cap is a backstop.
PERIODS_MAX_AGE_S = 60 * 86400
PERIODS_MAX = 50

# Vacation Mode's own switching, for Traceback to mark (see VacationLog).
LOG_STORE_KEY = "padspan_ha.vacation_log"
LOG_MAX_AGE_S = 8 * 86400     # Traceback keeps 7 days; one spare
LOG_MAX = 20000               # ~1000 switches/day in a 40-light house fits
LOG_SAVE_DELAY_S = 60         # well inside the 5-min tick: Store's delay is a trailing debounce
# A pattern build that found nothing usable is not retried every tick.
RETRY_EMPTY_S = 3600

_VM_UNSUB = "_vacation_mode_unsub"
_VM_LOG = "_vacation_mode_log"


# ── Pure logic — bucketing, sampling, deciding ───────────────────────────────


def bucket_key(dt: datetime) -> str:
    """"<weekday 0=Mon..6=Sun>:<HHMM>", HHMM floored to WINDOW_MINUTES. `dt`
    must already be in the house's LOCAL time — a schedule keyed by UTC
    would drift against daylight/routines by whatever the UTC offset is."""
    minute = (dt.minute // WINDOW_MINUTES) * WINDOW_MINUTES
    return f"{dt.weekday()}:{dt.hour:02d}{minute:02d}"


def sample_points(start: datetime, end: datetime) -> list[datetime]:
    """Every WINDOW_MINUTES-aligned instant in [start, end)."""
    if end <= start:
        return []
    step = timedelta(minutes=WINDOW_MINUTES)
    t = start.replace(minute=(start.minute // WINDOW_MINUTES) * WINDOW_MINUTES, second=0, microsecond=0)
    out = []
    while t < end:
        if t >= start:
            out.append(t)
        t += step
    return out


def state_at(changes: list[tuple[float, str]], at_ts: float) -> str | None:
    """`changes`: (epoch_s, state) pairs, any order. The state holding at
    at_ts is whatever the latest change at-or-before at_ts set it to; None
    if at_ts is before every known change (no data yet for that instant)."""
    result = None
    for ts, state in sorted(changes, key=lambda c: c[0]):
        if ts > at_ts:
            break
        result = state
    return result


def in_periods(ts: float, periods: list) -> bool:
    """True if ts falls inside any [start, end] span (end None = still open)."""
    for p in periods or ():
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            continue
        start, end = p
        if not isinstance(start, (int, float)) or (end is not None and not isinstance(end, (int, float))):
            continue
        if ts >= start and (end is None or ts < end):
            return True
    return False


def closed_periods(periods: list, enabled_at: float, now_ts: float) -> list:
    """The stored span list with [enabled_at, now_ts] appended — called when
    Vacation Mode is turned off — pruned by age and count."""
    out = [list(p) for p in (periods or []) if isinstance(p, (list, tuple)) and len(p) == 2]
    if enabled_at and enabled_at > 0:
        out.append([float(enabled_at), float(now_ts)])
    out = [p for p in out if p[1] is not None and p[1] >= now_ts - PERIODS_MAX_AGE_S]
    return out[-PERIODS_MAX:]


def prune_log(entries: list, now_ts: float) -> list:
    """Drop log entries older than LOG_MAX_AGE_S, then keep the newest LOG_MAX."""
    kept = [e for e in entries if e and e[0] >= now_ts - LOG_MAX_AGE_S]
    return kept[-LOG_MAX:]


def build_pattern(
    history: dict[str, list[tuple[float, str]]],
    now: datetime,
    history_days: int = HISTORY_DAYS,
    exclude: list | None = None,
) -> dict[str, dict[str, float]]:
    """`history`: {entity_id: [(epoch_s, "on"|"off"|other), ...]} — raw
    recorder transitions, already in whatever units state_at expects
    (epoch seconds; `now` and every timestamp inside `history` must agree
    on timezone, since only their relative order and bucket_key(now-derived
    sample point) matter here). Returns {entity_id: {bucket_key: on_probability}},
    omitting any (entity, bucket) with fewer than MIN_SAMPLES real
    on/off observations — no data beats a confident-looking guess from one
    fluke. `exclude` is a list of [start, end] epoch spans (earlier
    vacations) whose sample points are skipped — they are Vacation Mode's
    own output, not the house's routine."""
    start = now - timedelta(days=history_days)
    points = sample_points(start, now)
    pattern: dict[str, dict[str, float]] = {}
    for entity_id, changes in history.items():
        if not changes:
            continue
        spans = entity_exclusions(changes, exclude or [], now.timestamp())
        counts: dict[str, list[int]] = {}
        for pt in points:
            ts = pt.timestamp()
            if in_periods(ts, spans):
                continue
            st = state_at(changes, ts)
            if st not in ("on", "off"):
                continue
            # Each sample counts toward its own weekday slot and toward the
            # same slot on any day — the fallback when a weekday has too few
            # (review 2026-09-23: with the recorder's default 10 days, a trip
            # starting on a Friday had no Sat/Sun/Mon data at all, and the
            # house went dark every weekend).
            for key in (bucket_key(pt), any_day_key(pt)):
                on, total = counts.get(key, [0, 0])
                counts[key] = [on + (1 if st == "on" else 0), total + 1]
        buckets = {k: on / total for k, (on, total) in counts.items() if total >= MIN_SAMPLES}
        if buckets:
            pattern[entity_id] = buckets
    return pattern


def any_day_key(dt: datetime) -> str:
    """bucket_key's slot with the weekday replaced by "*" — every day."""
    return "*:" + bucket_key(dt).split(":", 1)[1]


def entity_exclusions(changes: list[tuple[float, str]], periods: list, now_ts: float) -> list:
    """One entity's own excluded spans: each earlier vacation, extended to
    that entity's first change after it ended. A light Vacation Mode left
    on when it was switched off stays on in the recorder until someone
    touches it — those hours are its doing, not the house's routine
    (review 2026-09-23)."""
    ordered = sorted(changes, key=lambda c: c[0])
    out = []
    for p in periods:
        if not isinstance(p, (list, tuple)) or len(p) != 2 or not isinstance(p[0], (int, float)):
            continue
        start, end = p
        if end is None:
            out.append([start, None])
            continue
        # The first REAL on/off change away from how Vacation Mode left it —
        # an "unavailable" blip in between is not someone touching the light.
        left = state_at(changes, end)
        nxt = next((ts for ts, st in ordered if ts > end and st in ("on", "off") and st != left), None)
        out.append([start, nxt if nxt is not None else now_ts])
    return out


def decide_states(
    pattern: dict[str, dict[str, float]],
    at: datetime,
    intensity_pct: float,
    rand_fn=random.random,
) -> dict[str, bool]:
    """One decision per entity that has a real probability for `at`'s
    bucket — entities with no data for this slot are left out entirely
    (never forced to a state), not defaulted to off. intensity_pct scales
    every probability the same way (5% intensity means each light is 20x
    less likely to be asked on than at 100%, not a fixed top-N cutoff) —
    that is what lets the same slider double as an energy-saving mode."""
    key = bucket_key(at)
    any_key = any_day_key(at)
    intensity = max(0.0, min(1.0, (intensity_pct or 0) / 100.0))
    out: dict[str, bool] = {}
    for entity_id, buckets in pattern.items():
        prob = buckets.get(key)
        if prob is None:
            prob = buckets.get(any_key)       # this weekday too thin: any day
        if prob is None:
            continue
        out[entity_id] = rand_fn() < (prob * intensity)
    return out


# ── Recorder glue (unverified against a real recorder — see module docstring) ─


async def _async_fetch_history(
    hass: HomeAssistant, entity_ids: list[str], days: int, end: datetime | None = None
) -> dict[str, list[tuple[float, str]]] | None:
    """{} when the recorder answered with nothing; None when the query itself
    failed — a failure is retried next tick, an empty answer only hourly."""
    if not entity_ids:
        return {}
    try:
        from homeassistant.helpers.recorder import get_instance  # noqa: PLC0415
        from homeassistant.components.recorder.history import get_significant_states  # noqa: PLC0415
        from homeassistant.util import dt as dt_util  # noqa: PLC0415
    except Exception as err:
        _LOGGER.debug("Vacation mode: recorder not available: %s", err)
        return None
    end = end or dt_util.utcnow()
    start = end - timedelta(days=days)
    try:
        instance = get_instance(hass)
        raw = await instance.async_add_executor_job(
            get_significant_states, hass, start, end, entity_ids
        )
    except Exception as err:
        _LOGGER.warning("Vacation mode: could not read history, skipping this cycle: %s", err)
        return None
    out: dict[str, list[tuple[float, str]]] = {}
    for entity_id, states in (raw or {}).items():
        out[entity_id] = [(s.last_changed.timestamp(), s.state) for s in states if s.last_changed]
    return out


def _eligible_entity_ids(hass: HomeAssistant) -> list[str]:
    """Every light and fan except groups (attributes.entity_id is a list):
    a group and its members would each be decided on their own and fight,
    and a group switched on reads, bulb by bulb, as a person's doing
    (review 2026-09-23)."""
    try:
        out = []
        for eid in hass.states.async_entity_ids():
            if not eid.startswith(VM_DOMAINS):
                continue
            st = hass.states.get(eid)
            attrs = st.attributes if st is not None and st.attributes else {}
            # light.group helpers list members as entity_id; integration
            # groups (WLED's main light, ZHA and MQTT groups) as
            # group_entities (HA 2026.3+) — re-review 2026-09-23.
            if any(isinstance(attrs.get(k), (list, tuple)) for k in ("entity_id", "group_entities")):
                continue
            out.append(eid)
        return out
    except Exception:
        return []


def switch_fields(data: dict, turn_on: bool, now_ts: float) -> dict:
    """The fields that go with switching Vacation Mode on or off — the ONE
    place its span bookkeeping lives, used by settings_set and by a settings
    restore alike. Off→on stamps the start; on→off closes the span into
    vacation_mode_periods. No change, no fields."""
    was_on = bool(data.get("vacation_mode_enabled"))
    if turn_on and not was_on:
        return {"vacation_mode_enabled_at": now_ts}
    if was_on and not turn_on:
        return {
            "vacation_mode_periods": closed_periods(data.get("vacation_mode_periods") or [],
                                                    data.get("vacation_mode_enabled_at") or 0, now_ts),
            "vacation_mode_enabled_at": 0,
        }
    return {}


def restore_fields(live: dict, restored: dict, now_ts: float) -> dict:
    """A settings restore replaces the whole store, but the live store's
    vacation bookkeeping describes what is really in the recorder: keep its
    spans, and apply the on/off change the restore makes as a switch. A
    vacation restored ON starts now with a fresh pattern, never an old one."""
    out = {"vacation_mode_periods": list(live.get("vacation_mode_periods") or [])}
    turn_on = bool(restored.get("vacation_mode_enabled"))
    out.update(switch_fields({**live, **out}, turn_on, now_ts))
    if turn_on and live.get("vacation_mode_enabled"):
        for k in ("vacation_mode_enabled_at", "vacation_mode_pattern",
                  "vacation_mode_pattern_until", "vacation_mode_pattern_built_at"):
            out[k] = live.get(k)
    elif turn_on:
        out.update(vacation_mode_pattern={}, vacation_mode_pattern_until=0, vacation_mode_pattern_built_at=0)
    else:
        out.setdefault("vacation_mode_enabled_at", 0)
    return out


async def _async_refresh_pattern_if_stale(hass: HomeAssistant, st: Any) -> None:
    """Build the pattern once per vacation, from history that ends when this
    vacation began — never from anything Vacation Mode itself switched (see
    the module docstring's NEVER LEARN FROM ITSELF)."""
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    now_ts = dt_util.utcnow().timestamp()
    built_at = st.data.get("vacation_mode_pattern_built_at") or 0
    enabled_at = st.data.get("vacation_mode_enabled_at") or 0
    if not enabled_at:
        # Turned on before this field existed: freeze the pattern it already
        # has (built before today's code could tell), or start the span now.
        enabled_at = built_at if (built_at and st.data.get("vacation_mode_pattern")) else now_ts
        await st.async_set(vacation_mode_enabled_at=enabled_at)
    # The history window a stored pattern covers ends at pattern_until; an
    # older pattern without it covered up to when it was built.
    until = st.data.get("vacation_mode_pattern_until") or built_at or 0
    if st.data.get("vacation_mode_pattern") and until >= enabled_at:
        return
    # Nothing usable last time for this same start: the window is fixed and
    # the recorder only purges it, so try again hourly, not every tick.
    attempt = st.data.get("vacation_mode_pattern_attempt") or [0, 0]
    if attempt[0] == enabled_at and now_ts - attempt[1] < RETRY_EMPTY_S:
        return
    entity_ids = _eligible_entity_ids(hass)
    end = dt_util.utc_from_timestamp(enabled_at)
    history = await _async_fetch_history(hass, entity_ids, HISTORY_DAYS, end=end)
    if history is None:
        return                      # the query failed: try again next tick
    pattern = build_pattern(history, dt_util.as_local(end),
                            exclude=st.data.get("vacation_mode_periods") or []) if history else {}
    if not pattern:
        _LOGGER.warning("Vacation mode: no usable light history before it was switched on; "
                        "it will not switch anything until there is (next try in an hour)")
        await st.async_set(vacation_mode_pattern_attempt=[enabled_at, now_ts])
        return
    await st.async_set(vacation_mode_pattern=pattern, vacation_mode_pattern_built_at=now_ts,
                       vacation_mode_pattern_until=enabled_at)


class VacationLog:
    """What Vacation Mode itself switched — [epoch_s, entity_id, 1|0] rows,
    14 days, its own Store so a busy evening never rewrites the settings
    file. Read by padspan_ha/vacation_log_get for Traceback's event list."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store = Store(hass, 1, LOG_STORE_KEY)
        self.entries: list[list] = []
        self._loaded = False

    async def async_load(self) -> None:
        if self._loaded:
            return
        data = await self._store.async_load() or {}
        self.entries = [e for e in (data.get("entries") or [])
                        if isinstance(e, list) and len(e) == 3 and isinstance(e[0], (int, float))]
        self._loaded = True

    async def async_append(self, ts: float, entity_id: str, on: bool) -> None:
        await self.async_load()
        self.entries.append([ts, entity_id, 1 if on else 0])
        self.entries = prune_log(self.entries, ts)
        self._store.async_delay_save(lambda: {"entries": self.entries}, LOG_SAVE_DELAY_S)

    async def async_between(self, start_ts: float, end_ts: float) -> list[list]:
        await self.async_load()
        return [e for e in self.entries if start_ts <= e[0] <= end_ts]


async def _async_tick(hass: HomeAssistant) -> None:
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    dom = hass.data.get(DOMAIN)
    if not dom:
        return
    st = dom.get(DATA_SETTINGS)
    if not st or not st.data.get("vacation_mode_enabled"):
        return
    await _async_refresh_pattern_if_stale(hass, st)
    # The refresh can wait seconds on the recorder: switched off meanwhile,
    # nothing may be switched after its span closed (review 2026-09-23).
    if not st.data.get("vacation_mode_enabled"):
        return
    pattern = st.data.get("vacation_mode_pattern") or {}
    if not pattern:
        return
    intensity = st.data.get("vacation_mode_intensity")
    if not isinstance(intensity, (int, float)) or isinstance(intensity, bool):
        intensity = 100
    local_now = dt_util.as_local(dt_util.utcnow())
    decisions = decide_states(pattern, local_now, intensity)
    for entity_id, want_on in decisions.items():
        # Defense in depth — same reasoning as async_reset_latch sharing
        # flood_latch.py's lock: never trust stored data alone for what is
        # ultimately a live service call.
        if not entity_id.startswith(VM_DOMAINS):
            continue
        state = hass.states.get(entity_id)
        if not state or state.state == "unavailable":
            continue
        is_on = state.state == "on"
        if is_on == want_on:
            continue
        domain = entity_id.split(".", 1)[0]
        service = "turn_on" if want_on else "turn_off"
        try:
            await hass.services.async_call(domain, service, {"entity_id": entity_id})
        except Exception as err:
            _LOGGER.debug("Vacation mode: could not %s %s: %s", service, entity_id, err)
            continue
        log = dom.get(_VM_LOG)   # created by async_setup_vacation_mode
        if log is not None:
            await log.async_append(dt_util.utcnow().timestamp(), entity_id, want_on)


def async_setup_vacation_mode(hass: HomeAssistant) -> None:
    """Idempotent across config-entry reloads — same shape as
    forensics_store.async_setup_forensics's sampler registration.
    async_track_time_interval's own callback is always loop-scheduled (no
    @callback-marker dispatch ambiguity — unlike hass.bus.async_listen,
    see flood_latch.py's docstring), so a plain closure is safe here, the
    same way forensics_store's/telemetry.py's/update_check.py's own timers
    are already written."""
    from homeassistant.helpers.event import async_track_time_interval  # noqa: PLC0415

    dom = hass.data.setdefault(DOMAIN, {})
    if dom.get(_VM_UNSUB):
        return
    dom.setdefault(_VM_LOG, VacationLog(hass))

    async def _run(_now: Any = None) -> None:
        await _async_tick(hass)

    dom[_VM_UNSUB] = async_track_time_interval(hass, _run, CHECK_INTERVAL)


def async_stop_vacation_mode(hass: HomeAssistant) -> None:
    unsub = hass.data.get(DOMAIN, {}).pop(_VM_UNSUB, None)
    if unsub:
        try:
            unsub()
        except Exception:
            pass
