# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""PadSpan add-ons (the owner, 2026-11-25): one feature each, sold to installs
without Pro, each one payment covering 2 years, up to three homes. A buyer's
add-ons share one key; PadSpan Pro includes them all.

The key resolves to the free tier and carries its add-ons: license_addons (the
ones the server says are running) and license_addons_until (each one's end).
The rule that must never go wrong: an add-on key is never Pro, here or on the
licence server, which answers an add-on key only to a PadSpan that sends
addons= (older ones read any valid key as Pro). The server's side is tested in
the licence server's own repository. Gates go through licence.addon_allowed
and views/editions.js addonAllowed(settings, name).
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import licence
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN

_PKG = Path(licence.__file__).parent
_VIEWS = _PKG / "www" / "padspan-ha" / "views"
NAMES = ("audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks", "forensics", "insights", "maps",
         "lighting", "vacuum", "energy", "c4local")
LATER = (datetime.now(timezone.utc) + timedelta(days=700)).strftime("%Y-%m-%d %H:%M:%S")
KEY = {"forensics_license_key": "PSPAN-ADDO-NNNN-NNNN-0001", "license_tier": "free", "license_addons": ["audio"],
       "license_addons_until": {"audio": LATER}}


def _src(rel: str) -> str:
    return (_PKG / rel).read_text(encoding="utf-8").replace("\r\n", "\n")


# ── licence.py: never Pro ────────────────────────────────────────────────────

def test_the_add_ons_are_one_table() -> None:
    assert licence.ADDONS == NAMES
    ed = (_VIEWS / "editions.js").read_text(encoding="utf-8")
    assert re.findall(r'\{ name: "(\w+)", words:', ed) == list(NAMES), "editions.js ADDONS: the same names, in order"


def test_an_add_on_key_never_resolves_to_pro() -> None:
    assert licence.key_tier(KEY) == "free"
    # Even if the tier were lost or garbled, a key that carries an add-on reads free.
    for tier in (None, "", "garbage"):
        assert licence.key_tier({**KEY, "license_tier": tier}) == "free", tier
        assert licence.key_tier({**KEY, "license_tier": tier, "license_addons": []}) == "free", "its dates alone say so"
    for active in (True, False):
        t = licence.effective_tier(KEY, active, floor="free")
        assert t == "free" and not licence.tier_at_least(t, "bright") and not licence.tier_at_least(t, "pro")
    # The demotion guard is untouched: a key with no tier and no add-on is Pro.
    for extra in ({}, {"license_addons": []}, {"license_addons": ["nonesuch"]}, {"license_addons_until": {"x": "2030-01-01"}}):
        assert licence.key_tier({"forensics_license_key": "PSPAN-OLDK", **extra}) == "pro", extra


def test_the_running_gates_never_open_pro_for_an_add_on_key() -> None:
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(KEY))}}
    assert licence.hass_tier(hass) == "free"
    assert not licence.hass_tier_at_least(hass, "pro") and not licence.hass_tier_at_least(hass, "bright")
    assert licence.hass_addon_allowed(hass, "audio") is True and licence.hass_addon_allowed(hass, "wifi") is False
    from custom_components.padspan_ha.ws_common import _padspan_pro_active, _tier_at_least
    assert _padspan_pro_active(hass) is False and _tier_at_least(hass, "bright") is False


def test_pro_has_every_add_on_and_an_add_on_key_its_own() -> None:
    pro = {"forensics_license_key": "K", "license_tier": "pro"}
    for n in NAMES:
        assert licence.addon_allowed(pro, True, n) is True
        assert licence.addon_allowed({"forensics_license_key": "K"}, True, n) is True     # an old Pro key (no tier)
        assert licence.addon_allowed(pro, False, n) is False                               # lapsed past the grace
    assert licence.addon_allowed(KEY, True, "audio") is True
    assert licence.addon_allowed(KEY, True, "climate") is False
    assert licence.addon_allowed(KEY, False, "audio") is False                             # the key lapsed past its grace
    assert licence.addon_allowed(KEY, True, "nonesuch") is False
    assert licence.addon_allowed({"license_addons": ["audio"]}, True, "audio") is False      # no key at all
    assert licence.addon_allowed({"forensics_license_key": "K", "license_tier": "bright"}, True, "audio") is False
    assert licence.addon_allowed(None, False, "audio") is False
    # The developer's override only lowers: Pro looked at as free has no add-on.
    assert licence.addon_allowed({**pro, "license_tier_override": "free"}, True, "audio") is False
    assert licence.addons_allowed(pro, True) == list(NAMES) and licence.addons_allowed(KEY, True) == ["audio"]


