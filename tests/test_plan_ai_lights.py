"""Add data via plans, Stage 3: lights (plan_ai.py, plan_ai_write.py; experimental;
2026-11). The fixture question decides which plans are read; 3 x 3 tiles at 20 %
overlap with the measured prompt, only lights kept; one crop check per find;
finds within 0.3 m one; the budget's order. Conflation: only light. entries; a
duplicate within 0.6 m with the symbol agreeing; a correction within 0.6 m with a
different symbol, kind only, merged into the 3D file's entry; further away it is
unmatched, no failure. The hard rule: only the 3D file, the plan store and the
safety backup are written, and no light position, ever.
"""

from __future__ import annotations

import copy
import json

import pytest

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import (CALIBRATION_STORE_KEY, DATA_MODEL, DOMAIN, FABRIC_STORE_KEY, HOUSE3D_STORE_KEY,
                                                MAPS_STORE_KEY, MODEL_STORE_KEY, SETTINGS_STORE_KEY)
from tests.test_house3d_edit import _file, disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_store import _run
from tests.test_plan_ai import _T1, _T2, _WHOLE, _call, _house
from tests.test_plan_ai_commit import _ONE_PLAN, _commit, _on_disk, _seed_file

_NO_STAIRS: list = []
_PLACED = {
    "light.hall": {"x_m": 2.0, "y_m": 3.0, "floor_id": "main", "label": "Hall ceiling"},
    "light.hall_pots": {"x_m": 7.0, "y_m": 3.0, "floor_id": "main", "label": "Pots Hall"},
    "light.upstairs": {"x_m": 2.0, "y_m": 5.0, "floor_id": "upper", "label": "Upstairs ceiling"},
    "fan.hall": {"x_m": 2.2, "y_m": 3.0, "floor_id": "main", "label": "Hall fan"},
    "binary_sensor.motion": {"x_m": 2.1, "y_m": 3.0, "floor_id": "main", "label": "Motion"},
}


class _Lights:
    """Answers each read by what it is asked; the whole read finds no stair by
    default. tile: answers by the tile's number; crop: {"present", "symbol"}."""

    def __init__(self, ai, tile, crop=None, whole=None):
        self.n = 0
        self.prompts: list[str] = []
        self.tile, self.crop = tile, crop or {"present": True, "symbol": "pot"}
        self.ai = ai
        ai.answers = {"whole": whole if whole is not None else _NO_STAIRS, "crop": self._crop, "rail": {"rail": "no"}}
        real = ai.__call__

        async def routed(domain, service, data, blocking=False, return_response=False):
            self.prompts.append(data["instructions"])
            if "Locate every door" in data["instructions"]:
                ans = self.tile(self.n) if callable(self.tile) else self.tile
                self.n += 1
                ai.calls.append((domain, service, data))
                return {"conversation_id": "c1", "data": ans}
            return await real(domain, service, data, blocking, return_response)
        self.routed = routed

    def _crop(self):
        return self.crop


def _ready(monkeypatch, tmp_path, tile=None, crop=None, *, whole=None, placed=_PLACED, house=None, fixtures=None, plans=_ONE_PLAN, platform="ollama", kinds=("stairs", "railing", "light")):
    counted: list[str] = []
    monkeypatch.setattr(T, "bump", lambda hass, e, n=1: counted.extend([e] * n))
    data = _seed_file(tmp_path, {})
    if house:
        data["lights"] = house
        from tests.test_house3d_edit import _seed
        _seed(tmp_path, data)
    h, conn, ai, media = _house(monkeypatch, tmp_path, None, plans=plans, platform=platform)
    fake = _Lights(ai, tile if tile is not None else [], crop, whole)
    h.services.async_call = fake.routed
    h.data[DOMAIN][DATA_MODEL].light_positions_m = lambda: copy.deepcopy(placed)
    fx = fixtures if fixtures is not None else {p[0]: "yes" for p in plans}

    async def session():
        store = await A.async_get_store(h)
        ai_ = P.ai_task(h, with_backup=True)
        pls = [p for p in A.plans(h) if p["map_id"] in fx]
        sid = "ps_test"
        store.data["sessions"][sid] = A.new_session(ai_, pls, list(kinds), A.frame_kind(h, ai_["ai_task"]), fx)
        await store.async_save()
        job = A.Job(sid)
        h.data[DOMAIN][A._DATA_JOB] = job
        await A.Runner(h, store, job, ai_).run()
        return store, store.session(sid), sid
    return h, conn, fake, counted, session


