# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Mapping tab's header on a phone.

Design pass leftover, 2026-09-28: at 390px the header's Refresh button read
one letter per line. The row was a flex row whose text block took all the
room, and the panel-wide `.card{word-break:break-word}` (under 900px) let the
button shrink to a single letter. The text now takes what is left and wraps
by word; the button keeps its width.
"""
from __future__ import annotations

import re
from pathlib import Path

_MAPS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "maps.js"


def test_refresh_keeps_its_width_and_the_text_wraps() -> None:
    src = _MAPS.read_text(encoding="utf-8").replace("\r\n", "\n")
    head = src[src.index("const header = el(\"div\",{class:\"card\"}"):]
    head = head[:head.index("tabs,\n  ]);")]
    text_box = re.search(r'el\("div",\{style:"([^"]*)"\},\[\s*el\("div",\{class:"card-head"\}', head)
    assert text_box and "min-width:0" in text_box.group(1) and "flex:1" in text_box.group(1), \
        "the header text no longer takes the room that is left"
    refresh = re.search(r'el\("div",\{style:"([^"]*)"\},\[\s*el\("button",\{class:"btn inline", style:"([^"]*)"[^}]*\}, "Refresh"\)', head)
    assert refresh, "the Refresh button moved — update this test"
    assert "flex:none" in refresh.group(1), "the Refresh box can shrink"
    assert "white-space:nowrap" in refresh.group(2), "Refresh can wrap one letter per line"
