# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Lights follow people (lights_follow.py, 2026-11-23, free, off by default).

"Turns a room's lights on when a tracked person enters and off after the room
has been empty for a set time. Per room: which lights, the off delay, optional
'only when dark' (sun or a lux sensor), optional quiet hours. Per person:
include or exclude (guests' tags excluded by default). It must never fight a
manual switch: if someone turns a light off by hand while in the room, leave
it off until they leave and come back."
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import lights_follow as L
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

KITCHEN = {"lights": ["light.kitchen"], "off_delay_s": 120}
DEN = {"lights": ["light.den", "switch.den_lamp"], "off_delay_s": 60, "sensors": ["binary_sensor.den_motion"]}


class _States:
    def __init__(self, states: dict[str, str]):
        self.s = dict(states)

    def get(self, eid):
        return SimpleNamespace(state=self.s[eid]) if eid in self.s else None


def _hass(settings: dict, states: dict[str, str]):
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(settings))}},
                           states=_States(states), calls=[])

    async def _call(domain, service, data, **_kw):
        hass.calls.append((domain, service, data["entity_id"]))
        hass.states.s[data["entity_id"]] = "on" if service == "turn_on" else "off"
    hass.services = SimpleNamespace(async_call=_call)
    return hass


@pytest.fixture(autouse=True)
def _plain_lights(monkeypatch):
    """No WLED light PadSpan runs, and the opt-in report's words caught."""
    from custom_components.padspan_ha import wled_exact
    monkeypatch.setattr(wled_exact, "is_exact_entity", lambda hass, eid: False)
    words: list[str] = []
    monkeypatch.setattr(L, "_bump", lambda hass, w: words.append(w))
    return words


def _obj(label, room, **kw):
    return {"user_label": label, "room": room, "kind": "ble", "age_s": 2, **kw}


def _poll(hass, result, now, candidates=None):
    last = {k: {"candidate": v} for k, v in (candidates or {}).items()}
    asyncio.run(L.async_poll(hass, result, set(result), last, now=now))


def _house(**settings):
    base = {"lights_follow_enabled": True, "lights_follow_rooms": {"Kitchen": KITCHEN, "Den": DEN}}
    return _hass({**base, **settings}, {"light.kitchen": "off", "light.den": "off", "switch.den_lamp": "off",
                                        "binary_sensor.den_motion": "off", "sun.sun": "below_horizon"})


# ── off by default ──────────────────────────────────────────────────────────

def test_off_on_every_install_until_turned_on_and_nothing_runs_while_off():
    assert DEFAULT_SETTINGS["lights_follow_enabled"] is False
    assert DEFAULT_SETTINGS["lights_follow_rooms"] == {} and DEFAULT_SETTINGS["lights_follow_people"] == {}
    hass = _house(lights_follow_enabled=False)
    for t in (0, 10, 500):
        _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, t)
        _poll(hass, {"ble:a": _obj("Alex phone", "Den")}, t + 5)
    assert hass.calls == [] and L._DATA not in hass.data[DOMAIN]
    # An install that never saved the key (an existing one) is off the same way.
    hass2 = _house()
    del hass2.data[DOMAIN][DATA_SETTINGS].data["lights_follow_enabled"]
    _poll(hass2, {}, 0)
    _poll(hass2, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    assert hass2.calls == []


# ── walking between two rooms ───────────────────────────────────────────────

def test_walking_between_two_rooms_switches_lights_as_configured(_plain_lights):
    hass = _house()
    _poll(hass, {}, 0)                                                   # first poll: a baseline
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    assert hass.calls == [("light", "turn_on", "light.kitchen")]
    _poll(hass, {"ble:a": _obj("Alex phone", "Den")}, 60)
    assert hass.calls[1:] == [("light", "turn_on", "light.den"), ("switch", "turn_on", "switch.den_lamp")]
    _poll(hass, {"ble:a": _obj("Alex phone", "Den")}, 60 + 119)          # the kitchen's 120 s are not up
    assert len(hass.calls) == 3
    _poll(hass, {"ble:a": _obj("Alex phone", "Den")}, 60 + 120)
    assert hass.calls[3:] == [("light", "turn_off", "light.kitchen")]
    _poll(hass, {"ble:a": _obj("Alex phone", "Den")}, 1000)              # once: not again and again
    assert len(hass.calls) == 4
    # Leaving the house (no longer present): the den goes off after its own 60 s.
    _poll(hass, {}, 1010)
    _poll(hass, {}, 1069)
    assert len(hass.calls) == 4
    _poll(hass, {}, 1070)
    assert hass.calls[4:] == [("light", "turn_off", "light.den"), ("switch", "turn_off", "switch.den_lamp")]
    assert _plain_lights.count("lit") == 2 and _plain_lights.count("off_empty") == 2


def test_someone_already_in_a_room_is_a_baseline_and_a_light_on_by_hand_in_an_untracked_room_stays_on():
    hass = _house()
    hass.states.s["light.den"] = "on"                                     # a visitor without a tag lit the den
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 0)              # restart: Alex already in the kitchen
    for t in (5, 300, 900):
        _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, t)
    assert hass.calls == []


