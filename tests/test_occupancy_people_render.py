"""The occupancy card and tab are RUN against the estimator's real answer.

The Occupancy tab printed "multiplier undefinedx → undefinedx", a "Total BLE
0" KPI and a history of "?" for months: it read keys the backend never sent,
nothing executed it with a real payload, and `node --check` cannot see a
wrong key. tests/js/occupancy_people.mjs renders the overview card (the
shipped block, evaluated as-is) and views/occupancy.js with the payload the
Python estimator produces for the pinned house in test_occupancy_people.py,
clicks through to the modal, saves a headcount, and fails the moment either
surface prints "undefined", "NaN" or "?". The payload crosses from Python to
node as JSON, so the two sides cannot drift apart without this failing.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from _pytest.monkeypatch import MonkeyPatch

from tests.test_occupancy_people import _estimate, _the_house

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "occupancy_people.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def run(tmp_path_factory) -> subprocess.CompletedProcess:
    mp = MonkeyPatch()
    try:
        estimate = _estimate(_the_house(mp))
    finally:
        mp.undo()
    payload = tmp_path_factory.mktemp("occupancy") / "estimate.json"
    payload.write_text(json.dumps(estimate), encoding="utf-8")
    return subprocess.run(
        [_NODE, str(_SCRIPT), str(_VIEWS), str(payload)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )


def test_the_card_and_the_tab_say_people_and_never_undefined(run) -> None:
    if run.returncode != 0:
        pytest.fail(f"the occupancy surfaces failed when executed:\n{run.stdout}\n{run.stderr[-2000:]}")


def test_the_harness_ran_its_cases(run) -> None:
    lines = [json.loads(ln) for ln in run.stdout.splitlines() if ln.startswith("{")]
    summary = next((l for l in lines if l.get("summary")), None)
    assert summary and summary["cases"] >= 20 and summary["failed"] == 0, run.stdout
