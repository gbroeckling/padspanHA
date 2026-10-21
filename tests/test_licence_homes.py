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
    assert p == {"t": "1", "token": "a" * 32, "version": VERSION, "label": "Cabin"}
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
    assert '_hs if _hs in ("activation_limit", "activation_rate", "homes_frozen")' in up, "a refused home is said in Settings"
    fo = _src("ws_forensics.py")
    assert '"machine": machine, **_hp}' in fo, "activation"
    assert '_hp["token"] = ""' in fo, "a different key starts the home afresh"
    assert '"type": "padspan_ha/licence_homes"' in fo and 'vol.In(["list", "remove", "label"])' in fo
    assert "websocket_api.async_register_command(hass, ws_licence_homes)" in _src("websocket.py")


def test_the_token_never_leaves_the_backend_and_survives_a_reset():
    assert 'out["license_home_token"] = ""' in _src("ws_common.py")
    assert '"license_home_token", "license_home_label")' in _src("ws_factory_reset.py"), \
        "a reset home is still the same home, not a copy"


def test_settings_lists_the_homes_on_request():
    js = _src("www/padspan-ha/views/settings.js")
    assert "if (hasKey) card.appendChild(_licenceHomes(ctx, el, s));" in js
    assert 'wsCall("padspan_ha/licence_homes", { op, ...(extra || {}) })' in js
    assert "Show this key's homes" in js, "opening Settings never calls the licence server"
    for status in ("activation_limit", "activation_rate", "homes_frozen"):
        assert status + ":" in js
