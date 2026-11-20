# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The last stable's house, loaded by today's code.

upgrade_fixtures/v0.38.231.json is what v0.38.231 stored for a made-up house
built through its own commands (upgrade_capture.py), with the entities and
devices it registered and the HA floors, areas and states it stood on. Here
today's code starts on exactly that, as it does on the day someone updates:
it must set up without an error, keep every entity's id, lose nothing the
person made, answer every read, and write back what it can read again.

When the next stable ships, capture its house the same way and point
FIXTURE at the new file.
"""

from __future__ import annotations

import base64
import copy
import fnmatch
import json
import logging
from pathlib import Path
from typing import Any

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry, mock_storage

from . import commands as C
from .conftest import DOMAIN, call
from .upgrade_house import ENTRY_ID, build_ha_house, poll, stand_in_bluetooth

FIXTURE = Path(__file__).parent / "upgrade_fixtures" / "v0.38.231.json"
OLD = json.loads(FIXTURE.read_text(encoding="utf-8"))

# Settings today's code changes on purpose when it loads an older home's file
# (settings_store.SettingsStore.async_load), and why.
SETTINGS_MIGRATED = {
    # Faster room changes, once: an install still on the old defaults moves to
    # the new ones; a value someone set (this house set both) stays.
    "room_speed_v1_applied",
}
# What a store may let go of on load, and why: the fabric's "no drift found"
# flag is dropped when it is False (fabric_store._check_legacy_drift, as
# v0.38.231 itself does on its next start), and a guest's stay goes on being
# watched, so its live state and summary move on.
MAY_CHANGE = {
    "padspan_ha.fabric": ("/legacy_drift",),
    "padspan_ha.guests": ("/sessions/*/live/", "/sessions/*/summary/"),
}
# Stores the house only gathers as it runs: they may move on.
GATHERED = ("padspan_ha.movement_history", "padspan_ha.telemetry_counters", "padspan_ha.backups")
# Read commands that go to the network or do heavy work, not a read of the stores.
NOT_A_STORE_READ = {"house3d_library_search", "house3d_library_get"}
# Reads an administrator makes beyond the main suite's READ list.
ADMIN_READS = {"store_backup_list", "guests_get", "capture_list", "capture_status", "logs_get",
               "plan_build_info", "wled_teams_get", "ai_usage_get", "vacuum_status"}


@pytest.fixture
def hass_storage():
    """Home Assistant's storage holding exactly what v0.38.231 wrote."""
    with mock_storage(copy.deepcopy(OLD["storage"])) as stored:
        yield stored


@pytest.fixture
def hass_config_dir(tmp_path: Path) -> str:
    """The config folder with the files v0.38.231 wrote beside its storage
    (the floor plans' pictures, a capture session)."""
    config = tmp_path / "config"
    for rel, data in OLD["files"].items():
        path = config / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(base64.b64decode(data))
    config.mkdir(exist_ok=True)
    return str(config)


def _registries_as_left(hass, entry) -> None:
    """The devices and entities v0.38.231 registered, as Home Assistant keeps
    them across the update: same identifiers, same unique ids, same ids."""
    devices = dr.async_get(hass)
    new_id = {}
    for d in OLD["devices"]:
        new_id[d["id"]] = devices.async_get_or_create(
            config_entry_id=entry.entry_id, identifiers={tuple(i) for i in d["identifiers"]},
            connections={tuple(c) for c in d["connections"]}, name=d["name"],
            manufacturer=d["manufacturer"], model=d["model"]).id
    entities = er.async_get(hass)
    for e in OLD["entities"]:
        made = entities.async_get_or_create(
            e["domain"], e["platform"], e["unique_id"], suggested_object_id=e["entity_id"].split(".", 1)[1],
            config_entry=entry, device_id=new_id.get(e["device_id"]), original_name=e["original_name"],
            has_entity_name=e["has_entity_name"], translation_key=e["translation_key"])
        assert made.entity_id == e["entity_id"], "the registry was not rebuilt as v0.38.231 left it"


def _problems(caplog) -> list[str]:
    return [f"{r.levelname} {r.name}: {r.getMessage()}" for r in caplog.records
            if r.levelno >= logging.ERROR and (r.name.startswith("custom_components.padspan_ha")
                                               or r.name.startswith(("homeassistant.setup", "homeassistant.config_entries")))]


