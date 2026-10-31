# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The maker lookup's switch and labels in the Objects list, run in node.

tests/js/maker_lookup_switch.mjs opens the list from the Overview, reads every
row's Maker cell and what the panel asked the server, and flips the switch:
- on (the default): each address shows its own answer, never one kept for its
  first three bytes; a random address (the server says so, or its bits do), a
  private BLE row and nothing else say "random address"; an iBeacon row is n/a;
  only rows whose bits are clear are asked about; a row the server says wasn't
  heard recently shows the answer kept for its prefix, or "not heard recently";
- off: the switch saves it, the list reopens, every Bluetooth row says
  "Lookup off" and nothing is asked;
- only an administrator can use the switch.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def test_the_objects_list_maker_column_and_switch() -> None:
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "maker_lookup_switch.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [json.loads(ln) for ln in r.stdout.splitlines() if ln.startswith("{")]
    summary = next((ln for ln in lines if ln.get("summary")), None)
    assert summary is not None, f"no result from the harness:\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}"
    failed = [ln["case"] for ln in lines if ln.get("ok") is False]
    assert r.returncode == 0 and not failed, f"{failed}\n{r.stderr[-3000:]}"
    assert summary["cases"] >= 20
