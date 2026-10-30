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


def test_a_flood_alarm_reset_confirm_survives_the_poll():
    """The banner list was rebuilt every poll, wiping Reset -> Yes/No."""
    s = _src("panel.js")
    assert "if(this._emergencyListSig === _sig && listEl.childElementCount) return;" in s
    assert 'eid + "=" + (realStates?.[eid]?.attributes?.friendly_name || "")' in s   # renames show
    assert 'this._emergencyListSig = "";     // the next update rebuilds the row' in s


def test_suspend_and_resume_redraw_their_card():
    """They called ctx.actions.refreshLive, which never existed, so after a
    Suspend the card still offered Suspend (and restarted the hour)."""
    s = _src("views/settings.js")
    assert "ctx.actions.refreshLive" not in s
    assert s.count("await ctx.actions.refreshSnapshot();   // refreshLive never existed") == 2


def test_objects_view_room_names_union_and_clear():
    s = _src("views/objects.js")
    assert 'el("span",{}, esc(room))' not in s                                   # "&amp;" shown literally
    assert 'if (mode === "all" || mode === "intersect") items = Array.from(intersect);' in s
    assert s.count("await ctx.actions.refreshSnapshot();") >= 2                  # cleared devices go


def test_a_calibration_confirm_does_not_block_other_views():
    """Delete radio (or an overlapping-map popup) set _confirming, and the
    render guard read it panel-wide: the sidebar moved, the content stayed."""
    s = _src("panel.js")
    assert 'if(this.state.view === "calibration" && (this.state._calibTune?._dragging' in s
    sw = s[s.index("const _switchView = (id) => {"):]
    sw = sw[:sw.index("this._renderNav();")]
    assert "this.state._calibBeacon._confirming = false;" in sw and "this.state._calibTune._confirming = false;" in sw


def test_escape_keeps_closing_a_modal_after_typing():
    s = _src("panel.js")
    assert 'window.addEventListener("keydown", esc, { once: true });' not in s
    assert 'if(this._modalEsc){ window.removeEventListener("keydown", this._modalEsc); this._modalEsc = null; }' in s


def test_follow_remembers_its_tag_across_reloads():
    """The panel read padspan_followAddr at start; nothing had written it."""
    f = _src("views/follow.js")
    assert 'localStorage.setItem("padspan_followAddr", id || "")' in f
    assert 'localStorage.removeItem("padspan_followAddr")' in f
    assert 'try { return localStorage.getItem("padspan_followAddr") || ""; } catch (e) { return ""; }' in _src("panel.js")


def test_the_phone_wizard_can_save_an_irk_unverified():
    """irk_add answers code 'unverified' for a phone that isn't advertising;
    the wizard had no way to save it anyway, and Retry sent the same call."""
    s = _src("views/overview.js")
    assert s.count("force: irkSaveBtn._force === true,") == 2
    assert s.count('if (err && err.code === "unverified") { irkSaveBtn._force = true; irkSaveBtn.textContent = "Save unverified"; }') == 2


def test_no_re_anchor_button_that_does_nothing():
    """It sent {map_id} alone, a backend no-op, and toasted 'Re-anchored'."""
    assert "Re-anchor origin" not in _src("views/maps.js").replace('No "Re-anchor origin" button', "")


def test_follows_movement_log_refreshes():
    """Fetched only on a new selection, the log froze when the tag was picked."""
    f = _src("views/follow.js")
    assert "const _mvStale = Date.now() - (ctx.state._followMovementAt || 0) > 30000;" in f


def test_buttons_come_back_after_a_failed_call():
    assert 'cancelBtn.disabled = false; cancelBtn.textContent = "Resume Normal";' in _src("views/overview.js")
    assert "try { await ctx.actions.mapsRefreshQuiet(); }" in _src("views/manage.js")
    assert "ctx.state._notifyServices = null;" in _src("views/follow.js")


def test_enable_and_track_says_only_what_it_did():
    """A disabled phone has no iBeacon key, so no command was sent, yet the
    message said one was."""
    s = _src("views/overview.js")
    assert s.count('meta.textContent = phone.ibeacon_key ? "Entity enabled & BLE command sent.') == 2


def test_review_fixes_follow_log_force_flag_and_reset_mode():
    """From the pre-release review: an unchanged movement-log refresh redrew
    Follow (or whatever view was open by then); "Save unverified" stayed on
    for an edited key; factory reset set the room filter to "all", which now
    means intersection."""
    f = _src("views/follow.js")
    assert 'if (changed && ctx.state.view === "follow") ctx.actions.renderRooms();' in f
    assert _src("views/overview.js").count('irkInput.addEventListener("input", () => { if (irkSaveBtn._force)') == 2
    m = _src("views/manage.js")
    assert 'ctx.state.mode = "all";' not in m and 'ctx.state.mode = "live";' in m


def test_one_resize_listener_however_often_the_panel_reattaches():
    s = _src("panel.js")
    assert 'window.addEventListener("resize", () => this._fitHeight());' not in s
    assert 'if(this._resizeHandler) window.removeEventListener("resize", this._resizeHandler);' in s
    assert s.count('window.removeEventListener("resize", this._resizeHandler)') == 2   # re-attach and disconnect
