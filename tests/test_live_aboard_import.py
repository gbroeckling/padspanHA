# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard P7: the Import flow (views/live_aboard_import.js).

tests/js/live_aboard_import.mjs runs the flow for real on the DOM shim,
over the server's own previews of synthetic .sh3d files (made here with
ws_house3d_import.preview): the page, the choices (ticks, kinds, which floor
each level goes on), the doors and windows put on the walls the 3D view
draws, and what Add hands the Furnish tab. What it hands over goes through
the server's own check here. The rest is held here: the flow only reads
(declining writes nothing, and nothing in it can write), it asks in the
page, it is loaded only by Live Aboard's own code, and it is credited in the
report.
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
from custom_components.padspan_ha import ws_house3d_import as WI
from tests.test_sh3d_furniture import _FURNISHED, _ROOMS, _home, _make_sh3d

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")

# The house file: the rooms the harness's house has, furnished, two levels.
_HOUSE = _home(_ROOMS + _FURNISHED + """
  <pieceOfFurniture level="lvl0" name="Washing machine" x="450" y="50" width="60" depth="60" height="85"/>""")
# The edges: one level, everything on the Living's walls (0..5 × 0..4 m),
# where the harness's 3D file already has a window from 3.0 to 4.0 m on the
# front wall and from 0.5 to 3.8 m on the left wall. In document order.
_EDGES = _home("""
  <level id="g" name="Ground" elevation="0" floorThickness="12" height="250"/>
  <doorOrWindow level="g" name="Corner door" x="30" y="400" width="90" depth="10" height="205"/>
  <doorOrWindow level="g" name="Window over a window" x="350" y="400" width="60" depth="10" height="100" elevation="100"/>
  <doorOrWindow level="g" name="Door over the corner door" x="50" y="400" width="80" depth="10" height="205"/>
  <doorOrWindow level="g" name="Moved door" x="270" y="400" width="90" depth="10" height="205"/>
  <doorOrWindow level="g" name="Cut window" x="450" y="400" width="140" depth="10" height="100" elevation="100"/>
  <doorOrWindow level="g" name="Far window" x="250" y="200" width="100" depth="10" height="100" elevation="100"/>
  <doorOrWindow level="g" name="Squeezed door" x="0" y="25" width="80" depth="10" height="205" angle="1.5707963267948966"/>
  <pieceOfFurniture level="g" name="Sofa" x="250" y="300" width="200" depth="90" height="80"/>""")


@pytest.fixture(scope="module")
def flow(tmp_path_factory) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    previews = {"house": WI.preview(_make_sh3d(_HOUSE)), "edges": WI.preview(_make_sh3d(_EDGES))}
    path = tmp_path_factory.mktemp("import") / "previews.json"
    path.write_text(json.dumps(previews), encoding="utf-8")
    real = _VIEWS / "live_aboard_furniture.js"
    args = [_NODE, str(Path(__file__).parent / "js" / "live_aboard_import.mjs"), str(_WWW), str(path)]
    if real.is_file():
        args.append(str(real))
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=180)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _code(p: Path) -> str:
    return "\n".join(ln for ln in _js(p).splitlines() if not ln.lstrip().startswith(("//", "*", "/*")))


@pytest.mark.parametrize("prefix,least", [
    ("flow:", 7), ("floors:", 8), ("walls:", 11), ("kinds:", 11), ("result:", 5),
])
def test_the_flow_harness_covers_each_part(flow, prefix, least) -> None:
    got = [k for k in flow["cases"] if k.startswith(prefix)]
    assert len(got) >= least, (prefix, got)
    bad = [f for f in flow["failures"] if f["name"].startswith(prefix)]
    assert all(flow["cases"][k] for k in got) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def test_every_flow_case_passes(flow) -> None:
    assert flow["cases"] and all(flow["cases"].values()) and not flow["failures"], \
        json.dumps(flow["failures"][:6], indent=2, ensure_ascii=False)


def test_the_doors_and_windows_handed_over_are_what_the_server_keeps(flow) -> None:
    """Every door and window Add hands over goes through the server's own
    apply_edit (house3d_edit's check) and is kept as it was handed over."""
    sent = flow["payloads"]
    assert len(sent) >= 3 and sum(len(p["openings"]) for p in sent) >= 6
    for changes in sent:
        out = HS.apply_edit(HS.empty(), changes)
        assert out["openings"] == changes["openings"]


