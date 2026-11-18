"""Nothing private in the public repository.

2026-11-18: docs/fabric-simplification-pass4.md (home network addresses, a deploy
command) had been tracked since 2026-08-17 although .gitignore said never to
publish it, and four scripts carried the colo web server's address with its
login name. The scripts now reach the server by an ssh Host name each machine
defines in its own ~/.ssh/config (padspan-colo).

These checks read the git index, so a copy that is not a git checkout (the
Bright build tree) skips them.
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ("scripts/release.py", "scripts/deploy_site.py", "scripts/make_social_preview.py",
           "server/pull_padspan_telemetry.sh")
# Files never read as text: pictures, fonts, archives, media.
BINARY = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz", ".woff", ".woff2", ".ttf", ".otf",
          ".zip", ".gz", ".tgz", ".7z", ".mp4", ".webm", ".mov", ".glb", ".gltf", ".bin", ".pdf", ".xlsx",
          ".usdz", ".npz", ".pyc"}
# A login name, an at sign, then a dotted numeric address: an ssh login to a numeric address.
USER_AT_IP = re.compile(r"[A-Za-z0-9_.-]+@(?:\d{1,3}\.){3}\d{1,3}\b")


def _git(*args: str) -> str | None:
    try:
        res = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return res.stdout if res.returncode == 0 else None


def _tracked() -> list[str]:
    out = _git("ls-files", "-z")
    if out is None:
        pytest.skip("not a git checkout")
    return [p for p in out.split("\0") if p]


def test_no_tracked_file_is_one_gitignore_says_never_to_publish():
    out = _git("ls-files", "-ci", "--exclude-standard")
    if out is None:
        pytest.skip("not a git checkout")
    assert out.split() == [], "tracked although .gitignore keeps it out: git rm --cached it"


def test_no_ssh_login_to_a_numeric_address():
    hits = []
    for rel in _tracked():
        path = ROOT / rel
        if path.suffix.lower() in BINARY or not path.is_file() or path.stat().st_size > 4_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        hits += [f"{rel}:{n}" for n, line in enumerate(text.splitlines(), 1) if USER_AT_IP.search(line)]
    assert hits == [], "use an ssh Host name from ~/.ssh/config instead of user@address"


@pytest.mark.parametrize("rel", SCRIPTS)
def test_scripts_reach_the_colo_by_name(rel):
    path = ROOT / rel
    if not path.is_file():
        pytest.skip(f"{rel} is not in this tree")
    assert "padspan-colo" in path.read_text(encoding="utf-8")


def _release():
    path = ROOT / "scripts" / "release.py"
    if not path.is_file():
        pytest.skip("scripts/release.py is not in this tree")
    spec = importlib.util.spec_from_file_location("release_colo_check", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_release_preflight_names_an_undefined_colo_host():
    R = _release()
    # `ssh -G` echoes a name with no Host entry back as its own hostname.
    undefined = lambda cmd: SimpleNamespace(returncode=0, stdout="user someone\nhostname padspan-colo\nport 22\n", stderr="")
    assert "not defined" in R.colo_host_problem("padspan-colo", run_=undefined)
    defined = lambda cmd: SimpleNamespace(returncode=0, stdout="user administrator\nhostname 203.0.113.7\n", stderr="")
    assert R.colo_host_problem("padspan-colo", run_=defined) is None
    broken = lambda cmd: SimpleNamespace(returncode=255, stdout="", stderr="bad configuration")
    assert "could not read" in R.colo_host_problem("padspan-colo", run_=broken)
