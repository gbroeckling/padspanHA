# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The panel uses no undeclared names — eslint no-undef, in the local suite.

CI runs the same command as its own step (.github/workflows/pytest.yml);
this is so a local run catches it before a push. eslint.config.mjs says why
the rule exists and why nothing else is enabled.

An undeclared name parses, so test_frontend_parses.py passes it, and it only
throws on the branch that reaches it, so render_smoke.mjs sees it only if its
fixture happens to take that branch. Neither caught the undeclared `el` in
maps.js's Lights builder (5288c62c, a blank Lights tab live for about a day),
nor the `_loaded = true` that 6f76c44b left behind in overview.js's
Positioning Diagnostics, which threw on any install with no labelled devices.
no-undef finds both without running anything.

Skips when npx is missing, or cannot fetch eslint (offline with an empty npx
cache) — CI's own lint step fails in that case instead of skipping.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_NPX = shutil.which("npx")
_ESLINT = [_NPX, "--yes", "-p", "eslint@9", "-p", "globals@17", "eslint"]

pytestmark = pytest.mark.skipif(_NPX is None, reason="node/npx is not installed")


def _eslint(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(_ESLINT + list(args), cwd=_ROOT, input=stdin,
                          capture_output=True, text=True, encoding="utf-8", timeout=300)


@pytest.fixture(scope="module", autouse=True)
def _eslint_fetched() -> None:
    res = _eslint("--version")
    if res.returncode != 0:
        pytest.skip(f"npx could not fetch eslint: {res.stderr.strip()[-300:]}")


def test_panel_has_no_undeclared_names() -> None:
    res = _eslint("custom_components/padspan_ha/www/**/*.js")
    assert res.returncode == 0, (
        "an undeclared name throws a ReferenceError the moment its line runs, "
        "and panel.js turns that into a blank view with a clean console:\n"
        + (res.stdout or res.stderr)[-3000:]
    )


def test_the_lint_can_actually_fail() -> None:
    """Proof the config reaches the panel's files with the rule on: the
    09-13 Lights crash, reduced to its shape — a sibling of render(ctx)
    calling `el` without destructuring it from ctx.helpers itself."""
    src = 'function _wireHoverHud(ctx, isoDiv) {\n  isoDiv.appendChild(el("div"));\n}\n'
    res = _eslint("--stdin", "--stdin-filename",
                  "custom_components/padspan_ha/www/padspan-ha/views/maps.js", stdin=src)
    assert res.returncode == 1 and "'el' is not defined" in res.stdout, res.stdout + res.stderr
