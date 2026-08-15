"""The ingest policy — what becomes an object, and what it costs.

Written against the case that prompted it (issue: a garage keypad rotating its
private address every 1.6 seconds, ~54,000 objects a day) and against the case
it has to survive: a commercial site where nobody can enumerate MACs by hand.
"""

from __future__ import annotations

import pytest

from custom_components.padspan_ha.ingest_policy import (
    ALLOW,
    MASK,
    Identity,
    IngestPolicy,
    Rule,
)

# The identity a fast-rotating iBeacon presents. Everything but `addr` is the
# same on every advertisement; `addr` is different every 1.6 seconds.
KEYPAD_KEY = "ibeacon:e2c56db5-dffb-48d2-b060-d0f5a71096e0:1:7"


def _keypad(addr: str) -> Identity:
    return Identity(addr=addr, key=KEYPAD_KEY,
                    uuid="e2c56db5-dffb-48d2-b060-d0f5a71096e0", name="")


def test_an_empty_policy_masks_nothing():
    policy = IngestPolicy.from_settings({})
    assert policy.active is False
    assert policy.decide(_keypad("AA:BB:CC:DD:EE:FF")) == (ALLOW, "")


def test_a_rotating_device_is_masked_by_its_stable_key_not_its_mac():
    """The point of the whole design.

    The device wears a different MAC every 1.6s, so a MAC-keyed exclusion would
    stop working before the user finished typing it. The stable key does not
    move, so one entry covers every rotation, forever.
    """
    policy = IngestPolicy.from_settings({"excluded_objects": [KEYPAD_KEY]})
    rotations = [f"7A:11:22:33:44:{i:02X}" for i in range(50)]
    assert all(policy.is_masked(_keypad(mac)) for mac in rotations)
    assert policy.masked["excluded by the user"] == 50


def test_masking_is_case_and_whitespace_insensitive():
    """These keys get pasted between installs and typed by hand."""
    policy = IngestPolicy.from_settings({"excluded_objects": ["  " + KEYPAD_KEY.upper() + "  "]})
    assert policy.is_masked(_keypad("AA:BB:CC:DD:EE:01"))


def test_a_whole_uuid_can_be_masked_across_every_major_and_minor():
    """What a site with a hundred identical tags actually needs.

    Enumerating stable keys works for one keypad and not for a floor of
    contractor tags that share a UUID and differ only by minor.
    """
    policy = IngestPolicy.from_settings({
        "ingest_rules": [{
            "action": "mask",
            "reason": "contractor tags",
            "match": {"uuids": ["e2c56db5-dffb-48d2-b060-d0f5a71096e0"]},
        }],
    })
    for minor in range(1, 200):
        ident = Identity(addr="7A:11:22:33:44:55",
                         key=f"ibeacon:e2c56db5-dffb-48d2-b060-d0f5a71096e0:1:{minor}",
                         uuid="e2c56db5-dffb-48d2-b060-d0f5a71096e0")
        assert policy.is_masked(ident)
    assert policy.masked["contractor tags"] == 199


def test_a_vendor_can_be_masked_by_oui():
    policy = IngestPolicy.from_settings({
        "ingest_rules": [{"action": "mask", "reason": "signage",
                          "match": {"ouis": ["48:87:2D"]}}],
    })
    assert policy.is_masked(Identity(addr="48:87:2D:00:11:22"))
    assert not policy.is_masked(Identity(addr="AA:BB:CC:00:11:22"))


def test_an_allow_rule_carves_an_exception_out_of_a_broad_mask():
    """Mask a whole vendor except the two tags we actually issued.

    Without this, a broad mask has to be written as an inverted list of
    everything else, which nobody maintains correctly.
    """
    policy = IngestPolicy.from_settings({
        "ingest_rules": [
            {"action": "allow", "reason": "our own tags",
             "match": {"addrs": ["48:87:2D:00:00:01"]}},
            {"action": "mask", "reason": "that vendor",
             "match": {"ouis": ["48:87:2D"]}},
        ],
    })
    assert not policy.is_masked(Identity(addr="48:87:2D:00:00:01"))
    assert policy.is_masked(Identity(addr="48:87:2D:99:99:99"))


def test_a_rule_that_matches_nothing_is_refused():
    """An empty match must not become "match everything".

    This setting gets copied between sites. A rule with no criteria that
    silently masked the whole building would be discovered weeks later.
    """
    policy = IngestPolicy.from_settings({
        "ingest_rules": [{"action": "mask", "reason": "oops", "match": {}}],
    })
    assert policy.rules == []
    assert not policy.is_masked(_keypad("AA:BB:CC:DD:EE:FF"))
    assert Rule(action=MASK, reason="empty").matches(_keypad("AA:BB:CC:DD:EE:FF")) is False


def test_malformed_rules_are_survived_not_raised():
    """Settings can be hand-edited, and ingest must never be the thing that dies."""
    policy = IngestPolicy.from_settings({
        "excluded_objects": [None, "", "  ", KEYPAD_KEY],
        "ingest_rules": ["nonsense", 42, None, {"match": "not-a-dict"}, {}],
    })
    assert policy.is_masked(_keypad("AA:BB:CC:DD:EE:FF"))
    assert policy.decide(Identity(addr="11:22:33:44:55:66"))[0] == ALLOW


def test_the_oui_of_a_random_address_never_masks_on_its_own():
    """A resolvable private address has random top bits.

    Its "OUI" is not a vendor, so an OUI rule must only fire when someone has
    explicitly asked for that prefix — never as a side effect of another rule.
    """
    policy = IngestPolicy.from_settings({"excluded_objects": [KEYPAD_KEY]})
    other = Identity(addr="7A:11:22:33:44:55", key="ibeacon:other:1:1")
    assert not policy.is_masked(other)


def test_diagnostics_say_what_was_hidden_and_why():
    """A silent filter is indistinguishable from a bug."""
    policy = IngestPolicy.from_settings({
        "excluded_objects": [KEYPAD_KEY],
        "ingest_rules": [{"action": "mask", "reason": "signage",
                          "match": {"ouis": ["48:87:2D"]}}],
    })
    for i in range(5):
        policy.is_masked(_keypad(f"7A:00:00:00:00:{i:02X}"))
    for i in range(3):
        policy.is_masked(Identity(addr=f"48:87:2D:00:00:{i:02X}"))
    diag = policy.diagnostics()
    assert diag["rules"] == 2
    assert diag["masked_total"] == 8
    assert diag["masked_by_reason"]["excluded by the user"] == 5
    assert diag["masked_by_reason"]["signage"] == 3


def test_the_saving_is_the_whole_point():
    """One device at a 1.6s rotation, over a day, masked by one entry."""
    policy = IngestPolicy.from_settings({"excluded_objects": [KEYPAD_KEY]})
    per_day = int(86400 / 1.6)
    masked = sum(1 for i in range(per_day) if policy.is_masked(_keypad(f"7A:{i % 256:02X}:00:00:00:01")))
    assert masked == per_day == 54000
