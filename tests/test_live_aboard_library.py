# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P4: the shared furniture library in the page (views/live_aboard_library.js).

tests/js/live_aboard_library.mjs runs it for real: the shared fixtures (free
text, the details sheet, every filter and sort over the seeded library, done
in the page as the server does them); colour families, size classes per kind,
a sheet prefilled from the builder or tidied from an AI's; libraryFlow with the
library off, unreachable (Furnish still works: the starter set) and answering
(every filter, the sorts, Fits here, placing, reporting, the terms read only);
shareFlow (the terms first, a missing detail and a phone number refused in the
page, the suggestion put back, a share of the recipe's keys and the sheet
only); and the library's rows in Settings → UI Structure → Atlas → 3D house.

LIBRARY_SERVER_LIVE (the module's one switch for a pre-release before the
library's server is up) is run both ways: the harness on this tree, and on a
copy with only that line the other way round. Live: everything above. Not
live: no Share, no terms, no Settings rows, and Library is the starter set
with not one call.

Held here too: the page's lists and patterns are the server's and the
install's — one set of rules in three places; the terms are marked "Draft —
under review"; the module is only ever loaded on demand; and a share as the
page sends it goes through the install's checks and is kept by the server.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_library as HL

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www"
_VIEWS = _WWW / "padspan-ha" / "views"
_FIX = Path(__file__).parent / "fixtures" / "furniture_library"
_NODE = shutil.which("node")


_LIVE = re.compile(r"^export const LIBRARY_SERVER_LIVE = (true|false);$", re.M)


def library_tree(tmp_path_factory, live: bool) -> Path:
    """www/padspan-ha with LIBRARY_SERVER_LIVE as asked: this tree when it
    already is, else a copy with only that line the other way round."""
    src = (_VIEWS / "live_aboard_library.js").read_text(encoding="utf-8")
    found = _LIVE.findall(src)
    assert len(found) == 1, "one LIBRARY_SERVER_LIVE, true or false"
    if (found[0] == "true") == live:
        return _WWW / "padspan-ha"
    out = tmp_path_factory.mktemp("library_live" if live else "library_prerelease") / "padspan-ha"
    shutil.copytree(_WWW / "padspan-ha", out)
    (out / "views" / "live_aboard_library.js").write_text(
        _LIVE.sub(f"export const LIBRARY_SERVER_LIVE = {'true' if live else 'false'};", src), encoding="utf-8")
    return out


def _run(views: Path) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_library.mjs"), str(views), str(_FIX)],
                         capture_output=True, text=True, encoding="utf-8", timeout=240)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.fixture(scope="module")
def page(tmp_path_factory) -> dict:
    """The library's server live."""
    got = _run(library_tree(tmp_path_factory, True) / "views")
    assert got["data"]["live"] is True
    return got


@pytest.fixture(scope="module")
def page_prerelease(tmp_path_factory) -> dict:
    """Before the library's server is live (LIBRARY_SERVER_LIVE false)."""
    got = _run(library_tree(tmp_path_factory, False) / "views")
    assert got["data"]["live"] is False
    return got


