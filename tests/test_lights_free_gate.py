"""The free lighting gate — a read-time override that never writes.

Below the `bright` tier the lights map draws rooms, floors and one default
marker per light at its room centre. Everything a key buys — placement,
shape, size and rotation, the W-series/WLED and P-series/partition
distinctions, Showcase, Fit room, Hide untouched — is withheld from the
DRAWING, and only from the drawing.

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
    # An ESPHome-style partition segment: no effect_list, and a friendly name
    # with none of the strip-hinting words (valance/strip/tape/ws2812/...) —
    # the ONLY thing that can make this "bar"-shaped is the registry platform.
    "light.segment": {"state": "on", "attributes": {"friendly_name": "Garage East Wall"}},
}
_AREA_MAP = {"light.plain": "Kitchen", "light.strip": "Kitchen", "light.loft": "Loft", "light.segment": "Kitchen"}
_PLATFORM_MAP = {"light.segment": "partition"}
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
const PLATFORM_MAP = __PLATFORM_MAP__;
const SHAPES = __SHAPES__;

// Render the whole shared card for a tier the way the hosts do, and hand back
// what the drawing contained plus whether the inputs survived untouched.
function renderFor(tier) {
  const model = JSON.parse(JSON.stringify(MODEL));   // a fresh stored model per run
  const shapes = JSON.parse(JSON.stringify(SHAPES));
  const before = JSON.stringify(model) + "|" + JSON.stringify(shapes);
  const lights = LM.gatherLights(STATES, AREA_MAP, shapes, tier, PLATFORM_MAP);
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
    isolux: false, onIsolux: () => {}, sceneName: null, onScene: () => {},
    onSceneAngle: () => {}, onSceneApply: () => {}, rippleArmed: false, onRipple: () => {},
    onRippleFire: () => {},
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
  const partition = {}; for (const l of lights) partition[l.entity_id] = !!l.isPartition;
  return {
    untouched: before === after,
    hostModelSame: host.model === model,
    codes, shapes: shapesOut, wled, partition,
    placedMarkers: (svg.match(/data-placed="1"/g) || []).length,
    stripHasTransform: /<g class="lhex" data-eid="light\.strip"[^>]*>\s*<g transform=/.test(svg)
      || (marker("light.strip") || "").includes("transform="),
    stripMarker: marker("light.strip"),
    loftDrawn: !!marker("light.loft"),
    buttons,
    hasShowcaseBtn: buttons.some(t => t.includes("Showcase")),
    hasFitBtn: buttons.some(t => t.includes("Fit room")),
    hasUntouchedBtn: buttons.some(t => t.includes("ntouched")),
    hasIsoluxBtn: buttons.some(t => t.includes("Isolux")),
    hasSceneBtn: buttons.some(t => t.includes("Scene")),
    hasRippleBtn: buttons.some(t => t.includes("Ripple")),
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
              .replace("__PLATFORM_MAP__", json.dumps(_PLATFORM_MAP))
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
    assert not free["hasIsoluxBtn"], free["buttons"]
    assert not free["hasSceneBtn"], free["buttons"]
    assert not free["hasRippleBtn"], free["buttons"]
    # Hide-untouched is a paid filter: at free the loft lamp the host's
    # hiddenEidsMap would have hidden is drawn.
    assert free["loftDrawn"], "hide-untouched filter applied at free tier"
    for tier in ("bright", "pro"):
        assert out[tier]["hasShowcaseBtn"] and out[tier]["hasFitBtn"] and out[tier]["hasUntouchedBtn"], (tier, out[tier]["buttons"])
        assert out[tier]["hasIsoluxBtn"] and out[tier]["hasSceneBtn"] and out[tier]["hasRippleBtn"], (tier, out[tier]["buttons"])
        assert not out[tier]["loftDrawn"], tier


def test_paid_recognises_a_partition_light_without_effects(out):
    """light.segment has NO effect_list and a friendly name with none of the
    strip-hinting words — registry platform "partition" is the only signal
    that can make this bar-shaped, P-coded and blue-bordered, so this proves
    the detection is structural, not effect_list- or name-derived."""
    free = out["free"]
    assert free["shapes"]["light.segment"] == "hex", "partition shape leaked into the free-tier drawing"
    assert not free["partition"]["light.segment"], "partition class leaked into the free-tier drawing"
    for tier in ("bright", "pro"):
        paid = out[tier]
        assert paid["shapes"]["light.segment"] == "bar", (tier, paid["shapes"])
        assert paid["partition"]["light.segment"], (tier, paid["partition"])
        assert paid["codes"]["light.segment"].startswith("P"), (tier, paid["codes"])
        # Mutually exclusive with WLED — a plain partition is not WLED-class.
        assert not paid["wled"]["light.segment"], (tier, paid["wled"])
        # And WLED keeps ITS OWN series: the two classes never collide.
        assert paid["wled"]["light.strip"] and not paid["partition"]["light.strip"], tier


def test_bright_and_pro_draw_the_same_lights_map(out):
    """Pro is a superset; for the LIGHTS map bright and pro are the same map."""
    assert out["paidSame"]


def test_an_unknown_tier_is_free(out):
    """The safe side: a missing, empty or garbage tier draws the free map."""
    for tier in ("", "nonsense", "null"):
        assert out[tier]["placedMarkers"] == 0, tier
        assert set(out[tier]["shapes"].values()) == {"hex"}, tier
        assert not out[tier]["hasShowcaseBtn"], tier


def test_last_dimmed_level_is_remembered_and_dimmable_is_derived(tmp_path):
    """Off→on restores the level a light was dimmed to. HA drops `brightness`
    the moment a light turns off, so gatherLights records it while the light
    is ON and lastBrightness() serves it back — and `dimmable` (which gates
    the long-press popup) derives from capability, not current state."""
    _stage(tmp_path)
    script = """
