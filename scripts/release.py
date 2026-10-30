#!/usr/bin/env python
"""
PadSpan HA release script.

Usage:
    python scripts/release.py <version> [--stable] [--no-bright]
    python scripts/release.py <version> --manifest-only [--stable]   # re-push latest.json only

Examples:
    python scripts/release.py 0.4.22            # beta (pre-release on GitHub)
    python scripts/release.py 0.4.22 --stable   # stable (Latest on GitHub)
    python scripts/release.py next              # the version after the newest tag

Two sessions at once (2026-10-28): it holds a lock every checkout on this
computer shares (a second release waits), starts from origin/main, takes the
next free version if the one given is taken, gathers changelog.d/*.md notes
into CHANGELOG.md (see changelog.d/README.md), and if a push is refused
because someone pushed meanwhile, merges theirs in and pushes again. After
the push it waits for GitHub's checks on the tag and says how they went.

What it does:
    1. Validates hacs.json + repo structure (catches HACS-breaking mistakes)
    2. Updates version in all source files, and writes the panel's release
       notes (www/padspan-ha/assets/whatsnew.json) from CHANGELOG.md
    3. Builds dist/padspan_ha.zip
    4. Validates the zip (manifest.json present + readable)
    5. Commits, tags, and pushes
    6. Creates and publishes the GitHub release with the zip attached
    7. Derives PadSpan Bright from the tree just released (scripts/bright_build.py):
       copy, rename, stamp, verify, run ITS suite, zip — and publish to the
       Bright repo only once BRIGHT_PUBLISH below is True. Bright never
       blocks the full release: it runs after, and a red pass exits non-zero
       so it is seen. --no-bright skips it.

─────────────────────────────────────────────────────────────────────
NOTES FOR CLAUDE (read these when resuming after a session restart):

HACS DOWNLOAD ARCHITECTURE — how HACS installs a zip_release integration:
  1. HACS fetches the **git tree** from GitHub API (recursive) for the tag.
     It does NOT look inside the zip for validation — only the git tree.
  2. With content_in_root=false (our setting), HACS calls:
       get_first_directory_in_directory(tree, "custom_components")
     which walks the git tree looking for the first *directory* entry
     whose path starts with "custom_components/" — returns its name.
     For us that must return "padspan_ha".
  3. HACS then checks the git tree for:
       "custom_components/padspan_ha/manifest.json"
     If not found → error "No manifest.json file found".
  4. HACS reads manifest.json via GitHub raw content API, extracts domain.
  5. HACS downloads the zip asset named in hacs.json ("padspan_ha.zip").
  6. HACS extracts the zip directly into:
       <ha_config>/custom_components/<domain>/
     So our FLAT zip (files at root, no directory prefix) is correct —
     the files land in the right place.

WHAT BREAKS HACS:
  - __pycache__/ committed to git → pollutes the git tree, can confuse
    HACS tree traversal. .gitignore alone is not enough if already tracked.
    This script now verifies no __pycache__ is staged.
  - content_in_root=true with our repo structure → HACS looks for
    manifest.json at repo ROOT (not custom_components/padspan_ha/).
    We don't have it there. Must stay false.
  - hacs.json not committed → release script must include it in git add.
    Was missing before v0.6.25, causing hacs.json edits to be ignored.
  - GitHub API 500 errors → gh release create fails intermittently.
    Script now retries with gh api fallback + gh release upload.
  - If HACS caches domain=None from a failed validation (e.g. after HA
    reboot), user must remove + re-add the repo in HACS to clear cache.

hacs.json MUST contain:
  {
    "name": "PadSpan HA",
    "content_in_root": false,    ← files are in custom_components/padspan_ha/
    "zip_release": true,         ← use release asset, not source archive
    "filename": "padspan_ha.zip" ← asset name to download
  }

ZIP STRUCTURE (flat, no directory prefix):
  manifest.json        ← HACS reads domain from git tree, but zip must also
  __init__.py              have it for HA to load the integration after extract
  sensor.py
  www/padspan-ha/panel.js
  ...etc

GIT TREE must contain (HACS validates these via GitHub API):
  custom_components/                          (tree entry)
  custom_components/padspan_ha/               (tree entry — first dir child)
  custom_components/padspan_ha/manifest.json  (blob entry)

COMMON PITFALLS (so Claude doesn't repeat them):
  - Editing hacs.json locally but not including it in git add → change
    never reaches GitHub. Now in static_files list.
  - Setting content_in_root=true → HACS looks for manifest.json at repo
    root, which doesn't exist. Error: "No manifest.json file found 'manifest.json'"
  - __pycache__ in git → cleaned in v0.6.26, script now blocks it.
  - gh release create returns HTTP 500 → use api fallback (see below).
─────────────────────────────────────────────────────────────────────
"""

import sys
import atexit
import re
import html
import json
import zipfile
import pathlib
import subprocess
import datetime
import tempfile

# The Bright pass prints arrows. On a Windows console stdout is cp1252, which
# cannot encode them, and the UnicodeEncodeError landed AFTER the release had
# already been published — so the main release succeeded and the run still
# exited red, every time, on exactly the machine releases are cut from.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
import os
import time

ROOT = pathlib.Path(__file__).parent.parent
INTEGRATION = ROOT / "custom_components" / "padspan_ha"
PANEL_JS  = INTEGRATION / "www" / "padspan-ha" / "panel.js"
ZIP_PATH = ROOT / "dist" / "padspan_ha.zip"
REPO = "gbroeckling/padspanHA"

# ── PadSpan Bright — the generated edition ──
# Built and verified on EVERY release so the pass can never rot. Published
# The public Bright facade is live. Every PadSpan HA release now derives,
# verifies and publishes the matching Bright tree automatically; Bright has no
# independently maintained source and therefore nothing that can drift.
BRIGHT_PUBLISH = True
BRIGHT_ZIP = ROOT / "dist" / "padspan_bright.zip"    # git-ignored: it belongs to the Bright repo
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import bright_build  # noqa: E402  (sibling module)

