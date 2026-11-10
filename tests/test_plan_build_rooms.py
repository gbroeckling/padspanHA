"""Build from plans, Stage 2 (experimental): rooms, doors, windows and stairs
read together, two reads a plan (plan_ai.py's rooms, plan_geom.py's outlines,
plan_ai_write.py's rooms_commit / rooms_undo / settle_rooms, ws_plan_ai.py's
plan_build_rooms_* commands; design PadspanResearch plan-build-design-2026-11.md
section 5). A synthetic floor (no house's plans or rooms are in the repo): two
of the person's rooms, a third the plans don't show, two extra spaces, doors,
a window and a stair; a fake Claude answering read 1 and read 2 differently
where the test needs it. The REAL fabric, model and 3D stores, on disk, so
every write is the real one.
"""
from __future__ import annotations

import copy
import hashlib
import inspect
import json
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from custom_components.padspan_ha import ai_usage as U
from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_ai_write as C
from custom_components.padspan_ha import plan_geom as G
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import (BACKUPS_STORE_KEY, DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_PLAN_AI,
                                                DATA_SETTINGS, DOMAIN, FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MODEL_STORE_KEY, PLAN_AI_STORE_KEY)
from custom_components.padspan_ha.fabric_store import FabricStore
from custom_components.padspan_ha.model_store import ModelStore
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_photo import _AiTask, _ready
from tests.test_house3d_store import _run

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_CLAUDE = "ai_task.claude_ai_task"
_T = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0, "scale_y_m": 8.0, "rotation_rad": 0.0}   # 100 px a metre
_SIZE = (1000, 800)

# ═══ the floor ═══════════════════════════════════════════════════════════════
# His rooms (metres): Den and Shop side by side across a 0.2 m wall, Garage far
# off (no plan shows it). The plan (pixels = metres × 100): DEN and SHOP over
# his two, STORE and NOOK below them (in none of his rooms: extra spaces, a
# 0.1 m wall apart), a door in the Den-Shop wall, a sliding door out of the
# Shop, a window in the Den, a stair in the Den. Read 2 draws SHOP shorter
# (the reads differ there) and adds a doorway between STORE and NOOK (a maybe).

_DEN, _SHOP, _GARAGE = [[1, 1], [4, 1], [4, 4.5], [1, 4.5]], [[4.2, 1], [9, 1], [9, 4.5], [4.2, 4.5]], [[20, 20], [22, 20], [22, 22], [20, 22]]


def _box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _read(k: int, *, shop_px=None) -> dict:
    shop = shop_px or (_box(420, 100, 900, 450) if k == 1 else _box(420, 100, 900, 300))
    doors = [{"at": [410, 300] if k == 1 else [412, 302], "between": ["DEN", "SHOP"], "kind": "hinged"},
             {"at": [600, 450] if k == 1 else [601, 449], "between": ["SHOP", "outside"], "kind": "sliding"}]
    if k == 2:
        doors.append({"at": [255, 600], "between": ["STORE", "NOOK"], "kind": "opening"})
    return {"rooms": [{"name": "DEN", "corners": _box(100, 100, 400, 450)}, {"name": "SHOP", "corners": shop},
                      {"name": "STORE", "corners": _box(100, 470, 250, 700)}, {"name": "NOOK", "corners": _box(260, 470, 400, 700)}],
            "doors": doors, "windows": [{"at": [100, 250] if k == 1 else [101, 252], "room": "DEN"}],
            "stairs": [{"box": [150, 150, 230, 300], "room": "DEN", "says": "UP"}]}


class _Claude(_AiTask):
    """Claude, faked: read 1 then read 2 of the plan (by its size in the
    prompt), as text with a correction before the last JSON on read 2."""

    def __init__(self, media, reads=None, fail=None):
        super().__init__(media, None)
        self.reads, self.fail, self.n = reads or {1: _read(1), 2: _read(2)}, fail, 0

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        self.calls.append((domain, service, data))
        f = self.fail() if callable(self.fail) else self.fail
        if isinstance(f, BaseException):
            raise f
        self.n += 1
        k = 1 if self.n % 2 else 2
        if k == 2:                                         # Claude corrects itself: the last JSON is the answer
            return {"data": "Here it is: " + json.dumps({"rooms": [], "doors": []}) + "\nLet me reconsider the shop.\n" + json.dumps(self.reads[2])}
        return {"data": json.dumps(self.reads[1])}


def _points(extra_shop: int = 0) -> list[dict]:
    pts = [{"id": "cp_1", "map_id": "g1", "x_m": 2.0, "y_m": 2.0, "floor_id": "main", "room": "Den", "scanner_readings": []},
           {"id": "cp_2", "map_id": "g1", "x_m": 3.0, "y_m": 3.0, "floor_id": "main", "room": "Den", "scanner_readings": []},
           {"id": "cp_3", "map_id": "g1", "x_m": 8.0, "y_m": 4.0, "floor_id": "main", "room": "Shop", "scanner_readings": []}]
    pts += [{"id": f"cp_s{i}", "map_id": "g1", "x_m": 5.0 + i * 0.3, "y_m": 4.0, "floor_id": "main", "room": "Shop", "scanner_readings": []}
            for i in range(extra_shop)]
    return pts


