"""DOM-level smoke tests for the "build an opener or lock from relays" wizard.

test_devices_relay_wizard.py checks the pure builder payloads in isolation;
this file exercises the actual UI wiring in devices.js — the tier gate, the
form, and _runBuildPlan/_teardownComposite's real call sequence against a
mocked hass — the part a pure-function test can't see (Garry has been burned
before by a card whose logic was right but whose wiring to the real ctx
surface was wrong).

Skipped (not failed) when node is unavailable.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SHIM = Path(__file__).parent / "js" / "dom_shim.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, body: str) -> dict:
    shutil.copy(_VIEWS / "devices.js", tmp_path / "devices.mjs")
    shutil.copy(_SHIM, tmp_path / "dom_shim.mjs")
    harness = f"""
import {{ install }} from './dom_shim.mjs';
install(globalThis);
const D = await import('./devices.mjs');

function el(tag, attrs = {{}}, children = []) {{
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {{}})) {{
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }}
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {{
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }}
  return n;
}}
const flush = () => new Promise(r => globalThis._realSetTimeout(r, 0));

{body}
"""
    (tmp_path / "run.mjs").write_text(harness, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                          text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_free_tier_shows_gate_not_wizard(tmp_path):
    out = _run(tmp_path, """
const state = { settings: { tier: "free" }, _devicesTab: "openers" };
const ctx = { helpers: { el }, state, hass: { states: {} }, actions: { renderRooms: () => {} }, toast: () => {} };
const root = D.render(ctx);
console.log(JSON.stringify({
  html: root.innerHTML || "",
  hasBuildBtn: [...root.querySelectorAll("button")].some(b => b.textContent.includes("Build an opener")),
}));
""")
    assert out["hasBuildBtn"] is False


def test_momentary_opener_build_calls_script_config_and_reload_then_saves_settings(tmp_path):
    out = _run(tmp_path, """
const calls = [];
const state = {
  settings: { tier: "pro", door_opener_ids: [], door_composites: [] },
  _devicesTab: "openers",
};
const hass = {
  states: { "switch.prodino1_relay_3": { state: "off", attributes: { friendly_name: "Relay 3" } } },
  callApi: async (method, path, body) => { calls.push([method, path, body]); return { result: "ok" }; },
  callWS: async (msg) => { calls.push(["WS", msg]); return {}; },
};
let saved = null;
const ctx = {
  helpers: { el }, state, hass,
  actions: {
    renderRooms: () => {},
    settingsSet: async (patch) => { saved = patch; Object.assign(state.settings, patch); },
    callWS: async (msg) => { calls.push(["actions.callWS", msg]); return {}; },
  },
  toast: () => {},
};
let root = D.render(ctx);
const openBtn = [...root.querySelectorAll("button")].find(b => b.textContent.includes("Build an opener"));
openBtn.click();
root = D.render(ctx);

const nameInput = [...root.querySelectorAll("input")].find(i => i.type === "text");
nameInput.value = "Test Relay Door";
const relaySelect = [...root.querySelectorAll("select")][1]; // [0] = kind, [1] = relay
relaySelect.value = "switch.prodino1_relay_3";

const buildBtn = [...root.querySelectorAll("button")].find(b => b.textContent === "Build");
buildBtn.click();
await flush();

console.log(JSON.stringify({
  calls,
  saved,
  composites: state.settings.door_composites,
  openerIds: state.settings.door_opener_ids,
}));
""")
    calls = out["calls"]
    kinds = [c[0] for c in calls]
    assert kinds == ["POST", "POST"]
    assert calls[0][1] == "config/script/config/padspanha_test_relay_door_trigger"
    assert calls[0][2]["sequence"][0] == {"action": "switch.turn_on", "target": {"entity_id": "switch.prodino1_relay_3"}}
    assert calls[1][1] == "services/script/reload"

    assert out["openerIds"] == ["script.padspanha_test_relay_door_trigger"]
    assert len(out["composites"]) == 1
    c = out["composites"][0]
    assert c["kind"] == "momentary_opener"
    assert c["entity_id"] == "script.padspanha_test_relay_door_trigger"
    assert c["relays"] == ["switch.prodino1_relay_3"]
    assert c["generated"]["scripts"] == ["padspanha_test_relay_door_trigger"]
    assert c["generated"]["helper_id"] is None
    assert c["generated"]["template_entry_id"] is None


def test_momentary_lock_build_creates_helper_then_template_flow_not_marked_as_opener(tmp_path):
    out = _run(tmp_path, """
