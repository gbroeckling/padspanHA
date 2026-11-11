"""Let Claude draw your rooms, piece 4: Claude reads a printed dimension off a
plan with no scale, and the person confirms it.

plan_ai.py's ScaleRunner, measure_axes and scale_proposal, ws_plan_ai.py's
plan_build_scale_start / _status, and the save through piece 3's
plan_ai_write.scale_save, unchanged (design PadspanResearch
ai-wizard-design-2026-11-10.md, B screen 3, E.1-E.2, H.1, J.4). The plans are
drawn here with Pillow (metric, feet and inches with a chain, stretched one
way, no dimensions, turned 1 degree); Claude is faked; the house is
test_plan_build_scale.py's, in the real stores on disk. No house's plans or
data are in the repo.
"""
from __future__ import annotations

import copy
import json
import math
import time
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import plan_geom as G
from custom_components.padspan_ha import ws_fabric as F
from custom_components.padspan_ha import ws_plan_ai as WP
from custom_components.padspan_ha.const import DOMAIN
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_photo import _AiTask
from tests.test_house3d_store import _run
from tests.test_plan_build import _HaError, _call, _counters
from tests.test_plan_build_scale import _N1, _setup, _store

_FT_X = ["10'-2\"", "10'-1\"", "10'-2 1/2\""]          # a chain: 30'-5 1/2" across
_X0, _Y0 = 120, 100                                     # the building's top left corner on the picture


class _Claude(_AiTask):
    """Claude, faked: Read A's answer for a whole plan, Read B's for the line
    running across (x) or down (y), or `fail` raised. Every call recorded."""

    def __init__(self, media, a: dict, b: dict, fail=None):
        super().__init__(media, None)
        self.a, self.b, self.fail = a, b, fail

    async def __call__(self, domain, service, data, blocking=False, return_response=False):
        self.calls.append((domain, service, data))
        if self.fail is not None:
            raise self.fail
        text = data["instructions"]
        if "floor plan image is" in text:
            return {"data": json.dumps(self.a)}
        return {"data": json.dumps(self.b["x" if "running across" in text else "y"])}


def _turn(p, size, deg):
    """A point of the drawing where it is once the picture is turned `deg` (PIL's rotate: counter-clockwise)."""
    cx, cy, t = size[0] / 2, size[1] / 2, math.radians(deg)
    dx, dy = p[0] - cx, p[1] - cy
    return [cx + dx * math.cos(t) + dy * math.sin(t), cy - dx * math.sin(t) + dy * math.cos(t)]


def _draw(path, size, *, ppm=(100.0, 100.0), x=None, y=None, deg=0.0) -> dict:
    """A plan at `ppm` pixels a metre across and down: its outer walls, a wall
    inside, a dimension line below it with a tick at each end of each segment
    of `x` (metres), one to its right for `y`; turned `deg`. Read A's answer as
    Claude would give it about this picture (its outline and the lines' boxes)."""
    im = Image.new("L", size, 255)
    d = ImageDraw.Draw(im)
    lx, ly = sum(x) if x else 9.0, sum(y) if y else 7.0
    x1, y1 = _X0 + lx * ppm[0], _Y0 + ly * ppm[1]
    d.rectangle([_X0, _Y0, x1, y1], outline=0, width=6)
    d.line([(_X0 + 0.4 * (x1 - _X0), _Y0), (_X0 + 0.4 * (x1 - _X0), y1)], fill=0, width=4)
    lines = {}
    if x:
        at, row = float(_X0), y1 + 60
        d.line([(_X0 - 10, row), (x1 + 10, row)], fill=0, width=1)
        for v in [0.0, *x]:
            at += v * ppm[0]
            d.line([(at, y1 + 8), (at, row + 10)], fill=0, width=1)
            d.line([(at - 5, row + 5), (at + 5, row - 5)], fill=0, width=2)
        lines["x"] = [(_X0 - 10, row), (x1 + 10, row)]
    if y:
        at, col = float(_Y0), x1 + 60
        d.line([(col, _Y0 - 10), (col, y1 + 10)], fill=0, width=1)
        for v in [0.0, *y]:
            at += v * ppm[1]
            d.line([(x1 + 8, at), (col + 10, at)], fill=0, width=1)
            d.line([(col - 5, at + 5), (col + 5, at - 5)], fill=0, width=2)
        lines["y"] = [(col, _Y0 - 10), (col, y1 + 10)]
    if deg:
        im = im.rotate(deg, resample=Image.BICUBIC, center=(size[0] / 2, size[1] / 2), fillcolor=255)
    im.convert("RGB").save(path)
    dims = []
    for axis, (p, q) in lines.items():
        a, b = _turn(p, size, deg), _turn(q, size, deg)
        dims.append({"axis": axis, "text": "?", "box": [round(min(a[0], b[0]) - 15), round(min(a[1], b[1]) - 15),
                                                       round(max(a[0], b[0]) + 15), round(max(a[1], b[1]) + 15)]})
    outline = [[round(v, 1) for v in _turn(c, size, deg)] for c in ((_X0, _Y0), (x1, _Y0), (x1, y1), (_X0, y1))]
    return {"title": None, "floor": "main", "rooms": [], "stairs": [], "outline": outline, "dimensions": dims}


