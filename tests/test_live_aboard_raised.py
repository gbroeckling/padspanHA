# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What stands on a line keeps clear of the words (views/live_aboard_raised.js).

tests/js/live_aboard_raised.mjs runs it for real, inside the view, under the
DOM shim with a stub GL. tools/live_aboard_harness/pw_raised.py counts the
overlaps before and after in a real browser, at several orbits.

Held here: it is drawing only and asks nothing of Home Assistant, the view alone
imports it, and editing shows every real height.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def raised() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_raised.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["pick:", "steps:", "clears:", "real:", "still:", "rest:", "none:"])
def test_the_raised_harness_covers_each_part(raised, prefix) -> None:
    got = [k for k in raised["cases"] if k.startswith(prefix)]
    assert got, prefix
    bad = [f for f in raised["failures"] if f["name"].startswith(prefix)]
    assert all(raised["cases"][k] for k in got) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)[:3000]


def test_every_raised_case_passes(raised) -> None:
    assert not raised["failures"], json.dumps(raised["failures"][:3], indent=2, ensure_ascii=False)[:3000]


def test_it_is_drawing_only_and_the_view_alone_imports_it() -> None:
    src = (_VIEWS / "live_aboard_raised.js").read_text(encoding="utf-8")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))
    for word in ("callWS", "callService", "hass", "sendMessage", "localStorage", "fetch(", "import(", "requestAnimationFrame", "setInterval"):
        assert word not in code, word
    users = [p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and "import(`./live_aboard_raised.js" in p.read_text(encoding="utf-8")]
    assert users == ["live_aboard.js"], users
    # The stored height is never what moves: only where the marker is drawn.
    mo = (_VIEWS / "live_aboard_motion.js").read_text(encoding="utf-8")
    assert "S.lift.set(x, y, z); markAt(S);" in mo and "S.at.copy(S.home).add(S.lift);" in mo


def test_editing_shows_every_real_height() -> None:
    src = (_VIEWS / "live_aboard.js").read_text(encoding="utf-8")
    assert "const off = furnishOn || !!(editor && editor.active);" in src
    assert "off: () => raisedOff" in src


def test_the_harness_counts_it() -> None:
    tools = _ROOT / "tools" / "live_aboard_harness"
    if not (tools / "browser.py").is_file():
        pytest.skip("the harness isn't in this copy")
    assert (tools / "pw_raised.py").is_file()
    assert '("raised", ["pw_raised.py"])' in (tools / "run_all.py").read_text(encoding="utf-8")
