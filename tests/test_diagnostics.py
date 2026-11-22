# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Home Assistant's "Download diagnostics" (diagnostics.py) hides the tag keys
in room_tag_map: a key can be a device's Bluetooth address, and the file is
pasted into public bug reports. The rooms and how many tags each has stay."""

from __future__ import annotations

import json
from types import SimpleNamespace

from custom_components.padspan_ha import diagnostics as D
from custom_components.padspan_ha.const import DOMAIN
from custom_components.padspan_ha.coordinator import PadSpanCoordinator

_ADDR = "C0:FF:EE:00:00:01"


async def test_room_tag_map_keys_are_redacted_rooms_and_counts_kept() -> None:
    coord = PadSpanCoordinator()
    coord.room_tag_map = {"Kitchen": [_ADDR, "ibeacon:0a1b2c3d-0000-4000-8000-00000000cafe:1:2"], "Hall": []}
    hass = SimpleNamespace(data={DOMAIN: {"coordinator": coord}})
    entry = SimpleNamespace(entry_id="e1", title="PadSpan HA", data={}, options={})
    out = await D.async_get_config_entry_diagnostics(hass, entry)
    assert out["coordinator"]["room_tag_map"] == {"Kitchen": [D.REDACTED, D.REDACTED], "Hall": []}
    blob = json.dumps(out)
    assert _ADDR not in blob and "cafe" not in blob
    # The coordinator's own map is untouched: only the copy in the file is hidden.
    assert coord.room_tag_map["Kitchen"][0] == _ADDR


async def test_no_coordinator_and_odd_shapes() -> None:
    entry = SimpleNamespace(entry_id="e1", title="PadSpan HA", data={}, options={})
    out = await D.async_get_config_entry_diagnostics(SimpleNamespace(data={}), entry)
    assert out["coordinator"] is None
    assert D.redact_room_tag_map(None) == {}
    assert D.redact_room_tag_map({"Den": _ADDR}) == {"Den": D.REDACTED}
