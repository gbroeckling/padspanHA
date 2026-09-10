# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
PadSpan HA — Device Registry
===============================
Stable device identity registry. Each physical device gets an immutable
``padspan_id`` (format: ``ps_<12 hex chars>``) that never changes regardless
of BLE MAC rotation, iBeacon UUID changes, or firmware updates.

All other stores (calibration, beacon positions, presence coordinator state)
reference padspan_id instead of volatile BLE addresses.

Storage: ``.storage/padspan_ha.devices``
"""

import secrets
import logging
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

DEVICE_REGISTRY_STORE_KEY = "padspan_ha.devices"
STORE_VERSION = 1

# Ephemeral cache for transient devices (not persisted)
_EPHEMERAL_MAX = 2000
# NOTE: only _EPHEMERAL_MAX (count-based LRU eviction, see resolve_or_create's
# `while len(self._ephemeral) > _EPHEMERAL_MAX: popitem` below) is actually
# wired up. This TTL constant is not read anywhere in this file — a
# time-based eviction was evidently intended but never implemented, so an
# ephemeral entry can currently only age out by being pushed out of the LRU
# by newer ones, never by wall-clock time alone.
_EPHEMERAL_TTL_S = 3600  # 1 hour


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _gen_padspan_id() -> str:
    """Generate a stable padspan device ID: ps_ + 12 hex chars."""
    return f"ps_{secrets.token_hex(6)}"


def _normalize_key(key: str) -> str:
    """Normalize a volatile key for index lookup."""
    k = str(key or "").strip()
    # MAC addresses: uppercase
    if len(k) == 17 and k.count(":") == 5:
        return k.upper()
    # ble: prefix — index both with and without
    if k.startswith("ble:"):
        return k[4:].upper() if len(k) > 4 and k[4:].count(":") == 5 else k
    return k


class DeviceRegistry:
    """Stable device identity registry for PadSpan HA.

    Each physical device gets a unique, immutable ``padspan_id``.
    Volatile identifiers (BLE MAC, iBeacon UUID, canonical_id, entity_id)
    are linked to the padspan_id through an identity index.

    The ``resolve()`` method is O(1) — safe for the 10s poll loop.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store(hass, STORE_VERSION, DEVICE_REGISTRY_STORE_KEY)
        self._devices: dict[str, dict[str, Any]] = {}  # padspan_id → device record
        self._index: dict[str, str] = {}  # normalized volatile key → padspan_id
        # Ephemeral LRU for transient devices (not persisted)
        self._ephemeral: OrderedDict[str, str] = OrderedDict()  # volatile_key → padspan_id
        self._dirty = False

    async def async_load(self) -> None:
        """Load from disk and rebuild the in-memory index."""
        loaded = await self._store.async_load()
        if isinstance(loaded, dict) and "devices" in loaded:
            self._devices = loaded.get("devices") or {}
        else:
            self._devices = {}
        self._rebuild_index()
        _LOGGER.debug("DeviceRegistry loaded: %d devices, %d index entries",
                      len(self._devices), len(self._index))

    def _rebuild_index(self) -> None:
        """Rebuild the volatile-key → padspan_id index from device records."""
        self._index.clear()
        for pid, dev in self._devices.items():
            if not isinstance(dev, dict):
                continue
            for ident in (dev.get("identities") or []):
                if not isinstance(ident, dict):
                    continue
                val = ident.get("value", "")
                if val:
                    nk = _normalize_key(val)
                    self._index[nk] = pid
                    # Also index with ble: prefix stripped and added
                    if nk.count(":") == 5 and len(nk) == 17:
                        self._index[f"ble:{nk}"] = pid
                    if val != nk:
                        self._index[val] = pid

    async def _async_save(self) -> None:
        """Persist devices to disk."""
        await self._store.async_save({"version": STORE_VERSION, "devices": self._devices})
        self._dirty = False

    # ── Resolution (hot path — called every 10s poll) ─────────────────────

    def resolve(self, volatile_key: str) -> str | None:
        """Return padspan_id for any volatile key, or None.

        O(1) lookup — safe for the poll loop.
        """
        nk = _normalize_key(volatile_key)
        pid = self._index.get(nk)
        if pid:
            return pid
        # Also try with ble: prefix
        pid = self._index.get(f"ble:{nk}")
        if pid:
            return pid
        # Try the raw key
        pid = self._index.get(volatile_key)
        if pid:
            return pid
        # Check ephemeral cache
        pid = self._ephemeral.get(nk)
        if pid:
            self._ephemeral.move_to_end(nk)
            return pid
        return None

    def resolve_or_create(self, volatile_key: str, kind: str = "mac",
                          meta: dict | None = None, persist: bool = False) -> str:
        """Resolve a volatile key, or create a new device.

        By default, new devices go to the ephemeral cache (not persisted).
        Set persist=True to write to persistent storage immediately
        (used when labeling or referencing from another store).
        """
        pid = self.resolve(volatile_key)
        if pid:
            return pid

        # Create new padspan_id
        pid = _gen_padspan_id()
        while pid in self._devices:
            pid = _gen_padspan_id()

        nk = _normalize_key(volatile_key)

        if persist:
            self._devices[pid] = {
                "padspan_id": pid,
                "created_at": _now_iso(),
                "label": None,
                "labeled_at": None,
                "device_type": "unknown",
                "identities": [{"kind": kind, "value": volatile_key}],
                "merged_from": [],
                "meta": meta or {},
            }
            self._index[nk] = pid
            self._index[volatile_key] = pid
            if nk.count(":") == 5 and len(nk) == 17:
                self._index[f"ble:{nk}"] = pid
            self._dirty = True
        else:
            # Ephemeral — not saved to disk
            self._ephemeral[nk] = pid
            self._ephemeral[volatile_key] = pid
            # Evict oldest if over limit
            while len(self._ephemeral) > _EPHEMERAL_MAX:
                self._ephemeral.popitem(last=False)

        return pid

    def _promote_ephemeral(self, volatile_key: str) -> str | None:
        """Promote an ephemeral device to persistent storage.

        Returns padspan_id if promoted, None if not found in ephemeral.
        """
        nk = _normalize_key(volatile_key)
        pid = self._ephemeral.get(nk) or self._ephemeral.get(volatile_key)
        if not pid:
            return None
        if pid in self._devices:
            return pid  # already persistent

        # Create persistent record
        self._devices[pid] = {
            "padspan_id": pid,
            "created_at": _now_iso(),
            "label": None,
            "labeled_at": None,
            "device_type": "unknown",
            "identities": [{"kind": "mac", "value": volatile_key}],
            "merged_from": [],
            "meta": {},
        }
        self._index[nk] = pid
        self._index[volatile_key] = pid
        if nk.count(":") == 5 and len(nk) == 17:
            self._index[f"ble:{nk}"] = pid
        self._dirty = True

        # Clean from ephemeral
        self._ephemeral.pop(nk, None)
        self._ephemeral.pop(volatile_key, None)
        return pid

    # ── Device CRUD ───────────────────────────────────────────────────────

    def get(self, padspan_id: str) -> dict | None:
        """Get full device record by padspan_id."""
        return self._devices.get(padspan_id)

    def get_label(self, padspan_id: str) -> str | None:
        """Get label for a device, or None."""
        dev = self._devices.get(padspan_id)
        return dev.get("label") if dev else None

    def get_label_by_key(self, volatile_key: str) -> str | None:
        """Convenience: resolve volatile key then get label."""
        pid = self.resolve(volatile_key)
        return self.get_label(pid) if pid else None

    async def async_set_label(self, padspan_id: str, label: str) -> None:
        """Set a device's label. Promotes from ephemeral if needed."""
        dev = self._devices.get(padspan_id)
        if not dev:
            # Try promoting from ephemeral
            # (the padspan_id might be in ephemeral — search by pid)
            for k, p in list(self._ephemeral.items()):
                if p == padspan_id:
                    self._promote_ephemeral(k)
                    break
            dev = self._devices.get(padspan_id)
        if not dev:
            return
        dev["label"] = str(label).strip() if label else None
        dev["labeled_at"] = _now_iso() if label else None
        await self._async_save()

    async def async_delete_label(self, padspan_id: str) -> None:
        """Remove a device's label."""
        dev = self._devices.get(padspan_id)
        if dev:
            dev["label"] = None
            dev["labeled_at"] = None
            await self._async_save()

    async def async_add_identity(self, padspan_id: str, kind: str, value: str) -> None:
        """Link an additional volatile key to an existing device."""
        dev = self._devices.get(padspan_id)
        if not dev:
            return
        # Check if this identity is already on another device
        existing_pid = self.resolve(value)
        if existing_pid and existing_pid != padspan_id:
            _LOGGER.warning("Identity %s already belongs to %s, not adding to %s",
                            value, existing_pid, padspan_id)
            return
        # Add if not already present
        idents = dev.setdefault("identities", [])
        if not any(i.get("value") == value for i in idents):
            idents.append({"kind": kind, "value": value})
            nk = _normalize_key(value)
            self._index[nk] = padspan_id
            self._index[value] = padspan_id
            if nk.count(":") == 5 and len(nk) == 17:
                self._index[f"ble:{nk}"] = padspan_id
            await self._async_save()

    async def async_merge(self, keep_id: str, absorb_id: str) -> bool:
        """Merge two devices. All identities from absorb_id move to keep_id.

        absorb_id is removed from the registry. Its padspan_id is recorded
        in keep_id's merged_from list.
        """
        keep = self._devices.get(keep_id)
        absorb = self._devices.get(absorb_id)
        if not keep or not absorb:
            return False

        # Move identities
        for ident in (absorb.get("identities") or []):
            if not any(i.get("value") == ident.get("value") for i in keep.get("identities", [])):
                keep.setdefault("identities", []).append(ident)

        # Record merge
        keep.setdefault("merged_from", []).append(absorb_id)

        # Transfer label if keep doesn't have one
        if not keep.get("label") and absorb.get("label"):
            keep["label"] = absorb["label"]
            keep["labeled_at"] = absorb.get("labeled_at")

        # Remove absorbed device
        del self._devices[absorb_id]

        # Rebuild index
        self._rebuild_index()
        await self._async_save()
        return True

    async def async_delete(self, padspan_id: str) -> None:
        """Delete a device entirely."""
        self._devices.pop(padspan_id, None)
        self._rebuild_index()
        await self._async_save()

    # ── Bulk queries ──────────────────────────────────────────────────────

    def all_devices(self) -> dict[str, dict]:
        """Return all persistent devices."""
        return dict(self._devices)

    def all_labeled(self) -> dict[str, dict]:
        """Return only devices with labels."""
        return {pid: dev for pid, dev in self._devices.items()
                if isinstance(dev, dict) and dev.get("label")}

    def device_count(self) -> int:
        return len(self._devices)

    def find_by_label(self, label: str) -> str | None:
        """Find padspan_id by exact label match."""
        label = str(label).strip()
        for pid, dev in self._devices.items():
            if isinstance(dev, dict) and dev.get("label") == label:
                return pid
        return None

    # ── Migration ─────────────────────────────────────────────────────────

    async def async_migrate_from_object_store(self, object_store: Any) -> dict[str, int]:
        """One-time migration from ObjectStore to DeviceRegistry.

        Groups entries by label to detect cross-stored duplicates.
        Returns {migrated, merged, skipped}.
        """
        if not object_store:
            return {"migrated": 0, "merged": 0, "skipped": 0}

        all_labels = object_store.all()
        if not all_labels:
            return {"migrated": 0, "merged": 0, "skipped": 0}

        stats = {"migrated": 0, "merged": 0, "skipped": 0}

        # Group by label to detect cross-stored duplicates
        by_label: dict[str, list[tuple[str, dict]]] = {}
        for key, val in all_labels.items():
            if not isinstance(val, dict):
                continue
            # Skip entries already in the device registry (backfill mode)
            if self.resolve(key):
                stats["skipped"] += 1
                continue
            label = val.get("label", "")
            if label:
                by_label.setdefault(label, []).append((key, val))
            else:
                # No label — create individual device
                pid = _gen_padspan_id()
                kind = "ibeacon" if key.startswith("ibeacon:") else "irk" if key.startswith("irk:") else "mac"
                self._devices[pid] = {
                    "padspan_id": pid,
                    "created_at": val.get("tagged_at", _now_iso()),
                    "label": None,
                    "labeled_at": None,
                    "device_type": "unknown",
                    "identities": [{"kind": kind, "value": key}],
                    "merged_from": [],
                    "meta": {},
                }
                stats["migrated"] += 1

        # For each label group, create one device with all identities
        # (or link to existing device if label already in registry)
        for label, entries in by_label.items():
            # Check if a device with this label already exists
            existing_pid = self.find_by_label(label)
            if existing_pid:
                # Backfill: add new identities to existing device
                for key, val in entries:
                    kind = "ibeacon" if key.startswith("ibeacon:") else "irk" if key.startswith("irk:") else "entity" if key.startswith("entity:") else "mac"
                    idents = self._devices[existing_pid].setdefault("identities", [])
                    if not any(i.get("value") == key for i in idents):
                        idents.append({"kind": kind, "value": key})
                        nk = _normalize_key(key)
                        self._index[nk] = existing_pid
                        self._index[key] = existing_pid
                stats["merged"] += len(entries)
                continue

            pid = _gen_padspan_id()
            while pid in self._devices:
                pid = _gen_padspan_id()
            identities = []
            created_at = None
            for key, val in entries:
                kind = "ibeacon" if key.startswith("ibeacon:") else "irk" if key.startswith("irk:") else "entity" if key.startswith("entity:") else "mac"
                identities.append({"kind": kind, "value": key})
                ts = val.get("tagged_at")
                if ts and (not created_at or ts < created_at):
                    created_at = ts

            self._devices[pid] = {
                "padspan_id": pid,
                "created_at": created_at or _now_iso(),
                "label": label,
                "labeled_at": created_at or _now_iso(),
                "device_type": "unknown",
                "identities": identities,
                "merged_from": [],
                "meta": {},
            }
            stats["migrated"] += 1
            if len(entries) > 1:
                stats["merged"] += len(entries) - 1

        self._rebuild_index()
        await self._async_save()
        _LOGGER.info("DeviceRegistry migration: %d devices, %d merged, %d skipped",
                      stats["migrated"], stats["merged"], stats["skipped"])
        return stats

    async def async_flush_dirty(self) -> None:
        """Save if there are pending changes."""
        if self._dirty:
            await self._async_save()
