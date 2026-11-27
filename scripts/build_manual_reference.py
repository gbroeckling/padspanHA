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
    ws_settings.py keeps it to;
  * the menu (chapter 12): every screen in panel.js MENU, whether it is in the
    main list or under More tools in each mode, its heading, the screens shown
    only while something holds, and the phone's bottom bar.

What is written here by hand, because the code cannot say it: what each entity,
attribute, event field, setting and screen means, where a setting is in the
panel, and when a screen that is not always in the menu is there.
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
SCREENS_CHAPTER = MANUAL / "12-the-screens.md"
DEVELOPERS_APPENDIX = MANUAL / "D-for-developers.md"
SCREENS_APPENDIX = MANUAL / "B-every-screen-and-tab.md"
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
        if isinstance(node, (ast.Assign, ast.AnnAssign)) and node.value is not None:
            try:
                value = ast.literal_eval(node.value)
            except ValueError:
                continue
            for t in (node.targets if isinstance(node, ast.Assign) else [node.target]):
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
                 "their colour once they answer. Colour temperature 2000 to 6500 K, or a colour, and a fade "
                 "(`transition`) of any length.",
        "exists": "For each power team (a wall dimmer or switch and the smart bulbs it feeds). Effects `Adaptive` "
                  "(follows the day) and `Sleep`, for a team set to follow the day.",
        "attributes": {
            "padspan_power_team": "Always `true`: this light is a PadSpan power team.",
            "team_id": "PadSpan's id for the team.",
            "power": "The switch or dimmer that powers the bulbs, or empty for a team of bulbs only.",
            "bulbs": "The bulbs in the team.",
            "phase": "`off`, `starting` (the bulbs are waking), `ready` or `failed` (some never answered).",
            "missing": "The bulbs that did not answer.",
            "follows_the_day": "`true` while its effect is `Adaptive`.",
            "turns_off": "`power` (off cuts the power) or `bulbs` (off turns the bulbs off and leaves the power on).",
            "waking": "`true` while the light is the team's wake-up: its slow fade, then its brightness and colour.",
            "fading": "`true` while a wake-up's slow fade is still running.",
            "brightness_follows": "`true` while the day leads its brightness (`false` once a brightness was set by hand, or in Sleep).",
            "going_off": "`true` while a bedtime (or Sleep in 30 min) is fading it to Sleep and will turn it off at the end.",
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
    for mod in ("__init__.py", "wled_exact.py", "screens.py"):
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


# ── the menu (chapter 12): what panel.js says ───────────────────────────────
# MENU (every screen and its English name), BASIC_TABS and ADVANCED_DEFAULT
# (the main list in each mode; the rest are under More tools), MENU_GROUPS (the
# headings of the 2025 style), the screens _getVisibleTabs leaves out until a
# condition holds, the ones _getMainTabs puts in every mode's main list, the
# phone's bottom bar, and the screens Settings → UI Structure can move into
# Advanced's main list (settings.js _DEV_ONLY_TABS). Written here by hand: what
# each screen is, and when a gated one is in the menu.

def _js_block(src: str, start: str) -> str:
    """The text from `start` to the end of its statement: the first `];` or `]);` after it."""
    if start not in src:
        raise ReferenceError_(f"panel.js no longer has {start!r}")
    rest = src[src.index(start) + len(start):]
    return rest[:re.search(r"\]\)?;", rest).end()]


def _js_method(src: str, name: str) -> str:
    """A class method's body, from `name(){` to the next line holding only `}` at its indent."""
    m = re.search(r"^( *)" + re.escape(name) + r"\(\)\s*\{\n", src, re.M)
    if not m:
        raise ReferenceError_(f"panel.js no longer has {name}()")
    end = src.index("\n" + m.group(1) + "}\n", m.end())
    return src[m.end():end]


def menu_in_code() -> dict:
    src = (WWW / "panel.js").read_text(encoding="utf-8")
    menu = re.findall(r'\["(\w+)","([^"]+)","mdi:[^"]+"\]', _js_block(src, "const MENU = ["))
    ids = lambda block: re.findall(r'"(\w+)"', block)  # noqa: E731
    groups = [(g, ids(members)) for g, members in
              re.findall(r'\["(\w+)",\s*\[([^\]]*)\]\]', _js_block(src, "const MENU_GROUPS = ["))]
    visible = _js_method(src, "_getVisibleTabs")
    gated = dict((tab, cond) for cond, tab in re.findall(r'if \((.+?)\) out\.delete\("(\w+)"\)', visible))
    pinned = re.search(r"const pinned = isBasic\s*\?\s*\[([^\]]*)\]\s*:\s*\[([^\]]*)\]", src)
    settings_src = (WWW / "views" / "settings.js").read_text(encoding="utf-8")
    tickable = re.search(r"const _DEV_ONLY_TABS = \[([^\]]*)\]", settings_src)
    if not (menu and groups and gated and pinned and tickable):
        raise ReferenceError_("panel.js's menu has changed shape: the menu map can't be read from it")
    return {
        "menu": menu,
        "basic": ids(_js_block(src, "const BASIC_TABS = new Set([")),
        "advanced": ids(_js_block(src, "const ADVANCED_DEFAULT = new Set([")),
        "groups": groups,
        "gated": gated,
        "every_mode": re.findall(r'out\.add\("(\w+)"\)', _js_method(src, "_getMainTabs")),
        "pinned_basic": ids(pinned.group(1)),
        "pinned_other": ids(pinned.group(2)),
        "tickable": ids(tickable.group(1)),
    }


# What each screen is, in a line. Every screen in MENU has one, and nothing else.
SCREENS = {
    "overview": "Where everyone and everything is now, on a drawing of your house; before any room is drawn, Who's where now.",
    "purelive": "The live map on its own, full screen, for a wall tablet or a second screen.",
    "follow": "One person or thing: its room now, its movements, Locate (Pro or Presence insights) and alerts when it moves.",
    "occupancy": "How many people are in the building, and how the number was reached.",
    "guests": "Guest tags: who is staying now, the tags you lend, and past stays.",
    "setup": "The steps from a floor plan to a calibrated map, in order.",
    "maps": "Floor plans, their scale, rooms, receivers, floors, and the Atlas builder.",
    "rooms": "Every room's settings in one place: colour, outline, ceiling height, receivers, who is in it.",
    "receivers": "Every receiver in one table: room, floor, height, signal adjustment, status.",
    "calibration": "Teach PadSpan what each spot sounds like, and see how accurate it is.",
    "training": "Animated walkthroughs and the Full Manual, inside the panel.",
    "manage": "Data clean-ups, backups, Home Assistant entities, alerts by email or phone, logs, Factory Reset.",
    "settings": "Every setting, in tabs.",
    "traceback": "Replay where devices went, with Insights (time in each room) and Busy Times (Pro or Presence insights).",
    "health": "Is PadSpan working? Its own checks, receivers' health, and Problems found.",
    "forensics": "Pro or the Presence insights add-on: which Bluetooth devices were near your receivers between two times.",
    "monitor": "What PadSpan hears, in numbers, and Export for support.",
    "devices": "Every device PadSpan tracks or hears, in four lists, and the device registry.",
    "bluetooth": "What each receiver hears, and the IRK Manager for phones and watches.",
    "presence": "For experts: which rooms each device has been seen in, and what each receiver hears.",
    "qa": "Checks on your setup, backups, and each receiver ranked.",
    "sandbox": "A look under the hood at the live data; changes nothing.",
    "installbase": "The developer's screen for the opt-in usage reports; asks for a PIN.",
    "wifi": "A test: how strongly your Wi-Fi access points hear each part of the house, from UniFi Utopia.",
}

# When a screen the menu leaves out until something holds is there (_getVisibleTabs).
SHOWN_WHEN = {
    "forensics": "While Forensics is on (Settings → Features → Forensics)",
    "guests": "While guest tags are on (Settings → Tracking → Phones and guest tags)",
    "setup": "Until every step is done, or setup is skipped",
    "wifi": "While UniFi Utopia's Wi-Fi survey answers, with Pro or the Wi-Fi coverage add-on",
}


def _menu_block() -> str:
    code = menu_in_code()
    menu_ids = [i for i, _ in code["menu"]]
    if set(menu_ids) != set(SCREENS):
        raise ReferenceError_(f"Screens in panel.js MENU with no words in SCREENS ({SCRIPT}): "
                              f"{sorted(set(menu_ids) - set(SCREENS))}; words for screens MENU no longer has: "
                              f"{sorted(set(SCREENS) - set(menu_ids))}")
    if set(code["gated"]) != set(SHOWN_WHEN):
        raise ReferenceError_(f"Screens panel.js shows only when something holds: {sorted(code['gated'])}; "
                              f"described in SHOWN_WHEN ({SCRIPT}): {sorted(SHOWN_WHEN)}")
    names = dict(code["menu"])
    heading = {i: g for g, members in code["groups"] for i in members}
    order = [i for _g, members in code["groups"] for i in members if i in names]
    order += [i for i in menu_ids if i not in order]
    every = set(code["every_mode"])

    def place(i: str, main: list[str], tick: bool) -> str:
        if i in main or i in every:
            return "Main list"
        return "More tools (Settings → UI Structure can move it to the main list)" if tick and i in code["tickable"] \
            else "More tools"

    lines = ["| Screen | What it is | In the menu | Basic | Advanced and Development | Heading |",
             "|---|---|---|---|---|---|"]
    for i in order:
        lines.append(f"| **{names[i]}** | {SCREENS[i]} | {SHOWN_WHEN.get(i, 'Always')} | "
                     f"{place(i, code['basic'], False)} | {place(i, code['advanced'], True)} | {heading.get(i, 'More')} |")
    def bar(tabs: list[str]) -> str:
        words = [names[i] for i in tabs]
        return ", ".join(words[:-1]) + " and " + words[-1] if len(words) > 1 else "".join(words)

    lines += ["", f"On a phone, the bar along the bottom has {bar(code['pinned_basic'])} in Basic, and "
                  f"{bar(code['pinned_other'])} in Advanced and Development, then More, which opens the whole menu."]
    return "\n".join(lines) + "\n"


# ── websocket commands (appendix D): every command the integration registers ──

def _decorator_names(fn) -> set[str]:
    out = set()
    for d in fn.decorator_list:
        d = d.func if isinstance(d, ast.Call) else d
        out.add(d.attr if isinstance(d, ast.Attribute) else getattr(d, "id", ""))
    return out


def _command_schema(fn) -> ast.Dict | None:
    for d in fn.decorator_list:
        if not isinstance(d, ast.Call):
            continue
        name = d.func.attr if isinstance(d.func, ast.Attribute) else getattr(d.func, "id", "")
        if name == "websocket_command" and d.args and isinstance(d.args[0], ast.Dict):
            return d.args[0]
    return None


# Appendix D's "What it does" for the commands whose handler's first sentence
# reads as a note to a developer (a date, a design reference, "owner"), or is
# missing. Every other command keeps its first sentence. A line here for a
# command that no longer exists stops the build.
WS_WHAT: dict[str, str] = {
    "padspan_ha/ai_wizard_check_claude": "Checks that PadSpan's AI Task can answer (an account with credit) before an AI map-building run starts.",
    "padspan_ha/area_add": "Creates a Home Assistant area of this name, on this floor, for a room drawn in Mapping → Edit.",
    "padspan_ha/bright_import_status": "Whether a PadSpan Bright house is on this Home Assistant, whether it was imported, and whether it can be.",
    "padspan_ha/capture_replay": "Replays a finished recording through the room smoothing and scores the rooms it gives.",
    "padspan_ha/fabric_health": "Runs the checks on the house layout (floors, rooms, receivers, calibration).",
    "padspan_ha/fabric_reset_spatial": "Clears receiver and beacon positions and walls, after an automatic backup; rooms are kept.",
    "padspan_ha/fabric_rf_barrier_rails_stamp": "Gives older open wall edges the railing they were drawn with.",
    "padspan_ha/fabric_rooms_merge": "Merges rooms into one: the kept room's outline goes round the others, which are then deleted.",
    "padspan_ha/plan_build_rooms_read_again": "Reads the plans once more for a room the reads disagreed on; two reads out of three decide it.",
    "padspan_ha/plan_build_scale_undo": "Takes back the helper's scale, while nothing measured in metres has been added since.",
    "padspan_ha/radio_reset": "Clears everything PadSpan holds about one receiver, for a receiver replaced or moved.",
    "padspan_ha/rooms_overlap": "Which rooms are drawn over each other, for Mapping's Edit and Layout.",
    "padspan_ha/system_critics": "Health's list of problems, most serious first, with how often rooms are mistaken for each other.",
    "padspan_ha/tester_preview": "What a tester sign-up would send, shown before it is sent.",
    "padspan_ha/trial_start": "Starts the one-time PadSpan Pro trial.",
    "padspan_ha/vacation_log_get": "What Vacation Mode switched between two times, and when it was on.",
    # Handlers with no docstring at all, where the command's name and code say what it does.
    "padspan_ha/emergency_force_off": "Turns every emergency light off.",
    "padspan_ha/emergency_member": "Switches one emergency light by hand, from the test button's card.",
    "padspan_ha/emergency_status": "The emergency lighting test: whether it is on, and its lights.",
    "padspan_ha/emergency_test": "Starts (`on`) or ends the Atlas's emergency lighting test.",
    "padspan_ha/flood_reset": "Resets one leak, smoke, gas or CO alarm (the banner's Reset).",
    "padspan_ha/guest_session_update": "Changes a guest stay: its name, its end, its options.",
    "padspan_ha/power_teams_get": "The power teams.",
    "padspan_ha/power_teams_set": "Saves the power teams.",
    "padspan_ha/settings_get": "PadSpan's settings, as the panel reads them.",
    "padspan_ha/subzone_add": "Adds a sub-zone.",
    "padspan_ha/subzone_remove": "Removes a sub-zone.",
    "padspan_ha/subzones_list": "Every sub-zone.",
    "padspan_ha/telemetry_reset_id": "Gives the usage report a new install id.",
    "padspan_ha/telemetry_send_now": "Sends the usage report now.",
    "padspan_ha/tester_signup": "Signs up as a tester, or changes the sign-up.",
    "padspan_ha/tester_status": "The tester sign-up, if there is one.",
    "padspan_ha/tester_withdraw": "Withdraws the tester sign-up.",
    "padspan_ha/wled_teams_get": "The WLED teams (devices that act as one light).",
    "padspan_ha/wled_teams_set": "Saves the WLED teams.",
}


def _first_sentence(doc: str | None) -> str:
    text = " ".join((doc or "").split("\n\n")[0].split())
    m = re.match(r"(.+?[.!?])(\s|$)", text)
    text = m.group(1) if m else text
    if len(text) > 140:
        text = text[:139].rstrip() + "…"
    return text.replace("|", "\\|")


def ws_commands_in_code() -> list[dict]:
    """Each websocket command: a handler that carries @websocket_command and that the package
    refers to by name somewhere (a registration call, or a tuple of commands a loop registers)."""
    trees = {p.name: ast.parse(p.read_text(encoding="utf-8")) for p in sorted(PKG.glob("*.py"))}
    referred: set[str] = set()
    for tree in trees.values():
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
                referred.add(node.id)
            elif isinstance(node, ast.Attribute):
                referred.add(node.attr)
            elif isinstance(node, ast.alias):
                referred.add(node.asname or node.name)
    out = []
    for module, tree in trees.items():
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)) or fn.name not in referred:
                continue
            schema = _command_schema(fn)
            if schema is None:
                continue
            ctype, fields = None, []
            for k, v in zip(schema.keys, schema.values):
                if isinstance(k, ast.Constant) and k.value == "type":
                    ctype = v.value if isinstance(v, ast.Constant) else None
                elif isinstance(k, ast.Constant) and isinstance(k.value, str):
                    fields.append(f"`{k.value}`")
                elif isinstance(k, ast.Call) and k.args and isinstance(k.args[0], ast.Constant):
                    kind = k.func.attr if isinstance(k.func, ast.Attribute) else getattr(k.func, "id", "")
                    fields.append(f"`{k.args[0].value}`" + ("" if kind == "Required" else " (optional)"))
            if not ctype:
                raise ReferenceError_(f"{module}:{fn.lineno} {fn.name}: a command whose type is not a plain string")
            decs = _decorator_names(fn)
            calls = {getattr(c.func, "id", getattr(c.func, "attr", "")) for c in ast.walk(fn) if isinstance(c, ast.Call)}
            admin = ("always" if "require_admin" in decs else
                     "with Enhanced security" if "admin_if_enhanced_security" in decs or "require_admin_if_enhanced" in calls
                     else "")
            out.append({"type": ctype, "fields": fields, "admin": admin, "module": module,
                        "what": WS_WHAT.get(ctype) or _first_sentence(ast.get_docstring(fn))})
    seen: dict[str, str] = {}
    for c in out:
        if c["type"] in seen:
            raise ReferenceError_(f"{c['type']} is declared twice ({seen[c['type']]}, {c['module']})")
        seen[c["type"]] = c["module"]
    gone = sorted(set(WS_WHAT) - set(seen))
    if gone:
        raise ReferenceError_(f"WS_WHAT has words for commands that no longer exist: {', '.join(gone)}")
    return sorted(out, key=lambda c: c["type"])


