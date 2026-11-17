"""'Set this plan's scale now' after an upload (owner, 2026-11-12), and its quiet reminder.

The server side RUN on test_plan_build_scale.py's synthetic house in the REAL
model and maps stores: the upload marks the plan (never an Outside one), the
hand measurement (one length or two) is read, previewed and saved through
Mapping → Edit → Measure's own writer as a hand measurement (no helper source,
no ledger, nothing for the helper's undo), Later ends it; the counters are
allowed, summed and labelled. The panel side is tests/js/scale_nudge.mjs, run
here: upload → nudge → measure → saved, Later, shown once, the reminder line,
nothing for non-admins, Sample or a wall screen, two lengths that disagree.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_fabric as F
from custom_components.padspan_ha import ws_maps as WM
from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_plan_build import _call
from tests.test_house3d_store import _run
from tests.test_plan_build_scale import _setup


def await_none(coro):
    return _run(coro)

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_NODE = shutil.which("node")

# On the 1000 x 800 plan "n1": half its width is five metres (100 px/m), and half its height is four.
_ACROSS = {"p1": [0.1, 0.5], "p2": [0.6, 0.5], "text": "5 m"}
_DOWN = {"p1": [0.5, 0.1], "p2": [0.5, 0.6], "text": "4 m"}
_DOWN_OFF = {"p1": [0.5, 0.1], "p2": [0.5, 0.6], "text": "5 m"}     # the same 400 px called 5 m: 20 % apart


def _house(monkeypatch, tmp_path, disk, **kw):  # noqa: F811
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, **kw)
    # No AI, no plan tools: the hand measurement needs none of the helper's switches or Claude.
    h.data[DOMAIN][DATA_SETTINGS].data.update(atlas_3d_ai_task_entity="", ai_plans_enabled=False, ai_plan_build_enabled=False)
    ms.get_map("n1")["scale_nudge"] = True
    return h, conn, mdl, ms, cal


def test_the_preview_reads_the_lengths_and_writes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    before = json.dumps([mdl.data, ms.data])
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"text": "12"}])
    assert out["metres"] == [12.0] and out["assumed"] == ["metres"] and "across_m" not in out
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)])
    assert out["across_m"] == 10.0 and out["down_m"] == 8.0 and out["odd"] is False and "differ_pct" not in out
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS), dict(_DOWN)])
    assert out["differ_pct"] == 0.0 and out["across_m"] == 10.0
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS), dict(_DOWN_OFF)])
    assert out["differ_pct"] == 22.2                                 # 100 and 80 px/m: 20 / 90
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"text": "lots"}])
    assert out["invalid"].startswith("Type a length")
    assert json.dumps([mdl.data, ms.data]) == before and not disk.writes


def test_the_save_is_measures_own_write_a_hand_measurement(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    sent, real = [], F.async_write_measured_transform

    async def spy(hass, map_id, transform):
        sent.append((map_id, copy.deepcopy(transform)))
        return await real(hass, map_id, transform)
    monkeypatch.setattr(F, "async_write_measured_transform", spy)
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS), dict(_DOWN)], save=True)
    assert out == {"ok": True, "map_id": "n1", "scale_x_m": 10.0, "scale_y_m": 8.0, "lengths": 2}
    (mid, t), = sent
    refs = t["reference_measurements"]
    # Measure's payload: the size, the plan's own floor, both lengths averaged; no helper source on them.
    assert mid == "n1" and t["scale_x_m"] == 10.0 and t["scale_y_m"] == 8.0 and t["floor_id"] == "main" and len(refs) == 2
    assert all("source" not in r for r in refs) and [r["distance_m"] for r in refs] == [5.0, 4.0]
    assert all(r.get("source") not in F.HELPER_SCALE_SOURCES for r in mdl.map_transform("n1")["reference_measurements"])
    assert "scale_nudge" not in ms.get_map("n1")                     # Save ended the nudge


def test_the_save_is_never_the_helpers_to_take_back(monkeypatch, tmp_path, disk):  # noqa: F811
    from custom_components.padspan_ha import ws_plan_ai as WP
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)], save=True)
    assert not (_run(A.async_get_store(h)).data.get("scale_batches") or {})   # no ledger entry: nothing of the helper's
    out = _call(WP.ws_plan_build_scale_undo, h, conn, map_id="n1", via="wizard")
    assert out["ok"] is False and out["code"] == "nothing_to_undo" and mdl.map_transform("n1")["scale_x_m"] == 10.0


def test_a_save_that_cant_go_writes_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    before = json.dumps([mdl.data, ms.data])
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[{"p1": [0.1, 0.5], "p2": [0.6, 0.5], "text": "lots"}], save=True)
    assert out["ok"] is False and out["code"] == "invalid" and json.dumps([mdl.data, ms.data]) == before
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="gone", measures=[dict(_ACROSS)], save=True)
    assert out["error"] == "not_found"


def test_the_first_scale_command_refuses_a_measured_an_outdoor_or_a_calibrated_plan(monkeypatch, tmp_path, disk):  # noqa: F811
    """Review 2026-11-11: a stale second tab must never re-scale a measured plan (Edit → Measure re-measures); the same
    stops as the rooms helper's save (plan_ai_write.scale_stops), and never an outdoor plan. Each in plain words."""
    from custom_components.padspan_ha import plan_ai_write as C
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)], save=True)["ok"] is True
    before = json.dumps([mdl.data, ms.data, cal.data])
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_DOWN_OFF)], save=True)
    assert out == {"ok": False, "code": "already_placed", "message": C.SCALE_WORDS["already_placed"]} and json.dumps([mdl.data, ms.data, cal.data]) == before
    mdl.data["map_transforms"].pop("n1")
    cal.data.setdefault("points", []).append({"id": "p1", "map_id": "n1", "x_m": 1.0, "y_m": 1.0})
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)], save=True)
    assert out["ok"] is False and out["code"] == "points_on_plan" and mdl.map_transform("n1") is None
    cal.data["points"].pop()
    ms.get_map("n1")["floor_id"] = "__outside__"
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=[dict(_ACROSS)], save=True)
    assert out["ok"] is False and out["code"] == "outdoor" and "Measure" in out["message"] and mdl.map_transform("n1") is None


