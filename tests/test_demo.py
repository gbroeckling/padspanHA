"""The public demo (tools/demo): it builds from this checkout's panel files,
and its houses identify nobody — no names, entity ids or addresses of a real
house in a public page."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_DEMO = _ROOT / "tools" / "demo"
if not (_DEMO / "build.py").is_file():
    # A generated PadSpan Bright tree carries the integration and the tests, not tools/.
    pytest.skip("no tools/ in this tree (a Bright build)", allow_module_level=True)
sys.path.insert(0, str(_DEMO))

import build as demo_build  # noqa: E402

_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
# What the demo shows: its own files, and the panel's Sample mode data.
_DEMO_DATA = [_DEMO / "fixture.js", _DEMO / "estate.js", _DEMO / "fake_hass.js", _DEMO / "index.html", _WWW / "sample_data.js"]
_MAC = re.compile(r"\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b")
_IP = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_BANNER = "Demo — a sample house, made-up people and devices"


def _text(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def test_the_demo_files_have_no_addresses_or_people():
    for p in [p for p in _DEMO_DATA if p.parent == _DEMO]:
        t = _text(p)
        assert not _MAC.findall(t), p.name
        assert not _IP.findall(t), p.name
        assert not _EMAIL.findall(t), p.name
        # A fake place: no coordinates of a real one.
        assert "latitude: 0, longitude: 0" in t or "latitude" not in t, p.name


def test_sample_macs_are_obviously_made_up():
    """sample_data.js's addresses: the 00:11:22 / AA:BB:CC… runs, or the
    rotating private addresses of the two sample phones, listed by name."""
    t = _text(_WWW / "sample_data.js")
    fake_run = re.compile(r"^(00:11:22|AA:|BB:|CC:|DD:|EE:|FF:)", re.I)
    rotating = set(re.findall(r'all_addresses: \[([^\]]*)\]', t))
    listed = {m for group in rotating for m in _MAC.findall(group)}
    # A random static address (top two bits of the first byte set) is one a
    # device makes up for itself: never a real device's hardware address.
    random_static = lambda mac: int(mac[:2], 16) >> 6 == 0b11
    for mac in set(_MAC.findall(t)):
        assert fake_run.match(mac) or mac in listed or random_static(mac), mac


def test_the_fixture_is_the_harness_house():
    """One fictional house for both: the harness imports it, never its own copy."""
    harness = _text(_ROOT / "tools" / "live_aboard_harness" / "index.html")
    assert 'import("../demo/fixture.js")' in harness
    assert "room_geometry_m" not in harness and "const STATES" not in harness
    fix = _text(_DEMO / "fixture.js")
    assert "export function harnessFixture(q)" in fix and "return { MODEL, STATES };" in fix


def test_writes_stay_in_the_page_and_the_banner_shows():
    fake = _text(_DEMO / "fake_hass.js")
    page = _text(_DEMO / "index.html")
    assert _BANNER in page
    # Nothing leaves the browser: no fetch but its own settings file, no sockets.
    assert re.findall(r"fetch\(([^)]*)\)", fake) == ['"demo_settings.json"']
    assert "WebSocket" not in fake and "XMLHttpRequest" not in fake
    # No reporting from the demo.
    assert "telemetry_enabled: false" in fake and "update_check_enabled: false" in fake


def test_the_bar_shares_this_view_and_speaks_german():
    """Share: a phone's share sheet, elsewhere the link copied; the link is this
    view plus ref=share, which the site's logs count. A German browser (its
    first language, or ?hl=de) gets the bar in German; the panel stays English."""
    page = _text(_DEMO / "index.html")
    assert 'id="demo-share"' in page and "navigator.clipboard.writeText(text)" in page and "navigator.share(" in page
    assert 'u.searchParams.set("ref", "share")' in page
    # ?lang= sets the site's language cookie for a year (site/.htaccess), ?hl= only
    # shows a language: a shared link carries neither, the sharer's choice stays theirs.
    assert "/^(utm_|fbclid$|gclid$|ref$|lang$|hl$)/" in page
    assert 'String(q.get("hl") || q.get("lang") || (navigator.languages && navigator.languages[0])' in page
    for de in ("Demo – Beispielhaus, fiktive Personen und Geräte", "Wanddisplay", '"Teilen"', '"Kopiert"',
               "Kostenlos installieren", '"https://padspan.traks.ca/de/#install"', '"Jetzt: "', '"zwischen zwei Räumen"', '"Gast"'):
        assert de in page, de
    # The guides, linked from the page search engines crawl most (Anleitungen in German).
    assert 'id="demo-guides" href="/guides/"' in page and '"Anleitungen"' in page
    # The German words go in after Share is wired up, so a missing element can't break it.
    assert page.index('share.addEventListener("click"') < page.index("  if (de) {")
    # Still nothing sent from the page.
    assert "fetch(" not in page and "sendBeacon" not in page and "WebSocket" not in page


def test_german_guides_open_the_demo_in_german_without_switching_the_site():
    """?hl=de shows the bar in German; ?lang=de would also send the reader's
    front page to /de/ for a year."""
    guides = sorted((_ROOT / "site" / "guides").glob("*/de/index.html"))
    assert guides
    for g in guides:
        t = _text(g)
        assert 'href="/demo/?hl=de"' in t, g.parent.parent.name
        assert not re.search(r'href="/demo/(\?lang=[^"]*)?"', t), g.parent.parent.name


def test_the_build_copies_this_checkout(tmp_path):
    out = demo_build.build(tmp_path / "dist")
    for name in ("index.html", "fake_hass.js", "fixture.js", "estate.js", "demo_settings.json"):
        assert (out / name).is_file(), name
    copied = out / "padspan_ha_static" / "padspan-ha"
    src_files = sorted(p.relative_to(_WWW) for p in _WWW.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    assert sorted(p.relative_to(copied) for p in copied.rglob("*") if p.is_file()) == src_files
    absolute = re.compile(r"(?<!\.)/padspan_ha_static/")
    for rel in src_files:
        a, b = (_WWW / rel).read_bytes(), (copied / rel).read_bytes()
        if rel.suffix in demo_build.REWRITE:
            assert not absolute.search(b.decode("utf-8")), rel
            # The only change: absolute static URLs made relative.
            assert b.replace(b"./padspan_ha_static/", b"/padspan_ha_static/") == a, rel
        else:
            assert a == b, rel
    built = json.loads((out / "demo_settings.json").read_text(encoding="utf-8"))
    assert built["settings"]["data_mode"] == "sample"
    manifest = json.loads((_ROOT / "custom_components" / "padspan_ha" / "manifest.json").read_text(encoding="utf-8"))
    assert built["version"]["version"] == manifest["version"]
    assert not _IP.findall(json.dumps(built)) and not _EMAIL.findall(json.dumps(built))


def _const(text: str, name: str):
    """One of estate.js's data blocks (const NAME = {...};), as Python."""
    m = re.search(r"^const " + name + r" = (.*);$", text, re.M)
    assert m, name
    return json.loads(m.group(1))


