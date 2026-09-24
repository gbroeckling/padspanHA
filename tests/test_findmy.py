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
    assert sep == {"separated": True, "status": 0x90, "device_type": 1, "battery": 2}
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
#
# Timing, as Home Assistant reports it: a tag last heard at `last`, its next
# address first reported a few seconds later; the old address lingers in the
# list with a growing age (it is never removed at once). A link can only be
# made once the old address has been quiet for F.LIVE_S.

T0 = 1_000_000.0


def _poll(bridge, t, records, known=None):
    return bridge.step(T0 + t, records, known or {})


def _change(bridge, old, new, payload_old, payload_new, place_old, place_new=None, known=None, t0=0.0):
    """old heard at t0; new first reported at t0+20; linked at t0+100."""
    _poll(bridge, t0, {old: _rec(payload_old, place_old)}, known)
    _poll(bridge, t0 + 20, {old: _rec(payload_old, place_old, age=21), new: _rec(payload_new, place_new or place_old)}, known)
    return _poll(bridge, t0 + 100, {old: _rec(payload_old, place_old, age=101), new: _rec(payload_new, place_new or place_old)}, known)


def test_two_tags_and_an_iphone_each_keep_their_own_identity():
    """Keys (an AirTag, kitchen) and Bag (a Find My accessory, office) are
    labelled; an iPhone walks around. Keys changes address, then Bag — each
    carries on as itself; the iPhone never becomes either."""
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(2), OFFICE), PHONE_1: _rec(IPHONE, KITCHEN)}, known)
    _poll(b, 20, {KEYS_1: _rec(_separated(1), KITCHEN, age=21), KEYS_2: _rec(_separated(1, 0x22), KITCHEN),
                  BAG_1: _rec(_separated(2), OFFICE), PHONE_2: _rec(IPHONE, KITCHEN)}, known)
    r = _poll(b, 100, {KEYS_1: _rec(_separated(1), KITCHEN, age=101), KEYS_2: _rec(_separated(1, 0x22), KITCHEN),
                       BAG_1: _rec(_separated(2), OFFICE), PHONE_2: _rec(IPHONE, KITCHEN)}, known)
    assert r["linked"] == [("ble:" + KEYS_1, KEYS_1, KEYS_2)]
    assert r["map"][KEYS_2] == "ble:" + KEYS_1 and PHONE_2 not in r["map"]
    # Bag changes: its new address in the office is Bag, never Keys.
    _poll(b, 120, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN), BAG_1: _rec(_separated(2), OFFICE, age=21),
                   BAG_2: _rec(_separated(2, 0x33), OFFICE)}, known)
    r = _poll(b, 200, {KEYS_1: _rec(_separated(1), KITCHEN, age=201), KEYS_2: _rec(_separated(1, 0x22), KITCHEN),
                       BAG_1: _rec(_separated(2), OFFICE, age=101), BAG_2: _rec(_separated(2, 0x33), OFFICE)}, known)
    assert r["linked"] == [("ble:" + BAG_1, BAG_1, BAG_2)]
    assert r["map"] == {KEYS_2: "ble:" + KEYS_1, BAG_2: "ble:" + BAG_1}


def test_a_tag_is_followed_through_change_after_change():
    b = F.FindMyBridge()
    k = KEYS_1          # as the snapshot keys it: the address it was first known by
    _change(b, KEYS_1, KEYS_2, _nearby(1), _nearby(1), KITCHEN, known={KEYS_1: k})
    r = _change(b, KEYS_2, KEYS_3, _nearby(1), _separated(1), KITCHEN, t0=1000.0)
    assert r["map"] == {KEYS_3: k}, "near-owner and separated advertisements are one tag"
    assert b.addresses_of(k) == [KEYS_1, KEYS_2, KEYS_3]


