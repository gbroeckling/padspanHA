# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every websocket command sent wrong and hostile values, in a real Home
Assistant.

test_commands.py sends each command what its schema accepts, and each field
left out. Here a field is present but wrong: the wrong type, absurdly large,
names something that does not exist, a path or a URL that points elsewhere,
a picture that is not one (hostile_values.py chooses them from the field's
schema). One field is wrong at a time; the others are what the command
table gives, or in the furnished house the ids of things that exist there.

Two houses: the house as installed (first run), and the last stable's house
with data in every store (test_upgrade.py's) with every switch on and a Pro
key. Each is asked as an administrator and as a household member, with
Enhanced security on and off. For every message:

1. exactly one answer, never Home Assistant's "unknown_error" (the handler
   raised) nor Python's own error text as the refusal, and no error or
   exception logged about it;
2. the answer within ANSWER_S;
3. a refused message changes nothing: the integration's stored data, the
   files in the config folder and the entities stay as they were;
4. nothing outside the config folder is read or written (an audit hook sees
   every open, rename, remove and socket the process makes meanwhile; a
   canary file sits next to the config folder), and no address taken from
   the message is fetched;
5. what a member is refused with a valid message, the member is refused
   with a hostile one too.
Afterwards the command still answers and the integration reloads.

Every command and field gets its wrong-type and missing-thing values (and
the path and picture values for a field that names a file, a path or a URL)
on every run; PADSPAN_HOSTILE=full sends the whole pool and adds the member
in the first-run house and the administrator with the switch off.
PADSPAN_HOSTILE_REPORT=<folder> writes every message's outcome there as
JSON lines.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import re
import resource
import site
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any

import aiohttp
import pytest
import voluptuous as vol
from homeassistant.auth.const import GROUP_ID_USER
from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import storage
from pytest_homeassistant_custom_component.common import mock_storage

from . import commands as C
from . import hostile_values as H
from .conftest import DOMAIN, counter_save_timers
from .test_commands import _PYTHON_ERROR
from .test_upgrade import OLD, _start

FULL = os.environ.get("PADSPAN_HOSTILE") == "full"
# For a local look at a few fields only: a regular expression their names match.
ONLY_FIELDS = re.compile(os.environ.get("PADSPAN_HOSTILE_FIELDS", ""))
REPORT = os.environ.get("PADSPAN_HOSTILE_REPORT")
# An answer within this, or it is a hang.
ANSWER_S = 5.0
# One message may not make the process's peak memory grow by more than this.
MEMORY_MB = 300
DECLARED = C.declared()

# Stores that move on by themselves while the house runs (a poll, a counted
# command, a feature that stopped for want of an AI Task counted in AI use):
# a change there is not the message's doing.
GATHERED = frozenset({"padspan_ha.telemetry_counters", "padspan_ha.movement_history", "padspan_ha.object_history",
                      "padspan_ha.ai_usage"})
# The movement trace's daily files, written as the house runs (traceback_store).
_TRACE_SEGMENTS = "padspan_ha.traceback_segments"
# Counted in a store, also when a command refuses: how often line-up stopped
# because it needs an AI Task it does not have (plan_ai's "stall").
COUNTED = {"padspan_ha.plan_ai": ("stall",),
           # Written as the house runs: Yesterday at home's day told, stamped by its morning message in the
           # background once an earlier message switched it on with a time already past (presence_coordinator).
           "padspan_ha.settings": ("yesterday_home_sent_day",)}
# A guest's stay goes on being watched: its live state and summary move on.
_GUEST_LIVE = ("live", "summary")

# The one command whose field is an address it fetches, on purpose: the robot
# vacuum's own address on the home network (Valetudo), from an administrator.
# It may look a name up (a socket), but never fetches this machine itself nor
# a link-local address (util.async_check_address): those fail here as for
# every other command.
FETCHES_A_CALLERS_URL = {"vacuum_import_preview": "url"}

