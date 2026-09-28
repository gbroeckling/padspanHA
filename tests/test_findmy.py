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
    """One address's record as snapshot_builder merges it: `findmy_separated`
    when a report heard within LIVE_S carries the separated payload."""
    rec = {"age_s": age, "manufacturer_data": {"76": payload},
           "sources": {s: {"rssi": r, "age_s": age} for s, r in sources.items()}}
    adv = F.parse_findmy(rec["manufacturer_data"])
    if adv is not None and adv["separated"] and age <= F.LIVE_S:
        rec["findmy_separated"] = True
    return rec


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


def _poll(bridge, t, records, known=None, **kw):
    return bridge.step(T0 + t, records, known or {}, **kw)


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
    i = src.index("# ── Apple Device Classification")
    assert "bytes.fromhex" not in src[i:i + 2000] and 'parse_findmy(_o.get("manufacturer_data"))' in src[i:i + 2000]


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


# ── how well it works: what the opt-in report counts ─────────────────────────
# Garry, 2026-09-27: "make sure the opt-in records how well tools for this
# feature actually work". step() says how each tag's hand-over window ended:
# a link (and how long after the old address's last report), or — once, as
# the window closes — the strongest reason no link was made.


def test_a_link_says_how_long_it_took_and_is_never_also_a_miss():
    b = F.FindMyBridge()
    k = "ble:" + KEYS_1
    r = _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
    assert r["linked"] == [(k, KEYS_1, KEYS_2)] and r["linked_after_s"] == [101.0] and r["missed"] == []
    for t in (200, 400, 700):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
        assert r["missed"] == [] and r["linked_after_s"] == [], t
    # A link that lands a poll into the window (the new address first heard
    # only by a scanner the old one never was) ends the window as a link.
    b = F.FindMyBridge()
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: k})
    _poll(b, 20, {KEYS_1: _rec(_separated(1), KITCHEN, age=21), KEYS_2: _rec(_separated(1, 0x22), {"garage": -60.0})})
    r = _poll(b, 90, {KEYS_1: _rec(_separated(1), KITCHEN, age=91), KEYS_2: _rec(_separated(1, 0x22), {"garage": -60.0})})
    assert r["linked"] == [] and k in b._waiting, "the fixture no longer opens the window before the link"
    r = _poll(b, 130, {KEYS_1: _rec(_separated(1), KITCHEN, age=131), KEYS_2: _rec(_separated(1, 0x22), KITCHEN)})
    assert r["linked"] == [(k, KEYS_1, KEYS_2)] and r["linked_after_s"] == [131.0] and r["missed"] == []


def test_a_tag_heard_again_on_its_own_address_was_never_handed_over():
    """Quiet for a while (out of range, a proxy's slow reseed), then back on
    the same address: no change happened, so nothing was missed."""
    b = F.FindMyBridge()
    k = "ble:" + KEYS_1
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: k})
    missed = _poll(b, 150, {KEYS_1: _rec(_separated(1), KITCHEN, age=151)})["missed"]
    assert k in b._waiting, "the fixture no longer opens a window"
    for t in (200, 400, 900):
        missed += _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN)})["missed"]
    assert missed == []


def test_a_tag_that_left_range_is_no_candidate_once():
    """Keys goes quiet and no new AirTag address appears: the tag most likely
    left range — not a matcher failure. A neighbour's AirTag there all along
    and a pair of AirPods arriving are no candidates (either would make it
    "no_match" if it were)."""
    b = F.FindMyBridge()
    k = "ble:" + KEYS_1
    nb = {BAG_1: _rec(_separated(1), KITCHEN)}
    for t in (-20, 0):      # watching since before Keys stopped
        _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN), **nb}, {KEYS_1: k})
    missed = []
    for t in (20, 100, 200, 290):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), KEYS_2: _rec(_separated(3, 0x22), KITCHEN), **nb})
        missed += r["missed"]
    assert missed == [], "still inside the window"
    assert F.LIVE_S < 290 + 1 <= F.HANDOVER_WINDOW_S < 310 + 1, "the fixture no longer spans the window"
    r = _poll(b, 310, {KEYS_1: _rec(_separated(1), KITCHEN, age=311), **nb})
    assert r["missed"] == [(k, "no_candidate")]
    for t in (320, 900):
        assert _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), **nb})["missed"] == [], t