def test_a_lingering_labelled_old_address_never_pulls_the_identity_back():
    """Round 8: the old address stays in HA's list (up to 4 h) with its label;
    it used to re-seed and re-point the tag at the dead address."""
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1}
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known=known)
    for t in (120, 300, 3600):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)}, known)
        assert r["map"] == {KEYS_2: "ble:" + KEYS_1}, t
    assert b.identity_of(KEYS_1) == "ble:" + KEYS_1


def test_two_tags_lying_together_that_change_together_are_not_guessed():
    """Separated tags all change at about 04:00 local: two in one drawer
    can't be told apart then — nothing is linked rather than a coin toss."""
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    near_k = {"kitchen": -56.0, "hall": -71.0, "office": -88.0}
    near_b = {"kitchen": -54.0, "hall": -73.0, "office": -87.0}
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)}, known)
    _poll(b, 20, {KEYS_2: _rec(_separated(1, 0x22), near_k), BAG_2: _rec(_separated(1, 0x33), near_b)}, known)
    r = _poll(b, 100, {KEYS_2: _rec(_separated(1, 0x22), near_k), BAG_2: _rec(_separated(1, 0x33), near_b)}, known)
    assert r["linked"] == [] and KEYS_2 not in r["map"] and BAG_2 not in r["map"]


def test_a_rival_just_past_the_limit_still_counts():
    """Round 8: a rival at 10.4 dB was ignored because only pairs under
    MAX_DB were compared — Keys took Bag's address at 9.8 dB."""
    b = F.FindMyBridge()
    here = {"kitchen": -55.0, "hall": -72.0}
    _poll(b, 0, {KEYS_1: _rec(_separated(1), here)}, {KEYS_1: "ble:" + KEYS_1})
    a = {"kitchen": -45.2, "hall": -72.0}      # 9.8 dB away
    c = {"kitchen": -44.6, "hall": -72.0}      # 10.4 dB away
    _poll(b, 20, {KEYS_2: _rec(_separated(1, 0x22), a), BAG_2: _rec(_separated(1, 0x33), c)})
    r = _poll(b, 100, {KEYS_2: _rec(_separated(1, 0x22), a), BAG_2: _rec(_separated(1, 0x33), c)})
    assert r["linked"] == []


def test_the_same_two_tags_apart_are_each_linked():
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), OFFICE)}, known)
    _poll(b, 20, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN), BAG_2: _rec(_separated(1, 0x33), OFFICE)})
    r = _poll(b, 100, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN), BAG_2: _rec(_separated(1, 0x33), OFFICE)})
    assert sorted(r["linked"]) == sorted([("ble:" + KEYS_1, KEYS_1, KEYS_2), ("ble:" + BAG_1, BAG_1, BAG_2)])


def test_a_live_tag_reported_late_has_not_stopped():
    """Round 8: a passive proxy's repeats reach PadSpan only at each reseed
    (30-60 s). A tag reported 60 s ago is live — a same-type tag put down
    next to it is not its next address."""
    b = F.FindMyBridge()
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    for t in (20, 40, 60):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1 if t < 60 else 60),
                         KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
        assert r["linked"] == [], t
    r = _poll(b, 70, {KEYS_1: _rec(_separated(1), KITCHEN, age=2), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    assert r["linked"] == [] and r["map"] == {KEYS_1: "ble:" + KEYS_1}


def test_a_visitors_tag_arriving_after_the_tag_left_is_not_it():
    """Round 8: Keys goes out of range at the door; a visitor's AirTag
    arrives at the door a minute later — not a hand-over."""
    b = F.FindMyBridge()
    door = {"hall": -60.0, "kitchen": -80.0}
    _poll(b, 0, {KEYS_1: _rec(_separated(1), door)}, {KEYS_1: "ble:" + KEYS_1})
    _poll(b, 60, {KEYS_1: _rec(_separated(1), door, age=61), BAG_1: _rec(_separated(1), door)})
    r = _poll(b, 120, {KEYS_1: _rec(_separated(1), door, age=121), BAG_1: _rec(_separated(1), door)})
    assert r["linked"] == []


def test_a_neighbours_tag_that_was_there_all_along_is_not_a_hand_over():
    b = F.FindMyBridge()
    k = "ble:" + KEYS_1
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: k})
    _poll(b, 300, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)})
    r = _poll(b, 400, {KEYS_1: _rec(_separated(1), KITCHEN, age=100), BAG_1: _rec(_separated(1), KITCHEN)})
    assert r["linked"] == [], "the neighbour's tag started long before Keys went quiet"


