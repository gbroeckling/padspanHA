#!/usr/bin/env python3
"""Turn the public Zenodo 4783076 "house" files into a walk log.

    python tools/benchmark/datasets/zenodo_4783076.py DATA_DIR -o house.json

Dataset: "BLE beacon fingerprint at a university basement and house
scenarios for room-level positioning", https://zenodo.org/records/4783076,
CC BY 4.0. Download the three "house - ..." CSV files into DATA_DIR; they
are not copied into this repository.

The house has 6 fixed BLE beacons and 10 rooms. Each row is one fingerprint
(the beacons' average RSSI over a short window, packets per beacon, device
id, true room id), taken by a laptop (calibration and test sessions) and a
Raspberry Pi (test session). Each file becomes one walk, so
--train-walk calibration-laptop trains on the calibration session only and
tests on the two later sessions: a by-session split, never a random one.

Two things differ from a PadSpan house and the docs say so: the radios are
the other way round (fixed transmitters, a moving receiver), which k-NN does
not mind; and the dataset does not say where the beacons are, so the
"nearest scanner" baseline takes each beacon's room as the room where the
calibration session heard it loudest, and the spatial method cannot run.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import walklog  # noqa: E402

FILES = {
    "calibration-laptop": "house - calibration fingerprint laptop.csv",
    "test-laptop": "house - test fingerprint laptop.csv",
    "test-raspberry": "house - test fingerprint raspeberry.csv",   # sic, the file's own name
}
BEACONS = 6


def convert(data_dir: Path) -> dict:
    polls = []
    for walk, name in FILES.items():
        with (data_dir / name).open(newline="", encoding="utf-8-sig") as fh:
            for row in csv.reader(fh):
                if len(row) < 2 * BEACONS + 2:
                    continue
                rssi = {}
                for b in range(BEACONS):
                    # No packets from a beacon in the window means not heard.
                    if float(row[BEACONS + b]) > 0:
                        rssi[f"beacon{b + 1}"] = float(row[b])
                polls.append({"walk": walk, "device": f"device{row[2 * BEACONS]}",
                              "room": f"room{row[2 * BEACONS + 1]}", "rssi": rssi})
    # Each beacon's room: where the calibration session heard it loudest.
    loud: dict[str, tuple[float, str]] = {}
    sums: dict[tuple[str, str], list[float]] = {}
    for p in polls:
        if p["walk"] != "calibration-laptop":
            continue
        for b, v in p["rssi"].items():
            s = sums.setdefault((b, p["room"]), [0.0, 0])
            s[0] += v
            s[1] += 1
    for (b, room), (tot, n) in sums.items():
        mean = tot / n
        if b not in loud or mean > loud[b][0]:
            loud[b] = (mean, room)
    scanners = {b: {"room": room} for b, (_m, room) in sorted(loud.items())}
    return {"scanners": scanners, "rooms": {}, "floors": {}, "polls": polls}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("data_dir", type=Path)
    ap.add_argument("-o", "--out", required=True)
    a = ap.parse_args(argv)
    log = convert(a.data_dir)
    walklog.dump(log, a.out)
    print(f"{len(log['polls'])} polls, {len(log['scanners'])} beacons -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