# ── Files that must ALWAYS be committed alongside integration code ──
# If you add a new root-level config file that HACS or GitHub needs,
# add it here so it's never forgotten in a release commit.
STATIC_FILES = [
    "VERSION.txt",
    "LICENSE",
    "README.md",
    "hacs.json",        # ← HACS reads this from the repo, not the zip
    ".gitignore",
    "dist/padspan_ha.zip",
    "scripts/release.py",
    "scripts/bright_build.py",
    "scripts/bright_README.md",
    # The suite gates every release, so it has to travel WITH the code it
    # gates. Without this, tests/ was never staged by a release: the suite ran
    # green locally for weeks while the repo carried an older copy, and a
    # regression test written to prevent a shipped bug lived only on the
    # maintainer's disk. (git add respects .gitignore, so __pycache__ and
    # *.pyc stay out and the preflight __pycache__ check stays happy.)
    "tests",
    # The user-facing record of the release travels IN the release commit.
    # release.py used to skip it, so every release needed a second hand-made
    # "CHANGELOG: x.y.z" commit after the fact — or shipped without one.
    "CHANGELOG.md",
    # One note per change, gathered into CHANGELOG.md by the release (and
    # removed in the same commit): two sessions never edit the same lines.
    "changelog.d",
    # The colo endpoints (version/telemetry/stats) live in the repo and are
    # deployed from it; a release must not leave the repo's copy behind.
    "server",
    "docs",
    # padspan.traks.ca is source now, not a file hand-edited on the colo, and a
    # stable release deploys it (scripts/deploy_site.py). It has to be staged
    # or the deploy would ship something the repo never recorded.
    "site",
    "scripts/deploy_site.py",
    # deploy_site.py builds padspan.traks.ca/de/ with it on every deploy.
    "scripts/build_site_de.py",
    # README assets: the montage the README leads with, the og:image every
    # shared link uses, and the screenshots both are built from.
    "images",
    "scripts/make_social_preview.py",
    "scripts/make_demo_montage.py",
]


def run(cmd, check=True):
    """Run a shell command, print it, and return stdout."""
    print(f"  $ {cmd}")
    result = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    if result.stdout.strip():
        print(f"    {result.stdout.strip()}")
    if check and result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        sys.exit(1)
    return result


def run_ok(cmd, check=True):
    """Run a shell command and return stdout string (convenience wrapper)."""
    return run(cmd, check=check).stdout.strip()


# ───────────────────────── Pre-flight checks ─────────────────────────

# ── Two sessions at once ─────────────────────────────────────────────────────
# 2026-10-28: two Claude sessions released the same day. One took 0.38.191
# while the other had already numbered its work 0.38.191; both wrote at the top
# of CHANGELOG.md and clashed; and a push failed because the other had pushed
# meanwhile. So a release now (1) holds a lock every checkout on this computer
# shares, (2) starts from origin/main, (3) takes the next free version if the
# one asked for is taken, (4) gathers changelog.d/ notes into CHANGELOG.md, and
# (5) merges what others pushed meanwhile and pushes again.

LOCK_WAIT_S = 90 * 60        # a release takes ~15 min; wait up to 90 for another
LOCK_POLL_S = 15
NOTES_DIR = ROOT / "changelog.d"
NOTE_SECTIONS = ("New", "Changed", "Fixed")   # the order a release's headings go in


def _lock_path():
    """In git's own directory, which every worktree of this repository shares
    (a release run from a worktree has another ROOT, the same lock)."""
    common = subprocess.run("git rev-parse --git-common-dir", shell=True, text=True,
                            capture_output=True, cwd=ROOT).stdout.strip()
    base = pathlib.Path(common) if common else ROOT / ".git"
    if not base.is_absolute():
        base = ROOT / base
    return base / "padspan-release.lock"


# The lock is the operating system's own (msvcrt on Windows, flock elsewhere)
# on an open file: one process holds it at a time, and a release that dies
# lets go with it, so there is no "is its process still alive" to get wrong.
# (A lock that was only a file, created then written, let two releases in:
# tests/test_release_two_sessions.py races four processes for it.) What the
# file says (whose release, since when) is only for the message a waiting
# release prints; the byte locked is far past it so it stays readable.
_LOCK_BYTE = 1 << 20
_HELD = {}


def _try_lock(f):
    try:
        if os.name == "nt":
            import msvcrt  # noqa: PLC0415
            f.seek(_LOCK_BYTE)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl  # noqa: PLC0415
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def _unlock(f):
    try:
        if os.name == "nt":
            import msvcrt  # noqa: PLC0415
            f.seek(_LOCK_BYTE)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl  # noqa: PLC0415
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass


def _holder(path):
    try:
        return json.loads(pathlib.Path(path).read_text(encoding="utf-8").strip("\0 \n") or "{}")
    except (OSError, ValueError):
        return {}


