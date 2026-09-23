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
    r"|presets\.json|cfg\.json|palette\d{1,3}\.json|ledmap\d{0,2}\.json)"
)
# What a non-admin may send to /json/state: live, unsaved changes only
# (review 2026-09-23). Everything else — preset writes, reboot, the settings
# PIN, the clock, sync groups (config-backed: the next config save would
# persist them), usermod keys — is an administrator's. A denylist let
# unknown and usermod keys through.
_OPEN_STATE_KEYS = frozenset({"on", "bri", "transition", "tt", "tb", "seg", "ps", "playlist", "np",
                              "mainseg", "lor", "live", "rSeg", "ledmap", "v", "nl", "udpn"})
_OPEN_NL_KEYS = frozenset({"on", "dur"})
_OPEN_UDPN_KEYS = frozenset({"send", "nn"})
# Never forwarded, whoever asks.
_FORBIDDEN_STATE_KEYS = frozenset({"win"})
# Never sent through /json/cfg: WLED APPENDS hw.com instead of replacing it.
_FORBIDDEN_CFG_PATHS = (("hw", "com"),)


# ── Pure checks (unit tested) ────────────────────────────────────────────────


def check_get_path(path: str) -> str | None:
    """None if `path` may be read, else the reason."""
    if not isinstance(path, str) or not _GET_PATHS.fullmatch(path):
        return f"path not allowed: {path!r}"
    return None


def check_state_body(body: Any, is_admin: bool, max_bytes: int = MAX_BODY_ESP8266) -> str | None:
    """None if `body` may be POSTed to /json/state by this user, else why not."""
    if not isinstance(body, dict):
        return "the state body must be a JSON object"
    for key in body:
        if key in _FORBIDDEN_STATE_KEYS:
            return f"'{key}' is never sent (legacy API; custom forks wedge on it)"
        if is_admin:
            continue
        if key not in _OPEN_STATE_KEYS:
            return f"'{key}' changes the device for everyone — an administrator must do it"
        if key == "nl" and isinstance(body[key], dict) and set(body[key]) - _OPEN_NL_KEYS:
            return "the nightlight's mode and target are an administrator's to change"
        if key == "udpn" and isinstance(body[key], dict) and set(body[key]) - _OPEN_UDPN_KEYS:
            return "sync groups are saved settings — an administrator must change them"
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


# WLED's config parser MERGES most keys but RESETS these when a write leaves
# them out (checked in cfg.cpp deserializeConfig at 0.14.4 / 0.15.4 / 16.0.1,
# review 2026-09-23): the frame rate to 42, the global auto-white override to
# off, gamma to its defaults, and every paired ESP-NOW remote. So each write
# carries the device's current values for them unless it changes them.
_RESET_IF_ABSENT = (("hw", "led", "fps"), ("hw", "led", "rgbwm"), ("light", "gc"), ("nw", "linked_remote"))


def _get_path(obj: Any, path: tuple) -> Any:
    for k in path:
        if not isinstance(obj, dict) or k not in obj:
            return _MISSING
        obj = obj[k]
    return obj


_MISSING = object()


def with_preserved(patch: dict, before: dict) -> dict:
    """The patch, plus the current value of every reset-if-absent key it
    doesn't set itself (only keys the device actually has)."""
    body = json.loads(json.dumps(patch))
    for path in _RESET_IF_ABSENT:
        cur = _get_path(before, path)
        if cur is _MISSING or _get_path(body, path) is not _MISSING:
            continue
        node = body
        for k in path[:-1]:
            node = node.setdefault(k, {})
            if not isinstance(node, dict):
                break
        else:
            node[path[-1]] = cur
    return body


def deep_merge(base: Any, patch: Any) -> Any:
    """What a config should look like after a write: objects merge, anything
    else (arrays included — WLED replaces them) is taken from the patch."""
    if isinstance(base, dict) and isinstance(patch, dict):
        out = dict(base)
        for k, v in patch.items():
            out[k] = deep_merge(base.get(k), v)
        return out
    return patch


