# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas's buttons in German keep their own state, RUN (tests/js/atlas_sheet_german.mjs).

Review of PR #107: with German loaded the room sheet's On/Off button read its
state back from its label ("On"), so a light switched off kept showing "An";
the lock compared against "Unlock" the same way. And no panel code may compare
what an element shows with an English literal, since that text is translated.
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
_SCRIPT = Path(__file__).parent / "js" / "atlas_sheet_german.mjs"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run():
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["german", "light", "lock"])
def test_atlas_sheet_german(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


_SHOWN_VS_LITERAL = re.compile(r"""\.(?:textContent|innerText)\s*[!=]==?\s*["'`]\w""")


def test_no_panel_code_compares_shown_text_with_english():
    hits = []
    for p in sorted(_WWW.rglob("*.js")):
        if "vendor" in p.parts:
            continue
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if _SHOWN_VS_LITERAL.search(line):
                hits.append(f"{p.relative_to(_WWW)}:{n}: {line.strip()[:160]}")
    assert not hits, "keep the state apart from its translated label:\n" + "\n".join(hits)
