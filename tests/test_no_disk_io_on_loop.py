"""The floor-plan file code does not touch the disk on the event loop.

Raised in the HACS review (hacs/default#10634): `is_dir()`, `iterdir()`,
`is_file()`, `resolve()` and `exists()` ran directly inside async handlers in
ws_backup.py, maps_store.py and ws_factory_reset.py. Each is a system call
that can stall all of Home Assistant on a slow SD card or network share. They
now run in the executor jobs beside them.

This walks every `async def` in those files (and the two that joined them
for the move out of www/) and fails on a direct call to a path method. A
call inside a nested plain `def` or a lambda is fine — that is the function
handed to the executor — and so is a method passed uncalled
(`run_in_executor(None, fp.resolve)`).
"""

from __future__ import annotations

import ast
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
_FILES = ("maps_store.py", "ws_backup.py", "ws_factory_reset.py",
          "map_image_view.py", "bright_import.py", "ws_maps.py")
_DISK = {"resolve", "exists", "is_dir", "iterdir", "is_file", "mkdir", "rmdir",
         "read_bytes", "write_bytes", "read_text", "write_text", "unlink", "stat",
         "glob", "rglob"}


def _direct_disk_calls(path: Path) -> list[str]:
    found: list[str] = []

    def walk(node: ast.AST, fn: str | None) -> None:
        for ch in ast.iter_child_nodes(node):
            if isinstance(ch, (ast.FunctionDef, ast.Lambda)):
                continue                  # runs in a thread, not on the loop
            if isinstance(ch, ast.AsyncFunctionDef):
                walk(ch, ch.name)
                continue
            if (fn and isinstance(ch, ast.Call) and isinstance(ch.func, ast.Attribute)
                    and ch.func.attr in _DISK):
                found.append(f"{path.name}:{ch.lineno} {fn}() calls .{ch.func.attr}()")
            walk(ch, fn)

    walk(ast.parse(path.read_text(encoding="utf-8")), None)
    return found


def test_no_disk_calls_on_the_event_loop():
    found = [hit for name in _FILES for hit in _direct_disk_calls(_ROOT / name)]
    assert not found, "disk access on the event loop — move it into the executor job: " + "; ".join(found)


def test_the_check_catches_what_the_review_found(tmp_path):
    """The walker itself: the pattern from the review is caught, the fix is not."""
    bad = tmp_path / "bad.py"
    bad.write_text(
        "async def ws_store_backup_create(hass, maps_dir):\n"
        "    if maps_dir.is_dir():\n"
        "        for fp in maps_dir.iterdir():\n"
        "            pass\n",
        encoding="utf-8")
    good = tmp_path / "good.py"
    good.write_text(
        "async def ws_store_backup_create(hass, maps_dir, loop):\n"
        "    def _files():\n"
        "        return list(maps_dir.iterdir()) if maps_dir.is_dir() else []\n"
        "    files = await loop.run_in_executor(None, _files)\n"
        "    root = await loop.run_in_executor(None, maps_dir.resolve)\n",
        encoding="utf-8")
    assert len(_direct_disk_calls(bad)) == 2
    assert _direct_disk_calls(good) == []