def test_what_came_closest_to_a_link_is_the_reason_it_missed():
    """Keys (last reported at -1) goes quiet; one new AirTag address appears
    (first heard at the first poll from `at` on). At the hand-over moment
    but somewhere else: "elsewhere" — another device's change, or Keys
    carried off as it changed, can't be told apart. Where Keys was, after
    the timing rule allows but no later than a real hand-over can be first
    heard on this install (a reseed + the gap between polls + an advert):
    "late" — the timing rule turned it down. Any later, or somewhere else:
    someone else's, and Keys most likely left range.

    Review: "late" used to be anything up to LIVE_S — at the defaults (30 s
    reseed, polls every 5-10 s) a real hand-over is first heard within 42 s,
    inside APPEAR_AFTER_S, so it caught only other tags ARRIVING where Keys
    had been, counted against the matcher; and with polls 80 s apart a real
    hand-over it turned down was "left range"."""
    k = "ble:" + KEYS_1
    for name, place, at, reseed, every, want in (
            ("somewhere else", OFFICE, 20, None, 10, "elsewhere"),
            ("no scanner heard both", {"garage": -60.0}, 20, None, 10, "elsewhere"),
            ("where it was, a minute late: someone else's arriving", KITCHEN, 60, None, 10, "no_candidate"),
            ("where it was, a minute late, 60 s reseed", KITCHEN, 60, 60.0, 10, "late"),
            ("where it was, later than a 60 s reseed reports", KITCHEN, 80, 60.0, 10, "no_candidate"),
            ("somewhere else, a minute late, 60 s reseed", OFFICE, 60, 60.0, 10, "no_candidate"),
            ("polled every 80 s: a real change first heard 80 s on", KITCHEN, 2, None, 80, "late")):
        b = F.FindMyBridge()
        kw = {} if reseed is None else {"reseed_s": reseed}
        missed = []
        for t in range(-2 * every, 401, every):
            recs = {KEYS_1: _rec(_separated(1), KITCHEN, age=max(1, t + 1))}
            if t >= at:
                recs[KEYS_2] = _rec(_separated(1, 0x22), place)
            r = _poll(b, t, recs, {KEYS_1: k}, **kw)
            assert r["linked"] == [], name
            missed += r["missed"]
        assert missed == [(k, want)], name
    assert 30 + 10 + F.ADVERT_S < F.APPEAR_AFTER_S < 60 <= 60 + 10 + F.ADVERT_S < 80, \
        "the fixture no longer brackets the late band"


def test_another_devices_routine_change_after_the_tag_left_is_not_a_miss():
    """Review: a housemate's AirTag near its owner changes address every 15
    minutes. Keys left range at 0; the housemate's changed 150 s later in
    the office, or 200 s later in the kitchen — each was counted as a miss
    against the matcher, so in a house of Find My devices nearly every tag
    carried out the door lowered the follow rate."""
    k = "ble:" + KEYS_1
    mate_1, mate_2 = "C8:88:88:88:88:88", "E9:99:99:99:99:99"

    def run(change_at, place):
        b = F.FindMyBridge()
        for t in (-20, -10, 0):
            _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN), mate_1: _rec(_nearby(1), place)}, {KEYS_1: k})
        missed = []
        for t in range(10, 700, 10):
            recs = {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1)}
            if t < change_at:
                recs[mate_1] = _rec(_nearby(1), place)
            else:
                recs[mate_1] = _rec(_nearby(1), place, age=t - change_at + 1)
                recs[mate_2] = _rec(_nearby(1), place)
            r = _poll(b, t, recs)
            assert r["linked"] == []
            missed += r["missed"]
        return missed

    assert run(10 ** 9, OFFICE) == [(k, "no_candidate")]
    assert run(150, OFFICE) == [(k, "no_candidate")]
    assert run(200, KITCHEN) == [(k, "no_candidate")]


