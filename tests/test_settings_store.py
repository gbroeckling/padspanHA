"""Unit tests for custom_components.padspan_ha.settings_store."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.settings_store import (
    DEFAULT_SETTINGS,
    SettingsStore,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _MockStore:
    """Minimal stand-in for homeassistant.helpers.storage.Store."""

    # What a Store also has, read when its file holds the wrong kind of data
    # (safe_store.async_load_readable): its key, its path (no file here, so
    # nothing to move aside) and Home Assistant's executor.
    key = "padspan_ha.settings"
    path = "/nonexistent/.storage/padspan_ha.settings"

    class hass:  # noqa: N801
        @staticmethod
        async def async_add_executor_job(func, *args):
            return func(*args)

    def __init__(self) -> None:
        self._data: dict | None = None

    async def async_load(self) -> dict | None:
        return self._data

    async def async_save(self, data: dict) -> None:
        self._data = data


def _make_settings(store_data: dict | None = None) -> tuple[SettingsStore, _MockStore]:
    """Create a SettingsStore backed by a _MockStore."""
    hass = MagicMock()
    ss = SettingsStore.__new__(SettingsStore)
    ss.hass = hass
    ms = _MockStore()
    ms._data = store_data
    ss.store = ms
    ss.data = dict(DEFAULT_SETTINGS)
    return ss, ms


# ---------------------------------------------------------------------------
# Tests: defaults
# ---------------------------------------------------------------------------


def test_default_data_mode() -> None:
    """Default data_mode is 'sample'."""
    assert DEFAULT_SETTINGS["data_mode"] == "sample"


def test_default_ref_power() -> None:
    """Default ref_power for distance formula."""
    assert DEFAULT_SETTINGS["ref_power"] == -59.0


def test_default_path_loss_exp() -> None:
    """Default path loss exponent."""
    assert DEFAULT_SETTINGS["path_loss_exp"] == 2.5


def test_default_kalman_params() -> None:
    """Kalman filter defaults are present."""
    assert "kalman_q" in DEFAULT_SETTINGS
    assert "kalman_r" in DEFAULT_SETTINGS
    assert DEFAULT_SETTINGS["kalman_q"] == 3.0
    assert DEFAULT_SETTINGS["kalman_r"] == 8.0


# ---------------------------------------------------------------------------
# Tests: async_load
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_async_load_no_saved_data() -> None:
    """Loading with no saved data returns defaults."""
    ss, ms = _make_settings(store_data=None)
    result = await ss.async_load()
    assert result["data_mode"] == "sample"
    assert result["ref_power"] == -59.0
    assert result["path_loss_exp"] == 2.5


@pytest.mark.asyncio
async def test_async_load_merges_with_defaults() -> None:
    """Saved data overrides defaults, but missing keys get default values."""
    ss, ms = _make_settings(store_data={"data_mode": "live"})
    result = await ss.async_load()
    # Saved value overrides
    assert result["data_mode"] == "live"
    # Defaults fill missing keys
    assert result["ref_power"] == -59.0
    assert result["kalman_q"] == 3.0


@pytest.mark.asyncio
async def test_async_load_saves_merged_result() -> None:
    """async_load saves the merged result back to disk."""
    ss, ms = _make_settings(store_data={"data_mode": "live"})
    await ss.async_load()
    # MockStore._data should now have the full merged settings
    assert ms._data is not None
    assert ms._data["data_mode"] == "live"
    assert ms._data["ref_power"] == -59.0


@pytest.mark.asyncio
async def test_async_load_non_dict_resets_to_defaults() -> None:
    """If store returns garbage (not a dict), reset to defaults."""
    ss, ms = _make_settings()
    ms._data = "corrupted"
    await ss.async_load()
    assert ss.data["data_mode"] == "sample"


# ---------------------------------------------------------------------------
# Tests: async_set
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_async_set_updates_value() -> None:
    """async_set updates the in-memory data."""
    ss, ms = _make_settings()
    await ss.async_set(data_mode="live", ref_power=-65.0)
    assert ss.data["data_mode"] == "live"
    assert ss.data["ref_power"] == -65.0


@pytest.mark.asyncio
async def test_async_set_persists_to_store() -> None:
    """async_set saves to the underlying store."""
    ss, ms = _make_settings()
    await ss.async_set(data_mode="live")
    assert ms._data is not None
    assert ms._data["data_mode"] == "live"


@pytest.mark.asyncio
async def test_async_set_preserves_other_keys() -> None:
    """Setting one key doesn't wipe others."""
    ss, ms = _make_settings()
    original_ref = ss.data["ref_power"]
    await ss.async_set(data_mode="live")
    assert ss.data["ref_power"] == original_ref


@pytest.mark.asyncio
async def test_async_set_returns_updated_data() -> None:
    """async_set returns the full updated data dict."""
    ss, ms = _make_settings()
    result = await ss.async_set(kalman_q=0.5)
    assert result["kalman_q"] == 0.5
    assert result["data_mode"] == "sample"  # unchanged


# ---------------------------------------------------------------------------
# Tests: get
# ---------------------------------------------------------------------------


def test_get_existing_key() -> None:
    """get() returns value for existing key."""
    ss, _ = _make_settings()
    assert ss.get("data_mode") == "sample"


def test_get_missing_key_default() -> None:
    """get() returns default for missing key."""
    ss, _ = _make_settings()
    assert ss.get("nonexistent", "fallback") == "fallback"


def test_get_missing_key_none() -> None:
    """get() returns None when no default given."""
    ss, _ = _make_settings()
    assert ss.get("nonexistent") is None
