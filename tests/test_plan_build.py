"""Build from plans: line up (Stage 1, experimental; plan_ai.py's line-up,
plan_geom.py, ws_plan_ai.py's plan_build_* commands; design PadspanResearch
plan-build-design-2026-11.md): the setting and the unlock rule, the
measuring on synthetic plans (no house's plans are in the repo), a whole
session against a fake Claude, every stop reason reached and counted with the
house unchanged, one way to ask the AI, and the opt-in report naming nothing.
"""
from __future__ import annotations

import inspect
import json
import math
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from custom_components.padspan_ha import ai_usage as U
from custom_components.padspan_ha import fabric_truth as FT
from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_geom as G
from custom_components.padspan_ha import settings_store as SS
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha import ws_plan_ai as W
from custom_components.padspan_ha.const import (DATA_CALIBRATION, DATA_MAPS, DATA_MODEL, DATA_PLAN_AI, DATA_SETTINGS, DOMAIN,
                                                PLAN_AI_STORE_KEY)
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_photo import _AiTask, _ready
from tests.test_house3d_store import _run

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_WWW = _ROOT / "www" / "padspan-ha"
_CLAUDE = "ai_task.claude_ai_task"


# ═══ synthetic plans ═════════════════════════════════════════════════════════
# A plan 10 m × 8 m at 100 px/m on a 1000 × 800 picture: walls, rooms, a door,
# stairs, a chain dimension across (3 + 2.5 + 2.5 m) and one down (3.5 + 2.5 m),
# each tick an extension line and a slash. The "moving" plan is the same drawing
# turned 0.4°, 1.1 times smaller and shifted: a scan of a crop.

_ANCHOR_SIZE, _MOVING_SIZE = (1000, 800), (900, 750)
_FIT = G.Fit(1.1, 1.1, math.radians(0.4), 0.0, 60.0, 40.0)        # moving px → anchor px


def _draw(path: Path) -> None:
    im = Image.new("L", _ANCHOR_SIZE, 255)
    d = ImageDraw.Draw(im)
    d.rectangle([100, 100, 900, 700], outline=0, width=6)
    for a, b in (((400, 100), (400, 450)), ((400, 450), (900, 450)), ((650, 450), (650, 700)), ((100, 300), (400, 300)), ((250, 300), (250, 700))):
        d.line([a, b], fill=0, width=4)
    d.arc([400, 380, 470, 450], 180, 270, fill=0, width=2)
    d.rectangle([150, 520, 230, 660], outline=0, width=2)
    for i in range(12):
        d.line([(150, 520 + i * 12), (230, 520 + i * 12)], fill=0, width=2)
    d.line([(90, 760), (910, 760)], fill=0, width=1)
    for x in (100, 400, 650, 900):
        d.line([(x, 705), (x, 770)], fill=0, width=1)
        d.line([(x - 5, 765), (x + 5, 755)], fill=0, width=2)
    d.line([(960, 90), (960, 710)], fill=0, width=1)
    for y in (100, 450, 700):
        d.line([(905, y), (970, y)], fill=0, width=1)
        d.line([(955, y + 5), (965, y - 5)], fill=0, width=2)
    im.convert("RGB").save(path)


def _moving(anchor: Path, path: Path) -> None:
    a, b, c, dd = _FIT.matrix()
    with Image.open(anchor) as im:
        im.convert("L").transform(_MOVING_SIZE, Image.AFFINE, (a, b, _FIT.tx, c, dd, _FIT.ty), resample=Image.BILINEAR,
                                  fillcolor=255).convert("RGB").save(path)


def _noise(path: Path) -> None:
    import random
    rnd = random.Random(7)
    im = Image.new("L", _MOVING_SIZE, 255)
    d = ImageDraw.Draw(im)
    for _ in range(60):
        x, y = rnd.randrange(900), rnd.randrange(750)
        d.ellipse([x, y, x + rnd.randrange(5, 60), y + rnd.randrange(5, 60)], outline=0, width=2)
    im.convert("RGB").save(path)


def _to_moving(x: float, y: float) -> tuple[float, float]:
    a, b, c, d = _FIT.matrix()
    det = a * d - b * c
    X, Y = x - _FIT.tx, y - _FIT.ty
    return (d * X - b * Y) / det, (-c * X + a * Y) / det


# ═══ the house ═══════════════════════════════════════════════════════════════

_T_ANCHOR = {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 10.0, "scale_y_m": 8.0, "rotation_rad": 0.0}
# The moving plan placed 8 % short going down and about a metre off: what the line-up corrects.
_T_MOVING = {"origin_x_m": 0.9, "origin_y_m": 0.2, "scale_x_m": 9.9, "scale_y_m": 7.6, "rotation_rad": 0.0}


def _truth() -> dict:
    return G.compose(_T_ANCHOR, _ANCHOR_SIZE, _MOVING_SIZE, _FIT)


class _Claude(_AiTask):
    """Claude, faked: answers read A and read B from what it was asked (the
    picture's size in the prompt), or raises `fail`. Every call is recorded."""

    def __init__(self, media, plans: dict, fail=None):
        super().__init__(media, None)
        self.plans, self.fail = plans, fail

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        self.calls.append((domain, service, data))
        f = self.fail() if callable(self.fail) else self.fail
        if isinstance(f, BaseException):
            raise f
        text = data["instructions"]
        w, h = (int(v) for v in re.search(r"(\d+) by (\d+) pixels", text).groups())
        if "floor plan image is" in text:
            return {"data": json.dumps(self.plans[(w, h)]["a"])}
        way = "x" if "running across" in text else "y"
        key = next(k for k, p in self.plans.items() if way in p.get("b", {}) and ((way == "x" and k[0] == w) or (way == "y" and k[1] == h)))
        return {"data": json.dumps(self.plans[key]["b"][way])}


def _read_a(floor: str, rooms: list[str], dims: list[dict], outline: list, stairs: list) -> dict:
    return {"title": None, "floor": floor, "rooms": [{"name": r, "box": [10, 10, 60, 40]} for r in rooms], "stairs": [{"box": s} for s in stairs],
            "outline": outline, "dimensions": dims}


def _answers(*, anchor_x="3 m + 2.5 m + 2.5 m", other_floor="upper") -> dict:
    mx0, my0 = _to_moving(100, 760)
    mx1, _ = _to_moving(900, 760)
    nx, ny0 = _to_moving(960, 100)
    _, ny1 = _to_moving(960, 700)
    corners_m = [list(_to_moving(x, y)) for x, y in ((100, 100), (900, 100), (900, 700), (100, 700))]
    s0, s1 = _to_moving(150, 520), _to_moving(230, 660)
    return {
        _ANCHOR_SIZE: {"a": _read_a("basement", ["DEN", "SHOP"], [{"text": anchor_x, "axis": "x", "box": [100, 740, 900, 770]},
                                                                   {"text": "3.5 m + 2.5 m", "axis": "y", "box": [950, 100, 975, 700]}],
                                     [[100, 100], [900, 100], [900, 700], [100, 700]], [[150, 520, 230, 660]]),
                       "b": {"x": {"text": anchor_x, "metres": G.parse_length(anchor_x), "chain": anchor_x.split(" + "), "ends": None},
                             "y": {"text": "3.5 m + 2.5 m", "metres": 6.0, "chain": ["3.5 m", "2.5 m"], "ends": None}}},
        _MOVING_SIZE: {"a": _read_a("basement", ["DEN"], [{"text": "3 m + 2.5 m + 2.5 m", "axis": "x", "box": [mx0, my0 - 20, mx1, my0 + 10]},
                                                         {"text": "3.5 m + 2.5 m", "axis": "y", "box": [nx - 10, ny0, nx + 15, ny1]}],
                                     corners_m, [[s0[0], s0[1], s1[0], s1[1]]]),
                       "b": {"x": {"text": "3 m + 2.5 m + 2.5 m", "metres": 8.0, "chain": ["3 m", "2.5 m", "2.5 m"], "ends": None},
                             "y": {"text": "3.5 m + 2.5 m", "metres": 6.0, "chain": ["3.5 m", "2.5 m"], "ends": None}}},
        (640, 480): {"a": _read_a(other_floor, ["OFFICE", "STUDIO", "ENSUITE"], [], [], [])},
    }


