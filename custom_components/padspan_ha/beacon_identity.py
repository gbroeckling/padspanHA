# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""One beacon, or several? — the question behind every rotating-MAC decision.

Several physical beacons can share a UUID, major and minor: multi-packs ship
that way out of the box. One physical beacon can wear many MAC addresses: that
is what private-address rotation is. Both look identical in a snapshot — a set
of MACs advertising the same beacon identity — and getting the answer wrong is
expensive in opposite directions.

  Split when it is really ONE device
      Every rotation becomes a new object with a new key. The object key is the
      Kalman and vote key, so RSSI smoothing, the room vote, the confirmed room
      and floor stickiness all reset on every rotation. A device rotating every
      1.6 s never accumulates a single poll of smoothing and can never reach a
      vote threshold. It also creates objects without limit — about 54,000 a
      day at that rate.

  Merge when it is really SEVERAL devices
      A pack of beacons collapses into one object that appears to teleport
      between wherever its members are.

WHY THE OLD TEST WAS NOT ENOUGH
===============================
The previous rule asked whether the addresses looked like Resolvable Private
Addresses, with two overrides for cases where that heuristic misfires: a
factory-default UUID, and all MACs sharing one vendor OUI. Both overrides
force "these are separate devices".

That is wrong for exactly the device that hurts most. A cheap keypad using a
factory-default UUID *and* genuinely rotating its address hits the first
override and gets split on every rotation. The override was protecting people
with multi-packs, and it could not tell them apart.

THE TEST THAT CAN
=================
Persistence across polls, which is the thing that actually differs:

    a PACK        — every member keeps advertising, so the same MACs are
                    present poll after poll
    a ROTATOR     — each address is used once and abandoned; almost nothing
                    from the previous poll is still there
    a PHONE       — one live address for ~15 minutes, so during the brief
                    hand-over exactly ONE address carries over

So: split only when at least two addresses survived from the previous poll.
A pack satisfies that every poll. Neither a fast rotator nor a phone in
mid-rotation ever does.

The first time a group is seen there is nothing to compare against, so the old
heuristics still decide that poll and persistence takes over from the next one.
"""

from __future__ import annotations

from dataclasses import dataclass

# How many addresses must survive a poll before a group is called several
# devices. Two, because one carried-over address is exactly what a single
# device looks like while it hands over from its old address to its new one.
PERSIST_SPLIT_MIN = 2


@dataclass(frozen=True)
class SplitDecision:
    """Whether to split, and the reason — which goes into diagnostics.

    The reason is not decoration. This decision changes how many objects exist
    and whether their smoothing survives, and when it is wrong the symptom
    (a beacon that will not settle) looks nothing like the cause.
    """

    split: bool
    reason: str


def decide_split(
    recent_macs: list[str],
    prev_macs: set[str] | None,
    *,
    all_rpa: bool,
    default_uuid: bool,
    same_oui: bool,
) -> SplitDecision:
    """Decide whether MACs sharing one beacon identity are separate devices.

    Args:
        recent_macs: addresses seen recently for this beacon identity.
        prev_macs: the same set from the previous poll, or None the first time
            this identity is seen.
        all_rpa: every recent address looks like a Resolvable Private Address.
            A heuristic — it false-positives on public addresses in the
            0x40-0x7F range, which is what `same_oui` exists to catch.
        default_uuid: the beacon uses a factory-default UUID, so the identity
            is not evidence of being one device.
        same_oui: every recent address shares one vendor prefix, which real
            address rotation would not produce.
    """
    if len(recent_macs) <= 1:
        return SplitDecision(False, "single address")

    if prev_macs is not None:
        survivors = len(set(recent_macs) & prev_macs)
        if survivors >= PERSIST_SPLIT_MIN:
            return SplitDecision(True, f"{survivors} addresses persisted — separate devices")
        # Nothing meaningful carried over: these addresses are being used once
        # and abandoned, which is rotation however the identity looks.
        return SplitDecision(False, f"only {survivors} persisted — one rotating device")

    # First sighting: no history to reason from, so fall back to the address
    # heuristics. Deliberately conservative — splitting wrongly here costs one
    # poll, and the persistence test corrects it on the next.
    if default_uuid:
        return SplitDecision(True, "first sighting, factory-default UUID")
    if same_oui:
        return SplitDecision(True, "first sighting, one vendor prefix")
    if all_rpa:
        return SplitDecision(False, "first sighting, all addresses look private")
    return SplitDecision(True, "first sighting, addresses do not look private")
