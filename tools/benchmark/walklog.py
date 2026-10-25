"""Read a walk log: the benchmark's input file (format in docs/BENCHMARK.md).

A walk log is what a person walking the house recorded: at each poll, the
room they were really in (and, if they marked it, where), and what every
scanner heard from the device they carried. JSON, or a wide CSV plus a
scanners CSV. Everything comes out in one shape:

  {"scanners": {id: {"room", "x", "y", "floor", "z"}},
   "rooms":    {name: {"floor", "polygon", "centroid"}},
   "floors":   {id: base_m},
   "polls":    [{"ts", "walk", "device", "room", "x", "y", "floor",
                 "rssi": {scanner: dBm}, "live": {...}}]}
"""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

FORMAT = "padspan-walk"
VERSION = 1


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None   # NaN is "not given"


def _poll(raw: dict[str, Any], walk_default: str) -> dict[str, Any] | None:
    rssi = {}
    for src, v in (raw.get("rssi") or {}).items():
        f = _num(v)
        if f is not None:
            rssi[str(src)] = f
    p = {
        "ts": _num(raw.get("ts")),
        "walk": str(raw.get("walk") or walk_default),
        "device": str(raw.get("device") or ""),
        "room": str(raw.get("room") or ""),
        "x": _num(raw.get("x")),
        "y": _num(raw.get("y")),
        "floor": str(raw.get("floor") or ""),
        "rssi": rssi,
    }
    if p["x"] is None or p["y"] is None:
        p["x"] = p["y"] = None
    if isinstance(raw.get("live"), dict):
        p["live"] = raw["live"]
    return p


def _scanner(raw: dict[str, Any]) -> dict[str, Any]:
    x, y = _num(raw.get("x")), _num(raw.get("y"))
    return {"room": str(raw.get("room") or ""),
            "x": x if y is not None else None, "y": y if x is not None else None,
            "floor": str(raw.get("floor") or ""), "z": _num(raw.get("z"))}


def load(path: str | Path, scanners_csv: str | Path | None = None) -> dict[str, Any]:
    path = Path(path)
    if path.suffix.lower() == ".csv":
        return _load_csv(path, scanners_csv)
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") != FORMAT:
        raise ValueError(f"{path.name}: not a walk log (format must be {FORMAT!r})")
    if int(data.get("version") or 0) != VERSION:
        raise ValueError(f"{path.name}: walk log version {data.get('version')}, this reads {VERSION}")
    rooms = {}
    for name, r in (data.get("rooms") or {}).items():
        r = r or {}
        rooms[str(name)] = {"floor": str(r.get("floor") or ""),
                            "polygon": r.get("polygon") or None,
                            "centroid": r.get("centroid") or None}
    polls = [p for p in (_poll(r, path.stem) for r in data.get("polls") or []) if p]
    return {"scanners": {str(k): _scanner(v or {}) for k, v in (data.get("scanners") or {}).items()},
            "rooms": rooms,
            "floors": {str(k): float(v) for k, v in (data.get("floors") or {}).items()},
            "polls": polls}


_FIXED = ("ts", "walk", "device", "room", "x", "y", "floor")


def _load_csv(path: Path, scanners_csv: str | Path | None) -> dict[str, Any]:
    """Wide CSV: the fixed columns plus one `rssi:<scanner>` column per scanner
    (empty = not heard). Scanner rooms and positions come from scanners_csv
    (id,room,x,y,floor,z), without which only k-NN can be scored."""
    polls = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            raw = {k: row.get(k) for k in _FIXED}
            raw["rssi"] = {k[5:]: v for k, v in row.items() if k and k.startswith("rssi:")}
            p = _poll(raw, path.stem)
            if p:
                polls.append(p)
    scanners = {}
    if scanners_csv:
        with Path(scanners_csv).open(newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if row.get("id"):
                    scanners[str(row["id"])] = _scanner(row)
    return {"scanners": scanners, "rooms": {}, "floors": {}, "polls": polls}


def dump(log: dict[str, Any], path: str | Path) -> None:
    out = {"format": FORMAT, "version": VERSION,
           "scanners": log.get("scanners") or {}, "rooms": log.get("rooms") or {},
           "floors": log.get("floors") or {}, "polls": log.get("polls") or []}
    Path(path).write_text(json.dumps(out, indent=1), encoding="utf-8")
