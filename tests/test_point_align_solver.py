# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Point Align's rigid solve placed a map with the REFERENCE picture's shape (#62).

The invariant is about pixels being square: **a placed map's world footprint
has its OWN image's aspect.** `_solvePtAlignRigid` in views/maps.js was handed
one aspect ratio — `arHW`, the reference image's height/width — and used it for
BOTH images, so its design rows converted the TARGET's frac coords through the
reference's ratio and the matrix it reconstructed always had `m11 === m22`. A
footprint with equal diagonal entries has the reference's aspect whatever the
target's picture is, which is how rjbutler's 1600x853 Main Floor came out with
930x850 Upstairs' proportions and 42% of axis disagreement.

tests/test_point_align_rigid_aspect.py covers the STORED half — what that left
in a fabric, and the repair for it. This file covers the solver itself, so the
half that produces the state is not the half without a test.

The checks are in `tests/js/point_align_solver.mjs`, run under node, because
the solver is frontend-only and so is the renderer whose footprint it has to
agree with. It is a closure-local const inside `_stack()` with no export, so
the harness lifts it out of maps.js by text and runs it exactly as it ships —
the same string-surgery-then-node route test_fabric_frame_contract.py uses on
views/iso_lights.js.

Confirmed as cover by mutation: reverting `_solvePtAlignRigid` and its call
site to the one-ratio model fails 36 of the 79 checks — 32 on the shape of the
placement, 4 on the target aspect having no default to fall back to.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "point_align_solver.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run(
        [_NODE, str(_SCRIPT), str(_VIEWS)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not a solver bug:\n"
        f"{res.stderr[-3000:]}"
    )
    return json.loads(lines[-1])


def test_a_placed_map_keeps_its_own_pictures_aspect(result) -> None:
    if result["failures"]:
        detail = "\n".join(f"  {f['name']}: {f['detail']}" for f in result["failures"])
        pytest.fail(f"{len(result['failures'])} check(s) failed:\n{detail}")


def test_the_harness_actually_checked_something(result) -> None:
    """A guard that silently stops covering anything is worse than none."""
    assert len(result["checks"]) >= 70, result["checks"]