def _house(monkeypatch, tmp_path, *, plans=None, answers=None, fail=None, gauge="g1", sources=("Claude Opus 5.5", "claude-opus-5-5"),
           moving_noise=False, extra_maps=()):
    h, conn, _ai, media = _ready(monkeypatch, tmp_path, answer="{}", platform="anthropic")
    h.data[DOMAIN][DATA_SETTINGS].data.update(atlas_3d_ai_task_entity=_CLAUDE, ai_plans_enabled=True, ai_plan_build_enabled=True,
                                               telemetry_enabled=True)
    h.states.get = lambda eid: SimpleNamespace(state="unknown", attributes={"friendly_name": "Claude AI Task", "supported_features": 3}) \
        if eid == _CLAUDE else None
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: list(sources))
    monkeypatch.setattr(U, "model_of", lambda hass, eid: "Claude Opus 5.5")
    conn.user = SimpleNamespace(is_admin=True, name="Garry")
    pics = {"anchor.png": tmp_path / "anchor.png", "moving.png": tmp_path / "moving.png", "other.png": tmp_path / "other.png"}
    _draw(pics["anchor.png"])
    if moving_noise:
        _noise(pics["moving.png"])
    else:
        _moving(pics["anchor.png"], pics["moving.png"])
    Image.new("RGB", (640, 480), "white").save(pics["other.png"])
    maps = plans if plans is not None else [
        {"id": "a1", "name": "Shop plan", "floor_id": "basement", "image": {"filename": "anchor.png", "width": 1000, "height": 800, "sha256": "aa"},
         "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": []},
        {"id": "m1", "name": "Scan", "floor_id": "basement", "image": {"filename": "moving.png", "width": 900, "height": 750, "sha256": "mm"},
         "updated": "2026-11-09", "room_bounds": {"Den": {"points": [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5], [0.2, 0.5]]}},
         "receivers": [{"source": "AA:BB", "x": 0.4, "y": 0.4, "label": "scanner"}], "beacons": [], "lights": []},
        {"id": "r1", "name": "Upstairs", "floor_id": "basement", "image": {"filename": "other.png", "width": 640, "height": 480, "sha256": "rr"},
         "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": []},
        {"id": "g1", "name": "Measured", "floor_id": "main", "image": {"filename": "other.png", "width": 640, "height": 480, "sha256": "gg"},
         "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": []},
        *extra_maps]
    tf = {"a1": dict(_T_ANCHOR), "m1": dict(_T_MOVING), "r1": dict(_T_ANCHOR), "g1": dict(_T_ANCHOR)}
    for m in extra_maps:
        tf[m["id"]] = dict(m.get("_t") or _T_ANCHOR)
    h.data[DOMAIN][DATA_MAPS] = SimpleNamespace(list_maps=lambda: maps, get_map=lambda mid: next((m for m in maps if m["id"] == mid), None),
                                                image_file=lambda fn, must_exist=True: pics.get(fn))
    floors = [{"id": "basement", "name": "Basement"}, {"id": "main", "name": "Main"}, {"id": "upper", "name": "Upper"}]
    # Stored metres went through the wrong placement: where the person clicked on it.
    click = FT.placement_metres(_T_MOVING, 0.4, 0.4)
    h.data[DOMAIN][DATA_MODEL] = SimpleNamespace(
        map_transform=lambda mid: tf.get(mid), map_frac_to_metres=lambda fx, fy, mid: FT.placement_metres(tf[mid], fx, fy) if mid in tf else None,
        floors=lambda: list(floors), floor_base_elevations_m=lambda: {"basement": 0.0, "main": 3.0, "upper": 6.0},
        world_gauge=lambda: {"m_per_unit": 10.0, "source_map_id": gauge} if gauge else None,
        room_geometry_m=lambda: {"Den": {"floor_id": "basement", "points_m": [list(FT.placement_metres(_T_MOVING, *p)) for p in
                                                                              ((0.2, 0.2), (0.5, 0.2), (0.5, 0.5), (0.2, 0.5))]},
                                 "Office": {"floor_id": "upper", "points_m": [[0, 0], [1, 0], [1, 1]]},
                                 "Studio": {"floor_id": "upper", "points_m": [[0, 0], [1, 0], [1, 1]]}},
        scanner_positions_m=lambda: {"AA:BB": {"x_m": click[0], "y_m": click[1], "floor_id": "basement"}},
        beacon_positions_m=lambda: {}, light_positions_m=lambda: {"light.shop": {"x_m": 5.0, "y_m": 4.0, "floor_id": "basement", "label": "Shop light"}})
    h.data[DOMAIN][DATA_CALIBRATION] = SimpleNamespace(list_points=lambda: [
        {"id": "cp_1", "map_id": "m1", "x_frac": 0.3, "y_frac": 0.3, "x_m": FT.placement_metres(_T_MOVING, 0.3, 0.3)[0],
         "y_m": FT.placement_metres(_T_MOVING, 0.3, 0.3)[1], "floor_id": "basement", "room": "Den"}])
    ai = _Claude(media, answers or _answers(), fail)
    h.services.async_call = ai
    h.data[DOMAIN].pop(DATA_PLAN_AI, None)
    return h, conn, ai


def _call(fn, h, conn, **kw):
    conn.send_result.reset_mock()
    conn.send_error.reset_mock()
    _run(fn(h, conn, {"id": 5, "type": "x", **kw}))
    if conn.send_error.called:
        return {"error": conn.send_error.call_args[0][1], "message": conn.send_error.call_args[0][2]}
    return conn.send_result.call_args[0][1]


def _session(h, floor="basement", before=None):
    """A line-up made and run to its end, as plan_build_start does."""
    async def go():
        store = await A.async_get_store(h)
        snap = A.house_snapshot(h)
        sess = A.new_lineup(A.unlock(h), snap, floor, A.floor_plans(snap, floor), A.earlier_reads(store))
        store.data["lineups"]["pb_t"] = sess
        job = A.Job("pb_t")
        h.data[DOMAIN][A._DATA_JOB] = job
        runner = A.LineupRunner(h, store, job, _CLAUDE)
        if before:
            before(runner, job)
        await runner.run()
        return store, store.lineup("pb_t")
    return _run(go())


def _counters(h) -> dict:
    from custom_components.padspan_ha.telemetry import _DATA_COUNTERS
    return dict(h.data[DOMAIN].get(_DATA_COUNTERS) or {})


