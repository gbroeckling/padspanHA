"""One beacon or several — the decision, tested against the devices that exist.

Every case here is a real device class, not an invented input. The split
decision changes how many objects exist and whether their smoothing survives,
and it is wrong in opposite directions for the two populations it serves.
"""

from __future__ import annotations

from custom_components.padspan_ha.beacon_identity import (
    PERSIST_SPLIT_MIN,
    decide_split,
)

# A multi-pack: five beacons, static public addresses, all advertising all the
# time, sharing a factory UUID because nobody reprogrammed them.
PACK = ["48:87:2D:00:00:01", "48:87:2D:00:00:02", "48:87:2D:00:00:03",
        "48:87:2D:00:00:04", "48:87:2D:00:00:05"]


def _rotator(seq: int, count: int = 3) -> list[str]:
    """Addresses a fast rotator shows in one poll — all new, every poll."""
    return [f"7A:{(seq * 10 + i) % 256:02X}:11:22:33:44" for i in range(count)]


def test_a_single_address_is_never_split():
    d = decide_split(["7A:11:22:33:44:55"], None, all_rpa=True,
                     default_uuid=False, same_oui=False)
    assert d.split is False


def test_a_pack_keeps_splitting_poll_after_poll():
    """The population the old override existed to protect.

    Every member keeps advertising, so every address survives each poll.
    """
    prev = set(PACK)
    for _ in range(20):
        d = decide_split(PACK, prev, all_rpa=False, default_uuid=True, same_oui=True)
        assert d.split is True, d.reason
        assert "persisted" in d.reason
        prev = set(PACK)


def test_a_fast_rotator_is_never_split_after_the_first_poll():
    """The device that prompted this — a keypad rotating every 1.6 seconds.

    It uses a factory-default UUID, which under the old rule forced a split on
    every poll: a new object, a new Kalman state and a new vote, forever.
    """
    prev = set(_rotator(0))
    for seq in range(1, 50):
        macs = _rotator(seq)
        d = decide_split(macs, prev, all_rpa=True, default_uuid=True, same_oui=False)
        assert d.split is False, f"poll {seq}: {d.reason}"
        prev = set(macs)


def test_a_phone_handing_over_to_its_next_address_is_not_split():
    """One address carries over during rotation — exactly one, never two.

    This is why the threshold is two and not one.
    """
    old, new = "7A:AA:BB:CC:DD:01", "7A:AA:BB:CC:DD:02"
    d = decide_split([old, new], {old}, all_rpa=True, default_uuid=False, same_oui=False)
    assert d.split is False, d.reason
    assert PERSIST_SPLIT_MIN == 2


def test_a_rotator_that_briefly_overlaps_two_addresses_still_merges():
    """Overlap alone must not mean "several devices".

    A 1.6s rotator at a 5s poll can show two or three addresses in one frame.
    They are still one device, and the giveaway is that none of them was there
    last time.
    """
    d = decide_split(["7A:01:02:03:04:05", "7A:06:07:08:09:0A"],
                     {"7A:FF:FF:FF:FF:FF"},
                     all_rpa=True, default_uuid=True, same_oui=False)
    assert d.split is False, d.reason


def test_persistence_beats_the_address_heuristics_in_both_directions():
    """The point of the change: history decides, not what an address looks like.

    A pack whose addresses false-positive as private still splits; a rotator
    with a factory UUID still merges.
    """
    pack = decide_split(PACK, set(PACK), all_rpa=True, default_uuid=False, same_oui=False)
    assert pack.split is True, pack.reason

    rot = decide_split(_rotator(2), set(_rotator(1)),
                       all_rpa=False, default_uuid=True, same_oui=True)
    assert rot.split is False, rot.reason


