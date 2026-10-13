# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Revert migration removed every pin whose label matched a migrated one, so
the target map's own "Kitchen" receiver went with the "Kitchen" that came
over (the migration had told them apart by key and skipped none)."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha.const import DATA_MAPS, DOMAIN
from custom_components.padspan_ha.ws_maps import ws_maps_delete_migrate

_MAPS_JS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
            / "www" / "padspan-ha" / "views" / "maps.js")
_NODE = shutil.which("node")


class _Maps:
    def __init__(self, maps: dict) -> None:
        self.maps = maps

    def get_map(self, mid):
        return self.maps.get(mid)

    async def async_update_map(self, mid, **kw):
        self.maps[mid].update(kw)

    async def async_delete_map(self, mid):
        self.maps.pop(mid, None)


@pytest.mark.asyncio
async def test_the_migration_reports_what_it_moved_by_key():
    ms = _Maps({
        "src": {"id": "src", "room_bounds": {},
                "receivers": [{"source": "esp_b", "label": "Kitchen", "x": 0.2, "y": 0.2},
                              {"label": "Hall", "x": 0.5, "y": 0.5}],
                "beacons": [{"key": "bk1", "label": "Tag", "x": 0.3, "y": 0.3}]},
        "tgt": {"id": "tgt", "room_bounds": {}, "beacons": [],
                "receivers": [{"source": "esp_a", "label": "Kitchen", "x": 0.7, "y": 0.7}]},
    })
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MAPS: ms}}
    conn = MagicMock()
    await ws_maps_delete_migrate(hass, conn, {"id": 1, "map_id": "src", "target_map_id": "tgt"})
    mig = conn.send_result.call_args[0][1]["migrated"]
    assert mig["receivers"] == ["Kitchen", "Hall"]
    assert mig["receiver_keys"] == ["esp_b", ""]
    assert mig["beacon_keys"] == ["bk1"]


def _strip(items, key, label, labels, keys):
    if _NODE is None:
        pytest.skip("node is not installed")
    src = _MAPS_JS.read_text(encoding="utf-8")
    fn = re.search(r"const _strip = (\(items.*?\n {10}\});", src, re.S).group(1)
    js = (f"const _strip = {fn};\nconsole.log(JSON.stringify(_strip({json.dumps(items)}, "
          f"{key}, {label}, {json.dumps(labels)}, {json.dumps(keys)})));")
    res = subprocess.run([_NODE, "-e", js], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


_RX_KEY = "r => r.source || r.id || ''"
_RX_LABEL = "r => r.label || r.source || r.id || ''"


def test_revert_keeps_the_targets_own_pin_of_the_same_name():
    target = [{"source": "esp_a", "label": "Kitchen"},          # the target's own
              {"source": "esp_b", "label": "Kitchen"},          # came over
              {"label": "Hall"}]                                # came over, no key
    kept = _strip(target, _RX_KEY, _RX_LABEL, ["Kitchen", "Hall"], ["esp_b", ""])
    assert kept == [{"source": "esp_a", "label": "Kitchen"}]


def test_revert_from_a_backend_without_keys_still_strips_by_label():
    kept = _strip([{"source": "esp_b", "label": "Kitchen"}, {"source": "x", "label": "Den"}],
                  _RX_KEY, _RX_LABEL, ["Kitchen"], None)
    assert kept == [{"source": "x", "label": "Den"}]
