# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Become a tester (tester.py, ws_tester.py, server/tester.php).

THE HARD RULE. The opt-in usage report (telemetry.py) promises counts only —
never names, addresses or contact details — and a sign-up is contact details
by nature. So it must never travel in, be stored with, or be derivable from
the report. Held here from both sides: a house carrying a full sign-up builds
AND sends a report with none of it in (and the report's gate refuses an email
address outright); every send a sign-up makes goes to TESTER_URL and never to
TELEMETRY_URL; and the report's vocabularies stay closed to it.

Then the sign-up's own rules: only the ticked setup lines go, and they are
the report's own numbers; the install id goes only when asked; the checks
refuse before anything is sent; a first send keeps its random id before it
goes, so a lost answer never leaves a copy nobody can withdraw; a withdrawal
clears the record here only on the server's word; nothing is ever retried;
the commands are admin-only; a factory reset or a restore keeps the live
sign-up.

And the server. There is no PHP where these tests run, so server/tester.php
is ported to Python below, line for line, reading its lists and patterns out
of the PHP source itself — and the client is wired to the port end to end.
Change tester.php, change _Receiver.
"""

from __future__ import annotations

import asyncio
import copy
import inspect
import json
import re
import subprocess
import sys
import types
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import tester
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_telemetry import _SECRETS, _hass

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_PHP = _ROOT / "server" / "tester.php"
_PULL = _ROOT / "server" / "pull_padspan_telemetry.sh"

# ── a sign-up full of things that must never reach the report ────────────────
_EMAIL = "Nicole.Tester+pad@Example.COM"
_GITHUB = "nicole-tests"
_NAME = "Nicole Q. Tester"
_NOTES = "Call me after 6 - the ESPHome proxies live in the attic"
_OTHER = "Zigbee door sensors"
_TZ = "America/Vancouver"
_TESTER_ID = "5f0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b"
_SIGNUP = {
    "tester_id": _TESTER_ID, "email": _EMAIL, "github": _GITHUB, "name": _NAME,
    "interests": ["wled", "other"], "interests_other": _OTHER, "notes": _NOTES, "timezone": _TZ,
    "setup_off": ["rooms"], "linked": True,
    "signed_up_at": "2026-09-20T10:00:00Z", "updated_at": "2026-09-21T10:00:00Z",
}
_TESTER_STRINGS = [_EMAIL, "Example.COM", _GITHUB, _NAME, "Nicole", _NOTES, "attic", _OTHER, _TZ,
                   "Vancouver", _TESTER_ID, "tester", "signed_up"]
_INSTALL_ID = "8f0d0f7e-2c8f-4c8a-9d1c-0f2c3d4e5f60"       # the fixture's (tests/test_telemetry.py)

_GOOD = {"email": "tester@example.com", "github": "octo-cat", "name": "Octo", "interests": ["wled", "floors"],
         "interests_other": "", "notes": "Two floors, five proxies.", "timezone": _TZ, "consent": True,
         "link_reports": False}


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _house(signup: dict | None = None, *, report_on: bool = True):
    h = _hass()
    h.config.time_zone = _TZ
    data = h.data[DOMAIN][DATA_SETTINGS].data
    data["telemetry_enabled"] = report_on
    if signup is not None:
        data[tester.SETTINGS_KEY] = copy.deepcopy(signup)
    return h


def _form(**over):
    return {**_GOOD, **over}


class _Resp:
    def __init__(self, status: int, reply):
        self.status, self._reply = status, reply

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def json(self, content_type=None):
        if isinstance(self._reply, Exception):
            raise self._reply
        return self._reply


class _Wire:
    """Every POST the integration makes, and what the far end answers:
    `answer(url, raw_bytes) -> (status, reply)`, or raise for a dead network."""

    def __init__(self, answer):
        self.answer = answer
        self.posts: list[tuple[str, dict]] = []

    def post(self, url, data=None, headers=None, timeout=None):
        self.posts.append((url, json.loads(data)))
        status, reply = self.answer(url, data)
        return _Resp(status, reply)


def _wire(monkeypatch, answer) -> _Wire:
    w = _Wire(answer)
    fake = types.ModuleType("homeassistant.helpers.aiohttp_client")
    fake.async_get_clientsession = lambda hass: w
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.aiohttp_client", fake)
    return w


def _ok(url, raw):
    return 200, {"ok": True}


def _record(h) -> dict:
    return h.data[DOMAIN][DATA_SETTINGS].data.get(tester.SETTINGS_KEY) or {}


# ═══ 1. the report never carries any of it ════════════════════════════════════

def test_a_sign_up_never_reaches_the_report():
    """A house with a full sign-up in its settings builds a report with not
    one piece of it in — not a value, not a key."""
    h = _house(_SIGNUP)
    payload = T.build_payload(h)
    T.assert_shareable(payload)
    text = json.dumps(payload).lower()
    for s in _TESTER_STRINGS:
        assert s.lower() not in text, f"{s!r} reached the usage report"
    for s in _SECRETS:
        assert s.lower() not in text


def test_a_sent_report_carries_none_of_it_and_goes_only_to_the_report_address(monkeypatch):
    h = _house(_SIGNUP)
    w = _wire(monkeypatch, lambda url, raw: (200, {"ok": True}))
    res = _run(T.send_now(h, force=True))
    assert res["sent"] is True
    assert [u for u, _ in w.posts] == [T.TELEMETRY_URL]
    body = json.dumps(w.posts[0][1]).lower()
    for s in _TESTER_STRINGS:
        assert s.lower() not in body, f"{s!r} was sent in the usage report"


def test_the_report_gate_refuses_contact_details():
    """Belt and braces: if a sign-up field were ever wired into the report by
    mistake, the whole report is refused before it leaves."""
    base = T.build_payload(_hass())
    T.assert_shareable(base)
    for bad in (_EMAIL, _EMAIL.lower(), "X@GMAIL.COM", "o'brien@example.co.uk", _TESTER_ID):
        p = json.loads(json.dumps(base))
        p["env"]["note"] = f"seen {bad}"
        with pytest.raises(ValueError):
            T.assert_shareable(p)
    p = json.loads(json.dumps(base))
    p["features"]["contact"] = "X@GMAIL.COM"          # an upper-case domain is no entity id
    with pytest.raises(ValueError, match="email"):
        T.assert_shareable(p)


def test_the_report_vocabularies_stay_closed_to_it():
    everything = set(T.EVENTS) | set(T.TAB_EVENTS) | set(T.UI_ERRORS) | set(T.OFFER_EVENTS) | set(T._TOP_KEYS)
    everything |= set(T._FEATURE_FLAGS) | set(T._FEATURE_ENUMS) | set(T._PRESET_VALUE_KEYS)
    assert not [k for k in everything if "tester" in k or "signup" in k or "email" in k]
    assert tester.SETTINGS_KEY not in T._FEATURE_FLAGS


def test_the_report_module_knows_nothing_of_the_sign_up():
    """Separate storage means the report never reads it: telemetry.py does
    not import tester.py or name its settings key."""
    src = inspect.getsource(T)
    assert tester.SETTINGS_KEY not in src
    assert "from .tester" not in src and "import tester" not in src


# ═══ 2. and a sign-up never goes to the report's address ══════════════════════

def test_every_sign_up_send_goes_to_the_tester_address_and_nowhere_else(monkeypatch):
    assert tester.TESTER_URL == "https://padspan.traks.ca/api/tester.php"
    assert tester.TESTER_URL != T.TELEMETRY_URL
    assert "TELEMETRY_URL" not in inspect.getsource(tester)
    h = _house()
    w = _wire(monkeypatch, _ok)
    assert _run(tester.sign_up(h, _form())) == "signup"
    assert _run(tester.sign_up(h, _form(notes="changed"))) == "update"
    _run(tester.withdraw(h))
    assert len(w.posts) == 3
    assert all(url == tester.TESTER_URL for url, _ in w.posts), w.posts
    # The report's own state is untouched by any of it: no day stamped, no counter.
    assert not h.data[DOMAIN][DATA_SETTINGS].data.get("telemetry_last_day")
    assert not h.data[DOMAIN].get(T._DATA_COUNTERS)


def test_the_tester_id_is_its_own_and_never_the_install_id(monkeypatch):
    h = _house()
    w = _wire(monkeypatch, _ok)
    _run(tester.sign_up(h, _form()))
    body = w.posts[0][1]
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", body["tester_id"])
    assert body["tester_id"] != _INSTALL_ID
    assert _INSTALL_ID not in json.dumps(body), "the install id went without the box ticked"


def test_settings_reads_never_carry_the_sign_up():
    """settings_get goes to EVERY user of the Home Assistant; the contact
    details stay behind the admin-only tester_status."""
    from custom_components.padspan_ha.ws_common import _get_settings
    out = _get_settings(_house(_SIGNUP))
    assert tester.SETTINGS_KEY not in out
    assert out["tester_signed_up"] is True
    text = json.dumps(out, default=str)
    for s in (_EMAIL, _GITHUB, _NAME, _NOTES, _TESTER_ID):
        assert s not in text
    assert _get_settings(_house())["tester_signed_up"] is False
    assert _get_settings(_house({"tester_id": _TESTER_ID}))["tester_signed_up"] is False, "a pending id is not a sign-up"


# ═══ 3. what a sign-up carries ════════════════════════════════════════════════

def test_the_setup_lines_are_the_reports_own_numbers():
    h = _house()
    report = T.build_payload(h)
    lines = tester.lines_from_report(h, report)
    keys = [ln["key"] for ln in lines]
    assert keys == [k for k in tester.SETUP_KEYS if k in keys], "out of order or not in the closed list"
    by = {ln["key"]: ln["value"] for ln in lines}
    assert by["scanners"] == report["env"]["scanner_kinds"]
    assert by["floors"] == report["env"]["floors"] and by["rooms"] == report["env"]["rooms"]
    assert by["placed_lights"] == report["env"]["placed_lights"]
    assert by["integrations"] == {"bermuda": 0, "private_ble_device": 0, "esphome": 1}
    assert by["findmy_on_air"] == {} and by["wled_devices"] == 0
    assert "wled_outputs" not in by, "no remembered WLED looks, no line"
    text = json.dumps(lines)
    for s in _SECRETS:
        assert s not in text, f"{s!r} got into a setup line"
    for ln in lines:
        assert tester._setup_value(ln["value"]) == ln["value"], ln


@pytest.mark.parametrize("kinds,text", [
    ({"ip_known": 0, "espresense": 0, "other": 19}, "19"),
    ({"ip_known": 5, "espresense": 0, "other": 0}, "5, all with diagnostics (ESPHome)"),
    ({"ip_known": 2, "espresense": 0, "other": 1}, "3 — 2 with diagnostics (ESPHome), 1 other"),
])
def test_the_scanner_line_says_each_number_once(kinds, text):
    """Design pass 2026-09-28: the form read "Scanners: 19 — 19 other"."""
    lines = {ln["key"]: ln for ln in tester.lines_from_report(_house(), {"env": {"scanner_kinds": kinds}})}
    assert lines["scanners"]["text"] == text
    assert lines["scanners"]["value"] == kinds, "the value that goes is unchanged"


def test_find_my_counts_read_as_plurals():
    """ "2 Apple device, 3 Find My accessory" → devices, accessories."""
    on_air = {"apple": 2, "airtag": 1, "accessory": 3, "airpods": 2}
    lines = {ln["key"]: ln for ln in tester.lines_from_report(_house(), {"env": {"findmy": {"on_air": on_air}}})}
    assert lines["findmy_on_air"]["text"] == "2 Apple devices, 1 AirTag, 3 Find My accessories, 2 AirPods"
    assert lines["findmy_on_air"]["value"] == on_air


def test_wled_outputs_are_counted_by_bus_type_from_the_remembered_looks():
    from custom_components.padspan_ha.const import DATA_WLED_LOOKS
    h = _house()
    look = lambda *types_: {"setup": {"geometry": {"buses": [{"type": t, "start": 0, "len": 30} for t in types_]}}}
    h.data[DOMAIN][DATA_WLED_LOOKS] = SimpleNamespace(data={"devices": {
        "AA:BB:CC:00:11:22": {"name": "Far West", "look": look(45, 22)},
        "AA:BB:CC:00:11:33": {"name": "Porch", "look": look(22)},
        "AA:BB:CC:00:11:44": {"name": "No look yet", "look": None},
    }})
    h.config_entries.async_entries = lambda d: [object(), object(), object()] if d == "wled" else []
    lines = {ln["key"]: ln for ln in tester.lines_from_report(h, T.build_payload(h))}
    assert lines["wled_outputs"]["value"] == {"type_22": 2, "type_45": 1}
    assert "5-channel PWM" in lines["wled_outputs"]["text"]
    assert lines["wled_devices"]["value"] == 3
    text = json.dumps(lines)
    assert "Far West" not in text and "AA:BB" not in text


def test_only_the_ticked_setup_lines_go(monkeypatch):
    h = _house()
    w = _wire(monkeypatch, _ok)
    _run(tester.sign_up(h, _form(setup_keys=["floors", "rooms", "not_a_line"])))
    body = w.posts[0][1]
    assert set(body["setup"]) == {"floors", "rooms"}
    shown = [ln["key"] for ln in _run(tester.setup_lines(h))]
    assert _record(h)["setup_off"] == [k for k in shown if k not in ("floors", "rooms")]
    w.posts.clear()
    _run(tester.sign_up(h, _form(setup_keys=[])))
    assert w.posts[0][1]["setup"] == {}, "an unticked line went anyway"


def test_the_install_id_goes_only_while_link_is_ticked(monkeypatch):
    h = _house()
    w = _wire(monkeypatch, _ok)
    _run(tester.sign_up(h, _form(link_reports=True)))
    assert w.posts[-1][1]["link_install_id"] == _INSTALL_ID and _record(h)["linked"] is True
    _run(tester.sign_up(h, _form(link_reports=False)))              # untick + update = unlinked
    assert "link_install_id" not in w.posts[-1][1] and _record(h)["linked"] is False
    assert _INSTALL_ID not in json.dumps(w.posts[-1][1])


def test_the_body_is_exactly_what_the_contract_says(monkeypatch):
    h = _house()
    w = _wire(monkeypatch, _ok)
    _run(tester.sign_up(h, _form(interests=["other", "wled"], interests_other=" Zigbee ", github="@octo-cat")))
    body = w.posts[0][1]
    assert set(body) <= {"schema", "action", "tester_id", "contact", "interests", "interests_other", "setup",
                         "notes", "timezone", "consent", "link_install_id", "version", "day"}
    assert body["schema"] == 1 and body["action"] == "signup" and body["consent"] is True
    assert body["contact"] == {"email": "tester@example.com", "github": "octo-cat", "name": "Octo"}
    assert body["interests"] == ["wled", "other"], "not in the closed list's order"
    assert body["interests_other"] == "Zigbee"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", body["day"])
    w.posts.clear()
    _run(tester.sign_up(h, _form(interests=["wled"], interests_other="left behind", name="", github="")))
    body = w.posts[0][1]
    assert "interests_other" not in body, "Other text went with Other unticked"
    assert body["contact"] == {"email": "tester@example.com"}, "empty optional fields went"


def test_a_withdrawal_carries_only_its_id(monkeypatch):
    h = _house(_SIGNUP)
    w = _wire(monkeypatch, _ok)
    _run(tester.withdraw(h))
    assert w.posts == [(tester.TESTER_URL, {"schema": 1, "action": "withdraw", "tester_id": _TESTER_ID})]


# ═══ 4. the checks ════════════════════════════════════════════════════════════

@pytest.mark.parametrize("over,words", [
    ({"email": ""}, "Enter an email address"),
    ({"email": "garry@"}, "email address doesn't look right"),
    ({"email": "garry@localhost"}, "email address doesn't look right"),
    ({"email": "g" * 250 + "@example.com"}, "email address doesn't look right"),
    ({"consent": False}, "agree to be contacted"),
    ({"consent": "true"}, "agree to be contacted"),
    ({"interests": ["wled", "rm -rf"]}, "Unknown choice"),
    ({"notes": "x" * 501}, "Notes are too long"),
    ({"notes": "key PSPAN-AAAA-BBBB-CCCC-DDDD"}, "PadSpan licence key"),
    ({"notes": "irk ec0234a357c8ad05341010a60a397d9b"}, "long hex string"),
    ({"notes": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop"}, "login token"),
    ({"notes": "ghp_" + "A1b2C3d4E5" * 4}, "long key or token"),
    ({"name": "ec0234a357c8ad05341010a60a397d9b"}, "in your name"),
    ({"interests": ["other"], "interests_other": "PSPAN-1234-5678-9ABC"}, "in 'Other'"),
    ({"github": "-octo"}, "GitHub username"),
    ({"timezone": "Not A/Zone"}, "time zone"),
    ({"name": "n" * 65}, "Name is too long"),
])
def test_a_bad_form_is_refused_in_words_and_nothing_is_sent(monkeypatch, over, words):
    h = _house()
    w = _wire(monkeypatch, _ok)
    _, problems = tester.clean_form(_form(**over), [])
    assert any(words in p for p in problems), problems
    with pytest.raises(tester.TesterError) as err:
        _run(tester.sign_up(h, _form(**over)))
    assert err.value.code == "invalid" and words in str(err.value)
    assert w.posts == [], "sent anyway"
    assert _record(h) == {}, "an id was kept for a sign-up that was never sent"


def test_ordinary_text_is_not_mistaken_for_a_secret():
    for text in ("see https://github.com/gbroeckling/padspanHA/issues/65",
                 "ESP32-S3-DevKitC-1-N8R8-with-external-antenna-and-PSRAM",
                 "my phone's UUID is 99a58376-461d-4a9b-9700-2375fcfd705b",
                 "Supercalifragilisticexpialidociousness-and-more-words-here",
                 "Nicole's office, upstairs; 3 proxies; Shelly Plus 1PM"):
        _, problems = tester.clean_form(_form(notes=text), [])
        assert problems == [], (text, problems)


def test_a_new_sign_up_needs_the_report_on_but_an_update_and_a_withdrawal_do_not(monkeypatch):
    w = _wire(monkeypatch, _ok)
    h = _house(report_on=False)
    with pytest.raises(tester.TesterError) as err:
        _run(tester.sign_up(h, _form()))
    assert err.value.code == "report_off" and w.posts == []
    assert _run(tester.preview(h, _form()))["problems"][0].startswith("Turn on the usage report")
    h = _house(_SIGNUP, report_on=False)
    assert _run(tester.sign_up(h, _form())) == "update"
    _run(tester.withdraw(h))
    assert [b["action"] for _, b in w.posts] == ["update", "withdraw"]


# ═══ 5. sending, keeping, withdrawing ═════════════════════════════════════════

def test_a_first_send_keeps_its_id_before_it_goes_and_the_rest_only_once_accepted(monkeypatch):
    """If the server stored it and the answer was lost, the next press must
    reach the SAME record — a new id would leave a copy nobody can withdraw."""
    h = _house()
    w = _wire(monkeypatch, lambda url, raw: (500, {"ok": False, "why": "store", "error": "disk full"}))
    with pytest.raises(tester.TesterError) as err:
        _run(tester.sign_up(h, _form()))
    assert err.value.code == "refused" and "disk full" in str(err.value)
    pending = _record(h)
    assert set(pending) == {"tester_id"}, "what was typed was kept before the server had it"
    assert not tester.signed_up(pending)
    w.answer = _ok
    _run(tester.sign_up(h, _form()))
    assert w.posts[0][1]["tester_id"] == w.posts[1][1]["tester_id"] == pending["tester_id"]
    assert [b["action"] for _, b in w.posts] == ["signup", "signup"]
    rec = _record(h)
    assert tester.signed_up(rec) and rec["email"] == "tester@example.com" and rec["tester_id"] == pending["tester_id"]


def test_an_answer_that_is_not_an_ok_is_a_failure(monkeypatch):
    h = _house()
    for answer in ((200, None), (200, {"ok": "yes"}), (200, ValueError("not json")), (204, {}),
                   (403, {"ok": True}), (429, {"ok": False, "error": "Too many sign-ups today."})):
        w = _wire(monkeypatch, lambda url, raw, a=answer: a)
        with pytest.raises(tester.TesterError):
            _run(tester.sign_up(h, _form()))
        assert len(w.posts) == 1, "retried"
        assert not tester.signed_up(_record(h))


def test_a_dead_network_is_said_plainly_and_nothing_retries(monkeypatch):
    h = _house()

    def dead(url, raw):
        raise OSError("connection refused")

    w = _wire(monkeypatch, dead)
    with pytest.raises(tester.TesterError) as err:
        _run(tester.sign_up(h, _form()))
    assert err.value.code == "network" and "padspan.traks.ca" in str(err.value)
    assert len(w.posts) == 1


def test_an_update_keeps_the_first_date_and_replaces_what_was_typed(monkeypatch):
    h = _house(_SIGNUP)
    w = _wire(monkeypatch, _ok)
    assert _run(tester.sign_up(h, _form(email="new@example.com", notes=""))) == "update"
    rec = _record(h)
    assert rec["tester_id"] == _TESTER_ID and w.posts[0][1]["tester_id"] == _TESTER_ID
    assert rec["signed_up_at"] == _SIGNUP["signed_up_at"] and rec["updated_at"] != _SIGNUP["updated_at"]
    assert rec["email"] == "new@example.com" and rec["notes"] == "" and "notes" not in w.posts[0][1]


def test_a_withdrawal_clears_the_record_here_only_on_the_servers_word(monkeypatch):
    for answer in ((500, {"ok": False}), (200, {"ok": False}), (200, None), (404, None)):
        h = _house(_SIGNUP)
        w = _wire(monkeypatch, lambda url, raw, a=answer: a)
        with pytest.raises(tester.TesterError):
            _run(tester.withdraw(h))
        assert _record(h) == _SIGNUP, f"cleared on {answer}"
        assert len(w.posts) == 1
    h = _house(_SIGNUP)

    def dead(url, raw):
        raise OSError("no route")

    _wire(monkeypatch, dead)
    with pytest.raises(tester.TesterError):
        _run(tester.withdraw(h))
    assert _record(h) == _SIGNUP
    _wire(monkeypatch, _ok)
    _run(tester.withdraw(h))
    assert _record(h) == {}


def test_looking_sends_nothing(monkeypatch):
    """Status and Preview are for the person's eyes: no request leaves."""
    h = _house(_SIGNUP)
    w = _wire(monkeypatch, _ok)
    st = _run(tester.status(h))
    assert st["signed_up"] is True and st["record"]["email"] == _EMAIL and st["default_timezone"] == _TZ
    assert st["setup"] and set(st) == {"signed_up", "record", "setup", "default_timezone"}
    pv = _run(tester.preview(h, _form(link_reports=True)))
    assert pv["problems"] == [] and pv["payload"]["tester_id"] == _TESTER_ID
    assert pv["payload"]["action"] == "update" and pv["payload"]["link_install_id"] == _INSTALL_ID
    assert pv["bytes"] == len(tester._encode(pv["payload"]))
    fresh = _run(tester.preview(_house(), _form()))
    assert fresh["payload"]["tester_id"] == tester.NEW_ID_PLACEHOLDER
    bad = _run(tester.preview(_house(), _form(consent=False)))
    assert bad["payload"] is None and bad["problems"]
    assert w.posts == []


