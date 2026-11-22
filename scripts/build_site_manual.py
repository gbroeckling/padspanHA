#!/usr/bin/env python
"""Make the manual's pages on padspan.traks.ca from docs/manual/*.md.

    python scripts/build_site_manual.py

writes site/manual/ (the contents page and one page per chapter, each at
/manual/<chapter>/, with its German twin at /manual/<chapter>/de/ when
docs/manual/de/ has that chapter) and the manual's lines in site/sitemap.xml.
Commit what it writes: tests/test_site_manual.py fails while the committed pages
differ from what this makes, so the website can't drift from the repo.

A chapter's address is its file name without the number ("04-first-room.md" is
/manual/first-room/), so renumbering a chapter keeps its address. Anchors are
GitHub's, so a link written for GitHub ("09-setup-the-map.md#step-3-draw-the-rooms")
works here too. On a German page, a link to a chapter with no German yet goes to
the English one and says so.

The repo has no Markdown library, so this converts the Markdown the manual uses
and no more: headings, paragraphs, bold, code, links, images, lists (nested),
tables, fenced code, quotes and the generated-block comments (dropped). It stops,
rather than write a broken page, on a link to a file that isn't there, an anchor
the target page doesn't have, a German chapter with no English one, or a link to
one of docs/'s internal notes that moved out of the repo.
"""
from __future__ import annotations

import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANUAL = ROOT / "docs" / "manual"
DE = MANUAL / "de"
SITE = ROOT / "site"
OUT = SITE / "manual"
SITEMAP = SITE / "sitemap.xml"
URL = "https://padspan.traks.ca/"
REPO = "https://github.com/gbroeckling/padspanHA/blob/main/"
# What docs/'s internal notes say now that they moved out (adf2ffaa, 2026-11-22).
POINTER = "moved to the maintainers' private notes"


class ManualError(Exception):
    """The manual can't be made into pages as it stands."""


def slug_of(path: pathlib.Path) -> str:
    """The chapter's folder under /manual/: "" for the contents page."""
    return "" if path.name == "README.md" else re.sub(r"^(?:\d\d|[A-Z])-", "", path.stem)


def page_url(slug: str, lang: str) -> str:
    return "/manual/" + (slug + "/" if slug else "") + ("de/" if lang == "de" else "")


def chapters() -> list[pathlib.Path]:
    return sorted(p for p in MANUAL.glob("*.md") if p.name != "README.md")


def esc(s: str) -> str:
    return html.escape(s, quote=False)


def attr(s: str) -> str:
    return html.escape(s, quote=True)


# ── inline ──────────────────────────────────────────────────────────────────

CODE = re.compile(r"(`+)(.+?)\1")
IMAGE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")
LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
BOLD = re.compile(r"\*\*(.+?)\*\*", re.S)


def plain(md: str) -> str:
    """The text of a line of Markdown, marks and link targets taken out."""
    s = IMAGE.sub(r"\1", md)
    s = LINK.sub(r"\1", s)
    return re.sub(r"\s+", " ", s.replace("**", "").replace("`", "")).strip()


def anchor(heading_md: str) -> str:
    """GitHub's anchor for a heading: lower case, punctuation dropped, spaces as hyphens."""
    return re.sub(r"[^\w\- ]", "", plain(heading_md).lower()).replace(" ", "-")