const calls = [];
const state = {
  settings: { tier: "bright", door_opener_ids: [], door_composites: [] },
  _devicesTab: "openers", _relayWizardOpen: true, _relayWizardKind: "momentary_lock",
};
const hass = {
  states: { "switch.strike_relay": { state: "off", attributes: { friendly_name: "Strike Relay" } } },
  callApi: async (method, path, body) => {
    calls.push([method, path, body]);
    if (path === "config/config_entries/flow") return { flow_id: "f1", type: "menu" };
    if (path === "config/config_entries/flow/f1" && body && body.next_step_id === "lock") return { flow_id: "f1", type: "form" };
    if (path === "config/config_entries/flow/f1" && body && body.name) {
      return { type: "create_entry", result: { entry_id: "e1" } };
    }
    return { result: "ok" };
  },
  callWS: async (msg) => {
    calls.push(["hass.callWS", msg]);
    if (msg.type === "config/entity_registry/list") {
      return [{ entity_id: "lock.padspanha_front_door_locked", config_entry_id: "e1" }];
    }
    return {};
  },
};
let saved = null;
const ctx = {
  helpers: { el }, state, hass,
  actions: {
    renderRooms: () => {},
    settingsSet: async (patch) => { saved = patch; Object.assign(state.settings, patch); },
    callWS: async (msg) => {
      calls.push(["actions.callWS", msg]);
      if (msg.type === "input_boolean/create") return { id: "padspanha_front_door_locked", name: msg.name };
      return {};
    },
  },
  toast: () => {},
};
let root = D.render(ctx);
const nameInput = [...root.querySelectorAll("input")].find(i => i.type === "text");
nameInput.value = "Front Door";
const relaySelect = [...root.querySelectorAll("select")][1];
relaySelect.value = "switch.strike_relay";
const buildBtn = [...root.querySelectorAll("button")].find(b => b.textContent === "Build");
buildBtn.click();
await flush();
await flush();

console.log(JSON.stringify({ calls, saved, composites: state.settings.door_composites, openerIds: state.settings.door_opener_ids }));
""")
    calls = out["calls"]
    # helper first, before any script/automation/flow call.
    assert calls[0][0] == "actions.callWS"
    assert calls[0][1]["type"] == "input_boolean/create"
    kinds = [c[0] for c in calls]
    assert "config/config_entries/flow" in [c[1] for c in calls if c[0] == "POST"]
    assert out["openerIds"] == []  # a lock is never added to door_opener_ids
    assert len(out["composites"]) == 1
    c = out["composites"][0]
    assert c["kind"] == "momentary_lock"
    assert c["entity_id"] == "lock.padspanha_front_door_locked"
    assert c["generated"]["helper_id"] == "padspanha_front_door_locked"
    assert c["generated"]["template_entry_id"] == "e1"
    assert c["generated"]["scripts"] == ["padspanha_front_door_unlock"]
    assert c["generated"]["automations"] == ["padspanha_front_door_auto_relock"]


def test_remove_composite_deletes_every_generated_piece_and_only_those(tmp_path):
    out = _run(tmp_path, """
const calls = [];
const composite = {
  id: "padspanha_old", kind: "two_direction_opener", name: "Old Window",
  entity_id: "cover.padspanha_old_window", relays: ["switch.a", "switch.b"],
  generated: {
    scripts: ["padspanha_old_open", "padspanha_old_close", "padspanha_old_stop"],
    automations: ["padspanha_old_relays_off_on_start", "padspanha_old_relay_failsafe", "padspanha_old_both_relays_on"],
    helper_id: "padspanha_old_is_open", template_entry_id: "entry123",
  },
};
const state = {
  settings: { tier: "pro", door_opener_ids: ["cover.padspanha_old_window", "switch.unrelated"], door_composites: [composite] },
  _devicesTab: "openers",
};
const hass = {
  states: { "cover.padspanha_old_window": { state: "closed", attributes: {} } },
  callApi: async (method, path) => { calls.push([method, path]); return { result: "ok" }; },
  callWS: async () => ({}),
};
let saved = null;
const ctx = {
  helpers: { el }, state, hass,
  actions: {
    renderRooms: () => {},
    settingsSet: async (patch) => { saved = patch; Object.assign(state.settings, patch); },
    callWS: async (msg) => { calls.push(["actions.callWS", msg]); return {}; },
  },
  toast: () => {},
};
let root = D.render(ctx);
const removeBtn = [...root.querySelectorAll("button")].find(b => b.textContent === "Remove");
removeBtn.click();
await flush();

console.log(JSON.stringify({ calls, composites: state.settings.door_composites, openerIds: state.settings.door_opener_ids }));
""")
    calls = out["calls"]
    deleted_paths = [c[1] for c in calls if c[0] == "DELETE"]
    assert "config/config_entries/entry/entry123" in deleted_paths
    for aid in ("padspanha_old_relays_off_on_start", "padspanha_old_relay_failsafe", "padspanha_old_both_relays_on"):
        assert f"config/automation/config/{aid}" in deleted_paths
    for sid in ("padspanha_old_open", "padspanha_old_close", "padspanha_old_stop"):
        assert f"config/script/config/{sid}" in deleted_paths
    helper_delete = [c for c in calls if c[0] == "actions.callWS" and c[1].get("type") == "input_boolean/delete"]
    assert helper_delete and helper_delete[0][1]["input_boolean_id"] == "padspanha_old_is_open"

    assert out["composites"] == []
    # The unrelated opener id must survive; only this composite's own entity_id is stripped.
    assert out["openerIds"] == ["switch.unrelated"]