def _b(text: str, chain: list[str] | None = None) -> dict:
    return {"text": text, "metres": G.parse_length(" + ".join(chain) if chain else text), "chain": chain or [], "ends": None}


# The cases: the picture's size, how it is drawn, what Claude reads, the true pixels a metre (across, down).
_FEET = {"size": (1250, 1000), "x": [G.parse_length(t) for t in _FT_X], "y": [G.parse_length("24'-0\"")],
         "b": {"x": _b(" + ".join(_FT_X), _FT_X), "y": _b("24'-0\"")}, "ppm": (100.0, 100.0)}
_CASES = {
    "metric": {"size": (1100, 900), "x": [10.0], "y": [8.0], "b": {"x": _b("10.00 m"), "y": _b("8.00 m")}, "ppm": (80.0, 80.0)},
    "feet_chain": _FEET,
    "stretched": {"size": (1250, 1000), "x": [3.0, 2.5, 3.5], "y": [2.5, 2.0, 2.5], "ppm": (100.0, 106.0),
                  "b": {"x": _b("3 m + 2.5 m + 3.5 m", ["3 m", "2.5 m", "3.5 m"]), "y": _b("2.5 m + 2 m + 2.5 m", ["2.5 m", "2 m", "2.5 m"])}},
    "tilted": {**_FEET, "deg": 1.0},
    "none": {"size": (1100, 900), "x": None, "y": None, "b": {}, "ppm": (100.0, 100.0)},
}


def _house(monkeypatch, tmp_path, disk, case="feet_chain", fail=None):  # noqa: F811
    """test_plan_build_scale's house with its unmeasured plan n1 drawn as `case`; Claude faked; started jobs kept to run."""
    c = _CASES[case]
    plan = {**_N1, "image": {"filename": "scale.png", "width": c["size"][0], "height": c["size"][1], "sha256": "ss"}}
    h, conn, mdl, ms, cal = _setup(monkeypatch, tmp_path, disk, plan=plan)
    path = tmp_path / "scale.png"
    a = _draw(path, c["size"], ppm=c["ppm"], x=c["x"], y=c["y"], deg=c.get("deg", 0.0))
    if not c["x"]:
        a["dimensions"] = []
    for dim in a["dimensions"]:
        dim["text"] = c["b"][dim["axis"]]["text"]
    old = ms.image_file
    ms.image_file = lambda fn, must_exist=True: path if fn == "scale.png" else old(fn, must_exist)
    h.services.async_call = _Claude(h.services.async_call.media, a, c["b"], fail)
    h.jobs = []
    h.async_create_background_task = lambda coro, name: (h.jobs.append(coro), SimpleNamespace(done=lambda: True))[1]
    return h, conn, mdl, ms, cal


def _read(h, conn) -> dict:
    """plan_build_scale_start, its job run to its end, then the status."""
    r = _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1", via="wizard")
    assert "session" in r, r
    while h.jobs:
        _run(h.jobs.pop(0))
    return _call(WP.ws_plan_build_scale_status, h, conn, session=r["session"], via="wizard")["session"]


def _measures(prop: dict, *, text: str | None = None) -> list[dict]:
    """What the confirmation screen sends: each axis read, its two tick ends and its length text (or the person's number for the first)."""
    out = []
    for k in (prop["main"], prop["other"]) if text is None else (prop["main"],):
        if k:
            ax = prop["axes"][k]
            out.append({"p1": ax["ends_frac"][0], "p2": ax["ends_frac"][1], "text": ax["save_text"] if text is None else text})
    return out


