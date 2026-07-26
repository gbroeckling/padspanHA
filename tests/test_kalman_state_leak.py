# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Regression tests for orphaned Kalman state on RPA re-key (PR #50).

The RSSI smoothing dicts are keyed by resolved address, not object key, so
``_kalman_addr_key`` records the mapping.  ``_evict_object`` only pops the
*current* mapping — so whenever the mapping changed, the superseded address's
entries leaked for the process lifetime, one per change.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator

CANON = "irk:aabbccddeeff00112233445566778899"
RAW_A = "AA:BB:CC:DD:EE:01"
RAW_B = "AA:BB:CC:DD:EE:02"
KEY = "dev1"


def _make_coordinator() -> PresenceCoordinator:
    hass = MagicMock()
    mock_settings = MagicMock()
    mock_settings.data = {}
    hass.data = {DOMAIN: {DATA_SETTINGS: mock_settings}}
    return PresenceCoordinator(hass)


def _seed(coord: PresenceCoordinator, addr: str) -> None:
    """Populate the address-keyed smoothing dicts as _smooth_room would."""
    coord._ema_rssi[addr] = {"scanner1": -60.0}
    coord._kalman_p[addr] = {"scanner1": 4.0}
    coord._silence_miss[addr] = {"scanner1": 1}


def _addr_state_keys(coord: PresenceCoordinator) -> set[str]:
    return set(coord._ema_rssi) | set(coord._kalman_p) | set(coord._silence_miss)


class TestRekeyDropsOrphan:
    def test_resolver_flap_drops_superseded_state(self) -> None:
        """canonical -> raw between polls must not orphan the canonical state."""
        coord = _make_coordinator()
        _seed(coord, CANON)
        coord._rekey_kalman_state(KEY, CANON)

        _seed(coord, RAW_A)
        coord._rekey_kalman_state(KEY, RAW_A)

        assert _addr_state_keys(coord) == {RAW_A}
        assert coord._kalman_addr_key[KEY] == RAW_A

    def test_unresolved_rotation_then_resolve_drops_raw(self) -> None:
        """The common case: a rotation seen before the resolver has it."""
        coord = _make_coordinator()
        _seed(coord, RAW_A)
        coord._rekey_kalman_state(KEY, RAW_A)

        _seed(coord, CANON)
        coord._rekey_kalman_state(KEY, CANON)

        assert _addr_state_keys(coord) == {CANON}

    def test_repeated_flapping_does_not_accumulate(self) -> None:
        """The leak was one entry per change — assert it stays bounded."""
        coord = _make_coordinator()
        for i in range(500):
            addr = RAW_A if i % 2 else RAW_B
            _seed(coord, addr)
            coord._rekey_kalman_state(KEY, addr)

        assert len(_addr_state_keys(coord)) == 1

    def test_many_rotations_leave_only_the_latest(self) -> None:
        coord = _make_coordinator()
        for i in range(200):
            addr = "AA:BB:CC:DD:{:02X}:{:02X}".format(i >> 8, i & 0xFF)
            _seed(coord, addr)
            coord._rekey_kalman_state(KEY, addr)

        assert _addr_state_keys(coord) == {"AA:BB:CC:DD:00:C7"}


class TestRekeyPreserves:
    def test_stable_mapping_keeps_state(self) -> None:
        """Re-keying to the same address must not disturb smoothing state."""
        coord = _make_coordinator()
        _seed(coord, CANON)
        coord._rekey_kalman_state(KEY, CANON)
        coord._rekey_kalman_state(KEY, CANON)

        assert coord._ema_rssi[CANON]["scanner1"] == -60.0
        assert coord._kalman_p[CANON]["scanner1"] == 4.0

    def test_first_mapping_drops_nothing(self) -> None:
        coord = _make_coordinator()
        _seed(coord, CANON)
        coord._rekey_kalman_state(KEY, CANON)

        assert _addr_state_keys(coord) == {CANON}

    def test_other_objects_state_untouched(self) -> None:
        """Re-keying one object must not evict a different object's state."""
        coord = _make_coordinator()
        _seed(coord, CANON)
        coord._rekey_kalman_state(KEY, CANON)
        _seed(coord, "BB:BB:BB:BB:BB:BB")
        coord._rekey_kalman_state("dev2", "BB:BB:BB:BB:BB:BB")

        _seed(coord, RAW_A)
        coord._rekey_kalman_state(KEY, RAW_A)

        assert "BB:BB:BB:BB:BB:BB" in _addr_state_keys(coord)
        assert coord._kalman_addr_key["dev2"] == "BB:BB:BB:BB:BB:BB"

    def test_bare_key_mapping_is_never_dropped(self) -> None:
        """State stored under the object key itself is not address-keyed."""
        coord = _make_coordinator()
        _seed(coord, KEY)
        coord._rekey_kalman_state(KEY, KEY)
        coord._rekey_kalman_state(KEY, CANON)

        assert KEY in _addr_state_keys(coord)


class TestEvictStillWorks:
    def test_evict_object_clears_current_mapping(self) -> None:
        """The pre-existing eviction path must still work after the re-key."""
        coord = _make_coordinator()
        _seed(coord, CANON)
        coord._rekey_kalman_state(KEY, CANON)
        coord._evict_object(KEY)

        assert _addr_state_keys(coord) == set()
        assert KEY not in coord._kalman_addr_key
