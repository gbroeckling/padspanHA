#!/usr/bin/env python3
"""pad.traks.ca digest: the dashboard's whole model (schema 1), built from the server's own data.

Runs on bcmail as root from /etc/cron.d/pad-digest every 5 minutes:

    python3 /usr/local/lib/pad-digest/pad_digest.py

and writes private/pad-digest/model.json (www-data:client1, 0640). digest.php serves that file to a
browser signed in on index.php. The contract is server/pad_report/DIGEST.md.

Sources (all read only):
  private/padspan-pings.log         update checks: one line per check, "iso-time<TAB>ip<TAB>version"
  private/padspan-telemetry/*.jsonl the opt-in usage reports (and installs.json, the first-seen ledger)
  /var/log/apache2/padspan.traks.ca-access.log*   the site's own logs (about 15 days are kept)
  wp_traks_ca.traks_licenses        licence counts by day and plan (counts only)
  private/pad-archive/              what pad_archive.py and markers_export.py keep: GitHub releases
                                    and stars, GitHub traffic, HA analytics, site days past the logs,
                                    and the marketing markers from the 5810 workbook

It never outputs an IP, email, licence key or install id: addresses are only counted, install ids only
become masked labels ("home A"), and the licence table is read through COUNT(*) alone.
"""
from __future__ import annotations

import collections
import datetime as dt
import glob
import gzip
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import urllib.request
from urllib.parse import urlsplit

BC = dt.timezone(dt.timedelta(hours=-7))  # BC is UTC-7 all year (no clock change since Mar 2026)
WEB10 = "/var/www/clients/client1/web10"
DEFAULTS = {
    "pings": WEB10 + "/private/padspan-pings.log",
    "telemetry": WEB10 + "/private/padspan-telemetry",
    "site_logs": "/var/log/apache2/padspan.traks.ca-access.log*",
    "archive": WEB10 + "/private/pad-archive",
    "out": WEB10 + "/private/pad-digest",
    "config": "/etc/dcs-reports/config.json",
    "repo": "gbroeckling/padspanHA",
}
SCHEMA = 1
STALE_AFTER_S = 900
GOAL = 50000
TOO_EARLY = 20            # opt-in homes on a version before its health is judged
ADOPTED_PCT = 10.0        # a version counts as adopted at this share of the last 24 h (Sentry's rule)
SETUP_WINDOW, SETUP_GRACE, SETUP_THRESHOLD, SETUP_MIN = 28, 3, 40.0, 10
ATTENTION_DAYS = 7        # an attention item is dropped after this long unless it is growing


# ── small helpers ───────────────────────────────────────────────────────────

def _fmt(t, f: str) -> str:
    """strftime with %-d (day without a leading zero) on every platform:
    Windows' strftime has no %-d, and the release runs the tests there."""
    return t.strftime(f.replace("%-d", str(t.day)))

def med(v):
    return statistics.median(v) if v else 0


def mad_sigma(v):
    if len(v) < 3:
        return 0
    m = med(v)
    return 1.4826 * med([abs(x - m) for x in v])


def verdict(val, typ, sig):
    if sig <= 0:
        return "normal"
    z = (val - typ) / sig
    return "above" if z > 3 else "below" if z < -3 else "normal"


def quant(vals, p):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, max(0, round(p * (len(s) - 1))))]


def ds(d):
    return d.isoformat()


def D(s):
    return dt.date.fromisoformat(s)


def diff_sig(a, na, b, nb):
    """Two proportions differ at about 95%: a/na against b/nb."""
    if not na or not nb:
        return False
    p1, p2 = a / na, b / nb
    se = math.sqrt(p1 * (1 - p1) / na + p2 * (1 - p2) / nb)
    return se > 0 and abs(p1 - p2) > 1.96 * se


def vkey(v):
    """Sort key for versions like 0.38.199."""
    try:
        return tuple(int(x) for x in str(v).split("."))
    except ValueError:
        return (0,)


# ── 1. update checks ────────────────────────────────────────────────────────
def collect_pings(path, skip, now):
    today, tod = now.date(), now.hour * 3600 + now.minute * 60 + now.second
    cut24 = now - dt.timedelta(hours=24)
    day_ips = collections.defaultdict(set)
    day_tod_ips = collections.defaultdict(set)
    day_ver = collections.defaultdict(dict)
    last24, first_ver = {}, {}
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                p = line.rstrip("\n").split("\t")
                if len(p) < 3 or not p[2] or p[1] in skip:
                    continue
                try:
                    t = dt.datetime.fromisoformat(p[0]).astimezone(BC)
                except ValueError:
                    continue
                if t > now:
                    continue
                d = t.date()
                day_ips[d].add(p[1])
                if t.hour * 3600 + t.minute * 60 + t.second <= tod:
                    day_tod_ips[d].add(p[1])
                day_ver[d][p[1]] = p[2]
                if t >= cut24:
                    last24[p[1]] = p[2]
                if p[2] not in first_ver or d < first_ver[p[2]]:
                    first_ver[p[2]] = d
    days = sorted(day_ips)
    return {
        "per_day": {d: len(day_ips[d]) for d in days},
        "same_time": {d: len(day_tod_ips[d]) for d in days if (today - d).days <= 8},
        "last24": collections.Counter(last24.values()),
        "last24_total": len(last24),
        "ver_per_day": {d: collections.Counter(day_ver[d].values()) for d in days if (today - d).days <= 30},
        "first_ver": first_ver,
    }


