# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Find My tags through the REAL snapshot builder, history cache included.

Review round 10: every earlier Find My test fed hand-built snapshots, and
missed the object-history cache — which replays objects from earlier polls,
with their old fields, on every poll. A tag's next address is its own object
for the ~75 s before the link lands; the cache went on replaying that ghost
(claiming the live address), replayed the tag with an unlinked address, and
the Unlink button refused a different address than the one on screen.
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from custom_components.padspan_ha import findmy as F
from custom_components.padspan_ha import snapshot_builder as SB
from custom_components.padspan_ha import ws_objects as WO
from custom_components.padspan_ha.const import DATA_OBJECT_HISTORY, DATA_OBJECTS, DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.private_ble_resolver import PrivateBLEResolver

A = "D1:11:11:11:11:11"          # the address Keys was named and followed by
B = "E2:22:22:22:22:22"          # its next address
RADIOS = [{"source": "kit", "name": "kit", "area_name": "Kitchen"},
          {"source": "off", "name": "off", "area_name": "Office"}]
KITCHEN = {"kit": -50.0, "off": -88.0}


def _sep(key_byte=0x11):
    body = [0x12, 0x19, 1 << 4] + [key_byte] * 22 + [0x01, 0x00]
    return " ".join(f"0x{b:02X}" for b in body)


def _ads(addr, place, age=1.0, key_byte=0x11):
    return [{"address": addr, "source": s, "rssi": r, "age_s": age, "name": "",
             "manufacturer_data": {"76": _sep(key_byte)}, "service_data": {}, "service_uuids": [],
             "connectable": False} for s, r in place.items()]


class _Store:
    def __init__(self):
        self.saved = None

    async def async_load(self):
        return self.saved

    async def async_save(self, data):
        self.saved = data

    def async_delay_save(self, fn, delay):
        self.saved = fn()


class _ObjStore:
    def __init__(self, labels):
        self.labels = dict(labels)

    def get_label(self, k):
        return self.labels.get(str(k).upper())

    def get(self, k):
        k = str(k).upper()
        return {"label": self.labels[k]} if k in self.labels else None

    def all(self):
        return {k: {"label": v} for k, v in self.labels.items()}


def _make_house(monkeypatch, labels=None, followed=None):
    labels = {A: "Keys"} if labels is None else labels
    followed = [A] if followed is None else followed
    settings = {"mac_rotation_bridging": True, "followed_addrs": list(followed)}
    clock = {"t": 1_800_000_000.0}
    monkeypatch.setattr(time, "time", lambda: clock["t"])
    hass = SimpleNamespace(data={}, states=SimpleNamespace(async_all=lambda *a: [], get=lambda e: None),
                           config_entries=SimpleNamespace(async_entries=lambda *a: []))
    live = {"ads": []}
    bl = SimpleNamespace(get_snapshot=lambda max_ads=5000, max_age_s=14400: {
        "radios": [dict(r) for r in RADIOS],
        "advertisements": sorted([dict(a) for a in live["ads"] if a["age_s"] <= max_age_s], key=lambda a: a["age_s"]),
        "diag": {"ok": True, "errors": []}})
    bridge = F.FindMyBridge()
    hass.data[DOMAIN] = {
        DATA_SETTINGS: SimpleNamespace(data=settings, get=lambda k, d=None: settings.get(k, d)),
        DATA_OBJECTS: _ObjStore(labels), DATA_OBJECT_HISTORY: {},
        "_obj_hist_store": _Store(), "findmy_bridge": bridge, "findmy_bridge_store": _Store(),
    }
    resolver = PrivateBLEResolver(hass)

    async def _res(_h):
        return resolver

    monkeypatch.setattr(SB, "get_bluetooth_live", lambda _h: bl)
    monkeypatch.setattr(SB, "_get_ble_resolver", _res)

    async def poll(at, ads):
        clock["t"] = 1_800_000_000.0 + at
        live["ads"] = ads
        snap = await SB._build_live_snapshot(hass)
        objs = {o["key"]: o for o in snap["objects"]["list"]}
        xref = {ad["address"].upper(): ad.get("_xref") for ad in snap["ble"]["advertisements"]}
        return objs, xref

    return SimpleNamespace(hass=hass, bridge=bridge, poll=poll)


@pytest.fixture
def house(monkeypatch):
    return _make_house(monkeypatch)


