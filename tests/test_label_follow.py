# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A name that follows a rotating address, on screen only (label_follow.py).

Garry, 2026-11-02, on the two options for a named device whose address rotates:
"Find a better way, none of these options is acceptable." The rule: evidence
before a link, a question when it falls one short, and a wrong link that can't
touch anything stored. Each rule has its test here, the forced wrong link last.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.padspan_ha import label_follow as LF
from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_objects as WO
from custom_components.padspan_ha.const import (
    DATA_CALIBRATION,
    DATA_DEVICE_REGISTRY,
    DATA_MODEL,
    DATA_OBJECT_HISTORY,
    DATA_OBJECTS,
    DATA_SETTINGS,
    DOMAIN,
)
from custom_components.padspan_ha.merge_guard import MergeGuard
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator
from custom_components.padspan_ha.private_ble_resolver import PrivateBLEResolver

A, B, C = "4A:00:00:00:00:01", "5B:00:00:00:00:02", "6C:00:00:00:00:03"
PLACE = {"kit": -50.0, "off": -70.0, "hall": -82.0}
ELSEWHERE = {"kit": -90.0, "off": -60.0, "hall": -55.0}
NOON = 1_800_000_000.0
_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"


def _iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class Air:
    """What the radios hear, poll by poll. heard() says an address sounded now."""

    def __init__(self, watched=(A), claimed=None, proven=None, state=None) -> None:
        self.t = NOON
        self.links = LF.LabelLinks(state)
        self.watched = {a: None for a in ([watched] if isinstance(watched, str) else watched)}
        self.claimed = set(self.watched) if claimed is None else set(claimed)
        self.proven = set(proven or ())
        self.heard_at: dict[str, tuple[float, dict]] = {}
        self.events: list[str] = []

    def heard(self, addr, place=PLACE, name="My Car", md=None, sd=None, su=None, kind=None) -> None:
        rec = {"address": addr, "name": name if name else addr, "manufacturer_data": md or {},
               "service_data": sd or {}, "service_uuids": su or []}
        if kind:
            rec["address_type"] = kind
        self.heard_at[addr] = (self.t, {"rec": rec, "place": dict(place)})

    def poll(self, dt=0.0) -> list[str]:
        self.t += dt
        records = {}
        for addr, (ts, entry) in self.heard_at.items():
            age = self.t - ts
            records[addr] = {**entry["rec"], "age_s": age, "last_seen": _iso(ts),
                             "sources": {s: {"rssi": r, "age_s": age} for s, r in entry["place"].items()}}
        out = self.links.step(self.t, records, self.watched, proven=self.proven, claimed=self.claimed)
        self.events += out
        return out

    def run(self, seconds, step=10.0, each=None) -> None:
        end = self.t + seconds
        while self.t < end:
            if each:
                each()
            self.poll(step)


def _hand_over(air: Air, new=B, old=A, **kw) -> None:
    """The old address is heard a while, stops, and the new one starts at once."""
    old_kw = kw.pop("old_kw", {})
    air.poll()
    air.run(30, each=lambda: air.heard(old, **old_kw))
    air.heard(new, **kw)
    air.run(400, each=lambda: air.heard(new, **kw))


# ── Rule 1: evidence, every piece of it ─────────────────────────────────────

def test_all_the_evidence_links_the_name() -> None:
    air = Air()
    _hand_over(air)
    assert air.links.current(A) == B
    assert air.events.count("label_link_linked") == 1
    assert air.links.links[A]["path"][0]["by"] == "evidence"


def test_the_name_it_sent_outlives_the_advert_that_carried_it() -> None:
    air = Air()
    air.poll()
    air.heard(A)
    air.poll(5.0)
    air.heard(A, name="")
    air.poll(5.0)
    air.heard(B)
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == B


def test_its_last_report_being_one_far_receivers_doesnt_lose_the_others() -> None:
    """Seen on the house's recording: an address's very last report came from one
    receiver, and the pattern from the receivers before it was thrown away."""
    air = Air()
    air.poll()
    air.heard(A)
    air.poll(5.0)
    air.t += 90.0                         # the others have aged out by now
    air.heard(A, place={"hall": -82.0})
    air.poll(5.0)
    air.heard(B)
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == A      # over a minute later it doesn't count: that's its own moment
    late = Air()
    late.poll()
    late.heard(A)
    late.poll(5.0)
    late.t += 40.0
    late.heard(A, place={"hall": -82.0})
    late.poll(5.0)
    late.heard(B)
    late.run(400, each=lambda: late.heard(B))
    assert late.links.current(A) == B


def test_a_distinctive_payload_counts_as_the_name_does() -> None:
    air = Air()
    payload = {"224": "0x01 0x36 0xCA 0x50 0xD8 0xF0"}
    _hand_over(air, name="", md=payload, old_kw={"name": "", "md": payload})
    assert air.links.current(A) == B


@pytest.mark.parametrize("payload", ["0x00 0x00 0x00 0x00 0x00 0x00 0x00", "0x12 0x02 0x00", "0x01 0x01 0x01 0x01 0x02 0x02"])
def test_a_payload_that_cant_tell_two_devices_apart_is_no_evidence(payload) -> None:
    air = Air()
    md = {"224": payload}
    _hand_over(air, name="", md=md, old_kw={"name": "", "md": md})
    assert air.links.current(A) == A


def test_apple_bytes_are_never_a_fingerprint() -> None:
    assert LF.distinctive_payloads({"manufacturer_data": {"76": "0x10 0x05 0xAA 0xBB 0xCC 0xDD 0xEE"}}) == {}


@pytest.mark.parametrize("name", ["4", "48:88:88:1A:89:D0", "A1B2C3D4", "Unknown", "BLE", "  "])
def test_a_fragment_or_an_address_is_no_name(name) -> None:
    assert LF.real_name({"name": name}) == ""


def test_the_old_address_must_have_stopped() -> None:
    air = Air()
    air.poll()

    def both():
        air.heard(A)
        air.heard(B)
    air.run(600, each=both)
    assert air.links.current(A) == A and not air.links.asks


