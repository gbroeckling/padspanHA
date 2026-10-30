# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""pad.traks.ca's digest (server/pad_report/pad_digest.py) on made-up data: the model's shape
(DIGEST.md, schema 1), its numbers, the release-health and attention rules, and that nothing in it
names a home, a person or an address."""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if not (ROOT / "server" / "pad_report" / "pad_digest.py").exists():
    pytest.skip("no server/ in this tree (the Bright derivation carries none)", allow_module_level=True)
_spec = importlib.util.spec_from_file_location("pad_digest", ROOT / "server" / "pad_report" / "pad_digest.py")
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)

BC = P.BC
NOW = dt.datetime(2026, 10, 30, 12, 0, tzinfo=BC)
TODAY = NOW.date()


def _iso(d, h=9, m=0):
    return dt.datetime.combine(d, dt.time(h, m), BC).astimezone(dt.timezone.utc).isoformat()


def _report(iid, version, *, lag=200, unclean=0, maps=1, rooms=3, calib=5, install="os", board="rpi5", ha="2026.10.4", ui_error=None):
    usage = {"atlas_open": 3}
    if ui_error:
        usage["ui_error:" + ui_error] = 1
    return {"install_id": iid, "version": version, "ha_version": ha, "tier": "free",
            "env": {"maps": maps, "rooms": rooms, "scanner_positions": 2 if rooms else 0, "calibration_points": calib,
                    "scanners": 4, "hw": {"install": install, "board": board}},
            "health": {"perf": {"lag_ms": {"max": lag}, "snap_ms": {"p95": 40}}, "runs": {"unclean": unclean}},
            "usage": usage, "errors": {}}


def make_world(tmp_path, *, regress=False, issue_today=False, stuck=0):
    """30 days of update checks from 50 addresses, opt-in reports from 30 installs, a site log, licences,
    releases (stables 0.38.150, 0.38.160, 0.38.170 + betas), stars and the workbook's markers."""
    pings = tmp_path / "pings.log"
    lines = []
    for back in range(30, -1, -1):
        d = TODAY - dt.timedelta(days=back)
        for i in range(50):
            v = "0.38.170" if (i < 10 and back <= 2) else "0.38.160" if i < 40 else "0.38.150"
            if i == 49:
                v = "-"
            hour = 8 if i % 2 else 15  # half before noon, half after
            lines.append(f"{_iso(d, hour, i % 60)}\t10.0.0.{i}\t{v}\n")
    pings.write_text("".join(lines))

    tel = tmp_path / "telemetry"
    tel.mkdir()
    for back in range(20, -1, -1):
        d = TODAY - dt.timedelta(days=back)
        recs = []
        for i in range(30):
            iid = f"iid-{i:04d}"
            v = "0.38.160" if i < 22 else "0.38.150"
            if i < 4 and back <= 2:
                v = "0.38.170"
            lag = 200
            if regress and v == "0.38.160" and i % 3 != 0:
                lag = 2500          # 0.38.160 stalls on 2 of 3 homes; 0.38.150 never does
            ui = "atlas" if (issue_today and back == 0 and i < 2) else None
            rec = {"recv_ts": _iso(d, 10), "report": _report(iid, v, lag=lag, ui_error=ui)}
            recs.append(json.dumps(rec))
        # new installs: first seen 10 days ago; `stuck` of them never get past the map
        if back <= 10:
            for j in range(12):
                iid = f"new-{j:04d}"
                st = j < stuck
                recs.append(json.dumps({"recv_ts": _iso(d, 11), "report": _report(
                    iid, "0.38.160", rooms=0 if st else 3, calib=0 if st else 2, install="container" if j % 2 else "os")}))
        (tel / f"{d.isoformat()}.jsonl").write_text("\n".join(recs) + "\n")
    # the 30 regular installs were first seen long ago (the ledger keeps that), so they aren't new setups
    (tel / "installs.json").write_text(json.dumps({f"iid-{i:04d}": {"first": (TODAY - dt.timedelta(days=60)).isoformat()} for i in range(30)}))

    logs = tmp_path / "site.log"
    ua = "Mozilla/5.0 (Macintosh) Safari/605"
    logs.write_text("".join(
        f'10.1.0.{k} - - [{(NOW - dt.timedelta(days=k % 3, hours=1)).strftime("%d/%b/%Y:%H:%M:%S %z")}] '
        f'"GET {"/demo/" if k % 2 else "/guides/bermuda/"} HTTP/1.1" 200 1234 "{"https://github.com/x" if k % 4 == 1 else "-"}" "{ua}"\n'
        for k in range(12)) + f'10.9.9.9 - - [{NOW.strftime("%d/%b/%Y:%H:%M:%S %z")}] "GET /demo/ HTTP/1.1" 200 1 "-" "Googlebot"\n')

    arch = tmp_path / "archive"
    (arch / "github").mkdir(parents=True)
    rel = [{"tag": "v0.38.150", "published_at": _iso(TODAY - dt.timedelta(days=60), 12), "prerelease": False},
           {"tag": "v0.38.160", "published_at": _iso(TODAY - dt.timedelta(days=40), 12), "prerelease": False},
           {"tag": "v0.38.169", "published_at": _iso(TODAY - dt.timedelta(days=1), 9), "prerelease": True},
           {"tag": "v0.38.170", "published_at": _iso(TODAY - dt.timedelta(days=2), 15), "prerelease": False},
           {"tag": "v0.38.171", "published_at": _iso(TODAY, 8), "prerelease": True}]
    (arch / "github" / "releases.json").write_text(json.dumps(rel))
    (arch / "github" / "stars.json").write_text(json.dumps([_iso(TODAY - dt.timedelta(days=k), 10) for k in range(5)]))
    (arch / "github" / "meta.json").write_text(json.dumps({"stars_count": 7, "releases_at": NOW.timestamp(), "repo_at": NOW.timestamp()}))
    (arch / "markers.json").write_text(json.dumps({
        "posts": [[(TODAY - dt.timedelta(days=1)).isoformat(), "Site page", "Guide: Which room is my phone in? (EN + DE)"],
                  [TODAY.isoformat(), "GitHub PR (awesome list)", "not a site piece"]],
        "sends": [[(TODAY - dt.timedelta(days=4)).isoformat(), "1 Creators", 4], [(TODAY - dt.timedelta(days=2)).isoformat(), "1 Creators", 1],
                  [(TODAY - dt.timedelta(days=1)).isoformat(), "2 Makers", 2], [TODAY.isoformat(), "Various", 1]],
        "campaigns": [{"from": (TODAY - dt.timedelta(days=20)).isoformat(), "label": "Marketplace launch", "project": "padspanHA"},
                      {"from": (TODAY - dt.timedelta(days=10)).isoformat(), "label": "GideonMail 0.6.x launch", "project": "GideonMail"}]}))
    (arch / "ha-analytics").mkdir()
    (arch / "ha-analytics" / f"{TODAY.isoformat()}.json").write_text(json.dumps({"d": TODAY.isoformat(), "padspan_ha": {"total": 131}}))
    (arch / "github-traffic").mkdir()
    (arch / "github-traffic" / f"{TODAY.isoformat()}.json").write_text(json.dumps({
        "views": [{"d": TODAY.isoformat(), "count": 40, "uniques": 12}], "clones": [{"d": TODAY.isoformat(), "count": 9, "uniques": 5}],
        "referrers": [{"referrer": "github.com", "count": 30, "uniques": 9}]}))
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps({"pings_skip_ips": ["10.0.0.48"]}))
    paths = {"pings": str(pings), "telemetry": str(tel), "site_logs": str(logs), "archive": str(arch),
             "out": str(tmp_path / "out"), "config": str(cfg)}
    lic = (f"{(TODAY - dt.timedelta(days=1)).isoformat()}\ttrial\t0\t2\n"
           f"{(TODAY - dt.timedelta(days=1)).isoformat()}\tlifetime\t1\t1\n"
           f"{TODAY.isoformat()}\tpro\t0\t1\n")
    return paths, (lambda q: lic)


