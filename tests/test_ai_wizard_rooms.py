"""Let Claude draw your rooms, piece 2: the server side of the helper
(ai_wizard.py's names, ticks, marks and the Home Assistant area it may add;
ws_plan_ai.py's rooms commands with via "wizard"; design PadspanResearch
ai-wizard-design-2026-11-10.md, A.3, C option 2, D, J).

What is held here: the name table (abbreviations, numbers, accents, the
largest space first, other floors' areas left alone, names unique house-wide,
open to below unnamed); the ticks a helper's session starts with; Not now
twice; the area made only on request, never twice, after the save, a failure
said and counted; the rooms commands answering with Live Aboard off for the
helper only, a door still refused; the AI Tasks listed through the unlock
rule. The synthetic floor of tests/test_plan_build_rooms.py, its rooms taken
away: a house with a plan and no rooms.
"""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ai_wizard as W
from custom_components.padspan_ha import plan_ai as A
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d_photo as P
from custom_components.padspan_ha import ws_plan_ai as WP
from custom_components.padspan_ha.const import DATA_FABRIC, DATA_MODEL, DATA_SETTINGS, DOMAIN
from tests.test_house3d_edit import disk  # noqa: F401  (the on-disk store fixture)
from tests.test_house3d_store import _run
from tests.test_plan_build_rooms import _CLAUDE, _call, _counters, _fab_rooms, _finish, _house

_SQ = lambda w, h: [[0, 0], [w, 0], [w, h], [0, h]]  # noqa: E731


# ═══ names (design D) ═════════════════════════════════════════════════════════

def _sp(**named_sizes):
    return {f"space:{i}": {"name": n, "outline_m": _SQ(*wh)} for i, (n, wh) in enumerate(named_sizes.items())}


def test_abbreviations_numbers_and_accents_match_the_areas_of_this_floor():
    spaces = {"space:a": {"name": "BR 2", "outline_m": _SQ(3, 4)}, "space:b": {"name": "KITCHEN", "outline_m": _SQ(4, 4)},
              "space:c": {"name": "KÜCHE", "outline_m": _SQ(2, 2)}, "space:d": {"name": "Mstr. Bdrm", "outline_m": _SQ(4, 5)},
              "space:e": {"name": "WIC", "outline_m": _SQ(1, 1.5)}, "space:f": {"name": "OPEN TO BELOW", "outline_m": _SQ(4, 4)}}
    areas = [{"name": "Bedroom 2", "floor_id": "main"}, {"name": "Kitchen", "floor_id": None}, {"name": "Küche", "floor_id": "main"},
             {"name": "Primary Bedroom", "floor_id": "main"}]
    got = W.suggest_names(spaces, areas, [], "main")
    assert got["space:a"] == {"name": "Bedroom 2", "source": "area_abbrev"}
    assert got["space:b"] == {"name": "Kitchen", "source": "area_exact"}
    assert got["space:c"] == {"name": "Küche", "source": "area_exact"}          # any language, folded
    assert got["space:d"] == {"name": "Primary Bedroom", "source": "area_abbrev"}   # Master is Primary
    assert got["space:e"] == {"name": "Closet", "source": "printed"}             # written out, no area
    assert "space:f" not in got                                                   # open to below: no room


def test_one_area_goes_to_the_largest_space_and_names_stay_unique_house_wide():
    spaces = {"space:s": {"name": "BEDROOM", "outline_m": _SQ(3, 3)}, "space:l": {"name": "BEDROOM", "outline_m": _SQ(4, 4)},
              "space:o": {"name": "Office", "outline_m": _SQ(3, 3)}, "space:n": {"name": "NOOK", "outline_m": _SQ(2, 2)}}
    areas = [{"name": "Bedroom", "floor_id": "main"}, {"name": "Office", "floor_id": "upper"}, {"name": "Nook", "floor_id": "upper"}]
    got = W.suggest_names(spaces, areas, ["Den"], "main")
    assert got["space:l"] == {"name": "Bedroom", "source": "area_exact"}
    assert got["space:s"] == {"name": "Bedroom 2", "source": "printed"}
    # Another floor's area is never matched (the save would move it), and its name isn't taken either.
    assert got["space:o"] == {"name": "Office 2", "source": "printed"} and got["space:n"]["name"] == "Nook 2"
    assert W.suggest_names({"space:d": {"name": "DEN", "outline_m": _SQ(3, 3)}}, [], ["Den"], "main")["space:d"]["name"] == "Den 2"


