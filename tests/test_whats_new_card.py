"""The what's-new card: shown once per version, and never to a fresh install.

An update lands silently. Home Assistant's persistent notification is easy to
miss, and the release notes live somewhere the person is not. The card says what
happened where they already are — once.

The subtle rule is that it must be SEEDED rather than shown the first time the
panel sees an install. With no stored version there is no way to tell a genuine
update from a first-ever install, and telling somebody who has just installed
PadSpan that it "updated to v0.38.0" is worse than saying nothing at all.
"""
from __future__ import annotations

import pathlib
import re

from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_PANEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_EDITIONS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "editions.js"


def test_the_seen_version_is_stored_and_settable() -> None:
    assert "whatsnew_seen_version" in DEFAULT_SETTINGS, "the card has nowhere to remember what it showed"
    assert DEFAULT_SETTINGS["whatsnew_seen_version"] == "", (
        "it must default to empty — that is what marks an install the panel has never seen, "
        "and what stops a fresh install being told it updated")
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "whatsnew_seen_version" in keys, "settings_set would refuse it at the transport layer"


def test_only_a_version_shaped_string_is_stored() -> None:
    """The panel writes this from its own build constant, so anything that is
    not shaped like a version is a bug or a probe and must not be persisted."""
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    i = src.find('if "whatsnew_seen_version" in msg:')
    assert i > 0, "the handler no longer accepts whatsnew_seen_version"
    block = src[i:i + 700]
    assert re.search(r"fullmatch\(.*\\d\+\\\.\\d\+\\\.\\d\+", block), (
        "the value is stored without being checked against a version shape")


def test_the_card_seeds_before_it_shows() -> None:
    js = _PANEL.read_text(encoding="utf-8")
    assert "_whatsNewCard()" in js, "the card is gone"
    i = js.find("_whatsNewCard(){")
    assert i > 0
    body = js[i:i + 2600]
    # Same version as this build -> nothing to say.
    assert "=== APP_VERSION) return null" in body, "the card would re-show on every render"
    # No stored version -> record it and show NOTHING. This is the rule that
    # keeps a first-ever install from being told it "updated".
    assert re.search(r"if \(!seen\).*return null", body), (
        "the card no longer seeds silently on first sight — a fresh install would be "
        "told it updated to a version it has always been on")
    # Rendered on Overview, above the opt-in ask. Do NOT split on the view
    # check: that string appears three times in panel.js and only the last one
    # is this render site.
    call = js.find("const _new = this._whatsNewCard();")
    ask = js.find("this._telemetryAskCard(false)")
    assert call > 0, "the card is no longer rendered on Overview"
    assert ask > call, "the opt-in ask should follow it — what changed is the more perishable of the two"


def test_the_notes_url_has_one_owner() -> None:
    ed = _EDITIONS.read_text(encoding="utf-8")
    assert re.search(r"export const WHATSNEW_URL\s*=", ed), "editions.js no longer owns the notes URL"
    assert "padspan.traks.ca/#whatsnew" in ed


def test_panel_never_blocks_on_the_editions_import() -> None:
    """editions.js is loaded non-blocking on purpose: panel.js says in its own
    comment that a failure there must not take the panel down, and falls back to
    "show everything". A top-level await would turn that failure into a blank
    panel for every user. This nearly happened while adding the card."""
    js = _PANEL.read_text(encoding="utf-8")
    # Top level means column zero. An INDENTED `await import(...)` sits inside a
    # method and is fine — panel.js has one of those on purpose.
    # Top level means column zero. An INDENTED `await import(...)` sits inside a
    # method and is fine — panel.js has one of those on purpose. Two conditions
    # rather than one regex: `^\S.*await import\(` needs the text twice on the
    # line and so misses a bare top-level `await import(...)`.
    offenders = [ln for ln in js.splitlines()
                 if ln[:1].strip() and "await import(" in ln]
    assert not offenders, (
        "panel.js has a top-level `await import(...)`, so a failed module load would "
        f"stop the whole panel evaluating: {offenders[:2]}")
