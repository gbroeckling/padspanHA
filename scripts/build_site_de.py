#!/usr/bin/env python
"""Build the German page, padspan.traks.ca/de/, from site/index.html.

    python scripts/build_site_de.py                    # coverage and problems
    python scripts/build_site_de.py --out FILE         # write the German page to FILE
    python scripts/build_site_de.py --todo FILE        # English text that has no German yet, as JSON
    python scripts/build_site_de.py --from FILE ...    # start from FILE instead of site/index.html

WHY THIS EXISTS
Germany is Home Assistant's biggest country (19% of its installs) and PadSpan's
second, and the page that sells PadSpan was English only. A hand-made German copy
of a 300 KB page that changes with every release would be out of date within a
week, so the German page is not kept anywhere. It is BUILT from the English page
at deploy time (scripts/deploy_site.py), using the translations in
site/i18n/de.json:

  * The page is cut into its text blocks (a <p>, an <li>, a heading, a table
    cell, a button, a row of links...), each the smallest block element holding
    text. A block's inner HTML, whitespace collapsed, is looked up in the
    catalog and replaced by its German, inline markup and all. A block with no
    German yet stays English, and `python scripts/build_site_de.py` lists them,
    so a new English paragraph shows up as a gap, never as a broken page.
  * The release history (#whatsnew, ~30,000 words) is not translated. The
    German page keeps the section's place and says the notes are in English.
  * Links are made absolute, because the page is served from /de/.
  * <html lang>, the canonical URL and og:url point at /de/, both pages carry
    hreflang links to each other, and the nav's "Deutsch" link becomes "English".

check() is what must hold before the page goes live; deploy_site.py refuses to
upload anything when it finds a problem, and tests/test_site_de.py runs it too.
Which visitors see the page is decided by site/.htaccess.
"""
from __future__ import annotations

import html as htmllib
import json
import pathlib
import re
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "site" / "index.html"
CATALOG = ROOT / "site" / "i18n" / "de.json"
URL_EN = "https://padspan.traks.ca/"
URL_DE = "https://padspan.traks.ca/de/"
# The language links. ?lang= makes site/.htaccess remember the choice for a year.
LINK_TO_DE = '<a href="/de/?lang=de" hreflang="de" lang="de">Deutsch</a>'
LINK_TO_EN = '<a href="/?lang=en" hreflang="en" lang="en">English</a>'
MIN_COVERAGE = 0.9

# Elements that hold a block of text. The smallest one around a piece of text is
# the unit that gets translated, so a sentence is translated whole, with its
# <b> and <a> inside it, rather than word-order-breaking fragment by fragment.
BLOCK = {
    "address", "article", "aside", "blockquote", "button", "caption", "dd", "details",
    "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
    "h3", "h4", "h5", "h6", "header", "label", "legend", "li", "main", "nav", "ol", "p",
    "section", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "title", "tr", "ul",
}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
        "param", "source", "track", "wbr"}
RAW = {"script", "style", "svg"}
# A start tag that ends the open element before it, the way a browser reads HTML
# with optional end tags: <li>a<li>b is two items, and a block ends a <p>.
_IMPLIED_END = {"li": {"li"}, "dt": {"dt", "dd"}, "dd": {"dt", "dd"}, "tr": {"tr", "td", "th"},
                "td": {"td", "th"}, "th": {"td", "th"}, "option": {"option"}}
# Where looking for that open element stops: a new <li> ends the <li> of its own list only.
_SCOPE = {"ul", "ol", "dl", "table", "tbody", "thead", "tfoot", "div", "section", "body", "html",
          "nav", "header", "footer", "main", "article", "aside", "form", "details", "td", "th"}
_LIST_SCOPE = _SCOPE - {"div"}             # a browser looks through a <div> for the open <li>
_TABLE_SCOPE = {"table", "tbody", "thead", "tfoot", "html", "body"}  # ... and for the open cell or row
_CELL_SCOPE = _TABLE_SCOPE | {"tr"}
# The start tags that end an open <p> (as a browser reads it; a <button> or <label> doesn't).
_ENDS_P = {"address", "article", "aside", "blockquote", "details", "div", "dl", "fieldset",
           "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
           "hgroup", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
           "li", "dd", "dt", "summary", "hr"}