def test_a_pairing_too_close_to_call_is_ambiguous_even_after_the_candidates_go():
    """Two tags in one drawer change together: refused rather than guessed.
    Each window reports the strongest reason it came to — the candidates are
    gone by the time it closes, and it is still "ambiguous", not "no_candidate"."""
    b = F.FindMyBridge()
    known = {KEYS_1: "ble:" + KEYS_1, BAG_1: "ble:" + BAG_1}
    near_k = {"kitchen": -56.0, "hall": -71.0, "office": -88.0}
    near_b = {"kitchen": -54.0, "hall": -73.0, "office": -87.0}
    for t in (-20, 0):
        _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN), BAG_1: _rec(_separated(1), KITCHEN)}, known)
    missed = []
    for t in (20, 100, 200, 290, 310, 400):
        recs = {KEYS_2: _rec(_separated(1, 0x22), near_k), BAG_2: _rec(_separated(1, 0x33), near_b)} if t <= 100 else {}
        r = _poll(b, t, recs)
        assert r["linked"] == [], t
        missed += r["missed"]
    assert sorted(missed) == [("ble:" + BAG_1, "ambiguous"), ("ble:" + KEYS_1, "ambiguous")]


def test_a_candidate_rightly_linked_to_another_tag_is_not_a_rival():
    """Review: Keys changes address at the moment Bag, a few metres away, is
    carried out of range. Keys' new address is rightly Keys'; it was also
    Bag's only candidate, and Bag's window was filed "ambiguous" — a miss
    against the matcher — when Bag simply left."""
    b = F.FindMyBridge()
    known = {KEYS_1: KEYS_1, BAG_1: BAG_1}
    near = {"kitchen": -63.0, "hall": -80.0, "office": -80.0}        # 8 dB from the kitchen
    assert F.MARGIN_DB <= F.place_difference(near, KITCHEN) <= F.MAX_DB, "the fixture no longer makes Bag a near rival"
    missed, linked = [], []
    for t in range(-20, 401, 10):
        recs = {KEYS_1: _rec(_separated(1), KITCHEN, age=max(1, t + 1)),
                BAG_1: _rec(_separated(1), near, age=max(1, t + 1))}
        if t > 0:
            recs[KEYS_2] = _rec(_separated(1, 0x22), KITCHEN)
        r = _poll(b, t, recs, known)
        missed += r["missed"]
        linked += r["linked"]
    assert linked == [(KEYS_1, KEYS_1, KEYS_2)]
    assert missed == [(BAG_1, "elsewhere")]


def test_a_restart_neither_counts_a_window_twice_nor_trips_on_old_state():
    k = KEYS_1
    # A window open when the bridge restarts: the old instance never closed
    # it, and the new one saw only part of it — reported by neither.
    b1 = F.FindMyBridge()
    _poll(b1, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: k})
    assert _poll(b1, 100, {KEYS_1: _rec(_separated(1), KITCHEN, age=101)})["missed"] == []
    assert k in b1._waiting, "the fixture no longer opens a window before the restart"
    # The state file as 0.38.80 wrote it (tags only) loads and steps.
    state = b1.to_state()
    assert set(state) == {"tags"}
    assert set(state["tags"][k]) <= {"addr", "type", "rssi", "last_ts", "past", "refused", "linked_ts"}
    b2 = F.FindMyBridge(state)
    missed = []
    for t in (150, 200, 310, 350):
        missed += _poll(b2, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1)})["missed"]
    assert missed == []
    # A window it saw whole is reported as usual.
    _poll(b2, 400, {KEYS_1: _rec(_separated(1), KITCHEN)})
    for t in (500, 600, 710):
        missed += _poll(b2, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t - 399)})["missed"]
    assert missed == [(k, "no_candidate")]


