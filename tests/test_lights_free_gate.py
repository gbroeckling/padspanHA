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


def test_ensure_lights_registry_resolves_a_temperature_sensors_room(tmp_path):
    """Garry, live on the house (2026-09-03): "Don't see any way to move the
    temp in mapping, lights." Root cause: ensureLightsRegistry's own entity
    scan only ever admitted light./fan./binary_sensor. into areaMap — a
    sensor.* temperature entity's "Assign room…" pick genuinely saved (HA's
    own registry had it) but areaMap[eid] stayed undefined forever, so
    gatherLights' l.area_name was always null and the light could never
    cluster onto the map or be placed. A plain (non-temperature) sensor.*
    must still be excluded — the fix is scoped to gatherLights' own
    admission rule, not "every sensor.*"."""
    out = _run_pipeline_script(tmp_path, """
const AREAS = [{id: "bedroom", name: "Bedroom"}];
const REG = [
  {entity_id: "light.lamp", area_id: "bedroom", device_id: null, platform: "hue"},
  {entity_id: "sensor.temp1", area_id: "bedroom", device_id: null, platform: "zha"},
  {entity_id: "sensor.humidity1", area_id: "bedroom", device_id: null, platform: "zha"},
];
const STATES = {
  "light.lamp": {state: "on", attributes: {friendly_name: "Lamp"}},
  "sensor.temp1": {state: "68", attributes: {device_class: "temperature"}},
  "sensor.humidity1": {state: "44", attributes: {device_class: "humidity"}},
};
const hass = {
  states: STATES,
  callWS: async ({type}) => {
    if (type === "config/entity_registry/list") return REG;
    if (type === "config/device_registry/list") return [];
    return [];
  },
};
const store = {};
let loaded = false;
LM.ensureLightsRegistry(store, hass, AREAS, () => { loaded = true; });
// The DOM shim's setTimeout is a fake, manually-flushed queue (never fires
// on its own) — but callWS above is a plain async function with no timers
// of its own, so the fetch settles in a handful of microtask ticks. Yield
// on microtasks only, never macrotasks, or this hangs forever.
for (let i = 0; i < 1000 && !loaded; i++) await Promise.resolve();
console.log(JSON.stringify({loaded, areaMap: store.reg ? store.reg.areaMap : null}));
""")
    assert out["loaded"], "the registry fetch never completed"
    areaMap = out["areaMap"]
    assert areaMap["light.lamp"] == "Bedroom", areaMap
    assert areaMap["sensor.temp1"] == "Bedroom", \
        f"a temperature sensor's own room pick must resolve here — this is the ONLY place gatherLights reads area_name from: {areaMap}"
    assert "sensor.humidity1" not in areaMap, \
        f"a non-temperature sensor.* must stay excluded — the fix is scoped to gatherLights' own admission rule: {areaMap}"


_TABLE_EL = """
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
"""