SKIP_SECTION = "whatsnew"
TRANSLATED_ATTRS = ("alt", "title", "aria-label", "placeholder")
_LETTERS = re.compile(r"[A-Za-z]{2,}")
_VERSION_TEXT = re.compile(r"(data-latest-version[^>]*>)\s*v?[0-9][^<]*")


def norm(s: str) -> str:
    """The catalog key for a block: whitespace collapsed, and the version text of
    data-latest-version elements left out, since deploy_site.py stamps those."""
    return _VERSION_TEXT.sub(r"\1", re.sub(r"\s+", " ", s)).strip()


class _Units(HTMLParser):
    """Finds the inner-HTML spans of the leaf text blocks, by absolute offset."""

    def __init__(self, src: str) -> None:
        super().__init__(convert_charrefs=True)
        self.src = src
        self._line_starts = [0] + [m.end() for m in re.finditer("\n", src)]
        self.stack: list[dict] = []
        self.units: list[tuple[int, int]] = []
        self.loose: list[str] = []          # text directly in a block that also holds blocks
        self.whatsnew: tuple[int, int] | None = None
        self.whatsnew_opened = False
        self.whatsnew_unclosed = False      # ended by something other than its own </section>
        self.raw_unclosed: list[str] = []   # an <svg> left open hides the text after it
        self._raw = 0

    def _pos(self) -> int:
        line, col = self.getpos()
        return self._line_starts[line - 1] + col

    def _close(self, el: dict, end: int) -> None:
        if el["tag"] in RAW:
            self._raw -= 1
        if el["tag"] == "section" and el["id"] == SKIP_SECTION:
            self.whatsnew = (el["inner"], end)
        if el["tag"] not in BLOCK or not el["text"]:
            return
        if not el["blocks"]:
            self.units.append((el["inner"], end))
        else:
            self.loose.extend(el["runs"])

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            if tag == "hr" and not self._raw:
                self._implied_end(tag, self._pos())
            return
        start = self._pos()
        if not self._raw:
            self._implied_end(tag, start)
        text = self.get_starttag_text() or ""
        el = {"tag": tag, "inner": start + len(text), "blocks": False, "text": False,
              "id": dict(attrs).get("id"), "runs": []}
        if tag in RAW:
            self._raw += 1
        if tag in BLOCK and not self._raw:          # an <svg>'s own <title> is not a text block
            for anc in self.stack:
                anc["blocks"] = True
        if tag == "section" and el["id"] == SKIP_SECTION:
            self.whatsnew_opened = True
        self.stack.append(el)

    def _implied_end(self, tag: str, start: int) -> None:
        """End what this start tag ends, the way a browser does: <li>a <b>b<li> is two items."""
        if tag in _ENDS_P:
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i]["tag"] == "p":
                    self._close_down_to(i, start)
                    break
                if self.stack[i]["tag"] in _SCOPE or self.stack[i]["tag"] == "button":
                    break
        ends = _IMPLIED_END.get(tag)
        if ends:
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i]["tag"] in ends:
                    self._close_down_to(i, start)
                    break
                scope = (_LIST_SCOPE if tag in ("li", "dd", "dt") else _CELL_SCOPE if tag in ("td", "th")
                         else _TABLE_SCOPE if tag == "tr" else _SCOPE)
                if self.stack[i]["tag"] in scope:
                    break

    def _close_down_to(self, i: int, pos: int) -> None:
        while len(self.stack) > i:
            el = self.stack.pop()
            if el["tag"] in RAW:
                self.raw_unclosed.append(el["tag"])
            self._close(el, pos)

    def handle_startendtag(self, tag, attrs):
        if tag in VOID:                      # <hr/> ends a <p> just as <hr> does
            self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID or not any(el["tag"] == tag for el in self.stack):
            return                           # a stray end tag: browsers ignore it, so do we
        end = self._pos()
        while self.stack:
            el = self.stack.pop()
            if el["tag"] != tag and el["tag"] == "section" and el["id"] == SKIP_SECTION:
                self.whatsnew_unclosed = True
            if el["tag"] != tag and el["tag"] in RAW:
                self.raw_unclosed.append(el["tag"])
            self._close(el, end)             # anything still open inside it ends here
            if el["tag"] == tag:
                break

    def handle_data(self, data):
        if self._raw or not _LETTERS.search(data):
            return
        for el in self.stack:
            el["text"] = True
        for el in reversed(self.stack):
            if el["tag"] in BLOCK:
                el["runs"].append(norm(data))
                break


