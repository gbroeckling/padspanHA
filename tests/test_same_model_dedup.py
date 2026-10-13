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
