# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""High contrast is in every edition (0.38.165). Graphite, Ocean, Dusk and Day
stay PadSpan Pro's; every theme someone already has shows as it did, except a
saved High contrast, which now shows without Pro too.

The panel's own lines (panel.js _applyTheme, settings.js Theme card) are run in
node for each tier, so the test follows the code rather than a copy of it."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _run(code: str, cases: list) -> list:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, "-e", code, json.dumps(cases)], capture_output=True, text=True,
                         encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _panel_look(cases: list) -> list:
    """[look, pro] -> [day, pal, invert] from _applyTheme's own lines."""
    src = (_WWW / "panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    body = src[src.index("  async _applyTheme(){"):]
    lines = body[body.index("    const day = "):body.index("    this.style.filter")]
    code = ("const f = new Function('look', 'pro', " + json.dumps(lines + "return [day, pal, invert];") + ");"
            "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(([l, p]) => f(l, p))));")
    return _run(code, cases)


def _settings_card(cases: list) -> list:
    """[settings, tier] -> [now, locked themes, shown themes] from the Theme card's own lines."""
    src = (_WWW / "views" / "settings.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    card = src[src.index("    const PAL = "):]
    head = card[:card.index("    const NAMES = ")]
    locked = re.search(r"const locked = (.*?);\n", card).group(1)
    hidden = re.search(r"if \((locked && hideLocked)\) return null;", card).group(1)
    fn = (head + "const ALL = ['night','graphite','ocean','dusk','contrast','light','day'];"
          f"return [now, ALL.filter(val => {locked}), ALL.filter(val => {{ const locked = {locked}; return !({hidden}); }})];")
    code = ("const f = new Function('settings', 'tierAtLeast', 'currentTier', " + json.dumps(fn) + ");"
            "const order = ['free', 'pro'];"
            "const at = (t, want) => order.indexOf(t) >= order.indexOf(want);"
            "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(([s, t]) => f(s, at, () => t))));")
    return _run(code, cases)


@pytest.mark.parametrize("pro", [False, True])
def test_high_contrast_shows_on_every_tier(pro):
    assert _panel_look([[{"theme_palette": "contrast"}, pro]]) == [[False, "contrast", False]]


def test_the_other_looks_still_need_pro():
    got = _panel_look([[{"theme_palette": n}, False] for n in ("graphite", "ocean", "dusk")]
                      + [[{"day_theme": True}, False]])
    assert got == [[False, "", False]] * 4, "Night without Pro, as before"
    got = _panel_look([[{"theme_palette": n}, True] for n in ("graphite", "ocean", "dusk")] + [[{"day_theme": True}, True]])
    assert got == [[False, "graphite", False], [False, "ocean", False], [False, "dusk", False], [True, "", False]]


def test_themes_already_chosen_are_unchanged():
    # Night, Light, Day and Light-over-a-palette show exactly as in 0.38.164.
    cases = [[{}, False], [{}, True], [{"theme_palette": ""}, False],
             [{"light_theme": True}, False], [{"light_theme": True}, True],
             [{"light_theme": True, "theme_palette": "contrast"}, False],
             [{"day_theme": True, "theme_palette": "contrast"}, True],
             [{"theme_palette": "bogus"}, True]]
    assert _panel_look(cases) == [[False, "", False], [False, "", False], [False, "", False],
                                  [False, "", True], [False, "", True], [False, "", True],
                                  [True, "", False], [False, "", False]]


def test_the_settings_card_offers_high_contrast_on_free_bright_and_pro():
    free, bright, pro, free_saved, free_lapsed = _settings_card([
        [{}, "free"], [{"edition": "bright"}, "free"], [{}, "pro"],
        [{"theme_palette": "contrast"}, "free"], [{"theme_palette": "ocean"}, "free"]])
    assert free[1] == ["graphite", "ocean", "dusk", "day"] and "contrast" in free[2]
    assert bright[2] == ["night", "contrast", "light"], "Bright shows Night, High contrast and Light"
    assert pro[1] == [] and len(pro[2]) == 7
    assert free_saved[0] == "contrast" and free_lapsed[0] == "night"


def test_the_card_text_says_high_contrast_is_everyones():
    st = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    assert "Graphite, Ocean, Dusk and Day come with PadSpan Pro (" in st
    assert "Night, Light and High contrast are in every edition." in st
    site = (Path(__file__).resolve().parents[1] / "site" / "index.html").read_text(encoding="utf-8")
    assert "Night, Light (inverted) and High contrast for everyone; Day, Graphite, Ocean and Dusk with Pro" in site
    assert "<li>Day and three more themes</li>" in site
