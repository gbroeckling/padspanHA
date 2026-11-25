"""Power teams (2026-11-14): a wall dimmer and the smart bulbs it feeds, as one light.
"They can be off, but when needed they turn on thru control4, wait for boot up, then do the color
shift requirements." And the light that follows the day (adapted from Adaptive Lighting, with credit)."""
from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from custom_components.padspan_ha import adaptive_curve as C
from custom_components.padspan_ha import power_team as P

ROOT = Path(__file__).resolve().parents[1]
DAY = 86400.0
# Three days of sunrise at 07:00 and sunset at 17:00 (noon 12:00, midnight 00:00), from t = 0 = a midnight.
DAYS = [(d * DAY + 7 * 3600, d * DAY + 17 * 3600) for d in (-1, 0, 1)]
H = 3600.0


# ── the curve ───────────────────────────────────────────────────────────────
def test_the_sun_runs_from_one_at_noon_through_zero_at_the_horizon_to_minus_one_at_midnight() -> None:
    pos = lambda h: C.sun_position(h * H, DAYS)  # noqa: E731
    assert abs(pos(12) - 1) < 1e-9 and abs(pos(7)) < 1e-9 and abs(pos(17)) < 1e-9
    assert abs(pos(24) + 1) < 1e-9 and abs(pos(0) + 1) < 1e-9
    assert 0 < pos(8) < pos(10) < pos(12) > pos(14) > pos(16) > 0
    assert 0 > pos(18) > pos(21) > pos(23.5) and pos(3) < pos(6) < 0
    assert C.sun_position(99 * DAY, DAYS) == 0.0          # outside what it was given: the horizon, never a crash


def test_bright_and_cool_at_noon_warm_at_the_horizon_dim_and_warmer_at_night_and_sleep_is_fixed() -> None:
    noon, rise, mid = C.settings_at(1), C.settings_at(0), C.settings_at(-1)
    assert noon == {"brightness_pct": 100, "kelvin": 5000}
    assert rise == {"brightness_pct": 100, "kelvin": 2200}
    assert mid == {"brightness_pct": 25, "kelvin": 2000}
    eve = C.settings_at(-0.5)
    assert mid["brightness_pct"] < eve["brightness_pct"] < 100 and 2000 < eve["kelvin"] < 2200
    assert C.settings_at(1, None, sleep=True) == {"brightness_pct": 5, "kelvin": 2000}
    own = C.settings_at(1, {"max_kelvin": 4000, "max_brightness": 80})
    assert own == {"brightness_pct": 80, "kelvin": 4000}


def test_the_curves_numbers_stay_in_their_limits_and_in_order() -> None:
    c = C.clean({"min_brightness": 500, "max_brightness": 40, "min_kelvin": 7000, "max_kelvin": 3000, "sleep_kelvin": "x", "sleep_brightness": True})
    assert c["min_brightness"] == 40 and c["max_brightness"] == 40 and c["min_kelvin"] == 3000 and c["max_kelvin"] == 3000
    assert c["sleep_kelvin"] == 2000 and c["sleep_brightness"] == 5


def test_the_credit_is_in_the_file_and_in_the_notices() -> None:
    src = (ROOT / "custom_components/padspan_ha/adaptive_curve.py").read_text(encoding="utf-8")
    notices = (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    for text in (src, notices):
        assert "https://github.com/basnijholt/adaptive-lighting" in text and "Bas Nijholt" in text and "Apache License, Version 2.0" in text


# ── the stored list ─────────────────────────────────────────────────────────
def test_a_team_is_a_power_source_and_its_bulbs_each_in_one_team_only() -> None:
    ok = P.sanitize_teams([{"name": " Bedroom ", "power": "light.dimmer", "bulbs": ["light.b1", "light.b2"]}])
    assert isinstance(ok, list) and ok[0]["name"] == "Bedroom" and ok[0]["adaptive"] is True and ok[0]["curve"] == C.DEFAULTS and len(ok[0]["id"]) == 8
    again = P.sanitize_teams(ok)
    assert again == ok                                    # saved again, the same (its id kept)
    assert isinstance(P.sanitize_teams([{"name": "A", "power": "switch.wall", "bulbs": ["light.b1"], "adaptive": False}]), list)
    for bad in ({"name": "", "power": "light.d", "bulbs": ["light.b"]}, {"name": "A", "power": "sensor.d", "bulbs": ["light.b"]},
                {"name": "A", "power": "light.d", "bulbs": []}, {"name": "A", "power": "light.d", "bulbs": ["switch.b"]},
                {"name": "A", "power": "light.d", "bulbs": ["light.b", "light.b"]}, {"name": "A", "power": "light.d", "bulbs": ["light.d"]}):
        assert isinstance(P.sanitize_teams([bad]), str), bad
    two = [{"name": "A", "power": "light.d", "bulbs": ["light.b"]}, {"name": "B", "power": "light.e", "bulbs": ["light.b"]}]
    assert "already in a team" in P.sanitize_teams(two)
    assert isinstance(P.sanitize_teams("x"), str)


# ── a team, on a fake house ─────────────────────────────────────────────────
class House:
    """A dimmer and bulbs. A bulb answers only once it has had power for `boot` seconds; until then
    Home Assistant goes on showing its last state (as Zigbee2MQTT does)."""

    def __init__(self, boot: float = 5.0, dead: tuple[str, ...] = (), dims: bool = True) -> None:
        self.t = 0.0
        self.boot, self.dead = boot, set(dead)
        self.states: dict[str, SimpleNamespace] = {
            "light.dimmer": SimpleNamespace(state="off", attributes={"supported_color_modes": ["brightness" if dims else "onoff"]}),
            "light.b1": SimpleNamespace(state="on", attributes={"brightness": 60, "color_temp_kelvin": 3000}),
            "light.b2": SimpleNamespace(state="on", attributes={"brightness": 60, "color_temp_kelvin": 3000}),
        }
        self.powered_at: float | None = None
        self.calls: list[tuple[float, str, str, dict]] = []
        self.changes = 0
        self.now_target = {"brightness": 200, "kelvin": 4000}
        self.io = SimpleNamespace(call=self.call, state=self.states.get, sleep=self.sleep, now=lambda: self.t,
                                  target=lambda curve, sleep: {"brightness": 13, "kelvin": 2000} if sleep else dict(self.now_target),
                                  changed=self.changed)

    def changed(self) -> None:
        self.changes += 1

    async def sleep(self, s: float) -> None:
        self.t += s
        await asyncio.sleep(0)

    async def call(self, domain: str, service: str, data: dict) -> None:
        eid = data["entity_id"]
        self.calls.append((self.t, eid, service, {k: v for k, v in data.items() if k != "entity_id"}))
        if eid == "light.dimmer":
            was = self.states[eid]
            if service == "turn_on":
                if was.state != "on":
                    self.powered_at = self.t
                attrs = dict(was.attributes)
                if "brightness" in data:
                    attrs["brightness"] = data["brightness"]
                self.states[eid] = SimpleNamespace(state="on", attributes=attrs)
            else:
                self.powered_at = None
                self.states[eid] = SimpleNamespace(state="off", attributes={"supported_color_modes": was.attributes["supported_color_modes"]})
            return
        if eid in self.dead or self.powered_at is None or self.t - self.powered_at < self.boot:
            return                                         # not on the network yet: nothing changes
        if service == "turn_on":
            # Like Home Assistant: a light that is on keeps what a command does not name (a colour-only send keeps the
            # brightness); one coming on takes what it was sent.
            was = self.states[eid].attributes if self.states[eid].state == "on" else {}
            keep = lambda k: data[k] if k in data else was.get(k)    # noqa: E731
            self.states[eid] = SimpleNamespace(state="on", attributes={"brightness": keep("brightness"), "color_temp_kelvin": keep("color_temp_kelvin"),
                                                                    "hs_color": keep("hs_color")})
        else:
            self.states[eid] = SimpleNamespace(state="off", attributes={})

    def wall(self, on: bool, level: int | None = 255) -> tuple[SimpleNamespace, SimpleNamespace]:
        """The wall button, seen by Home Assistant: (new, old) of the dimmer."""
        old = self.states["light.dimmer"]
        attrs = {"supported_color_modes": old.attributes["supported_color_modes"]}
        if on and level is not None:
            attrs["brightness"] = level
        if on and old.state != "on":
            self.powered_at = self.t
        if not on:
            self.powered_at = None
        self.states["light.dimmer"] = SimpleNamespace(state="on" if on else "off", attributes=attrs)
        return self.states["light.dimmer"], old

    def to(self, eid: str) -> list[tuple[float, str, dict]]:
        return [(t, s, d) for t, e, s, d in self.calls if e == eid]


CFG = {"id": "abcd1234", "name": "Bedroom", "power": "light.dimmer", "bulbs": ["light.b1", "light.b2"], "adaptive": True, "curve": dict(C.DEFAULTS)}
run = asyncio.run


def test_on_is_the_power_at_full_then_the_bulbs_sent_the_days_light_until_each_answers() -> None:
    h = House(boot=5.0)
    t = P.Team(dict(CFG), h.io)

    async def go() -> None:
        await t.turn_on()
    run(go())
    power = h.to("light.dimmer")
    assert power == [(0.0, "turn_on", {"brightness": 255})]                 # full, once, first
    sends = h.to("light.b1")
    assert all(d == {"brightness": 200, "color_temp_kelvin": 4000} for _, s, d in sends if s == "turn_on")
    assert sends[0][0] == 0.0 and len(sends) >= 4 and sends[-1][0] >= 6.0   # asked again and again while it starts
    assert t.phase == "ready" and t.missing == [] and t.is_on and t.effect == P.EFFECT_ADAPTIVE
    assert h.states["light.b2"].attributes["color_temp_kelvin"] == 4000
    assert not any(s == "turn_off" for _, _, s, _ in h.calls)


def test_a_bulb_already_showing_what_is_wanted_is_still_sent_it_after_a_power_on() -> None:
    # Home Assistant shows the last state of a bulb that is still starting: equal to what is wanted, it would look done.
    h = House(boot=5.0)
    for b in ("light.b1", "light.b2"):
        h.states[b] = SimpleNamespace(state="on", attributes={"brightness": 200, "color_temp_kelvin": 4000})
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on())
    assert max(ts for ts, s, _ in h.to("light.b1")) >= 6.0 and t.phase == "ready"
    # Already on and answering: one send, no waiting out a start.
    h.calls.clear()
    h.now_target = {"brightness": 100, "kelvin": 3000}
    t.manual = False
    run(t.turn_on())
    assert len(h.to("light.b1")) == 1 and h.to("light.dimmer") == [] and t.phase == "ready"


