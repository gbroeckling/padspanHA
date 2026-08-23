"""Change Master moves the whole house into the new master's frame (issue #64).

The relink used to compose a map's new placement from its decomposed
`x_offset / scale / rotation` fields — the inputs to ONE of the renderer's two
branches, ignored entirely when Point Align has written a raw affine `_m` —
and only for maps whose `ref_map_id` was the old master, leaving every other
map behind in the old world frame. Both are fixed by doing the arithmetic on
the world affine the renderer actually draws, in `stack_transform.js`
(`changeMasterStacks` and the affine helpers the Point Align apply path now
shares).

The checks are in `tests/js/change_master.mjs`, run under node, because the
fix is frontend-only and so is the renderer it has to agree with. Confirmed as
cover by mutation: a reader that ignores `_m` fails 17 checks; a relink that
skips maps not referencing the old master fails 10.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "change_master.mjs"
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
        "the harness itself failed — a harness bug, not a placement bug:\n"
        f"{res.stderr[-3000:]}"
    )
    return json.loads(lines[-1])


def test_every_map_moves_with_the_frame(result) -> None:
    if result["failures"]:
        detail = "\n".join(f"  {f['name']}: {f['detail']}" for f in result["failures"])
        pytest.fail(f"{len(result['failures'])} check(s) failed:\n{detail}")


def test_the_harness_actually_checked_something(result) -> None:
    """A guard that silently stops covering anything is worse than none."""
    assert len(result["checks"]) >= 40, result["checks"]