def test_a_new_address_heard_long_before_the_old_one_stopped_doesnt_fit() -> None:
    air = Air()
    air.poll()
    air.heard(B)
    air.run(120, each=lambda: air.heard(A))
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == A


def test_a_gap_over_the_limit_is_no_link_but_a_question() -> None:
    air = Air()
    air.poll()
    air.run(30, each=lambda: air.heard(A))
    air.run(LF.GAP_S + 60, step=10.0)
    air.heard(B)
    air.poll(1.0)
    air.run(60, each=lambda: air.heard(B))
    assert air.links.current(A) == A
    assert air.links.asks[A]["a"] == B and air.links.asks[A]["why"] == "gap"


def test_another_name_is_nothing_at_all_when_makers_differ() -> None:
    air = Air()
    _hand_over(air, name="Other", md={"224": "0x01"})
    assert air.links.current(A) == A and not air.links.asks


def test_a_different_maker_isnt_linked_or_asked_about() -> None:
    air = Air()
    _hand_over(air, md={"224": "0x01"}, old_kw={"md": {"117": "0x01"}})
    assert air.links.current(A) == A and not air.links.asks


def test_a_different_kind_of_apple_message_isnt_either() -> None:
    air = Air()
    _hand_over(air, md={"76": "0x10 0x05"}, old_kw={"md": {"76": "0x12 0x02"}})
    assert air.links.current(A) == A and not air.links.asks


def test_receivers_that_disagree_make_a_question_not_a_link() -> None:
    air = Air()
    _hand_over(air, place=ELSEWHERE)
    assert air.links.current(A) == A
    assert air.links.asks[A]["why"] == "place" and air.events.count("label_link_asked") == 1


def test_one_receiver_is_no_pattern() -> None:
    """At the house, with name and payload hidden, one receiver got 2 right and 13 wrong."""
    air = Air()
    one = {"kit": -50.0}
    _hand_over(air, place=one, old_kw={"place": one})
    assert air.links.current(A) == A and air.links.asks[A]["why"] == "place"


def test_two_receivers_are_a_pattern() -> None:
    air = Air()
    two = {"kit": -50.0, "off": -70.0}
    _hand_over(air, place=two, old_kw={"place": two})
    assert air.links.current(A) == B


def test_two_that_fit_link_neither_and_ask_nothing() -> None:
    air = Air()
    air.poll()
    air.run(30, each=lambda: air.heard(A))

    def both():
        air.heard(B)
        air.heard(C)
    both()
    air.run(400, each=both)
    assert air.links.current(A) == A and not air.links.asks


def test_two_named_devices_stopping_together_leave_the_new_one_with_neither() -> None:
    """Exactly one, from both sides: either could be the one that moved."""
    other = "4F:00:00:00:00:09"
    air = Air(watched=[A, other])
    air.poll()

    def both():
        air.heard(A)
        air.heard(other)
    air.run(30, each=both)
    air.heard(B)
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == A and air.links.current(other) == other


@pytest.mark.parametrize("later", [3.0, 5.0, 20.0, 60.0])
def test_two_named_devices_stopping_seconds_apart_leave_the_new_one_with_neither(later) -> None:
    """Whichever stopped first used to link at once: the other didn't count until
    it had been silent for 90 s."""
    other = "4F:00:00:00:00:09"
    air = Air(watched=[A, other])
    air.poll()

    def both():
        air.heard(A)
        air.heard(other)
    air.run(30, each=both)
    air.t += later
    air.heard(other)
    air.heard(B)
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == A and air.links.current(other) == other


def test_another_named_device_still_on_the_air_doesnt_stop_the_link() -> None:
    other = "4F:00:00:00:00:09"
    air = Air(watched=[A, other])
    air.poll()

    def both():
        air.heard(A)
        air.heard(other)
    air.run(30, each=both)
    air.heard(B)

    def on_air():
        air.heard(B)
        air.heard(other)
    air.run(400, each=on_air)
    assert air.links.current(A) == B and air.links.current(other) == other


def test_an_address_one_device_is_using_isnt_a_candidate_for_another() -> None:
    other = "4F:00:00:00:00:09"
    air = Air(watched=[A, other], state={"links": {other: {"path": [{"a": B, "by": "you", "ts": NOON}]}}})
    _hand_over(air)
    assert air.links.current(A) == A and air.links.current(other) == B


def test_the_question_goes_when_the_two_are_heard_at_once() -> None:
    air = Air()
    _weak(air)
    assert air.links.asks[A]["a"] == B
    md = {"76": "0x10 0x05 0x01"}

    def both():
        air.heard(A, name="", md=md)
        air.heard(B, name="", md=md)
    air.run(30, each=both)
    assert A not in air.links.asks and B in air.links.refused[A]


def _asked_then_stopped(air: Air) -> None:
    """A question open on B, then B stops too."""
    air.poll()
    air.run(30, each=lambda: air.heard(A))
    air.heard(B, place=ELSEWHERE)
    air.run(280, each=lambda: air.heard(B, place=ELSEWHERE))
    assert air.links.asks[A]["a"] == B
    air.run(160)


def test_the_question_closes_when_the_old_address_comes_back() -> None:
    """It stayed open for days with the device live, and it isn't a No: B isn't refused."""
    air = Air()
    _asked_then_stopped(air)
    air.heard(A)
    air.poll(5)
    assert A not in air.links.asks and B not in air.links.refused.get(A, [])
    assert not air.links.answer(A, B, True, air.t), "there is nothing left to say Yes to"
    air.run(60, each=lambda: air.heard(A))
    assert air.links.current(A) == A and "label_link_old_back" not in air.events
    assert B not in air.links.refused.get(A, [])


def test_a_stopped_address_with_an_old_stamp_doesnt_close_the_question() -> None:
    air = Air()
    _asked_then_stopped(air)
    air.run(600)
    assert air.links.asks[A]["a"] == B, "the old address has said nothing since it was asked"


def test_a_question_nobody_answered_goes_after_a_week() -> None:
    air = Air()
    _asked_then_stopped(air)
    air.t += LF.ASK_MAX_GAP_S + 1
    air.poll()
    assert A not in air.links.asks


