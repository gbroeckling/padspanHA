# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The end of December 15, 2026: one moment, everywhere.

From 2026-12-16T08:00:00Z (the owner, 2026-11-24) Pro for life is no longer
sold, a year of Pro is $49 (was $45), two years are $85, Bright Pro is
retired, and a new tester gets one year instead of two. Each part switches by
itself, so each must switch at the same moment:

  * the panel: views/editions.js PRO_PASS_FROM (tests/js/pro_pitch.mjs runs
    the words on both sides of it);
  * the update check's tester line: update_check._PASS_FROM_TS;
  * the site: one script swaps the data-until-pass blocks for the
    data-from-pass ones and charges $49 for the year;
  * the licence server (traks.ca/license, not in this repo):
    PSPAN_LIFETIME_ENDS '2026-12-16 08:00:00' decides lifetime by PayPal's
    payment_date, the SKU padspan-pro-2year issues two years, and
    TESTER_YEARS_AFTER is 1.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from custom_components.padspan_ha import update_check

_ROOT = Path(__file__).resolve().parents[1]
_ED = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "editions.js"
_SITE = _ROOT / "site" / "index.html"


def _pass_from() -> str:
    return re.search(r'export const PRO_PASS_FROM = "([^"]+)"', _ED.read_text(encoding="utf-8")).group(1)


def test_the_panel_and_the_update_check_switch_on_the_same_moment() -> None:
    moment = datetime.fromisoformat(_pass_from().replace("Z", "+00:00"))
    assert moment == datetime(2026, 12, 16, 8, 0, tzinfo=timezone.utc)
    assert update_check._PASS_FROM_TS == moment.timestamp()
    from custom_components.padspan_ha import const
    assert const.PRO_PASS_FROM_TS == moment.timestamp()


@pytest.mark.parametrize("now, term", [(1797408000 - 1, "two years"), (1797408000, "one year")])
def test_the_update_checks_tester_line_says_the_term_of_the_day(monkeypatch, now, term) -> None:
    from custom_components.padspan_ha import licence
    from tests.test_pro_invite import _house
    monkeypatch.setattr(licence, "edition", lambda: "full")
    monkeypatch.setattr(update_check.time, "time", lambda: now)
    line = update_check._tester_line(_house())
    assert f"Testers get PadSpan Pro free for {term}." in line, line
    assert ("two years" in line) == (term == "two years"), line


def test_the_key_refusals_stop_naming_bright_pro_at_the_switch() -> None:
    """What a refusal tells someone to get: Bright Pro is no longer sold from
    the switch, so each gate picks its sentence by the clock where it sends it."""
    from custom_components.padspan_ha import ws_fabric, ws_wled
    assert "Bright Pro" in ws_fabric._PRO_REQUIRED_MSG and "Bright Pro" not in ws_fabric._PRO_REQUIRED_MSG_FROM_PASS
    assert ws_fabric._PRO_REQUIRED_MSG_FROM_PASS == ws_fabric._PRO_REQUIRED_MSG.replace("PadSpan Bright Pro or PadSpan Pro", "PadSpan Pro")
    assert "Bright Pro" in ws_wled.TIER_MSG and ws_wled.TIER_MSG_FROM_PASS == "The WLED Advanced tab needs a PadSpan Pro key."
    pkg = _ROOT / "custom_components" / "padspan_ha"
    fabric, wled, exact = ((pkg / f).read_text(encoding="utf-8") for f in ("ws_fabric.py", "ws_wled.py", "wled_exact.py"))
    assert fabric.count("_PRO_REQUIRED_MSG if time.time() < PRO_PASS_FROM_TS else _PRO_REQUIRED_MSG_FROM_PASS") == 3
    assert wled.count("TIER_MSG if time.time() < PRO_PASS_FROM_TS else TIER_MSG_FROM_PASS") == 3
    assert exact.count("W.TIER_MSG if time.time() < W.PRO_PASS_FROM_TS else W.TIER_MSG_FROM_PASS") == 2
    assert '"bright_required", TIER_MSG)' not in wled and '"bright_required", W.TIER_MSG)' not in exact
    assert '"pro_required", _PRO_REQUIRED_MSG)' not in fabric


@pytest.fixture(scope="module")
def site() -> str:
    if not _SITE.is_file():
        pytest.skip("no site/ in this tree (the Bright derivation carries none)")
    return _SITE.read_text(encoding="utf-8")


