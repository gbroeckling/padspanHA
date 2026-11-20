# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The shared escape covers both quotes, and is used only where markup is built.

panel.js's esc() is handed to every view as ctx.helpers.esc. A name written
into a quoted attribute (title="…", data-id='…') must stay inside it, so esc
turns both kinds of quote into entities as well as & < >.
tests/js/esc_quotes.mjs runs the function read out of panel.js.

An entity only means something in markup. el() and textContent take plain
text, so a name passed through esc on its way to one of those would show its
entities on screen ("Sam&#39;s phone"): the second test holds the views to
never doing that.
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


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_esc_escapes_both_quotes_and_keeps_a_value_inside_its_attribute() -> None:
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "esc_quotes.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr[-2000:]
    out = json.loads(res.stdout.strip().splitlines()[-1])
    assert out["each"] == "&amp;&lt;&gt;&quot;&#39;"
    assert out["plain"] == "Kitchen ESP32 (40%)"
    assert out["empty"] == ["", "", ""]
    assert out["number"] == "42"
    # escaping what is already escaped shows the entity: a caller escapes once
    assert out["twice"] == "&amp;quot;"
    assert not any(out["rawQuotesLeft"])
    assert all(out["doubleQuoted"]) and all(out["singleQuoted"]) and all(out["asText"])


def _shared_esc_names(src: str) -> set[str]:
    """The names a file calls the shared esc by: esc, a rename (esc: _esc), ctx.helpers.esc."""
    names = {"ctx.helpers.esc"}
    for m in re.finditer(r"\{([^{}]*)\}\s*=\s*ctx\.helpers", src):
        for part in m.group(1).split(","):
            bits = [b.strip() for b in part.split(":")]
            if bits[0] == "esc":
                names.add(bits[-1])
    if re.search(r"\besc\s*=\s*ctx\.helpers\.esc\b", src):
        names.add("esc")
    return names


def test_no_view_escapes_text_it_hands_to_el() -> None:
    """el(tag, attrs, text) makes a text node: text escaped for it shows its entities."""
    seen = 0
    for path in sorted(_WWW.rglob("*.js")):
        if "vendor" in path.parts:
            continue
        src = path.read_text(encoding="utf-8")
        for name in _shared_esc_names(src) if path.name != "panel.js" else {"esc"}:
            call = re.escape(name) + r"\("
            seen += len(re.findall(r"(?<![\w.])" + call, src))
            # el("pre", {...}, esc(x))  /  el("span", {...}, [ ..., esc(x) ])  /  .textContent = esc(x)
            bad = re.findall(r"\}\s*,\s*\[?\s*" + call + r"[^\n]{0,60}", src)
            bad += re.findall(r"\.(?:textContent|innerText|title|value)\s*=\s*" + call + r"[^\n]{0,60}", src)
            bad += re.findall(r"createTextNode\(\s*" + call + r"[^\n]{0,60}", src)
            assert not bad, (path.name, bad)
    assert seen >= 10, seen   # the scan found the calls it is about
