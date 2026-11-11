"""Let Claude draw your rooms, piece 1: the rule and its field signal
(ai_wizard.py; design PadspanResearch ai-wizard-design-2026-11-10.md, A and J).

Nothing is on screen yet. What is held here: the rule's reasons come in
their one order, has_rooms wins over everything after it, the 7-day line,
push and pull surfaces; the report's env.mapping and env.ai Claude words are
closed, sent only by a house still setting up (a calibrated house's report is
byte for byte what it was), and pass the shareability gate in a house full of
names and MAC addresses; the Plans tool's new counts each have a call site
and a plain name; the setting is an administrator's; and the Python copies of
setup_status.js and trialOfferable answer as the JavaScript ones do.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import ai_wizard as W
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_FABRIC, DATA_MAPS, DATA_SETTINGS, DOMAIN, OUTSIDE_FLOOR_ID
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_house3d_store import _house, _run
from tests.test_telemetry import _MAC1, _MAC2, _SECRETS
from tests.test_telemetry import _hass as _report_house

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_NODE = shutil.which("node")
_NOW = float(int(time.time()))      # the report reads the clock itself


def _f(**kw):
    """Facts that pass every gate: the rule says offer."""
    f = {"admin": True, "live": True, "kiosk": False, "edition": "full", "rooms": False, "room_bounds": False,
         "indoor_plans": 1, "plan_age_days": 18.0, "wizard": {}, "now": _NOW, "tool_used": False,
         "tier": "pro", "trial_offerable": False, "plan_scaled": True}
    f.update(kw)
    return f


# ═══ the rule ═════════════════════════════════════════════════════════════════

def test_every_reason_comes_in_its_one_order(monkeypatch):
    """From a house that fails every gate, fixing one at a time walks REASONS in order
    (no_scale with the scale step switched off, as before piece 3)."""
    monkeypatch.setattr(W, "SCALE_BUILT", False)
    f = _f(admin=False, live=False, kiosk=True, edition="bright", rooms=True, room_bounds=True, indoor_plans=0,
           plan_age_days=None, wizard={"dismissed": True, "undone": True, "snooze_until": _NOW + 60},
           tool_used=True, tier="free", trial_offerable=False, plan_scaled=False)
    fixes = [{"admin": True}, {"live": True}, {"kiosk": False}, {"edition": "full"}, {"rooms": False, "room_bounds": False},
             {"indoor_plans": 1}, {"plan_age_days": 3.0}, {"plan_age_days": 18.0},
             {"wizard": {"undone": True, "snooze_until": _NOW + 60}}, {"wizard": {"snooze_until": _NOW + 60}}, {"wizard": {}},
             {"tool_used": False}, {"tier": "pro"}, {"plan_scaled": True}]
    seen = [W.offer_reason(f, "push")]
    for fix in fixes:
        f.update(fix)
        seen.append(W.offer_reason(f, "push"))
    # not_struggled is the pull surfaces' own reason (2026-11-12): the push walk never meets it.
    assert tuple(seen) == tuple(r for r in W.REASONS if r != "not_struggled")
    assert W.offer_reason(_f(), "pull") == "not_struggled" and W.REASONS.index("not_struggled") == W.REASONS.index("plan_too_new") + 1
    assert W.REASONS[-1] == "offer" and len(set(W.REASONS)) == len(W.REASONS)


def test_the_seven_day_line():
    assert W.OFFER_AFTER_DAYS == 7
    assert W.offer_reason(_f(plan_age_days=6.999), "push") == "plan_too_new"
    assert W.offer_reason(_f(plan_age_days=7.0), "push") == "offer"
    # Owner, 2026-11-12: no day count on the pull surfaces (it was plan_too_new there too); their trigger is the struggle.
    assert W.offer_reason(_f(plan_age_days=0.0, wizard={"struggled": True}), "pull") == "offer"
    assert W.offer_reason(_f(plan_age_days=None, wizard={"struggled": True}), "pull") == "offer"


@pytest.mark.parametrize("rooms", [{"rooms": True}, {"room_bounds": True}])
def test_a_house_with_rooms_is_never_disturbed(rooms):
    """has_rooms wins over every reason after it, whatever they say."""
    worst = _f(indoor_plans=0, plan_age_days=None, wizard={"dismissed": True, "undone": True, "snooze_until": _NOW + 60},
               tool_used=True, tier="free", plan_scaled=False, **rooms)
    for surface in W.SURFACES:
        assert W.offer_reason(worst, surface) == "has_rooms"
    assert W.offer_reason(_f(**rooms), "pull") == "has_rooms"


def test_push_respects_not_now_and_dont_ask_again_pull_does_not():
    for w, push in (({"dismissed": True}, "dismissed"), ({"snooze_until": _NOW + 1}, "snoozed")):
        assert W.offer_reason(_f(wizard=w), "push") == push
        assert W.offer_reason(_f(wizard={**w, "struggled": True}), "pull") == "offer"   # pull: once the step was left unfinished
    assert W.offer_reason(_f(wizard={"snooze_until": _NOW}), "push") == "offer", "a snooze ends when its time comes"
    # The helper's own Undo: never pushed again (design A.3), but Setup, the Mapping wizard and the Plans tool still
    # offer it, so someone who undid because the scale was wrong can try again (end-to-end test 2026-11-11; until then
    # an undo refused every surface).
    assert W.offer_reason(_f(wizard={"undone": True}), "push") == "undone"
    assert W.offer_reason(_f(wizard={"undone": True, "struggled": True}), "pull") == "offer"


def test_a_house_the_helper_gave_rooms_keeps_its_way_back_on_the_pull_surfaces_only():
    """End-to-end test 2026-11-11: once the first floor had rooms, every surface said has_rooms, so the second floor
    could be reached only from the Done screen's "Do Upper next", and a read left part-way could not be picked up.
    Pull surfaces now offer it while the helper is still at it; the push surfaces stay as they were."""
    nxt = _f(rooms=True, floor_no_rooms=True, wizard={"finished_day": "2026-11-10", "started": {"at": "saved", "rooms_session": "rb_1"}})
    assert W.offer_reason(nxt, "pull") == "offer" and W.offer_reason(nxt, "push") == "has_rooms"
    assert W.offer_reason({**nxt, "floor_no_rooms": False}, "pull") == "has_rooms"          # every plan's floor has rooms: done
    assert W.offer_reason({**nxt, "room_bounds": True, "rooms": False}, "pull") == "offer"
    for at in ("scale_read", "scale_check", "scale_guided", "floor_pick", "rooms_read", "rooms_check"):   # a read left part-way
        mid = _f(rooms=True, floor_no_rooms=True, wizard={"started": {"at": at, "rooms_session": "rb_2"}})
        assert W.offer_reason(mid, "pull") == "offer" and W.offer_reason(mid, "push") == "has_rooms", at
        # Review 2026-11-11: started.at is never cleared (a read that failed stays at rooms_read). Once every floor with
        # a plan has rooms (drawn by hand, say), the helper is done there: never "part-way" for ever.
        assert W.offer_reason({**mid, "floor_no_rooms": False}, "pull") == "has_rooms", at
    # A house that got its rooms some other way, or only opened the helper, is never offered it.
    for w in ({}, {"started": {"at": "intro"}}, {"started": {"at": "consent"}}, {"offered": True}, {"undone": True}):
        assert W.offer_reason(_f(rooms=True, floor_no_rooms=True, wizard=w), "pull") == "has_rooms", w
    # The gates after has_rooms still hold for the next floor.
    assert W.offer_reason({**nxt, "kiosk": True}, "pull") == "wall_screen"
    assert W.offer_reason({**nxt, "tier": "free", "trial_offerable": False}, "pull") == "no_pro_path"


def test_the_pull_trigger_is_a_step_left_unfinished_never_a_day_count():
    """Owner, 2026-11-12: Setup and the Mapping wizard offer the helper once the person has opened the Scale or Rooms step
    and left it unfinished: met again on a later page load (step_seen with another page id), or Setup shown again after
    opening that step from it (step_left). Opening it the first time is not enough; the Overview keeps its 7 days."""
    today = date(2026, 11, 12)
    w = W.mark({}, "step_seen", _NOW, today, step="scale", page="p1")
    assert w == {"seen": {"scale": "p1"}} and W.offer_reason(_f(plan_age_days=0.5, wizard=w), "pull") == "not_struggled"
    w = W.mark(w, "step_seen", _NOW, today, step="scale", page="p1")                 # the same page load, drawn again
    assert "struggled" not in w
    w = W.mark(w, "step_seen", _NOW, today, step="scale", page="p2")                 # came back on a later page load
    assert w["struggled"] is True and W.offer_reason(_f(plan_age_days=0.5, wizard=w), "pull") == "offer"
    assert W.offer_reason(_f(plan_age_days=0.5, wizard=w), "push") == "plan_too_new"
    assert W.mark({}, "step_left", _NOW, today, step="rooms") == {"struggled": True}
    assert W.mark({}, "step_left", _NOW, today, step="calibration") == {} and W.mark({}, "step_seen", _NOW, today, step="plan", page="x") == {}
    assert W.clean_wizard({"seen": {"scale": "p" * 99, "Kitchen": "x"}, "struggled": "yes"}) == {"seen": {"scale": "p" * 64}}
    # The ones who used the helper already keep their way back without it.
    assert W.offer_reason(_f(plan_age_days=0.5, wizard={"started": {"at": "intro"}}), "pull") == "offer"


def test_the_step_marks_are_written_counted_once_and_answered(monkeypatch):
    h = _house()
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    bumped = []
    monkeypatch.setattr(T, "bump", lambda _h, e: bumped.append(e) or True)
    for page in ("p1", "p1", "p2", "p3"):
        _run(W.ws_ai_wizard_mark(h, conn, {"id": 1, "what": "step_seen", "setup_step": "rooms", "page": page}))
    stored = h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"]
    assert stored["struggled"] is True and stored["seen"] == {"rooms": "p1"}
    assert bumped == ["ai_wizard:struggled_later"] and conn.send_result.call_args[0][1]["wizard"]["struggled"] is True
    assert T.event_allowed("ai_wizard:struggled_left") and T.event_allowed("ai_wizard:struggled_later")


def test_the_account_check_is_one_tiny_read_through_the_one_ask_path_and_says_no_credit(monkeypatch):
    """Owner, 2026-11-12: an account with no credit is caught before the person measures anything: one tiny read with
    no plan in it, through ws_house3d_photo.ask (counted by the credit tracker as any read); a pass is believed an hour."""
    from custom_components.padspan_ha import ws_house3d_photo as P
    h = _house()
    conn = MagicMock()
    conn.user = MagicMock(is_admin=True)
    asked, bumped = [], []
    monkeypatch.setattr(T, "bump", lambda _h, e: bumped.append(e) or True)
    monkeypatch.setattr(P, "ai_task", lambda _h, **_k: {"ready": True, "ai_task": "ai_task.claude"})

    async def broke(_h, eid, words, structure, raw, mime, task_name="", timeout_s=None):
        asked.append((eid, raw, task_name))
        raise RuntimeError("Error code: 400 - Your credit balance is too low to access the Anthropic API.")
    monkeypatch.setattr(P, "ask", broke)
    _run(W.ws_ai_wizard_check_claude(h, conn, {"id": 1}))
    assert conn.send_result.call_args[0][1] == {"ok": False, "why": "no_credit"} and bumped == ["ai_wizard_check:no_credit"]
    assert asked[0][0] == "ai_task.claude" and asked[0][1][:8] == b"\x89PNG\r\n\x1a\n" and len(asked[0][1]) < 100   # no plan in it

    async def fine(*_a, **_k):
        asked.append("ok")
        return "OK"
    monkeypatch.setattr(P, "ask", fine)
    _run(W.ws_ai_wizard_check_claude(h, conn, {"id": 2}))
    _run(W.ws_ai_wizard_check_claude(h, conn, {"id": 3}))                              # believed: not read again
    assert conn.send_result.call_args[0][1] == {"ok": True} and asked.count("ok") == 1 and bumped[-1] == "ai_wizard_check:ok"
    assert all(T.event_allowed(f"ai_wizard_check:{w}") for w in W.CHECK_WHY)


def test_the_smaller_gates():
    assert W.offer_reason(_f(tool_used=True, wizard={"struggled": True}), "pull") == "tool_used"
    assert W.offer_reason(_f(tool_used=True, wizard={"started": {"at": "intro"}}), "pull") == "offer", "its own use isn't 'used the tool'"
    assert W.offer_reason(_f(tier="free", trial_offerable=True), "push") == "offer"
    assert W.offer_reason(_f(tier="bright", trial_offerable=False), "push") == "no_pro_path"


def test_a_plan_with_no_scale_is_offered_since_piece_3(monkeypatch):
    """Piece 3 sets a plan's scale by one measurement: no_scale is never the answer now."""
    assert W.SCALE_BUILT is True
    assert W.offer_reason(_f(plan_scaled=False), "push") == "offer"
    assert W.offer_reason(_f(plan_scaled=False, rooms=True), "push") == "has_rooms"      # a house with rooms is never disturbed
    monkeypatch.setattr(W, "SCALE_BUILT", False)
    assert W.offer_reason(_f(plan_scaled=False), "push") == "no_scale"


