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
    top-right, out of the way — shown only when the backend finds lights,
    placed right before the stage (a zero-height anchor: nothing moves), with
    Force off beside it only while a test runs."""
    e = result["emergency"]
    assert e["hiddenWithout"], e
    assert e["beforeStage"], e      # top-right of the map: the anchor sits right before the stage
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
    # A light has a "⋯", a switch does not: a blank of the same width keeps
    # the columns straight (design pass 2026-09-28).
    assert e["cardRows"] == 2 and e["cardAligned"], e


def test_a_tap_while_switching_is_answered_and_force_off_queued(result) -> None:
    """Review 2026-09-28: a tap while an action runs was dropped silently
    (Force off included). The button shows it is busy, a tap is told "Still
    switching…", and Force off runs right after — once however often tapped."""
    e = result["emerg2"]
    assert e["busyShown"] and e["stillToast"], e
    assert e["queuedRan"], e


def test_force_off_asks_twice_after_a_real_emergency(result) -> None:
    e = result["emerg2"]
    assert e["armSent"] == 0 and e["armToast"] and e["armedLabel"] == "Tap again", e
    assert e["confirmSent"] == "force_off", e
    assert e["rearmSent"] == 0, f"a tap after the 3 s window must ask again: {e}"


def test_a_stale_status_never_overwrites_an_action(result) -> None:
    assert result["emerg2"]["staleIgnored"], result["emerg2"]


def test_the_card_is_not_rebuilt_under_a_finger_or_for_nothing(result) -> None:
    e = result["emerg2"]
    assert e["cardKept"] and e["cardHeld"] and e["cardRefilled"], e


def test_emergency_polling_slows_without_lights(result) -> None:
    e = result["emerg2"]
    assert e["pollIdle"] == 0 and e["pollIdleLate"] == 1 and e["pollLive"] == 1, e


def test_the_hidden_button_hides_only_while_idle(result) -> None:
    """Review 2026-09-28: Settings' "Show the Test emergency lighting button"
    off hid a RUNNING test too, and stopped asking the backend altogether, so
    a test started from the wall kiosk never showed here. Hidden now means
    idle only: no button and a 5-minute poll (never the 10 s one), the button
    back the moment a test runs, and back when switched on again."""
    e = result["emerg3"]
    assert e["hiddenAnchor"] == 0, e
    assert e["hiddenPollFast"] == 0 and e["hiddenPollSlow"] == 1, f"hidden must poll slowly, not never: {e}"
    assert e["activeWhileHidden"] == 1 and e["activePollFast"] == 1, e
    assert e["backWhenReEnabled"] == 1, e


def test_a_failed_settings_fetch_keeps_the_hidden_button_hidden(result) -> None:
    assert result["emerg3"]["keptOnFailedFetch"] is True, result["emerg3"]


def test_the_emergency_toast_shows_above_the_card() -> None:
    src = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    toast = src.split("_toast(msg, isError=false, durationMs=null){", 1)[1].split("\n  }\n", 1)[0]
    assert "z-index:10001" in toast and "z-index:10000" in src.split("_openEmergencyCard(){", 1)[1]


def test_the_emergency_ring_and_narrow_row_css() -> None:
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    assert ".lv-emerg-dial{position:relative;width:72px;height:72px" in css
    assert ".lv-emerg-btn{all:unset;box-sizing:border-box;position:absolute;inset:16px" in css
    assert "container-type:inline-size" in css.split(".lv-emerg-anchor{", 1)[1].split("}", 1)[0]
    narrow = css.split("@container (max-width:440px){", 1)[1].split("\n}", 1)[0]
    assert ".lv-emerg-label-tx{display:none}" in narrow
    # Review 2026-09-28: no scale on a phone — it shrank the ring band, the
    # centre and Force off back below the touch sizes set above.
    assert "scale(" not in narrow and "transform" not in narrow, narrow


def test_the_emergency_button_sits_above_the_rail_drawers() -> None:
    """An open rail drawer (z 4) covered the button (z 3). The button is
    above it now, and a drawer keeps its controls out from under the dial."""
    css = (_WWW / "styles.css").read_text(encoding="utf-8")
    emerg = css.split(".lv-emerg{position:absolute;", 1)[1].split("}", 1)[0]
    drawer = css.split(".lv-drawer{position:absolute;", 1)[1].split("}", 1)[0]
    z = lambda block: int(block.split("z-index:", 1)[1].split(";", 1)[0])
    assert z(emerg) > z(drawer), (emerg, drawer)
    assert ".lv-mapcard:has(.lv-emerg) .lv-drawer{padding-right:96px}" in css
    # ...and a running test's label and Force off stack into that strip.
    assert ".lv-mapcard:has(.lv-drawer.open) .lv-emerg{flex-direction:column;align-items:flex-end}" in css


def test_emergency_toasts_stay_long_enough_to_read() -> None:
    """The "a real emergency ran during the test" message is four lines; it
    was on screen 3.5 s like a one-word toast, and a second toast landed on
    top of the first."""
    src = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    toast = src.split("_toast(msg, isError=false, durationMs=null){", 1)[1].split("\n  }\n", 1)[0]
    assert "String(msg).length * 60" in toast and "Math.min(10000" in toast
    # Re-review: the armed Force-off message is tied to its 3 s window, so it
    # passes that as its own duration instead of outlasting the window.
    assert "durationMs ||" in toast
    assert "Tap again to turn off every emergency light`, true, 3000);" in src


def test_a_new_toast_replaces_the_last(result) -> None:
    assert result["emerg3"]["toastsOnScreen"] == 1, result["emerg3"]