def _ws_block() -> str:
    cmds = ws_commands_in_code()
    lines = [f"{len(cmds)} commands. Each takes `id` and `type` as well; a field marked (optional) may be left out.", "",
             "| Command | Fields | Administrator | Module | What it does (its handler's first sentence, or a line written for this table) |",
             "|---|---|---|---|---|"]
    for c in cmds:
        lines.append(f"| `{c['type']}` | {', '.join(c['fields']) or '–'} | {c['admin'] or '–'} | `{c['module']}` | {c['what']} |")
    return "\n".join(lines) + "\n"


# ── every screen and its tabs (appendix B) ──────────────────────────────────

def _views_src(name: str) -> str:
    return (WWW / "views" / name).read_text(encoding="utf-8")


def _tabs_settings() -> list[str]:
    block = _js_block(_views_src("settings.js"), "const _tabDefs = [")
    return re.findall(r'^\s*\["[a-z]+",\s*(?:t\()?"([^"]+)"\)?,', block, re.M)   # the name in t() or not


def _tabs_mapping() -> list[str]:
    line = next(ln for ln in _views_src("maps.js").splitlines() if ln.strip().startswith(': [["library",t("Library")]'))
    return re.findall(r'\["[a-z0-9]+",t\("([^"]+)"\)\]', line) + ["Furnish (with Live Aboard on)"]


def _tabs_calibration() -> list[str]:
    line = next(ln for ln in _views_src("calibration.js").splitlines() if "const TABS = [" in ln)
    return re.findall(r'\["[a-z]+",t\("([^"]+)"\)\]', line)


def _tabs_manage() -> list[str]:
    return re.findall(r'^\s*\["[a-z_]+",(?:t\()?"([^"]+)"\)?\],?$', _js_block(_views_src("manage.js"), "const TABS = ["), re.M)   # the name in t() or not


