"""The one-time 3-month PadSpan Bright Pro trial.

It must mint a real key through the same slot a purchase uses (so expiry,
grace and the editing-only gate all apply with zero new logic in licence.py),
must never be silent (an explicit email + button, not something a fresh
install grants on its own), and must survive a factory reset the same way a
purchased key does — otherwise resetting a house mid-trial would cosmetically
relabel it as a paid licence.
"""
from __future__ import annotations

import pathlib
import re

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_VIEWS = _CC / "www" / "padspan-ha" / "views"


def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8")


def test_trial_key_defaults_to_false_and_is_not_the_gate() -> None:
    s = _read(_CC / "settings_store.py")
    assert '"license_is_trial": False,' in s, "license_is_trial is not a defined, default-False setting"
    # It must be display-only: the tier ladder reads license_tier, never this flag.
    licence_src = _read(_CC / "licence.py")
    assert "license_is_trial" not in licence_src, (
        "licence.py must not branch on license_is_trial — a trial key gates exactly like a purchased one")


def test_trial_start_is_registered_and_admin_gated() -> None:
    s = _read(_CC / "ws_forensics.py")
    assert '"type": "padspan_ha/trial_start"' in s, "the trial_start command is gone"
    handler = s[s.index("async def ws_trial_start("):]
    preamble = s[:s.index("async def ws_trial_start(")]
    # require_admin must be the decorator immediately above this handler, not
    # some other one — walk back from the def to the nearest decorator block.
    block = preamble[preamble.rindex('{\n        "type": "padspan_ha/trial_start"'):]
    assert "@websocket_api.require_admin" in block, "trial_start is not admin-gated"

    ws_py = _read(_CC / "websocket.py")
    assert "ws_trial_start" in ws_py, "trial_start is imported"
    assert re.search(r"async_register_command\(hass, ws_trial_start\)", ws_py), (
        "trial_start is never registered with Home Assistant")


def test_trial_start_calls_the_same_licence_server_as_a_purchase() -> None:
    s = _read(_CC / "ws_forensics.py")
    handler = s[s.index("async def ws_trial_start("):]
    handler = handler[:handler.index("\n@websocket_api.websocket_command", 200)] if "\n@websocket_api.websocket_command" in handler[200:] else handler
    assert "https://traks.ca/license/" in handler, "trial_start hits a different server than purchases"
    assert '"action": "trial_start"' in handler
    assert '"product": "padspan"' in handler
    assert "machine" in handler, "trial_start does not send the per-install identifier the abuse gate relies on"
    assert "email" in handler
    # On success it must write into the SAME fields a purchase does, plus the
    # display-only trial flag — one gate, no parallel tier logic.
    assert "forensics_license_key=" in handler
    assert "forensics_license_expires=" in handler
    assert "license_tier=normalize_tier(" in handler
    assert "license_is_trial=True" in handler


def test_factory_reset_preserves_an_active_trial() -> None:
    s = _read(_CC / "ws_factory_reset.py")
    i = s.index("_keep_licence = {")
    block = s[i:i + 400]
    assert "license_is_trial" in block, (
        "a factory reset mid-trial would silently relabel it as a paid licence")


def test_licence_card_offers_the_trial_with_no_card_language() -> None:
    # The card is the shared one (views/trial_offer.js, tests/test_conversion.py
    # runs it); the licence card shows it while there is no key.
    s = _read(_VIEWS / "settings.js")
    card = s[s.index("function _settingsLicence("):]
    card = card[:card.index("\nfunction ")] if "\nfunction " in card else card
    assert 'trialOfferFromCtx(ctx, "settings"' in card, "the licence card cannot start a trial"
    offer = _read(_VIEWS / "trial_offer.js")
    assert "padspan_ha/trial_start" in offer
    assert '"Start 90-day free trial"' in offer
    assert '"90-day free trial, no card"' in offer, "the trial CTA must say no payment info is needed"