def test_any_first_scale_ends_the_wait_so_a_scale_taken_back_never_brings_it_back(monkeypatch, tmp_path, disk):  # noqa: F811
    """Review 2026-11-11: Measure's Save (and the helper's) ended nothing, so the helper's Undo brought the upload's
    screen back saying the plan "is uploaded". The one writer every first scale comes through ends it."""
    from custom_components.padspan_ha import ws_plan_ai as WP
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    _run(F.async_write_measured_transform(h, "n1", {"scale_x_m": 10.0, "scale_y_m": 8.0, "reference_measurements": []}))
    assert "scale_nudge" not in ms.get_map("n1")                     # Mapping → Edit → Measure's write
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk)           # the helper's house, as its own tests set it up
    ms.get_map("n1")["scale_nudge"] = True
    out = _call(WP.ws_plan_build_scale_save, h, conn, map_id="n1", sig="nn", measures=[dict(_ACROSS)], source="guided", via="wizard")
    assert out["ok"] is True and "scale_nudge" not in ms.get_map("n1")   # the helper's
    assert _call(WP.ws_plan_build_scale_undo, h, conn, map_id="n1", via="wizard")["ok"] is True
    assert mdl.map_transform("n1") is None and "scale_nudge" not in ms.get_map("n1")


def test_later_ends_it_for_good_and_the_upload_marks_only_an_indoor_plan(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert _call(WM.ws_maps_scale_nudge_end, h, conn, map_id="n1") == {"ok": True, "ended": True}
    assert "scale_nudge" not in ms.get_map("n1")
    assert _call(WM.ws_maps_scale_nudge_end, h, conn, map_id="n1") == {"ok": True, "ended": False}
    ms.maps_dir = tmp_path                                           # the fixture's store has no picture folder
    png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    up = dict(name="Up", filename="up.png", mime="image/png", width=1, height=1, png_base64=png)
    m1 = _call(WM.ws_maps_upload, h, conn, **up, floor_id="main", scale_nudge=True)["map"]
    m2 = _call(WM.ws_maps_upload, h, conn, **up, floor_id="__outside__", scale_nudge=True)["map"]
    m3 = _call(WM.ws_maps_upload, h, conn, **up, floor_id="main")["map"]
    assert m1.get("scale_nudge") is True and "scale_nudge" not in m2 and "scale_nudge" not in m3


def test_the_counters_are_allowed_summed_and_labelled():
    # 2026-11-13: the screen is every plan's first scale (D1); at Save, which door it came through (scale_nudge.DOORS).
    doors = ("upload", "setup", "getting_started", "wizard", "reminder", "plans", "stack")
    words = {f"scale_nudge:{k}" for k in ("shown", "first_end", "both_ends", "typed", "refused", "not_to_scale", "per_axis", "measured_one", "measured_two", "later", "reminder_measure")} | {f"scale_nudge:via_{d}" for d in doors}
    assert T.SCALE_NUDGE_EVENTS == words and all(T.event_allowed(e) for e in words)
    spec = importlib.util.spec_from_file_location("telemetry_summary", _ROOT / "server" / "telemetry_summary.py")
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    assert set(S._SCALE_NUDGE) == words
    js = (_WWW / "views" / "scale_nudge.js").read_text(encoding="utf-8")
    sent = set(re.findall(r'tel\(ctx, "([a-z_]+)"\)', js)) | set(re.findall(r'"(measured_[a-z]+)"', js))
    m = re.search(r"export const DOORS = Object\.freeze\(\[([^\]]*)\]\)", js)
    assert m and tuple(re.findall(r'"([a-z_]+)"', m.group(1))) == doors and 'tel(ctx, "via_" + opts.door)' in js
    sent |= {f"via_{d}" for d in doors}
    assert {f"scale_nudge:{w}" for w in sent} == words
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    assert all(f"{k}:" in ib for k in ("measured_one", "measured_two", "reminder_measure", *T.SCALE_NUDGE_STEPS, *T.SCALE_NUDGE_SKETCH, *(f"via_{d}" for d in doors))) and 'a === "scale_nudge"' in ib
    # Mapping → Upload's own words (2026-11-15): the panel sends exactly the allowed ones, summed and labelled.
    up = {f"plan_upload:{k}" for k in T.PLAN_UPLOAD_WORDS}
    dr = {f"wizard_draw:{k}" for k in T.WIZARD_DRAW_WORDS}
    rg = {f"rough_plan:{k}" for k in T.ROUGH_PLAN_WORDS + T.ROUGH_PLAN_WALK + T.ROUGH_PLAN_SCAN}
    assert T.PLAN_UPLOAD_EVENTS == up and T.WIZARD_DRAW_EVENTS == dr and T.ROUGH_PLAN_EVENTS == rg
    pc = {f"plan_carry:{k}" for k in T.PLAN_CARRY_WORDS}
    assert T.PLAN_CARRY_EVENTS == pc and set(S._PLAN_UPLOAD) == up | dr | rg | pc and all(T.event_allowed(e) for e in up | dr | rg | pc)
    cj = (_WWW / "views" / "plan_carry.js").read_text(encoding="utf-8")
    assert 'tel(ctx, "moved_" + k)' in cj and 'export const KINDS = Object.freeze(["rooms", "receivers", "points", "devices"]);' in cj
    assert set(re.findall(r'tel\(ctx, "([a-z_]+)"\)', cj)) | {f"moved_{k}" for k in ("rooms", "receivers", "points", "devices")} == set(T.PLAN_CARRY_WORDS)
    assert all(f"{k}:" in (_WWW / "views" / "installbase.js").read_text(encoding="utf-8") for k in T.PLAN_CARRY_WORDS)
    rj = (_WWW / "views" / "rough_plan.js").read_text(encoding="utf-8")
    sent_rg = set(re.findall(r'tel\(ctx, "([a-z_]+)"\)', rj)) | set(re.findall(r'KINDS = Object\.freeze\(\[([^\]]*)\]', rj)[0].replace('"', "").replace(" ", "").split(","))
    # Words the panel builds: the walk-through's screens ("walk_" + n), a refusal's reason, a scan's kind and walls band.
    assert 'once(ctx, "walk_" + (s.walk + 1))' in rj and 'tel(ctx, "scan_refused_" + (REFUSED[r && r.code] || "unreadable"))' in rj and 'tel(ctx, "scan_walls_" + wallsBand(' in rj
    built = ({f"walk_{n}" for n in range(2, 7)} | {f"scan_refused_{v}" for v in re.findall(r'(?:too_large|unreadable|not_scan|empty): "([a-z_]+)"', rj)}
             | {f"scan_walls_{b}" for b in re.findall(r'"(1_4|5_12|13_30|gt30)"', rj)} | {"scan_json", "scan_usdz"})
    sent_rg |= set(re.findall(r'once\(ctx, "([a-z_]+)"\)', rj)) | built
    sent_rg.discard("scan_refused_size") or sent_rg.add("scan_refused_size")
    assert 'tel(ctx, r.placed.fit ? (r.placed.fits_both_ways ? "scan_placed_both" : "scan_placed") : "scan_unplaced");' in rj
    sent_rg |= {"scan_placed_both", "scan_placed", "scan_unplaced"}
    # Rooms on a scanned plan are drawn in the plan editor, which counts them through rough_plan.scanCounted.
    mj0 = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    assert "export const scanCounted" in rj and all(f'ROUGH.scanCounted(ctx, "{w}")' in mj0 for w in ("scan_snap", "scan_room_used"))
    sent_rg |= {"scan_snap", "scan_room_used"}
    assert sent_rg == {e.split(":", 1)[1] for e in rg}, sorted(sent_rg ^ {e.split(":", 1)[1] for e in rg})
    assert all(f"{k}:" in ib for k in T.ROUGH_PLAN_WORDS + T.ROUGH_PLAN_WALK + T.ROUGH_PLAN_SCAN) and 'a === "rough_plan"' in ib
    mj = (_WWW / "views" / "maps.js").read_text(encoding="utf-8")
    part = mj[mj.index("const _upTel"):mj.index('"Upload & Convert"')]
    sent_up = set(re.findall(r'_upTel\("([a-z_]+)"\)', part)) | set(re.findall(r'"(too_large|bad_picture|failed)"', part))
    assert sent_up == set(T.PLAN_UPLOAD_WORDS), sent_up
    assert all(f"{k}:" in ib for k in T.PLAN_UPLOAD_WORDS) and 'a === "plan_upload"' in ib
    assert set(re.findall(r'telemetryEvent\("wizard_draw:([a-z_]+)"\)', mj)) == set(T.WIZARD_DRAW_WORDS) and 'a === "wizard_draw"' in ib


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_panel_harness():
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "scale_nudge.mjs"), str(_WWW)], capture_output=True, text=True, timeout=180)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, f"the harness itself failed:\n{res.stderr[-3000:]}"
    out = json.loads(lines[-1])
    assert out["cases"] and not out["failures"], json.dumps(out["failures"], indent=1)


