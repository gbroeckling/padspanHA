// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
//
// Live Aboard, the 3D house (docs/IDEA_ATLAS_3D_HOUSE.md, "From a photo"):
// a piece of furniture from a photo, read by the customer's own Home
// Assistant AI Task (P3). The Furnish tab opens it with photoFlow(ctx)
// (contracts §4) in a container of its own, and it resolves
// {recipe, details} for the tab's draft, or null.
//
//   check     which AI Task reads photos (house3d_from_photo, no photo).
//             None set up: what is needed (Home Assistant 2025.8 or newer,
//             an AI Task chosen in Settings → 3D house), and Build instead.
//   pick      what it is (or "let the AI say"), take or pick a photo, the
//             tip to get a tape measure, a door frame or a standard chair in
//             the shot, and which AI Task will read it: a cloud one means the
//             photo leaves the house. The photo is made smaller here first,
//             which also drops what the camera wrote into it (its location
//             among it), and it is sent only when Read it is pressed.
//   reading   one call. Nothing keeps the photo, here or on the server.
//   failed    the plain "couldn't read it", then Build with the kind picked,
//             a box, or try again.
//   measure   one real measurement (Garry's choice 9): the AI's own size is
//             taken only when it was sure (something of known size was in
//             the shot); otherwise type one size, usually the width, or keep
//             the builder's, and the other two follow the photo's
//             proportions.
//
// photoMachine is the flow without a page (tests/js/live_aboard_photo.mjs
// runs it); photoFlow draws it. Shared with the people screen
// (live_aboard_people.js): the photo shrink, the AI Task note, the styles.

const CMD = "padspan_ha/house3d_from_photo";
const GROUPS = ["furniture", "device"];
const BOX = "other";
export const DIMS = [["width_m", "Width"], ["depth_m", "Depth"], ["height_m", "Height"]];
export const PHOTO_MAX_PX = 1280;
const SETTINGS_WHERE = "Settings → UI Structure → Atlas → 3D house";
const NEEDS = "Reading photos needs Home Assistant 2025.8 or newer, with an AI Task that can read pictures "
  + `(one with a vision model), chosen in ${SETTINGS_WHERE}.`;

export const errText = (e) => String((e && (e.message || e.code)) || e || "Something went wrong.");
const m2 = (v) => `${Number(v).toFixed(2)} m`;

/** The kinds a photo can be read as, in the Build menu's order: [{kind, name}]. */
export function photoKinds(F, groups = GROUPS){
  const menu = Array.isArray(F.FURNITURE_KINDS) ? F.FURNITURE_KINDS : [];
  const all = [...menu, ...Object.keys(F.FURNITURE || {}).filter(k => !menu.includes(k))];
  return all.filter(k => k !== BOX && groups.includes(F.FURNITURE[k]?.group))
    .map(k => ({ kind: k, name: F.FURNITURE[k].name || k }));
}

/** Which AI Task reads the photo, and whether the photo leaves the house. */
export function aiNote(info){
  const name = (info && info.name) || "The AI Task";
  const where = info && info.local === true ? "It runs in your home, so the photo stays in the house."
    : info && info.local === false ? "It runs in the cloud: the photo leaves the house for that service."
    : "If it runs in the cloud, the photo leaves the house for that service.";
  return `${name} will read the photo. ${where} PadSpan never keeps the photo.`;
}

/** The AI's own size is taken only when it was sure and gave all three. */
export function sizeTrusted(size){
  return !!size && size.confidence === "high"
    && DIMS.every(([d]) => typeof size[d] === "number" && Number.isFinite(size[d]) && size[d] > 0);
}

/** One real measurement: `dim` is `value` metres (none: the builder's own
 * size for it), and the other two follow the photo's proportions (where the
 * photo gave none, the builder's). Clamped the builders' way. */
export function measured(F, recipe, size, dim, value){
  const def = F.defaultRecipe(recipe.kind);
  const base = {};
  for (const [d] of DIMS) base[d] = typeof size?.[d] === "number" && size[d] > 0 ? size[d] : def[d];
  const v = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : def[dim];
  const k = v / base[dim];
  const out = { ...recipe };
  for (const [d] of DIMS) out[d] = Math.round((d === dim ? v : base[d] * k) * 1000) / 1000;   // to the millimetre
  return F.clampRecipe(out);
}