def build(tmp_path, **kw):
    paths, sql = make_world(tmp_path, **kw)
    model, state, _ = P.run(paths=paths, now=NOW, run_sql=sql, refresh=False)
    return model, state, paths


def test_the_model_has_every_field_of_schema_1(tmp_path):
    m, _, _ = build(tmp_path)
    for k in ("ok", "schema", "generated", "generated_iso", "stale_after_s", "need", "tiles", "needs_attention", "health",
              "health_same_age", "watch", "latest", "prev", "prev2", "hours_out", "issues", "new_issues", "perf", "adopt",
              "adopt_versions", "versions_top", "setup_fail", "digest", "feed", "series", "series_all", "markers", "ba", "ns",
              "small", "funnel", "sources", "src_days", "setup28", "new15", "new15_stage", "versions24", "l24_total", "tiers",
              "lic_totals", "stars_total", "reports", "lag_series", "archive"):
        assert k in m, k
    assert m["ok"] is True and m["schema"] == 1
    assert len(m["tiles"]) == 6 and [t["label"] for t in m["tiles"]][:2] == ["Homes checking in", "Today so far"]
    assert set(m["digest"]) == {"Releases", "Problems", "Growth", "Money", "Marketing"}
    json.dumps(m)  # serialisable as it is


def test_homes_a_day_skip_addresses_and_today_is_compared_at_the_same_hour(tmp_path):
    m, _, _ = build(tmp_path)
    assert m["ns"]["yday"] == 49, "50 addresses, one on the skip list"
    today_tile = m["tiles"][1]
    assert today_tile["value"] == 25 and today_tile["unit"] == "by 12:00", "only the checks before noon so far"
    assert today_tile["cmp"] == "typical 25 by now"
    assert m["series_all"][-1]["d"] == (TODAY - dt.timedelta(days=1)).isoformat(), "today isn't a full day yet"


