"""Load PadSpan's own positioning modules outside Home Assistant.

The benchmark must score the code PadSpan actually runs (knn_locate, the
held-out spatial solve), not a copy of it. Those modules import a few
homeassistant names at the top of the file and never use them on the paths
the benchmark calls, so when HA is not installed a stand-in is put in front
of the import system for homeassistant.* only. The package's __init__.py
(which sets up the whole integration) is skipped: the modules are loaded
under a private package name with the integration folder as its path.

Nothing here touches a real install; it only reads the source files.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import sys
import types
from pathlib import Path

INTEGRATION = Path(__file__).resolve().parents[2] / "custom_components" / "padspan_ha"
PKG = "_padspan_bench"


class _Anything:
    """A name homeassistant would have provided: callable, subscriptable,
    usable as a base class or a decorator, and never consulted."""

    def __init__(self, *a, **kw) -> None:
        pass

    def __class_getitem__(cls, item):
        return cls

    def __call__(self, *a, **kw):
        return a[0] if len(a) == 1 and callable(a[0]) and not kw else _Anything()

    def __getattr__(self, name):
        return _Anything()


class _StubModule(types.ModuleType):
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        if name == "callback":
            return lambda fn: fn
        cls = type(name, (_Anything,), {})
        setattr(self, name, cls)
        return cls


class _StubFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == "homeassistant" or fullname.startswith("homeassistant."):
            return importlib.machinery.ModuleSpec(fullname, self, is_package=True)
        return None

    def create_module(self, spec):
        mod = _StubModule(spec.name)
        mod.__path__ = []
        return mod

    def exec_module(self, module):
        pass


def _ensure_ha() -> None:
    if "homeassistant" in sys.modules:
        return
    try:
        import homeassistant  # noqa: F401, PLC0415
    except ImportError:
        sys.meta_path.insert(0, _StubFinder())


def module(name: str):
    """PadSpan's own module `name` (e.g. "heldout", "calibration_store")."""
    _ensure_ha()
    if PKG not in sys.modules:
        pkg = types.ModuleType(PKG)
        pkg.__path__ = [str(INTEGRATION)]
        sys.modules[PKG] = pkg
    return importlib.import_module(f"{PKG}.{name}")
