"""The add-ons on the developer's side: the nightly summary, the install-base feed and its dashboard.

2026-11-25, the owner: the usage report's `addons` (addon_report.py) and the add-on funnel in `usage`
(telemetry.ADDON_EVENTS) answer what sells, where, to whom, and whether it is used. server/telemetry_summary.py
prints an Add-ons section, server/stats.php adds the section up into `addons` beside every other event in `usage`,
and views/installbase.js (copied to pad.traks.ca) draws one folded Add-ons section from both
(tests/js/installbase_addons.mjs). The word lists on the server side are copies (it runs without the integration),
so these tests hold them to the sender's.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import pytest

from custom_components.padspan_ha import addon_report as AR
from custom_components.padspan_ha import licence as L
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha.const import FREE_BASICS_FROM_TS


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()

_ROOT = Path(__file__).resolve().parents[1]
_SUMMARY = _ROOT / "server" / "telemetry_summary.py"
_STATS = _ROOT / "server" / "stats.php"
_IB = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "installbase.js"


def _summary():
    if not _SUMMARY.is_file():
        pytest.skip("no server/ in this tree (the Bright derivation carries none)")
    spec = importlib.util.spec_from_file_location("telemetry_summary", _SUMMARY)
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    return S


def _php() -> str:
    if not _STATS.is_file():
        pytest.skip("no server/ in this tree")
    return _STATS.read_text(encoding="utf-8")


def _words_in(src: str, name: str) -> set[str]:
    """The quoted words in a PHP `$NAME = array(...);`."""
    m = re.search(rf"\${name} = array\((.*?)\);", src, re.S)
    assert m, name
    return set(re.findall(r"'([^']*)'", m.group(1)))


# ── the nightly summary ────────────────────────────────────────────────────

def test_the_summary_lists_are_the_senders():
    S = _summary()
    assert S._ADDONS == L.ADDONS
    assert S._ADDON_LICENCES == AR.LICENCE_WORDS and S._ADDON_DAYS == AR.DAYS_WORDS
    assert S._ADDON_USED == AR.USED_WORDS and set(S._ADDON_NOT_SOLD) == set(AR.USED_WORDS) - set(L.ADDONS)
    assert tuple(w for w, _ in S._ADDON_MOVED) == AR.MOVED_WORDS
    assert all(into in AR.USED_WORDS for _, into in S._ADDON_MOVED)
    assert S._ADDON_OFFER_PLACES == T.ADDON_OFFER_PLACES and S._ADDON_BUY_PLACES == T.ADDON_BUY_PLACES
    assert S._ADDON_KEY_WORDS == T.ADDON_KEY_WORDS and S._ADDON_SALE_CARD == T.ADDON_SALE_CARD_WORDS
    assert S._ADDON_SALE_WHEN == AR.SALE_WHEN
    assert {a: _ts(t) for a, t in S._ADDON_ON_SALE_FROM.items()} == L.ADDON_ON_SALE_FROM
    assert {k for _, keys in S._ADDON_MARKET for k, _ in keys} == set(AR.MARKET_COUNTS)
    assert S._ADDON_AUDIO == AR.AUDIO_SYSTEMS and S._ADDON_C4_OS == AR.C4_OS_WORDS and S._ADDON_C4_ENTRY == AR.C4_ENTRY_WORDS
    assert tuple(w for w, _ in S._ADDON_WIFI) == AR.WIFI_WORDS and S._ADDON_HISTORY == AR.HISTORY_WORDS
    assert S._PLAN_SOURCES == AR.PLAN_WORDS
    # Every funnel event is read by name (addon_used:* reaches it through addons.used).
    read = ({f"addon_offer:{p}:{a}" for p, names in S._ADDON_OFFER_PLACES.items() for a in names}
            | {f"addon_buy:{p}:{a}" for p in S._ADDON_BUY_PLACES for a in S._ADDONS}
            | {f"addon_key:{w}" for w in S._ADDON_KEY_WORDS} | {f"addon_gained:{a}" for a in S._ADDONS}
            | {f"addon_gained_in:{w}" for w in S._ADDON_SALE_WHEN} | {f"addon_sale_card:{w}" for w in S._ADDON_SALE_CARD})
    assert read == {e for e in T.ADDON_EVENTS if not e.startswith("addon_used:")}


def _rep(iid: str, addons, usage=None, **extra) -> dict:
    r = {"install_id": iid, "version": "0.38.300", "day": date.today().isoformat(), "usage": usage or {}, **extra}
    if addons is not None:
        r["addons"] = addons
    return r


# A: free, then an alarm add-on key bought from the licence card in the sale's first week; had emergency lights.
_A0 = _rep("a", {"licence": "free", "market": []}, {"addon_offer:emergency_test:alarm": 2})
_A1 = _rep("a", {"licence": "addon", "was": "free", "held": {"alarm": "91_365", "audio": "lt30"}, "moved": ["emergency_test"],
                 "used": ["alarm"],
                 "market": {"alarm": 2, "garage": 1, "emergency": 4, "audio": {"control4": 22},
                            "c4": {"os": "2", "entry": "not_loaded", "local": True}, "wifi": "utopia", "history": "14_30d",
                            "plans": ["picture"]}},
           {"addon_offer:licence_card:alarm": 3, "addon_buy:licence_card:alarm": 1, "addon_key:entered": 1,
            "addon_key:addon": 1, "addon_gained:alarm": 1, "addon_gained_in:sale_w1": 1, "addon_sale_card:shown": 4,
            "addon_sale_card:clicked": 1})
# B: an add-on key that became Pro; power teams and a LiDAR scan before they moved; Control4 on OS 3, running.
_B = _rep("b", {"licence": "pro_year", "was": "addon", "moved": ["power_teams", "lidar"], "used": ["lighting", "maps"],
                "market": {"wled": 3, "teams": 2, "c4": {"os": "3", "entry": "loaded"}, "wifi": "unifi", "history": "gt30d",
                           "vacuum": 1, "valetudo": True}},
          {"addon_offer:busy_times:insights": 2, "addon_key:pro_from_addon": 1})
# C: a Pro trial over a kept Looks key; Busy Times and Locate refused it Presence insights.
_C = _rep("c", {"licence": "trial", "kept": True, "held": {"looks": "gt365"}, "market": {}},
          {"addon_offer:locate:insights": 1, "addon_offer:themes:looks": 1, "addon_key:needs_update": 1})
_D = _rep("d", ["not", "a", "dict"])                    # an untrusted report, read as saying nothing
_E = _rep("e", None)                                    # older PadSpan: no section


def test_the_summary_adds_up_the_addons_section():
    S = _summary()
    for r in (_A1, _B, _C):
        AR.check(r["addons"])                           # the shapes PadSpan sends
    # From December 1: every add-on on sale (Advanced map creation and Robot vacuum from then).
    text = "\n".join(S.addons_section({"a": _A1, "b": _B, "c": _C, "d": _D, "e": _E}, [_A0, _A1, _B, _C, _D, _E],
                                      now=FREE_BASICS_FROM_TS))
    assert "installs that say: 3 of 5" in text
    assert "licence: addon 1, pro_year 1, trial 1" in text
    assert "on an add-on key: 1; on Pro: 1; on a trial: 1, of them over a kept add-on key: 1" in text
    assert re.search(r"\n    alarm +1 +0 +1 +0 +0 +0 +0 +0\n", text), text
    assert "on the latest report (installs): free -> addon 1, addon -> pro_year 1" in text
    assert "across each install's reports over the window (installs): free -> addon 1, addon -> pro_year 1" in text
    assert re.search(r"alarm +licence_card +3 \(1\) +1 \(1\) +33%", text), text
    assert re.search(r"alarm +emergency_test +2 \(1\) +- +-", text), text
    assert "keys entered, and how they went: entered 1 (1 installs), addon 1 (1 installs), pro_from_addon 1 (1 installs)," \
           " needs_update 1 (1 installs)" in text
    assert "add-ons gained: alarm 1 (1 installs)" in text and "gained against the sale: sale_w1 1 (1 installs)" in text
    assert "the sale card: shown 4 (1 installs), clicked 1 (1 installs); clicked per shown 25%" in text
    # Demand without purchase: A now holds the alarm; B went Pro; C (a trial) still has no Presence insights.
    assert re.search(r"alarm +1 installs, 0 still without it \(emergency_test 2\)", text), text
    assert re.search(r"insights +2 installs, 1 still without it \(busy_times 2, locate 1\)", text), text
    # Use: on it = an add-on key carrying it, or Pro (Advanced smart lighting is an add-on on sale, like the rest).
    assert re.search(r"\n    alarm +2 +1  50%\n", text), text
    assert re.search(r"\n    maps +1 +1  100%\n", text), text
    assert re.search(r"\n    lighting +1 +1  100%\n", text), text
    assert re.search(r"emergency_test -> alarm +1  holding alarm 1, on Pro 0", text), text
    assert re.search(r"power_teams -> lighting +1  holding lighting 0, on Pro 1", text), text
    assert re.search(r"lidar -> maps +1  holding maps 0, on Pro 1", text), text
    assert "alarm: alarm panels 1 (2), garage openers 1 (1), emergency lights 1 (4); any of them 1 installs, 1 already on it" in text
    assert "lighting: WLED devices 1 (3), power teams 1 (2); any of them 1 installs, 1 already on it" in text
    assert "maps: plans by source: picture 1; any of them 1 installs, 0 already on it" in text
    assert "vacuum: robot vacuums 1 (1), Valetudo 1; any of them 1 installs, 1 already on it" in text
    assert "audio: control4 1 (22 players); any of them 1 installs, 1 already on it" in text
    assert "Control4: 2 installs" in text and "the local token override on 1" in text
    assert "the Control4 OS 2 Local market (OS 2, its entry not loaded or the local override on): 1" in text
    assert "wifi: UniFi Utopia 1, UniFi Network 1; 1 already on it" in text
    assert "(days of history the recorder keeps): 14_30d 1, gt30d 1" in text
    # Before December 1 Advanced map creation and Robot vacuum are not sold: everyone's, so every install is on them.
    before = "\n".join(S.addons_section({"a": _A1, "b": _B, "c": _C}, [_A0, _A1, _B, _C], now=FREE_BASICS_FROM_TS - 1))
    assert re.search(r"\n    maps +3 +1  33%  not sold yet: every install that says\n", before), before
    assert re.search(r"\n    vacuum +3 +0  0%  not sold yet: every install that says\n", before), before
    assert re.search(r"\n    lighting +1 +1  100%\n", before), before
    assert re.search(r"lidar -> maps +1  not sold yet", before), before
    assert "vacuum: robot vacuums 1 (1), Valetudo 1; any of them 1 installs, not sold yet" in before


def test_the_summary_runs_with_the_section_and_with_none(tmp_path):
    """End to end through main(): the section is printed, and reports without it (or with a broken one) are no trouble."""
    _summary()
    day = date.today().isoformat()
    d = tmp_path / "r"
    d.mkdir()
    rows = [_A0, _A1, _B, _C, _D, _E, _rep("f", {"licence": 7}), _rep("g", {"licence": "addon", "held": "x", "market": "y",
                                                                             "moved": "z", "used": {"a": 1}})]
    (d / f"{day}.jsonl").write_text("".join(json.dumps({"recv_day": day, "report": r}) + "\n" for r in rows), encoding="utf-8")
    out = subprocess.run([sys.executable, str(_SUMMARY), str(d)], capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"}, timeout=60)
    assert out.returncode == 0, out.stderr
    s = out.stdout[out.stdout.index("Add-ons (addons:"):]
    s = s[:s.index("\n\n")]
    assert "installs that say: 4 of 7" in s, s            # a, b, c, g (one row per install and day: a's last)
    assert "licence: addon 2, pro_year 1, trial 1" in s, s


# ── the install-base feed (stats.php; no PHP here, so read as text) ─────────

def test_stats_php_adds_up_the_section_with_the_senders_words():
    src = _php()
    assert "'addons' => $addons," in src, "the feed carries it"
    assert "$r['addons']" in src and "function addon_part(" in src
    assert _words_in(src, "ADDON_NAMES") == set(L.ADDONS)
    assert _words_in(src, "ADDON_LICENCES") == set(AR.LICENCE_WORDS)
    refusal = {p: names for p, names in T.ADDON_OFFER_PLACES.items() if p != "licence_card"}
    assert _words_in(src, "ADDON_REFUSAL") == set(refusal) | {a for names in refusal.values() for a in names}
    assert _words_in(src, "ADDON_MOVED") - set(AR.USED_WORDS) == set(AR.MOVED_WORDS)
    market = re.search(r"\$ADDON_MARKET = array\((.*?)\);", src, re.S).group(1)
    assert set(re.findall(r"'(\w+)' => array", market)) <= set(L.ADDONS)
    assert set(re.findall(r"'(\w+)'(?! =>)", market)) == set(AR.MARKET_COUNTS)
    on_sale = re.search(r"\$ADDON_ON_SALE_FROM = array\((.*?)\);", src, re.S).group(1)
    assert {a: _ts(t) for a, t in re.findall(r"'(\w+)' => '([^']+)'", on_sale)} == L.ADDON_ON_SALE_FROM
    for k in ("held", "kept", "was", "moved", "used", "market", "audio", "c4", "wifi", "history", "plans", "os", "entry",
              "local"):
        assert f"['{k}']" in src, k
    assert "array('roomplan' => 'maps', 'valetudo' => 'vacuum')" in src
    # The refusal offers are the window's events, set against each install's latest report.
    assert "$usage_installs[$ev]" in src and '"addon_offer:$place:$name"' in src
    assert "$os === '2' && ($entry !== 'loaded' || $local)" in src, "the Control4 OS 2 Local market"


def test_stats_php_adds_it_up_when_php_is_here(tmp_path):
    """Run where PHP is installed (not on the developer's PC): a two-day spool through the real file."""
    php = shutil.which("php")
    if not php:
        pytest.skip("php is not installed")
    src = _php()
    today = date.today().toordinal()
    d0, d1 = date.fromordinal(today - 3).isoformat(), date.fromordinal(today - 1).isoformat()
    ids = {k: f"{k * 8}-1111-4111-8111-111111111111" for k in "abcde"}

    def row(r: dict) -> dict:
        return {**r, "install_id": ids[r["install_id"]], "tier": "free", "edition": "full", "env": {}}

    def run(name: str, now: int) -> dict:
        """The feed's addons with what is on sale read at `now` (PADSPAN_STATS_NOW); a tree of its own (its cache)."""
        root = tmp_path / name
        (root / "a" / "b" / "c").mkdir(parents=True)
        (root / "a" / "b" / "c" / "stats.php").write_text(src, encoding="utf-8")     # its private/ is three up
        spool = root / "private" / "padspan-telemetry"
        spool.mkdir(parents=True)
        for day, reports in ((d0, [_A0, _rep("b", {"licence": "addon", "held": {"audio": "gt365"}, "market": {}})]),
                             (d1, [_A1, _B, _C, _D, _E])):
            (spool / f"{day}.jsonl").write_text(
                "".join(json.dumps({"recv_day": day, "report": row(r)}) + "\n" for r in reports), encoding="utf-8")
        (root / "run.php").write_text("<?php\ndefine('PADSPAN_STATS_TRUSTED', 1);\n"
                                      f"define('PADSPAN_STATS_NOW', {int(now)});\ninclude __DIR__ . '/a/b/c/stats.php';\n",
                                      encoding="utf-8")
        out = subprocess.run([php, "-d", "display_errors=stderr", "-d", "error_reporting=-1", str(root / "run.php")],
                             capture_output=True, text=True, encoding="utf-8", timeout=60)
        assert out.returncode == 0 and "Fatal" not in out.stderr and "Parse error" not in out.stderr, out.stderr
        first = src[:src.index("// ── add-ons (the owner's")].count("\n") + 1
        last = src[:src.index("// ── the per-install table")].count("\n") + 1
        mine = [int(n) for n in re.findall(r"on line (\d+)", out.stderr) if first <= int(n) <= last]
        assert not mine, out.stderr
        return json.loads(out.stdout)["addons"]
    # Before December 1 Advanced map creation and Robot vacuum are not sold: everyone's, so every install is on them.
    b = run("before", FREE_BASICS_FROM_TS - 1)
    assert b["not_sold"] == ["maps", "vacuum"], b["not_sold"]
    assert b["on_it"]["maps"] == 3 and b["on_it"]["vacuum"] == 3 and b["used"]["maps"] == 1
    assert b["reach"]["maps"] == {"installs": 1, "on_it": 1} and b["reach"]["vacuum"] == {"installs": 1, "on_it": 1}
    assert b["moved"]["lidar"]["into"] == "maps"
    # From December 1 every add-on is on sale.
    a = run("from", FREE_BASICS_FROM_TS)
    assert a["not_sold"] == []
    assert a["on_it"]["maps"] == 1 and a["on_it"]["vacuum"] == 1
    assert a["reach"]["vacuum"] == {"installs": 1, "on_it": 1}
    assert a["installs"] == 3 and a["licence"] == {"addon": 1, "pro_year": 1, "trial": 1}
    assert a["held"] == {"alarm": {"91_365": 1}, "audio": {"lt30": 1}, "looks": {"gt365": 1}} and a["kept"] == 1
    assert a["was"] == {"free>addon": 1, "addon>pro_year": 1} and a["changes"] == {"free>addon": 1, "addon>pro_year": 1}
    assert a["moved"]["emergency_test"] == {"installs": 1, "holds": 1, "pro": 0, "into": "alarm"}
    assert a["moved"]["lidar"] == {"installs": 1, "holds": 0, "pro": 1, "into": "maps"}
    assert a["on_it"]["alarm"] == 2 and a["on_it"]["lighting"] == 3 and a["used"] == {"alarm": 1, "maps": 1, "lighting": 1}
    assert a["refused"]["insights"] == {"installs": 2, "without": 1} and a["refused"]["alarm"] == {"installs": 1, "without": 0}
    assert a["market"]["emergency"] == {"installs": 1, "sum": 4} and a["audio"] == {"control4": {"installs": 1, "sum": 22}}
    assert a["reach"]["alarm"] == {"installs": 1, "on_it": 1} and a["reach"]["maps"] == {"installs": 1, "on_it": 0}
    assert a["c4"] == {"2:not_loaded": 1, "3:loaded": 1} and a["c4_local"] == 1 and a["c4_os2_local"] == 1
    assert a["wifi"] == {"utopia": 1, "unifi": 1} and a["history"] == {"14_30d": 1, "gt30d": 1}
    assert a["plans"] == {"picture": 1} and a["valetudo"] == 1 and a["roomplan"] == 0


def test_stats_php_and_the_dashboard_read_the_same_keys():
    src = _php()
    m = re.search(r"\$addons = array\((.*?)\);", src, re.S)
    keys = set(re.findall(r"'(\w+)' =>", m.group(1)))
    assert {"installs", "licence", "held", "kept", "was", "changes", "moved", "on_it", "used", "refused", "market", "reach",
            "audio", "c4", "c4_local", "c4_os2_local", "wifi", "history", "plans", "roomplan", "valetudo", "not_sold"} == keys
    ib = _IB.read_text(encoding="utf-8")
    for k in keys:
        assert f"ao.{k}" in ib, k
    for k in ("installs", "holds", "pro", "into"):                       # each moved word's row
        assert f"'{k}' =>" in src and f"v.{k}" in ib, k


# ── the dashboard (views/installbase.js) ─────────────────────────────────────

def test_the_dashboard_names_every_word_the_section_sends():
    ib = _IB.read_text(encoding="utf-8")
    block = ib[ib.index("const W_ADDONS = {"):]
    block = block[:block.index("\n};\n")]

    def listed(kind: str) -> set[str]:
        m = re.search(rf"\n  {kind}: \{{(.*?)\}},?\n  ", block + "\n  ", re.S)
        assert m, kind
        return set(re.findall(r'(?:^|[{,])\s*"?(\w+)"?:\s*"', m.group(1)))
    assert listed("addon") == set(AR.USED_WORDS)
    assert listed("licence") == set(AR.LICENCE_WORDS) and listed("days") == set(AR.DAYS_WORDS)
    assert listed("place") == set(T.ADDON_OFFER_PLACES) and listed("key") == set(T.ADDON_KEY_WORDS)
    assert listed("sale") == set(AR.SALE_WHEN) and listed("card") == set(T.ADDON_SALE_CARD_WORDS)
    assert listed("moved") == set(AR.MOVED_WORDS) and listed("market") == set(AR.MARKET_COUNTS)
    assert listed("audio") == set(AR.AUDIO_SYSTEMS) and listed("c4_os") == set(AR.C4_OS_WORDS)
    assert listed("c4_entry") == set(AR.C4_ENTRY_WORDS) and listed("wifi") == set(AR.WIFI_WORDS)
    assert listed("history") == set(AR.HISTORY_WORDS) and listed("plans") == set(AR.PLAN_WORDS)
    for fam in ("addon_offer", "addon_buy", "addon_key", "addon_gained", "addon_gained_in", "addon_sale_card", "addon_used"):
        assert f'a === "{fam}"' in ib, fam


def test_the_dashboard_draws_the_section():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "installbase_addons.mjs"), str(_ROOT).replace("\\", "/"),
                        json.dumps(sorted(T.ADDON_EVENTS))], capture_output=True, text=True, encoding="utf-8", timeout=120)
    lines = [ln for ln in r.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{r.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert len(out["cases"]) >= 20 and all(out["cases"].values()) and not out["failures"], \
        json.dumps(out["failures"][:4], indent=2, ensure_ascii=False)