# ═══ the facts, from the stores ═══════════════════════════════════════════════

def _iso(days_ago: float) -> str:
    return (datetime.fromtimestamp(_NOW, timezone.utc) - timedelta(days=days_ago)).replace(microsecond=0).isoformat()


def _stuck_house(**maps_kw):
    """The report test's house (names, MACs, keys everywhere) with a plan and no rooms."""
    h = _report_house()
    h.data[DOMAIN][DATA_FABRIC].data["floors"] = {}
    m = {"id": "m1", "name": "Garry's basement plan", "floor_id": "main", "created": _iso(18), "receivers": [], "room_bounds": {}}
    m.update(maps_kw)
    h.data[DOMAIN][DATA_MAPS].data["maps"] = [m]
    return h


def test_facts_read_the_stores():
    h = _stuck_house()
    f = W.facts(h, now=_NOW)
    assert f["indoor_plans"] == 1 and f["rooms"] is False and f["room_bounds"] is False
    assert abs(f["plan_age_days"] - 18) < 0.01 and f["live"] is True and f["wizard"] == {} and f["tool_used"] is False
    assert W.offer_reason(f, "push") in W.REASONS
    # The oldest plan's `created`; with none, the install's first sighting.
    h.data[DOMAIN][DATA_MAPS].data["maps"].append({"id": "m2", "floor_id": "up", "created": _iso(40)})
    assert abs(W.facts(h, now=_NOW)["plan_age_days"] - 40) < 0.01
    for m in h.data[DOMAIN][DATA_MAPS].data["maps"]:
        m.pop("created")
    h.data[DOMAIN][DATA_SETTINGS].data["first_seen_ts"] = _NOW - 2 * 86400
    f = W.facts(h, now=_NOW)
    assert abs(f["plan_age_days"] - 2) < 0.01 and f["plan_since"] is None
    h.data[DOMAIN][DATA_SETTINGS].data.pop("first_seen_ts")
    assert W.offer_reason(W.facts(h, now=_NOW), "push") == "age_unknown"
    # A plan of the outdoors is not a plan of the house; Sample mode isn't the house either.
    h = _stuck_house(floor_id=OUTSIDE_FLOOR_ID)
    assert W.facts(h, now=_NOW)["indoor_plans"] == 0
    h.data[DOMAIN][DATA_SETTINGS].data["data_mode"] = "sample"
    assert W.offer_reason(W.facts(h, now=_NOW), "push") == "not_live"
    h.data[DOMAIN][DATA_SETTINGS].data["data_mode"] = "live"
    assert W.facts(h, now=_NOW, live=False)["live"] is False
    # Room outlines drawn on a plan only (no fabric rooms) still count as rooms.
    h = _stuck_house(room_bounds={"Nicole's Office": {"points": [[0, 0], [1, 0], [1, 1]]}})
    assert W.offer_reason(W.facts(h, now=_NOW), "pull") == "has_rooms"
    # Whether an indoor floor with a plan has no rooms yet (the helper's next floor): the fabric's rooms and a plan's outlines.
    h = _stuck_house()
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is True
    h.data[DOMAIN][DATA_FABRIC].data["floors"] = {"main": {"rooms": {"Kitchen": {}}}}
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is False
    h.data[DOMAIN][DATA_MAPS].data["maps"].append({"id": "m2", "floor_id": "up", "created": _iso(18)})
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is True
    h.data[DOMAIN][DATA_MAPS].data["maps"][1]["room_bounds"] = {"Den": {}}
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is False
    h.data[DOMAIN][DATA_MAPS].data["maps"].append({"id": "m3", "floor_id": OUTSIDE_FLOOR_ID, "created": _iso(18)})
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is False                         # the outdoors is never a floor to draw
    # Review 2026-11-11: outdoors is presence_rules.is_outdoor_floor's rule, as the panel's (isOutdoorFloorId): a
    # finished house with a plan on a floor called Yard or Garden isn't offered the helper for ever.
    for name in ("Yard", "garden", "Outdoors", "exterior", "outside"):
        h.data[DOMAIN][DATA_MAPS].data["maps"][2]["floor_id"] = name
        f = W.facts(h, now=_NOW)
        assert f["floor_no_rooms"] is False and f["indoor_plans"] == 2, name
        assert W.offer_reason({**f, "wizard": {"finished_day": "2026-11-10"}}, "pull") == "has_rooms", name
    # A plan with no floor (round 3): it has rooms only when they were drawn on it, never by taking another floor's
    # (a real floor "main" with rooms used to make it count as done).
    h = _stuck_house(floor_id=None)
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is True
    h.data[DOMAIN][DATA_FABRIC].data["floors"] = {"main": {"rooms": {"Kitchen": {"source_map_id": "other"}}}}
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is True
    h.data[DOMAIN][DATA_FABRIC].data["floors"]["main"]["rooms"]["Den"] = {"source_map_id": "m1"}     # a room made from this plan
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is False
    h = _stuck_house(floor_id="", room_bounds={"Den": {}})
    assert W.facts(h, now=_NOW)["floor_no_rooms"] is False
    # The plan AI's sessions: Line up or Rooms from plans used.
    h = _stuck_house()
    h.data[DOMAIN]["plan_ai"] = MagicMock(data={"lineups": {"s": {}}, "rooms": {}})
    assert W.facts(h, now=_NOW)["tool_used"] is True


