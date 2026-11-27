"""A full deploy tells IndexNow which pages it changed (the owner's Black Friday pick, 2026-11-26).

scripts/deploy_site.py asks the server, before anything is uploaded, which pages differ from what it is about to
put up (one read-only sha256sum over SSH), and once the deploy is verified hands IndexNow (scripts/indexnow.py)
those of them the sitemap lists: Bing, Yandex, Seznam, Naver and Yep then fetch them within hours. When the server
can't be asked, every page in the sitemap goes. IndexNow being down, or refusing, never fails a deploy: the pages
are live either way. --guides-only keeps telling it about every guide, as before.

Nothing here reaches the network: the server, the upload and IndexNow are all stand-ins.
"""
from __future__ import annotations

import hashlib
import pathlib
import re
import sys
import urllib.error
from importlib.util import module_from_spec, spec_from_file_location
from types import SimpleNamespace

import pytest

_ROOT = pathlib.Path(__file__).resolve().parents[1]
_SITE = _ROOT / "site"

pytestmark = pytest.mark.skipif(not (_SITE / "index.html").is_file(), reason="no site/ in this tree")


def _deploy_site():
    spec = spec_from_file_location("deploy_site", _ROOT / "scripts" / "deploy_site.py")
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture()
def sent(monkeypatch) -> list:
    """What indexnow.submit is handed; it answers 202 Accepted."""
    sys.path.insert(0, str(_ROOT / "scripts"))
    import indexnow
    got: list = []
    monkeypatch.setattr(indexnow, "submit", lambda urls: (got.append(list(urls)), (202, "Accepted"))[1])
    return got


def _uploads(mod, version: str = "9.9.9") -> dict[str, bytes]:
    """The pages a full deploy puts up, exactly as main() makes them."""
    html = mod.SRC.read_text(encoding="utf-8")
    stamped, _ = mod.stamp(html, version)
    de, _ = mod.build_german(html, version)
    return {"index.html": stamped.encode("utf-8"), "de/index.html": de.encode("utf-8"),
            **{g: (mod.SRC.parent / g).read_bytes() for g in mod.GUIDES}}


def _asked(cmd: str) -> list[str]:
    """The files the server is asked about: sudo's sha256sum, then the same list again for the login's own."""
    first, again = re.fullmatch(r'.*"cd \S+ && \(sudo -n sha256sum -- (.*) \|\| sha256sum -- (.*)\)"', cmd).groups()
    assert first == again
    return first.split()


def _server(mod, monkeypatch, uploads: dict[str, bytes], differ=(), missing=(), down=False) -> list:
    """A stand-in for the server: sha256sum answers for the pages it has (`differ` with other bytes, `missing` not
    there at all; `down`, no answer), and every other command succeeds. Returns the commands, in order."""
    calls: list = []

    def fake_run(cmd, shell=True, input=None, capture_output=False, check=False, text=False):
        calls.append(cmd)
        out, code = "", 0
        if "sha256sum" in cmd:
            if down:
                code = 255
            else:
                names = _asked(cmd)
                out = "".join(f"{hashlib.sha256(b'old' if n in differ else uploads[n]).hexdigest()}  {n}\n"
                              for n in names if n not in missing)
                code = 1 if missing else 0
        return SimpleNamespace(returncode=code, stdout=out if text else out.encode(), stderr="" if text else b"")

    monkeypatch.setattr(mod.subprocess, "run", fake_run)
    monkeypatch.setattr(mod, "preflight_htaccess", lambda: [])
    monkeypatch.setattr(mod, "verify_live", lambda version: True)
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--version", "9.9.9"])
    return calls


def test_a_full_deploy_tells_indexnow_the_pages_it_changed(monkeypatch, sent, capsys) -> None:
    mod = _deploy_site()
    up = _uploads(mod)
    calls = _server(mod, monkeypatch, up, differ={"index.html", "pro/index.html"}, missing={"add-ons/de/index.html"})
    mod.main()
    assert sent == [["https://padspan.traks.ca/", "https://padspan.traks.ca/pro/", "https://padspan.traks.ca/add-ons/de/"]]
    assert "OK   IndexNow: 202 Accepted for 3 changed page(s)" in capsys.readouterr().out
    # Asked before anything went up, and only asked: nothing written, moved or removed by that command.
    ask = next(i for i, c in enumerate(calls) if "sha256sum" in c)
    assert ask < next(i for i, c in enumerate(calls) if "tee " in c)
    assert not any(w in calls[ask] for w in ("tee", ">", " rm ", " mv ", " cp ", "mkdir", "chown"))
    assert sorted(_asked(calls[ask])) == sorted(up)


