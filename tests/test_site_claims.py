"""The landing page must not out-live its own claims.

`site/index.html` is padspan.traks.ca. It is in the repo precisely because the
hand-maintained copy on the colo drifted: on 2026-08-23, hours after v0.37.0
shipped, it still advertised v0.21.4 and still told buyers to enable "Show beta
versions" in HACS "until 0.22.x reaches stable" — on the page that takes their
money. It also listed three features (trackability rating, compass ring
calibration, replay timeline) that were settings keys with no implementation
anywhere in the integration.

These tests pin the parts of that failure that a machine can check: the version
claims stay stampable, the stated requirements agree with what HACS enforces,
the payment plumbing is not edited by accident, and the three retired features
do not come back. What no test can check is whether new prose is true — that is
still a human reading it before deploying.
"""
from __future__ import annotations

import json
import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SITE = _ROOT / "site" / "index.html"
_HACS = _ROOT / "hacs.json"
_MANIFEST = _ROOT / "custom_components" / "padspan_ha" / "manifest.json"

pytestmark = pytest.mark.skipif(not _SITE.exists(), reason="site/index.html is not in this tree")


@pytest.fixture(scope="module")
def html() -> str:
    return _SITE.read_text(encoding="utf-8")


def test_every_version_claim_is_stampable(html: str) -> None:
    """scripts/deploy_site.py rewrites these; if the markup drifts it silently
    stops rewriting anything and the page freezes on an old version."""
    from importlib.util import module_from_spec, spec_from_file_location

    spec = spec_from_file_location("deploy_site", _ROOT / "scripts" / "deploy_site.py")
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)

    version = json.loads(_MANIFEST.read_text(encoding="utf-8"))["version"]
    stamped, n = mod.stamp(html, version)
    assert n >= 2, f"only {n} version claim(s) are stampable — deploy_site would leave the rest stale"
    assert mod._VER_TAG_CLAIM.findall(stamped) == [version] * n


def test_no_release_history_entry_is_stampable(html: str) -> None:
    """A dated entry in "What's new" is a statement about a PAST release. It is
    a fact, not a claim about the current version, and stamping it rewrites
    history.

    This happened. The v0.37.0 entry carried `data-latest-version` because it
    was the newest entry the day it was written; adding a v0.38.0 entry above
    it left the marker sitting on history. Every deploy then relabelled it, and
    on 2026-08-25 the live page carried "v0.38.5 · Stable · 23 August 2026"
    over the text describing v0.37.0's changes.

    `data-latest-version` belongs only on claims that mean "the current stable
    release is X" — the hero badge and the licence section's requirement line.
    """
    import re

    for block in re.findall(r'<div class="relitem">.*?</div>\s*</div>', html, re.S):
        assert "data-latest-version" not in block, (
            "a release-history entry is marked stampable, so deploy_site will rewrite its "
            "version number to whatever ships next:\n"
            f"{block[:300]}\n"
            "Release history is immutable — remove data-latest-version and write the "
            "literal version. Add a NEW entry for the new release instead.")


def test_stated_ha_requirement_matches_hacs(html: str) -> None:
    """The page promises a minimum Home Assistant version. HACS enforces one.
    If they disagree, somebody is told the wrong thing."""
    required = json.loads(_HACS.read_text(encoding="utf-8"))["homeassistant"]
    major_minor = ".".join(required.split(".")[:2])
    assert f"HA {major_minor}+" in html or f"Home Assistant {major_minor}+" in html, (
        f"hacs.json requires {required}; the page does not state {major_minor}+")


def test_payment_plumbing_is_exact(html: str) -> None:
    """A typo here does not 404 — it takes the wrong amount, or takes money and
    never notifies the licence server. Nothing about this may change silently."""
    for field, value in [
        ("cmd", "_xclick"),
        ("business", "garry@bcmail.net"),
        ("item_number", "padspan-pro-annual"),
        ("amount", "45.00"),
        ("currency_code", "CAD"),
        ("notify_url", "https://traks.ca/license/?action=ipn"),
    ]:
        assert f'name="{field}" value="{value}"' in html, f"PayPal field {field} is not {value!r}"
    # The price in the copy must agree with the price actually charged.
    assert "$45" in html, "the displayed price does not mention $45 while the form charges 45.00"


def test_bright_is_not_claimed_unreleased(html: str) -> None:
    """gbroeckling/padspanBright went public and live 2026-09-09 (BRIGHT_PUBLISH
    = True in scripts/release.py) — the page said "Not yet released" /
    "not released yet" for days after that, telling paying customers the
    standalone download did not exist when it did. Pinned so a future revert
    of BRIGHT_PUBLISH (or a copy-paste of old prose) cannot silently bring the
    stale claim back without this test catching it."""
    lowered = html.lower()
    assert "not yet released" not in lowered, "Bright is live — this claim is stale"
    assert "not released yet" not in lowered, "Bright is live — this claim is stale"
    assert "github.com/gbroeckling/padspanbright" in lowered, (
        "the live Bright repo should be linked now that it exists")


