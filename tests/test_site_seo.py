"""What the site tells search engines for Black Friday 2026 (the owner's picks, 2026-11-26).

* /pro/ sells Pro for life itself: the home page's own lifetime box, its $89 -> $168 script and the two-year box
  that takes its place from December 16, copied, never retyped, and held to the home page here (the German page
  to the German home page that scripts/build_site_de.py makes). Its description quotes both lifetime prices.
* /add-ons/ says the sale and its days in its title (60 characters at most, " | PadSpan HA" included),
  description and og: lines, in words true before it starts and while it runs, and never implies Advanced map
  creation or Robot vacuum are half off before they go on sale. Each add-on's heading shows its price, and half of
  it in the sale, switched the way the home page's #addons box switches its prices (the owner, 2026-11-26).
* Structured data only on the home page (PadSpan HA, free) and /pro/ (Pro for life's two prices). /add-ons/
  marks up no price: its prices switch in the browser.
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
_ADDONS = {"en": _SITE / "add-ons" / "index.html", "de": _SITE / "add-ons" / "de" / "index.html"}

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
    assert f"{launch} CAD bis {_de(nov30, True)}, dann {full} CAD bis {_de(dec15)}." in desc_de
    assert desc_de.endswith(" " + _STAY["de"].strip()), "the owner's whole sentence"


# --------------------------------------------------------------------- /add-ons/ says the sale

# The two add-ons that go on sale on December 1 (editions.js on_sale_from: FREE_BASICS_FROM), as each page names them.
_FROM_DEC1 = {"en": ("Advanced map creation", "Robot vacuum"), "de": ("Erweiterte Kartenerstellung", "Saugroboter")}


@pytest.mark.parametrize("lang", ["en", "de"])
def test_the_add_ons_page_says_the_sale_in_its_title_and_description(lang: str) -> None:
    """With its first and last day, so it is true before the sale starts as well as while it runs."""
    page = _read(_ADDONS[lang])
    title = re.search(r"<title>([^<]+)</title>", page).group(1)
    desc = _meta(page, "name", "description")
    assert title.endswith(" | PadSpan HA") and len(title) <= 60, (len(title), title)
    assert len(desc) <= 160, (len(desc), desc)
    assert _meta(page, "property", "og:title") == title.removesuffix(" | PadSpan HA")
    assert _meta(page, "property", "og:description") == desc
    nov27, jan1 = _first_day("ADDON_HALF_FROM"), _last_day("ADDON_HALF_UNTIL")
    assert (nov27, jan1) == (date(2026, 11, 27), date(2027, 1, 1))
    term = re.search(r'export const ADDON_TERM = "(\d+) years";', _read(_ED)).group(1)
    short = {d: f"{d.day}. {_MONTHS_DE[d.month][:3]}." for d in (nov27, jan1)}     # "27. Nov.": the title's 60
    said = {"en": (f"half off from {_en(nov27)} to {_en(jan1)} |",
                   f"Every add-on on sale is half off from {_en(nov27)} to {_en(jan1)}.",
                   "One feature each", f"one payment for {term} years on up to 3 homes", "PadSpan Pro includes them all."),
            "de": (f"{short[nov27]} bis {short[jan1]} zum halben Preis |",
                   f"Jedes erhältliche Add-on vom {_de(nov27)} bis {_de(jan1)} zum halben Preis.",
                   "Je eine Funktion", f"eine Zahlung für {term} Jahre auf bis zu 3 Zuhause", "Pro enthält sie alle.")}[lang]
    assert said[0] in title and all(words in desc for words in said[1:]), (title, desc)
    # They go on sale after the sale starts, so nothing seen before a click names them: nothing implies they are
    # half off before December 1.
    assert _first_day("FREE_BASICS_FROM") > _first_day("ADDON_HALF_FROM")
    for name in _FROM_DEC1[lang]:
        assert name not in title + desc, name


# --------------------------------------------------------------------- /add-ons/ shows each add-on's price

def _on_sale() -> list[dict]:
    """editions.js ADDONS that are sold and in the sale: not part of another (on_sale: false with no moment), not a
    specialty. Each with its name, words, price and on_sale_from ("" or the constant it names)."""
    out = []
    for row in re.findall(r'\{ name: "\w+",.*?desc: "[^"]+" \}', _read(_ED), re.S):
        get = {m.group(1): m.group(2) if m.group(2) is not None else m.group(3)
               for m in re.finditer(r'(\w+): (?:"([^"]*)"|(\w+))', row)}
        if get.get("category") == "specialty" or (get.get("on_sale") == "false" and not get.get("on_sale_from")):
            continue
        out.append(get)
    return out


def _cents(price: str) -> int:
    return round(float(re.sub(r"[^0-9.]", "", price)) * 100)


def _amount(price: str) -> str:
    """"$6.45 CAD" -> "6.45"."""
    return f"{_cents(price) / 100:.2f}"


def _half(price: str) -> str:
    """editions.js halfPrice: half the price, rounded down to the cent ("$6.45 CAD" -> "3.22")."""
    return f"{_cents(price) // 2 / 100:.2f}"


def _addons_switch(page: str) -> str:
    return re.search(r'<script>\(function\(\)\{var b=document\.getElementById\("addons"\);.*?</script>', page, re.S).group(0)


def _behind_december_1(page: str, anchor: str) -> bool:
    """Whether the add-on's section sits in a block the December 1 switch shows (hidden until then)."""
    at = page.index(f'<section class="addon" id="{anchor}">')
    for m in re.finditer(r'<div data-from-basics style="display:none">', page):
        if m.start() < at < m.start() + len(_element(page[m.start():], '<div data-from-basics style="display:none">')):
            return True
    return False


