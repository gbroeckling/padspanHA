"""The free lighting gate — a read-time override that never writes.

Below the `bright` tier the lights map draws rooms, floors and one default
marker per light at its room centre. Everything a key buys — placement,
shape, size and rotation, the W-series/WLED distinction, Showcase, Fit room,
Hide untouched — is withheld from the DRAWING, and only from the drawing.

The way this goes wrong is a filter on stored data instead of on render
inputs: a lapsed licence would then delete a weekend of placements. So the
core assertion here is byte-identity — the model handed to the renderer at
free tier comes out exactly as it went in — and the second is that the same
model at `bright`/`pro` still renders everything. The plan calls this the
third of five guards; it is the one Garry (who runs Pro) can never notice is
broken by looking.

Runs the real modules under node with the suite's DOM shim; skipped, not
failed, without node.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_WWW = _ROOT / "custom_components" / "padspan_ha" / "www" / "padspan-ha"
_VIEWS = _WWW / "views"
_SHIM = Path(__file__).parent / "js" / "dom_shim.mjs"
_NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(_NODE is None, reason="node is not installed")

_QUERY = "${new URL(import.meta.url).search}"


def _stage(tmp_path: Path) -> None:
    """Copy the shared lights pipeline and its imports to .mjs, specifiers rewritten."""
    for name in ("lights_map", "iso_lights", "light_codes", "room_color", "editions"):
        src = (_VIEWS / f"{name}.js").read_text(encoding="utf-8")
        for dep in ("iso_lights", "light_codes", "editions"):
            src = src.replace(f"./{dep}.js{_QUERY}", f"./{dep}.mjs")
        src = src.replace('"./room_color.js"', '"./room_color.mjs"')
        (tmp_path / f"{name}.mjs").write_text(src, encoding="utf-8")
    shutil.copy(_SHIM, tmp_path / "dom_shim.mjs")


# A house that has been WORKED ON: two placed lights, one sized and rotated,
# one with a shape override, one WLED-class. Everything the free tier withholds
# is present in the inputs, so its absence in the output is the gate.
_MODEL = {
    "room_geometry_m": {
        "Kitchen": {"type": "poly", "floor_id": "main", "points_m": [[0, 0], [6, 0], [6, 4], [0, 4]]},
        "Loft":    {"type": "poly", "floor_id": "up",   "points_m": [[0, 0], [5, 0], [5, 5], [0, 5]]},
    },
    "light_positions_m": {
        "light.plain": {"x_m": 0.5, "y_m": 0.5, "floor_id": "main", "color": "#ff0000"},
        "light.strip": {"x_m": 4.0, "y_m": 1.0, "floor_id": "main",
                        "width_cm": 240, "height_cm": 5, "rotation": 30},
    },
    "areas": [{"id": "kitchen", "name": "Kitchen"}, {"id": "loft", "name": "Loft"}],
    "floors": [{"id": "main", "name": "Main", "level": 0}, {"id": "up", "name": "Upper", "level": 1}],
}
_STATES = {
    "light.plain": {"state": "on", "attributes": {"friendly_name": "Kitchen Pots"}},
    "light.strip": {"state": "on", "attributes": {"friendly_name": "Kitchen Valance",
                                                  "effect_list": ["Solid", "Rainbow"],
                                                  "rgb_color": [255, 0, 0], "brightness": 200}},
    "light.loft":  {"state": "off", "attributes": {"friendly_name": "Loft Lamp"}},
}
_AREA_MAP = {"light.plain": "Kitchen", "light.strip": "Kitchen", "light.loft": "Loft"}
_SHAPES = {"light.plain": "chandelier"}

_HARNESS = r"""
import { install } from './dom_shim.mjs';
install(globalThis);
const LM = await import('./lights_map.mjs');

function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }
  if (!Array.isArray(children)) children = [children];
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === "string" || typeof c === "number") n.appendChild(document.createTextNode(String(c)));
    else n.appendChild(c);
  }
  return n;
}

