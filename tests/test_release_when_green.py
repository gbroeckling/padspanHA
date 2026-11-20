# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""scripts/release.py publishes a release only when GitHub's checks on its tag
are green.

Until 2026-11-19 the release was published, and the update check told about
it, ten seconds after the push; the checks were waited for afterwards and only
reported, so a release whose checks were red was installable all the while.
The order is now: tag pushed, the GitHub release made as a DRAFT with its zip,
the checks waited for, and only when every one is green the draft published,
then the update-check manifest written, then the landing page (a stable) and
Bright. Red, or not finished in time: the draft stays a draft, the manifest is
not written, the exit code is 4. A run that stopped with a draft left behind
is carried on with --finish or given up with --abandon, and the next release
looks for such a draft before it starts.

Nothing here reaches outside: gh, git's remote and the web host are the
`Outside` stand-in below, and anything it was not told to expect fails the
test.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_RELEASE_PY = _ROOT / "scripts" / "release.py"
pytestmark = pytest.mark.skipif(not _RELEASE_PY.is_file(), reason="scripts/release.py not present in this tree")


def _load():
    spec = importlib.util.spec_from_file_location("release_when_green", _RELEASE_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load() if _RELEASE_PY.is_file() else None

SHA = "a" * 40
ZIP = "padspan_ha.zip"


class Outside:
    """GitHub, git's remote and this checkout's tags, as far as the release
    asks about them. `events` is what happened, in order."""

    def __init__(self):
        self.releases = {}        # tag -> {"isDraft", "isPrerelease", "assets"}
        self.remote_tags = {}     # tag -> the commit it is on
        self.local_tags = {}
        self.head = SHA
        self.runs = {}            # tag -> the runs `gh run list --branch tag` gives
        self.events = []
        self.cmds = []
        self.fail = {}            # start of a command -> how many times it fails first

    # ── what a test sets up ──
    def tag(self, tag, sha=SHA):
        self.remote_tags[tag] = self.local_tags[tag] = sha

    def draft(self, tag, prerelease=True, assets=(ZIP,), draft=True):
        self.releases[tag] = {"isDraft": draft, "isPrerelease": prerelease, "assets": list(assets)}

    def checks(self, tag, sha=SHA, **words):
        """checks("v1", Tests="failure"): the three checks, success unless said.
        A word that is a status (in_progress, queued) is a run not finished;
        None leaves the check out, as one GitHub has not started."""
        names = {"Tests": "Tests", "Hassfest": "Hassfest Validation", "HACS": "HACS Validation"}
        runs = []
        for key, name in names.items():
            word = words.get(key, "success")
            if word is None:
                continue
            done = word not in ("in_progress", "queued")
            runs.append({"workflowName": name, "status": "completed" if done else word,
                         "conclusion": word if done else "", "url": f"https://example.invalid/{key}",
                         "createdAt": "2026-11-19T00:00:00Z", "headSha": sha})
        self.runs[tag] = runs

    # ── the shell ──
    def sh(self, cmd, check=True):
        self.cmds.append(cmd)
        out, err, rc = "", "", 0
        for start, left in self.fail.items():
            if cmd.startswith(start) and left > 0:
                self.fail[start] = left - 1
                return SimpleNamespace(returncode=1, stdout="", stderr="HTTP 500")
        tag = (re.search(r"\bv\d+\.\d+\.\d+\b", cmd) or [None])[0]
        if cmd.startswith("gh release list"):
            newest_first = sorted(self.releases, key=lambda t: [int(n) for n in t[1:].split(".")], reverse=True)
            out = json.dumps([{"tagName": t, "isDraft": self.releases[t]["isDraft"],
                               "isPrerelease": self.releases[t]["isPrerelease"]} for t in newest_first])
        elif cmd.startswith("gh release create"):
            assert "--draft" in cmd and "--verify-tag" in cmd, cmd
            assert tag in self.remote_tags and tag not in self.releases, cmd
            self.draft(tag, prerelease="--prerelease" in cmd)
            self.events.append(("draft", tag))
        elif cmd.startswith("gh release view"):
            if tag in self.releases:
                rel = self.releases[tag]
                out = json.dumps({"tagName": tag, "isDraft": rel["isDraft"], "isPrerelease": rel["isPrerelease"],
                                  "assets": [{"name": n} for n in rel["assets"]]})
            else:
                rc, err = 1, "release not found"
        elif cmd.startswith("gh release edit"):
            assert "--draft=false" in cmd and f"--tag {tag} --verify-tag" in cmd, cmd
            assert tag in self.remote_tags, "gh --verify-tag would stop here"
            self.releases[tag]["isDraft"] = False
            self.releases[tag]["isPrerelease"] = "--prerelease=false" not in cmd
            self.events.append(("published", tag))
        elif cmd.startswith("gh release delete"):
            assert "--yes" in cmd and self.releases[tag]["isDraft"], cmd
            del self.releases[tag]
            self.events.append(("draft deleted", tag))
        elif cmd.startswith("gh run list"):
            self.events.append(("checks asked", tag))
            out = json.dumps(self.runs.get(tag, []))
        elif cmd.startswith("git ls-remote origin refs/tags/"):
            out = f"{self.remote_tags[tag]}\trefs/tags/{tag}\n" if tag in self.remote_tags else ""
        elif cmd.startswith("git push origin :refs/tags/"):
            del self.remote_tags[tag]
            self.events.append(("remote tag deleted", tag))
        elif cmd.startswith("git tag -d "):
            del self.local_tags[tag]
            self.events.append(("local tag deleted", tag))
        elif cmd == "git rev-parse HEAD":
            out = self.head
        elif cmd.startswith("git rev-parse --verify --quiet refs/tags/"):
            rc, out = (0, self.local_tags[tag]) if tag in self.local_tags else (1, "")
        elif "deploy_site.py" in cmd:
            self.events.append(("landing page",))
        else:
            raise AssertionError(f"an outside call this test did not expect: {cmd}")
        return SimpleNamespace(returncode=rc, stdout=out, stderr=err)

    def did(self, what):
        return [e for e in self.events if e[0] == what]


@pytest.fixture
def outside(monkeypatch):
    """The release script with every way out replaced: its two shells are the
    stand-in, the manifest and Bright only record, and subprocess itself is a
    trap, so a call nobody stubbed fails the test, never reaching GitHub or the
    web host."""
    o = Outside()

    def trap(*a, **k):
        raise AssertionError(f"a real outside call: {a}")

    monkeypatch.setattr(R, "subprocess", SimpleNamespace(run=trap))
    monkeypatch.setattr(R, "run", o.sh)
    monkeypatch.setattr(R, "_quiet", o.sh)

    def manifest(version, channel):
        # The moment that matters: the version must be published by now.
        assert o.releases[f"v{version}"]["isDraft"] is False, "the manifest was written for a draft"
        o.events.append(("manifest", version, channel))
        return True

    monkeypatch.setattr(R, "publish_update_manifest", manifest)
    monkeypatch.setattr(R, "bright_pass", lambda v, c, m=None: o.events.append(("bright", v, c)))
    monkeypatch.setattr(R, "last_stable_release", lambda *a, **k: "9.9.0")
    return o


def _main(monkeypatch, outside, *argv, checks=None, tags=()):
    """release.main() with the steps before the push stubbed (as CLAUDE.md
    says a test that calls it does) and the push putting the tag on the
    stand-in GitHub, where its checks then are `checks`. `tags`: the tags
    already taken."""
    calls = []
    for name in ("preflight_checks", "run_tests", "update_version_files", "write_panel_notes", "build_zip", "validate_zip"):
        monkeypatch.setattr(R, name, lambda *a, _n=name, **k: calls.append(_n))
    monkeypatch.setattr(R, "update_whatsnew_entry", lambda *a, **k: True)
    for name, val in (("acquire_release_lock", "lock"), ("sync_with_origin", None), ("_tags", set(tags)), ("gather_notes", None)):
        monkeypatch.setattr(R, name, lambda *a, _n=name, _v=val, **k: (outside.events.append((_n,)), _v)[1])
    monkeypatch.setattr(R, "release_release_lock", lambda *a, **k: outside.events.append(("lock let go",)))

    def push(version, tag, message=None):
        outside.tag(tag)
        outside.checks(tag, **(checks or {}))
        outside.events.append(("pushed", tag))

    monkeypatch.setattr(R, "git_commit_tag_push", push)
    monkeypatch.setattr(sys, "argv", ["release.py", *argv])
    R.main()
    return calls


def _order(outside, *whats):
    at = [next(i for i, e in enumerate(outside.events) if e[0] == w) for w in whats]
    assert at == sorted(at), outside.events


# ── green: draft, then published, then the manifest ─────────────────────────
def test_green_checks_draft_then_publish_then_manifest(monkeypatch, outside, capsys):
    _main(monkeypatch, outside, "9.9.9", "--no-bright")
    _order(outside, "acquire_release_lock", "pushed", "draft", "checks asked", "published", "manifest")
    assert outside.releases["v9.9.9"] == {"isDraft": False, "isPrerelease": True, "assets": [ZIP]}
    assert outside.did("manifest") == [("manifest", "9.9.9", "beta")]
    create = next(c for c in outside.cmds if c.startswith("gh release create"))
    assert " --draft " in create and "--prerelease" in create and ZIP in create
    edit = next(c for c in outside.cmds if c.startswith("gh release edit"))
    assert edit.endswith("--draft=false --tag v9.9.9 --verify-tag --prerelease") and "--latest" not in edit
    # A beta: no landing page; --no-bright: no Bright. The lock is held to the end (atexit lets go).
    assert not outside.did("landing page") and not outside.did("bright") and not outside.did("lock let go")
    assert "v9.9.9 is published (pre-release)" in capsys.readouterr().out


def test_a_stable_is_published_as_latest_then_the_page_then_bright(monkeypatch, outside):
    _main(monkeypatch, outside, "9.9.9", "--stable")
    _order(outside, "draft", "checks asked", "published", "manifest", "landing page", "bright")
    assert outside.releases["v9.9.9"]["isPrerelease"] is False
    assert "--prerelease" not in next(c for c in outside.cmds if c.startswith("gh release create"))
    assert next(c for c in outside.cmds if c.startswith("gh release edit")).endswith("--prerelease=false --latest")
    assert outside.did("manifest") == [("manifest", "9.9.9", "stable")] and outside.did("bright") == [("bright", "9.9.9", "stable")]


def test_the_release_is_a_draft_all_the_while_the_checks_are_asked(monkeypatch, outside):
    seen = []
    real = outside.sh
    monkeypatch.setattr(R, "_quiet", lambda cmd: (seen.append(outside.releases["v9.9.9"]["isDraft"])
                                                  if cmd.startswith("gh run list") else None, real(cmd))[1])
    _main(monkeypatch, outside, "9.9.9", "--no-bright")
    assert seen and all(seen)


# ── red: the draft stays, no manifest, exit 4, the failed check named ───────
def test_a_red_check_leaves_the_draft_and_writes_no_manifest(monkeypatch, outside, capsys):
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--stable", checks={"Tests": "failure"})
    assert stop.value.code == R.EXIT_NOT_GREEN == 4
    assert outside.releases["v9.9.9"]["isDraft"] is True
    assert not any(c.startswith("gh release edit") for c in outside.cmds)
    assert not outside.did("published") and not outside.did("manifest")
    assert not outside.did("landing page") and not outside.did("bright"), "nothing else tells the world either"
    out = capsys.readouterr().out
    assert "!! Tests: failure  https://example.invalid/Tests" in out, "the failed check, by name, with where to look"
    assert "ok Hassfest Validation: success" in out
    assert "v9.9.9 is NOT published" in out and "stays a DRAFT" in out and "the manifest was not written" in out
    assert "gh run list --repo gbroeckling/padspanHA --branch v9.9.9" in out
    assert "Fix it and release the next version" in out
    assert "python scripts/release.py 9.9.9 --abandon" in out and "python -u scripts/release.py 9.9.9 --finish" in out


def test_a_check_that_never_started_is_not_green(monkeypatch, outside):
    # Two of the three passed and the third is not listed: not a release.
    real = R.wait_for_ci
    clock = {"t": 0.0}
    monkeypatch.setattr(R, "wait_for_ci", lambda tag: real(tag, now=lambda: clock["t"],
                                                           sleep=lambda s: clock.__setitem__("t", clock["t"] + s)))
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--no-bright", checks={"Tests": None})
    assert stop.value.code == 4 and outside.releases["v9.9.9"]["isDraft"] and not outside.did("manifest")


# ── a timeout: the same, said as a timeout ──────────────────────────────────
def test_a_timeout_leaves_the_draft_and_says_it_timed_out(monkeypatch, outside, capsys):
    real = R.wait_for_ci
    clock = {"t": 0.0}
    slept = []
    monkeypatch.setattr(R, "wait_for_ci", lambda tag: real(
        tag, now=lambda: clock["t"], sleep=lambda s: (slept.append(s), clock.__setitem__("t", clock["t"] + s))))
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--no-bright", checks={"Tests": "in_progress"})
    assert stop.value.code == 4
    assert outside.releases["v9.9.9"]["isDraft"] is True and not outside.did("published") and not outside.did("manifest")
    assert sum(slept) == R.CI_WAIT_S == 30 * 60 and set(slept) == {R.CI_POLL_S}
    out = capsys.readouterr().out
    assert "!! timed out after 30 minutes, still waiting for: Tests  [Tests: in_progress; " in out
    assert "v9.9.9 is NOT published" in out and "python -u scripts/release.py 9.9.9 --finish --no-bright" in out
    # While it waited it said what for: at the start, then once a minute.
    waits = re.findall(r"^\s+(\d+) min, waiting for Tests  \[Tests: in_progress; Hassfest Validation: success; "
                       r"HACS Validation: success\]$", out, re.MULTILINE)
    assert [int(m) for m in waits] == list(range(30))
    assert "Up to 30 minutes" in out and "actions?query=branch%3Av9.9.9" in out


def test_the_wait_says_each_change_and_ends_when_all_are_done(capsys):
    polls = [{"Tests": "queued", "Hassfest": None, "HACS": None},
             {"Tests": "in_progress", "Hassfest": "in_progress", "HACS": "success"},
             {"Tests": "in_progress", "Hassfest": "success", "HACS": "success"},
             {"Tests": "success", "Hassfest": "success", "HACS": "success"}]
    o = Outside()
    asked = []

    def checks_(tag, sha):
        o.checks(tag, **polls[min(len(asked), len(polls) - 1)])
        asked.append(sha)
        return R.tag_checks(tag, sha, run_=o.sh)

    clock = {"t": 0.0}
    assert R.wait_for_ci("v9.9.9", checks_=checks_, commit_=lambda tag: SHA, now=lambda: clock["t"],
                         sleep=lambda s: clock.__setitem__("t", clock["t"] + s)) is True
    assert asked == [SHA] * 4 and clock["t"] == 3 * R.CI_POLL_S
    out = capsys.readouterr().out
    assert "waiting for Tests, Hassfest Validation, HACS Validation  [Tests: queued; Hassfest Validation: not started; " in out
    assert "waiting for Tests, Hassfest Validation  [" in out and "waiting for Tests  [" in out
    assert out.count("ok ") == 3 and "!!" not in out


def test_a_tag_that_is_not_on_github_is_not_green(capsys):
    assert R.wait_for_ci("v9.9.9", commit_=lambda tag: "", checks_=lambda *a: pytest.fail("asked")) is False
    assert "the tag v9.9.9 is not on GitHub" in capsys.readouterr().out


# ── the checks themselves ───────────────────────────────────────────────────
def test_only_runs_on_the_tags_own_commit_count_and_the_newest_of_each():
    o = Outside()
    o.tag("v9.9.9", "b" * 40)
    old = Outside()
    old.checks("v9.9.9", sha=SHA)                          # a number given up and used again: the old tag's green runs
    new = Outside()
    new.checks("v9.9.9", sha="b" * 40, Tests="failure")
    rerun = {**new.runs["v9.9.9"][0], "conclusion": "success", "createdAt": "2026-11-19T01:00:00Z"}
    o.runs["v9.9.9"] = old.runs["v9.9.9"]
    assert R.checks_state(R.tag_checks("v9.9.9", run_=o.sh)) == "running", "the old commit's green runs are not this tag's"
    o.runs["v9.9.9"] = old.runs["v9.9.9"] + new.runs["v9.9.9"]
    assert R.checks_state(R.tag_checks("v9.9.9", run_=o.sh)) == "red"
    o.runs["v9.9.9"] = [rerun] + o.runs["v9.9.9"]
    assert R.checks_state(R.tag_checks("v9.9.9", run_=o.sh)) == "green", "the newest run of a check is the check"
    assert R.tag_checks("v1.2.3", run_=o.sh) is None, "no such tag on GitHub"
    o.runs["v9.9.9"] = []
    assert R.checks_state(R.tag_checks("v9.9.9", run_=o.sh)) == "running", "none seen yet is not green"


def test_what_green_means():
    def state(**words):
        o = Outside()
        o.tag("v9.9.9")
        o.checks("v9.9.9", **words)
        return R.checks_state(R.tag_checks("v9.9.9", run_=o.sh))

    assert state() == "green"
    assert state(Tests="in_progress") == "running" and state(HACS=None) == "running"
    assert state(Hassfest="failure", Tests="in_progress") == "red", "one failed: red, whatever the rest do"
    for word in ("cancelled", "skipped", "timed_out", "neutral"):
        assert state(Tests=word) == "red", word
    assert R.checks_state(None) == "unknown"
    extra = {"Tests": {"status": "completed", "conclusion": "success"},
             "Hassfest Validation": {"status": "completed", "conclusion": "success"},
             "HACS Validation": {"status": "completed", "conclusion": "success"},
             "A new check": {"status": "completed", "conclusion": "failure"}}
    assert R.checks_state(extra) == "red", "a check not in TAG_CHECKS that ran on the tag counts too"


def test_tag_checks_names_every_workflow_a_tag_push_starts():
    flows = _ROOT / ".github" / "workflows"
    if not flows.is_dir():
        pytest.skip("no workflows in this tree")
    on_tags = set()
    for f in sorted(flows.glob("*.yml")):
        text = f.read_text(encoding="utf-8")
        push = re.search(r"^  push:[^\n]*\n((?:    [^\n]*\n)*)", text, re.MULTILINE)
        if push and "branches" not in push.group(1) and "tags-ignore" not in push.group(1):
            on_tags.add(re.search(r"^name:\s*(.+?)\s*$", text, re.MULTILINE).group(1).strip("\"'"))
    assert on_tags == set(R.TAG_CHECKS), "a workflow that runs on a tag push must be in release.py's TAG_CHECKS, and only those"


# ── publishing the draft ────────────────────────────────────────────────────
def test_publishing_looks_before_and_after(capsys):
    o = Outside()
    o.tag("v9.9.9")
    for problem, setup in (("no release", lambda: None),
                           ("no zip", lambda: o.draft("v9.9.9", assets=()))):
        o.releases.clear()
        setup()
        with pytest.raises(SystemExit):
            R.publish_github_release("v9.9.9", "beta", run_=o.sh, sleep=lambda s: None, look=lambda t: R.github_release(t, o.sh))
        assert not o.did("published"), problem
    assert "python -u scripts/release.py 9.9.9 --finish" in capsys.readouterr().out
    # GitHub answers 500 twice, then publishes: tried again, never given up early.
    o.draft("v9.9.9")
    o.fail["gh release edit"] = 2
    R.publish_github_release("v9.9.9", "beta", run_=o.sh, sleep=lambda s: None, look=lambda t: R.github_release(t, o.sh))
    assert sum(c.startswith("gh release edit") for c in o.cmds) == 3 and o.releases["v9.9.9"]["isDraft"] is False
    # Already published: left as it is, nothing edited.
    before = len(o.cmds)
    R.publish_github_release("v9.9.9", "beta", run_=o.sh, sleep=lambda s: None, look=lambda t: R.github_release(t, o.sh))
    assert not any(c.startswith("gh release edit") for c in o.cmds[before:])


def test_publishing_stops_when_github_does_not_show_it_published(capsys):
    still_draft = {"tagName": "v9.9.9", "isDraft": True, "isPrerelease": True, "assets": [{"name": ZIP}]}
    with pytest.raises(SystemExit) as stop:
        R.publish_github_release("v9.9.9", "beta", run_=lambda c: SimpleNamespace(returncode=0, stdout=""),
                                 sleep=lambda s: None, look=lambda t: still_draft)
    assert stop.value.code == 1 and "wanted: published, v9.9.9" in capsys.readouterr().out


# ── an interrupted run: finished ────────────────────────────────────────────
def _left_as_a_draft(outside, tag="v9.9.9", prerelease=True, **checks):
    outside.tag(tag)
    outside.draft(tag, prerelease=prerelease)
    outside.checks(tag, **checks)


def test_an_interrupted_run_is_finished(monkeypatch, outside, capsys):
    _left_as_a_draft(outside)
    _main(monkeypatch, outside, "9.9.9", "--finish", "--no-bright")
    _order(outside, "acquire_release_lock", "checks asked", "published", "manifest")
    assert outside.releases["v9.9.9"] == {"isDraft": False, "isPrerelease": True, "assets": [ZIP]}
    assert outside.did("manifest") == [("manifest", "9.9.9", "beta")]
    assert not outside.did("sync_with_origin") and not outside.did("pushed"), "it finishes what is there: no new commit, tag or pull"
    assert "=== Finishing v9.9.9 (beta) ===" in capsys.readouterr().out
    # Run again: nothing to publish, the manifest written again (the same), no harm.
    _main(monkeypatch, outside, "9.9.9", "--finish", "--no-bright")
    assert len(outside.did("published")) == 1 and len(outside.did("manifest")) == 2
    assert "already published: doing what is left" in capsys.readouterr().out


def test_finishing_publishes_only_when_green(monkeypatch, outside, capsys):
    _left_as_a_draft(outside, Hassfest="failure")
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--finish")
    assert stop.value.code == 4 and outside.releases["v9.9.9"]["isDraft"] is True
    assert not outside.did("published") and not outside.did("manifest") and not outside.did("bright")
    assert "!! Hassfest Validation: failure" in capsys.readouterr().out
    # The failed check run again on GitHub and green: now it goes out.
    outside.checks("v9.9.9")
    _main(monkeypatch, outside, "9.9.9", "--finish", "--no-bright")
    assert outside.releases["v9.9.9"]["isDraft"] is False and outside.did("manifest")


def test_finishing_keeps_what_the_draft_was_made_as(monkeypatch, outside, capsys):
    # A stable draft is published as a stable with no --stable given...
    _left_as_a_draft(outside, prerelease=False)
    _main(monkeypatch, outside, "9.9.9", "--finish", "--no-bright")
    assert outside.releases["v9.9.9"]["isPrerelease"] is False and outside.did("manifest") == [("manifest", "9.9.9", "stable")]
    assert outside.did("landing page"), "this checkout is at the tag: the page is deployed"
    # ...and a pre-release draft is never made a stable by --finish --stable.
    _left_as_a_draft(outside, tag="v9.9.10")
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.10", "--finish", "--stable")
    assert stop.value.code == 1 and outside.releases["v9.9.10"]["isDraft"] is True
    assert "was made as a pre-release" in capsys.readouterr().out


def test_finishing_never_goes_back_past_a_newer_published_version(monkeypatch, outside, capsys):
    _left_as_a_draft(outside)
    outside.draft("v9.9.10", draft=False)
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--finish")
    assert stop.value.code == 1
    assert outside.releases["v9.9.9"]["isDraft"] is True and not outside.did("manifest") and not outside.did("checks asked")
    out = capsys.readouterr().out
    assert "v9.9.10 is already published and is newer than v9.9.9" in out and "9.9.9 --abandon" in out


def test_finishing_from_a_checkout_not_at_the_tag_leaves_the_page_and_bright(monkeypatch, outside, capsys):
    _left_as_a_draft(outside, prerelease=False)
    outside.head = "f" * 40                                # main has moved on since the tag
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--finish")
    assert stop.value.code == 3
    assert outside.releases["v9.9.9"]["isDraft"] is False and outside.did("manifest"), "published and announced all the same"
    assert not outside.did("landing page") and not outside.did("bright")
    out = capsys.readouterr().out
    assert "Not done: the landing page and PadSpan Bright" in out and "git worktree add --detach <folder> v9.9.9" in out


def test_finishing_needs_one_release_for_the_tag(monkeypatch, outside, capsys):
    outside.tag("v9.9.9")                                  # the push got through, the draft was never made
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--finish")
    assert stop.value.code == 1 and not outside.events[1:], outside.events
    assert "no release for v9.9.9" in capsys.readouterr().out
    for bad in (["next", "--finish"], ["9.9.9", "--finish", "--abandon"], ["9.9.9", "--manifest-only", "--finish"]):
        outside.events.clear()
        with pytest.raises(SystemExit) as stop:
            _main(monkeypatch, outside, *bad)
        assert stop.value.code == 1 and not outside.events, bad


# ── an interrupted run: abandoned ───────────────────────────────────────────
def test_an_interrupted_run_is_abandoned(monkeypatch, outside, capsys):
    _left_as_a_draft(outside, Tests="failure")
    outside.draft("v9.9.8", draft=False)
    _main(monkeypatch, outside, "9.9.9", "--abandon")
    assert [e[0] for e in outside.events] == ["acquire_release_lock", "draft deleted", "remote tag deleted", "local tag deleted"]
    assert "v9.9.9" not in outside.releases and "v9.9.9" not in outside.remote_tags and "v9.9.9" not in outside.local_tags
    assert "v9.9.8" in outside.releases
    assert not outside.did("manifest") and not outside.did("published")
    out = capsys.readouterr().out
    assert "v9.9.9 is given up: no draft, no tag" in out and "The number is free" in out


def test_a_published_release_is_never_abandoned(monkeypatch, outside, capsys):
    outside.tag("v9.9.9")
    outside.draft("v9.9.9", draft=False)
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--abandon")
    assert stop.value.code == 1 and outside.events == [("acquire_release_lock",)]
    assert "v9.9.9" in outside.releases and "v9.9.9" in outside.remote_tags
    assert "v9.9.9 is published" in capsys.readouterr().out


def test_abandoning_a_tag_whose_draft_was_never_made_and_nothing_older(monkeypatch, outside, capsys):
    outside.draft("v9.9.8", draft=False)
    outside.tag("v9.9.9")                                  # newer than anything published, no release: the push got through
    _main(monkeypatch, outside, "9.9.9", "--abandon")
    assert [e[0] for e in outside.events] == ["acquire_release_lock", "remote tag deleted", "local tag deleted"]
    # An old tag with no draft is left alone; a version with nothing at all is said so.
    outside.tag("v9.9.7")
    for version, says in (("9.9.7", "its tag is left alone"), ("9.9.6", "nothing to give up")):
        outside.events.clear()
        with pytest.raises(SystemExit) as stop:
            _main(monkeypatch, outside, version, "--abandon")
        assert stop.value.code == 1 and outside.events == [("acquire_release_lock",)]
        assert says in capsys.readouterr().out
    assert "v9.9.7" in outside.remote_tags


def test_a_draft_that_will_not_delete_keeps_its_tag(monkeypatch, outside):
    _left_as_a_draft(outside)
    outside.fail["gh release delete"] = 1
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--abandon")
    assert stop.value.code == 1 and "v9.9.9" in outside.remote_tags and "v9.9.9" in outside.local_tags


# ── the next release looks for a draft left behind ──────────────────────────
def test_a_release_stops_for_a_draft_that_could_still_be_published(monkeypatch, outside, capsys):
    for checks, says in (({}, "its checks are green"), ({"Tests": "in_progress"}, "its checks have not finished")):
        outside.events.clear()
        _left_as_a_draft(outside, **checks)
        with pytest.raises(SystemExit) as stop:
            _main(monkeypatch, outside, "next", "--no-bright")
        assert stop.value.code == 1
        _order(outside, "acquire_release_lock", "sync_with_origin", "checks asked")
        assert not outside.did("_tags") and not outside.did("pushed") and not outside.did("draft"), "stopped before anything was changed"
        out = capsys.readouterr().out
        assert "v9.9.9 is still an unpublished draft" in out and says in out
        assert "python -u scripts/release.py 9.9.9 --finish" in out and "python scripts/release.py 9.9.9 --abandon" in out


def test_a_release_goes_ahead_over_a_draft_whose_checks_failed_and_says_so(monkeypatch, outside, capsys):
    _left_as_a_draft(outside, Tests="failure")
    _main(monkeypatch, outside, "9.9.10", "--no-bright", tags={"v9.9.9"})
    out = capsys.readouterr().out
    assert "!! v9.9.9 was never published: its checks failed [Tests: failure; " in out and "This release goes out in its place" in out
    assert outside.releases["v9.9.9"]["isDraft"] is True and outside.releases["v9.9.10"]["isDraft"] is False
    assert outside.did("manifest") == [("manifest", "9.9.10", "beta")]


def test_what_the_look_for_a_draft_says(capsys):
    rel = lambda tag, draft: {"tagName": tag, "isDraft": draft, "isPrerelease": True}
    never = lambda tag: pytest.fail(f"asked for the checks of {tag}")
    R.stop_for_unpublished_draft(lambda: [rel("v1.0.2", False), rel("bright-v9", True)], never)
    assert capsys.readouterr().out.strip() == "none."
    # A draft with a later version out since can't be published any more: said, not looked into, not a stop.
    R.stop_for_unpublished_draft(lambda: [rel("v1.0.2", False), rel("v1.0.1", True)], never)
    assert "Drafts never published, with a later version out since: v1.0.1" in capsys.readouterr().out
    # GitHub silent: a draft can't be ruled out, so the release does not start.
    for releases_, checks_ in ((lambda: None, never), (lambda: [rel("v1.0.3", True)], lambda tag: None)):
        with pytest.raises(SystemExit) as stop:
            R.stop_for_unpublished_draft(releases_, checks_)
        assert stop.value.code == 1
    out = capsys.readouterr().out
    assert "could not be asked" in out and "its checks could not be read" in out


# ── --manifest-only ─────────────────────────────────────────────────────────
def test_manifest_only_writes_for_a_published_release_and_no_other(monkeypatch, outside, capsys):
    _left_as_a_draft(outside)
    for version, flags, says in (("9.9.9", [], "still a draft"), ("9.9.8", [], "no release for v9.9.8")):
        with pytest.raises(SystemExit) as stop:
            _main(monkeypatch, outside, version, "--manifest-only", *flags)
        assert stop.value.code == 1 and not outside.did("manifest")
        out = capsys.readouterr().out
        assert says in out and "The manifest was not written" in out
    outside.releases["v9.9.9"]["isDraft"] = False
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--manifest-only", "--stable")
    assert stop.value.code == 1 and not outside.did("manifest") and "is a pre-release on GitHub" in capsys.readouterr().out
    with pytest.raises(SystemExit) as stop:
        _main(monkeypatch, outside, "9.9.9", "--manifest-only")
    assert stop.value.code == 0 and outside.did("manifest") == [("manifest", "9.9.9", "beta")]
    assert not outside.did("acquire_release_lock"), "as before: no lock for the manifest alone"


# ── the draft is made once ──────────────────────────────────────────────────
def test_the_fallback_takes_the_draft_the_first_try_left(monkeypatch, tmp_path):
    (tmp_path / "CHANGELOG.md").write_text("# Changelog\n\n## 9.9.9 — Nine (2026-11-19)\n\n- Nine.\n", encoding="utf-8")
    monkeypatch.setattr(R, "ROOT", tmp_path)
    calls = []

    def run_(cmd):
        calls.append(cmd)
        answers = (("gh release create", (1, "")), ("gh release view", (0, "[77,true]")), ("gh release upload", (0, "")),
                   ("gh api repos/gbroeckling/padspanHA/releases/77 --jq", (0, f'["{ZIP}"]')))
        rc, out = next(a for start, a in answers if cmd.startswith(start))
        return SimpleNamespace(returncode=rc, stdout=out)

    R.create_github_release("v9.9.9", "beta", run_=run_, sleep=lambda s: None)
    assert [c.split(" v9.9.9")[0] for c in calls[:3]] == ["gh release create", "gh release view", "gh release upload"]
    assert "--clobber" in calls[2] and len(calls) == 4, "no second draft made beside the first"


# ── the order, in the source ────────────────────────────────────────────────
def test_the_order_in_the_script():
    src = _RELEASE_PY.read_text(encoding="utf-8")
    main = src[src.index("def main():"):]
    order = [main.index(k) for k in ("acquire_release_lock(version)", "sync_with_origin()", "stop_for_unpublished_draft()", "_tags()",
                                     "preflight_checks()", "git_commit_tag_push(", "create_github_release(tag, channel, message)",
                                     "if not wait_for_ci(tag):", "stop_at_draft(tag, flags)", "go_public(version, tag, channel")]
    assert order == sorted(order)
    assert main.count("publish_update_manifest(") == 1 and main.index("manifest_only_problem(") < main.index("publish_update_manifest(")
    assert "release_release_lock(" not in main.replace("atexit.register(release_release_lock, lock)", ""), \
        "the lock is let go when the run ends, never before the release is published"
    public = src[src.index("def go_public("):src.index("def _at_tag(")]
    order = [public.index(k) for k in ("publish_github_release(tag, channel)", "publish_update_manifest(version, channel)",
                                       "deploy_site.py", "bright_pass(version, channel, message)")]
    assert order == sorted(order)
    for name in ("finish_release", "go_public", "stop_at_draft"):
        body = src[src.index(f"def {name}("):]
        body = body[:body.index("\ndef ", 1)]
        assert "git tag " not in body and "git push" not in body and "gh release create" not in body, name
