// PadSpan HA — BLE Room-Presence Tracking for Home Assistant
// Copyright (C) 2026 Garry Broeckling
// Licensed under the GNU General Public License v3.0
//
// Settings → UI Structure → 📺 Wall screens: how big a wall screen (the
// sidebar Atlas on ?kiosk=1) draws PadSpan, for the room it hangs in. The
// numbers are views/wall_scale.js's, the same the wall uses. Everything
// saves the moment it changes, straight to the wire (not settingsSet, which
// would rebuild Settings under the slider).

const WALLS = await import(`./wall_scale.js${new URL(import.meta.url).search}`);

const ft = (m) => { const inch = Math.round(m / 0.0254); return `${Math.floor(inch / 12)} ft ${inch % 12} in`; };
const cm = (inch) => `${Math.round(inch * 2.54)} cm`;

/** The room from the side: the screen (its height, a 16:9 screen) and someone
 *  standing at the viewing distance, to one scale, with the sight lines. */
function sideView(inches, meters){
  const H = inches * 0.0254 * 0.49, W = 300, Hpx = 64, eye = 1.6, top = 1.0 + H;   // screen hung with its foot at 1 m
  const span = Math.max(meters + 0.6, 1.5), k = Math.min((W - 30) / span, (Hpx - 8) / Math.max(top, eye + 0.2));
  const sx = 14, base = Hpx - 4, px = sx + meters * k;
  const y = (m) => (base - m * k).toFixed(1);
  return `<svg width="${W}" height="${Hpx}" viewBox="0 0 ${W} ${Hpx}" style="display:block;margin-top:8px" role="img" aria-label="Seen from the side">
    <line x1="4" y1="${base}" x2="${W - 4}" y2="${base}" stroke="#2d4a38"/>
    <rect x="${sx - 3}" y="${y(top)}" width="4" height="${(H * k).toFixed(1)}" fill="#52b788"/>
    <line x1="${px.toFixed(1)}" y1="${y(eye)}" x2="${sx}" y2="${y(top)}" stroke="#64748b" stroke-dasharray="3 3"/>
    <line x1="${px.toFixed(1)}" y1="${y(eye)}" x2="${sx}" y2="${y(1.0)}" stroke="#64748b" stroke-dasharray="3 3"/>
    <circle cx="${px.toFixed(1)}" cy="${y(eye + 0.12)}" r="${Math.max(2.5, 0.12 * k).toFixed(1)}" fill="#cbd5e1"/>
    <line x1="${px.toFixed(1)}" y1="${y(eye)}" x2="${px.toFixed(1)}" y2="${y(0.9)}" stroke="#cbd5e1" stroke-width="2"/>
    <line x1="${px.toFixed(1)}" y1="${y(0.9)}" x2="${(px - 0.18 * k).toFixed(1)}" y2="${base}" stroke="#cbd5e1" stroke-width="2"/>
    <line x1="${px.toFixed(1)}" y1="${y(0.9)}" x2="${(px + 0.18 * k).toFixed(1)}" y2="${base}" stroke="#cbd5e1" stroke-width="2"/>
    <text x="${((sx + px) / 2).toFixed(1)}" y="${base - 3}" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="10" fill="#94a3b8">${meters.toFixed(1)} m</text>
  </svg>`;
}

