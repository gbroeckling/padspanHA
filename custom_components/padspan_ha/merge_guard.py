# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Which objects the guessing merges must leave alone.

The object list merges plain BLE objects on a guess: same name, same maker
data, same scanners (snapshot_builder, D3 to D7). A wrong guess on something
someone looks after does real harm: its signal mixes into new calibration
points, it takes another device's label, and an absorbed object is deleted from
history. So nothing labelled, saved, pinned, followed, used in calibration or
linked to a Home Assistant device or entity is merged by a guess, in either
pass: a followed device keeps its own row every poll. Labels attach after the
first pass, so the stores are asked, not just the object.

Merges that go by an address or a broadcast ID, not a guess (an entity and its
own address, one Eddystone ID, one label on one address), aren't asked.
"""

from __future__ import annotations

from typing import Any

from .const import DATA_CALIBRATION, DATA_DEVICE_REGISTRY, DATA_MODEL, DATA_OBJECTS, DATA_SETTINGS, DOMAIN


def _norm(key: Any) -> str:
    k = str(key or "").strip().upper()
    return k[4:] if k.startswith("BLE:") else k


class MergeGuard:
    """guard(obj) is True for an object the guessing merges must leave alone.

    One per build. Until PadSpan's stores have loaded it can't tell, so it
    guards everything: a merge held back a moment does no harm.
    """

    def __init__(self, hass: Any) -> None:
        dom = hass.data.get(DOMAIN, {})
        self._labels = dom.get(DATA_OBJECTS)
        self._registry = dom.get(DATA_DEVICE_REGISTRY)
        self._calibration = dom.get(DATA_CALIBRATION)
        self._model = dom.get(DATA_MODEL)
        self._settings = dom.get(DATA_SETTINGS)
        self._ready = None not in (self._labels, self._registry, self._calibration, self._model)
        self._kept: set[str] | None = None

    def _kept_keys(self) -> set[str]:
        """Every key a pin or a calibration point is stored under, and every one
        being followed. Built when the first merge of a build asks, so a house
        with none pays nothing."""
        if self._kept is None:
            kept = {_norm(k) for k in self._model.beacon_positions_m()}
            kept |= {_norm(k) for k in ((self._settings.data if self._settings else {}).get("followed_addrs") or [])}
            for point in (self._calibration.data or {}).get("points") or []:
                if isinstance(point, dict) and point.get("device_id"):
                    kept.add(_norm(point["device_id"]))
            self._kept = kept
        return self._kept

    def __call__(self, obj: dict[str, Any]) -> bool:
        if not self._ready:
            return True
        if obj.get("user_label") or obj.get("identified") or obj.get("device") or obj.get("linked_entities"):
            return True
        kept = self._kept_keys()
        for key in (obj.get("key"), obj.get("address"), obj.get("canonical_id"), *(obj.get("all_addresses") or ())):
            if not key:
                continue
            if _norm(key) in kept:
                return True
            entry = self._labels.get(key)
            if entry and entry.get("label"):
                return True
            pid = self._registry.resolve(str(key))
            if pid and self._registry.get(pid):
                return True
        return False