def units(src: str) -> tuple[list[tuple[int, int]], tuple[int, int] | None, list[str]]:
    p = _Units(src)
    p.feed(src)
    p.close()
    # A #whatsnew that isn't ended by its own </section> runs on into the sections
    # after it, and the stub would take them all. Checked before the page end
    # closes whatever is still open.
    if p.whatsnew_unclosed or (p.whatsnew_opened and not p.whatsnew):
        raise ValueError("site/index.html: the #whatsnew section never closes with its own </section>")
    while p.stack:                           # whatever else the page never closed ends with it
        el = p.stack.pop()
        if el["tag"] in RAW:
            p.raw_unclosed.append(el["tag"])
        p._close(el, len(src))
    if p.raw_unclosed:
        raise ValueError(f"site/index.html: an unclosed <{p.raw_unclosed[0]}> hides the text after it")
    spans = p.units
    if p.whatsnew:
        a, b = p.whatsnew
        spans = [(s, e) for s, e in spans if not (a <= s and e <= b)]
    return spans, p.whatsnew, p.loose


def load_catalog(path: pathlib.Path = CATALOG) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["_units"] = {norm(u["en"]): u["de"] for u in data.get("units", [])}
    return data


_ATTR_URL = re.compile(r"""(\s(?:href|src|poster|action)=)(["'])(?!#|/|[A-Za-z][A-Za-z0-9+.-]*:)([^"']+)\2""")
_SRCSET = re.compile(r"""(\ssrcset=)(["'])([^"']*)\2""")


def _absolute(url: str) -> str:
    return url if _NOT_RELATIVE.match(url) else "/" + url


_NOT_RELATIVE = re.compile(r"#|/|[A-Za-z][A-Za-z0-9+.-]*:|\s*$")


def _absolute_links(html: str) -> str:
    html = _ATTR_URL.sub(lambda m: f"{m.group(1)}{m.group(2)}/{m.group(3)}{m.group(2)}", html)
    html = _SRCSET.sub(lambda m: m.group(1) + m.group(2) + ", ".join(
        " ".join([_absolute(part.split()[0])] + part.split()[1:]) for part in m.group(3).split(",") if part.strip()
    ) + m.group(2), html)
    return re.sub(r"""(this\.src=')(?!/|[A-Za-z][A-Za-z0-9+.-]*:)""", r"\1/", html)


def _outside_scripts(html: str, fn) -> str:
    """Apply fn to the page but not inside <script>: scripts must stay exactly as the English page has them."""
    parts = re.split(r"(<script\b.*?</script>)", html, flags=re.S)
    return "".join(p if i % 2 else fn(p) for i, p in enumerate(parts))


class _Links(HTMLParser):
    """Every URL-bearing attribute, however it is written (case, quotes, none)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.urls: list[str] = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if value is None:
                continue
            if name in ("href", "src", "poster", "action", "xlink:href", "data-src"):
                self.urls.append(value)
            elif name == "srcset":
                self.urls += [c.split()[0] for c in value.split(",") if c.strip()]

    handle_startendtag = handle_starttag


class _Attrs(HTMLParser):
    """The attribute text a German page would carry over: alt, title, aria-label,
    placeholder, and the description and share text in <meta>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.values: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for name in TRANSLATED_ATTRS:
            if a.get(name) and _LETTERS.search(a[name]):
                self.values.append(a[name])
        if tag == "meta" and (a.get("name") == "description" or a.get("property") in ("og:title", "og:description")):
            if a.get("content"):
                self.values.append(a["content"])

    handle_startendtag = handle_starttag


def untranslated_attrs(src: str, catalog: dict) -> list[str]:
    """Attribute text on the English page (outside the release history and scripts) with no 'attrs' entry."""
    try:
        spans, whatsnew, _ = units(src)
    except ValueError:
        return []
    if whatsnew:
        src = src[:whatsnew[0]] + src[whatsnew[1]:]
    p = _Attrs()
    p.feed(re.sub(r"<script\b.*?</script>", "", src, flags=re.S))
    known = set(catalog.get("attrs", {}))
    return sorted({v for v in p.values if v not in known})


