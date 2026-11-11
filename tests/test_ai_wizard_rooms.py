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
    # Round 3: a step on another plan starts afresh: the last plan's readings aren't carried over to it.
    other = W.mark({**w, "started": {**w["started"], "scale_session": "sc_1"}}, "step", 0.0, d, step="intro", map_id="m2")
    assert other["started"] == {"at": "intro", "map_id": "m2"}
    assert W.mark(w, "step", 0.0, d, step="rooms_read", map_id="m1")["started"]["rooms_session"] == "rb_1"   # the same plan keeps them
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


def test_opening_it_again_after_its_undo_or_on_a_house_with_rooms_is_counted(monkeypatch):
    """The two ways back only the pull surfaces give (offer_reason): counted when used."""
    from tests.test_house3d_store import _house as _h3
    h = _h3()
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = True
    conn = MagicMock()
    monkeypatch.setattr(W, "setup_state", lambda hass: {"maps": {"list": [{"id": "m1"}]}, "model": {"room_geometry_m": {}}})
    _run(W.ws_ai_wizard_mark(h, conn, {"id": 1, "what": "opened", "surface": "setup"}))
    c = dict(h.data[DOMAIN].get(T._DATA_COUNTERS) or {})
    assert "ai_wizard:after_undo" not in c and "ai_wizard:with_rooms" not in c                 # a first open: neither
    h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"] = {"undone": True, "started": {"at": "saved"}}
    _run(W.ws_ai_wizard_mark(h, conn, {"id": 2, "what": "opened", "surface": "setup"}))
    monkeypatch.setattr(W, "setup_state", lambda hass: {"maps": {"list": []}, "model": {"room_geometry_m": {"Den": {}}}})
    h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"] = {"finished_day": "2026-11-10", "started": {"at": "saved"}}
    _run(W.ws_ai_wizard_mark(h, conn, {"id": 3, "what": "opened", "surface": "maps_wizard"}))
    c = dict(h.data[DOMAIN].get(T._DATA_COUNTERS) or {})
    assert c.get("ai_wizard:after_undo") == 1 and c.get("ai_wizard:with_rooms") == 1


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


def test_the_helper_needs_no_settings_switch_and_the_plans_tool_still_does(monkeypatch, tmp_path, disk):  # noqa: F811
    """Owner, 2026-11-12: the helper's Start is the consent. With both Settings switches off its reads, edits, save and
    undo go through and its read isn't stopped as switch_off; the Plans tool's commands still refuse, and nothing turns
    a switch on."""
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    data = h.data[DOMAIN][DATA_SETTINGS].data
    data.update(ai_plans_enabled=False, ai_plan_build_enabled=False, atlas_3d_enabled=True)
    assert _call(WP.ws_plan_build_rooms_start, h, conn, floor_id="main")["error"] == "ai_plans_off"
    data["ai_plans_enabled"] = True
    assert _call(WP.ws_plan_build_rooms_start, h, conn, floor_id="main")["error"] == "plan_build_off"
    data.update(ai_plans_enabled=False, atlas_3d_enabled=False)
    ans = _wiz_read(h, conn)
    assert ans["session"]["status"] == "done" and ans["wizard"]["rows"], ans["session"].get("error")
    sess = ans["session"]
    out = _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=ans["wizard"]["ticked"], via="wizard")
    assert out.get("ok"), out
    assert _call(WP.ws_plan_build_rooms_undo, h, conn, session=sess["id"], via="wizard").get("ok")
    assert _call(WP.ws_plan_build_rooms_undo, h, conn, session=sess["id"])["error"] == "ai_plans_off"   # the Plans tool's own undo: as it was
    assert data["ai_plans_enabled"] is False and data["ai_plan_build_enabled"] is False


def test_the_helpers_later_undo_is_offered_whatever_the_switches_on_setup_and_in_settings(monkeypatch, tmp_path, disk):  # noqa: F811
    """Owner, 2026-11-12: the later undo lives on Setup's Draw the rooms row (the pull rule's answer carries it) and in
    Settings → AI under the helper's own name (plan_build_info gives it whatever the research switch); the Plans tool's
    own rooms undo stays under that switch."""
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    h.data[DOMAIN][DATA_SETTINGS].data.update(ai_plans_enabled=False, ai_plan_build_enabled=False)
    ans = _wiz_read(h, conn)
    sess = ans["session"]
    assert _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=ans["wizard"]["ticked"], via="wizard").get("ok")
    info = _call(WP.ws_plan_build_info, h, conn)
    assert info["master"] is False and info["rooms_undo"]["helper"] is True and info["rooms_undo"]["session"] == sess["id"]
    assert info["rooms_undo"]["scale"] in ("goes", "none", "changed_since", "remeasured")
    pull = _call(W.ws_ai_wizard_info, h, conn, surface="pull", kiosk=False, live=True)
    assert pull["undo"]["session"] == sess["id"] and pull["undo"]["items"] == len(ans["wizard"]["ticked"]) and pull["undo"]["scale"] == info["rooms_undo"]["scale"]
    assert "undo" not in _call(W.ws_ai_wizard_info, h, conn, surface="push", kiosk=False, live=True)
    assert "undo" not in _call(W.ws_ai_wizard_info, h, conn, surface="pull", kiosk=True, live=True)      # never on a wall screen
    assert _call(WP.ws_plan_build_rooms_undo, h, conn, session=sess["id"], via="wizard").get("ok")
    assert _call(W.ws_ai_wizard_info, h, conn, surface="pull", kiosk=False, live=True)["undo"] is None


