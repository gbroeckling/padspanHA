# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Everything PadSpan hands to Home Assistant's scheduler runs on its loop.

Garry's house, 2026-10-29, on the stable candidate: "Detected that custom
integration 'padspan_ha' calls hass.async_create_task from a thread other
than the event loop ... telemetry.py, line 1161". A plain function given to
async_call_later (or async_track_time_interval and the rest) is run by Home
Assistant in a worker thread, where async_create_task is refused: the usage
report's day counters were never saved, since 0.38.177. This reads every such
call in the integration and holds its function to async def or @callback.
"""

from __future__ import annotations

import ast
from pathlib import Path

_CC = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"

# Scheduler helpers, and which positional argument is the function they run.
_ACTION_ARG = {
    "async_call_later": 2, "async_call_at": 2, "async_track_point_in_time": 1, "async_track_point_in_utc_time": 1,
    "async_track_time_interval": 1, "async_track_time_change": 1, "async_track_utc_time_change": 1,
    "async_track_state_change_event": 2, "async_track_state_added_domain": 2, "async_track_template_result": 2,
}


def _kind(fn: ast.AST) -> str:
    if isinstance(fn, ast.AsyncFunctionDef):
        return "async"
    names = {getattr(d, "id", getattr(d, "attr", "")) for d in fn.decorator_list}
    return "callback" if "callback" in names else "plain"


def test_every_scheduled_function_runs_on_the_event_loop() -> None:
    plain, seen = [], 0
    for path in sorted(_CC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        defs: dict[str, list] = {}
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defs.setdefault(n.name, []).append(n)
        for n in ast.walk(tree):
            if not isinstance(n, ast.Call):
                continue
            f = n.func
            name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
            i = _ACTION_ARG.get(name)
            if i is None or len(n.args) <= i:
                continue
            arg = n.args[i]
            seen += 1
            if isinstance(arg, ast.Lambda):
                plain.append(f"{path.name}:{n.lineno} {name}(lambda)")
                continue
            target = arg.id if isinstance(arg, ast.Name) else None
            if target and target in defs and any(_kind(d) == "plain" for d in defs[target]):
                plain.append(f"{path.name}:{n.lineno} {name}({target})")
    assert seen >= 8, f"the scan found only {seen} scheduler calls"
    assert not plain, ("a plain function given to Home Assistant's scheduler runs in a worker thread, where "
                       f"async_create_task is refused: make it async def or @callback: {plain}")