# ═══ what the read finds ══════════════════════════════════════════════════════

@pytest.mark.parametrize("case", ["metric", "feet_chain", "stretched", "tilted"])
def test_a_printed_dimension_gives_the_plans_pixels_per_metre_within_half_a_percent(monkeypatch, tmp_path, disk, case):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk, case)
    sess = _read(h, conn)
    prop, truth = sess["proposal"], _CASES[case]["ppm"]
    assert sess["status"] == "done" and sess["reads"] == 3 and not prop["none_found"], sess
    for k, want in zip(("x", "y"), truth):
        ax = prop["axes"][k]
        assert ax["ppm"] == pytest.approx(want, rel=0.005), (case, k, ax)
        assert len(ax["ends_frac"]) == 2 and ax["box_frac"] and ax["save_text"]
    assert prop["ppm"] == pytest.approx(sum(truth) / 2, rel=0.005)
    assert prop["across_m"] == pytest.approx(_CASES[case]["size"][0] / prop["ppm"], abs=0.01)
    c = _counters(h)
    assert c["plan_build_run:s0_started"] == 1 and c["plan_build_run:s0_finished"] == 1 and c["plan_build_read:s0_plan"] == 1
    assert c["plan_build_read:s0_dimension"] == 2 and c["plan_build_scale_axes:two"] == 1
    assert mdl.map_transform("n1") is None                                         # a read writes nothing


def test_the_states_main_axis_and_words_of_each_case(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk, "feet_chain")
    prop = _read(h, conn)["proposal"]
    # The chain across is checked by its own ticks; the single line down is as read, until the person's Yes.
    assert prop["main"] == "x" and prop["other"] == "y"
    assert prop["axes"]["x"]["state"] == "single" and prop["axes"]["y"]["state"] == "unconfirmed"
    assert prop["axes"]["x"]["text"] == " + ".join(_FT_X) and prop["axes"]["x"]["metres"] == pytest.approx(9.2837, abs=1e-3)
    assert prop["axes"]["y"]["save_text"] == "24'-0\"" and prop["stretched"] is False and prop["stretch_pct"] < 1
    c = _counters(h)
    assert c["plan_build_scale:printed"] == 1 and c["plan_build_scale_stretch:lt1"] == 1 and "plan_build_scale:unconfirmed_shown" not in c


def test_two_single_lines_are_shown_for_the_person_to_confirm(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk, "metric")
    prop = _read(h, conn)["proposal"]
    assert {prop["axes"][k]["state"] for k in "xy"} == {"unconfirmed"} and prop["main"] == "x"      # the longer one first
    assert _counters(h)["plan_build_scale:unconfirmed_shown"] == 1


def test_a_picture_stretched_one_way_is_said_not_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk, "stretched")
    prop = _read(h, conn)["proposal"]
    assert prop["stretched"] is True and prop["stretch_pct"] == pytest.approx(6 / 103 * 100, abs=0.5)
    assert {prop["axes"][k]["state"] for k in "xy"} == {"single"}
    assert _counters(h)["plan_build_scale_stretch:3_10"] == 1


def test_no_printed_dimension_is_none_found_after_one_read(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk, "none")
    sess = _read(h, conn)
    assert sess["status"] == "done" and sess["reads"] == 1 and sess["proposal"]["none_found"] is True and sess["proposal"]["main"] is None
    c = _counters(h)
    assert c["plan_build_scale:none_found"] == 1 and c["plan_build_scale_axes:none"] == 1


def test_scale_proposal_is_pure_and_takes_no_unread_axis():
    pl = {"dims": [{"axis": "x", "ok": True, "ticks_px": [[100, 500], [900, 500]], "parse_m": 8.0, "text": "8 m", "chain": [], "box": [90, 480, 910, 520]},
                   {"axis": "y", "ok": False, "why": "no_ticks", "parse_m": 6.0, "text": "6 m"}]}
    was = copy.deepcopy(pl)
    prop = A.scale_proposal(pl, [1000, 800])
    assert pl == was and prop["main"] == "x" and prop["other"] is None and prop["ppm"] == 100.0
    assert prop["across_m"] == 10.0 and prop["down_m"] == 8.0 and prop["axes"]["y"]["state"] == "none" and prop["stretch_pct"] is None
    assert prop["axes"]["x"]["ends_frac"] == [[0.1, 0.625], [0.9, 0.625]]
    # A text PadSpan can't read as the length (cut short): the chain's segments, else the metres, are what Save sends.
    pl["dims"][0].update(text="3 m + 2.5 m + 2.", chain=["3 m", "2.5 m", "2.5 m"])
    assert A.scale_proposal(pl, [1000, 800])["axes"]["x"]["save_text"] == "3 m + 2.5 m + 2.5 m"
    pl["dims"][0].update(chain=[])
    assert A.scale_proposal(pl, [1000, 800])["axes"]["x"]["save_text"] == "8.0000 m"