def test_after_a_restart_nothing_already_in_range_looks_new():
    """Round 8: first_seen is in memory only — after a restart every address
    looked newly arrived for a moment."""
    b = F.FindMyBridge()
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    again = F.FindMyBridge(b.to_state())
    _poll(again, 5, {KEYS_1: _rec(_separated(1), KITCHEN, age=6), BAG_1: _rec(_separated(1), KITCHEN)})
    r = _poll(again, 100, {KEYS_1: _rec(_separated(1), KITCHEN, age=101), BAG_1: _rec(_separated(1), KITCHEN)})
    assert r["linked"] == []


def test_a_different_kind_of_find_my_device_is_never_linked():
    """AirPods and Macs send Find My too (types 3 and 0)."""
    b = F.FindMyBridge()
    r = _change(b, KEYS_1, KEYS_2, _separated(1), _separated(3), KITCHEN, known={KEYS_1: "ble:" + KEYS_1})
    assert r["linked"] == []
    b = F.FindMyBridge()
    r = _change(b, KEYS_1, KEYS_2, _separated(1), _separated(0), KITCHEN, known={KEYS_1: "ble:" + KEYS_1})
    assert r["linked"] == []


def test_a_new_address_somewhere_else_is_not_the_tag():
    b = F.FindMyBridge()
    r = _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, OFFICE, known={KEYS_1: "ble:" + KEYS_1})
    assert r["linked"] == []


def test_a_scanner_only_one_side_hears_never_makes_two_places_alike():
    """Round 8: a strong one-sided scanner added 8 dB, below MAX_DB, so it
    lowered the average — a kitchen tag linked to an office address."""
    kitchen = {"kitchen": -55.0, "hall": -70.0}
    office = {"office": -50.0, "hall": -85.0}
    assert F.place_difference(kitchen, office) > F.MAX_DB


def test_too_long_a_gap_is_not_a_hand_over():
    b = F.FindMyBridge()
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    t = F.HANDOVER_WINDOW_S + 30
    _poll(b, t - 20, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    r = _poll(b, t, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    assert r["linked"] == []


def test_the_links_survive_a_restart_through_their_saved_state():
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: "ble:" + KEYS_1})
    again = F.FindMyBridge(b.to_state())
    r = _poll(again, 200, {KEYS_1: _rec(_separated(1), KITCHEN, age=201), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)},
              {KEYS_1: "ble:" + KEYS_1})
    assert r["map"] == {KEYS_2: "ble:" + KEYS_1}
    assert again.identity_of(KEYS_1) == again.identity_of(KEYS_2) == "ble:" + KEYS_1


def test_a_tag_not_heard_for_days_is_forgotten():
    b = F.FindMyBridge()
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: "ble:" + KEYS_1})
    r = _poll(b, F.FORGET_S + 10, {})
    assert r["map"] == {} and b.tags == {}


def test_place_difference_counts_a_strong_scanner_the_other_never_heard():
    assert F.place_difference({"a": -50.0}, {"a": -54.0}) == 4.0
    assert F.place_difference({"a": -50.0, "b": -60.0}, {"a": -50.0}) == F.UNSHARED_PENALTY_DB / 2
    assert F.place_difference({"a": -50.0, "b": -95.0}, {"a": -50.0}) == 0.0
    assert F.place_difference({"a": -50.0}, {"b": -50.0}) is None


