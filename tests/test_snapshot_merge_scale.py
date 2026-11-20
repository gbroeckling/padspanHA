"""The device list's guessing merges (D2-D7) stay linear in a group's size.

Next to a street, one of those groups can hold hundreds of addresses: every
device that says nothing at all, heard by the same receivers (D7), or the
same kind of Apple message (D5). Merged one by one, each merge re-read,
re-checked and re-sorted the primary's growing address list, so a group of k
cost k² — and the build runs on Home Assistant's event loop, every poll.
"""

from __future__ import annotations

import asyncio
import builtins

import pytest

from custom_components.padspan_ha import bluetooth_live as _bl
from custom_components.padspan_ha import snapshot_builder as SB
from tests import golden_snapshot as gs
from tests import room_speed_sim as sim

K = 400


def _bare(i: int) -> str:
    # Random (locally administered) addresses, nothing else said: D7's kind.
    return "F2:%02X:%02X:00:00:%02X" % (i >> 8, i & 0xFF, 0x61)


def _build(monkeypatch: pytest.MonkeyPatch) -> tuple[dict, int]:
    """One build with K bare devices heard together by one receiver; how many
    list items the builder sorted in all."""
    clock = sim.Clock()
    scanners = {gs.KITCHEN: gs.ESPHomeScanner(gs.KITCHEN, "Kitchen Proxy", "active")}
    manager = sim.FakeManager(list(scanners.values()))
    hass, _stores = gs._house()
    sorted_items = [0]
    real_sorted = builtins.sorted

    def _counting_sorted(it, *a, **kw):
        out = real_sorted(it, *a, **kw)
        sorted_items[0] += len(out)
        return out

    loop = asyncio.new_event_loop()
    bl_box: list = [None]
    try:
        with gs._pinned(clock, manager, list(scanners.values()), bl_box, [gs.PrivateBLEResolver(hass)]):
            bl = bl_box[0] = _bl.BluetoothLive(hass)
            for i in range(K):
                gs._hear(gs._h(10.0, _bare(i), {gs.KITCHEN: -70}), clock, scanners, bl)
            clock.t = 20.0
            monkeypatch.setattr(SB, "sorted", _counting_sorted, raising=False)
            snap = loop.run_until_complete(SB._build_live_snapshot(hass))
            monkeypatch.delattr(SB, "sorted", raising=False)
    finally:
        loop.close()
    return snap, sorted_items[0]


def test_a_big_group_merges_into_one_device_with_every_address(monkeypatch: pytest.MonkeyPatch) -> None:
    snap, _n = _build(monkeypatch)
    merged = [o for o in snap["objects"]["list"] if o.get("_dedup_reason") == "bare_random_mac"]
    assert len(merged) == 1
    assert merged[0]["name"] == f"Unknown BLE ({K} rotations)"
    assert merged[0]["all_addresses"] == sorted(_bare(i) for i in range(K))


def test_the_merge_work_grows_with_the_group_not_its_square(monkeypatch: pytest.MonkeyPatch) -> None:
    _snap, n = _build(monkeypatch)
    # One sort of the group's addresses, and a few small ones per device.
    # Merged one by one it was about K²/2 (80,000 here).
    assert n < 20 * K, f"{n} list items sorted for a group of {K}"