# What the licence server (traks.ca/license, not in this repo) matches on. It
# reads item_number, looks for these substrings, and requires at least the
# matching price — so a renamed SKU or a lowered amount does not fail loudly, it
# quietly issues the WRONG TIER or no key at all while PayPal still takes the
# money. Checked here because the two live in different places and must agree.
#   marker order in the server: upgrade -> bright -> padspan (most specific first)
_SKUS = {
    "padspan-bright-annual":        (35.00, ("bright",),               ("upgrade",)),
    "padspan-pro-annual":           (45.00, ("padspan",),              ("upgrade", "bright")),
    "padspan-bright-to-pro-upgrade": (12.00, ("upgrade", "padspan"),   ()),
    # Pro for life: the form's own amount is the launch price ($89, until
    # Nov 30, 2026; the page's script makes it $168 from Dec 1). The server
    # decides a SKU with BOTH 'padspan' and 'lifetime' before every other tier.
    "padspan-pro-lifetime":         (89.00, ("padspan", "lifetime"),   ("upgrade", "bright")),
    # Two years of Pro, from the end of December 15, 2026 (the page shows its
    # box from then). The server decides 'padspan' AND '2year' before the year,
    # so the SKU must never carry 'lifetime', 'upgrade' or 'bright'.
    "padspan-pro-2year":            (85.00, ("padspan", "2year"),      ("upgrade", "bright", "lifetime")),
    # PadSpan add-ons (2026-11-25), one SKU each: the server decides any item with
    # 'padspan' AND 'addon' as an add-on before every Pro tier, then matches it
    # exactly, so an add-on SKU never carries another tier's marker. maps and
    # vacuum are on the page from December 1 (the free-basics switch shows them).
    **{f"padspan-addon-{name}": (price, ("padspan", "addon"), ("upgrade", "bright", "lifetime", "2year"))
       for name, price in (("audio", 6.45), ("alarm", 6.45), ("wifi", 6.45), ("climate", 8.65), ("timetravel", 7.55),
                           ("vacation", 4.25), ("looks", 4.25), ("insights", 5.56),
                           ("maps", 8.65), ("lighting", 8.65), ("vacuum", 6.45))},
    # The specialty OS 2 Local for Control4 (2026-11-25): an add-on SKU like the others, for life, never half price.
    "padspan-addon-c4local":        (26.00, ("padspan", "addon"),      ("upgrade", "bright", "lifetime", "2year")),
}

_ED = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "editions.js"
# editions.js ADDONS, one entry each: (name, words, price, on_sale_from or "", desc).
_ADDON_ROW = re.compile(r'\{ name: "(\w+)", words: "([^"]+)", price: "\$(\d+\.\d\d) CAD",(?: on_sale_from: (\w+),)?\s+'
                        r'desc: "([^"]+)" \}')


def _addon_box(html: str) -> str:
    box = html[html.index('<div class="ed" id="addons"'):]
    return box[:box.index('<div class="ed">')]


def test_the_add_ons_are_sold_as_the_panel_says(html: str) -> None:
    """editions.js's ADDONS (name, words, price, what it unlocks), its term and
    link, and the site's #addons box with one PayPal form per add-on, say the
    same thing; Audio, Advanced map creation and Robot vacuum are at their own
    anchors; an add-on that goes on sale at a moment (on_sale_from) has its box
    behind the free-basics switch, which is that moment; and the add-ons are
    said to be in Pro."""
    ed = _ED.read_text(encoding="utf-8")
    table = _ADDON_ROW.findall(ed)
    # Forensics is part of Presence insights since 2026-11-26 (editions.js part_of): never sold, no row of its own.
    assert [n for n, *_ in table] == ["audio", "alarm", "wifi", "climate", "timetravel", "vacation", "looks",
                                      "insights", "maps", "lighting", "vacuum"]
    # The site has one switch for an add-on going on sale: December 1's (test_the_free_basics_switch_is_the_panels_moment).
    assert {f for _, _, _, f, _ in table} == {"", "FREE_BASICS_FROM"}
    term = re.search(r'ADDON_TERM = "(\d+) years"', ed).group(1)
    assert re.search(r'ADDONS_URL = "https://padspan\.traks\.ca/#addons"', ed)
    box = _addon_box(html)
    assert html.index('id="editions"') < html.index('id="addons"') < html.index('</section>', html.index('id="editions"'))
    assert f"covers {term} years" in box and "PadSpan Pro includes them all" in box
    for name, words, price, on_sale_from, desc in table:
        row = re.search(r'<div[^>]*data-addon="' + name + r'".*?</form>', box, re.S)
        assert row, name
        behind = f'<div data-from-basics style="display:none"><div id="{name}" data-addon="{name}" '
        assert (behind in box) == bool(on_sale_from), name
        row = row.group(0)
        assert "-basics" not in row, name
        # Every add-on at its own anchor (the review, 2026-11-26): its name, Full house activity's "activity".
        assert f' id="{"activity" if name == "timetravel" else name}"' in row, name
        assert f'{words.replace("&", "&amp;")} <span' in row and f"${price} CAD</span>" in row, name
        assert desc.replace("&", "&amp;") in row, name
        assert f'name="item_number" value="padspan-addon-{name}"' in row and f'name="amount" value="{price}"' in row, name
        assert float(price) == _SKUS[f"padspan-addon-{name}"][0], name


# December 1, 2026, 00:00 Pacific (the owner, 2026-11-25): the free basics. One script, after every block it touches,
# removes the data-until-basics blocks and shows the data-from-basics ones, as the December 16 switch does its pair.
_BASICS_SWITCH = re.compile(
    r'<script>\(function\(\)\{var from="([^"]+)";if\(Date\.now\(\)<Date\.parse\(from\)\)return;(.*?)</script>', re.S)


def _seen(page: str) -> str:
    """A page's words as a visitor reads them: no scripts, no tags, whitespace collapsed."""
    import html as htmllib
    page = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", page, flags=re.S)
    return re.sub(r"\s+", " ", htmllib.unescape(re.sub(r"<[^>]+>", "", page)))