def _may_change(key: str, path: str) -> bool:
    if key == "padspan_ha.settings" and path.split("/")[1] in SETTINGS_MIGRATED:
        return True
    return any(fnmatch.fnmatch(path, pattern + ("*" if pattern.endswith("/") else ""))
               for pattern in MAY_CHANGE.get(key, ()))


def _data(stored: dict, key: str) -> Any:
    return (stored.get(key) or {}).get("data")


def _lost(old: Any, new: Any, path: str = "") -> list[str]:
    """Where something in `old` is missing or different in `new` (what was
    added is not looked at)."""
    if isinstance(old, dict):
        if not isinstance(new, dict):
            return [path or "/"]
        return [p for k in old for p in (_lost(old[k], new[k], f"{path}/{k}") if k in new else [f"{path}/{k}"])]
    if isinstance(old, list):
        if not isinstance(new, list) or len(new) < len(old):
            return [path or "/"]
        return [p for i, (a, b) in enumerate(zip(old, new)) for p in _lost(a, b, f"{path}[{i}]")]
    if isinstance(old, float) and isinstance(new, (int, float)) and not isinstance(new, bool):
        return [] if abs(old - new) < 1e-9 else [path]
    return [] if old == new else [path]


async def _start(hass, hass_ws_client, monkeypatch):
    stand_in_bluetooth(monkeypatch)
    build_ha_house(hass, {eid: (s["state"], s["attributes"]) for eid, s in OLD["states"].items()})
    assert await async_setup_component(hass, "http", {})
    assert await async_setup_component(hass, "websocket_api", {})
    entry = MockConfigEntry(domain=DOMAIN, title="PadSpan HA", data={}, entry_id=ENTRY_ID)
    entry.add_to_hass(hass)
    _registries_as_left(hass, entry)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    await poll(hass, DOMAIN, 3)
    return entry, await hass_ws_client(hass)


async def test_it_sets_up_on_the_last_stable_s_house(hass, hass_storage, hass_ws_client, monkeypatch, caplog):
    entry, admin = await _start(hass, hass_ws_client, monkeypatch)
    assert entry.state is ConfigEntryState.LOADED
    assert not _problems(caplog)

    # Every entity keeps its unique id and its entity id, is live again, and
    # none is made a second time under another id.
    reg = er.async_get(hass)
    now = {e.unique_id: e for e in er.async_entries_for_config_entry(reg, ENTRY_ID)}
    for e in OLD["entities"]:
        assert e["unique_id"] in now, f"{e['entity_id']} is gone"
        assert now[e["unique_id"]].entity_id == e["entity_id"]
        state = hass.states.get(e["entity_id"])
        assert state is not None and state.state != "unavailable", f"{e['entity_id']} is not back"
    old_uids = {e["unique_id"] for e in OLD["entities"]}
    added = sorted(e.entity_id for uid, e in now.items() if uid not in old_uids)
    assert added == [], f"new entities appeared for the same house: {added}"
    devices = dr.async_entries_for_config_entry(dr.async_get(hass), ENTRY_ID)
    assert sorted(d.name for d in devices) == sorted(d["name"] for d in OLD["devices"])

    # Every read answers.
    from homeassistant.components import websocket_api  # noqa: PLC0415
    registered = {t[len(C.PREFIX):]: v for t, v in hass.data[websocket_api.DOMAIN].items() if t.startswith(C.PREFIX)}
    for cmd in sorted((set(C.security_lists()["READ"]) | ADMIN_READS) & set(registered) - NOT_A_STORE_READ):
        reply = await call(admin, C.minimal_message(cmd, registered[cmd][1]))
        if not reply["success"]:
            assert reply["error"]["code"] not in ("unknown_error", "invalid_format"), (cmd, reply["error"])


