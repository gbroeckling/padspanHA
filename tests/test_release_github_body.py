# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The GitHub release's notes are what HACS and the Home Assistant Marketplace
show in the update dialog. They said "Release v0.38.x" and an ad; they now
carry the CHANGELOG.md sections (a beta its own, a stable every section since
the last stable), how to update, and the footer, with each note's "thanks
@name (#123)" as written. The fallback path makes the release a draft and
publishes it only once the zip is on it."""

from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")


def _load():
    spec = importlib.util.spec_from_file_location("release_github_body", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load() if _RELEASE_PY.is_file() else None

CHANGELOG = """# Changelog

## 1.0.4 — Four (2026-11-04)

### New
- **Four.** Thanks @reporter (#44).

### Fixed
- Four fixed.

---

## 1.0.3 — Three (2026-11-03)

### Fixed
- Three.

---

## 1.0.2 — Two, the last stable (2026-11-02)

### Fixed
- Two.

---

## 1.0.1 — One (2026-11-01)

### Fixed
- One.
"""


def _secs(version, channel, since=None, changelog=CHANGELOG):
    return R.release_notes_sections(version, channel, changelog, since)


def test_a_beta_carries_its_own_section():
    body = R.release_body("v1.0.4", "beta", _secs("1.0.4", "beta"))
    assert body.startswith("## PadSpan HA v1.0.4 (BETA)\n\n### 1.0.4 — Four (2026-11-04)\n\n#### New\n- **Four.**")
    assert "#### Fixed\n- Four fixed." in body, "the note's headings sit under the version's own"
    assert "Three" not in body and "Release v1.0.4" not in body
    assert R.RELEASE_HOW_TO_UPDATE in body and R.RELEASE_HOW_TO_UPDATE_BETA in body
    assert body.endswith(R.RELEASE_NOTES_FOOTER)
    assert body.index("### How to update") < body.index("### PadSpan Pro free")


def test_a_stable_carries_every_section_since_the_last_stable():
    body = R.release_body("v1.0.4", "stable", _secs("1.0.4", "stable", since="1.0.2"), since="1.0.2")
    assert body.startswith("## PadSpan HA v1.0.4 (STABLE)")
    assert "Everything since the last stable release, v1.0.2, newest first." in body
    assert body.index("### 1.0.4 — Four") < body.index("### 1.0.3 — Three")
    assert "1.0.2 —" not in body and "1.0.1 —" not in body, "the last stable's own notes went out with it"
    assert R.RELEASE_HOW_TO_UPDATE_BETA not in body
    assert body.endswith(R.RELEASE_HOW_TO_UPDATE + R.RELEASE_NOTES_FOOTER)


def test_a_stable_whose_last_stable_is_unknown_carries_its_own_section():
    assert [s["version"] for s in _secs("1.0.4", "stable", since=None)] == ["1.0.4"]
    assert [s["version"] for s in _secs("1.0.4", "stable", since="1.0.4")] == ["1.0.4"], "never nothing"


def test_a_reporters_thanks_comes_through_from_the_note_to_the_dialog():
    note = "# Floor plans keep their scale\n\n### Fixed\n- **Floor plans keep their scale.** Thanks @someone (#123).\n"
    changelog = R.changelog_from_notes(CHANGELOG, [note], "1.0.5", "2026-11-05")
    body = R.release_body("v1.0.5", "beta", _secs("1.0.5", "beta", changelog=changelog))
    assert "- **Floor plans keep their scale.** Thanks @someone (#123)." in body


def test_the_notes_say_how_to_credit_a_reporter():
    readme = (_ROOT / "changelog.d" / "README.md").read_text(encoding="utf-8")
    assert "thanks @name (#123)" in readme and "only for a real GitHub login" in readme


def test_no_section_says_what_it_did_before():
    assert R.release_body("v9.9.9", "beta", []).startswith("## PadSpan HA v9.9.9 (BETA)\n\nRelease v9.9.9\n\n### How to update")
    body = R.release_body("v9.9.9", "beta", _secs("1.0.4", "beta"), message="A message")
    assert body.startswith("## PadSpan HA v9.9.9 (BETA)\n\nA message\n\n### 1.0.4")


def test_a_long_run_of_betas_is_cut_at_whole_sections_under_githubs_limit(monkeypatch):
    big = "".join(f"## 2.0.{n} — Big {n} (2026-11-01)\n\n### Fixed\n- {'x' * 30000}\n\n---\n\n" for n in range(9, 0, -1))
    secs = _secs("2.0.9", "stable", since="2.0.0", changelog="# Changelog\n\n" + big)
    assert len(secs) == 9
    body = R.release_body("v2.0.9", "stable", secs, since="2.0.0")
    assert len(body) <= R.RELEASE_BODY_MAX < 125_000
    shown = re.findall(r"^### (2\.0\.\d+) ", body, re.MULTILINE)
    assert shown and shown[0] == "2.0.9" and len(shown) < 9
    assert f"The changes before v{shown[-1]} are in [CHANGELOG.md]({R.CHANGELOG_URL})." in body
    assert body.endswith(R.RELEASE_NOTES_FOOTER)


def test_the_last_stable_is_read_from_githubs_releases():
    rels = [{"tagName": "v1.0.4", "isPrerelease": True, "isDraft": False},
            {"tagName": "v1.0.3", "isPrerelease": False, "isDraft": True},
            {"tagName": "v1.0.2", "isPrerelease": False, "isDraft": False},
            {"tagName": "v1.0.10", "isPrerelease": False, "isDraft": False},
            {"tagName": "bright-v9.9.9", "isPrerelease": False, "isDraft": False}]
    ok = lambda c: SimpleNamespace(returncode=0, stdout=json.dumps(rels))
    assert R.last_stable_release(run_=ok) == "1.0.10"
    assert R.last_stable_release(run_=lambda c: SimpleNamespace(returncode=1, stdout="")) is None
    assert R.last_stable_release(run_=lambda c: SimpleNamespace(returncode=0, stdout="not json")) is None


# ── create_github_release ──────────────────────────────────────────────────

def _gh(monkeypatch, tmp_path, answers, stable_since="1.0.2"):
    """A fake shell: answers[i](cmd) -> (returncode, stdout) by the command's
    start, records every command and the notes each one sent."""
    (tmp_path / "CHANGELOG.md").write_text(CHANGELOG, encoding="utf-8")
    monkeypatch.setattr(R, "ROOT", tmp_path)
    monkeypatch.setattr(R, "last_stable_release", lambda *a, **k: stable_since)
    calls, notes = [], {}

    def run_(cmd):
        calls.append(cmd)
        m = re.search(r'--notes-file "([^"]+)"|"body=@([^"]+)"', cmd)
        if m:
            notes[len(calls) - 1] = Path(m.group(1) or m.group(2)).read_text(encoding="utf-8")
        for start, answer in answers:
            if cmd.startswith(start):
                rc, out = answer(cmd) if callable(answer) else answer
                return SimpleNamespace(returncode=rc, stdout=out)
        raise AssertionError(f"unexpected command: {cmd}")
    return calls, notes, run_


def test_the_one_shot_release_carries_the_notes(monkeypatch, tmp_path):
    calls, notes, run_ = _gh(monkeypatch, tmp_path, [("gh release create", (0, ""))])
    R.create_github_release("v1.0.4", "stable", run_=run_, sleep=lambda s: None)
    assert len(calls) == 1 and "--prerelease" not in calls[0]
    assert "### 1.0.3 — Three" in notes[0] and "Thanks @reporter (#44)." in notes[0]


def test_the_fallback_publishes_only_once_the_zip_is_on_the_draft(monkeypatch, tmp_path):
    calls, notes, run_ = _gh(monkeypatch, tmp_path, [
        ("gh release create", (1, "")),
        ("gh api repos/gbroeckling/padspanHA/releases -f", (0, "4242\n")),
        ("gh release upload", (0, "")),
        ("gh api repos/gbroeckling/padspanHA/releases/4242 --jq", (0, '["padspan_ha.zip"]')),
        ("gh api -X PATCH", (0, "false")),
    ])
    R.create_github_release("v1.0.4", "beta", run_=run_, sleep=lambda s: None)
    create = next(c for c in calls if c.startswith("gh api repos/gbroeckling/padspanHA/releases -f"))
    assert "-F draft=true" in create and "-F prerelease=true" in create and '-F "body=@' in create
    assert 'body="v1.0.4"' not in create, "the notes, not just the tag"
    assert "Thanks @reporter (#44)." in notes[calls.index(create)]
    order = [c.split(" --")[0][:40] for c in calls]
    i = {k: next(n for n, c in enumerate(calls) if c.startswith(k)) for k in
         ("gh release upload", "gh api repos/gbroeckling/padspanHA/releases/4242", "gh api -X PATCH")}
    assert i["gh release upload"] < i["gh api repos/gbroeckling/padspanHA/releases/4242"] < i["gh api -X PATCH"], order
    assert "releases/4242 -F draft=false" in calls[i["gh api -X PATCH"]]


def test_a_draft_without_its_zip_is_never_published(monkeypatch, tmp_path, capsys):
    calls, _, run_ = _gh(monkeypatch, tmp_path, [
        ("gh release create", (1, "")),
        ("gh api repos/gbroeckling/padspanHA/releases -f", (0, "4242")),
        ("gh release upload", (0, "")),                                   # says yes...
        ("gh api repos/gbroeckling/padspanHA/releases/4242 --jq", (0, "[]")),  # ...but no zip on the draft
    ])
    with pytest.raises(SystemExit):
        R.create_github_release("v1.0.4", "beta", run_=run_, sleep=lambda s: None)
    assert not any(c.startswith("gh api -X PATCH") for c in calls)
    assert sum(c.startswith("gh release upload") for c in calls) == 3
    assert "DRAFT" in capsys.readouterr().out


def test_the_notes_file_is_removed_after(monkeypatch, tmp_path):
    seen = []
    calls, notes, run_ = _gh(monkeypatch, tmp_path, [("gh release create", lambda c: (seen.append(
        re.search(r'--notes-file "([^"]+)"', c).group(1)) or 0, ""))])
    R.create_github_release("v1.0.4", "beta", run_=run_, sleep=lambda s: None)
    assert seen and not Path(seen[0]).exists()
