# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
# See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
from __future__ import annotations

"""
WLED proxy — the Atlas WLED card's Advanced tab talks to the device through
here (Garry, 2026-09-23: "absolute best in class gui for working on wled
configuration ... every facet of WLED operation and setup, as complete as the
webpage, but more intuitive ... include teaming with other wled devices").

WHY A PROXY. The browser cannot reach a WLED unit itself: Home Assistant is
usually served over HTTPS (local TLS, Nabu Casa, the Companion app), where
http:// fetches and ws:// sockets to a LAN address are blocked as mixed
content, and off the LAN the address is unreachable anyway. PadSpan's backend
runs inside HA on the LAN, so the card asks it, over the same websocket it
uses for everything else. The existing Controls tab never needed this: it
drives HA's own light services, and HA's WLED integration talks to the unit.
The Advanced tab needs what that integration does not expose — segment
bounds, the LED outputs, presets.json, the full config, sync groups.

SECURITY — THE PANEL IS NOT ADMIN-ONLY (panel.py require_admin=False):
- The device address is NEVER taken from the browser. It is resolved here,
  from HA's own WLED config entry, for an entity/device that belongs to it.
  A host from the client would let any HA user point this backend at any
  address on the LAN (SSRF).
- Reads go only to an allowlist of paths.
- Live, unsaved state changes (segments, effects, colours, identify, test
  patterns) are open to any user with the licence — HA already lets them
  control the light. Anything that persists or disrupts is admin-only:
  saving/deleting presets, the boot preset, config writes, reboot.
- Always refused: the legacy /win API and a "win" key (Gyver-class forks
  wedge their renderer on it — see Garry's WLED fleet notes), /update and
  /updatebootloader (no firmware from here: much of the fleet runs custom
  builds that a stock release would wipe), /reset, /edit.

SAFETY FOR CONFIG WRITES: every /json/cfg write backs up cfg.json and
presets.json first, refuses if the device's config changed since the card
read it (base_hash), never sends hw.com (WLED appends to it rather than
replacing it), and returns the config before and after.

Tier: PadSpan Bright Pro or PadSpan Pro ("bright"), like the rest of WLED in
the Atlas.
"""

import asyncio
import hashlib
import json
import logging
import re
import time
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .ws_common import _tier_at_least

_LOGGER = logging.getLogger(__name__)

WLED_DOMAIN = "wled"
TIER = "bright"
TIER_MSG = "The WLED Advanced tab needs a PadSpan Bright Pro or PadSpan Pro key."

GET_TIMEOUT_S = 8
POST_TIMEOUT_S = 12
BACKUPS_KEPT = 20
# JSON_BUFFER_SIZE on the smallest target (ESP8266). A bigger body is
# refused by the device mid-parse; refusing it here gives a real message.
MAX_BODY_ESP8266 = 10240
MAX_BODY_ESP32 = 24576

# Exact read paths. Anything else is refused.
_GET_PATHS = re.compile(
    r"^(json|json/(state|info|si|eff|fxdata|pal|nodes|cfg|pins|net)"
    r"|json/palx(\?page=\d{1,3})?"
    r"|presets\.json|cfg\.json|palette\d{1,3}\.json|ledmap\d{0,2}\.json)$"
)
# Keys in a /json/state body that persist or disrupt: admin only.
_ADMIN_STATE_KEYS = frozenset({"psave", "pdel", "bootps", "rb", "rmcpal", "wifi"})
# Never forwarded, whoever asks.
_FORBIDDEN_STATE_KEYS = frozenset({"win"})
# Never sent through /json/cfg: WLED APPENDS hw.com instead of replacing it.
_FORBIDDEN_CFG_PATHS = (("hw", "com"),)


# ── Pure checks (unit tested) ────────────────────────────────────────────────


def check_get_path(path: str) -> str | None:
    """None if `path` may be read, else the reason."""
    if not isinstance(path, str) or not _GET_PATHS.match(path):
        return f"path not allowed: {path!r}"
    return None


