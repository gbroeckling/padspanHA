# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Moving a wall in the Rooms editor keeps what is linked to it.

fabric_rf_barrier_set replaces the stored wall by id. The Rooms editor sent
id, name, material, attenuation, floor and points only, so dragging one
corner of a door's wall erased its contact sensor, opener, lock and Invert.
Source-level pin, the convention for this file's interactive map tabs.
"""

from __future__ import annotations

from pathlib import Path

_MAPS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
         / "www" / "padspan-ha" / "views" / "maps.js")


def _save_block() -> str:
    src = _MAPS.read_text(encoding="utf-8")
    i = src.index("for (const i of movedBarriers) {")
    return src[i:src.index("ctx.toast(fail ?", i)]


def test_moved_wall_is_sent_as_the_stored_record_with_new_points():
    block = _save_block()
    assert "barrier: { ..._barById.get(b.id), floor_id: floorId, points_m: b.points_m }" in block
    assert "material: b.material" not in block


def test_moved_is_decided_by_id_not_list_position():
    src = _MAPS.read_text(encoding="utf-8")
    assert "allBarriers[i]?.points_m" not in src
    assert "_barById.get(barDraft[i].id)" in src