def test_the_estate_is_the_main_house():
    """The demo opens on the estate: three floors, furnished, stairs between
    them, two residents and a guest wearing a tag lent for the stay (Guest
    tags: the snapshot's tag carries guest = {name, session}). The classic
    house stays for ?house=classic and a new install's first minutes (?fresh=)."""
    est = _text(_DEMO / "estate.js")
    assert "export function estateFixture(q)" in est
    rooms = _const(est, "ROOMS")
    floors = {g["floor_id"] for g in rooms.values()}
    assert floors == {"lower", "main", "upper"} and len(rooms) >= 20
    assert any(len(g["points_m"]) > 6 for g in rooms.values()), "more than boxes"
    pieces = _const(est, "PIECES")
    assert len(pieces) >= 100
    assert all(re.fullmatch(r"fur_[0-9a-f]{8}", k) and v["id"] == k for k, v in pieces.items())
    assert all(v["floor_id"] in floors for v in pieces.values())
    stairs = [v for v in pieces.values() if v["recipe"]["kind"] == "stairs"]
    assert {(s["floor_id"], s["recipe"]["params"]["to_floor"]) for s in stairs} >= {("lower", "main"), ("main", "upper")}
    walkers = _const(est, "WALKERS")
    people = {w["person"] for w in walkers if w.get("person")}
    assert people == {"person.alex", "person.sam"}
    guest = next(w for w in walkers if w.get("guest"))
    assert guest["kind"] == "ble" and "person" not in guest and guest["guest"]["name"]
    assert any(len(p) == 4 for w in walkers for p in w["loop"]), "someone stays somewhere a while"
    assert all({p[0] for p in w["loop"]} <= floors for w in walkers)
    assert len({p[0] for w in walkers for p in w["loop"]}) == 3, "someone goes up and someone goes down"
    fake = _text(_DEMO / "fake_hass.js")
    assert 'import { estateFixture } from "./estate.js";' in fake
    assert 'const classic = fresh || q.get("house") === "classic";' in fake
    assert "...(w.guest ? { guest: clone(w.guest) } : {})" in fake