def test_the_first_sighting_falls_back_to_the_old_heuristics():
    """There is no history the first time, and the answer still has to be sane.

    Splitting wrongly here costs one poll; the persistence test corrects it on
    the next one.
    """
    assert decide_split(PACK, None, all_rpa=False, default_uuid=True, same_oui=True).split is True
    assert decide_split(PACK, None, all_rpa=False, default_uuid=False, same_oui=True).split is True
    assert decide_split(["7A:11:11:11:11:11", "7A:22:22:22:22:22"], None,
                        all_rpa=True, default_uuid=False, same_oui=False).split is False
    assert decide_split(["AA:11:11:11:11:11", "BB:22:22:22:22:22"], None,
                        all_rpa=False, default_uuid=False, same_oui=False).split is True


def test_every_decision_carries_a_reason():
    """A wrong split shows up as "a beacon that will not settle".

    That symptom looks nothing like its cause, so the reason is recorded.
    """
    cases = [
        decide_split(["A"], None, all_rpa=True, default_uuid=False, same_oui=False),
        decide_split(PACK, set(PACK), all_rpa=False, default_uuid=True, same_oui=True),
        decide_split(_rotator(1), set(_rotator(0)), all_rpa=True, default_uuid=True, same_oui=False),
        decide_split(PACK, None, all_rpa=False, default_uuid=True, same_oui=False),
    ]
    for d in cases:
        assert d.reason and len(d.reason) > 8, d


def test_a_pack_that_loses_members_still_splits_while_two_remain():
    """Beacons run out of battery. The decision must degrade, not invert."""
    alive = PACK[:2]
    d = decide_split(alive, set(PACK), all_rpa=False, default_uuid=True, same_oui=True)
    assert d.split is True, d.reason
    # Down to one survivor it is no longer evidence of several devices.
    d2 = decide_split(PACK[:1] + ["7A:99:99:99:99:99"], {PACK[0]},
                      all_rpa=True, default_uuid=True, same_oui=False)
    assert d2.split is False, d2.reason


def test_a_non_resolvable_rotator_merges_without_classifying_its_address():
    """Issue #63: the device rotates NRPAs, not RPAs.

    `_is_rpa_addr` only recognises 0x40-0x7F (resolvable). A non-resolvable
    private address has top bits 0b00 — 0x00-0x3F — so every one of this
    device's addresses returns False, `all_rpa` is False, and the old rule
    read "several simultaneous devices" and split on every poll. 65,440
    distinct MACs in 24 hours from one garage keypad.

    Persistence does not care what an address LOOKS like, which is the whole
    point: nothing carried over from the previous poll, so it is one device
    however its address bits are set. `all_rpa=False` is passed here on
    purpose — that is what the classifier really returns for this device.
    """
    def nrpa(seq: int, count: int) -> list[str]:
        # 0x00-0x3F top byte — non-resolvable private, invisible to _is_rpa_addr
        return [f"{(seq * 7 + i) % 0x40:02X}:11:22:33:44:{i:02X}" for i in range(count)]

    prev = set(nrpa(0, 4))
    for seq in range(1, 40):
        # ~1.3s rotation against a 5s poll: several fresh addresses every frame
        macs = nrpa(seq, 4)
        d = decide_split(macs, prev, all_rpa=False, default_uuid=False, same_oui=False)
        assert d.split is False, f"poll {seq} split a non-resolvable rotator: {d.reason}"
        prev = set(macs)


def test_only_the_first_poll_of_an_unknown_rotator_can_split():
    """The fallback costs one poll, and persistence corrects it immediately.

    Worth asserting because the first-sighting path is the one place the old
    address heuristics still decide anything.
    """
    first = ["1A:00:00:00:00:01", "1B:00:00:00:00:02"]
    d0 = decide_split(first, None, all_rpa=False, default_uuid=False, same_oui=False)
    assert d0.split is True, "the fallback should be conservative on first sight"
    second = ["2C:00:00:00:00:03", "2D:00:00:00:00:04"]
    d1 = decide_split(second, set(first), all_rpa=False, default_uuid=False, same_oui=False)
    assert d1.split is False, d1.reason