def test_table_filter_dropdown_lists_only_present_classes_and_hides_the_rest(tmp_path):
    """Garry: "Allow to filter by device type... as is standard in these
    type of lists". The dropdown must never offer a class nothing on this
    map has (a house with no WLED strip should never show "Strips"), and
    picking one hides every other row while the count badge switches from a
    plain count to an "N / total" fraction — the standard list-filter
    contract."""
    out = _run_pipeline_script(tmp_path, _TABLE_EL + """
const NOW = new Date().toISOString();
const AREA = {"fan.ceiling": "Kitchen", "binary_sensor.hall_pir": "Hall", "light.lamp": "Kitchen",
              "sensor.hall_temp": "Hall", "sensor.loft_temp": "Loft", "sensor.garage_temp": "Garage"};
const STATES = {
  "fan.ceiling":        {state: "on",  attributes: {friendly_name: "Ceiling Fan"}},
  "binary_sensor.hall_pir": {state: "off", attributes: {friendly_name: "Hall PIR", device_class: "motion"}},
  "light.lamp":         {state: "on",  attributes: {friendly_name: "Lamp"}},
  "sensor.hall_temp":   {state: "68",  last_updated: NOW, attributes: {friendly_name: "Hall Temp", device_class: "temperature"}},
  "sensor.loft_temp":   {state: "105", last_updated: NOW, attributes: {friendly_name: "Loft Temp", device_class: "temperature"}},
  "sensor.garage_temp": {state: "9",   last_updated: NOW, attributes: {friendly_name: "Garage Temp", device_class: "temperature"}},
};
const lights = LM.gatherLights(STATES, AREA, {}, "pro", {}, {});
let filterArg = "unset";
const host = {
  el, hiddenEids: new Set(), lightsLoading: false, model: {},
  tableClassFilter: "all", onTableClassFilter: (v) => { filterArg = v; },
};
const root1 = LM.buildLightsTable(host, lights);
const opts1 = [...root1.querySelectorAll("option")].map(o => o.getAttribute("value"));
const rows1 = root1.querySelectorAll("tr[data-eid]").length;
const badge1 = root1.querySelectorAll(".lv-count")[0].textContent;

host.tableClassFilter = "temp";
const root2 = LM.buildLightsTable(host, lights);
const rows2 = [...root2.querySelectorAll("tr[data-eid]")].map(r => r.getAttribute("data-eid")).sort();
const badge2 = root2.querySelectorAll(".lv-count")[0].textContent;

// Fire the dropdown itself, the way an actual pick in the list would.
const sel = root1.querySelectorAll("select")[0];
sel.value = "fan";
sel.dispatchEvent({ type: "change", stopPropagation(){}, preventDefault(){} });

console.log(JSON.stringify({ opts1, rows1, badge1, rows2, badge2, filterArg }));
""")
    assert out["opts1"] == ["all", "light", "fan", "motion", "temp"], \
        f"dropdown must list exactly the classes on this map, never an absent one like 'strip': {out['opts1']}"
    assert out["rows1"] == 6, out
    assert out["badge1"] == "6", "no filter active: the badge is a plain count, not an N / N fraction"
    assert out["rows2"] == ["sensor.garage_temp", "sensor.hall_temp", "sensor.loft_temp"], out["rows2"]
    assert out["badge2"] == "3 / 6", out["badge2"]
    assert out["filterArg"] == "fan", "picking a dropdown option must hand its value straight to onTableClassFilter"


def test_table_sort_cycles_three_states_and_orders_temperatures_numerically(tmp_path):
    """Garry: "allow for sort by column as is standard in these type of
    lists". Three clicks on a header must cycle ascending -> descending ->
    back to the unsorted order — the standard contract. The State column's
    own comment warns it sorts on the number, not the printed string: 9,
    68, 105 only come out in that order under a NUMERIC sort ("105" <
    "68" < "9" as text), so this fixture would catch a regression to
    string comparison."""
    out = _run_pipeline_script(tmp_path, _TABLE_EL + """
const NOW = new Date().toISOString();
const AREA = {"sensor.a": "Hall", "sensor.b": "Hall", "sensor.c": "Hall"};
const STATES = {
  "sensor.a": {state: "9",   last_updated: NOW, attributes: {friendly_name: "Garage Temp", device_class: "temperature"}},
  "sensor.b": {state: "68",  last_updated: NOW, attributes: {friendly_name: "Hall Temp",   device_class: "temperature"}},
  "sensor.c": {state: "105", last_updated: NOW, attributes: {friendly_name: "Loft Temp",   device_class: "temperature"}},
};
const lights = LM.gatherLights(STATES, AREA, {}, "pro", {}, {});
let sortArg = "unset";
const host = { el, hiddenEids: new Set(), lightsLoading: false, model: {}, tableSort: null, onTableSort: (v) => { sortArg = v; } };

// Click 1: unsorted -> ascending.
let root = LM.buildLightsTable(host, lights);
[...root.querySelectorAll("th")].find(t => t.textContent.startsWith("State")).click();
const click1 = sortArg;

// Ascending must read 9, 68, 105 — numeric order, which a string sort
// ("105" < "68" < "9") would get backwards.
host.tableSort = click1;
root = LM.buildLightsTable(host, lights);
const ascIds = [...root.querySelectorAll("tr[data-eid]")].map(r => r.getAttribute("data-eid"));

// Click 2 (now sorted asc) -> descending.
[...root.querySelectorAll("th")].find(t => t.textContent.startsWith("State")).click();
const click2 = sortArg;
host.tableSort = click2;
root = LM.buildLightsTable(host, lights);
const descIds = [...root.querySelectorAll("tr[data-eid]")].map(r => r.getAttribute("data-eid"));

// Click 3 (now sorted desc) -> back to unsorted (null).
[...root.querySelectorAll("th")].find(t => t.textContent.startsWith("State")).click();
const click3 = sortArg;

console.log(JSON.stringify({ click1, ascIds, click2, descIds, click3 }));
""")
    assert out["click1"] == {"column": "state", "dir": "asc"}, out["click1"]
    assert out["ascIds"] == ["sensor.a", "sensor.b", "sensor.c"], \
        f"9, 68, 105 must sort in that numeric order, got {out['ascIds']}"
    assert out["click2"] == {"column": "state", "dir": "desc"}, out["click2"]
    assert out["descIds"] == ["sensor.c", "sensor.b", "sensor.a"], out["descIds"]
    assert out["click3"] is None, "a third click on the same column must return to the unsorted order"