def test_an_area_s_words_inside_a_label_match_and_short_words_do_not():
    spaces = {"space:a": {"name": "LIVING / DINING", "outline_m": _SQ(5, 5)}, "space:b": {"name": "RM 3", "outline_m": _SQ(3, 3)}}
    got = W.suggest_names(spaces, [{"name": "Dining Room", "floor_id": "main"}, {"name": "3", "floor_id": "main"}], [], "main")
    assert got["space:a"] == {"name": "Dining Room", "source": "area_abbrev"} and got["space:b"]["source"] == "printed"
    assert W.printed_name("MSTR BR") == "Master Bedroom" and W.printed_name("Salle à manger") == "Salle à manger"
    assert len(W.printed_name("X" * 80)) == W.NAME_MAX == A.S2_NAME_MAX


def test_the_helper_ticks_rooms_seen_twice_and_big_enough():
    prop = {"rooms": {}, "spaces": {
        "space:big": {"name": "DEN", "new": "Den", "outline_m": _SQ(3, 3), "reads": [1, 2]},
        "space:once": {"name": "SHOP", "new": "Shop", "outline_m": _SQ(4, 4), "reads": [1]},
        "space:mid": {"name": "STORE", "new": "Store", "outline_m": _SQ(1.5, 2), "reads": [1, 2]},
        "space:midm": {"name": "WC", "new": "Powder Room", "outline_m": _SQ(1.5, 2), "reads": [1, 2]},
        "space:tiny": {"name": "CL", "new": "Closet", "outline_m": _SQ(1, 1), "reads": [1, 2]},
        "space:deck": {"name": "DECK", "new": "Deck", "outline_m": _SQ(4, 4), "reads": [1, 2]},
        "space:void": {"name": "OPEN TO BELOW", "new": None, "outline_m": _SQ(4, 4), "reads": [1, 2]},
        "space:gone": {"name": "X", "new": "X", "outline_m": _SQ(4, 4), "reads": [1, 2], "merged_into": "space:m1"}}}
    t = W.wizard_ticks(prop, {"space:midm": "area_abbrev", "space:mid": "printed"})
    assert t["ticked"] == ["space:big", "space:midm"]
    assert t["small"] == ["space:tiny"] and t["outdoor"] == ["space:deck"] and t["dropped"] == ["space:void"]
    assert "space:gone" not in t["rows"] and "space:void" not in t["rows"] and t["m2"]["space:big"] == 9.0


@pytest.mark.parametrize("name", ["Balkon", "Loggia", "Terrasse", "Garten", "Hof", "Carport", "Treppenhaus", "balcon", "TERRASSE", "Cour", "Jardin",
                                  "loggia", "Escalier", "BALKON", "Terras", "Tuin", "Trap", "Trappenhuis", "STAIR", "Stairwell", "Stairs",
                                  "CARPORT", "Void above"])
def test_outside_stairs_and_voids_in_four_languages_start_unticked_but_are_offered(name):
    prop = {"rooms": {}, "spaces": {"space:x": {"name": name, "new": name, "outline_m": _SQ(4, 4), "reads": [1, 2]},
                                    "space:k": {"name": "Küche", "new": "Küche", "outline_m": _SQ(4, 4), "reads": [1, 2]}}}
    t = W.wizard_ticks(prop, {})
    assert t["outdoor"] == ["space:x"] and t["ticked"] == ["space:k"] and "space:x" in t["rows"], name


