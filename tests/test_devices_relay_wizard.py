"""Devices -> Door Openers' "build an opener or lock from relays" wizard.

Garry, 2026-09-22 (verbatim): "a windows opener may need to import a relay
and set it up with logic to open and close a window. We also have cases
where we need to import a relay for a door lock... In the filter, and at the
bottom of the list we need to have an option to create door or windows
opener or lock from relay/relays. And from there have a card to build a
lock/opener from a relay, with accompanying logic for that."

The three builders generalize Garry's own three hand-built relay patterns
(momentary garage-door pulse, two-direction motorized window with interlock
and failsafes, and a momentary electric-strike lock). These tests exercise
the real module under node and assert the generated script/automation/
template-flow payloads have the shapes _runBuildPlan actually sends to HA —
the interlock, the failsafe margins, the state templates — not a
reimplementation of them.

Skipped (not failed) when node is unavailable, so the suite still runs on a
box without it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run_js(tmp_path: Path, script: str) -> dict:
    # devices.js has no imports of its own — copy verbatim, no specifier rewriting needed.
    shutil.copy(_VIEWS / "devices.js", tmp_path / "devices.mjs")
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                          text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── relaySlug ─────────────────────────────────────────────────────────────

def test_relay_slug_sanitizes_and_prefixes(tmp_path):
    out = _run_js(tmp_path, """
import { relaySlug } from "./devices.mjs";
console.log(JSON.stringify({
  plain: relaySlug("Back Door Strike"),
  punctuation: relaySlug("Bedroom2's Window (East)!!"),
  empty: relaySlug(""),
  numeric: relaySlug("42"),
}));
""")
    assert out["plain"] == "padspanha_back_door_strike"
    assert out["punctuation"] == "padspanha_bedroom2_s_window_east"
    assert out["empty"] == "padspanha_relay"
    assert out["numeric"] == "padspanha_42"


# ── Kind 1: momentary opener ─────────────────────────────────────────────

def test_momentary_opener_mirrors_garage_door_scripts(tmp_path):
    # Shape check against Garry's own live scripts.garage_door_car: turn_on,
    # delay, turn_off, single mode, no automations, no helper, no template
    # entity — the script itself is the opener.
    out = _run_js(tmp_path, """
import { buildMomentaryOpener } from "./devices.mjs";
const b = buildMomentaryOpener({ slug: "padspanha_test", name: "Test Door", relayEid: "switch.prodino1_relay_3", pulseSeconds: 1 });
console.log(JSON.stringify(b));
""")
    assert out["automations"] == []
    assert out["helper"] is None
    assert out["templateFlow"] is None
    assert out["openerEntityId"] == "script.padspanha_test_trigger"
    scripts = out["scripts"]
    assert len(scripts) == 1
    cfg = scripts[0]["config"]
    assert cfg["mode"] == "single"
    seq = cfg["sequence"]
    assert seq[0] == {"action": "switch.turn_on", "target": {"entity_id": "switch.prodino1_relay_3"}}
    assert seq[1] == {"delay": {"seconds": 1}}
    assert seq[2] == {"action": "switch.turn_off", "target": {"entity_id": "switch.prodino1_relay_3"}}


def test_momentary_opener_respects_relay_domain(tmp_path):
    # A light.* relay (like the Bedroom1 window board) must call light.turn_on/off,
    # not switch.* — the service domain always tracks the relay's own domain.
    out = _run_js(tmp_path, """
import { buildMomentaryOpener } from "./devices.mjs";
const b = buildMomentaryOpener({ slug: "padspanha_test", name: "Test", relayEid: "light.some_relay", pulseSeconds: 2 });
console.log(JSON.stringify(b.scripts[0].config.sequence));
""")
    assert out[0]["action"] == "light.turn_on"
    assert out[2]["action"] == "light.turn_off"


# ── Kind 2: two-direction opener ─────────────────────────────────────────

def test_two_direction_opener_interlock_and_failsafes(tmp_path):
    out = _run_js(tmp_path, """
