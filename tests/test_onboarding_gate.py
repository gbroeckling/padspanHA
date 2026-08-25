"""The onboarding card must not answer "is setup done?" before it can know.

v0.38.5 flashed **"Setup Progress — 0/5 — Upload Floor Plan"** at established
installs on every panel open. Nothing was wrong with them. `_hasMaps` is derived
from `this.state.maps.list`, and on first paint that list has not been fetched
yet — so *empty* was read as *not done*.

It mattered most on that release, because 0.38.5 is the one that rewrote how
every map stores its position. Somebody who upgrades and is then told they have
never uploaded a floor plan reasonably concludes the upgrade ate their setup,
and reaches for a backup restore — a destructive answer to a problem that does
not exist. It is convincing: it briefly convinced the person who found it, while
they were specifically looking for migration damage.

This is the same shape as the bug in `bluetooth_live._scanning_mode`, whose own
docstring already states the rule: *"not transmitting and not telling us are
different facts."* Empty-because-unloaded and empty-because-unconfigured are
different facts too, and the fix is the same — do not render an unknown as a
definite negative.

The gate is lifted from the shipped `panel.js` by text rather than
reimplemented, so this fails if the real condition changes.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PANEL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js"
_SCRIPT = Path(__file__).parent / "js" / "onboarding_gate.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run(
        [_NODE, str(_SCRIPT), str(_PANEL)],
        capture_output=True, text=True, encoding="utf-8", timeout=60,
    )
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not a panel bug:\n"
        f"{res.stderr[-3000:]}"
    )
    return json.loads(lines[-1])


def test_an_established_install_is_never_told_it_has_not_started(result) -> None:
    if result["failures"]:
        detail = "\n".join(f"  {f['name']}: {f['detail']}" for f in result["failures"])
        pytest.fail(f"{len(result['failures'])} check(s) failed:\n{detail}")


def test_the_harness_actually_checked_something(result) -> None:
    assert len(result["checks"]) >= 8, result["checks"]