def test_an_oversized_sign_up_is_refused_before_it_is_sent(monkeypatch):
    h = _house()
    w = _wire(monkeypatch, _ok)
    monkeypatch.setattr(tester, "MAX_BYTES", 300)
    with pytest.raises(tester.TesterError) as err:
        _run(tester.sign_up(h, _form()))
    assert err.value.code == "too_long" and w.posts == []


# ═══ 6. the commands ══════════════════════════════════════════════════════════

_COMMANDS = ("tester_status", "tester_preview", "tester_signup", "tester_withdraw")


def test_the_commands_are_registered_and_admin_only():
    ws = (_CC / "websocket.py").read_text(encoding="utf-8")
    src = (_CC / "ws_tester.py").read_text(encoding="utf-8")
    for cmd in _COMMANDS:
        assert f"async_register_command(hass, ws_{cmd})" in ws, cmd
        decorators = src.split(f'"padspan_ha/{cmd}"')[1].split(f"async def ws_{cmd}")[0]
        assert "@websocket_api.require_admin" in decorators, f"{cmd} is not admin-only"


def test_a_refusal_reaches_the_panel_as_an_error_with_its_words(monkeypatch):
    from custom_components.padspan_ha import ws_tester as W
    _wire(monkeypatch, _ok)
    h = _house(report_on=False)
    sent = {}
    conn = SimpleNamespace(send_error=lambda i, code, m: sent.update(code=code, message=m),
                           send_result=lambda i, r: sent.update(result=r))
    _run(W.ws_tester_signup(h, conn, {"id": 1, "type": "padspan_ha/tester_signup", **_form()}))
    assert sent.get("code") == "report_off" and "result" not in sent
    sent.clear()
    h = _house()
    _run(W.ws_tester_signup(h, conn, {"id": 2, "type": "padspan_ha/tester_signup", **_form()}))
    assert sent["result"]["ok"] is True and sent["result"]["status"]["signed_up"] is True


