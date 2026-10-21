# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas temperature / humidity / CO2 heatmap (views/atlas_heatmap.js).

tests/js/atlas_heatmap.mjs runs the module for real: buildIsoSVG
byte-identical with the heatmap absent, null, false or unknown; the readings
each kind takes and their freshness; the colour scales' ends; where the
sources come from; the drawing clipped per room, small and cheap; the layer
chip. The rest is held here: the module is loaded optionally, so a failure
leaves the Atlas as it was, and its errors are attributed.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def harness() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "atlas_heatmap.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_every_case_in_the_harness_passes(harness) -> None:
    assert not harness["failures"], json.dumps(harness["failures"][:6], indent=2, ensure_ascii=False)


@pytest.mark.parametrize("prefix,least", [
    ("contract:", 2), ("readings:", 1), ("colours:", 1), ("sources:", 1), ("drawing:", 3), ("chip:", 1),
])
def test_the_harness_covers_each_part(harness, prefix, least) -> None:
    got = [k for k in harness["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    assert all(harness["cases"][k] for k in got), [k for k in got if not harness["cases"][k]]


def test_the_module_is_optional_and_cache_busted() -> None:
    """A heatmap that fails to load must not take the Atlas with it."""
    src = (_VIEWS / "iso_lights.js").read_text(encoding="utf-8")
    assert "await import(`./atlas_heatmap.js${new URL(import.meta.url).search}`).catch(() => null);" in src
    assert 'from "./atlas_heatmap.js"' not in src


def test_its_errors_are_attributed() -> None:
    assert "atlas_heatmap" in T.UI_ERROR_HELPERS


def test_off_by_default_in_both_hosts() -> None:
    panel = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "localStorage.getItem(LS_HEAT)||null" in panel
    assert "heatmap: mapState._lightsHeatmap || null," in maps