def test_a_bulb_that_never_answers_is_named_and_asked_again_later_the_others_are_ready() -> None:
    h = House(boot=1.0, dead=("light.b2",))
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on())
    assert t.phase == "failed" and t.missing == ["light.b2"] and h.t >= P.BOOT_DEADLINE_S
    assert h.states["light.b1"].attributes["brightness"] == 200
    h.dead.clear()
    run(t.tick())
    assert t.phase == "ready" and t.missing == []


def test_off_cuts_the_power_and_tells_the_bulbs_nothing() -> None:
    h = House(boot=1.0)
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on(brightness=90))
    assert t.manual is True
    h.calls.clear()
    run(t.turn_off())
    assert h.calls == [(h.t, "light.dimmer", "turn_off", {})] and t.phase == "off" and not t.is_on and t.manual is False


def test_the_wall_button_is_answered_as_a_turn_on_and_a_dimmer_left_low_is_put_to_full() -> None:
    h = House(boot=3.0)
    t = P.Team(dict(CFG), h.io)
    new, old = h.wall(True, level=120)                                      # the dimmer comes on at its own last level
    run(t.on_power(new, old))
    assert h.to("light.dimmer") == [(0.0, "turn_on", {"brightness": 255})]
    assert t.phase == "ready" and h.states["light.b1"].attributes == {"brightness": 200, "color_temp_kelvin": 4000, "hs_color": None}
    # Its own command echoing back, and the ramp to full after it, are not a hand on the wall.
    n = len(h.calls)
    h.t = 3.0 if h.t < 3.0 else h.t
    t._power_cmd_at, t._power_cmd_on = h.t, True
    run(t.on_power(SimpleNamespace(state="on", attributes={"brightness": 180}), new))
    assert len(h.calls) == n
    # Turned off through the team, then the wall button pressed two seconds later: a person, answered.
    run(t.turn_off())
    h.t += 2
    h.calls.clear()
    new, old = h.wall(True, level=90)
    run(t.on_power(new, old))
    assert h.to("light.dimmer") == [(h.to("light.dimmer")[0][0], "turn_on", {"brightness": 255})] and t.phase == "ready"
    # Off at the wall: the team is off, and the next on follows the day again.
    new, old = h.wall(False)
    run(t.on_power(new, old))
    assert t.phase == "off"


def test_a_dimmer_held_to_a_level_at_the_wall_is_how_bright_the_bulbs_go_and_the_dimmer_goes_back_to_full() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on())
    h.t += 60
    h.calls.clear()
    new, old = h.wall(True, level=102)                                      # 40 %
    run(t.on_power(new, old))
    assert h.to("light.dimmer") == [(h.to("light.dimmer")[0][0], "turn_on", {"brightness": 255})]
    assert h.states["light.b1"].attributes["brightness"] == 102 and h.states["light.b1"].attributes["color_temp_kelvin"] == 4000
    # 2026-11-22: a hold at the wall is a brightness: the day goes on leading the colour (only the brightness stays).
    assert t.manual_bri and not t.manual_colour and t.effect == P.EFFECT_ADAPTIVE and not t.brightness_follows
    h.now_target = {"brightness": 200, "kelvin": 3000}
    h.t += 60
    h.calls.clear()
    run(t.tick())
    assert [d for _, s, d in h.to("light.b1")] == [{"color_temp_kelvin": 3000, "transition": P.ADAPT_FADE_S}]
    assert h.states["light.b1"].attributes == {"brightness": 102, "color_temp_kelvin": 3000, "hs_color": None}   # its brightness kept
    # A level that does not hold (a ramp passing through) is nothing.
    h.t += 60
    h.calls.clear()
    new, old = h.wall(True, level=60)

    async def ramp() -> None:
        task = asyncio.ensure_future(t.on_power(new, old))
        await asyncio.sleep(0)
        h.wall(True, level=255)
        await task
    run(ramp())
    assert h.calls == [] and h.states["light.b1"].attributes["brightness"] == 102


def test_the_day_moves_the_light_with_a_slow_fade_until_someone_chooses_and_again_at_the_next_on() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on())
    h.calls.clear()
    run(t.tick())
    assert h.calls == []                                                    # nothing moved: nothing sent
    h.now_target = {"brightness": 150, "kelvin": 3200}
    h.t += 60
    run(t.tick())
    assert [d for _, s, d in h.to("light.b1")] == [{"brightness": 150, "color_temp_kelvin": 3200, "transition": P.ADAPT_FADE_S}]
    # A colour chosen through the team: the day stops leading the colour, and goes on leading the brightness.
    run(t.turn_on(hs=(30.0, 80.0)))
    assert t.manual_colour and not t.manual_bri and t.effect is None and t.brightness_follows
    assert h.states["light.b1"].attributes["hs_color"] == [30.0, 80.0]
    h.calls.clear()
    h.now_target = {"brightness": 90, "kelvin": 2500}
    h.t += 60
    run(t.tick())
    assert [d for _, s, d in h.to("light.b1")] == [{"brightness": 90, "transition": P.ADAPT_FADE_S}]   # the colour left as chosen
    # Both chosen: the day leads nothing until it is handed back.
    run(t.turn_on(brightness=60))
    h.calls.clear()
    h.now_target = {"brightness": 200, "kelvin": 4500}
    h.t += 60
    run(t.tick())
    assert h.calls == []
    # A brightness changed at the bulb, long after anything PadSpan sent: the brightness only, and kept.
    t.manual = False
    t.want = {"brightness": 150, "kelvin": 3200}
    h.t += 600
    run(t.on_bulb("light.b1", SimpleNamespace(state="on", attributes={"brightness": 40, "color_temp_kelvin": 3200}), h.states["light.b1"]))
    assert t.manual_bri and not t.manual_colour and t.want["brightness"] == 40
    # "Adaptive" hands it back; so does off and on.
    run(t.turn_on(effect=P.EFFECT_ADAPTIVE))
    assert not t.manual and t.want == {"brightness": 200, "kelvin": 4500}
    run(t.turn_on(brightness=20))
    run(t.turn_off())
    run(t.turn_on())
    assert not t.manual and t.want == {"brightness": 200, "kelvin": 4500}


