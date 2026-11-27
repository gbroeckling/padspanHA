# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Feature tips (views/tips.js, tips.py; 2026-11-26).

1. The picker, the state, the page's one tip, the Overview's card and its slot, the Atlas's quiet line, Settings'
   Tips card and the ⋯ list's tip are run in tests/js/tips.mjs: licence, fit, used/seen/dismissed, the 7-day and
   24-hour waits, popularity only as a tie-break, the places, Basic, never on a wall.
2. Here: one catalogue everywhere (views/tips.js, tips.py, server/telemetry_summary.py); the settings and their
   cleaning; the update check keeping the ranking; the report's words; version.php's merge; the summary's section and
   ranking; where the tip is drawn (the Overview's slot, only the Atlas's adjustment places, never a wall).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import tips
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_WWW = _CC / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
NOW = 1_790_000_000.0


def _src(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _summary():
    spec = importlib.util.spec_from_file_location("telemetry_summary_for_tips", _ROOT / "server" / "telemetry_summary.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── 1. run ───────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not _NODE, reason="node is not installed")
def test_the_tips_run() -> None:
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "tips.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stdout[-3000:] + res.stderr[-3000:]
    out = json.loads(lines[-1])
    assert out["failures"] == [] and res.returncode == 0, json.dumps(out["failures"][:6], indent=2, ensure_ascii=False)
    for part in ("catalogue:", "licence:", "fit:", "gone:", "waits:", "places:", "who:", "state:", "page:", "looks:", "menu:", "slot:"):
        assert sum(1 for c in out["checks"] if c.startswith(part)) >= 2, part
    assert len(out["checks"]) >= 400


# ── 2. one catalogue ─────────────────────────────────────────────────────────

def _js_tips() -> list[tuple[str, str]]:
    return re.findall(r'\{ id: "([a-z0-9_]+)", need: "([a-z0-9_]+)"', _src(_VIEWS / "tips.js"))


def test_one_catalogue_in_the_panel_the_backend_and_the_summary() -> None:
    js = _js_tips()
    assert [i for i, _ in js] == list(tips.IDS), "views/tips.js TIPS and tips.IDS, in the same order"
    assert 20 <= len(tips.IDS) <= 30
    table = _summary()._TIP_SIGNALS
    assert list(table) == list(tips.IDS), "server/telemetry_summary.py _TIP_SIGNALS names every tip, in order"
    # The summary counts a tip's owners as the panel licenses it (Live Aboard's own rung is everyone's from December 1).
    for tip_id, need in js:
        assert table[tip_id][0] == ("free" if need == "house3d" else need), tip_id


def test_no_tip_id_is_an_accuracy_tips_id() -> None:
    """tip_shown:<id> is the accuracy tips' word too (telemetry.TIP_IDS): their ids never meet."""
    assert not set(tips.IDS) & set(T.TIP_IDS) and "all" not in tips.IDS


# ── 3. the settings ──────────────────────────────────────────────────────────

def test_the_settings_and_their_defaults() -> None:
    assert DEFAULT_SETTINGS["tips_enabled"] is True, "easy to turn off, not opt-in"
    assert DEFAULT_SETTINGS["tips_state"] == {} and DEFAULT_SETTINGS["server_tips_rank"] == []
    schema = {str(getattr(k, "schema", k)) for k in WS.ws_settings_set.ws_schema}
    assert {"tips_enabled", "tips_state"} <= schema
    assert "server_tips_rank" not in schema, "the ranking is the update check's, never settings_set's"
    assert {"tips_enabled", "tips_state"} <= WS._EVERYONE_KEYS, "written as anyone uses the panel, Enhanced security or not"


def test_the_state_is_cleaned_and_bounded() -> None:
    raw = {"seen": {"audio": NOW - 50, "nope": NOW, "heatmap": NOW + 3 * 86400, "edgecut": True, "themes": "x", "showcase": -1},
           "dismissed": ["edgecut", "edgecut", 4, "zzz", None], "used": "audio", "last_shown": NOW - 9, "extra": [1] * 900}
    got = tips.clean_state(raw, NOW)
    assert got == {"seen": {"audio": int(NOW - 50), "heatmap": int(NOW)}, "dismissed": ["edgecut"], "used": [], "last_shown": int(NOW)}, \
        "a time ahead (a fast clock) is kept at now, the tip still seen"
    assert tips.clean_state({"seen": {"audio": NOW + 400 * 86400}}, NOW)["seen"] == {"audio": int(NOW)}
    assert tips.clean_state("junk", NOW) == {"seen": {}, "dismissed": [], "used": [], "last_shown": 0}
    assert tips.clean_state({"seen": {"audio": NOW - 5}}, NOW)["last_shown"] == int(NOW - 5), "the last shown is at least the last seen"
    every = tips.clean_state({"seen": {i: NOW for i in tips.IDS}, "dismissed": list(tips.IDS) * 3, "used": list(tips.IDS)}, NOW)
    assert len(every["seen"]) == len(every["dismissed"]) == len(every["used"]) == len(tips.IDS), "never past the catalogue"
    assert tips.clean_rank(["audio", "audio", "nope", 3, "edgecut"]) == ["audio", "edgecut"]
    assert tips.clean_rank("audio") == [] and tips.clean_rank(None) == []


def _golden(key: str) -> list[dict]:
    rows = [json.loads(ln) for ln in _src(_ROOT / "tests" / "golden" / "settings" / "settings_set.jsonl").splitlines() if ln.strip()]
    return [r for r in rows if r.get("key") == key]


def test_the_command_keeps_what_the_golden_rows_say() -> None:
    rows = _golden("tips_state")
    meant = next(r for r in rows if r["case"] == "as meant" and r["as"] == "admin")
    assert meant["after"] == {"seen": {"audio": int(NOW - 86400), "heatmap": int(NOW)}, "dismissed": ["edgecut"], "used": ["heatmap"],
                              "last_shown": int(NOW)}
    older = next(r for r in rows if r["case"] == "an older copy, from another screen")
    assert older["after"] == {"seen": {"audio": int(NOW - 10 * 86400), "heatmap": int(NOW - 86400)}, "dismissed": ["edgecut"],
                              "used": ["themes"], "last_shown": int(NOW - 86400)}, "a stale copy takes nothing away"
    emptied = next(r for r in rows if r["case"] == "emptied")
    assert emptied["after"] == {"seen": {"audio": int(NOW - 86400)}, "dismissed": [], "used": ["themes"], "last_shown": int(NOW - 86400)}, \
        "{} wipes nothing"
    took = [r for r in rows if r["schema"] == "accepted"]
    assert len(took) >= 5
    assert took and all(r["error"] is None for r in took), "a map is cleaned, never refused"
    assert all(r["schema"] == "refused" for r in rows if not isinstance(r["sent"]["tips_state"], dict)), "only a map is taken"
    for key in ("tips_enabled", "tips_state"):
        others = [r for r in _golden(key) if r["as"] != "admin"]
        assert len(others) == 2, (key, "a user, and a user with Enhanced security on")
        for r in others:
            assert r["error"] is None and r["answered"], (key, r["as"], r.get("from"))


# ── 4. the update check keeps the ranking ───────────────────────────────────

class _Store:
    def __init__(self, data: dict):
        self.data = data
        self.sets: list[dict] = []

    async def async_set(self, **kw):
        self.sets.append(kw)
        self.data.update(kw)


def _hass(data: dict | None = None):
    st = _Store(dict(data or {}))
    return SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}}), st