class Page:
    """One page being made: where its Markdown is, its language, and what it links to."""

    def __init__(self, src: pathlib.Path, lang: str):
        self.src, self.lang = src, lang
        self.slug = slug_of(src)
        self.url = page_url(self.slug, lang)
        self.ids: dict[str, int] = {}
        self.links: list[str] = []

    def new_id(self, heading_md: str) -> str:
        base = anchor(heading_md)
        n = self.ids.get(base, 0)
        self.ids[base] = n + 1
        return base if n == 0 else f"{base}-{n}"

    def href(self, target: str) -> tuple[str, bool]:
        """Where a link in the Markdown goes on the site, and whether it is English
        on a German page."""
        if re.match(r"[a-z][a-z0-9+.-]*:", target):
            if not target.startswith(URL):
                return target, False
            path, _, frag = target[len(URL) - 1:].partition("#")
            de = SITE / path.strip("/") / "de" / "index.html"
            if self.lang == "de" and path.startswith("/guides/") and de.is_file():
                path += "de/"
            return path + ("#" + frag if frag else ""), False
        if target.startswith("#"):
            return target, False
        file_part, _, frag = target.partition("#")
        dest = (self.src.parent / file_part).resolve()
        frag = "#" + frag if frag else ""
        if dest.suffix == ".md" and dest.parent in (MANUAL, DE):
            english = MANUAL / dest.name
            if not english.is_file():
                raise ManualError(f"{self.src.relative_to(ROOT).as_posix()}: {target} (no such chapter)")
            if self.lang == "de" and not (DE / dest.name).is_file():
                return page_url(slug_of(english), "en") + frag, True
            return page_url(slug_of(english), self.lang) + frag, False
        if not dest.exists():
            raise ManualError(f"{self.src.relative_to(ROOT).as_posix()}: {target} (no such file)")
        if dest.suffix == ".md" and POINTER in dest.read_text(encoding="utf-8"):
            raise ManualError(f"{self.src.relative_to(ROOT).as_posix()}: {target} is an internal note "
                              "that moved out of the repo; link something else")
        return REPO + dest.relative_to(ROOT).as_posix() + frag, False

    def inline(self, s: str, en_mark: str = " (englisch)") -> str:
        keep: list[str] = []

        def stash(h: str) -> str:
            keep.append(h)
            return f"\x00{len(keep) - 1}\x00"

        def code(m: re.Match) -> str:
            body = m.group(2)
            if len(body) > 1 and body[0] == body[-1] == " " and body.strip():
                body = body[1:-1]
            return stash(f"<code>{esc(body)}</code>")

        def image(m: re.Match) -> str:
            src, _ = self.href(html.unescape(m.group(2)))
            return stash(f'<img src="{attr(src)}" alt="{m.group(1)}">')

        def link(m: re.Match) -> str:
            href, english = self.href(html.unescape(m.group(2)))
            self.links.append(href)
            mark = en_mark if english else ""
            text = BOLD.sub(r"<b>\1</b>", m.group(1))
            return stash(f'<a href="{attr(href)}">{text}</a>{mark}')

        s = CODE.sub(code, s)
        s = esc(s)
        s = IMAGE.sub(image, s)
        s = LINK.sub(link, s)
        s = BOLD.sub(r"<b>\1</b>", s)
        while "\x00" in s:
            s = re.sub(r"\x00(\d+)\x00", lambda m: keep[int(m.group(1))], s)
        return s


# ── blocks ──────────────────────────────────────────────────────────────────

LIST = re.compile(r"^( {0,3})([-*]|\d{1,9}[.)])( +|$)(.*)$")
FENCE = re.compile(r"^( *)(```+|~~~+)")
HEAD = re.compile(r"^ {0,3}(#{1,6}) +(.*?)(?: +#+)? *$")
TABLE_SEP = re.compile(r"^\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$")