def test_the_form_schema_takes_exactly_what_the_panel_sends():
    from custom_components.padspan_ha import ws_tester as W
    keys = {str(getattr(k, "schema", k)) for k in W.ws_tester_signup.ws_schema}
    assert keys == {"type", "email", "github", "name", "interests", "interests_other", "setup_keys",
                    "notes", "timezone", "consent", "link_reports"}
    js = (_CC / "www" / "padspan-ha" / "views" / "tester_signup.js").read_text(encoding="utf-8")
    msg = js[js.index("export function testerMessage("):js.index("export function testerDraft(")]
    for k in keys - {"type"}:
        assert f"{k}:" in msg, f"the panel never sends {k}"


# ═══ 7. kept through a reset and a restore ════════════════════════════════════

class _FakeStore:
    saved: dict = {}

    def __init__(self, hass, version, key):
        self._key = key

    async def async_load(self):
        return None

    async def async_save(self, data):
        _FakeStore.saved[self._key] = data

    async def async_remove(self):
        _FakeStore.saved.pop(self._key, None)


def test_a_factory_reset_keeps_the_sign_up_so_it_can_still_be_withdrawn(monkeypatch):
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    _FakeStore.saved = {}
    monkeypatch.setattr(_hs, "Store", _FakeStore)
    h = _house(_SIGNUP)
    h.data[DOMAIN][DATA_SETTINGS].data["quiet_mode"] = True
    _run(ws_factory_reset(h, MagicMock(), {"id": 1, "confirm": "FACTORY RESET"}))
    after = h.data[DOMAIN][DATA_SETTINGS].data
    assert after["quiet_mode"] is False, "the reset did not run"
    assert after[tester.SETTINGS_KEY] == _SIGNUP
    assert _FakeStore.saved[SETTINGS_STORE_KEY][tester.SETTINGS_KEY] == _SIGNUP
    h2 = _house()
    _run(ws_factory_reset(h2, MagicMock(), {"id": 1, "confirm": "FACTORY RESET"}))
    assert h2.data[DOMAIN][DATA_SETTINGS].data[tester.SETTINGS_KEY] == {}


