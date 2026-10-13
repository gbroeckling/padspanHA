# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Calibration data import — the counterpart Export JSON never had.

Garry, 2026-09-10: "do 2-10" (from a missing-features shortlist) — #10:
Maps already has a proven "Backup All Maps (JSON)" / "Restore from Backup"
round-trip; the Model tab's own "Export JSON" button had no import
counterpart at all. Mirrors that pattern, adapted for the one real
difference: there is no batch calibration-restore endpoint, so import is a
point-by-point loop against calibration_save_point (which always mints a
fresh id — calibration_store.py's async_add_point), with client-side
duplicate detection since the backend has nothing to compare the old id to.

Source-level pin, not a rendered-DOM test — matches this file's own
established convention for its interactive map tabs (see
test_calibration_map_panzoom.py).
"""

from __future__ import annotations

from pathlib import Path

_CAL = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
        / "www" / "padspan-ha" / "views" / "calibration.js")


def _src() -> str:
    return _CAL.read_text(encoding="utf-8")


def _model_tab_block() -> str:
    src = _src()
    start = src.index("function _modelTab(")
    nxt = src.index("\nfunction ", start + 1)
    return src[start:nxt]


def test_import_validates_the_file_shape_before_trusting_it():
    block = _model_tab_block()
    assert "Array.isArray(parsed.points)" in block, (
        "import must reject a file that isn't shaped like a calibration export")


def test_import_dedupes_against_points_already_on_this_install():
    """The backend always mints a NEW id (calibration_store.py's
    async_add_point) — re-importing the same file twice without client-side
    dedup would double every point silently."""
    block = _model_tab_block()
    assert "const existingKeys = new Set(pts.map(_dedupeKey))" in block
    assert "parsed.points.filter(p => !existingKeys.has(_dedupeKey(p)))" in block


def test_dedupe_key_is_map_position_and_collection_time_not_the_old_id():
    """The old id can never match a freshly-minted one — keying on it would
    make dedup never fire, silently re-importing duplicates forever."""
    block = _model_tab_block()
    key_fn = block[block.index("const _dedupeKey"):block.index("\n\n", block.index("const _dedupeKey"))]
    assert "p.id" not in key_fn, "deduping on the old id can never match a freshly-minted one"
    for field in ("p.map_id", "p.x_frac", "p.y_frac", "p.collected_at"):
        assert field in key_fn, f"dedupe key is missing {field}"


def test_import_saves_points_one_at_a_time_through_the_real_save_command():
    block = _model_tab_block()
    assert "ctx.actions.calibrationSavePoint(p)" in block


def test_import_never_pushes_the_stale_serialized_model():
    """The model is a derived artifact (calibrationComputeModel), not raw
    data — importing a stale one instead of recomputing would silently
    disagree with the points that were just restored."""
    block = _model_tab_block()
    imp_section = block[block.index('el("div", { style: "font-weight:600;font-size:13px;margin-bottom:4px" }, "Import")'):]
    assert "calibrationComputeModel" not in imp_section
    assert ".model" not in imp_section.split("impBtn.addEventListener")[1].split("const impChooseBtn")[0]


def test_the_confirm_prompt_is_not_silently_removed():
    """Writing dozens of points from a stale/wrong file with no confirm is
    exactly the kind of silent bulk-write mistake this codebase avoids
    elsewhere (see Maps' own Restore from Backup, which confirms too)."""
    block = _model_tab_block()
    assert "if (!confirm(" in block


# The dedupe key above only works if a saved point keeps the date it was
# collected: async_add_point used to stamp every save with "now", so no file
# point ever matched a stored one and a retry imported every point again.

async def test_imported_point_keeps_its_collection_date():
    from unittest.mock import AsyncMock
    from tests.test_calibration_store import _make_store
    store = _make_store()
    store._async_train_rf = AsyncMock()
    saved = await store.async_add_point({
        "map_id": "", "x_m": 1.0, "y_m": 2.0, "room": "Kitchen",
        "collected_at": "2026-03-01T10:20:30+00:00",
        "scanner_readings": [{"source": "AA:01", "rssi_samples": [-60.0]}],
    })
    assert saved["collected_at"] == "2026-03-01T10:20:30+00:00"


async def test_future_or_garbage_collection_date_becomes_now():
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock
    from tests.test_calibration_store import _make_store
    store = _make_store()
    store._async_train_rf = AsyncMock()
    today = datetime.now(timezone.utc).date().isoformat()
    for bad in ("2999-01-01T00:00:00+00:00", "yesterday", None):
        saved = await store.async_add_point({
            "map_id": "", "x_m": 1.0, "y_m": 2.0, "room": "Kitchen",
            "collected_at": bad,
            "scanner_readings": [{"source": "AA:01", "rssi_samples": [-60.0]}],
        })
        assert saved["collected_at"].startswith(today), bad


def test_import_is_reachable_with_no_points():
    """A fresh install or one after Clear All is exactly when Import is
    needed; the empty state returned before the Actions card was built."""
    block = _model_tab_block()
    empty = block[block.index("if (!pts.length) {"):]
    empty = empty[:empty.index("return wrap;")]
    assert "_actionsCard(" in empty