@pytest.mark.parametrize("label,area,printed", [
    ("BEDRM 2", "Bedroom 2", "Bedroom 2"), ("BDRM", "Bedroom", "Bedroom"), ("BED RM", "Bedroom", "Bedroom"),
    ("PWD RM", "Powder Room", "Powder Room"), ("PWDR RM", "Powder Room", "Powder Room"), ("MSTR", "Primary", "Master"),
    ("MBR", "Primary Bedroom", "Master Bedroom"), ("FAM RM", "Family Room", "Family Room"), ("LIV RM", "Living Room", "Living Room"),
    ("DIN RM", "Dining Room", "Dining Room"), ("UTIL", "Utility", "Utility"), ("MECH", "Mechanical", "Mechanical"),
    ("W/D", "Laundry", "Laundry"), ("WIC", "Closet", "Closet"), ("ENS", "Ensuite Bathroom", "Ensuite"), ("ENSUITE", "Ensuite Bathroom", "Ensuite"),
    ("ENS", "Ensuite", "Ensuite"), ("GAR", "Garage", "Garage")])
def test_the_abbreviations_plans_print_match_their_areas_and_are_written_out(label, area, printed):
    sp = {"space:a": {"name": label, "outline_m": _SQ(3, 4)}}
    assert W.suggest_names(sp, [{"name": area, "floor_id": "main"}], [], "main")["space:a"] == {"name": area, "source": "area_abbrev"}, label
    assert W.printed_name(label) == printed and W.suggest_names(sp, [], [], "main")["space:a"]["name"] == printed, label


@pytest.mark.parametrize("label,want", [
    ("BEDROOM 2 14'-8\" x 8'-5\"", "Bedroom 2"), ("KITCHEN 4.2 x 3.1", "Kitchen"), ("DEN 12'0\" x 10'6\"", "Den"), ("FAMILY ROOM 132 sq ft", "Family Room"),
    ("Wohnen 12,3 m²", "Wohnen"), ("OFFICE (12'x10')", "Office"), ("BR 3 - 3.6 m x 3.0 m", "Bedroom 3"), ("Bath 4,2 x 2,1", "Bath"),
    ("STUDY 2", "STUDY 2".title()), ("BR 2", "Bedroom 2")])
def test_a_printed_size_never_reaches_a_room_s_name(label, want):
    assert W.printed_name(label) == want, (label, W.printed_name(label))
    assert W.suggest_names({"space:a": {"name": label, "outline_m": _SQ(3, 4)}}, [], [], "main")["space:a"]["name"] == want
    # and it never stops a match: the size is no part of the words matched
    assert W.suggest_names({"space:a": {"name": label, "outline_m": _SQ(3, 4)}}, [{"name": want, "floor_id": "main"}], [], "main")["space:a"]["source"] \
        in ("area_exact", "area_abbrev")


# ═══ Not now, Don't ask again, where it was left (design A.3) ═════════════════

def test_not_now_is_a_week_then_a_month_and_the_steps_reopen_where_left():
    d = date(2026, 11, 10)
    w = W.mark({}, "snoozed", 1000.0, d)
    assert w == {"snoozes": 1, "snooze_until": 1000.0 + 7 * 86400}
    w = W.mark(w, "snoozed", 2000.0, d)
    assert w["snooze_until"] == 2000.0 + 30 * 86400 and W.mark(w, "snoozed", 0.0, d)["snooze_until"] == 30 * 86400
    w = W.mark({}, "opened", 0.0, d)
    assert w == {"offered": True, "started": {"at": "intro"}}
    w = W.mark(w, "step", 0.0, d, step="rooms_check", map_id="m1", floor_id="main", rooms_session="rb_1", extra="x")
    assert w["started"] == {"at": "rooms_check", "map_id": "m1", "floor_id": "main", "rooms_session": "rb_1"}
    assert W.mark(w, "dismissed", 0.0, d)["dismissed"] is True
    done = W.mark({**w, "undone": True}, "finished", 0.0, d)
    assert done["finished_day"] == "2026-11-10" and "undone" not in done and W.wizard_state(done, 0.0) == "finished"
    assert W.mark(done, "undone", 0.0, d)["undone"] is True


