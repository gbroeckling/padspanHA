"""The Overview cards in panel.js must be RUN, not just read.

On 2026-08-25 the Overview tab went blank on the first install that had ever
qualified to see the what's-new card. `_whatsNewCard` referenced `notesUrl`,
which was declared nowhere — a `const` removed by a refactor, its use site
left behind. JavaScript raises ReferenceError only when control reaches the
line, and control could not reach it until an install had a PREVIOUS version
recorded. Every install in existence returned null earlier in the method, so
the suite stayed green, `node --check` passed, and it shipped.

tests/js/render_smoke.mjs was built for exactly this class and its header
lists four earlier instances. It walks `views/`. These cards live in panel.js
itself, which had no such net — that is the gap this closes.

`tests/js/whats_new_card.mjs` evaluates the method against the module-level
names panel.js actually provides (`el`, `APP_VERSION`, `EDITIONS`) and nothing
else, in each of the states that gate it — including the rare one that broke
the tab, and the two ways editions.js can let it down.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PANEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_SCRIPT = Path(__file__).parent / "js" / "whats_new_card.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def run() -> subprocess.CompletedProcess:
    return subprocess.run(
        [_NODE, str(_SCRIPT), str(_PANEL)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )


def test_the_overview_cards_survive_every_state_that_reaches_them(run) -> None:
    if run.returncode != 0:
        pytest.fail(
            "an Overview card threw when actually executed — this is the blank-tab "
            f"failure mode:\n{run.stdout}\n{run.stderr[-2000:]}"
        )


def test_the_harness_actually_ran_its_cases(run) -> None:
    """A harness that silently stops finding the method would pass forever."""
    m = re.search(r"(\d+) passed, (\d+) failed", run.stdout)
    assert m, f"harness produced no summary:\n{run.stdout}\n{run.stderr[-2000:]}"
    assert int(m.group(1)) >= 6, f"only {m.group(1)} case(s) ran:\n{run.stdout}"