@pytest.mark.parametrize("lang", ["en", "de"])
def test_the_add_ons_page_shows_each_price_and_half_of_it_in_the_sale_as_the_home_page_does(homes: dict, lang: str) -> None:
    """Each add-on on sale shows its editions.js price in its heading, in the markup the live page had (a
    span.price), and from ADDON_HALF_FROM until ADDON_HALF_UNTIL half of it, rounded down to the cent, with the home
    page's own words under it, "Half off through January 1 (normally $6.45)", in German as the German home page
    says it. The switch is the home page's #addons script on the same two moments, so without JavaScript the
    normal price shows. Advanced map creation and Robot vacuum sit behind the December 1 switch (FREE_BASICS_FROM):
    they show only once they are on sale, already at their sale price."""
    import html as htmllib
    import json
    page = _read(_ADDONS[lang])
    units = {u["en"]: u["de"] for u in json.loads(_read(_SITE / "i18n" / "de.json"))["units"]}
    assert re.search(r"<main\b[^>]*>", page).group(0) == (
        f'<main id="addons" data-half-from="{_const("ADDON_HALF_FROM")}" data-half-until="{_const("ADDON_HALF_UNTIL")}">')
    assert _flat(_addons_switch(page)) == _flat(_addons_switch(homes["en"])) == _flat(_addons_switch(homes[lang]))
    assert page.index(_addons_switch(page)) > max(m.start() for m in re.finditer(r"\sdata-addon-price=", page)), \
        "the switch runs before a price it touches is on the page"
    assert ".links{font-weight:700}\nh3 .price{color:var(--mut);font-weight:600;font-size:15px;margin-left:6px}\n" in page
    shown = (lambda a: f"${a} CAD") if lang == "en" else (lambda a: f"{a.replace('.', ',')} CAD")
    sections = dict(re.findall(r'<section class="addon" id="([\w-]+)">\n(.*?)</section>', page, re.S))
    want = {("activity" if a["name"] == "timetravel" else a["name"]): a for a in _on_sale()}
    assert set(sections) == set(want) and len(want) == 11
    for anchor, a in want.items():
        normal, half = _amount(a["price"]), _half(a["price"])
        words = f"Half off through January 1 (normally ${normal})"
        assert words in homes["en"], "the home page's own words"
        note = words if lang == "en" else units[words]
        heading = re.match(r"<h3>([^<]+) (<span.*?)</h3>\n", sections[anchor])
        assert heading, anchor
        assert heading.group(2) == (
            f'<span class="price" data-addon-price="normal">{shown(normal)}</span>'
            f'<span class="price" data-addon-price="half" style="display:none;color:var(--acc2);font-weight:800">'
            f'{shown(half)}</span>'), anchor
        assert sections[anchor][heading.end():].startswith(
            f'<p class="aka" data-addon-price="half" style="display:none;color:var(--acc2);font-weight:700">'
            f'{htmllib.escape(note, quote=False)}</p>\n'), anchor
        assert _behind_december_1(page, anchor) == (a.get("on_sale_from") == "FREE_BASICS_FROM"), anchor
    # Without JavaScript only the normal prices show.
    tags = re.findall(r'<[a-z]+\b[^>]*\bdata-addon-price="(?:normal|half)"[^>]*>', page)
    assert len(tags) == 3 * 11
    for tag in tags:
        assert ('data-addon-price="half" style="display:none;' in tag) == ('data-addon-price="half"' in tag), tag
        assert "display:none" not in tag or 'data-addon-price="half"' in tag, tag