def _tabs_bluetooth() -> list[str]:
    return re.findall(r'tabButton\("[a-z_]+", t\("([^"]+)"\)\)', _views_src("bluetooth.js"))


# Screen id (panel.js MENU) → where its tabs are read from.
TAB_SOURCES = {"settings": _tabs_settings, "maps": _tabs_mapping, "calibration": _tabs_calibration,
               "manage": _tabs_manage, "bluetooth": _tabs_bluetooth}


def screen_tabs_in_code() -> dict[str, list[str]]:
    out = {}
    for sid, read in TAB_SOURCES.items():
        try:
            tabs = read()
        except (StopIteration, ValueError) as err:
            raise ReferenceError_(f"the {sid} screen's tabs can't be read any more: {err}") from err
        if len(tabs) < 3:
            raise ReferenceError_(f"the {sid} screen's tabs can't be read any more (found {tabs})")
        out[sid] = tabs
    return out


def _screens_block() -> str:
    code, tabs = menu_in_code(), screen_tabs_in_code()
    sections = _js_block(_views_src("settings.js"), "export const PRESENCE_SECTIONS = [")
    lines = ["| Screen | What it is | Its tabs |", "|---|---|---|"]
    for sid, name in code["menu"]:
        cell = ", ".join(f"**{t}**" for t in tabs.get(sid, [])) or "–"
        if sid == "settings":
            cell += ". **Tracking** is in sections: " + ", ".join(re.findall(r'\["[a-z]+",\s*(?:\(\) => t\()?"([^"]+)"\)?\]', sections))
        lines.append(f"| **{name}** | {SCREENS[sid]} | {cell} |")
    return "\n".join(lines) + "\n"


# ── the blocks, and writing them ────────────────────────────────────────────

def blocks() -> dict[Path, dict[str, str]]:
    """Every generated block, by chapter file and block name."""
    from_settings = _settings_blocks() if SETTINGS_ENTRIES else {}
    out = {HA_REFERENCE: {"entities": _entities_block(), "services": _services_block(), "events": _events_block(),
                          "assist": _assist_block(), "mqtt": _mqtt_block()}}
    if from_settings:
        out[SETTINGS_REFERENCE] = from_settings
    out[SCREENS_CHAPTER] = {"menu": _menu_block()}
    out[DEVELOPERS_APPENDIX] = {"websocket": _ws_block()}
    out[SCREENS_APPENDIX] = {"screens": _screens_block()}
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


# ── settings (chapter 20): what the code says ───────────────────────────────

def default_settings() -> dict[str, object]:
    for node in ast.walk(_tree("settings_store.py")):
        if isinstance(node, ast.AnnAssign) and getattr(node.target, "id", "") == "DEFAULT_SETTINGS":
            return ast.literal_eval(node.value)
    raise ReferenceError_("settings_store.py has no DEFAULT_SETTINGS")


def _settings_set() -> ast.AsyncFunctionDef:
    return _function("ws_settings.py", "ws_settings_set")


def schema_keys() -> list[str]:
    """The keys padspan_ha/settings_set accepts, in its schema's order."""
    for d in _settings_set().decorator_list:
        if isinstance(d, ast.Call) and d.args and isinstance(d.args[0], ast.Dict):
            return [k.args[0].value for k in d.args[0].keys
                    if isinstance(k, ast.Call) and k.args and isinstance(k.args[0], ast.Constant)]
    raise ReferenceError_("ws_settings_set has no schema")


def setting_keys() -> list[str]:
    defaults = default_settings()
    return list(defaults) + [k for k in schema_keys() if k not in defaults]


def _names_in_reach() -> dict[str, object]:
    """ws_settings.py's constants and what it imports by name, as values."""
    out = dict(_module_constants("ws_settings.py"))
    for node in ast.walk(_tree("ws_settings.py")):
        if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module:
            other = _module_constants(node.module + ".py") if (PKG / (node.module + ".py")).exists() else {}
            for a in node.names:
                if a.name in other:
                    out.setdefault(a.asname or a.name, other[a.name])
    return out


def _num(node, names) -> float | None:
    try:
        v = ast.literal_eval(node)
    except ValueError:
        if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and isinstance(node.slice, ast.Constant):
            seq = names.get(node.value.id)
            return seq[node.slice.value] if isinstance(seq, (tuple, list)) else None
        if isinstance(node, ast.Name):
            v = names.get(node.id)
        else:
            return None
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _fmt(v) -> str:
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e6:
        v = int(v)
    return f"{v:,}".replace(",", " ") if isinstance(v, (int, float)) and abs(v) >= 10000 else str(v)


def _choices(values) -> str:
    return ", ".join(f"`{v}`" for v in values)


def _describe(expr, names, block, depth: int = 0) -> str | None:
    """What a payload[...] = <expr> keeps a value to, in words, or None."""
    if depth > 4 or expr is None:
        return None
    if isinstance(expr, ast.Call):
        fname = expr.func.id if isinstance(expr.func, ast.Name) else ""
        if fname in ("int", "float", "round") and expr.args:
            return _describe(expr.args[0], names, block, depth + 1)
        if fname == "bool":
            return "on or off"
        if fname == "max" and len(expr.args) == 2 and isinstance(expr.args[1], ast.Call) \
                and getattr(expr.args[1].func, "id", "") == "min" and len(expr.args[1].args) == 2:
            lo, hi = _num(expr.args[0], names), _num(expr.args[1].args[0], names)
            if lo is not None and hi is not None:
                return f"{_fmt(lo)} to {_fmt(hi)}"
        if fname == "_clamped" and len(expr.args) >= 3:
            lo, hi = _num(expr.args[1], names), _num(expr.args[2], names)
            zero = any(k.arg == "zero_ok" and getattr(k.value, "value", False) for k in expr.keywords)
            if lo is not None and hi is not None:
                return (f"0 (off), or {_fmt(lo)} to {_fmt(hi)}" if zero else f"{_fmt(lo)} to {_fmt(hi)}")
        if fname in ("_texts",):
            return "a list"
        if fname in ("_text_map",):
            return "a mapping"
        if fname.startswith("_") and fname not in ("_clamped",):
            try:
                fn = _function("ws_settings.py", fname)
            except ReferenceError_:
                return None
            for node in ast.walk(fn):
                if isinstance(node, ast.Return):
                    got = _describe(node.value, names, fn, depth + 1)
                    if got:
                        return got
    def listed(node) -> str | None:
        coll = node.comparators[0]
        vals = ast.literal_eval(coll) if isinstance(coll, (ast.Tuple, ast.List, ast.Set)) else names.get(getattr(coll, "id", ""))
        return _choices(vals) if isinstance(vals, (tuple, list, set, frozenset)) else None

    if isinstance(expr, ast.IfExp):
        for node in ast.walk(expr.test):
            if isinstance(node, ast.Compare) and isinstance(node.ops[0], ast.In) and (got := listed(node)):
                zero = isinstance(expr.orelse, ast.Constant) and expr.orelse.value == 0
                return ("`0` (off), " + got) if zero and "`0`" not in got else got
        for side in (expr.orelse, expr.body):
            got = _describe(side, names, block, depth + 1)
            if got and got != "on or off":
                if isinstance(expr.body, ast.Constant) and expr.body.value is None:
                    return got + ", or empty"
                if isinstance(expr.body, ast.Constant) and expr.body.value == 0 and not got.startswith("0"):
                    return "0 (off), or " + got
                return got
    if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Mod):
        hi = _num(expr.right, names)
        return f"0 to {_fmt(hi)}" if hi is not None else None
    if isinstance(expr, (ast.Name, ast.Subscript)):
        # Checked against a closed list in the same block, or set from something that says.
        text = ast.unparse(expr)
        for node in ast.walk(block):
            if isinstance(node, ast.Compare) and ast.unparse(node.left) == text \
                    and isinstance(node.ops[0], (ast.NotIn, ast.In)) and (got := listed(node)):
                return got
        if isinstance(expr, ast.Name):
            for node in ast.walk(block):
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == expr.id for t in node.targets) \
                        and not isinstance(node.value, ast.Name):
                    got = _describe(node.value, names, block, depth + 1)
                    if got:
                        return got
    return None


@lru_cache(maxsize=None)
def setting_ranges() -> dict[str, str]:
    """{key: the range or choices ws_settings_set keeps it to} for every key it says."""
    fn = _settings_set()
    names = _names_in_reach()
    for node in ast.walk(fn):        # names imported inside the function
        if isinstance(node, ast.ImportFrom) and node.level == 1 and node.module and (PKG / (node.module + ".py")).exists():
            other = _module_constants(node.module + ".py")
            for a in node.names:
                if a.name in other:
                    names[a.asname or a.name] = other[a.name]
    out: dict[str, str] = {}

    def payload_key(target) -> str | None:
        if isinstance(target, ast.Subscript) and ast.unparse(target.value) == "payload" and isinstance(target.slice, ast.Constant):
            return target.slice.value
        return None

    def guarded_key(test) -> str | None:
        """`"key" in msg` (or the first such test of an `or`): the key the block is for."""
        if isinstance(test, ast.Compare) and isinstance(test.left, ast.Constant) and isinstance(test.ops[0], ast.In) \
                and ast.unparse(test.comparators[0]) == "msg":
            return test.left.value
        return None

    # Each `if "key" in msg:` block, innermost first: what it keeps the key to.
    blocks_by_key: list[tuple[str, ast.If]] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.If) and (k := guarded_key(node.test)):
            blocks_by_key.append((k, node))
    for k, block in sorted(blocks_by_key, key=lambda kb: -kb[1].lineno):
        if k in out:
            continue
        for node in ast.walk(block):
            if isinstance(node, ast.Assign) and any(payload_key(t) == k for t in node.targets):
                got = _describe(node.value, names, block)
                if got:
                    out[k] = got
                    break
    # for key in ("a", "b", ...): if key in msg: payload[key] = bool(msg[key])
    for node in ast.walk(fn):
        if isinstance(node, ast.For) and isinstance(node.target, ast.Name) and isinstance(node.iter, ast.Tuple):
            keys = [e.value for e in node.iter.elts if isinstance(e, ast.Constant)]
            for sub in ast.walk(node):
                if isinstance(sub, ast.Assign) and any(isinstance(t, ast.Subscript) and ast.unparse(t.slice) == node.target.id
                                                      for t in sub.targets):
                    got = _describe(sub.value, names, node)
                    for k in keys:
                        if got:
                            out.setdefault(k, got)
    # The weather entity pickers: each takes an entity of its domains, or "".
    weather = _module_constants("ws_settings.py").get("_WEATHER_ENTITY_DOMAINS") or {}
    for k, doms in weather.items():
        out[k] = "an entity: " + " or ".join(f"`{d}*`" for d in doms) + ", or empty"
    return out


