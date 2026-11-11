# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The sidebar Atlas's scroll bars go away after five minutes with nobody touching the page, and come back at the
next touch, key or pointer move (2026-11-11). Mapping's map keeps its bars."""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SRC = (_WWW / "views" / "lights_map.js").read_text(encoding="utf-8")
_CSS = (_WWW / "styles.css").read_text(encoding="utf-8")


def test_five_minutes() -> None:
    assert "export const BARS_IDLE_MS = 5 * 60 * 1000;" in _SRC
    assert "export function barsQuiet(now, last) { return now - last >= BARS_IDLE_MS; }" in _SRC


def test_only_the_sidebar_atlas_and_one_set_of_listeners() -> None:
    assert _SRC.count("_barsWatch(isoDiv)") == 1 and "if (DISPLAY) _barsWatch(isoDiv);" in _SRC
    # Wired once for the page, whatever the number of cards built; every way of touching the page wakes the bars.
    body = _SRC[_SRC.index("function _barsWatch(stage)"):_SRC.index("const _LA_PICK")]
    assert "if (!_bars.wired" in body and "_bars.wired = true;" in body
    for ev in ("pointerdown", "pointermove", "wheel", "keydown", "touchstart"):
        assert f'"{ev}"' in body
    assert "passive: true" in body and ".unref()" in body          # never holds a scroll back, never keeps a test run alive


def test_the_bars_hide_and_the_map_still_scrolls() -> None:
    assert ".lv-stage.lv-quietbars{scrollbar-width:none}" in _CSS
    assert ".lv-stage.lv-quietbars::-webkit-scrollbar{display:none}" in _CSS
    rule = re.search(r"\.lv-stage\{[^}]*\}", _CSS).group(0)
    assert "overflow:auto" in rule                                   # hidden bars, not a locked map
    assert not re.search(r"\.lv-quietbars[^{]*\{[^}]*overflow", _CSS)