def _tile_frame(n):
    """Tile n's box on the 1000 x 800 test plan, and the frame it is sent at."""
    from PIL import Image
    box = A.tile_boxes(1000, 800)[n]
    im = Image.new("RGB", (box[2] - box[0], box[3] - box[1]))
    im.thumbnail((A.TILE_PX, A.TILE_PX))
    return box, A.S.frame_of(*im.size)


def _tile0(*spots):
    """Answers the first tile holding each (x_m, y_m) on the 10 x 8 m plan with a light there, and nothing else."""
    def answer(n):
        (x0, y0, x1, y1), (w, h) = _tile_frame(n)
        out = []
        for x, y in spots:
            px, py = x * 100, y * 100
            first = next(i for i, b in enumerate(A.tile_boxes(1000, 800)) if b[0] <= px <= b[2] and b[1] <= py <= b[3])
            if first == n:
                cx, cy = (px - x0) / (x1 - x0) * w, (py - y0) / (y1 - y0) * h
                out.append({"bbox_2d": [cx - 6, cy - 6, cx + 6, cy + 6], "label": "light"})
        return out
    return answer


# ── the pure rules ───────────────────────────────────────────────────────────

def test_the_tiles_are_three_by_three_overlap_a_fifth_and_cover_the_plan():
    t = A.tile_boxes(1000, 800)
    assert len(t) == 9
    assert t[0][:2] == (0, 0) and t[8][2:] == (1000, 800)
    w = t[0][2] - t[0][0]
    assert abs((t[0][2] - t[1][0]) / w - 0.2) < 0.01              # the share between neighbours
    assert t[0][2] > t[1][0] and t[3][1] < t[0][3]


def test_the_measured_prompt_asks_all_five_kinds_and_only_lights_are_kept():
    assert all(word in A.TILE_PROMPT for word in ("door", "window", "staircase", "railing", "ceiling light fixture"))
    got = A.tile_lights([{"bbox_2d": [10, 10, 20, 20], "label": "door"}, {"bbox_2d": [30, 30, 40, 40], "label": "light"}, {"bbox_2d": [50, 50, 60, 60], "label": "Ceiling Light"},
                         {"bbox_2d": [70, 70, 80, 80], "label": "stairs"}, {"bbox_2d": [90, 90, 100, 100], "label": "window"}], 500, 500)
    assert [b["bbox_2d"] for b in got] == [[30, 30, 40, 40], [50, 50, 60, 60]]


def test_a_tile_answer_cut_short_or_repeating_still_gives_its_lights_once():
    # What qwen2.5vl really does: repeats objects until num_predict ends it, the list never closed.
    cut = '```json\n[\n {"bbox_2d": [10, 20, 30, 40], "label": "light"},\n {"bbox_2d": [50, 60, 70, 80], "label": "railing"},\n' + ' {"bbox_2d": [10, 20, 30, 40], "label": "light"},\n' * 5 + ' {"bbox_2d": [10, 2'
    assert A.tile_lights(cut, 100, 100) == [{"bbox_2d": [10, 20, 30, 40]}]
    assert A.tile_lights("sorry, I can't see anything", 100, 100) is None
    assert A.tile_lights("[]", 100, 100) == []
    # A box past the tile is another frame's.
    assert A.tile_lights([{"bbox_2d": [10, 10, 900, 20], "label": "light"}], 100, 100) == []


def test_finds_within_a_third_of_a_metre_are_one_across_tiles_and_plans_and_the_symbol_survives():
    f = lambda x, y, mid="m1", s="unknown": {"map_id": mid, "plan_floor": "main", "x_m": x, "y_m": y, "symbol": s}  # noqa: E731
    got = A.merge_lights([f(1.0, 1.0), f(1.2, 1.1), f(1.0, 1.29, "m2", "pot"), f(1.0, 1.5), f(1.0, 1.0, "m3")])
    assert len(got) == 2
    assert got[0]["symbol"] == "pot" and [s["map_id"] for s in got[0]["seen_on"]] == ["m1", "m2", "m3"]
    # Another floor's light over this one isn't the same light.
    other = {**f(1.0, 1.0), "plan_floor": "upper"}
    assert len(A.merge_lights([f(1.0, 1.0), other])) == 2
    assert len(A.capped_lights([{"map_id": "m1"}] * (A.MAX_LIGHTS + 5))) == A.MAX_LIGHTS


