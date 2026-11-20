# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The release zip is built and attached, never committed.

dist/padspan_ha.zip is what HACS downloads, and it downloads it from the
GitHub release (hacs.json: zip_release), not from the repository. Kept in git
it grew the history by its whole size at every release and was the one file
two releases could never merge. So scripts/release.py builds it, hands that
same file to `gh release create`, and git ignores it.

What must hold for a release to go on working:
- the release builds the zip before it creates the GitHub release, and the
  file it uploads is the file it built;
- nothing the release stages by name is ignored: `git add` refuses a named
  path that is ignored, and the release would stop at its commit.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")
_ZIP = "dist/padspan_ha.zip"


def _load():
    spec = importlib.util.spec_from_file_location("release_zip", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load() if _RELEASE_PY.is_file() else None
_in_git = pytest.mark.skipif(not shutil.which("git") or not (_ROOT / ".git").exists(), reason="needs a git checkout")


def _git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=_ROOT, capture_output=True, text=True)


def test_the_zip_is_where_hacs_json_says_and_not_in_the_release_commit() -> None:
    assert R.ZIP_PATH.relative_to(R.ROOT).as_posix() == _ZIP
    assert not [f for f in R.STATIC_FILES if f.startswith("dist")], "the release commit would stage the zip again"


@_in_git
def test_git_ignores_the_zip_and_does_not_track_it() -> None:
    assert _git("ls-files", "--", "dist").stdout.strip() == "", "dist/ holds only what a release builds"
    assert _git("check-ignore", "-q", _ZIP).returncode == 0, f"{_ZIP} is not in .gitignore"


@_in_git
def test_nothing_the_release_stages_by_name_is_ignored() -> None:
    ignored = [f for f in R.STATIC_FILES if _git("check-ignore", "-q", f).returncode == 0]
    assert ignored == [], f"git add refuses these and the release stops at its commit: {ignored}"


def test_the_release_commit_stages_no_zip(monkeypatch) -> None:
    staged = []

    def run_ok(cmd, check=True):
        if "--pathspec-from-file" in cmd:
            staged.extend(Path(cmd.split('"')[1]).read_text(encoding="utf-8").split())
        return ""

    monkeypatch.setattr(R, "run_ok", run_ok)
    monkeypatch.setattr(R, "run", lambda *a, **k: SimpleNamespace(returncode=0, stdout=""))
    R.git_commit_tag_push("9.9.9", "v9.9.9")
    assert "hacs.json" in staged and "custom_components/padspan_ha/manifest.json" in staged
    assert not [f for f in staged if f.endswith(".zip")], "a zip in the release commit"


def test_the_github_release_gets_the_zip_the_release_just_built(tmp_path, monkeypatch) -> None:
    """The whole path with nothing real but the zip: a checkout with no dist/
    folder (a fresh clone has none now), main() run to the end, and the file
    `gh release create` is handed read back at that moment."""
    monkeypatch.setattr(R, "ZIP_PATH", tmp_path / "dist" / "padspan_ha.zip")
    order, uploaded = [], {}
    for name in ("preflight_checks", "run_tests", "update_version_files", "write_panel_notes",
                 "git_commit_tag_push", "bright_pass"):
        monkeypatch.setattr(R, name, lambda *a, _n=name, **k: order.append(_n))
    for name in ("build_zip", "validate_zip"):
        monkeypatch.setattr(R, name, lambda *a, _n=name, _f=getattr(R, name), **k: (order.append(_n), _f())[1])
    monkeypatch.setattr(R, "update_whatsnew_entry", lambda *a, **k: True)
    monkeypatch.setattr(R, "publish_update_manifest", lambda *a, **k: True)
    monkeypatch.setattr(R, "last_stable_release", lambda *a, **k: None)
    # Nothing real: no lock, no fetch or pull, no look for a draft left behind,
    # no tags read, no wait for GitHub, no publishing of the draft.
    for name, val in (("acquire_release_lock", "lock"), ("release_release_lock", None), ("sync_with_origin", None),
                      ("stop_for_unpublished_draft", None), ("_tags", set()), ("gather_notes", None), ("wait_for_ci", True),
                      ("publish_github_release", None)):
        monkeypatch.setattr(R, name, lambda *a, _v=val, **k: _v)

    def run(cmd, check=True):
        assert cmd.startswith("gh release create v9.9.9 "), f"unexpected command: {cmd}"
        order.append("gh release create")
        path = Path(cmd.split('"')[1])
        with zipfile.ZipFile(path) as zf:
            uploaded.update(path=path, names=set(zf.namelist()))
        return SimpleNamespace(returncode=0, stdout="")

    monkeypatch.setattr(R, "run", run)
    monkeypatch.setattr(sys, "argv", ["release.py", "9.9.9", "--no-bright"])
    R.main()
    assert order.index("build_zip") < order.index("validate_zip") < order.index("git_commit_tag_push") < order.index("gh release create"), order
    assert uploaded["path"] == tmp_path / "dist" / "padspan_ha.zip"
    assert {"manifest.json", "__init__.py", "www/padspan-ha/panel.js"} <= uploaded["names"]
