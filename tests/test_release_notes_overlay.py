# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The release notes open inside the panel, and close on a touch screen.

Garry, 2026-09-28: "release notes screen has no way to close on touch
monitor". The Overview's "PadSpan HA updated" card had "See what changed" as a
link to padspan.traks.ca in a new tab. The wall screens run Chrome --kiosk:
no tab strip, no keyboard, so that tab could not be closed and the screen was
stuck on the website. The notes now open over the panel from
assets/whatsnew.json (written by scripts/release.py from CHANGELOG.md and
shipped with the integration, so they work offline), with ✕, Close, a tap
outside and Escape.

tests/js/release_notes.mjs runs the overlay; tests/js/whats_new_card.mjs runs
the card's button. This checks the wiring between panel.js and the file.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_INTEG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _INTEG / "www" / "padspan-ha"
_PANEL = _WWW / "panel.js"
_MODULE = _WWW / "views" / "release_notes.js"
_NOTES = _WWW / "assets" / "whatsnew.json"
_SCRIPT = Path(__file__).parent / "js" / "release_notes.mjs"
_NODE = shutil.which("node")


def _method(src: str, name: str) -> str:
    i = src.find(f"\n  {name}(){{")
    assert i > 0, f"panel.js has no {name}()"
    j = src.find("\n  }\n", i)
    return src[i:j]


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_overlay_opens_closes_every_way_and_never_parses_markup() -> None:
    run = subprocess.run([_NODE, str(_SCRIPT), str(_MODULE), str(_NOTES)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert run.returncode == 0, f"{run.stdout}\n{run.stderr[-2000:]}"
    m = re.search(r"(\d+) passed, (\d+) failed", run.stdout)
    assert m and int(m.group(1)) >= 19, f"only part of the harness ran:\n{run.stdout}"


def test_the_shipped_notes_are_the_newest_releases_in_order() -> None:
    notes = json.loads(_NOTES.read_text(encoding="utf-8"))
    assert isinstance(notes, list) and 1 <= len(notes) <= 6, len(notes)
    for n in notes:
        assert set(n) == {"version", "title", "date", "body_markdown"}, n.keys()
        assert re.fullmatch(r"\d+\.\d+\.\d+", n["version"]), n["version"]
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", n["date"]), n["date"]
        assert n["title"] and n["body_markdown"].strip()
        assert "\n## " not in n["body_markdown"], "a section ran into the next one"
    versions = [tuple(int(x) for x in n["version"].split(".")) for n in notes]
    assert versions == sorted(versions, reverse=True) and len(set(versions)) == len(versions), "not newest first"


def test_see_what_changed_opens_the_notes_not_a_new_tab() -> None:
    js = _PANEL.read_text(encoding="utf-8")
    card = _method(js, "_whatsNewCard")
    assert '"See what changed"' in card
    assert "this._openReleaseNotes()" in card and "remember(null)" in card, (
        "See what changed must open the notes AND record the version as seen")
    assert "#whatsnew" not in card and "notesUrl" not in card, "the card still links to the website's notes"


def test_the_notes_load_from_the_shipped_file_with_the_cache_buster() -> None:
    js = _PANEL.read_text(encoding="utf-8")
    body = _method(js, "_openReleaseNotes")
    # The same ?b= stamp every view import carries, so a release's module
    # is never served from an old cache.
    assert "import(`./views/release_notes.js?b=${BUILD_ID}`)" in body
    # The same ?v=&b= pair styles.css is loaded with, under the static path
    # panel.py registers for www/.
    static = re.search(r'STATIC_URL = "([^"]+)"', (_INTEG / "panel.py").read_text(encoding="utf-8")).group(1)
    url = f"{static}/padspan-ha/assets/whatsnew.json?v=${{APP_VERSION}}&b=${{BUILD_ID}}"
    assert f"url: `{url}`" in body, f"the notes URL is not {url}"
    assert _NOTES.is_file(), "the file the panel fetches is not in the integration"
    # The website's full history: never where its new tab can't be closed.
    assert "m.notesHistoryLink(historyUrl, this.state.kioskMode)" in body
    # editions.js may fail to load; the history link still has somewhere to go.
    assert '|| "https://padspan.traks.ca/#whatsnew"' in body
    assert ".catch(" in body and "this._toast(" in body, "a failed module load must say so, not do nothing"
