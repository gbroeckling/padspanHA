# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The remembered WLED look and the requests that put it back (wled_look.py).

Pure functions: what is captured, what a turn-on sends and in what order,
what is never sent, how a reply is compared, how a team's brightness is
shared. The device rules they rely on are WLED's own (json.cpp 0.14-16);
tests/wled_fake.py replays the requests through them.
"""

from __future__ import annotations

import asyncio
import copy
import json

import pytest

from custom_components.padspan_ha import wled_look as L
from custom_components.padspan_ha import ws_wled as W
from tests.wled_fake import FakeWled, simple_device

# Quin-Kitchen-Valance (.2.118), captured 2026-09-27 (GET only): a 5-channel
# PWM output (RGB+CCT, manual white) + 30 RGB LEDs, two segments.
_Q118_SEG = [
    {"id": 0, "start": 0, "stop": 1, "len": 1, "grp": 1, "spc": 0, "of": 0, "on": True, "frz": False, "bri": 255,
     "cct": 127, "set": 0, "col": [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "fx": 0, "sx": 128, "ix": 128,
     "pal": 0, "c1": 128, "c2": 128, "c3": 16, "sel": True, "rev": False, "mi": False, "o1": False, "o2": False,
     "o3": False, "si": 0, "m12": 0},
    {"id": 1, "start": 1, "stop": 31, "len": 30, "grp": 1, "spc": 0, "of": 0, "on": True, "frz": False, "bri": 255,
     "cct": 127, "set": 0, "col": [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], "fx": 0, "sx": 128, "ix": 128,
     "pal": 0, "c1": 128, "c2": 128, "c3": 16, "sel": True, "rev": False, "mi": False, "o1": False, "o2": False,
     "o3": False, "si": 0, "m12": 0},
]
_Q118_STATE = {"on": True, "bri": 128, "transition": 7, "ps": -1, "pl": -1, "ledmap": 0,
               "nl": {"on": False, "dur": 60, "mode": 1, "tbri": 0, "rem": -1},
               "udpn": {"send": False, "recv": True, "sgrp": 1, "rgrp": 1}, "lor": 0, "mainseg": 0, "seg": _Q118_SEG}
_Q118_INFO = {"ver": "0.15.0-b7", "arch": "esp32", "mac": "28562f551738", "fxcount": 187,
              "leds": {"count": 31, "seglc": [7, 1], "lc": 7, "rgbw": True, "cct": 4, "maxseg": 32}}

# QuinLED Far West Valance: hw.led from PadSpan's 09-23 21:29 backup and from
# the live device on 09-27 (someone changed output 2 and output 1's white mode).
_FW_BUSES_0923 = [
    {"start": 0, "len": 1, "pin": [2, 4, 12, 32, 33], "order": 1, "rev": False, "skip": 0, "type": 45, "ref": False,
     "rgbwm": 0, "freq": 19531, "maxpwr": 0, "ledma": 0},
    {"start": 1, "len": 78, "pin": [5], "order": 1, "rev": False, "skip": 0, "type": 22, "ref": False, "rgbwm": 0,
     "freq": 0, "maxpwr": 250, "ledma": 255}]
_FW_BUSES_0927 = [
    {**_FW_BUSES_0923[0], "rgbwm": 2, "freq": 9765},
    {**_FW_BUSES_0923[1], "type": 30, "maxpwr": 0}]


def _fw_cfg(buses):
    return {"hw": {"led": {"total": 79, "maxpwr": 0, "ledma": 0, "cct": False, "cr": False, "ic": False, "cb": 0,
                           "fps": 42, "rgbwm": 255, "ld": True, "ins": buses}},
            "light": {"scale-bri": 100, "gc": {"bri": 1, "col": 1, "val": 2.8}}}


def _look(state=None, info=None, cfg=None):
    return L.capture({"state": copy.deepcopy(state or _Q118_STATE), "info": info or _Q118_INFO},
                     cfg or _fw_cfg(_FW_BUSES_0923), by="test", at=1000.0)


# ── capture ──────────────────────────────────────────────────────────────────


def test_capture_drops_len_and_lc_and_keeps_every_other_key_and_4_value_colours():
    st = copy.deepcopy(_Q118_STATE)
    st["seg"][1].update(lc=1, bm=2, frz=True, n="Valance")
    look = _look(st)
    segs = look["state"]["seg"]
    assert all("len" not in s and "lc" not in s for s in segs)
    assert segs[1]["bm"] == 2 and segs[1]["n"] == "Valance"
    assert segs[1]["frz"] is False, "a frozen segment is never the look"
    assert segs[0]["col"] == [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
    assert (look["state"]["bri"], look["state"]["tt"], look["state"]["mainseg"]) == (128, 7, 0)
    assert look["fw"] == "0.15.0-b7" and look["setup_hash"] == L.setup_hash(look["setup"])
    keys = set(_Q118_SEG[0]) - {"len"}
    assert set(segs[0]) == keys


def test_far_wests_0923_backup_against_its_live_settings_in_plain_words():
    old = L.setup_record({"leds": {"count": 79, "seglc": [7, 1], "rgbw": True}}, _fw_cfg(_FW_BUSES_0923))
    new = L.setup_record({"leds": {"count": 79, "seglc": [5, 3], "rgbw": True}}, _fw_cfg(_FW_BUSES_0927))
    d = L.setup_diff(old, new)
    assert d["geometry"] == ["Output 2 changed from RGB (WS281x) to RGBW (SK6812)"]
    assert "Output 1 white mode None → Accurate" in d["colour"]
    assert "Output 1 PWM frequency 19531 Hz → 9765 Hz" in d["colour"]
    assert "Output 2 current limit 250 mA → none" in d["colour"]
    assert L.setup_diff(old, old) == {"geometry": [], "colour": []}
    assert L.setup_hash(old) != L.setup_hash(new)


def test_warnings_when_remembering():
    st = copy.deepcopy(_Q118_STATE)
    st["seg"][0]["pal"] = 1
    st["seg"][1]["fx"] = 5
    st["pl"] = 2
    st["nl"]["on"] = True
    w = L.warnings({**_Q118_INFO, "live": True}, st)
    assert any("Random Cycle" in x for x in w) and any("random colours" in x for x in w)
    assert any("playlist" in x for x in w) and any("nightlight" in x for x in w) and any("realtime" in x for x in w)
    assert L.warnings(_Q118_INFO, _Q118_STATE) == []
    # .2.115: the only segment covers the 16x16 matrix, none drives the 640-LED strip.
    gyver = {"on": True, "seg": [{"id": 0, "start": 0, "stop": 16, "startY": 0, "stopY": 16}]}
    assert L.warnings({"leds": {"count": 896, "matrix": {"w": 16, "h": 16}}}, gyver) == [
        "640 of 896 LEDs aren't in any part of the look, so they stay dark"]


def test_team_members_with_different_gamma_are_warned():
    a = _look()
    b = _look(cfg={**_fw_cfg(_FW_BUSES_0923), "light": {"scale-bri": 100, "gc": {"bri": 1, "col": 2.8, "val": 2.8}}})
    assert L.team_warnings([a, b]) and not L.team_warnings([a, _look()])


# ── requests ─────────────────────────────────────────────────────────────────


def test_turn_on_while_dark_sends_segments_then_the_tail_then_on():
    look = _look()
    live = copy.deepcopy(_Q118_STATE)
    live["on"] = False
    live["seg"].append({**_Q118_SEG[1], "id": 2, "start": 5, "stop": 9})       # a segment the look doesn't have
    bodies = L.on_bodies(look["state"], live, L.Ctx(_Q118_INFO), bri=90, tt=7, dark=True)
    assert [("seg" in b, "on" in b) for b in bodies] == [(True, False), (True, False), (False, True)]
    first, tail, final = bodies
    assert first["tt"] == 0 and first["nl"] == {"on": False} and first["udpn"] == L.UDPN_OFF
    assert first["mainseg"] == 0 and [s["id"] for s in first["seg"]] == [0, 1]
    assert tail == {"seg": [{"id": 2, "stop": 0}], "udpn": {"nn": True}, "v": True}
    assert final == {"on": True, "bri": 90, "tt": 7, "udpn": {"nn": True}, "v": True}
    assert all(b["v"] is True for b in bodies)
    # .2.118's whole look is one request (687 bytes when designed).
    assert L.body_bytes(first) < 800


def test_turn_on_while_lit_is_one_request():
    look = _look()
    bodies = L.on_bodies(look["state"], _Q118_STATE, L.Ctx(_Q118_INFO), bri=90, tt=7, dark=False)
    assert len(bodies) == 1 and bodies[0]["on"] is True and bodies[0]["bri"] == 90 and bodies[0]["tt"] == 7
    assert len(bodies[0]["seg"]) == 2


def _many_segments(n: int) -> dict:
    segs = [{**_Q118_SEG[1], "id": i, "start": i * 10, "stop": i * 10 + 10, "n": f"part {i}"} for i in range(n)]
    return {**_Q118_STATE, "seg": segs}


def test_esp8266_gets_at_most_8_segments_per_request_esp32_24():
    st = _many_segments(16)                              # the ESP8266 maximum
    look = _look(st)
    e8266 = L.Ctx({"arch": "esp8266", "leds": {"count": 300, "rgbw": True}})
    bodies = L.on_bodies(look["state"], {**st, "on": False}, e8266, bri=50, tt=7, dark=True)
    assert [len(b.get("seg") or []) for b in bodies] == [8, 8, 0]
    assert all(L.body_bytes(b) <= W.MAX_BODY_ESP8266 for b in bodies)
    ids = [s["id"] for b in bodies for s in b.get("seg") or []]
    assert ids == sorted(ids) == list(range(16)), "segment ids go up in order"
    lit = L.on_bodies(look["state"], st, e8266, bri=50, tt=7, dark=False)
    assert [("on" in b, b["tt"]) for b in lit] == [(False, 7), (True, 7)], "every chunk carries tt, the last on/bri"
    e32 = L.Ctx({"arch": "esp32", "leds": {"count": 300, "rgbw": True}})
    st30 = _many_segments(30)
    b32 = L.on_bodies(_look(st30)["state"], {**st30, "on": False}, e32, bri=50, tt=7, dark=True)
    assert [len(b.get("seg") or []) for b in b32] == [24, 6, 0]
    assert all(L.body_bytes(b) <= W.MAX_BODY_ESP32 for b in b32)


def test_the_forbidden_keys_are_never_sent_and_tb_only_for_a_team():
    look = _look()
    ctx = L.Ctx(_Q118_INFO)
    dark_live = {**_Q118_STATE, "on": False}
    everything = (L.on_bodies(look["state"], dark_live, ctx, bri=1, tt=7, dark=True)
                  + L.on_bodies(look["state"], _Q118_STATE, ctx, bri=1, tt=7, dark=False)
                  + L.on_bodies(look["state"], dark_live, ctx, bri=1, tt=7, dark=True, team=True)
                  + [L.off_body(7), L.dim_body(40), L.dim_body(40, sync_ok=False), L.tail_body([3])]
                  + L.resend_bodies(look["state"], ctx, {0, 1}, on=True, bri=5, tt=7))
    assert not [k for b in everything for k in L.forbidden_in(b)]
    assert not any(k in b for b in everything for k in L.FORBIDDEN_KEYS)
    tb = [b for b in everything if "tb" in b]
    assert tb == [{"on": True, "bri": 1, "tt": 7, "udpn": {"nn": True}, "v": True, "tb": 0}]
    # The guard itself catches them (negative control).
    assert L.forbidden_in({"ps": 1, "seg": [{"id": 0, "fxdef": True}]}) == ["ps", "seg.fxdef"]
    assert L.forbidden_in({"transition": 7}) == ["transition"]


def test_a_white_unit_always_gets_4_values_and_bounds_go_when_the_geometry_changed():
    st = copy.deepcopy(_Q118_STATE)
    st["seg"][1]["col"] = [[255, 160, 0], [0, 0, 0], [0, 0, 0]]              # remembered when it had no white
    look = _look(st)
    seg = L.seg_body(look["state"]["seg"][1], L.Ctx(_Q118_INFO))
    assert seg["col"] == [[255, 160, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]
    rgb = L.seg_body(look["state"]["seg"][1], L.Ctx({"leds": {"rgbw": False}}))
    assert rgb["col"][0] == [255, 160, 0]
    moved = L.seg_body(look["state"]["seg"][1], L.Ctx(_Q118_INFO, geometry_ok=False))
    assert not set(moved) & set(L.SEG_BOUNDS) and moved["col"] and moved["fx"] == 0


def test_turn_off_leaves_the_segments_as_the_look_has_them():
    body = L.off_body(7)
    assert body == {"on": False, "tt": 7, "nl": {"on": False}, "udpn": L.UDPN_OFF, "v": True}
    assert L.dim_body(80) == {"bri": 80, "tt": 2, "udpn": {"nn": True}, "v": True}


def test_only_the_sync_blocks_may_be_written_through_json_cfg():
    assert L.check_exact_cfg_patch(L.SYNC_OFF_PATCH) is None
    saved = {"if": {"sync": {"send": {"en": False, "dir": True, "btn": False, "va": False, "hue": True, "grp": 1, "ret": 0},
                             "recv": {"bri": True, "col": True, "fx": True, "pal": True, "grp": 1, "seg": False, "sb": False}}}}
    assert L.check_exact_cfg_patch(saved) is None
    for bad in ({"hw": {"led": {"maxpwr": 0}}}, {"if": {"sync": {"port0": 1}}}, {"if": {"live": {"en": False}}},
                {"if": {"sync": {"send": {"en": False, "pin": 1}}}}, {"if": {"sync": {}}}, {"def": {"ps": 0}},
                {"if": {"sync": {"recv": {"grp": 0}}}, "rb": True}):
        assert L.check_exact_cfg_patch(bad), bad


# ── compare ──────────────────────────────────────────────────────────────────


def test_a_look_compares_clean_against_the_state_it_came_from():
    look = _look()
    assert L.compare(look["state"], _Q118_STATE, L.Ctx(_Q118_INFO), on=True, bri=128) == []


def test_compare_normalizes_the_way_wled_reports():
    look = _look()
    got = copy.deepcopy(_Q118_STATE)
    look["state"]["seg"][1].update(of=35, grp=0, c3=40)             # of mod 30 = 5, grp 0 → 1, c3 ≤31
    got["seg"][1].update(of=5, grp=1, c3=31)
    look["state"]["seg"][0].update(stop=99)                         # stop ≤ the LED count (31)
    got["seg"][0].update(stop=31)
    look["state"]["seg"][0]["bri"] = 0
    got["seg"][0]["bri"] = 255                                     # opacity 0 is reported as 255
    look["state"]["seg"][1]["fx"] = 400                            # out of range → 0
    assert L.compare(look["state"], got, L.Ctx(_Q118_INFO), on=True, bri=128) == []
    # W ignored without a white channel; pal ignored on a non-RGB segment; col on an on/off one.
    look2 = _look()
    rgb = copy.deepcopy(_Q118_STATE)
    rgb["seg"][0]["col"] = [[255, 160, 0], [0, 0, 0], [0, 0, 0]]
    assert L.compare(look2["state"], rgb, L.Ctx({"leds": {"rgbw": False, "count": 31}}), on=True, bri=128) == []
    white_only = copy.deepcopy(_Q118_STATE)
    white_only["seg"][0].update(pal=9, lc=2)
    assert L.compare(look2["state"], white_only, L.Ctx(_Q118_INFO), on=True, bri=128) == []
    onoff = copy.deepcopy(_Q118_STATE)
    onoff["seg"][0].update(col=[[1, 2, 3, 4], [0, 0, 0, 0], [0, 0, 0, 0]], lc=0)
    assert L.compare(look2["state"], onoff, L.Ctx(_Q118_INFO), on=True, bri=128) == []


def test_differences_name_the_part_and_resend_only_those_parts():
    look = _look()
    got = copy.deepcopy(_Q118_STATE)
    got["seg"][1].update(col=[[255, 180, 107, 0], [0, 0, 0, 0], [0, 0, 0, 0]], fx=9)
    got["bri"] = 60
    got["udpn"] = {"send": False, "sgrp": 0, "rgrp": 1}
    diffs = L.compare(look["state"], got, L.Ctx(_Q118_INFO), on=True, bri=128, exact=True)
    assert L.describe(diffs) == ["part 2: colour, effect", "brightness", "sync"]
    assert L.differing_segments(diffs) == {1}
    bodies = L.resend_bodies(look["state"], L.Ctx(_Q118_INFO), {1}, on=True, bri=128, tt=7)
    assert len(bodies) == 1 and [s["id"] for s in bodies[0]["seg"]] == [1]
    assert bodies[0]["on"] is True and bodies[0]["bri"] == 128 and bodies[0]["udpn"] == L.UDPN_OFF
    assert set(bodies[0]["seg"][0]) >= set(look["state"]["seg"][1]), "a differing segment is re-sent whole"
    # Sync is only PadSpan's business in exact mode.
    assert L.describe(L.compare(look["state"], got, L.Ctx(_Q118_INFO), on=True, bri=128)) == \
        ["part 2: colour, effect", "brightness"]


def test_off_compares_only_the_master_and_sync():
    look = _look()
    got = {**copy.deepcopy(_Q118_STATE), "on": False, "udpn": {"send": False, "sgrp": 0, "rgrp": 0}}
    got["seg"][0]["col"] = [[1, 1, 1, 1]] * 3
    assert L.compare(look["state"], got, L.Ctx(_Q118_INFO), on=False, exact=True) == []
    assert L.describe(L.compare(look["state"], {**got, "on": True}, L.Ctx(_Q118_INFO), on=False, exact=True)) == ["power"]


# ── teams ────────────────────────────────────────────────────────────────────


def test_team_brightness_keeps_each_members_tuning():
    assert L.team_bri(120, 50, 100) == 60                  # "Upper North 20% brighter"
    assert L.team_bri(120, 255, 100) == 255                # within 1-255
    assert L.team_bri(1, 10, 255) == 1
    assert L.team_bri(None, 77, 100) == 77
    assert L.team_bri(100, 77, 0) == 77


# ── through the device's own rules (tests/wled_fake.py) ──────────────────────


def _run(fake: FakeWled, bodies: list[dict]) -> dict:
    reply = None
    for b in bodies:
        reply = asyncio.run(fake.handle("POST", "json/state", b))
    return reply


@pytest.mark.parametrize("arch,segs", [("esp32", 2), ("esp8266", 1), ("esp32", 5)])
def test_the_requests_reproduce_the_look_on_a_scrambled_device(arch, segs):
    dev = simple_device(arch=arch, segs=segs)
    si = {"state": dev.serialize_state(), "info": dev.serialize_info()}
    look = L.capture(si, dev.cfg, by="t", at=0)
    look["state"]["seg"][0].update(col=[[10, 20, 30, 200], [0, 0, 0, 0], [0, 0, 0, 0]], cct=40, bri=150)
    # Something else changed everything, added a segment and switched sync on.
    _run(dev, [{"seg": [{"id": s["id"], "col": [[1, 2, 3]], "fx": 9, "bri": 20, "on": False} for s in look["state"]["seg"]]
                + [{"id": segs, "start": 0, "stop": 1}], "udpn": {"sgrp": 1, "rgrp": 1, "send": True}},
               {"on": False}])
    ctx = L.Ctx(dev.serialize_info())
    live = dev.serialize_state()
    bodies = L.on_bodies(look["state"], live, ctx, bri=77, tt=7, dark=True)
    for b in bodies[:-1]:
        _run(dev, [b])
        assert dev.serialize_state()["on"] is False, "the strip stays dark while the look is set"
    got = _run(dev, bodies[-1:])
    assert L.compare(look["state"], got, ctx, on=True, bri=77, exact=True) == []
    assert got["seg"][0]["col"][0] == [10, 20, 30, 200], "W survives: 4 values were sent"


def test_a_3_value_colour_would_have_zeroed_w():
    """Why 4 values: WLED builds rgbw={0,0,0,0} and copies what is sent."""
    dev = simple_device()
    _run(dev, [{"seg": [{"id": 0, "col": [[10, 20, 30, 200]]}]}])
    assert dev.serialize_state()["seg"][0]["col"][0] == [10, 20, 30, 200]
    _run(dev, [{"seg": [{"id": 0, "col": [[10, 20, 30]]}]}])
    assert dev.serialize_state()["seg"][0]["col"][0] == [10, 20, 30, 0]


def test_sync_off_is_a_live_rgrp_0_recv_does_nothing_from_015():
    dev = simple_device(ver="0.15.3")
    _run(dev, [{"udpn": {"recv": False}}])
    assert dev.serialize_state()["udpn"]["rgrp"] == 1, "0.15+ ignores recv"
    _run(dev, [{"udpn": dict(L.UDPN_OFF)}])
    assert L.udpn_ok(dev.serialize_state())
    old = simple_device(ver="0.14.4")
    _run(old, [{"udpn": {"recv": False}}])
    assert old.serialize_state()["udpn"]["recv"] is False


def test_json_dumps_is_what_is_measured():
    body = L.off_body(7)
    assert L.body_bytes(body) == len(json.dumps(body, separators=(",", ":")))