import { buildTwoDirectionOpener } from "./devices.mjs";
const b = buildTwoDirectionOpener({
  slug: "padspanha_win2", name: "Bedroom2 Window",
  openRelayEid: "light.win2_open", closeRelayEid: "light.win2_close",
  travelSeconds: 180, deviceClass: "window", sensorEid: null, invert: false,
});
console.log(JSON.stringify(b));
""")
    ids = [s["id"] for s in out["scripts"]]
    assert ids == ["padspanha_win2_open", "padspanha_win2_close", "padspanha_win2_stop"]

    open_seq = out["scripts"][0]["config"]["sequence"]
    assert out["scripts"][0]["config"]["mode"] == "restart"
    # Interlock: cancels the CLOSE script first, before touching any relay.
    assert open_seq[0] == {"action": "script.turn_off", "target": {"entity_id": "script.padspanha_win2_close"}, "continue_on_error": True}
    assert open_seq[1] == {"action": "light.turn_off", "target": {"entity_id": "light.win2_close"}}
    assert open_seq[2] == {"action": "light.turn_on", "target": {"entity_id": "light.win2_open"}}
    # No sensor -> helper state-set action present, delay = travel, then relay off.
    assert {"action": "input_boolean.turn_on", "target": {"entity_id": "input_boolean.padspanha_win2_is_open"}} in open_seq
    assert {"delay": {"seconds": 180}} in open_seq
    assert open_seq[-1] == {"action": "light.turn_off", "target": {"entity_id": "light.win2_open"}}

    close_seq = out["scripts"][1]["config"]["sequence"]
    assert close_seq[0] == {"action": "script.turn_off", "target": {"entity_id": "script.padspanha_win2_open"}, "continue_on_error": True}
    assert {"action": "input_boolean.turn_off", "target": {"entity_id": "input_boolean.padspanha_win2_is_open"}} in close_seq

    stop_seq = out["scripts"][2]["config"]["sequence"]
    assert stop_seq[0]["action"] == "script.turn_off"
    assert set(stop_seq[0]["target"]["entity_id"]) == {"script.padspanha_win2_open", "script.padspanha_win2_close"}

    autos = {a["id"]: a["config"] for a in out["automations"]}
    assert set(autos) == {"padspanha_win2_relays_off_on_start", "padspanha_win2_relay_failsafe", "padspanha_win2_both_relays_on"}

    boot = autos["padspanha_win2_relays_off_on_start"]
    assert boot["triggers"] == [{"platform": "homeassistant", "event": "start"}]
    assert len(boot["actions"]) == 2

    failsafe = autos["padspanha_win2_relay_failsafe"]
    trig = failsafe["triggers"][0]
    assert trig["to"] == "on"
    assert set(trig["entity_id"]) == {"light.win2_open", "light.win2_close"}
    # 180s travel -> proportional margin floored at 10s: 180 + max(10, round(180/4)) = 225.
    assert trig["for"] == {"seconds": 225}

    both_on = autos["padspanha_win2_both_relays_on"]
    assert "win2_open" in both_on["triggers"][0]["value_template"]
    assert "win2_close" in both_on["triggers"][0]["value_template"]
    assert both_on["triggers"][0]["for"] == {"seconds": 3}

    assert out["helper"] == {"id": "padspanha_win2_is_open", "name": "Bedroom2 Window position memory"}
    tf = out["templateFlow"]
    assert tf["step"] == "cover"
    assert tf["fields"]["state"] == "{{ 'open' if is_state('input_boolean.padspanha_win2_is_open','on') else 'closed' }}"
    assert tf["fields"]["open_cover"] == [{"action": "script.padspanha_win2_open"}]
    assert tf["fields"]["close_cover"] == [{"action": "script.padspanha_win2_close"}]
    assert tf["fields"]["stop_cover"] == [{"action": "script.padspanha_win2_stop"}]
    assert tf["fields"]["device_class"] == "window"
    assert out["openerEntityId"] is None


def test_two_direction_opener_short_travel_floors_failsafe_margin(tmp_path):
    out = _run_js(tmp_path, """
import { buildTwoDirectionOpener } from "./devices.mjs";
const b = buildTwoDirectionOpener({
  slug: "padspanha_short", name: "Short", openRelayEid: "switch.a", closeRelayEid: "switch.b",
  travelSeconds: 8, deviceClass: "blind", sensorEid: null, invert: false,
});
console.log(JSON.stringify(b.automations.find(a => a.id.endsWith("relay_failsafe")).config.triggers[0].for));
""")
    # 8 + max(10, round(8/4)=2) = 18, not 8+2=10 — the floor must win over the proportional value.
    assert out == {"seconds": 18}


def test_two_direction_opener_with_binary_sensor_uses_it_not_a_helper(tmp_path):
    out = _run_js(tmp_path, """
