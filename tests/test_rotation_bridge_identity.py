# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The rotation bridge never renames a device that has its own identity."""

from __future__ import annotations

import pytest

from tests.test_findmy_snapshot import _make_house


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