# ── A picture that is not to scale, and no picture at all (2026-11-16) ──────────────────────────────────────────────
def test_a_sketch_gets_each_direction_its_own_scale_a_proper_plan_never(monkeypatch, tmp_path, disk):  # noqa: F811
    from custom_components.padspan_ha import plan_ai_write as C
    # 1000 x 800 px. Across: 500 px called 5 m (100 px/m). Down: 400 px called 5 m (80 px/m): a sketch drawn too short.
    two = [dict(_ACROSS), dict(_DOWN_OFF)]
    avg = C.scale_from_measures((1000, 800), two, None, "", False)
    assert avg["per_axis"] is False and avg["across_m"] == round(1000 / 90, 4) and avg["down_m"] == round(800 / 90, 4)
    each = C.scale_from_measures((1000, 800), two, None, "", False, per_axis=True)
    assert each["per_axis"] is True and each["across_m"] == 10.0 and each["down_m"] == 10.0 and each["differ_pct"] == 22.2
    # Slanted lengths too: both right at once (a 3-4-5 across-and-down, and a plain down).
    slant = [{"p1": [0.0, 0.0], "p2": [0.3, 0.5], "text": "5 m"}, {"p1": [0.5, 0.0], "p2": [0.5, 0.5], "text": "4 m"}]
    got = C.scale_from_measures((1000, 800), slant, None, "", False, per_axis=True)
    assert got["per_axis"] is True and got["across_m"] == 10.0 and got["down_m"] == 8.0
    # Two lengths the same way, or one alone: the average, as ever.
    same = [dict(_ACROSS), {"p1": [0.1, 0.2], "p2": [0.6, 0.25], "text": "5.2 m"}]
    assert C.scale_from_measures((1000, 800), same, None, "", False, per_axis=True)["per_axis"] is False
    assert C.scale_from_measures((1000, 800), [dict(_ACROSS)], None, "", False, per_axis=True)["per_axis"] is False
    # The command: a proper plan averages; "not to scale" pressed gives each way its own and the plan is a sketch after.
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    assert "per_axis" not in _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=two)
    assert _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=two, not_to_scale=True)["per_axis"] is True
    assert "kind" not in ms.get_map("n1"), "a preview writes nothing"
    out = _call(WM.ws_maps_scale_measure, h, conn, map_id="n1", measures=two, not_to_scale=True, save=True)
    assert out["ok"] is True and out["per_axis"] is True and (out["scale_x_m"], out["scale_y_m"]) == (10.0, 10.0)
    assert ms.get_map("n1")["kind"] == "sketch"
    ms.maps_dir = tmp_path
    # Uploaded as a sketch: the kind is kept, and no flag is needed; anything else is refused by the schema's own list.
    up = {"name": "S", "filename": "s.png", "mime": "image/png", "width": 12, "height": 9, "png_base64": __import__("base64").b64encode(__import__("custom_components.padspan_ha.maps_store", fromlist=["x"]).blank_plan_png(2.0, 2.0)[0]).decode()}
    assert _call(WM.ws_maps_upload, h, conn, **up, floor_id="main", kind="sketch")["map"]["kind"] == "sketch"
    assert "kind" not in _call(WM.ws_maps_upload, h, conn, **up, floor_id="main")["map"]