def test_the_command_answers_with_the_same_rule(monkeypatch):
    from custom_components.padspan_ha import plan_ai as A

    async def _store(_h):
        return None
    monkeypatch.setattr(A, "async_get_store", _store)
    h = _stuck_house()
    conn = MagicMock()
    _run(W.ws_ai_wizard_info(h, conn, {"id": 1, "surface": "pull", "kiosk": True}))
    got = conn.send_result.call_args[0][1]
    assert {k: got[k] for k in ("reason", "offer")} == {"reason": "wall_screen", "offer": False} and got["wizard"] == {}
    _run(W.ws_ai_wizard_info(h, conn, {"id": 2, "surface": "push", "kiosk": False}))
    got = conn.send_result.call_args[0][1]
    assert got["reason"] == W.offer_reason(W.facts(h), "push") and got["offer"] is (got["reason"] == "offer")
    assert W.ws_ai_wizard_info in W.WS_COMMANDS
    ws = (_ROOT / "custom_components" / "padspan_ha" / "websocket.py").read_text(encoding="utf-8")
    assert "from .ai_wizard import WS_COMMANDS" in ws


# ═══ the report ═══════════════════════════════════════════════════════════════

def _calibrated_house():
    h = _report_house()
    h.data[DOMAIN][DATA_MAPS].data["maps"] = [{"id": "m1", "name": "Garry's basement plan", "created": _iso(60),
                                              "receivers": [{"source": _MAC1}], "room_bounds": {"Kitchen": {}}}]
    h.data[DOMAIN]["calibration"].data["points"] = [{"room": "Kitchen", "rssi": {_MAC2: -60 - i}} for i in range(6)]
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = "ai_task.claude_office"
    return h


