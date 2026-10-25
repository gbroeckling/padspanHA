#!/usr/bin/env python3
"""Turn PadSpan RSSI capture sessions into one walk log.

    python tools/benchmark/from_capture.py padspan-capture-*.jsonl -o walk.json

A capture (Settings > RSSI capture, then Health > RSSI vector capture:
Start, "Mark" the room you are standing in each time you move, Stop,
Download) already holds everything a walk log needs: per poll, every
scanner's raw RSSI for each device, the room you marked (and the x/y if you
typed them), the scanner positions and rooms, and the room PadSpan itself
showed. Each file becomes one walk. Only polls under a mark are kept.

The file is read with PadSpan's own loader (capture_replay.load_capture).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import padspan_import  # noqa: E402
import walklog  # noqa: E402


def convert(paths: list[Path], devices: set[str] | None = None) -> dict[str, Any]:
    replay = padspan_import.module("capture_replay")
    log: dict[str, Any] = {"scanners": {}, "rooms": {}, "floors": {}, "polls": []}
    for path in paths:
        header, frames = replay.load_capture(path)
        walk = str(header.get("lbl") or "") or path.stem
        s2a = header.get("s2a") or {}
        s2f = header.get("s2f") or {}
        absz = header.get("absz") or {}
        for src in set(header.get("src") or []) | set(s2a) | set(header.get("pos") or {}):
            pos = (header.get("pos") or {}).get(src) or {}
            log["scanners"][str(src)] = {
                "room": str(s2a.get(src) or ""),
                "x": pos.get("x_m"), "y": pos.get("y_m"),
                "floor": str(pos.get("floor_id") or s2f.get(src) or ""),
                "z": absz.get(src)}
        for room, c in (header.get("cent") or {}).items():
            log["rooms"].setdefault(str(room), {"floor": "", "polygon": None, "centroid": c})
        for fl, base in (header.get("fbase") or {}).items():
            if isinstance(base, (int, float)):
                log["floors"][str(fl)] = float(base)
        for f in frames:
            for o in f.get("o") or []:
                if not o.get("g") or (devices and o.get("k") not in devices):
                    continue
                live: dict[str, Any] = {"room": o.get("r") or ""}
                if o.get("mx") is not None:
                    live.update(x=o["mx"], y=o["my"], floor=o.get("mf") or "")
                log["polls"].append({
                    "ts": f.get("ts"), "walk": walk, "device": str(o.get("k") or ""),
                    "room": str(o["g"]), "x": o.get("gx"), "y": o.get("gy"), "floor": "",
                    "rssi": dict(o.get("v") or {}), "live": live})
    log["polls"] = [walklog._poll(p, p["walk"]) for p in log["polls"]]
    return log


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("captures", nargs="+", type=Path)
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--device", action="append", default=[],
                    help="keep only this device key (repeatable); default every marked one")
    a = ap.parse_args(argv)
    log = convert(a.captures, set(a.device) or None)
    walklog.dump(log, a.out)
    print(f"{len(log['polls'])} marked polls from {len(a.captures)} capture(s) -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