import { install } from './dom_shim.mjs';
install(globalThis);
const LM = await import('./lights_map.mjs');
const AREA = {"light.dim": "Kitchen", "light.plug": "Kitchen"};
const ON = {
  "light.dim":  {state: "on",  attributes: {friendly_name: "Dimmer", supported_color_modes: ["brightness"], brightness: 51}},
  "light.plug": {state: "on",  attributes: {friendly_name: "Plug", supported_color_modes: ["onoff"]}},
};
const OFF = {
  "light.dim":  {state: "off", attributes: {friendly_name: "Dimmer", supported_color_modes: ["brightness"]}},
  "light.plug": {state: "off", attributes: {friendly_name: "Plug", supported_color_modes: ["onoff"]}},
};
const out = {};
const onLights = LM.gatherLights(ON, AREA, {}, "pro");
out.dimmableOn = onLights.find(l => l.entity_id === "light.dim").dimmable;
out.plugDimmable = onLights.find(l => l.entity_id === "light.plug").dimmable;
LM.gatherLights(OFF, AREA, {}, "pro");   // the off pass must NOT erase the memory
out.remembered = LM.lastBrightness("light.dim");
out.plugRemembered = LM.lastBrightness("light.plug");
// Capability survives the light being off — modes still say it dims.
out.dimmableOff = LM.gatherLights(OFF, AREA, {}, "pro").find(l => l.entity_id === "light.dim").dimmable;
console.log(JSON.stringify(out));
"""
    (tmp_path / "run2.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run2.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    out = json.loads(res.stdout.strip().splitlines()[-1])
    assert out["dimmableOn"] is True
    assert out["dimmableOff"] is True, "capability must not vanish while the light is off"
    assert out["plugDimmable"] is False, "an onoff-only light must not offer the popup"
    assert out["remembered"] == 51, out
    assert out["plugRemembered"] is None, "a light that never reported brightness has nothing to restore"


def _run_pipeline_script(tmp_path: Path, script_body: str) -> dict:
    _stage(tmp_path)
    script = ("import { install } from './dom_shim.mjs';\ninstall(globalThis);\n"
              "const LM = await import('./lights_map.mjs');\n" + script_body)
    (tmp_path / "run3.mjs").write_text(script, encoding="utf-8")
    res = subprocess.run([_NODE, str(tmp_path / "run3.mjs")], capture_output=True,
                         text=True, encoding="utf-8", timeout=120)
    assert res.returncode == 0, f"node failed:\n{res.stderr[-4000:]}"
    return json.loads(res.stdout.strip().splitlines()[-1])


def test_type_override_forces_a_class_at_pro_and_is_ignored_below(tmp_path):
    """Garry: "override the HA light type to any type of device the lights pro
    system handles... Option only for the pro version". At pro the stored
    override decides the class outright — a plain bulb becomes W-series, a
    real WLED strip can be demoted to plain, a partition can be declared. At
    bright (a paying Bright Pro customer) the same stored map is IGNORED and
    detection rules, which is what makes it a Pro differentiator."""
    out = _run_pipeline_script(tmp_path, """
