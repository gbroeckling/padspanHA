"""Stairs read off a floor plan by the AI Task (ws_house3d_stairs.py, 0.38.188).

The answer's boxes in pixels → metres through the plan's placement, a
staircase's size only, the arrow's way up; the gates (Settings → AI off by
default, the 3D house, Pro, an AI Task, a placed plan); stores nothing.
"""
from __future__ import annotations

import inspect
import json
from types import SimpleNamespace

from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_stairs as S
from custom_components.padspan_ha.const import DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_photo import _leftovers, _ready
from tests.test_house3d_store import _run

# A plan 10 m × 8 m, 1000 × 800 pixels, unturned: 1 px = 1 cm, (0, 0) at the corner.
_W, _H = 1000, 800


def _to_m(fx, fy):
    return (fx * 10.0, fy * 8.0)


def test_a_box_in_pixels_becomes_a_staircase_in_metres():
    ans = '```json [{"bbox_2d": [100, 200, 200, 600], "label": "stairs", "says": "UP", "up": "top", "shape": "straight"}] ```'
    [st] = S.stairs_from_answer(ans, _W, _H, _to_m)
    assert (st["x_m"], st["y_m"], st["width_m"], st["depth_m"], st["shape"]) == (1.5, 4.0, 1.0, 4.0, "straight")
    # Up toward the top of the image (−y): the front, its bottom step, faces +y (rotation 0).
    assert st["rotation"] == 0.0 and st["sure_up"] and st["says"] == "UP"
    [st2] = S.stairs_from_answer(ans.replace('"top"', '"bottom"'), _W, _H, _to_m)
    assert st2["rotation"] == 180.0


def test_dn_is_down_and_an_unread_arrow_is_unsure():
    [st] = S.stairs_from_answer([{"bbox_2d": [100, 200, 200, 600], "says": "DN", "up": "unsure"}], _W, _H, _to_m)
    assert st["says"] == "DOWN" and st["sure_up"] is False


def test_a_big_square_box_is_a_u_and_what_no_staircase_can_be_is_left_out():
    u = S.stairs_from_answer([{"bbox_2d": [100, 100, 330, 350], "shape": "straight"}], _W, _H, _to_m)
    assert u[0]["shape"] == "u"
    too_long = [{"bbox_2d": [0, 0, 100, 790]}]                 # 1 × 6.3 m
    too_big = [{"bbox_2d": [0, 0, 600, 600]}]                  # a quarter of the plan and more
    speck = [{"bbox_2d": [10, 10, 15, 15]}]
    for b in (too_long, too_big, speck):
        assert S.stairs_from_answer(b, _W, _H, _to_m) == [], b
    # A straight flight's box takes in a wall too: the flight is at most 1.3 m wide.
    wide = S.stairs_from_answer([{"bbox_2d": [100, 100, 320, 500]}], _W, _H, _to_m)
    assert wide[0]["width_m"] == 1.3 and wide[0]["depth_m"] == 4.0


def test_answers_that_are_not_boxes():
    assert S.stairs_from_answer("No stairs here, none.", _W, _H, _to_m) == []
    assert S.stairs_from_answer("[]", _W, _H, _to_m) == []
    assert S.stairs_from_answer({"stairs": []}, _W, _H, _to_m) == []
    assert S.stairs_from_answer("I cannot tell.", _W, _H, _to_m) is None
    assert S.stairs_from_answer(42, _W, _H, _to_m) is None
    # A plan that isn't placed after all: nothing, not made-up metres.
    assert S.stairs_from_answer([{"bbox_2d": [100, 200, 200, 600]}], _W, _H, lambda fx, fy: None) is None


def _read(h, conn, **kw):
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()
    msg = {"id": 7, "type": "padspan_ha/house3d_stairs_read", "map_id": "m1", **kw}
    _run(S.ws_house3d_stairs_read(h, conn, msg))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1]}
    return conn.send_result.call_args[0][1]


