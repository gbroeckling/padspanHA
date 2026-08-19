"""The generated PadSpan Bright edition — scripts/bright_build.py.

Builds a Bright tree from THIS working copy into a temp dir and holds it to
the plan's guard 4 (the working tree is never touched — the rename runs on
a copy or it does not run) plus the derivation contract: every old name gone,
directories renamed, EDITION stamped, the free floor intact, the entity
platforms empty, and the release script publishing nothing until told to.

Skipped inside a Bright tree: a Bright tree does not derive a Bright tree.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "scripts"))

from custom_components.padspan_ha.build_info import EDITION  # noqa: E402

pytestmark = pytest.mark.skipif(EDITION != "full", reason="a Bright tree does not derive a Bright tree")

# scripts/ does not travel with the generated tree, so the import itself has
# to sit behind the edition check — a marker skips tests, not module code.
if EDITION == "full":
    import bright_build as bb  # noqa: E402


@pytest.fixture(scope="module")
def tree(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("bright") / "tree"
    return bb.build(out, _ROOT)


def _git_status() -> str:
    return subprocess.run(["git", "status", "--porcelain"], cwd=_ROOT, text=True,
                          capture_output=True).stdout


def test_the_working_tree_is_untouched(tmp_path):
    """Guard 4. Whatever state the checkout is in, it is in the same state after."""
    before = _git_status()
    src_before = {p: p.read_bytes() for p in (_ROOT / "custom_components" / "padspan_ha").rglob("*.py")}
    bb.build(tmp_path / "t", _ROOT)
    assert _git_status() == before
    assert (_ROOT / "custom_components" / "padspan_ha").is_dir()
    assert not (_ROOT / "custom_components" / "padspan_bright").exists()
    for p, b in src_before.items():
        assert p.read_bytes() == b, f"{p} was rewritten by the Bright build"


def test_no_old_name_survives(tree):
    """verify() ran inside build(); this repeats it from the outside with an
    independent scan so a hole in verify() cannot pass silently."""
    hits = []
    for p in tree.rglob("*"):
        if not p.is_file() or p.suffix.lower() in bb.BINARY_SUFFIXES:
            continue
        rel = p.relative_to(tree)
        if rel.parts == ("README.md",):
            continue
        s = p.read_text(encoding="utf-8", errors="ignore")
        for old in bb.OLD_NAMES:
            if old in s or old in str(rel):
                hits.append(f"{rel}: {old}")
    assert not hits, hits[:20]


def test_the_shape_of_the_generated_tree(tree):
    integ = tree / "custom_components" / "padspan_bright"
    assert integ.is_dir()
    assert (integ / "www" / "padspan-bright" / "panel.js").is_file()
    assert (integ / "www" / "padspan-bright" / "lights_panel.js").is_file()
    m = json.loads((integ / "manifest.json").read_text(encoding="utf-8"))
    assert m["domain"] == "padspan_bright" and m["name"] == "PadSpan Bright"
    assert "padspanHA" in m["documentation"] and "padspanHA" in m["issue_tracker"], \
        "Bright's docs and issues live in the MAIN repo"
    h = json.loads((tree / "hacs.json").read_text(encoding="utf-8"))
    assert h["name"] == "PadSpan Bright" and h["content_in_root"] is False
    bi = (integ / "build_info.py").read_text(encoding="utf-8")
    assert 'EDITION = "bright"' in bi
    assert 'TIER_FLOOR = "free"' in bi
    assert (tree / "README.md").read_text(encoding="utf-8").startswith("# PadSpan Bright")
    assert (tree / "tests").is_dir(), "the suite travels with the tree"
    # Panels renamed so both editions can be installed at once (the importer)
    panel = (integ / "panel.py").read_text(encoding="utf-8")
    assert 'frontend_url_path="padspan-bright"' in panel
    assert 'frontend_url_path="padspan-bright-lights"' in panel
    assert '"padspan-bright-app"' in panel and '"padspan-bright-lights-app"' in panel
    assert not list(tree.rglob("__pycache__")) and not list(tree.rglob("*.pyc"))


def test_bright_exposes_no_entities():
    """The source rule the generated tree inherits: PLATFORMS is empty when
    the edition is bright, and both forward/unload sites are guarded on it."""
    src = (_ROOT / "custom_components" / "padspan_ha" / "__init__.py").read_text(encoding="utf-8")
    assert re.search(r'PLATFORMS: list\[str\] = \(\s*\["sensor", "binary_sensor", "device_tracker"\] if edition\(\) == "full" else \[\]', src)
    assert "if PLATFORMS:\n        try:\n            await hass.config_entries.async_forward_entry_setups" in src
    assert "if PLATFORMS:\n        try:\n            unload_ok = await hass.config_entries.async_unload_platforms" in src


def test_build_refuses_a_non_empty_target(tmp_path):
    (tmp_path / "x").mkdir()
    (tmp_path / "x" / "stray").write_text("no")
    with pytest.raises(RuntimeError, match="non-empty"):
        bb.build(tmp_path / "x", _ROOT)


def test_verify_catches_a_surviving_name(tree, tmp_path):
    """verify() is only worth having if it fails: plant one old name and see."""
    copy = tmp_path / "planted"
    shutil.copytree(tree, copy)
    (copy / "custom_components" / "padspan_bright" / "const.py").write_text(
        'DOMAIN = "padspan_ha"\n', encoding="utf-8")
    with pytest.raises(RuntimeError, match="padspan_ha"):
        bb.verify(copy)


def test_the_zip_is_flat_and_bright(tree, tmp_path):
    n = bb.build_zip(tree, tmp_path / "padspan_bright.zip")
    import zipfile
    names = zipfile.ZipFile(tmp_path / "padspan_bright.zip").namelist()
    assert n == len(names) and "manifest.json" in names and "__init__.py" in names
    assert "www/padspan-bright/panel.js" in names
    assert not any("__pycache__" in x or x.endswith(".pyc") for x in names)


def test_release_publishes_nothing_until_told():
    """The listing is the one irreversible step; it must be an explicit flip."""
    src = (_ROOT / "scripts" / "release.py").read_text(encoding="utf-8")
    # A bare literal, so flipping it is a one-word commit that shows in a
    # diff — never something computed, fetched or defaulted from the env.
    assert re.search(r"^BRIGHT_PUBLISH = (True|False)$", src, re.M), "BRIGHT_PUBLISH must be a literal bool"
    assert "bright_pass(version, channel, message)" in src
    assert "if not BRIGHT_PUBLISH:" in src
    # The pass runs AFTER the full release is out, never before it.
    assert src.index("create_github_release(tag, channel, message)") < src.index("bright_pass(version, channel, message)")
    # And the build tooling ships with the release commit.
    assert '"scripts/bright_build.py"' in src and '"scripts/bright_README.md"' in src


def test_the_generated_suite_passes(tree):
    """The proof that the rename produced a working integration: the renamed
    suite, run inside the generated tree, is green. Slow (a second suite) and
    worth every second — nothing else watches the Bright edition."""
    res = bb.run_suite(tree)
    tail = "\n".join((res.stdout or "").strip().splitlines()[-15:])
    assert res.returncode == 0, f"Bright suite failed:\n{tail}\n{(res.stderr or '')[-2000:]}"
    assert re.search(r"\b\d+ passed\b", tail), tail
    # Match a real failure count, not the bare word: pytest's summary line says
    # "2 xfailed" for expected failures, which a substring check reads as a
    # failure and which returncode 0 above already proves it is not.
    assert not re.search(r"\b\d+ failed\b", tail), tail