_JS_DEFAULT = (r"settings\??\.{k}\s*!=\s*null\s*\?\s*Number\(settings\??\.{k}\)\s*:\s*(-?[0-9.]+)",
               r"settings\??\.{k}\s*(?:\?\?|\|\|)\s*(-?[0-9.]+|\"[^\"]*\")")


@lru_cache(maxsize=None)
def _all_js() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted(WWW.rglob("*.js")) if "vendor" not in p.parts)


def setting_default(key: str) -> tuple[bool, object]:
    """(known, value): DEFAULT_SETTINGS', else the one the panel or the backend falls back to."""
    defaults = default_settings()
    if key in defaults:
        return True, defaults[key]
    for pat in _JS_DEFAULT:
        m = re.search(pat.format(k=re.escape(key)), _all_js())
        if m:
            return True, json.loads(m.group(1))
    for path in sorted(PKG.glob("*.py")):
        m = re.search(r'\.get\("' + re.escape(key) + r'",\s*(True|False|-?[0-9.]+|"[^"]*")\)', path.read_text(encoding="utf-8"))
        if m:
            return True, ast.literal_eval(m.group(1))
    # A switch with no default anywhere: never set, the code reads it as off.
    if setting_ranges().get(key) == "on or off":
        return True, False
    return False, None


def _default_words(key: str) -> str:
    known, v = setting_default(key)
    if not known or v is None:
        return "not set"
    if v is True:
        return "on"
    if v is False:
        return "off"
    if v == "" or v == [] or v == {}:
        return "empty"
    if isinstance(v, (int, float)):
        return _fmt(v)
    return f"`{v}`"


# The panel's text, for checking a label is really there.
PLACE_FILES = {
    "Settings": ("views/settings.js", "views/wall_card.js", "views/screens_card.js", "views/power_teams.js", "views/lights_follow.js",
                 "views/tips.js"),
    "Manage": ("views/manage.js",),
    "Mapping": ("views/maps.js", "views/lights_map.js", "views/iso_lights.js"),
    "Atlas": ("lights_panel.js", "views/lights_map.js", "views/iso_lights.js", "views/room_controls.js"),
    "Overview": ("views/overview.js", "panel.js"),
    "Bluetooth": ("views/bluetooth.js",),
    "Devices": ("views/devices.js",),
    "Calibration": ("views/calibration.js",),
    "Traceback": ("views/traceback.js",),
    "Occupancy": ("views/occupancy.js",),
    "Locate": ("views/locate.js",),
    "Follow": ("views/follow.js", "panel.js"),
    "Live Aboard": ("views/live_aboard.js", "views/live_aboard_furnish.js", "views/live_aboard_people.js", "views/lights_map.js"),
}


@lru_cache(maxsize=None)
def _place_strings(place: str) -> str:
    text = ""
    for rel in PLACE_FILES[place]:
        src = (WWW / rel).read_text(encoding="utf-8")
        for s in re.findall(r'"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`', src):
            raw = s[0] or s[1]
            try:
                text += json.loads('"' + raw.replace("\n", "\\n") + '"') + "\n"
            except ValueError:
                text += raw + "\n"
    return text


def label_on_screen(place: str, label: str) -> bool:
    want = re.sub(r"^\W+", "", label).rstrip(" :→…")
    return bool(want) and want in _place_strings(place)


# ── settings (chapter 20): what the code can't say ──────────────────────────
# key: (where, card, control, what). `where` is the panel's path to the card;
# the card and the control are the panel's own words (checked: each must be a
# string on that screen). A control the same as its card is given as "".
# `where` None: not in the panel; `card` then says whose it is.

