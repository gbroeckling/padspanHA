# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Room controls on the flat Atlas (views/room_controls.js), RUN (tests/js/room_controls.mjs).

2026-11-25, the owner: "in the pulldown in atlas, add a volume for room option, when on creates an icon in the room
that opens a card that has volume up down and mute"; a Control4 to Home Assistant matchup; room off; Crestron and the
other whole-house systems; Home Assistant's own speakers, off by default; two players in one room ("denon and
control4 at the same time"); no clutter on the maps. The ⋯ line is held in tests/test_atlas_flat_show.py, the panel
itself in tests/test_lights_panel_lifecycle.py (test_room_controls_through_the_panel).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "room_controls.mjs"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run():
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["systems", "prefill", "looks", "icon", "icon-clear", "off", "parts", "sheet", "audio", "features", "quick", "climate", "covers",
                                  "match", "first-time", "cleared", "kept", "non-admin",
                                  # the full card (the owner, 2026-11-26): each part only where the player supports it
                                  "transport", "scan", "slider", "limit", "onoff", "sources", "modes", "sound", "share", "all-off", "tidy",
                                  # the review's fixes: Home Assistant core's Control4 room, no level, a held slider, the limit's gaps,
                                  # only what sounds, the group's leader, odd source names, the picture, the selects, the Sources card, one read
                                  "c4-core", "no-level", "held", "limit-gaps", "all-off-quiet", "share-leader", "odd-sources", "picture", "selects",
                                  "sources-card", "memo", "drag-then-step", "doc-pointer",
                                  # the whole-beta inspection: Room off quiets what it can't turn off, one shade rule, idle, a
                                  # thermostat's range, what the card's parts show, the sheet's repeats and a wall's size
                                  "room-off-quiet", "shade-rule", "idle", "range", "shown-in", "sheet-tidy",
                                  "german"])
def test_room_controls(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_counts_are_a_closed_list_and_carry_no_name():
    want = {f"room_controls:{w}" for w in ("on", "match_open", "match_saved", "up", "down", "mute", "off", "climate", "cover", "room_off",
                                          "source", "sound_mode", "play", "pause", "next", "previous", "scan", "slider", "sound",
                                          "share", "unshare", "all_off", "sources_saved", "limit_saved")}
    assert want == T.ROOM_CONTROLS_EVENTS and all(T.event_allowed(e) for e in want)
    for bad in ("room_controls:media_player.c4_kitchen", "room_controls:Kitchen", "room_controls:control4", "room_controls:35"):
        assert not T.event_allowed(bad), bad
    assert "room_controls" in T.HOUSE3D_SHOW_ITEMS and "room_controls" in T.UI_ERROR_HELPERS
    panel = _src("lights_panel.js")
    assert 'event:"room_controls:" + word' in panel
    rc = _src("views/room_controls.js")
    # Each word is counted by the module: count("w"), or the word a call or a save carries (an argument "w").
    used = set(re.findall(r'count\("([a-z_]+)"\)', rc)) | set(re.findall(r'"([a-z_]+)"\s*[,)]', rc))
    assert {w.split(":")[1] for w in want} <= used | {"up", "down"}, {w.split(":")[1] for w in want} - used
    # The Audio add-on's own use in the report (addon_report.used_words) counts every one of the card's presses.
    from custom_components.padspan_ha import addon_report as A
    assert set(A.AUDIO_USED) == {w.split(":")[1] for w in want} - {"on", "match_open", "climate", "cover", "room_off"}


def test_the_settings_are_an_administrators_and_kept_clean():
    """Both the command's schema and its handler know the two keys; the matches keep players only, each in one room."""
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"room_audio_matches", "room_audio_ha_speakers", "room_audio_matched", "room_audio_sources", "room_audio_limits"} <= keys
    assert DEFAULT_SETTINGS["room_audio_matches"] == {} and DEFAULT_SETTINGS["room_audio_ha_speakers"] is False
    assert DEFAULT_SETTINGS["room_audio_matched"] is False
    assert DEFAULT_SETTINGS["room_audio_sources"] == {} and DEFAULT_SETTINGS["room_audio_limits"] == {}
    # The owner's tidy-up, cleaned as the card cleans it (room_controls.js cleanSources / cleanLimits).
    got_s = WS.clean_room_audio_sources({"media_player.denon": {"names": {"TV": " Television ", "CD": "CD", "x": 3}, "hidden": ["Phono", "Phono", 1],
                                                                "order": ["TV", "Bluetooth"]},
                                         "media_player.empty": {"names": {}, "hidden": []}, "light.x": {"hidden": ["TV"]}, "media_player.y": "junk"})
    assert got_s == {"media_player.denon": {"names": {"TV": "Television"}, "hidden": ["Phono"], "order": ["TV", "Bluetooth"]}}
    got_l = WS.clean_room_audio_limits({"media_player.a": 0.456, "media_player.b": 1, "media_player.c": 0.05, "media_player.d": True,
                                        "media_player.e": "0.5", "light.f": 0.5})
    assert got_l == {"media_player.a": 0.46, "media_player.b": 1.0}
    got = WS.clean_room_audio_matches({"great_room": ["media_player.c4", "light.x", "media_player.denon_zone_2", "media_player.c4"],
                                       "den": ["media_player.c4", "media_player.den"], "": ["media_player.z"], "hall": "junk", "x": [1]})
    assert got == {"great_room": ["media_player.c4", "media_player.denon_zone_2"], "den": ["media_player.den"]}
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    block = src[src.index('if "room_audio_matches" in msg or "room_audio_ha_speakers" in msg or "room_audio_matched" in msg'):][:1200]
    assert 'or "room_audio_sources" in msg or "room_audio_limits" in msg:' in block
    assert '"Only an administrator can match players to rooms"' in block
    assert block.index('"Only an administrator') < block.index("clean_room_audio_sources(") < block.index("clean_room_audio_limits(")


