# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Three themes (0.38.151): Night, Light (the accessibility inversion, kept
exactly as it was for people who need it) and Day (a designed light palette,
day_theme.js). Day wins if both settings are on; Light stays an inversion."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _js(expr: str):
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "day_theme.js").resolve().as_uri()
    code = f"import(process.argv[1]).then(m => console.log(JSON.stringify({expr})));"
    res = subprocess.run([_NODE, "-e", code, url], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _lum(hexc: str) -> float:
    h = hexc.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (max(r, g, b) + min(r, g, b)) / 2


def test_night_surfaces_turn_pale_and_light_text_turns_dark():
    got = _js('["#071008","#0f1a12","#1b3526"].map(c => m.dayColor(c, "surface"))'
              '.concat(["#e2e8f0","#94a3b8"].map(c => m.dayColor(c, "text")))')
    surfaces, texts = got[:3], got[3:]
    assert all(_lum(c) > 0.8 for c in surfaces), surfaces
    assert all(_lum(c) < 0.4 for c in texts), texts


def test_a_coloured_word_keeps_its_hue_and_reads_on_white():
    accent, amber, red = _js('["#52b788","#f59e0b","#f87171"].map(c => m.dayColor(c, "text"))')
    for c in (accent, amber, red):
        assert _lum(c) <= 0.4, c
    r, g, b = (int(accent[i:i + 2], 16) for i in (1, 3, 5))
    assert g > r and g > b, "the accent must stay green"


def test_accent_fills_and_shadows_stay_and_odd_colours_pass_through():
    got = _js('[m.dayColor("#52b788","surface"), m.dayColor("rgba(0,0,0,.4)","shadow"), '
              'm.dayColor("var(--x)","surface"), m.dayColor("hsl(1,2%,3%)","text")]')
    assert got == ["#52b788", "rgba(0,0,0,.4)", "var(--x)", "hsl(1,2%,3%)"]


def test_only_colour_properties_change_and_drawings_are_left_alone():
    out = _js('m.dayDecls("font-size:12px;background:#071008;color:#e2e8f0;fill:#52b788;stroke:#e2e8f0")')
    assert "font-size:12px" in out and "fill:#52b788" in out and "stroke:#e2e8f0" in out
    assert "#071008" not in out and "color:#e2e8f0" not in out


def test_atlas_live_aboard_and_pure_live_rules_keep_their_colours():
    css = ".card{background:#0f1a12}.lv-wx{background:#0f1a12}.la-menu{color:#e2e8f0}.pl-hud{background:#071008}"
    out = _js(f"m.dayCss({json.dumps(css)})")
    assert ".lv-wx{background:#0f1a12}" in out and ".la-menu{color:#e2e8f0}" in out and ".pl-hud{background:#071008}" in out
    assert ".card{background:#0f1a12}" not in out


def test_atlas_controls_on_a_plain_card_follow_the_day():
    # .lv-hint / .lv-act are used in Mapping and Floor Heights too: pale night
    # text on a day card all but vanished. Night stays in a kept drawing's box
    # (the map card) and the 3D house; a day copy covers everywhere else.
    css = ".lv-hint{color:rgba(226,240,232,.45)}@media (max-width:600px){.lv-act,.lv-tgl::before{color:#e2e8f0}}.la3d .lv-zoomseg{color:#e2e8f0}"
    out = _js(f"m.dayCss({json.dumps(css)})")
    off = ":not(.lv-atlascard):not(.lv-atlascard *):not([data-keep-night]):not([data-keep-night] *):not(.la3d *)"
    assert out.startswith(".lv-hint{color:rgba(226,240,232,.45)}"), out
    assert f".lv-hint{off}{{" in out and f".lv-act{off},.lv-tgl{off}::before{{" in out, out
    assert "rgba(226,240,232,.45)}.lv-hint" in out, "the night rule comes first, the day copy after it"
    day = out.split(f".lv-hint{off}{{", 1)[1].split("}", 1)[0]
    assert "226,240,232" not in day, day
    assert out.count(".la3d .lv-zoomseg") == 1, "a rule of the 3D house gets no day copy"
    assert out.count("@media") == 1 and out.endswith("}"), out
    # colours only: a copy carrying font-size would outrank .lv-tgl-big's own
    out2 = _js('m.dayCss(".lv-tgl{font-size:11px;color:#e2e8f0}.lv-tgl-big{font-size:14px}")')
    assert f".lv-tgl{off}{{color:" in out2 and out2.count("font-size:11px") == 1, out2
    # a shorthand gives only its colour: `.lv-row:last-child{border-bottom:none}`
    # must still win over the copy of `.lv-row{border-bottom:1px solid ...}`
    out3 = _js('m.dayCss(".lv-row{border-bottom:1px solid #1b3526;background:#0f1a12}.lv-row:last-child{border-bottom:none}'
               '.lv-r::-webkit-slider-thumb{background:#0f1a12}")')
    assert f".lv-row{off}{{border-bottom-color:" in out3 and ";background-color:" in out3, out3
    assert out3.count("1px solid") == 1, out3
    assert f".lv-r{off}::-webkit-slider-thumb{{background-color:" in out3, "the :not goes before a vendor pseudo-element"


def test_a_comment_with_braces_never_splits_a_rule():
    # styles.css explains a selector in a comment that quotes `{width:100%}`:
    # split on its braces, the day copy landed inside the comment and every
    # rule after it was lost.
    css = "/* a bare .lv-x{width:150px} lost */.lv-x{color:#e2e8f0}.card{color:#e2e8f0}"
    out = _js(f"m.dayCss({json.dumps(css)})")
    assert "/*" not in out and out.startswith(".lv-x{color:#e2e8f0}"), out
    assert ".card{color:#e2e8f0}" not in out and ".card{" in out, out


def test_what_stays_night_keeps_the_hosts_night_variables():
    # the 2025 skin's inputs read --ps-s2: in the Day theme they turned white
    # on the dark Atlas map card.
    out = _js('m.dayCss(":host{--ps-s2:#121816;display:block}")')
    assert ".lv-atlascard,.la3d,[data-keep-night]{--ps-s2:#121816}" in out, out
    assert out.startswith(":host{") and "#121816;display" not in out, out


def test_skin_variables_with_digits_are_themed():
    # styles-2025.css names its colours --ps-s2, --ps-tx2 ...: missed once, they
    # left the 2025 cards dark and their text light-on-light.
    out = _js('m.dayCss(":host{--ps-s2:#121816;--ps-tx2:#93A29C}")')
    host = out.split("}", 1)[0]
    assert "#121816" not in host and "#93A29C" not in host, out


def test_three_theme_choices_and_light_is_still_the_inversion():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    body = panel[panel.index("  async _applyTheme(){"):]
    body = body[:body.index("\n  }\n")]
    assert 'const invert = !on && !!this.state.settings?.light_theme;' in body
    assert 'this.style.filter = invert ? "invert(1) hue-rotate(180deg)" : "";' in body
    assert "settings?.day_theme" in body and "attachDayTheme" in body
    assert 'this.state.view === "purelive"' in body, "Pure Live must never be repainted"
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    assert ":host([data-invert]) img," in css, "the inversion's photo counter-invert must stay"
    settings = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    assert 'mkTheme("night","Night"), mkTheme("light","Light (inverted)"), mkTheme("day","Day")' in settings
    assert 'settingsSet({ light_theme: val === "light", day_theme: val === "day" })' in settings


def test_every_settings_read_applies_skin_and_theme():
    # _fetchSettings (the full-refresh path) used to skip both, so a panel whose
    # settings came that way never showed its chosen skin or theme.
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    body = panel[panel.index("  async _fetchSettings(){"):]
    body = body[:body.index("\n  }\n")]
    assert "this._applySkin();" in body and "this._applyTheme();" in body