def test_the_pieces_handed_over_are_the_contracts_shape(flow) -> None:
    """contracts §2, and what the Furnish tab's Save checks (its brief):
    fur_ + 8 hex, origin import, sizes 0.05–8 m, z 0–20, a turn in [0, 360),
    a short label, at most six #rrggbb colours, flat params, no binding."""
    pieces = flow["pieces"]
    assert len(pieces) >= 10
    for pc in pieces:
        assert re.fullmatch(r"fur_[0-9a-f]{8}", pc["id"]) and pc["origin"] == "import"
        assert pc["library_id"] is None and pc["submission_id"] is None
        assert pc["entity_id"] is None and pc["entity_reg_id"] is None
        assert isinstance(pc["floor_id"], str) and pc["floor_id"]
        assert 0 <= pc["z_m"] <= 20 and 0 <= pc["rotation"] < 360 and len(pc["label"]) <= 60
        assert all(abs(pc[k]) <= 10_000 for k in ("x_m", "y_m"))
        r = pc["recipe"]
        assert isinstance(r["kind"], str) and 0 < len(r["kind"]) <= 40
        assert all(0.05 <= r[k] <= 8 for k in ("width_m", "depth_m", "height_m")), r
        assert len(r["colors"]) <= 6 and all(re.fullmatch(r"#[0-9a-fA-F]{6}", c) for c in r["colors"])
        assert isinstance(r["params"], dict) and all(isinstance(v, (int, float, str, bool)) for v in r["params"].values())


# ═══ it only reads ═══════════════════════════════════════════════════════════

def test_the_flow_only_reads_and_asks_in_the_page() -> None:
    """Declining writes nothing because nothing in the flow can write: it
    calls the preview and the two reads, nothing else, through ctx; no
    browser dialog, no timer, no storage of its own."""
    code = _code(_VIEWS / "live_aboard_import.js")
    calls = set(re.findall(r'type: "(padspan_ha/[a-z0-9_]+)"', code)) | set(re.findall(r'"(padspan_ha/[a-z0-9_]+)"', code))
    assert calls == {"padspan_ha/house3d_import_preview", "padspan_ha/model_get", "padspan_ha/house3d_get"}, calls
    for bad in ("house3d_edit", "house3d_clear", "callService", "callApi", "fetch(", "XMLHttpRequest", "setTimeout",
                "setInterval", "localStorage", "sessionStorage", "indexedDB", "alert(", "confirm(", "prompt(",
                "telemetry_event", "three"):
        assert bad not in code, bad
    assert "ctx.callWS" in code and "export function importFlow(ctx)" in code


def test_it_loads_only_the_house_and_its_rules_and_only_live_aboard_loads_it() -> None:
    """No three.js and nothing but the house reading and the editor's rules,
    cache-busted as the view loads them; and nothing outside Live Aboard's
    own modules names it (the Furnish tab loads it with its own .catch)."""
    src = _js(_VIEWS / "live_aboard_import.js")
    loads = re.findall(r"import\(`\./([a-z_]+\.js)\$\{new URL\(import\.meta\.url\)\.search\}`\)", src)
    assert sorted(loads) == ["live_aboard_draft.js", "live_aboard_house.js"], loads
    assert not re.search(r"^\s*import\s", src, re.M)
    for p in _WWW.rglob("*.js"):
        if "vendor" in p.parts or p.name == "live_aboard_import.js":
            continue
        code = _code(p)
        if "live_aboard_import" in code:
            assert p.name.startswith("live_aboard"), p.name
            at = code.index("live_aboard_import")
            assert ".catch(" in code[at:at + 300], f"{p.name}: the import must carry its own .catch"


def test_new_words_never_call_the_view_3d() -> None:
    """Garry's naming: the feature is Live Aboard. "3D" appears in the
    flow's words only as the other program's own name."""
    strings = re.findall(r'"([^"\n]*)"|`([^`\n]*)`', _code(_VIEWS / "live_aboard_import.js"))
    said = [a or b for a, b in strings]
    assert any("Sweet Home 3D" in s for s in said)
    assert not [s for s in said if "3D" in s.replace("Sweet Home 3D", "")], said


def test_the_limits_are_the_servers() -> None:
    js = _js(_VIEWS / "live_aboard_import.js")
    assert re.search(r"export const MAX_FILE_BYTES = 10 \* 1024 \* 1024;", js) and WI.MAX_SH3D_BYTES == 10 * 1024 * 1024
    assert f'export const PREVIEW_TYPE = "{WI.ws_house3d_import_preview.ws_schema["type"]}";' in js
    assert "export const SIZE_MIN_M = 0.05, SIZE_MAX_M = 8;" in js and f"export const Z_MAX_M = {int(WI.Z_MAX_M)};" in js
    assert 'export const BOX = "box";' in js and WI.BOX == "box"


def test_the_new_file_is_credited_in_the_report() -> None:
    assert "live_aboard_import" in T.UI_ERROR_HELPERS and T.event_allowed("ui_error:live_aboard_import")
    head = _js(_VIEWS / "live_aboard_import.js").splitlines()[:4]
    assert head[0].startswith("// PadSpan HA") and "GNU General Public License v3.0" in head[2]
