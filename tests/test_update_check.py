"""Tests for the daily update check (version parsing + enable gate)."""

from __future__ import annotations

from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from custom_components.padspan_ha.update_check import _enabled, _parse_version


def test_default_enabled() -> None:
    assert DEFAULT_SETTINGS["update_check_enabled"] is True


def test_parse_version() -> None:
    assert _parse_version("0.21.10") == (0, 21, 10)
    assert _parse_version("v1.2.3") == (1, 2, 3)
    assert _parse_version("garbage") is None
    assert _parse_version(None) is None
    assert _parse_version("0.21.10") > _parse_version("0.21.9")
    assert _parse_version("0.22.0") > _parse_version("0.21.10")


def _hass_with(settings: dict) -> MagicMock:
    hass = MagicMock()
    st = MagicMock()
    st.data = settings
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    return hass


def test_enabled_gate() -> None:
    assert _enabled(_hass_with({})) is True  # default on
    assert _enabled(_hass_with({"update_check_enabled": False})) is False
    assert _enabled(_hass_with({"update_check_enabled": True})) is True
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    assert _enabled(hass) is True  # store missing → default on
