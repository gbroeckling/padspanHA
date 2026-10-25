# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Issue #90 on a touch screen, and two map-handling slips found with it.

With Auto-Cal on, Beacon Tune redraws its map every second. A touch's move
and end go to the node it started on; once the redraw took that node out of
the page they stopped reaching pan_zoom.js's viewport, the pan never ended,
and the next beacon drag panned the map under the finger and saved the
beacon ~86 m outside the house. pan_zoom.js now listens on the touch's own
node and starts every touch afresh; a beacon dropped off its map is put
back, not saved. A pinch drifted (scale-1) x the viewport's padding (the
fixed-point math skipped inner's layout offset, which wheel zoom already
took off), and a double-click on a beacon never reached the map's dblclick
(each click redraws the map), so it could not place a beacon there.

Driven through the shipped code: tests/js/pan_zoom_touch.mjs (a small
event-path DOM) and tests/js/beacon_tune_pointer.mjs (calibration.js's
pointer block). The shared mouse, wheel, keyboard and double-click paths
give the same numbers as before for every caller.
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
_NODE = shutil.which("node")


@functools.lru_cache(maxsize=None)
def _run(harness: str) -> dict:
    res = subprocess.run([str(_NODE), str(_ROOT / "tests" / "js" / harness), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
class TestPanZoomTouch:
    def test_touch_pan_ends_even_when_its_node_is_replaced(self):
        out = _run("pan_zoom_touch.mjs")["replacedNode"]
        assert (out["mid"]["tx"], out["afterRedraw"]["tx"], out["afterRedraw"]["ty"]) == (50, 100, 20)
        # the beacon drag after it leaves the map where it was
        assert (out["afterBeacon"]["tx"], out["afterBeacon"]["ty"]) == (100, 20)
        assert out["beaconMovePrevented"] is True
        assert out["listenersLeft"] == 0

    def test_a_lost_touchend_does_not_latch_the_pan(self):
        out = _run("pan_zoom_touch.mjs")["lostEnd"]
        assert (out["tx"], out["ty"]) == (40, 0)

    def test_pinch_keeps_its_centre(self):
        out = _run("pan_zoom_touch.mjs")
        p = out["pinch"]
        assert p["scale"] == 2
        assert p["centreX"] == pytest.approx(150) and p["centreY"] == pytest.approx(100)
        assert out["pinchCleanup"] == 0

    def test_shared_paths_unchanged(self):
        """Pin & Listen, Roam, Rooms and Beacon Tune share these: the numbers
        the code before this change gives, under the same harness."""
        out = _run("pan_zoom_touch.mjs")
        assert out["mouse"]["transform"] == "translate(30px, 20px) scale(1)"
        assert out["wheel"]["scale"] == pytest.approx(1.12)
        assert (out["wheel"]["tx"], out["wheel"]["ty"]) == (pytest.approx(21.6), pytest.approx(16.4))
        assert out["keys"]["scale"] == pytest.approx(1.344)
        assert (out["keys"]["tx"], out["keys"]["ty"]) == (pytest.approx(45.12), pytest.approx(-8.72))
        assert out["dblclick"]["transform"] == "translate(0px, 0px) scale(1)"
        assert out["touchPan"]["transform"] == "translate(25px, 5px) scale(1)"
        assert out["handle"]["transform"] == "translate(25px, 5px) scale(1)"
        assert out["noDblReset"]["transform"] == "translate(30px, 0px) scale(1)"

    def test_callers_unchanged(self):
        cal = (_VIEWS / "calibration.js").read_text(encoding="utf-8")
        maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
        assert cal.count("attachPanZoom(mapWrap, mapInner);") == 2
        assert 'attachPanZoom(isoDiv, isoInner, { exclude: "[data-bk-id]", dblclickReset: false })' in cal
        assert "attachPanZoom(stage, inner)" in maps


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
class TestBeaconTunePointer:
    def test_a_drop_off_the_map_is_put_back_and_not_saved(self):
        out = _run("beacon_tune_pointer.mjs")["offMap"]
        assert out["saved"] == []
        assert out["row"] == {"x": 0.5, "y": 0.5} and out["dirty"] is False
        assert out["toasts"] == [["Keys was dropped outside the map - put back where it was", True]]

    def test_a_drop_on_the_map_saves_as_before(self):
        out = _run("beacon_tune_pointer.mjs")
        assert out["onMap"]["saved"] == [{"key": "ble:K", "x": 0.25, "y": 0.75}]
        assert out["onMap"]["toasts"] == []
        assert out["edge"] == {"saved": 1, "toasts": 0}

    def test_double_click_on_a_beacon_places_there_while_placing(self):
        out = _run("beacon_tune_pointer.mjs")
        assert out["doublePlacing"] == {"placed": [[0.5005, 0.5]], "saved": 0}
        assert out["twoTapsApart"]["placed"] == []

    def test_double_click_on_a_beacon_otherwise_just_selects_it(self):
        out = _run("beacon_tune_pointer.mjs")["doubleNotPlacing"]
        assert out["placed"] == [] and out["saved"] == 0
        assert out["selected"] == {"mapId": "m1", "bkId": "bk1"}

    def test_the_maps_dblclick_does_not_place_twice(self):
        cal = (_VIEWS / "calibration.js").read_text(encoding="utf-8")
        i = cal.index('isoDiv.addEventListener("dblclick", e => {\n    if (Date.now() - _bkTapPlacedAt < 600) return;'
                      .replace("\n", "\r\n" if "\r\n" in cal else "\n"))
        assert "_placeAtPoint(e);" in cal[i:i + 200]
