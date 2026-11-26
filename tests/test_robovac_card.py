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


@pytest.mark.parametrize("case", ["setup", "ready", "running", "undo", "auth", "choice", "wall", "not-admin", "findings", "wifi-moving", "german"])
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
                     "vacuum_run_start", "vacuum_run_stop", "vacuum_run_undo",
                     "vacuum_robot_use_set", "vacuum_robot_use_apply"}           # the owner's choice (2026-11-24)


def test_the_robot_is_drawn_whenever_its_link_is_on():
    """The owner, 2026-11-24: the hold must always be possible. With Robot Vacuum Import on, the flat Atlas and
    the 3D house read the snapshot for the robot alone; people and tags keep their own switches."""
    lm = _src("lights_map.js")
    # Where this install has the Robot vacuum add-on (hostVacuum: everyone's until it is on sale; test_free_basics_dec1).
    assert '|| (abSet.vacuum_import_enabled === true && hostVacuum(host))));' in lm
    assert 'robot: h3.settings.vacuum_import_enabled === true && hostVacuum(host) && h3.people ? abReader(h3.people) : null,' in lm
    # People and tags keep exactly their old gate (Pro), the robot's own read or not (review, 2026-11-24).
    assert "people: abPro && abSet.atlas_3d_people === true, tags: abPro && abSet.atlas_3d_tags === true," in lm
    assert 'const abPro = tierAtLeast(host.tier, "pro");' in lm
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "vacuum_import_enabled: s.vacuum_import_enabled," in lp
    la = _src("live_aboard.js")
    assert la.count("on(p.tags) ? p.tags : on(p.robot) ? p.robot : null;") == 2


def test_the_findings_card_reads_one_command_and_links_to_the_placement():
    src = _src("robovac_findings.js")
    assert '"padspan_ha/vacuum_findings"' in src and "fetch(" not in src and "/api/v2" not in src
    assert "/padspan-ha?view=maps&tab=edit&receiver=${encodeURIComponent(" in src
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    assert 'if (reqView === "maps" && reqRx && reqRx.length <= 200) this.state.maps._openRadios = { source: reqRx };' in panel
    maps = _src("maps.js")
    assert "if (placedOn) ctx.state.activeMapId = placedOn.id;" in maps
    assert "(ctx.state.maps._draftReceivers.find(r=>r.source===_src||r.id===_src) || {}).id" in maps
    card = _src("robovac_card.js")
    assert "import(`./robovac_findings.js${new URL(import.meta.url).search}`)" in card


def test_a_wall_gets_the_robots_state_only():
    """?kiosk=1: nothing on it may navigate away (the other cards get the same flag)."""
    lp = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    assert "kiosk:this._kiosk()," in lp
    assert "kiosk: !!ctx.state.kioskMode," in _src("maps.js")
    card = _src("robovac_card.js")
    assert "const wall = !!(api && api.kiosk);" in card and card.count("if (wall)") >= 2
    assert "if (!(api && api.kiosk)) {" in _src("robovac_findings.js")


def test_a_hold_that_moves_on_is_no_hold():
    ab = _src("atlas_aboard.js")
    assert "const HOLD_SLOP_PX = 10;" in ab and "> HOLD_SLOP_PX) t0 = null;" in ab


def test_the_card_stops_reading_once_it_is_gone_or_hidden():
    card = _src("robovac_card.js")
    assert "if (overlay.isConnected === false) { closeRobovacCard(); return; }" in card
    assert "document.hidden" in card