def test_the_question_goes_when_its_address_is_named() -> None:
    air = Air()
    _weak(air)
    air.claimed.add(B)
    air.poll(1.0)
    assert A not in air.links.asks


@pytest.mark.parametrize("kind,addr,follows", [
    ("public", "5B:00:00:00:00:02", False),      # the radio's word beats the shape
    ("random", "CB:00:00:00:00:02", True),       # the radio's word for one not rotating-shaped
    (None, "5B:00:00:00:00:02", True),           # nobody said, and it is rotating-shaped
    (None, "CB:00:00:00:00:02", False),          # nobody said, and it isn't
])
def test_only_a_random_or_rotating_shaped_address_takes_part(kind, addr, follows) -> None:
    air = Air()
    _hand_over(air, new=addr, kind=kind)
    assert (air.links.current(A) == addr) is follows


def test_a_proven_or_named_address_is_never_a_candidate() -> None:
    for kw in ({"proven": {B}}, {"claimed": {A, B}}):
        air = Air(**kw)
        _hand_over(air)
        assert air.links.current(A) == A and not air.links.asks


def test_after_a_restart_nothing_on_the_air_looks_new() -> None:
    air = Air()
    air.heard(A)
    air.heard(B)
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == A


def test_the_name_goes_on_along_the_chain_and_stays_stored_on_the_first_address() -> None:
    air = Air()
    _hand_over(air)
    air.run(30, each=lambda: air.heard(B))
    air.heard(C)
    air.run(400, each=lambda: air.heard(C))
    assert air.links.current(A) == C
    assert [p["a"] for p in air.links.links[A]["path"]] == [B, C]


def test_it_costs_nothing_when_nobody_is_watched() -> None:
    links = LF.LabelLinks()
    assert links.step(NOON, {A: {"address": A, "age_s": 1.0}}, {}) == []
    assert links.first_heard == {}


# ── Rule 3: ask instead of guess ────────────────────────────────────────────

def _weak(air: Air) -> None:
    """Same maker, kind, moment and place; nothing to compare it by."""
    md = {"76": "0x10 0x05 0x01"}
    _hand_over(air, name="", md=md, old_kw={"name": "", "md": md})


def _crowded(monkeypatch, budget, watched=5, others=50) -> Air:
    """Devices that each stop and start again on a new address, among others."""
    monkeypatch.setattr(LF, "SCAN_BUDGET", budget)
    olds = [f"4A:00:00:00:01:{i:02X}" for i in range(watched)]
    air = Air(watched=olds)
    air.poll()

    def all_old():
        for i, old in enumerate(olds):
            air.heard(old, name=f"Device {i}")
        for i in range(others):
            air.heard(f"7A:00:00:00:02:{i:02X}", name=f"Stranger {i}")
    air.run(30, each=all_old)
    return air


def _start_new(air: Air, watched=5) -> dict:
    news = {f"4A:00:00:00:01:{i:02X}": f"5B:00:00:00:03:{i:02X}" for i in range(watched)}

    def all_new():
        for i, new in enumerate(news.values()):
            air.heard(new, name=f"Device {i}")
    all_new()
    air.run(10, each=all_new)
    return news, all_new


def test_under_the_cap_nothing_waits_or_is_counted(monkeypatch) -> None:
    air = _crowded(monkeypatch, LF.SCAN_BUDGET)
    news, more = _start_new(air)
    air.run(200, each=more)
    assert all(air.links.current(o) == n for o, n in news.items())
    assert "label_link_capped" not in air.events


def test_at_the_cap_the_walks_are_bounded_and_counted(monkeypatch) -> None:
    """One walk a poll: the poll stays bounded, and it's said in the report."""
    air = _crowded(monkeypatch, 60)
    walks: list[int] = []
    real = LF.LabelLinks._may_walk

    def counted(self, root, records):
        ok = real(self, root, records)
        walks.append(ok)
        return ok
    monkeypatch.setattr(LF.LabelLinks, "_may_walk", counted)
    _start_new(air)
    air.t += 100
    del walks[:]
    capped = air.events.count("label_link_capped")
    air.poll(10)
    assert sum(walks) == 1 and len(walks) > 1
    assert air.events.count("label_link_capped") == capped + 1, "once a poll, however many waited"


def test_at_the_cap_every_device_gets_its_turn_and_still_links(monkeypatch) -> None:
    """Late, never wrong: one walk a poll and all five land inside the window."""
    air = _crowded(monkeypatch, 60)
    news, more = _start_new(air)
    air.run(200, each=more)
    assert all(air.links.current(o) == n for o, n in news.items())
    assert "label_link_capped" in air.events


def test_a_list_bigger_than_the_cap_still_gets_a_walk_each_poll(monkeypatch) -> None:
    air = _crowded(monkeypatch, 5)
    news, more = _start_new(air)
    air.run(200, each=more)
    assert all(air.links.current(o) == n for o, n in news.items())


def test_good_evidence_with_no_name_is_a_question() -> None:
    air = Air()
    _weak(air)
    assert air.links.current(A) == A
    assert air.links.asks[A] == {"a": B, "why": "weak", "ts": air.links.asks[A]["ts"]}


def test_no_data_at_all_isnt_even_a_question() -> None:
    air = Air()
    _hand_over(air, name="", old_kw={"name": ""})
    assert not air.links.asks


def test_yes_is_the_persons_link_for_that_link() -> None:
    air = Air()
    _weak(air)
    assert air.links.answer(A, B, True, air.t) is True
    assert air.links.current(A) == B and air.links.links[A]["path"][-1]["by"] == "you"
    assert A not in air.links.asks


def test_no_is_remembered_and_stops_asking() -> None:
    air = Air()
    _weak(air)
    assert air.links.answer(A, B, False, air.t) is True
    asked = air.events.count("label_link_asked")
    air.run(600, each=lambda: air.heard(B, name="", md={"76": "0x10 0x05 0x01"}))
    assert A not in air.links.asks and B in air.links.refused[A]
    assert air.events.count("label_link_asked") == asked


