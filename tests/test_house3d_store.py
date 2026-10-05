"""Live Aboard, the 3D house — build step 1: the switch and the empty store.

Plan: docs/IDEA_ATLAS_3D_HOUSE.md on the live-aboard branch ("Normally off",
"Data", "Undoing it"). Garry, 2026-09-30: "make sure this is an option that is
normally off for now", "Make sure anything here is reversable".

What these tests hold the feature to before any 3D code exists:
- off by default, every sub-switch off, and settings sanitised;
- its own file, HA store version 1 forever, read tolerantly;
- nothing loads or writes it until asked, and while off nothing writes it;
- registered for backup, restore, factory reset and the Bright import, so a
  backup takes it, a restore of a backup without it leaves it alone, and a
  reset empties it (without creating it on an install that never had it);
- the usage report carries nothing from it.
The frontend "off" tests (the flat Atlas byte-identical, no 3D module import)
arrive with P1, which adds the code they guard.
"""

from __future__ import annotations

import asyncio
import copy
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha import telemetry as T
from custom_components.padspan_ha import ws_house3d as W
from custom_components.padspan_ha import ws_settings as WS
from custom_components.padspan_ha.const import DATA_HOUSE3D, DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS
from tests.test_telemetry import _hass

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_PIECE = {"id": "fur_1", "recipe": {"kind": "sofa", "width_m": 2.2}, "label": "Mum's old couch",
          "floor_id": "main", "x_m": 1.0, "y_m": 2.0}


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


class _FakeStore:
    """Every save recorded per key, in order; a load returns the last save."""
    saved: dict = {}
    events: list = []

    def __init__(self, hass, version, key):
        self.version, self.key = version, key

    async def async_load(self):
        _FakeStore.events.append(("load", self.key))
        return copy.deepcopy(_FakeStore.saved.get(self.key))

    async def async_save(self, data):
        _FakeStore.events.append(("save", self.key))
        _FakeStore.saved[self.key] = copy.deepcopy(data)

    async def async_remove(self):
        _FakeStore.saved.pop(self.key, None)


@pytest.fixture
def store(monkeypatch):
    import homeassistant.helpers.storage as _hs
    _FakeStore.saved, _FakeStore.events = {}, []
    monkeypatch.setattr(_hs, "Store", _FakeStore)
    return _FakeStore


def _house(tmp_path: Path | None = None, *, on: bool = False):
    h = _hass()
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = on
    if tmp_path is not None:
        h.config.path = lambda *parts: str(tmp_path.joinpath(*parts))

    async def _executor(fn, *args):
        return fn(*args)

    h.async_add_executor_job = _executor
    return h


def _saves(key: str = HOUSE3D_STORE_KEY) -> int:
    return sum(1 for ev, k in _FakeStore.events if ev == "save" and k == key)


def _disk_file(tmp_path: Path) -> Path:
    """Make the file exist where Home Assistant keeps it (.storage/<key>)."""
    f = tmp_path / ".storage" / HOUSE3D_STORE_KEY
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("{}", encoding="utf-8")
    return f


# ═══ the switch ═══════════════════════════════════════════════════════════════

def test_off_by_default_with_every_sub_switch_off():
    assert DEFAULT_SETTINGS["atlas_3d_enabled"] is False, "Live Aboard is normally off"
    assert DEFAULT_SETTINGS["atlas_3d_people"] is False
    assert DEFAULT_SETTINGS["atlas_3d_library"] is False
    assert DEFAULT_SETTINGS["atlas_3d_ai_task_entity"] == ""
    assert DEFAULT_SETTINGS["atlas_3d_quality"] == "auto"


@pytest.mark.parametrize("raw,want", [("HIGH", "high"), ("low", "low"), ("auto", "auto"),
                                      ("ultra", "auto"), ("", "auto"), (None, "auto"), (3, "auto")])
def test_quality_is_one_of_three_or_auto(raw, want):
    assert WS._atlas_3d_quality(raw) == want


@pytest.mark.parametrize("raw,want", [("ai_task.openai", "ai_task.openai"), (" ai_task.local_llm ", "ai_task.local_llm"),
                                      ("light.kitchen", ""), ("ai_task.x; rm", ""), ("", ""), (None, "")])
def test_the_photo_ai_task_is_an_ai_task_entity_or_none(raw, want):
    assert WS._atlas_3d_ai_task(raw) == want


# ═══ the file ═════════════════════════════════════════════════════════════════

