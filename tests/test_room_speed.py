"""Room changes are shown quickly, and a still device does not flicker.

A synthetic walk (tests/room_speed_sim.py says why it is synthetic and what it
models) runs through PadSpan's own pipeline on a simulated clock: the scanner
lists and callbacks, BluetoothLive, the coordinator's ingestion and
_smooth_room. Nothing here reads the wall clock.

PADSPAN_ROOM_SPEED_REPORT=1 prints the full table (more walks).
"""

from __future__ import annotations

import json
import os

import pytest

from tests import room_speed_sim as sim


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
