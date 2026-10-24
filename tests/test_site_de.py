"""The German page, padspan.traks.ca/de/, must say what the English one says.

scripts/build_site_de.py builds it from site/index.html at deploy time, swapping
each text block for its German in site/i18n/de.json. Nothing about it is kept by
hand, so these tests build it the way scripts/deploy_site.py does and pin what a
German visitor depends on: the page is German and says so, the two pages point
at each other, it sells exactly what the English page sells, its links work
from /de/, it doesn't repeat a claim that is untrue for a German reader, and a
deploy never puts the redirect live before the page it redirects to.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from importlib.util import module_from_spec, spec_from_file_location
from types import SimpleNamespace

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SITE = _ROOT / "site" / "index.html"
_CATALOG = _ROOT / "site" / "i18n" / "de.json"
_HTACCESS = _ROOT / "site" / ".htaccess"

pytestmark = pytest.mark.skipif(not (_SITE.exists() and _CATALOG.exists()),
                                reason="site/index.html or its German catalog is not in this tree")


def _load(name: str):
    spec = spec_from_file_location(name, _ROOT / "scripts" / f"{name}.py")
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def b():
    return _load("build_site_de")


@pytest.fixture(scope="module")
def pages(b) -> tuple[str, str, dict]:
    en = _SITE.read_text(encoding="utf-8")
    de, report = b.build(en)
    return en, de, report


def _cat(**extra) -> dict:
    cat = {"drop": [], "units": [], "attrs": {}, "raw": {}, "whatsnew": "<h2>Neu</h2>"}
    cat.update(extra)
    cat["_units"] = {u["en"]: u["de"] for u in cat["units"]}
    return cat


# ------------------------------------------------------------- the real page


def test_the_german_page_is_ready_to_go_live(b, pages) -> None:
    """Everything deploy_site.py checks before it uploads anything: coverage, the
    drop/raw entries still matching, the way back to English, lang and canonical,
    hreflang, identical PayPal forms and scripts, no relative links, the version
    claims and the release history left out."""
    en, de, rep = pages
    assert b.check(en, de, rep) == []


def test_it_is_marked_german_and_points_at_itself(pages) -> None:
    _, de, _ = pages
    assert '<html lang="de"' in de
    assert '<link rel="canonical" href="https://padspan.traks.ca/de/">' in de
    assert '<meta property="og:url" content="https://padspan.traks.ca/de/">' in de


def test_both_pages_name_each_other(b, pages) -> None:
    en, de, _ = pages
    for page in (en, de):
        assert '<link rel="alternate" hreflang="en" href="https://padspan.traks.ca/">' in page
        assert '<link rel="alternate" hreflang="de" href="https://padspan.traks.ca/de/">' in page
    # ?lang= makes site/.htaccess remember the choice for a year.
    assert b.LINK_TO_DE in en and b.LINK_TO_EN not in en
    assert b.LINK_TO_EN in de and b.LINK_TO_DE not in de


def test_it_sells_exactly_what_the_english_page_sells(b, pages) -> None:
    """The same forms, action, method and every field, and the same price-switching
    script: only the button text is German."""
    en, de, _ = pages
    assert len(b._forms(en)) >= 4
    assert b._forms(de) == b._forms(en)
    assert 'id="pl-amount"' in de and 'data-launch-until="2026-12-01T08:00:00Z"' in de
    assert 'getElementById("pl-amount").value="168.00"' in de


def test_no_language_claim_that_is_untrue_in_german(pages) -> None:
    """The panel is English only, so "11 languages" is the wrong promise to a German reader."""
    _, de, _ = pages
    text = re.sub(r"<[^>]+>", " ", de)
    for claim in ("11 Languages", "11 languages", "Multi-language", "11 Sprachen"):
        assert claim not in text


def test_the_release_history_stays_english_and_links_there_without_switching(pages) -> None:
    _, de, _ = pages
    assert 'id="whatsnew"' in de and 'class="relitem"' not in de
    # ?hl=en shows the English page once; ?lang=en would switch the visitor for a year.
    assert 'href="/?hl=en#whatsnew"' in de


# ------------------------------------------------------------- the builder


def test_a_stray_end_tag_does_not_hide_text(b) -> None:
    page = "<html lang=\"en\"><body><p>Hello world</span></p><p>Second line</p></body></html>"
    _, rep = b.build(page, _cat())
    assert rep["units"] == 2


def test_omitted_end_tags_close_the_way_a_browser_closes_them(b) -> None:
    page = ("<html><body><ul><li>One item<li>Two items</ul><p>Para text<div>Block text</div>"
            "<p>Click <button>Go now</button> here</p></body></html>")
    spans, _, loose = b.units(page)
    texts = [b.norm(page[s:e]) for s, e in spans]
    assert "One item" in texts and "Two items" in texts
    assert "Para text" in texts and "Block text" in texts
    assert "Go now" in texts and "Click" in loose      # a <button> doesn't end the <p>


def test_an_unclosed_release_history_stops_the_build(b) -> None:
    """Otherwise the stub would swallow every section after it."""
    page = '<html><body><section id="whatsnew"><p>Notes here</p><section id="pro"><p>Buy it</p></section></body></html>'
    with pytest.raises(ValueError, match="whatsnew"):
        b.build(page, _cat())


def test_the_way_back_to_english_survives_an_untranslated_nav(b) -> None:
    """A new nav link makes the nav a block with no German yet; the English link must still appear."""
    page = (f'<html lang="en"><body><nav><div class="inner"><a href="#x">New thing</a> {b.LINK_TO_DE}'
            "</div></nav></body></html>")
    de, rep = b.build(page, _cat())
    assert b.LINK_TO_EN in de and b.LINK_TO_DE not in de
    assert rep["missing"]


def test_links_become_absolute_in_every_form(b) -> None:
    page = ("<html><body><p><a href='docs/x.md'>Docs here</a> <img src=\"images/a.png\" "
            "srcset=\"images/a.png 1x, images/b.png 2x\" onerror=\"this.src='images/c.png'\"></p></body></html>")
    de, _ = b.build(page, _cat())
    assert "href='/docs/x.md'" in de and 'src="/images/a.png"' in de
    assert 'srcset="/images/a.png 1x, /images/b.png 2x"' in de and "this.src='/images/c.png'" in de


def test_the_version_text_is_not_part_of_a_key(b) -> None:
    assert b.norm("Stable is <span data-latest-version>v0.37.0</span>.") == \
        b.norm("Stable  is <span data-latest-version>v0.38.157</span>.")


def test_every_drop_target_is_still_on_the_page() -> None:
    """A 'drop' entry that no longer matches means the English page now says
    something else there. Read what it says before the German page repeats it."""
    cat = json.loads(_CATALOG.read_text(encoding="utf-8"))
    en = _SITE.read_text(encoding="utf-8")
    assert [d for d in cat["drop"] if d not in en] == []


# ------------------------------------------------------------- .htaccess


def test_htaccess_language_rules_in_the_order_they_need() -> None:
    ht = _HTACCESS.read_text(encoding="utf-8")
    cookie_en = ht.index("CO=padspan_lang:en:")
    cookie_de = ht.index("CO=padspan_lang:de:")
    picked_de = ht.index("RewriteCond %{HTTP_COOKIE} (^|;\\s*)padspan_lang=de(;|$)")
    country = ht.index("RewriteCond %{HTTP:CF-IPCountry} ^(DE|AT|CH|LI)$")
    guessed = ht.index("RewriteRule ^(pricing|plans|buy|purchase)")
    # The choice is recorded before any redirect, and the language comes before the guessed URLs.
    assert cookie_en < picked_de and cookie_de < picked_de < country < guessed
    block = ht[cookie_de:guessed]
    # ?lang= (either value) and ?hl=en are never sent on; the Deutsch link goes straight to /de/.
    assert block.count("RewriteCond %{QUERY_STRING} !(^|&)lang=\n") == 2
    assert block.count("RewriteCond %{QUERY_STRING} !(^|&)hl=en(&|$)") == 2
    assert "RewriteCond %{QUERY_STRING} (^|&)lang=de(&|$)\n  RewriteRule ^(index\\.html)?$" in block
    assert "RewriteCond %{HTTP:Accept-Language} !^(fr|it)\\b [NC]" in block
    assert block.count("RewriteRule ^(index\\.html)?$ https://padspan.traks.ca/de/ [R=302,L]") == 3


# ------------------------------------------------------------- deploy order


@pytest.fixture()
def deploy(monkeypatch, b):
    mod = _load("deploy_site")
    calls: list[str] = []

    def fake_run(cmd, shell=True, input=None, capture_output=False, check=False, text=False):
        calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="" if text else b"", stderr="" if text else b"")

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    monkeypatch.setattr(mod, "preflight_htaccess", lambda: [])
    monkeypatch.setattr(mod, "verify_live", lambda version: True)
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--version", "9.9.9"])
    return mod, calls


def test_the_german_page_goes_up_before_the_redirect_to_it(deploy) -> None:
    mod, calls = deploy
    mod.main()
    tees = [c for c in calls if "tee " in c]
    de = next(i for i, c in enumerate(tees) if f"tee {mod.REMOTE_DE}" in c)
    en = next(i for i, c in enumerate(tees) if f"tee {mod.REMOTE} " in c)
    ht = next(i for i, c in enumerate(tees) if f"tee {mod.REMOTE_DIR}/.htaccess" in c)
    assert de < en < ht


def test_nothing_is_uploaded_when_the_german_page_is_not_ready(deploy, monkeypatch) -> None:
    mod, calls = deploy
    real = mod._build_site_de()
    monkeypatch.setattr(real, "check", lambda *a, **k: ["no way back to English"])
    with pytest.raises(SystemExit, match="nothing was uploaded"):
        mod.main()
    assert not [c for c in calls if "tee " in c]


def _answers(mod):
    """What a correct origin answers for each language case, keyed the way origin() is called."""
    return {(path, country, cookie, lang): want for path, country, cookie, lang, want in mod.LANGUAGE_CASES}


def test_the_htaccess_is_tried_before_anything_is_uploaded(monkeypatch, b) -> None:
    mod = _load("deploy_site")
    calls: list[str] = []
    answers = _answers(mod)

    def fake_run(cmd, shell=True, input=None, capture_output=False, check=False, text=False):
        calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="" if text else b"", stderr="" if text else b"")

    def fake_origin(path, country, cookie="", accept_language=""):
        key = (re.sub(r"^/_deploy_check_[0-9a-f]+", "", path) or "/", country, cookie, accept_language)
        return "404" if key[0] == "/missing.html" else answers[key]

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    monkeypatch.setattr(mod, "origin", fake_origin)
    monkeypatch.setattr(mod, "verify_live", lambda version: True)
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--version", "9.9.9"])
    mod.main()
    scratch = next(i for i, c in enumerate(calls) if "mkdir -p" in c and "_deploy_check_" in c)
    cleanup = next(i for i, c in enumerate(calls) if "rm -rf" in c and "_deploy_check_" in c)
    first_upload = next(i for i, c in enumerate(calls) if f"tee {mod.REMOTE_DE}" in c)
    assert scratch < cleanup < first_upload


def test_a_failed_htaccess_check_cleans_up_and_uploads_nothing(monkeypatch) -> None:
    mod = _load("deploy_site")
    calls: list[str] = []

    def fake_run(cmd, shell=True, input=None, capture_output=False, check=False, text=False):
        calls.append(cmd)
        return SimpleNamespace(returncode=0, stdout="" if text else b"", stderr="" if text else b"")

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    monkeypatch.setattr(mod, "origin", lambda *a, **k: "500")
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--version", "9.9.9"])
    with pytest.raises(SystemExit, match="nothing was uploaded"):
        mod.main()
    assert any("rm -rf" in c and "_deploy_check_" in c for c in calls)
    assert not [c for c in calls if f"tee {mod.REMOTE_DE}" in c or f"tee {mod.REMOTE} " in c]


def test_gaps_are_reported_but_never_hold_a_deploy(b, pages) -> None:
    """English showing through on /de/ is worth fixing, not worth blocking a release for."""
    en, _, _ = pages
    cat = b.load_catalog()
    cat["raw"] = dict(cat["raw"], **{"text that is not on the page": "Text, der nicht auf der Seite steht"})
    de, rep = b.build(en, cat)
    assert b.check(en, de, rep, cat) == []
    assert any("raw" in g for g in b.gaps(rep))


def test_relative_links_are_found_however_they_are_written(b) -> None:
    assert b.relative_links('<a HREF=docs/x>a</a><img src=images/a.png><div style="background:url(images/x.png)">') == \
        ["docs/x", "images/a.png", "images/x.png"]
    assert b.relative_links('<a href="#pro">a</a><svg><use xlink:href="#icon"/></svg><p style="fill:url(#g)">') == []


def test_scripts_are_left_exactly_as_the_english_page_has_them(b) -> None:
    page = ('<html lang="en"><body><p>Some words</p>'
            '<script>var tpl = \'<img src="images/a.png">\';</script></body></html>')
    de, _ = b.build(page, _cat())
    assert '<img src="images/a.png">' in de


def test_a_rule_ends_a_paragraph_however_it_is_written(b) -> None:
    for hr in ("<hr>", "<hr/>", "<hr />"):
        page = f"<html><body><div><p>aa{hr}bb</div></body></html>"
        spans, _, loose = b.units(page)
        assert [b.norm(page[s:e]) for s, e in spans] == ["aa"]
        assert loose == ["bb"]


def test_list_items_labels_and_cells_close_the_way_a_browser_closes_them(b) -> None:
    def texts(page: str) -> list[str]:
        spans, _, _ = b.units(page)
        return sorted(b.norm(page[s:e]) for s, e in spans)

    assert texts("<html><body><ul><li><div>AA<li>BB</ul></body></html>") == ["AA", "BB"]
    assert texts("<html><body><p><label>xx<div>yy</div></label></body></html>") == ["xx", "yy"]
    assert texts("<html><body><table><tr><td><div>aa<td>bb</table></body></html>") == ["aa", "bb"]
    assert texts("<html><body><p>tt <svg><title>ss</title></svg> uu</p></body></html>") == \
        [b.norm("tt <svg><title>ss</title></svg> uu")]


def test_a_stale_drop_entry_stops_the_deploy(b, pages) -> None:
    """A drop entry guards a claim that misleads German readers; if the English page
    rewords it, someone has to read the new wording before /de/ repeats it."""
    en, _, _ = pages
    cat = b.load_catalog()
    cat["drop"] = cat["drop"] + ["<li>a claim that is no longer on the page</li>"]
    de, rep = b.build(en, cat)
    assert any("drop" in p for p in b.check(en, de, rep, cat))


def test_changed_or_new_attribute_text_is_reported(b, pages) -> None:
    en, _, _ = pages
    changed = en.replace('content="PadSpan HA tells you which room', 'content="PadSpan HA now tells you which room', 1)
    _, rep = b.build(changed)
    assert any("search/share" in g for g in b.gaps(rep))
    assert b.untranslated_attrs(en, b.load_catalog()) == []


def test_the_panels_release_notes_link_skips_the_german_page() -> None:
    """The notes are English only. The panel's link and the update notification's
    (release.py's notes_url) carry ?hl=en so a visitor from Germany, Austria or
    Switzerland reaches them instead of the German page's short note about them."""
    url = "https://padspan.traks.ca/?hl=en#whatsnew"
    www = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
    assert f'export const WHATSNEW_URL = "{url}";' in (www / "views" / "editions.js").read_text(encoding="utf-8")
    assert f'|| "{url}";' in (www / "panel.js").read_text(encoding="utf-8")
    assert f'manifest["notes_url"] = "{url}"' in (_ROOT / "scripts" / "release.py").read_text(encoding="utf-8")
    assert "RewriteCond %{QUERY_STRING} !(^|&)hl=en(&|$)" in _HTACCESS.read_text(encoding="utf-8")


def test_the_english_page_makes_no_language_claim_either() -> None:
    """The panel and its setup screens are English only (the translation files are
    English copies), so neither the site nor the README may claim other languages."""
    for path in (_SITE, _ROOT / "README.md"):
        text = path.read_text(encoding="utf-8")
        for claim in ("11 Languages", "11 languages", "Multi-language", "100% Local"):
            assert claim not in text, f"{path.name} says {claim!r}"
