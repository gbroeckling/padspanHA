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
PATTERN_REFRESH = timedelta(days=1)

_VM_UNSUB = "_vacation_mode_unsub"


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


def build_pattern(
    history: dict[str, list[tuple[float, str]]],
    now: datetime,
    history_days: int = HISTORY_DAYS,
) -> dict[str, dict[str, float]]:
    """`history`: {entity_id: [(epoch_s, "on"|"off"|other), ...]} — raw
    recorder transitions, already in whatever units state_at expects
    (epoch seconds; `now` and every timestamp inside `history` must agree
    on timezone, since only their relative order and bucket_key(now-derived
    sample point) matter here). Returns {entity_id: {bucket_key: on_probability}},
    omitting any (entity, bucket) with fewer than MIN_SAMPLES real
    on/off observations — no data beats a confident-looking guess from one
    fluke."""
    start = now - timedelta(days=history_days)
    points = sample_points(start, now)
    pattern: dict[str, dict[str, float]] = {}
    for entity_id, changes in history.items():
        if not changes:
            continue
        counts: dict[str, list[int]] = {}
        for pt in points:
            st = state_at(changes, pt.timestamp())
            if st not in ("on", "off"):
                continue
            key = bucket_key(pt)
            on, total = counts.get(key, [0, 0])
            counts[key] = [on + (1 if st == "on" else 0), total + 1]
        buckets = {k: on / total for k, (on, total) in counts.items() if total >= MIN_SAMPLES}
        if buckets:
            pattern[entity_id] = buckets
    return pattern


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
    intensity = max(0.0, min(1.0, (intensity_pct or 0) / 100.0))
    out: dict[str, bool] = {}
    for entity_id, buckets in pattern.items():
        prob = buckets.get(key)
        if prob is None:
            continue
        out[entity_id] = rand_fn() < (prob * intensity)
    return out


# ── Recorder glue (unverified against a real recorder — see module docstring) ─


async def _async_fetch_history(
    hass: HomeAssistant, entity_ids: list[str], days: int
) -> dict[str, list[tuple[float, str]]]:
    if not entity_ids:
        return {}
    try:
        from homeassistant.helpers.recorder import get_instance  # noqa: PLC0415
        from homeassistant.components.recorder.history import get_significant_states  # noqa: PLC0415
        from homeassistant.util import dt as dt_util  # noqa: PLC0415
    except Exception as err:
        _LOGGER.debug("Vacation mode: recorder not available: %s", err)
        return {}
    end = dt_util.utcnow()
    start = end - timedelta(days=days)
    try:
        instance = get_instance(hass)
        raw = await instance.async_add_executor_job(
            get_significant_states, hass, start, end, entity_ids
        )
    except Exception as err:
        _LOGGER.warning("Vacation mode: could not read history, skipping this cycle: %s", err)
        return {}
    out: dict[str, list[tuple[float, str]]] = {}
    for entity_id, states in (raw or {}).items():
        out[entity_id] = [(s.last_changed.timestamp(), s.state) for s in states if s.last_changed]
    return out


def _eligible_entity_ids(hass: HomeAssistant) -> list[str]:
    try:
        return [eid for eid in hass.states.async_entity_ids() if eid.startswith(VM_DOMAINS)]
    except Exception:
        return []


async def _async_refresh_pattern_if_stale(hass: HomeAssistant, st: Any) -> None:
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    now = dt_util.utcnow()
    built_at = st.data.get("vacation_mode_pattern_built_at") or 0
    if isinstance(built_at, (int, float)) and not isinstance(built_at, bool) and built_at > 0:
        if (now.timestamp() - built_at) < PATTERN_REFRESH.total_seconds():
            return
    entity_ids = _eligible_entity_ids(hass)
    history = await _async_fetch_history(hass, entity_ids, HISTORY_DAYS)
    if not history:
        return
    local_now = dt_util.as_local(now)
    pattern = build_pattern(history, local_now)
    if not pattern:
        return
    await st.async_set(vacation_mode_pattern=pattern, vacation_mode_pattern_built_at=now.timestamp())


async def _async_tick(hass: HomeAssistant) -> None:
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    dom = hass.data.get(DOMAIN)
    if not dom:
        return
    st = dom.get(DATA_SETTINGS)
    if not st or not st.data.get("vacation_mode_enabled"):
        return
    await _async_refresh_pattern_if_stale(hass, st)
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
