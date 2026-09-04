#!/usr/bin/env python
"""
PadSpan HA release script.

Usage:
    python scripts/release.py <version> [--stable] [--no-bright]
    python scripts/release.py <version> --manifest-only [--stable]   # re-push latest.json only

Examples:
    python scripts/release.py 0.4.22            # beta (pre-release on GitHub)
    python scripts/release.py 0.4.22 --stable   # stable (Latest on GitHub)

What it does:
    1. Validates hacs.json + repo structure (catches HACS-breaking mistakes)
    2. Updates version in all source files
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
import re
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
    # The colo endpoints (version/telemetry/stats) live in the repo and are
    # deployed from it; a release must not leave the repo's copy behind.
    "server",
    "docs",
    # padspan.traks.ca is source now, not a file hand-edited on the colo, and a
    # stable release deploys it (scripts/deploy_site.py). It has to be staged
    # or the deploy would ship something the repo never recorded.
    "site",
    "scripts/deploy_site.py",
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
    print(f"  $ {sys.executable} -m pytest tests -q --no-header")
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "tests", "-q", "--no-header"],
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
    files = " ".join(f'"{p}"' for p in all_files)
    run_ok(f"git add {files}")
    commit_msg = message or f"release {tag}"
    # Escape double quotes in message for shell safety
    safe_msg = commit_msg.replace('"', '\\"')
    run_ok(f'git commit -m "{safe_msg}"')
    run_ok(f"git tag {tag}")

    # Push with retry — GitHub occasionally returns HTTP 500
    for attempt in range(3):
        result = run(f"git push", check=False)
        if result.returncode == 0:
            break
        print(f"    Push failed (attempt {attempt + 1}/3), retrying in 3s...")
        time.sleep(3)
    else:
        print("  ERROR: git push failed after 3 attempts")
        sys.exit(1)

    for attempt in range(3):
        result = run(f"git push origin {tag}", check=False)
        if result.returncode == 0:
            break
        print(f"    Tag push failed (attempt {attempt + 1}/3), retrying in 3s...")
        time.sleep(3)
    else:
        print("  ERROR: git push origin {tag} failed after 3 attempts")
        sys.exit(1)


# ───────────────────────── GitHub release ────────────────────────────

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
        "Install or update via HACS using this repository as a custom repository."
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
        manifest["notes_url"] = "https://padspan.traks.ca/#whatsnew"
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
    tag = f"v{version}"
    channel = "stable" if "--stable" in flags else "beta"

    if "--manifest-only" in flags:
        print(f"\n=== Manifest only: {version} ({channel}) ===\n")
        sys.exit(0 if publish_update_manifest(version, channel) else 3)
    build_id = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")

    print(f"\n=== PadSpan HA Release: {tag}  build: {build_id}  channel: {channel} ===\n")

    print("Pre-flight checks...")
    preflight_checks()

    print("\nRunning tests...")
    run_tests()

    print("\nUpdating source files...")
    update_version_files(version, build_id, channel)

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

    if not manifest_ok or not site_ok:
        sys.exit(3)

    if "--no-bright" in flags:
        print("PadSpan Bright pass skipped (--no-bright).\n")
        return
    print("PadSpan Bright pass...")
    bright_pass(version, channel, message)
    print()


if __name__ == "__main__":
    main()
