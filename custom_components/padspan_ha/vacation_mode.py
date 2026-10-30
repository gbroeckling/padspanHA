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

THE DECISION: decide_states draws a weighted random per (entity, window, day)
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
RETRY_FAILED_S = 900

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
    # The sample points and their slots are the same for every entity; each
    # entity's changes are sorted once and walked alongside them (round 6:
    # re-sorting per sample point took seconds on HA's event loop).
    points = [(pt.timestamp(), bucket_key(pt), any_day_key(pt)) for pt in sample_points(start, now)]
    pattern: dict[str, dict[str, float]] = {}
    for entity_id, changes in history.items():
        if not changes:
            continue
        spans = entity_exclusions(changes, exclude or [], now.timestamp())
        ordered = sorted(changes, key=lambda c: c[0])
        idx, st = 0, None
        counts: dict[str, list[int]] = {}
        for ts, key_day, key_any in points:
            # The state holding at ts: the latest change at or before it.
            while idx < len(ordered) and ordered[idx][0] <= ts:
                st = ordered[idx][1]
                idx += 1
            if in_periods(ts, spans):
                continue
            if st not in ("on", "off"):
                continue
            # Each sample counts toward its own weekday slot and toward the
            # same slot on any day — the fallback when a weekday has too few
            # (review 2026-09-23: with the recorder's default 10 days, a trip
            # starting on a Friday had no Sat/Sun/Mon data at all, and the
            # house went dark every weekend).
            for key in (key_day, key_any):
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


def _window_draw(entity_id: str, at: datetime, key: str) -> float:
    """One number in [0, 1) per light per schedule window per day. A fresh
    draw on every 5-minute tick made a light below 100% intensity flip
    on and off all evening (24 switches in 4 hours at 50%)."""
    import hashlib  # noqa: PLC0415
    h = hashlib.blake2b(f"{entity_id}|{at.date().isoformat()}|{key}".encode(), digest_size=8).digest()
    return int.from_bytes(h, "big") / 2 ** 64


