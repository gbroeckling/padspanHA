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
    raw = {"schema": 7, "pieces": {"fur_1": {"x_m": 1, "from_the_future": True}},
           "lights": [1, 2], "a_newer_section": {"k": 1}}
    got = H.normalise(raw)
    assert got["schema"] == 7 and got["pieces"]["fur_1"]["from_the_future"] is True
    assert got["a_newer_section"] == {"k": 1}, "a newer PadSpan's data survives an older one"
    assert got["lights"] == {} and got["openings"] == {} and got["library"] == {}
    assert H.normalise(None) == H.empty() == H.normalise([1, 2]) == H.normalise("x")


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


def test_clear_when_on_backs_up_first_then_empties(store, monkeypatch):
    from custom_components.padspan_ha import ws_backup

    async def _bk(hass, note, keys):
        store.events.append(("backup", tuple(keys)))
        return "bk_1"

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h, conn = _house(on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_result.call_args[0][1] == {"cleared": True, "backup_id": "bk_1"}
    assert store.saved[HOUSE3D_STORE_KEY] == H.empty()
    order = [ev for ev in store.events if ev[0] in ("backup", "save")]
    assert order[0] == ("backup", (HOUSE3D_STORE_KEY,)), "the backup is taken before anything is emptied"


def test_no_backup_no_clear(store, monkeypatch):
    from custom_components.padspan_ha import ws_backup

    async def _bk(*a):
        return None

    monkeypatch.setattr(ws_backup, "_auto_backup", _bk)
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    h, conn = _house(on=True), MagicMock()
    _run(W.ws_house3d_clear(h, conn, {"id": 1}))
    assert conn.send_error.call_args[0][1] == "backup_failed"
    assert _saves() == 0 and store.saved[HOUSE3D_STORE_KEY]["pieces"]


# ═══ registered everywhere a store must be ════════════════════════════════════

def test_registered_for_backup_restore_bright_import_and_the_labels():
    from custom_components.padspan_ha import bright_import, ws_common
    assert HOUSE3D_STORE_KEY in ws_common._ALL_STORE_KEYS
    assert ws_common._DATA_KEY_MAP[HOUSE3D_STORE_KEY] == DATA_HOUSE3D
    assert ("house3d", HOUSE3D_STORE_KEY) in bright_import.HOUSE_STORES
    manage = (_CC / "www" / "padspan-ha" / "views" / "manage.js").read_text(encoding="utf-8")
    assert '"padspan_ha.house3d": "3D house (Live Aboard)"' in manage
    ws = (_CC / "websocket.py").read_text(encoding="utf-8")
    assert "from .ws_house3d import WS_COMMANDS" in ws


def test_a_factory_reset_empties_it(store, tmp_path):
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    h = _house(tmp_path)
    loaded = _run(H.async_get_store(h))
    loaded.data["pieces"]["fur_1"] = dict(_PIECE)
    conn = MagicMock()
    _run(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))
    assert store.saved[HOUSE3D_STORE_KEY] == H.empty()
    assert h.data[DOMAIN][DATA_HOUSE3D].data == H.empty()
    assert "padspan_ha.house3d" not in conn.send_result.call_args[0][1]["errors"]


def test_a_factory_reset_never_creates_it(store, tmp_path):
    from custom_components.padspan_ha.ws_factory_reset import ws_factory_reset
    h = _house(tmp_path)
    conn = MagicMock()
    _run(ws_factory_reset(h, conn, {"id": 1, "confirm": "FACTORY RESET"}))
    assert HOUSE3D_STORE_KEY not in store.saved, "an install that never used it gets no new file"
    assert "padspan_ha.house3d" not in conn.send_result.call_args[0][1]["errors"]


def test_restoring_a_backup_without_it_leaves_it_alone(store, monkeypatch):
    from custom_components.padspan_ha import ws_backup
    from custom_components.padspan_ha.const import SETTINGS_STORE_KEY
    store.saved[HOUSE3D_STORE_KEY] = {**H.empty(), "pieces": {"fur_1": dict(_PIECE)}}
    bk = {"backups": [{"id": "bk1", "created_at": "2026-01-01T00:00:00+00:00", "version": "0.38.80",
                       "note": "", "map_images": {}, "stores": {SETTINGS_STORE_KEY: {"quiet_mode": True}}}]}

    async def _load(_hass):
        return bk

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    h = _house()
    _run(ws_backup.ws_store_backup_restore(h, MagicMock(), {"id": 1, "backup_id": "bk1",
                                                              "store_keys": [SETTINGS_STORE_KEY]}))
    assert h.data[DOMAIN][DATA_SETTINGS].data["quiet_mode"] is True, "the restore did not run"
    assert store.saved[HOUSE3D_STORE_KEY]["pieces"]["fur_1"]["label"] == "Mum's old couch"


# ═══ the usage report ═════════════════════════════════════════════════════════

def test_the_report_carries_nothing_from_the_3d_house(store):
    h = _house(on=True)
    loaded = _run(H.async_get_store(h))
    loaded.data["pieces"]["fur_1"] = dict(_PIECE)
    p = T.build_payload(h)
    T.assert_shareable(p)
    flat = json.dumps(p)
    assert "house3d" not in flat and "couch" not in flat and "fur_1" not in flat
