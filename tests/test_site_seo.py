"""What the site tells search engines for Black Friday 2026 (the owner's picks, 2026-11-26).

* /pro/ sells Pro for life itself: the home page's own lifetime box, its $89 -> $168 script and the two-year box
  that takes its place from December 16, copied, never retyped, and held to the home page here (the German page
  to the German home page that scripts/build_site_de.py makes). Its description quotes both lifetime prices.
* Every date and price said here comes from the panel's one source, views/editions.js. Its moments are midnight
  Pacific (PST, UTC-8), the day boundary the site's dates are said in: a price valid "until November 30" ends at
  PRO_LIFETIME_LAUNCH_UNTIL, 2026-12-01T08:00:00Z.

The owner's rule when quoting the offer: always both lifetime prices, $89 until November 30 and $168 until
December 15, and that lifetime keys already sold stay lifetime.
"""
from __future__ import annotations

import pathlib
import re
from datetime import date, datetime, time, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SITE = _ROOT / "site"
_HOME = _SITE / "index.html"
_ED = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "editions.js"
_PRO = {"en": _SITE / "pro" / "index.html", "de": _SITE / "pro" / "de" / "index.html"}

pytestmark = pytest.mark.skipif(not _HOME.is_file(), reason="no site/ in this tree (the Bright derivation carries none)")

_PACIFIC = timezone(timedelta(hours=-8))
_MONTHS_DE = ("", "Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober",
              "November", "Dezember")