def test_a_blank_floor_is_to_scale_by_construction(monkeypatch, tmp_path, disk):  # noqa: F811
    from custom_components.padspan_ha import maps_store as MS
    png, w, hh = MS.blank_plan_png(12.0, 9.0)
    assert png[:4] == bytes([0x89, 0x50, 0x4E, 0x47]) and (w, hh) == (1200, 900)
    assert MS.blank_plan_png(40.0, 10.0)[1:] == (1600, 400), "the longer side is capped, the shape kept"
    assert MS._decode_png_to_rgba(png, w, hh) is not None
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    for bad in ({"across": "12 m", "down": "nine"}, {"across": "1 m", "down": "9 m"}, {"across": "300 m", "down": "9 m"}):
        out = _call(WM.ws_maps_blank_create, h, conn, floor_id="main", **bad)
        assert out["ok"] is False and out["code"] == "size"
    assert _call(WM.ws_maps_blank_create, h, conn, floor_id="__outside__", across="12 m", down="9 m")["code"] == "outdoor"
    n = len(ms.list_maps())
    out = _call(WM.ws_maps_blank_create, h, conn, floor_id="main", across="12 m", down="9 m", name="")
    m = out["map"]
    assert out["ok"] is True and m["kind"] == "blank" and m["name"] == "Blank floor" and len(ms.list_maps()) == n + 1
    t = mdl.map_transform(m["id"])
    assert (t["scale_x_m"], t["scale_y_m"]) == (12.0, 9.0) and t["reference_measurements"][0]["source"] == "blank"
    from custom_components.padspan_ha import setup_checks
    assert setup_checks.plans_out_of_shape([dict(m, receivers=[{"id": "r"}])], {m["id"]: t}) == []
    assert await_none(ms.async_set_kind(m["id"], "sketch")) is False, "a blank floor is never a sketch"


