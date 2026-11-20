# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A save is only a save when the file holds what was written.

Home Assistant's Store logs a failed write and returns normally. SafeStore
used to read the file back and check only that something came back, so it
found the OLD file and called the save good. It compares now: what it wrote
with what it reads back, both in the form a JSON file holds them. A save that
did not reach the disk is reported as failed, logged once, counted and raised
as a repair notice, and nothing here ever writes, deletes or restores a file
to "fix" it.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import homeassistant.helpers as ha_helpers
from custom_components.padspan_ha import safe_store
from custom_components.padspan_ha.const import DOMAIN
from custom_components.padspan_ha.safe_store import SafeStore

_INTEG = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"


class Disk:
    """Home Assistant's Store, as far as a save can tell: a save writes JSON
    text to `file`, a load parses `file`. `fail` makes it go wrong the ways it
    can: "swallowed" (Home Assistant logs the write error and returns
    normally; the file is as it was), "raised", "other" (something else ends
    up in the file) and "unreadable" (the read back raises)."""

    def __init__(self, on_disk=None) -> None:
        self.file = None if on_disk is None else json.dumps(on_disk)
        self.fail = None
        self.slow = 0            # event-loop turns one write takes
        self.calls: list[str] = []

    async def async_save(self, data) -> None:
        self.calls.append("save")
        text = json.dumps(data)  # serialised when the write starts, as Home Assistant does
        for _ in range(self.slow):
            await asyncio.sleep(0)
        if self.fail == "raised":
            raise OSError(28, "No space left on device")
        if self.fail == "swallowed":
            return
        self.file = json.dumps({"something": "else"}) if self.fail == "other" else text

    async def async_load(self):
        self.calls.append("load")
        if self.fail == "unreadable":
            raise OSError(5, "Input/output error")
        return None if self.file is None else json.loads(self.file)

    def __getattr__(self, name):
        # Anything else (async_remove, async_delay_save, ...) is something a
        # save has no business calling.
        raise AssertionError(f"SafeStore called store.{name}")


def _hass():
    h = MagicMock()

    async def _executor(fn, *args):
        return fn(*args)

    h.async_add_executor_job = _executor
    return h


def _safe(disk: Disk, name: str = "calibration") -> SafeStore:
    return safe_store.wrap_store(disk, _hass(), name)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def notices(monkeypatch):
    """Home Assistant's issue registry: the notices that are up, and every call."""
    box = SimpleNamespace(up={}, calls=[])

    def create(hass, domain, issue_id, **kw):
        box.calls.append(("create", domain, issue_id))
        box.up[(domain, issue_id)] = kw

    def delete(hass, domain, issue_id):
        box.calls.append(("delete", domain, issue_id))
        box.up.pop((domain, issue_id), None)

    monkeypatch.setitem(ha_helpers.__dict__, "issue_registry", SimpleNamespace(
        async_create_issue=create, async_delete_issue=delete, IssueSeverity=SimpleNamespace(ERROR="error")))
    return box


_OLD = {"points": [{"id": "cp_old", "x_m": 1.0, "y_m": 2.0}], "model": {}}
_NEW = {"points": [{"id": "cp_old", "x_m": 1.0, "y_m": 2.0}, {"id": "cp_secret_new", "x_m": 3.5, "y_m": 4.25}],
        "model": {}}
_NOTICE = (DOMAIN, "save_not_written_calibration")


# ═══ a save that works ════════════════════════════════════════════════════════

def test_a_normal_save_passes(notices):
    disk = Disk(_OLD)
    s = _safe(disk)
    assert _run(s.async_save(_NEW)) is True
    assert json.loads(disk.file) == _NEW
    assert s.failed_saves == 0 and notices.up == {}


def test_one_write_and_one_read_back_per_save(notices):
    """The check never runs twice for one save."""
    disk = Disk(_OLD)
    s = _safe(disk)

    async def go():
        await s.async_save(_NEW)
        await s.async_save(_OLD)

    _run(go())
    assert disk.calls == ["save", "load", "save", "load"]