# ── never fight a manual switch ─────────────────────────────────────────────

def test_a_light_turned_off_by_hand_stays_off_until_they_leave_and_come_back(_plain_lights):
    hass = _house()
    alex_in = {"ble:a": _obj("Alex phone", "Kitchen")}
    _poll(hass, {}, 0)
    _poll(hass, alex_in, 5)
    assert hass.calls == [("light", "turn_on", "light.kitchen")]
    _poll(hass, alex_in, 10)
    hass.states.s["light.kitchen"] = "off"                                # off by hand, Alex still there
    for t in (15, 20, 400):
        _poll(hass, alex_in, t)
    assert len(hass.calls) == 1 and "manual_hold" in _plain_lights
    # Out to the hall and straight back (under a minute): not leaving.
    _poll(hass, {"ble:a": _obj("Alex phone", "Hall")}, 405)
    _poll(hass, alex_in, 430)
    assert len(hass.calls) == 1 and "held" in _plain_lights
    # Gone a while, then back: on again.
    _poll(hass, {"ble:a": _obj("Alex phone", "Hall")}, 500)
    _poll(hass, {"ble:a": _obj("Alex phone", "Hall")}, 500 + L.LEAVE_S)
    _poll(hass, alex_in, 600)
    assert hass.calls[1:] == [("light", "turn_on", "light.kitchen")]


def test_a_second_person_coming_in_does_not_undo_the_hand():
    hass = _house()
    _poll(hass, {}, 0)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 10)
    hass.states.s["light.kitchen"] = "off"
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 15)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen"), "ble:s": _obj("Sam watch", "Kitchen")}, 20)
    assert hass.calls == [("light", "turn_on", "light.kitchen")]


# ── per room: dark, quiet hours ─────────────────────────────────────────────

def test_only_when_dark_by_the_sun_or_a_light_sensor():
    sun = {**KITCHEN, "dark": "sun"}
    hass = _house(lights_follow_rooms={"Kitchen": sun})
    hass.states.s["sun.sun"] = "above_horizon"
    _poll(hass, {}, 0)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    assert hass.calls == []
    lux = {**KITCHEN, "dark": "lux", "lux_entity": "sensor.kitchen_lux", "lux_below": 40}
    hass = _house(lights_follow_rooms={"Kitchen": lux})
    hass.states.s["sensor.kitchen_lux"] = "300"
    _poll(hass, {}, 0)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    assert hass.calls == []
    _poll(hass, {}, 10)
    hass.states.s["sensor.kitchen_lux"] = "12"
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 15)
    assert hass.calls == [("light", "turn_on", "light.kitchen")]


def test_quiet_hours_turn_nothing_on_but_still_turn_off(monkeypatch):
    from homeassistant.util import dt as dt_util
    monkeypatch.setattr(dt_util, "now", lambda: datetime(2026, 11, 24, 23, 30))
    hass = _house(lights_follow_rooms={"Kitchen": {**KITCHEN, "quiet": "22:00-07:00"}})
    _poll(hass, {}, 0)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    assert hass.calls == []
    hass.states.s["light.kitchen"] = "on"                                 # lit by hand at night
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 10)
    _poll(hass, {}, 20)
    _poll(hass, {}, 140)
    assert hass.calls == [("light", "turn_off", "light.kitchen")]


# ── a motion sensor confirms an entry at once ───────────────────────────────

def test_a_rooms_motion_sensor_confirms_an_entry_before_room_change_delay(_plain_lights):
    hass = _house()
    hass.states.s["light.kitchen"] = "on"
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 0)
    # This poll's evidence says Den; the room shown is still Kitchen (Room Change Delay).
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5, {"ble:a": "Den"})
    assert hass.calls == []                                               # no motion in the den: wait
    hass.states.s["binary_sensor.den_motion"] = "on"
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 10, {"ble:a": "Den"})
    assert hass.calls == [("light", "turn_on", "light.den"), ("switch", "turn_on", "switch.den_lamp")]
    assert "sensor_entry" in _plain_lights
    # The kitchen counts as left from then on, with its own delay.
    _poll(hass, {"ble:a": _obj("Alex phone", "Den")}, 130)
    assert hass.calls[2:] == [("light", "turn_off", "light.kitchen")]