T = "Settings → Tracking → "
SETTINGS_ENTRIES: dict[str, tuple] = {
    # Settings → Appearance
    "ui_skin": ("Settings → Appearance", "Panel Style", "", "`2025` restyles the panel's frame (grouped menu with icons); `classic` is the original."),
    "theme_palette": ("Settings → Appearance", "Theme", "", "The colours: empty is Night (dark green), or Graphite, Ocean, Dusk or High contrast (`contrast`). Graphite, Ocean and Dusk come with Pro or the Looks pack add-on."),
    "light_theme": ("Settings → Appearance", "Theme", "Light (inverted)", "The panel's colours turned light (inverted)."),
    "day_theme": ("Settings → Appearance", "Theme", "Day", "Day, PadSpan's designed light look (Pro or the Looks pack add-on). It wins over Light."),
    "theme_follow_sun": ("Settings → Appearance", "Theme", "Follow the sun", "Day (Light without Pro or the Looks pack) from sunrise to sunset, the theme you picked at night."),
    "units_feet": ("Settings → Appearance", "Units", "Show lengths in feet and inches", "Mapping's measuring and the rooms helper show feet and inches. Lengths are kept in metres either way."),
    "tips_enabled": ("Settings → Appearance", "Tips", "Show a tip now and then", "A tip about a feature this house has and doesn't use yet: at most one a day, none in an install's first week, never one seen before, never on a wall screen. No more tips on any tip turns it off."),
    "overview_2d_mode": ("Settings → Appearance", "2D Map Mode", "Replace 3D isometric view with flat 2D map", "Experimental: the Overview shows the floor plan flat, with zoom and pan."),
    # Settings → Tracking
    "room_change_delay_s": (T + "Rooms and timing", "Room Change Delay", "Room change delay", "Seconds a receiver must stay ahead before a device moves to its room. A clear move next door needs half."),
    "hold_last_room_s": (T + "Rooms and timing", "Hold Room Through Short Gaps", "Hold last room", "Seconds a device's room stays shown through a signal gap. Display only: rooms are decided as before."),
    "room_reason_attribute": (T + "Rooms and timing", "Why This Room (Sensor Attribute)", "Add a room_reason attribute to each area sensor", "Adds `room_reason` to each area sensor ([chapter 14](14-home-assistant-reference.md))."),
    "away_timeout_m": (T + "Rooms and timing", "Home/Away Timeout", "Away timeout", "Minutes a device goes unheard before its tracker and area sensor read `not_home`."),
    "thing_away_timeout_h": (T + "Rooms and timing", "Home/Away Timeout", "Things keep their room", "Hours a device nobody carries (keys, a tag on a bag) keeps its last room before it reads `not_home`."),
    "guest_tags_enabled": (T + "Phones and guest tags", "Guest tags", "Use tags as guest tags", "Guest tags: the Guests screen, `binary_sensor.padspan_guest_home` and the guest notices."),
    "guest_retention_days": (T + "Phones and guest tags", "Guest tags", "Keep a finished stay's report (name, times, rooms) for", "Days a finished stay's report is kept. 0: not kept."),
    "yesterday_home_enabled": (T + "Phones and guest tags", "Yesterday at home", "Send a morning message about the day before", "One short message a day through Home Assistant about the day before, from Traceback's figures for that day ([chapter 13](13-alerts.md))."),
    "yesterday_home_time": (T + "Phones and guest tags", "Yesterday at home", "Send it at", "When the message goes, HH:MM in Home Assistant's time."),
    "yesterday_home_target": (T + "Phones and guest tags", "Yesterday at home", "Send it to", "A notify target from the list Follow alerts use; empty: a Home Assistant notification."),
    "yesterday_home_lines": (T + "Phones and guest tags", "Yesterday at home", "What it tells", "The lines it may hold: `comings`, `guests`, `empty_rooms`, `lights`."),
    "irk_devices": (T + "Phones and guest tags", "Phone Tracking (Private BLE)", "", "The phones and watches whose key (IRK) you added in PadSpan."),
    "quiet_mode": (T + "What the panel shows", "Quiet Mode", "", "Hides devices nobody has named from the panel's lists and counts. Switched by the Quiet tick at the top of the Overview."),
    "object_history_days": (T + "What the panel shows", "Object History Retention", "Keep unlabelled for", "Days a device nobody named stays in PadSpan's history. Named devices are kept."),
    "ble_max_age_s": (T + "What the panel shows", "BLE Advertisement Timeout", "Max age", "Seconds a device stays listed after its last advertisement."),
    "positioning_algorithm": (T + "Positioning and calibration", "Positioning Algorithm", "", "`knn`: live signals matched to your calibration points. `rf`: the learned model (experimental)."),
    "positioning_pick_better": (T + "Positioning and calibration", "Positioning Choices", "Pick the better method for this house", "Uses whichever placing method did better on calibration spots it had not seen."),
    "positioning_unsure": (T + "Positioning and calibration", "Positioning Choices", "Mark a room as unsure when the signal is thin", "With fewer than 3 receivers, or no good calibration match, a device keeps its room and is marked unsure."),
    "positioning_sensor_fusion": (T + "Positioning and calibration", "Positioning Choices", "Use motion sensors and usual moves to break ties", "Motion and occupancy sensors, and the moves PadSpan has learned, decide between two rooms that read almost the same."),
    "calibration_room_walk": (T + "Positioning and calibration", "Walk a Room (Calibration)", 'Add a "Walk a room" tab to Calibration', "Adds Walk a room to Calibration."),
    "ref_power": (T + "Positioning and calibration", "Distance Calibration", "Reference power", "Signal strength in dBm at 1 metre, for the distance sensors."),
    "path_loss_exp": (T + "Positioning and calibration", "Distance Calibration", "Path-loss exponent", "How fast the signal falls with distance, for the distance sensors: about 2 in the open, 2.5 to 3.5 indoors."),
    "kalman_q": (T + "Positioning and calibration", "Signal smoothing", "Process noise Q", "How fast the smoothed signal follows a change. Higher follows movement faster."),
    "kalman_r": (T + "Positioning and calibration", "Signal smoothing", "Measurement noise R", "How little one reading is trusted. Higher smooths more and changes rooms more slowly."),
    "assumed_device_height_m": (T + "Positioning and calibration", "3D Positioning — Device Height", "Device height (m)", "How high a carried device is above the floor, in metres, for 3D distances."),
    "health_reminder_enabled": (T + "Positioning and calibration", "Calibration Accuracy Reminders", "Remind me to update calibration when needed for accuracy", "A check for gaps and stale readings in calibration, with spots to stand at."),
    "adaptive_learning_enabled": (T + "Positioning and calibration", "Adaptive Learning", "Enable adaptive learning", "Experimental: learns each room's signal from devices PadSpan is sure of."),
    "adaptive_floor_detection": (T + "Positioning and calibration", "Adaptive Learning", "Floor detection enhancement", "Experimental: learns how much each floor blocks the signal."),
    "ble_reseed_interval_s": (T + "Receivers", "Bluetooth refresh interval", "Refresh interval", "Seconds between PadSpan's reads of every receiver's list."),
    "aggressive_ble_reseed": (T + "Receivers", "Bluetooth refresh interval", "Refresh every 5 s for passive proxy scanners", "Reads every 5 seconds whatever the interval, for Shelly and other passive receivers."),
    "scanner_offsets": (T + "Receivers", "Receiver signal adjustments", "", "A trim in dB for each receiver's readings."),
    "presence_poll_interval_s": (T + "Performance", "Presence Poll Interval", "Poll interval", "Seconds between room updates. Lower is quicker and uses more CPU."),
    "cpu_mode": (T + "Performance", "CPU Mode", "CPU mode", "Where the room work runs: with Home Assistant (`shared`), held to one core (`single`) or on a core of its own (`dedicated`)."),
    "low_memory_mode": (T + "Performance", "Low-memory mode", "", "Holds less, for a machine with 2 GB of memory."),
    "optimize_for_scale": (T + "Performance", "Optimize for scale", "", "For several wall screens: a lighter feed for the screens and no updates for a hidden page."),
    "fabric_origin_lat": (T + "Home Assistant and integrations", "GPS Bridge", "Origin latitude", "With the longitude: where the layout's zero point is on Earth, so trackers report a latitude and longitude. Both empty: off."),
    "fabric_origin_lon": (T + "Home Assistant and integrations", "GPS Bridge", "Origin longitude", "See Origin latitude."),
    "fabric_bearing_deg": (T + "Home Assistant and integrations", "GPS Bridge", "Bearing (°)", "Which way the layout's up points, in degrees clockwise from true north. Live Aboard's North is the same setting."),
    "padspan_automations": (T + "Home Assistant and integrations", "Automations", "", "Simple arrive and depart rules that turn a light, switch, scene or script on or off."),
    "lights_follow_enabled": (T + "Home Assistant and integrations", "Lights follow people", "Turn room lights on and off as people move", "A room's lights go on when someone with a named phone, watch or tag comes in, and off once it has been empty for its delay. A light turned off by hand stays off until everyone has left."),
    "lights_follow_rooms": (T + "Home Assistant and integrations", "Lights follow people", "Add a room…", "Each room's lights, how long it stays empty before they go off (2 minutes unless chosen), only when dark (the sun, or a light sensor below a level), quiet hours and motion or occupancy sensors that confirm an entry at once."),
    "lights_follow_people": (T + "Home Assistant and integrations", "Lights follow people", "People", "Who is left out (or, for a guest tag, let in), by name. Everyone named counts but guest tags."),
    "tags_room_events_enabled": (T + "Home Assistant and integrations", "HA Tags Integration", "Room-change tag events", "A tag scan and a `padspan_room_change` event each time a followed device changes room."),
    "tags_nfc_identify_enabled": (T + "Home Assistant and integrations", "HA Tags Integration", "NFC tap-to-identify", "Scanning an NFC tag names the strongest unnamed Bluetooth signal in that phone's room."),
    "tags_phone_autolink_enabled": (T + "Home Assistant and integrations", "HA Tags Integration", "Phone auto-link on NFC scan", "A phone that scans any NFC tag is followed by its BLE Transmitter."),
    "bermuda_ignore": (T + "Home Assistant and integrations", "Ignore Bermuda", "Ignore all Bermuda integration data", "Experimental: PadSpan uses nothing from the Bermuda integration."),
    "update_check_enabled": (T + "Privacy, updates and feedback", "Update Check", "Update check", "The daily check for a new version ([chapter 3](03-install-update-uninstall.md))."),
    "enhanced_security": (T + "Privacy, updates and feedback", "Enhanced security", "", "Only an administrator can change PadSpan's shared setup. On for a new install; a home set up before November 2026 keeps what it had."),
    "telemetry_enabled": (T + "Privacy, updates and feedback", "Help improve PadSpan", "", "The opt-in daily usage report. A free licence (trial, tester, free year) keeps it on until the licence ends."),
    "telemetry_heard": (T + "Privacy, updates and feedback", "Help improve PadSpan", "Where you heard of PadSpan", "Your answer, one word from a fixed list, sent with the report. Empty: not said."),
    # Settings → Features
    "forensics_license_key": ("Settings → Features", "PadSpan licence", "", "Your licence key. Kept through a Factory Reset."),
    "license_home_label": ("Settings → Features", "PadSpan licence", "", "The name you gave this home among your licence's homes."),
    "walk_to_identify_enabled": ("Settings → Features", "Experimental Features", "Walk-to-Identify", "Finds which unknown device is yours by walking into a room."),
    "radio_map_enabled": ("Settings → Features", "Experimental Features", "Radio Map", "A signal-strength overlay on the floor plans, from calibration."),
    "distortion_map_enabled": ("Settings → Features", "Experimental Features", "Signal distortion map", "Shows where calibration and live readings disagree."),
    "roomplan_import_enabled": ("Settings → Features", "Experimental Features", "RoomPlan Import", "Mapping → Layout can import an Apple RoomPlan scan."),
    "vacuum_import_enabled": ("Settings → Features", "Experimental Features", "Robot Vacuum Import", "Mapping → Layout can import a robot vacuum's map as a floor plan."),
    "phone_wizard_enabled": ("Settings → Features", "Experimental Features", "Phone Setup Wizard", "A guided phone setup in the IRK Manager."),
    "iphone_irk_guide": ("Settings → Features", "Experimental Features", "iPhone Setup Path", "iPhones get the steps for their key (IRK). On for a new install."),
    "mac_rotation_bridging": ("Settings → Features", "Experimental Features", "MAC Rotation Bridging", "Links a device's old and new address when its address changes."),
    "apple_auto_classify": ("Settings → Features", "Experimental Features", "Apple Device Classification", "Says whether an Apple Find My signal is an AirTag, a Find My accessory or an Apple device. Display only."),
    "rssi_capture_enabled": ("Settings → Features", "Experimental Features", "RSSI Vector Capture", "A Record button in Health for signal recordings to replay."),
    "forensics_enabled": ("Settings → Features", "Forensics", "", "Pro or the Presence insights add-on: records when every Bluetooth device nearby comes and goes, to look back at later."),
    "forensics_retention_days": ("Settings → Features", "Forensics", "Keep sessions for", "Days Forensics keeps what it recorded."),
    # Settings → AI
    "atlas_3d_ai_task_entity": ("Settings → AI", "Your AI", "AI Task", "The Home Assistant AI Task PadSpan asks to read a photo or a plan. Empty: none, and nothing is read."),
    "atlas_3d_ai_task_backup_entity": ("Settings → AI", "Your AI", "Backup AI task", "Used when the main AI Task can't be reached."),
    "ai_credit_month_usd": ("Settings → AI", "Your AI", "Your monthly credit, US$", "Your AI's monthly credit, for the use line. 0: none."),
    "ai_credit_warn_pct": ("Settings → AI", "Your AI", "Warn me", "One notice a month once this share of the credit is used."),
    "ai_plans_enabled": ("Settings → AI", "What it does for you", "AI map-building research (experimental)", "Shows the stair finder and the Plans tool."),
    "ai_stairs_enabled": ("Settings → AI", "What it does for you", "Stairs from your floor plans", "Live Aboard's Furnish can have your AI read the stairs off the plans."),
    "ai_photos_enabled": ("Settings → AI", "What it does for you", "Furniture from a photo", "Live Aboard's Furnish can fill in a piece from a photo."),
    "ai_plan_build_enabled": ("Settings → AI", "What it does for you", "Build from plans: advanced plan alignment (Claude, experimental)", "Lines up plans and rooms with Claude Opus 5.5 or newer. Needs AI map-building research on."),
    # Settings → Atlas
    "lights_panel_enabled": ("Settings → Atlas", "Atlas — Mapped Light Control", "Show the Atlas in the Home Assistant sidebar", "The Atlas's own sidebar entry. Takes a Home Assistant restart."),
    "atlas_emergency_button": ("Settings → Atlas", "Atlas — Mapped Light Control", "Show the Test emergency lighting button on the Atlas", "The Atlas's Test emergency lighting button."),
    "atlas_live_colours": ("Settings → Atlas", "Atlas — Mapped Light Control", "Draw lit lights in their own colour on the Atlas", "Lit lights in the colour they report. Off: amber."),
    "atlas_alert_pulse": ("Settings → Atlas", "Atlas — Mapped Light Control", "Alert pulse", "Rings an opening left open, or open in the rain, and names the worst alert."),
    "emergency_notify": ("Settings → Atlas", "Atlas — Mapped Light Control", "Notify when a leak, smoke, gas or CO alarm goes off", "Sends one notification when the alarm latches and one when it clears, where Follow alerts go."),
    "atlas_heatmap_enabled": ("Settings → Atlas", "Atlas — Mapped Light Control", "Heatmap chip on the Atlas (temperature, humidity, CO₂)", "A Heatmap chip on the Atlas: rooms coloured by their own sensors. Pro or the Climate & air quality add-on."),
    "atlas_audio_enabled": ("Settings → Atlas", "Atlas — Mapped Light Control", "Audio", "On the classic layout, for the whole house: a speaker beside a room's name while one of its players is on, and Audio in the room's card. Pro or the Audio add-on; on the new layout each screen's ⋯ list has it instead."),
    "atlas_shades_enabled": ("Settings → Atlas", "Atlas — Mapped Light Control", "Shades", "On the classic layout, for the whole house: Open, Stop and Close for the room's blinds and shades in the room's card. Free; on the new layout each screen's ⋯ list has it instead."),
    "atlas_thermostats_enabled": ("Settings → Atlas", "Atlas — Mapped Light Control", "Thermostats", "On the classic layout, for the whole house: each thermostat in the room's card with its setpoint, and the room's temperature and humidity. Pro or the Climate & air quality add-on; on the new layout and on a wall screen, each screen's ⋯ list has it instead."),
    "power_teams": ("Settings → Atlas", "Power teams", "", "Each wall dimmer or switch and the smart bulbs it feeds, as one light ([chapter 14](14-home-assistant-reference.md)). Made and changed, and following the day, with Pro, Bright Pro or the Advanced smart lighting add-on."),
    "atlas_weather_enabled": ("Settings → Atlas", "Outdoor weather", "Show rain and snow on the Atlas", "Rain or snow around the house while it really rains or snows."),
    "atlas_weather_rain_entity": ("Settings → Atlas", "Outdoor weather", "Rain sensor", "A rain sensor that says when it is wet. Empty: the weather entity decides."),
    "atlas_weather_condition_entity": ("Settings → Atlas", "Outdoor weather", "Weather entity", "The weather entity, for rain or snow. Empty: the first one Home Assistant has."),
    "atlas_weather_warning_entity": ("Settings → Atlas", "Outdoor weather", "Weather warnings", "A weather-warning sensor. Empty: found by itself."),
    "atlas_weather_strength": ("Settings → Atlas", "Outdoor weather", "Strength", "How strongly the rain or snow is drawn."),
    "atlas_3d_enabled": ("Settings → Atlas", "Live Aboard", "Show Live Aboard on the Atlas", "Pro: the 3D house. Off: no 3D, no Furnish, nothing written or read."),
    "atlas_3d_quality": ("Settings → Atlas", "Live Aboard", "Quality", "How much the 3D house draws: picked for the screen, low or high."),
    "atlas_3d_look": ("Settings → Atlas", "Live Aboard", "Look", "The same look as the Atlas, Live Aboard's own colours, or Studio."),
    "atlas_3d_home_idle_s": ("Settings → Atlas", "Live Aboard", "Back to home view", "Seconds untouched before the sidebar's Live Aboard goes back to its home view. 0: never."),
    "atlas_3d_people": ("Settings → Atlas", "Live Aboard", "Show people", "People in the 3D house."),
    "atlas_3d_tags": ("Settings → Atlas", "Live Aboard", "Show tags & scanners", "Every placed tag and receiver in the 3D house."),
    "atlas_3d_weather": ("Settings → Atlas", "Live Aboard", "Rain and snow", "Rain and snow in Live Aboard, while Outdoor weather is on too."),
    "atlas_3d_director": ("Settings → Atlas", "Live Aboard", "Fly to when it goes off", "Doorbells, doors, sensors or alarms the view flies to when they go off."),
    "atlas_3d_director_people": ("Settings → Atlas", "Live Aboard", "Fly to when they arrive", "People and tags the view flies to when they come into a room."),
    "atlas_3d_library": ("Settings → Atlas", "Live Aboard", "Use the shared furniture library", "Swaps furniture with other PadSpan homes. Off unless an administrator turns it on."),
    "wall_screen_in": ("Settings → Atlas", "Wall screens", "Screen size", "The wall screen's diagonal in inches. 0: sized from the screen's resolution."),
    "wall_distance_m": ("Settings → Atlas", "Wall screens", "Viewing distance", "How far away people stand, in metres."),
    "wall_text_arcmin": ("Settings → Atlas", "Wall screens", "Text size", "How big text looks from there (minutes of arc)."),
    "wall_night_dim": ("Settings → Atlas", "Wall screens", "Dim at night", "How much darker after sunset (0 to 0.7)."),
    "wall_pixel_shift": ("Settings → Atlas", "Wall screens", "Protect against burn-in", "Moves the picture a few pixels every few minutes (OLED screens)."),
    "wall_floor_cycle_s": ("Settings → Atlas", "Wall screens", "Show each floor", "Seconds between floors while nobody touches the wall. 0: off."),
    "wall_fully": ("Settings → Atlas", "Wall screens", "On Fully Kiosk tablets", "Dims by the tablet's own brightness, and its motion detection turns the screen on."),
    "overview_atlas": ("Settings → Atlas", "Overview — the Atlas as your main map", "Show the Atlas as Overview", "Pro: the Overview shows the Atlas; the classic Overview is under Live Tracker."),
    # Settings → UI Structure
    "advanced_extra_tabs": ("Settings → UI Structure", "UI Structure", "", "Screens moved from More tools into the main list in Advanced and Development mode."),
    "license_tier_override": ("Settings → UI Structure", "Edition & tier", "Look at this install as tier:", "Shows the panel as a lower tier would (`free`, `bright`); empty: as it is."),
    "bright_reveal_presence": ("Settings → UI Structure", "Edition & tier", "Show the presence tabs too (Overview, Follow, Calibration, …)", "PadSpan Bright only: shows the presence screens."),
    # Other screens
    "data_mode": ("Overview", "Preview a finished house", "", "`live`: your own house. `sample`: the sample house (**Back to my house** returns). A new install switches to live as soon as a receiver is heard."),
    "overview_show_walls": ("Overview", "Walls", "", "Draws the signal walls over the map."),
    "overview_show_trails": ("Overview", "Trails", "", "A fading trail behind each device."),
    "overview_persistent_pins": ("Overview", "Pins", "", "Keeps away devices at their last place on the map."),
    "overview_show_outdoor": ("Overview", "Outdoor", "", "Draws sheds, driveways and other outdoor areas, fitted into the house's footprint."),
    "heatmap_gain": ("Overview", "Heat", "Gain", "The Radio Map overlay's gain."),
    "heatmap_contrast": ("Overview", "Heat", "Contrast", "The Radio Map overlay's contrast."),
    "distortion_intensity": ("Overview", "Warp", "", "How strongly the signal distortion map is drawn."),
    "heatmap_source": ("Overview", "Heat", "Source", "Which readings the Radio Map overlay draws from."),
    "followed_addrs": ("Follow", "Follow", "", "The devices you follow. Following a device with no name gives it one."),
    "locate_self_key": ("Locate", "Locate", "You", "Pro or the Presence insights add-on: which device is you, for directions."),
    "excluded_scanners": ("Bluetooth", "Scanners", "Exclude", "Receivers left out of positioning. Nothing they recorded is deleted."),
    "scanner_min_rssi": ("Bluetooth", "Scanners", "Min signal: off", "For each receiver, readings weaker than this are ignored."),
    "beacon_auto_calibrate": ("Calibration", "Beacon Tune", "Auto-Cal", "Pinned beacons add calibration points by themselves."),
    "door_opener_ids": ("Devices", "Door Openers", "", "Entities marked as door or window openers."),
    "door_composites": ("Devices", "Door Openers", "", "What each opener built from relays made in Home Assistant, so Remove deletes exactly that."),
    "traceback_house_focus": ("Traceback", "Full house activity", "", "The floor Full house activity opens on."),
    "distance_stationary_devices": ("Traceback", "Mark as stationary reference (known-fixed device for accuracy monitoring)", "", "Devices that never move, used to watch accuracy."),
    "occupancy_hybrid_enabled": ("Occupancy", "Hybrid counting", "", "Counts people from sensors as well as phones. Off: phones only."),
    "occupancy_cluster_threshold": ("Occupancy", "Phone clustering", "", "How close phones must be to count as one person."),
    "ha_entity_tracker_enabled": ("Manage → HA Entities", "Entity Publishing Controls", "device_tracker.{label}", "A tracker for each named device."),
    "ha_entity_area_enabled": ("Manage → HA Entities", "Entity Publishing Controls", "sensor.{label}_area", "An area sensor for each named device."),
    "ha_entity_distance_enabled": ("Manage → HA Entities", "Entity Publishing Controls", "sensor.{label}_distance", "A distance sensor for each named device."),
    "ha_entity_scanner_distance_enabled": ("Manage → HA Entities", "Entity Publishing Controls", "sensor.{label}_distance_{scanner}", "A distance sensor for each named device and receiver."),
    "ha_entity_occupancy_enabled": ("Manage → HA Entities", "Entity Publishing Controls", "sensor.padspan_occupancy_occupancy", "The house's occupancy sensor. Takes a reload."),
    "screens_remote_enabled": ("Settings → Atlas", "📣 Open screens", "List open screens, and let Home Assistant reload them and show announcements", "Off by default. Open PadSpan pages are listed; padspan_ha.reload_screens and padspan_ha.announce reach them."),
    "subzones_enabled": ("Manage → HA Entities", "Entity Publishing Controls", "binary_sensor.padspan_{sub-zone}_occupied", "Sub-zones: the Sub-zones tool in Mapping → Edit, and two entities for each."),
    "mqtt_publish_enabled": ("Manage → HA Entities", "MQTT Publishing", "Enable experimental MQTT publishing", "Publishes each named device to MQTT ([chapter 14](14-home-assistant-reference.md))."),
    "espresense_mqtt_enabled": ("Manage → HA Entities", "ESPresense MQTT", "Enable ESPresense MQTT ingestion", "Reads ESPresense receivers over MQTT."),
    "espresense_topic_prefix": ("Manage → HA Entities", "ESPresense MQTT", "Topic prefix:", "The MQTT topic ESPresense publishes under."),
    "espresense_companion_url": ("Manage → HA Entities", "Import from ESPresense Companion", "Companion URL:", "ESPresense Companion's address, for importing from it."),
    "tasmota_ble_enabled": ("Manage → HA Entities", "Tasmota BLE", "Read Tasmota BLE over MQTT", "Experimental: Tasmota devices as receivers, over MQTT."),
    "beacon_profiling_enabled": ("Manage → Beacon Characteristics", "Beacon Signal Profiles", "Beacon profiles", "Shows or hides the beacon profiles report."),
    "beacon_tune_disabled": ("Manage → Beacon Characteristics", "Beacon Signal Profiles", "", "Beacons left out of calibration tuning."),
    "beacon_group_overrides": ("Manage → Beacon Characteristics", "Beacon Signal Profiles", "", "Beacons moved to another model group."),
    "atlas_layout_v2": ("Mapping → Atlas builder", "Classic layout", "", "On: the Atlas's new layout (wall screens need it). Off: the classic layout."),
    "lights_showcase": ("Mapping → Atlas builder", "Showcase", "", "Bright Pro, Pro or the Looks pack add-on: the Atlas's presentation look."),
    "lights_showcase_theme": ("Mapping → Atlas builder", "Showcase", "Theme", "Showcase's theme."),
    "lights_fit_rooms": ("Mapping → Atlas builder", "Showcase", "Fit room", "Never draws a light bigger than its room. Bright Pro, Pro or the Advanced smart lighting add-on."),
    "lights_isolux": ("Mapping → Atlas builder", "Showcase", "Light spread", "Lines of equal light on the floor. Bright Pro, Pro or the Advanced smart lighting add-on."),
    "lights_hide_untouched": ("Mapping → Atlas builder", "Hide untouched", "", "Draws only lights that were set up (sized, turned, coloured or shaped). Bright Pro, Pro or the Advanced smart lighting add-on."),
    "lights_hide_device_codes": ("Mapping → Atlas builder", "Hide device codes", "", "Hides each marker's A01-style code."),
    "lights_show_beacons": ("Mapping → Atlas builder", "Show beacons", "", "Shows working, named beacons on the Atlas."),
    "lights_automorph_enabled": ("Mapping → Atlas builder", "Automorph", "", "Pro: a glow from each light out into its room."),
    "lights_automorph_room_pct": ("Mapping → Atlas builder", "Automorph", "", "How far each glow grows toward its room's shape."),
    "lights_automorph_hardness": ("Mapping → Atlas builder", "Automorph", "Hardness", "Sharper (below 0) or smoother (above 0) glow edges."),
    "lights_automorph_style": ("Mapping → Atlas builder", "Automorph", "Style", "The glow's style."),
    "lights_automorph_subtlety": ("Mapping → Atlas builder", "Automorph", "Subtlety", "How faint the glow is."),
    "lights_showcase_presets": ("Mapping → Atlas builder", "Presets", "", "Saved looks: theme, Automorph and display choices, by name."),
    "whole_house_presets": ("Mapping → Atlas builder", "Whole house", "", "Saved states of every light and fan, by name."),
    "vacation_mode_enabled": ("Mapping → Atlas builder", "Vacation Mode", "", "Switches lights as on an ordinary day, learned from Home Assistant's history."),
    "vacation_mode_intensity": ("Mapping → Atlas builder", "Vacation Mode", "Intensity", "How much of the usual lighting it switches."),
    "vacation_mode_source": ("Mapping → Atlas builder", "Vacation Mode", "", "Each day's routine: the same day last week, or that weekday's average over the last month."),
    "vacation_mode_dark_only": ("Mapping → Atlas builder", "Vacation Mode", "Only after dark", "Lights only after sunset."),
    "vacation_mode_dark_offset_min": ("Mapping → Atlas builder", "Vacation Mode", "Only after dark", "How long after sunset, in minutes."),
    "vacation_mode_end_at": ("Mapping → Atlas builder", "Vacation Mode", "Ends", "When the trip ends and Vacation Mode turns itself off. 0: no end."),
    "vacation_mode_pause_home": ("Mapping → Atlas builder", "Vacation Mode", "Pause while someone is home", "Switches nothing while anyone is home."),
    "vacation_mode_bedtime": ("Mapping → Atlas builder", "Vacation Mode", "Bedtime", "Lights off from this time (HH:MM, 17:00 to 03:00)."),
    "vacation_mode_max_on_min": ("Mapping → Atlas builder", "Vacation Mode", "Longest on", "Minutes a light it turned on stays on at most."),
    "vacation_mode_max_lights": ("Mapping → Atlas builder", "Vacation Mode", "Most lights on at once", "Lights on at once, at most."),
    "vacation_mode_anchors": ("Mapping → Atlas builder", "Vacation Mode", "Evening lights", "Up to 10 lights held on through the evenings they were really on."),
    "room_audio_matches": ("Atlas → a room's sheet", "Audio", "Match rooms", "Which media players are in which room, in each room's order (the first is the one the map's speaker follows). An administrator's."),
    "room_audio_ha_speakers": ("Atlas → a room's sheet", "Audio", "Include Home Assistant speakers (Music Assistant, ESPHome, Cast, TVs)", "Offers every media player with a volume, not only the whole-house systems'. Off unless ticked."),
    "light_shapes": ("Mapping → Atlas builder", "Atlas builder", "", "Each light's marker shape."),
    "light_type_overrides": ("Mapping → Atlas builder", "Atlas builder", "", "Pro or the Advanced smart lighting add-on: a light forced to be drawn as WLED, a partition or plain."),
    "lights_hidden": ("Mapping → Atlas builder", "Atlas builder", "", "Lights hidden from the Atlas."),
    "overview_iso_floor_gap": ("Mapping → Atlas builder", "Save view", "", "Space between floors on the Overview and the Atlas."),
    "overview_iso_horiz_gap": ("Mapping → Atlas builder", "Save view", "", "Sideways offset between floors."),
    "overview_iso_focus": ("Mapping → Atlas builder", "Save view", "", "The one floor shown; empty: all floors."),
    "overview_iso_zoom": ("Mapping → Atlas builder", "Save view", "", "The Atlas's zoom."),
    "maps_iso_floor_gap": ("Mapping → 3D Stack", "3D Isometric Preview", "", "Space between floors in the preview."),
    "maps_iso_horiz_gap": ("Mapping → 3D Stack", "3D Isometric Preview", "", "Sideways offset between floors in the preview."),
    "maps_iso_focus": ("Mapping → 3D Stack", "3D Isometric Preview", "All floors", "The one floor shown; empty: all floors."),
    "hidden_map_ids": ("Mapping → 3D Stack", "Floor Assignment & Ceiling Heights", "", "Floor plans hidden from the 3D stack."),
    "atlas_3d_carries": ("Live Aboard → Furnish", "People & devices", "", "Who carries which phone or tag. Kept in this home only."),
    # Not in the panel: changed by a service or command, or kept by PadSpan itself.
    "room_tag_map": (None, "service", "", "The objects that belong in each room: set by `padspan_ha.set_room_tag_map`."),
    "excluded_objects": (None, "command", "", "Devices dropped as they arrive, by their lasting key (never a MAC): no cost, no history."),
    "ingest_rules": (None, "command", "", "Rules that drop or keep devices as they arrive, by key, UUID, maker or address."),
    "espresense_room_map": (None, "command", "", "ESPresense room names matched to Home Assistant areas."),
    "atlas_3d_showcase": (None, "command", "", "An older Live Aboard look switch, kept so old backups load; Look decides now."),
    "emergency_entities": (None, "command", "", "The lights the Atlas's emergency lighting test switches. Empty: Home Assistant's emergency groups, or PadSpan's own rule."),
    "occupancy_multiplier": (None, "command", "", "Devices per person for the occupancy estimate, as Health's fabric check shows it; nothing else reads it yet."),
    "occupancy_dwell_min": (None, "command", "", "Minutes for the occupancy estimate's dwell; nothing reads it yet."),
    "rssi_capture_retention_days": (None, "command", "", "Days RSSI recordings are kept (RSSI Vector Capture)."),
    "onboarding_completed": (None, "kept", "", "The first-run setup was finished."),
    "setup_progress": (None, "kept", "", "Where Setup has got to."),
    "accuracy_tips_hidden": (None, "kept", "", "The Improve accuracy tips you closed."),
    "health_reminder_last_ts": (None, "kept", "", "When the calibration reminder last showed."),
    "ai_map_wizard": (None, "kept", "", "Let Claude draw your rooms: whether it was started, put off or finished."),
    "onboarding": (None, "kept", "", "A new install's first steps and how long they took."),
    "telemetry_asked": (None, "kept", "", "The panel has asked about the usage report once."),
    "telemetry_heard_ask": (None, "kept", "", "Whether the where-did-you-hear question is due, or done."),
    "telemetry_install_id": (None, "kept", "", "The usage report's random install id (Settings → Tracking → Privacy, updates and feedback → Help improve PadSpan replaces it)."),
    "telemetry_last_day": (None, "kept", "", "The day the last usage report was sent."),
    "yesterday_home_sent_day": (None, "kept", "", "The day Yesterday at home last told, so it is never told twice."),
    "report_locked_key": (None, "kept", "", "Which free licence keeps the usage report on."),
    "whatsnew_seen_version": (None, "kept", "", "The last version whose update card someone saw."),
    "first_seen_ts": (None, "kept", "", "When PadSpan first ran here."),
    "calibration_points_seen": (None, "kept", "", "Calibration points at the last report."),
    "maps_seen": (None, "kept", "", "Floor plans at the last report."),
    "addon_report_seen": (None, "kept", "", "The usage report's add-on facts: the licence in the last report, and the features that moved into an add-on which this house used."),
    "trial_nudge_done": (None, "kept", "", "The trial card was answered."),
    "tester_nudge_done": (None, "kept", "", "The tester card was shown."),
    "launch_card_done": (None, "kept", "", "The launch-price card was shown."),
    "room_audio_matched": (None, "kept", "", "Audio's matching card kept its picks once: from then on it makes no guesses, so rooms cleared on purpose stay cleared."),
    "lifetime_card_done": (None, "kept", "", "The \"Pro for life ends Dec 15\" card was shown."),
    "addon_sale_card_done": (None, "kept", "", "The \"Half off every add-on until January 1\" card was shown."),
    "house3d_free_card_done": (None, "kept", "", "The \"The 3D house is now free\" card was shown."),
    "c4local_offer_done": (None, "kept", "", "No thanks was pressed on the Overview's OS 2 Local for Control4 card."),
    "tester_signup": (None, "kept", "", "Your tester sign-up, so you can update or withdraw it."),
    "pro_invite": (None, "kept", "", "An invite to free Pro, and your answer."),
    "server_offers": (None, "kept", "", "Which free-Pro offers the update check last said are on."),
    "tips_state": (None, "kept", "", "Which tips were shown and when, which were dismissed, and which are about a feature now in use."),
    "server_tips_rank": (None, "kept", "", "The tips' order the update check last brought: the features most used by the installs that send the usage report. It only breaks a tie between two tips that fit this house as well."),
    "flood_latches": (None, "kept", "", "Leak alarms the Atlas keeps showing until cleared."),
    "atlas_weather_rain_wet_since": (None, "kept", "", "When the Outdoor weather rain sensor last turned wet, so one stuck on wet for hours is ignored."),
    "zigbee_twins_told": (None, "kept", "", "The Zigbee devices in two integrations you were told about, once each."),
    "lights_showcase_seen": (None, "kept", "", "Showcase has been on here."),
    "wled_teams": (None, "kept", "", "WLED devices that act as one light."),
    "power_teams_woke": (None, "kept", "", "Each power team's last wake-up day, so a restart never wakes it twice."),
    "power_teams_slept": (None, "kept", "", "Each power team's last bedtime day, so a restart never runs it twice."),
    "room_speed_v1_applied": (None, "kept", "", "The November 2026 room-speed defaults were applied once."),
    "atlas_default_v1_applied": (None, "kept", "", "The Atlas's sidebar entry was switched on once, by default."),
    "room_walk_default_v1_applied": (None, "kept", "", "Walk a room was switched on once, by default, unless a walk was saved."),
    "server_checked_at": (None, "kept", "", "When the update check and licence check last ran."),
    "forensics_license_expires": (None, "kept", "", "When the licence ends, as the licence server last said."),
    "license_is_trial": (None, "kept", "", "The key is a trial key."),
    "license_home_token": (None, "kept", "", "This home's token from the licence server."),
    "license_home_status": (None, "kept", "", "The licence server's last word on this home, when it refused it."),
    "license_homes_used": (None, "kept", "", "How many homes the key is on."),
    "license_homes_padspan": (None, "kept", "", "How many of the key's homes are PadSpan's (the reports rule counts these)."),
    "license_homes_warning": (None, "kept", "", "A warning about a home whose usage report is off."),
    "license_install_id": (None, "kept", "", "This install's own id, where Home Assistant's can't be read."),
    "vacation_mode_pattern": (None, "kept", "", "Vacation Mode's learned routine."),
    "vacation_mode_pattern_built_at": (None, "kept", "", "When the routine was learned."),
    "vacation_mode_pattern_until": (None, "kept", "", "Where the history it learned from ends."),
    "vacation_mode_enabled_at": (None, "kept", "", "When this vacation started."),
    "vacation_mode_periods": (None, "kept", "", "Earlier vacations, left out of what it learns."),
    "vacation_mode_tracked_since": (None, "kept", "", "Since when every vacation is recorded."),
    "vacation_mode_pattern_prev": (None, "kept", "", "The last routine learned before this vacation."),
    "vacation_mode_pattern_attempt": (None, "kept", "", "The last try at learning that found nothing."),
    "vacation_mode_pattern_for": (None, "kept", "", "Which vacation a carried-over routine serves."),
    "vacation_mode_last_off": (None, "kept", "", "Who turned Vacation Mode off last, and how."),
    "vacation_mode_trip_source": (None, "kept", "", "The routine source this trip started with."),
    "vacation_mode_pattern_source": (None, "kept", "", "The source the routine was learned from."),
    "vacation_mode_pattern_prev_source": (None, "kept", "", "The source the last routine was learned from."),
    "vacation_mode_pattern_end": (None, "kept", "", "Where a resumed trip's routine is learned again from."),
}
del T

