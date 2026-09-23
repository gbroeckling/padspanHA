// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
// See LICENSE file or https://www.gnu.org/licenses/gpl-3.0.html
/**
 * The WLED workbench's shared look and small widgets. The card lives on
 * document.body, outside every shadow root, so everything is styled inline.
 */

export const C = {
  text: "#e2e8f0", dim: "#94a3b8", faint: "#64748b", green: "#52b788", mint: "#8ee5b4",
  amber: "#fbbf24", red: "#f87171", purple: "#c084fc", line: "rgba(120,190,155,.22)",
  panel: "rgba(255,255,255,.035)",
};
export const S = {
  lbl: `font-size:11px;color:${C.dim};text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px`,
  btn: `background:rgba(255,255,255,.05);border:1px solid ${C.line};border-radius:8px;color:${C.text};`
    + "font-size:12px;cursor:pointer;padding:5px 10px;white-space:nowrap",
  btnOn: `background:rgba(192,132,252,.16);border:1px solid ${C.purple};border-radius:8px;color:${C.purple};`
    + "font-size:12px;cursor:pointer;padding:5px 10px;font-weight:700;white-space:nowrap",
  btnPrimary: "background:linear-gradient(135deg,#166534,#22c55e);border:1px solid rgba(255,255,255,.2);border-radius:8px;"
    + "color:#fff;font-size:12px;cursor:pointer;padding:6px 12px;font-weight:700;white-space:nowrap",
  input: `background:rgba(15,26,18,.9);color:${C.mint};border:1px solid ${C.line};border-radius:6px;padding:4px 6px;font-size:12px`,
  card: `background:${C.panel};border:1px solid ${C.line};border-radius:10px;padding:10px;margin-bottom:10px`,
  chip: (col) => `display:inline-block;font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid ${col};color:${col};margin-left:6px`,
};

export function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of Array.isArray(children) ? children : [children]) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
export const slider = (value, max, onChange, min = 0) => {
  const r = document.createElement("input");
  r.type = "range"; r.min = String(min); r.max = String(max); r.value = String(value ?? 0);
  r.style.cssText = `width:100%;accent-color:${C.purple};cursor:pointer`;
  r.addEventListener("change", () => onChange(parseInt(r.value, 10)));
  return r;
};
export const numberBox = (value, onChange, { min = 0, max = 65535, width = 64, step = 1 } = {}) => {
  const i = document.createElement("input");
  i.type = "number"; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(value ?? 0);
  i.style.cssText = S.input + `;width:${width}px`;
  i.addEventListener("change", () => {
    const v = step < 1 ? parseFloat(i.value) : parseInt(i.value, 10);
    onChange(Math.max(min, Math.min(max, Number.isFinite(v) ? v : 0)));
  });
  return i;
};
export const textBox = (value, onChange, { width = 180, placeholder = "", maxlength } = {}) => {
  const i = document.createElement("input");
  i.value = value ?? ""; i.placeholder = placeholder;
  if (maxlength) i.maxLength = maxlength;
  i.style.cssText = S.input + `;width:${width}px`;
  i.addEventListener("change", () => onChange(i.value));
  return i;
};
export const check = (label, value, onChange, title) => {
  const c = document.createElement("input");
  c.type = "checkbox"; c.checked = !!value;
  c.addEventListener("change", () => onChange(c.checked));
  return h("label", { style: `display:inline-flex;align-items:center;gap:5px;font-size:12px;color:${C.text};margin-right:12px;cursor:pointer`, title },
    [c, label]);
};
export const select = (options, value, onChange, width) => {
  const sel = document.createElement("select");
  sel.style.cssText = S.input + (width ? `;width:${width}` : "");
  for (const [v, label] of options) {
    const o = document.createElement("option"); o.value = String(v); o.textContent = label;
    if (String(v) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    const opt = options.find(([v]) => String(v) === sel.value);
    onChange(opt ? opt[0] : sel.value);
  });
  return sel;
};
export const field = (label, node, title) => h("div", { title }, [h("div", { style: S.lbl }, label), node]);
export const errText = (e) => String((e && (e.message || e.code)) || e);

/** After a config write: say it's saved, and name anything that changed
 * without being asked for (ws_wled.py 'unexpected' — round 5). */
export function reportCfg(ctx, r, label) {
  const odd = ((r && r.unexpected) || []).filter(p => !p.startsWith("nw.") && !p.startsWith("ap."));
  ctx.toast(`${label} (a backup was taken first)` + (odd.length ? ` — but these changed too: ${odd.slice(0, 5).join(", ")}` : ""), odd.length > 0);
}

/** The first unused preset slot (1-250). */
export function firstFreePreset(presets) {
  for (let i = 1; i <= 250; i++) if (!presets || !presets[String(i)]) return i;
  return 250;
}

/** Hand the viewer a JSON file to keep. */
export function downloadJson(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
  const a = h("a", { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
