# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""tests_ha/ on Home Assistant releases other than the one
requirements_test_ha.txt pins.

A pytest plugin, loaded by the "Home Assistant versions" workflow:

    python -m pytest tests_ha -p tests_ha.other_versions

Everything here is about the test harness, never about the integration: a
release where PadSpan HA itself does not import or set up must stay red.

- Home Assistant 2026.11 and newer: the harness is `pytest-homeassistant`
  (Home Assistant's own; pytest-homeassistant-custom-component stopped at
  2026.10.4). The tests import the old package's name, so that name is
  answered with the new package.
- Harness releases before Home Assistant 2026.4 have no `hass_config_dir`
  fixture, so the one in conftest.py would do nothing and every test would
  share one config folder inside the installed package. The folder
  conftest.py asks for is given to them the way they take it.
- Home Assistant before 2024.8 has no `get_scheduled_timer_handles`, which
  conftest.py imports.

It also notes what Home Assistant says will stop working: every warning in
the log that speaks of a deprecation or names the integration, and every
Python deprecation warning, listed once at the end of the run.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import json
import logging
import os
import re
import sys
import tempfile
from pathlib import Path

import pytest

_OLD, _NEW = "pytest_homeassistant_custom_component", "pytest_homeassistant"
_OLD_HARNESS = importlib.util.find_spec(_OLD) is not None


class _RenamedHarness(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """`pytest_homeassistant_custom_component[.x]` is `pytest_homeassistant[.x]`:
    the same module object, imported when first asked for."""

    def __init__(self) -> None:
        self._own_spec: dict[str, object] = {}

    def find_spec(self, fullname, path=None, target=None):
        if fullname == _OLD or fullname.startswith(_OLD + "."):
            return importlib.util.spec_from_loader(fullname, self)
        return None

    def create_module(self, spec):
        module = importlib.import_module(_NEW + spec.name[len(_OLD):])
        self._own_spec[spec.name] = module.__spec__
        return module

    def exec_module(self, module) -> None:
        # The import system has just written the alias's spec over the
        # module's own; put it back.
        module.__spec__ = self._own_spec[_OLD + module.__name__[len(_NEW):]]


if not _OLD_HARNESS:
    # First, ahead of the finders that would load the files a second time
    # under the old name.
    sys.meta_path.insert(0, _RenamedHarness())


def pytest_load_initial_conftests() -> None:
    """Before conftest.py is imported. Only with the old harness, whose
    plugin has already imported Home Assistant in the order it needs."""
    if not _OLD_HARNESS:
        return
    from homeassistant.util import async_  # noqa: PLC0415

    if not hasattr(async_, "get_scheduled_timer_handles"):
        async_.get_scheduled_timer_handles = lambda loop: loop._scheduled


@pytest.fixture(autouse=True)
def _config_dir_for_an_old_harness(request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch) -> None:
    if hasattr(importlib.import_module(_OLD + ".plugins"), "hass_config_dir"):
        return
    try:
        path = request.getfixturevalue("hass_config_dir")
    except pytest.FixtureLookupError:
        return
    monkeypatch.setattr(importlib.import_module(_OLD + ".common"), "get_test_config_dir",
                        lambda *add: os.path.join(path, *add))


# ── What Home Assistant says will stop working ──────────────────────────────

_SPEAKS_OF_IT = re.compile(r"deprecat|stop working|will be removed|no longer (work|be supported)", re.IGNORECASE)
_OWN_LOGGER = "custom_components.padspan_ha"
_NOTES = Path(os.environ.get("PADSPAN_HA_NOTES") or Path(tempfile.gettempdir()) / "padspan-ha-notes")


def _note(line: str) -> None:
    _NOTES.mkdir(parents=True, exist_ok=True)
    with open(_NOTES / f"{os.getpid()}.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(line) + "\n")


class _Notes(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        if record.levelno < logging.WARNING:
            return
        text = record.getMessage()
        if _SPEAKS_OF_IT.search(text) or ("padspan_ha" in text and not record.name.startswith(_OWN_LOGGER)):
            _note(f"log {record.levelname} {record.name}: {text}")


def pytest_configure(config: pytest.Config) -> None:
    if not hasattr(config, "workerinput"):      # the run's own process: start clean
        for old in _NOTES.glob("*.jsonl"):
            old.unlink()
    logging.getLogger().addHandler(_Notes())


def pytest_warning_recorded(warning_message, when, nodeid, location) -> None:
    kind = warning_message.category
    text = str(warning_message.message)
    if issubclass(kind, (DeprecationWarning, PendingDeprecationWarning, FutureWarning)) or _SPEAKS_OF_IT.search(text):
        where = str(warning_message.filename).replace("\\", "/").split("/site-packages/")[-1]
        _note(f"python {kind.__name__} {where}:{warning_message.lineno}: {text}")


def pytest_terminal_summary(terminalreporter) -> None:
    if hasattr(terminalreporter.config, "workerinput"):
        return
    seen: set[str] = set()
    for f in sorted(_NOTES.glob("*.jsonl")):
        seen.update(json.loads(line) for line in f.read_text(encoding="utf-8").splitlines() if line)
    terminalreporter.section("what Home Assistant says will stop working")
    for line in sorted(seen) or ["nothing"]:
        terminalreporter.write_line(line)