def test_sleep_is_one_fixed_dim_warm_setting_until_adaptive_is_chosen_again() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on(effect=P.EFFECT_SLEEP))
    assert t.sleep and t.effect == P.EFFECT_SLEEP and t.want == {"brightness": 13, "kelvin": 2000}
    h.now_target = {"brightness": 250, "kelvin": 5000}
    h.t += 60
    h.calls.clear()
    run(t.tick())
    assert h.calls == []                                                    # the day does not move a sleeping team
    run(t.turn_on(effect=P.EFFECT_ADAPTIVE))
    assert not t.sleep and t.want == {"brightness": 250, "kelvin": 5000}


def test_a_team_that_does_not_follow_the_day_comes_on_as_it_last_was_and_a_switch_is_only_switched() -> None:
    h = House(boot=0.0, dims=False)
    t = P.Team({**CFG, "adaptive": False}, h.io)
    run(t.turn_on(brightness=77, kelvin=3500))
    run(t.turn_off())
    h.calls.clear()
    run(t.turn_on())
    assert h.to("light.dimmer") == [(h.to("light.dimmer")[0][0], "turn_on", {})]      # on or off only: no level
    assert h.states["light.b1"].attributes["brightness"] == 77 and t.effect is None and not t.manual
    h.now_target = {"brightness": 5, "kelvin": 2000}
    h.t += 60
    n = len(h.calls)
    run(t.tick())
    assert len(h.calls) == n


