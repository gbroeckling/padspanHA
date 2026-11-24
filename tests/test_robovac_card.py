# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The robovac card (views/robovac_card.js), RUN (tests/js/robovac_card.mjs), and how it is opened.

2026-11-24, the owner: "Build that into the robovac card. Again press and hold
on a map to surface [it]": a hold on the robot, on the flat Atlas and in the
3D house, opens the card; a tap still shows its small card. The card loads
only then.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SCRIPT = Path(__file__).parent / "js" / "robovac_card.mjs"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def run():
    if _NODE is None:
        pytest.skip("node is not installed")
    r = subprocess.run([_NODE, str(_SCRIPT), str(_WWW)], capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


@pytest.mark.parametrize("case", ["setup", "ready", "running", "undo", "auth", "not-admin", "german"])
def test_robovac_card(run, case):
    assert run["cases"].get(case) is True, json.dumps([f for f in run["failures"] if f["name"] == case], indent=1)[:4000]


def _src(name: str) -> str:
    return (_WWW / "views" / name).read_text(encoding="utf-8").replace("\r\n", "\n")


def test_a_hold_on_the_robot_in_3d_opens_its_card():
    use = _src("live_aboard_use.js")
    assert 'if (t.key === "vacuum") holdable = true;' in use
    act = use[use.index("function act(p, r){"):use.index("function arm(p, t){")]
    hold = act.index('if (tgt.key === "vacuum" && r === "open") {')
    assert hold < act.index('if (tgt.kind === "tag" || tgt.kind === "scanner" || tgt.kind === "person") { showCard(tgt); return; }')
    assert "import(`./robovac_card.js${new URL(import.meta.url).search}`)" in act
    # live_aboard.js itself is not touched for it: the target it picks already carries the key "vacuum".
    assert "robovac" not in _src("live_aboard.js")


def test_a_hold_on_the_robot_on_the_flat_atlas_opens_its_card():
    ab = _src("atlas_aboard.js")
    make = ab[ab.index("  function make(w){"):ab.index("  function paint(){")]
    assert 'if (w.key === "vacuum") {' in make and "stamp(e) - t0 < HOLD_MS" in make
    # The click that ends a hold is not also a tap (registered before the tap's own listener).
    assert make.index("e.stopImmediatePropagation()") < make.index('n.addEventListener("click", tap);')
    assert "d.useApi()" in make and "import(`./robovac_card.js${new URL(import.meta.url).search}`)" in make
    lm = _src("lights_map.js")
    assert 'useApi: typeof host.house3d.useApi === "function" ? host.house3d.useApi : null,' in lm


def test_the_card_loads_only_on_a_hold():
    for name in ("live_aboard_use.js", "atlas_aboard.js"):
        src = _src(name)
        assert "await import(`./robovac_card.js" not in src and "import(`./robovac_card.js" in src
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert "robovac_card" not in panel


def test_the_card_calls_only_the_backend_never_the_robot():
    src = _src("robovac_card.js")
    assert "fetch(" not in src and "XMLHttpRequest" not in src and "/api/v2" not in src
    calls = set(__import__("re").findall(r'call\("([a-z_]+)"', src))
    assert calls == {"vacuum_robot_status", "vacuum_robot_control", "vacuum_robot_set", "vacuum_link_set",
                     "vacuum_run_start", "vacuum_run_stop", "vacuum_run_undo"}
