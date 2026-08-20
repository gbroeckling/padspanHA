# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Adversarial tests for the per-object isolation boundary added in 0.36.2.

The boundary catches exceptions. Catching exceptions is how breakage becomes
permanent and quiet, so it earns more suspicion than the bug it replaced —
before it, a failure was an outage nobody could miss; after it, a failure is a
degraded device that nobody may ever look at.

These tests ask the hostile questions about it:

  * does a device that fails FOREVER stay visible, or does it go quiet?
  * does the failure state itself leak when the object is removed?
  * does an unrefined object break the contract its consumers rely on?
  * does the boundary catch things it should not, e.g. cancellation?
"""

from __future__ import annotations

import asyncio
import logging

from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator

from .test_poll_level import ble_object, make_coordinator, run_poll, snapshot

GOOD_ADDR = "11:22:33:44:55:66"


def _always_fails(key, addr, *a, **kw):
    raise ValueError("synthetic pipeline failure")


class TestAPermanentFailureStaysVisible:
    """A device broken for a week must not be as quiet as one broken once."""

    def test_the_failure_is_still_recorded_on_the_tenth_poll(self):
        coord = make_coordinator()
        coord._smooth_room = _always_fails
        for _ in range(10):
            run_poll(coord, snapshot([ble_object("bad", "DE:AD:BE:EF:00:01")]))
        assert coord._object_failures == ["bad"], (
            "a persistently failing object stopped being recorded"
        )

    def test_it_does_not_shout_every_poll(self, caplog):
        """The other failure mode: 8,640 identical tracebacks a day."""
        coord = make_coordinator()
        coord._smooth_room = _always_fails
        with caplog.at_level(logging.WARNING,
                             logger="custom_components.padspan_ha.presence_coordinator"):
            for _ in range(10):
                run_poll(coord, snapshot([ble_object("bad", "DE:AD:BE:EF:00:01")]))
        shouts = [r for r in caplog.records if "objects failed this poll" in r.message]
        assert len(shouts) <= 2, f"logged the same failure {len(shouts)} times"


class TestFailureStateHasALifecycleToo:
    """`_object_failures` is per-object state and must not outlive its object.

    It is a LIST, not a dict, so `test_object_state_lifecycle` — which walks
    dict attributes — cannot see it. That is a hole in the invariant test I
    wrote, found by asking what my own change added.
    """

    def test_an_evicted_object_is_not_left_in_the_failure_list(self):
        coord = make_coordinator()
        coord._smooth_room = _always_fails
        run_poll(coord, snapshot([ble_object("bad", "DE:AD:BE:EF:00:01")]))
        assert "bad" in coord._object_failures
        coord._evict_object("bad")
        assert "bad" not in coord._object_failures, (
            "a removed object is still listed as failing"
        )

    def test_recovery_clears_it(self):
        """A device that starts working again must stop being listed."""
        coord = make_coordinator()
        coord._ema_rssi[GOOD_ADDR] = {"scanner1": -55.0}
        coord._smooth_room = _always_fails
        run_poll(coord, snapshot([ble_object("flaky", GOOD_ADDR)]))
        assert coord._object_failures == ["flaky"]

        del coord._smooth_room          # restore the real bound method
        run_poll(coord, snapshot([ble_object("flaky", GOOD_ADDR)]))
        assert coord._object_failures == [], "recovery left the object marked failed"


class TestTheDegradedObjectIsStillUsable:
    """Emitting an unrefined object is only right if consumers can take it."""

    def test_it_carries_the_fields_its_consumers_read(self):
        coord = make_coordinator()
        coord._smooth_room = _always_fails
        result = run_poll(coord, snapshot([
            ble_object("bad", "DE:AD:BE:EF:00:01", room="Kitchen", floor_id="main"),
        ]))
        obj = result["bad"]
        assert obj.get("key") == "bad"
        assert obj.get("address") == "DE:AD:BE:EF:00:01"
        # It was not refined, so it must not claim to have been.
        assert not obj.get("_smoothed"), (
            "an object that failed the pipeline is marked as having been smoothed"
        )

    def test_it_does_not_invent_a_confidence_it_never_computed(self):
        coord = make_coordinator()
        coord._smooth_room = _always_fails
        result = run_poll(coord, snapshot([ble_object("bad", "DE:AD:BE:EF:00:01")]))
        obj = result["bad"]
        for claim in ("room_confidence", "rssi_margin_confidence", "knn_confidence"):
            assert claim not in obj, (
                f"failed object carries {claim}, which no code computed for it"
            )


class TestTheBoundaryIsNotTooWide:
    """A catch-all that swallows control flow is worse than the crash."""

    def test_cancellation_is_not_swallowed(self):
        """HA cancels the update task on shutdown and reload."""
        coord = make_coordinator()

        def cancelled(key, addr, *a, **kw):
            raise asyncio.CancelledError()

        coord._smooth_room = cancelled
        try:
            run_poll(coord, snapshot([ble_object("x", "DE:AD:BE:EF:00:01")]))
        except asyncio.CancelledError:
            return  # correct: propagated
        raise AssertionError(
            "CancelledError was swallowed by the per-object boundary; a reload "
            "or shutdown would be treated as one device misbehaving"
        )