def test_its_own_file_at_store_version_one(store):
    s = H.House3dStore(_house())
    assert s._raw_store.key == HOUSE3D_STORE_KEY == "padspan_ha.house3d"
    assert s._raw_store.version == 1, "a different major version makes HA refuse the file"


def test_reading_is_tolerant_and_keeps_every_key():
    raw = {"schema": 1, "pieces": {"fur_1": {"x_m": 1, "from_the_future": True}},
           "lights": [1, 2], "a_newer_section": {"k": 1}}
    got = H.normalise(raw)
    assert got["schema"] == 1 and got["pieces"]["fur_1"]["from_the_future"] is True
    assert got["a_newer_section"] == {"k": 1}, "a newer PadSpan's data survives an older one"
    assert got["lights"] == {} and got["openings"] == {} and got["library"] == {}, \
        "in this version's file, a broken or missing section reads as empty"
    newer = {**raw, "schema": 7}
    assert H.normalise(newer) == newer, "a newer PadSpan's file is kept as it is, sections and all"
    assert H.normalise(None) == H.empty() == H.normalise([1, 2]) == H.normalise("x")


def _unreadable(monkeypatch, times: int) -> None:
    """The next `times` reads fail as Home Assistant's Store fails them (it
    raises; SafeStore turned that into None, the empty house)."""
    real = _FakeStore.async_load
    left = {"n": times}

    async def _load(self):
        if left["n"] > 0:
            left["n"] -= 1
            raise OSError(5, "Input/output error")
        return await real(self)

    monkeypatch.setattr(_FakeStore, "async_load", _load)


def test_a_failed_read_is_never_taken_for_an_empty_house(store, monkeypatch, tmp_path):
    """It was cached as the empty house: the next Save wrote that over the
    real file, and backups took the empty copy. Now nothing is kept, the
    answer says the read failed, and the next use reads again."""
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    _unreadable(monkeypatch, 1)
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_get(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == "read_failed"
    assert DATA_HOUSE3D not in h.data[DOMAIN], "nothing kept"
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 2}))
    assert box["backups"][-1]["stores"][HOUSE3D_STORE_KEY]["pieces"]["fur_1"]["label"] == "Mum's old couch"
    conn = MagicMock()
    _run(W.ws_house3d_get(h, conn, {"id": 3}))
    assert conn.send_result.call_args[0][1]["data"]["pieces"]["fur_1"]["label"] == "Mum's old couch"


def test_a_read_that_fails_with_no_file_is_the_empty_house(store, monkeypatch, tmp_path):
    _unreadable(monkeypatch, 1)
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_get(h, conn, {"id": 1}))
    assert conn.send_result.call_args[0][1]["data"] == H.empty()


def test_while_the_file_cannot_be_read_nothing_writes_it(store, monkeypatch, tmp_path):
    from custom_components.padspan_ha import ws_backup
    calls = []

    async def _bk(*a):
        calls.append(a)
        return "bk_x"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    _disk_file(tmp_path)
    before = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    store.saved[HOUSE3D_STORE_KEY] = copy.deepcopy(before)
    _unreadable(monkeypatch, 99)
    h = _house(tmp_path, on=True)
    edit, clear = MagicMock(), MagicMock()
    _run(W.ws_house3d_edit(h, edit, {"id": 1, "lights": {"light.kitchen": {"z_m": 1.5}}}))
    _run(W.ws_house3d_clear(h, clear, {"id": 2}))
    assert edit.send_error.call_args[0][1] == "read_failed" and clear.send_error.call_args[0][1] == "read_failed"
    assert calls == [] and _saves() == 0 and store.saved[HOUSE3D_STORE_KEY] == before


# ═══ normally off: nothing loads, nothing writes ══════════════════════════════

def test_nothing_is_loaded_until_asked_and_reading_never_writes(store):
    h = _house()
    assert DATA_HOUSE3D not in h.data[DOMAIN], "setup does not load it"
    conn = MagicMock()
    _run(W.ws_house3d_get(h, conn, {"id": 1}))
    _run(W.ws_house3d_get(h, conn, {"id": 2}))
    res = conn.send_result.call_args[0][1]
    assert res["enabled"] is False and res["data"] == H.empty()
    assert [ev for ev in store.events if ev[1] == HOUSE3D_STORE_KEY] == [("load", HOUSE3D_STORE_KEY)], \
        "loaded once, then cached; never saved"