# ── Motion + occupancy pairing ────────────────────────────────────────────────
# Garry: "some of the sensors have two elements, motion and presence ...
# merge into one in a logical way" — then caught a real gap in the first
# design himself: "the alarm panel is an example where they are definitely
# separate motion sensors. Think about what an alarm panel is, and how it
# works." A hub (an alarm expander module, a multi-relay board) shares ONE
# device_id across MANY physically separate zones; a one-unit radar sensor
# shares one device_id across exactly two FACETS of the same physical spot.
# computeMotionOccupancyPairs only merges when BOTH an exact 1-motion/
# 1-occupancy shape AND matching names hold — either alone is not enough.

def _pairing_script(ent_reg, states):
    return f"""
const ENT_REG = {json.dumps(ent_reg)};
const STATES = {json.dumps(states)};
console.log(JSON.stringify(LM.computeMotionOccupancyPairs(ENT_REG, STATES)));
"""


def test_a_real_one_unit_sensor_pairs(tmp_path):
    """The two genuine pairs found live on Garry's own house."""
    ent_reg = [
        {"entity_id": "binary_sensor.living_room_motion", "device_id": "dev-livingroom"},
        {"entity_id": "binary_sensor.living_room_occupancy", "device_id": "dev-livingroom"},
        {"entity_id": "binary_sensor.smartsensor_motion", "device_id": "dev-g7tg"},
        {"entity_id": "binary_sensor.smartsensor_occupancy", "device_id": "dev-g7tg"},
    ]
    states = {
        "binary_sensor.living_room_motion": {"state": "off", "attributes": {"friendly_name": "Living Room Motion", "device_class": "motion"}},
        "binary_sensor.living_room_occupancy": {"state": "off", "attributes": {"friendly_name": "Living Room Occupancy", "device_class": "occupancy"}},
        "binary_sensor.smartsensor_motion": {"state": "off", "attributes": {"friendly_name": "G7TG Motion", "device_class": "motion"}},
        "binary_sensor.smartsensor_occupancy": {"state": "off", "attributes": {"friendly_name": "G7TG Occupancy", "device_class": "occupancy"}},
    }
    out = _run_pipeline_script(tmp_path, _pairing_script(ent_reg, states))
    assert out == {
        "binary_sensor.living_room_occupancy": "binary_sensor.living_room_motion",
        "binary_sensor.smartsensor_occupancy": "binary_sensor.smartsensor_motion",
    }, out


def test_an_alarm_panels_zones_never_pair(tmp_path):
    """Garry's real alarm expander: four DIFFERENT rooms' PIR zones, one
    device_id (the panel), all classed "motion" — none of them may merge
    with anything. Structurally excluded by entity count alone (no
    occupancy entity exists on this device at all)."""
    ent_reg = [{"entity_id": f"binary_sensor.alarm_di{i}", "device_id": "dev-alarm"} for i in range(1, 5)]
    names = ["Utility Room", "Nicole's Office", "Spare Bedroom", "Master Bedroom Entry"]
    states = {f"binary_sensor.alarm_di{i}": {"state": "off", "attributes": {"friendly_name": names[i - 1], "device_class": "motion"}} for i in range(1, 5)}
    out = _run_pipeline_script(tmp_path, _pairing_script(ent_reg, states))
    assert out == {}, out