def check_state_body(body: Any, is_admin: bool, max_bytes: int = MAX_BODY_ESP8266) -> str | None:
    """None if `body` may be POSTed to /json/state by this user, else why not."""
    if not isinstance(body, dict):
        return "the state body must be a JSON object"
    for key in body:
        if key in _FORBIDDEN_STATE_KEYS:
            return f"'{key}' is never sent (legacy API; custom forks wedge on it)"
        if key in _ADMIN_STATE_KEYS and not is_admin:
            return f"'{key}' changes the device for everyone — an administrator must do it"
    # A playlist is only persistent when saved with psave, which is gated above.
    size = len(json.dumps(body, separators=(",", ":")))
    if size > max_bytes:
        return f"request is {size} bytes; this device accepts at most {max_bytes}"
    return None


def check_cfg_patch(patch: Any, max_bytes: int = MAX_BODY_ESP8266) -> str | None:
    """None if `patch` may be POSTed to /json/cfg, else why not."""
    if not isinstance(patch, dict) or not patch:
        return "the config patch must be a non-empty JSON object"
    for path in _FORBIDDEN_CFG_PATHS:
        node: Any = patch
        for k in path:
            if not isinstance(node, dict) or k not in node:
                node = None
                break
            node = node[k]
        if node is not None:
            return ("hw.com (colour-order overrides) can't be written this way — WLED adds to "
                    "the list instead of replacing it; use the device's LED settings page")
    size = len(json.dumps(patch, separators=(",", ":")))
    if size > max_bytes:
        return f"config patch is {size} bytes; this device accepts at most {max_bytes}"
    return None


