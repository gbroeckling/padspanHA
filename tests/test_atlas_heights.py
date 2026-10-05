# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Heights for Live Aboard: one record, a tool on the Atlas for every device.

Garry, 2026-10-05: "Device placement on atlas is good until we get to sims,
needs same information store, but needs to be a tool to add the third
dimension for the sims view, height mostly ... This needs to be an element
for all devices."

tests/js/atlas_heights.mjs runs Mapping's Atlas tab (views/maps.js with
views/atlas_heights.js) for real under the DOM shim: off, below Pro or in
Preview nothing is fetched; the inspector's Height row with each kind's
chips, its cm box and Live Aboard's default; Undo; Save placements sending a
height only when the row set one; the Heights list sorted, filtered and set
in bulk with one Undo; the hover box; and buildIsoSVG byte for byte the same
with heights in the records (on Garry's own house too when its private
export is on this PC: PADSPAN_HOUSE_EXPORT, never in the repo).

tests/js/live_aboard_heights.mjs runs Live Aboard's rules and the real 3D
view and editor: the record's height first, then the 3D file's, then the
default; with no height in any record the house drawn as before; Edit →
Heights saving to the record, one Save for both writes, and honest words when
one fails.

Here: every case passes, what each harness sent is what the server takes (the
placement command's own schema, the 3D file's own apply_edit), and the hooks
stay few, guarded and in place.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import voluptuous as vol

from custom_components.padspan_ha import house3d_store as HS
from custom_components.padspan_ha.ws_fabric import ws_fabric_light_height_set, ws_fabric_light_position_set

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_NODE = shutil.which("node")
_HOUSE = os.environ.get("PADSPAN_HOUSE_EXPORT", "")


