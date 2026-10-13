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

import functools
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
import { tuneSavePlanInit, tuneBeaconWrites, tuneBeaconBaseline, tuneBeaconHeldText } from 'PLAN';
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
// A tracked phone shown for display, then dragged: still never a fixed beacon.
out.draggedPhone = tuneBeaconWrites(map, [{ ...rows[3], x: 0.1, y: 0.1, _tracked: true }], { m: tf }, base);
// Nothing changed on a map with no metre placement: not refused.
out.unplacedNothing = tuneBeaconWrites(map, [rows[0]], { m: {} }, base);
// Which rows may become a pin (r5). guard: the fabric's pins, the live
// objects, and the follow list as panel.js keeps it (uppercase; a bare
// address or entity id, an iBeacon's key).
const follows = new Set(['AA:BB:CC:DD:EE:01', 'AA:BB:CC:DD:EE:09', 'IBEACON:APP']);
const followedHas = (id) => !!id && follows.has(String(id).toUpperCase());
const guard = (pinned, objs) => ({ pinned: pinned || {}, objs: new Map(objs || []), followedHas });
const at = (x, y) => ({ x, y });
// (a) an existing pin moves whatever the device is: a fixed beacon Bermuda
// tracks (entity), a followed one, even a tracked phone.
out.pinnedEntity = tuneBeaconWrites(map, [{ key: 'entity:device_tracker.hall', label: 'Hall', kind: 'entity', x: 0.6, y: 0.5 }],
  { m: tf }, { 'entity:device_tracker.hall': at(0.5, 0.5) }, guard({ 'entity:device_tracker.hall': { x_m: 10, y_m: 5 } }));
out.pinnedFollowed = tuneBeaconWrites(map, [{ key: 'ble:AA:BB:CC:DD:EE:01', label: 'Shelf', kind: 'ble', x: 0.6, y: 0.5 }],
  { m: tf }, { 'ble:AA:BB:CC:DD:EE:01': at(0.5, 0.5) }, guard({ 'ble:AA:BB:CC:DD:EE:01': { x_m: 10, y_m: 5 } }));
out.pinnedPhone = tuneBeaconWrites(map, [{ key: 'ble:IRK', label: 'Phone', kind: 'private_ble', x: 0.6, y: 0.5, _tracked: true }],
  { m: tf }, { 'ble:IRK': at(0.5, 0.5) }, guard({ 'ble:IRK': { x_m: 10, y_m: 5 } }));
// (b) shown at its room's centre (_tracked), then dragged: a Companion-app
// iBeacon phone nobody follows, and a Find My tag on its first address.
out.trackedAppPhone = tuneBeaconWrites(map, [{ key: 'ibeacon:companion', label: 'Pixel', kind: 'ibeacon', x: 0.1, y: 0.1, _tracked: true }],
  { m: tf }, { 'ibeacon:companion': at(0.5, 0.5) }, guard({}, [['ibeacon:companion', { key: 'ibeacon:companion', kind: 'ibeacon' }]]));
out.trackedFindMy = tuneBeaconWrites(map, [{ key: 'ble:AA:BB:CC:DD:EE:02', label: 'AirTag', kind: 'ble', x: 0.1, y: 0.1, _tracked: true }],
  { m: tf }, { 'ble:AA:BB:CC:DD:EE:02': at(0.5, 0.5) }, guard());
// (c) followed by its bare address and not in the snapshot; an iBeacon
// followed by its key; a phone, private_ble live or on its row.
out.followedNotLive = tuneBeaconWrites(map, [{ key: 'ble:AA:BB:CC:DD:EE:09', label: 'Car Keys', kind: 'ble', x: 0.3, y: 0.3 }],
  { m: tf }, {}, guard());
out.followedByKey = tuneBeaconWrites(map, [{ key: 'ibeacon:app', label: 'Phone app', kind: 'ibeacon', x: 0.3, y: 0.3 }],
  { m: tf }, {}, guard());
out.placedPhone = tuneBeaconWrites(map, [{ key: 'ble:IRK2', label: 'Watch', kind: 'private_ble', x: 0.3, y: 0.3 }], { m: tf }, {}, guard());
out.livePhone = tuneBeaconWrites(map, [{ key: 'ble:IRK3', label: 'iPad', kind: 'ble', x: 0.3, y: 0.3 }],
  { m: tf }, {}, guard({}, [['ble:IRK3', { key: 'ble:IRK3', kind: 'private_ble' }]]));
// (d) placed from the list, nobody follows it, not tracked: pinned.
out.placedBeacons = tuneBeaconWrites(map, [
  { key: 'ble:AA:BB:CC:DD:EE:03', label: 'Tile', kind: 'ble', x: 0.3, y: 0.3 },
  { key: 'ibeacon:door', label: 'Door', kind: 'ibeacon', x: 0.4, y: 0.3 },
  { key: 'entity:device_tracker.fob', label: 'Fob', kind: 'entity', x: 0.5, y: 0.3 },
], { m: tf }, {}, guard({}, [['entity:device_tracker.fob', { key: 'entity:device_tracker.fob', kind: 'entity',
  address: 'AA:BB:CC:DD:EE:04', entity_id: 'device_tracker.fob' }]]));