def test_a_hub_with_both_classes_still_does_not_pair(tmp_path):
    """The deeper trap Garry pointed at: a hub does not need to be
    same-class to be wrong to merge. Two motion zones and two occupancy
    zones on ONE device_id, four different rooms — "has both classes
    present" alone would wrongly fold two of these together; the
    exact-one-of-each-class rule must refuse the whole device instead."""
    ent_reg = [
        {"entity_id": "binary_sensor.hub_z1_motion", "device_id": "dev-hub"},
        {"entity_id": "binary_sensor.hub_z2_motion", "device_id": "dev-hub"},
        {"entity_id": "binary_sensor.hub_z3_occupancy", "device_id": "dev-hub"},
        {"entity_id": "binary_sensor.hub_z4_occupancy", "device_id": "dev-hub"},
    ]
    states = {
        "binary_sensor.hub_z1_motion": {"state": "off", "attributes": {"friendly_name": "Garage Motion", "device_class": "motion"}},
        "binary_sensor.hub_z2_motion": {"state": "off", "attributes": {"friendly_name": "Hallway Motion", "device_class": "motion"}},
        "binary_sensor.hub_z3_occupancy": {"state": "off", "attributes": {"friendly_name": "Den Occupancy", "device_class": "occupancy"}},
        "binary_sensor.hub_z4_occupancy": {"state": "off", "attributes": {"friendly_name": "Loft Occupancy", "device_class": "occupancy"}},
    }
    out = _run_pipeline_script(tmp_path, _pairing_script(ent_reg, states))
    assert out == {}, out


def test_two_motion_zones_sharing_one_occupancy_names_room_stay_unpaired(tmp_path):
    """Isolates the exact-one-of-each-class rule on its own: TWO motion
    entities that both share a name root with ONE occupancy entity, all
    one device_id — ambiguous which motion is "the" pair for the
    occupancy half, so none of them may merge. (Neither the alarm-panel
    test above nor the differently-named-hub test below actually proves
    this specific rule: the alarm panel has zero occupancy entities to
    begin with, and the differently-named hub is refused by the name
    check first — either alone would let "at least one of each" slip by
    undetected. Found by the mutation pass, not written up front.)"""
    ent_reg = [
        {"entity_id": "binary_sensor.den_motion_a", "device_id": "dev-den"},
        {"entity_id": "binary_sensor.den_motion_b", "device_id": "dev-den"},
        {"entity_id": "binary_sensor.den_occupancy", "device_id": "dev-den"},
    ]
    states = {
        # Identical name roots on purpose ("Den Motion" both times, once
        # class-words are stripped) — a distinguishing "A"/"B" suffix would
        # ALSO fail the name check on its own, masking the count check the
        # same way the first attempt at this test did.
        "binary_sensor.den_motion_a": {"state": "off", "attributes": {"friendly_name": "Den Motion", "device_class": "motion"}},
        "binary_sensor.den_motion_b": {"state": "off", "attributes": {"friendly_name": "Den Motion", "device_class": "motion"}},
        "binary_sensor.den_occupancy": {"state": "off", "attributes": {"friendly_name": "Den Occupancy", "device_class": "occupancy"}},
    }
    out = _run_pipeline_script(tmp_path, _pairing_script(ent_reg, states))
    assert out == {}, out


def test_pairing_requires_matching_names_not_just_the_shape(tmp_path):
    """Exactly one motion, exactly one occupancy, same device_id — the
    right SHAPE — but unrelated names. The second, independent signal
    must also refuse this, or the shape check alone would have merged
    two coincidentally-shaped zones on a differently-configured hub."""
    ent_reg = [
        {"entity_id": "binary_sensor.hub_kitchen_motion", "device_id": "dev-hub2"},
        {"entity_id": "binary_sensor.hub_garage_occupancy", "device_id": "dev-hub2"},
    ]
    states = {
        "binary_sensor.hub_kitchen_motion": {"state": "off", "attributes": {"friendly_name": "Kitchen Motion", "device_class": "motion"}},
        "binary_sensor.hub_garage_occupancy": {"state": "off", "attributes": {"friendly_name": "Garage Occupancy", "device_class": "occupancy"}},
    }
    out = _run_pipeline_script(tmp_path, _pairing_script(ent_reg, states))
    assert out == {}, out