@pytest.mark.parametrize("live,in_backup", [(_SIGNUP, {}), ({}, _SIGNUP)])
def test_a_restore_keeps_the_live_sign_up_never_the_backups(monkeypatch, live, in_backup):
    """An older backup can neither lose a sign-up nobody could then withdraw,
    nor bring back one that was withdrawn."""
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha import ws_backup
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    _FakeStore.saved = {}
    monkeypatch.setattr(_hs, "Store", _FakeStore)
    bk = {"backups": [{"id": "bk1", "created_at": "2026-01-01T00:00:00+00:00", "version": "0.38.80",
                       "note": "", "map_images": {},
                       "stores": {SETTINGS_STORE_KEY: {"quiet_mode": True, tester.SETTINGS_KEY: copy.deepcopy(in_backup)}}}]}

    async def _load(_hass):
        return bk

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    h = _house(live)
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {"id": 1, "backup_id": "bk1",
                                                              "store_keys": [SETTINGS_STORE_KEY]}))
    after = h.data[DOMAIN][DATA_SETTINGS].data
    assert after["quiet_mode"] is True, "the restore did not run"
    assert after[tester.SETTINGS_KEY] == live
    assert _FakeStore.saved[SETTINGS_STORE_KEY][tester.SETTINGS_KEY] == live