def _lead(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _is_table(lines: list[str], i: int) -> bool:
    return (lines[i].lstrip().startswith("|") and i + 1 < len(lines)
            and bool(TABLE_SEP.match(lines[i + 1].strip())))


def _starts_block(lines: list[str], i: int) -> bool:
    """A line that ends a paragraph above it (a list only when it starts at 1, as on GitHub)."""
    line = lines[i]
    m = LIST.match(line)
    return bool(HEAD.match(line) or FENCE.match(line) or line.lstrip().startswith((">", "<!--"))
                or _is_table(lines, i)
                or (m and m.group(4).strip() and (m.group(2) in "-*" or m.group(2)[:-1] == "1")))


def _cells(row: str) -> list[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|") and not row.endswith("\\|"):
        row = row[:-1]
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", row)]


def blocks(lines: list[str], page: Page, en_mark: str) -> list[tuple[str, str]]:
    """The blocks of some Markdown as (kind, html); a paragraph's html is its inside."""
    out: list[tuple[str, str]] = []
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        m = FENCE.match(line)
        if m:
            ind, fence = len(m.group(1)), m.group(2)
            body = []
            i += 1
            while i < n and not (lines[i].strip().startswith(fence) and set(lines[i].strip()) == {fence[0]}):
                body.append(lines[i][min(ind, _lead(lines[i])):])
                i += 1
            i += 1
            out.append(("pre", f"<pre><code>{esc(chr(10).join(body))}</code></pre>"))
            continue
        if line.lstrip().startswith("<!--"):
            while i < n and "-->" not in lines[i]:
                i += 1
            i += 1
            continue
        m = HEAD.match(line)
        if m:
            level, text = len(m.group(1)), m.group(2)
            out.append(("h", f'<h{level} id="{page.new_id(text)}">{page.inline(text, en_mark)}</h{level}>'))
            i += 1
            continue
        if _is_table(lines, i):
            head, seps = _cells(line), _cells(lines[i + 1])
            align = ["center" if s.startswith(":") and s.endswith(":") else "right" if s.endswith(":") else ""
                     for s in seps]
            rows = []
            i += 2
            while i < n and lines[i].lstrip().startswith("|"):
                rows.append(_cells(lines[i]))
                i += 1

            def row(cells: list[str], tag: str) -> str:
                cells = (cells + [""] * len(head))[:len(head)]
                styles = [' style="text-align:' + a + '"' if a else "" for a in align + [""] * len(head)]
                return "  <tr>" + "".join(f"<{tag}{s}>{page.inline(c, en_mark)}</{tag}>"
                                          for c, s in zip(cells, styles)) + "</tr>"

            body = ([row(head, "th")] if any(head) else []) + [row(r, "td") for r in rows]
            out.append(("table", '<div style="overflow-x:auto">\n<table>\n' + "\n".join(body) + "\n</table>\n</div>"))
            continue
        if line.lstrip().startswith(">"):
            inner = []
            while i < n and lines[i].lstrip().startswith(">"):
                inner.append(re.sub(r"^ *> ?", "", lines[i]))
                i += 1
            out.append(("quote", "<blockquote>\n" + render(blocks(inner, page, en_mark)) + "\n</blockquote>"))
            continue
        if LIST.match(line):
            i, h = _list(lines, i, page, en_mark)
            out.append(("list", h))
            continue
        para = [line.strip()]
        i += 1
        while i < n and lines[i].strip() and not _starts_block(lines, i):
            para.append(lines[i].strip())
            i += 1
        out.append(("p", page.inline("\n".join(para), en_mark)))
    return out


def _list(lines: list[str], i: int, page: Page, en_mark: str) -> tuple[int, str]:
    first = LIST.match(lines[i])
    indent, ordered = len(first.group(1)), first.group(2)[0].isdigit()
    n = len(lines)
    items: list[list[str]] = []
    loose = False
    while True:
        m = LIST.match(lines[i])
        col = indent + len(m.group(2)) + max(1, len(m.group(3)))
        item = [m.group(4)]
        i += 1
        while i < n:
            line = lines[i]
            if not line.strip():
                j = i
                while j < n and not lines[j].strip():
                    j += 1
                if j < n and _lead(lines[j]) >= col:
                    item += [""] * (j - i)
                    i = j
                    loose = True
                    continue
                break
            if _lead(line) >= col:
                item.append(line[col:])
            elif LIST.match(line) or _starts_block(lines, i) or not item[-1].strip():
                break
            else:
                item.append(line.strip())          # a lazy continuation line
            i += 1
        items.append(item)
        j = i
        while j < n and not lines[j].strip():
            j += 1
        nxt = LIST.match(lines[j]) if j < n else None
        if not (nxt and len(nxt.group(1)) == indent and nxt.group(2)[0].isdigit() == ordered):
            break
        loose = loose or j > i
        i = j
    tag = "ol" if ordered else "ul"
    start = int(first.group(2)[:-1]) if ordered else 1
    out = [f'<{tag} start="{start}">' if start != 1 else f"<{tag}>"]
    for item in items:
        parts = blocks(item, page, en_mark)
        inner = "\n".join(h if kind == "p" and not loose else _one(kind, h) for kind, h in parts)
        out.append(f"<li>{inner}</li>")
    out.append(f"</{tag}>")
    return i, "\n".join(out)


def _one(kind: str, h: str) -> str:
    return f"<p>{h}</p>" if kind == "p" else h


def render(parts: list[tuple[str, str]]) -> str:
    return "\n".join(_one(kind, h) for kind, h in parts)


# ── pages ───────────────────────────────────────────────────────────────────

STYLE = """\
:root{--bg:#071009;--card:#0d1d13;--line:rgba(154,230,180,.14);--fg:#e8f5ec;--mut:#93a99b;--acc:#34d399;--acc2:#a7f3d0}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:radial-gradient(1100px 600px at 85% -10%,rgba(52,211,153,.12),transparent 60%),var(--bg);color:var(--fg);line-height:1.65}
a{color:var(--acc);text-decoration:none}
a:hover{text-decoration:underline}
nav{border-bottom:1px solid var(--line);background:rgba(7,16,9,.82)}
nav .in{max-width:820px;margin:0 auto;padding:12px 22px;display:flex;gap:18px;align-items:center;flex-wrap:wrap}
nav .brand{color:var(--fg);font-weight:900;margin-right:auto}
nav a{font-size:14px;font-weight:600}
main{max-width:820px;margin:0 auto;padding:40px 22px 70px}
h1{font-size:clamp(30px,5vw,44px);line-height:1.15;font-weight:900;letter-spacing:-.01em;margin-bottom:14px}
h2{font-size:23px;margin:38px 0 10px;font-weight:800}
h3{font-size:18px;margin:26px 0 8px;font-weight:800}
h4,h5,h6{font-size:16px;margin:20px 0 6px;font-weight:800}
h2,h3,h4{scroll-margin-top:12px}
p{margin:10px 0}
ul,ol{margin:10px 0 10px 22px}
li{margin:6px 0}
li>ul,li>ol{margin:6px 0 6px 20px}
blockquote{border-left:3px solid var(--acc);margin:12px 0;padding:2px 0 2px 14px;color:#c8dccd}
img{max-width:100%;height:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1px 5px;overflow-wrap:anywhere}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:12px 0;overflow-x:auto;line-height:1.5}
pre code{background:none;border:0;padding:0;font-size:13px;overflow-wrap:normal}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:15px}
th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:700}
.pager{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:44px;padding-top:16px;font-size:15px}
footer{border-top:1px solid var(--line);color:var(--mut);font-size:13px}
footer .in{max-width:820px;margin:0 auto;padding:22px}
footer p{margin:4px 0}
@media (max-width:600px){table{font-size:13px}th,td{padding:7px 5px;hyphens:auto;-webkit-hyphens:auto}}"""

WORDS = {
    "en": {
        "manual": "PadSpan HA Manual", "contents": "Contents",
        "nav": ('<a class="brand" href="/">PadSpan™ HA</a>', '<a href="/guides/">Guides</a>',
                '<a href="/manual/">Manual</a>', '<a href="/demo/">Live demo</a>', '<a href="/#install">Install</a>',
                '<a href="https://github.com/gbroeckling/padspanHA">GitHub</a>'),
        "footer": ('<p>PadSpan HA is built by <a href="https://github.com/gbroeckling">Garry Broeckling</a>. '
                   "Architecture, testing and releases are human-directed; the implementation is AI-assisted using "
                   'Claude. <a href="https://github.com/gbroeckling/padspanHA/blob/main/docs/HOW_PADSPAN_IS_BUILT.md">'
                   "How it's built</a>.</p>\n"
                   "  <p>© 2026 Garry Broeckling · GPL-3.0 · PadSpan is a trademark of Devcon Computer Services "
                   "Limited · iPhone, Apple Watch and AirTag are trademarks of Apple Inc.; Android of Google LLC; "
                   "Shelly of Shelly Group; Raspberry Pi of Raspberry Pi Ltd. PadSpan isn't affiliated with any of "
                   "them.</p>"),
        "source": "This page is made from the manual in the repository, "
                  '<a href="https://github.com/gbroeckling/padspanHA/tree/main/docs/manual">docs/manual</a>. '
                  'Something out of date? <a href="https://github.com/gbroeckling/padspanHA/issues">Open an issue</a>.',
    },
    "de": {
        "manual": "PadSpan-HA-Handbuch", "contents": "Inhalt",
        "nav": ('<a class="brand" href="/de/">PadSpan™ HA</a>', '<a href="/guides/">Anleitungen</a>',
                '<a href="/manual/de/">Handbuch</a>', '<a href="/demo/?hl=de">Live-Demo</a>',
                '<a href="/de/#install">Installieren</a>', '<a href="https://github.com/gbroeckling/padspanHA">GitHub</a>'),
        "footer": ('<p>PadSpan HA wird von <a href="https://github.com/gbroeckling">Garry Broeckling</a> entwickelt. '
                   "Architektur, Tests und Releases liegen in menschlicher Hand; die Umsetzung ist KI-gestützt, mit "
                   'Claude. <a href="https://github.com/gbroeckling/padspanHA/blob/main/docs/HOW_PADSPAN_IS_BUILT.md">'
                   "Wie PadSpan gebaut wird</a> (englisch).</p>\n"
                   "  <p>© 2026 Garry Broeckling · GPL-3.0 · PadSpan ist eine Marke der Devcon Computer Services "
                   "Limited · iPhone, Apple Watch und AirTag sind Marken der Apple Inc.; Android der Google LLC; "
                   "Shelly der Shelly Group; Raspberry Pi der Raspberry Pi Ltd. PadSpan ist mit keinem dieser "
                   "Unternehmen verbunden.</p>"),
        "source": "Diese Seite entsteht aus dem Handbuch im Repository, "
                  '<a href="https://github.com/gbroeckling/padspanHA/tree/main/docs/manual/de">docs/manual/de</a>. '
                  'Etwas veraltet? <a href="https://github.com/gbroeckling/padspanHA/issues">Melde es auf GitHub</a>.',
    },
}


def _title(src: pathlib.Path) -> str:
    for line in src.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            return plain(line[2:])
    raise ManualError(f"{src.relative_to(ROOT).as_posix()} has no # title")


def _description(parts: list[tuple[str, str]]) -> str:
    text = ""
    for kind, h in parts:
        if kind == "p":
            words = html.unescape(re.sub(r"<[^>]+>", "", h))
            if words.strip() in ("Contents", "Inhalt"):
                continue
            text = (text + " " + re.sub(r"\s+", " ", words)).strip()
            if len(text) >= 60:
                break
    if len(text) > 158:
        text = text[:157].rsplit(" ", 1)[0].rstrip(",;:") + "…"
    return text


def _make(src: pathlib.Path, lang: str, order: list[pathlib.Path]) -> tuple[Page, str]:
    page = Page(src, lang)
    w = WORDS[lang]
    contents = page.slug == ""
    en_mark = " (vorerst nur auf Englisch)" if contents else " (englisch)"
    parts = blocks(src.read_text(encoding="utf-8").expandtabs(4).splitlines(), page, en_mark)
    title = _title(src)
    desc = _description(parts)
    if len(desc) < 50:
        raise ManualError(f"{src.relative_to(ROOT).as_posix()}: too little text before the first heading for a description")
    canonical = URL + page.url[1:]
    english_url = URL + page_url(page.slug, "en")[1:]
    twin = (DE / src.name).is_file() if lang == "en" else True
    head = [
        "<!DOCTYPE html>", f'<html lang="{lang}">', "<head>", '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        f"<title>{esc(title)} | {'PadSpan HA' if contents else w['manual']}</title>",
        f'<meta name="description" content="{attr(desc)}">',
        f'<link rel="canonical" href="{canonical}">',
    ]
    if twin:
        head += [f'<link rel="alternate" hreflang="en" href="{english_url}">',
                 f'<link rel="alternate" hreflang="de" href="{URL + page_url(page.slug, "de")[1:]}">',
                 f'<link rel="alternate" hreflang="x-default" href="{english_url}">']
    head += ['<meta property="og:type" content="article">', '<meta property="og:site_name" content="PadSpan">']
    if lang == "de":
        head.append('<meta property="og:locale" content="de_DE">')
    head += [f'<meta property="og:title" content="{attr(title)}">',
             f'<meta property="og:description" content="{attr(desc)}">',
             f'<meta property="og:url" content="{canonical}">',
             '<meta property="og:image" content="https://padspan.traks.ca/demo/preview.jpg">',
             '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
             '<meta name="twitter:card" content="summary_large_image">',
             '<link rel="icon" type="image/png" href="/images/icon.png">',
             f"<style>\n{STYLE}\n</style>", "</head>", "<body>"]
    nav = list(w["nav"])
    if lang == "en" and twin:
        nav.append(f'<a href="{page_url(page.slug, "de")}" hreflang="de" lang="de">Deutsch</a>')
    elif lang == "de":
        nav.append(f'<a href="{page_url(page.slug, "en")}" hreflang="en" lang="en">English</a>')
    body = ["<nav><div class=\"in\">"] + ["  " + a for a in nav] + ["</div></nav>", "<main>", render(parts)]
    if not contents:
        at = order.index(MANUAL / src.name)
        links = []
        for k, arrow in ((at - 1, "← "), (-1, ""), (at + 1, " →")):
            if k == -1:
                links.append(f'<a href="{page_url("", lang)}">{w["contents"]}</a>')
            elif 0 <= k < len(order):
                other = order[k]
                german = lang == "de" and (DE / other.name).is_file()
                name = _title(DE / other.name if german else other)
                mark = " (englisch)" if lang == "de" and not german else ""
                text = f"{arrow}{esc(name)}" if arrow == "← " else f"{esc(name)}{arrow}"
                links.append(f'<a href="{page_url(slug_of(other), "de" if german else "en")}">{text}</a>{mark}')
                page.links.append(page_url(slug_of(other), "de" if german else "en"))
            else:
                links.append("<span></span>")
        body.append('<div class="pager">' + "".join(f"<span>{x}</span>" for x in links) + "</div>")
    body += [f'<p style="font-size:13px;color:var(--mut)">{w["source"]}</p>', "</main>",
             f'<footer><div class="in">\n  {w["footer"]}\n</div></footer>', "</body>", "</html>", ""]
    return page, "\n".join(head + body)


def build() -> dict[str, str]:
    """Every file this makes, as {path under site/: text}: the pages and sitemap.xml."""
    order = chapters()
    for de in sorted(DE.glob("*.md")) if DE.is_dir() else []:
        if not (MANUAL / de.name).is_file():
            raise ManualError(f"docs/manual/de/{de.name} has no English chapter of that name")
    sources = [MANUAL / "README.md"] + order
    made: dict[str, Page] = {}
    out: dict[str, str] = {}
    for src in sources:
        for lang, path in (("en", src), ("de", DE / src.name)):
            if path.is_file():
                page, text = _make(path, lang, order)
                made[page.url] = page
                out[f"manual/{page.url[len('/manual/'):]}index.html"] = text
    bad = []
    for page in made.values():
        for href in page.links:
            path, _, frag = href.partition("#")
            if not path.startswith("/manual/"):
                continue
            if path not in made:
                bad.append(f"{page.url}: {href} (no such page)")
            elif frag and frag not in _ids(made[path]):
                bad.append(f"{page.url}: {href} (no such heading there)")
    if bad:
        raise ManualError("links that go nowhere:\n  " + "\n  ".join(bad))
    out["sitemap.xml"] = _sitemap(sorted(made))
    return out


def _ids(page: Page) -> set[str]:
    return {k if i == 0 else f"{k}-{i}" for k, n in page.ids.items() for i in range(n)}


def _sitemap(urls: list[str]) -> str:
    """site/sitemap.xml with the manual's lines replaced by the pages made now."""
    xml = SITEMAP.read_text(encoding="utf-8")
    kept = [line for line in xml.splitlines() if f"<loc>{URL}manual/" not in line]
    end = kept.index("</urlset>")
    lines = []
    for u in urls:
        contents, de = u in ("/manual/", "/manual/de/"), u.endswith("/de/")
        prio = ("0.8" if not de else "0.7") if contents else ("0.7" if not de else "0.6")
        lines.append(f"  <url><loc>{URL}{u[1:]}</loc><changefreq>monthly</changefreq><priority>{prio}</priority></url>")
    return "\n".join(kept[:end] + lines + kept[end:]) + "\n"


def write() -> int:
    files = build()
    for old in OUT.rglob("index.html") if OUT.is_dir() else []:
        if old.relative_to(SITE).as_posix() not in files:
            old.unlink()
    for rel, text in files.items():
        path = SITE / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
    for folder in sorted((p for p in OUT.rglob("*") if p.is_dir()), reverse=True):
        if not any(folder.iterdir()):
            folder.rmdir()
    return len(files) - 1


if __name__ == "__main__":
    print(f"site/manual: {write()} page(s) written, and the manual's lines in site/sitemap.xml")
