# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Hide HA (0.38.153): a button beside Toggle hides Home Assistant's own
sidebar through the frontend's "hass-dock-sidebar" event (the switch behind
Profile > "Always hide the sidebar", kept per browser) and shows it again as
it was, docked or auto."""

from __future__ import annotations

from pathlib import Path

from custom_components.padspan_ha import telemetry

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _panel() -> str:
    return (_WWW / "panel.js").read_text(encoding="utf-8")


def _method(src: str, head: str) -> str:
    body = src[src.index(head):]
    return body[:body.index("\n  }\n")]


def test_the_button_sits_beside_toggle_and_stays_on_the_rail():
    src = _panel()
    toolbar = src[src.index('<button class="btn inline" id="refresh">'):]
    toolbar = toolbar[:toolbar.index("</div>")]
    assert toolbar.index('id="toggleSide"') < toolbar.index('id="haSide"'), "next to Toggle"
    rail = (_WWW / "styles-2025.css").read_text(encoding="utf-8")
    assert ".app.mini #haSide::after{content:" in rail, "the collapsed rail keeps it: with HA's sidebar gone it is the way back"
    for css in ("styles.css", "styles-2025.css"):
        assert "@media (max-width:870px){#haSide{display:none}}" in (_WWW / css).read_text(encoding="utf-8"), (
            f"{css}: not offered where HA's sidebar is a drawer anyway")


def test_hiding_and_showing_use_home_assistants_own_switch():
    body = _method(_panel().replace("\r\n", "\n"), "  _toggleHaSidebar(){")
    assert 'new CustomEvent("hass-dock-sidebar", { detail: { dock }, bubbles: true, composed: true })' in body
    assert 'let dock = "always_hidden";' in body
    # shown again as it was: docked or auto, never anything else
    assert 'localStorage.getItem("padspan_ha_dock_before")' in body and 'if (dock !== "auto") dock = "docked";' in body
    assert 'localStorage.setItem("padspan_ha_dock_before", this._haDock())' in body


def test_the_label_follows_home_assistant():
    src = _panel().replace("\r\n", "\n")
    setter = _method(src, "  set hass(hass){")
    assert "prevHass.dockedSidebar !== hass.dockedSidebar)) this._paintHaSide();" in setter
    paint = _method(src, "  _paintHaSide(){")
    assert '"Show HA" : "Hide HA"' in paint and "aria-pressed" in paint


def test_its_use_is_counted_in_the_closed_vocabulary():
    assert {"ha_sidebar:hidden", "ha_sidebar:shown"} <= telemetry.SCREEN_EVENTS
    body = _method(_panel().replace("\r\n", "\n"), "  _toggleHaSidebar(){")
    assert 'this._telemetryEvent(hidden ? "ha_sidebar:shown" : "ha_sidebar:hidden")' in body
