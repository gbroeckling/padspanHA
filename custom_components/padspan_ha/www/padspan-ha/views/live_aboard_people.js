// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md, "Beacons, scanners
// and people from photos"): how the people, beacons and scanners PadSpan
// tracks look in the house (P6). The Furnish tab opens it with
// peopleFlow(ctx) in a container of its own; it resolves
// {figures: {"person.x": figure | null}, devices: {"<id>": look}} with only
// what changed (or null), and the tab writes those with its one Save.
//
//   People    each Home Assistant person: a figure made by hand (sliders,
//             with a live preview) or from a photo, or removed. A figure is
//             a few simple shapes, never a likeness. The photo path asks
//             first that the person in the photo agrees (nothing is sent
//             until that is ticked), says which AI Task reads it and
//             recommends a local one, and suggests the sliders for children.
//             A person deleted in Home Assistant takes their figure along
//             (house3d_people.py, on the server); one whose person is only
//             missing from the states shows as not linked, with Remove,
//             and nothing removes it on its own. People are never
//             shared: figures live only in this house's 3D file.
//   Carries   each person's phones and tags, picked from what PadSpan
//             tracks (the live snapshot): picked, they are what places that
//             person in Live Aboard and on the Atlas's map, whatever the
//             names say (live_aboard_tracked.js peopleOf). Kept at once in
//             PadSpan's own settings (atlas_3d_carries), the one place both
//             views read, in this house only: nothing sends it anywhere. A
//             thing picked for two people stays with the first (by their
//             id); the other's row says so.
//   Beacons   the ones the Atlas shows (named, or known to the positioning
//   Scanners  engine), and the scanners placed on the map: a look by hand
//             (the builders' tag and scanner kinds) or from a photo, kept by
//             the id PadSpan tracks it by. A look is
//             {recipe, library_id: null, submission_id: null}; removing one
//             is {recipe: null} (the 3D file keeps a device's height apart:
//             null there is the 3D editor's "default height").
//
// peopleMachine is the screen without a page (tests/js/live_aboard_people.mjs
// runs it); peopleFlow draws it.

const PH = await import(`./live_aboard_photo.js${new URL(import.meta.url).search}`);
const { el, addCss, aiNote, errText, photoButtons, shrinkPhoto, photoKinds } = PH;
const TR = await import(`./live_aboard_tracked.js${new URL(import.meta.url).search}`);