_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


def _without(html: str, attr: str) -> str:
    """The page with every element carrying `attr` taken out, nested markup and
    all: what the switch script's e.remove() leaves."""
    html = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", html, flags=re.S)
    tags = list(re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>", html))
    cuts = []
    for k, m in enumerate(tags):
        if m.group(1) or not re.search(rf"\s{attr}\b", m.group(0)):
            continue
        name, depth = m.group(2).lower(), 0
        if name in _VOID:
            cuts.append((m.start(), m.end())); continue
        for n in tags[k:]:
            if n.group(2).lower() != name:
                continue
            depth += -1 if n.group(1) else 1
            if depth == 0:
                cuts.append((m.start(), n.end())); break
    out, at = [], 0
    for a, b in sorted(cuts):
        if a < at:
            continue          # inside one already cut
        out.append(html[at:a]); at = b
    return "".join(out) + html[at:]


def test_the_site_switches_on_the_same_moment(site: str) -> None:
    scripts = re.findall(r"<script>\(function\(\)\{if\(Date\.now\(\)<Date\.parse\(\"([^\"]+)\"\)\)return;(.*?)</script>", site, re.S)
    assert len(scripts) == 1, "one switch script, not several"
    moment, body = scripts[0]
    assert moment == _pass_from()
    assert 'querySelectorAll("[data-until-pass]")' in body and "e.remove()" in body
    assert 'querySelectorAll("[data-from-pass]")' in body and 'e.style.display=""' in body
    assert 'getElementById("pro-year-amount")' in body and 'a.value="49.00"' in body
    # The switch runs after every block it touches.
    at = site.index('<script>(function(){if(Date.now()<Date.parse("' + moment)
    assert at > max(m.start() for m in re.finditer(r"\sdata-(?:until|from)-pass\b", site))


def test_before_the_switch_the_page_reads_as_today(site: str) -> None:
    """Every block for after December 15 starts hidden, and every block that
    goes then is a real, visible part of today's page."""
    page = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", site, flags=re.S)
    later = re.findall(r"<[a-zA-Z][a-zA-Z0-9]*\s[^<>]*\bdata-from-pass\b[^<>]*>", page)
    assert len(later) >= 9, later
    for tag in later:
        assert re.search(r'\bdata-from-pass style="display:none[;"]', tag), tag[:160]
    gone = re.findall(r"<[a-zA-Z][a-zA-Z0-9]*\s[^<>]*\bdata-until-pass\b[^<>]*>", page)
    assert len(gone) >= 10 and not any("display:none" in g for g in gone), gone
    assert 'name="amount" value="45.00" id="pro-year-amount"' in site


def test_after_the_switch_the_page_sells_the_pass_and_the_year_only(site: str) -> None:
    """What the page holds once the script has run: no lifetime, no Bright Pro,
    no upgrade; the year at $49 and two years at $85 (and the add-ons, sold
    before and after the switch)."""
    after = _without(site, "data-until-pass")
    forms = re.findall(r"<form[^>]*paypal\.com/cgi-bin/webscr.*?</form>", after, re.S)
    skus = sorted(re.search(r'name="item_number" value="([^"]+)"', f).group(1) for f in forms)
    addons = [s for s in skus if s.startswith("padspan-addon-")]
    # Nine add-ons and the specialty OS 2 Local for Control4 (padspan-addon-c4local, its own box, for life by design).
    assert len(addons) == 10 and [s for s in skus if s not in addons] == ["padspan-pro-2year", "padspan-pro-annual"], skus
    assert 'name="amount" value="85.00"' in next(f for f in forms if "padspan-pro-2year" in f)
    sales = after[after.index('id="lights"'):after.index('id="donate"')]
    spec = sales.index('<div class="ed" id="specialty"')
    sales = sales[:spec] + sales[sales.index('<div class="ed">', spec):]   # its "for life" is its own, not Pro's
    assert "Bright Pro" not in sales and "for life" not in sales and "$12" not in sales, \
        [ln.strip()[:120] for ln in sales.splitlines() if "Bright Pro" in ln or "for life" in ln or "$12" in ln]
    assert "$49" in sales and "$85" in sales and "a year of PadSpan Pro free" in sales
