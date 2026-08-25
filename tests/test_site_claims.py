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
    assert n >= 3, f"only {n} version claim(s) are stampable — deploy_site would leave the rest stale"
    assert mod._VER_TAG_CLAIM.findall(stamped) == [version] * n


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
}


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


def test_the_view_count_agrees_with_the_readme(html: str) -> None:
    """The site, the README and the repo description all quote a number of
    "dedicated views". They said 22 while panel.js listed 24, and nobody could
    say where 22 came from. Whatever the number is, these two must not disagree
    — a visitor who counts them should not catch us out."""
    import re

    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    r = re.search(r"\*\*(\d+) dedicated views\*\*", readme)
    assert r, "the README no longer states a view count"
    site = re.findall(r"(\d+) dedicated views", html)
    assert site, "the site no longer states a view count"
    assert set(site) == {r.group(1)}, (
        f"README says {r.group(1)} dedicated views, the site says {sorted(set(site))}")


def test_the_paid_and_lighting_products_are_explained(html: str) -> None:
    """The software tells users that light placement 'needs PadSpan Bright Pro or
    PadSpan Pro'. Before 2026-08-23 there was nowhere to find out what that
    meant. The page must keep answering it."""
    for anchor in ('id="pro"', 'id="lights"', 'id="editions"', 'id="whatsnew"'):
        assert anchor in html, f"{anchor} section is missing"
    assert "Bright" in html, "the editions section no longer mentions PadSpan Bright"
    low = html.lower()
    assert "light placement" in low, "the page no longer says what unlocks light placement"