def test_after_a_yes_on_an_address_long_gone_the_next_one_is_still_asked_about() -> None:
    """A car wakes for 20 seconds, hours apart. The person answers long after the
    address it asked about stopped, and the next wake must not fall silent."""
    air = Air()
    air.watched = {A: {"name": "My Car", "_last_seen_ts": NOON - 3600.0, "_cache_age_s": 0.0, "address": A}}
    air.poll()
    air.poll(10.0)
    air.heard(B)
    air.poll(5.0)
    assert air.links.asks[A]["a"] == B and air.links.asks[A]["why"] == "gap"
    air.t += 7200.0
    del air.heard_at[B]
    assert air.links.answer(A, B, True, air.t) is True
    air.poll(600.0)
    air.heard(C)
    air.poll(5.0)
    assert air.links.asks[A]["a"] == C and air.links.current(A) == B


def test_only_the_question_on_the_table_can_be_answered() -> None:
    air = Air()
    _weak(air)
    assert air.links.answer(A, C, True, air.t) is False
    assert air.links.answer(C, B, True, air.t) is False
    assert air.links.current(A) == A


# ── Rule 4: the pointer to the real fix ─────────────────────────────────────

def _row(addr, **kw) -> dict:
    return {"key": f"ble:{addr}", "kind": "ble", "address": addr, "name": addr, "rssi": -80, "age_s": 500.0, **kw}


def test_the_pointer_comes_with_the_third_move_and_dismisses_for_good() -> None:
    links = LF.LabelLinks({"moves": {A: LF.HINT_AFTER - 1}})
    rows = [_row(A, user_label="My Car")]
    assert not links.shows_anything()
    assert "irk_hint" not in LF.overlay(rows, links)[0]
    links.moves[A] = LF.HINT_AFTER
    assert LF.overlay(rows, links)[0]["irk_hint"] is True
    links.dismiss_hint(A)
    again = LF.LabelLinks(links.to_state())
    assert "irk_hint" not in LF.overlay(rows, again)[0]


def test_the_pointer_is_for_a_named_device() -> None:
    links = LF.LabelLinks({"moves": {A: 9}})
    assert "irk_hint" not in LF.overlay([_row(A)], links)[0]


def test_it_points_at_the_existing_private_ble_help() -> None:
    src = (_WWW / "views" / "device_name.js").read_text(encoding="utf-8")
    assert 'act.showHelp("private_ble")' in src
    assert "private_ble: {" in (_WWW / "help_content.js").read_text(encoding="utf-8")


# ── Rule 5: undo ────────────────────────────────────────────────────────────

def test_undo_puts_the_name_back_and_the_address_isnt_linked_again() -> None:
    air = Air()
    _hand_over(air)
    assert air.links.undo(A, air.t) is True
    assert air.links.current(A) == A
    air.run(30, each=lambda: air.heard(A))
    air.heard(B)
    air.run(400, each=lambda: air.heard(B))
    assert air.links.current(A) == A and A not in air.links.asks
    assert air.links.undo(A, air.t) is False


def test_undone_and_then_both_heard_at_once_is_proved_wrong_once() -> None:
    air = Air()
    _hand_over(air)
    air.links.undo(A, air.t)

    def both():
        air.heard(A)
        air.heard(B)
    air.run(120, each=both)
    assert air.events.count("label_link_wrong_after_undo") == 1


def test_the_old_address_back_ends_the_link_by_itself() -> None:
    air = Air()
    _hand_over(air)
    # One fresh-looking report isn't enough: HA replays cached history.
    air.heard(A)
    air.poll(1.0)
    assert air.links.current(A) == B
    air.heard(A)
    air.poll(1.0)
    assert air.links.current(A) == A
    assert air.events.count("label_link_old_back") == 1 and B in air.links.refused[A]


def test_taking_the_name_away_ends_its_links_and_answers() -> None:
    air = Air()
    _hand_over(air)
    air.links.refused[A] = [C]
    air.watched = {}
    air.poll()
    assert not air.links.links and A not in air.links.refused


def test_an_address_someone_named_since_ends_the_link() -> None:
    air = Air()
    _hand_over(air)
    air.claimed.add(B)
    air.poll()
    assert air.links.current(A) == A


# ── A restart ───────────────────────────────────────────────────────────────

def test_links_questions_and_answers_survive_a_restart() -> None:
    air = Air()
    _hand_over(air)
    air.links.refused[A] = [C]
    air.links.asks[A] = {"a": C, "why": "gap", "ts": air.t}
    air.links.dismiss_hint(A)
    back = LF.LabelLinks(json.loads(json.dumps(air.links.to_state())))
    assert back.current(A) == B and back.links[A]["path"][0]["by"] == "evidence"
    assert back.asks[A]["a"] == C and back.refused[A] == [C] and A in back.hint_off


@pytest.mark.parametrize("state", [None, {}, {"links": "x", "asks": 3, "refused": [], "moves": None},
                                   {"links": {A: {"path": []}}}, {"links": {A: "x"}}])
def test_a_bad_file_starts_empty(state) -> None:
    links = LF.LabelLinks(state)
    assert links.links == {} and links.asks == {}


# ── Rule 2: the screen, and only the screen ─────────────────────────────────

def _linked(by="evidence") -> LF.LabelLinks:
    return LF.LabelLinks({"links": {A: {"path": [{"a": B, "by": by, "ts": NOON}]}}})


def test_the_screen_gets_one_row_with_the_new_signal_and_the_old_identity() -> None:
    rows = [_row(A, user_label="My Car", padspan_id="ps_a", all_addresses=[A], room="", away=True, last_room="Garage"),
            _row(B, rssi=-55, age_s=2.0, room="Kitchen", x_m=1.0, y_m=2.0, floor_id="main", padspan_id="ps_b",
                 sources=[{"source": "kit", "rssi": -55, "age_s": 2.0}])]
    shown = LF.overlay(rows, _linked())
    assert [r["key"] for r in shown] == [f"ble:{A}"]
    row = shown[0]
    assert (row["user_label"], row["address"], row["all_addresses"], row["padspan_id"]) == ("My Car", A, [A], "ps_a")
    assert (row["rssi"], row["age_s"], row["room"], row["x_m"]) == (-55, 2.0, "Kitchen", 1.0)
    assert "away" not in row and "last_room" not in row
    assert row["label_link"]["address"] == B and row["label_link"]["by"] == "evidence"