def test_a_calibrated_house_s_report_is_byte_for_byte_what_it_was(monkeypatch):
    """The new block adds nothing to a house that finished setup: its report
    with the block equals its report with the block taken out."""
    h = _calibrated_house()
    with_block = json.dumps(T.build_payload(h), sort_keys=True)
    monkeypatch.setattr(W, "report_env", lambda *a, **k: None)
    without = json.dumps(T.build_payload(h), sort_keys=True)
    assert with_block == without
    assert "mapping" not in json.loads(with_block)["env"]
    assert "claude" not in (json.loads(with_block)["env"].get("ai") or {})
    # ...and the same comparison does see the block where it applies.
    monkeypatch.undo()
    h = _stuck_house()
    with_block = json.dumps(T.build_payload(h), sort_keys=True)
    monkeypatch.setattr(W, "report_env", lambda *a, **k: None)
    assert with_block != json.dumps(T.build_payload(h), sort_keys=True)


def test_env_mapping_only_where_it_applies():
    assert W.report_env(_stuck_house(), _NOW)["stuck"] == "plan_no_rooms"
    h = _report_house()                              # rooms, no receivers on a plan, 2 calibration points
    assert W.report_env(h, _NOW)["stuck"] == "rooms_no_receivers"
    h.data[DOMAIN][DATA_MAPS].data["maps"][0]["receivers"] = [{"source": _MAC1}]
    assert W.report_env(h, _NOW)["stuck"] == "receivers_no_calibration"
    h.data[DOMAIN][DATA_MAPS].data["maps"] = []      # no plan: nothing to say
    assert W.report_env(h, _NOW) is None
    h = _calibrated_house()
    assert W.report_env(h, _NOW) is None
    # A house that used the helper keeps saying how it went, set up or not.
    h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"] = {"finished_day": (date.fromtimestamp(_NOW) - timedelta(days=10)).isoformat()}
    assert W.report_env(h, _NOW) == {"stuck": "none", "plan_age": "31_90d", "wizard": "has_rooms", "wizard_state": "finished",
                                     "wizard_done_age": "7_30d"}


