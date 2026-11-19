# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""scripts/release.py stops before anything is built when the integration
folder holds a file git does not track.

The zip is built from the disk (build_zip, INTEGRATION.rglob) and the release
commit stages every file under the integration folder (git_commit_tag_push),
while `git pull --ff-only` is happy with untracked files around. So a stray
local file in custom_components/padspan_ha/ would have shipped to every
install and been committed with the release.
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")


def _load():
    spec = importlib.util.spec_from_file_location("release_untracked", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load() if _RELEASE_PY.is_file() else None


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.mark.skipif(not shutil.which("git"), reason="needs git")
def test_untracked_files_in_the_integration_folder_are_found(tmp_path, monkeypatch):
    integ = tmp_path / "custom_components" / "padspan_ha"
    (integ / "www").mkdir(parents=True)
    (integ / "manifest.json").write_text("{}", encoding="utf-8")
    (tmp_path / ".gitignore").write_text("__pycache__/\n", encoding="utf-8")
    _git(tmp_path, "init", "-q")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", "x")
    monkeypatch.setattr(R, "ROOT", tmp_path)
    monkeypatch.setattr(R, "INTEGRATION", integ)
    assert R.untracked_integration_files() == []
    (integ / "__pycache__").mkdir()
    (integ / "__pycache__" / "x.pyc").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("outside the integration", encoding="utf-8")
    assert R.untracked_integration_files() == [], "ignored files and files elsewhere are not the zip's"
    (integ / "www" / "stray.js").write_text("//", encoding="utf-8")
    (integ / "manifest.json").write_text('{"changed": 1}', encoding="utf-8")
    assert R.untracked_integration_files() == ["custom_components/padspan_ha/www/stray.js"], \
        "a modified tracked file is the release's own business; only the untracked one"


def test_the_preflight_stops_the_release_on_an_untracked_file(monkeypatch, capsys):
    monkeypatch.setattr(R, "colo_host_problem", lambda *a, **k: None)
    monkeypatch.setattr(R, "untracked_integration_files", lambda: ["custom_components/padspan_ha/stray.py"])
    with pytest.raises(SystemExit):
        R.preflight_checks()
    out = capsys.readouterr().out
    assert "custom_components/padspan_ha/stray.py" in out and "PREFLIGHT FAILED" in out


def test_the_check_runs_before_anything_is_changed_or_zipped():
    src = _RELEASE_PY.read_text(encoding="utf-8")
    main = src[src.index("def main():"):]
    assert main.index("preflight_checks()") < main.index("gather_notes(version)") < main.index("build_zip()")
    pre = src[src.index("def preflight_checks():"):src.index("def run_tests():")]
    assert "untracked_integration_files()" in pre