_NOT_IN_PANEL = {"service": "Changed by a service", "command": "Not shown in the panel",
                 "kept": "Kept by PadSpan itself"}


def _check_settings() -> None:
    keys = setting_keys()
    missing = [k for k in keys if k not in SETTINGS_ENTRIES]
    gone = [k for k in SETTINGS_ENTRIES if k not in keys]
    if missing or gone:
        raise ReferenceError_(f"Settings in the code with no entry in SETTINGS_ENTRIES ({SCRIPT}): {missing}; "
                              f"entries for settings the code no longer has: {gone}")
    bad = []
    for key, (where, card, control, _what) in SETTINGS_ENTRIES.items():
        if where is None:
            if card not in _NOT_IN_PANEL:
                bad.append(f"{key}: {card!r} is not one of {sorted(_NOT_IN_PANEL)}")
            continue
        place = where.split(" → ")[0]
        for words in (card, control):
            if words and not label_on_screen(place, words):
                bad.append(f"{key}: {words!r} is not on the {place} screen")
    if bad:
        raise ReferenceError_("These settings name words the panel does not show:\n  " + "\n  ".join(bad))


def _setting_row(key: str, ranges: dict[str, str], with_where: bool) -> str:
    where, card, control, what = SETTINGS_ENTRIES[key]
    first = card if not control or control.lower() == card.lower() else f"{card}: {control}"
    cells = ([where] if with_where else []) + [first, _default_words(key), ranges.get(key, ""), what, f"`{key}`"]
    return "| " + " | ".join(c.replace("|", "\\|") for c in cells) + " |"


