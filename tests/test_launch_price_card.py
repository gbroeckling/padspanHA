# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The launch price's Overview card: "The launch price ends November 30".

PadSpan Pro for life is $89 CAD until November 30, 2026, then $168
(views/editions.js). One card says so, with where to buy, and nothing more: to
an administrator, once per install (launch_card_done, saved the moment it
first shows), "No thanks" final, and only until the launch price ends.

What it shows, to whom and when is run in tests/js/whats_new_card.mjs (the
panel's card) and tests/js/pro_pitch.mjs (editions.js launchCardDue). Held
here: the backend keeps the flag like the trial milestone's, the card goes by
the one launch date the rest of the code uses, and it is first in the
Overview's one-card-at-a-time line.
"""

from __future__ import annotations

import re
from pathlib import Path

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


def test_the_flag_is_kept_settable_and_survives_a_restore() -> None:
    assert ss.DEFAULT_SETTINGS["launch_card_done"] is False
    keys = {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    assert "launch_card_done" in keys, "settings_set would refuse it"
    src = _js(_ROOT / "custom_components" / "padspan_ha" / "ws_settings.py")
    assert 'payload["launch_card_done"] = bool(msg.get("launch_card_done"))' in src
    # Written as the panel is used, like the other "shown once" flags, even with Enhanced security on.
    assert "launch_card_done" in ws_settings._EVERYONE_KEYS
    # An older backup or a reset never brings it back.
    assert ss.trial_state_kept({"launch_card_done": True}, {"launch_card_done": False})["launch_card_done"] is True


def test_one_launch_date_everywhere() -> None:
    """The card goes by the date the licence card, the trial card and the site
    already use (PRO_LIFETIME_LAUNCH_UNTIL), never a second one."""
    ed = _js(_WWW / "views" / "editions.js")
    assert ed.count("2026-12-01") == 1 and 'PRO_LIFETIME_LAUNCH_UNTIL = "2026-12-01T08:00:00Z"' in ed
    due = ed[ed.index("export function launchCardDue"):]
    due = due[:due.index("\n}\n")]
    assert "proLifetimeLaunch(now)" in due and not re.search(r"20\d\d-|Date\.parse|new Date", due)
    card = _method(_js(_WWW / "panel.js"), "_launchPriceCard")
    assert "EDITIONS.launchCardDue(st)" in card and "EDITIONS.proLifetimeLaunch()" in card
    assert not re.search(r"20\d\d|Date\.parse|new Date|November|\$\d", card.replace("EDITIONS.LAUNCH_CARD_TITLE", "")
                         .replace('"PadSpan Pro for life is " + EDITIONS.proLifetimeWords() + "."', "")), \
        "a date or a price written into the card itself"
    # The site's buy box switches on the same moment (tests/test_site_claims.py pins the prices).
    site = _js(_ROOT / "site" / "index.html")
    assert 'data-launch-until="2026-12-01T08:00:00Z"' in site


def test_first_in_the_overview_line_and_nothing_counted() -> None:
    pj = _js(_WWW / "panel.js")
    assert "const _ms = this._launchPriceCard() || this._proInviteOverviewCard() || this._testerOverviewCard(_hasPositioned)" in pj
    card = _method(pj, "_launchPriceCard")
    assert "_telemetryEvent" not in card, "the card sends nothing to the usage report"
    for gate in ("this.state.kioskMode", 'this.state.dataMode !== "live"', "this._hass.user.is_admin", "this._overviewCardShown"):
        assert gate in card, gate
