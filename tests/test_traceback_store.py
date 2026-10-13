# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Tests for TracebackStore append-only segment persistence."""

from __future__ import annotations

import json
import time
from typing import Any

from custom_components.padspan_ha import traceback_store as tb_mod
from custom_components.padspan_ha.traceback_store import TracebackStore

from tests.conftest import MockHass, MockStore


def _make_store(tmp_path) -> TracebackStore:
    tb = TracebackStore(MockHass(tmp_path))
    tb._store = MockStore()
    return tb


def _obj(key: str = "ble:AA:BB", room: str = "Office") -> dict[str, Any]:
    return {"key": key, "room": room, "identified": True, "rssi": -60}


async def test_flush_appends_only_pending(tmp_path, monkeypatch) -> None:
    tb = _make_store(tmp_path)
    await tb.async_load()

    monkeypatch.setattr(tb_mod, "MIN_FRAME_INTERVAL_S", 0)
    tb.record_frame([_obj()])
    await tb.async_flush()

    seg_files = list(tb._seg_dir.glob("*.jsonl"))
    assert len(seg_files) == 1
    size_after_first = seg_files[0].stat().st_size
    assert size_after_first > 0
    assert not tb._pending

    tb._last_frame_ts = 0  # bypass min frame gap
    tb.record_frame([_obj(room="Kitchen")])
    await tb.async_flush()

    # Second flush appended one line; the first line was not rewritten.
    lines = seg_files[0].read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["o"][0]["r"] == "Office"
    assert json.loads(lines[1])["o"][0]["r"] == "Kitchen"


async def test_reload_from_segments(tmp_path) -> None:
    tb = _make_store(tmp_path)
    await tb.async_load()
    tb.record_frame([_obj()])
    await tb.async_flush()

    tb2 = _make_store(tmp_path)
    await tb2.async_load()
    assert len(tb2.frames) == 1
    assert tb2.frames[0]["o"][0]["r"] == "Office"


async def test_legacy_store_migrates_once(tmp_path) -> None:
    tb = _make_store(tmp_path)
    legacy_frame = {"ts": time.time() - 60, "o": [{"k": "ble:OLD", "r": "Garage"}]}
    tb._store._data = {"frames": [legacy_frame]}

    await tb.async_load()
    assert len(tb.frames) == 1
    # Migrated into a segment file and the legacy blob removed.
    assert list(tb._seg_dir.glob("*.jsonl"))
    assert tb._store._data is None

    tb2 = _make_store(tmp_path)
    await tb2.async_load()
    assert len(tb2.frames) == 1
    assert tb2.frames[0]["o"][0]["r"] == "Garage"


async def test_torn_segment_line_is_skipped(tmp_path) -> None:
    tb = _make_store(tmp_path)
    await tb.async_load()
    tb.record_frame([_obj()])
    await tb.async_flush()

    seg = list(tb._seg_dir.glob("*.jsonl"))[0]
    with open(seg, "a", encoding="utf-8") as fh:
        fh.write('{"ts": 123, "o": [{"k"')  # crash mid-append

    tb2 = _make_store(tmp_path)
    await tb2.async_load()
    assert len(tb2.frames) == 1  # torn line ignored, good frame kept


async def test_old_segment_files_are_deleted(tmp_path) -> None:
    tb = _make_store(tmp_path)
    await tb.async_load()
    tb._seg_dir.mkdir(parents=True, exist_ok=True)

    old_ts = time.time() - tb_mod.MAX_AGE_S - 2 * 86400
    old_file = tb._seg_dir / tb._seg_name(old_ts)
    old_file.write_text(json.dumps({"ts": old_ts, "o": []}) + "\n", encoding="utf-8")

    await tb.async_flush()
    assert not old_file.exists()


