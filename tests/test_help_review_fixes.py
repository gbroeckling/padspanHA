# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The help review's on-screen fixes (2026-10-31): names of tabs that moved,
the HA Entities templates, the Atlas builder's tour, where a support report
goes, and the top bar's two "?" that must never wrap it."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_WWW = _PKG / "www" / "padspan-ha"
_NODE = shutil.which("node")


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_no_pointers_to_tabs_that_moved() -> None:
    panel = _read(_WWW / "panel.js")
    assert 'hint: "Maps \\u2192' not in panel and panel.count('hint: "Mapping \\u2192') == 4
    assert "Maps tab" not in _read(_WWW / "views" / "calibration.js")
    assert "Maps \\u2192 Edit" not in _read(_PKG / "ws_fabric.py")
    diag = _read(_PKG / "ws_diagnostics.py")
    assert "(Maps tab)" not in diag and "Calibration \\u2192 Tune workflow" not in diag
    assert "Start \\U0001f9ed Guided calibration in Calibration" in diag
    settings = _read(_WWW / "views" / "settings.js")
    assert "the Objects list" not in settings and "Objects first/last-seen" not in settings
    assert "Set it in Manage → HA Entities → ESPresense MQTT." in _read(_PKG / "ws_devices.py")
    assert "Overview shows the Atlas\\\" off" not in _read(_WWW / "views" / "overview.js")


def test_area_templates_skip_per_receiver_distance_sensors() -> None:
    src = _read(_WWW / "views" / "manage.js")
    hits = [m.start() for m in re.finditer(r"selectattr\('entity_id', 'search', '_area\$'\)", src)]
    assert len(hits) == 2
    for i in hits:
        nxt = src[i:i + 200].splitlines()[1]
        assert "rejectattr('entity_id', 'search', '_distance_')" in nxt


def _tour(paid: bool) -> list[dict]:
    if _NODE is None:
        pytest.skip("node is not installed")
    src = _read(_WWW / "views" / "maps.js")
    a = src.index("function _lightsTourSteps(paid){")
    fn = src[a:src.index("\n}\n", a) + 2]
    m = re.search(r"export const LIGHT_CLASSES = (\[.*?\]);", _read(_WWW / "views" / "lights_map.js"))
    js = (f"const _LIC_PATH = 'Settings → PadSpan licence'; const _lightsTourFindTable = () => null;\n{fn}\n"
          f"console.log(JSON.stringify({{steps: _lightsTourSteps({str(paid).lower()}).map(s => ({{title: s.title, body: s.body}})),"
          f" classes: {m.group(1)}}}));")
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_free_tour_does_not_promise_placing_lights() -> None:
    free, paid = _tour(False), _tour(True)
    text = " ".join(s["body"] for s in free["steps"])
    assert "Drag any light on the map to its real spot" not in text
    assert "needs a PadSpan Bright Pro or PadSpan Pro key" in text
    assert "Give it a shape" not in [s["title"] for s in free["steps"]]
    assert "Drag any light on the map to its real spot" in " ".join(s["body"] for s in paid["steps"])
    chips = next(s["body"] for s in paid["steps"] if s["title"].startswith("Fans, motion"))
    labels = [label for _, label in paid["classes"]]
    assert all(lbl in chips for lbl in labels), labels


def test_a_support_report_says_where_it_goes() -> None:
    for name in ("diagnostics.js", "monitor.js", "health.js", "training.js"):
        src = _read(_WWW / "views" / name)
        assert "an email to support" not in src and "or an email." not in src, name
        assert "hello@traks.ca" in src and "issues are public" in src, name
    assert "an email to support" not in _read(_WWW / "help_content.js")


def test_the_top_bar_never_wraps_and_the_atlas_row_names_its_two_help_buttons() -> None:
    css = _read(_WWW / "styles.css")
    assert "@media (min-width:1101px) and (max-width:1279px){#dataModeHelp,#complexityHelp{display:none}}" in css
    assert ".desktop-topbar{flex-wrap:nowrap}" in css
    lm = _read(_WWW / "views" / "lights_map.js")
    assert 'host.helpBtn("aboard_3d", "Help: Live Aboard")' in lm
    assert 'host.helpBtn("lights_build_controls", "Help: build controls")' in lm
    assert 'b.title = title || "Help";' in _read(_WWW / "panel.js")