# ── wired into the snapshot ──────────────────────────────────────────────────


def _hass_for(labels=None, followed=None):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock
    from custom_components.padspan_ha.const import DATA_OBJECTS, DATA_SETTINGS, DOMAIN
    labels = labels or {}
    settings = SimpleNamespace(data={"followed_addrs": list(followed or []), "mac_rotation_bridging": True},
                               async_set=AsyncMock())
    store = SimpleNamespace(async_delay_save=MagicMock())
    return SimpleNamespace(data={DOMAIN: {
        DATA_SETTINGS: settings,
        DATA_OBJECTS: SimpleNamespace(get_label=lambda a: labels.get(a)),
        "findmy_bridge": F.FindMyBridge(), "findmy_bridge_store": store}}), settings, store


async def test_every_address_a_moved_tag_used_maps_to_one_identity_and_follow_is_left_alone():
    from custom_components.padspan_ha import snapshot_builder as SB
    hass, settings, store = _hass_for({KEYS_1: "Keys"}, followed=[KEYS_1])
    canon = {}
    await SB._findmy_step(hass, {KEYS_1: _rec(_separated(1), KITCHEN), PHONE_1: _rec(IPHONE, KITCHEN)}, canon, {}, {}, now_ts=T0)
    assert canon == {}, "on its first address a tag is an ordinary object"
    canon = {}
    await SB._findmy_step(hass, {KEYS_1: _rec(_separated(1), KITCHEN, age=21), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)},
                          canon, {}, {}, now_ts=T0 + 20)
    assert canon == {}
    canon = {}
    linked = await SB._findmy_step(hass, {KEYS_1: _rec(_separated(1), KITCHEN, age=101), KEYS_2: _rec(_separated(1, 0x22), KITCHEN),
                                          PHONE_2: _rec(IPHONE, KITCHEN)}, canon, {}, {}, now_ts=T0 + 100)
    assert linked == [(KEYS_1, KEYS_1, KEYS_2)]
    # BOTH addresses — the lingering first one too — are the one tag.
    assert canon[KEYS_1] is canon[KEYS_2]
    assert canon[KEYS_2]["key"] == "ble:" + KEYS_1 and canon[KEYS_2]["canonical_id"] == KEYS_1
    assert PHONE_2 not in canon
    assert settings.data["followed_addrs"] == [KEYS_1], "open panels hold their own copy: never rewritten"
    settings.async_set.assert_not_called()
    store.async_delay_save.assert_called_once()
    # Later polls: the mapping holds while the old address lingers, labelled.
    for t in (120, 600):
        canon = {}
        await SB._findmy_step(hass, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)},
                              canon, {}, {}, now_ts=T0 + t)
        assert canon[KEYS_2]["key"] == "ble:" + KEYS_1 and canon[KEYS_1] is canon[KEYS_2], t


async def test_an_unknown_tag_is_never_given_an_identity():
    from custom_components.padspan_ha import snapshot_builder as SB
    hass, _s, _st = _hass_for()
    canon: dict = {}
    for t, recs in ((0, {KEYS_1: _rec(_separated(1), KITCHEN)}),
                    (20, {KEYS_1: _rec(_separated(1), KITCHEN, age=21), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)}),
                    (100, {KEYS_1: _rec(_separated(1), KITCHEN, age=101), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})):
        await SB._findmy_step(hass, recs, canon, {}, {}, now_ts=T0 + t)
    from custom_components.padspan_ha.const import DOMAIN
    assert canon == {} and hass.data[DOMAIN]["findmy_bridge"].tags == {}


def test_the_merged_object_keeps_the_key_it_was_first_known_by():
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha" / "snapshot_builder.py").read_text(encoding="utf-8")
    assert '"key": canonical.get("key") or cid,' in src
    # The Apple display classifier reads "0x.." payloads through findmy's parser.
    i = src.index("_APPLE_SUBTYPES = {")
    assert "bytes.fromhex(apple_data)" not in src[i:i + 4000] and "apple_payload(manuf)" in src[i:i + 4000]