def _case(p: dict, *prefixes: str) -> None:
    got = {k: v for k, v in p["cases"].items() if k.startswith(prefixes)}
    assert got, f"no {prefixes} case ran: {sorted(p['cases'])}"
    bad = [f for f in p["failures"] if f["name"].startswith(prefixes)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_the_page_runs_the_shared_fixtures(page) -> None:
    """Free text, the details sheet and the seeded searches: the same answers
    as the server's port and the install's checks."""
    _case(page, "freetext", "details", "search")


def test_what_the_page_works_out(page) -> None:
    """Colour families (all fourteen), size classes per kind, and the sheet a
    piece starts with: from the builder's settings, or an AI's sheet tidied
    to the library's values with everything else left out."""
    _case(page, "colour", "size", "prefill")


def test_browsing_the_library(page) -> None:
    """Off: the starter set and not one library call. Unreachable: said, and
    the starter set still places. Answering: every filter and sort reaches the
    wire, Fits here filters to the space passed (or the room's outline, read
    once), placing counts it and brings the recipe and its details, a report
    carries a reason only, and the terms can be read without accepting."""
    _case(page, "library_")


def test_sharing_a_piece(page) -> None:
    """The library off: said. The terms first (accepted once, at the current
    version), then the sheet: a missing detail and free text with a phone
    number, email address, street address or web address are refused in the
    page and nothing is sent; a refused title becomes the suggestion again; a
    share carries the recipe's own keys and the sheet, nothing else of the
    piece; an AI's sheet is "details checked" only once a person ticks it."""
    _case(page, "share_")


def test_the_settings_rows(page) -> None:
    """Nothing of the library while Live Aboard is off; once on, the Shared
    library switch (saved alone) and Withdraw my shared furniture, asked in
    the page first."""
    _case(page, "settings_")


def test_before_the_library_server_is_live(page_prerelease) -> None:
    """LIBRARY_SERVER_LIVE false: Library is the starter set and asks
    nothing of anyone, even with the switch saved on; no terms, no shared
    pieces, no Report; Share has nothing to share to; Settings shows no
    Shared library switch and no Withdraw (Remove all furniture stays)."""
    _case(page_prerelease, "prerelease_browse", "prerelease_share", "prerelease_settings")
    for prefix in ("prerelease_browse", "prerelease_share", "prerelease_settings"):
        assert any(k.startswith(prefix) for k in page_prerelease["cases"]), prefix
    _case(page_prerelease, "starters", "freetext", "details")


def test_a_flow_closed_from_outside_ends_as_its_own_close_does(page, page_prerelease) -> None:
    """Furnish's × (ctx.signal): the flow resolves null and empties its box,
    so its thumbnail renderer is let go."""
    _case(page, "closed_outside")
    _case(page_prerelease, "closed_outside")


def test_the_starter_set(page) -> None:
    """assets/furniture_starters.json: 20 to 30 made-up pieces covering Garry's
    eight starter builders (sofa, bed, table, chair, desk, dresser, TV, lamp),
    each a recipe its builder keeps as it is, with a full details sheet that
    passes the library's rules, its colour family and size class worked out
    the page's own way; shown, searched and placed even with the library off
    or unreachable (test_browsing_the_library), as nobody's library piece."""
    _case(page, "starters")


def test_the_page_holds_the_servers_and_the_installs_lists_and_patterns(page) -> None:
    for name, values in page["data"]["lists"].items():
        assert values == list(getattr(HL, name)), name
    assert page["data"]["counts"] == {k: list(v) for k, v in HL.COUNTS.items()}
    assert page["data"]["text"] == {k: list(v) for k, v in HL.TEXT.items()}
    assert [[w, p, "i" if i else ""] for w, p, i in HL.SECRETS] == page["data"]["secrets"]
    assert [[w, p, "i" if i else ""] for w, p, i in HL.PERSONAL] == page["data"]["personal"]
    assert page["data"]["terms"]["version"] == HL.TERMS_VERSION
    php = _ROOT / "server" / "furniture_library.php"
    if php.exists():   # the Bright derivation carries no server/
        from tests.test_furniture_library_server import _php_list
        src = php.read_text(encoding="utf-8")
        for name, values in page["data"]["lists"].items():
            assert values == _php_list(src, name), name
        assert f"$FIT_MARGIN_M = {page['data']['fit_margin']};" in src


def test_the_terms_are_the_plans_and_in_force(page) -> None:
    """In force since 2026-10-04 (Garry put the library live): no draft label."""
    terms = page["data"]["terms"]
    assert terms["status"] == ""
    said = " ".join(terms["points"])
    for must in ("permanent licence", "every edition", "You keep your own rights", "nobody a licence outside PadSpan",
                 "Never your photo", "withdraw", "Copies already placed in other houses stay", "browse"):
        assert must in said, must
    src = (_VIEWS / "live_aboard_library.js").read_text(encoding="utf-8")
    block = src.split("export const TERMS = {", 1)[1].split(chr(10) + "};", 1)[0]
    assert "Draft" not in block and "export const LIBRARY_SERVER_LIVE = true;" in src


def test_the_module_is_only_ever_loaded_on_demand() -> None:
    """Nothing imports the library statically, so nothing of it loads while
    Live Aboard is off; it imports nothing but the bundled three.js, and that
    only once a flow draws a thumbnail."""
    static = re.compile(r"^\s*import\s[^(]*live_aboard_library\.js", re.M)
    for f in _WWW.rglob("*.js"):
        if "vendor" in f.parts:
            continue
        assert not static.search(f.read_text(encoding="utf-8")), f
    src = (_VIEWS / "live_aboard_library.js").read_text(encoding="utf-8")
    assert not re.search(r"^\s*import\s", src, re.M)
    assert re.findall(r"import\(`([^`$]+)", src) == ["../vendor/three/three.module.min.js"]


def test_a_share_from_the_page_is_checked_by_the_install_and_kept_by_the_server(page) -> None:
    msg = page["data"]["share_message"]
    out = HL.shared_recipe(msg["recipe"])
    assert out == msg["recipe"], "the page sends exactly what the install would send on"
    php = _ROOT / "server" / "furniture_library.php"
    if not php.exists():
        pytest.skip("no server/ in this tree")
    from tests.test_furniture_library_server import _Library
    server = _Library(php.read_text(encoding="utf-8"))
    body = HL.share_body("sub_a1b2c3d4e5f60718", "00112233445566778899aabbccddeeff", out)
    code, reply = server.handle(json.dumps(body).encode("utf-8"))
    assert code == 200 and reply["edited"] is False, reply
