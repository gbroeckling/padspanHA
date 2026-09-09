# PadSpan HA — BLE Room-Presence Tracking for Home Assistant
# Copyright (C) 2026 Garry Broeckling
# Licensed under the GNU General Public License v3.0
"""The Overview's continuous coverage raster (radio_map.js).

The storey heat used to be a 36×36 mosaic of hatch-filled quads in 16 colour
steps — "very poor resolution" (Garry, 2026-09-09). It is now a bilinearly
upsampled raster placed as ONE <image> whose matrix() maps it onto the slab.
These pin the pure pieces under node; the PNG encode itself needs a real
canvas and is proven by falling back cleanly where there is none.

Runs the real module under node; skipped, not failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_VIEWS = (Path(__file__).resolve().parents[1] / "custom_components" / "padspan_ha"
          / "www" / "padspan-ha" / "views")
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")


def _run(script: str) -> dict:
    src = (
        "import { pathToFileURL } from 'node:url';\n"
        f"const M = await import(pathToFileURL({json.dumps(str(_VIEWS / 'radio_map.js'))}).href);\n"
        "const out = {};\n" + script + "\nconsole.log(JSON.stringify(out));\n"
    )
    res = subprocess.run([_NODE, "--input-type=module", "-e", src], capture_output=True,
                         text=True, encoding="utf-8", timeout=60, cwd=str(_VIEWS))
    assert res.returncode == 0, f"node failed:\n{res.stderr}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_ramp_lightness_rises_monotonically_from_worst_to_best():
    """A magnitude ramp must read by luminance alone (colour-vision deficiency,
    print, a dim panel): OKLab L never decreases from t=0 to t=1."""
    out = _run("""
const Lat = t => { const [r, g, b] = M.heatRamp(t); return M.srgbToOklab(r, g, b)[0]; };
// Consecutive 8-bit LUT entries jitter by ~1e-3 in L from rounding; a real
// dip is an order of magnitude larger, so that is the tolerance.
let prev = -1, ok = true, worstDip = 0;
for (let i = 0; i <= 200; i++) {
  const L = Lat(i / 200);
  if (L < prev - 0.003) ok = false;
  if (L - prev < worstDip) worstDip = L - prev;
  prev = L;
}
out.ok = ok; out.worstDip = worstDip; out.first = Lat(0); out.last = Lat(1);
// The design stops themselves must be strictly ordered.
out.stops = [0, 0.25, 0.5, 0.72, 1].map(Lat);
out.worst = M.heatRamp(0); out.best = M.heatRamp(1);
""")
    assert out["ok"], f"ramp lightness dips by {out['worstDip']:.4f} somewhere between worst and best"
    assert all(b > a for a, b in zip(out["stops"], out["stops"][1:])), out["stops"]
    assert out["last"] - out["first"] > 0.4, out
    # Semantics unchanged: worst is red, best is green.
    r, g, _ = out["worst"]; assert r > g * 3, out["worst"]
    r, g, _ = out["best"];  assert g > r * 2, out["best"]


def test_raster_is_res_times_up_and_bilinear_between_samples():
    out = _run("""
const grid = new Float32Array([-90, -60, -90, -60]);   // 2x2, left worst, right best
const ras = M.heatRaster(grid, 2, 4, -90, 30);
out.w = ras.w; out.h = ras.h; out.len = ras.px.length;
const px = (x, y) => Array.from(ras.px.slice((y * ras.w + x) * 4, (y * ras.w + x) * 4 + 4));
out.left = px(0, 0); out.right = px(7, 0); out.mid = px(3, 0);
""")
    assert (out["w"], out["h"], out["len"]) == (8, 8, 8 * 8 * 4)
    assert out["left"][:3] != out["right"][:3], "no gradient across the raster"
    assert out["left"][3] == out["right"][3] == 158, "alpha must be the slab-friendly constant"
    # The middle pixel is neither endpoint: interpolated, not nearest-sampled.
    assert out["mid"][:3] not in (out["left"][:3], out["right"][:3]), out


def test_nan_samples_are_transparent_and_floor_is_deepest_red():
    out = _run("""
const ras = M.heatRaster(new Float32Array([NaN, NaN, NaN, NaN]), 2, 1, -90, 30);
out.alpha = Array.from(ras.px).filter((_, i) => i % 4 === 3);
const lo = M.heatRaster(new Float32Array([-200, -200, -200, -200]), 2, 1, -90, 30);
out.floor = Array.from(lo.px.slice(0, 3)); out.ramp0 = M.heatRamp(0);
""")
    assert out["alpha"] == [0, 0, 0, 0]
    assert out["floor"] == out["ramp0"], "below the scale must clamp to the worst colour, as the mosaic did"


def test_image_matrix_maps_raster_corners_onto_the_projected_extent():
    """The projection is affine in x,y for a fixed storey, so matrix() must
    land pixel (0,0), (w,0) and (0,h) exactly on iso() of the three corners."""
    out = _run("""
const iso = (x, y, z) => [100 + (x - y) * 0.866 * 12 + z * 3, 50 + (x + y) * 0.5 * 12 - z * 40];
const bb = { minX: -3, minY: 2, maxX: 9, maxY: 8 };
const [a, b, c, d, e, f] = M.isoImageMatrix(iso, bb, 1, 48, 24);
const ap = (px, py) => [a * px + c * py + e, b * px + d * py + f];
out.p0 = [ap(0, 0), iso(bb.minX, bb.minY, 1)];
out.p1 = [ap(48, 0), iso(bb.maxX, bb.minY, 1)];
out.p3 = [ap(0, 24), iso(bb.minX, bb.maxY, 1)];
out.p2 = [ap(48, 24), iso(bb.maxX, bb.maxY, 1)];
""")
    for key in ("p0", "p1", "p2", "p3"):
        got, want = out[key]
        assert abs(got[0] - want[0]) < 1e-9 and abs(got[1] - want[1]) < 1e-9, (key, got, want)


def test_png_encode_is_null_without_a_real_canvas():
    """Node has no canvas: the caller must get null and draw the hatch mosaic,
    never an <image> with an empty href."""
    out = _run("""
const ras = M.heatRaster(new Float32Array([-70]), 1, 2, -90, 30);
out.png = M.rasterPNG(ras.px, ras.w, ras.h);
""")
    assert out["png"] is None


def test_storey_heat_falls_back_to_the_hatch_mosaic_under_node():
    out = _run("""
const storey = { z: 0,
  rooms: [{ room: 'A', pts: [[0, 0], [10, 0], [10, 8], [0, 8]] }],
  scanners: [{ source: 's1', x_m: 2, y_m: 2, dz: 1.2, floorDist: 0 }],
  barriers: [], calPoints: [] };
const iso = (x, y, z) => [x * 10, y * 10];
const svg = M.isoStoreyHeatmapSVG(storey, iso, null, { ref_power: -59, path_loss_exp: 2.5 }, null);
out.hasHatch = svg.includes('fill="url(#rmiso'); out.hasImage = svg.includes('<image');
""")
    assert out["hasHatch"] and not out["hasImage"], out