def test_the_overlay_leaves_the_rows_it_was_given_alone() -> None:
    rows = [_row(A, user_label="My Car"), _row(B, age_s=2.0)]
    before = json.dumps(rows, sort_keys=True)
    LF.overlay(rows, _linked())
    assert json.dumps(rows, sort_keys=True) == before


def test_a_linked_address_absorbed_into_a_merged_row_is_still_found() -> None:
    rows = [_row(A, user_label="My Car"), _row(C, age_s=3.0, rssi=-44, all_addresses=[C, B])]
    shown = LF.overlay(rows, _linked())
    assert [r["key"] for r in shown] == [f"ble:{A}"] and shown[0]["rssi"] == -44


def test_with_no_row_for_the_new_address_the_named_row_says_where_it_went() -> None:
    shown = LF.overlay([_row(A, user_label="My Car")], _linked())
    assert shown[0]["label_link"]["address"] == B and shown[0]["rssi"] == -80


def test_the_question_sits_on_the_new_addresss_row() -> None:
    links = LF.LabelLinks({"asks": {A: {"a": B, "why": "gap", "ts": NOON}}})
    shown = {r["key"]: r for r in LF.overlay([_row(A, user_label="My Car"), _row(B)], links)}
    assert shown[f"ble:{B}"]["label_ask"] == {"key": f"ble:{A}", "address": B, "why": "gap", "label": "My Car"}
    # And on the named device's own row: the other can be far down a long list.
    assert shown[f"ble:{A}"]["label_asking"] == {"address": B, "why": "gap"}


def test_nothing_to_show_hands_back_the_very_same_list() -> None:
    rows = [_row(A)]
    assert LF.overlay(rows, LF.LabelLinks()) is rows


class _Labels:
    def __init__(self, labels):
        self.labels = dict(labels)

    def get(self, k):
        return {"label": self.labels[k]} if k in self.labels else None

    def get_label(self, k):
        return self.labels.get(k)

    def all(self):
        return {k: {"label": v} for k, v in self.labels.items()}


class _Registry:
    def __init__(self):
        self.devices: dict = {}

    def resolve(self, key):
        return None

    def get(self, pid):
        return self.devices.get(pid)

    def get_label(self, pid):
        return None

    def get_label_by_key(self, key):
        return None

    def resolve_or_create(self, key, kind="mac", persist=False):
        return "ps_" + hashlib.sha1(str(key).encode()).hexdigest()[:12]

    def all_labeled(self):
        return {}


class _Store:
    def __init__(self):
        self.saved = None

    async def async_load(self):
        return self.saved

    async def async_save(self, data):
        self.saved = data

    def async_delay_save(self, func, delay):
        self.saved = func()


def _ads(addr, place, name, age, now):
    return [{"address": addr, "name": name, "source": s, "rssi": r, "age_s": age, "last_seen": _iso(now - age),
             "manufacturer_data": {}, "service_data": {}, "service_uuids": [], "connectable": None}
            for s, r in place.items()]


def _house(monkeypatch, *, links=None, labels=None, followed=(), points=(), pins=()):
    settings = {"followed_addrs": list(followed), "mac_rotation_bridging": False}
    clock = {"t": NOON}
    hass = SimpleNamespace(data={}, states=SimpleNamespace(async_all=lambda *a: [], get=lambda e: None),
                           config_entries=SimpleNamespace(async_entries=lambda *a: []))
    hass.data[DOMAIN] = {
        DATA_SETTINGS: SimpleNamespace(data=settings, get=lambda k, d=None: settings.get(k, d)),
        DATA_OBJECTS: _Labels({A: "My Car"} if labels is None else labels),
        DATA_DEVICE_REGISTRY: _Registry(),
        DATA_CALIBRATION: SimpleNamespace(data={"points": [dict(p) for p in points], "model": {}}),
        DATA_MODEL: SimpleNamespace(beacon_positions_m=lambda: dict(pins)),
        DATA_OBJECT_HISTORY: {},
        "_obj_hist_store": _Store(),
        SB._LABEL_LINKS: links if links is not None else LF.LabelLinks(),
        SB._LABEL_LINKS_STORE: _Store(),
    }
    live = {"ads": []}
    bl = SimpleNamespace(get_snapshot=lambda max_ads=5000, max_age_s=14400: {
        "radios": [{"source": s, "name": s} for s in PLACE],
        "advertisements": sorted([dict(a) for a in live["ads"]], key=lambda a: a["age_s"]),
        "diag": {"ok": True, "errors": []}})
    resolver = PrivateBLEResolver(hass)

    async def _res(_h):
        return resolver

    async def build(at, ads):
        # Set for each build: two houses in one test share the module.
        monkeypatch.setattr(SB, "get_bluetooth_live", lambda _h: bl)
        monkeypatch.setattr(SB, "_get_ble_resolver", _res)
        monkeypatch.setattr(SB.time, "time", lambda: clock["t"])
        clock["t"] = NOON + at
        live["ads"] = ads
        return await SB._build_live_snapshot(hass)

    async def panel(built):
        conn = MagicMock()

        async def _snap(_h):
            return built

        with patch.object(SB, "_live_snapshot", _snap), \
                patch("custom_components.padspan_ha.perf_sampler.note_snapshot_request", lambda h: None):
            await SB.ws_live_snapshot(hass, conn, {"id": 1})
        return conn.send_result.call_args[0][1]["snapshot"]

    return SimpleNamespace(hass=hass, build=build, panel=panel, clock=clock)


def _stored(hass) -> str:
    """Everything that holds calibration or identity, to the byte."""
    dom = hass.data[DOMAIN]
    return json.dumps({"cal": dom[DATA_CALIBRATION].data, "labels": dom[DATA_OBJECTS].labels,
                       "reg": dom[DATA_DEVICE_REGISTRY].devices, "settings": dom[DATA_SETTINGS].data,
                       "history": dom[DATA_OBJECT_HISTORY]}, sort_keys=True, default=str)


