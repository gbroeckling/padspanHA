# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A Home Assistant area renamed renames its PadSpan room (area_rename.py).

One test per store's rename, then the whole rename: one backup first, one
save per store, one log line, nothing at all for an area PadSpan never used,
and nothing when the new name is already a room. Then the listener: HA's
event carries no old name, so the names are kept by area_id."""

from __future__ import annotations

import functools
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha import area_rename as AR
from custom_components.padspan_ha import ws_backup as WB
from custom_components.padspan_ha.const import (
    DATA_ADAPTIVE, DATA_ALERTS, DATA_CALIBRATION, DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
)


def _fabric():
    return {"floors": {"ground": {"rooms": {"Den": {"type": "poly", "revision": 3}, "Hall": {}}}},
            "beacon_positions_m": {"b1": {"room": "Den", "x_m": 1}, "b2": {"room": "Hall"}}}


def test_fabric() -> None:
    d = _fabric()
    assert AR.rename_in_fabric(d, "Den", "Study") == 2
    assert d["floors"]["ground"]["rooms"]["Study"] == {"type": "poly", "revision": 3} and "Den" not in d["floors"]["ground"]["rooms"]
    assert d["beacon_positions_m"]["b1"]["room"] == "Study" and d["beacon_positions_m"]["b2"]["room"] == "Hall"


def test_model() -> None:
    d = {"room_meta": {"Den": {"color": "#fff"}}, "room_adjacency": {"Den": ["Hall"], "Hall": ["Den", "Kitchen"]},
         "scanners": {"s1": {"room": "Den"}, "s2": {"room": "Hall"}}, "room_geometry_m": {"Den": {}}}
    assert AR.rename_in_model(d, "Den", "Study") == 4
    assert d["room_meta"] == {"Study": {"color": "#fff"}}
    assert d["room_adjacency"] == {"Study": ["Hall"], "Hall": ["Study", "Kitchen"]}
    assert d["scanners"]["s1"]["room"] == "Study" and d["scanners"]["s2"]["room"] == "Hall"
    assert "Den" in d["room_geometry_m"], "the legacy copy the fabric's drift check reads is left alone"


def test_maps() -> None:
    d = {"maps": [{"room_bounds": {"Den": [0, 0, 1, 1]}, "receivers": [{"room": "Den"}, {"room": "Hall"}]}, {}]}
    assert AR.rename_in_maps(d, "Den", "Study") == 2
    assert d["maps"][0]["room_bounds"] == {"Study": [0, 0, 1, 1]} and d["maps"][0]["receivers"][0]["room"] == "Study"


def test_calibration() -> None:
    d = {"points": [{"room": "Den", "label": "[walk] Den"}, {"room": "Den", "label": "by the door"}, {"room": "Hall"}]}
    assert AR.rename_in_calibration(d, "Den", "Study") == 2
    assert d["points"][0] == {"room": "Study", "label": "[walk] Study"}
    assert d["points"][1] == {"room": "Study", "label": "by the door"} and d["points"][2]["room"] == "Hall"


def test_room_tag_map() -> None:
    d = {"Den": ["tag.a"], "Hall": []}
    assert AR.rename_in_room_tag_map(d, "Den", "Study") == 1 and d == {"Hall": [], "Study": ["tag.a"]}


def test_alerts() -> None:
    d = {"AA:BB": {"watch_rooms": ["Den", "Hall"]}, "CC:DD": {"watch_rooms": ["Hall"]}, "x": "junk"}
    assert AR.rename_in_alerts(d, "Den", "Study") == 1 and d["AA:BB"]["watch_rooms"] == ["Study", "Hall"]


def test_adaptive() -> None:
    d = {"room_fingerprints": {"Den": {"s1": -60}}, "transition_counts": {"Den": {"Hall": 3}, "Hall": {"Den": 2}}}
    assert AR.rename_in_adaptive(d, "Den", "Study") == 3
    assert d["room_fingerprints"] == {"Study": {"s1": -60}}
    assert d["transition_counts"] == {"Study": {"Hall": 3}, "Hall": {"Study": 2}}


def test_a_name_already_there_is_never_overwritten() -> None:
    d = {"room_meta": {"Den": {"a": 1}, "Study": {"b": 2}}}
    assert AR.rename_in_model(d, "Den", "Study") == 0 and d["room_meta"] == {"Den": {"a": 1}, "Study": {"b": 2}}


# ── The whole rename ────────────────────────────────────────────────────────

def _store(data):
    return SimpleNamespace(data=data, store=SimpleNamespace(async_save=AsyncMock()))


def _house():
    settings = SimpleNamespace(data={"room_tag_map": {"Den": ["tag.a"]}})

    async def _set(**kw):
        settings.data = {**settings.data, **kw}
    settings.async_set = AsyncMock(side_effect=_set)
    cal = _store({"points": [{"room": "Den"}]})
    cal.rf_points_changed = MagicMock()
    dom = {
        DATA_FABRIC: _store(_fabric()),
        DATA_MODEL: _store({"room_meta": {"Den": {}}, "scanners": {"s1": {"room": "Den"}}}),
        DATA_MAPS: _store({"maps": [{"room_bounds": {"Den": [0, 0, 1, 1]}}]}),
        DATA_CALIBRATION: cal,
        DATA_ALERTS: _store({"AA": {"watch_rooms": ["Den"]}}),
        DATA_ADAPTIVE: _store({"room_fingerprints": {"Hall": {}}}),
        DATA_SETTINGS: settings,
        "coordinator": SimpleNamespace(room_tag_map={"Den": ["tag.a"]}),
    }
    return SimpleNamespace(data={DOMAIN: dom}), dom


@pytest.fixture
def backups(monkeypatch):
    calls: list = []

    async def _backup(hass, note, keys, **kw):
        calls.append((note, keys, kw))
        return "bk1"
    monkeypatch.setattr(WB, "_auto_backup", _backup)
    monkeypatch.setattr("custom_components.padspan_ha.ws_common._invalidate_snapshot_cache", lambda hass: None)
    return calls


async def test_one_backup_then_one_save_per_store_and_one_log_line(backups, caplog) -> None:
    hass, dom = _house()
    with caplog.at_level(logging.INFO, logger="custom_components.padspan_ha.area_rename"):
        done = await AR.async_rename_room(hass, "Den", "Study")
    assert done == {"fabric": 2, "model": 2, "maps": 1, "calibration": 1, "alerts": 1, "settings": 1}
    assert len(backups) == 1 and backups[0][2] == {"slot": "area_rename", "slot_keep": 3}
    for key in (DATA_FABRIC, DATA_MODEL, DATA_MAPS, DATA_CALIBRATION, DATA_ALERTS):
        assert dom[key].store.async_save.await_count == 1, key
    dom[DATA_ADAPTIVE].store.async_save.assert_not_awaited()      # nothing of Den's there
    assert dom[DATA_SETTINGS].async_set.await_count == 1 and dom[DATA_SETTINGS].data["room_tag_map"] == {"Study": ["tag.a"]}
    assert dom["coordinator"].room_tag_map == {"Study": ["tag.a"]}
    dom[DATA_CALIBRATION].rf_points_changed.assert_called_once()
    lines = [r.getMessage() for r in caplog.records if "is now" in r.getMessage()]
    assert lines == ["Home Assistant area renamed: PadSpan room 'Den' is now 'Study' "
                     "(fabric 2, model 2, maps 1, calibration 1, alerts 1, settings 1; backup bk1)"]


async def test_an_area_padspan_never_used_changes_nothing(backups) -> None:
    hass, dom = _house()
    assert await AR.async_rename_room(hass, "Garage", "Workshop") == {}
    assert backups == [] and dom[DATA_FABRIC].store.async_save.await_count == 0


async def test_a_name_padspan_already_has_is_not_merged(backups, caplog) -> None:
    hass, dom = _house()
    assert await AR.async_rename_room(hass, "Den", "Hall") is None
    assert backups == [] and "already has a room called 'Hall'" in caplog.text
    assert "Den" in dom[DATA_FABRIC].data["floors"]["ground"]["rooms"]


async def test_no_backup_no_rename(monkeypatch, caplog) -> None:
    monkeypatch.setattr(WB, "_auto_backup", AsyncMock(return_value=None))
    hass, dom = _house()
    assert await AR.async_rename_room(hass, "Den", "Study") is None
    assert dom[DATA_MODEL].store.async_save.await_count == 0 and "backup could not be made" in caplog.text


async def test_a_store_not_loaded_yet_is_skipped(backups) -> None:
    hass, dom = _house()
    del dom[DATA_CALIBRATION], dom[DATA_ALERTS], dom[DATA_ADAPTIVE]
    done = await AR.async_rename_room(hass, "Den", "Study")
    assert set(done) == {"fabric", "model", "maps", "settings"}


# ── The listener ────────────────────────────────────────────────────────────

def _hass_with_areas(monkeypatch, areas: dict[str, str]):
    reg = SimpleNamespace(
        async_list_areas=lambda: [SimpleNamespace(id=i, name=n) for i, n in areas.items()],
        async_get_area=lambda i: SimpleNamespace(id=i, name=areas[i]) if i in areas else None)
    from homeassistant.helpers import area_registry as ar
    monkeypatch.setattr(ar, "async_get", lambda hass: reg, raising=False)
    tasks: list = []
    hass = SimpleNamespace(data={DOMAIN: {}}, bus=MagicMock(),
                           async_create_task=MagicMock(side_effect=lambda c: (tasks.append(c), c.close())))
    return hass, tasks


def test_setup_keeps_names_and_listens_with_a_partial(monkeypatch) -> None:
    hass, _ = _hass_with_areas(monkeypatch, {"den": "Den"})
    AR.async_setup_area_rename(hass)
    AR.async_setup_area_rename(hass)
    assert hass.bus.async_listen.call_count == 1
    event, fn = hass.bus.async_listen.call_args.args
    assert event == "area_registry_updated" and isinstance(fn, functools.partial) and fn.func is AR._on_area_updated
    assert hass.data[DOMAIN][AR._DATA_NAMES] == {"den": "Den"}
    AR.async_stop_area_rename(hass)
    assert AR._DATA_NAMES not in hass.data[DOMAIN]


def test_a_rename_event_starts_one_rename_with_the_old_name(monkeypatch) -> None:
    areas = {"den": "Den"}
    hass, tasks = _hass_with_areas(monkeypatch, areas)
    AR.async_setup_area_rename(hass)
    started: list = []
    monkeypatch.setattr(AR, "async_rename_room", lambda h, old, new: (started.append((old, new)), _noop())[1])
    areas["den"] = "Study"
    AR._on_area_updated(hass, SimpleNamespace(data={"action": "update", "area_id": "den"}))
    assert started == [("Den", "Study")] and hass.data[DOMAIN][AR._DATA_NAMES]["den"] == "Study"
    # Another change to the area (its icon, its floor): the name is the same, nothing starts.
    AR._on_area_updated(hass, SimpleNamespace(data={"action": "update", "area_id": "den"}))
    areas["new"] = "Porch"
    AR._on_area_updated(hass, SimpleNamespace(data={"action": "create", "area_id": "new"}))
    AR._on_area_updated(hass, SimpleNamespace(data={"action": "remove", "area_id": "den"}))
    assert started == [("Den", "Study")] and hass.data[DOMAIN][AR._DATA_NAMES] == {"new": "Porch"}


async def _noop():
    return None
