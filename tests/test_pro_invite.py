"""A free year of PadSpan Pro by invite (pro_invite.py), and the tester card.

The invite rides the report's reply, so the rules that matter are held here:
a reply can only ever store a well-formed token and day, nothing else; the
token never reaches the panel or a report; Claim and No thanks are the only
sends, both admin-only, and each ends the invite here; a decline the server
never heard is retried when the reply carries the token again; a restore
cannot bring an invite back. The cards themselves are run by
tests/js/pro_invite.mjs.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import pro_invite as P
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_telemetry import _hass, _run

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_VIEWS = _CC / "www" / "padspan-ha" / "views"
_TOKEN = "0123456789abcdef0123456789abcdef"
_UNTIL = "2099-12-31"


def _settings(h):
    return h.data[DOMAIN][DATA_SETTINGS].data


def test_a_reply_can_only_carry_a_token_and_a_day():
    good = {"ok": True, "invite": {"token": _TOKEN, "until": _UNTIL}}
    assert P.parse_reply(good) == {"token": _TOKEN, "until": _UNTIL}
    extra = {"ok": True, "invite": {"token": _TOKEN, "until": _UNTIL, "forensics_license_key": "X"}}
    assert P.parse_reply(extra) == {"token": _TOKEN, "until": _UNTIL}, "anything beyond the two fields is dropped"
    for bad in (None, "x", [], {"ok": True}, {"invite": "x"},
                {"invite": {"token": _TOKEN.upper(), "until": _UNTIL}},
                {"invite": {"token": _TOKEN[:-1], "until": _UNTIL}},
                {"invite": {"token": _TOKEN, "until": "soon"}},
                {"invite": {"token": _TOKEN}}):
        assert P.parse_reply(bad) is None, bad


def _wire_report(monkeypatch, reply):
    class _Resp:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def json(self, content_type=None): return reply
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake.async_get_clientsession = lambda hass: SimpleNamespace(post=lambda *a, **k: _Resp())
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)


def test_a_report_reply_with_an_invite_is_kept_and_never_reported(monkeypatch):
    h = _hass()
    _wire_report(monkeypatch, {"ok": True, "invite": {"token": _TOKEN, "until": _UNTIL}})
    assert _run(T.send_now(h, force=True))["sent"] is True
    assert _settings(h)[P.SETTINGS_KEY] == {"token": _TOKEN, "until": _UNTIL, "optin_rule": 1}   # delivered under the opt-in rule (0.38.181)
    # The next report carries nothing of it.
    assert _TOKEN not in json.dumps(T.build_payload(h, consume=False))


def test_a_plain_or_broken_reply_keeps_nothing(monkeypatch):
    for reply in ({"ok": True}, None, "not json", {"ok": True, "invite": {"token": "x"}}):
        h = _hass()
        _wire_report(monkeypatch, reply)
        assert _run(T.send_now(h, force=True))["sent"] is True
        assert not _settings(h).get(P.SETTINGS_KEY), reply


def test_the_panel_learns_only_whether_an_invite_is_open():
    assert P.public_state({}) == {"pro_invite_open": False, "pro_invite_until": ""}
    assert P.public_state({P.SETTINGS_KEY: {"token": _TOKEN, "until": _UNTIL}}) == \
        {"pro_invite_open": True, "pro_invite_until": _UNTIL}
    assert P.public_state({P.SETTINGS_KEY: {"token": _TOKEN, "until": "2000-01-01"}})["pro_invite_open"] is False
    assert P.public_state({P.SETTINGS_KEY: {"answered": _TOKEN}})["pro_invite_open"] is False
    src = (_CC / "ws_common.py").read_text(encoding="utf-8")
    assert "out.pop(_INVITE_KEY, None)" in src, "_get_settings must take the token out before the panel sees it"


def _house(invite=None):
    h = _hass()
    if invite is not None:
        _settings(h)[P.SETTINGS_KEY] = invite
    _settings(h).pop("forensics_license_key", None)
    return h


def _conn():
    sent = {}
    return sent, SimpleNamespace(send_error=lambda i, code, m: sent.update(code=code, message=m),
                                 send_result=lambda i, r: sent.update(result=r))


def _wire_licence(monkeypatch, answer):
    calls = []
    async def _post(hass, action, data):
        calls.append((action, dict(data)))
        if isinstance(answer, Exception):
            raise answer
        return answer
    monkeypatch.setattr(P, "_post", _post)
    from custom_components.padspan_ha import ws_common
    monkeypatch.setattr(ws_common, "_get_settings", lambda h: {"ok": "settings"})
    monkeypatch.setattr(ws_common, "_invalidate_snapshot_cache", lambda h: None)
    return calls


def test_claim_stores_a_year_of_pro_in_the_purchase_fields_and_ends_the_invite(monkeypatch):
    h = _house({"token": _TOKEN, "until": _UNTIL})
    calls = _wire_licence(monkeypatch, {"ok": True, "key": "PSPAN-TEST-KEY", "expires_at": "2027-10-13 18:00:00",
                                        "tier": "pro", "days_left": 365})
    sent, conn = _conn()
    _run(P.ws_pro_invite_claim(h, conn, {"id": 1, "email": " a@b.ca "}))
    assert sent["result"]["ok"] is True
    assert calls[0][0] == "invite_claim" and calls[0][1]["token"] == _TOKEN and calls[0][1]["email"] == "a@b.ca"
    s = _settings(h)
    assert s["forensics_license_key"] == "PSPAN-TEST-KEY" and s["license_tier"] == "pro"
    assert s["license_is_trial"] is False and s["forensics_enabled"] is True
    assert s[P.SETTINGS_KEY] == {"answered": _TOKEN}
    assert P.public_state(s)["pro_invite_open"] is False


def test_claim_refuses_before_sending(monkeypatch):
    calls = _wire_licence(monkeypatch, {"ok": True})
    sent, conn = _conn()
    _run(P.ws_pro_invite_claim(_house({"token": _TOKEN, "until": _UNTIL}), conn, {"id": 1, "email": "nope"}))
    assert sent.get("code") == "invalid_email"
    sent.clear()
    _run(P.ws_pro_invite_claim(_house({"token": _TOKEN, "until": "2000-01-01"}), conn, {"id": 2, "email": "a@b.ca"}))
    assert sent["result"]["ok"] is False
    assert calls == [], "nothing goes to the licence server for a bad email or an ended invite"


def test_a_refused_or_failed_claim_keeps_the_invite(monkeypatch):
    for answer in ({"ok": False, "message": "This invite has ended."}, OSError("offline")):
        h = _house({"token": _TOKEN, "until": _UNTIL})
        _wire_licence(monkeypatch, answer)
        sent, conn = _conn()
        _run(P.ws_pro_invite_claim(h, conn, {"id": 1, "email": "a@b.ca"}))
        assert ("result" in sent and sent["result"]["ok"] is False) or sent.get("code") == "network"
        assert _settings(h)[P.SETTINGS_KEY] == {"token": _TOKEN, "until": _UNTIL}
        assert not _settings(h).get("forensics_license_key")


def test_no_thanks_ends_it_here_and_tells_the_server(monkeypatch):
    h = _house({"token": _TOKEN, "until": _UNTIL})
    calls = _wire_licence(monkeypatch, {"ok": True})
    sent, conn = _conn()
    _run(P.ws_pro_invite_decline(h, conn, {"id": 1}))
    assert sent["result"]["ok"] is True
    assert calls == [("invite_decline", {"token": _TOKEN})], "a decline sends the token and nothing else"
    assert _settings(h)[P.SETTINGS_KEY] == {"answered": _TOKEN, "declined_unsent": False}


def test_a_decline_the_server_missed_is_retried_and_never_brings_the_card_back(monkeypatch):
    h = _house({"token": _TOKEN, "until": _UNTIL})
    _wire_licence(monkeypatch, OSError("offline"))
    sent, conn = _conn()
    _run(P.ws_pro_invite_decline(h, conn, {"id": 1}))
    assert _settings(h)[P.SETTINGS_KEY] == {"answered": _TOKEN, "declined_unsent": True}
    # The server still sends it; the reply must not reopen it, and the decline goes again.
    calls = _wire_licence(monkeypatch, {"ok": True})
    _run(P.store_from_reply(h, {"ok": True, "invite": {"token": _TOKEN, "until": _UNTIL}}))
    assert calls == [("invite_decline", {"token": _TOKEN})]
    assert _settings(h)[P.SETTINGS_KEY] == {"answered": _TOKEN, "declined_unsent": False}
    assert P.public_state(_settings(h))["pro_invite_open"] is False


def test_a_working_paid_key_is_never_replaced(monkeypatch):
    h = _house({"token": _TOKEN, "until": _UNTIL})
    _settings(h).update(forensics_license_key="PSPAN-PAID", forensics_license_expires="2099-01-01",
                        license_tier="bright", license_is_trial=False)
    calls = _wire_licence(monkeypatch, {"ok": True, "key": "PSPAN-NEW"})
    sent, conn = _conn()
    _run(P.ws_pro_invite_claim(h, conn, {"id": 1, "email": "a@b.ca"}))
    assert sent["result"]["ok"] is False and "hello@traks.ca" in sent["result"]["message"]
    assert calls == [] and _settings(h)["forensics_license_key"] == "PSPAN-PAID"


def test_an_answer_without_a_key_stores_nothing(monkeypatch):
    for answer in ({"ok": True}, ["ok"], "ok"):
        h = _house({"token": _TOKEN, "until": _UNTIL})
        _wire_licence(monkeypatch, answer)
        sent, conn = _conn()
        _run(P.ws_pro_invite_claim(h, conn, {"id": 1, "email": "a@b.ca"}))
        assert sent["result"]["ok"] is False, answer
        assert not _settings(h).get("forensics_license_key")
        assert _settings(h)[P.SETTINGS_KEY] == {"token": _TOKEN, "until": _UNTIL}


def test_a_factory_reset_keeps_the_invite():
    src = (_CC / "ws_factory_reset.py").read_text(encoding="utf-8")
    assert "_reset[_INVITE_KEY] = _live[_INVITE_KEY]" in src


def test_one_overview_card_per_page_load_and_basic_mode_reaches_the_sign_up():
    src = (_CC / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    for fn in ("_proInviteOverviewCard(){", "_testerOverviewCard(positioned){", "_trialMilestoneCard(positioned){"):
        body = src[src.index(fn):][:1500]
        assert "this._overviewCardShown = true" in body[:body.index("visible = true") + 120], f"{fn} does not hold the slot"
    slot = src[src.index("const _ms = this._proInviteOverviewCard()"):][:200]
    assert slot.index("_proInviteOverviewCard") < slot.index("_testerOverviewCard") < slot.index("_trialMilestoneCard")
    sign = src[src.index("_openTesterSignup(){"):][:600]
    assert 'this.state.complexity = "advanced"' in sign, "Basic mode has no Presence tab"


def test_the_commands_are_registered_and_admin_only():
    src = (_CC / "pro_invite.py").read_text(encoding="utf-8")
    for cmd in ("ws_pro_invite_claim", "ws_pro_invite_decline"):
        head = src[:src.index(f"async def {cmd}(")]
        block = head[head.rindex("@websocket_api.websocket_command"):]
        assert "@websocket_api.require_admin" in block, f"{cmd} is not admin-only"
        assert f"async_register_command(hass, {cmd})" in (_CC / "websocket.py").read_text(encoding="utf-8")


def test_a_restore_keeps_the_live_invite_and_settings_keep_the_tester_card_answered():
    backup = (_CC / "ws_backup.py").read_text(encoding="utf-8")
    assert "data[_INVITE_KEY] = (store_obj.data or {}).get(_INVITE_KEY) or {}" in backup
    from custom_components.padspan_ha import settings_store as ss
    assert ss.DEFAULT_SETTINGS["pro_invite"] == {} and ss.DEFAULT_SETTINGS["tester_nudge_done"] is False
    assert ss.trial_state_kept({"tester_nudge_done": True}, {})["tester_nudge_done"] is True
    assert ss.trial_state_kept({}, {"tester_nudge_done": True})["tester_nudge_done"] is True
    ws = (_CC / "ws_settings.py").read_text(encoding="utf-8")
    assert 'vol.Optional("tester_nudge_done"): bool' in ws and 'payload["tester_nudge_done"]' in ws
    assert '"pro_invite"' not in ws, "the panel can never write an invite"


def test_the_report_says_invites_can_come_back_with_it():
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    if "the complete list:" not in readme:
        pytest.skip("this README only summarises the report (the Bright derivation's)")
    assert "**Invites.**" in readme and "never the email" in readme
    assert "Testers get PadSpan Pro free for two years" in readme
    assert "invites houses that report" in (_CC / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    assert "The developer may invite an install that reports" in (_VIEWS / "settings.js").read_text(encoding="utf-8")


_NODE = shutil.which("node")


@pytest.mark.skipif(not _NODE, reason="node is not installed")
def test_the_cards_run():
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "pro_invite.mjs"), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout[-3000:] + res.stderr[-3000:]
    out = json.loads(lines[-1])
    assert out["failed"] == [] and res.returncode == 0, res.stdout[-3000:]
    assert out["passed"] >= 10, out


# ── The offers' server switches (update_check._keep_offers) and the update
#    notification's tester line ─────────────────────────────────────────────

def test_the_update_answer_can_only_switch_the_two_offers(monkeypatch):
    from custom_components.padspan_ha import update_check as U
    h = _house()
    _run(U._keep_offers(h, {"latest_stable": "1.0.0"}))
    assert not _settings(h).get("server_offers"), "no offers in the answer: nothing changes"
    _run(U._keep_offers(h, {"offers": {"tester": False, "invite": True, "banner": "BUY NOW", "lifetime": False}}))
    assert _settings(h)["server_offers"] == {"tester": False, "invite": True}, "only the two names, only booleans"
    _run(U._keep_offers(h, {"offers": {"tester": "no", "invite": 0}}))
    assert _settings(h)["server_offers"] == {"tester": False, "invite": True}, "junk keeps the last answer"
    assert U.offer_on({}, "tester") and U.offer_on({"server_offers": {}}, "invite"), "before any answer, offers are on"
    assert not U.offer_on({"server_offers": {"tester": False}}, "tester")


def test_the_update_notice_names_the_tester_offer_only_when_it_fits(monkeypatch):
    from custom_components.padspan_ha import update_check as U
    from custom_components.padspan_ha import licence
    monkeypatch.setattr(licence, "edition", lambda: "full")
    h = _house()
    assert "Testers get PadSpan Pro free" in U._tester_line(h)
    _settings(h)["server_offers"] = {"tester": False}
    assert U._tester_line(h) == "", "the offer is switched off"
    _settings(h)["server_offers"] = {}
    _settings(h)["forensics_license_key"] = "PSPAN-ANY"
    assert U._tester_line(h) == "", "a house with a key is not pitched"
    _settings(h).pop("forensics_license_key")
    _settings(h)["tester_signup"] = {"signed_up_at": "2026-10-16T10:00:00Z"}
    assert U._tester_line(h) == "", "a tester already signed up is not pitched"
    _settings(h).pop("tester_signup")
    monkeypatch.setattr(licence, "edition", lambda: "bright")
    assert U._tester_line(h) == "", "Bright is not pitched"


def test_the_panel_gets_the_switches_never_the_raw_answer():
    src = (_CC / "ws_common.py").read_text(encoding="utf-8")
    assert 'out.pop("server_offers", None)' in src
    assert 'out["offer_tester"]' in src and 'out["offer_invite"]' in src
    uc = (_CC / "update_check.py").read_text(encoding="utf-8")
    assert "await _keep_offers(hass, manifest)" in uc
    assert uc.index("await _keep_offers(hass, manifest)") < uc.index("if not latest or not current"), (
        "the switches must be kept even when there is no newer version")


def test_restore_and_reset_keep_todays_offer_switches():
    assert 'data["server_offers"] = (store_obj.data or {}).get("server_offers") or {}' in         (_CC / "ws_backup.py").read_text(encoding="utf-8")
    assert '_reset["server_offers"] = _live["server_offers"]' in (_CC / "ws_factory_reset.py").read_text(encoding="utf-8")


def test_an_invite_already_delivered_is_claimed_even_with_the_report_off_since(monkeypatch):
    """The opt-in came first: an invite reaches an install only through its
    report. An existing offer is not affected by the opt-in rule (Garry,
    2026-10-27), so turning the report off afterwards does not take it away."""
    calls = _wire_licence(monkeypatch, {"ok": True, "key": "PSPAN-TEST-KEY", "expires_at": "2027-10-13 18:00:00",
                                        "tier": "pro", "days_left": 365})
    h = _house({"token": _TOKEN, "until": _UNTIL})
    _settings(h)["telemetry_enabled"] = False
    sent, conn = _conn()
    _run(P.ws_pro_invite_claim(h, conn, {"id": 1, "email": "a@b.ca"}))
    assert sent["result"]["ok"] is True and calls[0][0] == "invite_claim"



def test_a_new_invite_needs_the_report_on_and_keeps_it_on_while_the_year_runs(monkeypatch):
    """An invite delivered from 0.38.181 carries optin_rule: claimed only with
    the report on, and the year holds it on (Garry, 2026-10-27). An invite
    delivered before (no mark) is claimed as before."""
    from custom_components.padspan_ha.settings_store import licence_key_hash as H
    calls = _wire_licence(monkeypatch, {"ok": True, "key": "PSPAN-YEAR", "expires_at": "2027-10-27 00:00:00",
                                        "tier": "pro", "days_left": 365})
    h = _house({"token": _TOKEN, "until": _UNTIL, "optin_rule": 1})
    _settings(h)["telemetry_enabled"] = False
    sent, conn = _conn()
    _run(P.ws_pro_invite_claim(h, conn, {"id": 1, "email": "a@b.ca"}))
    assert sent["result"]["ok"] is False and sent["result"]["status"] == "report_off" and calls == []
    _settings(h)["telemetry_enabled"] = True
    sent, conn = _conn()
    _run(P.ws_pro_invite_claim(h, conn, {"id": 2, "email": "a@b.ca"}))
    assert sent["result"]["ok"] is True and _settings(h)["report_locked_key"] == H("PSPAN-YEAR")


def test_a_delivered_invite_is_marked_with_the_rule(monkeypatch):
    h = _house(None)
    _run(P.store_from_reply(h, {"invite": {"token": _TOKEN, "until": _UNTIL}}))
    assert _settings(h)[P.SETTINGS_KEY].get("optin_rule") == 1