def test_motion_alone_with_nobody_tracked_turns_nothing_on():
    hass = _house()
    hass.states.s["binary_sensor.den_motion"] = "on"
    _poll(hass, {}, 0)
    _poll(hass, {"ble:c": {"room": "Den", "kind": "ble", "age_s": 1}}, 5, {"ble:c": "Den"})   # an unnamed device
    assert hass.calls == []


# ── per person ──────────────────────────────────────────────────────────────

def test_people_can_be_excluded_and_a_guest_tag_counts_only_when_included(monkeypatch):
    hass = _house(lights_follow_people={"Alex phone": False})
    _poll(hass, {}, 0)
    _poll(hass, {"ble:a": _obj("Alex phone", "Kitchen")}, 5)
    assert hass.calls == []
    monkeypatch.setattr(L, "guest_keys", lambda hass, result: {"ble:g"})
    hass = _house()
    _poll(hass, {}, 0)
    _poll(hass, {"ble:g": _obj("Guest tag 1", "Kitchen")}, 5)
    assert hass.calls == []
    hass = _house(lights_follow_people={"guest tag 1": True})
    _poll(hass, {}, 0)
    _poll(hass, {"ble:g": _obj("Guest tag 1", "Kitchen")}, 5)
    assert hass.calls == [("light", "turn_on", "light.kitchen")]


def test_a_guest_tag_is_one_marked_in_guests():
    from custom_components.padspan_ha import guest_tags as G
    hass = _house(guest_tags_enabled=True)
    store = G.GuestStore.__new__(G.GuestStore)
    store.loaded, store.data = True, {"tags": {"ps_1": {"pid": "ps_1", "label": "Guest tag 1", "keys": ["ble:g"]}},
                                      "sessions": {}}
    hass.data[DOMAIN][G.DATA_GUESTS] = store
    result = {"ble:g": _obj("Guest tag 1", "Kitchen"), "ble:a": _obj("Alex phone", "Den")}
    assert L.guest_keys(hass, result) == {"ble:g"}
    hass.data[DOMAIN][DATA_SETTINGS].data["guest_tags_enabled"] = False
    assert L.guest_keys(hass, result) == set()


# ── what is kept ────────────────────────────────────────────────────────────

def test_rooms_and_people_keep_only_what_can_be_used():
    rooms = L.clean_rooms({
        "Kitchen": {"lights": ["light.kitchen", "lock.front_door", "light.kitchen", 7], "off_delay_s": 99999,
                    "dark": "moon", "quiet": "9-5", "sensors": ["binary_sensor.k_motion", "sensor.x"]},
        "Den": {"lights": [], "off_delay_s": 30},                         # nothing to switch: dropped
        "Hall": {"lights": ["switch.hall"], "dark": "lux", "lux_entity": "light.x", "off_delay_s": "abc"},
        "": {"lights": ["light.x"]}, 5: {"lights": ["light.x"]},
    })
    assert rooms == {
        "Kitchen": {"lights": ["light.kitchen"], "off_delay_s": L.OFF_DELAY_MAX_S, "dark": "", "lux_entity": "",
                    "lux_below": L.DEFAULT_LUX_BELOW, "quiet": "", "sensors": ["binary_sensor.k_motion"]},
        "Hall": {"lights": ["switch.hall"], "off_delay_s": L.DEFAULT_OFF_DELAY_S, "dark": "", "lux_entity": "",
                 "lux_below": L.DEFAULT_LUX_BELOW, "quiet": "", "sensors": []},
    }
    assert L.clean_rooms("x") == {} and L.clean_people(["x"]) == {}
    assert L.clean_people({" Alex Phone ": False, "Sam": "no", "": True}) == {"alex phone": False}


def test_the_settings_command_takes_the_switch_and_the_rooms():
    from custom_components.padspan_ha import ws_settings as WS
    src = open(WS.__file__, encoding="utf-8").read()
    # Both: the command's schema, and the handler's list of switches it keeps.
    assert 'vol.Optional("lights_follow_enabled"): bool' in src
    allow = src[src.index('for key in ("ha_entity_tracker_enabled"'):]
    assert '"lights_follow_enabled"):' in allow[:allow.index("payload[key] = bool(msg[key])")]
    assert 'payload["lights_follow_rooms"] = _lf_rooms(msg["lights_follow_rooms"])' in src
    assert 'payload["lights_follow_people"] = _lf_people(msg["lights_follow_people"])' in src