def test_the_words_are_closed_and_the_report_identifies_nothing():
    """A house full of names, MACs, keys and an AI Task, stuck: env.mapping and
    env.ai pass the gate and carry only listed words."""
    h = _stuck_house()
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_ai_task_entity"] = "ai_task.claude_office"
    h.data[DOMAIN][DATA_SETTINGS].data["ai_map_wizard"] = {"started": {"at": "rooms_check", "map_id": "m1", "floor_id": "main"}}
    p = T.build_payload(h)
    T.assert_shareable(p)
    text = json.dumps(p)
    for secret in [*_SECRETS, "claude_office", "m1"]:
        assert secret not in text, secret
    mp, ai = p["env"]["mapping"], p["env"]["ai"]
    assert mp["stuck"] == "plan_no_rooms" and mp["plan_age"] == "8_30d" and mp["wizard_state"] == "left_rooms_check"
    assert all(v in W.MAPPING_WORDS[k] for k, v in mp.items())
    assert ai["claude"] in T.PLAN_BUILD_UNLOCK and set(ai) <= {"task", "claude", "claude_available"}
    assert set(W.REASONS) == set(W.MAPPING_WORDS["wizard"]) and set(W.WIZARD_STATES) == set(W.MAPPING_WORDS["wizard_state"])
    # The gate refuses a word that isn't on the list, and no top-level key is new.
    for bad in ({"mapping": {"stuck": "Nicole's Office"}}, {"mapping": {"wizard": "offer"}}, {"ai": {"claude": "opus-5-5"}},
                {"ai": {"claude_available": "ai_task.x"}}):
        q = json.loads(text)
        q["env"].update(bad)
        with pytest.raises(ValueError):
            T.assert_shareable(q)
    assert "mapping" not in T._TOP_KEYS and "ai_wizard" not in T._TOP_KEYS


