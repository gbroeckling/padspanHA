# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""💡 Suggest an idea (0.38.140): Settings has a card with three ways in
(post an idea, see and vote on ideas, email one), and What's New's footer has
the link. Ideas go to GitHub Discussions → Ideas, where they can be voted on.
release_notes.js imports nothing, so it keeps its own copy of the link."""

from __future__ import annotations

import re
from pathlib import Path

V = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _const(src: str, name: str) -> str:
    m = re.search(rf'export const {name} = "([^"]+)";', src)
    assert m, name
    return m.group(1)


def test_one_ideas_link_everywhere():
    ed = (V / "editions.js").read_text(encoding="utf-8")
    rn = (V / "release_notes.js").read_text(encoding="utf-8")
    assert _const(ed, "IDEAS_NEW_URL") == _const(rn, "IDEAS_NEW_URL") \
        == "https://github.com/gbroeckling/padspanHA/discussions/new?category=ideas"
    assert _const(ed, "IDEAS_URL").endswith("/discussions/categories/ideas")
    assert _const(ed, "IDEAS_MAIL").startswith("mailto:hello@traks.ca")
    assert 'node("a", "notes-idea", NOTES_IDEA)' in rn


def test_settings_has_the_card_with_all_three_ways():
    st = (V / "settings.js").read_text(encoding="utf-8")
    assert "💡 Suggest an idea" in st
    for url, ev in (("IDEAS_NEW_URL", "suggest_idea_posted"), ("IDEAS_URL", "suggest_idea_browsed"),
                    ("IDEAS_MAIL", "suggest_idea_mail")):
        assert f'link({url}, ' in st and f'telemetryEvent("{ev}")' in st