/** A typed size: "2.1", "2,1", "210 cm", "2.1 m" → metres, or null. */
export function readSize(text){
  const t = String(text ?? "").trim().toLowerCase().replace(",", ".");
  const mm = /^(\d+(?:\.\d+)?)\s*(m|cm|mm)?$/.exec(t);
  if (!mm) return null;
  const v = Number(mm[1]) / ({ cm: 100, mm: 1000 }[mm[2]] || 1);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** The furniture photo flow, without a page. Each call to read() sends the
 * photo once; nothing else ever sends it. */
export function photoMachine({ F, callWS }){
  const m = {
    step: "check", info: null, kind: null, photo: null, answer: null, error: null,
    recipe: null, details: null,
    async check(){
      try { m.info = await callWS({ type: CMD, target: "furniture" }); }
      catch (e) { m.info = { ready: false, message: errText(e) }; }
      m.step = m.info && m.info.ready ? "pick" : "noai";
      return m.step;
    },
    choose(kind){ m.kind = kind && F.FURNITURE[kind] && kind !== BOX ? kind : null; },
    setPhoto(b64){ m.photo = typeof b64 === "string" && b64 ? b64 : null; },
    canRead(){ return (m.step === "pick" || m.step === "failed") && !!m.photo; },
    async read(){
      if (!m.canRead()) return m.step;
      m.step = "reading";
      m.error = null;
      const msg = { type: CMD, target: "furniture", photo: m.photo };
      if (m.kind) msg.kind = m.kind;
      let out;
      try { out = await callWS(msg); }
      catch (e) { out = { ok: false, reason: e && e.code === "no_ai_task" ? "no_ai_task" : "error", message: errText(e) }; }
      m.answer = out || { ok: false, reason: "error" };
      if (m.answer.ok && m.answer.recipe) {
        m.recipe = m.answer.recipe;
        m.details = m.answer.details || null;
        m.step = "measure";
      } else {
        m.error = m.answer.message || "Couldn't read it. Build it with the sliders instead.";
        if (m.answer.reason === "no_ai_task") { m.info = { ready: false, message: m.error }; m.step = "noai"; }
        else m.step = "failed";
        if (!m.kind && m.answer.kind && F.FURNITURE[m.answer.kind]) m.kind = m.answer.kind;
      }
      return m.step;
    },
    retry(){ if (m.step === "failed") m.step = "pick"; },
    accept(){
      if (m.step !== "measure" || !sizeTrusted(m.answer.size)) return null;
      m.step = "done";
      return m.result();
    },
    measure(dim, value){
      if (m.step !== "measure" || !DIMS.some(([d]) => d === dim)) return null;
      if (value !== null && !(typeof value === "number" && value > 0)) return null;
      m.recipe = measured(F, m.answer.recipe, m.answer.size, dim, value);
      m.step = "done";
      return m.result();
    },
    /** Build instead: the builder's own piece, or a box when there is no kind. */
    build(kind){
      m.recipe = F.defaultRecipe(kind && F.FURNITURE[kind] ? kind : BOX);
      m.details = null;
      m.step = "done";
      return m.result();
    },
    result(){ return m.step === "done" ? { recipe: m.recipe, details: m.details } : null; },
    drop(){ m.photo = null; },
  };
  return m;
}

// ── the page ─────────────────────────────────────────────────────────────────

export const CSS = `
.la3d-flow{display:flex;flex-direction:column;gap:12px;padding:14px;max-width:560px;box-sizing:border-box;
  color:var(--primary-text-color,#e8eaed);background:var(--card-background-color,#1f2327);border-radius:12px;
  font-size:14px;line-height:1.45}
.la3d-flow h3{margin:0;font-size:17px;font-weight:600}
.la3d-flow p{margin:0}
.la3d-flow .muted{color:var(--secondary-text-color,#9aa3ab);font-size:13px}
.la3d-flow .note{padding:8px 10px;border-radius:8px;background:rgba(127,151,173,.14);font-size:13px}
.la3d-flow .warn{padding:8px 10px;border-radius:8px;background:rgba(245,176,65,.16);font-size:13px}
.la3d-flow .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.la3d-flow button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.18);
  background:rgba(255,255,255,.06);color:inherit;cursor:pointer;min-height:38px}
.la3d-flow button.go{background:var(--primary-color,#03a9f4);border-color:transparent;color:#fff;font-weight:600}
.la3d-flow button:disabled{opacity:.4;cursor:default}
.la3d-flow select,.la3d-flow input[type=text],.la3d-flow input[type=number]{box-sizing:border-box;font:inherit;padding:7px 9px;border-radius:8px;
  border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.18);color:inherit;min-height:36px;max-width:100%}
.la3d-flow label{display:flex;gap:8px;align-items:center}
.la3d-flow .shot{max-width:100%;max-height:240px;border-radius:8px;align-self:flex-start;object-fit:contain}
.la3d-flow .swatch{display:inline-block;width:22px;height:22px;border-radius:6px;border:1px solid rgba(255,255,255,.3)}
.la3d-flow .file{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.la3d-flow .busy{display:inline-block;width:14px;height:14px;border-radius:50%;border:2px solid currentColor;
  border-right-color:transparent;animation:la3dspin .9s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes la3dspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.la3d-flow .busy{animation:none}}
`;

export function addCss(){
  if (typeof document === "undefined" || document.getElementById("la3d-flow-css")) return;
  const s = document.createElement("style");
  s.id = "la3d-flow-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** A small element: el("button", {class: "go", onclick}, "Read it"). */
export function el(tag, attrs, ...kids){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "class") n.className = v;
    else if (k === "value" || k === "checked") n[k] = v;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

/** Two buttons for one photo: Take (the camera) and Pick (the library). */
export function photoButtons(onFile){
  const take = el("input", { type: "file", accept: "image/*", capture: "environment", class: "file" });
  const pick = el("input", { type: "file", accept: "image/*", class: "file" });
  for (const i of [take, pick]) i.addEventListener("change", () => { const f = i.files && i.files[0]; i.value = ""; if (f) onFile(f); });
  return el("div", { class: "row" }, take, pick,
    el("button", { onclick: () => take.click() }, "Take a photo"),
    el("button", { onclick: () => pick.click() }, "Pick a photo"));
}

/** A photo made smaller (≤ PHOTO_MAX_PX on its long side) as a JPEG, which
 * also leaves out what the camera wrote into the file (where it was taken
 * among it): {b64, url}. Throws a plain message when it can't be opened. */
export async function shrinkPhoto(file, max = PHOTO_MAX_PX){
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await new Promise((ok, no) => {
      const u = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(u); ok(img); };
      img.onerror = () => { URL.revokeObjectURL(u); no(new Error("This photo can't be opened here. Take a new one, or pick a JPEG or PNG.")); };
      img.src = u;
    });
  }
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const k = Math.min(1, max / Math.max(w, h, 1));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(w * k));
  cv.height = Math.max(1, Math.round(h * k));
  cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
  if (typeof src.close === "function") src.close();
  const url = cv.toDataURL("image/jpeg", 0.85);
  return { b64: url.slice(url.indexOf(",") + 1), url };
}

