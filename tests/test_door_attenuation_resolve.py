# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Door/window barrier project, step 4: live attenuation resolution.

docs/IDEA_DOOR_WINDOW_BARRIERS.md step 4 — a linked STEEL barrier's
attenuation_dbm is overridden server-side, once, in
`PresenceCoordinator._resolve_door_attenuation`: closed keeps the authored
value, open drops to ~0, debounced across 2 consecutive polls so a flapping
sensor can't jitter the solver right at a transition. An unlinked or
non-metal door/window must be left exactly as authored, always.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from custom_components.padspan_ha.const import DOMAIN, DATA_SETTINGS
from custom_components.padspan_ha.presence_coordinator import PresenceCoordinator


def make_coordinator() -> PresenceCoordinator:
    hass = MagicMock()
    st = MagicMock()
    st.data = {}
    hass.data = {DOMAIN: {DATA_SETTINGS: st}}
    return PresenceCoordinator(hass)


def metal_barrier(entity_id: str = "binary_sensor.front_door") -> dict:
    return {
        "points": [(0.0, 0.0), (1.0, 0.0)],
        "attenuation_dbm": 12.0,
        "material": "metal",
        "floor_id": "main",
        "linked_entity_id": entity_id,
    }


def set_state(coord: PresenceCoordinator, entity_id: str, state: str | None) -> None:
    if state is None:
        coord.hass.states.get.return_value = None
        return
    mock_state = MagicMock()
    mock_state.state = state
    coord.hass.states.get.return_value = mock_state


# ── debounce: a single reading never applies ────────────────────────────────

def test_a_single_open_reading_does_not_flip_the_attenuation():
    coord = make_coordinator()
    coord._rf_barriers = [metal_barrier()]
    set_state(coord, "binary_sensor.front_door", "on")

    coord._resolve_door_attenuation()

    assert coord._rf_barriers[0]["attenuation_dbm"] == 12.0


def test_two_consecutive_open_readings_drop_attenuation_to_zero():
    coord = make_coordinator()
    coord._rf_barriers = [metal_barrier()]
    set_state(coord, "binary_sensor.front_door", "on")

    coord._resolve_door_attenuation()
    coord._rf_barriers = [metal_barrier()]  # rebuilt fresh each poll
    coord._resolve_door_attenuation()

    assert coord._rf_barriers[0]["attenuation_dbm"] == 0.0


def test_closing_again_needs_two_more_consecutive_readings():
    coord = make_coordinator()
    eid = "binary_sensor.front_door"

    # Two "on" polls confirm open.
    for _ in range(2):
        coord._rf_barriers = [metal_barrier(eid)]
        set_state(coord, eid, "on")
        coord._resolve_door_attenuation()
    assert coord._rf_barriers[0]["attenuation_dbm"] == 0.0

    # A single "off" reading must not restore it yet.
    coord._rf_barriers = [metal_barrier(eid)]
    set_state(coord, eid, "off")
    coord._resolve_door_attenuation()
    assert coord._rf_barriers[0]["attenuation_dbm"] == 0.0

    # A second consecutive "off" reading confirms closed.
    coord._rf_barriers = [metal_barrier(eid)]
    set_state(coord, eid, "off")
    coord._resolve_door_attenuation()
    assert coord._rf_barriers[0]["attenuation_dbm"] == 12.0


# ── scope: only a linked, metal barrier is ever touched ─────────────────────

def test_an_unlinked_barrier_is_left_exactly_as_authored():
    coord = make_coordinator()
    bar = metal_barrier()
    bar["linked_entity_id"] = None
    coord._rf_barriers = [bar]
    set_state(coord, "binary_sensor.front_door", "on")

    coord._resolve_door_attenuation()

    assert coord._rf_barriers[0]["attenuation_dbm"] == 12.0
    coord.hass.states.get.assert_not_called()


def test_a_non_metal_linked_door_is_left_exactly_as_authored():
    coord = make_coordinator()
    bar = metal_barrier()
    bar["material"] = "custom"
    coord._rf_barriers = [bar]
    set_state(coord, "binary_sensor.front_door", "on")

    coord._resolve_door_attenuation()

    assert coord._rf_barriers[0]["attenuation_dbm"] == 12.0
    coord.hass.states.get.assert_not_called()


def test_a_missing_or_unknown_ha_state_leaves_attenuation_untouched():
    coord = make_coordinator()
    coord._rf_barriers = [metal_barrier()]
    set_state(coord, "binary_sensor.front_door", None)

    coord._resolve_door_attenuation()

    assert coord._rf_barriers[0]["attenuation_dbm"] == 12.0