# Which kind of thing a field names, so the furnished house's base message
# names a thing that exists and the pool can send another kind's id.
KIND_OF = {
    "map_id": "map", "ref_map_id": "map", "target_map_id": "map", "source_map_id": "map", "map_ids": "map",
    "floor_id": "floor", "to_floor_id": "floor",
    "room": "room", "keep": "room", "rooms": "room", "area_name": "room", "off_limits": "room",
    "source": "scanner", "old_source": "scanner", "new_source": "scanner",
    "key": "address", "ibeacon_key": "address", "address": "address", "addr": "address",
    "entity_id": "entity", "backup_id": "backup", "session_id": "capture", "point_id": "point",
    "zone_id": "zone", "padspan_id": "device", "keep_id": "device", "absorb_id": "device", "pid": "device",
    "piece_id": "piece", "barrier_id": "barrier", "session": "guest",
}


def existing_ids() -> dict[str, list[str]]:
    """The ids of what the furnished house holds, by kind."""
    s = {k: v["data"] for k, v in OLD["storage"].items()}
    fabric = s["padspan_ha.fabric"]
    return {
        "map": [m["id"] for m in s["padspan_ha.maps"]["maps"]],
        "floor": [f["id"] for f in s["padspan_ha.model"]["floors"]],
        "room": sorted(s["padspan_ha.model"]["room_meta"]),
        "scanner": sorted(fabric["scanner_positions_m"]),
        "address": sorted(s["padspan_ha.follow_alerts"]),
        "entity": sorted(fabric["light_positions_m"]),
        "backup": [b["id"] for b in s["padspan_ha.backups"]["backups"]],
        "capture": [c["id"] for c in s["padspan_ha.capture"]["sessions"]],
        "point": [p["id"] for p in s["padspan_ha.calibration"]["points"]],
        "zone": sorted(s["padspan_ha.subzones"]["zones"]),
        "device": sorted(s["padspan_ha.devices"]["devices"]),
        "piece": sorted(s["padspan_ha.house3d"]["pieces"]),
        "barrier": [b["id"] for b in fabric["rf_barriers_m"]],
        "guest": sorted(s["padspan_ha.guests"]["sessions"]),
    }


# ── the houses ───────────────────────────────────────────────────────────────

def _furnished(request) -> bool:
    return "_furnished" in request.node.name


@pytest.fixture
def hass_storage(request):
    """Empty for the house as installed; what the last stable stored for the
    furnished one."""
    with mock_storage(copy.deepcopy(OLD["storage"]) if _furnished(request) else {}) as stored:
        yield stored


@pytest.fixture
def hass_config_dir(request, tmp_path: Path) -> str:
    """The config folder (with the last stable's files for the furnished
    house), and a canary file next to it that nothing may read or touch."""
    import base64  # noqa: PLC0415

    config = tmp_path / "config"
    config.mkdir()
    if _furnished(request):
        for rel, data in OLD["files"].items():
            path = config / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(data))
    (tmp_path / "canary.txt").write_text("canary", encoding="utf-8")
    return str(config)


async def _member(hass, hass_ws_client):
    user = await hass.auth.async_create_user("Household member", group_ids=[GROUP_ID_USER])
    token = await hass.auth.async_create_refresh_token(user, "https://example.test")
    return await hass_ws_client(hass, hass.auth.async_create_access_token(token))


async def _everything_on(hass) -> None:
    from custom_components.padspan_ha.settings_store import DEFAULT_SETTINGS  # noqa: PLC0415

    await hass.data[DOMAIN]["settings"].async_set(
        **{key: True for key, value in DEFAULT_SETTINGS.items() if value is False},
        data_mode="live", forensics_license_key="PSPAN-TEST-TEST-TEST-TEST")
    await hass.async_block_till_done()


async def _secure(hass, on: bool) -> None:
    await hass.data[DOMAIN]["settings"].async_set(enhanced_security=on)
    await hass.async_block_till_done()


# ── watching the process: files and sockets ──────────────────────────────────

_AUDIT: dict[str, Any] = {"on": False, "events": [], "hooked": False}
_WATCHED = {"open", "os.remove", "os.rename", "os.rmdir", "os.mkdir", "os.listdir", "os.scandir", "os.truncate",
            "os.chmod", "os.symlink", "os.link", "shutil.rmtree", "shutil.copyfile", "shutil.copytree",
            "shutil.move", "socket.connect", "socket.getaddrinfo", "subprocess.Popen", "os.system",
            "os.posix_spawn", "os.exec", "os.fork"}


def _audit(event: str, args: tuple) -> None:
    if _AUDIT["on"] and event in _WATCHED:
        _AUDIT["events"].append((event, args))