def test_the_free_forever_claim_still_holds_and_the_trial_is_disclosed() -> None:
    """The tiers wizard used to say "nothing free is a trial of anything" —
    true of the free tier, but flatly wrong once a real trial exists. It must
    still promise the free tier is not time-limited, and now also disclose
    the trial rather than contradict it."""
    s = _read(_VIEWS / "settings.js")
    i = s.index("A key only ever unlocks two things beyond that")
    para = s[i:i + 700]
    assert "not a trial" in para or "stays free" in para, "the free-forever promise was dropped, not reworded"
    assert "90-day" in para, "the tiers wizard does not disclose the trial that contradicts its old claim"


def test_the_trial_needs_the_usage_report_on() -> None:
    """Every free offer needs the opt-in usage report on (Garry, 2026-10-27):
    refused before anything goes to the licence server; the card asks in the
    same step (tests/js/trial_offer.mjs)."""
    s = _read(_CC / "ws_forensics.py")
    handler = s[s.index("async def ws_trial_start("):]
    gate = handler.index("if not _report_on(hass):")
    assert gate < handler.index("https://traks.ca/license/"), "the report is checked after the licence server is asked"
    assert '"status": "report_off"' in handler


def test_a_new_free_licence_holds_the_usage_report_on_until_it_ends() -> None:
    """Garry, 2026-10-27: the opt-in can't be turned off during a free trial,
    nor the new free years of Pro (a tester's two, an invite's one). The lock
    is the key it came with: a bought key in its place, or the end, lets it go;
    a free licence from before the rule never had one."""
    from custom_components.padspan_ha.settings_store import licence_key_hash as H, report_locked_until as L
    new = {"report_locked_key": H("PSPAN-T"), "forensics_license_key": "PSPAN-T",
           "forensics_license_expires": "2099-01-01 00:00:00"}
    assert L(new).startswith("2099-01-01")
    assert L({**new, "forensics_license_expires": "2001-01-01 00:00:00"}) == "", "it ended"
    assert L({**new, "forensics_license_key": "PSPAN-BOUGHT"}) == "", "a bought key replaced it"
    assert L({**new, "report_locked_key": ""}) == "", "a free licence from before the rule"
    assert H("pspan-t ") == H("PSPAN-T") and H("") == ""
    s = _read(_CC / "ws_forensics.py")
    assert 'report_locked_key=licence_key_hash(str(data.get("key") or "")),' in s[s.index("async def ws_trial_start("):]
    # A tester key typed in: refused with the report off, locked when new.
    act = s[:s.index("async def ws_trial_start(")]
    assert '_free_new = bool(data.get("valid")) and new_key and str(data.get("plan") or "") == "tester"' in act
    assert '"report_locked_key": _lk_hash(key) if _free_new else ""' in act
    # The panel sees only the end date, never the hash.
    common = _read(_CC / "ws_common.py")
    assert 'out["report_locked"] = _rlu(st.data if st else {})' in common and 'out.pop("report_locked_key", None)' in common


def test_the_report_cannot_be_turned_off_during_a_new_free_licence() -> None:
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from custom_components.padspan_ha import ws_settings as WS
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    from custom_components.padspan_ha.settings_store import licence_key_hash as H
    data = {"telemetry_enabled": True, "report_locked_key": H("PSPAN-T"),
            "forensics_license_key": "PSPAN-T", "forensics_license_expires": "2099-01-01 00:00:00"}
    st = SimpleNamespace(data=data)

    async def _set(**kw):
        data.update(kw)
    st.async_set = _set
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    asyncio.new_event_loop().run_until_complete(WS.ws_settings_set(hass, conn, {"id": 1, "telemetry_enabled": False}))
    conn.send_error.assert_called_once()
    assert conn.send_error.call_args.args[1] == "report_locked" and data["telemetry_enabled"] is True
    card = _read(_VIEWS / "trial_offer.js")
    assert "can't be turned off until the trial ends" in card