def _read(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def _flat(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _const(name: str) -> str:
    return re.search(rf'export const {name} = "([^"]*)"', _read(_ED)).group(1)


def _first_day(name: str) -> date:
    """The day an editions.js moment starts, in Pacific time; it must be a day boundary there."""
    local = datetime.fromisoformat(_const(name).replace("Z", "+00:00")).astimezone(_PACIFIC)
    assert local.time() == time(0), f"{name} is not midnight Pacific: say its dates again"
    return local.date()


def _last_day(name: str) -> date:
    """The last whole day before an editions.js moment, in Pacific time."""
    return _first_day(name) - timedelta(days=1)


def _en(d: date, year: bool = False) -> str:
    return f"{d:%B} {d.day}" + (f", {d.year}" if year else "")


def _de(d: date, year: bool = False) -> str:
    return f"{d.day}. {_MONTHS_DE[d.month]}" + (f" {d.year}" if year else "")


def _dollars(name: str) -> str:
    """'89' from PRO_LIFETIME_LAUNCH_PRICE = "$89 CAD"."""
    return re.fullmatch(r"\$(\d+(?:\.\d\d)?) CAD", _const(name)).group(1)


def _meta(page: str, attr: str, key: str) -> str:
    import html as htmllib
    return htmllib.unescape(re.search(rf'<meta {attr}="{re.escape(key)}" content="([^"]*)">', page).group(1))


def _element(page: str, start: str) -> str:
    """The element whose start tag begins with `start`, through its own end tag."""
    at = page.index(start)
    name = re.match(r"<([a-zA-Z][a-zA-Z0-9]*)", start).group(1)
    depth = 0
    for m in re.finditer(rf"<(/?){name}\b[^>]*>", page[at:]):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return page[at:at + m.end()]
    raise AssertionError(f"{start} never ends")


def _launch_script(page: str) -> str:
    return re.search(r'<script>\(function\(\)\{var e=document\.getElementById\("pro-lifetime"\);.*?</script>',
                     page, re.S).group(0)


_PASS_SWITCH = re.compile(r'<script>\(function\(\)\{if\(Date\.now\(\)<Date\.parse\("([^"]+)"\)\)return;.*?</script>', re.S)
_FORM = re.compile(r"<form[^>]*paypal\.com/cgi-bin/webscr.*?</form>", re.S)


@pytest.fixture(scope="module")
def homes() -> dict[str, str]:
    """The home page, and the German one built from it the way scripts/deploy_site.py builds it."""
    spec = spec_from_file_location("build_site_de", _ROOT / "scripts" / "build_site_de.py")
    b = module_from_spec(spec)
    spec.loader.exec_module(b)
    en = _read(_HOME)
    return {"en": en, "de": b.build(en)[0]}


# --------------------------------------------------------------------- /pro/ sells Pro for life

# The owner's rule: lifetime keys already sold stay lifetime (the changelog's words). The one sentence the home
# page's box doesn't have; it follows the part the December 1 switch rewrites, so it is said before and after it.
_STAY = {"en": "Lifetime keys already sold stay lifetime. ",
         "de": "Bereits verkaufte Lebenszeit-Lizenzen bleiben lebenslang gültig. "}


@pytest.mark.parametrize("lang", ["en", "de"])
def test_pro_sells_pro_for_life_exactly_as_the_home_page_does(homes: dict, lang: str) -> None:
    home, pro = homes[lang], _read(_PRO[lang])
    box = _element(pro, '<div id="pro-lifetime"')
    later = _element(box, '<span id="pl-later"')
    assert box.count(_STAY[lang]) == 1 and box.index(_STAY[lang]) > box.index(later), "said outside what Dec 1 rewrites"
    assert _flat(box.replace(_STAY[lang], "")) == _flat(_element(home, '<div id="pro-lifetime"'))
    assert _flat(_launch_script(pro)) == _flat(_launch_script(home))
    assert pro.index(_launch_script(pro)) > pro.index(box), "the $168 switch runs before its box is on the page"
    assert _flat(_element(pro, '<div id="pro-pass"')) == _flat(_element(home, '<div id="pro-pass"'))
    # The December 16 switch: the home page's own, at the panel's moment, after every block it touches.
    switch = [m.group(0) for m in _PASS_SWITCH.finditer(pro)]
    assert len(switch) == 1 and _flat(switch[0]) == _flat(_PASS_SWITCH.search(home).group(0))
    assert _PASS_SWITCH.search(pro).group(1) == _const("PRO_PASS_FROM")
    assert pro.index(switch[0]) > max(m.start() for m in re.finditer(r"\sdata-(?:until|from)-pass\b", pro))


@pytest.mark.parametrize("lang", ["en", "de"])
def test_pros_paypal_forms_are_the_home_pages(homes: dict, lang: str) -> None:
    """Field for field the home page's lifetime and two-year forms, at the amounts the licence server expects."""
    from tests.test_site_claims import _SKUS

    def sku(form: str) -> str:
        return re.search(r'name="item_number" value="([^"]+)"', form).group(1)

    forms = _FORM.findall(_read(_PRO[lang]))
    home = {sku(f): f for f in _FORM.findall(homes[lang])}
    assert [sku(f) for f in forms] == ["padspan-pro-lifetime", "padspan-pro-2year"]
    for form in forms:
        assert _flat(form) == _flat(home[sku(form)]), sku(form)
        assert float(re.search(r'name="amount" value="([^"]+)"', form).group(1)) == _SKUS[sku(form)][0]
        for field, value in (("cmd", "_xclick"), ("business", "garry@bcmail.net"), ("currency_code", "CAD"),
                             ("notify_url", "https://traks.ca/license/?action=ipn"),
                             ("return", "https://padspan.traks.ca/?bought=1")):
            assert f'name="{field}" value="{value}"' in form, (sku(form), field)


@pytest.mark.parametrize("lang", ["en", "de"])
def test_pro_shows_the_lifetime_box_until_december_15_and_the_two_years_after(lang: str) -> None:
    """Without JavaScript the page reads as before the switch (the lifetime box, at $89, until the Dec 16 tidy), as
    the home page does; the switch takes the lifetime box away and shows two years."""
    from tests.test_pricing_dec16 import _without
    pro = _read(_PRO[lang])
    page = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", pro, flags=re.S)
    gone = re.findall(r"<[a-zA-Z][a-zA-Z0-9]*\s[^<>]*\bdata-until-pass\b[^<>]*>", page)
    later = re.findall(r"<[a-zA-Z][a-zA-Z0-9]*\s[^<>]*\bdata-from-pass\b[^<>]*>", page)
    assert len(gone) == 1 and 'id="pro-lifetime"' in gone[0] and "display:none" not in gone[0]
    assert len(later) == 1 and 'id="pro-pass"' in later[0] and 'data-from-pass style="display:none;' in later[0]
    assert 'name="amount" value="89.00" id="pl-amount"' in pro
    before, after = _without(pro, "data-from-pass"), _without(pro, "data-until-pass")
    assert "padspan-pro-lifetime" in before and "padspan-pro-2year" not in before
    assert "padspan-pro-lifetime" not in after and "padspan-pro-2year" in after


def test_pro_quotes_the_offer_by_the_owners_rule() -> None:
    """Both lifetime prices with their last days, and that lifetime keys already sold stay lifetime, in the box and
    in the description (160 characters at most), each price and day the panel's."""
    import html as htmllib
    launch, full = _dollars("PRO_LIFETIME_LAUNCH_PRICE"), _dollars("PRO_LIFETIME_FULL_PRICE")
    nov30, dec15 = _last_day("PRO_LIFETIME_LAUNCH_UNTIL"), _last_day("PRO_PASS_FROM")
    assert (launch, full, nov30, dec15) == ("89", "168", date(2026, 11, 30), date(2026, 12, 15))
    en, de = (_read(_PRO[lang]) for lang in ("en", "de"))
    box_en = _flat(htmllib.unescape(re.sub(r"<[^>]+>", "", _element(en, '<div id="pro-lifetime"'))))
    box_de = _flat(htmllib.unescape(re.sub(r"<[^>]+>", "", _element(de, '<div id="pro-lifetime"'))))
    assert f"${launch} until {_en(nov30, True)}, then ${full} until {_en(dec15)}." in box_en
    assert _STAY["en"].strip() in box_en
    assert f"{launch} CAD (ca. 59 €) bis zum {_de(nov30, True)}, dann {full} CAD (ca. 112 €) bis zum {_de(dec15)}." in box_de
    assert _STAY["de"].strip() in box_de
    desc_en, desc_de = _meta(en, "name", "description"), _meta(de, "name", "description")
    assert len(desc_en) <= 160 and len(desc_de) <= 160
    assert f"${launch} CAD until {_en(nov30, True)}, then ${full} until {_en(dec15)}." in desc_en
    assert "Lifetime keys already sold stay lifetime." in desc_en
    assert f"{launch} CAD bis {_de(nov30, True)}, dann {full} CAD bis {_de(dec15)}," in desc_de
    assert "Lebenszeit-Lizenzen bleiben gültig." in desc_de