def test_a_hand_over_the_bridge_saw_only_part_of_is_never_reported():
    """Review: HA restarts 10 s after Keys changes address. The new bridge
    takes the next address, already on the air at its first poll, for a
    neighbour's there all along — Keys is lost (as before: a link needs the
    new address to appear around the old one's last report) — and the window
    was filed "left range". Bridging switched off while Keys changed: the
    next address is first seen when it comes back on, too late for the
    timing rule, and the window was filed "late" — against the matcher."""
    k = KEYS_1

    def keys(t):
        return {KEYS_1: _rec(_nearby(1), KITCHEN, age=max(1, t - 4)),
                **({KEYS_2: _rec(_nearby(1), KITCHEN)} if t >= 10 else {})}

    b1 = F.FindMyBridge()
    for t in (-30, -20, -10, 0, 10):
        _poll(b1, t, keys(t), {KEYS_1: k})
    b2 = F.FindMyBridge(b1.to_state())                 # the restart, 10 s after the change
    missed = []
    for t in range(20, 501, 10):
        r = _poll(b2, t, keys(t))
        assert r["linked"] == [], t
        missed += r["missed"]
    assert missed == []

    b = F.FindMyBridge()
    missed = []
    for t in range(-30, 501, 10):
        if 10 <= t <= 50:
            b.unwatched(T0 + t)                        # bridging off: a poll the bridge was not in
            continue
        r = _poll(b, t, keys(t), {KEYS_1: k})
        assert r["linked"] == [], t
        missed += r["missed"]
    assert missed == []
    # Watched throughout, the same arrival 55 s after Keys' last report —
    # later than a real hand-over is first heard at the defaults — is
    # someone else's.
    b = F.FindMyBridge()
    missed = []
    for t in range(-30, 501, 10):
        recs = keys(t) if t >= 60 else {KEYS_1: keys(t)[KEYS_1]}
        missed += _poll(b, t, recs, {KEYS_1: k})["missed"]
    assert missed == [(k, "no_candidate")]


def test_an_undone_link_is_not_a_missed_hand_over():
    """The tag's link undone — by itself (heard on its earlier address again)
    or by a person — while it was waiting on its next address: its window
    ends there, never as a miss."""
    k = KEYS_1
    for how in ("moved back", "not this tag"):
        b = F.FindMyBridge()
        _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
        _poll(b, 200, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN, age=100), KEYS_1: _rec(_separated(1), KITCHEN)})
        assert k in b._waiting, "the fixture no longer has the tag waiting when it is undone"
        missed = []
        if how == "moved back":
            r = _poll(b, 210, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN, age=110), KEYS_1: _rec(_separated(1), KITCHEN)})
            assert r["unlinked"] == [(k, KEYS_2, KEYS_1)], how
            missed += r["missed"]
        else:
            assert b.unlink(k, T0 + 205, KEYS_2) == (KEYS_2, KEYS_1)
        for t in (220, 520, 900):
            missed += _poll(b, t, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN, age=t - 100)})["missed"]
        assert missed == [], how


def test_a_link_undone_by_a_person_is_one_hand_over_not_also_a_miss():
    """Review: Keys' earlier address lingers in HA's list after "Not this
    tag" (as every used address does, for hours), and the next poll put Keys
    back in the window the wrong link had closed — one hand-over came out as
    a link, the undo AND a miss. A window it opens later is still reported."""
    b = F.FindMyBridge()
    k, visitor = KEYS_1, BAG_1
    _poll(b, 0, {KEYS_1: _rec(_separated(1), KITCHEN)}, {KEYS_1: k})
    _poll(b, 20, {KEYS_1: _rec(_separated(1), KITCHEN, age=21), visitor: _rec(_separated(1, 0x22), KITCHEN)})
    r = _poll(b, 100, {KEYS_1: _rec(_separated(1), KITCHEN, age=101), visitor: _rec(_separated(1, 0x22), KITCHEN)})
    assert r["linked"] == [(k, KEYS_1, visitor)]
    assert b.unlink(k, T0 + 120, visitor) == (visitor, KEYS_1)
    missed = []
    for t in (130, 200, 290, 310, 400, 700):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t + 1), visitor: _rec(_separated(1, 0x22), KITCHEN)})
        assert r["linked"] == [], t
        missed += r["missed"]
        if t == 130:
            assert k in b._waiting, "the fixture no longer puts Keys back in the window"
    assert missed == []
    # Keys heard again on its address, then quiet: a new window, reported.
    _poll(b, 800, {KEYS_1: _rec(_separated(1), KITCHEN), visitor: _rec(_separated(1, 0x22), KITCHEN)})
    for t in (900, 1000, 1110):
        missed += _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN, age=t - 799),
                               visitor: _rec(_separated(1, 0x22), KITCHEN)})["missed"]
    assert missed == [(k, "no_candidate")]


