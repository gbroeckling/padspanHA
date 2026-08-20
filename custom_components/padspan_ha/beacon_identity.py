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

# How far an address's reported age must FALL between polls before it counts as
# having advertised again. Re-advertising resets the age to ~0, so a real drop
# is seconds; anything smaller is measurement jitter.
READVERTISE_DROP_S = 1.0


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
    settled: bool = True,
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
        settled: whether enough polls have been observed for the ABSENCE of
            durable addresses to be evidence. Before that, an identity that has
            simply not been watched long enough looks identical to a rotator,
            and treating it as one would merge a real pack for a second or two
            before splitting it again. False keeps the first-sighting
            heuristics in force until there is something to reason from.

    `prev_macs` is the set of addresses this identity has been observed to
    RE-USE — not every address seen recently. The difference is the whole of
    issue #63: a rotator's abandoned addresses linger in a staleness window for
    many polls after they stop advertising, so a caller that passes "seen in the
    last 60s" hands over a set that overlaps itself poll after poll and every
    rotation reads as persistence.
    """
    if len(recent_macs) <= 1:
        return SplitDecision(False, "single address")

    if prev_macs is not None and (prev_macs or settled):
        survivors = len(set(recent_macs) & prev_macs)
        if survivors >= PERSIST_SPLIT_MIN:
            return SplitDecision(True, f"{survivors} addresses persisted — separate devices")
        # Nothing meaningful carried over: these addresses are being used once
        # and abandoned, which is rotation however the identity looks.
        return SplitDecision(False, f"only {survivors} persisted — one rotating device")

    # First sighting, or too early to tell: no history to reason from, so fall
    # back to the address heuristics. Deliberately conservative — splitting wrongly here costs one
    # poll, and the persistence test corrects it on the next.
    if default_uuid:
        return SplitDecision(True, "first sighting, factory-default UUID")
    if same_oui:
        return SplitDecision(True, "first sighting, one vendor prefix")
    if all_rpa:
        return SplitDecision(False, "first sighting, all addresses look private")
    return SplitDecision(True, "first sighting, addresses do not look private")


# ── Rotation bridging: only ever across a hand-over ─────────────────────────
#
# Bridging links a NEW address to an identified one that has DISAPPEARED, on
# the strength of a matching advertisement fingerprint. The fingerprint is
# weak evidence — a multi-pack shares one — and the RPA heuristic it is gated
# on false-positives on public OUIs in 0x40-0x7F. What makes a hand-over a
# hand-over is that the old address STOPS: a phone never advertises from two
# addresses at once. So the one thing a bridge must check is that the address
# it is bridging from has gone silent. Four CP27 beacons (48:87:2D:…, one
# fingerprint, all advertising every second) were chained into one object
# because it did not: the object's vector alternated between two closets and
# the room vote "flipped" between two beacons taking turns.
#
# Five seconds: a beacon at any sane interval is heard inside that; an
# address that has stopped ages past it on the very next poll.
BRIDGE_MIN_SILENCE_S = 5.0


def rotation_bridge_allowed(old_age_s: float | None, *, min_silence_s: float = BRIDGE_MIN_SILENCE_S) -> SplitDecision:
    """May a new address be bridged onto an identity whose last address has age old_age_s?

    old_age_s is None when the old address is no longer in the snapshot at
    all — the clearest hand-over there is. Returns SplitDecision with
    split=True meaning "these are two devices — do NOT bridge".
    """
    if old_age_s is None:
        return SplitDecision(False, "old address gone — hand-over")
    if old_age_s > min_silence_s:
        return SplitDecision(False, f"old address silent {old_age_s:.0f}s — hand-over")
    return SplitDecision(True, f"old address still advertising ({old_age_s:.0f}s ago) — two devices")


# ── A label is a name, not an identity ───────────────────────────────────────
#
# Two objects wearing the same user label are the same device only if they
# share an ADDRESS. The same-label dedup existed for a device that shows up as
# two object kinds at once (its bare MAC and its iBeacon key, say) — and those
# two share the MAC. Without that check, a live beacon that inherited a label
# through its address was folded into a stale cached ghost wearing the same
# label — the ghost had the higher (frozen) RSSI, so it won — and the live
# object vanished from the list every poll while its ghost aged in place.


def object_macs(obj: dict) -> set[str]:
    """Every MAC an object is known by: its address plus its address history."""
    out: set[str] = set()
    for a in [obj.get("address")] + list(obj.get("all_addresses") or []):
        s = str(a or "").upper()
        if len(s) == 17 and s.count(":") == 5:
            out.add(s)
    return out


def same_device_by_address(a: dict, b: dict) -> bool:
    """True when two objects share at least one MAC — the only evidence that
    a shared label means one device rather than one name on two things."""
    return bool(object_macs(a) & object_macs(b))


# ── Address memory ───────────────────────────────────────────────────────────
# The state decide_split() reasons from, kept here rather than inline in the
# snapshot loop so the two halves of the rule live together and the seam
# between them can be tested. Issue #63 was entirely in this half: the decision
# was right and the caller fed it "addresses seen in the last 60s", which for a
# fast rotator is a set that overlaps itself poll after poll.

def update_address_memory(
    prev_entry: dict | None,
    recent_macs: list[str],
    ages: dict[str, float],
) -> dict:
    """Fold one poll into an identity's address memory.

    An address becomes DURABLE the first time its age is seen to drop, which
    means the device advertised on it again. That is a property of the address,
    not of the poll, so once set it stays set while the address remains in the
    window: a beacon with a slow advertising interval cannot oscillate in and
    out of counting as a separate device.

    A rotator abandons each address after one use, so its age only ever climbs
    and it never becomes durable — at any rotation rate, which is what makes
    this independent of how fast the device is.
    """
    prev_entry = prev_entry or {}
    # A re-advertisement drops the age to near zero, which is a fall of whole
    # seconds. Reported ages jitter by milliseconds, and a bare `<` would read
    # that jitter as re-use and make a rotator's abandoned addresses durable —
    # reintroducing the bug in a subtler form. Demand a real fall.
    prev_addrs = prev_entry.get("addrs") or {}
    addrs: dict[str, dict] = {}
    for a in recent_macs:
        was = prev_addrs.get(a) or {}
        prev_age = was.get("age")
        raw = ages.get(a)
        # An UNKNOWN age is not an age of zero. Coercing it to 0.0 made every
        # missing reading look like a fall from whatever came before — which
        # is the exact evidence this rule exists to demand, manufactured out of
        # its absence. It marked a rotator's abandoned address durable and
        # split one device into several: issue #63 inverted.
        known = isinstance(raw, (int, float)) and not isinstance(raw, bool)
        age = float(raw) if known else prev_age
        readvertised = (known
                        and isinstance(prev_age, (int, float))
                        and age < prev_age - READVERTISE_DROP_S)
        addrs[a] = {"age": age, "durable": bool(was.get("durable")) or readvertised}
    return {"polls": int(prev_entry.get("polls") or 0) + 1, "addrs": addrs}


def durable_addresses(entry: dict | None) -> set[str] | None:
    """The addresses an identity has been observed to RE-USE.

    None when there is no memory at all, which decide_split reads as a first
    sighting and answers from the address heuristics instead.
    """
    if entry is None:
        return None
    return {a for a, v in (entry.get("addrs") or {}).items() if v.get("durable")}


def memory_is_settled(entry: dict | None, min_polls: int = 3) -> bool:
    """Whether the ABSENCE of a durable address is evidence yet.

    Before this, an identity that simply has not been watched long enough looks
    exactly like a rotator, and treating it as one would merge a real pack for
    a poll or two before splitting it again.
    """
    return int((entry or {}).get("polls") or 0) >= min_polls
