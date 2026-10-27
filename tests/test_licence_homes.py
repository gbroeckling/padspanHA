# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""One licence key, up to five homes (0.38.160). The licence server counts
them; this side says which home it is (its instance id and a rolling token)
and keeps the token the server answers with."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from custom_components.padspan_ha import licence_homes as LH
from custom_components.padspan_ha.const import VERSION
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_PKG = Path(LH.__file__).parent


def _src(rel: str) -> str:
    return (_PKG / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


class _St:
    def __init__(self, data):
        self.data = dict(data)

    async def async_set(self, **kw):
        self.data.update(kw)


def test_a_check_says_which_home_it_is():
    p = LH.home_params({"license_home_token": "a" * 32, "license_home_label": "Cabin"})
    assert p == {"t": "1", "token": "a" * 32, "version": VERSION, "label": "Cabin", "report": "0"}
    assert LH.home_params(None)["token"] == "", "a home without a token yet asks for one"
    for k in ("license_home_token", "license_home_label", "license_home_status"):
        assert DEFAULT_SETTINGS[k] == ""


def test_only_a_real_new_token_is_kept():
    st = _St({"license_home_token": "a" * 32})
    asyncio.run(LH.keep_token(st, {"token": "b" * 32}))
    assert st.data["license_home_token"] == "b" * 32
    for bad in ({}, {"token": None}, {"token": "short"}, None):
        asyncio.run(LH.keep_token(st, bad))
        assert st.data["license_home_token"] == "b" * 32, bad


def test_both_server_calls_send_it_and_keep_the_answer():
    up = _src("update_check.py")
    assert "**home_params(st.data)}" in up and "await keep_token(st, data)" in up, "the daily check"
    assert '_hs if _hs in ("activation_limit", "activation_rate", "homes_frozen", "needs_report", "removed", "needs_all_reports")' in up, "a refused home is said in Settings"
    fo = _src("ws_forensics.py")
    assert '"machine": machine, **_hp}' in fo, "activation"
    assert '_hp["token"] = ""' in fo, "a different key starts the home afresh"
    assert '"type": "padspan_ha/licence_homes"' in fo and 'vol.In(["list", "remove", "label"])' in fo
    assert "websocket_api.async_register_command(hass, ws_licence_homes)" in _src("websocket.py")


def test_the_token_never_leaves_the_backend_and_survives_a_reset():
    assert 'out["license_home_token"] = ""' in _src("ws_common.py")
    assert '"license_home_token", "license_home_label", "license_homes_used", "report_locked_key")' in _src("ws_factory_reset.py"), \
        "a reset home is still the same home, not a copy"


def test_settings_lists_the_homes_on_request():
    js = _src("www/padspan-ha/views/settings.js")
    assert "if (hasKey) card.appendChild(_licenceHomes(ctx, el, s));" in js
    assert 'wsCall("padspan_ha/licence_homes", { op, ...(extra || {}) })' in js
    assert "Show this key's homes" in js, "opening Settings never calls the licence server"
    for status in ("activation_limit", "activation_rate", "homes_frozen", "removed"):
        assert status + ":" in js


def test_homes_after_the_first_two_need_the_usage_report_and_are_seen_together():
    from custom_components.padspan_ha import telemetry as T
    assert LH.home_params({"telemetry_enabled": True})["report"] == "1"
    assert LH.home_params({})["report"] == "0", "off by default, and said so"
    g = T.licence_group("pspan-abcd-efgh")
    assert g == T.licence_group("PSPAN-ABCD-EFGH") and len(g) == 16 and "PSPAN" not in g, "the same in every home, never the key"
    assert T.licence_group("") is None
    T.assert_shareable({"schema": 1, "licence_group": g})
    import pytest
    with pytest.raises(ValueError):
        T.assert_shareable({"schema": 1, "licence_group": "PSPAN-ABCD-EFGH"})
    php_path = _PKG.parents[1] / "server" / "telemetry.php"
    if php_path.exists():  # the Bright derivation carries no server/
        php = php_path.read_text(encoding="utf-8")
        assert "'licence_group'" in php and "/^[0-9a-f]{16}\z/" in php, "the receiver takes it, and only that shape"
    js = _src("www/padspan-ha/views/settings.js")
    assert "needs_report:" in js and "with a licence used on more than two homes, a short code made from the key (never the key)" in js
    assert '"needs_report", "removed", "needs_all_reports") else ""' in _src("update_check.py")


def test_a_house_with_one_or_two_homes_sends_the_same_report_as_before():
    src = _src("telemetry.py")
    assert 'if _grp and int(_sd.get("license_homes_used") or 0) > 2:' in src, "the group code only past two homes"
    st = _St({"license_homes_used": 0})
    asyncio.run(LH.keep_token(st, {"homes_used": 3}))
    assert st.data["license_homes_used"] == 3
    for bad in ({"homes_used": True}, {"homes_used": "3"}, {"homes_used": -1}):
        asyncio.run(LH.keep_token(st, bad))
        assert st.data["license_homes_used"] == 3, bad


def test_a_restore_a_new_key_or_a_bad_answer_never_costs_the_home_its_place():
    bk = _src("ws_backup.py")
    assert '"license_home_token", "license_home_label",' in bk, "a restore keeping the live key keeps this home's token"
    assert '_LICENCE_KEYS + ("license_home_token", "license_home_label", "license_homes_used")' in _src("bright_import.py")
    assert 'license_home_token="", license_homes_used=0, license_home_status="",' in _src("ws_forensics.py"), "a trial key: a fresh home"
    assert '"license_home_token": "", "license_homes_used": 0,' in _src("pro_invite.py"), "an invite key: a fresh home"
    assert '"license_home_token", "license_home_label", "license_homes_used", "report_locked_key")' in _src("ws_factory_reset.py")
    assert "if resp.status >= 400:" in _src("licence_homes.py")
    assert '"homes_max": _n(data.get("homes_max"), 5)' in _src("ws_forensics.py"), "a malformed answer can't raise"


def _activate(monkeypatch, stored, answer, key):
    import json
    import sys
    import types
    from unittest.mock import MagicMock
    from custom_components.padspan_ha import ws_forensics as F
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

    class _Resp:
        async def text(self):
            return json.dumps(answer)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    session = MagicMock()
    session.get = MagicMock(return_value=_Resp())
    mod = types.ModuleType("homeassistant.helpers.aiohttp_client")
    mod.async_get_clientsession = lambda hass: session
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", mod)
    monkeypatch.setattr(F, "_invalidate_snapshot_cache", lambda hass: None)
    monkeypatch.setattr(F, "_get_settings", lambda hass: {})

    async def _mid(hass):
        return "m1"
    monkeypatch.setattr(LH, "machine_id", _mid)
    st = _St(stored)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}})
    asyncio.run(F.ws_forensics_license_activate(hass, MagicMock(), {"id": 1, "key": key}))
    return st.data, session.get.call_args.kwargs["params"]


