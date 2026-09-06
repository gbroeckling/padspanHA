"""iso_motion.js — the keyed morph and breadcrumb trails that give the
string-built iso maps actual movement instead of teleporting dots every poll
(gap #1 of the best-in-class roadmap, docs/BEST_IN_CLASS_ROADMAP.md).

Split in two on purpose (see iso_motion.js's own header):
  planObjectLayerMerge is PURE — plain {key, x, y, departing} descriptors in,
  a {kept, added, removed, swapped} plan out. No DOM, so it is tested
  directly here, the same way the rest of this codebase's pure logic is.
  mergeObjectLayer is the DOM-touching wrapper. It relies on innerHTML
  actually parsing markup into real nodes, which tests/js/dom_shim.mjs
  deliberately does not do (see that file's own header) — matching every
  other innerHTML-rebuild view in this codebase (overview.js's old object
  swap, traceback.js's frame renderer), it is verified live, not unit
  tested, except for the defensive null/undefined-input paths below which
  take the same short-circuit in the shim as in a real browser.

trailPush/trailSvg are pure data + string functions, tested directly.

Skipped (not failed) when node is unavailable.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_VIEWS = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha" / "views"
_SHIM = Path(__file__).parent / "js" / "dom_shim.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(tmp_path: Path, script_body: str) -> dict:
    shutil.copy(_VIEWS / "iso_motion.js", tmp_path / "iso_motion.mjs")
    shutil.copy(_SHIM, tmp_path / "dom_shim.mjs")
    script = (
        "import { install } from './dom_shim.mjs';\n"
        "install(globalThis);\n"
        "const IM = await import('./iso_motion.mjs');\n"
        + script_body
    )
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=60)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


# ── planObjectLayerMerge (pure) ──────────────────────────────────────────────

def test_matched_key_glides_instead_of_teleporting(tmp_path):
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge("
        "[{key:'a', x:10, y:10}], [{key:'a', x:50, y:10}]);\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert out["added"] == [] and out["removed"] == [] and out["swapped"] == 0, out
    assert out["kept"] == [{"key": "a", "index": 0, "from": [10, 10], "to": [50, 10], "glide": True}], out


def test_a_jump_larger_than_max_glide_snaps_instead(tmp_path):
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge("
        "[{key:'a', x:0, y:0}], [{key:'a', x:9999, y:0}], {maxGlidePx: 400});\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert len(out["kept"]) == 1 and out["kept"][0]["glide"] is False, \
        f"a re-layout (floor change, tether flip) must snap, not animate clear across the map: {out}"


def test_an_unmatched_fresh_key_is_added_and_a_missing_live_key_is_removed(tmp_path):
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge("
        "[{key:'a', x:0, y:0}], [{key:'b', x:5, y:5}]);\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert out["kept"] == [] and out["swapped"] == 0, out
    assert out["added"] == [{"key": "b", "index": 0}], out
    assert out["removed"] == ["a"], out


def test_a_departing_live_key_is_not_matched_as_a_live_predecessor(tmp_path):
    """The departing flag (set on a node mid-fade-out by mergeObjectLayer) is
    what stops a resurrected key from being glided from a half-faded corpse:
    planObjectLayerMerge must treat it as absent, so the same key reappearing
    is a fresh add, not a glide."""
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge("
        "[{key:'a', x:0, y:0, departing:true}], [{key:'a', x:5, y:5}]);\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert out["kept"] == [], out
    assert out["added"] == [{"key": "a", "index": 0}], out
    assert out["removed"] == [], "a departing node was never counted live, so it can't also be 'removed'"


def test_unkeyed_entries_are_counted_as_plain_swaps(tmp_path):
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge("
        "[{key:null, x:0, y:0}], [{key:null, x:9, y:9}]);\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert out == {"kept": [], "added": [], "removed": [], "swapped": 1}, \
        "markup with no key is never animated, only swapped"


def test_multiple_keys_preserve_fresh_order_via_index_after_a_reshuffle(tmp_path):
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge("
        "[{key:'a', x:0, y:0}, {key:'b', x:10, y:0}],"
        "[{key:'b', x:10, y:1}, {key:'c', x:20, y:0}, {key:'a', x:0, y:1}]);\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert out["removed"] == [], "both a and b are still present in the fresh set"
    assert out["added"] == [{"key": "c", "index": 1}], out
    # index reflects each key's position in the FRESH array, which is what
    # the DOM wrapper walks in order to rebuild z-order — b first, a last.
    kept_by_key = {k["key"]: k for k in out["kept"]}
    assert kept_by_key["b"]["index"] == 0 and kept_by_key["b"]["glide"] is True
    assert kept_by_key["a"]["index"] == 2 and kept_by_key["a"]["glide"] is True


def test_an_empty_fresh_set_marks_every_live_key_removed(tmp_path):
    out = _run(tmp_path, (
        "const plan = IM.planObjectLayerMerge([{key:'a', x:0, y:0}], []);\n"
        "console.log(JSON.stringify(plan));\n"
    ))
    assert out == {"kept": [], "added": [], "removed": ["a"], "swapped": 0}


def test_null_or_undefined_live_and_fresh_do_not_throw(tmp_path):
    out = _run(tmp_path, (
        "const p1 = IM.planObjectLayerMerge(null, null);\n"
        "const p2 = IM.planObjectLayerMerge(undefined, undefined);\n"
        "console.log(JSON.stringify({p1, p2}));\n"
    ))
    empty = {"kept": [], "added": [], "removed": [], "swapped": 0}
    assert out["p1"] == empty and out["p2"] == empty, out


# ── mergeObjectLayer — defensive plumbing only ───────────────────────────────
# Real node moves (glide/fade/z-order) are DOM surgery on innerHTML-parsed
# markup; the shim never parses innerHTML (see its own header), so that path
# is verified live, matching every other poll-swap view in this codebase.
# Only the short-circuit paths below take the identical branch in the shim
# as in a real browser (a null group, or html that parses to zero children).

def test_a_null_group_or_missing_html_does_not_throw(tmp_path):
    out = _run(tmp_path, (
        "const r1 = IM.mergeObjectLayer(null, '<g data-obj-key=\"a\"/>');\n"
        "const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');\n"
        "const r2 = IM.mergeObjectLayer(group, undefined);\n"
        "console.log(JSON.stringify({r1, r2}));\n"
    ))
    assert out["r1"] == {"moved": 0, "added": 0, "removed": 0, "swapped": 0}
    assert out["r2"] == {"moved": 0, "added": 0, "removed": 0, "swapped": 0}


# ── trailPush / trailSvg ─────────────────────────────────────────────────────

def test_trail_push_dedupes_jitter_but_keeps_real_movement(tmp_path):
    out = _run(tmp_path, (
        "const trails = new Map();\n"
        "IM.trailPush(trails, 'k', 0, 0, 1000);\n"
        "IM.trailPush(trails, 'k', 1, 0, 1100, {minStepPx: 6});\n"  # sub-jitter, same point
        "IM.trailPush(trails, 'k', 50, 0, 1200, {minStepPx: 6});\n"  # real move
        "console.log(JSON.stringify(trails.get('k')));\n"
    ))
    assert len(out) == 2, f"a sub-threshold wobble must not become a second trail point: {out}"
    assert out[0]["x"] == 0 and out[0]["t"] == 1100, \
        "the jittered point's timestamp refreshes (the object is still here), its position does not"
    assert out[1] == {"x": 50, "y": 0, "t": 1200}


def test_trail_push_caps_length_and_prunes_by_age(tmp_path):
    out = _run(tmp_path, (
        "const trails = new Map();\n"
        "for (let i = 0; i < 20; i++) IM.trailPush(trails, 'k', i * 100, 0, i * 1000, {maxPoints: 5, maxAgeMs: 999999999});\n"
        "const capped = trails.get('k').length;\n"
        "const trails2 = new Map();\n"
        "IM.trailPush(trails2, 'k', 0, 0, 0, {maxAgeMs: 1000});\n"
        "IM.trailPush(trails2, 'k', 100, 0, 5000, {maxAgeMs: 1000});\n"  # far enough later the first ages out
        "console.log(JSON.stringify({capped, agedLen: trails2.get('k').length}));\n"
    ))
    assert out["capped"] == 5, out
    assert out["agedLen"] == 1, "a point older than maxAgeMs must be pruned on the next push"


def test_trail_svg_needs_at_least_two_points_and_fades_with_age(tmp_path):
    out = _run(tmp_path, (
        "const trails = new Map();\n"
        "IM.trailPush(trails, 'k', 0, 0, 0);\n"
        "const single = IM.trailSvg(trails, () => '#fbbf24', 100);\n"
        "IM.trailPush(trails, 'k', 10, 0, 100);\n"
        "const pair = IM.trailSvg(trails, () => '#fbbf24', 100);\n"
        "console.log(JSON.stringify({single, hasPair: pair.includes('<line'), hasColor: pair.includes('#fbbf24')}));\n"
    ))
    assert out["single"] == "", "one point is a position, not yet a trail — nothing to draw"
    assert out["hasPair"] and out["hasColor"], out


def test_trail_svg_prunes_aged_points_before_drawing(tmp_path):
    out = _run(tmp_path, (
        "const trails = new Map();\n"
        "IM.trailPush(trails, 'k', 0, 0, 0, {maxAgeMs: 1000});\n"
        "IM.trailPush(trails, 'k', 10, 0, 100, {maxAgeMs: 1000});\n"
        "const svg = IM.trailSvg(trails, () => '#fbbf24', 5000, {maxAgeMs: 1000});\n"  # both points now ancient
        "console.log(JSON.stringify({svg, remaining: trails.get('k').length}));\n"
    ))
    assert out["svg"] == "", "a trail whose points have all aged out draws nothing"
    assert out["remaining"] == 0, out
