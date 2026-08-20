# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Does the durability rule work at real beacon advertising rates?

`update_address_memory` marks an address DURABLE when its reported age is seen
to FALL by more than `READVERTISE_DROP_S` (1.0 s) between polls, on the theory
that re-advertising resets the age and a rotator's abandoned address only ever
climbs.

That theory has a hidden dependency: the age is sampled once per poll, so
whether a fall is ever *observed* depends on the relationship between the
advertising interval and the poll interval. This file establishes where the
rule works and where it does not, at rates real hardware actually uses.

Nothing here is a claim about intent — it characterises the shipped behaviour
so the tuning conversation happens against numbers.
"""

from __future__ import annotations

from custom_components.padspan_ha.beacon_identity import (
    READVERTISE_DROP_S,
    decide_split,
    durable_addresses,
    memory_is_settled,
    update_address_memory,
)

ADDR_A = "AA:BB:CC:DD:EE:01"
ADDR_B = "AA:BB:CC:DD:EE:02"


def _ages_for(adv_interval_s: float, poll_interval_s: float, polls: int) -> list[float]:
    """Age-since-last-advertisement as sampled once per poll.

    A beacon advertising every `adv_interval_s` is, at any instant, somewhere
    between 0 and `adv_interval_s` seconds since its last advertisement.
    Sampling at a fixed poll rate walks that sawtooth.
    """
    return [round((p * poll_interval_s) % adv_interval_s, 3) for p in range(1, polls + 1)]


def _run(ages: list[float], addr: str = ADDR_A) -> dict:
    entry = None
    for age in ages:
        entry = update_address_memory(entry, [addr], {addr: age})
    return entry


class TestWhereTheRuleWorks:
    def test_an_advertising_interval_near_the_poll_rate_becomes_durable(self):
        """10 s advertiser on a 10 s poll — the band the rule was tuned in."""
        ages = _ages_for(adv_interval_s=10.0, poll_interval_s=3.0, polls=8)
        entry = _run(ages)
        assert ADDR_A in durable_addresses(entry), (
            f"a normal beacon never became durable; ages={ages}"
        )


class TestTheFastEnd:
    """A 1 Hz beacon is sampled at an age between 0 and 1 s, every time."""

    def test_a_1hz_beacon_never_becomes_durable(self):
        ages = _ages_for(adv_interval_s=1.0, poll_interval_s=10.0, polls=20)
        entry = _run(ages)
        assert max(ages) <= 1.0
        assert durable_addresses(entry) == set(), (
            f"expected no durable address at 1 Hz; ages={ages[:8]}"
        )

    def test_the_drop_it_would_need_is_larger_than_its_whole_age_range(self):
        """The mechanism, stated plainly: a fall of more than
        READVERTISE_DROP_S cannot happen when the age never exceeds it."""
        assert READVERTISE_DROP_S >= 1.0

    def test_so_a_real_two_beacon_pack_is_merged_into_one_object(self):
        """The consequence that matters: two devices become one."""
        entry = None
        for age in _ages_for(1.0, 10.0, 6):
            entry = update_address_memory(entry, [ADDR_A, ADDR_B],
                                          {ADDR_A: age, ADDR_B: age})
        assert memory_is_settled(entry, 3), "fixture did not run long enough"
        decision = decide_split(
            [ADDR_A, ADDR_B], durable_addresses(entry),
            all_rpa=False, default_uuid=False, same_oui=True,
            settled=memory_is_settled(entry, 3),
        )
        assert decision.split is False
        assert "rotating" in decision.reason, decision.reason


class TestTheSlowEnd:
    """An address is only carried while it is inside the 60 s staleness window.

    A beacon advertising less often than that leaves the window before it can
    be seen to re-advertise, and its memory entry goes with it — so the next
    sighting has no previous age to compare against.
    """

    def test_an_address_that_left_the_window_starts_over(self):
        entry = update_address_memory(None, [ADDR_A], {ADDR_A: 55.0})
        # Next poll it has aged out and is not in recent_macs at all.
        entry = update_address_memory(entry, [], {})
        assert entry["addrs"] == {}
        # It advertises again and comes back fresh — with no history.
        entry = update_address_memory(entry, [ADDR_A], {ADDR_A: 0.2})
        assert durable_addresses(entry) == set(), (
            "a re-appearing address was credited with durability it never earned"
        )


class TestAMissingAgeDoesNotForgeDurability:
    """`ble_by_addr.get(a, {}).get('age_s')` can be None; the helper coerces a
    non-numeric age to 0.0. If that counted as a fall, an unknown age would
    manufacture the very evidence the rule exists to require."""

    def test_unknown_age_after_a_large_age_does_not_mark_durable(self):
        entry = update_address_memory(None, [ADDR_A], {ADDR_A: 30.0})
        entry = update_address_memory(entry, [ADDR_A], {ADDR_A: None})
        assert durable_addresses(entry) == set(), (
            "a missing age was read as a re-advertisement — this is issue #63 "
            "in a new form"
        )