const MODEL = __MODEL__;
const STATES = __STATES__;
const AREA_MAP = __AREA_MAP__;
const SHAPES = __SHAPES__;

// Render the whole shared card for a tier the way the hosts do, and hand back
// what the drawing contained plus whether the inputs survived untouched.
function renderFor(tier) {
  const model = JSON.parse(JSON.stringify(MODEL));   // a fresh stored model per run
  const shapes = JSON.parse(JSON.stringify(SHAPES));
  const before = JSON.stringify(model) + "|" + JSON.stringify(shapes);
  const lights = LM.gatherLights(STATES, AREA_MAP, shapes, tier);
  const lightsByEid = {}; for (const l of lights) lightsByEid[l.entity_id] = l;
  const byRoom = {};
  for (const l of lights) if (l.area_name) (byRoom[l.area_name] = byRoom[l.area_name] || []).push(l);
  let svg = "";
  const calls = { showcase: 0, fit: 0, hide: 0 };
  const host = {
    el, floors: model.floors, model, tier, byRoom, lightsByEid, lightsLoading: false,
    hiddenEids: new Set(), hiddenEidsMap: new Set(["light.loft"]),   // "hide untouched" would hide the loft lamp
    view: { floorGap: 150, horizGap: 0, focusIdx: 0, zoom: 1 },
    showcase: true, fitRooms: true, hideUntouched: true, untouchedCount: 1,
    onShowcase: () => calls.showcase++, onFitRooms: () => calls.fit++, onHideUntouched: () => calls.hide++,
    saveView: async () => {}, callWS: async () => ({}), toast: () => {},
    onHexesBuilt: (isoDiv) => { svg = isoDiv.innerHTML; },
    onRowClick: () => {}, onToggleHidden: () => {}, afterAssign: () => {},
  };
  const card = LM.buildLightsMapCard(host);
  const buttons = card.querySelectorAll("button").map(b => b.textContent);
  const after = JSON.stringify(model) + "|" + JSON.stringify(shapes);
  const marker = (eid) => {
    const m = svg.match(new RegExp('<g class="lhex" data-eid="' + eid.replace('.', '\\.') + '"[^>]*>'));
    return m ? m[0] : null;
  };
  const codes = {}; for (const l of lights) codes[l.entity_id] = l.code;
  const shapesOut = {}; for (const l of lights) shapesOut[l.entity_id] = l.shape;
  const wled = {}; for (const l of lights) wled[l.entity_id] = !!l.isWled;
  return {
    untouched: before === after,
    hostModelSame: host.model === model,
    codes, shapes: shapesOut, wled,
    placedMarkers: (svg.match(/data-placed="1"/g) || []).length,
    stripHasTransform: /<g class="lhex" data-eid="light\.strip"[^>]*>\s*<g transform=/.test(svg)
      || (marker("light.strip") || "").includes("transform="),
    stripMarker: marker("light.strip"),
    loftDrawn: !!marker("light.loft"),
    buttons,
    hasShowcaseBtn: buttons.some(t => t.includes("Showcase")),
    hasFitBtn: buttons.some(t => t.includes("Fit room")),
    hasUntouchedBtn: buttons.some(t => t.includes("ntouched")),
    svgLen: svg.length,
    svg,
  };
}