def test_a_moved_tags_room_follows_its_live_address():
    """Round 9: the object keeps the address it was named by (the first);
    the room tracker smoothed THAT — silent since the change — and the tag's
    room froze where it was. It reads current_address now."""
    from tests.test_poll_level import make_coordinator, run_poll
    radios = [{"source": "kit", "area_name": "Kitchen"}, {"source": "off", "area_name": "Office"}]
    kitchen, office = {"kit": -50.0, "off": -90.0}, {"kit": -90.0, "off": -50.0}
    ads = lambda addr, vec, age=1.0: [{"address": addr, "source": s, "rssi": r, "age_s": age} for s, r in vec.items()]  # noqa: E731
    snap = lambda objs, adv: {"objects": {"list": objs}, "ble": {"advertisements": adv, "radios": radios}}  # noqa: E731
    coord = make_coordinator()
    key = "ble:" + KEYS_1
    for _ in range(12):
        r = run_poll(coord, snap([{"key": key, "kind": "ble", "address": KEYS_1, "name": "Keys"}], ads(KEYS_1, kitchen)))
    assert r[key].get("room") == "Kitchen"
    for _ in range(40):
        o = {"key": key, "kind": "private_ble", "address": KEYS_1, "canonical_id": KEYS_1, "all_addresses": [KEYS_2, KEYS_1],
             "current_address": KEYS_2, "findmy": True, "bridge_match": True, "name": "Keys", "room": "Office"}
        r = run_poll(coord, snap([o], ads(KEYS_1, kitchen, age=400) + ads(KEYS_2, office)))
    assert r[key].get("room") == "Office"


def test_the_bluetooth_tab_knows_a_moved_tag_by_its_live_address():
    """Round 9: the tab indexed objects by o.address only — the moved tag drew
    as its raw live MAC, vanished in quiet mode, and the Monitor list called
    it IRK-resolved with no Find My badge."""
    import json
    import shutil
    import subprocess
    from pathlib import Path
    node = shutil.which("node")
    if node is None:
        import pytest
        pytest.skip("node is not installed")
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([node, str(root / "tests" / "js" / "bt_findmy.mjs"), str(root).replace("\\", "/")],
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert r.returncode == 0, r.stderr[-2000:]
    out = json.loads(r.stdout.strip().splitlines()[-1])
    assert out == {"named": True, "quietShown": True, "findMyBadge": True, "irk": False,
                   "unlinkOnLive": True, "unlinkOnNamed": False}, out


def test_a_wrong_link_can_be_undone_and_never_comes_back():
    """Round 9: a visitor's tag linked as Keys stayed Keys for days (FORGET_S)
    and relabelling it renamed Keys itself. 'Not this tag' undoes the link."""
    b = F.FindMyBridge()
    k = KEYS_1
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
    assert b.tags[k]["addr"] == KEYS_2
    assert b.unlink(k, T0 + 150) == (KEYS_2, KEYS_1)
    assert b.unlink(k, T0 + 151) is None, "nothing left to undo"
    for t in (160, 260, 400):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
        assert r["linked"] == [] and KEYS_2 not in r["map"], t
    assert b.identity_of(KEYS_2) is None and b.identity_of(KEYS_1) == k
    # Kept through a restart.
    assert F.FindMyBridge(b.to_state()).tags[k]["refused"] == [KEYS_2]


async def test_the_unlink_command_answers_for_the_objects_key():
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from custom_components.padspan_ha import ws_objects as WO
    from custom_components.padspan_ha.const import DOMAIN
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: KEYS_1})
    store = SimpleNamespace(async_delay_save=MagicMock())
    hass = SimpleNamespace(data={DOMAIN: {"findmy_bridge": b, "findmy_bridge_store": store}})
    sent = {}
    conn = SimpleNamespace(send_result=lambda i, r: sent.update(result=r), send_error=lambda i, c, m: sent.update(error=c))
    await WO.ws_findmy_unlink(hass, conn, {"id": 1, "key": "ble:" + KEYS_1.lower()})
    assert sent["result"] == {"unlinked": KEYS_2, "back_to": KEYS_1}
    store.async_delay_save.assert_called_once()
    await WO.ws_findmy_unlink(hass, conn, {"id": 2, "key": "ble:" + KEYS_1})
    assert sent["error"] == "not_linked"


