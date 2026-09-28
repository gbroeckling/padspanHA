# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Become a tester — the panel side (views/tester_signup.js), run under node.

tests/js/tester_signup.mjs drives the section: when it shows and for whom
(report off and never signed up: nothing; signed up with the report off:
status and "Stop being a tester"; a non-admin: one line and no command
reached), nothing sent until the checks pass, only the ticked setup lines
named, consent never pre-ticked, a failed send or withdraw left standing and
not retried, and the section really inside the report's card in settings.js.

This wrapper runs it, then holds the panel's checks to tester.py's: the same
forms get the same verdict in the same words, and the interests, limits and
patterns are the same lists — one rule, checked twice, never two rules.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import tester

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_HARNESS = Path(__file__).parent / "js" / "tester_signup.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def run() -> dict:
    res = subprocess.run([_NODE, str(_HARNESS), str(_VIEWS)], capture_output=True, text=True,
                         encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, f"no result from the harness:\n{res.stdout[-2000:]}\n{res.stderr[-2000:]}"
    out = json.loads(lines[-1])
    out["_returncode"], out["_stderr"] = res.returncode, res.stderr
    return out


def test_the_section_behaves(run) -> None:
    assert not run["failed"] and run["_returncode"] == 0, (
        "\n".join(run["failed"]) + "\n" + run["_stderr"][-2000:])
    # A harness that quietly stops running its checks is worse than none.
    assert run["passed"] >= 18, run["passed"]


def test_the_panel_and_tester_py_give_the_same_verdicts(run) -> None:
    """The panel refuses first so nothing half-checked reaches the backend;
    the backend refuses again because the panel is not the only caller. A
    difference between the two is one of them being wrong."""
    assert len(run["verdicts"]) >= 25
    for v in run["verdicts"]:
        form = dict(v["form"])
        form["interests_other"] = form.pop("other", "")
        _, problems = tester.clean_form(form, [])
        assert problems == v["problems"], (v["name"], problems, v["problems"])


def test_the_panel_uses_tester_py_vocabulary(run) -> None:
    vocab = run["vocab"]
    assert vocab["interests"] == list(tester.INTERESTS)
    assert vocab["limits"] == tester.LIMITS
    assert vocab["patterns"]["email"] == "^" + tester.EMAIL_PATTERN + "$"
    assert vocab["patterns"]["github"] == "^" + tester.GITHUB_PATTERN + "$"
    # A regex literal writes "/" as "\/".
    assert vocab["patterns"]["timezone"].replace("\\/", "/") == "^" + tester.TIMEZONE_PATTERN + "$"
    assert [[what, src] for what, src, _ in vocab["secrets"]] == [list(p) for p in tester.SECRET_PATTERNS]
    assert all(flags == "" for *_, flags in vocab["secrets"]), "a flag makes a pattern mean something else in Python"