def _day_key_day(b, back_on, known=None):
    """A separated tag on its day key D (KEYS_1) in the kitchen; its owner
    comes home and it takes near-owner keys N1, N2 (KEYS_2, KEYS_3), each
    followed; then it is heard on `back_on` again, twice, while N2 lingers."""
    _change(b, KEYS_1, KEYS_2, _separated(1), _nearby(1), KITCHEN, known=known)
    _change(b, KEYS_2, KEYS_3, _nearby(1), _nearby(1), KITCHEN, t0=1000.0)
    payload = _separated(1) if back_on == KEYS_1 else _nearby(1)
    out = []
    for t in (2000, 2035):
        out.append(_poll(b, t, {back_on: _rec(payload, KITCHEN), KEYS_3: _rec(_nearby(1), KITCHEN, age=t - 1100)}))
    return out


def test_a_tag_back_on_its_day_key_is_not_a_wrong_link():
    """Review: a separated tag near its owner for a while, then separated
    again the same day, goes back to its day key — every link in between was
    right, and the report called them wrong links undone. Coming back to a
    separated key from a near-owner one is the schedule; coming back to a
    near-owner key (never used twice) is a wrong link undone."""
    k = KEYS_1
    b = F.FindMyBridge()
    r1, r2 = _day_key_day(b, KEYS_1, known={KEYS_1: k})
    assert r1["unlinked"] == [] and b.tags[k]["addr"] == KEYS_1
    assert r2["unlinked"] == [(k, KEYS_2, KEYS_1), (k, KEYS_3, KEYS_1)]
    assert r2["back_on_day_key"] == [k]
    # The same return to a near-owner key: a wrong link undone.
    b = F.FindMyBridge()
    r1, r2 = _day_key_day(b, KEYS_2, known={KEYS_1: k})
    assert r2["unlinked"] == [(k, KEYS_3, KEYS_2)] and r2["back_on_day_key"] == []
    # And from one separated key back to another (a separated key changes
    # only to the next day's): a wrong link undone.
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
    r = {}
    for t in (300, 335):
        r = _poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN), KEYS_2: _rec(_separated(1, 0x22), KITCHEN, age=t - 100)})
    assert r["unlinked"] == [(k, KEYS_2, KEYS_1)] and r["back_on_day_key"] == []


def test_a_day_key_return_is_known_by_what_the_links_were_onto():
    """Whether the tag was near its owner is read when each link is made —
    at a return, the key it left has stopped, and a stopped address's record
    says nothing: it may be gone from the list (a short ble_max_age_s, a
    restart), and a separated one no longer reads separated (no report of it
    is live). Review: the return was filed as a wrong link undone whenever
    the near-owner key was no longer in the list."""
    k = KEYS_1
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _nearby(1), KITCHEN, known={KEYS_1: k})
    _change(b, KEYS_2, KEYS_3, _nearby(1), _nearby(1), KITCHEN, t0=1000.0)
    r = [_poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN)}) for t in (2000, 2035)][-1]
    assert r["unlinked"] == [(k, KEYS_2, KEYS_1), (k, KEYS_3, KEYS_1)] and r["back_on_day_key"] == [k]
    # Linked onto a visitor's SEPARATED key, which then left: Keys back on
    # its own key is that link undone, whatever the visitor's record says now.
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: k})
    r = [_poll(b, t, {KEYS_1: _rec(_separated(1), KITCHEN), KEYS_2: _rec(_separated(1, 0x22), KITCHEN, age=t - 150)})
         for t in (400, 435)][-1]
    assert r["unlinked"] == [(k, KEYS_2, KEYS_1)] and r["back_on_day_key"] == []


