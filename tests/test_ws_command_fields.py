# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A handler reads msg["x"] only for a field its schema makes sure is there.

Home Assistant checks a message against the command's schema before the
handler runs, but a field written there as a bare name ("map_id": str) is
optional to it, and so is vol.Optional("x") with no default. A message
without the field then reaches the handler, msg["x"] raises KeyError, and the
person gets "Unknown error": an action that failed with no reason. 22
commands did that until 2026-11-20.

So a field a handler (or a helper it hands the message to) reads as msg["x"]
is one of:

    vol.Required("x")               Home Assistant refuses a message without it
                                    and says which field is missing
    vol.Optional("x", default=...)  the schema fills it in

or the read sits where the field is known to be there: under a check
(`"x" in msg`, `msg.get("x")`), or after `if "x" not in msg: return`.

tests_ha/ holds the same thing by calling every command in a real Home
Assistant with each field left out.
"""

from __future__ import annotations

import ast
import importlib
from pathlib import Path

import voluptuous as vol

_PKG = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_LEAVES = (ast.Return, ast.Raise, ast.Continue, ast.Break)


def _command(fn: ast.AST) -> ast.Call | None:
    """A handler's @websocket_api.websocket_command(...) decorator."""
    return next((d for d in getattr(fn, "decorator_list", []) if isinstance(d, ast.Call)
                 and ast.unparse(d.func).endswith("websocket_command")), None)


def _always_there(schema: dict) -> set[str]:
    """The fields a message that passed `schema` is sure to carry."""
    return {str(k.schema) for k in schema
            if isinstance(k, vol.Required) or (isinstance(k, vol.Optional) and k.default is not vol.UNDEFINED)}


def _asks(test: ast.AST, msg: str, field: str, absent: bool = False) -> bool:
    """Does `test` ask whether `field` is in the message ("x" in msg,
    msg.get("x"))? With `absent`, whether it is missing ("x" not in msg)."""
    for node in ast.walk(test):
        if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Constant) and node.left.value == field
                and any(isinstance(op, ast.NotIn if absent else ast.In) for op in node.ops)
                and any(isinstance(c, ast.Name) and c.id == msg for c in node.comparators)):
            return True
        if (not absent and isinstance(node, ast.Call) and ast.unparse(node.func) == f"{msg}.get" and node.args
                and isinstance(node.args[0], ast.Constant) and node.args[0].value == field):
            return True
    return False