def test_a_room_scan_becomes_a_plan_to_scale_with_nothing_to_measure(monkeypatch, tmp_path, disk):  # noqa: F811
    import base64
    from tests.test_roomplan_import import _room, _usdz
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    b64 = base64.b64encode(_usdz(_room(0.0, 0.0, 4.0, 3.0))).decode()
    assert _call(WM.ws_maps_scan_create, h, conn, floor_id="__outside__", file_base64=b64)["code"] == "outdoor"
    assert _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=base64.b64encode(b"not a scan").decode())["code"] == "unreadable"
    n = len(ms.list_maps())
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=b64, name="")
    m = out["map"]
    assert out["ok"] is True and (out["rooms"], out["walls"], out["heights_m"]) == (1, 4, [2.5]) and len(ms.list_maps()) == n + 1
    assert m["kind"] == "scan" and m["name"] == "Room scan" and (m["image"]["width"], m["image"]["height"]) == (500, 400)
    assert m["scan"]["rooms"][0]["name"] == "Kitchen" and all(0 <= v <= 1 for p in m["scan"]["rooms"][0]["points"] for v in p)
    t = mdl.map_transform(m["id"])
    assert (t["scale_x_m"], t["scale_y_m"]) == (5.0, 4.0) and t["reference_measurements"][0]["source"] == "scan"
    assert (tmp_path / m["image"]["filename"]).read_bytes()[:4] == bytes([0x89, 0x50, 0x4E, 0x47])


