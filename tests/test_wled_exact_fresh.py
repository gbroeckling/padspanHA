"""A fresh command (Atlas, room, card, service...) is the newest word: an older outside
change that HA reports while it is being sent must not undo it or split a team
(0.38.85 live-test cycle 12 + review round 5 probes P2/P3/P3b)."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from custom_components.padspan_ha import wled_exact as E
from tests.test_wled_exact import (  # noqa: F401  (fixtures used by name)
    _hold_request, _never_forbidden, _padspan_team, _remember, _shown, _spin, _to_padspan, _up, _w, house,
)
from tests.wled_fake import simple_device

ON = SimpleNamespace(state="on", attributes={})
OFF = SimpleNamespace(state="off", attributes={})

async def _solo(house, lit=True):
    dev = simple_device()
    did = house.add("valance", dev)
    await _remember(house, did)
    await _to_padspan(house, did)
    await E.async_power(house.hass, "light.valance_main", lit)
    await house.settle()
    _up(house, [dev], 60)
    return dev, house.store.get("28562f551738")


async def test_p2_solo_fresh_on_but_last_cmd_says_outside_off(house, monkeypatch):
    dev, rec = await _solo(house, lit=True)
    await dev.handle("POST", "json/state", {"on": False})           # wall button off, just before
    held, release = _hold_request(monkeypatch, house, "GET", "json/si")
    p = asyncio.ensure_future(E.async_power(house.hass, "light.valance_main", True, source="service"))
    await _w(held.wait())
    h = asyncio.ensure_future(E.on_state_change(house.hass, "light.valance_main", ON, OFF))
    await _spin()
    release.set()
    res = await _w(p)
    await _w(h)
    await house.settle()
    on_after_cmd = dev.serialize_state()["on"]
    # A power cut an hour later; HA shows it as on→on (2026.7.4 re-polls at once).
    _up(house, [dev], 3600)
    dev.reboot()
    await E.on_state_change(house.hass, "light.valance_main", ON, _shown(128))
    await house.settle()
    assert on_after_cmd is True
    assert rec["last_cmd"]["on"] is True, "last_cmd must record the newer fresh on"
    assert dev.serialize_state()["on"] is True, "after a power cut the light must come back on"


async def test_p2_control_no_outside_report(house, monkeypatch):
    dev, rec = await _solo(house, lit=True)
    await dev.handle("POST", "json/state", {"on": False})
    await E.async_power(house.hass, "light.valance_main", True, source="service")
    await house.settle()
    _up(house, [dev], 3600)
    dev.reboot()
    await E.on_state_change(house.hass, "light.valance_main", ON, _shown(128))
    await house.settle()
    assert dev.serialize_state()["on"] is True and rec["last_cmd"]["on"] is True


async def test_p3_team_area_off_reported_late_undoes_the_fresh_on(house):
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", True)
    await house.settle()
    _up(house, devs, 60)
    for d in devs:                                    # HA's light.turn_off on the area
        await d.handle("POST", "json/state", {"on": False})
    for d in devs:
        d.gate = asyncio.Event()
    p = asyncio.ensure_future(E.async_power(house.hass, "light.m0_main", True, source="service"))
    await _spin()
    hs = [asyncio.ensure_future(E.on_state_change(house.hass, eid, ON, OFF))
          for i in range(3) for eid in (f"light.m{i}_main", f"light.m{i}", f"light.m{i}_segment_1")]
    await _spin()
    for d in devs:
        d.gate.set()
    res = await _w(p)
    await _w(asyncio.gather(*hs))
    await house.settle()
    for d in devs:
        d.gate = None
    ok = [r["ok"] for r in res["results"]]
    final = [d.serialize_state()["on"] for d in devs]
    assert not (all(ok) and final != [True, True, True]), "reported ok, yet PadSpan switched them off after"


async def test_p3b_team_one_member_wall_off_splits_the_team(house):
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", True)
    await house.settle()
    _up(house, devs, 60)
    await devs[1].handle("POST", "json/state", {"on": False})      # m1's wall button: off, just before
    for d in devs:
        d.gate = asyncio.Event()
    # The Atlas "on" for the team (e.g. with a brightness), issued just after.
    p = asyncio.ensure_future(E.async_power(house.hass, "light.m0_main", True, 200, source="atlas"))
    await _spin()
    hs = [asyncio.ensure_future(E.on_state_change(house.hass, "light.m1_main", ON, OFF))]
    await _spin()
    for d in devs:
        d.gate.set()
    res = await _w(p)
    await _w(asyncio.gather(*hs))
    await house.settle()
    for d in devs:
        d.gate = None
    final = [d.serialize_state()["on"] for d in devs]
    assert final in ([True, True, True], [False, False, False]), f"team split: {final}"


async def test_nowrite_fresh_off_other_lights_report_after(house):
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", True)
    await house.settle()
    _up(house, devs, 60)
    for d in devs:                                    # HA's area off, just before
        await d.handle("POST", "json/state", {"on": False})
    n = [len(d.posts()) for d in devs]
    for d in devs:
        d.gate = asyncio.Event()
    p = asyncio.ensure_future(E.async_power(house.hass, "light.m0_main", False, source="service"))
    await _spin()
    hs = [asyncio.ensure_future(E.on_state_change(house.hass, eid, ON, OFF))
          for i in range(3) for eid in (f"light.m{i}_main", f"light.m{i}", f"light.m{i}_segment_1")]
    await _spin()
    for d in devs:
        d.gate.set()
    res = await _w(p)
    await _w(asyncio.gather(*hs))
    await house.settle()
    for d in devs:
        d.gate = None
    assert all(r["ok"] for r in res["results"])
    assert [d.serialize_state()["on"] for d in devs] == [False, False, False]
    assert [len(d.posts()) - k for d, k in zip(devs, n)] == [0, 0, 0], "nothing to write, nothing written"
    assert all(house.store.get(d.info["mac"])["last_cmd"]["on"] is False for d in devs)


async def test_nowrite_fresh_on_matching_other_lights_report_after(house):
    devs, dids, _ = await _padspan_team(house)
    await E.async_power(house.hass, "light.m0_main", False)
    await house.settle()
    _up(house, devs, 60)
    for d in devs:                                    # HA's area on (WLED restores the look at 128), just before
        await d.handle("POST", "json/state", {"on": True})
    for d in devs:
        d.gate = asyncio.Event()
    p = asyncio.ensure_future(E.async_power(house.hass, "light.m0_main", True, source="service"))
    await _spin()
    hs = [asyncio.ensure_future(E.on_state_change(house.hass, eid, OFF, _shown(128)))
          for i in range(3) for eid in (f"light.m{i}_main", f"light.m{i}", f"light.m{i}_segment_1")]
    await _spin()
    for d in devs:
        d.gate.set()
    res = await _w(p)
    await _w(asyncio.gather(*hs))
    await house.settle()
    for d in devs:
        d.gate = None
    assert all(r["ok"] for r in res["results"])
    assert [d.serialize_state()["on"] for d in devs] == [True, True, True]
    assert len({d.serialize_state()["bri"] for d in devs}) == 1

