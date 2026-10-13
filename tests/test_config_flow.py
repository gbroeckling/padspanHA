"""Unit tests for custom_components.padspan_ha.config_flow._clamp_interval."""

from __future__ import annotations

import pytest

from custom_components.padspan_ha.config_flow import _clamp_interval
from custom_components.padspan_ha.const import DEFAULT_SCAN_INTERVAL


# ---------------------------------------------------------------------------
# Tests: valid integer inputs
# ---------------------------------------------------------------------------


def test_clamp_normal_value() -> None:
    """A normal integer within range is returned unchanged."""
    assert _clamp_interval(30) == 30


def test_clamp_string_integer() -> None:
    """A string that represents an int is parsed correctly."""
    assert _clamp_interval("60") == 60


def test_clamp_float_truncated() -> None:
    """A float is truncated to int (int() truncates toward zero)."""
    assert _clamp_interval(15.9) == 15


# ---------------------------------------------------------------------------
# Tests: boundary / edge cases
# ---------------------------------------------------------------------------


def test_clamp_minimum_boundary() -> None:
    """Value exactly at the minimum (1) is kept."""
    assert _clamp_interval(1) == 1


def test_clamp_maximum_boundary() -> None:
    """Value exactly at the maximum (3600) is kept."""
    assert _clamp_interval(3600) == 3600


def test_clamp_below_minimum() -> None:
    """Values below 1 are clamped up to 1."""
    assert _clamp_interval(0) == 1
    assert _clamp_interval(-100) == 1


def test_clamp_above_maximum() -> None:
    """Values above 3600 are clamped down to 3600."""
    assert _clamp_interval(9999) == 3600
    assert _clamp_interval(3601) == 3600


# ---------------------------------------------------------------------------
# Tests: invalid / non-parseable inputs (ValueError / TypeError fallback)
# ---------------------------------------------------------------------------


def test_clamp_none_returns_default() -> None:
    """None triggers TypeError, which falls back to DEFAULT_SCAN_INTERVAL."""
    result = _clamp_interval(None)
    assert result == max(1, min(3600, DEFAULT_SCAN_INTERVAL))


def test_clamp_non_numeric_string_returns_default() -> None:
    """A non-numeric string triggers ValueError, falling back to default."""
    result = _clamp_interval("abc")
    assert result == max(5, min(3600, DEFAULT_SCAN_INTERVAL))


def test_clamp_empty_string_returns_default() -> None:
    """An empty string triggers ValueError, falling back to default."""
    result = _clamp_interval("")
    assert result == max(5, min(3600, DEFAULT_SCAN_INTERVAL))


def test_clamp_list_returns_default() -> None:
    """A list triggers TypeError, falling back to default."""
    result = _clamp_interval([10, 20])
    assert result == max(5, min(3600, DEFAULT_SCAN_INTERVAL))


def test_clamp_dict_returns_default() -> None:
    """A dict triggers TypeError, falling back to default."""
    result = _clamp_interval({"interval": 30})
    assert result == max(5, min(3600, DEFAULT_SCAN_INTERVAL))


# ---------------------------------------------------------------------------
# Tests: only ValueError and TypeError are caught
# ---------------------------------------------------------------------------


def test_clamp_does_not_catch_other_exceptions() -> None:
    """_clamp_interval only catches ValueError/TypeError.

    An object whose __int__ raises a different exception should propagate.
    """

    class BadObj:
        def __int__(self) -> int:
            raise RuntimeError("unexpected")

    with pytest.raises(RuntimeError, match="unexpected"):
        _clamp_interval(BadObj())


def test_clamp_does_not_catch_overflow() -> None:
    """OverflowError is not caught (e.g. from float('inf'))."""
    with pytest.raises(OverflowError):
        _clamp_interval(float("inf"))


def test_setup_asks_for_nothing_that_does_nothing():
    """Setup asked for an "Update interval (seconds)" that was only copied
    into diagnostics; presence polls at presence_poll_interval_s, set in the
    panel."""
    import inspect
    from custom_components.padspan_ha import config_flow
    src = inspect.getsource(config_flow.ConfigFlow.async_step_user)
    assert 'data_schema=vol.Schema({})' in src
