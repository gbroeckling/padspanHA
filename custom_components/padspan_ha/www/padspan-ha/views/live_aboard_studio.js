// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard's Studio look (settings.atlas_3d_look "studio", off unless
// picked): the house as a lit model on a stage. Live Aboard's own colours
// stay exactly as they are (every room, light and drawing); only what is
// round them changes:
//   sky      a gradient dome from the real sun (day, golden hour, dusk,
//            night with a few stars), the sun's own glow on it
//   stage    a soft pad under the house that fades into the sky's horizon,
//            a faint metre grid on it, a contact shadow under the house
//   light    a cool fill that keeps shadows coloured, a rim light from
//            behind, softer and lighter sun shadows (High), highlights that
//            roll off instead of clipping (Neutral tone mapping, lit
//            surfaces only: names, chips and glows are never touched)
//   walls    a little darker at their foot, as if the floor shaded them
//   frame    a vignette over the view (CSS: costs the GPU nothing)
// Low keeps the sky, the stage, the contact shadow, the fill and the
// vignette (one dome, one pad, one quad); the rim light and the shadow
// softening are High's. Nothing here runs unless the view picked Studio, so
// the other looks draw exactly as before. Off (dispose), everything it
// changed is put back.

// The sky by the sun's phase: zenith, horizon, the pad under the house, the
// sun's glow. Day, golden hour (the sun low), night; twilight is between.
export const STUDIO_SKY = Object.freeze({
  day:    Object.freeze({ zenith: "#355a70", horizon: "#a9bbba", pad: "#d3cfc4", glow: "#fff4dc" }),
  golden: Object.freeze({ zenith: "#36466a", horizon: "#d9a982", pad: "#cdbca8", glow: "#ffc98a" }),
  night:  Object.freeze({ zenith: "#03060d", horizon: "#1a2636", pad: "#46536a", glow: "#6d7fa8" }),
});
// The light: how much the fill, the sun and the rim give, by day and by night.
export const STUDIO_LIGHT = Object.freeze({
  fillDay: 1.05, fillNight: 1.5,           // x the view's own sky light (it keeps shadows coloured, not black)
  fillSky: "#dfe9f2", fillGround: "#6b5f50", // the fill's sky and bounce, by day
  sunK: 1.15,                              // x the view's own sun
  rimDay: 0.55, rimNight: 0.45, rimDayCol: "#cfe0ff", rimNightCol: "#7f9cd6",
  exposure: 1.08,                          // Neutral tone mapping's exposure
  shadow: 0.8, shadowRadius: 2,
  padNight: 0.22,                          // the stage's own light at night (its colour x this)         // High: the sun shadow's strength (1: black) and softness
});
export const STUDIO_WALL_FOOT = 0.78;
// What falls on a light day sky: the rain a slate blue (white would not show), white at night.
export const STUDIO_RAIN_DAY = "#56687a";
export function rainOf(look){ return Number(look && look.night) >= 0.5 ? "#ffffff" : STUDIO_RAIN_DAY; }      // a wall's colour at its foot (1: as at its top)
export const STUDIO_VIGNETTE = "radial-gradient(ellipse 75% 70% at 50% 46%, rgba(0,0,0,0) 58%, rgba(2,6,4,.34) 100%)";

// The arrival: once a view, the camera glides in to the view it opened on,
// from this much farther out (x radius), turned (rad) and higher (rad), over ms.
export const STUDIO_ARRIVAL = Object.freeze({ radius: 1.45, turn: 0.55, rise: 0.12, ms: 1700 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** a over b by t (0: b, 1: a), "#rrggbb". */
export function mixHex(a, b, t){
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pb >> s) & 255) + (((pa >> s) & 255) - ((pb >> s) & 255)) * t);
  return "#" + [ch(16), ch(8), ch(0)].map(v => v.toString(16).padStart(2, "0")).join("");
}
/** The sky for the view's sun look ({night 0..1, warm 0..1}, the house module's
 *  sunLight): day leaning golden as the sun gets low, then toward night. Pure. */
export function skyAt(look){
  const night = clamp(Number(look && look.night) || 0, 0, 1), warm = clamp(Number(look && look.warm) || 0, 0, 1);
  const out = {};
  for (const k of ["zenith", "horizon", "pad", "glow"]) {
    out[k] = mixHex(STUDIO_SKY.night[k], mixHex(STUDIO_SKY.golden[k], STUDIO_SKY.day[k], warm), night);
  }
  return out;
}
/** What Studio turns on for a quality profile ("high" | "low"). Pure. */
export function studioParts(profile){
  const high = profile === "high";
  return { sky: true, stage: true, contact: true, fill: true, vignette: true, tone: true, wallFoot: true,
           rim: high, softShadow: high, stars: true };
}

