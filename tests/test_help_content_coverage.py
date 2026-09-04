# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The in-app help/manual system, held to the same "two lists, one updated,
silent failure" standard as LIGHT_SHAPES and editions.js's SURFACE_CLASS.

help_content.js is a JS object literal: a key defined twice is not an error,
it's a SILENT one — the second definition wins and the first is dead prose
nobody will ever see again (this bit real content twice: settings_presence
and maps_stack each had two definitions, only the second reachable).
training.js's helpKeys arrays pull their text from that same dict at render
time by simply skipping any key that isn't there (training.js's own
`if (!h) continue;`) — so a typo'd or removed key doesn't error, it just
quietly renders nothing, which is how `zones` and `insights` sat broken.
Both defect classes get a guard here, same shape as the two tests already
guarding LIGHT_SHAPES and editions.js.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"

_KEY_RE = re.compile(r"^  ([a-zA-Z_][a-zA-Z0-9_]*):\s*\{", re.M)
_HELPKEYS_RE = re.compile(r"helpKeys:\s*\[([^\]]*)\]")
_STR_RE = re.compile(r"[\"']([a-zA-Z_][a-zA-Z0-9_]*)[\"']")


def _help_content_src() -> str:
    return (_WWW / "help_content.js").read_text(encoding="utf-8")


def _training_src() -> str:
    return (_WWW / "views" / "training.js").read_text(encoding="utf-8")


def _help_key_counts() -> Counter:
    return Counter(_KEY_RE.findall(_help_content_src()))


def test_no_help_key_is_defined_twice() -> None:
    counts = _help_key_counts()
    dupes = {k: n for k, n in counts.items() if n > 1}
    assert not dupes, (
        f"help_content.js defines these HELP keys more than once — the first "
        f"definition is dead, silently shadowed by the last: {dupes}"
    )


def test_every_training_helpkey_exists_in_help_content() -> None:
    known = set(_help_key_counts())
    referenced: set[str] = set()
    for block in _HELPKEYS_RE.findall(_training_src()):
        referenced.update(_STR_RE.findall(block))
    missing = referenced - known
    assert not missing, (
        f"views/training.js references helpKeys with no matching entry in "
        f"help_content.js — these render nothing in the manual, silently: {sorted(missing)}"
    )
