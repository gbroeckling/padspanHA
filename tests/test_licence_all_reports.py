# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""0.38.163: a key on more than two homes needs every home's usage report on.

The licence server decides (its homes_warning / needs_all_reports answers);
this side keeps what it said, says it in Settings, asks before the report
goes off on such a key, and lets the server know soon after it flips. Keys
on one or two homes see nothing new."""

from __future__ import annotations

import asyncio
import json
import pathlib
import shutil
import subprocess
from unittest.mock import AsyncMock

import pytest

from custom_components.padspan_ha import licence_homes as LH
from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from custom_components.padspan_ha.update_check import _revalidate_license

from tests.test_update_check import _hass_with, _server_says

_PKG = pathlib.Path(LH.__file__).parent
_VIEWS = _PKG / "www" / "padspan-ha" / "views"
WARN = {"homes_warning": "reports_off", "homes_grace_until": "2026-11-06T19:05:43Z", "homes_off_labels": ["Cabin", "Shop"]}


def _src(rel: str) -> str:
    return (_PKG / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


class _St:
    def __init__(self, data):
        self.data = dict(data)

    async def async_set(self, **kw):
        self.data.update(kw)


def test_the_warning_is_read_only_as_the_server_says_it():
    assert LH.homes_warning(WARN) == {"warning": "reports_off", "grace_until": "2026-11-06T19:05:43Z", "off_labels": ["Cabin", "Shop"]}
    for none in (None, {}, {"valid": True}, {"homes_warning": "other"}, "x"):
        assert LH.homes_warning(none) == {}, none
    w = LH.homes_warning({"homes_warning": "reports_off", "homes_off_labels": ["x" * 90, 3, None] + ["h"] * 9})
    assert w["off_labels"][0] == "x" * 60 and len(w["off_labels"]) == 5 and all(isinstance(x, str) for x in w["off_labels"])
    assert LH.homes_warning({"homes_warning": "reports_off", "homes_off_labels": "Cabin"})["off_labels"] == []
    assert DEFAULT_SETTINGS["license_homes_warning"] == {}, "off by default: nothing to say"


def test_a_warning_is_kept_and_an_answer_without_one_clears_it():
    st = _St({"license_homes_warning": {}})
    asyncio.run(LH.keep_warning(st, WARN))
    assert st.data["license_homes_warning"]["off_labels"] == ["Cabin", "Shop"]
    asyncio.run(LH.keep_warning(st, {"valid": True}))
    assert st.data["license_homes_warning"] == {}


@pytest.mark.asyncio
async def test_the_daily_check_keeps_the_warning_and_leaves_the_licence(monkeypatch):
    hass = _hass_with({"forensics_license_key": "PSPAN-AAAA", "forensics_license_expires": "2027-10-01 00:00:00",
                       "license_homes_warning": {}})
    st = hass.data[DOMAIN][DATA_SETTINGS]
    st.async_set = AsyncMock()
    _server_says(monkeypatch, {"valid": True, "expires_at": "2027-10-01 00:00:00", **WARN})
    await _revalidate_license(hass)
    st.async_set.assert_called_once_with(license_homes_warning=LH.homes_warning(WARN))


@pytest.mark.asyncio
async def test_a_two_home_check_writes_nothing_new(monkeypatch):
    hass = _hass_with({"forensics_license_key": "PSPAN-AAAA", "forensics_license_expires": "2027-10-01 00:00:00",
                       "license_homes_warning": {}})
    st = hass.data[DOMAIN][DATA_SETTINGS]
    st.async_set = AsyncMock()
    _server_says(monkeypatch, {"valid": True, "expires_at": "2027-10-01 00:00:00", "homes_used": 2})
    await _revalidate_license(hass)
    assert not any("license_homes_warning" in c.kwargs for c in st.async_set.call_args_list)


@pytest.mark.asyncio
async def test_needs_all_reports_ends_pro_now_and_names_the_homes(monkeypatch):
    """The server already gave the 14 days: no second grace on this side."""
    from datetime import datetime, timedelta, timezone
    from custom_components.padspan_ha.ws_common import PRO_GRACE_DAYS, _pro_expiry_state
    data = {"forensics_license_key": "PSPAN-AAAA", "forensics_license_expires": "2027-10-01T00:00:00+00:00",
            "license_home_status": "", "license_homes_warning": {}}
    hass = _hass_with(data)
    st = hass.data[DOMAIN][DATA_SETTINGS]
    st.async_set = AsyncMock(side_effect=lambda **kw: data.update(kw))
    _server_says(monkeypatch, {"valid": False, "status": "needs_all_reports", **WARN})
    await _revalidate_license(hass)
    calls = [c.kwargs for c in st.async_set.call_args_list]
    assert calls[0] == {"license_home_status": "needs_all_reports"}
    assert calls[1] == {"license_homes_warning": LH.homes_warning(WARN)}
    written = datetime.fromisoformat(calls[-1]["forensics_license_expires"])
    assert written < datetime.now(timezone.utc) - timedelta(days=PRO_GRACE_DAYS)
    assert _pro_expiry_state(hass)["active"] is False, "Pro off at once"
    st.async_set.reset_mock()
    await _revalidate_license(hass)
    assert not any("forensics_license_expires" in c.kwargs for c in st.async_set.call_args_list), "repeats change nothing"
    # Every home's report back on: the next valid answer brings the real date back.
    _server_says(monkeypatch, {"valid": True, "expires_at": "2027-10-01 00:00:00"})
    await _revalidate_license(hass)
    assert data["forensics_license_expires"] == "2027-10-01 00:00:00" and data["license_home_status"] == ""
    assert _pro_expiry_state(hass)["active"] is True and data["license_homes_warning"] == {}


@pytest.mark.asyncio
async def test_activation_limit_still_keeps_the_local_grace(monkeypatch):
    from datetime import datetime, timezone
    hass = _hass_with({"forensics_license_key": "PSPAN-AAAA", "forensics_license_expires": "2027-10-01T00:00:00+00:00"})
    st = hass.data[DOMAIN][DATA_SETTINGS]
    st.async_set = AsyncMock()
    _server_says(monkeypatch, {"valid": False, "status": "activation_limit"})
    await _revalidate_license(hass)
    written = datetime.fromisoformat(st.async_set.call_args.kwargs["forensics_license_expires"])
    assert abs((datetime.now(timezone.utc) - written).total_seconds()) < 60


def test_activation_says_why_a_new_home_cant_join_and_keeps_the_warning():
    from custom_components.padspan_ha import ws_forensics as F
    assert F.NEEDS_ALL_REPORTS_JOIN == ("To use this key on more than 2 homes, turn on the usage report on all of them, "
                                        "including this one.")
    fo = _src("ws_forensics.py")
    assert '(NEEDS_ALL_REPORTS_JOIN if data.get("status") == "needs_all_reports" else None)' in fo
    assert "license_homes_warning=homes_warning(data)," in fo
    assert 'license_home_token="", license_homes_used=0, license_home_status="",\n            license_homes_warning={},' in fo, "a trial key: nothing to warn"
    assert '"license_homes_warning": {},' in _src("pro_invite.py"), "an invite key: nothing to warn"
    assert '"license_home_status", "license_homes_used",\n                                           "license_homes_warning"):' in _src("ws_backup.py"), \
        "a restored backup keeps this home's own warning"


def test_the_report_flipping_tells_the_licence_server_soon():
    src = _src("ws_settings.py")
    i = src.index('_tel_before = bool(st.data.get("telemetry_enabled"))')
    j = src.index("await st.async_set(**payload)", i)
    k = src.index("hass.async_create_task(_revalidate_license(hass))", j)
    block = src[j:k]
    assert 'payload["telemetry_enabled"] != _tel_before' in block and 'st.data.get("forensics_license_key")' in block, \
        "only a real flip, and only with a key"


def test_settings_says_it_and_asks_first():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    res = subprocess.run([node, str(pathlib.Path(__file__).parent / "js" / "licence_homes_warning.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout[-2000:] + res.stderr[-2000:]
    out = json.loads(lines[-1])
    assert not out["failures"] and res.returncode == 0, out["failures"]
    c = out["cases"]
    assert c["card_two_homes"]["warning"] is None, "one or two homes: nothing new on the card"
    assert c["card_warned"]["warning"].startswith(
        "⚠ This key is on 3 homes. Every home on a key with more than 2 must keep the usage report on. "
        "The report is off on: Cabin, <b>Shop</b>. Unless it's turned back on by ")
    assert "2026" in c["card_warned"]["warning"] and c["card_warned"]["warning"].endswith(
        ", the homes beyond your first two stop using Pro."), "the date, and what happens"
    assert c["card_stopped_other"]["warning"] == (
        "⚠ This home stopped using Pro because the usage report is off on another home on this key (Cabin, <b>Shop</b>). "
        "Turn it back on there and this home picks up again at its next check."), "labels are text, never markup"
    assert "its own usage report is off" in c["card_stopped_own"]["warning"]
    ask = ("This key is used on 3 homes. With more than 2, every home must keep the report on. If you turn it off here, "
           "the homes beyond your first two stop using Pro within 14 days unless it's back on.")
    assert c["off_three_cancel"] == {"asked": [ask], "sets": []}, "Cancel keeps it on"
    assert c["off_three_ok"] == {"asked": [ask], "sets": [{"telemetry_enabled": False}]}
    for k in ("off_two", "off_no_key"):
        assert c[k] == {"asked": [], "sets": [{"telemetry_enabled": False}]}, (k, "unchanged: no question")
    assert c["on_three"] == {"asked": [], "sets": [{"telemetry_enabled": True}]}, "turning it on asks nothing"
    assert "The report is off on: Cabin, <b>Shop</b>." in c["card_warned"]["warning"]
    assert "The report is off on, or PadSpan needs updating on: Cabin, Home 3 (update PadSpan)." in c["card_update"]["warning"], \
        "a home too old to say its report is on is named as needing an update"
    run = c["off_three_running"]["asked"][0]
    assert run.startswith("This key is used on 3 homes. With more than 2, every home must keep the report on. "
                          "If you turn it off here, the homes beyond your first two stop using Pro on ") and "2026" in run \
        and run.endswith(" unless it's back on.") and "within 14 days" not in run, "a grace already running: its own date"
    assert c["list_down_to_two"] == {"before": True, "after": False}, "removed down to two homes: the warning goes at once"
    assert c["list_still_three"] == {"before": True, "after": True}
