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
    assert got == {"seen": {"audio": int(NOW - 50)}, "dismissed": ["edgecut"], "used": [], "last_shown": int(NOW - 9)}
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
    assert meant["after"] == {"seen": {"audio": int(NOW - 86400)}, "dismissed": ["edgecut"], "used": ["heatmap"], "last_shown": int(NOW - 86400)}
    took = [r for r in rows if r["schema"] == "accepted"]
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
    assert "$m['tips'] = $out" in block and "preg_match('/^[a-z0-9_]{1,40}$/', $id)" in block and "count($out) >= 64" in block
    assert src.index("padspan-offers.json") < i, "the offers' merge stays as it was, first"


@pytest.mark.skipif(not shutil.which("php"), reason="php is not installed")
def test_version_php_runs(tmp_path) -> None:
    php = shutil.which("php")
    src = _src(_ROOT / "server" / "version.php").replace("/var/www/clients/client1/web10/private/", str(tmp_path).replace("\\", "/") + "/")
    (tmp_path / "version.php").write_text(src, encoding="utf-8")
    (tmp_path / "latest.json").write_text(json.dumps({"latest_stable": "0.38.300", "latest_beta": "0.38.305"}), encoding="utf-8")

    def answer() -> dict:
        out = subprocess.run([php, "-d", "display_errors=stderr", str(tmp_path / "version.php")], capture_output=True, text=True, timeout=60)
        return json.loads(out.stdout)

    assert "tips" not in answer(), "no file: the answer as before"
    (tmp_path / "padspan-tips.json").write_text(json.dumps({"tips": ["audio", "Audio!", "audio", 5, "heatmap"]}), encoding="utf-8")
    got = answer()
    assert got["tips"] == ["audio", "heatmap"] and got["latest_stable"] == "0.38.300"
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
    pro = {"licence": "pro_year", "held": {}, "used": ["audio"]}
    latest = {
        "a": _report("a", "pro", {"alert_pulse": True}, addons=pro),
        "b": _report("b", "pro", {"alert_pulse": True, "heatmap": True}, addons={**pro, "used": []}),
        "c": _report("c", "free", {"atlas_3d_enabled": True}, addons={"licence": "free", "held": {}, "used": []}),
        "d": _report("d", "free", {}, {"house3d_show:show:edgecut": 2}, addons={"licence": "addon", "held": {"climate": "gt365"}, "used": []}),
    }
    ad = S.tips_adoption(latest, list(latest.values()))
    assert ad["alert_pulse"] == (4, 2) and ad["audio"] == (2, 1) and ad["heatmap"] == (3, 1) and ad["edgecut"] == (4, 1)
    assert ad["robot_vacuum"] == (2, 0), "vacuum: only Pro has it here"
    rank = S.tips_rank(latest, list(latest.values()))
    assert sorted(rank) == sorted(tips.IDS), "every tip, each once"
    assert rank.index("alert_pulse") < rank.index("heatmap") and rank.index("audio") < rank.index("heatmap")
    assert rank.index("edgecut") < rank.index("robot_vacuum"), "a tip in use somewhere before one in use nowhere"


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
    written = json.loads(out_file.read_text(encoding="utf-8"))
    assert set(written) == {"tips"} and sorted(written["tips"]) == sorted(tips.IDS)
    assert "i1" not in out_file.read_text(encoding="utf-8"), "nothing about an install in the file"


def test_the_pull_script_uploads_the_ranking_to_where_version_php_reads_it() -> None:
    sh = _src(_ROOT / "server" / "pull_padspan_telemetry.sh")
    assert '--tips-out "$DEST/padspan-tips.json"' in sh
    assert 'TIPS_DEST="/var/www/clients/client1/web10/private/padspan-tips.json"' in sh
    assert '"$TIPS_FILE" "$SRC_HOST:$TIPS_DEST"' in sh
    assert "\r\n" not in (_ROOT / "server" / "pull_padspan_telemetry.sh").read_bytes().decode("utf-8"), "run on Linux: LF only"


# ── 8. where it is drawn ────────────────────────────────────────────────────

def test_the_overview_card_is_in_the_slot_last_before_the_accuracy_tips() -> None:
    pj = _src(_WWW / "panel.js")
    i = pj.index("\n  _featureTipCard(){")
    card = pj[i:pj.index("\n  }\n", i)]
    for gate in ("this.state.kioskMode", "wallScreen(false)", 'this.state.dataMode !== "live"', "this._overviewCardShown",
                 "TIPS.overviewCard(TIPS.hostFromCtx(this._ctx()))"):
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
