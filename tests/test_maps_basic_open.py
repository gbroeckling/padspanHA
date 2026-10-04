"""Mapping → Library → Open in Basic mode (Jay, 2026-10-04).

Basic mode shows only the Library and Upload tabs, and maps.js's render()
puts any other tab straight back to Library — so Open (which goes to the Edit
tab) did nothing at all in Basic mode, with no sign why. It now switches to
Advanced, says so, and opens the plan (tests/js/maps_basic_open.mjs drives the
real view). The same silent bounce hit two Advanced-mode links into
Development-only views (the calibration wizard's quality report → QA, the
Atlas's "Build from relays" → Devices); panel.js lets those two views stay
open when reached by link.
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
def test_open_in_basic_mode_switches_to_advanced_and_opens_the_plan() -> None:
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "maps_basic_open.mjs"), str(_WWW / "views")],
                         capture_output=True, text=True, timeout=120)
    assert res.returncode == 0, res.stderr[-2000:]
    got = json.loads(res.stdout.strip().splitlines()[-1])
    assert len(got) >= 7, got
    bad = {k: v for k, v in got.items() if not v["ok"]}
    assert not bad, bad


def test_the_mode_switch_is_one_door() -> None:
    """The top toggle, Mapping's Open and the setup wizard all change the
    mode through _setComplexity, which also repaints the button and the menu
    (the wizard used to set the mode behind the menu's back)."""
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert "setComplexity: (mode)=>this._setComplexity(mode)," in panel
    assert 'this._setComplexity(cur === "basic" ? "advanced"' in panel
    assert 'localStorage.setItem("padspan_complexity"' not in maps
    assert maps.count("=>_openForEdit(ctx, ") == 2          # Open and "Review map"
    assert "ctx.actions.setMapsTab('edit')" not in maps


def test_links_into_development_views_are_not_bounced() -> None:
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    line = next(l for l in panel.splitlines() if l.startswith("const _VIEW_PATHS_HIDDEN_OK"))
    for view in ("qa", "devices"):
        assert f'"{view}"' in line, view
