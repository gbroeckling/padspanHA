# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every package the integration or the suite imports is declared.

0.38.188 imported Pillow (ws_house3d_stairs.py and its tests) without adding
it to requirements_test.txt. The suite passed on a machine that had Pillow
anyway and went red on GitHub for 0.38.188 and 0.38.189. This reads every
import in custom_components/padspan_ha and tests/ and holds each one that is
not the standard library, Home Assistant (stubbed in conftest.py) or this
repository's own code to one of two lists: requirements_test.txt, or
HA_ONLY below (Home Assistant ships it and the suite never runs the code that
imports it), each with its reason. A new import on neither fails here.
"""

from __future__ import annotations

import ast
import re
import sys
import warnings
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
# The derived Bright tree carries tests/ but not scripts/ or tools/, whose
# tests skip there: its tests import names this can't place, so only the
# integration is read there.
_FULL_TREE = (_ROOT / "scripts").is_dir() and (_ROOT / "tools").is_dir()
_SCANNED = (_ROOT / "custom_components" / "padspan_ha",) + ((_ROOT / "tests",) if _FULL_TREE else ())

# Imported only inside code the suite never runs; Home Assistant always has them.
HA_ONLY = {
    "aiohttp": "map_image_view, vacuum_import and ws_devices import it inside a request handler; HA's web server is aiohttp",
    "habluetooth": "bluetooth_live imports it inside a try, on a live Bluetooth stack only; HA's bluetooth integration ships it",
}

# Import name → the package name pip installs it under, where they differ.
_PIP_NAME = {"PIL": "pillow", "yaml": "pyyaml", "_pytest": "pytest", "pytest_asyncio": "pytest-asyncio"}


def _declared() -> set[str]:
    out = set()
    for ln in (_ROOT / "requirements_test.txt").read_text(encoding="utf-8").splitlines():
        ln = ln.split("#", 1)[0].strip()
        if ln:
            out.add(re.split(r"[=<>!~\[; ]", ln, maxsplit=1)[0].strip().lower())
    return out


def _own_modules() -> set[str]:
    """This repository's own scripts and tools, which tests import by name."""
    names = set()
    for d in ("scripts", "tools"):
        for p in (_ROOT / d).rglob("*.py"):
            names.add(p.stem)
        for p in (_ROOT / d).rglob("__init__.py"):
            names.add(p.parent.name)
    return names


def _imports() -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for root in _SCANNED:
        for p in root.rglob("*.py"):
            if "__pycache__" in p.parts:
                continue
            with warnings.catch_warnings():   # a test's own odd escape is not this test's business
                warnings.simplefilter("ignore", SyntaxWarning)
                tree = ast.parse(p.read_text(encoding="utf-8"), filename=str(p))
            for n in ast.walk(tree):
                if isinstance(n, ast.Import):
                    mods = [a.name for a in n.names]
                elif isinstance(n, ast.ImportFrom) and n.level == 0 and n.module:
                    mods = [n.module]
                else:
                    continue
                for m in mods:
                    found.setdefault(m.split(".")[0], set()).add(str(p.relative_to(_ROOT)))
    return found


def test_every_imported_package_is_declared() -> None:
    declared, own = _declared(), _own_modules()
    local = {"custom_components", "tests", "homeassistant", "__future__", "conftest"}
    missing = {}
    for top, where in sorted(_imports().items()):
        if top in sys.stdlib_module_names or top in local or top in own or top in HA_ONLY:
            continue
        if _PIP_NAME.get(top, top).lower() not in declared:
            missing[top] = sorted(where)[:3]
    assert not missing, (
        "imported but not in requirements_test.txt (add it there, pinned, with why; or to HA_ONLY "
        f"if Home Assistant ships it and the suite never runs that code): {missing}")


def test_the_lists_hold_nothing_stale() -> None:
    if not _FULL_TREE:
        import pytest  # noqa: PLC0415
        pytest.skip("the Bright tree holds only part of the integration")
    imported = _imports()
    for name in HA_ONLY:
        assert name in imported, f"{name} is on HA_ONLY but nothing imports it any more"
        assert name.lower() not in _declared(), f"{name} is on both lists"
    # Pillow, the one this was written for, is declared and still used.
    assert "pillow" in _declared() and "PIL" in imported
