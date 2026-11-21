# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A store file that parses but holds the wrong kind of data is kept, and said.

Home Assistant moves a file it cannot parse aside (<file>.corrupt.<time>) and
logs it. A file that parses but holds, say, a list where a store keeps a dict
(a hand edit, a version that kept it otherwise) passed every check: the store
started empty without a word, and its next save, at once for several, wrote
over the file. Here each store loads such a file from disk in a real Home
Assistant: the file is moved aside whole (<file>.unreadable.<time>), one error
says so, and the store starts empty as with no file.
"""

from __future__ import annotations

import json
import logging
from importlib import import_module
from pathlib import Path

import pytest
from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE

# store key -> (module, class, how it loads, data of the wrong kind)
STORES = {
    "padspan_ha.settings": ("settings_store", "SettingsStore", "async_load", []),
    "padspan_ha.maps": ("maps_store", "MapsStore", "async_setup", []),
    "padspan_ha.model": ("model_store", "ModelStore", "async_setup", []),
    "padspan_ha.fabric": ("fabric_store", "FabricStore", "async_setup", []),
    "padspan_ha.calibration": ("calibration_store", "CalibrationStore", "async_setup_fast", []),
    "padspan_ha.objects": ("object_store", "ObjectStore", "async_load", []),
    "padspan_ha.devices": ("device_registry", "DeviceRegistry", "async_load", []),
    "padspan_ha.follow_alerts": ("alert_store", "AlertStore", "async_load", []),
    "padspan_ha.movement_history": ("movement_store", "MovementStore", "async_load", {}),
    "padspan_ha.lost_and_found": ("lost_and_found_store", "LostAndFoundStore", "async_load", []),
    "padspan_ha.adaptive": ("adaptive_store", "AdaptiveStore", "async_load", []),
    "padspan_ha.forensics": ("forensics_store", "ForensicsStore", "async_load", []),
    "padspan_ha.capture": ("capture_store", "CaptureStore", "async_load", []),
    "padspan_ha.guests": ("guest_tags", "GuestStore", "async_load", []),
    "padspan_ha.subzones": ("subzones", "SubzoneStore", "async_load", []),
    "padspan_ha.emergency_test": ("emergency_test", "EmergencyTestStore", "async_load", []),
    "padspan_ha.wled_looks": ("wled_exact", "WledLooksStore", "async_load", []),
    "padspan_ha.plan_ai": ("plan_ai", "PlanAiStore", "async_load", []),
    "padspan_ha.vacation_log": ("vacation_mode", "VacationLog", "async_load", [1]),
    "padspan_ha.vacuum": ("vacuum_import", "VacuumStore", "async_load", []),
    "padspan_ha.house3d": ("house3d_store", "House3dStore", "async_load", []),
}


@pytest.fixture
def hass_storage():
    """Real files: the stores read and write .storage on disk."""
    yield {}


async def _load_backups(hass):
    from custom_components.padspan_ha.ws_backup import _load_backups  # noqa: PLC0415
    return await _load_backups(hass)


@pytest.mark.parametrize("key", [*sorted(STORES), "padspan_ha.backups"])
async def test_a_file_of_the_wrong_kind_is_kept_and_said(hass, key, caplog):
    storage = Path(hass.config.path(".storage"))
    storage.mkdir(parents=True, exist_ok=True)
    module, cls, load, wrong = STORES.get(key, (None, None, None, []))
    body = json.dumps({"version": 1, "minor_version": 1, "key": key, "data": wrong})
    (storage / key).write_text(body, encoding="utf-8")

    if module is None:
        await _load_backups(hass)
    else:
        store = getattr(import_module(f"custom_components.padspan_ha.{module}"), cls)(hass)
        await getattr(store, load)()
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)     # every delayed save written
    await hass.async_block_till_done()

    kept = [p for p in storage.iterdir() if p.name.startswith(f"{key}.unreadable.")]
    assert len(kept) == 1, f"{key}: the file was not kept ({sorted(p.name for p in storage.iterdir())})"
    assert kept[0].read_text(encoding="utf-8") == body
    said = [r for r in caplog.records if r.levelno >= logging.ERROR and key in r.getMessage()]
    assert len(said) == 1, [r.getMessage() for r in said]


async def test_a_file_it_reads_is_left_alone(hass, caplog):
    """The check is no stricter than the store: its own empty file stays."""
    storage = Path(hass.config.path(".storage"))
    storage.mkdir(parents=True, exist_ok=True)
    from custom_components.padspan_ha.object_store import ObjectStore  # noqa: PLC0415
    body = json.dumps({"version": 1, "minor_version": 1, "key": "padspan_ha.objects", "data": {}})
    (storage / "padspan_ha.objects").write_text(body, encoding="utf-8")
    await ObjectStore(hass).async_load()
    assert sorted(p.name for p in storage.iterdir()) == ["padspan_ha.objects"]
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


@pytest.mark.parametrize("key", [*sorted(STORES), "padspan_ha.backups"])
@pytest.mark.parametrize("body", ["[]", "[1, 2]", "5", '{"version": 1, "key": "x"}'],
                         ids=["empty list", "list", "number", "no data"])
async def test_json_that_is_no_store_file_is_kept_and_said(hass, key, body, caplog):
    """Valid JSON but no store document at all: Home Assistant's own loader
    raised on it at every load (several error lines, and a background load
    raised with nobody to hear it). It is kept and said as a wrong-kind file
    is, and the store starts empty."""
    storage = Path(hass.config.path(".storage"))
    storage.mkdir(parents=True, exist_ok=True)
    module, cls, load, _wrong = STORES.get(key, (None, None, None, None))
    (storage / key).write_text(body, encoding="utf-8")

    if module is None:
        await _load_backups(hass)
    else:
        store = getattr(import_module(f"custom_components.padspan_ha.{module}"), cls)(hass)
        await getattr(store, load)()
        await getattr(store, load)()                             # a second load finds no file, says nothing
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()

    kept = [p for p in storage.iterdir() if p.name.startswith(f"{key}.unreadable.")]
    assert len(kept) == 1, f"{key}: the file was not kept ({sorted(p.name for p in storage.iterdir())})"
    assert kept[0].read_text(encoding="utf-8") == body
    said = [r for r in caplog.records if r.levelno >= logging.ERROR]
    assert len(said) == 1 and key in said[0].getMessage(), [r.getMessage() for r in said]


@pytest.mark.parametrize("key", ["padspan_ha.settings", "padspan_ha.calibration", "padspan_ha.objects"])
async def test_a_file_that_cannot_be_read_is_left_where_it_is(hass, key, caplog):
    """A read that fails (here: a folder where the file should be) is not a
    file of the wrong kind: nothing is moved, and the load raises as before."""
    storage = Path(hass.config.path(".storage"))
    (storage / key).mkdir(parents=True)
    module, cls, load, _wrong = STORES[key]
    store = getattr(import_module(f"custom_components.padspan_ha.{module}"), cls)(hass)
    with pytest.raises(Exception):  # noqa: B017 - whatever Home Assistant raises for it
        await getattr(store, load)()
    assert sorted(p.name for p in storage.iterdir()) == [key]
    assert (storage / key).is_dir()


async def test_the_background_loads_at_setup_raise_nothing_on_such_a_file(hass, caplog):
    """emergency_test and wled_exact load their stores in tasks started at
    set-up; a bare list in either file raised there, logged by Home
    Assistant as 'Task exception was never retrieved'."""
    storage = Path(hass.config.path(".storage"))
    storage.mkdir(parents=True, exist_ok=True)
    for key in ("padspan_ha.emergency_test", "padspan_ha.wled_looks"):
        (storage / key).write_text("[]", encoding="utf-8")
    from custom_components.padspan_ha import emergency_test, wled_exact  # noqa: PLC0415
    emergency_test.async_setup_emergency_test(hass)
    hass.async_create_task(wled_exact.async_setup_wled_exact(hass))
    await hass.async_block_till_done()
    assert not [r for r in caplog.records if "never retrieved" in r.getMessage() or r.exc_info]
    for key in ("padspan_ha.emergency_test", "padspan_ha.wled_looks"):
        assert [p for p in storage.iterdir() if p.name.startswith(f"{key}.unreadable.")], key
    emergency_test.async_stop_emergency_test(hass)
