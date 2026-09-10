# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""scripts/release.py's #whatsnew auto-generation.

Garry, 2026-09-10: GitHub #72 — the landing page's What's New section is
hand-authored prose, and nothing ever forced anyone to update it. 25
releases (v0.38.7 through v0.38.31) shipped with the page never mentioning
any of them. This generates one entry per release straight from that
release's own CHANGELOG.md section (which is already written before
release.py runs, by established convention) and prepends it to
site/index.html, so there is no longer a step a human can forget.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"

# scripts/release.py is PadSpan HA release tooling — bright_build.py's COPY
# list deliberately does not carry "scripts" into the derived Bright tree,
# but it does carry "tests", so this file gets collected there too. Skip
# rather than crash: there is nothing to test without the module it tests.
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")


def _load_release_module():
    spec = importlib.util.spec_from_file_location("release", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["release"] = mod
    spec.loader.exec_module(mod)
    return mod


_release = _load_release_module() if _RELEASE_PY.is_file() else None

_CHANGELOG = """## 0.99.9 — A fake release for the test suite (2026-09-10)

### Something changed
- **Added:** a `thing` that does **something** useful, see [the docs](https://example.com/docs).
- **Fixed:** a bug that broke another thing.

---

## 0.99.8 — An older fake release (2026-09-01)

- Nothing interesting.
"""

_SITE_HTML = """<section class="wrap" id="whatsnew">
  <div class="rel" style="margin-top:26px">

    <div class="relitem">
      <div class="relhead"><span class="relver">v0.99.8</span></div>
    </div>

  </div>
</section>
"""


def _make_repo(tmp_path):
    (tmp_path / "CHANGELOG.md").write_text(_CHANGELOG, encoding="utf-8")
    site_dir = tmp_path / "site"
    site_dir.mkdir()
    (site_dir / "index.html").write_text(_SITE_HTML, encoding="utf-8")
    return tmp_path


def test_changelog_section_extracts_title_date_and_body(tmp_path):
    orig_root = _release.ROOT
    _release.ROOT = _make_repo(tmp_path)
    try:
        section = _release._changelog_section("0.99.9")
        assert section is not None
        title, date, body = section
        assert title == "A fake release for the test suite"
        assert date == "2026-09-10"
        assert "0.99.8" not in body, "must stop at the next '## ' header, not run to EOF"
        assert "a `thing` that does" in body
    finally:
        _release.ROOT = orig_root


def test_changelog_section_returns_none_for_a_missing_version(tmp_path):
    orig_root = _release.ROOT
    _release.ROOT = _make_repo(tmp_path)
    try:
        assert _release._changelog_section("1.2.3") is None
    finally:
        _release.ROOT = orig_root


def test_md_inline_to_html_converts_bold_code_and_links():
    out = _release._md_inline_to_html("**Added:** a `thing` and a [link](https://example.com)")
    assert out == '<b>Added:</b> a <code>thing</code> and a <a href="https://example.com">link</a>'


def test_update_whatsnew_entry_prepends_the_new_release_above_the_old_one(tmp_path):
    orig_root = _release.ROOT
    _release.ROOT = _make_repo(tmp_path)
    try:
        ok = _release.update_whatsnew_entry("0.99.9", "beta")
        assert ok is True
        html = (_release.ROOT / "site" / "index.html").read_text(encoding="utf-8")
        assert html.index('<span class="relver">v0.99.9</span>') < \
            html.index('<span class="relver">v0.99.8</span>'), \
            "the new release must be prepended, newest first"
        assert '<span class="pill soon">Beta channel</span>' in html
        assert "<li><b>Added:</b>" in html
        assert "<li><b>Fixed:</b>" in html
    finally:
        _release.ROOT = orig_root


def test_update_whatsnew_entry_uses_the_stable_pill_on_a_stable_release(tmp_path):
    orig_root = _release.ROOT
    _release.ROOT = _make_repo(tmp_path)
    try:
        _release.update_whatsnew_entry("0.99.9", "stable")
        html = (_release.ROOT / "site" / "index.html").read_text(encoding="utf-8")
        assert '<span class="pill stable">Stable</span>' in html
    finally:
        _release.ROOT = orig_root


def test_update_whatsnew_entry_is_idempotent(tmp_path):
    """A --manifest-only re-run, or re-running release.py after a failure
    later in the pipeline, must not duplicate the entry."""
    orig_root = _release.ROOT
    _release.ROOT = _make_repo(tmp_path)
    try:
        _release.update_whatsnew_entry("0.99.9", "beta")
        html_once = (_release.ROOT / "site" / "index.html").read_text(encoding="utf-8")
        ok = _release.update_whatsnew_entry("0.99.9", "beta")
        html_twice = (_release.ROOT / "site" / "index.html").read_text(encoding="utf-8")
        assert ok is True
        assert html_once == html_twice
        assert html_twice.count('<span class="relver">v0.99.9</span>') == 1
    finally:
        _release.ROOT = orig_root


def test_update_whatsnew_entry_fails_loudly_when_changelog_has_no_section(tmp_path):
    """The whole point of this generator is that whatsnew can no longer
    silently fall behind — a missing CHANGELOG section must report failure,
    not skip quietly and leave the page as it was."""
    orig_root = _release.ROOT
    _release.ROOT = _make_repo(tmp_path)
    try:
        ok = _release.update_whatsnew_entry("1.2.3", "beta")
        assert ok is False
        html = (_release.ROOT / "site" / "index.html").read_text(encoding="utf-8")
        assert html == _SITE_HTML, "a failed lookup must not touch the file"
    finally:
        _release.ROOT = orig_root