def _unchanged(h, disk, anchor: dict | None = None) -> None:
    """The house is as it was: only the plan store (and the AI tracker) were written."""
    from custom_components.padspan_ha.ai_usage import STORE_KEY as USAGE_KEY
    assert set(disk.writes) <= {PLAN_AI_STORE_KEY, USAGE_KEY, "padspan_ha.telemetry_counters"}, disk.writes
    assert h.data[DOMAIN][DATA_MODEL].map_transform("m1") == _T_MOVING
    assert h.data[DOMAIN][DATA_MODEL].map_transform("a1") == (anchor or _T_ANCHOR)


# ═══ the setting and the unlock rule ═════════════════════════════════════════

def test_the_setting_is_off_in_the_schema_an_administrators_and_a_bool():
    from custom_components.padspan_ha import websocket as ws
    assert SS.DEFAULT_SETTINGS["ai_plan_build_enabled"] is False
    assert "ai_plan_build_enabled" in {str(getattr(k, "schema", k)) for k in ws.ws_settings_set.ws_schema}
    src = (_ROOT / "ws_settings.py").read_text(encoding="utf-8")
    gate = src[src.index('or "ai_credit_month_usd" in msg or "ai_credit_warn_pct" in msg'):][:200]
    assert '"ai_plan_build_enabled" in msg' in gate and "Only an administrator" in src[src.index(gate):][:900]
    bools = src[src.index('for key in ("ha_entity_tracker_enabled"'):][:2000]
    assert '"ai_plan_build_enabled"' in bools
    assert T._FEATURE_ON_ONLY["ai_plan_build_enabled"] == "ai_plan_build"           # noqa: SLF001


@pytest.mark.parametrize("names,ok,why", [
    (["Claude Opus 5.5"], True, "ok"), (["claude-opus-5-5"], True, "ok"), (["claude-opus-5-5-20261201"], True, "ok"),
    (["Claude Opus 5.6"], True, "ok"), (["Claude Opus 6"], True, "ok"), (["Claude Fable 5"], True, "ok"), (["Claude Fable 5.1"], True, "ok"),
    (["Claude Fable 5.3"], True, "ok"), (["Claude Mythos 5.1"], True, "ok"), (["Claude Opus 5.5", "claude-opus-5-5"], True, "ok"),
    (["Claude Opus 5"], False, "below_opus_5_5"), (["Claude Opus 4.8"], False, "below_opus_5_5"), (["Claude Sonnet 5.5"], False, "below_opus_5_5"),
    (["Claude Haiku 5.5"], False, "below_opus_5_5"), (["Claude Sonnet 9"], False, "below_opus_5_5"),
    (["claude-opus-latest"], False, "unknown_model"), (["claude-3-5-sonnet"], False, "unknown_model"), ([""], False, "unknown_model"),
    ([], False, "unknown_model"), (["Claude Opus 5.5", "claude-haiku-5-5"], False, "sources_disagree"),
    (["Claude Opus 5.5", "claude-opus-latest"], False, "unknown_model"), (["Claude Tempo 9"], False, "unknown_model"),
])
def test_the_unlock_rule(names, ok, why):
    u = A.unlock_rule("anthropic", names)
    assert (u["ok"], u["why"]) == (ok, why)


def test_claude_through_any_other_integration_is_locked_and_an_unknown_family_fails_closed():
    assert A.unlock_rule("openai_conversation", ["Claude Opus 5.5"])["why"] == "not_anthropic"
    assert A.unlock_rule(None, ["Claude Opus 5.5"])["why"] == "not_anthropic"
    assert A.claude_model("claude-zephyr-9-0") is None                           # a family not in the pattern: no model, locked
    assert "zephyr" not in A.PLAN_BUILD_MIN


@pytest.mark.parametrize("name", ["Claude Opus 10", "claude-opus-10-1", "Claude Opus 5.5", "claude-opus-5-5-20261201", "Claude Fable 5",
                                  "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929"])
def test_the_unlock_and_the_price_read_the_model_in_one_place(name, monkeypatch):
    """Review B5: one reader of the AI Task's model (model_sources) and one
    parser of its name (claude_model), for the unlock and the AI credit
    tracker's price alike: "Claude Opus 10" is Opus 10.0 to both."""
    from tests.test_house3d_store import _house as _bare
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: [name])
    read = A.claude_model(name)
    model = U.model_of(_bare(), "ai_task.claude")
    assert model is not None and A.claude_model(model) == read
    fam, (major, minor) = read
    assert U.price_of(model) == U.PRICES.get((fam, f"{major}.{minor}" if minor else f"{major}"))
    assert U.price_of(name) == U.price_of(model)
    usage, plan = (_ROOT / "ai_usage.py").read_text(encoding="utf-8"), (_ROOT / "plan_ai.py").read_text(encoding="utf-8")
    assert "_MODEL_RE" not in usage and "re.compile" not in usage[usage.index("PRICES"):usage.index("def kind_of")]
    assert plan.count("entity_registry as er") == 1 and plan.count("device_registry as dr") == 1      # one registry reader
    assert "def _poly_in" not in plan and "_point_in_polygon" in plan                                   # ws_common's, not a copy


def test_the_shipped_files_carry_no_house_data():
    """Review B9 (public repo): no plan's file name and no credit amount in the files that ship, comments included."""
    for name in ("plan_ai.py", "plan_ai_write.py", "plan_geom.py", "ws_plan_ai.py", "ai_usage.py"):
        src = (_ROOT / name).read_text(encoding="utf-8")
        assert not re.search(r"Screenshot \d", src), name
        assert not re.search(r"\$\d", src), name


def test_the_effective_rule_needs_the_master_switch(monkeypatch, tmp_path, disk):
    h, conn, _ai = _house(monkeypatch, tmp_path)
    assert A.build_on(h)
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = False
    assert not A.build_on(h)
    out = _call(W.ws_plan_build_info, h, conn)
    assert out["on"] is False and out["floors"] == []
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = True
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: ["Claude Sonnet 5.5"])
    out = _call(W.ws_plan_build_info, h, conn)
    assert out["on"] is False and out["unlock"] == {"ok": False, "why": "below_opus_5_5", "display": "Claude Sonnet 5.5"}


def test_the_backup_ai_task_never_counts_for_the_unlock(monkeypatch, tmp_path, disk):
    h, conn, _ai = _house(monkeypatch, tmp_path)
    st = h.data[DOMAIN][DATA_SETTINGS].data
    st["atlas_3d_ai_task_backup_entity"] = _CLAUDE
    st["atlas_3d_ai_task_entity"] = "ai_task.ollama_vision"
    monkeypatch.setattr(P, "_platform", lambda hass, eid: "anthropic" if eid == _CLAUDE else "ollama")
    assert A.unlock(h)["why"] == "not_anthropic"


def test_every_command_is_an_administrators_and_refuses_when_off(monkeypatch, tmp_path, disk):
    src = (_ROOT / "ws_plan_ai.py").read_text(encoding="utf-8")
    for name in re.findall(r"async def (ws_plan_build_[a-z_]+)\(", src):
        head = src.split(f"async def {name}(", 1)[0].rsplit("@websocket_api.websocket_command", 1)[1]
        assert "@websocket_api.require_admin" in head, name
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plan_build_enabled"] = False
    for fn, kw in ((W.ws_plan_build_start, {"floor_id": "basement"}), (W.ws_plan_build_status, {}),
                   (W.ws_plan_build_verdict, {"session": "x", "rev": 1, "item_id": "i", "v": "not_now"}),
                   (W.ws_plan_build_commit, {"session": "x", "rev": 1, "items": []})):
        assert _call(fn, h, conn, **kw)["error"] == W.BUILD_OFF_CODE, fn.__name__
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plan_build_enabled"] = True
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = False
    assert _call(W.ws_plan_build_start, h, conn, floor_id="basement")["error"] == "ai_plans_off"
    assert ai.calls == []


