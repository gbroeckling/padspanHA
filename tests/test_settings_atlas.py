# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Settings → Atlas, and the plainer names on Settings → Tracking (2026-10-30).

The Atlas and Live Aboard settings had lived in Settings → UI Structure; they
have their own tab now, card for card, and UI Structure keeps the menu and
edition settings with a pointer to Atlas. The tab ids stay as they were
("presence" shows the tab now called Tracking, "ui" still shows UI
Structure), so every link that sets one keeps working.

Show people / Show tags & scanners are switched in one place: Live Aboard's
Views ▾ while Live Aboard is on (Settings → Atlas shows the state and opens
Live Aboard), Settings → Atlas while it is off (no Live Aboard menu exists
then, and both still draw on the flat map). Live Aboard's look is chosen in
Settings → Atlas only; the setup wizard shows it and links there.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
VIEWS = WWW / "views"
SETTINGS_JS = (VIEWS / "settings.js").read_text(encoding="utf-8")
WIZARD_JS = (VIEWS / "aboard_wizard.js").read_text(encoding="utf-8")

ATLAS_CARDS = ("💡 Atlas — Mapped Light Control", "📺 Wall screens", "🗺️ Overview — the Atlas as your main map")


@pytest.fixture(scope="module")
def drawn():
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    r = subprocess.run([node, str(ROOT / "tests" / "js" / "settings_atlas.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def _fn(name: str) -> str:
    start = SETTINGS_JS.index(f"function {name}(ctx, el")
    nl = "\r\n" if "\r\n" in SETTINGS_JS else "\n"
    return SETTINGS_JS[start:SETTINGS_JS.index(nl + "}" + nl, start)]


# ── the tab ──────────────────────────────────────────────────────────────────

def test_the_tab_bar_has_tracking_and_atlas(drawn):
    assert drawn["ui"]["tabs"] == ["Appearance", "Scanner Map", "Tracking", "Features", "AI", "Atlas", "UI Structure"]


def test_the_atlas_tab_holds_exactly_the_moved_cards(drawn):
    for case in ("atlasOn", "atlasOff", "atlasFree"):
        cards = drawn[case]["cards"]
        assert len(cards) == len(ATLAS_CARDS), (case, cards)
        for got, want in zip(cards, ATLAS_CARDS):
            assert got.startswith(want), (case, got)


def test_ui_structure_no_longer_has_them_and_points_to_atlas(drawn):
    cards = drawn["ui"]["cards"]
    assert len(cards) == 3, cards
    assert cards[0].startswith("Devices"), "the menu's extra tabs stay"
    assert cards[1].startswith("The Atlas, Live Aboard, wall screens and the Atlas as Overvi")
    assert cards[2].startswith("Edition & tier")
    assert not any(c.startswith(w) for c in cards for w in ATLAS_CARDS)
    ui = _fn("_settingsUI")
    for gone in ("lights_panel_enabled", "atlas_emergency_button", "atlas_live_colours", "atlas_alert_pulse",
                 "atlas_heatmap_enabled", "_atlasWeatherSection(", "_atlas3dSection(", "WALLCARD", "overview_atlas"):
        assert gone not in ui, gone
    atlas = _fn("_settingsAtlas")
    for here in ("lights_panel_enabled", "atlas_emergency_button", "atlas_live_colours", "atlas_alert_pulse",
                 "atlas_heatmap_enabled", "_atlasWeatherSection(ctx, el, settings)", "_atlas3dSection(ctx, el, settings)",
                 "WALLCARD.wallCard(ctx, el, settings)", "overview_atlas: ovCb.checked"):
        assert here in atlas, here


def test_old_tab_ids_still_open_their_tabs(drawn):
    # "ui" still opens UI Structure, whose pointer opens Atlas.
    assert drawn["ui"]["wentTo"] == "atlas"
    # "presence" opens the tab now called Tracking.
    assert len(drawn["presence"]["cards"]) > 20
    assert 'activeTab === "presence"' in SETTINGS_JS and 'activeTab === "atlas"' in SETTINGS_JS
    assert '["presence", "Tracking",' in SETTINGS_JS and '["atlas", "Atlas",' in SETTINGS_JS


def test_links_to_atlas_settings_point_at_the_new_tab():
    assert 'ctx.state._settingsTab = "atlas"' in WIZARD_JS and '_settingsTab = "ui"' not in WIZARD_JS
    for rel in ("views/aboard_wizard.js", "views/live_aboard_library.js", "views/live_aboard_people.js",
                "views/live_aboard_photo.js", "views/maps.js", "views/overview.js"):
        src = (WWW / rel).read_text(encoding="utf-8")
        code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))
        assert "Settings → UI Structure → Atlas" not in code and "Settings → UI Structure." not in code, rel
        assert "UI Structure (Advanced mode), the Atlas card" not in code, rel
    for py in ("ws_house3d.py", "ws_house3d_library.py", "ws_house3d_photo.py"):
        src = (ROOT / "custom_components" / "padspan_ha" / py).read_text(encoding="utf-8")
        assert "UI Structure" not in src, py


# ── one place per setting ────────────────────────────────────────────────────

def test_show_people_and_tags_have_one_switch_at_a_time(drawn):
    on, off = drawn["atlasOn"], drawn["atlasOff"]
    # Live Aboard on: its Views ▾ is the switch; Settings shows the state.
    assert "atlas_3d_people" not in on["inputs"] and "atlas_3d_tags" not in on["inputs"]
    assert on["states"] == ["atlas_3d_people", "atlas_3d_tags"]
    # Live Aboard off: no menu to switch them in, so Settings does.
    assert "atlas_3d_people" in off["inputs"] and "atlas_3d_tags" in off["inputs"]
    assert off["states"] == []
    panel = (VIEWS / "live_aboard_panel.js").read_text(encoding="utf-8")
    assert '[["atlas_3d_people", "Show people"], ["atlas_3d_tags", "Show tags & scanners"]]' in panel
    assert "h.saveSetting(key, !on)" in panel
    # The setup wizard shows them and says where; it no longer saves them.
    assert "atlas_3d_people:" not in WIZARD_JS and "atlas_3d_tags:" not in WIZARD_JS
    assert "Switch it in Live Aboard: Views ▾ → ${label}." in WIZARD_JS


def test_live_aboard_look_is_chosen_only_in_settings_atlas():
    assert 'save("atlas_3d_look", want' in _fn("_atlas3dSection")
    assert "atlas_3d_look:" not in WIZARD_JS, "the wizard no longer saves the look"
    assert '"data-wiz-look"' in WIZARD_JS and 'btn("Open Settings → Atlas", () => go({ settings: true }))' in WIZARD_JS


# ── plainer names (visible text only; keys unchanged) ────────────────────────

RENAMED = {
    "Room and receiver layout source": ['"Fabric source"'],
    "Matched to calibration points (default)": ['"k-NN (default)"'],
    "Learned model (experimental)": ['"Random Forest (experimental)"'],
    "Signal smoothing": ['"Signal Filter"'],
    "Bluetooth refresh interval": ['"BLE Reseed Interval"'],
    "Refresh every 5 s for passive proxy scanners": ['"Enable aggressive BLE reseed (5s) for passive proxy scanners"'],
    "Receiver signal adjustments": ['"Scanner RSSI Offsets"'],
    'label: "Signal distortion map"': ['label: "Distortion Map"'],
    '"Tracking Settings"': ['"Presence Settings"'],
}


@pytest.mark.parametrize("new", list(RENAMED))
def test_renamed_and_the_old_words_gone(new):
    assert new in SETTINGS_JS
    for old in RENAMED[new]:
        assert old not in SETTINGS_JS, old


def test_the_technical_names_stay_in_the_hover_help():
    assert 'title: "k-NN (k-nearest neighbours)"' in SETTINGS_JS
    assert 'title: "Random Forest"' in SETTINGS_JS


def test_the_keys_behind_the_renamed_cards_are_unchanged():
    for key in ("positioning_algorithm: algoSel.value", "kalman_q: q, kalman_r: r", "ble_reseed_interval_s: v",
                "aggressive_ble_reseed: aggressiveChk.checked", 'key: "distortion_map_enabled"',
                '"padspan_ha/fabric_sync_mode_set"'):
        assert key in SETTINGS_JS, key
    assert '{ value: "knn"' in SETTINGS_JS and '{ value: "rf"' in SETTINGS_JS


def test_settings_links_name_the_tracking_tab():
    assert "Settings \\u2192 Presence" not in SETTINGS_JS
    for rel in ("guests.js", "training.js", "manage.js"):
        src = (VIEWS / rel).read_text(encoding="utf-8")
        assert "Settings → Presence" not in src, rel
    # The menu's Presence page keeps its name.
    assert 'presence:"Presence"' in SETTINGS_JS
    assert not re.search(r'"tab"[^\n]*"Presence"', SETTINGS_JS)