# ═══ the save: piece 3's scale_save, unchanged ════════════════════════════════

def test_yes_saves_through_scale_save_exactly_as_a_guided_save_of_the_same_ends(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk, "feet_chain")
    sess = _read(h, conn)
    prop, sent, real = sess["proposal"], [], F.async_write_measured_transform

    async def spy(hass, map_id, transform):
        sent.append(copy.deepcopy(transform))
        return await real(hass, map_id, transform)
    monkeypatch.setattr(F, "async_write_measured_transform", spy)
    ms_ = _measures(prop)
    out = _call(WP.ws_plan_build_scale_save, h, conn, map_id="n1", sig="ss", measures=ms_, source="plan_dimension", session=sess["id"], via="wizard")
    assert out["ok"] is True and out["across_m"] == pytest.approx(prop["across_m"], abs=0.01) and out["down_m"] == pytest.approx(prop["down_m"], abs=0.01)
    assert [r["source"] for r in sent[0]["reference_measurements"]] == ["plan_dimension", "plan_dimension"]
    assert _call(WP.ws_plan_build_scale_undo, h, conn, map_id="n1", via="wizard")["ok"] is True and mdl.map_transform("n1") is None
    out2 = _call(WP.ws_plan_build_scale_save, h, conn, map_id="n1", sig="ss", measures=ms_, source="guided", via="wizard")
    assert out2["ok"] is True
    for r in sent[1]["reference_measurements"]:
        r["source"] = "plan_dimension"
    assert sent[1] == sent[0]                                                      # the same write, but for where it came from
    c = _counters(h)
    assert c["plan_build_scale_check:yes"] == 1 and "plan_build_scale_check:corrected" not in c


def test_a_corrected_number_is_saved_as_corrected_and_its_distance_counted(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk, "feet_chain")
    sess = _read(h, conn)
    prop = sess["proposal"]
    out = _call(WP.ws_plan_build_scale_save, h, conn, map_id="n1", sig="ss", measures=_measures(prop, text="31' 0\""),
                source="plan_dimension_corrected", session=sess["id"], via="wizard")
    assert out["ok"] is True
    refs = mdl.map_transform("n1")["reference_measurements"]
    assert [r["source"] for r in refs] == ["plan_dimension_corrected"] and refs[0]["distance_m"] == pytest.approx(9.4488, abs=1e-4)
    # The server worked the scale out from the ends and the typed length: the ends' pixels over 31 feet.
    ax = prop["axes"]["x"]
    px = math.hypot((ax["ends_frac"][1][0] - ax["ends_frac"][0][0]) * 1250, (ax["ends_frac"][1][1] - ax["ends_frac"][0][1]) * 1000)
    assert refs[0]["px_per_meter"] == pytest.approx(px / 9.4488, abs=0.01)
    c = _counters(h)
    assert c["plan_build_scale_check:corrected"] == 1 and c["plan_build_scale_fix:1_3"] == 1       # 31' against 30'-5 1/2": 1.8 %


# ═══ the commands' rules ══════════════════════════════════════════════════════