POINTS = [{"id": "p1", "device_id": f"ble:{A}", "map_id": "m", "x_frac": 0.25, "y_frac": 0.5, "source": "auto",
           "scanner_readings": [{"source": "kit", "mean_rssi": -50.5, "std_rssi": 1.5}]}]
BOTH = lambda now: _ads(A, PLACE, "My Car", 900.0, now) + _ads(B, ELSEWHERE, "My Car", 1.0, now)  # noqa: E731


@pytest.mark.asyncio
async def test_a_forced_wrong_link_changes_nothing_the_stores_or_the_presence_poll_see(monkeypatch) -> None:
    """B is another device entirely, in another part of the house. Run the same
    polls with the wrong link and without: what _live_snapshot hands the presence
    poll, and everything stored, must be the same to the byte."""
    def run_points():
        return [dict(p) for p in POINTS]

    plain = _house(monkeypatch, points=run_points())
    wrong = _house(monkeypatch, points=run_points(), links=_linked())
    for at in (0.0, 10.0, 20.0):
        built_plain = await plain.build(at, BOTH(NOON + at))
        built_wrong = await wrong.build(at, BOTH(NOON + at))
        for built in (built_plain, built_wrong):
            built.pop("generated_at", None)
        assert json.dumps(built_wrong["objects"], sort_keys=True, default=str) == \
            json.dumps(built_plain["objects"], sort_keys=True, default=str)
    assert _stored(wrong.hass) == _stored(plain.hass)

    # The panel's copy does change, and the build it came from doesn't.
    before = json.dumps(built_wrong["objects"], sort_keys=True, default=str)
    shown = await wrong.panel(built_wrong)
    rows = {o["key"]: o for o in shown["objects"]["list"]}
    assert rows[f"ble:{A}"]["label_link"]["address"] == B and f"ble:{B}" not in rows
    assert json.dumps(built_wrong["objects"], sort_keys=True, default=str) == before
    assert _stored(wrong.hass) == _stored(plain.hass)


@pytest.mark.asyncio
async def test_a_forced_wrong_link_mixes_nothing_into_an_auto_point(monkeypatch) -> None:
    """presence_coordinator.py:4273, the path a wrong merge could poison: a pinned
    device's point reads every address in all_addresses. It gets the build's row,
    which a link never touches, so B's signal can't get in."""
    house = _house(monkeypatch, links=_linked())
    built = await house.build(0.0, BOTH(NOON))
    row = next(o for o in built["objects"]["list"] if o["key"] == f"ble:{A}")
    assert B not in (row.get("all_addresses") or []) and "label_link" not in row

    hass = MagicMock()
    cal = MagicMock()
    cal.async_add_point = AsyncMock()
    cal.async_prune_auto_points = AsyncMock()
    hass.data = {DOMAIN: {DATA_CALIBRATION: cal, DATA_MODEL: MagicMock()}}
    coord = PresenceCoordinator(hass)
    pinned = {f"ble:{A}": {"room": "Garage", "x_m": 1.0, "y_m": 2.0, "floor_id": "main"}}
    rssi = {A: {"kit": -50.0, "off": -70.0}, B: {"kit": -90.0, "off": -60.0, "hall": -55.0}}
    import time as _t
    for _ in range(12):
        await coord._inject_beacon_calibration(_t.monotonic() + 1e6, pinned, {f"ble:{A}": row}, rssi, {})
    assert cal.async_add_point.await_count >= 1
    point = cal.async_add_point.await_args.args[0]
    assert point["device_id"] == f"ble:{A}"
    assert {r["source"]: set(r["rssi_samples"]) for r in point["scanner_readings"]} == {"kit": {-50.0}, "off": {-70.0}}


def test_nothing_that_stores_or_alerts_reads_a_link() -> None:
    """The separation by construction: who may even name this module."""
    pkg = _ROOT / "custom_components" / "padspan_ha"
    readers = {p.name for p in pkg.glob("*.py")
               if p.name != "label_follow.py"
               and any(w in p.read_text(encoding="utf-8") for w in ("label_follow", "label_links", "label_link", "_label_links"))}
    assert readers == {"snapshot_builder.py", "ws_objects.py", "ws_factory_reset.py", "websocket.py", "telemetry.py", "const.py"}
    for name in ("presence_coordinator.py", "calibration_store.py", "capture_store.py", "adaptive_store.py",
                 "device_registry.py", "object_store.py", "alert_store.py", "movement_store.py", "traceback_store.py",
                 "ws_follow.py", "sensor.py", "device_tracker.py", "ws_calibration.py", "ws_capture.py"):
        src = (pkg / name).read_text(encoding="utf-8")
        assert "label_link" not in src and "label_follow" not in src, name


def test_the_panels_calibration_never_reads_a_link() -> None:
    """Calibration's own capture matches adverts by address and all_addresses in
    the browser, so a link must stay out of those fields and out of that screen."""
    assert "label_link" not in (_WWW / "views" / "calibration.js").read_text(encoding="utf-8")
    src = (_ROOT / "custom_components" / "padspan_ha" / "label_follow.py").read_text(encoding="utf-8")
    fields = src.split("_LIVE_FIELDS = (")[1].split(")")[0]
    for identity in ('"address"', '"all_addresses"', '"key"', '"canonical_id"', '"padspan_id"', '"user_label"', '"identified"'):
        assert identity not in fields


@pytest.mark.asyncio
async def test_a_real_hand_over_through_the_builder_and_the_panel(monkeypatch) -> None:
    """Named A stops, B starts in the same place: the screen has one row by evening,
    the history still holds A with its label, and nothing else was told."""
    house = _house(monkeypatch)
    now = NOON
    for at in (0.0, 10.0, 20.0, 30.0):
        await house.build(at, _ads(A, PLACE, "My Car", 1.0, NOON + at))
    built = None
    for at in range(40, 400, 10):
        built = await house.build(float(at), _ads(A, PLACE, "My Car", at - 30 + 1.0, NOON + at)
                                  + _ads(B, PLACE, "My Car", 1.0, NOON + at))
    links = house.hass.data[DOMAIN][SB._LABEL_LINKS]
    assert links.current(A) == B
    assert {o["key"] for o in built["objects"]["list"]} >= {f"ble:{A}", f"ble:{B}"}
    shown = await house.panel(built)
    rows = {o["key"]: o for o in shown["objects"]["list"]}
    assert f"ble:{B}" not in rows
    assert rows[f"ble:{A}"]["user_label"] == "My Car" and rows[f"ble:{A}"]["age_s"] < 10
    assert rows[f"ble:{A}"]["address"] == A
    assert house.hass.data[DOMAIN][SB._LABEL_LINKS_STORE].saved["links"][A]["path"][0]["a"] == B
    assert now == NOON


