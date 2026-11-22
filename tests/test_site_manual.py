# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The manual on padspan.traks.ca is the manual in the repo.

scripts/build_site_manual.py makes site/manual/ (and the manual's lines in
site/sitemap.xml) from docs/manual/*.md and its German in docs/manual/de/. When
the first test here fails, a chapter changed and its page didn't: run

    python scripts/build_site_manual.py

and commit what it wrote. The rest pin the small Markdown converter it carries
(the repo has no Markdown library) on the forms the manual uses.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "build_site_manual.py"
MANUAL = ROOT / "docs" / "manual"

pytestmark = pytest.mark.skipif(not SCRIPT.is_file() or not MANUAL.is_dir() or not (ROOT / "site").is_dir(),
                                reason="the Bright derivation carries no docs/, scripts/ or site/")


def _load():
    spec = importlib.util.spec_from_file_location("build_site_manual", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


B = _load() if SCRIPT.is_file() else None


def _html(md: str, lang: str = "en", src: Path | None = None) -> str:
    page = B.Page(src or MANUAL / "04-first-room.md", lang)
    return B.render(B.blocks(md.splitlines(), page, " (englisch)"))


def test_the_committed_pages_are_what_the_manual_makes() -> None:
    files = B.build()
    stale = [rel for rel, text in files.items()
             if not (ROOT / "site" / rel).is_file() or (ROOT / "site" / rel).read_text(encoding="utf-8") != text]
    extra = [p.relative_to(ROOT / "site").as_posix() for p in (ROOT / "site" / "manual").rglob("*")
             if p.is_file() and p.relative_to(ROOT / "site").as_posix() not in files]
    assert not stale and not extra, ("site/manual/ is not what docs/manual/ makes. Run "
                                     "`python scripts/build_site_manual.py` and commit the result:\n"
                                     + "\n".join(stale + [f"{e} (made by nothing)" for e in extra]))


def test_every_chapter_has_a_page_and_every_german_one_a_twin() -> None:
    files = B.build()
    assert "manual/index.html" in files
    for ch in B.chapters():
        assert f"manual/{B.slug_of(ch)}/index.html" in files, ch.name
        if (B.DE / ch.name).is_file():
            assert f"manual/{B.slug_of(ch)}/de/index.html" in files, ch.name
    assert B.slug_of(MANUAL / "04-first-room.md") == "first-room"
    assert B.slug_of(MANUAL / "A-glossary.md") == "glossary"


def test_lists_nest_and_continue() -> None:
    h = _html("1. One\n   still one\n2. Two:\n   - a\n   - b\n3. Three")
    assert h == ("<ol>\n<li>One\nstill one</li>\n<li>Two:\n<ul>\n<li>a</li>\n<li>b</li>\n</ul></li>\n"
                 "<li>Three</li>\n</ol>")
    assert _html("3. Three\n4. Four").startswith('<ol start="3">')
    assert _html("- a\n\n- b") == "<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>"


def test_a_paragraph_ends_where_github_ends_it() -> None:
    assert _html("Text\n- item") == "<p>Text</p>\n<ul>\n<li>item</li>\n</ul>"
    assert _html("Released in\n2024. Then more") == "<p>Released in\n2024. Then more</p>"


def test_tables_escape_pipes_and_may_have_no_header() -> None:
    h = _html("| | |\n|---|:---:|\n| **A** | x \\| y |")
    assert "<th>" not in h and '<td style="text-align:center">x | y</td>' in h and "<td><b>A</b></td>" in h


def test_bold_runs_across_lines_and_code_stays_text() -> None:
    assert _html("**Two\nlines** and `<device>`") == "<p><b>Two\nlines</b> and <code>&lt;device&gt;</code></p>"


def test_fenced_code_and_generated_markers() -> None:
    h = _html("<!-- generated:x -->\n```yaml\na: <b>\n  - c\n```\n<!-- /generated:x -->")
    assert h == "<pre><code>a: &lt;b&gt;\n  - c</code></pre>"


def test_headings_get_githubs_anchors_once_each() -> None:
    h = _html("## 1. Install PadSpan\n## Health\n## Health")
    assert 'id="1-install-padspan"' in h and 'id="health"' in h and 'id="health-1"' in h


def test_links_go_to_the_site_github_or_stay_out() -> None:
    h = _html("[ch](09-setup-the-map.md#step-3-draw-the-rooms) [c](README.md) [g](https://padspan.traks.ca/guides/bermuda/) "
              "[r](../../SECURITY.md) [x](https://example.com/a?b=1&c=2)")
    assert '<a href="/manual/setup-the-map/#step-3-draw-the-rooms">ch</a>' in h
    assert '<a href="/manual/">c</a>' in h and '<a href="/guides/bermuda/">g</a>' in h
    assert '<a href="https://github.com/gbroeckling/padspanHA/blob/main/SECURITY.md">r</a>' in h
    assert 'href="https://example.com/a?b=1&amp;c=2"' in h


def test_a_note_that_moved_out_of_the_repo_is_never_linked() -> None:
    with pytest.raises(B.ManualError):
        _html("[log](../BUG_LOG.md)")


def test_a_link_to_a_missing_chapter_stops_the_build() -> None:
    with pytest.raises(B.ManualError):
        _html("[gone](99-no-such-chapter.md)")


def test_german_links_an_english_only_chapter_and_says_so(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(B, "DE", tmp_path)
    (tmp_path / "05-receivers.md").write_text("# 5. Empfänger\n", encoding="utf-8")
    src = tmp_path / "04-first-room.md"
    h = _html("[k5](05-receivers.md) [k6](06-phones-and-watches.md) [a](https://padspan.traks.ca/guides/bermuda/)",
              "de", src)
    assert '<a href="/manual/receivers/de/">k5</a> ' in h
    assert '<a href="/manual/phones-and-watches/">k6</a> (englisch)' in h
    assert '<a href="/guides/bermuda/de/">a</a>' in h


def test_a_german_chapter_shows_the_codes_english_reference_table(tmp_path, monkeypatch) -> None:
    """A German chapter names a generated block instead of copying it, so the table
    is always the one build_manual_reference.py last made from the code."""
    monkeypatch.setattr(B, "DE", tmp_path)
    de = tmp_path / "12-the-screens.md"
    de.write_text("# 12. Die Bildschirme\n\nDie Menükarte:\n\n<!-- english:menu -->\n", encoding="utf-8")
    lines = B._source_lines(de)
    assert any(line.startswith("| **Overview** |") for line in lines)
    assert not any("generated:menu" in line for line in lines)
    de.write_text("# 12\n\n<!-- english:no-such-block -->\n", encoding="utf-8")
    with pytest.raises(B.ManualError):
        B._source_lines(de)


def test_a_broken_anchor_stops_the_build(monkeypatch) -> None:
    real = B._make

    def broken(src, lang, order):
        page, text = real(src, lang, order)
        page.links.append("/manual/first-room/#no-such-heading")
        return page, text

    monkeypatch.setattr(B, "_make", broken)
    with pytest.raises(B.ManualError, match="no-such-heading"):
        B.build()
