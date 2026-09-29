# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""scripts/release.py writes the panel's release notes (assets/whatsnew.json).

Garry, 2026-09-28: "release notes screen has no way to close on touch
monitor". The notes now open inside the panel, from a file shipped with the
integration so they work offline. The release writes it from CHANGELOG.md —
the newest six "## X.Y.Z — title (date)" sections — before the zip is built,
so the zip and the release commit both carry it. A release that forgot it
would ship the previous release's notes under the new version's banner.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import zipfile
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"

# Release tooling does not travel into the derived Bright tree (bright_build.py
# COPY has no "scripts"), but tests/ does: skip there, as the other release
# tests do.
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")


def _load():
    spec = importlib.util.spec_from_file_location("release_panel_notes", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load() if _RELEASE_PY.is_file() else None

_FAKE = """# Changelog

---

## 0.99.8 — Older, filed out of order (2026-09-01)

- Older.

---

## 0.99.10 — The newest (2026-09-12)

### Atlas — Test
- **Added:** a `thing`.
  - **Start:** nested.

---

## 0.99.9 / 0.99.10 — stable promotions (2026-09-11)

- Not a single release: skipped.

## 0.99.9 — The middle one (2026-09-10)

Some prose.

## 0.4.x — Foundation (2026-02)

- Skipped too.
"""


def test_sections_are_parsed_from_the_changelog_shape_newest_first() -> None:
    s = R.changelog_sections(_FAKE)
    assert [n["version"] for n in s] == ["0.99.10", "0.99.9", "0.99.8"], "numeric order, newest first"
    top = s[0]
    assert set(top) == {"version", "title", "date", "body_markdown"}
    assert top["title"] == "The newest" and top["date"] == "2026-09-12"
    assert top["body_markdown"] == "### Atlas — Test\n- **Added:** a `thing`.\n  - **Start:** nested.", (
        "the body must stop before the separator and the next section: " + repr(top["body_markdown"]))
    assert s[1]["body_markdown"] == "Some prose.", "ran into the '0.4.x' section: " + repr(s[1]["body_markdown"])
    assert s[2]["body_markdown"] == "- Older."


def test_the_real_changelog_gives_the_newest_six() -> None:
    text = (_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    s = R.changelog_sections(text)
    first = next(ln for ln in text.splitlines() if ln.startswith("## "))
    assert first.startswith(f"## {s[0]['version']} "), f"the newest section is {first!r}, parsed {s[0]['version']}"
    assert len(s) > R.PANEL_NOTES_COUNT == 6
    vs = [tuple(map(int, n["version"].split("."))) for n in s]
    assert vs == sorted(vs, reverse=True)
    for n in s[:6]:
        assert n["title"] and n["body_markdown"] and not n["body_markdown"].endswith("---"), n["version"]
        assert "\n## " not in n["body_markdown"], n["version"]


def test_write_panel_notes_writes_the_newest_six(tmp_path, monkeypatch) -> None:
    (tmp_path / "CHANGELOG.md").write_text(
        "".join(f"## 1.0.{i} — Release {i} (2026-09-{i + 10:02d})\n\n- Change {i}.\n\n---\n\n" for i in range(9)),
        encoding="utf-8")
    out = tmp_path / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "assets" / "whatsnew.json"
    monkeypatch.setattr(R, "ROOT", tmp_path)
    monkeypatch.setattr(R, "PANEL_NOTES", out)
    R.write_panel_notes()
    notes = json.loads(out.read_text(encoding="utf-8"))
    assert [n["version"] for n in notes] == [f"1.0.{i}" for i in (8, 7, 6, 5, 4, 3)]
    assert notes[0] == {"version": "1.0.8", "title": "Release 8", "date": "2026-09-18", "body_markdown": "- Change 8."}
    assert b"\r\n" not in out.read_bytes()


def test_write_panel_notes_refuses_a_changelog_with_no_sections(tmp_path, monkeypatch) -> None:
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n\nnothing here\n", encoding="utf-8")
    out = tmp_path / "whatsnew.json"
    monkeypatch.setattr(R, "ROOT", tmp_path)
    monkeypatch.setattr(R, "PANEL_NOTES", out)
    with pytest.raises(SystemExit):
        R.write_panel_notes()
    assert not out.exists()


def test_the_release_writes_the_notes_before_it_zips_and_commits(monkeypatch) -> None:
    calls = []
    for name in ("preflight_checks", "run_tests", "update_version_files", "write_panel_notes",
                 "build_zip", "validate_zip", "git_commit_tag_push", "create_github_release", "bright_pass"):
        monkeypatch.setattr(R, name, lambda *a, _n=name, **k: calls.append(_n))
    monkeypatch.setattr(R, "update_whatsnew_entry", lambda *a, **k: calls.append("update_whatsnew_entry") or True)
    monkeypatch.setattr(R, "publish_update_manifest", lambda *a, **k: True)
    monkeypatch.setattr(sys, "argv", ["release.py", "9.9.9", "--no-bright"])
    R.main()
    assert "write_panel_notes" in calls, "the release never writes the panel's notes"
    i = calls.index
    assert i("update_version_files") < i("write_panel_notes") < i("build_zip") < i("git_commit_tag_push"), calls


def test_the_notes_file_is_in_the_zip_and_the_release_commit(tmp_path, monkeypatch) -> None:
    rel = R.PANEL_NOTES.relative_to(R.ROOT).as_posix()
    assert rel == "custom_components/padspan_ha/www/padspan-ha/assets/whatsnew.json"
    assert R.PANEL_NOTES.is_file(), "generate it: the panel fetches this file"

    monkeypatch.setattr(R, "ZIP_PATH", tmp_path / "padspan_ha.zip")
    R.build_zip()
    assert "www/padspan-ha/assets/whatsnew.json" in zipfile.ZipFile(tmp_path / "padspan_ha.zip").namelist()

    staged = []

    def run_ok(cmd, check=True):
        if "--pathspec-from-file" in cmd:
            staged.extend(Path(cmd.split('"')[1]).read_text(encoding="utf-8").split())
        return ""

    class _Ok:
        returncode = 0
        stdout = ""

    monkeypatch.setattr(R, "run_ok", run_ok)
    monkeypatch.setattr(R, "run", lambda *a, **k: _Ok())
    R.git_commit_tag_push("9.9.9", "v9.9.9")
    assert rel in staged, "the release commit would leave the notes behind"