def test_a_replayed_advert_keeps_its_real_age(monkeypatch):
    """Round 11: registering a callback makes HA replay its cached history;
    _on_adv stamped those 'now', so a 400 s-old address read as live."""
    import sys
    import time
    from types import SimpleNamespace
    from custom_components.padspan_ha import bluetooth_live as BL
    from custom_components.padspan_ha.const import DOMAIN
    mono = time.monotonic()
    live = SimpleNamespace(rssi=-50, manufacturer_data={76: bytes([0x12, 0x19, 0x10] + [0x22] * 22 + [1, 0])},
                           service_data={}, service_uuids=[], tx_power=None, local_name=None)
    scanner = SimpleNamespace(source="kit",
                              discovered_devices_and_advertisement_data={KEYS_2: (SimpleNamespace(address=KEYS_2, name=None), live)},
                              discovered_device_timestamps={KEYS_2: mono - 1.0})
    monkeypatch.setitem(sys.modules, "habluetooth",
                        SimpleNamespace(get_manager=lambda: SimpleNamespace(async_current_scanners=lambda: [scanner])))
    bl = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
    replayed = SimpleNamespace(address=KEYS_1, name=None, source="kit", rssi=-50, time=mono - 400.0,
                               manufacturer_data={76: bytes([0x12, 0x19, 0x10] + [0x11] * 22 + [1, 0])},
                               service_data={}, service_uuids=[], tx_power=None, connectable=True)
    bl._on_adv(replayed)
    bl._seed_from_discovered()
    ages = {a["address"]: a["age_s"] for a in bl.get_snapshot(max_ads=5000, max_age_s=14400)["advertisements"]}
    assert 395 <= ages[KEYS_1] <= 410, ages
    assert ages[KEYS_2] < 5, ages


# ── review round 12 ──────────────────────────────────────────────────────────


def _heard(payload, place, built, heard):
    """A record as the snapshot hands it over: last heard at `heard`, its age
    measured when the BLE snapshot was taken (`built`), a moment before the
    bridge's step reads it."""
    from datetime import datetime, timezone
    r = _rec(payload, place, age=built - heard)
    r["last_seen"] = datetime.fromtimestamp(T0 + heard, tz=timezone.utc).isoformat()
    return r


def test_one_unchanged_report_never_confirms_a_return():
    """Round 12: the return rule took 'now - age' as when an address was
    heard. The ages are measured when the BLE snapshot is taken and the
    bridge steps a varying moment later, so ONE report (a replayed one)
    looked a little newer on every poll and confirmed itself."""
    b = F.FindMyBridge()
    k = KEYS_1
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
    for now in (202.0, 204.5, 207.0):
        r = _poll(b, now, {KEYS_1: _heard(_separated(1), KITCHEN, 202.0, 200.0),
                           KEYS_2: _heard(_separated(1, 0x22), KITCHEN, 202.0, 201.0)})
        assert r["unlinked"] == [], now
    assert b.tags[k]["addr"] == KEYS_2


