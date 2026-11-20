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


# The house as installed.
FIXED_FIRST_RUN = [
    # A number past 64 bits kept in a store: that store could never be saved again.
    Fixed({"type": "padspan_ha/occupancy_train", "actual_count": 1e308}, True, "headcount past 64 bits"),
    Fixed({"type": "padspan_ha/settings_set", "ai_map_wizard": {"snoozes": 1e308}}, False, "snooze count past 64 bits"),
    Fixed({"type": "padspan_ha/fabric_floor_elevations_set", "floors": [{"id": "main", "level": 1e308}]}, False,
          "storey number past 64 bits"),
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
