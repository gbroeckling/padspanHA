"""Where a walk log comes from (tools/benchmark): PadSpan's own RSSI capture
export, a Home Assistant room sensor's history, and the public Zenodo house
dataset's layout. Synthetic files only."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1] / "tools" / "benchmark"
if not (_TOOLS / "benchmark.py").is_file():
    pytest.skip("no tools/ in this tree (a Bright build)", allow_module_level=True)
sys.path.insert(0, str(_TOOLS))
sys.path.insert(0, str(_TOOLS / "datasets"))

import benchmark  # noqa: E402
import from_capture  # noqa: E402
import score_sensor  # noqa: E402
import zenodo_4783076  # noqa: E402

from tests.test_capture_replay import _AREA, _DWELL, _record  # noqa: E402


async def test_a_padspan_capture_becomes_a_walk_log(tmp_path):
    path = await _record(tmp_path, ground_truth=True)
    log = from_capture.convert([path])
    assert len(log["polls"]) == 2 * _DWELL
    assert {p["room"] for p in log["polls"]} == {"Office", "Kitchen"}
    assert {s: sc["room"] for s, sc in log["scanners"].items()} == _AREA
    first = log["polls"][0]
    assert first["walk"] and first["device"].startswith("ble:")
    assert first["rssi"]["scan_office"] == pytest.approx(-55.0)
    assert "room" in first["live"]                  # what PadSpan showed at the time
    res = benchmark.run(log)
    assert res["grouping"] == "visit"
    assert res["methods"]["nearest"]["rooms_right_pc"] == 100.0
    assert "live" in res["methods"]


async def test_an_unmarked_capture_gives_no_polls(tmp_path):
    assert from_capture.convert([await _record(tmp_path)])["polls"] == []


def _walk():
    return {"scanners": {}, "rooms": {}, "floors": {}, "polls": [
        {"ts": 100.0 + i, "walk": "w", "device": "d", "room": room, "x": None, "y": None,
         "floor": "", "rssi": {}}
        for i, room in enumerate(["Living Room"] * 5 + ["Kitchen"] * 5)]}


def test_a_room_sensor_is_scored_from_ha_rest_history(tmp_path):
    hist = [[{"entity_id": "sensor.phone_area", "state": "living_room",
              "last_changed": "1970-01-01T00:01:39+00:00"},
             {"entity_id": "sensor.phone_area", "state": "unavailable",
              "last_changed": "1970-01-01T00:01:46+00:00"},
             {"entity_id": "sensor.phone_area", "state": "kitchen",
              "last_changed": "1970-01-01T00:01:47+00:00"}]]
    (tmp_path / "h.json").write_text(json.dumps(hist))
    res = score_sensor.score(_walk(), score_sensor.load_history(tmp_path / "h.json", "sensor.phone_area"))
    # 100-104 living room right; 105 still "living_room" (wrong); 106 no answer; 107-109 right.
    assert res["room_polls"] == 10 and res["answered"] == 9
    assert res["rooms_right_pc"] == 80.0
    assert {"true": "Kitchen", "called": "(no answer)", "polls": 1} in res["confusions"]


def test_a_room_sensor_is_scored_from_the_history_panel_csv(tmp_path):
    (tmp_path / "h.csv").write_text(
        "entity_id,state,last_changed\n"
        "sensor.other,Kitchen,1970-01-01T00:00:00.000Z\n"
        "sensor.tag_room,Lounge,1970-01-01T00:01:30.000Z\n"
        "sensor.tag_room,Kitchen,1970-01-01T00:01:45.000Z\n")
    hist = score_sensor.load_history(tmp_path / "h.csv", "sensor.tag_room")
    assert len(hist) == 2
    res = score_sensor.score(_walk(), hist, {"Lounge": "Living Room"})
    assert res["rooms_right_pc"] == 100.0


def test_the_zenodo_house_layout_converts_by_session(tmp_path):
    rows = {  # beacon RSSI x6, packets x6, device, room
        "calibration-laptop": ["-60,-90,-90,-90,-90,-90,9,5,5,5,5,5,1,1",
                               "-90,-60,-90,-90,-90,-100,5,9,5,5,5,0,1,2"],
        "test-laptop": ["-61,-89,-90,-90,-90,-90,9,5,5,5,5,5,1,1"],
        "test-raspberry": ["-88,-62,-90,-90,-90,-90,5,9,5,5,5,5,2,2"],
    }
    for walk, name in zenodo_4783076.FILES.items():
        (tmp_path / name).write_text("\n".join(rows[walk]) + "\n")
    log = zenodo_4783076.convert(tmp_path)
    assert len(log["polls"]) == 4
    assert "beacon6" not in log["polls"][1]["rssi"]          # 0 packets = not heard
    assert log["scanners"]["beacon1"]["room"] == "room1"
    assert log["scanners"]["beacon2"]["room"] == "room2"
    res = benchmark.run(log, train_walks={"calibration-laptop"})
    assert res["methods"]["knn"]["rooms_right_pc"] == 100.0
