#!/usr/bin/env python3
"""Turn the telemetry JSONL files into the answers the reports exist for.

    python telemetry_summary.py /path/to/telemetry [--days 30]

Prints: installs by version / edition / tier / HA; environment distributions
(scanners, floors, rooms, lights, IRKs, integrations); which features are on
in how many installs; which tabs and tools are used and how much; how well
the Apple Find My (AirTag) tools follow tags, where they run; load and
hardware (installs by board / CPUs / RAM, and per class how hard Home
Assistant works and how many installs max out — Raspberry Pi classes
first); health signals (crypto ok, callback alive, IRKs resolving anywhere,
outside attribution firing); and WARNING/ERROR counts by module across the fleet —
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


# env fields shown as a distribution, with their bucket edges.
_ENV_BUCKETS = (("scanners", [1, 2, 4, 8, 16, 32]), ("floors", [1, 2, 3, 5]), ("rooms", [3, 6, 12, 24, 48]),
                ("placed_lights", [0, 5, 20, 60]), ("walls", [0, 5, 20]), ("irks", [0, 1, 3]),
                ("calibration_points", [0, 20, 100, 500]), ("objects_total", [10, 50, 200, 1000, 5000]))


def _well_formed(r) -> bool:
    """The shapes this summary reads. The receiver checks top-level keys, not
    types, so a stored report is untrusted input: one that is not what
    PadSpan sends is skipped rather than taking the whole summary down."""
    if not isinstance(r, dict):
        return False
    if not all(isinstance(r.get(k) or {}, dict) for k in ("env", "features", "usage", "health", "errors")):
        return False
    env, health = r.get("env") or {}, r.get("health") or {}
    num = (int, float)
    findmy = env.get("findmy") or {}
    return (all(isinstance(v, num) for k in ("usage", "errors") for v in (r.get(k) or {}).values())
            and all(isinstance(env.get(k) or 0, num) for k, _ in _ENV_BUCKETS)
            and all(isinstance(env.get(k) or {}, dict) for k in ("integrations", "hw", "findmy"))
            and all(isinstance(findmy.get(k) or {}, dict)
                    and all(isinstance(c, num) for c in (findmy.get(k) or {}).values())
                    for k in ("on_air", "separated", "tracked"))
            and all(isinstance(findmy.get(k) or 0, num) for k in ("tracked_live", "tracked_carried"))
            and isinstance(health.get("perf") or {}, dict))


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
            r = rec.get("report") if isinstance(rec, dict) else None
            if not _well_formed(r):
                continue
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


# env.hw.board values that are a Raspberry Pi (Yellow carries a Compute
# Module) — the class the load section exists to watch for max-outs.
_PI_BOARDS = frozenset({"rpi2", "rpi3", "rpi4", "rpi5", "rpi_other", "yellow"})
# health.perf.over keys, as the section prints them (telemetry.PERF_OVER).
_OVER_LABELS = (("load", "load > 1/CPU"), ("cpu", "HA > 90% core"), ("mem", "mem < 10% free"),
                ("lag", "loop lag > 1 s"))


def _perf_stat(r: dict, metric: str, stat: str) -> float | None:
    perf = (r.get("health") or {}).get("perf")
    m = perf.get(metric) if isinstance(perf, dict) else None
    v = m.get(stat) if isinstance(m, dict) else None
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _perf_samples(r: dict) -> int:
    perf = (r.get("health") or {}).get("perf")
    try:
        return int(perf.get("samples") or 0) if isinstance(perf, dict) else -1
    except (TypeError, ValueError):
        return 0


def _spread(vals: list[float]) -> str:
    """Across install-days: median, 90th percentile, max."""
    if not vals:
        return "not reported"
    s = sorted(vals)
    med = s[(len(s) - 1) // 2]
    p90 = s[max(0, -(-9 * len(s) // 10) - 1)]
    return f"median {med:<6g} p90 {p90:<6g} max {s[-1]:<6g} ({len(s)} install-days)"


def load_section(latest: dict[str, dict], reports: list[dict]) -> list[str]:
    """Load and hardware (env.hw / health.perf): which machines PadSpan runs
    on, and how hard each class of them works — Raspberry Pi classes first,
    marked [Pi], because a feature that costs nothing on a VM can max a
    board out. Per class: the spread over install-days of each day's p95,
    and how many installs hit each max-out limit at all in the window.
    An install whose last report has no env.hw is from before these fields
    and counted as "not reported", never as an idle machine."""
    out = ["Load and hardware (env.hw / health.perf)"]
    cls_of: dict[str, str] = {}
    pi: set[str] = set()
    by: dict[str, Counter] = {k: Counter() for k in ("board", "install", "arch", "cpus", "ram")}
    for iid, r in latest.items():
        hw = (r.get("env") or {}).get("hw")
        if not isinstance(hw, dict):
            continue
        for k in by:
            by[k][str(hw.get(k, "unknown"))] += 1
        # str(): a report is untrusted input — a list here must not crash the summary.
        cls = f"{str(hw.get('board', 'unknown'))} / {str(hw.get('cpus', '?'))} cpu / {str(hw.get('ram', 'unknown'))} RAM"
        cls_of[iid] = cls
        if str(hw.get("board")) in _PI_BOARDS:
            pi.add(cls)
    n = len(latest)
    out.append(f"  {'installs reporting hardware':<36} {len(cls_of):>7}  / {n}"
               f"  ({n - len(cls_of)} not reported: older builds)")
    if not cls_of:
        return out
    for k, title in (("board", "board"), ("install", "installation"), ("arch", "arch"), ("cpus", "CPUs"),
                     ("ram", "RAM (up to)")):
        out.append(f"  by {title}: " + ", ".join(
            f"{'[Pi] ' if k == 'board' and v in _PI_BOARDS else ''}{v} {c}" for v, c in by[k].most_common()))
    # One report per install-day — the one that covered most of the day (a
    # second "Send a report now" the same day carries only minutes) — and,
    # over every report, which installs hit a limit at all.
    best: dict[tuple[str, str], dict] = {}
    hit: dict[str, dict[str, set]] = defaultdict(lambda: defaultdict(set))
    for r in reports:
        iid = r.get("install_id")
        if iid not in cls_of or _perf_samples(r) < 0:
            continue
        key = (iid, str(r.get("day") or ""))
        if key not in best or _perf_samples(r) > _perf_samples(best[key]):
            best[key] = r
        over = ((r.get("health") or {}).get("perf") or {}).get("over")
        for k, c in (over.items() if isinstance(over, dict) else ()):
            if isinstance(c, (int, float)) and c > 0:
                hit[cls_of[iid]][k].add(iid)
    days: dict[str, list[dict]] = defaultdict(list)
    for (iid, _day), r in best.items():
        days[cls_of[iid]].append(r)
    installs = Counter(cls_of.values())
    for cls in sorted(installs, key=lambda c: (c not in pi, -installs[c], c)):
        out.append(f"  {'[Pi] ' if cls in pi else ''}{cls}: {installs[cls]} installs")
        rs = days.get(cls) or []
        for metric, label in (("cpu_pc", "HA CPU p95 (% of one core)"), ("load_pc", "load per CPU p95 (%)"),
                              ("lag_ms", "loop lag p95 (ms)"), ("snap_ms", "snapshot build p95 (ms)")):
            vals = [v for v in (_perf_stat(r, metric, "p95") for r in rs) if v is not None]
            out.append(f"      {label:<30} {_spread(vals)}")
        out.append("      max-outs (installs that hit it): " + ", ".join(
            f"{lbl} {len(hit[cls].get(k, ()))}/{installs[cls]}" for k, lbl in _OVER_LABELS))
    return out


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
    for k, edges in _ENV_BUCKETS:
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
    for k, v in [kv for kv in usage.most_common() if not kv[0].startswith("ui_error")][:60]:
        print(f"  {k:<36} {v:>7}  {len(usage_installs[k]):>4} installs")
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

    for line in load_section(latest, reports):
        print(line)
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
