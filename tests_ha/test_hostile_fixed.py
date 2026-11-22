# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What the hostile-input pass (test_hostile.py) found and was fixed: each
message as it was sent, in the house it was found in, checked the same way
(one answer in time, no handler exception or error logged, a refusal changes
nothing, nothing outside the config folder), and here also: refused when it
must be, and nothing it stores holds junk (nan, inf, a NUL, 100,000
characters). The command still answers afterwards and the integration
reloads."""

from __future__ import annotations

from typing import NamedTuple

import pytest

from . import commands as C
from . import hostile_values as H
from .test_hostile import (  # noqa: F401  (the fixtures: these tests' houses and stores)
    Watch, _everything_on, _record_stores, _registered, hass_config_dir, hass_storage,
)
from .test_upgrade import _start


# ── what the pass found, fixed: each message as it was sent ──────────────────

class Fixed(NamedTuple):
    message: dict
    refused: bool           # it must be refused; otherwise answered, and nothing it stores is junk
    why: str


# The furnished house's ground-floor plan.
PLAN = "ef444e6807a61e89"

# The house as installed.
FIXED_FIRST_RUN = [
    # A number past 64 bits kept in a store: that store could never be saved again.
    Fixed({"type": "padspan_ha/occupancy_train", "actual_count": 1e308}, True, "headcount past 64 bits"),
    Fixed({"type": "padspan_ha/settings_set", "ai_map_wizard": {"snoozes": 1e308}}, False, "snooze count past 64 bits"),
    Fixed({"type": "padspan_ha/fabric_floor_elevations_set", "floors": [{"id": "main", "level": 1e308}]}, False,
          "storey number past 64 bits"),
    # The secret check on a tester's notes took time with the square of their length.
    Fixed({"type": "padspan_ha/tester_preview", "email": "a@example.com", "consent": True, "notes": "x" * 100_000},
          False, "100,000 characters of notes held Home Assistant for a minute"),
    # A field of the wrong kind inside a dict the handler takes whole.
    Fixed({"type": "padspan_ha/rooms_overlap", "rooms": {"Kitchen": -1}}, False, "a room's outline a number"),
    Fixed({"type": "padspan_ha/device_how_known", "object": {
        "manufacturer_data": "x", "service_data": -1, "service_uuids": 1, "all_addresses": -1, "maker_source": [],
        "company_name": [], "address_type": "random", "address": "x", "device": "x"}}, False,
        "an object with every field of the wrong kind"),
    Fixed({"type": "padspan_ha/calibration_save_point", "point": {"x_frac": "x", "scanner_readings": -1}}, True,
          "a point refused in Python's own words"),
    # An address on this machine itself, or a cloud server's metadata address, fetched.
    Fixed({"type": "padspan_ha/vacuum_import_preview", "url": "http://127.0.0.1:1/"}, True, "the vacuum at loopback"),
    Fixed({"type": "padspan_ha/vacuum_import_preview", "url": "http://169.254.169.254/latest/meta-data/?"}, True,
          "the vacuum at the metadata address"),
    Fixed({"type": "padspan_ha/settings_set", "espresense_companion_url": "http://169.254.169.254"}, True,
          "the Companion at the metadata address"),
    # A fixed choice stored as a fallback for an unknown word.
    Fixed({"type": "padspan_ha/settings_set", "data_mode": "zz_missing_data_mode"}, True, "an unknown data mode"),
    Fixed({"type": "padspan_ha/settings_set", "positioning_algorithm": "zz"}, True, "an unknown positioning method"),
    Fixed({"type": "padspan_ha/settings_set", "license_tier_override": "zz"}, True, "an unknown tier"),
    # auto_offset_mode is no longer taken at all (2026-11-22: nothing read it).
    Fixed({"type": "padspan_ha/settings_set", "auto_offset_mode": "zz"}, True, "a setting no longer taken"),
    # Sizes: 100,000 characters, a NUL, 1e308 metres, 10,000 entries, 200 levels, a wall's extra key.
    Fixed({"type": "padspan_ha/object_label_set", "address": "AA:BB:CC:DD:EE:01", "label": "x" * 100_000}, True,
          "a label of 100,000 characters"),
    Fixed({"type": "padspan_ha/fabric_room_add", "room": "Hall\x00"}, True, "a room name with a NUL"),
    Fixed({"type": "padspan_ha/fabric_scanner_position_set", "source": "scanner_x", "x_m": 1e308, "y_m": 0}, True,
          "a receiver 1e308 m away"),
    Fixed({"type": "padspan_ha/settings_set", "followed_addrs": ["AA:BB:CC:DD:EE:01"] * 10_000}, True,
          "10,000 followed devices"),
    Fixed({"type": "padspan_ha/follow_alert_save", "addr": "AA:BB:CC:DD:EE:01", "config": H._nested(200, 1, False)},
          True, "a follow alert nested 200 deep"),
    Fixed({"type": "padspan_ha/fabric_rf_barrier_set", "barrier": {
        "name": "Wall", "points_m": [[0, 0], [2, 0]], "zz_missing_field": "x"}}, False, "a wall with a key of its own"),
]
# The last stable's house, every switch on.
FIXED_FURNISHED = [
    Fixed({"type": "padspan_ha/capture_get", "session_id": "20261120-120425", "offset": 1e308}, True,
          "an offset past 64 bits could not be sent back"),
    # "nan" and "inf" taken as numbers and stored.
    Fixed({"type": "padspan_ha/fabric_light_position_set", "entity_id": "light.kitchen_ceiling", "x_m": 1, "y_m": 1,
           "width_cm": "nan"}, True, "a light's width of nan"),
    Fixed({"type": "padspan_ha/fabric_scanner_z_set", "source": "scanner_example_kitchen", "z_m": "inf"}, True,
          "a receiver's height of inf"),
    Fixed({"type": "padspan_ha/scanner_offset_set", "source": "scanner_example_kitchen", "offset_db": "nan"}, True,
          "a receiver's offset of nan"),
    Fixed({"type": "padspan_ha/guest_session_update", "session": "gs_789c232c", "end_at": "inf"}, True,
          "a stay that ends at inf"),
    Fixed({"type": "padspan_ha/guest_session_update", "session": "gs_789c232c", "end_at": 1e308}, True,
          "a stay that ends past the next year"),
    # A field of the wrong kind inside a dict the handler takes whole.
    Fixed({"type": "padspan_ha/fabric_rf_barrier_set", "barrier": {"name": "Wall", "points_m": -1}}, True,
          "a wall whose points are a number"),
    Fixed({"type": "padspan_ha/fabric_open_edges_apply", "action": "tap",
           "set_barriers": [{"name": "Wall", "points_m": [{"a": 1}, {"b": 2}]}]}, True, "a wall whose points are dicts"),
    Fixed({"type": "padspan_ha/wled_teams_set", "teams": [{"leader": "x", "followers": -1, "group": 1}]}, True,
          "a team whose followers are a number"),
    # A plan's picture replaced by anything at all.
    Fixed({"type": "padspan_ha/maps_replace_image", "map_id": PLAN, "width": 1, "height": 1,
           "png_base64": "not a picture"}, True, "a picture that is not base64"),
    Fixed({"type": "padspan_ha/maps_replace_image", "map_id": PLAN, "width": 1, "height": 1,
           "png_base64": H._b64(b"junk" * 64)}, True, "junk written as the plan's picture"),
    Fixed({"type": "padspan_ha/maps_replace_image", "map_id": PLAN, "width": 1, "height": 1,
           "png_base64": H._b64(H._png(1, 1)), "crop": {"fx0": "x"}}, True, "a crop of text, after the picture was written"),
    # A plan's pins and stack.
    Fixed({"type": "padspan_ha/maps_update", "map_id": PLAN, "beacons": ["x"]}, True,
          "a list of text wiped the plan's beacons"),
    Fixed({"type": "padspan_ha/maps_update", "map_id": PLAN, "beacons": [{"key": [], "x": 0.5, "y": 0.5}]}, False,
          "a beacon whose key is a list"),
    Fixed({"type": "padspan_ha/maps_update", "map_id": PLAN, "receivers": [{"id": "r1", "x": "x", "y": 0.5}]}, False,
          "a receiver pin at x"),
    Fixed({"type": "padspan_ha/maps_update", "map_id": PLAN, "stack": {"z_level": None}}, False,
          "a stack level of null"),
    # A plan's placement record took the client's dict whole.
    Fixed({"type": "padspan_ha/fabric_map_transform_set", "map_id": PLAN, "transform": {
        "scale_x_m": 10, "scale_y_m": 8, "reference_measurements": None, "zz_missing_field": "x"}}, False,
        "a placement with a field it has not and measurements of null"),
]


async def _check_fixed(watch: Watch, admin, schema, entry, case: Fixed) -> None:
    rec = await watch.send(admin, dict(case.message), phase="fixed", field="", hostile=H.Hostile("fixed", case.why, None))
    if case.refused and rec["code"] == "ok":
        rec["problems"].append("accepted; it must be refused")
    if rec["stored_junk"]:
        rec["problems"].append(f"stored junk in {rec['stored_junk']}")
    await watch.still_works(admin, schema, entry)
    watch.finish(f"fixed[{case.why}]")


@pytest.mark.parametrize("case", FIXED_FIRST_RUN, ids=lambda c: c.why)
async def test_fixed_first_run(hass, padspan, admin, hass_storage, caplog, network, monkeypatch, case):
    command = case.message["type"][len(C.PREFIX):]
    watch = Watch(hass, hass_storage, caplog, network, monkeypatch, command)
    await _check_fixed(watch, admin, _registered(hass)[command][1], padspan, case)


@pytest.mark.parametrize("case", FIXED_FURNISHED, ids=lambda c: c.why)
async def test_fixed_furnished(hass, hass_ws_client, hass_storage, caplog, network, monkeypatch, case):
    entry, admin = await _start(hass, hass_ws_client, monkeypatch)
    await _everything_on(hass)
    command = case.message["type"][len(C.PREFIX):]
    watch = Watch(hass, hass_storage, caplog, network, monkeypatch, command)
    await _check_fixed(watch, admin, _registered(hass)[command][1], entry, case)