def test_start_refuses_a_plan_with_a_scale_and_an_outdoor_plan_before_a_start_is_spent(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    ms.get_map("n1")["floor_id"] = "__outside__"
    assert _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1", via="wizard")["error"] == "outdoor"
    ms.get_map("n1")["floor_id"] = "main"
    mdl.data["map_transforms"]["n1"] = {"scale_x_m": 10.0, "scale_y_m": 8.0}
    assert _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1", via="wizard")["error"] == "already_placed"
    assert not h.data[DOMAIN].get(A._DATA_STARTS) and not h.jobs                                     # noqa: SLF001
    # The helper's gates, Live Aboard not needed (via wizard); without it the line-up's rule holds.
    assert _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1")["error"]


def test_the_rooms_read_after_a_scale_read_and_its_save_skips_the_gap_and_the_caps_hold(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk)
    sess = _read(h, conn)                                                            # a start, seconds ago
    rooms = lambda: _call(WP.ws_plan_build_rooms_start, h, conn, floor_id="main", map_ids=["n1"], via="wizard")  # noqa: E731
    assert rooms().get("error") == "too_soon"                                         # no save yet: the gap holds
    out = _call(WP.ws_plan_build_scale_save, h, conn, map_id="n1", sig="ss", measures=_measures(sess["proposal"]), source="plan_dimension",
                session=sess["id"], via="wizard")
    assert out["ok"] is True
    assert rooms().get("error") != "too_soon"                                         # the helper's own save just before: skipped
    for c in h.jobs:
        c.close()                                                                    # the rooms read isn't this test's
    h.jobs.clear()
    # Another scale read right away: the gap holds for it; ten a day hold for all.
    mdl.data["map_transforms"].pop("n1")
    assert _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1", via="wizard")["error"] in ("too_soon", "daily_cap")
    h.data[DOMAIN][A._DATA_STARTS] = [time.monotonic() - 100 - i for i in range(A.STARTS_A_DAY)]   # noqa: SLF001
    assert _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1", via="wizard")["error"] == "daily_cap"


def test_out_of_credit_stops_with_its_reason_and_nothing_is_written(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, mdl, ms, cal = _house(monkeypatch, tmp_path, disk, fail=RuntimeError("Your credit balance is too low to access the Anthropic API"))
    sess = _read(h, conn)
    assert sess["status"] == "no_credit" and sess["proposal"] is None and [s["reason"] for s in sess["stops"]] == ["no_credit"]
    assert sess["stops"][0]["say"] and mdl.map_transform("n1") is None
    c = _counters(h)
    assert c["plan_build_read_fail:s0_no_credit"] == 1 and c["plan_build_run:s0_no_credit"] == 1


def test_an_unusable_answer_fails_as_bad_answer(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk, fail=_HaError("Sorry, I had a problem talking to Anthropic: Overloaded"))
    sess = _read(h, conn)
    assert sess["status"] == "failed" and sess["error"] == "bad_answer"


def test_a_scale_read_cut_short_by_a_restart_is_swept_and_counted(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk)
    r = _call(WP.ws_plan_build_scale_start, h, conn, map_id="n1", via="wizard")
    h.jobs.pop().close()                                                             # Home Assistant stopped before it ran
    store = _store(h)
    assert store.scale_session(r["session"])["status"] == "running"
    _run(store.async_sweep())
    s = store.scale_session(r["session"])
    assert s["status"] == "failed" and s["error"] == "restart" and [x["reason"] for x in s["stops"]] == ["restart"]
    c = _counters(h)
    assert c["plan_build_run:s0_failed"] == 1 and "plan_build_run:s1_failed" not in c


def test_read_a_is_reused_by_the_next_scale_read_and_by_a_later_line_up(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, *_ = _house(monkeypatch, tmp_path, disk)
    first = _read(h, conn)
    store = _store(h)
    got = A.earlier_reads(store)["n1|ss"]
    assert got["read_a"]["dims"] and got["dims"] is None and got["dims_read"] is False      # Read A only: a line-up reads its own dimensions
    h.data[DOMAIN][A._DATA_STARTS] = []                                                     # noqa: SLF001
    second = _read(h, conn)
    assert second["id"] != first["id"] and second["reads"] == 2 and _counters(h)["plan_build_read:s0_reused"] == 1
    assert second["proposal"]["ppm"] == pytest.approx(first["proposal"]["ppm"], rel=1e-6)
    snap = {"plans": {"n1": {"name": "New plan", "floor_id": "main", "image_sig": "ss", "place_sig": "p", "size": [1250, 1000], "drawn": {}, "refs": 1}}}
    lineup = A.new_lineup(A.unlock(h), snap, "main", ["n1"], A.earlier_reads(store))
    pl = lineup["plans"][0]
    assert pl["reused"] is True and pl["read_a"] == got["read_a"] and len(pl["dims"]) == 2 and not pl["dims_read"]
    # The store keeps ten scale reads at most.
    for i in range(12):
        store.data["scales"][f"sc_old{i}"] = {"started_at": i, "status": "done"}
    store.trim()
    assert len(store.data["scales"]) == A.MAX_SCALE_SESSIONS and second["id"] in store.data["scales"]