def test_each_add_on_ends_on_its_own_date_with_a_keys_grace() -> None:
    now = datetime(2027, 6, 1, tzinfo=timezone.utc)
    key = {**KEY, "license_addons": ["audio"],
           "license_addons_until": {"audio": "2028-01-01 00:00:00", "wifi": "2027-05-25 00:00:00", "looks": "2027-05-01 00:00:00"}}
    assert licence.addon_allowed(key, True, "audio", now=now) is True
    assert licence.addon_allowed(key, True, "wifi", now=now) is True, "ended 7 days ago: inside the 14 days a key gets"
    assert licence.addon_allowed(key, True, "looks", now=now) is False, "ended 31 days ago"
    # No date known: the server's list of running add-ons decides.
    assert licence.addon_allowed({**KEY, "license_addons_until": {}}, True, "audio") is True
    assert licence.addon_allowed({**KEY, "license_addons_until": {"audio": "garbage"}}, True, "audio") is True


def test_add_ons_are_read_strictly() -> None:
    assert licence.normalize_addons(["insights", " AUDIO ", "video", 3, None, "audio"]) == ["audio", "insights"]
    for bad in (None, "audio", {"audio": True}, 1, []):
        assert licence.normalize_addons(bad) == []
    assert licence.normalize_addons_until({"wifi": "2028-01-01", "audio": "2029-01-01", "x": "2030", "looks": 5, "alarm": " "}) \
        == {"audio": "2029-01-01", "wifi": "2028-01-01"}
    for bad in (None, [], "audio", 3):
        assert licence.normalize_addons_until(bad) == {}


def test_the_settings_payload_says_which_add_ons_this_install_may_use() -> None:
    from custom_components.padspan_ha.ws_common import _get_settings
    for data, want in ((KEY, ["audio"]), ({"forensics_license_key": "K", "license_tier": "pro"}, list(NAMES)),
                       ({**KEY, "forensics_license_expires": "2020-01-01 00:00:00"}, []), ({}, [])):
        hass = MagicMock()
        hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data=dict(data))}}
        out = _get_settings(hass)
        assert out["addons_licensed"] == want, data
    assert out["forensics_license_key"] == ""


# ── What is sent, and what is kept ───────────────────────────────────────────

def test_every_validate_says_which_add_ons_this_padspan_knows() -> None:
    from custom_components.padspan_ha import licence_homes as LH
    assert LH.home_params({})["addons"] == ",".join(NAMES) == LH.home_params(None)["addons"]
    # The activation and the daily check both send home_params (tests/test_licence_homes.py pins the calls).
    assert "home_params(st.data)" in _src("ws_forensics.py") and "home_params(st.data)" in _src("update_check.py")


def _wire(monkeypatch, answer):
    """The licence server answering `answer`; a function: its answer to each request's body (raising: no answer)."""
    class _Resp:
        status = 200
        headers: dict = {}

        def __init__(self, got=None):
            self.got = answer if got is None else got

        async def text(self):
            return json.dumps(self.got)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    session = MagicMock()
    session.post = (MagicMock(side_effect=lambda *a, **kw: _Resp(answer(kw["data"]))) if callable(answer)
                    else MagicMock(return_value=_Resp()))
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


def _activate(monkeypatch, stored, answer, key="PSPAN-ADDO-NNNN-NNNN-0001"):
    from custom_components.padspan_ha import ws_forensics as F
    session = _wire(monkeypatch, answer)
    monkeypatch.setattr(F, "_invalidate_snapshot_cache", lambda hass: None)
    monkeypatch.setattr(F, "_get_settings", lambda hass, connection=None: {})
    st = _St(stored)
    conn = MagicMock()
    asyncio.run(F.ws_forensics_license_activate(SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}), conn, {"id": 1, "key": key}))
    return st.data, conn.send_result.call_args.args[1], session.post.call_args.kwargs["data"]


