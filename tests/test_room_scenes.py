"""The room sheet's scenes (0.38.128): the room's own Home Assistant scenes and
scripts as one-tap buttons, as neonplan3d's room panel offers them.

tests/js/room_scenes.mjs runs views/lights_map.js under the DOM shim:
roomScenes picks the room's scenes by the entity's area or its device's,
sorted, at most six, never hidden, disabled or unavailable ones; the sheet
shows a ▶ button per scene and a tap runs it through Home Assistant.
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
    if not _NODE:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "room_scenes.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout + res.stderr
    return json.loads(lines[-1])


def test_every_room_scenes_case_passes(run: dict) -> None:
    assert len(run["cases"]) >= 4, run
    assert not run["failures"], json.dumps(run["failures"], indent=2, ensure_ascii=False)