def test_the_update_answer_can_only_reorder_known_tips() -> None:
    from custom_components.padspan_ha import update_check as U
    h, st = _hass()
    run = lambda m: asyncio.new_event_loop().run_until_complete(U._keep_tips(h, m))  # noqa: E731
    run({"latest_stable": "1.0.0"})
    assert not st.sets, "no tips in the answer: nothing changes"
    run({"tips": ["heatmap", "audio", "BUY_NOW", "heatmap", 7, None, "edgecut"]})
    assert st.data["server_tips_rank"] == ["heatmap", "audio", "edgecut"], "known ids only, each once, the server's order"
    run({"tips": "audio"})
    run({"tips": ["nope", "zzz"]})
    run({"tips": []})
    assert st.data["server_tips_rank"] == ["heatmap", "audio", "edgecut"], "junk, unknown ids or nothing keep the last answer"
    n = len(st.sets)
    run({"tips": ["heatmap", "audio", "edgecut"]})
    assert len(st.sets) == n, "the same ranking is not written again"


def test_the_ranking_is_kept_beside_the_offers_and_sends_nothing() -> None:
    uc = _src(_CC / "update_check.py")
    assert "await _keep_tips(hass, manifest)" in uc
    assert uc.index("await _keep_tips(hass, manifest)") < uc.index("if not latest or not current"), "kept even with no newer version"
    # The request is the same: only the version goes up.
    assert 'params={"v": VERSION}' in uc and uc.count("request(hass,") == 1