def test_claude_is_said_whatever_the_master_switch(monkeypatch):
    from custom_components.padspan_ha import plan_ai as A
    h = _stuck_house()
    h.data[DOMAIN][DATA_SETTINGS].data["ai_plans_enabled"] = False
    monkeypatch.setattr(A, "unlock", lambda _h: {"ok": False, "why": "below_opus_5_5"})
    monkeypatch.setattr(A, "claude_unchosen", lambda _h: True)
    assert T.build_payload(h)["env"]["ai"] == {"claude": "below_opus_5_5", "claude_available": "yes"}
    monkeypatch.setattr(A, "unlock", lambda _h: {"ok": True, "why": "ok", "family": "opus"})
    assert T.build_payload(h)["env"]["ai"] == {"claude": "opus"}


def test_wizard_words():
    assert W.wizard_state({}, _NOW) == "never"
    assert W.wizard_state({"started": {"at": "connect"}}, _NOW) == "left_connect"
    assert W.wizard_state({"started": {"at": "elsewhere"}}, _NOW) == "opened"
    assert W.wizard_state({"snooze_until": _NOW + 5}, _NOW) == "snoozed"
    assert W.wizard_state({"dismissed": True, "undone": True}, _NOW) == "undone"
    today = date(2026, 11, 10)
    assert [W.done_age_word(d, today) for d in ("2026-11-04", "2026-11-03", "2026-10-11", "2026-10-10", "bad")] == ["lt7d", "7_30d", "7_30d", "gt30d", None]
    for s in W.WIZARD_STATES:
        assert len(s) <= 40


# ═══ the Plans tool's walls ═══════════════════════════════════════════════════

def test_the_plans_tool_counts_are_closed_each_has_a_call_site_and_a_plain_name():
    js = (_VIEWS / "live_aboard_plans.js").read_text(encoding="utf-8")
    ib = (_VIEWS / "installbase.js").read_text(encoding="utf-8")
    for e in T.PLANS_TOOL_EVENTS:
        assert T.event_allowed(e) and len(e) <= 64, e
        fam, _, val = e.partition(":")
        if fam == "plans_tab":
            assert "count(`plans_tab:${m}`)" in js and f'["{val}", ' in js, e
        else:
            assert f'"{e}"' in js, e
        assert f'a === "{fam}"' in ib, fam
        assert fam == "plans_tool" or re.search(rf"\b{val}: \"", ib), e
    for e in re.findall(r'count\("([a-z_]+:[a-z0-9_]+)"', js):
        assert e in T.PLANS_TOOL_EVENTS, e
    assert not T.event_allowed("plans_floor:s3") and not T.event_allowed("plans_tab:Basement")