def test_tuples_sets_and_keys_that_are_not_text_pass(notices):
    """Data a JSON file cannot hold as it is (a tuple comes back a list, a
    number key comes back text, NaN comes back None) is compared in the form
    the file holds it, so it passes, and the caller's own data is not touched."""
    data = {"corner": (1.5, 2.5), "by_level": {0: "ground", 1: "upstairs"}, "seen": {"aa"},
            "poly": [(0, 0), (4, 0), (4, 3)], "gap": float("nan")}
    kept = copy.deepcopy({k: v for k, v in data.items() if k != "gap"})
    disk = Disk()
    s = _safe(disk)
    assert _run(s.async_save(data)) is True
    assert json.loads(disk.file) == {"corner": [1.5, 2.5], "by_level": {"0": "ground", "1": "upstairs"},
                                     "seen": ["aa"], "poly": [[0, 0], [4, 0], [4, 3]], "gap": None}
    assert {k: v for k, v in data.items() if k != "gap"} == kept and isinstance(data["corner"], tuple)
    assert s.failed_saves == 0 and notices.up == {}


def test_data_that_changes_while_it_is_being_written_is_not_a_failure(notices):
    """The stores hand over their live dict, and other code goes on changing
    it while the write is under way. The file is compared with what was
    written, not with what the dict has become since."""
    disk = Disk()
    disk.slow = 3
    s = _safe(disk)
    live = {"points": [1]}

    async def go():
        save = asyncio.ensure_future(s.async_save(live))
        await asyncio.sleep(0)
        live["points"].append(2)          # mid-write
        first = await save
        on_disk_then = json.loads(disk.file)
        return first, on_disk_then, await s.async_save(live)

    first, on_disk_then, second = _run(go())
    assert first is True and on_disk_then == {"points": [1]}
    assert second is True and json.loads(disk.file) == {"points": [1, 2]}
    assert s.failed_saves == 0 and notices.up == {}


def test_two_saves_at_once_are_each_checked_against_their_own_write(notices):
    disk = Disk()
    disk.slow = 2
    s = _safe(disk)

    async def go():
        return await asyncio.gather(s.async_save({"n": 1}), s.async_save({"n": 2}))

    assert _run(go()) == [True, True]
    assert disk.calls == ["save", "load", "save", "load"], "the second save waits for the first one's read back"
    assert json.loads(disk.file) == {"n": 2} and s.failed_saves == 0


# ═══ a save that does not reach the disk ══════════════════════════════════════

