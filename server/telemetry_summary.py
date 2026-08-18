#!/usr/bin/env python3
"""Turn the telemetry JSONL files into the answers the reports exist for.

    python telemetry_summary.py /path/to/telemetry [--days 30]

Prints: installs by version / edition / tier / HA; environment distributions
(scanners, floors, rooms, lights, IRKs, integrations); which features are on
in how many installs; which tabs and tools are used and how much; health
signals (crypto ok, callback alive, IRKs resolving anywhere, outside
attribution firing); and WARNING/ERROR counts by module across the fleet —
the "what is broken in houses I cannot see" list, sorted by installs affected.

One row per install per day is kept (the last report of the day wins).
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path


def load(dirpath: Path, days: int) -> dict[tuple[str, str], dict]:
    cutoff = date.today() - timedelta(days=days)
    rows: dict[tuple[str, str], dict] = {}
    for f in sorted(dirpath.glob("*.jsonl")):
        try:
            d = date.fromisoformat(f.stem)
        except ValueError:
            continue
        if d < cutoff:
            continue
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            r = rec.get("report") or {}
            iid = r.get("install_id")
            if iid:
                rows[(iid, rec.get("recv_day", f.stem))] = r
    return rows


def _bucket(v: int, edges: list[int]) -> str:
    for e in edges:
        if v <= e:
            return f"<= {e}"
    return f"> {edges[-1]}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--days", type=int, default=30)
    a = ap.parse_args()
    rows = load(Path(a.dir), a.days)
    if not rows:
        print("no reports")
        return 0
    latest: dict[str, dict] = {}
    for (iid, _day), r in sorted(rows.items(), key=lambda kv: kv[0][1]):
        latest[iid] = r
    n = len(latest)
    print(f"{n} installs, {len(rows)} install-days, last {a.days} days\n")

    def dist(title, key):
        c = Counter(key(r) for r in latest.values())
        print(title)
        for k, v in c.most_common():
            print(f"  {str(k):<28} {v:>4}")
        print()

    dist("Versions", lambda r: r.get("version"))
    dist("Edition / tier", lambda r: f"{r.get('edition')}/{r.get('tier')}")
    dist("Home Assistant", lambda r: r.get("ha_version"))
    for k, edges in [("scanners", [1, 2, 4, 8, 16, 32]), ("floors", [1, 2, 3, 5]), ("rooms", [3, 6, 12, 24, 48]),
                     ("placed_lights", [0, 5, 20, 60]), ("walls", [0, 5, 20]), ("irks", [0, 1, 3]),
                     ("calibration_points", [0, 20, 100, 500]), ("objects_total", [10, 50, 200, 1000, 5000])]:
        dist(f"env.{k}", lambda r, k=k, edges=edges: _bucket(int((r.get("env") or {}).get(k) or 0), edges))

    integ: Counter = Counter()
    for r in latest.values():
        for name, cnt in ((r.get("env") or {}).get("integrations") or {}).items():
            if cnt:
                integ[name] += 1
    print("Integrations present (installs)")
    for k, v in integ.most_common():
        print(f"  {k:<28} {v:>4}")
    print()

    feat: Counter = Counter()
    enums: dict[str, Counter] = defaultdict(Counter)
    for r in latest.values():
        for k, v in (r.get("features") or {}).items():
            if v is True:
                feat[k] += 1
            elif isinstance(v, str):
                enums[k][v] += 1
    print("Feature switches ON (installs)")
    for k, v in feat.most_common():
        print(f"  {k:<36} {v:>4}  ({100 * v // n}%)")
    for k, c in enums.items():
        print(f"  {k}: " + ", ".join(f"{a}={b}" for a, b in c.most_common()))
    print()

    usage: Counter = Counter()
    usage_installs: Counter = Counter()
    for r in rows.values():
        for k, v in (r.get("usage") or {}).items():
            usage[k] += int(v or 0)
    for r in latest.values():
        for k in (r.get("usage") or {}):
            usage_installs[k] += 1
    print("Usage (events over the window; installs that used it at all)")
    for k, v in usage.most_common(60):
        print(f"  {k:<36} {v:>7}  {usage_installs[k]:>4} installs")
    print()

    h: dict[str, int] = defaultdict(int)
    for r in latest.values():
        for k, v in (r.get("health") or {}).items():
            if isinstance(v, bool):
                h[k] += 1 if v else 0
            elif isinstance(v, (int, float)) and v:
                h[k + "(>0)"] += 1
    print("Health (installs where true / >0)")
    for k in sorted(h):
        print(f"  {k:<28} {h[k]:>4} / {n}")
    print()

    err: Counter = Counter()
    err_installs: Counter = Counter()
    for r in rows.values():
        for k, v in (r.get("errors") or {}).items():
            err[k] += int(v or 0)
    for r in latest.values():
        for k in (r.get("errors") or {}):
            err_installs[k] += 1
    print("WARNING/ERROR by module (lines over the window; installs affected) — the fix list")
    for k, v in sorted(err.items(), key=lambda kv: (-err_installs[kv[0]], -kv[1])):
        print(f"  {k:<40} {v:>7}  {err_installs[k]:>4} installs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
