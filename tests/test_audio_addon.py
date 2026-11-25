# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Audio add-on (the owner, 2026-11-25): volume, mute and off for each
room's players on the map, sold to installs without Pro for $6.45 CAD, one
payment for two years, up to three homes. PadSpan Pro includes it.

Its key resolves to the free tier and carries "audio" (license_addons). The
rule that must never go wrong: an add-on key is never Pro, here or on the
licence server, which answers an audio key only to a PadSpan that sends
addons=audio (older ones read any valid key as Pro). The server's side is
tested in the licence server's own repository.
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_PKG = Path(licence.__file__).parent
_VIEWS = _PKG / "www" / "padspan-ha" / "views"
AUDIO = {"forensics_license_key": "PSPAN-AUDI-OOOO-OOOO-0001", "license_tier": "free", "license_addons": ["audio"]}


def _src(rel: str) -> str:
    return (_PKG / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


# ── licence.py: never Pro ────────────────────────────────────────────────────

def test_an_audio_key_never_resolves_to_pro() -> None:
    assert licence.key_tier(AUDIO) == "free"
    # Even if the tier were lost or garbled, a key that carries an add-on reads free.
    for tier in (None, "", "garbage"):
        assert licence.key_tier({**AUDIO, "license_tier": tier}) == "free", tier
    for active in (True, False):
        t = licence.effective_tier(AUDIO, active, floor="free")
        assert t == "free" and not licence.tier_at_least(t, "bright") and not licence.tier_at_least(t, "pro")
    # The demotion guard is untouched: a key with no tier and no add-on is Pro.
    assert licence.key_tier({"forensics_license_key": "PSPAN-OLDK"}) == "pro"
    assert licence.key_tier({"forensics_license_key": "PSPAN-OLDK", "license_addons": []}) == "pro"
    assert licence.key_tier({"forensics_license_key": "PSPAN-OLDK", "license_addons": ["video"]}) == "pro"


def test_the_running_gates_never_open_pro_for_an_audio_key() -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(AUDIO))}}
    assert licence.hass_tier(hass) == "free"
    assert not licence.hass_tier_at_least(hass, "pro") and not licence.hass_tier_at_least(hass, "bright")
    assert licence.hass_audio_allowed(hass) is True
    from custom_components.padspan_ha.ws_common import _padspan_pro_active, _tier_at_least
    assert _padspan_pro_active(hass) is False and _tier_at_least(hass, "bright") is False


def test_audio_is_pro_or_an_active_key_that_carries_it() -> None:
    pro = {"forensics_license_key": "K", "license_tier": "pro"}
    assert licence.audio_allowed(pro, True) is True                          # Pro includes every add-on
    assert licence.audio_allowed({"forensics_license_key": "K"}, True) is True   # an old Pro key (no tier)
    assert licence.audio_allowed(AUDIO, True) is True
    assert licence.audio_allowed(AUDIO, False) is False                      # lapsed past the grace
    assert licence.audio_allowed(pro, False) is False
    assert licence.audio_allowed({"license_addons": ["audio"]}, True) is False   # no key at all
    assert licence.audio_allowed({"forensics_license_key": "K", "license_tier": "bright"}, True) is False
    assert licence.audio_allowed({}, False) is False and licence.audio_allowed(None, False) is False
    # The developer's override only lowers: Pro looked at as free has no add-on.
    assert licence.audio_allowed({**pro, "license_tier_override": "free"}, True) is False


def test_add_ons_are_read_strictly() -> None:
    assert licence.ADDONS == ("audio",)
    assert licence.normalize_addons(["audio"]) == ["audio"]
    assert licence.normalize_addons([" AUDIO ", "video", 3, None, "audio"]) == ["audio"]
    for bad in (None, "audio", {"audio": True}, 1, []):
        assert licence.normalize_addons(bad) == []


