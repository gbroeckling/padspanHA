# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Every websocket handler carries its own command decorator, and no helper carries one (2026-11-12).

A helper put between ``@websocket_command`` and its handler takes the decorator. Home Assistant then refuses the
handler at registration, PadSpan logs it and stops registering, and every command after it is gone (licence entry
and the trial among them). The tests stub registration, so only the source shows it."""

from __future__ import annotations

import ast
from pathlib import Path

_PKG = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_HANDLER_ONLY = {"async_response", "require_admin"}


def _decorators(fn) -> set[str]:
    out = set()
    for d in fn.decorator_list:
        d = d.func if isinstance(d, ast.Call) else d
        out.add(d.attr if isinstance(d, ast.Attribute) else getattr(d, "id", ""))
    return out


def test_the_command_decorator_sits_on_the_handler() -> None:
    bad, seen = [], 0
    for path in sorted(_PKG.glob("*.py")):
        for fn in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            decs = _decorators(fn)
            if "websocket_command" in decs:
                seen += 1
                if not fn.args.args or [a.arg for a in fn.args.args][:3] != ["hass", "connection", "msg"]:
                    bad.append(f"{path.name}:{fn.lineno} {fn.name} has the command decorator and is not a handler")
            elif decs & _HANDLER_ONLY:
                bad.append(f"{path.name}:{fn.lineno} {fn.name} is a handler with no command decorator")
    assert seen > 200 and not bad, bad
