# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""#88: the demo house's radios under a "Live" badge, RUN rather than read.

A live install's Guided Calibration listed Living Room Hub / Bedroom Hub /
Kitchen Hub (sample_data.js) while the top bar read "Live", and told the user
to "Switch to Live mode" while already in it. panel.js starts with dataMode
"sample"; a failed first settings fetch left that default standing,
_getLiveSnapshot took it as the server's answer and put SAMPLE_SNAPSHOT up, a
later successful settings fetch flipped the badge to Live without evicting it,
and every failed live_snapshot kept it. Placing a demo radio and pressing Save
then wrote a phantom scanner into the real model.

tests/js/demo_snapshot_live.mjs runs the real panel.js data-mode / snapshot
methods against a fake websocket (the failing-then-succeeding settings fetch
and the failing live_snapshot of conditions C and C2), then renders the real
Guided Calibration step 1 from calibration.js and clicks it: the empty-list
message per state, and a demo radio refused for placement and for Save. The
normal Live path and a deliberate switch to Sample run as controls.

Follow-up: while every settings_get so far had failed, the top bar still read
"Sample" (the constructor default) over an empty screen, and nothing re-asked
on a page nobody touches, so a wall kiosk stayed there. The harness runs the
real _updateBadges from the panel.js HTML's starting text, drives the
watchdog's re-ask to recovery, and renders the real overview.js unknown.

Second follow-up (reporter, 2026-09-27): Guided Calibration opened a minute
into an HA restart kept saying "no scanners" after the radios arrived, since
the poll never redrew it; and the top-bar Data button, which shows the
CURRENT mode, put them into Sample when they pressed "Live". The harness runs
the real _pollTick over the state the real calibration.js rendered (one
redraw when the radio set changes, none otherwise, none while a radio waits
to be placed) and the real _onDataModeClick (Live -> Sample asks first and
needs a second click within 3 s; Sample -> Live is one click).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "demo_snapshot_live.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_CASES = [
    # the fix
    "unknown mode (settings_get failed twice) shows no demo data",
    "condition C: settings fail then succeed, live_snapshot failing -> Live with NO demo radios",
    "condition C2: only _loadSettings lands the live mode -> Live with NO demo radios",
    "wizard: Live with no snapshot yet says it is waiting, not 'Switch to Live mode'",
    "wizard: a live snapshot with no radios says HA reports no scanners",
    "wizard: mode not known yet says it is waiting, not 'Switch to Live mode'",
    "wizard: condition C's panel state lists no demo radios under Live",
    "placing a demo radio is refused (no pending placement, no Delete)",
    "saving a placed demo radio is refused (no fabric write)",
    # follow-up: an unknown mode is neither Live nor Sample, and is re-asked
    "badge: before the server answers, neither the top bar nor the mobile pill claims Live or Sample",
    "badge: unknown mode (settings_get failed twice) claims neither Live nor Sample",
    "badge: the mobile pill uses the same label as the top bar",
    "unknown mode is asked again: once HA answers, the watchdog's retry lands Live with the real radios",
    "overview (basic): unknown mode shows the loading state, not the Sample layout",
    "overview (advanced): unknown mode shows the loading state, not the Sample layout",
    # Guided Calibration's capture: the same class as Tune
    "Guided Calibration in Sample mode records no demo radios (Start refuses and says why)",
    "Guided Calibration: a switch to Sample mid-capture records no demo radios",
    # controls: what already worked must keep working
    "normal path: settings and live_snapshot succeed -> Live with the real radios",
    "deliberate switch to Sample still shows the demo; switching back evicts it",
    "a Sample-mode install (server data_mode=sample) shows the demo",
    "wizard: 'Switch to Live mode' still shows in a real Sample mode",
    "Sample mode still renders the demo radios in the list",
    "control: with live data, placing and saving a real radio still works",
    "badge: a known mode still reads Live / Sample",
    "overview (basic): a known Sample mode still says Sample data",
    "overview (advanced): a known Sample mode still says Sample data",
    "control: Guided Calibration in Live mode still records the real radios",
    # second follow-up: the wizard redraws when HA's radios change
    "calibration: radios arriving after the wizard opened redraw it once",
    "calibration: the same radios on every poll are not redrawn",
    "calibration: a radio waiting to be placed is not disturbed by radios arriving",
    "calibration: a redraw a guard held back is asked for again on the next poll",
    "calibration: the poll leaves the other Guided Calibration steps alone",
    # second follow-up: Live -> Sample takes a second click
    "data toggle: one click on Live does not switch to Sample; it asks first",
    "data toggle: two clicks within 3 s switch Live to Sample",
    "data toggle: after 3 s the label goes back and a click only asks again",
    "data toggle: Sample to Live is still one click",
    "data toggle: the '…' (mode not known) button does nothing",
    "data toggle: the top bar and the mobile pill both go through the confirm",
]


@pytest.fixture(scope="module")
def cases() -> dict:
    res = subprocess.run(
        [_NODE, str(_SCRIPT), str(_WWW)],
        capture_output=True, text=True, encoding="utf-8", timeout=120,
    )
    lines = [ln for ln in (res.stdout or "").splitlines() if ln.startswith("{")]
    assert lines, f"harness printed no result:\n{res.stdout}\n{(res.stderr or '')[-2000:]}"
    return json.loads(lines[-1])["cases"]


def test_the_harness_ran_every_case(cases: dict) -> None:
    """A harness that silently stops reaching a case would pass forever."""
    missing = [c for c in _CASES if c not in cases]
    assert not missing, f"case(s) never ran: {missing}"


@pytest.mark.parametrize("case", _CASES)
def test_case(cases: dict, case: str) -> None:
    got = cases.get(case)
    assert got is not None, f"case never ran: {case}"
    assert got["ok"], got.get("detail")


def test_every_calibration_capture_reads_only_a_live_snapshot() -> None:
    """The class, not just the proven path: every capture loop in
    calibration.js (Guided Calibration, Beacon Tune's live timer, the guide
    capture, the receiver reference) refreshes the snapshot and records from
    it, and in Sample mode that is the demo house. Each must read it through
    _recordableSnap, which yields nothing unless the server built it in Live.
    """
    lines = (_WWW / "views" / "calibration.js").read_text(encoding="utf-8").splitlines()
    sites = [i for i, ln in enumerate(lines)
             if re.search(r"await ctx\.actions\.refreshSnapshot(Quiet)?\(\)", ln)]
    assert len(sites) >= 4, f"expected the 4 capture loops, found {len(sites)} refresh sites"
    bad = [i + 1 for i in sites if "_recordableSnap(ctx)" not in "\n".join(lines[i + 1:i + 4])]
    assert not bad, f"calibration.js line(s) {bad}: a capture records from the raw on-screen snapshot"
