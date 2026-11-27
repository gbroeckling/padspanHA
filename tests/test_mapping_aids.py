"""Drawing rooms in Mapping → Edit and Layout (2026-11-18).

tests/js/mapping_aids.mjs runs views/room_snap.js and both editors in views/maps.js: a corner lands on another room's
corner, else its edge, else a 5 cm grid, Alt places it freely and a scanned wall end still comes first; Straighten
edges makes an edge less than 5 cm off straight and moves a corner another room shares with it; rooms drawn over each
other are named from the server's one check (setup_checks.overlapping_pairs, tests/test_setup_checks.py). What can only
be read from here is below.
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


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_snapping_straightening_and_overlaps_in_both_editors() -> None:
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "mapping_aids.mjs"), str(_WWW / "views")],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(got) >= 35, got
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, bad


def test_one_overlap_check_and_sample_mode_reads_it() -> None:
    """The panel asks the server's check and keeps no copy of its own; Sample mode treats the question as a read."""
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert maps.count('ctx.actions.wsCall("padspan_ha/rooms_overlap"') == 1 and maps.count("_overlapNote(ctx, ") == 3   # its definition, Edit and Layout
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    reads = panel[panel.index("const READS = new Set("):panel.index('.split(" ").map(t => "padspan_ha/" + t));')]
    assert " rooms_overlap " in reads
    # The new helper's own errors reach the report like every other's.
    from custom_components.padspan_ha import telemetry as T
    assert "room_snap" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:room_snap")
