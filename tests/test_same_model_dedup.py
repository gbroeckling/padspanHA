# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Two devices of one model are two devices (snapshot_builder D3/D4).

Same advertised name (D3) or identical manufacturer payload (D4) on random
MACs was merged regardless of labels or whether both were heard at once:
Alice's and Bob's "Tile" tags became one object and Bob's vanished, two
identical sensors likewise, and once Alice's tag left, Bob's live tag was
folded into her stale ghost. A merge needs the other address to have gone
quiet, and never joins two labelled devices.
"""

from __future__ import annotations

import pytest

from tests.test_findmy_snapshot import _make_house

A, B = "E6:11:22:33:44:55", "DA:66:77:88:99:00"     # random static, both "Tile"
C, D = "F2:01:02:03:04:05", "CE:0A:0B:0C:0D:0E"     # two sensors, identical payload


def _ad(addr, src, rssi, name="", md=None, age=1.0):
    return {"address": addr, "source": src, "rssi": rssi, "age_s": age, "name": name,
            "manufacturer_data": md or {}, "service_data": {}, "service_uuids": [], "connectable": False}


def _labels(objs):
    return sorted(o.get("user_label") for o in objs.values() if o.get("user_label"))


@pytest.mark.asyncio
async def test_two_labelled_tags_of_one_model_stay_two(monkeypatch):
    house = _make_house(monkeypatch, labels={A: "Alice keys", B: "Bob keys", C: "Fridge", D: "Freezer"}, followed=[])
    ads = [_ad(A, "kit", -50, "Tile"), _ad(B, "off", -55, "Tile"),
           _ad(C, "kit", -60, "", {"2409": "0x01 0x02 0x03"}), _ad(D, "off", -62, "", {"2409": "0x01 0x02 0x03"})]
    for t in (0, 5, 10):
        objs, _ = await house.poll(t, ads)
    assert _labels(objs) == ["Alice keys", "Bob keys", "Freezer", "Fridge"]


@pytest.mark.asyncio
async def test_unlabelled_tags_heard_at_the_same_time_are_not_merged(monkeypatch):
    house = _make_house(monkeypatch, labels={}, followed=[])
    objs, _ = await house.poll(0, [_ad(A, "kit", -50, "Tile"), _ad(B, "off", -55, "Tile")])
    addrs = sorted(a for o in objs.values() for a in (o.get("all_addresses") or [o.get("address")]))
    assert A in addrs and B in addrs
    assert not any(o.get("_dedup_reason") for o in objs.values())


@pytest.mark.asyncio
async def test_a_rotation_still_merges_once_the_old_address_is_quiet(monkeypatch):
    house = _make_house(monkeypatch, labels={}, followed=[])
    objs, _ = await house.poll(0, [_ad(A, "kit", -50, "Tile", age=90.0), _ad(B, "kit", -52, "Tile")])
    merged = [o for o in objs.values() if (o.get("_dedup_reason") or "").startswith("same_name")]
    assert len(merged) == 1 and merged[0]["address"] == B      # the live address is primary


@pytest.mark.asyncio
async def test_the_rotation_bridge_never_renames_a_labelled_tag(monkeypatch):
    """mac_rotation_bridging: two labelled tags of one model, one quiet for a
    few seconds - the other was bridged onto it and shown as "Alice tag"."""
    P, Q = "5A:11:11:11:11:11", "6B:22:22:22:22:22"

    def ad(addr, src, age):
        return {"address": addr, "source": src, "rssi": -60, "age_s": age, "name": "",
                "manufacturer_data": {"117": "0x42 0x09 0x01"}, "service_data": {},
                "service_uuids": ["0000fd5a-0000-1000-8000-00805f9b34fb"], "connectable": True}
    house = _make_house(monkeypatch, labels={P: "Alice tag", Q: "Bob tag"}, followed=[])
    await house.poll(0, [ad(P, "kit", 1), ad(Q, "off", 1)])
    objs, _ = await house.poll(5, [ad(P, "kit", 7), ad(Q, "off", 1)])   # Alice quiet 7 s
    for o in objs.values():
        addrs = o.get("all_addresses") or [o.get("address")]
        assert not (Q in addrs and o.get("user_label") == "Alice tag"), o