def test_a_paired_sensor_merges_into_one_marker_reading_only_its_own_motion_state(tmp_path):
    """End to end through gatherLights: the occupancy half never gets its
    own row, but it also never extends the merged marker's glow — the
    primary reads its OWN state and last_changed only. Garry, 2026-09-04:
    every motion-class marker should look and act the same to a viewer;
    letting a sustained occupancy signal hold a paired marker "on" after
    its own motion entity had cleared made that one room's marker behave
    very differently from every plain single-report PIR in the house, for
    a distinction nothing on the map explained."""
    out = _run_pipeline_script(tmp_path, """
const AREA = {"binary_sensor.lr_motion": "Living Room", "binary_sensor.lr_occupancy": "Living Room"};
const PAIR = {"binary_sensor.lr_occupancy": "binary_sensor.lr_motion"};
// Motion cleared 10 minutes ago; occupancy (a different signal on the same
// physical device) is STILL on right now.
const STATES = {
  "binary_sensor.lr_motion":    {state: "off", last_changed: "2026-01-01T00:00:00.000Z",
                                  attributes: {friendly_name: "Living Room Motion", device_class: "motion"}},
  "binary_sensor.lr_occupancy": {state: "on",  last_changed: "2026-01-01T00:10:00.000Z",
                                  attributes: {friendly_name: "Living Room Occupancy", device_class: "occupancy"}},
};
const lights = LM.gatherLights(STATES, AREA, {}, "pro", {}, {}, PAIR);
const ids = lights.map(l => l.entity_id).sort();
const primary = lights.find(l => l.entity_id === "binary_sensor.lr_motion");
console.log(JSON.stringify({ids, state: primary && primary.state, last_changed: primary && primary.last_changed, code: primary && primary.code}));
""")
    assert out["ids"] == ["binary_sensor.lr_motion"], "the occupancy half must not appear as its own row"
    assert out["state"] == "off", "the merged marker follows its own motion entity, not the occupancy half"
    assert out["last_changed"] == "2026-01-01T00:00:00.000Z", "the merged marker's own timestamp, not the occupancy half's"
    assert out["code"] == "M01", out


def test_brand_comes_from_the_device_registry_manufacturer_and_is_never_gated(tmp_path):
    """Garry asked which two entities on the motion list were a specific
    switch brand and there was no way to answer from inside PadSpan — the
    index had no column for it. manufacturerMap threads the device
    registry's OWN manufacturer string (often a raw Zigbee/Tuya firmware
    signature, not the name on the box — that is what HA itself knows)
    through gatherLights same as areaMap/platformMap already do. Unlike
    platform, it is never tier-gated: identifying hardware is informational,
    not a placement or styling control, so free tier sees it too."""
    out = _run_pipeline_script(tmp_path, """
const AREA = {"light.kitchen": "Kitchen", "light.hall": "Hall"};
const MFR = {"light.kitchen": "_TZE204_ex3rcdha"};
const STATES = {
  "light.kitchen": {state: "on", attributes: {friendly_name: "Kitchen"}},
  "light.hall":    {state: "off", attributes: {friendly_name: "Hall"}},
};
const free = LM.gatherLights(STATES, AREA, {}, "free", {}, {}, {}, MFR);
const pro = LM.gatherLights(STATES, AREA, {}, "pro", {}, {}, {}, MFR);
const byId = (lights, eid) => lights.find(l => l.entity_id === eid);
console.log(JSON.stringify({
  freeKnown: byId(free, "light.kitchen").brand,
  freeUnknown: byId(free, "light.hall").brand,
  proKnown: byId(pro, "light.kitchen").brand,
}));
""")
    assert out["freeKnown"] == "_TZE204_ex3rcdha", "free tier must see the brand too — it is informational, not gated"
    assert out["freeUnknown"] is None, "a device the registry has no manufacturer for reads null, not an empty string"
    assert out["proKnown"] == "_TZE204_ex3rcdha", out


# ── Temperature sensors ───────────────────────────────────────────────────────
# Garry: "same as wled or any other objects, devices telling the temperature
# can also act like a motion sensor, so rule is if they gave the temperature
# in the last hour and they are placed on the map, a shape can be chosen for
# that temp and inside is simply the temperature, 3 digit, and larger" — then
# "And only if placed like all others". Admission and code assignment are
# pipeline-level (this file); the placed+fresh digit-display gate is
# renderer-level (test_lights_renderer.py).