def _box(x0, y0, w, h):
    return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]


def test_the_scale_looks_wrong_only_on_two_signs_agreeing():
    """Owner, 2026-11-12: evidence the rooms read already holds; a notice only when two independent signs say the same way
    and roughly as much; one sign alone, or two that disagree, say nothing."""
    big = {"space:1": {"new": "Bedroom", "outline_m": _box(0, 0, 4.9, 4.9)}, "space:2": {"new": "Bedroom 2", "outline_m": _box(5, 0, 5, 5)},
           "space:3": {"new": "Kitchen", "outline_m": _box(11, 0, 5.1, 5.1)}, "space:4": {"name": "BATH", "new": "Bathroom", "outline_m": _box(55, 0, 3.3, 3.3)}}
    rows = list(big)
    got = W.scale_signs(big, rows)
    assert got and got["signs"] == ["footprint", "rooms"] and 1.4 < got["k"] < 1.55, got
    assert got["example"]["rooms"]["kind"] in ("bathroom", "kitchen", "bedroom") and got["example"]["footprint"]["m"] == 58.3
    near = {k: {**v, "outline_m": _box(v["outline_m"][0][0] * 0.3, 0, 4, 4) if k == "space:4" else v["outline_m"]} for k, v in big.items()}
    assert W.scale_signs(near, rows) is None                                   # rooms alone: never shown on one sign
    assert W.scale_signs(near, rows, {"k": 1.5, "text": "60'", "metres": 18.3, "here_m": 27.4})["signs"] == ["printed", "rooms"]
    assert W.scale_signs(near, rows, {"k": 0.6, "text": "60'"}) is None         # the other way: they disagree, nothing said
    assert W.scale_signs({k: v for k, v in list(near.items())[:2]}, rows[:2], {"k": 1.5}) is None   # two named rooms aren't a sign
    small = {k: {**v, "outline_m": [[p[0] * 0.5, p[1] * 0.5] for p in v["outline_m"]]} for k, v in near.items()}
    assert W.scale_signs(small, rows, {"k": 0.7})["signs"] == ["printed", "rooms"] and W.scale_signs(small, rows, {"k": 0.5}) is None   # 0.5 against 0.74: too far apart


def test_checking_the_scale_redraws_the_same_rooms_at_the_new_scale_with_no_new_read(monkeypatch, tmp_path, disk):  # noqa: F811
    """Owner, 2026-11-12: after the scale is measured again, the helper's unsaved rooms come back worked out from the
    same reads at the new scale (plan_ai.reproject_rooms through rooms_status); a saved session is never touched; the
    scale notice is gone for a plan whose scale the person said is right."""
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    ans = _wiz_read(h, conn)
    sess = ans["session"]
    mid = sess["plans"][0]["map_id"]
    area = lambda a: {sid: round(A.G.area(s["outline_m"]), 2) for sid, s in a["session"]["proposal"]["spaces"].items() if not s.get("merged_into")}  # noqa: E731
    before, runs = area(ans), _counters(h).get("plan_build_run:s2_started")
    tf = h.data[DOMAIN][DATA_MODEL].data["map_transforms"][mid]
    tf.update(scale_x_m=tf["scale_x_m"] * 2, scale_y_m=tf["scale_y_m"] * 2)  # measured again: twice as big
    again = _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")
    after = area(again)
    # A space's id comes from its outline in metres: the ids are new, the same rooms four times the area.
    assert again["session"]["rev"] > sess["rev"] and len(after) == len(before)
    b4, af = sorted(before.values()), sorted(after.values())
    assert all(abs(a - 4 * b) <= 0.05 * max(1.0, 4 * b) for a, b in zip(af, b4)), (b4, af)
    assert all(s.get("new") for s in again["session"]["proposal"]["spaces"].values() if not s.get("merged_into"))   # named again
    assert _counters(h).get("plan_build_run:s2_started") == runs and _counters(h).get("ai_wizard_scale_notice:reprojected") == 1
    assert _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")["session"]["rev"] == again["session"]["rev"]   # once
    h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"] = {"scale_ok": [mid]}
    monkeypatch.setattr(W, "scale_signs", lambda *a, **k: {"k": 2.0, "signs": ["rooms", "footprint"], "example": {}})
    assert _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")["wizard"]["scale_check"] is None
    h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"] = {}
    assert _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")["wizard"]["scale_check"]["k"] == 2.0


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


