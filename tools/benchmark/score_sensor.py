#!/usr/bin/env python3
"""Score any Home Assistant room sensor against a walk log.

    python tools/benchmark/score_sensor.py walk.json history.json --entity sensor.phone_area

The walk log says which room you were really in at each moment; the
history export says what the sensor (PadSpan's, Bermuda's, anything that
reports a room as its state) said. At each walk poll the sensor's last
state at or before that moment is its answer. Works with:

  - HA's REST history:  GET /api/history/period/<start>?filter_entity_id=<id>
    (a list of lists of {entity_id, state, last_changed}), saved as .json
  - the History panel's "Download data" CSV (entity_id,state,last_changed)

Room names are compared ignoring case, spaces vs underscores; --map renames
a sensor state first (--map "living_room=Lounge"). unknown, unavailable,
not_home and empty count as no answer. The walk log needs timestamps (epoch
seconds), and the sensor must have run on its own calibration, so this is a
"what you would have seen" score, not a held-out one.
"""

from __future__ import annotations

import argparse
import bisect
import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import walklog  # noqa: E402

NO_ANSWER = {"", "unknown", "unavailable", "not_home", "none", "away"}


def _norm(s: str) -> str:
    return " ".join(str(s or "").replace("_", " ").casefold().split())


def _epoch(v: Any) -> float:
    if isinstance(v, (int, float)):
        return float(v)
    d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def load_history(path: str | Path, entity: str) -> list[tuple[float, str]]:
    """(time, state) changes for one entity, oldest first."""
    path = Path(path)
    rows: list[dict[str, Any]] = []
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.DictReader(fh))
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
        for part in data if isinstance(data, list) else [data]:
            rows.extend(part if isinstance(part, list) else [part])
    out = []
    for r in rows:
        if not isinstance(r, dict) or (r.get("entity_id") and r["entity_id"] != entity):
            continue
        when = r.get("last_changed") or r.get("last_updated") or r.get("lu")
        if when is None:
            continue
        out.append((_epoch(when), str(r.get("state", r.get("s", "")))))
    out.sort(key=lambda t: t[0])
    return out


def score(log: dict[str, Any], history: list[tuple[float, str]],
          mapping: dict[str, str] | None = None) -> dict[str, Any]:
    mapping = {_norm(k): v for k, v in (mapping or {}).items()}
    times = [t for t, _s in history]
    right = labelled = answered = 0
    per_room: dict[str, list[int]] = {}
    wrong: dict[tuple[str, str], int] = {}
    for p in log["polls"]:
        if not p["room"] or p["ts"] is None:
            continue
        labelled += 1
        i = bisect.bisect_right(times, p["ts"]) - 1
        state = history[i][1] if i >= 0 else ""
        called = "" if _norm(state) in NO_ANSWER else _norm(mapping.get(_norm(state), state))
        pr = per_room.setdefault(p["room"], [0, 0])
        pr[0] += 1
        if called:
            answered += 1
        if called == _norm(p["room"]):
            right += 1
            pr[1] += 1
        else:
            key = (p["room"], state if called else "(no answer)")
            wrong[key] = wrong.get(key, 0) + 1
    return {
        "room_polls": labelled,
        "answered": answered,
        "rooms_right_pc": round(100.0 * right / labelled, 1) if labelled else None,
        "per_room": {r: {"polls": n, "right_pc": round(100.0 * k / n, 1)}
                     for r, (n, k) in sorted(per_room.items())},
        "confusions": [{"true": t, "called": c, "polls": n}
                       for (t, c), n in sorted(wrong.items(), key=lambda kv: -kv[1])[:10]],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("walk_log")
    ap.add_argument("history", help="HA history export (.json or .csv)")
    ap.add_argument("--entity", required=True)
    ap.add_argument("--scanners", help="scanners CSV, for a CSV walk log")
    ap.add_argument("--map", action="append", default=[], metavar="STATE=ROOM")
    a = ap.parse_args(argv)
    mapping = dict(m.split("=", 1) for m in a.map if "=" in m)
    res = score(walklog.load(a.walk_log, a.scanners), load_history(a.history, a.entity), mapping)
    rr = f"{res['rooms_right_pc']:.1f}%" if res["rooms_right_pc"] is not None else "-"
    print(f"{a.entity}: {rr} rooms right, answered {res['answered']}/{res['room_polls']} polls")
    for c in res["confusions"][:5]:
        print(f"  {c['true']} -> {c['called']}: {c['polls']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
