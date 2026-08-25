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


def test_the_paid_and_lighting_products_are_explained(html: str) -> None:
    """The software tells users that light placement 'needs PadSpan Bright Pro or
    PadSpan Pro'. Before 2026-08-23 there was nowhere to find out what that
    meant. The page must keep answering it."""
    for anchor in ('id="pro"', 'id="lights"', 'id="editions"', 'id="whatsnew"'):
        assert anchor in html, f"{anchor} section is missing"
    assert "Bright" in html, "the editions section no longer mentions PadSpan Bright"
    low = html.lower()
    assert "light placement" in low, "the page no longer says what unlocks light placement"