def _hook_once() -> None:
    if not _AUDIT["hooked"]:
        sys.addaudithook(_audit)        # cannot be removed: it does nothing while "on" is False
        _AUDIT["hooked"] = True


def _roots(paths) -> tuple[str, ...]:
    return tuple(sorted({os.path.realpath(p).rstrip(os.sep) + os.sep for p in paths if p}))


# What any Python process reads: its own install, the integration's folder,
# the system's libraries, time zones, certificates and name lookup.
_READ_OK = _roots([sys.prefix, sys.base_prefix, sys.exec_prefix, *site.getsitepackages(), str(C.ROOT),
                   "/proc", "/sys", "/dev", "/usr", "/lib", "/lib64", "/run", "/etc/ssl", "/etc/ca-certificates"])
_READ_OK_FILES = {"/etc/localtime", "/etc/hosts", "/etc/resolv.conf", "/etc/nsswitch.conf", "/etc/gai.conf",
                  "/etc/host.conf", "/etc/mime.types", "/etc/os-release", "/etc/timezone"}
# Python's own import machinery caching a module the message made it import.
_PYC = re.compile(r"[/\\]__pycache__([/\\][^/\\]+\.pyc(\.\d+)?)?$")
# Where tests_ha/other_versions.py (the versions workflow's plugin) notes the
# warnings it collects, as the test runs.
_HARNESS_NOTES = os.path.realpath(os.environ.get("PADSPAN_HA_NOTES")
                                  or os.path.join(tempfile.gettempdir(), "padspan-ha-notes")) + os.sep
_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_APPEND | os.O_TRUNC


def _path(value: Any) -> str | None:
    if isinstance(value, int) or value is None:
        return None
    try:
        return os.path.realpath(os.fsdecode(value))
    except (TypeError, ValueError):
        return None


def _outside(events: list, config: str) -> list[str]:
    """What touched a file outside the config folder, or the network, or ran
    a program."""
    inside = os.path.realpath(config).rstrip(os.sep) + os.sep
    out = []
    for event, args in events:
        if event.startswith("socket."):
            out.append(f"{event} {args[1] if event == 'socket.connect' else args[:2]}")
            continue
        if event in ("subprocess.Popen", "os.system", "os.posix_spawn", "os.exec", "os.fork"):
            out.append(f"{event} {str(args)[:200]}")
            continue
        if event == "open":
            flags = args[2] if len(args) > 2 and isinstance(args[2], int) else 0
            mode = args[1] if len(args) > 1 and isinstance(args[1], str) else ""
            writes = bool(flags & _WRITE_FLAGS) or any(c in mode for c in "wax+")
            paths = [args[0]]
        else:
            writes = event not in ("os.listdir", "os.scandir")
            paths = list(args[:2]) if event in ("os.rename", "shutil.copyfile", "shutil.copytree", "shutil.move",
                                                 "os.symlink", "os.link") else [args[0]]
        for raw in paths:
            if (path := _path(raw)) is None or (path + os.sep).startswith((inside, _HARNESS_NOTES))                     or _PYC.search(path):
                continue
            if writes:
                out.append(f"{event} (write) {path}")
            elif not (path + os.sep).startswith(_READ_OK) and path not in _READ_OK_FILES:
                out.append(f"{event} (read) {path}")
    return out


# ── one message ──────────────────────────────────────────────────────────────

def _bad_log(record: logging.LogRecord) -> bool:
    """A record that says something went wrong handling the message. Home
    Assistant logs every refusal its websocket layer raises (a schema's
    "invalid_format", "unauthorized") at error level; those are answers, not
    failures. A handler's exception ("unknown_error", or any record with a
    traceback) is one."""
    if record.name.startswith("homeassistant.components.websocket_api"):
        return bool(record.exc_info) or "(unknown_error)" in record.getMessage()
    if _NO_MQTT in record.getMessage() or (record.name.endswith(_MQTT_FEEDS) and "subscribe failed" in record.getMessage()):
        return False
    if record.name.startswith("custom_components.padspan_ha"):
        return record.levelno >= logging.ERROR or (record.levelno >= logging.WARNING and bool(record.exc_info))
    return record.levelno >= logging.ERROR