def test_a_real_return_is_confirmed_at_a_passive_proxys_pace():
    """Round 12: a passive proxy's repeats of a steady advert reach PadSpan
    only at each 30-60 s reseed, and the rule dropped the first report once
    it was 10 s old — a tag back on its day key was never followed there.
    The second report, 35 s later, confirms it."""
    b = F.FindMyBridge()
    k = KEYS_1
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
    for now in range(301, 346, 5):
        heard = 300.0 if now < 335 else 335.0
        r = _poll(b, float(now), {KEYS_1: _heard(_separated(1), KITCHEN, now, heard),
                                  KEYS_2: _heard(_separated(1, 0x22), KITCHEN, now, 290.0)})
        if b.tags[k]["addr"] == KEYS_1:
            break
    assert b.tags[k]["addr"] == KEYS_1 and r["unlinked"] == [(k, KEYS_2, KEYS_1)], (now, b.tags[k])
    assert now == 336, "confirmed by the second report, not before"


def _bl(monkeypatch):
    import sys
    from types import SimpleNamespace
    from custom_components.padspan_ha import bluetooth_live as BL
    from custom_components.padspan_ha.const import DOMAIN
    monkeypatch.setitem(sys.modules, "habluetooth",
                        SimpleNamespace(get_manager=lambda: SimpleNamespace(async_current_scanners=lambda: [])))
    return BL, BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))


def _adv(addr, rssi, stamp, status=0x10, source="kit"):
    from types import SimpleNamespace
    return SimpleNamespace(address=addr, name=None, source=source, rssi=rssi, time=stamp,
                           manufacturer_data={76: bytes([0x12, 0x19, status] + [0x11] * 22 + [1, 0])},
                           service_data={}, service_uuids=[], tx_power=None, connectable=True)


def test_a_report_from_before_this_boot_keeps_its_real_age(monkeypatch):
    """Round 12: habluetooth restores its stored history with monotonic
    stamps from before this boot — NEGATIVE ones when the report is older
    than the host's uptime. Only positive stamps were aged, so those replayed
    as heard just now."""
    import time
    BL, bl = _bl(monkeypatch)
    monkeypatch.setattr(time, "monotonic", lambda: 100.0)       # up 100 s
    bl._on_adv(_adv(KEYS_1, -50, -500.0))                       # heard 600 s ago
    age = (BL._now() - bl._seen_by_source[KEYS_1]["kit"].seen).total_seconds()
    assert 595 <= age <= 605, age


def test_a_live_advert_lands_after_the_clock_steps_back(monkeypatch):
    """Round 12: 'an older report never replaces a newer one' was judged by
    the wall clock alone — after the clock stepped back (an NTP correction)
    every live advert was 'older' than the last and was dropped, freezing
    the readings for as long as the step. A replayed report still never
    replaces a newer one."""
    import datetime as dt
    import time
    BL, bl = _bl(monkeypatch)
    bl._on_adv(_adv(KEYS_1, -50, time.monotonic()))
    real_now = BL._now
    monkeypatch.setattr(BL, "_now", lambda: real_now() - dt.timedelta(seconds=300))
    bl._on_adv(_adv(KEYS_1, -70, time.monotonic(), status=0x50))   # HA passes on only a changed payload
    assert bl._seen_by_source[KEYS_1]["kit"].record["rssi"] == -70
    bl._on_adv(_adv(KEYS_1, -90, time.monotonic() - 400.0))    # replayed history
    assert bl._seen_by_source[KEYS_1]["kit"].record["rssi"] == -70


# ── review round 13 ──────────────────────────────────────────────────────────


