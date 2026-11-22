# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A clickable <span> is worked from the keyboard.

A name that opens a device, a chip that opens a room, "Hide", "Go →": several
places draw one as a <span> with a click listener, which Tab never reached and
no key worked. Each now carries panel.js's asButton (role="button",
tabindex="0", and a key handler that clicks the element on Enter or Space),
so the key does exactly what the click does.

tests/js/keyboard_buttons.mjs renders Radio QA, Monitor, Presence, Devices and
Mapping with panel.js's own el() and asButton, and presses every such span
three ways. What that harness cannot draw (Calibration's two banners are
written as markup, which the DOM stand-in does not parse) is held here by its
source; the Overview's accuracy tips are pressed in tests/js/accuracy_tips.mjs.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _src(name: str) -> str:
    return (_WWW / name).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "keyboard_buttons.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-3000:]
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_enter_and_space_do_what_a_click_does(run: dict) -> None:
    seen = run.pop("_seen")
    bad = {k: v for k, v in run.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=1, ensure_ascii=False)[:3000]
    # every view drew its spans, and each was pressed
    views = {k.split(" ")[0] for k, v in seen["seen"].items() if v}
    assert views == {"qa", "monitor", "presence", "objects", "devices", "maps"}, seen
    assert seen["total"] >= 15, seen
    assert sum(1 for k in run if "Enter and Space do what the click does" in k) >= seen["total"]


def test_the_helper_is_handed_to_the_views() -> None:
    panel = _src("panel.js")
    helpers = panel[panel.index("      helpers: {"):]
    assert re.search(r"\n\s+asButton,\n", helpers[:400])
    # the same rule as the two keyboard-operable <div>s that were there before: Enter or Space, and the key is taken
    body = panel[panel.index("const asButton = Object.freeze({"):]
    body = body[:body.index("\n});\n")]
    assert 'role: "button"' in body and 'tabindex: "0"' in body
    assert 'e.key !== "Enter" && e.key !== " "' in body and "e.preventDefault();" in body and "n.click();" in body


def test_every_clickable_span_in_the_panel_itself_has_it() -> None:
    panel = _src("panel.js")
    for marker in ('"data-accuracy-tips": "off", ...asButton', '"aria-label": t("Hide this tip"), ...asButton',
                   '"data-getting-started":"dismiss",...asButton', '"data-getting-started":"setup",...asButton',
                   '"data-setup-line":"open",...asButton', '"data-setup-line":"hide",...asButton'):
        assert panel.count(marker) == 1, marker


def test_calibrations_cancel_links_are_buttons_too() -> None:
    """Radios → place and Beacon Tune → place: "Cancel" in the banner, written as markup."""
    cal = _src("views/calibration.js")
    for ident in ("_cancelPlace", "_cancelBkPlace"):
        assert f'<span role="button" tabindex="0" style="color:#94a3b8;cursor:pointer;text-decoration:underline" id="{ident}">${{_esc(t("Cancel"))}}</span>' in cal
        i = cal.index(f'const cancelEl = placeBanner.querySelector("#{ident}");')
        nxt = cal[i:i + 400]
        assert 'if (cancelEl) cancelEl.addEventListener("keydown", ctx.helpers.asButton.onkeydown);' in nxt
        assert 'if (cancelEl) cancelEl.addEventListener("click", () => {' in nxt


def test_live_trackers_locate_target_takes_it_through_its_template() -> None:
    pure = _src("views/purelive.js")
    assert '<span ...${ctx.helpers.asButton} className="pl-tracked-locate" title="Center camera on ${d.label}"' in pure


def test_no_view_writes_the_three_lines_out_by_hand() -> None:
    """One helper, used by every clickable span: a span given a click and its own role is one that missed it."""
    for path in sorted(_WWW.rglob("*.js")):
        if "vendor" in path.parts or "lib" in path.parts:
            continue
        src = path.read_text(encoding="utf-8")
        hand = re.findall(r'el\("span",\s*\{[^{}\n]*role:\s*"button"[^{}\n]*\}', src)
        assert not hand, (path.name, hand)
