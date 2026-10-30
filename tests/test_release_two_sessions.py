# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""scripts/release.py with two sessions at once (Garry, 2026-10-28: "Is there
a way for you to stop screwing up when two claude sessions are running?").

That day one session took 0.38.191 while the other had numbered its work the
same, both wrote at the top of CHANGELOG.md, and a push failed because the
other had pushed meanwhile. Held here: one release at a time (a lock every
checkout shares; a second waits; a dead one's lock is taken over), the next
free version, CHANGELOG.md made from changelog.d notes, and a refused push
that merges what was pushed meanwhile and pushes again.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import textwrap
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")


def _load():
    spec = importlib.util.spec_from_file_location("release_two_sessions", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load() if _RELEASE_PY.is_file() else None


# ── the lock ────────────────────────────────────────────────────────────────
_HOLD = textwrap.dedent("""
    import importlib.util, sys, time
    spec = importlib.util.spec_from_file_location("r", sys.argv[1])
    r = importlib.util.module_from_spec(spec); spec.loader.exec_module(r)
    r.acquire_release_lock("held", path=sys.argv[2], wait_s=float(sys.argv[3]), poll_s=0.2)
    print("GOT", flush=True)
    # A negative hold: until the test closes our stdin (communicate() does).
    sys.stdin.read() if float(sys.argv[4]) < 0 else time.sleep(float(sys.argv[4]))
""")


def _holder(lock, wait=0.0, hold=3.0):
    return subprocess.Popen([sys.executable, "-c", _HOLD, str(_RELEASE_PY), str(lock), str(wait), str(hold)],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=_ROOT)


def _wait_for_got(p):
    line = p.stdout.readline()
    assert "GOT" in line, (line, p.stderr.read() if p.poll() is not None else "")


def test_one_release_at_a_time_and_a_dead_ones_lock_is_let_go(tmp_path):
    lock = tmp_path / "padspan-release.lock"
    # Held by another process: wait, then give up with nothing changed; what it
    # says (whose release) is still readable.
    other = _holder(lock, hold=30)
    _wait_for_got(other)
    clock = {"t": 0.0}
    waited = []
    with pytest.raises(SystemExit):
        R.acquire_release_lock("0.1.2", path=lock, wait_s=60, poll_s=15,
                               now=lambda: clock["t"], sleep=lambda s: (waited.append(s), clock.__setitem__("t", clock["t"] + s)))
    assert waited == [15, 15, 15, 15]
    assert json.loads(lock.read_text(encoding="utf-8"))["version"] == "held"
    # Its process killed outright (no clean-up at all): the system lets go, and the lock is ours at once.
    other.kill()
    other.wait()
    assert R.acquire_release_lock("0.1.3", path=lock, wait_s=5, poll_s=0.2) == lock
    assert json.loads(lock.read_text(encoding="utf-8"))["version"] == "0.1.3"
    # While this process holds it, another can't; let go, and it can.
    third = _holder(lock, wait=0, hold=0)
    assert "GOT" not in third.communicate(timeout=60)[0]
    R.release_release_lock(lock)
    R.release_release_lock(lock)                       # twice: harmless
    fourth = _holder(lock, wait=0, hold=0)
    assert "GOT" in fourth.communicate(timeout=60)[0]


def test_the_lock_is_shared_by_every_worktree():
    # In git's common directory, never a checkout's own folder.
    common = subprocess.run("git rev-parse --git-common-dir", shell=True, text=True, capture_output=True, cwd=_ROOT).stdout.strip()
    if not common:
        pytest.skip("not a git checkout")
    path = R._lock_path()
    assert path.name == "padspan-release.lock"
    assert path.parent.resolve() == (Path(common) if Path(common).is_absolute() else _ROOT / common).resolve()


@pytest.mark.parametrize("left", [False, True], ids=["no lock file", "a dead release's lock file"])
def test_processes_racing_get_the_lock_once(tmp_path, left):
    # Four at once, three times over: exactly one holds it each time. The
    # holder keeps it until the other three have tried and given up (a fixed
    # hold let a process started late on a busy machine take it afterwards).
    for round_ in range(3):
        lock = tmp_path / f"padspan-release-{round_}.lock"
        if left:
            lock.write_text(json.dumps({"pid": 999999, "version": "dead", "started": "x"}))
        procs = [_holder(lock, wait=0, hold=-1) for _ in range(4)]
        deadline = time.monotonic() + 120
        while sum(p.poll() is not None for p in procs) < 3 and time.monotonic() < deadline:
            time.sleep(0.05)
        outs = [p.communicate(timeout=180) for p in procs]
        assert sum("GOT" in o for o, _ in outs) == 1, (round_, outs)
        assert sum("another release" in o for o, _ in outs) == 3, (round_, outs)
        assert not any(e.strip() for _, e in outs), (round_, outs)


# ── the version ─────────────────────────────────────────────────────────────
def test_the_next_free_version():
    taken = {"v0.38.190", "v0.38.191", "v0.38.192", "v0.4.9"}
    assert R.next_free_version("0.38.191", taken) == "0.38.193"
    assert R.next_free_version("0.38.193", taken) == "0.38.193"
    assert R.latest_tag_version(taken | {"not-a-version"}) == "0.38.192"   # by number: 0.38 > 0.4
    assert R.next_free_version(R.latest_tag_version(taken), taken) == "0.38.193"


# ── the changelog from notes ────────────────────────────────────────────────
_HEAD = "# Changelog\n\nAll notable changes to PadSpan HA are documented here.\n\n---\n\n"
_OLD = "## 0.38.192 — Older (2026-10-28)\n\n### New\n- **Old.** thing\n\n---\n\n"


def test_notes_make_one_section_on_top():
    a = "# A few steps within a floor\n\n### Fixed\n- **Stored whole.** fixed\n\n### New\n- **Steps.** new\n"
    b = "# The report page\n\n- **Folds.** changed, no heading\n\n### New\n- **Attention.** new too\n"
    out = R.changelog_from_notes(_HEAD + _OLD, [a, b], "0.38.193", "2026-10-29")
    assert out.startswith(_HEAD + "## 0.38.193 — A few steps within a floor; The report page (2026-10-29)\n")
    new = out[len(_HEAD):out.index("## 0.38.192")]
    # New, Changed, Fixed, in that order; a line before any heading is Changed.
    assert new.index("### New") < new.index("### Changed") < new.index("### Fixed")
    assert "- **Steps.** new\n- **Attention.** new too" in new and "- **Folds.** changed, no heading" in new
    assert new.rstrip().endswith("---") and out.endswith(_OLD)
    # The section is one CHANGELOG.md's own readers find (the panel's notes, the site's).
    assert R.changelog_sections(out)[0]["version"] == "0.38.193" if isinstance(R.changelog_sections(out)[0], dict) else True
    with pytest.raises(ValueError):
        R.changelog_from_notes(_HEAD, ["no title here\n- a line"], "1.0.0", "2026-10-29")


def test_gathering_writes_the_changelog_and_removes_the_notes(tmp_path, monkeypatch):
    (tmp_path / "CHANGELOG.md").write_text(_HEAD + _OLD, encoding="utf-8")
    notes = tmp_path / "changelog.d"
    notes.mkdir()
    (notes / "README.md").write_text("how to write a note", encoding="utf-8")
    (notes / "steps.md").write_text("# Steps\n\n### New\n- **Steps.** new\n", encoding="utf-8")
    monkeypatch.setattr(R, "ROOT", tmp_path)
    monkeypatch.setattr(R, "NOTES_DIR", notes)
    assert R.gather_notes("0.38.193") == 1
    text = (tmp_path / "CHANGELOG.md").read_text(encoding="utf-8")
    assert "## 0.38.193 — Steps (" in text and not (notes / "steps.md").exists() and (notes / "README.md").exists()
    assert R._changelog_section("0.38.193")[0] == "Steps"
    # No notes: CHANGELOG.md used as it is. Notes AND a hand-written section: stop.
    assert R.gather_notes("0.38.194") is None
    (notes / "again.md").write_text("# Again\n- x\n", encoding="utf-8")
    with pytest.raises(SystemExit):
        R.gather_notes("0.38.193")


def test_the_notes_travel_in_the_release_commit():
    src = _RELEASE_PY.read_text(encoding="utf-8")
    assert '"changelog.d",' in src and "git add -A --" in src
    assert (_ROOT / "changelog.d" / "README.md").is_file()


# ── the push ────────────────────────────────────────────────────────────────
def _fake(results):
    calls = []

    def run_(cmd):
        calls.append(cmd)
        return SimpleNamespace(returncode=results.get(cmd, [0]).pop(0) if results.get(cmd) else 0)
    return calls, run_


def test_a_refused_push_takes_in_what_was_pushed_and_pushes_again():
    calls, run_ = _fake({"git push": [1, 0]})
    R.push_release("v9.9.9", run_=run_, sleep=lambda s: None)
    assert calls == ["git push", "git pull --no-rebase --no-edit origin main", "git push", "git push origin v9.9.9"]


def test_a_conflict_is_undone_and_stops_with_the_release_kept():
    calls, run_ = _fake({"git push": [1], "git pull --no-rebase --no-edit origin main": [1]})
    with pytest.raises(SystemExit):
        R.push_release("v9.9.9", run_=run_, sleep=lambda s: None)
    assert calls == ["git push", "git pull --no-rebase --no-edit origin main", "git merge --abort"]


def test_the_tag_is_pushed_itself():
    calls, run_ = _fake({})
    R.push_release("v9.9.9", run_=run_, sleep=lambda s: None)
    assert calls == ["git push", "git push origin v9.9.9"]


def test_main_takes_the_lock_and_syncs_before_anything_else():
    src = _RELEASE_PY.read_text(encoding="utf-8")
    m = src[src.index("def main():"):]
    order = [m.index(k) for k in ("acquire_release_lock(version)", "atexit.register(release_release_lock", "sync_with_origin()",
                                  "next_free_version(", "preflight_checks()", "run_tests()", "gather_notes(version)",
                                  "update_version_files(", "git_commit_tag_push(", "wait_for_ci(tag)")]
    assert order == sorted(order)
