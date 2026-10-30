# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Two names that each meant two things, renamed in visible text only.

Mapping's "Rooms" tab (the room and receiver layout in metres) shared its
name with the Rooms page (views/rooms.js): it is "Layout" now. The menu's
"Setup" group shared its name with the guided Setup (views/setup.js): it is
"Build" now. The tab id, the view ids and the group's screens are unchanged,
so links, saved tabs and the report's tab events still match.
"""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_INTEG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _INTEG / "www" / "padspan-ha"


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_mappings_rooms_tab_is_called_layout_with_its_id_kept() -> None:
    maps = _read(_WWW / "views" / "maps.js")
    assert '["stack","3D Stack"],["rooms","Layout"],["lights","Atlas"]' in maps
    assert '["rooms","Rooms"]' not in maps
    assert 'activeTab==="rooms" ? _roomsTab(ctx, maps)' in maps         # the id the tab still goes by
    # Mapping → Edit's drawing mode draws rooms, so it keeps its name.
    assert 'ctx.state.maps._mode="rooms"; ctx.state.maps._selectedRxId=null; renderAll(); renderTools(); }}, "Rooms")' in maps


def test_the_menus_setup_group_is_called_build_with_its_screens_kept() -> None:
    panel = _read(_WWW / "panel.js")
    groups = panel.split("const MENU_GROUPS = [")[1].split("];")[0]
    assert '["Build",     ["maps","rooms","receivers","calibration","training","manage","settings"]],' in groups
    assert '"Setup"' not in groups
    # The guided Setup keeps its name.
    assert 'this.state.view === "setup" ? "Setup"' in panel


def test_no_visible_text_still_says_mapping_rooms() -> None:
    files = sorted(_WWW.glob("*.js")) + sorted((_WWW / "views").glob("*.js")) \
        + sorted((_WWW / "i18n").glob("*/help.json")) + sorted(_INTEG.glob("*.py"))
    old = re.compile(r"\bMap(?:s|ping) *(?:→|\\u2192) *Rooms\b|\bRooms tab's wall list\b")
    offenders = []
    for path in files:
        for i, line in enumerate(_read(path).splitlines(), 1):
            if line.lstrip().startswith(("//", "*", "#")):
                continue
            m = old.search(line)
            if m:
                offenders.append(f"  {path.name}:{i}: {m.group(0)!r}")
    assert not offenders, "copy still names Mapping's Rooms tab (it is Layout):\n" + "\n".join(offenders)