def unexpected_changes(before: dict, patch: dict, after: dict, limit: int = 20) -> list[str]:
    """Leaves that changed although the write didn't ask for it."""
    want = deep_merge(before, patch)
    out: list[str] = []

    def walk(a: Any, b: Any, path: str) -> None:
        if len(out) >= limit:
            return
        if isinstance(a, dict) and isinstance(b, dict):
            for k in set(a) | set(b):
                walk(a.get(k, _MISSING), b.get(k, _MISSING), f"{path}.{k}" if path else str(k))
        elif a != b and not (a is _MISSING and b is None):
            out.append(path)

    walk(want, after, "")
    return sorted(p for p in out if p not in ("vid", "rev"))


# What a non-admin may see of the config: no network, Wi-Fi, MQTT, OTA or
# usermod sections (a usermod can hold secrets — WireGuard keys, review
# 2026-09-23). The Advanced tab shows non-admins these read-only.
_CFG_OPEN_SECTIONS = ("def", "hw", "light", "if")
_CFG_OPEN_IF = ("sync", "live", "nodes")


def redact_cfg(cfg: Any) -> Any:
    if not isinstance(cfg, dict):
        return cfg
    out = {k: cfg[k] for k in _CFG_OPEN_SECTIONS if k in cfg}
    if isinstance(out.get("if"), dict):
        out["if"] = {k: v for k, v in out["if"].items() if k in _CFG_OPEN_IF}
    return out


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
        if entry is None or getattr(entry, "disabled_by", None):
            continue
        state = getattr(entry, "state", None)
        if state is not None and getattr(state, "value", state) != "loaded":
            continue            # a failed or unloaded entry's host isn't trusted
        host = (entry.data or {}).get("host")
        if host:
            # unique_id is the MAC HA verified when the device was added —
            # the key for its backups, never the MAC the device claims.
            return {"host": str(host), "device_id": device_id, "entry_id": entry_id,
                    "mac": _norm_mac(getattr(entry, "unique_id", None)),
                    "name": dev.name_by_user or dev.name or str(host)}
    return None


def _norm_mac(mac: Any) -> str:
    return re.sub(r"[^0-9a-f]", "", str(mac or "").lower())


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


def _url(host: str, path: str):
    """http://host/path?query — built, not formatted, so an IPv6 host works."""
    from yarl import URL  # noqa: PLC0415
    p, _, q = path.partition("?")
    return URL.build(scheme="http", host=host.strip("[]"), path="/" + p, query_string=q)


async def _request(hass: HomeAssistant, host: str, method: str, path: str,
                   body: Any = None, timeout: float = GET_TIMEOUT_S, retries: int = 2) -> Any:
    """One call to the device. WLED 0.14/0.15 answer an overlapping request
    with 503 "busy"; that is retried briefly. Redirects are never followed —
    a device at a WLED entry's address must not be able to steer HA to any
    other host (review 2026-09-23)."""
    for attempt in range(retries + 1):
        try:
            return await _request_once(hass, host, method, path, body, timeout)
        except WledError as e:
            if e.code != "busy" or attempt == retries:
                raise
            await asyncio.sleep(0.4 * (attempt + 1))
    raise WledError("busy", "The device is busy — try again in a moment")