def test_versions_top_five_with_other_and_unknown_folded_in(tmp_path):
    m, _, _ = build(tmp_path)
    vt = m["versions_top"]
    assert vt["total"] == 49
    assert [r["v"] for r in vt["rows"]] == ["0.38.160", "0.38.170", "0.38.150"]
    assert vt["rows"][0]["adopted"] and vt["rows"][0]["stable"]
    assert vt["other"]["n"] == 1, "the '-' version goes into Other, never a row"
    assert all(r["v"] != "-" for r in vt["rows"])


def test_release_health_compares_the_same_age_and_is_too_early_on_few_homes(tmp_path):
    m, _, _ = build(tmp_path)
    sa = m["health_same_age"]
    assert m["latest"] == "0.38.170" and m["prev"] == "0.38.160" and m["prev2"] == "0.38.150"
    assert sa["age_days"] == 2, "0.38.170 first checked in 2 days ago"
    assert sa["latest"]["window"] == [(TODAY - dt.timedelta(days=2)).isoformat(), TODAY.isoformat()]
    first_prev = dt.date.fromisoformat(sa["prev"]["first_day"])
    assert sa["prev"]["window"] == [first_prev.isoformat(), (first_prev + dt.timedelta(days=2)).isoformat()]
    assert sa["latest"]["homes"] == 4 and sa["too_early"] and "Too early" in sa["note"]


def test_attention_is_empty_when_all_is_fine(tmp_path):
    m, _, _ = build(tmp_path)
    assert m["needs_attention"] == [] and m["need"] == 0
    assert m["digest"]["Problems"] == ["No new or regressed issues in the last 3 days."]


def test_a_regression_and_a_new_issue_need_attention_then_age_out_unless_growing(tmp_path):
    m, state, paths = build(tmp_path, regress=True, issue_today=True)
    kinds = [i["kind"] for i in m["needs_attention"]]
    assert kinds[0] == "regression" and "issue" in kinds and m["need"] == len(kinds)
    reg = m["needs_attention"][0]
    assert reg["title"].startswith("Event-loop lag over 1 s on 0.38.160") and reg["homes"] < reg["of"]
    assert m["tiles"][4]["state"] == "watch"
    # 8 days later, not growing: dropped; growing: kept
    key = reg["key"]
    old = (TODAY - dt.timedelta(days=8)).isoformat()
    state["attention"][key] = {"first_seen": old, "hist": {(TODAY - dt.timedelta(days=1)).isoformat(): reg["homes"]}, "last_seen": old}
    m2, _ = P.build(*_inputs(paths), NOW, json.loads(json.dumps(state)))
    assert key not in [i["key"] for i in m2["needs_attention"]]
    state["attention"][key]["hist"] = {(TODAY - dt.timedelta(days=1)).isoformat(): reg["homes"] - 3}
    m3, _ = P.build(*_inputs(paths), NOW, json.loads(json.dumps(state)))
    kept = [i for i in m3["needs_attention"] if i["key"] == key]
    assert kept and kept[0]["growing"] and kept[0]["days_listed"] == 8


def _inputs(paths):
    """The build() inputs for paths, as run() makes them."""
    cfg = json.loads(Path(paths["config"]).read_text())
    skip = set(cfg["pings_skip_ips"])
    pings = P.collect_pings(paths["pings"], skip, NOW)
    rows, first = P.collect_reports(paths["telemetry"], NOW)
    rep = P.report_aggregates(rows, first, NOW)
    rep["rows"] = rows
    setupf = P.setup_failures(first, rep["latest"], NOW)
    lic = P.collect_licences(lambda q: "")
    site, src = P.collect_site(paths["site_logs"], skip, NOW)
    rel = json.loads((Path(paths["archive"]) / "github" / "releases.json").read_text())
    stars = json.loads((Path(paths["archive"]) / "github" / "stars.json").read_text())
    a_site, a_src, ha, traffic, refs, markers = P.read_archive(paths["archive"])
    return (pings, rep, setupf, lic, site, src, rel, stars, markers,
            {"site": a_site, "sources": a_src, "ha": ha, "traffic": traffic, "referrers": refs})


