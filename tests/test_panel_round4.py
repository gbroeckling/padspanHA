# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Panel bugs found in the round-4 audit (2026-10-13). Source-level pins,
this suite's convention for the panel's interactive views."""

from __future__ import annotations

from pathlib import Path

_W = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _src(rel: str) -> str:
    return (_W / rel).read_text(encoding="utf-8")


def test_the_gap_sliders_keep_the_focused_floor():
    """They rebuilt with ctx.state._overviewIsoFocus, which nothing sets, so
    every floor drew unfocused at 10% opacity."""
    s = _src("views/overview.js")
    assert "_rebuildIso(ctx.state._overviewIsoFocus)" not in s
    assert s.count("_rebuildIso(_getFocusZ(ctx.state._overviewIsoFocusIdx)); }, 150)") == 2


def test_the_2d_map_and_fallbacks_update_on_polls():
    """The poll only called the 3D updater, so Overhead mode and the no-rooms
    views stayed frozen; only the 3D path clears _overviewPollFull."""
    ov = _src("views/overview.js")
    assert "ctx.state._overviewPollFull = true;" in ov
    assert "ctx.state._isoUpdateObjects = _updateIsoObjects;\n    ctx.state._overviewPollFull = false;" in ov
    assert 'this.state.view === "overview" && !this.state._overviewPollFull' in _src("panel.js")


def test_a_flood_alarm_reset_confirm_survives_the_poll():
    """The banner list was rebuilt every poll, wiping Reset -> Yes/No."""
    s = _src("panel.js")
    assert "if(this._emergencyListSig === _sig && listEl.childElementCount) return;" in s


def test_coming_back_to_the_window_keeps_what_was_being_typed():
    s = _src("panel.js")
    wake = s[s.index("  _wakeUp(source){"):]
    wake = wake[:wake.index("  }\n")]
    assert "this._scheduleRender(true);" in wake and "this._refreshAll(false, true);" in wake
    assert "async _refreshAll(userAction=false, guarded=false){" in s


def test_suspend_and_resume_redraw_their_card():
    """They called ctx.actions.refreshLive, which never existed, so after a
    Suspend the card still offered Suspend (and restarted the hour)."""
    s = _src("views/settings.js")
    assert "ctx.actions.refreshLive" not in s
    assert s.count("await ctx.actions.refreshSnapshot();   // refreshLive never existed") == 2