def decide_states(
    pattern: dict[str, dict[str, float]],
    at: datetime,
    intensity_pct: float,
    rand_fn=None,
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
        draw = rand_fn() if rand_fn is not None else _window_draw(entity_id, at, key)
        out[entity_id] = draw < (prob * intensity)
    return out


# ── Recorder glue (unverified against a real recorder — see module docstring) ─


async def _async_fetch_history(
    hass: HomeAssistant, entity_ids: list[str], days: int, end: datetime | None = None
) -> dict[str, list[tuple[float, str]]] | None:
    """{} when there is nothing to read (no recorder, or no rows); None when
    the query itself failed — a failure is retried in 15 minutes, an empty
    answer after an hour."""
    if not entity_ids:
        return {}
    try:
        from homeassistant.helpers.recorder import get_instance  # noqa: PLC0415
        from homeassistant.components.recorder.history import get_significant_states  # noqa: PLC0415
        from homeassistant.util import dt as dt_util  # noqa: PLC0415
    except Exception as err:
        # No recorder at all is not a failed query: it's an empty answer, and
        # waits the hour like one (re-review round 3).
        _LOGGER.debug("Vacation mode: recorder not available: %s", err)
        return {}
    end = end or dt_util.utcnow()
    start = end - timedelta(days=days)
    try:
        instance = get_instance(hass)
    except Exception as err:        # recorder not set up: nothing to read, not a failure
        _LOGGER.debug("Vacation mode: recorder not set up: %s", err)
        return {}
    try:
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


def _platform_of(hass: HomeAssistant, entity_id: str) -> str | None:
    from homeassistant.helpers import entity_registry as er  # noqa: PLC0415
    ent = er.async_get(hass).async_get(entity_id)
    return getattr(ent, "platform", None) if ent else None


def _eligible_entity_ids(hass: HomeAssistant) -> list[str]:
    """Every light and fan, each physical light decided exactly once — a group
    and its members decided separately fight, and read bulb by bulb as a
    person's doing (reviews 2026-09-23). The members are what's kept, with
    ONE exception:
    - a light.group helper (attributes.entity_id) — drop the helper; and
      recognised first, so a helper that also publishes group_entities
      never takes its members down with it;
    - an integration group (attributes.group_entities, HA 2026.3+):
      * WLED's main light, while it works, IS the strip's power — its
        segment lights can't turn the strip on: keep it, drop its segments;
      * anything else (ZHA, MQTT groups) — drop the group, keep the bulbs:
        one lamp's routine must not light a whole floor, and overlapping
        groups would fight over shared bulbs (round 4)."""
    try:
        states = {eid: hass.states.get(eid) for eid in hass.states.async_entity_ids() if eid.startswith(VM_DOMAINS)}
    except Exception:
        return []
    drop: set[str] = set()
    for eid, st in states.items():
        attrs = (st.attributes if st is not None and st.attributes else {}) or {}
        if isinstance(attrs.get("entity_id"), (list, tuple)):
            drop.add(eid)
            continue
        members = attrs.get("group_entities")
        if not isinstance(members, (list, tuple)):
            continue
        try:
            wled_main = _platform_of(hass, eid) == "wled"
        except Exception:  # noqa: BLE001 — no registry: treat as an ordinary group
            wled_main = False
        usable = st is not None and st.state not in ("unavailable", "unknown") and not attrs.get("restored")
        if wled_main and usable:
            drop.update(m for m in members if m != eid)
        else:
            drop.add(eid)
    # A WLED team follower takes its lights from its leader over sync;
    # switching it separately would fight the leader (ws_wled.py teams). A
    # registry hiccup here costs only the team filtering, never the whole list.
    st = (hass.data.get(DOMAIN) or {}).get(DATA_SETTINGS)
    teams = (st.data.get("wled_teams") if st else None) or []
    if teams:
        try:
            from .ws_wled import follower_light_entities  # noqa: PLC0415
            drop |= follower_light_entities(hass, teams)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Vacation mode: couldn't read WLED teams, switching every light: %s", err)
    return [eid for eid in states if eid not in drop]


def learned_pattern(data: dict) -> dict:
    """The newest pattern learned under today's rules — from history that
    ended when a vacation began (pattern_until set) and began after every
    vacation in it was recorded (vacation_mode_tracked_since), so never from
    Vacation Mode's own switching. An install that ran Vacation Mode before
    spans were recorded has unrecorded ones in the recorder for up to
    HISTORY_DAYS (round 6); a pattern that could have learned from those,
    or one from before pattern_until existed, is never carried."""
    since = data.get("vacation_mode_tracked_since") or 0
    until = data.get("vacation_mode_pattern_until") or 0
    if data.get("vacation_mode_pattern") and until and (not since or until - HISTORY_DAYS * 86400 >= since):
        return data["vacation_mode_pattern"]
    return data.get("vacation_mode_pattern_prev") or {}


# Turned back on within this long of a trip ending, Vacation Mode carries on
# with that trip's routine. The days since are most likely the empty house
# (2026-10-25: one tap turned it off mid-trip, and the house sat dark for
# 11 days): a fresh build would learn those days as the routine and keep
# the lights off.
RESUME_S = 21 * 86400


def resumable(data: dict, now_ts: float) -> bool:
    """True when the last vacation ended under RESUME_S ago and the stored
    pattern is the one it ran on (learned for it, or carried into it)."""
    periods = [p for p in (data.get("vacation_mode_periods") or [])
               if isinstance(p, (list, tuple)) and len(p) == 2
               and isinstance(p[0], (int, float)) and isinstance(p[1], (int, float))]
    if not periods or not data.get("vacation_mode_pattern"):
        return False
    start, end = periods[-1]
    if not 0 <= now_ts - end <= RESUME_S:
        return False
    until = data.get("vacation_mode_pattern_until") or 0
    served = data.get("vacation_mode_pattern_for") or 0
    return abs(until - start) < 1 or abs(served - start) < 1


def pattern_serves(data: dict) -> bool:
    """The stored pattern is this vacation's own: learned from history that
    ends at its start, or carried over from the trip it resumes."""
    if not data.get("vacation_mode_pattern"):
        return False
    enabled_at = data.get("vacation_mode_enabled_at") or 0
    until = data.get("vacation_mode_pattern_until") or data.get("vacation_mode_pattern_built_at") or 0
    return until >= enabled_at or bool(enabled_at and data.get("vacation_mode_pattern_for") == enabled_at)


def switch_fields(data: dict, turn_on: bool, now_ts: float, who: dict | None = None) -> dict:
    """The fields that go with switching Vacation Mode on or off — the ONE
    place its span bookkeeping lives, used by settings_set and by a factory
    reset alike. Off→on stamps the start; on→off closes the span into
    vacation_mode_periods and records who did it (`who`: by / via / how).
    No change, no fields."""
    was_on = bool(data.get("vacation_mode_enabled"))
    if turn_on and not was_on:
        if resumable(data, now_ts):
            # The same trip carrying on: its pattern stays. The span closed
            # when it was turned off stays closed — those days were not
            # Vacation Mode's switching.
            return {"vacation_mode_enabled_at": now_ts, "vacation_mode_pattern_for": now_ts}
        # A new vacation gets a new pattern. The last one learned is kept
        # aside: the recorder may already have purged the days before this
        # start (an off/on mid-trip, a trip right after another), and then
        # it stands in rather than leaving the house dark (round 5).
        return {"vacation_mode_enabled_at": now_ts, "vacation_mode_pattern": {}, "vacation_mode_pattern_until": 0,
                "vacation_mode_pattern_prev": learned_pattern(data), "vacation_mode_pattern_for": 0}
    if was_on and not turn_on:
        return {
            "vacation_mode_periods": closed_periods(data.get("vacation_mode_periods") or [],
                                                    data.get("vacation_mode_enabled_at") or 0, now_ts),
            "vacation_mode_enabled_at": 0,
            "vacation_mode_last_off": {"ts": now_ts, **(who or {})},
        }
    return {}


# Everything Vacation Mode keeps, with its defaults (settings_store DEFAULTS).
STATE_KEYS = {
    "vacation_mode_enabled": False, "vacation_mode_intensity": 100, "vacation_mode_pattern": {},
    "vacation_mode_pattern_built_at": 0, "vacation_mode_pattern_until": 0, "vacation_mode_enabled_at": 0,
    "vacation_mode_periods": [], "vacation_mode_tracked_since": 0, "vacation_mode_pattern_prev": {},
    "vacation_mode_pattern_attempt": [0, 0], "vacation_mode_pattern_for": 0, "vacation_mode_last_off": {},
    "vacation_mode_end_at": 0,
}


def restore_fields(live: dict) -> dict:
    """A settings restore leaves Vacation Mode exactly as it is: whether the
    house is away is about now, not when the backup was taken, and its
    bookkeeping describes what is in the recorder now. Restoring an older
    backup mid-trip used to turn it off without a word (2026-10-25)."""
    return {k: live.get(k, d) for k, d in STATE_KEYS.items()}


def who_from_connection(hass: HomeAssistant, connection: Any) -> dict:
    """Who switched Vacation Mode off, as the notice and the panel show it:
    the Home Assistant user, and the app or browser they used."""
    user = getattr(connection, "user", None)
    out = {"by": str(getattr(user, "name", None) or "someone")[:60], "how": "panel", "via": "a web browser"}
    try:
        tok = hass.auth.async_get_refresh_token(getattr(connection, "refresh_token_id", None) or "")
        client = str(getattr(tok, "client_id", None) or "").lower()
        name = getattr(tok, "client_name", None)
        if "android" in client:
            out["via"] = "the Android app"
        elif "ios" in client:
            out["via"] = "the iPhone app"
        elif name:
            out["via"] = str(name)[:60]
    except Exception:  # noqa: BLE001 — the user's name is enough
        pass
    return out


def off_message(who: dict, when: str) -> str:
    """The turned-off notice, for the HA notification and the alert targets."""
    if who.get("how") == "end_date":
        return f"Vacation Mode ended {when}, on the end date set for it."
    if who.get("how") == "reset":
        cause = "by a PadSpan factory reset"
    else:
        cause = f"by {who.get('by') or 'someone'} from {who.get('via') or 'a web browser'}"
    return (f"Vacation Mode was turned off {when} {cause}. If nobody meant to, turn it back on "
            f"in Whole House Presets: within 3 weeks it carries on with the routine it was using.")


async def async_notify_turned_off(hass: HomeAssistant, who: dict, now_ts: float) -> bool:
    """Tell the house Vacation Mode went off: a Home Assistant notification,
    and the phones or mail Follow alerts go to. Nobody heard when one tap
    turned it off mid-trip (2026-10-25). True if the notice left for at least
    one alert target."""
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    local = dt_util.as_local(dt_util.utc_from_timestamp(now_ts))
    when = f"{local.strftime('%b')} {local.day}, {local.strftime('%H:%M')}"
    title = "PadSpan: Vacation Mode ended" if who.get("how") == "end_date" else "PadSpan: Vacation Mode turned off"
    message = off_message(who, when)
    try:
        from homeassistant.components.persistent_notification import async_create  # noqa: PLC0415
        async_create(hass, message, title=title, notification_id="padspan_ha_vacation_off")
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Vacation mode: no notification: %s", err)
    targets: list[tuple[str, str]] = []
    try:
        from .const import DATA_ALERTS  # noqa: PLC0415
        store = (hass.data.get(DOMAIN) or {}).get(DATA_ALERTS)
        for cfg in ((store.all() if store else None) or {}).values():
            if not isinstance(cfg, dict):
                continue
            t = (str(cfg.get("notify_service") or "").strip(), str(cfg.get("email") or "").strip())
            if any(t) and t not in targets:
                targets.append(t)
    except Exception as err:  # noqa: BLE001
        _LOGGER.debug("Vacation mode: could not read alert targets: %s", err)
    sent = False
    if targets:
        from .presence_coordinator import async_send_follow_notify  # noqa: PLC0415
        for preferred, email in targets[:5]:
            try:
                await async_send_follow_notify(hass, preferred, email, title, message)
                sent = True
            except Exception as err:  # noqa: BLE001 — FollowNotifyNotSent or the call's own
                _LOGGER.warning("Vacation mode: turned-off notice not sent via %s: %s", preferred or email, err)
    return sent


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
    if pattern_serves(st.data):
        return
    # Nothing usable last time for this same start: the window is fixed and
    # the recorder only purges it, so try again hourly, not every tick.
    attempt = st.data.get("vacation_mode_pattern_attempt") or [0, 0]
    if attempt[0] == enabled_at and now_ts - attempt[1] < RETRY_EMPTY_S:
        return
    # Every light and fan is learned; which of them to switch is decided at
    # each tick. A WLED strip offline right now still gets its main light
    # learned, and switched once it's back (round 5).
    entity_ids = [eid for eid in hass.states.async_entity_ids() if eid.startswith(VM_DOMAINS)]
    end = dt_util.utc_from_timestamp(enabled_at)
    history = await _async_fetch_history(hass, entity_ids, HISTORY_DAYS, end=end)
    if history is None:
        # The query failed: retry in 15 minutes, not every tick and not after
        # the hour an empty answer waits.
        await st.async_set(vacation_mode_pattern_attempt=[enabled_at, now_ts - RETRY_EMPTY_S + RETRY_FAILED_S])
        return
    # Pure and CPU-bound over up to 30 days of every light: off the event loop.
    pattern = await hass.async_add_executor_job(
        build_pattern, history, dt_util.as_local(end), HISTORY_DAYS,
        st.data.get("vacation_mode_periods") or []) if history else {}
    if not pattern:
        _LOGGER.warning("Vacation mode: no usable light history before it was switched on; %s (next try in an hour)",
                        "using the pattern learned before the last vacation" if st.data.get("vacation_mode_pattern_prev")
                        else "it will not switch anything until there is")
        await st.async_set(vacation_mode_pattern_attempt=[enabled_at, now_ts])
        return
    await st.async_set(vacation_mode_pattern=pattern, vacation_mode_pattern_built_at=now_ts,
                       vacation_mode_pattern_until=enabled_at)


# ── The opt-in report's view (telemetry.py env.vacation) ─────────────────────
# Closed words only, and only for an install that has used Vacation Mode: is
# it on, how strong, how many lights it learned, how it is running (its own
# pattern, a resumed trip's, the stand-in, or nothing yet), how often it
# switches, trips and their length, and how it was last turned off.
REPORT_WORDS = {
    "on": ("yes", "no"),
    "intensity": ("100", "75-95", "50-70", "25-45", "5-20"),
    "lights": ("0", "1-5", "6-15", "16-40", "41+"),
    "pattern": ("own", "resumed", "standin", "none"),
    "switches_day": ("0", "1-10", "11-50", "51-200", "201+"),
    "trips_60d": ("0", "1", "2-3", "4+"),
    "last_trip_days": ("<1", "1-3", "4-7", "8-14", "15+"),
    "last_off": ("panel", "reset", "end_date", "none"),
    "after_dark": ("yes", "no"),
    "end_date": ("yes", "no"),
    "pause_home": ("yes", "no"),
    "bedtime": ("yes", "no"),
    "max_on": ("yes", "no"),
    "max_lights": ("yes", "no"),
    "anchors": ("yes", "no"),
}


def _bucket(n: float, edges: tuple, words: tuple) -> str:
    """words[i] for the first edge n is at or under; the last word past them."""
    for edge, word in zip(edges, words):
        if n <= edge:
            return word
    return words[-1]


def routine_word(data: dict) -> str:
    """Which routine a running vacation switches on: its own, the last
    trip's (resumed), the stand-in while its own is not built, or none yet."""
    enabled_at = data.get("vacation_mode_enabled_at") or 0
    if pattern_serves(data):
        return "resumed" if enabled_at and data.get("vacation_mode_pattern_for") == enabled_at else "own"
    return "standin" if data.get("vacation_mode_pattern_prev") else "none"


def report_buckets(data: dict, log_entries: list, now_ts: float) -> dict | None:
    """env.vacation for the opt-in report, or None where Vacation Mode was
    never used (a field only where it applies)."""
    periods = [p for p in (data.get("vacation_mode_periods") or [])
               if isinstance(p, (list, tuple)) and len(p) == 2
               and isinstance(p[0], (int, float)) and isinstance(p[1], (int, float))]
    on = bool(data.get("vacation_mode_enabled"))
    if not on and not periods:
        return None
    pct = data.get("vacation_mode_intensity")
    pct = 100 if not isinstance(pct, (int, float)) or isinstance(pct, bool) else pct
    out = {"on": "yes" if on else "no",
           "intensity": _bucket(pct, (20, 45, 70, 95), ("5-20", "25-45", "50-70", "75-95", "100"))}
    enabled_at = data.get("vacation_mode_enabled_at") or 0
    if on:
        out["pattern"] = routine_word(data)
        pat = {"own": data.get("vacation_mode_pattern"), "resumed": data.get("vacation_mode_pattern"),
               "standin": data.get("vacation_mode_pattern_prev")}.get(out["pattern"]) or {}
        out["lights"] = _bucket(len(pat), (0, 5, 15, 40), ("0", "1-5", "6-15", "16-40", "41+"))
        span = (enabled_at, now_ts)
    else:
        span = (periods[-1][0], periods[-1][1])
    days = max((span[1] - span[0]) / 86400, 1 / 24)
    n = sum(1 for e in log_entries or [] if isinstance(e, (list, tuple)) and e and span[0] <= e[0] <= span[1])
    out["switches_day"] = _bucket(n / days, (0, 10, 50, 200), ("0", "1-10", "11-50", "51-200", "201+"))
    recent = [p for p in periods if p[1] >= now_ts - 60 * 86400]
    out["trips_60d"] = _bucket(len(recent), (0, 1, 3), ("0", "1", "2-3", "4+"))
    if periods:
        last = (periods[-1][1] - periods[-1][0]) / 86400
        out["last_trip_days"] = _bucket(last, (1, 3, 7, 14), ("<1", "1-3", "4-7", "8-14", "15+"))
    how = (data.get("vacation_mode_last_off") or {}).get("how")
    out["last_off"] = how if how in ("panel", "reset", "end_date") else "none"
    yes = lambda v: "yes" if v else "no"  # noqa: E731
    out["after_dark"] = yes(data.get("vacation_mode_dark_only"))
    out["end_date"] = yes(data.get("vacation_mode_end_at"))
    out["pause_home"] = yes(data.get("vacation_mode_pause_home"))
    out["bedtime"] = yes(bedtime_minutes(data.get("vacation_mode_bedtime")) is not None)
    out["max_on"] = yes(data.get("vacation_mode_max_on_min"))
    out["max_lights"] = yes(data.get("vacation_mode_max_lights"))
    out["anchors"] = yes(data.get("vacation_mode_anchors"))
    return out


# ── Trip options (0.38.172) — every one off until set ───────────────────────
# What the common away-lighting products offer around the same idea (Hue's
# Mimic presence and Kasa's Away Mode switch only after dark, Vacation
# Lighting Director stops while anyone is home, Lutron's Smart Away has an
# end time), on top of the routine this module learns. Each narrows what the
# pattern asks for; none ever turns a light on that the pattern did not —
# except the anchor lights, which are chosen by name to be held on (apply_anchors).
OPTION_DEFAULTS = {
    "vacation_mode_dark_only": False,     # lights go on only after sunset (+ offset) and before sunrise (- offset)
    "vacation_mode_dark_offset_min": 0,   # -60..120 minutes; positive waits longer after sunset
    "vacation_mode_end_at": 0,            # epoch-s the trip ends: Vacation Mode turns itself off then; 0 = no end
    "vacation_mode_pause_home": False,    # anyone's person.* at home: nothing is switched until they leave
    "vacation_mode_bedtime": "",          # "HH:MM": every light it runs goes off from then (±20 min, a new draw each night) until 05:00
    "vacation_mode_max_on_min": 0,        # 0 = no limit; else a light it turned on goes off after this many minutes, and rests as long
    "vacation_mode_max_lights": 0,        # 0 = no limit; else at most this many of the pattern's lights on at once
    "vacation_mode_anchors": [],          # light entity ids held on through the evening (anchor_window)
}
DARK_OFFSET_RANGE = (-60, 120)
MAX_ON_RANGE = (15, 720)
MAX_LIGHTS_RANGE = (1, 50)
ANCHORS_MAX = 10
# Anchor lights go off at the bedtime, or at about this time without one.
ANCHOR_DEFAULT_OFF = "23:00"
BEDTIME_JITTER_MIN = 20
BEDTIME_UNTIL_MIN = 5 * 60
END_AT_MAX_S = 366 * 86400
# The tick's in-memory state (lost on restart, rebuilt from the log or begun again).
_VM_CAPPED = "_vacation_mode_capped"      # {entity_id: epoch-s} — rests until then (max on-time)
_VM_PAUSED = "_vacation_mode_paused"      # True while paused because someone is home
_VM_RULE_DAY = "_vacation_mode_rule_day"  # {rule: local date} — each rule counted once a day
SIGNAL_VACATION = "padspan_ha_vacation_update"   # dispatcher: the status entity re-reads
EVENT_VACATION = "padspan_ha_vacation_mode"      # bus: {on, how} on every change


def bedtime_minutes(value: Any) -> int | None:
    """Minute of the day for an "HH:MM" bedtime between 17:00 and 03:00, else
    None (empty, malformed, or a time of day that is not a bedtime)."""
    if not isinstance(value, str) or len(value) != 5 or value[2] != ":":
        return None
    try:
        h, m = int(value[:2]), int(value[3:])
    except ValueError:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    mins = h * 60 + m
    return mins if mins >= 17 * 60 or mins <= 3 * 60 else None


def _night_jitter(night: str) -> int:
    """-BEDTIME_JITTER_MIN..+BEDTIME_JITTER_MIN, the same all night, a new
    one each night: a house that goes dark at 23:30 sharp every night reads as
    a timer."""
    import hashlib  # noqa: PLC0415
    h = hashlib.blake2b(f"bedtime|{night}".encode(), digest_size=4).digest()
    return int.from_bytes(h, "big") % (2 * BEDTIME_JITTER_MIN + 1) - BEDTIME_JITTER_MIN


def in_bedtime(at: datetime, bedtime: str) -> bool:
    """True from tonight's bedtime (with its jitter) until 05:00. `at` is
    local time; the small hours belong to the night that began the evening
    before."""
    base = bedtime_minutes(bedtime)
    if base is None:
        return False
    night = (at - timedelta(hours=12)).date().isoformat()
    start = (base + _night_jitter(night)) % 1440
    t = at.hour * 60 + at.minute
    if start > BEDTIME_UNTIL_MIN:          # an evening bedtime: on past midnight
        return t >= start or t < BEDTIME_UNTIL_MIN
    return start <= t < BEDTIME_UNTIL_MIN


def is_dark(now_ts: float, sunrise_ts: float | None, sunset_ts: float | None, offset_min: float) -> bool | None:
    """Dark enough for lights: after today's sunset + offset, or before
    today's sunrise - offset. None when the sun times are unknown (polar
    day or night, no location)."""
    if sunrise_ts is None or sunset_ts is None:
        return None
    off = (offset_min or 0) * 60
    return now_ts >= sunset_ts + off or now_ts < sunrise_ts - off


def apply_options(decisions: dict[str, bool], *, data: dict, now_ts: float, at_local: datetime,
                  dark: bool | None, on_since: dict[str, float], capped: dict[str, float],
                  lit: set | None = None) -> tuple[dict, set]:
    """The trip options over the pattern's decisions — pure. Returns the
    decisions and which rules changed any (for the report). An option only
    ever turns an "on" into an "off": nothing here lights anything. `lit`:
    the pattern's lights on right now (the most-at-once cap keeps those)."""
    out = dict(decisions)
    used: set[str] = set()

    def hold(eid: str, rule: str) -> None:
        if out.get(eid):
            out[eid] = False
            used.add(rule)

    if data.get("vacation_mode_dark_only") and dark is False:
        for eid in list(out):
            hold(eid, "dark")
    if in_bedtime(at_local, data.get("vacation_mode_bedtime") or ""):
        for eid in list(out):
            hold(eid, "bedtime")
    max_on = data.get("vacation_mode_max_on_min") or 0
    if isinstance(max_on, (int, float)) and not isinstance(max_on, bool) and max_on > 0:
        for eid in list(out):
            if capped.get(eid, 0) > now_ts:
                hold(eid, "max_on")
            elif eid in on_since and now_ts - on_since[eid] >= max_on * 60:
                hold(eid, "max_on")
                capped[eid] = now_ts + max_on * 60
    cap = data.get("vacation_mode_max_lights") or 0
    if isinstance(cap, int) and not isinstance(cap, bool) and cap > 0:
        # Over the cap: the lights already on keep their place (no swapping
        # every tick), then the ones this window's draw wants most.
        key = bucket_key(at_local)
        ons = sorted((eid for eid, v in out.items() if v),
                     key=lambda e: (e not in (lit or ()), _window_draw(e, at_local, key), e))
        for eid in ons[cap:]:
            hold(eid, "max_lights")
    return out, used


def anchor_ids(data: dict, eligible: set | None = None) -> list[str]:
    """The anchor lights set: lights only, at most ANCHORS_MAX, and only ones
    Vacation Mode may switch (`eligible`, when given)."""
    raw = data.get("vacation_mode_anchors")
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[str] = []
    for eid in raw:
        if (isinstance(eid, str) and eid.startswith("light.") and eid not in out
                and (eligible is None or eid in eligible)):
            out.append(eid)
    return out[:ANCHORS_MAX]


def anchor_window(at_local: datetime, dark: bool | None, bedtime: str) -> bool:
    """True while anchor lights are held on: dark (after sunset + the
    after-dark offset), in the evening, until the bedtime — or about
    ANCHOR_DEFAULT_OFF without one, with the same nightly jitter. Never in
    the small hours past it, never with the sun unknown."""
    if dark is not True:
        return False
    t = at_local.hour * 60 + at_local.minute
    if not (t >= 12 * 60 or t < BEDTIME_UNTIL_MIN):
        return False
    bed = bedtime if bedtime_minutes(bedtime) is not None else ANCHOR_DEFAULT_OFF
    return not in_bedtime(at_local, bed)


def apply_anchors(decisions: dict[str, bool], anchors: list[str], window: bool, ours: set) -> tuple[dict, bool]:
    """Anchor lights over the decisions — pure. In the window they are on,
    whatever the pattern and the options said. Out of it the pattern decides
    them as any other light; one the pattern says nothing about goes off only
    if Vacation Mode turned it on (`ours`), so a porch light a person put on
    is left alone. Returns the decisions and whether an anchor was held on."""
    out = dict(decisions)
    held = False
    for eid in anchors:
        if window:
            held = held or not out.get(eid)
            out[eid] = True
        elif eid not in out and eid in ours:
            out[eid] = False
    return out, held


def someone_home(hass: HomeAssistant) -> bool:
    """Any person.* entity at home, or a guest whose stay counts as someone
    home (a house-sitter; guest_tags.py) with the tag here."""
    try:
        if any(s.state == "home" for s in hass.states.async_all("person")):
            return True
    except Exception:  # noqa: BLE001
        pass
    try:
        from .guest_tags import counts_home_present  # noqa: PLC0415
        return counts_home_present(hass)
    except Exception:  # noqa: BLE001
        return False


def _sun_times(hass: HomeAssistant, at_local: datetime) -> tuple[float | None, float | None]:
    """Today's sunrise and sunset (epoch-s) at the house, or (None, None)."""
    try:
        from homeassistant.helpers.sun import get_astral_event_date  # noqa: PLC0415
        rise = get_astral_event_date(hass, "sunrise", at_local.date())
        sset = get_astral_event_date(hass, "sunset", at_local.date())
        return (rise.timestamp() if rise else None, sset.timestamp() if sset else None)
    except Exception:  # noqa: BLE001
        return (None, None)


def _dark_now(hass: HomeAssistant, now_ts: float, at_local: datetime, offset_min: float) -> bool | None:
    rise, sset = _sun_times(hass, at_local)
    dark = is_dark(now_ts, rise, sset, offset_min)
    if dark is None:
        # Polar day or night, or no sun helper: sun.sun says which.
        sun = hass.states.get("sun.sun") if hasattr(hass, "states") else None
        if sun is not None and sun.state in ("above_horizon", "below_horizon"):
            return sun.state == "below_horizon"
    return dark


def on_since_from_log(entries: list, eids: set) -> dict[str, float]:
    """When Vacation Mode last turned each light on, if that is still the last
    thing it did to it (the max on-time counts from there)."""
    out: dict[str, float] = {}
    seen: set[str] = set()
    for e in reversed(entries or []):
        if not isinstance(e, (list, tuple)) or len(e) != 3:
            continue
        ts, eid, on = e
        if eid in seen or eid not in eids:
            continue
        seen.add(eid)
        if on:
            out[eid] = ts
    return out


def announce(hass: HomeAssistant, on: bool, how: str) -> None:
    """Tell automations and the status entity: an event on HA's bus, and a
    signal binary_sensor.padspan_vacation_mode re-reads on."""
    try:
        hass.bus.async_fire(EVENT_VACATION, {"on": bool(on), "how": how})
    except Exception:  # noqa: BLE001
        pass
    refresh_status(hass)


def status_attributes(hass: HomeAssistant, data: dict) -> dict:
    """binary_sensor.padspan_vacation_mode's attributes."""
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    def iso(ts: Any) -> str | None:
        return dt_util.utc_from_timestamp(ts).isoformat() if isinstance(ts, (int, float)) and ts > 0 else None
    on = bool(data.get("vacation_mode_enabled"))
    last = data.get("vacation_mode_last_off") or {}
    return {
        "since": iso(data.get("vacation_mode_enabled_at")) if on else None,
        "routine": routine_word(data) if on else None,
        "paused_someone_home": bool(on and (hass.data.get(DOMAIN) or {}).get(_VM_PAUSED)),
        "ends": iso(data.get("vacation_mode_end_at")),
        "intensity": data.get("vacation_mode_intensity", 100),
        "after_dark_only": bool(data.get("vacation_mode_dark_only")),
        "pause_when_home": bool(data.get("vacation_mode_pause_home")),
        "bedtime": data.get("vacation_mode_bedtime") or None,
        "max_on_minutes": data.get("vacation_mode_max_on_min") or None,
        "max_lights_at_once": data.get("vacation_mode_max_lights") or None,
        "anchor_lights": anchor_ids(data) or None,
        "last_off": iso(last.get("ts")),
        "last_off_by": last.get("by") if last.get("how") == "panel" else last.get("how"),
    }


def refresh_status(hass: HomeAssistant) -> None:
    """binary_sensor.padspan_vacation_mode re-reads (an option changed)."""
    try:
        from homeassistant.helpers.dispatcher import async_dispatcher_send  # noqa: PLC0415
        async_dispatcher_send(hass, SIGNAL_VACATION)
    except Exception:  # noqa: BLE001
        pass


def _count_rule_once_a_day(hass: HomeAssistant, rule: str, day: str) -> None:
    dom = hass.data.setdefault(DOMAIN, {})
    seen = dom.setdefault(_VM_RULE_DAY, {})
    if seen.get(rule) == day:
        return
    seen[rule] = day
    try:
        from .telemetry import bump  # noqa: PLC0415
        if rule == "dark":
            bump(hass, "vacation_rule_dark")
        elif rule == "bedtime":
            bump(hass, "vacation_rule_bedtime")
        elif rule == "max_on":
            bump(hass, "vacation_rule_max_on")
        elif rule == "max_lights":
            bump(hass, "vacation_rule_max_lights")
        elif rule == "anchor":
            bump(hass, "vacation_anchor_on")
    except Exception:  # noqa: BLE001
        pass


async def _async_end_trip(hass: HomeAssistant, st: Any, now_ts: float) -> None:
    """The trip's end date has come: off, as if Disable were tapped, and the
    house is told it ended as planned."""
    who = {"how": "end_date"}
    await st.async_set(vacation_mode_enabled=False, vacation_mode_end_at=0,
                       **switch_fields(st.data, False, now_ts, who))
    try:
        from .telemetry import bump  # noqa: PLC0415
        bump(hass, "vacation_off_end_date")
    except Exception:  # noqa: BLE001
        pass
    announce(hass, False, "end_date")
    hass.async_create_task(async_notify_turned_off(hass, who, now_ts))


# ── Preview (research list item 8): "here's what tonight would look like" ────
# The same pattern, draws and options the tick uses, stepped through the next
# PREVIEW_HOURS on its CHECK_INTERVAL from a house with everything off. The
# draws are seeded per light, window and day (_window_draw, _night_jitter),
# so this is what the tick will do — short of a person at home, a light that
# is unavailable, or a light someone switched by hand.
PREVIEW_HOURS = 24


def preview_spans(pattern: dict, data: dict, start_local: datetime, dark_at, anchors: list[str] | None = None,
                  hours: int = PREVIEW_HOURS) -> dict[str, list[list[float]]]:
    """{entity_id: [[on_ts, off_ts], ...]} — pure. `dark_at(ts, local)` says
    whether it is dark then (None when unknown). A span still on at the end
    closes there. An end date inside the window ends everything at it."""
    step = CHECK_INTERVAL
    at = start_local.replace(minute=start_local.minute - start_local.minute % 5, second=0, microsecond=0)
    stop = at + timedelta(hours=hours)
    end_at = data.get("vacation_mode_end_at") or 0
    if isinstance(end_at, (int, float)) and not isinstance(end_at, bool) and end_at > 0:
        stop = min(stop, datetime.fromtimestamp(end_at, tz=at.tzinfo) if at.tzinfo else datetime.fromtimestamp(end_at))
    intensity = data.get("vacation_mode_intensity")
    if not isinstance(intensity, (int, float)) or isinstance(intensity, bool):
        intensity = 100
    anchors = list(anchors or [])
    on: dict[str, float] = {}           # on now, since when — the simulated house
    capped: dict[str, float] = {}
    spans: dict[str, list[list[float]]] = {}
    while at < stop:
        ts = at.timestamp()
        dark = dark_at(ts, at)
        dec = decide_states(pattern, at, intensity)
        dec, _ = apply_options(dec, data=data, now_ts=ts, at_local=at, dark=dark, on_since=dict(on),
                               capped=capped, lit=set(on))
        if anchors:
            dec, _ = apply_anchors(dec, anchors, anchor_window(at, dark, data.get("vacation_mode_bedtime") or ""),
                                   set(on))
        for eid, want in dec.items():
            if want and eid not in on:
                on[eid] = ts
            elif not want and eid in on:
                spans.setdefault(eid, []).append([on.pop(eid), ts])
        at += step
    for eid, since in on.items():
        spans.setdefault(eid, []).append([since, stop.timestamp()])
    return spans


async def async_preview(hass: HomeAssistant) -> dict:
    """What Vacation Mode would switch over the next PREVIEW_HOURS. Running,
    it uses the routine the tick uses. Off, it uses the one turning it on now
    would: the last trip's when it would carry on with it, else one learned
    from history up to now (not stored), else the last one learned."""
    from homeassistant.util import dt as dt_util  # noqa: PLC0415

    dom = hass.data.get(DOMAIN) or {}
    st = dom.get(DATA_SETTINGS)
    data = dict(st.data) if st else {}
    now = dt_util.utcnow()
    now_ts = now.timestamp()
    if data.get("vacation_mode_enabled"):
        routine = routine_word(data)
        pattern = data.get("vacation_mode_pattern") if pattern_serves(data) else data.get("vacation_mode_pattern_prev")
    elif resumable(data, now_ts):
        routine, pattern = "resumed", data.get("vacation_mode_pattern")
    else:
        routine, pattern = "own", {}
        entity_ids = [eid for eid in hass.states.async_entity_ids() if eid.startswith(VM_DOMAINS)]
        history = await _async_fetch_history(hass, entity_ids, HISTORY_DAYS, end=now)
        if history:
            pattern = await hass.async_add_executor_job(
                build_pattern, history, dt_util.as_local(now), HISTORY_DAYS, data.get("vacation_mode_periods") or [])
        if not pattern:
            routine, pattern = ("standin" if learned_pattern(data) else "none"), learned_pattern(data)
    eligible = set(_eligible_entity_ids(hass))
    pattern = {eid: b for eid, b in (pattern or {}).items() if eid in eligible}
    anchors = anchor_ids(data, eligible)
    offset = data.get("vacation_mode_dark_offset_min") or 0
    sun_cache: dict = {}

    def dark_at(ts: float, local: datetime) -> bool | None:
        day = local.date()
        if day not in sun_cache:
            sun_cache[day] = _sun_times(hass, local)
        dark = is_dark(ts, *sun_cache[day], offset)
        if dark is None:
            sun = hass.states.get("sun.sun")
            if sun is not None and sun.state in ("above_horizon", "below_horizon"):
                return sun.state == "below_horizon"
        return dark
    start = dt_util.as_local(now)
    spans = preview_spans(pattern, data, start, dark_at, anchors) if (pattern or anchors) else {}

    def name(eid: str) -> str:
        s = hass.states.get(eid)
        return str(((s.attributes or {}).get("friendly_name") if s is not None else None) or eid)
    lights = [{"entity_id": eid, "name": name(eid), "anchor": eid in anchors, "on": sp}
              for eid, sp in spans.items() if sp]
    lights.sort(key=lambda r: (r["on"][0][0], r["name"].lower()))
    until = now_ts + PREVIEW_HOURS * 3600
    end_at = data.get("vacation_mode_end_at") or 0
    if isinstance(end_at, (int, float)) and not isinstance(end_at, bool) and 0 < end_at < until:
        until = end_at
    return {"from": now_ts, "until": until, "routine": routine, "lights": lights}


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
    now_ts = dt_util.utcnow().timestamp()
    end_at = st.data.get("vacation_mode_end_at") or 0
    if isinstance(end_at, (int, float)) and not isinstance(end_at, bool) and 0 < end_at <= now_ts:
        await _async_end_trip(hass, st, now_ts)
        return
    # Someone home: nothing is switched (never forced off) until they leave.
    if st.data.get("vacation_mode_pause_home") and someone_home(hass):
        if not dom.get(_VM_PAUSED):
            dom[_VM_PAUSED] = True
            try:
                from .telemetry import bump  # noqa: PLC0415
                bump(hass, "vacation_paused_home")
            except Exception:  # noqa: BLE001
                pass
            announce(hass, True, "paused_home")
        return
    if dom.pop(_VM_PAUSED, None):
        announce(hass, True, "unpaused")
    await _async_refresh_pattern_if_stale(hass, st)
    # The refresh can wait seconds on the recorder: switched off meanwhile,
    # nothing may be switched after its span closed (review 2026-09-23).
    if not st.data.get("vacation_mode_enabled"):
        return
    pattern = st.data.get("vacation_mode_pattern") or {}
    # A pattern built for THIS vacation — or, while its build is failing or
    # finds nothing, the last one learned before a vacation (learned_pattern);
    # never a stored pattern older rules may have learned from Vacation
    # Mode's own switching (rounds 4-5).
    enabled_at = st.data.get("vacation_mode_enabled_at") or 0
    if enabled_at and not pattern_serves(st.data):        # same rule as the refresh's
        pattern = st.data.get("vacation_mode_pattern_prev") or {}
    # A pattern built under older rules may name lights the current ones
    # leave out (group members, team followers): apply the rules now.
    eligible = set(_eligible_entity_ids(hass))
    pattern = {eid: b for eid, b in pattern.items() if eid in eligible}
    anchors = anchor_ids(st.data, eligible)
    if not pattern and not anchors:
        return
    intensity = st.data.get("vacation_mode_intensity")
    if not isinstance(intensity, (int, float)) or isinstance(intensity, bool):
        intensity = 100
    local_now = dt_util.as_local(dt_util.utcnow())
    decisions = decide_states(pattern, local_now, intensity)
    if anchors or any(st.data.get(k) for k in ("vacation_mode_dark_only", "vacation_mode_bedtime",
                                                 "vacation_mode_max_on_min", "vacation_mode_max_lights")):
        log = dom.get(_VM_LOG)
        on_since: dict[str, float] = {}
        if (st.data.get("vacation_mode_max_on_min") or anchors) and log is not None:
            await log.async_load()
            on_since = on_since_from_log(log.entries, set(decisions) | set(anchors))
        dark = (_dark_now(hass, now_ts, local_now, st.data.get("vacation_mode_dark_offset_min") or 0)
                if st.data.get("vacation_mode_dark_only") or anchors else None)
        lit: set[str] = set()
        if st.data.get("vacation_mode_max_lights"):
            for eid in decisions:
                cur = hass.states.get(eid)
                if cur is not None and cur.state == "on":
                    lit.add(eid)
        decisions, used = apply_options(decisions, data=st.data, now_ts=now_ts, at_local=local_now, dark=dark,
                                        on_since=on_since, capped=dom.setdefault(_VM_CAPPED, {}), lit=lit)
        if anchors:
            window = anchor_window(local_now, dark, st.data.get("vacation_mode_bedtime") or "")
            decisions, held = apply_anchors(decisions, anchors, window, set(on_since))
            if held:
                used.add("anchor")
        for rule in used:
            _count_rule_once_a_day(hass, rule, local_now.date().isoformat())
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
            # A WLED light PadSpan runs goes on with its remembered look —
            # and its PadSpan team with it (wled_exact.py).
            from .wled_exact import async_power, is_exact_entity  # noqa: PLC0415
            if is_exact_entity(hass, entity_id):
                await async_power(hass, entity_id, want_on, source="vacation")
            else:
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