def test_the_systems_are_one_list_in_one_module():
    rc = _src("views/room_controls.js")
    assert rc.count("export const ROOM_AUDIO_SYSTEMS") == 1
    for name in ('control4: "Control4"', "denonavr", "triad-audio-matrix"):
        assert all(name not in _src(f) for f in ("lights_panel.js", "views/lights_map.js", "views/iso_lights.js")), name


def test_the_module_asks_home_assistant_only_through_its_host_and_never_says_bright():
    rc = _src("views/room_controls.js")
    code = "\n".join(ln for ln in rc.splitlines() if not ln.lstrip().startswith("//"))
    assert "callWS" not in code and "localStorage" not in code and "fetch(" not in code
    imports = re.findall(r"import\(`\./([a-z0-9_]+)\.js", code)
    assert imports == ["i18n", "dialog_keys"], imports
    for f in ("views/room_controls.js", "../../../../tests/js/room_controls.mjs"):
        assert "Bright" not in (_WWW / f).read_text(encoding="utf-8"), f


def test_the_classic_layout_has_one_switch_for_audio_in_3d_too():
    """Off the display layout Settings → Atlas → Audio is the one switch: the 3D view gets no ⋯ Audio line of its own
    (audio null) and the host's roomAudio answers looks only while Audio is on as the flat map has it; the view draws
    what the host answers (asking only while ticked where the host offers the line)."""
    lm = _src("views/lights_map.js")
    assert "audio: DISPLAY ? audioSetup() : null," in lm
    assert "roomAudio: host.roomControls ? () => (roomControlsOn() ? host.roomControls.looks() : null) : null," in lm
    la = _src("views/live_aboard.js")
    body = la[la.index("function syncAudio(p){"):][:700]
    assert "(!p.audio || (showOn && showOn.room_controls === true))" in body


def test_the_card_gives_way_and_says_what_it_does():
    """The ⋯ list open: the alarm's shield gives way (it sat on the list's rows on a phone). Match rooms only in the ⋯
    list's Set up ›, never on a wall. The 3D panel's "More devices of the area" leaves out what the card's parts show.
    The ⋯ line and Settings say what the Audio card does now."""
    css = _src("styles.css")
    assert ".lv-mapcard:has([data-show-list]) .lv-emerg{display:none}" in css   # a neutral word: the shared sheet knows no 3D
    lm = _src("views/lights_map.js")
    assert "const audioSetup = () => (host.roomControls && !host.wall ? {" in lm
    la = _src("views/live_aboard.js")
    body = la[la.index("function paintRoomMore(api){"):][:900]
    assert "api.roomControls.shownIn(room, api.roomParts)" in body and "...parts]" in body
    show = _src("views/live_aboard_show.js")
    assert "Volume, mute and off" not in show and "sharing with other rooms, and Room off" in show
    assert "its mode and its setpoint" not in show
    assert "volume, mute and off, and Match rooms" not in _src("views/settings.js")
    assert "export function isShade(hass, eid, openers = null)" in _src("views/room_controls.js")


def test_the_matching_card_goes_with_the_panel():
    panel = _src("lights_panel.js")
    body = panel[panel.index("disconnectedCallback(){"):][:1500]
    assert "if(this._rc) this._rc.close();" in body
