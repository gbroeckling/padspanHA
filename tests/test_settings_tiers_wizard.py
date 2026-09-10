# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Free/Bright/Bright Pro/Pro onboarding wizard.

Garry, 2026-09-09/10: "build a wizzard too" for the documentation/help-guide
pass, scoped (when asked which of the existing three guided wizards — Maps
setup, Calibration, the Lights builder tour — it should extend) to "Bright/Pro
onboarding": a dedicated, SEPARATE walkthrough of what each tier unlocks and
how to upgrade. Lives in settings.js, launched from the licence card rather
than auto-opened, matching the source-level pin style test_paywall_paths.py
already uses for this file (no established DOM-render harness for settings.js
to build a heavier test on).
"""

from __future__ import annotations

import pathlib
import re

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_HELP = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "help_content.js"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def test_the_wizard_has_exactly_the_three_scoped_steps():
    s = _read(_VIEWS / "settings.js")
    m = re.search(r"const TIERS_WIZARD_STEPS = \[(.*?)\];", s, re.S)
    assert m, "TIERS_WIZARD_STEPS is gone"
    body = m.group(1)
    for step_id in ("free", "ladder", "upgrade"):
        assert f'id: "{step_id}"' in body, f"wizard is missing its {step_id!r} step"
    assert body.count("{ n:") == 3, "the wizard must have exactly 3 steps"


def test_it_is_a_separate_state_key_from_the_other_three_wizards():
    """Garry: a SEPARATE wizard, not an extension of Maps/Calibration/the
    Lights tour — each of those already owns its own state key
    (_mapsWizard / _calibWizard / _lightsTour); this one must not collide."""
    s = _read(_VIEWS / "settings.js")
    assert "ctx.state._tiersWizard" in s
    for other in ("_mapsWizard", "_calibWizard", "_lightsTour"):
        assert f"ctx.state.{other} = " not in s, (
            f"the tiers wizard must not touch {other} — that's a different wizard's state")


def test_settings_features_short_circuits_to_the_wizard_when_open():
    s = _read(_VIEWS / "settings.js")
    i = s.index("function _settingsFeatures(")
    body = s[i:i + 300]
    assert "if (ctx.state._tiersWizard) return _tiersWizard(ctx);" in body, (
        "_settingsFeatures does not hand off to the wizard when it's open")


def test_the_licence_card_offers_a_way_to_launch_it():
    s = _read(_VIEWS / "settings.js")
    card = s[s.index("function _settingsLicence("):]
    card = card[:card.index("\nfunction _settingsFeatures(")]
    assert "_tiersWizard = { step: 1 }" in card, (
        "the licence card has no button that opens the tiers wizard")


def test_wizard_content_branches_on_this_installs_own_edition():
    """A Bright install must be told about Bright Pro's price/scope; a full
    PadSpan HA install must be told about Pro's — never both at once, and
    never the wrong one, since neither applies to what this install can
    actually buy."""
    s = _read(_VIEWS / "settings.js")
    ladder = s[s.index("function _tiersWizardLadder("):s.index("function _tiersWizardUpgrade(")]
    assert "isBright" in ladder
    assert "BRIGHT_PRICE" in ladder and "PRO_PRICE" in ladder, (
        "the ladder step must show the correct price for whichever branch is taken")


def test_wizard_prices_come_from_the_shared_editions_constants_not_literals():
    """The exact numbers ($35/$45/$12) are pinned once, in editions.js
    (tests/test_site_claims.py pins those against the real PayPal forms) —
    the wizard must reference the constants, not repeat the literal figures,
    so a price change can never drift between the site and this wizard."""
    s = _read(_VIEWS / "settings.js")
    wiz = s[s.index("const TIERS_WIZARD_STEPS"):s.index("// ── PadSpan licence")]
    for literal in ("$35", "$45", "$12"):
        assert literal not in wiz, f"the wizard hard-codes {literal!r} instead of using the shared constant"
    for name in ("BRIGHT_PRICE", "PRO_PRICE", "BRIGHT_UPGRADE_PRICE"):
        assert name in wiz, f"the wizard never references {name}"


def test_editions_js_exports_the_bright_price_constants():
    s = _read(_VIEWS / "editions.js")
    assert 'export const BRIGHT_PRICE = "$35 CAD/year";' in s
    assert 'export const BRIGHT_UPGRADE_PRICE = "$12 CAD";' in s


def test_help_content_has_a_tiers_entry():
    s = _read(_HELP)
    assert "settings_tiers:" in s, "no settings_tiers help entry"
    entry = s[s.index("settings_tiers:"):]
    entry = entry[:entry.index("\n  },")]
    for word in ("PadSpan Bright", "PadSpan Pro", "PadSpan Bright Pro", "Forensics"):
        assert word in entry, f"the tiers help entry never mentions {word!r}"


def test_the_wizard_help_button_points_at_the_new_entry():
    s = _read(_VIEWS / "settings.js")
    wiz = s[s.index("function _tiersWizard("):s.index("// ── PadSpan licence")]
    assert 'helpBtn("settings_tiers")' in wiz