const SKY_VS = `varying vec3 vDir;
void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.99999; }`;
const SKY_FS = `uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow; uniform vec3 uSun; uniform float uSunK; uniform float uStars;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.9, h), 0.7));
  float s = max(dot(d, normalize(uSun)), 0.0);
  c += uGlow * uSunK * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.5) * smoothstep(-0.15, 0.1, h);
  if (uStars > 0.0 && h > 0.08) {
    vec3 g = floor(d * 260.0); float r = hash(g);
    float st = step(0.9975, r) * smoothstep(0.08, 0.35, h) * (0.45 + 0.55 * hash(g + 7.0));
    c += vec3(st * uStars);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

/** The Studio look over a view. o: { THREE, renderer, scene, root, canvas,
 *  hemi, sun, wallBox (the shared wall geometry), profile(): "high"|"low" }.
 *  Returns { house(h), sun(look, dir), profile(), prepare(camera), state(), dispose() }. */
export function createStudio(o){
  const { THREE, renderer, scene, root, canvas, hemi, sun, wallBox } = o;
  const profile = () => (o.profile && o.profile() === "high" ? "high" : "low");
  const before = { toneMapping: renderer.toneMapping, exposure: renderer.toneMappingExposure, shadowType: renderer.shadowMap.type,
                   shadowIntensity: sun.shadow.intensity, shadowRadius: sun.shadow.radius,
                   clear: renderer.getClearColor(new THREE.Color()).getHex(), bg: scene.background.getHex(), fog: scene.fog.color.getHex() };
  const res = [];                                            // what it made, let go of on dispose
  const touched = new Set();                                 // materials it kept out of tone mapping
  let sky = null, pad = null, contact = null, vig = null, rim = null, hidden = [], skyNow = skyAt({ night: 0, warm: 0 });
  let parts = studioParts(profile()), lookNow = { night: 0, warm: 0 }, arrived = false;

  // The sky: a dome round the camera, drawn first, behind everything.
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
                uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunK: { value: 1 }, uStars: { value: 0 } },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  const skyGeo = new THREE.SphereGeometry(600, 40, 20);
  sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -100; sky.frustumCulled = false; sky.userData.studio = true;
  res.push(skyGeo, skyMat);
  scene.add(sky);

  // The rim light: from behind the house as the sun sees it, no shadow.
  rim = new THREE.DirectionalLight(0xffffff, 0);
  rim.userData.studio = true;
  scene.add(rim, rim.target);

  // The vignette: one CSS gradient over the canvas, under the bars.
  if (root && canvas) {
    vig = document.createElement("div");
    vig.setAttribute("data-la3d-studio", "vignette");
    vig.setAttribute("aria-hidden", "true");
    vig.style.cssText = `position:absolute;inset:0;pointer-events:none;border-radius:inherit;background:${STUDIO_VIGNETTE}`;
    canvas.insertAdjacentElement("afterend", vig);
  }

  // The walls a little darker at their foot: the shared geometry's own
  // colours (its sides' lower corners), put back on dispose.
  const wallCol = wallBox && wallBox.attributes.color ? wallBox.attributes.color : null, wallOld = wallCol ? wallCol.array.slice() : null;
  if (wallCol) {
    const pos = wallBox.attributes.position, nrm = wallBox.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(nrm.getY(i)) < 0.5 && pos.getY(i) < 0.01) wallCol.setXYZ(i, STUDIO_WALL_FOOT, STUDIO_WALL_FOOT, STUDIO_WALL_FOOT);
    }
    wallCol.needsUpdate = true;
  }

  // A soft rounded box, white in the middle: the contact shadow's alpha.
  function contactTexture(){
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const g = c.getContext("2d"), img = g.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const u = Math.abs(x + 0.5 - 64) / 64, v = Math.abs(y + 0.5 - 64) / 64;
      // a rounded-rectangle distance: 0 inside the inner box, 1 at the edge
      const du = Math.max(0, (u - 0.62) / 0.38), dv = Math.max(0, (v - 0.62) / 0.38), d = Math.min(1, Math.hypot(du, dv));
      const a = Math.pow(1 - d, 2.2);
      const k = (y * 128 + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(a * 255);
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }
  const contactTex = contactTexture();
  const contactMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTex, transparent: true, opacity: 0.42, depthWrite: false,
                                                   polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, fog: false, toneMapped: false });
  res.push(contactTex, contactMat);

  // The stage: the ground's own lighting (shadows, lamp light) with its
  // colour from the pad in the middle to the horizon far out, a faint metre
  // grid near the house. One material per profile, as the view's own.
  const padU = { uCentre: { value: new THREE.Vector2() }, uR: { value: 12 }, uPad: { value: new THREE.Color() },
                 uFar: { value: new THREE.Color() }, uGrid: { value: 0.07 }, uLift: { value: 0 } };
  const padMats = {};
  function padMat(){
    const p = profile();
    if (padMats[p]) return padMats[p];
    const m = p === "high" ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 })
      : new THREE.MeshLambertMaterial({ color: 0xffffff });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, padU);
      sh.vertexShader = "varying vec2 vStage;\n" + sh.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n  vStage = (modelMatrix * vec4(position, 1.0)).xz;");
      sh.fragmentShader = "uniform vec2 uCentre; uniform float uR; uniform vec3 uPad; uniform vec3 uFar; uniform float uGrid; uniform float uLift;\nvarying vec2 vStage;\n"
        + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
  float sd = length(vStage - uCentre);
  diffuseColor.rgb = mix(uPad, uFar, smoothstep(uR * 0.55, uR * 2.6, sd));
  vec2 gq = abs(fract(vStage + 0.5) - 0.5) / fwidth(vStage);
  float gl = 1.0 - min(min(gq.x, gq.y), 1.0);
  diffuseColor.rgb *= 1.0 - uGrid * gl * (1.0 - smoothstep(uR * 0.4, uR * 1.6, sd));`)
          .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  totalEmissiveRadiance += uPad * uLift * (1.0 - smoothstep(uR * 0.3, uR * 2.2, length(vStage - uCentre)));`);
    };
    m.customProgramCacheKey = () => "la3d-studio-pad";
    res.push(m);
    return (padMats[p] = m);
  }

  /** Lit surfaces keep tone mapping; everything else (names, chips, glows,
   *  rings, the weather) is kept out of it, so its colours are exactly the
   *  view's own. Seen once per material. */
  function keepColours(){
    scene.traverse((ob) => {
      const ms = ob.material ? (Array.isArray(ob.material) ? ob.material : [ob.material]) : [];
      for (const m of ms) {
        if (!m || touched.has(m)) continue;
        touched.add(m);
        if (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial) continue;
        if (m.toneMapped) { m.toneMapped = false; m.needsUpdate = true; m.userData.studioTone = true; }
      }
    });
  }

  function paintSky(){
    const s = skyNow, u = skyMat.uniforms;
    u.uZenith.value.set(s.zenith); u.uHorizon.value.set(s.horizon); u.uGlow.value.set(s.glow);
    u.uSunK.value = 1 - lookNow.night * 0.6;
    u.uStars.value = parts.stars ? clamp((lookNow.night - 0.5) * 2, 0, 1) * 0.85 : 0;
    scene.background.set(s.horizon);
    scene.fog.color.set(s.horizon);
    renderer.setClearColor(s.horizon, 1);
    padU.uPad.value.set(s.pad);
    padU.uFar.value.set(s.horizon);
    padU.uGrid.value = 0.06 + lookNow.night * 0.05;
    padU.uLift.value = STUDIO_LIGHT.padNight * lookNow.night;   // at night the stage keeps a soft light of its own
  }
  function applyProfileParts(){
    parts = studioParts(profile());
    renderer.toneMapping = parts.tone ? THREE.NeutralToneMapping : before.toneMapping;
    renderer.toneMappingExposure = parts.tone ? STUDIO_LIGHT.exposure : before.exposure;
    // Softer, lighter sun shadows on High (PCF with a radius; PCFSoft has none).
    renderer.shadowMap.type = parts.softShadow ? THREE.PCFShadowMap : before.shadowType;
    sun.shadow.intensity = parts.softShadow ? STUDIO_LIGHT.shadow : before.shadowIntensity;
    sun.shadow.radius = parts.softShadow ? STUDIO_LIGHT.shadowRadius : before.shadowRadius;
    rim.visible = parts.rim;
    if (pad) pad.material = padMat();
    if (vig) vig.style.display = parts.vignette ? "" : "none";
  }
  applyProfileParts();
  paintSky();

  return {
    /** The house was drawn again: the stage and the contact shadow under it,
     *  the view's own ground and grid stood aside. h: { box, groundY, ground, grid }. */
    house(h){
      for (const ob of hidden) ob.visible = true;
      hidden = [];
      for (const ob of [h.ground, h.grid]) if (ob) { ob.visible = false; hidden.push(ob); }
      const b = h.box, cx = (b.x0 + b.x1) / 2, cz = (b.y0 + b.y1) / 2, sx = b.x1 - b.x0, sz = b.y1 - b.y0;
      const R = Math.max(sx, sz) / 2 + 3;
      padU.uCentre.value.set(cx, cz);
      padU.uR.value = R;
      if (!pad) {
        const g = new THREE.CircleGeometry(400, 96).rotateX(-Math.PI / 2);
        res.push(g);
        pad = new THREE.Mesh(g, padMat());
        pad.receiveShadow = true; pad.userData.studio = true;
        scene.add(pad);
      }
      pad.position.set(cx, h.groundY - 0.002, cz);
      if (!contact) {
        const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        res.push(g);
        contact = new THREE.Mesh(g, contactMat);
        contact.renderOrder = 1; contact.userData.studio = true;
        scene.add(contact);
      }
      contact.position.set(cx, h.groundY + 0.012, cz);
      contact.scale.set(sx + 2.4, 1, sz + 2.4);
      touched.clear();
    },
    /** The sun was drawn again (the view's drawSun): the sky follows it,
     *  and the light is the view's own, eased into Studio's. */
    sun(look, dir){
      lookNow = { night: clamp(look.night, 0, 1), warm: clamp(look.warm, 0, 1) };
      skyNow = skyAt(lookNow);
      skyMat.uniforms.uSun.value.copy(dir);
      const L = STUDIO_LIGHT, n = lookNow.night;
      hemi.intensity *= L.fillDay + (L.fillNight - L.fillDay) * n;
      hemi.color.lerp(new THREE.Color(L.fillSky), 0.5 * (1 - n));
      hemi.groundColor.lerp(new THREE.Color(L.fillGround), 0.6 * (1 - n));
      sun.intensity *= L.sunK;
      // The rim: across from the sun, high, cool; moonlight at night.
      rim.intensity = (L.rimDay + (L.rimNight - L.rimDay) * n);
      rim.color.set(L.rimDayCol).lerp(new THREE.Color(L.rimNightCol), n);
      rim.target.position.copy(sun.target.position);
      rim.position.set(sun.target.position.x - dir.x * 50, sun.target.position.y + 45, sun.target.position.z - dir.z * 50);
      rim.target.updateMatrixWorld();
      paintSky();
    },
    /** True the first time only: the view's arrival is due. */
    takeArrival(){ if (arrived) return false; arrived = true; return true; },
    /** What falls, for the sky as it is (the weather's colour). */
    rain(){ return rainOf(lookNow); },
    /** The quality profile changed. */
    profile(){ applyProfileParts(); touched.clear(); },
    /** Just before a draw: the sky round the camera, new materials kept out of tone mapping. */
    prepare(camera){
      sky.position.copy(camera.position);
      keepColours();
    },
    state(){
      return { on: true, parts: { ...parts }, sky: { ...skyNow }, tone: renderer.toneMapping === THREE.NeutralToneMapping,
               shadowType: renderer.shadowMap.type, rim: rim.visible ? rim.intensity : 0, pad: !!pad, contact: !!contact,
               vignette: !!(vig && vig.parentNode && vig.style.display !== "none"), hidden: hidden.length,
               wallFoot: wallCol ? wallCol.array.some(v => Math.abs(v - STUDIO_WALL_FOOT) < 1e-6) : false };
    },
    /** Studio off: everything it changed put back, everything it made let go of. */
    dispose(){
      for (const ob of hidden) ob.visible = true;
      hidden = [];
      for (const ob of [sky, pad, contact, rim, rim && rim.target]) if (ob && ob.parent) ob.parent.remove(ob);
      if (vig && vig.parentNode) vig.parentNode.removeChild(vig);
      scene.traverse((ob) => {
        const ms = ob.material ? (Array.isArray(ob.material) ? ob.material : [ob.material]) : [];
        for (const m of ms) if (m && m.userData && m.userData.studioTone) { m.toneMapped = true; m.needsUpdate = true; delete m.userData.studioTone; }
      });
      if (wallCol && wallOld) { wallCol.array.set(wallOld); wallCol.needsUpdate = true; }
      renderer.toneMapping = before.toneMapping;
      renderer.toneMappingExposure = before.exposure;
      renderer.shadowMap.type = before.shadowType;
      sun.shadow.intensity = before.shadowIntensity;
      sun.shadow.radius = before.shadowRadius;
      renderer.setClearColor(before.clear, 1);
      scene.background.set(before.bg);
      scene.fog.color.set(before.fog);
      for (const r of res) { try { r.dispose(); } catch (_) { /* already gone */ } }
      res.length = 0;
      rim.dispose && rim.dispose();
      sky = pad = contact = vig = null;
    },
  };
}
