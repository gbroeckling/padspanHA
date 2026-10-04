# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part C: the 3D editor's rules, and the 3D file in the view.

tests/js/live_aboard_draft.mjs runs views/live_aboard_draft.js for real on
houses read by views/live_aboard_house.js: the draft with Undo, Redo and
Discard, Save's changes, the line tool's walls (runs), snapping, corner
stops, refused overlaps, minimum widths, height clamps, the height limits
the view draws within, and the 3D file's doors and windows cut into the
walls the view draws. What it builds at the edges goes through the server's
own apply_edit here. The rest is held here: the limits equal the server's,
the new files are credited in the report, and the view reads the 3D file
only through its host.
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
def draft() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_draft.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.mark.parametrize("prefix,least", [
    ("draft:", 4), ("file:", 1), ("runs:", 2), ("snap:", 1), ("stops:", 1), ("overlap:", 2), ("widths:", 2),
    ("heights:", 4), ("limits:", 2), ("walls:", 4),
])
def test_the_rules_harness_covers_each_part(draft, prefix, least) -> None:
    got = [k for k in draft["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in draft["failures"] if f["name"].startswith(prefix)]
    assert all(draft["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_rules_case_passes(draft) -> None:
    assert draft["cases"] and all(draft["cases"].values()), json.dumps(draft["failures"][:6], indent=2, ensure_ascii=False)


def test_the_limits_are_the_servers() -> None:
    """What the editor lets you draw, the server accepts: the same widths,
    defaults, gap, lowest door and id shape."""
    d = _js(_VIEWS / "live_aboard_draft.js")
    m = re.search(r"export const WINDOW_MIN_M = ([\d.]+), DOOR_MIN_M = ([\d.]+);", d)
    assert m and (float(m[1]), float(m[2])) == (HS.WINDOW_MIN_M, HS.DOOR_MIN_M)
    assert re.search(r"export const GAP_MIN_M = ([\d.]+);", d)[1] == str(HS.GAP_MIN_M)
    assert float(re.search(r"export const DOOR_MIN_HEAD_M = ([\d.]+);", d)[1]) == HS.DOOR_MIN_HEAD_M
    assert "export const OPENING_ID = /^(win|door)_[0-9a-f]{8}$/;" in d and HS.OPENING_ID.pattern == r"^(win|door)_[0-9a-f]{8}$"
    assert "WINDOW_SILL_M = 0.9, WINDOW_HEAD_M = 2.1, DOOR_HEAD_M = 2.03;" in d
    assert re.search(r"DOOR_LOW_M = ([\d.]+);", d) and float(re.search(r"DOOR_LOW_M = ([\d.]+);", d)[1]) >= HS.DOOR_MIN_HEAD_M


def test_what_the_rules_build_at_the_edges_the_server_keeps(draft) -> None:
    """Each payload the rules built at their edges (least widths at every
    slope, doors under very low ceilings, heights at the limits) goes
    through the server's own apply_edit: none is refused, so the editor's
    rules and the server's can't drift apart."""
    sent = draft["payloads"]
    assert len(sent) >= 8 and sum(len(p.get("openings", {})) for p in sent) >= 400
    for changes in sent:
        out = HS.apply_edit(HS.empty(), changes)
        for sec, entries in changes.items():
            assert all((k in out[sec]) == (v is not None) for k, v in entries.items()), sec


def test_the_rules_touch_nothing_but_numbers() -> None:
    """No three.js, no page, no call: plain numbers in and out."""
    code = _code(_VIEWS / "live_aboard_draft.js")
    for bad in ("import(", "import ", "document.", "window.", "callWS", "callService", "fetch(", "setTimeout",
                "setInterval", "localStorage", "three"):
        assert bad not in code, bad


def test_the_view_reads_the_file_only_through_its_host() -> None:
    """The rules are loaded by the 3D view alone (the view, and the house it
    draws, for the height limits); the view reads the 3D file through the
    host's load (house3d_get), once per showing, never on the poll; both
    hosts hand it over."""
    want = "import(`./live_aboard_draft.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in _js(p))
    # the house: the limits it draws within; Import (P7): doors and windows on the walls by the line tool's rules
    assert importers == ["live_aboard.js", "live_aboard_house.js", "live_aboard_import.js"], importers
    la = _js(_VIEWS / "live_aboard.js")
    assert "if (fileLoad || typeof p.load !== \"function\") return;" in la
    assert "detach(){ try { fileLoad = null;" in la, "read again when the screen comes back to 3D"
    assert "DRAFT.applyOpenings(HOUSE.readingCopy(reading), vd.openings)" in la and "HOUSE.openingSwing(P.pc, rooms, P.pc.override || null)" in la
    assert "reading = HOUSE.readHouse(p.model, p.floors, p.lightsByEid, p.hidden)" in la, "the map is read again only when it changed"
    assert "DRAFT.liftParts(HOUSE.fixtureParts(L0, ctx)" in la and "HOUSE.deviceZ(S0.kind, ceil, zs[S0.eid] || null)" in la
    lm = _js(_VIEWS / "lights_map.js")
    assert 'load: typeof h3.load === "function" ? h3.load : null,' in lm
    assert 'load: ()=>this._hass.callWS({ type:"padspan_ha/house3d_get" }),' in _js(_WWW / "lights_panel.js")
    assert 'load: () => ctx.actions.wsCall("padspan_ha/house3d_get"),' in _js(_VIEWS / "maps.js")


def test_the_new_file_is_credited_in_the_report() -> None:
    assert "live_aboard_draft" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_draft")


def test_the_editor_knows_which_files_this_version_writes() -> None:
    """A newer PadSpan's 3D file is drawn but never edited: the frontend's
    rule (live_aboard_draft.js writable, FILE_SCHEMA) is the server's
    (house3d_store.py writable, SCHEMA), over the same table the JS
    harness holds it to."""
    js = (_VIEWS / "live_aboard_draft.js").read_text(encoding="utf-8")
    assert f"export const FILE_SCHEMA = {HS.SCHEMA};" in js
    harness = (Path(__file__).parent / "js" / "live_aboard_draft.mjs").read_text(encoding="utf-8")
    table = json.loads(re.search(r"export const WRITABLE_CASES = (\[.*\]);", harness).group(1))
    assert table and all(HS.writable(d) == want for d, want in table), table
