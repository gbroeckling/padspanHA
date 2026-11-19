"""The Atlas's hold card and room sheet, picked from the comparison with
NeonPlan 3D (2026-11-18).

tests/js/atlas_controls.mjs runs views/lights_map.js under the DOM shim:
Unlock asks "Unlock {name}?" first wherever it is pressed (a tap's toggle,
the room sheet's lock row, the hold card, a door's barrier card) and sends
nothing on Cancel, while Lock never asks; a white bulb that goes warm to cool
gets a colour temperature slider over its own range and, with no colour,
Warm and Cool chips; an unavailable light says "Unavailable" with its
controls greyed out; Details opens Home Assistant's own dialog; the room
sheet says who PadSpan places in the room, offers All on / All off only when
they would change something and never to an unavailable light, greys out
unavailable rows, follows newer states while open, and a row whose switch
failed shows its old word again.
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
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_controls.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout + res.stderr
    return json.loads(lines[-1])


def test_every_atlas_controls_case_passes(run: dict) -> None:
    assert len(run["cases"]) >= 30, run
    assert not run["failures"], json.dumps(run["failures"], indent=2, ensure_ascii=False)


def test_both_hosts_keep_an_open_room_sheet_live() -> None:
    """The sheet follows newer states only if its host hands them over on
    every render: the sidebar Atlas (and Live Aboard through it) and the
    Mapping tab's preview each keep the handle openRoomSheet returns."""
    panel = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "api.openRoom=(room, onlyEids)=>{ this._roomSheet=openRoomSheet(api, lights, room, onlyEids); };" in panel
    assert "if(this._roomSheet && !this._roomSheet.update(this._useApi(lightsByEid, lights), lights)) this._roomSheet=null;" in panel
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert "previewApi.openRoom = (room, onlyEids) => { mapState._roomSheet = openRoomSheet(previewApi, lights, room, onlyEids); };" in maps
    assert "if (mapState._roomSheet && !mapState._roomSheet.update(previewApi, lights)) mapState._roomSheet = null;" in maps
