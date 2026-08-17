# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
"""Websocket handlers for object labels and object history.

Split out of websocket.py; registration stays there.
"""

from __future__ import annotations

import logging
from typing import Any
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant
from .const import (
    DOMAIN,
    DATA_SETTINGS,
    DATA_OBJECTS,
    DATA_OBJECT_HISTORY,
    OBJECT_HISTORY_STORE_KEY,
    DATA_DEVICE_REGISTRY,
)
from .ws_common import _DEFAULT_IBEACON_UUIDS, _invalidate_snapshot_cache

_LOGGER = logging.getLogger(__name__)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_set",
        "address": str,
        "label": str,
    }
)
@websocket_api.async_response
async def ws_object_label_set(hass: HomeAssistant, connection, msg) -> None:
    """Assign a user label to a BLE object (MAC, ibeacon key, or canonical_id).

    Labels are the primary way users "identify" BLE objects.  A labelled object
    gets "identified: true", which keeps it in history forever and surfaces it
    prominently in the UI.

    Key behavior:
      - Rotating MACs (RPAs) are resolved to a stable canonical_id via IRK so
        the label survives address rotation.
      - The label is cross-stored under ALL stable identity keys for the same
        physical device (canonical_id, iBeacon key, static MAC).  This prevents
        the device from splitting into labelled + unlabelled halves when one
        identity is seen in a snapshot but not another.
    """
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip()
    # Only uppercase plain MAC addresses; leave ibeacon/irk keys as-is
    if len(addr) == 17 and addr.count(":") == 5:
        addr = addr.upper()
    label = str(msg.get("label") or "").strip()[:48]
    if not addr:
        connection.send_error(msg["id"], "invalid_address", "Address is required")
        return
    if not label:
        connection.send_error(msg["id"], "invalid_label", "Label is required")
        return

    # If the address is a rotating MAC (RPA), resolve to canonical_id so the
    # label survives BLE address rotation (iPhones, Android phones).
    store_addr = addr
    if len(addr) == 17 and addr.count(":") == 5 and not addr.startswith("irk:"):
        try:
            from .private_ble_resolver import get_resolver  # noqa: PLC0415
            resolver = await get_resolver(hass)
            resolved = resolver.resolve_address(addr)
            if resolved and resolved.get("canonical_id"):
                store_addr = resolved["canonical_id"]
                _LOGGER.debug(
                    "object_label_set: resolved rotating MAC %s → %s",
                    addr, store_addr,
                )
        except Exception:
            pass

    await obj_store.async_set(store_addr, label)

    # ── Cross-store label under ALL stable identities ─────────────────
    # A device can broadcast as ble (MAC), ibeacon (key), private_ble
    # (canonical_id), or entity.  If we only store the label under one
    # key, the device splits into labelled + unlabelled when the merge
    # doesn't fire in a particular snapshot cycle.  Fix: find the device
    # in the object history cache and store the label under every key.
    _cross_stored: list[str] = [store_addr]
    try:
        _dom = hass.data.get(DOMAIN, {})
        _cache = _dom.get(DATA_OBJECT_HISTORY) or {}

        # Find the object in cache that matches the address we just labelled
        _target = _cache.get(addr) or _cache.get(store_addr)

        # If not found by direct key, search by exact key/canonical matches
        # FIRST across the whole cache, then fall back to all_addresses.
        # all_addresses can over-claim (merged-era sibling entries listed each
        # other's MACs) — an exact match must always win over a claimed MAC.
        if not _target:
            addr_upper = addr.upper()
            store_upper = store_addr.upper()
            for _key, _obj in _cache.items():
                if _key.upper() == addr_upper or _key.upper() == store_upper:
                    _target = _obj
                    break
                if _obj.get("canonical_id") == store_addr or _obj.get("canonical_id") == addr:
                    _target = _obj
                    break
        if not _target:
            addr_upper = addr.upper()
            for _key, _obj in _cache.items():
                _all = _obj.get("all_addresses") or []
                if any(str(a).upper() == addr_upper for a in _all):
                    _target = _obj
                    break

        if _target:
            # Collect all stable keys for this device
            _keys_to_label: set[str] = set()

            # canonical_id (private_ble identity)
            _cid = _target.get("canonical_id")
            if _cid:
                _keys_to_label.add(_cid)

            # iBeacon key
            _ib_key = _target.get("key", "")
            if _ib_key and _ib_key.startswith("ibeacon:"):
                _keys_to_label.add(_ib_key)
                _keys_to_label.add(_ib_key.upper())

            # Build ibeacon key from metadata if available.
            # NEVER for split objects or factory-default UUIDs: the unsplit
            # group key is shared by every beacon in a multi-pack, so storing
            # a label under it stamps the whole pack with one beacon's name
            # (and resurrects the merged-ghost problem on every rename).
            _t_key = str(_target.get("key") or "")
            _t_is_split = _t_key.startswith("ibeacon:") and len(_t_key.split(":")) > 4
            _ib_uuid = _target.get("ibeacon_uuid")
            _uuid_is_default = str(_ib_uuid or "").lower() in _DEFAULT_IBEACON_UUIDS
            if _ib_uuid is not None and not _t_is_split and not _uuid_is_default:
                _ib_major = _target.get("ibeacon_major", 0)
                _ib_minor = _target.get("ibeacon_minor", 0)
                _ib_k = f"ibeacon:{_ib_uuid}:{_ib_major}:{_ib_minor}"
                _keys_to_label.add(_ib_k)
                _keys_to_label.add(_ib_k.upper())

            # Static MAC address (non-rotating — starts with non-random prefix)
            _obj_addr = _target.get("address", "")
            if _obj_addr and len(_obj_addr) == 17 and _obj_addr.count(":") == 5:
                # Only store under MAC if it's not a rotating random address
                _first_byte = int(_obj_addr[:2], 16) if _obj_addr[:2].replace(":", "") else 0
                if not (_first_byte & 0x02):  # bit 1 clear = globally unique (not random)
                    _keys_to_label.add(_obj_addr.upper())

            # Remove keys we already stored under
            _keys_to_label.discard(store_addr)
            _keys_to_label.discard(store_addr.upper() if store_addr == store_addr.upper() else store_addr)

            for _xk in _keys_to_label:
                if _xk and not obj_store.get(_xk):
                    await obj_store.async_set(_xk, label)
                    _cross_stored.append(_xk)

            if len(_cross_stored) > 1:
                _LOGGER.info(
                    "object_label_set: cross-stored '%s' under %d keys: %s",
                    label, len(_cross_stored), _cross_stored,
                )
    except Exception as _xs_err:
        _LOGGER.debug("object_label_set cross-store: %s", _xs_err)

    # ── DeviceRegistry: persist label on stable padspan_id ──────────────
    _padspan_id = None
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            # Resolve or create persistent device entry
            _kind = "ibeacon" if store_addr.startswith("ibeacon:") else "irk" if store_addr.startswith("irk:") else "mac"
            _padspan_id = _dev_reg.resolve_or_create(store_addr, kind=_kind, persist=True)

            # Link all known identities to this padspan_id
            if addr != store_addr:
                _ak = "ibeacon" if addr.startswith("ibeacon:") else "irk" if addr.startswith("irk:") else "mac"
                await _dev_reg.async_add_identity(_padspan_id, _ak, addr)
            for _xk in _cross_stored:
                if _xk != store_addr and _xk != addr:
                    _xkind = "ibeacon" if _xk.startswith("ibeacon:") else "irk" if _xk.startswith("irk:") else "mac"
                    await _dev_reg.async_add_identity(_padspan_id, _xkind, _xk)

            # Set the label on the padspan_id
            await _dev_reg.async_set_label(_padspan_id, label)
            _LOGGER.debug("DeviceRegistry: labeled %s as '%s' (padspan_id=%s)", store_addr, label, _padspan_id)
    except Exception as _dr_err:
        _LOGGER.debug("DeviceRegistry label_set: %s", _dr_err)

    # Warn when another DEVICE already uses this label.  Labels drive HA
    # entity/device naming downstream, so two devices sharing a label end
    # up merged into one HA device with doubled sensors.
    _dup_keys: list[str] = []
    try:
        _cross_set = {str(k).upper() for k in _cross_stored}
        for _ok, _oe in (obj_store.all() or {}).items():
            if str(_oe.get("label") or "").strip() == label and str(_ok).upper() not in _cross_set:
                _dup_keys.append(_ok)
    except Exception:
        pass

    _result: dict[str, Any] = {
        "ok": True, "address": store_addr, "label": label,
        "cross_stored": _cross_stored,
        "padspan_id": _padspan_id,
    }
    if _dup_keys:
        _result["duplicate_label_keys"] = _dup_keys
        _result["warning"] = (
            f"Label '{label}' is already used by {len(_dup_keys)} other device(s). "
            "Devices sharing a label merge into one HA device — use unique names."
        )
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], _result)


