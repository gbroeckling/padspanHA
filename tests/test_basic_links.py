# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Links that land on a screen Basic mode trims (interface review, 2026-10-30).

Basic's Mapping has only Library and Upload (maps.js sends any other tab back
to Library), and Basic's Settings only Appearance. A link into one of those
used to land on Library or Appearance, with no sign why:

  Calibration's "Measure this floor"  the set-up wizard's scale step, in every
                                      mode (as the accuracy tip "Measure" does)
  the accuracy tip "Floor Heights"    Mapping's 3D Stack: Basic switches to
                                      Advanced and says so (as Mapping's Open)
  Manage's "Open Settings", Guests'   Settings → Tracking, which a link opens
  "Open Settings", the tester sign-up in Basic too (state._settingsDeep)
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
    # The wizard is drawn before that, in every mode.
    assert maps.index("if (ctx.state._mapsWizard) {") < maps.index('if(isBasic && tab !== "library"')


def test_measure_this_floor_opens_the_wizard_scale_step() -> None:
    card = _between(_read("views/calibration.js"), "function _noScaleCard(", "\nconst CALIB_WIZARD_STEPS")
    assert 'ctx.state._mapsWizard = { step: 2, mapId: cs.mapId };' in card
    assert 'ctx.state.view = "maps";' in card
    assert '"edit"' not in card and "Mapping → Edit" not in card
    # The same step the accuracy tip opens.
    tip = _between(_read("panel.js"), "  _accuracyTipsCard(){", "\n  _proInviteOverviewCard(){")
    assert "this.state._mapsWizard = { step: 2, mapId: id };" in tip


def test_floor_heights_tip_switches_basic_and_says_so() -> None:
    tip = _between(_read("panel.js"), "  _accuracyTipsCard(){", "\n  _proInviteOverviewCard(){")
    fh = _between(tip, '} else if (t === "floor_heights") {', "} else {")
    assert 'if (this.state.complexity === "basic") {' in fh
    assert 'this._setComplexity("advanced");' in fh
    assert "this._toast(\"Floor heights are in Advanced mode" in fh
    assert fh.index("_setComplexity") < fh.index('this.state.mapsTab = "stack";')


def test_links_to_settings_tracking_open_it_in_basic() -> None:
    manage = _between(_read("views/manage.js"), '"data-goto":"settings-receivers"', "card.appendChild(")
    assert 'ctx.state._settingsDeep = "presence";' in manage
    guests = _read("views/guests.js")
    assert 'ctx.state._presenceReveal = "phones"; ctx.state._settingsDeep = "presence";' in guests
    settings = _read("views/settings.js")
    basic = _between(settings, "  if(isBasic){", "\n  // Advanced / Development mode: tabbed")
    assert 'if(ctx.state._settingsDeep === "presence"){' in basic
    deep = _between(basic, 'if(ctx.state._settingsDeep === "presence"){', "return root;")
    assert "root.appendChild(_settingsPresence(ctx, el));" in deep
    assert '"data-settings-back":"appearance"' in deep
    # Basic's own Settings links there too, so the messages naming
    # Settings → Tracking (the report, the trial, the invite) hold in Basic.
    assert '"data-settings-open":"presence"' in basic
    assert 'ctx.state._settingsDeep = "presence"; ctx.state._settingsTab = "presence";' in basic


def test_the_menu_forgets_the_link() -> None:
    sw = _between(_read("panel.js"), "    const _switchView = (id) => {", 'this._logEvent("view_change", id);')
    assert "this.state._settingsDeep = null;" in sw