def test_named_and_followed_comes_from_all_three_places_and_only_plain_addresses() -> None:
    saved = {"ps_1": {"label": "Bag", "identities": [{"kind": "mac", "value": f"ble:{C}"}]},
             "ps_2": {"label": "Phone", "identities": [{"kind": "irk", "value": "irk:abc"}, {"kind": "mac", "value": "AA:AA:AA:AA:AA:AA"}]},
             "ps_3": {"label": "Tag", "identities": [{"kind": "ibeacon", "value": "ibeacon:u:1:2"}]}}
    dom = {DATA_SETTINGS: SimpleNamespace(data={"followed_addrs": [B.lower(), "IBEACON:U:1:2"]}),
           DATA_OBJECTS: _Labels({A: "My Car", "IBEACON:X:1:2": "Beacon"}),
           DATA_DEVICE_REGISTRY: SimpleNamespace(all_labeled=lambda: saved)}
    assert SB._named_or_followed(dom) == {A, B, C}


@pytest.mark.asyncio
@pytest.mark.parametrize("device,followed_on", [
    ({"manufacturer": "PadSpan HA"}, True),      # its own row in HA: PadSpan quoting itself (HA 2026.8+)
    ({"manufacturer": "Bermuda"}, False),        # another integration knows this address
])
async def test_a_named_devices_own_row_in_ha_isnt_an_identity(monkeypatch, device, followed_on) -> None:
    from custom_components.padspan_ha.device_detail import is_own_device
    if followed_on:
        assert is_own_device(device)
    house = _house(monkeypatch)
    ads = _ads(A, PLACE, "My Car", 1.0, NOON)
    records = {A: {"address": A, "name": "My Car", "age_s": 1.0, "last_seen": _iso(NOON - 1.0),
                   "sources": {a["source"]: {"rssi": a["rssi"], "age_s": 1.0} for a in ads}}}
    links = house.hass.data[DOMAIN][SB._LABEL_LINKS]
    links.links[A] = {"path": [{"a": B, "by": "you", "ts": NOON}]}
    await SB._label_follow_step(house.hass, records, {}, set(), {A: device}, {})
    assert (A in links.links) is followed_on


@pytest.mark.asyncio
async def test_nothing_is_forgotten_while_the_stores_are_still_loading(monkeypatch) -> None:
    house = _house(monkeypatch, links=_linked())
    dom = house.hass.data[DOMAIN]
    labels = dom.pop(DATA_OBJECTS)
    await house.build(0.0, BOTH(NOON))
    assert dom[SB._LABEL_LINKS].current(A) == B
    dom[DATA_OBJECTS] = labels


@pytest.mark.asyncio
@pytest.mark.parametrize("root", ["4A:00:00:00:00:01", "0A:00:00:00:00:01", "CA:00:00:00:00:01"])
async def test_a_restart_keeps_a_link_and_its_answers_whatever_the_address_looks_like(monkeypatch, root) -> None:
    """The first build after a restart reads the history only later on. Until then an
    address off the air that a radio called random, and that isn't rotating-shaped,
    looked unwatched, and its link, No answers and Undo were wiped and saved so."""
    state = {"links": {root: {"path": [{"a": B, "by": "evidence", "ts": NOON - 3600}]}}, "refused": {root: [C]},
             "moves": {root: 2}, "undone": {root: {"a": C, "ts": NOON - 3600}}}
    links = LF.LabelLinks(json.loads(json.dumps(state)))
    house = _house(monkeypatch, links=links, labels={root: "My Car"})
    dom = house.hass.data[DOMAIN]
    del dom[DATA_OBJECT_HISTORY]
    dom["_obj_hist_store"].saved = {f"ble:{root}": {
        "key": f"ble:{root}", "address": root, "kind": "ble", "user_label": "My Car", "address_type": "random",
        "name": "My Car", "_last_seen_ts": NOON - 7200.0, "_cache_age_s": 0.0, "sources": {}}}
    for at in (0.0, 10.0):
        await house.build(at, [])
        assert DATA_OBJECT_HISTORY in dom and links.current(root) == B
        assert links.refused[root] == [C] and links.moves[root] == 2 and links.undone[root]["a"] == C
    assert dom[SB._LABEL_LINKS_STORE].saved is None, "nothing changed, so nothing was saved"


@pytest.mark.asyncio
async def test_the_first_panel_read_after_a_restart_has_the_links(monkeypatch) -> None:
    house = _house(monkeypatch, links=_linked())
    dom = house.hass.data[DOMAIN]
    del dom[DATA_OBJECT_HISTORY]
    del dom[SB._LABEL_LINKS]
    dom[SB._LABEL_LINKS_STORE] = None
    with patch("homeassistant.helpers.storage.Store", lambda *a, **k: SimpleNamespace(
            async_load=AsyncMock(return_value=_linked().to_state()))):
        await house.build(0.0, [])
    assert dom[SB._LABEL_LINKS].current(A) == B


# ── A person's answers, over the websocket ──────────────────────────────────

def _conn():
    sent: dict = {}
    return SimpleNamespace(send_result=lambda i, r: sent.update(result=r),
                           send_error=lambda i, c, m: sent.update(error=c)), sent