def relative_links(page: str) -> list[str]:
    p = _Links()
    p.feed(page)
    p.close()
    found = [u for u in p.urls if not _NOT_RELATIVE.match(u)]
    found += re.findall(r"url\((?![\'\"]?(?:/|#|data:|https?:))([^)]*)\)", page)
    found += re.findall(r"""this\.src='(?!/|[A-Za-z][A-Za-z0-9+.-]*:)([^']*)'""", page)
    return found


def build(src: str, catalog: dict | None = None) -> tuple[str, dict]:
    """German page from the English one. Returns (html, report)."""
    cat = catalog if catalog is not None else load_catalog()
    table = cat["_units"]
    # Things the English page says that are not true for a German reader (the
    # panel is in English only, so "11 languages" is the wrong promise here).
    not_found = [piece for piece in cat.get("drop", []) if piece not in src]
    for piece in cat.get("drop", []):
        src = src.replace(piece, "")
    spans, whatsnew, loose = units(src)
    edits, done, missing = [], 0, []
    for s, e in spans:
        key = norm(src[s:e])
        if key in table:
            edits.append((s, e, table[key]))
            done += 1
        else:
            missing.append(key)
    # The release history stays English: the section keeps its place, and says so in German.
    if whatsnew:
        edits.append((whatsnew[0], whatsnew[1], "\n" + cat["whatsnew"] + "\n"))
    out, last = [], 0
    for s, e, new in sorted(edits):
        out += [src[last:s], new]
        last = e
    out.append(src[last:])
    page = "".join(out)

    attrs_not_found = []
    for en, de in cat.get("attrs", {}).items():
        # Looked for on the English page: one inside a translated block is already German here.
        if not any(f'{a}="{v}"' in src for a in TRANSLATED_ATTRS + ("content",)
                   for v in (en, htmllib.escape(en, quote=True))):
            attrs_not_found.append(en)
        for attr in TRANSLATED_ATTRS + ("content",):
            page = page.replace(f'{attr}="{htmllib.escape(en, quote=True)}"', f'{attr}="{htmllib.escape(de, quote=True)}"')
            page = page.replace(f'{attr}="{en}"', f'{attr}="{de}"')
    raw_not_found = [en for en in cat.get("raw", {}) if en not in page]
    for en, de in cat.get("raw", {}).items():
        page = page.replace(en, de)
    # The way back to English, whether or not the nav itself has its German yet.
    page = page.replace(LINK_TO_DE, LINK_TO_EN)

    page = re.sub(r"<html\b([^>]*)\blang=\"[^\"]*\"", r'<html\1lang="de"', page, count=1)
    page = page.replace(f'<link rel="canonical" href="{URL_EN}">', f'<link rel="canonical" href="{URL_DE}">')
    page = page.replace(f'<meta property="og:url" content="{URL_EN}">', f'<meta property="og:url" content="{URL_DE}">')
    page = _outside_scripts(page, _absolute_links)

    # Loose text that a 'raw' entry has already turned German is not a gap.
    visible = htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", page)))
    loose = [t for t in loose if t in visible]
    # Only what is still English on the German page: a translated block brings its own alt text.
    untranslated = [v for v in untranslated_attrs(src, cat)
                    if f'="{v}"' in page or f'="{htmllib.escape(v, quote=True)}"' in page]
    total = done + len(missing)
    report = {"untranslated_attrs": untranslated, "units": total, "translated": done, "missing": missing, "loose_text": loose,
              "coverage": (done / total) if total else 1.0, "drop_not_found": not_found,
              "raw_not_found": raw_not_found, "attrs_not_found": attrs_not_found,
              "whatsnew_replaced": bool(whatsnew)}
    return page, report


def _forms(page: str) -> list[str]:
    """Each form with its button text taken out: everything else must match."""
    return [re.sub(r"(<button\b[^>]*>).*?(</button>)", r"\1\2", f, flags=re.S)
            for f in re.findall(r"<form\b.*?</form>", page, re.S)]


def _scripts(page: str) -> list[str]:
    return re.findall(r"<script\b.*?</script>", page, re.S)