const CMD = "padspan_ha/house3d_from_photo";
export const CONSENT_NEEDED = "Tick that the person in the photo agrees first. Nothing is sent until then.";
const LOCAL_TIP = "For photos of people a local AI Task is best: the photo stays in the house.";
const CHILD_TIP = "For children, use the sliders instead of a photo.";
const LIKENESS = "A figure is a few simple shapes, never a likeness.";
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/** The beacons the Atlas shows (maps.js: named, or known to the engine). */
export function beaconsOf(snapshot){
  const list = snapshot && snapshot.objects && Array.isArray(snapshot.objects.list) ? snapshot.objects.list : [];
  const out = [], seen = new Set();
  for (const o of list) {
    if (!(o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon") || o._ghost) continue;
    if (!(o.user_label || o.identified)) continue;
    const id = o.key || o.address || "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: o.user_label || o.private_ble_name || o.name || id });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** What a person can carry: the tags and phones the Atlas shows (named, or
 *  known to the engine) and the trackers Home Assistant places by room,
 *  [{id, label, where}] by name ("where": its room and when last heard, or
 *  that it is not heard now). */
export function thingsOf(snapshot){
  const list = snapshot && snapshot.objects && Array.isArray(snapshot.objects.list) ? snapshot.objects.list : [];
  const out = [], seen = new Set();
  for (const o of list) {
    if (!o || typeof o !== "object" || o._ghost) continue;
    const ble = o.kind === "ble" || o.kind === "private_ble" || o.kind === "ibeacon";
    if (!(ble && (o.user_label || o.identified)) && o.kind !== "entity") continue;
    const id = String(o.key || o.address || o.entity_id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const room = typeof o.room === "string" && o.room ? o.room : "", heard = TR.seenText(o.age_s);
    const where = o._stale ? "Not heard now" : [room ? `In ${room}` : "", heard].filter(Boolean).join(" · ");
    out.push({ id, label: String(o.user_label || o.private_ble_name || o.name || id), where: where || (o.kind === "entity" ? "A Home Assistant tracker" : "") });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** The scanners placed on the map (model.scanner_positions_m), by address. */
export function scannersOf(model){
  const pos = model && model.scanner_positions_m && typeof model.scanner_positions_m === "object" ? model.scanner_positions_m : {};
  const info = model && model.scanners && typeof model.scanners === "object" ? model.scanners : {};
  return Object.keys(pos).map(id => ({ id, label: info[id] && info[id].room ? `${info[id].room} scanner` : `Scanner ${id}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Home Assistant's people: [{id, name}]. */
export function peopleOf(states){
  return Object.entries(states || {}).filter(([id]) => id.startsWith("person."))
    .map(([id, s]) => ({ id, name: (s && s.attributes && s.attributes.friendly_name) || id.slice(7) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A figure's settings with every default (the builders' FIGURE). */
export function figureDefaults(F){
  const params = {};
  for (const s of F.FIGURE.params) params[s.key] = s.def;
  params.colors = { ...F.FIGURE.colors };
  return params;
}

/** One setting read the builders' way (FIGURE's own lists). */
function clampSetting(s, v){
  if (s.type === "choice") return s.choices.includes(v) ? v : s.def;
  if (s.type === "bool") return typeof v === "boolean" ? v : s.def;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return s.def;
  const c = Math.min(s.max, Math.max(s.min, n));
  return s.type === "int" ? Math.round(c) : c;
}

export function clampFigureParams(F, p){
  const src = p && typeof p === "object" ? p : {};
  const out = {};
  for (const s of F.FIGURE.params) out[s.key] = clampSetting(s, src[s.key]);
  const cols = src.colors && typeof src.colors === "object" ? src.colors : {};
  out.colors = {};
  for (const [k, c] of Object.entries(F.FIGURE.colors)) out.colors[k] = /^#[0-9a-f]{6}$/.test(cols[k]) ? cols[k] : c;
  return out;
}

const GROUP_OF = { beacon: "tag", scanner: "scanner" };
const CARRIES_MAX = 8;                     // things one person carries (ws_settings.CARRIES_MAX_EACH)

export function peopleMachine({ F, callWS, hass, draft = null, settings = null }){
  const m = {
    step: "list", loading: true, devicesLoading: true, error: null, warn: null,
    people: [], beacons: [], scanners: [], things: [], info: null,
    // Who carries what (settings.atlas_3d_carries): saved as soon as it is kept.
    carries: TR.carriesOf(settings && settings.atlas_3d_carries), saving: false,
    file: { figures: {}, devices: {} },
    changes: { figures: {}, devices: {} },
    edit: null, consent: false, photo: null,

    async load(){
      const states = hass && hass.states ? Promise.resolve(hass.states)
        : callWS({ type: "get_states" }).then(list => Object.fromEntries((list || []).map(s => [s.entity_id, s])));
      const [st, got, info] = await Promise.all([
        states.catch(() => ({})),
        callWS({ type: "padspan_ha/house3d_get" }).catch(e => ({ error: errText(e) })),
        callWS({ type: CMD, target: "person" }).catch(e => ({ ready: false, message: errText(e) })),
      ]);
      m.people = peopleOf(st);
      // Furnish's draft (a figure made and not saved yet is there), else the saved file.
      const data = draft || (got && got.data ? got.data : {});
      m.file = { figures: { ...(data.figures || {}) }, devices: { ...(data.devices || {}) } };
      if (got && got.error) m.warn = got.error;
      else if (got && got.writable === false) m.warn = "A newer PadSpan saved Live Aboard's file: changes here can't be saved until PadSpan is updated.";
      m.info = info;
      m.loading = false;
      return m;
    },
    async loadDevices(){
      const [got, model] = await Promise.all([
        callWS({ type: "padspan_ha/live_snapshot" }).catch(() => null),
        callWS({ type: "padspan_ha/model_get" }).catch(() => null),
      ]);
      // live_snapshot answers {snapshot}: read inside it (read whole, the
      // Beacons list was always empty).
      const snap = got && got.snapshot && typeof got.snapshot === "object" ? got.snapshot : got;
      m.beacons = beaconsOf(snap);
      m.things = thingsOf(snap);
      m.scanners = scannersOf(model);
      m.devicesLoading = false;
      return m;
    },

    // What there is now, with the changes made here.
    figureOf(id){ return id in m.changes.figures ? m.changes.figures[id] : (m.file.figures[id] || null); },
    lookOf(id){
      if (id in m.changes.devices) return m.changes.devices[id].recipe || null;
      const e = m.file.devices[id];
      return e && e.recipe ? e.recipe : null;
    },
    unlinked(){
      const ids = new Set([...Object.keys(m.file.figures), ...Object.keys(m.changes.figures)]);
      return [...ids].filter(id => m.figureOf(id) && !m.people.some(p => p.id === id)).sort();
    },
    changed(){ return Object.keys(m.changes.figures).length + Object.keys(m.changes.devices).length; },

    // A figure by hand (also where a photo's figure lands, to adjust).
    editFigure(id, name){
      const f = m.figureOf(id);
      m.edit = { what: "figure", id, name: name || id, params: clampFigureParams(F, f ? f.params : figureDefaults(F)),
                 origin: f ? f.origin : "build" };
      m.error = null;
      m.step = "figure";
    },
    setFigure(key, v){
      if (!m.edit || m.edit.what !== "figure") return;
      if (key.startsWith("colors.")) m.edit.params.colors[key.slice(7)] = v;
      else m.edit.params[key] = v;
      m.edit.params = clampFigureParams(F, m.edit.params);
    },
    keepFigure(){
      if (!m.edit || m.edit.what !== "figure") return;
      m.changes.figures[m.edit.id] = { params: clampFigureParams(F, m.edit.params), origin: m.edit.origin === "photo" ? "photo" : "build" };
      m.back();
    },
    removeFigure(id){
      if (m.file.figures[id]) m.changes.figures[id] = null;
      else delete m.changes.figures[id];
    },

    // A figure from a photo: consent first, then one call.
    photoFigure(id, name){
      m.edit = { what: "figure", id, name: name || id, params: null, origin: "photo" };
      m.consent = false;
      m.photo = null;
      m.error = null;
      m.step = "figphoto";
    },
    setConsent(v){ m.consent = v === true; if (m.consent && m.error === CONSENT_NEEDED) m.error = null; },
    setPhoto(b64){ m.photo = typeof b64 === "string" && b64 ? b64 : null; },
    canRead(){
      const on = m.step === "figphoto" ? m.consent : m.step === "lookphoto";
      return on && !!m.photo && !!(m.info && m.info.ready);
    },
    async read(){
      if (m.step === "figphoto" && !m.consent) { m.error = CONSENT_NEEDED; return m.step; }
      if (!m.canRead()) return m.step;
      const back = m.step, target = back === "figphoto" ? "person" : m.edit.group;
      const photo = m.photo;
      m.photo = null;                       // sent once, then dropped
      m.step = "reading";
      let out;
      try { out = await callWS({ type: CMD, target, photo }); }
      catch (e) { out = { ok: false, message: errText(e) }; }
      if (out && out.ok && back === "figphoto" && out.figure) {
        m.edit = { ...m.edit, params: clampFigureParams(F, out.figure.params), origin: "photo" };
        m.step = "figure";
      } else if (out && out.ok && back === "lookphoto" && out.recipe) {
        m.edit = { ...m.edit, recipe: F.clampRecipe({ ...out.recipe, details: out.details || undefined }) };
        m.step = "look";
      } else {
        m.error = (out && out.message) || "Couldn't read it. Use the sliders instead.";
        m.step = back;
      }
      return m.step;
    },

    // A beacon's or scanner's look.
    kindsFor(group){ return photoKinds(F, [group]); },
    editLook(id, label, which){
      const group = GROUP_OF[which];
      const have = m.lookOf(id);
      const first = m.kindsFor(group)[0];
      m.edit = { what: "look", id, name: label || id, group,
                 recipe: have ? F.clampRecipe(clone(have)) : F.defaultRecipe(first ? first.kind : "other") };
      m.error = null;
      m.step = "look";
    },
    photoLook(id, label, which){
      m.editLook(id, label, which);
      m.photo = null;
      m.step = "lookphoto";
    },
    setLook(key, v){
      if (!m.edit || m.edit.what !== "look") return;
      const r = m.edit.recipe;
      if (key === "kind") m.edit.recipe = F.defaultRecipe(v);
      else if (key.startsWith("colors.")) { r.colors[Number(key.slice(7))] = v; m.edit.recipe = F.clampRecipe(r); }
      else if (key.startsWith("params.")) { r.params[key.slice(7)] = v; m.edit.recipe = F.clampRecipe(r); }
      else { r[key] = v; m.edit.recipe = F.clampRecipe(r); }
    },
    keepLook(){
      if (!m.edit || m.edit.what !== "look") return;
      m.changes.devices[m.edit.id] = { recipe: F.clampRecipe(m.edit.recipe), library_id: null, submission_id: null };
      m.back();
    },
    removeLook(id){
      const e = m.file.devices[id];
      if (e && e.recipe) m.changes.devices[id] = { recipe: null };
      else delete m.changes.devices[id];
    },

    // What a person carries: picked from what PadSpan tracks, kept at once.
    carriesOf(id){ return m.carries[id] || []; },
    /** What was picked for `id` that someone before them (by id) keeps: [{key, keptBy, label, name}]. */
    lostOf(id){
      const owner = TR.carriesOwners(m.carries, [...new Set([...m.people.map(p => p.id), ...Object.keys(m.carries)])]);
      return m.carriesOf(id).filter(k => owner.get(k) !== id).map(k => ({ key: k, keptBy: owner.get(k), label: m.thingName(k),
                                                                          name: (m.people.find(p => p.id === owner.get(k)) || { name: owner.get(k) }).name }));
    },
    thingName(k){ const t = m.things.find(x => x.id === k); return t ? t.label : k; },
    editCarries(id, name){
      m.edit = { what: "carries", id, name: name || id, picked: [...m.carriesOf(id)], filter: "" };
      m.error = null;
      m.step = "carries";
    },
    toggleCarry(key){
      if (!m.edit || m.edit.what !== "carries") return;
      const p = m.edit.picked, i = p.indexOf(key);
      if (i >= 0) p.splice(i, 1); else if (p.length < CARRIES_MAX) p.push(key);
    },
    setFilter(t){ if (m.edit && m.edit.what === "carries") m.edit.filter = String(t || ""); },
    /** The things to pick from, the filter applied; what is picked first. */
    choices(){
      const e = m.edit, f = e ? e.filter.trim().toLowerCase() : "";
      const picked = new Set(e ? e.picked : []), known = new Set(m.things.map(t => t.id));
      const gone = [...picked].filter(k => !known.has(k)).map(k => ({ id: k, label: k, where: "Not heard now" }));
      return [...gone, ...m.things].filter(t => !f || t.label.toLowerCase().includes(f) || picked.has(t.id))
        .sort((a, b) => Number(picked.has(b.id)) - Number(picked.has(a.id)));
    },
    async keepCarries(){
      if (!m.edit || m.edit.what !== "carries" || m.saving) return false;
      const next = { ...m.carries };
      if (m.edit.picked.length) next[m.edit.id] = [...m.edit.picked]; else delete next[m.edit.id];
      m.saving = true;
      try {
        const r = await callWS({ type: "padspan_ha/settings_set", atlas_3d_carries: next });
        m.carries = TR.carriesOf(r && r.settings && r.settings.atlas_3d_carries !== undefined ? r.settings.atlas_3d_carries : next);
        // The host's own copy of the settings: both views draw it at their next read.
        if (settings && typeof settings === "object") settings.atlas_3d_carries = { ...m.carries };
        m.saving = false;
        m.back();
        return true;
      } catch (e) {
        m.saving = false;
        m.error = `Could not save: ${errText(e)}`;
        return false;
      }
    },

    back(){ m.edit = null; m.photo = null; m.consent = false; m.error = null; m.step = "list"; },
    result(){ return { figures: { ...m.changes.figures }, devices: { ...m.changes.devices } }; },
  };
  return m;
}

// ── the page ─────────────────────────────────────────────────────────────────

const CSS = `
.la3d-people .item{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)}
.la3d-people .item .who{flex:1 1 150px;min-width:0}
.la3d-people .item .who small{display:block;color:var(--secondary-text-color,#9aa3ab)}
.la3d-people .item button{padding:6px 10px;min-height:34px}
.la3d-people .changed{color:#f5b041;font-size:12px;margin-left:6px}
.la3d-people .edit{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:14px;align-items:start}
.la3d-people .ctl{display:grid;grid-template-columns:110px minmax(0,1fr) 54px;gap:6px 8px;align-items:center}
.la3d-people .ctl input[type=range]{width:100%}
.la3d-people .ctl input[type=color]{width:46px;height:30px;padding:0;border:none;background:none}
.la3d-people .prev{width:220px;height:260px;border-radius:10px;background:linear-gradient(#69727c,#3b4148);display:flex;align-items:center;justify-content:center}
.la3d-people .prev canvas{width:220px;height:260px}
.la3d-people .la3d-carries{max-height:min(46vh,420px);overflow:auto;margin:8px 0}
.la3d-people .la3d-carries .item{cursor:pointer}
.la3d-people input[type=search]{box-sizing:border-box;width:100%;max-width:360px;padding:7px 9px;border-radius:8px}
@media (max-width:520px){.la3d-people .edit{grid-template-columns:1fr}.la3d-people .prev{justify-self:center}}
`;

/** A small three.js preview, drawn only when what it shows changes. */
function makePreview(F){
  const wrap = el("div", { class: "prev" }, el("span", { class: "muted" }, "Loading the preview…"));
  let THREE = null, R = null, scene = null, camera = null, model = null, want = null, dead = false;
  const draw = () => {
    if (!R || !want) return;
    if (model) { scene.remove(model); try { F.disposePiece(model); } catch { /* shared parts */ } model = null; }
    try { model = want(THREE); } catch { model = null; }
    if (model) {
      scene.add(model);
      // Framed by its bounding sphere in the narrower of the two view angles,
      // from in front, a little to the side and above: a wide flat scanner
      // fits as well as a tall figure.
      const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
      const half = Math.min(THREE.MathUtils.degToRad(camera.fov / 2),
                            Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
      const dist = Math.max(sphere.radius, 0.005) / Math.sin(half) * 1.08;
      camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(0.45, 0.35, 1).normalize(), dist);
      camera.near = dist / 100; camera.far = dist * 10;
      camera.updateProjectionMatrix();
      camera.lookAt(sphere.center);
    }
    R.render(scene, camera);
  };
  (async () => {
    try {
      THREE = await import(`../vendor/three/three.module.min.js${new URL(import.meta.url).search}`);
      if (dead) return;
      const canvas = el("canvas", { width: 220, height: 260 });
      R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      R.setSize(220, 260, false);
      scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3f44, 2.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8);
      sun.position.set(2, 4, 3);
      scene.add(sun);
      camera = new THREE.PerspectiveCamera(32, 220 / 260, 0.01, 100);
      wrap.replaceChildren(canvas);
      draw();
    } catch { wrap.replaceChildren(el("span", { class: "muted" }, "No preview on this screen.")); }
  })();
  return {
    el: wrap,
    show(make){ want = make; draw(); },
    dispose(){
      dead = true;
      if (model) { try { F.disposePiece(model); } catch { /* shared parts */ } }
      if (R) { R.dispose(); if (R.forceContextLoss) R.forceContextLoss(); }
      R = null; model = null;
    },
  };
}

function control(spec, value, onInput){
  const id = `la3d-${spec.key}-${Math.random().toString(36).slice(2, 7)}`;
  const label = el("label", { for: id }, spec.label || spec.key);
  if (spec.type === "choice") {
    const s = el("select", { id }, spec.choices.map(c => { const o = el("option", { value: c }, c); if (c === value) o.selected = true; return o; }));
    s.addEventListener("change", () => onInput(s.value));
    return [label, s, el("span")];
  }
  if (spec.type === "bool") {
    const c = el("input", { id, type: "checkbox", checked: !!value });
    c.addEventListener("change", () => onInput(c.checked));
    return [label, c, el("span")];
  }
  const unit = spec.key.endsWith("_m") ? " m" : "";
  const out = el("span", { class: "muted" }, `${value}${unit}`);
  const r = el("input", { id, type: "range", min: spec.min, max: spec.max, step: spec.step || (spec.type === "int" ? 1 : 0.01), value });
  r.addEventListener("input", () => { out.textContent = `${r.value}${unit}`; onInput(Number(r.value)); });
  return [label, r, out];
}

function colourControl(key, label, value, onInput){
  const c = el("input", { type: "color", value, "aria-label": label });
  c.addEventListener("input", () => onInput(c.value));
  return [el("span", {}, label), c, el("span")];
}

export async function peopleFlow(ctx){
  const F = ctx.recipeTools;
  const call = ctx.callWS || ctx.wsCall;
  const m = peopleMachine({ F, callWS: call, hass: ctx.hass, draft: ctx.draft || null, settings: ctx.settings || null });
  const root = el("div", { class: "la3d-pflow la3d-people" });
  ctx.el.replaceChildren(root);
  addCss(ctx.el);
  addCss(ctx.el, CSS);
  let preview = null, shot = null;

  return new Promise((resolve) => {
    let over = false;
    const finish = (v) => {
      if (over) return;
      over = true;
      if (preview) preview.dispose();
      m.photo = null;
      ctx.el.replaceChildren();
      resolve(v);
    };
    if (ctx.signal) ctx.signal.addEventListener("abort", () => finish(null), { once: true });   // closed by Furnish
    const closePreview = () => { if (preview) { preview.dispose(); preview = null; } };

    const row = (who, sub, changed, ...buttons) => el("div", { class: "item" },
      el("div", { class: "who" }, who, changed ? el("span", { class: "changed" }, "changed") : null, el("small", {}, sub)),
      ...buttons);
    const btn = (label, fn, go) => el("button", { class: go ? "go" : "", onclick: () => { fn(); draw(); } }, label);

    function figureSub(f){ return !f ? "No figure" : f.origin === "photo" ? "Figure from a photo" : "Figure made by hand"; }
    function carriesSub(id){
      const c = m.carriesOf(id);
      return c.length ? `Carries: ${c.map(k => m.thingName(k)).join(", ")}` : "Carries: found by their name and trackers";
    }
    function lookSub(r){ return r ? `Looks like: ${(r.details && r.details.title) || (F.FURNITURE[r.kind] && F.FURNITURE[r.kind].name) || r.kind}` : "The plain marker"; }

    function listScreen(){
      if (m.loading) return [el("h3", {}, "People, beacons and scanners"), el("p", { class: "muted" }, "Loading…")];
      const out = [el("h3", {}, "People, beacons and scanners"),
        el("p", { class: "muted" }, `${LIKENESS} People's figures stay in this house: they are never shared.`)];
      if (ctx.settings && ctx.settings.atlas_3d_people === false) {
        out.push(el("p", { class: "note" }, "Figures show in Live Aboard when Show people is on (Settings → UI Structure → Atlas → Live Aboard)."));
      }
      if (m.warn) out.push(el("p", { class: "warn" }, m.warn));
      out.push(el("h3", {}, "People"));
      if (!m.people.length) out.push(el("p", { class: "muted" }, "Home Assistant has no people yet (Settings → People)."));
      for (const p of m.people) {
        const f = m.figureOf(p.id);
        out.push(row(p.name, [figureSub(f), el("br"), carriesSub(p.id)], p.id in m.changes.figures,
          btn("By hand", () => m.editFigure(p.id, p.name)),
          btn("From a photo", () => m.photoFigure(p.id, p.name)),
          btn("Carries", () => m.editCarries(p.id, p.name)),
          f ? btn("Remove", () => m.removeFigure(p.id)) : null));
        for (const L of m.lostOf(p.id)) out.push(el("p", { class: "warn", "data-carries-lost": p.id }, `${L.label} is picked for ${L.name} too. ${L.name} keeps it, so it doesn't place ${p.name}.`));
      }
      for (const id of m.unlinked()) {
        out.push(row(id, "Not linked: this person isn't in Home Assistant any more", id in m.changes.figures,
          btn("Remove", () => m.removeFigure(id))));
      }
      for (const [title, list, which] of [["Beacons", m.beacons, "beacon"], ["Scanners", m.scanners, "scanner"]]) {
        out.push(el("h3", {}, title));
        if (m.devicesLoading) { out.push(el("p", { class: "muted" }, "Loading…")); continue; }
        if (!m.kindsFor(GROUP_OF[which]).length) { out.push(el("p", { class: "muted" }, "Looks for these come with a later PadSpan.")); continue; }
        if (!list.length) out.push(el("p", { class: "muted" }, which === "beacon" ? "No named beacons yet." : "No scanners placed on the map yet."));
        for (const d of list) {
          const r = m.lookOf(d.id);
          out.push(row(d.label, lookSub(r), d.id in m.changes.devices,
            btn("By hand", () => m.editLook(d.id, d.label, which)),
            btn("From a photo", () => m.photoLook(d.id, d.label, which)),
            r ? btn("Remove look", () => m.removeLook(d.id)) : null));
        }
      }
      const n = m.changed();
      out.push(el("div", { class: "row" },
        el("button", { class: "go", onclick: () => finish(m.result()) }, n ? `Done (${n} change${n === 1 ? "" : "s"})` : "Done"),
        el("button", { onclick: () => finish(null) }, "Cancel")));
      return out;
    }

    function figureScreen(){
      const e = m.edit;
      if (!preview) preview = makePreview(F);
      const show = () => preview.show((T) => F.buildFigure(T, e.params, { quality: "high" }));
      const grid = el("div", { class: "ctl" });
      for (const s of F.FIGURE.params) grid.append(...control(s, e.params[s.key], (v) => { m.setFigure(s.key, v); show(); }));
      for (const [k, c] of Object.entries(e.params.colors)) {
        grid.append(...colourControl(k, (F.FIGURE.colorNames && F.FIGURE.colorNames[k]) || k, c, (v) => { m.setFigure(`colors.${k}`, v); show(); }));
      }
      show();
      return [
        el("h3", {}, `${e.name}'s figure`),
        el("p", { class: "muted" }, e.origin === "photo" ? `Read from the photo; adjust anything. ${LIKENESS}` : LIKENESS),
        el("div", { class: "edit" }, grid, preview.el),
        el("div", { class: "row" },
          el("button", { class: "go", onclick: () => { m.keepFigure(); closePreview(); draw(); } }, "Keep"),
          el("button", { onclick: () => { m.back(); closePreview(); draw(); } }, "Back")),
      ];
    }

    function photoScreen(forPerson){
      const e = m.edit;
      const read = el("button", { class: "go", disabled: !(forPerson ? m.consent && m.photo : m.photo) || !(m.info && m.info.ready),
                                  onclick: () => { const p = m.read(); shot = null; draw(); p.then(draw); } }, "Read it");
      const out = [el("h3", {}, forPerson ? `A figure for ${e.name}, from a photo` : `How ${e.name} looks, from a photo`)];
      if (!(m.info && m.info.ready)) {
        out.push(el("p", { class: "warn" }, (m.info && m.info.message) || "Reading photos isn't set up."),
          el("div", { class: "row" }, el("button", { class: "go", onclick: () => { forPerson ? m.editFigure(e.id, e.name) : m.editLook(e.id, e.name, e.group === "tag" ? "beacon" : "scanner"); draw(); } }, "Use the sliders"),
            el("button", { onclick: () => { m.back(); draw(); } }, "Back")));
        return out;
      }
      if (forPerson) {
        const tick = el("input", { type: "checkbox", checked: m.consent });
        tick.addEventListener("change", () => { m.setConsent(tick.checked); draw(); });
        out.push(el("label", { class: "warn" }, tick, `${e.name}, the person in the photo, agrees to it being read by the AI Task.`),
          el("p", { class: "muted" }, CHILD_TIP + " ", el("button", { onclick: () => { m.editFigure(e.id, e.name); draw(); } }, "Use the sliders")));
      }
      out.push(el("p", { class: "note" }, aiNote(m.info) + (forPerson && m.info.local !== true ? ` ${LOCAL_TIP}` : "")));
      out.push(photoButtons(async (file) => {
        try { const p = await shrinkPhoto(file); m.setPhoto(p.b64); shot = p.url; m.error = null; }
        catch (err) { m.setPhoto(null); shot = null; m.error = errText(err); }
        draw();
      }));
      if (shot) out.push(el("img", { class: "shot", src: shot, alt: "The photo to read" }));
      if (m.error) out.push(el("p", { class: "warn" }, m.error));
      out.push(el("div", { class: "row" }, read, el("button", { onclick: () => { shot = null; m.back(); draw(); } }, "Back")));
      return out;
    }

    /** Carries: tick the phones and tags that are theirs. */
    function carriesScreen(){
      const e = m.edit;
      const find = el("input", { type: "search", value: e.filter, placeholder: "Find a phone or tag", "aria-label": "Find a phone or tag" });
      const list = el("div", { class: "la3d-carries" });
      const paintList = () => {
        const ch = m.choices();
        list.replaceChildren(...(ch.length ? ch.map(t => {
          const tick = el("input", { type: "checkbox", checked: e.picked.includes(t.id) });
          tick.addEventListener("change", () => { m.toggleCarry(t.id); tick.checked = e.picked.includes(t.id); });
          return el("label", { class: "item", "data-carry": t.id }, tick, el("span", { class: "who" }, t.label, el("small", {}, t.where)));
        }) : [el("p", { class: "muted" }, m.devicesLoading ? "Loading…" : "Nothing PadSpan tracks matches.")]));
      };
      find.addEventListener("input", () => { m.setFilter(find.value); paintList(); });
      paintList();
      return [
        el("h3", {}, `What ${e.name} carries`),
        el("p", { class: "muted" }, `Tick the phones and tags that are ${e.name}'s. They place ${e.name} in Live Aboard and on the Atlas's map, whatever the names say. With none ticked, ${e.name} is found by name and trackers, as before. This stays in this house: it is never sent anywhere.`),
        find, list,
        m.error ? el("p", { class: "warn" }, m.error) : null,
        el("p", { class: "muted" }, "Keep saves it straight away (it isn't part of Done and Save)."),
        el("div", { class: "row" },
          el("button", { class: "go", disabled: m.saving, onclick: () => { m.keepCarries().then(draw); draw(); } }, m.saving ? "Saving…" : "Keep"),
          el("button", { onclick: () => { m.back(); draw(); } }, "Back")),
      ];
    }

    function lookScreen(){
      const e = m.edit, r = e.recipe, def = F.FURNITURE[r.kind];
      if (!preview) preview = makePreview(F);
      const show = () => preview.show((T) => F.buildPiece(T, e.recipe, { quality: "high" }));
      const grid = el("div", { class: "ctl" });
      const kinds = m.kindsFor(e.group);
      if (kinds.length > 1) {
        const s = el("select", {}, kinds.map(k => { const o = el("option", { value: k.kind }, k.name); if (k.kind === r.kind) o.selected = true; return o; }));
        s.addEventListener("change", () => { m.setLook("kind", s.value); draw(); });
        grid.append(el("span", {}, "Kind"), s, el("span"));
      }
      for (const s of (def && def.params) || []) grid.append(...control(s, r.params[s.key], (v) => { m.setLook(`params.${s.key}`, v); show(); }));
      (r.colors || []).forEach((c, i) => grid.append(...colourControl(String(i), (def && def.colorNames && def.colorNames[i]) || `Colour ${i + 1}`, c,
        (v) => { m.setLook(`colors.${i}`, v); show(); })));
      for (const [d, label] of PH.DIMS) {
        const range = def && def.size && def.size[d];
        grid.append(...control({ key: d, label, type: "num", min: range ? range[0] : 0.005, max: range ? range[1] : 1, step: 0.005 },
          r[d], (v) => { m.setLook(d, v); show(); }));
      }
      show();
      return [
        el("h3", {}, `How ${e.name} looks`),
        el("div", { class: "edit" }, grid, preview.el),
        el("div", { class: "row" },
          el("button", { class: "go", onclick: () => { m.keepLook(); closePreview(); draw(); } }, "Keep"),
          el("button", { onclick: () => { m.back(); closePreview(); draw(); } }, "Back")),
      ];
    }

    const screens = {
      list: listScreen,
      figure: figureScreen,
      figphoto: () => photoScreen(true),
      lookphoto: () => photoScreen(false),
      look: lookScreen,
      carries: carriesScreen,
      reading: () => [el("h3", {}, "Reading the photo"),
        el("p", {}, el("span", { class: "busy" }), `${(m.info && m.info.name) || "The AI Task"} is reading it. On a home computer this can take a minute or two.`)],
    };

    function draw(){
      if (over) return;
      root.replaceChildren(...screens[m.step]().filter(Boolean));
    }

    draw();
    m.load().then(() => { draw(); return m.loadDevices(); }).then(draw).catch((e) => { m.loading = false; m.warn = errText(e); draw(); });
  });
}
