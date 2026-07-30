# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Tests for the user-selectable object-history retention window.

Only objects that were never identified are subject to this TTL — the value
bounds anonymous rotating-MAC churn, which ships in every live_snapshot.
"""

from __future__ import annotations

from typing import Any

import pytest

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from custom_components.padspan_ha.websocket import (
    _OBJECT_HISTORY_DAY_CHOICES,
    _OBJECT_HISTORY_DAYS_DEFAULT,
    _object_history_ttl_s,
)

DAY = 86400


class _FakeSettings:
    def __init__(self, data: dict[str, Any]) -> None:
        self._data = data

    def get(self, key, default=None):
        return self._data.get(key, default)


class _FakeHass:
    def __init__(self, settings: dict[str, Any] | None = None) -> None:
        self.data: dict[str, Any] = {DOMAIN: {}}
        if settings is not None:
            self.data[DOMAIN][DATA_SETTINGS] = _FakeSettings(settings)


@pytest.mark.parametrize("days", _OBJECT_HISTORY_DAY_CHOICES)
def test_each_offered_choice_maps_to_its_seconds(days: int) -> None:
    assert _object_history_ttl_s(_FakeHass({"object_history_days": days})) == days * DAY


class TestOfferedChoices:
    def test_choices_are_the_four_advertised(self) -> None:
        assert _OBJECT_HISTORY_DAY_CHOICES == (1, 2, 7, 14)

    def test_default_is_one_day(self) -> None:
        assert _OBJECT_HISTORY_DAYS_DEFAULT == 1
        assert _object_history_ttl_s(_FakeHass({})) == DAY

    def test_default_setting_matches_helper_default(self) -> None:
        """The stored default and the fallback must not drift apart."""
        assert DEFAULT_SETTINGS["object_history_days"] == _OBJECT_HISTORY_DAYS_DEFAULT

    def test_fourteen_days_is_the_ceiling(self) -> None:
        assert max(_OBJECT_HISTORY_DAY_CHOICES) * DAY == 14 * DAY


class TestRejectsBadValues:
    @pytest.mark.parametrize(
        "bad",
        [0, -1, 3, 30, 365, 1.5, "7", None, "", [], {}, True],
    )
    def test_unoffered_value_falls_back_to_default(self, bad: Any) -> None:
        """Hand-edited settings files must not produce a surprise TTL."""
        assert _object_history_ttl_s(_FakeHass({"object_history_days": bad})) == DAY

    def test_missing_settings_store_falls_back(self) -> None:
        assert _object_history_ttl_s(_FakeHass()) == DAY

    def test_empty_hass_data_falls_back(self) -> None:
        hass = _FakeHass()
        hass.data = {}
        assert _object_history_ttl_s(hass) == DAY

    def test_raising_settings_store_falls_back(self) -> None:
        """A broken store must not take the snapshot build down with it."""
        class _Boom:
            def get(self, *a, **k):
                raise RuntimeError("store unavailable")

        hass = _FakeHass()
        hass.data[DOMAIN][DATA_SETTINGS] = _Boom()
        assert _object_history_ttl_s(hass) == DAY
