# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Settings → Experimental → Apple Device Classification, through the REAL builder.

The toggle promised "iPhone, iPad, Apple Watch" and drove nothing on screen.
Its iPhone/iPad table read Nearby Info's STATUS FLAGS as a model: on Garry's
house (2026-09-27) one device in his office was an "iPad" all night and an
"iPhone" at 08:09 — same scanners, same signal, same message; only the flag
furiousMAC documents as "AirDrop receiving" differed. What Apple's Bluetooth
does say is a Find My advertisement's device type (findmy.py), and that is
all it now labels — on objects AND the Bluetooth Monitor's advertisements.
"""

from __future__ import annotations

import pytest

from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha.const import DATA_OBJECT_HISTORY, DATA_SETTINGS, DOMAIN
from tests.test_findmy_snapshot import _make_house

TAG = "D4:44:44:44:44:44"        # an AirTag
OTHER = "E5:55:55:55:55:55"      # another brand's Find My tag
PHONE = "44:05:63:DD:1C:D9"      # Nearby Info, bytes as heard in Garry's office


def _hex(body):
    return " ".join(f"0x{b:02X}" for b in body)


def _ad(addr, payload):
    # HA names an advertiser that sends no name by its address (live: every
    # Nearby Info object on Garry's house) — which is what lists it at all.
    return {"address": addr, "source": "kit", "rssi": -55.0, "age_s": 1.0, "name": addr,
            "manufacturer_data": {"76": payload}, "service_data": {}, "service_uuids": [],
            "connectable": False}


def _findmy(device_type):
    return _hex([0x12, 0x19, device_type << 4] + [0x11] * 22 + [0x01, 0x00])


LIVE = [_ad(TAG, _findmy(1)), _ad(OTHER, _findmy(2)),
        _ad(PHONE, _hex([0x10, 0x07, 0x75, 0x1F, 0xA1, 0xB2, 0xC3, 0xD4]))]


@pytest.fixture
def house(monkeypatch):
    h = _make_house(monkeypatch, labels={}, followed=[])
    built = {}
    real = SB._build_live_snapshot

    async def _keep(hass):
        built["snap"] = await real(hass)
        return built["snap"]

    monkeypatch.setattr(SB, "_build_live_snapshot", _keep)
    h.settings = h.hass.data[DOMAIN][DATA_SETTINGS].data
    h.built = built
    return h


def _classes(house, objs):
    ads = {a["address"]: a.get("auto_class") for a in house.built["snap"]["ble"]["advertisements"]}
    return {a: objs["ble:" + a].get("auto_class") for a in (TAG, OTHER, PHONE)}, ads


async def test_on_it_labels_what_find_my_says_and_nothing_it_cannot(house):
    house.settings["apple_auto_classify"] = True
    objs, _x = await house.poll(0, LIVE)
    on_objects, on_ads = _classes(house, objs)
    want = {TAG: "AirTag", OTHER: "Find My accessory", PHONE: None}
    assert on_objects == want
    assert on_ads == want, "the Bluetooth Monitor lists advertisements, not objects"


async def test_off_nothing_is_labelled_not_even_from_the_history_cache(house):
    """An older build stored auto_class (its made-up "iPad" included) in the
    object history, which replays objects with their old fields every poll."""
    await house.poll(0, LIVE)
    cache = house.hass.data[DOMAIN][DATA_OBJECT_HISTORY]
    cache["ble:" + TAG]["auto_class"] = "AirTag"
    cache["ble:" + PHONE]["auto_class"] = "iPad"
    objs, _x = await house.poll(30, [])
    assert objs["ble:" + TAG]["age_s"] >= 30, "not heard this poll: replayed from the cache"
    assert "auto_class" not in objs["ble:" + TAG]
    assert "auto_class" not in objs["ble:" + PHONE]
    # Switched on, the replayed phone still gets no made-up model.
    house.settings["apple_auto_classify"] = True
    objs, _x = await house.poll(60, [])
    assert objs["ble:" + TAG].get("auto_class") == "AirTag"
    assert "auto_class" not in objs["ble:" + PHONE]
