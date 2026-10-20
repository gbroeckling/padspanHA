# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Hide HA (0.38.153, the Atlas's 0.38.155): buttons beside the panel's Toggle
and the sidebar Atlas's Refresh hide Home Assistant's own sidebar through the
frontend's "hass-dock-sidebar" event (the switch behind Profile > "Always hide
the sidebar", kept per browser) and show it again as it was, docked or auto.
One module, ha_sidebar.js, does it for both."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry

_WWW = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

# Hides from `start`, then shows again, the way Home Assistant answers: each
# event's dock becomes the next hass.dockedSidebar.
_DRIVE = r"""
const store = {};
globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
import(process.argv[1]).then(m => {
  const out = [];
  for (const start of [undefined, "docked", "auto"]) {
    let hass = start ? { dockedSidebar: start } : {};
    const sent = [];
    const el = { dispatchEvent: e => { sent.push([e.type, e.detail.dock, e.bubbles, e.composed]); hass = { dockedSidebar: e.detail.dock }; } };
    const steps = [m.haLabel(hass)];
    steps.push(m.toggleHaSidebar(el, hass), m.haLabel(hass), m.haHidden(hass));
    steps.push(m.toggleHaSidebar(el, hass), m.haLabel(hass));
    out.push({ start: start || null, steps, sent });
  }
  console.log(JSON.stringify(out));
});
"""


def _drive():
    if _NODE is None:
        pytest.skip("node is not installed")
    url = (_WWW / "ha_sidebar.js").resolve().as_uri()
    res = subprocess.run([_NODE, "-e", _DRIVE, url], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_hide_then_show_puts_back_what_was_there():
    for run in _drive():
        back = run["start"] if run["start"] == "auto" else "docked"
        assert run["steps"] == ["Hide HA", "ha_sidebar:hidden", "Show HA", True, "ha_sidebar:shown", "Hide HA"], run
        assert run["sent"] == [["hass-dock-sidebar", "always_hidden", True, True],
                               ["hass-dock-sidebar", back, True, True]], run


def _panel() -> str:
    return (_WWW / "panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")


def test_the_panels_button_sits_beside_toggle_and_stays_on_the_rail():
    src = _panel()
    toolbar = src[src.index('<button class="btn inline" id="refresh">'):]
    toolbar = toolbar[:toolbar.index("</div>")]
    assert toolbar.index('id="toggleSide"') < toolbar.index('id="haSide"'), "next to Toggle"
    rail = (_WWW / "styles-2025.css").read_text(encoding="utf-8")
    assert ".app.mini #haSide::after{content:" in rail, "the collapsed rail keeps it: with HA's sidebar gone it is the way back"
    for css in ("styles.css", "styles-2025.css"):
        assert "@media (max-width:870px){#haSide{display:none}}" in (_WWW / css).read_text(encoding="utf-8"), (
            f"{css}: not offered where HA's sidebar is a drawer anyway")
    assert "import(`./ha_sidebar.js?b=${BUILD_ID}`)" in src
    assert "this._telemetryEvent(HA_SIDEBAR.toggleHaSidebar(this, this._hass));" in src
    setter = src[src.index("  set hass(hass){"):]
    assert "prevHass.dockedSidebar !== hass.dockedSidebar)) this._paintHaSide();" in setter[:setter.index("\n  }\n")]


def test_the_atlas_has_one_too_beside_refresh():
    src = (_WWW / "lights_panel.js").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert "await import(`./ha_sidebar.js${new URL(import.meta.url).search}`)" in src
    head = src[src.index('el("div",{class:"lv-hero-title"},"Atlas")'):]
    head = head[:head.index("\\u21bb Refresh")]
    assert 'id:"haSide"' in head and "HA_SIDEBAR.toggleHaSidebar(this, this._hass)" in head, "beside Refresh"
    assert "was.dockedSidebar !== hass.dockedSidebar)) this._haBtn.textContent = HA_SIDEBAR.haLabel(hass);" in src


def test_its_use_is_counted_in_the_closed_vocabulary():
    assert {"ha_sidebar:hidden", "ha_sidebar:shown"} <= telemetry.SCREEN_EVENTS
