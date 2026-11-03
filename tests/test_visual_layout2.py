# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""More layout defects from the visual check of 2026-11-01, held in the source.

Each was measured in a browser before and after; these keep the rules that did it.
"""
from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _read(name: str) -> str:
    return (_WWW / name).read_text(encoding="utf-8").replace("\r\n", "\n")


_CSS = _read("styles.css")
_SKIN = _read("styles-2025.css")
_VIEWS = sorted((_WWW / "views").glob("*.js"))


def _block(css: str, width: int, needle: str) -> str:
    """The `@media(max-width:Npx){…}` block of that width holding `needle`."""
    for m in re.finditer(r"@media\s*\(max-width:\s*%dpx\)\s*\{" % width, css):
        depth, i = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(css[i], 0)
            i += 1
        if needle in css[m.end():i - 1]:
            return css[m.end():i - 1]
    raise AssertionError(f"no {width}px block holds {needle}")


def test_no_active_tab_is_a_full_width_button() -> None:
    # "btn" alone is width:100%, "btn inline" isn't: choosing one by state makes the row jump.
    picked = re.compile(r'"btn"\s*\+\s*\([^()]*\?\s*""\s*:\s*" inline"\)|\?\s*"btn"\s*:\s*"btn inline"|\?\s*"btn inline"\s*:\s*"btn"')
    found = [p.name for p in _VIEWS if picked.search(p.read_text(encoding="utf-8"))]
    assert not found, found
    assert 'class: "btn inline" + (active ? " on" : "")' in _read("views/devices.js")
    assert 'class: "btn inline" + (filter === value ? " on" : "")' in _read("views/devices.js")
    assert 'class: "btn inline" + (active ? " on" : "")' in _read("views/training.js")
    assert 'class: "btn inline" + (cs.duration === d ? " on" : "")' in _read("views/calibration.js")


def test_the_active_training_tab_keeps_its_width() -> None:
    # A heavier font on the active tab alone moved the ones after it by a few pixels.
    assert 'style: active ? "border-color:#52b788" : ""' in _read("views/training.js")


def test_a_full_width_field_counts_its_padding() -> None:
    assert re.search(r"\.input,\.select\{\s*box-sizing:border-box;\s*width:100%", _CSS)
    assert 'textarea.mono,input[type="text"]{box-sizing:border-box}' in _CSS
    # On .btn it would also shrink every <a class="btn">, whose heights were fine.
    first = re.search(r'\.nav button, \.btn, select, input\[type="text"\]\{[^}]*\}', _CSS).group(0)
    assert "box-sizing" not in first


def test_fields_of_a_fixed_width_keep_their_size() -> None:
    field = re.compile(r'el\("input",\s*\{(.*?)\}\s*\)', re.S)
    fixed = re.compile(r"""style["']?\s*:\s*["'`]([^"'`]*(?<![-\w])width:\d+px[^"'`]*)""")
    wrong = []
    for path in _VIEWS:
        for m in field.finditer(path.read_text(encoding="utf-8")):
            body = m.group(1)
            if not re.search(r"""class["']?\s*:\s*["'`]input\b|type["']?\s*:\s*["'`]text\b""", body):
                continue
            style = fixed.search(body)
            if style and "box-sizing" not in style.group(1):
                wrong.append(f"{path.name}: {style.group(1)[:50]}")
    assert not wrong, wrong
    assert re.search(r"input\.lv-preset-name\{[^}]*width:150px;box-sizing:content-box", _CSS)


def test_labels_of_a_field_row_line_up() -> None:
    assert "select.input{margin-top:0}" in _CSS
    assert 'input.input[type="email"]{min-height:37px}' in _CSS
    rule = re.search(r"#bluetooth \.bt-controls \.input,#bluetooth \.bt-controls \.select\{([^}]*)\}", _CSS).group(1)
    assert "margin-top:0" in rule and "min-height:34px" in rule


def test_only_the_screens_that_clipped_get_wide_cards() -> None:
    assert ".grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}" in _CSS
    assert ".grid-wide{grid-template-columns:repeat(auto-fit,minmax(min(380px,100%),1fr))}" in _CSS
    for name, count in (("qa", 1), ("sandbox", 1), ("health", 1), ("diagnostics", 1), ("monitor", 3)):
        assert _read(f"views/{name}.js").count('class:"grid grid-wide"') == count, name
    # Zones' room tiles and Overview's counts were fine as they were.
    assert _read("views/monitor.js").count('class:"grid"') == 2
    assert 'class:"grid"' in _read("views/overview.js") and "grid-wide" not in _read("views/overview.js")


def test_sandbox_floors_share_the_card() -> None:
    src = _read("views/sandbox.js")
    assert "flex:1 1 76px;min-width:76px;max-width:200px" in src
    assert "colWidth" not in src


def test_health_values_are_not_boxes() -> None:
    assert "#health .mono{background:none;border:none;border-radius:0;padding:0}" in _CSS
    assert 'id:"health"' in _read("views/health.js")


def test_a_toast_hides_what_is_under_it_and_stays_where_it_was() -> None:
    plain = re.search(r"\.toast\{([^}]*)\}", _CSS).group(1)
    assert "position:sticky" in plain and "top:0" in plain
    for css in (_CSS, _SKIN):
        for selector in (r"\.toast\{", r"\.toast\.error\{"):
            rule = re.search(selector + r"([^}]*)\}", css).group(1)
            assert re.search(r"background:linear-gradient\([^;]*\),var\(--bg\)", rule), selector


def test_a_phone_cannot_be_pushed_wider_than_the_screen() -> None:
    wide = _block(_CSS, 900, ".grid{")
    assert ".grid{grid-template-columns:minmax(0,1fr)}" in wide
    assert ".bt-kpis{flex-wrap:wrap}" in wide


def test_library_rows_wrap_on_a_phone_only() -> None:
    phone = _block(_CSS, 480, ".maprow")
    assert ".maprow{flex-wrap:wrap}" in phone and ".maprow > :last-child{flex:1 0 100%}" in phone
    assert ".maprow" not in _block(_CSS, 900, ".grid{")


def test_compare_maps_room_keeps_room_for_its_name() -> None:
    src = _read("views/maps.js")
    assert 'style:"display:flex;flex-wrap:wrap;gap:0 8px;padding:2px 0;border-bottom:1px solid #1a2a1a"' in src
    assert 'style:"flex:1 1 120px;color:#e2e8f0"}, p.room' in src


def test_the_rail_drawer_shows_its_floors_on_a_phone() -> None:
    assert "@media(max-width:900px){.lv-drawer.open{max-height:min(70vh,100%)}}" in _CSS
    assert _CSS.index(".lv-drawer.open{max-height:220px") < _CSS.index(".lv-drawer.open{max-height:min(70vh,100%)}")
