# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Regression tests for the rotating-MAC address-history cap (PR #51).

An unbounded ``all_addresses`` list reached ~42k addresses on a single phone,
which the per-advertisement cross-reference then copied onto every ad — a
~300MB snapshot that blew past the websocket message limit and left the panel
showing a blank map.
"""

from __future__ import annotations

from custom_components.padspan_ha.websocket import (
    _ALL_ADDR_CAP,
    _XREF_ADDR_SAMPLE,
    _capped_mac_history,
)


def _macs(n: int, *, start: int = 0) -> list[str]:
    """Generate n distinct MAC-shaped addresses."""
    return [
        "AA:BB:{:02X}:{:02X}:{:02X}:{:02X}".format(
            (i >> 24) & 0xFF, (i >> 16) & 0xFF, (i >> 8) & 0xFF, i & 0xFF
        )
        for i in range(start, start + n)
    ]


class TestCapEnforced:
    def test_unbounded_history_is_capped(self) -> None:
        """The 42k-address production case must not survive the merge."""
        assert len(_capped_mac_history(_macs(42_000))) == _ALL_ADDR_CAP

    def test_short_history_is_untouched(self) -> None:
        addrs = _macs(5)
        assert _capped_mac_history(addrs) == addrs

    def test_exactly_at_cap_is_untouched(self) -> None:
        addrs = _macs(_ALL_ADDR_CAP)
        assert _capped_mac_history(addrs) == addrs


class TestFreshestRetained:
    def test_head_is_kept_not_tail(self) -> None:
        """Callers pass current-cycle addresses first; those must survive."""
        fresh, stale = _macs(3), _macs(_ALL_ADDR_CAP * 2, start=1000)
        result = _capped_mac_history(fresh + stale)

        assert result[:3] == fresh
        assert stale[-1] not in result

    def test_repeated_merges_keep_converging_on_fresh(self) -> None:
        """Simulate rotations over time: history stays capped, newest wins."""
        history: list[str] = []
        for cycle in range(200):
            current = _macs(1, start=cycle)
            history = _capped_mac_history(current + history)
            assert len(history) <= _ALL_ADDR_CAP

        # Newest rotation at the head, oldest evicted entirely.
        assert history[0] == _macs(1, start=199)[0]
        assert _macs(1, start=0)[0] not in history


class TestFiltering:
    def test_non_mac_entries_are_scrubbed(self) -> None:
        """Historic cache entries were poisoned with key strings."""
        result = _capped_mac_history(
            ["ibeacon:abc-def", "irk:00112233", "AA:BB:CC:DD:EE:FF", "", None, 42]
        )
        assert result == ["AA:BB:CC:DD:EE:FF"]

    def test_duplicates_collapse_preserving_order(self) -> None:
        a, b = "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02"
        assert _capped_mac_history([a, b, a, b, a]) == [a, b]

    def test_empty_input(self) -> None:
        assert _capped_mac_history([]) == []

    def test_dedup_happens_before_cap(self) -> None:
        """A list of duplicates must not consume cap slots."""
        addrs = _macs(10) * 50
        assert _capped_mac_history(addrs) == _macs(10)


class TestXrefSample:
    def test_xref_sample_is_far_below_object_cap(self) -> None:
        """The per-ad sample is what actually caused the ~300MB blow-up."""
        assert _XREF_ADDR_SAMPLE < _ALL_ADDR_CAP
        assert _XREF_ADDR_SAMPLE == 8