const out = {};
for (const tier of ["free", "bright", "pro", "", "nonsense", null]) out[String(tier)] = renderFor(tier);
out.paidSame = out.bright.svg === out.pro.svg;
for (const k of Object.keys(out)) if (out[k] && out[k].svg) delete out[k].svg;
console.log(JSON.stringify(out));
"""


def _run(tmp_path: Path) -> dict:
    _stage(tmp_path)
    script = (_HARNESS.replace("__MODEL__", json.dumps(_MODEL))
              .replace("__STATES__", json.dumps(_STATES))
              .replace("__AREA_MAP__", json.dumps(_AREA_MAP))
              .replace("__SHAPES__", json.dumps(_SHAPES)))
    (tmp_path / "run.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def out(tmp_path_factory) -> dict:
    return _run(tmp_path_factory.mktemp("gate"))


def test_the_renderer_never_writes(out):
    """Guard 3 of the plan: stored positions and shape overrides come out of a
    free-tier render byte-identical, and the host's own model object is the
    one it passed (the gate copies for itself; it does not swap the caller's)."""
    for tier in ("free", "bright", "pro", "", "nonsense", "null"):
        assert out[tier]["untouched"], f"tier {tier!r} mutated the stored inputs"
        assert out[tier]["hostModelSame"], f"tier {tier!r} replaced the host's model object"


def test_free_withholds_placement(out):
    free = out["free"]
    assert free["placedMarkers"] == 0, "a stored placement was drawn at free tier"
    assert not free["stripHasTransform"], "size/rotation drawn at free tier"
    assert free["stripMarker"], "the strip light was not drawn at all — free is a VIEW, not a hide"


def test_free_withholds_shapes_codes_and_wled(out):
    free = out["free"]
    assert set(free["shapes"].values()) == {"hex"}, free["shapes"]
    assert not any(v for v in free["wled"].values()), free["wled"]
    assert not any(c.startswith("W") for c in free["codes"].values()), free["codes"]
    # And the same house at bright/pro keeps every one of them.
    for tier in ("bright", "pro"):
        paid = out[tier]
        assert paid["shapes"]["light.plain"] == "chandelier", (tier, paid["shapes"])
        assert paid["shapes"]["light.strip"] == "bar", (tier, paid["shapes"])
        assert paid["wled"]["light.strip"], (tier, paid["wled"])
        assert paid["codes"]["light.strip"].startswith("W"), (tier, paid["codes"])
        assert paid["placedMarkers"] == 2, (tier, paid["placedMarkers"])
        assert paid["stripHasTransform"], tier


def test_free_withholds_the_presentation_modes(out):
    free = out["free"]
    assert not free["hasShowcaseBtn"], free["buttons"]
    assert not free["hasFitBtn"], free["buttons"]
    assert not free["hasUntouchedBtn"], free["buttons"]
    # Hide-untouched is a paid filter: at free the loft lamp the host's
    # hiddenEidsMap would have hidden is drawn.
    assert free["loftDrawn"], "hide-untouched filter applied at free tier"
    for tier in ("bright", "pro"):
        assert out[tier]["hasShowcaseBtn"] and out[tier]["hasFitBtn"] and out[tier]["hasUntouchedBtn"], (tier, out[tier]["buttons"])
        assert not out[tier]["loftDrawn"], tier


def test_bright_and_pro_draw_the_same_lights_map(out):
    """Pro is a superset; for the LIGHTS map bright and pro are the same map."""
    assert out["paidSame"]


def test_an_unknown_tier_is_free(out):
    """The safe side: a missing, empty or garbage tier draws the free map."""
    for tier in ("", "nonsense", "null"):
        assert out[tier]["placedMarkers"] == 0, tier
        assert set(out[tier]["shapes"].values()) == {"hex"}, tier
        assert not out[tier]["hasShowcaseBtn"], tier


def test_both_hosts_pass_the_tier():
    """The gate is only as good as its callers: both hosts hand settings.tier
    to gatherLights and to the card, and neither re-derives the ladder."""
    panel = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "this.state._tier" in panel and "tier: this.state._tier" in panel
    assert "gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, this.state._tier)" in panel
    assert "gatherLights(ctx.hass?.states || {}, reg.areaMap, shapeOverrides, tier)" in maps
    assert "\n    tier,\n" in maps
    for src, name in ((panel, "lights_panel.js"), (maps, "maps.js")):
        assert "LIGHTING_TIER" not in src, f"{name} re-derives the lighting gate; lights_map.js owns it"
