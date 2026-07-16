# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Tests for the shared TTL cache around websocket._live_snapshot."""

from __future__ import annotations

from typing import Any

from custom_components.padspan_ha import websocket as ws_mod
from custom_components.padspan_ha.const import DOMAIN


class _FakeHass:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {}


def _patch_builder(monkeypatch):
    """Replace the real pipeline with a counter that returns a fresh dict."""
    calls = {"n": 0}

    async def _fake_build(hass):
        calls["n"] += 1
        return {"source": "live", "build_no": calls["n"]}

    monkeypatch.setattr(ws_mod, "_build_live_snapshot", _fake_build)
    return calls


async def test_second_call_within_ttl_serves_cached(monkeypatch) -> None:
    hass = _FakeHass()
    calls = _patch_builder(monkeypatch)

    first = await ws_mod._live_snapshot(hass)
    second = await ws_mod._live_snapshot(hass)

    assert calls["n"] == 1
    assert first is second  # shared object, not a rebuild


async def test_expired_ttl_rebuilds(monkeypatch) -> None:
    hass = _FakeHass()
    calls = _patch_builder(monkeypatch)

    await ws_mod._live_snapshot(hass)
    # Age the cache entry past the TTL instead of sleeping.
    ts, snap = hass.data[DOMAIN][ws_mod._DATA_SNAPSHOT_CACHE]
    hass.data[DOMAIN][ws_mod._DATA_SNAPSHOT_CACHE] = (
        ts - ws_mod._SNAPSHOT_CACHE_TTL_S - 0.1,
        snap,
    )

    second = await ws_mod._live_snapshot(hass)
    assert calls["n"] == 2
    assert second["build_no"] == 2


async def test_invalidate_forces_rebuild(monkeypatch) -> None:
    hass = _FakeHass()
    calls = _patch_builder(monkeypatch)

    await ws_mod._live_snapshot(hass)
    ws_mod._invalidate_snapshot_cache(hass)
    second = await ws_mod._live_snapshot(hass)

    assert calls["n"] == 2
    assert second["build_no"] == 2


async def test_concurrent_callers_share_one_build(monkeypatch) -> None:
    import asyncio

    hass = _FakeHass()
    calls = {"n": 0}

    async def _slow_build(hass_):
        calls["n"] += 1
        await asyncio.sleep(0.05)
        return {"build_no": calls["n"]}

    monkeypatch.setattr(ws_mod, "_build_live_snapshot", _slow_build)

    results = await asyncio.gather(*[ws_mod._live_snapshot(hass) for _ in range(5)])
    assert calls["n"] == 1
    assert all(r is results[0] for r in results)
