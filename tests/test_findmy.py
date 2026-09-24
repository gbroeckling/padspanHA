# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Apple Find My tags across address changes (findmy.py).

Garry, 2026-09-23: "make sure that works in padspan" — a Find My tag (an
AirTag, or a "works with Find My" tag like his LAPONC) changes its address
every 15 minutes near its owner and daily when separated. Before this, a
labelled tag became a new, nameless object at every change: PadSpan's bridge
only looked at resolvable private addresses (first byte 0x40-0x7F), and a
Find My address is a static random one (0xC0-0xFF), so it was never bridged
at all — while the bridge's fingerprint (company | services | connectable)
was identical for every Apple device, iPhones and AirPods included.
"""

from __future__ import annotations

from custom_components.padspan_ha import findmy as F


def _status(device_type: int, battery: int = 0) -> int:
    return (battery << 6) | (device_type << 4)


def _separated(device_type: int, key_byte: int = 0x11, battery: int = 0) -> str:
    """A separated tag's Apple payload in bluetooth_live.py's "0x.." form."""
    body = [0x12, 0x19, _status(device_type, battery)] + [key_byte] * 22 + [0x01, 0x00]
    return " ".join(f"0x{b:02X}" for b in body)


def _nearby(device_type: int, battery: int = 0) -> str:
    return " ".join(f"0x{b:02X}" for b in (0x12, 0x02, _status(device_type, battery), 0x01))


IPHONE = "0x10 0x05 0x01 0x18 0x12 0x34 0x56"     # Nearby Info — not Find My


def _rec(payload: str, sources: dict[str, float], age: float = 1.0) -> dict:
    return {"age_s": age, "manufacturer_data": {"76": payload},
            "sources": {s: {"rssi": r, "age_s": age} for s, r in sources.items()}}


KITCHEN = {"kitchen": -55.0, "hall": -72.0, "office": -88.0}
OFFICE = {"kitchen": -86.0, "hall": -70.0, "office": -52.0}

KEYS_1, KEYS_2, KEYS_3 = "D1:11:11:11:11:11", "E2:22:22:22:22:22", "F3:33:33:33:33:33"
BAG_1, BAG_2 = "C4:44:44:44:44:44", "D5:55:55:55:55:55"
PHONE_1, PHONE_2 = "4A:AA:AA:AA:AA:AA", "5B:BB:BB:BB:BB:BB"   # resolvable private (iPhone)


# ── the advertisement ─────────────────────────────────────────────────────────


def test_a_find_my_advertisement_is_read_in_every_shape_padspan_stores():
    sep = F.parse_findmy({"76": _separated(1, battery=2)})
    assert sep == {"separated": True, "status": 0xA0 & 0xF0 | 0x10 | 0x80 & 0, "device_type": 1, "battery": 2} or \
        (sep["separated"], sep["device_type"], sep["battery"]) == (True, 1, 2)
    near = F.parse_findmy({76: bytes([0x12, 0x02, _status(2), 0x01])})
    assert (near["separated"], near["device_type"]) == (False, 2)
    assert F.parse_findmy({"76": "1219" + f"{_status(3):02x}" + "00" * 24})["device_type"] == 3
    assert F.parse_findmy({"76": IPHONE}) is None
    assert F.parse_findmy({"76": "0x12"}) is None
    assert F.parse_findmy({"117": _separated(1)}) is None      # not Apple's
    assert F.DEVICE_TYPES[2] == "Find My accessory"


def test_only_a_static_random_address_can_be_a_find_my_key():
    assert F.is_findmy_address(KEYS_1) and F.is_findmy_address("FF:00:00:00:00:00")
    assert not F.is_findmy_address(PHONE_1) and not F.is_findmy_address("48:87:2D:00:00:01")
    assert not F.is_findmy_address("garbage")


# ── the house: two tags and an iPhone ─────────────────────────────────────────


def _poll(bridge, t, records, known=None):
    return bridge.step(t, records, known or {})


def test_two_tags_and_an_iphone_each_keep_their_own_identity():
    """Keys (an AirTag, kitchen) and Bag (a Find My accessory, office) are
    labelled; an iPhone walks around. Keys changes address, then the iPhone
    changes, then Bag — each tag carries on as itself, the iPhone never
    becomes either."""
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    t = 1000.0
    r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(2), OFFICE),
                     PHONE_1: _rec(IPHONE, KITCHEN)}, known)
    assert r["map"] == {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    # Keys goes quiet; its next address starts in the kitchen. The iPhone's
    # new address starts in the kitchen too — but it isn't a Find My tag.
    t += 20
    recs = {KEYS_1: _rec(_separated(1), KITCHEN, age=12), KEYS_2: _rec(_separated(1, 0x22), KITCHEN),
            BAG_1: _rec(_separated(2), OFFICE), PHONE_1: _rec(IPHONE, KITCHEN, age=12), PHONE_2: _rec(IPHONE, KITCHEN)}
    r = _poll(b, t, recs, known)
    assert r["linked"] == [("ble:" + KEYS_1, KEYS_1, KEYS_2)]
    assert r["map"][KEYS_2] == "ble:" + KEYS_1 and PHONE_2 not in r["map"]
    # Bag changes: its new address in the office is Bag, never Keys.
    t += 20
    recs = {KEYS_2: _rec(_separated(1, 0x22), KITCHEN), BAG_1: _rec(_separated(2), OFFICE, age=15),
            BAG_2: _rec(_separated(2, 0x33), OFFICE)}
    r = _poll(b, t, recs, {BAG_1: "ble:" + BAG_1})
    assert r["linked"] == [("ble:" + BAG_1, BAG_1, BAG_2)]
    assert r["map"] == {KEYS_2: "ble:" + KEYS_1, BAG_2: "ble:" + BAG_1}


def test_a_tag_is_followed_through_change_after_change():
    b = F.FindMyBridge()
    k = "ble:" + KEYS_1
    _poll(b, 0.0, {KEYS_1: _rec(_nearby(1), KITCHEN)}, {KEYS_1: k})
    _poll(b, 900.0, {KEYS_1: _rec(_nearby(1), KITCHEN, age=8), KEYS_2: _rec(_nearby(1), KITCHEN)})
    r = _poll(b, 1800.0, {KEYS_2: _rec(_nearby(1), KITCHEN, age=9), KEYS_3: _rec(_separated(1), KITCHEN)})
    assert r["map"] == {KEYS_3: k}, "near-owner and separated advertisements are one tag"


def test_two_tags_lying_together_that_change_together_are_not_guessed():
    """Separated tags all change at about 04:00 local: two in one drawer
    can't be told apart then — nothing is linked rather than a coin toss."""
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)}, known)
    r = _poll(b, 20.0, {KEYS_1: _rec(_separated(1), KITCHEN, age=15), BAG_1: _rec(_separated(1), KITCHEN, age=15),
                        KEYS_2: _rec(_separated(1, 0x22), {"kitchen": -56.0, "hall": -71.0, "office": -88.0}),
                        BAG_2: _rec(_separated(1, 0x33), {"kitchen": -54.0, "hall": -73.0, "office": -87.0})})
    assert r["linked"] == [] and KEYS_2 not in r["map"] and BAG_2 not in r["map"]


