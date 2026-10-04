# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P2: the furniture builders.

tests/js/live_aboard_furniture.mjs runs views/live_aboard_furniture.js for
real with the bundled three.js: every kind across its parameter range, Low
and High, inside its box with its front toward +z, no face turned inward,
within the triangle budget, with the live parts its kind needs; recipes read
tolerantly (unknown kinds, params and keys kept, numbers clamped, nothing
refused); an unknown kind drawn as a box of its size; a piece freeing what it
made and a shared look only once no piece uses it; and the people figure.
The rest is held here: the module imports nothing, so it runs anywhere.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def furniture() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_furniture.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("api:", 4), ("recipe:", 6), ("build:", 3), ("front:", 3), ("unknown:", 1), ("dispose:", 2), ("figure:", 2),
])
def test_the_furniture_harness_covers_each_part(furniture, prefix, least) -> None:
    got = [k for k in furniture["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in furniture["failures"] if f["name"].startswith(prefix)]
    assert all(furniture["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_furniture_case_passes(furniture) -> None:
    assert not furniture["failures"], json.dumps(furniture["failures"][:6], indent=2, ensure_ascii=False)


def test_every_kind_is_built_and_probed(furniture) -> None:
    """A kind added later is covered without touching the harness: it is
    built across its range, and its front is checked or it is listed as
    having none."""
    kinds = [k[len("api: "):-len(" is well-formed")] for k in furniture["cases"]
             if k.startswith("api: ") and k.endswith(" is well-formed")]
    assert "sofa" in kinds and "bed" in kinds and "other" in kinds, kinds
    for k in kinds:
        assert furniture["cases"].get(f"build: {k}") is True, k
        assert furniture["cases"].get(f"front: {k}") is True, k
        assert furniture["stats"][k]["builds"] >= 20, (k, furniture["stats"][k])


def test_the_builders_are_plain_code() -> None:
    """three.js is handed in by the caller: the module imports nothing (not
    three.js, not another view), so node runs it as it is."""
    src = (_VIEWS / "live_aboard_furniture.js").read_text(encoding="utf-8")
    assert src.startswith("// PadSpan HA — BLE Room-Presence Tracking for Home Assistant\n// Copyright (C) 2026 Garry Broeckling\n")
    code = "\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith("//"))
    assert not re.search(r"\bimport\b", code), "no import of any kind"
    assert "document." not in code and "window." not in code, "no DOM: finishes are made as data, not on a canvas"
    for name in ("FURNITURE_KINDS", "FURNITURE", "FIGURE"):
        assert f"export const {name} =" in code, name
    for name in ("defaultRecipe", "clampRecipe", "pieceSize", "buildPiece", "disposePiece", "buildFigure"):
        assert re.search(rf"export function {name}\(", code), name


def test_an_uncaught_throw_is_attributed_to_its_module() -> None:
    assert "live_aboard_furniture" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_furniture")