# The house has no MQTT, and the furnished one has the ESPresense and Tasmota
# feeds switched on: they say so at error level each time they start (in
# words that differ between Home Assistant releases).
_NO_MQTT = "mqtt_not_setup"
_MQTT_FEEDS = (".espresense_mqtt", ".tasmota_ble")


def _describe(record: logging.LogRecord) -> str:
    """The record, and where in the integration its exception was raised."""
    text = f"log {record.levelname} {record.name}: {record.getMessage()[:300]}"
    if record.exc_info and record.exc_info[1] is not None:
        err = record.exc_info[1]
        ours = [f for f in traceback.extract_tb(err.__traceback__) if "padspan_ha" in f.filename]
        where = f"{Path(ours[-1].filename).name}:{ours[-1].lineno} in {ours[-1].name}" if ours else "outside"
        text += f" [{type(err).__name__}: {str(err)[:150]} at {where}]"
    return text


# Python's own words passed on as a refusal (test_commands.py's, and more).
_PYTHON_WORDS = re.compile(_PYTHON_ERROR.pattern + r"|could not convert|invalid literal for|argument must be|"
                           r"unhashable type|has no len\(\)")

_JUNK = re.compile(r'(?<!")\b(NaN|-?Infinity)\b|\\u0000|x{1000}|etc/passwd|169\.254|<script>|zz_missing|'
                   r'zz_not_a_choice|\\u202e|n{300}')


def _diff(old: str | None, new: str | None, limit: int = 3) -> list[str]:
    """Where two stored JSON documents differ (a few paths, for the report)."""
    out: list[str] = []

    def walk(a: Any, b: Any, path: str) -> None:
        if len(out) >= limit or a == b:
            return
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(set(a) | set(b), key=str):
                walk(a.get(k, "<absent>"), b.get(k, "<absent>"), f"{path}/{k}")
        elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
            for i, (x, y) in enumerate(zip(a, b)):
                walk(x, y, f"{path}[{i}]")
        else:
            out.append(f"{path or '/'}: {_short(a, 80)} -> {_short(b, 80)}")

    walk(json.loads(old) if old else "<absent>", json.loads(new) if new else "<absent>", "")
    return out


def _short(value: Any, n: int = 240) -> str:
    text = json.dumps(value, default=repr)
    return text if len(text) <= n else text[:n] + f"...({len(text)} chars)"


