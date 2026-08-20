# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Per-object state has one lifecycle, and this test enforces it.

The coordinator keeps per-object state in ~40 separate dicts. Every one of
them has to be cleared when an object is evicted, and the location-describing
subset has to be cleared when an object comes back from being away. That is an
invariant maintained by hand, in two code paths, across forty-odd fields — so
it gets missed, and it has been missed: today's change added `_coverage_hist`
and had to remember both places.

Rather than restructure the state (a large, risky change in the hottest path
in the product), these tests hold the invariant from outside:

  * `test_every_dict_is_classified` fails the moment someone adds a dict
    without saying what it is. That is the mechanism — a new field cannot be
    added silently, so the question "does this need clearing?" is forced at
    the point it is cheapest to answer.
  * `TestEviction` asserts nothing survives a removal, generically, so a new
    OBJECT_STATE dict is covered the moment it is classified.
  * `TestReturnFromAway` asserts the code's own stated rule: *"A device that
    was away and is back must not be judged on readings from before it left."*
"""

from __future__ import annotations

from typing import Any

from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator

from .test_poll_level import ble_object, make_coordinator, run_poll, snapshot

KEY = "wanderer"
ADDR = "AA:BB:CC:DD:EE:01"


# ── the classification table ──────────────────────────────────────────────────
# Keyed by something that is NOT one object: a scanner id, a room name, a floor.
# These describe the SITE and must survive everything an object does.
SITE_STATE: frozenset[str] = frozenset({
    "_scanner_positions", "_scanner_abs_z", "_scanner_reliability",
    "_scanner_agree", "_room_centroids", "_floor_bounds", "_floor_bases",
    "_floor_rooms", "_floor_stack_idx", "_pl_fits",
})

# Keyed by an object key or by a resolved address. These belong to one object
# and must not outlive it.
OBJECT_STATE: frozenset[str] = frozenset({
    "_last_seen", "_known_objs", "_away_miss", "_ema_rssi", "_kalman_p",
    "_silence_miss", "_kalman_addr_key", "_room_votes", "_confirmed_room",
    "_room_confidence", "_rssi_margin_confidence", "_knn_position",
    "_smooth_xy", "_espresense_dist", "_addr_tx_power", "_spatial_position",
    "_spatial_smooth_xy", "_spatial_debug", "_floor_evidence",
    "_outside_by_cov", "_coverage_hist", "_last_candidate", "_alert_last_sent",
    "_beacon_autocal_last", "_beacon_autocal_buf", "_last_room_change_mono",
    "_room_dwell_start", "_floor_dwell_start", "_adaptive_last_vec",
    "_adaptive_last_obs", "_co_visible", "_device_floor",
})

# The subset of OBJECT_STATE that says WHERE the object was. An absence breaks
# the continuity these describe: a device that left and came back must not be
# placed by evidence gathered before it left. The coordinator says exactly this
# in its own comment on the re-entry branch.
LOCATION_STATE: frozenset[str] = frozenset({
    "_room_votes", "_confirmed_room", "_room_confidence", "_knn_position",
    "_smooth_xy", "_spatial_position", "_spatial_smooth_xy",
    "_coverage_hist", "_outside_by_cov", "_floor_evidence", "_device_floor",
    "_adaptive_last_vec",
})


def _dict_attrs(coord: PresenceCoordinator) -> dict[str, dict]:
    return {n: v for n, v in vars(coord).items()
            if isinstance(v, dict) and n.startswith("_")}


def _holds(d: dict, *ids: str) -> bool:
    return any(i in d for i in ids)


# ── the mechanism ─────────────────────────────────────────────────────────────

def test_every_dict_is_classified():
    """A new per-object dict cannot be added without a decision being made.

    This is the whole point of the file. The bug class is 'someone added a
    field and forgot one of the two clear paths'. Forgetting is now a test
    failure at the moment of writing, not an outage six weeks later.
    """
    coord = make_coordinator()
    known = SITE_STATE | OBJECT_STATE
    found = set(_dict_attrs(coord))
    unclassified = found - known
    assert not unclassified, (
        f"unclassified coordinator dict(s): {sorted(unclassified)}. Add each to "
        f"SITE_STATE (keyed by scanner/room/floor) or OBJECT_STATE (keyed by "
        f"object key or address) in this file — and if it is OBJECT_STATE, make "
        f"sure _evict_object clears it."
    )


def test_the_two_classes_do_not_overlap():
    assert not (SITE_STATE & OBJECT_STATE)
    assert LOCATION_STATE <= OBJECT_STATE


# ── eviction ──────────────────────────────────────────────────────────────────

class TestEviction:
    """Removing an object removes all of it."""

    def _seed_via_real_poll(self) -> PresenceCoordinator:
        coord = make_coordinator()
        coord._ema_rssi[ADDR] = {"scanner1": -55.0}
        run_poll(coord, snapshot([ble_object(KEY, ADDR)]))
        return coord

    def test_nothing_survives(self):
        coord = self._seed_via_real_poll()
        coord._evict_object(KEY)
        leaked = {
            n: [i for i in (KEY, ADDR) if i in d]
            for n, d in _dict_attrs(coord).items()
            if n in OBJECT_STATE and _holds(d, KEY, ADDR)
        }
        assert not leaked, (
            f"state outlived its object: {leaked}. Every OBJECT_STATE dict must "
            f"be cleared in _evict_object."
        )


# ── return from away ──────────────────────────────────────────────────────────

class TestReturnFromAway:
    """A device that left and came back is not placed by where it used to be."""

    # A value no poll would ever produce, so its presence afterwards can only
    # mean it was never cleared. Checking that the KEY is gone would be wrong:
    # the returning poll legitimately writes fresh entries, and a test that
    # cannot tell "cleared then repopulated" from "never cleared" reports the
    # healthy fields as failures.
    MARKER = -98765.0

    def _seed_then_return(self) -> tuple[PresenceCoordinator, dict[str, Any]]:
        coord = make_coordinator()
        coord._ema_rssi[ADDR] = {"scanner1": -55.0}
        run_poll(coord, snapshot([ble_object(KEY, ADDR)]))
        # Stamp every location dict with evidence from BEFORE the absence.
        seeded: dict[str, Any] = {}
        for name in sorted(LOCATION_STATE):
            d = getattr(coord, name)
            val = ({"marker": self.MARKER}
                   if name in ("_knn_position", "_spatial_position") else self.MARKER)
            d[KEY] = val
            seeded[name] = val
        # It goes away...
        coord._known_objs[KEY] = {**coord._known_objs.get(KEY, {}), "_stale": True}
        # ...and comes back.
        run_poll(coord, snapshot([ble_object(KEY, ADDR)]))
        return coord, seeded

    def test_no_pre_absence_evidence_survives(self):
        coord, seeded = self._seed_then_return()
        survived = sorted(
            n for n, val in seeded.items()
            if getattr(coord, n).get(KEY) == val
        )
        assert not survived, (
            f"evidence from before the absence is still in use: {survived}. The "
            f"re-entry branch clears some location state but not these; a device "
            f"that was away must not be placed by readings from before it left."
        )