# ── 5. the report's words ───────────────────────────────────────────────────

def test_the_report_words() -> None:
    for t in tips.IDS:
        for w in ("shown", "go", "not_now", "dismiss", "used_after"):
            e = f"tip_{w}:{t}"
            assert e in T.FEATURE_TIP_EVENTS and T.event_allowed(e), e
    assert "tips_off" in T.FEATURE_TIP_EVENTS and T.event_allowed("tips_off")
    assert not T.event_allowed("tip_go:nope") and not T.event_allowed("tip_used_after:all")
    assert all(re.fullmatch(r"tip_[a-z_]+:[a-z0-9_]+|tips_off", e) for e in T.FEATURE_TIP_EVENTS)
    assert "tips" in T.UI_ERROR_HELPERS
    js = _src(_VIEWS / "tips.js")
    for word in ('"tip_shown:"', '"tip_go:"', '"tip_not_now:"', '"tip_dismiss:"', '"tip_used_after:"', '"tips_off"'):
        assert word in js, word


# ── 6. version.php merges the ranking ───────────────────────────────────────

def test_version_php_merges_the_tips_as_it_merges_the_offers() -> None:
    src = _src(_ROOT / "server" / "version.php")
    assert "/var/www/clients/client1/web10/private/padspan-tips.json" in src
    i = src.index("padspan-tips.json")
    block = src[i:src.index("echo $manifest;")]
    assert "$m->tips = $out" in block and "preg_match('/^[a-z0-9_]{1,40}$/', $id)" in block and "count($out) >= 64" in block
    assert src.index("padspan-offers.json") < i, "the offers' merge stays first"
    # Objects, not arrays: re-encoded, an empty {} stays {}; with nothing to merge the bytes are latest.json's.
    assert "$m = json_decode($manifest);" in src and "json_decode($manifest, true)" not in src
    assert "$m->offers = (object)$out" in src and "is_object($m)" in block


@pytest.mark.skipif(not shutil.which("php"), reason="php is not installed")
def test_version_php_runs(tmp_path) -> None:
    php = shutil.which("php")
    src = _src(_ROOT / "server" / "version.php").replace("/var/www/clients/client1/web10/private/", str(tmp_path).replace("\\", "/") + "/")
    (tmp_path / "version.php").write_text(src, encoding="utf-8")
    latest = '{"latest_stable":"0.38.300","latest_beta":"0.38.305","extra":{},"list":[]}'
    (tmp_path / "latest.json").write_text(latest, encoding="utf-8")

    def raw() -> str:
        return subprocess.run([php, "-d", "display_errors=stderr", str(tmp_path / "version.php")], capture_output=True, text=True, timeout=60).stdout

    def answer() -> dict:
        return json.loads(raw())

    assert raw() == latest, "no file: latest.json's own bytes, as before"
    (tmp_path / "latest.json").write_text("{}", encoding="utf-8")
    assert raw() == "{}"
    (tmp_path / "latest.json").write_text(latest, encoding="utf-8")
    (tmp_path / "padspan-tips.json").write_text(json.dumps({"tips": ["audio", "Audio!", "audio", 5, "heatmap"]}), encoding="utf-8")
    got = answer()
    assert got["tips"] == ["audio", "heatmap"] and got["latest_stable"] == "0.38.300"
    assert '"extra":{}' in raw() and '"list":[]' in raw(), "an empty object stays an object, an empty list a list"
    (tmp_path / "latest.json").write_text("{}", encoding="utf-8")
    assert raw() == '{"tips":["audio","heatmap"]}', "an empty manifest with tips"
    (tmp_path / "latest.json").write_text(latest, encoding="utf-8")
    (tmp_path / "padspan-offers.json").write_text(json.dumps({"tester": False}), encoding="utf-8")
    got = answer()
    assert got["offers"] == {"tester": False} and got["tips"] == ["audio", "heatmap"], "both merged"
    (tmp_path / "padspan-tips.json").write_text("not json", encoding="utf-8")
    assert "tips" not in answer() and answer()["offers"] == {"tester": False}


# ── 7. the summary: its section and the ranking ─────────────────────────────

