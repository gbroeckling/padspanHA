# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Layout defects from the visual check of 2026-11-01, held in the source.

The worst of them: between 901 and 1100 px the sidebar was already off-screen
but the bar with the button that opens it only came at 900, so an iPad in
landscape or a browser at half a screen had no menu at all, in both skins.
Each was checked in a browser when fixed; these keep the rules that did it.
"""
from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _read(name: str) -> str:
    return (_WWW / name).read_text(encoding="utf-8").replace("\r\n", "\n")


_CSS = _read("styles.css")
_SKIN = _read("styles-2025.css")


def _max_width_blocks(css: str) -> list[tuple[int, str]]:
    """Every `@media(max-width:Npx){…}` in the sheet, as (N, body)."""
    out = []
    for m in re.finditer(r"@media\s*\(max-width:\s*(\d+)px\)\s*\{", css):
        depth, i = 1, m.end()
        while depth:
            depth += {"{": 1, "}": -1}.get(css[i], 0)
            i += 1
        out.append((int(m.group(1)), css[m.end():i - 1]))
    return out


def _widest(css: str, needle: str) -> int:
    return max(n for n, body in _max_width_blocks(css) if needle in body)


def test_the_menu_button_shows_wherever_the_sidebar_is_off_screen() -> None:
    assert _widest(_CSS, ".mobile-topbar{display:flex") == _widest(_CSS, "transform:translateX(-100%)") == 1100
    assert _widest(_CSS, ".desktop-topbar{display:none") == 1100
    assert _widest(_CSS, ".sidebar-mobile-header{display:flex") == 1100
    assert 'id="mobileMenuBtn"' in _read("panel.js")


def test_the_bottom_nav_stays_on_phones() -> None:
    assert _widest(_CSS, ".mobile-bottom-nav{display:flex}") == 900


def test_the_drawer_opens_over_the_bar() -> None:
    wide = next(body for n, body in _max_width_blocks(_CSS) if n == 1100 and "translateX(-100%)" in body)
    drawer = int(re.search(r"\.left\{[^}]*z-index:(\d+)", wide).group(1))
    bar = int(re.search(r"\.mobile-topbar\{[^}]*?z-index:(\d+)", _CSS).group(1))
    assert drawer > bar


def test_a_collapsed_rail_does_not_take_the_page_with_it_in_the_drawer_range() -> None:
    """The rail's 92 px column would hold the whole page once the sidebar is a drawer."""
    for css in (_CSS, _SKIN):
        assert any(n == 1100 and ".app.mini{grid-template-columns:1fr}" in body.replace(".app,.app.mini", ".app.mini")
                   for n, body in _max_width_blocks(css))


def test_the_sticky_bar_reaches_the_top_and_both_edges() -> None:
    """A sticky item stops at the scroller's padding: content scrolled through
    a strip above the bar, and the bar stopped short of the edges."""
    def rule(css, width, sel):
        body = next(b for n, b in _max_width_blocks(css) if n == width and sel + "{" in b)
        return body[body.index(sel + "{"):].split("}")[0]

    # Classic: .main has 16 px of side padding above 900, 10 px at 900 and under.
    assert "padding-top:0" in rule(_CSS, 1100, ".main")
    assert "margin:0 -16px" in rule(_CSS, 1100, ".mobile-topbar")
    assert re.search(r"\.main\{\s*padding:0 10px", _CSS)
    assert "margin:0 -10px" in rule(_CSS, 900, ".mobile-topbar")
    # 2025 skin: 20 px, then 12 px.
    assert "padding:14px 20px" in _SKIN
    assert "padding-top:0" in rule(_SKIN, 1100, ".main")
    assert "margin:0 -20px" in rule(_SKIN, 1100, ".mobile-topbar")
    assert "padding:0 12px" in rule(_SKIN, 900, ".main")
    assert "margin:0 -12px" in rule(_SKIN, 900, ".mobile-topbar")


