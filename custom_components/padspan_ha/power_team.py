# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Power teams: a wall dimmer or switch and the smart bulbs it feeds, as one light.

Garry, 2026-11-14: colour Zigbee bulbs in sockets fed by a Control4 dimmer.
"They can be off, but when needed they turn on thru control4, wait for boot
up, then do the color shift requirements." A team is one power source (a
light or a switch entity) and its bulbs; Home Assistant gets one light for
it (light.py) and everything goes through that:

  on      the power goes on, FULL (a dimmer never dims smart bulbs: they need
          the whole wave), the bulbs are sent what is wanted again and again
          until each one answers with it (they are starting up and joining
          their network; BOOT_DEADLINE_S at most), then it is ready
  off     the power is cut; the bulbs are told nothing (a bulb told "off"
          could stay dark at the next press of the wall button)
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
from typing import Any, Callable

from . import adaptive_curve as CURVE
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

FULL = 250                 # a dimmer at or over this (of 255) is feeding its bulbs the whole wave
BOOT_DEADLINE_S = 25.0     # bulbs that have not answered by now are said to be missing
BOOT_MIN_S = 8.0           # after a power-on, keep sending this long whatever Home Assistant shows (it may show the last state of a bulb still starting)
RETRY_S = 2.0              # between sends while waiting
SETTLE_S = 2.0             # a dimmer level must hold this long to be a hand on the wall (a ramp passes through levels)
OWN_S = 6.0                # a power change this soon after our own command is ours
ADAPT_EVERY_S = 60
ADAPT_FADE_S = 30
QUIET_S = ADAPT_FADE_S + 10   # a bulb still moving to what we sent is not someone's hand
MAX_BULBS = 16
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
        if not _ENTITY.match(power):
            return f"{name}: choose the wall dimmer or switch that powers the bulbs"
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
        for e in [power, *bulbs]:
            if e in used:
                return f"{name}: {e} is already in a team"
            used.add(e)
        out.append({"id": tid, "name": name, "power": power, "bulbs": bulbs,
                    "adaptive": t.get("adaptive") is not False, "curve": CURVE.clean(t.get("curve"))})
    return out


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


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
        self._sent_at = -1e9
        self._dim_seen: tuple[int, float] | None = None

    # what Home Assistant shows
    @property
    def adaptive(self) -> bool:
        return bool(self.cfg.get("adaptive"))

    def _power(self) -> Any:
        return self.io.state(self.cfg["power"])

    @property
    def is_on(self) -> bool:
        st = self._power()
        return bool(st and st.state == "on")

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
                      hs: tuple[float, float] | None = None, effect: str | None = None) -> None:
        was_on = self.is_on
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
        await self._run(boot=not was_on)

    async def turn_off(self) -> None:
        self._gen += 1
        self.manual = False
        self.phase, self.missing = "off", []
        self._power_cmd_at, self._power_cmd_on = self.io.now(), False
        await self._call(self.cfg["power"], False)
        self.io.changed()

    async def _call(self, eid: str, on: bool, data: dict | None = None) -> None:
        try:
            await self.io.call(eid.split(".")[0], "turn_on" if on else "turn_off", {"entity_id": eid, **(data or {})})
        except Exception as err:  # noqa: BLE001 - a bulb still starting refuses; the next send asks again
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
        """Does the bulb show what is wanted? (Its brightness; its colour temperature where it reports one.)"""
        st = self.io.state(eid)
        if not st or st.state != "on":
            return False
        a = st.attributes or {}
        bri = _num(a.get("brightness"))
        if bri is None or abs(bri - self.want.get("brightness", 255)) > 8:
            return False
        k, wk = _num(a.get("color_temp_kelvin")), self.want.get("kelvin")
        return not (wk is not None and self.want.get("hs") is None and k is not None and abs(k - wk) > 150)

    async def _run(self, boot: bool) -> None:
        """The power on and full, then the bulbs sent what is wanted until each answers."""
        self._gen += 1
        g = self._gen
        st = self._power()
        dimmer = self.cfg["power"].startswith("light.")
        level = _num((st.attributes or {}).get("brightness")) if st else None
        if not st or st.state != "on" or (dimmer and level is not None and level < FULL):
            self._power_cmd_at, self._power_cmd_on = self.io.now(), True
            await self._call(self.cfg["power"], True, {"brightness": 255} if dimmer and self._dims(st) else None)
        self.phase, self.missing = "starting", []
        self.io.changed()
        t0 = self.io.now()
        pending = list(self.cfg["bulbs"])
        while pending and self._gen == g:
            for b in pending:
                await self._call(b, True, self._bulb_data())
            self._sent_at = self.io.now()
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
        # Ours: soon after our own command AND the way it went (the wall button pressed on a moment after we cut
        # the power is a person, found on a real Home Assistant, 2026-11-14).
        ours = now - self._power_cmd_at < OWN_S and self._power_cmd_on == (new.state == "on")
        if new.state != "on":
            if self.phase != "off":
                self._gen += 1
                self.phase, self.missing, self.manual = "off", [], False
                self.io.changed()
            return
        if not old or old.state != "on":
            if not ours:                               # the wall button: answered as a turn-on
                if self._follows():
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

    def on_bulb(self, eid: str, new: Any) -> None:
        """A bulb changed: a colour or brightness that is not ours is someone's hand, and the day stops leading."""
        if (self.phase != "ready" or not self._follows() or self.sleep or not new or new.state != "on"
                or self.io.now() - self._sent_at < QUIET_S):
            return
        a = new.attributes or {}
        bri, k = _num(a.get("brightness")), _num(a.get("color_temp_kelvin"))
        wk = self.want.get("kelvin")
        if (bri is not None and abs(bri - self.want.get("brightness", 255)) > 20) or (wk is not None and k is not None and abs(k - wk) > 300):
            self.manual = True
            self.io.changed()

    async def tick(self) -> None:
        """Every ADAPT_EVERY_S: the day moves what is wanted; a bulb that never answered is asked again."""
        if not self.is_on or self.phase not in ("ready", "failed"):
            return
        if self.missing:
            for b in list(self.missing):
                await self._call(b, True, self._bulb_data())
            self.missing = [b for b in self.missing if not self._answered(b)]
            if not self.missing:
                self.phase = "ready"
            self.io.changed()
        if not self._follows():
            return
        t = self._target()
        if abs(t["brightness"] - self.want.get("brightness", 0)) < 3 and abs(t["kelvin"] - (self.want.get("kelvin") or 0)) < 25:
            return
        self.want = t
        for b in self.cfg["bulbs"]:
            if b not in self.missing:
                await self._call(b, True, self._bulb_data(ADAPT_FADE_S))
        self._sent_at = self.io.now()
        self.io.changed()


