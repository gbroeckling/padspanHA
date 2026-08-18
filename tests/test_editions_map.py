# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every navigable surface is classified `lighting` or `presence` — TOTALLY.

The failure mode of a derived edition is not the build. It is the day a view
is added, Bright is forgotten, and a presence feature quietly appears in the
lighting product three releases later. So the classification map in
views/editions.js is asserted equal to the set of views panel.js knows: add a
view and forget to classify it, and this goes red before it is ever pushed.
Same defect class as the LIGHT_SHAPES vs backend-whitelist bug: two lists,
one updated, silent failure — the answer is a test that holds them equal.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _panel_view_ids() -> set[str]:
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    block = src[src.index("const _VIEW_PATHS = {"):]
    block = block[:block.index("};")]
    return set(re.findall(r"^\s*([a-z_]+):\s*\"\./views/", block, re.M))


def _menu_ids() -> set[str]:
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    block = src[src.index("const MENU = ["):]
    block = block[:block.index("];")]
    return set(re.findall(r'\["([a-z_]+)",', block))


def _classified() -> dict[str, str]:
    src = (_WWW / "views" / "editions.js").read_text(encoding="utf-8")
    block = src[src.index("export const SURFACE_CLASS = Object.freeze({"):]
    block = block[:block.index("});")]
    return dict(re.findall(r'^\s*([a-z_]+):\s*"(lighting|presence)"', block, re.M))


def test_every_view_panel_knows_is_classified_and_nothing_else_is() -> None:
    views = _panel_view_ids()
    assert views, "could not read _VIEW_PATHS from panel.js"
    classified = _classified()
    missing = views - set(classified)
    extra = set(classified) - views
    assert not missing, f"views with no lighting/presence class in editions.js: {sorted(missing)}"
    assert not extra, f"editions.js classifies views panel.js no longer has: {sorted(extra)}"


def test_every_menu_entry_is_a_known_view() -> None:
    assert _menu_ids() <= _panel_view_ids()


def test_bright_keeps_exactly_the_lighting_product() -> None:
    """The product promise, pinned: Mapping (rooms, floors, the fabric, the
    Lights tab), Settings, Health. Everything else is presence."""
    lighting = {k for k, v in _classified().items() if v == "lighting"}
    assert lighting == {"maps", "settings", "health"}, sorted(lighting)
