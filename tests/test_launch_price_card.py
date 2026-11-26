# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Overview card about lifetime: "Pro for life ends Dec 15".

PadSpan Pro for life is $89 CAD until November 30, 2026, then $168 until
December 15, then no longer sold (views/editions.js; the owner, 2026-11-24).
One card says so, with where to buy, and nothing more: to an administrator,
once per install (lifetime_card_done, saved the moment it first shows; its own
flag, so an install that saw the November 30 card sees this once too), "No
thanks" final, and only while lifetime is sold.

What it shows, to whom and when is run in tests/js/whats_new_card.mjs (the
panel's card) and tests/js/pro_pitch.mjs (editions.js lifetimeCardDue). Held
here: the backend keeps the flag like the trial milestone's, the card goes by
the dates the rest of the code uses, and it is first in the Overview's
one-card-at-a-time line.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from custom_components.padspan_ha import settings_store as ss
from custom_components.padspan_ha import websocket as ws
from custom_components.padspan_ha import ws_settings

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _method(src: str, name: str) -> str:
    i = src.index(f"\n  {name}(){{")
    return src[i:src.index("\n  }\n", i)]


@pytest.mark.parametrize("flag", ["lifetime_card_done", "launch_card_done"])
def test_the_flag_is_kept_settable_and_survives_a_restore(flag: str) -> None:
    """lifetime_card_done is the card's; launch_card_done (the November 30
    card's) stays readable so an older backup still restores cleanly."""
    assert ss.DEFAULT_SETTINGS[flag] is False
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert flag in keys, "settings_set would refuse it"
    src = _js(_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py")
    assert f'payload["{flag}"] = bool(msg.get("{flag}"))' in src
    # Written as the panel is used, like the other "shown once" flags, even with Enhanced security on.
    assert flag in ws_settings._EVERYONE_KEYS
    # An older backup or a reset never brings it back.
    assert ss.trial_state_kept({flag: True}, {flag: False})[flag] is True


def test_one_launch_date_everywhere() -> None:
    """The card goes by the dates the licence card, the trial card and the site
    already use (PRO_LIFETIME_LAUNCH_UNTIL, PRO_PASS_FROM), never a third one."""
    ed = _js(_WWW / "views" / "editions.js")
    # December 1 is also the free basics' moment (FREE_BASICS_FROM, tests/test_free_basics_dec1.py), never a third.
    assert ed.count("2026-12-01") == 2 and 'PRO_LIFETIME_LAUNCH_UNTIL = "2026-12-01T08:00:00Z"' in ed
    assert 'FREE_BASICS_FROM = "2026-12-01T08:00:00Z"' in ed
    assert ed.count("2026-12-16") == 1 and 'PRO_PASS_FROM = "2026-12-16T08:00:00Z"' in ed
    due = ed[ed.index("export function lifetimeCardDue"):]
    due = due[:due.index("\n}\n")]
    assert "proLifetimeOpen(now)" in due and not re.search(r"20\d\d-|Date\.parse|new Date", due)
    card = _method(_js(_WWW / "panel.js"), "_launchPriceCard")
    assert "EDITIONS.lifetimeCardDue(st)" in card and "EDITIONS.proLifetimeOpen()" in card and "EDITIONS.lifetimeCardText()" in card
    assert not re.search(r"20\d\d|Date\.parse|new Date|November|December|\$\d", card.replace("EDITIONS.LIFETIME_CARD_TITLE", "")), \
        "a date or a price written into the card itself"
    # The site's buy box switches on the same moment (tests/test_site_claims.py pins the prices).
    if not (_ROOT / "site" / "index.html").is_file():
        pytest.skip("no site/ in this tree (the Bright derivation carries none)")
    site = _js(_ROOT / "site" / "index.html")
    assert 'data-launch-until="2026-12-01T08:00:00Z"' in site


def test_first_in_the_overview_line_and_nothing_counted() -> None:
    pj = _js(_WWW / "panel.js")
    assert "const _ms = this._launchPriceCard() || this._proInviteOverviewCard() || this._testerOverviewCard(_hasPositioned)" in pj
    card = _method(pj, "_launchPriceCard")
    assert "_telemetryEvent" not in card, "the card sends nothing to the usage report"
    for gate in ("this.state.kioskMode", 'this.state.dataMode !== "live"', "this._hass.user.is_admin", "this._overviewCardShown"):
        assert gate in card, gate
