"""The test tools (issues #95 and #97): the harness browser, the log verdict,
and nothing of a real house in a public repo."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

_TOOLS = Path(__file__).resolve().parents[1] / "tools"
if not (_TOOLS / "live_aboard_harness" / "browser.py").is_file():
    # A generated PadSpan Bright tree carries the integration and the tests, not tools/.
    pytest.skip("no tools/ in this tree (a Bright build)", allow_module_level=True)
sys.path.insert(0, str(_TOOLS / "live_aboard_harness"))

import browser  # noqa: E402
from check_log import verdict  # noqa: E402


def test_the_browser_follows_the_platform(monkeypatch):
    monkeypatch.delenv("PADSPAN_HARNESS_BROWSER", raising=False)
    monkeypatch.setattr(browser.sys, "platform", "win32")
    assert browser.channel() == "msedge"
    monkeypatch.setattr(browser.sys, "platform", "darwin")
    assert browser.channel() == "chrome"
    monkeypatch.setenv("PADSPAN_HARNESS_BROWSER", "chromium")
    assert browser.channel() == "chromium"


def test_swiftshader_only_with_edge_and_steady_frames_elsewhere(monkeypatch):
    seen = {}

    class _Chromium:
        def launch(self, **kw):
            seen.update(kw)
            return "browser"

    class _P:
        chromium = _Chromium()

    monkeypatch.delenv("PADSPAN_HARNESS_CDP", raising=False)
    monkeypatch.setenv("PADSPAN_HARNESS_BROWSER", "msedge")
    browser.launch(_P())
    assert seen["channel"] == "msedge" and set(browser.SWIFTSHADER) <= set(seen["args"])
    seen.clear()
    monkeypatch.setenv("PADSPAN_HARNESS_BROWSER", "chrome")
    browser.launch(_P())
    assert not set(browser.SWIFTSHADER) & set(seen["args"]), "SwiftShader breaks the editor on macOS"
    assert set(browser.STEADY_FRAMES) <= set(seen["args"])


def test_a_remote_browser_is_connected_not_launched(monkeypatch):
    class _Chromium:
        def connect_over_cdp(self, url):
            return ("cdp", url)

        def launch(self, **kw):  # pragma: no cover - must not be reached
            raise AssertionError("launched a local browser")

    class _P:
        chromium = _Chromium()

    monkeypatch.setenv("PADSPAN_HARNESS_CDP", "http://127.0.0.1:19333")
    assert browser.launch(_P()) == ("cdp", "http://127.0.0.1:19333")


def test_the_log_verdict():
    assert verdict("buttons ['Edit']\nerrs []\n")[0] == 0
    assert verdict("errs ['pageerror boom']\n")[0] == 1
    assert verdict("state {'failed': 'slow_gpu', 'x': 1}\n")[0] == 1
    assert verdict("state {'failed': None}\nerrs []\n")[0] == 0
    assert verdict("didn't start: Live Aboard says slow_gpu\n", 2)[0] == 2   # worth another try
    assert verdict("Traceback (most recent call last):\n  ...\n")[0] == 2
    assert verdict("errs ['GL Driver Message (OpenGL, Performance)']\n")[0] == 0   # driver noise


def test_no_house_in_the_public_tools():
    """The live check prints a house's map names; the tools themselves carry
    no address, token or local path of one (the repo is public)."""
    offenders = []
    for p in _TOOLS.rglob("*.py"):
        text = p.read_text(encoding="utf-8")
        for pat in (r"\b192\.168\.\d+\.\d+", r"\beyJ[A-Za-z0-9_-]{20,}", r"/Users/[a-z]+/", r"C:\\\\Users\\\\"):
            if re.search(pat, text):
                offenders.append(f"{p.name}: {pat}")
    assert not offenders, offenders