def test_clear_is_refused_while_off_and_touches_nothing(store, monkeypatch):
    from custom_components.padspan_ha import ws_backup
    calls = []

    async def _bk(*a):
        calls.append(a)
        return "bk_x"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h, conn = _house(), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == W.OFF_CODE
    assert calls == [] and _saves() == 0
    assert store.saved[HOUSE3D_STORE_KEY]["pieces"]["fur_1"]["label"] == "Mum's old couch"


def test_clear_when_on_backs_up_first_then_empties(store, monkeypatch, tmp_path):
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys):
        store.events.append(("backup", tuple(keys)))
        return "bk_1"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_result.call_args[0][1] == {"cleared": True, "backup_id": "bk_1"}
    assert store.saved[HOUSE3D_STORE_KEY] == H.empty()
    order = [ev for ev in store.events if ev[0] in ("backup", "save")]
    assert order[0] == ("backup", (HOUSE3D_STORE_KEY,)), "the backup is taken before anything is emptied"


def test_no_backup_no_clear(store, monkeypatch, tmp_path):
    from custom_components.padspan_ha import ws_backup

    async def _bk(*a):
        return None

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == "backup_failed"
    assert _saves() == 0 and store.saved[HOUSE3D_STORE_KEY]["pieces"]


def _no_backups(monkeypatch) -> list:
    from custom_components.padspan_ha import ws_backup
    calls = []

    async def _bk(*a):
        calls.append(a)
        return "bk_1"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    return calls


@pytest.mark.parametrize("tier", ["free", "bright"])
def test_below_pro_clear_is_as_if_off(store, monkeypatch, tmp_path, tier):
    calls = _no_backups(monkeypatch)
    _disk_file(tmp_path)
    before = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    store.saved[HOUSE3D_STORE_KEY] = copy.deepcopy(before)
    h, conn = _house(tmp_path, on=True), MagicMock()
    st = h.data[DOMAIN][DATA_SETTINGS]
    if tier == "free":
        st.data["forensics_license_key"] = ""
    else:
        st.data["license_tier"] = "bright"
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == W.OFF_CODE and conn.send_error.call_args[0][2] == W.PRO_MESSAGE
    assert calls == [] and _saves() == 0 and store.saved[HOUSE3D_STORE_KEY] == before


def test_clear_leaves_a_newer_padspans_file_alone(store, monkeypatch, tmp_path):
    """After a downgrade: no backup and no write, so the newer version finds
    its file as it left it."""
    calls = _no_backups(monkeypatch)
    _disk_file(tmp_path)
    newer = {"schema": 2, "pieces": [{"id": "fur_1"}], "rooms3d": {"k": 1}}
    store.saved[HOUSE3D_STORE_KEY] = copy.deepcopy(newer)
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == "house3d_newer"
    assert calls == [] and _saves() == 0 and store.saved[HOUSE3D_STORE_KEY] == newer
    assert h.data[DOMAIN][DATA_HOUSE3D].data == newer


@pytest.mark.parametrize("how", ["raised", "swallowed"])
def test_a_clear_whose_write_fails_removes_nothing(store, monkeypatch, tmp_path, how):
    """A write that raises (SafeStore catches it), or one Home Assistant's
    Store swallows (it logs the error and returns normally; the old file
    stays): the answer is save_failed, and the file and the memory keep it all."""
    _no_backups(monkeypatch)
    _disk_file(tmp_path)
    before = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    store.saved[HOUSE3D_STORE_KEY] = copy.deepcopy(before)

    async def _save(self, data):
        store.events.append(("save", self.key))
        if how == "raised":
            raise OSError(28, "No space left on device")

    monkeypatch.setattr(_FakeStore, "async_save", _save)
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == "save_failed"
    assert store.saved[HOUSE3D_STORE_KEY] == before
    assert h.data[DOMAIN][DATA_HOUSE3D].data == before, "memory keeps it all too"


def test_an_edit_never_lands_between_a_clears_backup_and_the_clear(store, monkeypatch, tmp_path):
    """The edit waits for the clear: it is in the clear's backup, or saved
    after the clear, and never lost between the two."""
    from custom_components.padspan_ha import ws_backup
    taken = []

    async def _bk(hass, note, keys):
        taken.append(copy.deepcopy(hass.data[DOMAIN][DATA_HOUSE3D].data))
        await asyncio.sleep(0)       # a backup takes a while
        await asyncio.sleep(0)
        return "bk_1"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "lights": {"light.a": {"z_m": 1.0}}}
    h, clear, edit = _house(tmp_path, on=True), MagicMock(), MagicMock()
    _run(H.async_get_store(h))

    async def both():
        await asyncio.gather(W.ws_house3d_clear(h, clear, {"id": 1}),
                             W.ws_house3d_edit(h, edit, {"id": 2, "lights": {"light.b": {"z_m": 2.0}}}))

    _run(both())
    assert clear.send_result.call_args[0][1]["cleared"] is True and edit.send_result.called
    on_disk = store.saved[HOUSE3D_STORE_KEY]
    assert "light.b" in on_disk["lights"] or any("light.b" in t["lights"] for t in taken), \
        "the edit is on disk or in the clear's backup"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == on_disk


