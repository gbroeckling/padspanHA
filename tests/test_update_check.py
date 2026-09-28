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


# ── Daily licence recheck: a trial upgraded in place stops reading as a trial ──

import json  # noqa: E402
import sys  # noqa: E402
import types  # noqa: E402
from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402

from custom_components.padspan_ha.update_check import _revalidate_license  # noqa: E402


def _server_says(monkeypatch, payload: dict) -> None:
    class _Resp:
        async def text(self):
            return json.dumps(payload)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    session = MagicMock()
    session.get = MagicMock(return_value=_Resp())
    mod = types.ModuleType("homeassistant.helpers.aiohttp_client")
    mod.async_get_clientsession = lambda hass: session
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", mod)
    iid = types.ModuleType("homeassistant.helpers.instance_id")
    iid.async_get = AsyncMock(return_value="m1")
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.instance_id", iid)


@pytest.mark.asyncio
@pytest.mark.parametrize("plan,expect", [("lifetime", False), ("pro", False), ("trial", True)])
async def test_the_recheck_records_whether_the_key_is_a_trial(monkeypatch, plan, expect):
    hass = _hass_with({"forensics_license_key": "PSPAN-AAAA", "license_is_trial": True,
                       "forensics_license_expires": "2026-12-27 00:00:00", "license_tier": "bright"})
    st = hass.data[DOMAIN][DATA_SETTINGS]
    st.async_set = AsyncMock()
    _server_says(monkeypatch, {"valid": True, "plan": plan, "tier": "pro" if plan != "trial" else "bright",
                               "expires_at": "2099-12-31 00:00:00" if plan == "lifetime" else "2026-12-27 00:00:00"})
    await _revalidate_license(hass)
    if expect:
        assert "license_is_trial" not in (st.async_set.call_args.kwargs if st.async_set.called else {})
    else:
        assert st.async_set.call_args.kwargs["license_is_trial"] is False


@pytest.mark.asyncio
async def test_a_server_that_does_not_name_the_plan_changes_nothing(monkeypatch):
    hass = _hass_with({"forensics_license_key": "PSPAN-AAAA", "license_is_trial": True,
                       "forensics_license_expires": "2026-12-27 00:00:00"})
    st = hass.data[DOMAIN][DATA_SETTINGS]
    st.async_set = AsyncMock()
    _server_says(monkeypatch, {"valid": True, "expires_at": "2026-12-27 00:00:00"})
    await _revalidate_license(hass)
    assert not st.async_set.called