# ── Home Assistant ──────────────────────────────────────────────────────────
class Manager:
    """The house's teams, live: built from the settings, rebuilt when they change."""

    def __init__(self, hass: Any) -> None:
        self.hass = hass
        self.teams: dict[str, Team] = {}
        self.listeners: dict[str, Callable[[], None]] = {}     # team id -> its light's write
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

    def _target(self, curve: dict | None, sleep: bool) -> dict:
        import time  # noqa: PLC0415
        s = CURVE.settings_at(CURVE.sun_position(time.time(), self._days()), curve, sleep)
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
                t.cfg = cfg
            else:
                t = Team(cfg, self._io(cfg["id"]))
                if t.is_on:
                    t.phase = "ready"
            self.teams[cfg["id"]] = t
        if not self.teams:
            return
        hass = self.hass
        by_power = {t.cfg["power"]: t for t in self.teams.values()}
        by_bulb = {b: t for t in self.teams.values() for b in t.cfg["bulbs"]}

        async def seen(event: Any) -> None:
            eid, new, old = event.data.get("entity_id"), event.data.get("new_state"), event.data.get("old_state")
            if eid in by_power:
                await by_power[eid].on_power(new, old)
            elif eid in by_bulb:
                by_bulb[eid].on_bulb(eid, new)

        async def tick(_now: Any) -> None:
            for t in list(self.teams.values()):
                try:
                    await t.tick()
                except Exception as err:  # noqa: BLE001 - one team's trouble never stops the others
                    _LOGGER.debug("Power team tick failed: %s", err)
        from datetime import timedelta  # noqa: PLC0415
        self._unsub = [async_track_state_change_event(hass, [*by_power, *by_bulb], seen),
                       async_track_time_interval(hass, tick, timedelta(seconds=ADAPT_EVERY_S))]

    def stop(self) -> None:
        for u in self._unsub:
            u()
        self._unsub = []


def manager(hass: Any) -> Manager | None:
    return hass.data.get(DOMAIN, {}).get("power_team_manager")


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
        live = {tid: {"phase": t.phase, "missing": t.missing, "manual": t.manual, "sleep": t.sleep}
                for tid, t in (m.teams.items() if m else [])}
        return {"teams": _stored(hass), "live": live, "defaults": dict(CURVE.DEFAULTS), "limits": {k: list(v) for k, v in CURVE.LIMITS.items()}}

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
