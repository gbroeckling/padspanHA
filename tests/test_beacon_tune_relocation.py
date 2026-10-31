# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Beacon Tune's hard relocation deletes only that beacon's Beacon Tune points.

It used to delete every calibration point whose device or label matched the
beacon, so the points collected by carrying the same device (Pin & Listen,
Roam, Walk a room) went with them. Beacon Tune now marks its points
(source "beacon_tune", kept by the store) and the purge picks only those, plus
the beacon's automatic "[auto]" points taken at its old pin.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha.calibration_store import BEACON_TUNE_SOURCE, CalibrationStore

_ROOT = Path(__file__).resolve().parents[1]
_CAL = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "calibration.js"
_NODE = shutil.which("node")


def _purge_fn() -> str:
    src = _CAL.read_text(encoding="utf-8")
    start = src.index("function _beaconTunePurgeIds(")
    return src[start:src.index("\n}\n", start) + 2]


def _run(points: list[dict], ids: dict, protected: list[str]) -> list[str]:
    if _NODE is None:
        pytest.skip("node is not installed")
    js = (_purge_fn() + f"\nconsole.log(JSON.stringify(_beaconTunePurgeIds({json.dumps(points)}, "
          f"{json.dumps(ids)}, new Set({json.dumps(protected)}))));\n")
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_only_the_beacons_beacon_tune_points_go() -> None:
    dev, key, label = "AA:BB:CC:DD:EE:01", "ble:aa:bb:cc:dd:ee:01", "Kitchen beacon"
    pts = [
        {"id": "bt_old", "device_id": dev, "label": label, "source": "beacon_tune"},
        {"id": "bt_new", "device_id": dev, "label": label, "source": "beacon_tune"},
        {"id": "auto", "device_id": key, "label": f"[auto] {label}"},
        {"id": "pin_listen", "device_id": dev, "label": label},
        {"id": "pin_listen_nolabel", "device_id": dev, "label": ""},
        {"id": "walk", "device_id": dev, "label": "[walk] Kitchen", "source": "room_walk"},
        {"id": "other_bt", "device_id": "11:22:33:44:55:66", "label": "Hall beacon", "source": "beacon_tune"},
        {"id": "other_auto", "device_id": "ble:11:22", "label": "[auto] Hall beacon"},
    ]
    got = _run(pts, {"deviceId": dev, "key": key, "label": label}, ["bt_new"])
    assert sorted(got) == ["auto", "bt_old"]


def test_the_purge_uses_it_and_both_saves_mark_their_points() -> None:
    src = _CAL.read_text(encoding="utf-8")
    purge = src[src.index("const _purgeOldPoints = async"):][:900]
    assert "_beaconTunePurgeIds(" in purge and "calibrationDeletePoint(id)" in purge
    assert len(re.findall(r'source: "beacon_tune",', src)) == 2
    assert "points you collected by carrying it" in src.lower()


def test_the_store_keeps_the_beacon_tune_mark_and_nothing_else() -> None:
    store = CalibrationStore.__new__(CalibrationStore)
    store.data = {"points": [], "excluded_sources": []}
    store._model = None
    reads = [{"source": "s1", "rssi_samples": [-60, -61, -62]}]
    base = {"x_m": 1.0, "y_m": 2.0, "scanner_readings": reads, "floor_id": "f"}
    tuned = store._clean_point({**base, "source": BEACON_TUNE_SOURCE})
    other = store._clean_point({**base, "source": "room_walk"})
    plain = store._clean_point(base)
    assert tuned["source"] == "beacon_tune"
    assert "source" not in other and "source" not in plain
