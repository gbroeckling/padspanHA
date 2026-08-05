# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Unit tests for custom_components.padspan_ha.forensics_store."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.const import DATA_SETTINGS, DOMAIN
from custom_components.padspan_ha.forensics_store import (
    DEFAULT_RETENTION_DAYS,
    FRESH_S,
    GAP_S,
    MAX_ADDRS,
    MAX_SESSIONS_PER_ADDR,
    SAVE_INTERVAL_S,
    ForensicsStore,
    _recording_enabled,
    retention_days,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_store() -> ForensicsStore:
    """Create a ForensicsStore backed by mocks."""
    store = ForensicsStore.__new__(ForensicsStore)
    store.hass = MagicMock()
    store.store = AsyncMock()
    store.store.async_load = AsyncMock(return_value=None)
    store.store.async_save = AsyncMock()
    store.addrs = {}
    store._dirty = False
    store._last_save_ts = 0.0
    return store


def _ad(addr: str, rssi: int = -60, source: str = "scanner1", name: str = "", age_s: float = 1.0) -> dict:
    return {"address": addr, "rssi": rssi, "source": source, "name": name or addr, "age_s": age_s}


def _hass_with_settings(**settings) -> SimpleNamespace:
    st = SimpleNamespace(data=settings)
    hass = SimpleNamespace(data={DOMAIN: {DATA_SETTINGS: st}})
    return hass


# ---------------------------------------------------------------------------
# Tests: recording sessions
# ---------------------------------------------------------------------------


def test_record_creates_session() -> None:
    """A first sighting opens a session [now, now]."""
    store = _make_store()
    n = store.record_sightings([_ad("aa:bb:cc:dd:ee:ff", rssi=-55)], now=1000.0)
    assert n == 1
    entry = store.addrs["AA:BB:CC:DD:EE:FF"]
    assert entry["sessions"] == [[1000.0, 1000.0, -55, ["scanner1"]]]
    assert store._dirty


def test_record_merges_multiple_sources() -> None:
    """One record per (addr, source) pair merges to best rssi + source union."""
    store = _make_store()
    store.record_sightings([
        _ad("AA:BB:CC:DD:EE:FF", rssi=-70, source="kitchen"),
        _ad("AA:BB:CC:DD:EE:FF", rssi=-50, source="garage"),
    ], now=1000.0)
    s = store.addrs["AA:BB:CC:DD:EE:FF"]["sessions"][0]
    assert s[2] == -50
    assert sorted(s[3]) == ["garage", "kitchen"]


def test_record_extends_session_within_gap() -> None:
    """A sighting within GAP_S of the session end extends it."""
    store = _make_store()
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF", rssi=-70)], now=1000.0)
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF", rssi=-40, source="garage")], now=1000.0 + GAP_S)
    sessions = store.addrs["AA:BB:CC:DD:EE:FF"]["sessions"]
    assert len(sessions) == 1
    assert sessions[0][1] == 1000.0 + GAP_S
    assert sessions[0][2] == -40  # peak rssi upgraded
    assert "garage" in sessions[0][3]


def test_record_opens_new_session_after_gap() -> None:
    """Silence longer than GAP_S closes the session and opens a new one."""
    store = _make_store()
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF")], now=1000.0)
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF")], now=1000.0 + GAP_S + 1)
    sessions = store.addrs["AA:BB:CC:DD:EE:FF"]["sessions"]
    assert len(sessions) == 2
    assert sessions[0][1] == 1000.0
    assert sessions[1][0] == 1000.0 + GAP_S + 1


def test_record_ignores_stale_ads() -> None:
    """Ads older than FRESH_S do not count as present."""
    store = _make_store()
    n = store.record_sightings([_ad("AA:BB:CC:DD:EE:FF", age_s=FRESH_S + 10)], now=1000.0)
    assert n == 0
    assert store.addrs == {}
    assert not store._dirty


def test_record_backfills_name() -> None:
    """A real advertised name is kept; the address itself is not a name."""
    store = _make_store()
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF")], now=1000.0)
    assert store.addrs["AA:BB:CC:DD:EE:FF"]["name"] == ""
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF", name="Garmin Watch")], now=1010.0)
    assert store.addrs["AA:BB:CC:DD:EE:FF"]["name"] == "Garmin Watch"


def test_backward_clock_step_does_not_rewind_session() -> None:
    """An NTP backward step must not move a session's end below its start."""
    store = _make_store()
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF")], now=1000.0)
    store.record_sightings([_ad("AA:BB:CC:DD:EE:FF")], now=700.0)  # clock stepped back
    sessions = store.addrs["AA:BB:CC:DD:EE:FF"]["sessions"]
    assert len(sessions) == 1
    assert sessions[0][1] == 1000  # end unchanged, not rewound
    assert sessions[0][1] >= sessions[0][0]


def test_session_cap_per_addr() -> None:
    """Sessions per address are capped, dropping the oldest."""
    store = _make_store()
    t = 1000.0
    for _ in range(MAX_SESSIONS_PER_ADDR + 5):
        store.record_sightings([_ad("AA:BB:CC:DD:EE:FF")], now=t)
        t += GAP_S + 10  # force a new session each time
    sessions = store.addrs["AA:BB:CC:DD:EE:FF"]["sessions"]
    assert len(sessions) == MAX_SESSIONS_PER_ADDR
    # Oldest sessions dropped — first remaining start is later than t0
    assert sessions[0][0] > 1000.0


# ---------------------------------------------------------------------------
# Tests: pruning
# ---------------------------------------------------------------------------


def test_prune_drops_expired_sessions_and_empty_addrs() -> None:
    store = _make_store()
    now = 1_000_000.0
    store.record_sightings([_ad("AA:AA:AA:AA:AA:AA")], now=now - 8 * 86400)
    store.record_sightings([_ad("BB:BB:BB:BB:BB:BB")], now=now - 3600)
    removed = store.prune(retention_days=7, now=now)
    assert removed == 1
    assert "AA:AA:AA:AA:AA:AA" not in store.addrs
    assert "BB:BB:BB:BB:BB:BB" in store.addrs


def test_prune_enforces_addr_cap() -> None:
    store = _make_store()
    now = 1_000_000.0
    # Synthesize MAX_ADDRS + 10 addresses with staggered last-seen times
    for i in range(MAX_ADDRS + 10):
        addr = f"AA:{i:010X}"
        store.addrs[addr] = {"name": "", "sessions": [[now - i, now - i, -60, []]]}
    store.prune(retention_days=90, now=now)
    assert len(store.addrs) == MAX_ADDRS
    # The least-recently-seen entries were the ones dropped
    assert f"AA:{MAX_ADDRS + 9:010X}" not in store.addrs
    assert "AA:0000000000" in store.addrs


# ---------------------------------------------------------------------------
# Tests: query
# ---------------------------------------------------------------------------


def test_query_overlap_and_dwell() -> None:
    store = _make_store()
    store.addrs = {
        "IN:WINDOW": {"name": "hit", "sessions": [[100.0, 200.0, -50, ["s1"]]]},
        "BEFORE": {"name": "", "sessions": [[10.0, 40.0, -60, []]]},
        "AFTER": {"name": "", "sessions": [[400.0, 500.0, -60, []]]},
        "SPANS": {"name": "", "sessions": [[50.0, 450.0, -40, ["s2"]]]},
    }
    res = store.query(150.0, 300.0)
    addrs = [r["address"] for r in res]
    assert "IN:WINDOW" in addrs and "SPANS" in addrs
    assert "BEFORE" not in addrs and "AFTER" not in addrs
    spans = next(r for r in res if r["address"] == "SPANS")
    assert spans["dwell_s"] == 150.0  # clamped to the window
    inw = next(r for r in res if r["address"] == "IN:WINDOW")
    assert inw["dwell_s"] == 50.0
    # Sorted by dwell desc
    assert res[0]["address"] == "SPANS"


def test_query_boundary_touch_counts() -> None:
    """A session ending exactly at window start still matches (inclusive)."""
    store = _make_store()
    store.addrs = {"EDGE": {"name": "", "sessions": [[50.0, 100.0, -60, []]]}}
    res = store.query(100.0, 200.0)
    assert len(res) == 1
    assert res[0]["dwell_s"] == 0.0


def test_query_limit() -> None:
    store = _make_store()
    for i in range(30):
        store.addrs[f"AD:{i:02X}"] = {"name": "", "sessions": [[100.0, 100.0 + i, -60, []]]}
    res = store.query(0.0, 1000.0, limit=10)
    assert len(res) == 10


# ---------------------------------------------------------------------------
# Tests: stats / clear / save debounce
# ---------------------------------------------------------------------------


def test_stats() -> None:
    store = _make_store()
    store.addrs = {
        "A1": {"name": "", "sessions": [[100.0, 150.0, -60, []], [500.0, 600.0, -60, []]]},
        "A2": {"name": "", "sessions": [[50.0, 80.0, -60, []]]},
    }
    s = store.stats()
    assert s["addr_count"] == 2
    assert s["session_count"] == 3
    assert s["oldest_ts"] == 50.0
    assert s["newest_ts"] == 600.0


async def test_clear() -> None:
    store = _make_store()
    store.addrs = {"A1": {"name": "", "sessions": [[1.0, 2.0, -60, []]]}}
    store._dirty = True
    removed = await store.async_clear()
    assert removed == 1
    assert store.addrs == {}
    assert not store._dirty
    store.store.async_save.assert_awaited_once_with({"addrs": {}})


async def test_save_debounce_and_force() -> None:
    store = _make_store()
    store._dirty = True
    store._last_save_ts = 1000.0
    # Within the save interval: skipped
    assert not await store.async_save_if_due(now=1000.0 + SAVE_INTERVAL_S - 1)
    # Force overrides the debounce
    assert await store.async_save_if_due(now=1000.0 + 10, force=True)
    assert not store._dirty
    # Not dirty: nothing to do even when forced
    assert not await store.async_save_if_due(now=99999.0, force=True)


async def test_load_accepts_valid_and_rejects_garbage() -> None:
    store = _make_store()
    store.store.async_load = AsyncMock(return_value={"addrs": {"A1": {"name": "x", "sessions": []}}})
    await store.async_load()
    assert "A1" in store.addrs
    store.store.async_load = AsyncMock(return_value=["not", "a", "dict"])
    await store.async_load()
    assert store.addrs == {}


# ---------------------------------------------------------------------------
# Tests: settings gates
# ---------------------------------------------------------------------------


def test_recording_enabled_gate() -> None:
    assert _recording_enabled(_hass_with_settings(forensics_enabled=True, data_mode="live"))
    assert not _recording_enabled(_hass_with_settings(forensics_enabled=False, data_mode="live"))
    assert not _recording_enabled(_hass_with_settings(forensics_enabled=True, data_mode="sample"))
    assert not _recording_enabled(SimpleNamespace(data={}))


def test_retention_days_whitelist() -> None:
    assert retention_days(_hass_with_settings(forensics_retention_days=30)) == 30
    assert retention_days(_hass_with_settings(forensics_retention_days=13)) == DEFAULT_RETENTION_DAYS
    assert retention_days(_hass_with_settings(forensics_retention_days="90")) == 90
    assert retention_days(_hass_with_settings()) == DEFAULT_RETENTION_DAYS
    assert retention_days(SimpleNamespace(data={})) == DEFAULT_RETENTION_DAYS