def test_the_mark_command_is_an_administrator_s_counts_and_writes():
    from tests.test_house3d_store import _house as _h3
    h = _h3()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = True
    conn = MagicMock()
    assert hasattr(W.ws_ai_wizard_mark, "ws_schema") and W.ws_ai_wizard_mark in W.WS_COMMANDS
    for kw in ({"what": "offered", "surface": "overview"}, {"what": "opened", "surface": "setup"}, {"what": "step", "step": "rooms_read",
               "floor_id": "main"}, {"what": "snoozed"}, {"what": "came_back"}):
        _run(W.ws_ai_wizard_mark(h, conn, {"id": 1, **kw}))
    w = h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"]
    assert w["started"] == {"at": "rooms_read", "floor_id": "main"} and w["snoozes"] == 1 and w["offered"] is True
    c = dict(h.data[DOMAIN].get(T._DATA_COUNTERS) or {})
    for e in ("ai_wizard_offered:overview", "ai_wizard_opened:setup", "ai_wizard_step:rooms_read", "ai_wizard:snoozed", "ai_wizard:came_back"):
        assert c.get(e) == 1, e


# ═══ "Also add this room to Home Assistant" ═══════════════════════════════════

class _Areas:
    def __init__(self, names=(), fail=False):
        self.made, self.fail, self.names = [], fail, {n.lower() for n in names}

    def async_get_area_by_name(self, name):
        return SimpleNamespace(name=name) if name.lower() in self.names else None

    def async_create(self, name, floor_id=None):
        if self.fail:
            raise ValueError("registry")
        self.made.append((name, floor_id))
        self.names.add(name.lower())


class _Floors:
    def async_get_floor(self, fid):
        return SimpleNamespace(floor_id=fid) if fid == "main" else None


def test_an_area_is_matched_never_made_twice_put_on_its_floor_and_a_failure_is_a_word():
    reg = _Areas(names=["Kitchen"])
    assert W.create_area(reg, _Floors(), "kitchen", "main") == "matched" and reg.made == []
    assert W.create_area(reg, _Floors(), "Shop", "main") == "created" and reg.made == [("Shop", "main")]
    assert W.create_area(reg, _Floors(), "Shop", "main") == "matched"
    assert W.create_area(reg, _Floors(), "Loft", "attic") == "created" and reg.made[-1] == ("Loft", None)   # no such floor in HA
    assert W.create_area(reg, None, "Den", "main") == "created" and reg.made[-1] == ("Den", None)
    assert W.create_area(_Areas(fail=True), _Floors(), "Den", "main") == "failed"


# ═══ the rooms commands for the helper, Live Aboard off (Garry, 2026-11-10) ═══

def _bare(monkeypatch, tmp_path, disk, areas=()):  # noqa: F811
    """The test floor with no rooms, Live Aboard off, the helper's areas."""
    h, conn, ai = _house(monkeypatch, tmp_path, disk)
    fab = h.data[DOMAIN][DATA_FABRIC]
    fab.data["floors"]["main"]["rooms"] = {}
    mdl = h.data[DOMAIN][DATA_MODEL]
    mdl.data.update(room_meta={}, room_adjacency={})
    _run(fab.store.async_save(fab.data))
    _run(mdl.store.async_save(mdl.data))
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    monkeypatch.setattr(W, "ha_areas", lambda hass: [dict(a) for a in areas])
    return h, conn, ai


def _wiz_read(h, conn) -> dict:
    r = _call(WP.ws_plan_build_rooms_start, h, conn, floor_id="main", via="wizard")
    assert "session" in r, r
    _finish(h)
    return _call(WP.ws_plan_build_rooms_status, h, conn, session=r["session"], via="wizard")


def _by_name(ans: dict) -> dict[str, str]:
    return {s["new"]: sid for sid, s in ans["session"]["proposal"]["spaces"].items() if s.get("new") and not s.get("merged_into")}