def test_failing_setups_are_flagged_over_the_threshold_with_splits(tmp_path):
    m, _, _ = build(tmp_path, stuck=6)
    sf = m["setup_fail"]
    assert sf["total"] == 12 and sf["failing"] == 6 and sf["rate"] == 50.0 and sf["over"]
    by_type = {r["k"]: (r["failing"], r["of"]) for r in sf["by"]["install_type"]}
    assert by_type == {"os": (3, 6), "container": (3, 6)}
    assert any(i["kind"] == "setup" for i in m["needs_attention"])
    other = tmp_path / "b"
    other.mkdir()
    m2, _, _ = build(other, stuck=2)
    assert m2["setup_fail"]["failing"] == 2 and not m2["setup_fail"]["over"], "2 of 12 is under the 40% line"
    assert not any(i["kind"] == "setup" for i in m2["needs_attention"])


def test_markers_span_their_dates_and_other_products_are_left_out(tmp_path):
    m, _, _ = build(tmp_path)
    mk = m["markers"]
    creators = [r for r in mk["ranges"] if r["label"] == "Outreach: 1 Creators"][0]
    assert (creators["from"], creators["to"]) == ((TODAY - dt.timedelta(days=4)).isoformat(), (TODAY - dt.timedelta(days=2)).isoformat())
    labels = [r["label"] for r in mk["ranges"]]
    assert "Marketplace launch" in labels and not any("GideonMail" in x for x in labels)
    assert [r["kind"] for r in mk["ranges"] if r["label"] == "Marketplace launch"] == ["launch"]
    assert mk["campaign"]["label"] == "Outreach emails, 2 waves", "'Various' is not a wave"
    assert mk["content"] == [{"d": (TODAY - dt.timedelta(days=1)).isoformat(), "items": ["Guide: Which room is my phone in? (EN + DE)"]}]


def test_money_stars_site_and_archive(tmp_path):
    m, _, _ = build(tmp_path)
    assert m["tiles"][5]["value"] == 3 and m["tiles"][5]["cmp"] == "1 paid"
    assert m["stars_total"] == 7, "the repo's count wins over a dated list that lags"
    assert m["funnel"][1]["n"] == 6, "people's demo loads, bots left out"
    assert dict(m["sources"])["GitHub"] == 3
    assert m["archive"]["ha_optin"] == [{"d": TODAY.isoformat(), "n": 131}]
    assert m["archive"]["github_traffic"][0]["views"] == 40


def test_nothing_in_the_model_names_an_address_a_home_or_a_person(tmp_path):
    m, _, _ = build(tmp_path, regress=True, issue_today=True, stuck=3)
    s = json.dumps(m)
    assert not re.search(r"\b10\.\d+\.\d+\.\d+\b", s), "no address"
    assert "iid-" not in s and "new-0" not in s, "no install id"
    assert "@" not in s
    assert {w["home"] for w in m["perf"]["worst"]} <= {"home A", "home B", "home C", "home D", "home E"}


def test_digest_php_serves_the_model_only_to_a_signed_in_session():
    src = (ROOT / "server" / "pad_report" / "digest.php").read_text(encoding="utf-8")
    gate = src.index("empty($_SESSION['ok'])")
    assert "session_name('padspan_report')" in src
    assert src.index("http_response_code(403)") > gate and src.index("readfile(") > src.index("http_response_code(403)")
    assert "private/pad-digest/model.json" in src


def test_github_refresh_keeps_what_it_got_when_paging_fails(tmp_path):
    arch = tmp_path / "a"

    def fetch(url, accept=None):
        if "/releases" in url:
            if url.endswith("&page=1"):
                return [{"tag_name": "v0.38.170", "published_at": "2026-10-28T22:00:00Z", "prerelease": False, "draft": False}]
            raise OSError("HTTP Error 422: Unprocessable Entity")
        return {"stargazers_count": 291}
    rel, stars, count = P.refresh_github(str(arch), "x/y", NOW, fetch)
    assert [r["tag"] for r in rel] == ["v0.38.170"] and count == 291 and stars == []
    meta = json.loads((arch / "github" / "meta.json").read_text())
    assert "422" in meta["releases_error"]