# ═══ registered everywhere a store must be ════════════════════════════════════

def test_registered_for_backup_restore_bright_import_and_the_labels():
    from custom_components.padspan_ha import bright_import, ws_common
    assert HOUSE3D_STORE_KEY in ws_common._ALL_STORE_KEYS
    assert ws_common._DATA_KEY_MAP[HOUSE3D_STORE_KEY] == DATA_HOUSE3D
    assert ("house3d", HOUSE3D_STORE_KEY) in bright_import.HOUSE_STORES
    manage = (_CC / "www" / "padspan-ha" / "views" / "manage.js").read_text(encoding="utf-8")
    assert '"padspan_ha.house3d": "Live Aboard"' in manage, "no unreleased name in the backup list"
    ws = (_CC / "websocket.py").read_text(encoding="utf-8")
    assert "from .ws_house3d import WS_COMMANDS" in ws


def test_a_factory_reset_empties_a_file_that_exists(store, tmp_path):
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h = _house(tmp_path)
    conn = MagicMock()
    _run(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))
    assert store.saved[HOUSE3D_STORE_KEY] == H.empty()
    assert "padspan_ha.house3d" not in conn.send_result.call_args[0][1]["errors"]


def test_a_factory_reset_never_creates_it_even_after_a_read(store, tmp_path):
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    h = _house(tmp_path)
    _run(W.ws_house3d_get(h, MagicMock(), {"id": 1}))       # loaded by a read: still no file
    h.data[DOMAIN][DATA_HOUSE3D].data["pieces"]["fur_1"] = dict(_PIECE)
    conn = MagicMock()
    _run(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))
    assert HOUSE3D_STORE_KEY not in store.saved, "an install that never wrote it gets no new file"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == H.empty(), "the copy in memory is reset all the same"
    assert "padspan_ha.house3d" not in conn.send_result.call_args[0][1]["errors"]


def _capture_backups(monkeypatch):
    from custom_components.padspan_ha import ws_backup
    box = {"backups": []}

    async def _load(_hass):
        return copy.deepcopy(box)

    async def _save(_hass, data):
        box.clear()
        box.update(copy.deepcopy(data))

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    monkeypatch.setattr(ws_backup, "_save_backups", _save)
    return box


def test_a_backup_never_carries_a_file_that_was_never_written(store, tmp_path, monkeypatch):
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    h = _house(tmp_path)
    _run(W.ws_house3d_get(h, MagicMock(), {"id": 1}))       # even with the store loaded by a read
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 2}))
    assert box["backups"] and HOUSE3D_STORE_KEY not in box["backups"][-1]["stores"]
    assert _run(ws_backup._auto_backup(h, "test", [HOUSE3D_STORE_KEY]))
    assert HOUSE3D_STORE_KEY not in box["backups"][-1]["stores"]


def test_a_backup_carries_the_file_once_it_exists(store, tmp_path, monkeypatch):
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    _disk_file(tmp_path)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h = _house(tmp_path)
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    assert box["backups"][-1]["stores"][HOUSE3D_STORE_KEY]["pieces"]["fur_1"]["label"] == "Mum's old couch"


def test_when_the_file_check_itself_fails_the_backup_keeps_the_data(store, tmp_path, monkeypatch):
    """An unanswerable "does the file exist" counts as yes: an empty entry is
    the old behaviour, silently dropping a real file would lose data."""
    from custom_components.padspan_ha import ws_backup
    box = _capture_backups(monkeypatch)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h = _house(tmp_path)
    h.async_add_executor_job = MagicMock(side_effect=OSError("no executor"))
    _run(ws_backup.ws_store_backup_create(h, MagicMock(), {"id": 1}))
    assert box["backups"][-1]["stores"][HOUSE3D_STORE_KEY]["pieces"]["fur_1"]["label"] == "Mum's old couch"