def test_a_write_that_silently_fails_is_reported_and_raises_the_notice(notices, caplog):
    """The store's save returns, the file is unchanged."""
    disk = Disk(_OLD)
    disk.fail = "swallowed"
    s = _safe(disk)
    with caplog.at_level(logging.DEBUG, logger=safe_store.__name__):
        assert _run(s.async_save(_NEW)) is False
    assert json.loads(disk.file) == _OLD
    assert s.failed_saves == 1
    notice = notices.up[_NOTICE]
    assert notice["translation_key"] == "save_not_written" and notice["translation_placeholders"] == {"store": "calibration"}
    assert notice["is_fixable"] is False and notice["severity"] == "error"
    errors = [r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(errors) == 1 and "calibration" in errors[0]
    assert not any("cp_secret_new" in r.getMessage() or "4.25" in r.getMessage() for r in caplog.records), \
        "the log names the store, never the data"


@pytest.mark.parametrize("how", ["swallowed", "raised", "other", "unreadable"])
def test_a_failed_save_never_changes_what_is_on_disk(notices, how):
    """Whatever went wrong, SafeStore writes once and then only reads: no
    second write, no delete, no putting an older file back. The file is
    exactly what the store's own write left."""
    disk = Disk(_OLD)
    disk.fail = how
    s = _safe(disk)
    live = copy.deepcopy(_NEW)
    assert _run(s.async_save(live)) is False
    assert disk.calls == (["save"] if how == "raised" else ["save", "load"])
    left = {"swallowed": _OLD, "raised": _OLD, "other": {"something": "else"}, "unreadable": _NEW}[how]
    assert json.loads(disk.file) == left
    assert live == _NEW, "the caller's data is as it was"
    assert s.failed_saves == 1 and _NOTICE in notices.up


def test_a_failure_is_logged_and_raised_once_and_counted_every_time(notices, caplog):
    disk = Disk(_OLD)
    disk.fail = "swallowed"
    s = _safe(disk)

    async def go():
        return [await s.async_save(_NEW) for _ in range(3)]

    with caplog.at_level(logging.DEBUG, logger=safe_store.__name__):
        assert _run(go()) == [False, False, False]
    assert s.failed_saves == 3
    assert len([r for r in caplog.records if r.levelno >= logging.ERROR]) == 1
    assert notices.calls == [("create", *_NOTICE)]


def test_the_next_save_that_reaches_the_disk_takes_the_notice_down(notices, caplog):
    disk = Disk(_OLD)
    disk.fail = "swallowed"
    s = _safe(disk)

    async def go():
        bad = await s.async_save(_NEW)
        disk.fail = None
        good = await s.async_save(_NEW)
        disk.fail = "swallowed"
        return bad, good, await s.async_save(_OLD)

    with caplog.at_level(logging.DEBUG, logger=safe_store.__name__):
        assert _run(go()) == (False, True, False)
    assert notices.calls == [("create", *_NOTICE), ("delete", *_NOTICE), ("create", *_NOTICE)]
    assert len([r for r in caplog.records if r.levelno >= logging.ERROR]) == 2, "a new failure is logged again"
    assert s.failed_saves == 2 and json.loads(disk.file) == _NEW


def test_a_notice_left_from_before_a_restart_comes_down_on_the_first_good_save(notices):
    """The notice is kept over a restart. A new run does not know one is up,
    so its first save that checks out takes it down, and later ones leave the
    registry alone."""
    notices.up[_NOTICE] = {}
    s = _safe(Disk(_OLD))

    async def go():
        await s.async_save(_NEW)
        await s.async_save(_OLD)

    _run(go())
    assert notices.up == {} and notices.calls == [("delete", *_NOTICE)]


def test_data_that_cannot_be_written_as_json_is_a_failed_save_and_nothing_is_written(notices):
    disk = Disk(_OLD)
    s = _safe(disk)
    assert _run(s.async_save({"points": [object()]})) is False
    assert disk.calls == [] and json.loads(disk.file) == _OLD
    assert s.failed_saves == 1 and _NOTICE in notices.up


def test_a_notice_that_cannot_be_raised_does_not_turn_the_save_into_an_exception(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("issue registry is not loaded")

    monkeypatch.setitem(ha_helpers.__dict__, "issue_registry", SimpleNamespace(
        async_create_issue=boom, async_delete_issue=boom, IssueSeverity=SimpleNamespace(ERROR="error")))
    disk = Disk(_OLD)
    s = _safe(disk)

    async def go():
        ok = await s.async_save(_NEW)
        disk.fail = "swallowed"
        return ok, await s.async_save(_OLD)

    assert _run(go()) == (True, False)


def test_while_home_assistant_stops_there_is_no_file_to_check_yet(notices):
    """Home Assistant keeps a save made during shutdown and writes it in its
    own last step, so the read back would only return what it is holding."""
    disk = Disk(_OLD)
    s = _safe(disk)
    s._hass.state = safe_store.CoreState.stopping
    assert _run(s.async_save(_NEW)) is True
    assert disk.calls == ["save"]


# ═══ the stores that save through it ══════════════════════════════════════════

def test_house3d_leaves_the_check_to_safe_store(monkeypatch):
    """Live Aboard's store compared the file itself, after SafeStore had
    already read it back: two reads for one save. One now, and a write that
    Home Assistant swallows is still refused."""
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha import house3d_store as H

    disks: list[Disk] = []

    def _store(hass, version, key):
        disks.append(Disk())
        return disks[-1]

    monkeypatch.setattr(_hs, "Store", _store)
    monkeypatch.setitem(ha_helpers.__dict__, "issue_registry", MagicMock())
    h = _hass()
    h.data = {DOMAIN: {}}
    store = H.House3dStore(h)
    new = {**H.empty(), "lights": {"light.kitchen": {"z_m": 2.4}}}
    assert _run(store.async_write(new)) is True
    assert disks[0].calls == ["save", "load"] and store.data["lights"] == {"light.kitchen": {"z_m": 2.4}}
    disks[0].fail = "swallowed"
    assert _run(store.async_write(H.empty())) is False
    assert store.data["lights"] == {"light.kitchen": {"z_m": 2.4}}, "memory keeps what the file holds"


def test_the_notice_has_its_words_in_every_language():
    """Home Assistant shows a repair notice by its translation key."""
    for p in [_INTEG / "strings.json", *sorted((_INTEG / "translations").glob("*.json"))]:
        entry = json.loads(p.read_text(encoding="utf-8"))["issues"]["save_not_written"]
        assert "{store}" in entry["title"] and "{store}" in entry["description"], p.name


# ═══ what the stores hand over ════════════════════════════════════════════════
# Each store, built the way its own tests build it and changed through its own
# methods: what it hands to a save comes back from a JSON file unchanged (no
# tuple, no key that is not text, nothing JSON cannot hold). The check above
# does not depend on this (it compares the JSON forms), but a store that
# starts keeping such a value will read something else back after a restart,
# and this is where that shows.

class _Handed:
    """In a store's `.store`: every save, checked as the store hands it over."""

    def __init__(self) -> None:
        self.saves = 0
        self.changed: list[str] = []

    async def async_load(self):
        return None

    async def async_save(self, data) -> bool:
        self.saves += 1
        try:
            same = json.loads(json.dumps(data)) == data
        except (TypeError, ValueError) as exc:
            self.changed.append(str(exc))
            return True
        if not same:
            self.changed.append(f"save {self.saves} reads back different")
        return True


def _bare(cls, data: dict):
    obj = cls.__new__(cls)
    obj.hass = _hass()
    obj.store = _Handed()
    obj.data = data
    return obj


_READINGS = [{"source": "aa:bb:cc:dd:ee:01", "name": "Kitchen proxy", "rssi_samples": [-61.0, -63.5, -60.0] * 7},
             {"source": "aa:bb:cc:dd:ee:02", "name": "Hall proxy", "rssi_samples": [-72.0, -75.0, -71.5] * 7}]


async def _calibration():
    from custom_components.padspan_ha.calibration_store import CalibrationStore
    from custom_components.padspan_ha.random_forest import RandomForestLocator
    cal = _bare(CalibrationStore, {"points": [], "model": {}})
    cal._rf, cal._model = RandomForestLocator(), None
    ids = []
    for i in range(6):
        p = await cal.async_add_point({"x_m": 1.0 + i, "y_m": 2.5, "floor_id": "main", "room": "Kitchen" if i < 3 else "Hall",
                                       "label": f"spot {i}", "device_id": "phone", "scanner_readings": _READINGS})
        ids.append(p["id"])
    cal.compute_model(maps_data=[])
    await cal.async_delete_point(ids[0])
    assert len(cal.data["points"]) == 5 and cal.data["model"]["point_count"] == 6
    return cal


async def _fabric():
    from custom_components.padspan_ha.fabric_store import FabricStore
    fab = _bare(FabricStore, {"floors": {}, "history": []})
    await fab.async_correct_room("main", "Kitchen", {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]]})
    counts = await fab.async_spatial_update(
        set_scanners={"aa:bb:cc:dd:ee:01": {"x_m": 1, "y_m": 2, "z_m": 2.4, "floor_id": "main", "origin": "map"}},
        set_beacons={"ble:1": {"x_m": 3, "y_m": 4, "floor_id": "main", "room": "Kitchen"}},
        set_lights={"light.kitchen": {"x_m": 1.0, "y_m": 1.0, "floor_id": "main", "z_m": 2.2}},
        set_barriers=[{"name": "Wall", "points_m": [[0, 0], [1, 0]], "floor_id": "main"}])
    assert counts["scanners"] == counts["beacons"] == counts["barriers"] == counts["lights"] == 1
    return fab