async def _request_once(hass: HomeAssistant, host: str, method: str, path: str,
                        body: Any, timeout: float) -> Any:
    import aiohttp  # noqa: PLC0415
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415

    session = async_get_clientsession(hass)
    try:
        async with session.request(method, _url(host, path), json=body, allow_redirects=False,
                                   timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            text = await resp.text()
            if 300 <= resp.status < 400:
                raise WledError("bad_reply", "The device answered with a redirect — refused")
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
        async with session.post(_url(host, "upload"), data=form, allow_redirects=False,
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
    base = time.strftime("%Y%m%d-%H%M%S")
    folder.mkdir(parents=True, exist_ok=True)
    stamp, n = base, 1
    while True:                       # two backups in one second never share a folder
        dest = folder / stamp
        try:
            dest.mkdir(exist_ok=False)
            break
        except FileExistsError:
            n += 1
            stamp = f"{base}-{n}"
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
    is_cfg = msg["path"] in ("json/cfg", "cfg.json")
    connection.send_result(msg["id"], {
        "data": data if (not is_cfg or _is_admin(connection)) else redact_cfg(data),
        "device": tgt["name"],
        # The hash is of the full config — what a write is compared against.
        "hash": cfg_hash(data) if msg["path"] == "json/cfg" else None,
    })


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
    # Backups are keyed by the MAC HA verified for this device; a device
    # claiming a different one is refused (never another unit's presets).
    if tgt.get("mac") and _norm_mac(info.get("mac")) and _norm_mac(info.get("mac")) != tgt["mac"]:
        connection.send_error(msg["id"], "mac_mismatch",
                              "The device reports a different MAC than Home Assistant has for it — refused")
        return
    folder = _backup_dir(hass, tgt.get("mac") or str(info.get("mac", "")))
    files = {"cfg.json": before, "info.json": info}
    if presets is not None:
        files["presets.json"] = presets
    backup_id = await hass.async_add_executor_job(_write_backup_sync, folder, files)
    body = with_preserved(msg["patch"], before)
    if msg.get("pin"):
        body["pin"] = msg["pin"]
    if msg.get("reboot"):
        body["rb"] = True
    try:
        await _request(hass, host, "POST", "json/cfg", body, POST_TIMEOUT_S, retries=0)
    except WledError as e:
        if e.code in ("timeout", "unreachable"):
            # The device may have applied it before the reply was lost.
            try:
                after = await _request(hass, host, "GET", "json/cfg")
                changed = cfg_hash(after) != cfg_hash(before)
            except WledError:
                changed = None
            what = ("it WAS applied" if changed else "it was not applied" if changed is False
                    else "whether it was applied is unknown")
            connection.send_error(msg["id"], e.code, f"{e} — {what}; backup {backup_id} kept")
        else:
            connection.send_error(msg["id"], e.code, f"{e} (nothing was changed; backup {backup_id} kept)")
        return
    after = None
    if not msg.get("reboot"):
        try:
            after = await _request(hass, host, "GET", "json/cfg")
        except WledError:
            after = None
    connection.send_result(msg["id"], {
        "backup": backup_id, "before": before, "after": after,
        "hash": cfg_hash(after) if after is not None else None,
        # Anything that moved without being asked for — shown to the admin.
        "unexpected": unexpected_changes(before, msg["patch"], after) if after is not None else [],
    })


@websocket_api.websocket_command({
    "type": "padspan_ha/wled_backups",
    vol.Optional("action", default="list"): vol.In(["list", "create", "get", "restore_presets", "restore_cfg"]),
    vol.Optional("backup_id"): vol.Match(r"^\d{8}-\d{6}(-\d{1,3})?$"),
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
    # Backups are keyed by the MAC HA verified for this device; a device
    # claiming a different one is refused (never another unit's presets).
    if tgt.get("mac") and _norm_mac(info.get("mac")) and _norm_mac(info.get("mac")) != tgt["mac"]:
        connection.send_error(msg["id"], "mac_mismatch",
                              "The device reports a different MAC than Home Assistant has for it — refused")
        return
    folder = _backup_dir(hass, tgt.get("mac") or str(info.get("mac", "")))
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
        if not _is_admin(connection):
            connection.send_error(msg["id"], "unauthorized", "Only an administrator can open a WLED backup")
            return
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


# ── 2D matrix: only WLED's own settings form rebuilds it ─────────────────────
# /json/cfg can't set the matrix up (cfg.cpp: setUpMatrix can't run there);
# POST /settings/2D does (set.cpp SUBPAGE_2D) — and then WLED rebuilds every
# segment (makeAutoSegments), which the card warns about. Backed up first.

MAX_PANELS = 18


def matrix_form(enabled: bool, panels: list[dict]) -> dict[str, str] | str:
    """The /settings/2D form fields, or the reason the layout is refused."""
    if not enabled:
        return {"SOMP": "0"}
    if not isinstance(panels, list) or not 1 <= len(panels) <= MAX_PANELS:
        return f"a matrix needs 1-{MAX_PANELS} panels"
    form = {"SOMP": "1", "MPC": str(len(panels))}
    for i, p in enumerate(panels):
        try:
            w, hgt, x, y = int(p["w"]), int(p["h"]), int(p.get("x", 0)), int(p.get("y", 0))
        except (KeyError, TypeError, ValueError):
            return f"panel {i + 1} needs a width and a height"
        if not (1 <= w <= 256 and 1 <= hgt <= 256 and 0 <= x <= 1024 and 0 <= y <= 1024):
            return f"panel {i + 1}'s size or position is out of range"
        form.update({f"P{i}B": "1" if p.get("b") else "0", f"P{i}R": "1" if p.get("r") else "0",
                     f"P{i}V": "1" if p.get("v") else "0", f"P{i}X": str(x), f"P{i}Y": str(y),
                     f"P{i}W": str(w), f"P{i}H": str(hgt)})
        if p.get("s"):
            form[f"P{i}S"] = "on"                 # presence means serpentine
    return form


@websocket_api.websocket_command({
    "type": "padspan_ha/wled_matrix",
    vol.Required("enabled"): bool,
    vol.Optional("panels", default=[]): list,
    vol.Optional("pin"): vol.All(str, vol.Length(max=4)),
    **_TARGET,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_matrix(hass: HomeAssistant, connection, msg) -> None:
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    form = matrix_form(msg["enabled"], msg.get("panels") or [])
    if isinstance(form, str):
        connection.send_error(msg["id"], "refused", form)
        return
    host = tgt["host"]
    try:
        info = await _request(hass, host, "GET", "json/info")
        files = {"cfg.json": await _request(hass, host, "GET", "json/cfg"),
                 "presets.json": await _request(hass, host, "GET", "presets.json"), "info.json": info}
    except WledError as e:
        connection.send_error(msg["id"], e.code, str(e))
        return
    if tgt.get("mac") and _norm_mac(info.get("mac")) and _norm_mac(info.get("mac")) != tgt["mac"]:
        connection.send_error(msg["id"], "mac_mismatch", "The device reports a different MAC than Home Assistant has for it — refused")
        return
    backup_id = await hass.async_add_executor_job(_write_backup_sync, _backup_dir(hass, tgt.get("mac") or str(info.get("mac", ""))), files)
    try:
        if msg.get("pin"):
            await _request(hass, host, "POST", "json/state", {"pin": msg["pin"]}, POST_TIMEOUT_S)
        await _post_form(hass, host, "settings/2D", form)
        after = await _request(hass, host, "GET", "json/cfg")
    except WledError as e:
        connection.send_error(msg["id"], e.code, f"{e} (backup {backup_id} kept)")
        return
    connection.send_result(msg["id"], {"backup": backup_id, "matrix": ((after.get("hw") or {}).get("led") or {}).get("matrix")})


async def _post_form(hass: HomeAssistant, host: str, path: str, form: dict[str, str]) -> None:
    """A settings-page form POST (the device answers with an HTML page)."""
    import aiohttp  # noqa: PLC0415
    from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415

    session = async_get_clientsession(hass)
    try:
        async with session.post(_url(host, path), data=form, allow_redirects=False,
                                timeout=aiohttp.ClientTimeout(total=POST_TIMEOUT_S)) as resp:
            if resp.status == 401:
                raise WledError("pin_required", "This WLED device has a settings PIN — enter it to continue")
            if resp.status >= 300:
                raise WledError("http_error", f"The device refused the settings (HTTP {resp.status})")
    except WledError:
        raise
    except asyncio.TimeoutError as err:
        raise WledError("timeout", f"No answer from {host}") from err
    except aiohttp.ClientError as err:
        raise WledError("unreachable", f"Can't reach {host}: {err}") from err


# ── Identify: light one segment on the real strip, then put everything back ──
# Server-side (review 2026-09-23): a browser timer died with a locked phone or
# a closed card and left the strip stuck white. The backend keeps the saved
# state, restores it after `seconds` with retries (in chunks the device's
# buffer accepts), resumes a running playlist, and a second Identify during
# an active one keeps the ORIGINAL saved state.

_IDENTIFY = "_wled_identify"
_SEG_RESTORE_DROP = ("len", "lc")


def identify_body(state: dict, seg_id: int) -> dict:
    """Target segment solid white at full opacity; every other segment off
    (nothing else about them is touched)."""
    segs = []
    for s in state.get("seg") or []:
        if s.get("id") == seg_id:
            segs.append({"id": seg_id, "on": True, "bri": 255, "fx": 0, "frz": False,
                         "col": [[255, 255, 255], [0, 0, 0], [0, 0, 0]]})
        else:
            segs.append({"id": s.get("id"), "on": False})
    return {"on": True, "bri": max(96, int(state.get("bri") or 0)), "tt": 0, "seg": segs}


def restore_bodies(state: dict, max_bytes: int) -> list[dict]:
    """The saved state back, split so each request fits the device buffer."""
    segs = [{k: v for k, v in s.items() if k not in _SEG_RESTORE_DROP} for s in (state.get("seg") or [])]
    head = {"on": state.get("on", True), "bri": state.get("bri", 128), "tt": 0}
    bodies, cur = [], []
    for seg in segs:
        trial = {**head, "seg": cur + [seg]}
        if cur and len(json.dumps(trial, separators=(",", ":"))) > max_bytes - 64:
            bodies.append({**head, "seg": cur})
            cur = [seg]
        else:
            cur.append(seg)
    bodies.append({**head, "seg": cur})
    return bodies


@websocket_api.websocket_command({
    "type": "padspan_ha/wled_identify",
    vol.Required("seg_id"): vol.All(int, vol.Range(min=0, max=63)),
    vol.Optional("seconds", default=10): vol.All(int, vol.Range(min=2, max=60)),
    **_TARGET,
})
@websocket_api.async_response
async def ws_wled_identify(hass: HomeAssistant, connection, msg) -> None:
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    host = tgt["host"]
    active: dict = hass.data.setdefault(DOMAIN, {}).setdefault(_IDENTIFY, {})
    job = active.get(host)
    try:
        if job is None:
            si = await _request(hass, host, "GET", "json/si")
            job = {"state": si.get("state") or {}, "max": max_body_for(si.get("info")), "cancel": None}
            active[host] = job
        elif job.get("cancel"):
            job["cancel"]()                       # re-aim: one restore, from the original state
        await _request(hass, host, "POST", "json/state", identify_body(job["state"], msg["seg_id"]), POST_TIMEOUT_S)
    except WledError as e:
        active.pop(host, None)
        connection.send_error(msg["id"], e.code, str(e))
        return

    async def _restore(_now: Any = None) -> None:
        if active.get(host) is not job:
            return
        saved = job["state"]
        for attempt in range(4):
            try:
                for body in restore_bodies(saved, job["max"]):
                    await _request(hass, host, "POST", "json/state", body, POST_TIMEOUT_S)
                pl = saved.get("pl")
                if isinstance(pl, int) and pl > 0:
                    await _request(hass, host, "POST", "json/state", {"ps": pl}, POST_TIMEOUT_S)
                break
            except WledError as e:
                _LOGGER.warning("WLED identify: restoring %s failed (try %d): %s", host, attempt + 1, e)
                await asyncio.sleep(2 * (attempt + 1))
        active.pop(host, None)

    from homeassistant.helpers.event import async_call_later  # noqa: PLC0415
    job["cancel"] = async_call_later(hass, msg["seconds"], _restore)
    connection.send_result(msg["id"], {"seconds": msg["seconds"]})


# ── Live view: the strip's real colours, streamed ───────────────────────────
# One upstream WebSocket per device (WLED /ws, {"lv":true}), opened by the
# first viewer and closed by the last, relayed at <= 10 fps. An ESP8266 has
# only 3 WebSocket slots and drops the oldest — HA's own WLED integration
# holds one — so the card asks before starting on one.

_LIVE = "_wled_live"
LIVE_MIN_INTERVAL_S = 0.1


def decode_live_frame(data: bytes) -> dict | None:
    """WLED's binary live frame: 'L', version (1 strip / 2 matrix), [w, h],
    then RGB triplets. None if it isn't one."""
    if len(data) < 2 or data[0] != 0x4C:
        return None
    if data[1] == 2 and len(data) >= 4:
        return {"w": data[2], "h": data[3], "rgb": bytes(data[4:])}
    return {"w": 0, "h": 0, "rgb": bytes(data[2:])}


class _LiveRelay:
    def __init__(self, hass: HomeAssistant, host: str) -> None:
        self.hass, self.host = hass, host
        self.subs: dict[int, Any] = {}
        self.task: asyncio.Task | None = None
        self._last = 0.0

    def add(self, key: int, send) -> None:
        self.subs[key] = send
        if self.task is None or self.task.done():
            self.task = self.hass.async_create_background_task(self._run(), f"padspan_wled_live_{self.host}")

    def remove(self, key: int) -> None:
        self.subs.pop(key, None)
        if not self.subs and self.task:
            self.task.cancel()

    async def _run(self) -> None:
        import aiohttp  # noqa: PLC0415
        import base64  # noqa: PLC0415
        from homeassistant.helpers.aiohttp_client import async_get_clientsession  # noqa: PLC0415

        url = _url(self.host, "ws").with_scheme("ws")
        try:
            async with async_get_clientsession(self.hass).ws_connect(url, heartbeat=20) as ws:
                await ws.send_str('{"lv":true}')
                async for m in ws:
                    if not self.subs:
                        break
                    if m.type != aiohttp.WSMsgType.BINARY:
                        continue
                    now = time.monotonic()
                    if now - self._last < LIVE_MIN_INTERVAL_S:
                        continue
                    self._last = now
                    frame = decode_live_frame(m.data)
                    if frame is None:
                        continue
                    payload = {"w": frame["w"], "h": frame["h"], "rgb": base64.b64encode(frame["rgb"]).decode()}
                    for send in list(self.subs.values()):
                        send(payload)
                try:
                    await ws.send_str('{"lv":false}')
                except Exception:  # noqa: BLE001 — closing anyway
                    pass
        except asyncio.CancelledError:
            raise
        except Exception as err:  # noqa: BLE001
            _LOGGER.debug("WLED live view %s ended: %s", self.host, err)
            for send in list(self.subs.values()):
                send({"error": str(err)[:120]})


@websocket_api.websocket_command({"type": "padspan_ha/wled_live", **_TARGET})
@websocket_api.async_response
async def ws_wled_live(hass: HomeAssistant, connection, msg) -> None:
    tgt = await _gate(hass, connection, msg)
    if tgt is None:
        return
    relays: dict = hass.data.setdefault(DOMAIN, {}).setdefault(_LIVE, {})
    relay = relays.get(tgt["host"]) or relays.setdefault(tgt["host"], _LiveRelay(hass, tgt["host"]))
    key = id(connection) ^ msg["id"]

    def _send(payload: dict) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    def _unsub() -> None:
        relay.remove(key)

    connection.subscriptions[msg["id"]] = _unsub
    relay.add(key, _send)
    connection.send_result(msg["id"])


# ── Teams: WLED devices that act as one light ───────────────────────────────
# Garry, 2026-09-23: "include teaming with other wled devices for proper
# light control in HA". A team is a leader and its followers, joined by a
# WLED sync group (the card sets the groups on every device, each through the
# safe cfg write). PadSpan records the team so the rest of HA drives only the
# leader: Vacation Mode leaves followers alone (vacation_mode.py), instead of
# switching them independently and fighting the leader's sync.

TEAM_MODES = ("mirror",)


def sanitize_teams(hass: HomeAssistant, teams: Any) -> list[dict[str, Any]] | str:
    """The stored shape, or the reason the list was refused."""
    if not isinstance(teams, list) or len(teams) > 16:
        return "teams must be a list of at most 16"
    out, seen = [], set()
    for t in teams:
        if not isinstance(t, dict):
            return "each team must be an object"
        leader = str(t.get("leader") or "")
        followers = [str(f) for f in (t.get("followers") or []) if f]
        group = t.get("group")
        if t.get("mode", "mirror") not in TEAM_MODES:
            return f"unknown team mode {t.get('mode')!r}"
        if not isinstance(group, int) or not 1 <= group <= 8:
            return "a team's sync group must be 1-8"
        if not followers or leader in followers or len(set(followers)) != len(followers):
            return "a team needs a leader and one or more different followers"
        for dev in [leader, *followers]:
            if resolve_device(hass, device_id=dev) is None:
                return f"{dev} isn't a WLED device in Home Assistant"
            if dev in seen:
                return "a device can be in only one team"
            seen.add(dev)
        out.append({"id": str(t.get("id") or f"team{len(out) + 1}")[:32],
                    "name": str(t.get("name") or "WLED team")[:64],
                    "mode": t.get("mode", "mirror"), "group": group,
                    "leader": leader, "followers": followers})
    return out


def follower_light_entities(hass: HomeAssistant, teams: list | None) -> set[str]:
    """Every light entity of a team follower — the lights the rest of HA
    should leave to their leader."""
    from homeassistant.helpers import entity_registry as er  # noqa: PLC0415

    devs = {f for t in (teams or []) if isinstance(t, dict) for f in (t.get("followers") or [])}
    if not devs:
        return set()
    reg = er.async_get(hass)
    return {e.entity_id for d in devs for e in er.async_entries_for_device(reg, d) if e.entity_id.startswith("light.")}


@websocket_api.websocket_command({"type": "padspan_ha/wled_teams_get"})
@websocket_api.async_response
async def ws_wled_teams_get(hass: HomeAssistant, connection, msg) -> None:
    from .const import DATA_SETTINGS  # noqa: PLC0415
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    connection.send_result(msg["id"], {"teams": list((st.data if st else {}).get("wled_teams") or [])})


@websocket_api.websocket_command({"type": "padspan_ha/wled_teams_set", vol.Required("teams"): list})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_wled_teams_set(hass: HomeAssistant, connection, msg) -> None:
    from .const import DATA_SETTINGS  # noqa: PLC0415
    if not _tier_at_least(hass, TIER):
        connection.send_error(msg["id"], "bright_required", TIER_MSG)
        return
    teams = sanitize_teams(hass, msg["teams"])
    if isinstance(teams, str):
        connection.send_error(msg["id"], "invalid", teams)
        return
    st = hass.data.get(DOMAIN, {}).get(DATA_SETTINGS)
    if not st:
        connection.send_error(msg["id"], "no_settings", "Settings not loaded")
        return
    await st.async_set(wled_teams=teams)
    connection.send_result(msg["id"], {"teams": teams})


def async_register(hass: HomeAssistant) -> None:
    for cmd in (ws_wled_devices, ws_wled_get, ws_wled_state, ws_wled_cfg, ws_wled_backups,
                ws_wled_identify, ws_wled_matrix, ws_wled_live, ws_wled_teams_get, ws_wled_teams_set):
        websocket_api.async_register_command(hass, cmd)
