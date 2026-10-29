# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Overview's accuracy tips card (panel.js _accuracyTipsCard, 0.38.193).

tests/js/accuracy_tips.mjs lifts the method out of panel.js and runs it
under the DOM shim: nothing until the server answers, a line per tip counted
once as shown, never for a non-administrator, a wall screen, sample mode or
a hidden card, × hides one tip, Hide these tips hides the card for good, and
each fix opens its own place (Maps 3D Stack, Calibration Tune, the map
wizard's Measure step).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "accuracy_tips.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("shown:", 2), ("hidden:", 1), ("hide:", 2), ("fix:", 1)])
def test_the_card(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_it_is_last_in_line_on_the_overview() -> None:
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    slot = src[src.index("const _ms = this._proInviteOverviewCard()"):][:600]
    assert "if (_ms) frag.appendChild(_ms);" in slot and "else { const _tips = this._accuracyTipsCard();" in slot
