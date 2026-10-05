# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Live Aboard: a person deleted in Home Assistant takes their figure along
(house3d_people.py).

Plan: docs/IDEA_ATLAS_3D_HOUSE.md ("People": deleting the person or the
figure deletes the recipe). Held here:
- Home Assistant's entity registry "remove" for a person.* entity takes that
  figure out of Live Aboard's file: one write, read back, under the store's
  lock, and only when the file has that figure;
- a person merely missing from the states (Home Assistant starting, a
  restart, a reload) never removes anything: only that registry event does,
  and a rename, another kind of entity or another action does nothing;
- a house with no file reads and writes nothing; an unreadable file, a newer
  PadSpan's, or a failed write leaves the figure where it is;
- the listener is set up once with the integration and taken down on unload.
"""

from __future__ import annotations

import asyncio
import functools
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from custom_components.padspan_ha import house3d_people as HP
from custom_components.padspan_ha import house3d_store as H
from custom_components.padspan_ha.const import DATA_HOUSE3D, DATA_SETTINGS, DOMAIN, HOUSE3D_STORE_KEY
from tests.test_house3d_edit import _edit, _file, _on, _seed, disk  # noqa: F401  (disk is a fixture)
from tests.test_house3d_figures import _figure
from tests.test_house3d_store import _house, _run

_ROOT = Path(__file__).resolve().parents[1]
_CC = _ROOT / "custom_components" / "padspan_ha"
_WIN = {"kind": "window", "floor_id": "main", "a_m": [2.1, -9.23], "b_m": [3.3, -9.23], "sill_m": 0.9, "head_m": 2.1}


def _stored(tmp_path: Path) -> dict:
    return json.loads(_file(tmp_path).read_text(encoding="utf-8"))["data"]


def _two(tmp_path: Path) -> dict:
    """A file with two figures, a window and a light height."""
    data = {**H.empty(), "figures": {"person.garry": _figure(), "person.nicole": _figure()},
            "openings": {"win_5e6f7a8b": dict(_WIN)}, "lights": {"light.kitchen": {"z_m": 1.5}}}
    _seed(tmp_path, data)
    return data


def _event(entity_id, action="remove", **more):
    return SimpleNamespace(data={"action": action, "entity_id": entity_id, **more})


def _fire(h, event) -> list:
    """The listener as Home Assistant calls it; each task it starts, run."""
    started = []
    h.async_create_task = started.append
    HP._on_entity_registry_updated(h, event)
    return [_run(c) for c in started]


# ═══ a deleted person ═════════════════════════════════════════════════════════

def test_a_deleted_person_takes_their_figure_and_nothing_else(disk, tmp_path):
    h, _conn = _on(tmp_path)
    before = _two(tmp_path)
    assert _fire(h, _event("person.garry")) == [True]
    after = _stored(tmp_path)
    assert after["figures"] == {"person.nicole": before["figures"]["person.nicole"]}
    assert {k: v for k, v in after.items() if k != "figures"} == {k: v for k, v in before.items() if k != "figures"}
    assert disk.writes == [HOUSE3D_STORE_KEY], "one write"
    assert h.data[DOMAIN][DATA_HOUSE3D].data == after, "read back: memory is what the file holds"


def test_the_figure_goes_even_while_live_aboard_is_off(disk, tmp_path):
    """Deleting the person is the owner's own act and the figure is personal:
    it goes whatever the switch says (the file is otherwise never written off)."""
    h, _conn = _on(tmp_path)
    h.data[DOMAIN][DATA_SETTINGS].data["atlas_3d_enabled"] = False
    _two(tmp_path)
    assert _fire(h, _event("person.garry")) == [True]
    assert list(_stored(tmp_path)["figures"]) == ["person.nicole"]


def test_only_when_the_file_has_that_figure(disk, tmp_path):
    h, _conn = _on(tmp_path)
    _two(tmp_path)
    assert _fire(h, _event("person.visitor")) == [False]
    assert disk.writes == [], "no figure, no write"


def test_a_house_with_no_file_reads_and_writes_nothing(disk, tmp_path):
    h, _conn = _on(tmp_path)
    assert _fire(h, _event("person.garry")) == [False]
    assert disk.writes == [] and not _file(tmp_path).exists()
    assert DATA_HOUSE3D not in h.data[DOMAIN], "the store is not even loaded"


# ═══ never on a missing state ═════════════════════════════════════════════════

def test_a_person_missing_from_the_states_is_never_deleted(disk, tmp_path):
    """Home Assistant starting, a restart or a reload: the person is not in
    the states for a while. Nothing reads the states, so the figure stays;
    only the registry's own "remove" deletes."""
    h, _conn = _on(tmp_path)
    before = _two(tmp_path)
    h.states = MagicMock()
    h.states.get.return_value = None                      # every person missing
    h.states.async_all.return_value = []
    # A restart: the integration set up again, the person's state gone and back.
    h.bus = MagicMock()
    HP.async_setup_house3d_people(h)
    assert [c.args[0] for c in h.bus.async_listen.call_args_list] == ["entity_registry_updated"], "no state listener"
    gone = SimpleNamespace(data={"entity_id": "person.garry", "old_state": SimpleNamespace(state="home"), "new_state": None})
    assert _fire(h, gone) == []
    # Neither a rename, a new or changed entry, nor another kind of entity deletes.
    for ev in (_event("person.garry", "update", old_entity_id="person.garry", changes={"name": "G"}),
               _event("person.garry_2", "update", old_entity_id="person.garry"),
               _event("person.garry", "create"),
               _event("device_tracker.pixel"),
               _event("light.person_garry"),
               SimpleNamespace(data={"action": "remove"})):
        assert _fire(h, ev) == []
    assert _stored(tmp_path) == before and disk.writes == []
    code = (_CC / "house3d_people.py").read_text(encoding="utf-8")
    assert "hass.states" not in code and "state_changed" not in code
    HP.async_stop_house3d_people(h)