def test_the_same_key_again_keeps_the_home_when_the_answer_has_no_token(monkeypatch):
    stored = {"forensics_license_key": "PSPAN-AAAA", "license_home_token": "a" * 32, "license_homes_used": 3}
    data, sent = _activate(monkeypatch, stored, {"valid": True, "expires_at": "2027-01-01"}, "pspan-aaaa")
    assert sent["token"] == "a" * 32
    assert data["license_home_token"] == "a" * 32 and data["license_homes_used"] == 3
    data, _ = _activate(monkeypatch, stored, {"valid": True, "token": "b" * 32, "homes_used": 4}, "PSPAN-AAAA")
    assert data["license_home_token"] == "b" * 32 and data["license_homes_used"] == 4


def test_a_different_key_starts_the_home_afresh(monkeypatch):
    stored = {"forensics_license_key": "PSPAN-AAAA", "license_home_token": "a" * 32, "license_homes_used": 3}
    data, sent = _activate(monkeypatch, stored, {"valid": True}, "PSPAN-BBBB")
    assert sent["token"] == ""
    assert data["license_home_token"] == "" and data["license_homes_used"] == 0
    data, _ = _activate(monkeypatch, stored, {"valid": True, "token": "c" * 32, "homes_used": "2"}, "PSPAN-BBBB")
    assert data["license_home_token"] == "c" * 32 and data["license_homes_used"] == 2


def test_a_removed_home_asks_for_a_free_place_again_with_the_same_key(monkeypatch):
    stored = {"forensics_license_key": "PSPAN-AAAA", "license_home_token": "a" * 32, "license_homes_used": 2,
              "license_home_status": "removed"}
    data, sent = _activate(monkeypatch, stored, {"valid": True, "token": "d" * 32, "homes_used": 2}, "PSPAN-AAAA")
    assert sent["token"] == "", "the removed token would only be refused again"
    assert data["license_home_token"] == "d" * 32 and data["license_home_status"] == ""
    # Refused (no free place): the stored token is left as it was.
    data, _ = _activate(monkeypatch, dict(stored), {"valid": False, "status": "activation_limit"}, "PSPAN-AAAA")
    assert data["license_home_token"] == "a" * 32
