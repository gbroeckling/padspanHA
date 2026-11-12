"""The Plans tool's dead ends, each with the next action (new-user audit
2026-11-10, dead ends A-E): Measure a plan with no scale yet (Mapping → Edit
on that plan, the Measure tool), the rooms helper where its own rule offers
it ("pull", views/ai_wizard_offer.js), Settings → AI; none of them on a wall
screen. Settings → AI says why Build from plans isn't offered, in the
helper's words. The tabs themselves run in tests/js/plan_build_tab.mjs and
plan_build_rooms.mjs (tests/test_plan_build.py, test_plan_build_rooms.py)."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_VIEWS = ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"


def _src(name: str) -> str:
    return (_VIEWS / name).read_text(encoding="utf-8")


def _node() -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    return node


@pytest.fixture(scope="module")
def why() -> dict:
    r = subprocess.run([_node(), str(ROOT / "tests" / "js" / "settings_plan_build_why.mjs"), str(ROOT).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_settings_says_why_build_from_plans_is_hidden(why):
    assert len(why) >= 14, sorted(why)
    bad = {k: v for k, v in why.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_measure_opens_that_plan_on_the_measure_tool():
    """The Measure buttons' target, run: Advanced opens Edit on that plan with Measure (a one-shot when
    another plan's draft is open, the tool at once when it is this one's); Basic, the wizard's scale step."""
    src = _src("maps.js")
    fns = src[src.index("function _openForEdit("):src.index("function _library(")]
    # 2026-11-13 (D1): a plan with no scale opens the one-length screen instead (scale_nudge.offered decides: faked here by `first`).
    js = "const NUDGE = { offered: (ctx, m) => !!(m && m.first) };" + chr(10) + fns + r"""
const mk = (complexity, draft, first = false) => { const calls = [];
  const ctx = { state: { complexity, maps: { list: [{ id: "p1", first }], _draftMapId: draft, _mode: "rooms", _measurePts: [[1, 2]], _measurements: [{ m: 3 }] } },
    actions: { mapsSetActive: (id) => calls.push("active:" + id), setMapsTab: (t) => calls.push("tab:" + t), renderRooms: () => calls.push("render") } };
  return { ctx, calls }; };
const out = {};
for (const [k, cx, dr] of [["other", "advanced", "p9"], ["same", "advanced", "p1"], ["basic", "basic", "p9"]]) {
  const a = mk(cx, dr); _openMeasure(a.ctx, "p1");
  out[k] = { calls: a.calls, open: a.ctx.state.maps._openMode || null, mode: a.ctx.state.maps._mode, wiz: a.ctx.state._mapsWizard || null, pts: a.ctx.state.maps._measurePts.length, meas: a.ctx.state.maps._measurements.length };
}
for (const [k, cx] of [["first", "advanced"], ["first_basic", "basic"]]) {
  const a = mk(cx, "p1", true); _openMeasure(a.ctx, "p1", "plans");
  out[k] = { calls: a.calls, open: a.ctx.state.maps._openMode || null, mode: a.ctx.state.maps._mode, wiz: a.ctx.state._mapsWizard || null, fs: a.ctx.state._firstScale || null };
}
console.log(JSON.stringify(out));
"""
    r = subprocess.run([_node(), "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-1500:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out["other"] == {"calls": ["active:p1", "tab:edit"], "open": "measure", "mode": "rooms", "wiz": None, "pts": 0, "meas": 0}   # another plan's half-made measurement is not carried over
    assert out["same"] == {"calls": ["active:p1", "tab:edit"], "open": None, "mode": "measure", "wiz": None, "pts": 0, "meas": 1}       # this plan's own earlier length is kept
    assert out["basic"]["wiz"] == {"step": 2, "mapId": "p1"} and out["basic"]["open"] is None and "tab:edit" not in out["basic"]["calls"]
    # A first scale: Edit on that plan shows the one-length screen (no Measure tool armed); Basic, the wizard's scale step, with its door.
    assert out["first"] == {"calls": ["active:p1", "tab:edit"], "open": None, "mode": "rooms", "wiz": None, "fs": {"mapId": "p1", "door": "plans"}}
    assert out["first_basic"]["wiz"] == {"step": 2, "mapId": "p1", "door": "plans"} and out["first_basic"]["fs"] is None


def test_the_host_hands_the_next_actions_and_none_on_a_wall_screen():
    maps = _src("maps.js")
    go = maps[maps.index("const plansGo = "):maps.index("// Asked once a page, with the experimental switch on")]
    assert go.startswith("const plansGo = ctx.state.kioskMode ? null : {")
    assert 'measure: (mapId) => _openMeasure(ctx, mapId, "plans")' in go     # its door counted (2026-11-13)
    assert 'AIW.offered(ctx, "plans_tool")' in go and 'AIW.openWizard(ctx, "plans_tool")' in go     # the helper's own rule and door, no second copy
    assert 'FOCUS.openFocus(ctx, FOCUS.part("aiTask"))' in go
    assert 'if (plansGo && AIW && ctx.state.settings?.ai_plans_enabled === true) AIW.infoFor(ctx, "plans_tool");' in maps
    assert "      plansGo,\n" in maps.replace("\r\n", "\n") and "openAtlasRoom, go: plansGo," in maps   # Live Aboard's host and the no-3D list
    lm = _src("lights_map.js")
    assert "go: !h3.plansGo ? null :" in lm and "s.holdLeave(run)" in lm                                 # leaving Edit asks first if unsaved
    plans = _src("live_aboard_plans.js")
    assert 'const luGo = () => { const h = ctx.host(); return (h && h.go) || null; };' in plans


def test_3d_stack_says_the_reference_has_no_scale_and_offers_measure():
    maps = _src("maps.js")
    assert "has no placement yet" not in maps
    assert "The Reference plan has no scale yet: measure it first" in maps
    assert '"data-stack-go":"measure", onclick:()=>_openMeasure(ctx, ref.id, "stack")' in maps


def test_the_wizard_scale_step_says_the_ai_tools_need_it():
    maps = _src("maps.js")
    step = maps[maps.index("function _wizardScale("):maps.index("function _wizardScale(") + 1200]
    # 2026-11-13 (D1): a first scale is one distance (Setup's own words); rooms, receivers and the AI tools need it.
    assert "Measure one distance you know" in step and "the AI tools that read your plans need it." in step


def test_the_two_tabs_speak_plain_words():
    """The audit's worst strings, gone from what a person reads in the two tabs and their stops."""
    plans = _src("live_aboard_plans.js")
    tabs = plans[plans.index("// ── Line up plans (Build from plans, experimental"):plans.index("export async function openPlansList(")]
    lits = [a or b for a, b in re.findall(r'"([^"\n]*)"|`([^`\n]*)`', tabs)]
    shown = " | ".join(f"\"{x}\"" for x in lits if re.search(r"[A-Za-z]+ [a-z]+", x))      # words a person reads, not ids
    for word in ("anchor's", '"the anchor"', "a refile", "A refile", " refile${", '"Refile"', "Held-out", "Pixels a metre", "Fits ", "Mapping → Align", "as a barrier",
                 "no plan is placed", "your measured plan", "would sit elsewhere", "About 5 reads"):
        assert word not in shown, word
    from custom_components.padspan_ha import plan_ai as A
    said = " ".join(" ".join(v) for v in A.STOPS.values())
    for word in ("Mapping → Align", "metre scale", "Refile", "measured plan", "isn't placed"):
        assert word not in said, word
    assert A.STOPS["no_metre_scale"] == ("Your house has no scale yet: no plan has been measured.", "Measure one plan first in Mapping → Edit → Measure.")


def test_the_first_tab_and_the_stop_send_nobody_to_3d_stack() -> None:
    """Add data via plans with nothing measured, and the server's stop for a floor with no measured plan (also used
    for a floor with no plan at all): measure first, in the same words as the other two tabs."""
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    js = (root / "www" / "padspan-ha" / "views" / "live_aboard_plans.js").read_text(encoding="utf-8")
    assert "No floor plan with a scale to read yet" in js and "place it in Mapping → 3D Stack first" not in js
    assert "place it in Mapping → 3D Stack first" not in (root / "ws_plan_ai.py").read_text(encoding="utf-8")
    from custom_components.padspan_ha import plan_ai
    assert plan_ai.STOPS["not_placed"] == ("This floor has no plan with a scale yet.", "Measure one in Mapping → Edit → Measure first.")


def test_a_plan_gone_leaves_no_tool_armed_and_no_measurement_carried() -> None:
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
    js = (root / "maps.js").read_text(encoding="utf-8")
    gone = js[js.index("  if(!map){"):js.index("No map selected. Go to Library")]
    assert "ctx.state.maps._openMode = null;" in gone
    assert 'else { ms._openMode = "measure"; ms._measurePts = []; ms._measurements = []; }' in js
