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
import sys
from types import SimpleNamespace

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SITE = _ROOT / "site"
_GUIDES = sorted((_SITE / "guides").rglob("index.html"))

pytestmark = pytest.mark.skipif(not _GUIDES, reason="no guides in this tree")


def _deploy_site():
    from importlib.util import module_from_spec, spec_from_file_location

    spec = spec_from_file_location("deploy_site", _ROOT / "scripts" / "deploy_site.py")
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _url(page: pathlib.Path) -> str:
    return f"https://padspan.traks.ca/{page.parent.relative_to(_SITE).as_posix()}/"


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


def test_guides_only_leaves_the_home_page_alone(monkeypatch) -> None:
    """The home page carries the betas' release notes and goes live only with a
    stable release; --guides-only must not bring it, the German page or the
    redirects along."""
    mod = _deploy_site()
    calls: list[str] = []

    def fake_run(cmd, shell=True, input=None, capture_output=False, check=False, text=False):
        calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="" if text else b"", stderr="" if text else b"")

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    monkeypatch.setattr(mod, "verify_guides", lambda: True)
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--guides-only"])
    sys.path.insert(0, str(_ROOT / "scripts"))
    import indexnow

    sent: list[list[str]] = []
    monkeypatch.setattr(indexnow, "submit", lambda urls: (sent.append(urls), (202, "Accepted"))[1])
    mod.main()
    targets = [re.search(r"tee (\S+)", c).group(1) for c in calls if "tee " in c]
    beside = {f"{mod.REMOTE_DIR}/{n}" for n in ("sitemap.xml",) + mod.INDEXNOW_KEYS}
    assert beside <= set(targets)
    assert {f"{mod.REMOTE_DIR}/{g}" for g in mod.GUIDES} <= set(targets)
    assert all(t.startswith(f"{mod.REMOTE_DIR}/guides/") or t in beside for t in targets), targets
    # One submission with every guide; the order is the deploy's own (sorted as text).
    assert len(sent) == 1 and sorted(sent[0]) == sorted(_url(p) for p in _GUIDES)


def test_the_indexnow_key_file_holds_its_own_name() -> None:
    """IndexNow fetches /<key>.txt and compares what it reads with the key."""
    keys = list(_deploy_site().INDEXNOW_KEYS)
    assert len(keys) == 1
    assert (_SITE / keys[0]).read_text(encoding="utf-8").strip() == keys[0][:-4]


def test_a_guide_and_its_translation_point_at_each_other() -> None:
    """hreflang: a search engine shows German searchers the German page only if
    both pages name both addresses."""
    for de in [p for p in _GUIDES if p.parent.name == "de"]:
        en = de.parent.parent / "index.html"
        assert en.exists(), de
        pair = (f'<link rel="alternate" hreflang="en" href="{_url(en)}">',
                f'<link rel="alternate" hreflang="de" href="{_url(de)}">')
        for page in (en, de):
            html = page.read_text(encoding="utf-8")
            assert all(link in html for link in pair), page
        assert '<html lang="de">' in de.read_text(encoding="utf-8")
