"""Tests for the cpu_mode setting and compute-executor selection.

Covers _effective_cpu_mode resolution (default, invalid values, dedicated
downgrade when pinning is unsupported), executor lifecycle across mode
changes, and the settings-store default.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS


def _make_coordinator(settings: dict[str, Any] | None = None) -> PresenceCoordinator:
    hass = MagicMock()
    mock_settings = MagicMock()
    mock_settings.data = settings or {}
    hass.data = {DOMAIN: {DATA_SETTINGS: mock_settings}}
    return PresenceCoordinator(hass)


def test_default_cpu_mode_is_shared() -> None:
    assert DEFAULT_SETTINGS["cpu_mode"] == "shared"
    coord = _make_coordinator({})
    assert coord._effective_cpu_mode() == "shared"


def test_invalid_cpu_mode_falls_back_to_shared() -> None:
    coord = _make_coordinator({"cpu_mode": "turbo"})
    assert coord._effective_cpu_mode() == "shared"


def test_single_mode_resolves() -> None:
    coord = _make_coordinator({"cpu_mode": "single"})
    assert coord._effective_cpu_mode() == "single"


def test_dedicated_downgrades_without_pinning_support() -> None:
    coord = _make_coordinator({"cpu_mode": "dedicated"})
    with patch.object(PresenceCoordinator, "cpu_pinning_supported", return_value=False):
        assert coord._effective_cpu_mode() == "single"
    with patch.object(PresenceCoordinator, "cpu_pinning_supported", return_value=True):
        assert coord._effective_cpu_mode() == "dedicated"


def test_missing_settings_store_defaults_shared() -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    coord = PresenceCoordinator(hass)
    assert coord._effective_cpu_mode() == "shared"


def test_executor_reused_for_same_mode() -> None:
    coord = _make_coordinator({"cpu_mode": "single"})
    ex1 = coord._compute_executor_for("single")
    ex2 = coord._compute_executor_for("single")
    assert ex1 is ex2
    coord.shutdown_compute_executor()


def test_executor_rebuilt_on_mode_change() -> None:
    coord = _make_coordinator({})
    ex_single = coord._compute_executor_for("single")
    ex_dedicated = coord._compute_executor_for("dedicated")
    assert ex_single is not ex_dedicated
    assert coord._compute_executor_mode == "dedicated"
    coord.shutdown_compute_executor()
    assert coord._compute_executor is None
    assert coord._compute_executor_mode is None


def test_executor_runs_work() -> None:
    coord = _make_coordinator({"cpu_mode": "single"})
    ex = coord._compute_executor_for("single")
    assert ex.submit(lambda: 41 + 1).result(timeout=5) == 42
    coord.shutdown_compute_executor()


def test_pin_compute_thread_never_raises() -> None:
    # Must be safe on every platform, including ones without sched_setaffinity.
    PresenceCoordinator._pin_compute_thread()
