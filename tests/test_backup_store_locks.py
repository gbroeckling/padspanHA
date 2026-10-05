"""Backups, restores and factory resets against the stores' own writers
(backlog 2026-10-05).

- A restore or a factory reset holds a store's lock while it writes that
  store, where the store has one (Live Aboard's: House3dStore.lock, held by
  the 3D editor's Save, Remove all and the library), so a Save never lands
  under it: started meanwhile, it waits and goes on top.
- A manual backup whose read of a store fails saves nothing and says so.
  It recorded that store as {}, and restoring that backup emptied it.
"""

from __future__ import annotations

import asyncio
import copy
from unittest.mock import MagicMock

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import ws_backup
from custom_components.padspan_ha import ws_house3d as W
from custom_components.padspan_ha.const import DATA_HOUSE3D, DOMAIN, HOUSE3D_STORE_KEY
from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
from tests.test_house3d_store import _PIECE, _capture_backups, _disk_file, _house, _run, store  # noqa: F401


def _held_save(monkeypatch, store):
    """The first save of Live Aboard's file waits until released."""
    started, release = asyncio.Event(), asyncio.Event()
    real = store.async_save
    state = {"held": False}

    async def _save(self, data):
        if self.key == HOUSE3D_STORE_KEY and not state["held"]:
            state["held"] = True
            started.set()
            await release.wait()
        return await real(self, data)

    monkeypatch.setattr(store, "async_save", _save)
    return started, release


def _restore_msg(monkeypatch, stores: dict) -> dict:
    bk = {"backups": [{"id": "bk1", "created_at": "2026-01-01T00:00:00+00:00", "version": "0.38.99",
                       "note": "", "map_images": {}, "stores": stores}]}

    async def _load(_hass):
        return copy.deepcopy(bk)

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    return {"id": 1, "backup_id": "bk1"}


def test_a_save_started_while_a_restore_writes_goes_on_top_of_it(store, monkeypatch, tmp_path):
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "lights": {"light.a": {"z_m": 1.0}}}
    h = _house(tmp_path, on=True)
    _run(H.async_get_store(h))
    msg = _restore_msg(monkeypatch, {HOUSE3D_STORE_KEY: {**H.empty(), "lights": {"light.r": {"z_m": 3.0}}}})
    started, release = _held_save(monkeypatch, store)
    edit = MagicMock()

    async def both():
        restore = asyncio.ensure_future(ws_backup.ws_store_backup_restore(h, MagicMock(), msg))
        await asyncio.wait_for(started.wait(), 5)       # the restore is writing
        save = asyncio.ensure_future(W.ws_house3d_edit(h, edit, {"id": 2, "lights": {"light.b": {"z_m": 2.0}}}))
        await asyncio.wait({save}, timeout=0.5)
        release.set()
        await asyncio.wait_for(asyncio.gather(restore, save), 5)

    _run(both())
    assert edit.send_result.called, edit.send_error.call_args
    on_disk = store.saved[HOUSE3D_STORE_KEY]
    assert set(on_disk["lights"]) == {"light.r", "light.b"}, "the Save went under the restore"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == on_disk


def test_a_save_started_while_a_restore_takes_the_file_away_never_brings_it_back(store, monkeypatch, tmp_path):
    """The Bright import's safety backup ("there was no file"): the Save that
    waited goes on from no file, not from the house the restore took away."""
    from custom_components.padspan_ha.ws_common import ABSENT_MARKER
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "lights": {"light.a": {"z_m": 1.0}}}
    h = _house(tmp_path, on=True)
    _run(H.async_get_store(h))
    msg = _restore_msg(monkeypatch, {HOUSE3D_STORE_KEY: {ABSENT_MARKER: True}})
    real_remove = store.async_remove

    async def _remove(self):
        await asyncio.sleep(0)                          # taking the file away takes a moment
        return await real_remove(self)

    monkeypatch.setattr(store, "async_remove", _remove)
    edit = MagicMock()

    async def both():
        task = asyncio.ensure_future(ws_backup.ws_store_backup_restore(h, MagicMock(), msg))
        save = asyncio.ensure_future(W.ws_house3d_edit(h, edit, {"id": 2, "lights": {"light.b": {"z_m": 2.0}}}))
        await asyncio.wait_for(asyncio.gather(task, save), 5)

    _run(both())
    assert edit.send_result.called, edit.send_error.call_args
    on_disk = store.saved.get(HOUSE3D_STORE_KEY)
    assert on_disk is not None, "the Save was reported saved, and the restore took it away"
    assert set(on_disk["lights"]) == {"light.b"}, "the taken-away house came back"


def test_a_factory_reset_waits_for_a_save_under_way(store, monkeypatch, tmp_path):
    """The Save started first: the reset empties Live Aboard after it, so the
    Save can't put the house back over the reset."""
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "lights": {"light.a": {"z_m": 1.0}},
                                      "pieces": {"fur_1": dict(_PIECE)}}
    h = _house(tmp_path, on=True)
    _run(H.async_get_store(h))
    started, release = _held_save(monkeypatch, store)
    conn, edit = MagicMock(), MagicMock()

    async def both():
        save = asyncio.ensure_future(W.ws_house3d_edit(h, edit, {"id": 2, "lights": {"light.b": {"z_m": 2.0}}}))
        await asyncio.wait_for(started.wait(), 5)       # the Save is writing
        reset = asyncio.ensure_future(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))
        await asyncio.wait({reset}, timeout=0.5)
        release.set()
        await asyncio.wait_for(asyncio.gather(save, reset), 5)

    _run(both())
    assert edit.send_result.called, edit.send_error.call_args
    assert "padspan_ha.house3d" not in conn.send_result.call_args[0][1]["errors"]
    on_disk = store.saved[HOUSE3D_STORE_KEY]
    assert on_disk == H.empty(), "the Save put the house back over the reset"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == on_disk


def test_a_backup_that_cannot_read_a_store_saves_nothing_and_says_so(store, monkeypatch, tmp_path):
    box = _capture_backups(monkeypatch)
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    real = store.async_load

    async def _load(self):
        if self.key == HOUSE3D_STORE_KEY:
            raise OSError(5, "Input/output error")
        return await real(self)

    monkeypatch.setattr(store, "async_load", _load)
    h, conn = _house(tmp_path), MagicMock()              # not loaded: the backup reads the file
    _run(ws_backup.ws_store_backup_create(h, conn, {"id": 1}))
    assert not box["backups"], "a backup with that store as {} would empty it on a restore"
    assert not conn.send_result.called
    code, message = conn.send_error.call_args[0][1:3]
    assert code == "backup_failed" and HOUSE3D_STORE_KEY in message


def test_restoring_no_file_keeps_one_store_and_one_lock(store, monkeypatch, tmp_path):
    """Review of the backlog fix: the store a waiting Save holds is reloaded
    and kept as THE store. Dropped instead, the next request built a second
    store with its own lock, and a Save through either could roll the other
    back (the two-stores state async_get_store exists to prevent)."""
    from custom_components.padspan_ha.ws_common import ABSENT_MARKER
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "lights": {"light.a": {"z_m": 1.0}}}
    h = _house(tmp_path, on=True)
    held = _run(H.async_get_store(h))
    msg = _restore_msg(monkeypatch, {HOUSE3D_STORE_KEY: {ABSENT_MARKER: True}})
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), msg))
    after = _run(H.async_get_store(h))
    assert after is held, "a second store (and a second lock) after the restore"
    assert HOUSE3D_STORE_KEY not in store.saved and "light.a" not in (after.data.get("lights") or {})