def test_the_plans_tool_still_needs_live_aboard_and_the_helper_does_not(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    for fn, kw in ((WP.ws_plan_build_rooms_start, {"floor_id": "main"}), (WP.ws_plan_build_rooms_status, {}),
                   (WP.ws_plan_build_rooms_commit, {"session": "x", "rev": 1, "items": ["space:a"]})):
        assert _call(fn, h, conn, **kw)["error"] == "house3d_off"
    ans = _wiz_read(h, conn)
    assert ans["session"]["status"] == "done" and ans["session"]["via"] == "wizard" and ans["wizard"]["rows"]
    info = _call(WP.ws_plan_build_info, h, conn, via="wizard")
    assert info["rooms"]["main"]["ready"] and "rooms" not in _call(WP.ws_plan_build_info, h, conn)


def test_the_helper_names_ticks_saves_adds_the_area_asked_for_and_undo_takes_the_rooms_back(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk, areas=[{"name": "Den", "floor_id": "main"}, {"name": "Store", "floor_id": None},
                                                              {"name": "Nook", "floor_id": "upper"}])
    reg = _Areas(names=["Den", "Store", "Nook"])
    monkeypatch.setattr(W, "ensure_area", lambda hass, name, fid: W.create_area(reg, _Floors(), name, fid))
    ans = _wiz_read(h, conn)
    names = _by_name(ans)
    assert {"Den", "Store", "Nook 2"} <= set(names), names
    src = ans["wizard"]["sources"]
    assert src[names["Den"]] == "area_exact" and src[names["Store"]] == "area_exact" and src[names["Nook 2"]] == "printed"
    ticked = ans["wizard"]["ticked"]
    assert names["Den"] in ticked and names["Store"] in ticked and names["Nook 2"] not in ticked   # 3.2 m², no area: unticked
    assert _counters(h).get("plan_build_rooms_offered:4_6") == 1
    # Rename one, then save Den, Store and Nook 2 with "Also add to Home Assistant" on Nook 2 and on Den (an area already).
    sess = ans["session"]
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"], op="space", space=names["Nook 2"], name="Reading Nook",
              via="wizard")
    assert r["wizard"]["sources"][names["Nook 2"]] == "typed"
    sess = r["session"]
    items = [names["Den"], names["Store"], names["Nook 2"]]
    out = _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=items, via="wizard",
                ha_areas=[names["Nook 2"], names["Den"]])
    assert out.get("ok"), out
    assert out["areas"] == {names["Nook 2"]: "created", names["Den"]: "matched"} and reg.made == [("Reading Nook", "main")]
    assert set(_fab_rooms(h)) == {"Den", "Store", "Reading Nook"}
    w = h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"]
    assert w["finished_day"] and "undone" not in w
    c = _counters(h)
    assert c.get("ai_wizard:finished") == 1 and c.get("ai_wizard:area_created") == 1 and c.get("plan_build_rooms_saved:2_3") == 1
    assert c.get("plan_build_name:area_exact") == 2 and c.get("plan_build_name:typed") == 1 and c.get("plan_build_unmatched_areas:0") == 1
    und = _call(WP.ws_plan_build_rooms_undo, h, conn, session=sess["id"], via="wizard")
    assert und.get("ok") and und["undone"] == 3 and _fab_rooms(h) == {}
    assert h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"]["undone"] is True and _counters(h).get("ai_wizard:undone") == 1
    assert reg.made == [("Reading Nook", "main")]                     # Undo leaves the area in Home Assistant (said on the row)


def test_an_area_that_fails_is_said_and_counted_and_the_rooms_stay_saved(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    monkeypatch.setattr(W, "ensure_area", lambda hass, name, fid: W.create_area(_Areas(fail=True), _Floors(), name, fid))
    ans = _wiz_read(h, conn)
    sess, ticked = ans["session"], ans["wizard"]["ticked"]
    assert ticked
    out = _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=ticked, via="wizard", ha_areas=ticked[:1])
    assert out.get("ok") and out["areas"] == {ticked[0]: "failed"} and len(_fab_rooms(h)) == len(ticked)
    assert _counters(h).get("ai_wizard:area_failed") == 1


