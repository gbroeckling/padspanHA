# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Rooms page in PadSpan Bright (Garry, 2026-10-30: "Bright should get a
rooms page, but only items on it that apply to Bright functionality").

Bright keeps each room's colour, outline (Mapping → Edit, which Bright has),
ceiling height and split level (Mapping → Rooms' own fields, used by Live
Aboard), and gains the lights in the room as the Atlas counts them. Receivers
and who is in it now are presence and stay out, unless Bright's reveal switch
shows the presence screens. tests/js/rooms_bright.mjs runs it for real.
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
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "rooms_bright.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("bright:", 9), ("same:", 2), ("full:", 1), ("reveal:", 1), ("menu:", 4),
])
def test_the_rooms_page_in_bright(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_rooms_is_a_lighting_surface() -> None:
    src = (_WWW / "views" / "editions.js").read_text(encoding="utf-8")
    assert 'rooms:       "lighting",' in src