def test_the_same_two_tags_apart_are_each_linked():
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), OFFICE)}, known)
    r = _poll(b, 20.0, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN), BAG_2: _rec(_separated(1, 0x33), OFFICE)})
    assert sorted(r["linked"]) == sorted([("ble:" + KEYS_1, KEYS_1, KEYS_2), ("ble:" + BAG_1, BAG_1, BAG_2)])


def test_never_onto_an_address_while_the_old_one_is_still_advertising():
    b = F.FindMyBridge()
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    r = _poll(b, 20.0, {KEYS_1: _rec(_separated(1), KITCHEN, age=1), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    assert r["linked"] == [] and r["map"] == {KEYS_1: "ble:" + KEYS_1}


def test_a_neighbours_tag_that_was_there_all_along_is_not_a_hand_over():
    b = F.FindMyBridge()
    k = "ble:" + KEYS_1
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: k})
    _poll(b, 300.0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)})
    r = _poll(b, 320.0, {KEYS_1: _rec(_separated(1), KITCHEN, age=15), BAG_1: _rec(_separated(1), KITCHEN)})
    assert r["linked"] == [], "the neighbour's tag started long before Keys went quiet"


def test_a_different_kind_of_find_my_device_is_never_linked():
    """AirPods and Macs send Find My too (types 3 and 0)."""
    b = F.FindMyBridge()
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    r = _poll(b, 20.0, {KEYS_2: _rec(_separated(3), KITCHEN), KEYS_3: _rec(_separated(0), KITCHEN)})
    assert r["linked"] == []


def test_a_new_address_somewhere_else_is_not_the_tag():
    b = F.FindMyBridge()
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    r = _poll(b, 20.0, {KEYS_2: _rec(_separated(1), OFFICE)})
    assert r["linked"] == []


def test_too_long_a_gap_is_not_a_hand_over():
    b = F.FindMyBridge()
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    r = _poll(b, F.HANDOVER_WINDOW_S + 30, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    assert r["linked"] == []


def test_the_links_survive_a_restart_through_their_saved_state():
    b = F.FindMyBridge()
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    _poll(b, 20.0, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    again = F.FindMyBridge(b.to_state())
    r = again.step(40.0, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN)}, {})
    assert r["map"] == {KEYS_2: "ble:" + KEYS_1}
    assert again.identity_of(KEYS_2) == "ble:" + KEYS_1


def test_a_tag_not_heard_for_days_is_forgotten():
    b = F.FindMyBridge()
    _poll(b, 0.0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    r = _poll(b, F.FORGET_S + 10, {})
    assert r["map"] == {} and b.tags == {}


def test_place_difference_counts_a_strong_scanner_the_other_never_heard():
    assert F.place_difference({"a": -50.0}, {"a": -54.0}) == 4.0
    assert F.place_difference({"a": -50.0, "b": -60.0}, {"a": -50.0}) == F.UNSHARED_PENALTY_DB / 2
    assert F.place_difference({"a": -50.0, "b": -95.0}, {"a": -50.0}) == 0.0
    assert F.place_difference({"a": -50.0}, {"b": -50.0}) is None