def test_the_settings_payload_says_whether_audio_is_licensed() -> None:
    from custom_components.padspan_ha.ws_common import _get_settings
    for data, want in ((AUDIO, True), ({"forensics_license_key": "K", "license_tier": "pro"}, True),
                       ({**AUDIO, "forensics_license_expires": "2020-01-01 00:00:00"}, False), ({}, False)):
        hass = MagicMock()
        hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(data))}}
        out = _get_settings(hass)
        assert out["audio_licensed"] is want, data
    assert out["forensics_license_key"] == ""


# ── What is sent, and what is kept ───────────────────────────────────────────

def test_every_validate_says_this_padspan_knows_audio() -> None:
    from custom_components.padspan_ha import licence_homes as LH
    assert LH.home_params({})["addons"] == "audio" and LH.home_params(None)["addons"] == "audio"
    # The activation and the daily check both send home_params (tests/test_licence_homes.py pins the calls).
    assert "home_params(st.data)" in _src("ws_forensics.py") and "home_params(st.data)" in _src("update_check.py")


def _wire(monkeypatch, answer):
    class _Resp:
        status = 200
        headers: dict = {}

        async def text(self):
            return json.dumps(answer)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    session = MagicMock()
    session.post = MagicMock(return_value=_Resp())
    mod = types.ModuleType("homeassistant.helpers.aiohttp_client")
    mod.async_get_clientsession = lambda hass: session
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", mod)
    iid = types.ModuleType("homeassistant.helpers.instance_id")
    iid.async_get = AsyncMock(return_value="m1")
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.instance_id", iid)
    return session


class _St:
    def __init__(self, data):
        self.data = dict(data)

    async def async_set(self, **kw):
        self.data.update(kw)


def _activate(monkeypatch, stored, answer, key="PSPAN-AUDI-OOOO-OOOO-0001"):
    from custom_components.padspan_ha import ws_forensics as F
    session = _wire(monkeypatch, answer)
    monkeypatch.setattr(F, "_invalidate_snapshot_cache", lambda hass: None)
    monkeypatch.setattr(F, "_get_settings", lambda hass, connection=None: {})
    st = _St(stored)
    conn = MagicMock()
    asyncio.run(F.ws_forensics_license_activate(SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}), conn, {"id": 1, "key": key}))
    return st.data, conn.send_result.call_args.args[1], session.post.call_args.kwargs["data"]


AUDIO_ANSWER = {"valid": True, "status": "active", "plan": "audio", "tier": "free", "addons": ["audio"],
                "expires_at": "2028-11-25 10:00:00", "days_left": 730, "homes_max": 3, "token": "t" * 32, "homes_used": 1}


def test_an_audio_key_is_kept_as_the_free_tier_with_audio(monkeypatch) -> None:
    data, result, sent = _activate(monkeypatch, {"forensics_enabled": False}, AUDIO_ANSWER)
    assert sent["addons"] == "audio"
    assert result["ok"] is True
    assert data["license_tier"] == "free" and data["license_addons"] == ["audio"] and data["license_is_trial"] is False
    assert data["forensics_license_expires"] == "2028-11-25 10:00:00"
    assert data["forensics_enabled"] is False, "an add-on key does not switch Forensics on"
    assert licence.key_tier(data) == "free" and licence.audio_allowed(data, True)


def test_a_pro_key_after_an_audio_key_carries_no_add_on(monkeypatch) -> None:
    data, _, _ = _activate(monkeypatch, {**AUDIO, "forensics_enabled": False},
                           {"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"}, key="PSPAN-PROK-0000-0000-0001")
    assert data["license_tier"] == "pro" and data["license_addons"] == [] and data["forensics_enabled"] is True


def test_an_older_padspan_message_is_passed_on_and_nothing_is_kept(monkeypatch) -> None:
    msg = "The Audio add-on needs PadSpan 0.38.298 or later — update PadSpan."
    data, result, _ = _activate(monkeypatch, {}, {"valid": False, "status": "needs_update", "message": msg})
    assert result == {"ok": False, "status": "needs_update", "message": msg}
    assert "forensics_license_key" not in data and "license_addons" not in data