async def test_maybe_save_respects_interval(tmp_path) -> None:
    tb = _make_store(tmp_path)
    await tb.async_load()
    tb.record_frame([_obj()])

    # _last_save_ts was just set by async_load — within SAVE_INTERVAL_S.
    await tb.async_maybe_save()
    assert tb._pending  # nothing flushed yet

    tb._last_save_ts = time.time() - tb_mod.SAVE_INTERVAL_S - 1
    await tb.async_maybe_save()
    assert not tb._pending
    assert list(tb._seg_dir.glob("*.jsonl"))


def test_history_records_metres_not_photo_fractions() -> None:
    """Replaying yesterday must not depend on where a photo hangs today.

    History used to store the k-NN answer in whichever map's fraction space
    it came from, plus that map's id — so re-placing the photo silently moved
    the past. Metres mean the same thing on every future startup.
    """
    import inspect

    from custom_components.padspan_ha import traceback_store

    src = inspect.getsource(traceback_store)
    assert 'entry["x_m"]' in src and 'entry["y_m"]' in src
    assert 'o.get("x_frac")' not in src
    assert 'entry["m"] = str(knn_map)' not in src


def _seed(tb, n: int, base: float, key: str = "ble:AA:BB") -> list[float]:
    """n frames 10 s apart from base, written to the segment files."""
    frames = [{"ts": base + i * 10.0, "o": [{"k": key, "r": "Office"}]} for i in range(n)]
    tb._append_sync(frames)
    return [f["ts"] for f in frames]


async def test_a_long_range_is_downsampled_across_the_whole_window_not_cut_short(tmp_path) -> None:
    """get_frames stopped collecting at max_frames, so a 7-day range replayed
    only its oldest ~9 hours (review 2026-09-23, found through Traceback's
    Full house activity). It must sample the whole window evenly."""
    tb = _make_store(tmp_path)
    ts = _seed(tb, 10_000, time.time() - 200_000)
    got = await tb.async_get_frames(start_ts=ts[0], end_ts=ts[-1], max_frames=100)
    assert len(got) == 100
    assert got[0]["ts"] == ts[0]
    assert got[-1]["ts"] == ts[-1]         # the window's last frame is kept


async def test_get_frames_reports_how_many_the_window_held(tmp_path) -> None:
    tb = _make_store(tmp_path)
    ts = _seed(tb, 1000, time.time() - 20_000)
    frames, matched = await tb.async_get_frames(start_ts=ts[0], end_ts=ts[-1], max_frames=100, with_count=True)
    assert len(frames) == 100 and matched == 1000
    frames, matched = await tb.async_get_frames(start_ts=ts[0], end_ts=ts[10], max_frames=100, with_count=True)
    assert matched == len(frames) == 11


# ── The week lives on disk, not in memory ────────────────────────────────────
# A week of frames read back into Python was ~1 KB per tracked object per
# frame: ~600 MB for ten devices at home. Since 0.38.112 every install records
# around the clock, so every install filled it.

async def test_memory_holds_only_the_recent_window(tmp_path) -> None:
    tb = _make_store(tmp_path)
    ts = _seed(tb, 5000, time.time() - 50_000)
    await tb.async_load()
    assert all(f["ts"] > time.time() - tb_mod.MEM_WINDOW_S for f in tb.frames)
    assert len(tb.frames) < 100
    frames, matched = await tb.async_get_frames(start_ts=ts[0], end_ts=ts[-1], max_frames=6000, with_count=True)
    assert matched == 5000 and len(frames) == 5000


async def test_one_object_and_unflushed_frames_counted_once(tmp_path) -> None:
    tb = _make_store(tmp_path)
    base = time.time() - 1000
    _seed(tb, 20, base, key="ble:ONE")
    _seed(tb, 20, base + 5, key="ble:TWO")
    await tb.async_load()
    tb.record_frame([_obj(key="ble:ONE")])
    got, n = await tb.async_get_frames(start_ts=base, end_ts=time.time() + 1, obj_key="ble:ONE", with_count=True)
    assert n == 21 and all(o["k"] == "ble:ONE" for f in got for o in f["o"])
    await tb.async_flush()
    _got, n2 = await tb.async_get_frames(start_ts=base, end_ts=time.time() + 1, obj_key="ble:ONE", with_count=True)
    assert n2 == 21


