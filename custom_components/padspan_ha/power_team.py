# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Power teams: a wall dimmer or switch and the smart bulbs it feeds, as one light.

2026-11-14: colour Zigbee bulbs in sockets fed by a Control4 dimmer.
"They can be off, but when needed they turn on thru control4, wait for boot
up, then do the color shift requirements." A team is one power source (a
light or a switch entity) and its bulbs; Home Assistant gets one light for
it (light.py) and everything goes through that:

  on      the power goes on, FULL (a dimmer never dims smart bulbs: they need
          the whole wave), the bulbs are sent what is wanted again and again
          until each one answers with it (they are starting up and joining
          their network; BOOT_DEADLINE_S at most), then it is ready
  off     the power is cut; the bulbs are told nothing (a bulb told "off"
          could stay dark at the next press of the wall button). Or, with
          `off` "bulbs" (2026-11-21: "when controlling the team with a single
          button press, use hue, but when pressing to get the card, give
          control4 power as an option"), the bulbs are told off and the power
          is left on, so the next on is at once, in the right colour; the
          power is then cut only by hand (the wall, or the card's power row)
  hand    (2026-11-22) a brightness set by hand stops the day leading the
          brightness only, and a colour set by hand the colour only: a hold at
          the wall dimmer at four o'clock no longer keeps four o'clock's colour
          all evening. Both come back at the next turn-on, on Follow the day,
          or `resume` minutes after the last change by hand
  night   between `night.from` and `night.to`, a team switched on (the wall,
          a tap, an automation) comes on in Sleep, not the day's light
  bedtime on its days at its time, a team that is on fades over its minutes
          to Sleep, then stays there or goes off (its own off); the card's
          "Sleep in 30 min" is the same, once
  fade    a turn on or off can carry a fade (`transition`), as long as it
          likes: half an hour from dim and warm is a wake-up light. While a
          long fade runs, the day does not move the light and a bulb partway
          there is not someone's hand
  wall    the wall button turning the power on is seen and answered the same
          way; a dimmer held down to a level at the wall is read as "this
          bright", sent to the bulbs, and the dimmer is put back to full
  day     with `adaptive` on, what is wanted follows the day
          (adaptive_curve.py, adapted from Adaptive Lighting): at each turn
          on, and every ADAPT_EVERY_S while on, with a slow fade. A colour or
          a brightness someone chose stops that until the team is next
          turned on (or its effect is set back to "Adaptive"); the effect
          "Sleep" is one fixed dim, warm setting

Power teams are Advanced smart lighting's (2026-11-25, the owner): PadSpan Pro,
the add-on, or a Bright key (io.licensed). Without it nobody makes, changes or
removes a team (power_teams_set refuses), and a team already made keeps
working as one light; the day (its curve), Sleep (the night light, bedtime,
Sleep in N min) and the wake-up need it too. Without it a team is still one light
(on, off, dimming, its power, each bulb, Try again) and nothing follows the day,
sleeps or wakes: the curve is not applied and no wake-up or bedtime runs,
whatever is stored. Lost while a wake-up or bedtime fades, the lights keep what
they were last sent (a fade already sent runs out on the bulbs), nothing more is
sent for it and nothing turns them off later; back, the day leads again by itself.

The logic (Team) knows no Home Assistant: its `io` is handed in, so tests
drive it with a fake clock. The glue at the bottom (async_setup_power_teams)
is the only part that imports Home Assistant. Teams live in the settings
(`power_teams`), changed only through padspan_ha/power_teams_set. None
exists until someone makes one, and until then nothing here runs.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Callable

from . import adaptive_curve as CURVE
from .const import DOMAIN, NOT_LOADED_MESSAGE
from .quiet_errors import note as _quiet_error

_LOGGER = logging.getLogger(__name__)

FULL = 250                 # a dimmer at or over this (of 255) is feeding its bulbs the whole wave
BOOT_DEADLINE_S = 25.0     # bulbs that have not answered by now are said to be missing
BOOT_MIN_S = 8.0           # after a power-on, keep sending this long whatever Home Assistant shows (it may show the last state of a bulb still starting)
RETRY_S = 2.0              # between sends while waiting
SETTLE_S = 2.0             # a dimmer level must hold this long to be a hand on the wall (a ramp passes through levels)
OWN_S = 6.0                # a power change this soon after our own command is ours
ECHO_S = 30.0              # ... and a power-on this soon after our own power-on (nobody presses on what is already on)
ADAPT_EVERY_S = 60
ADAPT_FADE_S = 30
QUIET_S = ADAPT_FADE_S + 10   # a bulb still moving to what we sent is not someone's hand
MAX_BULBS = 16
OFF_MODES = ("power", "bulbs")   # what turning a team off does: cut its power, or turn its bulbs off with the power left on
MAX_FADE_S = 6000                # the longest fade a team passes on (a Zigbee transition is at most 6553.5 s)
# The wake-up (2026-11-21: "a bit of control over using the lights as a morning alarm"): on the chosen days, a team
# that is off comes on at its dimmest and warmest `minutes` before `time` and fades to `brightness` % and `kelvin`
# by then. A team already on is left alone: someone is up.
WAKE_DEFAULT = {"on": False, "time": "06:30", "days": [0, 1, 2, 3, 4], "minutes": 30, "brightness": 100, "kelvin": 4000,
                # 2026-11-22: a time of its own on Saturday and Sunday ("" is the same time), one morning skipped
                # ("YYYY-MM-DD"), and how long its light is kept before the day leads again (0: until turned off).
                "weekend_time": "", "skip": "", "back_after": 60}
# Bedtime (2026-11-22): on its days at its time, a team that is on fades over `minutes` to Sleep (dim, warm), then
# stays in Sleep or goes off. A team that is off is left off.
BEDTIME_DEFAULT = {"on": False, "time": "22:30", "days": [0, 1, 2, 3, 4, 5, 6], "minutes": 30, "end": "off"}
BEDTIME_MINUTES = (1, 120)
# The night light (2026-11-22): a team switched on between `from` and `to` comes on in Sleep.
NIGHT_DEFAULT = {"on": False, "from": "23:00", "to": "06:00"}
RESUME_MAX_MIN = 1440            # a change by hand kept at most a day before the day leads again (0: until the next on)
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WAKE_MINUTES = (1, 90)
WAKE_START = 3                   # of 255: where a wake-up starts, the dimmest a bulb shows steadily
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
EFFECT_ADAPTIVE, EFFECT_SLEEP = "Adaptive", "Sleep"
# The day, Sleep and the wake-up are this add-on's (licence.ADDONS): PadSpan Pro, the add-on, or a Bright key.
ADDON = "lighting"
LIGHTING_CODE = "addon_required"
LIGHTING_MESSAGE = ("Sleep and the day's light need PadSpan Pro or the Advanced smart lighting add-on. Enter a key in "
                    "Settings → Features → PadSpan licence, or get one at https://padspan.traks.ca/#addons")
# Making, changing and removing a team: the add-on's too. A team already made keeps switching without it.
TEAMS_MESSAGE = ("Making and changing power teams needs PadSpan Pro or the Advanced smart lighting add-on. The teams "
                 "already made keep switching. Enter a key in Settings → Features → PadSpan licence, or get one at "
                 "https://padspan.traks.ca/#addons")
SIGNAL_TEAMS = "padspan_ha_power_teams"
_ENTITY = re.compile(r"^(light|switch)\.[a-z0-9_]+$")
_FALLBACK = {"brightness": 255, "kelvin": 2700}


# ── the stored list ─────────────────────────────────────────────────────────
def sanitize_teams(raw: Any) -> list[dict] | str:
    """The teams as stored, or what is wrong with them, in words."""
    if not isinstance(raw, list):
        return "The teams must be a list"
    out: list[dict] = []
    used: set[str] = set()
    for t in raw:
        if not isinstance(t, dict):
            return "Each team must be an object"
        name = str(t.get("name") or "").strip()[:60]
        power = str(t.get("power") or "")
        bulbs = t.get("bulbs")
        if not name:
            return "Each team needs a name"
        # No power source: lights that always have power (LED strings on their own supply). The team is then its
        # lights alone: on and off are theirs, and one switched from outside takes the others with it.
        if power and not _ENTITY.match(power):
            return f"{name}: choose the wall dimmer or switch that powers the bulbs, or none"
        if not isinstance(bulbs, list) or not bulbs or len(bulbs) > MAX_BULBS:
            return f"{name}: choose 1 to {MAX_BULBS} bulbs"
        bulbs = [str(b) for b in bulbs]
        if any(not b.startswith("light.") or not _ENTITY.match(b) for b in bulbs) or len(set(bulbs)) != len(bulbs):
            return f"{name}: each bulb must be a different light"
        tid = str(t.get("id") or "")
        if not re.match(r"^[a-z0-9]{4,16}$", tid):
            tid = uuid.uuid4().hex[:8]
        if tid in {o["id"] for o in out}:
            return f"{name}: two teams have the same id"
        for e in [*([power] if power else []), *bulbs]:
            if e in used:
                return f"{name}: {e} is already in a team"
            used.add(e)
        # Turning it off: "power" cuts the power (every team made before 0.38.275 does), "bulbs" turns the bulbs off
        # and leaves the power on. Lights that always have power are only ever switched themselves.
        off = "bulbs" if not power else (t.get("off") if t.get("off") in OFF_MODES else "power")
        resume = _num(t.get("resume"))
        out.append({"id": tid, "name": name, "power": power, "bulbs": bulbs, "off": off,
                    "adaptive": t.get("adaptive") is not False, "curve": CURVE.clean(t.get("curve")),
                    "wake": clean_wake(t.get("wake")), "bedtime": clean_bedtime(t.get("bedtime")),
                    "night": clean_night(t.get("night")),
                    "resume": int(max(0, min(RESUME_MAX_MIN, round(resume)))) if resume is not None else 0})
    return out


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def clean_wake(raw: Any) -> dict[str, Any]:
    """A team's wake-up as stored: every field within its limits, the defaults for what is missing or wrong."""
    w = raw if isinstance(raw, dict) else {}
    out = dict(WAKE_DEFAULT)
    out["on"] = w.get("on") is True
    if isinstance(w.get("time"), str) and _HHMM.match(w["time"]):
        out["time"] = w["time"]
    if isinstance(w.get("days"), list):
        out["days"] = sorted({int(d) for d in w["days"] if isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6})
    for k, lo, hi in (("minutes", *WAKE_MINUTES), ("brightness", 1, 100), ("kelvin", 1500, 9000), ("back_after", 0, 720)):
        v = _num(w.get(k))
        if v is not None:
            out[k] = int(max(lo, min(hi, round(v))))
    out["weekend_time"] = w["weekend_time"] if isinstance(w.get("weekend_time"), str) and _HHMM.match(w["weekend_time"]) else ""
    out["skip"] = w["skip"] if isinstance(w.get("skip"), str) and _DATE.match(w["skip"]) else ""
    return out


def _days_of(raw: Any, default: list[int]) -> list[int]:
    if not isinstance(raw, list):
        return list(default)
    return sorted({int(d) for d in raw if isinstance(d, int) and not isinstance(d, bool) and 0 <= d <= 6})


def clean_bedtime(raw: Any) -> dict[str, Any]:
    """A team's bedtime as stored, each field within its limits."""
    b = raw if isinstance(raw, dict) else {}
    out = dict(BEDTIME_DEFAULT)
    out["on"] = b.get("on") is True
    if isinstance(b.get("time"), str) and _HHMM.match(b["time"]):
        out["time"] = b["time"]
    out["days"] = _days_of(b.get("days"), BEDTIME_DEFAULT["days"])
    v = _num(b.get("minutes"))
    if v is not None:
        out["minutes"] = int(max(BEDTIME_MINUTES[0], min(BEDTIME_MINUTES[1], round(v))))
    out["end"] = "sleep" if b.get("end") == "sleep" else "off"
    return out


def clean_night(raw: Any) -> dict[str, Any]:
    """A team's night-light hours as stored."""
    n = raw if isinstance(raw, dict) else {}
    out = dict(NIGHT_DEFAULT)
    out["on"] = n.get("on") is True
    for k in ("from", "to"):
        if isinstance(n.get(k), str) and _HHMM.match(n[k]):
            out[k] = n[k]
    return out


def _mins(hhmm: str) -> int:
    hh, mm = (int(x) for x in hhmm.split(":"))
    return hh * 60 + mm


def night_active(night: dict, now: datetime) -> bool:
    """Is `now` (local) inside the night-light hours? They may run past midnight (23:00 to 06:00)."""
    n = clean_night(night)
    if not n["on"]:
        return False
    f, t, m = _mins(n["from"]), _mins(n["to"]), now.hour * 60 + now.minute
    return f <= m < t if f <= t else (m >= f or m < t)


def _wake_time(w: dict, day: Any) -> str:
    """The wake-up's time on that day: its weekend time on Saturday and Sunday, when it has one."""
    return w["weekend_time"] if w["weekend_time"] and day.weekday() in (5, 6) else w["time"]


def wake_next(wake: dict, now: datetime) -> tuple[str, str] | None:
    """(day, "HH:MM") of the next wake-up's full light from `now` (local), a skipped one included (the card shows it
    as skipped), or None when it is off or has no days."""
    w = clean_wake(wake)
    if not w["on"] or not w["days"]:
        return None
    for n in range(0, 8):
        day = now.date() + timedelta(days=n)
        if day.weekday() not in w["days"]:
            continue
        hh, mm = (int(x) for x in _wake_time(w, day).split(":"))
        full = datetime.combine(day, datetime.min.time(), now.tzinfo).replace(hour=hh, minute=mm)
        if full > now:
            return day.isoformat(), _wake_time(w, day)
    return None


def bedtime_due(bed: dict, now: datetime) -> tuple[str, float] | None:
    """(the day it belongs to, ISO; the seconds of its fade left) for a bedtime that should be running at `now`, or
    None. Due from its time for its minutes: Home Assistant busy at its start still runs it, over what is left."""
    b = clean_bedtime(bed)
    if not b["on"]:
        return None
    hh, mm = (int(x) for x in b["time"].split(":"))
    for day in (now.date(), now.date() - timedelta(days=1)):    # 23:50 for 30 minutes is still the evening's at 00:05
        if day.weekday() not in b["days"]:
            continue
        start = datetime.combine(day, datetime.min.time(), now.tzinfo).replace(hour=hh, minute=mm)
        end = start + timedelta(minutes=b["minutes"])
        if start <= now < end:
            return day.isoformat(), (end - now).total_seconds()
    return None


def wake_due(wake: dict, now: datetime) -> tuple[str, float] | None:
    """(the day it belongs to, ISO; the seconds left until its full light) for a wake-up that should be running at
    `now`, or None. `now` is local time; a wake-up runs from `minutes` before its `time` until its time, on one of its
    `days` (Monday 0). Due all that while, not only at its start: Home Assistant restarted or busy at the start still
    wakes the room, fading over what is left (the caller runs each day's once)."""
    w = clean_wake(wake)
    if not w["on"]:
        return None
    hh, mm = (int(x) for x in w["time"].split(":"))
    for day in (now.date(), now.date() + timedelta(days=1)):     # a 00:10 alarm starts the evening before
        if day.weekday() not in w["days"] or day.isoformat() == w["skip"]:
            continue
        hh, mm = (int(x) for x in _wake_time(w, day).split(":"))
        full = datetime.combine(day, datetime.min.time(), now.tzinfo).replace(hour=hh, minute=mm)
        if full - timedelta(minutes=w["minutes"]) <= now < full:
            return day.isoformat(), (full - now).total_seconds()
    return None


def _fade(v: Any) -> float | None:
    """A fade in seconds, as a team passes it on: over 0 and at most MAX_FADE_S, else none."""
    f = _num(v)
    return min(float(MAX_FADE_S), f) if f is not None and f > 0 else None


# ── one team ────────────────────────────────────────────────────────────────
class Team:
    """One team's logic. io: call(domain, service, data) (awaited), state(eid)
    → an object with .state and .attributes, or None, sleep(seconds)
    (awaited), now() → seconds, target(curve, sleep) → {"brightness",
    "kelvin"} for this moment, changed() (its light writes its state)."""

    def __init__(self, cfg: dict, io: Any) -> None:
        self.cfg = cfg
        self.io = io
        self.want: dict[str, Any] = dict(_FALLBACK)
        self._manual_at = -1e9         # the last change by hand (a team's `resume` counts from it)
        self.manual_bri = False        # a brightness set by hand: the day no longer leads the brightness
        self.manual_colour = False     # a colour set by hand: the day no longer leads the colour
        self.sleep = False
        self.phase = "off"             # off | starting | ready | failed
        self.missing: list[str] = []
        self._gen = 0
        self._power_cmd_at = -1e9
        self._power_cmd_on = False     # which way our last power command went: only a change that way is its echo
        st = io.state(cfg["power"]) if cfg.get("power") else None
        self._last_power = st.state if st is not None and st.state in ("on", "off") else None   # its last real reading
        self._sent_at = -1e9
        self._quiet_until = -1e9       # a long fade we sent runs until then: the day waits, and what the bulbs show is ours
        self.waking = False            # the light is the wake-up's (its fade, then its brightness and colour)
        self._was_fading = False       # so the light is written again when a long fade ends
        self.woke_day: str | None = None   # the day the last wake-up ran, so it runs once
        self.slept_day: str | None = None  # the day the last bedtime ran, so it runs once
        self.bed_ran_here: str | None = None   # ... and in this run of Home Assistant (a restart mid-bedtime runs it again)
        self._back_at: float | None = None # when a wake-up's light hands back to the day
        self._off_at: float | None = None  # when a bedtime (or Sleep in N min) that ends off turns the team off
        self._dim_seen: tuple[int, float] | None = None
        self._rgb: dict[str, tuple] = {}   # each bulb's colour as it showed it after our last send (lights with no colour temperature to read)
        self._licensed_seen: bool | None = None   # Advanced smart lighting as the last tick saw it (its light is written when it changes)

    # what Home Assistant shows
    @property
    def licensed(self) -> bool:
        """Advanced smart lighting here (PadSpan Pro, the add-on, or a Bright key): the day, Sleep and the wake-up.
        An io that doesn't say (the tests' own, before the add-on) has it."""
        fn = getattr(self.io, "licensed", None)
        return True if fn is None else bool(fn())

    @property
    def adaptive(self) -> bool:
        """Does the day lead this team? Its own switch (`adaptive`), and only with Advanced smart lighting."""
        return bool(self.cfg.get("adaptive")) and self.licensed

    @property
    def powerless(self) -> bool:
        """No power source: its lights always have power, and on and off are theirs."""
        return not self.cfg.get("power")

    @property
    def by_bulbs(self) -> bool:
        """On and off are the bulbs' own: lights that always have power, or a team whose off leaves the power on."""
        return self.powerless or self.cfg.get("off") == "bulbs"

    def _power(self) -> Any:
        return None if self.powerless else self.io.state(self.cfg["power"])

    def _powered(self) -> bool:
        """Do the bulbs have power now? (Always, with no power source.)"""
        if self.powerless:
            return True
        st = self._power()
        return bool(st and st.state == "on")

    def _power_cut(self) -> bool:
        """Does the power source read off? (Out of reach is not off: the bulbs may well have power.)"""
        st = self._power()
        return bool(st is not None and st.state == "off")

    def _quiet(self, now: float) -> bool:
        """Is what the bulbs show still ours (just sent, or a long fade still running)?"""
        return now - self._sent_at < QUIET_S or now < self._quiet_until

    def _bulb_on(self, eid: str) -> bool:
        st = self.io.state(eid)
        return bool(st and st.state == "on")

    @property
    def is_on(self) -> bool:
        if self.by_bulbs:
            st = self._power()
            if st is not None and st.state == "off":
                return False                           # no power, nothing lit (Zigbee2MQTT goes on showing a cut bulb's last state)
            return self.phase == "starting" or any(self._bulb_on(b) for b in self.cfg["bulbs"])
        st = self._power()
        return bool(st and st.state == "on")

    @property
    def manual(self) -> bool:
        """Is anything set by hand (the brightness, the colour, or both)?"""
        return self.manual_bri or self.manual_colour

    @manual.setter
    def manual(self, v: bool) -> None:
        self.manual_bri = self.manual_colour = bool(v)
        if v:
            self._manual_at = self.io.now()

    def _hand(self, bri: bool = False, colour: bool = False) -> None:
        """A change by hand to the brightness, the colour, or both: the day stops leading that one."""
        if bri:
            self.manual_bri = True
        if colour:
            self.manual_colour = True
        if bri or colour:
            self._manual_at = self.io.now()

    def _night(self) -> bool:
        """Is it the team's night-light hours now (local time)?"""
        clock = getattr(self.io, "local", None)
        return bool(self.adaptive and clock is not None and night_active(self.cfg.get("night") or {}, clock()))

    def _merged(self) -> dict[str, Any]:
        """What is wanted now: the day's light, with whatever was set by hand kept."""
        t = self._target()
        if self.sleep:
            return t
        if self.manual_bri:
            t["brightness"] = int(self.want.get("brightness") or t["brightness"])
        if self.manual_colour:
            if self.want.get("hs") is not None:
                t["hs"] = self.want["hs"]
                t.pop("kelvin", None)
            elif self.want.get("kelvin") is not None:
                t["kelvin"] = int(self.want["kelvin"])
        return t

    @property
    def brightness_follows(self) -> bool:
        """Does the day lead its brightness now?"""
        return bool(self.adaptive and not self.sleep and not self.manual_bri)

    @property
    def fading(self) -> bool:
        """Is a long fade (a wake-up) still running?"""
        return self.io.now() < self._quiet_until

    @property
    def effect(self) -> str | None:
        if self.sleep:
            return EFFECT_SLEEP
        # The day leads the colour: it is the team's Adaptive (its brightness may be one set by hand).
        return EFFECT_ADAPTIVE if self.adaptive and not self.manual_colour else None

    def _follows(self) -> bool:
        """Does the day (or Sleep) lead anything: the brightness, the colour, or both?"""
        return self.sleep or (self.adaptive and not (self.manual_bri and self.manual_colour))

    def _target(self) -> dict[str, Any]:
        t = self.io.target(self.cfg.get("curve"), self.sleep)
        return {"brightness": int(t["brightness"]), "kelvin": int(t["kelvin"])}

    # ── commands ──
    async def turn_on(self, *, brightness: int | None = None, kelvin: int | None = None,
                      hs: tuple[float, float] | None = None, effect: str | None = None,
                      transition: float | None = None) -> None:
        was_on = self.is_on
        powered = self._powered()
        chosen = brightness is not None or kelvin is not None or hs is not None
        if was_on and not chosen and effect is None and transition is None:
            # On already, and nothing asked for (a presence rule, Try again): what it shows is sent again, a fade
            # running goes on over what is left of it, and a bedtime's off or a wake-up's hand-back still comes.
            if self._follows() and not self.fading:
                self.want = self._merged()
            left = self._quiet_until - QUIET_S - self.io.now() if self.fading else 0
            await self._run(boot=not powered, fade=left if left > 1 else None)
            return
        self.waking, self._back_at, self._off_at = False, None, None
        if effect in (EFFECT_SLEEP, EFFECT_ADAPTIVE) and not self.licensed:
            effect = None                              # the day and Sleep are Advanced smart lighting's: a plain on
        if effect == EFFECT_SLEEP:
            self.sleep, self.manual = True, False
        elif effect == EFFECT_ADAPTIVE:
            self.sleep, self.manual = False, False
        if not was_on and not chosen and effect is None and self._night():
            self.sleep, self.manual = True, False       # the night light: Sleep, not the day's light
        if chosen:
            self.sleep = False
            if not was_on and self.adaptive:
                self.want = self._target()         # what was not chosen is the day's
            if brightness is not None:
                self.want["brightness"] = max(1, min(255, int(brightness)))
            if kelvin is not None:
                self.want["kelvin"] = int(kelvin)
                self.want.pop("hs", None)
            if hs is not None:
                self.want["hs"] = (float(hs[0]), float(hs[1]))
                self.want.pop("kelvin", None)
            # Each channel by itself: a brightness set leaves the colour to the day, and a colour the brightness.
            self._hand(bri=brightness is not None, colour=kelvin is not None or hs is not None)
        elif self._follows():
            self.want = self._merged()
        # Only bulbs that had no power have anything to start (lights that always have power, and bulbs left on
        # their power by an off of their own, answer at once).
        await self._run(boot=not powered, fade=_fade(transition))

    async def wake(self, fade_s: float | None = None) -> bool:
        """The morning alarm: a team that is off comes on at its dimmest and warmest and fades over the wake-up's
        minutes to its brightness and colour, which it then keeps (as one chosen by hand) until turned off or set
        back to the day (or `back_after` minutes after its full light). A team already on is left alone, unless it was
        left in Sleep: then it fades up from there. True when it ran."""
        if not self.licensed:
            return False                               # the wake-up is Advanced smart lighting's
        lit = self.is_on
        if lit and not self.sleep:
            return False
        w = clean_wake(self.cfg.get("wake"))
        c = CURVE.clean(self.cfg.get("curve"))
        self.sleep, self.manual = False, True
        self._off_at = None
        if not lit:
            self.want = {"brightness": WAKE_START, "kelvin": c["sleep_kelvin"]}
            await self._run(boot=not self._powered())
            if (self.phase not in ("ready", "failed") or not self.manual or self.sleep or self.want.get("brightness") != WAKE_START
                    or not self.licensed):
                return False                           # turned off, switched or set by someone, or the licence gone, while it started
        self.want = {"brightness": max(1, round(w["brightness"] * 255 / 100)), "kelvin": w["kelvin"]}
        self.waking = True
        fade = max(60.0, fade_s if fade_s is not None else w["minutes"] * 60.0)
        self._back_at = self.io.now() + fade + w["back_after"] * 60 if w["back_after"] > 0 else None
        await self._run(boot=False, fade=fade)
        return True

    async def go_to_sleep(self, minutes: float, end: str = "off") -> bool:
        """Bedtime: a team that is on fades over `minutes` to Sleep (dim and warm: it warms as it dims), then stays
        there (`end` "sleep") or goes off as its own off does. A team that is off is left off. True when it ran."""
        if not self.is_on or not self.adaptive:
            return False
        self.sleep, self.manual, self.waking, self._back_at = True, False, False, None
        self.want = self._target()
        fade = max(60.0, min(float(MAX_FADE_S), float(minutes) * 60.0))
        self._off_at = self.io.now() + fade if end == "off" else None
        await self._run(boot=False, fade=fade)
        return True

    async def turn_off(self, transition: float | None = None) -> None:
        self._gen += 1
        self.manual = False
        self.sleep = False                             # Sleep is for now: the next turn-on is the day's (or the night light's)
        self.waking, self._back_at, self._off_at = False, None, None
        self.phase, self.missing = "off", []
        self._quiet_until = -1e9
        if self.by_bulbs and self._power_cut() and not (self._power_cmd_on and self.io.now() - self._power_cmd_at < ECHO_S):
            self.io.changed()                          # no power: already dark, and a cut bulb could never answer
            return
        if self.by_bulbs:
            # Each light told off, again and again until it shows off (a string on weak Wi-Fi drops a command).
            g, t0 = self._gen, self.io.now()
            left = list(self.cfg["bulbs"])
            fade = _fade(transition)
            while left and self._gen == g:
                self._sent_at = self.io.now()
                for b in left:
                    await self._call(b, False, {"transition": fade} if fade else None)
                self.io.changed()
                await self.io.sleep(RETRY_S)
                left = [b for b in left if self._bulb_on(b)]
                if self.io.now() - t0 >= BOOT_DEADLINE_S:
                    break
            if left and self._gen == g:
                _LOGGER.warning("Power team %s: still on after %d s: %s", self.cfg.get("name"), int(BOOT_DEADLINE_S), ", ".join(left))
            return
        self._power_cmd_at, self._power_cmd_on = self.io.now(), False
        await self._call(self.cfg["power"], False)
        self.io.changed()

    async def _call(self, eid: str, on: bool, data: dict | None = None) -> None:
        try:
            await self.io.call(eid.split(".")[0], "turn_on" if on else "turn_off", {"entity_id": eid, **(data or {})})
        except Exception as err:  # noqa: BLE001 - a bulb still starting refuses; the next send asks again
            _quiet_error("power_team:call")
            _LOGGER.debug("Power team %s: %s did not take the command: %s", self.cfg.get("name"), eid, err)

    def _bulb_data(self, fade: float | None = None, follow_only: bool = False) -> dict:
        """What a bulb is sent. `follow_only`: only what the day leads (the minute's look): a brightness or a colour
        set by hand, perhaps at the bulb itself, is left as the bulb has it."""
        d: dict[str, Any] = {}
        if not (follow_only and self.manual_bri):
            d["brightness"] = int(self.want.get("brightness") or 255)
        if not (follow_only and self.manual_colour):
            if self.want.get("hs") is not None:
                d["hs_color"] = list(self.want["hs"])
            elif self.want.get("kelvin") is not None:
                d["color_temp_kelvin"] = int(self.want["kelvin"])
        if fade:
            d["transition"] = fade
        return d

    def _answered(self, eid: str, follow_only: bool = False) -> bool:
        """Does the bulb show what is wanted? (Its brightness; its colour temperature where it reports one.) While
        a long fade runs, on is all it can show: it is partway there."""
        st = self.io.state(eid)
        if not st or st.state != "on":
            return False
        if self.io.now() < self._quiet_until:
            return True
        a = st.attributes or {}
        bri, want = _num(a.get("brightness")), self.want.get("brightness", 255)
        # What was sent is what is checked. Only the minute's look (`follow_only`) leaves alone what was set by hand,
        # perhaps at the bulb itself, which the team never sent.
        if not (follow_only and self.manual_bri) and (bri is None or abs(bri - want) > (4 if want < 64 else 8)):   # dim lights told apart more finely
            return False
        k, wk = _num(a.get("color_temp_kelvin")), self.want.get("kelvin")
        return (follow_only and self.manual_colour) or not (wk is not None and self.want.get("hs") is None and k is not None and abs(k - wk) > 150)

    async def _run(self, boot: bool, fade: float | None = None) -> None:
        """The power on and full, then the bulbs sent what is wanted until each answers. A fade longer than the
        day's own is a long one (a wake-up): until it has run, the day waits and the bulbs partway there are ours."""
        self._gen += 1
        g = self._gen
        self._quiet_until = self.io.now() + fade + QUIET_S if fade and fade > ADAPT_FADE_S else -1e9
        self._was_fading = self._was_fading or self._quiet_until > 0
        st = self._power()
        dimmer = str(self.cfg.get("power") or "").startswith("light.")
        level = _num((st.attributes or {}).get("brightness")) if st else None
        if not self.powerless and (not st or st.state != "on" or (dimmer and level is not None and level < FULL)):
            self._power_cmd_at, self._power_cmd_on = self.io.now(), True
            await self._call(self.cfg["power"], True, {"brightness": 255} if dimmer and self._dims(st) else None)
        self.phase, self.missing = "starting", []
        self.io.changed()
        t0 = self.io.now()
        pending = list(self.cfg["bulbs"])
        while pending and self._gen == g:
            self._sent_at = self.io.now()
            for b in pending:
                await self._call(b, True, self._bulb_data(fade))
            await self.io.sleep(RETRY_S)
            if self._gen != g:
                return
            age = self.io.now() - t0
            if not (boot and age < BOOT_MIN_S):
                pending = [b for b in pending if not self._answered(b)]
            if age >= BOOT_DEADLINE_S:
                break
        if self._gen != g:
            return
        self.phase, self.missing = ("failed" if pending else "ready"), pending
        if pending:
            _LOGGER.warning("Power team %s: no answer from %s after %d s", self.cfg.get("name"), ", ".join(pending), int(BOOT_DEADLINE_S))
        self.io.changed()

    @staticmethod
    def _dims(st: Any) -> bool:
        """Can the power source be given a level? (A light that is only on or off is switched, nothing more.)"""
        modes = ((st.attributes or {}).get("supported_color_modes") if st else None) or []
        return any(m != "onoff" for m in modes)

    # ── what is seen ──
    async def on_power(self, new: Any, old: Any) -> None:
        """The power source changed in Home Assistant."""
        self.io.changed()                              # its light is on while the power is
        if not new or new.state in ("unavailable", "unknown"):
            return
        now = self.io.now()
        if new.state != "on":
            self.waking, self._quiet_until, self._back_at, self._off_at = False, -1e9, None, None
        # What it last really read: across a spell out of reach (or Home Assistant starting), off then on is still
        # the wall; nothing known is not.
        was = old.state if old is not None and old.state in ("on", "off") else self._last_power
        if new.state in ("on", "off"):
            self._last_power = new.state
        # Ours: soon after our own command AND the way it went (the wall button pressed on a moment after we cut
        # the power is a person, found on a real Home Assistant, 2026-11-14). Our power-on reported late (Control4,
        # up to ECHO_S) is ours too, but only as the switch on itself: a level held at the wall is a hand, at once.
        same_way = self._power_cmd_on == (new.state == "on")
        ours = same_way and now - self._power_cmd_at < OWN_S
        echo = same_way and new.state == "on" and was != "on" and now - self._power_cmd_at < ECHO_S
        if was != new.state and not (ours or echo):
            self._power_cmd_at = -1e9                  # someone else switched it: what follows is never our echo
        if new.state != "on":
            if self.phase != "off":
                self._gen += 1
                self.phase, self.missing, self.manual, self.sleep = "off", [], False, False
                self.io.changed()
            return
        if was != "on":
            if self.phase == "starting" or ours or echo:
                return                                 # our own power-on (we are starting the bulbs, or it came late)
            if was is None and self.by_bulbs:
                # Never read before (Home Assistant starting): nobody pressed anything, and a team that leaves its
                # power on is off with its dimmer on. Taken as it is, nothing sent.
                self.phase = "ready" if self.is_on else "off"
                self.io.changed()
                return
            if self._night():                          # the wall in the night-light hours: Sleep
                self.sleep, self.manual = True, False
            if self._follows():                        # the wall button: answered as a turn-on
                self.want = self._merged()
            await self._run(boot=True)
            return
        level = _num((new.attributes or {}).get("brightness"))
        if level is None or level >= FULL or ours or not self.cfg["power"].startswith("light."):
            self._dim_seen = None
            return
        # A level under full: a hand on the wall once it has held SETTLE_S (a ramp passes through levels).
        self._dim_seen = (int(level), now)
        g = self._gen
        await self.io.sleep(SETTLE_S)
        st = self._power()
        if (self._gen != g or self._dim_seen != (int(level), now) or not st or st.state != "on"
                or _num((st.attributes or {}).get("brightness")) != level):
            return
        self._dim_seen = None
        self.want["brightness"] = max(3, int(level))
        self.sleep, self._off_at = False, None
        if self.adaptive:
            self._hand(bri=True)                       # the brightness only: the colour goes on following the day
        await self._run(boot=True)                     # under-fed bulbs may have dropped out: as after a power-on

    async def on_bulb(self, eid: str, new: Any, old: Any = None) -> None:
        """A bulb changed. With no power source, one switched from outside is the team switched (an automation's
        turn-on is answered with the day's light, on all of them; one turned off takes the rest with it). And a
        colour or brightness that is not ours is someone's hand: the day stops leading."""
        if not new or new.state in ("unavailable", "unknown"):
            return
        now = self.io.now()
        if self.by_bulbs and not self._power_cut():
            self.io.changed()
            ours = now - self._sent_at < OWN_S
            was = old.state if old else None
            if new.state == "on" and was == "off" and self.phase == "off" and not ours:
                if self._night():
                    self.sleep, self.manual = True, False
                if self._follows():
                    self.want = self._merged()
                await self._run(boot=False)
                return
            if new.state == "off" and was == "on" and self.phase != "off" and not ours:
                await self.turn_off()
                return
            if new.state == "on" and was in (None, "unavailable", "unknown") and self.phase == "off" and self._sent_at < 0:
                # Home Assistant has just started and this light, on all along, is only now heard from: the team
                # is on, as it was (found 2026-11-15: after a restart the lights stayed on and nothing led them).
                # Nothing is sent here; the next minute's look puts the day's light back.
                self.phase = "ready"
                if self._follows():
                    self.want = self._merged()
                return
        a = new.attributes or {}
        rgb = a.get("rgb_color")
        rgb = tuple(rgb) if isinstance(rgb, (list, tuple)) and len(rgb) == 3 else None
        if self._quiet(now):
            if rgb and new.state == "on":
                self._rgb[eid] = rgb                   # still moving to what we sent: this is ours
            return
        if self.phase != "ready" or not self._follows() or self.sleep or new.state != "on":
            return
        if not old or old.state in ("unavailable", "unknown"):
            return                                     # only now heard from: what it shows is no one's hand
        bri, k = _num(a.get("brightness")), _num(a.get("color_temp_kelvin"))
        want, wk, seen = self.want.get("brightness", 255), self.want.get("kelvin"), self._rgb.get(eid)
        bri_moved = bri is not None and abs(bri - want) > max(6, want * 0.1)
        colour_moved = ((wk is not None and k is not None and abs(k - wk) > 300)
                        or (k is None and bool(rgb) and bool(seen) and max(abs(x - y) for x, y in zip(rgb, seen)) > 40))
        if bri_moved or colour_moved:
            self._hand(bri=bri_moved, colour=colour_moved)   # each channel by itself
            if bri_moved:
                self.want["brightness"] = int(bri)             # what the hand set is what is kept
            if colour_moved and k is not None:
                self.want["kelvin"] = int(k)
                self.want.pop("hs", None)
            self.io.changed()

    def licence_lost(self) -> None:
        """Advanced smart lighting is gone: the lights stay as they are, steady. A fade already sent runs out on the
        bulbs; the wake-up's hand-back, a bedtime's off and Sleep end here, and the wake-up's (or Sleep's) light is no
        longer held as one chosen by hand, so the day leads again by itself once the licence is back (tick). A light
        someone set by hand stays theirs, as it would with the licence."""
        if self.sleep or self.waking or self._back_at is not None or self._off_at is not None:
            if self.waking or self.sleep:
                self.manual = False                    # the wake-up's (or Sleep's) light, not one chosen by hand
            self.sleep, self.waking, self._back_at, self._off_at = False, False, None, None
            self.io.changed()

    async def tick(self) -> None:
        """Every ADAPT_EVERY_S: the day moves what is wanted; a bulb that never answered is asked again."""
        ok = self.licensed
        if not ok:
            self.licence_lost()
        if ok != self._licensed_seen:
            self._licensed_seen = ok
            self.io.changed()                          # its light's effects (the day, Sleep) come and go with the licence
        fading = self.fading
        if self._was_fading and not fading:
            self.io.changed()                          # the fade has run: its light says so
        self._was_fading = fading
        now = self.io.now()
        if self._off_at is not None and now >= self._off_at:
            self._off_at = None
            if self.is_on and self.sleep:
                await self.turn_off()                  # a bedtime that ends off: as the team's own off does
                return                                 # (the Manager runs each team's tick on its own: nothing waits)
        if self.waking and self._back_at is not None and now >= self._back_at:
            self.waking, self.manual, self._back_at = False, False, None   # the wake-up's light hands back to the day
            self.io.changed()
        resume = int(self.cfg.get("resume") or 0)
        if resume and self.manual and not self.waking and not self.sleep and now - self._manual_at >= resume * 60:
            self.manual = False                        # long enough since the last change by hand: the day leads again
            self.io.changed()
        if not self.is_on or self.phase not in ("ready", "failed"):
            return
        if self.missing:
            left = self._quiet_until - QUIET_S - self.io.now() if fading else 0
            for b in list(self.missing):
                await self._call(b, True, self._bulb_data(left if left > 1 else None))   # with the others, mid-fade
            self.missing = [b for b in self.missing if not self._answered(b)]
            if not self.missing:
                self.phase = "ready"
            self.io.changed()
        if not self._follows() or self.io.now() < self._quiet_until:
            return                                     # a long fade (a wake-up) is still running: the day waits for it
        t = self._merged()
        same_colour = (t.get("hs") == self.want.get("hs") if t.get("hs") is not None
                       else abs((t.get("kelvin") or 0) - (self.want.get("kelvin") or 0)) < 25)
        if abs(t["brightness"] - self.want.get("brightness", 0)) < 3 and same_colour:
            # Nothing to move. A light that does not show what was last sent (it dropped the command, or something
            # set it again within moments of ours) is sent it once more; so is a team's light found off while the
            # others are on (no power source: they are one).
            if self.phase == "ready" and not self._quiet(self.io.now()):
                def off(b: str) -> bool:
                    st = self.io.state(b)
                    return bool(self.by_bulbs and st and st.state == "off")
                stray = [b for b in self.cfg["bulbs"] if (self._bulb_on(b) and not self._answered(b, follow_only=True)) or off(b)]
                if stray:
                    self._sent_at = self.io.now()      # before the sends: what they change is ours as it happens
                for b in stray:
                    await self._call(b, True, self._bulb_data(follow_only=True))
            return
        self.want = t
        self._sent_at = self.io.now()
        for b in self.cfg["bulbs"]:
            if b not in self.missing:
                await self._call(b, True, self._bulb_data(ADAPT_FADE_S, follow_only=True))
        self.io.changed()


# ── Home Assistant ──────────────────────────────────────────────────────────
class Manager:
    """The house's teams, live: built from the settings, rebuilt when they change."""

    def __init__(self, hass: Any) -> None:
        self.hass = hass
        self.teams: dict[str, Team] = {}
        self.listeners: dict[str, Callable[[], None]] = {}     # team id -> its light's write
        self.lights: dict[str, str] = {}                       # team id -> its light's entity id
        self._unsub: list[Callable[[], None]] = []
        self._sun: tuple[str, list[tuple[float, float]]] | None = None

    def _days(self) -> list[tuple[float, float]]:
        """(sunrise, sunset) of yesterday, today and tomorrow, worked out once a day."""
        from datetime import timedelta  # noqa: PLC0415

        from homeassistant.helpers.sun import get_astral_event_date  # noqa: PLC0415
        from homeassistant.util import dt as dt_util  # noqa: PLC0415
        today = dt_util.now().date()
        if self._sun and self._sun[0] == today.isoformat():
            return self._sun[1]
        days = []
        for off in (-1, 0, 1):
            d = today + timedelta(days=off)
            rise, set_ = get_astral_event_date(self.hass, "sunrise", d), get_astral_event_date(self.hass, "sunset", d)
            if rise is None or set_ is None:             # no sunrise or sunset there today: 6 and 18 o'clock
                base = dt_util.start_of_local_day(dt_util.now().replace(year=d.year, month=d.month, day=d.day))
                rise, set_ = base + timedelta(hours=6), base + timedelta(hours=18)
            days.append((rise.timestamp(), set_.timestamp()))
        self._sun = (today.isoformat(), days)
        return days

    def _day_at(self, i: int, hhmm: str) -> float:
        """That time ("HH:MM") on the i-th of the days _days works out (yesterday, today, tomorrow), local."""
        from homeassistant.util import dt as dt_util  # noqa: PLC0415
        d = dt_util.now().date() + timedelta(days=i - 1)
        hh, mm = (int(x) for x in hhmm.split(":"))
        return datetime(d.year, d.month, d.day, hh, mm, tzinfo=dt_util.get_default_time_zone()).timestamp()

    def _target(self, curve: dict | None, sleep: bool) -> dict:
        import time  # noqa: PLC0415
        days = CURVE.shift_days(self._days(), curve, self._day_at)
        s = CURVE.settings_at(CURVE.sun_position(time.time(), days), curve, sleep)
        return {"brightness": max(1, round(s["brightness_pct"] * 255 / 100)), "kelvin": s["kelvin"]}

    def _io(self, tid: str) -> Any:
        import asyncio  # noqa: PLC0415
        import time  # noqa: PLC0415
        from types import SimpleNamespace  # noqa: PLC0415
        hass = self.hass

        async def call(domain: str, service: str, data: dict) -> None:
            if domain not in ("light", "switch") or service not in ("turn_on", "turn_off"):
                return                                   # a team switches its own lights and nothing else, ever
            await hass.services.async_call(domain, service, data, blocking=True)

        def changed() -> None:
            cb = self.listeners.get(tid)
            if cb:
                cb()
        from homeassistant.util import dt as dt_util  # noqa: PLC0415

        def licensed() -> bool:
            from .licence import hass_addon_or_bright  # noqa: PLC0415
            return hass_addon_or_bright(hass, ADDON)
        return SimpleNamespace(call=call, state=hass.states.get, sleep=asyncio.sleep, now=time.monotonic,
                               target=self._target, changed=changed, local=dt_util.now, licensed=licensed)

    def reload(self, stored: list[dict]) -> None:
        """The teams as the settings have them now: kept ones keep what they were doing."""
        from homeassistant.helpers.event import async_track_state_change_event, async_track_time_interval  # noqa: PLC0415
        for u in self._unsub:
            u()
        self._unsub = []
        was = self.teams
        self.teams = {}
        for cfg in stored or []:
            t = was.get(cfg["id"])
            if t and t.cfg.get("power") == cfg["power"] and t.cfg.get("bulbs") == cfg["bulbs"]:
                dark_powered = t.by_bulbs and not t.is_on and t._powered() and cfg.get("power")
                t.cfg = cfg
                if dark_powered and not t.by_bulbs:
                    # Off with its power left on, now a team whose off cuts the power: it is cut, so off is off.
                    self.hass.async_create_task(t.turn_off())
            else:
                t = Team(cfg, self._io(cfg["id"]))
                if t.is_on:
                    t.phase = "ready"
                t.woke_day = _woke(self.hass).get(cfg["id"])
                t.slept_day = _woke(self.hass, "power_teams_slept").get(cfg["id"])
            self.teams[cfg["id"]] = t
        if not self.teams:
            return
        hass = self.hass
        by_power = {t.cfg["power"]: t for t in self.teams.values() if t.cfg.get("power")}
        by_bulb = {b: t for t in self.teams.values() for b in t.cfg["bulbs"]}

        async def seen(event: Any) -> None:
            eid, new, old = event.data.get("entity_id"), event.data.get("new_state"), event.data.get("old_state")
            if eid in by_power:
                await by_power[eid].on_power(new, old)
            elif eid in by_bulb:
                await by_bulb[eid].on_bulb(eid, new, old)

        async def tick(_now: Any) -> None:
            from homeassistant.util import dt as dt_util  # noqa: PLC0415
            local = dt_util.now()
            for t in list(self.teams.values()):
                try:
                    due = wake_due(t.cfg.get("wake") or {}, local) if t.licensed else None   # Advanced smart lighting's
                    if due and t.woke_day != due[0]:
                        t.woke_day = due[0]                # once a day, lit or not (lit: someone is up already)
                        hass.async_create_task(self._keep_woke())   # and across a restart: never woken twice
                        if not t.is_on or t.sleep:         # off, or left in Sleep: wake it
                            hass.async_create_task(t.wake(due[1]))   # its fade runs for minutes: never held up by the tick
                    bed = bedtime_due(t.cfg.get("bedtime") or {}, local) if t.adaptive else None
                    if bed and t.bed_ran_here != bed[0]:
                        t.bed_ran_here = bed[0]
                        first = t.slept_day != bed[0]
                        t.slept_day = bed[0]               # once a day; a team that is off is left off
                        hass.async_create_task(self._keep_woke())
                        # Home Assistant restarted mid-bedtime (the day is kept, its fade and off were not): a lit team
                        # not yet in Sleep is put to sleep over what is left.
                        if t.is_on and (first or not t.sleep):
                            hass.async_create_task(t.go_to_sleep(bed[1] / 60, clean_bedtime(t.cfg.get("bedtime"))["end"]))
                    hass.async_create_task(_safe_tick(t))   # each team on its own: one slow off never holds up another
                except Exception as err:  # noqa: BLE001 - one team's trouble never stops the others
                    _quiet_error("power_team:tick")
                    _LOGGER.debug("Power team tick failed: %s", err)

        async def _safe_tick(t: Team) -> None:
            try:
                await t.tick()
            except Exception as err:  # noqa: BLE001 - one team's trouble never stops the others
                _quiet_error("power_team:team_tick")
                _LOGGER.debug("Power team tick failed: %s", err)
        from datetime import timedelta  # noqa: PLC0415
        self._unsub = [async_track_state_change_event(hass, [*by_power, *by_bulb], seen),
                       async_track_time_interval(hass, tick, timedelta(seconds=ADAPT_EVERY_S))]

    async def _keep_woke(self) -> None:
        """Each team's last wake-up and bedtime day, in the settings (power_teams_woke, power_teams_slept), so a
        restart mid-window never runs either a second time (someone may have turned it off since)."""
        from .const import DATA_SETTINGS  # noqa: PLC0415
        st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            await st.async_set(power_teams_woke={tid: t.woke_day for tid, t in self.teams.items() if t.woke_day},
                               power_teams_slept={tid: t.slept_day for tid, t in self.teams.items() if t.slept_day})

    def stop(self) -> None:
        for u in self._unsub:
            u()
        self._unsub = []


def team_light_of(hass: Any, eid: str) -> str:
    """The light of the power team `eid` belongs to (its power source or one of its bulbs), else `eid` itself.
    Whatever PadSpan switches by entity id (vacation mode, presence automations, the emergency lighting test, and on
    the map power_team_card.js) switches a team member through its team: a dimmer already on with its bulbs told off
    reads as on, and turning it on would change nothing."""
    m = manager(hass)
    if m is None or not isinstance(eid, str):
        return eid
    for tid, t in m.teams.items():
        if eid == t.cfg.get("power") or eid in t.cfg.get("bulbs", ()):
            return m.lights.get(tid) or eid             # its light not in Home Assistant yet: as it is
    return eid


_RULE_DOMAINS = ("light", "switch", "scene", "script")


async def async_switch(hass: Any, eid: str, on: bool, *, source: str) -> str:
    """Switch `eid` on or off the way PadSpan's rules do (presence automations, Lights follow people): a team
    member through its team (team_light_of), a WLED light PadSpan runs with its remembered look (wled_exact.py),
    anything else by its own domain's turn_on / turn_off. Only a light, switch, scene or script: anything else is
    refused here, at the one place the call is made, whatever was stored. Returns what was switched."""
    target = team_light_of(hass, eid)
    domain = target.split(".", 1)[0]
    if domain not in _RULE_DOMAINS:
        raise ValueError(f"not a light, switch, scene or script: {target}")
    from .wled_exact import async_power, is_exact_entity  # noqa: PLC0415
    if domain == "light" and is_exact_entity(hass, target):
        await async_power(hass, target, on, source=source)
    else:
        await hass.services.async_call(domain, "turn_on" if on else "turn_off", {"entity_id": target})
    return target


def manager(hass: Any) -> Manager | None:
    return hass.data.get(DOMAIN, {}).get("power_team_manager")


def _woke(hass: Any, key: str = "power_teams_woke") -> dict:
    from .const import DATA_SETTINGS  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    v = (st.data if st else {}).get(key)
    return v if isinstance(v, dict) else {}


def _stored(hass: Any) -> list[dict]:
    from .const import DATA_SETTINGS  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    return [t for t in ((st.data if st else {}).get("power_teams") or []) if isinstance(t, dict)]


def async_setup_power_teams(hass: Any) -> Manager:
    """Start the house's teams (none: nothing listens, nothing ticks)."""
    m = manager(hass)
    if m is None:
        m = hass.data.setdefault(DOMAIN, {})["power_team_manager"] = Manager(hass)
    m.reload(_stored(hass))
    return m


def async_stop_power_teams(hass: Any) -> None:
    m = hass.data.get(DOMAIN, {}).pop("power_team_manager", None)
    if m:
        m.stop()


# ── websocket ───────────────────────────────────────────────────────────────
def _ws_commands() -> list:
    import voluptuous as vol  # noqa: PLC0415
    from homeassistant.components import websocket_api  # noqa: PLC0415

    def view(hass: Any) -> dict:
        m = manager(hass)
        from homeassistant.util import dt as dt_util  # noqa: PLC0415
        local = dt_util.now()
        live = {tid: {"phase": t.phase, "missing": t.missing, "manual": t.manual, "sleep": t.sleep, "waking": t.waking,
                      "next_wake": wake_next(t.cfg.get("wake") or {}, local) if t.licensed else None}
                for tid, t in (m.teams.items() if m else [])}
        from .licence import hass_addon_or_bright  # noqa: PLC0415
        # Advanced smart lighting here: the card and Settings offer the day, Sleep and the wake-up only then.
        return {"teams": _stored(hass), "live": live, "lighting": hass_addon_or_bright(hass, ADDON), "defaults": dict(CURVE.DEFAULTS), "limits": {k: list(v) for k, v in CURVE.LIMITS.items()},
                "wake_default": dict(WAKE_DEFAULT), "wake_minutes": list(WAKE_MINUTES),
                "bedtime_default": dict(BEDTIME_DEFAULT), "bedtime_minutes": list(BEDTIME_MINUTES),
                "night_default": dict(NIGHT_DEFAULT), "resume_max": RESUME_MAX_MIN}

    @websocket_api.websocket_command({"type": "padspan_ha/power_teams_get"})
    @websocket_api.async_response
    async def ws_power_teams_get(hass: Any, connection: Any, msg: dict) -> None:
        connection.send_result(msg["id"], view(hass))

    @websocket_api.websocket_command({"type": "padspan_ha/power_teams_set", vol.Required("teams"): list})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_power_teams_set(hass: Any, connection: Any, msg: dict) -> None:
        from .const import DATA_SETTINGS  # noqa: PLC0415
        from .licence import hass_addon_or_bright  # noqa: PLC0415
        if not hass_addon_or_bright(hass, ADDON):
            connection.send_error(msg["id"], LIGHTING_CODE, TEAMS_MESSAGE)
            return
        teams = sanitize_teams(msg["teams"])
        if isinstance(teams, str):
            connection.send_error(msg["id"], "invalid", teams)
            return
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if not st:
            connection.send_error(msg["id"], "no_settings", NOT_LOADED_MESSAGE)
            return
        await st.async_set(power_teams=teams)
        async_setup_power_teams(hass)
        try:
            from homeassistant.helpers.dispatcher import async_dispatcher_send  # noqa: PLC0415
            async_dispatcher_send(hass, SIGNAL_TEAMS)
        except Exception as err:  # noqa: BLE001
            _quiet_error("power_team:power_teams_set")
            _LOGGER.debug("Power teams: the light platform was not told: %s", err)
        connection.send_result(msg["id"], view(hass))

    @websocket_api.websocket_command({"type": "padspan_ha/power_team_sleep", vol.Required("entity_id"): str,
                                      vol.Optional("minutes", default=30): vol.All(vol.Coerce(float), vol.Range(min=1, max=120)),
                                      vol.Optional("end", default="off"): vol.In(["off", "sleep"])})
    @websocket_api.async_response
    async def ws_power_team_sleep(hass: Any, connection: Any, msg: dict) -> None:
        """The card's "Sleep in 30 min": the team fades to Sleep over the minutes, then goes off (or stays)."""
        m = manager(hass)
        tid = next((t for t, e in (m.lights.items() if m else []) if e == msg["entity_id"]), None)
        t = m.teams.get(tid) if m and tid else None
        if t is None:
            connection.send_error(msg["id"], "not_found", "That light is not a power team")
            return
        if not t.licensed:
            connection.send_error(msg["id"], LIGHTING_CODE, LIGHTING_MESSAGE)
            return
        if not t.is_on:
            connection.send_result(msg["id"], {"ran": False})
            return
        hass.async_create_task(t.go_to_sleep(msg["minutes"], msg["end"]))
        connection.send_result(msg["id"], {"ran": True})

    return [ws_power_teams_get, ws_power_teams_set, ws_power_team_sleep]


def async_register(hass: Any) -> None:
    from homeassistant.components import websocket_api  # noqa: PLC0415

    from .licence import edition  # noqa: PLC0415
    if edition() != "full":        # Bright has no entities (PLATFORMS is empty there): no team light, so no teams
        return
    for cmd in _ws_commands():
        websocket_api.async_register_command(hass, cmd)