def _stairs_ready(monkeypatch, tmp_path, answer):
    from PIL import Image
    h, conn, ai, media = _ready(monkeypatch, tmp_path, answer=answer)
    h.data[DOMAIN][DATA_SETTINGS].data["ai_stairs_enabled"] = True
    h.data[DOMAIN][DATA_MODEL] = SimpleNamespace(map_frac_to_metres=lambda fx, fy, mid: _to_m(fx, fy) if mid == "m1" else None)
    # A 2000 × 1600 plan on disk: sent at 1024 × 819, and the boxes read in those pixels.
    plan = tmp_path / "plan.png"
    Image.new("RGB", (2000, 1600), "white").save(plan)
    maps = [{"id": "m1", "name": "Main", "floor_id": "main", "image": {"filename": "plan.png"}},
            {"id": "m2", "name": "Not placed", "floor_id": "main", "image": {"filename": "plan.png"}}]
    h.data[DOMAIN][DATA_MAPS] = SimpleNamespace(
        list_maps=lambda: maps, get_map=lambda mid: next((m for m in maps if m["id"] == mid), None),
        image_file=lambda fn, must_exist: plan if fn == "plan.png" else None)
    return h, conn, ai, media


def test_the_command_reads_one_plan_and_keeps_nothing(monkeypatch, tmp_path, disk):
    ans = json.dumps([{"bbox_2d": [102, 164, 205, 492], "says": "UP", "up": "top"}])
    h, conn, ai, media = _stairs_ready(monkeypatch, tmp_path, ans)
    out = _read(h, conn)
    assert out["ok"] and len(out["stairs"]) == 1 and abs(out["stairs"][0]["depth_m"] - 3.2) < 0.02
    (_, _, data), = ai.calls
    assert "structure" not in data and "1024 by 819 pixels" in data["instructions"]
    sent = ai.seen[0][1]
    assert sent[:3] == bytes.fromhex("ffd8ff")                 # a JPEG, made smaller here
    assert data["task_name"] == "PadSpan Live Aboard stairs"
    assert _leftovers(media) == [] and disk.writes == []


def test_the_plans_to_read_are_the_placed_ones(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _stairs_ready(monkeypatch, tmp_path, "[]")
    conn.send_result.reset_mock()
    _run(S.ws_house3d_stairs_plans(h, conn, {"id": 3, "type": "padspan_ha/house3d_stairs_plans"}))
    out = conn.send_result.call_args[0][1]
    assert out["plans"] == [{"map_id": "m1", "name": "Main", "floor_id": "main"}] and out["ai_ready"] is True and out["message"] == ""
    # Whether the AI runs here (the Furnish message says a small local model reads plans less well).
    assert out["local"] in (True, False, None)


def test_the_gates(monkeypatch, tmp_path, disk):
    h, conn, ai, media = _stairs_ready(monkeypatch, tmp_path, "[]")
    assert _read(h, conn, map_id="m2") == {"error": S.NOT_PLACED_CODE}
    assert _read(h, conn, map_id="other") == {"error": S.NOT_PLACED_CODE}
    h.data[DOMAIN][DATA_SETTINGS].data["ai_stairs_enabled"] = False
    assert _read(h, conn) == {"error": S.STAIRS_OFF_CODE}
    h.data[DOMAIN][DATA_SETTINGS].data.pop("ai_stairs_enabled")
    assert _read(h, conn) == {"error": S.STAIRS_OFF_CODE}           # off until chosen
    h.data[DOMAIN][DATA_SETTINGS].data["ai_stairs_enabled"] = True
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = ""
    assert _read(h, conn) == {"error": "no_ai_task"}
    assert ai.calls == []


def test_each_outcome_is_counted_by_name_only(monkeypatch, tmp_path, disk):
    counted = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.append(e))
    h, conn, ai, media = _stairs_ready(monkeypatch, tmp_path, json.dumps([{"bbox_2d": [100, 200, 200, 600]}]))
    _read(h, conn)
    ai.answer = "[]"
    _read(h, conn)
    ai.answer = "can't tell"
    _read(h, conn)
    ai.answer = RuntimeError("down")
    _read(h, conn)
    assert counted == ["stair_read:found", "stair_read:none", "stair_read:bad_answer", "stair_read:error"]
    src = inspect.getsource(S)
    for e in T.STAIR_EVENTS:
        assert f'"{e}"' in src and T.event_allowed(e), e
    assert S.WS_COMMANDS == (S.ws_house3d_stairs_plans, S.ws_house3d_stairs_read)
