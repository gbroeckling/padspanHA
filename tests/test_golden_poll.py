"""The poll and the room smoothing give exactly the stored output.

Each scenario of tests/golden_poll.py runs PadSpan's own poll on a simulated
clock; after every poll, everything the poll returned and all the state the
coordinator keeps between polls is recorded, per object. The records must be
the ones stored under tests/golden/poll/: the room, the confidence, the
position and every filter and vote value of every object at every poll.

This is what lets presence_coordinator.py be restructured: the same output
before and after, to the last digit (tests/golden_tools.py says how far "the
last digit" can be held on a machine other than the one the output was
stored on).

A behaviour change on purpose changes this output. Store the new one with

    python -m tests.regen_goldens poll

and read the diff of tests/golden/poll/ before committing it.
"""

from __future__ import annotations

import json

import pytest

from custom_components.padspan_ha.const import OUTSIDE_FLOOR_ID
from tests import golden_poll as gp
from tests import golden_tools as gt

pytestmark = gt.FULL_EDITION_ONLY


@pytest.fixture(scope="module")
def runs() -> dict[str, gp.Recorder]:
    """Each scenario run once, when a test first asks for it."""

    class _Runs(dict):
        def __missing__(self, name: str) -> gp.Recorder:
            self[name] = gp.SCENARIOS[name]()
            return self[name]

    return _Runs()


@pytest.mark.parametrize("name", list(gp.SCENARIOS))
def test_the_poll_gives_the_stored_output(name: str, runs) -> None:
    gt.check_summarised("poll", name, runs[name].polls, gp.summarise, gp.explain)


def test_the_last_digit_is_held_on_this_machine() -> None:
    """Says so in the test report when it is not: on a machine whose maths
    functions round differently from the one the output was stored on, the
    test above compares to 9 significant digits only."""
    if not all(gt.exact_applies("poll", name) for name in gp.SCENARIOS):
        pytest.skip("this machine's maths functions round differently from those the stored every-digit "
                    "digest came from; the poll output was compared to "
                    f"{gt.PORTABLE_DIGITS} significant digits")