def test_an_unreadable_or_newer_file_is_left_alone(disk, tmp_path):
    h, _conn = _on(tmp_path)
    before = _two(tmp_path)

    async def _fails(_hass):
        raise H.ReadFailed("disk error")

    real, HP.async_get_store = HP.async_get_store, _fails
    try:
        assert _fire(h, _event("person.garry")) == [False]
    finally:
        HP.async_get_store = real
    newer = {**before, "schema": 2}
    _seed(tmp_path, newer)
    h.data[DOMAIN].pop(DATA_HOUSE3D, None)
    assert _fire(h, _event("person.garry")) == [False]
    assert _stored(tmp_path) == newer and disk.writes == []


def test_a_failed_write_keeps_the_figure(disk, tmp_path):
    h, _conn = _on(tmp_path)
    before = _two(tmp_path)
    disk.fail = ["swallowed"]                              # Home Assistant's Store: logged, returns normally
    assert _fire(h, _event("person.garry")) == [False]
    assert _stored(tmp_path) == before
    assert "person.garry" in h.data[DOMAIN][DATA_HOUSE3D].data["figures"], "memory unchanged"


def test_it_takes_its_turn_with_a_save(disk, tmp_path):
    """The store's lock: a Save in flight and the removal both land."""
    h, conn = _on(tmp_path)
    _two(tmp_path)
    disk.slow = True

    async def both():
        await H.async_get_store(h)
        from custom_components.padspan_ha import ws_house3d as W
        await asyncio.gather(W.ws_house3d_edit(h, conn, {"id": 7, "type": "padspan_ha/house3d_edit",
                                                          "lights": {"light.den": {"z_m": 2.0}}}),
                             HP.async_forget_person(h, "person.garry"))

    _run(both())
    after = _stored(tmp_path)
    assert list(after["figures"]) == ["person.nicole"] and after["lights"]["light.den"] == {"z_m": 2.0}
    assert after["lights"]["light.kitchen"] == {"z_m": 1.5}


# ═══ set up and taken down ════════════════════════════════════════════════════

def test_the_listener_is_set_up_once_and_taken_down_on_unload():
    hass = MagicMock()
    hass.data = {DOMAIN: {}}
    HP.async_setup_house3d_people(hass)
    HP.async_setup_house3d_people(hass)                    # a config-entry reload
    assert hass.bus.async_listen.call_count == 1
    name, listener = hass.bus.async_listen.call_args[0]
    assert name == "entity_registry_updated"
    # functools.partial: Home Assistant finds the @callback and runs it on the loop.
    assert isinstance(listener, functools.partial) and listener.func is HP._on_entity_registry_updated and listener.args == (hass,)
    unsub = hass.bus.async_listen.return_value
    HP.async_stop_house3d_people(hass)
    assert unsub.called and HP._UNSUB not in hass.data[DOMAIN]
    HP.async_stop_house3d_people(hass)                     # twice: nothing to take down
    assert unsub.call_count == 1
    src = (_CC / "__init__.py").read_text(encoding="utf-8")
    setup = src[src.index("async def async_setup_entry("):src.index("async def async_unload_entry(")]
    unload = src[src.index("async def async_unload_entry("):]
    assert "async_setup_house3d_people(hass)" in setup and "async_stop_house3d_people(hass)" in unload
