# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Uncaught browser errors: only PadSpan's count, and each is credited to the
module that threw (views/ui_error.js).

The opt-in report showed ui_error:overview on 14 of 42 installs, and none of
it could be told apart from Home Assistant's own errors, other cards', or a
browser extension's: the panel's window listener credited EVERY error on the
page to whichever PadSpan tab was open. tests/js/ui_error_attribution.mjs
feeds the real module Chrome- and Firefox-shaped stacks from all of those.

Skipped (not failed) when node is unavailable.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "ui_error_attribution.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True,
                         encoding="utf-8", timeout=60)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_errors_that_are_not_padspans_are_not_counted(result) -> None:
    c = result["cases"]
    for k in ("ha_frontend", "resize_observer", "other_card", "lookalike_path",
              "filename_foreign", "rejection_ha_ws", "rejection_null",
              "rejection_string", "rejection_hostile", "no_event"):
        assert c[k] is None, f"{k}: counted as {c[k]!r}"


def test_padspan_errors_are_credited_to_the_module_that_threw(result) -> None:
    c = result["cases"]
    assert c["overview_chrome"] == "overview"
    assert c["overview_firefox"] == "overview"
    assert c["helper"] == "wled_tab_look", "the helper threw, not maps.js below it"
    assert c["panel"] == "panel"
    assert c["atlas"] == "atlas_panel"
    assert c["ha_over_ours"] == "follow", "our frame below HA's is still ours"
    assert c["lib_over_view"] == "maps", "a throw inside Preact is the view's bug"
    assert c["lib_only"] == "lib"
    assert c["other_file"] == "other"
    assert c["no_query"] == "traceback"
    assert c["filename_only"] == "health"
    assert c["rejection_ours"] == "occupancy"


def test_every_name_the_module_can_produce_is_on_the_backend_list(result) -> None:
    for name in {v for v in result["cases"].values() if v}:
        assert T.event_allowed(f"ui_error:{name}"), name
    for ev in result["report"]["sent"]:
        assert T.event_allowed(ev), ev


def test_one_count_per_module_per_minute_and_the_reporter_never_throws(result) -> None:
    r = result["report"]
    assert r["first"] == "overview"
    assert r["again_30s"] is None, "same module inside a minute"
    assert r["other_module_30s"] == "wled_tab_look", "the throttle is per module"
    assert r["foreign"] is None
    assert r["after_61s"] == "overview"
    assert r["bad_view_name"] == "atlas_panel"
    assert r["send_throws"] is None and r["garbage_event"] is None
    assert r["sent"] == [
        "ui_error:overview", "ui_error_while:overview",
        "ui_error:wled_tab_look", "ui_error_while:maps",
        "ui_error:overview", "ui_error_while:follow",
        "ui_error:atlas_panel",                      # no ui_error_while for a name off the list
    ]


def test_the_summary_keeps_old_whole_page_counts_apart(tmp_path) -> None:
    """server/telemetry_summary.py: a report with ui_error:* but no
    ui_error_while:* is from a build that counted every error on the page."""
    import os
    import sys
    from datetime import date
    script = _ROOT / "server" / "telemetry_summary.py"
    if not script.exists():
        pytest.skip("no server/ in this tree")
    old = {"install_id": "11111111-1111-4111-8111-111111111111", "version": "0.38.84",
           "usage": {"ui_error:overview": 7, "tab:overview": 3}}
    new = {"install_id": "22222222-2222-4222-8222-222222222222", "version": "0.38.85",
           "usage": {"ui_error:wled_tab_look": 2, "ui_error_while:maps": 2, "tab:maps": 1}}
    f = tmp_path / f"{date.today().isoformat()}.jsonl"
    f.write_text("\n".join(json.dumps({"recv_day": date.today().isoformat(), "report": r}) for r in (old, new)) + "\n",
                 encoding="utf-8")
    res = subprocess.run([sys.executable, str(script), str(tmp_path)], capture_output=True, text=True,
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"},
                         encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    out = res.stdout
    sec = out[out.index("Panel errors"):]
    assert "wled_tab_look" in sec and "maps" in sec
    older = sec[sec.index("older builds"):]
    assert "overview" in older and "7" in older
    usage = out[out.index("Usage ("):out.index("Panel errors")]
    assert "ui_error" not in usage, "error counts belong in their own section"
