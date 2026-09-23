# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Locate as a Follow option (2026-09-23), driven through the real
views/follow.js + views/locate.js under node. Pins what the two review
rounds that day reproduced. Skipped, not failed, without node."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_PRELUDE = """
import { pathToFileURL } from 'node:url';
const H = await import(pathToFileURL(%(harness)s).href);
const FOLLOW = await import(new URL("follow.js?b=1", pathToFileURL(%(views)s + "/")).href);
const NodeProto = Object.getPrototypeOf(document.body);
Object.defineProperty(NodeProto, "isConnected", { get() { let n = this; while (n.parentNode) n = n.parentNode; return n === document || n._isShadowRoot === true; }, configurable: true });
NodeProto.getRootNode = function () { let n = this; while (n.parentNode) n = n.parentNode; return n; };
const el = H.el;
const all = (n, acc = []) => { for (const c of n.children || []) { acc.push(c); all(c, acc); } return acc; };
function mkCtx(tier, objects) {
  const helpers = new Proxy({ el, esc: (s) => String(s ?? ""), helpBtn: () => el("button", {}, "?"),
    radioShortId: (s) => s, isScanner: (o) => o.kind === "scanner", radioName: (s) => s },
    { get: (t, k) => (k in t ? t[k] : () => "") });
  const actions = new Proxy({ wsCall: async () => ({ entries: [] }), renderRooms: () => {}, followedHas: () => false },
    { get: (t, k) => (k in t ? t[k] : () => {}) });
  return { hass: { states: {} }, helpers, actions, state: {
    model: { floors: [{ id: "main", name: "Main", level: 0 }], areas: [], room_adjacency: {} },
    settings: { tier, locate_self_key: "me" },
    live: { snapshot: { ble: { radios: [], advertisements: [] }, objects: { list: objects } } },
    dataMode: "live", followAddr: "AA:TAG", _followLocateOn: true, followAlertConfig: {} } };
}
const obj = (key, address, room, x) => ({ key, address, room, x_m: x, y_m: 0, floor_id: "main", identified: true, user_label: key });
const mount = (ctx) => { const shadow = el("div"); shadow._isShadowRoot = true; shadow.activeElement = null;
  shadow.appendChild(FOLLOW.render(ctx)); return shadow; };
const out = {};
"""


def _run(script: str) -> dict:
    www = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
    src = _PRELUDE % {"harness": json.dumps(str(_ROOT / "tests" / "js" / "traceback_harness.mjs")),
                      "views": json.dumps(str(www))} + script + "\nconsole.log(JSON.stringify(out));\n"
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=90, cwd=str(_ROOT))
    assert res.returncode == 0, f"node failed:\n{res.stderr[-3000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_the_per_poll_refresh_never_throws_below_pro():
    """The Pro-gate card had no _refresh: every poll logged a TypeError for
    Free and Bright users with Locate on."""
    out = _run("""
for (const tier of ["free", "bright"]) {
  const ctx = mkCtx(tier, [obj("tag", "AA:TAG", "Bed", 1), obj("me", "AA:ME", "Kitchen", 5)]);
  mount(ctx);
  let err = null;
  try { ctx.state._followLocateRefresh(); } catch (e) { err = String(e); }
  out[tier] = err;
}
""")
    assert out == {"free": None, "bright": None}


def test_the_closer_cue_survives_a_rebuild_on_the_same_snapshot():
    """The refresh consumed each snapshot first; the next full rebuild on the
    same snapshot compared a distance with itself and dropped the cue."""
    out = _run("""
const tag = obj("tag", "AA:TAG", "Kitchen", 1);
const ctx = mkCtx("pro", [tag, obj("me", "AA:ME", "Kitchen", 9)]);
const text = (root) => (all(root).find(n => /^[0-9]+[.][0-9] m/.test(n.textContent || "") && !(n.children || []).length) || {}).textContent || "";
mount(ctx);
ctx.state.live = { snapshot: { ble: { radios: [], advertisements: [] }, objects: { list: [tag, obj("me", "AA:ME", "Kitchen", 5)] } } };
ctx.state._followLocateRefresh();
const again = mount(ctx);                  // full rebuild, same snapshot
out.cue = text(again);
""")
    assert out["cue"].endswith("getting closer")
