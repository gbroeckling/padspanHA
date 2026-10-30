# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Plain names in the panel (Garry, 2026-10-30).

Expert words on screen were renamed: Monitor's tabs (Calls and timing,
Signal and coverage, Quick status, Export for support), Problems found,
Room mix-ups, Accuracy by spot, Signal vs distance, Signal walls, Light
spread, Room and receiver layout and so on. Only the words people see
changed; ids, routes, settings keys and report keys did not.

This holds the frontend to it: the old names are gone from every string
literal the panel can show (comments don't count), and the new ones are
there. settings.js and purelive.js are left out on purpose: other work is
reshaping them, and their renames come later.
"""

from __future__ import annotations

import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SKIP = {"settings.js", "purelive.js"}

_BS = chr(92)


def _files() -> list[Path]:
    out = [_WWW / "panel.js", _WWW / "help_content.js", _WWW / "lights_panel.js"]
    out += [p for p in sorted((_WWW / "views").glob("*.js")) if p.name not in _SKIP]
    return out


def _literals(src: str) -> list[str]:
    """Every '…', "…" and `…` literal outside comments (regex literals skipped)."""
    out: list[str] = []
    i, n, prev = 0, len(src), ""
    while i < n:
        c = src[i]
        if src.startswith("//", i):
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if src.startswith("/*", i):
            i = src.find("*/", i + 2) + 2
            continue
        if c in "\"'`":
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == _BS else 1
            out.append(src[i + 1:j])
            i, prev = j + 1, c
            continue
        if c == "/" and prev in "(,=:[!&|?{};":
            j = i + 1
            while j < n and src[j] not in "/\n":
                if src[j] == _BS:
                    j += 1
                elif src[j] == "[":
                    while j < n and src[j] != "]":
                        j += 1
                j += 1
            i, prev = j + 1, "/"
            continue
        if not c.isspace():
            prev = c
        i += 1
    return out


def _unescape(s: str) -> str:
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)


def _text() -> str:
    parts = []
    for p in _files():
        src = p.read_text(encoding="utf-8").replace("\r\n", "\n")
        parts.extend(_unescape(s) for s in _literals(src))
    return "\n".join(parts)


# Old visible names that must not come back (case matters: lower-case
# identifiers such as fabric_health or lights_isolux are untouched).
_OLD = [
    "Diag Export", "Diagnostics Export", "See Diagnostics",
    "System Critics", "Refresh Critics", "Confusion Matrix", "Error Matrix",
    "Path-Loss Fits", "RF Barrier", "RF BARRIERS", "Isolux", "Live EMA sources",
    "Save Z", "Positioning Fabric", "Positioning fabric", "positioning fabric",
    "Fabric Status", "Room Fabric", "Fabric editor", "Refresh Fabric", "The Fabric",
    "Fabric (saved)", "Fabric active", "Scanner Fabric", "the fabric", "to fabric",
    "Retrain RF", "Go to Setup", "k-NN positioning", "k-NN: ", "→ Distortion",
]

_NEW = [
    "Calls and timing", "Signal and coverage", "Quick status", "Export for support",
    "Beacon and floor", "Save height", "Room and receiver layout", "Layout status",
    "Room layout by floor", "Load into the layout editor", "Refresh layout",
    "Problems found", "Check again", "Room mix-ups", "Accuracy by spot",
    "Signal vs distance", "Matched to calibration points", "Calibration match",
    "Learned model", "Signal walls", "Light spread", "Live signal sources", "smoothed",
    "→ Signal distortion",
]


def test_old_visible_names_are_gone():
    text = _text()
    left = [w for w in _OLD if w in text]
    assert not left, f"old visible names still in the panel: {left}"


def test_new_visible_names_are_there():
    text = _text()
    missing = [w for w in _NEW if w not in text]
    assert not missing, f"new names missing: {missing}"


def _src(name: str) -> str:
    return (_WWW / "views" / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_monitor_tabs_keep_their_ids():
    src = _src("monitor.js")
    assert ('[["diagnostics","Calls and timing"],["zones","Zones"],["insights","Signal and coverage"],'
            '["health","Quick status"],["diag_export","Export for support"],["debug","Debug"]]') in src


def test_calibration_tabs_keep_their_ids():
    src = _src("calibration.js")
    assert '["setup","Beacon and floor"]' in src
    assert '["matrix","Accuracy by spot"]' in src
    # Tune and Beacon Tune keep their names.
    assert '["tune","Tune"],["beacon","Beacon Tune"]' in src


def test_manage_entities_tips_heading():
    src = _src("manage.js")
    assert '"font-weight:600;font-size:12px;margin-bottom:2px"},"Tips")' in src


def test_technical_word_stays_in_hover_help():
    # The calibration status line still names the method on hover.
    src = _src("overview.js")
    assert 'title:algoTech' in src and '"k-NN (k-nearest neighbours)"' in src
    assert "(isolux)" in _src("lights_map.js")