def _periods(html: str) -> dict:
    """What a visitor sees before December 1, from it to December 15, and from December 16: each switch's own
    e.remove() (tests/test_pricing_dec16.py's _without), and the blocks a switch has not shown yet left out too."""
    from functools import reduce

    from tests.test_pricing_dec16 import _without
    return {when: reduce(_without, cut, html) for when, cut in (
        ("before", ("data-from-basics", "data-from-pass")),
        ("december", ("data-until-basics", "data-from-pass")),
        ("after", ("data-until-basics", "data-until-pass")))}


def test_the_free_basics_switch_is_the_panels_moment(html: str) -> None:
    """The site switches at editions.js FREE_BASICS_FROM (the backend's const.FREE_BASICS_FROM_TS is the same moment,
    tests/test_free_basics_dec1.py). Every block for December 1 on starts hidden; every block that goes then is a
    visible part of the page before it."""
    switches = _BASICS_SWITCH.findall(html)
    assert len(switches) == 1, "one free-basics switch, not several"
    moment, body = switches[0]
    ed = _ED.read_text(encoding="utf-8")
    assert moment == re.search(r'export const FREE_BASICS_FROM = "([^"]+)"', ed).group(1) == "2026-12-01T08:00:00Z"
    assert 'document.querySelectorAll("[data-until-basics]").forEach(function(e){e.remove();});' in body
    assert 'document.querySelectorAll("[data-from-basics]").forEach(function(e){e.style.display="";});' in body
    at = html.index(f'<script>(function(){{var from="{moment}";')
    assert at > max(m.start() for m in re.finditer(r"\sdata-(?:until|from)-basics\b", html)), \
        "the switch runs before a block it touches is on the page"
    page = re.sub(r"<script\b.*?</script>|<!--.*?-->", "", html, flags=re.S)
    later = re.findall(r"<[a-zA-Z][a-zA-Z0-9]*\s[^<>]*\bdata-from-basics\b[^<>]*>", page)
    assert len(later) >= 20, later
    for tag in later:
        assert re.search(r'\bdata-from-basics style="display:none[;"]', tag), tag[:160]
    gone = re.findall(r"<[a-zA-Z][a-zA-Z0-9]*\s[^<>]*\bdata-until-basics\b[^<>]*>", page)
    assert len(gone) >= 15 and not any("display:none" in g for g in gone), gone


# Words that are true only before December 1 (light placement, the 3D house and the wall screen paid), and the words
# that replace them, true from it. Each set is on the page in its own blocks only.
_PAID_BASICS = ("Wall mode fits the whole house to a wall screen and dims it at night", "3D is Pro",
                "like looking into a house in The Sims, and Furnish fills the rooms.",
                "Each light sits exactly where it hangs, in its real shape and size",
                "Place each light exactly where it hangs, in metres", "Fans, locks and sensors placed the same way",
                "Placement comes with PadSpan Pro at $45 a year", "PadSpan Pro for exact placement, the 3D house and wall mode",
                "Wall mode on the Atlas page is PadSpan Pro.", "The 3D house (Pro)", "PadSpan Pro's 3D house.",
                "PadSpan Pro adds the 3D house, exact placement and wall mode",
                "Lights glow in their real colour, lit windows glow at night", "Walk through the 3D house at eye height",
                "Exact placement of every light, fan, lock and sensor",
                "Wall mode fits the whole house to a wall screen, sizes the text for the room",
                "Live Aboard, the house in 3D, and Furnish", "Light placement, shapes, WLED, Showcase",
                "Wall mode and the Atlas as your Overview", "a PDF, a LiDAR scan or a blank floor",
                "Light placement — that is Bright Pro", "Light placement, fixture shapes and sizes",
                "It's free to run, and placement takes a key.")
_FREE_BASICS = ("It dims at night and shifts against burn-in",
                "A LiDAR scan's plan takes Pro or the Advanced map creation add-on",
                "Its real shape and size, WLED effects and Automorph, and a power team",
                "Each light and device placed exactly where it is, in metres",
                "Wall mode: the Atlas on a wall screen, sized for the room",
                "Live Aboard: the house in 3D, built from the map you already drew",
                "PadSpan Pro for Furnish, fixture shapes and the wall screen's extras",
                "Wall mode on the Atlas page is free; its night dimming and burn-in shift are PadSpan Pro.",
                "and a RoomPlan app that shares USDZ, and PadSpan Pro or the Advanced map creation add-on",
                "The sample house in Live Aboard, furnished with PadSpan Pro.",
                "PadSpan Pro adds Furnish, fixture shapes and the wall screen's extras",
                "Live Aboard's extras. The house in 3D is free.", "Placing each light and device exactly is free.",
                "The plain wall screen is free.", ", and so do Advanced map creation and Robot vacuum",
                "Furnish, people and the editor in the 3D house", "Fixture shapes, WLED, Showcase",
                "The wall screen's extras and the Atlas as your Overview",
                "Exact light and device placement, the wall screen and the 3D house", "Exact light and device placement",
                "It's free to run, placement included, and fixture shapes, WLED and Automorph take a key.",
                "30% off ($6.05 CAD) if you already own Robot vacuum",
                "30% off ($4.51 CAD) if you already own Advanced map creation")


