"""Direct unit tests for the Tune save-plan helpers (pure, no DOM)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = Path.home() / ".nvm" / "versions" / "node" / "v24.14.1" / "bin" / "node"
if not _NODE.exists():
    _NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(not _NODE, reason="node is not installed")

_DRIVER = r"""
import { tuneSavePlanInit, tuneDiffMapDraft, tuneMissingFabricPins,
  tuneConflictingSources, tuneReconcileDraft, tunePlacementReadable,
  tuneSyncTuneDrafts, tuneSnapBaseline,
  tuneTryAcquire, tuneRelease } from 'PLAN';
import { mapFracToMetres, metresToMapFrac } from 'STACK';
tuneSavePlanInit({ mapFracToMetres, metresToMapFrac });
const tf = (o) => Object.assign({ origin_x_m: 0, origin_y_m: 0,
  scale_x_m: 20, scale_y_m: 15, rotation_rad: 0, shear_rad: 0,
  floor_id: 'main' }, o);
const out = {};
// readability gates (backend contract: positive scales, >=1mm reach)
out.empty = tunePlacementReadable({});
out.noScales = tunePlacementReadable({ origin_x_m: 0, origin_y_m: 0 });
out.zero = tunePlacementReadable(tf({ scale_x_m: 0 }));
out.negscale = tunePlacementReadable(tf({ scale_x_m: -20 }));
out.negscaleY = tunePlacementReadable(tf({ scale_y_m: -15 }));
out.singular = tunePlacementReadable(tf({ shear_rad: Math.PI / 2 }));
out.good = tunePlacementReadable(tf({ rotation_rad: 0.3, shear_rad: 0.05 }));
// diff needs baseline difference or missing pin — never fabric disagreement
const fab = { 's1': { x_m: 4.0, y_m: 3.0, z_m: 1.2, floor_id: 'main' } };
const map = { id: 'm', floor_id: 'main' };
const T = { m: tf() };
const staleRows = [
  { id: 'a', x: 0.9, y: 0.9, room: 'R', source: 's1' },  // stale vs fabric
  { id: 'c', x: 0.5, y: 0.5, source: 's2' },              // missing pin
];
const staleBase = { s1: { x: 0.9, y: 0.9 }, s2: { x: 0.5, y: 0.5 } };
out.staleUntouched = tuneDiffMapDraft(map, staleRows, fab, T, staleBase, true);
const movedRows = [
  { id: 'a', x: 0.21, y: 0.2, room: 'R', source: 's1' },
  { id: 'c', x: 0.5, y: 0.5, source: 's2' },
];
out.moved = tuneDiffMapDraft(map, movedRows, fab, T, staleBase, false);
out.movedMissing = tuneDiffMapDraft(map, movedRows, fab, T, staleBase, true);
out.invalid = tuneDiffMapDraft(map,
  [{ id: 'a', x: 'not-a-number', y: 0.2, source: 's9' }],
  fab, T, { s9: { x: 0.1, y: 0.2 } }, false);
out.sourceless = tuneDiffMapDraft(map,
  [{ id: 'x', x: 0.5, y: 0.5 }], fab, T, {}, true);
// missing helper returns EVERY occurrence incl. floors
out.missingAll = tuneMissingFabricPins(
  [{ id: 'm1', floor_id: 'main' }, { id: 'm2', floor_id: 'up' }],
  { m1: [{ source: 'dup', x: 0.1, y: 0.1 }],
    m2: [{ source: 'dup', x: 0.9, y: 0.9 }] },
  {}, { m1: tf(), m2: tf() });