def _unchecked_reads(fn: ast.AST, msg: str) -> dict[str, int]:
    """{field: line} for each msg["field"] in `fn` that nothing around it checks."""
    parent = {child: node for node in ast.walk(fn) for child in ast.iter_child_nodes(node)}
    out: dict[str, int] = {}
    for read in ast.walk(fn):
        if not (isinstance(read, ast.Subscript) and isinstance(read.ctx, ast.Load)
                and isinstance(read.value, ast.Name) and read.value.id == msg
                and isinstance(read.slice, ast.Constant) and isinstance(read.slice.value, str)):
            continue
        field, checked, node = read.slice.value, False, read
        while node is not fn and not checked:
            up = parent[node]
            tests: list[ast.AST] = []
            if isinstance(up, (ast.If, ast.IfExp, ast.While)):
                if (node in up.body) if isinstance(up.body, list) else (node is up.body):
                    tests.append(up.test)
            if isinstance(up, ast.BoolOp) and isinstance(up.op, ast.And):
                tests += up.values[:up.values.index(node)]
            if isinstance(up, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
                tests += [test for gen in up.generators for test in gen.ifs]
            checked = any(_asks(t, msg, field) for t in tests)
            # ... or an earlier line of the same block left when it was missing
            for block in (getattr(up, "body", None), getattr(up, "orelse", None)):
                if isinstance(block, list) and node in block:
                    checked = checked or any(
                        isinstance(s, ast.If) and isinstance(s.body[-1], _LEAVES) and _asks(s.test, msg, field, absent=True)
                        for s in block[:block.index(node)])
            node = up
        if not checked:
            out.setdefault(field, read.lineno)
    return out


def problems(source: str, names: dict, where: str) -> list[str]:
    """Every msg["x"] a handler in `source` reads without its schema requiring x."""
    tree = ast.parse(source)
    funcs = {n.name: n for n in ast.walk(tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}
    out = []
    for fn in funcs.values():
        dec = _command(fn)
        if dec is None:
            continue
        # The schema as written, in the module's own names (the two handlers
        # declared inside a function use nothing but `vol`).
        schema = eval(compile(ast.Expression(dec.args[0]), where, "eval"), dict(names))  # noqa: S307
        there = _always_there(schema) | {"id", "type"}
        # The handler, and the helpers of its module it hands the message to.
        todo, seen, reads = [(fn, fn.args.args[2].arg)], {fn.name}, {}
        while todo:
            f, msg = todo.pop()
            for field, line in _unchecked_reads(f, msg).items():
                reads.setdefault(field, (f.name, line))
            for call in ast.walk(f):
                if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id in funcs:
                    helper = funcs[call.func.id]
                    for i, arg in enumerate(call.args):
                        if isinstance(arg, ast.Name) and arg.id == msg and helper.name not in seen and i < len(helper.args.args):
                            seen.add(helper.name)
                            todo.append((helper, helper.args.args[i].arg))
        for field, (in_fn, line) in sorted(reads.items()):
            if field not in there:
                out.append(f'{where}:{line} {schema["type"]}: {in_fn} reads msg["{field}"], which the schema does not require')
    return out


def test_no_handler_reads_a_field_its_schema_does_not_require() -> None:
    found, seen = [], 0
    for path in sorted(_PKG.glob("*.py")):
        source = path.read_text(encoding="utf-8")
        if "websocket_command(" not in source:
            continue
        seen += source.count("websocket_command(")
        module = importlib.import_module(f"custom_components.padspan_ha.{path.stem}")
        found += problems(source, {**vars(module), "vol": vol}, path.name)
    assert seen > 200, "the scan found too few commands to mean anything"
    assert not found, (
        "A message without the field reaches the handler and raises KeyError, so the person sees a failure with no "
        'reason. If the command cannot work without it, write it vol.Required("field") in the schema; if it can, '
        'read it with msg.get("field") and a default:\n  ' + "\n  ".join(found))


_DEMO = '''
@websocket_api.websocket_command({"type": "padspan_ha/demo", %s})
@websocket_api.async_response
async def ws_demo(hass, connection, msg):
    %s
'''


def _demo(fields: str, body: str, more: str = "") -> list[str]:
    return problems(_DEMO % (fields, body) + more, {"vol": vol}, "demo.py")


def test_the_check_can_actually_fail() -> None:
    assert _demo('"map_id": str', 'use(msg["map_id"])') == [
        'demo.py:5 padspan_ha/demo: ws_demo reads msg["map_id"], which the schema does not require']
    assert len(_demo('vol.Optional("map_id"): str', 'use(msg["map_id"])')) == 1
    assert len(_demo('"other": str', 'use(msg["map_id"])')) == 1                # not in the schema at all
    assert len(_demo('"map_id": str', 'if "other" in msg:\n        use(msg["map_id"])')) == 1
    # ... through a helper the handler hands the message to
    assert len(_demo('"map_id": str', "use(_map(msg))", "\ndef _map(m):\n    return m['map_id']\n")) == 1


def test_the_check_passes_what_is_safe() -> None:
    assert _demo('vol.Required("map_id"): str', 'use(msg["map_id"])') == []
    assert _demo('vol.Optional("map_id", default=""): str', 'use(msg["map_id"])') == []
    assert _demo('"map_id": str', 'use(msg.get("map_id") or "")') == []
    assert _demo('"map_id": str', 'use(msg["map_id"] if "map_id" in msg else None)') == []
    assert _demo('"map_id": str', 'if "map_id" in msg:\n        use(msg["map_id"])') == []
    assert _demo('"map_id": str', 'if msg.get("map_id"):\n        use(msg["map_id"])') == []
    assert _demo('"map_id": str', 'if "map_id" not in msg:\n        return\n    use(msg["map_id"])') == []
    assert _demo('"map_id": str', 'use(connection, msg["id"], msg["type"])') == []