class Watch:
    """Sends messages and checks what each one did."""

    def __init__(self, hass, hass_storage, caplog, network, monkeypatch, command: str):
        self.hass = hass
        self.stored = hass_storage
        self.caplog = caplog
        self.network = network
        self.command = command
        self.config = hass.config.config_dir
        self.canary = Path(self.config).parent / "canary.txt"
        self.records: list[dict] = []
        self.answered: set[int] = set()
        self.timed_out: set[int] = set()
        self.urls: list[str] = []
        self.listening = False
        caplog.handler.setLevel(logging.WARNING)
        _hook_once()
        inner = aiohttp.ClientSession._request

        async def _request(session, method, url, *args, **kwargs):
            if self.listening:
                self.urls.append(f"{method} {url}")
            return await inner(session, method, url, *args, **kwargs)

        monkeypatch.setattr(aiohttp.ClientSession, "_request", _request)

    # What the message may not change.
    def storage(self) -> dict[str, str]:
        out = {k: v.get("data") for k, v in self.stored.items() if k.startswith(DOMAIN)}
        for store in STORES:
            if store.hass is self.hass and store.key.startswith(DOMAIN) and store._data is not None:
                data = store._data
                out[store.key] = data["data_func"]() if "data_func" in data else data.get("data")
        guests = out.get("padspan_ha.guests")
        if isinstance(guests, dict) and isinstance(guests.get("sessions"), dict):
            out["padspan_ha.guests"] = {**guests, "sessions": {
                sid: {k: v for k, v in sess.items() if k not in _GUEST_LIVE} if isinstance(sess, dict) else sess
                for sid, sess in guests["sessions"].items()}}
        for key, counted in COUNTED.items():
            if isinstance(out.get(key), dict):
                out[key] = {k: v for k, v in out[key].items() if k not in counted}
        # A store a command first opens is written with nothing in it but its
        # schema number: not a change.
        return {k: json.dumps(v, sort_keys=True, default=repr) for k, v in out.items()
                if k not in GATHERED and not (isinstance(v, dict) and not any(
                    x for name, x in v.items() if name not in ("schema", "version")))}

    def tree(self) -> dict[str, tuple[int, int]]:
        out = {}
        for path in Path(self.config).rglob("*"):
            if path.is_file() and _TRACE_SEGMENTS not in path.parts:
                st = path.stat()
                out[str(path.relative_to(self.config))] = (st.st_size, st.st_mtime_ns)
        return out

    def entities(self) -> set[str]:
        return set(self.hass.states.async_entity_ids()) | set(er.async_get(self.hass).entities)

    async def ask(self, client, msg: dict) -> dict | None:
        await client.send_json_auto_id(msg)
        mid = msg["id"]
        try:
            async with asyncio.timeout(ANSWER_S):
                while True:
                    reply = await client.receive_json()
                    if reply.get("type") != "result":
                        continue
                    if reply["id"] == mid:
                        self.answered.add(mid)
                        return reply
                    if reply["id"] in self.answered:
                        self.records.append({"command": self.command, "problems": [
                            f"a second answer to message {reply['id']}: {_short(reply)}"]})
                    self.answered.add(reply["id"])
        except TimeoutError:
            self.timed_out.add(mid)
            return None

    async def send(self, client, msg: dict, *, phase: str, field: str, hostile: H.Hostile,
                   must_refuse: bool = False) -> dict:
        before = (self.storage(), self.tree(), self.entities())
        canary = self.canary.stat().st_mtime_ns
        self.caplog.clear()     # every refusal is logged: kept, a long pass runs out of memory
        nlog, nnet = len(self.caplog.records), len(self.network)
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        _AUDIT["events"] = []
        _AUDIT["on"] = self.listening = True
        started = time.monotonic()
        try:
            reply = await self.ask(client, msg)
            took = time.monotonic() - started
            try:
                async with asyncio.timeout(2):
                    await self.hass.async_block_till_done()
            except TimeoutError:
                pass
        finally:
            _AUDIT["on"] = self.listening = False
        events, urls = list(_AUDIT["events"]), self.urls[:]
        self.urls.clear()
        after = (self.storage(), self.tree(), self.entities())

        problems = []
        if took > ANSWER_S and reply is not None:   # a handler that holds the event loop answers past the timeout
            problems.append(f"answered after {took:.0f} s")
        if reply is None:
            problems.append(f"no answer within {ANSWER_S:.0f} s")
            code = None
        elif reply["success"]:
            code = "ok"
        else:
            code = reply["error"]["code"]
            text = str(reply["error"].get("message"))
            if code == "unknown_error":
                problems.append(f"unknown_error: {text[:200]}")
            elif _PYTHON_WORDS.search(text):
                problems.append(f"refused with Python's own error text: {text[:200]}")
        problems += [_describe(r) for r in self.caplog.records[nlog:] if _bad_log(r)]
        changed = sorted(k for k in set(before[0]) | set(after[0]) if before[0].get(k) != after[0].get(k))
        files = sorted(k for k in set(before[1]) | set(after[1]) if before[1].get(k) != after[1].get(k))
        ents = sorted(before[2] ^ after[2])
        if code not in ("ok",) and (changed or files or ents):
            problems.append(f"refused, yet changed: stores {changed} files {files} entities {ents} "
                            f"{[_diff(before[0].get(k), after[0].get(k)) for k in changed][:2]}")
        if must_refuse and code == "ok":
            problems.append("a member did with this what they are refused with a valid message")
        grew = (resource.getrusage(resource.RUSAGE_SELF).ru_maxrss - peak) // 1024
        if grew > MEMORY_MB:
            problems.append(f"the process's peak memory grew by {grew} MB")
        fetches = FETCHES_A_CALLERS_URL.get(self.command) == field
        problems += [f"outside the config folder: {x}" for x in _outside(events, self.config)
                     if not (fetches and x.startswith("socket."))]
        if not self.canary.exists() or self.canary.stat().st_mtime_ns != canary:
            problems.append("the canary next to the config folder was touched")
        tried = urls + self.network[nnet:]
        problems += [f"fetched an address from the message: {u}" for u in tried
                     if any(h in u for h in ("127.0.0.1:1/", "169.254.169.254", "server/share", "etc/passwd"))]
        junk = [k for k in changed if code == "ok" and _JUNK.search(after[0][k])]
        record = {"command": self.command, "phase": phase, "field": field, "category": hostile.category,
                  "label": hostile.label, "message": _short(msg), "code": code, "took_s": round(took, 3),
                  "reply": _short(reply and (reply.get("result") if reply["success"] else reply["error"]), 300),
                  "stored": changed if code == "ok" else [], "files": files if code == "ok" else [],
                  "entities": ents if code == "ok" else [], "stored_junk": junk, "fetched": tried,
                  "problems": problems}
        self.records.append(record)
        return record

    async def phase(self, client, schema, phase: str, existing: dict[str, list[str]], *, member: bool) -> None:
        """Every planned message for the command, one field wrong at a time."""
        refused_valid: dict[str, bool] = {}
        for field, base, hostile in plan(self.command, schema, existing):
            if member and field not in refused_valid:
                valid = await self.ask(client, base)
                refused_valid[field] = valid is not None and not valid["success"] and                     valid["error"]["code"] in ("unauthorized", "admin_only")
            msg = {**base, **hostile.value} if hostile.category == "unknown" else {**base, field: hostile.value}
            await self.send(client, msg, phase=phase, field=field, hostile=hostile,
                            must_refuse=member and refused_valid[field])

    async def still_works(self, admin, schema, entry) -> None:
        """The command still answers its plain message, and the integration
        reloads."""
        msg = C.minimal_message(self.command, schema)
        reply = await self.ask(admin, msg)
        problems = []
        if reply is None:
            problems.append("no answer to the plain message after the pass")
        elif not reply["success"] and reply["error"]["code"] in ("unknown_error", "invalid_format"):
            problems.append(f"the plain message fails after the pass: {reply['error']}")
        nlog = len(self.caplog.records)
        if not await self.hass.config_entries.async_reload(entry.entry_id):
            problems.append("the integration did not reload after the pass")
        await self.hass.async_block_till_done()
        if entry.state is not ConfigEntryState.LOADED:
            problems.append(f"after the pass and a reload the integration is {entry.state}")
        problems += [f"log on reload {r.levelname} {r.name}: {r.getMessage()[:300]}"
                     for r in self.caplog.records[nlog:] if _bad_log(r)]
        self.records.append({"command": self.command, "phase": "afterwards", "problems": problems})

    def finish(self, test: str) -> None:
        for timer in counter_save_timers(self.hass):
            timer.cancel()
        if REPORT:
            worker = os.environ.get("PYTEST_XDIST_WORKER", "main")
            Path(REPORT).mkdir(parents=True, exist_ok=True)
            with open(Path(REPORT) / f"{worker}.jsonl", "a", encoding="utf-8") as fh:
                for r in self.records:
                    fh.write(json.dumps({"test": test, **r}, default=repr) + "\n")
        bad = [r for r in self.records if r["problems"]]
        assert not bad, f"{self.command}: {len(bad)} message(s) answered badly:\n" + "\n".join(
            f"  {r.get('phase')} {r.get('field')} {r.get('category')}/{r.get('label')} {r.get('message', '')[:200]}"
            f"\n      -> {r['problems']}" for r in bad[:15])


