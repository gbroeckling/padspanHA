#!/usr/bin/env python
# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The manual's reference tables, made from the code.

    python scripts/build_manual_reference.py           rewrite the generated blocks in docs/manual/
    python scripts/build_manual_reference.py --check   change nothing; exit 1 if a block is out of date

There are no other arguments. It reads the integration's source (never imports
it, so it runs without Home Assistant) and writes only between the markers

    <!-- generated:NAME (scripts/build_manual_reference.py) -->
    ...
    <!-- /generated:NAME -->

in the chapters below. Everything outside the markers is written by hand.

What comes from the code, read each time:
  * entities: each entity class's unique id, unit and device class, every
    attribute its extra_state_attributes can return, and which of them Home
    Assistant's database leaves out (_unrecorded_attributes);
  * services: services.yaml, checked against the names the code registers;
  * events: every hass.bus.async_fire in the integration, with the keys of its data;
  * Assist: the intent's name, its slots and every answer it can give;
  * MQTT: the topics and the state payload's keys;
  * settings: every key in settings_store.DEFAULT_SETTINGS and the
    padspan_ha/settings_set schema, its default, and the range or choices
    ws_settings.py keeps it to.

What is written here by hand, because the code cannot say it: what each entity,
attribute, event field and setting means, and where a setting is in the panel.
Each of those is checked against the code: a hand-written line for something the
code no longer has, or code with no line here, stops the build with a message
saying what to add (tests/test_manual_reference.py runs it).
"""
from __future__ import annotations

import ast
import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "custom_components" / "padspan_ha"
WWW = PKG / "www" / "padspan-ha"
MANUAL = ROOT / "docs" / "manual"
HA_REFERENCE = MANUAL / "14-home-assistant-reference.md"
SETTINGS_REFERENCE = MANUAL / "20-settings-reference.md"
SCRIPT = "scripts/build_manual_reference.py"


class ReferenceError_(Exception):
    """The code and the hand-written lines here disagree; the text says what to change."""


# ── reading the code ────────────────────────────────────────────────────────

@lru_cache(maxsize=None)
def _tree(name: str) -> ast.Module:
    return ast.parse((PKG / name).read_text(encoding="utf-8"))


def _class(module: str, name: str) -> ast.ClassDef:
    for node in ast.walk(_tree(module)):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    raise ReferenceError_(f"{module} has no class {name}: update ENTITIES in {SCRIPT}")


def _function(module: str, name: str) -> ast.FunctionDef | ast.AsyncFunctionDef:
    for node in ast.walk(_tree(module)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    raise ReferenceError_(f"{module} has no function {name}")


def _method(cls: ast.ClassDef, name: str):
    for node in cls.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def _class_value(cls: ast.ClassDef, name: str):
    """A class-level `name = <literal>` (or annotated), as a Python value."""
    for node in cls.body:
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
        if any(isinstance(t, ast.Name) and t.id == name for t in targets) and node.value is not None:
            v = node.value
            if isinstance(v, ast.Call) and getattr(v.func, "id", "") == "frozenset" and v.args:
                return frozenset(ast.literal_eval(v.args[0]))
            if isinstance(v, ast.Attribute):          # SensorStateClass.MEASUREMENT and the like
                return v.attr.lower()
            try:
                return ast.literal_eval(v)
            except ValueError:
                return None
    return None


def _module_constants(module: str) -> dict[str, object]:
    out: dict[str, object] = {}
    for node in _tree(module).body:
        if isinstance(node, ast.Assign):
            try:
                value = ast.literal_eval(node.value)
            except ValueError:
                continue
            for t in node.targets:
                if isinstance(t, ast.Name):
                    out[t.id] = value
                elif isinstance(t, ast.Tuple) and isinstance(value, tuple):
                    for n, v in zip(t.elts, value):
                        if isinstance(n, ast.Name):
                            out[n.id] = v
    return out


# The helpers whose returned dict is spread into an entity's attributes.
_SPREAD = {"_guest_attrs": ("guest_tags.py", "tracker_attributes"),
           "status_attributes": ("vacation_mode.py", "status_attributes")}


def _returned_keys(fn, module: str) -> list[str]:
    """Every top-level key the dict `fn` returns can have, in the order the code writes them."""
    keys: list[str] = []

    def add(k: str) -> None:
        if k not in keys:
            keys.append(k)

    def from_dict(d: ast.Dict) -> None:
        for k, v in zip(d.keys, d.values):
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                add(k.value)
            elif k is None and isinstance(v, ast.Call):            # **helper(...)
                from_call(v)

    def from_call(call: ast.Call) -> None:
        name = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", "")
        if name in _SPREAD:
            mod, func = _SPREAD[name]
            for k in _returned_keys(_function(mod, func), mod):
                add(k)

    names: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Return) and node.value is not None:
            if isinstance(node.value, ast.Dict):
                from_dict(node.value)
            elif isinstance(node.value, ast.Name):
                names.add(node.value.id)
            elif isinstance(node.value, ast.Call):
                from_call(node.value)
    for node in ast.walk(fn):
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name) and t.id in names and isinstance(node.value, ast.Dict):
                    from_dict(node.value)
                if (isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id in names
                        and isinstance(t.slice, ast.Constant) and isinstance(t.slice.value, str)):
                    add(t.slice.value)
    return keys


_FSTRING_NAMES = {"safe": "id", "safe_key": "id", "safe_src": "receiver", "self._zid": "sub-zone id",
                  "self._suffix": "who|occupied", "entry.entry_id": "entry id", "tid": "team id"}


def _fstring(node) -> str:
    """An f-string as text, each {expr} shown as <name>."""
    if isinstance(node, ast.Constant):
        return str(node.value)
    out = ""
    for part in node.values:
        if isinstance(part, ast.Constant):
            out += str(part.value)
        else:
            src = ast.unparse(part.value)
            out += "<" + _FSTRING_NAMES.get(src, src) + ">"
    return out


def _unique_id(cls: ast.ClassDef, mixin: ast.ClassDef | None) -> str:
    suffix = _class_value(cls, "_suffix")
    for c in (cls, mixin):
        if c is None:
            continue
        m = _method(c, "unique_id")
        if m is not None:
            for node in ast.walk(m):
                if isinstance(node, ast.Return) and isinstance(node.value, (ast.JoinedStr, ast.Constant)):
                    text = _fstring(node.value)
                    return text.replace("<who|occupied>", suffix) if suffix else text
        init = _method(c, "__init__")
        if init is not None:
            for node in ast.walk(init):
                if (isinstance(node, ast.Assign) and any(ast.unparse(t) == "self._attr_unique_id" for t in node.targets)
                        and isinstance(node.value, (ast.JoinedStr, ast.Constant))):
                    return _fstring(node.value)
    raise ReferenceError_(f"{cls.name}: no unique id found")


def _attributes(module: str, cls: ast.ClassDef, mixin: ast.ClassDef | None) -> list[str]:
    for c in (cls, mixin):
        if c is not None and (m := _method(c, "extra_state_attributes")) is not None:
            return _returned_keys(m, module)
    return []


# ── entities: what the code can't say ───────────────────────────────────────

# One entry per entity class. "attributes" gives every attribute the code can
# return its meaning; "also" lists attributes Home Assistant adds itself.
ENTITIES: list[dict] = [
    {
        "module": "device_tracker.py", "cls": "PadSpanDeviceTracker", "platform": "device_tracker",
        "entity_id": "device_tracker.<device>",
        "state": "The room it is in, by its Home Assistant name (`Kitchen`). `not_home` once it has gone unheard "
                 "for the away timeout. Before it has a room: Home Assistant's own `unknown`.",
        "exists": "For each device you named in PadSpan: a Bluetooth address, a phone or watch named through its key "
                  "(IRK), or an iBeacon. Attach it to a person in Home Assistant's Settings → People.",
        "attributes": {
            "address": "The Bluetooth address it was last heard on.",
            "padspan_id": "PadSpan's own id for the device, the same across address changes.",
            "rssi": "Its smoothed signal strength in dBm at the receiver that hears it best. Empty while away.",
            "age_s": "Seconds since it was last heard.",
            "user_label": "The name you gave it in PadSpan.",
            "home": "`true` while it has been heard within the away timeout.",
            "last_room": "The last room it was placed in. It stays once the state is `not_home`.",
            "guest_session": "Only while it is a guest tag lent to someone: the stay's id.",
            "guest_name": "Only while lent: the guest's name.",
            "guest_since": "Only while lent: when the stay started (UTC).",
            "guest_until": "Only while lent: when the stay is planned to end (UTC), or empty.",
            "guest_off_limits": "Only while lent: the rooms the guest was asked to keep out of.",
            "guest_in_off_limits": "Only while lent: `true` while the tag is in one of those rooms.",
        },
        "also": {
            "source_type": "`bluetooth_le`.",
            "latitude, longitude, gps_accuracy": "Only when the house has a GPS origin set (it is off unless set): the "
                                                 "device's position turned into latitude and longitude, so Home "
                                                 "Assistant's map can draw it.",
        },
    },
    {
        "module": "sensor.py", "cls": "PadSpanAreaSensor", "platform": "sensor",
        "entity_id": "sensor.<device>_area",
        "state": "The room it is in, by its Home Assistant name. `not_home` once away, `unknown` while it has no room.",
        "exists": "For each named device, like the tracker.",
        "attributes": {
            "kind": "`ble` (a Bluetooth address), `private_ble` (a phone or watch named through its key) or `ibeacon`.",
            "address": "The Bluetooth address it was last heard on.",
            "padspan_id": "PadSpan's own id for the device, the same across address changes.",
            "rssi": "Its smoothed signal strength in dBm at the receiver that hears it best. Empty while away.",
            "age_s": "Seconds since it was last heard.",
            "sources": "The receivers hearing it now. Empty while away.",
            "home": "`true` while it has been heard within the away timeout.",
            "last_room": "The last room it was placed in. It stays once the state is `not_home`.",
            "room_confidence": "0 to 1: how much of the recent room vote agrees on this room.",
            "rssi_margin_confidence": "0 to 1: how far the winning room's signal is ahead of the next room's.",
            "room_unsure": "Only with **Mark a room as unsure when the signal is thin** on, and only while unsure: "
                           "`few_scanners` (fewer than 3 receivers hear it) or `far_fingerprint` (no calibration "
                           "point matches it well). The room is the one it had.",
            "ibeacon_uuid": "An iBeacon's UUID.",
            "ibeacon_major": "An iBeacon's major number.",
            "ibeacon_minor": "An iBeacon's minor number.",
            "num_addresses": "For a device whose address changes: how many addresses PadSpan has seen it use.",
            "all_addresses": "For a device whose address changes: the first five of those addresses.",
            "room_reason": "Only with **Why This Room (Sensor Attribute)** on: why it is in this room. "
                           "`votes_won`, `votes_needed` and `vote_window` (the room vote), `gate_active` (a jump to "
                           "another room is held back until more polls agree), `current_room_bias` (the room was "
                           "kept although another read slightly stronger), `source` (which step chose the room), "
                           "`positioning` (that step's note), `top_room_scores` (the three best rooms) and "
                           "`room_held` (shown through a short gap).",
        },
    },
    {
        "module": "sensor.py", "cls": "PadSpanDistanceSensor", "platform": "sensor",
        "entity_id": "sensor.<device>_distance",
        "state": "Its estimated distance in metres from the receiver that hears it best. Empty while away.",
        "exists": "For each named device, like the tracker.",
        "attributes": {
            "rssi": "Its smoothed signal strength in dBm.",
            "tx_power": "The transmit power the device advertises, if it does.",
            "age_s": "Seconds since it was last heard.",
            "room": "The room it is in.",
        },
    },
    {
        "module": "sensor.py", "cls": "PadSpanScannerDistanceSensor", "platform": "sensor",
        "entity_id": "sensor.<device>_distance_<receiver>",
        "state": "Its estimated distance in metres from that one receiver. Empty while away or while that receiver "
                 "does not hear it.",
        "exists": "One for each named device and receiver, made the first time that receiver hears it.",
        "attributes": {
            "scanner": "The receiver.",
            "rssi": "Its signal strength in dBm at that receiver.",
            "age_s": "Seconds since it was last heard.",
            "room": "The room it is in (decided by all receivers, not this one alone).",
        },
    },
    {
        "module": "sensor.py", "cls": "PadSpanOccupancySensor", "platform": "sensor",
        "entity_id": "sensor.padspan_occupancy_occupancy",
        "state": "How many people PadSpan thinks are in the house, worked out every 30 seconds.",
        "exists": "Only with `sensor.padspan_occupancy_occupancy` ticked in Manage → HA Entities → Entity Publishing "
                  "Controls (off unless ticked), after PadSpan reloads.",
        "attributes": {
            "minimum": "The fewest people the evidence allows.",
            "maximum": "The most people the evidence allows.",
            "confidence": "How sure the estimate is.",
            "known": "People placed by their own named devices.",
            "unknown": "People counted from phones nobody named and from sensors.",
            "people": "Each known person: `name`, `room` and `kind`.",
            "rooms": "Each room's evidence: `people`, `phones`, `occupancy` and `motion`.",
        },
    },
    {
        "module": "sensor.py", "cls": "PadSpanSubzoneWhoSensor", "platform": "sensor",
        "mixin": ("subzones.py", "SubzoneEntityMixin"),
        "entity_id": "sensor.padspan_<sub-zone>_who",
        "state": "The names of the named devices in the sub-zone, separated by commas, or `none`.",
        "exists": "For each sub-zone (a bed, a couch, a desk drawn in Mapping → Edit → Sub-zones), with sub-zones "
                  "switched on in Manage → HA Entities → Entity Publishing Controls.",
        "attributes": {
            "people": "The names of the named devices in it.",
            "count": "How many.",
            "room": "The room it was drawn in.",
            "floor_id": "Its floor.",
            "subzone_id": "PadSpan's id for the sub-zone.",
        },
    },
    {
        "module": "binary_sensor.py", "cls": "PadSpanSubzoneOccupied", "platform": "binary_sensor",
        "mixin": ("subzones.py", "SubzoneEntityMixin"),
        "entity_id": "binary_sensor.padspan_<sub-zone>_occupied",
        "state": "`on` while any named device is in the sub-zone.",
        "exists": "With the sub-zone's `who` sensor.",
        "attributes": "same as sensor.padspan_<sub-zone>_who",
    },
    {
        "module": "binary_sensor.py", "cls": "PadSpanVacationMode", "platform": "binary_sensor",
        "entity_id": "binary_sensor.padspan_vacation_mode",
        "state": "`on` while Vacation Mode runs.",
        "exists": "Always.",
        "attributes": {
            "since": "When this vacation started (UTC). Empty while off.",
            "routine": "Which routine it switches lights by: `own` (learned for this trip), `resumed` (the last trip's, "
                       "turned back on within three weeks), `standin` (the last one learned, while this trip's is "
                       "not built yet) or `none`. Empty while off.",
            "source": "Where each day's routine comes from: `last_week` (the same day last week) or `month` (that "
                      "weekday's average over the last month).",
            "paused_someone_home": "`true` while it waits because someone is home.",
            "ends": "When the trip ends by itself (UTC), or empty.",
            "intensity": "5 to 100: how much of the usual lighting it switches.",
            "after_dark_only": "`true` when lights go on only after sunset.",
            "pause_when_home": "`true` when it waits while anyone is home.",
            "bedtime": "The time lights go off (HH:MM), or empty.",
            "max_on_minutes": "The longest a light it turned on stays on, or empty.",
            "max_lights_at_once": "The most lights on at once, or empty.",
            "anchor_lights": "Lights held on through the evening, or empty.",
            "last_off": "When it was last turned off (UTC).",
            "last_off_by": "Who or what turned it off last: the person's name, or `end_date` or `reset`.",
        },
    },
    {
        "module": "binary_sensor.py", "cls": "PadSpanGuestHome", "platform": "binary_sensor",
        "entity_id": "binary_sensor.padspan_guest_home",
        "state": "`on` while a guest's tag is heard in the house.",
        "exists": "From the first time guest tags are switched on.",
        "attributes": {
            "guests": "Each guest staying now: `name`, `tag`, `home` (`true` while heard) and `room`.",
        },
    },
    {
        "module": "light.py", "cls": "PadSpanTeamLight", "platform": "light",
        "entity_id": "light.<power team>",
        "state": "`on` or `off`: the team's power. Turning it on switches the power on, then sends the bulbs "
                 "their colour once they answer. Colour temperature 2000 to 6500 K, or a colour.",
        "exists": "For each power team (a wall dimmer or switch and the smart bulbs it feeds). Effects `Adaptive` "
                  "(follows the day) and `Sleep`, for a team set to follow the day.",
        "attributes": {
            "padspan_power_team": "Always `true`: this light is a PadSpan power team.",
            "power": "The switch or dimmer that powers the bulbs, or empty for a team of bulbs only.",
            "bulbs": "The bulbs in the team.",
            "phase": "`off`, `starting` (the bulbs are waking), `ready` or `failed` (some never answered).",
            "missing": "The bulbs that did not answer.",
            "follows_the_day": "`true` while its effect is `Adaptive`.",
        },
    },
]

# Entity base classes Home Assistant defines: a class built on one of them in a
# platform file is an entity PadSpan creates, and must be in ENTITIES.
_ENTITY_BASES = {"SensorEntity", "BinarySensorEntity", "TrackerEntity", "LightEntity"}
PLATFORM_FILES = ("sensor.py", "binary_sensor.py", "device_tracker.py", "light.py")


def entity_classes_in_code() -> set[tuple[str, str]]:
    out = set()
    for mod in PLATFORM_FILES:
        for node in ast.walk(_tree(mod)):
            if isinstance(node, ast.ClassDef):
                bases = {b.id if isinstance(b, ast.Name) else getattr(b, "attr", "") if not isinstance(b, ast.Subscript)
                         else getattr(b.value, "id", "") for b in node.bases}
                if bases & _ENTITY_BASES:
                    out.add((mod, node.name))
    return out


def _entities_block() -> str:
    described = {(e["module"], e["cls"]) for e in ENTITIES}
    missing = entity_classes_in_code() - described
    if missing:
        raise ReferenceError_(f"Entities with no entry in ENTITIES ({SCRIPT}): {sorted(missing)}")
    lines: list[str] = []
    by_id = {e["entity_id"]: e for e in ENTITIES}
    for e in ENTITIES:
        cls = _class(e["module"], e["cls"])
        mixin = _class(*e["mixin"]) if e.get("mixin") else None
        attrs_in_code = _attributes(e["module"], cls, mixin)
        meanings = e["attributes"]
        if isinstance(meanings, str):                       # "same as <entity id>"
            meanings = by_id[meanings.removeprefix("same as ")]["attributes"]
        unknown = [a for a in attrs_in_code if a not in meanings]
        gone = [a for a in meanings if a not in attrs_in_code]
        if unknown or gone:
            raise ReferenceError_(
                f"{e['cls']} ({e['module']}): attributes in the code with no meaning in {SCRIPT}: {unknown}; "
                f"meanings for attributes the code no longer has: {gone}")
        unrecorded = _class_value(cls, "_unrecorded_attributes") or frozenset()
        unit = _class_value(cls, "_attr_native_unit_of_measurement")
        dclass = _class_value(cls, "_attr_device_class")
        lines += [f"### `{e['entity_id']}`", "", "| | |", "|---|---|",
                  f"| Platform | `{e['platform']}` |",
                  f"| Unique id | `{_unique_id(cls, mixin)}` |"]
        if unit:
            lines.append(f"| Unit | {unit} |")
        if dclass:
            lines.append(f"| Device class | `{dclass}` |")
        lines += [f"| State | {e['state']} |", f"| There | {e['exists']} |", ""]
        if attrs_in_code or e.get("also"):
            lines += ["| Attribute | What it is | In HA's history |", "|---|---|---|"]
            for a in attrs_in_code:
                lines.append(f"| `{a}` | {meanings[a]} | {'no' if a in unrecorded else 'yes'} |")
            for a, text in (e.get("also") or {}).items():
                names = ", ".join(f"`{n.strip()}`" for n in a.split(","))
                lines.append(f"| {names} | Home Assistant's own. {text} | yes |")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ── services ────────────────────────────────────────────────────────────────

def registered_services() -> set[str]:
    """The service names the code registers with hass.services.async_register."""
    out: set[str] = set()
    consts = _module_constants("__init__.py")
    for mod in ("__init__.py", "wled_exact.py"):
        for node in ast.walk(_tree(mod)):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "async_register" and ast.unparse(node.func.value) == "hass.services"):
                arg = node.args[1]
                if isinstance(arg, ast.Constant):
                    out.add(arg.value)
                elif isinstance(arg, ast.Name) and arg.id in consts:
                    out.add(str(consts[arg.id]))
    return out


def _selector_words(sel: dict | None) -> str:
    if not sel:
        return ""
    kind, conf = next(iter(sel.items()))
    conf = conf or {}
    if kind == "number":
        unit = f" {conf['unit_of_measurement']}" if conf.get("unit_of_measurement") else ""
        return f"number, {conf.get('min')} to {conf.get('max')}{unit}"
    return {"boolean": "true or false", "object": "a mapping"}.get(kind, kind)


# A field services.yaml gives no description: what it does.
FIELD_NOTES = {
    ("set_room_tag_map", "room_tag_map"): "Room name → list of PadSpan object keys. Replaces the whole map.",
}


def _services_block() -> str:
    data = yaml.safe_load((PKG / "services.yaml").read_text(encoding="utf-8"))
    if set(data) != registered_services():
        raise ReferenceError_(f"services.yaml lists {sorted(data)} but the code registers {sorted(registered_services())}")
    lines: list[str] = []
    for name, svc in data.items():
        lines += [f"### `padspan_ha.{name}`: {svc.get('name', name)}", "", " ".join(str(svc.get("description", "")).split()), ""]
        target = svc.get("target")
        if target:
            ent = (target.get("entity") or {})
            lines += [f"Target: `{ent.get('domain')}` entities of the `{ent.get('integration')}` integration.", ""]
        fields = svc.get("fields") or {}
        if fields:
            lines += ["| Field | Required | Takes | Default | What it does |", "|---|---|---|---|---|"]
            for fname, f in fields.items():
                default = f.get("default")
                what = " ".join(str(f.get("description") or "").split()) or FIELD_NOTES.get((name, fname))
                if not what:
                    raise ReferenceError_(f"services.yaml {name}.{fname} has no description: add one to FIELD_NOTES in {SCRIPT}")
                lines.append(f"| `{fname}` | {'yes' if f.get('required') else 'no'} | {_selector_words(f.get('selector'))} | "
                             f"{'' if default is None else json.dumps(default)} | {what} |")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ── events ──────────────────────────────────────────────────────────────────

EVENTS: dict[str, dict] = {
    "padspan_device_arrived": {
        "when": "A named device is heard again after being away (not on the first poll after Home Assistant starts).",
        "data": {"device_key": "PadSpan's key for the device.", "label": "Its name.", "room": "The room it arrived in, if known."},
    },
    "padspan_device_departed": {
        "when": "A named device has gone unheard for the away timeout.",
        "data": {"device_key": "PadSpan's key for the device.", "label": "Its name."},
    },
    "padspan_room_change": {
        "when": "A followed device moves to another room, with **Room-change tag events** on (Settings → Tracking → "
                "Home Assistant and integrations → HA Tags Integration; off unless switched on). At most one every "
                "30 seconds per device: a move inside that time is sent when it ends, if the device is still elsewhere.",
        "data": {"object_key": "PadSpan's key for the device.", "label": "Its name.", "from_room": "The room it left.",
                 "to_room": "The room it is in now.", "tag_id": "The Home Assistant tag id sent with it (`padspan_…`).",
                 "timestamp": "When, in seconds since 1970 (UTC)."},
    },
    "padspan_nfc_identify_result": {
        "when": "With **NFC tap-to-identify** on: after a phone scans an NFC tag, whether PadSpan named the strongest "
                "unnamed Bluetooth signal in that phone's room.",
        "data": {"success": "`true` when it named one.", "reason": "Why not: `no_candidates`.",
                 "object_key": "PadSpan's key for the device it named.", "label": "The name it gave.",
                 "room": "The phone's room.", "rssi": "That device's signal strength in dBm.",
                 "tag_id": "The NFC tag scanned."},
    },
    "padspan_phone_autolinked": {
        "when": "With **Phone auto-link on NFC scan** on: a phone that scanned an NFC tag is now followed by its "
                "BLE Transmitter.",
        "data": {"device_id": "The phone's Home Assistant device id.", "device_name": "Its name.",
                 "ibeacon_key": "PadSpan's key for its BLE Transmitter."},
    },
    "padspan_ha_guest": {
        "when": "With guest tags on: a stay starts or ends, the guest arrives or leaves, stays in a room they were asked "
                "to keep out of, or has not been heard for a while.",
        "data": {"type": "`started`, `arrived`, `left`, `off_limits`, `reminder` or `ended`.",
                 "session": "The stay's id.", "guest": "The guest's name.", "tag": "The tag's name."},
        # Added from the detail passed to guest_tags.fire (its **detail): not seen by the AST.
        "detail": {"room": "For `arrived`, `left` and `off_limits`: the room.",
                   "how": "For `ended`: `manual`, `scheduled` or `stale` (not heard for long enough)."},
    },
    "padspan_ha_vacation_mode": {
        "when": "Vacation Mode is turned on or off, or pauses because someone is home.",
        "data": {"on": "`true` while it runs.",
                 "how": "`panel` (switched in PadSpan), `resumed` (turned back on, carrying on the last trip), "
                        "`end_date`, `reset` (a Factory Reset), `paused_home` or `unpaused`."},
    },
}


def events_in_code() -> dict[str, dict]:
    """{event: {"keys": [...], "spread": bool, "files": [...]}} for every bus.async_fire."""
    out: dict[str, dict] = {}
    for path in sorted(PKG.glob("*.py")):
        tree = _tree(path.name)
        consts = _module_constants(path.name)
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "async_fire"
                    and ast.unparse(node.func.value).endswith("bus")):
                continue
            first = node.args[0]
            name = first.value if isinstance(first, ast.Constant) else consts.get(getattr(first, "id", ""))
            if not isinstance(name, str):
                raise ReferenceError_(f"{path.name}:{node.lineno}: an event whose name is not a constant")
            ev = out.setdefault(name, {"keys": [], "spread": False, "files": []})
            if path.name not in ev["files"]:
                ev["files"].append(path.name)
            if len(node.args) > 1 and isinstance(node.args[1], ast.Dict):
                for k in node.args[1].keys:
                    if k is None:
                        ev["spread"] = True
                    elif isinstance(k, ast.Constant) and k.value not in ev["keys"]:
                        ev["keys"].append(k.value)
    return out


def _events_block() -> str:
    code = events_in_code()
    if set(code) != set(EVENTS):
        raise ReferenceError_(f"Events in the code: {sorted(code)}; described in {SCRIPT}: {sorted(EVENTS)}")
    lines: list[str] = []
    for name, ev in EVENTS.items():
        keys = code[name]["keys"]
        unknown = [k for k in keys if k not in ev["data"]]
        gone = [k for k in ev["data"] if k not in keys]
        if unknown or gone or bool(ev.get("detail")) != code[name]["spread"]:
            raise ReferenceError_(f"{name}: data keys in the code with no meaning: {unknown}; meanings for keys the "
                                  f"code no longer sends: {gone}; detail spread in code: {code[name]['spread']}")
        lines += [f"### `{name}`", "", ev["when"], "", "| Data | What it is |", "|---|---|"]
        for k in keys:
            lines.append(f"| `{k}` | {ev['data'][k]} |")
        for k, text in (ev.get("detail") or {}).items():
            lines.append(f"| `{k}` | {text} |")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ── Assist ──────────────────────────────────────────────────────────────────

def _assist_block() -> str:
    consts = _module_constants("intents.py")
    fn = _function("intents.py", "where_is_answer")
    found = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Return) and isinstance(node.value, (ast.JoinedStr, ast.Constant)):
            found.append((node.lineno, _fstring(node.value).replace("<who>", "<name>").replace("<spoken>", "<name>")))
    answers = [a for _n, a in sorted(found)]
    slots: list[str] = []
    handler = _class("intents.py", "WhereIsHandler")
    for node in ast.walk(handler):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "slot_schema" for t in node.targets):
            for k in node.value.keys:
                if isinstance(k, ast.Call) and k.args and isinstance(k.args[0], ast.Constant):
                    slots.append(k.args[0].value)
    sure = consts.get("_SURE")
    lines = [f"Intent: `{consts['INTENT_WHERE_IS']}`. Slots: " + ", ".join(f"`{s}`" for s in slots) + ".", "",
             "What it answers, in English:", ""]
    lines += [f"- \"{a}\"" for a in answers]
    lines += ["", f"\"probably\" when the room's `room_confidence` is under {sure}."]
    return "\n".join(lines) + "\n"


# ── MQTT ────────────────────────────────────────────────────────────────────

def _mqtt_block() -> str:
    fn = _function("presence_coordinator.py", "_async_mqtt_publish")
    payload: list[str] = []
    topics: list[str] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "payload" for t in node.targets) \
                and isinstance(node.value, ast.Dict):
            payload = [k.value for k in node.value.keys if isinstance(k, ast.Constant)]
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "async_publish" and len(node.args) > 1:
            topics.append(_fstring(node.args[1]).replace("<topic_base>", "padspan/devices/<device>"))
    lines = ["| Topic | Holds |", "|---|---|"]
    holds = {"state": "JSON: " + ", ".join(f"`{k}`" for k in payload),
             "area": "The room, `not_home` or `unknown`, as on the area sensor.",
             "distance": "The distance in metres. Not sent while away."}
    for t in topics:
        lines.append(f"| `{t}` | {holds[t.rsplit('/', 1)[-1]]} |")
    return "\n".join(lines) + "\n"


# ── the blocks, and writing them ────────────────────────────────────────────

def blocks() -> dict[Path, dict[str, str]]:
    """Every generated block, by chapter file and block name."""
    from_settings = _settings_blocks() if SETTINGS_ENTRIES else {}
    out = {HA_REFERENCE: {"entities": _entities_block(), "services": _services_block(), "events": _events_block(),
                          "assist": _assist_block(), "mqtt": _mqtt_block()}}
    if from_settings:
        out[SETTINGS_REFERENCE] = from_settings
    return out


def _marker(name: str) -> tuple[str, str]:
    return f"<!-- generated:{name} ({SCRIPT}) -->", f"<!-- /generated:{name} -->"


def committed_block(text: str, name: str) -> str | None:
    start, end = _marker(name)
    if start not in text or end not in text:
        return None
    return text.split(start, 1)[1].split(end, 1)[0].strip("\n") + "\n"


def fill(text: str, name: str, body: str) -> str:
    start, end = _marker(name)
    if start not in text or end not in text:
        raise ReferenceError_(f"no {start} … {end} in the chapter")
    head, rest = text.split(start, 1)
    _old, tail = rest.split(end, 1)
    return f"{head}{start}\n{body}{end}{tail}"


def stale() -> list[str]:
    """The blocks whose committed text differs from what the code makes now."""
    out = []
    for path, named in blocks().items():
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        for name, body in named.items():
            if committed_block(text, name) != body:
                out.append(f"{path.relative_to(ROOT).as_posix()}: {name}")
    return out


def write() -> list[str]:
    changed = []
    for path, named in blocks().items():
        text = path.read_text(encoding="utf-8")
        new = text
        for name, body in named.items():
            new = fill(new, name, body)
        if new != text:
            path.write_text(new, encoding="utf-8", newline="\n")
            changed.append(path.relative_to(ROOT).as_posix())
    return changed


# ── settings (chapter 20) ───────────────────────────────────────────────────
# Filled in below.

SETTINGS_ENTRIES: dict[str, tuple] = {}


def _settings_blocks() -> dict[str, str]:
    return {}


def main(argv: list[str]) -> int:
    if argv not in ([], ["--check"]):
        print(__doc__)
        return 2
    try:
        if argv == ["--check"]:
            bad = stale()
            for b in bad:
                print(f"out of date: {b}")
            return 1 if bad else 0
        for c in write():
            print(f"wrote {c}")
        return 0
    except ReferenceError_ as err:
        print(f"error: {err}")
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
