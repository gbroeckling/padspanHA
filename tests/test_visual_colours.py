# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Colour defects found by the visual checks before the 2026-11 stable.

Each of these looked fine in the code and wrong on screen: a hex alpha glued to
roomColor's hsl() draws a room solid black, a textarea does not inherit the
panel's text colour, Day kept a box's background at night but not what its
classes colour, and Light inverted the native checkbox into a solid black box.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _js(file: str, expr: str):
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / file).resolve().as_uri()
    code = f"import(process.argv[1]).then(m => console.log(JSON.stringify({expr})));"
    res = subprocess.run([_NODE, "-e", code, url], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _css() -> str:
    return (_WWW / "styles.css").read_text(encoding="utf-8")


# ── Room colours at an alpha ────────────────────────────────────────────────

def test_an_hsl_room_colour_takes_its_alpha_inside_the_brackets():
    out = _js("views/room_color.js", '[m.roomColorAlpha("hsl(47 70% 55%)", "33"), m.roomColorAlpha("hsl(47 70% 55%)", "22")]')
    assert out == ["hsl(47 70% 55% / 0.2)", "hsl(47 70% 55% / 0.133)"]


def test_a_stored_hex_room_colour_is_exactly_what_it_was():
    assert _js("views/room_color.js", 'm.roomColorAlpha("#7a9b5c", "22")') == "#7a9b5c22"


def test_every_view_gets_the_helper():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert "const { roomColor, roomColorAlpha } =" in panel
    assert re.search(r"roomColor: \(n\)=>roomColor\(n, this\.state\.model\),\s+roomColorAlpha,", panel)


_ROOM_VAR_RE = re.compile(r"\b(?:const|let)\s+(\w+)\s*=[^;\n]*\broom[cC]olor\w*\(")
_ROOM_PROP_RE = re.compile(r"\bcolor:\s*[^,\n]*\broom[cC]olor\w*\(")
_HEX2 = r"[0-9a-fA-F]{2}(?![0-9a-zA-Z_])"
_REACH = 80    # lines a colour is followed for: a name like `color` is reused later in a file


def _appended_alphas(www: Path) -> list[str]:
    """Places that glue an alpha on to a colour that came from roomColor."""
    found = []
    for path in sorted(www.glob("*.js")) + sorted((www / "views").glob("*.js")):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        for i, ln in enumerate(lines):
            m = _ROOM_VAR_RE.search(ln)
            stored = None                 # { color: rc } or { color: roomColor(room) }, read back as r.color
            if _ROOM_PROP_RE.search(ln):
                stored = i
            if m:
                v = re.escape(m.group(1))
                glued = re.compile(r"\$\{" + v + r"\}(?:" + _HEX2 + r"|\$\{)|\b" + v + r"\s*\+\s*[\"'`]" + _HEX2)
                redeclared = re.compile(r"\b(?:const|let)\s+" + v + r"\b")
                as_prop = re.compile(r"\bcolor:\s*" + v + r"\b")
                for j in range(i, min(i + _REACH, len(lines))):
                    if j > i and redeclared.search(lines[j]):
                        break
                    if glued.search(lines[j]):
                        found.append(f"{path.name}:{j + 1}")
                    if stored is None and as_prop.search(lines[j]):
                        stored = j
            if stored is not None:
                for j in range(stored, min(stored + _REACH, len(lines))):
                    if re.search(r"\br\.color\}" + _HEX2, lines[j]):
                        found.append(f"{path.name}:{j + 1}")
    return sorted(set(found))


def test_no_view_appends_a_hex_alpha_to_a_room_colour():
    # `${rc}22` on hsl(...) is invalid CSS: an SVG fill turns solid black, an
    # inline background or border is dropped. Use ctx.helpers.roomColorAlpha.
    assert _appended_alphas(_WWW) == []


def test_the_guard_above_finds_the_shapes_it_is_for(tmp_path):
    (tmp_path / "views").mkdir()
    (tmp_path / "views" / "a.js").write_text(
        'const rc = ctx.helpers.roomColor(room);\n'
        'const s = `background:${rc}22`;\n'
        'const color = roomColorFn(room);\n'
        'const t = `fill="${color}${alpha}"`;\n'
        'const c = roomColor ? roomColor(room) : "#52b788";\n'
        'const u = "border:1px solid " + c + "44";\n'
        'const ok = `fill="${c}" stroke="${rc}"`;\n', encoding="utf-8")
    (tmp_path / "views" / "b.js").write_text(
        'const r = { color: ctx.helpers.roomColor(room) };\n'
        'const v = `${r.color}18`;\n', encoding="utf-8")
    assert _appended_alphas(tmp_path) == ["a.js:2", "a.js:4", "a.js:6", "b.js:2"]


# ── The support report ──────────────────────────────────────────────────────

def test_the_support_reports_textarea_has_the_panels_text_colour():
    # A textarea doesn't inherit `color`: black on the near-black .mono, and
    # pale on pale once Light inverts it.
    assert "textarea.mono{color:var(--text)}" in _css()
    for view in ("diagnostics", "monitor"):
        assert '"mono"' in (_WWW / "views" / f"{view}.js").read_text(encoding="utf-8")


# ── Day: what stays night ───────────────────────────────────────────────────

def _kept(css: str) -> str:
    return _js("day_theme.js", f"m.dayCss({json.dumps(css)}, m.dayColor, true)")


def test_inside_a_kept_box_a_class_keeps_its_night_colours():
    out = _kept(".h2{color:#e2e8f0;font-size:14px}.pill{background:#0f1a12;border:1px solid #1b3526}")
    assert "[data-keep-night]:not(.lv-atlascard) :is(.h2){color:#e2e8f0}" in out, out
    assert "[data-keep-night]:not(.lv-atlascard) :is(.pill){background-color:#0f1a12;border-color:#1b3526}" in out, out
    assert out.startswith(".h2{color:"), "the day copy still comes first"
    assert out.count("font-size:14px") == 1, "colours only"


def test_a_kept_box_gets_the_hosts_night_text_for_what_it_inherits():
    # Not the host's background: that outranks the box's own (.card's), and
    # every kept card turned the page's colour.
    out = _kept(":host{color:#e2e8f0;background:#0a150e;--ps-s2:#121816;display:block}")
    assert "[data-keep-night]:not(.lv-atlascard){color:#e2e8f0;--ps-s2:#121816}" in out, out


def test_a_variable_set_outside_a_kept_box_is_night_again_inside_it():
    out = _kept("#bluetooth{--bt-ink:#e8f0ea;background:#0f1a12}")
    assert "#bluetooth [data-keep-night]:not(.lv-atlascard){--bt-ink:#e8f0ea}" in out, "the variable alone, or the box takes its background" + out


def test_a_kept_copy_stays_inside_its_media_query_and_skips_keyframes():
    out = _kept("@media (max-width:600px){.a{color:#e2e8f0}}@keyframes k{from{color:#e2e8f0}to{color:#94a3b8}}")
    assert "@media (max-width:600px){.a{" in out and "[data-keep-night]:not(.lv-atlascard) :is(.a){color:#e2e8f0}}" in out, out
    assert ":is(from)" not in out and ":is(to)" not in out, out
    assert out.count("{") == out.count("}"), out


def test_kept_copies_are_days_alone():
    # A palette's boxes are dark throughout: a night copy there would undo its tint.
    assert ":is(.h2)" not in _js("day_theme.js", 'm.dayCss(".h2{color:#e2e8f0}", m.paletteColor("ocean"))')
    src = (_WWW / "day_theme.js").read_text(encoding="utf-8")
    assert src.count("color === dayColor)") == 2, "the view stylesheets and the linked ones"


def test_mappings_stage_is_the_box_not_its_whole_tool_card():
    # .mapstage gets its background from a class, so the walk used to pass it
    # and keep the whole Edit card at night.
    src = (_WWW / "day_theme.js").read_text(encoding="utf-8")
    assert '(color === dayColor && p.classList.contains("mapstage"))' in src, "Day's alone: a palette's card is dark anyway"


# ── Day: Bluetooth's accents ────────────────────────────────────────────────

def test_bluetooth_accents_are_dark_enough_to_read_on_day_cards():
    got = _js("day_theme.js", '["good","ok","bad","info","violet"].map(n => m.dayColor("#c4b5fd", "surface", "--bt-" + n))')
    assert all(c != "#c4b5fd" for c in got), got
    out = _js("day_theme.js", 'm.dayCss("#bluetooth{--bt-good:#4ade80;--bt-line:rgba(120,190,155,.16)}")')
    assert "#4ade80" not in out and "--bt-good:#18813e" in out, out
    assert "--bt-line:rgba(120,190,155,.16)" in out, "the others are still surfaces"


def test_a_palette_keeps_bluetooths_accents():
    for name in ("graphite", "ocean", "dusk", "contrast"):
        out = _js("day_theme.js", f'm.dayCss("#bluetooth{{--bt-good:#4ade80}}", m.paletteColor("{name}"))')
        assert "--bt-good:#4ade80" in out, (name, out)


# ── Light: checkboxes, and the date pickers' icon ───────────────────────────

def test_light_counter_inverts_checkboxes_and_night_does_not():
    css = _css()
    assert ':host([data-invert]) input[type="checkbox"]{filter:invert(1) hue-rotate(180deg)}' in css
    assert not re.search(r'(?m)^input\[type="checkbox"\]\s*\{[^}]*filter', css), "only under the inversion"


def test_the_calendar_icon_shows_on_dark_fields_and_stays_for_day():
    css = _css()
    assert ':host(:not([data-theme="day"])) ::-webkit-calendar-picker-indicator{filter:invert(1)}' in css
    assert ':host([data-theme="day"]){color-scheme:light}' in css
    # Only the icon: a dark color-scheme on the host would also redraw Night's
    # checkboxes, scrollbars and dropdowns.
    assert not re.search(r":host(?:\(:not\([^)]*\)\))?\s*\{[^}]*color-scheme:\s*dark", css)