# ═══ 8. the server, ported ════════════════════════════════════════════════════

def _php() -> str:
    if not _PHP.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    return _PHP.read_text(encoding="utf-8")


def _php_list(src: str, name: str) -> list[str]:
    m = re.search(rf"\${name} = array\((.*?)\);", src, re.S)
    assert m, f"${name} is gone from tester.php"
    return re.findall(r"'([^']*)'", m.group(1))


def _php_limits(src: str) -> dict[str, int]:
    m = re.search(r"\$LIMITS = array\((.*?)\);", src, re.S)
    return {k: int(v) for k, v in re.findall(r"'(\w+)' => (\d+)", m.group(1))}


def _php_string(src: str, name: str) -> str:
    m = re.search(rf"\${name} = '((?:[^'\\]|\\.)*)';", src)
    assert m, f"${name} is gone from tester.php"
    return m.group(1).replace("\\'", "'")


def _php_anchored(delimited: str) -> str:
    """'/^core$/D' or '#^core$#D' -> core."""
    d = delimited[0]
    body = delimited[1:delimited.rindex(d)]
    assert body.startswith("^") and body.endswith("$") and delimited.endswith(d + "D"), delimited
    return body[1:-1]


def _php_secrets(src: str) -> list[tuple[str, str]]:
    m = re.search(r"\$SECRETS = array\((.*?)\n\);", src, re.S)
    assert m, "$SECRETS is gone from tester.php"
    return [(what, rx[1:-1]) for what, rx in re.findall(r"'([^']*)' => '((?:[^'\\]|\\.)*)'", m.group(1))]