# ═══ the measuring (plan_geom.py), on synthetic pictures ═════════════════════

@pytest.mark.parametrize("text,m", [
    ("30'-5 1/2\"", 9.2837), ("9'-1\"", 2.7686), ("8'", 2.4384), ("3 1/2\"", 0.0889), ("1'-9 3/4\"", 0.55245), ("12'-0\"", 3.6576),
    ("11'-1/4\"", 3.3591), ("9284", 9.284), ("9.284 m", 9.284), ("2 400", 2.4), ("928 cm", 9.28), ("2400 mm", 2.4),
    ("8' + 1'-9 3/4\" + 2'-10 1/2\" + 8'-9 1/2\" + 3 1/2\" + 2'-1\" + 3 1/2\" + 4'-4 1/2\" + 1'-11 1/4\"", 9.2837),
    ("3 m + 2.5 m + 2.5 m", 8.0), ("′9'-1″", None), ("hello", None), ("", None), ("12'-13\"", None)])
def test_parse_length(text, m):
    got = G.parse_length(text)
    assert (got is None) if m is None else (got is not None and abs(got - m) < 5e-4), (text, got)


def test_the_ticks_of_a_chain_give_the_true_span(tmp_path):
    p = tmp_path / "a.png"
    _draw(p)
    g = G.grey(Image.open(p))
    t = G.dimension_ticks(g, [150, 745, 820, 770], "x", chain=[3.0, 2.5, 2.5])     # a box that stops short, as Claude's do
    assert t is not None and abs(t.span - 800) <= 2 and t.matched >= 3
    t = G.dimension_ticks(g, [950, 100, 975, 700], "y", chain=[3.5, 2.5])
    assert t is not None and abs(t.span - 600) <= 2
    # A chain that isn't the one drawn there: no reading.
    assert G.dimension_ticks(g, [100, 745, 900, 770], "x", chain=[1.0, 6.0, 1.0]) is None
    # A single line's ends among the wall faces: the pair that agrees with the chains.
    t = G.dimension_ticks(g, [100, 745, 900, 770], "x", ends=[[110, 760], [880, 760]], expect_span=805)
    assert t is not None and abs(t.span - 800) <= 2


def test_tilt_and_the_fit_recover_a_known_turn_and_scale(tmp_path):
    a, m = tmp_path / "a.png", tmp_path / "m.png"
    _draw(a)
    _moving(a, m)
    ga, gm = G.grey(Image.open(a)), G.grey(Image.open(m))
    assert abs(abs(math.degrees(G.scan_tilt(gm))) - 0.4) < 0.1, math.degrees(G.scan_tilt(gm))
    start = G.search_start(gm, ga, (1.1, 1.1))
    fit = G.register(gm, ga, start, (1.1, 1.1))
    assert fit.corr >= G.ACCEPT_CORR and abs(fit.sx - 1.1) < 0.01 and abs(math.degrees(fit.rot) - 0.4) < 0.1
    for x, y in ((0, 0), (900, 0), (900, 750), (0, 750)):
        assert math.dist(fit.apply(x, y), _FIT.apply(x, y)) < 2.0
    assert G.max_move(G.compose(_T_ANCHOR, _ANCHOR_SIZE, _MOVING_SIZE, fit), _truth()) < 0.03


def test_a_fit_is_accepted_only_when_match_overlap_and_dimensions_agree():
    good = G.Fit(1.06, 1.06, 0.0, 0.0, 0.0, 0.0, corr=0.9)
    assert G.accepted(good, (1.061, 1.06), 0.9) is None
    assert G.accepted(G.Fit(1.06, 1.06, 0, 0, 0, 0, corr=0.84), (1.06, 1.06), 0.9) == "low_corr"
    assert G.accepted(good, (1.06, 1.06), 0.29) == "low_overlap"
    assert G.accepted(good, (1.10, None), 0.9) == "ratio_disagree"


def test_outline_on_ink_tells_a_wrong_frame(tmp_path):
    p = tmp_path / "a.png"
    _draw(p)
    g = G.grey(Image.open(p))
    corners = [[100, 100], [900, 100], [900, 700], [100, 700]]
    assert G.outline_on_ink(g, corners) > 0.9
    assert G.outline_on_ink(g, [[x * 0.7, y * 0.7] for x, y in corners]) < A.S1_OUTLINE_ON_INK


def test_compose_and_scale_only_keep_the_model():
    t = G.compose(_T_ANCHOR, _ANCHOR_SIZE, _MOVING_SIZE, _FIT)
    for fx, fy in ((0, 0), (1, 0), (1, 1), (0.3, 0.6)):
        x, y = _FIT.apply(fx * 900, fy * 750)
        assert math.dist(FT.placement_metres(t, fx, fy), FT.placement_metres(_T_ANCHOR, x / 1000, y / 800)) < 1e-3
    s = G.scale_only(_T_MOVING, _MOVING_SIZE, (100.0, None), (0.5, 0.5))
    assert abs(s["scale_x_m"] - 9.0) < 1e-4 and s["scale_y_m"] == _T_MOVING["scale_y_m"]
    assert math.dist(FT.placement_metres(s, 0.5, 0.5), FT.placement_metres(_T_MOVING, 0.5, 0.5)) < 1e-3


# ═══ a whole session ═════════════════════════════════════════════════════════