@pytest.mark.parametrize("answer,want", [({"symbol": "POT"}, "pot"), ('{"symbol": "pendant"}', "pendant"), ('{"symbol": "<img>"}', "unknown"), ({"symbol": "chandelier"}, "unknown"), ({}, "unknown")])
def test_the_symbol_is_a_closed_word(answer, want):
    assert A.symbol_of(answer) == want


@pytest.mark.parametrize("name,stored,override,want", [
    ("light.a", None, None, None), ("light.pots_main_north", None, None, "pot"), ("light.spot_hall", None, None, "spot"),   # "spot" holds "pot"
    ("light.x", "pendant", None, "pendant"), ("light.pots", "sconce", None, "sconce"), ("light.pots", None, "hex", "fixture"), ("light.pots", None, "auto", "pot"),
])
def test_what_the_house_draws_a_light_as_follows_guess_kind(name, stored, override, want):
    assert A._drawn_kind(name, "", stored, override) == want


def test_a_light_with_an_outline_is_measured_from_it_and_a_long_one_stands_for_a_group():
    lt = {"x_m": 0.0, "y_m": 0.0, "fp": A.footprint({"width_cm": 475, "height_cm": 204, "rotation": 33.0})}
    assert lt["fp"][2] > A.GROUP_M
    assert A.light_distance(lt, 0.3, 0.3) == 0.0                                  # on it
    assert A.footprint({"width_cm": 15, "height_cm": 15}) is None
    assert A.light_distance({"x_m": 0.0, "y_m": 0.0, "fp": None}, 3.0, 4.0) == 5.0


def test_classifying_a_symbol():
    lights = [{"id": "light.a", "floor_id": "main", "x_m": 0.0, "y_m": 0.0, "fp": None, "label": "A", "kind": "pot", "group": False, "stored_kind": None},
              {"id": "light.b", "floor_id": "main", "x_m": 5.0, "y_m": 0.0, "fp": None, "label": "B", "kind": None, "group": True, "stored_kind": None},
              {"id": "light.c", "floor_id": "upper~0.5", "x_m": 9.0, "y_m": 0.0, "fp": None, "label": "C", "kind": None, "group": False, "stored_kind": None}]
    c = lambda x, sym, fid="main", seen=(): A.classify_light(fid, x, 0.0, sym, lights, set(seen))  # noqa: E731
    assert c(0.5, "pot")["relation"] == "duplicate"                               # within 0.6 m, agreeing
    assert c(0.61, "pot")["relation"] == "unmatched"                              # past it: no failure
    m = c(0.5, "pendant")
    assert m["relation"] == "correction" and m["want_kind"] == "pendant" and m["target"] == "light.a" and m["now_kind"] == "pot"
    assert c(0.5, "unknown")["relation"] == "duplicate"                           # says nothing: nothing to offer
    assert c(5.0, "pot")["relation"] == "correction" and c(5.0, "pot")["group"] is True    # no kind stored, and a known symbol: offered
    assert c(5.0, "pot", seen=[("light.b", "pot")])["relation"] == "duplicate"    # the same kind on the same light, once
    assert c(9.0, "pot", "upper")["target"] == "light.c"                          # a split level is its whole floor
    assert c(9.0, "pot", "main")["relation"] == "unmatched"                       # another floor's light isn't near


# ── the session ──────────────────────────────────────────────────────────────