def _hass(data):
    st = _St(data)
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}), st


@pytest.mark.parametrize("answer,want", [
    (AUDIO_ANSWER, ["audio"]),                                                       # still the add-on
    ({"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"}, []),   # bought into Pro
])
def test_the_daily_check_keeps_the_add_ons_with_the_tier(monkeypatch, answer, want) -> None:
    from custom_components.padspan_ha.update_check import _revalidate_license
    hass, st = _hass({**AUDIO, "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, answer)
    asyncio.run(_revalidate_license(hass))
    assert st.data["license_addons"] == want and st.data["license_tier"] == answer["tier"]


def test_a_bare_yes_changes_neither_the_tier_nor_the_add_ons(monkeypatch) -> None:
    """The backup's answer to a home with a token is {"valid": true}: nothing more."""
    from custom_components.padspan_ha.update_check import _revalidate_license
    hass, st = _hass({**AUDIO, "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, {"valid": True})
    asyncio.run(_revalidate_license(hass))
    assert st.data["license_tier"] == "free" and st.data["license_addons"] == ["audio"]


def test_every_place_a_licence_is_set_or_carried_has_the_add_ons() -> None:
    fo = _src("ws_forensics.py")
    trial = fo[fo.index("async def ws_trial_start("):]
    assert "license_addons=[]," in trial, "a trial key carries no add-on"
    assert '"license_addons": normalize_addons(data.get("addons")),' in _src("pro_invite.py")
    assert '"license_addons", "license_install_id"' in _src("ws_factory_reset.py"), "a reset keeps them"
    assert '"license_tier", "license_addons", "license_is_trial",' in _src("ws_backup.py"), "a restore keeps the live ones"
    from custom_components.padspan_ha.bright_import import _LICENCE_KEYS
    assert "license_addons" in _LICENCE_KEYS


# ── The panel ────────────────────────────────────────────────────────────────

def _node(script: str) -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    res = subprocess.run([node, str(Path(__file__).parent / "js" / script), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout[-2000:] + res.stderr[-2000:]
    out = json.loads(lines[-1])
    assert not out["failures"] and res.returncode == 0, out["failures"]
    return out


def test_the_editions_rules() -> None:
    assert len(_node("audio_addon.mjs")["checks"]) >= 20


def test_the_licence_card_says_audio_never_pro_and_offers_it_once() -> None:
    out = _node("licence_card.mjs")["audio"]
    offer = {"text": "Audio add-on — volume, mute and off for each room's players on the map: $6.45 CAD once, "
                     "covers 2 years. PadSpan Pro includes it.", "href": "https://padspan.traks.ca/#audio"}
    for day in ("during", "after", "pass"):
        a = out[f"audio_{day}"]
        assert a["status"] == "✓ PadSpan Audio add-on · until 2028-11-25", a
        assert a["offer"] is None and a["buy"].startswith("Buy PadSpan Pro"), a
        lapsed = out[f"audio_lapsed_{day}"]
        assert lapsed["status"].startswith("⚠ The PadSpan Audio add-on ended on 2026-10-01.") and "Pro" not in lapsed["status"]
        assert lapsed["offer"] == offer and lapsed["buy"].startswith("Buy PadSpan Pro"), lapsed
        # Offered beside Pro to an install without it; never to one that has Pro.
        for kind in ("nokey", "lapsed"):
            assert out[f"{kind}_{day}"]["offer"] == offer, kind
        for kind in ("annual", "lifetime"):
            assert out[f"{kind}_{day}"]["offer"] is None and out[f"{kind}_{day}"]["buy"] is None, kind


def test_the_forensics_card_does_not_call_an_audio_key_pro() -> None:
    s = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    assert "if(settings.pro_has_key && !audioKey(settings)){" in s
