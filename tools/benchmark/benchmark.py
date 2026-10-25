#!/usr/bin/env python3
"""Score PadSpan's positioning on a recorded walk, the honest way.

    python tools/benchmark/benchmark.py walk.json [--group-by walk|visit|position]

Every poll is tested only against fingerprints from OTHER groups: other
walks, other visits, or (position) other visits with every poll within
1.5 m of the tested spots also held out. Readings are never split at
random: neighbouring polls share most of their radio conditions, and a
random split scores a copy of the answer (k-NN 0.0 m median on a row split,
9.4 m with whole positions held out, in the published shop-floor study).

Methods, all PadSpan's own code (loaded from custom_components/padspan_ha):

  knn      CalibrationStore.knn_locate over the held-in polls, picked the same
           way heldout.evaluate picks them (heldout._Fingerprints).
  spatial  heldout.SpatialSite: the path-loss solve, with each scanner's
           path-loss fit redone from the held-in polls. Needs scanner x/y.
  nearest  the room of the scanner that hears the device loudest
           (heldout._strongest_area); its position for metre error.
  live     what PadSpan itself said at the time, when the log carries it
           (from_capture.py). Not held out: it ran on the calibration the
           house had, so read it as "the live system", not as a fair split.

Each poll is scored on its own, without PadSpan's room smoothing over time.
See docs/BENCHMARK.md for the file format and how to read the numbers.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import padspan_import  # noqa: E402
import walklog  # noqa: E402

METHODS = ("knn", "spatial", "nearest", "live")
GROUPINGS = ("walk", "visit", "position")


# ── groups ────────────────────────────────────────────────────────────────────

def visits(polls: list[dict[str, Any]]) -> list[int]:
    """A visit number per poll: a run of one device's polls in one walk in
    the same true room. Polls are taken in file order."""
    out = [0] * len(polls)
    last: dict[tuple[str, str], tuple] = {}
    n = 0
    for i, p in enumerate(polls):
        key = (p["walk"], p["device"])
        mark = (p["room"], p["floor"])
        if last.get(key, (None,))[0] != mark:
            n += 1
            last[key] = (mark, n)
        out[i] = last[key][1]
    return out


def settling(polls: list[dict[str, Any]], visit: list[int], settle_s: float) -> set[int]:
    """Polls in the first settle_s seconds of a visit: the walker may still be
    in the doorway, so the label is not yet true. Left out of training and
    testing alike. Needs timestamps."""
    if settle_s <= 0:
        return set()
    start: dict[int, float] = {}
    out = set()
    for i, p in enumerate(polls):
        if p["ts"] is None:
            continue
        t0 = start.setdefault(visit[i], p["ts"])
        if p["ts"] - t0 < settle_s:
            out.add(i)
    return out


def folds(polls: list[dict[str, Any]], group_by: str, *, radius_m: float,
          train_walks: set[str] | None = None,
          dropped: set[int] = frozenset()) -> list[tuple[list[int], set[int]]]:
    """(test polls, held-out polls) per fold. The held-out set is always the
    test polls themselves plus whatever must not answer for them."""
    visit = visits(polls)
    usable = [i for i, p in enumerate(polls) if p["rssi"] and i not in dropped]
    if train_walks:
        test = [i for i in usable if polls[i]["walk"] not in train_walks]
        held = set(test) | set(dropped)
        return [(test, held)] if test else []
    groups: dict[Any, list[int]] = {}
    for i in usable:
        key = polls[i]["walk"] if group_by == "walk" else visit[i]
        groups.setdefault(key, []).append(i)
    out = []
    for key in groups:
        test = groups[key]
        held = set(test) | set(dropped)
        if group_by == "position":
            r_sq = radius_m * radius_m
            spots = {(polls[i]["floor"], polls[i]["x"], polls[i]["y"]) for i in test
                     if polls[i]["x"] is not None}
            for j, q in enumerate(polls):
                if q["x"] is None or j in held:
                    continue
                for fl, sx, sy in spots:
                    if q["floor"] == fl and (q["x"] - sx) ** 2 + (q["y"] - sy) ** 2 <= r_sq:
                        held.add(j)
                        break
        out.append((test, held))
    return out


# ── rooms from a position ─────────────────────────────────────────────────────

class Rooms:
    def __init__(self, rooms: dict[str, dict[str, Any]], point_in_poly) -> None:
        self.polys = [(n, r["floor"], r["polygon"]) for n, r in rooms.items()
                      if r.get("polygon") and len(r["polygon"]) >= 3]
        self.cents = [(n, r["floor"], r["centroid"]) for n, r in rooms.items()
                      if r.get("centroid")]
        self._pip = point_in_poly

    def by_polygon(self, x: float, y: float, floor: str) -> str:
        for name, fl, poly in self.polys:
            if (not fl or not floor or fl == floor) and self._pip(x, y, poly):
                return name
        return ""

    def by_centroid(self, x: float, y: float, floor: str) -> str:
        best = None
        for name, fl, (cx, cy) in self.cents:
            if fl and floor and fl != floor:
                continue
            d = (x - cx) ** 2 + (y - cy) ** 2
            if best is None or d < best[0]:
                best = (d, name)
        return best[1] if best else ""


# ── scoring ───────────────────────────────────────────────────────────────────

def _summary(rows: list[tuple[str, str, float | None]]) -> dict[str, Any]:
    """rows: (true room, called room, metre error or None, walk)."""
    labelled = [(t, c) for t, c, _e, _w in rows if t]
    right = sum(1 for t, c in labelled if t == c)
    errs = sorted(e for _t, _c, e, _w in rows if e is not None)
    per_walk: dict[str, list[int]] = {}
    for t, c, _e, w in rows:
        if t:
            pw = per_walk.setdefault(w, [0, 0])
            pw[0] += 1
            pw[1] += t == c
    per_room: dict[str, list[int]] = {}
    conf = Counter()
    for t, c in labelled:
        pr = per_room.setdefault(t, [0, 0])
        pr[0] += 1
        if t == c:
            pr[1] += 1
        else:
            conf[(t, c or "(no answer)")] += 1
    return {
        "tested": len(rows),
        "room_polls": len(labelled),
        "rooms_right_pc": round(100.0 * right / len(labelled), 1) if labelled else None,
        "answered": sum(1 for _t, c in labelled if c),
        "position_polls": len(errs),
        "median_error_m": round(errs[len(errs) // 2], 2) if errs else None,
        "p75_error_m": round(errs[(3 * len(errs)) // 4], 2) if errs else None,
        "per_room": {r: {"polls": n, "right_pc": round(100.0 * k / n, 1)}
                     for r, (n, k) in sorted(per_room.items())},
        "per_walk": {w: {"polls": n, "right_pc": round(100.0 * k / n, 1)}
                     for w, (n, k) in sorted(per_walk.items())},
        "confusions": [{"true": t, "called": c, "polls": n}
                       for (t, c), n in conf.most_common(10)],
    }


def run(log: dict[str, Any], *, group_by: str | None = None, radius_m: float | None = None,
        settle_s: float = 0.0, train_walks: set[str] | None = None,
        methods: tuple[str, ...] = METHODS) -> dict[str, Any]:
    heldout = padspan_import.module("heldout")
    cal = padspan_import.module("calibration_store")
    const = padspan_import.module("const")
    rules = padspan_import.module("presence_rules")
    CalibrationStore, KNN_K = cal.CalibrationStore, cal.KNN_K
    radius_m = heldout.HELDOUT_RADIUS_M if radius_m is None else radius_m

    polls = [walklog._poll(p, "walk") for p in log["polls"]]
    scanners = {s: walklog._scanner(sc) for s, sc in (log.get("scanners") or {}).items()}
    walks = sorted({p["walk"] for p in polls})
    if group_by is None:
        group_by = "walk" if len(walks) >= 2 else "visit"
    if group_by not in GROUPINGS:
        raise ValueError(f"group_by must be one of {GROUPINGS}")
    has_xy = all(p["x"] is not None for p in polls) and bool(polls)
    if group_by == "position" and not any(p["x"] is not None for p in polls):
        raise ValueError("position grouping needs x/y on the polls")

    visit = visits(polls)
    dropped = settling(polls, visit, settle_s)
    plan = folds(polls, group_by, radius_m=radius_m, train_walks=train_walks, dropped=dropped)

    # Every poll as a calibration point, the shape knn_locate reads.
    pts = [{"x_m": p["x"] if p["x"] is not None else 0.0,
            "y_m": p["y"] if p["y"] is not None else 0.0,
            "floor_id": p["floor"], "room": p["room"],
            "scanner_readings": [{"source": s, "mean_rssi": v} for s, v in p["rssi"].items()]}
           for p in polls]
    fps = [CalibrationStore._readings_to_map(pt, frozenset()) for pt in pts]
    prints = heldout._Fingerprints(fps)
    rooms = Rooms(log.get("rooms") or {}, rules._point_in_poly)
    source_area = {s: sc["room"] for s, sc in scanners.items() if sc["room"]}
    positions = {s: (sc["x"], sc["y"], sc["floor"]) for s, sc in scanners.items()
                 if sc["x"] is not None}

    site = None
    xy_idx: list[int] = []
    if "spatial" in methods and len(positions) >= 3:
        site = heldout.SpatialSite(
            positions=positions, fit_sources=set(positions),
            ref=const.DEFAULT_REF_POWER, n_exp=const.DEFAULT_PATH_LOSS_EXP,
            abs_z={s: sc["z"] for s, sc in scanners.items() if sc["z"] is not None},
            floor_bases=log.get("floors") or {})
        xy_idx = [i for i, p in enumerate(polls) if p["x"] is not None]
        terms = site.fit_terms([pts[i] for i in xy_idx], frozenset())
        to_xy = {i: n for n, i in enumerate(xy_idx)}

    rows: dict[str, list] = {m: [] for m in methods}
    trained = 0
    for test, held in plan:
        if not any(j not in held for j in range(len(pts))):
            continue
        trained += 1
        fits = site.fits_without(terms, {to_xy[j] for j in held if j in to_xy}) if site else None
        for i in test:
            p = polls[i]
            q = fps[i]
            truth_xy = (p["x"], p["y"]) if p["x"] is not None else None

            def err(xy):
                return math.hypot(xy[0] - truth_xy[0], xy[1] - truth_xy[1]) \
                    if xy and truth_xy else None

            if "knn" in rows:
                cand = prints.nearest(q, held, KNN_K + heldout._KNN_SPARE)
                k = CalibrationStore.knn_locate(
                    heldout._HeldIn([pts[j] for j in cand], frozenset()), q) if cand else None
                if k:
                    kxy = (float(k["x_m"]), float(k["y_m"]))
                    room = rooms.by_polygon(*kxy, str(k.get("floor_id") or "")) \
                        or str(k.get("nearest_room") or "")
                    # A k-NN position is only a position if every poll it
                    # could have drawn on had one.
                    rows["knn"].append((p["room"], room, err(kxy) if has_xy else None, p["walk"]))
                else:
                    rows["knn"].append((p["room"], "", None, p["walk"]))

            if "spatial" in rows and site is not None:
                floor = p["floor"] or _strongest_floor(q, positions)
                fix = site.locate(q, floor, fits)
                room = ""
                if fix:
                    room = rooms.by_polygon(*fix, floor) or rooms.by_centroid(*fix, floor) \
                        or heldout._strongest_area(q, source_area)
                rows["spatial"].append((p["room"], room, err(fix), p["walk"]))

            if "nearest" in rows:
                room = heldout._strongest_area(q, source_area)
                loud = max((s for s in q if s in positions), key=lambda s: q[s], default=None)
                rows["nearest"].append((p["room"], room,
                                        err(positions[loud][:2]) if loud else None, p["walk"]))

            if "live" in rows and p.get("live"):
                lv = p["live"]
                lxy = (float(lv["x"]), float(lv["y"])) \
                    if lv.get("x") is not None and lv.get("y") is not None else None
                rows["live"].append((p["room"], str(lv.get("room") or ""), err(lxy), p["walk"]))

    results = {m: _summary(r) for m, r in rows.items() if r}
    return {
        "grouping": "train-walks" if train_walks else group_by,
        "train_walks": sorted(train_walks) if train_walks else None,
        "radius_m": radius_m if group_by == "position" else None,
        "settle_s": settle_s,
        "folds": trained,
        "walks": len(walks),
        "visits": len(set(visit)),
        "devices": len({p["device"] for p in polls}),
        "polls": len(polls),
        "settling_dropped": len(dropped),
        "scanners": len(scanners),
        "positioned_scanners": len(positions),
        "methods": results,
        "skipped": [m for m in methods if m not in results],
    }


def _strongest_floor(q: dict[str, float], positions: dict[str, tuple]) -> str:
    loud = max((s for s in q if s in positions), key=lambda s: q[s], default=None)
    return positions[loud][2] if loud else ""


_NAMES = {"knn": "PadSpan k-NN", "spatial": "PadSpan spatial",
          "nearest": "Nearest scanner", "live": "PadSpan live (as recorded)"}


def report(res: dict[str, Any]) -> str:
    lines = [
        f"Grouping: {res['grouping']}  ({res['folds']} folds; {res['walks']} walks, "
        f"{res['visits']} visits, {res['devices']} devices, {res['polls']} polls"
        + (f", {res['settling_dropped']} settling polls left out" if res["settling_dropped"] else "")
        + ")",
        "",
        f"{'method':<28}{'rooms right':>12}{'answered':>10}{'median m':>10}{'p75 m':>8}",
    ]
    for m, s in res["methods"].items():
        rr = f"{s['rooms_right_pc']:.1f}%" if s["rooms_right_pc"] is not None else "-"
        ans = f"{s['answered']}/{s['room_polls']}"
        med = f"{s['median_error_m']:.2f}" if s["median_error_m"] is not None else "-"
        p75 = f"{s['p75_error_m']:.2f}" if s["p75_error_m"] is not None else "-"
        lines.append(f"{_NAMES[m]:<28}{rr:>12}{ans:>10}{med:>10}{p75:>8}")
    if res["skipped"]:
        lines.append(f"(not scored: {', '.join(res['skipped'])} - see docs/BENCHMARK.md)")
    for m, s in res["methods"].items():
        if s["confusions"]:
            lines.append("")
            lines.append(f"{_NAMES[m]}, most common wrong calls:")
            for c in s["confusions"][:5]:
                lines.append(f"  {c['true']} -> {c['called']}: {c['polls']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("walk_log", nargs="+", help="walk log(s): .json, or .csv with --scanners")
    ap.add_argument("--scanners", help="scanners CSV (id,room,x,y,floor,z) for a CSV walk log")
    ap.add_argument("--group-by", choices=GROUPINGS,
                    help="hold out whole walks (default with 2+ walks), visits, or positions")
    ap.add_argument("--train-walk", action="append", default=[],
                    help="train only on this walk and test on the rest (repeatable)")
    ap.add_argument("--radius", type=float, help="position grouping radius in metres (1.5)")
    ap.add_argument("--settle", type=float, default=0.0,
                    help="leave out the first N seconds of every visit")
    ap.add_argument("--json", help="also write the full results here")
    a = ap.parse_args(argv)

    log: dict[str, Any] = {"scanners": {}, "rooms": {}, "floors": {}, "polls": []}
    for f in a.walk_log:
        one = walklog.load(f, a.scanners)
        for k in ("scanners", "rooms", "floors"):
            log[k].update(one[k])
        log["polls"].extend(one["polls"])
    res = run(log, group_by=a.group_by, radius_m=a.radius, settle_s=a.settle,
              train_walks=set(a.train_walk) or None)
    print(report(res))
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