def test_phone_tables_scroll_with_whole_words_and_buttons_never_break() -> None:
    phone = "\n".join(b for n, b in _max_width_blocks(_CSS) if n == 900)
    assert ".table-scroll{overflow-x:auto" in phone
    assert ".table-scroll table{word-break:normal;overflow-wrap:break-word}" in phone
    assert ".card .btn{word-break:normal;overflow-wrap:break-word;max-width:100%}" in phone
    # Long names outside a scrolling table still wrap.
    assert ".card{word-break:break-word}" in phone


def test_the_reported_tables_sit_in_a_scroller() -> None:
    objects = _read("views/objects.js")
    assert 'el("div",{class:"table-scroll"}, objTable)' in objects
    assert 'class:"muted obj-scanner"' in objects
    manage = _read("views/manage.js")
    for card in ("orphCard", "tagsCard", "areasCard", "mapsCard"):
        assert f'{card}.appendChild(el("div",{{class:"table-scroll"}},el("table",{{class:"table"}},[' in manage
    maps = _read("views/maps.js")
    assert 'const tableWrap = el("div",{class:"table-scroll",style:"overflow-x:auto;margin-top:8px"});' in maps


def test_by_room_filters_keep_their_text_on_a_phone() -> None:
    small = "\n".join(b for n, b in _max_width_blocks(_CSS) if n == 480)
    assert ".toolbar select{min-width:0;flex:1 1 120px" in small


def test_presence_columns_follow_the_width_on_a_phone_only() -> None:
    assert 'columns:3' not in _read("views/presence.js")
    assert ".presence-scanners{columns:3;column-gap:10px}" in _CSS
    phone = "\n".join(b for n, b in _max_width_blocks(_CSS) if n == 900)
    assert ".presence-scanners{columns:3 240px}" in phone


def test_bluetooth_panels_stay_inside_the_screen() -> None:
    """`1fr` is at least as wide as its content, and .main hides what runs over."""
    phone = next(b for n, b in _max_width_blocks(_CSS) if n == 900 and ".grid-2{" in b and ".card{" in b)
    assert ".grid-2{grid-template-columns:minmax(0,1fr)}" in phone
    small = "\n".join(b for n, b in _max_width_blocks(_CSS) if n == 480)
    assert "#bluetooth .bt-adv-row{flex-wrap:wrap}" in small
    assert "#bluetooth .bt-adv-sub,#bluetooth .bt-scanner-src{white-space:normal}" in small


def test_health_check_values_leave_the_name_its_room_on_a_phone() -> None:
    health = _read("views/health.js")
    assert 'el("div",{class:"health-checks"})' in health
    assert not re.search(r'c\.ok\?"#52b788":"#fca5a5"\};font-weight:600;white-space:nowrap', health)
    assert ".health-checks{display:grid;grid-template-columns:18px 1fr auto" in _CSS
    phone = "\n".join(b for n, b in _max_width_blocks(_CSS) if n == 768)
    assert ".health-checks{grid-template-columns:18px minmax(0,1fr)}" in phone
    assert ".health-checks .mono{grid-column:2" in phone


def test_point_align_preview_scrolls() -> None:
    """`align-items:start` on the row let the panel grow past the window, so its
    `overflow:auto` had nothing to scroll."""
    maps = _read("views/maps.js")
    assert 'previewPanel.style.cssText = "flex:1;align-self:stretch;' in maps
    assert 'for (const c of previewPanel.children) c.style.flexShrink = "0";' in maps


def test_sidebar_labels_keep_their_descenders() -> None:
    """`13px/1` on the button with `overflow:hidden` on the label cut g, p and y."""
    rule = re.search(r"\.navlabel\{([^}]*)\}", _SKIN).group(1)
    assert "overflow:hidden" in rule
    assert float(re.search(r"line-height:([\d.]+)", rule).group(1)) >= 1.2