import { buildTwoDirectionOpener } from "./devices.mjs";
const b = buildTwoDirectionOpener({
  slug: "padspanha_s", name: "S", openRelayEid: "switch.a", closeRelayEid: "switch.b",
  travelSeconds: 30, deviceClass: "garage", sensorEid: "binary_sensor.door_contact", invert: false,
});
console.log(JSON.stringify({ helper: b.helper, state: b.templateFlow.fields.state,
  hasHelperAction: JSON.stringify(b.scripts).includes("input_boolean") }));
""")
    assert out["helper"] is None
    assert out["state"] == "{{ 'open' if is_state('binary_sensor.door_contact','on') else 'closed' }}"
    assert out["hasHelperAction"] is False


def test_two_direction_opener_sensor_invert_flips_the_template(tmp_path):
    out = _run_js(tmp_path, """
import { buildTwoDirectionOpener } from "./devices.mjs";
const b = buildTwoDirectionOpener({
  slug: "padspanha_s", name: "S", openRelayEid: "switch.a", closeRelayEid: "switch.b",
  travelSeconds: 30, deviceClass: "garage", sensorEid: "binary_sensor.door_contact", invert: true,
});
console.log(JSON.stringify(b.templateFlow.fields.state));
""")
    assert out == "{{ 'closed' if is_state('binary_sensor.door_contact','on') else 'open' }}"


def test_two_direction_opener_with_cover_sensor_passes_through_state(tmp_path):
    out = _run_js(tmp_path, """
import { buildTwoDirectionOpener } from "./devices.mjs";
const b = buildTwoDirectionOpener({
  slug: "padspanha_s", name: "S", openRelayEid: "switch.a", closeRelayEid: "switch.b",
  travelSeconds: 30, deviceClass: "garage", sensorEid: "cover.existing", invert: false,
});
console.log(JSON.stringify(b.templateFlow.fields.state));
""")
    assert out == "{{ states('cover.existing') }}"


# ── Kind 3: momentary-strike lock ────────────────────────────────────────

def test_momentary_lock_unlock_script_and_auto_relock(tmp_path):
    out = _run_js(tmp_path, """
import { buildMomentaryLock } from "./devices.mjs";
const b = buildMomentaryLock({ slug: "padspanha_front", name: "Front Door", relayEid: "switch.strike_relay", pulseSeconds: 3, relockSeconds: 5 });
console.log(JSON.stringify(b));
""")
    assert len(out["scripts"]) == 1
    seq = out["scripts"][0]["config"]["sequence"]
    assert seq[0] == {"action": "input_boolean.turn_off", "target": {"entity_id": "input_boolean.padspanha_front_locked"}}
    assert seq[1] == {"action": "switch.turn_on", "target": {"entity_id": "switch.strike_relay"}}
    assert seq[2] == {"delay": {"seconds": 3}}
    assert seq[3] == {"action": "switch.turn_off", "target": {"entity_id": "switch.strike_relay"}}

    assert len(out["automations"]) == 1
    auto = out["automations"][0]["config"]
    trig = auto["triggers"][0]
    assert trig == {"platform": "state", "entity_id": "input_boolean.padspanha_front_locked", "to": "off", "for": {"seconds": 5}}
    assert auto["actions"] == [{"action": "input_boolean.turn_on", "target": {"entity_id": "input_boolean.padspanha_front_locked"}}]

    assert out["helper"] == {"id": "padspanha_front_locked", "name": "Front Door state memory"}
    tf = out["templateFlow"]
    assert tf["step"] == "lock"
    assert tf["fields"]["state"] == "{{ 'locked' if is_state('input_boolean.padspanha_front_locked','on') else 'unlocked' }}"
    assert tf["fields"]["lock"] == [{"action": "input_boolean.turn_on", "target": {"entity_id": "input_boolean.padspanha_front_locked"}}]
    assert tf["fields"]["unlock"] == [{"action": "script.padspanha_front_unlock"}]
    assert out["openerEntityId"] is None