def test_the_install_base_names_every_new_word():
    ib = (_VIEWS / "installbase.js").read_text(encoding="utf-8")
    block = ib[ib.index("const W_MAPPING = {"):ib.index("\n};", ib.index("const W_MAPPING = {"))]
    steps = ib[ib.index("const W_WIZARD_STEP = {"):ib.index("};", ib.index("const W_WIZARD_STEP = {"))]
    unlock = ib[ib.index("const W_UNLOCK = {"):ib.index("};", ib.index("const W_UNLOCK = {"))]
    for field, words in W.MAPPING_WORDS.items():
        assert re.search(rf"\b{field}: ", block), field
        for w in words:
            if field == "wizard_state" and w.startswith("left_"):
                assert re.search(rf'\b{w[5:]}: "', steps), w
            else:
                assert re.search(rf'(\b{w}|"{w}"): "', block), (field, w)
    for w in T.PLAN_BUILD_UNLOCK:
        assert re.search(rf"\b{w}: \"", unlock), w
    assert "claude_available: {" in block and "yes:" in block
    assert 'section("Getting to a map"' in ib and '"mapping",' in ib


# ═══ the setting ══════════════════════════════════════════════════════════════

def _set(h, admin=True, **kw):
    conn = MagicMock()
    conn.user = MagicMock(is_admin=admin)
    _run(WS.ws_settings_set(h, conn, {"id": 1, **kw}))
    return conn, h.data[DOMAIN][DATA_SETTINGS].data


def test_the_setting_is_empty_by_default_and_the_wire_takes_it():
    assert DEFAULT_SETTINGS["ai_map_wizard"] == {}
    sch = WS.ws_settings_set.ws_schema
    assert any(str(getattr(k, "schema", k)) == "ai_map_wizard" for k in sch)


def test_only_an_administrator_writes_it_and_only_its_own_keys_stay():
    h = _house()
    conn, data = _set(h, admin=False, ai_map_wizard={"dismissed": True})
    assert conn.send_error.call_args[0][1] == "unauthorized" and "ai_map_wizard" not in data
    conn, data = _set(h, ai_map_wizard={"dismissed": True, "snooze_until": 123.5, "snoozes": 2, "finished_day": "2026-11-10",
                                         "started": {"at": "rooms_check", "map_id": "m1", "extra": "x"}, "name": "Nicole's Office",
                                         "undone": "yes"})
    assert not conn.send_error.called
    assert data["ai_map_wizard"] == {"dismissed": True, "snooze_until": 123.5, "snoozes": 2, "finished_day": "2026-11-10",
                                     "started": {"at": "rooms_check", "map_id": "m1"}}
    assert W.clean_wizard({"finished_day": "10 Nov", "started": {"at": "Kitchen"}}) == {"started": {"at": "intro"}}


# ═══ the Python copies hold to the JavaScript ones ════════════════════════════

