# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""pad.traks.ca's digest (server/pad_report/pad_digest.py, pad_archive.py, pad_put.py) on made-up data:
the model's shape (DIGEST.md, schema 1) and numbers, the noise bands and verdicts, release health at the
same age, BC days, failing closed, whole site days, safe writes, and the pad-only session."""

from __future__ import annotations

import datetime as dt
import importlib.util
import io
import json
import math
import os
import re
import statistics
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SRV = ROOT / "server" / "pad_report"
if not (SRV / "pad_digest.py").exists():
    pytest.skip("no server/ in this tree (the Bright derivation carries none)", allow_module_level=True)
if os.name == "nt":
    pytest.skip("the digest runs only on bcmail (Linux): its safe writes need POSIX owners, modes and O_NOFOLLOW",
                allow_module_level=True)
sys.path.insert(0, str(SRV))


def _load(name):
    spec = importlib.util.spec_from_file_location(name, SRV / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


P = _load("pad_digest")
A = _load("pad_archive")
PUT = _load("pad_put")

BC = P.BC
NOW = dt.datetime(2026, 10, 30, 12, 0, tzinfo=BC)
TODAY = NOW.date()
UA = "Mozilla/5.0 (Macintosh) Safari/605"


def day(back):
    return TODAY - dt.timedelta(days=back)


def at(d, h=9, m=0):
    return dt.datetime.combine(d, dt.time(h, m), BC)


def iso(d, h=9, m=0):
    return at(d, h, m).astimezone(dt.timezone.utc).isoformat()


def apache(t):
    return t.strftime("%d/%b/%Y:%H:%M:%S %z")


def report(iid, version, *, lag=200, unclean=0, rooms=3, calib=5, install="os", board="rpi5", ui_error=None):
    usage = {"atlas_open": 3}
    if ui_error:
        usage["ui_error:" + ui_error] = 1
    return {"install_id": iid, "version": version, "ha_version": "2026.10.4", "tier": "free",
            "env": {"maps": 1, "rooms": rooms, "scanner_positions": 2 if rooms else 0, "calibration_points": calib,
                    "scanners": 4, "hw": {"install": install, "board": board}},
            "health": {"perf": {"lag_ms": {"max": lag}, "snap_ms": {"p95": 40}}, "runs": {"unclean": unclean}},
            "usage": usage, "errors": {}}


class World:
    """A small server: pings, reports, a site log, an archive and the configs, all under tmp_path."""

    def __init__(self, tmp_path):
        tmp_path.mkdir(parents=True, exist_ok=True)
        self.t = tmp_path
        self.pings = tmp_path / "pings.log"
        self.tel = tmp_path / "telemetry"
        self.tel.mkdir()
        self.logs = tmp_path / "site.log"
        self.arch = tmp_path / "archive"
        (self.arch / "github").mkdir(parents=True)
        self.out = tmp_path / "out"
        self.out.mkdir(mode=0o700)
        self.arch.chmod(0o700)
        (tmp_path / "config.json").write_text(json.dumps({"pings_skip_ips": ["10.0.0.48"]}))
        (tmp_path / "own.json").write_text(json.dumps({"own_ips": ["10.9.0.1"]}))
        self.reports = {}
        self.ping_lines = []
        self.site_lines = []
        self.lic = (f"{day(1).isoformat()}\ttrial\t0\t2\n{day(1).isoformat()}\tlifetime\t1\t1\n{TODAY.isoformat()}\tpro\t0\t1\n")
        self.releases = [{"tag": "v0.38.150", "published_at": iso(day(60), 12), "prerelease": False},
                         {"tag": "v0.38.160", "published_at": iso(day(41), 12), "prerelease": False},
                         {"tag": "v0.38.169", "published_at": iso(day(1), 9), "prerelease": True},
                         {"tag": "v0.38.170", "published_at": iso(day(2), 15), "prerelease": False},
                         {"tag": "v0.38.171", "published_at": iso(TODAY, 8), "prerelease": True}]
        self.markers = {"posts": [[day(1).isoformat(), "Site page", "Guide: Which room is my phone in? (EN + DE)"],
                                  [TODAY.isoformat(), "GitHub PR (awesome list)", "not a site piece"]],
                        "sends": [[day(4).isoformat(), "1 Creators", 4], [day(2).isoformat(), "1 Creators", 1],
                                  [day(1).isoformat(), "2 Makers", 2], [TODAY.isoformat(), "Various", 1]],
                        "campaigns": [{"from": day(20).isoformat(), "label": "Marketplace launch", "project": "padspanHA"},
                                      {"from": day(10).isoformat(), "label": "GideonMail 0.6.x launch", "project": "GideonMail"}]}

    def ping(self, d, addr, version, h=9, m=0):
        self.ping_lines.append(f"{iso(d, h, m)}\t{addr}\t{version}\n")

    def rep(self, d, iid, version, h=10, **kw):
        self.reports.setdefault(d, []).append(json.dumps({"recv_ts": iso(d, h), "report": report(iid, version, **kw)}))

    def visit(self, t, path, ip="10.1.0.1", ua=UA, ref="-"):
        self.site_lines.append(f'{ip} - - [{apache(t)}] "GET {path} HTTP/1.1" 200 123 "{ref}" "{ua}"\n')

    def standard(self, *, regress=False, issue_today=False, stuck=0):
        """30 days of update checks from 50 addresses, 21 days of reports from 30 installs, a site log."""
        for back in range(30, -1, -1):
            d = day(back)
            for i in range(50):
                v = "0.38.170" if (i < 10 and back <= 2) else "0.38.160" if i < 40 else "0.38.150"
                if i == 49:
                    v = "-"
                self.ping(d, f"10.0.0.{i}", v, 8 if i % 2 else 15, i % 60)
        for back in range(20, -1, -1):
            d = day(back)
            for i in range(30):
                v = "0.38.160" if i < 22 else "0.38.150"
                if i < 4 and back <= 2:
                    v = "0.38.170"
                lag = 2500 if (regress and v == "0.38.160" and i % 3 != 0) else 200
                self.rep(d, f"iid-{i:04d}", v, lag=lag, ui_error="atlas" if (issue_today and back == 0 and i < 2) else None)
            if back <= 10:
                for j in range(12):
                    st = j < stuck
                    self.rep(d, f"new-{j:04d}", "0.38.160", h=11, rooms=0 if st else 3, calib=0 if st else 2,
                             install="container" if j % 2 else "os")
        # the 30 regular installs were first seen long ago (the ledger keeps that)
        (self.tel / "installs.json").write_text(json.dumps({f"iid-{i:04d}": {"first": day(60).isoformat()} for i in range(30)}))
        # site: the logs begin at 17:00 on day 15 (a rotation), then 10 demo + 6 guide loads a day by people
        self.visit(at(day(15), 17, 0), "/demo/")
        for back in range(14, -1, -1):
            for k in range(10):
                self.visit(at(day(back), 10, k), "/demo/", ip=f"10.1.0.{k}", ref="https://github.com/x" if k == 1 else "-")
            for k in range(6):
                self.visit(at(day(back), 11, k), "/guides/bermuda/", ip=f"10.2.0.{k}")
        self.visit(at(day(1), 12), "/demo/", ua="Googlebot/2.1")   # a bot: never counted
        self.visit(at(day(1), 13), "/demo/", ip="10.9.0.1")        # our own address: never counted
        return self

    def write(self):
        self.pings.write_text("".join(self.ping_lines))
        for d, recs in self.reports.items():
            (self.tel / f"{d.isoformat()}.jsonl").write_text("\n".join(recs) + "\n")
        self.logs.write_text("".join(self.site_lines))
        (self.arch / "github" / "releases.json").write_text(json.dumps(self.releases))
        (self.arch / "github" / "stars.json").write_text(json.dumps([iso(day(k), 10) for k in range(5)]))
        (self.arch / "github" / "meta.json").write_text(json.dumps({"stars_count": 7, "releases_at": NOW.timestamp(), "repo_at": NOW.timestamp()}))
        if self.markers is not None:
            (self.arch / "markers.json").write_text(json.dumps(self.markers))
        for sub in ("github",):
            (self.arch / sub).chmod(0o700)
        return self

    def paths(self):
        return {"pings": str(self.pings), "telemetry": str(self.tel), "site_logs": str(self.logs), "archive": str(self.arch),
                "out": str(self.out), "config": str(self.t / "config.json"), "own_config": str(self.t / "own.json")}

    def run(self, sql=None):
        model, state, _ = P.run(paths=self.paths(), now=NOW, run_sql=sql or (lambda q: self.lic), refresh=False)
        return model, state


def build(tmp_path, **kw):
    return World(tmp_path).standard(**kw).write().run()


# ── shape and headline ──────────────────────────────────────────────────────
def test_the_model_has_every_field_of_schema_1(tmp_path):
    m, _ = build(tmp_path)
    for k in ("ok", "schema", "generated", "generated_iso", "stale_after_s", "need", "tiles", "needs_attention", "health",
              "health_same_age", "watch", "latest", "prev", "prev2", "hours_out", "issues", "new_issues", "perf", "adopt",
              "adopt_versions", "versions_top", "setup_fail", "digest", "feed", "series", "series_all", "markers", "ba", "ns",
              "small", "funnel", "sources", "src_days", "setup28", "new15", "new15_stage", "versions24", "l24_total", "tiers",
              "lic_totals", "stars_total", "reports", "lag_series", "archive"):
        assert k in m, k
    assert m["ok"] is True and m["schema"] == 1
    assert [t["label"] for t in m["tiles"]][:2] == ["Homes checking in", "Site visits yesterday"]
    assert all("sub" in t for t in m["tiles"])
    json.dumps(m)


def test_partial_days_never_count_toward_typical_visits(tmp_path):
    w = World(tmp_path).standard()
    w.site_lines = []
    w.visit(at(day(3), 17, 0), "/demo/")  # the logs begin at 17:00 on day 3
    for back in (2, 1):
        for k in range(16):
            w.visit(at(day(back), 10, k), "/demo/" if k < 10 else "/guides/bermuda/", ip=f"10.1.0.{k}")
    m, _ = w.write().run()
    t = m["tiles"][1]
    assert (t["value"], t["cmp"], t["spark"]) == (16, "typical 16", [16, 16])


def test_site_visits_yesterday_need_yesterday_whole(tmp_path):
    w = World(tmp_path).standard()
    w.site_lines = []
    w.visit(at(day(1), 17, 0), "/demo/")
    w.visit(at(day(1), 18, 0), "/guides/bermuda/")
    m, _ = w.write().run()
    t = m["tiles"][1]
    assert (t["value"], t["delta"], t["state"], t["sub"]) == (0, None, "info", None)
    assert t["cmp"] == "no whole log for yesterday"


def test_site_visits_yesterday_counts_people_on_the_demo_and_guides_only(tmp_path):
    m, _ = build(tmp_path)
    t = m["tiles"][1]
    assert t["value"] == 16 and t["sub"] == "demo 10 · guides 6", "the bot and our own address are left out"
    assert t["cmp"] == "typical 16" and t["delta"] == 0 and t["state"] == "normal"
    assert t["spark"] == [16] * 14, "whole days only: the rotation day isn't one"


def test_a_spike_in_site_visits_is_above_normal_and_named_in_the_digest(tmp_path):
    w = World(tmp_path).standard()
    for k in range(60):
        w.visit(at(day(1), 14, k % 60), "/guides/large-homes/", ip=f"10.3.0.{k}")
    m, _ = w.write().run()
    t = m["tiles"][1]
    assert t["value"] == 76 and t["state"] == "above"
    assert any(line.startswith("Site visits yesterday: 76 people") for line in m["digest"]["Marketing"])


def test_nothing_counts_today_so_far(tmp_path):
    m, _ = build(tmp_path)
    text = json.dumps(m["digest"]) + json.dumps(m["tiles"])
    assert "Today so far" not in text and not re.search(r"\bby \d{2}:\d{2}\b", text)
    assert all("today" not in line.lower() for line in m["digest"]["Growth"] + m["digest"]["Money"])


def test_homes_a_day_leave_out_the_skip_list_and_today(tmp_path):
    m, _ = build(tmp_path)
    assert m["ns"]["yday"] == 49 and m["tiles"][0]["value"] == 49
    assert m["series_all"][-1]["d"] == day(1).isoformat(), "today isn't a whole day yet"


def test_versions_top_five_with_other_and_unknown_folded_in(tmp_path):
    w = World(tmp_path).standard()
    for i, v in enumerate(["0.38.140"] * 3 + ["0.38.130"] * 2 + ["0.38.120"] + ["-"] * 4):
        w.ping(TODAY, f"10.6.0.{i}", v, 8)
    m, _ = w.write().run()
    vt = m["versions_top"]
    assert vt["total"] == 59
    assert [(r["v"], r["n"]) for r in vt["rows"]] == [("0.38.160", 30), ("0.38.170", 10), ("0.38.150", 8), ("0.38.140", 3), ("0.38.130", 2)]
    assert [r["adopted"] for r in vt["rows"]] == [True, True, True, False, False], "adopted at 10% of the last 24 h"
    assert [r["stable"] for r in vt["rows"]] == [True, True, True, False, False]
    assert vt["other"] == {"n": 6, "share": 10.2, "versions": 2}, "0.38.120 and the 5 unknown '-' fold into Other"


# ── the noise band and the before/after verdict ─────────────────────────────
def _mad(v):
    if len(v) < 3:
        return 0
    m = statistics.median(v)
    return 1.4826 * statistics.median([abs(x - m) for x in v])


def _expected_band(vals):
    """lo, avg, hi for the last of vals, from the definition in DIGEST.md: a 7-day average and 3 sigma,
    sigma = max(1.4826 x MAD of the last 28 residuals, 2)."""
    avg = [sum(vals[max(0, i - 6): i + 1]) / len(vals[max(0, i - 6): i + 1]) for i in range(len(vals))]
    resid = [v - a for v, a in zip(vals, avg)]
    s = max(_mad(resid[-28:]), 2.0)
    return round(avg[-1] - 3 * s, 1), round(avg[-1], 1), round(avg[-1] + 3 * s, 1), s


def _counts_world(tmp_path, counts, push_back):
    """Exact homes a day (oldest first, ending yesterday) and one outreach send push_back days ago."""
    w = World(tmp_path).standard()
    w.ping_lines = []
    n = len(counts)
    for idx, c in enumerate(counts):
        d = day(n - idx)
        for i in range(c):
            w.ping(d, f"10.5.{i // 250}.{i % 250}", "0.38.160")
    for i in range(5):
        w.ping(TODAY, f"10.5.0.{i}", "0.38.170", 8)
    w.markers["sends"] = [[day(push_back).isoformat(), "1 Creators", 3]]
    return w.write().run()


NOISY = [100 + (30 if i % 2 else -30) for i in range(12)] + [100 + ((i * 7) % 11) * 2 - 10 for i in range(28)]


def test_the_noise_band_is_three_sigma_around_the_seven_day_average(tmp_path):
    m, _ = _counts_world(tmp_path, NOISY, 3)
    lo, avg, hi, s = _expected_band(NOISY)
    assert s > 5, "the test needs sigma off its floor"
    last = m["series_all"][-1]
    assert (last["v"], last["lo"], last["avg"], last["hi"]) == (NOISY[-1], lo, avg, hi)
    assert m["ns"]["sig"] == round(s, 1), "sigma from the last 28 days only (the wild first 12 are left out)"
    assert m["ns"]["typ"] == statistics.median(NOISY[-8:-1])
    for i in range(7, len(NOISY)):
        lo_i, avg_i, hi_i, _ = _expected_band(NOISY[: i + 1])
        assert (m["series_all"][i]["lo"], m["series_all"][i]["avg"], m["series_all"][i]["hi"]) == (lo_i, avg_i, hi_i), i


def test_a_flat_series_gets_the_sigma_floor_of_two(tmp_path):
    m, _ = _counts_world(tmp_path, [100] * 30, 3)
    last = m["series_all"][-1]
    assert (last["lo"], last["avg"], last["hi"]) == (94.0, 100.0, 106.0) and m["ns"]["sig"] == 2.0


@pytest.mark.parametrize("last, state", [(200, "above"), (106, "normal"), (20, "below")])
def test_homes_beyond_three_sigma_are_above_or_below(tmp_path, last, state):
    m, _ = _counts_world(tmp_path, NOISY[:-1] + [last], 3)
    assert m["tiles"][0]["value"] == last and m["tiles"][0]["state"] == state
    assert m["digest"]["Growth"][0] == f"{last} homes checked in yesterday (typical {m['ns']['typ']:.0f}, {state})."
    assert any(i["kind"] == "growth" for i in m["needs_attention"]) == (state == "below")


def test_the_two_proportion_test():
    assert P.diff_sig(19, 19, 0, 30), "lag in every home against none is a difference"
    assert P.diff_sig(10, 25, 4, 30) and not P.diff_sig(8, 25, 4, 30), "z of 2.3 counts, 1.7 doesn't"
    assert not P.diff_sig(0, 10, 0, 10) and not P.diff_sig(5, 5, 5, 5) and not P.diff_sig(3, 0, 1, 10)


def test_dates_print_without_a_leading_zero_on_every_platform():
    assert P._fmt(dt.datetime(2026, 11, 4, 9, 5, tzinfo=BC), "%a %b %-d, %H:%M") == "Wed Nov 4, 09:05"


def test_the_verdict_edges_and_the_mad_sigma():
    assert P.verdict(13.01, 10, 1) == "above" and P.verdict(13, 10, 1) == "normal" and P.verdict(12.5, 10, 1) == "normal"
    assert P.verdict(6.99, 10, 1) == "below" and P.verdict(7, 10, 1) == "normal" and P.verdict(50, 10, 0) == "normal"
    assert P.mad_sigma([1, 2, 3, 4, 100]) == pytest.approx(1.4826)
    assert P.mad_sigma([5, 9]) == 0


@pytest.mark.parametrize("after, days_after, verdict", [
    (130, 14, "lift"), (70, 14, "drop"), (100, 14, "no detectable change"), (130, 13, "too early"), (130, 20, "lift")])
def test_the_before_after_verdict(tmp_path, after, days_after, verdict):
    # before the push: 80 long ago, then 90 for 7 days and 110 for 7: only the 14 days before average 100
    counts = [80] * 16 + [90] * 7 + [110] * 7 + [after] * days_after
    m, _ = _counts_world(tmp_path, counts, days_after)
    ba = m["ba"]
    assert ba["push"] == day(days_after).isoformat()
    assert ba["after_days"] == days_after and ba["after"] == after and ba["before"] == 100.0
    assert ba["diff"] == round(after - 100, 1)
    assert round(ba["sig"], 1) == m["ns"]["sig"]
    assert ba["band"] == round(3 * ba["sig"] * math.sqrt(1 / days_after + 1 / 14), 1)
    assert ba["verdict"] == verdict


@pytest.mark.parametrize("after, verdict", [(102, "no detectable change"), (103, "lift"), (98, "no detectable change"), (97, "drop")])
def test_the_before_after_band_edges(tmp_path, after, verdict):
    # sigma at its floor of 2: band = 3 x 2 x sqrt(1/14 + 1/14) = 2.3
    m, _ = _counts_world(tmp_path, [100] * 30 + [after] * 14, 14)
    assert m["ba"]["band"] == 2.3 and m["ba"]["verdict"] == verdict


# ── release health at the same age ──────────────────────────────────────────
def _same_age_world(tmp_path, *, latest_homes, latest_lagging, prev_lagging):
    """0.38.170, the latest stable, was published late on day 4 and first checked in on day 3; 0.38.160 was
    published on day 46 and first checked in on day 45. Same age = 3 days, so 0.38.160's window is days
    45..42. Reports outside it (day 41, day 30) lag in every home and must not count."""
    w = World(tmp_path).standard()
    w.reports, w.ping_lines = {}, []
    for back in range(45, -1, -1):
        for i in range(40):
            w.ping(day(back), f"10.0.1.{i}", "0.38.160" if back > 3 else "0.38.170")
    for back in (45, 44, 43, 42):
        for i in range(30):
            w.rep(day(back), f"p-{i}", "0.38.160", lag=2500 if i < prev_lagging else 200)
    for back in (41, 30):
        for i in range(30):
            w.rep(day(back), f"p-{i}", "0.38.160", lag=2500)
    for back in (3, 2, 1, 0):
        for i in range(latest_homes):
            w.rep(day(back), f"l-{i}", "0.38.170", lag=2500 if i < latest_lagging else 200)
    w.releases = [{"tag": "v0.38.150", "published_at": iso(day(80), 12), "prerelease": False},
                  {"tag": "v0.38.160", "published_at": iso(day(46), 12), "prerelease": False},
                  {"tag": "v0.38.170", "published_at": iso(day(4), 22), "prerelease": False}]
    return w.write().run()


def test_same_age_compares_each_release_from_its_first_check_in(tmp_path):
    m, _ = _same_age_world(tmp_path, latest_homes=20, latest_lagging=12, prev_lagging=3)
    sa = m["health_same_age"]
    assert sa["age_days"] == 3, "counted from the first check-in on day 3, not the release on day 4"
    assert sa["latest"]["first_day"] == day(3).isoformat() and sa["latest"]["window"] == [day(3).isoformat(), TODAY.isoformat()]
    assert sa["prev"]["first_day"] == day(45).isoformat()
    assert sa["prev"]["window"] == [day(45).isoformat(), day(42).isoformat()]
    assert (sa["prev"]["homes"], sa["prev"]["lag_1s"]) == (30, 3), "the all-lagging reports after the window must not count"
    assert (sa["latest"]["homes"], sa["latest"]["lag_1s"]) == (20, 12)


def test_same_age_flags_a_newer_release_that_is_worse(tmp_path):
    m, _ = _same_age_world(tmp_path, latest_homes=20, latest_lagging=12, prev_lagging=3)
    sa = m["health_same_age"]
    assert not sa["too_early"], "20 opt-in homes is enough to judge"
    assert sa["watch"] == [{"what": "Event-loop lag over 1 s", "a": [12, 20], "b": [3, 30], "version": "0.38.170"}]
    top = m["needs_attention"][0]
    assert top["kind"] == "regression" and top["title"] == "Event-loop lag over 1 s on 0.38.170" and "same age" in top["detail"]


def test_same_age_never_flags_a_newer_release_that_is_better(tmp_path):
    m, _ = _same_age_world(tmp_path, latest_homes=25, latest_lagging=0, prev_lagging=15)
    sa = m["health_same_age"]
    assert sa["watch"] == [] and sa["note"] == "0.38.170 on day 3: no worse than 0.38.160 was at the same age."
    assert not any(i["kind"] == "regression" for i in m["needs_attention"])


def test_too_early_under_twenty_homes_is_never_flagged(tmp_path):
    m, _ = _same_age_world(tmp_path, latest_homes=19, latest_lagging=15, prev_lagging=0)
    sa = m["health_same_age"]
    assert sa["too_early"] and sa["watch"] == []
    assert sa["note"] == "Too early: 19 opt-in homes on 0.38.170 after 3 days; judged from 20."
    assert not any(i["kind"] == "regression" for i in m["needs_attention"])


# ── BC days ─────────────────────────────────────────────────────────────────
def test_reports_land_on_their_bc_day():
    assert P.report_day({"recv_ts": "2026-10-30T05:30:00Z"}, "x") == dt.date(2026, 10, 29)
    assert P.report_day({"recv_ts": "2026-10-30T07:30:00Z"}, "x") == dt.date(2026, 10, 30)
    assert P.report_day({"recv_day": "2026-10-28"}, "2026-10-01") == dt.date(2026, 10, 28)


def test_site_log_lines_land_on_their_bc_day():
    assert P.site_day("30/Oct/2026:06:30:00 +0000").date() == dt.date(2026, 10, 29)
    assert P.site_day("30/Oct/2026:07:30:00 +0000").date() == dt.date(2026, 10, 30)
    assert P.site_day("29/Oct/2026:23:30:00 -0700").date() == dt.date(2026, 10, 29)


def test_report_files_and_site_logs_are_read_by_bc_day(tmp_path):
    tel = tmp_path / "tel"
    tel.mkdir()
    rec = {"recv_ts": "2026-10-30T05:30:00Z", "report": report("iid-x", "0.38.170")}
    (tel / "2026-10-30.jsonl").write_text(json.dumps(rec) + "\n")
    rows, first = P.collect_reports(str(tel), NOW)
    assert list(rows) == [("iid-x", dt.date(2026, 10, 29))] and first == {"iid-x": dt.date(2026, 10, 29)}
    log = tmp_path / "access.log"
    log.write_text("".join(f'10.1.0.{i} - - [{ts}] "GET /demo/ HTTP/1.1" 200 1 "-" "{UA}"\n' for i, ts in enumerate(
        ("29/Oct/2026:00:00:00 -0700", "30/Oct/2026:06:30:00 +0000", "30/Oct/2026:07:30:00 +0000"))))
    site, _, complete = P.collect_site(str(log), set(), NOW)
    assert {d: c["demo"] for d, c in site.items()} == {dt.date(2026, 10, 29): 2, dt.date(2026, 10, 30): 1}
    assert complete == {dt.date(2026, 10, 29)}, "the log begins at 00:00 BC on Oct 29, and Oct 30 isn't over"


def test_an_empty_pings_log_stops_the_run(tmp_path):
    f = tmp_path / "p.log"
    f.write_text("not a check\n")
    with pytest.raises(P.SourceError):
        P.collect_pings(str(f), set(), NOW)


def test_update_checks_land_on_their_bc_day(tmp_path):
    f = tmp_path / "p.log"
    f.write_text("2026-10-30T06:59:59+00:00\t10.0.0.1\t0.38.1\n2026-10-30T07:00:01+00:00\t10.0.0.2\t0.38.1\n")
    pg = P.collect_pings(str(f), set(), NOW)
    assert pg["per_day"] == {dt.date(2026, 10, 29): 1, dt.date(2026, 10, 30): 1}


# ── failing closed ──────────────────────────────────────────────────────────
def test_a_licence_database_that_fails_stops_the_run(tmp_path):
    w = World(tmp_path).standard().write()
    with pytest.raises(P.SourceError):
        w.run(sql=lambda q: "")
    with pytest.raises(P.SourceError):
        w.run(sql=lambda q: "ERROR 2002 (HY000): Can't connect\n")

    def down(q):
        raise P.SourceError("mysql exited 1")
    with pytest.raises(P.SourceError):
        w.run(sql=down)


def test_unreadable_reports_stop_the_run(tmp_path):
    w = World(tmp_path).standard().write()
    victim = tmp_path / "other.jsonl"
    victim.write_text("{}\n")
    f = sorted(w.tel.glob("*.jsonl"))[0]
    f.unlink()
    f.symlink_to(victim)
    with pytest.raises(P.SourceError):
        w.run()
    w2 = World(tmp_path / "b").standard().write()
    for f in w2.tel.glob("*"):
        f.unlink()
    with pytest.raises(P.SourceError):
        w2.run()
    w3 = World(tmp_path / "c").standard().write()
    w3.tel.rename(tmp_path / "c" / "real-tel")
    w3.tel.symlink_to(tmp_path / "c" / "real-tel")
    with pytest.raises(P.SourceError):
        w3.run()


def test_missing_pings_or_markers_stop_the_run(tmp_path):
    w = World(tmp_path).standard().write()
    w.pings.unlink()
    with pytest.raises(P.SourceError):
        w.run()
    w2 = World(tmp_path / "b").standard()
    w2.markers = None
    with pytest.raises(P.SourceError):
        w2.write().run()
    w3 = World(tmp_path / "c").standard().write()
    w3.logs.unlink()
    with pytest.raises(P.SourceError):
        w3.run()
    w4 = World(tmp_path / "d").standard()
    w4.releases = []
    with pytest.raises(P.SourceError):
        w4.write().run()


def test_a_failed_run_keeps_the_last_good_model(tmp_path):
    w = World(tmp_path).standard().write()
    model = w.out / "model.json"
    assert P.main(paths=w.paths(), now=NOW, run_sql=lambda q: w.lic, refresh=False, gid=None) == 0
    good = model.read_bytes()
    assert oct(model.stat().st_mode & 0o777) == "0o640" and oct((w.out / "attention-state.json").stat().st_mode & 0o777) == "0o600"
    assert P.main(paths=w.paths(), now=NOW, run_sql=lambda q: "", refresh=False, gid=None) == 1
    assert model.read_bytes() == good


# ── whole site days ─────────────────────────────────────────────────────────
def test_the_rotation_day_is_partial_and_shows_as_no_data(tmp_path):
    w = World(tmp_path).standard().write()
    site, src, complete = P.collect_site(str(w.logs), set(), NOW)
    assert day(15) in site and day(15) not in complete and day(14) in complete and TODAY not in complete
    m, _ = w.run()
    by_day = {s["d"]: s["v"] for s in m["small"]["site"]}
    assert by_day.get(day(15).isoformat()) is None and by_day[day(14).isoformat()] == 16


def test_a_partial_day_never_replaces_a_complete_one(tmp_path):
    w = World(tmp_path).standard()
    for k in range(60):  # the partial day's evening alone outnumbers the whole day archived before
        w.visit(at(day(15), 18, k), "/demo/", ip=f"10.4.0.{k}")
    w.write()
    (w.arch / "site").mkdir(mode=0o700)
    whole = {"d": day(15).isoformat(), "complete": True, "kinds": {"demo": 40, "guide": 9}, "sources": {}}
    (w.arch / "site" / f"{day(15).isoformat()}.json").write_text(json.dumps(whole))
    A.archive_site(str(w.arch), str(w.logs), set(), NOW)
    assert json.loads((w.arch / "site" / f"{day(15).isoformat()}.json").read_text()) == whole
    saved = json.loads((w.arch / "site" / f"{day(14).isoformat()}.json").read_text())
    assert saved["complete"] is True and saved["kinds"]["demo"] == 10
    m, _ = w.run()
    assert {s["d"]: s["v"] for s in m["small"]["site"]}[day(15).isoformat()] == 49, "the archive's whole day wins"


def test_a_partial_archived_day_is_replaced_by_a_complete_one(tmp_path):
    w = World(tmp_path).standard().write()
    (w.arch / "site").mkdir(mode=0o700)
    (w.arch / "site" / f"{day(14).isoformat()}.json").write_text(json.dumps({"d": day(14).isoformat(), "complete": False, "kinds": {"demo": 1}}))
    m, _ = w.run()
    assert {s["d"]: s["v"] for s in m["small"]["site"]}[day(14).isoformat()] == 16, "the live whole day wins"
    A.archive_site(str(w.arch), str(w.logs), set(), NOW)
    assert json.loads((w.arch / "site" / f"{day(14).isoformat()}.json").read_text())["complete"] is True


# ── safe writes ─────────────────────────────────────────────────────────────
def test_writes_refuse_a_directory_others_can_write(tmp_path):
    d = tmp_path / "shared"
    d.mkdir()
    d.chmod(0o777)
    with pytest.raises(P.UnsafePath):
        P.write_json(str(d / "m.json"), {"a": 1})
    d.chmod(0o775)
    with pytest.raises(P.UnsafePath):
        P.write_json(str(d / "m.json"), {"a": 1})


def test_writes_refuse_an_open_parent_or_a_symlinked_directory(tmp_path):
    shared = tmp_path / "open"
    inner = shared / "inner"
    inner.mkdir(parents=True, mode=0o700)
    shared.chmod(0o777)
    with pytest.raises(P.UnsafePath):
        P.write_json(str(inner / "m.json"), {"a": 1})
    shared.chmod(0o1777)  # sticky, like /tmp: no one else can swap our entries
    P.write_json(str(inner / "m.json"), {"a": 1})
    shared.chmod(0o755)
    link = tmp_path / "link"
    link.symlink_to(inner)
    with pytest.raises(P.UnsafePath):
        P.write_json(str(link / "m.json"), {"a": 1})


def test_mode_and_owner_are_never_set_by_path(tmp_path, monkeypatch):
    def by_path(*a, **k):
        raise AssertionError("chmod or chown by path")
    for name in ("chmod", "chown", "lchown", "lchmod"):
        if hasattr(os, name):
            monkeypatch.setattr(os, name, by_path)
    d = tmp_path / "out"
    d.mkdir(mode=0o700)
    P.write_json(str(d / "model.json"), {"a": 1}, 0o640, os.getegid())
    assert oct((d / "model.json").stat().st_mode & 0o777) == "0o640"


def test_the_group_is_set_on_the_open_file(tmp_path):
    d = tmp_path / "out"
    d.mkdir(mode=0o700)
    other = [g for g in os.getgroups() if g != d.stat().st_gid]
    if not other:
        pytest.skip("this user is in only one group")
    P.write_json(str(d / "model.json"), {"a": 1}, 0o640, other[0])
    st = (d / "model.json").stat()
    assert st.st_gid == other[0] and st.st_uid == os.geteuid() and oct(st.st_mode & 0o777) == "0o640"


def test_a_write_replaces_a_planted_symlink_and_never_follows_it(tmp_path):
    d = tmp_path / "out"
    d.mkdir(mode=0o700)
    victim = tmp_path / "victim"
    victim.write_text("keep me")
    victim.chmod(0o644)
    (d / "model.json").symlink_to(victim)
    P.write_json(str(d / "model.json"), {"a": 1}, 0o640)
    assert not (d / "model.json").is_symlink() and json.loads((d / "model.json").read_text()) == {"a": 1}
    assert victim.read_text() == "keep me" and oct(victim.stat().st_mode & 0o777) == "0o644"
    assert oct((d / "model.json").stat().st_mode & 0o777) == "0o640"
    assert not [p for p in d.iterdir() if p.name.startswith(".tmp-")]


def test_sources_are_never_read_through_a_symlink_or_from_a_fifo(tmp_path):
    real = tmp_path / "real.log"
    real.write_text("2026-10-29T10:00:00+00:00\t10.0.0.1\t0.38.1\n")
    link = tmp_path / "link.log"
    link.symlink_to(real)
    with pytest.raises(P.SourceError):
        P.collect_pings(str(link), set(), NOW)
    fifo = tmp_path / "fifo.log"
    os.mkfifo(fifo)
    for not_a_file in (fifo, tmp_path):
        with pytest.raises(P.SourceError):
            P.open_source(str(not_a_file))


# ── pad_put: the Mac's uploads ──────────────────────────────────────────────
def test_pad_put_takes_only_its_names_and_shapes(tmp_path):
    arch = tmp_path / "a"
    arch.mkdir(mode=0o700)
    for good in ("markers.json", "github/stars.json", "github-traffic/2026-10-30.json"):
        assert PUT.check_name(good)
    for bad in ("../x.json", "/etc/passwd", "github-traffic/../../x.json", "markers.json/../x", "site/2026-10-30.json", "github/stars.json.tmp"):
        with pytest.raises(ValueError):
            PUT.check_name(bad)
    with pytest.raises(ValueError):
        PUT.put(str(arch), "markers.json", b"[1, 2]")
    with pytest.raises(ValueError):
        PUT.put(str(arch), "markers.json", b"{not json")
    with pytest.raises(ValueError):
        PUT.put(str(arch), "markers.json", b'{"a": "' + b"x" * PUT.MAX_BYTES + b'"}')
    assert not (arch / "markers.json").exists()


def test_pad_put_strips_addresses_and_writes_safely(tmp_path):
    arch = tmp_path / "a"
    arch.mkdir(mode=0o700)
    raw = json.dumps({"posts": [["2026-10-30", "Site page", "Sent by someone@example.com from 203.0.113.7"]], "sends": [], "campaigns": []})
    assert PUT.main(["markers.json"], io.BytesIO(raw.encode()), str(arch)) == 0
    f = arch / "markers.json"
    assert "@" not in f.read_text() and "203.0" not in f.read_text() and "(address)" in f.read_text()
    assert oct(f.stat().st_mode & 0o777) == "0o600"
    assert PUT.main(["github-traffic/2026-10-30.json"], io.BytesIO(b'{"views": []}'), str(arch)) == 0
    assert (arch / "github-traffic" / "2026-10-30.json").exists()
    assert PUT.main(["../x.json"], io.BytesIO(b"{}"), str(arch)) == 1
    assert not (tmp_path / "x.json").exists()
    arch.chmod(0o777)
    assert PUT.main(["markers.json"], io.BytesIO(raw.encode()), str(arch)) == 1, "never into a directory others can write"
    arch.chmod(0o700)


def test_scrub_is_quick_on_a_long_token():
    long = "x" * 50_000
    t0 = time.monotonic()
    assert P.scrub(long + " a.b@example.com " + long) == long + " (address) " + long
    assert P.scrub(long * 4) == long * 4
    assert time.monotonic() - t0 < 2, "the address patterns must stay linear: an upload may be 2 MB"


def test_markers_lose_addresses_before_the_page_even_if_uploaded_raw(tmp_path):
    w = World(tmp_path).standard()
    w.markers["posts"].append([day(1).isoformat(), "Site page", "Guide mailed to someone@example.com"])
    m, _ = w.write().run()
    assert "@" not in json.dumps(m)


# ── the page's other rules ──────────────────────────────────────────────────
def test_attention_is_empty_when_all_is_fine(tmp_path):
    m, _ = build(tmp_path)
    assert m["needs_attention"] == [] and m["need"] == 0
    assert m["digest"]["Problems"] == ["No new or regressed issues in the last 3 days."]


def test_a_regression_and_a_new_issue_need_attention_then_age_out_unless_growing(tmp_path):
    w = World(tmp_path).standard(regress=True, issue_today=True).write()
    m, state = w.run()
    kinds = [i["kind"] for i in m["needs_attention"]]
    assert kinds[0] == "regression" and "issue" in kinds and m["need"] == len(kinds)
    reg = m["needs_attention"][0]
    assert reg["title"].startswith("Event-loop lag over 1 s on 0.38.160") and reg["homes"] < reg["of"]
    assert m["tiles"][4]["state"] == "watch"
    key = reg["key"]
    old = day(8).isoformat()
    state["attention"][key] = {"first_seen": old, "hist": {day(1).isoformat(): reg["homes"]}, "last_seen": old}
    (w.out / "attention-state.json").write_text(json.dumps(state))
    m2, _ = w.run()
    assert key not in [i["key"] for i in m2["needs_attention"]]
    state["attention"][key] = {"first_seen": old, "hist": {day(1).isoformat(): reg["homes"] - 3}, "last_seen": old}
    (w.out / "attention-state.json").write_text(json.dumps(state))
    m3, _ = w.run()
    kept = [i for i in m3["needs_attention"] if i["key"] == key]
    assert kept and kept[0]["growing"] and kept[0]["days_listed"] == 8


def test_failing_setups_are_flagged_over_the_threshold_with_splits(tmp_path):
    m, _ = build(tmp_path, stuck=6)
    sf = m["setup_fail"]
    assert sf["total"] == 12 and sf["failing"] == 6 and sf["rate"] == 50.0 and sf["over"]
    assert {r["k"]: (r["failing"], r["of"]) for r in sf["by"]["install_type"]} == {"os": (3, 6), "container": (3, 6)}
    assert any(i["kind"] == "setup" for i in m["needs_attention"])
    m2, _ = build(tmp_path / "b", stuck=2)
    assert m2["setup_fail"]["failing"] == 2 and not m2["setup_fail"]["over"]


def test_markers_span_their_dates_and_other_products_are_left_out(tmp_path):
    w = World(tmp_path).standard()
    w.markers["campaigns"].append({"from": day(5).isoformat(), "label": "Pre-launch teaser", "project": "padspanHA", "kind": "campaign"})
    m, _ = w.write().run()
    mk = m["markers"]
    assert [r["kind"] for r in mk["ranges"] if r["label"] == "Pre-launch teaser"] == ["campaign"], "the marker's own kind wins"
    creators = [r for r in mk["ranges"] if r["label"] == "Outreach: 1 Creators"][0]
    assert (creators["from"], creators["to"]) == (day(4).isoformat(), day(2).isoformat())
    labels = [r["label"] for r in mk["ranges"]]
    assert "Marketplace launch" in labels and not any("GideonMail" in x for x in labels)
    assert [r["kind"] for r in mk["ranges"] if r["label"] == "Marketplace launch"] == ["launch"]
    assert mk["campaign"]["label"] == "Outreach emails, 2 waves", "'Various' is not a wave"


def test_money_stars_funnel_and_archive(tmp_path):
    m, _ = build(tmp_path)
    assert m["tiles"][5]["value"] == 3 and m["tiles"][5]["cmp"] == "1 paid"
    assert m["stars_total"] == 7, "the repo's count wins over a dated list that lags"
    assert m["src_days"] == 14 and m["funnel"][1]["n"] == 140, "14 whole days of 10 demo loads, bots and us left out"
    assert dict(m["sources"])["GitHub"] == 14
    assert m["funnel"][2]["n"] == 12, "new opt-in installs first seen in the window (the ledger dates the old ones)"
    assert m["funnel"][3]["n"] == 2, "trials over the whole days ending yesterday"


def test_our_own_addresses_leave_the_site_counts_but_not_the_homes(tmp_path):
    w = World(tmp_path)
    pings_skip, site_skip = P.skip_lists(w.paths())
    assert pings_skip == {"10.0.0.48"} and site_skip == {"10.0.0.48", "10.9.0.1"}
    (tmp_path / "own.json").write_text(json.dumps({"own_ips": "10.9.0.1"}))
    assert P.skip_lists(w.paths())[1] == {"10.0.0.48"}, "a malformed list is ignored, not split into characters"


def test_nothing_in_the_model_names_an_address_a_home_or_a_person(tmp_path):
    m, _ = build(tmp_path, regress=True, issue_today=True, stuck=3)
    s = json.dumps(m)
    assert not re.search(r"\b10\.\d+\.\d+\.\d+\b", s) and "iid-" not in s and "new-0" not in s and "@" not in s
    assert {w["home"] for w in m["perf"]["worst"]} <= {"home A", "home B", "home C", "home D", "home E"}


# ── the PHP and the page ────────────────────────────────────────────────────
def test_every_pad_endpoint_checks_the_pad_only_session_key():
    for name in ("digest.php", "data.php", "pro.php"):
        src = (SRV / name).read_text(encoding="utf-8")
        assert "empty($_SESSION['pad_ok'])" in src, name
        assert "$_SESSION['ok']" not in src, name
    idx = (SRV / "index.php").read_text(encoding="utf-8")
    assert "$_SESSION['pad_ok'] = 1" in idx and "$signed = !empty($_SESSION['pad_ok'])" in idx
    assert "$_SESSION['ok']" not in idx


def test_digest_php_serves_the_root_owned_model_only_to_a_signed_in_session():
    src = (SRV / "digest.php").read_text(encoding="utf-8")
    gate = src.index("empty($_SESSION['pad_ok'])")
    assert src.index("http_response_code(403)") > gate and src.index("readfile(") > src.index("http_response_code(403)")
    assert "$model = '/var/lib/pad-digest/model.json';" in src and "private" not in src


def test_the_page_takes_launch_dates_from_the_markers_and_shows_the_sub_line():
    js = (SRV / "pad.js").read_text(encoding="utf-8")
    assert "Nov 4" not in js and "M.markers && M.markers.ranges" in js
    assert "if (t.sub)" in js


def test_github_refresh_keeps_what_it_got_when_paging_fails(tmp_path):
    arch = tmp_path / "a"
    arch.mkdir(mode=0o700)

    def fetch(url, accept=None):
        if "/releases" in url:
            if url.endswith("&page=1"):
                return [{"tag_name": "v0.38.170", "published_at": "2026-10-28T22:00:00Z", "prerelease": False, "draft": False}]
            raise OSError("HTTP Error 422: Unprocessable Entity")
        return {"stargazers_count": 291}
    rel, stars, count = P.refresh_github(str(arch), "x/y", NOW, fetch)
    assert [r["tag"] for r in rel] == ["v0.38.170"] and count == 291 and stars == []
    assert "422" in json.loads((arch / "github" / "meta.json").read_text())["releases_error"]
