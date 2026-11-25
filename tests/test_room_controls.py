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


@pytest.mark.parametrize("case", ["systems", "prefill", "looks", "icon", "off", "sheet", "audio", "features", "climate", "covers",
                                  "match", "first-time", "non-admin", "german"])
def test_room_controls(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_counts_are_a_closed_list_and_carry_no_name():
    want = {f"room_controls:{w}" for w in ("on", "match_open", "match_saved", "up", "down", "mute", "off", "climate", "cover", "room_off")}
    assert want == T.ROOM_CONTROLS_EVENTS and all(T.event_allowed(e) for e in want)
    for bad in ("room_controls:media_player.c4_kitchen", "room_controls:Kitchen", "room_controls:control4", "room_controls:35"):
        assert not T.event_allowed(bad), bad
    assert "room_controls" in T.HOUSE3D_SHOW_ITEMS and "room_controls" in T.UI_ERROR_HELPERS
    panel = _src("lights_panel.js")
    assert 'event:"room_controls:" + word' in panel
    used = set(re.findall(r'(?:count|call\([^)]*?)\("([a-z_]+)"\)', _src("views/room_controls.js")))
    used |= set(re.findall(r'"(up|down|mute|off|climate|cover)", ', _src("views/room_controls.js")))
    assert {w.split(":")[1] for w in want} <= used | {"up", "down"}, used


def test_the_settings_are_an_administrators_and_kept_clean():
    """Both the command's schema and its handler know the two keys; the matches keep players only, each in one room."""
    keys = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"room_audio_matches", "room_audio_ha_speakers"} <= keys
    assert DEFAULT_SETTINGS["room_audio_matches"] == {} and DEFAULT_SETTINGS["room_audio_ha_speakers"] is False
    got = WS.clean_room_audio_matches({"great_room": ["media_player.c4", "light.x", "media_player.denon_zone_2", "media_player.c4"],
                                       "den": ["media_player.c4", "media_player.den"], "": ["media_player.z"], "hall": "junk", "x": [1]})
    assert got == {"great_room": ["media_player.c4", "media_player.denon_zone_2"], "den": ["media_player.den"]}
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    block = src[src.index('if "room_audio_matches" in msg or "room_audio_ha_speakers" in msg:'):][:600]
    assert '"Only an administrator can match players to rooms"' in block


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
