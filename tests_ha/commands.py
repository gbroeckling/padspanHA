# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""What the source declares about its websocket commands, and the smallest
message each one accepts.

Nothing here imports the integration or anything under tests/: the command
names are read from the source with ast, and the Enhanced security lists are
read out of tests/test_enhanced_security.py the same way, so this job and the
main suite work from one list and cannot drift apart.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path
from typing import Any, NamedTuple

import voluptuous as vol

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "custom_components" / "padspan_ha"
SECURITY_LISTS = ROOT / "tests" / "test_enhanced_security.py"

PREFIX = "padspan_ha/"


class Declared(NamedTuple):
    module: str
    admin_only: bool        # @websocket_api.require_admin
    switch_gated: bool      # @admin_if_enhanced_security


def declared() -> dict[str, Declared]:
    """Every padspan_ha/* command a handler in the source is decorated as.

    The same reading tests/test_enhanced_security.py does: every function,
    because two commands are declared inside one (power_team.py).
    """
    out: dict[str, Declared] = {}
    for f in sorted(SOURCE.glob("*.py")):
        for node in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            src = [ast.unparse(d) for d in node.decorator_list]
            m = next((re.search(r"'padspan_ha/([a-z0-9_]+)'", s) for s in src if "websocket_command" in s), None)
            if m:
                assert m.group(1) not in out, f"{m.group(1)} is declared twice"
                out[m.group(1)] = Declared(f.stem, any("require_admin" in s for s in src),
                                           any(s == "admin_if_enhanced_security" for s in src))
    return out


def security_lists() -> dict[str, Any]:
    """GATED, PER_KEY, READ and EVERYDAY exactly as the main suite states them."""
    want = {"GATED", "PER_KEY", "READ", "EVERYDAY"}
    out = {}
    for node in ast.parse(SECURITY_LISTS.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id in want:
            out[node.targets[0].id] = eval(  # noqa: S307 - our own file, names limited to `set`
                compile(ast.Expression(node.value), str(SECURITY_LISTS), "eval"), {"__builtins__": {}, "set": set})
    assert set(out) == want, f"{SECURITY_LISTS.name} no longer states {sorted(want - set(out))}"
    return out


def switch_gated() -> list[str]:
    """The commands the main suite lists as behind the Enhanced security switch."""
    return sorted(c for names in security_lists()["GATED"].values() for c in names.split())


# ── the smallest message a command's own schema accepts ──────────────────────

# Tried in this order, so a field that takes text gets "x" (no map, device or
# file is called that) and a number gets 1.
_PLAIN = ("x", 1, 1.0, True, {}, [], None)


def _accepts(validator: Any, value: Any) -> bool:
    try:
        vol.Schema(validator)(value)
    except (vol.Invalid, TypeError, ValueError):
        return False
    return True


def _candidates(validator: Any):
    yield from _PLAIN
    if isinstance(validator, vol.Schema):
        yield from _candidates(validator.schema)
    elif isinstance(validator, vol.In):
        yield from validator.container
    elif isinstance(validator, (vol.All, vol.Any)):
        for inner in validator.validators:
            yield from _candidates(inner)
    elif isinstance(validator, dict):
        yield _fields(validator)
    elif isinstance(validator, list):
        for inner in validator:
            for value in _candidates(inner):
                yield [value]


def _value(validator: Any) -> Any:
    for value in _candidates(validator):
        if _accepts(validator, value):
            return value
    raise AssertionError(f"no harmless value found for {validator!r}")


def _fields(schema: dict, optional: bool = False) -> dict:
    """A value for every field the handler expects: the ones marked
    vol.Required and the ones written as a bare name (Home Assistant treats a
    bare name as optional). vol.Optional fields are left out unless
    `optional` asks for them too, and then one that no plain value fits (a
    date pattern, a number range) is still left out."""
    out = {}
    for key, validator in schema.items():
        if isinstance(key, vol.Remove) or key is vol.Extra or (isinstance(key, vol.Optional) and not optional):
            continue
        name = key.schema if isinstance(key, vol.Marker) else key
        if isinstance(name, str) and name not in ("id", "type"):
            try:
                out[name] = _value(validator)
            except AssertionError:
                if not isinstance(key, vol.Optional):
                    raise
    return out


def minimal_message(command: str, schema: vol.Schema | bool) -> dict:
    """The smallest message `schema` accepts for `command` (without an id).
    Home Assistant keeps False as the schema of a command that takes nothing."""
    if schema is False:
        return {"type": PREFIX + command}
    msg = {"type": PREFIX + command, **_fields(schema.schema)}
    schema({"id": 1, **msg})        # the builder's own mistake fails here, not in Home Assistant
    return msg

def messages_with_a_field_left_out(command: str, schema: vol.Schema | bool) -> dict[str, dict]:
    """{field left out: message}: the message with every field the schema
    names, optional ones too, less one field at a time; and under "" the
    message with none of them."""
    out = {"": {"type": PREFIX + command}}
    if schema is False:
        return out
    full = _fields(schema.schema, optional=True)
    schema({"id": 1, "type": PREFIX + command, **full})     # the builder's own mistake fails here
    for name in full:
        out[name] = {"type": PREFIX + command, **{k: v for k, v in full.items() if k != name}}
    return out
