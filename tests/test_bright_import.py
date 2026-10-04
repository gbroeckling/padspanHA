"""PadSpan Bright → PadSpan HA import (bright_import.py).

Guard 5 of the Bright plan: back up first, refuse a non-empty target, merge
never. Plus the mechanics — file to file through HA's Store, the map images,
the receipt stamped into settings, the licence carry-over, and the reload.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.padspan_ha import bright_import as bi
from custom_components.padspan_ha.const import (
    DATA_FABRIC, DATA_MAPS, DATA_MODEL, DATA_SETTINGS, DOMAIN,
    FABRIC_STORE_KEY, HOUSE3D_STORE_KEY, MAPS_STORE_KEY, MODEL_STORE_KEY, SETTINGS_STORE_KEY,
)


# In the generated Bright edition the source and target domains are the same
# and the importer is inert by design (test_a_bright_build_imports_nothing
# proves the rule from the full side) — there is nothing here to exercise.
pytestmark = pytest.mark.skipif(bi.BRIGHT_DOMAIN == DOMAIN, reason="a Bright build has no importer")


# ── a hass with a real .storage on disk ──────────────────────────────────────

class _FileStore:
    """Enough of homeassistant.helpers.storage.Store to write the file."""
    def __init__(self, hass, version, key):
        self.path = Path(hass.config.path(".storage")) / key
        self.key = key
        self.version = version

    async def async_save(self, data):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"version": self.version, "minor_version": 1,
                                         "key": self.key, "data": data}), encoding="utf-8")

    async def async_load(self):
        if not self.path.is_file():
            return None
        return json.loads(self.path.read_text(encoding="utf-8")).get("data")


def _hass(tmp_path: Path, *, fabric=None, model=None, maps=None, settings=None):
    h = SimpleNamespace()
    h.config = MagicMock()
    h.config.path = lambda *parts: str(tmp_path.joinpath(*parts))
    h.data = {DOMAIN: {
        DATA_FABRIC: SimpleNamespace(data=fabric if fabric is not None else {"floors": {}, "history": []}),
        DATA_MODEL: SimpleNamespace(data=model if model is not None else {}),
        DATA_MAPS: SimpleNamespace(data=maps if maps is not None else {"maps": []}),
        DATA_SETTINGS: SimpleNamespace(data=settings if settings is not None else {}),
    }}
    h.tasks = []
    h.async_create_task = lambda coro: h.tasks.append(coro)
    h.reloaded = []
    entry = SimpleNamespace(entry_id="entry-1")
    h.config_entries = SimpleNamespace(
        async_entries=lambda domain: [entry] if domain == DOMAIN else [],
        async_reload=_reload_recorder(h),
    )
    return h


def _reload_recorder(h):
    async def _r(entry_id):
        h.reloaded.append(entry_id)
    return _r


def _write_bright(tmp_path: Path, suffix: str, data) -> Path:
    p = tmp_path / ".storage" / f"padspan_bright.{suffix}"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"version": 1, "minor_version": 1, "key": f"padspan_bright.{suffix}", "data": data}),
                 encoding="utf-8")
    return p


def _read_target(tmp_path: Path, key: str):
    p = tmp_path / ".storage" / key
    return json.loads(p.read_text(encoding="utf-8"))["data"] if p.is_file() else None


_HOUSE_FABRIC = {
    "floors": {"main": {"rooms": {"Kitchen": {"type": "poly", "points_m": [[0, 0], [4, 0], [4, 3], [0, 3]], "floor_id": "main"}}}},
    "light_positions_m": {"light.k": {"x_m": 1.0, "y_m": 1.5, "floor_id": "main"}},
    "rf_barriers_m": [{"id": "w1", "x1_m": 0, "y1_m": 0, "x2_m": 4, "y2_m": 0}],
    "history": [],
}
_HOUSE_MODEL = {"floors": [{"id": "main", "name": "Main", "level": 0}], "map_transforms": {"m1": {"scale": 1}}}
_HOUSE_MAPS = {"maps": [{"id": "m1", "name": "Main plan", "filename": "m1.png"}]}
_HOUSE_SETTINGS = {"light_shapes": {"light.k": "circle"}, "lights_hidden": ["light.x"], "lights_showcase": True}


@pytest.fixture(autouse=True)
def _file_store(monkeypatch):
    monkeypatch.setattr(bi, "Store", _FileStore)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _import(h, backup):
    """Run the import and drop the reload it schedules (the reload itself is
    exercised once, in the full-house test)."""
    res = _run(bi.async_import(h, backup))
    for c in h.tasks:
        c.close()
    h.tasks.clear()
    return res


async def _backup_ok(hass, note, keys):
    _backup_ok.calls.append((note, list(keys)))
    return "bk_test"
_backup_ok.calls = []


async def _backup_fail(hass, note, keys):
    return None


# ── target_contents ───────────────────────────────────────────────────────────

def test_target_contents_names_what_is_there():
    assert bi.target_contents(None, None, None) == []
    assert bi.target_contents({"floors": {}}, {}, {"maps": []}) == []
    got = bi.target_contents(_HOUSE_FABRIC, _HOUSE_MODEL, _HOUSE_MAPS)
    assert got == ["1 floor", "1 room", "1 placed light", "1 wall", "1 map transform", "1 map"]
    # A floor with no rooms is still a floor someone made.
    assert bi.target_contents({"floors": {"main": {"rooms": {}}}}, {}, {}) == ["1 floor"]
    # Legacy: shapes in the model only.
    assert bi.target_contents({}, {"room_geometry_m": {"A": {}, "B": {}}}, {}) == ["2 room shapes (model)"]


# ── the refusals ──────────────────────────────────────────────────────────────

def test_nothing_to_import(tmp_path):
    h = _hass(tmp_path)
    res = _run(bi.async_import(h, _backup_ok))
    assert res == {"ok": False, "error": "nothing_to_import", "message": res["message"]}
    assert not (tmp_path / ".storage" / FABRIC_STORE_KEY).exists()
    st = _run(bi.async_status(h))
    assert st["available"] is False and st["files"] == []


def test_a_bright_build_imports_nothing(tmp_path, monkeypatch):
    """In the generated edition BRIGHT_DOMAIN == DOMAIN: the importer is inert,
    even with files that would otherwise be its own source."""
    _write_bright(tmp_path, "fabric", _HOUSE_FABRIC)
    monkeypatch.setattr(bi, "BRIGHT_DOMAIN", DOMAIN)
    assert bi.bright_files(_hass(tmp_path)) == {}


def test_backup_first_and_no_backup_no_import(tmp_path):
    _write_bright(tmp_path, "fabric", _HOUSE_FABRIC)
    h = _hass(tmp_path)
    res = _run(bi.async_import(h, _backup_fail))
    assert res["ok"] is False and res["error"] == "backup_failed"
    assert _read_target(tmp_path, FABRIC_STORE_KEY) is None, "wrote without a backup"
    assert h.tasks == [], "scheduled a reload after refusing"


def test_refuses_a_non_empty_target_and_says_what_it_found(tmp_path):
    _write_bright(tmp_path, "fabric", _HOUSE_FABRIC)
    _write_bright(tmp_path, "settings", _HOUSE_SETTINGS)
    live_fabric = {"floors": {"up": {"rooms": {"Loft": {"type": "poly", "points_m": [[0, 0], [1, 0], [1, 1]]}}}}}
    h = _hass(tmp_path, fabric=live_fabric)
    _backup_ok.calls.clear()
    res = _run(bi.async_import(h, _backup_ok))
    assert res["ok"] is False and res["error"] == "target_not_empty"
    assert res["target_has"] == ["1 floor", "1 room"]
    assert "never merges" in res["message"]
    # Backed up FIRST (the plan's order), then refused; nothing written.
    assert _backup_ok.calls and _backup_ok.calls[0][1] == [FABRIC_STORE_KEY, MODEL_STORE_KEY, MAPS_STORE_KEY, SETTINGS_STORE_KEY,
                                                         HOUSE3D_STORE_KEY]   # Live Aboard's file is a house store too
    assert _read_target(tmp_path, FABRIC_STORE_KEY) is None
    assert _read_target(tmp_path, SETTINGS_STORE_KEY) is None
    assert h.tasks == []
    # And status says the same thing the button will.
    st = _run(bi.async_status(h))
    assert st["available"] and st["target_has"] == ["1 floor", "1 room"] and st["done_at"] is None


# ── the import ────────────────────────────────────────────────────────────────

def test_the_house_comes_across_and_the_entry_reloads(tmp_path):
    for suffix, data in (("fabric", _HOUSE_FABRIC), ("model", _HOUSE_MODEL),
                         ("maps", _HOUSE_MAPS), ("settings", _HOUSE_SETTINGS)):
        _write_bright(tmp_path, suffix, data)
    img_dir = tmp_path / "www" / "padspan_bright" / "maps"
    img_dir.mkdir(parents=True)
    (img_dir / "m1.png").write_bytes(b"\x89PNG-fake")
    (img_dir / "notes.txt").write_text("not an image")
    h = _hass(tmp_path)
    _backup_ok.calls.clear()

    res = _run(bi.async_import(h, _backup_ok))
    assert res["ok"] is True, res
    assert res["imported"] == ["fabric", "model", "maps", "settings"]
    assert res["images"] == 1 and res["backup_id"] == "bk_test" and res["reloading"] is True

    # File to file, verbatim.
    assert _read_target(tmp_path, FABRIC_STORE_KEY) == _HOUSE_FABRIC
    assert _read_target(tmp_path, MODEL_STORE_KEY) == _HOUSE_MODEL
    assert _read_target(tmp_path, MAPS_STORE_KEY) == _HOUSE_MAPS
    settings = _read_target(tmp_path, SETTINGS_STORE_KEY)
    assert settings["light_shapes"] == {"light.k": "circle"} and settings["lights_showcase"] is True
    assert settings[bi.DONE_KEY], "the receipt was not stamped"
    # The images, and only the images.
    assert (tmp_path / "www" / "padspan_ha" / "maps" / "m1.png").read_bytes() == b"\x89PNG-fake"
    assert not (tmp_path / "www" / "padspan_ha" / "maps" / "notes.txt").exists()
    # The source is left where it was.
    assert (tmp_path / ".storage" / "padspan_bright.fabric").is_file()
    assert (img_dir / "m1.png").is_file()
    # The reload was scheduled for the entry.
    assert len(h.tasks) == 1
    _run(h.tasks[0])
    assert h.reloaded == ["entry-1"]
    # Status is now a receipt (the live settings object is what status reads;
    # after the reload it would carry the stamp — emulate that).
    h.data[DOMAIN][DATA_SETTINGS].data = settings
    st = _run(bi.async_status(h))
    assert st["done_at"] == settings[bi.DONE_KEY]


def test_a_key_already_entered_here_survives_when_bright_brings_none(tmp_path):
    _write_bright(tmp_path, "settings", dict(_HOUSE_SETTINGS))
    live_settings = {"forensics_license_key": "PRO-KEY", "forensics_license_expires": "2027-01-01",
                     "license_tier": "pro"}
    h = _hass(tmp_path, settings=live_settings)
    res = _import(h, _backup_ok)
    assert res["ok"], res
    s = _read_target(tmp_path, SETTINGS_STORE_KEY)
    assert s["forensics_license_key"] == "PRO-KEY" and s["license_tier"] == "pro"
    assert s["light_shapes"] == {"light.k": "circle"}


@pytest.mark.parametrize("live,bright,done,first", [
    ({"trial_nudge_done": True, "first_seen_ts": 2_000.0}, {"first_seen_ts": 1_000.0}, True, 1_000.0),
    ({"first_seen_ts": 1_000.0}, {"trial_nudge_done": True, "first_seen_ts": 2_000.0}, True, 1_000.0),
    ({"trial_nudge_done": False, "first_seen_ts": 0}, {"first_seen_ts": 3_000.0}, False, 3_000.0),
])
def test_the_trial_answer_and_first_sighting_come_across_from_either_side(tmp_path, live, bright, done, first):
    """The trial milestone's per-install facts (settings_store.trial_state_kept):
    answered on either install stays answered, and the house is as old as its
    earliest sighting — an import never brings the card back or restarts its week."""
    _write_bright(tmp_path, "settings", {**_HOUSE_SETTINGS, **bright})
    h = _hass(tmp_path, settings=dict(live))
    res = _import(h, _backup_ok)
    assert res["ok"], res
    s = _read_target(tmp_path, SETTINGS_STORE_KEY)
    assert s["trial_nudge_done"] is done and s["first_seen_ts"] == first, s


def test_brights_own_key_wins_when_it_has_one(tmp_path):
    _write_bright(tmp_path, "settings", {**_HOUSE_SETTINGS, "forensics_license_key": "BRIGHT-KEY",
                                         "license_tier": "bright"})
    h = _hass(tmp_path, settings={"forensics_license_key": "OLD", "license_tier": "pro"})
    res = _import(h, _backup_ok)
    assert res["ok"], res
    s = _read_target(tmp_path, SETTINGS_STORE_KEY)
    assert s["forensics_license_key"] == "BRIGHT-KEY" and s["license_tier"] == "bright"


def test_a_partial_bright_house_imports_what_exists(tmp_path):
    _write_bright(tmp_path, "fabric", _HOUSE_FABRIC)
    h = _hass(tmp_path)
    res = _import(h, _backup_ok)
    assert res["ok"] and res["imported"] == ["fabric"] and res["images"] == 0
    assert _read_target(tmp_path, SETTINGS_STORE_KEY) is None


# ── the wiring ────────────────────────────────────────────────────────────────

def test_the_wire_and_the_card():
    root = Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
    ws = (root / "websocket.py").read_text(encoding="utf-8")
    assert "async_register_command(hass, ws_bright_import_status)" in ws
    assert "async_register_command(hass, ws_bright_import)" in ws
    wire = (root / "ws_bright_import.py").read_text(encoding="utf-8")
    assert "require_admin" in wire, "the import writes stores and reloads the entry: admin only"
    assert "_auto_backup" in wire, "the backup is the ordinary Backup/Restore snapshot"
    health = (root / "www" / "padspan-ha" / "views" / "health.js").read_text(encoding="utf-8")
    assert "padspan_ha/bright_import_status" in health and "padspan_ha/bright_import\"" in health
    assert "never merges" in health


def test_an_import_drops_the_stale_3d_house_store(tmp_path):
    """Live Aboard's store is loaded on first use and a reload keeps it, so an
    import that brings a 3D-house file must drop the cached one; the next use
    reads the imported file (house3d_store.async_get_store)."""
    from custom_components.padspan_ha.const import DATA_HOUSE3D
    imported = {"schema": 1, "pieces": {"fur_9": {"id": "fur_9", "recipe": {"kind": "bed"}}}}
    _write_bright(tmp_path, "house3d", imported)
    h = _hass(tmp_path)
    h.data[DOMAIN][DATA_HOUSE3D] = SimpleNamespace(data={"schema": 1, "pieces": {}})   # stale
    _backup_ok.calls.clear()
    res = _run(bi.async_import(h, _backup_ok))
    assert res["ok"] is True and "house3d" in res["imported"], res
    assert DATA_HOUSE3D not in h.data[DOMAIN], "the stale copy is gone"
    assert _read_target(tmp_path, HOUSE3D_STORE_KEY) == imported



# ── Live Aboard's furniture (P2) ──────────────────────────────────────────────

_FURNITURE = {"schema": 1, "pieces": {"fur_1a2b3c4d": {"id": "fur_1a2b3c4d", "recipe": {"kind": "sofa"}},
                                      "fur_00000001": {"id": "fur_00000001", "recipe": {"kind": "bed"}}}}


def test_target_contents_counts_the_furniture():
    assert bi.target_contents(None, None, None, _FURNITURE) == ["2 pieces of furniture"]
    one = {"pieces": {"fur_1a2b3c4d": {}}}
    assert bi.target_contents(_HOUSE_FABRIC, None, None, one)[-1] == "1 piece of furniture"
    assert bi.target_contents(None, None, None, {"schema": 1, "pieces": {}, "lights": {"light.a": {"z_m": 1}}}) == []
    assert bi.target_contents(None, None, None, {"schema": 2, "pieces": [{"id": "fur_1"}]}) == ["1 piece of furniture"]


def test_furniture_alone_makes_the_target_not_empty_even_before_anything_loaded_it(tmp_path):
    """A house whose floors were deleted can still hold furniture: the import
    would put another house under it. Counted from the file itself when no
    one has loaded the 3D house yet; the status never loads it."""
    from custom_components.padspan_ha.const import DATA_HOUSE3D
    _write_bright(tmp_path, "fabric", _HOUSE_FABRIC)
    target = tmp_path / ".storage" / HOUSE3D_STORE_KEY
    target.write_text(json.dumps({"version": 1, "key": HOUSE3D_STORE_KEY, "data": _FURNITURE}), encoding="utf-8")
    h = _hass(tmp_path)
    st = _run(bi.async_status(h))
    assert st["target_has"] == ["2 pieces of furniture"]
    assert DATA_HOUSE3D not in h.data[DOMAIN], "the status reads the file; it never loads the store"
    res = _run(bi.async_import(h, _backup_ok))
    assert res["ok"] is False and res["error"] == "target_not_empty" and res["target_has"] == ["2 pieces of furniture"]
    assert _read_target(tmp_path, FABRIC_STORE_KEY) is None and _read_target(tmp_path, HOUSE3D_STORE_KEY) == _FURNITURE
    h.data[DOMAIN][DATA_HOUSE3D] = SimpleNamespace(data={"schema": 1, "pieces": {}})   # loaded and since emptied
    assert _run(bi.async_status(h))["target_has"] == [], "a loaded store is the truth, not the file"


def test_the_status_says_how_much_furniture_bright_brings(tmp_path):
    _write_bright(tmp_path, "fabric", _HOUSE_FABRIC)
    _write_bright(tmp_path, "house3d", _FURNITURE)
    st = _run(bi.async_status(h := _hass(tmp_path)))
    assert st["source"]["has"][-1] == "2 pieces of furniture" and st["target_has"] == []
    res = _import(h, _backup_ok)
    assert res["ok"] is True and _read_target(tmp_path, HOUSE3D_STORE_KEY) == _FURNITURE