def test_only_a_plan_on_yes_is_read_for_lights(monkeypatch, tmp_path, disk):  # noqa: F811
    plans = (("m1", "Main", "main", _T1), ("m2", "Elec", "main", _T1), ("m3", "Other", "main", _T1))
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, [], plans=plans, fixtures={"m1": "no", "m2": "yes", "m3": "unsure"})
    store, sess, sid = _run(session())
    assert fake.n == 9 and sess["tiles"] == 9                                     # one plan's nine tiles
    by = {p["map_id"]: p for p in sess["plans"]}
    assert "light" not in by["m1"]["kinds"] and "light" in by["m2"]["kinds"] and "light" not in by["m3"]["kinds"]
    assert [by[m]["fixtures_drawn"] for m in ("m1", "m2", "m3")] == [False, True, None]
    assert "plan_ai_tiles:1_9" in counted


def test_the_command_counts_the_answers_and_a_plan_unsaid_is_unsure(monkeypatch, tmp_path, disk):  # noqa: F811
    plans = (("m1", "Main", "main", _T1), ("m2", "Elec", "main", _T1))
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, [], plans=plans)
    h.async_create_background_task = lambda coro, name: coro.close()               # the session's record is what this asks of it
    r = _call(W.ws_plan_ai_start, h, conn, map_ids=["m1", "m2"], kinds=["stairs", "light"], fixtures={"m1": "yes"})
    sess = _run(A.async_get_store(h)).session(r["session"])
    assert "plan_ai_fixtures:yes" in counted and "plan_ai_fixtures:unsure" in counted
    assert sess["lights_asked"] is True and [("light" in p["kinds"]) for p in sess["plans"]] == [True, False]


def test_without_lights_asked_nothing_changes(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, [], fixtures={"m1": "yes"}, kinds=("stairs", "railing"))
    store, sess, sid = _run(session())
    assert fake.n == 0 and sess["lights_asked"] is False and not any(e.startswith(("plan_ai_tiles", "plan_ai_fixtures")) for e in counted)


def test_stairs_and_railings_are_read_before_any_tile_and_the_tiles_before_the_light_checks(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0)), whole=_WHOLE)
    _run(session())
    what = ["tile" if "Locate every door" in p else "light_crop" if "ceiling light fixture" in p else "rail" if "handrail" in p else "crop" if "crop of a floor plan" in p else "whole" for p in fake.prompts]
    assert what[0] == "whole" and what.index("crop") < what.index("rail") < what.index("tile") < what.index("light_crop")
    assert what.count("tile") == 9 and what.count("light_crop") == 1


def test_one_check_per_find_merges_first_says_the_symbol_and_can_drop_it(monkeypatch, tmp_path, disk):  # noqa: F811
    # Two boxes 20 cm apart, one fixture: one check. It says no: gone, and counted.
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((3.0, 4.0), (3.2, 4.0)), {"present": False})
    store, sess, sid = _run(session())
    assert sum("ceiling light fixture" in p and "crop of" in p for p in fake.prompts) == 1
    assert not sess["suggestions"] and sess["light_dropped"] == 1 and "plan_ai_crop:light_dropped" in counted
    assert "light_finds" not in sess and "finds" not in sess


def test_a_slow_first_read_skips_the_tiles_and_says_so(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((3.0, 4.0)))
    real = A.Runner.read_lights

    async def slow(self):
        assert self.first_read_s is not None                                      # the first answer's time was taken
        self.first_read_s = A.TILE_SLOW_S + 1
        await real(self)
    monkeypatch.setattr(A.Runner, "read_lights", slow)
    store, sess, sid = _run(session())
    assert fake.n == 0 and sess["tiles_skipped"] == "slow" and "plan_ai_tiles_slow" in counted and "plan_ai_tiles:none" in counted


def test_the_budget_running_out_in_the_tiles_keeps_what_was_read(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((1.0, 1.0)))
    real = A.Runner.left

    def budget(self):
        return 1.0 if self.phase in ("tiles", "light_crop") and self.sess.get("tiles", 0) >= 3 else real(self)
    monkeypatch.setattr(A.Runner, "left", budget)
    store, sess, sid = _run(session())
    assert fake.n == 3 and sess["status"] == "out_of_time" and sess["cut_short"] == "tiles" and "plan_ai_budget_cut:tiles" in counted
    # Its find stayed as the tile read it (the check was cut too), and was matched.
    assert len(sess["suggestions"]) == 1 and next(iter(sess["suggestions"].values()))["reads"] == ["tile"]


