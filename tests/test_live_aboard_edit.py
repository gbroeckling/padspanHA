# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P1, part C: the 3D editor in the 3D view (views/live_aboard_edit.js).

Its rules are run for real in tests/js/live_aboard_draft.mjs, and the editor
itself in tests/js/live_aboard_edit.mjs: inside the real 3D view under node
(only the GL is a stub), on a two-floor house, its picking, Save and rebase
(a save in flight, leaving), and the view's pointers across a poll that
moves it mid-gesture.
Held here, from the source: the light-placement gate on both ends, Save
through the host only, leaving with unsaved changes asking in the page, one
finger drawing while two still pinch, the draft living in the long-lived
slot, nothing of it while off, and no new call, timer or outside code.
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
from custom_components.padspan_ha import ws_house3d as W

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")


@pytest.fixture(scope="module")
def editor() -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / "live_aboard_edit.mjs"), str(_WWW)],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.mark.parametrize("prefix,least", [
    ("pick:", 4), ("save:", 5), ("leave:", 2), ("widths:", 1), ("limits:", 3), ("pointer:", 6), ("drag:", 2), ("errors:", 4),
    # A Save refused as a newer PadSpan's file is the view's file error: the
    # next good read brings Edit and Save back; while Edit is open the hint
    # says whether Save can go ahead.
    ("newer:", 3),
    # Edit pressed before the file was read: what the read finds decides.
    ("begin:", 1),
    # A door or window split over two wall pieces moves whole while a slider drags it.
    ("split:", 1),
    # The server's read says whether this version writes the file (a schema of 1.0 reads here as 1).
    ("schema:", 1),
    # Heights → "What is this?": a light's kind, 3D only, sent with Save.
    ("kind:", 1),
])
def test_the_editor_harness_covers_each_part(editor, prefix, least) -> None:
    got = [k for k in editor["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in editor["failures"] if f["name"].startswith(prefix)]
    assert all(editor["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_editor_case_passes(editor) -> None:
    assert editor["cases"] and all(editor["cases"].values()), json.dumps(editor["failures"][:6], indent=2, ensure_ascii=False)


def test_every_save_the_editor_sent_is_one_the_server_keeps(editor) -> None:
    """Every Save the editor sent in the harness (drawn, dragged to just over
    the least width on a 45° wall, slid to each slider's top, a map window,
    a readout, a light) goes through the server's own apply_edit on the file
    it was made over: none is refused, so the editor's rules and the
    server's can't drift apart."""
    sent = editor["payloads"]
    assert len(sent) >= 6 and sum(len(p.get("openings", {})) for p in sent) >= 15
    for changes in sent:
        out = HS.apply_edit(editor["start"], changes)
        for sec, entries in changes.items():
            assert all((k in out[sec]) == (v is not None) for k, v in entries.items()), sec


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


def _block(src: str, start: str, end: str = "} : null,") -> str:
    b = src[src.index(start):]
    return b[:b.index(end)]


def test_edit_is_handed_over_only_where_lights_are_placed() -> None:
    """Mapping -> Atlas hands `edit` over exactly when it lets lights be
    placed (paid, not Preview: onDropPlace's gate); the Atlas sidebar, where
    no light is placed, never does. The server holds the same gate."""
    maps = _js(_VIEWS / "maps.js")
    assert "const onDropPlace = (paid && !preview && mapState._selLight) ?" in maps
    mblock = _block(maps, "house3d: ctx.state.settings && ctx.state.settings.atlas_3d_enabled !== undefined ?")
    assert ('edit: paid && !preview ? (changes) => ctx.actions.wsCall("padspan_ha/house3d_edit", changes)\n'
            '        .then((r) => { mapState._heightsFile = undefined; _laFileHeights(ctx, mapState, changes && changes.heights_set, r); '
            'return r; }) : null,') in mblock
    # Its heights go on the placement records, on the same gate (2026-10-05).
    assert "heights: paid && !preview ? _laHeightsPut(ctx, mapState) : null," in mblock
    put = maps[maps.index("export function _laHeightsPut("):][:400]
    assert 'ctx.actions.wsCall("padspan_ha/fabric_light_height_set", { heights })' in put
    lp = _block(_js(_WWW / "lights_panel.js"), "house3d: this.state._house3d ?")
    assert "edit:" not in lp and "house3d_edit" not in _js(_WWW / "lights_panel.js")
    lm = _js(_VIEWS / "lights_map.js")
    assert 'edit: typeof h3.edit === "function" ? h3.edit : null,' in lm
    la = _js(_VIEWS / "live_aboard.js")
    # Through editSave: the heights to their placement records, the rest to the file (2026-10-05).
    assert 'editor.setEdit(typeof p.edit === "function" ? editSave : null)' in la
    assert "const p = lastP || {}, edit = p.edit, put = typeof p.heights === \"function\" ? p.heights : null;" in la
    assert W.ws_house3d_edit.ws_schema["type"] == "padspan_ha/house3d_edit"


def test_nothing_is_stored_until_save_and_save_goes_through_the_host() -> None:
    ed = _code(_VIEWS / "live_aboard_edit.js")
    # The draft's starting copy goes along: the host's Save sends only the heights it changed (2026-10-05).
    assert "const r = await editFn(ch, draft.base);" in ed and "ctx.saved(r.data);" in ed
    assert ed.count("editFn(") == 1, "Save is the one place the editor writes"
    for name in ("live_aboard.js", "live_aboard_edit.js", "live_aboard_draft.js"):
        code = _code(_VIEWS / name)
        for bad in ("callWS", "wsCall", "callService", "callApi", "fetch(", "setTimeout", "setInterval", "localStorage",
                    "house3d_edit", "telemetry_event"):
            if bad == "setTimeout" and name == "live_aboard.js":     # its one timer: the live read's clock
                assert code.count("setTimeout(") == 1 and "peopleTimer = setTimeout(" in code
                continue
            assert bad not in code, (name, bad)


def test_leaving_with_unsaved_changes_asks_in_the_page() -> None:
    ed = _code(_VIEWS / "live_aboard_edit.js")
    for bad in ("confirm(", "alert(", "prompt(", "beforeunload"):
        assert bad not in ed, bad
    assert "function holdLeave(go)" in ed and '"Keep editing"' in ed and "la3d-ask" in ed
    lm = _js(_VIEWS / "lights_map.js")
    pick = lm[lm.index("const pick3d = (on) => {"):]
    pick = pick[:pick.index("mount3d();")]
    assert pick.index("s.holdLeave(") < pick.index("_la3dPick(h3.slot, on);"), "asked before the switch moves"
    la = _js(_VIEWS / "live_aboard.js")
    assert "holdLeave(go){" in la


def test_one_finger_draws_two_still_pinch() -> None:
    la = _js(_VIEWS / "live_aboard.js")
    wire = la[la.index("function wirePointer(){"):la.index("/** The corners of every room on a showing indoor floor")]
    assert 'if (mode === "edit" || mode === "editTap") editor.cancel();' in wire, "a second finger ends the line: a pinch"
    assert "editor.active && mode === \"orbit\" && pts.size === 1" in wire, "one pointer, never a pan button"
    assert 'if (mode === "edit") { editor.move(e); return; }' in wire
    assert "use.down(e)" in wire and wire.index("editor.down(e)") < wire.index("use.down(e)"), "in Edit a press never switches a light"


def test_the_draft_lives_in_the_long_lived_slot() -> None:
    la = _js(_VIEWS / "live_aboard.js")
    assert "editor = EDIT.createEditor({" in la and la.index("editor = EDIT.createEditor({") > la.index("function start(setting){")
    # The file as drawn: the placement records' heights over it (2026-10-05),
    # without the heights out of date there (2026-10-06).
    assert "const viewData = () => (editor && editor.view()) || shownFile();" in la
    assert "const f = file || NO_FILE, recs = recordsNow(), gone = [...goneNow()].sort();" in la
    assert "out: DRAFT.withRecordHeights(withoutGone(f, gone), recs, sectionOf)" in la
    assert "if (editor) editor.layout();" in la
    ed = _code(_VIEWS / "live_aboard_edit.js")
    assert "root.appendChild(" in ed and "document.body" not in ed, "its page lives in the slot's element"


def test_the_tool_looks_down_on_the_floor_and_heights_skip_scanners() -> None:
    la = _js(_VIEWS / "live_aboard.js")
    assert "fit(0, MIN_PHI, pts.length ? pts : undefined);" in la
    ed = _js(_VIEWS / "live_aboard_edit.js")
    assert "if (drawing(tool) && !drawing(was)) { const F = currentFloor(); if (F) ctx.topDown(F); }" in ed
    dev = la[la.index("function deviceInfo(eid){"):]
    dev = dev[:dev.index("\n  }\n")]
    assert "lights.find(" in dev and "sensorsUi.find(" in dev and "scanner" not in dev, "drawn lights and sensors only"


def test_three_comes_in_through_the_view_and_the_files_are_credited() -> None:
    ed = _code(_VIEWS / "live_aboard_edit.js")
    assert "import(" not in ed and not re.search(r"^\s*import\s", ed, re.M) and "three.module" not in ed
    assert "const { THREE, HOUSE, DRAFT, root, canvas, bar, guard } = ctx;" in ed
    want = "import(`./live_aboard_edit.js${new URL(import.meta.url).search}`)"
    importers = sorted(p.name for p in _WWW.rglob("*.js") if "vendor" not in p.parts and want in _js(p))
    assert importers == ["live_aboard.js"], importers
    assert "live_aboard_edit" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_edit")

def test_a_slider_being_dragged_moves_only_what_it_moves() -> None:
    """Dragged, a slider moves its one door, window, light or sensor in place
    (the view's preview: nothing read again, nothing rebuilt); let go, the
    house is drawn whole once. The map is read again only when it changed."""
    ed = _code(_VIEWS / "live_aboard_edit.js")
    assert "if (moves || sliding) moveSoon(moves || sliding); else redrawSoon();" in ed   # moves: a piece (P2 Furnish)
    assert 'r.addEventListener("change", () => { group = null; if (moves) redrawSoon(); });' in ed
    assert ed.count("{ opening: o.id }") == 5 and "}, { eid });" in ed
    assert "if (!ctx.preview || !ctx.preview(t)) redrawSoon();" in ed
    la = _code(_VIEWS / "live_aboard.js")
    assert "preview: (t) => preview(t)" in la and "if (rSig !== readSig) { reading = HOUSE.readHouse(" in la
