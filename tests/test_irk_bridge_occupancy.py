# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""With mac_rotation_bridging on, a guest iPhone bridged onto an IRK phone's
quiet old address made the whole phone a bridge guess when the guest's
address came first, and occupancy (which skips bridge guesses) dropped the
phone's owner. Found by the pre-release review of round 4."""
from __future__ import annotations
import pytest
from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha import ws_occupancy as O
from custom_components.padspan_ha.private_ble_resolver import PrivateBLEResolver
from tests.test_findmy_snapshot import _make_house

P_OLD, P_CUR, G = "4A:00:00:00:00:01", "4B:00:00:00:00:02", "5C:00:00:00:00:03"
IRK = {P_OLD, P_CUR}
NEARBY = {"76": "0x10 0x05 0x01 0x18 0x00 0x00 0x00"}


def ad(addr, src, rssi, age):
    return {"address": addr, "source": src, "rssi": rssi, "age_s": age, "name": "",
            "manufacturer_data": dict(NEARBY), "service_data": {}, "service_uuids": [], "connectable": True}


class FakeRes(PrivateBLEResolver):
    def __init__(self, hass):
        super().__init__(hass)
        self._devices = [{"canonical_id": "irk_garry", "name": "Garry iPhone", "irk_bytes": b"\0" * 16}]

    def resolve_address(self, address):
        if address.upper() in IRK:
            return {"canonical_id": "irk_garry", "name": "Garry iPhone", "kind": "private_ble"}
        return None


@pytest.mark.asyncio
async def test_an_irk_phone_with_a_bridged_guest_address_is_still_a_person(monkeypatch):
    house = _make_house(monkeypatch, labels={}, followed=[])
    res = FakeRes(house.hass)

    async def _res(_h):
        return res
    monkeypatch.setattr(SB, "_get_ble_resolver", _res)
    await house.poll(0, [ad(P_OLD, "kit", -50, 1), ad(P_OLD, "off", -70, 1)])
    objs, _ = await house.poll(30, [ad(G, "off", -55, 0.5), ad(G, "kit", -72, 0.5),
                                    ad(P_CUR, "kit", -50, 1), ad(P_CUR, "off", -70, 1),
                                    ad(P_OLD, "kit", -50, 31)])
    irk = [o for o in objs.values() if o.get("canonical_id") == "irk_garry"]
    assert irk and not any(o.get("bridge_match") for o in irk)
    objects = [dict(o, room="Kitchen") for o in irk]
    people = []
    O._claim_objects(people, objects)
    O._irk_phones(objects, people)
    assert people, "IRK phone dropped from occupancy"
