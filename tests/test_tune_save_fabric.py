# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""Tune Save transaction boundaries, tested through the SHIPPED callbacks.

The lifecycle harness executes the actual registered callbacks from
calibration.js (Tune Save, Height Save Z, Remove-from-floor, Reset) with a
faithful backend model (spatial positions vs model metadata, deferred
requests, swallowable refreshes). Single-save scenarios run init ->
mutations -> Save -> refreshes -> rerender sync. Flow scenarios run
multi-step callback sequences and report journals.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SCRIPT = Path(__file__).parent / "js" / "tune_save_fabric.mjs"
_CALIB = _VIEWS / "calibration.js"
_NODE = Path.home() / ".nvm" / "versions" / "node" / "v24.14.1" / "bin" / "node"
if not _NODE.exists():
    _NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(not _NODE, reason="node is not installed")

_EE1 = "aa:bb:cc:dd:ee:01"
_EE2 = "aa:bb:cc:dd:ee:02"
_GH_NEW = "google_home_3e759f07-new"


def _run(scenario: str, views: Path = _VIEWS, timeout: int = 120) -> dict:
    res = subprocess.run([str(_NODE), str(_SCRIPT), str(views), scenario],
                         capture_output=True, text=True, encoding="utf-8",
                         timeout=timeout)
    assert res.returncode == 0, (
        f"harness failed for {scenario}:\n{(res.stderr or '')[-2000:]}")
    lines = [ln for ln in (res.stdout or "").strip().splitlines() if ln.startswith("{")]
    assert lines, f"harness printed no JSON for {scenario}"
    return json.loads(lines[-1])


def _position_posts(out: dict) -> dict[str, dict]:
    return {p["source"]: p for p in out.get("payloads", [])
            if p.get("type") == "padspan_ha/fabric_scanner_position_set" and p.get("source")}


def _all_position_posts(out: dict) -> list[dict]:
    return [p for p in out.get("payloads", [])
            if p.get("type") == "padspan_ha/fabric_scanner_position_set"]


def _success_toasts(out: dict) -> list[str]:
    return [t for t in out["toasts"] if "receiver positions saved" in t.lower()]


def _journal(out: dict) -> dict[str, dict]:
    return {e["ev"]: e for e in out.get("journal", [])}


_V1_HANDLER = '''  saveBtn.addEventListener("click", async () => {
    const dirtyIds = Object.keys(ts.dirtyMaps).filter(id => ts.dirtyMaps[id]);
    if (!dirtyIds.length) { statusLbl.textContent = "No changes"; setTimeout(() => { statusLbl.textContent = ""; }, 2000); return; }
    saveBtn.disabled = true;
    statusLbl.textContent = "Saving...";
    try {
      // Save to fabric (metre-space authority), then sync fracs back to maps
      for (const mapId of dirtyIds) {
        const origMap = maps_list.find(m => m.id === mapId);
        if (!origMap) continue;
      }
      // Clear dirty state BEFORE refresh so re-rendered view shows clean state
      ts.dirtyMaps = {};
      ts.selectedRx = null;
      ctx.toast("Receiver positions saved");
      // mapsRefresh refreshes data + triggers re-render (which updates dirty label & stamp)
      await ctx.actions.mapsRefresh();
    } catch (e) {
      ctx.toast("Save failed: " + String(e), true);
      statusLbl.textContent = "Error saving";
      saveBtn.disabled = false;
    }
  });'''


