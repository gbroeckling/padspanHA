"""panel.js's onboarding checklist and views/setup_status.js must never
disagree about whether a map-setup step is done.

They are, on purpose, two separate copies: onboarding_gate.mjs needs
panel.js's checks self-contained enough to lift by text (see that test and
the comment above the checks in panel.js), so they were not collapsed into
a shared import. But two copies of the same question is exactly the defect
class this repo already has a name for — LIGHT_SHAPES vs the backend
whitelist, the editions.js surface map, the help_content.js key duplicates
fixed earlier this session — so the two copies are run against the same
battery of fabricated states here and must always agree.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PANEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "setup_status_parity.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run(
        [_NODE, str(_SCRIPT), str(_PANEL), str(_VIEWS)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not a parity bug:\n"
        f"{res.stderr[-3000:]}"
    )
    return json.loads(lines[-1])


def test_the_checklist_and_the_wizard_never_disagree(result) -> None:
    if result["failures"]:
        detail = "\n".join(f"  {f['name']}: {f['detail']}" for f in result["failures"])
        pytest.fail(f"{len(result['failures'])} check(s) failed:\n{detail}")


def test_the_harness_actually_checked_something(result) -> None:
    assert len(result["checks"]) >= 60, result["checks"]
