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
    # The launch offer (until Oct 31, 2026). The server decides a SKU with
    # BOTH 'padspan' and 'lifetime' before every other tier.
    "padspan-pro-lifetime":         (89.00, ("padspan", "lifetime"),   ("upgrade", "bright")),
}


def test_the_lifetime_offer_matches_the_panel_and_ends_on_the_same_date(html: str) -> None:
    import re
    from pathlib import Path
    ed = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www"
          / "padspan-ha" / "views" / "editions.js").read_text(encoding="utf-8")
    until = re.search(r'PRO_LIFETIME_UNTIL = "([^"]+)"', ed).group(1)
    price = re.search(r'PRO_LIFETIME_PRICE = "\$(\d+) CAD"', ed).group(1)
    assert f'data-offer-until="{until}"' in html, "the site hides the offer at a different moment than the panel"
    assert float(price) == _SKUS["padspan-pro-lifetime"][0]


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
    return len(re.findall(r'^\s*\["[a-z0-9_]+",', block, re.M))


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
