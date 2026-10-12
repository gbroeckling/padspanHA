# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Issue #89: Beacon Tune's placement never reached the fabric, and Overview
drew a pinned beacon where the solver put it instead of where it was pinned.

Beacon Tune's Save went through the dirty maps with an empty loop and said
"Reference positions saved"; the save after each placement only cleared the
dirty flag. The fix writes through padspan_ha/fabric_beacon_position_set —
only what was placed, dragged or relocated (tuneBeaconWrites), never the
tracked objects Beacon Tune pins at their room's centre for display, which
would have made a phone a fixed beacon. Separately the live snapshot never
carried the pin fields the coordinator sets, so neither Overview nor the
Calibration matrix's anchor rows could see a pin at all.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_PKG = _ROOT / "custom_components" / "padspan_ha"
_VIEWS = _PKG / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")

_DRIVER = r"""
import { tuneSavePlanInit, tuneBeaconWrites, tuneBeaconBaseline } from 'PLAN';
import { mapFracToMetres, metresToMapFrac } from 'STACK';
tuneSavePlanInit({ mapFracToMetres, metresToMapFrac });
const tf = { origin_x_m: 0, origin_y_m: 0, scale_x_m: 20, scale_y_m: 10,
  rotation_rad: 0, shear_rad: 0, floor_id: 'up' };
const map = { id: 'm', floor_id: 'up' };
const rows = [
  { key: 'ibeacon:fixed', label: 'Hall', kind: 'ibeacon', x: 0.5, y: 0.5 },   // untouched
  { key: 'ble:MOVED', label: 'Desk', kind: 'ble', x: 0.25, y: 0.4 },         // dragged
  { key: 'ble:NEW', label: 'Shelf', kind: 'ble', x: 0.1, y: 0.2 },           // placed now
  { key: 'ble:PHONE', label: 'Phone', kind: 'private_ble', x: 0.7, y: 0.7 }, // auto-pinned for display
  { key: '', x: 0.3, y: 0.3 },                                                // no key
];
const base = tuneBeaconBaseline([rows[0], { key: 'ble:MOVED', x: 0.2, y: 0.4 }, rows[3]]);
const out = {};
out.base = base;
out.plan = tuneBeaconWrites(map, rows, { m: tf }, base);
out.untouchedOnly = tuneBeaconWrites(map, [rows[0]], { m: tf }, base);
out.unplaced = tuneBeaconWrites(map, rows, { m: {} }, base);
out.noTransform = tuneBeaconWrites(map, rows, {}, base);
out.invalid = tuneBeaconWrites(map, [{ key: 'ble:BAD', x: 'nope', y: 0.1 }], { m: tf }, {});
out.dup = tuneBeaconWrites(map, [rows[2], { ...rows[2], x: 0.9 }], { m: tf }, {});
console.log(JSON.stringify(out));
"""