async def test_nothing_the_person_made_is_lost(hass, hass_storage, hass_ws_client, monkeypatch):
    entry, admin = await _start(hass, hass_ws_client, monkeypatch)
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()

    # Each store as written now holds everything it held. A list of things
    # the house only gathers as it runs (movement history) may move on.
    for key, old in OLD["storage"].items():
        if key in GATHERED:
            continue
        lost = [p for p in _lost(old["data"], _data(hass_storage, key)) if not _may_change(key, p)]
        assert lost == [], f"{key}: {lost[:20]}"

    # Settings key by key, through the command the panel reads them with.
    settings = (await call(admin, {"type": "padspan_ha/settings_get"}))["result"]["settings"]
    for key in OLD["settings_changed"]:
        assert settings.get(key) == OLD["reads"]["settings_get"]["settings"].get(key), key
    assert settings["enhanced_security"] is False, "a home that had Enhanced security off must keep it off"

    # What the person made, as the panel reads it.
    for cmd in ("maps_list", "calibration_get", "object_label_list", "device_registry_list", "follow_alert_get",
                "guests_get", "subzones_list", "house3d_get", "store_backup_list"):
        reply = await call(admin, {"type": f"padspan_ha/{cmd}"})
        assert reply["success"], (cmd, reply)


async def test_a_home_on_the_old_defaults_moves_to_the_new_ones(hass, hass_storage, hass_ws_client, monkeypatch):
    """The made-up house set both room-speed settings itself, and keeps them.
    A home still on v0.38.231's defaults for them (almost every home) moves
    to today's, once; nothing else it set moves with them."""
    old = hass_storage["padspan_ha.settings"]["data"]
    old.update(kalman_q=0.125, ble_reseed_interval_s=30)
    _entry, admin = await _start(hass, hass_ws_client, monkeypatch)
    settings = (await call(admin, {"type": "padspan_ha/settings_get"}))["result"]["settings"]
    assert (settings["kalman_q"], settings["ble_reseed_interval_s"]) == (3.0, 5)
    assert settings["room_speed_v1_applied"] is True and settings["enhanced_security"] is False
    for key in OLD["settings_changed"]:
        if key not in ("kalman_q", "ble_reseed_interval_s"):
            assert settings.get(key) == OLD["reads"]["settings_get"]["settings"].get(key), key


async def test_what_it_writes_back_reads_again(hass, hass_storage, hass_ws_client, monkeypatch, caplog):
    entry, admin = await _start(hass, hass_ws_client, monkeypatch)
    reply = await call(admin, {"type": "padspan_ha/settings_set", "light_theme": True})
    assert reply["success"], reply
    await poll(hass, DOMAIN, 2)
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()
    written = copy.deepcopy({k: v for k, v in hass_storage.items() if k.startswith(DOMAIN + ".")})

    # Read again from storage by fresh stores, as at the next start.
    from custom_components.padspan_ha.alert_store import AlertStore  # noqa: PLC0415
    from custom_components.padspan_ha.calibration_store import CalibrationStore  # noqa: PLC0415
    from custom_components.padspan_ha.device_registry import DeviceRegistry  # noqa: PLC0415
    from custom_components.padspan_ha.maps_store import MapsStore  # noqa: PLC0415
    from custom_components.padspan_ha.object_store import ObjectStore  # noqa: PLC0415
    from custom_components.padspan_ha.settings_store import SettingsStore  # noqa: PLC0415

    settings = SettingsStore(hass)
    await settings.async_load()
    assert settings.data["light_theme"] is True and settings.data["enhanced_security"] is False
    maps = MapsStore(hass)
    await maps.async_setup()
    assert len(maps.list_maps()) == len(_data(written, "padspan_ha.maps")["maps"])
    cal = CalibrationStore(hass)
    await cal.async_setup_fast()
    assert len(cal.data.get("points") or []) == len(_data(written, "padspan_ha.calibration")["points"])
    objects = ObjectStore(hass)
    await objects.async_load()
    assert len(objects.all()) == len(_data(written, "padspan_ha.objects"))
    alerts = AlertStore(hass)
    await alerts.async_load()
    assert len(alerts.all()) == len(_data(written, "padspan_ha.follow_alerts"))
    devices = DeviceRegistry(hass)
    await devices.async_load()
    assert devices.device_count() == len(_data(written, "padspan_ha.devices")["devices"])
    await hass.async_block_till_done()
    for key in written:
        if key not in GATHERED:
            lost = [p for p in _lost(written[key]["data"], _data(hass_storage, key)) if not _may_change(key, p)]
            assert lost == [], f"{key}: {lost[:20]}"

    # And it unloads and sets up again.
    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    await poll(hass, DOMAIN, 1)
    assert not _problems(caplog)
