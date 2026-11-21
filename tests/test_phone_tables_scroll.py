# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Wide tables on a phone scroll sideways in their own box, not the sheet.

The click-through crawl of 2026-11-20 (run 3): Overview → All objects (675 px)
and View radios list (548 px) on a 390 px phone made the whole sheet scroll
sideways, its title and filters with it. They (and the Rooms list beside them)
now sit in .table-scroll, the wrapper Manage's and Objects' tables already
use: overflow-x:auto on a phone only, so a desktop is exactly as it was.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_overview_sheets_tables_are_in_their_own_scroll_box():
    s = _src("views/overview.js")
    # Rooms and View radios list: the table built inside the wrapper.
    assert s.count('body.appendChild(el("div",{class:"table-scroll"}, el("table",{class:"table"},[') == 2
    # All objects: the table built first, then put in the wrapper.
    assert 'body.appendChild(el("div",{class:"table-scroll"}, table));' in s
    assert "body.appendChild(table);" not in s
    # No bare .table left in a sheet of the Overview's.
    assert not re.search(r'body\.appendChild\(el\("table"', s)


def test_the_wrapper_scrolls_on_a_phone_only():
    css = _src("styles.css")
    rule = css.index(".table-scroll{overflow-x:auto")
    phone = css[css.rindex("@media(max-width:900px){", 0, rule):]
    phone = phone[:phone.index("\n}\n")]
    assert ".table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}" in phone
    outside = css.replace(phone, "")
    assert ".table-scroll" not in outside
