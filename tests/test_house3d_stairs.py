"""Stairs read off a floor plan by the AI Task (ws_house3d_stairs.py, 0.38.188).

The answer's boxes in pixels → metres through the plan's placement, a
staircase's size only, the arrow's way up; the gates (Settings → AI off by
default, the 3D house, Pro, an AI Task, a placed plan); stores nothing.
"""
from __future__ import annotations

import inspect
import io
import json
import math
import statistics
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
    too_big = [{"bbox_2d": [0, 0, 680, 680]}]                  # 6.8 m each way: a room, not a turning stair
    speck = [{"bbox_2d": [10, 10, 15, 15]}]
    for b in (too_long, too_big, speck):
        assert S.stairs_from_answer(b, _W, _H, _to_m) == [], b
    # A straight flight's box takes in a wall too: the flight is at most 1.3 m wide.
    wide = S.stairs_from_answer([{"bbox_2d": [100, 100, 320, 500]}], _W, _H, _to_m)
    assert wide[0]["width_m"] == 1.3 and wide[0]["depth_m"] == 4.0


def test_a_stair_boxed_with_its_landings_is_kept_and_a_room_is_not():
    """The model boxes a U or landing stair with its landings and calls it
    straight (2026-11-02, the four real ones the old limits dropped): kept,
    at the box's centre; what no staircase can be is still left out."""
    counts = {}
    kept = S.stairs_from_answer([
        {"bbox_2d": [100, 100, 421, 627], "shape": "straight"},      # 3.21 × 5.27 m (Furnace Basement Plan)
        {"bbox_2d": [100, 100, 379, 616], "shape": "straight"},      # 2.79 × 5.16 m (Screenshot 03-14)
        {"bbox_2d": [100, 100, 387, 548], "shape": "straight"},      # 2.87 × 4.48 m (the 2-bhk plan): a U by its box
        {"bbox_2d": [100, 100, 562, 704], "shape": "straight"},      # 4.62 × 6.04 m (Electrical, the entrance stair)
        {"bbox_2d": [100, 50, 501, 764], "shape": "straight"},       # 4.01 × 7.14 m: the one junk box past the old limits ran 9 m
    ], _W, _H, _to_m, counts)
    assert [(s["shape"], s["width_m"], s["depth_m"]) for s in kept] == [
        ("straight", 1.3, 5.27), ("straight", 1.3, 5.16), ("u", 2.87, 4.48), ("u", 4.62, 6.04)]
    assert counts == {"kept": 4, "dropped": 1}


# Two of the experiment's probes (2026-11-02, planai_eval results/probe2.jsonl):
# a blank picture with 9 black squares at known places, sent at the named
# size, and the boxes qwen2.5vl:7b gave back through Ollama 0.32.5.
_PROBES = (
    ((488, 1024), [[58, 122], [244, 102], [429, 143], [48, 512], [244, 512], [439, 471], [68, 901], [244, 921], [419, 880]],
     [[65, 137, 104, 178], [302, 109, 342, 151], [540, 163, 580, 207], [580, 584, 620, 629], [540, 1113, 580, 1157],
      [302, 1164, 342, 1209], [302, 668, 342, 712], [540, 668, 580, 712], [540, 584, 580, 629], [302, 163, 342, 207],
      [540, 163, 580, 207], [540, 1113, 580, 1157], [302, 668, 342, 712], [540, 584, 580, 629]]),
    ((1024, 552), [[122, 66], [512, 55], [901, 77], [102, 276], [512, 276], [921, 253], [143, 485], [512, 496], [880, 474]],
     [[103, 65, 140, 98], [103, 317, 140, 353], [103, 569, 140, 605], [598, 578, 635, 614], [598, 317, 635, 353],
      [598, 50, 635, 86], [1034, 557, 1071, 593], [1034, 289, 1071, 326], [1034, 76, 1071, 112]]),
)