def test_the_report_says_where_plans_came_from_and_how_far_each_kind_got():
    """Owner, 2026-11-16: "no maps means not purchasing": env.plans, words only, and the summary sets it against the tier."""
    P = lambda mid, kind=None, rooms=False, rx=False, floor="main": {"id": mid, "floor_id": floor, **({"kind": kind} if kind else {}),  # noqa: E731
                                                                      "room_bounds": {"A": {}} if rooms else {}, "receivers": [{"id": "r"}] if rx else []}
    sc = {"scale_x_m": 10.0, "scale_y_m": 8.0}
    maps = [P("a"), P("b", rooms=True), P("c", "scan", rooms=True, rx=True), P("d", "sketch"), P("e", "blank", rx=True), P("o", floor="__outside__", rooms=True),
            P("f"), P("g"), P("h")]
    tf = {"b": sc, "c": sc, "e": sc, "o": sc, "d": {"scale_x_m": 0}}
    got = T.plan_sources(maps, tf)
    assert got == {"picture": "rooms", "picture_n": "4_plus", "scan": "full", "scan_n": "1", "sketch": "unscaled", "sketch_n": "1", "blank": "receivers", "blank_n": "1"}
    assert T.plan_sources([], {}) == {} and T.plan_sources(None, None) == {} and T.plan_sources([P("o", floor="__outside__")], {}) == {}
    assert T.plan_sources([P("x", "something else")], {"x": sc}) == {"picture": "scaled", "picture_n": "1"}
    base = {"install_id": "", "env": {"plans": got}}
    T.assert_shareable(base)
    for bad in ({"picture": "nearly"}, {"house": "full"}, {"picture_n": "9"}, {}, {"picture": "full", "picture_n": 3}):
        with pytest.raises(ValueError, match="env.plans"):
            T.assert_shareable({"install_id": "", "env": {"plans": bad}})
    spec = importlib.util.spec_from_file_location("telemetry_summary", _ROOT / "server" / "telemetry_summary.py")
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    assert tuple(S._PLAN_SOURCES) == T.PLAN_SOURCES and tuple(S._PLAN_STAGES) == T.PLAN_STAGES
    latest = {"i1": {"tier": "free", "env": {"plans": {"picture": "unscaled", "picture_n": "1"}}}, "i2": {"tier": "pro", "env": {"plans": got}},
              "i3": {"tier": "free", "env": {}}, "i4": {"tier": "trial", "env": {"plans": {"scan": "rooms", "scan_n": "1"}}}}
    text = "\n".join(S.plans_section(latest))
    assert "installs saying where their plans came from: 3 of 4" in text
    rows = {ln.split()[0]: ln.split()[1:] for ln in text.splitlines() if ln.strip().split()[:1] and ln.strip().split()[0] in ("picture", "scan", "sketch", "blank")}
    assert rows["picture"] == ["2", "1", "0", "0", "1", "0"] and rows["scan"] == ["2", "0", "0", "0", "1", "1"]
    tiers = [ln for ln in text.splitlines() if ln.strip().startswith(("none told", "unscaled", "rooms", "full"))]
    assert any(ln.split() == ["none", "told", "1", "0", "0"] for ln in tiers) and any(ln.split() == ["full", "0", "1", "0"] for ln in tiers), tiers