function kindSelect(kinds, value, first){
  return el("select", { "aria-label": "What it is" },
    el("option", { value: "" }, first),
    kinds.map(k => { const o = el("option", { value: k.kind }, k.name); if (k.kind === value) o.selected = true; return o; }));
}

export async function photoFlow(ctx){
  const F = ctx.recipeTools;
  const call = ctx.callWS || ctx.wsCall;
  const m = photoMachine({ F, callWS: call });
  const kinds = photoKinds(F);
  addCss();
  const root = el("div", { class: "la3d-flow la3d-photo" });
  ctx.el.replaceChildren(root);
  let shot = null;          // the shrunk photo's data URL, for the preview only
  let fileErr = "";

  return new Promise((resolve) => {
    let over = false;
    const finish = (v) => {
      if (over) return;
      over = true;
      m.drop();
      shot = null;
      ctx.el.replaceChildren();
      resolve(v);
    };
    const nameOf = (k) => (k && F.FURNITURE[k] && F.FURNITURE[k].name) || "piece";
    const cancel = () => el("button", { onclick: () => finish(null) }, "Cancel");

    const buildRow = (label) => {
      const sel = kindSelect(kinds, m.kind, "A box");
      return el("div", { class: "row" }, sel, el("button", { class: "go", onclick: () => finish(m.build(sel.value || null)) }, label));
    };

    const screens = {
      check: () => [el("h3", {}, "From a photo"), el("p", { class: "muted" }, el("span", { class: "busy" }), "Checking which AI Task reads photos…"), el("div", { class: "row" }, cancel())],
      noai: () => [
        el("h3", {}, "Reading photos isn't set up"),
        el("p", {}, m.info && m.info.message ? m.info.message : NEEDS),
        el("p", {}, "Build it with the sliders instead:"),
        buildRow("Build"),
        el("div", { class: "row" }, cancel()),
      ],
      pick: () => {
        const sel = kindSelect(kinds, m.kind, "Not sure: let the AI say");
        sel.addEventListener("change", () => m.choose(sel.value || null));
        const read = el("button", { class: "go", disabled: !m.canRead(), onclick: () => { const p = m.read(); draw(); p.then(draw); } }, "Read it");
        return [
          el("h3", {}, "From a photo"),
          el("label", {}, "What is it?", sel),
          el("p", { class: "muted" }, "For the size, get a tape measure, a door frame or a standard chair in the shot."),
          photoButtons(async (file) => {
            fileErr = "";
            try { const p = await shrinkPhoto(file); m.setPhoto(p.b64); shot = p.url; }
            catch (e) { m.setPhoto(null); shot = null; fileErr = errText(e); }
            draw();
          }),
          shot ? el("img", { class: "shot", src: shot, alt: "The photo to read" }) : null,
          fileErr ? el("p", { class: "warn" }, fileErr) : null,
          el("p", { class: "note" }, aiNote(m.info)),
          el("div", { class: "row" }, read, cancel()),
        ];
      },
      reading: () => [
        el("h3", {}, "Reading the photo"),
        el("p", {}, el("span", { class: "busy" }), `${(m.info && m.info.name) || "The AI Task"} is reading it. On a home computer this can take a minute or two.`),
        el("div", { class: "row" }, cancel()),
      ],
      failed: () => [
        el("h3", {}, "Couldn't read it"),
        el("p", {}, m.error),
        m.kind ? el("div", { class: "row" }, el("button", { class: "go", onclick: () => finish(m.build(m.kind)) }, `Build a ${nameOf(m.kind).toLowerCase()} instead`)) : buildRow("Build"),
        el("div", { class: "row" },
          el("button", { onclick: () => finish(m.build(null)) }, "Use a box"),
          el("button", { onclick: () => { m.retry(); draw(); } }, "Try again"),
          cancel()),
      ],
      measure: () => measureScreen(),
    };

    function measureScreen(){
      const a = m.answer, size = a.size || {};
      const r = a.recipe;
      const read = DIMS.every(([d]) => typeof size[d] === "number")
        ? `The photo reads about ${DIMS.map(([d]) => m2(size[d])).join(" × ")} (width × depth × height).`
        : "The photo didn't give its size.";
      const which = el("select", { "aria-label": "Which size" }, DIMS.map(([d, label]) => el("option", { value: d }, label)));
      const box = el("input", { type: "text", inputmode: "decimal", placeholder: "e.g. 2.1 or 210 cm", "aria-label": "The size, in metres", size: 14 });
      const msg = el("p", { class: "warn", hidden: true });
      const def = F.defaultRecipe(r.kind);
      const keep = el("button", { onclick: () => finish(m.measure(which.value, null)) }, "");
      const sayKeep = () => { keep.textContent = `Keep the builder's ${DIMS.find(([d]) => d === which.value)[1].toLowerCase()}: ${m2(def[which.value])}`; };
      which.addEventListener("change", sayKeep);
      sayKeep();
      const use = () => {
        const v = readSize(box.value);
        if (v === null) { msg.hidden = false; msg.textContent = "Type a size in metres, like 2.1 (or 210 cm)."; return; }
        finish(m.measure(which.value, v));
      };
      box.addEventListener("keydown", (e) => { if (e.key === "Enter") use(); });
      const trusted = sizeTrusted(size);
      return [
        el("h3", {}, `It looks like a ${nameOf(r.kind).toLowerCase()}`),
        el("div", { class: "row" }, (r.colors || []).map(c => el("span", { class: "swatch", title: c, style: `background:${c}` })),
          a.details && a.details.title ? el("span", { class: "muted" }, a.details.title) : null),
        el("p", {}, read),
        trusted ? el("p", { class: "note" }, "It was measured against something of known size in the shot.") : null,
        trusted ? el("div", { class: "row" }, el("button", { class: "go", onclick: () => finish(m.accept()) }, "Use these sizes")) : null,
        el("p", {}, trusted ? "Or type one real size:" : "Type one real size (usually the width). The other two follow the photo."),
        el("div", { class: "row" }, which, box, el("button", { class: trusted ? "" : "go", onclick: use }, "Use this size")),
        msg,
        el("div", { class: "row" }, keep, cancel()),
      ];
    }

    function draw(){
      if (over) return;
      root.replaceChildren(...screens[m.step]().filter(Boolean));
    }

    draw();
    m.check().then(draw);
  });
}
