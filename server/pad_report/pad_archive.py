#!/usr/bin/env python3
"""pad.traks.ca archive: keep, once a day, what would otherwise disappear.

Runs on bcmail as root from /etc/cron.d/pad-digest at 00:20 BC:

    python3 /usr/local/lib/pad-digest/pad_archive.py

and writes dated JSON under private/pad-archive/ (root only, 0600):
  ha-analytics/YYYY-MM-DD.json   HA analytics' custom_integrations.json entry for padspan_ha
                                 (HA keeps no history for custom integrations)
  site/YYYY-MM-DD.json           page loads by kind (people vs bots) and people's sources for each
                                 complete BC day still in the site's logs (Apache keeps about 15 days)
  github/                        releases and the star count, refreshed by pad_digest.py; touched here too

GitHub traffic (views, clones, referrers) needs a signed-in token, so the Mac's
~/padspan-mac/tools/outreach/markers_export.py uploads it to github-traffic/ instead.
Nothing here is an IP: addresses are only used to tell people from bots and are never stored.
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


def archive_site(archive, pattern, skip, now):
    """One file per complete BC day still in the logs; a day already archived is left alone."""
    site, sources = P.collect_site(pattern, skip, now)
    saved = 0
    for d, kinds in site.items():
        if d >= now.date():
            continue
        path = os.path.join(archive, "site", f"{d.isoformat()}.json")
        if os.path.exists(path):
            continue
        P.write_json(path, {"d": d.isoformat(), "kinds": dict(kinds), "sources": dict(sources.get(d, {}))}, 0o600)
        saved += 1
    return saved


def main(paths=None, now=None):
    p = dict(P.DEFAULTS, **(paths or {}))
    now = now or dt.datetime.now(P.BC)
    cfg = P.read_json(p["config"], {}) or {}
    skip = set(cfg.get("pings_skip_ips", []) if isinstance(cfg.get("pings_skip_ips"), list) else [])
    out = []
    try:
        out.append("ha " + archive_ha(p["archive"], now))
    except Exception as e:
        out.append(f"ha failed: {type(e).__name__}: {e}")
    out.append(f"site days saved {archive_site(p['archive'], p['site_logs'], skip, now)}")
    try:
        rel, stars, count = P.refresh_github(p["archive"], p["repo"], now)
        out.append(f"github {len(rel)} releases, {count} stars ({len(stars)} dated)")
    except Exception as e:
        out.append(f"github failed: {type(e).__name__}: {e}")
    return "; ".join(out)


if __name__ == "__main__":
    msg = main()
    print(msg)
    sys.exit(1 if "failed" in msg else 0)
