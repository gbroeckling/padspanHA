# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A JSON restore has to write each map's alignment onto that map.

It uploaded the image and then located what it had just created by NAME —
`find(m => m.name === bm.name)`, first match wins over a list the upload had
just appended to. Two maps of the same name in one backup, or two unnamed ones
(both become "Restored Map"), and the second map's stack, calibration and
notes land on the first while the second keeps a default stack. A stack is the
whole of a map's alignment, so this is one map silently wearing another's
placement, with nothing in the data to say so and nothing to undo it from.

The name is not the identity. `maps_upload` replies with the map it made and
the Upload tab already reads `uploadRes?.map?.id`; the restore reads the same.

Checked by RUNNING the shipped loop body, not by grepping it: node lifts it out
of maps.js and drives it with a ctx whose mapsUpload creates a map with its own
id and appends it to the list the old code searched.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "restore_by_id.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

# One backup, two maps that answer to the same name, each with its own
# alignment — and a third with no name at all, which the restore calls
# "Restored Map" like every other unnamed map in the file.
_BACKUP = [
    {"name": "Ground", "image": {"filename": "a.png", "width": 1600, "height": 1200},
     "png_base64": "AA", "floor_id": "main", "notes": "first",
     "calibration": {"mode": "none"},
     "stack": {"z_level": 0, "x_offset": 0.0, "rotation": 0}},
    {"name": "Ground", "image": {"filename": "b.png", "width": 1600, "height": 1200},
     "png_base64": "BB", "floor_id": "upper", "notes": "second",
     "calibration": {"mode": "reference"},
     "stack": {"z_level": 1, "x_offset": 0.42, "rotation": 30.0}},
    {"image": {"filename": "c.png", "width": 800, "height": 600},
     "png_base64": "CC", "floor_id": "attic", "notes": "third",
     "calibration": {"mode": "none"},
     "stack": {"z_level": 2, "x_offset": -0.9, "rotation": 12.0}},
    {"image": {"filename": "d.png", "width": 800, "height": 600},
     "png_base64": "DD", "floor_id": "attic", "notes": "fourth",
     "calibration": {"mode": "none"},
     "stack": {"z_level": 3, "x_offset": 0.31, "rotation": -7.0}},
]


@pytest.fixture(scope="module")
def result(tmp_path_factory) -> dict:
    path = tmp_path_factory.mktemp("restore") / "backup.json"
    path.write_text(json.dumps(_BACKUP), encoding="utf-8")
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS), str(path)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in (res.stdout or "").strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not a restore bug:\n"
        f"{(res.stderr or '')[-3000:]}"
    )
    return json.loads(lines[-1])


def test_the_restore_reads_the_id_the_upload_returned(result) -> None:
    assert not result["failures"], json.dumps(result["failures"], indent=2)


def test_every_map_gets_its_own_alignment(result) -> None:
    """Four maps, four uploads, four updates, each on the map it belongs to."""
    created = result["created"]
    updates = result["updates"]
    assert len(created) == len(_BACKUP)
    assert len(updates) == len(_BACKUP), "a map was restored without its alignment"

    for made, upd, bm in zip(created, updates, _BACKUP):
        assert upd["map_id"] == made["id"], (
            f"the alignment for {bm.get('notes')!r} went to {upd['map_id']}, "
            f"not to the map the upload created ({made['id']})"
        )
        assert upd["stack"] == bm["stack"]
        assert upd["notes"] == bm["notes"]
        assert upd["calibration"] == bm["calibration"]


def test_the_fixture_really_does_collide_on_name(result) -> None:
    """Otherwise the test above passes on four distinct names and proves
    nothing: two maps share "Ground" and two more are both "Restored Map"."""
    names = [c["name"] for c in result["created"]]
    assert names.count("Ground") == 2
    assert names.count("Restored Map") == 2
    # ...and finding by name would have sent every one of them to the first.
    for name in ("Ground", "Restored Map"):
        firsts = [c["id"] for c in result["created"] if c["name"] == name]
        assert len({u["map_id"] for u in result["updates"]
                    if u["map_id"] in firsts}) == 2, (
            f"both {name!r} maps were written through one id"
        )
