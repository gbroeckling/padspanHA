# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The tier model — licence.py.

Four programs, two dials: the EDITION is which build was downloaded, the TIER
is what the key says. `free < bright < pro`, Pro a strict superset, so every
gate is one comparison. The floor is a build constant, never fetched; the
server can only raise the tier. And the one rule that must never go wrong:
a key with no tier field resolves to `pro`.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from custom_components.padspan_ha import licence
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN


def test_a_key_with_no_tier_field_is_a_pro_key() -> None:
    """THE demotion guard. Every key issued before the tier field existed is a
    Pro key; resolving it low would silently demote every paying customer on
    the release that ships the field."""
    assert licence.key_tier({"forensics_license_key": "PSPAN-AAAA-BBBB"}) == "pro"
    assert licence.key_tier({"forensics_license_key": "PSPAN-AAAA-BBBB", "license_tier": ""}) == "pro"
    assert licence.key_tier({"forensics_license_key": "PSPAN-AAAA-BBBB", "license_tier": "garbage"}) == "pro"
    assert licence.key_tier({"forensics_license_key": "PSPAN-AAAA-BBBB", "license_tier": "bright"}) == "bright"
    assert licence.key_tier({"forensics_license_key": ""}) == "free"
    assert licence.key_tier({}) == "free"


def test_the_ladder_is_strict_and_a_gate_is_one_comparison() -> None:
    assert licence.tier_at_least("pro", "bright") and licence.tier_at_least("pro", "pro")
    assert licence.tier_at_least("bright", "bright") and not licence.tier_at_least("bright", "pro")
    assert not licence.tier_at_least("free", "bright")
    assert licence.tier_at_least("nonsense", "free")          # unknown reads as free


def test_effective_tier_is_max_of_floor_and_key_while_active() -> None:
    pro = {"forensics_license_key": "K", "license_tier": "pro"}
    bright = {"forensics_license_key": "K", "license_tier": "bright"}
    assert licence.effective_tier(pro, True, floor="free") == "pro"
    assert licence.effective_tier(bright, True, floor="free") == "bright"
    assert licence.effective_tier(bright, False, floor="free") == "free"    # lapsed past grace: the floor
    assert licence.effective_tier({}, False, floor="free") == "free"        # PadSpan HA, no key
    # The server can only RAISE: a floor above the key wins.
    assert licence.effective_tier(bright, True, floor="pro") == "pro"


def test_the_override_can_only_lower_never_raise() -> None:
    pro = {"forensics_license_key": "K", "license_tier": "pro", "license_tier_override": "free"}
    assert licence.effective_tier(pro, True, floor="free") == "free"
    sneaky = {"license_tier_override": "pro"}                              # no key at all
    assert licence.effective_tier(sneaky, False, floor="free") == "free"
    lapsed = {"forensics_license_key": "K", "license_tier_override": "pro"}
    assert licence.effective_tier(lapsed, False, floor="free") == "free"


def test_the_floor_is_the_builds_and_defaults_free() -> None:
    from custom_components.padspan_ha.build_info import EDITION, TIER_FLOOR
    assert EDITION in ("full", "bright")
    assert TIER_FLOOR == "free", "the free floor is permanent once built; changing it is a product decision"
    assert licence.effective_tier({}, False) == "free"


def test_the_running_gate_reads_the_settings_store() -> None:
    """hass_tier goes through the same expiry rule the old gate used."""
    settings = SimpleNamespace(data={"forensics_license_key": "K", "license_tier": "bright"})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: settings}}
    assert licence.hass_tier(hass) == "bright"
    assert licence.hass_tier_at_least(hass, "bright") and not licence.hass_tier_at_least(hass, "pro")
    settings.data["license_tier"] = None            # an old key: pro
    assert licence.hass_tier(hass) == "pro"
    settings.data["forensics_license_key"] = ""
    assert licence.hass_tier(hass) == "free"


def test_settings_export_carries_the_tier_and_edition() -> None:
    from custom_components.padspan_ha.ws_common import _get_settings
    settings = SimpleNamespace(data={"forensics_license_key": "K", "license_tier": "bright"})
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: settings}}
    out = _get_settings(hass)
    assert out["tier"] == "bright" and out["edition"] in ("full", "bright") and out["tier_floor"] == "free"
    assert out["forensics_license_key"] == ""      # never leaves the backend
    assert out["pro_active"] is True                # a valid key of any tier
