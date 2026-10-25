# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Issue #89, after reload: Beacon Tune filled its pins only from each map's
own beacons list, which nothing has written since saves went to the fabric
(0.38.107). A fresh install showed a saved beacon as "Not placed"; an older
install showed the spot from before the save while Overview drew the saved
one. tuneBeaconFromFabric puts the fabric's pin first and keeps the map's
row only where the fabric has none, without writing anything.
"""
from __future__ import annotations

import functools
import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_CAL = _VIEWS / "calibration.js"
_NODE = shutil.which("node")

_DRIVER = r"""
import { tuneSavePlanInit, tuneBeaconFromFabric, tuneBeaconBaseline, tuneBeaconWrites } from 'PLAN';
import { mapFracToMetres, metresToMapFrac } from 'STACK';
tuneSavePlanInit({ mapFracToMetres, metresToMapFrac });
const tf = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 20, scale_y_m: 10, rotation_rad: 0, shear_rad: 0 };
const tfs = { m1: tf, m2: tf, up: tf };
const maps = [{ id: 'm1', floor_id: 'main' }, { id: 'm2', floor_id: 'main' }, { id: 'up', floor_id: 'up' }];
const seed = (rows) => { const d = { m1: rows.map(r => ({ ...r })), m2: [], up: [] };
  const b = {}; for (const id of Object.keys(d)) b[id] = tuneBeaconBaseline(d[id]); return { d, b }; };
const out = {};
// Fresh install: the map has no row, the fabric has the saved pin.
{ const { d, b } = seed([]);
  tuneBeaconFromFabric(maps, d, b, { 'ble:C0': { x_m: 5, y_m: 2.5, floor_id: 'main', label: 'Keys', kind: 'ble' } }, tfs);
  out.fresh = { d, b, writes: tuneBeaconWrites(maps[0], d.m1, tfs, b.m1, { pinned: { 'ble:C0': {} } }).writes }; }
// Older install: a stale row in the map, the fabric moved on.
{ const { d, b } = seed([{ id: 'bk_old', key: 'ble:C0', label: 'Keys', kind: 'ble', x: 0.9, y: 0.9 }]);
  tuneBeaconFromFabric(maps, d, b, { 'ble:C0': { x_m: 5, y_m: 2.5, floor_id: 'main' } }, tfs);
  out.stale = { d, writes: tuneBeaconWrites(maps[0], d.m1, tfs, b.m1, { pinned: { 'ble:C0': {} } }).writes }; }
// No fabric pin: the map's row stays (fallback), as does one with no placement.
{ const { d, b } = seed([{ id: 'bk_a', key: 'ble:A', x: 0.3, y: 0.4 }, { id: 'bk_b', key: 'ble:B', x: 0.6, y: 0.6 }]);
  tuneBeaconFromFabric(maps, d, b, { 'ble:B': { x_m: 1, y_m: 1, floor_id: 'main' } }, { m1: {} });
  out.fallback = d.m1; }
// A row being dragged (off its baseline) is never moved.
{ const { d, b } = seed([{ id: 'bk_d', key: 'ble:D', x: 0.2, y: 0.2 }]);
  d.m1[0].x = 0.7;
  tuneBeaconFromFabric(maps, d, b, { 'ble:D': { x_m: 10, y_m: 5, floor_id: 'main' } }, tfs);
  out.dragging = d.m1[0]; }
// A pin on another floor: lands on that floor's map, leaves this one; a pin
// outside every map of its floor is not drawn.
{ const { d, b } = seed([{ id: 'bk_f', key: 'ble:F', x: 0.5, y: 0.5 }]);
  tuneBeaconFromFabric(maps, d, b, { 'ble:F': { x_m: 4, y_m: 4, floor_id: 'up' },
    'ble:OUT': { x_m: 90, y_m: 4, floor_id: 'main' } }, tfs);
  out.floors = d; }
// Its own map first.
{ const { d, b } = seed([]);
  tuneBeaconFromFabric(maps, d, b, { 'ble:M': { x_m: 4, y_m: 4, floor_id: 'main', map_id: 'm2' } }, tfs);
  out.ownMap = d; }
console.log(JSON.stringify(out));
"""


@functools.lru_cache(maxsize=1)
def _run() -> dict:
    script = _DRIVER.replace("from 'PLAN'", f"from '{(_VIEWS / 'tune_save_plan.js').as_uri()}'")
    script = script.replace("from 'STACK'", f"from '{(_VIEWS / 'stack_transform.js').as_uri()}'")
    res = subprocess.run([str(_NODE), "--input-type=module", "-e", script],
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
class TestBeaconTuneFromFabric:
    def test_fresh_install_shows_the_saved_pin(self):
        out = _run()["fresh"]
        assert out["d"]["m1"] == [{"id": "bk_ble:C0", "label": "Keys", "key": "ble:C0", "kind": "ble",
                                   "x": 0.25, "y": 0.25}]
        assert out["b"]["m1"] == {"ble:C0": {"x": 0.25, "y": 0.25}}
        assert out["writes"] == []  # shown, never restated

    def test_stale_map_row_gives_way_to_the_fabric(self):
        out = _run()["stale"]
        row = out["d"]["m1"][0]
        assert (row["id"], row["x"], row["y"]) == ("bk_old", 0.25, 0.25)
        assert out["writes"] == []

    def test_map_row_is_the_fallback(self):
        rows = _run()["fallback"]
        assert [(r["key"], r["x"], r["y"]) for r in rows] == [("ble:A", 0.3, 0.4), ("ble:B", 0.6, 0.6)]

    def test_a_row_off_its_baseline_is_left_alone(self):
        assert _run()["dragging"]["x"] == 0.7

    def test_floors_and_bounds(self):
        d = _run()["floors"]
        assert d["m1"] == [] and d["m2"] == []
        assert [(r["key"], r["x"], r["y"]) for r in d["up"]] == [("ble:F", 0.2, 0.4)]

    def test_its_own_map_first(self):
        d = _run()["ownMap"]
        assert d["m1"] == [] and [r["key"] for r in d["m2"]] == ["ble:M"]


def test_beacon_tune_seeds_and_resets_through_the_fabric():
    src = _CAL.read_text(encoding="utf-8")
    sync = src[src.index("function _syncFabricPins()"):]
    sync = sync[:sync.index("\n  }\n")]
    assert "tuneBeaconFromFabric(maps_list, bs.draftBeacons, bs.editBaseline," in sync
    assert "ctx.state.model?.beacon_positions_m" in sync
    # seed, then on every render the fabric changed, and the Reset button
    assert src.count("bs._fabStamp = null;") == 2
    assert src.count("_syncFabricPins();") == 2
