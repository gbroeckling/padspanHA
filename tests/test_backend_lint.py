# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Python uses no undefined names: ruff F821, F822 and F823.

The backend's counterpart of test_frontend_lint.py. A name that was never
imported or assigned compiles, and raises NameError only when its line runs.
Most handlers catch every exception, so what the user sees is a feature that
quietly answers "nothing": 0.38.256 shipped "Suggest a fit" calling a module
alias that was imported in the function next door, and it said "no fit" to
everyone until 0.38.257. These three rules find that without running anything:

    F821  a name that is not defined anywhere
    F822  a name listed in __all__ that the module does not define
    F823  a local variable read before it is assigned

Only these three are on. Style rules are deliberately not enabled.

CI runs the same check as its own step (.github/workflows/pytest.yml). ruff is
pinned in requirements_test.txt, so there is no skip here: a missing ruff is a
missing test dependency.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
# --isolated: no config file anywhere on the machine changes the answer.
# --no-cache: nothing is written into the checkout.
_RUFF = [sys.executable, "-m", "ruff", "check", "--isolated", "--no-cache",
         "--select", "F821,F822,F823"]
# Every tracked folder that holds Python, named one by one so that a local
# checkout's untracked folders (worktrees, generated trees) are not read. The
# derived Bright tree carries only the first two.
_FOLDERS = [d for d in ("custom_components", "tests", "scripts", "server", "tools", "prototypes")
            if (_ROOT / d).is_dir()]


def _ruff(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    res = subprocess.run(_RUFF + list(args), cwd=_ROOT, input=stdin,
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    assert "No module named ruff" not in res.stderr, (
        "ruff is not installed: pip install -r requirements_test.txt")
    return res


def test_python_has_no_undefined_names() -> None:
    res = _ruff(*_FOLDERS)
    assert res.returncode == 0, (
        "an undefined name raises NameError the moment its line runs, and a "
        "handler that catches everything turns that into a silent wrong answer:\n"
        + (res.stdout or res.stderr)[-3000:]
    )


def test_the_lint_can_actually_fail() -> None:
    """Proof the three rules are on, each on the smallest code that breaks it.
    The first is the 0.38.256 mistake reduced to its shape: an alias imported
    inside one function and used in another."""
    cases = {
        "F821": ("def read():\n    from . import roomplan_import as RP\n    return RP.parse\n\n\n"
                 "def fit():\n    return RP.fit_to_floor\n"),
        "F822": '__all__ = ["missing"]\n',
        "F823": "count = 0\n\n\ndef bump():\n    count += 1\n",
    }
    for rule, src in cases.items():
        res = _ruff("--stdin-filename", "custom_components/padspan_ha/ws_maps.py", "-", stdin=src)
        assert res.returncode == 1 and rule in res.stdout, f"{rule}: {res.stdout}{res.stderr}"
