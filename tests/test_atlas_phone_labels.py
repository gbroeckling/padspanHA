# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The flat Atlas on a phone, and its room names kept readable (2026-11-21).

The owner: on a phone the map sat in a card about 260 px wide beside a column
of round buttons, so the house was a thumbnail; and room names were drawn at
one spot whatever landed on top ("LARDER" under a strip light, "WALK-IN
CLOSET" under Sam's badge, "LIVING ROOM" under "Jordan · Guest").

tests/js/atlas_phone_labels.mjs runs it: the map's width worked out from the
real style sheets for a 390 px phone, a desk and a wall; every room name on
every floor, plain and in every Showcase theme, against lit fixtures and codes
drawn over it; and the people layer moving a name off a badge or a tag's name.
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
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_phone_labels.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix", ["phone:", "names:", "people:"])
def test_each_part(run, prefix) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert got, f"no {prefix} case ran: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:3], indent=2, ensure_ascii=False)[:4000]


def test_the_phone_map_is_as_wide_as_the_phone(run) -> None:
    assert run["cases"].get("phone: the map has the phone's width, the rail a row above it") is True, run["failures"][:2]


def test_no_room_name_is_under_a_badge_or_a_tags_name(run) -> None:
    assert run["cases"].get("people: a name a person or a tag's name lands on moves off them, and back once they leave") is True, run["failures"][:2]
