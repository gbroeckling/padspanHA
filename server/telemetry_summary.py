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
came after the first, and keeping one of the two lost the other's counts. The
installs beside them are the installs whose reports carried them, any report.
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
    usage_installs: dict[str, set] = defaultdict(set)
    for r in reports:
        for k, v in (r.get("usage") or {}).items():
            usage[k] += int(v or 0)
            usage_installs[k].add(r.get("install_id"))
    print("Usage (events over the window; installs that used it at all)")
    for k, v in [kv for kv in usage.most_common() if not kv[0].startswith(("ui_error", "weather_"))][:60]:
        print(f"  {k:<36} {v:>7}  {len(usage_installs[k]):>4} installs")
    print()

    # Atlas outdoor weather (views/atlas_weather.js, telemetry.py
    # WEATHER_EVENTS). Every name is counted once per page load, so the
    # numbers are page loads; the installs are those whose reports carried
    # it. Errors mean that page drew no weather (the map was unaffected);
    # the sources say whether the fallbacks work outside Canada.
    print("Atlas weather (page loads; installs)")
    any_wx = False
    for prefix, title in (("weather_error:", "errors, per kind (no weather drawn)"),
                          ("weather_shown:", "shown, per state"),
                          ("weather_source:", "decided by, per source")):
        rows = sorted(((k, v) for k, v in usage.items() if k.startswith(prefix)),
                      key=lambda kv: (-len(usage_installs[kv[0]]), -kv[1], kv[0]))
        if not rows:
            continue
        any_wx = True
        print(f"  {title}")
        for k, v in rows:
            print(f"    {k[len(prefix):]:<34} {v:>7}  {len(usage_installs[k]):>4} installs")
    if not any_wx:
        print("  none reported")
    print()

    # Uncaught panel errors (telemetry.py UI_ERRORS). A build that names the
    # module that threw always sends ui_error_while:<tab> beside it; a report
    # with ui_error:* and no ui_error_while:* is from a build that counted ANY
    # error on the page — Home Assistant's, other cards' — under the tab that
    # was open. Those are kept apart: they say nothing about PadSpan's code.
    by_mod: Counter = Counter()
    by_tab: Counter = Counter()
    by_old: Counter = Counter()
    ins: dict[str, set] = defaultdict(set)
    for r in reports:
        u = r.get("usage") or {}
        errs = {k: int(v or 0) for k, v in u.items() if k.startswith("ui_error")}
        if not errs:
            continue
        new_style = any(k.startswith("ui_error_while:") for k in errs)
        for k, v in errs.items():
            if k.startswith("ui_error_while:"):
                key, c = "while:" + k.split(":", 1)[1], by_tab
            elif new_style:
                key, c = "mod:" + k.split(":", 1)[1], by_mod
            else:
                key, c = "old:" + k.split(":", 1)[1], by_old
            c[key] += v
            ins[key].add(r.get("install_id"))
    if by_mod or by_old:
        print("Panel errors — PadSpan code on the stack, by the module that threw (installs)")
        for k, v in by_mod.most_common():
            print(f"  {k[4:]:<36} {v:>7}  {len(ins[k]):>4} installs")
        if by_tab:
            print("  ...the tab on screen when they did")
            for k, v in by_tab.most_common():
                print(f"    {k[6:]:<34} {v:>7}  {len(ins[k]):>4} installs")
        if by_old:
            print("  older builds: ANY error on the page, by the tab open (not necessarily PadSpan's)")
            for k, v in by_old.most_common():
                print(f"    {k[4:]:<34} {v:>7}  {len(ins[k]):>4} installs")
        print()

    # Apple Find My tags (findmy.py): is following them on, would it matter,
    # and how well does it follow. The rate counts only the hand-overs the
    # matcher had a real chance at — a right link, one too close to call,
    # one turned down by the timing rule where the tag was — so a link later
    # undone is taken out altogether (a wrong link, caught, was no hand-over
    # due; a tag back on its day key undoes none), and the share of links
    # undone is its own line. "Elsewhere" (another device's change at that
    # moment, or the tag carried off as it changed) and "no candidate" (left
    # range) are shown beside it. A report leaves zeros out; with no
    # `findmy` at all it is from before 0.38.81 — kept out of every line but
    # its own, so "none" and "0" are read against installs that could say.
    fm: dict[str, Counter] = defaultdict(Counter)
    fm_live = fm_carried = fm_reporting = on_air = bridging = 0
    older = older_bridging = 0
    for r in latest.values():
        v = (r.get("env") or {}).get("findmy")
        on = (r.get("features") or {}).get("mac_rotation_bridging") is True
        if not isinstance(v, dict):
            older += 1
            older_bridging += int(on)
            continue
        fm_reporting += 1
        bridging += int(on)
        for part in ("on_air", "separated", "tracked"):
            for k, c in (v.get(part) or {}).items():
                fm[part][k] += int(c or 0)
        fm_live += int(v.get("tracked_live") or 0)
        fm_carried += int(v.get("tracked_carried") or 0)
        on_air += 1 if any(int(c or 0) for c in (v.get("on_air") or {}).values()) else 0
    links, amb, late = usage["findmy_linked"], usage["findmy_missed_ambiguous"], usage["findmy_missed_late"]
    undone = usage["findmy_moved_back_addrs"] + usage["findmy_not_this_tag"]
    right = max(0, links - undone)
    tried = right + amb + late
    print("Find My (AirTag) tools")
    print(f"  {'installs with bridging on':<36} {bridging:>7}  / {fm_reporting} that report Find My")
    print(f"  {'installs from before Find My reports':<36} {older:>7}  ({older_bridging} with bridging on)")
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
    rate = f"{100 * right // tried}%" if tried else "n/a"
    print(f"  {'follow rate':<36} {rate:>7}  (links - undone) / (links - undone + ambiguous + late)")
    wrong = f"{100 * undone // links}%" if links else "n/a"
    print(f"  {'wrong links (undone) per link':<36} {wrong:>7}  undone / links")
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
    err_installs: dict[str, set] = defaultdict(set)
    for r in reports:
        for k, v in (r.get("errors") or {}).items():
            err[k] += int(v or 0)
            err_installs[k].add(r.get("install_id"))
    print("WARNING/ERROR by module (lines over the window; installs affected) — the fix list")
    for k, v in sorted(err.items(), key=lambda kv: (-len(err_installs[kv[0]]), -kv[1])):
        print(f"  {k:<40} {v:>7}  {len(err_installs[k]):>4} installs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