@pytest.mark.asyncio
async def test_the_websocket_answers_and_the_report_counts(monkeypatch) -> None:
    links = LF.LabelLinks({"asks": {A: {"a": B, "why": "gap", "ts": NOON}}})
    house = _house(monkeypatch, links=links)
    bumped: list[str] = []
    monkeypatch.setattr(WO, "_bump", lambda h, e, n=1: bumped.append(e))
    monkeypatch.setattr(WO, "_invalidate_snapshot_cache", lambda h: None)
    conn, sent = _conn()
    await WO.ws_label_link_answer(house.hass, conn, {"id": 1, "key": f"ble:{A}", "address": B.lower(), "same": True})
    assert sent["result"]["current"] == B and links.current(A) == B and bumped == ["label_link_yes"]
    conn, sent = _conn()
    await WO.ws_label_link_undo(house.hass, conn, {"id": 2, "key": f"ble:{A}"})
    assert sent["result"]["current"] == A and links.current(A) == A and bumped[-1] == "label_link_undone"
    conn, sent = _conn()
    await WO.ws_label_link_undo(house.hass, conn, {"id": 3, "key": f"ble:{A}"})
    assert sent["error"] == "not_linked"
    conn, sent = _conn()
    await WO.ws_label_link_answer(house.hass, conn, {"id": 4, "key": f"ble:{A}", "address": B, "same": False})
    assert sent["error"] == "not_open"
    conn, sent = _conn()
    await WO.ws_label_link_hint_off(house.hass, conn, {"id": 5, "key": f"ble:{A}"})
    assert A in links.hint_off
    assert house.hass.data[DOMAIN][SB._LABEL_LINKS_STORE].saved["hint_off"] == [A]


# ── Rule 6: Follow joins the guard ──────────────────────────────────────────

def _guard_hass(followed):
    settings = {"followed_addrs": list(followed)}
    hass = SimpleNamespace(data={DOMAIN: {
        DATA_SETTINGS: SimpleNamespace(data=settings, get=lambda k, d=None: settings.get(k, d)),
        DATA_OBJECTS: _Labels({}), DATA_DEVICE_REGISTRY: _Registry(),
        DATA_CALIBRATION: SimpleNamespace(data={"points": []}),
        DATA_MODEL: SimpleNamespace(beacon_positions_m=lambda: {}),
    }})
    return hass


@pytest.mark.parametrize("followed", [A, A.lower(), f"ble:{A}", f"BLE:{A}"])
def test_a_followed_device_is_guarded(followed) -> None:
    assert MergeGuard(_guard_hass([followed]))({"key": f"ble:{A}", "address": A}) is True


def test_anything_else_stays_free() -> None:
    assert MergeGuard(_guard_hass([B]))({"key": f"ble:{A}", "address": A}) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("stronger", [True, False])
async def test_a_followed_device_keeps_its_own_row_every_poll(monkeypatch, stronger) -> None:
    """The review: a followed, unnamed device next to a same-named one had its row
    only some polls. The stronger read 121 of 240, the weaker 0 of 120."""
    a, b = "DA:00:00:00:00:01", "DA:00:00:00:00:02"
    house = _house(monkeypatch, labels={}, followed=[a])
    strong, weak = {"kit": -55.0}, {"kit": -78.0}
    for at in range(0, 200, 10):
        built = await house.build(float(at), _ads(a, strong if stronger else weak, "EX90", 1.0 if at % 20 else 2.0, NOON + at)
                                  + _ads(b, weak if stronger else strong, "EX90", 2.0 if at % 20 else 1.0, NOON + at))
        keys = {o["key"] for o in built["objects"]["list"]}
        assert f"ble:{a}" in keys, at


def test_a_followed_device_can_use_a_link_for_its_row() -> None:
    links = _linked()
    shown = LF.overlay([_row(A), _row(B, age_s=2.0, rssi=-44)], links)
    assert [r["key"] for r in shown] == [f"ble:{A}"] and shown[0]["rssi"] == -44


# ── Rule 7: the report, and what it says to people ──────────────────────────

_EVENTS = ("label_link_linked", "label_link_asked", "label_link_yes", "label_link_no", "label_link_undone",
           "label_link_wrong_after_undo", "label_link_old_back", "label_link_capped")


def test_the_report_has_a_closed_count_for_each_and_a_plain_name() -> None:
    names = (_WWW / "views" / "installbase.js").read_text(encoding="utf-8")
    for event in _EVENTS:
        assert event in T.EVENTS
        assert f"{event}:" in names, event


def test_the_report_carries_counts_and_nothing_identifying() -> None:
    """step()'s events are the fixed names above, never an address or a label."""
    air = Air()
    _hand_over(air)
    air.links.undo(A, air.t)
    for event in air.events:
        assert event in _EVENTS
    assert not any(":" in e for e in _EVENTS)


def test_the_help_says_it_in_all_four_languages() -> None:
    src = (_WWW / "help_content.js").read_text(encoding="utf-8")
    line = next(s for s in src.splitlines() if "This looks like" in s and "t(\"" in s)
    key = json.loads(line.strip().removeprefix("t(").rstrip(",").rstrip(")"))
    for lang in ("de", "fr", "nl"):
        table = json.loads((_WWW / "i18n" / lang / "help.json").read_text(encoding="utf-8"))
        assert table[key] and table[key] != key, lang


def test_the_note_says_what_it_is_in_plain_words() -> None:
    path = _ROOT / "changelog.d" / "label-follow.md"
    if not path.exists():
        pytest.skip("the note is gathered into CHANGELOG.md by the release, and Bright has neither")
    note = path.read_text(encoding="utf-8")
    assert note.startswith("# ") and "on screen" in note.lower() and "calibration" in note.lower()


_NODE = shutil.which("node")


@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_quiet_lines_in_node() -> None:
    r = subprocess.run([_NODE, str(_ROOT / "tests" / "js" / "label_lines.mjs"), str(_ROOT).replace("\\", "/")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr + r.stdout
    assert json.loads(r.stdout.strip().splitlines()[-1])["cases"] >= 8


def test_the_panel_keeps_the_lines_off_walls_and_basic_lists() -> None:
    src = (_WWW / "panel.js").read_text(encoding="utf-8")
    body = src.split("_labelLines(obj, where, after){")[1].split("_showObjectDetail(obj){")[0]
    assert "this.state.kioskMode || (wallScreen(false) && untouchedFor(120000))" in body
    assert 'where === "list" && this.state.complexity === "basic"' in body
