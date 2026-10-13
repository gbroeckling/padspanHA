# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Bugs introduced by the 0.38.106-0.38.118 fixes, found by a review of
those fixes (2026-10-12). Panel-side checks; the backend ones sit with the
code they test."""

from __future__ import annotations

from pathlib import Path

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _src(name: str) -> str:
    return (_VIEWS / name).read_text(encoding="utf-8")


def test_install_base_shares_never_pass_100_percent():
    """Distributions come from every install's latest report in the spool;
    divided by the 30-day reporting count they read 120%."""
    s = _src("installbase.js")
    assert "const n = Object.values(dist.version || {}).reduce(" in s
    assert "One row per install that reported within" not in s


def test_a_deep_link_survives_a_render_before_the_maps_arrive():
    s = _src("traceback.js")
    assert "if (ctx.state._mapsLoaded) delete ctx.state._tracebackInitialMode;" in s


def test_the_last_grace_day_is_not_zero_days():
    assert "const graceLeft = Math.max(1, 14 + daysLeft);" in _src("settings.js")


def test_a_placement_during_another_save_waits_for_it():
    s = _src("calibration.js")
    block = s[s.index("async function _autoSaveAndStartTimer"):]
    block = block[:block.index("_startLiveTimer(bkObj, mapId);")]
    assert "res.busy" in block and "press Save" in block


def test_tracked_devices_are_never_pinned():
    """Marking the auto-pinned rows (_tracked) missed phones placed from the
    list; the save judges each row by its device (test_beacon_tune_save)."""
    assert "bs.editBaseline[mapId], moving)" in _src("calibration.js")