@pytest.fixture(scope="module")
def v1_views(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """A views dir holding the PRE-FIX handler: current helpers (pure)
    plus a calibration.js whose Tune Save block is the old no-op. The
    Height/Remove/Reset handlers come along unchanged (they postdate the
    fixture's purpose only where noted)."""
    d = tmp_path_factory.mktemp("v1views")
    shutil.copy(_VIEWS / "stack_transform.js", d / "stack_transform.js")
    shutil.copy(_VIEWS / "tune_save_plan.js", d / "tune_save_plan.js")
    src = _CALIB.read_text(encoding="utf-8")
    head = '  saveBtn.addEventListener("click", async () => {'
    mark = "const dirtyIds = Object.keys(ts.dirtyMaps)"
    h = src.find(head)
    while h >= 0:
        if mark in src[h:h + 2600]:
            break
        h = src.find(head, h + 1)
    assert h >= 0, "current Tune Save handler not found"
    tail = "  });\n\n  // Reset button"
    t = src.find(tail, h)
    assert t > h, "save/reset anchor moved"
    (d / "calibration.js").write_text(
        src[:h] + _V1_HANDLER + src[t + len("  });"):], encoding="utf-8")
    return d


def test_save_handler_names_resolve_in_module_scope() -> None:
    src = _CALIB.read_text(encoding="utf-8")
    assert re.search(r"import\(`\./tune_save_plan\.js", src)
    assert "tuneSavePlanInit({ mapFracToMetres, metresToMapFrac });" in src


def test_single_shared_seed_routine_for_init_and_reset() -> None:
    src = _CALIB.read_text(encoding="utf-8")
    assert src.count("tuneSyncTuneDrafts(ts, maps_list,") >= 2
    reset = src[src.find('resetBtn.addEventListener("click"',
                         src.find("Receiver Position Tuning")):]
    reset = reset[:reset.find("ctrlRow.appendChild(saveBtn)")]
    assert "tuneSyncTuneDrafts" in reset
    assert "(m.receivers || [])" not in reset.replace(
        "tuneSyncTuneDrafts(ts, maps_list,", ""), \
        "Reset still reseeds map pins directly"


def test_moved_and_new_receivers_reach_the_fabric() -> None:
    out = _run("moved")
    posts = _position_posts(out)
    assert _EE1 in posts, f"moved receiver never posted: {out['payloads']}"
    assert _GH_NEW in posts, f"new google_home pin never posted: {out['payloads']}"
    assert _EE2 not in posts, "receiver from a CLEAN map was rewritten"
    assert _success_toasts(out), f"no success toast: {out['toasts']}"
    assert out["dirty"] == {}, f"dirty not cleared: {out['dirty']}"
    assert out["refreshCount"] >= 2


def test_new_pin_converts_through_the_rotated_sheared_transform() -> None:
    from unittest.mock import AsyncMock, MagicMock

    from custom_components.padspan_ha.model_store import ModelStore

    mdl = ModelStore.__new__(ModelStore)
    mdl.hass = MagicMock()
    mdl.store = AsyncMock()
    mdl.data = {"map_transforms": {
        "mA": {"origin_x_m": 1.3, "origin_y_m": -0.98, "scale_x_m": 18.01,
               "scale_y_m": 12.04, "rotation_rad": -0.015, "shear_rad": 0.008,
               "floor_id": "downstairs"}}}
    mdl.fabric = None
    expected = mdl.map_frac_to_metres(0.0289, 0.0485, "mA")

    pin = _position_posts(_run("moved"))[_GH_NEW]
    assert (pin["x_m"], pin["y_m"]) == pytest.approx(expected, abs=5e-4)
    assert pin["floor_id"] == "downstairs"


def test_stale_unedited_pin_never_posts() -> None:
    out = _run("stale")
    posts = _position_posts(out)
    assert list(posts) == [_GH_NEW], f"stale source posted: {posts}"
    assert _success_toasts(out)


def test_reconciled_untouched_pin_never_posts() -> None:
    out = _run("untouched")
    posts = _position_posts(out)
    assert list(posts) == [_GH_NEW], f"rounded untouched pin posted: {posts}"
    assert _success_toasts(out)


def test_existing_height_preserved_on_move() -> None:
    pin = _position_posts(_run("moved"))[_EE1]
    assert pin["z_m"] == pytest.approx(1.2)


def test_conflicting_duplicate_sources_refused() -> None:
    out = _run("conflict")
    assert _position_posts(out) == {}, f"conflict posted: {out['payloads']}"
    assert out["dirty"].get("mA") is True and out["dirty"].get("mB") is True
    assert not _success_toasts(out)


def test_missing_fabric_conflict_refused_on_both() -> None:
    out = _run("missingconflict")
    assert _position_posts(out) == {}, f"dedup wrote first: {out['payloads']}"
    assert out["dirty"].get("mA") is True and out["dirty"].get("mB") is True
    assert not _success_toasts(out)


def test_identical_cross_map_candidates_single_request() -> None:
    """Finding 5: identical candidates group to ONE request; on failure
    ALL owner maps stay pending; the success count is unique requests."""
    out = _run("dedupfail")
    posts = _all_position_posts(out)
    assert len(posts) == 1, f"expected one grouped request: {posts}"
    assert posts[0]["source"] == _GH_NEW
    assert out["dirty"].get("mA") is True and out["dirty"].get("mB") is True, \
        f"failure must keep ALL owners pending: {out['dirty']}"
    assert not _success_toasts(out)


def test_missing_fabric_pin_saved_without_drag() -> None:
    out = _run("missingfabric")
    posts = _position_posts(out)
    assert list(posts) == [_GH_NEW], f"expected only the missing pin: {posts}"
    assert out["heightVisible"][_GH_NEW] is True
    assert _success_toasts(out)


def test_truly_unchanged_session_stays_silent() -> None:
    out = _run("nodrag")
    assert out["payloads"] == []
    assert out["toasts"] == []
    assert out["refreshCount"] == 0


def test_save_refresh_exposes_height_and_reconciles_draft() -> None:
    out = _run("moved")
    assert out["heightVisible"][_GH_NEW] is True
    assert out["heightVisible"][_EE1] is True
    draft = {r["source"]: r for r in out["draft"]["mA"]}
    assert set(draft) >= {_EE1, _GH_NEW}
    assert draft[_EE1]["id"] == "r1" and draft[_GH_NEW]["label"] == "Spare Mini"


def test_unmeasured_map_refuses_loudly_and_keeps_dirty() -> None:
    out = _run("unmeasured")
    assert _position_posts(out) == {}
    assert out["dirty"].get("mB") is True
    assert not _success_toasts(out)


def test_singular_transform_refuses() -> None:
    out = _run("singular")
    assert _position_posts(out) == {}
    assert out["dirty"].get("mA") is True
    assert not _success_toasts(out)


def test_negative_scale_refuses() -> None:
    out = _run("negscale")
    assert _position_posts(out) == {}
    assert out["dirty"].get("mA") is True
    assert not _success_toasts(out)


def test_invalid_coords_are_failed_work_not_silent_skip() -> None:
    out = _run("invalid")
    assert _position_posts(out) == {}
    assert out["dirty"].get("mA") is True, "invalid row cleared dirty"
    assert not _success_toasts(out), f"false success: {out['toasts']}"


def test_missing_map_preserves_and_reports_error() -> None:
    out = _run("missingmap")
    assert _position_posts(out) == {}
    assert out["dirty"].get("mGhost") is True, "missing-map dirty flag lost"
    assert not _success_toasts(out), f"false success: {out['toasts']}"


def test_partial_failure_saves_good_map_keeps_bad_dirty() -> None:
    out = _run("partial")
    posts = _position_posts(out)
    assert _EE1 in posts and _GH_NEW not in posts
    assert out["dirty"].get("mB") is True
    assert out["dirty"].get("mA") is not True
    assert not _success_toasts(out)


def test_ok_false_treated_as_failure() -> None:
    out = _run("reject")
    assert out["dirty"].get("mA") is True
    assert not _success_toasts(out)


def test_thrown_write_keeps_map_dirty() -> None:
    out = _run("throw")
    assert out["dirty"].get("mA") is True
    assert not _success_toasts(out)


def test_concurrent_edit_during_save_keeps_dirty_and_warns() -> None:
    out = _run("concurrent")
    assert out["dirty"].get("mA") is True
    assert not _success_toasts(out)
    assert any("during save" in t for t in out["toasts"])


def test_saveA_retryB_reset_flow() -> None:
    """Finding 1(a): deferred ack A, drag B mid-save, ack, retry posts B
    only with A's exact metres, then Reset and a fresh render both show B."""
    out = _run("flow_saveA_retryB_reset")
    j = _journal(out)
    assert j["saveA-posts"]["n"] == 1
    assert j["saveA-done"]["dirty"] == {"mA": True}
    assert "edits changed during save" in " ".join(j["saveA-done"]["toasts"])
    # Baseline advanced ONLY to submitted A, not the newer draft.
    assert j["saveA-done"]["baseline"]["mA"][_EE1] == {"x": 0.1, "y": 0.1}
    assert len(j["retry"]["posts"]) == 1, j["retry"]
    src, xm, ym = j["retry"]["posts"][0]
    assert src == _EE1
    assert (xm, ym) == pytest.approx((4.918, 1.374), abs=2e-3), \
        "retry must send B's metres, not A's"
    assert j["after-reset"]["x"] == pytest.approx(0.2, abs=1e-3)
    assert j["after-reset"]["dirty"] == {}
    assert j["after-reset"]["baseline"]["x"] == pytest.approx(0.2, abs=1e-3)
    assert j["fresh-render"]["x"] == pytest.approx(0.2, abs=1e-3)
    assert j["backend"]["spatial"][_EE1]["x_m"] == pytest.approx(4.918, abs=2e-3)


def test_reset_dirty_retains_fabric_coords_and_baseline() -> None:
    """Finding 2(b): Reset on a dirty map restores fabric coords AND the
    fabric-only pin WITH its baseline; dirty cleared."""
    out = _run("flow_reset_dirty")
    j = _journal(out)
    ar = j["after-reset"]
    assert (ar["ee1"]["x"], ar["ee1"]["y"]) == pytest.approx((0.2031, 0.5012), abs=1e-3)
    assert ar["fabonly"]["source"] == "fabric-only-src"
    assert ar["baseline"]["fabric-only-src"]["x"] == pytest.approx(
        ar["fabonly"]["x"], abs=1e-12)
    assert ar["dirty"] == {}


def test_height_blocked_then_carried() -> None:
    """Finding 3: position Save attempted during a pending Height is
    refused (zero posts); after the height lands, the next position Save
    carries the new height."""
    out = _run("flow_height_blocked")
    j = _journal(out)
    assert j["height-pending"]["heightCalls"] == 1
    assert j["save-during-height"]["posts"] == 0
    assert any("try again" in t for t in j["save-during-height"]["toasts"])
    assert j["height-done"]["localZ"] == pytest.approx(1.7)
    assert j["height-done"]["backendZ"] == pytest.approx(1.7)
    assert len(j["next-save"]["posts"]) == 1
    assert j["next-save"]["posts"][0][0] == _EE1
    assert j["next-save"]["posts"][0][1] == pytest.approx(1.7)


def test_height_survives_swallowed_refresh() -> None:
    """Finding 3: acked height survives a swallowed refresh locally, and
    the next position Save carries it (not the 2.4 default)."""
    out = _run("flow_height_refresh_fail")
    j = _journal(out)
    assert j["height-acked"]["localZ"] == pytest.approx(1.7)
    assert j["after-swallowed-refresh"]["localZ"] == pytest.approx(1.7)
    src, xm, ym, zm = j["next-save"]["posts"][0]
    assert src == _EE1 and zm == pytest.approx(1.7), \
        f"position save must carry 1.7, not default: {j['next-save']}"


def test_acked_position_survives_failed_refresh() -> None:
    """Finding 1(f): acked position published locally survives a swallowed
    refresh; draft reconciles to it."""
    out = _run("flow_save_refresh_fail")
    j = _journal(out)
    assert j["save-done"]["dirty"] == {}
    assert (j["local-model"]["local"]["x_m"],
            j["local-model"]["local"]["y_m"]) == pytest.approx(
                tuple(j["local-model"]["acked"]), abs=1e-9)
    assert (j["draft"]["x"], j["draft"]["y"]) == pytest.approx((0.1, 0.1), abs=1e-3), \
        "draft must still show the submitted fractions"


def test_removal_busy_leaves_everything_unchanged() -> None:
    """Finding 4: removal attempted while busy: zero calls, zero
    mutations, busy toast."""
    out = _run("flow_removal_busy")
    j = _journal(out)
    assert j["removal-busy"]["calls"] == 0
    assert j["removal-busy"]["unchanged"] is True
    assert j["removal-busy"]["baselineUnchanged"] is True
    assert any("try again" in t for t in j["removal-busy"]["toasts"])


def test_removal_rejected_leaves_everything_unchanged() -> None:
    """Finding 4: backend ok:false: zero mutations, failure toast."""
    out = _run("flow_removal_reject")
    j = _journal(out)
    assert j["removal-reject"]["calls"] == 1
    assert j["removal-reject"]["draftSame"] is True
    assert j["removal-reject"]["dirtySame"] is True
    assert any("failed" in t.lower() for t in j["removal-reject"]["toasts"])


def test_removal_ok_targeted_cleanup_and_backend_truth() -> None:
    """Finding 4: acked removal cleans ONLY the targeted row/baseline,
    preserves an unrelated dirty edit on the SAME map, removes metadata —
    and the spatial entry PERSISTS (disclosed backend limitation)."""
    out = _run("flow_removal_ok")
    j = _journal(out)
    r = j["removal-ok"]
    assert r["goneGone"] is True
    assert (r["ee1"]["x"], r["ee1"]["y"]) == pytest.approx((0.1, 0.1)), \
        "unrelated same-map edit must survive with its coords"
    assert r["dirty"] == {"mA": True}
    assert r["metaGone"] is True, "backend metadata must be removed"
    assert r["spatialPersists"] is True, \
        "spatial entry persists server-side (known backend limitation)"
    assert _EE1 in r["ee1others"]


@pytest.mark.parametrize("scenario", ["moved", "missingfabric", "untouched"])
def test_prefix_handler_posts_nothing(v1_views: Path, scenario: str) -> None:
    out = _run(scenario, v1_views)
    assert _position_posts(out) == {}
    assert out["heightVisible"][_GH_NEW] is False


@pytest.mark.parametrize("scenario", ["stale", "untouched", "missingconflict",
                                      "negscale", "invalid", "conflict",
                                      "dedupfail", "singular", "missingmap",
                                      "reject", "concurrent"])
def test_new_guards_fail_on_prefix_handler(v1_views: Path, scenario: str) -> None:
    out = _run(scenario, v1_views)
    posts = _position_posts(out)
    cleared = not out["dirty"]
    false_success = bool(_success_toasts(out))
    assert cleared or false_success or \
        (scenario == "stale" and _EE1 in posts), \
        f"v1 unexpectedly behaves for {scenario}: {out}"