class _Receiver:
    """server/tester.php, in Python, line for line. Its lists and patterns
    are read out of the PHP source, so the port runs the receiver's own
    rules; the logic below mirrors the PHP control flow (keep it so)."""

    CONTROL = re.compile(r"[\x00-\x1f\x7f]")
    NOTES_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
    VERSION = re.compile(r"[A-Za-z0-9._+-]{1,32}")
    SETUP_STR = re.compile(r"[A-Za-z0-9 ._+-]{1,32}")
    SETUP_SUBKEY = re.compile(r"[a-z0-9_]{1,24}")

    def __init__(self, src: str):
        self.interests = _php_list(src, "INTERESTS")
        self.setup_keys = _php_list(src, "SETUP_KEYS")
        self.limits = _php_limits(src)
        self.max = int(re.search(r"\$MAX = (\d+);", src).group(1))
        self.max_records = int(re.search(r"\$MAX_RECORDS = (\d+);", src).group(1))
        self.max_new = int(re.search(r"\$MAX_NEW_PER_DAY = (\d+);", src).group(1))
        full = lambda name: re.compile(_php_anchored(_php_string(src, name)))
        self.email, self.github = full("EMAIL_RX"), full("GITHUB_RX")
        self.tz, self.uuid = full("TIMEZONE_RX"), full("UUID_RX")
        self.secrets = [(w, re.compile(rx, re.ASCII)) for w, rx in _php_secrets(src)]
        self.db: dict = {}
        self.log: list[dict] = []
        self.corrupt = False
        self.today, self.now = "2026-09-28", "2026-09-28T12:00:00+00:00"

    def setup_value(self, v):
        if isinstance(v, bool):
            return None
        if isinstance(v, int):
            return v if 0 <= v <= 1000000 else None
        if isinstance(v, str):
            return v if self.SETUP_STR.fullmatch(v) else None
        if isinstance(v, list):                       # a PHP array: [] is count 0, any other has int keys
            return {} if not v else None
        if isinstance(v, dict):
            if len(v) > 12:
                return None
            out = {}
            for k, n in v.items():
                if not self.SETUP_SUBKEY.fullmatch(k):
                    return None
                if isinstance(n, bool) or not isinstance(n, int) or n < 0 or n > 1000000:
                    return None
                out[k] = n
            return out
        return None

    def handle(self, raw: bytes, method: str = "POST") -> tuple[int, dict]:
        def reply(code, why=""):
            return code, ({"ok": code == 200, "why": why} if why else {"ok": code == 200})
        if method != "POST":
            return reply(405, "method")
        if len(raw) > self.max:
            return reply(413, "size")
        try:
            r = json.loads(raw.decode("utf-8"))
        except ValueError:
            return reply(400, "json")
        if not isinstance(r, dict):
            return reply(400, "json")
        if not (type(r.get("schema")) is int and r["schema"] == 1):
            return reply(400, "schema")
        action = r["action"] if isinstance(r.get("action"), str) else ""
        if action not in ("signup", "update", "withdraw"):
            return reply(400, "action")
        tid = r["tester_id"].lower() if isinstance(r.get("tester_id"), str) else ""
        if not self.uuid.fullmatch(tid):
            return reply(400, "id")
        testers = self.db.setdefault("testers", {})
        if action == "withdraw":
            if self.corrupt:
                return reply(500, "store")
            if tid in testers:
                del testers[tid]
                self.log.append({"tester_id": tid, "withdrawn_at": self.now})
            return reply(200)
        if r.get("consent") is not True:
            return reply(400, "consent")
        c = r["contact"] if isinstance(r.get("contact"), dict) else {}
        email = c["email"] if isinstance(c.get("email"), str) else ""
        if email == "" or len(email.encode()) > self.limits["email"] or not self.email.fullmatch(email):
            return reply(400, "email")
        contact = {"email": email}
        if c.get("github") is not None and c.get("github") != "":
            if not isinstance(c["github"], str) or not self.github.fullmatch(c["github"]):
                return reply(400, "github")
            contact["github"] = c["github"]
        if c.get("name") is not None and c.get("name") != "":
            n = c["name"]
            if not isinstance(n, str) or len(n) > self.limits["name"] or self.CONTROL.search(n):
                return reply(400, "name")
            contact["name"] = n
        given = r.get("interests")
        given = given if isinstance(given, list) else (list(given.values()) if isinstance(given, dict) else [])
        interests = [k for k in self.interests if any(type(g) is str and g == k for g in given)]
        rec = {"tester_id": tid, "contact": contact, "interests": interests}
        o = r.get("interests_other")
        if "other" in interests and o is not None and o != "":
            if not isinstance(o, str) or len(o) > self.limits["interests_other"] or self.CONTROL.search(o):
                return reply(400, "interests_other")
            rec["interests_other"] = o
        n = r.get("notes")
        if n is not None and n != "":
            if not isinstance(n, str) or len(n) > self.limits["notes"] or self.NOTES_CONTROL.search(n):
                return reply(400, "notes")
            rec["notes"] = n
        tz = r.get("timezone")
        if tz is not None and tz != "":
            if not isinstance(tz, str) or len(tz.encode()) > self.limits["timezone"] or not self.tz.fullmatch(tz):
                return reply(400, "timezone")
            rec["timezone"] = tz
        for text in (contact.get("name", ""), contact.get("github", ""), rec.get("interests_other", ""),
                     rec.get("notes", "")):
            if any(rx.search(text) for _, rx in self.secrets):
                return reply(400, "secret")
        setup = {}
        if isinstance(r.get("setup"), dict):
            for k in self.setup_keys:
                if k in r["setup"]:
                    v = self.setup_value(r["setup"][k])
                    if v is not None:
                        setup[k] = v
        rec["setup"] = setup
        if isinstance(r.get("version"), str) and self.VERSION.fullmatch(r["version"]):
            rec["version"] = r["version"]
        li = r.get("link_install_id")
        if isinstance(li, str) and self.uuid.fullmatch(li.lower()):
            rec["link_install_id"] = li.lower()
        if self.corrupt:
            return reply(500, "store")
        old = testers.get(tid) if isinstance(testers.get(tid), dict) else None
        if old is None:
            if len(testers) >= self.max_records:
                return reply(503, "full")
            g = dict(self.db.get("guard") or {"day": "", "new": 0})
            if g.get("day") != self.today or "new" not in g:
                g = {"day": self.today, "new": 0}
            if int(g["new"]) >= self.max_new:
                return reply(429, "busy")
            g["new"] = int(g["new"]) + 1
            self.db["guard"] = g
        rec["created"] = old["created"] if old and "created" in old else self.now
        rec["updated"] = self.now
        testers[tid] = rec
        return reply(200)


@pytest.fixture
def server() -> _Receiver:
    return _Receiver(_php())


def _via(server: _Receiver):
    return lambda url, raw: server.handle(raw)


def test_the_port_is_held_to_the_php_source_and_to_tester_py():
    src = _php()
    assert _php_list(src, "INTERESTS") == list(tester.INTERESTS)
    assert _php_list(src, "SETUP_KEYS") == list(tester.SETUP_KEYS)
    assert _php_limits(src) == {k: v for k, v in tester.LIMITS.items() if k != "github"}
    assert _php_anchored(_php_string(src, "EMAIL_RX")) == tester.EMAIL_PATTERN
    assert _php_anchored(_php_string(src, "GITHUB_RX")) == tester.GITHUB_PATTERN
    assert _php_anchored(_php_string(src, "TIMEZONE_RX")) == tester.TIMEZONE_PATTERN
    assert _php_secrets(src) == list(tester.SECRET_PATTERNS)
    assert f"$MAX = {tester.MAX_BYTES};" in src
    assert "$MAX_RECORDS = 500;" in src and "$MAX_NEW_PER_DAY = 100;" in src
    assert f"'/^{tester._SETUP_STR_PATTERN}$/D'" in src and f"'/^{tester._SETUP_SUBKEY_PATTERN}$/D'" in src
    assert "count($v) > 12" in src and "1000000" in src
    # The port's own fixed patterns are the PHP's.
    for php_rx in ("'/[\\x00-\\x1f\\x7f]/'", "'/[\\x00-\\x08\\x0b-\\x1f\\x7f]/'", "'/^[A-Za-z0-9._+-]{1,32}$/D'"):
        assert php_rx in src, php_rx