def test_a_mark_with_no_symbol_read_near_a_placed_light_isnt_counted_as_already_there(monkeypatch, tmp_path, disk):  # noqa: F811
    # The review of 2026-11-02, S7: the time ran out before the closer look, at the pots. It keeps its state
    # (nothing to offer, it can't disagree) and the view says it wasn't read; no counter says it was already there.
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((7.0, 3.0)))
    real = A.Runner.left

    def budget(self):
        return 1.0 if self.phase in ("tiles", "light_crop") and self.sess.get("tiles", 0) >= 3 else real(self)
    monkeypatch.setattr(A.Runner, "left", budget)
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    assert sug["state"] == "duplicate" and sug["geom"]["symbol"] == "unknown" and sug["reads"] == ["tile"]
    assert "plan_ai_duplicate:light" not in counted


def test_the_conflation_only_light_entries_correction_duplicate_unmatched(monkeypatch, tmp_path, disk):  # noqa: F811
    # At the hall ceiling (a fan and a sensor share the spot); at the pots; nowhere near anything.
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0), (7.0, 3.0), (3.0, 1.0)))
    store, sess, sid = _run(session())
    got = {(s["geom"]["x_m"] > 6, s["geom"]["x_m"] < 2.5): s for s in sess["suggestions"].values()}
    pots, hall = got[(True, False)], got[(False, True)]
    far = next(s for s in sess["suggestions"].values() if s not in (pots, hall))
    assert hall["match"]["target"] == "light.hall" and hall["match"]["relation"] == "correction" and hall["match"]["want_kind"] == "pot" and hall["state"] == "queued"
    assert pots["match"]["target"] == "light.hall_pots" and pots["state"] == "duplicate"
    assert far["state"] == "unmatched" and far["match"]["target"] is None
    assert counted.count("plan_ai_light_unmatched") == 1 and counted.count("plan_ai_suggested:light") == 1 and counted.count("plan_ai_duplicate:light") == 1
    assert not any(e.startswith("plan_ai_verdict:") or e.startswith("plan_ai_failure_why:") for e in counted)        # unmatched is no failure
    assert all(s["kind"] == "light" and "fan." not in str(s["match"].get("target")) for s in sess["suggestions"].values())


def test_an_unmatched_symbol_takes_no_verdict_and_counts_against_nothing(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((3.0, 1.0)))
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    assert _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=sug["id"], v="failure")["error"] == "not_open"
    assert A.track_record(store) == {}


def test_a_coarse_frame_offers_no_kind(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0)), platform="openai_conversation")
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    assert sess["frame"] == "named" and sug["state"] == "unmatched" and sug["match"]["held"] == "frame" and sug["match"]["target"] is None and "want_kind" not in sug["match"]
    assert "plan_ai_held:frame" in counted


def test_a_room_group_says_so(monkeypatch, tmp_path, disk):  # noqa: F811
    placed = {"light.main": {"x_m": 3.0, "y_m": 4.0, "floor_id": "main", "label": "Main group", "width_cm": 475, "height_cm": 204, "rotation": 33.0},
              "light.strip": {"x_m": 7.0, "y_m": 2.0, "floor_id": "main", "label": "Valance", "width_cm": 430, "height_cm": 20, "rotation": 0.0}}
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((4.0, 4.0), (7.2, 2.0)), placed=placed)
    store, sess, sid = _run(session())
    m = {s["match"]["target"]: s["match"] for s in sess["suggestions"].values()}
    assert m["light.main"]["group"] is True and m["light.main"]["distance_m"] == 0.0           # inside its outline
    assert m["light.strip"]["group"] is False                                                   # a long strip isn't a room's lights


def test_a_placed_by_eye_plan_says_so_and_still_offers_the_kind(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0)), plans=(("m1", "Main", "main", _T2),))
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    assert sug["match"]["held"] == "eye" and sug["match"]["relation"] == "correction" and "plan_ai_held:eye" in counted


def test_a_failure_is_remembered_and_the_next_read_doesnt_queue_it(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0)))
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    r = _call(W.ws_plan_ai_verdict, h, conn, session=sid, rev=sess["rev"], sug_id=sug["id"], v="failure", why="wrong_kind")
    assert r["suggestion"]["state"] == "failure" and "plan_ai_verdict:light_failure" in counted and "plan_ai_failure_why:light_wrong_kind" in counted
    assert A.track_record(store)["light"] == {"right": 0, "of": 1}
    fake.n = 0
    store2, sess2, _ = _run(session())
    again = next(iter(sess2["suggestions"].values()))
    assert again["state"] == "failure" and again["verdict"]["remembered"] is True