@websocket_api.websocket_command(
    {
        "type": "padspan_ha/object_label_delete",
        "address": str,
    }
)
@websocket_api.async_response
async def ws_object_label_delete(hass: HomeAssistant, connection, msg) -> None:
    """Remove the user label for a BLE MAC address."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    if not obj_store:
        connection.send_error(msg["id"], "no_object_store", "Object store not initialized")
        return
    addr = str(msg.get("address") or "").strip()
    # Only uppercase plain MAC addresses; leave ibeacon/irk keys as-is
    if len(addr) == 17 and addr.count(":") == 5:
        addr = addr.upper()
    # Resolve rotating MAC → canonical_id (same as label_set)
    if addr and len(addr) == 17 and addr.count(":") == 5 and not addr.startswith("irk:"):
        try:
            from .private_ble_resolver import get_resolver  # noqa: PLC0415
            resolver = await get_resolver(hass)
            resolved = resolver.resolve_address(addr)
            if resolved and resolved.get("canonical_id"):
                addr = resolved["canonical_id"]
        except Exception:
            pass
    if addr:
        # Get the label before deleting so we can find cross-stored copies
        _entry = obj_store.get(addr)
        _del_label = (_entry.get("label", "") if _entry else "").strip()
        await obj_store.async_delete(addr)

        # Also delete cross-stored copies under other identity keys
        _cross_deleted: list[str] = [addr]
        if _del_label:
            try:
                _all_labels = obj_store.all()
                for _key, _val in list(_all_labels.items()):
                    if _key == addr.upper() or _key == addr:
                        continue
                    if _val.get("label", "").strip() == _del_label:
                        # Verify it belongs to the same device by checking
                        # the object history cache for cross-references
                        _dom = hass.data.get(DOMAIN, {})
                        _cache = _dom.get(DATA_OBJECT_HISTORY) or {}
                        _obj_for_key = _cache.get(_key)
                        _obj_for_addr = _cache.get(addr)
                        # If both point to the same canonical_id or same
                        # ibeacon key, they're the same device
                        _same = False
                        if _obj_for_key and _obj_for_addr:
                            cid1 = _obj_for_key.get("canonical_id")
                            cid2 = _obj_for_addr.get("canonical_id")
                            if cid1 and cid2 and cid1 == cid2:
                                _same = True
                            k1 = _obj_for_key.get("key", "")
                            k2 = _obj_for_addr.get("key", "")
                            if k1 and k2 and k1 == k2:
                                _same = True
                        # Also same if one key is an ibeacon variant of the other
                        if _key.upper() == addr.upper():
                            _same = True
                        if _key.startswith("ibeacon:") or _key.startswith("IBEACON:"):
                            if addr.startswith("ibeacon:") or addr.startswith("IBEACON:"):
                                if _key.lower() == addr.lower():
                                    _same = True
                        if _same:
                            await obj_store.async_delete(_key)
                            _cross_deleted.append(_key)
            except Exception as _xd_err:
                _LOGGER.debug("object_label_delete cross-delete: %s", _xd_err)

        # Clear identified/user_label from object history cache so the ghost
        # doesn't linger indefinitely after label deletion
        try:
            _dom = hass.data.get(DOMAIN, {})
            _hist_cache = _dom.get(DATA_OBJECT_HISTORY) or {}
            for _del_key in _cross_deleted:
                _hobj = _hist_cache.get(_del_key)
                if _hobj:
                    _hobj.pop("identified", None)
                    _hobj.pop("user_label", None)
            # Also scan cache for any entry with the deleted label
            if _del_label:
                for _hk, _hv in _hist_cache.items():
                    if _hv.get("user_label") == _del_label:
                        _hv.pop("identified", None)
                        _hv.pop("user_label", None)
        except Exception:
            pass

    # ── DeviceRegistry: clear label on stable padspan_id ──────────────
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg and addr:
            _pid = _dev_reg.resolve(addr)
            if _pid:
                await _dev_reg.async_delete_label(_pid)
                _LOGGER.debug("DeviceRegistry: cleared label for %s (padspan_id=%s)", addr, _pid)
    except Exception as _dr_err:
        _LOGGER.debug("DeviceRegistry label_delete: %s", _dr_err)

    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"ok": True, "address": addr})


@websocket_api.websocket_command({"type": "padspan_ha/object_label_list"})
@websocket_api.async_response
async def ws_object_label_list(hass: HomeAssistant, connection, msg) -> None:
    """Return all stored object labels from ObjectStore + DeviceRegistry."""
    obj_store = hass.data.get(DOMAIN, {}).get(DATA_OBJECTS)
    labels = obj_store.all() if obj_store else {}
    # Enrich with DeviceRegistry data
    _reg_labels = {}
    try:
        from .const import DATA_DEVICE_REGISTRY
        _dev_reg = hass.data.get(DOMAIN, {}).get(DATA_DEVICE_REGISTRY)
        if _dev_reg:
            for pid, dev in _dev_reg.all_labeled().items():
                _reg_labels[pid] = {
                    "label": dev.get("label", ""),
                    "padspan_id": pid,
                    "identities": len(dev.get("identities", [])),
                    "source": "device_registry",
                }
    except Exception:
        pass
    connection.send_result(msg["id"], {
        "labels": labels,
        "registry_labels": _reg_labels,
    })


@websocket_api.websocket_command({"type": "padspan_ha/objects_clear_history"})
@websocket_api.async_response
async def ws_objects_clear_history(hass: HomeAssistant, connection, msg) -> None:
    """Purge untagged/unfollowed objects from the 7-day history cache.

    WHY: Over time the cache accumulates hundreds of transient neighbour
    devices.  This lets the user declutter without losing their labelled
    or followed devices.  Tagged and followed objects are always preserved.
    Forces an immediate disk save so the purge survives restarts.
    """
    _dom = hass.data.get(DOMAIN, {})
    _cache: dict | None = _dom.get(DATA_OBJECT_HISTORY)
    if not _cache:
        connection.send_result(msg["id"], {"ok": True, "removed": 0, "kept": 0})
        return

    obj_store = _dom.get(DATA_OBJECTS)
    labelled_keys: set[str] = set()
    if obj_store:
        for addr, entry in (obj_store.all() or {}).items():
            if entry.get("label"):
                labelled_keys.add(addr)

    # Also preserve followed objects
    followed_set: set[str] = set()
    st = _dom.get(DATA_SETTINGS)
    if st:
        for fa in (st.data.get("followed_addrs") or []):
            followed_set.add(str(fa).upper())

    removed = 0
    kept = 0
    for key in list(_cache.keys()):
        cached = _cache[key]
        has_label = cached.get("user_label") or key in labelled_keys
        addr = (cached.get("address") or "").upper()
        if addr and addr in labelled_keys:
            has_label = True
        # Also keep if followed
        if not has_label:
            ck = key.upper()
            if ck in followed_set or addr in followed_set:
                has_label = True
        if has_label:
            kept += 1
        else:
            del _cache[key]
            removed += 1

    # Force immediate save
    from homeassistant.helpers.storage import Store as _Store
    _hist_store = _dom.get("_obj_hist_store")
    if _hist_store is None:
        _hist_store = _Store(hass, 1, OBJECT_HISTORY_STORE_KEY)
        _dom["_obj_hist_store"] = _hist_store
    _save_data = {}
    for _k, _v in _cache.items():
        _sv = dict(_v)
        _sv.pop("_smoothed", None)
        _sv.pop("_stale", None)
        _save_data[_k] = _sv
    await _hist_store.async_save(_save_data)

    _LOGGER.info("Object history cleared: removed %d, kept %d tagged", removed, kept)
    _invalidate_snapshot_cache(hass)
    connection.send_result(msg["id"], {"ok": True, "removed": removed, "kept": kept})