def test_a_pending_return_does_not_outlive_its_link():
    """Round 13: "Not this tag" left a pending return in place. After the tag
    was re-linked, ONE fresh report of its old address confirmed against
    that stale entry and moved the tag back — what the two-report rule
    exists to prevent."""
    b = F.FindMyBridge()
    k = KEYS_1
    A, B, C, D = KEYS_1, KEYS_2, KEYS_3, BAG_1
    _change(b, A, B, _separated(1), _separated(1, 0x22), KITCHEN, known={A: k})
    _change(b, B, C, _separated(1, 0x22), _separated(1, 0x33), KITCHEN, t0=200.0)
    assert b.tags[k]["addr"] == C
    _poll(b, 320.0, {A: _heard(_separated(1), KITCHEN, 320.0, 319.0),        # A heard once: pending
                     C: _heard(_separated(1, 0x33), KITCHEN, 320.0, 318.0)})
    assert b.unlink(k, T0 + 330.0, address=C) == (C, B)
    _change(b, B, D, _separated(1, 0x22), _separated(1, 0x44), KITCHEN, t0=400.0)
    assert b.tags[k]["addr"] == D
    r = _poll(b, 520.0, {A: _heard(_separated(1), KITCHEN, 520.0, 519.0),    # ONE report of A
                         D: _heard(_separated(1, 0x44), KITCHEN, 520.0, 518.0)})
    assert r["unlinked"] == [] and b.tags[k]["addr"] == D, b.tags[k]
    r = _poll(b, 530.0, {A: _heard(_separated(1), KITCHEN, 530.0, 529.0),    # a second, newer one
                         D: _heard(_separated(1, 0x44), KITCHEN, 530.0, 518.0)})
    assert b.tags[k]["addr"] == A and (k, D, A) in r["unlinked"], (r, b.tags[k])


def test_a_steady_advert_heard_only_by_the_hosts_own_adapter_stays_fresh(monkeypatch):
    """Rounds 13-14: when HA runs its own adapter through bleak (Bluetooth
    "degraded mode"), that scanner keeps no per-device timestamps, and HA
    passes an unchanged advert to no callback — so a steady device heard
    there (a Find My tag's constant payload) aged from its first report
    while it was still advertising, and a tag back on its day key was never
    followed there. The manager's last advert for the address dates it —
    overall, or among connectable scanners when a passive proxy holds the
    overall record — only when this scanner is the one it came from."""
    import sys
    import time
    from types import SimpleNamespace
    from custom_components.padspan_ha import bluetooth_live as BL
    from custom_components.padspan_ha.const import DOMAIN

    HOST = "00:1A:7D:DA:71:13"          # a real scanner's source is its adapter's MAC

    def seeded(last_source, connectable_source=None):
        mono = time.monotonic()
        adv = SimpleNamespace(rssi=-60, manufacturer_data={76: bytes([0x12, 0x19, 0x10] + [0x11] * 22 + [1, 0])},
                              service_data={}, service_uuids=[], tx_power=None, local_name=None)
        host = SimpleNamespace(source=HOST, discovered_device_timestamps={},       # as bleak's HaScanner
                               discovered_devices_and_advertisement_data={KEYS_1: (SimpleNamespace(address=KEYS_1, name=None), adv)})
        last = {False: SimpleNamespace(source=last_source, time=mono - 2.0),
                True: SimpleNamespace(source=connectable_source, time=mono - 3.0) if connectable_source else None}
        mgr = SimpleNamespace(async_current_scanners=lambda: [host],
                              async_last_service_info=lambda a, connectable: last[connectable] if a == KEYS_1 else None)
        monkeypatch.setitem(sys.modules, "habluetooth", SimpleNamespace(get_manager=lambda: mgr))
        bl = BL.BluetoothLive(SimpleNamespace(data={DOMAIN: {}}))
        bl._on_adv(_adv(KEYS_1, -60, mono - 300.0, source=HOST))                # first heard 5 min ago
        bl._seed_from_discovered()
        return (BL._now() - bl._seen_by_source[KEYS_1][HOST].seen).total_seconds()

    assert seeded(HOST) < 5
    # A passive proxy holds the overall record; the host adapter is the
    # connectable one that heard it.
    assert seeded("AA:BB:CC:DD:EE:01", connectable_source=HOST) < 5
    assert 295 <= seeded("AA:BB:CC:DD:EE:01") <= 305, "another scanner's advert is not this one's reading"