def _report(iid: str, tier: str = "free", features: dict | None = None, usage: dict | None = None, env: dict | None = None,
            addons: dict | None = None) -> dict:
    r = {"install_id": iid, "day": date.today().isoformat(), "version": "0.38.310", "edition": "full", "tier": tier,
         "ha_version": "2026.11.0", "country": "CA", "language": "en", "env": env or {}, "features": features or {},
         "usage": usage or {}, "health": {}, "errors": {}}
    if addons is not None:
        r["addons"] = addons
    return r


def test_the_ranking_puts_the_most_used_first_among_those_who_have_it() -> None:
    S = _summary()
    pro = {"licence": "pro_year", "held": {}, "used": []}
    free = {"licence": "free", "held": {}, "used": []}
    latest = {
        "a": _report("a", "pro", {"alert_pulse": True}, addons={**pro, "used": ["audio"]}),
        "b": _report("b", "pro", {"alert_pulse": True, "heatmap": True}, addons=pro),
        "c": _report("c", "free", {"atlas_3d_enabled": True, "alert_pulse": True}, addons=free),
        "d": _report("d", "free", {}, {"house3d_show:show:edgecut": 2}, addons={"licence": "addon", "held": {"climate": "gt365"}, "used": []}),
        "e": _report("e", "free", {"alert_pulse": True}, addons=free),
        "f": _report("f", "free", {}, addons=free),
    }
    reports = list(latest.values())
    ad = S.tips_adoption(latest, reports)
    assert ad["alert_pulse"] == (6, 4) and ad["audio"] == (2, 1) and ad["heatmap"] == (3, 1) and ad["edgecut"] == (6, 1)
    assert ad["robot_vacuum"] == (2, 0), "vacuum: only Pro has it here"
    rank = S.tips_rank(latest, reports)
    assert sorted(rank) == sorted(tips.IDS), "every tip, each once"
    # Ranked only from 5 installs that have it: alert pulse (4 of 6), house_3d (1 of 6) and edgecut (1 of 6); audio,
    # 1 of 2 (a raw 50 %), is not ranked at all and goes after them in the table's order.
    assert rank[:3] == ["alert_pulse", "house_3d", "edgecut"], rank[:5]
    assert rank.index("audio") > rank.index("edgecut")
    assert S.tips_share(1, 1) < S.tips_share(10, 9), "one house of one is not 100 %"
    assert abs(S.tips_share(0, 0) - 0.5) < 1e-9
    # The owner's own house left out, as --exclude-install-id does for the one-screen line.
    ad_x = S.tips_adoption(latest, reports, {"a", "c"})
    assert ad_x["alert_pulse"] == (4, 2) and ad_x["audio"] == (1, 0)
    assert S.tips_rank(latest, reports, {"a", "c"})[0] != "alert_pulse", "below 5 installs once two are left out: not ranked"


