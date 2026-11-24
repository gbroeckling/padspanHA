# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Edgecut in the 3D house (views/live_aboard_edgecut.js, inside live_aboard.js).

Garry, 2026-11-24: the rooms fill the screen edge to edge, the house's outer
edges cut off where it overflows; then "Cut the edges left to right. Minimize
empty space": a light or a button out at an edge does not hold it back.

tests/js/live_aboard_edgecut.mjs runs its numbers on their own and the real
view under the DOM shim with a stub GL: every ray through the view passes
through a room, as far out as that holds, never farther than the whole house
and never nearer than four times it, the angle the person's; Views ▾ and the
⋯ list tick the same line for the screen; another view turns it off; a floor
or a new size frames it again; moved by hand it is left alone until the
flight home, which is Edgecut; never in Mapping's builder; at rest nothing
is drawn.

Held here too: the module asks nothing of Home Assistant and the view alone
imports it; its words are the ⋯ list's own; its report words are allowed.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_edgecut.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["math:", "off:", "views:", "list:", "other:", "top:", "always:", "hand:", "rest:", "builder:", "wall:"])
def test_the_edgecut_harness_covers_each_part(harness, prefix) -> None:
    got = [k for k in harness["cases"] if k.startswith(prefix)]
    assert got, prefix
    bad = [f for f in harness["failures"] if f["name"].startswith(prefix)]
    assert all(harness["cases"][k] for k in got) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)[:3000]


def test_every_edgecut_case_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:3], indent=2, ensure_ascii=False)[:3000]


def test_it_is_numbers_only_and_the_view_alone_imports_it() -> None:
    src = (_VIEWS / "live_aboard_edgecut.js").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))
    for word in ("callWS", "callService", "hass", "sendMessage", "localStorage", "fetch(", "import", "document", "window",
                 "requestAnimationFrame", "setTimeout", "setInterval", "THREE"):
        assert word not in code, word
    users = [p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and "import(`./live_aboard_edgecut.js" in p.read_text(encoding="utf-8")]
    assert users == ["live_aboard.js"], users
    assert "live_aboard_edgecut" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_edgecut")


def test_views_line_is_the_show_lists_own_and_counted_with_its_words() -> None:
    la = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    # The ⋯ list's words and hint (live_aboard_show.js, translated there): Views ▾ says nothing of its own.
    assert 'SHOW.SHOW_ITEMS.find(x => x.key === "edgecut")' in la and "text: it.words, title: it.hint" in la
    assert not re.search(r'\bt\("Edgecut', la)
    # The same pref and the same report words as the ⋯ list's tick.
    assert 'SHOW.withTick(showOver(), "edgecut", on, SHOW.houseOn(showHouse, "edgecut"))' in la
    assert "showSend(`house3d_show:${on ? \"show\" : \"hide\"}:edgecut`)" in la
    for name in ("house3d_show:show:edgecut", "house3d_show:hide:edgecut"):
        assert T.event_allowed(name), name
    # A display screen's line only, as on the flat Map.
    assert 'r.key !== "edgecut" || mapOnly' in la and "mapOnly && !!showOn && showOn.edgecut === true" in la