/** The card. `ctx` the panel's, `el` Settings' element helper, `settings` the house's. */
export function wallCard(ctx, el, settings){
  const s = settings || {};
  const pro = String(s.tier || "").toLowerCase() === "pro";
  const card = el("div", { class: "card", style: "padding:16px;margin-top:20px" });
  card.appendChild(el("div", { style: "font-weight:700;font-size:14px;color:#52b788;margin-bottom:6px" }, "📺 Wall screens"));
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin-bottom:12px;line-height:1.55" },
    "A screen showing the Atlas page as /padspan-lights?kiosk=1 is a wall: the whole house fits on it, and its controls, room names " +
    "and rain are drawn for the room it hangs in. Tell PadSpan how big the screen is and how far away people usually are, and text is " +
    "sized the way control rooms size it: by how big it looks from there, not by how many pixels the screen has."));
  if (!pro || !s.atlas_layout_v2) {
    card.appendChild(el("div", { style: "font-size:12px;color:#fbbf24;line-height:1.5" },
      !pro ? "Wall screens come with PadSpan Pro (Settings → Features → PadSpan licence), on the Atlas's new layout."
           : "Wall screens need the Atlas's new layout: Mapping → Atlas → ▦ New layout."));
    return card;
  }

  // ── state ──
  const v = {
    mode: Number(s.wall_screen_in) > 0 ? "room" : "auto",
    inches: Number(s.wall_screen_in) > 0 ? Number(s.wall_screen_in) : 55,
    meters: Number(s.wall_distance_m) > 0 ? Number(s.wall_distance_m) : 2.5,
    arcmin: Number(s.wall_text_arcmin) > 0 ? Number(s.wall_text_arcmin) : 20,
    dim: Number(s.wall_night_dim) || 0,
    shift: !!s.wall_pixel_shift,
  };
  const note = el("div", { style: "font-size:11px;color:#94a3b8;margin-top:10px" }, "Saves as soon as you change it. Wall screens follow within half a minute.");
  const save = async (patch, undo) => {
    try {
      const r = await ctx.actions.wsCall("padspan_ha/settings_set", patch);
      if (r && r.settings && ctx.state) ctx.state.settings = r.settings;
      note.textContent = "Saved. Wall screens follow within half a minute.";
    } catch (e) {
      if (undo) undo();
      ctx.toast("Could not save: " + String((e && e.message) || e), true);
    }
  };

  // ── the mode: from the screen's pixels, or for the room ──
  const seg = el("div", { class: "row", style: "gap:6px;margin-bottom:12px;flex-wrap:wrap" });
  const modeBtn = (val, label) => {
    const b = el("button", { class: "btn inline" + (v.mode === val ? " on" : ""), type: "button" }, label);
    b.addEventListener("click", () => {
      if (v.mode === val) return;
      v.mode = val;
      for (const x of seg.children) x.classList.toggle("on", x === b);
      room.style.display = val === "room" ? "" : "none";
      paint();
      save({ wall_screen_in: val === "room" ? v.inches : 0 });
    });
    return b;
  };
  seg.appendChild(modeBtn("auto", "Size from the screen"));
  seg.appendChild(modeBtn("room", "Size for my room"));
  card.appendChild(seg);

  // ── a slider row ──
  const slider = (label, min, max, step, get, set, fmt, key, toStored) => {
    const range = el("input", { type: "range", min: String(min), max: String(max), step: String(step), style: "flex:1 1 180px;min-width:160px" });
    range.value = String(get());
    const val = el("span", { style: "color:#e2e8f0;font-size:13px;font-variant-numeric:tabular-nums;min-width:150px" }, fmt(get()));
    range.addEventListener("input", () => { set(Number(range.value)); val.textContent = fmt(get()); paint(); });
    range.addEventListener("change", () => { const was = get(); save({ [key]: toStored ? toStored(get()) : get() }, () => { set(was); }); });
    return el("div", { style: "display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin:6px 0" }, [
      el("span", { style: "color:#cbd5e1;font-size:13px;min-width:130px" }, label), range, val,
    ]);
  };

  const room = el("div", { style: v.mode === "room" ? "" : "display:none" });
  const sizeRow = slider("Screen size", 10, 110, 1, () => v.inches, (x) => { v.inches = x; },
    (x) => `${Math.round(x)}" (${cm(x)})`, "wall_screen_in");
  const distRow = slider("Viewing distance", 0.3, 8, 0.1, () => v.meters, (x) => { v.meters = x; },
    (x) => `${x.toFixed(1)} m (${ft(x)})`, "wall_distance_m");
  // One tap for the usual screens; the sliders fine-tune from there.
  const PRESETS = [["Desk monitor", 27, 0.7], ["Kitchen tablet", 11, 0.5], ["Hallway screen", 32, 1.5],
                   ["Living-room TV", 55, 3], ["Big TV", 65, 3.5]];
  const presets = el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin:0 0 6px" });
  for (const [name, inches, meters] of PRESETS) {
    const b = el("button", { class: "btn inline", type: "button", style: "font-size:12px", title: `${inches}" at ${meters} m` }, name);
    b.addEventListener("click", () => {
      v.inches = inches; v.meters = meters;
      sizeRow.querySelector("input").value = String(inches); sizeRow.lastChild.textContent = `${inches}" (${cm(inches)})`;
      distRow.querySelector("input").value = String(meters); distRow.lastChild.textContent = `${meters.toFixed(1)} m (${ft(meters)})`;
      paint();
      save({ wall_screen_in: inches, wall_distance_m: meters });
    });
    presets.appendChild(b);
  }
  room.appendChild(presets);
  room.appendChild(sizeRow);
  room.appendChild(distRow);
  card.appendChild(room);
  card.appendChild(slider("Text size", 16, 28, 1, () => v.arcmin, (x) => { v.arcmin = x; },
    (x) => `${WALLS.textWord(x)} (${Math.round(x)}′)`, "wall_text_arcmin"));

  // ── the preview: a 4K screen drawn to scale, and what it comes to ──
  const preview = el("div", { style: "display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;margin:10px 0 4px" });
  const pic = el("div", { style: "flex:0 0 auto" });
  const facts = el("div", { style: "flex:1 1 220px;font-size:12px;color:#cbd5e1;line-height:1.7" });
  preview.appendChild(pic); preview.appendChild(facts);
  card.appendChild(preview);

  // ── night and burn-in ──
  card.appendChild(slider("Dim at night", 0, 70, 5, () => Math.round(v.dim * 100), (x) => { v.dim = x / 100; },
    (x) => (x > 0 ? `${Math.round(x)}% darker after sunset` : "Off"), "wall_night_dim", (x) => Math.round(x) / 100));
  if (!(ctx.hass && ctx.hass.states && ctx.hass.states["sun.sun"])) {
    card.appendChild(el("div", { style: "font-size:11px;color:#fbbf24;margin:-2px 0 4px 142px" },
      "Night dimming goes by sun.sun, which this Home Assistant doesn't have (Settings → Devices & services → Sun)."));
  }
  const shiftRow = el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;margin:8px 0 0" });
  const shiftCb = el("input", { type: "checkbox" });
  shiftCb.checked = v.shift;
  shiftCb.addEventListener("change", () => { const want = shiftCb.checked; v.shift = want; save({ wall_pixel_shift: want }, () => { shiftCb.checked = !want; v.shift = !want; }); });
  shiftRow.appendChild(shiftCb);
  shiftRow.appendChild(el("span", { style: "color:#e2e8f0;font-size:13px" }, "Protect against burn-in: move the picture a couple of pixels every few minutes (OLED screens)"));
  card.appendChild(shiftRow);

  // ── a link for one screen that differs from the others ──
  const linkBox = el("input", { type: "text", readonly: "", style: "flex:1 1 260px;min-width:200px;font-family:ui-monospace,Consolas,monospace;font-size:12px" });
  const copy = el("button", { class: "btn inline", type: "button" }, "Copy");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.origin + linkBox.value); ctx.toast("Link copied"); }
    catch (_) { linkBox.select(); ctx.toast("Select the link and copy it"); }
  });
  card.appendChild(el("div", { style: "font-size:12px;color:#94a3b8;margin:14px 0 4px" },
    "A screen that's different from the others (a smaller tablet, a far TV) can carry its own size in its link, which wins over the settings above:"));
  card.appendChild(el("div", { style: "display:flex;flex-wrap:wrap;gap:8px;align-items:center" }, [linkBox, copy]));
  card.appendChild(note);

  function paint(){
    const o = { inches: v.mode === "room" ? v.inches : 0, meters: v.meters, arcmin: v.arcmin };
    const k4 = WALLS.wallScale(3840, 2160, o), k1 = WALLS.wallScale(1920, 1080, o);
    linkBox.value = WALLS.wallLink(o);
    // A 4K screen 320 px wide: the rail, the legend and a room's name at their
    // share of it, so you see how much of the screen the controls take.
    const W = 320, H = 180, f = W / 3840;
    const rail = Math.max(2, 44 * k4 * f), leg = Math.max(2, 34 * k4 * f), txt = Math.max(3, 13 * k4 * f);
    pic.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="A 4K wall screen at this size">
      <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="6" fill="#040a05" stroke="#2d4a38"/>
      <rect x="1" y="1" width="${rail.toFixed(1)}" height="${H - 2}" fill="#0f1a12"/>
      <rect x="${rail.toFixed(1)}" y="${(H - 1 - leg).toFixed(1)}" width="${(W - 1 - rail).toFixed(1)}" height="${leg.toFixed(1)}" fill="#0f1a12"/>
      <g transform="translate(${((W + rail) / 2).toFixed(1)},${((H - leg) / 2).toFixed(1)})">
        <polygon points="-70,-6 0,-40 70,-6 0,28" fill="#1b3526" stroke="#52b788" stroke-width="1"/>
        <polygon points="-70,22 0,-12 70,22 0,56" fill="#152a1a" stroke="#2d6a4f" stroke-width="1" opacity="0.7"/>
        <text x="0" y="-8" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="${txt.toFixed(1)}" fill="#e2e8f0">Living room</text>
      </g>
      <text x="${W - 8}" y="14" text-anchor="end" font-family="Inter,system-ui,sans-serif" font-size="10" fill="#64748b">4K</text>
    </svg>`;
    const mm4 = WALLS.textMm(k4, o.inches, 3840, 2160), mm1 = WALLS.textMm(k1, o.inches, 1920, 1080);
    const x = (n) => n.toFixed(2).replace(/\.?0+$/, "");
    const lines = [
      `<b style="color:#e2e8f0">On a 4K screen:</b> everything ${x(k4)}× its desktop size` + (mm4 ? `, text about ${(mm4 / 10).toFixed(1)} cm tall` : ""),
      `<b style="color:#e2e8f0">On a 1080p screen:</b> ${x(k1)}×` + (mm1 ? `, text about ${(mm1 / 10).toFixed(1)} cm tall` : ""),
      v.mode === "room"
        ? `<span style="color:#94a3b8">${Math.round(v.inches)}" seen from ${v.meters.toFixed(1)} m. At about ${(v.inches * 0.0254 * 1.5 * 0.49).toFixed(1)} m or nearer, 4K's extra pixels show; further away the screen only needs bigger, not sharper.</span>`
        : `<span style="color:#94a3b8">Sized from the screen's pixels alone. Choose <b>Size for my room</b> to size it for how far away people are.</span>`,
    ];
    if (k4 >= WALLS.WALL_UI_MAX) lines.push(`<span style="color:#fbbf24">That's as big as a wall draws (${WALLS.WALL_UI_MAX}×).</span>`);
    facts.innerHTML = lines.map(l => `<div>${l}</div>`).join("") + (v.mode === "room" ? sideView(v.inches, v.meters) : "");
  }
  paint();
  return card;
}
