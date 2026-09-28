# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Atlas sidebar panel, RUN as the custom element it is.

docs/PHASE2_STRATEGIC_REVIEW.md gap 4.2 (as corrected): tests/js/render_smoke.mjs
calls every view's render(ctx), but lights_panel.js is not a view — it is a
stateful customElement with a lifecycle (constructor → hass setter → _boot →
connectedCallback → _render → _poll), and nothing ever instantiated it. A
ReferenceError anywhere on that path — an import that lost a name in a
refactor is all it takes — shipped as a blank sidebar panel with a green
suite. tests/js/lights_panel_lifecycle.mjs boots the real module against a
fake hass across tiers and presentation modes, clicks every row and button,
and drives every entity through the panel's own toggle path.

Skipped (not failed) when node is unavailable.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "lights_panel_lifecycle.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def result() -> dict:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True,
                         encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def test_the_panel_boots_renders_and_polls_in_every_scenario(result) -> None:
    assert not result["failures"], json.dumps(result["failures"][:6], indent=2)


def test_the_harness_actually_drew_the_house(result) -> None:
    assert len(result["scenarios"]) >= 6, result["scenarios"]
    for s in result["scenarios"]:
        assert s["svg"], f"{s['name']}: no isometric map was drawn"
        assert s["rows"] >= 19, f"{s['name']}: the index lost rows ({s['rows']})"
        assert s["svcCalls"] > 0, f"{s['name']}: no toggle ever reached hass.callService — the harness is not exercising the action path"


def test_a_motion_sensor_back_from_a_blip_redraws_quiet(result) -> None:
    """Live 2026-09-27: a sensor back "off" from a 29 s offline blip pulsed,
    then wore the 6-hour ring. The sidebar subscribes to
    padspan_ha/motion_reconnects itself, and the push redraws it quiet."""
    b = result["blip"]
    assert b["subscribed"] == {"type": "padspan_ha/motion_reconnects"}, b
    assert b["pulseBefore"], f"the harness must first show the false pulse: {b}"
    assert not b["pulseAfter"] and not b["ringAfter"], b


def test_the_subscription_survives_an_ha_restart(result) -> None:
    """The wall kiosk: HA restarts, the frontend reconnects on the SAME
    Connection before PadSpan has registered padspan_ha/motion_reconnects, and
    the library's own re-subscribe is refused (unknown_command) and dropped.
    The panel must subscribe again once PadSpan is up, exactly once, and let
    go of it (and its "ready" listener) on disconnect."""
    r = result["restart"]
    assert r["liveBefore"] == 1, r
    assert r["liveWhileLoading"] == 0, f"the harness must refuse while PadSpan loads: {r}"
    assert r["liveAfter"] == 1, f"not subscribed (or subscribed twice) after the restart: {r}"
    assert r["delivered"], f"a push after the restart never reached the panel: {r}"
    assert r["liveAfterDisconnect"] == 0 and r["readyListenersAfterDisconnect"] == 0, r


def test_both_panels_subscribe_through_keep_subscribed() -> None:
    """panel.js (Mapping) has the same subscription and is too heavy to boot
    here; it must use the same restart-proof helper the test above runs, never
    a bare subscribeMessage (whose library re-subscribe is lost to an early
    unknown_command)."""
    for name in ("panel.js", "lights_panel.js"):
        src = (_WWW / name).read_text(encoding="utf-8")
        assert "keepSubscribed(hass.connection," in src and "padspan_ha/motion_reconnects" in src, name
        assert "subscribeMessage(" not in src, f"{name} subscribes without keepSubscribed"


def test_the_emergency_test_button(result) -> None:
    """Garry, 2026-09-28: a "Test emergency lighting" button at the map's
    bottom-right, out of the way — shown only when the backend finds lights,
    placed right after the stage (a zero-height anchor: nothing moves), with
    Force off beside it only while a test runs."""
    e = result["emergency"]
    assert e["hiddenWithout"], e
    assert e["afterStage"], e
    assert e["idleForce"] == 0 and e["activeForce"] == 1 and e["endedForce"] == 0, e
    assert e["activeLabel"] == "Test on — tap to end", e
    assert e["sent"] == ["test:true", "member:light.a:true", "force_off"], e


def test_the_emergency_ring_opens_the_card_of_every_light(result) -> None:
    """Garry, 2026-09-28: "a breakout button as a ring around the emergency
    button where a card appears of all the emergency lights, and individual
    controls". The ring is its own button; the card lists every member with
    its "was on" tag, switches one through padspan_ha/emergency_member, and
    survives the poll's re-render."""
    e = result["emergency"]
    assert e["cardOpen"] and e["cardNames"] and e["cardTag"] and e["cardStillOpen"], e
