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
            self.states[eid] = SimpleNamespace(state="on", attributes={"brightness": data.get("brightness"), "color_temp_kelvin": data.get("color_temp_kelvin"),
                                                                    "hs_color": data.get("hs_color")})

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
    assert t.manual is True and t.effect is None                            # chosen by hand: the day stops leading
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
    # A colour chosen through the team: the day stops leading.
    run(t.turn_on(hs=(30.0, 80.0)))
    assert t.manual and t.effect is None and h.states["light.b1"].attributes["hs_color"] == [30.0, 80.0]
    h.calls.clear()
    h.now_target = {"brightness": 90, "kelvin": 2500}
    run(t.tick())
    assert h.calls == []
    # A bulb changed directly, long after anything PadSpan sent: the same.
    t.manual = False
    t.want = {"brightness": 150, "kelvin": 3200}
    h.t += 600
    run(t.on_bulb("light.b1", SimpleNamespace(state="on", attributes={"brightness": 40, "color_temp_kelvin": 3200}), h.states["light.b1"]))
    assert t.manual is True
    # "Adaptive" hands it back; so does off and on.
    run(t.turn_on(effect=P.EFFECT_ADAPTIVE))
    assert not t.manual and t.want == {"brightness": 90, "kelvin": 2500}
    run(t.turn_on(brightness=20))
    run(t.turn_off())
    run(t.turn_on())
    assert not t.manual and t.want == {"brightness": 90, "kelvin": 2500}


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
    assert t.manual and t.effect is None
    h.now_target = {"brightness": 100, "kelvin": 2500}
    h.calls.clear()
    run(t.tick())
    assert h.calls == []                                                   # left as chosen


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
