# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""GitHub #62 (rjbutler): "the Mapping floor selector silently resets to
'basement' (first floor in the list) during the file-browse dialog, so
picking 'main floor' then browsing for a file uploads the image to the
wrong floor without any visible warning." His fabric then looked broken
(missing walls, radios on wrong floors) as a downstream effect, not a new
coordinate bug — he gave up and started remapping from scratch.

Root cause: render() re-runs on a 5s poll regardless of what the user is
doing, and a poll tick landing while the native file-browse dialog is open
rebuilds the floor <select> from scratch. Its own restore-on-rebuild logic
correctly protects what the dropdown DISPLAYS (ctx.state._mapsUploadFloorId
survives the rebuild) — but the Upload button read the dropdown's raw DOM
value instead of that same protected state, so a rebuild that landed on
floors[0] before the real choice re-applied uploaded to the wrong floor
with the display never even having to be looked at, let alone believed.

Checked by RUNNING the shipped resolution logic, not by grepping it —
tests/js/upload_floor_id.mjs lifts it out of maps.js verbatim.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "upload_floor_id.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in (res.stdout or "").strip().splitlines() if ln.startswith("{")]
    assert lines, (
        "the harness itself failed — a harness bug, not an upload bug:\n"
        f"{(res.stderr or '')[-3000:]}"
    )
    return json.loads(lines[-1])


def test_the_upload_reads_the_protected_state_not_the_raw_dom(result) -> None:
    assert not result["failures"], json.dumps(result["failures"], indent=2)


def test_a_poll_rebuild_mid_dialog_no_longer_uploads_to_the_wrong_floor(result) -> None:
    """The exact rjbutler scenario: state says "main", the rebuilt <select>
    is showing "basement". The upload must go to "main" regardless."""
    assert result["cases"]["rebuildLandedOnFirstFloor"] == "main"


def test_the_ordinary_case_is_unaffected(result) -> None:
    assert result["cases"]["normalAgreement"] == "attic"


def test_a_stale_recorded_floor_falls_back_to_the_dom_rather_than_uploading_blind(result) -> None:
    """State can go stale too — a floor deleted or renamed after it was
    recorded. The DOM (fresh from the current floor list) is the only
    honest answer left once state names something that no longer exists."""
    assert result["cases"]["staleStateFallsBackToDom"] == "basement"


def test_a_first_ever_upload_with_no_recorded_choice_uses_the_dom_default(result) -> None:
    assert result["cases"]["neverChosenUsesDom"] == "basement"