async def test_a_restore_joins_the_history_instead_of_erasing_since(tmp_path) -> None:
    """Restoring a backup replaced the history, so every movement recorded
    after the backup was gone."""
    tb = _make_store(tmp_path)
    now = time.time()
    _seed(tb, 3, now - 3000, key="ble:SINCE")
    await tb.async_load()
    backup = [{"ts": now - 90_000 + i, "o": [{"k": "ble:OLD", "r": "Garage"}]} for i in range(2)]
    await tb.async_merge(backup)
    got = await tb.async_get_frames(start_ts=now - 100_000, end_ts=now)
    assert [o["k"] for f in got for o in f["o"]] == ["ble:OLD", "ble:OLD", "ble:SINCE", "ble:SINCE", "ble:SINCE"]
    await tb.async_merge(backup)          # restoring twice adds nothing
    assert len(await tb.async_get_frames(start_ts=now - 100_000, end_ts=now)) == 5


async def test_a_backup_carries_the_last_day(tmp_path) -> None:
    tb = _make_store(tmp_path)
    now = time.time()
    _seed(tb, 2, now - 3 * 86400)
    _seed(tb, 2, now - 3600)
    await tb.async_load()
    out = await tb.async_export()
    assert len(out) == 2 and all(f["ts"] > now - 86400 for f in out)


async def test_object_list_and_range_come_from_the_files(tmp_path) -> None:
    tb = _make_store(tmp_path)
    now = time.time()
    _seed(tb, 3, now - 5 * 86400, key="ble:OLDER")
    _seed(tb, 3, now - 600, key="ble:NEWER")
    await tb.async_load()
    keys = [o["key"] for o in await tb.async_get_object_keys()]
    assert keys == ["ble:NEWER", "ble:OLDER"]
    rng = await tb.async_get_time_range()
    assert rng["count"] == 6 and abs(rng["start"] - (now - 5 * 86400)) < 1
    tb.record_frame([_obj(key="ble:LIVE")])
    assert (await tb.async_get_object_keys())[0]["key"] == "ble:LIVE"
    assert (await tb.async_get_time_range())["count"] == 7


async def test_insights_stream_matches_the_in_memory_answer(tmp_path) -> None:
    from custom_components.padspan_ha.dwell_analytics import compute_dwell_stats
    tb = _make_store(tmp_path)
    now = time.time()
    frames = [{"ts": now - 7200 + i * 10.0, "o": [{"k": "ble:A", "r": "Office" if i < 300 else "Kitchen"}]}
              for i in range(600)]
    tb._append_sync(frames)
    await tb.async_load()
    assert await tb.async_dwell(now - 86400, now, "UTC") == compute_dwell_stats(frames, tz_name="UTC")


async def test_range_end_is_the_newest_frame_on_disk_with_nobody_home_now(tmp_path) -> None:
    """Memory holds ten minutes; with nobody home in them the end fell back to
    the start and a filtered replay's auto-expand searched [start, start]."""
    tb = _make_store(tmp_path)
    ts = _seed(tb, 50, time.time() - 7200)
    await tb.async_load()
    assert tb.frames == []
    rng = await tb.async_get_time_range()
    assert rng["end"] == ts[-1] and rng["start"] == ts[0]


async def test_the_poll_does_not_wait_behind_a_reader(tmp_path) -> None:
    tb = _make_store(tmp_path)
    await tb.async_load()
    tb.record_frame([_obj()])
    tb._last_save_ts = 0
    async with tb._io_lock:          # a replay or Insights reading the files
        await tb.async_maybe_save()
    assert tb._pending, "the poll flushed (it would have waited) while a reader held the files"


def test_both_passes_of_a_replay_share_one_retention_floor() -> None:
    import inspect
    src = inspect.getsource(TracebackStore._get_frames_sync)
    assert "start = max(start, time.time() - MAX_AGE_S)" in src