// conflicts incl. floors
out.conflict = tuneConflictingSources([
  { source: 's1', x_m: 1, y_m: 1, floor_id: 'main' },
  { source: 's1', x_m: 5, y_m: 1, floor_id: 'main' },
]);
out.floorConflict = tuneConflictingSources([
  { source: 's1', x_m: 1, y_m: 1, floor_id: 'main' },
  { source: 's1', x_m: 1, y_m: 1, floor_id: 'up' },
]);
out.noConflict = tuneConflictingSources([
  { source: 's1', x_m: 1, y_m: 1, floor_id: 'main' },
  { source: 's1', x_m: 1.0001, y_m: 1, floor_id: 'main' },
]);
// reconcile keeps FULL precision + metadata, filters footprint/floor
const fabR = {
  's1': { x_m: 4.0, y_m: 3.0, z_m: 1.2, floor_id: 'main' },
  'far': { x_m: 400.0, y_m: 300.0, floor_id: 'main' },
  'otherfloor': { x_m: 4.0, y_m: 3.0, floor_id: 'up' },
};
out.recon = tuneReconcileDraft(map,
  [{ id: 'keep-me', label: 'Kitchen', x: 0, y: 0, room: 'K', source: 's1' },
   { id: 'stale', label: 'Old', x: 0.1, y: 0.1, room: '', source: 'gone' }],
  fabR, T, false);