def test_the_free_basics_read_right_before_december_1_until_december_15_and_after(html: str) -> None:
    """Before the moment the page says what it said before it; from it, the free basics and the two new add-ons; and
    the December 16 switch still retires Bright Pro on top of it."""
    from tests.test_pricing_dec16 import _without
    pages = _periods(html)
    seen = {when: _seen(page) for when, page in pages.items()}
    no_until, no_from = _seen(_without(html, "data-until-basics")), _seen(_without(html, "data-from-basics"))
    for words in _PAID_BASICS:
        assert words in seen["before"] and words not in no_until, words
    for words in _FREE_BASICS:
        assert words in seen["december"] and words in seen["after"] and words not in no_from, words
    # Bright Pro is still sold from December 1 to 15 and named so; from December 16 a Pro key does it
    # (tests/test_pricing_dec16.py: no Bright Pro on the page then).
    assert "Fixture shapes, WLED and Showcase — that is Bright Pro" in seen["december"]
    assert 'name="item_number" value="padspan-bright-annual"' in pages["december"]
    assert "Fixture shapes, WLED and Showcase — that takes a Pro key" in seen["after"]
    assert "A PadSpan Pro key works there too, for fixture shapes and the other lighting features." in seen["after"]
    # The lights' price line: placement free, the rest at Pro's and Bright Pro's price, then at Pro's new one.
    assert "Placing each light is free. Shapes, WLED and Automorph come with PadSpan Pro at $45 a year" in seen["december"]
    assert "Placing each light is free. Shapes, WLED and Automorph come with a PadSpan Pro key, $49 a year" in seen["after"]
    # The two new add-ons: not on the page before December 1, sold from it.
    for name in ("maps", "vacuum"):
        assert f'name="item_number" value="padspan-addon-{name}"' not in pages["before"], name
        for when in ("december", "after"):
            assert f'name="item_number" value="padspan-addon-{name}"' in pages[when], (name, when)


def test_the_cross_discount_is_said_in_both_boxes_and_the_box_charges_the_public_price(html: str) -> None:
    """editions.js ADDON_CROSS: who holds one of maps and vacuum pays ADDON_CROSS_PERCENT off the other, rounded down
    to the cent ($8.65 -> $6.05, $6.45 -> $4.51), the better of that and a sale, never both. The site can't know who
    holds what, so each box says the rule and where to buy at that price (the licence card), and its own form charges
    the public price (half in the sale) only."""
    ed = _ED.read_text(encoding="utf-8")
    cross = dict(re.findall(r'(\w+): "(\w+)"', re.search(r"ADDON_CROSS = Object\.freeze\(\{([^}]*)\}\)", ed).group(1)))
    assert cross == {"maps": "vacuum", "vacuum": "maps"}
    pct = int(re.search(r"export const ADDON_CROSS_PERCENT = (\d+);", ed).group(1))
    assert pct == 30
    table = {name: (words, price) for name, words, price, _, _ in _ADDON_ROW.findall(ed)}
    box, got = _addon_box(html), {}
    for name, other in cross.items():
        words, price = table[name]
        got[name] = f"{round(float(price) * 100) * (100 - pct) // 100 / 100:.2f}"
        row = re.search(r'<div[^>]*data-addon="' + name + r'".*?</form>', box, re.S).group(0)
        assert (f"{pct}% off (${got[name]} CAD) if you already own {table[other][0]}: buy it from PadSpan's licence card "
                "(Settings → Features → PadSpan licence), with the email your key was sent to. "
                "The better of this and any sale applies, never both.") in row, name
        form = row[row.index("<form"):]
        assert re.findall(r'value="(\d+\.\d\d)"', form) == [price], name
        assert f'data-half-amount="{int(round(float(price) * 100) // 2) / 100:.2f}"' in form, name
    assert got == {"maps": "6.05", "vacuum": "4.51"}


def test_the_lifetime_price_matches_the_panel_and_switches_on_the_same_date(html: str) -> None:
    import re
    from pathlib import Path
    ed = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
          / "padspan-ha" / "views" / "editions.js").read_text(encoding="utf-8")
    until = re.search(r'PRO_LIFETIME_LAUNCH_UNTIL = "([^"]+)"', ed).group(1)
    launch = re.search(r'PRO_LIFETIME_LAUNCH_PRICE = "\$(\d+) CAD"', ed).group(1)
    full = re.search(r'PRO_LIFETIME_FULL_PRICE = "\$(\d+) CAD"', ed).group(1)
    assert f'data-launch-until="{until}"' in html, "the site switches the price at a different moment than the panel"
    assert float(launch) == _SKUS["padspan-pro-lifetime"][0] == 89.0
    assert full == "168" and 'value="168.00"' in html and "$168" in html, "the page's switch to $168"


def test_every_sku_routes_to_the_tier_it_claims(html: str) -> None:
    import re

    forms = re.findall(r"<form[^>]*paypal\.com/cgi-bin/webscr.*?</form>", html, re.S)
    assert len(forms) == len(_SKUS), f"expected {len(_SKUS)} PayPal forms, found {len(forms)}"

    seen = {}
    for f in forms:
        item = re.search(r'name="item_number" value="([^"]+)"', f)
        amount = re.search(r'name="amount" value="([^"]+)"', f)
        notify = re.search(r'name="notify_url" value="([^"]+)"', f)
        assert item and amount and notify, "a PayPal form is missing item_number/amount/notify_url"
        seen[item.group(1)] = float(amount.group(1))
        assert notify.group(1) == "https://traks.ca/license/?action=ipn", (
            f"{item.group(1)} does not notify the licence server — the money arrives and no key is issued")

    assert set(seen) == set(_SKUS), f"SKUs on the page {sorted(seen)} != expected {sorted(_SKUS)}"

    for sku, (price, must_have, must_not) in _SKUS.items():
        assert seen[sku] == price, f"{sku} charges {seen[sku]}, the server expects at least {price}"
        for marker in must_have:
            assert marker in sku, f"{sku} lacks the {marker!r} marker the server matches on"
        for marker in must_not:
            assert marker not in sku, (
                f"{sku} contains {marker!r}, which the server checks FIRST — it would be "
                "routed to the wrong tier")