def test_the_add_ons_pages_prices_are_what_the_panel_charges_before_during_and_after_the_sale() -> None:
    """The panel's own addonPrice, run before each add-on's sale price starts (ADDON_HALF_FROM, or its on-sale
    moment if later), on its first and last moment, and after ADDON_HALF_UNTIL: the page's normal, half and normal
    prices. Advanced map creation and Robot vacuum aren't sold before December 1, so not half off then either."""
    import json
    import shutil
    import subprocess
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    run = ("const E = await import(" + json.dumps(_ED.as_uri()) + ");"
           "const out = {}; for (const a of E.ADDONS) { const from = Math.max(Date.parse(E.ADDON_HALF_FROM),"
           " a.on_sale_from ? Date.parse(a.on_sale_from) : 0), until = Date.parse(E.ADDON_HALF_UNTIL);"
           " out[a.name] = [E.addonPrice(a.name, from - 1), E.addonPrice(a.name, from), E.addonPrice(a.name, until - 1),"
           " E.addonPrice(a.name, until), E.addonPriceParts(a.name, from - 1).half, E.addonOnSale(a.name, from - 1)]; }"
           "console.log(JSON.stringify(out));")
    r = subprocess.run([node, "--input-type=module", "-e", run], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    panel = json.loads(r.stdout.strip().splitlines()[-1])
    page = _read(_ADDONS["en"])
    anchors = re.findall(r'<section class="addon" id="([\w-]+)">\n<h3>[^<]+ <span', page)
    assert len(anchors) == 11
    for anchor in anchors:
        before, first, last, after, half_before, sold_before = panel["timetravel" if anchor == "activity" else anchor]
        spans = dict(re.findall(r'data-addon-price="(normal|half)"[^>]*>([^<]+)</span>',
                                re.search(rf'<section class="addon" id="{anchor}">\n<h3>.*?</h3>', page).group(0)))
        assert before == after == spans["normal"] and first == last == spans["half"], anchor
        assert not half_before, anchor
        assert sold_before == (anchor not in ("maps", "vacuum")), anchor


# --------------------------------------------------------------------- structured data

def _jsonld(page: str) -> list:
    """Each JSON-LD block on a page, parsed; every one sits in <head>, as static text."""
    import json
    blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S)
    if blocks:
        end = page.find("</head>")
        assert end >= 0 and all(f">{b}</script>" in page[:end] for b in blocks), "a JSON-LD block outside <head>"
    return [json.loads(b) for b in blocks]


def _keys(node) -> set:
    if isinstance(node, dict):
        return set(node) | set().union(*(_keys(v) for v in node.values()))
    if isinstance(node, list):
        return set().union(*(_keys(v) for v in node)) if node else set()
    return set()


def test_no_page_claims_a_rating_or_a_review() -> None:
    """There are none, so no page's structured data may say there are."""
    for page in sorted(_SITE.rglob("*.html")):
        for data in _jsonld(_read(page)):
            assert not {"aggregateRating", "review", "reviews"} & _keys(data), page


def test_the_home_page_says_padspan_ha_is_free_software_and_the_german_page_says_the_same(homes: dict) -> None:
    """A SoftwareApplication: free (0 CAD), for Home Assistant, downloaded from its GitHub repository. The German page
    is built from this one and leaves every script as it is (build_site_de.check() stops a deploy otherwise)."""
    assert _jsonld(homes["en"]) == [{
        "@context": "https://schema.org", "@type": "SoftwareApplication", "name": "PadSpan HA",
        "applicationCategory": "HomeApplication", "operatingSystem": "Home Assistant", "url": "https://padspan.traks.ca/",
        "downloadUrl": "https://github.com/gbroeckling/padspanHA",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "CAD"}}]
    assert _jsonld(homes["de"]) == _jsonld(homes["en"])
    assert '<link rel="canonical" href="https://padspan.traks.ca/">' in homes["en"]


