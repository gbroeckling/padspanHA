# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Renaming an area in a real Home Assistant renames its PadSpan room
(area_rename.py): Home Assistant's own event, which names only the area_id,
reaches the listener, and the room's shape, details and calibration follow."""

from __future__ import annotations

from homeassistant.helpers import area_registry as ar

from .conftest import DOMAIN


async def test_renaming_an_area_renames_the_room(hass, padspan, caplog):
    dom = hass.data[DOMAIN]
    area = ar.async_get(hass).async_create("Den")
    await hass.async_block_till_done()
    fab, mdl, cal = dom["fabric"], dom["model"], dom["calibration"]
    res = await fab.async_correct_room("ground", "Den", {"type": "poly", "points_m": [[0, 0], [3, 0], [3, 3], [0, 3]]})
    assert res["ok"], res
    mdl.data.setdefault("room_meta", {})["Den"] = {"floor_id": "ground", "color": "#52b788"}
    cal.data.setdefault("points", []).append({"room": "Den", "floor_id": "ground", "x": 0.5, "y": 0.5,
                                              "readings": [], "label": "[walk] Den", "source": "room_walk"})

    ar.async_get(hass).async_update(area.id, name="Study")
    await hass.async_block_till_done()

    rooms = fab.data["floors"]["ground"]["rooms"]
    assert "Study" in rooms and "Den" not in rooms
    assert "Study" in mdl.data["room_meta"] and "Den" not in mdl.data["room_meta"]
    assert [p["room"] for p in cal.data["points"] if p.get("source") == "room_walk"] == ["Study"]
    assert "PadSpan room 'Den' is now 'Study'" in caplog.text
    assert "backup could not be made" not in caplog.text