def cfg_hash(cfg: Any) -> str:
    """A stable fingerprint of a config, to refuse writes over a changed device."""
    return hashlib.sha256(json.dumps(cfg, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def max_body_for(info: dict | None) -> int:
    arch = str((info or {}).get("arch", "")).lower()
    return MAX_BODY_ESP8266 if "8266" in arch else MAX_BODY_ESP32


# ── Resolving the device, never from the client ──────────────────────────────


def _wled_entries(hass: HomeAssistant) -> dict[str, Any]:
    return {e.entry_id: e for e in hass.config_entries.async_entries(WLED_DOMAIN)}


def resolve_device(hass: HomeAssistant, entity_id: str | None = None,
                   device_id: str | None = None) -> dict[str, Any] | None:
    """{host, device_id, entry_id, name} for an entity or device that belongs
    to HA's WLED integration; None otherwise. The ONLY source of a host."""
    from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415

    if entity_id and not device_id:
        ent = er.async_get(hass).async_get(entity_id)
        if ent is None or not ent.device_id:
            return None
        device_id = ent.device_id
    if not device_id:
        return None
    dev = dr.async_get(hass).async_get(device_id)
    if dev is None:
        return None
    entries = _wled_entries(hass)
    for entry_id in getattr(dev, "config_entries", ()) or ():
        entry = entries.get(entry_id)
        host = entry and (entry.data or {}).get("host")
        if host:
            return {"host": str(host), "device_id": device_id, "entry_id": entry_id,
                    "name": dev.name_by_user or dev.name or str(host)}
    return None


def _target(hass: HomeAssistant, msg: dict) -> dict[str, Any] | None:
    return resolve_device(hass, entity_id=msg.get("entity_id"), device_id=msg.get("device_id"))


def _is_admin(connection) -> bool:
    user = getattr(connection, "user", None)
    return bool(user is None or getattr(user, "is_admin", False))


# ── Transport ────────────────────────────────────────────────────────────────


class WledError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


async def _request(hass: HomeAssistant, host: str, method: str, path: str,
                   body: Any = None, timeout: float = GET_TIMEOUT_S) -> Any:
    import aiohttp  # noqa: PLC0415
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415

    session = async_get_clientsession(hass)
    url = f"http://{host}/{path}"
    try:
        async with session.request(method, url, json=body,
                                   timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            text = await resp.text()
            if resp.status == 401:
                raise WledError("pin_required", "This WLED device has a settings PIN — enter it to continue")
            if resp.status == 503:
                raise WledError("busy", "The device is busy — try again in a moment")
            if resp.status >= 400:
                raise WledError("http_error", f"The device answered HTTP {resp.status}")
    except WledError:
        raise
    except asyncio.TimeoutError as err:
        raise WledError("timeout", f"No answer from {host} within {int(timeout)} s") from err
    except aiohttp.ClientError as err:
        raise WledError("unreachable", f"Can't reach {host}: {err}") from err
    try:
        return json.loads(text) if text.strip() else {}
    except ValueError as err:
        raise WledError("bad_reply", "The device's reply wasn't JSON") from err


async def _upload(hass: HomeAssistant, host: str, filename: str, data: Any, pin: str | None = None) -> None:
    """Multipart upload to /upload (the device's own file endpoint): the only
    way to put a whole presets.json or cfg.json back. cfg.json reboots it."""
    import aiohttp  # noqa: PLC0415
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415

    session = async_get_clientsession(hass)
    if pin:
        # The PIN unlocks the device for 15 minutes (one device-wide flag).
        await _request(hass, host, "POST", "json/state", {"pin": pin}, POST_TIMEOUT_S)
    form = aiohttp.FormData()
    form.add_field("data", json.dumps(data, separators=(",", ":")).encode(), filename=filename,
                   content_type="application/json")
    try:
        async with session.post(f"http://{host}/upload", data=form,
                                timeout=aiohttp.ClientTimeout(total=POST_TIMEOUT_S * 2)) as resp:
            if resp.status == 401:
                raise WledError("pin_required", "This WLED device has a settings PIN — enter it to continue")
            if resp.status >= 400:
                raise WledError("http_error", f"The device refused the upload (HTTP {resp.status})")
    except WledError:
        raise
    except asyncio.TimeoutError as err:
        # cfg.json makes the device reboot mid-reply; that is expected.
        if filename != "cfg.json":
            raise WledError("timeout", f"No answer from {host}") from err
    except aiohttp.ClientError as err:
        if filename != "cfg.json":
            raise WledError("unreachable", f"Can't reach {host}: {err}") from err


def _backup_dir(hass: HomeAssistant, mac: str) -> Path:
    safe = re.sub(r"[^0-9a-fA-F]", "", mac or "") or "unknown"
    return Path(hass.config.path(DOMAIN, "wled_backups", safe.lower()))


def _write_backup_sync(folder: Path, files: dict[str, Any]) -> str:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = folder / stamp
    dest.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (dest / name).write_text(json.dumps(data, indent=1), encoding="utf-8")
    kept = sorted((p for p in folder.iterdir() if p.is_dir()), key=lambda p: p.name)
    for old in kept[:-BACKUPS_KEPT]:
        for f in old.iterdir():
            f.unlink()
        old.rmdir()
    return stamp


def _list_backups_sync(folder: Path) -> list[dict[str, Any]]:
    if not folder.is_dir():
        return []
    out = []
    for p in sorted((p for p in folder.iterdir() if p.is_dir()), key=lambda p: p.name, reverse=True):
        out.append({"id": p.name, "files": sorted(f.name for f in p.iterdir())})
    return out


# ── Websocket commands ───────────────────────────────────────────────────────

_TARGET = {vol.Optional("entity_id"): str, vol.Optional("device_id"): str}


async def _gate(hass: HomeAssistant, connection, msg) -> dict[str, Any] | None:
    """Tier + target resolution shared by every command. Sends the error."""
    if not _tier_at_least(hass, TIER):
        connection.send_error(msg["id"], "bright_required", TIER_MSG)
        return None
    tgt = _target(hass, msg)
    if tgt is None:
        connection.send_error(msg["id"], "not_wled",
                              "That light isn't a WLED device in Home Assistant's WLED integration")
        return None
    return tgt


@websocket_api.websocket_command({"type": "padspan_ha/wled_devices"})
@websocket_api.async_response
async def ws_wled_devices(hass: HomeAssistant, connection, msg) -> None:
    """Every WLED device HA knows, with its light entities — for teaming."""
    if not _tier_at_least(hass, TIER):
        connection.send_error(msg["id"], "bright_required", TIER_MSG)
        return
    from homeassistant.helpers import device_registry as dr, entity_registry as er  # noqa: PLC0415

    dev_reg, ent_reg = dr.async_get(hass), er.async_get(hass)
    out = []
    for entry in hass.config_entries.async_entries(WLED_DOMAIN):
        host = (entry.data or {}).get("host")
        for dev in dr.async_entries_for_config_entry(dev_reg, entry.entry_id):
            lights = [e.entity_id for e in er.async_entries_for_device(ent_reg, dev.id)
                      if e.entity_id.startswith("light.")]
            out.append({
                "device_id": dev.id, "name": dev.name_by_user or dev.name, "host": host,
                "model": dev.model, "sw_version": dev.sw_version, "lights": sorted(lights),
                "available": entry.state.value == "loaded" if getattr(entry, "state", None) else True,
            })
    connection.send_result(msg["id"], {"devices": sorted(out, key=lambda d: str(d["name"]).lower())})


@websocket_api.websocket_command({"type": "padspan_ha/wled_get", vol.Required("path"): str, **_TARGET})
@websocket_api.async_response
async def ws_wled_get(hass: HomeAssistant, connection, msg) -> None:
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    err = check_get_path(msg["path"])
    if err:
        connection.send_error(msg["id"], "path_not_allowed", err)
        return
    try:
        data = await _request(hass, tgt["host"], "GET", msg["path"])
    except WledError as e:
        connection.send_error(msg["id"], e.code, str(e))
        return
    connection.send_result(msg["id"], {"data": data, "device": tgt["name"],
                                       "hash": cfg_hash(data) if msg["path"] == "json/cfg" else None})


@websocket_api.websocket_command({"type": "padspan_ha/wled_state", vol.Required("body"): dict, **_TARGET})
@websocket_api.async_response
async def ws_wled_state(hass: HomeAssistant, connection, msg) -> None:
    """POST /json/state — live changes; persisting keys need an admin."""
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    body = dict(msg["body"])
    # The smallest device buffer: a state body never needs more.
    err = check_state_body(body, _is_admin(connection), MAX_BODY_ESP8266)
    if err:
        connection.send_error(msg["id"], "refused", err)
        return
    body["v"] = True        # answer with the resulting state
    try:
        data = await _request(hass, tgt["host"], "POST", "json/state", body, POST_TIMEOUT_S)
    except WledError as e:
        connection.send_error(msg["id"], e.code, str(e))
        return
    connection.send_result(msg["id"], {"data": data})


@websocket_api.websocket_command({
    "type": "padspan_ha/wled_cfg",
    vol.Required("patch"): dict,
    vol.Required("base_hash"): str,
    vol.Optional("reboot", default=False): bool,
    vol.Optional("pin"): vol.All(str, vol.Length(max=4)),
    **_TARGET,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_cfg(hass: HomeAssistant, connection, msg) -> None:
    """One /json/cfg write, done safely: back up, refuse over a changed
    device, write, re-read, return before and after."""
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    host = tgt["host"]
    try:
        info = await _request(hass, host, "GET", "json/info")
        before = await _request(hass, host, "GET", "json/cfg")
    except WledError as e:
        connection.send_error(msg["id"], e.code, str(e))
        return
    err = check_cfg_patch(msg["patch"], max_body_for(info))
    if err:
        connection.send_error(msg["id"], "refused", err)
        return
    if cfg_hash(before) != msg["base_hash"]:
        connection.send_error(msg["id"], "changed",
                              "The device's settings changed since you opened them — reload and try again")
        return
    try:
        presets = await _request(hass, host, "GET", "presets.json")
    except WledError:
        presets = None
    folder = _backup_dir(hass, str(info.get("mac", "")))
    files = {"cfg.json": before, "info.json": info}
    if presets is not None:
        files["presets.json"] = presets
    backup_id = await hass.async_add_executor_job(_write_backup_sync, folder, files)
    body = dict(msg["patch"])
    if msg.get("pin"):
        body["pin"] = msg["pin"]
    if msg.get("reboot"):
        body["rb"] = True
    try:
        await _request(hass, host, "POST", "json/cfg", body, POST_TIMEOUT_S)
    except WledError as e:
        connection.send_error(msg["id"], e.code, f"{e} (nothing was changed; backup {backup_id} kept)")
        return
    after = None
    if not msg.get("reboot"):
        try:
            after = await _request(hass, host, "GET", "json/cfg")
        except WledError:
            after = None
    connection.send_result(msg["id"], {"backup": backup_id, "before": before, "after": after,
                                       "hash": cfg_hash(after) if after is not None else None})


@websocket_api.websocket_command({
    "type": "padspan_ha/wled_backups",
    vol.Optional("action", default="list"): vol.In(["list", "create", "get", "restore_presets", "restore_cfg"]),
    vol.Optional("backup_id"): vol.Match(r"^\d{8}-\d{6}$"),
    vol.Optional("pin"): vol.All(str, vol.Length(max=4)),
    **_TARGET,
})
@websocket_api.async_response
async def ws_wled_backups(hass: HomeAssistant, connection, msg) -> None:
    """List, take, or read a stored backup of a WLED device's cfg/presets."""
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    try:
        info = await _request(hass, tgt["host"], "GET", "json/info")
    except WledError as e:
        connection.send_error(msg["id"], e.code, str(e))
        return
    folder = _backup_dir(hass, str(info.get("mac", "")))
    action = msg.get("action", "list")
    if action == "create":
        if not _is_admin(connection):
            connection.send_error(msg["id"], "unauthorized", "Only an administrator can take a WLED backup")
            return
        try:
            files = {"cfg.json": await _request(hass, tgt["host"], "GET", "json/cfg"),
                     "presets.json": await _request(hass, tgt["host"], "GET", "presets.json"),
                     "info.json": info}
        except WledError as e:
            connection.send_error(msg["id"], e.code, str(e))
            return
        backup_id = await hass.async_add_executor_job(_write_backup_sync, folder, files)
        connection.send_result(msg["id"], {"backup": backup_id})
        return
    if action in ("restore_presets", "restore_cfg"):
        # Only back to the SAME device: another unit's LED count breaks every
        # segment bound in its presets (Garry's rule: never copy presets.json
        # between devices). The folder is keyed by this device's own MAC.
        if not _is_admin(connection):
            connection.send_error(msg["id"], "unauthorized", "Only an administrator can restore a WLED backup")
            return
        bid = msg.get("backup_id")
        fname = "presets.json" if action == "restore_presets" else "cfg.json"

        def _read_one() -> Any:
            f = folder / str(bid) / fname
            return json.loads(f.read_text(encoding="utf-8")) if bid and f.is_file() else None

        data = await hass.async_add_executor_job(_read_one)
        if data is None:
            connection.send_error(msg["id"], "not_found", f"That backup has no {fname} for this device")
            return
        # A safety copy of what is there now, before anything is overwritten.
        try:
            now_files = {"cfg.json": await _request(hass, tgt["host"], "GET", "json/cfg"),
                         "presets.json": await _request(hass, tgt["host"], "GET", "presets.json"), "info.json": info}
            safety = await hass.async_add_executor_job(_write_backup_sync, folder, now_files)
            await _upload(hass, tgt["host"], fname, data, msg.get("pin"))
        except WledError as e:
            connection.send_error(msg["id"], e.code, str(e))
            return
        verified = None
        if action == "restore_presets":
            try:
                verified = cfg_hash(await _request(hass, tgt["host"], "GET", "presets.json")) == cfg_hash(data)
            except WledError:
                verified = False
        connection.send_result(msg["id"], {"restored": fname, "from": bid, "safety_backup": safety,
                                           "verified": verified, "rebooting": action == "restore_cfg"})
        return
    if action == "get":
        bid = msg.get("backup_id")
        if not bid:
            connection.send_error(msg["id"], "bad_request", "backup_id is required")
            return

        def _read() -> dict[str, Any]:
            d = folder / bid
            return {f.name: json.loads(f.read_text(encoding="utf-8")) for f in d.iterdir()} if d.is_dir() else {}

        connection.send_result(msg["id"], {"backup": bid, "files": await hass.async_add_executor_job(_read)})
        return
    connection.send_result(msg["id"], {"backups": await hass.async_add_executor_job(_list_backups_sync, folder)})


def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_wled_devices, ws_wled_get, ws_wled_state, ws_wled_cfg, ws_wled_backups):
        websocket_api.async_register_command(hass, cmd)