// (e) what was held back is reported, by name and why.
out.heldText = tuneBeaconHeldText([...out.followedNotLive.held, ...out.placedPhone.held, ...out.trackedAppPhone.held]);
out.heldTextNoCapture = tuneBeaconHeldText(out.followedNotLive.held, false);
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

    def test_a_dragged_tracked_phone_is_never_pinned(self):
        """A drag pinned a moving phone as a fixed beacon: its room locked to
        the pin and auto-calibration labelled points with a spot it had left."""
        assert _run()["draggedPhone"]["writes"] == []

    def test_an_unplaced_map_with_nothing_changed_is_not_refused(self):
        """It was refused before anything was compared, so a map with no
        metre placement stayed unsaved for good after any auto-pin."""
        out = _run()["unplacedNothing"]
        assert out["refused"] is False and out["writes"] == []

    def test_moving_an_existing_pin_moves_it_whatever_the_device_is(self):
        """A fixed BLE beacon Bermuda tracks is an entity object, and a
        followed one is followed; their pins came back from the fabric and a
        drag or Relocate wrote nothing while the old pin kept locking the room."""
        out = _run()
        for k, key in (("pinnedEntity", "entity:device_tracker.hall"),
                       ("pinnedFollowed", "ble:AA:BB:CC:DD:EE:01"), ("pinnedPhone", "ble:IRK")):
            assert [w["key"] for w in out[k]["writes"]] == [key], k
            assert out[k]["held"] == [], k

    def test_a_tracked_row_dragged_is_never_pinned(self):
        """A Companion-app iBeacon phone nobody follows, and a Find My tag
        still on its first address (plain ble): only _tracked tells."""
        out = _run()
        for k in ("trackedAppPhone", "trackedFindMy"):
            assert out[k]["writes"] == [] and [h["reason"] for h in out[k]["held"]] == ["tracked"], k

    def test_a_phone_or_followed_device_placed_from_the_list_is_never_pinned(self):
        """Only rows the auto-pin made were skipped, and with no room polygon
        it made none: a labelled phone or tag placed from the Available list
        was pinned, its room locked there and auto-calibration points added
        at the pin while it was elsewhere."""
        out = _run()
        assert out["followedNotLive"]["held"] == [{"key": "ble:AA:BB:CC:DD:EE:09", "label": "Car Keys", "reason": "followed"}]
        assert [h["reason"] for h in out["followedByKey"]["held"]] == ["followed"]
        for k in ("placedPhone", "livePhone"):
            assert [h["reason"] for h in out[k]["held"]] == ["phone"], k
        for k in ("followedNotLive", "followedByKey", "placedPhone", "livePhone"):
            assert out[k]["writes"] == [], k

    def test_a_beacon_nobody_follows_placed_from_the_list_is_pinned(self):
        out = _run()["placedBeacons"]
        assert [w["key"] for w in out["writes"]] == ["ble:AA:BB:CC:DD:EE:03", "ibeacon:door", "entity:device_tracker.fob"]
        assert out["held"] == []

    def test_what_was_held_back_is_said_by_name(self):
        out = _run()
        assert out["heldText"] == (
            "Car Keys moves with someone (followed) - not pinned; its 60 s calibration still runs. "
            "Watch moves with someone (a phone or Find My tag) - not pinned; its 60 s calibration still runs. "
            "Pixel is only shown at its room's centre (tracked) - not pinned; its 60 s calibration still runs")
        assert out["heldTextNoCapture"] == "Car Keys moves with someone (followed) - not pinned"


_FLOWS = Path(__file__).resolve().parent / "js" / "beacon_tune_save.mjs"


@functools.lru_cache(maxsize=1)
def _flows() -> dict:
    """The shipped Beacon Tune functions run against a stub tab
    (tests/js/beacon_tune_save.mjs): what each flow wrote and said."""
    res = subprocess.run([str(_NODE), str(_FLOWS), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
class TestBeaconTuneFlows:
    def test_on_a_fabric_only_install_only_fixed_beacons_placed_from_the_list_are_pinned(self):
        """No room polygon, so nothing was auto-pinned and every labelled
        phone or tag placed from the Available list became a fixed pin."""
        out = _flows()["fabricOnly"]
        assert out["autoPinned"] == 0
        assert out["calls"] == ["ibeacon:door", "entity:device_tracker.fob"]
        assert [t.split(" moves with someone")[0] for t in out["toasts"]] == ["Garry's Phone", "Pixel app", "Car Keys"]
        # every placement still runs its 60 s capture
        assert len(out["captures"]) == 5

    def test_a_tracked_phone_or_find_my_tag_dragged_or_relocated_is_not_pinned(self):
        out = _flows()["autoPinned"]
        assert [r["tracked"] for r in out["shown"]] == [True, True]
        assert out["calls"] == []
        assert [t.split(" is only shown")[0] for t in out["toasts"]] == ["Pixel", "AirTag"]

    def test_existing_pins_of_entity_and_followed_beacons_move(self):
        out = _flows()["existingPins"]
        assert out["calls"] == ["entity:device_tracker.hall", "ble:AA:BB:CC:DD:EE:01"]
        assert out["toasts"] == []

    def test_save_names_what_it_held_back(self):
        out = _flows()["saveHeld"]
        assert out["calls"] == []
        assert out["toasts"] == ["Garry's Phone moves with someone (a phone or Find My tag) - not pinned; "
                                 "its 60 s calibration still runs"]


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