ANSWER = {"valid": True, "status": "active", "plan": "addons", "tier": "free", "addons": ["audio"],
          "addons_until": {"audio": "2028-11-25 10:00:00", "climate": "2026-11-01 10:00:00"},
          "expires_at": "2028-11-25 10:00:00", "days_left": 730, "homes_max": 3, "token": "t" * 32, "homes_used": 1}


def test_an_add_on_key_is_kept_as_the_free_tier_with_its_add_ons(monkeypatch) -> None:
    data, result, sent = _activate(monkeypatch, {"forensics_enabled": False}, ANSWER)
    assert sent["addons"] == ",".join(NAMES)
    assert result["ok"] is True
    assert data["license_tier"] == "free" and data["license_addons"] == ["audio"] and data["license_is_trial"] is False
    assert data["license_addons_until"] == {"audio": "2028-11-25 10:00:00", "climate": "2026-11-01 10:00:00"}
    assert data["forensics_license_expires"] == "2028-11-25 10:00:00"
    assert data["forensics_enabled"] is False, "an add-on key does not switch Forensics on"
    assert licence.key_tier(data) == "free" and licence.addons_allowed(data, True) == ["audio"]


def test_a_pro_key_after_an_add_on_key_carries_no_add_on(monkeypatch) -> None:
    data, _, _ = _activate(monkeypatch, {**KEY, "forensics_enabled": False},
                           {"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"}, key="PSPAN-PROK-0000-0000-0001")
    assert data["license_tier"] == "pro" and data["license_addons"] == [] and data["license_addons_until"] == {}
    assert data["forensics_enabled"] is True


def test_an_older_padspan_message_is_passed_on_and_nothing_is_kept(monkeypatch) -> None:
    msg = "PadSpan add-ons need PadSpan 0.38.298 or later — update PadSpan."
    data, result, _ = _activate(monkeypatch, {}, {"valid": False, "status": "needs_update", "message": msg})
    assert result == {"ok": False, "status": "needs_update", "message": msg}
    assert "forensics_license_key" not in data and "license_addons" not in data


def _hass(data):
    st = _St(data)
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}), st


