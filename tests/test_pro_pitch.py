"""Who gets told about the paid half, and what they are told.

There are exactly two paid features, and most free installs have never seen
either — the only place they are named is a refusal you hit by trying to use
them. The what's-new card mentions them once per release.

The rule that cannot be checked by reading the card is the one that matters
most: **a PadSpan Pro customer must never be pitched PadSpan Pro**, and a
Bright Pro customer must never be sold light placement they already own. The
decision therefore lives as a pure function in `editions.js` (`proPitch`) so it
can be exercised directly, in `tests/js/pro_pitch.mjs`.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "pro_pitch.mjs"
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
        "the harness itself failed — a harness bug, not a pitch bug:\n"
        f"{res.stderr[-3000:]}"
    )
    return json.loads(lines[-1])


def test_nobody_is_sold_what_they_already_own(result) -> None:
    if result["failures"]:
        detail = "\n".join(f"  {f['name']}: {f['detail']}" for f in result["failures"])
        pytest.fail(f"{len(result['failures'])} check(s) failed:\n{detail}")


def test_the_harness_actually_checked_something(result) -> None:
    assert len(result["checks"]) >= 20, result["checks"]