def test_a_wrong_link_onto_a_device_still_on_the_air_is_not_a_day_key_return():
    """Review: Keys, separated on its day key D, is unheard in the garage for
    a while; a housemate's AirTag near its owner there changes key (M1 ->
    M2), and Keys is linked onto M2 — wrong. Keys is heard on D again while
    M2 is still on the air: two addresses heard at once are two devices, so
    that is a wrong link undone — it was filed as Keys back on its day key
    after time near its owner (expected), and the follow rate stayed 100%."""
    k, D, M1, M2 = KEYS_1, KEYS_1, BAG_1, KEYS_2
    b = F.FindMyBridge()
    out = []
    for t in range(-20, 241, 10):
        recs = {D: _rec(_separated(1), OFFICE, age=max(1, t + 1) if t < 200 else 1)}
        recs[M1] = _rec(_nearby(1), OFFICE, age=max(1, t - 19))
        if t >= 20:
            recs[M2] = _rec(_nearby(1), OFFICE)
        out.append(_poll(b, t, recs, {D: k}))
    assert [x for r in out for x in r["linked"]] == [(k, D, M2)], "the fixture no longer makes the wrong link"
    unlinked = [x for r in out for x in r["unlinked"]]
    assert unlinked == [(k, M2, D)]
    assert [x for r in out for x in r["back_on_day_key"]] == []
    # M2's last report stamped the same moment as D's first (a passive
    # proxy's reseed stamps both at once): heard together, two devices. Once
    # M2 has stopped before D's first report, the return reads as the
    # schedule — a real one is two adverts (ADVERT_S) apart.
    for m2_last, want in ((199, []), (189, [k])):
        b = F.FindMyBridge()
        out = []
        for t in range(-20, 241, 10):
            recs = {D: _rec(_separated(1), OFFICE, age=max(1, t + 1) if t < 200 else 1)}
            recs[M1] = _rec(_nearby(1), OFFICE, age=max(1, t - 19))
            if t >= 20:
                recs[M2] = _rec(_nearby(1), OFFICE, age=1 if t <= m2_last else t - m2_last)
            out.append(_poll(b, t, recs, {D: k}))
        assert [x for r in out for x in r["unlinked"]] == [(k, M2, D)], m2_last
        assert [x for r in out for x in r["back_on_day_key"]] == want, m2_last


def test_an_address_is_separated_when_any_live_report_says_so():
    """Each scanner's row is the last advert THAT scanner caught: one can be
    another moment's payload. Review: the report read the separated flag off
    one row — whichever came first — and the bridge off another."""
    def ads(*rows):
        return [{"address": KEYS_1, "source": s, "age_s": age, "manufacturer_data": {"76": p}} for s, p, age in rows]

    assert F.on_air(ads(("kit", _nearby(1), 1), ("off", _separated(1), 5)))["separated"]["airtag"] == 1
    assert F.on_air(ads(("kit", _nearby(1), 1), ("edge", _separated(1), F.LIVE_S + 1)))["separated"]["airtag"] == 0
    assert F.on_air(ads(("kit", _separated(1), 1), ("edge", _nearby(1), 9000)))["separated"]["airtag"] == 1
    assert F.separated_report({"76": _separated(1)}, 5)
    assert not F.separated_report({"76": _separated(1)}, F.LIVE_S + 1)
    assert not F.separated_report({"76": _nearby(1)}, 1) and not F.separated_report({"76": IPHONE}, 1)
    assert not F.separated_report({"76": _separated(1)}, None)