def test_the_server_keeps_no_ip_no_agent_and_nothing_of_the_report():
    src = _php()
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))
    for banned in ("REMOTE_ADDR", "HTTP_USER_AGENT", "HTTP_X_FORWARDED", "getallheaders",
                   "apache_request_headers", "HTTP_CLIENT_IP", "padspan-telemetry", "installs.json"):
        assert banned not in code, f"tester.php reaches for {banned}"
    assert "$DIR = __DIR__ . '/../../../private/padspan-testers';" in code
    assert "flock($h, LOCK_EX)" in code and "$dir . '/testers.json'" in code
    # A withdrawal leaves exactly the id and the time behind — nothing that says who.
    m = re.search(r"withdrawals\.log',\s*json_encode\(array\((.*?)\)\)", code, re.S)
    assert m and set(re.findall(r"'(\w+)' =>", m.group(1))) == {"tester_id", "withdrawn_at"}, m
    assert "$_SERVER['REQUEST_METHOD'] !== 'POST'" in code
    # And the report's receiver never looks at the sign-ups.
    assert "padspan-testers" not in (_ROOT / "server" / "telemetry.php").read_text(encoding="utf-8")


def test_what_the_integration_sends_the_server_takes_whole(monkeypatch, server):
    h = _house()
    _wire(monkeypatch, _via(server))
    _run(tester.sign_up(h, _form(interests=["wled", "other"], interests_other="Zigbee", link_reports=True,
                                 setup_keys=list(tester.SETUP_KEYS))))
    tid = _record(h)["tester_id"]
    rec = server.db["testers"][tid]
    assert rec["contact"] == {"email": "tester@example.com", "github": "octo-cat", "name": "Octo"}
    assert rec["interests"] == ["wled", "other"] and rec["interests_other"] == "Zigbee"
    assert rec["notes"] == _GOOD["notes"] and rec["timezone"] == _TZ and rec["link_install_id"] == _INSTALL_ID
    lines = {ln["key"]: ln["value"] for ln in _run(tester.setup_lines(h))}
    assert rec["setup"] == lines, "the server dropped a setup line the integration sent"
    assert rec["created"] == rec["updated"] == server.now
    # Unticking the link and clearing the notes: an update replaces the record whole.
    _run(tester.sign_up(h, _form(notes="", link_reports=False)))
    rec = server.db["testers"][tid]
    assert "link_install_id" not in rec and "notes" not in rec and "interests_other" not in rec
    assert server.db["guard"]["new"] == 1, "an update counted as a new sign-up"
    # And withdrawing: gone there, a log line with nothing that says who, gone here.
    _run(tester.withdraw(h))
    assert tid not in server.db["testers"] and _record(h) == {}
    assert server.log == [{"tester_id": tid, "withdrawn_at": server.now}]