def test_boxes_come_back_in_the_frame_the_model_was_fed_not_the_named_size():
    """Read as named, the probes' marks are a tenth of the picture and more
    off; scaled by the named size over frame_of, they are on the marks. So
    the plan is sent at frame_of its size, and the named size is the frame."""
    for (w, h), marks, boxes in _PROBES:
        fw, fh = S.frame_of(w, h)
        assert fw * fh >= S.MIN_PATCHES * S.PATCH_PX ** 2 and fw % S.PATCH_PX == fh % S.PATCH_PX == 0

        def err(sx, sy):
            cs = [((b[0] + b[2]) / 2 * sx, (b[1] + b[3]) / 2 * sy) for b in boxes]
            return statistics.median(min(math.hypot(cx - mx, cy - my) for cx, cy in cs) for mx, my in marks) / max(w, h)
        assert err(1, 1) > 0.10, (w, h)
        assert err(w / fw, h / fh) < 0.015, (w, h)
        # And the boxes, as production reads an answer in that frame: the marks read as 1 m squares, on their
        # marks to within 0.5 m at the median (one box in 1024 x 552 is the model's own 1 m miss).
        counts = {}
        found = S.stairs_from_answer([{"bbox_2d": b} for b in boxes[:6]], fw, fh,
                                     lambda fx, fy: (fx * w * 0.025, fy * h * 0.025), counts)
        assert found and counts == {"kept": len(found)} and "past_edge" not in counts
        assert statistics.median(min(math.hypot(st["x_m"] - mx * 0.025, st["y_m"] - my * 0.025) for mx, my in marks)
                                 for st in found) < 0.5
    # Read as named, those same boxes run past the picture: the signal that a model answers in another frame.
    (w, h), _, boxes = _PROBES[0]
    counts = {}
    S.stairs_from_answer([{"bbox_2d": b} for b in boxes[:6]], w, h, lambda fx, fy: (fx * w * 0.025, fy * h * 0.025), counts)
    assert counts["past_edge"] == 4
    assert S.frame_of(724, 1024) == (756, 1092) and S.frame_of(1024, 1024) == (1036, 1036) and S.frame_of(1400, 1400) == (1400, 1400)


def test_a_plan_is_sent_at_the_frame_the_model_looks_at_it_in(tmp_path):
    from PIL import Image
    for size, sent in (((2000, 1600), (1036, 812)), ((560, 1175), (644, 1316)), ((1400, 1400), (1036, 1036)), ((300, 200), (1120, 756))):
        p = tmp_path / f"{size[0]}x{size[1]}.png"
        Image.new("RGB", size, "white").save(p)
        raw, w, h = S.shrink(p)
        assert (w, h) == sent == S.frame_of(*sent), size                  # the frame is its own frame: nothing left to resize
        assert Image.open(io.BytesIO(raw)).size == sent


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
    # A 2000 × 1600 plan on disk: made 1024 × 819, sent at its frame 1036 × 812, and the boxes read in those pixels.
    plan = tmp_path / "plan.png"
    Image.new("RGB", (2000, 1600), "white").save(plan)
    maps = [{"id": "m1", "name": "Main", "floor_id": "main", "image": {"filename": "plan.png"}},
            {"id": "m2", "name": "Not placed", "floor_id": "main", "image": {"filename": "plan.png"}}]
    h.data[DOMAIN][DATA_MAPS] = SimpleNamespace(
        list_maps=lambda: maps, get_map=lambda mid: next((m for m in maps if m["id"] == mid), None),
        image_file=lambda fn, must_exist: plan if fn == "plan.png" else None)
    return h, conn, ai, media


def test_the_command_reads_one_plan_and_keeps_nothing(monkeypatch, tmp_path, disk):
    ans = json.dumps([{"bbox_2d": [102, 164, 205, 489], "says": "UP", "up": "top"}])
    h, conn, ai, media = _stairs_ready(monkeypatch, tmp_path, ans)
    out = _read(h, conn)
    assert out["ok"] and len(out["stairs"]) == 1 and abs(out["stairs"][0]["depth_m"] - 3.2) < 0.02
    (_, _, data), = ai.calls
    assert "structure" not in data and "1036 by 812 pixels" in data["instructions"]
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
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    # One box kept, one a speck, one run out past the picture (a model answering in another frame).
    h, conn, ai, media = _stairs_ready(monkeypatch, tmp_path, json.dumps(
        [{"bbox_2d": [100, 200, 200, 600]}, {"bbox_2d": [10, 10, 15, 15]}, {"bbox_2d": [900, 200, 1000, 900]}]))
    _read(h, conn)
    ai.answer = "[]"
    _read(h, conn)
    ai.answer = "can't tell"
    _read(h, conn)
    ai.answer = RuntimeError("down")
    _read(h, conn)
    # How long the AI took is counted for each read it answered (0.38.193), in the photo bands.
    secs = [e for e in counted if e.startswith("stair_secs:")]
    boxes = [e for e in counted if e.startswith("stair_box:")]
    assert [e for e in counted if not e.startswith(("stair_secs:", "stair_box:"))] == ["stair_read:found", "stair_read:none", "stair_read:bad_answer", "stair_read:error"]
    assert secs == ["stair_secs:lt5"] * 3 and all(T.event_allowed(e) for e in secs)
    # How the boxes fared (2026-11-02), as many times as each happened; nothing from an empty answer.
    assert sorted(boxes) == ["stair_box:dropped", "stair_box:dropped", "stair_box:kept", "stair_box:past_edge"] and all(T.event_allowed(e) for e in boxes)
    src = inspect.getsource(S)
    for e in T.STAIR_EVENTS:
        assert (f'"{e}"' in src or e.startswith("stair_secs:")) and T.event_allowed(e), e
    assert S.WS_COMMANDS == (S.ws_house3d_stairs_plans, S.ws_house3d_stairs_read)