def _house(monkeypatch, tmp_path, disk, *, reads=None, fail=None, lined=True, house3d=None, points=None):  # noqa: F811
    h, conn, _ai, media = _ready(monkeypatch, tmp_path, answer="{}", platform="anthropic")
    h.data[DOMAIN][DATA_SETTINGS].data.update(atlas_3d_ai_task_entity=_CLAUDE, ai_plans_enabled=True, ai_plan_build_enabled=True,
                                               telemetry_enabled=True)
    h.states.get = lambda eid: SimpleNamespace(state="unknown", attributes={"friendly_name": "Claude AI Task", "supported_features": 3}) \
        if eid == _CLAUDE else None
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: ["Claude Opus 5.5", "claude-opus-5-5"])
    monkeypatch.setattr(U, "model_of", lambda hass, eid: "Claude Opus 5.5")
    conn.user = SimpleNamespace(is_admin=True, name="Garry")
    pic = tmp_path / "plan.png"
    Image.new("RGB", _SIZE, "white").save(pic)
    maps = [{"id": "g1", "name": "Measured", "floor_id": "main", "image": {"filename": "plan.png", "width": _SIZE[0], "height": _SIZE[1], "sha256": "gg"},
             "updated": "2026-11-10", "room_bounds": {}, "receivers": [], "beacons": [], "lights": []}]
    h.data[DOMAIN][DATA_MAPS] = SimpleNamespace(list_maps=lambda: maps, get_map=lambda mid: next((m for m in maps if m["id"] == mid), None),
                                                image_file=lambda fn, must_exist=True: pic if fn == "plan.png" else None)
    fab = FabricStore.__new__(FabricStore)
    fab.hass, fab.store = h, disk(h, 1, FABRIC_STORE_KEY)
    fab.data = {"floors": {"main": {"committed": False, "rooms": {
        "Den": {"type": "poly", "points_m": _DEN, "floor_id": "main", "source_map_id": "g1", "source_transform": dict(_T), "source_image": {"sha256": "gg"},
                "committed_by": "correction", "revision": 3},
        "Shop": {"type": "poly", "points_m": _SHOP, "floor_id": "main", "committed_by": "correction", "revision": 1},
        "Garage": {"type": "poly", "points_m": _GARAGE, "floor_id": "main", "committed_by": "correction", "revision": 1}}}},
        "rf_barriers_m": []}
    mdl = ModelStore.__new__(ModelStore)
    mdl.hass, mdl.store = h, disk(h, 1, MODEL_STORE_KEY)
    mdl.data = {"map_transforms": {"g1": {**_T, "floor_id": "main", "origin_anchored": True}},
                "floors": [{"id": "basement", "name": "Basement", "level": 0}, {"id": "main", "name": "Main", "level": 1}, {"id": "upper", "name": "Upper", "level": 2}],
                "world_gauge": {"m_per_unit": 10.0, "source_map_id": "g1"}, "room_meta": {n: {"floor_id": "main", "color": "#123456"} for n in ("Den", "Shop", "Garage")},
                "room_adjacency": {"Den": ["Shop"], "Shop": ["Den"], "Garage": []}, "scanners": {}}
    mdl.fabric = fab
    h.data[DOMAIN][DATA_FABRIC], h.data[DOMAIN][DATA_MODEL] = fab, mdl
    pts = points if points is not None else _points()
    h.data[DOMAIN][DATA_CALIBRATION] = SimpleNamespace(list_points=lambda: copy.deepcopy(pts), excluded_sources=lambda: frozenset())
    for st in (fab, mdl):
        _run(st.store.async_save(st.data))
    if house3d is not None:
        _run(disk(h, 1, HOUSE3D_STORE_KEY).async_save({"schema": 1, "openings": {}, "lights": {}, "devices": {}, "pieces": {}, "figures": {}, **house3d}))
    ai = _Claude(media, reads, fail)
    h.services.async_call = ai
    h.jobs = []                                            # the started job, run by the test (_finish)
    h.async_create_background_task = lambda coro, name: (h.jobs.append(coro), SimpleNamespace(done=lambda: True))[1]
    h.data[DOMAIN].pop(DATA_PLAN_AI, None)
    h.data[DOMAIN].pop("house3d_store", None)
    if lined:
        _line_up(h)
    disk.writes.clear()
    return h, conn, ai


def _line_up(h, status="done", role="gauge"):
    """The floor's line-up, as Stage 1 leaves it."""
    async def go():
        store = await A.async_get_store(h)
        snap = A.house_snapshot(h)
        p = snap["plans"]["g1"]
        store.data["lineups"]["pb_l"] = {"floor_id": "main", "status": status, "started_at": 1.0, "items": {},
                                         "plans": [{"map_id": "g1", "name": "Measured", "role": role, "image_sig": p["image_sig"], "place_sig": p["place_sig"]}]}
        await store.async_save()
    _run(go())