def _run() -> dict:
    script = _DRIVER.replace("from 'PLAN'", f"from '{(_VIEWS / 'tune_save_plan.js').as_uri()}'")
    script = script.replace("from 'STACK'", f"from '{(_VIEWS / 'stack_transform.js').as_uri()}'")
    res = subprocess.run([str(_NODE), "--input-type=module", "-e", script],
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
class TestBeaconTuneWrites:
    def test_only_placed_and_moved_beacons_are_written(self):
        out = _run()
        plan = out["plan"]
        assert plan["refused"] is False and plan["invalid"] == []
        assert [w["key"] for w in plan["writes"]] == ["ble:MOVED", "ble:NEW"]

    def test_writes_are_metres_on_the_maps_floor(self):
        w = {w["key"]: w for w in _run()["plan"]["writes"]}
        assert w["ble:MOVED"]["x_m"] == pytest.approx(5.0) and w["ble:MOVED"]["y_m"] == pytest.approx(4.0)
        assert w["ble:NEW"]["x_m"] == pytest.approx(2.0) and w["ble:NEW"]["y_m"] == pytest.approx(2.0)
        assert {x["floor_id"] for x in w.values()} == {"up"}
        assert w["ble:MOVED"]["label"] == "Desk" and w["ble:MOVED"]["kind"] == "ble"
        # the submitted fractions, for the baseline; never a height (kept as stored)
        assert (w["ble:NEW"]["x"], w["ble:NEW"]["y"]) == (0.1, 0.2)
        assert "z_m" not in w["ble:NEW"]

    def test_a_pin_nobody_touched_is_never_restated(self):
        assert _run()["untouchedOnly"]["writes"] == []

    def test_a_tracked_object_shown_for_display_is_never_written(self):
        assert "ble:PHONE" not in [w["key"] for w in _run()["plan"]["writes"]]

    def test_a_map_not_placed_in_metres_is_refused_whole(self):
        out = _run()
        for k in ("unplaced", "noTransform"):
            assert out[k]["refused"] is True and out[k]["writes"] == []

    def test_bad_coordinates_are_reported_not_skipped(self):
        assert _run()["invalid"]["invalid"] == ["ble:BAD"]

    def test_one_write_per_key(self):
        assert len(_run()["dup"]["writes"]) == 1


class TestBeaconTuneIsWired:
    """The view side, read from source: the pure helper is no use if the
    buttons still run the empty loop."""

    SRC = (_VIEWS / "calibration.js").read_text(encoding="utf-8")

    def test_save_and_auto_save_write_to_the_fabric(self):
        body = self.SRC[self.SRC.index("async function _saveBeacons("):]
        body = body[:body.index("\n  }\n")]
        assert "padspan_ha/fabric_beacon_position_set" in body and "tuneBeaconWrites(" in body
        auto = self.SRC[self.SRC.index("async function _autoSaveAndStartTimer("):]
        assert "_saveBeacons([mapId])" in auto[:auto.index("_startLiveTimer")]
        assert "await _saveBeacons(dirtyIds)" in self.SRC

    def test_the_empty_save_loop_is_gone(self):
        assert not re.search(r"if \(!origMap\) continue;\s*\}\s*bs\.dirtyMaps = \{\};", self.SRC)

    def test_auto_pinned_objects_are_baselined(self):
        auto = self.SRC[self.SRC.index("function _autoPinTracked()"):]
        auto = auto[:auto.index("\n  }\n")]
        assert "bs.editBaseline[m.id]" in auto

    def test_every_reseed_resets_the_baseline(self):
        # initial/maps-changed seed and Reset both reseed drafts from the maps
        assert self.SRC.count("bs.editBaseline[m.id] = tuneBeaconBaseline(bs.draftBeacons[m.id])") == 2

    def test_beacon_tune_pans_and_zooms_without_stealing_its_gestures(self):
        assert 'attachPanZoom(isoDiv, isoInner, { exclude: "[data-bk-id]", dblclickReset: false })' in self.SRC
        # every Beacon Tune SVG rebuild targets the moved layer
        assert "isoDiv.innerHTML = buildBeaconSVG" not in self.SRC


class TestPinFieldsReachThePanel:
    def test_every_anchor_field_the_coordinator_sets_is_merged(self):
        coord = (_PKG / "presence_coordinator.py").read_text(encoding="utf-8")
        set_fields = set(re.findall(r'obj\["(anchor_[a-z_]+)"\]\s*=', coord)) | {"_pinned"}
        assert {"anchor_true_x_m", "anchor_true_y_m", "anchor_drift_m"} <= set_fields
        sb = (_PKG / "snapshot_builder.py").read_text(encoding="utf-8")
        merge = sb[sb.index("_MERGE_KEYS = ("):]
        merge = merge[:merge.index(")") + 1]
        missing = {f for f in set_fields if f'"{f}"' not in merge}
        assert not missing, missing

    def test_overview_draws_a_pinned_beacon_at_its_pin(self):
        ov = (_VIEWS / "overview.js").read_text(encoding="utf-8")
        i = ov.index("o._pinned && typeof o.anchor_true_x_m")
        assert "x_m: o.anchor_true_x_m, y_m: o.anchor_true_y_m" in ov[i:i + 400]


class TestPanZoomOptions:
    SRC = (_VIEWS / "pan_zoom.js").read_text(encoding="utf-8")

    def test_a_caller_can_exclude_its_own_handles(self):
        assert "opts.exclude" in self.SRC

    def test_a_caller_can_keep_double_click(self):
        i = self.SRC.index("opts.dblclickReset !== false")
        assert 'addEventListener("dblclick"' in self.SRC[i:i + 200]
        assert self.SRC.count('addEventListener("dblclick"') == 1
