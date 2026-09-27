#!/usr/bin/env python3
"""Turn the telemetry JSONL files into the answers the reports exist for.

    python telemetry_summary.py /path/to/telemetry [--days 30]

Prints: installs by version / edition / tier / HA; environment distributions
(scanners, floors, rooms, lights, IRKs, integrations); which features are on
in how many installs; which tabs and tools are used and how much; how well
the Apple Find My (AirTag) tools follow tags, where they run; health
signals (crypto ok, callback alive, IRKs resolving anywhere, outside
attribution firing); and WARNING/ERROR counts by module across the fleet —
the "what is broken in houses I cannot see" list, sorted by installs affected.

The environment, switches and health are each install's last report (one
row per install per day, the last of the day winning). Usage and WARNING/ERROR
counts are summed over EVERY report: each accepted send takes the counters
with it, so a second send the same day ("Send a report now") carries only what
came after the first, and keeping one of the two lost the other's counts.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path


def load(dirpath: Path, days: int) -> tuple[dict[tuple[str, str], dict], list[dict]]:
    """(the last report per (install, day), every report)."""
    cutoff = date.today() - timedelta(days=days)
    rows: dict[tuple[str, str], dict] = {}
    reports: list[dict] = []
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
                reports.append(r)
    return rows, reports


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
    rows, reports = load(Path(a.dir), a.days)
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
    for r in reports:
        for k, v in (r.get("usage") or {}).items():
            usage[k] += int(v or 0)
    for r in latest.values():
        for k in (r.get("usage") or {}):
            usage_installs[k] += 1
    print("Usage (events over the window; installs that used it at all)")
    for k, v in usage.most_common(60):
        print(f"  {k:<36} {v:>7}  {usage_installs[k]:>4} installs")
    print()

    # Apple Find My tags (findmy.py): is following them on, would it matter,
    # and how well does it follow. The rate counts only the windows the
    # matcher had a real chance at — a link, one too close to call, one
    # reported late where the tag was — and takes back the links later
    # undone (a tag back on its day key undoes none). "Elsewhere" (another
    # device's change at that moment, or the tag carried off as it changed)
    # and "no candidate" (left range) are shown beside it. A report leaves
    # zeros out; with no `findmy` at all it is from before 0.38.81.
    fm: dict[str, Counter] = defaultdict(Counter)
    fm_live = fm_carried = fm_reporting = on_air = 0
    for r in latest.values():
        v = (r.get("env") or {}).get("findmy")
        if not isinstance(v, dict):
            continue
        fm_reporting += 1
        for part in ("on_air", "separated", "tracked"):
            for k, c in (v.get(part) or {}).items():
                fm[part][k] += int(c or 0)
        fm_live += int(v.get("tracked_live") or 0)
        fm_carried += int(v.get("tracked_carried") or 0)
        on_air += 1 if any(int(c or 0) for c in (v.get("on_air") or {}).values()) else 0
    bridging = sum(1 for r in latest.values() if (r.get("features") or {}).get("mac_rotation_bridging") is True)
    links, amb, late = usage["findmy_linked"], usage["findmy_missed_ambiguous"], usage["findmy_missed_late"]
    undone = usage["findmy_moved_back_addrs"] + usage["findmy_not_this_tag"]
    tried = links + amb + late
    print("Find My (AirTag) tools")
    print(f"  {'installs with bridging on':<36} {bridging:>7}  / {n}")
    print(f"  {'installs with Find My on the air':<36} {on_air:>7}  / {fm_reporting} that report it")
    print("  addresses on the air now: " + (", ".join(f"{k} {v} ({fm['separated'][k]} away from owner)"
                                                    for k, v in sorted(fm["on_air"].items()) if v) or "-"))
    print("  tags followed: " + (", ".join(f"{k} {v}" for k, v in sorted(fm["tracked"].items()) if v) or "none")
          + f"; {fm_live} on the air, {fm_carried} carried to a new address")
    print(f"  {'hand-overs followed (links)':<36} {links:>7}  ({usage['findmy_linked_slow']} took over 2 min)")
    print(f"  {'not followed: ambiguous':<36} {amb:>7}")
    print(f"  {'not followed: late, where it was':<36} {late:>7}")
    print(f"  {'not followed: new address elsewhere':<36} {usage['findmy_missed_elsewhere']:>7}  (not in the rate)")
    print(f"  {'not followed: no candidate':<36} {usage['findmy_missed_no_candidate']:>7}  (left range; not in the rate)")
    print(f"  {'wrong links undone by themselves':<36} {usage['findmy_moved_back']:>7}"
          f"  ({usage['findmy_moved_back_addrs']} links)")
    print(f"  {'wrong links undone by a person':<36} {usage['findmy_not_this_tag']:>7}")
    print(f"  {'back on the day key (expected)':<36} {usage['findmy_back_on_day_key']:>7}")
    rate = f"{100 * max(0, links - undone) // tried}%" if tried else "n/a"
    print(f"  {'follow rate':<36} {rate:>7}  (links - undone) / (links + ambiguous + late)")
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
    for r in reports:
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
