# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Modes stop hiding screens (Garry, 2026-10-30).

Every screen is in the menu in every mode. The main groups are the mode's
everyday screens (Basic its short list, Advanced and Development the same
longer one plus Settings → UI Structure's opt-ins); the rest sit in one More
tools group, closed until opened, remembered per browser, its opening counted
in the opt-in report. Opening a More tools screen never changes the mode, and
a ?view= link opens its screen in every mode.

tests/js/menu_more_tools.mjs lifts panel.js's menu constants and methods onto
a stand-in panel under the DOM shim and runs both skins in every mode.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "menu_more_tools.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("closed:", 7), ("main:", 6), ("open:", 6), ("reach:", 6), ("more:", 6), ("stay:", 9),
    ("remember:", 6), ("optin:", 1), ("gated:", 1), ("link:", 1), ("phone:", 1),
])
def test_the_menu(run: dict, prefix: str, least: int) -> None:
    got = {k: v for k, v in run["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix} ran {len(got)} of {least}: {sorted(run['cases'])}"
    bad = [f for f in run["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_the_menu_per_mode(run: dict) -> None:
    """The final lists, pinned: Basic's short main list with everything else
    under More tools; Advanced and Development the same menu."""
    m = run["menus"]
    assert set(m["basic/2025"]["main"]) == {"overview", "follow", "maps", "rooms", "receivers", "calibration", "training", "settings"}
    # The Rooms and Receivers pages (2026-10-30) are main screens in every mode.
    assert all(v in m[f"{mode}/{skin}"]["main"] for v in ("rooms", "receivers")
               for mode in ("basic", "advanced", "development") for skin in ("2025", "classic"))
    assert m["advanced/2025"] == m["development/2025"]
    assert m["advanced/2025"]["more"] == ["monitor", "devices", "bluetooth", "presence", "qa", "sandbox", "installbase"]
    assert m["basic/2025"]["more"][:5] == ["purelive", "occupancy", "manage", "traceback", "health"]


def test_more_tools_opening_is_in_the_report_vocabulary() -> None:
    from custom_components.padspan_ha import telemetry as T
    assert "menu_more_tools_open" in T.EVENTS
    assert T.event_allowed("menu_more_tools_open")
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert 'this._telemetryEvent("menu_more_tools_open")' in panel
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert "menu_more_tools_open:" in ib, "the Install Base page names it"
