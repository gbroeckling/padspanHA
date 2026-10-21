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


def test_a_painted_style_its_view_changes_is_never_painted_twice():
    # Review before 0.38.157: a view setting el.style.display on a painted
    # element made the watcher take the day colours for night ones and flip
    # them back (white text on a pale card), and lose the night copy.
    got = _js('(() => { const night = "color:#e2e8f0;background:#0f1a12"; const day = m.dayDecls(night);'
              ' return [day, m.unpaint(day + ";display:none", day, night),'
              ' m.unpaint("color: rgb(15, 21, 29); display: none;", day, night),'
              ' m.unpaint("color:#ff0000;background:#0f1a12", day, night)]; })()')
    day, back, reserialised, newcolour = got
    assert back == "color:#e2e8f0;background:#0f1a12;display:none", back
    assert reserialised.startswith("color:#e2e8f0;"), "the browser's rgb() spelling of what we wrote still matches"
    assert newcolour == "color:#ff0000;background:#0f1a12", "a colour the view set itself is night already"
    src = (_WWW / "day_theme.js").read_text(encoding="utf-8")
    assert "written.has(el) ? unpaint(cur, written.get(el)" in src
    assert "if (added) keepDrawings();" in src, "no layout pass per style change"
    assert "styleOrig.delete(n)" in src, "a removed stylesheet is forgotten"


def test_bright_is_not_shown_looks_it_cannot_unlock():
    settings = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    assert 'const hideLocked = String(settings.edition || "").toLowerCase() === "bright" && !proOk;' in settings
    assert "if (locked && hideLocked) return null;" in settings


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


_NIGHT = ["#071008", "#0f1a12", "#1b3526", "#2d4a38"]          # Night's surfaces and edges
_MEANING = ["#52b788", "#2d6a4f", "#f59e0b", "#f87171", "#3b82f6", "#a7f3d0"]   # accent, warning, alarm, tracking


def test_graphite_ocean_and_dusk_are_night_retinted():
    got = _js('m.PALETTES.filter(n => n !== "contrast").map(n => { const f = m.paletteColor(n); return ['
              f'{json.dumps(_NIGHT)}.map(c => f(c, "surface")), ["#e2e8f0", "#94a3b8"].map(c => f(c, "text")),'
              f'{json.dumps(_MEANING)}.map(c => f(c, "surface")).concat({json.dumps(_MEANING)}.map(c => f(c, "text")))]; }})')
    for surfaces, texts, meaning in got:
        assert surfaces != _NIGHT, "a new tint"
        for night, new in zip(_NIGHT + ["#e2e8f0", "#94a3b8"], surfaces + texts):
            assert abs(_lum(night) - _lum(new)) < 0.03, (night, new)   # same lightness: the same contrast as Night
        assert meaning == _MEANING + _MEANING, "a colour that means something never changes"


def test_high_contrast_is_black_white_and_solid_edges():
    got = _js('(f => [' + json.dumps(_NIGHT) + '.map(c => f(c, "surface", "background")), '
              '["#e2e8f0", "#94a3b8"].map(c => f(c, "text")), f("rgba(120,190,155,.18)", "surface", "border"), '
              f'{json.dumps(_MEANING)}.map(c => f(c, "surface", "background"))])(m.paletteColor("contrast"))')
    surfaces, texts, edge, meaning = got
    assert all(_lum(c) < 0.12 for c in surfaces), surfaces
    assert texts[0] == "#ffffff" and _lum(texts[1]) > 0.8, texts
    assert edge.startswith("rgba(") and float(edge.rstrip(")").split(",")[-1]) >= 0.75, "a faint edge becomes a solid one"
    assert meaning == _MEANING


def test_the_accent_stays_the_accent_at_any_strength():
    # review: the active tab's green haze and the focus ring turned grey or blue
    got = _js('["graphite","ocean","dusk"].map(n => m.paletteColor(n)("rgba(82,183,136,.14)", "surface", "background"))'
              '.concat([m.paletteColor("contrast")("rgba(82,183,136,.55)", "surface", "border"),'
              ' m.paletteColor("contrast")("#475569", "text")])')
    assert got[:3] == ["rgba(82,183,136,.14)"] * 3, got
    assert got[3] == "rgba(82,183,136,1)", "a coloured edge stays, solid, so focus still shows"
    assert _lum(got[4]) > 0.7, "the dimmest grey text is readable on black"


def test_a_palette_name_from_anywhere_is_checked():
    from custom_components.padspan_ha import ws_settings
    src = Path(ws_settings.__file__).read_text(encoding="utf-8")
    assert 'payload["theme_palette"] = _pal if _pal in ("graphite", "ocean", "dusk", "contrast") else ""' in src
    assert _js("m.PALETTES") == ["graphite", "ocean", "dusk", "contrast"]


def test_seven_theme_choices_and_light_is_still_the_inversion():
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
    for val, label in (("night", "Night"), ("graphite", "Graphite"), ("ocean", "Ocean"), ("dusk", "Dusk"),
                       ("contrast", "High contrast"), ("light", "Light (inverted)"), ("day", "Day")):
        assert f'mkTheme("{val}","{label}")' in settings, val
    assert 'settingsSet({ light_theme: val === "light", day_theme: val === "day", theme_palette: palette })' in settings


def test_day_and_the_palettes_are_pro_light_is_everyones():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    body = panel[panel.index("  async _applyTheme(){"):]
    body = body[:body.index("\n  }\n")]
    assert 'const pro = String(this.state.settings?.tier || "").toLowerCase() === "pro";' in body
    assert "const day = pro && !!this.state.settings?.day_theme;" in body
    assert '&& pro && ["graphite", "ocean", "dusk", "contrast"].includes(named)' in body
    assert "const invert = !on && !!this.state.settings?.light_theme;" in body, "Light never needs Pro"
    settings = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    assert 'const PRO_LOOKS = PAL.concat(["day"]);' in settings
    assert "const locked = PRO_LOOKS.includes(val) && !proOk;" in settings


def test_every_settings_read_applies_skin_and_theme():
    # _fetchSettings (the full-refresh path) used to skip both, so a panel whose
    # settings came that way never showed its chosen skin or theme.
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    body = panel[panel.index("  async _fetchSettings(){"):]
    body = body[:body.index("\n  }\n")]
    assert "this._applySkin();" in body and "this._applyTheme();" in body


def test_a_re_entry_puts_the_skin_back_straight_after_the_rebuild():
    # connectedCallback forgets the skin (_skin = null) and rebuilds the page;
    # with the settings already read it puts the skin back at once, not at the
    # next settings read (a flash of the classic skin).
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    body = panel[panel.index("  connectedCallback(){"):]
    body = body[:body.index("\n  }\n")]
    rebuilt = body.index("this.shadowRoot.innerHTML = `")
    assert body.index("this._skin = null;") < rebuilt
    assert "if (this.state?.settings) this._applySkin();" in body[rebuilt:]