async def _hand_over(house):
    """Keys on A; A goes quiet and B starts; the link lands ~100 s later."""
    await house.poll(0, _ads(A, KITCHEN))
    await house.poll(20, _ads(A, KITCHEN, age=21) + _ads(B, KITCHEN, key_byte=0x22))
    return await house.poll(100, _ads(A, KITCHEN, age=101) + _ads(B, KITCHEN, key_byte=0x22))


def _claimants(objs, addr):
    return sorted(k for k, o in objs.items()
                  if addr in {o.get("address"), o.get("current_address"), *(o.get("all_addresses") or [])})


async def test_after_a_hand_over_one_object_owns_the_live_address(house):
    objs, xref = await _hand_over(house)
    keys = objs["ble:" + A]
    assert keys["current_address"] == B and keys["address"] == A and keys.get("findmy")
    assert "ble:" + B not in objs, "the pre-link object must not be replayed from the history cache"
    assert _claimants(objs, B) == ["ble:" + A]
    assert xref[B]["key"] == "ble:" + A and xref[B]["label"] == "Keys" and xref[B].get("findmy")
    # And it stays that way while the old address lingers.
    for t in (140, 400):
        objs, _x = await house.poll(t, _ads(A, KITCHEN, age=t + 1) + _ads(B, KITCHEN, key_byte=0x22))
        assert _claimants(objs, B) == ["ble:" + A], t


async def test_an_unlink_sticks_through_the_history_cache(house):
    await _hand_over(house)
    sent = {}
    conn = SimpleNamespace(send_result=lambda i, r: sent.update(result=r),
                           send_error=lambda i, c, m: sent.update(error=c))
    # The row on screen is the tag's live address B.
    await WO.ws_findmy_unlink(house.hass, conn, {"id": 1, "key": "ble:" + A, "address": B})
    assert sent["result"] == {"unlinked": B, "back_to": A}
    cached = house.hass.data[DOMAIN][DATA_OBJECT_HISTORY].get("ble:" + A) or {}
    assert B not in (cached.get("all_addresses") or []) and "current_address" not in cached
    for t in (160, 400):
        objs, xref = await house.poll(t, _ads(A, KITCHEN, age=t + 1) + _ads(B, KITCHEN, key_byte=0x22))
        assert "ble:" + B in objs and _claimants(objs, B) == ["ble:" + B], t
        assert (xref[B] or {}).get("key") == "ble:" + B


async def test_unlink_refuses_only_the_address_on_screen(house):
    await _hand_over(house)
    sent = {}
    conn = SimpleNamespace(send_result=lambda i, r: sent.update(result=r),
                           send_error=lambda i, c, m: sent.update(error=c))
    await WO.ws_findmy_unlink(house.hass, conn, {"id": 1, "key": "ble:" + A, "address": A})
    assert sent.get("error") == "not_current" and house.bridge.tags[A]["addr"] == B


async def test_the_old_address_on_the_air_again_undoes_the_link(house):
    """A Find My key never comes back: the address a tag was linked away from,
    heard again, means the link was wrong — undone without anyone pressing
    anything, and the tag's live address never flips between the two."""
    await _hand_over(house)
    # One fresh-looking report is not enough (HA replays cached history into a
    # new callback — round 11); a second, newer one is.
    objs, _x = await house.poll(160, _ads(A, KITCHEN, age=1) + _ads(B, KITCHEN, key_byte=0x22))
    assert house.bridge.tags[A]["addr"] == B
    objs, _x = await house.poll(170, _ads(A, KITCHEN, age=1) + _ads(B, KITCHEN, key_byte=0x22))
    assert house.bridge.tags[A]["addr"] == A and B in house.bridge.tags[A]["refused"]
    assert "ble:" + B in objs and _claimants(objs, B) == ["ble:" + B]
    assert objs["ble:" + A].get("current_address") in (None, A)


# ── review round 11 ──────────────────────────────────────────────────────────

C = "F3:33:33:33:33:33"


async def test_a_replayed_old_report_never_undoes_a_correct_link(house):
    """Registering a callback makes HA replay its cached history: the tag's
    old address once looked freshly heard (then just ages). The link held."""
    await _hand_over(house)
    await house.poll(402, _ads(A, KITCHEN, age=2) + _ads(B, KITCHEN, key_byte=0x22))
    for at in (420, 480, 600):
        objs, xref = await house.poll(at, _ads(A, KITCHEN, age=at - 400) + _ads(B, KITCHEN, key_byte=0x22))
    t = house.bridge.tags[A]
    assert t["addr"] == B and B not in (t.get("refused") or [])
    assert objs["ble:" + A]["current_address"] == B and xref[B]["key"] == "ble:" + A


