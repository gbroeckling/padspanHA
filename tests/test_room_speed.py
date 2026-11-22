"""Room changes are shown quickly, and a still device does not flicker.

A synthetic walk (tests/room_speed_sim.py says why it is synthetic and what it
models) runs through PadSpan's own pipeline on a simulated clock: the scanner
lists and callbacks, BluetoothLive, and one real coordinator poll every 5 s.
Nothing here reads the wall clock, so the numbers are the same on any machine.

Before the change (0.38.258's code on these same walks): a move took a minute
and a half to show (median; many were never shown before the device left),
with 8.7 wrong switches an hour while still, 47 with the house drawn. The
bounds below sit between that and what it does now, so a slide back fails.

November 2026: Room Change Delay went from 20 s to 40 s by default (steadier
rooms on recordings of a real house, the owner's choice). On these walks it
costs: median 15.6 -> 25.6 s, p90 41.8 -> 59.8 s, one 180 s stay never shown
(none before); scanner-tuned rooms 11.3 -> 20.8 s; with the house drawn median
22.9 -> 30.5 s, p90 44.8 -> 141.1 s, two stays never shown (60 s and 120 s).
Still devices switch less: 8.4 -> 6.0 an hour, 14.4 -> 4.2 with the house drawn.

The full table (8 walks a mode, or PADSPAN_ROOM_SPEED_SEEDS of them; settings
to try in PADSPAN_ROOM_SPEED_SETTINGS as JSON):

    PADSPAN_ROOM_SPEED_REPORT=1 pytest tests/test_room_speed.py -s -k report
"""

from __future__ import annotations

import json
import os

import pytest

from tests import room_speed_sim as sim


@pytest.fixture(scope="module")
def walks() -> dict[str, list[sim.Trace]]:
    return {
        "no-map": sim.run_set(seeds=range(2)),              # a phone and a tag, 2 walks each
        "map": sim.run_set(seeds=range(1), fabric=True),
    }


def test_a_move_is_shown_in_seconds_not_a_minute(walks) -> None:
    s = sim.summary(sim.score(walks["no-map"]))
    assert s["missed"] <= 1, s                 # 0 at 20 s; was 16 of 52
    assert s["median_s"] <= 30.0, s            # was 90 s (15.6 at 20 s, 25.6 at 40 s)
    assert s["p90_s"] <= 60.0, s               # was never, for 16 of 52 moves


def test_a_move_into_a_room_whose_scanner_hears_well_takes_about_ten_seconds(walks) -> None:
    s = sim.summary(sim.score(walks["no-map"], rooms=sim.TUNED_ROOMS))
    assert s["median_s"] <= 25.0, s            # was 50 s (11.3 at 20 s, 20.8 at 40 s)
    assert s["p90_s"] <= 30.0, s               # was 105 s


def test_a_still_device_flickers_no_more_than_before(walks) -> None:
    s = sim.summary(sim.score(walks["no-map"]))
    assert s["flicker_per_h"] <= 10.0, s       # 8.7 before on these walks


def test_with_the_house_drawn_too(walks) -> None:
    s = sim.summary(sim.score(walks["map"]))
    assert s["missed"] <= 2, s                 # 0 at 20 s
    assert s["median_s"] <= 35.0, s            # was 82 s
    assert s["p90_s"] <= 150.0, s              # was never (44.8 at 20 s, 141.1 at 40 s)
    assert s["flicker_per_h"] <= 20.0, s       # was 47


@pytest.mark.skipif(not os.environ.get("PADSPAN_ROOM_SPEED_REPORT"), reason="report mode only")
def test_report() -> None:
    seeds = range(int(os.environ.get("PADSPAN_ROOM_SPEED_SEEDS", "8")))
    extra = json.loads(os.environ.get("PADSPAN_ROOM_SPEED_SETTINGS", "{}"))
    for fabric in (False, True):
        by_dev = {d.name: sim.run_set(devices=(d,), seeds=seeds, settings=extra, fabric=fabric)
                  for d in (sim.PHONE, sim.TAG)}
        by_dev["all"] = by_dev["phone"] + by_dev["tag"]
        for label, traces in by_dev.items():
            print("map" if fabric else "no-map", label, json.dumps(sim.summary(sim.score(traces))))
        for label, rooms in (("tuned-scanner rooms", sim.TUNED_ROOMS), ("default-window rooms", sim.SPARSE_ROOMS)):
            print("map" if fabric else "no-map", label,
                  json.dumps(sim.summary(sim.score(by_dev["all"], rooms=rooms))))