STORES: list = []


@pytest.fixture(autouse=True)
def _record_stores(monkeypatch):
    """Every Store made while the test runs, so a pending (not yet written)
    save is compared too."""
    STORES.clear()
    real = storage.Store.__init__

    def init(store, *args, **kwargs):
        real(store, *args, **kwargs)
        STORES.append(store)

    monkeypatch.setattr(storage.Store, "__init__", init)
    yield
    STORES.clear()


# ── what is sent ─────────────────────────────────────────────────────────────

def _fields(schema) -> list[tuple[str, Any]]:
    out = []
    for key, validator in schema.schema.items():
        if isinstance(key, vol.Remove) or key is vol.Extra:
            continue
        name = key.schema if isinstance(key, vol.Marker) else key
        if isinstance(name, str) and name not in ("id", "type"):
            out.append((name, validator))
    return out


def _accepted(schema, msg: dict) -> bool:
    try:
        schema({"id": 1, **msg})
    except vol.Invalid:
        return False
    return True


def _existing_value(name: str, validator: Any, existing: dict[str, list[str]]) -> Any | None:
    ids = existing.get(KIND_OF.get(name, ""), [])
    if not ids:
        return None
    return [ids[0]] if "list" in H.expects(validator) else ids[0]


def plan(command: str, schema, existing: dict[str, list[str]]) -> list[tuple[str, dict, H.Hostile]]:
    """(field, the valid message it is wrong in, the hostile value) for every
    message the command gets."""
    if schema is False:
        return [("(unknown)", {"type": C.PREFIX + command}, h) for h in H.UNKNOWN_FIELDS]
    module = DECLARED[command].module
    minimal = C.minimal_message(command, schema)
    every = C._fields(schema.schema, optional=True)
    fields = _fields(schema)
    for name, validator in fields:        # in the furnished house, name things that exist
        value = _existing_value(name, validator, existing)
        if name in minimal and value is not None and _accepted(schema, {**minimal, name: value}):
            minimal[name] = value
    out = []
    for name, validator in fields:
        if not ONLY_FIELDS.search(name):
            continue
        base = dict(minimal)
        if name not in base:
            value = _existing_value(name, validator, existing)
            if value is not None and _accepted(schema, {**base, name: value}):
                base[name] = value
            elif name in every:
                base[name] = every[name]
        for hostile in H.select(H.values_for(name, validator, module=module, existing=existing, kind_of=KIND_OF),
                                name, FULL):
            out.append((name, base, hostile))
    out += [("(unknown)", minimal, h) for h in H.UNKNOWN_FIELDS]
    return out