async def _model():
    from custom_components.padspan_ha.model_store import ModelStore
    mdl = _bare(ModelStore, {"map_transforms": {}})
    mdl.fabric = None
    await mdl.async_update(floors=[{"id": "main", "name": "Main"}, {"id": "up", "name": "Upstairs"}],
                           room_meta={"Kitchen": {"floor_id": "main", "color": "#123456"}})
    await mdl.async_set_scanner("aa:bb:cc:dd:ee:01", "Kitchen", "main")
    await mdl.async_set_adjacency("Kitchen", ["Hall"])
    await mdl.async_set_map_transform("m1", {"origin_x_m": 0.0, "origin_y_m": 0.0, "scale_x_m": 90.0,
                                             "scale_y_m": 70.0, "rotation_rad": 0.0, "floor_id": "main"})
    assert mdl.data["map_transforms"]["m1"]["scale_x_m"] == 90.0 and len(mdl.data["floors"]) == 2
    return mdl


async def _maps(tmp_path):
    from custom_components.padspan_ha.maps_store import MapsStore
    ms = _bare(MapsStore, {"maps": []})
    ms.maps_dir = tmp_path / "maps"
    ms.maps_dir.mkdir()
    info = await ms.async_add_map("Ground", "g.png", "image/png", 1600, 1200, "", allow_no_image=True)
    await ms.async_update_map(
        info["id"], notes="front door is north",
        receivers=[{"id": "r1", "source": "aa:bb:cc:dd:ee:01", "name": "Kitchen proxy", "x_frac": 0.25, "y_frac": 0.5}],
        calibration={"mode": "two_point", "px_per_meter": 42.5,
                     "reference_points": [{"x": 0.1, "y": 0.2}, {"x": 0.8, "y": 0.2}]},
        room_bounds={"Kitchen": {"type": "poly", "points": [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]]}})
    assert ms.data["maps"][0]["calibration"]["px_per_meter"] == 42.5
    return ms


