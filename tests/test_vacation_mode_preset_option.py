# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Vacation Mode's "permanent option" in the Whole House Presets picker
(Garry, 2026-09-21: "In whole house presets, add a permanent option,
vacation"). Unlike a saved preset, it can never be deleted, and Apply
enables the ongoing pattern (host.onVacationModeEnable) instead of a
scene.apply — pinned at the DOM level, the same buildLightsMapCard harness
test_atlas_layout_v2.py and test_lights_build_controls_labels.py already
use.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const LM = await import(pathToFileURL({json.dumps(str(_VIEWS / 'lights_map.js'))}).href);\n"
        "const out={};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


_EL_JS = """
function el(tag, attrs, children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  for (const c of (Array.isArray(children) ? children : [children])) {
    if (c === null || c === undefined) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
"""

_MODEL = {
    "floors": [{"id": "main", "name": "Main", "level": 0}],
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [4, 0], [4, 4], [0, 4]]},
    },
}


def _base_host(extra: str) -> str:
    return (
        _EL_JS +
        f"const MODEL={json.dumps(_MODEL)};\n"
        "const host = {\n"
        "  el, floors: MODEL.floors, model: MODEL, tier: 'pro', byRoom: {}, lightsByEid: {}, lightsLoading: false,\n"
        "  hiddenEids: new Set(),\n"
        "  view: { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 },\n"
        "  saveView: async () => {}, callWS: async () => ({}), toast: () => {},\n"
        "  onHexesBuilt: () => {}, onRowClick: () => {}, onToggleHidden: () => {}, afterAssign: () => {},\n"
        "  onWholeHouseApply: async () => ({ applied: 0, skipped: 0 }),\n"
        + extra +
        "};\n"
        "const card = LM.buildLightsMapCard(host);\n"
    )


def _whole_house_select(card_expr: str = "card") -> str:
    return f"[...{card_expr}.querySelectorAll('select')].find(s => [...s.querySelectorAll('option')].some(o => o.textContent.includes('Vacation Mode')))"


def test_vacation_mode_appears_first_when_the_host_offers_it(tmp_path):
    out = _run(_base_host(
        "  onVacationModeEnable: async () => true,\n"
    ) + (
        f"const sel = {_whole_house_select()};\n"
        "out.found = !!sel;\n"
        "const opts = sel ? [...sel.querySelectorAll('option')] : [];\n"
        "out.firstOptionText = opts[0] ? opts[0].textContent : null;\n"
        "out.firstOptionValue = opts[0] ? opts[0].getAttribute('value') : null;\n"
    ))
    assert out["found"] is True
    assert out["firstOptionText"] == "🌴 Vacation Mode"
    assert out["firstOptionValue"] == "__vacation__"


def test_vacation_mode_is_absent_when_the_host_does_not_offer_it():
    """A host without onVacationModeEnable (none exist today, but the
    option must never render unconditionally) gets no such entry."""
    out = _run(_base_host("") + (
        f"const sel = {_whole_house_select()};\n"
        "out.found = !!sel;\n"
    ))
    assert out["found"] is False


def test_applying_vacation_mode_needs_a_second_click_then_calls_the_host(tmp_path):
    out = _run(_base_host(
        "  onVacationModeEnable: async () => { out.calls = (out.calls || 0) + 1; return true; },\n"
    ) + (
        f"const sel = {_whole_house_select()};\n"
        "sel.value = '__vacation__';\n"
        "sel.dispatchEvent({ type: 'change', stopPropagation(){}, preventDefault(){} });\n"
        "const applyBtn = [...card.querySelectorAll('button')].find(b => b.textContent === 'Apply');\n"
        "applyBtn.dispatchEvent({ type: 'click' });\n"
        "out.callsAfterFirstClick = out.calls || 0;\n"
        "out.labelAfterFirstClick = applyBtn.textContent;\n"
        "applyBtn.dispatchEvent({ type: 'click' });\n"
        "out.callsAfterSecondClick = out.calls || 0;\n"
    ))
    assert out["callsAfterFirstClick"] == 0, "the first click must arm the confirm, not apply yet"
    assert out["labelAfterFirstClick"] == "Yes, turn on Vacation Mode"
    assert out["callsAfterSecondClick"] == 1


def test_delete_is_disabled_while_vacation_mode_is_selected(tmp_path):
    out = _run(_base_host(
        "  onVacationModeEnable: async () => true,\n"
        "  wholeHousePresets: [{ name: 'Evening', entities: { 'light.a': { state: 'on' } } }],\n"
        "  onWholeHouseSet: async () => ({ count: 0, skipped: 0 }),\n"
        "  onWholeHouseDelete: async () => {},\n"
    ) + (
        f"const sel = {_whole_house_select()};\n"
        "const delBtn = [...card.querySelectorAll('button')].find(b => b.textContent === 'Delete');\n"
        "sel.value = 'Evening';\n"
        "sel.dispatchEvent({ type: 'change', stopPropagation(){}, preventDefault(){} });\n"
        "out.disabledOnRealPreset = delBtn.disabled;\n"
        "sel.value = '__vacation__';\n"
        "sel.dispatchEvent({ type: 'change', stopPropagation(){}, preventDefault(){} });\n"
        "out.disabledOnVacation = delBtn.disabled;\n"
    ))
    assert out["disabledOnRealPreset"] is False, "Delete must work normally for a real saved preset"
    assert out["disabledOnVacation"] is True, "the permanent option must never be deletable"
