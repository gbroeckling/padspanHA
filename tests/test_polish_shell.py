# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Polish of the panel's shell, from the 2026-11-19 audit of the owner's house.

  bars     the phone's top bar and bottom tab bar were brown gradients on the
           2025 skin's green-black page: the skin now gives both its own rail
           colour; the classic skin's are as they were
  skin     the 2025 skin went on only when the settings arrived, seconds after
           the page was drawn in classic: the skin the settings last gave is
           kept in the browser and worn from the start (nothing kept: classic)
  badges   "Scan: —s" and "Status: —" before anything had been read: "…"
  tip      the Atlas header's line and its one-time tip box said the same
           thing at once (tests/js/atlas_keep_card.mjs runs it)
  maps     "9 map(s)", a raw ISO "updated" stamp, and a tab strip cut off at
           "Atl" on a phone with no sign that it scrolls
  rows     Calibration's and Manage's tabs wrap to two rows on a phone, with
           a line under the last row only

Health's own part (loading, Tags/Objects) is run in tests/js/help_found_bugs.mjs.
tests/js/polish_shell.mjs runs the real _applySkin and _updateBadges.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_SKIN = (_WWW / "styles-2025.css").read_text(encoding="utf-8")
_CSS = (_WWW / "styles.css").read_text(encoding="utf-8")


def test_the_skin_before_settings_and_the_waiting_badges_run() -> None:
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not installed")
    r = subprocess.run([node, str(_ROOT / "tests" / "js" / "polish_shell.mjs"), str(_WWW / "panel.js")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert not out["failures"], json.dumps(out["failures"], indent=2, ensure_ascii=False)
    assert len(out["cases"]) == 11, sorted(out["cases"])


def test_the_badges_start_out_waiting_too() -> None:
    # What is in the page before _updateBadges first runs.
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    # Through t() (views/i18n.js), the English source: "…", no dash.
    assert '<span class="pill" id="scanBadge">${esc(t("Scan: {s}", { s: "…" }))}</span>' in panel
    assert '<span class="pill" id="statusBadge">${esc(t("Status: {status}", { status: "…" }))}</span>' in panel


def test_the_2025_skin_colours_both_phone_bars_and_classic_keeps_its_own() -> None:
    assert ".mobile-topbar,.mobile-bottom-nav{background:var(--ps-s1)}" in _SKIN
    # The sidebar is the same rail colour: the bars belong to it.
    assert re.search(r"\.left\{\s*background:var\(--ps-s1\);", _SKIN)
    # The classic skin is untouched.
    assert "background:linear-gradient(180deg,#1a0d05 0%,#151f18 100%);" in _CSS[_CSS.index(".mobile-topbar{"):][:200]
    assert "background:linear-gradient(0deg,#130d06 0%,#1a120a 100%);" in _CSS[_CSS.index(".mobile-bottom-nav{"):][:200]


def test_mapping_counts_maps_in_words_and_dates_them_readably() -> None:
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert "map(s)`)," not in maps[maps.index("function _library("):][:1200]
    assert '`${maps.length} map${maps.length === 1 ? "" : "s"}`' in maps
    assert "`updated: ${_whenUpdated(m.updated)}`" in maps and "`updated: ${m.updated" not in maps
    fn = maps[maps.index("function _whenUpdated(stamp){"):][:420]
    # Not a time (an old store, a test's "t0"): shown as it came, never "Invalid Date".
    assert 'if (!d || Number.isNaN(d.getTime())) return String(stamp || "");' in fn
    assert 'toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })' in fn


def test_mappings_tab_strip_fades_where_more_tabs_lie_past_its_edge() -> None:
    maps = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert 'const tabs = el("div",{class:"tabs"}, tabDefs.map(([id,label])=>_tabBtn(id,label,activeTab,setTab)));\n  _tabsMore(tabs);' in maps.replace("\r\n", "\n")
    fn = maps[maps.index("function _tabsMore(tabs){"):][:520]
    assert 'tabs.classList.toggle("more-start", past > 1 && tabs.scrollLeft > 1);' in fn
    assert 'tabs.classList.toggle("more-end", past > 1 && tabs.scrollLeft < past - 1);' in fn
    assert 'tabs.addEventListener("scroll", mark' in fn and "new ResizeObserver(mark).observe(tabs)" in fn
    for cls in (".tabs.more-end{", ".tabs.more-start{", ".tabs.more-start.more-end{"):
        rule = _SKIN[_SKIN.index(cls):].split("}", 1)[0]
        assert "mask-image:linear-gradient(" in rule and "-webkit-mask-image:linear-gradient(" in rule, cls


def test_wrapped_tab_rows_each_get_the_line() -> None:
    cal = (_WWW / "views" / "calibration.js").read_text(encoding="utf-8")
    man = (_WWW / "views" / "manage.js").read_text(encoding="utf-8")
    assert 'el("div", { class: "tabs tabs-rows", style: "margin-bottom:14px;flex-wrap:wrap;gap:4px" })' in cal
    assert 'el("div",{class:"tabs tabs-rows",style:"margin-bottom:12px;flex-wrap:wrap;gap:4px"})' in man
    rule = _SKIN[_SKIN.index(".tabs.tabs-rows{"):].split("}", 1)[0]
    # A line at one tab's height, then the strips' own 4px gap, repeated: the
    # last row's line is the strip's bottom border, which this leaves alone.
    assert "--ps-tab-h:34px" in rule and "background:repeating-linear-gradient(to bottom" in rule
    assert "var(--line) var(--ps-tab-h),var(--line) calc(var(--ps-tab-h) + 1px)" in rule
    assert "transparent calc(var(--ps-tab-h) + 4px)" in rule and "border" not in rule
    assert ".tabs.tabs-rows .tab{height:var(--ps-tab-h);min-height:0}" in _SKIN
    # A phone's tabs are 40px (styles.css), so its rows are too.
    assert "@media(max-width:900px){.tabs.tabs-rows{--ps-tab-h:40px}}" in _SKIN
    assert ".tab{min-height:40px;padding:8px 14px}" in _CSS
    # The classic skin's tabs are bordered pills that wrap as they did.
    assert "tabs-rows" not in _CSS


def test_guided_calibration_wraps_to_the_left_under_its_heading() -> None:
    src = (_WWW / "views" / "calibration_results.js").read_text(encoding="utf-8")
    row = src[src.index('const accCard = el("div", { class: "card", "data-cal-results": "accuracy" });'):][:1200]
    assert "justify-content:space-between;gap:10px;flex-wrap:wrap" in row
    assert 'el("div", {}, [guidedBtn(true)]),' in row and 'style: "margin-left:auto"' not in row