def test_temperature_sensors_ride_the_pipeline_other_sensor_classes_do_not(tmp_path):
    out = _run_pipeline_script(tmp_path, """
const AREA = {"sensor.living_room_temp": "Living Room", "sensor.living_room_humidity": "Living Room", "light.lamp": "Living Room"};
const STATES = {
  "sensor.living_room_temp": {state: "71.6", last_updated: "2026-01-01T00:00:00.000Z",
                               attributes: {friendly_name: "Living Room Temperature", device_class: "temperature"}},
  // A humidity sensor is ALSO a plain sensor.* entity — must NOT be admitted.
  "sensor.living_room_humidity": {state: "44", last_updated: "2026-01-01T00:00:00.000Z",
                                   attributes: {friendly_name: "Living Room Humidity", device_class: "humidity"}},
  "light.lamp": {state: "off", attributes: {friendly_name: "Lamp", supported_color_modes: ["onoff"]}},
};
const lights = LM.gatherLights(STATES, AREA, {}, "pro", {}, {}, {});
const by = Object.fromEntries(lights.map(l => [l.entity_id, l]));
console.log(JSON.stringify({
  ids: lights.map(l => l.entity_id).sort(),
  temp: by["sensor.living_room_temp"] && {code: by["sensor.living_room_temp"].code, isTemp: by["sensor.living_room_temp"].isTemp,
    shape: by["sensor.living_room_temp"].shape, temperature: by["sensor.living_room_temp"].temperature,
    last_changed: by["sensor.living_room_temp"].last_changed, dimmable: by["sensor.living_room_temp"].dimmable},
}));
""")
    assert out["ids"] == ["light.lamp", "sensor.living_room_temp"], "a humidity sensor must not join the lights map"
    t = out["temp"]
    assert t["code"] == "T01" and t["isTemp"] and t["shape"] == "tempreadout", t
    assert t["temperature"] == 72, f"71.6 must round to 72: {t}"
    assert t["last_changed"] == "2026-01-01T00:00:00.000Z", "last_updated feeds the freshness gate, not an attribute"
    assert t["dimmable"] is False, "a read-only sensor must never offer the brightness card"


def test_health_flags_unavailable_or_unknown_regardless_of_class(tmp_path):
    """Garry: "do a health check for all the devices". The one domain-agnostic
    failure signal every entity type can report — HA's own "unavailable" or
    "unknown" state — must fail the check no matter which class it's on."""
    out = _run_pipeline_script(tmp_path, """
const AREA = {"light.lamp": "Kitchen", "fan.ceiling": "Kitchen", "binary_sensor.pir": "Hall", "sensor.temp": "Hall"};
const STATES = {
  "light.lamp":       {state: "unavailable", attributes: {friendly_name: "Lamp"}},
  "fan.ceiling":       {state: "unknown", attributes: {friendly_name: "Ceiling Fan"}},
  "binary_sensor.pir": {state: "unavailable", attributes: {friendly_name: "PIR", device_class: "motion"}},
  "sensor.temp":       {state: "unknown", attributes: {friendly_name: "Temp", device_class: "temperature"}},
};
const by = Object.fromEntries(LM.gatherLights(STATES, AREA, {}, "pro", {}, {}).map(l => [l.entity_id, l]));
console.log(JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, l]) => [k, {healthy: l.healthy, reason: l.healthReason}]))));
""")
    for eid in ("light.lamp", "fan.ceiling", "binary_sensor.pir", "sensor.temp"):
        assert out[eid]["healthy"] is False, out
        assert "unavailable" in out[eid]["reason"] or "unknown" in out[eid]["reason"], out[eid]