async def test_a_restart_from_the_saved_links_keeps_a_correct_link(house):
    await _hand_over(house)
    state = house.hass.data[DOMAIN]["findmy_bridge_store"].saved
    nb = F.FindMyBridge(state)
    house.hass.data[DOMAIN]["findmy_bridge"] = nb
    await house.poll(160, _ads(A, KITCHEN, age=3) + _ads(B, KITCHEN, key_byte=0x22))
    await house.poll(170, _ads(A, KITCHEN, age=13) + _ads(B, KITCHEN, key_byte=0x22))
    assert nb.tags[A]["addr"] == B and B not in (nb.tags[A].get("refused") or [])


async def test_a_tag_back_on_an_earlier_address_is_followed_there(house):
    """A separated tag keeps one key all day: A -> P1 -> P2 near the owner,
    then separated again it is back on A. The object followed the dead P2
    (reading 'away', room frozen) — it follows A now."""
    P1, P2 = B, C
    await _hand_over(house)                                    # A -> P1
    await house.poll(905, _ads(A, KITCHEN, age=906) + _ads(P1, KITCHEN, age=6, key_byte=0x22)
                     + _ads(P2, KITCHEN, key_byte=0x33))
    await house.poll(990, _ads(A, KITCHEN, age=991) + _ads(P1, KITCHEN, age=91, key_byte=0x22)
                     + _ads(P2, KITCHEN, key_byte=0x33))
    assert house.bridge.tags[A]["addr"] == P2
    objs, _x = await house.poll(1810, _ads(A, KITCHEN, age=1) + _ads(P1, KITCHEN, age=911, key_byte=0x22)
                                + _ads(P2, KITCHEN, age=11, key_byte=0x33))
    for at in (1900, 1910):
        objs, _x = await house.poll(at, _ads(A, KITCHEN, age=1) + _ads(P1, KITCHEN, age=at - 899, key_byte=0x22)
                                    + _ads(P2, KITCHEN, age=at - 1799, key_byte=0x33))
    k = objs["ble:" + A]
    assert house.bridge.tags[A]["addr"] == A
    # Back on the address it was first known by: an ordinary object again.
    assert k.get("current_address", k["address"]) == A and k["address"] == A and k["age_s"] <= 2, k


async def test_the_current_address_gone_and_an_earlier_one_live(house):
    P1, P2 = B, C
    await _hand_over(house)
    await house.poll(905, _ads(A, KITCHEN, age=906) + _ads(P1, KITCHEN, age=6, key_byte=0x22)
                     + _ads(P2, KITCHEN, key_byte=0x33))
    await house.poll(990, _ads(A, KITCHEN, age=991) + _ads(P1, KITCHEN, age=91, key_byte=0x22)
                     + _ads(P2, KITCHEN, key_byte=0x33))
    objs, _x = await house.poll(20000, _ads(A, KITCHEN, age=1))
    k = objs["ble:" + A]
    assert k["current_address"] == A and k["age_s"] == 1


L1, L2 = "4C:65:A8:00:00:01", "4C:65:A8:00:00:02"


def _sensor(addr, age):
    return [{"address": addr, "source": "off", "rssi": -60.0, "age_s": age, "name": addr,
             "manufacturer_data": {"911": "0x01 0x02 0x03"}, "service_data": {}, "service_uuids": [],
             "connectable": False}]


async def test_a_fingerprint_bridge_guess_never_deletes_a_named_devices_history(monkeypatch):
    """Two named sensors of one model whose MACs look rotating (0x40-0x7F):
    the fingerprint bridge may guess one is the other for a few polls. That
    guess must never delete the other's history (first seen, label)."""
    h = _make_house(monkeypatch, labels={L1: "Bedroom temp", L2: "Kitchen temp"}, followed=[])
    await h.poll(0, _sensor(L1, 1) + _sensor(L2, 2))
    hist = h.hass.data[DOMAIN][DATA_OBJECT_HISTORY]
    first = (hist.get("ble:" + L2) or {}).get("_first_seen")
    for at in (60, 65, 70):
        await h.poll(at, _sensor(L1, 7) + _sensor(L2, 9))
        assert "ble:" + L2 in hist, at
    objs, _x = await h.poll(200, _sensor(L1, 1) + _sensor(L2, 2))
    assert (hist.get("ble:" + L2) or {}).get("_first_seen") == first
    assert objs["ble:" + L2].get("user_label") == "Kitchen temp"