@pytest.mark.parametrize("answer,addons,until", [
    (ANSWER, ["audio"], ANSWER["addons_until"]),                                        # still the add-ons
    ({"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"}, [], {}),   # bought into Pro
])
def test_the_daily_check_keeps_the_add_ons_with_the_tier(monkeypatch, answer, addons, until) -> None:
    from custom_components.padspan_ha.update_check import _revalidate_license
    hass, st = _hass({**KEY, "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, answer)
    asyncio.run(_revalidate_license(hass))
    assert st.data["license_addons"] == addons and st.data["license_addons_until"] == until
    assert st.data["license_tier"] == answer["tier"]


def test_a_bare_yes_changes_neither_the_tier_nor_the_add_ons(monkeypatch) -> None:
    """The backup's answer to a home with a token is {"valid": true}: nothing more."""
    from custom_components.padspan_ha.update_check import _revalidate_license
    hass, st = _hass({**KEY, "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, {"valid": True})
    asyncio.run(_revalidate_license(hass))
    assert st.data["license_tier"] == "free" and st.data["license_addons"] == ["audio"]
    assert st.data["license_addons_until"] == KEY["license_addons_until"]


def test_every_place_a_licence_is_set_or_carried_has_the_add_ons() -> None:
    fo = _src("ws_forensics.py")
    trial = fo[fo.index("async def ws_trial_start("):]
    assert "license_addons=[], license_addons_until={}," in trial, "a trial key carries no add-on"
    inv = _src("pro_invite.py")
    assert '"license_addons": normalize_addons(data.get("addons")),' in inv
    assert '"license_addons_until": normalize_addons_until(data.get("addons_until")),' in inv
    assert '"license_addons", "license_addons_until", "license_addons_kept", "license_plan", "license_install_id"' in _src("ws_factory_reset.py"), \
        "a reset keeps them"
    assert '"license_tier", "license_addons", "license_addons_until", "license_addons_kept",' in _src("ws_backup.py"), \
        "a restore keeps the live ones"
    from custom_components.padspan_ha.bright_import import _LICENCE_KEYS
    assert {"license_addons", "license_addons_until", "license_addons_kept"} <= set(_LICENCE_KEYS)


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
    assert len(_node("addons.mjs")["checks"]) >= 40


def test_the_panels_words_for_each_add_on_are_the_tables() -> None:
    """settings.js says each add-on's words through t() (a literal the
    translations can reach); they must be editions.js's English."""
    ed = (_VIEWS / "editions.js").read_text(encoding="utf-8")
    st = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    for name, words in re.findall(r'\{ name: "(\w+)", words: "([^"]+)"', ed):
        if name == "c4local":   # a product's name, the same in every language: addonWords falls back to a.words
            assert f"{name}: () =>" not in st and "ADDON_WORDS[a.name] ? ADDON_WORDS[a.name]() : a.words" in st
            continue
        assert f'{name}: () => t("{words}")' in st, name


def test_the_licence_card_lists_the_add_ons_never_pro_and_offers_them_in_one_list() -> None:
    out = _node("licence_card.mjs")["addons"]
    lead = "Add-ons, each paid once and covering 2 years. PadSpan Pro includes them all:"
    every = ["Audio $6.45 CAD", "Alarm & security $6.45 CAD", "Wi-Fi coverage $6.45 CAD", "Climate & air quality $8.65 CAD",
             "Full house activity $7.55 CAD", "Vacation Mode & presets $4.25 CAD", "Looks pack $4.25 CAD",
             "Presence insights $5.56 CAD", "Advanced smart lighting $8.65 CAD"]
    # Black Friday (editions.js ADDON_HALF_FROM .. UNTIL): the card's "after" (December 1) and "pass" (December 16) are in
    # it, so each add-on is offered at half, rounded down to the cent, with its usual price beside it.
    half = {"$6.45": "$3.22", "$8.65": "$4.32", "$7.55": "$3.77", "$4.25": "$2.12", "$5.56": "$2.78"}

    def on_sale(item: str) -> str:
        words, price = item.rsplit(" ", 2)[0], item.rsplit(" ", 2)[1]
        return f"{words} {half[price]} CAD — half off through January 1 (normally {price})"
    # From December 1 (editions.js FREE_BASICS_FROM) Advanced map creation and Robot vacuum are on sale too, in the
    # table's order (editions.js ADDONS): Advanced map creation before Advanced smart lighting, Robot vacuum last.
    every_late = every[:8] + ["Advanced map creation $8.65 CAD", every[8], "Robot vacuum $6.45 CAD"]
    for day in ("during", "after", "pass"):
        a = out[f"addons_{day}"]
        assert a["status"].startswith("✓ PadSpan add-ons: Audio until 2028-11-25 · Climate & air quality "), a
        assert "Pro" not in a["status"] and a["buy"].startswith("Buy PadSpan Pro"), a
        now = every if day == "during" else [on_sale(i) for i in every_late]
        assert a["offer"]["lead"] == lead and [i["text"] for i in a["offer"]["items"]] == now[1:], ("all but the one it has", day)
        assert {i["href"] for i in a["offer"]["items"]} == {"https://padspan.traks.ca/#addons"}
        lapsed = out[f"addons_lapsed_{day}"]
        assert lapsed["status"].startswith("⚠ Your PadSpan add-ons ended on 2026-10-01.") and "Pro" not in lapsed["status"]
        assert lapsed["buy"].startswith("Buy PadSpan Pro") and [i["text"] for i in lapsed["offer"]["items"]] == now
        for kind in ("nokey", "lapsed"):
            assert out[f"{kind}_{day}"]["offer"]["lead"] == lead and [i["text"] for i in out[f"{kind}_{day}"]["offer"]["items"]] == now
        for kind in ("annual", "lifetime"):
            assert out[f"{kind}_{day}"]["offer"] is None and out[f"{kind}_{day}"]["buy"] is None, kind
    assert "Climate & air quality ended on 2026-11-01" in out["addons_pass"]["status"]


def test_the_forensics_card_does_not_call_an_add_on_key_pro() -> None:
    s = (_VIEWS / "settings.js").read_text(encoding="utf-8")
    assert "if(settings.pro_has_key && !addonKey(settings)){" in s


# ── Every path that stores a tier: an add-on answer is never Pro ────────────

def test_an_add_on_answer_is_free_on_every_path() -> None:
    assert licence.answer_tier({"plan": "addons", "tier": "free"}) == "free"
    for odd in ({"plan": "addons"}, {"plan": "addons", "tier": "pro"}, {"plan": "addons", "tier": "weird"},
                {"addons": ["audio"]}, {"addons": ["audio"], "tier": "weird"}, {"addons_until": {"wifi": "2028-01-01"}}):
        assert licence.answer_tier(odd) == "free", odd
    # Every other answer as before: the tier it names, a missing or unknown one Pro.
    assert licence.answer_tier({"plan": "pro", "tier": "pro"}) == "pro"
    assert licence.answer_tier({"plan": "bright", "tier": "bright"}) == "bright"
    assert licence.answer_tier({"valid": True}) == "pro" and licence.answer_tier({"tier": "weird"}) == "pro"
    assert licence.answer_tier(None) == "pro"
    # Activation, the trial, the daily check and an invite claim all read the tier this way, and only this way.
    for f in ("ws_forensics.py", "update_check.py", "pro_invite.py"):
        src = _src(f)
        assert "answer_tier(data)" in src and 'normalize_tier(data.get("tier")' not in src, f


@pytest.mark.parametrize("answer", [
    {**ANSWER, "tier": None}, {**ANSWER, "tier": "weird"}, {**ANSWER, "tier": "pro"},
    {k: v for k, v in ANSWER.items() if k != "tier"},
])
def test_activation_and_the_daily_check_never_store_pro_for_an_add_on_key(monkeypatch, answer) -> None:
    data, _, _ = _activate(monkeypatch, {}, answer)
    assert data["license_tier"] == "free" and licence.key_tier(data) == "free"
    from custom_components.padspan_ha.update_check import _revalidate_license
    hass, st = _hass({**KEY, "forensics_license_expires": "2028-11-25 10:00:00"})
    _wire(monkeypatch, answer)
    asyncio.run(_revalidate_license(hass))
    assert st.data["license_tier"] == "free"


def test_forensics_is_switched_on_only_by_a_key_that_has_it(monkeypatch) -> None:
    data, _, _ = _activate(monkeypatch, {"forensics_enabled": False}, ANSWER)
    assert data["forensics_enabled"] is False, "an add-on key without Forensics"
    data, _, _ = _activate(monkeypatch, {"forensics_enabled": False},
                           {**ANSWER, "addons": ["audio", "forensics"], "addons_until": {"forensics": LATER}})
    assert data["forensics_enabled"] is True, "the Forensics add-on, as Pro does"
    # Presence insights holds Forensics since 2026-11-26 (licence.ADDON_PART_OF): its key turns Forensics on too,
    # whether or not the licence server also lists Forensics.
    data, _, _ = _activate(monkeypatch, {"forensics_enabled": False},
                           {**ANSWER, "addons": ["insights"], "addons_until": {"insights": LATER}})
    assert data["forensics_enabled"] is True, "Presence insights, which holds Forensics"


def test_the_payload_says_an_add_on_key_beside_pro_has_key_and_never_its_kept_key() -> None:
    from custom_components.padspan_ha.ws_common import _get_settings
    kept = {"forensics_license_key": "PSPAN-KEPT-SECR-ETKE-Y001", "license_home_token": "k" * 32}
    for data, addon_key in ((KEY, True), ({"forensics_license_key": "K", "license_tier": "pro"}, False), ({}, False),
                            ({**KEY, "license_tier": "pro"}, False)):
        hass = MagicMock()
        hass.data = {DOMAIN: {DATA_SETTINGS: SimpleNamespace(data={**data, "license_addons_kept": kept})}}
        out = _get_settings(hass)
        assert out["addon_key"] is addon_key and out["pro_has_key"] is bool(data), data
        assert out["license_addons_kept"] is True and "PSPAN-KEPT" not in json.dumps(out), "the kept key never leaves the backend"


# ── The Pro trial on an add-on install: the add-on key is kept, then comes back ─

def _start_trial(monkeypatch, stored):
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha import ws_forensics as F
    _wire(monkeypatch, {"ok": True, "key": "PSPAN-TRIA-LKEY-AAAA-BBBB", "tier": "pro", "expires_at": "2027-02-16 00:00:00",
                        "days_left": 90})
    monkeypatch.setattr(T, "enabled", lambda hass: True)
    monkeypatch.setattr(F, "_invalidate_snapshot_cache", lambda hass: None)
    monkeypatch.setattr(F, "_get_settings", lambda hass, connection=None: {})
    st = _St(stored)
    conn = MagicMock()
    asyncio.run(F.ws_trial_start(SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}), conn, {"id": 1, "email": "a@b.ca"}))
    assert conn.send_result.call_args.args[1]["ok"] is True
    return st


def test_a_trial_keeps_an_add_on_key_aside(monkeypatch) -> None:
    stored = {**KEY, "forensics_license_expires": LATER, "license_home_token": "h" * 32, "license_homes_used": 2}
    st = _start_trial(monkeypatch, stored)
    assert st.data["forensics_license_key"] == "PSPAN-TRIA-LKEY-AAAA-BBBB" and st.data["license_tier"] == "pro"
    assert st.data["license_addons"] == [] and st.data["license_addons_until"] == {} and st.data["license_is_trial"] is True
    kept = st.data["license_addons_kept"]
    assert kept == {k: stored.get(k) for k in licence.ADDON_KEY_FIELDS}
    # No add-on key here: nothing is kept.
    assert _start_trial(monkeypatch, {}).data["license_addons_kept"] == {}


_TRIAL_KEY = "PSPAN-TRIA-LKEY-AAAA-BBBB"


@pytest.mark.parametrize("ends_in_days, said, back", [
    (-20, "trial", True),       # still a trial, past its date and the 14 days' grace: the add-ons come back
    (-1, "trial", False),       # past its date, inside the grace: the trial goes on, the add-on key stays aside
    (30, "trial", False),       # still running
    (-20, "pro", False),        # bought in place: the server says Pro, so the paid key stays (the review, 2026-11-25)
    (30, "refused", True),      # refused by the server (a revoked trial): the add-ons come back at once
    (-20, None, True),          # no answer, and past its date and grace: they come back offline too
    (-1, None, False),          # no answer, inside the grace: nothing changes
], ids=["ended", "in its grace", "running", "bought in place", "refused", "offline, ended", "offline, in its grace"])
def test_the_kept_add_on_key_comes_back_only_once_the_trial_has_ended(monkeypatch, ends_in_days, said, back) -> None:
    """The trial key is checked first, and its answer decides: an add-on key kept aside for the trial takes its place
    only once the trial is over (past its date and the grace, or refused), never while a trial that was bought is Pro."""
    from custom_components.padspan_ha.update_check import _revalidate_license
    trial_ends = (datetime.now(timezone.utc) + timedelta(days=ends_in_days)).strftime("%Y-%m-%d %H:%M:%S")
    kept = {k: v for k, v in {**KEY, "forensics_license_expires": LATER, "license_home_token": "h" * 32,
                              "license_homes_used": 2}.items() if k in licence.ADDON_KEY_FIELDS}
    hass, st = _hass({"forensics_license_key": _TRIAL_KEY, "forensics_license_expires": trial_ends,
                      "license_tier": "pro", "license_is_trial": True, "license_addons_kept": kept})
    trial = {"trial": {"valid": True, "status": "active", "plan": "trial", "tier": "pro", "expires_at": trial_ends},
             "pro": {"valid": True, "status": "active", "plan": "pro", "tier": "pro", "expires_at": LATER},
             "refused": {"valid": False, "status": "revoked", "message": "refunded"}}

    def server(body):
        if said is None:
            raise RuntimeError("offline")
        return ANSWER if body["key"] == KEY["forensics_license_key"] else trial[said]
    session = _wire(monkeypatch, server)
    asyncio.run(_revalidate_license(hass))
    sent = [c.kwargs["data"] for c in session.post.call_args_list]
    assert sent[0]["key"] == _TRIAL_KEY, "the trial key is checked first"
    if back:
        assert st.data["forensics_license_key"] == KEY["forensics_license_key"] and st.data["license_is_trial"] is False
        assert st.data["license_addons"] == ["audio"] and st.data["license_addons_kept"] == {}
        if said is not None:
            assert len(sent) == 2 and sent[1]["key"] == KEY["forensics_license_key"] and sent[1]["token"] == "h" * 32, \
                "then the add-on key is checked, as its home"
            assert st.data["license_tier"] == "free"
    else:
        assert len(sent) == 1 and st.data["forensics_license_key"] == _TRIAL_KEY and st.data["license_addons_kept"] == kept
    if said == "pro":
        assert st.data["license_is_trial"] is False and st.data["license_tier"] == "pro" and st.data["forensics_license_expires"] == LATER


@pytest.mark.parametrize("pro_ends_in_days, back", [(-20, True), (-1, False), (300, False)],
                         ids=["lapsed past its grace", "in its grace", "running"])
def test_a_kept_add_on_key_comes_back_when_the_pro_key_after_the_trial_lapses(monkeypatch, pro_ends_in_days, back) -> None:
    """A trial bought in place (or a Pro invite claimed during it) is a trial no more, and its Pro keeps its place;
    the add-on key kept aside for the trial comes back once that Pro key has lapsed past its grace, never lost."""
    from custom_components.padspan_ha.update_check import _revalidate_license
    pro_ends = (datetime.now(timezone.utc) + timedelta(days=pro_ends_in_days)).strftime("%Y-%m-%d %H:%M:%S")
    kept = {k: v for k, v in {**KEY, "forensics_license_expires": LATER}.items() if k in licence.ADDON_KEY_FIELDS}
    hass, st = _hass({"forensics_license_key": _TRIAL_KEY, "forensics_license_expires": pro_ends, "license_tier": "pro",
                      "license_plan": "pro", "license_is_trial": False, "license_addons_kept": kept})

    def server(body):
        return ANSWER if body["key"] == KEY["forensics_license_key"] else             {"valid": True, "status": "active", "plan": "pro", "tier": "pro", "expires_at": pro_ends}
    _wire(monkeypatch, server)
    asyncio.run(_revalidate_license(hass))
    if back:
        assert st.data["forensics_license_key"] == KEY["forensics_license_key"] and st.data["license_addons"] == ["audio"]
        assert st.data["license_addons_kept"] == {} and st.data["license_tier"] == "free"
    else:
        assert st.data["forensics_license_key"] == _TRIAL_KEY and st.data["license_addons_kept"] == kept


def test_an_answer_is_never_kept_on_a_key_that_took_its_place_meanwhile(monkeypatch) -> None:
    """Two checks at once (the usage report switched as a trial ends): the trial key's refusal, arriving after the
    other check has put the kept add-on key back, is not that key's, and nothing of it is recorded."""
    from custom_components.padspan_ha.update_check import _keep_answer, _revalidate_license
    addon = {**KEY, "forensics_license_expires": LATER, "license_is_trial": False, "license_addons_kept": {}}
    hass, st = _hass({"forensics_license_key": _TRIAL_KEY, "forensics_license_expires": LATER, "license_tier": "pro",
                      "license_is_trial": True, "license_addons_kept": {}})

    def server(body):
        if body["key"] == _TRIAL_KEY:
            st.data.update(addon)                       # the other check swaps the add-on key back while this one asks
            return {"valid": False, "status": "revoked", "message": "refunded", "plan": "trial", "tier": "pro"}
        return ANSWER
    session = _wire(monkeypatch, server)
    asyncio.run(_revalidate_license(hass))
    assert len(session.post.call_args_list) == 1
    assert {k: st.data[k] for k in addon} == addon, "the add-on key is as it was: not expired, not made a trial or Pro"
    assert asyncio.run(_keep_answer(st, {"valid": True, "tier": "pro"}, _TRIAL_KEY)) is False
    assert st.data["license_tier"] == "free"


def test_entering_another_key_lets_go_of_a_kept_add_on_key(monkeypatch) -> None:
    data, _, _ = _activate(monkeypatch, {"forensics_license_key": "PSPAN-TRIA-LKEY-AAAA-BBBB", "license_addons_kept": {"x": 1}},
                           {"valid": True, "plan": "pro", "tier": "pro", "expires_at": "2027-11-25 00:00:00"}, key="PSPAN-PROK-0000-0000-0001")
    assert data["license_addons_kept"] == {}
    assert '"license_addons_kept"' in _src("ws_factory_reset.py") and '"license_addons_kept",' in _src("ws_backup.py")
