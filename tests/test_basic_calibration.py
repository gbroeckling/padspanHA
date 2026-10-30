# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Calibration in Basic mode (interface review, 2026-10-30).

Every home needs Calibration for accuracy, so Basic mode's menu lists it,
and nothing that opens Calibration switches a Basic user to Advanced any
more: the accuracy tip (tests/js/accuracy_tips.mjs checks it stays Basic)
and Getting started. Inside, Calibration shows the same tabs in every mode.
"""

from __future__ import annotations

import re
from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _read(name: str) -> str:
    return (_WWW / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def _set(src: str, name: str) -> set[str]:
    m = re.search(rf"const {name} = (.+?);\n", src)
    assert m, f"could not find {name} in panel.js"
    return set(re.findall(r'"([a-z_]+)"', m.group(1)))


def test_basic_mode_lists_calibration() -> None:
    src = _read("panel.js")
    basic = _set(src, "BASIC_TABS")
    assert basic == {"follow", "overview", "maps", "rooms", "receivers", "calibration", "settings", "training"}, sorted(basic)
    assert "calibration" in _set(src, "ADVANCED_DEFAULT")
    assert "calibration" not in _set(src, "DEV_ONLY_TABS")


def test_opening_calibration_never_switches_basic_to_advanced() -> None:
    src = _read("panel.js")
    tip = src[src.index("  _accuracyTipsCard(){"):src.index("\n  _proInviteOverviewCard(){")]
    assert 'this.state.view = "calibration"' in tip
    assert 'complexity = "advanced"' not in tip
    # Getting started's steps: the only promotion left in that handler is none.
    gs = src[src.index("if (s.wizardStep) {"):]
    gs = gs[:gs.index("this.state.view = s.view;")]
    assert 'complexity = "advanced"' not in gs
    # Nor does the tester sign-up: in Basic it opens the report's card alone.
    signup = src[src.index("  _openTesterSignup(){"):]
    signup = signup[:signup.index("\n  }\n")]
    assert 'F.openFocus(this._ctx(), F.part("usageReport"))' in signup
    assert "complexity" not in signup
    # Mapping's set-up wizard ends with "Go to Calibration": no switch either.
    maps = _read("views/maps.js")
    fin = maps[maps.index("function _wizardFinish("):maps.index("function _wizard(ctx")]
    assert 'ctx.state.view = "calibration"' in fin
    assert "setComplexity" not in fin


def test_calibration_tabs_do_not_depend_on_the_mode() -> None:
    for name in ("calibration.js", "calibration_walk.js", "calibration_matrix.js", "tune_save_plan.js"):
        assert "complexity" not in _read("views/" + name), name


def test_training_no_longer_calls_calibration_advanced_only() -> None:
    src = _read("views/training.js")
    assert "Calibration tab (visible in Advanced and Development modes)" not in src
    assert "Basic — 8 tabs (Follow, Overview, Maps, Rooms, Receivers, Calibration, Settings, Training)" in src
