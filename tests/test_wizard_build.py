# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Setup Wizard's "Put it on the map" (views/wizard_build.js).

Finishing the wizard used to leave every room and scanner on the picture
alone, so the Overview still had no house. tests/js/wizard_build.mjs runs
the module with the real Tune planner and conversions: only what the fabric
lacks is written, the way Mapping → Rooms and Calibration → Tune write it.
Held here: the button is the only way it runs, and the module imports
nothing (the photo-free views stay photo-free)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "wizard_build.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)
    assert len(harness["cases"]) >= 15


def test_the_module_imports_nothing_and_never_reads_the_plan() -> None:
    src = _src(_WWW / "views" / "wizard_build.js")
    assert not re.search(r"^\s*import\b|\bimport\(", src, re.M)
    code = "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))
    for photo_field in ("room_bounds", "map_transforms", "receivers"):
        assert photo_field not in code, photo_field


def test_only_the_finish_buttons_click_runs_it() -> None:
    maps = _src(_WWW / "views" / "maps.js")
    assert maps.count("buildHouse(ctx") == 1
    assert "const r = await buildHouse(ctx, traced, { planPins, refresh: () => ctx.actions.modelRefresh() });" in maps
    assert '"Put it on the map"' in maps
    # The planner gets this module's own conversions, the ones the editor draws with.
    assert "if (TSP) TSP.tuneSavePlanInit({ mapFracToMetres, metresToMapFrac });" in maps


def test_never_from_the_demo_house_and_never_a_disputed_scanner() -> None:
    """#88: in Sample mode the wizard's scanner list is the demo house's, and
    a Put it on the map then would make phantom scanners in the real fabric."""
    maps = _src(_WWW / "views" / "maps.js")
    assert "const writeBlock = TSP ? TSP.tuneWriteBlock(ctx.state) : null;" in maps
    assert "if (writeBlock) {" in maps
    # Only scanners Home Assistant hears now.
    assert "scanners: (map.receivers || []).map(r => r && r.source).filter(src => src && liveSources.has(src))," in maps
    # Every plan's pins planned; a scanner two plans disagree about refused on both.
    assert "const bad = new Set(TSP.tuneConflictingSources(all));" in maps
    assert "for (const m of (ctx.state.maps?.list || [])) {" in maps


def test_a_failed_load_never_blanks_mapping() -> None:
    maps = _src(_WWW / "views" / "maps.js")
    assert ".catch(() => ({ planHouse: null, buildHouse: null }));" in maps
    assert "const TSP = await import(`./tune_save_plan.js${new URL(import.meta.url).search}`).catch(() => null);" in maps