# Words any house has (rooms, devices, Home Assistant's own): a name made only
# of these identifies nobody.
_GENERIC = set("""basement bedroom entry fan first home assistant kitchen laundry living room main shared sun upper
    iphone pixel office hall den bath rec shop garage dining weather""".split())


def _generic(name: str) -> bool:
    words = [w for w in re.split(r"[^a-z0-9]+", name.lower()) if w]
    return bool(words) and all(w in _GENERIC for w in words)


@pytest.mark.skipif(not os.environ.get("PADSPAN_PRIVATE_HARNESS"), reason="needs the private UI harness (PADSPAN_PRIVATE_HARNESS)")
def test_nothing_from_the_private_harness():
    """Run on the machine with the private harness (a real house's dump, never
    in the repo): none of its names, entity ids, addresses or people are in
    the demo's data, except words any house has."""
    priv = Path(os.environ["PADSPAN_PRIVATE_HARNESS"])
    ids: set[str] = set()
    for f in priv.glob("*.json"):
        data = json.loads(f.read_text(encoding="utf-8"))
        stack = [data]
        while stack:
            v = stack.pop()
            if isinstance(v, dict):
                stack.extend(v.values())
                for k in ("entity_id", "name", "friendly_name"):
                    if isinstance(v.get(k), str):
                        ids.add(v[k])
                if isinstance(v.get("attributes"), dict) and isinstance(v["attributes"].get("friendly_name"), str):
                    ids.add(v["attributes"]["friendly_name"])
            elif isinstance(v, list):
                stack.extend(v)
            elif isinstance(v, str):
                ids.update(_MAC.findall(v))
                ids.update(_IP.findall(v))
    ids = {i for i in ids if len(i) > 2 and not _generic(i)}
    for user in re.findall(r'user: \{ is_admin: true, name: "([^"]+)"', "".join(_text(p) for p in priv.glob("*.html"))):
        ids.add(user)
    assert ids, "the private harness had nothing to compare"
    for p in _DEMO_DATA:
        # The shipped files' licence header names their author; that is public.
        t = "\n".join(line for line in _text(p).splitlines() if not line.startswith("// Copyright"))
        found = sorted(i for i in ids if re.search(r"(?<![\w.:])" + re.escape(i) + r"(?![\w:])", t, re.I))
        if found:   # counted, never listed: the failure log is not the place for them either
            pytest.fail(f"{p.name}: {len(found)} identifiers from the private harness")
