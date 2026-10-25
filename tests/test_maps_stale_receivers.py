# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""3D Stack's stale-receiver button lists, it does not remove.

It used to say "Clean N stale", ask to remove them, and then report
"Removed N ✓" from a loop with nothing in it: no receiver was ever removed.
It is a read-only "N stale" button now that shows which receivers no live
scanner matches. These checks hold it there: the list renders the names and
maps, the section makes no write calls, and no removal is claimed.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_MAPS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "maps.js"
_NODE = shutil.which("node")


def _src() -> str:
    return _MAPS.read_text(encoding="utf-8")


def _func(src: str, name: str) -> str:
    """The text of `export function <name>(...) { ... }`, brace-matched."""
    start = src.index(f"export function {name}(")
    i = src.index("{", start)
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                return src[start:j + 1]
    raise AssertionError(f"unterminated {name}")


def _stale_section(src: str) -> str:
    a = src.index("// ── Stale Receivers (read-only) ──")
    b = src.index('"No stale");', a)
    return src[a:b]


def test_stale_section_writes_nothing():
    sec = _stale_section(_src())
    for call in ("callWS", "wsCall", "mapsUpdate", "settingsSet", "fabric", "confirm(", "async"):
        assert call not in sec, call


def test_no_removal_is_claimed():
    src = _src()
    assert "Removed ${staleCount}" not in src
    assert "Clean ${staleCount} stale" not in src
    assert "Cleaning…" not in _stale_section(src)


def test_no_fake_backfill_save():
    src = _src()
    assert "backfillMaps" not in src
    assert "try{  }catch" not in src
    assert "if(kept.length < orig.length){" not in src


def test_no_stale_house_unchanged():
    # Nothing new is drawn when every receiver matches: same label, same
    # dimmed style, no list box in the card.
    sec = _stale_section(_src())
    assert 'staleCount > 0 ? _staleReceiversBox(el, staleList) : null' in sec
    assert '";opacity:0.5"' in sec
    assert "if(staleBox) card.appendChild(staleBox);" in _src()


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_stale_list_renders_names_and_maps():
    src = _src()
    js = "\n".join([
        _func(src, "_staleReceivers").replace("export ", ""),
        _func(src, "_staleReceiversBox").replace("export ", ""),
        r"""
const el = (tag, attrs, kids) => ({ tag, attrs, kids });
const text = (n) => n == null ? "" : typeof n === "string" ? n
  : Array.isArray(n) ? n.map(text).join(" ") : text(n.kids);
const maps = [
  { id: "m1", name: "Main floor", receivers: [
    { id: "a", label: "Kitchen proxy", source: "AA:BB" },
    { id: "b", label: "Den proxy", source: "CC:DD" } ] },
  { id: "m2", name: "Basement", receivers: [ { id: "c", label: "", source: "EE:FF" } ] },
];
const live = new Set(["CC:DD"]);
const list = _staleReceivers(maps, r => live.has(r.source));
const box = _staleReceiversBox(el, list);
console.log(JSON.stringify({ n: list.length, text: text(box) }));
""",
    ])
    out = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=60, check=True)
    res = json.loads(out.stdout.strip().splitlines()[-1])
    assert res["n"] == 2
    t = res["text"]
    assert "Kitchen proxy (AA:BB) — Main floor" in t
    assert "EE:FF — Basement" in t
    assert "Den proxy" not in t
    assert "Nothing has been removed" in t
    assert "offline" in t
    assert "Delete receiver" in t and "Save Layout" in t
    assert "Removed" not in t and "✓" not in t
