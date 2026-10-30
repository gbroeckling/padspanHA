# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Links that land on a screen Basic mode trims (interface review, 2026-10-30).

Basic's Mapping has only Library and Upload (maps.js sends any other tab back
to Library), and Basic's Settings only Appearance. A link into one of those
used to land on Library or Appearance, with no sign why:

  Calibration's "Measure this floor"  the set-up wizard's scale step, in every
                                      mode (as the accuracy tip "Measure" does)
  the accuracy tip "Floor Heights"    in Basic only 3D Stack's Floor Heights
                                      card (views/focus.js); Basic stays Basic
  Guests' "Open Settings", the tester in Basic only the Guest tags or the usage
  sign-up                             report's card
  Manage's "Open Settings"            receiver tuning: not shown in Basic

Since 2026-10-30 (Garry: "no access to things that are so foreign to the user
that it doesn't tie together") a link from Basic opens just the part it is
about, with one "← Back", and no link changes the mode. Advanced and
Development open the whole tab as before. tests/js/basic_focus.mjs renders
every one of them (tests/test_basic_focus.py).
"""

from __future__ import annotations

from pathlib import Path

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _read(name: str) -> str:
    return (_WWW / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def _between(src: str, start: str, end: str) -> str:
    i = src.index(start)
    return src[i:src.index(end, i)]


def test_basic_mapping_tabs_are_library_and_upload_only() -> None:
    maps = _read("views/maps.js")
    assert '? [["library","Library"],["upload","Upload"]]' in maps
    assert 'if(isBasic && tab !== "library" && tab !== "upload"){' in maps
    # A link's part (the focus) and the wizard are drawn before that, in every mode.
    assert maps.index('const focus = FOCUS.focusFor(ctx.state, "maps");') < maps.index("if (ctx.state._mapsWizard) {")
    assert maps.index("if (ctx.state._mapsWizard) {") < maps.index('if(isBasic && tab !== "library"')


def test_measure_this_floor_opens_the_wizard_scale_step() -> None:
    card = _between(_read("views/calibration.js"), "function _noScaleCard(", "\nconst CALIB_WIZARD_STEPS")
    assert 'ctx.state._mapsWizard = { step: 2, mapId: cs.mapId };' in card
    assert 'ctx.state.view = "maps";' in card
    assert '"edit"' not in card and "Mapping → Edit" not in card
    # The same step the accuracy tip opens.
    tip = _between(_read("panel.js"), "  _accuracyTipsCard(){", "\n  _proInviteOverviewCard(){")
    assert "this.state._mapsWizard = { step: 2, mapId: id };" in tip


def test_floor_heights_tip_opens_only_its_card_and_basic_stays_basic() -> None:
    tip = _between(_read("panel.js"), "  _accuracyTipsCard(){", "\n  _proInviteOverviewCard(){")
    fh = _between(tip, '} else if (t === "floor_heights") {', "} else {")
    assert "_setComplexity" not in fh and "complexity" not in fh
    assert 'F.openFocus(this._ctx(), F.part("floorHeights"))' in fh


def test_links_to_settings_open_one_card_in_basic() -> None:
    guests = _read("views/guests.js")
    assert 'ctx.state._presenceReveal = "phones"; FOCUS.openFocus(ctx, FOCUS.part("guestTags"));' in guests
    settings = _read("views/settings.js")
    basic = _between(settings, "  if(isBasic){", "\n  // Advanced / Development mode: tabbed")
    assert 'const f = FOCUS.focusFor(ctx.state, "settings");' in basic
    assert "FOCUS.pickPart(_tabBody(f.tab), f.part)" in basic
    # Basic's own Settings has the two cards the messages name (the report,
    # the trial, the invite: "Settings → Tracking → Help improve PadSpan").
    assert '"data-settings-open":"usage_report"' in basic and "PART.usageReport" in basic
    assert '"data-settings-open":"guest_tags"' in basic and "PART.guestTags" in basic
    assert "_settingsDeep" not in settings


def test_receiver_tuning_has_no_link_in_basic() -> None:
    manage = _between(_read("views/manage.js"), '"data-goto":"settings-receivers"', "\n}\n")
    assert "FOCUS.expertLinks(ctx.state) ? go : null," in manage


def test_the_menu_and_other_screens_forget_the_focus() -> None:
    src = _read("panel.js")
    sw = _between(src, "    const _switchView = (id) => {", 'this._logEvent("view_change", id);')
    assert "this.state._focus = null;" in sw
    assert "_settingsDeep" not in src and "_mapsDeep" not in src
    show = _between(src, "        showView: (id, opts) => {", "        },")
    assert "this.state._focus = null;" in show
    assert "this.state._focus = null;" in _between(src, "  _openCountedView(id){", "\n  }\n")
    assert "this.state._focus = null;" in _between(src, "  _setComplexity(mode){", "\n  }\n")