# ── 2. opt-in reports ───────────────────────────────────────────────────────
def collect_reports(directory, now):
    rows, first = {}, {}
    for f in sorted(glob.glob(os.path.join(directory, "*.jsonl"))):
        with open(f, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    rec = json.loads(line)
                    r = rec["report"]
                    iid = str(r["install_id"])
                except Exception:
                    continue
                try:
                    if rec.get("recv_ts"):
                        d = dt.datetime.fromisoformat(str(rec["recv_ts"]).replace("Z", "+00:00")).astimezone(BC).date()
                    else:
                        d = D(str(rec.get("recv_day") or os.path.basename(f)[:10]))
                except ValueError:
                    continue
                if d > now.date():
                    continue
                rows[(iid, d)] = r
                if iid not in first or d < first[iid]:
                    first[iid] = d
    try:
        with open(os.path.join(directory, "installs.json"), encoding="utf-8") as fh:
            ledger = json.load(fh)
        for iid, e in (ledger.items() if isinstance(ledger, dict) else []):
            if isinstance(e, dict) and e.get("first"):
                fd = D(str(e["first"])[:10])
                if iid in first and fd < first[iid]:
                    first[iid] = fd
    except Exception:
        pass
    return rows, first


def stage(r):
    e = r.get("env") or {}
    s = "none"
    for w, k in (("map", "maps"), ("rooms", "rooms"), ("receivers", "scanner_positions"), ("calibrated", "calibration_points")):
        try:
            if int(e.get(k) or 0) > 0:
                s = w
        except (TypeError, ValueError):
            pass
    return s


def lag_max(r):
    try:
        return float(((r.get("health") or {}).get("perf") or {}).get("lag_ms", {}).get("max") or 0)
    except (TypeError, ValueError, AttributeError):
        return 0.0


def snap_p95(r):
    try:
        return float(((r.get("health") or {}).get("perf") or {}).get("snap_ms", {}).get("p95") or 0)
    except (TypeError, ValueError, AttributeError):
        return 0.0


def unclean(r):
    try:
        return int(((r.get("health") or {}).get("runs") or {}).get("unclean") or 0)
    except (TypeError, ValueError, AttributeError):
        return 0


def issue_keys(r):
    k = collections.Counter()
    for m, n in (r.get("errors") or {}).items():
        try:
            k["log:" + str(m)] += int(n)
        except (TypeError, ValueError):
            pass
    for ev, n in (r.get("usage") or {}).items():
        try:
            n = int(n)
        except (TypeError, ValueError):
            continue
        if ev.startswith("ui_error:"):
            k["panel error: " + ev[9:]] += n
        elif ev.startswith("house3d_fallback:"):
            k["3D fell back: " + ev[17:]] += n
    return k


def hw(r):
    return (r.get("env") or {}).get("hw") or {}


def health_row(reports, version, d0, d1):
    """Opt-in homes on `version` reporting between d0 and d1 (inclusive), each counted once."""
    h = {"homes": set(), "ui": set(), "warn": set(), "lag": set(), "unclean": set(), "fallback": set(), "lagmax": []}
    for (iid, d), r in reports.items():
        if not (d0 <= d <= d1) or str(r.get("version") or "?") != version:
            continue
        h["homes"].add(iid)
        ik = issue_keys(r)
        if any(x.startswith("panel error") for x in ik):
            h["ui"].add(iid)
        if any(x.startswith("log:") for x in ik):
            h["warn"].add(iid)
        if lag_max(r) >= 1000:
            h["lag"].add(iid)
        if unclean(r):
            h["unclean"].add(iid)
        if any(x.startswith("3D fell back") for x in ik):
            h["fallback"].add(iid)
        if lag_max(r):
            h["lagmax"].append(lag_max(r))
    homes = len(h["homes"])
    return {"v": version, "homes": homes, "ui_err": len(h["ui"]), "warn": len(h["warn"]), "lag_1s": len(h["lag"]),
            "unclean": len(h["unclean"]), "fallback": len(h["fallback"]),
            "lag_p50": quant(h["lagmax"], .5), "lag_p95": quant(h["lagmax"], .95), "too_early": homes < TOO_EARLY}


def report_aggregates(rows, first, now):
    today = now.date()
    per_day = collections.defaultdict(lambda: {"homes": 0, "lag": 0, "unclean": 0, "unclean_homes": 0,
                                               "ui_err_homes": 0, "warn_homes": 0, "fallbacks": 0})
    issue_day_homes = collections.defaultdict(lambda: collections.defaultdict(set))
    issue_versions = collections.defaultdict(collections.Counter)
    latest = {}
    for (iid, d), r in rows.items():
        pd_ = per_day[d]
        pd_["homes"] += 1
        if lag_max(r) >= 1000:
            pd_["lag"] += 1
        u = unclean(r)
        pd_["unclean"] += u
        pd_["unclean_homes"] += 1 if u else 0
        ik = issue_keys(r)
        if any(x.startswith("panel error") for x in ik):
            pd_["ui_err_homes"] += 1
        if any(x.startswith("log:") for x in ik):
            pd_["warn_homes"] += 1
        pd_["fallbacks"] += sum(n for x, n in ik.items() if x.startswith("3D fell back"))
        for x in ik:
            issue_day_homes[x][d].add(iid)
            if (today - d).days <= 7:
                issue_versions[x][str(r.get("version") or "?")] += 1
        if iid not in latest or d > latest[iid][0]:
            latest[iid] = (d, r)

    win = [(iid, d, r) for (iid, d), r in rows.items() if (today - d).days <= 6]
    versions7 = collections.Counter()
    seen = set()
    for iid, d, r in win:
        v = str(r.get("version") or "?")
        if (iid, v) not in seen:
            seen.add((iid, v))
            versions7[v] += 1
    vh = {v: health_row(rows, v, today - dt.timedelta(days=6), today) for v in versions7}

    iss = []
    for x, byday in issue_day_homes.items():
        seen_days = sorted(byday)
        recent = [d for d in seen_days if (today - d).days <= 2]
        gap = [d for d in seen_days if 3 <= (today - d).days <= 9]
        before = [d for d in seen_days if (today - d).days >= 10]
        status = "ongoing"
        if recent and not gap and not before:
            status = "new"
        elif recent and before and not gap:
            status = "regressed"
        elif not recent:
            status = "quiet"
        homes7 = set().union(*[byday[d] for d in seen_days if (today - d).days <= 6])
        homes30 = set().union(*[byday[d] for d in seen_days if (today - d).days <= 29])
        iss.append({"key": x, "status": status, "first": ds(seen_days[0]), "last": ds(seen_days[-1]),
                    "homes7": len(homes7), "homes30": len(homes30),
                    "per_day": {ds(d): len(byday[d]) for d in seen_days if (today - d).days <= 29},
                    "versions7": [list(t) for t in issue_versions[x].most_common(4)]})
    order = {"new": 0, "regressed": 1, "ongoing": 2, "quiet": 3}
    iss.sort(key=lambda i: (order[i["status"]], -i["homes7"], -i["homes30"]))

    per_home = {}
    for iid, d, r in win:
        e = per_home.setdefault(iid, {"lag": 0, "snap": 0, "unclean": 0, "version": str(r.get("version") or "?"),
                                      "scanners": (r.get("env") or {}).get("scanners"), "rooms": (r.get("env") or {}).get("rooms")})
        e["lag"] = max(e["lag"], lag_max(r))
        e["snap"] = max(e["snap"], snap_p95(r))
        e["unclean"] += unclean(r)
    lags = [e["lag"] for e in per_home.values() if e["lag"]]
    worst = sorted(per_home.values(), key=lambda e: -e["lag"])[:5]
    perf = {"homes": len(per_home), "lag_p50": quant(lags, .5), "lag_p95": quant(lags, .95),
            "homes_lag_1s": sum(1 for x in lags if x >= 1000),
            "worst": [{"home": "home " + "ABCDE"[i], **{k: e[k] for k in ("lag", "snap", "unclean", "version", "scanners", "rooms")}}
                      for i, e in enumerate(worst)]}

    st = {"still": collections.Counter(), "quiet": collections.Counter()}
    new15_stage = collections.Counter()
    for iid, fd in first.items():
        if iid not in latest:
            continue
        ld, r = latest[iid]
        if (today - fd).days <= 27:
            st["still" if (today - ld).days <= 2 else "quiet"][stage(r)] += 1
        if (today - fd).days <= 14:
            new15_stage[stage(r)] += 1
    return {
        "per_day": dict(per_day), "new_per_day": collections.Counter(first.values()),
        "lifetime": len(first), "active7": len({iid for iid, _, _ in win}),
        "version_health": vh, "versions7_homes": dict(versions7), "issues": iss[:40], "perf": perf,
        "new_setup_28d": {k: dict(v) for k, v in st.items()}, "new15": sum(new15_stage.values()),
        "new15_stage": dict(new15_stage), "latest": latest,
        "tier_latest": collections.Counter(str(r.get("tier") or "?") for d, r in latest.values() if (today - d).days <= 6).most_common(),
    }


def setup_failures(first, latest, now):
    """New opt-in installs (first seen in the window, at least the grace days old) still at none/map."""
    today = now.date()
    total = failing = 0
    by = {"ha_version": collections.defaultdict(lambda: [0, 0]), "install_type": collections.defaultdict(lambda: [0, 0]),
          "hardware": collections.defaultdict(lambda: [0, 0])}
    for iid, fd in first.items():
        age = (today - fd).days
        if iid not in latest or not (SETUP_GRACE <= age <= SETUP_WINDOW - 1):
            continue
        _, r = latest[iid]
        bad = stage(r) in ("none", "map")
        total += 1
        failing += bad
        hv = str(r.get("ha_version") or "?")
        keys = {"ha_version": ".".join(hv.split(".")[:2]) if hv != "?" else "?",
                "install_type": str(hw(r).get("install") or "?"),
                "hardware": str(hw(r).get("board") or "?")}
        for dim, k in keys.items():
            by[dim][k][1] += 1
            by[dim][k][0] += bad
    rate = round(100 * failing / total, 1) if total else None
    return {"window_days": SETUP_WINDOW, "grace_days": SETUP_GRACE, "threshold_pct": SETUP_THRESHOLD,
            "total": total, "failing": failing, "rate": rate,
            "over": bool(total >= SETUP_MIN and rate is not None and rate >= SETUP_THRESHOLD),
            "by": {dim: [{"k": k, "failing": v[0], "of": v[1]} for k, v in sorted(rows.items(), key=lambda kv: -kv[1][1])[:6]]
                   for dim, rows in by.items()},
            "definition": f"New opt-in installs first seen in the last {SETUP_WINDOW} days and at least {SETUP_GRACE} days old "
                          "whose latest report has no rooms yet (stage none or map), whether or not they still report."}


# ── 3. licences (counts only) ───────────────────────────────────────────────
LIC_SQL = ("SELECT DATE(CONVERT_TZ(created_at,'+00:00','-07:00')) d, plan, (txn_id IS NOT NULL AND txn_id<>'') paid, COUNT(*) "
           "FROM traks_licenses WHERE product='padspan' AND (email IS NULL OR email NOT LIKE '%.invalid') "
           "GROUP BY d, plan, paid ORDER BY d")


def collect_licences(run_sql=None):
    if run_sql is None:
        def run_sql(q):
            res = subprocess.run(["mysql", "-N", "-B", "wp_traks_ca", "-e", q], capture_output=True, text=True, timeout=60)
            return res.stdout if res.returncode == 0 else ""
    out = []
    for ln in run_sql(LIC_SQL).splitlines():
        p = ln.split("\t")
        if len(p) == 4 and p[0] not in ("NULL", ""):
            try:
                out.append((D(p[0]), p[1], p[2] == "1", int(p[3])))
            except ValueError:
                continue
    return out


# ── 4. site logs ────────────────────────────────────────────────────────────
BOT = re.compile(r"bot|crawl|spider|slurp|preview|fetch|monitor|scan|curl|wget|python|http|headless", re.I)
LOG = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(GET|HEAD) (\S+)[^"]*" (\d{3}) \S+ "([^"]*)" "([^"]*)"')
SOURCES = (("GitHub", ("github.com",)), ("HA forum", ("community.home-assistant.io",)), ("Reddit", ("reddit.com",)),
           ("Search", ("google.", "bing.com", "duckduckgo", "yandex", "baidu", "ecosia", "brave.com", "startpage")),
           ("AI assistants", ("chatgpt.com", "openai.com", "perplexity", "claude.ai", "gemini.google", "copilot")),
           ("HACS / HA", ("hacs.xyz", "home-assistant.io")), ("App directories", ("jimmi.top", "alternativeto", "producthunt")),
           ("Email", ("mail.", "outlook.", "exmail.qq.com", "webmail")), ("YouTube", ("youtube.com", "youtu.be")),
           ("X / social", ("x.com", "t.co", "twitter.com", "facebook.com", "linkedin.com", "mastodon", "bsky")))


def source_of(ref, query):
    if "ref=share" in query:
        return "Shared links"
    if ref in ("", "-"):
        return "Direct or unknown"
    try:
        h = (urlsplit(ref).hostname or "").lower()
    except ValueError:
        return "Other"
    if h.endswith("traks.ca"):
        return None
    for name, pats in SOURCES:
        if any(s in h for s in pats):
            return name
    return "Other"


def page_kind(path):
    if path in ("/demo/", "/demo/index.html"):
        return "demo"
    if path.startswith("/guides/") and (path.endswith("/") or path.endswith(".html")):
        return "guide"
    if path in ("/", "/index.html", "/de/", "/de/index.html"):
        return "home"
    if path.startswith("/creators/") and (path.endswith("/") or path.endswith(".html")):
        return "creators"
    return None


def collect_site(pattern, skip, now):
    """Page loads by BC day and kind (people vs bots), and sources of people's loads."""
    site = collections.defaultdict(collections.Counter)
    sources_by_day = collections.defaultdict(collections.Counter)
    for f in sorted(glob.glob(pattern)):
        op = gzip.open if f.endswith(".gz") else open
        try:
            with op(f, "rt", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    m = LOG.match(line)
                    if not m or m.group(1) in skip:
                        continue
                    _ip, ts, _meth, path, status, ref, ua = m.groups()
                    if status not in ("200", "304"):
                        continue
                    pth, _, qs = path.partition("?")
                    kind = page_kind(pth)
                    if not kind:
                        continue
                    try:
                        d = dt.datetime.strptime(ts, "%d/%b/%Y:%H:%M:%S %z").astimezone(BC).date()
                    except ValueError:
                        continue
                    if d > now.date():
                        continue
                    bot = bool(BOT.search(ua))
                    site[d][kind + ("_bot" if bot else "")] += 1
                    if not bot:
                        s = source_of(ref, qs)
                        if s:
                            sources_by_day[d][s] += 1
        except OSError:
            continue
    return site, sources_by_day


# ── 5. archive and GitHub ───────────────────────────────────────────────────
def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path, obj, mode=0o640, owner=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, default=str, separators=(",", ":"))
    os.chmod(tmp, mode)
    if owner:
        try:
            shutil.chown(tmp, *owner)
        except (LookupError, PermissionError, OSError):
            pass
    os.replace(tmp, path)


def gh_get(url, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": "pad.traks.ca-digest"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def refresh_github(archive, repo, now, fetch=gh_get):
    """Releases (public API: the newest page every 15 min, every page GitHub serves on the first run; it
    serves only the newest 1,000) and the repo's star count. The dated star list needs a signed-in token,
    so the Mac's markers_export.py uploads github/stars.json; it is only read here."""
    gdir = os.path.join(archive, "github")
    meta = read_json(os.path.join(gdir, "meta.json"), {}) or {}
    rel = read_json(os.path.join(gdir, "releases.json"), []) or []
    stamp = now.timestamp()
    if stamp - meta.get("releases_at", 0) > 900:
        known = {r["tag"]: r for r in rel}
        err = None
        for page in range(1, (1 if rel else 10) + 1):
            try:
                got = fetch(f"https://api.github.com/repos/{repo}/releases?per_page=100&page={page}")
            except Exception as e:  # 422 past the first 1,000 releases, rate limits, the network
                err = str(e)[:200]
                break
            if not got:
                break
            for g in got:
                if g.get("draft"):
                    continue
                known[g["tag_name"]] = {"tag": g["tag_name"], "published_at": g.get("published_at"),
                                        "prerelease": bool(g.get("prerelease"))}
        if len(known) > len(rel) or (known and not err):
            rel = sorted(known.values(), key=lambda r: r["published_at"] or "")
            write_json(os.path.join(gdir, "releases.json"), rel, 0o600)
            meta["releases_at"] = stamp
        meta["releases_error"] = err
    if stamp - meta.get("repo_at", 0) > 900:
        try:
            meta["stars_count"] = int(fetch(f"https://api.github.com/repos/{repo}").get("stargazers_count"))
            meta["repo_at"] = stamp
            meta["repo_error"] = None
        except Exception as e:
            meta["repo_error"] = str(e)[:200]
    write_json(os.path.join(gdir, "meta.json"), meta, 0o600)
    stars = read_json(os.path.join(gdir, "stars.json"), []) or []
    return rel, stars, meta.get("stars_count")


def read_archive(archive):
    """Daily snapshots pad_archive.py and markers_export.py keep: site days, HA analytics, GitHub traffic."""
    site, sources = {}, {}
    for f in sorted(glob.glob(os.path.join(archive, "site", "*.json"))):
        j = read_json(f)
        if isinstance(j, dict) and j.get("d"):
            site[D(j["d"])] = collections.Counter(j.get("kinds") or {})
            sources[D(j["d"])] = collections.Counter(j.get("sources") or {})
    ha = []
    for f in sorted(glob.glob(os.path.join(archive, "ha-analytics", "*.json"))):
        j = read_json(f)
        if isinstance(j, dict) and j.get("d") and j.get("padspan_ha") is not None:
            n = j["padspan_ha"].get("total") if isinstance(j["padspan_ha"], dict) else j["padspan_ha"]
            ha.append({"d": j["d"], "n": n})
    traffic, referrers = {}, []
    for f in sorted(glob.glob(os.path.join(archive, "github-traffic", "*.json"))):
        j = read_json(f)
        if not isinstance(j, dict):
            continue
        for v in (j.get("views") or []):
            traffic.setdefault(v["d"], {}).update({"views": v.get("count"), "uniques": v.get("uniques")})
        for v in (j.get("clones") or []):
            traffic.setdefault(v["d"], {}).update({"clones": v.get("count"), "clone_uniques": v.get("uniques")})
        if j.get("referrers"):
            referrers = [[r.get("referrer"), r.get("count")] for r in j["referrers"]]
    markers = read_json(os.path.join(archive, "markers.json"), {}) or {}
    return site, sources, ha, traffic, referrers, markers


# ── 6. the model ────────────────────────────────────────────────────────────
def build(pings, rep, setupf, licences, site, sources_by_day, releases, stars_raw, markers, archive, now, state, stars_count=None):
    gen = now
    today = now.date()
    # north star
    pd_ = pings["per_day"]
    full = sorted(d for d in pd_ if d < today)
    if not full:
        raise ValueError("no complete day of update checks yet")
    yday = full[-1]
    prev7 = [pd_[d] for d in full[-8:-1]]
    ns_typ = med(prev7)
    st = pings["same_time"]
    same_prev = [st[d] for d in sorted(st) if d < today][-7:]
    today_typ = med(same_prev)
    today_sig = max(mad_sigma(same_prev), math.sqrt(today_typ or 1) * 0.5)
    avg7 = {}
    for i, d in enumerate(full):
        w7 = [pd_[x] for x in full[max(0, i - 6): i + 1]]
        avg7[d] = sum(w7) / len(w7)
    resid = {d: pd_[d] - avg7[d] for d in full}
    series_all = []
    for i, d in enumerate(full):
        r28 = [resid[x] for x in full[max(0, i - 27): i + 1]]
        s = max(mad_sigma(r28), 2.0)
        series_all.append({"d": ds(d), "v": pd_[d], "avg": round(avg7[d], 1), "lo": round(avg7[d] - 3 * s, 1), "hi": round(avg7[d] + 3 * s, 1)})
    series = series_all[-45:]
    ns_sig = max(mad_sigma([resid[d] for d in full[-28:]]), 2.0)
    today_n = st.get(today, 0)

    # releases and adoption
    rel = []
    for r in releases:
        try:
            t = dt.datetime.fromisoformat(str(r["published_at"]).replace("Z", "+00:00")).astimezone(BC)
        except (ValueError, TypeError):
            continue
        if t <= now:
            rel.append({"tag": r["tag"].lstrip("v"), "t": t, "stable": not r.get("prerelease")})
    stables = sorted([r for r in rel if r["stable"]], key=lambda r: r["t"])
    stable_tags = {r["tag"] for r in stables}
    l24, l24_total = pings["last24"], pings["last24_total"]
    ls = stables[-1] if stables else None
    p1 = stables[-2] if len(stables) > 1 else None
    p2 = stables[-3] if len(stables) > 2 else None
    hours_out = (now - ls["t"]).total_seconds() / 3600 if ls else 0
    adopt_versions = [r["tag"] for r in (ls, p1, p2) if r]
    adopt = []
    for d in sorted(pings["ver_per_day"]):
        if d >= today - dt.timedelta(days=20):
            c = pings["ver_per_day"][d]
            tot = sum(c.values()) or 1
            row = {"d": ds(d), "partial": d == today}
            for v in adopt_versions:
                row[v] = round(100 * c.get(v, 0) / tot, 1)
            row["Other"] = round(100 - sum(row[v] for v in adopt_versions), 1)
            adopt.append(row)

    # release health, 7 days (as the mockup)
    vh = rep["version_health"]

    def vrow(v):
        if v in vh:
            return dict(vh[v])
        return {"v": v, "homes": rep["versions7_homes"].get(v, 0), "ui_err": 0, "warn": 0, "lag_1s": 0, "unclean": 0,
                "fallback": 0, "lag_p50": None, "lag_p95": None, "too_early": rep["versions7_homes"].get(v, 0) < TOO_EARLY}
    health = [vrow(v) for v in adopt_versions]

    def watch_of(a, b):
        out = []
        if not a or not b or not a["homes"] or not b["homes"]:
            return out
        for key, what in (("lag_1s", "Event-loop lag over 1 s"), ("unclean", "Home Assistant stopped uncleanly"),
                          ("ui_err", "Panel errors"), ("warn", "Log warnings"), ("fallback", "3D view fell back to flat")):
            if diff_sig(a[key], a["homes"], b[key], b["homes"]) and a[key] / a["homes"] > b[key] / b["homes"]:
                out.append({"what": what, "a": [a[key], a["homes"]], "b": [b[key], b["homes"]]})
        return out
    watch = watch_of(health[1], health[2]) if len(health) > 2 else []
    for w in watch:
        w["version"] = health[1]["v"]

    # release health at the same age (NEW)
    same_age = None
    if ls and p1:
        fv = pings["first_ver"]
        f_l = fv.get(ls["tag"], ls["t"].date())
        f_p = fv.get(p1["tag"], p1["t"].date())
        age = max(0, (today - f_l).days)
        lrow = health_row(rep["rows"], ls["tag"], f_l, today)
        prow = health_row(rep["rows"], p1["tag"], f_p, f_p + dt.timedelta(days=age))
        lrow.update({"first_day": ds(f_l), "window": [ds(f_l), ds(today)]})
        prow.update({"first_day": ds(f_p), "window": [ds(f_p), ds(f_p + dt.timedelta(days=age))]})
        sa_watch = [] if lrow["too_early"] else watch_of(lrow, prow)
        for w in sa_watch:
            w["version"] = ls["tag"]
        note = (f"Too early: {lrow['homes']} opt-in home{'s' if lrow['homes'] != 1 else ''} on {ls['tag']} after "
                f"{age} day{'s' if age != 1 else ''}; judged from {TOO_EARLY}." if lrow["too_early"] else
                (f"{ls['tag']} on day {age}: " + "; ".join(f"{w['what']} on {w['a'][0]} of {w['a'][1]} vs {w['b'][0]} of {w['b'][1]} on {p1['tag']}" for w in sa_watch)
                 if sa_watch else f"{ls['tag']} on day {age}: no worse than {p1['tag']} was at the same age."))
        same_age = {"age_days": age, "latest": lrow, "prev": prow, "watch": sa_watch, "too_early": lrow["too_early"], "note": note}

    issues = rep["issues"]
    new_iss = [i for i in issues if i["status"] in ("new", "regressed")]
    ongoing = [i for i in issues if i["status"] == "ongoing"]

    # opt-in daily series
    rp = rep["per_day"]
    rdays = sorted(d for d in rp if d < today)
    lag_share = [(d, rp[d]["lag"], rp[d]["homes"]) for d in rdays[-30:]]
    ry = rp.get(yday, {"lag": 0, "homes": 0, "unclean": 0})
    lag_y = ry["lag"]
    lag_prev = [rp[d]["lag"] for d in rdays if d < yday][-7:]
    newp = rep["new_per_day"]

    # licences
    lic_day = collections.defaultdict(lambda: {"trial": 0, "tester": 0, "pro": 0, "lifetime": 0, "paid": 0})
    for d, plan, paid, n in licences:
        lic_day[d][plan] = lic_day[d].get(plan, 0) + n
        if paid:
            lic_day[d]["paid"] += n

    def lic_sum(d0, d1, k):
        return sum(v.get(k, 0) for d, v in lic_day.items() if d0 <= d <= d1)

    # stars
    stars = collections.Counter()
    for s in stars_raw:
        try:
            stars[dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(BC).date()] += 1
        except ValueError:
            pass
    stars_total = max(sum(stars.values()), int(stars_count or 0))  # the repo's live count when the dated list lags

    # site: the archive fills days the logs no longer hold
    site_all = dict(archive["site"])
    site_all.update(site)
    src_all = dict(archive["sources"])
    src_all.update(sources_by_day)
    sdays = sorted(site_all)

    def people(d):
        return sum(n for k, n in site_all[d].items() if not k.endswith("_bot"))
    demo_today = site_all.get(today, {}).get("demo", 0)
    demo_prev = [site_all[d].get("demo", 0) for d in sdays if d < today][-7:]

    # marketing markers
    start = full[0]
    posts = [p for p in markers.get("posts", []) if re.match(r"\d{4}-\d{2}-\d{2}$", str(p[0] or "")) and D(p[0]) >= start]
    content = collections.defaultdict(list)
    for d, ch, title in posts:
        if any(s in str(ch).lower() for s in ("guide", "site", "demo")):
            content[d].append(title)
    sends = collections.defaultdict(collections.Counter)
    for d, wave, n in markers.get("sends", []):
        sends[d][wave] += int(n)
    ranges = []
    waves = collections.defaultdict(list)
    for d, wave, n in markers.get("sends", []):
        waves[wave].append(d)
    for wave, days in sorted(waves.items(), key=lambda kv: min(kv[1])):
        ranges.append({"from": min(days), "to": max(days), "label": f"Outreach: {wave}", "kind": "outreach"})
    for c in markers.get("campaigns", []):
        proj = str(c.get("project") or "")
        if proj and not re.search(r"padspan", proj, re.I) and not re.search(r"padspan", str(c.get("label") or ""), re.I):
            continue  # the workbook also tracks Garry's other products
        if c.get("from") and re.match(r"\d{4}-\d{2}-\d{2}$", c["from"]) and D(c["from"]) >= start:
            lab = str(c.get("label") or "")
            kind = "launch" if re.search(r"launch|marketplace", lab, re.I) else "campaign"
            ranges.append({"from": c["from"], "to": c.get("to") or c["from"], "label": lab, "kind": kind})
    campaign = None
    if sends:
        push_start = min(D(d) for d in sends)
        send_days = sorted(sends)
        n_waves = len([w for w in waves if w != "Various"])
        campaign = {"from": ds(push_start), "to": send_days[-1], "label": f"Outreach emails, {n_waves} waves"}
    markers_out = {"stables": [{"d": ds(r["t"].date()), "tag": r["tag"]} for r in stables if series and r["t"].date() >= D(series[0]["d"])],
                   "campaign": campaign, "ranges": ranges,
                   "content": [{"d": d, "items": v} for d, v in sorted(content.items())]}

    # before/after the latest outreach push
    ba = None
    if campaign:
        push_start = D(campaign["from"])
        after = [pd_[d] for d in full if d >= push_start]
        before = [pd_[d] for d in full if push_start - dt.timedelta(days=14) <= d < push_start]
        if after and before:
            ba = {"push": ds(push_start), "after_days": len(after), "after": round(sum(after) / len(after), 1),
                  "before": round(sum(before) / len(before), 1), "sig": ns_sig}
            ba["diff"] = round(ba["after"] - ba["before"], 1)
            ba["band"] = round(3 * ns_sig * math.sqrt(1 / max(1, len(after)) + 1 / max(1, len(before))), 1)
            ba["verdict"] = ("too early" if len(after) < 14 else "lift" if ba["diff"] > ba["band"]
                             else "drop" if ba["diff"] < -ba["band"] else "no detectable change")

    # funnel and sources, last 15 days
    f0 = today - dt.timedelta(days=14)
    funnel = [
        {"step": "Site page views by people", "n": sum(people(d) for d in sdays if d >= f0), "note": "home, guides, demo, creators"},
        {"step": "Demo loads by people", "n": sum(site_all[d].get("demo", 0) for d in sdays if d >= f0), "note": ""},
        {"step": "New installs that share a report", "n": rep["new15"],
         "note": f"about 1 in 3 installs share one; {rep['new15_stage'].get('calibrated', 0)} of {rep['new15']} reached calibration"},
        {"step": "Trials started", "n": lic_sum(f0, today, "trial"), "note": "all installs"},
        {"step": "Paid keys", "n": lic_sum(f0, today, "paid"), "note": "all installs"},
    ]
    src_c = collections.Counter()
    for d in sdays:
        if d >= f0:
            src_c.update(src_all.get(d, {}))
    sources = [list(t) for t in src_c.most_common()]

    # today & yesterday digest
    def rel_on(day, stable=None):
        return [r for r in rel if r["t"].date() == day and (stable is None or r["stable"] == stable)]
    digest = {"Releases": [], "Problems": [], "Growth": [], "Money": [], "Marketing": []}
    if ls:
        pct = 100 * l24.get(ls["tag"], 0) / l24_total if l24_total else 0
        digest["Releases"].append(f"{ls['tag']} became the stable {'yesterday' if ls['t'].date() == yday else 'today' if ls['t'].date() == today else _fmt(ls['t'], '%b %-d')} "
                                  f"at {ls['t'].strftime('%H:%M')}. After {hours_out:.0f} h it's on {l24.get(ls['tag'], 0)} of {l24_total} homes that checked for updates ({pct:.0f}%).")
    bt, by = rel_on(today, False), rel_on(yday, False)
    if bt or by:
        def rng(rs):
            rs = sorted(rs, key=lambda r: r["t"])
            return rs[0]["tag"] + ("–" + rs[-1]["tag"] if len(rs) > 1 else "")
        digest["Releases"].append(f"Betas: {len(by)} yesterday" + (f" ({rng(by)})" if by else "") + (f", {len(bt)} today ({rng(bt)})." if bt else "."))
    digest["Problems"].append("No new or regressed issues in the last 3 days." if not new_iss else
                              f"{len(new_iss)} new or regressed issue{'s' if len(new_iss) != 1 else ''}: " + "; ".join(i["key"] for i in new_iss[:3]))
    sa_w = same_age["watch"] if same_age else []
    if sa_w:
        digest["Problems"].append(f"{len(sa_w)} worth a look on {ls['tag']} against {p1['tag']} at the same age: "
                                  + " and ".join(w["what"].lower().replace("home assistant", "Home Assistant") for w in sa_w) + " (see Release health).")
    elif watch:
        digest["Problems"].append(f"{len(watch)} worth a look on {health[1]['v']}: "
                                  + " and ".join(w["what"].lower().replace("home assistant", "Home Assistant") for w in watch) + " (see Release health).")
    if setupf["over"]:
        digest["Problems"].append(f"Setups: {setupf['failing']} of {setupf['total']} new opt-in installs never got past the map ({setupf['rate']:.0f}%, flag at {setupf['threshold_pct']:.0f}%).")
    nv = verdict(pd_[yday], ns_typ, ns_sig)
    digest["Growth"].append(f"{pd_[yday]} homes checked in yesterday (typical {ns_typ:.0f}, {nv}). "
                            f"Today {today_n} by {gen.strftime('%H:%M')} (typical {today_typ:.0f} by this hour, {verdict(today_n, today_typ, today_sig)}).")
    digest["Growth"].append(f"New opt-in installs: {newp.get(yday, 0)} yesterday, {newp.get(today, 0)} today. "
                            f"GitHub stars: +{stars.get(yday, 0)} yesterday, +{stars.get(today, 0)} today ({stars_total} total).")
    ly, lt = lic_day.get(yday, {}), lic_day.get(today, {})

    def keys_txt(v):
        parts = [f"{v.get(k, 0)} {k}" for k in ("trial", "pro", "lifetime", "tester") if v.get(k)]
        return (", ".join(parts) + (f" ({v.get('paid', 0)} paid)" if v.get("paid") else " (none paid)")) if parts else "none"
    digest["Money"].append(f"Keys yesterday: {keys_txt(ly)}. Today so far: {keys_txt(lt)}.")

    def short(x):
        x = str(x).split(" (")[0]
        head, _, tail = x.partition(":")
        return x if not tail or len(tail.strip()) <= 30 else head
    for day, label in ((yday, "Yesterday"), (today, "Today")):
        bits = []
        if ds(day) in content:
            bits.append("; ".join(short(x) for x in content[ds(day)]))
        if ds(day) in sends:
            k = sum(sends[ds(day)].values())
            bits.append(f"{k} pitch email{'s' if k != 1 else ''} ({', '.join(sends[ds(day)])})")
        if bits:
            digest["Marketing"].append(f"{label}: " + " · ".join(bits) + ".")
    if demo_prev and demo_today > 3 * max(1, med(demo_prev)):
        digest["Marketing"].append(f"Demo loads today: {demo_today} by people, against a typical {med(demo_prev):.0f}. May include our own test visits.")

    feed = []
    for r in rel:
        if r["t"].date() >= yday:
            feed.append((r["t"], "Release", f"{r['tag']} {'stable' if r['stable'] else 'beta'}"))
    for d in (yday, today):
        for t in content.get(ds(d), []):
            feed.append((dt.datetime.combine(d, dt.time(23, 59), BC), "Marketing", t))
        for wv, n in sends.get(ds(d), {}).items():
            feed.append((dt.datetime.combine(d, dt.time(23, 58), BC), "Email", f"{n} pitch email{'s' if n != 1 else ''}, wave {wv}"))
        v = lic_day.get(d)
        if v and any(v.get(k) for k in ("trial", "pro", "lifetime", "tester")):
            feed.append((dt.datetime.combine(d, dt.time(23, 57), BC), "Keys", keys_txt(v)))
        if newp.get(d):
            feed.append((dt.datetime.combine(d, dt.time(23, 56), BC), "Installs", f"{newp[d]} new opt-in install{'s' if newp[d] != 1 else ''}"))
    feed.sort(key=lambda e: e[0], reverse=True)
    feed = [{"t": _fmt(e[0], "%b %-d %H:%M") if e[0].time() < dt.time(23, 50) else _fmt(e[0], "%b %-d"), "kind": e[1], "text": e[2]} for e in feed]

    # versions: top 5 of the last 24 h + Other (NEW)
    unknown = {"-", "", "?"}
    top = [(v, n) for v, n in l24.most_common() if v not in unknown]
    rows5 = [{"v": v, "n": n, "share": round(100 * n / l24_total, 1) if l24_total else 0.0,
              "adopted": bool(l24_total and 100 * n / l24_total >= ADOPTED_PCT), "stable": v in stable_tags} for v, n in top[:5]]
    rest = top[5:] + [(v, n) for v, n in l24.items() if v in unknown]
    versions_top = {"total": l24_total, "rows": rows5,
                    "other": {"n": sum(n for _, n in rest), "share": round(100 * sum(n for _, n in rest) / l24_total, 1) if l24_total else 0.0,
                              "versions": len(rest)}}

    # needs attention (NEW): empty when all is fine
    items = []
    for i in new_iss:
        items.append({"key": "issue:" + i["key"], "kind": "issue",
                      "title": ("New: " if i["status"] == "new" else "Back: ") + i["key"],
                      "detail": f"{i['homes7']} opt-in home{'s' if i['homes7'] != 1 else ''} in 7 days; versions " + ", ".join(v for v, _ in i["versions7"][:3]),
                      "homes": i["homes7"], "of": rep["active7"]})
    reg = sa_w or watch
    for w in reg:
        items.append({"key": f"regression:{w['what']}:{w.get('version')}", "kind": "regression",
                      "title": f"{w['what']} on {w.get('version')}",
                      "detail": (f"{w['a'][0]} of {w['a'][1]} opt-in homes, against {w['b'][0]} of {w['b'][1]} on the version before"
                                 + (" at the same age" if sa_w else " (last 7 days)") + ". Homes that just updated also restarted."),
                      "homes": w["a"][0], "of": w["a"][1]})
    if setupf["over"]:
        items.append({"key": "setup:none_or_map", "kind": "setup", "title": "New installs stuck before rooms",
                      "detail": f"{setupf['failing']} of {setupf['total']} new opt-in installs ({setupf['rate']:.0f}%) have no rooms after {SETUP_GRACE}+ days.",
                      "homes": setupf["failing"], "of": setupf["total"]})
    if nv == "below":
        items.append({"key": "growth:below", "kind": "growth", "title": "Fewer homes checked in than normal",
                      "detail": f"{pd_[yday]} yesterday against a typical {ns_typ:.0f} (normal range ±{3 * ns_sig:.0f}).",
                      "homes": pd_[yday], "of": None})
    st_items = state.get("attention", {})
    kept = []
    for it in items:
        s = st_items.get(it["key"]) or {"first_seen": ds(today), "hist": {}}
        hist = s.get("hist", {})
        hist[ds(today)] = it["homes"] or 0
        hist = {k: v for k, v in hist.items() if (today - D(k)).days <= 14}
        prior = [v for k, v in hist.items() if 1 <= (today - D(k)).days <= 3]
        growing = bool(prior) and (it["homes"] or 0) > max(prior)
        listed = (today - D(s["first_seen"])).days
        s.update({"hist": hist, "last_seen": ds(today)})
        st_items[it["key"]] = s
        if listed > ATTENTION_DAYS and not growing:
            continue
        it.update({"first_seen": s["first_seen"], "days_listed": listed, "growing": growing})
        kept.append(it)
    # forget items not seen for 30 days
    state["attention"] = {k: v for k, v in st_items.items() if (today - D(v.get("last_seen", ds(today)))).days <= 30}
    rank = {"regression": 0, "issue": 1, "setup": 2, "growth": 3}
    kept.sort(key=lambda it: (rank[it["kind"]], -(it["homes"] or 0)))

    # headline strip
    tiles = [
        {"label": "Homes checking in", "value": pd_[yday], "unit": "yesterday", "cmp": f"typical {ns_typ:.0f}", "delta": pd_[yday] - ns_typ,
         "state": nv, "spark": [s["v"] for s in series[-30:]], "help": "Distinct addresses that checked for an update on the BC day. All installs, not only opt-in."},
        {"label": "Today so far", "value": today_n, "unit": "by " + gen.strftime("%H:%M"), "cmp": f"typical {today_typ:.0f} by now", "delta": today_n - today_typ,
         "state": verdict(today_n, today_typ, today_sig), "spark": None, "help": "Same count, today until now, against the previous 7 days at the same time."},
        {"label": f"On {ls['tag']}" if ls else "Newest stable", "value": l24.get(ls["tag"], 0) if ls else 0, "unit": f"of {l24_total} homes",
         "cmp": f"{(100 * l24.get(ls['tag'], 0) / l24_total) if (ls and l24_total) else 0:.0f}% after {hours_out:.0f} h", "delta": None,
         "state": "info", "spark": None, "help": "Homes whose last update check in the past 24 h reported the newest stable."},
        {"label": "New or regressed issues", "value": len(new_iss), "unit": "last 3 days", "cmp": f"{len(ongoing)} ongoing", "delta": None,
         "state": "good" if not new_iss else "bad", "spark": None, "help": "Errors, log warnings and 3D fallbacks first seen, or back after a quiet week, in opt-in reports."},
        {"label": "Opt-in homes with lag over 1 s", "value": lag_y, "unit": f"of {ry['homes']} yesterday", "cmp": f"typical {med(lag_prev):.0f}",
         "delta": lag_y - med(lag_prev),
         "state": "watch" if reg else verdict(lag_y, med(lag_prev), max(mad_sigma(lag_prev), math.sqrt(med(lag_prev) or 1))),
         "spark": [x[1] for x in lag_share], "help": "Opt-in homes where Home Assistant's event loop stalled 1 s or more at least once that day."},
        {"label": "Keys issued", "value": sum(ly.get(k, 0) for k in ("trial", "pro", "lifetime", "tester")), "unit": "yesterday",
         "cmp": f"{ly.get('paid', 0)} paid", "delta": None, "state": "info", "spark": None,
         "help": "Trial, Pro, lifetime and tester keys created on the BC day. Paid means a payment is attached."},
    ]

    model = {
        "ok": True, "schema": SCHEMA,
        "generated": _fmt(gen, "%a %b %-d, %H:%M") + " BC", "generated_iso": gen.isoformat(timespec="seconds"),
        "stale_after_s": STALE_AFTER_S, "need": len(kept), "tiles": tiles, "needs_attention": kept,
        "health": health, "health_same_age": same_age, "watch": watch,
        "prev": p1["tag"] if p1 else None, "prev2": p2["tag"] if p2 else None, "latest": ls["tag"] if ls else None,
        "hours_out": round(hours_out),
        "issues": issues[:12], "new_issues": new_iss, "perf": rep["perf"], "adopt": adopt, "adopt_versions": adopt_versions,
        "versions_top": versions_top, "setup_fail": setupf,
        "digest": digest, "feed": feed, "series": series, "series_all": series_all, "markers": markers_out, "ba": ba,
        "ns": {"yday": pd_[yday], "typ": ns_typ, "sig": round(ns_sig, 1), "goal": GOAL},
        "small": {"new": [{"d": ds(d), "v": newp.get(d, 0)} for d in full],
                  "keys": [{"d": ds(d), "v": sum(lic_day.get(d, {}).get(k, 0) for k in ("trial", "pro", "lifetime", "tester")),
                            "paid": lic_day.get(d, {}).get("paid", 0)} for d in full],
                  "stars": [{"d": ds(d), "v": stars.get(d, 0)} for d in full],
                  "site": [{"d": ds(d), "v": people(d) if d in site_all else None} for d in full]},
        "funnel": funnel, "sources": sources, "src_days": len([d for d in sdays if d >= f0]),
        "setup28": rep["new_setup_28d"], "new15": rep["new15"], "new15_stage": rep["new15_stage"],
        "versions24": [list(t) for t in l24.most_common()], "l24_total": l24_total, "tiers": [list(t) for t in rep["tier_latest"]],
        "lic_totals": {k: sum(v.get(k, 0) for v in lic_day.values()) for k in ("trial", "tester", "pro", "lifetime", "paid")},
        "stars_total": stars_total, "reports": {"lifetime": rep["lifetime"], "active7": rep["active7"]},
        "lag_series": [{"d": ds(d), "v": n, "of": h} for d, n, h in lag_share],
        "archive": {"since": min([a["d"] for a in archive["ha"]] + list(archive["traffic"]) + [ds(d) for d in archive["site"]], default=None),
                    "ha_optin": archive["ha"],
                    "github_traffic": [{"d": d, **v} for d, v in sorted(archive["traffic"].items())],
                    "github_referrers": archive["referrers"]},
    }
    return model, state


def run(paths=None, now=None, run_sql=None, fetch=gh_get, refresh=True):
    p = dict(DEFAULTS, **(paths or {}))
    now = now or dt.datetime.now(BC)
    cfg = read_json(p["config"], {}) or {}
    skip = set(cfg.get("pings_skip_ips", []) if isinstance(cfg.get("pings_skip_ips"), list) else [])
    pings = collect_pings(p["pings"], skip, now)
    rows, first = collect_reports(p["telemetry"], now)
    rep = report_aggregates(rows, first, now)
    rep["rows"] = rows
    setupf = setup_failures(first, rep["latest"], now)
    licences = collect_licences(run_sql)
    site, sources_by_day = collect_site(p["site_logs"], skip, now)
    if refresh:
        releases, stars, stars_count = refresh_github(p["archive"], p["repo"], now, fetch)
    else:
        releases = read_json(os.path.join(p["archive"], "github", "releases.json"), []) or []
        stars = read_json(os.path.join(p["archive"], "github", "stars.json"), []) or []
        stars_count = (read_json(os.path.join(p["archive"], "github", "meta.json"), {}) or {}).get("stars_count")
    a_site, a_sources, ha, traffic, referrers, markers = read_archive(p["archive"])
    state_path = os.path.join(p["out"], "attention-state.json")
    state = read_json(state_path, {}) or {}
    model, state = build(pings, rep, setupf, licences, site, sources_by_day, releases, stars, markers,
                         {"site": a_site, "sources": a_sources, "ha": ha, "traffic": traffic, "referrers": referrers},
                         now, state, stars_count)
    return model, state, p


def main():
    model, state, p = run()
    owner = ("www-data", "client1")
    write_json(os.path.join(p["out"], "model.json"), model, 0o640, owner)
    write_json(os.path.join(p["out"], "attention-state.json"), state, 0o600)
    print(f"ok {model['generated']}: need {model['need']}, {len(json.dumps(model, default=str))} bytes")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # cron mails root on output; keep it to one line
        print(f"pad_digest failed: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
