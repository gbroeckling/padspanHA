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
from .const import DOMAIN
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
WAKE_DEFAULT = {"on": False, "time": "06:30", "days": [0, 1, 2, 3, 4], "minutes": 30, "brightness": 100, "kelvin": 4000}
WAKE_MINUTES = (1, 90)
WAKE_START = 3                   # of 255: where a wake-up starts, the dimmest a bulb shows steadily
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
EFFECT_ADAPTIVE, EFFECT_SLEEP = "Adaptive", "Sleep"
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
        out.append({"id": tid, "name": name, "power": power, "bulbs": bulbs, "off": off,
                    "adaptive": t.get("adaptive") is not False, "curve": CURVE.clean(t.get("curve")),
                    "wake": clean_wake(t.get("wake"))})
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
    for k, lo, hi in (("minutes", *WAKE_MINUTES), ("brightness", 1, 100), ("kelvin", 1500, 9000)):
        v = _num(w.get(k))
        if v is not None:
            out[k] = int(max(lo, min(hi, round(v))))
    return out


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
        if day.weekday() not in w["days"]:
            continue
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
        self.manual = False
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
        self._dim_seen: tuple[int, float] | None = None
        self._rgb: dict[str, tuple] = {}   # each bulb's colour as it showed it after our last send (lights with no colour temperature to read)

    # what Home Assistant shows
    @property
    def adaptive(self) -> bool:
        return bool(self.cfg.get("adaptive"))

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
    def fading(self) -> bool:
        """Is a long fade (a wake-up) still running?"""
        return self.io.now() < self._quiet_until

    @property
    def effect(self) -> str | None:
        if self.sleep:
            return EFFECT_SLEEP
        return EFFECT_ADAPTIVE if self.adaptive and not self.manual else None

    def _follows(self) -> bool:
        return self.sleep or (self.adaptive and not self.manual)

    def _target(self) -> dict[str, Any]:
        t = self.io.target(self.cfg.get("curve"), self.sleep)
        return {"brightness": int(t["brightness"]), "kelvin": int(t["kelvin"])}

    # ── commands ──
    async def turn_on(self, *, brightness: int | None = None, kelvin: int | None = None,
                      hs: tuple[float, float] | None = None, effect: str | None = None,
                      transition: float | None = None) -> None:
        was_on = self.is_on
        powered = self._powered()
        self.waking = False
        if effect == EFFECT_SLEEP:
            self.sleep, self.manual = True, False
        elif effect == EFFECT_ADAPTIVE:
            self.sleep, self.manual = False, False
        chosen = brightness is not None or kelvin is not None or hs is not None
        if chosen:
            self.manual, self.sleep = True, False
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
        elif self._follows():
            self.want = self._target()
        # Only bulbs that had no power have anything to start (lights that always have power, and bulbs left on
        # their power by an off of their own, answer at once).
        await self._run(boot=not powered, fade=_fade(transition))

    async def wake(self, fade_s: float | None = None) -> bool:
        """The morning alarm: a team that is off comes on at its dimmest and warmest and fades over the wake-up's
        minutes to its brightness and colour, which it then keeps (as one chosen by hand) until turned off or set
        back to the day. A team already on is left alone. True when it ran."""
        if self.is_on:
            return False
        w = clean_wake(self.cfg.get("wake"))
        c = CURVE.clean(self.cfg.get("curve"))
        self.sleep, self.manual = False, True
        self.want = {"brightness": WAKE_START, "kelvin": c["sleep_kelvin"]}
        await self._run(boot=not self._powered())
        if self.phase not in ("ready", "failed") or not self.manual or self.sleep or self.want.get("brightness") != WAKE_START:
            return False                               # turned off, or switched or set by someone, while it started
        self.want = {"brightness": max(1, round(w["brightness"] * 255 / 100)), "kelvin": w["kelvin"]}
        self.waking = True
        await self._run(boot=False, fade=max(60.0, fade_s if fade_s is not None else w["minutes"] * 60.0))
        return True

    async def turn_off(self, transition: float | None = None) -> None:
        self._gen += 1
        self.manual = False
        self.waking = False
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

    def _bulb_data(self, fade: float | None = None) -> dict:
        d: dict[str, Any] = {"brightness": int(self.want.get("brightness") or 255)}
        if self.want.get("hs") is not None:
            d["hs_color"] = list(self.want["hs"])
        elif self.want.get("kelvin") is not None:
            d["color_temp_kelvin"] = int(self.want["kelvin"])
        if fade:
            d["transition"] = fade
        return d

    def _answered(self, eid: str) -> bool:
        """Does the bulb show what is wanted? (Its brightness; its colour temperature where it reports one.) While
        a long fade runs, on is all it can show: it is partway there."""
        st = self.io.state(eid)
        if not st or st.state != "on":
            return False
        if self.io.now() < self._quiet_until:
            return True
        a = st.attributes or {}
        bri, want = _num(a.get("brightness")), self.want.get("brightness", 255)
        if bri is None or abs(bri - want) > (4 if want < 64 else 8):     # dim lights are told apart more finely
            return False
        k, wk = _num(a.get("color_temp_kelvin")), self.want.get("kelvin")
        return not (wk is not None and self.want.get("hs") is None and k is not None and abs(k - wk) > 150)

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
            self.waking, self._quiet_until = False, -1e9
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
                self.phase, self.missing, self.manual = "off", [], False
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
            if self._follows():                        # the wall button: answered as a turn-on
                self.want = self._target()
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
        self.manual, self.sleep = self.adaptive, False
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
                if self._follows():
                    self.want = self._target()
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
                    self.want = self._target()
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
        if ((bri is not None and abs(bri - want) > max(6, want * 0.1)) or (wk is not None and k is not None and abs(k - wk) > 300)
                or (k is None and rgb and seen and max(abs(x - y) for x, y in zip(rgb, seen)) > 40)):
            self.manual = True
            self.io.changed()

    async def tick(self) -> None:
        """Every ADAPT_EVERY_S: the day moves what is wanted; a bulb that never answered is asked again."""
        fading = self.fading
        if self._was_fading and not fading:
            self.io.changed()                          # the fade has run: its light says so
        self._was_fading = fading
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
        t = self._target()
        if abs(t["brightness"] - self.want.get("brightness", 0)) < 3 and abs(t["kelvin"] - (self.want.get("kelvin") or 0)) < 25:
            # Nothing to move. A light that does not show what was last sent (it dropped the command, or something
            # set it again within moments of ours) is sent it once more; so is a team's light found off while the
            # others are on (no power source: they are one).
            if self.phase == "ready" and not self._quiet(self.io.now()):
                def off(b: str) -> bool:
                    st = self.io.state(b)
                    return bool(self.by_bulbs and st and st.state == "off")
                stray = [b for b in self.cfg["bulbs"] if (self._bulb_on(b) and not self._answered(b)) or off(b)]
                if stray:
                    self._sent_at = self.io.now()      # before the sends: what they change is ours as it happens
                for b in stray:
                    await self._call(b, True, self._bulb_data())
            return
        self.want = t
        self._sent_at = self.io.now()
        for b in self.cfg["bulbs"]:
            if b not in self.missing:
                await self._call(b, True, self._bulb_data(ADAPT_FADE_S))
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
        return SimpleNamespace(call=call, state=hass.states.get, sleep=asyncio.sleep, now=time.monotonic,
                               target=self._target, changed=changed)

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
                    due = wake_due(t.cfg.get("wake") or {}, local)
                    if due and t.woke_day != due[0]:
                        t.woke_day = due[0]                # once a day, lit or not (lit: someone is up already)
                        hass.async_create_task(self._keep_woke())   # and across a restart: never woken twice
                        if not t.is_on:
                            hass.async_create_task(t.wake(due[1]))   # its fade runs for minutes: never held up by the tick
                    await t.tick()
                except Exception as err:  # noqa: BLE001 - one team's trouble never stops the others
                    _quiet_error("power_team:tick")
                    _LOGGER.debug("Power team tick failed: %s", err)
        from datetime import timedelta  # noqa: PLC0415
        self._unsub = [async_track_state_change_event(hass, [*by_power, *by_bulb], seen),
                       async_track_time_interval(hass, tick, timedelta(seconds=ADAPT_EVERY_S))]

    async def _keep_woke(self) -> None:
        """Each team's last wake-up day, in the settings (power_teams_woke), so a restart mid-window never wakes the
        room a second time (someone may have turned it off since)."""
        from .const import DATA_SETTINGS  # noqa: PLC0415
        st = self.hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if st:
            await st.async_set(power_teams_woke={tid: t.woke_day for tid, t in self.teams.items() if t.woke_day})

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