async def _settings(tmp_path):
    from custom_components.padspan_ha.settings_store import SettingsStore
    h = _hass()
    h.config.path = lambda *parts: str(tmp_path.joinpath(*parts))
    h.data = {}
    st = SettingsStore(h)
    st.store = _Handed()
    await st.async_load()
    await st.async_set(followed_addrs=["AA:BB:CC:DD:EE:FF"], atlas_3d_enabled=True)
    assert len(st.data) > 20 and st.data["followed_addrs"] == ["AA:BB:CC:DD:EE:FF"]
    return st


async def _house3d(tmp_path):
    from custom_components.padspan_ha import house3d_store as H
    out = H.apply_edit(H.empty(), {
        "openings": {"win_5e6f7a8b": {"kind": "window", "floor_id": "main", "a_m": [2.1, -9.23], "b_m": [3.3, -9.23],
                                      "sill_m": 0.9, "head_m": 2.1},
                     "door_0a1b2c3d": {"kind": "door", "floor_id": "main", "a_m": [5.0, 0.0], "b_m": [5.0, 0.9],
                                       "head_m": 2.03, "hinge": "left", "swing": "in"}},
        "lights": {"light.kitchen": {"z_m": 1.55}},
        "devices": {"sensor.kitchen_temperature": {"z_m": 1.5}}})
    st = SimpleNamespace(store=_Handed(), data=out)
    await st.store.async_save(out)
    assert len(out["openings"]) == 2
    return st


@pytest.mark.parametrize("build", [_calibration, _fabric, _model, _maps, _settings, _house3d])
def test_what_each_store_saves_comes_back_from_json_unchanged(build, tmp_path, monkeypatch):
    from custom_components.padspan_ha import settings_store
    monkeypatch.setattr(settings_store, "Store", lambda *a, **k: _Handed())   # for SettingsStore(hass)
    store = _run(build(tmp_path) if build in (_maps, _settings, _house3d) else build())
    assert store.store.saves >= 1, "the store saved nothing: the test did not exercise it"
    assert store.store.changed == []
    assert json.loads(json.dumps(store.data)) == store.data
