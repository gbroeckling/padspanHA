"""Unit tests for dwell_analytics.py's compute_dwell_stats (gap #4 of the
best-in-class roadmap, docs/BEST_IN_CLASS_ROADMAP.md) — pure aggregation
over TracebackStore-shaped frames, no HA dependency.
"""
from __future__ import annotations

from custom_components.padspan_ha.dwell_analytics import (
    MAX_DWELL_GAP_S,
    compute_dwell_stats,
)


def _frame(ts, objs):
    return {"ts": ts, "o": objs}


def _obj(k, r, **kw):
    return {"k": k, "r": r, **kw}


def test_dwell_credits_the_gap_to_the_room_before_a_change():
    frames = [
        _frame(1000.0, [_obj("a", "Kitchen")]),
        _frame(1010.0, [_obj("a", "Kitchen")]),
        _frame(1020.0, [_obj("a", "Hallway")]),  # changed here
        _frame(1030.0, [_obj("a", "Hallway")]),
    ]
    out = compute_dwell_stats(frames, tz_name="UTC")
    day = out["days"][0]
    dwell = out["dwell"]["a"][day]
    # 1000->1010 (10s) and 1010->1020 (10s) both credited to Kitchen (the
    # room "a" was in for that whole gap); 1020->1030 (10s) to Hallway.
    assert dwell["Kitchen"] == 20.0
    assert dwell["Hallway"] == 10.0


def test_a_room_change_counts_exactly_one_entry_into_the_new_room():
    frames = [
        _frame(1000.0, [_obj("a", "Kitchen")]),
        _frame(1010.0, [_obj("a", "Kitchen")]),
        _frame(1020.0, [_obj("a", "Hallway")]),
    ]
    out = compute_dwell_stats(frames, tz_name="UTC")
    day = out["days"][0]
    entries = out["entries"]["a"][day]
    assert entries == {"Kitchen": 1, "Hallway": 1}, \
        "the very first sighting is an entry too, and staying put is not"


def test_a_gap_longer_than_the_cap_is_an_outage_not_dwell():
    frames = [
        _frame(1000.0, [_obj("a", "Kitchen")]),
        _frame(1000.0 + MAX_DWELL_GAP_S + 1, [_obj("a", "Kitchen")]),
    ]
    out = compute_dwell_stats(frames, tz_name="UTC")
    day = out["days"][0]
    assert out["dwell"].get("a", {}).get(day, {}) == {}, \
        "an outage this long must not be counted as time spent in the room"
    # Still the same room both times, so no entry is recorded for the second
    # sighting (prev_room == room), only the initial one.
    assert out["entries"]["a"][day] == {"Kitchen": 1}


def test_occupancy_counts_distinct_objects_sharing_a_room_and_hour():
    frames = [
        _frame(1000.0, [_obj("a", "Kitchen"), _obj("b", "Kitchen"), _obj("c", "Hallway")]),
    ]
    out = compute_dwell_stats(frames, tz_name="UTC")
    day = out["days"][0]
    hour = list(out["occupancy"][day].keys())[0]
    assert out["occupancy"][day][hour] == {"Kitchen": 2, "Hallway": 1}


def test_the_same_object_in_one_room_across_frames_in_the_same_hour_counts_once():
    frames = [
        _frame(1000.0, [_obj("a", "Kitchen")]),
        _frame(1010.0, [_obj("a", "Kitchen")]),
    ]
    out = compute_dwell_stats(frames, tz_name="UTC")
    day = out["days"][0]
    hour = list(out["occupancy"][day].keys())[0]
    assert out["occupancy"][day][hour]["Kitchen"] == 1


def test_object_name_falls_back_to_key_when_never_labelled():
    frames = [_frame(1000.0, [_obj("addr:AA", "Kitchen")])]
    out = compute_dwell_stats(frames, tz_name="UTC")
    assert out["objects"]["addr:AA"] == "addr:AA"


def test_object_name_uses_the_labelled_name_when_present():
    frames = [_frame(1000.0, [_obj("addr:AA", "Kitchen", n="Garry's Phone")])]
    out = compute_dwell_stats(frames, tz_name="UTC")
    assert out["objects"]["addr:AA"] == "Garry's Phone"


def test_frames_out_of_order_are_sorted_before_aggregating():
    frames = [
        _frame(1020.0, [_obj("a", "Hallway")]),
        _frame(1000.0, [_obj("a", "Kitchen")]),
        _frame(1010.0, [_obj("a", "Kitchen")]),
    ]
    out = compute_dwell_stats(frames, tz_name="UTC")
    day = out["days"][0]
    assert out["dwell"]["a"][day] == {"Kitchen": 20.0}


def test_objects_with_no_room_or_no_key_are_skipped():
    frames = [_frame(1000.0, [{"k": "a"}, {"r": "Kitchen"}, {"k": "", "r": "Kitchen"}])]
    out = compute_dwell_stats(frames, tz_name="UTC")
    assert out["objects"] == {}
    assert out["dwell"] == {}


def test_empty_frames_returns_an_empty_but_well_shaped_result():
    out = compute_dwell_stats([], tz_name="UTC")
    assert out == {"objects": {}, "days": [], "dwell": {}, "entries": {}, "occupancy": {}}


def test_an_invalid_timezone_name_falls_back_to_utc_instead_of_raising():
    out = compute_dwell_stats([_frame(1000.0, [_obj("a", "Kitchen")])], tz_name="Not/AZone")
    assert out["days"] == ["1970-01-01"]


def test_day_bucketing_respects_the_given_timezone_not_utc():
    # 1000s after epoch is 1970-01-01 00:16:40 UTC — a negative-offset zone
    # west of UTC is still the previous day at that instant.
    out = compute_dwell_stats([_frame(1000.0, [_obj("a", "Kitchen")])], tz_name="America/Vancouver")
    assert out["days"] == ["1969-12-31"]
