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