def manager(hass: Any) -> Manager | None:
    return hass.data.get(DOMAIN, {}).get("power_team_manager")


def _woke(hass: Any) -> dict:
    from .const import DATA_SETTINGS  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    v = (st.data if st else {}).get("power_teams_woke")
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
        live = {tid: {"phase": t.phase, "missing": t.missing, "manual": t.manual, "sleep": t.sleep, "waking": t.waking}
                for tid, t in (m.teams.items() if m else [])}
        return {"teams": _stored(hass), "live": live, "defaults": dict(CURVE.DEFAULTS), "limits": {k: list(v) for k, v in CURVE.LIMITS.items()},
                "wake_default": dict(WAKE_DEFAULT), "wake_minutes": list(WAKE_MINUTES)}

    @websocket_api.websocket_command({"type": "padspan_ha/power_teams_get"})
    @websocket_api.async_response
    async def ws_power_teams_get(hass: Any, connection: Any, msg: dict) -> None:
        connection.send_result(msg["id"], view(hass))

    @websocket_api.websocket_command({"type": "padspan_ha/power_teams_set", vol.Required("teams"): list})
    @websocket_api.require_admin
    @websocket_api.async_response
    async def ws_power_teams_set(hass: Any, connection: Any, msg: dict) -> None:
        from .const import DATA_SETTINGS  # noqa: PLC0415
        teams = sanitize_teams(msg["teams"])
        if isinstance(teams, str):
            connection.send_error(msg["id"], "invalid", teams)
            return
        st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
        if not st:
            connection.send_error(msg["id"], "no_settings", "Settings not loaded")
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

    return [ws_power_teams_get, ws_power_teams_set]


def async_register(hass: Any) -> None:
    from homeassistant.components import websocket_api  # noqa: PLC0415

    from .licence import edition  # noqa: PLC0415
    if edition() != "full":        # Bright has no entities (PLATFORMS is empty there): no team light, so no teams
        return
    for cmd in _ws_commands():
        websocket_api.async_register_command(hass, cmd)