# ── the commit: kind only ────────────────────────────────────────────────────

def _corrected(monkeypatch, tmp_path, **kw):
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0)), **kw)
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    assert sug["match"]["relation"] == "correction"
    return h, conn, store, sess, sid, sug, counted


def _others(tmp_path) -> dict[str, bytes]:
    """The stores this feature must never write, each with bytes of its own to compare (seeded on first look)."""
    out = {}
    for key in (FABRIC_STORE_KEY, MODEL_STORE_KEY, MAPS_STORE_KEY, SETTINGS_STORE_KEY, CALIBRATION_STORE_KEY):
        p = _file(tmp_path, key)
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({"version": 1, "data": {"seed": key}}), encoding="utf-8")
        out[key] = p.read_bytes()
    return out


def test_a_kind_merges_into_the_whole_entry_and_nothing_else_is_written(monkeypatch, tmp_path, disk):  # noqa: F811
    run = {"pts": [[0, 0, 2], [1, 0, 2]], "face": "down", "loop": False}
    h, conn, store, sess, sid, sug, counted = _corrected(monkeypatch, tmp_path, house={"light.hall": {"z_m": 2.1, "kind": "fixture", "run": run}})
    assert sug["match"]["now_kind"] == "fixture"
    placed = copy.deepcopy(_PLACED)
    others = _others(tmp_path)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert r.get("ok") is True and r["piece_ids"][sug["id"]] == "light.hall", r
    entry = _on_disk(tmp_path)["lights"]["light.hall"]
    assert entry["kind"] == "pot" and entry["z_m"] == 2.1 and entry["run"]["pts"] == run["pts"]     # a key left out goes: none was
    assert set(_on_disk(tmp_path)["lights"]) == {"light.hall"} and h.data[DOMAIN][DATA_MODEL].light_positions_m() == placed
    assert _others(tmp_path) == others and "plan_ai_verdict:light_correction" in counted
    assert sug["state"] == "committed_correction" and sug["verdict"]["final"] == {"kind": "pot"}
    assert A.track_record(store)["light"] == {"right": 1, "of": 1}


def test_a_light_with_no_entry_gets_one_and_undo_takes_it_away(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, store, sess, sid, sug, counted = _corrected(monkeypatch, tmp_path)
    others = _others(tmp_path)
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert _on_disk(tmp_path)["lights"] == {"light.hall": {"kind": "pot"}}
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert u["ok"] is True and u["undone"] == 1 and _on_disk(tmp_path)["lights"] == {} and _others(tmp_path) == others
    assert "plan_ai_undo:light" in counted and sug["state"] == "undone"


def test_undo_restores_the_entry_exactly_and_leaves_one_changed_since(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, store, sess, sid, sug, counted = _corrected(monkeypatch, tmp_path, house={"light.hall": {"z_m": 2.1, "kind": "fixture"}})
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    u = _call(W.ws_plan_ai_undo, h, conn, batch_id=r["batch"])
    assert _on_disk(tmp_path)["lights"]["light.hall"] == {"z_m": 2.1, "kind": "fixture"}
    p = _call(W.ws_plan_ai_undo, h, conn, batch_id=u["batch"])                                    # put back
    assert _on_disk(tmp_path)["lights"]["light.hall"]["kind"] == "pot"
    from custom_components.padspan_ha import house3d_store as H
    house = _run(H.async_get_store(h))
    _run(house.async_write(H.apply_edit(house.data, {"lights": {"light.hall": {"z_m": 1.0, "kind": "pot"}}})))
    left = _call(W.ws_plan_ai_undo, h, conn, batch_id=p["batch"])
    assert left["undone"] == 0 and left["skipped"][0]["why"] == "changed" and _on_disk(tmp_path)["lights"]["light.hall"]["z_m"] == 1.0


@pytest.mark.parametrize("item,code", [({"v": "new"}, "invalid"), ({"v": "new", "final": {"x_m": 1, "y_m": 1, "floor_id": "main", "recipe": {"kind": "stairs"}}}, "invalid")])
def test_a_light_is_never_new_so_no_position_can_be_written(monkeypatch, tmp_path, disk, item, code):  # noqa: F811
    h, conn, store, sess, sid, sug, counted = _corrected(monkeypatch, tmp_path)
    raw = _file(tmp_path, HOUSE3D_STORE_KEY).read_bytes()
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], **item})["error"] == code
    assert _file(tmp_path, HOUSE3D_STORE_KEY).read_bytes() == raw and not store.data["batches"]


