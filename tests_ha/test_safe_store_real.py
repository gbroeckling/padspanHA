# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A save through SafeStore, with Home Assistant's own Store writing real files.

Home Assistant's Store logs a failed write and returns normally. SafeStore
watches that Store's write and compares a digest of the text it wrote with the
file's (tests/test_safe_store_verify.py has the rules with a stand-in). Here
the Store is Home Assistant's: the check sees its writes, a write that fails
the way a full or read-only disk fails it is a failed save with one error and
a repair notice, the next good save takes the notice down, and saves that
race each other, a load, a change to the data, or shutdown are judged right.
"""

from __future__ import annotations

import asyncio
import contextlib
import errno
import json
import logging
import os
from pathlib import Path
from unittest.mock import patch

import homeassistant.helpers.json as ha_json
import homeassistant.helpers.storage as storage
import pytest
from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE
from homeassistant.core import CoreState
from homeassistant.helpers import issue_registry as ir
from homeassistant.util.file import WriteError

from custom_components.padspan_ha import safe_store
from custom_components.padspan_ha.calibration_store import CalibrationStore

DOMAIN = "padspan_ha"
NOTICE = "save_not_written_calibration"
SECRET = "cp_secret_7f3a"
# Home Assistant 2025.12 and later hand the written text to
# _write_prepared_data, and SafeStore compares its digest with the file's;
# earlier ones make it and write it in one step, and the check is that the
# write returned.
HANDS_TEXT = hasattr(storage.Store, "_write_prepared_data")
# Where the Store's write finds write_utf8_file: storage itself from 2025.12,
# the JSON helper's save_json before.
WRITER = storage if hasattr(storage, "write_utf8_file") else ha_json


@pytest.fixture
def hass_storage():
    """Real files: the stores read and write .storage on disk."""
    yield {}


def _points(n: int, tag: str = "cp") -> dict:
    return {"points": [{"id": f"{tag}_{i}", "x_m": i * 0.5, "y_m": 1.25,
                        "scanner_readings": [{"source": "aa:bb", "rssi_samples": [-60.0, -61.5] * 10}]}
                       for i in range(n)], "model": {}}


async def _store(hass) -> CalibrationStore:
    cal = CalibrationStore(hass)
    await cal.async_setup_fast()
    return cal


def _on_disk(cal: CalibrationStore):
    return json.loads(Path(cal._raw_store.path).read_bytes())["data"]


async def test_the_check_sees_home_assistants_write(hass):
    cal = await _store(hass)
    s = cal.store
    assert s._watched, "SafeStore could not watch this Home Assistant's Store write"
    data = _points(3)
    assert await s.async_save(data) is True
    assert _on_disk(cal) == data
    if HANDS_TEXT:
        assert s._wrote and s._wrote == await hass.async_add_executor_job(safe_store._file_digest, cal._raw_store.path)
    else:
        assert s._written and s._wrote is None
    assert s.failed_saves == 0


def _full_disk(*args, **kwargs):
    raise WriteError(OSError(errno.ENOSPC, "No space left on device"))


@pytest.mark.parametrize("how", ["full disk", "read-only folder"])
async def test_a_write_that_fails_is_a_failed_save_and_the_next_good_one_clears_it(hass, how, caplog):
    if how == "read-only folder" and hasattr(os, "geteuid") and os.geteuid() == 0:
        pytest.skip("root writes into a read-only folder")
    cal = await _store(hass)
    s = cal.store
    first = _points(2)
    assert await s.async_save(first) is True
    folder = Path(cal._raw_store.path).parent

    caplog.clear()
    full = patch.object(WRITER, "write_utf8_file", _full_disk) if how == "full disk" else contextlib.nullcontext()
    second = _points(3, SECRET)
    with caplog.at_level(logging.DEBUG), full:
        if how == "read-only folder":
            folder.chmod(0o555)
        try:
            results = [await s.async_save(second), await s.async_save(second)]
        finally:
            folder.chmod(0o755)

    assert results == [False, False]
    assert s.failed_saves == 2
    assert _on_disk(cal) == first, "the file is as the failed write left it"
    ours = [r for r in caplog.records if r.name == safe_store.__name__ and r.levelno >= logging.ERROR]
    assert len(ours) == 1 and "calibration" in ours[0].getMessage()
    assert not any(SECRET in r.getMessage() or "1.25" in r.getMessage() for r in caplog.records)
    issue = ir.async_get(hass).async_get_issue(DOMAIN, NOTICE)
    assert issue is not None and issue.translation_key == "save_not_written"
    assert issue.translation_placeholders == {"store": "calibration"}

    assert await s.async_save(second) is True
    assert _on_disk(cal) == second
    assert ir.async_get(hass).async_get_issue(DOMAIN, NOTICE) is None


async def test_data_changed_while_it_is_written_is_judged_by_what_was_written(hass):
    cal = await _store(hass)
    s = cal.store
    live = _points(2)
    real_write = WRITER.write_utf8_file

    def _write_then_change(*args, **kwargs):
        # The data changes the moment its text has gone to disk, before the save is judged. Not one event-loop tick
        # after the save starts: Home Assistant 2024.8 turns the data into text later, in the executor, so a tick
        # could land before that and the file would hold the change (a red run on the v0.38.275 tag).
        real_write(*args, **kwargs)
        if not any(p["id"] == "cp_late" for p in live["points"]):
            live["points"].append({"id": "cp_late", "x_m": 9.0, "y_m": 9.0})

    with patch.object(WRITER, "write_utf8_file", _write_then_change):
        assert await s.async_save(live) is True
    assert len(live["points"]) == 3, "the data did change while it was written"
    assert [p["id"] for p in _on_disk(cal)["points"]] == ["cp_0", "cp_1"]
    assert await s.async_save(live) is True
    assert len(_on_disk(cal)["points"]) == 3 and s.failed_saves == 0


async def test_saves_racing_each_other_and_a_load(hass):
    cal = await _store(hass)
    s = cal.store
    a, b = _points(2, "a"), _points(4, "b")
    got = await asyncio.gather(s.async_save(a), s.async_load(), s.async_save(b), s.async_load())
    assert got[0] is True and got[2] is True
    assert all(x is None or x in (a, b) for x in (got[1], got[3]))
    assert _on_disk(cal) == b and s.failed_saves == 0


async def test_a_save_during_shutdown_is_written_in_home_assistants_last_step(hass):
    cal = await _store(hass)
    s = cal.store
    assert await s.async_save(_points(1)) is True
    data = _points(5)
    hass.set_state(CoreState.stopping)
    try:
        assert await asyncio.wait_for(s.async_save(data), 5) is True
        assert _on_disk(cal) != data, "Home Assistant keeps it for its last step"
        hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
        await hass.async_block_till_done()
        assert _on_disk(cal) == data
    finally:
        hass.set_state(CoreState.running)
    assert s.failed_saves == 0