def test_a_scans_furniture_is_kept_with_its_plan_and_follows_it(monkeypatch, tmp_path, disk):  # noqa: F811
    """Owner, 2026-11-16: the furniture a scan saw, as an option to draw ("normally off"), never part of the 3D file."""
    import base64
    from custom_components.padspan_ha import ws_house3d_import as HI
    from tests.test_roomplan_import import _bytes, _room
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    assert HI.scan_pieces(h) == {}, "no scanned plan, nothing"
    doc = _room(0.0, 0.0, 4.0, 3.0)
    doc["objects"].append({**doc["objects"][0], "category": {"stairs": {}}})          # a scan's stairs are for Furnish, not a guide
    m = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=base64.b64encode(_bytes(doc)).decode(), name="")["map"]
    kept = m["scan"]["furniture"]
    assert len(kept) == 1 and kept[0]["recipe"]["kind"] == "table" and kept[0]["at"] == [0.5, 0.5] and kept[0]["label"] == "Table"
    assert (kept[0]["recipe"]["width_m"], kept[0]["recipe"]["depth_m"], kept[0]["recipe"]["height_m"]) == (1.2, 0.8, 0.75)
    got = HI.scan_pieces(h)
    pid = f"scan_{m['id']}_0"
    assert list(got) == [pid] and (got[pid]["x_m"], got[pid]["y_m"], got[pid]["floor_id"], got[pid]["origin"]) == (2.5, 2.0, "main", "scan")
    # The plan moved: its furniture with it, worked out at the read.
    mdl.data["map_transforms"][m["id"]].update(origin_x_m=10.0, origin_y_m=-4.0)      # as 3D Stack's Save Alignment leaves it
    assert (HI.scan_pieces(h)[pid]["x_m"], HI.scan_pieces(h)[pid]["y_m"]) == (12.5, -2.0)
    assert HI.SCAN_FURNITURE_MAX == 150 and len(HI.scan_furniture({"across_m": 5.0, "down_m": 4.0, "objects": [
        {"category": "chair", "center_m": [1, 1], "size_m": [0.5, 0.5], "height_m": 0.9, "angle_deg": 0}] * 400})) == 150