def test_retired_features_do_not_come_back(html: str) -> None:
    """These three were advertised for months and never existed: settings keys
    read by nothing outside the settings screen itself. tests/test_telemetry.py
    keeps them out of the usage report; this keeps them off the storefront."""
    for claim in ("trackability rating", "compass ring", "replay timeline"):
        assert claim not in html.lower(), (
            f"the page advertises {claim!r}, which has no implementation. "
            "If it has since been built, delete this assertion in the same commit.")


def test_the_release_history_covers_the_newest_release(html: str) -> None:
    """The page carries a "What's new" history. A release that ships without an
    entry there leaves the storefront describing older software than the one
    people are being offered — the same drift that left v0.21.4 on the page for
    weeks, just in a section a version stamp cannot fix.

    CHANGELOG.md is the source: its top entry is the newest release, and
    release.py stages both files, so they move together or this fails.
    """
    import re

    changelog = (_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(r"^## (\d+\.\d+)\.\d+", changelog, re.M)
    assert m, "could not read the newest version from CHANGELOG.md"
    newest_minor = m.group(1)          # e.g. "0.38"

    listed = re.findall(r'class="relver"[^>]*>v?(\d+\.\d+)', html)
    assert newest_minor in listed, (
        f"CHANGELOG's newest release is {newest_minor}.x but the site's release history "
        f"only lists {sorted(set(listed), reverse=True)}. Add an entry to the What's new "
        "section, or the page describes older software than people are offered.")


def _bracket_extract(src: str, needle: str) -> str:
    """The full text of the array literal `needle` opens (e.g. "const X = ["),
    from its `[` to the matching `]` — string-aware, so a `[`/`]` inside a
    prose field (a title, a help sentence) never miscounts the depth."""
    start = src.index(needle)
    i = src.index("[", start)
    depth = 0
    in_str = None
    esc = False
    for j in range(i, len(src)):
        c = src[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == in_str:
                in_str = None
            continue
        if c in ('"', "'", "`"):
            in_str = c
            continue
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    raise AssertionError(f"unbalanced brackets reading {needle!r}")


def _real_menu_count() -> int:
    """panel.js's own MENU array — the actual sidebar tab list — not a
    number carried by hand in prose. Week-review finding, 2026-09-19: the
    README/site count was bumped by +1 per new tab (24 -> 25 -> 26) without
    ever being checked against MENU, which only ever had 22 entries — the
    increments were applied to a baseline that was already wrong."""
    panel = (_ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    block = _bracket_extract(panel, "const MENU = [")
    import re
    # Setup (2026-11-13, owner's D4) is listed only until the house is set up, and was a view before it was listed:
    # it is not one more dedicated view. Energy (2026-11-26) is an add-on's view, listed only while a house has it on and
    # not yet sold: not one more for everyone either.
    return len([i for i in re.findall(r'^\s*\["([a-z0-9_]+)",', block, re.M) if i not in ("setup", "energy")])


def _real_walkthrough_count() -> int:
    """training.js's own WALKTHROUGHS array."""
    training = (_ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "training.js").read_text(encoding="utf-8")
    block = _bracket_extract(training, "const WALKTHROUGHS = [")
    import re
    return len(re.findall(r'^\s{4}id:\s*"', block, re.M))


def test_the_view_count_agrees_with_the_readme_and_with_panels_real_menu(html: str) -> None:
    """The site, the README and the repo description all quote a number of
    "dedicated views". They said 22 while panel.js listed 24, and nobody could
    say where 22 came from — then drifted again (24 -> 25 -> 26, one +1 per
    new tab, never checked against MENU) while MENU stayed at 22 the whole
    time. Every occurrence — the hero line, the bullet, the og:description's
    bare "N views" phrasing, and the comparison table's number cell — must
    now agree with MENU itself, not just with each other."""
    import re

    real = _real_menu_count()
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    readme_nums = {int(n) for n in re.findall(r"\*\*(\d+) dedicated views\*\*", readme)}
    readme_nums |= {int(n) for n in re.findall(r"\|\s*Dedicated UI views\s*\|\s*(\d+)\s*\|", readme)}
    assert readme_nums, "the README no longer states a view count"
    assert readme_nums == {real}, f"README states {sorted(readme_nums)} dedicated views; panel.js's MENU has {real}"

    site_nums = {int(n) for n in re.findall(r"(\d+)\s+(?:dedicated\s+)?views\b", html)}
    site_nums |= {int(n) for n in re.findall(r'Dedicated UI views</td><td class="num">(\d+)</td>', html)}
    assert site_nums, "the site no longer states a view count"
    assert site_nums == {real}, f"site/index.html states {sorted(site_nums)} views; panel.js's MENU has {real}"


def test_the_walkthrough_count_agrees_across_readme_and_site_and_trainings_real_array(html: str) -> None:
    """Same failure shape as the view count, found in the same review:
    commit 06787ce4 fixed README's marketing bullet and one comparison-table
    reference from 14 to 16, but missed a THIRD README instance and never
    touched site/index.html at all — every one of its 4 occurrences still
    said 14. training.js's WALKTHROUGHS array is the one source of truth."""
    import re

    real = _real_walkthrough_count()
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    readme_nums = {int(n) for n in re.findall(r"(\d+)\s+(?:animated\s+)?walkthroughs\b", readme)}
    assert readme_nums, "the README no longer states a walkthrough count"
    assert readme_nums == {real}, f"README states {sorted(readme_nums)} walkthroughs; training.js's WALKTHROUGHS has {real}"

    site_nums = {int(n) for n in re.findall(r"(\d+)\s+(?:animated\s+)?walkthroughs\b", html)}
    assert site_nums, "the site no longer states a walkthrough count"
    assert site_nums == {real}, f"site/index.html states {sorted(site_nums)} walkthroughs; training.js's WALKTHROUGHS has {real}"


def test_the_paid_and_lighting_products_are_explained(html: str) -> None:
    """The software tells users that light placement 'needs PadSpan Bright Pro or
    PadSpan Pro'. Before 2026-08-23 there was nowhere to find out what that
    meant. The page must keep answering it."""
    for anchor in ('id="pro"', 'id="lights"', 'id="editions"', 'id="whatsnew"'):
        assert anchor in html, f"{anchor} section is missing"
    assert "Bright" in html, "the editions section no longer mentions PadSpan Bright"
    low = html.lower()
    assert "light placement" in low, "the page no longer says what unlocks light placement"


def test_the_paypal_buttons_are_styled_like_the_links_beside_them(html: str) -> None:
    """Design pass 2026-09-28: `.btn` was written for links. On a <button>
    (every PayPal form) the browser's own grey fill and font showed through —
    "Upgrade to PadSpan Pro — $12" in #pro was light text on light grey, and
    "Buy PadSpan Bright Pro" a plain grey system button among styled links."""
    css = html[:html.index("</style>")]
    assert re.search(r"\.btn\{[^}]*font-family:inherit", css), "a <button class=btn> keeps the browser font"
    assert re.search(r"\.btn\.ghost\{[^}]*background:transparent", css), "a <button class='btn ghost'> is filled grey"
    for b in re.findall(r"<button\b[^>]*>", html):
        if "btn" not in b:
            continue
        cls = re.search(r'class="([^"]*)"', b).group(1).split()
        assert "primary" in cls or "ghost" in cls, f"a .btn button with no look of its own: {b}"
        if "ghost" in cls:
            assert "border:0" not in b, f"a ghost button with its border taken off: {b}"


def test_the_pro_list_has_one_marker_per_line(html: str) -> None:
    """The numbered circles (.steps) and a disc bullet on every line of
    "What Pro unlocks today"."""
    pro = html[html.index('id="pro"'):]
    pro = pro[:pro.index("</section>")]
    assert not re.search(r'class="steps"[^>]*list-style', pro)


def test_hero_images_reserve_their_height(html: str) -> None:
    """A lazy hero image with no size grew ~800 px while the smooth jump to
    #pro passed it, so every Buy link from the app landed a screen below its
    target. Width and height reserve the box before the image loads."""
    for img in re.findall(r'<img class="heroimg"[^>]*>', html):
        assert re.search(r'width="\d+" height="\d+"', img), img
    assert re.search(r"\.heroimg\{[^}]*height:auto", html)


def test_nothing_makes_the_page_wider_than_a_phone(html: str) -> None:
    """Design pass leftover, 2026-09-28: on a 390px phone the page was 438px
    wide — `script.garage_door_truck` in the release notes could not break —
    so it scrolled sideways, and a jump to #pro landed 104px off. A code name
    breaks anywhere; every table scrolls inside its own box."""
    css = html[:html.index("</style>")]
    assert re.search(r"(?:^|\n)code\{[^}]*overflow-wrap:anywhere", css), "a long code name widens the page"
    assert re.search(r"\.tablewrap\{[^}]*overflow-x:auto", css)
    body = html[html.index("<body"):]
    assert body.count("<table") == body.count('<div class="tablewrap">\n  <table>'), \
        "a table outside a .tablewrap box widens the page on a phone"


def test_anchors_land_below_the_sticky_nav(html: str) -> None:
    """Every Buy link in the app lands on #pro. The nav is sticky — one row,
    two on a phone — and sat over the section's first lines."""
    css = html[:html.index("</style>")]
    assert re.search(r"(?:^|\n)section\[id\]\{scroll-margin-top:\d+px\}", css), "desktop"
    phone = re.search(r"@media\(max-width:640px\)\{[^\n]*section\[id\]\{scroll-margin-top:(\d+)px\}", css)
    assert phone and int(phone.group(1)) >= 80, "a phone's two-row nav covers the section heading"


def test_the_black_friday_half_price_is_the_panels_before_during_and_after(html: str) -> None:
    """Every add-on on sale is HALF price, rounded down to the cent, from ADDON_HALF_FROM until ADDON_HALF_UNTIL
    (editions.js; the owner, 2026-11-25). The site's #addons box switches its shown price and each PayPal form's amount
    at the same two moments by itself (the visitor's clock; the licence server checks the payment's date), and says
    "Half off until January 1" while it runs. The panel's addonPrice is run before, during and after the sale and the
    page's normal and half amounts must be its answers. An add-on that goes on sale during it (on_sale_from, December 1)
    is half off from that moment, which is when its box shows (the free-basics switch)."""
    import json
    import shutil
    import subprocess
    from pathlib import Path
    views = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
    ed = (views / "editions.js").read_text(encoding="utf-8")
    start = re.search(r'ADDON_HALF_FROM = "([^"]+)"', ed).group(1)
    until = re.search(r'ADDON_HALF_UNTIL = "([^"]+)"', ed).group(1)
    assert (start, until) == ("2026-11-27T08:00:00Z", "2027-01-02T08:00:00Z")
    box = html[html.index('<div class="ed" id="addons"'):]
    box = box[:box.index('<div class="ed">')]
    assert f'data-half-from="{start}" data-half-until="{until}"' in box, "the site switches at other moments than the panel"
    assert "Black Friday: every add-on is half off through January 1." in box
    assert 'input[data-half-amount]' in box and 'e.value=e.getAttribute("data-half-amount")' in box
    assert 'n<Date.parse(b.getAttribute("data-half-from"))||n>=Date.parse(b.getAttribute("data-half-until"))' in box
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed")
    run = ("const E = await import(" + json.dumps((views / "editions.js").as_uri()) + ");"
           "const at = {before: Date.parse('2026-11-27T07:59:59Z'), first: Date.parse('2026-11-27T08:00:00Z'),"
           " unsold: Date.parse(E.FREE_BASICS_FROM) - 1000, sold: Date.parse(E.FREE_BASICS_FROM),"
           " last: Date.parse('2027-01-02T07:59:59Z'), after: Date.parse('2027-01-02T08:00:00Z')};"
           "const out = {}; for (const [k, t] of Object.entries(at)) out[k] = Object.fromEntries(E.ADDONS.map(a => [a.name, E.addonPrice(a.name, t)]));"
           "out.from = Object.fromEntries(E.ADDONS.map(a => [a.name, a.on_sale_from || ''])); out.basics = E.FREE_BASICS_FROM;"
           "console.log(JSON.stringify(out));")
    r = subprocess.run([node, "--input-type=module", "-e", run], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr
    got = json.loads(r.stdout.strip().splitlines()[-1])
    assert start < got["basics"] < until, "maps and vacuum go on sale during the sale"
    assert got["before"] == got["after"] and got["sold"] == got["last"]
    for name, price in got["before"].items():
        row = re.search(r'<div[^>]*data-addon="' + name + r'".*?</form>', box, re.S)
        if name == "c4local":
            # A specialty, in its own box (#specialty), never half off.
            assert row is None and got["first"][name] == got["last"][name] == price, "no box among the add-ons, and never half off"
            continue
        if name == "forensics":
            # Part of Presence insights since 2026-11-26 (editions.js part_of): no box, never sold on its own.
            assert row is None, "Forensics has no box of its own"
            continue
        if name == "energy":
            # Energy (2026-11-26): not on sale until the owner publishes it (editions.js on_sale: false): no box, and
            # never half off while it isn't sold.
            assert row is None and got["first"][name] == got["last"][name] == price, "Energy has no box yet"
            continue
        row = row.group(0)
        # Half off from the sale's start; one not sold yet is never half off until it is (its box shows then).
        assert got["from"][name] in ("", got["basics"]), name
        assert got["first"][name] == got["unsold"][name] == (got["last"][name] if not got["from"][name] else price), name
        normal, sale = price[1:-4], got["last"][name][1:-4]
        assert float(sale) == int(round(float(normal) * 100) // 2) / 100, (name, normal, sale)
        assert f'name="amount" value="{normal}" data-half-amount="{sale}"' in row, name
        assert f'data-addon-price="normal" style="color:var(--mut);font-weight:600">${normal} CAD</span>' in row, name
        assert f'data-addon-price="half" style="display:none;color:var(--acc2);font-weight:800">${sale} CAD</span>' in row, name
        assert f"Half off through January 1 (normally ${normal})" in row, name


def test_the_add_ons_version_note_holds_on_stable_day_and_after(html: str) -> None:
    """The #addons box says what add-ons need in words true on the stable's day and after it: no beta channel, no
    version to go stale, never "Show beta versions" (scripts/deploy_site.py stops a deploy on it); the German page
    says the same (site/i18n/de.json)."""
    box = _addon_box(html)
    assert "Add-ons need the latest PadSpan." in box
    assert not re.search(r"\bbeta\b|Show beta versions|0\.38\.\d+", box, re.I), "a beta or a version in the add-ons box"
    units = json.loads((_ROOT / "site" / "i18n" / "de.json").read_text(encoding="utf-8"))["units"]
    de = [u["de"] for u in units if u.get("en") == "Add-ons need the latest PadSpan."]
    assert de == ["Add-ons brauchen das neueste PadSpan."], de
    assert not any("0.38.300 oder neuer" in str(u.get("de")) for u in units)


def test_the_specialty_is_sold_as_the_panel_says_and_shown_only_while_on_sale(html: str) -> None:
    """OS 2 Local for Control4 (editions.js ADDONS c4local, the owner, 2026-11-25): its own Specialty box in #editions,
    apart from the add-ons; $26 CAD once, for life, PadSpan Pro includes it, never in the Black Friday sale; who it is
    for, said as facts; the trademark line; a PayPal form like the add-ons'. The whole box is hidden exactly while
    editions.js says it is not on sale (on_sale: false), and its on_sale_from date is the box's, so the page shows it at
    the same moment as the panel offers it."""
    from pathlib import Path
    ed = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
          / "padspan-ha" / "views" / "editions.js").read_text(encoding="utf-8")
    m = re.search(r'\{ name: "c4local", words: "OS 2 Local for Control4", price: "\$(\d+) CAD", on_sale: (true|false), '
                  r'on_sale_from: "([^"]*)", category: "specialty",\s+lifetime: true, url: "https://padspan\.traks\.ca/#c4local"', ed)
    assert m, "editions.js's c4local entry"
    price, on_sale, sale_from = m.group(1), m.group(2) == "true", m.group(3)
    assert price == "26" and _SKUS["padspan-addon-c4local"][0] == 26.0
    start = html.index('<div class="ed" id="specialty"')
    box = html[start:html.index('<div class="ed">', start)]
    ed_start = html.index('id="editions"')
    assert ed_start < html.index('id="addons"') < start < html.index("</section>", ed_start), "in #editions, after the add-ons"
    assert max(m.start() for m in re.finditer(r'data-addon="', html)) < start, "apart from the add-ons' own boxes"
    head = box[:box.index(">")]
    assert f'data-on-sale-from="{sale_from}"' in head
    assert ("display:none" in head) == (not on_sale), "hidden exactly while it is not on sale"
    assert "<h3>Specialty</h3>" in box and ' id="c4local"' in box
    assert f'OS 2 Local for Control4 <span style="color:var(--mut);font-weight:600">${price} CAD</span>' in box
    assert "Once, good for life. PadSpan Pro includes it." in box
    assert "Cloud services for Control4 OS 2 ended on November 1, 2026" in box
    assert "Home Assistant's built-in Control4 integration logs in through that cloud" in box
    assert "Control4 is a trademark of its owner; not affiliated with Control4, Snap One or Resideo." in box
    form = re.search(r"<form[^>]*paypal\.com/cgi-bin/webscr.*?</form>", box, re.S).group(0)
    for field, value in (("cmd", "_xclick"), ("item_number", "padspan-addon-c4local"), ("amount", f"{price}.00"),
                         ("currency_code", "CAD"), ("notify_url", "https://traks.ca/license/?action=ipn")):
        assert f'name="{field}" value="{value}"' in form, field
    # Never halved: no sale amount, and the sale's script only touches the #addons box.
    assert "data-half" not in box and "data-addon-price" not in box
    assert 'var b=document.getElementById("addons")' in html
    # The date, when there is one, shows it by itself (the visitor's clock, as the sale does).
    assert 'var f=b.getAttribute("data-on-sale-from");' in box and 'if(f&&Date.now()>=Date.parse(f))b.style.display="";' in box


_SALES_PAGES = [_ROOT / "site" / f / lang / "index.html" for f in ("add-ons", "pro") for lang in ("", "de")]


def test_each_add_on_has_one_buy_place_and_the_pages_about_them_link_to_it(html: str) -> None:
    """The home page sells each add-on in exactly one PayPal form (#addons, the specialty in #specialty); no other page
    on the site carries one, so a price lives in one place (pinned above, before, during and after the sale and before
    and after December 1). /add-ons/ and /pro/, in English and German, describe the add-ons and send every "Price and
    buy" to an anchor that is on the home page (the German page is built from it, ids and all)."""
    names = [row[0] for row in _ADDON_ROW.findall(_ED.read_text(encoding="utf-8"))] + ["c4local"]
    assert len(names) == len(set(names)) == 12, names
    for name in names:
        assert len(re.findall(rf'name="item_number" value="padspan-addon-{name}"', html)) == 1, name
    ids = set(re.findall(r'\sid="([^"]+)"', html))
    for page in sorted((_ROOT / "site").rglob("*.html")):
        if page == _SITE or "demo" in page.relative_to(_ROOT / "site").parts:
            continue
        assert "padspan-addon-" not in page.read_text(encoding="utf-8"), page
    for page in _SALES_PAGES:
        text = page.read_text(encoding="utf-8")
        for anchor in re.findall(r'href="(?:https://padspan\.traks\.ca)?/(?:de/)?#([\w-]+)"', text):
            assert anchor in ids, (page.relative_to(_ROOT), anchor)
    # The add-ons' own anchors: Audio and Full house activity (the timetravel add-on, the owner's name for it),
    # and the two that go on sale on December 1.
    for anchor, name in [(("activity" if n == "timetravel" else n), n) for n in names if n != "c4local"]:
        assert re.search(rf'<div id="{anchor}" data-addon="{name}"', html), anchor


def test_every_link_padspan_makes_to_the_site_lands_on_an_anchor(html: str) -> None:
    """The panel's and the backend's links to padspan.traks.ca/#x (editions.js ADDONS_URL, BUY_URL and the specialty's
    url, the refusals in the backend, the release's notes) and the docs' links to /add-ons/#x each land on an id that
    is there: a dead anchor drops the reader at the top of a long page."""
    ids = set(re.findall(r'\sid="([^"]+)"', html))
    found: dict[str, set[str]] = {}
    sources = [*(_ROOT / "custom_components" / "padspan_ha").rglob("*.js"),
               *(_ROOT / "custom_components" / "padspan_ha").rglob("*.py"), _ROOT / "scripts" / "release.py"]
    for src in sources:
        for anchor in re.findall(r'padspan\.traks\.ca/?(?:\?[^#"\'`\s]*)?#([\w-]+)', src.read_text(encoding="utf-8")):
            found.setdefault(anchor, set()).add(src.name)
    assert {"addons", "c4local", "pro"} <= set(found), found
    for anchor, where in found.items():
        assert anchor in ids, (anchor, sorted(where))
    addon_ids = set(re.findall(r'\sid="([^"]+)"', (_ROOT / "site" / "add-ons" / "index.html").read_text(encoding="utf-8")))
    addon_ids_de = set(re.findall(r'\sid="([^"]+)"',
                                  (_ROOT / "site" / "add-ons" / "de" / "index.html").read_text(encoding="utf-8")))
    assert addon_ids == addon_ids_de, addon_ids ^ addon_ids_de
    for doc in [_ROOT / "README.md", *(_ROOT / "docs").rglob("*.md")]:
        for anchor in re.findall(r'padspan\.traks\.ca/add-ons/(?:de/)?#([\w-]+)', doc.read_text(encoding="utf-8")):
            assert anchor in addon_ids, (doc.relative_to(_ROOT), anchor)