def test_wled_health_flags_a_strip_that_lost_its_effect_list(tmp_path):
    """A strip forced WLED-class (type_override, Pro) whose live effect_list
    has gone empty is still reachable — still turns on and off — but has
    quietly lost the one thing that made it a strip rather than a plain
    light. That's worth surfacing even though the entity itself looks fine."""
    out = _run_pipeline_script(tmp_path, """
const AREA = {"light.strip": "Kitchen", "light.strip2": "Kitchen"};
const STATES = {
  "light.strip":  {state: "on", attributes: {friendly_name: "Forced WLED, effects gone"}},
  "light.strip2": {state: "on", attributes: {friendly_name: "Real WLED", effect_list: ["Solid", "Rainbow"]}},
};
const OVR = {"light.strip": "wled"};
const by = Object.fromEntries(LM.gatherLights(STATES, AREA, {}, "pro", {}, OVR).map(l => [l.entity_id, l]));
console.log(JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, l]) => [k, {isWled: l.isWled, healthy: l.healthy, reason: l.healthReason}]))));
""")
    assert out["light.strip"]["isWled"] is True
    assert out["light.strip"]["healthy"] is False
    assert "effect" in out["light.strip"]["reason"].lower(), out["light.strip"]
    assert out["light.strip2"]["isWled"] is True and out["light.strip2"]["healthy"] is True, out["light.strip2"]


def test_motion_health_flags_a_stuck_sensor_not_a_recent_trip(tmp_path):
    """Mirrors iso_lights.js's own MOTION_RECENT_MS: a sensor still reporting
    "on" six-plus hours after it last changed is stuck hardware, not a real
    trip — the same line the map's own rendering already draws, reused here
    rather than a second, possibly-disagreeing number."""
    out = _run_pipeline_script(tmp_path, """
const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const AREA = {"binary_sensor.stuck": "Hall", "binary_sensor.fresh": "Hall", "binary_sensor.quiet": "Hall"};
const STATES = {
  // 7h ago, still "on" — stuck.
  "binary_sensor.stuck": {state: "on", last_changed: "2026-09-05T05:00:00.000Z", attributes: {friendly_name: "Stuck PIR", device_class: "motion"}},
  // 1h ago, still "on" — a real, ongoing trip.
  "binary_sensor.fresh": {state: "on", last_changed: "2026-09-05T11:00:00.000Z", attributes: {friendly_name: "Fresh PIR", device_class: "motion"}},
  // "off" for 7h is just quiet, never "stuck" — only an "on" that never clears is.
  "binary_sensor.quiet": {state: "off", last_changed: "2026-09-05T05:00:00.000Z", attributes: {friendly_name: "Quiet PIR", device_class: "motion"}},
};
const by = Object.fromEntries(LM.gatherLights(STATES, AREA, {}, "pro", {}, {}, {}, {}, NOW).map(l => [l.entity_id, l]));
console.log(JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, l]) => [k, {healthy: l.healthy, reason: l.healthReason}]))));
""")
    assert out["binary_sensor.stuck"]["healthy"] is False
    assert "stuck" in out["binary_sensor.stuck"]["reason"].lower(), out["binary_sensor.stuck"]
    assert out["binary_sensor.fresh"]["healthy"] is True, out["binary_sensor.fresh"]
    assert out["binary_sensor.quiet"]["healthy"] is True, out["binary_sensor.quiet"]


def test_temp_health_flags_a_stale_reading(tmp_path):
    """Mirrors iso_lights.js's own TEMP_FRESH_MS ("if they gave the
    temperature in the last hour" — Garry): a reading older than that, or
    with no timestamp at all, is stale even if HA hasn't flipped the entity
    to unavailable yet."""
    out = _run_pipeline_script(tmp_path, """
const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const AREA = {"sensor.stale": "Hall", "sensor.fresh": "Hall", "sensor.no_ts": "Hall"};
const STATES = {
  "sensor.stale": {state: "68", last_updated: "2026-09-05T09:00:00.000Z", attributes: {friendly_name: "Stale Temp", device_class: "temperature"}},
  "sensor.fresh": {state: "68", last_updated: "2026-09-05T11:50:00.000Z", attributes: {friendly_name: "Fresh Temp", device_class: "temperature"}},
  "sensor.no_ts": {state: "68", attributes: {friendly_name: "No Timestamp Temp", device_class: "temperature"}},
};
const by = Object.fromEntries(LM.gatherLights(STATES, AREA, {}, "pro", {}, {}, {}, {}, NOW).map(l => [l.entity_id, l]));
console.log(JSON.stringify(Object.fromEntries(Object.entries(by).map(([k, l]) => [k, {healthy: l.healthy, reason: l.healthReason}]))));
""")
    assert out["sensor.stale"]["healthy"] is False, out["sensor.stale"]
    assert out["sensor.fresh"]["healthy"] is True, out["sensor.fresh"]
    assert out["sensor.no_ts"]["healthy"] is False, out["sensor.no_ts"]
    assert "timestamp" in out["sensor.no_ts"]["reason"].lower(), out["sensor.no_ts"]


