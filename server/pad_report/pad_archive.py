#!/usr/bin/env python3
"""pad.traks.ca archive: keep, once a day, what would otherwise disappear.

Runs on bcmail as root from /etc/cron.d/pad-digest at 00:20 BC, under a lock:

    flock -w 600 /var/lib/pad-digest/.archive.lock python3 /usr/local/lib/pad-digest/pad_archive.py

and writes dated JSON under /var/lib/pad-archive/ (root only, 0600), with pad_digest's safe writes:
  ha-analytics/YYYY-MM-DD.json   HA analytics' custom_integrations.json entry for padspan_ha
                                 (HA keeps no history for custom integrations)
  site/YYYY-MM-DD.json           page loads by kind (people vs bots) and people's sources for each day
                                 still in the site's logs (Apache keeps about 15), with "complete": whether
                                 the logs held the whole day. A partial day never replaces a complete one.
  github/                        releases and the star count, refreshed by pad_digest.py; touched here too

GitHub's dated stars and traffic need a signed-in token, so the Mac's markers_export.py sends them
through pad_put.py instead. Nothing here is an IP: addresses only tell people from bots and are never stored.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pad_digest as P  # noqa: E402

HA_URL = "https://analytics.home-assistant.io/custom_integrations.json"


def archive_ha(archive, now, fetch=None):
    path = os.path.join(archive, "ha-analytics", f"{now.date().isoformat()}.json")
    if os.path.exists(path):
        return "kept"
    if fetch is None:
        def fetch(url):
            req = urllib.request.Request(url, headers={"User-Agent": "pad.traks.ca-archive"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
    data = fetch(HA_URL)
    entry = data.get("padspan_ha") if isinstance(data, dict) else None
    P.write_json(path, {"d": now.date().isoformat(), "padspan_ha": entry}, 0o600)
    return "saved" if entry is not None else "saved (no padspan_ha entry)"


def archive_site(archive, pattern, skip, now, glob_fn=None):
    """One file per day the logs hold (today aside). A complete day is written once and never replaced;
    a partial day (the oldest log day) is written only when nothing is there, and a complete one replaces it."""
    site, sources, complete = P.collect_site(pattern, skip, now, glob_fn)
    saved = 0
    for d, kinds in site.items():
        if d >= now.date():
            continue
        path = os.path.join(archive, "site", f"{d.isoformat()}.json")
        whole = d in complete
        old = P.read_json(path)
        if isinstance(old, dict) and (old.get("complete") or not whole):
            continue
        P.write_json(path, {"d": d.isoformat(), "complete": whole, "kinds": dict(kinds), "sources": dict(sources.get(d, {}))}, 0o600)
        saved += 1
    return saved


def main(paths=None, now=None):
    p = dict(P.DEFAULTS, **(paths or {}))
    now = now or dt.datetime.now(P.BC)
    _, site_skip = P.skip_lists(p)
    out = []
    try:
        out.append("ha " + archive_ha(p["archive"], now))
    except Exception as e:
        out.append(f"ha failed: {type(e).__name__}: {e}")
    try:
        out.append(f"site days saved {archive_site(p['archive'], p['site_logs'], site_skip, now)}")
    except Exception as e:
        out.append(f"site failed: {type(e).__name__}: {e}")
    try:
        rel, stars, count = P.refresh_github(p["archive"], p["repo"], now)
        out.append(f"github {len(rel)} releases, {count} stars ({len(stars)} dated)")
    except Exception as e:
        out.append(f"github failed: {type(e).__name__}: {e}")
    return "; ".join(out)


if __name__ == "__main__":
    msg = main()
    if "failed" in msg:
        P.log_error("pad_archive: " + msg)
        sys.exit(1)
    print(msg)
