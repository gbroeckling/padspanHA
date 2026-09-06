"""Shared pytest fixtures and HA module stubs for PadSpan HA unit tests.

This conftest installs lightweight stubs for the ``homeassistant`` package tree
so that ``custom_components.padspan_ha`` can be imported without a real HA
installation.  The stubs are registered in ``sys.modules`` at *conftest load
time* (i.e. before any test module is collected/imported).
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path
from types import ModuleType
from typing import Any
from unittest.mock import AsyncMock, MagicMock

# ---------------------------------------------------------------------------
# 1.  Build a dict of every ``homeassistant.*`` module that is imported
#     (directly or transitively) by the code under test.  Each entry is a
#     fresh ``ModuleType`` so attribute access works like a real module.
# ---------------------------------------------------------------------------

_HA_MODULE_NAMES: list[str] = [
    "homeassistant",
    "homeassistant.components",
    "homeassistant.components.device_tracker",
    "homeassistant.components.sensor",
    "homeassistant.components.websocket_api",
    "homeassistant.config_entries",
    "homeassistant.core",
    "homeassistant.helpers",
    "homeassistant.helpers.aiohttp_client",
    "homeassistant.helpers.area_registry",
    "homeassistant.helpers.device_registry",
    "homeassistant.helpers.entity_platform",
    "homeassistant.helpers.entity_registry",
    "homeassistant.helpers.storage",
    "homeassistant.helpers.typing",
    "homeassistant.helpers.update_coordinator",
    "homeassistant.util",
    "homeassistant.util.dt",
]

_ha_mods: dict[str, ModuleType] = {}
for _name in _HA_MODULE_NAMES:
    _ha_mods[_name] = ModuleType(_name)

# ---------------------------------------------------------------------------
# 2.  Populate the stub modules with the specific *names* that the production
#     code imports.  Anything not listed here falls back to MagicMock via
#     ``__getattr__`` on ModuleType (we patch that below).
# ---------------------------------------------------------------------------

# homeassistant.core
_core = _ha_mods["homeassistant.core"]
_core.HomeAssistant = MagicMock  # type: ignore[attr-defined]
_core.ServiceCall = MagicMock    # type: ignore[attr-defined]
_core.State = MagicMock          # type: ignore[attr-defined]
_core.callback = lambda fn: fn   # type: ignore[attr-defined]  # decorator passthrough

# homeassistant.config_entries
_ce = _ha_mods["homeassistant.config_entries"]
_ce.ConfigEntry = MagicMock  # type: ignore[attr-defined]


class _FakeConfigFlow:
    """Stand-in for config_entries.ConfigFlow."""
    DOMAIN = ""
    VERSION = 1

    def __init_subclass__(cls, domain: str = "", **kw: object) -> None:
        cls.DOMAIN = domain  # type: ignore[attr-defined]


class _FakeOptionsFlow:
    """Stand-in for config_entries.OptionsFlowWithReload."""
    config_entry = MagicMock()

    def add_suggested_values_to_schema(self, schema: Any, options: Any) -> Any:
        return schema


_ce.ConfigFlow = _FakeConfigFlow  # type: ignore[attr-defined]
_ce.OptionsFlowWithReload = _FakeOptionsFlow  # type: ignore[attr-defined]

# homeassistant.helpers.storage
_ha_mods["homeassistant.helpers.storage"].Store = MagicMock  # type: ignore[attr-defined]

# homeassistant.helpers.typing
_ha_mods["homeassistant.helpers.typing"].ConfigType = dict  # type: ignore[attr-defined]

# homeassistant.helpers.update_coordinator
_uc = _ha_mods["homeassistant.helpers.update_coordinator"]


class _SubscriptableBase:
    """Base class that supports subscript syntax (e.g. Cls[dict[str, Any]])."""
    def __class_getitem__(cls, item: Any) -> type:
        return cls


class _FakeDataUpdateCoordinator(_SubscriptableBase):
    """Stand-in for DataUpdateCoordinator that is subscriptable.

    Accepts the real HA constructor signature so subclasses (e.g.
    PresenceCoordinator) can be built via their REAL ``__init__`` in tests.
    ``hass`` and ``update_interval`` are stored because production code reads
    them (``self.hass.data``, ``self.update_interval.total_seconds()``).
    """

    def __init__(
        self,
        hass: Any = None,
        logger: Any = None,
        *,
        name: str = "",
        update_interval: Any = None,
        **kwargs: Any,
    ) -> None:
        self.hass = hass
        self.logger = logger
        self.name = name
        self.update_interval = update_interval
        self.data: Any = None


class _FakeCoordinatorEntity(_SubscriptableBase):
    """Stand-in for CoordinatorEntity that is subscriptable.

    Sets self.coordinator like the real base class — needed the moment any
    subclass's properties read self.coordinator (e.g. device_tracker.py's
    PadSpanDeviceTracker), not just the ones already exercised by tests.
    """

    def __init__(self, coordinator: Any, *args: Any, **kwargs: Any) -> None:
        self.coordinator = coordinator


_uc.DataUpdateCoordinator = _FakeDataUpdateCoordinator  # type: ignore[attr-defined]
_uc.UpdateFailed = Exception                             # type: ignore[attr-defined]
_uc.CoordinatorEntity = _FakeCoordinatorEntity           # type: ignore[attr-defined]

# homeassistant.helpers.entity_platform
_ha_mods["homeassistant.helpers.entity_platform"].AddEntitiesCallback = MagicMock  # type: ignore[attr-defined]

# homeassistant.helpers — registries (area, device, entity)
for _reg in ("area_registry", "device_registry", "entity_registry"):
    # These are used as ``helpers.area_registry.async_get(hass)`` etc.
    pass  # MagicMock default __getattr__ handles them

# homeassistant.helpers.aiohttp_client
_ha_mods["homeassistant.helpers.aiohttp_client"].async_get_clientsession = MagicMock  # type: ignore[attr-defined]

# homeassistant.components.device_tracker
_dt = _ha_mods["homeassistant.components.device_tracker"]


class _FakeSourceType:
    """Stand-in for device_tracker.SourceType (a StrEnum in real HA)."""
    GPS = "gps"
    ROUTER = "router"
    BLUETOOTH = "bluetooth"
    BLUETOOTH_LE = "bluetooth_le"


class _FakeTrackerEntity:
    """Stand-in for device_tracker.TrackerEntity (subclassed in device_tracker.py)."""
    pass


_dt.SourceType = _FakeSourceType      # type: ignore[attr-defined]
_dt.TrackerEntity = _FakeTrackerEntity  # type: ignore[attr-defined]

# homeassistant.components.sensor
_sensor = _ha_mods["homeassistant.components.sensor"]


class _FakeSensorEntity:
    """Stand-in for SensorEntity (subclassed in sensor.py)."""
    pass


_sensor.SensorEntity = _FakeSensorEntity   # type: ignore[attr-defined]
_sensor.SensorStateClass = MagicMock       # type: ignore[attr-defined]

# homeassistant.components.websocket_api
_ws = _ha_mods["homeassistant.components.websocket_api"]
_ws.async_register_command = MagicMock  # type: ignore[attr-defined]
def _ws_command(schema):
    """Record the command schema on the handler.

    Real HA validates incoming messages against this schema and rejects any
    key it doesn't declare, so the schema is part of the handler's contract —
    keep it reachable from tests instead of discarding it.
    """
    def _decorate(fn):
        fn.ws_schema = schema
        return fn
    return _decorate


_ws.websocket_command = _ws_command  # type: ignore[attr-defined]
_ws.async_response = lambda fn: fn    # type: ignore[attr-defined]
_ws.require_admin = lambda fn: fn     # type: ignore[attr-defined]

# homeassistant.util.dt
def _fake_utcnow() -> datetime:
    return datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)


_ha_mods["homeassistant.util.dt"].utcnow = _fake_utcnow  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# 2.5  Wire each stub submodule onto its parent stub as a real attribute
#      (e.g. homeassistant.components.websocket_api = <that stub>).  Without
#      this, `from homeassistant.components import websocket_api` never finds
#      a real __dict__ entry on the parent and falls through to the fallback
#      __getattr__ below — which hands back an unrelated MagicMock instead of
#      the intended stub, silently turning every websocket_api-decorated
#      handler (and similar) into a MagicMock. Must run before step 3 so the
#      real attribute wins over the fallback.
# ---------------------------------------------------------------------------

for _name, _mod in _ha_mods.items():
    if "." not in _name:
        continue
    _parent_name, _, _leaf = _name.rpartition(".")
    _parent = _ha_mods.get(_parent_name)
    if _parent is not None:
        setattr(_parent, _leaf, _mod)

# ---------------------------------------------------------------------------
# 3.  Make every stub module return a MagicMock for any attribute that was
#     NOT explicitly set above.  This avoids KeyError / AttributeError for
#     names we forgot to list.
# ---------------------------------------------------------------------------

for _mod in _ha_mods.values():
    _original_getattr = getattr(type(_mod), "__getattr__", None)

    def _make_fallback(mod: ModuleType) -> Any:
        def _fallback(name: str) -> Any:
            return MagicMock()
        return _fallback

    _mod.__getattr__ = _make_fallback(_mod)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# 4.  Register all stub modules in sys.modules (only if not already present).
# ---------------------------------------------------------------------------

for _name, _mod in _ha_mods.items():
    sys.modules.setdefault(_name, _mod)


# ---------------------------------------------------------------------------
# 5.  Pytest fixtures
# ---------------------------------------------------------------------------

import pytest  # noqa: E402 — must come after sys.modules patching


class MockStore:
    """Minimal stand-in for homeassistant.helpers.storage.Store."""

    def __init__(self) -> None:
        self._data: Any = None

    async def async_load(self) -> Any:
        return self._data

    async def async_save(self, data: Any) -> None:
        self._data = data

    async def async_remove(self) -> None:
        self._data = None


class MockHass:
    """Minimal stand-in for homeassistant.core.HomeAssistant."""

    def __init__(self, tmp_path: Path) -> None:
        self._config_path = tmp_path
        self.config = MagicMock()
        self.config.path = lambda *parts: str(tmp_path.joinpath(*parts))

    async def async_add_executor_job(self, func, *args):
        return func(*args)


@pytest.fixture
def mock_hass(tmp_path: Path) -> MockHass:
    """Return a minimal mock HomeAssistant object backed by *tmp_path*."""
    return MockHass(tmp_path)


@pytest.fixture
def mock_store() -> MockStore:
    """Return a fresh MockStore instance."""
    return MockStore()


def seed_world_gauge(mdl: Any, maps: list) -> dict | None:
    """Seed a test model store's world gauge from these maps.

    R2 stopped measuring the house's metre scale on every read and started
    storing it, so a fixture that wants a world frame has to have one — the
    same way a real install gets one, from
    `ModelStore.async_ensure_world_gauge` at startup or on its first
    measurement. This is that, synchronously and without a store write, for
    fixtures that build `mdl.data` by hand.

    Returns the seed dict (or None), so a test can assert on what was chosen.
    """
    from custom_components.padspan_ha import fabric_truth

    g = fabric_truth.measure_world_gauge(maps, mdl)
    mdl.data["world_gauge"] = (
        {"m_per_unit": g["m_per_unit"], "source_map_id": g["source_map_id"]}
        if g else {"m_per_unit": None, "source_map_id": None}
    )
    return g


async def migration_backup(hass: Any, note: str, store_keys: list) -> str:
    """The auto-backup the migration is handed, for fixtures.

    Step 13 — the one-way placement conversion — deletes what it reads, so it
    refuses to run without a snapshot the same way `bright_import` does. A
    fixture that wants the conversion to happen has to supply one; a fixture
    that omits it is testing the refusal.
    """
    return "bk_test"


def maps_store_with(maps: list) -> Any:
    """A real MapsStore over an in-memory list of maps.

    A MagicMock is not enough any more: the placement conversion writes back
    through `async_update_map`, which is where a stack's placement fields are
    stripped, so a fixture that mocks it out is not exercising the thing that
    makes "one stored placement" true.
    """
    from unittest.mock import AsyncMock as _AM

    from custom_components.padspan_ha.maps_store import MapsStore

    ms = MapsStore.__new__(MapsStore)
    ms.hass = MagicMock()
    ms.store = _AM()
    ms.store.async_save = _AM()
    ms.maps_dir = Path(".")
    ms.data = {"maps": maps}
    return ms
