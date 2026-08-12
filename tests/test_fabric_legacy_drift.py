"""The fabric must notice when the legacy data it came from has changed.

Rolling back to a pre-fabric release, editing rooms, and rolling forward again
used to discard those edits silently — the fabric file's mere existence was the
"already imported" marker, and geometry is read from the fabric only. Worse than
losing them: the map keeps serving the stale shape the user believes they
corrected. These tests pin the detection, and pin that detection never
overwrites the user's fabric on its own.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from custom_components.padspan_ha.fabric_store import FabricStore


def _store(loaded=None) -> FabricStore:
    fs = FabricStore.__new__(FabricStore)
    fs.hass = MagicMock()
    fs.store = AsyncMock()
    fs.store.async_load = AsyncMock(return_value=loaded)
    fs.store.async_save = AsyncMock()
    fs.data = {}
    return fs


_GEO_V1 = {"Kitchen": {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]], "floor_id": "main"}}
_GEO_V2 = {"Kitchen": {"type": "poly", "points_m": [[0, 0], [9, 0], [9, 9], [0, 9]], "floor_id": "main"},
           "Garage": {"type": "poly", "points_m": [[9, 0], [15, 0], [15, 6], [9, 6]], "floor_id": "main"}}


async def _setup(fs, geometry, spatial=None):
    await fs.async_setup(legacy_geometry=geometry, legacy_spatial=spatial or {})


def test_first_import_records_what_it_came_from(anyio_backend=None):
    import asyncio
    fs = _store(loaded=None)
    asyncio.run(_setup(fs, _GEO_V1))
    assert fs.data["legacy_fingerprint"]
    assert fs.data["legacy_drift"] is False
    assert "Kitchen" in fs.data["floors"]["main"]["rooms"]


def test_unchanged_legacy_data_is_not_drift():
    import asyncio
    fs = _store(loaded=None)
    asyncio.run(_setup(fs, _GEO_V1))
    imported = dict(fs.data)

    fs2 = _store(loaded=imported)
    asyncio.run(_setup(fs2, _GEO_V1))          # same legacy data on next boot
    assert fs2.data.get("legacy_drift") in (False, None)


def test_edits_made_on_an_older_version_are_detected_not_discarded_silently():
    """The rollback-edit-upgrade sequence that used to lose work."""
    import asyncio
    fs = _store(loaded=None)
    asyncio.run(_setup(fs, _GEO_V1))
    imported = dict(fs.data)

    # ...user rolls back, reshapes Kitchen and adds Garage (those writes land
    # in the legacy keys), then upgrades again.
    fs2 = _store(loaded=imported)
    asyncio.run(_setup(fs2, _GEO_V2))

    assert fs2.data["legacy_drift"] is True, "the divergence must be visible"
    # ...and the user's committed fabric is NOT silently overwritten by it.
    assert fs2.data["floors"]["main"]["rooms"]["Kitchen"]["points_m"] == [[0, 0], [4, 0], [4, 3], [0, 3]]
    assert "Garage" not in fs2.data["floors"]["main"]["rooms"]
    assert any(h.get("op") == "legacy_drift_detected" for h in fs2.data.get("history", []))


def test_a_fabric_from_before_the_guard_adopts_a_baseline_instead_of_crying_drift():
    """Existing installs must not all wake up claiming divergence."""
    import asyncio
    fs = _store(loaded=None)
    asyncio.run(_setup(fs, _GEO_V1))
    legacy_era = {k: v for k, v in fs.data.items() if k not in ("legacy_fingerprint", "legacy_drift")}

    fs2 = _store(loaded=legacy_era)
    asyncio.run(_setup(fs2, _GEO_V1))
    assert fs2.data["legacy_drift"] is False
    assert fs2.data["legacy_fingerprint"]


def test_drift_clears_once_the_two_sides_agree_again():
    import asyncio
    fs = _store(loaded=None)
    asyncio.run(_setup(fs, _GEO_V1))
    drifted = dict(fs.data)
    fs2 = _store(loaded=drifted)
    asyncio.run(_setup(fs2, _GEO_V2))
    assert fs2.data["legacy_drift"] is True

    settled = dict(fs2.data)
    fs3 = _store(loaded=settled)
    asyncio.run(_setup(fs3, _GEO_V2))          # same legacy data as last boot
    assert fs3.data.get("legacy_drift") in (False, None)