const AREA = {"light.bulb": "Kitchen", "light.strip": "Kitchen", "light.seg": "Kitchen"};
const STATES = {
  "light.bulb":  {state: "on", attributes: {friendly_name: "Plain Bulb", supported_color_modes: ["brightness"], brightness: 100}},
  "light.strip": {state: "on", attributes: {friendly_name: "Real WLED", effect_list: ["Solid", "Rainbow"], rgb_color: [255,0,0]}},
  "light.seg":   {state: "on", attributes: {friendly_name: "Zone Strip", supported_color_modes: ["rgb"]}},
};
const OVR = {"light.bulb": "wled", "light.strip": "plain", "light.seg": "partition"};
const codesFor = (tier) => Object.fromEntries(LM.gatherLights(STATES, AREA, {}, tier, {}, OVR).map(l => [l.entity_id, {code: l.code, w: !!l.isWled, p: !!l.isPartition, shape: l.shape}]));
console.log(JSON.stringify({pro: codesFor("pro"), bright: codesFor("bright"), none: codesFor("pro")}));
""")
    pro, bright = out["pro"], out["bright"]
    assert pro["light.bulb"]["code"].startswith("W") and pro["light.bulb"]["w"], pro
    assert pro["light.bulb"]["shape"] == "bar", "a forced WLED-class light takes the strip glyph"
    assert not pro["light.strip"]["w"] and not pro["light.strip"]["code"].startswith("W"), pro
    assert pro["light.seg"]["p"] and pro["light.seg"]["code"].startswith("P"), pro
    # Bright: the override is invisible. Detection alone.
    assert bright["light.strip"]["w"] and bright["light.strip"]["code"].startswith("W"), bright
    assert not bright["light.bulb"]["w"] and not bright["light.bulb"]["code"].startswith("W"), bright
    assert not bright["light.seg"]["p"], bright


def test_fans_and_motion_sensors_ride_the_pipeline(tmp_path):
    """Fans (F-series, fan glyph, their card's inputs) and motion sensors
    (M-series, motion glyph, admitted by device_class only) share the lights
    pipeline. A door sensor is a binary_sensor too and must NOT appear.

    Found live on the house's own map (2026-09-03, Garry): the bathroom
    outlets' built-in PIRs report device_class "occupancy", not "motion" —
    HA's other momentary-vs-sustained presence class — and were invisible
    until admitted alongside it. binary_sensor.invisoutlet_occupancy is the
    real entity_id/shape from the house."""
    out = _run_pipeline_script(tmp_path, """
const AREA = {"fan.ceiling": "Kitchen", "binary_sensor.hall_pir": "Hall", "binary_sensor.front_door": "Hall",
              "binary_sensor.invisoutlet_occupancy": "MasterBath", "light.lamp": "Kitchen"};
const STATES = {
  "fan.ceiling": {state: "on", attributes: {friendly_name: "Ceiling Fan", percentage: 66, preset_modes: ["breeze","sleep"], preset_mode: "breeze", oscillating: false, direction: "forward", effect_list: ["x"]}},
  "binary_sensor.hall_pir": {state: "on", attributes: {friendly_name: "Hall PIR", device_class: "motion"}},
  "binary_sensor.front_door": {state: "on", attributes: {friendly_name: "Front Door", device_class: "door"}},
  "binary_sensor.invisoutlet_occupancy": {state: "off", attributes: {friendly_name: "MasterBath Occupancy", device_class: "occupancy"}},
  "light.lamp": {state: "off", attributes: {friendly_name: "Lamp", supported_color_modes: ["onoff"]}},
};
const lights = LM.gatherLights(STATES, AREA, {}, "pro", {}, {});
const by = Object.fromEntries(lights.map(l => [l.entity_id, l]));
console.log(JSON.stringify({
  ids: lights.map(l => l.entity_id).sort(),
  fan: by["fan.ceiling"] && {code: by["fan.ceiling"].code, isFan: by["fan.ceiling"].isFan, w: by["fan.ceiling"].isWled, shape: by["fan.ceiling"].shape, pct: by["fan.ceiling"].pct, presets: by["fan.ceiling"].preset_modes, dir: by["fan.ceiling"].direction, osc: by["fan.ceiling"].oscillating},
  pir: by["binary_sensor.hall_pir"] && {code: by["binary_sensor.hall_pir"].code, isMotion: by["binary_sensor.hall_pir"].isMotion, shape: by["binary_sensor.hall_pir"].shape, dimmable: by["binary_sensor.hall_pir"].dimmable},
  occ: by["binary_sensor.invisoutlet_occupancy"] && {code: by["binary_sensor.invisoutlet_occupancy"].code, isMotion: by["binary_sensor.invisoutlet_occupancy"].isMotion, shape: by["binary_sensor.invisoutlet_occupancy"].shape},
  lamp: by["light.lamp"] && {code: by["light.lamp"].code},
}));
""")
    assert out["ids"] == ["binary_sensor.hall_pir", "binary_sensor.invisoutlet_occupancy", "fan.ceiling", "light.lamp"], out["ids"]
    fan = out["fan"]
    assert fan["code"] == "F01" and fan["isFan"] and fan["shape"] == "fan", fan
    # A fan advertising an effect_list is STILL a fan, never WLED-class.
    assert not fan["w"], fan
    assert fan["pct"] == 66 and fan["presets"] == ["breeze", "sleep"] and fan["dir"] == "forward" and fan["osc"] is False, fan
    pir = out["pir"]
    assert pir["code"] == "M01" and pir["isMotion"] and pir["shape"] == "motion" and pir["dimmable"] is False, pir
    # The occupancy-class sensor reads identically to a motion-class one —
    # same M series, same glyph — the map does not care which HA calls it.
    occ = out["occ"]
    assert occ["code"] == "M02" and occ["isMotion"] and occ["shape"] == "motion", occ
    # The plain lamp keeps the generic series — F and M are reserved.
    assert out["lamp"]["code"] == "A01", out["lamp"]


def test_both_hosts_pass_the_tier():
    """The gate is only as good as its callers: both hosts hand settings.tier
    to gatherLights and to the card, and neither re-derives the ladder."""
    panel = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "this.state._tier" in panel and "tier: this.state._tier" in panel
    assert "gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, this.state._tier, reg.platformMap, this.state._typeOverrides)" in panel
    assert "gatherLights(ctx.hass?.states || {}, reg.areaMap, shapeOverrides, tier, reg.platformMap, typeOverrides)" in maps
    assert "\n    tier,\n" in maps
    for src, name in ((panel, "lights_panel.js"), (maps, "maps.js")):
        assert "LIGHTING_TIER" not in src, f"{name} re-derives the lighting gate; lights_map.js owns it"