def _harness(name: str, *extra: str) -> dict:
    if _NODE is None:
        pytest.skip("node is not installed")
    res = subprocess.run([_NODE, str(Path(__file__).parent / "js" / name), str(_WWW), *extra],
                         capture_output=True, text=True, encoding="utf-8", timeout=300)
    lines = [ln for ln in res.stdout.strip().splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    return json.loads(lines[-1])


@pytest.fixture(scope="module")
def atlas() -> dict:
    extra = (_HOUSE,) if _HOUSE and Path(_HOUSE).is_file() else ()
    return _harness("atlas_heights.mjs", *extra)


@pytest.fixture(scope="module")
def aboard() -> dict:
    return _harness("live_aboard_heights.mjs")


def _case(h: dict, prefix: str, least: int = 1) -> None:
    got = {k: v for k, v in h["cases"].items() if k.startswith(prefix)}
    assert len(got) >= least, f"{prefix}: {sorted(h['cases'])}"
    bad = [f for f in h["failures"] if f["name"].startswith(prefix)]
    assert all(got.values()) and not bad, json.dumps(bad[:4], indent=2, ensure_ascii=False)


def _js(p: Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


# ═══ the Atlas: Mapping's Height row and Heights list ════════════════════════

def test_off_nothing_is_fetched_and_mapping_is_as_it_was(atlas) -> None:
    _case(atlas, "off:")


def test_the_inspector_has_a_height_row_by_kind_with_undo(atlas) -> None:
    _case(atlas, "row:", 2)


def test_save_placements_sends_a_height_only_when_the_row_set_one(atlas) -> None:
    _case(atlas, "save:")


def test_the_heights_list_sorts_filters_and_sets_in_one_step(atlas) -> None:
    _case(atlas, "list:", 2)


def test_what_is_drawn_and_the_hover_box(atlas) -> None:
    _case(atlas, "draw:", 2)


def test_the_flat_drawing_is_byte_identical_with_heights_in_the_records(atlas) -> None:
    _case(atlas, "byte:")


def test_every_atlas_case_passes(atlas) -> None:
    assert atlas["cases"] and all(atlas["cases"].values()), json.dumps(atlas["failures"][:4], indent=2, ensure_ascii=False)


def test_what_save_placements_sent_the_server_takes(atlas) -> None:
    """Each fabric_light_position_set the tab sent passes the command's own
    schema: a height (or null to clear it) is a declared key now."""
    schema = vol.Schema({vol.Required("id"): int, **ws_fabric_light_position_set.ws_schema})
    sent = [m for t, m in atlas["sent"] if t == "padspan_ha/fabric_light_position_set"]
    assert len(sent) >= 3
    for i, m in enumerate(sent):
        schema({"id": i + 1, "type": "padspan_ha/fabric_light_position_set", **m})
    assert any(m.get("z_m") is None and "z_m" in m for m in sent), "a cleared height is sent as null"


# ═══ Live Aboard: the record first, one Save for both writes ═════════════════

def test_the_rules_split_and_lay_the_heights(aboard) -> None:
    _case(aboard, "rules:", 3)


def test_live_aboard_reads_the_record_then_the_file_then_the_default(aboard) -> None:
    _case(aboard, "read:", 2)


def test_edit_heights_save_to_the_record_with_undo_discard_and_honest_words(aboard) -> None:
    _case(aboard, "save:", 6)


def test_every_live_aboard_case_passes(aboard) -> None:
    assert aboard["cases"] and all(aboard["cases"].values()), json.dumps(aboard["failures"][:4], indent=2, ensure_ascii=False)


def test_what_live_aboard_sent_to_its_file_the_server_keeps(aboard) -> None:
    """Every house3d_edit the editor sent (heights split off) goes through the
    server's own apply_edit, over the file the harness began with."""
    sent = aboard["payloads"]
    assert len(sent) >= 4
    base = {**HS.empty(), "lights": {"light.den": {"z_m": 2.3, "kind": "pendant"}, "light.living": {"z_m": 1.9}},
            "devices": {"sensor.den_temp": {"z_m": 1.1}}}
    for changes in sent:
        HS.apply_edit(base, changes)


def test_the_height_command_takes_what_live_aboard_sends() -> None:
    schema = vol.Schema({vol.Required("id"): int, **ws_fabric_light_height_set.ws_schema})
    got = schema({"id": 1, "type": "padspan_ha/fabric_light_height_set", "heights": {"light.den": 1.25, "sensor.den_temp": None}})
    assert got["heights"] == {"light.den": 1.25, "sensor.den_temp": None}


# ═══ the hooks: few, guarded, in place ═══════════════════════════════════════

def test_mapping_fetches_the_tool_only_while_live_aboard_is_on_at_pro() -> None:
    maps = _js(_VIEWS / "maps.js")
    assert maps.count("import(`./atlas_heights.js") == 1, "fetched in one place"
    assert re.search(r"const _heightsOn = \(ctx\) => ctx\.state\.settings\?\.atlas_3d_enabled === true && "
                     r"_tierAtLeast\(ctx\.state\.settings\?\.tier, \"pro\"\);", maps)
    assert "const HT = paid && !preview && _heightsOn(ctx) ? _heightsTool(ctx) : null;" in maps
    static = [ln for ln in maps.splitlines() if ln.startswith("import ") or "await import(" in ln]
    assert not any("atlas_heights" in ln or "live_aboard" in ln for ln in static), "never a static import"


def test_the_hooks_are_where_they_belong() -> None:
    maps = _js(_VIEWS / "maps.js")
    # Save placements: a height only when the Height row set it.
    assert 'const { source, _z, ...lp } = mapState._lightsDraftM[eid];\n            if (!_z) delete lp.z_m;' in maps
    # What the card draws (and Live Aboard reads): the record's height unless the row set one.
    assert "light_positions_m: _draftOverRecords(ctx.state.model?.light_positions_m || {}, mapState._lightsDraftM) }" in maps
    # Live Aboard's Save hands its heights to the Atlas's own command.
    assert '"padspan_ha/fabric_light_height_set", { heights })' in maps
    lm = _js(_VIEWS / "lights_map.js")
    assert 'heights: typeof h3.heights === "function" ? h3.heights : null,' in lm
    la = _js(_VIEWS / "live_aboard.js")
    assert 'editor.setEdit(typeof p.edit === "function" ? editSave : null);' in la
    assert "const viewData = () => (editor && editor.view()) || shownFile();" in la


def test_the_flat_renderer_never_reads_a_height() -> None:
    """The drawing cannot change with a height: buildIsoSVG's module never
    reads z_m (the harness proves the bytes; this keeps it so)."""
    assert "z_m" not in _js(_VIEWS / "iso_lights.js")


def test_new_user_facing_words_never_call_the_view_3d() -> None:
    src = _js(_VIEWS / "atlas_heights.js")
    shown = re.findall(r'"([^"\n]*)"|`([^`\n]*)`', src)
    words = [a or b for a, b in shown]
    assert not [w for w in words if re.search(r"\b3D\b", w)], "say Live Aboard, never 3D"
    assert "Heights for Live Aboard" in src


def test_the_new_module_carries_the_licence_header() -> None:
    for p in (_VIEWS / "atlas_heights.js", Path(HS.__file__).with_name("house3d_heights.py")):
        head = p.read_text(encoding="utf-8")[:300]
        assert "GNU General Public License v3.0" in head and "Garry Broeckling" in head, p.name