def _restore(h, monkeypatch, stores: dict, keys: list | None = None):
    from custom_components.padspan_ha import ws_backup
    bk = {"backups": [{"id": "bk1", "created_at": "2026-01-01T00:00:00+00:00", "version": "0.38.80",
                       "note": "", "map_images": {}, "stores": stores}]}

    async def _load(_hass):
        return bk

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    msg = {"id": 1, "backup_id": "bk1"}
    if keys is not None:
        msg["store_keys"] = keys
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), msg))


def test_restoring_everything_from_a_backup_without_it_leaves_it_alone(store, monkeypatch):
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h = _house()
    _restore(h, monkeypatch, {SETTINGS_STORE_KEY: {"quiet_mode": True}})     # every store in the backup
    assert h.data[DOMAIN][DATA_SETTINGS].data["quiet_mode"] is True, "the restore did not run"
    assert store.saved[HOUSE3D_STORE_KEY]["pieces"]["fur_1"]["label"] == "Mum's old couch"


def test_a_restore_puts_the_tolerant_shape_in_memory(store, monkeypatch):
    h = _house()
    loaded = _run(H.async_get_store(h))
    _restore(h, monkeypatch, {HOUSE3D_STORE_KEY: {"pieces": {"fur_1": dict(_PIECE)}, "future": 1}})
    assert loaded.data["pieces"]["fur_1"]["label"] == "Mum's old couch"
    assert loaded.data["lights"] == {} and loaded.data["openings"] == {} and loaded.data["future"] == 1


@pytest.mark.parametrize("key,value,allowed", [
    ("atlas_3d_library", True, False), ("atlas_3d_ai_task_entity", "ai_task.cloud", False),
    ("atlas_3d_enabled", True, True), ("atlas_3d_quality", "low", True),
])
def test_only_an_admin_lets_data_leave_the_house(key, value, allowed):
    h, conn = _house(), MagicMock()
    conn.user = MagicMock(is_admin=False)
    _run(WS.ws_settings_set(h, conn, {"id": 1, key: value}))
    data = h.data[DOMAIN][DATA_SETTINGS].data
    if allowed:
        assert not conn.send_error.called and data.get(key) == value
    else:
        assert conn.send_error.call_args[0][1] == "unauthorized" and key not in data


def test_clear_with_no_file_takes_no_backup_and_writes_nothing(store, monkeypatch, tmp_path):
    from custom_components.padspan_ha import ws_backup
    calls = []

    async def _bk(*a):
        calls.append(a)
        return "bk_x"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    h, conn = _house(tmp_path, on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_result.call_args[0][1] == {"cleared": True, "backup_id": None}
    assert calls == [] and _saves() == 0, "no empty safety backup, no new file"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == H.empty(), "the copy in memory is the empty house"


def test_an_admin_can_save_the_library_and_photo_settings():
    h, conn = _house(), MagicMock()
    conn.user = MagicMock(is_admin=True)
    _run(WS.ws_settings_set(h, conn, {"id": 1, "atlas_3d_library": True, "atlas_3d_ai_task_entity": "ai_task.local"}))
    data = h.data[DOMAIN][DATA_SETTINGS].data
    assert not conn.send_error.called
    assert data["atlas_3d_library"] is True and data["atlas_3d_ai_task_entity"] == "ai_task.local"


def test_opting_into_the_usage_report_still_mints_the_id_and_starts_clean(monkeypatch):
    """The 3D admin check sits beside the usage report's own; the opt-in that
    mints the install id and starts the windows must still run (it was nested
    inside the 3D check once, by mistake)."""
    calls = []

    async def _mint(hass):
        calls.append("ensure_install_id")

    monkeypatch.setattr(T, "ensure_install_id", _mint)
    monkeypatch.setattr(T, "reset_windows", lambda hass: calls.append("reset_windows"))
    h, conn = _house(), MagicMock()
    conn.user = MagicMock(is_admin=True)
    h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] = False
    _run(WS.ws_settings_set(h, conn, {"id": 1, "telemetry_enabled": True, "telemetry_asked": True}))
    assert calls == ["ensure_install_id", "reset_windows"]
    assert h.data[DOMAIN][DATA_SETTINGS].data["telemetry_enabled"] is True


# ═══ the usage report ═════════════════════════════════════════════════════════

def test_the_report_carries_nothing_from_the_3d_house(store):
    h = _house(on=True)
    loaded = _run(H.async_get_store(h))
    loaded.data["pieces"]["fur_1"] = dict(_PIECE)
    p = T.build_payload(h)
    T.assert_shareable(p)
    flat = json.dumps(p)
    assert "house3d" not in flat and "couch" not in flat and "fur_1" not in flat
