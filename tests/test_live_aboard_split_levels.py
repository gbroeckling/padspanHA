# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard's split levels (Garry, 2026-10-28: "The floor above is 2.3
meters in the livingroom, just over 3 meters to my office"; "Some of these
houses are gigantic").

tests/js/live_aboard_split_levels.mjs runs views/live_aboard_house.js
splitLevels and views/live_aboard_storey.js for real under node: rooms raised
alike share a level, what is in them moves onto it, the ceiling stays level
under a higher floor, a sunken room, the level shown and exploded with its
floor, stairs climbing into a raised room and out of a sunken one, the stem
wall, and a 720-room house read in good time with every stair on its level.
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
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_split_levels.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("split:", 4), ("floors:", 3), ("stairs:", 3), ("stem:", 1), ("big:", 1)])
def test_split_levels(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_the_view_reads_split_levels_before_anything_else() -> None:
    src = (_WWW / "views" / "live_aboard.js").read_text(encoding="utf-8")
    assert "HOUSE.splitLevels(p.model)" in src
    # Every save from Edit and Furnish goes through editSave, which stores whole floors only.
    assert "const ch = HOUSE.wholeFloors ? HOUSE.wholeFloors(ch0) : ch0;" in src
    assert src.count("editSave") == 2 and "editor.setEdit(typeof p.edit === \"function\" ? editSave : null)" in src