out.reconDirty = tuneReconcileDraft(map, [{ id: 'x', source: 's1' }], fabR, T, true);
// sync routine: fresh seed + reconcile + baselines; model-late reconcile;
// dirty maps never touched (coords AND baselines preserved)
{
  const ts = {};
  const maps = [{ id: 'm', floor_id: 'main', updated: 't0',
    receivers: [{ id: 'r1', label: 'RX', x: 0, y: 0, room: 'R', source: 's1' }] }];
  const fabS = { 's1': { x_m: 4.0, y_m: 3.0, z_m: 1.2, floor_id: 'main' } };
  const model = { scanner_positions_m: fabS, map_transforms: T };
  tuneSyncTuneDrafts(ts, maps, model.scanner_positions_m,
    model.map_transforms);
  const snap = (o) => JSON.parse(JSON.stringify(o));
  out.syncSeed = { draft: snap(ts.draftReceivers),
    base: snap(ts.editBaseline), dirty: snap(ts.dirtyMaps) };
  // model arriving/changing later reconciles clean maps AND baselines
  const fabS2 = { 's1': { x_m: 6.0, y_m: 3.0, z_m: 1.2, floor_id: 'main' } };
  tuneSyncTuneDrafts(ts, maps, fabS2, T);
  out.syncModelChange = { draft: snap(ts.draftReceivers.m[0]),
    base: snap(ts.editBaseline.m.s1) };
  // dirty maps: neither coords nor baselines move, flags untouched
  ts.dirtyMaps = { m: true };
  maps[0].receivers = [{ id: 'r1', label: 'RX', x: 0.99, y: 0.99, room: 'R', source: 's1' }];
  maps[0].updated = 't1';
  tuneSyncTuneDrafts(ts, maps, fabS2, T);
  out.syncDirtyKept = { draft: snap(ts.draftReceivers.m),
    base: snap(ts.editBaseline.m) };
}
// mutex primitives (the guarded Height/Remove/Save callbacks in the
// view own the lock; lifecycle tests cover the sequences end to end)
{
  const ts = {};
  out.acquire = tuneTryAcquire(ts);
  out.reacquire = tuneTryAcquire(ts);
  tuneRelease(ts);
  out.afterRelease = tuneTryAcquire(ts);
  tuneRelease(ts);
  out.releaseEmpty = (tuneRelease({}), true)[1];
}
// baseline snapshots carry exact fractions, first-wins per source
out.snap = tuneSnapBaseline([
  { id: 'a', x: 0.1, y: 0.2, source: 's1' },
  { id: 'b', x: 0.3, y: 0.4, source: 's1' },
  { id: 'c', x: 0.5, y: 0.5 },
]);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def plan() -> dict:
    script = _DRIVER.replace(
        "from 'PLAN'", f"from '{(_VIEWS / 'tune_save_plan.js').as_uri()}'")
    script = script.replace(
        "from 'STACK'", f"from '{(_VIEWS / 'stack_transform.js').as_uri()}'")
    res = subprocess.run([str(_NODE), "--input-type=module", "-e", script],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"plan driver failed:\n{res.stderr[-3000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_readability_gates_match_backend(plan: dict) -> None:
    assert plan["empty"] is False
    assert plan["noScales"] is False
    assert plan["zero"] is False
    assert plan["negscale"] is False
    assert plan["negscaleY"] is False
    assert plan["singular"] is False
    assert plan["good"] is True


def test_stale_baseline_match_never_posts(plan: dict) -> None:
    """Finding 1: a row equal to its baseline posts nothing even when its
    metres disagree with the fabric — disagreement is not an edit. The
    fabric-missing s2 row still joins via includeMissing."""
    d = plan["staleUntouched"]
    assert [w["source"] for w in d["writes"]] == ["s2"], d
    assert d["invalid"] == [] and d["refused"] is False


def test_moved_and_missing_post_with_height_ridealong(plan: dict) -> None:
    d = plan["movedMissing"]
    by_src = {w["source"]: w for w in d["writes"]}
    assert set(by_src) == {"s1", "s2"}, d
    assert by_src["s1"].get("z_m") == 1.2, "existing height must ride along"
    assert "z_m" not in by_src["s2"], "new entries must omit z"
    assert plan["moved"]["writes"] == [by_src["s1"]], \
        "without includeMissing only the edited row posts"


def test_invalid_and_sourceless(plan: dict) -> None:
    assert plan["invalid"]["invalid"] == ["s9"]
    assert plan["invalid"]["writes"] == []
    assert plan["sourceless"]["skipped"] == [""]
    assert plan["sourceless"]["writes"] == []


def test_missing_returns_all_occurrences(plan: dict) -> None:
    assert plan["missingAll"] == [
        {"mapId": "m1", "source": "dup"},
        {"mapId": "m2", "source": "dup"}], plan["missingAll"]


def test_conflicts(plan: dict) -> None:
    assert plan["conflict"] == ["s1"]
    assert plan["floorConflict"] == ["s1"], "floor-only moves must conflict"
    assert plan["noConflict"] == []


def test_reconcile_full_precision_and_metadata(plan: dict) -> None:
    by_src = {r["source"]: r for r in plan["recon"]}
    assert by_src["s1"]["id"] == "keep-me"
    assert by_src["s1"]["label"] == "Kitchen" and by_src["s1"]["room"] == "K"
    # Full inverse precision: exactly 0.2, not a 4dp rounding (finding 1).
    assert by_src["s1"]["x"] == 0.2 and by_src["s1"]["y"] == 0.2, by_src["s1"]
    assert "far" not in by_src and "otherfloor" not in by_src
    assert by_src["gone"]["id"] == "stale"


def test_reconcile_dirty_passthrough(plan: dict) -> None:
    assert plan["reconDirty"] is None


def test_sync_seeds_baselines_and_reconciles(plan: dict) -> None:
    s = plan["syncSeed"]
    assert s["dirty"] == {}
    r1 = next(r for r in s["draft"]["m"] if r["source"] == "s1")
    assert (r1["x"], r1["y"]) == pytest.approx((0.2, 0.2)), r1
    assert s["base"]["m"]["s1"] == {"x": r1["x"], "y": r1["y"]}, \
        "baseline must follow reconciled coords"


def test_sync_model_change_reconciles_clean(plan: dict) -> None:
    r1 = plan["syncModelChange"]["draft"]
    assert (r1["x"], r1["y"]) == pytest.approx((0.3, 0.2)), r1
    assert plan["syncModelChange"]["base"] == {"x": r1["x"], "y": r1["y"]}


def test_sync_dirty_never_touched(plan: dict) -> None:
    k = plan["syncDirtyKept"]
    assert k["draft"][0]["x"] == pytest.approx(0.3), k["draft"]
    assert k["base"]["s1"] == {"x": 0.3, "y": 0.2}, \
        "dirty map baselines must not move either"


def test_mutex_primitives(plan: dict) -> None:
    assert plan["acquire"] is True and plan["reacquire"] is False
    assert plan["afterRelease"] is True


def test_snap_baseline(plan: dict) -> None:
    assert plan["snap"] == {"s1": {"x": 0.1, "y": 0.2}}, plan["snap"]