def test_a_floor_is_lined_up_refiled_and_flagged_and_nothing_is_written(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    store, sess = _session(h)
    assert sess["status"] == "done", (sess["status"], sess["error"], sess["stops"])
    items = sess["items"]
    place = items["place_m1"]
    assert place["state"] == "open" and place["evidence"]["anchor"] == "a1"
    assert G.max_move(place["proposal"], _truth()) < 0.05, (place["proposal"], _truth())
    # What it would shift, never moved: the calibration click, the scanner drawn on it, the room traced on it.
    kinds = {f["what"] for f in place["flags"]}
    assert {"calibration", "receiver", "room_trace"} <= kinds
    assert place["others"]["n"] == 1 and place["others"]["names"] == ["Shop light"]
    assert items["refile_r1"]["proposal"]["to_floor_id"] == "upper" and items["refile_r1"]["state"] == "open"
    assert items["anchor_a1"]["state"] == "info"                                  # its own dimensions agree: information
    assert sess["reads"] == 7 and sess["questions"] == [] and sess["stops"] == []  # 3 whole plans; 2 lines on each of the 2 not refiled
    _unchanged(h, disk)
    c = _counters(h)
    assert c["plan_build_run:s1_started"] == 1 and c["plan_build_run:s1_finished"] == 1 and c["plan_build_refile:suggested"] == 1
    assert c["plan_build_item:place_shown"] == 1 and c["plan_build_anchor:evidence"] == 1


def test_a_second_session_reuses_read_a_and_only_ask_reaches_the_ai(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_backup_entity"] = "ai_task.backup"
    seen = []
    real = P.ask

    async def spy(hass, eid, *a, **k):
        seen.append(eid)
        return await real(hass, eid, *a, **k)

    async def no_backup(*a, **k):
        raise AssertionError("the line-up never uses ask_ai (the backup)")
    monkeypatch.setattr(P, "ask", spy)
    monkeypatch.setattr(P, "ask_ai", no_backup)
    _session(h)
    first = len(ai.calls)
    store, sess = _session(h)
    assert set(seen) == {_CLAUDE} and len(ai.calls) == first and sess["reused"] == 3
    # One way to ask the AI: nothing in the line-up calls the AI Task service itself.
    for mod in (A, W):
        src = inspect.getsource(mod)
        assert "generate_data" not in src and "services.async_call" not in src
    # One plan reader (design 15, review S8): the line-up has no ask or read of its own, only Runner's, never with the backup.
    assert "ask" not in vars(A.LineupRunner) and "read" not in vars(A.LineupRunner) and A.LineupRunner.BACKUP is False
    line_up = inspect.getsource(A.LineupRunner)
    assert "P.ask" not in line_up and "ask_ai" not in line_up and "_obj_of" not in inspect.getsource(A)
    assert inspect.getsource(A).count("json.loads(answer[a:b + 1])") == 1 and not hasattr(G, "to_frac")


# ═══ every stop: reached, said, counted, and the house unchanged ═════════════

class _HaError(Exception):
    """homeassistant.exceptions.HomeAssistantError as the Anthropic integration raises it (translation_key)."""

    def __init__(self, text, key=None):
        super().__init__(text)
        self.translation_key = key


def _stops(sess) -> list[str]:
    return [s["reason"] for s in sess.get("stops") or []]


@pytest.mark.parametrize("reason,fail,status", [
    ("unreachable", lambda: ConnectionRefusedError(111, "refused"), "failed"),
    ("no_credit", lambda: RuntimeError("Your credit balance is too low to access the Anthropic API"), "no_credit"),
    ("out_of_time", lambda: TimeoutError(), "out_of_time"),
    ("refusal", lambda: _HaError("Potential policy violation detected.", key="api_refusal"), "failed"),          # review R1: HA 2026.7.4's refusal
    ("bad_answer", lambda: _HaError("Sorry, I had a problem talking to Anthropic: Overloaded"), "failed"),        # an error, never a refusal
])
def test_a_read_that_cannot_happen_stops_with_its_reason_and_keeps_what_was_read(monkeypatch, tmp_path, disk, reason, fail, status):
    h, conn, ai = _house(monkeypatch, tmp_path, fail=fail)
    store, sess = _session(h)
    assert sess["status"] == status and reason in _stops(sess)
    words = A.lineup_public(sess, "pb_t")["stops"][-1]
    assert words["say"] and words["next"]
    assert store.data["stall"][A._month()][reason] == 1                    # noqa: SLF001
    assert _counters(h)[f"plan_build_stop:{reason}"] == 1
    _unchanged(h, disk)


def test_no_media_folder_stops_the_reads(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.config.media_dirs = {}
    store, sess = _session(h)
    assert sess["status"] == "failed" and sess["error"] == "no_media" and "no_media" in _stops(sess)
    assert _counters(h)["plan_build_stop:no_media"] == 1 and ai.calls == []
    _unchanged(h, disk)


def test_cancelled_and_resumed(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    store, sess = _session(h, before=lambda runner, job: setattr(job, "cancel", True))
    assert sess["status"] == "cancelled" and "cancelled" in _stops(sess)
    assert _counters(h)["plan_build_stop:cancelled"] == 1
    _unchanged(h, disk)


def _fresh(tmp_path, name):
    """Another house, its own pictures and no plan store yet (the disk fixture keeps one storage root)."""
    (tmp_path / ".storage" / PLAN_AI_STORE_KEY).unlink(missing_ok=True)
    (tmp_path / name).mkdir()
    return tmp_path / name


def _resume(h, conn, store):
    """Resume pressed, its job run to its end (as the background task would)."""
    captured = []
    h.async_create_background_task = lambda coro, name: (captured.append(coro), SimpleNamespace(done=lambda: True))[1]
    out = _call(W.ws_plan_build_resume, h, conn, session="pb_t")
    while captured:
        _run(captured.pop())
    return out, store.lineup("pb_t")


def test_a_plan_moved_mid_read_stops_by_name_and_resume_never_loops_or_spends_starts(monkeypatch, tmp_path, disk):
    """Review S1: a plan moved in Align while the line-up read. The run says
    so, with the way on (line up again), and Resume is refused before it
    spends a start, every time."""
    h, conn, ai = _house(monkeypatch, tmp_path)

    def move(runner, job):
        h.data[DOMAIN][DATA_MODEL].map_transform("m1")["origin_x_m"] += 1.0
    store, sess = _session(h, before=move)
    assert sess["status"] == "cancelled" and sess["error"] == "plan_changed" and _stops(sess) == ["plan_changed"]
    pub = A.lineup_public(sess, "pb_t")
    assert pub["resumable"] is False and pub["stops"][-1]["next"] == "Line the floor up again."
    reads = sess["reads"]
    for _ in range(3):
        out, s = _resume(h, conn, store)
        assert out["error"] == "plan_changed" and "Line the floor up again." in out["message"] and "experimental" in out["message"]
        assert s["reads"] == reads and s["status"] == "cancelled"
    assert h.data[DOMAIN].get(A._DATA_STARTS, []) == [] and A.start_allowed(h) is None          # noqa: SLF001 — no start spent
    assert _stops(store.lineup("pb_t")) == ["plan_changed"]                                    # said once, not a fresh failure each press


def test_a_plan_moved_after_a_stop_is_found_before_resume_starts(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path, fail=lambda: TimeoutError())
    store, sess = _session(h)
    assert sess["status"] == "out_of_time" and A.lineup_public(sess, "pb_t")["resumable"] is True
    h.data[DOMAIN][DATA_MODEL].map_transform("m1")["origin_x_m"] += 1.0
    out, s = _resume(h, conn, store)
    assert out["error"] == "plan_changed" and s["status"] == "cancelled" and _stops(s)[-1] == "plan_changed"
    assert h.data[DOMAIN].get(A._DATA_STARTS, []) == [] and _counters(h)["plan_build_stop:plan_changed"] == 1   # noqa: SLF001


def test_every_failed_session_says_why_and_offers_resume(monkeypatch, tmp_path, disk):
    """Review S2: a restart mid-read, answers that can't be used, an unexpected error."""
    h, conn, ai = _house(monkeypatch, tmp_path)
    store, sess = _session(h)
    store.data["lineups"]["pb_r"] = {**sess, "status": "running", "stops": []}               # its job gone with the restart
    h.data[DOMAIN][A._DATA_JOB] = None                                                        # noqa: SLF001
    st = _call(W.ws_plan_build_status, h, conn, session="pb_r")["session"]
    assert st["status"] == "failed" and st["error"] == "restart" and st["resumable"] is True
    assert st["stops"][-1]["reason"] == "restart" and st["stops"][-1]["say"] and st["stops"][-1]["next"] == "Resume reads the rest."

    async def gibberish(domain, service, data, blocking=False, return_response=False):
        return {"data": "Here is the plan, as you asked."}
    h2, conn2, _ai = _house(monkeypatch, _fresh(tmp_path, "b"))
    h2.services.async_call = gibberish
    store2, s2 = _session(h2)
    assert s2["status"] == "failed" and s2["error"] == "bad_answer" and _stops(s2)[-1] == "bad_answer"
    assert A.lineup_public(s2, "pb_t")["resumable"] is True and _counters(h2)["plan_build_stop:bad_answer"] == 1

    h3, conn3, _ai = _house(monkeypatch, _fresh(tmp_path, "c"))

    async def broken(self, files=None):
        raise RuntimeError("a bug")
    monkeypatch.setattr(A.LineupRunner, "local", broken)
    store3, s3 = _session(h3)
    assert s3["status"] == "failed" and s3["error"] == "error" and _stops(s3)[-1] == "error"
    words = A.lineup_public(s3, "pb_t")["stops"][-1]
    assert "nothing in your house was changed" in words["say"] and words["next"]
    assert A.lineup_public(s3, "pb_t")["resumable"] is True


def test_a_resumed_session_reads_only_with_the_ai_it_started_with(monkeypatch, tmp_path, disk):
    """Review S9: the main AI Task moved to another qualifying Claude since
    the session started: Resume is refused by name (fail closed), and a run
    whose AI Task changes under it stops at the next read."""
    h, conn, ai = _house(monkeypatch, tmp_path, fail=lambda: TimeoutError())
    store, sess = _session(h)
    assert sess["status"] == "out_of_time"
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = "ai_task.claude_two"
    assert A.unlock(h)["ok"] is True
    out, s = _resume(h, conn, store)
    assert out["error"] == "ai_changed" and s["status"] == "cancelled" and _stops(s)[-1] == "ai_changed"
    assert s["reads"] == sess["reads"] and h.data[DOMAIN].get(A._DATA_STARTS, []) == []      # noqa: SLF001

    h2, conn2, _ai = _house(monkeypatch, _fresh(tmp_path, "b"))

    def switch(runner, job):
        h2.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = "ai_task.claude_two"
    store2, s2 = _session(h2, before=switch)
    assert s2["status"] == "cancelled" and s2["error"] == "ai_changed" and _stops(s2) == ["ai_changed"] and s2["reads"] == 0


def test_the_picker_shows_the_trackers_own_estimate_and_every_refusal_says_experimental(monkeypatch, tmp_path, disk):
    """Review R5: no "under a dollar a floor", the AI credit tracker's
    estimate per plan instead. Review R4: the shared refusals reach the tab
    and Settings with the line-up's prefix."""
    h, conn, ai = _house(monkeypatch, tmp_path)
    plans = {p["map_id"]: p for p in _call(W.ws_plan_build_info, h, conn)["floors"][0]["plans"]}
    price = U.price_of("Claude Opus 5.5")
    want = U.estimate_usd(price, (1000, 800), len(A.READ_A_PROMPT)) + sum(
        A.S1_DIMS_PER_AXIS * U.estimate_usd(price, (side, 200), len(A.READ_B_PROMPT)) for side in (1000, 800))
    assert plans["a1"]["est_usd"] == [round(want, 4), round(2 * want, 4)] and 0 < want < 0.2
    monkeypatch.setattr(U, "model_of", lambda hass, eid: "a model with no price")
    assert all(p["est_usd"] is None for p in _call(W.ws_plan_build_info, h, conn)["floors"][0]["plans"])
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False                 # Live Aboard off
    for fn, kw in ((W.ws_plan_build_status, {"session": "pb_t"}), (W.ws_plan_build_cancel, {"session": "pb_t"}),
                   (W.ws_plan_build_start, {"floor_id": "basement"})):
        out = _call(fn, h, conn, **kw)
        assert out["error"] and out["message"].startswith("Line up plans (experimental): "), (fn.__name__, out)
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = False                 # the master switch off: the undo says so, experimental
    out = _call(W.ws_plan_build_undo, h, conn, session="pb_t")
    assert out["error"] == "ai_plans_off" and out["message"].startswith("Line up plans (experimental): ")
    # Add data via plans keeps its own words.
    assert not _call(W.ws_plan_ai_status, h, conn)["message"].startswith("Line up plans")


def test_locked_no_scale_and_not_placed_are_refused_at_start(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path, sources=("Claude Sonnet 5.5",))
    out = _call(W.ws_plan_build_start, h, conn, floor_id="basement")
    assert out["error"] == W.LOCKED_CODE and "Opus 5.5" in out["message"] and "experimental" in out["message"]
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: ["Claude Opus 5.5"])
    out = _call(W.ws_plan_build_start, h, conn, floor_id="upper")
    assert out["error"] == "map_not_placed"
    h2, conn2, ai2 = _house(monkeypatch, tmp_path, gauge=None)
    out = _call(W.ws_plan_build_start, h2, conn2, floor_id="basement")
    assert out["error"] == "no_metre_scale" and "Measure one plan first" in out["message"]
    c = _counters(h)
    assert c["plan_build_stop:locked"] == 1 and c["plan_build_stop:not_placed"] == 1 and _counters(h2)["plan_build_stop:no_metre_scale"] == 1
    assert ai.calls == [] and ai2.calls == []
    _unchanged(h, disk)


def test_the_measured_plan_is_never_proposed_and_its_own_error_is_said(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path, gauge="a1")
    h.data[DOMAIN][DATA_MODEL].map_transform("a1")["scale_x_m"] = 10.6               # its own dimensions say 10.0 m
    ans = _answers()                                                                 # two lines across agreeing: said on two readings, not one
    ans[_ANCHOR_SIZE]["a"]["dimensions"].append({"text": "3 m + 2.5 m + 2.5 m", "axis": "x", "box": [100, 760, 900, 775]})
    h.services.async_call.plans = ans
    store, sess = _session(h)
    assert "anchor_a1" not in sess["items"] and "place_a1" not in sess["items"]
    assert "measured_plan_protected" in _stops(sess) and sess["plans"][0]["role"] == "gauge"
    assert _counters(h)["plan_build_stop:measured_plan_protected"] == 1


def test_an_anchor_three_percent_off_is_an_item_not_now_by_default(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_MODEL].map_transform("a1").update(scale_x_m=10.4, scale_y_m=8.32)   # 4 % both ways: anchor still (under 5 %), flagged
    store, sess = _session(h)
    assert sess["items"]["anchor_a1"]["state"] == "not_now" and "anchor_error" in _stops(sess)
    assert _counters(h)["plan_build_stop:anchor_error"] == 1


def test_no_anchor_and_the_fit_refused_ask_for_taps(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path, moving_noise=True)
    h.data[DOMAIN][DATA_MODEL].map_transform("a1")["scale_x_m"] = 12.0               # 20 % off: no anchor on the floor
    store, sess = _session(h)
    assert "no_anchor" in _stops(sess) and "fit_rejected" in _stops(sess) and "help_unanswered" in _stops(sess)
    assert sess["status"] == "needs_help" and [q["kind"] for q in sess["questions"]] == ["tap_corners"]
    c = _counters(h)
    assert c["plan_build_stop:no_anchor"] == 1 and c["plan_build_stop:fit_rejected"] == 1 and c["plan_build_help:taps_shown"] == 1
    _unchanged(h, disk, {**_T_ANCHOR, "scale_x_m": 12.0})


def test_help_past_its_limit_leaves_the_plan_out(monkeypatch, tmp_path, disk):
    monkeypatch.setattr(A, "S1_HELP_MAX", 0)
    h, conn, ai = _house(monkeypatch, tmp_path, moving_noise=True)
    store, sess = _session(h)
    assert "help_limit" in _stops(sess) and sess["questions"] == []
    c = _counters(h)
    assert c["plan_build_stop:help_limit"] == 1 and c["plan_build_help:gave_up"] == 1 and c["plan_build_stress:help_over"] == 1


def test_a_refile_of_a_plan_with_things_on_it_is_refused_and_says_what(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_MAPS].get_map("r1")["receivers"] = [{"source": "CC:DD", "x": 0.5, "y": 0.5}]
    store, sess = _session(h)
    it = sess["items"]["refile_r1"]
    assert it["state"] == "refused" and it["drawn"]["receivers"] == 1 and "refile_refused" in _stops(sess)
    assert _counters(h)["plan_build_refile:refused_drawn"] == 1


def _answer(h, conn, store, *, stop=False, **kw):
    """An answer sent; the re-measuring job it starts run to its end (as the
    background task would), after Stop when `stop`. (reply, session after)."""
    captured, task = [], SimpleNamespace(done=lambda: not captured)
    h.async_create_background_task = lambda coro, name: (captured.append(coro), task)[1]
    out = _call(W.ws_plan_build_answer, h, conn, session="pb_t", **kw)
    if stop:
        out["cancel"] = _call(W.ws_plan_build_cancel, h, conn, session="pb_t")
    if captured:
        assert not store.lock.locked()                                                  # the rerun holds no lock Add data via plans waits on
        _run(captured[0])
        captured.clear()
    return out, store.lineup("pb_t")


_SCAN2 = {"id": "m2", "name": "Scan copy", "floor_id": "basement", "image": {"filename": "moving.png", "width": 900, "height": 750, "sha256": "m2"},
          "updated": "2026-11-09", "room_bounds": {}, "receivers": [], "beacons": [], "lights": [], "_t": dict(_T_MOVING)}


def test_an_answer_refits_only_its_plan_within_the_pair_limit_and_stop_reaches_it(monkeypatch, tmp_path, disk):
    """Review S3: a question about Scan reruns Scan's fit only (Scan copy
    keeps its item), out of the store's lock, each coarse search inside
    G.FIT_SECS, and Stop reaches the rerun."""
    h, conn, ai = _house(monkeypatch, tmp_path, extra_maps=[_SCAN2])
    h.data[DOMAIN][DATA_MODEL].map_transform("m1")["scale_y_m"] = 6.8                 # Scan asks; Scan copy is fitted at once
    store, sess = _session(h)
    assert "place_m2" in sess["items"] and "place_m1" not in sess["items"] and {q["map_id"] for q in sess["questions"]} == {"m1"}
    m2_item = sess["items"]["place_m2"]
    fitted, deadlines, real_fit, real_search = [], [], A.LocalSteps.fit, G.search_start

    def fit(self, pl, anchor):
        fitted.append(pl["map_id"])
        return real_fit(self, pl, anchor)

    def search(*a, deadline=None, **k):
        deadlines.append(deadline - __import__("time").monotonic() if deadline else None)
        return real_search(*a, deadline=deadline, **k)
    monkeypatch.setattr(A.LocalSteps, "fit", fit)
    monkeypatch.setattr(G, "search_start", search)
    monkeypatch.setattr(G, "stairs_start", lambda *a, **k: None)                       # so the coarse search is the seed
    out, s = _answer(h, conn, store, question_id="q1", answer="yes")
    out, s = _answer(h, conn, store, question_id="q2", answer={"metres": 6.0})
    assert s["status"] == "done" and "place_m1" in s["items"] and set(fitted) == {"m1"}
    assert s["items"]["place_m2"] == m2_item                                            # kept as it was, not fitted again
    assert deadlines and all(d is not None and 0 < d <= G.FIT_SECS for d in deadlines)
    # Stop reaches the rerun: it is the house's one job while it runs.
    store.data["lineups"]["pb_t"]["questions"].append({"id": "q9", "kind": "confirm_dimension", "map_id": "m1", "name": "Scan", "state": "open", "axis": "x",
                                                       "dim": 0, "answer": None})
    out, s = _answer(h, conn, store, stop=True, question_id="q9", answer="yes")
    assert out["cancel"]["ok"] is True and s["status"] == "cancelled" and s["stops"][-1]["reason"] == "cancelled"
    assert s["items"]["place_m2"] == m2_item and "place_m1" in s["items"]                # cut short: the items stay as they were
    assert A.lineup_public(s, "pb_t")["resumable"] is True and A.running(h) is None


def test_a_big_change_of_scale_is_confirmed_and_the_answer_reruns_only_the_local_steps(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_MODEL].map_transform("m1")["scale_y_m"] = 6.8                 # 18 % off: over S1_BIG_CHANGE, so asked (design 3.5)
    store, sess = _session(h)
    assert sess["status"] == "needs_help" and "place_m1" not in sess["items"]
    assert [(q["kind"], q["axis"], q["ai"]["text"]) for q in sess["questions"]] == [("confirm_dimension", "x", "3 m + 2.5 m + 2.5 m"),
                                                                                     ("confirm_dimension", "y", "3.5 m + 2.5 m")]
    reads = len(ai.calls)
    out, s = _answer(h, conn, store, question_id="q1", answer="yes")
    assert out["session"]["status"] == "running" and s["status"] == "needs_help"
    out, s = _answer(h, conn, store, question_id="q2", answer={"metres": 6.0})
    assert s["status"] == "done" and len(ai.calls) == reads and "place_m1" in s["items"]
    assert G.max_move(s["items"]["place_m1"]["proposal"], _truth()) < 0.05
    c = _counters(h)
    assert c["plan_build_help:dimension_shown"] == 2 and c["plan_build_help:dimension_yes"] == 1 and c["plan_build_help:dimension_typed"] == 1
    assert c["plan_build_stop:help_unanswered"] >= 1 and c.get("plan_build_wait:lt1m", 0) >= 1
    assert _call(W.ws_plan_build_answer, h, conn, session="pb_t", question_id="q1", answer="yes")["error"] == "not_open"


def test_abandoned_proposals_are_counted_once_with_the_last_stop(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    store, sess = _session(h)
    sess["stops"].append({"reason": "help_unanswered", "at": sess["finished_at"]})
    assert A.sweep_abandoned(h, store, now=sess["finished_at"] + 15 * 86400) == 1
    assert A.sweep_abandoned(h, store, now=sess["finished_at"] + 16 * 86400) == 0
    assert sess["abandoned"]["last_stop"] == "help_unanswered" and "abandoned" in _stops(sess)
    assert _counters(h)["plan_build_run:s1_abandoned"] == 1


def test_every_stop_is_named_with_words_and_in_the_report_family():
    assert set(A.STOPS) == set(T.PLAN_BUILD_STOPS)
    for reason, (what, way) in A.STOPS.items():
        assert what and way and f"plan_build_stop:{reason}" in T.PLAN_BUILD_EVENTS
    assert set(A.STOPS_LATER) < set(A.STOPS)                                  # the writes' and Stage 2's, named now


def test_the_thresholds_live_in_one_block_with_their_reasons():
    src = inspect.getsource(A)
    block = src[src.index("# ── The numbers that can stop or hold it back"):src.index("STOPS: dict")]
    for name in ("S1_HELP_MAX", "S1_ANCHOR_SMALL", "S1_DIMS_AGREE", "S1_BIG_CHANGE", "S1_SINGLE_CHANGE", "S1_FLAG_M", "S1_BUDGET_S"):
        line = next(ln for ln in block.splitlines() if ln.startswith(name))
        assert "#" in line, name                                                  # each with why


# ═══ verdicts and the stub that refuses to save ══════════════════════════════

def test_verdicts_are_written_at_the_click_and_write_nothing(monkeypatch, tmp_path, disk):
    """Saving and undoing are tests/test_plan_build_write.py's."""
    h, conn, ai = _house(monkeypatch, tmp_path)
    store, sess = _session(h)
    out = _call(W.ws_plan_build_verdict, h, conn, session="pb_t", rev=sess["rev"], item_id="place_m1", v="wrong", why="wrong_scale")
    assert out["item"]["state"] == "wrong" and out["item"]["verdict"]["why"] == "wrong_scale"
    out = _call(W.ws_plan_build_verdict, h, conn, session="pb_t", rev=out["rev"], item_id="place_m1", v="back")
    assert out["item"]["state"] == "open"
    c = _counters(h)
    assert c["plan_build_item:place_wrong"] == 1 and c["plan_build_wrong_why:wrong_scale"] == 1
    _unchanged(h, disk)


def test_nothing_in_the_line_up_writes_the_house():
    src = inspect.getsource(A)
    s1 = src[src.index("# ══ Build from plans: line up"):]
    for forbidden in ("async_reanchor_map", "fabric_correct_room", "async_set_rf_barrier_m", "fabric_map_transform_set",
                      "async_ensure_world_gauge", "async_update_map", "_put_map_transform", "async_set_map_floor",
                      "async_get_store as house", "House3dStore", "calibration_store", ".async_write("):
        assert forbidden not in s1, forbidden
    w = inspect.getsource(W)
    assert "async_reanchor_map" not in w and "async_update_map" not in w and "async_set_map_floor" not in w


# ═══ the opt-in report ═══════════════════════════════════════════════════════

def test_the_family_is_closed_each_name_has_a_call_site_and_a_plain_name():
    from custom_components.padspan_ha import plan_ai_write as C
    src = inspect.getsource(A) + inspect.getsource(W) + inspect.getsource(C) + (_ROOT / "ws_settings.py").read_text(encoding="utf-8")
    for e in T.PLAN_BUILD_EVENTS:
        assert T.event_allowed(e) and len(e) <= 64, e
        fam = e.partition(":")[0]
        assert f'f"{fam}:{{' in src or f'"{e}"' in src or f"f\"{fam}:" in src, e
    assert not T.event_allowed("plan_build_stop:anything") and not T.event_allowed("plan_build_item:Basement_shown")
    ib = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    for prefix in sorted({e.partition(":")[0] for e in T.PLAN_BUILD_EVENTS}):
        assert f'"{prefix}"' in ib, prefix


def test_the_report_identifies_nothing(monkeypatch, tmp_path, disk):
    """A whole session seeded on purpose with what must never leave: a plan
    named with an address, rooms named after people, the floor, the AI Task,
    map ids, placements to four decimals and a $200 credit."""
    seeded = [
        {"id": "a1", "name": "12 Oak St, Squamish", "floor_id": "basement",
         "image": {"filename": "anchor.png", "width": 1000, "height": 800, "sha256": "aa"}, "updated": "x", "room_bounds": {},
         "receivers": [], "beacons": [], "lights": []},
        {"id": "m1", "name": "Garry's Office scan", "floor_id": "basement",
         "image": {"filename": "moving.png", "width": 900, "height": 750, "sha256": "mm"}, "updated": "x",
         "room_bounds": {"South Suite": {"points": [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5]]}}, "receivers": [], "beacons": [], "lights": []},
        {"id": "g1", "name": "Measured", "floor_id": "main", "image": {"filename": "other.png", "width": 640, "height": 480, "sha256": "gg"},
         "updated": "x", "room_bounds": {}, "receivers": [], "beacons": [], "lights": []}]
    h, conn, ai = _house(monkeypatch, tmp_path, plans=seeded)
    h.data[DOMAIN][DATA_SETTINGS].data["ai_credit_month_usd"] = 200.0
    _session(h)
    _call(W.ws_plan_build_info, h, conn)
    from tests.test_telemetry import _hass
    hh = _hass()
    from custom_components.padspan_ha.telemetry import _DATA_COUNTERS
    hh.data[DOMAIN][_DATA_COUNTERS] = _counters(h)
    payload = T.build_payload(hh)
    T.assert_shareable(payload)
    assert set(payload) <= T._TOP_KEYS                                              # noqa: SLF001
    ours = {k: v for k, v in payload["usage"].items() if k.startswith("plan_build_")}
    assert ours and set(ours) <= T.PLAN_BUILD_EVENTS and all(isinstance(v, int) and not isinstance(v, bool) for v in ours.values())
    text = json.dumps(payload)
    for s in ("Oak St", "Squamish", "Garry", "South Suite", "basement", "Basement", _CLAUDE, "claude_ai_task", "a1\"", "m1\"", "200.0", "$",
              "Opus"):
        assert s not in text, s
    assert not re.search(r"\d\.\d", json.dumps(payload["usage"]))


def test_off_means_the_report_counts_nothing(monkeypatch, tmp_path, disk):
    h, conn, ai = _house(monkeypatch, tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    _session(h)
    assert not any(k.startswith("plan_build_") for k in _counters(h))


def test_the_store_keeps_line_ups_apart_and_sweeps_one_cut_short(monkeypatch, tmp_path, disk):
    data = A.normalise({"schema": 1, "sessions": {}})
    assert data["lineups"] == {} and data["stall"] == {}
    data["lineups"] = {"pb_1": {"status": "running"}, "pb_2": {"status": "needs_help"}}
    assert A.sweep_lineups(data) == 1 and data["lineups"]["pb_1"]["error"] == "restart" and data["lineups"]["pb_2"]["status"] == "needs_help"
    assert A.sweep_restart(data) == 0                                                  # the plan AI's own sessions untouched


def test_the_panel_lists_the_two_reads_in_sample_mode():
    panel = (_WWW / "panel.js").read_text(encoding="utf-8")
    reads = panel[panel.index("const READS = new Set("):panel.index('.split(" ").map(t => "padspan_ha/" + t));')]
    assert "plan_build_info" in reads and "plan_build_status" in reads and "plan_build_start" not in reads


# ═══ the tab, run (tests/js/plan_build_tab.mjs) ══════════════════════════════

@pytest.fixture(scope="module")
def tab() -> dict:
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "plan_build_tab.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    return json.loads(r.stdout.strip().splitlines()[-1])


def test_the_line_up_tab_runs(tab):
    assert len(tab) >= 25, sorted(tab)
    bad = {k: v for k, v in tab.items() if not v["ok"]}
    assert not bad, json.dumps(bad, indent=2, ensure_ascii=False)


def test_the_settings_row_replaces_coming_soon_and_asks_the_server():
    src = (_WWW / "views" / "settings.js").read_text(encoding="utf-8")
    assert "Rooms and walls from a floor plan picture" not in src
    row = src[src.index("function _planBuildRow("):src.index("function _planAiLastRow(")]
    assert "Build from plans: advanced plan alignment (Claude, experimental)" in row and "EXPERIMENTAL" in row
    assert 'wsCall("padspan_ha/plan_build_info")' in row and "info.unlock && info.unlock.ok" in row and "info.master" in row
    assert '"ai_plan_build_enabled"' in row
    ai = src[src.index('aiSel.addEventListener("change"'):][:400]
    assert "pbRefresh" in ai                                                   # asked again when the AI Task changes