def test_what_the_report_counts_about_the_tags_themselves():
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: KEYS_1, BAG_1: BAG_1})
    _poll(b, 110, {KEYS_2: _rec(_separated(1, 0x22), KITCHEN), BAG_1: _rec(_separated(2), OFFICE)}, {BAG_1: BAG_1})
    assert b.stats(T0 + 110) == {"tracked": {"apple": 0, "airtag": 1, "accessory": 1, "airpods": 0},
                                 "tracked_live": 2, "tracked_carried": 1}
    assert b.stats(T0 + 1000)["tracked_live"] == 0
    ads = [{"address": a, "source": s, "age_s": age, "manufacturer_data": {"76": p}}
           for a, p, age in ((KEYS_2, _separated(1, 0x22), 2), (BAG_1, _separated(2), 5), (BAG_2, _nearby(3), 30),
                             (KEYS_3, _nearby(1), F.LIVE_S + 1), ("C0:12:34:56:78:9A", IPHONE, 1),
                             (PHONE_1, _separated(1), 1))
           for s in ("kitchen", "office")]
    assert F.on_air(ads) == {"on_air": {"apple": 0, "airtag": 1, "accessory": 1, "airpods": 1},
                             "separated": {"apple": 0, "airtag": 1, "accessory": 1, "airpods": 0}}
    assert F.on_air(None) == F.on_air([]) == {"on_air": dict.fromkeys(F.TYPE_KEYS.values(), 0),
                                              "separated": dict.fromkeys(F.TYPE_KEYS.values(), 0)}


async def test_the_outcomes_are_counted_for_the_opt_in_report():
    """Through the real wiring: A -> B (slow), B -> C, A heard again (both
    links undone by themselves), then A goes quiet with no new address."""
    from custom_components.padspan_ha import snapshot_builder as SB
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha.const import DOMAIN
    hass, settings, _store = _hass_for({KEYS_1: "Keys"}, followed=[KEYS_1])
    settings.data["telemetry_enabled"] = True
    A, B, C = KEYS_1, KEYS_2, KEYS_3

    async def step(t, recs):
        await SB._findmy_step(hass, recs, {}, {}, {}, now_ts=T0 + t)

    await step(0, {A: _rec(_separated(1), KITCHEN)})
    await step(20, {A: _rec(_separated(1), KITCHEN, age=21), B: _rec(_separated(1, 0x22), KITCHEN)})
    await step(130, {A: _rec(_separated(1), KITCHEN, age=131), B: _rec(_separated(1, 0x22), KITCHEN)})
    await step(150, {B: _rec(_separated(1, 0x22), KITCHEN)})
    await step(170, {B: _rec(_separated(1, 0x22), KITCHEN, age=21), C: _rec(_separated(1, 0x33), KITCHEN)})
    await step(250, {B: _rec(_separated(1, 0x22), KITCHEN, age=101), C: _rec(_separated(1, 0x33), KITCHEN)})
    assert hass.data[DOMAIN]["findmy_bridge"].tags[A]["addr"] == C
    await step(300, {A: _rec(_separated(1), KITCHEN), C: _rec(_separated(1, 0x33), KITCHEN)})
    await step(310, {A: _rec(_separated(1), KITCHEN), C: _rec(_separated(1, 0x33), KITCHEN)})
    assert hass.data[DOMAIN]["findmy_bridge"].tags[A]["addr"] == A
    for t in (400, 500, 620):
        await step(t, {A: _rec(_separated(1), KITCHEN, age=t - 309), C: _rec(_separated(1, 0x33), KITCHEN)})
    assert hass.data[DOMAIN][T._DATA_COUNTERS] == {
        "findmy_linked": 2, "findmy_linked_slow": 1,
        "findmy_moved_back": 1, "findmy_moved_back_addrs": 2,
        "findmy_missed_no_candidate": 1,
    }


