"""Merge the crawl's per-page results (out/jobs/*.json) into results.json and results.md."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ORDER = {"stuck": 1, "error": 2, "junk": 3, "polish": 4}
TITLES = {"stuck": "Stuck or lost", "error": "Errors", "junk": "Visible junk", "polish": "Polish"}


def _merge_findings(results):
    """One row per distinct finding, with every page and size it was seen on."""
    rows = {}
    for r in results:
        for f in r["findings"]:
            key = (f["kind"], f["what"], str(f["key"][2]))
            row = rows.get(key)
            if row is None:
                rows[key] = row = dict(f, seen=[], count=0)
            row["seen"].append(f"{f['view']}/{f['size']}/{f['skin']}")
            row["count"] += f["count"]
            if not row["shot"] and f["shot"]:
                row["shot"] = f["shot"]
    out = sorted(rows.values(), key=lambda f: (ORDER[f["kind"]], f["what"], -f["count"]))
    for f in out:
        f.pop("key", None)
    return out


def _demo_gaps(results):
    """Message types the fake Home Assistant answered with nothing ({}) or refused, and where."""
    gaps = defaultdict(lambda: {"empty": 0, "rejected": 0, "views": set(), "sample": ""})
    for r in results:
        for w in r.get("ws", []):
            ans = str(w.get("answer", ""))
            if w.get("empty") or ans.startswith("rejected"):
                g = gaps[w["type"]]
                g["empty" if w.get("empty") else "rejected"] += 1
                g["views"].add(r["job"]["view"])
                if ans.startswith("rejected") and not g["sample"]:
                    g["sample"] = ans[:160]
    return {k: dict(v, views=sorted(v["views"])) for k, v in sorted(gaps.items())}


def write_report(out: Path, jobs, seconds: float, args) -> None:
    results = []
    for j in jobs:
        f = out / "jobs" / f"{j['id']}.json"
        if f.exists():
            results.append(json.loads(f.read_text(encoding="utf-8")))
    findings = _merge_findings(results)
    gaps = _demo_gaps(results)
    actions = sum(r["actions"] for r in results)
    controls = sum(len({c.get("sig", c["label"]) for c in r["controls"]}) for r in results)
    outcomes = Counter(c["outcome"].split(":")[0] for r in results for c in r["controls"])
    unreached = [(r["job"]["id"], c["label"], c["outcome"]) for r in results for c in r["controls"]
                 if c["outcome"] not in ("ok", "nothing to do", "disabled")]
    crashes = [(r["job"]["id"], r["crash"]) for r in results if r.get("crash")]
    summary = {"pages": len(results), "pages_planned": len(jobs), "controls": controls, "actions": actions,
               "reloads": sum(r["reloads"] for r in results), "states": sum(r["states"] for r in results),
               "repeats_skipped": sum(r.get("repeats_skipped", 0) for r in results),
               "minutes": round(seconds / 60, 1), "depth": args.depth, "workers": args.workers,
               "outcomes": dict(outcomes), "unvisited_states": sum(r.get("unvisited_states", 0) for r in results)}
    (out / "results.json").write_text(json.dumps({"summary": summary, "findings": findings, "demo_gaps": gaps,
                                                  "crashes": crashes, "pages": results}, indent=1, default=list), encoding="utf-8")
    L = [f"# Click-through results", "",
         f"{summary['pages']} pages ({summary['pages_planned']} planned), {controls} controls, {actions} actions, "
         f"{summary['states']} states, {summary['reloads']} reloads, {summary['minutes']} min "
         f"(depth {args.depth}, {args.workers} browsers). States queued but not visited for lack of time: {summary['unvisited_states']}. "
         f"Repeats of a row's control not pressed (the first {getattr(args, 'repeats', 2)} were): {summary['repeats_skipped']}.", "",
         "Outcomes: " + ", ".join(f"{k} {v}" for k, v in outcomes.most_common()), ""]
    for kind in ORDER:
        rows = [f for f in findings if f["kind"] == kind]
        if not rows:
            continue
        L += [f"## {TITLES[kind]} ({len(rows)})", ""]
        for f in rows:
            where = sorted(set(f["seen"]))
            L.append(f"- **{f['what']}** ×{f['count']} on {', '.join(where[:6])}{' …' if len(where) > 6 else ''}")
            L.append(f"  - {str(f['detail'])[:300]}")
            if f.get("where"):
                L.append(f"  - at {f['where'][:200]}")
            if f["steps"]:
                L.append("  - steps: " + " ⟶ ".join(f["steps"])[:400])
            if f["shot"]:
                L.append(f"  - shot: {f['shot']}")
        L.append("")
    L += ["## Demo gaps (the fake answered nothing or refused)", ""]
    for t, g in gaps.items():
        L.append(f"- `{t}`: empty {g['empty']}, refused {g['rejected']} on {', '.join(g['views'][:8])} {g['sample']}")
    L += ["", "## Not pressed (and why)", ""]
    why = Counter(o.split(" ")[0] if not o.startswith("covered") else "covered" for _, _, o in unreached)
    L.append(", ".join(f"{k} {v}" for k, v in why.most_common()))
    for jid, label, o in unreached[:300]:
        L.append(f"- {jid}: {label!r}: {o}")
    if crashes:
        L += ["", "## Crawler crashes", ""]
        for jid, tb in crashes:
            L += [f"- {jid}", "```", tb, "```"]
    L += ["", "## Every control used", ""]
    for r in results:
        L.append(f"### {r['job']['id']} ({r['actions']} actions, {r['took_s']} s, load {r['load_s']} s)")
        for c in r["controls"]:
            st = " › ".join(c.get("state", []))
            notes = "; ".join(c.get("notes") or [])
            L.append(f"- {('[' + st + '] ') if st else ''}{c['label']!r} ({c['kind']}, {c['region']}): {c['what']} → {c['outcome']}{(' — ' + notes) if notes else ''}")
        L.append("")
    (out / "results.md").write_text("\n".join(L), encoding="utf-8")
    print(f"{summary['pages']} pages, {controls} controls, {actions} actions, {len(findings)} findings, "
          f"{len(gaps)} demo gaps, {summary['minutes']} min -> {out / 'results.md'}", flush=True)
