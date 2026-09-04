#!/usr/bin/env python3
"""
Derive PadSpan Bright from the PadSpan HA tree — a copy, renamed and stamped.

    python scripts/bright_build.py [OUT_DIR]      build only, print where it went

PadSpan Bright is not a fork. It is the same integration, generated at
release time from the tree that was just released, so it can never drift:
there is no second source to forget. What differs is four strings, two
directory names and one stamp — measured in docs/ (the Bright plan) before
this was written:

    padspan-lights   -> padspan-bright-lights   the Lights sidebar panel path
                                                and its web component, so the
                                                two editions can be installed
                                                side by side (the importer)
    padspan_ha       -> padspan_bright          the domain, every storage key,
                                                every websocket command on
                                                both sides, the static URLs
    padspan-ha       -> padspan-bright          the panel url_path, the web
                                                component, the asset folder
    PadSpan HA       -> PadSpan Bright          the visible product name

    custom_components/padspan_ha         -> custom_components/padspan_bright
    .../www/padspan-ha                   -> .../www/padspan-bright

    build_info.EDITION = "bright"        the ONE runtime switch (licence.py)

Nothing named padspan_ha is also a web address (the update check is
padspan.traks.ca, the licence check is product=padspan), so plain substring
replacement over text files is exact — and `verify()` proves it by grepping
the output for every old name and failing on the first hit.

THE RULE THAT MUST HOLD: this runs on a COPY. `build()` compares
`git status --porcelain` before and after and raises if the working tree
moved. A rename that touched the source would rewrite the product.

The generated tree carries the test suite (renamed with it) and `run_suite()`
runs it: a Bright zip that never ran the suite is the "nothing watches" gap
the plan warns about. tests/test_bright_build.py builds a tree from the
working copy and holds all of this.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FULL_DOMAIN = "padspan_ha"
BRIGHT_DOMAIN = "padspan_bright"
BRIGHT_NAME = "PadSpan Bright"
BRIGHT_REPO = "gbroeckling/padspanBright"

# Order matters: the more specific spelling first, so `padspan-lights` is not
# half-rewritten by the `padspan-ha` rule (it would not be — but the order
# makes the intent unmissable).
RENAMES: tuple[tuple[str, str], ...] = (
    ("padspan-lights", "padspan-bright-lights"),
    (FULL_DOMAIN, BRIGHT_DOMAIN),
    ("padspan-ha", "padspan-bright"),
    ("PadSpan HA", BRIGHT_NAME),
)
# What the output must not contain, anywhere, in any text file. `padspanHA`
# (the main repo's name, in documentation/issue_tracker URLs) is not in this
# list on purpose: Bright's docs and issues point at the main repo.
OLD_NAMES: tuple[str, ...] = tuple(old for old, _ in RENAMES)

# What travels. The integration and its suite, the HACS/legal/tooling files
# and validation workflows a public HACS repo needs, and the marks HACS shows.
# Docs, changelog, dist and backups stay behind — Bright's README is generated
# from scripts/bright_README.md.
COPY: tuple[str, ...] = (
    "custom_components", "tests", ".github",
    "hacs.json", "LICENSE", "pyproject.toml", "requirements_test.txt",
    "VERSION.txt", ".gitignore", "icon.png", "logo.png",
)
SKIP_DIRS = {"__pycache__", ".pytest_cache", ".git"}
SKIP_SUFFIXES = {".pyc", ".pyo", ".zip"}
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pdf"}


def _git_status(root: Path) -> str:
    try:
        return subprocess.run(["git", "status", "--porcelain"], cwd=root, text=True,
                              capture_output=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""  # not a git checkout (a copy of a copy) — nothing to compare


def _copy_tree(src: Path, dst: Path) -> None:
    def ignore(d, names):
        out = set()
        for n in names:
            p = Path(d) / n
            if n in SKIP_DIRS or (p.is_file() and p.suffix in SKIP_SUFFIXES):
                out.add(n)
        return out
    shutil.copytree(src, dst, ignore=ignore)


def _is_text(p: Path) -> bool:
    return p.suffix.lower() not in BINARY_SUFFIXES


def _rename_text(tree: Path) -> int:
    """Apply RENAMES to every text file under tree. Returns files changed."""
    changed = 0
    for p in sorted(tree.rglob("*")):
        if not p.is_file() or not _is_text(p):
            continue
        try:
            s = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue  # binary after all — leave it
        t = s
        for old, new in RENAMES:
            t = t.replace(old, new)
        if t != s:
            p.write_text(t, encoding="utf-8", newline="\n")
            changed += 1
    return changed


def _stamp(tree: Path, root: Path) -> None:
    """EDITION="bright" in build_info.py; manifest + hacs.json named; README."""
    integ = tree / "custom_components" / BRIGHT_DOMAIN
    bi = integ / "build_info.py"
    s = bi.read_text(encoding="utf-8")
    s2, n = re.subn(r'^EDITION = "[^"]+"', 'EDITION = "bright"', s, flags=re.M)
    if n != 1:
        raise RuntimeError("build_info.py has no EDITION line to stamp")
    bi.write_text(s2, encoding="utf-8", newline="\n")

    mp = integ / "manifest.json"
    m = json.loads(mp.read_text(encoding="utf-8"))
    m["domain"] = BRIGHT_DOMAIN
    m["name"] = BRIGHT_NAME
    # documentation / issue_tracker already point at the main repo — the
    # rename never touched `padspanHA` — and that is where they belong.
    mp.write_text(json.dumps(m, indent=2) + "\n", encoding="utf-8")

    hp = tree / "hacs.json"
    h = json.loads(hp.read_text(encoding="utf-8"))
    h["name"] = BRIGHT_NAME
    if h.get("zip_release"):
        h["filename"] = f"{BRIGHT_DOMAIN}.zip"
    hp.write_text(json.dumps(h, indent=2) + "\n", encoding="utf-8")

    readme_src = root / "scripts" / "bright_README.md"
    (tree / "README.md").write_text(readme_src.read_text(encoding="utf-8"), encoding="utf-8", newline="\n")


def verify(tree: Path) -> None:
    """Fail loudly if any old name survives anywhere in the output, if the
    directories were not renamed, or if the stamp did not land."""
    problems: list[str] = []
    integ = tree / "custom_components" / BRIGHT_DOMAIN
    if not integ.is_dir():
        problems.append(f"missing {integ.relative_to(tree)}")
    if (tree / "custom_components" / FULL_DOMAIN).exists():
        problems.append(f"custom_components/{FULL_DOMAIN} still present")
    if not (integ / "www" / "padspan-bright" / "panel.js").is_file():
        problems.append("www/padspan-bright/panel.js missing (asset folder not renamed)")
    for workflow in ("hacs.yml", "hassfest.yml"):
        if not (tree / ".github" / "workflows" / workflow).is_file():
            problems.append(f"missing HACS publication workflow: .github/workflows/{workflow}")
    for p in sorted(tree.rglob("*")):
        if not p.is_file() or not _is_text(p):
            continue
        rel = p.relative_to(tree)
        # The README is authored, not derived — it is the one file that is
        # SUPPOSED to talk about PadSpan HA (where to find the docs, how to
        # move across). Everything else must be clean.
        if rel.parts == ("README.md",):
            continue
        for part in rel.parts:
            for old in OLD_NAMES:
                if old in part:
                    problems.append(f"old name {old!r} in path {rel}")
        try:
            s = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for old in OLD_NAMES:
            if old in s:
                line = next(i for i, ln in enumerate(s.splitlines(), 1) if old in ln)
                problems.append(f"old name {old!r} survives in {rel}:{line}")
                break
    bi = (integ / "build_info.py").read_text(encoding="utf-8") if (integ / "build_info.py").is_file() else ""
    if 'EDITION = "bright"' not in bi:
        problems.append("build_info.EDITION is not \"bright\"")
    if 'TIER_FLOOR = "free"' not in bi:
        problems.append("build_info.TIER_FLOOR is not \"free\" — the free floor is permanent")
    m = json.loads((integ / "manifest.json").read_text(encoding="utf-8")) if (integ / "manifest.json").is_file() else {}
    if m.get("domain") != BRIGHT_DOMAIN or m.get("name") != BRIGHT_NAME:
        problems.append(f"manifest.json domain/name = {m.get('domain')!r}/{m.get('name')!r}")
    if problems:
        raise RuntimeError("Bright tree failed verification:\n  " + "\n  ".join(problems[:40]))


def build(out: Path, root: Path = ROOT) -> Path:
    """Generate the Bright tree at `out` (must not exist or be empty).

    The working tree at `root` is read, never written: git status is compared
    before and after and any difference raises.
    """
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        raise RuntimeError(f"refusing to build into a non-empty directory: {out}")
    out.mkdir(parents=True, exist_ok=True)
    before = _git_status(root)

    for name in COPY:
        src = root / name
        if not src.exists():
            raise RuntimeError(f"expected {name} in {root}")
        if src.is_dir():
            _copy_tree(src, out / name)
        else:
            shutil.copy2(src, out / name)

    # Directories first, so every path the text pass touches is final.
    (out / "custom_components" / FULL_DOMAIN).rename(out / "custom_components" / BRIGHT_DOMAIN)
    www = out / "custom_components" / BRIGHT_DOMAIN / "www"
    (www / "padspan-ha").rename(www / "padspan-bright")

    _rename_text(out)
    _stamp(out, root)
    verify(out)

    after = _git_status(root)
    if after != before:
        raise RuntimeError("the Bright build changed the working tree — it must only ever read it:\n"
                           + after)
    return out


def build_zip(tree: Path, zip_path: Path) -> int:
    """Flat zip of the Bright integration dir (same layout as padspan_ha.zip)."""
    integ = tree / "custom_components" / BRIGHT_DOMAIN
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(integ.rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
                zf.write(f, f.relative_to(integ))
    return len(zipfile.ZipFile(zip_path).namelist())


def run_suite(tree: Path) -> subprocess.CompletedProcess:
    """The renamed suite, run inside the generated tree."""
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    return subprocess.run([sys.executable, "-m", "pytest", "tests", "-q", "--no-header", "-p", "no:cacheprovider"],
                          cwd=tree, env=env, text=True, capture_output=True, encoding="utf-8")


def publish(tree: Path, zip_path: Path, version: str, channel: str, source_sha: str,
            message: str | None = None, repo: str = BRIGHT_REPO) -> None:
    """Push the generated tree to the Bright repo as one commit on top of its
    history (a clone, contents replaced — never a force-push), tag it, and
    publish the GitHub release with the zip attached. Pre-release unless the
    channel is stable, exactly like the main release."""
    tag = f"v{version}"
    work = tree.parent / "bright-repo"
    if work.exists():
        shutil.rmtree(work)
    subprocess.run(["git", "clone", "-q", f"https://github.com/{repo}.git", str(work)], check=True)
    # Replace every tracked file with the generated tree; .git stays.
    for p in list(work.iterdir()):
        if p.name == ".git":
            continue
        shutil.rmtree(p) if p.is_dir() else p.unlink()
    for p in tree.iterdir():
        if p.is_dir():
            shutil.copytree(p, work / p.name)
        else:
            shutil.copy2(p, work / p.name)
    msg = f"{BRIGHT_NAME} {tag} — generated from padspanHA {source_sha[:9]}"
    if message:
        msg += "\n\n" + message
    subprocess.run(["git", "add", "-A"], cwd=work, check=True)
    subprocess.run(["git", "commit", "-q", "-m", msg], cwd=work, check=True)
    subprocess.run(["git", "tag", tag], cwd=work, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD"], cwd=work, check=True)
    subprocess.run(["git", "push", "-q", "origin", tag], cwd=work, check=True)
    notes = message or f"{BRIGHT_NAME} {tag} ({channel}) — generated from padspanHA {source_sha[:9]}"
    pre = [] if channel == "stable" else ["--prerelease"]
    subprocess.run(["gh", "release", "create", tag, str(zip_path), "--repo", repo,
                    "--title", tag, "--notes", notes, *pre], check=True)


def main(argv: list[str]) -> int:
    out = Path(argv[0]) if argv else ROOT / "dist" / "bright"
    if out.exists():
        shutil.rmtree(out)
    build(out)
    n = build_zip(out, ROOT / "dist" / f"{BRIGHT_DOMAIN}.zip")
    print(f"Bright tree: {out}\n{n} files -> dist/{BRIGHT_DOMAIN}.zip")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