def _settings_blocks() -> dict[str, str]:
    _check_settings()
    ranges = setting_ranges()
    order = list(SETTINGS_ENTRIES)
    settings_lines: list[str] = []
    elsewhere: list[str] = []
    hidden: list[str] = []
    head = "| Card: control | Default | Range or choices | What it does | Key |"
    rule = "|---|---|---|---|---|"
    groups: dict[str, list[str]] = {}
    for key in order:
        where = SETTINGS_ENTRIES[key][0]
        if where and where.startswith("Settings"):
            groups.setdefault(where, []).append(key)
    for where, keys in groups.items():
        settings_lines += [f"### {where}", "", head, rule] + [_setting_row(k, ranges, False) for k in keys] + [""]
    other = [k for k in order if SETTINGS_ENTRIES[k][0] and not SETTINGS_ENTRIES[k][0].startswith("Settings")]
    elsewhere += ["| Where | Card: control | Default | Range or choices | What it does | Key |", "|---|---|---|---|---|---|"]
    elsewhere += [_setting_row(k, ranges, True) for k in other]
    for kind, title in _NOT_IN_PANEL.items():
        keys = [k for k in order if SETTINGS_ENTRIES[k][0] is None and SETTINGS_ENTRIES[k][1] == kind]
        if keys:
            hidden += [f"### {title}", "", "| Key | Default | Range or choices | What it is |", "|---|---|---|---|"]
            hidden += [f"| `{k}` | {_default_words(k)} | {ranges.get(k, '')} | {SETTINGS_ENTRIES[k][3]} |" for k in keys]
            hidden.append("")
    return {"settings": "\n".join(settings_lines).rstrip() + "\n",
            "elsewhere": "\n".join(elsewhere).rstrip() + "\n",
            "not-in-panel": "\n".join(hidden).rstrip() + "\n"}


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
