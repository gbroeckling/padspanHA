#!/usr/bin/env python
"""
PadSpan HA release script.

Usage:
    python scripts/release.py <version> [--stable]

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
import os
import time

ROOT = pathlib.Path(__file__).parent.parent
INTEGRATION = ROOT / "custom_components" / "padspan_ha"
PANEL_JS  = INTEGRATION / "www" / "padspan-ha" / "panel.js"
ZIP_PATH = ROOT / "dist" / "padspan_ha.zip"
REPO = "gbroeckling/padspanHA"

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
]


def run(cmd, check=True):
    """Run a shell command, print it, and return stdout."""
    print(f"  $ {cmd}")
    args = cmd if isinstance(cmd, list) else cmd.split()
    result = subprocess.run(args, shell=False, text=True, capture_output=True)
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
        ["git", "diff", "--cached", "--name-only"], shell=False, text=True, capture_output=True
    ).stdout
    tracked = subprocess.run(
        ["git", "ls-files"], shell=False, text=True, capture_output=True
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
    content = re.sub(r'const BUILD_ID = "[^"]+"',    f'const BUILD_ID = "{build_id}"',    content)
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

    print(f"\n=== Done! {tag} ({channel}) is live on GitHub. ===\n")


if __name__ == "__main__":
    main()
