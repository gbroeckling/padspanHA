# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The sidebar's own light-index row long-press (lights_map.js's
buildLightsTable, host.onRowLongPress — opens the WLED/effects popup for a
dimmable/fan/lock row) — 2026-09-17 finding, from the owner's own audit request
("Review if the circle animation is used everywhere... let me know where
things look scattered"): every OTHER hold-to-secondary-action gesture in the
app (a map marker via wireUseSurface, a map marker in the Atlas builder, the
Atlas builder's room-name long-press) shows the shared gold press-ring, sets
touch-action:none and takes pointer capture. This row's own long-press did
none of the three, and hardcoded 500 instead of the shared HOLD_MS/
PRESS_RING_MS constants — the exact same logical action (open the effects
popup) gave a visual warning on the map and none at all in the list.

Fixed by drawing the ring straight into the row's own existing code-swatch
SVG (the small shape icon already in the first cell) rather than adding a
second SVG just for this.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

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

_LIGHT = {
    "entity_id": "light.dimmable_one", "code": "A01", "shape": "circle",
    "friendly_name": "Dimmable One", "state": "on", "dimmable": True,
    "area_name": "Kitchen", "healthy": True,
}


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const {{ install, flush }} = await import(pathToFileURL({json.dumps(str(_ROOT / 'tests' / 'js' / 'dom_shim.mjs'))}).href);\n"
        "install(globalThis);\n"
        f"const LM = await import(pathToFileURL({json.dumps(str(_VIEWS / 'lights_map.js'))}).href);\n"
        + _EL_JS +
        f"const lights = [{json.dumps(_LIGHT)}];\n"
        "const longPressCalls = [];\n"
        "const host = { el, hiddenEids: new Set(), lightsLoading: false, model: {},\n"
        "  onRowClick: () => {}, onRowLongPress: (l) => longPressCalls.push(l.entity_id) };\n"
        "const root = LM.buildLightsTable(host, lights);\n"
        "const row = [...root.querySelectorAll('tr')].find(r => r.getAttribute('data-eid') === 'light.dimmable_one');\n"
        "const out = { longPressCalls };\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_row_sets_touch_action_none():
    out = _run("""
out.touchAction = row.style.touchAction;
""")
    assert out["touchAction"] == "none", (
        "the row must opt out of native touch scroll during its own hold, like every marker hold does", out)


def test_row_takes_and_releases_pointer_capture():
    """dom_shim implements no real setPointerCapture (same gap noted in
    test_maps_room_name_touch_hardening.py), so this pins the calls at the
    source level instead of behaviourally — the exact statements a
    regression would have to remove to reintroduce the missing-capture gap."""
    src = (_VIEWS / "lights_map.js").read_text(encoding="utf-8")
    block = src[src.index("if (host.onRowLongPress) {"):src.index("tbody.appendChild(row);")]
    assert "row.setPointerCapture(ev.pointerId)" in block, block
    assert "row.releasePointerCapture(capturedId)" in block, block


def test_a_genuine_hold_shows_the_shared_press_ring_and_arms_gold():
    """flush() fires the queued PRESS_RING_MS/HOLD_MS timers directly (the
    shim queues rather than fires timers on a real clock) — exactly what a
    real still hold does over that time, no real wait needed."""
    out = _run("""
row.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 0, clientY: 0 });
await flush();
out.ringPresent = !!row.querySelector('circle.lpress');
out.ringArmed = !!row.querySelector('.armed');
""")
    assert out["ringPresent"] is True, "a genuine hold must draw the same gold press-ring every other hold gesture uses"
    assert out["ringArmed"] is True, "once HOLD_MS elapses the ring must gain the armed (gold flash) class, same as the map's own holds"
    assert out["longPressCalls"] == ["light.dimmable_one"], out


def test_releasing_before_the_hold_completes_cancels_the_ring_and_never_fires():
    out = _run("""
row.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 0, clientY: 0 });
row.dispatchEvent({ type: 'pointerup', pointerId: 1, clientX: 0, clientY: 0 });
await flush();
out.ringPresent = !!row.querySelector('circle.lpress');
""")
    assert out["ringPresent"] is False, "releasing early must remove the ring, not leave it stuck"
    assert out["longPressCalls"] == [], "releasing before HOLD_MS must never open the effects popup"


def test_a_pointercancel_also_removes_the_ring():
    out = _run("""
row.dispatchEvent({ type: 'pointerdown', pointerId: 1, clientX: 0, clientY: 0 });
row.dispatchEvent({ type: 'pointercancel', pointerId: 1, clientX: 0, clientY: 0 });
await flush();
out.ringPresent = !!row.querySelector('circle.lpress');
""")
    assert out["ringPresent"] is False, out
    assert out["longPressCalls"] == [], out
