# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Poll-level tests: the whole `_async_update_data` cycle, not its helpers.

Every significant defect of the last three releases got through because the
helper was correct and the CALLER was wrong. `snapshot_builder.py` says so
about issue #63 in its own comment — *"The unit tests never caught it because
they pass the previous POLL's addresses, which is the honest thing; only the
caller was lying."* Issue #62 was the same shape, and so was the
`outside_by_coverage` crash that froze every entity in a live install on
2026-08-19: `coverage_evidence()` and `outside_by_coverage()` were both
correct and both unit-tested, and the line that broke was the caller's
diagnostic string.

A test that calls the helper cannot see any of that. These tests drive a real
coordinator through a real poll with a stubbed snapshot, so the caller is
exercised too. That is the only shape that catches this class.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock, patch

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator


# ── harness ───────────────────────────────────────────────────────────────────

def make_coordinator(settings: dict[str, Any] | None = None) -> PresenceCoordinator:
    hass = MagicMock()
    st = MagicMock()
    st.data = dict(settings or {})
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    coord = PresenceCoordinator(hass)
    coord._pending_room_changes = []
    return coord


def snapshot(objects: list[dict[str, Any]],
             advertisements: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The shape `_live_snapshot` returns, reduced to what a poll reads."""
    return {
        "objects": {"list": objects},
        "ble": {"advertisements": advertisements or [], "radios": []},
    }


def run_poll(coord: PresenceCoordinator, snap: dict[str, Any]) -> dict[str, Any]:
    """Drive one real `_async_update_data` cycle over `snap`.

    Patches only the two things a poll reaches outside itself — the snapshot
    source and the RPA resolver. Everything between them is the production
    path, which is the entire point.
    """
    resolver = MagicMock()
    resolver.has_devices.return_value = False

    async def _snap(_hass):
        return snap

    async def _get_resolver(_hass):
        return resolver

    with patch("custom_components.padspan_ha.websocket._live_snapshot", _snap), \
         patch("custom_components.padspan_ha.private_ble_resolver.get_resolver",
               _get_resolver):
        return asyncio.run(coord._async_update_data())


def ble_object(key: str, addr: str, **extra: Any) -> dict[str, Any]:
    obj = {"key": key, "address": addr, "kind": "ble", "name": key}
    obj.update(extra)
    return obj


# ── the 2026-08-19 outage ─────────────────────────────────────────────────────

class TestOutsideAndSilentDoesNotKillThePoll:
    """A device that is outside and heard by nothing must not end the poll.

    This is the exact state that took a live install down. `_best_live` is None
    whenever nothing was heard inside the silence grace; once the outside
    verdict came from a trailing WINDOW rather than this poll's reading,
    `_outside` could be True while `_best_live` was None for the first time,
    and the diagnostic f-string formatted None with `:.0f`.

    The blast radius is what makes it a poll-level test rather than a unit
    one: the TypeError escaped `_object_loop`, `_async_update_data` never
    assigned `self.data`, and every entity in the install froze — a whole
    product outage produced by one device's ordinary state.
    """

    KEY = "tesla"
    ADDR = "AA:BB:CC:DD:EE:FF"

    def _coord_outside_and_silent(self) -> PresenceCoordinator:
        coord = make_coordinator()
        # This device has been heard only weakly for several polls — which is
        # why it is outside — and is heard by nothing at all this poll.
        coord._coverage_hist[self.KEY] = [-95.0, -96.0, -94.0]
        coord._outside_by_cov[self.KEY] = True
        coord._ema_rssi[self.ADDR] = {}
        coord._silence_miss[self.ADDR] = {}
        return coord

    def _run(self, coord: PresenceCoordinator, objects) -> dict[str, Any]:
        """One poll with the coverage floor held still.

        The floor is an INPUT to the rule, recomputed each poll from indoor
        calibration this fixture does not have; left alone it resets to
        inactive and the outside branch is never reached, which would make
        every assertion below pass for the wrong reason.
        """
        with patch.object(type(coord), "_refresh_coverage_floor",
                          lambda self, *a, **k: None):
            coord._coverage_floor = -80.0
            return run_poll(coord, snapshot(objects))

    def _assert_rule_was_exercised(self, coord: PresenceCoordinator) -> str:
        """Guard against the fixture silently not reaching the code under test."""
        assert coord._outside_by_cov.get(self.KEY) is True,             "fixture never reached the outside rule — the test proves nothing"
        dbg = coord._spatial_debug.get(self.KEY) or ""
        assert "outside_by_coverage" in dbg, f"outside branch not taken: {dbg!r}"
        return dbg

    def test_the_object_survives_its_own_poll(self):
        coord = self._coord_outside_and_silent()
        result = self._run(coord, [ble_object(self.KEY, self.ADDR)])
        assert self.KEY in result
        self._assert_rule_was_exercised(coord)
        # THE regression assertion. With the isolation boundary in place a
        # crash no longer ends the poll — it degrades this one object — so
        # "the poll completed" is true either way and proves nothing. What
        # separates fixed from broken is whether the object needed rescuing.
        assert coord._object_failures == [],             f"object degraded instead of being handled: {coord._spatial_debug.get(self.KEY)!r}"

    def test_every_other_object_still_updates(self):
        """The point of the bug: one device's state froze ALL of them."""
        coord = self._coord_outside_and_silent()
        coord._ema_rssi["11:22:33:44:55:66"] = {"scanner1": -55.0}
        result = self._run(coord, [
            ble_object(self.KEY, self.ADDR),
            ble_object("phone", "11:22:33:44:55:66"),
        ])
        assert "phone" in result
        assert self.KEY in result

    def test_the_diagnostic_says_silent_rather_than_crashing(self):
        """The honest reading of 'outside, heard by nothing' is 'silent'."""
        coord = self._coord_outside_and_silent()
        self._run(coord, [ble_object(self.KEY, self.ADDR)])
        dbg = self._assert_rule_was_exercised(coord)
        assert "best=silent" in dbg, dbg
        assert "None" not in dbg, dbg


# ── the containment boundary itself ───────────────────────────────────────────

class TestOneObjectCannotTakeDownThePoll:
    """The general form, so the next bug of this class is a degraded device.

    The specific crash above is fixed. This asserts the property that makes
    the WHOLE class survivable: whatever a single object's pipeline does, the
    other objects still get their poll.
    """

    def test_a_raising_object_does_not_stop_the_others(self):
        coord = make_coordinator()
        coord._ema_rssi["11:22:33:44:55:66"] = {"scanner1": -55.0}
        real = coord._smooth_room

        def boom(key, addr, *a, **kw):
            if key == "bad":
                raise ValueError("synthetic pipeline failure")
            return real(key, addr, *a, **kw)

        coord._smooth_room = boom
        result = run_poll(coord, snapshot([
            ble_object("bad", "DE:AD:BE:EF:00:01"),
            ble_object("good", "11:22:33:44:55:66"),
        ]))
        assert "good" in result, "a healthy device lost its poll to a sick one"

    def test_the_failing_object_is_still_reported(self):
        """A device we could not refine is still a device that is here."""
        coord = make_coordinator()

        def boom(key, addr, *a, **kw):
            raise ValueError("synthetic pipeline failure")

        coord._smooth_room = boom
        result = run_poll(coord, snapshot([ble_object("bad", "DE:AD:BE:EF:00:01")]))
        assert "bad" in result, "the object vanished instead of degrading"

    def test_the_failure_is_recorded_not_swallowed(self):
        """Silent recovery is how you ship a broken device for months."""
        coord = make_coordinator()

        def boom(key, addr, *a, **kw):
            raise ValueError("synthetic pipeline failure")

        coord._smooth_room = boom
        run_poll(coord, snapshot([ble_object("bad", "DE:AD:BE:EF:00:01")]))
        assert coord._object_failures == ["bad"]
        assert "object_failed" in coord._spatial_debug.get("bad", "")