async def test_each_miss_reason_is_counted_under_its_own_name():
    from types import SimpleNamespace
    from custom_components.padspan_ha import snapshot_builder as SB
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha.const import DOMAIN
    hass, settings, _store = _hass_for()
    canned = {"map": {}, "linked": [], "linked_after_s": [], "unlinked": [],
              "missed": [("x", "ambiguous"), ("y", "late"), ("z", "late"), ("v", "elsewhere"), ("w", "no_candidate")]}
    hass.data[DOMAIN]["findmy_bridge"] = SimpleNamespace(step=lambda *a: canned, tags={}, identity_of=lambda a: None)
    await SB._findmy_step(hass, {}, {}, {}, {}, now_ts=T0)
    assert T._DATA_COUNTERS not in hass.data[DOMAIN], "nothing is counted while the report is off"
    settings.data["telemetry_enabled"] = True
    await SB._findmy_step(hass, {}, {}, {}, {}, now_ts=T0)
    assert hass.data[DOMAIN][T._DATA_COUNTERS] == {
        "findmy_missed_ambiguous": 1, "findmy_missed_late": 2, "findmy_missed_elsewhere": 1,
        "findmy_missed_no_candidate": 1}


async def test_a_day_key_return_is_counted_apart_from_wrong_links_undone():
    from custom_components.padspan_ha import snapshot_builder as SB
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha.const import DOMAIN
    D, N1, N2 = KEYS_1, KEYS_2, KEYS_3
    for back_on, want in ((D, {"findmy_linked": 2, "findmy_back_on_day_key": 1}),
                          (N1, {"findmy_linked": 2, "findmy_moved_back": 1, "findmy_moved_back_addrs": 1})):
        hass, settings, _store = _hass_for({D: "Keys"}, followed=[D])
        settings.data["telemetry_enabled"] = True

        async def step(t, recs):
            await SB._findmy_step(hass, recs, {}, {}, {}, now_ts=T0 + t)

        for t0, old, new, p_old in ((0, D, N1, _separated(1)), (1000, N1, N2, _nearby(1))):
            await step(t0, {old: _rec(p_old, KITCHEN)})
            await step(t0 + 20, {old: _rec(p_old, KITCHEN, age=21), new: _rec(_nearby(1), KITCHEN)})
            await step(t0 + 100, {old: _rec(p_old, KITCHEN, age=101), new: _rec(_nearby(1), KITCHEN)})
        payload = _separated(1) if back_on == D else _nearby(1)
        for t in (2000, 2035):
            await step(t, {back_on: _rec(payload, KITCHEN), N2: _rec(_nearby(1), KITCHEN, age=t - 1100)})
        assert hass.data[DOMAIN]["findmy_bridge"].tags[D]["addr"] == back_on
        assert hass.data[DOMAIN][T._DATA_COUNTERS] == want, back_on


async def test_not_this_tag_is_counted_only_when_it_undid_a_link():
    from types import SimpleNamespace
    from unittest.mock import MagicMock
    from custom_components.padspan_ha import telemetry as T
    from custom_components.padspan_ha import ws_objects as WO
    from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
    b = F.FindMyBridge()
    _change(b, KEYS_1, KEYS_2, _separated(1), _separated(1, 0x22), KITCHEN, known={KEYS_1: KEYS_1})
    hass = SimpleNamespace(data={DOMAIN: {"findmy_bridge": b,
                                          "findmy_bridge_store": SimpleNamespace(async_delay_save=MagicMock()),
                                          DATA_SETTINGS: SimpleNamespace(data={"telemetry_enabled": True})}})
    sent = {}
    conn = SimpleNamespace(send_result=lambda i, r: sent.update(result=r), send_error=lambda i, c, m: sent.update(error=c))
    await WO.ws_findmy_unlink(hass, conn, {"id": 1, "key": "ble:" + KEYS_1, "address": KEYS_1})
    assert sent.get("error") == "not_current" and T._DATA_COUNTERS not in hass.data[DOMAIN]
    await WO.ws_findmy_unlink(hass, conn, {"id": 2, "key": "ble:" + KEYS_1, "address": KEYS_2})
    assert sent["result"] == {"unlinked": KEYS_2, "back_to": KEYS_1}
    await WO.ws_findmy_unlink(hass, conn, {"id": 3, "key": "ble:" + KEYS_1})
    assert sent["error"] == "not_linked"
    assert hass.data[DOMAIN][T._DATA_COUNTERS] == {"findmy_not_this_tag": 1}