def _registered(hass) -> dict:
    return {t[len(C.PREFIX):]: v for t, v in hass.data[websocket_api.DOMAIN].items() if t.startswith(C.PREFIX)}


# ── the tests ────────────────────────────────────────────────────────────────

def test_the_pool_covers_every_field():
    """Each field of every command gets at least a wrong type, and each field
    that names a thing gets a thing that does not exist."""
    assert len(H.values_for("map_id", str, module="ws_maps")) > 30
    for name, validator in (("x", int), ("x", bool), ("x", dict), ("x", list), ("x", vol.In(("a", "b")))):
        assert any(v.category == "type" for v in H.values_for(name, validator, module="ws_maps")), validator


@pytest.mark.parametrize("command", sorted(DECLARED))
async def test_hostile_first_run(hass, padspan, admin, hass_ws_client, hass_storage, caplog, network, monkeypatch,
                                 command):
    """The house as installed: free, sample data, every extra off. (A new
    connection for each step: one left unread for a minute misses Home
    Assistant's heartbeat and is closed.)"""
    watch = Watch(hass, hass_storage, caplog, network, monkeypatch, command)
    schema = _registered(hass)[command][1]
    await watch.phase(admin, schema, "first_run/admin", {}, member=False)
    if FULL:
        await watch.phase(await _member(hass, hass_ws_client), schema, "first_run/member", {}, member=True)
    await watch.still_works(await hass_ws_client(hass), schema, padspan)
    watch.finish(f"first_run[{command}]")


@pytest.mark.parametrize("command", sorted(DECLARED))
async def test_hostile_furnished(hass, hass_ws_client, hass_storage, caplog, network, monkeypatch, command):
    """The last stable's house, data in every store, every switch on, a Pro
    key; an administrator and a member, Enhanced security on and off."""
    entry, admin = await _start(hass, hass_ws_client, monkeypatch)
    await _everything_on(hass)
    watch = Watch(hass, hass_storage, caplog, network, monkeypatch, command)
    schema = _registered(hass)[command][1]
    existing = existing_ids()
    await _secure(hass, True)
    await watch.phase(admin, schema, "furnished/admin/secure", existing, member=False)
    await watch.phase(await _member(hass, hass_ws_client), schema, "furnished/member/secure", existing, member=True)
    await _secure(hass, False)
    await watch.phase(await _member(hass, hass_ws_client), schema, "furnished/member/open", existing, member=True)
    if FULL:
        await watch.phase(await hass_ws_client(hass), schema, "furnished/admin/open", existing, member=False)
    await watch.still_works(await hass_ws_client(hass), schema, entry)
    watch.finish(f"furnished[{command}]")

