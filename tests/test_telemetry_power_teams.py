"""The usage report's power teams and colour bulbs (telemetry.power_teams_report, env.power_teams).

2026-11-21, the owner: "Add any opt in fields to watch use of the teaming, and hue adoption — or other brands that
work like this". A house with three teams and bulbs of several brands goes in; what comes out is counts and words
from fixed lists, with no team name, entity id, time of day or maker's own words anywhere in the report.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_telemetry import _hass

_ROOT = Path(__file__).resolve().parents[1]

_TEAMS = [
    # A Control4 dimmer feeding two Hue bulbs on Zigbee2MQTT and an IKEA bulb on ZHA; off leaves the power on; its own
    # curve, sunrise moved, and a half-hour wake-up.
    {"id": "9466dc82", "name": "Jordan's Office Lamps", "power": "light.c4_office_dimmer",
     "bulbs": ["light.office_bulb_1", "light.office_bulb_2", "light.office_bulb_3"], "off": "bulbs", "adaptive": True,
     "curve": {"min_brightness": 25, "max_brightness": 100, "min_kelvin": 2700, "max_kelvin": 5000,
               "sleep_brightness": 5, "sleep_kelvin": 2000, "sunrise_offset": 30, "sunset_offset": 0,
               "sunrise_time": "", "sunset_time": ""},
     "wake": {"on": True, "time": "06:45", "days": [0, 1, 2, 3, 4], "minutes": 30, "brightness": 80, "kelvin": 4000}},
    # A team stored before `off`, `wake` and the sun settings: a Shelly relay and a WLED string, not following the
    # day (so its fixed sunset time counts for nothing).
    {"id": "a1b2c3d4", "name": "Alex Porch String", "power": "switch.porch_relay", "bulbs": ["light.porch_string"],
     "adaptive": False, "curve": {"sunset_time": "19:30"}},
    # Lights that always have power: a Tuya bulb on ZHA, the day's defaults, a wake-up that is off.
    {"id": "e5f6a7b8", "name": "Living Strip", "power": "", "bulbs": ["light.lr_tz"], "off": "bulbs", "adaptive": True,
     "curve": {}, "wake": {"on": False, "minutes": 90}},
]
# entity id -> (integration, device id); device id -> maker.
_ENTITIES = {
    "light.c4_office_dimmer": ("control4", "d_c4"), "switch.porch_relay": ("shelly", "d_shelly"),
    "light.office_bulb_1": ("mqtt", "d_hue1"), "light.office_bulb_2": ("mqtt", "d_hue2"),
    "light.office_bulb_3": ("zha", "d_ikea"), "light.porch_string": ("wled", "d_wled"), "light.lr_tz": ("zha", "d_tz"),
    "light.kitchen_valance": ("zha", "d_ledv"), "light.hall_wiz": ("wiz", "d_wiz"),
    "light.no_device": ("template", None), "light.weird": ("matter", "d_acme"),
    "light.jordan_s_office_lamps": ("padspan_ha", None), "light.everything": ("group", None),
    "light.living_room": ("hue", "d_bridge"),
}
_MAKERS = {"d_c4": "Control4", "d_shelly": "Shelly", "d_hue1": "Signify Netherlands B.V.", "d_hue2": "Philips",
           "d_ikea": "IKEA of Sweden", "d_wled": "WLED", "d_tz": "_TZ3210_abcd", "d_ledv": "LEDVANCE",
           "d_wiz": "WiZ", "d_acme": "Acme Lighting Co", "d_bridge": "Signify Netherlands B.V."}
_COLOUR = {"supported_color_modes": ["color_temp", "xy"]}
_LIGHTS = {
    "light.office_bulb_1": _COLOUR, "light.office_bulb_2": _COLOUR, "light.office_bulb_3": {"supported_color_modes": ["color_temp"]},
    "light.porch_string": {"supported_color_modes": ["rgb"]}, "light.lr_tz": {"supported_color_modes": ["hs", "color_temp"]},
    "light.kitchen_valance": {"supported_color_modes": ["color_temp"]}, "light.hall_wiz": {"supported_color_modes": ["rgbw"]},
    "light.no_device": {"supported_color_modes": ["hs"]}, "light.weird": {"supported_color_modes": ["xy"]},
    # Not colour bulbs: the dimmer itself, a plain on/off light.
    "light.c4_office_dimmer": {"supported_color_modes": ["brightness"]}, "light.garage": {"supported_color_modes": ["onoff"]},
    # Not counted: PadSpan's own team light, a group of lights, a Hue Bridge's room.
    "light.jordan_s_office_lamps": {"supported_color_modes": ["color_temp", "hs"], "padspan_power_team": True},
    "light.everything": {"supported_color_modes": ["hs"], "entity_id": ["light.office_bulb_1", "light.hall_wiz"]},
    "light.living_room": {"supported_color_modes": ["xy"], "is_hue_group": True},
}
_SECRETS = ["Jordan", "Office Lamps", "Alex", "Porch String", "Living Strip", "06:45", "19:30", "9466dc82",
            *_ENTITIES, *_MAKERS.values()]


def _house(monkeypatch, teams=_TEAMS, lights=_LIGHTS):
    from homeassistant.helpers import device_registry as dr_mod, entity_registry as er_mod
    ents = {eid: SimpleNamespace(entity_id=eid, platform=p, device_id=d) for eid, (p, d) in _ENTITIES.items()}
    devs = {d: SimpleNamespace(id=d, manufacturer=m) for d, m in _MAKERS.items()}
    monkeypatch.setattr(er_mod, "async_get", lambda h: SimpleNamespace(async_get=ents.get, entities=ents), raising=False)
    monkeypatch.setattr(dr_mod, "async_get", lambda h: SimpleNamespace(devices=devs), raising=False)
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["power_teams"] = teams
    states = [SimpleNamespace(entity_id=eid, state="on", attributes=a) for eid, a in lights.items()]
    h.states.async_all = lambda domain=None: [s for s in states if domain is None or s.entity_id.startswith(domain + ".")]
    return h


def test_a_house_with_teams_says_how_they_are_set_up_and_which_bulbs_it_has(monkeypatch):
    p = T.build_payload(_house(monkeypatch))
    T.assert_shareable(p)
    assert p["env"]["power_teams"] == {
        "n": 3, "with_power": 2, "power_domain": {"light": 1, "switch": 1},
        "power_platform": {"control4": 1, "shelly": 1}, "off": {"bulbs": 1, "power": 1},
        "adaptive": 2, "curve_changed": 1, "sun_shifted": 1, "wake_on": 1, "wake_fade": {"21_40": 1},
        "bulbs": 5, "team_size": {"2_3": 1, "1": 2},
        "bulb_platform": {"mqtt": 2, "zha": 2, "wled": 1}, "bulb_brand": {"hue": 2, "ikea": 1, "wled": 1, "tuya": 1},
        "colour_bulbs_by_platform": {"mqtt": 2, "zha": 3, "wled": 1, "wiz": 1, "template": 1, "matter": 1},
        "colour_bulbs_by_brand": {"hue": 2, "ikea": 1, "wled": 1, "tuya": 1, "ledvance": 1, "wiz": 1,
                                  "unknown": 1, "other": 1},
    }
    text = json.dumps(p)
    leaked = [s for s in _SECRETS if s in text]
    assert not leaked, leaked


def test_zeros_are_left_out(monkeypatch):
    plain = [{"id": "abcd1234", "name": "Hall", "power": "", "bulbs": ["light.hall_wiz"], "adaptive": False, "curve": {}}]
    pt = T.build_payload(_house(monkeypatch, plain, {"light.garage": {"supported_color_modes": ["onoff"]}}))["env"]["power_teams"]
    assert pt == {"n": 1, "bulbs": 1, "team_size": {"1": 1}, "bulb_platform": {"wiz": 1}, "bulb_brand": {"wiz": 1}}
    # No team: only the house's colour bulbs; and with none of those either, no section at all.
    pt = T.build_payload(_house(monkeypatch, [], {"light.hall_wiz": {"supported_color_modes": ["rgbw"]}}))["env"]["power_teams"]
    assert pt == {"colour_bulbs_by_platform": {"wiz": 1}, "colour_bulbs_by_brand": {"wiz": 1}}
    assert "power_teams" not in T.build_payload(_house(monkeypatch, [], {}))["env"]


def test_a_house_the_section_cannot_read_still_reports():
    h = _hass()                                   # its stand-in states have no async_all
    p = T.build_payload(h)
    T.assert_shareable(p)
    assert "power_teams" not in p["env"]


@pytest.mark.parametrize("maker, brand", [
    ("Signify Netherlands B.V.", "hue"), ("Philips", "hue"), ("WiZ", "wiz"), ("Philips WiZ", "wiz"),
    ("IKEA of Sweden", "ikea"), ("Innr", "innr"), ("LIDL Livarno Lux", "lidl"), ("OSRAM", "ledvance"),
    ("LEDVANCE", "ledvance"), ("Sylvania", "ledvance"), ("Sengled", "sengled"), ("GLEDOPTO", "gledopto"),
    ("_TZ3000_dbou1ap4", "tuya"), ("_TYZB01_iuepbmpv", "tuya"), ("TuYa", "tuya"), ("LIFX", "lifx"),
    ("Nanoleaf", "nanoleaf"), ("Govee", "govee"), ("Yeelight", "yeelight"), ("LUMI", "aqara"), ("Aqara", "aqara"),
    ("WLED", "wled"), ("TP-Link", "tplink"), ("Kasa", "tplink"), ("Shelly", "shelly"), ("Allterco Robotics", "shelly"),
    ("C by GE", "cync"), ("Feit Electric", "feit"), ("SONOFF", "sonoff"), ("Acme Lighting Co", "other"),
    ("", "unknown"), ("   ", "unknown"), (None, "unknown"), (42, "unknown"),
])
def test_the_brand_map(maker, brand):
    assert T.bulb_brand(maker) == brand


def test_the_brand_and_integration_lists_are_closed_words():
    assert len(set(T.BULB_BRANDS)) == len(T.BULB_BRANDS) and len(set(T.TEAM_PLATFORMS)) == len(T.TEAM_PLATFORMS)
    for words in T.POWER_TEAM_WORDS.values():
        assert all(w.isascii() and w == w.lower() and len(w) <= 24 and "." not in w for w in words)
    assert T.team_platform("zha") == "zha" and T.team_platform("hubitat") == "other" and T.team_platform(None) == "other"
    assert not set(T.POWER_TEAM_COUNTS) & set(T.POWER_TEAM_WORDS)


@pytest.mark.parametrize("bad", [
    {"names": {"hue": 1}},                        # a key not on the list
    {"power_platform": {"hubitat": 1}},           # a word not on the list
    {"bulb_brand": {"Signify Netherlands": 1}},   # a maker's own words
    {"n": "3"}, {"n": True}, {"n": -1},            # not a count
    {"off": "power"},                             # a word where {word: count} belongs
    {"bulbs": 2, "team_size": {"2_3": 1.5}},
    {},                                           # an empty section is never sent
])
def test_anything_else_in_the_section_is_refused(monkeypatch, bad):
    p = T.build_payload(_house(monkeypatch))
    p["env"]["power_teams"] = bad
    with pytest.raises(ValueError, match="env.power_teams"):
        T.assert_shareable(p)


def test_the_team_card_events_are_allowed_and_counted():
    want = {f"team_card:{w}" for w in ("opened", "power_cut", "power_on", "day", "sleep", "retry", "wake_saved",
                                       "curve_saved", "off_mode_saved")} | {"team_tap"}
    assert T.TEAM_CARD_EVENTS == want and all(T.event_allowed(e) for e in want)
    assert not T.event_allowed("team_card:bogus") and not T.event_allowed("team_tap:kitchen")
    h = _hass()
    assert T.bump(h, "team_card:power_cut") and T.bump(h, "team_tap", 3)
    usage = T.build_payload(h)["usage"]
    assert usage["team_card:power_cut"] == 1 and usage["team_tap"] == 3


def _summary():
    spec = importlib.util.spec_from_file_location("telemetry_summary", _ROOT / "server" / "telemetry_summary.py")
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    return S


def test_the_summary_totals_the_section_across_installs(monkeypatch):
    S = _summary()
    assert set(S._TEAM_CARD) == T.TEAM_CARD_EVENTS
    assert {k for k, _ in S._TEAM_COUNTS} | {"n", "bulbs"} == set(T.POWER_TEAM_COUNTS)
    assert {k for k, _ in S._TEAM_WORDS} == set(T.POWER_TEAM_WORDS)
    a = T.build_payload(_house(monkeypatch))
    a["usage"] = {"team_card:opened": 4, "team_tap": 2}
    b = {"install_id": "b", "env": {"power_teams": {"colour_bulbs_by_brand": {"hue": 6, "ikea": 2},
                                                    "colour_bulbs_by_platform": {"hue": 8}}}, "usage": {"team_card:opened": 1}}
    c = {"install_id": "c", "env": {"power_teams": ["not", "a", "dict"]}}       # an untrusted report, skipped
    text = "\n".join(S.power_teams_section({"a": a, "b": b, "c": c}, [a, b, c]))
    assert "installs with a team: 1 of 3; teams 3, bulbs in them 5" in text
    assert "with a wall control 2" in text and "wake-up on 1" in text
    assert "installs with any colour bulb: 2 (with a Hue bulb: 2)" in text
    assert "every colour bulb by brand: hue 8 (2 installs)" in text
    assert "wall control run by: control4 1 (1 installs)" in text and "turned off by: " in text
    assert "team_card:opened" in text and " 5 " in text.split("team_card:opened")[1].split("\n")[0]