def _call(fn, h, conn, **kw):
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()
    _run(fn(h, conn, {"id": 5, "type": "x", **kw}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def _read_floor(h, conn) -> dict:
    """plan_build_rooms_start, its job run to its end, then the status."""
    r = _call(W.ws_plan_build_rooms_start, h, conn, floor_id="main")
    assert "session" in r, r
    _finish(h)
    return _call(W.ws_plan_build_rooms_status, h, conn, session=r["session"])["session"]


def _finish(h) -> None:
    """Run the job a command started, to its end."""
    while h.jobs:
        _run(h.jobs.pop(0))


def _counters(h) -> dict:
    from custom_components.padspan_ha.telemetry import _DATA_COUNTERS
    return dict(h.data[DOMAIN].get(_DATA_COUNTERS) or {})


def _fab_rooms(h) -> dict:
    return {n: copy.deepcopy(r) for n, r in h.data[DOMAIN][DATA_FABRIC].data["floors"]["main"]["rooms"].items()}


def _house3d(tmp_path) -> dict:
    f = tmp_path / ".storage" / HOUSE3D_STORE_KEY
    return json.loads(f.read_text(encoding="utf-8"))["data"] if f.is_file() else {}


def _backups(tmp_path) -> list[dict]:
    f = tmp_path / ".storage" / BACKUPS_STORE_KEY
    return json.loads(f.read_text(encoding="utf-8"))["data"]["backups"] if f.is_file() else []


def _commit(h, conn, sess, items, finals=None):
    return _call(W.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=items, **({"finals": finals} if finals else {}))


# ═══ pure: the prompt, the answer, the outlines ══════════════════════════════

def test_the_prompt_is_the_tested_one_word_for_word():
    """The prompt the 2026-11-10 test read his plans with (run_joint_s2.prompt_joint,
    look_first False). Any change must be tested again before it ships."""
    p = A.rooms_prompt(901, 1275)
    assert hashlib.sha256(p.encode()).hexdigest() == "8cc521e9ccd0a961efda02350873a34f27512f3e65dfea8029e7ed8c10e4a014"
    assert p.endswith("Output only JSON: " + A.ROOMS_SCHEMA) and "901 by 1275 pixels" in p
    assert (A.S2_PICTURE_PX, A.S2_PICTURE_MP, A.S2_READS) == (1568, 1.15, 2)          # the tested size, two reads


def test_the_last_json_is_the_answer_and_points_are_kept_in_the_frame():
    one, two = {"rooms": [{"name": "A", "corners": _box(0, 0, 10, 10)}]}, {"rooms": [{"name": "B", "corners": _box(0, 0, 20, 20)}]}
    assert A.last_json(json.dumps(one) + " Let me reconsider. " + json.dumps(two)) == two
    assert A.last_json(two) is two and A.last_json("no json here") is None and A.last_json('{"x": 1}') is None
    got = A.parse_rooms_read({"rooms": [{"name": "  Big   ROOM name that runs on and on past forty characters", "corners": _box(10, 10, 110, 60)},
                                        {"name": "off", "corners": [[0, 0], [5000, 0], [5000, 10]]}],
                              "doors": [{"at": [50, 30], "between": ["A", "outside"], "kind": "weird"}], "windows": [{"at": [9999, 0]}],
                              "stairs": [{"box": [20, 20, 60, 50], "says": "dn"}]}, 200, 100, 0.5)
    assert [r["name"] for r in got["rooms"]] == ["Big ROOM name that runs on and on past f"]     # 40 characters; the room out of frame left out
    assert got["rooms"][0]["px"][2] == [220.0, 120.0]                                            # in the picture's own pixels (÷ k)
    assert got["doors"] == [{"px": [100.0, 60.0], "kind": "hinged", "between": ["A", "outside"]}] and got["windows"] == []
    assert got["stairs"][0]["says"] == "DOWN"
    assert A.parse_rooms_read("nothing", 10, 10) is None


def test_a_merge_is_one_clean_polygon_across_a_wall():
    a, b = _box(0, 0, 4, 3), _box(4.2, 0, 7, 3)                  # two rooms a 0.2 m wall apart
    out, pieces = G.merge_outline([a, b])
    assert pieces == 1 and len(out) == 4
    xs, ys = sorted({p[0] for p in out}), sorted({p[1] for p in out})
    assert xs == pytest.approx([0, 7], abs=0.03) and ys == pytest.approx([0, 3], abs=0.03)
    out, pieces = G.merge_outline([a, b, _box(0, 3.2, 3, 5)])    # an L: still one, six corners
    assert pieces == 1 and len(out) == 6
    out, pieces = G.merge_outline([a, _box(20, 20, 22, 22)])     # too far apart: the larger kept, said
    assert pieces == 2 and G.area(out) == pytest.approx(12, rel=0.05)
    ring = [_box(0, 0, 6, 1), _box(0, 5, 6, 6), _box(0, 1.1, 1, 4.9), _box(5, 1.1, 6, 4.9)]   # a hole in the middle is filled
    out, pieces = G.merge_outline(ring)
    assert pieces == 1 and G.area(out) == pytest.approx(36, rel=0.03) and len(out) == 4
    assert G.merge_outline([a])[0] == [[0, 0], [4, 0], [4, 3], [0, 3]]


def test_overlap_shares_and_edges():
    assert G.poly_iou(_DEN, _DEN) == pytest.approx(1.0) and G.poly_iou(_DEN, _GARAGE) == 0.0
    assert G.share_inside(_box(1, 1, 2, 2), _DEN) == pytest.approx(1.0, abs=0.05) and G.share_inside(_DEN, _box(1, 1, 2.5, 4.5)) == pytest.approx(0.5, abs=0.05)
    assert G.union_iou([_box(0, 0, 1, 1), _box(1, 0, 2, 1)], [_box(0, 0, 2, 1)]) == pytest.approx(1.0, abs=0.06)
    e = G.nearest_edge(_DEN, 4.1, 2.0)
    assert e["at"] == pytest.approx((4.0, 2.0)) and abs(e["u"][1]) == pytest.approx(1.0) and e["d"] == pytest.approx(0.1)


# ═══ the proposal ════════════════════════════════════════════════════════════

def _proposal(h, reads=None, edits=None, house=None):
    snap = A.house_snapshot(h)
    p = snap["plans"]["g1"]
    sess = {"floor_id": "main", "edits": edits or {"merges": [], "spaces": {}, "picks": {}},
            "plans": [{"map_id": "g1", "name": "Measured", "floor_id": "main", "size_px": list(_SIZE), "t": p["t"],
                       "reads": [A.parse_rooms_read(r, *_SIZE) for r in (reads or (_read(1), _read(2)))]}]}
    pts = h.data[DOMAIN][DATA_CALIBRATION].list_points()
    return sess, snap, A.rooms_proposal(sess, snap, house or {}, pts, [])


def test_rooms_go_by_overlap_into_his_rooms_never_by_name(monkeypatch, tmp_path, disk):  # noqa: F811
    h, _conn, _ai = _house(monkeypatch, tmp_path, disk)
    r1 = _read(1)
    r1["rooms"][0]["name"] = "SHOP"                                # printed names swapped: the overlap decides
    r1["rooms"][1]["name"] = "DEN"
    _s, _snap, prop = _proposal(h, (r1, copy.deepcopy(r1)))
    assert set(prop["rooms"]) == {"Den", "Shop"} and prop["unseen"] == ["Garage"]       # never renamed, never deleted, the unseen listed
    assert prop["rooms"]["Den"]["parts"] == [["SHOP"], ["SHOP"]]
    assert prop["rooms"]["Den"]["iou_now"] == pytest.approx(1.0, abs=0.05) and prop["rooms"]["Den"]["ready"]
    assert {s["name"] for s in prop["spaces"].values()} == {"STORE", "NOOK"}             # in none of his rooms: extra spaces, both reads seen as one
    assert all(s["reads"] == [1, 2] and not s["new"] and not s["merged_into"] for s in prop["spaces"].values())


def test_two_reads_flag_the_room_they_differ_on_and_the_spots_pick_the_read(monkeypatch, tmp_path, disk):  # noqa: F811
    h, _conn, _ai = _house(monkeypatch, tmp_path, disk)
    sess, snap, prop = _proposal(h)
    den, shop = prop["rooms"]["Den"], prop["rooms"]["Shop"]
    assert den["ready"] and den["agree"] >= A.S2_AGREE and den["flags"] == []
    assert not shop["ready"] and shop["agree"] < A.S2_AGREE and "reads_differ" in shop["flags"]
    apart = [_read(1), _read(2)]
    for r in apart:                                  # the Den read as two printed rooms 1.5 m apart: they can't join
        r["rooms"][0]["corners"] = _box(100, 100, 160, 450)
        r["rooms"].append({"name": "DEN 2", "corners": _box(320, 100, 400, 450)})
    _s2, _snap2, p2 = _proposal(h, apart)
    assert "apart" in p2["rooms"]["Den"]["flags"] and not p2["rooms"]["Den"]["ready"]
    assert shop["spots"] == [1, 0, 1] and shop["pick"] == 1 and shop["picked_by"] == "spots"     # read 1 keeps the Shop's spot inside it
    assert shop["reads_m"][0] and shop["reads_m"][1]                                          # both outlines shown
    sess["edits"]["picks"]["Shop"] = 2                                                        # the person picks read 2
    prop2 = A.rooms_proposal(sess, snap, {}, h.data[DOMAIN][DATA_CALIBRATION].list_points(), [])
    assert prop2["rooms"]["Shop"]["pick"] == 2 and prop2["rooms"]["Shop"]["picked_by"] == "person"
    assert prop2["rooms"]["Shop"]["cal"]["leaving"] == 1 and prop2["rooms"]["Shop"]["cal"]["leave"] == ["cp_3"]   # flagged, never relabelled


def test_agreeing_reads_are_trusted_over_the_outline_he_drew(monkeypatch, tmp_path, disk):  # noqa: F811
    """Garry, 2026-11-10: "My kitchen open edge is wrong, trust the ai results on this one": a room both reads
    agree on is ready, however far it is from his outline; only reads that disagree flag a room."""
    h, _conn, _ai = _house(monkeypatch, tmp_path, disk)
    r = _read(1, shop_px=_box(420, 100, 900, 250))
    _s, _snap, prop = _proposal(h, (r, copy.deepcopy(r)))
    shop = prop["rooms"]["Shop"]
    assert shop["ready"] and shop["flags"] == [] and shop["iou_now"] < 0.5 and shop["default"]


def test_merges_new_rooms_and_never_two_of_his_rooms(monkeypatch, tmp_path, disk):  # noqa: F811
    h, _conn, _ai = _house(monkeypatch, tmp_path, disk)
    sess, snap, prop = _proposal(h)
    sess["proposal"] = prop
    store_, nook = (next(i for i, s in prop["spaces"].items() if s["name"] == n) for n in ("STORE", "NOOK"))
    assert A.apply_rooms_edit(sess, snap, "merge", {"parts": ["room:Den", "room:Shop"]}) == "two_rooms"      # would delete one of his rooms
    assert A.apply_rooms_edit(sess, snap, "merge", {"parts": [store_]}) == "invalid"
    assert A.apply_rooms_edit(sess, snap, "space", {"space": store_, "name": "den"}) == "name_taken"
    # Two spaces into one (one clean polygon across their 0.1 m wall), then named as a new room.
    assert A.apply_rooms_edit(sess, snap, "merge", {"parts": [store_, nook]}) == "ok"
    prop = sess["proposal"] = A.rooms_proposal(sess, snap, {}, h.data[DOMAIN][DATA_CALIBRATION].list_points(), [])
    m = prop["spaces"]["space:m1"]
    assert prop["spaces"][store_]["merged_into"] == "space:m1" and len(m["outline_m"]) == 4 and G.area(m["outline_m"]) == pytest.approx(3 * 2.3, rel=0.05)
    assert A.apply_rooms_edit(sess, snap, "space", {"space": "space:m1", "name": "  Store room "}) == "ok"
    prop = sess["proposal"] = A.rooms_proposal(sess, snap, {}, h.data[DOMAIN][DATA_CALIBRATION].list_points(), [])
    assert prop["spaces"]["space:m1"]["new"] == "Store room" and A.chosen_outlines(prop, ["space:m1"]) == {"Store room": m["outline_m"]}
    # Separate takes it back; a space merged into one of his rooms grows that room's outline.
    assert A.apply_rooms_edit(sess, snap, "separate", {"merge": 1}) == "ok"
    sess["proposal"] = A.rooms_proposal(sess, snap, {}, h.data[DOMAIN][DATA_CALIBRATION].list_points(), [])     # as the command does after each edit
    assert A.apply_rooms_edit(sess, snap, "merge", {"parts": ["room:Den", store_]}) == "ok"
    prop = A.rooms_proposal(sess, snap, {}, h.data[DOMAIN][DATA_CALIBRATION].list_points(), [])
    den = prop["rooms"]["Den"]
    assert den["merged"] == [store_] and len(den["outline_m"]) == 6 and G.area(den["outline_m"]) > G.area(_DEN) + 3


def test_doors_go_on_the_wall_between_windows_on_an_edge_maybe_and_already_there(monkeypatch, tmp_path, disk):  # noqa: F811
    h, _conn, _ai = _house(monkeypatch, tmp_path, disk)
    _s, _snap, prop = _proposal(h)
    ops = prop["openings"]
    inner = next(o for o in ops.values() if o["between"] == ["DEN", "SHOP"])
    assert inner["reads"] == 2 and inner["default"] and inner["kind"] == "door" and set(inner["rooms"]) == {"Den", "Shop"}
    assert inner["a_m"][0] == pytest.approx(4.1, abs=0.03) and inner["b_m"][0] == pytest.approx(4.1, abs=0.03)    # the middle of the wall
    assert abs(inner["b_m"][1] - inner["a_m"][1]) == pytest.approx(A.S2_WIDTH_M["door"], abs=0.01)
    slide = next(o for o in ops.values() if o["between"] == ["SHOP", "outside"])
    assert slide["type"] == "sliding" and slide["a_m"][1] == pytest.approx(4.5, abs=0.03) and slide["default"]
    maybe = next(o for o in ops.values() if o["between"] == ["STORE", "NOOK"])
    assert maybe["reads"] == 1 and maybe["kind"] == "doorway" and not maybe["default"]                         # one read only: unticked
    win = next(o for o in ops.values() if o["cls"] == "window")
    assert win["a_m"][0] == pytest.approx(1.0, abs=0.03) and abs(win["b_m"][1] - win["a_m"][1]) == pytest.approx(1.2, abs=0.01)
    # An opening already in the house within half a metre: never a second one.
    have = {"openings": {"door_0a0b0c0d": {"kind": "door", "floor_id": "main", "a_m": [4.1, 2.6], "b_m": [4.1, 3.4], "head_m": 2.03, "hinge": "left", "swing": "in"}}}
    _s, _snap, prop = _proposal(h, house=have)
    inner = next(o for o in prop["openings"].values() if o["between"] == ["DEN", "SHOP"])
    assert inner["existing"] == {"id": "door_0a0b0c0d", "what": "opening"} and not inner["default"] and not C._offered(prop, inner["id"])  # noqa: SLF001
    barrier = [{"id": "bar_1", "name": "Front door", "material": "wood", "floor_id": "main", "points_m": [[1.0, 2.2], [1.0, 2.8]]}]
    snap = A.house_snapshot(h)
    p2 = A.rooms_proposal({**_s, "floor_id": "main"}, snap, {}, [], barrier)
    win = next(o for o in p2["openings"].values() if o["cls"] == "window")
    assert win["existing"] is None                                        # a door barrier is no window
    barrier[0]["name"] = "Den window"
    p2 = A.rooms_proposal({**_s, "floor_id": "main"}, snap, {}, [], barrier)
    assert next(o for o in p2["openings"].values() if o["cls"] == "window")["existing"] == {"id": "bar_1", "what": "barrier"}


def test_stairs_are_matched_against_the_3d_house(monkeypatch, tmp_path, disk):  # noqa: F811
    h, _conn, _ai = _house(monkeypatch, tmp_path, disk)
    _s, _snap, prop = _proposal(h)
    st = next(iter(prop["stairs"].values()))
    assert st["relation"] == "new" and st["reads"] == 2 and st["default"] and st["floor_id"] == "main"
    assert st["geom"]["x_m"] == pytest.approx(1.9) and st["geom"]["y_m"] == pytest.approx(2.25)
    piece = {"recipe": {"kind": "stairs", "params": {"shape": "straight"}}, "floor_id": "main", "x_m": 1.95, "y_m": 2.3, "label": "Stairs"}
    _s, _snap, prop = _proposal(h, house={"pieces": {"fur_00000001": piece}})
    st = next(iter(prop["stairs"].values()))
    assert st["relation"] == "duplicate" and not st["default"] and not C._offered(prop, st["id"])      # noqa: SLF001 — already there
    _s, _snap, prop = _proposal(h, house={"pieces": {"fur_00000001": {**piece, "x_m": 3.4}}})
    st = next(iter(prop["stairs"].values()))
    assert st["relation"] == "correction" and st["target"] == "fur_00000001" and st["hand"] and not st["default"]    # placed by hand: offered, not ticked
    _s, _snap, prop = _proposal(h, house={"pieces": {"fur_00000001": {**piece, "x_m": 3.4, "label": "Stairs (from the plan)"}}})
    assert next(iter(prop["stairs"].values()))["default"]                                                           # an AI-placed one: ticked
    down = [_read(1), _read(2)]
    for r in down:
        r["stairs"][0]["says"] = "DOWN"
    _s, _snap, prop = _proposal(h, down)
    st = next(iter(prop["stairs"].values()))
    assert st["relation"] == "other_floor" and st["floor_id"] == "basement" and not st["default"] and not C._offered(prop, st["id"])  # noqa: SLF001


def test_the_gate_scores_containment_and_refuses_a_drop_past_two_points():
    rooms = {"Den": {"floor_id": "main", "points_m": _DEN}, "Shop": {"floor_id": "main", "points_m": _SHOP}}
    pts = _points(extra_shop=12)
    g = A.rooms_gate(pts, "main", rooms, {"Shop": _box(4.2, 1, 9, 3)})
    assert g["scored"] and g["spots"] == 15 and g["now"] == 100.0 and g["with"] < 98 and g["blocked"] and A.gate_event(g) == "blocked"
    g = A.rooms_gate(pts, "main", rooms, {"Shop": _box(4.2, 1, 9, 4.6)})
    assert not g["blocked"] and A.gate_event(g) == "same"
    few = A.rooms_gate(_points(), "main", rooms, {"Shop": _box(4.2, 1, 9, 3)})         # 3 labelled spots: shown, not judged
    assert not few["scored"] and not few["blocked"] and few["with"] < few["now"] and A.gate_event(few) == "unscored"


# ═══ the precondition, the session, the commands ═════════════════════════════

def test_a_floor_whose_line_up_is_open_or_moved_is_refused_by_name(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, ai = _house(monkeypatch, tmp_path, disk, lined=False)
    store = _run(A.async_get_store(h))
    assert A.rooms_ready(store, A.house_snapshot(h), "main")["why_more"] == "no_lineup"
    r = _call(W.ws_plan_build_rooms_start, h, conn, floor_id="main")
    assert r["error"] == "not_lined_up" and "experimental" in r["message"] and "Line up plans" in r["message"]
    _line_up(h, status="needs_help")
    assert A.rooms_ready(store, A.house_snapshot(h), "main")["why_more"] == "lineup_open"
    _line_up(h, role="plan")                                                       # ended, but this plan wasn't lined up
    assert not A.rooms_ready(store, A.house_snapshot(h), "main")["ok"]
    _line_up(h)
    assert A.rooms_ready(store, A.house_snapshot(h), "main")["ok"]
    h.data[DOMAIN][DATA_MODEL].data["map_transforms"]["g1"]["scale_x_m"] = 10.5      # moved since its line-up
    ready = A.rooms_ready(store, A.house_snapshot(h), "main")
    assert not ready["ok"] and ready["others"] == [{"map_id": "g1", "name": "Measured", "why": "moved"}]
    assert ai.calls == [] and _counters(h)["plan_build_stop:not_lined_up"] == 1


def test_a_floor_is_read_twice_a_plan_and_nothing_is_written(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, ai = _house(monkeypatch, tmp_path, disk)
    info = _call(W.ws_plan_build_info, h, conn)
    assert info["rooms"]["main"]["ready"] and info["rooms"]["main"]["plans"][0]["map_id"] == "g1" and info["rooms"]["main"]["plans"][0]["est_usd"] > 0
    assert not info["rooms"]["basement"]["ready"]
    was = (_fab_rooms(h), copy.deepcopy(h.data[DOMAIN][DATA_MODEL].data))
    s = _read_floor(h, conn)
    assert s["status"] == "done" and s["reads"] == 2 and s["plans"][0]["read"] == [True, True] and "reads" not in s["plans"][0]
    assert len(ai.calls) == 2 and all(c[2]["entity_id"] == _CLAUDE for c in ai.calls)                      # the main AI Task only
    assert all(c[2]["instructions"] == A.rooms_prompt(*_SIZE) for c in ai.calls)
    prop = s["proposal"]
    assert set(prop["rooms"]) == {"Den", "Shop"} and "reads_differ" in prop["rooms"]["Shop"]["flags"]      # read 2's last JSON was used
    assert (_fab_rooms(h), h.data[DOMAIN][DATA_MODEL].data) == was
    assert set(disk.writes) <= {PLAN_AI_STORE_KEY, U.STORE_KEY, "padspan_ha.telemetry_counters"}, disk.writes
    c = _counters(h)
    assert c["plan_build_run:s2_started"] == 1 and c["plan_build_run:s2_finished"] == 1 and c["plan_build_read:s2_plan"] == 2
    assert c["plan_build_item:room_shown"] == 2 and c["plan_build_agree:ready"] == 1 and c["plan_build_agree:differ"] == 1
    assert c["plan_build_item:door_shown"] == 2 and c["plan_build_item:door_maybe"] == 1 and c["ai_reads_kind:plan_build"] == 2


@pytest.mark.parametrize("fail,status,stop", [(lambda: RuntimeError("Your credit balance is too low to access the Anthropic API"), "no_credit", "no_credit"),
                                              (lambda: TimeoutError(), "out_of_time", "out_of_time")])
def test_a_read_that_cannot_happen_stops_with_its_reason_and_resume_reads_the_rest(monkeypatch, tmp_path, disk, fail, status, stop):  # noqa: F811
    h, conn, ai = _house(monkeypatch, tmp_path, disk)
    ai.fail = fail
    r = _call(W.ws_plan_build_rooms_start, h, conn, floor_id="main")
    _finish(h)
    s = _call(W.ws_plan_build_rooms_status, h, conn, session=r["session"])["session"]
    assert s["status"] in (status, "failed") and s["resumable"] and stop in [x["reason"] for x in s["stops"]] or s["status"] == "failed"
    ai.fail = None
    h.data[DOMAIN].pop(A._DATA_STARTS, None)                                        # noqa: SLF001
    assert _call(W.ws_plan_build_rooms_resume, h, conn, session=r["session"]) == {"session": r["session"]}
    _finish(h)
    s = _call(W.ws_plan_build_rooms_status, h, conn, session=r["session"])["session"]
    assert s["status"] == "done" and s["plans"][0]["read"] == [True, True] and s["proposal"]


def test_edits_go_through_the_command_with_the_rev(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, disk)
    s = _read_floor(h, conn)
    sp = [i for i, x in s["proposal"]["spaces"].items()]
    r = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"] - 1, op="merge", parts=sp)
    assert r["error"] == "rev_mismatch"
    r = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"], op="merge", parts=["room:Den", "room:Shop"])
    assert r["error"] == "two_rooms" and "experimental" in r["message"]
    r = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"], op="merge", parts=sp)
    s2 = r["session"]
    assert s2["rev"] == s["rev"] + 1 and "space:m1" in s2["proposal"]["spaces"] and s2["edits"]["merges"][0]["parts"] == sp
    r = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s2["rev"], op="space", space="space:m1", name="Den")
    assert r["error"] == "name_taken"
    gate = _call(W.ws_plan_build_rooms_check, h, conn, session=s["id"], items=["room:Den", "room:Shop"])["gate"]
    assert gate["spots"] == 3 and not gate["scored"]


# ═══ the one write and its undo ══════════════════════════════════════════════

_STAIR_FINAL = {"id": "fur_00000000", "recipe": {"kind": "stairs", "params": {"shape": "straight", "style": "closed", "rail": "none"},
                                                 "width_m": 0.8, "depth_m": 1.5, "height_m": 2.8},
                "origin": "build", "label": "Stairs (from the plan)", "floor_id": "main", "x_m": 1.9, "y_m": 2.25, "z_m": 0.0, "rotation": 0.0}


def test_accept_all_is_one_save_with_one_backup_and_one_undo_takes_it_back(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, disk)
    s = _read_floor(h, conn)
    sp = list(s["proposal"]["spaces"])
    s = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"], op="merge", parts=sp)["session"]
    s = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"], op="space", space="space:m1", name="Store room")["session"]
    prop = s["proposal"]
    doors = [i for i, o in prop["openings"].items() if o["default"]]
    stair = next(iter(prop["stairs"]))
    rooms_before, model_before = _fab_rooms(h), copy.deepcopy(h.data[DOMAIN][DATA_MODEL].data)
    items = ["room:Den", "room:Shop", "space:m1", *doors, stair]
    out = _commit(h, conn, s, items, {stair: _STAIR_FINAL})
    assert out["ok"] is True and out["backup_id"] and out["saved"] == items, out
    rooms = _fab_rooms(h)
    assert rooms["Shop"]["points_m"] == [[round(x, 3), round(y, 3)] for x, y in prop["rooms"]["Shop"]["outline_m"]]
    assert rooms["Store room"]["floor_id"] == "main" and h.data[DOMAIN][DATA_MODEL].data["room_meta"]["Store room"]["floor_id"] == "main"
    assert rooms["Garage"] == rooms_before["Garage"]                                     # his room the plans didn't show: untouched
    f = _house3d(tmp_path)
    assert len(f["openings"]) == len(doors) and len(f["pieces"]) == 1
    piece = next(iter(f["pieces"].values()))
    assert piece["label"] == "Stairs (from the plan)" and piece["plan_ai"]["batch"] == out["batch"]
    slide = next(e for e in f["openings"].values() if e.get("type") == "sliding")
    assert slide["kind"] == "door" and slide["head_m"] == 2.03 and slide["hinge"] == "left"
    backups = _backups(tmp_path)
    assert len(backups) == 1 and backups[0]["slot"] == C.ROOMS_SLOT and "experimental" in backups[0]["note"]
    assert set(backups[0]["stores"]) >= {FABRIC_STORE_KEY, MODEL_STORE_KEY}
    batch = h.data[DOMAIN][DATA_PLAN_AI].data["room_batches"][out["batch"]]
    assert "pending" not in batch and {e["item_id"] for e in batch["items"]} == set(items)
    assert next(e for e in batch["items"] if e["item_id"] == "room:Den")["before"]["source_map_id"] == "g1"
    assert out["session"]["saved"] == {i: out["batch"] for i in items} and out["undo"]["items"] == len(items)
    again = _commit(h, conn, out["session"], ["room:Den"])
    assert again["ok"] is False and again["code"] == "not_open"                           # never saved twice

    u = _call(W.ws_plan_build_rooms_undo, h, conn, session=s["id"])
    assert u["ok"] is True and u["undone"] == len(items) and u["skipped"] == []
    back = _fab_rooms(h)
    assert set(back) == set(rooms_before)                                                 # the room it made is gone, his are back
    for n in rooms_before:
        keep = ("type", "points_m", "floor_id", "source_map_id", "source_transform", "source_image", "committed_by")
        assert {k: back[n].get(k) for k in keep} == {k: rooms_before[n].get(k) for k in keep}, n    # the provenance stamp too
    assert h.data[DOMAIN][DATA_MODEL].data["room_meta"] == model_before["room_meta"]
    assert h.data[DOMAIN][DATA_MODEL].data["room_adjacency"] == model_before["room_adjacency"]
    f = _house3d(tmp_path)
    assert f["openings"] == {} and f["pieces"] == {}
    assert len(_backups(tmp_path)) == 2 and _call(W.ws_plan_build_info, h, conn).get("rooms_undo") is None
    c = _counters(h)
    assert c["plan_build_commit:done"] == 1 and c["plan_build_item:room_accepted"] == 2 and c["plan_build_item:space_accepted"] == 1
    assert c["plan_build_undo:session"] == 1 and c["plan_build_merge:together"] == 1 and c["plan_build_merge:new_room"] == 1
    assert c["plan_build_heldout:unscored"] == 1


def test_an_undo_leaves_what_changed_since_and_a_room_in_use(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, disk)
    s = _read_floor(h, conn)
    s = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"], op="space", space=next(iter(s["proposal"]["spaces"])), name="Store")["session"]
    out = _commit(h, conn, s, ["room:Den", "room:Shop", next(iter(s["proposal"]["spaces"]))])
    assert out["ok"] is True
    fab = h.data[DOMAIN][DATA_FABRIC]
    _run(fab.async_correct_room("main", "Den", {"type": "poly", "points_m": _box(1, 1, 3, 3)}))      # a hand edit since
    h.data[DOMAIN][DATA_MODEL].data["scanners"]["AA:BB"] = {"room": "Store"}                            # a scanner put in the new room
    u = _call(W.ws_plan_build_rooms_undo, h, conn, session=s["id"])
    assert u["undone"] == 1 and {x["item_id"]: x["why"] for x in u["skipped"]} == {"room:Den": "changed", next(iter(s["proposal"]["spaces"])): "in_use"}
    rooms = _fab_rooms(h)
    assert rooms["Den"]["points_m"] == _box(1, 1, 3, 3) and rooms["Shop"]["points_m"] == _SHOP and "Store" in rooms


def test_the_gate_refuses_and_nothing_is_written(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, disk, points=_points(extra_shop=12))
    s = _read_floor(h, conn)
    s = _call(W.ws_plan_build_rooms_edit, h, conn, session=s["id"], rev=s["rev"], op="pick", room="Shop", read=2)["session"]
    was = _fab_rooms(h)
    out = _commit(h, conn, s, ["room:Den", "room:Shop"])
    assert out["ok"] is False and out["code"] == "room_gate" and out["gate"]["blocked"] and "experimental" in out["message"]
    assert _fab_rooms(h) == was and _backups(tmp_path) == [] and out["session"]["stops"][-1]["reason"] == "room_gate"
    assert _counters(h)["plan_build_stop:room_gate"] == 1 and _counters(h)["plan_build_heldout:blocked"] == 1
    out = _commit(h, conn, out["session"], ["room:Den"])                                   # untick the Shop: it goes
    assert out["ok"] is True


def test_a_room_changed_since_the_read_refuses_the_save(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, disk)
    s = _read_floor(h, conn)
    _run(h.data[DOMAIN][DATA_FABRIC].async_correct_room("main", "Shop", {"type": "poly", "points_m": _box(4.2, 1, 9, 4)}))
    was = _fab_rooms(h)
    out = _commit(h, conn, s, ["room:Den", "room:Shop"])
    assert out["ok"] is False and out["code"] == "changed_since" and out["changed"] == ["room:Shop"]
    assert _fab_rooms(h) == was and out["session"]["stops"][-1]["reason"] == "rooms_changed" and _backups(tmp_path) == []
    stair = next(iter(s["proposal"]["stairs"]))
    out = _commit(h, conn, out["session"], [stair])                                         # a new stair needs the 3D view's piece
    assert out["ok"] is False and out["code"] == "invalid" and out["items"] == [stair]


def test_a_failed_backup_and_a_failed_write_change_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _house(monkeypatch, tmp_path, disk)
    s = _read_floor(h, conn)
    was, f_was = _fab_rooms(h), _house3d(tmp_path)

    async def no_backup(*a, **k):
        return None
    monkeypatch.setattr(C, "_auto_backup_rooms", no_backup)
    door = next(i for i, o in s["proposal"]["openings"].items() if o["default"])
    out = _commit(h, conn, s, ["room:Den", door])
    assert out["ok"] is False and out["code"] == "backup_failed" and _fab_rooms(h) == was and _house3d(tmp_path) == f_was
    assert out["session"]["stops"][-1]["reason"] == "backup_failed"


def test_a_failed_write_puts_back_what_was_written(monkeypatch, tmp_path, disk):  # noqa: F811
    h2, conn2, _ai2 = _house(monkeypatch, tmp_path, disk)
    s = _read_floor(h2, conn2)
    real = C._write_room                                                                   # noqa: SLF001

    async def fail_second(hass, e, side):
        if e["room"] == "Shop" and side == "after":
            return "error"
        return await real(hass, e, side)
    monkeypatch.setattr(C, "_write_room", fail_second)
    door = next(i for i, o in s["proposal"]["openings"].items() if o["default"])
    was, f_was = _fab_rooms(h2), _house3d(tmp_path)
    out = _commit(h2, conn2, s, [door, "room:Den", "room:Shop"])
    assert out["ok"] is False and out["code"] == "save_failed" and "put back" in out["message"]
    assert {n: r["points_m"] for n, r in _fab_rooms(h2).items()} == {n: r["points_m"] for n, r in was.items()}
    assert _house3d(tmp_path).get("openings", {}) == f_was.get("openings", {})
    assert not h2.data[DOMAIN][DATA_PLAN_AI].data["room_batches"] and _counters(h2)["plan_build_commit:rolled_back"] == 1


def test_a_save_cut_short_is_put_back_at_the_next_command(monkeypatch, tmp_path, disk):  # noqa: F811
    r1, r2 = _read(1, shop_px=_box(420, 100, 900, 440)), _read(2, shop_px=_box(420, 100, 900, 440))
    for r in (r1, r2):
        r["rooms"][0]["corners"] = _box(100, 100, 400, 430)          # both drawn a little short: each save changes its room
    h, conn, _ai = _house(monkeypatch, tmp_path, disk, reads={1: r1, 2: r2})
    s = _read_floor(h, conn)
    real = C._write_room                                                                   # noqa: SLF001

    async def crash(hass, e, side):                                                        # the Den lands, then Home Assistant stops
        if e["room"] == "Shop":
            raise SystemExit
        return await real(hass, e, side)
    monkeypatch.setattr(C, "_write_room", crash)
    with pytest.raises(SystemExit):
        _commit(h, conn, s, ["room:Den", "room:Shop"])
    monkeypatch.setattr(C, "_write_room", real)
    store = h.data[DOMAIN][DATA_PLAN_AI]
    assert any(b.get("pending") for b in store.data["room_batches"].values())
    _call(W.ws_plan_build_rooms_status, h, conn, session=s["id"])                          # the next command settles it
    assert _fab_rooms(h)["Den"]["points_m"] == _DEN and not store.data["room_batches"]
    assert _counters(h)["plan_build_settled:put_back"] == 1


# ═══ one code path, one writer, the words ════════════════════════════════════

def test_the_rooms_writer_reaches_only_its_own_writes():
    src = inspect.getsource(C)
    s2 = src[src.index("# ══ Build from plans: rooms, doors, windows and stairs (Stage 2"):]
    for bad in ("async_reanchor_map", "async_set_rf_barrier", "fabric_open_edges", "async_set_scanner_position", "async_set_beacon_position",
                "calibration_store", "async_update_map", "async_ensure_world_gauge", "async_set_map_floor", "async_rename", "fabric_map_transform"):
        assert bad not in s2, bad
    calls = set(re.findall(r"\b(?:fab|mdl|house)\.(async_\w+)\(", s2))
    assert calls == {"async_correct_room", "async_remove_room", "async_ensure_rooms", "async_write"}, calls
    reader = inspect.getsource(A.RoomsRunner)
    assert "self.read(" in reader and "P.ask" not in reader and "ask_ai" not in reader          # the one plan reader (Runner.read)


def test_nothing_in_the_rooms_reading_writes_the_house():
    """plan_ai.py's Stage 2 reads (the 3D file too, to match against it) and writes only its own store."""
    src = inspect.getsource(A)
    s2 = src[src.index("# ══ Build from plans: rooms, doors, windows and stairs"):]
    for forbidden in ("async_correct_room", "async_ensure_rooms", "async_remove_room", "apply_edit", ".async_write(", "async_reanchor_map",
                      "async_set_rf_barrier", "calibration_store", "async_update_map", "fab.", "mdl.store"):
        assert forbidden not in s2, forbidden
    w = inspect.getsource(W)
    callers = {p.name for p in _ROOT.glob("*.py") if re.search(r"\bC\.(rooms_commit|rooms_undo|settle_rooms)\(", p.read_text(encoding="utf-8"))}
    assert callers == {"ws_plan_ai.py"} and "async_correct_room" not in w and "apply_edit" not in w, callers


def test_every_rooms_stop_has_words_and_a_report_name():
    from custom_components.padspan_ha.telemetry import PLAN_BUILD_EVENTS
    for k in ("not_lined_up", "rooms_changed", "name_taken", "room_gate"):
        what, way = A.STOPS[k]
        assert what and way and f"plan_build_stop:{k}" in PLAN_BUILD_EVENTS
    for e in ("plan_build_run:s2_started", "plan_build_item:room_accepted", "plan_build_item:door_maybe", "plan_build_heldout:blocked",
              "plan_build_agree:apart", "plan_build_merge:separated", "plan_build_read_fail:s2_no_credit"):
        assert e in PLAN_BUILD_EVENTS, e


# ═══ the tab, run (tests/js/plan_build_rooms.mjs) ════════════════════════════

@pytest.fixture(scope="module")
def tab() -> dict:
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "plan_build_rooms.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_rooms_tab_runs(tab):
    assert len(tab) >= 35, sorted(tab)
    bad = {k: v for k, v in tab.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_the_panel_lists_the_rooms_reads_in_sample_mode():
    panel = (_ROOT / "www" / "padspan-ha" / "panel.js").read_text(encoding="utf-8")
    reads = panel[panel.index("const READS = new Set("):panel.index('.split(" ").map(t => "padspan_ha/" + t));')]
    assert "plan_build_rooms_status" in reads and "plan_build_rooms_check" in reads and "plan_build_rooms_commit" not in reads