def test_a_scans_places_on_its_picture_go_when_the_picture_is_changed_and_a_scan_too_big_is_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    """Review 2026-11-16: an extend to the left left a table 1.25 m off; a wall at 1e15 m never returned."""
    import base64
    from custom_components.padspan_ha import maps_store as MS
    from custom_components.padspan_ha import ws_house3d_import as HI
    from tests.test_roomplan_import import _bytes, _room
    m = {"id": "s1", "kind": "scan", "scan": {"furniture": [{"at": [0.5, 0.5]}], "rooms": [{"name": "A"}], "heights_m": [2.5]}}
    MS._scan_stale(m)
    assert m["scan"] == {"heights_m": [2.5]}
    MS._scan_stale({"id": "p"})                                           # a plan that is no scan: nothing to do
    src = (_ROOT / "custom_components" / "padspan_ha" / "maps_store.py").read_text(encoding="utf-8")
    for fn in ("async_replace_image", "async_extend_canvas", "async_revert_extend"):
        body = src[src.index(f"async def {fn}"):]
        end = body.find("    async def ", 10)
        assert "_scan_stale(m)" in (body[:end] if end > 0 else body), fn
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    far = _room(0.0, 0.0, 4.0, 3.0)
    far["walls"][0]["transform"][12] = 1e9                                # one wall a million kilometres off
    n = len(ms.list_maps())
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=base64.b64encode(_bytes(far)).decode(), name="")
    assert out["ok"] is False and out["code"] == "too_large" and len(ms.list_maps()) == n
    assert HI.scan_pieces(h) == {}


def test_a_scan_is_placed_among_the_floors_rooms_and_nothing_else_moves(monkeypatch, tmp_path, disk):  # noqa: F811
    """Owner, 2026-11-16: "a test in a house like mine with plans would be an autoplace for lidar files"."""
    import base64
    import math
    from tests.test_roomplan_import import _bytes, _room
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.maps_dir = tmp_path
    scan = base64.b64encode(_bytes(_room(0.0, 0.0, 4.0, 3.0))).decode()
    # No room drawn on the floor: the plan starts where every new plan does, and nothing is said of placing.
    monkeypatch.setattr(mdl, "room_geometry_m", lambda: {})
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=scan, name="")
    assert out["ok"] is True and "placed" not in out
    # A room of its shape on the floor, elsewhere in the house, and one on another floor that must not be looked at.
    rooms = {"Kitchen": {"floor_id": "main", "points_m": [[20, 10], [24, 10], [24, 13], [20, 13]]},
             "Loft": {"floor_id": "upper", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]]},
             "Hall": {"floor_id": "main", "points_m": [[24, 10], [26, 10], [26, 18], [24, 18]]}}
    monkeypatch.setattr(mdl, "room_geometry_m", lambda: rooms)
    before = json.dumps({k: v for k, v in mdl.data.get("map_transforms", {}).items()}, sort_keys=True)
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=scan, name="")
    p, m = out["placed"], out["map"]
    assert p["fit"] is True and p["room"] == "Kitchen" and p["score"] >= 0.9 and sorted(p["size_scan_m"]) == sorted(p["size_room_m"]) == [3.0, 4.0]
    t = mdl.map_transform(m["id"])
    c, s = math.cos(t["rotation_rad"]), math.sin(t["rotation_rad"])
    mid = [t["origin_x_m"] + 2.5 * c - 2.0 * s, t["origin_y_m"] + 2.5 * s + 2.0 * c]       # the plan's middle (5 x 4 m), in the house
    assert math.dist(mid, [22.0, 11.5]) < 0.15, (t, mid)
    after = {k: v for k, v in mdl.data.get("map_transforms", {}).items() if k != m["id"]}
    assert json.dumps(after, sort_keys=True) == before, "no other plan moved"
    # A floor whose rooms it fits none of: saved, said not placed, left where a new plan starts.
    monkeypatch.setattr(mdl, "room_geometry_m", lambda: {"Hall": rooms["Hall"]})
    out = _call(WM.ws_maps_scan_create, h, conn, floor_id="main", file_base64=scan, name="")
    assert out["ok"] is True and out["placed"] == {"fit": False}
