# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Calibration opens on Results (interface review item 13, 2026-10-30).

tests/js/calibration_results.mjs renders the shipped calibration.js under
the DOM shim: results with data (the held-out score, rooms worst first, the
next best thing and its button), an empty house, Sample mode, deep links to
every other tab, and nextAction()'s priority order. The source checks here
hold the tab to reading only: it never saves, computes or deletes.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _read(rel: str) -> str:
    return (_WWW / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "calibration_results.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [("data:", 10), ("empty:", 4), ("sample:", 3), ("link:", 10), ("priority:", 12)])
def test_the_results_tab(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_results_never_writes_calibration() -> None:
    src = _read("views/calibration_results.js")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))
    for w in ("calibrationSavePoint", "calibrationDeletePoint", "calibrationClear", "calibrationComputeModel",
              "calibrationSwapRadio", "calibrationRelearnRadio", "calibration_save", "calibration_delete",
              "calibration_clear", "calibration_compute", "settingsSet", "settings_set", "modelUpdate"):
        assert w not in code, w
    # The one server call it makes is the read-only setup tips.
    assert re.findall(r'type: "([a-z_/]+)"', code) == ["padspan_ha/setup_tips"]
    # And calibration.js hands it nothing that writes.
    cal = _read("views/calibration.js")
    hand = cal[cal.index('if (cs.tab === "results") root.appendChild(renderResults('):]
    hand = hand[:hand.index("}));") + 4]
    for w in ("Save", "Clear", "Compute", "Delete", "callWS"):
        assert w not in hand, w


def test_calibration_opens_on_results_and_keeps_every_tab() -> None:
    cal = _read("views/calibration.js")
    assert 'tab:        "results",' in cal
    tabs = re.search(r"const TABS = \[(.+?)\];\n", cal).group(1)
    assert re.findall(r'\["([a-z]+)","([^"]+)"\]', tabs) == [
        ("results", "Results"), ("tune", "Tune"), ("beacon", "Beacon Tune"), ("setup", "Beacon and floor"),
        ("pin", "Pin & Listen"), ("roam", "Roam"), ("model", "Model"), ("matrix", "Accuracy by spot")]
    assert 'TABS.push(["walk", "Walk a room"])' in cal


def test_links_and_fixes_ask_for_their_tab() -> None:
    panel = _read("panel.js")
    assert 'if (reqView === "calibration" && reqTab && /^[a-z]+$/.test(reqTab)) this.state._calibTabRequest = reqTab;' in panel
    assert 'this.state._calibTabRequest = "tune";' in panel                       # the accuracy tip
    assert "if (s.calibTab) this.state._calibTabRequest = s.calibTab;" in panel   # Getting started
    assert "_calib.tab = " not in panel
    assert 'ctx.state._calibTabRequest = "beacon";' in _read("views/maps.js")


def test_the_report_counts_openings_and_actions() -> None:
    src = _read("views/calibration_results.js")
    kinds = json.loads(re.search(r"export const ACTION_KINDS = (\[.+?\]);", src, re.S).group(1))
    assert tuple(kinds) == T.CAL_RESULTS_ACTIONS
    for k in kinds:
        assert T.event_allowed(f"cal_results_action:{k}"), k
    assert T.event_allowed("cal_results_opened")
    assert not T.event_allowed("cal_results_action:Kitchen") and not T.event_allowed("cal_results_action:")
    assert '"cal_results_action:" + kind' in src
    assert 'ctx.actions.telemetryEvent("cal_results_opened")' in _read("views/calibration.js")
    ib = _read("views/installbase.js")
    assert 'a === "cal_results_action"' in ib and "cal_results_opened:" in ib