def test_every_page_it_can_send_is_one_the_sitemap_lists(monkeypatch, sent) -> None:
    """Every page a full deploy puts up is in the sitemap, so a change to any of them can be sent; when all changed
    (a first deploy), every one goes, in the sitemap's order."""
    mod = _deploy_site()
    up = _uploads(mod)
    listed = mod.sitemap_urls()
    assert {mod.page_url(n) for n in up} <= set(listed)
    _server(mod, monkeypatch, up, missing=set(up) - {"index.html"})
    mod.main()
    assert sent == [[u for u in listed if u in {mod.page_url(n) for n in up} - {mod.URL}]]


def test_when_the_server_cant_be_asked_every_sitemap_page_goes(monkeypatch, sent, capsys) -> None:
    mod = _deploy_site()
    _server(mod, monkeypatch, _uploads(mod), down=True)
    mod.main()
    assert sent == [mod.sitemap_urls()] and len(sent[0]) >= 100
    out = capsys.readouterr().out
    assert "pages this deploy changes: unknown" in out and "(what changed is unknown)" in out


def test_when_nothing_changed_nothing_is_sent(monkeypatch, sent, capsys) -> None:
    mod = _deploy_site()
    _server(mod, monkeypatch, _uploads(mod))
    mod.main()
    assert sent == []
    assert "IndexNow: no changed page(s), nothing sent" in capsys.readouterr().out


@pytest.mark.parametrize("trouble", [urllib.error.URLError("no route to host"), TimeoutError("timed out"),
                                     SystemExit("expected one IndexNow key file in site/, found 2")])
def test_indexnow_trouble_never_fails_a_deploy(monkeypatch, capsys, trouble) -> None:
    mod = _deploy_site()
    sys.path.insert(0, str(_ROOT / "scripts"))
    import indexnow

    def boom(urls):
        raise trouble

    monkeypatch.setattr(indexnow, "submit", boom)
    _server(mod, monkeypatch, _uploads(mod), differ={"pro/index.html"})
    mod.main()
    out = capsys.readouterr().out
    assert "WARN IndexNow: 0 not sent" in out and "is live on v9.9.9" in out


def test_indexnow_is_told_only_once_the_deploy_is_verified(monkeypatch, sent) -> None:
    mod = _deploy_site()
    _server(mod, monkeypatch, _uploads(mod), differ={"pro/index.html"})
    monkeypatch.setattr(mod, "verify_live", lambda version: False)
    with pytest.raises(SystemExit, match="failed verification"):
        mod.main()
    assert sent == []


def test_a_dry_run_asks_no_server_and_tells_no_one(monkeypatch, sent) -> None:
    mod = _deploy_site()
    calls = _server(mod, monkeypatch, _uploads(mod))
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--dry-run", "--version", "9.9.9"])
    mod.main()
    assert calls == [] and sent == []


def test_guides_only_survives_indexnow_trouble_too(monkeypatch, capsys) -> None:
    mod = _deploy_site()
    sys.path.insert(0, str(_ROOT / "scripts"))
    import indexnow

    def boom(urls):
        raise urllib.error.URLError("no route to host")

    monkeypatch.setattr(indexnow, "submit", boom)
    _server(mod, monkeypatch, {})
    monkeypatch.setattr(mod, "verify_guides", lambda: True)
    monkeypatch.setattr(sys, "argv", ["deploy_site.py", "--guides-only"])
    mod.main()
    assert f"WARN IndexNow: 0 not sent (<urlopen error no route to host>) for {len(mod.GUIDES)} guide(s)" in capsys.readouterr().out


def test_page_urls() -> None:
    mod = _deploy_site()
    assert mod.page_url("index.html") == "https://padspan.traks.ca/"
    assert mod.page_url("de/index.html") == "https://padspan.traks.ca/de/"
    assert mod.page_url("guides/bermuda/de/index.html") == "https://padspan.traks.ca/guides/bermuda/de/"
    assert mod.page_url("showcase-themes.html") == "https://padspan.traks.ca/showcase-themes.html"


@pytest.mark.parametrize("trouble", [urllib.error.URLError("Name or service not known"), TimeoutError("timed out"),
                                     ConnectionResetError("reset by peer")])
def test_indexnow_submit_says_unreachable_instead_of_raising(monkeypatch, trouble) -> None:
    sys.path.insert(0, str(_ROOT / "scripts"))
    import indexnow

    def boom(req, timeout=None):
        raise trouble

    monkeypatch.setattr(indexnow.urllib.request, "urlopen", boom)
    status, reason = indexnow.submit(["https://padspan.traks.ca/pro/"])
    assert status == 0 and reason.startswith("unreachable (")


def test_a_page_that_differs_only_in_line_endings_is_not_a_change(monkeypatch, sent) -> None:
    """A checkout on the Windows PC has CRLF line endings and this one LF, so the same page uploaded from each
    differs in bytes only. Only what a reader would see counts as a change."""
    mod = _deploy_site()
    up = _uploads(mod)
    crlf = {n: b.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n") for n, b in up.items()}
    crlf["pro/index.html"] = b"<p>an older /pro/</p>\r\n"
    _server(mod, monkeypatch, crlf)
    mod.main()
    assert sent == [["https://padspan.traks.ca/pro/"]]
