# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Stop & Discard while the capture loop waits on its snapshot fetch.

Field reports (2026-10, 3 homes, 0.38.85-0.38.157): an uncaught TypeError
from calibration.js on heavy capture days. The loop checked its stop flag
only before `await refreshSnapshot()`; Stop & Discard cleared cs.readings
during that wait, and the loop went on into `cs.readings[src]` (beacon
heard) or `Object.entries(cs.readings)` (not heard). A Stop then Start in
the same wait also left the old loop writing into the new capture.

The real _startCollection runs here in node, with its helpers stubbed and
the fetch held open until the test lets it go.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_CAL = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
        / "www" / "padspan-ha" / "views" / "calibration.js")
_NODE = shutil.which("node")


def _fn(src: str, name: str) -> str:
    start = src.index(f"function {name}(")
    return src[start:src.index("\nfunction ", start + 1)]


_HARNESS = r"""
const POLL_MS = 5;
const tuneLivePhase = () => "live";
const _recordableSnap = () => ({});
const _acceptCalSample = () => true;
const _rssiRow = () => ({});
const _plOpts = () => ({});
const _totalSamples = (cs) => Object.values(cs.readings || {}).reduce((t, r) => t + r.samples.length, 0);
let heard = true;
const _findBeaconAds = () => ({ perRadio: heard ? { r1: { rssi: -60, name: "Kitchen" } } : {} });
__FN__
const errors = [];
process.on("unhandledRejection", (e) => errors.push(String(e)));
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function scenario(beaconHeard, restart) {
  heard = beaconHeard;
  let release = [];
  const ctx = {
    state: {}, toast() {}, helpers: { el: () => ({}) },
    actions: {
      renderRooms() {},
      refreshSnapshot: () => new Promise((r) => release.push(r)),
    },
  };
  const cs = { duration: 30, deviceId: "dev" };
  _startCollection(ctx, cs, {}, {});
  await tick(1);
  // Stop & Discard, exactly as its click handler does
  cs.stopFlag = true; cs.collecting = false; cs.readings = null;
  let second = null;
  if (restart) { _startCollection(ctx, cs, {}, {}); second = cs.readings; }
  release.splice(0).forEach((r) => r());
  await tick(20);
  release.splice(0).forEach((r) => r());
  await tick(20);
  const out = { readings: cs.readings && Object.fromEntries(
    Object.entries(cs.readings).map(([k, v]) => [k, v.samples.length])) };
  cs.stopFlag = true;
  release.splice(0).forEach((r) => r());
  await tick(10);
  return out;
}
(async () => {
  const res = {
    heard: await scenario(true, false),
    unheard: await scenario(false, false),
    restart: await scenario(true, true),
  };
  await tick(20);
  console.log(JSON.stringify({ ...res, errors }));
})();
"""


@pytest.mark.skipif(not _NODE, reason="node not installed")
def test_stop_during_the_fetch_neither_throws_nor_leaves_two_loops(tmp_path) -> None:
    src = _CAL.read_text(encoding="utf-8").replace("\r\n", "\n")
    script = tmp_path / "stop_race.mjs"
    script.write_text(_HARNESS.replace("__FN__", _fn(src, "_startCollection")), encoding="utf-8")
    res = subprocess.run([_NODE, str(script)], capture_output=True, text=True, timeout=60)
    assert res.returncode == 0, res.stderr[-2000:]
    out = json.loads(res.stdout.strip().splitlines()[-1])
    # no uncaught TypeError from the stopped loop, heard or not
    assert out["errors"] == [], out["errors"]
    assert out["heard"]["readings"] is None
    assert out["unheard"]["readings"] is None
    # Stop then Start in the same wait: only the new loop samples, one per poll
    # (two loops would put two samples in per poll and outlive the stop)
    assert out["restart"]["readings"] == {"r1": 2}, out["restart"]