def test_health_column_and_filter_button_hide_healthy_rows(tmp_path):
    """The Health dot sits right after Room, before the other stat columns —
    Garry: "in front of the other stats". The filter button (separate from
    the class dropdown) narrows the list to only what's testing unhealthy,
    and its label carries the live unhealthy count."""
    out = _run_pipeline_script(tmp_path, _TABLE_EL + """
const AREA = {"light.ok": "Kitchen", "light.dead": "Kitchen", "binary_sensor.ok": "Hall", "binary_sensor.stuck": "Hall"};
const STATES = {
  "light.ok":          {state: "on", attributes: {friendly_name: "Good Lamp"}},
  "light.dead":        {state: "unavailable", attributes: {friendly_name: "Dead Lamp"}},
  "binary_sensor.ok":  {state: "off", attributes: {friendly_name: "OK PIR", device_class: "motion"}},
  "binary_sensor.stuck": {state: "on", last_changed: "2020-01-01T00:00:00.000Z", attributes: {friendly_name: "Stuck PIR", device_class: "motion"}},
};
const lights = LM.gatherLights(STATES, AREA, {}, "pro", {}, {});
const headerCols = [...LM.buildLightsTable({el, hiddenEids: new Set(), lightsLoading: false, model: {}, tableClassFilter: "all"}, lights)
  .querySelectorAll("th")].map(th => th.textContent.replace(/[▲▼]/g, "").trim());

let filterArg = "unset";
const host = { el, hiddenEids: new Set(), lightsLoading: false, model: {},
  tableClassFilter: "all", tableHealthFilter: false, onTableHealthFilter: (v) => { filterArg = v; } };
const root1 = LM.buildLightsTable(host, lights);
const rows1 = root1.querySelectorAll("tr[data-eid]").length;
const btn1 = [...root1.querySelectorAll("button")].find(b => /unhealthy/i.test(b.textContent));

host.tableHealthFilter = true;
const root2 = LM.buildLightsTable(host, lights);
const rows2 = [...root2.querySelectorAll("tr[data-eid]")].map(r => r.getAttribute("data-eid")).sort();
const badge2 = root2.querySelectorAll(".lv-count")[0].textContent;

btn1.dispatchEvent({ type: "click", stopPropagation(){}, preventDefault(){} });
console.log(JSON.stringify({ headerCols, rows1, btn1Text: btn1.textContent, rows2, badge2, filterArg }));
""")
    assert "Health" in out["headerCols"]
    assert out["headerCols"].index("Health") < out["headerCols"].index("Brand"), out["headerCols"]
    assert out["headerCols"].index("Health") < out["headerCols"].index("State"), out["headerCols"]
    assert out["rows1"] == 4, out
    assert "(2)" in out["btn1Text"], "the button's own label carries the live unhealthy count"
    assert out["rows2"] == ["binary_sensor.stuck", "light.dead"], out["rows2"]
    assert out["badge2"] == "2 / 4", out["badge2"]
    assert out["filterArg"] is True, "clicking the button while off must turn it on"


def test_both_hosts_pass_the_tier():
    """The gate is only as good as its callers: both hosts hand settings.tier
    to gatherLights and to the card, and neither re-derives the ladder."""
    panel = (_WWW / "lights_panel.js").read_text(encoding="utf-8")
    maps = (_VIEWS / "maps.js").read_text(encoding="utf-8")
    assert "this.state._tier" in panel and "tier: this.state._tier" in panel
    assert "gatherLights(this._hass?.states||{}, reg.areaMap, this.state._shapeOverrides, this.state._tier, reg.platformMap, this.state._typeOverrides, reg.pairMap, reg.manufacturerMap)" in panel
    assert "gatherLights(ctx.hass?.states || {}, reg.areaMap, shapeOverrides, tier, reg.platformMap, typeOverrides, reg.pairMap, reg.manufacturerMap)" in maps
    assert "\n    tier,\n" in maps
    for src, name in ((panel, "lights_panel.js"), (maps, "maps.js")):
        assert "LIGHTING_TIER" not in src, f"{name} re-derives the lighting gate; lights_map.js owns it"