def acquire_release_lock(version, path=None, wait_s=LOCK_WAIT_S, poll_s=LOCK_POLL_S, now=time.time, sleep=time.sleep):
    """Take the release lock, waiting while another release holds it.
    Returns the lock's path; exits, nothing changed, if another release still
    holds it after `wait_s`."""
    path = pathlib.Path(path or _lock_path())
    f = open(path, "a+", encoding="utf-8")
    deadline = now() + wait_s
    said = None
    while not _try_lock(f):
        held = _holder(path)
        if now() >= deadline:
            f.close()
            print(f"  ERROR: another release ({held.get('version', '?')}, pid {held.get('pid', '?')}, started {held.get('started', '?')}) "
                  f"still holds {path}. Nothing was changed.")
            sys.exit(1)
        if said != held.get("pid"):
            print(f"  Another release is running ({held.get('version', '?')}, pid {held.get('pid', '?')}, started {held.get('started', '?')}): waiting for it.")
            said = held.get("pid")
        sleep(poll_s)
    f.seek(0)
    f.truncate()
    f.write(json.dumps({"pid": os.getpid(), "version": version,
                        "started": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds")}))
    f.flush()
    _HELD[str(path)] = f
    return path


def release_release_lock(path):
    """Let go of the lock, if this process holds it."""
    f = _HELD.pop(str(path), None)
    if f is None:
        return
    _unlock(f)
    f.close()


def _vkey(v):
    return tuple(int(x) for x in re.findall(r"\d+", v))


def next_free_version(version, taken):
    """`version` if no tag has it, else the next patch number no tag has."""
    taken = {t.lstrip("v") for t in taken}
    parts = [int(x) for x in version.split(".")]
    while ".".join(map(str, parts)) in taken:
        parts[-1] += 1
    return ".".join(map(str, parts))


def _tags():
    local = subprocess.run("git tag", shell=True, text=True, capture_output=True, cwd=ROOT).stdout.split()
    remote = subprocess.run(f"git ls-remote --tags origin", shell=True, text=True, capture_output=True, cwd=ROOT).stdout
    return set(local) | {ln.split("refs/tags/")[-1].replace("^{}", "") for ln in remote.splitlines() if "refs/tags/" in ln}


def latest_tag_version(taken):
    vs = [t.lstrip("v") for t in taken if re.fullmatch(r"v?\d+\.\d+\.\d+", t)]
    return max(vs, key=_vkey) if vs else None


def sync_with_origin():
    """Start from what everyone has pushed: fetch, then fast-forward. A
    checkout with work of its own not on origin stops here, unchanged."""
    run_ok("git fetch --tags origin")
    res = run("git pull --ff-only", check=False)
    if res.returncode != 0:
        print("  ERROR: this checkout can't fast-forward to origin/main (it has commits or changes of its own).\n"
              "  Merge or commit them first; nothing was changed.")
        sys.exit(1)


def note_files(notes_dir=None):
    d = pathlib.Path(notes_dir or NOTES_DIR)
    return sorted(p for p in d.glob("*.md") if p.name.lower() != "readme.md") if d.is_dir() else []


def changelog_from_notes(changelog, notes, version, date):
    """CHANGELOG.md's text with one new "## version — title (date)" section on
    top, made of `notes` [(text)]: each note is "# Its title" then "### New" /
    "### Changed" / "### Fixed" (or any other heading) and its lines; lines
    before any heading count as Changed. Titles join with "; "."""
    titles, sections = [], {}
    for text in notes:
        head = "Changed"
        for ln in text.splitlines():
            if ln.startswith("# ") and not ln.startswith("## "):
                titles.append(ln[2:].strip())
            elif ln.startswith("### "):
                head = ln[4:].strip()
            elif ln.strip():
                sections.setdefault(head, []).append(ln.rstrip())
    if not titles or not any(sections.values()):
        raise ValueError("each changelog.d note needs a '# title' line and at least one entry")
    order = [h for h in NOTE_SECTIONS if h in sections] + [h for h in sections if h not in NOTE_SECTIONS]
    body = "\n\n".join(f"### {h}\n" + "\n".join(sections[h]) for h in order)
    entry = f"## {version} \u2014 {'; '.join(titles)} ({date})\n\n{body}\n\n---\n\n"
    at = changelog.find("\n## ")
    if at == -1:
        return changelog.rstrip("\n") + "\n\n" + entry
    return changelog[:at + 1] + entry + changelog[at + 1:]


def gather_notes(version):
    """changelog.d/*.md into CHANGELOG.md as this release's section, and the
    notes removed (the release commit records both). None: no notes, and
    CHANGELOG.md is used as it is."""
    notes = note_files()
    if not notes:
        return None
    path = ROOT / "CHANGELOG.md"
    text = path.read_text(encoding="utf-8")
    if _changelog_section(version):
        print(f"  ERROR: CHANGELOG.md already has a {version} section and changelog.d/ has notes too: use one or the other.")
        sys.exit(1)
    date = datetime.date.today().isoformat()
    try:
        new = changelog_from_notes(text, [n.read_text(encoding="utf-8") for n in notes], version, date)
    except ValueError as err:
        print(f"  ERROR: {err}")
        sys.exit(1)
    path.write_text(new, encoding="utf-8", newline="\n")
    for n in notes:
        n.unlink()
    print(f"  CHANGELOG.md: {version} made from {len(notes)} note(s): {', '.join(n.name for n in notes)}")
    return len(notes)


def preflight_checks():
    """
    Validate repo structure before doing anything destructive.
    Catches the mistakes that previously broke HACS downloads.
    """
    errors = []

    # 1. hacs.json must exist and have correct settings
    hacs_path = ROOT / "hacs.json"
    if not hacs_path.exists():
        errors.append("hacs.json missing from repo root")
    else:
        hacs = json.loads(hacs_path.read_text(encoding="utf-8"))
        # content_in_root MUST be false — our manifest is inside
        # custom_components/padspan_ha/, not at repo root.
        if hacs.get("content_in_root") is not False:
            errors.append(
                'hacs.json: "content_in_root" must be false '
                "(manifest.json lives in custom_components/padspan_ha/, not repo root)"
            )
        # zip_release is optional — both true (HACS downloads the zip asset)
        # and false (HACS does a git checkout) are valid install methods.
        # If true, filename must match the asset this script uploads.
        if hacs.get("zip_release") and hacs.get("filename") != "padspan_ha.zip":
            errors.append('hacs.json: "filename" must be "padspan_ha.zip" when zip_release is true')

    # 2. manifest.json must exist inside the integration dir
    manifest_path = INTEGRATION / "manifest.json"
    if not manifest_path.exists():
        errors.append(f"manifest.json missing from {INTEGRATION}")
    else:
        m = json.loads(manifest_path.read_text(encoding="utf-8"))
        if m.get("domain") != "padspan_ha":
            errors.append(f'manifest.json: "domain" must be "padspan_ha", got {m.get("domain")!r}')

    # 3. No __pycache__ should be staged in git — it pollutes the git tree
    #    and can break HACS tree traversal (get_first_directory_in_directory).
    staged = subprocess.run(
        "git diff --cached --name-only", shell=True, text=True, capture_output=True
    ).stdout
    tracked = subprocess.run(
        "git ls-files", shell=True, text=True, capture_output=True
    ).stdout
    for line in (staged + tracked).splitlines():
        if "__pycache__" in line or line.endswith(".pyc"):
            errors.append(
                f"__pycache__/.pyc file tracked in git: {line}\n"
                "    Run: git rm -r --cached <path> to untrack it.\n"
                "    __pycache__ in the git tree breaks HACS validation."
            )
            break  # one warning is enough

    if errors:
        print("\n  PREFLIGHT FAILED:")
        for e in errors:
            print(f"    ✗ {e}")
        print()
        sys.exit(1)

    print("  All checks passed.")


def run_tests():
    """
    Run the unit test suite.  A failing suite ABORTS the release before
    any files are modified, committed, or pushed.
    """
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    # Every core when pytest-xdist is installed (requirements_test.txt), as
    # bright_build.run_suite does: ~6.5 min -> ~2.5; one process without it.
    import importlib.util  # noqa: PLC0415
    par = ["-n", "auto"] if importlib.util.find_spec("xdist") else []
    print(f"  $ {sys.executable} -m pytest tests -q --no-header {' '.join(par)}".rstrip())
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests", "-q", "--no-header", *par],
        cwd=ROOT, env=env, text=True, capture_output=True,
    )
    # Print the tail of pytest's output (summary + failures) indented
    lines = (result.stdout or "").strip().splitlines()
    for line in lines[-15:]:
        print(f"    {line}")
    if result.returncode != 0:
        print("\n  TESTS FAILED — release aborted.")
        print("  Fix the failures (python -m pytest tests -q), then re-run the release.")
        sys.exit(1)
    print("  Test suite green.")


# ───────────────────────── Version bumping ───────────────────────────

def update_version_files(version, build_id, channel):
    """Bump version + build ID + channel in all source files."""

    old_build_id = re.search(
        r'BUILD_ID = "(\w+)"',
        (INTEGRATION / "build_info.py").read_text(encoding="utf-8")
    )
    old_build_id = old_build_id.group(1) if old_build_id else None

    # manifest.json
    m = json.loads((INTEGRATION / "manifest.json").read_text(encoding="utf-8"))
    m["version"] = version
    (INTEGRATION / "manifest.json").write_text(
        json.dumps(m, indent=2) + "\n", encoding="utf-8"
    )
    print(f"  manifest.json        -> {version}")

    # const.py
    p = INTEGRATION / "const.py"
    p.write_text(
        re.sub(r'VERSION = "[^"]+"', f'VERSION = "{version}"', p.read_text(encoding="utf-8")),
        encoding="utf-8"
    )
    print(f"  const.py             -> {version}")

    # build_info.py
    p = INTEGRATION / "build_info.py"
    content = p.read_text(encoding="utf-8")
    content = re.sub(r'BUILD_VERSION = "[^"]+"', f'BUILD_VERSION = "{version}"', content)
    content = re.sub(r'BUILD_ID = "[^"]+"',      f'BUILD_ID = "{build_id}"',      content)
    content = re.sub(r'CHANNEL = "[^"]+"',        f'CHANNEL = "{channel}"',        content)
    p.write_text(content, encoding="utf-8")
    print(f"  build_info.py        -> {version} / {build_id} / {channel}")

    # VERSION.txt
    (ROOT / "VERSION.txt").write_text(
        f"padspanHA package version: {version}\n", encoding="utf-8"
    )
    print(f"  VERSION.txt          -> {version}")

    # panel.js — version, build id, channel, and all import cache-busters
    content = PANEL_JS.read_text(encoding="utf-8")
    content = re.sub(r'const APP_VERSION = "[^"]+"', f'const APP_VERSION = "{version}"', content)
    # The literal is the FALLBACK stamp (the live one comes from panel.py's
    # ?b= URL). It was renamed RELEASE_BUILD_ID on 2026-08-16 and this regex
    # kept matching nothing, so the fallback sat at that day's build for
    # every release after. Matches either spelling.
    content = re.sub(r'const (RELEASE_)?BUILD_ID = "[^"]+"',
                     lambda m: f'const {m.group(1) or ""}BUILD_ID = "{build_id}"', content)
    content = re.sub(r'const CHANNEL = "[^"]+"',     f'const CHANNEL = "{channel}"',      content)
    content = re.sub(r'\?b=\w+', f'?b={build_id}', content)
    PANEL_JS.write_text(content, encoding="utf-8")
    print(f"  panel.js             -> {version} / {build_id} / {channel}")

    # lights_panel.js
    lights_js = INTEGRATION / "www" / "padspan-ha" / "lights_panel.js"
    if lights_js.exists():
        content = lights_js.read_text(encoding="utf-8")
        content = re.sub(r'const APP_VERSION\s*=\s*"[^"]+"', f'const APP_VERSION = "{version}"', content)
        content = re.sub(r'const BUILD_ID\s*=\s*"[^"]+"',    f'const BUILD_ID = "{build_id}"',    content)
        content = re.sub(r'\?b=\w+', f'?b={build_id}', content)
        lights_js.write_text(content, encoding="utf-8")
        print(f"  lights_panel.js      -> {version} / {build_id}")


# ───────────────────────── Zip building ──────────────────────────────

def build_zip():
    """
    Build dist/padspan_ha.zip with FLAT structure (files at root).

    The zip has NO directory prefix — e.g. manifest.json sits at the zip
    root, not inside padspan_ha/manifest.json.  This is correct because
    HACS extracts the zip directly into:
        <ha_config>/custom_components/padspan_ha/
    So each file lands exactly where HA expects it.
    """
    ZIP_PATH.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(INTEGRATION.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
                zf.write(f, f.relative_to(INTEGRATION))
    count = len(zipfile.ZipFile(ZIP_PATH).namelist())
    print(f"  {count} files -> dist/padspan_ha.zip")


def validate_zip():
    """
    Post-build sanity check: confirm the zip contains manifest.json
    with the correct domain, and that it's readable.
    """
    errors = []
    with zipfile.ZipFile(ZIP_PATH, "r") as zf:
        names = zf.namelist()

        if "manifest.json" not in names:
            errors.append("manifest.json missing from zip root")
        else:
            m = json.loads(zf.read("manifest.json").decode("utf-8"))
            if m.get("domain") != "padspan_ha":
                errors.append(f'zip manifest.json domain={m.get("domain")!r}, expected "padspan_ha"')

        if "__init__.py" not in names:
            errors.append("__init__.py missing from zip root")

        # Check no __pycache__ leaked into the zip
        pycache = [n for n in names if "__pycache__" in n or n.endswith(".pyc")]
        if pycache:
            errors.append(f"__pycache__/.pyc files in zip: {pycache[:3]}")

    if errors:
        print("\n  ZIP VALIDATION FAILED:")
        for e in errors:
            print(f"    ✗ {e}")
        print()
        sys.exit(1)

    print(f"  Zip OK: {len(names)} files, manifest.json domain=padspan_ha")


# ───────────────────────── PadSpan Bright ────────────────────────────

def bright_pass(version, channel, message=None):
    """
    Derive PadSpan Bright from the tree that was just released, prove it, and
    (when BRIGHT_PUBLISH) ship it. See scripts/bright_build.py for what the
    derivation is; this is only the sequence.

    Runs AFTER the full release is out. A Bright failure cannot hold PadSpan
    HA back — but it exits non-zero, so a broken Bright is never quiet.
    """
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="padspan-bright-"))
    tree = tmp / "tree"
    print("  Deriving the Bright tree (copy → rename → stamp → verify)...")
    bright_build.build(tree, ROOT)
    print(f"    {tree}")

    print("  Running the suite INSIDE the Bright tree...")
    res = bright_build.run_suite(tree)
    for line in (res.stdout or "").strip().splitlines()[-8:]:
        print(f"    {line}")
    if res.returncode != 0:
        print("\n  BRIGHT SUITE FAILED — the full release is out; Bright was NOT built.")
        print(f"  Tree kept for inspection: {tree}")
        sys.exit(1)

    n = bright_build.build_zip(tree, BRIGHT_ZIP)
    print(f"  {n} files -> dist/{BRIGHT_ZIP.name}")

    if not BRIGHT_PUBLISH:
        print("  Bright built and verified — NOT published (BRIGHT_PUBLISH is False;")
        print("  flip it in scripts/release.py when the listing goes live).")
        return
    sha = subprocess.run("git rev-parse HEAD", shell=True, text=True, capture_output=True).stdout.strip()
    print(f"  Publishing to {bright_build.BRIGHT_REPO} ...")
    bright_build.publish(tree, BRIGHT_ZIP, version, channel, sha, message)
    print(f"  PadSpan Bright v{version} ({channel}) is live.")


# ───────────────────────── Git operations ────────────────────────────

def git_commit_tag_push(version, tag, message=None):
    """Stage all integration files + static files, commit, tag, push."""

    # Auto-discover all files under custom_components/padspan_ha/
    # (excludes __pycache__ and .pyc — those must never be committed)
    discovered = []
    for f in sorted(INTEGRATION.rglob("*")):
        if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
            discovered.append(str(f.relative_to(ROOT)).replace("\\", "/"))

    all_files = STATIC_FILES + discovered
    # `git add` with every path quoted on one command line blows Windows'
    # ~8191-char CreateProcess limit once the integration grows past ~120
    # files (hit at 0.38.23, 150 files). --pathspec-from-file reads the list
    # from a temp file instead, so the command line itself stays short no
    # matter how many files a release stages.
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        f.write("\n".join(all_files) + "\n")
        pathspec_file = f.name
    try:
        run_ok(f'git add --pathspec-from-file="{pathspec_file}"')
    finally:
        os.unlink(pathspec_file)
    # The changelog.d notes gathered into CHANGELOG.md are gone: stage that too.
    run(f'git add -A -- "{NOTES_DIR.relative_to(ROOT).as_posix()}"', check=False)
    commit_msg = message or f"release {tag}"
    # Escape double quotes in message for shell safety
    safe_msg = commit_msg.replace('"', '\\"')
    run_ok(f'git commit -m "{safe_msg}"')
    run_ok(f"git tag {tag}")

    push_release(tag)


def push_release(tag, attempts=3, run_=None, sleep=time.sleep):
    """Push the release commit, then its tag. A push refused because someone
    pushed meanwhile merges theirs in (the tag stays on the release commit)
    and pushes again; a merge that conflicts is undone and stops here, the
    commit and tag kept locally to push by hand. GitHub's odd HTTP 500 is
    retried as before."""
    run_ = run_ or (lambda cmd: run(cmd, check=False))
    for attempt in range(attempts):
        if run_("git push").returncode == 0:
            break
        print(f"    Push failed (attempt {attempt + 1}/{attempts}): taking in what was pushed meanwhile...")
        if run_("git pull --no-rebase --no-edit origin main").returncode != 0:
            run_("git merge --abort")
            print(f"  ERROR: what was pushed meanwhile conflicts with this release. {tag} is committed and tagged here,\n"
                  "  not pushed: merge origin/main by hand, then git push and git push origin " + tag)
            sys.exit(1)
        sleep(3)
    else:
        print("  ERROR: git push failed after 3 attempts")
        sys.exit(1)
    for attempt in range(attempts):
        if run_(f"git push origin {tag}").returncode == 0:
            break
        print(f"    Tag push failed (attempt {attempt + 1}/{attempts}), retrying in 3s...")
        sleep(3)
    else:
        print(f"  ERROR: the release commit is pushed but the tag {tag} isn't: git push origin {tag}")
        sys.exit(1)


# ───────────────────────── GitHub release ────────────────────────────

# Every release's notes end with this. HACS shows the notes to everyone who
# updates, the widest audience PadSpan has (Garry, 2026-10-15). Change or
# empty it here; an empty string adds nothing.
RELEASE_NOTES_FOOTER = (
    "\n\n### PadSpan Pro free\n"
    "Testers get two years of PadSpan Pro while the anonymous usage report stays on: "
    "Settings → Presence → Help improve PadSpan. More ways: https://padspan.traks.ca/#pro-free"
)

def create_github_release(tag, channel, message=None):
    """
    Create a GitHub release and upload the zip asset.

    GitHub API sometimes returns HTTP 500.  When `gh release create` fails,
    we fall back to:
      1. gh api  repos/.../releases  (create the release object)
      2. gh release upload            (attach the zip asset)
    """
    is_prerelease = channel != "stable"
    channel_label = "BETA" if is_prerelease else "STABLE"
    summary = message or f"Release {tag}"
    notes = (
        f"## PadSpan HA {tag} ({channel_label})\n\n"
        f"{summary}\n\n"
        "### Install / Update\n"
        "Install or update via HACS: search for PadSpan HA (it is in the HACS default list)."
        + RELEASE_NOTES_FOOTER
    )

    # ── Attempt 1: gh release create (one-shot, preferred) ──
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(notes)
        notes_file = f.name

    prerelease_flag = " --prerelease" if is_prerelease else ""
    try:
        result = run(
            f'gh release create {tag} "{ZIP_PATH}" '
            f'--title "{tag}" '
            f'--notes-file "{notes_file}" '
            f'--repo {REPO}{prerelease_flag}',
            check=False,
        )
        if result.returncode == 0:
            return  # success
        print("    gh release create failed, trying API fallback...")
    finally:
        os.unlink(notes_file)

    # ── Attempt 2: gh api + gh release upload (two-step fallback) ──
    prerelease_api = " -F prerelease=true" if is_prerelease else ""
    for attempt in range(3):
        result = run(
            f'gh api repos/{REPO}/releases '
            f'-f tag_name={tag} -f name={tag} -f body="{tag}"{prerelease_api}',
            check=False,
        )
        if result.returncode == 0:
            break
        print(f"    API release create failed (attempt {attempt + 1}/3), retrying in 3s...")
        time.sleep(3)
    else:
        print("  ERROR: Could not create GitHub release after all attempts.")
        print("  The code is pushed. Create the release manually:")
        print(f'    gh release create {tag} "dist/padspan_ha.zip" --title "{tag}" --notes "{tag}" --repo {REPO}')
        sys.exit(1)

    # Upload the zip asset
    for attempt in range(3):
        result = run(
            f'gh release upload {tag} "{ZIP_PATH}" --repo {REPO}',
            check=False,
        )
        if result.returncode == 0:
            return
        print(f"    Asset upload failed (attempt {attempt + 1}/3), retrying in 3s...")
        time.sleep(3)

    print("  ERROR: Release created but zip upload failed.")
    print("  Upload manually:")
    print(f'    gh release upload {tag} "dist/padspan_ha.zip" --repo {REPO}')
    sys.exit(1)


# ───────────────────────── Main ──────────────────────────────────────

# ── Update-check manifest ────────────────────────────────────────────────────
# https://padspan.traks.ca/api/version.php serves api/latest.json to every
# install's daily update check — it is the ONLY way an install ever hears a
# release happened. It was hand-maintained on the colo and nobody bumped it:
# 0.35.0 went stable on 2026-08-18 and five days later the manifest still said
# 0.21.13, which is why two thirds of the pinging install base sat on 0.21.13.
# The release that creates a version now tells the manifest about it.
MANIFEST_HOST = "administrator@75.157.233.12"
MANIFEST_PATH = "/var/www/clients/client1/web10/web/padspan/api/latest.json"
MANIFEST_URL = "https://padspan.traks.ca/api/version.php"
_SSH = "ssh -o BatchMode=yes -o ConnectTimeout=15"


def _changelog_section(version):
    """Return (title, date, body) for CHANGELOG.md's own section on `version`,
    or None if it isn't there. Anchored to a bare "## X.Y.Z — title (date)"
    header — the exact shape every entry has used since this repo started."""
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    pattern = re.compile(
        r"^## " + re.escape(version) + r"\s*[—-]\s*(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$",
        re.MULTILINE)
    m = pattern.search(changelog)
    if not m:
        return None
    title, date = m.group(1), m.group(2)
    nxt = changelog.find("\n## ", m.end())
    body = changelog[m.end(): nxt if nxt != -1 else len(changelog)]
    return title, date, body


# ── Release notes inside the panel ───────────────────────────────────────────
# The Overview's "PadSpan HA updated" card opened padspan.traks.ca in a new tab,
# and on a wall screen (Chrome --kiosk, touch only) a new tab can't be closed:
# the screen was stuck on the website. The card now shows the notes in the
# panel itself, from this file, shipped with the integration so it works with
# no internet. Written here, from CHANGELOG.md, before the zip is built; it
# lives under custom_components/, so the zip and the release commit both
# carry it with no list to add it to.
PANEL_NOTES = INTEGRATION / "www" / "padspan-ha" / "assets" / "whatsnew.json"
# Enough to reach back past the last stable: someone going stable to stable
# (0.38.144 to 0.38.157 was thirteen versions) sees every step in the panel.
PANEL_NOTES_COUNT = 14
_SECTION_HEAD = re.compile(r"^## (\d+\.\d+\.\d+)\s*[—-]\s*(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$")


def changelog_sections(changelog):
    """Every "## X.Y.Z — title (date)" section of CHANGELOG.md text, newest
    first, as {version, title, date, body_markdown}. Headers of any other
    shape ("## 0.38.11 / 0.38.12 — ...", "## 0.4.x — ...") are skipped."""
    heads = list(re.finditer(r"^## .*$", changelog, re.MULTILINE))
    out = []
    for i, h in enumerate(heads):
        m = _SECTION_HEAD.match(h.group(0))
        if not m:
            continue
        end = heads[i + 1].start() if i + 1 < len(heads) else len(changelog)
        body = changelog[h.end():end].strip()
        body = re.sub(r"\n-{3,}$", "", body).strip()   # the --- between sections
        out.append({"version": m.group(1), "title": m.group(2), "date": m.group(3),
                    "body_markdown": body})
    out.sort(key=lambda s: tuple(int(n) for n in s["version"].split(".")), reverse=True)
    return out


def write_panel_notes(count=PANEL_NOTES_COUNT):
    """Write the newest `count` CHANGELOG.md sections to PANEL_NOTES.
    Returns the sections written."""
    notes = changelog_sections((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))[:count]
    if not notes:
        print("  ERROR: CHANGELOG.md has no '## X.Y.Z — title (date)' sections for the panel's notes")
        sys.exit(1)
    PANEL_NOTES.parent.mkdir(parents=True, exist_ok=True)
    PANEL_NOTES.write_text(json.dumps(notes, ensure_ascii=False, indent=1) + "\n",
                           encoding="utf-8", newline="\n")
    print(f"  {PANEL_NOTES.relative_to(ROOT).as_posix()} -> {', '.join(n['version'] for n in notes)}")
    return notes


def _md_inline_to_html(text):
    # Escaped first: `device_tracker.<name>_2` in a changelog line was eaten by
    # the browser as a tag on the live page.
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def update_whatsnew_entry(version, channel):
    """Prepend one auto-generated #whatsnew entry to site/index.html, built
    straight from this release's own CHANGELOG.md section.

    GitHub #72: the whatsnew section is hand-authored prose, and nothing ever
    forced anyone to update it — 25 releases (v0.38.7 through v0.38.31) went
    out with the page never mentioning any of them. release.py already
    publishes the version manifest so *that* can't drift; this closes the
    same hole for the page a human actually reads. It only touches the repo
    copy — deploy_site.py still only ships site/index.html on a --stable
    release, same as before, so a beta's entry lands on the live page the
    next time a stable release runs.

    Never raises. A miss here must be SEEN (non-zero exit from main) but must
    not unwind a release that is otherwise already out."""
    site_path = ROOT / "site" / "index.html"
    html = site_path.read_text(encoding="utf-8")

    if f'<span class="relver">v{version}<' in html:
        print(f"  whatsnew: v{version} already present in site/index.html, skipping")
        return True

    section = _changelog_section(version)
    if not section:
        print(f"  !! whatsnew: no CHANGELOG.md section found for {version} — "
              "site/index.html was NOT updated. Add the CHANGELOG entry (it "
              "should already exist — CHANGELOG.md is written before this "
              "script runs) and re-run, or edit site/index.html by hand.")
        return False
    title, date, body = section
    bullets = re.findall(r"^- (.+)$", body, re.MULTILINE)
    if not bullets:
        print(f"  !! whatsnew: CHANGELOG.md section for {version} has no '- ' "
              "bullets to draw from — site/index.html was NOT updated.")
        return False

    marker = '  <div class="rel" style="margin-top:26px">\n'
    if marker not in html:
        print("  !! whatsnew: could not find the entry-list insertion point "
              "in site/index.html (the \"rel\" wrapper div) — NOT updated.")
        return False

    pill = ('<span class="pill stable">Stable</span>' if channel == "stable"
            else '<span class="pill soon">Beta channel</span>')
    date_str = f"{datetime.datetime.strptime(date, '%Y-%m-%d'):%-d %B %Y}" if os.name != "nt" \
        else "{} {:%B %Y}".format(datetime.datetime.strptime(date, "%Y-%m-%d").day,
                                   datetime.datetime.strptime(date, "%Y-%m-%d"))
    items = "\n".join(f"          <li>{_md_inline_to_html(b)}</li>" for b in bullets)
    entry = (
        '    <div class="relitem">\n'
        '      <div class="relhead">\n'
        f'        <span class="relver">v{version}</span>\n'
        f'        {pill}\n'
        f'        <span class="reldate">{date_str}</span>\n'
        '      </div>\n'
        '      <div class="relbody">\n'
        '        <ul>\n'
        f'{items}\n'
        '        </ul>\n'
        '      </div>\n'
        '    </div>\n'
    )
    site_path.write_text(html.replace(marker, marker + "\n" + entry, 1), encoding="utf-8")
    print(f"  whatsnew: added v{version} ({title}) to site/index.html — {len(bullets)} bullet(s)")
    return True


def publish_update_manifest(version, channel):
    """Bump latest.json on the colo: every release moves latest_beta, a
    stable release moves latest_stable with it. Returns True on verified
    success. Never raises — the GitHub release is already out, so a colo
    hiccup must be SEEN (red, non-zero exit in main) but must not unwind
    anything."""
    import urllib.request
    try:
        cur = run(f'{_SSH} {MANIFEST_HOST} "sudo -n cat {MANIFEST_PATH}"', check=False)
        try:
            manifest = json.loads(cur.stdout) if cur.returncode == 0 else {}
        except json.JSONDecodeError:
            manifest = {}
        # Where the in-panel "update available" notification sends people.
        # setdefault would never correct an older manifest, and a bare list of
        # git tags is a poor landing place for someone who just learned an
        # update exists: the site says what changed in plain terms, links the
        # full changelog, and is where a licence is bought.
        # ?hl=en: the notes are English only, so skip the German page site/.htaccess
        # would otherwise send visitors from Germany, Austria and Switzerland to.
        manifest["notes_url"] = "https://padspan.traks.ca/?hl=en#whatsnew"
        manifest["latest_beta"] = version
        if channel == "stable":
            manifest["latest_stable"] = version
        body = json.dumps(manifest, separators=(",", ":"))
        # tee truncates the existing file in place, so www-data keeps owning it
        result = subprocess.run(
            f'{_SSH} {MANIFEST_HOST} "sudo -n tee {MANIFEST_PATH} > /dev/null"',
            shell=True, text=True, input=body, capture_output=True)
        if result.returncode != 0:
            print(f"  manifest write failed: {result.stderr.strip()}")
            return False
        # Verify through the real endpoint — the write is only done when the
        # update check would actually say so.
        # Cloudflare fronts the endpoint and 403s urllib's default UA.
        req = urllib.request.Request(MANIFEST_URL, headers={"User-Agent": "padspan-release"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            served = json.loads(resp.read().decode("utf-8"))
        ok = served.get("latest_beta") == version and (
            channel != "stable" or served.get("latest_stable") == version)
        print(f"  version.php now serves: {served}")
        return ok
    except Exception as e:
        print(f"  manifest publish failed: {e}")
        return False


def wait_for_ci(tag, timeout_s=1200, every_s=20):
    """GitHub's checks on the tag (Tests, Hassfest, HACS), waited for and
    reported. 0.38.188 and 0.38.189 went out red (an undeclared Pillow) and
    nobody saw it, because a release never looked. True: every run passed.
    """
    deadline = time.time() + timeout_s
    seen = []
    while time.time() < deadline:
        res = subprocess.run(
            f'gh run list --repo {REPO} --branch {tag} --json workflowName,status,conclusion,url',
            shell=True, text=True, capture_output=True)
        try:
            seen = json.loads(res.stdout or "[]")
        except ValueError:
            seen = []
        if seen and all(r.get("status") == "completed" for r in seen):
            break
        time.sleep(every_s)
    if not seen:
        print(f"  !! no GitHub checks seen for {tag}: look at https://github.com/{REPO}/actions")
        return False
    ok = True
    for r in sorted(seen, key=lambda r: r.get("workflowName", "")):
        state = r.get("conclusion") or r.get("status")
        good = state == "success"
        ok = ok and good
        print(f"  {'ok' if good else '!!'} {r.get('workflowName')}: {state}" + ("" if good else f"  {r.get('url')}"))
    return ok


def main():
    # Parse -m "message" flag for commit/release description
    argv = sys.argv[1:]
    message = None
    filtered = []
    i = 0
    while i < len(argv):
        if argv[i] in ("-m", "--message") and i + 1 < len(argv):
            message = argv[i + 1]
            i += 2
        else:
            filtered.append(argv[i])
            i += 1

    args = [a for a in filtered if not a.startswith("--")]
    flags = [a for a in filtered if a.startswith("--")]

    if len(args) != 1:
        print(__doc__)
        sys.exit(1)

    version = args[0].lstrip("v")
    channel = "stable" if "--stable" in flags else "beta"

    if "--manifest-only" in flags:
        print(f"\n=== Manifest only: {version} ({channel}) ===\n")
        sys.exit(0 if publish_update_manifest(version, channel) else 3)

    # One release at a time on this computer, from what everyone has pushed,
    # under a version no one has taken ("next": the one after the newest tag).
    print("Taking the release lock...")
    lock = acquire_release_lock(version)
    atexit.register(release_release_lock, lock)
    print("\nStarting from origin/main...")
    sync_with_origin()
    taken = _tags()
    if version == "next":
        newest = latest_tag_version(taken)
        if not newest:
            print("  ERROR: no tags to count on from: give the version")
            sys.exit(1)
        version = next_free_version(newest, taken)
        print(f"  next: {version}")
    else:
        free = next_free_version(version, taken)
        if free != version:
            print(f"  !! v{version} is already taken (another release): this one is v{free}.")
            version = free
    tag = f"v{version}"
    build_id = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")

    print(f"\n=== PadSpan HA Release: {tag}  build: {build_id}  channel: {channel} ===\n")

    print("Pre-flight checks...")
    preflight_checks()

    print("\nRunning tests...")
    run_tests()

    print("\nGathering changelog.d notes...")
    if gather_notes(version) is None:
        print("  none: CHANGELOG.md is used as it is")

    print("\nUpdating source files...")
    update_version_files(version, build_id, channel)

    print("\nUpdating What's New entry...")
    whatsnew_ok = update_whatsnew_entry(version, channel)
    if not whatsnew_ok:
        print("  !! site/index.html's #whatsnew section does not mention this "
              "release. Fix it (by hand or by re-running) before or after — "
              "it will not block the rest of this release.")

    print("\nWriting the panel's release notes...")
    write_panel_notes()

    print("\nBuilding zip...")
    build_zip()

    print("\nValidating zip...")
    validate_zip()

    print("\nCommitting, tagging, pushing...")
    git_commit_tag_push(version, tag, message)

    print("\nCreating GitHub release...")
    create_github_release(tag, channel, message)

    print("\nPublishing update-check manifest...")
    manifest_ok = publish_update_manifest(version, channel)
    if not manifest_ok:
        print("  !! latest.json on the colo was NOT updated — installs will not "
              "hear about this release until it is. Fix and re-run: "
              f"python scripts/release.py --manifest-only {version}"
              + (" --stable" if channel == "stable" else ""))

    print("\nWaiting for GitHub's checks on the tag...")
    ci_ok = wait_for_ci(tag)
    if not ci_ok:
        print(f"  !! {tag} is out but its checks did not all pass: fix it and release again.")

    # The landing page states the current STABLE version, so only a stable
    # release may restamp it — a beta must never advertise itself as stable.
    # The page also reads /api/version.php at runtime, so browsers self-correct
    # even if this step is skipped; this keeps the no-JavaScript fallback honest.
    site_ok = True
    if channel == "stable":
        print("\nDeploying the landing page...")
        site_res = run(f'"{sys.executable}" "{ROOT / "scripts" / "deploy_site.py"}"', check=False)
        site_ok = site_res.returncode == 0
        if not site_ok:
            print("  !! padspan.traks.ca was NOT updated. Re-run: python scripts/deploy_site.py")
    else:
        print("\nLanding page not touched (it names the stable release; this is a pre-release).")

    print(f"\n=== Done! {tag} ({channel}) is live on GitHub. ===\n")

    # The site, manifest and notes steps above don't touch Bright, so a miss
    # there still releases Bright (it used to exit first and leave Bright
    # users on the old version, the miss seen only in the exit code).
    if "--no-bright" in flags:
        print("PadSpan Bright pass skipped (--no-bright).\n")
    else:
        print("PadSpan Bright pass...")
        bright_pass(version, channel, message)
        print()

    if not manifest_ok or not site_ok or not whatsnew_ok or not ci_ok:
        print("  !! Released, but a step above failed (look for '!!'): exit 3.")
        sys.exit(3)


if __name__ == "__main__":
    main()