# ── a team with no power source (2026-11-14: the three Christmas strings, always powered) ──
class Strings(House):
    """Three LED strings that always have power, colour by RGB only (no colour temperature to read back). One
    can be told to drop its next commands, as a string on weak Wi-Fi does."""

    def __init__(self) -> None:
        super().__init__(boot=0.0)
        self.powered_at = 0.0
        self.drop: dict[str, int] = {}
        for b in ("light.b1", "light.b2", "light.b3"):
            self.states[b] = SimpleNamespace(state="off", attributes={})
        del self.states["light.dimmer"]

    async def call(self, domain: str, service: str, data: dict) -> None:
        eid = data["entity_id"]
        self.calls.append((self.t, eid, service, {k: v for k, v in data.items() if k != "entity_id"}))
        if self.drop.get(eid, 0) > 0:
            self.drop[eid] -= 1
            return
        if service == "turn_off":
            self.states[eid] = SimpleNamespace(state="off", attributes={})
        else:
            k = data.get("color_temp_kelvin")
            self.states[eid] = SimpleNamespace(state="on", attributes={"brightness": data.get("brightness"), "rgb_color": [255, (k or 2000) // 20, 40]})

    def outside(self, eid: str, on: bool, **attrs) -> tuple[SimpleNamespace, SimpleNamespace]:
        """Something else (an automation, a person) switches one string: (new, old) as Home Assistant reports it."""
        old = self.states[eid]
        self.states[eid] = SimpleNamespace(state="on" if on else "off", attributes=dict(attrs))
        return self.states[eid], old


SCFG = {"id": "xmas0001", "name": "Christmas strings", "power": "", "bulbs": ["light.b1", "light.b2", "light.b3"], "adaptive": True, "curve": dict(C.DEFAULTS)}


def test_lights_that_always_have_power_can_be_a_team_with_no_power_source() -> None:
    ok = P.sanitize_teams([{"name": "Strings", "power": "", "bulbs": ["light.b1", "light.b2"]}, {"name": "Bedroom", "power": "light.dimmer", "bulbs": ["light.b3"]}])
    assert isinstance(ok, list) and ok[0]["power"] == "" and ok[1]["power"] == "light.dimmer"
    assert isinstance(P.sanitize_teams([{"name": "Strings", "power": "nonsense", "bulbs": ["light.b1"]}]), str)
    h = Strings()
    t = P.Team(dict(SCFG), h.io)
    assert t.powerless and not t.is_on and t.phase == "off"
    run(t.turn_on())
    assert all(h.states[b].state == "on" and h.states[b].attributes["brightness"] == 200 for b in SCFG["bulbs"])
    assert t.is_on and t.phase == "ready" and not any(e == "" for _, e, _, _ in h.calls)       # nothing is ever sent to "no power source"
    assert {d.get("color_temp_kelvin") for _, e, s, d in h.calls if s == "turn_on"} == {4000}    # the same colour to each: they match
    run(t.turn_off())
    assert all(h.states[b].state == "off" for b in SCFG["bulbs"]) and t.phase == "off" and not t.is_on


def test_a_string_that_drops_a_command_is_sent_it_again_on_and_off() -> None:
    h = Strings()
    t = P.Team(dict(SCFG), h.io)
    h.drop["light.b2"] = 2
    run(t.turn_on())
    assert h.states["light.b2"].state == "on" and len(h.to("light.b2")) == 3 and len(h.to("light.b1")) == 1 and t.phase == "ready"
    h.calls.clear()
    h.drop["light.b2"] = 1
    run(t.turn_off())
    assert h.states["light.b2"].state == "off" and [s for _, s, _ in h.to("light.b2")] == ["turn_off", "turn_off"] and len(h.to("light.b1")) == 1


def test_one_string_switched_by_an_automation_takes_the_others_with_it_in_the_days_light() -> None:
    h = Strings()
    t = P.Team(dict(SCFG), h.io)
    # Sunset: the automation turns one on in its own colour (the others follow in the same call; the first is enough).
    new, old = h.outside("light.b1", True, brightness=8, rgb_color=[255, 169, 87])
    run(t.on_bulb("light.b1", new, old))
    assert all(h.states[b].state == "on" and h.states[b].attributes["brightness"] == 200 for b in SCFG["bulbs"]) and t.phase == "ready"
    # The automation's second pass, twenty seconds later, sets its own values again: the next minute puts the day's back.
    h.t += 20
    new, old = h.outside("light.b3", True, brightness=8, rgb_color=[255, 169, 87])
    run(t.on_bulb("light.b3", new, old))
    assert not t.manual                                                    # so soon after ours: not someone's hand
    h.t += 40
    h.calls.clear()
    # What our own re-send changes is reported while it is being sent (as Home Assistant does): never someone's hand.
    real_call = h.io.call

    async def call_and_report(domain: str, service: str, data: dict) -> None:
        before = h.states[data["entity_id"]]
        await real_call(domain, service, data)
        await t.on_bulb(data["entity_id"], h.states[data["entity_id"]], before)
    h.io.call = call_and_report
    run(t.tick())
    h.io.call = real_call
    assert [e for _, e, _, _ in h.calls] == ["light.b3"] and h.states["light.b3"].attributes["brightness"] == 200
    assert not t.manual and t.effect == P.EFFECT_ADAPTIVE
    # Half past nine: the automation turns one off; the team is off, all of it.
    h.t += 600
    h.calls.clear()
    new, old = h.outside("light.b2", False)
    run(t.on_bulb("light.b2", new, old))
    assert all(h.states[b].state == "off" for b in SCFG["bulbs"]) and t.phase == "off"
    # A string coming back from unavailable is not a switch: nothing happens.
    h.calls.clear()
    run(t.on_bulb("light.b1", SimpleNamespace(state="off", attributes={}), SimpleNamespace(state="unavailable", attributes={})))
    run(t.on_bulb("light.b1", SimpleNamespace(state="on", attributes={}), SimpleNamespace(state="unavailable", attributes={})))
    assert h.calls == []


def test_strings_found_on_after_a_restart_are_led_again_without_a_switch() -> None:
    """Home Assistant restarts with the strings on: they are unavailable when the team is made, then heard from."""
    h = Strings()
    gone = SimpleNamespace(state="unavailable", attributes={})
    for b in SCFG["bulbs"]:
        h.states[b] = gone
    t = P.Team(dict(SCFG), h.io)
    assert t.phase == "off" and not t.is_on
    h.now_target = {"brightness": 120, "kelvin": 3000}
    for b in SCFG["bulbs"]:
        h.states[b] = SimpleNamespace(state="on", attributes={"brightness": 255, "rgb_color": [255, 200, 150]})
        run(t.on_bulb(b, h.states[b], gone))
    assert t.phase == "ready" and t.is_on and h.calls == [] and t.effect == P.EFFECT_ADAPTIVE   # taken up, nothing sent yet
    h.t += 60
    run(t.tick())                                                           # the next minute: the day's light, on each
    assert sorted(e for _, e, _, _ in h.calls) == sorted(SCFG["bulbs"]) and all(h.states[b].attributes["brightness"] == 120 for b in SCFG["bulbs"])
    # Found off instead: the team stays off, and nothing is sent.
    h2 = Strings()
    for b in SCFG["bulbs"]:
        h2.states[b] = gone
    t2 = P.Team(dict(SCFG), h2.io)
    h2.states["light.b1"] = SimpleNamespace(state="off", attributes={})
    run(t2.on_bulb("light.b1", h2.states["light.b1"], gone))
    assert t2.phase == "off" and h2.calls == []


def test_a_colour_chosen_on_one_string_by_hand_stops_the_day_leading_the_team() -> None:
    h = Strings()
    t = P.Team(dict(SCFG), h.io)
    run(t.turn_on())
    # What each showed just after our send is remembered as ours.
    run(t.on_bulb("light.b1", h.states["light.b1"], SimpleNamespace(state="on", attributes={})))
    h.t += 600
    new, old = h.outside("light.b1", True, brightness=200, rgb_color=[0, 0, 255])
    run(t.on_bulb("light.b1", new, old))
    assert t.manual_colour and not t.manual_bri and t.effect is None
    h.now_target = {"brightness": 100, "kelvin": 2500}
    h.calls.clear()
    h.t += 60
    run(t.tick())
    sent = [d for _, e, s, d in h.calls if s == "turn_on"]
    assert sent and all("color_temp_kelvin" not in d and "hs_color" not in d and d["brightness"] == 100 for d in sent)   # its colour left as chosen


def test_it_is_wired_in_off_until_a_team_is_made() -> None:
    init = (ROOT / "custom_components/padspan_ha/__init__.py").read_text(encoding="utf-8")
    assert '["sensor", "binary_sensor", "device_tracker", "light"] if edition() == "full" else []' in init
    assert "async_stop_power_teams(hass)" in init
    ws = (ROOT / "custom_components/padspan_ha/websocket.py").read_text(encoding="utf-8")
    assert "from .power_team import async_register as _power_team_register" in ws
    st = (ROOT / "custom_components/padspan_ha/settings_store.py").read_text(encoding="utf-8")
    assert '"power_teams": [],' in st
    src = (ROOT / "custom_components/padspan_ha/power_team.py").read_text(encoding="utf-8")
    assert "if not self.teams:\n            return" in src            # no team: nothing listens, nothing ticks
    assert "@websocket_api.require_admin" in src


# ── Settings → Atlas → Power teams ──────────────────────────────────────────
def test_the_settings_card_makes_saves_and_removes_a_team() -> None:
    import json
    import shutil
    import subprocess

    import pytest
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    views = ROOT / "custom_components/padspan_ha/www/padspan-ha/views"
    res = subprocess.run([node, str(Path(__file__).parent / "js" / "power_teams.mjs"), str(views)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert not out["failures"], json.dumps(out["failures"][:6], indent=2, ensure_ascii=False)
    assert len(out["cases"]) >= 6
    settings = (views / "settings.js").read_text(encoding="utf-8")
    assert 'if (POWER_TEAMS && String(settings.edition || "full").toLowerCase() !== "bright") lightsCard.appendChild(POWER_TEAMS.powerTeamsSection(ctx, el));' in settings
    panel = (views.parent / "panel.js").read_text(encoding="utf-8")
    assert "wled_teams_get power_teams_get " in panel       # reading the teams is a read; saving them stays a write


# ── 2026-11-21: "when controlling the team with a single button press, use hue, but when pressing to get the card,
# give control4 power as an option" — an off that leaves the power on ─────────────────────────────────────────
BCFG = {**CFG, "off": "bulbs"}


def test_what_off_does_is_stored_per_team_and_lights_that_always_have_power_are_always_switched_themselves() -> None:
    ok = P.sanitize_teams([{"name": "A", "power": "light.d", "bulbs": ["light.b"]},
                           {"name": "B", "power": "light.e", "bulbs": ["light.c"], "off": "bulbs"},
                           {"name": "C", "power": "", "bulbs": ["light.f"], "off": "power"},
                           {"name": "D", "power": "light.g", "bulbs": ["light.h"], "off": "nonsense"}])
    assert [t["off"] for t in ok] == ["power", "bulbs", "bulbs", "power"]   # a team saved before has no word: it cuts the power, as it did
    assert P.sanitize_teams(ok) == ok


def test_a_press_off_turns_the_bulbs_off_and_leaves_the_power_on_so_the_next_on_is_at_once() -> None:
    h = House(boot=5.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())                                                       # the first on still starts the bulbs
    assert t.phase == "ready" and t.is_on and h.states["light.dimmer"].state == "on"
    h.calls.clear()
    run(t.turn_off())
    assert all(h.states[b].state == "off" for b in BCFG["bulbs"]) and h.to("light.dimmer") == []
    assert not t.is_on and t.phase == "off" and h.states["light.dimmer"].state == "on"     # dark, the power still on
    h.calls.clear()
    t0 = h.t
    run(t.turn_on())
    assert h.to("light.dimmer") == [] and len(h.to("light.b1")) == 1 and h.t - t0 < P.BOOT_MIN_S   # at once: nothing to start
    assert h.states["light.b1"].attributes == {"brightness": 200, "color_temp_kelvin": 4000, "hs_color": None} and t.is_on


def test_with_the_power_left_on_the_wall_still_works_and_cutting_the_power_is_off() -> None:
    h = House(boot=3.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    h.t += 60
    new, old = h.wall(False)                                               # the card's "Cut power", or the wall
    run(t.on_power(new, old))
    assert t.phase == "off" and not t.is_on                                # a cut bulb still shows "on": no power, not on
    h.t += 60
    h.calls.clear()
    new, old = h.wall(True)
    run(t.on_power(new, old))                                              # the wall again: started and set, as ever
    assert t.phase == "ready" and t.is_on and h.states["light.b2"].attributes["brightness"] == 200


def test_with_the_power_left_on_one_bulb_switched_from_outside_takes_the_others_with_it() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    run(t.turn_off())
    h.t += 60
    old = h.states["light.b1"]
    h.states["light.b1"] = SimpleNamespace(state="on", attributes={"brightness": 30, "color_temp_kelvin": 2700})   # a Hue remote, say
    run(t.on_bulb("light.b1", h.states["light.b1"], old))
    assert t.phase == "ready" and all(h.states[b].attributes.get("brightness") == 200 for b in BCFG["bulbs"])
    h.t += 60
    old = h.states["light.b2"]
    h.states["light.b2"] = SimpleNamespace(state="off", attributes={})
    run(t.on_bulb("light.b2", h.states["light.b2"], old))
    assert t.phase == "off" and all(h.states[b].state == "off" for b in BCFG["bulbs"]) and h.states["light.dimmer"].state == "on"


def test_a_team_that_cuts_the_power_still_does() -> None:
    h = House(boot=1.0)
    t = P.Team(dict(CFG), h.io)
    run(t.turn_on())
    h.calls.clear()
    run(t.turn_off(transition=5))
    assert h.calls == [(h.t, "light.dimmer", "turn_off", {})]


# ── a fade of any length: the wake-up light ──────────────────────────────────
def test_a_long_fade_is_sent_once_and_the_day_and_the_hand_watch_wait_for_it_to_run() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    run(t.turn_off())
    h.calls.clear()
    run(t.turn_on(transition=1800))
    sends = h.to("light.b1")
    assert len(sends) == 1 and sends[0][2]["transition"] == 1800 and t.phase == "ready" and t.missing == []
    assert t.fading
    # Partway: the bulb shows a level of its own on the way. Not someone's hand, and the day does not move it.
    h.t += 600
    old = h.states["light.b1"]
    h.states["light.b1"] = SimpleNamespace(state="on", attributes={"brightness": 70, "color_temp_kelvin": 3100})
    run(t.on_bulb("light.b1", h.states["light.b1"], old))
    h.now_target = {"brightness": 150, "kelvin": 3500}
    h.calls.clear()
    run(t.tick())
    assert h.calls == [] and not t.manual
    h.t += 1300                                                           # done: the day leads again
    run(t.tick())
    assert {d.get("color_temp_kelvin") for _, _, d in h.to("light.b1")} == {3500} and not t.fading
    assert P._fade(99999) == P.MAX_FADE_S and P._fade(0) is None and P._fade("x") is None


def test_the_wake_up_comes_on_dim_and_warm_and_fades_to_its_light_and_leaves_a_lit_room_alone() -> None:
    h = House(boot=0.0)
    cfg = {**BCFG, "wake": {"on": True, "time": "06:30", "days": [0, 1, 2, 3, 4], "minutes": 20, "brightness": 80, "kelvin": 4200}}
    t = P.Team(cfg, h.io)
    run(t.turn_on())
    run(t.turn_off())
    h.calls.clear()
    assert run(t.wake()) is True
    sends = [d for _, s, d in h.to("light.b1") if s == "turn_on"]
    assert sends[0] == {"brightness": P.WAKE_START, "color_temp_kelvin": 2000}               # the dimmest, the sleep colour
    assert sends[-1] == {"brightness": 204, "color_temp_kelvin": 4200, "transition": 1200.0}
    assert t.waking and t.manual and t.effect is None and t.is_on
    h.calls.clear()
    assert run(t.wake()) is False and h.calls == []                                           # someone is up: left alone
    run(t.turn_off())
    assert not t.waking


def test_the_wake_up_is_due_on_its_days_its_minutes_before_its_time_once() -> None:
    from datetime import datetime
    w = {"on": True, "time": "06:30", "days": [0, 1, 2, 3, 4], "minutes": 30}
    mon = datetime(2026, 11, 23, 6, 0)                                     # a Monday
    assert P.wake_due(w, mon) == ("2026-11-23", 1800.0)
    # Due until its full light, with what is left: Home Assistant restarted at 06:20 still wakes the room by 06:30.
    assert P.wake_due(w, mon.replace(minute=20)) == ("2026-11-23", 600.0)
    assert P.wake_due(w, mon.replace(minute=30)) is None and P.wake_due(w, mon.replace(hour=5, minute=59)) is None
    assert P.wake_due(w, datetime(2026, 11, 22, 6, 0)) is None            # Sunday is not one of its days
    assert P.wake_due({**w, "on": False}, mon) is None
    late = {"on": True, "time": "00:10", "days": [1], "minutes": 30}      # Tuesday 00:10 starts Monday 23:40
    assert P.wake_due(late, datetime(2026, 11, 23, 23, 40)) == ("2026-11-24", 1800.0)
    c = P.clean_wake({"time": "25:00", "days": [1, 9, "x", True, 1], "minutes": 500, "brightness": 0, "kelvin": 99999})
    assert c == {"on": False, "time": "06:30", "days": [1], "minutes": 90, "brightness": 1, "kelvin": 9000,
                 "weekend_time": "", "skip": "", "back_after": 60}
    assert P.sanitize_teams([{"name": "A", "power": "light.d", "bulbs": ["light.b"]}])[0]["wake"] == P.WAKE_DEFAULT


# ── the day moved or fixed (Adaptive Lighting's sunrise/sunset offset and time) ─────────────────────
def test_a_lights_day_can_start_and_end_at_fixed_times_or_the_suns_moved_by_minutes() -> None:
    at = lambda i, hhmm: (i - 1) * DAY + int(hhmm[:2]) * H + int(hhmm[3:]) * 60    # noqa: E731
    assert C.shift_days(DAYS, None, at) == DAYS
    moved = C.shift_days(DAYS, {"sunrise_offset": -30, "sunset_offset": 60}, at)
    assert moved[1] == (DAYS[1][0] - 1800, DAYS[1][1] + 3600)
    fixed = C.shift_days(DAYS, {"sunrise_time": "06:30", "sunset_offset": 600}, at)
    assert fixed[1] == (6.5 * H, DAYS[1][1] + 3 * H)                       # the offset is held to its limit, 180 minutes
    assert C.shift_days(DAYS, {"sunrise_time": "20:00", "sunset_time": "08:00"}, at) == DAYS   # a day ending before it starts: the sun's
    c = C.clean({"sunrise_time": "6:30", "sunset_time": "18:45", "sunrise_offset": -999})
    assert c["sunrise_time"] == "" and c["sunset_time"] == "18:45" and c["sunrise_offset"] == -180
    # At 06:45, a day fixed to start at 06:30 is already day (brightest); the sun's own (07:00) is still night.
    assert C.sun_position(6.75 * H, fixed) > 0 > C.sun_position(6.75 * H, DAYS)


# ── what PadSpan switches by entity id goes through the team ────────────────
def test_a_team_member_switched_by_padspan_is_switched_as_its_team() -> None:
    """Vacation mode, presence automations and the emergency lighting test name the wall dimmer (it was placed first).
    For a team that leaves the power on, the dimmer reads on while its bulbs are off: turning it on changed nothing."""
    from custom_components.padspan_ha.const import DOMAIN
    m = P.Manager(None)
    m.teams = {"9466dc82": P.Team({**CFG, "id": "9466dc82"}, House().io)}
    m.lights = {"9466dc82": "light.master_pots"}
    hass = SimpleNamespace(data={DOMAIN: {"power_team_manager": m}})
    assert P.team_light_of(SimpleNamespace(data={}), "light.dimmer") == "light.dimmer"     # no team made: nothing changes
    assert P.team_light_of(hass, "light.dimmer") == "light.master_pots" and P.team_light_of(hass, "light.b2") == "light.master_pots"
    assert P.team_light_of(hass, "light.master_pots") == "light.master_pots" and P.team_light_of(hass, "light.kitchen") == "light.kitchen"
    assert P.team_light_of(hass, "scene.evening") == "scene.evening"
    src = {f: (ROOT / "custom_components/padspan_ha" / f).read_text(encoding="utf-8") for f in ("vacation_mode.py", "emergency_test.py", "presence_coordinator.py")}
    assert "target = team_light_of(hass, entity_id)" in src["vacation_mode.py"] and '{"entity_id": target}' in src["vacation_mode.py"]
    assert "target = team_light_of(hass, eid)" in src["emergency_test.py"] and '{"entity_id": target}, blocking=True' in src["emergency_test.py"]
    # Presence automations and Lights follow people switch through power_team.async_switch, which does the same.
    assert "await async_switch(self.hass, entity_id, action == \"turn_on\", source=\"presence\")" in src["presence_coordinator.py"]
    switch = (ROOT / "custom_components/padspan_ha/power_team.py").read_text(encoding="utf-8")
    switch = switch[switch.index("async def async_switch("):]
    assert "target = team_light_of(hass, eid)" in switch and '{"entity_id": target}' in switch


# ── the review of 2026-11-21: what a real house does that the first tests did not ───────────────────
def test_a_dimmer_heard_from_at_a_restart_or_back_from_out_of_reach_is_no_wall_press() -> None:
    """A team that leaves the power on is off with its dimmer on. Home Assistant starting, or the Control4 link
    dropping for a poll, reports the dimmer from nothing (or unavailable) to on: never the middle-of-the-night on."""
    for old in (None, SimpleNamespace(state="unavailable", attributes={}), SimpleNamespace(state="unknown", attributes={})):
        h = House(boot=0.0)
        h.states["light.dimmer"] = SimpleNamespace(state="on", attributes={"supported_color_modes": ["brightness"], "brightness": 255})
        for b in ("light.b1", "light.b2"):
            h.states[b] = SimpleNamespace(state="off", attributes={})
        h.powered_at = 0.0
        t = P.Team(dict(BCFG), h.io)
        h.t = 100.0
        run(t.on_power(h.states["light.dimmer"], old))
        assert h.calls == [] and t.phase == "off" and not t.is_on, old
    # A team whose off cuts the power, its dimmer first heard from as on: lit (its power is its on), so its bulbs are
    # sent the day's light, as ever.
    h = House(boot=0.0)
    h.states["light.dimmer"] = SimpleNamespace(state="unavailable", attributes={"supported_color_modes": ["brightness"]})
    t = P.Team(dict(CFG), h.io)
    h.states["light.dimmer"] = SimpleNamespace(state="on", attributes={"supported_color_modes": ["brightness"], "brightness": 255})
    h.powered_at = 0.0
    h.t = 100.0
    run(t.on_power(h.states["light.dimmer"], SimpleNamespace(state="unavailable", attributes={})))
    assert t.phase == "ready" and t.is_on and h.states["light.b1"].attributes["brightness"] == 200


def test_off_with_the_power_already_cut_is_off_at_once_and_says_nothing_to_bulbs_that_cannot_hear() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    new, old = h.wall(False)                                                # cut at the wall; the bulbs still read "on"
    run(t.on_power(new, old))
    h.calls.clear()
    t0 = h.t
    run(t.turn_off())
    assert h.calls == [] and h.t == t0 and t.phase == "off" and not t.is_on


def test_a_late_echo_of_our_own_power_on_neither_restarts_the_bulbs_nor_stops_the_wake_up() -> None:
    h = House(boot=2.0)
    cfg = {**BCFG, "wake": {"on": True, "time": "06:30", "days": [0], "minutes": 20, "brightness": 80, "kelvin": 4200}}
    t = P.Team(cfg, h.io)
    real_sleep = h.io.sleep
    echoed = []

    async def sleep_and_echo(s: float) -> None:
        await real_sleep(s)
        if not echoed and h.t >= 10.0:                                      # Control4 reports its on, 10 s late
            echoed.append(h.t)
            await t.on_power(h.states["light.dimmer"], SimpleNamespace(state="off", attributes={"supported_color_modes": ["brightness"]}))
    h.io.sleep = sleep_and_echo
    assert run(t.wake()) is True and echoed
    last = [d for _, s, d in h.to("light.b1") if s == "turn_on"][-1]
    assert last == {"brightness": 204, "color_temp_kelvin": 4200, "transition": 1200.0} and t.waking
    assert len(h.to("light.dimmer")) == 1                                   # one power-on: ours


def test_the_wake_up_fades_over_what_is_left_and_runs_once_a_day() -> None:
    h = House(boot=0.0)
    cfg = {**BCFG, "wake": {"on": True, "time": "06:30", "days": [0], "minutes": 30}}
    t = P.Team(cfg, h.io)
    run(t.wake(600.0))
    assert [d for _, s, d in h.to("light.b1") if s == "turn_on"][-1]["transition"] == 600.0
    t2 = P.Team(cfg, House(boot=0.0).io)
    assert run(t2.wake(5.0)) is True and t2.fading                          # never a jump: a minute at the least


def test_the_end_of_a_long_fade_is_written_and_a_bulb_asked_again_meanwhile_fades_with_the_others() -> None:
    h = House(boot=0.0, dead=("light.b2",))
    h.states["light.b2"] = SimpleNamespace(state="off", attributes={})    # mid-fade, "on" is all a bulb shows: this one never does
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on(transition=1800))
    assert t.missing == ["light.b2"] and t.fading
    h.dead.clear()
    h.t += 300
    h.calls.clear()
    run(t.tick())
    d = h.to("light.b2")[0][2]
    assert 1400 < d["transition"] < 1800 and d["brightness"] == 200        # what is left of the fade, not a jump
    h.t += 2000
    n = h.changes
    run(t.tick())
    assert not t.fading and h.changes > n                                   # the light says the fade is done


def test_a_team_off_with_its_power_left_on_changed_to_cut_the_power_has_it_cut(monkeypatch) -> None:
    import sys
    import types
    ev = types.ModuleType("homeassistant.helpers.event")
    ev.async_track_state_change_event = lambda *a, **k: (lambda: None)
    ev.async_track_time_interval = lambda *a, **k: (lambda: None)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    run(t.turn_off())
    assert h.states["light.dimmer"].state == "on" and not t.is_on
    tasks: list = []
    m = P.Manager(SimpleNamespace(async_create_task=tasks.append))
    m.teams = {CFG["id"]: t}
    m.reload([{**BCFG, "off": "power"}])                                    # the same team, its off now cuts the power
    assert m.teams[CFG["id"]] is t and len(tasks) == 1
    run(tasks[0])
    assert h.states["light.dimmer"].state == "off" and not t.is_on
    tasks.clear()
    m.reload([{**BCFG, "off": "power"}])                                    # saved again: nothing more to do
    assert tasks == []



def test_off_then_on_at_the_wall_soon_after_our_power_on_is_the_wall_both_times() -> None:
    h = House(boot=1.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())                                                       # our power-on
    h.t += 3
    new, old = h.wall(False)
    run(t.on_power(new, old))
    assert t.phase == "off"
    h.t += 4
    h.calls.clear()
    new, old = h.wall(True)                                                # within ECHO_S of ours: still a person
    run(t.on_power(new, old))
    assert t.phase == "ready" and h.states["light.b1"].attributes["brightness"] == 200 and h.to("light.b1")


def test_a_level_held_at_the_wall_soon_after_our_power_on_is_a_hand() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    h.t = 20.0                                                             # inside ECHO_S, outside OWN_S
    h.calls.clear()
    new, old = h.wall(True, level=100)
    run(t.on_power(new, old))
    assert h.to("light.dimmer")[-1][2] == {"brightness": 255} and h.states["light.b1"].attributes["brightness"] == 100


def test_a_wall_press_while_the_dimmer_was_out_of_reach_is_still_the_wall() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)                                           # the dimmer read off when the team was made
    h.t = 100.0
    h.states["light.dimmer"] = SimpleNamespace(state="on", attributes={"supported_color_modes": ["brightness"], "brightness": 255})
    h.powered_at = 100.0
    run(t.on_power(h.states["light.dimmer"], SimpleNamespace(state="unavailable", attributes={})))
    assert t.phase == "ready" and h.states["light.b1"].attributes["brightness"] == 200
    # Out of reach again and back on, having been on: nothing pressed, nothing sent.
    h.calls.clear()
    run(t.on_power(h.states["light.dimmer"], SimpleNamespace(state="unavailable", attributes={})))
    assert h.calls == []


def test_our_power_on_reported_late_after_the_start_is_still_ours() -> None:
    h = House(boot=0.0)
    h.states["light.dimmer"] = SimpleNamespace(state="off", attributes={"supported_color_modes": ["brightness"]})
    t = P.Team(dict(BCFG), h.io)
    real_call = h.io.call

    async def lagging(domain: str, service: str, data: dict) -> None:   # Control4 takes its time to say so
        await real_call(domain, service, data)
        if data["entity_id"] == "light.dimmer":
            h.states["light.dimmer"] = SimpleNamespace(state="off", attributes={"supported_color_modes": ["brightness"]})
    h.io.call = lagging
    run(t.turn_on())
    assert t.phase == "ready"
    h.t += 12                                                              # the start is over; Control4 reports its on now
    h.calls.clear()
    h.states["light.dimmer"] = SimpleNamespace(state="on", attributes={"supported_color_modes": ["brightness"], "brightness": 255})
    run(t.on_power(h.states["light.dimmer"], SimpleNamespace(state="off", attributes={"supported_color_modes": ["brightness"]})))
    assert h.calls == [] and t.phase == "ready"
    # And an off asked for while it has still not said so is sent, not skipped as "no power".
    h.states["light.dimmer"] = SimpleNamespace(state="off", attributes={"supported_color_modes": ["brightness"]})
    t._power_cmd_at, t._power_cmd_on = h.t, True
    run(t.turn_off())
    assert any(s == "turn_off" for _, e, s, _ in h.calls if e == "light.b1")


def test_the_wake_up_runs_once_a_day_across_a_restart(monkeypatch) -> None:
    import sys
    import types
    from datetime import datetime
    ev = types.ModuleType("homeassistant.helpers.event")
    ticks: list = []
    ev.async_track_state_change_event = lambda *a, **k: (lambda: None)
    ev.async_track_time_interval = lambda hass, fn, every: (ticks.append(fn), (lambda: None))[1]
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

    class St:
        data: dict = {}

        async def async_set(self, **kw):
            self.data = {**self.data, **kw}
            return self.data
    st = St()
    now = datetime(2026, 11, 23, 6, 10)
    dtu = types.ModuleType("homeassistant.util.dt")
    dtu.now = lambda: now
    monkeypatch.setitem(sys.modules, "homeassistant.util.dt", dtu)
    import homeassistant.util as hu
    monkeypatch.setattr(hu, "dt", dtu, raising=False)
    tasks: list = []
    cfg = {**BCFG, "wake": {"on": True, "time": "06:30", "days": [0], "minutes": 30}}

    def house_hass():
        return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}, async_create_task=tasks.append, states=SimpleNamespace(get=lambda e: None))
    hass = house_hass()
    m = P.Manager(hass)
    m.reload([cfg])
    m.teams[cfg["id"]].io = House(boot=0.0).io
    run(ticks[-1](None))
    woke = [c for c in tasks if getattr(c, "__name__", "") == "wake"]
    assert len(woke) == 1                                                   # the wake-up runs...
    for c in tasks:
        run(c)
    assert st.data["power_teams_woke"] == {cfg["id"]: "2026-11-23"}        # ...and its day is kept
    tasks.clear()
    m2 = P.Manager(house_hass())                                            # Home Assistant restarts at 06:15
    m2.reload([cfg])
    run(ticks[-1](None))
    assert not [c for c in tasks if getattr(c, "__name__", "") == "wake"]
    for c in tasks:
        c.close()


# ── 2026-11-22: the day's cycle (the owner: "go build the six lighting items") ────────────────────────
def test_a_change_by_hand_hands_back_to_the_day_after_the_teams_resume_minutes() -> None:
    h = House(boot=0.0)
    t = P.Team({**CFG, "resume": 90}, h.io)
    run(t.turn_on())
    run(t.turn_on(brightness=40))
    assert t.manual_bri and not t.brightness_follows
    h.t += 60 * 60                                                          # an hour: still the hand's
    run(t.tick())
    assert t.manual_bri
    run(t.turn_on(brightness=50))                                          # a new change starts the count again
    h.t += 60 * 60
    run(t.tick())
    assert t.manual_bri
    h.t += 31 * 60
    h.calls.clear()
    run(t.tick())
    assert not t.manual and t.brightness_follows and h.states["light.b1"].attributes["brightness"] == 200
    # 0: until the next turn-on, as before.
    t2 = P.Team(dict(CFG), House(boot=0.0).io)
    run(t2.turn_on(brightness=40))
    t2.io.now = lambda: 10 ** 7
    run(t2.tick())
    assert t2.manual_bri
    assert P.sanitize_teams([{**CFG, "resume": 99999}])[0]["resume"] == P.RESUME_MAX_MIN


def test_a_wake_up_hands_back_to_the_day_after_its_back_after_minutes_and_a_room_left_in_sleep_is_woken() -> None:
    h = House(boot=0.0)
    cfg = {**BCFG, "wake": {"on": True, "time": "06:30", "days": [0], "minutes": 20, "brightness": 80, "kelvin": 4200, "back_after": 30}}
    t = P.Team(cfg, h.io)
    run(t.turn_on(effect=P.EFFECT_SLEEP))                                  # left on in Sleep overnight
    assert t.sleep and t.is_on
    h.calls.clear()
    assert run(t.wake()) is True
    sends = [d for _, s, d in h.to("light.b1") if s == "turn_on"]
    assert sends == [{"brightness": 204, "color_temp_kelvin": 4200, "transition": 1200.0}]   # from Sleep, no dark start
    assert t.waking and not t.sleep
    h.t += 1200 + 29 * 60
    run(t.tick())
    assert t.waking
    h.t += 2 * 60
    run(t.tick())
    assert not t.waking and not t.manual and t.effect == P.EFFECT_ADAPTIVE   # back to the day
    # back_after 0: kept until turned off, as before.
    h2 = House(boot=0.0)
    t2 = P.Team({**BCFG, "wake": {"on": True, "back_after": 0}}, h2.io)
    run(t2.wake())
    h2.t += 10 ** 6
    run(t2.tick())
    assert t2.waking and t2.manual


def test_bedtime_fades_a_lit_team_to_sleep_then_off_or_keeps_it_in_sleep_and_leaves_a_dark_room_alone() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    assert run(t.go_to_sleep(30)) is False and h.calls == []               # off: nothing to put to sleep
    run(t.turn_on())
    h.calls.clear()
    assert run(t.go_to_sleep(30, "off")) is True
    assert [d for _, s, d in h.to("light.b1")] == [{"brightness": 13, "color_temp_kelvin": 2000, "transition": 1800.0}]
    assert t.sleep and t.effect == P.EFFECT_SLEEP and t.fading
    h.t += 29 * 60
    run(t.tick())
    assert t.is_on
    h.t += 2 * 60
    run(t.tick())
    assert not t.is_on and h.states["light.dimmer"].state == "on"           # off as the team's own off: the bulbs, power left on
    # Ending in Sleep: it stays there.
    h2 = House(boot=0.0)
    t2 = P.Team(dict(BCFG), h2.io)
    run(t2.turn_on())
    run(t2.go_to_sleep(10, "sleep"))
    h2.t += 3600
    run(t2.tick())
    assert t2.is_on and t2.sleep
    # Turned on by hand mid-fade: no off follows.
    h3 = House(boot=0.0)
    t3 = P.Team(dict(BCFG), h3.io)
    run(t3.turn_on())
    run(t3.go_to_sleep(30, "off"))
    run(t3.turn_on(effect=P.EFFECT_ADAPTIVE))
    h3.t += 3600
    run(t3.tick())
    assert t3.is_on


def test_bedtime_is_due_on_its_days_from_its_time_for_its_minutes() -> None:
    from datetime import datetime
    b = {"on": True, "time": "22:30", "days": [4, 5], "minutes": 30, "end": "sleep"}
    fri = datetime(2026, 11, 27, 22, 30)
    assert P.bedtime_due(b, fri) == ("2026-11-27", 1800.0)
    assert P.bedtime_due(b, fri.replace(minute=50)) == ("2026-11-27", 600.0)
    assert P.bedtime_due(b, fri.replace(hour=23, minute=0)) is None and P.bedtime_due(b, fri.replace(minute=29)) is None
    assert P.bedtime_due(b, datetime(2026, 11, 26, 22, 31)) is None         # Thursday is not one of its days
    assert P.bedtime_due({**b, "on": False}, fri) is None
    assert P.clean_bedtime({"minutes": 999, "end": "x", "days": "x"}) == {**P.BEDTIME_DEFAULT, "minutes": 120}


def test_the_night_light_turns_a_team_on_in_sleep_between_its_hours() -> None:
    from datetime import datetime
    night = {"on": True, "from": "23:00", "to": "06:00"}
    assert P.night_active(night, datetime(2026, 11, 22, 2, 0)) and P.night_active(night, datetime(2026, 11, 22, 23, 30))
    assert not P.night_active(night, datetime(2026, 11, 22, 6, 0)) and not P.night_active(night, datetime(2026, 11, 22, 12, 0))
    assert P.night_active({"on": True, "from": "13:00", "to": "15:00"}, datetime(2026, 11, 22, 14, 0))
    assert not P.night_active({**night, "on": False}, datetime(2026, 11, 22, 2, 0))
    # The team: at 02:00 a turn-on (a tap, an automation) and the wall both give Sleep; at noon, the day.
    for how in ("turn_on", "wall"):
        h = House(boot=0.0)
        h.io.local = lambda: datetime(2026, 11, 22, 2, 0)
        t = P.Team({**CFG, "night": night}, h.io)
        if how == "turn_on":
            run(t.turn_on())
        else:
            new, old = h.wall(True)
            run(t.on_power(new, old))
        assert t.sleep and h.states["light.b1"].attributes["brightness"] == 13, how
    h = House(boot=0.0)
    h.io.local = lambda: datetime(2026, 11, 22, 12, 0)
    t = P.Team({**CFG, "night": night}, h.io)
    run(t.turn_on())
    assert not t.sleep and h.states["light.b1"].attributes["brightness"] == 200
    # A brightness asked for is what is given, night or not.
    h2 = House(boot=0.0)
    h2.io.local = lambda: datetime(2026, 11, 22, 2, 0)
    t2 = P.Team({**CFG, "night": night}, h2.io)
    run(t2.turn_on(brightness=120))
    assert not t2.sleep and h2.states["light.b1"].attributes["brightness"] == 120


def test_a_wake_up_can_skip_a_morning_and_keep_a_weekend_time_of_its_own() -> None:
    from datetime import datetime
    w = {"on": True, "time": "06:30", "weekend_time": "08:00", "days": [0, 1, 2, 3, 4, 5, 6], "minutes": 30}
    sat = datetime(2026, 11, 28, 7, 30)
    assert P.wake_due(w, sat) == ("2026-11-28", 1800.0) and P.wake_due(w, sat.replace(hour=6, minute=0)) is None
    mon = datetime(2026, 11, 23, 6, 0)
    assert P.wake_due(w, mon) == ("2026-11-23", 1800.0)
    assert P.wake_due({**w, "skip": "2026-11-23"}, mon) is None             # skipped: that morning only
    assert P.wake_due({**w, "skip": "2026-11-23"}, datetime(2026, 11, 24, 6, 0)) == ("2026-11-24", 1800.0)
    assert P.wake_next(w, datetime(2026, 11, 22, 21, 0)) == ("2026-11-23", "06:30")   # Sunday evening: Monday's
    assert P.wake_next(w, datetime(2026, 11, 27, 21, 0)) == ("2026-11-28", "08:00")   # Friday evening: Saturday's, later
    assert P.wake_next({**w, "on": False}, mon) is None
    c = P.clean_wake({"weekend_time": "8:00", "skip": "tomorrow", "back_after": 9999})
    assert c["weekend_time"] == "" and c["skip"] == "" and c["back_after"] == 720


def test_the_suns_times_can_be_held_between_an_earliest_and_a_latest() -> None:
    at = lambda i, hhmm: (i - 1) * DAY + int(hhmm[:2]) * H + int(hhmm[3:]) * 60    # noqa: E731
    summer = [(d * DAY + 5 * H, d * DAY + 21.5 * H) for d in (-1, 0, 1)]           # 05:00 and 21:30
    held = C.shift_days(summer, {"min_sunrise_time": "06:30", "max_sunset_time": "20:00"}, at)
    assert held[1] == (6.5 * H, 20 * H)
    winter = [(d * DAY + 8 * H, d * DAY + 16.5 * H) for d in (-1, 0, 1)]            # 08:00 and 16:30
    held = C.shift_days(winter, {"max_sunrise_time": "07:00", "min_sunset_time": "18:00"}, at)
    assert held[1] == (7 * H, 18 * H)
    assert C.shift_days(winter, {"min_sunrise_time": "06:30"}, at) == winter         # inside its limits: the sun's
    assert C.shift_days(summer, {"sunrise_time": "05:45", "min_sunrise_time": "06:30"}, at)[1][0] == 5.75 * H   # a fixed time wins
    assert C.clean({"min_sunset_time": "7pm"})["min_sunset_time"] == ""


# ── the review of the day's cycle (2026-11-22) ─────────────────────────────
def test_sleep_from_the_night_light_or_a_bedtime_ends_with_the_off_so_the_morning_is_the_days() -> None:
    from datetime import datetime
    clock = {"now": datetime(2026, 11, 22, 2, 0)}
    h = House(boot=0.0)
    h.io.local = lambda: clock["now"]
    t = P.Team({**BCFG, "night": {"on": True, "from": "23:00", "to": "06:00"}}, h.io)
    run(t.turn_on())
    assert t.sleep
    run(t.turn_off())
    clock["now"] = datetime(2026, 11, 22, 9, 0)
    run(t.turn_on())
    assert not t.sleep and h.states["light.b1"].attributes["brightness"] == 200
    # A bedtime that ends off: the same.
    h2 = House(boot=0.0)
    t2 = P.Team(dict(BCFG), h2.io)
    run(t2.turn_on())
    run(t2.go_to_sleep(5, "off"))
    h2.t += 400
    run(t2.tick())
    assert not t2.is_on and not t2.sleep
    run(t2.turn_on())
    assert h2.states["light.b1"].attributes["brightness"] == 200


def test_a_brightness_sent_through_the_team_is_sent_again_to_a_bulb_that_dropped_it() -> None:
    h = Strings()
    t = P.Team(dict(SCFG), h.io)
    run(t.turn_on())
    h.drop["light.b2"] = 2
    run(t.turn_on(brightness=40))
    assert t.manual_bri and h.states["light.b2"].attributes["brightness"] == 40 and len(h.to("light.b2")) >= 4
    assert t.phase == "ready"


def test_a_bare_turn_on_of_a_lit_team_leaves_its_bedtime_and_its_wake_up_hand_back_alone() -> None:
    h = House(boot=0.0)
    t = P.Team(dict(BCFG), h.io)
    run(t.turn_on())
    run(t.go_to_sleep(30, "off"))
    h.t += 600
    h.calls.clear()
    run(t.turn_on())                                                       # a presence rule, or Try again, mid-fade
    assert t.sleep and t._off_at is not None and t.fading
    sent = [d for _, s, d in h.to("light.b1") if s == "turn_on"]
    assert sent and 1100 < sent[0]["transition"] < 1300                   # on over what is left of the fade, no jump
    h.t += 1300
    run(t.tick())
    assert not t.is_on                                                     # and still off at its end
    h2 = House(boot=0.0)
    t2 = P.Team({**BCFG, "wake": {"on": True, "minutes": 10, "back_after": 20}}, h2.io)
    run(t2.wake())
    h2.t += 700
    run(t2.turn_on())
    assert t2.waking and t2._back_at is not None
    h2.t += 20 * 60
    run(t2.tick())
    assert not t2.waking and not t2.manual


def test_bedtime_is_only_for_a_team_that_follows_the_day_and_a_hold_at_the_wall_ends_it() -> None:
    h = House(boot=0.0)
    t = P.Team({**CFG, "adaptive": False}, h.io)
    run(t.turn_on())
    assert run(t.go_to_sleep(30)) is False and not t.sleep
    h2 = House(boot=0.0)
    t2 = P.Team(dict(CFG), h2.io)
    run(t2.turn_on())
    run(t2.go_to_sleep(30, "off"))
    h2.t += 120
    new, old = h2.wall(True, level=150)
    run(t2.on_power(new, old))
    assert t2._off_at is None and not t2.sleep and t2.manual_bri
    h2.t += 3600
    run(t2.tick())
    assert t2.is_on


def test_a_bedtime_past_midnight_is_still_due_after_it() -> None:
    from datetime import datetime
    b = {"on": True, "time": "23:50", "days": [4], "minutes": 30}
    assert P.bedtime_due(b, datetime(2026, 11, 27, 23, 55)) == ("2026-11-27", 1500.0)   # a Friday
    assert P.bedtime_due(b, datetime(2026, 11, 28, 0, 5)) == ("2026-11-27", 900.0)      # Saturday 00:05: Friday's
    assert P.bedtime_due(b, datetime(2026, 11, 28, 0, 25)) is None


def test_a_restart_mid_bedtime_puts_a_lit_team_to_sleep_again_once(monkeypatch) -> None:
    import sys
    import types
    from datetime import datetime
    ev = types.ModuleType("homeassistant.helpers.event")
    ticks: list = []
    ev.async_track_state_change_event = lambda *a, **k: (lambda: None)
    ev.async_track_time_interval = lambda hass, fn, every: (ticks.append(fn), (lambda: None))[1]
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.event", ev)
    dtu = types.ModuleType("homeassistant.util.dt")
    dtu.now = lambda: datetime(2026, 11, 22, 22, 40)
    monkeypatch.setitem(sys.modules, "homeassistant.util.dt", dtu)
    import homeassistant.util as hu
    monkeypatch.setattr(hu, "dt", dtu, raising=False)
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

    class St:
        data = {"power_teams_slept": {CFG["id"]: "2026-11-22"}}            # it ran before the restart

        async def async_set(self, **kw):
            self.data = {**self.data, **kw}
    tasks: list = []
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: St()}}, async_create_task=tasks.append, states=SimpleNamespace(get=lambda e: None))
    cfg = {**BCFG, "bedtime": {"on": True, "time": "22:30", "days": [6], "minutes": 30}}
    m = P.Manager(hass)
    m.reload([cfg])
    house = House(boot=0.0)
    t = m.teams[cfg["id"]]
    t.io = house.io
    run(t.turn_on())                                                       # lit, following the day after the restart
    run(ticks[-1](None))
    sleeps = [c for c in tasks if getattr(c, "__name__", "") == "go_to_sleep"]
    assert len(sleeps) == 1
    for c in tasks:
        run(c)
    assert t.sleep and t._off_at is not None
    tasks.clear()
    run(ticks[-1](None))                                                   # the next minute: not again
    assert not [c for c in tasks if getattr(c, "__name__", "") == "go_to_sleep"]
    for c in tasks:
        run(c)