def test_an_unmatched_symbol_can_never_be_kept(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((3.0, 1.0)))
    store, sess, sid = _run(session())
    sug = next(iter(sess["suggestions"].values()))
    assert _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})["ok"] is False
    assert not store.data["batches"]


def test_a_light_moved_since_is_stale_and_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, store, sess, sid, sug, counted = _corrected(monkeypatch, tmp_path)
    moved = copy.deepcopy(_PLACED)
    moved["light.hall"]["x_m"] = 2.3
    h.data[DOMAIN][DATA_MODEL].light_positions_m = lambda: moved
    raw = _file(tmp_path, HOUSE3D_STORE_KEY).read_bytes()
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": sug["id"], "v": "correction"})
    assert r["ok"] is False and r["code"] == "changed_since" and sug["state"] == "stale"
    assert _file(tmp_path, HOUSE3D_STORE_KEY).read_bytes() == raw


def test_the_status_check_marks_a_light_given_a_kind_by_hand_stale_and_a_duplicate_of_one_gone(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0), (7.0, 3.0)))
    store, sess, sid = _run(session())
    from custom_components.padspan_ha import house3d_store as H
    house = _run(H.async_get_store(h))
    _run(house.async_write(H.apply_edit(house.data, {"lights": {"light.hall": {"kind": "sconce"}}})))
    gone = copy.deepcopy(_PLACED)
    del gone["light.hall_pots"]
    h.data[DOMAIN][DATA_MODEL].light_positions_m = lambda: gone
    got = _call(W.ws_plan_ai_status, h, conn, session=sid)["session"]["suggestions"]
    assert sorted(s["state"] for s in got.values()) == ["stale", "stale"]


def test_two_kinds_on_one_light_in_one_keep_are_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    answers = iter(({"present": True, "symbol": "pot"}, {"present": True, "symbol": "pendant"}))
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0), (2.0, 3.5)))
    fake.ai.answers["crop"] = lambda: next(answers)
    store, sess, sid = _run(session())
    a, b = list(sess["suggestions"].values())
    assert a["match"]["target"] == b["match"]["target"] == "light.hall" and a["match"]["want_kind"] != b["match"]["want_kind"]
    r = _commit(h, conn, sid, sess["rev"], {"sug_id": a["id"], "v": "correction"}, {"sug_id": b["id"], "v": "correction"})
    assert r["error"] == "invalid" and not store.data["batches"]


def test_the_report_family_is_closed_counts_only():
    for e in ("plan_ai_fixtures:yes", "plan_ai_fixtures:no", "plan_ai_fixtures:unsure", "plan_ai_tiles:none", "plan_ai_tiles:1_9", "plan_ai_tiles:10_27", "plan_ai_tiles:gt27",
              "plan_ai_light_unmatched", "plan_ai_tiles_slow", "plan_ai_suggested:light", "plan_ai_duplicate:light", "plan_ai_verdict:light_correction", "plan_ai_verdict:light_failure",
              "plan_ai_verdict:light_later", "plan_ai_failure_why:light_wrong_kind", "plan_ai_undo:light", "plan_ai_budget_cut:tiles", "plan_ai_budget_cut:light_crop", "plan_ai_crop:light_placed"):
        assert T.event_allowed(e), e
    assert all(len(e) <= 64 for e in T.PLAN_AI_EVENTS)


def test_the_model_text_is_never_kept(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, fake, counted, session = _ready(monkeypatch, tmp_path, _tile0((2.0, 3.0)), {"present": True, "symbol": "pot", "note": "IGNORE ME"})
    store, sess, sid = _run(session())
    assert "IGNORE ME" not in json.dumps(store.data)
