# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P2, Furnish: furniture's rules (views/live_aboard_pieces.js).

tests/js/live_aboard_pieces.mjs runs them for real on a house read by
views/live_aboard_house.js: ids, 15° turns, which way a piece faces, the
height in the room (Garry's drop/raise), Floor ▲ / ▼, where a new piece goes,
snapping to walls at any angle, and the fit checks (into a wall, overlapping
in 3D, a door's swing, a dresser's front or a bed's side, a window's sill).
What it builds at the edges goes through the server's own apply_edit here,
so the two cannot drift apart. The rest is held here: the limits equal the
server's, the rules touch nothing but numbers, the new file is credited in
the report.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import house3d_store as HS
from custom_components.padspan_ha import telemetry as T

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def rules() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_pieces.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _code(p: Path) -> str:
    return "\n".join(ln for ln in p.read_text(encoding="utf-8").splitlines()
                     if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.mark.parametrize("prefix,least", [
    ("ids:", 1), ("turn:", 1), ("face:", 1), ("height:", 2), ("floors:", 1), ("place:", 3), ("snap:", 3), ("fit:", 5),
    ("edges:", 1), ("draft:", 1), ("exact:", 1), ("gaps:", 1), ("stand:", 1), ("hang:", 1),
])
def test_the_rules_harness_covers_each_part(rules, prefix, least) -> None:
    got = [k for k in rules["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in rules["failures"] if f["name"].startswith(prefix)]
    assert all(rules["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_rules_case_passes(rules) -> None:
    assert rules["cases"] and all(rules["cases"].values()), json.dumps(rules["failures"][:6], indent=2, ensure_ascii=False)


def test_what_the_rules_build_at_the_edges_the_server_keeps(rules) -> None:
    """New pieces, their copies, and pieces at every limit (sizes, heights at
    the top of a tall room, rotations past a turn either way, x/y at the far
    edge) go through the server's own apply_edit: none is refused."""
    sent = rules["payloads"]
    assert len(sent) >= 2 and sum(len(p["pieces"]) for p in sent) >= 20
    for changes in sent:
        out = HS.apply_edit(HS.empty(), changes)
        for pid, p in changes["pieces"].items():
            assert out["pieces"][pid]["rotation"] == p["rotation"] and out["pieces"][pid]["z_m"] == p["z_m"], pid


def test_the_limits_are_the_servers() -> None:
    js = (_VIEWS / "live_aboard_pieces.js").read_text(encoding="utf-8")
    assert "export const PIECE_ID = /^fur_[0-9a-f]{8}$/;" in js and HS.PIECE_ID.pattern == r"^fur_[0-9a-f]{8}$"
    m = re.search(r"export const SIZE_MIN_M = ([\d.]+), SIZE_MAX_M = ([\d.]+), Z_MAX_M = ([\d.]+);", js)
    assert m and (float(m[1]), float(m[2]), float(m[3])) == (HS.SIZE_MIN_M, HS.SIZE_MAX_M, HS.PIECE_Z_MAX_M)
    assert 'export const ORIGINS = ["build", "photo", "library", "import"];' in js and HS.ORIGINS == ("build", "photo", "library", "import")
    draft = (_VIEWS / "live_aboard_draft.js").read_text(encoding="utf-8")
    assert "/^fur_[0-9a-f]{8}$/" in draft, "the draft reads pieces by the same id"


def test_the_rules_touch_nothing_but_numbers() -> None:
    code = _code(_VIEWS / "live_aboard_pieces.js")
    for bad in ("import(", "import ", "document.", "window.", "callWS", "callService", "fetch(", "setTimeout",
                "setInterval", "localStorage", "three"):
        assert bad not in code, bad


def test_the_new_file_is_credited_in_the_report() -> None:
    assert "live_aboard_pieces" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_pieces")
