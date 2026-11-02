# PadSpan HA - BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""The Atlas's lights list and rail, and Vacation Mode's Options box. The clicks
themselves need a real browser; what they depend on is held here."""
from pathlib import Path

_WWW = Path(__file__).parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_JS = (_WWW / "views" / "lights_map.js").read_text(encoding="utf-8").replace("\r\n", "\n")
_CSS = (_WWW / "styles.css").read_text(encoding="utf-8").replace("\r\n", "\n")


def test_a_row_does_not_capture_a_pointer_meant_for_its_own_controls():
    guard = _JS.index('if (ev.target?.closest?.("button,select,input,a,label")) return;')
    capture = _JS.index("row.setPointerCapture(ev.pointerId)")
    assert guard < capture and capture - guard < 200


def test_the_rail_keeps_its_way_back_when_hidden():
    assert ".lv-rail.hidden > :not(:last-child){display:none}" in _CSS
    assert ".lv-rail.hidden{transform" not in _CSS
    tail = _JS[_JS.index("const railToggle = railBtn("):_JS.index("mapCard.appendChild(rail);")]
    assert 'railToggle.textContent = view.railHidden ? "›" : "‹";' in tail
    assert tail.rstrip().endswith("rail.appendChild(railToggle);")   # it is the rail's last child


def test_sticky_headers_in_their_own_scrollers_stay_at_the_top():
    assert ".main .modal{--sticky-top:0px}" in _CSS
    assert "-webkit-overflow-scrolling:touch;--sticky-top:0px}" in _CSS
    assert 'input[type="time"]{color-scheme:light}' in _CSS


def test_the_vacation_options_box_scrolls_rather_than_wraps():
    opts = _CSS[_CSS.index(".lv-vacation-opts{"):]
    assert "flex-wrap:nowrap" in opts[:opts.index("}")] and "overflow:auto" in opts[:opts.index("}")]
    assert ".lv-vacation-opts > *{flex-shrink:0}" in _CSS
    banner = _CSS[_CSS.index(".lv-vacation{"):]
    assert "width:max-content" in banner[:banner.index("}")]