def test_the_server_refuses_what_the_integration_would_never_send(server):
    tid = "0b1e3f6e-9c1a-4e0b-8a44-5a8c1f7d2e10"
    good = {"schema": 1, "action": "signup", "tester_id": tid, "contact": {"email": "a@example.com"},
            "interests": ["wled"], "setup": {}, "consent": True, "version": "0.38.85", "day": "2026-09-28"}
    raw = lambda d: json.dumps(d).encode()
    cases = [
        ({**good, "consent": False}, 400, "consent"), ({**good, "consent": 1}, 400, "consent"),
        ({k: v for k, v in good.items() if k != "consent"}, 400, "consent"),
        ({**good, "contact": {"email": "nope"}}, 400, "email"), ({**good, "contact": ["a@example.com"]}, 400, "email"),
        ({**good, "schema": 2}, 400, "schema"), ({**good, "schema": True}, 400, "schema"),
        ({**good, "action": "delete_all"}, 400, "action"), ({**good, "tester_id": "../../etc"}, 400, "id"),
        ({**good, "notes": "PSPAN-AAAA-BBBB-CCCC"}, 400, "secret"),
        ({**good, "notes": "k " + "ab" * 16}, 400, "secret"),
        ({**good, "contact": {"email": "a@example.com", "name": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk"}}, 400, "secret"),
        ({**good, "notes": "n" * 501}, 400, "notes"),
        ({**good, "contact": {"email": "a@example.com", "github": "bad--name"}}, 400, "github"),
        ({**good, "timezone": "Mars Base"}, 400, "timezone"),
    ]
    for body, code, why in cases:
        assert server.handle(raw(body)) == (code, {"ok": False, "why": why}), body
    assert server.handle(b"[1, 2]")[1]["why"] == "json"
    assert server.handle(b"not json")[1]["why"] == "json"
    assert server.handle(raw(good), method="GET")[0] == 405
    assert server.handle(raw({**good, "notes": "x" * 5000}))[0] == 413
    assert server.db.get("testers", {}) == {}, "a refused sign-up was stored"


def test_the_server_drops_what_it_does_not_know(server):
    tid = "0b1e3f6e-9c1a-4e0b-8a44-5a8c1f7d2e10"
    body = {"schema": 1, "action": "signup", "tester_id": tid.upper(), "consent": True,
            "contact": {"email": "a@example.com", "phone": "+1 604 555 0100"},
            "interests": ["wled", "port_scanning", 7], "interests_other": "ignored without other",
            "setup": {"floors": 3, "rooms": True, "wled_outputs": {"type_45": 1, "Bad Key": 2},
                      "scanners": {"ip_known": 2}, "home_address": "1 Main St", "tier": "pro<script>"},
            "ip": "203.0.113.9", "user_agent": "curl", "version": "0.38.85",
            "link_install_id": "not-a-uuid"}
    assert server.handle(json.dumps(body).encode()) == (200, {"ok": True})
    rec = server.db["testers"][tid]
    assert set(rec) == {"tester_id", "contact", "interests", "setup", "version", "created", "updated"}
    assert rec["contact"] == {"email": "a@example.com"} and rec["interests"] == ["wled"]
    assert rec["setup"] == {"floors": 3, "scanners": {"ip_known": 2}}


def test_the_abuse_guard(server):
    raw = lambda tid: json.dumps({"schema": 1, "action": "signup", "tester_id": tid, "consent": True,
                                  "contact": {"email": "a@example.com"}}).encode()
    ids = [f"00000000-0000-4000-8000-{i:012d}" for i in range(102)]
    for tid in ids[:100]:
        assert server.handle(raw(tid))[0] == 200
    assert server.handle(raw(ids[100])) == (429, {"ok": False, "why": "busy"})
    assert server.handle(raw(ids[5]))[0] == 200, "an update is not a new sign-up"
    server.today = "2026-09-29"
    assert server.handle(raw(ids[100]))[0] == 200, "the day's count did not reset"
    server.db["testers"] = {f"10000000-0000-4000-8000-{i:012d}": {"created": "x"} for i in range(500)}
    assert server.handle(raw(ids[101])) == (503, {"ok": False, "why": "full"})


def test_an_unreadable_server_list_changes_nothing_and_the_sign_up_stays_here(monkeypatch, server):
    h = _house(_SIGNUP)
    _wire(monkeypatch, _via(server))
    server.corrupt = True
    with pytest.raises(tester.TesterError):
        _run(tester.withdraw(h))
    assert _record(h) == _SIGNUP and server.log == []


# ═══ 9. said where the report is said ═════════════════════════════════════════

def test_the_sign_up_is_disclosed_beside_the_report():
    """README (or Bright's generated one) and the site say what it is, that it
    is separate, how long it is kept and how to withdraw."""
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    for words in ("Become a tester", "Stop being a tester", "never shared or sold", "separate"):
        assert words in readme, words
    site = _ROOT / "site" / "index.html"
    if site.exists():
        html = site.read_text(encoding="utf-8")
        for words in ("Become a tester", "Stop being a tester", "never shared or sold", "opt-in usage report"):
            assert words in html, words
    assert "separate channel" in (T.__doc__ or "") and "never part of this report" in (T.__doc__ or "")


# ═══ 10. the nightly pull ═════════════════════════════════════════════════════

def _pull() -> str:
    if not _PULL.exists():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    return _PULL.read_text(encoding="utf-8")


def _notice_script() -> str:
    src = _pull()
    return src.split("<<'TESTERS_PY'\n", 1)[1].split("\nTESTERS_PY\n", 1)[0]


def _notice(tmp_path, new, prev=None):
    (tmp_path / "new.json").write_text(json.dumps(new) if not isinstance(new, str) else new, encoding="utf-8")
    prev_path = tmp_path / "prev.json"
    if prev is not None:
        prev_path.write_text(json.dumps(prev), encoding="utf-8")
    elif prev_path.exists():
        prev_path.unlink()
    (tmp_path / "notice.py").write_text(_notice_script(), encoding="utf-8")
    return subprocess.run([sys.executable, str(tmp_path / "notice.py"), str(prev_path), str(tmp_path / "new.json")],
                          capture_output=True, text=True, encoding="utf-8", timeout=60)


def _rec(email, interests, version="0.38.85"):
    return {"contact": {"email": email, "name": "Should Not Appear", "github": "hidden-user"},
            "interests": interests, "version": version, "notes": "secret-ish notes", "timezone": "Europe/Berlin",
            "link_install_id": _INSTALL_ID, "setup": {"floors": 3}}


def test_the_pull_names_only_new_sign_ups_and_only_email_interests_version(tmp_path):
    a, b = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
    new = {"schema": 1, "testers": {a: _rec("a@example.com", ["wled", "floors"]), b: _rec("b@example.com", [])}}
    out = _notice(tmp_path, new)
    assert out.returncode == 0, out.stderr
    msg = out.stdout.strip()
    assert msg.splitlines()[0] == "PadSpan: 2 new tester sign-ups"
    assert "- a@example.com | wled, floors | PadSpan 0.38.85" in msg and "- b@example.com | none ticked | PadSpan 0.38.85" in msg
    for hidden in ("Should Not Appear", "hidden-user", "secret-ish", "Europe/Berlin", _INSTALL_ID, a, b, "floors\": 3"):
        assert hidden not in msg, f"{hidden!r} went into the Telegram message"
    out = _notice(tmp_path, new, prev={"testers": {a: new["testers"][a]}})
    assert out.stdout.strip() == "PadSpan: 1 new tester sign-up\n- b@example.com | none ticked | PadSpan 0.38.85"
    assert _notice(tmp_path, new, prev=new).stdout.strip() == "", "no new id, yet a message"


def test_the_pull_keeps_one_message_within_telegrams_limit(tmp_path):
    many = {"testers": {f"00000000-0000-4000-8000-{i:012d}": _rec(f"person{i}@example.com", ["wled", "floors", "bermuda"])
                        for i in range(150)}}
    out = _notice(tmp_path, many)
    assert out.returncode == 0 and len(out.stdout) <= 4096
    assert re.search(r"\(\+\d+ more in testers\.json\)", out.stdout)


def test_the_pull_refuses_a_torn_copy(tmp_path):
    assert _notice(tmp_path, '{"testers": {"a": ').returncode != 0
    assert _notice(tmp_path, {"no": "testers"}).returncode != 0


def test_the_pull_is_read_only_private_and_uses_the_existing_telegram_sender():
    src = _pull()
    block = src[src.index('T_SRC="'):src.index('if [ "$bad" -ne 0 ]')]
    assert 'T_DEST="/mnt/storage/knowledge/padspan-testers"' in block
    assert 'T_SRC="/var/www/clients/client1/web10/private/padspan-testers/testers.json"' in block
    assert "--delete" not in block and "rm -f -- '$SRC" not in block and "sudo rm" not in block, "the pull touches the colo"
    assert 'chmod 700 "$T_DEST"' in block and 'chmod 600 "$T_DEST/.testers.json.new"' in block
    assert 'tg "$new_msg"' in block and block.count("tg ") <= 4
    assert "CHAT=8841564535" in src, "the Telegram sender is no longer Garry's chat only"
    # The copy here is replaced whole each night, never accumulated.
    assert 'mv -f "$T_DEST/.testers.json.new" "$T_DEST/testers.json"' in block