@pytest.mark.parametrize("lang", ["en", "de"])
def test_pros_structured_data_is_pro_for_life_at_the_panels_prices_and_days(lang: str) -> None:
    """$89 until the end of November 30 (PRO_LIFETIME_LAUNCH_UNTIL), then $168 from December 1 until the end of
    December 15 (PRO_PASS_FROM): the prices the page's form and its script charge."""
    pro = _read(_PRO[lang])
    url = re.search(r'<link rel="canonical" href="([^"]+)">', pro).group(1)
    launch = f'{float(_dollars("PRO_LIFETIME_LAUNCH_PRICE")):.2f}'
    full = f'{float(_dollars("PRO_LIFETIME_FULL_PRICE")):.2f}'
    names = {"en": ("PadSpan Pro for life, launch price", "PadSpan Pro for life"),
             "de": ("PadSpan Pro auf Lebenszeit, Einführungspreis", "PadSpan Pro auf Lebenszeit")}[lang]
    [data] = _jsonld(pro)
    assert data["@type"] == "Product" and data["name"] == "PadSpan Pro" and data["url"] == url
    assert data["image"] == _meta(pro, "property", "og:image")
    assert data["offers"] == [
        {"@type": "Offer", "name": names[0], "price": launch, "priceCurrency": "CAD",
         "priceValidUntil": _last_day("PRO_LIFETIME_LAUNCH_UNTIL").isoformat(), "url": url},
        {"@type": "Offer", "name": names[1], "price": full, "priceCurrency": "CAD",
         "validFrom": _first_day("PRO_LIFETIME_LAUNCH_UNTIL").isoformat(),
         "priceValidUntil": _last_day("PRO_PASS_FROM").isoformat(), "url": url}]
    assert [o["price"] for o in data["offers"]] == ["89.00", "168.00"]
    assert f'name="amount" value="{launch}" id="pl-amount"' in pro
    assert f'getElementById("pl-amount").value="{full}"' in _launch_script(pro)
    # The Dec 16 tidy is written down beside it.
    head = _flat(pro[:pro.index("</head>")])
    assert "The Dec 16 tidy" in head and _const("PRO_PASS_FROM") in head



_PRICE_KEYS = {"offers", "price", "lowPrice", "highPrice", "priceCurrency", "priceSpecification"}


def test_only_the_pages_that_show_a_price_mark_one_up() -> None:
    """Structured data must say what the page shows. The home page shows PadSpan HA is free and /pro/ shows Pro for
    life's prices. No other page marks a price up: /add-ons/ shows its prices but switches them in the browser,
    and no other page shows one (tests/test_site_guides.py)."""
    may = {_HOME, *_PRO.values()}
    for page in sorted(_SITE.rglob("*.html")):
        if page in may:
            continue
        for data in _jsonld(_read(page)):
            assert not _PRICE_KEYS & _keys(data), page
    for page in _ADDONS.values():
        assert _jsonld(_read(page)) == [], page

# --------------------------------------------------------------------- Search Console

def test_the_search_console_line_has_its_marked_place_and_no_made_up_value() -> None:
    """A marked place in the home page's <head> for the google-site-verification line the owner will send. Until he
    does there is none; once there, it carries a value Google gave, never a placeholder."""
    page = _read(_HOME)
    head = page[:page.index("</head>")]
    assert head.count("<!-- GOOGLE SEARCH CONSOLE VERIFICATION:") == 1
    live = re.sub(r"<!--.*?-->", "", page, flags=re.S)
    assert len(re.findall(r'<meta name="google-site-verification"', live)) <= 1
    for value in re.findall(r'<meta name="google-site-verification" content="([^"]*)">', live):
        assert re.fullmatch(r"[A-Za-z0-9_-]{20,}", value), value
        assert f'<meta name="google-site-verification" content="{value}">' in head
