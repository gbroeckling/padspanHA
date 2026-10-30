# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The guided Setup (views/setup.js): one ordered sequence over the existing
setup tools — plan, scale, floors and heights, rooms, receivers and their
heights, calibration.

tests/js/guided_setup.mjs runs the view under the DOM shim: the current step
for a house at every stage, resume, skip, each step opening its own tool, the
bar back and the report's counters. Here: the step list is the server's, the
stored progress is cleaned, the counters are allowed, and the entry points
(Overview's Getting started, Mapping, Who's where) lead to it while the old
wizards stay where they were.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import setup_checks, telemetry
from custom_components.padspan_ha import ws_settings as WS

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _read(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "guided_setup.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("derive:", 12), ("resume:", 3), ("skip:", 4), ("view:", 7),
                                          ("open:", 7), ("bar:", 3), ("done:", 3)])
def test_the_setup(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_the_steps_are_the_servers() -> None:
    m = re.search(r"export const SETUP_STEPS = \[([^\]]*)\]", _read("views/setup.js"))
    assert m and tuple(re.findall(r'"([a-z_]+)"', m.group(1))) == setup_checks.SETUP_STEPS


def test_the_calibration_threshold_is_the_stores() -> None:
    assert "export const CAL_POINTS_NEEDED = 5;" in _read("views/setup.js")
    src = (_ROOT / "custom_components" / "padspan_ha" / "calibration_store.py").read_text(encoding="utf-8")
    assert "if points < 5:" in src


def test_stored_progress_is_cleaned() -> None:
    c = setup_checks.clean_setup_progress
    assert c({"at": "rooms", "skipped": ["calibration", "scale", "x", 3], "done": True}) == \
        {"at": "rooms", "skipped": ["scale", "calibration"], "done": True}
    assert c({"at": "<script>", "skipped": "scale", "done": 1}) == {"at": None, "skipped": [], "done": False}
    assert c("nonsense") == {"at": None, "skipped": [], "done": False}
    src = (_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("setup_progress"): dict' in src
    assert 'payload["setup_progress"] = clean_setup_progress(msg["setup_progress"])' in src
    # Like onboarding_completed: the panel writes it as anyone goes through setup.
    assert "setup_progress" in WS._EVERYONE_KEYS


def test_the_report_counts_steps_skips_and_finishing() -> None:
    for s in setup_checks.SETUP_STEPS:
        assert telemetry.event_allowed(f"setup_step:{s}") and telemetry.event_allowed(f"setup_skip:{s}")
    assert telemetry.event_allowed("setup_done")
    for e in ("setup_step:other", "setup_skip:", "setup_done:x", "setup_step:plan:1"):
        assert not telemetry.event_allowed(e), e
    assert "setup" in telemetry.VIEWS          # tab:setup and ui_error:setup


def test_entry_points() -> None:
    panel = _read("panel.js")
    assert 'setup:        "./views/setup.js",' in panel
    assert '"devices", "setup"]);' in panel                    # reached by link, never a menu tab
    assert '["setup",' not in panel[panel.index("const MENU = ["):panel.index("];", panel.index("const MENU = ["))]
    assert "showView: (id) => {" in panel
    # The Overview's Getting started: Open Setup, and each step's bar back to it.
    assert '{"data-getting-started":"setup"' in panel and 'this.state.view = "setup";' in panel
    assert 'scanners: "receivers", calibrate: "calibration" }[s.id] || null;' in panel
    assert "VIEWS.setup.returnBar(this._ctx())" in panel
    assert "this.state._setupReturn = null;   // a menu pick" in panel
    # Mapping: a Setup button beside Refresh, the tab bar as it was.
    maps = _read("views/maps.js")
    assert '"data-setup-link":"maps"' in maps and 'onclick:()=>ctx.actions.showView("setup")}, "Setup")' in maps
    assert '[["library","Library"],["upload","Upload"],["edit","Edit"],["stack","3D Stack"],["rooms","Rooms"],["lights","Atlas"],["export","Export"],["help","Help"]]' in maps
    # A new install's Who's where: Make it a map lands in Setup.
    assert 'mapBtn.addEventListener("click", () => ctx.actions.showView("setup"));' in _read("views/whos_where.js")
    # No floor plans yet: one way in, not two. The empty state's Start Setup
    # Wizard is Setup's first step (the wizard at step 1, with the bar), and
    # the header's Setup is left out over it; a build without Setup (Bright)
    # opens the wizard as before.
    assert 'const _noPlansYet = activeTab === "library" && !maps.length && ctx.state.dataMode === "live";' in maps
    assert "...(_setupShown && !_noPlansYet" in maps
    start = maps.split('startBtn.setAttribute("data-maps-start", "setup");')[1].split("empty.appendChild(startBtn);")[0]
    assert 'ctx.actions.openSetupStep("plan");' in start and "ctx.state._mapsWizard = { step: 1, mapId: null };" in start
    assert 'openSetupStep: (id)=>{' in panel and "m.openStep(this._ctx(), id)" in panel
    # The old wizards stay reachable directly.
    assert '"Start Setup Wizard"' in maps and '"+ Add a floor"' in maps
    assert "🧭 Guided calibration" in _read("views/calibration.js")


def test_classified_for_bright() -> None:
    assert 'setup:       "presence",' in _read("views/editions.js")