def test_no_area_is_made_when_the_save_is_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    made = []
    monkeypatch.setattr(W, "ensure_area", lambda hass, name, fid: made.append(name) or "created")
    ans = _wiz_read(h, conn)
    sess, ticked = ans["session"], ans["wizard"]["ticked"]
    out = _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"] + 5, items=ticked, via="wizard", ha_areas=ticked)
    assert "error" in out and made == [] and _fab_rooms(h) == {}
    assert "finished_day" not in (h.data[DOMAIN][DATA_SETTINGS].data.get("ai_map_wizard") or {})


def test_a_door_in_a_helper_save_with_live_aboard_off_is_refused(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    ans = _wiz_read(h, conn)
    sess = ans["session"]
    door = next(iter(sess["proposal"]["openings"]))
    out = _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=ans["wizard"]["ticked"] + [door], via="wizard")
    assert out["error"] == "house3d_off" and _fab_rooms(h) == {}


def test_a_joined_room_is_named_and_the_helper_edits_with_live_aboard_off(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    ans = _wiz_read(h, conn)
    names, sess = _by_name(ans), ans["session"]
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"], op="merge", parts=[names["Store"], names["Nook"]],
              via="wizard")
    joined = {sid: s for sid, s in r["session"]["proposal"]["spaces"].items() if sid.startswith("space:m")}
    assert len(joined) == 1 and next(iter(joined.values()))["new"]
    assert next(iter(joined)) in r["wizard"]["rows"]


# ═══ Connect Claude: every AI Task through the unlock rule ════════════════════

def test_plan_build_info_lists_every_ai_task_through_the_unlock_rule(monkeypatch, tmp_path, disk):  # noqa: F811
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    h.states.async_entity_ids = lambda domain: ["ai_task.ollama_vision", _CLAUDE, "ai_task.claude_sonnet"]
    monkeypatch.setattr(P, "_platform", lambda hass, eid: "ollama" if "ollama" in eid else "anthropic")
    monkeypatch.setattr(A, "model_sources", lambda hass, eid: ["Claude Sonnet 4.6"] if "sonnet" in eid else ["Claude Opus 5.5"])
    got = {c["entity_id"]: c for c in _call(WP.ws_plan_build_info, h, conn, via="wizard")["candidates"]}
    assert got[_CLAUDE]["ok"] and got[_CLAUDE]["chosen"] and got[_CLAUDE]["display"] == "Claude Opus 5.5"
    assert got["ai_task.claude_sonnet"]["why"] == "below_opus_5_5" and not got["ai_task.claude_sonnet"]["chosen"]
    assert got["ai_task.ollama_vision"]["why"] == "not_anthropic"


# ═══ the report's words ═══════════════════════════════════════════════════════

def test_the_helper_s_counts_are_closed_and_short():
    assert W.WIZARD_STEPS == T.AI_WIZARD_STEPS
    for e in T.AI_WIZARD_EVENTS:
        assert T.event_allowed(e) and len(e) <= 64 and e == e.lower(), e
    assert not T.event_allowed("ai_wizard_step:Kitchen") and not T.event_allowed("plan_build_name:Den")
    assert [T.rooms_band(n) for n in (0, 1, 3, 4, 12, 13)] == ["0", "1", "2_3", "4_6", "7_12", "gt12"]
    assert "ai_wizard" in T.TRIAL_SURFACES
    for k in sorted(T.AI_WIZARD_EVENTS):
        T.assert_shareable({"usage": {k: 1}})


def test_the_install_base_names_every_helper_word():
    from pathlib import Path
    import re
    ib = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views" / "installbase.js").read_text(encoding="utf-8")
    for e in T.AI_WIZARD_EVENTS:
        fam, _, val = e.partition(":")
        assert f'a === "{fam}"' in ib, fam
        assert fam == "ai_wizard_switch" or re.search(rf'(\b{val}|"{val}"): "', ib), e