def test_the_summary_prints_the_section_and_writes_only_ids(tmp_path) -> None:
    import sys as _sys
    data = tmp_path / "telemetry"
    data.mkdir()
    rows = [_report("i1", "pro", {"alert_pulse": True}, {"tip_shown:audio": 1, "tip_go:audio": 1, "tip_used_after:audio": 1},
                    addons={"licence": "pro_year", "held": {}, "used": ["audio"]}),
            _report("i2", "free", {}, {"tip_shown:alert_pulse": 1, "tip_not_now:alert_pulse": 1, "tips_off": 1})]
    (data / f"{date.today().isoformat()}.jsonl").write_text(
        "\n".join(json.dumps({"report": r, "recv_day": date.today().isoformat()}) for r in rows) + "\n", encoding="utf-8")
    out_file = tmp_path / "padspan-tips.json"
    res = subprocess.run([_sys.executable, str(_ROOT / "server" / "telemetry_summary.py"), str(data), "--days", "30",
                          "--tips-out", str(out_file)], capture_output=True, text=True, encoding="utf-8", timeout=120,
                         env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})   # it prints ⋯ and ♨ (UTF-8 on the reports' machine)
    assert res.returncode == 0, res.stderr[-3000:]
    assert "Feature tips" in res.stdout and "tips turned off (No more tips, or the switch): 1 (1 installs)" in res.stdout
    section = res.stdout[res.stdout.index("Feature tips"):]
    line = next(ln for ln in section.splitlines() if ln.strip().startswith("audio "))
    assert "1 (1)" in line and "1 of 1" in line, line
    res_x = subprocess.run([_sys.executable, str(_ROOT / "server" / "telemetry_summary.py"), str(data), "--days", "30",
                            "--exclude-install-id", "i1"], capture_output=True, text=True, encoding="utf-8", timeout=120,
                           env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    sec_x = res_x.stdout[res_x.stdout.index("Feature tips"):]
    line_x = next(ln for ln in sec_x.splitlines() if ln.strip().startswith("audio "))
    assert "1 (1)" not in line_x, line_x
    written = json.loads(out_file.read_text(encoding="utf-8"))
    assert set(written) == {"tips"} and sorted(written["tips"]) == sorted(tips.IDS)
    assert "i1" not in out_file.read_text(encoding="utf-8"), "nothing about an install in the file"


def test_the_pull_script_uploads_the_ranking_to_where_version_php_reads_it() -> None:
    sh = _src(_ROOT / "server" / "pull_padspan_telemetry.sh")
    assert '--tips-out "$DEST/padspan-tips.json"' in sh
    assert 'TIPS_DEST="/var/www/clients/client1/web10/private/padspan-tips.json"' in sh
    assert '"$TIPS_FILE" "$SRC_HOST:$TIPS_DEST"' in sh
    assert "\r\n" not in (_ROOT / "server" / "pull_padspan_telemetry.sh").read_bytes().decode("utf-8"), "run on Linux: LF only"
    # An older summariser (no --tips-out) is asked first and run as before: the summary never goes blank.
    assert 'python3 "$SUMMARISER" --help 2>/dev/null | grep -q -- "--tips-out"' in sh
    assert 'python3 "$SUMMARISER" "$DEST" --days 30 >"$SUMMARY"' in sh
    assert "DEPLOYING: copy telemetry_summary.py to 5810" in sh
    assert "on Telegram each night it fails" in sh and "once on Telegram" not in sh


# ── 8. where it is drawn ────────────────────────────────────────────────────

def test_the_overview_card_is_in_the_slot_last_before_the_accuracy_tips() -> None:
    pj = _src(_WWW / "panel.js")
    i = pj.index("\n  _featureTipCard(){")
    card = pj[i:pj.index("\n  }\n", i)]
    for gate in ("this.state.kioskMode", "wallScreen(false)", 'this.state.dataMode !== "live"', "this._overviewCardShown",
                 "TIPS.overviewCard(TIPS.hostFromCtx(this._ctx(), { kiosk: this.state.kioskMode || wallScreen(false) }))"):
        assert gate in card, gate
    slot = pj[pj.index("const _ms = this._launchPriceCard()"):]
    slot = slot[:slot.index("catch(e)")]
    assert slot.index("|| this._c4localOverviewCard();") < slot.index("const _tip = _ms ? null : this._featureTipCard();") \
        < slot.index("this._accuracyTipsCard()"), "after every other card, before the accuracy tips"


def test_the_tip_shows_only_where_the_atlas_is_adjusted() -> None:
    """Never on the map itself, in a room's card or sheet, during taps, or on a wall: the three adjustment places only."""
    calls = {}
    for p in sorted(_WWW.rglob("*.js")):
        if "lib" in p.parts or p.name == "tips.js":
            continue
        s = _src(p)
        for fn in ("adjustLine(", "menuTip(", "overviewCard(", "settingsCard("):
            if f"TIPS.{fn}" in s:
                calls.setdefault(fn, set()).add(p.name)
    assert calls == {"adjustLine(": {"settings.js", "maps.js"}, "menuTip(": {"lights_panel.js"},
                     "overviewCard(": {"panel.js"}, "settingsCard(": {"settings.js"}}, calls
    st = _src(_VIEWS / "settings.js")
    atlas = st[st.index("function _settingsAtlas(ctx, el){"):]
    assert 'TIPS.adjustLine(TIPS.hostFromCtx(ctx), "settings_atlas")' in atlas[:2000], "at the top of Settings → Atlas"
    mp = _src(_VIEWS / "maps.js")
    lt = mp[mp.index("function _lightsTab(ctx, maps, active) {"):]
    assert 'TIPS.adjustLine(TIPS.hostFromCtx(ctx), "atlas_builder")' in lt[:1500] and "if (TIPS && !furnish)" in lt[:1500]
    # The ⋯ list: drawn when it opens (createShowMenu open), never on a wall; the sidebar hands none to a wall.
    show = _src(_VIEWS / "live_aboard_show.js")
    assert "const tip = tipRow();" in show and 'if (typeof v.tip !== "function" || onWall()) return null;' in show
    assert ':host([data-wall]) .la3d-show .la3d-stip{display:none}' in show
    lp = _src(_WWW / "lights_panel.js")
    assert "tip: kiosk ? null : (keys)=>" in lp and 'const wall = !!kiosk || this.hasAttribute("data-wall");' in lp
    lm = _src(_VIEWS / "lights_map.js")
    assert 'tip: typeof h3.tip === "function" && h3.kiosk !== true ? h3.tip : null,' in lm
    assert 'tip: typeof hp.tip === "function" && hp.kiosk !== true ? hp.tip : null,' in lm
    # Nothing the map, a room's card or sheet, or a tap draws knows about tips.
    for name in ("room_controls.js", "live_aboard_rooms.js", "live_aboard_panel.js", "live_aboard_use.js", "atlas_screen.js", "iso_lights.js"):
        assert "tips.js" not in _src(_VIEWS / name) and "TIPS" not in _src(_VIEWS / name), name


def test_the_tips_words_are_their_own_group_german_first() -> None:
    import sys as _sys
    _sys.path.insert(0, str(_ROOT / "scripts"))
    import i18n_coverage as cov  # noqa: PLC0415
    assert cov.GROUPS["tips"] == ("views/tips.js",)
    keys = cov.keys_in([cov.WWW / "views" / "tips.js"])
    de = json.loads(_src(_WWW / "i18n" / "de" / "tips.json"))
    assert set(de) == set(keys) and all(de[k] and de[k] != k for k in keys if len(k.split()) > 1)
    for lang in ("fr", "nl"):
        assert json.loads(_src(_WWW / "i18n" / lang / "tips.json")) == {}, "German first: French and Dutch stay English for now"
    assert '"tips"' in _src(_WWW / "lights_panel.js").split("const I18N_GROUPS = ", 1)[1].split("\n", 1)[0]
    # No other group gained a word: the panel's, Settings' and Mapping's stay complete in every language.
    for p in (_WWW / "panel.js", _VIEWS / "settings.js", _VIEWS / "maps.js", _WWW / "lights_panel.js", _VIEWS / "live_aboard_show.js"):
        added = [ln for ln in _src(p).splitlines() if "TIPS" in ln and re.search(r'(?<![\w.$])t\("', ln)]
        assert not added, (p.name, added[:2])


# ── 9. the review's fixes (2026-11-26) ──────────────────────────────────────

def test_the_state_only_grows() -> None:
    kept = {"seen": {"audio": NOW - 10 * 86400, "heatmap": NOW - 86400}, "dismissed": ["edgecut"], "used": ["themes"],
            "last_shown": NOW - 86400}
    stale = {"seen": {"audio": NOW - 9 * 86400}, "last_shown": NOW - 9 * 86400}
    got = tips.merge_state(kept, stale, NOW)
    assert got == {"seen": {"audio": int(NOW - 10 * 86400), "heatmap": int(NOW - 86400)}, "dismissed": ["edgecut"],
                   "used": ["themes"], "last_shown": int(NOW - 86400)}, "each seen at its earliest; nothing taken away"
    assert tips.merge_state(kept, {}, NOW) == tips.merge_state(kept, None, NOW) == tips.clean_state(kept, NOW), "{} wipes nothing"
    newer = tips.merge_state(kept, {"seen": {"showcase": NOW - 5}, "used": ["audio"], "dismissed": ["nope"]}, NOW)
    assert newer["seen"]["showcase"] == int(NOW - 5) and newer["used"] == ["audio", "themes"] and newer["last_shown"] == int(NOW - 5)
    assert newer["dismissed"] == ["edgecut"], "catalogue ids only"
    src = _src(_CC / "ws_settings.py")
    assert '_merge_tips(st.data.get("tips_state"), msg["tips_state"])' in src


def test_a_restore_or_a_reset_keeps_the_tips() -> None:
    from custom_components.padspan_ha.settings_store import trial_state_kept
    live = {"tips_enabled": False, "tips_state": {"seen": {"audio": NOW - 5 * 86400}, "dismissed": ["edgecut"], "last_shown": NOW - 5 * 86400}}
    backup = {"tips_enabled": True, "tips_state": {"seen": {"audio": NOW - 50 * 86400, "showcase": NOW - 40 * 86400}, "used": ["themes"],
                                                   "last_shown": NOW - 40 * 86400}}
    kept = trial_state_kept(live, backup)
    assert kept["tips_enabled"] is False, "No more tips stays"
    st = kept["tips_state"]
    assert set(st["seen"]) == {"audio", "showcase"} and st["seen"]["audio"] == int(NOW - 50 * 86400), "seen merged, the earliest time"
    assert st["dismissed"] == ["edgecut"] and st["used"] == ["themes"] and st["last_shown"] == int(NOW - 5 * 86400)
    reset = trial_state_kept(live)                     # a factory reset: the live side alone
    assert reset["tips_enabled"] is False and reset["tips_state"]["seen"] == {"audio": int(NOW - 5 * 86400)}
    assert "tips_state" not in trial_state_kept({}, {}) and "tips_enabled" not in trial_state_kept({}, {})
    assert trial_state_kept({"tips_enabled": True}, {"tips_enabled": False})["tips_enabled"] is True, "the live choice wins"
    # The ranking is the server's, kept like the offers' switches.
    assert 'data["server_tips_rank"] = (store_obj.data or {}).get("server_tips_rank") or []' in _src(_CC / "ws_backup.py")
    assert '_reset["server_tips_rank"] = _live["server_tips_rank"]' in _src(_CC / "ws_factory_reset.py")


def test_the_overview_tip_waits_for_the_cards_before_it() -> None:
    pj = _src(_WWW / "panel.js")
    assert "Promise.allSettled([_editionsPromise, _trialPromise, _proInvitePromise, _aiwPromise, _c4lPromise])" in pj
    assert pj.index("Promise.allSettled([_editionsPromise") < pj.index(".then(() => import(`./views/tips.js?b=${BUILD_ID}`))")
    i = pj.index("\n  _featureTipCard(){")
    card = pj[i:pj.index("\n  }\n", i)]
    assert "AIW.overviewPending(c)" in card and "C4L.overviewPending(c)" in card
    assert "export function overviewPending(ctx)" in _src(_VIEWS / "ai_wizard_offer.js")
    c4 = _src(_VIEWS / "c4local.js")
    assert "export function overviewPending(ctx, now = Date.now())" in c4 and "_answered = true" in c4


def test_the_alarm_and_ai_plans_show_their_own_place() -> None:
    js = _src(_VIEWS / "tips.js")
    assert 'target: { atlas: "emergency" } },' in js and 'target: { view: "settings", tab: "ai", part: "ai_plans" } },' in js
    assert '"data-focus-part":"ai_plans"' in _src(_VIEWS / "settings.js")
    lp = _src(_WWW / "lights_panel.js")
    assert 'if (t.atlas === "emergency") { this._openEmergencyCard(); return; }' in lp
    assert 'want === "emergency" && !this.hasAttribute("data-wall") && !this._kiosk()' in lp, "the link opens the card, never on a wall"
    assert "this._loadEmergency().then(()=>{ this._render(); this._cardLink(); });" in lp


def test_each_feature_says_its_own_use() -> None:
    ed = _src(_VIEWS / "editions.js")
    assert "export function tipUsed(id, live = true)" in ed and '"padspan-tip-used"' in ed
    assert 'tipUsed("locate", ctx.state.dataMode === "live")' in _src(_VIEWS / "locate.js")
    assert 'tipUsed("busy_times", ctx.state.dataMode === "live")' in _src(_VIEWS / "busy_times.js")
    assert 'tipUsed("wled_controls")' in _src(_VIEWS / "lights_map.js")
    assert '"padspan-tip-used"' in _src(_VIEWS / "tips.js")
    # Sample mode: the panel's word carries whether this is the house's own data.
    assert 'live: !!this.state._dataModeKnown && this.state.dataMode === "live"' in _src(_WWW / "panel.js")


def test_every_view_host_knows_a_full_screen_wall() -> None:
    js = _src(_VIEWS / "tips.js")
    assert "kiosk: wallScreen(!!st.kioskMode)," in js and "export function wallScreen(kiosk, win = globalThis)" in js
    pj = _src(_WWW / "panel.js")
    assert "TIPS.hostFromCtx(this._ctx(), { kiosk: this.state.kioskMode || wallScreen(false) })" in pj