def test_the_smoothing_on_the_worker_thread_gives_the_same_output() -> None:
    """CPU mode "single" runs the per-object smoothing on its own thread; the
    output is the stored output of the same house (its first ten minutes)."""
    polls = gp.run_house(settings={"cpu_mode": "single"}, run_s=600.0).polls
    stored = (gt.GOLDEN_DIR / "poll" / "two_floors.summary.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(polls) == 120
    for i, (rec, want) in enumerate(zip(polls, stored)):
        now = json.loads(gt.line(rec, gt.PORTABLE_DIGITS))
        assert gt.line(gp.summarise(now)) == want, gp.where(i, now)


def test_every_coordinator_attribute_is_accounted_for(runs) -> None:
    """State added to the coordinator later is either recorded or left out
    on purpose: add its name to one of the lists in tests/golden_poll.py."""
    lists = [set(gp.STATE_BY_KEY), set(gp.STATE_BY_ADDR), set(gp.STATE_SHARED), set(gp.STATE_LEFT_OUT)]
    named = set().union(*lists)
    assert sum(len(x) for x in lists) == len(named), "an attribute is in two of the lists"
    for name in gp.SCENARIOS:
        for coord in runs[name].coordinators:
            unknown = set(vars(coord)) - named - {"_process_room_alerts", "_run_automations"}
            assert not unknown, (
                f"PresenceCoordinator has state the exact-output test does not know: {sorted(unknown)}. "
                "Add each to STATE_BY_KEY, STATE_BY_ADDR or STATE_SHARED in tests/golden_poll.py (and "
                "store the new output), or to STATE_LEFT_OUT with the reason.")
    seen = set().union(*(vars(c) for name in gp.SCENARIOS for c in runs[name].coordinators))
    assert named - set(gp.STATE_LEFT_OUT) <= seen | {"_cleanup_counter"}, sorted(named - seen)


def test_the_two_floor_run_takes_the_paths_it_is_there_for(runs) -> None:
    """The larger house is there to take the poll through more than the plain
    walks do. Each line is one of those paths, seen in the run."""
    polls = runs["two_floors"].polls
    objs = [(k, o["result"] or {}, o["state"]) for p in polls for k, o in p["objects"].items()]

    def any_obj(test) -> bool:
        return any(test(k, r, s) for k, r, s in objs)

    # More than one floor, and outdoors.
    assert {r.get("floor_id") for _k, r, _s in objs} >= {gp.MAIN, gp.UPPER, OUTSIDE_FLOOR_ID}
    assert any_obj(lambda k, r, s: r.get("outside") is True)
    assert any_obj(lambda k, r, s: str(s.get("_spatial_debug", "")).startswith("outside_by_coverage"))
    assert any(c[1] and c[2] and gp.ROOMS[c[1]][0] != gp.ROOMS[c[2]][0]
               for p in polls for c in p["events"].get("room_changes", [])), "a room change across floors"
    # A pinned device: its room from the pin, its drift from the solve; and a
    # pin whose room is not a room, which keeps the solved room.
    assert all(r.get("room") == "Bath" and r.get("_pinned") for k, r, _s in objs if k == gp.PIN_BATH)
    assert any_obj(lambda k, r, s: k == gp.PIN_BATH and r.get("anchor_drift_m") is not None)
    assert any_obj(lambda k, r, s: k == gp.PIN_LOFT and r.get("_pinned") and r.get("room") == "Loft")
    # The pinned devices' own calibration points, saved by the poll.
    saved = [pt for p in polls for pt in p["saved_points"]]
    assert {pt["device_id"] for pt in saved} == {gp.PIN_BATH, gp.PIN_LOFT}
    assert {pt["room"] for pt in saved} == {"Bath", ""}
    # An iBeacon, smoothed under its own key from two addresses.
    assert any_obj(lambda k, r, s: k == gp.IBEACON_KEY and r.get("_smoothed") and r.get("room"))
    assert {a for k, r, _s in objs if k == gp.IBEACON_KEY for a in r.get("all_addresses", [])} \
        == {"C0:FF:EE:00:00:03", "C0:FF:EE:00:00:13"}
    # A private address resolved: filtered under the phone's own id.
    assert any_obj(lambda k, r, s: k == gp.PRIVATE_KEY and s.get("_kalman_addr_key") == gp.PRIVATE_KEY.upper())
    # The fingerprint match: a position from it, and a room from it.
    assert any_obj(lambda k, r, s: "_knn_position" in s)
    assert any_obj(lambda k, r, s: (s.get("_last_candidate") or {}).get("source") == "knn")
    assert any_obj(lambda k, r, s: "room_scores" in r)
    # The spatial solve, its hold through a thin poll, and the strongest-scanner fallback.
    assert any_obj(lambda k, r, s: (s.get("_last_candidate") or {}).get("source") == "spatial")
    assert any_obj(lambda k, r, s: (s.get("_spatial_position") or {}).get("_held_polls", 0) > 0)
    assert any_obj(lambda k, r, s: (s.get("_last_candidate") or {}).get("source") == "rssi")
    assert any_obj(lambda k, r, s: "x_frac" in (s.get("_spatial_position") or {}))
    # A tag's own reference power, a clear move, a short gap that keeps the room.
    assert any_obj(lambda k, r, s: r.get("tx_power") == -62)
    assert any_obj(lambda k, r, s: "_clear_run" in s)
    assert any_obj(lambda k, r, s: "_room_before_gap" in s)
    # Nobody's device listed as it is; one kept through the grace and marked
    # stale; one dropped when the grace ran out; arrivals and departures.
    assert any_obj(lambda k, r, s: k == "C0:FF:EE:00:00:07" and not s and "_smoothed" not in r)
    assert any_obj(lambda k, r, s: k == "C0:FF:EE:00:00:08" and s.get("stale") is True)
    assert "C0:FF:EE:00:00:09" in polls[0]["objects"] and "C0:FF:EE:00:00:09" not in polls[-1]["objects"]
    assert any(p["events"].get("arrived") for p in polls) and any(p["events"].get("departed") for p in polls)
    assert all(p["shared"]["_object_failures"] == [] for p in polls)


def test_the_other_settings_run_takes_the_paths_it_is_there_for(runs) -> None:
    """The second run of that house moves the settings the poll and the
    smoothing read off their defaults. Each line is one of them, seen."""
    polls = runs["two_floors_other_settings"].polls
    objs = [(k, o["result"] or {}, o["state"]) for p in polls for k, o in p["objects"].items()]
    # A 10 s poll and a 30 s Room Change Delay: a vote window of three.
    assert {p["poll_s"] for p in polls} == {10.0}
    assert {s["_room_votes"]["maxlen"] for _k, _r, s in objs if "_room_votes" in s} == {3}
    # A masked receiver is in no filter; a receiver's minimum signal is read.
    assert not any("AA:00:00:00:01:02" in s.get("_ema_rssi", {}) for _k, _r, s in objs)
    assert polls[-1]["shared"]["_floor_cache"] == {"AA:00:00:00:00:03": -85.0}
    # "Unsure" on thin evidence, both kinds.
    assert {r.get("room_unsure") for _k, r, _s in objs} >= {"few_scanners", "far_fingerprint"}
    # Adaptive learning: observations taken, and moves between floors learned.
    learned = polls[-1]["learned_in_all"]
    assert learned["stats"]["total_observations"] > 10 and len(learned["room_fingerprints"]) >= 5
    assert "main|upper" in learned["floor_transitions"]
    assert len({p["learned"] for p in polls}) > 10
    assert all(p["shared"]["_object_failures"] == [] for p in polls)