_SETUP_BATTERY = [
    {"maps": {"list": []}, "model": {}, "calibration": {}},
    {"maps": {"list": [{"id": "m1", "receivers": [], "room_bounds": {}}]}, "model": {}, "calibration": {}},
    {"maps": {"list": [{"id": "m1", "receivers": [{"id": "r1"}], "room_bounds": {}}]}, "model": {}, "calibration": {}},
    {"maps": {"list": [{"id": "m1", "receivers": [], "room_bounds": {"Kitchen": {"points": []}}}]}, "model": {}, "calibration": {}},
    {"maps": {"list": [{"id": "m1"}]}, "model": {"room_geometry_m": {"Kitchen": {}}}, "calibration": {}},
    {"maps": {"list": [{"id": "m1"}]}, "model": {"map_transforms": {"m1": {"reference_measurements": [{}]}}}, "calibration": {}},
    {"maps": {"list": [{"id": "m1"}]}, "model": {"map_transforms": {"m1": {"reference_measurements": []}, "m2": {}}}, "calibration": {}},
    {"maps": {"list": []}, "model": {}, "calibration": {"points": [1, 2, 3, 4, 5]}},
    {"maps": {"list": []}, "model": {}, "calibration": {"points": [1, 2, 3, 4]}},
    {"maps": {"list": []}, "model": {}, "calibration": {"model": {"a": 1}}},
    {"maps": {"list": []}, "model": {"scanner_positions_m": {"s1": [0, 0]}}, "calibration": {"points": [1, 2, 3, 4]}},
    {"maps": {"list": [{"id": "m1", "receivers": [{"id": "r1"}], "room_bounds": {"Kitchen": {}}}]},
     "model": {"room_geometry_m": {"Kitchen": {}}, "map_transforms": {"m1": {"reference_measurements": [{}]}}},
     "calibration": {"points": [1, 2, 3, 4, 5]}},
]
_TRIAL_BATTERY = [{"pro_has_key": k, "tier": t} for k in (False, True, None) for t in ("free", "bright", "pro", "", "gold")]


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_python_copies_answer_as_setup_status_and_trial_offer_do(tmp_path):
    bat = tmp_path / "battery.json"
    bat.write_text(json.dumps({"setup": _SETUP_BATTERY, "trial": _TRIAL_BATTERY}), encoding="utf-8")
    res = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "ai_wizard_parity.mjs"), str(_VIEWS), str(bat)],
                         capture_output=True, text=True, encoding="utf-8", timeout=60)
    lines = [ln for ln in res.stdout.splitlines() if ln.startswith("{")]
    assert lines, res.stderr[-2000:]
    js = json.loads(lines[-1])
    py = {"hasMaps": W.has_maps, "hasReceivers": W.has_receivers, "hasFabricRooms": W.has_fabric_rooms,
          "hasRooms": W.has_rooms, "hasScale": W.has_scale, "hasCalibration": W.has_calibration}
    for state, want in zip(_SETUP_BATTERY, js["setup"]):
        assert {k: fn(state) for k, fn in py.items()} == want, state
    for settings, want in zip(_TRIAL_BATTERY, js["trial"]):
        # The panel's pro_has_key: false only when the server said there is no key.
        assert W.trial_offerable(settings["pro_has_key"] is not False, settings["tier"]) == want, settings
    assert len(js["setup"]) == len(_SETUP_BATTERY) and len(js["trial"]) == len(_TRIAL_BATTERY)


def test_the_report_reads_setup_through_the_ported_checks():
    """stuck_word is built from the ported checks, one rule for the rule and the report."""
    s = _SETUP_BATTERY[-1]
    assert W.stuck_word(s) == "none" and W.stuck_word(_SETUP_BATTERY[1]) == "plan_no_rooms"
    assert W.stuck_word(_SETUP_BATTERY[3]) == "rooms_no_receivers"


# ═══ the fleet summary ════════════════════════════════════════════════════════

def test_the_summary_s_words_are_the_integration_s_and_it_splits_the_stuck_by_day():
    import importlib.util
    spec = importlib.util.spec_from_file_location("telemetry_summary", _ROOT / "server" / "telemetry_summary.py")
    S = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(S)
    assert S._STUCK_WORDS == W.STUCK_WORDS and set(S._MAPPING_FUNNEL) == T.PLANS_TOOL_EVENTS
    assert set(S._WIZARD_FUNNEL) == T.AI_WIZARD_EVENTS and len(S._WIZARD_FUNNEL) == len(T.AI_WIZARD_EVENTS)
    assert S._WIZ_STEPS == W.WIZARD_STEPS
    rep =lambda iid, env, usage=None: {"install_id": iid, "day": "2026-11-10", "env": env, "usage": usage or {}}  # noqa: E731
    rows = {("a", "2026-11-09"): rep("a", {"mapping": {"stuck": "plan_no_rooms", "wizard": "no_scale"}, "ai": {"claude": "no_ai_task"}}),
            ("a", "2026-11-10"): rep("a", {"mapping": {"stuck": "rooms_no_receivers", "wizard": "has_rooms"}}),
            ("b", "2026-11-10"): rep("b", {"mapping": "not a dict"}), ("c", "2026-11-10"): rep("c", {})}
    out = "\n".join(S.mapping_section(rows, [rep("a", {}, {"plans_tool:opened": 3, "tab:maps": 9, "ai_wizard_step:rooms_read": 2})]))
    assert re.search(r"ai_wizard_step:rooms_read\s+2\s+1 installs", out) and "ai_wizard_step:intro" not in out
    assert re.search(r"2026-11-09\s+1\s+0\s+0\s+0", out) and re.search(r"2026-11-10\s+0\s+1\s+0\s+0", out)
    assert "has_rooms 1" in out and re.search(r"plans_tool:opened\s+3\s+1 installs", out) and "tab:maps" not in out
    assert S.mapping_section({}, []) == ["Getting to a map: no install has sent env.mapping yet"]
