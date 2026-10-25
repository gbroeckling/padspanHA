"""The guides under site/guides/ are pages people land on from a search.

scripts/deploy_site.py uploads each one into its own folder. A guide it doesn't
know about, that the sitemap doesn't list, or whose canonical link names another
address is a page nobody finds, or one a search engine files under the wrong
URL. Prices stay on the main page: they change (the launch price ends on
November 30), and a guide that quoted one would go stale without anyone noticing.
"""
from __future__ import annotations

import pathlib
import re

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SITE = _ROOT / "site"
_GUIDES = sorted((_SITE / "guides").glob("*/index.html"))

pytestmark = pytest.mark.skipif(not _GUIDES, reason="no guides in this tree")


def _deploy_site():
    from importlib.util import module_from_spec, spec_from_file_location

    spec = spec_from_file_location("deploy_site", _ROOT / "scripts" / "deploy_site.py")
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _url(page: pathlib.Path) -> str:
    return f"https://padspan.traks.ca/guides/{page.parent.name}/"


def test_every_guide_is_deployed() -> None:
    assert set(_deploy_site().GUIDES) == {p.relative_to(_SITE).as_posix() for p in _GUIDES}


def test_every_guide_is_in_the_sitemap() -> None:
    sitemap = (_SITE / "sitemap.xml").read_text(encoding="utf-8")
    for page in _GUIDES:
        assert f"<loc>{_url(page)}</loc>" in sitemap, page


def test_every_guide_names_its_own_address() -> None:
    for page in _GUIDES:
        html = page.read_text(encoding="utf-8")
        assert f'<link rel="canonical" href="{_url(page)}">' in html, page
        assert f'<meta property="og:url" content="{_url(page)}">' in html, page
        assert re.search(r"<title>[^<]{20,}</title>", html), page
        assert re.search(r'<meta name="description" content="[^"]{50,}">', html), page


def test_no_guide_quotes_a_price() -> None:
    for page in _GUIDES:
        assert not re.search(r"\$\s?\d|\d\s?(CAD|USD|EUR|€)", page.read_text(encoding="utf-8")), page


def test_links_into_the_site_are_absolute() -> None:
    """A guide sits two folders down: a relative "images/icon.png" would ask for
    /guides/<name>/images/icon.png and get a 404."""
    for page in _GUIDES:
        for url in re.findall(r'(?:href|src)="([^"]*)"', page.read_text(encoding="utf-8")):
            assert re.match(r"(/|#|https?:|mailto:)", url), (page, url)