# ── the opt-in report ───────────────────────────────────────────────────────

def test_the_report_counts_words_only():
    assert all(T.event_allowed(f"lights_follow:{w}") for w in T.LIGHTS_FOLLOW_WORDS)
    assert not T.event_allowed("lights_follow:Kitchen")
    assert T._FEATURE_ON_ONLY["lights_follow_enabled"] == "lights_follow"
    import inspect
    src = inspect.getsource(L)
    used = set(__import__("re").findall(r'_bump\(hass, "([a-z_]+)"\)', src)) | {"held", "manual_hold", "skip_quiet",
                                                                                 "skip_daylight", "lit", "off_empty",
                                                                                 "failed"}
    assert used <= set(T.LIGHTS_FOLLOW_WORDS)


# ── the Settings card (views/lights_follow.js) ──────────────────────────────

def test_the_settings_card_runs():
    import json
    import shutil
    import subprocess
    from pathlib import Path
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    root = Path(__file__).resolve().parents[1]
    views = root / "custom_components/padspan_ha/www/padspan-ha/views"
    res = subprocess.run([node, str(Path(__file__).parent / "js" / "lights_follow.mjs"), str(views)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert not out["failures"], json.dumps(out["failures"][:6], indent=2, ensure_ascii=False)
    assert len(out["cases"]) >= 10
    # Beside the arrive/depart Automations, in Settings → Tracking → Home Assistant and integrations.
    settings = (views / "settings.js").read_text(encoding="utf-8")
    assert 'if (LIGHTS_FOLLOW) put("integrations", LIGHTS_FOLLOW.lightsFollowSection(ctx, el));' in settings
    assert settings.index('put("integrations", el("div",{class:"card"}, cardChildren));') \
        < settings.index("LIGHTS_FOLLOW.lightsFollowSection")
    # Reading what each room holds is a read (Sample mode answers it); saving stays settings_set.
    assert " lights_follow_get " in (views.parent / "panel.js").read_text(encoding="utf-8")


# ── the blueprints, for people who prefer their own automations ─────────────

def test_the_blueprints_are_whole_and_linked_from_the_manual():
    from pathlib import Path

    import yaml

    class _Loader(yaml.SafeLoader):
        pass
    _Loader.add_constructor("!input", lambda loader, node: ("!input", loader.construct_scalar(node)))
    root = Path(__file__).resolve().parents[1]
    folder = root / "blueprints" / "automation" / "padspan_ha"
    files = sorted(folder.glob("*.yaml"))
    assert 2 <= len(files) <= 3, files
    manual = (root / "docs" / "manual" / "14-home-assistant-reference.md").read_text(encoding="utf-8")
    manual_de = (root / "docs" / "manual" / "de" / "14-home-assistant-reference.md").read_text(encoding="utf-8")
    for f in files:
        text = f.read_text(encoding="utf-8")
        doc = yaml.load(text, Loader=_Loader)
        bp = doc["blueprint"]
        assert bp["domain"] == "automation" and bp["name"].startswith("PadSpan - ")
        assert bp["source_url"].endswith(f"/blob/main/blueprints/automation/padspan_ha/{f.name}")
        declared = set(bp["input"])
        used: set[str] = set()

        def walk(v):
            if isinstance(v, tuple) and v and v[0] == "!input":
                used.add(v[1])
            elif isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
        walk({k: v for k, v in doc.items() if k != "blueprint"})
        assert used == declared, (f.name, declared ^ used)
        assert doc.get("triggers") and doc.get("actions")
        # Never a lock, a garage door or an alarm: lights and switches only.
        assert not any(w in text for w in ("lock.", "cover.", "alarm_control_panel"))
        link = f"blueprint_import/?blueprint_url=https%3A%2F%2Fgithub.com%2Fgbroeckling%2FpadspanHA%2Fblob%2Fmain%2Fblueprints%2Fautomation%2Fpadspan_ha%2F{f.name}"
        assert link in manual and link in manual_de, f.name


def test_the_one_switch_path_refuses_anything_but_a_light_switch_scene_or_script():
    from custom_components.padspan_ha import power_team as P
    hass = _house()
    with pytest.raises(ValueError):
        asyncio.run(P.async_switch(hass, "lock.front_door", False, source="lights_follow"))
    assert asyncio.run(P.async_switch(hass, "switch.den_lamp", True, source="lights_follow")) == "switch.den_lamp"
    assert hass.calls == [("switch", "turn_on", "switch.den_lamp")]
