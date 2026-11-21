# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The keyboard for the panel's cards, sheets, drawers and dialogs, RUN
rather than read (tests/js/dialog_keys.mjs drives views/dialog_keys.js).

The click-through test of 2026-11-20 found that Escape did nothing on the
phone menu, the Atlas builder guide, the flat Atlas's room, door and receiver
cards and Live Aboard's receiver cards, though ✕ and a tap outside closed
them; and that the panel's dialog never took the keyboard: Tab walked the
page behind it, and on closing the focus fell to the page (872 times).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "dialog_keys.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def run():
    r = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["escape", "tab", "back", "gone", "pressed", "atlas", "modal"])
def test_dialog_keys(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8")


def test_the_phone_menu_and_the_builder_guide_hold_the_keys():
    """The two the Node run cannot open on their own: the phone menu (panel.js)
    and the Atlas builder guide (maps.js). Escape does what × / ✕ does."""
    p = _src("panel.js")
    assert 'this._drawerHold = DIALOG_KEYS.holdKeys(this.$("aside.left"), { close: _closeDrawer, modal: true,' in p
    assert "if (this._drawerHold) { const h = this._drawerHold; this._drawerHold = null; h(); }" in p
    # More opens it the same way as ☰.
    assert "} else if (this._openDrawer) {\n          this._openDrawer();" in p.replace("\r\n", "\n")
    m = _src("views/maps.js")
    assert "KEYS.holdKeys(card, { close: dismiss, take: first || !KEYS.deepActive(), opener: null })" in m
    assert 'x.addEventListener("click", dismiss);' in m


def test_a_redraw_puts_the_focus_on_the_replacement():
    """A view drawn again replaced the focused control and the focus fell to
    the page; the panel now finds the replacement (dialog_keys.refocus)."""
    p = _src("panel.js").replace("\r\n", "\n")
    swap = p[p.index("const _refocus = _focused && this.$content.contains(_focused)"):]
    swap = swap[:swap.index("// Restore scroll after DOM paint")]
    assert 'this.$content.innerHTML = "";' in swap and "DIALOG_KEYS.refocus(_refocus)" in swap