def test_the_person_s_ticks_are_kept_on_the_session_without_touching_the_proposal(monkeypatch, tmp_path, disk):  # noqa: F811
    """End-to-end test 2026-11-11: names typed, a row unticked and "Also add to Home Assistant" ticked were lost on Back
    or a reload. The ticks are kept on the rooms session itself (names go there through the "space" edit as they are
    typed): a reload of the session finds them, a new read starts from Claude's own."""
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    ans = _wiz_read(h, conn)
    sess, ticked = ans["session"], ans["wizard"]["ticked"]
    assert "picked" not in sess and len(ticked) >= 2
    want = {"ticked": ticked[1:], "ha": ticked[1:2]}
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"] - 3, op="ticks", via="wizard", **want)
    assert r == {"ok": True}                                                         # an old rev is fine: the proposal isn't touched
    again = _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")
    assert again["session"]["picked"] == want and again["session"]["rev"] == sess["rev"]
    assert again["session"]["proposal"] == sess["proposal"]
    assert _call(WP.ws_plan_build_rooms_edit, h, conn, session="rb_nope", rev=1, op="ticks", ticked=[], via="wizard")["error"] == "not_found"


def test_a_name_kept_as_it_is_typed_counts_no_stop_and_cleared_gives_claude_s_back(monkeypatch, tmp_path, disk):  # noqa: F811
    """Review 2026-11-11: the helper keeps a name on the session when its field is left (`draft`); a name already taken
    was recorded as a stop on every blur, filling the opt-in stop counts and Settings' "stops this month". Only Save's
    refusal counts now. An empty name gives Claude's suggestion back."""
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    ans = _wiz_read(h, conn)
    names, sess = _by_name(ans), ans["session"]
    a, b = names["Den"], names["Store"]
    stops = lambda: [s["reason"] for s in (h.data[DOMAIN]["plan_ai"].rooms_session(sess["id"]) or {}).get("stops") or []]  # noqa: E731
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"], op="space", space=a, name="Store", draft=True, via="wizard")
    assert r["error"] == "name_taken" and stops().count("name_taken") == 0
    again = _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")["session"]
    assert again["rev"] == sess["rev"]                                               # nothing recorded, nothing moved on
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"], op="space", space=a, name="Store", via="wizard")
    assert r["error"] == "name_taken" and stops().count("name_taken") == 1          # Save's refusal: counted, as before
    sess = _call(WP.ws_plan_build_rooms_status, h, conn, session=sess["id"], via="wizard")["session"]
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"], op="space", space=a, name="Scullery", draft=True, via="wizard")
    assert r["session"]["proposal"]["spaces"][a]["new"] == "Scullery" and r["wizard"]["sources"][a] == "typed"
    sess = r["session"]
    r = _call(WP.ws_plan_build_rooms_edit, h, conn, session=sess["id"], rev=sess["rev"], op="space", space=a, name="", draft=True, via="wizard")
    assert r["session"]["proposal"]["spaces"][a]["new"] == "Den" and r["wizard"]["sources"][a] == ans["wizard"]["sources"][a] != "typed"
    assert r["session"]["proposal"]["spaces"][b]["new"] == "Store"


def test_the_helper_s_save_is_named_as_the_helper_s_in_its_backups_and_its_undo_row(monkeypatch, tmp_path, disk):  # noqa: F811
    """Settings → AI's undo row and the automatic backups name the helper, as its scale's backup already did."""
    from tests.test_plan_build_rooms import _backups
    h, conn, _ai = _bare(monkeypatch, tmp_path, disk)
    ans = _wiz_read(h, conn)
    sess = ans["session"]
    out = _call(WP.ws_plan_build_rooms_commit, h, conn, session=sess["id"], rev=sess["rev"], items=ans["wizard"]["ticked"], via="wizard")
    assert out.get("ok"), out
    assert out["undo"]["helper"] is True and _call(WP.ws_plan_build_info, h, conn, via="wizard")["rooms_undo"]["helper"] is True
    assert _call(WP.ws_plan_build_rooms_undo, h, conn, session=sess["id"], via="wizard").get("ok")
    notes = [b["note"] for b in _backups(tmp_path)]
    assert any(n.startswith("Before Let Claude draw your rooms saved rooms: ") for n in notes), notes
    assert any(n.startswith("Before undoing the rooms Let Claude draw your rooms saved: ") for n in notes), notes
    assert not any("rooms from plans" in n for n in notes), notes


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
