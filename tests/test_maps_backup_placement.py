# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""A backup that brings back maps without their placements brings back nothing.

Two separate holes, both of them "the map and where it sits are stored apart":

1. The panel's Map Data Backup (JSON) exported each map's picture, stack,
   calibration and notes, and left `map_transforms` out. That record is the
   map's placement IN METRES, and it is the copy that survives a restore into
   a house with a different world gauge — the stack beside it is in world
   units and does not. It could not have been recovered from a Model-store
   backup either: `map_transforms` is keyed by map id, and a restored map is
   given a NEW id.

2. The store Backup/Restore dialog let Maps and Model be restored separately.
   They are one fact in two files, keyed to each other by map id, so restoring
   one alone pairs every map with a placement belonging to a different set of
   maps.

Done NOW, while a second copy of a map's placement still exists to write down.
R3 deletes the stack as an independent record; after that a Maps-only restore
is a set of pictures with no placement at all.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DOMAIN,
    FABRIC_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY,
)

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "maps_backup_placement.mjs"
_NODE = shutil.which("node")


# ── 1. the panel's Map Data Backup ──────────────────────────────────────────

@pytest.mark.skipif(_NODE is None, reason="node is not installed")
def test_the_maps_backup_carries_and_restores_the_placement() -> None:
    res = subprocess.run([_NODE, str(_SCRIPT), str(_VIEWS)],
                         capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, f"node failed:\n{res.stdout}\n{res.stderr}"
    out = json.loads(res.stdout.strip().splitlines()[-1])
    assert out["failures"] == [], out["failures"]
    assert len(out["checks"]) >= 14, out["checks"]


# ── 2. Maps and Model are restored together ─────────────────────────────────

class _FakeStore:
    """Stands in for homeassistant.helpers.storage.Store."""

    saved: dict = {}

    def __init__(self, hass, version, key):
        self._key = key

    async def async_load(self):
        return None

    async def async_save(self, data):
        _FakeStore.saved[self._key] = data

    async def async_remove(self):
        _FakeStore.saved.pop(self._key, None)


def _backup_hass(monkeypatch, stores: dict):
    """A hass whose backup index holds one backup with `stores`."""
    import homeassistant.helpers.storage as _hs
    from custom_components.padspan_ha import ws_backup

    bk = {"backups": [{"id": "bk1", "created_at": "2026-01-01T00:00:00+00:00",
                       "version": "0.37.0", "note": "", "stores": stores,
                       "map_images": {}}]}

    async def _load(_hass):
        return bk

    monkeypatch.setattr(ws_backup, "_load_backups", _load)
    _FakeStore.saved = {}
    monkeypatch.setattr(_hs, "Store", _FakeStore)

    mdl = MagicMock()
    mdl.data = {"map_transforms": {}}
    mdl.async_ensure_world_gauge = AsyncMock(return_value=None)
    ms = MagicMock()
    ms.data = {"maps": []}
    fab = MagicMock()
    fab.data = {"floors": {}, "history": []}
    hass = MagicMock()
    hass.data = {DOMAIN: {DATA_MODEL: mdl, DATA_MAPS: ms, DATA_FABRIC: fab}}
    return hass, mdl


# The fabric entry rides along in every fixture: without it the restore takes
# the pre-fabric branch and refuses for a different reason entirely, which
# would make these tests pass for the wrong one.
_BOTH = {MAPS_STORE_KEY: {"maps": []}, MODEL_STORE_KEY: {"map_transforms": {}},
         FABRIC_STORE_KEY: {"floors": {}}, "padspan_ha.settings": {}}


@pytest.mark.asyncio
@pytest.mark.parametrize("selected,refused", [
    ([MAPS_STORE_KEY], True),
    ([MODEL_STORE_KEY], True),
    ([MAPS_STORE_KEY, "padspan_ha.settings"], True),
    ([MAPS_STORE_KEY, MODEL_STORE_KEY], False),
    (["padspan_ha.settings"], False),
    ([], False),
])
async def test_restoring_one_without_the_other_is_refused(
        monkeypatch, selected, refused) -> None:
    """Refused, not warned — and refused SERVER-side.

    The two checkboxes are coupled in the panel so nobody meets this, but the
    panel is not the only caller of a websocket command, and a refusal that
    lives in the UI is a refusal that does not exist.
    """
    from custom_components.padspan_ha.ws_backup import ws_store_backup_restore

    hass, _ = _backup_hass(monkeypatch, dict(_BOTH))
    conn = MagicMock()

    await ws_store_backup_restore(hass, conn, {
        "id": 1, "backup_id": "bk1", "store_keys": selected})

    if refused:
        conn.send_error.assert_called_once()
        assert conn.send_error.call_args[0][1] == "restore_incomplete"
        assert "Nothing was changed" in conn.send_error.call_args[0][2]
        conn.send_result.assert_not_called()
    else:
        conn.send_error.assert_not_called()
        conn.send_result.assert_called_once()


@pytest.mark.asyncio
async def test_restoring_everything_is_never_refused(monkeypatch) -> None:
    """`store_keys` omitted means "all", and all is always self-consistent."""
    from custom_components.padspan_ha.ws_backup import ws_store_backup_restore

    hass, _ = _backup_hass(monkeypatch, dict(_BOTH))
    conn = MagicMock()

    await ws_store_backup_restore(hass, conn, {"id": 1, "backup_id": "bk1"})

    conn.send_error.assert_not_called()
    conn.send_result.assert_called_once()


@pytest.mark.asyncio
async def test_a_backup_that_predates_a_store_does_not_demand_it(monkeypatch) -> None:
    """The pairing is over what the BACKUP holds, not over the two names.

    A backup taken before the model store existed carries only Maps, and
    demanding a Model entry it cannot supply would make it unrestorable.
    """
    from custom_components.padspan_ha.ws_backup import ws_store_backup_restore

    hass, _ = _backup_hass(monkeypatch, {MAPS_STORE_KEY: {"maps": []},
                                         FABRIC_STORE_KEY: {"floors": {}}})
    conn = MagicMock()

    await ws_store_backup_restore(hass, conn, {
        "id": 1, "backup_id": "bk1", "store_keys": [MAPS_STORE_KEY]})

    conn.send_error.assert_not_called()
    conn.send_result.assert_called_once()


@pytest.mark.asyncio
async def test_the_world_gauge_is_re_seeded_after_a_model_restore(monkeypatch) -> None:
    """A Model store backed up before R2 has no `world_gauge`.

    A restore replaces `mdl.data` wholesale, so it takes the gauge with it —
    and the startup migration's marker is already set, so a marker-guarded
    seed would never run again. The house would lose its metre scale
    permanently, at the moment the owner was trying to recover it.
    """
    from custom_components.padspan_ha.ws_backup import ws_store_backup_restore

    hass, mdl = _backup_hass(monkeypatch, dict(_BOTH))
    conn = MagicMock()

    await ws_store_backup_restore(hass, conn, {
        "id": 1, "backup_id": "bk1", "store_keys": [MAPS_STORE_KEY, MODEL_STORE_KEY]})

    conn.send_error.assert_not_called()
    mdl.async_ensure_world_gauge.assert_awaited_once()


def test_the_panel_ties_the_two_checkboxes_together() -> None:
    """So the owner never meets the refusal above."""
    src = (_VIEWS / "manage.js").read_text(encoding="utf-8", errors="replace")
    site = src[src.index("const checkboxes = [];"):src.index("// Map images checkbox")]
    assert 'c.value === "padspan_ha.maps"' in site, site[-800:]
    assert 'c.value === "padspan_ha.model"' in site
    assert 'addEventListener("change"' in site
    assert "o.checked = c.checked" in site