def gaps(report: dict) -> list[str]:
    """English that will show through on the German page: worth fixing in
    site/i18n/de.json, never a reason to hold back a deploy. (A stale 'drop' entry
    is not a gap but a check() problem: it guards a claim that misleads German readers.)"""
    out = []
    if report["coverage"] < MIN_COVERAGE:
        out.append(f"only {report['translated']} of {report['units']} text blocks have German "
                   "(python scripts/build_site_de.py lists them)")
    if report["untranslated_attrs"]:
        out.append(f"attribute text with no German (alt, title or the search/share text): "
                   f"{report['untranslated_attrs'][0][:80]}")
    if report["attrs_not_found"]:
        out.append(f"an 'attrs' entry no longer matches (alt text, title or the search/share text): "
                   f"{report['attrs_not_found'][0][:80]}")
    if report["raw_not_found"]:
        out.append(f"a 'raw' entry no longer matches, so that text stays English: {report['raw_not_found'][0][:80]}")
    if report["loose_text"]:
        out.append(f"text that can't be translated where it sits: {report['loose_text'][0][:80]}")
    return out


def check(en: str, de: str, report: dict, catalog: dict | None = None) -> list[str]:
    """What must be true before the German page goes live, because a visitor sent
    there would be stuck or misled without it. [] means ready. (gaps() lists English
    that would merely show through.)"""
    cat = catalog if catalog is not None else load_catalog()
    problems = []
    if report["coverage"] < 0.5:
        problems.append(f"only {report['translated']} of {report['units']} text blocks have German: "
                        "the build is broken, not just behind")
    if report["drop_not_found"]:
        # A drop entry exists because that English claim misleads German readers.
        problems.append("the English page no longer says what a 'drop' entry removes; read what it "
                        f"says now and update site/i18n/de.json: {report['drop_not_found'][0][:80]}")
    if not report["whatsnew_replaced"] or 'class="relitem"' in de:
        problems.append("the English release history is still on the German page")
    if LINK_TO_EN not in de or LINK_TO_DE in de:
        problems.append("the German page has no working link back to English")
    if '<html lang="de"' not in de or f'<link rel="canonical" href="{URL_DE}">' not in de:
        problems.append("the German page is not marked German (lang / canonical)")
    if f'hreflang="de" href="{URL_DE}"' not in de or f'hreflang="en" href="{URL_EN}"' not in de:
        problems.append("the hreflang links are missing")
    if _forms(de) != _forms(en) or not _forms(en):
        problems.append("the PayPal forms differ from the English page's")
    raw = cat.get("raw", {})

    def german_script(s: str) -> str:
        for a, b in raw.items():
            s = s.replace(a, b)
        return s

    if [german_script(s) for s in _scripts(en)] != _scripts(de):
        problems.append("a script differs from the English page's beyond the 'raw' replacements")
    rel = relative_links(de)
    if rel:
        problems.append(f"relative links that would point inside /de/: {rel[:3]}")
    if len(re.findall(r"<[a-z]+[^>]*\sdata-latest-version", de)) < 2:
        problems.append("fewer than two stampable version claims")
    return problems


def main() -> None:
    args = sys.argv[1:]

    def opt(name: str) -> str | None:
        return args[args.index(name) + 1] if name in args and args.index(name) + 1 < len(args) else None

    src_path = pathlib.Path(opt("--from") or SRC)
    en = src_path.read_text(encoding="utf-8")
    page, rep = build(en)
    print(f"German page: {rep['translated']} of {rep['units']} text blocks translated "
          f"({100 * rep['coverage']:.0f}%) from {src_path}")
    for key in rep["missing"][:40]:
        print("  no German yet:", htmllib.unescape(re.sub(r"<[^>]+>", "", key))[:100])
    for problem in check(en, page, rep):
        print("  PROBLEM (would stop a deploy):", problem)
    for gap in gaps(rep):
        print("  gap:", gap)
    if opt("--out"):
        pathlib.Path(opt("--out")).write_text(page, encoding="utf-8")
        print(f"  wrote {opt('--out')} ({len(page.encode('utf-8'))} bytes)")
    if opt("--todo"):
        pathlib.Path(opt("--todo")).write_text(
            json.dumps([{"en": k, "de": ""} for k in rep["missing"]], ensure_ascii=False, indent=1),
            encoding="utf-8")
        print(f"  wrote {len(rep['missing'])} untranslated block(s) to {opt('--todo')}")


if __name__ == "__main__":
    main()
